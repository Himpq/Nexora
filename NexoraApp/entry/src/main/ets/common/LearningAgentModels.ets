// Learning Agent wire contracts, migrated from HarmonyosApp.
// Requests go through the authenticated LearningHttp service.
/**
 * Agent Facade 客户端数据类型（/api/agent/v1）。
 * 字段与后端统一信封一一对应（后端 snake_case 原样透传）。
 */

export interface AgentError {
    code: string;
    message: string;
}

export interface LearnTarget {
    lecture_id: string;
    lecture_title: string;
    book_id: string;
    book_title: string;
    chapter_index: number;
    chapter_name: string;
    chapter_range: string;
}

export interface AgentAction {
    type: string;
    task_id: string;
    session_id: string;
    target: LearnTarget;
    flow_id?: string;
}

export interface AgentEnvelope {
    success: boolean;
    request_id: string;
    action: string;
    data: object;
    next_actions: AgentAction[];
    error: AgentError | null;
}

export interface PlanInfo {
    status: string;
    intent: string;
    available_minutes: number;
    estimated_minutes: number;
    reason: string;
    target: LearnTarget;
}

export interface PlanData {
    plan: PlanInfo;
}

export interface ContextUser {
    id: string;
    username: string;
    display_name: string;
    role: string;
}

export interface ContextBook {
    id: string;
    title: string;
    text_status: string;
    refinement_status: string;
    description: string;
    text_chars?: number;
    reading_progress_percent?: number;
    completion_percent?: number;
    read_chapters?: number;
    completed_chapters?: number;
    total_chapters?: number;
    reading_seconds?: number;
    read_chars?: number;
}

export interface ContextLecture {
    id: string;
    title: string;
    status: string;
    progress_percent: number;
    reading_progress_percent?: number;
    completion_percent?: number;
    read_chapters?: number;
    completed_chapters?: number;
    total_chapters?: number;
    reading_seconds?: number;
    read_chars?: number;
    current_chapter: string;
    current_book_id?: string;
    current_chapter_index?: number | null;
    next_chapter: string;
    description: string;
    category: string;
    books: ContextBook[];
}

export interface ActiveSession {
    session_id: string;
    lecture_id: string;
    book_id: string;
    chapter_index: number;
    chapter_name: string;
    chapter_range: string;
    status: string;
    source: string;
    timestamp: number;
}

export interface RecentRecord {
    book_id: string;
    lecture_id: string;
    chapter_index: number;
    chapter_name: string;
    session_name: string;
    type: string;
    timestamp: number;
}

export interface ContextData {
    user: ContextUser;
    lectures: ContextLecture[];
    active_session: ActiveSession;
    selected_lecture_ids: string[];
    recent_learning_records: RecentRecord[];
}

export interface OpenSessionData {
    session_id: string;
    created_at: number;
    entry_type: string;
    entry_url: string;
    resume: boolean;
    target: LearnTarget;
}

export interface TaskInfo {
    task_id: string;
    type: string;
    status: string;
    user_id: string;
    lecture_id: string;
    book_id: string;
    chapter_index: number;
    created_at: number;
    updated_at: number;
    error: AgentError | null;
    result: ReviewResult;
}

export interface ReviewQuestion {
    type: string;
    title: string;
    content: string;
    difficulty: string;
    hint: string;
    answer: string;
    options: string[];
    source: string;
    source_id: string;
}

export interface ReviewResult {
    lecture_id: string;
    book_id: string;
    chapter_index: number;
    chapter_name: string;
    quiz_id: string;
    /** 一次练习的身份：题组内容可缓存复用，每个生成任务都是新的一轮，结算与累计按它隔离。 */
    attempt_id?: string;
    questions: ReviewQuestion[];
}

export interface ReviewPlanData {
    task: TaskInfo;
}

export interface ReviewAnswerDraft {
    question_id: string;
    answer: string;
    /** 未作答直接看答案：后端按错误计，但用低权重的 revealed_answer 证据。 */
    revealed_without_answer?: boolean;
}

export interface ReviewSubmitItem {
    question_id: string;
    is_correct: boolean;
    duplicate?: boolean;
    evidence?: boolean;
    concept_id?: string;
}

export interface ReviewSubmitData {
    quiz_id: string;
    attempt_id?: string;
    /** 本次结算的题：对/总。逐题结算时通常是 1/1 或 0/1。 */
    score: string;
    correct: number;
    total: number;
    items: ReviewSubmitItem[];
    /** 整卷累计（后端按 quiz_id + attempt_id 汇总这一轮已结算的题）。 */
    quiz_correct?: number;
    quiz_total?: number;
    quiz_settled?: number;
    settled_ids?: string[];
    completed?: boolean;
    evidence_written?: number;
    /** 成绩实际归到的来源（题组自身），不是请求里的当前选择。 */
    lecture_id?: string;
    book_id?: string;
    chapter_index?: number;
    chapter_name?: string;
}

export interface TaskData {
    task: TaskInfo;
}

export interface AskAnswer {
    next_actions?: AgentAction[];
    answer: string;
    source: string;
    book_id: string;
    lecture_id: string;
    context_chars: number;
    memory_updated?: boolean;
    memory_count?: number;
}

export interface TodayBrief {
    date: string;
    study_minutes: number;
    completed_sessions: number;
    completed_chapters: number;
    submitted_questions: number;
    correct_questions: number;
    accuracy: number | null;
}

export interface TodayData {
    active_flow?: FlowStateData | null;
    status: string;
    today: TodayBrief;
    focus: LearnTarget | null;
    active_session: ActiveSession;
    lectures: TodayLecture[];
}

export interface TodayLecture {
    id: string;
    title: string;
    progress_percent: number;
    current_chapter: string;
    next_chapter: string;
}

export interface EventsData {
    entries: object[];
    count: number;
    generated_at: number;
}

// Personal learning information managed from Settings; activity statistics are excluded.
export interface LearningMemoryItem {
    id: string;
    kind: string;
    text: string;
    updated_at: number;
    lecture_id: string;
    book_id: string;
}

export interface LearningMemoriesData {
    items: LearningMemoryItem[];
    generated_at: number;
}

export interface LearningMemoryUpdateData {
    updated: boolean;
    // Editing replaces the original memory, so follow-up actions must use this item's ID.
    item: LearningMemoryItem;
}

export interface LearningMemoryForgetData {
    updated: boolean;
}

// ---- 面二（§6.3）wire 类型 ----

export interface MirrorEvidenceRef {
    label: string;
    source: string;
    conceptId: string;
    sourceId?: string;
    occurredAt?: number;
}

export interface MirrorFacet {
    id: string;
    claim: string;
    confidence: number;
    concept: string;
    conceptId: string;
    lectureId: string;
    bookId: string;
    evidence: MirrorEvidenceRef[];
    userVerdict: string | null;
    kind?: string;
    /** 记忆 facet：原话的日期（「9月19日」）。 */
    saidOn?: string;
    /** 夜间反思结论（排最前）。 */
    insight?: boolean;
}

export interface MirrorMasteryCell {
    concept: string;
    mastery: number | null;
    status: string;
    lectureTitle: string;
    chapterName: string;
}

export interface MirrorOverviewData {
    mastery: MirrorMasteryCell[];
    facets: MirrorFacet[];
    generated_at: number;
    activity?: MirrorActivity;
    courses?: MirrorCourse[];
    /** ready：图谱齐全；building：正在为这门课建图；missing：还没有图谱（掌握度暂时出不来）。 */
    graph_status?: string;
}

export interface MirrorActivity {
    reading_seconds: number;
    read_chapters: number;
    conversation_count: number;
    memory_count: number;
    assessed_concepts: number;
    observed_concepts: number;
    last_activity_at: number;
}

export interface MirrorCourse {
    lecture_id: string;
    title: string;
    book_id?: string;
    reading_progress_percent?: number;
    completion_percent?: number;
    completed_chapters?: number;
    total_chapters?: number;
    reading_seconds?: number;
}

export interface VerdictReply {
    reply: string;
    revised_claim: string;
    changed: boolean;
}

export interface VerdictData {
    updated: boolean;
    facet_id: string;
    verdict: string;
    evidence_written: boolean;
    /** 带 note 反驳时模型的回应（模型不可用时为 null）。 */
    reply?: VerdictReply | null;
}

// ---- 前置缺口（B2，§4.2）wire 类型 ----

export interface PrereqGap {
    concept: string;
    conceptId: string;
    fromLectureId: string;
    fromBookId: string;
    fromChapterIndex: number;
    fromChapterName: string;
    mastery: number;
    minutes: number;
}

export interface PrereqCheckData {
    ran: boolean;
    reason?: string;
    target: LearnTarget;
    matched: object[];
    gaps: PrereqGap[];
    cards_written: number;
    generated_at: number;
}

// ---- N5 闭环流程（§4.5）wire 类型 ----

export interface FlowQuestion {
    title: string;
    type: string;
    options: string[];
    content: string;
    answer: string;
    source: string;
    source_id: string;
}

export interface FlowQuizData {
    retryable?: boolean;
    status: string;
    quiz_id?: string;
    questions: FlowQuestion[];
    error?: string;
}

export interface FlowWrapupData {
    type: string;
    minutes: number;
    chapter: string;
    quizScore: string;
    masteryShift: object[];
    uncertain: object[];
    flowId?: string;
}

export interface FlowStateData {
    flow_id: string;
    status: string;
    step: string;
    session_id: string;
    target: LearnTarget;
    started_at: number;
    last_step_at: number;
    steps: object[];
    task_id?: string;
    quiz: FlowQuizData;
    wrapup?: FlowWrapupData;
}

export interface FlowSubmitData {
    state: FlowStateData;
    wrapup: object;
}

export interface FlowAnswer {
    question_id: string;
    answer: string;
}

/**
 * §3.1 TimelineEntry / §3.2 MessageCard 数据契约。
 * 与后端 /api/agent/v1/events（GET）返回字段一一对应（后端 snake_case 原样透传）。
 */

export type EntryKind = 'user_msg' | 'agent_msg' | 'agent_act' | 'agent_hold' | 'tool_step' | 'system';

export interface EvidenceRef {
    label: string;
    source: string;
    conceptId?: string;
    detail?: string;
}

export interface ActionChip {
    label: string;
    action: string;
    payload?: Record<string, string>;
}

export interface TimelineEntry {
    client_message_id?: string;
    id: string;
    kind: EntryKind;
    ts: number;                    // 毫秒时间戳
    text: string;
    reason?: string;
    evidence?: EvidenceRef[];
    card?: MessageCard | null;
    actions?: ActionChip[];
    unattended: boolean;
    status?: string;               // pending | accept | defer | dismiss
    trigger?: string;
    /**
     * 决策器的抑制原因（§3.4 suppressedBy）：judgment | silent_hours | daily_cap | cooldown
     * | backoff | defer | do_not_disturb | low_score。agent_hold 条目据此渲染「它为什么没打扰你」。
     */
    suppressed_by?: string;
    /** 决策综合分（0–1.2），与门槛 0.55 对照展示。 */
    score?: number;
    /** 出现的形态：hold | card | notify | liveview | xiaoyi_suggest；对话条目为来源 app | xiaoyi | a2a | photo | rebuttal。 */
    channel?: string;
    /** 模型裁决摘要（Judgment Loop）。 */
    judgment?: JudgmentSummary | null;
    /** 它当时看到了什么：长按展开。 */
    context?: ContextSnapshot | null;
}

export interface JudgmentSummary {
    source: string;                // model | rules
    act: string;
    confidence: number;
    hold_until: number | null;
    wanted_to_say: string;
}

export interface ContextSnapshot {
    time: string;
    weekday: string;
    calendar: string[];
    scene: string;
    dnd: boolean;
    location: string;
    at_risk: string[];
    confusion: string[];
    recent_questions: string[];
    recent_responses: string[];
}

// ---- §3.2 MessageCard 变体 ----

export interface ProactiveCard {
    type: 'proactive';
    title: string;
    reason: string;
    minutes: number;
    accept: string;
    defer: string;
    dismiss: string;
    channel?: string;
}

export interface PrepBriefing {
    conceptId: string;
    concept: string;
    hitCount: number;
    minutes: number;
}

export interface PrepStep {
    type: string;
    title: string;
    preview: string;
}

export interface PrepCard {
    type: 'prep';
    chapter: string;
    highlights: string[];
    quizCount: number;
    durationMs: number;
    briefing?: PrepBriefing;
    steps?: PrepStep[];
}

export interface PrereqCard {
    type: 'prereq';
    concept: string;
    fromCourse: string;
    minutes: number;
    masteryDelta: number;
    fromLectureId?: string;
    fromBookId?: string;
    fromChapterIndex?: number;
}

export interface ConfusionBreakdown {
    kind: string;
    count: number;
}

export interface ConfusionCard {
    type: 'confusion';
    concept: string;
    hitCount: number;
    breakdown: ConfusionBreakdown[];
}

export interface MasteryShift {
    concept: string;
    from: number;
    to: number;
}

export interface UncertainItem {
    questionId: string;
    why: string;
}

export interface WrapupCard {
    type: 'wrapup';
    minutes: number;
    chapter: string;
    quizScore: string;
    masteryShift: MasteryShift[];
    uncertain: UncertainItem[];
    flowId?: string;
}

export interface PlanCardTarget extends LearnTarget {}

export interface PlanCard {
    type: 'plan';
    chapter: string;
    minutes: number;
    why: string;
    /** 这张卡自己的目标：「开始学习」打开的必须是卡上写的那一章。旧记录可能没有。 */
    target?: PlanCardTarget | null;
}

export interface QuizCard {
    taskId?: string;
    type: 'quiz';
    questionId: string;
    stem: string;
    options?: string[];
    flowId?: string;
}

export interface CitationCard {
    type: 'citation';
    book: string;
    chapter: string;
    excerpt: string;
    anchor: string;
}

export interface ChartCard {
    type: 'chart';
    kind: string;
    thumbUrl: string;
}

export interface ProgressCard {
    type: 'progress';
    taskId: string;
    percent: number;
    label: string;
}

export interface MailCard {
    type: 'mail';
    from: string;
    subject: string;
    summary: string;
    dueDate?: string;
}

export interface SearchFinding {
    title: string;
    url: string;
    snippet: string;
}

export interface SearchCard {
    type: 'search';
    query: string;
    findings: SearchFinding[];
}

export interface KbfileCard {
    type: 'kbfile';
    fileName: string;
    kbName: string;
    chunks: number;
}

export interface VideoCard {
    type: 'video';
    title: string;
    cover: string;
    source: string;
    url: string;
}

export type MessageCard =
    | ProactiveCard
    | PrepCard
    | PrereqCard
    | ConfusionCard
    | WrapupCard
    | PlanCard
    | QuizCard
    | CitationCard
    | ChartCard
    | ProgressCard
    | MailCard
    | SearchCard
    | KbfileCard
    | VideoCard;

export interface ReportSummary {
    progress_percent: number;
    reading_progress_percent?: number;
    reading_seconds?: number;
    read_chapters?: number;
    read_chars?: number;
    completion_percent?: number;
    completed_chapters: number;
    total_chapters: number;
    completed_sessions: number;
    total_sessions: number;
    study_hours: number;
    submitted_questions: number;
    reviewed_questions: number;
    correct_questions: number;
    accuracy: number | null;
    /** 分母口径：本章 / 本书 / 本课程。 */
    scope_label?: string;
    /** 课程级阅读覆盖（所有教材汇总），与本书口径同屏显示。 */
    course_reading_progress_percent?: number;
}

export interface ReportNote {
    title: string;
    detail: string;
}

export interface ReportPayload {
    success: boolean;
    lecture_title: string;
    summary: ReportSummary;
    weaknesses: ReportNote[];
    recommendations: ReportNote[];
    error?: string;
}

export interface GraphConcept {
    name: string;
    detail: string;
    concept_id?: string;
    mastery?: number | null;
    status?: string;
    assessed_count?: number;
}

export interface GraphChapter {
    name: string;
    summary: string;
    concepts: GraphConcept[];
    reading_percent?: number;
    completed?: boolean;
    chapter_index?: number;
}

export interface GraphRelation {
    from: string;
    to: string;
    type: string;
    label?: string;
}

export interface GraphBody {
    chapters: GraphChapter[];
    relations: GraphRelation[];
    reading_progress_percent?: number;
    book_reading_progress_percent?: number;
    course_reading_progress_percent?: number;
    concepts_available?: boolean;
}

export interface GraphPayload {
    success: boolean;
    graph: GraphBody | null;
    cached: boolean;
}

