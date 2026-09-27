import { AppState } from '../../common/AppState';
import { greetingOfHour, sanitizeDisplayName } from '../../common/AppConfig';
import { LearningApi, LearningBook, LearningChapterSummary, NO_BOOK } from '../../common/LearningApi';
import { LearningAgentApi, agentFailure, NO_AGENT_TARGET } from '../../common/LearningAgentApi';
import { LearningBridge } from '../../common/LearningBridge';
import { LearningSystemEntry } from '../../common/LearningSystemEntry';
import { LearningHttp } from '../../common/LearningHttp';
import {
    AgentEnvelope, TodayData, LearnTarget, TimelineEntry, PlanCard, PrereqCard, QuizCard,
    PrepCard, ProactiveCard, WrapupCard, CitationCard, FlowStateData
} from '../../common/LearningAgentModels';
import { LearningReader } from '../learning/LearningReader';
import { LearningAgentReview } from './LearningAgentReview';
import { LearningAgentReport } from './LearningAgentReport';
import { LearningAgentInspect } from './LearningAgentInspect';
import { LearningMemorySettings } from './LearningMemorySettings';
import { LearningAgentNavigationNotice } from './LearningAgentNavigationNotice';
import { LearningAgentInput } from './LearningAgentInput';
import { LearningAgentUserMessage } from './LearningAgentUserMessage';
import { MarkdownView } from '../chat/MarkdownBlock';
import { FontSize, LineHeight, Radius, Shadow, Size, Space } from '../../common/DesignToken';
import { IconButton } from '../common/IconButton';

enum AgentLevel { DAY, READER, REVIEW, REPORT, INSPECT, MEMORY, INSIGHTS }

class AgentFrame {
    id: number = 0;
    level: AgentLevel = AgentLevel.DAY;
    target: LearnTarget = NO_AGENT_TARGET;
    flowId: string = '';
    book: LearningBook = NO_BOOK;
    chapters: LearningChapterSummary[] = [];
    entry: TimelineEntry | null = null;
}

interface AgentButtonOptions {
    label: string;
    id: string;
    onTap: () => void;
    primary?: boolean;
}

interface AgentTimelineEntry extends TimelineEntry {
    remoteId?: string;
    deliveryPending?: boolean;
    deliveryError?: string;
}

// Keep local sends separate from service snapshots, including when a response times out
// after the service has already saved the question.
class AgentOutgoingMessage {
    entry: TimelineEntry;
    baselineIds: string[];
    remoteEntry: TimelineEntry | null = null;
    started: boolean = false;
    pending: boolean = true;
    errorText: string = '';

    constructor(entry: TimelineEntry, baselineIds: string[]) {
        this.entry = entry;
        this.baselineIds = baselineIds;
    }
}

@Component
export struct LearningAgent {
    @ObjectLink app: AppState;
    @Link @Watch('onNavDepthBack') navDepth: number;
    @Prop @Watch('onVisibleChanged') visible: boolean = true;
    @Prop @Watch('onInsightsChanged') insightsToken: number = 0;
    @Prop launchRoute: string = 'day';
    @Prop launchDecision: string = '';
    @Prop @Watch('onLaunchChanged') launchToken: number = 0;
    @StorageProp('nxLearningBridgeTick') @Watch('onBridgeChanged') private bridgeTick: number = 0;
    onBack: () => void = () => {};
    onOpenLearning: () => void = () => {};
    onOpenImage: (url: string) => void = () => {};
    @State private frames: AgentFrame[] = [new AgentFrame()];
    @State private readerOverlayOpen: boolean = false;
    @State private readerBackToken: number = 0;
    @State private entries: TimelineEntry[] = [];
    @State private focus: LearnTarget = NO_AGENT_TARGET;
    @State private errorText: string = '';
    @State private loading: boolean = true;
    @State private opening: boolean = false;
    @State private navigationOpening: boolean = false;
    @State private navigationError: string = '';
    @State private navigationLabel: string = '正在打开教材…';
    @State private actionBusy: string = '';
    @State private draft: string = '';
    @State private planDraft: string = '';
    @State private sending: boolean = false;
    @State private sendingMode: string = '';
    @State private todayStatus: string = 'loading';
    @State private studyMinutes: number = 0;
    @State private completedChapters: number = 0;
    @State private lastSyncedAt: number = 0;
    @State private timeline: AgentTimelineEntry[] = [];
    @State private followLatest: boolean = true;
    @State private expandedEntries: string[] = [];
    @State private showProcess: boolean = false;
    @State private dayTab: number = 0;
    @State private insightTarget: LearnTarget = NO_AGENT_TARGET;
    @State private insightLoading: boolean = false;
    @State private composerOpen: boolean = false;
    @State private actionNotice: string = '';
    @State private activeFlowId: string = '';
    @State private activeFlowTarget: LearnTarget = NO_AGENT_TARGET;
    @State private activeFlowStep: string = '';
    private alive: boolean = false;
    private nextId: number = 1;
    private refreshVersion: number = 0;
    private eventsVersion: number = 0;
    private nextMessageId: number = 1;
    private outgoingMessages: AgentOutgoingMessage[] = [];
    private navigationVersion: number = 0;
    private launchVersion: number = 0;
    private timelineScrollVersion: number = 0;
    private timelineUserScrolling: boolean = false;
    private pendingLatestScroll: boolean = false;
    private pendingFlowId: string = '';
    private expectedFlowId: string = '';
    private submittingReviewFrames: number[] = [];
    private scroller: ListScroller = new ListScroller();

    aboutToAppear(): void {
        this.alive = true;
        this.navDepth = 0;
        void this.refresh();
        this.onLaunchChanged();
    }

    aboutToDisappear(): void {
        this.alive = false;
        this.submittingReviewFrames = [];
        this.refreshVersion++;
        this.eventsVersion++;
        this.navigationVersion++;
        this.launchVersion++;
        this.timelineScrollVersion++;
    }

    private onVisibleChanged(): void {
        if (!this.alive) { return; }
        if (!this.visible) {
            this.timelineUserScrolling = false;
            this.timelineScrollVersion++;
        } else if (this.pendingLatestScroll) {
            this.scrollToLatest(false);
        }
    }

    private onInsightsChanged(): void {
        if (this.alive && this.visible && this.top().level === AgentLevel.DAY && !this.composerOpen) {
            this.openInsights();
        }
    }

    private openInsights(): void {
        const frame: AgentFrame = new AgentFrame();
        frame.level = AgentLevel.INSIGHTS;
        this.push(frame);
        void this.selectInsights();
    }

    private top(): AgentFrame {
        return this.frames[this.frames.length - 1];
    }

    private active(frame: AgentFrame): boolean {
        return this.visible && this.top().id === frame.id;
    }

    private clearNavigationFeedback(): void {
        this.opening = false;
        this.navigationOpening = false;
        this.navigationError = '';
    }

    private push(frame: AgentFrame): void {
        this.clearNavigationFeedback();
        frame.id = this.nextId++;
        this.frames = this.frames.concat([frame]);
        this.navDepth = this.frames.length - 1;
    }

    private onReviewBusyChange(frameId: number, busy: boolean): void {
        if (!busy) {
            this.submittingReviewFrames = this.submittingReviewFrames.filter((id: number): boolean => id !== frameId);
            return;
        }
        if (this.alive && this.frames.some((frame: AgentFrame): boolean => frame.id === frameId && frame.level === AgentLevel.REVIEW) &&
            this.submittingReviewFrames.indexOf(frameId) < 0) {
            this.submittingReviewFrames = this.submittingReviewFrames.concat([frameId]);
        }
    }

    private keepSubmittingReview(): boolean {
        if (this.top().level !== AgentLevel.REVIEW || this.submittingReviewFrames.indexOf(this.top().id) < 0) {
            return false;
        }
        this.navDepth = this.frames.length - 1 + (this.composerOpen ? 1 : 0);
        return true;
    }

    private onNavDepthBack(): void {
        if (this.navDepth === this.frames.length - 1 + (this.composerOpen ? 1 : 0)) {
            return;
        }
        if (this.keepSubmittingReview()) {
            return;
        }
        if (this.composerOpen) {
            this.closeCompose();
            return;
        }
        if (this.top().level === AgentLevel.READER && this.readerOverlayOpen) {
            this.readerBackToken++;
            this.navDepth = this.frames.length - 1;
            return;
        }
        this.goBack();
    }

    private goBack(): void {
        if (this.keepSubmittingReview()) {
            return;
        }
        this.navigationVersion++;
        this.clearNavigationFeedback();
        if (this.frames.length <= 1) {
            this.onBack();
            return;
        }
        this.frames = this.frames.slice(0, this.frames.length - 1);
        this.navDepth = this.frames.length - 1;
        this.readerOverlayOpen = false;
        if (this.top().level === AgentLevel.DAY) {
            this.dayTab = 0;
            this.insightLoading = false;
            void this.refresh();
        }
        this.continueFlow();
    }

    private onBridgeChanged(): void {
        if (!this.alive) {
            return;
        }
        void this.refresh();
        const event = LearningBridge.latest();
        if (event !== null && event.type === 'flow_reading_done' && event.flowId.length > 0 && event.flowId === this.expectedFlowId) {
            this.pendingFlowId = event.flowId;
            this.continueFlow();
        }
    }

    private continueFlow(): void {
        if (this.pendingFlowId.length === 0 || this.top().level === AgentLevel.READER) {
            return;
        }
        const flowId: string = this.pendingFlowId;
        this.pendingFlowId = '';
        this.expectedFlowId = '';
        if (flowId !== this.activeFlowId) {
            void this.openFlow(flowId);
            return;
        }
        if (this.activeFlowStep === 'opened') {
            this.activeFlowStep = 'reading_done';
            this.rebuildTimeline();
        }
        if (this.top().level === AgentLevel.REVIEW && this.top().flowId === flowId) {
            return;
        }
        this.openReview(this.activeFlowTarget, flowId);
    }

    private onLaunchChanged(): void {
        const version: number = ++this.launchVersion;
        setTimeout(() => {
            if (this.alive && version === this.launchVersion) {
                void this.dispatchRoute(version);
            }
        }, 0);
    }

    private async dispatchRoute(version: number): Promise<void> {
        const navigationVersion: number = ++this.navigationVersion;
        this.clearNavigationFeedback();
        this.frames = [new AgentFrame()];
        this.submittingReviewFrames = [];
        this.navDepth = 0;
        this.readerOverlayOpen = false;
        this.pendingFlowId = '';
        this.expectedFlowId = '';
        this.dayTab = 0;
        this.composerOpen = false;
        const route: string = this.launchRoute;
        const decisionId: string = this.launchDecision;
        this.timelineScrollVersion++;
        this.pendingLatestScroll = false;
        this.followLatest = decisionId.length === 0;
        if (route === 'study' || route === 'reader') {
            void this.openSession();
        } else if (route === 'review') {
            this.openReview(this.focus);
        } else if ((route === 'mirror' || route === 'judgment') && decisionId.length === 0) {
            this.openMemorySettings();
        } else if (decisionId.length > 0) {
            // A bridge refresh can supersede refresh(); a deep link needs its own exact decision snapshot.
            try {
                const eventsVersion: number = ++this.eventsVersion;
                const entries: TimelineEntry[] = await LearningAgentApi.getEvents();
                if (!this.alive || version !== this.launchVersion || navigationVersion !== this.navigationVersion) {
                    return;
                }
                const index: number = entries.findIndex((entry: TimelineEntry): boolean => entry.id === decisionId);
                if (route === 'mirror' || route === 'judgment') {
                    if (index >= 0) {
                        this.openInspect(entries[index]);
                    } else {
                        this.navigationError = '这条建议已不在最近的学习记录中，请查看今日的其他建议。';
                    }
                    return;
                }
                if (eventsVersion === this.eventsVersion) {
                    this.entries = entries;
                    this.rebuildTimeline();
                }
                if (index >= 0) {
                    setTimeout(() => {
                        if (this.alive && version === this.launchVersion && navigationVersion === this.navigationVersion &&
                            this.top().level === AgentLevel.DAY) {
                            const timelineIndex: number = this.timeline.findIndex((entry: AgentTimelineEntry): boolean =>
                                entry.id === decisionId || entry.remoteId === decisionId);
                            this.scroller.scrollToIndex(timelineIndex >= 0 ? timelineIndex + 1 : 0, false, ScrollAlign.CENTER);
                        }
                    }, 50);
                } else {
                    this.errorText = '这条决策已不在最近的学习记录中';
                }
            } catch (error) {
                if (this.alive && version === this.launchVersion && navigationVersion === this.navigationVersion) {
                    this.errorText = agentFailure(error);
                }
            }
        }
        if (route === 'day' && decisionId.length === 0 && this.lastSyncedAt > 0) {
            this.scrollToLatest(false);
        }
    }

    private async refresh(): Promise<void> {
        const version: number = ++this.refreshVersion;
        const owner = LearningHttp.captureIdentity();
        this.loading = true;
        try {
            const today: TodayData = await LearningAgentApi.getToday();
            if (!this.alive || version !== this.refreshVersion || !LearningHttp.isCurrent(owner)) {
                return;
            }
            this.focus = today.focus || NO_AGENT_TARGET;
            this.todayStatus = today.status;
            this.studyMinutes = today.today !== undefined ? Math.max(0, today.today.study_minutes || 0) : 0;
            this.completedChapters = today.today !== undefined ? Math.max(0, today.today.completed_chapters || 0) : 0;
            const eventsVersion: number = ++this.eventsVersion;
            const entries: TimelineEntry[] = await LearningAgentApi.getEvents();
            if (this.alive && version === this.refreshVersion && eventsVersion === this.eventsVersion && LearningHttp.isCurrent(owner)) {
                this.entries = entries;
                this.rebuildTimeline();
                this.lastSyncedAt = Date.now();
                this.errorText = '';
                this.scrollToLatest(false);
                const host = this.getUIContext().getHostContext();
                if (host !== undefined) {
                    void LearningSystemEntry.updateToday(host, today, entries);
                }
            }
        } catch (error) {
            if (this.alive && version === this.refreshVersion) {
                this.errorText = agentFailure(error);
            }
        } finally {
            if (this.alive && version === this.refreshVersion) {
                this.loading = false;
            }
        }
    }

    private async defaultTarget(preferred: LearnTarget = this.focus, allowEmpty: boolean = false): Promise<LearnTarget> {
        if (preferred.lecture_id.length > 0 && preferred.book_id.length > 0) {
            return preferred;
        }
        const context = await LearningAgentApi.getContext();
        for (const lecture of context.lectures) {
            if (preferred.lecture_id.length > 0 && lecture.id !== preferred.lecture_id) {
                continue;
            }
            if (lecture.books.length > 0) {
                const book = lecture.books[0];
                return { lecture_id: lecture.id, lecture_title: lecture.title,
                    book_id: book.id, book_title: book.title, chapter_index: Math.max(0, preferred.chapter_index),
                    chapter_name: preferred.chapter_name, chapter_range: '' };
            }
        }
        if (allowEmpty) {
            return NO_AGENT_TARGET;
        }
        throw new Error('还没有可用教材，请先去学习选择课程');
    }

    private async openSession(): Promise<void> {
        if (this.opening) {
            return;
        }
        const version: number = ++this.navigationVersion;
        this.clearNavigationFeedback();
        this.opening = true;
        this.errorText = '';
        try {
            const session = await LearningAgentApi.openSession();
            if (this.alive && version === this.navigationVersion) {
                this.opening = false;
                await this.openReader(session.target);
            }
        } catch (error) {
            if (this.alive && version === this.navigationVersion) {
                this.opening = false;
                this.errorText = agentFailure(error);
            }
        }
    }

    private async openReader(target: LearnTarget, flowId: string = ''): Promise<void> {
        if (this.navigationOpening) {
            return;
        }
        const version: number = ++this.navigationVersion;
        const owner = LearningHttp.captureIdentity();
        this.opening = true;
        this.navigationOpening = true;
        this.navigationError = '';
        this.navigationLabel = '正在打开教材…';
        try {
            const resolved = await LearningApi.shared.resolveReaderTarget(target.lecture_id, target.book_id);
            if (!this.alive || version !== this.navigationVersion || !LearningHttp.isCurrent(owner)) {
                return;
            }
            if (!resolved.success || resolved.book === null || resolved.chapters.length === 0) {
                throw new Error(resolved.message || '教材目录暂时不可用');
            }
            const valid: boolean = resolved.chapters.some((chapter: LearningChapterSummary): boolean => chapter.index === target.chapter_index);
            if (!valid) {
                throw new Error('这条记录对应的章节已变更，请从教材目录重新选择');
            }
            const frame: AgentFrame = new AgentFrame();
            frame.level = AgentLevel.READER;
            frame.target = target;
            frame.flowId = flowId;
            frame.book = resolved.book;
            frame.chapters = resolved.chapters;
            this.expectedFlowId = flowId;
            if (flowId.length > 0) {
                if (this.activeFlowId !== flowId) {
                    this.activeFlowStep = 'opened';
                }
                this.activeFlowId = flowId;
                this.activeFlowTarget = target;
                this.rebuildTimeline();
            }
            this.readerOverlayOpen = false;
            this.push(frame);
        } catch (error) {
            if (this.alive && version === this.navigationVersion) {
                this.navigationError = '教材暂时无法打开：' + agentFailure(error);
            }
        } finally {
            if (this.alive && version === this.navigationVersion) {
                this.opening = false;
                this.navigationOpening = false;
            }
        }
    }

    private openReview(target: LearnTarget, flowId: string = ''): void {
        this.navigationVersion++;
        this.opening = false;
        const frame: AgentFrame = new AgentFrame();
        frame.level = AgentLevel.REVIEW;
        frame.target = target;
        frame.flowId = flowId;
        this.push(frame);
    }

    private async openReport(target: LearnTarget): Promise<void> {
        if (this.navigationOpening) {
            return;
        }
        const version: number = ++this.navigationVersion;
        this.opening = true;
        this.navigationOpening = true;
        this.navigationError = '';
        this.navigationLabel = '正在打开学习情况…';
        try {
            const resolved: LearnTarget = await this.defaultTarget(target);
            if (!this.alive || version !== this.navigationVersion) {
                return;
            }
            const frame: AgentFrame = new AgentFrame();
            frame.level = AgentLevel.REPORT;
            frame.target = resolved;
            this.push(frame);
        } catch (error) {
            if (this.alive && version === this.navigationVersion) {
                this.navigationError = '学习情况暂时无法打开：' + agentFailure(error);
            }
        } finally {
            if (this.alive && version === this.navigationVersion) {
                this.opening = false;
                this.navigationOpening = false;
            }
        }
    }

    private openInspect(entry: TimelineEntry): void {
        if (entry.kind === 'user_msg') { return; }
        this.navigationVersion++;
        const frame: AgentFrame = new AgentFrame();
        frame.level = AgentLevel.INSPECT;
        frame.entry = entry;
        this.push(frame);
    }

    // Old mirror links remain useful after removing the everyday profile shortcut.
    private openMemorySettings(): void {
        this.navigationVersion++;
        const frame: AgentFrame = new AgentFrame();
        frame.level = AgentLevel.MEMORY;
        this.push(frame);
    }

    private async openFlow(flowId: string): Promise<void> {
        const version: number = ++this.navigationVersion;
        this.clearNavigationFeedback();
        this.opening = true;
        this.errorText = '';
        try {
            const flow: FlowStateData = await LearningAgentApi.getFlow(flowId);
            if (!this.alive || version !== this.navigationVersion) {
                return;
            }
            if (flow.status === 'not_found') {
                this.clearActiveFlow(flowId);
                throw new Error('这次学习流程已不存在');
            }
            const finished: boolean = flow.status === 'done' || flow.step === 'wrapup' || flow.step === 'aborted';
            if (finished) {
                this.clearActiveFlow(flowId);
            } else {
                this.activeFlowId = flowId;
                this.activeFlowTarget = flow.target;
                this.activeFlowStep = flow.step;
                this.rebuildTimeline();
            }
            this.opening = false;
            if (finished || flow.step !== 'opened') {
                this.openReview(flow.target, flowId);
            } else {
                await this.openReader(flow.target, flowId);
            }
        } catch (error) {
            if (this.alive && version === this.navigationVersion) {
                this.errorText = agentFailure(error);
            }
        } finally {
            if (this.alive && version === this.navigationVersion) {
                this.opening = false;
            }
        }
    }

    private async respond(entry: TimelineEntry, response: string): Promise<void> {
        if (this.actionBusy.length > 0) {
            return;
        }
        this.actionBusy = entry.id;
        let decisionId: string = entry.id;
        for (const action of entry.actions || []) {
            if (action.action === 'decision_accept' && action.payload !== undefined) {
                decisionId = action.payload['decision_id'] || entry.id;
            }
        }
        try {
            const env: AgentEnvelope = await LearningAgentApi.respondDecision(decisionId, response);
            if (!this.alive) {
                return;
            }
            this.actionNotice = response === 'accept' ? '已接受这次建议' : response === 'defer' ? '已暂缓这条建议，后续安排会更新在这里。' : '这条建议已结束。';
            void this.refresh();
            if (response === 'accept') {
                let flowId: string = '';
                for (const action of env.next_actions || []) {
                    if (action.type === 'flow') {
                        flowId = action.flow_id || '';
                    }
                }
                if (flowId.length > 0) {
                    await this.openFlow(flowId);
                } else {
                    await this.openSession();
                }
            }
        } catch (error) {
            if (this.alive) {
                this.errorText = '选择尚未送到：' + agentFailure(error);
            }
        } finally {
            this.actionBusy = '';
        }
    }

    private openCard(entry: TimelineEntry): void {
        const card = entry.card;
        if (card === null || card === undefined) {
            return;
        }
        if (card.type === 'plan') {
            const target: LearnTarget | null | undefined = (card as PlanCard).target;
            if (target !== undefined && target !== null && target.book_id.length > 0) {
                void this.openReader(target);
            } else if (this.focus.book_id.length > 0) {
                this.errorText = '这张旧计划没有保存章节，将打开当前学习目标。';
                void this.openReader(this.focus);
            } else {
                void this.openSession();
            }
        } else if (card.type === 'prereq') {
            const prereq: PrereqCard = card as PrereqCard;
            const target: LearnTarget = { lecture_id: prereq.fromLectureId || '', lecture_title: prereq.fromCourse,
                book_id: prereq.fromBookId || '', book_title: '', chapter_index: prereq.fromChapterIndex !== undefined ? prereq.fromChapterIndex : -1,
                chapter_name: '', chapter_range: '' };
            if (target.lecture_id.length === 0 || target.book_id.length === 0 || target.chapter_index < 0) {
                this.errorText = '这张先修卡没有可用的章节定位';
                return;
            }
            void this.openReader(target);
        } else if (card.type === 'quiz') {
            const flowId: string = (card as QuizCard).flowId || '';
            if (flowId.length > 0) {
                void this.openFlow(flowId);
            } else {
                this.errorText = '这张旧题卡没有复习流程，请从今日复习重新开始';
            }
        } else if (card.type === 'prep') {
            void this.openSession();
        }
    }

    private async send(mode: string = 'ask'): Promise<void> {
        const text: string = (mode === 'plan' ? this.planDraft : this.draft).trim();
        if (text.length === 0 || this.sending) { return; }
        const owner = LearningHttp.captureIdentity();
        const target: LearnTarget | null = this.focus.book_id.length > 0 ? this.focus : null;
        const outgoing: AgentOutgoingMessage = new AgentOutgoingMessage({
            id: 'local_user_' + Date.now() + '_' + this.nextMessageId++, kind: 'user_msg',
            ts: Date.now(), text: text, unattended: false, channel: 'app'
        }, this.entries.map((entry: TimelineEntry): string => entry.id));
        this.outgoingMessages.push(outgoing);
        this.sending = true;
        this.sendingMode = mode;
        this.errorText = '';
        this.actionNotice = '';
        if (mode === 'plan') {
            this.planDraft = '';
            this.closeCompose();
        } else {
            this.draft = '';
        }
        this.rebuildTimeline();
        this.scrollToLatest(true);
        try {
            // The API has no client message ID. Establish a baseline after displaying the
            // bubble so older identical questions cannot be mistaken for this send.
            const baselineVersion: number = ++this.eventsVersion;
            try {
                const baseline: TimelineEntry[] = await LearningAgentApi.getEvents();
                outgoing.baselineIds = outgoing.baselineIds.concat(baseline.map((entry: TimelineEntry): string => entry.id));
                if (this.alive && baselineVersion === this.eventsVersion && LearningHttp.isCurrent(owner)) {
                    this.entries = baseline;
                    this.rebuildTimeline();
                }
            } catch (_) {
                // A timeline read failure must not prevent a requested message from sending.
                // In this case, reconcile against the IDs already known by this client.
            }
            if (!LearningHttp.isCurrent(owner)) {
                throw new Error('账号或学习服务已切换，请重新打开');
            }
            outgoing.baselineIds = outgoing.baselineIds.concat(this.entries.map((entry: TimelineEntry): string => entry.id));
            outgoing.started = true;
            // Discard any event snapshot started before the POST, including a concurrent refresh.
            this.eventsVersion++;
            if (mode === 'plan') {
                await LearningAgentApi.plan(text);
            } else {
                await LearningAgentApi.ask(text, target);
            }
        } catch (error) {
            if (this.alive && LearningHttp.isCurrent(owner)) {
                outgoing.errorText = agentFailure(error);
            }
        } finally {
            outgoing.pending = false;
            this.sending = false;
            this.sendingMode = '';
            if (this.alive && LearningHttp.isCurrent(owner)) {
                this.rebuildTimeline();
                this.scrollToLatest(false);
                // Refresh even on failure: the question may already have reached the service.
                await this.refresh();
            }
        }
    }

    private outgoingEntry(message: AgentOutgoingMessage): AgentTimelineEntry {
        const entry: TimelineEntry = message.remoteEntry || message.entry;
        return {
            id: message.entry.id, remoteId: message.remoteEntry !== null ? message.remoteEntry.id : '',
            kind: 'user_msg', ts: entry.ts, text: entry.text, unattended: false, channel: 'app',
            deliveryPending: message.pending, deliveryError: message.errorText
        };
    }

    private reconcileOutgoing(): void {
        const claimed: string[] = [];
        for (const message of this.outgoingMessages) {
            if (message.remoteEntry !== null) { claimed.push(message.remoteEntry.id); }
        }
        for (const message of this.outgoingMessages) {
            if (!message.started) { continue; }
            const remote: TimelineEntry | undefined = this.entries.find((entry: TimelineEntry): boolean =>
                message.remoteEntry !== null ? entry.id === message.remoteEntry.id :
                    entry.kind === 'user_msg' && entry.channel === 'app' && entry.text === message.entry.text &&
                    message.baselineIds.indexOf(entry.id) < 0 && claimed.indexOf(entry.id) < 0);
            if (remote !== undefined) {
                message.remoteEntry = remote;
                claimed.push(remote.id);
            }
        }
    }

    private rebuildTimeline(): void {
        this.reconcileOutgoing();
        // Replace each canonical record in place to preserve same-second question/reply order.
        const merged: AgentTimelineEntry[] = this.entries.map((entry: TimelineEntry): AgentTimelineEntry => {
            const message: AgentOutgoingMessage | undefined = this.outgoingMessages.find((item: AgentOutgoingMessage): boolean =>
                item.remoteEntry !== null && item.remoteEntry.id === entry.id);
            return message !== undefined ? this.outgoingEntry(message) : entry;
        });
        for (const message of this.outgoingMessages) {
            if (message.remoteEntry === null || !this.entries.some((entry: TimelineEntry): boolean =>
                message.remoteEntry !== null && entry.id === message.remoteEntry.id)) {
                merged.push(this.outgoingEntry(message));
            }
        }
        const ordered: AgentTimelineEntry[] = merged.sort((left: AgentTimelineEntry, right: AgentTimelineEntry): number => left.ts - right.ts);
        this.timeline = ordered.filter((entry: AgentTimelineEntry): boolean =>
            (this.showProcess || entry.id === this.launchDecision || entry.kind !== 'tool_step' && entry.kind !== 'agent_hold'));
    }

    private scrollToLatest(force: boolean = false): void {
        if (force) { this.followLatest = true; }
        if (!this.alive || !this.followLatest) { return; }
        this.pendingLatestScroll = true;
        const version: number = ++this.timelineScrollVersion;
        setTimeout(() => {
            if (!this.alive || version !== this.timelineScrollVersion || !this.followLatest || !this.visible ||
                this.top().level !== AgentLevel.DAY || this.dayTab !== 0 || this.composerOpen) {
                return;
            }
            // Item zero is the greeting/status header; the final event follows all older entries.
            this.scroller.scrollToIndex(this.timeline.length, false, ScrollAlign.END);
            this.pendingLatestScroll = false;
        }, 50);
    }

    private onTimelineScroll(offset: number): void {
        // Programmatic scrollToIndex does not emit onScrollFrameBegin. A user gesture cancels
        // queued following until onReachEnd confirms that the reader is back at the latest entry.
        if (offset !== 0) {
            this.timelineUserScrolling = true;
            this.followLatest = false;
            this.pendingLatestScroll = false;
            this.timelineScrollVersion++;
        }
    }

    private onTimelineEnd(): void {
        // Layout and deep-link positioning can also reach the end. Only a user's scroll
        // may resume following; the explicit latest button already opts in itself.
        if (this.timelineUserScrolling) {
            this.followLatest = true;
        }
    }

    private onTimelineScrollStop(): void {
        this.timelineUserScrolling = false;
    }

    private greetingText(): string {
        const name: string = sanitizeDisplayName(this.app.displayName) || sanitizeDisplayName(this.app.username);
        return greetingOfHour(new Date().getHours()) + (name.length > 0 ? '，' + name : '');
    }

    private processCount(): number {
        return this.entries.filter((entry: TimelineEntry): boolean => entry.kind === 'tool_step' || entry.kind === 'agent_hold').length;
    }

    private dateHeading(): string {
        const now: Date = new Date();
        const weekdays: string[] = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        return (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日 · ' + weekdays[now.getDay()];
    }

    private entryDate(entry: TimelineEntry): string {
        if (!Number.isFinite(entry.ts) || entry.ts <= 0) { return '学习记录'; }
        const date: Date = new Date(entry.ts);
        const now: Date = new Date();
        const day: number = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
        const today: number = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const prefix: string = day === today ? '今天' : day === today - 86400000 ? '昨天' : (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日';
        return prefix + ' ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    }

    private entryLabel(entry: TimelineEntry): string {
        const type: string = entry.card !== undefined && entry.card !== null ? entry.card.type : '';
        if (type === 'proactive') { return '学习建议'; }
        if (type === 'plan') { return '学习安排'; }
        if (type === 'prep') { return '备课完成'; }
        if (type === 'prereq') { return '先修知识'; }
        if (type === 'quiz') { return '本章小测'; }
        if (type === 'wrapup') { return '本次反馈'; }
        if (type === 'confusion') { return '值得再确认'; }
        if (type === 'citation') { return '阅读依据'; }
        if (entry.kind === 'user_msg') { return '我的提问'; }
        if (entry.kind === 'agent_hold') { return '这次没有打扰你'; }
        if (entry.kind === 'tool_step') { return '准备过程'; }
        if (entry.kind === 'system') { return '学习足迹'; }
        return 'Agent 的回复';
    }

    private entryTitle(entry: TimelineEntry): string {
        const card = entry.card;
        if (card === undefined || card === null) { return ''; }
        if (card.type === 'proactive') { return (card as ProactiveCard).title; }
        if (card.type === 'plan') { return (card as PlanCard).chapter; }
        if (card.type === 'prep') { return (card as PrepCard).chapter; }
        if (card.type === 'prereq') { return (card as PrereqCard).concept; }
        if (card.type === 'quiz') { return '用一次小测确认理解'; }
        if (card.type === 'wrapup') { return (card as WrapupCard).chapter; }
        if (card.type === 'citation') { return (card as CitationCard).book; }
        return '';
    }

    private entryDetail(entry: TimelineEntry): string {
        const card = entry.card;
        if (card === undefined || card === null) { return ''; }
        if (card.type === 'proactive') { return (card as ProactiveCard).reason || entry.reason || ''; }
        if (card.type === 'plan') { return (card as PlanCard).why; }
        if (card.type === 'prep') { return ((card as PrepCard).highlights || []).join('\n'); }
        if (card.type === 'prereq') { return '来自 ' + (card as PrereqCard).fromCourse; }
        if (card.type === 'quiz') { return (card as QuizCard).stem; }
        if (card.type === 'wrapup') { return '本次小测 ' + (card as WrapupCard).quizScore; }
        if (card.type === 'citation') { return (card as CitationCard).excerpt; }
        return '';
    }

    private entryMinutes(entry: TimelineEntry): string {
        const card = entry.card;
        let minutes: number = 0;
        if (card !== undefined && card !== null) {
            if (card.type === 'proactive') { minutes = (card as ProactiveCard).minutes; }
            if (card.type === 'plan') { minutes = (card as PlanCard).minutes; }
            if (card.type === 'prereq') { minutes = (card as PrereqCard).minutes; }
        }
        return Number.isFinite(minutes) && minutes > 0 ? '建议留出 ' + Math.round(minutes) + ' 分钟' : '';
    }

    private hasEntryText(entry: TimelineEntry): boolean {
        const text: string = (entry.text || '').trim();
        return text.length > 0 && text !== this.entryTitle(entry).trim() && text !== this.entryDetail(entry).trim();
    }

    private isExpanded(entry: TimelineEntry): boolean {
        return this.expandedEntries.indexOf(entry.id) >= 0;
    }

    private toggleEntry(entry: TimelineEntry): void {
        const collapsing: boolean = this.isExpanded(entry);
        this.expandedEntries = collapsing ? this.expandedEntries.filter((id: string): boolean => id !== entry.id) : this.expandedEntries.concat([entry.id]);
        if (collapsing) {
            setTimeout(() => {
                if (!this.alive || !this.visible || this.dayTab !== 0 || this.top().level !== AgentLevel.DAY || this.isExpanded(entry)) {
                    return;
                }
                const index: number = this.timeline.findIndex((item: TimelineEntry): boolean => item.id === entry.id);
                if (index >= 0) {
                    this.followLatest = false;
                    this.timelineScrollVersion++;
                    this.scroller.scrollToIndex(index + 1, false, ScrollAlign.START);
                }
            }, 50);
        }
    }

    private canExpandEntry(entry: TimelineEntry): boolean {
        const detail: string = this.entryDetail(entry);
        return entry.text.length > 220 || detail.length > 120 || detail.split('\n').length > 4;
    }

    private async selectInsights(): Promise<void> {
        this.dayTab = 1;
        this.insightLoading = true;
        const version: number = ++this.navigationVersion;
        this.clearNavigationFeedback();
        try {
            const target: LearnTarget = await this.defaultTarget(this.focus, true);
            if (this.alive && version === this.navigationVersion && this.dayTab === 1) {
                this.insightTarget = target;
            }
        } catch (error) {
            if (this.alive && version === this.navigationVersion) { this.navigationError = '学习情况暂时无法打开：' + agentFailure(error); }
        } finally {
            if (this.alive && version === this.navigationVersion) { this.insightLoading = false; }
        }
    }

    private selectTimeline(): void {
        this.navigationVersion++;
        this.clearNavigationFeedback();
        this.dayTab = 0;
        this.insightLoading = false;
    }

    private beginCompose(): void {
        this.composerOpen = true;
        this.navDepth = this.frames.length;
    }

    private closeCompose(): void {
        this.composerOpen = false;
        this.navDepth = this.frames.length - 1;
        if (this.pendingLatestScroll) { this.scrollToLatest(false); }
    }

    private clearActiveFlow(flowId: string): void {
        if (flowId.length === 0 || flowId !== this.activeFlowId) {
            return;
        }
        this.activeFlowId = '';
        this.activeFlowTarget = NO_AGENT_TARGET;
        this.activeFlowStep = '';
        if (this.expectedFlowId === flowId) { this.expectedFlowId = ''; }
        if (this.pendingFlowId === flowId) { this.pendingFlowId = ''; }
        this.rebuildTimeline();
    }

    private onTaskSubmitted(flowId: string): void {
        this.clearActiveFlow(flowId);
        this.actionNotice = '本次练习已记录，可以查看反馈。';
        void this.refresh();
    }

    @Builder
    ActionButton($$: AgentButtonOptions) {
        Button($$.label, { type: ButtonType.Normal })
            .id($$.id).width('100%').constraintSize({ minHeight: Size.touchTarget })
            .padding({ top: Space.md, bottom: Space.md, left: Space.lg, right: Space.lg })
            .fontSize(FontSize.body).fontWeight(FontWeight.Medium)
            .fontColor($$.primary ? $r('app.color.text_inverse') : $r('app.color.text_brand'))
            .backgroundColor($$.primary ? $r('app.color.brand_primary') : $r('app.color.brand_soft'))
            .borderRadius(Radius.md).enabled(!this.opening && this.actionBusy.length === 0)
            .onClick($$.onTap)
    }

    @Builder
    QuietButton($$: AgentButtonOptions) {
        Button($$.label, { type: ButtonType.Normal })
            .id($$.id).fontSize(FontSize.small).fontColor($r('app.color.text_secondary'))
            .backgroundColor(Color.Transparent).borderRadius(Radius.sm)
            .constraintSize({ minHeight: Size.touchTarget })
            .padding({ left: Space.sm, right: Space.sm })
            .enabled(!this.opening && this.actionBusy.length === 0).onClick($$.onTap)
    }

    @Builder
    EntryCard(entry: TimelineEntry) {
        Column({ space: Space.md }) {
            Row({ space: Space.sm }) {
                Image($r('app.media.ic_spark')).width(Size.iconSmall).height(Size.iconSmall).fillColor($r('app.color.brand_primary'))
                Text(this.entryLabel(entry)).fontSize(FontSize.small).fontColor($r('app.color.text_brand')).layoutWeight(1)
                if (this.entryMinutes(entry).length > 0) {
                    Text(this.entryMinutes(entry)).fontSize(FontSize.caption).fontColor($r('app.color.text_secondary'))
                }
            }.width('100%')
            if (this.entryTitle(entry).length > 0) {
                Text(this.entryTitle(entry)).fontSize(FontSize.title).fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.text_primary')).width('100%').lineHeight(LineHeight.title)
            }
            if (this.entryDetail(entry).length > 0) {
                Text(this.entryDetail(entry)).fontSize(FontSize.body).fontColor($r('app.color.text_secondary'))
                    .width('100%').lineHeight(LineHeight.body)
                    .maxLines(this.canExpandEntry(entry) && !this.isExpanded(entry) ? 4 : 1000).textOverflow({ overflow: TextOverflow.Ellipsis })
            }
            if (this.hasEntryText(entry)) {
                if (entry.text.length <= 220 || this.isExpanded(entry)) {
                    MarkdownView({ source: entry.text }).width('100%')
                } else {
                    Text(entry.text.substring(0, 220) + '…').fontSize(FontSize.body)
                        .fontColor($r('app.color.text_primary')).width('100%').lineHeight(LineHeight.body)
                        .maxLines(6).textOverflow({ overflow: TextOverflow.Ellipsis })
                }
            }
            if (this.canExpandEntry(entry)) {
                this.QuietButton({ label: this.isExpanded(entry) ? '收起全文' : '展开全文', id: 'agent_entry_expand_' + entry.id, onTap: () => { this.toggleEntry(entry); } })
            }
            if (entry.card !== undefined && entry.card !== null) {
                if (entry.card.type === 'proactive') {
                    if (entry.status === undefined || entry.status === 'pending') {
                        this.ActionButton({ label: this.actionBusy === entry.id ? '正在确认…' : '开始复习', id: 'agent_decision_accept_' + entry.id, onTap: () => { void this.respond(entry, 'accept'); }, primary: true })
                        Row() {
                            this.QuietButton({ label: '晚点再学', id: 'agent_decision_defer_' + entry.id, onTap: () => { void this.respond(entry, 'defer'); } })
                            Blank()
                            this.QuietButton({ label: '不用了', id: 'agent_decision_dismiss_' + entry.id, onTap: () => { void this.respond(entry, 'dismiss'); } })
                        }.width('100%')
                    } else {
                        Text(entry.status === 'accept' ? '已接受这次建议' : entry.status === 'defer' ? '已暂缓，等待后续安排' : '这条建议已结束')
                            .fontSize(FontSize.small).fontColor($r('app.color.text_secondary')).width('100%')
                    }
                } else if (entry.card.type === 'plan' || entry.card.type === 'prep' || entry.card.type === 'prereq' || entry.card.type === 'quiz') {
                    this.ActionButton({ label: entry.card.type === 'quiz' ? '开始小测' : '开始阅读', id: 'agent_entry_open_' + entry.id, onTap: () => { this.openCard(entry); }, primary: true })
                } else if (entry.card.type === 'wrapup' && ((entry.card as WrapupCard).flowId || '').length > 0) {
                    this.ActionButton({ label: '查看本次反馈', id: 'agent_entry_result_' + entry.id, onTap: () => { void this.openFlow((entry.card as WrapupCard).flowId || ''); } })
                }
            }
            Row() {
                this.QuietButton({ label: entry.card !== undefined && entry.card !== null &&
                    ['plan', 'prereq', 'prep', 'proactive', 'quiz'].indexOf(entry.card.type) >= 0 ? '为什么推荐' : '查看依据',
                    id: 'agent_entry_inspect_' + entry.id, onTap: () => { this.openInspect(entry); } })
                Blank()
            }.width('100%')
        }.width('100%').padding(Space.lg).borderRadius(Radius.lg)
            .alignItems(HorizontalAlign.Start).backgroundColor($r('app.color.bg_card'))
            .border({ width: entry.id === this.launchDecision ? 1 : 0, color: $r('app.color.brand_primary') })
            .gesture(LongPressGesture().onAction(() => { this.openInspect(entry); }))
    }

    @Builder
    TimelineEntryView(entry: AgentTimelineEntry) {
        if (entry.kind === 'user_msg') {
            LearningAgentUserMessage({ text: entry.text, timeLabel: this.entryDate(entry),
                pending: entry.deliveryPending === true, errorText: entry.deliveryError || '',
                controlPrefix: 'agent_user_message_' + entry.id,
                onRefresh: () => { void this.refresh(); }
            }).width('100%')
        } else {
            Column() {
                Stack({ alignContent: Alignment.TopStart }) {
                    Column({ space: Space.sm }) {
                        Text(this.entryDate(entry)).fontSize(FontSize.small).fontColor($r('app.color.text_secondary')).width('100%')
                        this.EntryCard(entry)
                    }.width('100%').padding({ left: Space.xl, bottom: Space.xl }).alignItems(HorizontalAlign.Start)
                        .border({ width: { left: Size.divider }, color: $r('app.color.border') })
                    Row().width(Space.sm).height(Space.sm).borderRadius(Radius.full)
                        .backgroundColor(entry.kind === 'system' ? $r('app.color.border_strong') : $r('app.color.brand_primary'))
                        .position({ x: -Space.xs, y: Space.sm })
                }.width('100%')
            }.width('100%').padding({ left: Space.sm })
        }
    }

    @Builder
    CurrentStep() {
        Column() {
          Stack({ alignContent: Alignment.TopStart }) {
            Column({ space: Space.md }) {
                Text('现在 · 下一步').fontSize(FontSize.small).fontColor($r('app.color.text_secondary')).width('100%')
                if (this.activeFlowId.length > 0) {
                    Column({ space: Space.md }) {
                        Text('继续本次复习').fontSize(FontSize.title).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary')).width('100%')
                        Text(this.activeFlowTarget.chapter_name || '回到正在进行的章节')
                            .fontSize(FontSize.body).fontColor($r('app.color.text_secondary')).width('100%')
                        this.ActionButton({ label: this.activeFlowStep === 'opened' ? '继续阅读' : '继续小测', id: 'agent_resume_flow', onTap: () => { void this.openFlow(this.activeFlowId); }, primary: true })
                    }.width('100%').padding(Space.lg).borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'))
                } else {
                    Column({ space: Space.md }) {
                        Row({ space: Space.sm }) {
                            Image($r('app.media.ic_book')).width(Size.iconSmall).height(Size.iconSmall).fillColor($r('app.color.brand_primary'))
                            Text(this.todayStatus === 'needs_course' ? '从你正在学的课开始' : '按自己的节奏继续')
                                .fontSize(FontSize.small).fontColor($r('app.color.text_brand')).layoutWeight(1)
                        }.width('100%')
                        Text(this.todayStatus === 'needs_course' ? '先选一门课，开始留下足迹。' : this.focus.chapter_name || '今天，接着学一点。')
                            .fontSize(FontSize.title).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary')).width('100%').lineHeight(LineHeight.title)
                        Text(this.todayStatus === 'needs_course' ? '读过的内容和做过的练习，会成为下一次建议的依据。' :
                            this.focus.lecture_title.length > 0 ? this.focus.lecture_title + (this.focus.book_title.length > 0 ? ' · ' + this.focus.book_title : '') : '新的建议会出现在时间线里，你也可以先继续阅读。')
                            .fontSize(FontSize.small).fontColor($r('app.color.text_secondary')).width('100%').lineHeight(LineHeight.caption)
                        if (this.todayStatus === 'needs_course') {
                            this.ActionButton({ label: '去选课程', id: 'agent_choose_course', onTap: () => { this.onOpenLearning(); }, primary: true })
                        } else {
                            this.ActionButton({ label: this.opening ? '正在打开…' : this.todayStatus === 'resume' ? '继续阅读' : '开始阅读', id: 'agent_continue_reading', onTap: () => { void this.openSession(); }, primary: true })
                        }
                    }.width('100%').padding(Space.lg).borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'))
                }
            }.width('100%').padding({ left: Space.xl, bottom: Space.lg }).alignItems(HorizontalAlign.Start)
                .border({ width: { left: Size.divider }, color: $r('app.color.border') })
            Row().width(Space.sm).height(Space.sm).borderRadius(Radius.full).backgroundColor($r('app.color.brand_primary'))
                .position({ x: -Space.xs, y: Space.sm })
          }.width('100%')
        }.width('100%').padding({ left: Space.sm })
    }

    @Builder
    TimelineHeader() {
        Column({ space: Space.xl }) {
            Column({ space: Space.sm }) {
                Text(this.greetingText()).fontSize(FontSize.display).fontWeight(FontWeight.Bold)
                    .fontColor($r('app.color.text_primary')).width('100%').lineHeight(LineHeight.display)
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                Text('今天的学习，接着聊。').fontSize(FontSize.body).fontColor($r('app.color.text_secondary')).width('100%')
                Text(this.dateHeading()).fontSize(FontSize.small).fontColor($r('app.color.text_secondary')).width('100%')
                if (this.lastSyncedAt > 0 && (this.studyMinutes > 0 || this.completedChapters > 0)) {
                    Text('今日已读 ' + this.studyMinutes + ' 分钟 · 已确认读完 ' + this.completedChapters + ' 章')
                        .fontSize(FontSize.small).fontColor($r('app.color.text_secondary')).width('100%')
                }
            }.width('100%').alignItems(HorizontalAlign.Start)
            if (this.errorText.length > 0) {
                Column({ space: Space.sm }) {
                    Text(this.lastSyncedAt > 0 ? '暂时未能更新，以下为上次同步的内容。' : '暂时无法加载学习记录')
                        .fontSize(FontSize.body).fontColor($r('app.color.text_primary')).width('100%')
                    Text(this.errorText).fontSize(FontSize.small).fontColor($r('app.color.text_secondary')).width('100%').lineHeight(LineHeight.caption)
                    this.QuietButton({ label: '重新加载', id: 'agent_retry', onTap: () => { void this.refresh(); } })
                }.width('100%').padding(Space.lg).borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'))
            }
            if (this.actionNotice.length > 0) {
                Row({ space: Space.sm }) {
                    Image($r('app.media.ic_check')).width(Size.iconSmall).height(Size.iconSmall).fillColor($r('app.color.text_success'))
                    Text(this.actionNotice).fontSize(FontSize.small).fontColor($r('app.color.text_secondary')).layoutWeight(1)
                    IconButton({ icon: $r('app.media.ic_close'), onTap: () => { this.actionNotice = ''; } }).id('agent_notice_close').accessibilityText('关闭提示')
                }.width('100%')
            }
            if (this.loading && this.lastSyncedAt === 0) {
                Column({ space: Space.md }) {
                    LoadingProgress().width(Size.avatar).height(Size.avatar).color($r('app.color.brand_primary'))
                    Text('正在整理你的学习记录…').fontSize(FontSize.body).fontColor($r('app.color.text_secondary'))
                }.width('100%').padding(Space.xxl)
            } else if (this.lastSyncedAt > 0 && (this.activeFlowId.length > 0 || this.timeline.length === 0)) {
                this.CurrentStep()
            }
            if (this.lastSyncedAt > 0) {
                Row() {
                    this.QuietButton({ label: '考考我', id: 'agent_review', onTap: () => { this.openReview(this.focus); } })
                    Blank()
                    this.QuietButton({ label: '安排下一步', id: 'agent_plan', onTap: () => { this.beginCompose(); } })
                }.width('100%')
                Row() {
                    Text('学习时间线').fontSize(FontSize.body).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary')).layoutWeight(1)
                    if (this.processCount() > 0) {
                        this.QuietButton({ label: this.showProcess ? '收起过程' : '过程记录 ' + this.processCount(), id: 'agent_process_toggle', onTap: () => { this.showProcess = !this.showProcess; this.rebuildTimeline(); } })
                    }
                    IconButton({ icon: $r('app.media.ic_refresh'), isEnabled: !this.loading, onTap: () => { void this.refresh(); } })
                        .id('agent_refresh').accessibilityText('刷新学习时间线')
                }.width('100%')
            }
        }.width('100%').padding({ top: Space.xl, bottom: Space.lg }).alignItems(HorizontalAlign.Start)
    }

    @Builder
    Composer() {
        Column({ space: Space.md }) {
            Row() {
                Text('安排下一步学习').fontSize(FontSize.title).fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.text_primary')).layoutWeight(1)
                IconButton({ icon: $r('app.media.ic_close'), onTap: () => { this.closeCompose(); } }).id('agent_composer_close').accessibilityText('关闭输入面板')
            }.width('100%')
            Scroll() {
                Column({ space: Space.md }) {
                    Text('告诉我想学什么，我会结合当前课程安排下一章。')
                        .fontSize(FontSize.small).fontColor($r('app.color.text_secondary')).width('100%').lineHeight(LineHeight.caption)
                    TextArea({ text: this.planDraft, placeholder: '例如：帮我安排下一章的学习' })
                        .id('agent_composer_input').width('100%').height(Size.inputMaxHeight)
                        .fontSize(FontSize.bodyLarge).fontColor($r('app.color.text_primary')).backgroundColor($r('app.color.bg_sunken'))
                        .borderRadius(Radius.md).padding(Space.md).maxLength(3000)
                        .onChange((value: string) => { this.planDraft = value; })
                }.width('100%').alignItems(HorizontalAlign.Start)
            }.width('100%').layoutWeight(1).scrollBar(BarState.Auto).align(Alignment.TopStart)
            Button(this.sending ? '正在发送…' : '生成学习安排', { type: ButtonType.Normal })
                .id('agent_composer_send').width('100%').constraintSize({ minHeight: Size.touchTarget })
                .fontSize(FontSize.body).fontColor($r('app.color.text_inverse')).backgroundColor($r('app.color.brand_primary'))
                .borderRadius(Radius.md).enabled(!this.sending && this.planDraft.trim().length > 0)
                .onClick(() => { void this.send('plan'); })
        }.width('100%').height(Size.inputMaxHeight * 3).constraintSize({ maxHeight: '96%' })
            .padding({ left: Space.xl, right: Space.xl, top: Space.md, bottom: Space.xxl })
            .borderRadius({ topLeft: Radius.xl, topRight: Radius.xl })
            .alignItems(HorizontalAlign.Start).backgroundColor($r('app.color.bg_card'))
    }

    @Builder
    Day() {
        Column() {
            LearningAgentNavigationNotice({ opening: this.navigationOpening, errorText: this.navigationError,
                loadingText: this.navigationLabel })
            Stack() {
                List({ scroller: this.scroller }) {
                    ListItem() { this.TimelineHeader() }
                    ForEach(this.timeline, (entry: AgentTimelineEntry) => {
                        ListItem() { this.TimelineEntryView(entry) }
                    }, (entry: AgentTimelineEntry) => entry.id + ':' + (entry.status || '') + ':' + entry.ts +
                        ':' + (entry.deliveryPending ? 'pending' : '') + ':' + (entry.deliveryError || ''))
                }.id('agent_timeline').width('100%').height('100%').padding({ left: Space.xl, right: Space.xl })
                    .scrollBar(BarState.Auto).cachedCount(3).maintainVisibleContentPosition(true)
                    .contentEndOffset(Space.sm)
                    .onAreaChange((oldArea: Area, newArea: Area) => {
                        if (oldArea.height !== newArea.height) {
                            this.scrollToLatest(false);
                        }
                    })
                    .onReachEnd(() => { this.onTimelineEnd(); })
                    .onScrollStop(() => { this.onTimelineScrollStop(); })
                    .onScrollFrameBegin((offset: number, state: ScrollState): OnScrollFrameBeginHandlerResult => {
                        this.onTimelineScroll(offset);
                        return { offsetRemain: offset };
                    })
                if (!this.followLatest && this.timeline.length > 0) {
                    Stack() {
                        IconButton({
                            icon: $r('app.media.ic_chevron_down'),
                            bg: $r('app.color.bg_card'),
                            onTap: () => { this.scrollToLatest(true); }
                        })
                            .id('agent_latest')
                            .accessibilityText('回到最新消息')
                            .borderRadius(Size.touchTarget / 2)
                            .shadow(Shadow.raised)
                    }
                    .alignContent(Alignment.BottomEnd)
                    .width('100%')
                    .height('100%')
                    .padding({ right: Space.lg, bottom: Space.lg })
                    .hitTestBehavior(HitTestMode.Transparent)
                }
            }.width('100%').layoutWeight(1)
            LearningAgentInput({ draft: $draft, sending: this.sending,
                statusLabel: this.sendingMode === 'plan' ? '正在安排下一步…' : 'Agent 正在回应…',
                contextLabel: this.focus.chapter_name,
                onSend: () => { void this.send('ask'); }
            }).width('100%')
        }.width('100%').height('100%').backgroundColor($r('app.color.bg_page'))
    }

    @Builder
    Insights() {
        Column() {
            Row({ space: Space.sm }) {
                IconButton({ icon: $r('app.media.ic_back'), tint: $r('app.color.icon_primary'), onTap: () => { this.goBack(); } })
                    .id('agent_insights_back').accessibilityText('返回 Agent 时间线')
                Text('学习情况').fontSize(FontSize.titleLarge).fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.text_primary')).layoutWeight(1)
            }.width('100%').padding({ left: Space.sm, right: Space.lg, top: Space.sm, bottom: Space.sm })
            if (this.insightLoading || this.insightTarget.book_id.length === 0) {
                LearningAgentNavigationNotice({ opening: this.navigationOpening, errorText: this.navigationError,
                    loadingText: this.navigationLabel })
            }
            if (this.insightLoading) {
                Column({ space: Space.md }) {
                    LoadingProgress().width(Size.avatar).height(Size.avatar).color($r('app.color.brand_primary'))
                    Text('正在汇总学习情况…').fontSize(FontSize.body).fontColor($r('app.color.text_secondary'))
                }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
            } else if (this.insightTarget.book_id.length > 0) {
                LearningAgentReport({ target: this.insightTarget, embedded: true, visible: this.visible && this.top().level === AgentLevel.INSIGHTS,
                    navigationOpening: this.navigationOpening, navigationError: this.navigationError, navigationLabel: this.navigationLabel,
                    onBack: () => { this.goBack(); }, onRead: (target: LearnTarget) => { void this.openReader(target); },
                    onReview: (target: LearnTarget) => { this.openReview(target); }
                }).width('100%').layoutWeight(1)
            } else {
                Column({ space: Space.lg }) {
                    Image($r('app.media.ic_chart')).width(Size.avatar).height(Size.avatar).fillColor($r('app.color.brand_primary'))
                    Text('先开启一门课程的学习').fontSize(FontSize.title).fontColor($r('app.color.text_primary'))
                    Text('阅读和练习会逐渐补充你的学习情况。')
                        .fontSize(FontSize.body).fontColor($r('app.color.text_secondary')).textAlign(TextAlign.Center)
                    this.ActionButton({ label: '去选课程', id: 'agent_insights_choose_course', onTap: () => { this.onOpenLearning(); }, primary: true })
                }.width('100%').layoutWeight(1).padding(Space.xxl).justifyContent(FlexAlign.Center)
            }
        }.width('100%').height('100%').backgroundColor($r('app.color.bg_page'))
    }

    @Builder
    Frame(frame: AgentFrame, index: number) {
        if (frame.level === AgentLevel.DAY) {
            this.Day()
        } else if (frame.level === AgentLevel.INSIGHTS) {
            this.Insights()
        } else if (frame.level === AgentLevel.READER) {
            LearningReader({
                app: this.app, lectureId: frame.target.lecture_id, book: frame.book, chapters: frame.chapters,
                startChapterIndex: frame.target.chapter_index, initialParagraph: -1,
                flowId: frame.flowId, flowChapterIndex: frame.target.chapter_index,
                visible: this.active(frame), navDepth: $navDepth, navLevel: index,
                readerOverlayOpen: $readerOverlayOpen, readerBackToken: $readerBackToken,
                onBack: () => { this.goBack(); }, onOpenImage: (url: string) => { this.onOpenImage(url); }
            }).width('100%').height('100%')
        } else if (frame.level === AgentLevel.REVIEW) {
            LearningAgentReview({ initialTarget: frame.target, flowId: frame.flowId, visible: this.active(frame),
                navigationOpening: this.navigationOpening, navigationError: this.navigationError, navigationLabel: this.navigationLabel,
                onBack: () => { this.goBack(); },
                onRead: (target: LearnTarget, flowId: string) => { void this.openReader(target, flowId); },
                onBusyChange: (busy: boolean) => { this.onReviewBusyChange(frame.id, busy); },
                onSubmitted: () => { this.onTaskSubmitted(frame.flowId); }
            }).width('100%').height('100%')
        } else if (frame.level === AgentLevel.REPORT) {
            LearningAgentReport({ target: frame.target, visible: this.active(frame), onBack: () => { this.goBack(); },
                navigationOpening: this.navigationOpening, navigationError: this.navigationError, navigationLabel: this.navigationLabel,
                onRead: (target: LearnTarget) => { void this.openReader(target); },
                onReview: (target: LearnTarget) => { this.openReview(target); }
            }).width('100%').height('100%')
        } else if (frame.level === AgentLevel.INSPECT) {
            Column() {
                Blank().height('12%').onClick(() => { this.goBack(); })
                LearningAgentInspect({ entry: frame.entry,
                    onClose: () => { this.goBack(); }
                }).width('100%').layoutWeight(1).borderRadius({ topLeft: Radius.xl, topRight: Radius.xl }).clip(true)
            }.width('100%').height('100%').backgroundColor($r('app.color.mask'))
        } else if (frame.level === AgentLevel.MEMORY) {
            LearningMemorySettings({ visible: this.active(frame), onBack: () => { this.goBack(); },
                onChanged: () => { void this.refresh(); }
            }).width('100%').height('100%')
        }
    }

    build() {
        Stack() {
            ForEach(this.frames, (frame: AgentFrame, index: number) => {
                Stack() { this.Frame(frame, index) }
                    .width('100%').height('100%')
                    .visibility(this.top().id === frame.id || this.top().level === AgentLevel.INSPECT && index === this.frames.length - 2 ? Visibility.Visible : Visibility.Hidden)
                    .hitTestBehavior(this.top().id === frame.id ? HitTestMode.Default : HitTestMode.None)
            }, (frame: AgentFrame) => String(frame.id))
            if (this.composerOpen) {
                Column() {
                    Blank().layoutWeight(1).width('100%').onClick(() => { this.closeCompose(); })
                    this.Composer()
                }.width('100%').height('100%').backgroundColor($r('app.color.mask'))
                    .id('agent_composer_overlay')
            }
        }.width('100%').height('100%').backgroundColor($r('app.color.bg_page'))
    }
}
