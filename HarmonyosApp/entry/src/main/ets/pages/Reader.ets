/**
 * §6.4 阅读器（沉浸面）—— 翻页式书页。
 *
 * 交互对齐主流阅读 App（番茄小说式）：
 *   · 章节按屏幕实际尺寸分页（MeasureText 精确排版），左右滑动或点击左右屏翻页，点击中间呼出操作面板；
 *   · 章末再翻 → 自动记「读完这一章」并进入下一章（课程进度由 chapter_completed 记录驱动）；
 *   · 点击左 30% 上一页、右 30% 下一页、中间呼出操作面板（覆盖整页热区，不让正文 Text 吞掉点击）；
 *   · 长按选字 → 系统手柄 + 自绘浮动工具栏（问AI / 复制 / 朗读 / 划线 / 分享 / 查询），点划线后工具栏展开样式行
 *     （直线 / 波浪 / 荧光笔 + 四色），选中已划线的句子时显示「删除划线」；点工具栏以外任何地方选区与工具栏一起消失；
 *   · 划线按字范围持久化，同一段可多次划不同句，可改样式/颜色或删除；
 *   · 阅读状态（纸色主题 / 字号 / 章节 / 页）本地持久化，「继续学习」回到上次读到的那一页；
 *   · 原右缘 AI 浮球并入操作面板；AI 问答走底部 sheet（宽屏变右栏）。
 * 事件上报：selection / ask / snapshot / focus_in / focus_out / session_complete（§4.3 信号源）。
 */
import { router, window, KeyboardAvoidMode } from '@kit.ArkUI';
import { MeasureText } from '@kit.ArkUI';
import { text as graphicsText } from '@kit.ArkGraphics2D';
import { batteryInfo, pasteboard } from '@kit.BasicServicesKit';
import { common } from '@kit.AbilityKit';
import { uniformTypeDescriptor } from '@kit.ArkData';
import { systemShare } from '@kit.ShareKit';
import {
  ChapterPayload,
  ChapterParagraph,
  ChapterMeta,
  ReaderApi,
  TelemetryEvent,
} from '../services/ReaderApi';
import {
  AgentApi,
  AgentEnvelope,
  LearnTarget,
  ContextData,
  AskAnswer,
} from '../services/AgentApi';
import { TimelineEntryView } from '../components/entry/TimelineEntryView';
import { TimelineEntry, CitationCard } from '../models/Index';
import { SkeletonCard, ErrorState } from '../components/common/States';
import { sharedTts } from '../capability/tts';
import { sharedLiveView } from '../capability/liveview';
import { sharedCache } from '../services/cache/CacheStore';
import {
  ReadingPosition,
  ReadingCheckpoint,
  ReadingSession,
  nxReadPosition,
  nxSavePosition,
  nxReadingScope,
  nxCodePointLength,
} from '../services/ReadingState';
import {
  nxPalette,
  NxPalette,
  NxRadius,
  NxGrid,
  NxFontSize,
  NxFontFamily,
  NxShadow,
  NxReaderTheme,
  NxReaderThemes,
  nxReaderTheme,
  NxMarkSwatch,
  NxMarkSwatches,
  nxMarkSwatch,
} from '../theme/DesignTokens';
import { nxApplySystemBars } from '../theme/SystemBars';
import { BusinessError } from '@kit.BasicServicesKit';

/** 一页里的一个块：段落的一部分（长段跨页时拆分）或一张图。 */
class PageBlock {
  key: string = '';
  paraIndex: number = 0;
  text: string = '';
  isImage: boolean = false;
  imageUrl: string = '';
  heading: number = 0;
  /** 该块在段落 trim 后正文里的起点。 */
  paraOffset: number = 0;
  /** 后端 plain 正文的 Unicode 码点坐标，独立于 UI 的 UTF-16 字符偏移。 */
  readStart: number = 0;
  readEnd: number = 0;
  /** 块顶相对页面内容区的偏移（vp）与块高（vp），用于定位浮动菜单。 */
  top: number = 0;
  height: number = 0;
}

class ReaderMark {
  paraIndex: number = 0;
  start: number = 0;
  end: number = 0;
  /** solid | wavy | mark */
  style: string = 'solid';
  /** yellow | green | blue | pink */
  color: string = 'yellow';
}

/** 从标记集合里减去 [start,end)：完全覆盖的删掉，部分重叠的裁成两侧剩余段。 */
export function nxSubtractMarks(marks: ReaderMark[], paraIndex: number, start: number, end: number): ReaderMark[] {
  const next: ReaderMark[] = [];
  for (const mark of marks) {
    if (mark.paraIndex !== paraIndex || mark.end <= start || mark.start >= end) {
      next.push(mark);
      continue;
    }
    if (mark.start < start) {
      const left = new ReaderMark();
      left.paraIndex = mark.paraIndex;
      left.start = mark.start;
      left.end = start;
      left.style = mark.style;
      left.color = mark.color;
      next.push(left);
    }
    if (mark.end > end) {
      const right = new ReaderMark();
      right.paraIndex = mark.paraIndex;
      right.start = end;
      right.end = mark.end;
      right.style = mark.style;
      right.color = mark.color;
      next.push(right);
    }
  }
  return next;
}

/** 相邻且样式、颜色相同的标记合并成一段，避免一次改色后留下三段碎片。 */
export function nxMergeAdjacentMarks(marks: ReaderMark[]): ReaderMark[] {
  const sorted: ReaderMark[] = marks.slice().sort((a: ReaderMark, b: ReaderMark): number =>
    a.paraIndex !== b.paraIndex ? a.paraIndex - b.paraIndex : a.start - b.start);
  const merged: ReaderMark[] = [];
  for (const mark of sorted) {
    const last: ReaderMark | undefined = merged.length > 0 ? merged[merged.length - 1] : undefined;
    if (last !== undefined && last.paraIndex === mark.paraIndex && last.end === mark.start &&
      last.style === mark.style && last.color === mark.color) {
      last.end = mark.end;
      continue;
    }
    const copy = new ReaderMark();
    copy.paraIndex = mark.paraIndex;
    copy.start = mark.start;
    copy.end = mark.end;
    copy.style = mark.style;
    copy.color = mark.color;
    merged.push(copy);
  }
  return merged;
}

class MarkSpan {
  key: string = '';
  text: string = '';
  style: string = '';
  color: string = '';
}

class ReaderPage {
  key: string = '';
  index: number = 0;
  firstPara: number = 0;
  blocks: PageBlock[] = [];
}

const READER_FONT_SIZES: number[] = [16, 18, 20, 23, 26];
const PAGE_PADDING_X: number = 22;
const PAGE_PADDING_TOP: number = 42;
const PAGE_PADDING_BOTTOM: number = 28;
const PARA_GAP: number = 14;
const IMAGE_HEIGHT: number = 200;
const MENU_HEIGHT: number = 44;
/** 长按工具栏：主行 / 样式行高度、指向选区的小三角尺寸、三角尖端离选区（含手柄圆点）的距离、最大宽度。 */
const SEL_BAR_MAIN: number = 66;
const SEL_BAR_STYLE: number = 58;
const SEL_BAR_CARET: number = 8;
const SEL_BAR_GAP: number = 18;
const SEL_BAR_MAX_WIDTH: number = 480;
const SPLIT_PUNCT: string = '。！？；」”…\n.!?;';

@Entry
@Component
struct Reader {
  @State @Watch('onReadingVisibilityChanged') loading: boolean = false;
  @State errorText: string = '';
  @State chapterTitle: string = '';
  @State bookTitle: string = '';
  @State chapterIndex: number = 0;
  @State chapterCount: number = 0;
  @State chapterRange: string = '';
  @State paragraphs: ChapterParagraph[] = [];
  @State chapters: ChapterMeta[] = [];
  @State pages: ReaderPage[] = [];
  @State pageIndex: number = 0;
  @State marks: ReaderMark[] = [];
  @State selectedPara: number = -1;
  @State selStart: number = 0;
  @State selEnd: number = 0;
  @State selText: string = '';
  /** 选区在页面 Stack 坐标系里的上下沿，以及最上 / 最下一行选中部分的水平中心（vp），用于摆放浮动工具栏和小三角。 */
  @State selTop: number = 0;
  @State selBottom: number = 0;
  @State selFirstCx: number = 0;
  @State selLastCx: number = 0;
  @State flashPara: number = -1;
  @State clockText: string = '';
  @State batteryPct: number = -1;
  @State immersiveOk: boolean = false;
  @State askTurns: TimelineEntry[] = [];
  @State ttsPaused: boolean = false;
  @State fontIndex: number = 1;
  @State themeId: string = 'paper';
  @State @Watch('onReadingVisibilityChanged') panelOpen: boolean = false;
  @State @Watch('onReadingVisibilityChanged') showToc: boolean = false;
  @State @Watch('onReadingVisibilityChanged') showAskSheet: boolean = false;
  @State askText: string = '';
  @State asking: boolean = false;
  @State answerEntry: TimelineEntry | null = null;
  @State isWide: boolean = false;
  @State speaking: boolean = false;
  @State areaWidth: number = 0;
  @State areaHeight: number = 0;
  @State completedThisSession: boolean = false;
  @State marking: boolean = false;
  @State readingFeedback: string = '';
  @State markStyleOpen: boolean = false;
  @State pendingStyle: string = 'solid';
  @State pendingColor: string = 'yellow';
  @State snapPara: number = -1;
  @State snapStart: number = 0;
  @State snapEnd: number = 0;
  @State snapText: string = '';
  @State markEpoch: number = 0;
  /** 问答面板：接近底部时跟随新消息，用户上滑看旧回答时不强拉。 */
  @State askFollow: boolean = true;
  @State askKeyboardInset: number = 0;
  /** 点按放大的教材图片；空串表示未打开。 */
  @State zoomImageUrl: string = '';
  @State zoomScale: number = 1;
  @StorageProp('nxDarkMode') nxDark: boolean = false;
  private readerApi: ReaderApi = new ReaderApi();
  private agentApi: AgentApi = new AgentApi();
  private swiperController: SwiperController = new SwiperController();
  private askScroller: Scroller = new Scroller();
  /** 每个正文块一个 TextController：取选区矩形、编程清除选区。键 = 块 key（含章 / 字号 / 宽度前缀，跨分页唯一）。 */
  private textControllers: Map<string, TextController> = new Map<string, TextController>();
  private blockKeyPrefix: string = '';
  private selBlockKey: string = '';
  private lectureId: string = '';
  private bookId: string = '';
  private flowId: string = '';
  private flowChapterIndex: number = -1;
  private flowReadingConfirmed: boolean = false;
  private resumeRequested: boolean = false;
  private pendingPara: number = -1;
  private pendingParaOffset: number = 0;
  private readingSession: ReadingSession | null = null;
  private readingFocused: boolean = false;
  private readingCoordinateSpace: string = 'plain';
  private pageVisible: boolean = false;
  private disposed: boolean = false;
  private chapterRequestVersion: number = 0;
  private totalReadMs: number = 0;
  private heartbeatId: number = -1;
  private paginateId: number = -1;
  private chromeId: number = -1;
  private lastSelAt: number = 0;
  private hostWindow: window.Window | undefined = undefined;

  aboutToAppear(): void {
    this.disposed = false;
    const context = this.getUIContext().getHostContext();
    if (context !== undefined) {
      sharedCache.init(context);
      this.restoreReaderSettings();
    }
    const params = router.getParams() as Record<string, Object>;
    if (params !== undefined && params !== null) {
      this.lectureId = params.lecture_id !== undefined ? String(params.lecture_id) : '';
      this.bookId = params.book_id !== undefined ? String(params.book_id) : '';
      this.bookTitle = params.book_title !== undefined ? String(params.book_title) : '';
      this.chapterIndex = params.chapter_index !== undefined ? Number(params.chapter_index) : 0;
      if (params.flow_id !== undefined) {
        this.flowId = params.flow_id as string;
        this.flowChapterIndex = this.chapterIndex;
      }
      if (params.resume !== undefined) {
        this.resumeRequested = params.resume === true;
      }
      const chapterName: string = params.chapter_name !== undefined ? String(params.chapter_name) : '这一章';
      sharedLiveView.startStudy(chapterName, 15);
    }
    this.tickChrome();
    this.startChrome();
    this.applyImmersive(true);
    this.load();
  }

  onPageShow(): void {
    this.pageVisible = true;
    this.startChrome();
    this.applyImmersive(true);
    this.onReadingVisibilityChanged();
    this.startHeartbeat();
    this.readerApi.flushReadingProgress();
  }

  onPageHide(): void {
    this.pageVisible = false;
    this.onReadingVisibilityChanged();
    this.stopHeartbeat();
    this.stopChrome();
    this.savePosition();
  }

  private restoreReaderSettings(): void {
    const savedFont = Math.round(sharedCache.getNumber('nx_reader_font_index', this.fontIndex));
    if (savedFont >= 0 && savedFont < READER_FONT_SIZES.length) {
      this.fontIndex = savedFont;
    }
    const savedTheme = sharedCache.get('nx_reader_theme');
    if (savedTheme.length > 0) {
      this.themeId = nxReaderTheme(savedTheme).id;
    }
  }

  aboutToDisappear(): void {
    this.pageVisible = false;
    this.disposed = true;
    this.chapterRequestVersion++;
    this.stopHeartbeat();
    this.stopChrome();
    this.applyImmersive(false);
    if (this.paginateId >= 0) {
      clearTimeout(this.paginateId);
    }
    sharedTts.stop();
    this.savePosition();
    this.finishReadingSession();
    this.textControllers.clear();
    if (this.flowId.length > 0 && this.flowReadingConfirmed) {
      this.agentApi.postFlowEvent(this.flowId, 'reading_done').then((): void => {
        AppStorage.setOrCreate('nxStudyTick', Date.now());
      }).catch((err: Error): void => {
        // 阅读事实已经保存，出题失败不应伪造新的阅读完成记录。
      });
    }
    const durationText = this.totalReadMs < 60000 ? '读了不到 1 分钟' : '读了 ' + Math.round(this.totalReadMs / 60000) + ' 分钟';
    // 实况窗结束语按真实状态：读完才说读完（2026-09-21 审查 F15）。
    sharedLiveView.stopStudy(durationText + (this.flowReadingConfirmed ? ' · 接下来出题' : ''), this.completedThisSession);
    sharedTts.release();
  }

  private palette(): NxPalette {
    return nxPalette(this.theme().dark);
  }

  private theme(): NxReaderTheme {
    return nxReaderTheme(this.themeId);
  }

  private readerFontSize(): number {
    return READER_FONT_SIZES[this.fontIndex];
  }

  private pad2(value: number): string {
    return value < 10 ? '0' + value : String(value);
  }

  private tickChrome(): void {
    const now = new Date();
    this.clockText = this.pad2(now.getHours()) + ':' + this.pad2(now.getMinutes());
    try {
      const soc = batteryInfo.batterySOC;
      if (typeof soc === 'number' && soc >= 0) {
        this.batteryPct = Math.round(soc);
      }
    } catch (err) {
      this.batteryPct = -1;
    }
  }

  private startChrome(): void {
    this.stopChrome();
    this.chromeId = setInterval((): void => {
      this.tickChrome();
    }, 15000);
  }

  private stopChrome(): void {
    if (this.chromeId >= 0) {
      clearInterval(this.chromeId);
      this.chromeId = -1;
    }
  }

  private applyImmersive(enable: boolean): void {
    const host = this.getUIContext().getHostContext();
    if (host === undefined) {
      return;
    }
    window.getLastWindow(host as common.UIAbilityContext).then((win: window.Window) => {
      this.hostWindow = win;
      win.setWindowLayoutFullScreen(enable).catch((err: Error) => {
      });
      try {
        win.setSpecificSystemBarEnabled('status', !enable);
      } catch (err) {
        // 旧接口不支持隐藏状态栏时，纸色仍铺满
      }
      if (enable) {
        win.setWindowSystemBarProperties({
          statusBarColor: this.theme().bg,
          navigationBarColor: this.theme().bg,
          statusBarContentColor: this.theme().chromeInk,
          navigationBarContentColor: this.theme().chromeInk,
        }).catch((err: Error) => {
        });
      } else {
        // 离开阅读器：系统栏交还给 App 全局主题（2026-09-21 审查 P2-6：原先只在这里设过一次，
        // 回到主页面后状态栏仍是纸色 / 夜色）。
        nxApplySystemBars(win, this.nxDark);
      }
      this.immersiveOk = enable;
      AppStorage.setOrCreate('nxReaderImmersive', enable);
      // 阅读器自管键盘（问答面板按键盘高度上移）；离开时交还全局压缩避让。
      try {
        this.getUIContext().setKeyboardAvoidMode(enable ? KeyboardAvoidMode.NONE : KeyboardAvoidMode.RESIZE);
      } catch (err) {
        // 旧系统不支持时仍按键盘高度上移
      }
      // 键盘高度：问答面板按它上移（全局避让为 NONE）。
      try {
        win.off('keyboardHeightChange');
      } catch (err) {
        // 未注册过
      }
      if (enable) {
        win.on('keyboardHeightChange', (height: number): void => {
          const vp: number = this.getUIContext().px2vp(height > 0 ? height : 0);
          if (Math.abs(vp - this.askKeyboardInset) >= 1) {
            this.askKeyboardInset = vp;
            if (vp > 0) {
              this.scrollAskToEnd();
            }
          }
        });
      }
    }).catch((err: Error) => {
      this.immersiveOk = false;
    });
  }

  /** 输入框聚焦时主动读一次键盘避让区（键盘已经在时不会再触发 keyboardHeightChange）。 */
  private readAskKeyboard(): void {
    if (this.hostWindow === undefined) {
      return;
    }
    try {
      const area: window.AvoidArea = this.hostWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_KEYBOARD);
      const vp: number = this.getUIContext().px2vp(area.bottomRect.height > 0 ? area.bottomRect.height : 0);
      if (vp > 0) {
        this.askKeyboardInset = vp;
      }
    } catch (err) {
      // 取不到就等 keyboardHeightChange
    }
    this.askFollow = true;
    this.scrollAskToEnd();
  }

  private lineHeight(): number {
    return Math.round(this.readerFontSize() * 1.75);
  }

  private currentFirstPara(): number {
    if (this.pageIndex >= 0 && this.pageIndex < this.pages.length) {
      return this.pages[this.pageIndex].firstPara;
    }
    return 0;
  }

  // ---------- 数据 ----------

  private async resolveTarget(): Promise<void> {
    if (this.lectureId.length > 0 && this.bookId.length > 0) {
      return;
    }
    const env: AgentEnvelope = await this.agentApi.getContext();
    const ctx: ContextData = env.data as ContextData;
    if (ctx.lectures.length === 0 || ctx.lectures[0].books.length === 0) {
      throw new Error('还没有可读的课程');
    }
    const lecture = ctx.lectures[0];
    const book = ctx.lectures[0].books[0];
    this.lectureId = lecture.id;
    this.bookId = book.id;
    this.bookTitle = book.title;
    this.chapterIndex = ctx.active_session.book_id === book.id ? ctx.active_session.chapter_index : 0;
  }

  /** 「继续学习」优先回到本地记住的位置；显式指定章节时，若与上次相同也回到那一页。 */
  private applySavedPosition(): void {
    const saved = nxReadPosition(this.lectureId, this.bookId);
    if (saved === null) {
      return;
    }
    if (this.resumeRequested && this.flowId.length === 0) {
      this.chapterIndex = saved.chapter;
      this.pendingPara = saved.para;
      this.pendingParaOffset = saved.paraOffset !== undefined ? saved.paraOffset : 0;
    } else if (saved.chapter === this.chapterIndex) {
      this.pendingPara = saved.para;
      this.pendingParaOffset = saved.paraOffset !== undefined ? saved.paraOffset : 0;
    }
  }

  async load(): Promise<void> {
    this.loading = true;
    this.errorText = '';
    try {
      await this.resolveTarget();
      this.applySavedPosition();
      await this.loadChapter(this.chapterIndex);
      await this.loadToc();
      if (this.pageVisible && !this.disposed) {
        this.startHeartbeat();
      }
    } catch (err) {
      const e = err as BusinessError;
      this.errorText = e.message.length > 0 ? e.message : '加载章节失败';
    } finally {
      this.loading = false;
    }
  }

  async loadChapter(index: number): Promise<void> {
    this.finishReadingSession();
    const requestVersion = ++this.chapterRequestVersion;
    const cacheKey = 'nx_chapter_' + this.lectureId + '_' + this.bookId + '_' + index;
    let payload: ChapterPayload | null = null;
    this.loading = true;
    try {
      payload = await this.readerApi.getChapter(this.lectureId, this.bookId, index);
      if (payload.success !== true) {
        throw new Error(payload.message !== undefined ? payload.message : '章节不可用');
      }
      sharedCache.put(cacheKey, JSON.stringify(payload));
    } catch (err) {
      const cached = sharedCache.get(cacheKey);
      if (cached.length > 0) {
        try {
          payload = JSON.parse(cached) as ChapterPayload;
          this.errorText = '我在离线模式，先给你看上次读到的内容。';
        } catch (parseErr) {
          payload = null;
        }
      }
      if (payload === null) {
        this.loading = false;
        if (this.pages.length > 0 && !this.disposed && requestVersion === this.chapterRequestVersion) {
          this.beginReadingSession();
        }
        const e = err as BusinessError;
        throw new Error(e.message.length > 0 ? e.message : '章节不可用');
      }
    }
    if (this.disposed || requestVersion !== this.chapterRequestVersion) {
      return;
    }
    this.chapterIndex = payload.chapter_index;
    this.chapterTitle = payload.chapter_title;
    this.chapterCount = payload.chapter_count;
    this.chapterRange = payload.chapter_range;
    this.readingCoordinateSpace = payload.coordinate_space;
    this.paragraphs = payload.paragraphs;
    this.selectedPara = -1;
    this.answerEntry = null;
    // 换章：上一章的问答会话随章清空，在途的旧请求按 chapterRequestVersion 丢弃。
    this.askTurns = [];
    this.asking = false;
    this.askFollow = true;
    this.completedThisSession = false;
    this.loadMarks();
    this.paginate();
    this.loading = false;
    this.beginReadingSession();
  }

  private beginReadingSession(): void {
    const point = new ReadingCheckpoint();
    point.lecture_id = this.lectureId;
    point.book_id = this.bookId;
    point.chapter_index = this.chapterIndex;
    point.chapter_name = this.chapterTitle;
    point.chapter_range = this.chapterRange;
    point.coordinate_space = this.readingCoordinateSpace;
    point.session_id = 'read_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
    point.started_at_ms = Date.now();
    this.readingSession = new ReadingSession(point);
    this.readingFocused = this.canRecordReading();
    this.readingSession.enterPage(this.pageReadRanges(), this.readingFocused, Date.now());
    this.readerApi.postTelemetry([
      {
        stream: 'reading', event: this.readingFocused ? 'focus_in' : 'focus_out', bid: this.bookId,
        ci: this.chapterIndex, si: this.currentFirstPara(), focus: this.readingFocused ? 'reader' : 'blur',
        extra: { 'session_key': point.session_id, 'active_duration_ms': '0', 'lecture_id': this.lectureId },
      },
    ]);
  }

  async loadToc(): Promise<void> {
    try {
      const index = await this.readerApi.getIndex(this.lectureId, this.bookId);
      if (index.success === true) {
        this.chapters = index.chapters;
      }
    } catch (err) {
      // 目录失败不阻塞阅读
    }
  }

  startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatId = setInterval(() => {
      if (!this.canRecordReading()) {
        return;
      }
      const point = this.checkpointReading();
      if (point === null) {
        return;
      }
      const ratio = this.pages.length > 0 ? (this.pageIndex + 1) / this.pages.length : 0;
      this.readerApi.postTelemetry([
        {
          stream: 'reading', event: 'snapshot', bid: this.bookId, ci: this.chapterIndex, si: this.currentFirstPara(), scroll: ratio,
          extra: { 'session_key': point.session_id, 'active_duration_ms': String(point.active_duration_ms), 'lecture_id': this.lectureId },
        },
      ]);
    }, 10000);
  }

  stopHeartbeat(): void {
    if (this.heartbeatId >= 0) {
      clearInterval(this.heartbeatId);
      this.heartbeatId = -1;
    }
  }

  private canRecordReading(): boolean {
    return this.pageVisible && !this.disposed && !this.loading && !this.panelOpen && !this.showToc && !this.showAskSheet;
  }

  private pageReadRanges(): number[][] {
    const ranges: number[][] = [];
    if (this.pageIndex >= 0 && this.pageIndex < this.pages.length) {
      for (const block of this.pages[this.pageIndex].blocks) {
        if (block.readEnd > block.readStart) {
          ranges.push([block.readStart, block.readEnd]);
        }
      }
    }
    return ranges;
  }

  onReadingVisibilityChanged(): void {
    if (this.readingSession !== null) {
      const focused = this.canRecordReading();
      this.readingSession.setActive(focused, Date.now());
      const point = this.checkpointReading();
      if (point !== null && focused !== this.readingFocused) {
        this.readerApi.postTelemetry([{
          stream: 'reading', event: focused ? 'focus_in' : 'focus_out', bid: point.book_id,
          ci: point.chapter_index, si: point.paragraph_index, focus: focused ? 'reader' : 'blur',
          extra: { 'session_key': point.session_id, 'active_duration_ms': String(point.active_duration_ms), 'lecture_id': point.lecture_id },
        }]);
      }
      this.readingFocused = focused;
    }
  }

  private publishReading(point: ReadingCheckpoint): void {
    if (point.active_duration_ms === 0 && point.read_ranges.length === 0) {
      return;
    }
    this.readerApi.queueReadingProgress(point).then((status: string): void => {
      if (!this.disposed) {
        this.readingFeedback = status === 'synced' ? '我已记下读到的位置和阅读时间。' :
          (status === 'pending' ? '我先把这次阅读保存在设备上，联网后补记。' : '这次阅读还没能保存，我会继续重试。');
      }
    });
  }

  private checkpointReading(): ReadingCheckpoint | null {
    if (this.readingSession !== null) {
      const point = this.readingSession.snapshot(this.currentFirstPara(), this.pageIndex, Date.now());
      this.publishReading(point);
      return point;
    }
    return null;
  }

  private finishReadingSession(): void {
    if (this.readingSession === null) {
      return;
    }
    this.readingSession.setActive(false, Date.now());
    const point = this.readingSession.snapshot(this.currentFirstPara(), this.pageIndex, Date.now());
    this.publishReading(point);
    this.totalReadMs += point.active_duration_ms;
    this.readingSession = null;
    this.readingFocused = false;
    const events: TelemetryEvent[] = [
      {
        stream: 'reading', event: 'focus_out', bid: point.book_id, ci: point.chapter_index, si: point.paragraph_index, focus: 'blur',
        extra: { 'session_key': point.session_id, 'active_duration_ms': String(point.active_duration_ms), 'lecture_id': point.lecture_id },
      },
      {
        stream: 'reading', event: 'session_complete', bid: point.book_id, ci: point.chapter_index, si: point.paragraph_index,
        extra: {
          'duration_ms': String(point.active_duration_ms), 'active_duration_ms': String(point.active_duration_ms),
          'lecture_id': point.lecture_id, 'session_key': point.session_id,
        },
      },
    ];
    this.readerApi.postTelemetry(events);
  }

  onReaderPageChange(index: number): void {
    if (index === this.pageIndex || index < 0 || index >= this.pages.length) {
      return;
    }
    this.checkpointReading();
    this.pageIndex = index;
    this.clearSelectionState();
    this.savePosition();
    if (this.readingSession !== null) {
      this.readingSession.enterPage(this.pageReadRanges(), this.canRecordReading(), Date.now());
    }
    // 实况窗跟着真实翻页走（2026-09-21 审查 F15：updateStudy 此前无人调用）。
    sharedLiveView.updateStudy(index + 1, this.pages.length, this.chapterTitle);
  }

  // ---------- 持久化：位置 / 划线 ----------

  private savePosition(): void {
    if (this.lectureId.length === 0 || this.bookId.length === 0 || this.pages.length === 0) {
      return;
    }
    const position: ReadingPosition = new ReadingPosition();
    position.chapter = this.chapterIndex;
    position.para = this.currentFirstPara();
    const blocks = this.pages[this.pageIndex].blocks;
    position.paraOffset = blocks.length > 0 ? blocks[0].paraOffset : 0;
    position.chapterTitle = this.chapterTitle;
    position.bookTitle = this.bookTitle;
    position.lectureId = this.lectureId;
    position.bookId = this.bookId;
    position.updatedAt = Date.now();
    nxSavePosition(position);
  }

  private underlineKey(): string {
    return 'nx_ul_' + nxReadingScope() + '_' + this.lectureId + '_' + this.bookId + '_' + this.chapterIndex;
  }

  private loadMarks(): void {
    const raw = sharedCache.get(this.underlineKey());
    if (raw.length === 0) {
      this.marks = [];
      return;
    }
    try {
      if (raw.indexOf('{') < 0) {
        const nums: number[] = JSON.parse(raw) as number[];
        const rows: ReaderMark[] = [];
        for (let i = 0; i < nums.length; i++) {
          const mark = new ReaderMark();
          mark.paraIndex = nums[i];
          mark.start = 0;
          mark.end = 99999;
          mark.style = 'solid';
          mark.color = 'yellow';
          rows.push(mark);
        }
        this.marks = rows;
        return;
      }
      const parsed: ReaderMark[] = JSON.parse(raw) as ReaderMark[];
      const rows: ReaderMark[] = [];
      for (const item of parsed) {
        const mark = new ReaderMark();
        mark.paraIndex = item.paraIndex;
        mark.start = item.start;
        mark.end = item.end;
        mark.style = item.style !== undefined && item.style.length > 0 ? item.style : 'solid';
        mark.color = item.color !== undefined && item.color.length > 0 ? item.color : 'yellow';
        rows.push(mark);
      }
      this.marks = rows;
    } catch (err) {
      this.marks = [];
    }
  }

  private persistMarks(): void {
    sharedCache.put(this.underlineKey(), JSON.stringify(this.marks));
  }

  private selectedExcerpt(): string {
    if (this.snapText.length > 0) {
      return this.snapText;
    }
    if (this.selText.length > 0) {
      return this.selText;
    }
    return this.currentPageText();
  }

  // ---------- 长按选区 ----------

  /** 块级 TextController：同一块复用同一个控制器，分页重建（key 变化）时自然换新。 */
  private textController(key: string): TextController {
    const existing = this.textControllers.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created = new TextController();
    this.textControllers.set(key, created);
    return created;
  }

  private blockNodeId(key: string): string {
    return 'nx_blk_' + key;
  }

  /** 选区在 Stack 坐标系里的位置：块在窗口里的位置 + 选中字符在块内的绘制矩形。任何一步拿不到都退回块的估算位置。 */
  private measureSelection(block: PageBlock, start: number, end: number): void {
    const ui = this.getUIContext();
    let blockX = PAGE_PADDING_X;
    let blockY = PAGE_PADDING_TOP + block.top;
    try {
      const utils = ui.getComponentUtils();
      const node = utils.getRectangleById(this.blockNodeId(block.key));
      const root = utils.getRectangleById('nx_reader_root');
      const nodeW = ui.px2vp(node.size.width);
      if (nodeW > 0) {
        blockX = ui.px2vp(node.windowOffset.x - root.windowOffset.x);
        blockY = ui.px2vp(node.windowOffset.y - root.windowOffset.y);
      }
    } catch (err) {
      // 节点尚未挂载：用分页时算好的块位置
    }
    let top = blockY;
    let bottom = blockY + block.height;
    let firstCx = blockX + (this.areaWidth - PAGE_PADDING_X * 2) / 2;
    let lastCx = firstCx;
    try {
      // 高度取整行（和系统高亮、手柄一致），宽度取字形本身（三角对准真正选中的字）
      const boxes: graphicsText.TextBox[] = this.textController(block.key).getLayoutManager()
        .getRectsForRange({ start: start, end: end }, graphicsText.RectWidthStyle.TIGHT, graphicsText.RectHeightStyle.MAX);
      if (boxes.length > 0) {
        let minTop = Number.MAX_VALUE;
        let maxBottom = -Number.MAX_VALUE;
        let firstBox: graphicsText.TextBox = boxes[0];
        let lastBox: graphicsText.TextBox = boxes[0];
        for (const box of boxes) {
          if (box.rect.top < minTop) {
            minTop = box.rect.top;
            firstBox = box;
          }
          if (box.rect.bottom > maxBottom) {
            maxBottom = box.rect.bottom;
            lastBox = box;
          }
        }
        top = blockY + ui.px2vp(minTop);
        bottom = blockY + ui.px2vp(maxBottom);
        firstCx = blockX + ui.px2vp((firstBox.rect.left + firstBox.rect.right) / 2);
        lastCx = blockX + ui.px2vp((lastBox.rect.left + lastBox.rect.right) / 2);
      }
    } catch (err) {
      // 布局管理器未绑定：退回块的整体范围
    }
    this.selTop = top;
    this.selBottom = bottom;
    this.selFirstCx = firstCx;
    this.selLastCx = lastCx;
  }

  rememberSelection(block: PageBlock, start: number, end: number): void {
    if (end <= start) {
      if (this.selBlockKey === block.key || this.selBlockKey.length === 0) {
        this.selectedPara = -1;
        this.selStart = 0;
        this.selEnd = 0;
        this.selText = '';
        this.selBlockKey = '';
      }
      return;
    }
    // 同一时刻只允许一个块有选区：换块长按时先清掉上一块的系统高亮
    if (this.selBlockKey.length > 0 && this.selBlockKey !== block.key) {
      this.clearNativeSelection(this.selBlockKey);
    }
    this.selBlockKey = block.key;
    this.selectedPara = block.paraIndex;
    this.selStart = start;
    this.selEnd = end;
    this.selText = block.text.slice(start, end);
    this.snapPara = block.paraIndex;
    this.snapStart = block.paraOffset + start;
    this.snapEnd = block.paraOffset + end;
    this.snapText = this.selText;
    this.lastSelAt = Date.now();
    this.measureSelection(block, start, end);
    const existing = this.overlappingMark();
    if (existing !== null) {
      this.pendingStyle = existing.style;
      this.pendingColor = existing.color;
      this.markStyleOpen = true;
    } else {
      this.markStyleOpen = false;
    }
  }

  /** 工具栏是否可见：有一段真实的系统选区。 */
  private selectionActive(): boolean {
    return this.selectedPara >= 0 && this.selEnd > this.selStart && this.selText.length > 0;
  }

  /** 撤掉正文 Text 上的系统高亮与手柄。API 23+ 的 setTextSelection 起止相同即为不选中。 */
  private clearNativeSelection(key: string): void {
    const controller = this.textControllers.get(key);
    if (controller === undefined) {
      return;
    }
    try {
      controller.closeSelectionMenu();
    } catch (err) {
      // 无菜单时忽略
    }
    try {
      controller.setTextSelection(0, 0, { menuPolicy: MenuPolicy.HIDE });
    } catch (err) {
      // 控制器未绑定组件时忽略
    }
  }

  /** 收起选区与工具栏；keepSnapshot 时保留「刚选中的句子」给问AI sheet 用。 */
  private dismissSelection(keepSnapshot: boolean): void {
    if (this.selBlockKey.length > 0) {
      this.clearNativeSelection(this.selBlockKey);
    }
    this.selBlockKey = '';
    this.selectedPara = -1;
    this.selStart = 0;
    this.selEnd = 0;
    this.selText = '';
    this.markStyleOpen = false;
    if (!keepSnapshot) {
      this.snapPara = -1;
      this.snapStart = 0;
      this.snapEnd = 0;
      this.snapText = '';
    }
  }

  private snapshotValid(): boolean {
    return this.snapPara >= 0 && this.snapEnd > this.snapStart;
  }

  overlappingMark(): ReaderMark | null {
    if (!this.snapshotValid()) {
      return null;
    }
    for (const mark of this.marks) {
      if (mark.paraIndex === this.snapPara && mark.end > this.snapStart && mark.start < this.snapEnd) {
        return mark;
      }
    }
    return null;
  }

  /**
   * 划线：新选区与旧标记做区间运算。2026-09-21 审查 F13：原实现删掉所有与选区重叠的旧标记，
   * 只改 [40,60] 的颜色会把 [0,100] 两侧的原划线一起丢掉。现在只替换选中的那一段，两侧保留原样式。
   */
  applyMark(style: string, color: string): void {
    if (!this.snapshotValid()) {
      return;
    }
    const start = this.snapStart;
    const end = this.snapEnd;
    const next: ReaderMark[] = nxSubtractMarks(this.marks, this.snapPara, start, end);
    const added = new ReaderMark();
    added.paraIndex = this.snapPara;
    added.start = start;
    added.end = end;
    added.style = style;
    added.color = color.length > 0 ? color : 'yellow';
    next.push(added);
    this.marks = nxMergeAdjacentMarks(next);
    this.pendingStyle = style;
    this.pendingColor = added.color;
    this.markEpoch = this.markEpoch + 1;
    this.persistMarks();
    this.readerApi.postTelemetry([
      {
        stream: 'reading',
        event: 'selection',
        bid: this.bookId,
        ci: this.chapterIndex,
        si: this.snapPara,
        sel_text: this.snapText.slice(0, 200),
      },
    ]);
  }

  /** 取消划线：只去掉选中的那一段，旧标记在选区两侧的部分保留。 */
  removeSnapshotMarks(): void {
    if (!this.snapshotValid()) {
      return;
    }
    this.marks = nxSubtractMarks(this.marks, this.snapPara, this.snapStart, this.snapEnd);
    this.markEpoch = this.markEpoch + 1;
    this.persistMarks();
    this.markStyleOpen = false;
    this.pendingStyle = 'solid';
    this.pendingColor = 'yellow';
  }

  private clearSelectionState(): void {
    this.dismissSelection(false);
  }

  private blockSpans(block: PageBlock): MarkSpan[] {
    const local: ReaderMark[] = [];
    for (const mark of this.marks) {
      if (mark.paraIndex !== block.paraIndex) {
        continue;
      }
      const start = Math.max(0, mark.start - block.paraOffset);
      const end = Math.min(block.text.length, mark.end - block.paraOffset);
      if (end > start) {
        const part = new ReaderMark();
        part.start = start;
        part.end = end;
        part.style = mark.style;
        part.color = mark.color;
        local.push(part);
      }
    }
    if (local.length === 0) {
      const span = new MarkSpan();
      span.key = block.key + '_0';
      span.text = block.text;
      span.style = '';
      return [span];
    }
    local.sort((a: ReaderMark, b: ReaderMark) => a.start - b.start);
    const spans: MarkSpan[] = [];
    let cursor = 0;
    let seq = 0;
    for (const mark of local) {
      if (mark.start > cursor) {
        const span = new MarkSpan();
        span.key = block.key + '_' + seq;
        seq++;
        span.text = block.text.slice(cursor, mark.start);
        span.style = '';
        spans.push(span);
      }
      const span = new MarkSpan();
      span.key = block.key + '_' + seq;
      seq++;
      span.text = block.text.slice(Math.max(cursor, mark.start), mark.end);
      span.style = mark.style;
      span.color = mark.color;
      spans.push(span);
      cursor = Math.max(cursor, mark.end);
    }
    if (cursor < block.text.length) {
      const span = new MarkSpan();
      span.key = block.key + '_' + seq;
      span.text = block.text.slice(cursor);
      span.style = '';
      spans.push(span);
    }
    return spans;
  }

  // ---------- 分页 ----------

  private measureHeight(text: string, heading: number): number {
    const width = this.areaWidth - PAGE_PADDING_X * 2;
    if (width <= 0) {
      return 0;
    }
    const size = heading > 0 ? this.readerFontSize() + 3 : this.readerFontSize();
    const measured: SizeOptions = MeasureText.measureTextSize({
      textContent: text,
      constraintWidth: width,
      fontSize: size,
      fontWeight: heading > 0 ? FontWeight.Bold : FontWeight.Normal,
      lineHeight: this.lineHeight() + 'vp',
    });
    const heightPx = Number(measured.height);
    return isNaN(heightPx) ? 0 : this.getUIContext().px2vp(heightPx);
  }

  /**
   * 把放不进一页的长段按标点拆成若干块，每块都能放进 maxHeight。
   * 2026-09-21 审查 F14：原来 guard 到 60 块就直接返回，超长段（OCR / 网页清洗）剩余正文被静默丢掉。
   * 现在 guard 只防死循环：到上限时把剩余正文整段放进最后一块（多出一页也不丢字）。
   */
  private splitToFit(text: string, heading: number, maxHeight: number): string[] {
    const chunks: string[] = [];
    let rest = text;
    let guard = 0;
    while (rest.length > 0) {
      guard++;
      if (guard > 400 || this.measureHeight(rest, heading) <= maxHeight) {
        chunks.push(rest);
        break;
      }
      let low = 1;
      let high = rest.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (this.measureHeight(rest.slice(0, mid), heading) <= maxHeight) {
          low = mid;
        } else {
          high = mid - 1;
        }
      }
      let cut = low;
      const floor = Math.floor(low * 0.6);
      for (let i = low - 1; i > floor; i--) {
        if (SPLIT_PUNCT.indexOf(rest.charAt(i)) >= 0) {
          cut = i + 1;
          break;
        }
      }
      if (cut <= 0) {
        cut = Math.max(1, low);
      }
      if (cut < rest.length && rest.charCodeAt(cut - 1) >= 0xD800 && rest.charCodeAt(cut - 1) <= 0xDBFF &&
        rest.charCodeAt(cut) >= 0xDC00 && rest.charCodeAt(cut) <= 0xDFFF) {
        cut = cut > 1 ? cut - 1 : cut + 1;
      }
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\s+/, '');
    }
    return chunks;
  }

  private parseImage(text: string): string {
    // {{nxl_image:l_xxx:b_xxx:img_0050:name.jpg}}
    const body = text.replace('{{nxl_image:', '').replace('}}', '');
    const parts = body.split(':');
    if (parts.length < 3) {
      return '';
    }
    return this.readerApi.imageUrl(parts[0], parts[1], parts[2]);
  }

  private schedulePaginate(): void {
    if (this.paginateId >= 0) {
      clearTimeout(this.paginateId);
    }
    this.paginateId = setTimeout(() => {
      this.paginateId = -1;
      this.paginate();
    }, 40);
  }

  private paginate(): void {
    if (this.areaWidth <= 0 || this.areaHeight <= 0 || this.paragraphs.length === 0) {
      return;
    }
    this.checkpointReading();
    const currentBlocks: PageBlock[] = this.pageIndex < this.pages.length ? this.pages[this.pageIndex].blocks : [];
    const keepPara = this.pendingPara >= 0 ? this.pendingPara : this.currentFirstPara();
    const keepOffset = this.pendingPara >= 0 ? this.pendingParaOffset : (currentBlocks.length > 0 ? currentBlocks[0].paraOffset : 0);
    this.pendingPara = -1;
    this.pendingParaOffset = 0;
    const pageHeight = this.areaHeight - PAGE_PADDING_TOP - PAGE_PADDING_BOTTOM;
    const result: ReaderPage[] = [];
    // 块 key 带上章 / 字号 / 宽度，分页重建后旧的 TextController 与节点 id 自然失效
    this.blockKeyPrefix = 'c' + this.chapterIndex + 'f' + this.fontIndex + 'w' + Math.round(this.areaWidth) + '_';
    this.textControllers.clear();
    this.selBlockKey = '';
    let current: ReaderPage = new ReaderPage();
    let cursor = 0;
    let blockSeq = 0;
    const flush = (): void => {
      if (current.blocks.length > 0) {
        current.index = result.length;
        current.key = 'p' + this.chapterIndex + '_' + current.index + '_' + this.fontIndex + '_' + Math.round(this.areaWidth);
        result.push(current);
      }
      current = new ReaderPage();
      cursor = 0;
    };
    const place = (block: PageBlock): void => {
      const gap = current.blocks.length > 0 ? PARA_GAP : 0;
      if (cursor + gap + block.height > pageHeight && current.blocks.length > 0) {
        flush();
      }
      const top = cursor + (current.blocks.length > 0 ? PARA_GAP : 0);
      block.top = top;
      if (current.blocks.length === 0) {
        current.firstPara = block.paraIndex;
      }
      current.blocks.push(block);
      cursor = top + block.height;
    };
    for (const paragraph of this.paragraphs) {
      if (paragraph.kind === 'image' || paragraph.text.indexOf('{{nxl_image:') === 0) {
        const block = new PageBlock();
        block.key = this.blockKeyPrefix + 'b' + (blockSeq++);
        block.paraIndex = paragraph.index;
        block.readStart = paragraph.start;
        block.readEnd = paragraph.end;
        block.isImage = true;
        block.imageUrl = this.parseImage(paragraph.text);
        block.height = Math.min(IMAGE_HEIGHT, pageHeight);
        if (block.imageUrl.length > 0) {
          place(block);
        }
        continue;
      }
      const text = paragraph.text.trim();
      if (text.length === 0) {
        continue;
      }
      const chunks: string[] = this.splitToFit(text, paragraph.heading_level, pageHeight);
      const leadingChars = nxCodePointLength(paragraph.text.slice(0, paragraph.text.indexOf(text)));
      let paraCursor = 0;
      for (const chunk of chunks) {
        const block = new PageBlock();
        block.key = this.blockKeyPrefix + 'b' + (blockSeq++);
        block.paraIndex = paragraph.index;
        block.text = chunk;
        block.heading = paragraph.heading_level;
        // splitToFit 会跳过块首空白，坐标必须仍指向原段落中的实际文字。
        block.paraOffset = Math.max(paraCursor, text.indexOf(chunk, paraCursor));
        block.readStart = paragraph.start + leadingChars + nxCodePointLength(text.slice(0, block.paraOffset));
        block.readEnd = Math.min(paragraph.end, block.readStart + nxCodePointLength(chunk));
        block.height = this.measureHeight(chunk, paragraph.heading_level);
        place(block);
        paraCursor = block.paraOffset + chunk.length;
      }
    }
    flush();
    this.pages = result;
    let target = 0;
    for (let i = 0; i < result.length; i++) {
      const offset = result[i].blocks.length > 0 ? result[i].blocks[0].paraOffset : 0;
      if (result[i].firstPara < keepPara || (result[i].firstPara === keepPara && offset <= keepOffset)) {
        target = i;
      } else {
        break;
      }
    }
    this.pageIndex = target;
    this.savePosition();
    if (this.readingSession !== null) {
      this.readingSession.enterPage(this.pageReadRanges(), this.canRecordReading(), Date.now());
    }
  }

  // ---------- 翻页 ----------

  goNext(): void {
    if (this.loading || this.marking) {
      return;
    }
    if (this.pageIndex < this.pages.length - 1) {
      this.swiperController.showNext();
      return;
    }
    this.finishChapterAndAdvance();
  }

  goPrev(): void {
    if (this.loading || this.marking) {
      return;
    }
    if (this.pageIndex > 0) {
      this.swiperController.showPrevious();
      return;
    }
    if (this.chapterIndex > 0) {
      this.pendingPara = Number.MAX_SAFE_INTEGER;
      this.loadChapter(this.chapterIndex - 1).catch((err: Error): void => {
        this.errorText = err.message;
      });
    }
  }

  jumpChapter(index: number): void {
    if (this.loading || this.marking || index < 0 || index >= this.chapterCount) {
      return;
    }
    this.showToc = false;
    this.panelOpen = false;
    this.pendingPara = 0;
    this.loadChapter(index).catch((err: Error): void => {
      this.errorText = err.message;
    });
  }

  /** 章末再翻：先记读完，再进下一章；最后一章则只记读完。 */
  async finishChapterAndAdvance(): Promise<void> {
    const completed = await this.markChapterComplete(false);
    if (!completed) {
      return;
    }
    if (this.chapterIndex + 1 < this.chapterCount) {
      this.jumpChapter(this.chapterIndex + 1);
    } else {
      this.toast('这本书读到最后一页了。');
    }
  }

  async markChapterComplete(fromButton: boolean): Promise<boolean> {
    if (this.loading || this.marking || this.chapterTitle.length === 0) {
      return false;
    }
    if (this.completedThisSession) {
      if (fromButton) {
        this.toast('这一章已经记为读完。');
      }
      return true;
    }
    this.marking = true;
    try {
      this.checkpointReading();
      await this.readerApi.postChapterComplete(this.lectureId, this.bookId, this.chapterTitle, this.chapterRange, this.chapterIndex);
      this.completedThisSession = true;
      if (this.flowId.length > 0 && this.chapterIndex === this.flowChapterIndex) {
        this.flowReadingConfirmed = true;
      }
      AppStorage.setOrCreate('nxStudyTick', Date.now());
      this.toast('记下了：' + this.chapterTitle + ' 读完。');
      return true;
    } catch (err) {
      const e = err as BusinessError;
      this.toast('这一章没记上：' + (e.message.length > 0 ? e.message : '网络错误'));
      return false;
    } finally {
      this.marking = false;
    }
  }

  private toast(message: string): void {
    try {
      this.getUIContext().getPromptAction().showToast({ message: message, duration: 1800 });
    } catch (err) {
      // 无 UI 上下文时静默
    }
  }

  onPageTap(x: number): void {
    if (Date.now() - this.lastSelAt < 480) {
      return;
    }
    // 有选区时点工具栏以外的任何地方：只收起选区，不翻页、不开面板
    if (this.selectionActive() || this.selBlockKey.length > 0) {
      this.dismissSelection(false);
      return;
    }
    if (this.markStyleOpen || this.snapshotValid()) {
      this.clearSelectionState();
      return;
    }
    if (this.panelOpen) {
      this.panelOpen = false;
      return;
    }
    if (this.areaWidth <= 0) {
      return;
    }
    if (x < this.areaWidth * 0.3) {
      this.goPrev();
    } else if (x > this.areaWidth * 0.7) {
      this.goNext();
    } else {
      this.panelOpen = true;
    }
  }

  private paragraphText(index: number): string {
    for (const paragraph of this.paragraphs) {
      if (paragraph.index === index) {
        return paragraph.text;
      }
    }
    return '';
  }

  async copySelected(): Promise<void> {
    const text = this.selectedExcerpt();
    if (text.length === 0) {
      return;
    }
    this.dismissSelection(false);
    const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
    await pasteboard.getSystemPasteboard().setData(data);
    this.toast('已复制选中的句子。');
  }

  /** 系统分享面板分享选中的句子（带书名 / 章名）；面板拉不起来就退回复制。 */
  async shareSelected(): Promise<void> {
    const text = this.selectedExcerpt();
    if (text.length === 0) {
      return;
    }
    this.dismissSelection(false);
    const title = this.bookTitle.length > 0 ? this.bookTitle + ' · ' + this.chapterTitle : this.chapterTitle;
    try {
      const data: systemShare.SharedData = new systemShare.SharedData({
        utd: uniformTypeDescriptor.UniformDataType.TEXT,
        content: text,
        title: title,
      });
      const controller: systemShare.ShareController = new systemShare.ShareController(data);
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      await controller.show(context, {
        selectionMode: systemShare.SelectionMode.SINGLE,
        previewMode: systemShare.SharePreviewMode.DETAIL,
      });
    } catch (err) {
      const pasted = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
      await pasteboard.getSystemPasteboard().setData(pasted);
      this.toast('这台设备拉不起分享面板，已复制到剪贴板。');
    }
  }

  openAskSheet(): void {
    this.dismissSelection(true);
    this.panelOpen = false;
    this.showAskSheet = true;
    this.askText = '';
  }

  /** 查询：对着选中的词句直接问一句「这是什么意思」，答案落在问AI sheet 里。 */
  lookupSelected(): void {
    const text = this.selectedExcerpt().trim();
    if (text.length === 0) {
      return;
    }
    this.openAskSheet();
    const brief = text.length > 40 ? text.slice(0, 40) + '…' : text;
    this.ask('「' + brief + '」在这里是什么意思？用两三句话解释。');
  }

  /** 划线：没划过就先按当前样式划上，然后在工具栏里展开样式行。 */
  openMarkStyle(): void {
    if (!this.snapshotValid()) {
      return;
    }
    this.panelOpen = false;
    if (this.overlappingMark() === null) {
      this.applyMark(this.pendingStyle, this.pendingColor);
    }
    this.markStyleOpen = true;
  }

  async ask(question: string): Promise<void> {
    const text = question.trim();
    if (text.length === 0 || this.asking) {
      return;
    }
    this.asking = true;
    // 2026-09-21 审查 F04：整轮问答的来源在发问那一刻冻结（书 / 章 / 段 / 选段 / 章节请求版本）。
    // 回包时章节已切换（版本变了）就丢弃，不把旧章的答案配上新章的引用。
    const requestVersion = this.chapterRequestVersion;
    const askLectureId = this.lectureId;
    const askBookId = this.bookId;
    const askBookTitle = this.bookTitle;
    const askChapterIndex = this.chapterIndex;
    const askChapterTitle = this.chapterTitle;
    const anchorPara = this.snapPara >= 0 ? this.snapPara : (this.selectedPara >= 0 ? this.selectedPara : this.currentFirstPara());
    const selectedText = this.selectedExcerpt();
    const quoted = this.snapText.length > 0 || this.selText.length > 0;
    this.readerApi.postTelemetry([
      {
        stream: 'reading',
        event: 'ask',
        bid: askBookId,
        ci: askChapterIndex,
        si: anchorPara,
        sel_text: text.slice(0, 200),
        focus: 'chat',
      },
    ]);
    const userTurn: TimelineEntry = {
      id: 'ask_u_' + Date.now(),
      kind: 'user_msg',
      ts: Date.now(),
      text: text,
      unattended: false,
    };
    const thinkId: string = 'ask_t_' + Date.now();
    const thinkTurn: TimelineEntry = {
      id: thinkId,
      kind: 'agent_msg',
      ts: Date.now() + 1,
      text: '',
      status: 'thinking',
      unattended: false,
    };
    this.askTurns = this.askTurns.concat([userTurn, thinkTurn]);
    this.askText = '';
    this.scrollAskToEnd();
    try {
      const target: LearnTarget = {
        lecture_id: askLectureId,
        lecture_title: '',
        book_id: askBookId,
        book_title: askBookTitle,
        chapter_index: askChapterIndex,
        chapter_name: askChapterTitle,
        chapter_range: '',
      };
      const env: AgentEnvelope = await this.agentApi.postAskInContext(text, target, selectedText);
      if (this.disposed || requestVersion !== this.chapterRequestVersion) {
        // 章节已切换：这轮会话已随章节清空，答案不再进入当前章。
        return;
      }
      const data: AskAnswer = env.data as AskAnswer;
      if (data === null || data === undefined || typeof data.answer !== 'string' || data.answer.trim().length === 0) {
        throw new Error('这次我没给出答案。');
      }
      const excerpt = selectedText.slice(0, 120);
      const citation: CitationCard = {
        type: 'citation',
        book: askBookTitle,
        chapter: askChapterTitle,
        excerpt: excerpt.length > 0 ? excerpt : askChapterTitle,
        anchor: String(anchorPara),
      };
      // 2026-09-21 审查 P2-11：依据按服务端返回的来源标注，不再对每条回答固定拼「依据教材原文」。
      const fromTextbook = data.source === 'textbook_context';
      const reason = fromTextbook
        ? (quoted ? '结合你选的这句和教材' + askChapterTitle + '回答。' : '结合教材' + askChapterTitle + '这一页回答。')
        : '教材里没有直接依据，这是通用知识的补充，回原文可以对照' + askChapterTitle + '。';
      const answer: TimelineEntry = {
        id: String(anchorPara) + '_' + Date.now(),
        kind: 'agent_msg',
        ts: Date.now(),
        text: data.answer,
        reason: reason,
        card: citation,
        unattended: false,
      };
      this.answerEntry = answer;
      const turns: TimelineEntry[] = [];
      for (const turn of this.askTurns) {
        if (turn.id !== thinkId) {
          turns.push(turn);
        }
      }
      turns.push(answer);
      this.askTurns = turns;
      this.scrollAskToEnd();
    } catch (err) {
      if (this.disposed || requestVersion !== this.chapterRequestVersion) {
        return;
      }
      const e = err as BusinessError;
      const fail: TimelineEntry = {
        id: 'err_' + Date.now(),
        kind: 'system',
        ts: Date.now(),
        text: '这个问题我没接上：' + (e.message.length > 0 ? e.message : '网络错误') + '。问题还在下面输入框里，可以重发。',
        unattended: false,
      };
      this.answerEntry = fail;
      // 失败保稿：把原问题放回输入框，用户可编辑重发。
      this.askText = text;
      const turns: TimelineEntry[] = [];
      for (const turn of this.askTurns) {
        if (turn.id !== thinkId) {
          turns.push(turn);
        }
      }
      turns.push(fail);
      this.askTurns = turns;
      this.scrollAskToEnd();
    } finally {
      if (requestVersion === this.chapterRequestVersion) {
        this.asking = false;
      }
    }
  }

  /** 问答面板：新消息到达时滚到底（用户正在看上文时不强拉，只在接近底部时跟随）。 */
  private scrollAskToEnd(): void {
    if (!this.askFollow) {
      return;
    }
    setTimeout((): void => {
      try {
        this.askScroller.scrollEdge(Edge.Bottom);
      } catch (err) {
        // 面板尚未挂载
      }
    }, 60);
  }

  /** 没有选段时，把当前页正文作为上下文。 */
  private currentPageText(): string {
    if (this.pageIndex < 0 || this.pageIndex >= this.pages.length) {
      return '';
    }
    const parts: string[] = [];
    for (const block of this.pages[this.pageIndex].blocks) {
      if (!block.isImage) {
        parts.push(block.text);
      }
    }
    return parts.join('\n');
  }

  jumpToParagraph(anchor: string): void {
    const index = parseInt(anchor);
    if (isNaN(index)) {
      return;
    }
    this.showAskSheet = false;
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      const last = page.blocks.length > 0 ? page.blocks[page.blocks.length - 1].paraIndex : -1;
      if (index >= page.firstPara && index <= last) {
        this.onReaderPageChange(i);
        break;
      }
    }
    this.flashPara = index;
    setTimeout(() => {
      this.flashPara = -1;
    }, 1600);
  }

  // ---------- 朗读 / 设置 ----------

  async toggleSpeak(): Promise<void> {
    if (this.speaking || this.ttsPaused) {
      sharedTts.stop();
      this.ttsPaused = false;
      this.speaking = false;
      return;
    }
    const from = this.currentFirstPara();
    const parts: string[] = [];
    for (const paragraph of this.paragraphs) {
      if (paragraph.index >= from && paragraph.kind !== 'image') {
        parts.push(paragraph.text);
      }
    }
    const full = parts.join('\n');
    if (full.length === 0) {
      return;
    }
    this.panelOpen = false;
    sharedTts.setStateListener((speaking: boolean): void => {
      this.speaking = speaking;
      this.ttsPaused = sharedTts.isPaused();
    });
    await sharedTts.speakText(full, (message: string): void => {
      this.errorText = message;
      this.speaking = false;
      this.ttsPaused = false;
    });
  }

  async speakSelected(): Promise<void> {
    const text = this.selectedExcerpt();
    if (text.length === 0) {
      return;
    }
    this.dismissSelection(false);
    sharedTts.setStateListener((speaking: boolean): void => {
      this.speaking = speaking;
      this.ttsPaused = sharedTts.isPaused();
    });
    await sharedTts.speakText(text, (message: string): void => {
      this.errorText = message;
      this.speaking = false;
      this.ttsPaused = false;
    });
  }

  togglePauseSpeak(): void {
    if (this.ttsPaused) {
      sharedTts.resume();
      this.ttsPaused = false;
      this.speaking = true;
      return;
    }
    if (this.speaking) {
      sharedTts.pause();
      this.ttsPaused = true;
    }
  }

  changeFont(delta: number): void {
    const next = this.fontIndex + delta;
    if (next < 0 || next >= READER_FONT_SIZES.length) {
      return;
    }
    this.fontIndex = next;
    sharedCache.putNumber('nx_reader_font_index', next);
    this.paginate();
  }

  setTheme(id: string): void {
    this.themeId = id;
    sharedCache.put('nx_reader_theme', id);
    this.applyImmersive(true);
  }

  // ---------- 视图 ----------

  @Builder
  markSpanView(span: MarkSpan, block: PageBlock) {
    Span(span.text)
      .fontSize(block.heading > 0 ? this.readerFontSize() + 3 : this.readerFontSize())
      .fontWeight(block.heading > 0 ? FontWeight.Bold : FontWeight.Normal)
      .fontColor(this.theme().ink)
      .decoration({
        type: span.style === 'solid' || span.style === 'wavy' ? TextDecorationType.Underline : TextDecorationType.None,
        color: nxMarkSwatch(span.color).line,
        style: span.style === 'wavy' ? TextDecorationStyle.WAVY : TextDecorationStyle.SOLID,
      })
      .textBackgroundStyle({
        color: span.style === 'mark' ? nxMarkSwatch(span.color).fill : Color.Transparent,
        radius: 2,
      })
  }

  @Builder
  blockView(block: PageBlock) {
    if (block.isImage) {
      Image(block.imageUrl)
        .width('100%')
        .height(block.height)
        .objectFit(ImageFit.Contain)
        .borderRadius(NxRadius.xs)
        .backgroundColor(this.theme().markBg)
        .margin({ top: block.top > 0 ? PARA_GAP : 0 })
        .onClick(() => {
          // 2026-09-21 审查：窄长代码图在固定高区域里太小，点按全屏查看，关闭回到原阅读位置。
          this.zoomImageUrl = block.imageUrl;
        })
    } else {
      Text(undefined, { controller: this.textController(block.key) }) {
        ForEach(this.blockSpans(block), (span: MarkSpan) => {
          this.markSpanView(span, block)
        }, (span: MarkSpan) => span.key + '_' + this.markEpoch)
      }
      .id(this.blockNodeId(block.key))
      .fontSize(block.heading > 0 ? this.readerFontSize() + 3 : this.readerFontSize())
      .fontWeight(block.heading > 0 ? FontWeight.Bold : FontWeight.Normal)
      .fontColor(this.theme().ink)
      .lineHeight(this.lineHeight() + 'vp')
      .width('100%')
      .copyOption(CopyOptions.LocalDevice)
      .draggable(false)
      .caretColor(this.theme().underline)
      .selectedBackgroundColor(this.theme().selectBg)
      // 系统选区菜单换成页面自绘的浮动工具栏：这里绑一个空菜单把系统菜单压掉，长按仍走系统手柄选字
      .bindSelectionMenu(TextSpanType.TEXT, this.emptySelectionMenu, TextResponseType.LONG_PRESS)
      .parallelGesture(
        TapGesture({ count: 2 })
          .onAction(() => {
            // 覆盖双击默认菜单，避免和长按选区抢手势
          })
      )
      .onTextSelectionChange((selectionStart: number, selectionEnd: number) => {
        this.rememberSelection(block, selectionStart, selectionEnd);
      })
      .backgroundColor(this.flashPara === block.paraIndex ? this.theme().markBg : Color.Transparent)
      .margin({ top: block.top > 0 ? PARA_GAP : 0 })
    }
  }

  @Builder
  pageView(page: ReaderPage) {
    Column() {
      Column()
        .width('100%')
        .height(PAGE_PADDING_TOP)
      Column() {
        ForEach(page.blocks, (block: PageBlock) => {
          this.blockView(block)
        }, (block: PageBlock) => block.key)
      }
      .width('100%')
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      .justifyContent(FlexAlign.Start)
      Row() {
        Text((page.index + 1) + '/' + this.pages.length)
          .fontSize(NxFontSize.xs)
          .fontColor(this.theme().inkSoft)
        Blank()
      }
      .width('100%')
      .height(PAGE_PADDING_BOTTOM)
      .padding({ bottom: NxGrid * 2 })
      .alignItems(VerticalAlign.Bottom)
    }
    .width('100%')
    .height('100%')
    .padding({ left: PAGE_PADDING_X, right: PAGE_PADDING_X })
    .backgroundColor(this.theme().bg)
  }

  /** 绑给 Text 的空选区菜单：只为压掉系统默认菜单，真正的工具栏见 selectionBar()。 */
  @Builder
  emptySelectionMenu() {
    Column()
      .width(0)
      .height(0)
  }

  // ---------- 长按浮动工具栏（番茄小说式：图标 + 小字一行，划线后展开样式行） ----------

  private selectionBarWidth(): number {
    return Math.min(SEL_BAR_MAX_WIDTH, this.areaWidth - NxGrid * 4);
  }

  private selectionBarHeight(): number {
    return this.markStyleOpen ? SEL_BAR_MAIN + SEL_BAR_STYLE : SEL_BAR_MAIN;
  }

  /** 选区下方放得下就放下方（三角朝上指着最后一行），否则放上方（三角朝下指着第一行）。 */
  private selectionBarBelow(): boolean {
    const needed = this.selBottom + SEL_BAR_GAP + SEL_BAR_CARET + this.selectionBarHeight();
    return needed <= this.areaHeight - PAGE_PADDING_BOTTOM;
  }

  private selectionBarX(): number {
    return (this.areaWidth - this.selectionBarWidth()) / 2;
  }

  /** 工具栏（含小三角）整体的顶边。 */
  private selectionBarY(): number {
    if (this.selectionBarBelow()) {
      return this.selBottom + SEL_BAR_GAP;
    }
    return Math.max(NxGrid * 2, this.selTop - SEL_BAR_GAP - SEL_BAR_CARET - this.selectionBarHeight());
  }

  /** 小三角在工具栏内的水平偏移：对准最近一行选中文字的中心，夹在圆角以内。 */
  private selectionCaretX(): number {
    const cx = this.selectionBarBelow() ? this.selLastCx : this.selFirstCx;
    const local = cx - this.selectionBarX() - SEL_BAR_CARET;
    return Math.min(this.selectionBarWidth() - NxRadius.md - SEL_BAR_CARET * 2, Math.max(NxRadius.md, local));
  }

  @Builder
  selectionCaret(pointUp: boolean) {
    Polygon({ width: SEL_BAR_CARET * 2, height: SEL_BAR_CARET })
      .points(pointUp
        ? [[0, SEL_BAR_CARET], [SEL_BAR_CARET, 0], [SEL_BAR_CARET * 2, SEL_BAR_CARET]]
        : [[0, 0], [SEL_BAR_CARET * 2, 0], [SEL_BAR_CARET, SEL_BAR_CARET]])
      .fill(this.theme().barBg)
      .stroke(Color.Transparent)
      .margin({ left: this.selectionCaretX() })
  }

  @Builder
  selectionItem(label: string, icon: Resource, active: boolean, onTap: () => void) {
    Column({ space: NxGrid + 2 }) {
      SymbolGlyph(icon)
        .fontSize(22)
        .fontColor([active ? this.theme().barAccent : this.theme().barInk])
      Text(label)
        .fontSize(NxFontSize.sm)
        .fontColor(active ? this.theme().barAccent : this.theme().barInk)
        .maxLines(1)
    }
    .layoutWeight(1)
    .height(SEL_BAR_MAIN - NxGrid * 2)
    .justifyContent(FlexAlign.Center)
    .borderRadius(NxRadius.sm)
    .backgroundColor(active ? this.theme().barItemBg : Color.Transparent)
    .onClick(() => {
      onTap();
    })
  }

  /** 「问AI」项：图标与文字走紫→粉渐变，对应参考稿里的 AI 入口。 */
  @Builder
  selectionAiItem() {
    Column({ space: NxGrid + 2 }) {
      SymbolGlyph($r('sys.symbol.wand_and_stars'))
        .fontSize(22)
        .fontColor([this.theme().aiStart])
        .shaderStyle(new LinearGradientStyle({
          angle: 135,
          colors: [[this.theme().aiStart, 0.0], [this.theme().aiEnd, 1.0]],
        }))
      Text('问AI')
        .fontSize(NxFontSize.sm)
        .fontColor(this.theme().aiStart)
        .maxLines(1)
        .shaderStyle(new LinearGradientStyle({
          angle: 90,
          colors: [[this.theme().aiStart, 0.0], [this.theme().aiEnd, 1.0]],
        }))
    }
    .layoutWeight(1)
    .height(SEL_BAR_MAIN - NxGrid * 2)
    .justifyContent(FlexAlign.Center)
    .onClick(() => {
      this.openAskSheet();
    })
  }

  /** 样式行里的「A」预览：直线 / 波浪 / 荧光笔，用当前待用颜色画。 */
  @Builder
  stylePreview(style: string) {
    Column() {
      Text() {
        Span('A')
          .fontSize(NxFontSize.title)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.theme().barInk)
          .decoration({
            type: style === 'solid' || style === 'wavy' ? TextDecorationType.Underline : TextDecorationType.None,
            color: nxMarkSwatch(this.pendingColor).line,
            style: style === 'wavy' ? TextDecorationStyle.WAVY : TextDecorationStyle.SOLID,
          })
          .textBackgroundStyle({
            color: style === 'mark' ? nxMarkSwatch(this.pendingColor).fill : Color.Transparent,
            radius: 3,
          })
      }
      .padding({ left: 4, right: 4 })
    }
    .layoutWeight(1)
    .height(SEL_BAR_STYLE - NxGrid * 3)
    .justifyContent(FlexAlign.Center)
    .borderRadius(NxRadius.sm)
    .backgroundColor(this.pendingStyle === style ? this.theme().barItemBg : Color.Transparent)
    .onClick(() => {
      this.applyMark(style, this.pendingColor);
    })
  }

  /** 悬浮在选区旁的工具栏：主行 + 可展开的样式行 + 指向选区的小三角。 */
  @Builder
  selectionBar() {
    Column() {
      if (this.selectionBarBelow()) {
        this.selectionCaret(true)
      }
      Column() {
        Row({ space: 2 }) {
          this.selectionAiItem()
          this.selectionItem('复制', $r('sys.symbol.rectangle_on_square'), false, (): void => {
            this.copySelected();
          })
          this.selectionItem('朗读', $r('sys.symbol.headphones'), false, (): void => {
            this.speakSelected();
          })
          if (this.overlappingMark() !== null) {
            this.selectionItem('删除划线', $r('sys.symbol.line_below_character_slash'), this.markStyleOpen, (): void => {
              this.removeSnapshotMarks();
            })
          } else {
            this.selectionItem('划线', $r('sys.symbol.line_below_character'), this.markStyleOpen, (): void => {
              this.openMarkStyle();
            })
          }
          this.selectionItem('分享', $r('sys.symbol.share'), false, (): void => {
            this.shareSelected();
          })
          this.selectionItem('查询', $r('sys.symbol.text_and_magnifyingglass'), false, (): void => {
            this.lookupSelected();
          })
        }
        .width('100%')
        .height(SEL_BAR_MAIN)
        .padding({ left: NxGrid, right: NxGrid })
        .alignItems(VerticalAlign.Center)
        if (this.markStyleOpen) {
          Divider()
            .strokeWidth(1)
            .color(this.theme().barDivider)
          Row({ space: NxGrid }) {
            this.stylePreview('solid')
            this.stylePreview('wavy')
            this.stylePreview('mark')
            Row({ space: NxGrid * 2 }) {
              ForEach(NxMarkSwatches, (swatch: NxMarkSwatch) => {
                Column()
                  .width(this.pendingColor === swatch.id ? 22 : 18)
                  .height(this.pendingColor === swatch.id ? 22 : 18)
                  .borderRadius(11)
                  .backgroundColor(swatch.line)
                  .border({
                    width: this.pendingColor === swatch.id ? 2 : 0,
                    color: this.theme().barBg,
                  })
                  .shadow({
                    radius: this.pendingColor === swatch.id ? 4 : 0,
                    color: this.theme().barDivider,
                    offsetX: 0,
                    offsetY: 0,
                  })
                  .onClick(() => {
                    this.applyMark(this.pendingStyle, swatch.id);
                  })
              }, (swatch: NxMarkSwatch) => swatch.id + '_' + this.pendingColor)
            }
            .layoutWeight(1.6)
            .height(SEL_BAR_STYLE - NxGrid * 3)
            .justifyContent(FlexAlign.SpaceEvenly)
            .alignItems(VerticalAlign.Center)
          }
          .width('100%')
          .height(SEL_BAR_STYLE - 1)
          .padding({ left: NxGrid * 2, right: NxGrid * 2 })
          .alignItems(VerticalAlign.Center)
        }
      }
      .width(this.selectionBarWidth())
      .borderRadius(NxRadius.md)
      .backgroundColor(this.theme().barBg)
      .shadow({
        radius: NxShadow.level2.radius,
        color: NxShadow.level2.color,
        offsetX: NxShadow.level2.offsetX,
        offsetY: NxShadow.level2.offsetY,
      })
      if (!this.selectionBarBelow()) {
        this.selectionCaret(false)
      }
    }
    .alignItems(HorizontalAlign.Start)
    .position({ x: this.selectionBarX(), y: this.selectionBarY() })
    .transition(TransitionEffect.OPACITY.animation({ duration: 120 }))
  }

  @Builder
  tapZones() {
    Row() {
      Column()
        .width('30%')
        .height('100%')
        .onClick(() => {
          this.onPageTap(this.areaWidth * 0.15);
        })
      Column()
        .width('40%')
        .height('100%')
        .onClick(() => {
          this.onPageTap(this.areaWidth * 0.5);
        })
      Column()
        .width('30%')
        .height('100%')
        .onClick(() => {
          this.onPageTap(this.areaWidth * 0.85);
        })
    }
    .width('100%')
    .height('100%')
    .hitTestBehavior(HitTestMode.Transparent)
  }

  @Builder
  chrome() {
    Row({ space: NxGrid * 2 }) {
      Blank()
      Text(this.clockText)
        .fontSize(NxFontSize.xs)
        .fontFamily(NxFontFamily.mono)
        .fontColor(this.theme().chromeInk)
      if (this.batteryPct >= 0) {
        Text(this.batteryPct + '%')
          .fontSize(NxFontSize.xs)
          .fontFamily(NxFontFamily.mono)
          .fontColor(this.theme().chromeInk)
      }
    }
    .width('100%')
    .height(PAGE_PADDING_TOP)
    .padding({ left: PAGE_PADDING_X, right: PAGE_PADDING_X, top: NxGrid * 2 })
    .hitTestBehavior(HitTestMode.None)
    .position({ x: 0, y: 0 })
  }

  @Builder
  ttsBar() {
    Row({ space: NxGrid * 3 }) {
      Text(this.ttsPaused ? '继续' : '暂停')
        .fontSize(NxFontSize.sm)
        .fontColor(this.theme().barAccent)
        .onClick(() => {
          this.togglePauseSpeak();
        })
      Text(this.ttsPaused ? '朗读停住了' : '正在朗读')
        .fontSize(NxFontSize.sm)
        .fontColor(this.theme().barInk)
        .layoutWeight(1)
      Text('停止')
        .fontSize(NxFontSize.sm)
        .fontColor(this.theme().barInkSoft)
        .onClick(() => {
          sharedTts.stop();
          this.speaking = false;
          this.ttsPaused = false;
        })
    }
    .width('100%')
    .height(MENU_HEIGHT)
    .padding({ left: NxGrid * 4, right: NxGrid * 4 })
    .backgroundColor(this.theme().barBg)
    .borderRadius({ topLeft: NxRadius.md, topRight: NxRadius.md })
  }

  @Builder
  panelButton(label: string, accent: boolean, onTap: () => void) {
    Text(label)
      .fontSize(NxFontSize.md)
      .fontColor(accent ? this.theme().barAccent : this.theme().barInk)
      .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid * 2, bottom: NxGrid * 2 })
      .onClick(() => {
        onTap();
      })
  }

  /** 点击屏幕中间呼出的操作面板：顶栏（返回 / 章名）+ 底栏（章节进度 / 目录 / 朗读 / 字号 / 主题 / 问AI / 读完这章）。 */
  @Builder
  panel() {
    Column() {
      Row({ space: NxGrid * 2 }) {
        Text('‹ 返回')
          .fontSize(NxFontSize.lg)
          .fontColor(this.theme().barInk)
          .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid * 2, bottom: NxGrid * 2 })
          .onClick(() => {
            router.back();
          })
        Column({ space: 2 }) {
          Text(this.chapterTitle)
            .fontSize(NxFontSize.lg)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.theme().barInk)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(this.bookTitle)
            .fontSize(NxFontSize.xs)
            .fontColor(this.theme().barInkSoft)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .padding({ left: NxGrid * 2, right: NxGrid * 4, top: NxGrid * 8, bottom: NxGrid * 3 })
      .backgroundColor(this.theme().barBg)

      Blank()
        .layoutWeight(1)
        .onClick(() => {
          this.panelOpen = false;
        })

      Column({ space: NxGrid * 2 }) {
        Row({ space: NxGrid * 2 }) {
          this.panelButton('上一章', false, (): void => {
            this.jumpChapter(this.chapterIndex - 1);
          })
          Column({ space: NxGrid }) {
            Progress({ value: this.pages.length > 0 ? this.pageIndex + 1 : 0, total: Math.max(1, this.pages.length), type: ProgressType.Linear })
              .width('100%')
              .height(4)
              .color(this.theme().barAccent)
            Text('本章 ' + (this.pageIndex + 1) + '/' + Math.max(1, this.pages.length) + ' 页 · 第 ' + (this.chapterIndex + 1) + '/' + Math.max(1, this.chapterCount) + ' 章')
              .fontSize(NxFontSize.xs)
              .fontColor(this.theme().barInkSoft)
          }
          .layoutWeight(1)
          this.panelButton('下一章', false, (): void => {
            this.jumpChapter(this.chapterIndex + 1);
          })
        }
        .width('100%')
        if (this.readingFeedback.length > 0) {
          Text(this.readingFeedback)
            .fontSize(NxFontSize.xs)
            .fontColor(this.theme().barInkSoft)
            .width('100%')
        }
        Row({ space: NxGrid * 2 }) {
          ForEach(NxReaderThemes, (theme: NxReaderTheme) => {
            Column() {
              Text(theme.label)
                .fontSize(NxFontSize.xs)
                .fontColor(theme.ink)
            }
            .width(34)
            .height(34)
            .borderRadius(17)
            .justifyContent(FlexAlign.Center)
            .backgroundColor(theme.swatch)
            .border({ width: this.themeId === theme.id ? 2 : 1, color: this.themeId === theme.id ? this.theme().barAccent : this.theme().barInkSoft })
            .onClick(() => {
              this.setTheme(theme.id);
            })
          }, (theme: NxReaderTheme) => theme.id)
          Blank()
          this.panelButton('A-', false, (): void => {
            this.changeFont(-1);
          })
          Text(String(this.readerFontSize()))
            .fontSize(NxFontSize.xs)
            .fontColor(this.theme().barInkSoft)
          this.panelButton('A+', false, (): void => {
            this.changeFont(1);
          })
        }
        .width('100%')
        Row() {
          this.panelButton('目录', false, (): void => {
            this.panelOpen = false;
            this.showToc = true;
          })
          this.panelButton(this.speaking ? '停止朗读' : '朗读', false, (): void => {
            this.toggleSpeak();
          })
          this.panelButton('问AI', true, (): void => {
            this.openAskSheet();
          })
          this.panelButton(this.completedThisSession ? '已读完' : (this.marking ? '记录中…' : '读完这章'), true, (): void => {
            this.markChapterComplete(true);
          })
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)
      }
      .width('100%')
      .padding({ left: NxGrid * 4, right: NxGrid * 4, top: NxGrid * 3, bottom: NxGrid * 6 })
      .backgroundColor(this.theme().barBg)
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  tocSheet() {
    Column({ space: NxGrid * 2 }) {
      Row() {
        Text('目录')
          .fontSize(NxFontSize.xl)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.palette().text1)
        Text(' · ' + this.chapters.length + ' 章')
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().text3)
        Blank()
        Text('关闭')
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().primary)
          .onClick(() => {
            this.showToc = false;
          })
      }
      .width('100%')
      List() {
        ForEach(this.chapters, (chapter: ChapterMeta) => {
          ListItem() {
            Row() {
              Text(chapter.title)
                .fontSize(NxFontSize.lg)
                .fontWeight(chapter.index === this.chapterIndex ? FontWeight.Medium : FontWeight.Normal)
                .fontColor(chapter.index === this.chapterIndex ? this.palette().primary : this.palette().text2)
                .layoutWeight(1)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              if (chapter.index === this.chapterIndex) {
                Text('在读')
                  .fontSize(NxFontSize.xs)
                  .fontColor(this.palette().primary)
              }
            }
            .width('100%')
            .padding({ top: NxGrid * 3, bottom: NxGrid * 3 })
            .onClick(() => {
              this.jumpChapter(chapter.index);
            })
          }
        }, (chapter: ChapterMeta) => String(chapter.index))
      }
      .layoutWeight(1)
      .width('100%')
      .divider({ strokeWidth: 1, color: this.palette().border })
    }
    .width('100%')
    .height('60%')
    .padding(NxGrid * 4)
    .borderRadius({ topLeft: NxRadius.md, topRight: NxRadius.md })
    .backgroundColor(this.palette().surface2)
  }

  @Builder
  askSheet(full: boolean) {
    Column({ space: NxGrid * 2 }) {
      Row({ space: NxGrid }) {
        Text(this.snapText.length > 0 ? '对着选中的句子' : this.chapterTitle)
          .fontSize(NxFontSize.xs)
          .fontColor(this.palette().primary)
          .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid, bottom: NxGrid })
          .borderRadius(NxRadius.xs)
          .backgroundColor(this.palette().primarySoft)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        Text('✕')
          .fontSize(NxFontSize.lg)
          .fontColor(this.palette().text3)
          .onClick(() => {
            this.showAskSheet = false;
          })
      }
      .width('100%')
      if (this.snapText.length > 0) {
        Text('「' + this.snapText + '」')
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().text3)
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }
      Scroll(this.askScroller) {
        Column({ space: NxGrid * 2 }) {
          if (this.askTurns.length > 0) {
            ForEach(this.askTurns, (turn: TimelineEntry) => {
              TimelineEntryView({
                entry: turn,
                onCitationAnchor: (anchor: string): void => {
                  this.jumpToParagraph(anchor);
                },
              })
            }, (turn: TimelineEntry) => turn.id + '_' + (turn.status !== undefined ? turn.status : ''))
          } else {
            Text('对着这一页或刚划的句子问我。')
              .fontSize(NxFontSize.sm)
              .fontColor(this.palette().text3)
          }
        }
        .width('100%')
      }
      .layoutWeight(1)
      .width('100%')
      .scrollBar(BarState.Off)
      .onDidScroll((xOffset: number, yOffset: number, scrollState: ScrollState) => {
        // 用户主动上滑离开底部就停止跟随；回到接近底部再恢复。
        try {
          this.askFollow = this.askScroller.isAtEnd() || this.askScroller.currentOffset().yOffset <= 0;
        } catch (err) {
          this.askFollow = true;
        }
      })
      if (!this.askFollow && this.askTurns.length > 0) {
        Text('回到最新回答')
          .fontSize(NxFontSize.xs)
          .fontColor(this.palette().primary)
          .padding({ left: NxGrid * 3, right: NxGrid * 3, top: NxGrid, bottom: NxGrid })
          .borderRadius(NxRadius.lg)
          .backgroundColor(this.palette().primarySoft)
          .onClick(() => {
            this.askFollow = true;
            this.scrollAskToEnd();
          })
      }
      Row({ space: NxGrid * 2 }) {
        TextInput({ placeholder: this.snapText.length > 0 ? '问这句' : '问这一页', text: this.askText })
          .layoutWeight(1)
          .height(38)
          .fontSize(NxFontSize.md)
          .onChange((value: string) => {
            this.askText = value;
          })
          .onSubmit(() => {
            this.ask(this.askText);
          })
          .onFocus(() => {
            this.readAskKeyboard();
          })
          .onBlur(() => {
            this.askKeyboardInset = 0;
          })
        Button(this.asking ? '…' : '问')
          .height(38)
          .fontSize(NxFontSize.md)
          .backgroundColor(this.palette().buttonFill)
          .fontColor(this.palette().onButton)
          .enabled(!this.asking)
          .onClick(() => {
            this.ask(this.askText);
          })
      }
      .width('100%')
    }
    .width('100%')
    .height(full ? '100%' : '62%')
    // 键盘弹起时整块面板上移：全局避让是 NONE（阅读器沉浸布局需要），这里按键盘高度自管。
    .padding({ left: NxGrid * 4, right: NxGrid * 4, top: NxGrid * 4, bottom: NxGrid * 4 + (full ? 0 : this.askKeyboardInset) })
    .margin({ bottom: full ? 0 : this.askKeyboardInset })
    .borderRadius({ topLeft: NxRadius.md, topRight: NxRadius.md })
    .backgroundColor(this.palette().surface2)
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.theme().bg)

      if (this.pages.length > 0) {
        Swiper(this.swiperController) {
          ForEach(this.pages, (page: ReaderPage) => {
            this.pageView(page)
          }, (page: ReaderPage) => page.key)
        }
        .width('100%')
        .height('100%')
        .index(this.pageIndex)
        .loop(false)
        .indicator(false)
        .cachedCount(1)
        .duration(220)
        .curve(Curve.EaseOut)
        .onChange((index: number) => {
          this.onReaderPageChange(index);
        })
      }

      if (this.pages.length > 0 && !this.panelOpen && !this.showAskSheet && !this.showToc && !this.loading) {
        this.tapZones()
      }

      if (this.loading) {
        Column({ space: NxGrid * 3 }) {
          SkeletonCard()
          SkeletonCard()
        }
        .width('100%')
        .height('100%')
        .padding({ left: PAGE_PADDING_X, right: PAGE_PADDING_X, top: PAGE_PADDING_TOP + NxGrid * 4 })
        .backgroundColor(this.theme().bg)
      }

      if (this.errorText.length > 0 && this.pages.length === 0 && !this.loading) {
        Column({ space: NxGrid * 3 }) {
          ErrorState({ message: this.errorText, onRetry: (): void => {
            this.load();
          } })
          Text('‹ 返回书房')
            .fontSize(NxFontSize.md)
            .fontColor(this.palette().primary)
            .onClick(() => {
              router.back();
            })
        }
        .width('100%')
        .height('100%')
        .padding(NxGrid * 6)
        .justifyContent(FlexAlign.Center)
        .backgroundColor(this.theme().bg)
      } else if (this.errorText.length > 0 && this.pages.length > 0) {
        Text(this.errorText)
          .fontSize(NxFontSize.xs)
          .fontColor(this.theme().barInkSoft)
          .padding({ left: NxGrid * 3, right: NxGrid * 3, top: NxGrid, bottom: NxGrid })
          .borderRadius(NxRadius.lg)
          .backgroundColor(this.theme().barBg)
          .position({ x: NxGrid * 4, y: NxGrid * 12 })
          .onClick(() => {
            this.errorText = '';
          })
      }

      if (!this.panelOpen && !this.showAskSheet && !this.showToc) {
        this.chrome()
      }

      if ((this.speaking || this.ttsPaused) && !this.showAskSheet && !this.panelOpen && !this.selectionActive()) {
        this.ttsBar()
      }

      if (this.selectionActive() && !this.showAskSheet && !this.panelOpen && !this.showToc) {
        this.selectionBar()
      }

      if (this.panelOpen && !this.showAskSheet && !this.showToc) {
        this.panel()
      }

      if (this.showAskSheet) {
        if (this.isWide) {
          // §6.4 宽屏断点：sheet 原组件变右栏，左教材右 AI，零组件重写
          Column() {
            this.askSheet(true)
          }
          .width('42%')
          .height('100%')
          .position({ right: 0, top: 0 })
        } else {
          Column()
            .width('100%')
            .height('100%')
            .backgroundColor(this.palette().overlay)
            .onClick(() => {
              this.showAskSheet = false;
            })
        }
      }
      if (this.showAskSheet && !this.isWide) {
        this.askSheet(false)
      } else if (this.showToc) {
        Column()
          .width('100%')
          .height('100%')
          .backgroundColor(this.palette().overlay)
          .onClick(() => {
            this.showToc = false;
          })
        this.tocSheet()
      }

      if (this.zoomImageUrl.length > 0) {
        Stack({ alignContent: Alignment.TopEnd }) {
          Image(this.zoomImageUrl)
            .width('100%')
            .height('100%')
            .objectFit(ImageFit.Contain)
            .gesture(PinchGesture({ fingers: 2 }).onActionUpdate((event: GestureEvent) => {
              this.zoomScale = Math.max(1, Math.min(4, event.scale));
            }))
            .scale({ x: this.zoomScale, y: this.zoomScale })
          Text('✕')
            .fontSize(NxFontSize.xl)
            .fontColor(this.palette().onPrimary)
            .padding(NxGrid * 4)
            .onClick(() => {
              this.zoomImageUrl = '';
              this.zoomScale = 1;
            })
        }
        .width('100%')
        .height('100%')
        .backgroundColor(this.palette().overlay)
        .onClick(() => {
          this.zoomImageUrl = '';
          this.zoomScale = 1;
        })
      }
    }
    .width('100%')
    .height('100%')
    .id('nx_reader_root')
    .backgroundColor(this.theme().bg)
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    .onAreaChange((oldArea: Area, newArea: Area) => {
      const width = Number(newArea.width);
      const height = Number(newArea.height);
      if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
        return;
      }
      const changed = Math.abs(width - this.areaWidth) > 1 || Math.abs(height - this.areaHeight) > 1;
      this.areaWidth = width;
      this.areaHeight = height;
      this.isWide = width > 840;
      if (changed) {
        this.schedulePaginate();
      }
    })
  }
}
