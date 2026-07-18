"""Append-only storage for cognitive evidence."""

from __future__ import annotations

import json
from pathlib import Path
import threading
from collections.abc import Mapping
from typing import Any, List, Optional, Tuple

from .errors import CognitionConflictError, CognitionStorageError, CognitionValidationError
from .models import CognitiveEvidence


class CognitiveEvidenceStore:
    """Persist immutable evidence and enforce idempotent evidence IDs."""

    _lock = threading.RLock()

    def __init__(self, cfg: Mapping[str, Any]) -> None:
        self._data_dir = Path(str(cfg.get("data_dir") or "data"))

    def append(self, evidence: CognitiveEvidence) -> Tuple[CognitiveEvidence, bool]:
        path = self._evidence_path(evidence.user_id)

        with self._lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            existing_rows = self._read_path(path)
            serialized = evidence.to_dict()

            for existing in existing_rows:
                if existing.evidence_id != evidence.evidence_id:
                    continue

                if existing.to_dict() == serialized:
                    return existing, False

                raise CognitionConflictError(
                    "evidence_id already exists with different content.",
                    details={"evidence_id": evidence.evidence_id},
                )

            with path.open("a", encoding="utf-8", newline="\n") as handle:
                handle.write(json.dumps(serialized, ensure_ascii=False, separators=(",", ":")) + "\n")

        return evidence, True

    def list(
        self,
        user_id: str,
        *,
        lecture_id: str = "",
        book_id: str = "",
        concept_id: str = "",
        limit: Optional[int] = None,
    ) -> List[CognitiveEvidence]:
        path = self._evidence_path(user_id)

        with self._lock:
            rows = self._read_path(path)

        filters = {
            "lecture_id": str(lecture_id or "").strip(),
            "book_id": str(book_id or "").strip(),
            "concept_id": str(concept_id or "").strip(),
        }
        filtered = [
            row
            for row in rows
            if all(not expected or str(getattr(row, key)) == expected for key, expected in filters.items())
        ]
        filtered.sort(key=lambda row: (row.occurred_at, row.evidence_id))

        if limit is None:
            return filtered

        if limit <= 0:
            raise CognitionValidationError("limit must be greater than 0.")

        return filtered[-limit:]

    def _evidence_path(self, user_id: str) -> Path:
        normalized_user_id = str(user_id or "").strip()

        if not normalized_user_id:
            raise CognitionValidationError("user_id is required.")

        if normalized_user_id in {".", ".."} or "/" in normalized_user_id or "\\" in normalized_user_id:
            raise CognitionValidationError("user_id contains invalid path characters.")

        return self._data_dir / "users" / normalized_user_id / "cognition" / "evidence.jsonl"

    def _read_path(self, path: Path) -> List[CognitiveEvidence]:
        if not path.exists():
            return []

        rows: List[CognitiveEvidence] = []

        try:
            with path.open("r", encoding="utf-8-sig") as handle:
                for line_number, line in enumerate(handle, start=1):
                    text = line.strip()

                    if not text:
                        continue

                    try:
                        payload = json.loads(text)
                    except json.JSONDecodeError as exc:
                        raise CognitionStorageError(
                            "Cognitive evidence file contains invalid JSON.",
                            details={"path": str(path), "line": line_number},
                        ) from exc

                    if not isinstance(payload, Mapping):
                        raise CognitionStorageError(
                            "Cognitive evidence row must be an object.",
                            details={"path": str(path), "line": line_number},
                        )

                    try:
                        rows.append(CognitiveEvidence.from_dict(payload))
                    except CognitionValidationError as exc:
                        raise CognitionStorageError(
                            "Cognitive evidence row failed schema validation.",
                            details={"path": str(path), "line": line_number, "reason": str(exc)},
                        ) from exc
        except CognitionStorageError:
            raise
        except OSError as exc:
            raise CognitionStorageError(
                "Unable to read cognitive evidence file.",
                details={"path": str(path), "reason": str(exc)},
            ) from exc

        return rows
