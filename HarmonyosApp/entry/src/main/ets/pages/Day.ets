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
import { TimelineEntry, PlanCard, PlanData, TodayData, EventsData, OpenSessionData, LearnTarget, FlowStateData, ProactiveCard, AskAnswer, ContextData } from '../models/Index';
import { AgentApi, AgentEnvelope } from '../services/AgentApi';
import { TimelineEntryView } from '../components/entry/TimelineEntryView';
import { nxDayKey, nxDayLabel } from '../components/entry/TimelineRows';
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
import { sharedCache } from '../services/cache/CacheStore';

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

function actOf(ts: number): string {
  const hour: number = new Date(ts).getHours();
  if (hour >= 23 || hour < 8) {
    return 'night';
  }
  if (hour < 11) {
    return 'dawn';
  }
  return 'day';
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
  @StorageLink('nxStudyOpen') studyOpen: boolean = false;
  @State inspectOpen: boolean = false;
  @State inspectEntry: TimelineEntry | null = null;
  @State showBackTop: boolean = false;
  @State unreadDays: string[] = [];
  @State keyboardInset: number = 0;
  @StorageProp('nxDarkMode') nxDark: boolean = false;
  private api: AgentApi = new AgentApi();
  private scroller: ListScroller = new ListScroller();
  private lastTarget: LearnTarget | null = null;
  private seenDecisionIds: string[] = [];
  private launchDecisionId: string = '';
  private hostWindow: window.Window | undefined = undefined;

  aboutToAppear(): void {
    this.launchDecisionId = AppStorage.get<string>('nxLaunchDecision') || '';
    const route: string = AppStorage.get<string>('nxLaunchRoute') || '';
    if (route === 'study' || route === 'reader') {
      this.studyOpen = true;
    } else if (route === 'mirror' || route === 'judgment') {
      this.inspectEntry = null;
      this.inspectOpen = true;
    }
    if (route.length > 0) {
      AppStorage.setOrCreate('nxLaunchRoute', '');
    }
    setTimeout(() => {
      this.breathe = true;
    }, 60);
    try {
      this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.NONE);
    } catch (err) {
      // 由 listenKeyboard 按键盘高度上推页面
    }
    this.listenKeyboard();
    this.load();
  }

  aboutToDisappear(): void {
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

  // ---------- 数据 ----------

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
    try {
      const env: AgentEnvelope = await this.api.getEvents(120);
      const data: EventsData = env.data as EventsData;
      const items: TimelineEntry[] = [];
      for (const raw of data.entries) {
        items.push(raw as TimelineEntry);
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
      } else {
        this.scrollToLatest();
      }
      const context = this.getUIContext().getHostContext();
      if (context !== undefined) {
        sharedCache.init(context);
        sharedCache.put('nx_events', JSON.stringify(items.slice(-60)));
      }
      if (this.errorText.indexOf('日志') >= 0) {
        this.errorText = '';
      }
      this.handleProactiveEntries(items);
    } catch (err) {
      const e = err as BusinessError;
      const context = this.getUIContext().getHostContext();
      if (context !== undefined) {
        sharedCache.init(context);
        const cached = sharedCache.get('nx_events');
        if (cached.length > 0) {
          try {
            const items: TimelineEntry[] = JSON.parse(cached) as TimelineEntry[];
            this.entries = items;
            this.rebuild(items);
            this.deriveStatus(items);
            this.scrollToLatest();
            this.errorText = '我在离线模式，先给你看上次的日志。';
            return;
          } catch (parseErr) {
            // 缓存损坏则走网络错误提示
          }
        }
      }
      this.errorText = '日志加载失败：' + (e.message.length > 0 ? e.message : '网络错误');
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
      row.key = item.id + '_' + (item.status !== undefined ? item.status : '');
      row.entry = item;
      rows.push(row);
    }
    this.rows = rows;
  }

  /** 顶部状态字：在等你 / 被你纠正过 / 在读 / 看着。只陈述数据支持的事实。 */
  private deriveStatus(items: TimelineEntry[]): void {
    const now: Date = new Date();
    const hour: number = now.getHours();
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
    if (hour >= 23 || hour < 6) {
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
    try {
      const env: AgentEnvelope = await this.api.getToday();
      const data: TodayData = env.data as TodayData;
      if (data.focus !== null && data.focus !== undefined) {
        this.lastTarget = data.focus;
      }
      if (data.status === 'needs_course') {
        this.todayText = '我还没看到你的课程，去书房选好课我就能陪你学了。';
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
      this.todayText = '';
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
      sharedCache.put('nx_events', JSON.stringify(this.entries.slice(-120)));
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
    const vp: number = this.getUIContext().px2vp(safe);
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
      win.on('keyboardHeightChange', (height: number): void => {
        this.applyKeyboardPx(height);
      });
      win.on('avoidAreaChange', (data: window.AvoidAreaOptions) => {
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

  openPlanInReader(): void {
    if (this.lastTarget !== null) {
      const params: Record<string, Object> = {
        'lecture_id': this.lastTarget.lecture_id,
        'book_id': this.lastTarget.book_id,
        'book_title': this.lastTarget.book_title,
        'chapter_index': this.lastTarget.chapter_index,
        'chapter_name': this.lastTarget.chapter_name,
      };
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
    return /(开始学习|继续学习|安排.*学习|学习计划|今天学什么|下一章|打开.*(课程|教材|阅读)|复习计划|帮我安排)/.test(text);
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
    this.sending = true;
    this.appendEntry({ id: 'local_u_' + Date.now(), kind: 'user_msg', ts: Date.now(), text: text, unattended: false });
    this.inputText = '';
    const thinkId: string = 'local_t_' + Date.now();
    this.appendEntry({
      id: thinkId,
      kind: 'agent_msg',
      ts: Date.now() + 1,
      text: '',
      status: 'thinking',
      unattended: false,
      channel: 'app',
    });
    try {
      // 只有明确的学习/安排指令进入计划；其余自由文本交给模型对话，避免把陈述句误当成“下一章”。
      if (!this.isLearningIntent(text)) {
        const target = await this.questionTarget();
        if (target === null) {
          throw new Error('还没有可用的课程上下文，先去书房选一门课。');
        }
        const env: AgentEnvelope = await this.api.postAskInContext(text, target, '', 'app');
        const data: AskAnswer = env.data as AskAnswer;
        if (data.answer === undefined || data.answer.trim().length === 0) {
          throw new Error('这次我没给出答案。');
        }
        this.dropEntry(thinkId);
        this.appendEntry({
          id: 'local_a_' + Date.now(),
          kind: 'agent_msg',
          ts: Date.now(),
          text: data.answer,
          reason: data.source === 'textbook_context' ? '结合教材上下文回答。' : '结合学习上下文回答。',
          unattended: false,
          channel: 'app',
        }, false);
      } else {
        const env: AgentEnvelope = await this.api.postPlan(text, 30);
        const planData: PlanData = env.data as PlanData;
        this.lastTarget = planData.plan.target;
        const planCard: PlanCard = {
          type: 'plan',
          chapter: planData.plan.target.chapter_name,
          minutes: planData.plan.estimated_minutes,
          why: planData.plan.reason,
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
        const hostContext = this.getUIContext().getHostContext();
        if (hostContext !== undefined) {
          sharedCalendar.scheduleStudy(hostContext, planData.plan.target.chapter_name, planData.plan.estimated_minutes)
            .catch((err: Error) => {
            });
        }
      }
    } catch (err) {
      const e = err as BusinessError;
      this.dropEntry(thinkId);
      this.appendEntry({
        id: 'local_e_' + Date.now(),
        kind: 'system',
        ts: Date.now(),
        text: '这条我没接上：' + (e.message.length > 0 ? e.message : '网络错误'),
        unattended: false,
      }, false);
    } finally {
      this.sending = false;
    }
  }

  async toggleVoice(): Promise<void> {
    if (this.listening) {
      sharedAsr.stop();
      this.listening = false;
      return;
    }
    this.listening = true;
    await sharedAsr.start((text: string): void => {
      this.inputText = this.inputText + text;
    }, (message: string): void => {
      this.errorText = message;
      this.listening = false;
    });
  }

  private inspect(entry: TimelineEntry | null): void {
    this.inspectEntry = entry;
    this.inspectOpen = true;
  }

  // ---------- 视图 ----------

  private glyphColor(): string {
    const hour: number = new Date().getHours();
    if (this.statusWord === '在等你') {
      return this.palette().dawn;
    }
    if (hour >= 23 || hour < 8) {
      return this.palette().night;
    }
    return this.palette().primary;
  }

  /** 会呼吸的状态字：面三「一致的化身」的视觉锚点，同一字形出现在卡片与系统入口里。 */
  @Builder
  header() {
    Column({ space: NxGrid * 2 }) {
      Row({ space: NxGrid * 3 }) {
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
        Text('Nexora')
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().text3)
          .letterSpacing(1)
        Text(this.statusWord)
          .fontSize(NxFontSize.h)
          .fontFamily(NxFontFamily.serif)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.palette().text1)
        Blank()
        Text('书房')
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().primary)
          .padding({ left: NxGrid * 3, right: NxGrid * 3, top: NxGrid, bottom: NxGrid })
          .borderRadius(NxRadius.xs)
          .backgroundColor(this.palette().primarySoft)
          .onClick(() => {
            this.studyOpen = true;
          })
        Text('它眼里的你')
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().text2)
          .padding({ left: NxGrid * 3, right: NxGrid * 3, top: NxGrid, bottom: NxGrid })
          .borderRadius(NxRadius.xs)
          .backgroundColor(this.palette().surface2)
          .onClick(() => {
            this.inspect(null);
          })
      }
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
              .fontColor(day.key === this.selectedDayKey ? this.palette().onPrimary : this.palette().text2)
            if (this.hasUnread(day.key)) {
              Circle()
                .width(6)
                .height(6)
                .fill(this.palette().success)
            }
          }
          .padding({ left: NxGrid * 3, right: NxGrid * 3, top: NxGrid, bottom: NxGrid })
          .borderRadius(NxRadius.lg)
          .backgroundColor(day.key === this.selectedDayKey ? this.palette().night : this.palette().surface2)
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
      TextInput({ placeholder: '跟我说，或者纠正我', text: this.inputText })
        .layoutWeight(1)
        .height(38)
        .fontSize(NxFontSize.md)
        .backgroundColor(this.palette().surface2)
        .borderRadius(NxRadius.lg)
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
        .padding({ left: NxGrid * 2, right: NxGrid * 2 })
        .onClick(() => {
          this.toggleVoice();
        })
      if (this.inputText.length > 0) {
        Button('发送')
          .height(34)
          .fontSize(NxFontSize.sm)
          .backgroundColor(this.palette().primary)
          .fontColor(this.palette().onPrimary)
          .enabled(!this.sending)
          .onClick(() => {
            this.send();
          })
      }
    }
    .width('100%')
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

  build() {
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
                    onOpenPlan: (): void => {
                      this.openPlanInReader();
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
      })

      if (this.errorText.length > 0) {
        ErrorState({ message: this.errorText, onRetry: (): void => {
          this.load();
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
    .backgroundColor(this.palette().pageBg)
    .bindSheet($$this.studyOpen, this.studyBuilder(), {
      height: SheetSize.LARGE,
      showClose: true,
      dragBar: true,
      backgroundColor: this.palette().pageBg,
    })
  }
}
