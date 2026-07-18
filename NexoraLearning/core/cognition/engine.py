"""Deterministic cognitive-state calculation from immutable evidence."""

from __future__ import annotations

from collections import defaultdict
import math
import time
from typing import Any, Dict, Iterable, List, Optional

from .errors import CognitionValidationError
from .models import ASSESSED_EVIDENCE_TYPES, CognitiveEvidence, CognitiveState, ConceptNode


class CognitiveStateEngine:
    """Compute explainable mastery, retention, calibration, and transfer state."""

    version = "cognition-state-v1"
    _weights = {
        "objective_question": 1.0,
        "constructed_response": 1.4,
        "lab_prediction": 1.2,
        "lab_explanation": 1.6,
        "transfer_task": 2.0,
        "review": 1.3,
    }
    _review_threshold = 0.65

    def compute(
        self,
        concept: ConceptNode,
        evidence_rows: Iterable[CognitiveEvidence],
        *,
        now: Optional[int] = None,
    ) -> CognitiveState:
        calculated_at = int(now if now is not None else time.time())
        rows = sorted(list(evidence_rows), key=lambda row: (row.occurred_at, row.evidence_id))

        for row in rows:
            if row.concept_id != concept.concept_id:
                raise CognitionValidationError(
                    "Evidence concept_id does not match the requested concept.",
                    details={
                        "expected_concept_id": concept.concept_id,
                        "evidence_id": row.evidence_id,
                        "actual_concept_id": row.concept_id,
                    },
                )

        assessed = [row for row in rows if row.evidence_type in ASSESSED_EVIDENCE_TYPES]

        if not assessed:
            return CognitiveState(
                concept=concept,
                status="unverified" if rows else "unknown",
                mastery=None,
                retention=None,
                uncertainty=1.0,
                calibration_gap=None,
                transfer=None,
                evidence_count=len(rows),
                assessed_count=0,
                last_evidence_at=rows[-1].occurred_at if rows else None,
                next_review_at=None,
                misconceptions=[],
                evidence_summary=self._summarize(rows),
            )

        alpha = 1.0
        beta = 1.0
        total_weight = 0.0

        for row in assessed:
            weight = self._weights[row.evidence_type]
            score = float(row.score)
            alpha += weight * score
            beta += weight * (1.0 - score)
            total_weight += weight

        mastery = alpha / (alpha + beta)
        uncertainty = 2.0 / (2.0 + total_weight)
        last_assessed_at = assessed[-1].occurred_at
        successful_reviews = sum(
            1
            for row in assessed
            if row.evidence_type == "review" and float(row.score) >= self._review_threshold
        )
        half_life_days = min(56.0, 7.0 * (1.0 + successful_reviews))
        elapsed_days = max(0.0, (calculated_at - last_assessed_at) / 86400.0)
        retention = mastery * math.pow(0.5, elapsed_days / half_life_days)
        next_review_at = self._next_review_at(
            mastery,
            last_assessed_at,
            half_life_days,
        )
        calibration_gap = self._calibration_gap(assessed)
        transfer = self._transfer_score(assessed)
        misconceptions = self._active_misconceptions(assessed)
        status = self._status(mastery, retention, uncertainty, misconceptions)

        return CognitiveState(
            concept=concept,
            status=status,
            mastery=round(mastery, 4),
            retention=round(retention, 4),
            uncertainty=round(uncertainty, 4),
            calibration_gap=round(calibration_gap, 4) if calibration_gap is not None else None,
            transfer=round(transfer, 4) if transfer is not None else None,
            evidence_count=len(rows),
            assessed_count=len(assessed),
            last_evidence_at=rows[-1].occurred_at,
            next_review_at=next_review_at,
            misconceptions=misconceptions,
            evidence_summary=self._summarize(rows),
        )

    def _next_review_at(
        self,
        mastery: float,
        last_assessed_at: int,
        half_life_days: float,
    ) -> int:
        if mastery <= self._review_threshold:
            return last_assessed_at

        interval_days = half_life_days * math.log2(mastery / self._review_threshold)
        return last_assessed_at + max(0, int(interval_days * 86400))

    def _calibration_gap(self, rows: Iterable[CognitiveEvidence]) -> Optional[float]:
        comparable = [row for row in rows if row.confidence is not None]

        if not comparable:
            return None

        return sum(float(row.confidence) - float(row.score) for row in comparable) / len(comparable)

    def _transfer_score(self, rows: Iterable[CognitiveEvidence]) -> Optional[float]:
        transfer_rows = [row for row in rows if row.evidence_type == "transfer_task"]

        if not transfer_rows:
            return None

        return sum(float(row.score) for row in transfer_rows) / len(transfer_rows)

    def _active_misconceptions(self, rows: Iterable[CognitiveEvidence]) -> List[Dict[str, Any]]:
        active: Dict[str, Dict[str, Any]] = {}

        for row in rows:
            metadata = row.metadata or {}

            for misconception_id in metadata.get("resolved_misconception_ids", []):
                active.pop(str(misconception_id), None)

            if float(row.score) >= 0.7:
                continue

            for misconception_id in metadata.get("misconception_ids", []):
                key = str(misconception_id)
                existing = active.get(key)
                active[key] = {
                    "misconception_id": key,
                    "evidence_count": int(existing.get("evidence_count") or 0) + 1 if existing else 1,
                    "last_seen_at": row.occurred_at,
                    "last_evidence_id": row.evidence_id,
                }

        return sorted(active.values(), key=lambda row: (-int(row["last_seen_at"]), row["misconception_id"]))

    def _status(
        self,
        mastery: float,
        retention: float,
        uncertainty: float,
        misconceptions: List[Dict[str, Any]],
    ) -> str:
        if misconceptions or retention < 0.4:
            return "at_risk"

        if mastery >= 0.75 and retention >= 0.65 and uncertainty <= 0.35:
            return "stable"

        return "developing"

    def _summarize(self, rows: Iterable[CognitiveEvidence]) -> Dict[str, Dict[str, Any]]:
        buckets: Dict[str, List[CognitiveEvidence]] = defaultdict(list)

        for row in rows:
            buckets[row.evidence_type].append(row)

        summary: Dict[str, Dict[str, Any]] = {}

        for evidence_type, bucket in sorted(buckets.items()):
            scored = [row for row in bucket if row.score is not None]
            summary[evidence_type] = {
                "count": len(bucket),
                "average_score": (
                    round(sum(float(row.score) for row in scored) / len(scored), 4)
                    if scored
                    else None
                ),
                "last_occurred_at": max(row.occurred_at for row in bucket),
            }

        return summary
