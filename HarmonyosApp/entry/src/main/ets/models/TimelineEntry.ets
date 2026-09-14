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

export interface PlanCard {
  type: 'plan';
  chapter: string;
  minutes: number;
  why: string;
}

export interface QuizCard {
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
