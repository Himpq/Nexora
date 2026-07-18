"""Bridge persisted question submissions into cognitive evidence."""

from __future__ import annotations

import hashlib
import time
from typing import Any, Dict, Mapping

from core.runlog import log_event

from .errors import CognitionError
from .service import CognitionService


class QuestionCognitionBridge:
    """Convert judged question completions into idempotent concept evidence."""

    def __init__(self, cfg: Mapping[str, Any]) -> None:
        self._cfg = dict(cfg or {})
        self._service = CognitionService(self._cfg)

    def record_submission(
        self,
        user_id: str,
        question_row: Mapping[str, Any],
        completion: Mapping[str, Any],
    ) -> Dict[str, Any]:
        """Record one judged completion or return an explicit non-recorded status."""
        if not isinstance(completion.get("is_correct"), bool):
            return self._skip(
                user_id,
                question_row,
                completion,
                "unassessed_completion",
                "本次作答没有可靠的自动判分结果，未写入认知证据。",
            )

        question = question_row.get("question") if isinstance(question_row.get("question"), Mapping) else {}
        concept_id = str(
            question.get("related_concept_id")
            or question.get("concept_id")
            or question_row.get("concept_id")
            or ""
        ).strip()
        if not concept_id:
            return self._skip(
                user_id,
                question_row,
                completion,
                "question_concept_unbound",
                "题目没有绑定知识概念，未写入认知证据。",
            )

        lecture_id = str(question_row.get("lecture_id") or "").strip()
        book_id = str(question_row.get("book_id") or "").strip()
        completion_id = str(completion.get("completion_id") or "").strip()
        question_id = str(question_row.get("question_id") or "").strip()
        if not completion_id:
            return self._skip(
                user_id,
                question_row,
                completion,
                "completion_id_missing",
                "作答记录缺少 completion_id，未写入认知证据。",
            )

        evidence_id = self._evidence_id(user_id, completion_id)
        question_type = str(
            question.get("question_type")
            or question.get("type")
            or question_row.get("question_type")
            or ""
        ).strip().lower()
        options = question.get("question_options") or question.get("options") or question_row.get("question_options") or []
        evidence_type = "objective_question" if question_type in {
            "choice",
            "single_choice",
            "multiple_choice",
            "选择题",
            "单选题",
            "多选题",
        } or isinstance(options, list) and len(options) >= 2 else "constructed_response"

        payload = {
            "evidence_id": evidence_id,
            "lecture_id": lecture_id,
            "book_id": book_id,
            "concept_id": concept_id,
            "evidence_type": evidence_type,
            "source_type": "question",
            "source_id": completion_id,
            "occurred_at": int(completion.get("timestamp") or time.time()),
            "score": 1.0 if completion.get("is_correct") else 0.0,
            "confidence": 1.0,
            "metadata": {
                "question_id": question_id,
                "question_type": question_type,
                "difficulty": str(
                    question.get("question_difficulty")
                    or question.get("difficulty")
                    or question_row.get("question_difficulty")
                    or ""
                ).strip(),
                "chapter_name": str(question_row.get("chapter_name") or "").strip(),
                "is_correct": bool(completion.get("is_correct")),
            },
        }

        try:
            result = self._service.record_evidence(str(user_id or "").strip(), payload)
        except CognitionError as exc:
            log_event(
                "question_cognition_evidence_failed",
                "题库作答已保存，但认知证据写入失败",
                payload={
                    "user_id": str(user_id or "").strip(),
                    "question_id": question_id,
                    "completion_id": completion_id,
                    "concept_id": concept_id,
                    "error": str(exc),
                },
            )
            return {
                "recorded": False,
                "reason": "cognition_write_failed",
                "message": str(exc),
                "evidence_id": evidence_id,
            }

        return {
            "recorded": True,
            "created": bool(result.get("created")),
            "evidence": result.get("evidence"),
        }

    def _skip(
        self,
        user_id: str,
        question_row: Mapping[str, Any],
        completion: Mapping[str, Any],
        reason: str,
        message: str,
    ) -> Dict[str, Any]:
        payload = {
            "user_id": str(user_id or "").strip(),
            "question_id": str(question_row.get("question_id") or "").strip(),
            "completion_id": str(completion.get("completion_id") or "").strip(),
            "reason": reason,
        }
        log_event("question_cognition_evidence_skipped", message, payload=payload)
        return {"recorded": False, "reason": reason, "message": message}

    def _evidence_id(self, user_id: str, completion_id: str) -> str:
        raw = f"{str(user_id or '').strip()}|{str(completion_id or '').strip()}"
        return "ev_qc_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
