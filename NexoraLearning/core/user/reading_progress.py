"""Persist reader checkpoints as idempotent, evidence-only learning records.

Coordinates are absolute Unicode code-point offsets in the book index's plain
text. A visit belongs to one user, book and chapter; durations and ranges are
cumulative for that visit. Observing text never writes a mastery assessment.
"""

from __future__ import annotations

import math
import threading
import time
from typing import Any, Dict, Iterable, List, Mapping, Optional

from core import user as user_store
from core.bookindex import get_book_index
from core.bookindex.structure import BookIndex, Chapter


# The learning store is append-only. Serialize read/deduplicate/append, including
# legacy completion writes and chapter resets, within the Flask service process.
PROGRESS_LOCK = threading.RLock()


class ProgressConflict(ValueError):
    """A reading visit id was reused for a different target."""


def valid_identifier(value: Any) -> bool:
    text = str(value or "").strip()
    return bool(
        text and len(text) <= 200 and text not in {".", ".."}
        and not text.endswith(".")
        and not any(char in text for char in '/\\:<>"|?*')
        and not any(ord(char) < 32 for char in text)
    )


def nonnegative_integer(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a non-negative integer.")
    if value < 0 or value > 9_007_199_254_740_991 or not math.isfinite(value) or int(value) != value:
        raise ValueError(f"{label} must be a non-negative integer.")
    return int(value)


def merge_read_ranges(
    ranges: Iterable[Any], start: int, end: int, *, strict: bool = False
) -> List[List[int]]:
    intervals: List[List[int]] = []
    for pair in ranges:
        try:
            if not isinstance(pair, (list, tuple)) or len(pair) != 2:
                raise ValueError("read_ranges must contain [start, end] pairs.")
            left = nonnegative_integer(pair[0], "range start")
            right = nonnegative_integer(pair[1], "range end")
            if left < start or right > end or right <= left:
                raise ValueError("read_ranges must lie within the requested chapter.")
        except ValueError:
            if strict:
                raise
            continue
        intervals.append([left, right])
    merged: List[List[int]] = []
    for left, right in sorted(intervals):
        if merged and left <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], right)
        else:
            merged.append([left, right])
    return merged


def chapter_for_record(index: BookIndex, record: Mapping[str, Any]) -> Optional[Chapter]:
    """Resolve historical records without confusing same-named chapters."""
    name = str(record.get("chapter_name") or "").strip()
    raw_index = record.get("chapter_index")
    if raw_index is not None:
        try:
            chapter_index = int(raw_index)
        except (TypeError, ValueError):
            return None
        chapter = index.chapter_at(chapter_index)
        if chapter is None or (name and name != chapter.title):
            return None
        return chapter
    matches = [chapter for chapter in index.chapters if chapter.title == name]
    return matches[0] if len(matches) == 1 else None


def resolve_progress_chapter(
    cfg: Mapping[str, Any], lecture_id: str, book_id: str, payload: Mapping[str, Any]
) -> Chapter:
    if not valid_identifier(lecture_id) or not valid_identifier(book_id):
        raise ValueError("lecture_id and book_id must be valid identifiers.")
    index = get_book_index(cfg, lecture_id, book_id)
    if payload.get("chapter_index") is not None:
        nonnegative_integer(payload["chapter_index"], "chapter_index")
    chapter = chapter_for_record(index, payload)
    if chapter is None:
        raise ValueError("chapter_index and chapter_name must identify an existing chapter.")
    declared_range = str(payload.get("chapter_range") or "").strip()
    # Legacy completions may still send the persisted raw metadata range.
    allowed_ranges = {chapter.range, chapter.stored_range}
    if str(payload.get("coordinate_space") or "") == "plain":
        allowed_ranges = {chapter.range}
    if declared_range and declared_range not in allowed_ranges:
        raise ValueError("chapter_range no longer matches this chapter; refresh its content.")
    return chapter


def record_reading_checkpoint(
    cfg: Dict[str, Any], user_id: str, payload: Mapping[str, Any]
) -> Dict[str, Any]:
    if not valid_identifier(user_id):
        raise ValueError("A valid username is required.")
    lecture_id = str(payload.get("lecture_id") or "").strip()
    book_id = str(payload.get("book_id") or "").strip()
    if str(payload.get("coordinate_space") or "plain") != "plain":
        raise ValueError("reading progress uses coordinate_space plain.")
    chapter = resolve_progress_chapter(cfg, lecture_id, book_id, {**payload, "coordinate_space": "plain"})
    session_id = str(payload.get("session_id") or "").strip()
    if not valid_identifier(session_id):
        raise ValueError("session_id must identify this chapter visit.")
    sequence = nonnegative_integer(payload.get("sequence"), "sequence")
    duration_ms = nonnegative_integer(payload.get("active_duration_ms"), "active_duration_ms")
    received_at_ms = int(time.time() * 1000)
    started_at_ms = nonnegative_integer(payload.get("started_at_ms", 0), "started_at_ms")
    observed_at_ms = nonnegative_integer(payload.get("observed_at_ms", 0), "observed_at_ms") or received_at_ms
    if observed_at_ms > received_at_ms + 300_000 or started_at_ms > observed_at_ms:
        raise ValueError("Reading timestamps must be ordered and cannot be in the future.")
    if started_at_ms and duration_ms > observed_at_ms - started_at_ms + 1000:
        raise ValueError("Active reading duration cannot exceed the observed visit.")
    raw_ranges = payload.get("read_ranges")
    if not isinstance(raw_ranges, list) or len(raw_ranges) > 4096:
        raise ValueError("read_ranges must be an array of at most 4096 ranges.")
    ranges = merge_read_ranges(raw_ranges, chapter.start, chapter.end, strict=True)
    if ranges and duration_ms <= 0:
        raise ValueError("Observed ranges require positive active reading duration.")
    paragraph_index = nonnegative_integer(payload.get("paragraph_index", 0), "paragraph_index")
    page_index = nonnegative_integer(payload.get("page_index", 0), "page_index")

    with PROGRESS_LOCK:
        rows = user_store.list_learning_records(cfg, user_id)
        previous = [
            row for row in rows
            if row.get("type") == "reading_progress" and row.get("session_id") == session_id
        ]
        for row in previous:
            if (
                row.get("lecture_id") != lecture_id or row.get("book_id") != book_id
                or row.get("chapter_index") != chapter.index
            ):
                raise ProgressConflict("session_id already belongs to a different chapter visit.")
            if started_at_ms and row.get("started_at_ms") and row["started_at_ms"] != started_at_ms:
                raise ProgressConflict("session_id already has a different visit start time.")
        reset_rows = [
            row for row in rows
            if row.get("type") == "reading_progress_reset"
            and row.get("lecture_id") == lecture_id and row.get("book_id") == book_id
            and row.get("chapter_index") == chapter.index
        ]
        if started_at_ms and any(started_at_ms <= int(row.get("reset_at_ms") or 0) for row in reset_rows):
            return {
                "already_recorded": True,
                "record": {"chapter_index": chapter.index},
                "study_seconds": 0.0,
            }
        if previous and any(
            session_id in (row.get("closed_session_ids") or []) for row in reset_rows
        ):
            return {"already_recorded": True, "record": previous[-1], "study_seconds": 0.0}
        repeated = next((row for row in previous if row.get("sequence") == sequence), None)
        if repeated is not None:
            return {"already_recorded": True, "record": repeated, "study_seconds": 0.0}

        old_duration = max((int(row.get("active_duration_ms") or 0) for row in previous), default=0)
        study_seconds = max(0, duration_ms - old_duration) / 1000.0
        record = user_store.append_learning_record(cfg, user_id, {
            "type": "reading_progress",
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_index": chapter.index,
            "chapter_name": chapter.title,
            "chapter_range": chapter.range,
            "coordinate_space": "plain",
            "session_id": session_id,
            "sequence": sequence,
            "active_duration_ms": duration_ms,
            "started_at_ms": started_at_ms,
            "observed_at_ms": observed_at_ms,
            "timestamp": observed_at_ms // 1000,
            "recorded_at": received_at_ms // 1000,
            "study_seconds": study_seconds,
            "read_ranges": ranges,
            "paragraph_index": paragraph_index,
            "page_index": page_index,
        })
        return {"already_recorded": False, "record": record, "study_seconds": study_seconds}


def reset_chapter_reading_progress(
    cfg: Dict[str, Any], user_id: str, lecture_id: str, book_id: str, chapter: Chapter,
) -> Dict[str, int]:
    """Clear coverage while preserving measured duration and retry receipts."""
    with PROGRESS_LOCK:
        rows = user_store.list_learning_records(cfg, user_id)
        closed_session_ids = sorted({
            str(row["session_id"])
            for row in rows
            if row.get("type") == "reading_progress"
            and row.get("lecture_id") == lecture_id and row.get("book_id") == book_id
            and row.get("chapter_index") == chapter.index and row.get("session_id")
        })
        result = user_store.remove_chapter_learning_records(
            cfg, user_id, lecture_id=lecture_id, book_id=book_id,
            chapter_name=chapter.title, chapter_index=chapter.index,
        )
        user_store.append_learning_record(cfg, user_id, {
            "type": "reading_progress_reset",
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_index": chapter.index,
            "chapter_name": chapter.title,
            "closed_session_ids": closed_session_ids,
            "reset_at_ms": int(time.time() * 1000),
        })
        return {**result, "reset_reading_sessions": len(closed_session_ids)}
