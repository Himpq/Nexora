"""Validated data models for cognitive concepts, evidence, and state."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import math
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from .errors import CognitionValidationError


EVIDENCE_TYPES = {
    "exposure",
    "objective_question",
    "constructed_response",
    "lab_prediction",
    "lab_explanation",
    "transfer_task",
    "review",
}
SOURCE_TYPES = {
    "question",
    "lab",
    "reading",
    "review",
    "manual",
}
ASSESSED_EVIDENCE_TYPES = EVIDENCE_TYPES - {"exposure"}


def _required_text(payload: Mapping[str, Any], key: str, *, maximum: int = 240) -> str:
    value = str(payload.get(key) or "").strip()

    if not value:
        raise CognitionValidationError(f"{key} is required.")

    if len(value) > maximum:
        raise CognitionValidationError(f"{key} exceeds {maximum} characters.")

    return value


def _optional_unit_float(payload: Mapping[str, Any], key: str) -> Optional[float]:
    value = payload.get(key)

    if value is None:
        return None

    if isinstance(value, bool):
        raise CognitionValidationError(f"{key} must be a number between 0 and 1.")

    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise CognitionValidationError(f"{key} must be a number between 0 and 1.") from exc

    if not math.isfinite(parsed) or parsed < 0 or parsed > 1:
        raise CognitionValidationError(f"{key} must be a number between 0 and 1.")

    return parsed


def _string_list(metadata: Mapping[str, Any], key: str) -> List[str]:
    value = metadata.get(key)

    if value is None:
        return []

    if not isinstance(value, list):
        raise CognitionValidationError(f"metadata.{key} must be an array of strings.")

    rows: List[str] = []
    seen = set()

    for item in value:
        text = str(item or "").strip()

        if not text or text in seen:
            continue

        if len(text) > 160:
            raise CognitionValidationError(f"metadata.{key} item exceeds 160 characters.")

        seen.add(text)
        rows.append(text)

    return rows


@dataclass(frozen=True)
class ConceptNode:
    """Stable address for a knowledge graph concept."""

    concept_id: str
    lecture_id: str
    book_id: str
    chapter_index: int
    chapter_name: str
    path: Tuple[str, ...]
    name: str
    detail: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "concept_id": self.concept_id,
            "lecture_id": self.lecture_id,
            "book_id": self.book_id,
            "chapter_index": self.chapter_index,
            "chapter_name": self.chapter_name,
            "path": list(self.path),
            "name": self.name,
            "detail": self.detail,
        }


@dataclass(frozen=True)
class CognitiveEvidence:
    """One immutable observation tied to a single knowledge concept."""

    evidence_id: str
    user_id: str
    lecture_id: str
    book_id: str
    concept_id: str
    evidence_type: str
    source_type: str
    source_id: str
    occurred_at: int
    score: Optional[float] = None
    confidence: Optional[float] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_payload(cls, user_id: str, payload: Mapping[str, Any]) -> "CognitiveEvidence":
        if not isinstance(payload, Mapping):
            raise CognitionValidationError("request body must be an object.")

        normalized_user_id = str(user_id or "").strip()

        if not normalized_user_id:
            raise CognitionValidationError("user_id is required.")

        evidence_type = _required_text(payload, "evidence_type", maximum=80).lower()

        if evidence_type not in EVIDENCE_TYPES:
            raise CognitionValidationError(
                "evidence_type must be one of: " + ", ".join(sorted(EVIDENCE_TYPES)) + "."
            )

        source_type = _required_text(payload, "source_type", maximum=80).lower()

        if source_type not in SOURCE_TYPES:
            raise CognitionValidationError(
                "source_type must be one of: " + ", ".join(sorted(SOURCE_TYPES)) + "."
            )

        occurred_at_raw = payload.get("occurred_at")

        if isinstance(occurred_at_raw, bool):
            raise CognitionValidationError("occurred_at must be a positive Unix timestamp.")

        try:
            occurred_at = int(occurred_at_raw)
        except (TypeError, ValueError) as exc:
            raise CognitionValidationError("occurred_at must be a positive Unix timestamp.") from exc

        if occurred_at <= 0:
            raise CognitionValidationError("occurred_at must be a positive Unix timestamp.")

        score = _optional_unit_float(payload, "score")

        if evidence_type in ASSESSED_EVIDENCE_TYPES and score is None:
            raise CognitionValidationError(f"score is required for {evidence_type} evidence.")

        if evidence_type == "exposure" and score is not None:
            raise CognitionValidationError("exposure evidence must not contain score.")

        confidence = _optional_unit_float(payload, "confidence")
        metadata_raw = payload.get("metadata")

        if metadata_raw is None:
            metadata: Dict[str, Any] = {}
        elif isinstance(metadata_raw, Mapping):
            metadata = dict(metadata_raw)
        else:
            raise CognitionValidationError("metadata must be an object.")

        metadata["misconception_ids"] = _string_list(metadata, "misconception_ids")
        metadata["resolved_misconception_ids"] = _string_list(metadata, "resolved_misconception_ids")

        try:
            metadata_size = len(json.dumps(metadata, ensure_ascii=False, separators=(",", ":")))
        except (TypeError, ValueError) as exc:
            raise CognitionValidationError("metadata must contain JSON-serializable values.") from exc

        if metadata_size > 8000:
            raise CognitionValidationError("metadata exceeds 8000 serialized characters.")

        return cls(
            evidence_id=_required_text(payload, "evidence_id", maximum=160),
            user_id=normalized_user_id,
            lecture_id=_required_text(payload, "lecture_id", maximum=160),
            book_id=_required_text(payload, "book_id", maximum=160),
            concept_id=_required_text(payload, "concept_id", maximum=160),
            evidence_type=evidence_type,
            source_type=source_type,
            source_id=_required_text(payload, "source_id", maximum=240),
            occurred_at=occurred_at,
            score=score,
            confidence=confidence,
            metadata=metadata,
        )

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "CognitiveEvidence":
        user_id = str(payload.get("user_id") or "").strip()
        return cls.from_payload(user_id, payload)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schema_version": 1,
            "evidence_id": self.evidence_id,
            "user_id": self.user_id,
            "lecture_id": self.lecture_id,
            "book_id": self.book_id,
            "concept_id": self.concept_id,
            "evidence_type": self.evidence_type,
            "source_type": self.source_type,
            "source_id": self.source_id,
            "occurred_at": self.occurred_at,
            "score": self.score,
            "confidence": self.confidence,
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class CognitiveState:
    """Computed state derived entirely from immutable evidence."""

    concept: ConceptNode
    status: str
    mastery: Optional[float]
    retention: Optional[float]
    uncertainty: float
    calibration_gap: Optional[float]
    transfer: Optional[float]
    evidence_count: int
    assessed_count: int
    last_evidence_at: Optional[int]
    next_review_at: Optional[int]
    misconceptions: Sequence[Dict[str, Any]]
    evidence_summary: Mapping[str, Dict[str, Any]]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "concept": self.concept.to_dict(),
            "status": self.status,
            "mastery": self.mastery,
            "retention": self.retention,
            "uncertainty": self.uncertainty,
            "calibration_gap": self.calibration_gap,
            "transfer": self.transfer,
            "evidence_count": self.evidence_count,
            "assessed_count": self.assessed_count,
            "last_evidence_at": self.last_evidence_at,
            "next_review_at": self.next_review_at,
            "misconceptions": list(self.misconceptions),
            "evidence_summary": dict(self.evidence_summary),
        }
