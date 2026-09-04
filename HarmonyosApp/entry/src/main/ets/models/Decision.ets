/**
 * §3.4 ProactiveDecision + 决策器 wire 类型（/decision、/decision/respond）。
 */
import { EvidenceRef } from './TimelineEntry';
import { LearnTarget } from './AgentContracts';

export interface DecisionTarget {
  lecture_id: string;
  book_id: string;
  chapter_index: number;
  chapter_name: string;
}

export interface DecisionSignals {
  overdue_days?: number;
  est_minutes?: number;
  timing?: number;
  do_not_disturb?: boolean;
  unfinished_chapter?: Record<string, string>;
  mail_arrived?: Record<string, string>;
  prereq_gap?: Record<string, string>;
  confusion_spike?: Record<string, string>;
}

export interface DecisionRequest {
  trigger?: string;
  signals?: DecisionSignals;
  target?: LearnTarget;
  minutes?: number;
  now?: number;
}

/** 后端 /decision 返回的决策记录（wire 格式）。 */
export interface DecisionRecord {
  decision_id: string;
  kind: string;
  fire: boolean;
  score: number;
  trigger: string;
  suppressed_by: string | null;
  target: DecisionTarget;
  minutes: number;
  text: string;
  reason: string;
  evidence: EvidenceRef[];
  card: object | null;
  status: string;
  retry: boolean;
  timestamp: number;
  evaluated_at: number;
}

export interface DecisionData {
  decision: DecisionRecord;
}

export interface DecisionRespondData {
  updated: boolean;
  decision_id: string;
  status: string;
  backoff: boolean;
  retry_at: number | null;
}

/** §3.4 客户端模型（camelCase）。 */
export interface ProactiveDecision {
  fire: boolean;
  score: number;
  trigger: string;
  target: DecisionTarget | null;
  minutes: number;
  reason: string;
  evidence: EvidenceRef[];
  suppressedBy: string | null;
}

export function toProactiveDecision(record: DecisionRecord): ProactiveDecision {
  return {
    fire: record.fire,
    score: record.score,
    trigger: record.trigger,
    target: record.target,
    minutes: record.minutes,
    reason: record.reason,
    evidence: record.evidence,
    suppressedBy: record.suppressed_by,
  };
}
