// MarkdownView.ets - 长文阅读渲染（资源正文与模型生成的学习素材共用）
// 只实现阅读真正需要的子集：# 标题、- 无序列表、> 引用、--- 分隔线、普通段落，
// 以及行内 ** 加粗 / ` 代码 / [文字](链接) 的降级。刻意不引富交互渲染器：
// 这些正文是拿来读的，列表与标题层级清楚就够了。
//
// 解析在内容变化时做一次，渲染阶段不再重复解析（长文每帧 re-parse 会明显掉帧）。

import { FontSize, LineHeight, Space } from '../../common/DesignToken';

// 行类型：标题 / 无序列表 / 引用 / 分隔线 / 普通段落
export enum MarkdownKind {
    TEXT = 0,
    HEADING = 1,
    BULLET = 2,
    QUOTE = 3,
    DIVIDER = 4,
}

export interface MarkdownLine {
    kind: MarkdownKind;
    text: string;
    level: number;
}

const HEADING: RegExp = /^#{1,6}\s+/;
const BULLET: RegExp = /^[-*+]\s+/;
const DIVIDER: RegExp = /^[-*_]{3,}$/;

@Component
export struct MarkdownView {
    @Prop @Watch('onBodyChanged') body: string = '';

    @State private lines: MarkdownLine[] = [];

    aboutToAppear(): void {
        this.onBodyChanged();
    }

    onBodyChanged(): void {
        this.lines = MarkdownView.parse(this.body);
    }

    build() {
        Column({ space: Space.md }) {
            ForEach(this.lines, (line: MarkdownLine) => {
                this.Line(line)
            }, (line: MarkdownLine, index: number) => 'md_' + index);
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start);
    }

    @Builder
    Line(line: MarkdownLine) {
        if (line.kind === MarkdownKind.DIVIDER) {
            Row()
                .width('100%')
                .height(1)
                .backgroundColor($r('app.color.divider'));
        } else if (line.kind === MarkdownKind.HEADING) {
            Text(line.text)
                .fontSize(line.level <= 1 ? FontSize.title : FontSize.bodyLarge)
                .fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary'))
                .lineHeight(line.level <= 1 ? 30 : LineHeight.body)
                .margin({ top: line.level <= 1 ? Space.md : Space.sm })
                .width('100%');
        } else if (line.kind === MarkdownKind.BULLET) {
            Row({ space: Space.sm }) {
                Column()
                    .width(4)
                    .height(4)
                    .borderRadius(2)
                    .backgroundColor($r('app.color.brand_primary'))
                    .margin({ top: 8 });

                Text(line.text)
                    .fontSize(FontSize.body)
                    .fontColor($r('app.color.text_secondary'))
                    .lineHeight(LineHeight.body)
                    .layoutWeight(1);
            }
            .width('100%')
            .alignItems(VerticalAlign.Top);
        } else if (line.kind === MarkdownKind.QUOTE) {
            Text(line.text)
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_secondary'))
                .lineHeight(LineHeight.caption)
                .width('100%')
                .border({ width: { left: 2 }, color: $r('app.color.brand_primary') })
                .padding({ left: Space.md, top: Space.xxs, bottom: Space.xxs });
        } else {
            Text(line.text)
                .fontSize(FontSize.body)
                .fontColor($r('app.color.text_secondary'))
                .lineHeight(LineHeight.body)
                .width('100%');
        }
    }

    // 正文切行：空行丢弃，其余按前缀归类；行内标记统一剥掉，避免裸 ** 与 []() 出现在正文里
    private static parse(body: string): MarkdownLine[] {
        const raw: string[] = body.split('\n');
        const result: MarkdownLine[] = [];

        for (let i: number = 0; i < raw.length; i++) {
            const line: string = raw[i].trim();

            if (line.length === 0) {
                continue;
            }

            if (DIVIDER.test(line)) {
                result.push({ kind: MarkdownKind.DIVIDER, text: '', level: 0 });
                continue;
            }

            if (HEADING.test(line)) {
                result.push({
                    kind: MarkdownKind.HEADING,
                    text: MarkdownView.inline(line.replace(HEADING, '')),
                    level: MarkdownView.headingLevel(line),
                });
                continue;
            }

            if (BULLET.test(line)) {
                result.push({
                    kind: MarkdownKind.BULLET,
                    text: MarkdownView.inline(line.replace(BULLET, '')),
                    level: 0,
                });
                continue;
            }

            if (line.startsWith('>')) {
                result.push({
                    kind: MarkdownKind.QUOTE,
                    text: MarkdownView.inline(line.replace(/^>\s?/, '')),
                    level: 0,
                });
                continue;
            }

            result.push({ kind: MarkdownKind.TEXT, text: MarkdownView.inline(line), level: 0 });
        }

        return result;
    }

    private static headingLevel(line: string): number {
        let count: number = 0;

        while (count < line.length && line.charAt(count) === '#') {
            count = count + 1;
        }

        return count;
    }

    // 行内 Markdown 降级：** 加粗、` 代码、[文字](链接) 只保留文字
    private static inline(text: string): string {
        return text
            .replace(/\*\*/g, '')
            .replace(/`/g, '')
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    }
}
