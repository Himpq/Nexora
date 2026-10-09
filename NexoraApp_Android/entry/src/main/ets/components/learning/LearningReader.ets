// LearningReader.ets - 教材阅读器（横向分页 + 连续阅读）
// 交互对齐成熟阅读器：左右滑动翻页（跟手 + 缓出动画）、点击左右区域翻页、点击中部切换沉浸界面、
// 页眉显示书名与目录/排版入口，页脚显示所属小节、本章页码与全书进度条。
//
// 关键设计：
//  1. 分页高度来自真实文本测量（MeasureUtils），字号 / 行距变化后按「当前页首段」锚点重排，不跳读；
//  2. 页面用 LazyForEach 挂载并只缓存相邻一页，插图随页面出现才下载，避免整章一次拉满图片；
//  3. 读到章末自动续载下一章、读到章首自动补载上一章，阅读不被章节边界打断。

import { hilog } from '@kit.PerformanceAnalysisKit';
import { common } from '@kit.AbilityKit';
import { promptAction } from '@kit.ArkUI';
import MeasureText from '@ohos.measure';
import { AppState } from '../../common/AppState';
import {
    LearningApi,
    LearningBook,
    LearningChapterContent,
    LearningChapterSummary,
    LearningSession,
    NO_BOOK,
} from '../../common/LearningApi';
import { LearningFormat } from '../../common/LearningFormat';
import { LearningHttp, LearningIdentity } from '../../common/LearningHttp';
import { ReadingCheckpoint, ReadingSession } from '../../common/LearningReading';
import { LearningReadingApi, LearningReadingTelemetryOptions } from '../../common/LearningReadingApi';
import {
    ReaderBlock,
    ReaderBlockKind,
    ReaderLayout,
    ReaderMeasureText,
    ReaderPage,
    ReaderPaginator,
    readerParagraphGap,
} from '../../common/ReaderPaginator';
import { FontSize, Motion, Radius, ReaderPalette, ReaderTheme, Shadow, Size, Space } from '../../common/DesignToken';
import { IconButton } from '../common/IconButton';
import { RemoteImage } from '../chat/RemoteImage';
import { MarkdownView } from '../chat/MarkdownBlock';
import { LoadingBlock, Placeholder, ProgressTrack } from './LearningWidgets';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraReader';

// 正文左右留白与上下留白：构成纸张四边的呼吸感
const PAGE_MARGIN_H: number = 22;
const PAGE_PADDING_V: number = 10;
// 页眉 / 页脚常驻高度：切换沉浸界面时只有内容显隐，正文排版不跳动
const HEADER_BAND: number = 34;
const FOOTER_BAND: number = 34;
const CONTROL_SIZE: number = 34;
// 点击分区：左右各 28% 翻页，中间切换界面（与主流阅读器一致）
const TAP_EDGE_RATIO: number = 0.28;
// 距离书末 / 书首这么多页时开始预载相邻章节
const PRELOAD_AHEAD: number = 2;
// 目录抽屉宽度，以及关闭时向左移出的距离（要大于 100%，连同阴影一起移出屏幕）
const TOC_WIDTH: string = '82%';
const TOC_HIDDEN_X: string = '-125%';
// 目录头部封面（竖版书封）与教材简介的行数：ArkUI 没有「不限行」的字面量，
// 全展开取一个足够大的值表示不截断
const TOC_COVER_WIDTH: number = 56;
const TOC_COVER_HEIGHT: number = 76;
const TOC_INTRO_LINES: number = 3;
const TOC_INTRO_EXPANDED: number = 999;
const COMPLETE_CARD_HEIGHT: number = 104;
const COMPLETE_CARD_GAP: number = 16;
const READING_HEARTBEAT_MS: number = 10000;

export interface ReaderAnchor {
    chapterIndex: number;
    paragraphIndex: number;
    readStart: number;
    completion: boolean;
}

interface ReaderAskTurn {
    question: string;
    answer: string;
}

// 章节请求结果：失败原因随结果返回，由调用方决定是页面级错误还是仅记录日志
interface ChapterFetch {
    ok: boolean;
    message: string;
}

// 扁平页：连续阅读把各章页面首尾相接，索引即 Swiper 的下标
interface FlatPage {
    key: string;
    chapterIndex: number;
    chapterTitle: string;
    pageInChapter: number;
    pageCountInChapter: number;
    bookProgress: number;
    page: ReaderPage;
}

interface SpacingOption {
    value: number;
    label: string;
}

interface ThemeOption {
    name: string;
    label: string;
}

const SPACING_OPTIONS: SpacingOption[] = [
    { value: 0, label: '紧凑' },
    { value: 1, label: '适中' },
    { value: 2, label: '疏松' },
];

const THEME_OPTIONS: ThemeOption[] = [
    { name: 'day', label: '白天' },
    { name: 'sepia', label: '护眼' },
    { name: 'night', label: '夜间' },
];

// Swiper 的懒加载数据源：只在页面进入缓存区时才构建，插图随之下载
class FlatPageSource implements IDataSource {
    private items: FlatPage[] = [];
    private listeners: DataChangeListener[] = [];

    totalCount(): number {
        return this.items.length;
    }

    getData(index: number): FlatPage {
        return this.items[index];
    }

    registerDataChangeListener(listener: DataChangeListener): void {
        if (this.listeners.indexOf(listener) < 0) {
            this.listeners.push(listener);
        }
    }

    unregisterDataChangeListener(listener: DataChangeListener): void {
        const position: number = this.listeners.indexOf(listener);

        if (position >= 0) {
            this.listeners.splice(position, 1);
        }
    }

    replace(items: FlatPage[]): void {
        this.items = items;

        for (let i: number = 0; i < this.listeners.length; i++) {
            this.listeners[i].onDataReloaded();
        }
    }
}

@Component
export struct LearningReader {
    @ObjectLink app: AppState;
    @Prop lectureId: string = '';
    @Prop book: LearningBook = NO_BOOK;
    @Prop chapters: LearningChapterSummary[] = [];
    @Prop startChapterIndex: number = 0;
    @Prop initialParagraph: number = -1;
    @Prop flowId: string = '';
    @Prop flowChapterIndex: number = -1;
    @Prop @Watch('onReadingVisibilityChanged') visible: boolean = true;
    // 本层在宿主导航中的层级：消费返回请求后把 navDepth 复位，避免宿主误判为退出本层
    @Prop navLevel: number = 0;
    @Link @Watch('onReadingVisibilityChanged') navDepth: number;
    // 浮层展开标记与返回请求令牌：由宿主统一编排返回键，阅读器只负责响应
    @Link readerOverlayOpen: boolean;
    @Link @Watch('onBackRequested') readerBackToken: number;
    onBack: (chapterIndex: number) => void = () => {};
    onOpenImage: (url: string) => void = () => {};

    // 沉浸式布局下贴底浮层自己让开手势区
    @StorageProp('insetBottom') private insetBottom: number = 0;
    @StorageProp('appForeground') @Watch('onReadingVisibilityChanged') private appForeground: boolean = false;
    @StorageProp('nxLearningIdentityRevision') @Watch('onReadingIdentityChanged') private identityRevision: number = 0;

    @State private pages: FlatPage[] = [];
    @State private currentIndex: number = 0;
    @State private chromeVisible: boolean = true;
    @State @Watch('onReadingVisibilityChanged') private settingsOpen: boolean = false;
    @State @Watch('onReadingVisibilityChanged') private tocOpen: boolean = false;
    @State @Watch('onReadingVisibilityChanged') private askOpen: boolean = false;
    @State private questionText: string = '';
    @State private askBusy: boolean = false;
    @State private askError: string = '';
    @State private askTurns: ReaderAskTurn[] = [];
    @State private completedChapters: number[] = [];
    @State private completingChapters: number[] = [];
    @State private tocIntroExpanded: boolean = false;
    @State @Watch('onReadingVisibilityChanged') private opening: boolean = true;
    @State private errorMessage: string = '';
    // 正文带可用尺寸（vp）：由 onBandResize 给出，是排版度量的唯一来源
    @State private layoutWidth: number = 0;
    @State private layoutHeight: number = 0;
    @State private bandWidth: number = 0;
    @State private bandHeight: number = 0;

    private pageSource: FlatPageSource = new FlatPageSource();
    // 目录列表控制器：打开目录时直接滚到当前章，省掉在长目录里手动翻找
    private tocScroller: Scroller = new Scroller();
    private swiper: SwiperController = new SwiperController();
    // 已加载的章节原始内容与升序章号
    private contents: Map<number, LearningChapterContent> = new Map<number, LearningChapterContent>();
    private order: number[] = [];
    private fetching: Set<number> = new Set<number>();
    // 上次写入持久化的章号
    private savedChapter: number = -1;
    private openSequence: number = 0;
    private disposed: boolean = false;
    private initialized: boolean = false;
    private rebuilding: boolean = false;
    private readingContext: common.UIAbilityContext | null = null;
    private readingOwner: LearningIdentity | null = null;
    private readingSession: ReadingSession | null = null;
    private sessionPoint: ReadingCheckpoint | null = null;
    private sessionPage: FlatPage | null = null;
    private readingFocused: boolean = false;
    private heartbeatId: number = -1;
    private chapterRequestVersion: number = 0;
    private flowReadingConfirmed: boolean = false;
    private flowCompletionPoint: ReadingCheckpoint | null = null;
    private flowDoneStarted: boolean = false;
    private initialAnchor: ReaderAnchor | null = null;

    // 文本测量：输入按 vp，测量结果按 px 返回，换算回 vp 后参与排版
    private measure: ReaderMeasureText = (text: string, fontSize: number, lineHeight: number, width: number): number => {
        try {
            const size: SizeOptions = MeasureText.measureTextSize({
                textContent: text,
                fontSize: fontSize,
                constraintWidth: width,
                lineHeight: lineHeight,
            });
            // 返回值宽度与高度按 px 下发的（字段声明为 Length，实际为 number），换算成 vp 后参与排版
            const height: Length | undefined = size.height;

            return typeof height === 'number' ? px2vp(height) : 0;
        } catch (err) {
            hilog.error(DOMAIN, TAG, 'measure failed textChars=%{public}d font=%{public}d lineHeight=%{public}d width=%{public}d error=%{public}s',
                text.length, fontSize, lineHeight, width, JSON.stringify(err));
            throw new Error(JSON.stringify(err));
        }
    };

    aboutToAppear(): void {
        this.disposed = false;
        this.readingOwner = LearningHttp.captureIdentity();
        this.initialized = true;
        const host = this.getUIContext().getHostContext();
        if (host !== undefined) {
            this.readingContext = host as common.UIAbilityContext;
        }
        this.openStartChapter();
    }

    aboutToDisappear(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.openSequence += 1;
        this.chapterRequestVersion += 1;
        this.stopHeartbeat();
        this.finishReadingSession();
        this.readerOverlayOpen = false;
        this.completeConfirmedFlow();
    }

    private openStartChapter(): void {
        const start: number = this.startChapterIndex < 0 ? 0 : this.startChapterIndex;

        this.initialAnchor = this.initialParagraph < 0 ? null : {
            chapterIndex: start, paragraphIndex: this.initialParagraph, readStart: -1, completion: false,
        };
        void this.openChapter(start);
    }

    // 宿主转来的返回请求：优先关闭浮层，浮层全关时把 navDepth 复位（宿主随后按层级回退）
    onBackRequested(): void {
        if (this.closeOverlay()) {
            return;
        }

        this.navDepth = this.navLevel;
    }

    private closeOverlay(): boolean {
        if (this.askOpen) {
            this.closeAsk();
            return true;
        }
        if (this.settingsOpen) {
            this.closeSettings();
            return true;
        }

        if (this.tocOpen) {
            this.closeToc();
            return true;
        }

        return false;
    }

    private openToc(): void {
        this.tocOpen = true;
        this.onReadingVisibilityChanged();

        const row: number = this.currentTocRow();

        if (row >= 0) {
            // 等抽屉滑入完成再滚动，避免滚动发生在动画中途肉眼看不出定位
            setTimeout(() => {
                if (!this.disposed && this.tocOpen) {
                    this.tocScroller.scrollToIndex(row, true);
                }
            }, Motion.durationBase);
        }
    }

    private closeToc(): void {
        this.tocOpen = false;
        this.onReadingVisibilityChanged();
    }

    private openSettings(): void {
        this.settingsOpen = true;
        this.onReadingVisibilityChanged();
    }

    private closeSettings(): void {
        this.settingsOpen = false;
        this.onReadingVisibilityChanged();
    }

    // 当前章在目录列表里的行号：目录顺序来自后端，行号不等于章号，必须按章号反查
    private currentTocRow(): number {
        const chapterIndex: number = this.currentChapterIndex();

        for (let i: number = 0; i < this.chapters.length; i++) {
            if (this.chapters[i].index === chapterIndex) {
                return i;
            }
        }

        return -1;
    }

    private currentChapterIndex(): number {
        const item: FlatPage | undefined = this.currentPage();

        return item === undefined ? -1 : item.chapterIndex;
    }

    // ---------- 章节装载 ----------
    // 打开指定章节：清空当前阅读链，以该章为起点重新建链
    private async openChapter(chapterIndex: number): Promise<void> {
        this.finishReadingSession();
        this.clearChapterQuestions();
        this.openSequence += 1;
        const openId: number = this.openSequence;
        const startedAt: number = Date.now();
        this.opening = true;
        this.errorMessage = '';
        this.contents.clear();
        this.order = [];
        this.fetching.clear();
        this.pages = [];
        this.currentIndex = 0;
        this.pageSource.replace([]);

        hilog.info(DOMAIN, TAG, 'open start id=%{public}d chapter=%{public}d chapters=%{public}d width=%{public}d height=%{public}d',
            openId, chapterIndex, this.chapters.length, this.layoutWidth, this.layoutHeight);

        let fetched: ChapterFetch;

        try {
            fetched = await this.fetchChapter(chapterIndex, openId);
        } catch (err) {
            if (this.disposed || openId !== this.openSequence) {
                return;
            }
            this.errorMessage = '章节请求异常，请重试';
            hilog.error(DOMAIN, TAG, 'open request threw id=%{public}d chapter=%{public}d elapsedMs=%{public}d error=%{public}s',
                openId, chapterIndex, Date.now() - startedAt, JSON.stringify(err));
            this.opening = false;
            return;
        }

        if (this.disposed || openId !== this.openSequence) {
            return;
        }

        if (!fetched.ok) {
            this.errorMessage = fetched.message;
            hilog.error(DOMAIN, TAG, 'open request failed id=%{public}d chapter=%{public}d message=%{public}s elapsedMs=%{public}d',
                openId, chapterIndex, fetched.message, Date.now() - startedAt);
            this.opening = false;
            return;
        }

        try {
            hilog.info(DOMAIN, TAG, 'open layout start id=%{public}d chapter=%{public}d contents=%{public}d',
                openId, chapterIndex, this.contents.size);
            this.rebuild(this.initialAnchor);
            this.preloadNext();
            hilog.info(DOMAIN, TAG, 'open success id=%{public}d chapter=%{public}d pages=%{public}d elapsedMs=%{public}d',
                openId, chapterIndex, this.pages.length, Date.now() - startedAt);
        } catch (err) {
            this.errorMessage = '章节排版异常，请重试';
            hilog.error(DOMAIN, TAG, 'open layout threw id=%{public}d chapter=%{public}d elapsedMs=%{public}d error=%{public}s',
                openId, chapterIndex, Date.now() - startedAt, JSON.stringify(err));
        } finally {
            this.opening = false;
            this.enterCurrentPage();
        }
    }

    private async fetchChapter(chapterIndex: number, openId: number): Promise<ChapterFetch> {
        if (!this.chapters.some((chapter: LearningChapterSummary) => chapter.index === chapterIndex)) {
            hilog.error(DOMAIN, TAG, 'fetch rejected chapter=%{public}d chapters=%{public}d reason=out of range',
                chapterIndex, this.chapters.length);
            return { ok: false, message: '章节超出范围' };
        }

        if (this.contents.has(chapterIndex)) {
            hilog.info(DOMAIN, TAG, 'fetch cache hit chapter=%{public}d', chapterIndex);
            return { ok: true, message: '' };
        }

        const startedAt: number = Date.now();
        hilog.info(DOMAIN, TAG, 'fetch chapter index=%{public}d', chapterIndex);
        const result = await LearningApi.shared.getBookChapter(this.lectureId, this.book.id, chapterIndex);
        if (this.disposed || openId !== this.openSequence || !LearningHttp.isCurrent(this.readingOwner)) {
            return { ok: false, message: '章节请求已失效' };
        }
        hilog.info(DOMAIN, TAG, 'fetch chapter index=%{public}d success=%{public}s content=%{public}s message=%{public}s elapsedMs=%{public}d',
            chapterIndex, result.success ? 'true' : 'false', result.content === null ? 'null' : 'present', result.message, Date.now() - startedAt);

        if (!result.success || result.content === null) {
            return { ok: false, message: result.message };
        }

        let textChars: number = 0;

        for (let i: number = 0; i < result.content.paragraphs.length; i++) {
            textChars += result.content.paragraphs[i].text.length;
        }

        hilog.info(DOMAIN, TAG, 'chapter content chapter=%{public}d paragraphs=%{public}d titleChars=%{public}d chars=%{public}d total=%{public}d start=%{public}d',
            chapterIndex, result.content.paragraphs.length, result.content.chapterTitle.length,
            textChars, result.content.bookTotalChars, result.content.chapterStart);
        this.contents.set(chapterIndex, result.content);
        this.order.push(chapterIndex);
        this.order.sort((left: number, right: number) => left - right);

        return { ok: true, message: '' };
    }

    private adjacentChapter(chapterIndex: number, step: number): number {
        const row: number = this.chapters.findIndex((chapter: LearningChapterSummary) => chapter.index === chapterIndex);
        const next: number = row + step;
        return row < 0 || next < 0 || next >= this.chapters.length ? -1 : this.chapters[next].index;
    }

    // 预载下一章：读到接近书末时补链，翻页不中断
    private preloadNext(): void {
        if (this.order.length === 0) {
            return;
        }

        const last: number = this.order[this.order.length - 1];
        const next: number = this.adjacentChapter(last, 1);

        if (next < 0 || this.contents.has(next) || this.fetching.has(next)) {
            return;
        }

        const openId: number = this.openSequence;
        this.fetching.add(next);
        this.fetchChapter(next, openId).then((fetched: ChapterFetch) => {
            if (this.disposed || openId !== this.openSequence) {
                return;
            }
            this.fetching.delete(next);

            if (!fetched.ok) {
                hilog.warn(DOMAIN, TAG, 'preload next chapter failed: %{public}s', fetched.message);
                return;
            }

            this.rebuild(this.captureAnchor());
        }).catch((err: Object) => {
            if (this.disposed || openId !== this.openSequence) {
                return;
            }
            this.fetching.delete(next);
            hilog.error(DOMAIN, TAG, 'preload next chapter threw chapter=%{public}d error=%{public}s', next, JSON.stringify(err));
        });
    }

    // 补载上一章：回到本章首页时向书首延伸
    private prependPrev(): void {
        if (this.order.length === 0) {
            return;
        }

        const previous: number = this.adjacentChapter(this.order[0], -1);

        if (previous < 0 || this.contents.has(previous) || this.fetching.has(previous)) {
            return;
        }

        const openId: number = this.openSequence;
        this.fetching.add(previous);
        this.fetchChapter(previous, openId).then((fetched: ChapterFetch) => {
            if (this.disposed || openId !== this.openSequence) {
                return;
            }
            this.fetching.delete(previous);

            if (!fetched.ok) {
                hilog.warn(DOMAIN, TAG, 'preload previous chapter failed: %{public}s', fetched.message);
                return;
            }

            // 锚点按「章 + 段」定位，前置新章后当前页自然后移，读者不会看到跳变
            this.rebuild(this.captureAnchor());
        }).catch((err: Object) => {
            if (this.disposed || openId !== this.openSequence) {
                return;
            }
            this.fetching.delete(previous);
            hilog.error(DOMAIN, TAG, 'preload previous chapter threw chapter=%{public}d error=%{public}s', previous, JSON.stringify(err));
        });
    }

    // ---------- 排版 ----------
    private layout(): ReaderLayout {
        const fontSize: number = this.app.readerFontSize;

        return {
            width: this.layoutWidth,
            height: this.layoutHeight,
            fontSize: fontSize,
            lineHeight: this.app.readerLineHeight(),
            paragraphGap: readerParagraphGap(fontSize),
        };
    }

    private rebuild(anchor: ReaderAnchor | null): void {
        if (this.disposed) {
            return;
        }
        const startedAt: number = Date.now();
        hilog.info(DOMAIN, TAG, 'layout rebuild start chapters=%{public}d pages=%{public}d width=%{public}d height=%{public}d',
            this.order.length, this.pages.length, this.layoutWidth, this.layoutHeight);

        if (this.layoutWidth <= 0 || this.layoutHeight <= 0) {
            hilog.warn(DOMAIN, TAG, 'layout skipped width=%{public}d height=%{public}d order=%{public}d',
                this.layoutWidth, this.layoutHeight, this.order.length);
            return;
        }

        const layout: ReaderLayout = this.layout();
        const pages: FlatPage[] = [];

        for (let i: number = 0; i < this.order.length; i++) {
            const chapterIndex: number = this.order[i];
            const content: LearningChapterContent | undefined = this.contents.get(chapterIndex);

            if (content === undefined) {
                continue;
            }

            const chapterContent: LearningChapterContent = content;
            let chapterPages: ReaderPage[];

            try {
                chapterPages = ReaderPaginator.paginate(chapterContent.paragraphs, layout, this.measure);
            } catch (err) {
                hilog.error(DOMAIN, TAG, 'layout paginate failed chapter=%{public}d paragraphs=%{public}d error=%{public}s',
                    chapterIndex, chapterContent.paragraphs.length, JSON.stringify(err));
                throw new Error(JSON.stringify(err));
            }

            // 章末空间不够时补一页放确认卡，避免卡片挤掉正文；自动跨章不触发完成。
            this.reserveCompletionCard(chapterPages, chapterContent.chapterTitle);

            hilog.info(DOMAIN, TAG, 'layout chapter done chapter=%{public}d paragraphs=%{public}d pages=%{public}d',
                chapterIndex, chapterContent.paragraphs.length, chapterPages.length);
            const progress: number = chapterContent.bookTotalChars <= 0
                ? 0
                : chapterContent.chapterStart / chapterContent.bookTotalChars;

            for (let p: number = 0; p < chapterPages.length; p++) {
                pages.push({
                    key: chapterIndex + '_' + p,
                    chapterIndex: chapterIndex,
                    chapterTitle: chapterContent.chapterTitle,
                    pageInChapter: p + 1,
                    pageCountInChapter: chapterPages.length,
                    bookProgress: progress,
                    page: chapterPages[p],
                });
            }
        }

        this.rebuilding = true;
        try {
            this.pages = pages;
            this.pageSource.replace(pages);
            const target: number = this.anchorIndex(pages, anchor === null ? this.initialAnchor : anchor);
            this.currentIndex = target;
            this.swiper.changeIndex(target, false);
            if (pages.length > 0) {
                this.initialAnchor = null;
            }
        } finally {
            this.rebuilding = false;
        }
        this.enterCurrentPage();

        hilog.info(DOMAIN, TAG, 'layout rebuild end chapters=%{public}d pages=%{public}d width=%{public}d height=%{public}d elapsedMs=%{public}d',
            this.order.length, pages.length, this.layoutWidth, this.layoutHeight, Date.now() - startedAt);
    }

    private reserveCompletionCard(pages: ReaderPage[], chapterTitle: string): void {
        const last: ReaderPage | undefined = pages.length === 0 ? undefined : pages[pages.length - 1];
        let used: number = 0;
        if (last !== undefined) {
            for (const block of last.blocks) {
                used += block.height + block.gap;
            }
        }
        if (last === undefined || used + COMPLETE_CARD_HEIGHT + COMPLETE_CARD_GAP > this.layoutHeight) {
            pages.push({ blocks: [], sectionTitle: last === undefined ? chapterTitle : last.sectionTitle });
        }
    }

    // 码点锚点区分同一长段的多片，预载和重排不会回跳到该段第一页。
    private anchorIndex(pages: FlatPage[], anchor: ReaderAnchor | null): number {
        if (anchor === null) {
            return 0;
        }

        let fallback: number = 0;

        for (let i: number = 0; i < pages.length; i++) {
            if (pages[i].chapterIndex !== anchor.chapterIndex) {
                continue;
            }

            fallback = i;

            const blocks: ReaderBlock[] = pages[i].page.blocks;

            if (anchor.completion && blocks.length === 0) {
                return i;
            }
            if (anchor.completion) {
                continue;
            }
            for (const block of blocks) {
                if (block.paragraphIndex > anchor.paragraphIndex ||
                    (block.paragraphIndex === anchor.paragraphIndex &&
                    (anchor.readStart < 0 || block.readEnd > anchor.readStart))) {
                    return i;
                }
            }
        }

        return fallback;
    }

    private captureAnchor(): ReaderAnchor | null {
        const item: FlatPage | undefined = this.currentPage();

        if (item === undefined) {
            return null;
        }

        const blocks: ReaderBlock[] = item.page.blocks;

        return {
            chapterIndex: item.chapterIndex,
            paragraphIndex: this.firstParagraph(item),
            readStart: blocks.length === 0 ? -1 : blocks[0].readStart,
            completion: blocks.length === 0,
        };
    }

    private currentPage(): FlatPage | undefined {
        if (this.pages.length === 0) {
            return undefined;
        }

        const index: number = this.currentIndex < 0
            ? 0
            : (this.currentIndex >= this.pages.length ? this.pages.length - 1 : this.currentIndex);

        return this.pages[index];
    }

    // ---------- 交互 ----------
    private onBandResize(area: Area): void {
        const width: number = area.width as number;
        const height: number = area.height as number;

        if (width === this.bandWidth && height === this.bandHeight) {
            return;
        }

        this.bandWidth = width;
        this.bandHeight = height;
        this.layoutWidth = width - PAGE_MARGIN_H * 2;
        this.layoutHeight = height - PAGE_PADDING_V * 2;

        if (this.order.length > 0) {
            this.rebuild(this.captureAnchor());
        }
    }

    private onPageChanged(index: number): void {
        if (this.disposed || this.rebuilding || this.opening || index < 0 || index >= this.pages.length) {
            return;
        }
        this.currentIndex = index;

        const item: FlatPage | undefined = this.currentPage();

        if (item === undefined) {
            return;
        }
        this.enterCurrentPage();

        if (index >= this.pages.length - PRELOAD_AHEAD) {
            this.preloadNext();
        }

        if (index <= 1) {
            this.prependPrev();
        }

    }

    // 阅读位置持久化：内存即时生效，落盘失败不影响当前阅读
    private persistPosition(chapterIndex: number): void {
        this.app.saveReadPosition(this.book.id, chapterIndex).then(() => {
        }).catch((err: Object) => {
            hilog.warn(DOMAIN, TAG, 'save position failed: %{public}s', JSON.stringify(err));
        });
    }

    // 点击分区：左 / 右翻页，中间切换沉浸界面
    private onCanvasTap(event: ClickEvent): void {
        if (this.bandWidth <= 0) {
            return;
        }

        const ratio: number = event.x / this.bandWidth;

        if (ratio < TAP_EDGE_RATIO) {
            this.turn(-1);
            return;
        }

        if (ratio > 1 - TAP_EDGE_RATIO) {
            this.turn(1);
            return;
        }

        this.chromeVisible = !this.chromeVisible;
    }

    private turn(step: number): void {
        const next: number = this.currentIndex + step;

        if (next < 0) {
            return;
        }

        if (next >= this.pages.length) {
            this.preloadNext();
            return;
        }

        this.swiper.changeIndex(next, true);
    }

    private jumpToChapter(chapterIndex: number): void {
        this.closeToc();
        this.initialAnchor = null;
        void this.openChapter(chapterIndex);
    }

    // 小节跳转：按标题文本在扁平页中定位（小节区间来自后端存在偏移，不能作为定位依据）
    private jumpToSection(chapterIndex: number, name: string): void {
        this.closeToc();

        for (let i: number = 0; i < this.pages.length; i++) {
            if (this.pages[i].chapterIndex !== chapterIndex) {
                continue;
            }

            const blocks: ReaderBlock[] = this.pages[i].page.blocks;

            for (let b: number = 0; b < blocks.length; b++) {
                if (blocks[b].kind === ReaderBlockKind.HEADING && blocks[b].text === name) {
                    this.swiper.changeIndex(i, false);
                    return;
                }
            }
        }

        hilog.warn(DOMAIN, TAG, 'section not located: %{public}s', name);
    }

    // 排版偏好变更后按锚点重排：偏好持久化与重排解耦，重排总是在偏好写入完成后进行
    private applyFontSize(step: number): void {
        const anchor: ReaderAnchor | null = this.captureAnchor();

        this.app.setReaderFontSize(this.app.readerFontSize + step).then(() => {
            this.rebuild(anchor);
        });
    }

    private applyLineSpacing(value: number): void {
        const anchor: ReaderAnchor | null = this.captureAnchor();

        this.app.setReaderLineSpacing(value).then(() => {
            this.rebuild(anchor);
        });
    }

    private applyTheme(name: string): void {
        const anchor: ReaderAnchor | null = this.captureAnchor();

        this.app.setReaderTheme(name).then(() => {
            this.rebuild(anchor);
        });
    }

    private palette(): ReaderPalette {
        return ReaderTheme.byName(this.app.readerTheme);
    }

    // ---------- 阅读证据 ----------
    private canRecordReading(): boolean {
        return !this.disposed && this.visible && this.navDepth === this.navLevel && this.appForeground &&
            LearningHttp.isCurrent(this.readingOwner) &&
            !this.opening && this.errorMessage.length === 0 && !this.tocOpen && !this.settingsOpen && !this.askOpen;
    }

    private onReadingIdentityChanged(): void {
        if (!this.initialized || this.disposed || LearningHttp.isCurrent(this.readingOwner)) {
            return;
        }
        // 旧内容与创建它的身份绑定；切账号/服务时停止旧会话，不能重绑给新身份。
        this.openSequence += 1;
        this.finishReadingSession();
        this.clearChapterQuestions();
        this.opening = false;
        this.errorMessage = '学习身份或服务已变更，请返回后重新打开教材';
    }

    private firstParagraph(item: FlatPage): number {
        if (item.page.blocks.length > 0) {
            return item.page.blocks[0].paragraphIndex;
        }
        const content: LearningChapterContent | undefined = this.contents.get(item.chapterIndex);
        return content === undefined || content.paragraphs.length === 0 ? 0 :
            content.paragraphs[content.paragraphs.length - 1].index;
    }

    private pageSignature(item: FlatPage): string {
        let key: string = String(item.chapterIndex);
        for (const block of item.page.blocks) {
            key += ':' + block.paragraphIndex + '/' + block.readStart + '-' + block.readEnd;
        }
        return key;
    }

    private pageReadRanges(item: FlatPage): number[][] {
        const content: LearningChapterContent | undefined = this.contents.get(item.chapterIndex);
        if (content === undefined || content.coordinateSpace !== 'plain') {
            return [];
        }
        const bounds: string[] = content.chapterRange.split(':');
        if (bounds.length !== 2) {
            return [];
        }
        const start: number = Number(bounds[0]);
        const length: number = Number(bounds[1]);
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0) {
            return [];
        }
        const end: number = start + length;
        const ranges: number[][] = [];
        for (const block of item.page.blocks) {
            // 后端可返回与章边界相交的完整段落，覆盖证据必须裁剪到本章。
            const left: number = Math.max(start, block.readStart);
            const right: number = Math.min(end, block.readEnd);
            if (Number.isSafeInteger(left) && Number.isSafeInteger(right) && right > left) {
                ranges.push([left, right]);
            }
        }
        return ranges;
    }

    private enterCurrentPage(): void {
        if (this.disposed || this.opening || this.rebuilding || this.errorMessage.length > 0 ||
            !LearningHttp.isCurrent(this.readingOwner)) {
            return;
        }
        const item: FlatPage | undefined = this.currentPage();
        if (item === undefined) {
            return;
        }
        if (item.chapterIndex !== this.savedChapter) {
            this.savedChapter = item.chapterIndex;
            this.persistPosition(item.chapterIndex);
        }

        if (this.sessionPoint !== null && this.sessionPoint.chapter_index !== item.chapterIndex) {
            this.finishReadingSession();
            this.clearChapterQuestions();
        }
        if (this.readingSession === null) {
            const content: LearningChapterContent | undefined = this.contents.get(item.chapterIndex);
            if (content === undefined || content.coordinateSpace !== 'plain' || content.chapterRange.length === 0) {
                return;
            }
            const point: ReadingCheckpoint = new ReadingCheckpoint(this.readingOwner);
            point.lecture_id = this.lectureId;
            point.book_id = this.book.id;
            point.chapter_index = item.chapterIndex;
            point.chapter_name = content.chapterTitle;
            point.chapter_range = content.chapterRange;
            point.coordinate_space = 'plain';
            point.started_at_ms = Date.now();
            point.session_id = 'read_' + point.started_at_ms.toString(36) + '_' + Math.random().toString(36).slice(2);
            this.sessionPoint = point;
            this.sessionPage = item;
            this.readingSession = new ReadingSession(point);
            this.readingFocused = this.canRecordReading();
            this.readingSession.enterPage(this.pageReadRanges(item), this.readingFocused, Date.now());
            if (this.readingFocused) {
                point.paragraph_index = this.firstParagraph(item);
                point.page_index = item.pageInChapter - 1;
                this.emitTelemetry(point, 'focus_in', { focus: 'reader' });
            }
        } else if (this.sessionPage === null || this.pageSignature(this.sessionPage) !== this.pageSignature(item)) {
            // 先把旧页停留计入旧页，再替换当前页；跨章时上面的分支已结束旧会话。
            this.checkpointReading();
            this.sessionPage = item;
            this.readingSession.enterPage(this.pageReadRanges(item), this.canRecordReading(), Date.now());
        } else {
            // 预载相邻章只改变全局下标，不重置当前页的两秒停留计时。
            this.sessionPage = item;
        }
        this.onReadingVisibilityChanged();
    }

    onReadingVisibilityChanged(): void {
        this.readerOverlayOpen = !this.disposed && (this.tocOpen || this.settingsOpen || this.askOpen);
        const focused: boolean = this.canRecordReading();
        if (this.readingSession !== null && focused !== this.readingFocused) {
            this.readingSession.setActive(focused, Date.now());
            this.readingFocused = focused;
            const point: ReadingCheckpoint | null = this.checkpointReading();
            if (point !== null) {
                this.emitTelemetry(point, focused ? 'focus_in' : 'focus_out', { focus: focused ? 'reader' : 'blur' });
            }
        }
        if (focused && this.readingSession !== null) {
            this.startHeartbeat();
        } else {
            this.stopHeartbeat();
        }
    }

    private startHeartbeat(): void {
        if (this.heartbeatId >= 0) {
            return;
        }
        this.heartbeatId = setInterval(() => {
            if (!this.canRecordReading()) {
                return;
            }
            const point: ReadingCheckpoint | null = this.checkpointReading();
            const page: FlatPage | null = this.sessionPage;
            if (point !== null && page !== null) {
                this.emitTelemetry(point, 'snapshot', { scroll: page.pageInChapter / page.pageCountInChapter });
            }
        }, READING_HEARTBEAT_MS);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatId >= 0) {
            clearInterval(this.heartbeatId);
            this.heartbeatId = -1;
        }
    }

    private checkpointReading(publish: boolean = true): ReadingCheckpoint | null {
        if (this.readingSession === null || this.sessionPage === null) {
            return null;
        }
        const point: ReadingCheckpoint = this.readingSession.snapshot(
            this.firstParagraph(this.sessionPage), this.sessionPage.pageInChapter - 1, Date.now());
        if (publish) {
            this.publishReading(point);
        }
        return point;
    }

    private publishReading(point: ReadingCheckpoint): void {
        if (this.readingContext === null || (point.active_duration_ms === 0 && point.read_ranges.length === 0)) {
            return;
        }
        LearningReadingApi.queueReadingProgress(this.readingContext, point).catch((err: Object) => {
            hilog.error(DOMAIN, TAG, 'reading checkpoint save failed: %{public}s', JSON.stringify(err));
        });
    }

    private emitTelemetry(point: ReadingCheckpoint, event: string, options: LearningReadingTelemetryOptions = {}): void {
        LearningReadingApi.postTelemetry(point, event, options).catch(() => {
            // 遥测是尽力发送，阅读证据另有持久化队列。
        });
    }

    private finishReadingSession(): void {
        this.stopHeartbeat();
        if (this.readingSession === null) {
            return;
        }
        this.readingSession.setActive(false, Date.now());
        const point: ReadingCheckpoint | null = this.checkpointReading();
        this.readingSession = null;
        this.sessionPoint = null;
        this.sessionPage = null;
        this.readingFocused = false;
        if (point !== null) {
            this.emitTelemetry(point, 'focus_out', { focus: 'blur' });
            this.emitTelemetry(point, 'session_complete');
        }
    }

    // ---------- 显式完成与复习闭环 ----------
    private async completeChapter(chapterIndex: number): Promise<void> {
        if (this.disposed || chapterIndex !== this.currentChapterIndex() ||
            this.completingChapters.indexOf(chapterIndex) >= 0) {
            return;
        }
        if (this.completedChapters.indexOf(chapterIndex) >= 0) {
            this.toast('这一章已经记为读完');
            return;
        }
        const point: ReadingCheckpoint | null = this.checkpointReading(false);
        if (point === null || this.readingContext === null) {
            this.toast('章节缺少有效阅读坐标，请重新加载');
            return;
        }
        const requestVersion: number = this.chapterRequestVersion;
        this.completingChapters = this.completingChapters.concat([chapterIndex]);
        try {
            const saved = await LearningReadingApi.saveReadingProgress(this.readingContext, point);
            if (!saved.saved) {
                if (!this.disposed && requestVersion === this.chapterRequestVersion) {
                    this.toast('阅读记录还未保存，请重试');
                }
                return;
            }
            const result = await LearningReadingApi.postChapterComplete(point);
            if (!result.ok) {
                if (!this.disposed && requestVersion === this.chapterRequestVersion) {
                    this.toast(result.message);
                }
                return;
            }
            const flowChapter: number = this.flowChapterIndex >= 0 ? this.flowChapterIndex : this.startChapterIndex;
            if (this.flowId.length > 0 && chapterIndex === flowChapter) {
                this.flowReadingConfirmed = true;
                this.flowCompletionPoint = point;
                // 点击后立即退出时，仍等待服务端确认再推进原流程。
                if (this.disposed) {
                    this.completeConfirmedFlow();
                }
            }
            if (!this.disposed) {
                this.completedChapters = this.completedChapters.concat([chapterIndex]);
                if (requestVersion === this.chapterRequestVersion) {
                    this.toast(result.alreadyCompleted ? '这一章已经记为读完' : '已记下这一章读完');
                }
            }
        } catch (err) {
            if (!this.disposed && requestVersion === this.chapterRequestVersion) {
                this.toast('暂时没能记录读完，请重试');
            }
            hilog.warn(DOMAIN, TAG, 'chapter completion failed: %{public}s', JSON.stringify(err));
        } finally {
            if (!this.disposed) {
                this.completingChapters = this.completingChapters.filter((index: number) => index !== chapterIndex);
            }
        }
    }

    private completeConfirmedFlow(): void {
        if (!this.flowReadingConfirmed || this.flowCompletionPoint === null || this.flowDoneStarted || this.flowId.length === 0) {
            return;
        }
        this.flowDoneStarted = true;
        LearningReadingApi.postReadingDone(this.flowId, this.flowCompletionPoint.owner).then((result) => {
            if (!result.ok) {
                this.flowDoneStarted = false;
                hilog.warn(DOMAIN, TAG, 'reading flow event failed: %{public}s', result.message);
            }
        }).catch((err: Object) => {
            this.flowDoneStarted = false;
            hilog.warn(DOMAIN, TAG, 'reading flow event failed: %{public}s', JSON.stringify(err));
        });
    }

    // ---------- 当前页问答 ----------
    private openAsk(): void {
        if (this.opening || this.currentPage() === undefined) {
            return;
        }
        this.askOpen = true;
        this.onReadingVisibilityChanged();
    }

    private closeAsk(): void {
        this.askOpen = false;
        this.onReadingVisibilityChanged();
    }

    private clearChapterQuestions(): void {
        this.chapterRequestVersion += 1;
        this.askOpen = false;
        this.askBusy = false;
        this.askError = '';
        this.questionText = '';
        this.askTurns = [];
    }

    private currentPageText(): string {
        const page: FlatPage | undefined = this.currentPage();
        if (page === undefined) {
            return '';
        }
        const paragraphs: string[] = [];
        for (const block of page.page.blocks) {
            if (block.kind !== ReaderBlockKind.IMAGE && block.text.trim().length > 0) {
                paragraphs.push(block.text);
            }
        }
        return paragraphs.join('\n');
    }

    private async submitQuestion(): Promise<void> {
        const question: string = this.questionText.trim();
        if (this.disposed || this.askBusy || question.length === 0) {
            return;
        }
        const point: ReadingCheckpoint | null = this.checkpointReading();
        if (point === null) {
            this.askError = '章节尚未就绪，请稍后重试';
            return;
        }
        const contextText: string = this.currentPageText();
        const requestVersion: number = this.chapterRequestVersion;
        this.askBusy = true;
        this.askError = '';
        this.emitTelemetry(point, 'ask', { selText: contextText });
        try {
            const result = await LearningReadingApi.askInContext(point, question, contextText);
            if (this.disposed || requestVersion !== this.chapterRequestVersion) {
                return;
            }
            if (!result.ok) {
                this.askError = result.message;
                return;
            }
            this.askTurns = this.askTurns.concat([{ question: question, answer: result.answer }]);
            this.questionText = '';
        } catch (err) {
            if (!this.disposed && requestVersion === this.chapterRequestVersion) {
                this.askError = '回答暂时不可用，请重试';
            }
        } finally {
            if (!this.disposed && requestVersion === this.chapterRequestVersion) {
                this.askBusy = false;
            }
        }
    }

    private toast(message: string): void {
        promptAction.showToast({ message: message, duration: 2200 });
    }

    // ---------- 视图 ----------
    build() {
        Stack() {
            // 纸张底色层：窗口是沉浸式布局，本层直接铺到物理屏底，夜间纸张不会在底部露出窗口底色
            Column()
                .width('100%')
                .height('100%')
                .backgroundColor(this.palette().page);

            Column() {
                this.Header()

                Column() {
                    if (this.errorMessage.length > 0) {
                        Placeholder({
                            icon: $r('app.media.ic_error'),
                            title: '章节打开失败',
                            hint: this.errorMessage,
                            actionLabel: '重新加载',
                            iconColor: this.palette().secondary,
                            titleColor: this.palette().text,
                            hintColor: this.palette().secondary,
                            actionBg: this.palette().sunken,
                            actionFg: this.palette().brand,
                            onAction: () => {
                                this.openStartChapter();
                            }
                        })
                    } else if (this.opening || this.pages.length === 0) {
                        LoadingBlock({ label: '正在排版' })
                    } else {
                        Swiper(this.swiper) {
                            LazyForEach(this.pageSource, (item: FlatPage) => {
                                this.PageCanvas(item)
                            }, (item: FlatPage) => item.key)
                        }
                        .index(this.currentIndex)
                        .loop(false)
                        .indicator(false)
                        .cachedCount(1)
                        .duration(Motion.durationBase)
                        .curve(Motion.easeInOut)
                        .width('100%')
                        .height('100%')
                        .onChange((index: number) => {
                            this.onPageChanged(index);
                        })
                        .onClick((event: ClickEvent) => {
                            this.onCanvasTap(event);
                        })
                    }
                }
                .layoutWeight(1)
                .width('100%')
                .onAreaChange((oldValue: Area, newValue: Area) => {
                    this.onBandResize(newValue);
                })

                this.Footer()
            }
            .width('100%')
            .height('100%')

            // 浮层常驻挂载，靠 translate / opacity 控制显隐（条件挂载不会播放退场动画）
            this.TocLayer()

            this.SettingsLayer()

            this.AskLayer()
        }
        .width('100%')
        .height('100%')
        .backgroundColor(this.palette().page);
    }

    // 页眉 / 页脚常驻挂载，靠位移与透明度播放呼入呼出：
    // 条件挂载会让整条栏瞬间消失（没有退场动画），且退出沉浸后位置会空跳一下
    @Builder
    Header() {
        Row() {
            IconButton({
                icon: $r('app.media.ic_back'),
                iconSize: Size.icon,
                buttonSize: CONTROL_SIZE,
                tint: this.palette().secondary,
                pressedBg: this.palette().divider,
                onTap: () => {
                    const item: FlatPage | undefined = this.currentPage();

                    this.onBack(item === undefined ? this.startChapterIndex : item.chapterIndex);
                }
            })

            Text(this.book.title)
                .fontSize(FontSize.small)
                .fontColor(this.palette().secondary)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1)
                .margin({ left: Space.sm });

            Button('问 AI', { type: ButtonType.Normal })
                .fontSize(FontSize.small)
                .fontColor(this.palette().brand)
                .backgroundColor(Color.Transparent)
                .height(CONTROL_SIZE)
                .padding({ left: Space.sm, right: Space.sm })
                .enabled(!this.opening && this.pages.length > 0)
                .id('learning_reader_ask')
                .onClick(() => {
                    this.openAsk();
                });

            IconButton({
                icon: $r('app.media.ic_list'),
                iconSize: Size.icon,
                buttonSize: CONTROL_SIZE,
                tint: this.palette().secondary,
                pressedBg: this.palette().divider,
                onTap: () => {
                    this.openToc();
                }
            })

            Text('Aa')
                .fontSize(FontSize.body)
                .fontColor(this.palette().secondary)
                .width(CONTROL_SIZE)
                .height(CONTROL_SIZE)
                .textAlign(TextAlign.Center)
                .onClick(() => {
                    this.openSettings();
                });
        }
        .width('100%')
        .height(HEADER_BAND)
        .padding({ left: Space.sm, right: Space.sm })
        .alignItems(VerticalAlign.Center)
        .translate({ y: this.chromeVisible ? 0 : -HEADER_BAND })
        .opacity(this.chromeVisible ? 1 : 0)
        // 收起后不能继续吃掉翻页点击：位移出视口只是看不见，命中测试仍在原位
        .hitTestBehavior(this.chromeVisible ? HitTestMode.Default : HitTestMode.Transparent)
        .animation({ duration: Motion.durationBase, curve: Motion.easeOut });
    }

    @Builder
    Footer() {
        Column() {
            Row() {
                Text(this.footerSection())
                    .fontSize(FontSize.caption)
                    .fontColor(this.palette().secondary)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .layoutWeight(1);

                Text(this.footerPageLabel())
                    .fontSize(FontSize.caption)
                    .fontColor(this.palette().secondary);
            }
            .width('100%')
            .height(FOOTER_BAND - 6)
            .padding({ left: PAGE_MARGIN_H, right: PAGE_MARGIN_H })
            .alignItems(VerticalAlign.Center);

            ProgressTrack({
                ratio: this.footerProgress(),
                trackHeight: 2,
                tint: this.palette().brand,
                trackColor: this.palette().divider,
            })
        }
        .width('100%')
        .height(FOOTER_BAND)
        .translate({ y: this.chromeVisible ? 0 : FOOTER_BAND })
        .opacity(this.chromeVisible ? 1 : 0)
        // 收起后让点击落到正文：否则页脚位置仍是死区，中部点击切不回功能栏
        .hitTestBehavior(this.chromeVisible ? HitTestMode.Default : HitTestMode.Transparent)
        .animation({ duration: Motion.durationBase, curve: Motion.easeOut });
    }

    private footerSection(): string {
        const item: FlatPage | undefined = this.currentPage();

        return item === undefined ? '' : item.page.sectionTitle;
    }

    private footerPageLabel(): string {
        const item: FlatPage | undefined = this.currentPage();

        if (item === undefined) {
            return '';
        }

        return item.pageInChapter + ' / ' + item.pageCountInChapter;
    }

    private footerProgress(): number {
        const item: FlatPage | undefined = this.currentPage();

        return item === undefined ? 0 : item.bookProgress;
    }

    // 一页正文：块的间距与高度直接来自排版引擎，渲染层不参与度量
    @Builder
    PageCanvas(item: FlatPage) {
        Column() {
            ForEach(item.page.blocks, (block: ReaderBlock) => {
                this.Block(block)
            }, (block: ReaderBlock, index: number) => block.paragraphIndex + '#' + index)

            if (item.pageInChapter === item.pageCountInChapter) {
                this.CompletionCard(item)
            }
        }
        .width('100%')
        .height('100%')
        .padding({
            left: PAGE_MARGIN_H,
            right: PAGE_MARGIN_H,
            top: PAGE_PADDING_V,
            bottom: PAGE_PADDING_V,
        })
        .alignItems(HorizontalAlign.Start);
    }

    @Builder
    CompletionCard(item: FlatPage) {
        Column({ space: Space.sm }) {
            Button(this.completingChapters.indexOf(item.chapterIndex) >= 0 ? '正在记录…' :
                (this.completedChapters.indexOf(item.chapterIndex) >= 0 ? '已记为读完' : '读完这一章'),
                { type: ButtonType.Normal })
                .width('100%')
                .height(40)
                .fontSize(FontSize.body)
                .fontColor(this.palette().onBrand)
                .backgroundColor(this.palette().brand)
                .borderRadius(Radius.md)
                .enabled(this.completingChapters.indexOf(item.chapterIndex) < 0)
                .id('learning_complete_' + item.chapterIndex)
                .hitTestBehavior(HitTestMode.Block)
                .onClick(() => {
                    void this.completeChapter(item.chapterIndex);
                });

            Text('确认读完后，AI 会据此安排后续学习')
                .fontSize(FontSize.caption)
                .fontColor(this.palette().secondary)
                .maxLines(2)
                .width('100%')
                .textAlign(TextAlign.Center);
        }
        .width('100%')
        .height(COMPLETE_CARD_HEIGHT)
        .padding(Space.sm)
        .margin({ top: COMPLETE_CARD_GAP })
        .borderRadius(Radius.lg)
        .backgroundColor(this.palette().sunken);
    }

    @Builder
    AskLayer() {
        Stack({ alignContent: Alignment.Bottom }) {
            Column()
                .width('100%')
                .height('100%')
                .backgroundColor($r('app.color.mask'))
                .opacity(this.askOpen ? 1 : 0)
                .hitTestBehavior(this.askOpen ? HitTestMode.Default : HitTestMode.None)
                .onClick(() => {
                    this.closeAsk();
                });

            Column({ space: Space.md }) {
                Row() {
                    Text('问 AI')
                        .fontSize(FontSize.title)
                        .fontWeight(FontWeight.Medium)
                        .fontColor($r('app.color.text_primary'))
                        .layoutWeight(1);
                    IconButton({
                        icon: $r('app.media.ic_close'),
                        iconSize: Size.icon,
                        buttonSize: CONTROL_SIZE,
                        onTap: () => { this.closeAsk(); }
                    })
                }
                .width('100%');

                Scroll() {
                    Column({ space: Space.lg }) {
                        if (this.askTurns.length === 0) {
                            Text('围绕当前页提问，回答会结合教材内容。')
                                .fontSize(FontSize.body)
                                .fontColor($r('app.color.text_secondary'))
                                .width('100%');
                        }
                        ForEach(this.askTurns, (turn: ReaderAskTurn) => {
                            Column({ space: Space.sm }) {
                                Text(turn.question)
                                    .fontSize(FontSize.body)
                                    .fontWeight(FontWeight.Medium)
                                    .fontColor($r('app.color.text_primary'))
                                    .width('100%');
                                MarkdownView({ source: turn.answer })
                            }
                            .width('100%');
                        }, (turn: ReaderAskTurn, index: number) => String(index));
                        if (this.askBusy) {
                            LoadingBlock({ label: '正在思考' })
                        }
                        if (this.askError.length > 0) {
                            Text(this.askError)
                                .fontSize(FontSize.small)
                                .fontColor($r('app.color.text_secondary'))
                                .width('100%');
                        }
                    }
                    .width('100%')
                    .alignItems(HorizontalAlign.Start);
                }
                .layoutWeight(1)
                .width('100%');

                Row({ space: Space.sm }) {
                    TextInput({ text: this.questionText, placeholder: '输入你的问题' })
                        .layoutWeight(1)
                        .maxLength(2000)
                        .enterKeyType(EnterKeyType.Send)
                        .id('learning_reader_question')
                        .onChange((value: string) => { this.questionText = value; })
                        .onSubmit(() => { void this.submitQuestion(); });
                    Button('发送')
                        .enabled(!this.askBusy && this.questionText.trim().length > 0)
                        .id('learning_reader_ask_send')
                        .onClick(() => { void this.submitQuestion(); });
                }
                .width('100%');
            }
            .width('100%')
            .height('56%')
            .padding({ left: Space.lg, right: Space.lg, top: Space.md, bottom: Space.md + this.insetBottom })
            .backgroundColor($r('app.color.bg_page'))
            .borderRadius({ topLeft: Radius.xl, topRight: Radius.xl })
            .translate({ y: this.askOpen ? '0%' : '100%' })
            .hitTestBehavior(this.askOpen ? HitTestMode.Default : HitTestMode.None)
            .animation({ duration: Motion.durationBase, curve: Motion.easeOut });
        }
        .width('100%')
        .height('100%')
        .hitTestBehavior(this.askOpen ? HitTestMode.Default : HitTestMode.None);
    }

    @Builder
    Block(block: ReaderBlock) {
        if (block.kind === ReaderBlockKind.IMAGE) {
            RemoteImage({
                source: LearningApi.shared.bookImageUrl(this.lectureId, this.book.id, block.imageId),
                frameWidth: this.layoutWidth,
                frameHeight: block.height,
                fit: ImageFit.Contain,
                corner: Radius.sm,
                onOpen: (path: string) => {
                    this.onOpenImage(path);
                }
            })
                .margin({ top: block.gap });
        } else {
            Text(block.text)
                .fontSize(block.fontSize)
                .lineHeight(block.lineHeight)
                .fontColor(this.palette().text)
                .fontWeight(block.kind === ReaderBlockKind.HEADING ? FontWeight.Medium : FontWeight.Normal)
                .width('100%')
                .margin({ top: block.gap });
        }
    }

    // ---------- 目录 ----------
    // 常驻挂载：遮罩淡入 + 抽屉由左滑入，关闭时反向回收
    @Builder
    TocLayer() {
        Stack({ alignContent: Alignment.TopStart }) {
            Column()
                .width('100%')
                .height('100%')
                .backgroundColor($r('app.color.mask'))
                .opacity(this.tocOpen ? 1 : 0)
                .hitTestBehavior(this.tocOpen ? HitTestMode.Default : HitTestMode.None)
                .animation({ duration: Motion.durationBase, curve: Motion.easeOut })
                .onClick(() => {
                    this.closeToc();
                });

            Column() {
                Row() {
                    Text('目录')
                        .fontSize(FontSize.title)
                        .fontWeight(FontWeight.Medium)
                        .fontColor(this.palette().text)
                        .layoutWeight(1);

                    IconButton({
                        icon: $r('app.media.ic_close'),
                        iconSize: Size.icon,
                        buttonSize: CONTROL_SIZE,
                        tint: this.palette().secondary,
                        pressedBg: this.palette().divider,
                        onTap: () => {
                            this.closeToc();
                        }
                    })
                }
                .width('100%')
                .padding({ left: Space.lg, right: Space.md, top: Space.lg })
                .alignItems(VerticalAlign.Center);

                this.TocBookHeader()

                Divider()
                    .strokeWidth(Size.divider)
                    .color(this.palette().divider);

                List({ scroller: this.tocScroller }) {
                    ForEach(this.chapters, (chapter: LearningChapterSummary) => {
                        ListItem() {
                            this.TocChapterRow(chapter)
                        }
                    }, (chapter: LearningChapterSummary) => 'toc_' + chapter.index)
                }
                .layoutWeight(1)
                .width('100%')
                .scrollBar(BarState.Off)
                .padding({ top: Space.sm, bottom: Space.xxl });
            }
            .width(TOC_WIDTH)
            .height('100%')
            .backgroundColor(this.palette().card)
            .borderRadius({ topRight: Radius.xl, bottomRight: Radius.xl })
            .shadow(Shadow.raised)
            .translate({ x: this.tocOpen ? '0%' : TOC_HIDDEN_X })
            .hitTestBehavior(this.tocOpen ? HitTestMode.Default : HitTestMode.None)
            .animation({ duration: Motion.durationBase, curve: Motion.easeInOut });
        }
        .width('100%')
        .height('100%')
        // 浮层常驻挂载时必须显式退出命中测试：全屏 Stack 默认参与触摸测试，
        // 即使内容不可见也会吃掉正文与顶栏的所有点击
        .hitTestBehavior(this.tocOpen ? HitTestMode.Default : HitTestMode.None);
    }

    // 目录头部：教材封面 + 教材简介，章节列表在其下。
    // 目录是「这本教材的目录」，先确认教材本体，再往下找章节，顺序才是对的。
    @Builder
    TocBookHeader() {
        Column({ space: Space.sm }) {
            Row({ space: Space.md }) {
                if (this.book.coverPath.length > 0) {
                    RemoteImage({
                        source: this.book.coverPath,
                        frameWidth: TOC_COVER_WIDTH,
                        frameHeight: TOC_COVER_HEIGHT,
                        fit: ImageFit.Cover,
                        corner: Radius.sm,
                        onOpen: (path: string) => {
                            this.onOpenImage(path);
                        }
                    })
                }

                Column({ space: Space.xxs }) {
                    Text(this.book.title)
                        .fontSize(FontSize.bodyLarge)
                        .fontWeight(FontWeight.Medium)
                        .fontColor(this.palette().text)
                        .maxLines(2)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                        .width('100%');

                    if (this.tocBookMeta().length > 0) {
                        Text(this.tocBookMeta())
                            .fontSize(FontSize.caption)
                            .fontColor(this.palette().secondary)
                            .maxLines(1)
                            .textOverflow({ overflow: TextOverflow.Ellipsis })
                            .width('100%');
                    }
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start);
            }
            .width('100%')
            .alignItems(VerticalAlign.Top);

            if (this.book.description.length > 0) {
                Column({ space: Space.xxs }) {
                    Text(this.book.description)
                        .fontSize(FontSize.small)
                        .fontColor(this.palette().secondary)
                        .lineHeight(20)
                        .maxLines(this.tocIntroExpanded ? TOC_INTRO_EXPANDED : TOC_INTRO_LINES)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                        .width('100%');

                    Text(this.tocIntroExpanded ? '收起' : '展开')
                        .fontSize(FontSize.caption)
                        .fontColor(this.palette().brand)
                        .onClick(() => {
                            this.tocIntroExpanded = !this.tocIntroExpanded;
                        });
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start);
            }
        }
        .width('100%')
        .padding({ left: Space.lg, right: Space.md, top: Space.md, bottom: Space.md })
        .alignItems(HorizontalAlign.Start);
    }

    // 教材规模：章数 > 插图数 > 正文字数，能拿到什么列什么
    private tocBookMeta(): string {
        const parts: string[] = [];

        if (this.chapters.length > 0) {
            parts.push(this.chapters.length + ' 章');
        }

        if (this.book.imagesCount > 0) {
            parts.push(this.book.imagesCount + ' 张插图');
        }

        if (this.book.textChars > 0) {
            parts.push(LearningFormat.chars(this.book.textChars));
        }

        return parts.join(' · ');
    }

    @Builder
    TocChapterRow(chapter: LearningChapterSummary) {
        Column() {
            Row({ space: Space.sm }) {
                // 当前章用品牌色标记条指出：只改文字颜色在长目录里不够醒目
                Row()
                    .width(3)
                    .height(16)
                    .borderRadius(Radius.xs)
                    .backgroundColor(this.isCurrentChapter(chapter.index)
                        ? this.palette().brand
                        : Color.Transparent);

                Text(chapter.title.length === 0 ? '第 ' + (chapter.index + 1) + ' 章' : chapter.title)
                    .fontSize(FontSize.body)
                    .fontColor(this.isCurrentChapter(chapter.index) ? this.palette().brand : this.palette().text)
                    .fontWeight(this.isCurrentChapter(chapter.index) ? FontWeight.Medium : FontWeight.Normal)
                    .layoutWeight(1)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis });
            }
            .width('100%')
            .padding({ left: Space.md, right: Space.lg, top: Space.md, bottom: Space.md })
            .alignItems(VerticalAlign.Center)
            .onClick(() => {
                this.jumpToChapter(chapter.index);
            });

            // 仅展开当前章的节列表：全展开会让目录长到无法使用
            if (this.isCurrentChapter(chapter.index)) {
                ForEach(chapter.sessions, (session: LearningSession) => {
                    Row({ space: Space.sm }) {
                        Row()
                            .width(4)
                            .height(4)
                            .borderRadius(Radius.full)
                            .backgroundColor(this.palette().divider);

                        Text(session.name)
                            .fontSize(FontSize.small)
                            .fontColor(this.palette().secondary)
                            .maxLines(1)
                            .textOverflow({ overflow: TextOverflow.Ellipsis })
                            .layoutWeight(1);
                    }
                    .width('100%')
                    .padding({ left: Space.xxl, right: Space.lg, top: Space.sm, bottom: Space.sm })
                    .alignItems(VerticalAlign.Center)
                    .onClick(() => {
                        this.jumpToSection(chapter.index, session.name);
                    })
                }, (session: LearningSession) => 'toc_s_' + chapter.index + '_' + session.index);
            }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start);
    }

    private isCurrentChapter(chapterIndex: number): boolean {
        return this.currentIndex >= 0 && this.currentChapterIndex() === chapterIndex;
    }

    // ---------- 排版设置 ----------
    // 常驻挂载：遮罩淡入 + 面板由底部滑入；面板自身延伸到手势线区域，底部不留异色边
    @Builder
    SettingsLayer() {
        Stack({ alignContent: Alignment.Bottom }) {
            Column()
                .width('100%')
                .height('100%')
                .backgroundColor($r('app.color.mask'))
                .opacity(this.settingsOpen ? 1 : 0)
                .hitTestBehavior(this.settingsOpen ? HitTestMode.Default : HitTestMode.None)
                .animation({ duration: Motion.durationBase, curve: Motion.easeOut })
                .onClick(() => {
                    this.closeSettings();
                });

            Column() {
                Row()
                    .width(36)
                    .height(4)
                    .borderRadius(Radius.xs)
                    .backgroundColor(this.palette().divider)
                    .margin({ top: Space.sm });

                Row() {
                    Text('排版')
                        .fontSize(FontSize.title)
                        .fontWeight(FontWeight.Medium)
                        .fontColor(this.palette().text)
                        .layoutWeight(1);

                    IconButton({
                        icon: $r('app.media.ic_close'),
                        iconSize: Size.icon,
                        buttonSize: CONTROL_SIZE,
                        tint: this.palette().secondary,
                        pressedBg: this.palette().divider,
                        onTap: () => {
                            this.closeSettings();
                        }
                    })
                }
                .width('100%')
                .padding({ left: Space.lg, right: Space.md, top: Space.sm })
                .alignItems(VerticalAlign.Center);

                this.FontSizeRow()

                this.SpacingRow()

                this.ThemeRow()
            }
            .width('100%')
            // 排版面板贴物理屏底，最后一排控件自己让开手势区
            .padding({ bottom: Space.xxl + this.insetBottom })
            .backgroundColor(this.palette().card)
            .borderRadius({ topLeft: Radius.xl, topRight: Radius.xl })
            .translate({ y: this.settingsOpen ? '0%' : '100%' })
            .hitTestBehavior(this.settingsOpen ? HitTestMode.Default : HitTestMode.None)
            .animation({ duration: Motion.durationBase, curve: Motion.easeInOut });
        }
        .width('100%')
        .height('100%')
        .hitTestBehavior(this.settingsOpen ? HitTestMode.Default : HitTestMode.None);
    }

    // 字号：减 / 当前值 / 加 三件套，两端是图标按钮
    @Builder
    FontSizeRow() {
        Row({ space: Space.sm }) {
            Text('字号')
                .fontSize(FontSize.body)
                .fontColor(this.palette().text);

            Blank();

            IconButton({
                icon: $r('app.media.ic_minus'),
                iconSize: Size.icon,
                buttonSize: CONTROL_SIZE,
                tint: this.palette().text,
                bg: this.palette().sunken,
                pressedBg: this.palette().divider,
                onTap: () => {
                    this.applyFontSize(-1);
                }
            })

            Text(this.app.readerFontSize + '')
                .fontSize(FontSize.body)
                .fontColor(this.palette().text)
                .width(40)
                .textAlign(TextAlign.Center);

            IconButton({
                icon: $r('app.media.ic_plus'),
                iconSize: Size.icon,
                buttonSize: CONTROL_SIZE,
                tint: this.palette().text,
                bg: this.palette().sunken,
                pressedBg: this.palette().divider,
                onTap: () => {
                    this.applyFontSize(1);
                }
            })
        }
        .width('100%')
        .padding({ left: Space.lg, right: Space.lg, top: Space.lg })
        .alignItems(VerticalAlign.Center);
    }

    // 行距：分段控件，选中项为实心品牌底
    @Builder
    SpacingRow() {
        Row() {
            Text('行距')
                .fontSize(FontSize.body)
                .fontColor(this.palette().text);

            Blank();

            Row() {
                ForEach(SPACING_OPTIONS, (option: SpacingOption) => {
                    Text(option.label)
                        .fontSize(FontSize.small)
                        .fontColor(this.app.readerLineSpacing === option.value
                            ? this.palette().onBrand
                            : this.palette().secondary)
                        .backgroundColor(this.app.readerLineSpacing === option.value
                            ? this.palette().brand
                            : Color.Transparent)
                        .padding({ left: Space.md, right: Space.md, top: Space.xs, bottom: Space.xs })
                        .borderRadius(Radius.full)
                        .onClick(() => {
                            this.applyLineSpacing(option.value);
                        })
                }, (option: SpacingOption) => 'sp_' + option.value);
            }
            .padding(Space.xxs)
            .borderRadius(Radius.full)
            .backgroundColor(this.palette().sunken);
        }
        .width('100%')
        .padding({ left: Space.lg, right: Space.lg, top: Space.lg })
        .alignItems(VerticalAlign.Center);
    }

    // 背景主题：直接给色卡，比只写文字标签更容易预期效果
    @Builder
    ThemeRow() {
        Row() {
            Text('背景')
                .fontSize(FontSize.body)
                .fontColor(this.palette().text);

            Blank();

            Row({ space: Space.lg }) {
                ForEach(THEME_OPTIONS, (option: ThemeOption) => {
                    this.ThemeSwatch(option)
                }, (option: ThemeOption) => 'th_' + option.name);
            }
        }
        .width('100%')
        .padding({ left: Space.lg, right: Space.lg, top: Space.lg, bottom: Space.md })
        .alignItems(VerticalAlign.Center);
    }

    @Builder
    ThemeSwatch(option: ThemeOption) {
        Column({ space: Space.xs }) {
            Row()
                .width(30)
                .height(30)
                .borderRadius(Radius.full)
                .backgroundColor(ReaderTheme.byName(option.name).page)
                .border({
                    width: this.app.readerTheme === option.name ? 2 : 1,
                    color: this.app.readerTheme === option.name
                        ? this.palette().brand
                        : this.palette().divider,
                });

            Text(option.label)
                .fontSize(FontSize.micro)
                .fontColor(this.app.readerTheme === option.name
                    ? this.palette().brand
                    : this.palette().secondary);
        }
        .alignItems(HorizontalAlign.Center)
        .onClick(() => {
            this.applyTheme(option.name);
        });
    }
}
