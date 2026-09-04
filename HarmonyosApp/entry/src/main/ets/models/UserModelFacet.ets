/**
 * §3.3 面二「它眼里的你」数据契约：UserModelFacet。
 * 后端来源：/frontend/cognition/overview + /frontend/cognition/evidence（#11 接入）。
 */
import { EvidenceRef } from './TimelineEntry';

export interface UserModelFacet {
  id: string;
  claim: string;
  confidence: number;
  conceptId?: string;
  evidence: EvidenceRef[];
  userVerdict?: string;   // 'agree' | 'disagree'，反驳后即时回喂
}

export interface MasteryCell {
  concept: string;
  mastery: number;
}

export interface MirrorData {
  facets: UserModelFacet[];
  mastery: MasteryCell[];
}
