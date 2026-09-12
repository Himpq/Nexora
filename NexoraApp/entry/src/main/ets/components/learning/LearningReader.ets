// LearningReader.ets - 教材阅读器（横向分页 + 连续阅读）
// 交互对齐成熟阅读器：左右滑动翻页（跟手 + 缓出动画）、点击左右区域翻页、点击中部切换沉浸界面、
// 页眉显示书名与目录/排版入口，页脚显示所属小节、本章页码与全书进度条。
//
// 关键设计：
//  1. 分页高度来自真实文本测量（MeasureUtils），字号 / 行距变化后按「当前页首段」锚点重排，不跳读；
//  2. 页面用 LazyForEach 挂载并只缓存相邻一页，插图随页面出现才下载，避免整章一次拉满图片；
//  3. 读到章末自动续载下一章、读到章首自动补载上一章，阅读不被章节边界打断。

import { hilog } from '@kit.PerformanceAnalysisKit';
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

export interface ReaderAnchor {
    chapterIndex: number;
    paragraphIndex: number;
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
    // 本层在宿主导航中的层级：消费返回请求后把 navDepth 复位，避免宿主误判为退出本层
    @Prop navLevel: number = 0;
    @Link navDepth: number;
    // 浮层展开标记与返回请求令牌：由宿主统一编排返回键，阅读器只负责响应
    @Link readerOverlayOpen: boolean;
    @Link @Watch('onBackRequested') readerBackToken: number;
    onBack: (chapterIndex: number) => void = () => {};
    onOpenImage: (url: string) => void = () => {};

    // 沉浸式布局下贴底浮层自己让开手势区
    @StorageProp('insetBottom') private insetBottom: number = 0;

    @State private pages: FlatPage[] = [];
    @State private currentIndex: number = 0;
    @State private chromeVisible: boolean = true;
    @State private settingsOpen: boolean = false;
    @State private tocOpen: boolean = false;
    @State private tocIntroExpanded: boolean = false;
    @State private opening: boolean = true;
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
    // 正在请求中的章号（-1 表示空闲），避免预载重复发起
    private fetching: number = -1;
    // 上次写入持久化的章号
    private savedChapter: number = -1;

    // 文本测量：输入按 vp，测量结果按 px 返回，换算回 vp 后参与排版
    private measure: ReaderMeasureText = (text: string, fontSize: number, lineHeight: number, width: number): number => {
        const size: SizeOptions = this.getUIContext().getMeasureUtils().measureTextSize({
            textContent: text,
            fontSize: fontSize,
            constraintWidth: width,
            lineHeight: lineHeight,
        });
        // 返回值宽度与高度按 px 下发的（字段声明为 Length，实际为 number），换算成 vp 后参与排版
        const height: Length | undefined = size.height;

        return typeof height === 'number' ? px2vp(height) : 0;
    };

    aboutToAppear(): void {
        this.openStartChapter();
    }

    private openStartChapter(): void {
        const start: number = this.startChapterIndex < 0 ? 0 : this.startChapterIndex;

        this.openChapter(start).then(() => {
        });
    }

    // 宿主转来的返回请求：优先关闭浮层，浮层全关时把 navDepth 复位（宿主随后按层级回退）
    onBackRequested(): void {
        if (this.closeOverlay()) {
            return;
        }

        this.navDepth = this.navLevel;
    }

    private closeOverlay(): boolean {
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
        this.readerOverlayOpen = true;

        const row: number = this.currentTocRow();

        if (row >= 0) {
            // 等抽屉滑入完成再滚动，避免滚动发生在动画中途肉眼看不出定位
            setTimeout(() => {
                this.tocScroller.scrollToIndex(row, true);
            }, Motion.durationBase);
        }
    }

    private closeToc(): void {
        this.tocOpen = false;
        this.readerOverlayOpen = false;
    }

    private openSettings(): void {
        this.settingsOpen = true;
        this.readerOverlayOpen = true;
    }

    private closeSettings(): void {
        this.settingsOpen = false;
        this.readerOverlayOpen = false;
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
        this.opening = true;
        this.errorMessage = '';
        this.contents.clear();
        this.order = [];

        const fetched: ChapterFetch = await this.fetchChapter(chapterIndex);

        this.opening = false;

        if (!fetched.ok) {
            this.errorMessage = fetched.message;
            return;
        }

        this.rebuild(null);
        this.preloadNext();
    }

    private async fetchChapter(chapterIndex: number): Promise<ChapterFetch> {
        if (chapterIndex < 0 || chapterIndex >= this.chapters.length) {
            return { ok: false, message: '章节超出范围' };
        }

        if (this.contents.has(chapterIndex)) {
            return { ok: true, message: '' };
        }

        const result = await LearningApi.shared.getBookChapter(this.lectureId, this.book.id, chapterIndex);

        if (!result.success || result.content === null) {
            return { ok: false, message: result.message };
        }

        this.contents.set(chapterIndex, result.content);
        this.order.push(chapterIndex);
        this.order.sort((left: number, right: number) => left - right);

        return { ok: true, message: '' };
    }

    // 预载下一章：读到接近书末时补链，翻页不中断
    private preloadNext(): void {
        if (this.order.length === 0) {
            return;
        }

        const last: number = this.order[this.order.length - 1];
        const next: number = last + 1;

        if (next >= this.chapters.length || this.contents.has(next) || this.fetching === next) {
            return;
        }

        this.fetching = next;
        this.fetchChapter(next).then((fetched: ChapterFetch) => {
            this.fetching = -1;

            if (!fetched.ok) {
                hilog.warn(DOMAIN, TAG, 'preload next chapter failed: %{public}s', fetched.message);
                return;
            }

            this.rebuild(this.captureAnchor());
        });
    }

    // 补载上一章：回到本章首页时向书首延伸
    private prependPrev(): void {
        if (this.order.length === 0) {
            return;
        }

        const previous: number = this.order[0] - 1;

        if (previous < 0 || this.contents.has(previous) || this.fetching === previous) {
            return;
        }

        this.fetching = previous;
        this.fetchChapter(previous).then((fetched: ChapterFetch) => {
            this.fetching = -1;

            if (!fetched.ok) {
                hilog.warn(DOMAIN, TAG, 'preload previous chapter failed: %{public}s', fetched.message);
                return;
            }

            // 锚点按「章 + 段」定位，前置新章后当前页自然后移，读者不会看到跳变
            this.rebuild(this.captureAnchor());
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
        if (this.layoutWidth <= 0 || this.layoutHeight <= 0) {
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

            const chapterPages: ReaderPage[] = ReaderPaginator.paginate(content.paragraphs, layout, this.measure);
            const progress: number = content.bookTotalChars <= 0
                ? 0
                : content.chapterStart / content.bookTotalChars;

            for (let p: number = 0; p < chapterPages.length; p++) {
                pages.push({
                    key: chapterIndex + '_' + p,
                    chapterIndex: chapterIndex,
                    chapterTitle: content.chapterTitle,
                    pageInChapter: p + 1,
                    pageCountInChapter: chapterPages.length,
                    bookProgress: progress,
                    page: chapterPages[p],
                });
            }
        }

        this.pages = pages;
        this.pageSource.replace(pages);

        const target: number = this.anchorIndex(pages, anchor);

        this.currentIndex = target;
        this.swiper.changeIndex(target, false);
    }

    // 锚点定位：同章内找首个「起始段落不早于锚点」的页；找不到则退回该章最后一页
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

            if (FlatPageSource === null) {
                continue;
            }

            const blocks: ReaderBlock[] = pages[i].page.blocks;

            if (blocks.length === 0) {
                return i;
            }

            if (blocks[0].paragraphIndex >= anchor.paragraphIndex) {
                return i;
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
            paragraphIndex: blocks.length === 0 ? 0 : blocks[0].paragraphIndex,
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
        this.currentIndex = index;

        const item: FlatPage | undefined = this.currentPage();

        if (item === undefined) {
            return;
        }

        if (index >= this.pages.length - PRELOAD_AHEAD) {
            this.preloadNext();
        }

        if (index <= 1) {
            this.prependPrev();
        }

        if (item.chapterIndex !== this.savedChapter) {
            this.savedChapter = item.chapterIndex;
            this.persistPosition(item.chapterIndex);
        }
    }

    // 阅读位置持久化：内存即时生效，落盘失败不影响当前阅读
    private persistPosition(chapterIndex: number): void {
        this.app.saveReadPosition(this.book.id, chapterIndex).then(() => {
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
        this.savedChapter = chapterIndex;
        this.persistPosition(chapterIndex);
        this.openChapter(chapterIndex).then(() => {
        });
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
