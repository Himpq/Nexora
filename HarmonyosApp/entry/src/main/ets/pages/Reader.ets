/**
 * §6.4 阅读器（沉浸面）—— 翻页式书页。
 *
 * 交互对齐主流阅读 App（番茄小说式）：
 *   · 章节按屏幕实际尺寸分页（MeasureText 精确排版），左右滑动或点击左右屏翻页，点击中间呼出操作面板；
 *   · 章末再翻 → 自动记「读完这一章」并进入下一章（课程进度由 chapter_completed 记录驱动）；
 *   · 点击左 30% 上一页、右 30% 下一页、中间呼出操作面板（覆盖整页热区，不让正文 Text 吞掉点击）；
 *   · 长按选字 → 系统手柄 + 菜单：问AI / 复制 / 朗读 / 划线；划线后弹出番茄小说式面板（直线 / 波浪 / 荧光笔 + 四色 + 删除）；
 *   · 划线按字范围持久化，同一段可多次划不同句，可改样式/颜色或删除；
 *   · 阅读状态（纸色主题 / 字号 / 章节 / 页）本地持久化，「继续学习」回到上次读到的那一页；
 *   · 原右缘 AI 浮球并入操作面板；AI 问答走底部 sheet（宽屏变右栏）。
 * 事件上报：selection / ask / snapshot / focus_in / focus_out / session_complete（§4.3 信号源）。
 */
import { router, window } from '@kit.ArkUI';
import { MeasureText } from '@kit.ArkUI';
import { batteryInfo, pasteboard } from '@kit.BasicServicesKit';
import { common } from '@kit.AbilityKit';
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
import { ReadingPosition, nxReadPosition, nxSavePosition } from '../services/ReadingState';
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
const SPLIT_PUNCT: string = '。！？；」”…\n.!?;';

@Entry
@Component
struct Reader {
  @State loading: boolean = false;
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
  @State selOffset: number = 0;
  @State selStart: number = 0;
  @State selEnd: number = 0;
  @State selText: string = '';
  @State flashPara: number = -1;
  @State clockText: string = '';
  @State batteryPct: number = -1;
  @State immersiveOk: boolean = false;
  @State askTurns: TimelineEntry[] = [];
  @State ttsPaused: boolean = false;
  @State fontIndex: number = 1;
  @State themeId: string = 'paper';
  @State panelOpen: boolean = false;
  @State showToc: boolean = false;
  @State showAskSheet: boolean = false;
  @State askText: string = '';
  @State asking: boolean = false;
  @State answerEntry: TimelineEntry | null = null;
  @State isWide: boolean = false;
  @State speaking: boolean = false;
  @State areaWidth: number = 0;
  @State areaHeight: number = 0;
  @State completedThisSession: boolean = false;
  @State marking: boolean = false;
  @State markStyleOpen: boolean = false;
  @State pendingStyle: string = 'solid';
  @State pendingColor: string = 'yellow';
  @State snapPara: number = -1;
  @State snapStart: number = 0;
  @State snapEnd: number = 0;
  @State snapText: string = '';
  @State selBlockTop: number = 0;
  @State selBlockHeight: number = 0;
  @State markEpoch: number = 0;
  @StorageProp('nxDarkMode') nxDark: boolean = false;
  private readerApi: ReaderApi = new ReaderApi();
  private agentApi: AgentApi = new AgentApi();
  private swiperController: SwiperController = new SwiperController();
  private lectureId: string = '';
  private bookId: string = '';
  private flowId: string = '';
  private resumeRequested: boolean = false;
  private pendingPara: number = -1;
  private sessionStart: number = Date.now();
  private heartbeatId: number = -1;
  private paginateId: number = -1;
  private chromeId: number = -1;
  private lastSelAt: number = 0;
  private hostWindow: window.Window | undefined = undefined;

  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext();
    if (context !== undefined) {
      sharedCache.init(context);
      this.restoreReaderSettings();
    }
    const params = router.getParams() as Record<string, Object>;
    if (params !== undefined && params !== null) {
      this.lectureId = params.lecture_id as string;
      this.bookId = params.book_id as string;
      this.bookTitle = params.book_title as string;
      this.chapterIndex = params.chapter_index as number;
      if (params.flow_id !== undefined) {
        this.flowId = params.flow_id as string;
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
    this.stopHeartbeat();
    this.stopChrome();
    this.applyImmersive(false);
    if (this.paginateId >= 0) {
      clearTimeout(this.paginateId);
    }
    sharedTts.stop();
    this.savePosition();
    const duration = Date.now() - this.sessionStart;
    const events: TelemetryEvent[] = [
      { stream: 'reading', event: 'focus_out', bid: this.bookId, ci: this.chapterIndex, si: this.currentFirstPara(), focus: 'blur' },
      {
        stream: 'reading',
        event: 'session_complete',
        bid: this.bookId,
        ci: this.chapterIndex,
        si: this.currentFirstPara(),
        extra: { 'duration_ms': String(duration) },
      },
    ];
    this.readerApi.postTelemetry(events);
    if (this.flowId.length > 0) {
      this.agentApi.postFlowEvent(this.flowId, 'reading_done');
    }
    sharedLiveView.stopStudy('读了 ' + Math.max(1, Math.round(duration / 60000)) + ' 分钟' + (this.flowId.length > 0 ? ' · 接下来出题' : ''));
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
      win.setWindowSystemBarProperties({
        statusBarColor: this.theme().bg,
        navigationBarColor: this.theme().bg,
        statusBarContentColor: this.theme().chromeInk,
        navigationBarContentColor: this.theme().chromeInk,
      }).catch((err: Error) => {
      });
      this.immersiveOk = enable;
    }).catch((err: Error) => {
      this.immersiveOk = false;
    });
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
    if (this.resumeRequested) {
      this.chapterIndex = saved.chapter;
      this.pendingPara = saved.para;
    } else if (saved.chapter === this.chapterIndex) {
      this.pendingPara = saved.para;
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
      this.startHeartbeat();
    } catch (err) {
      const e = err as BusinessError;
      this.errorText = e.message.length > 0 ? e.message : '加载章节失败';
    } finally {
      this.loading = false;
    }
  }

  async loadChapter(index: number): Promise<void> {
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
        const e = err as BusinessError;
        throw new Error(e.message.length > 0 ? e.message : '章节不可用');
      }
    }
    this.chapterIndex = payload.chapter_index;
    this.chapterTitle = payload.chapter_title;
    this.chapterCount = payload.chapter_count;
    this.chapterRange = payload.chapter_range;
    this.paragraphs = payload.paragraphs;
    this.selectedPara = -1;
    this.answerEntry = null;
    this.askTurns = [];
    this.completedThisSession = false;
    this.loadMarks();
    this.paginate();
    this.loading = false;
    this.readerApi.postTelemetry([
      { stream: 'reading', event: 'focus_in', bid: this.bookId, ci: this.chapterIndex, si: 0, focus: 'reader' },
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
      const ratio = this.pages.length > 0 ? Math.round((this.pageIndex / this.pages.length) * 100) / 100 : 0;
      this.readerApi.postTelemetry([
        { stream: 'reading', event: 'snapshot', bid: this.bookId, ci: this.chapterIndex, si: this.currentFirstPara(), scroll: ratio },
      ]);
    }, 10000);
  }

  stopHeartbeat(): void {
    if (this.heartbeatId >= 0) {
      clearInterval(this.heartbeatId);
      this.heartbeatId = -1;
    }
  }

  // ---------- 持久化：位置 / 划线 ----------

  private savePosition(): void {
    if (this.lectureId.length === 0 || this.bookId.length === 0 || this.pages.length === 0) {
      return;
    }
    const position: ReadingPosition = new ReadingPosition();
    position.chapter = this.chapterIndex;
    position.para = this.currentFirstPara();
    position.chapterTitle = this.chapterTitle;
    position.bookTitle = this.bookTitle;
    position.lectureId = this.lectureId;
    position.bookId = this.bookId;
    position.updatedAt = Date.now();
    nxSavePosition(position);
  }

  private underlineKey(): string {
    return 'nx_ul_' + this.lectureId + '_' + this.bookId + '_' + this.chapterIndex;
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

  rememberSelection(block: PageBlock, start: number, end: number): void {
    this.selectedPara = block.paraIndex;
    this.selOffset = block.paraOffset;
    this.selStart = start;
    this.selEnd = end;
    this.selBlockTop = block.top;
    this.selBlockHeight = block.height;
    if (end > start) {
      this.selText = block.text.slice(start, end);
      this.snapPara = block.paraIndex;
      this.snapStart = block.paraOffset + start;
      this.snapEnd = block.paraOffset + end;
      this.snapText = this.selText;
      this.lastSelAt = Date.now();
      const existing = this.overlappingMark();
      if (existing !== null) {
        this.pendingStyle = existing.style;
        this.pendingColor = existing.color;
      }
    } else {
      this.selText = '';
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

  applyMark(style: string, color: string): void {
    if (!this.snapshotValid()) {
      return;
    }
    const start = this.snapStart;
    const end = this.snapEnd;
    const next: ReaderMark[] = [];
    for (const mark of this.marks) {
      if (mark.paraIndex !== this.snapPara || mark.end <= start || mark.start >= end) {
        next.push(mark);
      }
    }
    const added = new ReaderMark();
    added.paraIndex = this.snapPara;
    added.start = start;
    added.end = end;
    added.style = style;
    added.color = color.length > 0 ? color : 'yellow';
    next.push(added);
    this.marks = next;
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

  removeSnapshotMarks(): void {
    if (!this.snapshotValid()) {
      return;
    }
    const next: ReaderMark[] = [];
    for (const mark of this.marks) {
      if (mark.paraIndex !== this.snapPara || mark.end <= this.snapStart || mark.start >= this.snapEnd) {
        next.push(mark);
      }
    }
    this.marks = next;
    this.markEpoch = this.markEpoch + 1;
    this.persistMarks();
    this.markStyleOpen = false;
  }

  private clearSelectionState(): void {
    this.selectedPara = -1;
    this.selStart = 0;
    this.selEnd = 0;
    this.selText = '';
    this.snapPara = -1;
    this.snapStart = 0;
    this.snapEnd = 0;
    this.snapText = '';
    this.markStyleOpen = false;
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

  /** 把放不进一页的长段按标点拆成若干块，每块都能放进 maxHeight。 */
  private splitToFit(text: string, heading: number, maxHeight: number): string[] {
    const chunks: string[] = [];
    let rest = text;
    let guard = 0;
    while (rest.length > 0 && guard < 60) {
      guard++;
      if (this.measureHeight(rest, heading) <= maxHeight) {
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
    const keepPara = this.pendingPara >= 0 ? this.pendingPara : this.currentFirstPara();
    this.pendingPara = -1;
    const pageHeight = this.areaHeight - PAGE_PADDING_TOP - PAGE_PADDING_BOTTOM;
    const result: ReaderPage[] = [];
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
        block.key = 'b' + (blockSeq++);
        block.paraIndex = paragraph.index;
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
      let paraCursor = 0;
      for (const chunk of chunks) {
        const block = new PageBlock();
        block.key = 'b' + (blockSeq++);
        block.paraIndex = paragraph.index;
        block.text = chunk;
        block.heading = paragraph.heading_level;
        block.paraOffset = paraCursor;
        block.height = this.measureHeight(chunk, paragraph.heading_level);
        place(block);
        paraCursor += chunk.length;
      }
    }
    flush();
    this.pages = result;
    let target = 0;
    for (let i = 0; i < result.length; i++) {
      if (result[i].firstPara <= keepPara) {
        target = i;
      } else {
        break;
      }
    }
    this.pageIndex = target;
    this.savePosition();
  }

  // ---------- 翻页 ----------

  goNext(): void {
    if (this.pageIndex < this.pages.length - 1) {
      this.swiperController.showNext();
      return;
    }
    this.finishChapterAndAdvance();
  }

  goPrev(): void {
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
    if (index < 0 || index >= this.chapterCount) {
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
    await this.markChapterComplete(false);
    if (this.chapterIndex + 1 < this.chapterCount) {
      this.jumpChapter(this.chapterIndex + 1);
    } else {
      this.toast('这本书读到最后一页了。');
    }
  }

  async markChapterComplete(fromButton: boolean): Promise<void> {
    if (this.marking || this.chapterTitle.length === 0) {
      return;
    }
    if (this.completedThisSession) {
      if (fromButton) {
        this.toast('这一章已经记为读完。');
      }
      return;
    }
    this.marking = true;
    try {
      await this.readerApi.postChapterComplete(this.lectureId, this.bookId, this.chapterTitle, this.chapterRange);
      this.completedThisSession = true;
      AppStorage.setOrCreate('nxStudyTick', Date.now());
      this.toast('记下了：' + this.chapterTitle + ' 读完。');
    } catch (err) {
      const e = err as BusinessError;
      this.toast('这一章没记上：' + (e.message.length > 0 ? e.message : '网络错误'));
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
    if (this.markStyleOpen) {
      this.markStyleOpen = false;
      return;
    }
    if (this.snapEnd > this.snapStart || this.selectedPara >= 0) {
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
    const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
    await pasteboard.getSystemPasteboard().setData(data);
    this.toast('已复制选中的句子。');
  }

  openAskSheet(): void {
    this.panelOpen = false;
    this.markStyleOpen = false;
    this.showAskSheet = true;
    this.askText = '';
  }

  openMarkStyle(): void {
    if (!this.snapshotValid()) {
      return;
    }
    this.panelOpen = false;
    this.markStyleOpen = true;
    if (this.overlappingMark() === null) {
      this.applyMark(this.pendingStyle, this.pendingColor);
    }
  }

  async ask(question: string): Promise<void> {
    const text = question.trim();
    if (text.length === 0 || this.asking) {
      return;
    }
    this.asking = true;
    this.readerApi.postTelemetry([
      {
        stream: 'reading',
        event: 'ask',
        bid: this.bookId,
        ci: this.chapterIndex,
        si: this.selectedPara >= 0 ? this.selectedPara : this.currentFirstPara(),
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
    try {
      const target: LearnTarget = {
        lecture_id: this.lectureId,
        lecture_title: '',
        book_id: this.bookId,
        book_title: this.bookTitle,
        chapter_index: this.chapterIndex,
        chapter_name: this.chapterTitle,
        chapter_range: '',
      };
      const selectedText = this.selectedExcerpt();
      const env: AgentEnvelope = await this.agentApi.postAskInContext(text, target, selectedText);
      const data: AskAnswer = env.data as AskAnswer;
      if (data === null || data === undefined || typeof data.answer !== 'string' || data.answer.trim().length === 0) {
        throw new Error('这次我没给出答案。');
      }
      const anchorPara = this.selectedPara >= 0 ? this.selectedPara : this.currentFirstPara();
      const excerpt = selectedText.slice(0, 120);
      const citation: CitationCard = {
        type: 'citation',
        book: this.bookTitle,
        chapter: this.chapterTitle,
        excerpt: excerpt.length > 0 ? excerpt : this.chapterTitle,
        anchor: String(anchorPara),
      };
      const answer: TimelineEntry = {
        id: String(anchorPara) + '_' + Date.now(),
        kind: 'agent_msg',
        ts: Date.now(),
        text: data.answer,
        reason: '依据教材' + this.chapterTitle + '原文。',
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
      this.askText = '';
    } catch (err) {
      const e = err as BusinessError;
      const fail: TimelineEntry = {
        id: 'err_' + Date.now(),
        kind: 'system',
        ts: Date.now(),
        text: '这个问题我没接上：' + (e.message.length > 0 ? e.message : '网络错误'),
        unattended: false,
      };
      this.answerEntry = fail;
      const turns: TimelineEntry[] = [];
      for (const turn of this.askTurns) {
        if (turn.id !== thinkId) {
          turns.push(turn);
        }
      }
      turns.push(fail);
      this.askTurns = turns;
    } finally {
      this.asking = false;
    }
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
        this.pageIndex = i;
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
    } else {
      Text() {
        ForEach(this.blockSpans(block), (span: MarkSpan) => {
          this.markSpanView(span, block)
        }, (span: MarkSpan) => span.key + '_' + this.markEpoch)
      }
      .fontSize(block.heading > 0 ? this.readerFontSize() + 3 : this.readerFontSize())
      .fontWeight(block.heading > 0 ? FontWeight.Bold : FontWeight.Normal)
      .fontColor(this.theme().ink)
      .lineHeight(this.lineHeight() + 'vp')
      .width('100%')
      .copyOption(CopyOptions.LocalDevice)
      .draggable(false)
      .bindSelectionMenu(TextSpanType.TEXT, this.selectMenu, TextResponseType.LONG_PRESS)
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

  /** 系统选区菜单必须用 Menu/MenuItem，外层 Column 的 onClick 不会被点到。 */
  @Builder
  selectMenu() {
    Menu() {
      MenuItem({ content: '问AI' })
        .onClick(() => {
          this.openAskSheet();
        })
      MenuItem({ content: '复制' })
        .onClick(() => {
          this.copySelected();
        })
      MenuItem({ content: '朗读' })
        .onClick(() => {
          this.speakSelected();
        })
      MenuItem({ content: '划线' })
        .onClick(() => {
          this.openMarkStyle();
        })
      if (this.overlappingMark() !== null) {
        MenuItem({ content: '删除划线' })
          .onClick(() => {
            this.removeSnapshotMarks();
          })
      }
    }
  }

  @Builder
  stylePreview(label: string, style: string) {
    Column({ space: 2 }) {
      Text() {
        Span('A')
          .fontSize(NxFontSize.xxl)
          .fontColor(this.theme().barInk)
          .decoration({
            type: style === 'solid' || style === 'wavy' ? TextDecorationType.Underline : TextDecorationType.None,
            color: nxMarkSwatch(this.pendingColor).line,
            style: style === 'wavy' ? TextDecorationStyle.WAVY : TextDecorationStyle.SOLID,
          })
          .textBackgroundStyle({
            color: style === 'mark' ? nxMarkSwatch(this.pendingColor).fill : Color.Transparent,
            radius: 2,
          })
      }
      Text(label)
        .fontSize(NxFontSize.xs)
        .fontColor(this.pendingStyle === style ? this.theme().barAccent : this.theme().barInkSoft)
    }
    .width(64)
    .height(56)
    .justifyContent(FlexAlign.Center)
    .borderRadius(NxRadius.xs)
    .backgroundColor(this.pendingStyle === style ? this.theme().markBg : Color.Transparent)
    .border({
      width: this.pendingStyle === style ? 1 : 0,
      color: this.theme().barAccent,
    })
    .onClick(() => {
      this.applyMark(style, this.pendingColor);
    })
  }

  /** 番茄小说式第二后面板：直线 / 波浪 / 荧光笔 + 四色 + 删除。 */
  @Builder
  markStylePanel() {
    Column({ space: NxGrid * 2 }) {
      Row({ space: NxGrid * 2 }) {
        this.stylePreview('直线', 'solid')
        this.stylePreview('波浪', 'wavy')
        this.stylePreview('荧光笔', 'mark')
        Blank()
        if (this.overlappingMark() !== null) {
          Text('删除划线')
            .fontSize(NxFontSize.sm)
            .fontColor(this.theme().barAccent)
            .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid * 2, bottom: NxGrid * 2 })
            .onClick(() => {
              this.removeSnapshotMarks();
            })
        }
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      Row({ space: NxGrid * 4 }) {
        ForEach(NxMarkSwatches, (swatch: NxMarkSwatch) => {
          Column()
            .width(28)
            .height(28)
            .borderRadius(14)
            .backgroundColor(swatch.line)
            .border({
              width: this.pendingColor === swatch.id ? 2 : 0,
              color: this.theme().barInk,
            })
            .onClick(() => {
              this.applyMark(this.pendingStyle, swatch.id);
            })
        }, (swatch: NxMarkSwatch) => swatch.id)
      }
      .width('100%')
    }
    .width('100%')
    .padding({ left: NxGrid * 4, right: NxGrid * 4, top: NxGrid * 3, bottom: NxGrid * 6 })
    .backgroundColor(this.theme().barBg)
    .borderRadius({ topLeft: NxRadius.md, topRight: NxRadius.md })
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
      Scroll() {
        Column({ space: NxGrid * 2 }) {
          if (this.askTurns.length > 0) {
            ForEach(this.askTurns, (turn: TimelineEntry) => {
              TimelineEntryView({
                entry: turn,
                onCitationAnchor: (anchor: string): void => {
                  this.jumpToParagraph(anchor);
                },
              })
            }, (turn: TimelineEntry) => turn.id)
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
        Button(this.asking ? '…' : '问')
          .height(38)
          .fontSize(NxFontSize.md)
          .backgroundColor(this.palette().primary)
          .fontColor(this.palette().onPrimary)
          .enabled(!this.asking)
          .onClick(() => {
            this.ask(this.askText);
          })
      }
      .width('100%')
    }
    .width('100%')
    .height(full ? '100%' : '62%')
    .padding(NxGrid * 4)
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
          if (index !== this.pageIndex) {
            this.pageIndex = index;
            this.clearSelectionState();
            this.savePosition();
          }
        })
      }

      if (this.pages.length > 0 && !this.panelOpen && !this.showAskSheet && !this.showToc && !this.loading &&
        (!this.snapshotValid() || this.markStyleOpen)) {
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

      if ((this.speaking || this.ttsPaused) && !this.showAskSheet && !this.panelOpen && !this.markStyleOpen) {
        this.ttsBar()
      }

      if (this.markStyleOpen && !this.showAskSheet && !this.panelOpen) {
        this.markStylePanel()
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
    }
    .width('100%')
    .height('100%')
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
