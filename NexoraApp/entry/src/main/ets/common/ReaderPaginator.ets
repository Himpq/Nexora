// ReaderPaginator.ets - 阅读器分页引擎（纯逻辑，不依赖任何 UI 组件）
// 目标：把章节段落按「一屏一页」切分成页，供横向翻页阅读使用。
//
// 关键事实（来自教材接口真实数据）：
//  1. 后端 heading_level 全量为 0，标题层级写在段落文本自身（「第3章」「3.1.2 关系运算符」），
//     因此标题由文本形态判定，这是该文本格式的排版规则，不是容错分支；
//  2. 小节（session）的 paragraph_start 存在偏移，不能用于定位小节起点，
//     页面所属小节改为在流式排版中跟踪最近一次出现的标题，结果与实际文本一致；
//  3. 高度来自真实文本测量（UI 层注入 ReaderMeasureText），不是字数估算，
//     超长段落按「能放下的最长前缀」二分切分，续段流入下一页。

import { hilog } from '@kit.PerformanceAnalysisKit';
import { LearningParagraph } from './LearningApi';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraPaginator';

// 测量回调：返回文本在给定约束宽度下的排版高度（与 ReaderLayout 使用同一长度单位）
export type ReaderMeasureText = (text: string, fontSize: number, lineHeight: number, width: number) => number;

// 页面内的排版块
export interface ReaderBlock {
    kind: string;
    text: string;
    imageId: string;
    fontSize: number;
    lineHeight: number;
    height: number;
    gap: number;
    paragraphIndex: number;
}

// 一页正文：sectionTitle 为该页起始处所属的标题（章或节），供页眉显示
export interface ReaderPage {
    blocks: ReaderBlock[];
    sectionTitle: string;
}

// 排版度量：width / height 为正文可用区，fontSize / lineHeight 为整数值
export interface ReaderLayout {
    width: number;
    height: number;
    fontSize: number;
    lineHeight: number;
    paragraphGap: number;
}

// 块的种类
export class ReaderBlockKind {
    static readonly TEXT: string = 'text';
    static readonly IMAGE: string = 'image';
    static readonly HEADING: string = 'heading';
}

// 标题层级识别：本书正文自带「第N章」/「N.N 标题」形式的编号，层级由编号形态判定
export class ReaderHeading {
    static readonly NONE: number = 0;
    static readonly CHAPTER: number = 1;
    static readonly SECTION: number = 2;

    private static readonly CHAPTER_PATTERN: RegExp = /^第[0-9〇零一二三四五六七八九十百千]+章/;
    private static readonly SECTION_PATTERN: RegExp = /^\d+(\.\d+){1,2}\s+\S/;
    // 标题行都很短：以编号开头但整段偏长的，说明是正文句子，按正文排版
    private static readonly MAX_LENGTH: number = 30;
    // 章副标题（紧跟在「第N章」之后的短行，如「表达式与语句」）的长度上限
    private static readonly SUBTITLE_LENGTH: number = 20;
    private static readonly SENTENCE_END: RegExp = /[。！？；：，,]$/;

    static levelOf(text: string): number {
        const line: string = text.trim();

        if (line.length === 0 || line.length > ReaderHeading.MAX_LENGTH) {
            return ReaderHeading.NONE;
        }

        if (ReaderHeading.CHAPTER_PATTERN.test(line)) {
            return ReaderHeading.CHAPTER;
        }

        if (ReaderHeading.SECTION_PATTERN.test(line)) {
            return ReaderHeading.SECTION;
        }

        return ReaderHeading.NONE;
    }

    // 章副标题：紧跟在章标题之后、不含句读的短行（「表达式与语句」），与章标题同级排版
    static isChapterSubtitle(text: string): boolean {
        const line: string = text.trim();

        if (line.length === 0 || line.length > ReaderHeading.SUBTITLE_LENGTH) {
            return false;
        }

        return !ReaderHeading.SENTENCE_END.test(line);
    }
}

// 图片块占位高度：按正文宽度等比给定，超出一屏时压到半屏，保证页面不被单图占满
const IMAGE_ASPECT: number = 0.62;
const IMAGE_MAX_RATIO: number = 0.55;

// 段落间距相对字号的倍率：与行距一起构成纸张呼吸感
const GAP_RATIO: number = 0.55;
const HEADING_GAP_RATIO: number = 1.2;

// 标题字号增量：章标题 +6，节标题 +2
const HEADING_STEP_CHAPTER: number = 6;
const HEADING_STEP_SECTION: number = 2;
const HEADING_LINE_RATIO: number = 1.4;

export function readerParagraphGap(fontSize: number): number {
    return Math.round(fontSize * GAP_RATIO);
}

export class ReaderPaginator {
    // 主入口：段落 -> 页数组
    static paginate(paragraphs: LearningParagraph[], layout: ReaderLayout, measure: ReaderMeasureText): ReaderPage[] {
        if (paragraphs.length === 0 || layout.height <= 0 || layout.width <= 0) {
            return [];
        }

        const flow: ReaderPageFlow = new ReaderPageFlow(layout, measure);

        for (let i: number = 0; i < paragraphs.length; i++) {
            try {
                flow.push(paragraphs[i]);
            } catch (err) {
                hilog.error(DOMAIN, TAG, 'paginate paragraph failed index=%{public}d kind=%{public}s textChars=%{public}d imageChars=%{public}d error=%{public}s',
                    i, paragraphs[i].kind, paragraphs[i].text.length, paragraphs[i].imageId.length, JSON.stringify(err));
                throw new Error(JSON.stringify(err));
            }
        }

        try {
            return flow.finish();
        } catch (err) {
            hilog.error(DOMAIN, TAG, 'paginate finish failed paragraphs=%{public}d error=%{public}s',
                paragraphs.length, JSON.stringify(err));
            throw new Error(JSON.stringify(err));
        }
    }

    static imageHeight(layout: ReaderLayout): number {
        const byAspect: number = layout.width * IMAGE_ASPECT;
        const cap: number = layout.height * IMAGE_MAX_RATIO;

        return Math.round(Math.min(byAspect, cap));
    }
}

// 分页流水：持有「当前页已用高度 + 当前页块 + 当前标题」，把可变状态从模块级闭包里收进对象
class ReaderPageFlow {
    private layout: ReaderLayout;
    private measure: ReaderMeasureText;
    private pages: ReaderPage[] = [];
    private blocks: ReaderBlock[] = [];
    private used: number = 0;
    // 当前所属标题（章或节），随排版前进更新
    private sectionTitle: string = '';
    // 当前页起始处所属标题
    private pageSectionTitle: string = '';
    // 上一段是否为章标题：用于识别紧随其后的章副标题
    private afterChapterTitle: boolean = false;

    constructor(layout: ReaderLayout, measure: ReaderMeasureText) {
        this.layout = layout;
        this.measure = measure;
    }

    push(paragraph: LearningParagraph): void {
        if (paragraph.kind === 'image') {
            this.pushImage(paragraph);
            return;
        }

        this.pushText(paragraph);
    }

    // ---------- 文本 ----------
    private pushText(paragraph: LearningParagraph): void {
        const text: string = paragraph.text.trim();

        if (text.length === 0) {
            return;
        }

        const level: number = this.levelOf(text);
        const heading: boolean = level > ReaderHeading.NONE;

        if (heading) {
            this.sectionTitle = text;
        }

        const fontSize: number = this.fontSizeOf(level);
        const lineHeight: number = heading ? Math.round(fontSize * HEADING_LINE_RATIO) : this.layout.lineHeight;
        const gapRatio: number = heading ? HEADING_GAP_RATIO : GAP_RATIO;
        const gap: number = Math.round(fontSize * gapRatio);

        let rest: string = text;
        let firstFragment: boolean = true;

        while (rest.length > 0) {
            const gapNow: number = this.blocks.length === 0 ? 0 : gap;
            const available: number = this.layout.height - this.used - gapNow;

            // 剩余空间连一行都放不下：先翻页再重算可用高度
            if (available < lineHeight) {
                this.flush();
                continue;
            }

            const full: number = this.measure(rest, fontSize, lineHeight, this.layout.width);

            if (full <= available) {
                this.append(level, paragraph.index, fontSize, lineHeight, full, firstFragment ? gap : 0, rest, '');
                return;
            }

            const cut: number = this.maxPrefix(rest, fontSize, lineHeight, available);
            const fragment: string = rest.substring(0, cut);

            this.append(level, paragraph.index, fontSize, lineHeight,
                this.measure(fragment, fontSize, lineHeight, this.layout.width),
                firstFragment ? gap : 0, fragment, '');
            this.flush();
            rest = rest.substring(cut).trim();
            firstFragment = false;
        }
    }

    // 段落层级：章标题之后紧跟的短行按章级排版（章副标题），其余按编号形态判定
    private levelOf(text: string): number {
        const detected: number = ReaderHeading.levelOf(text);

        if (detected === ReaderHeading.CHAPTER) {
            this.afterChapterTitle = true;
            return ReaderHeading.CHAPTER;
        }

        if (this.afterChapterTitle) {
            this.afterChapterTitle = false;

            if (ReaderHeading.isChapterSubtitle(text)) {
                return ReaderHeading.CHAPTER;
            }
        }

        return detected;
    }

    private fontSizeOf(level: number): number {
        if (level === ReaderHeading.CHAPTER) {
            return this.layout.fontSize + HEADING_STEP_CHAPTER;
        }

        if (level === ReaderHeading.SECTION) {
            return this.layout.fontSize + HEADING_STEP_SECTION;
        }

        return this.layout.fontSize;
    }

    // 二分找「在 available 高度内能放下的最长前缀」；至少返回 1，避免死循环
    private maxPrefix(text: string, fontSize: number, lineHeight: number, available: number): number {
        let low: number = 1;
        let high: number = text.length;

        while (low < high) {
            const mid: number = Math.floor((low + high + 1) / 2);

            if (this.measure(text.substring(0, mid), fontSize, lineHeight, this.layout.width) <= available) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }

        return low;
    }

    // ---------- 图片 ----------
    private pushImage(paragraph: LearningParagraph): void {
        const height: number = ReaderPaginator.imageHeight(this.layout);
        const gap: number = this.layout.paragraphGap;

        if (this.blocks.length > 0 && this.used + gap + height > this.layout.height) {
            this.flush();
        }

        this.append(ReaderHeading.NONE, paragraph.index, this.layout.fontSize, this.layout.lineHeight, height,
            this.blocks.length === 0 ? 0 : gap, '', paragraph.imageId);
    }

    // ---------- 块 / 页 ----------
    private append(level: number, paragraphIndex: number, fontSize: number, lineHeight: number,
        height: number, gap: number, text: string, imageId: string): void {
        if (this.blocks.length === 0) {
            this.pageSectionTitle = this.sectionTitle;
        }

        const kind: string = imageId.length > 0
            ? ReaderBlockKind.IMAGE
            : (level > ReaderHeading.NONE ? ReaderBlockKind.HEADING : ReaderBlockKind.TEXT);

        this.blocks.push({
            kind: kind,
            text: text,
            imageId: imageId,
            fontSize: fontSize,
            lineHeight: lineHeight,
            height: height,
            gap: gap,
            paragraphIndex: paragraphIndex,
        });
        this.used += gap + height;
    }

    private flush(): void {
        if (this.blocks.length === 0) {
            return;
        }

        this.pages.push({ blocks: this.blocks, sectionTitle: this.pageSectionTitle });
        this.blocks = [];
        this.used = 0;
    }

    finish(): ReaderPage[] {
        this.flush();

        return this.pages;
    }
}
