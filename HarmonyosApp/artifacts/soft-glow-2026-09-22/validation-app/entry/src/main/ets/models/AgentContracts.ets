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
