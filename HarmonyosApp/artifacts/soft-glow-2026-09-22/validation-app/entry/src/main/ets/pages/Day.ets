/**
 * 它的一天（重构方案 §二·第三步）—— App 唯一的主界面。
 *
 * 不再是「时间线 / 书房 / 它的判断」三个 Tab，而是一条以时间为轴的日志：夜（它在工作）、
 * 晨（它报告）、日（它陪着，但克制）。条目是第一人称便签，「为什么」折叠在下面；
 * agent_hold 以淡色呈现，克制本身就是内容。长按任一条 → 抽屉：它当时看到了什么 + 它眼里的你
 * （原 Tab 3 并入）。书房（课程 / 教材）退为右上角的半屏抽屉。
 *
 * 数据：GET /events ＋ GET /today；前台时上报设备上下文 POST /context/device。
 */
import { TimelineEntry, PlanCard, PlanCardTarget, PlanData, TodayData, EventsData, OpenSessionData, LearnTarget, FlowStateData, ProactiveCard, AskAnswer, ContextData } from '../models/Index';
import { AgentApi, AgentEnvelope } from '../services/AgentApi';
import { TimelineEntryView } from '../components/entry/TimelineEntryView';
import { nxDayKey, nxDayLabel, nxTimePhase } from '../components/entry/TimelineRows';
import { InspectSheet } from '../components/InspectSheet';
import { StudyView } from './Study';
import { SkeletonCard, ErrorState } from '../components/common/States';
import { nxPalette, NxPalette, NxRadius, NxGrid, NxFontSize, NxFontFamily, NxMotion, NxShadow } from '../theme/DesignTokens';
import { BusinessError } from '@kit.BasicServicesKit';
import { common } from '@kit.AbilityKit';
import { KeyboardAvoidMode, router, window } from '@kit.ArkUI';
import { sharedAsr } from '../capability/asr';
import { sharedDnd } from '../capability/dnd';
import { sharedNotify } from '../capability/notify';
import { sharedCalendar } from '../capability/calendar';
import { sharedForm } from '../capability/form';
import { sharedDeviceContext } from '../capability/context';
import { sharedPermission, PERMISSION_MICROPHONE } from '../capability/permission';
import { sharedCache } from '../services/cache/CacheStore';
import { nxReadingScope } from '../services/ReadingState';
import { Identity } from '../services/Identity';
import { sharedSoftGlowState } from '../services/SoftGlowState';
import { ReplyCancellation } from '../services/ReplyCancellation';
import { AmbientGlow } from '../components/AmbientGlow';
import { GlowSettings } from '../components/GlowSettings';
import { nxApplySystemBars } from '../theme/SystemBars';

interface DayChip {
  key: string;
  label: string;
  count: number;
}

/** 一天的三幕：夜 / 晨 / 日。 */
class DayRow {
  key: string = '';
  isAct: boolean = false;
  actLabel: string = '';
  actHint: string = '';
  entry: TimelineEntry = { id: '', kind: 'system', ts: 0, text: '', unattended: false };
}

/**
 * 明确的行动指令才进计划（2026-09-21 审查 I6）：原正则把「我不想开始学习，请解释…」「请解释‘今天学什么’这句话」
 * 都判成计划请求。现在：① 含否定 / 引用 / 提问语气的句子一律当问题；② 只有短句本身就是指令时才当计划。
 * 导出为纯函数便于探针测试。
 */
export function nxIsLearningIntent(raw: string): boolean {
  const text = raw.trim();
  if (text.length === 0 || text.length > 24) {
    return false;
  }
  if (/(不想|不要|别|不用|不是|什么意思|是什么|为什么|怎么|如何|解释|讲一下|讲讲|请问|吗|呢|？|\?|「|」|“|”|‘|’|引号|这句话)/.test(text)) {
    return false;
  }
  return /^(好的?[，,]?)?(开始学习|继续学习|安排(一下|今天|明天)?的?学习|学习计划|今天学什么|明天学什么|下一章|打开(课程|教材|阅读)|复习计划|帮我安排)/.test(text);
}

/** 一句话里有没有明确的「排进日历」意图（计划成功后才据此写日程，不再每次计划都写）。 */
export function nxWantsCalendar(raw: string): boolean {
  return /(日历|日程|提醒我|定个?时间|排到|排进)/.test(raw);
}

function actOf(ts: number): string {
  return nxTimePhase(ts);
}

@Component
export struct DayView {
  @State loading: boolean = false;
  @State errorText: string = '';
  @State entries: TimelineEntry[] = [];
  @State rows: DayRow[] = [];
  @State dayChips: DayChip[] = [];
  @State selectedDayKey: string = '';
  @State statusWord: string = '看着';
  @State statusHint: string = '';
  @State todayText: string = '';
  @State todayPercent: number = 0;
  @State breathe: boolean = false;
  @State inputText: string = '';
  @State sending: boolean = false;
  @State listening: boolean = false;
  /** 书房抽屉的开合放在 AppStorage：从书房推入的页面返回时（Index.onPageShow）要能重新拉起它。 */
  @StorageLink('nxStudyOpen') @Watch('onGlowVisibilityChanged') studyOpen: boolean = false;
  @State @Watch('onGlowVisibilityChanged') inspectOpen: boolean = false;
  @State inspectEntry: TimelineEntry | null = null;
  @State showBackTop: boolean = false;
  @State unreadDays: string[] = [];
  @State keyboardInset: number = 0;
  @State keyboardHeight: number = 0;
  @State navigationBottomInset: number = 0;
  @State systemTopInset: number = 0;
  @State @Watch('onGlowVisibilityChanged') glowSettingsOpen: boolean = false;
  @State topGlow: boolean = false;
  @State replyPhase: string = 'idle';
  @State viewportHeight: number = 720;
  @StorageProp('nxGlowEnabled') @Watch('onGlowVisibilityChanged') glowEnabled: boolean = true;
  @StorageProp('nxGlowReduceMotion') @Watch('onGlowVisibilityChanged') glowReduceMotion: boolean = false;
  @StorageProp('nxSystemReduceMotion') @Watch('onGlowVisibilityChanged') systemReduceMotion: boolean = false;
  @StorageProp('nxGlowPeriod') glowPeriod: string = 'day';
  @StorageProp('nxAppForeground') @Watch('onGlowVisibilityChanged') appForeground: boolean = true;
  @StorageProp('nxHomeVisible') @Watch('onGlowVisibilityChanged') homeVisible: boolean = true;
  /** 语音权限被永久拒绝：入口显示「去设置」而不是无效的重试。 */
  @State micBlocked: boolean = false;
  /** 当前自然日（跨午夜 / 回前台时更新），并入行 key 让「今天 / 昨天」标签重算。 */
  @State todayKey: string = nxDayKey(Date.now());
  @StorageProp('nxDarkMode') nxDark: boolean = false;
  @StorageProp('nxStudyTick') @Watch('onStudyChanged') studyTick: number = 0;
  @StorageProp('nxForegroundTick') @Watch('onForeground') foregroundTick: number = 0;
  private api: AgentApi = new AgentApi();
  private scroller: ListScroller = new ListScroller();
  private lastTarget: LearnTarget | null = null;
  private seenDecisionIds: string[] = [];
  private launchDecisionId: string = '';
  private hostWindow: window.Window | undefined = undefined;
  private attached: boolean = false;
  private eventsVersion: number = 0;
  private todayVersion: number = 0;
  private feedbackRefreshing: boolean = false;
  private feedbackPending: boolean = false;
  private midnightTimer: number = -1;
  private glyphTimer: number = -1;
  private glyphVersion: number = 0;
  /** 本地未确认的用户消息（发送中 / 失败），loadEvents 用服务器记录替换列表时保留它们。 */
  private localPending: TimelineEntry[] = [];
  private replyVersion: number = 0;
  private replyCancellation: ReplyCancellation | null = null;
  private activeUserId: string = '';
  private activeThinkingId: string = '';

  aboutToAppear(): void {
    this.attached = true;
    const glowContext = this.getUIContext().getHostContext();
    if (glowContext !== undefined) {
      sharedSoftGlowState.init(glowContext);
    }
    this.launchDecisionId = AppStorage.get<string>('nxLaunchDecision') || '';
    const route: string = AppStorage.get<string>('nxLaunchRoute') || '';
    if (route === 'study' || route === 'reader') {
      this.studyOpen = true;
    } else if (route === 'mirror' || route === 'judgment') {
      this.inspectEntry = null;
      this.inspectOpen = true;
    } else if (route === 'review') {
      // 小艺「考考我」：直接进今日复习（后台已排题时页面据 nxPendingReviewTask 续接）。
      AppStorage.setOrCreate('nxReturnToStudy', true);
      router.pushUrl({ url: 'pages/TodayTask', params: {} });
    }
    if (route.length > 0) {
      AppStorage.setOrCreate('nxLaunchRoute', '');
    }
    this.syncGlyphMotion();
    try {
      // 主对话自管键盘（底部输入栏按键盘高度上推，列表跟着滚到底）；全局其余页面走 RESIZE。
      this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.NONE);
    } catch (err) {
      // 由 listenKeyboard 按键盘高度上推页面
    }
    this.listenKeyboard();
    this.scheduleMidnight();
    this.load();
  }

  aboutToDisappear(): void {
    this.attached = false;
    this.syncGlyphMotion();
    this.replyVersion++;
    this.replyCancellation?.cancel();
    this.replyCancellation = null;
    this.topGlow = false;
    this.eventsVersion++;
    this.todayVersion++;
    if (this.midnightTimer >= 0) {
      clearTimeout(this.midnightTimer);
      this.midnightTimer = -1;
    }
    try {
      this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
    } catch (err) {
      // 忽略
    }
    if (this.hostWindow !== undefined) {
      try {
        this.hostWindow.off('avoidAreaChange');
      } catch (err) {
        // 窗口已销毁
      }
      try {
        this.hostWindow.off('keyboardHeightChange');
      } catch (err) {
        // 窗口已销毁
      }
    }
  }

  private palette(): NxPalette {
    return nxPalette(this.nxDark);
  }

  private glowExposed(): boolean {
    return this.appForeground && this.homeVisible && !this.studyOpen && !this.inspectOpen && !this.glowSettingsOpen;
  }

  private motionAllowed(): boolean {
    return this.glowExposed() && !this.glowReduceMotion && !this.systemReduceMotion;
  }

  onGlowVisibilityChanged(): void {
    // 关闭设置、回前台或重新启用柔光，都不能重放已看过的每日顶部光。
    if (!this.glowEnabled || !this.glowExposed()) {
      this.topGlow = false;
    }
    this.syncGlyphMotion();
  }

  private syncGlyphMotion(): void {
    const version: number = ++this.glyphVersion;
    if (this.glyphTimer >= 0) {
      clearTimeout(this.glyphTimer);
      this.glyphTimer = -1;
    }
    this.breathe = false;
    if (!this.attached || !this.motionAllowed()) {
      return;
    }
    // Start only after the animated node is mounted; reopening a sheet or
    // turning motion back on creates a new node and needs a fresh first frame.
    this.glyphTimer = setTimeout((): void => {
      if (version !== this.glyphVersion || !this.attached || !this.motionAllowed()) {
        return;
      }
      this.glyphTimer = -1;
      this.breathe = true;
    }, 60);
  }

  private topGlowExtent(): number {
    return Math.max(110, Math.min(250, (this.viewportHeight - this.keyboardInset) * 0.27));
  }

  stopReply(): void {
    if (!this.sending) {
      return;
    }
    this.replyVersion++;
    this.replyCancellation?.cancel();
    this.replyCancellation = null;
    this.sending = false;
    this.replyPhase = 'stopped';
    this.topGlow = false;
    this.forgetPending(this.activeUserId);
    this.setUserStatus(this.activeUserId, undefined);
    for (const item of this.entries) {
      if (item.id === this.activeThinkingId) {
        item.text = item.text.length > 0 ? item.text + '\n\n已停止回复。' : '已停止这次回复。';
        item.status = undefined;
      }
    }
    this.entries = this.entries.slice();
    this.rebuild(this.entries);
  }

  // ---------- 日期 ----------

  /** 跨午夜（2026-09-21 审查 P2-14）：到 00:00 重算日期标签；回前台也重算。 */
  private scheduleMidnight(): void {
    if (this.midnightTimer >= 0) {
      clearTimeout(this.midnightTimer);
    }
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2).getTime();
    this.midnightTimer = setTimeout((): void => {
      this.midnightTimer = -1;
      this.refreshDayLabels();
      this.scheduleMidnight();
    }, Math.max(1000, next - now.getTime()));
  }

  onForeground(): void {
    if (this.attached) {
      this.refreshDayLabels();
    }
  }

  private refreshDayLabels(): void {
    const key = nxDayKey(Date.now());
    if (key === this.todayKey) {
      return;
    }
    this.todayKey = key;
    this.rebuild(this.entries);
    this.deriveStatus(this.entries);
  }

  // ---------- 数据 ----------

  onStudyChanged(): void {
    if (this.attached) {
      this.refreshLearningFeedback();
    }
  }

  private async refreshLearningFeedback(): Promise<void> {
    if (this.sending || this.feedbackRefreshing) {
      this.feedbackPending = true;
      return;
    }
    this.feedbackRefreshing = true;
    try {
      do {
        this.feedbackPending = false;
        await this.loadToday();
        await this.loadEvents();
      } while (this.feedbackPending && this.attached && !this.sending);
    } finally {
      this.feedbackRefreshing = false;
    }
  }

  async load(): Promise<void> {
    this.loading = true;
    this.errorText = '';
    const context = this.getUIContext().getHostContext();
    if (context !== undefined) {
      sharedCache.init(context);
      // 先把手机看到的世界告诉它（日历 / 免打扰 / 情景），再读它的日志。
      sharedDeviceContext.report(context, this.api).catch((err: Error) => {
      });
    }
    await this.loadEvents();
    await this.loadToday();
    this.loading = false;
  }

  async loadEvents(): Promise<void> {
    if (this.sending) {
      this.feedbackPending = true;
      return;
    }
    const version = ++this.eventsVersion;
    try {
      const env: AgentEnvelope = await this.api.getEvents(120);
      if (version !== this.eventsVersion || this.sending) {
        return;
      }
      const data: EventsData = env.data as EventsData;
      const items: TimelineEntry[] = [];
      for (const raw of data.entries) {
        items.push(raw as TimelineEntry);
      }
      // 本地未确认的消息（发送中 / 失败）不能被服务器列表冲掉（2026-09-21 审查 C3）。
      for (const pending of this.localPending) {
        items.push(pending);
      }
      this.entries = items;
      if (this.launchDecisionId.length > 0) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].id === this.launchDecisionId) {
            this.selectedDayKey = nxDayKey(items[i].ts);
            break;
          }
        }
      }
      // 刷新是否把用户从当前阅读位置拉走：只有已经在底部时才跟随（2026-09-21 审查 P2-2）。
      const wasFollowing: boolean = !this.showBackTop;
      this.rebuild(items);
      this.deriveStatus(items);
      if (this.launchDecisionId.length > 0) {
        const targetId: string = this.launchDecisionId;
        setTimeout(() => {
          for (let i = 0; i < this.rows.length; i++) {
            if (!this.rows[i].isAct && this.rows[i].entry.id === targetId) {
              this.scroller.scrollToIndex(i, false);
              break;
            }
          }
          AppStorage.setOrCreate('nxLaunchDecision', '');
          this.launchDecisionId = '';
        }, 100);
      } else if (wasFollowing) {
        this.scrollToLatest();
      } else {
        this.markUnread(this.selectedDayKey);
      }
      const context = this.getUIContext().getHostContext();
      if (context !== undefined) {
        sharedCache.init(context);
        sharedCache.put('nx_events_' + nxReadingScope(), JSON.stringify(items.slice(-60)));
      }
      this.errorText = '';
      this.handleProactiveEntries(items);
    } catch (err) {
      if (version !== this.eventsVersion || this.sending) {
        return;
      }
      const e = err as BusinessError;
      // 服务器能连上但 /events 返回 404 / 405：不是网络问题，是连到了旧版 learning
      // （只有 /context /plan /ask-in-context 那一代接口，例如 chat.himpqblog.cn 那台机器）。
      // 这种情况本地缓存救不了，必须说清楚，否则 App 看起来「在线」却只剩普通问答。
      const staleServer: boolean = /^HTTP (404|405) /.test(e.message);
      const staleText: string = '连到的学习服务版本太旧，我读不到自己的日志。请把服务更新到最新版本后再试。';
      const context = this.getUIContext().getHostContext();
      if (context !== undefined) {
        sharedCache.init(context);
        const cached = sharedCache.get('nx_events_' + nxReadingScope());
        if (cached.length > 0) {
          try {
            const items: TimelineEntry[] = JSON.parse(cached) as TimelineEntry[];
            this.entries = items;
            this.rebuild(items);
            this.deriveStatus(items);
            this.scrollToLatest();
            this.errorText = staleServer ? staleText : '';
            return;
          } catch (parseErr) {
            // 缓存损坏则走网络错误提示
          }
        }
      }
      this.errorText = staleServer ? staleText : '云端暂时没接上：' + (e.message.length > 0 ? e.message : '请稍后再试');
    }
  }

  /** 天选择器 + 当天的三幕行。 */
  private rebuild(items: TimelineEntry[]): void {
    const counts: Map<string, number> = new Map<string, number>();
    const order: string[] = [];
    for (let i = items.length - 1; i >= 0; i--) {
      const key: string = nxDayKey(items[i].ts);
      const previous: number | undefined = counts.get(key);
      counts.set(key, previous === undefined ? 1 : previous + 1);
      if (order.indexOf(key) < 0) {
        order.push(key);
      }
    }
    const chips: DayChip[] = [];
    for (let i = 0; i < order.length && i < 10; i++) {
      const key: string = order[i];
      let sampleTs: number = 0;
      for (let j = items.length - 1; j >= 0; j--) {
        if (nxDayKey(items[j].ts) === key) {
          sampleTs = items[j].ts;
          break;
        }
      }
      const total: number | undefined = counts.get(key);
      chips.push({ key: key, label: nxDayLabel(sampleTs), count: total === undefined ? 0 : total });
    }
    this.dayChips = chips;
    if (this.selectedDayKey.length === 0 || order.indexOf(this.selectedDayKey) < 0) {
      this.selectedDayKey = chips.length > 0 ? chips[0].key : '';
    }
    const rows: DayRow[] = [];
    let currentAct: string = '';
    for (let i = 0; i < items.length; i++) {
      const item: TimelineEntry = items[i];
      if (nxDayKey(item.ts) !== this.selectedDayKey) {
        continue;
      }
      const act: string = actOf(item.ts);
      if (act !== currentAct) {
        currentAct = act;
        const header: DayRow = new DayRow();
        header.isAct = true;
        header.key = 'act_' + this.selectedDayKey + '_' + act + '_' + i;
        if (act === 'night') {
          header.actLabel = '夜';
          header.actHint = '它在工作';
        } else if (act === 'dawn') {
          header.actLabel = '晨';
          header.actHint = '它报告';
        } else {
          header.actLabel = '日';
          header.actHint = '它陪着，但克制';
        }
        rows.push(header);
      }
      const row: DayRow = new DayRow();
      row.isAct = false;
      // TimelineEntryView 用 @State 接收 entry，只在创建时拷贝一次；ForEach 同键复用组件不会再同步。
      // 键值带 status 与内容指纹（文本长度 + reason 长度 + 证据数），同 ID 的正文 / 理由 / 证据更新时重建该条；
      // 流式释放期间文本长度每拍变化，自然逐拍重建（2026-09-21 审查 I1）。
      const fingerprint: string = item.text.length + '_' + (item.reason !== undefined ? item.reason.length : 0) + '_' +
        (item.evidence !== undefined ? item.evidence.length : 0);
      row.key = item.id + '_' + (item.status !== undefined ? item.status : '') + '_' + fingerprint;
      row.entry = item;
      rows.push(row);
    }
    this.rows = rows;
  }

  /** 顶部状态字：在等你 / 被你纠正过 / 在读 / 看着。只陈述数据支持的事实。 */
  private deriveStatus(items: TimelineEntry[]): void {
    const now: Date = new Date();
    let pending: TimelineEntry | null = null;
    let corrected: boolean = false;
    for (let i = items.length - 1; i >= 0 && i >= items.length - 12; i--) {
      const item: TimelineEntry = items[i];
      if (pending === null && item.kind === 'agent_act' && item.status === 'pending' && item.card !== null && item.card !== undefined && item.card.type === 'proactive') {
        pending = item;
      }
      if (item.kind === 'agent_msg' && item.channel === 'rebuttal' && now.getTime() - item.ts < 6 * 3600 * 1000) {
        corrected = true;
      }
    }
    if (pending !== null) {
      this.statusWord = '在等你';
      this.statusHint = pending.text;
      return;
    }
    if (corrected) {
      this.statusWord = '被你纠正过';
      this.statusHint = '我改了对你的判断。';
      return;
    }
    if (nxTimePhase(now.getTime()) === 'night') {
      this.statusWord = '在读';
      this.statusHint = '夜里我会把明天的章节读完。';
      return;
    }
    this.statusWord = '看着';
    this.statusHint = '有需要我会说，没需要我不说。';
  }

  async handleProactiveEntries(items: TimelineEntry[]): Promise<void> {
    // §4.6 端侧抑制：免打扰时不打扰，并把决定回写决策器（agent_hold）。
    const dnd = await sharedDnd.isDoNotDisturb();
    for (const entry of items) {
      if (entry.kind !== 'agent_act' || entry.card === null || entry.card === undefined || entry.card.type !== 'proactive') {
        continue;
      }
      if (entry.status !== 'pending' || this.seenDecisionIds.indexOf(entry.id) >= 0) {
        continue;
      }
      this.seenDecisionIds.push(entry.id);
      if (dnd) {
        this.api.postDecision({ trigger: entry.trigger !== undefined ? entry.trigger : '', signals: { do_not_disturb: true }, now: undefined });
        continue;
      }
      const card = entry.card as ProactiveCard;
      const channel: string = entry.channel !== undefined && entry.channel.length > 0
        ? entry.channel
        : (card.channel !== undefined && card.channel.length > 0 ? card.channel : 'card');
      // 模型裁决的形态：notify 只发通知；其余形态由桌面卡片承载（实况窗 / 小艺建议由系统入口接管）。
      if (channel === 'notify') {
        sharedNotify.ensureEnabled();
        sharedNotify.publish(1, card.title, card.reason);
        continue;
      }
      const context = this.getUIContext().getHostContext();
      if (context !== undefined) {
        sharedForm.updateToday(context as common.UIAbilityContext, card.title,
          '约 ' + card.minutes + ' 分钟', this.todayPercent, entry.id);
      }
    }
  }

  async loadToday(): Promise<void> {
    const version = ++this.todayVersion;
    try {
      const env: AgentEnvelope = await this.api.getToday();
      if (version !== this.todayVersion) {
        return;
      }
      const data: TodayData = env.data as TodayData;
      this.lastTarget = data.focus !== undefined ? data.focus : null;
      if (data.status === 'needs_course') {
        this.todayPercent = 0;
        this.todayText = '先聊聊你的目标和学习方式；选好课程后，我们再一起安排阅读。';
        return;
      }
      if (data.focus !== null && data.focus !== undefined) {
        this.todayText = data.status === 'resume'
          ? '接着' + data.focus.chapter_name + '往下读。'
          : '今天的目标：' + data.focus.chapter_name + '。';
      } else {
        this.todayText = '';
      }
      const brief = data.today;
      if (brief.study_minutes > 0) {
        this.todayText += ' 已学 ' + brief.study_minutes + ' 分钟';
        if (brief.accuracy !== null) {
          this.todayText += '，正确率 ' + Math.round(brief.accuracy * 100) + '%';
        }
        this.todayText += '。';
      }
      if (data.lectures !== undefined && data.lectures.length > 0) {
        this.todayPercent = data.lectures[0].progress_percent;
      }
    } catch (err) {
      if (version === this.todayVersion) {
        this.todayText = '';
      }
    }
  }

  private scrollToLatest(): void {
    const last: number = this.rows.length - 1;
    if (last < 0) {
      return;
    }
    setTimeout(() => {
      this.scroller.scrollToIndex(last, false);
      this.showBackTop = false;
    }, 80);
  }

  appendEntry(entry: TimelineEntry, follow: boolean = true): void {
    this.entries.push(entry);
    const dayKey: string = nxDayKey(entry.ts);
    const context = this.getUIContext().getHostContext();
    if (context !== undefined) {
      sharedCache.init(context);
      sharedCache.put('nx_events_' + nxReadingScope(), JSON.stringify(this.entries.slice(-120)));
    }
    if (follow) {
      this.selectedDayKey = dayKey;
      this.rebuild(this.entries);
      this.scrollToLatest();
      return;
    }
    this.rebuild(this.entries);
    if (this.selectedDayKey === dayKey) {
      if (!this.showBackTop) {
        this.scrollToLatest();
      } else {
        this.markUnread(dayKey);
      }
    } else {
      this.markUnread(dayKey);
    }
  }

  private hasUnread(key: string): boolean {
    return this.unreadDays.indexOf(key) >= 0;
  }

  private markUnread(key: string): void {
    if (this.unreadDays.indexOf(key) >= 0) {
      return;
    }
    const next: string[] = [];
    for (const item of this.unreadDays) {
      next.push(item);
    }
    next.push(key);
    this.unreadDays = next;
  }

  private clearUnread(key: string): void {
    const next: string[] = [];
    for (const item of this.unreadDays) {
      if (item !== key) {
        next.push(item);
      }
    }
    this.unreadDays = next;
  }

  private applyKeyboardPx(px: number): void {
    const safe: number = px > 0 ? px : 0;
    this.keyboardHeight = this.getUIContext().px2vp(safe);
    // 主内容已经避让导航栏，键盘高度含导航栏时不能再重复扣一次。
    const vp: number = Math.max(0, this.keyboardHeight - this.navigationBottomInset);
    if (Math.abs(vp - this.keyboardInset) < 1) {
      return;
    }
    this.keyboardInset = vp;
    if (vp > 0 && !this.showBackTop) {
      setTimeout((): void => {
        this.scrollToLatest();
      }, 40);
    }
  }

  private listenKeyboard(): void {
    const host = this.getUIContext().getHostContext();
    if (host === undefined) {
      return;
    }
    window.getLastWindow(host as common.UIAbilityContext).then((win: window.Window) => {
      this.hostWindow = win;
      this.systemTopInset = this.getUIContext().px2vp(win.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM).topRect.height);
      // TYPE_SYSTEM does not include the navigation indicator. The page has
      // already avoided that area, so only the remaining keyboard height moves it.
      this.navigationBottomInset = this.getUIContext().px2vp(
        win.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR).bottomRect.height);
      nxApplySystemBars(win, this.nxDark);
      win.on('keyboardHeightChange', (height: number): void => {
        this.applyKeyboardPx(height);
      });
      win.on('avoidAreaChange', (data: window.AvoidAreaOptions) => {
        if (data.type === window.AvoidAreaType.TYPE_SYSTEM ||
          data.type === window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR) {
          if (data.type === window.AvoidAreaType.TYPE_SYSTEM) {
            this.systemTopInset = this.getUIContext().px2vp(data.area.topRect.height);
          } else {
            this.navigationBottomInset = this.getUIContext().px2vp(data.area.bottomRect.height);
          }
          const keyboard = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_KEYBOARD);
          this.applyKeyboardPx(keyboard.bottomRect.height);
          return;
        }
        if (data.type !== window.AvoidAreaType.TYPE_KEYBOARD) {
          return;
        }
        let px: number = data.area.bottomRect.height;
        if (px <= 0 && data.area.visible) {
          const top: number = data.area.bottomRect.top;
          const winH: number = win.getWindowProperties().windowRect.height;
          if (top > 0 && winH > top) {
            px = winH - top;
          }
        }
        this.applyKeyboardPx(px);
      });
    }).catch((err: Error) => {
    });
  }

  private dropEntry(id: string): void {
    const next: TimelineEntry[] = [];
    for (const item of this.entries) {
      if (item.id !== id) {
        next.push(item);
      }
    }
    this.entries = next;
    this.rebuild(this.entries);
  }

  private selectDay(key: string): void {
    this.clearUnread(key);
    if (key === this.selectedDayKey) {
      this.scrollToLatest();
      return;
    }
    this.selectedDayKey = key;
    this.rebuild(this.entries);
    this.scrollToLatest();
  }

  // ---------- 动作 ----------

  async openSession(): Promise<void> {
    try {
      const env: AgentEnvelope = await this.api.postOpenSession();
      const data: OpenSessionData = env.data as OpenSessionData;
      const params: Record<string, Object> = {
        'lecture_id': data.target.lecture_id,
        'book_id': data.target.book_id,
        'book_title': data.target.book_title,
        'chapter_index': data.target.chapter_index,
        'chapter_name': data.target.chapter_name,
      };
      router.pushUrl({ url: 'pages/Reader', params: params });
      this.loadEvents();
    } catch (err) {
      const e = err as BusinessError;
      this.errorText = '打开学习会话失败：' + (e.message.length > 0 ? e.message : '网络错误');
    }
  }

  /** 计划卡「开始学习」：优先用卡片自带的目标；旧记录没有目标时退回当前目标并说明（2026-09-21 审查 C2）。 */
  openPlanInReader(cardTarget: PlanCardTarget | null): void {
    const target: PlanCardTarget | LearnTarget | null = cardTarget !== null && cardTarget.book_id.length > 0 && cardTarget.chapter_index >= 0
      ? cardTarget : this.lastTarget;
    if (target !== null) {
      const params: Record<string, Object> = {
        'lecture_id': target.lecture_id,
        'book_id': target.book_id,
        'book_title': target.book_title,
        'chapter_index': target.chapter_index,
        'chapter_name': target.chapter_name,
      };
      if (cardTarget === null || cardTarget.book_id.length === 0) {
        this.errorText = '这张旧计划卡没记下具体章节，我按当前目标「' + target.chapter_name + '」打开。';
      }
      router.pushUrl({ url: 'pages/Reader', params: params });
    } else {
      this.openSession();
    }
  }

  openPrereqInReader(lectureId: string, bookId: string, chapterIndex: number, chapterName: string): void {
    if (lectureId.length === 0 || bookId.length === 0 || chapterIndex < 0) {
      return;
    }
    const params: Record<string, Object> = {
      'lecture_id': lectureId,
      'book_id': bookId,
      'book_title': '',
      'chapter_index': chapterIndex,
      'chapter_name': chapterName,
    };
    router.pushUrl({ url: 'pages/Reader', params: params });
  }

  async openFlowReader(flowId: string): Promise<void> {
    try {
      const env: AgentEnvelope = await this.api.getFlowState(flowId);
      const data: FlowStateData = env.data as FlowStateData;
      const params: Record<string, Object> = {
        'lecture_id': data.target.lecture_id,
        'book_id': data.target.book_id,
        'book_title': data.target.book_title,
        'chapter_index': data.target.chapter_index,
        'chapter_name': data.target.chapter_name,
        'flow_id': flowId,
      };
      router.pushUrl({ url: 'pages/Reader', params: params });
    } catch (err) {
      this.openSession();
    }
  }

  openQuiz(flowId: string): void {
    const params: Record<string, Object> = { 'flow_id': flowId };
    router.pushUrl({ url: 'pages/Quiz', params: params });
  }

  private isLearningIntent(text: string): boolean {
    return nxIsLearningIntent(text);
  }

  private async questionTarget(): Promise<LearnTarget | null> {
    if (this.lastTarget !== null) {
      return this.lastTarget;
    }
    try {
      const env: AgentEnvelope = await this.api.getToday();
      const data: TodayData = env.data as TodayData;
      if (data.focus !== null && data.focus !== undefined) {
        this.lastTarget = data.focus;
        return data.focus;
      }
    } catch (err) {
      // 下面的课程快照兜底仍可让后端按问题中的章节定位上下文。
    }
    try {
      const env: AgentEnvelope = await this.api.getContext();
      const context = env.data as ContextData;
      if (context.lectures.length > 0 && context.lectures[0].books.length > 0) {
        const lecture = context.lectures[0];
        const book = lecture.books[0];
        this.lastTarget = {
          lecture_id: lecture.id,
          lecture_title: lecture.title,
          book_id: book.id,
          book_title: book.title,
          chapter_index: 0,
          chapter_name: '',
          chapter_range: '',
        };
        return this.lastTarget;
      }
    } catch (err) {
      // 没有课程时由后端返回可读的错误状态。
    }
    return null;
  }

  async send(): Promise<void> {
    const text = this.inputText.trim();
    if (text.length === 0 || this.sending) {
      return;
    }
    this.inputText = '';
    await this.sendText(text, '');
  }

  /** 失败消息重发：沿用原来的本地消息 ID，不产生第二条气泡。 */
  async resend(entry: TimelineEntry): Promise<void> {
    if (this.sending || entry.kind !== 'user_msg') {
      return;
    }
    await this.sendText(entry.text, entry.id);
  }

  /** 失败消息编辑：放回输入框，删掉失败气泡。 */
  editFailed(entry: TimelineEntry): void {
    this.inputText = entry.text;
    this.forgetPending(entry.id);
    this.dropEntry(entry.id);
  }

  private forgetPending(id: string): void {
    const next: TimelineEntry[] = [];
    for (const item of this.localPending) {
      if (item.id !== id) {
        next.push(item);
      }
    }
    this.localPending = next;
  }

  private setUserStatus(id: string, status: string | undefined): void {
    for (const item of this.entries) {
      if (item.id === id) {
        item.status = status;
      }
    }
    for (const item of this.localPending) {
      if (item.id === id) {
        item.status = status;
      }
    }
    this.entries = this.entries.slice();
    this.rebuild(this.entries);
  }

  /**
   * 发送（2026-09-21 审查 C3）：用户消息先以 sending 状态入列表并记入 localPending；
   * 失败改为 failed 并保留原文（可重发 / 编辑），刷新时不会被服务器列表冲掉；成功后从 localPending 移除。
   */
  private async sendText(text: string, reuseId: string): Promise<void> {
    if (text.trim().length === 0 || this.sending) {
      return;
    }
    const submittedAt: number = Date.now();
    const version: number = ++this.replyVersion;
    const cancellation: ReplyCancellation = new ReplyCancellation();
    this.replyCancellation = cancellation;
    this.sending = true;
    this.replyPhase = 'waiting';
    this.eventsVersion++;
    let exchanged = false;
    const userId: string = reuseId.length > 0 ? reuseId : 'local_u_' + Date.now();
    this.activeUserId = userId;
    if (reuseId.length > 0) {
      this.setUserStatus(userId, 'sending');
    } else {
      const userEntry: TimelineEntry = { id: userId, kind: 'user_msg', ts: Date.now(), text: text, status: 'sending', unattended: false };
      this.localPending.push(userEntry);
      this.appendEntry(userEntry);
    }
    const thinkId: string = 'local_t_' + Date.now();
    this.activeThinkingId = thinkId;
    this.appendEntry({
      id: thinkId,
      kind: 'agent_msg',
      ts: Date.now() + 1,
      text: '',
      status: 'thinking',
      unattended: false,
      channel: 'app',
    });
    // 这里只消费真正显示的首条资格，日期固定在发送瞬间。重试和任何异步回调都不重播。
    this.topGlow = reuseId.length === 0 && this.glowEnabled && this.glowExposed() &&
      sharedSoftGlowState.claimFirstGlow(Identity.current(), Identity.baseUrl(), submittedAt);
    try {
      // 只有明确的学习/安排指令进入计划；其余自由文本交给模型对话，避免把陈述句误当成“下一章”。
      if (!this.isLearningIntent(text)) {
        const target = await this.questionTarget();
        if (version !== this.replyVersion) {
          return;
        }
        const env: AgentEnvelope = await this.api.postAskInContext(text, target, '', 'app', '', cancellation);
        if (version !== this.replyVersion) {
          return;
        }
        const data: AskAnswer = env.data as AskAnswer;
        if (data.answer === undefined || data.answer.trim().length === 0) {
          throw new Error('这次我没给出答案。');
        }
        this.forgetPending(userId);
        this.setUserStatus(userId, undefined);
        const reason = (data.source === 'textbook_context' ? '结合教材上下文回答。' : '结合我们的交流回答。') +
          (data.memory_updated === true ? '这次交流中的学习线索，我已记下。' : '');
        this.replyPhase = 'revealing';
        await this.revealAnswer(thinkId, data.answer, reason, version);
      } else {
        const env: AgentEnvelope = await this.api.postPlan(text, 30, cancellation);
        if (version !== this.replyVersion) {
          return;
        }
        this.replyPhase = 'revealing';
        const planData: PlanData = env.data as PlanData;
        this.forgetPending(userId);
        this.setUserStatus(userId, undefined);
        this.lastTarget = planData.plan.target;
        const planCard: PlanCard = {
          type: 'plan',
          chapter: planData.plan.target.chapter_name,
          minutes: planData.plan.estimated_minutes,
          why: planData.plan.reason,
          target: {
            lecture_id: planData.plan.target.lecture_id,
            lecture_title: planData.plan.target.lecture_title,
            book_id: planData.plan.target.book_id,
            book_title: planData.plan.target.book_title,
            chapter_index: planData.plan.target.chapter_index,
            chapter_name: planData.plan.target.chapter_name,
            chapter_range: planData.plan.target.chapter_range,
          },
        };
        this.dropEntry(thinkId);
        this.appendEntry({
          id: 'local_a_' + Date.now(),
          kind: 'agent_msg',
          ts: Date.now(),
          text: planData.plan.reason,
          card: planCard,
          unattended: false,
        }, false);
        // 日程是独立意图：只有用户明确说了「排进日历 / 提醒我」才写系统日历（2026-09-21 审查 I6）。
        const hostContext = this.getUIContext().getHostContext();
        if (hostContext !== undefined && nxWantsCalendar(text)) {
          sharedCalendar.scheduleStudy(hostContext, planData.plan.target.chapter_name, planData.plan.estimated_minutes)
            .then((): void => {
              this.appendEntry({ id: 'local_s_' + Date.now(), kind: 'system', ts: Date.now(),
                text: '已写进系统日历：学习「' + planData.plan.target.chapter_name + '」，开始前 5 分钟提醒你。', unattended: false }, false);
            })
            .catch((err: Error) => {
              this.appendEntry({ id: 'local_s_' + Date.now(), kind: 'system', ts: Date.now(),
                text: err.message.length > 0 ? err.message : '这次没写进日历。', unattended: false }, false);
            });
        }
      }
      exchanged = version === this.replyVersion;
    } catch (err) {
      if (version !== this.replyVersion) {
        return;
      }
      this.replyPhase = 'error';
      const e = err as BusinessError;
      this.dropEntry(thinkId);
      this.setUserStatus(userId, 'failed');
      this.appendEntry({
        id: 'local_e_' + Date.now(),
        kind: 'system',
        ts: Date.now(),
        text: '这条我没接上：' + (e.message.length > 0 ? e.message : '网络错误') + '。你的问题还在上面，可以重发或编辑。',
        unattended: false,
      }, false);
    } finally {
      if (version === this.replyVersion) {
        this.sending = false;
        this.replyCancellation = null;
        this.topGlow = false;
        if (this.replyPhase !== 'error') {
          this.replyPhase = 'complete';
        }
        if (exchanged) {
          AppStorage.setOrCreate('nxStudyTick', Date.now());
        } else if (this.feedbackPending && this.attached) {
          this.refreshLearningFeedback();
        }
      }
    }
  }

  /**
   * 网络响应到达后按字符释放，避免长答案瞬间铺满时间线。
   * 2026-09-21 审查 I2：① 总时长封顶约 1.2 秒（按长度自适应步长），长答案不再多等十几秒；
   * ② 用户离开底部（showBackTop）时不再每拍强拉回底部；③ 只在接近底部时跟随。
   */
  private async revealAnswer(id: string, answer: string, reason: string, version: number = this.replyVersion): Promise<void> {
    const chars: string[] = answer.split('');
    const totalMs: number = Math.min(1200, Math.max(300, chars.length * 12));
    const frames: number = Math.max(1, Math.round(totalMs / 30));
    const step: number = Math.max(1, Math.ceil(chars.length / frames));
    let visible: string = '';
    let i: number = 0;
    while (i < chars.length) {
      if (version !== this.replyVersion) {
        return;
      }
      const chunk: number = i < 10 ? 1 : step;
      visible += chars.slice(i, i + chunk).join('');
      i += chunk;
      for (const item of this.entries) {
        if (item.id === id) {
          item.text = visible;
          item.status = 'streaming';
          item.reason = reason;
          item.channel = 'app';
          break;
        }
      }
      this.entries = this.entries.slice();
      this.rebuild(this.entries);
      if (!this.showBackTop) {
        this.scrollToLatest();
      }
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, i < 10 ? 18 : 30);
      });
    }
    if (version !== this.replyVersion) {
      return;
    }
    for (const item of this.entries) {
      if (item.id === id) {
        item.status = undefined;
      }
    }
    this.entries = this.entries.slice();
    this.rebuild(this.entries);
    if (!this.showBackTop) {
      this.scrollToLatest();
    } else {
      this.markUnread(this.selectedDayKey);
    }
  }

  /** 语音（2026-09-21 审查 F06 / I7）：先在使用场景申请麦克风权限；识别正常结束时按钮复位。 */
  async toggleVoice(): Promise<void> {
    if (this.listening) {
      sharedAsr.stop();
      this.listening = false;
      return;
    }
    const context = this.getUIContext().getHostContext();
    if (context === undefined) {
      return;
    }
    const outcome = await sharedPermission.ensure(context, [PERMISSION_MICROPHONE]);
    if (outcome !== 'granted') {
      this.micBlocked = outcome === 'blocked';
      this.errorText = outcome === 'blocked' ? '麦克风权限之前被拒绝了，去系统设置里打开后再用语音。' :
        (outcome === 'unsupported' ? '这台设备用不了语音识别，先用文字跟我说吧。' : '没有麦克风权限，先用文字跟我说吧。');
      return;
    }
    this.micBlocked = false;
    this.errorText = '';
    this.listening = true;
    await sharedAsr.start((text: string): void => {
      this.inputText = this.inputText + text;
    }, (message: string): void => {
      this.errorText = message;
      this.listening = false;
    }, (): void => {
      this.listening = false;
    });
  }

  /** 错误条的「重试」按错误类型分派：麦克风被拒 → 去设置；其余 → 重新加载。 */
  private retryFromError(): void {
    if (this.micBlocked) {
      const context = this.getUIContext().getHostContext();
      if (context !== undefined) {
        sharedPermission.openSetting(context, PERMISSION_MICROPHONE).then((granted: boolean): void => {
          if (granted) {
            this.micBlocked = false;
            this.errorText = '';
          }
        });
      }
      return;
    }
    this.errorText = '';
    this.load();
  }

  private inspect(entry: TimelineEntry | null): void {
    this.inspectEntry = entry;
    this.inspectOpen = true;
  }

  // ---------- 视图 ----------

  private glyphColor(): string {
    if (this.statusWord === '在等你') {
      return this.palette().dawn;
    }
    if (nxTimePhase(Date.now()) === 'night') {
      return this.palette().night;
    }
    return this.palette().primary;
  }

  /** 会呼吸的状态字：面三「一致的化身」的视觉锚点，同一字形出现在卡片与系统入口里。品牌与入口一行，状态词单独一行。 */
  @Builder
  header() {
    Column({ space: NxGrid * 2 }) {
      Row({ space: NxGrid * 2 }) {
        if (this.motionAllowed()) {
          Circle()
            .width(12)
            .height(12)
            .fill(this.glyphColor())
            .scale({ x: this.breathe ? 1.35 : 0.85, y: this.breathe ? 1.35 : 0.85 })
            .opacity(this.breathe ? 1.0 : 0.55)
            .animation({
              duration: NxMotion.breath,
              iterations: -1,
              playMode: PlayMode.Alternate,
              curve: Curve.EaseInOut,
            })
        } else {
          // Replacing the node also cancels an already running infinite native animation.
          Circle()
            .width(12)
            .height(12)
            .fill(this.glyphColor())
        }
        Text('Nexora')
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().text2)
          .letterSpacing(1)
        Blank()
        Text('外观')
          .id('nx-glow-settings-open')
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().text2)
          .height(40)
          .padding({ left: NxGrid * 2, right: NxGrid * 2 })
          .borderRadius(NxRadius.xs)
          .backgroundColor(this.palette().surface2)
          .accessibilityText('外观与柔光设置')
          .onClick((): void => {
            this.glowSettingsOpen = true;
          })
        Text('书房')
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().primary)
          .padding({ left: NxGrid * 3, right: NxGrid * 3, top: NxGrid * 2, bottom: NxGrid * 2 })
          .borderRadius(NxRadius.xs)
          .backgroundColor(this.palette().primarySoft)
          .onClick(() => {
            this.studyOpen = true;
          })
        Text('它眼里的你')
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().text2)
          .padding({ left: NxGrid * 3, right: NxGrid * 3, top: NxGrid * 2, bottom: NxGrid * 2 })
          .borderRadius(NxRadius.xs)
          .backgroundColor(this.palette().surface2)
          .onClick(() => {
            this.inspect(null);
          })
      }
      .width('100%')
      Text(this.statusWord)
        .fontSize(NxFontSize.h)
        .fontFamily(NxFontFamily.serif)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.palette().text1)
        .width('100%')
      if (this.statusHint.length > 0 || this.todayText.length > 0) {
        Text((this.statusHint.length > 0 ? this.statusHint + ' ' : '') + this.todayText)
          .fontSize(NxFontSize.md)
          .fontColor(this.palette().text2)
          .lineHeight(20)
          .width('100%')
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
    }
    .width('100%')
    .padding({ left: NxGrid, right: NxGrid, top: NxGrid * 2, bottom: NxGrid })
  }

  @Builder
  dayStrip() {
    Scroll() {
      Row({ space: NxGrid * 2 }) {
        ForEach(this.dayChips, (day: DayChip) => {
          Row({ space: NxGrid }) {
            Text(day.label)
              .fontSize(NxFontSize.sm)
              .fontWeight(day.key === this.selectedDayKey ? FontWeight.Medium : FontWeight.Normal)
              .fontColor(day.key === this.selectedDayKey ? this.palette().onButton : this.palette().text2)
            if (this.hasUnread(day.key)) {
              Circle()
                .width(6)
                .height(6)
                .fill(this.palette().success)
            }
          }
          .padding({ left: NxGrid * 3, right: NxGrid * 3, top: NxGrid, bottom: NxGrid })
          .borderRadius(NxRadius.lg)
          .backgroundColor(day.key === this.selectedDayKey ? this.palette().buttonFill : this.palette().surface2)
          .onClick(() => {
            this.selectDay(day.key);
          })
        }, (day: DayChip) => day.key)
      }
      .padding({ left: NxGrid, right: NxGrid })
    }
    .scrollable(ScrollDirection.Horizontal)
    .scrollBar(BarState.Off)
    .width('100%')
  }

  @Builder
  actHeader(row: DayRow) {
    Row({ space: NxGrid * 2 }) {
      Text(row.actLabel)
        .fontSize(NxFontSize.h)
        .fontFamily(NxFontFamily.serif)
        .fontWeight(FontWeight.Bold)
        .fontColor(row.actLabel === '夜' ? this.palette().night : (row.actLabel === '晨' ? this.palette().dawn : this.palette().text2))
      Text(row.actHint)
        .fontSize(NxFontSize.xs)
        .fontColor(this.palette().text3)
        .letterSpacing(1)
      Blank()
    }
    .width('100%')
    .padding({ top: NxGrid * 4, bottom: NxGrid * 2, left: NxGrid })
  }

  @Builder
  composer() {
    Row({ space: NxGrid * 2 }) {
      // 多行输入（2026-09-21 审查 P2-3）：复杂问题可换行，最多约 5 行后内部滚动。
      TextArea({ placeholder: '跟我说，或者纠正我', text: this.inputText })
        .id('nx-conversation-input')
        .layoutWeight(1)
        .constraintSize({ minHeight: 40, maxHeight: 120 })
        .fontSize(NxFontSize.md)
        .fontColor(this.palette().text1)
        .placeholderColor(this.palette().text3)
        .backgroundColor(this.palette().surface2)
        .borderRadius(NxRadius.lg)
        .enterKeyType(EnterKeyType.Send)
        .onChange((value: string) => {
          this.inputText = value;
        })
        .onSubmit(() => {
          this.send();
        })
        .onFocus(() => {
          if (this.hostWindow !== undefined) {
            const area: window.AvoidArea = this.hostWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_KEYBOARD);
            this.applyKeyboardPx(area.bottomRect.height);
          }
          if (!this.showBackTop) {
            setTimeout((): void => {
              this.scrollToLatest();
            }, 180);
          }
        })
        .onBlur(() => {
          this.applyKeyboardPx(0);
        })
      Text(this.listening ? '停止' : '语音')
        .fontSize(NxFontSize.sm)
        .fontColor(this.listening ? this.palette().danger : this.palette().text3)
        .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid * 3, bottom: NxGrid * 3 })
        .onClick(() => {
          this.toggleVoice();
        })
      if (this.sending) {
        Button('停止')
          .id('nx-reply-stop')
          .height(40)
          .fontSize(NxFontSize.sm)
          .backgroundColor(this.palette().buttonFill)
          .fontColor(this.palette().onButton)
          .accessibilityText(this.replyPhase === 'revealing' ? '停止回复' : '停止等待回复')
          .onClick((): void => {
            this.stopReply();
          })
      } else if (this.inputText.trim().length > 0) {
        Button('发送')
          .id('nx-reply-send')
          .height(40)
          .fontSize(NxFontSize.sm)
          .backgroundColor(this.palette().buttonFill)
          .fontColor(this.palette().onButton)
          .enabled(!this.sending)
          .onClick(() => {
            this.send();
          })
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Bottom)
    .padding({ left: NxGrid * 3, right: NxGrid * 3, top: NxGrid * 2, bottom: NxGrid * 2 })
    .borderRadius(NxRadius.lg)
    .backgroundColor(this.palette().cardBg)
    .shadow({
      radius: NxShadow.level1.radius,
      color: NxShadow.level1.color,
      offsetX: NxShadow.level1.offsetX,
      offsetY: NxShadow.level1.offsetY,
    })
  }

  @Builder
  studyBuilder() {
    Column() {
      StudyView()
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  inspectBuilder() {
    Column() {
      InspectSheet({ entry: this.inspectEntry })
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  glowSettingsBuilder() {
    GlowSettings({ onClose: (): void => {
      this.glowSettingsOpen = false;
    } })
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Stack({ alignContent: Alignment.TopStart }) {
      AmbientGlow({
        placement: 'top', dark: this.nxDark, period: this.glowPeriod,
        glowEnabled: this.glowEnabled, exposed: this.glowExposed(),
        reducedMotion: this.glowReduceMotion || this.systemReduceMotion,
        busy: this.sending, illuminated: this.topGlow, extent: this.topGlowExtent(),
      })
        .position({ top: -this.systemTopInset, left: 0 })
      AmbientGlow({
        placement: 'composer', dark: this.nxDark, period: this.glowPeriod,
        glowEnabled: this.glowEnabled, exposed: this.glowExposed(),
        reducedMotion: this.glowReduceMotion || this.systemReduceMotion,
        busy: this.sending, extent: 180,
      })
        .position({ bottom: this.keyboardHeight - this.navigationBottomInset, left: 0 })
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.palette().pageBg)
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
      .hitTestBehavior(HitTestMode.None)
      .accessibilityLevel('no-hide-descendants')
    Column({ space: NxGrid * 2 }) {
      this.header()
      this.dayStrip()

      Stack() {
        if (this.loading) {
          Column({ space: NxGrid * 3 }) {
            SkeletonCard()
            SkeletonCard()
            SkeletonCard()
          }
          .width('100%')
        } else if (this.rows.length === 0 && this.errorText.length === 0) {
          Column({ space: NxGrid * 3 }) {
            Text('这一天我还什么都没做。')
              .fontSize(NxFontSize.lg)
              .fontFamily(NxFontFamily.serif)
              .fontColor(this.palette().text2)
            Text('夜里我会读明天的章节；白天有需要才出现。')
              .fontSize(NxFontSize.sm)
              .fontColor(this.palette().text3)
          }
          .width('100%')
          .height('100%')
          .justifyContent(FlexAlign.Center)
        } else {
          List({ scroller: this.scroller, space: 0 }) {
            ForEach(this.rows, (row: DayRow) => {
              ListItem() {
                if (row.isAct) {
                  this.actHeader(row)
                } else {
                  TimelineEntryView({
                    entry: row.entry,
                    onResponded: (): void => {
                      this.loadEvents();
                    },
                    onOpenSession: (): void => {
                      this.openSession();
                    },
                    onOpenPlan: (target: PlanCardTarget | null): void => {
                      this.openPlanInReader(target);
                    },
                    onResend: (entry: TimelineEntry): void => {
                      this.resend(entry);
                    },
                    onEditFailed: (entry: TimelineEntry): void => {
                      this.editFailed(entry);
                    },
                    onOpenPrereq: (lectureId: string, bookId: string, chapterIndex: number, chapterName: string): void => {
                      this.openPrereqInReader(lectureId, bookId, chapterIndex, chapterName);
                    },
                    onAcceptFlow: (flowId: string): void => {
                      this.openFlowReader(flowId);
                    },
                    onOpenQuiz: (flowId: string): void => {
                      this.openQuiz(flowId);
                    },
                    onInspect: (entry: TimelineEntry): void => {
                      this.inspect(entry);
                    },
                  })
                }
              }
            }, (row: DayRow) => row.key)
          }
          .width('100%')
          .layoutWeight(1)
          .height('100%')
          .scrollBar(BarState.Off)
          .onScrollIndex((start: number, end: number) => {
            this.showBackTop = end < this.rows.length - 1;
          })
        }

        if (this.showBackTop && this.rows.length > 0 && !this.loading) {
          Text('回到最新')
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().primary)
            .padding({ left: NxGrid * 3, right: NxGrid * 3, top: NxGrid * 2, bottom: NxGrid * 2 })
            .borderRadius(NxRadius.lg)
            .backgroundColor(this.palette().cardBg)
            .shadow({
              radius: NxShadow.level2.radius,
              color: NxShadow.level2.color,
              offsetX: NxShadow.level2.offsetX,
              offsetY: NxShadow.level2.offsetY,
            })
            .position({ right: NxGrid * 2, bottom: NxGrid * 3 })
            .onClick(() => {
              this.scroller.scrollToIndex(this.rows.length - 1, true);
            })
        }
      }
      .layoutWeight(1)
      .width('100%')
      .constraintSize({ minHeight: 0 })
      .bindSheet($$this.inspectOpen, this.inspectBuilder(), {
        height: SheetSize.LARGE,
        showClose: true,
        dragBar: true,
        backgroundColor: this.palette().pageBg,
        // 镜像里的反驳输入框：半模态自带键盘避让（官方 SheetKeyboardAvoidMode），面板内容压缩后可滚到输入框。
        keyboardAvoidMode: SheetKeyboardAvoidMode.RESIZE_ONLY,
      })

      if (this.errorText.length > 0) {
        ErrorState({ message: this.errorText, retryLabel: this.micBlocked ? '去设置' : '重试', onRetry: (): void => {
          this.retryFromError();
        } })
      }

      this.composer()
    }
    .width('100%')
    .height('100%')
    .padding({
      left: NxGrid * 4,
      right: NxGrid * 4,
      top: NxGrid * 2,
      bottom: NxGrid * 2 + this.keyboardInset,
    })
    .bindSheet($$this.studyOpen, this.studyBuilder(), {
      height: SheetSize.LARGE,
      showClose: true,
      dragBar: true,
      backgroundColor: this.palette().pageBg,
    })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.palette().pageBg)
    .onAreaChange((_oldArea: Area, area: Area): void => {
      this.viewportHeight = Number(area.height);
    })
    .bindSheet($$this.glowSettingsOpen, this.glowSettingsBuilder(), {
      height: SheetSize.LARGE,
      showClose: false,
      dragBar: true,
      backgroundColor: this.palette().pageBg,
    })
  }
}
