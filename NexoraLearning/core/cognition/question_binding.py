"""Strict concept binding helpers for adaptive question evidence."""

from __future__ import annotations

import json
from typing import Any, Dict, Iterable, List, Mapping

from .errors import CognitionCatalogError
from .service import CognitionService


def load_chapter_concept_candidates(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    chapter_name: str,
) -> List[Dict[str, Any]]:
    """Load exact concept candidates for one chapter from the current graph."""
    normalized_lecture_id = str(lecture_id or "").strip()
    normalized_book_id = str(book_id or "").strip()
    normalized_chapter = str(chapter_name or "").strip()

    if not normalized_lecture_id or not normalized_book_id or not normalized_chapter:
        raise CognitionCatalogError(
            "lecture_id, book_id, and chapter_name are required for question concept binding.",
            details={
                "lecture_id": normalized_lecture_id,
                "book_id": normalized_book_id,
                "chapter_name": normalized_chapter,
            },
        )

    catalog = CognitionService(cfg).get_catalog(normalized_lecture_id, book_id=normalized_book_id)
    candidates = [
        dict(row)
        for row in catalog.get("concepts", [])
        if isinstance(row, Mapping)
        and any(
            str(source.get("book_id") or "").strip() == normalized_book_id
            and str(source.get("chapter_name") or "").strip() == normalized_chapter
            for source in row.get("source_refs", [])
            if isinstance(source, Mapping)
        )
    ]

    if not candidates:
        raise CognitionCatalogError(
            "The question chapter has no concepts in the current knowledge graph.",
            details={
                "lecture_id": normalized_lecture_id,
                "book_id": normalized_book_id,
                "chapter_name": normalized_chapter,
            },
        )

    return candidates


def serialize_concept_candidates(candidates: Iterable[Mapping[str, Any]]) -> str:
    """Serialize only stable concept fields for the question prompt."""
    rows = []
    for candidate in candidates:
        rows.append(
            {
                "concept_id": str(candidate.get("concept_id") or "").strip(),
                "name": str(candidate.get("name") or "").strip(),
                "path": [str(item or "").strip() for item in candidate.get("path", [])],
                "detail": str(candidate.get("detail") or "").strip(),
            }
        )
    return json.dumps(rows, ensure_ascii=False, separators=(",", ":"))


def validate_question_concept_bindings(
    rows: Iterable[Mapping[str, Any]],
    candidates: Iterable[Mapping[str, Any]],
) -> str:
    """Reject missing or out-of-catalog concept IDs before question persistence."""
    allowed_ids = {
        str(row.get("concept_id") or "").strip()
        for row in candidates
        if str(row.get("concept_id") or "").strip()
    }
    invalid_indexes = []

    for index, row in enumerate(rows, start=1):
        concept_id = str(
            row.get("related_concept_id")
            or row.get("concept_id")
            or ""
        ).strip()
        if not concept_id or concept_id not in allowed_ids:
            invalid_indexes.append(index)

    if invalid_indexes:
        indexes = "、".join(str(index) for index in invalid_indexes)
        return f"第 {indexes} 题没有绑定当前章节的有效 concept_id"

    return ""
