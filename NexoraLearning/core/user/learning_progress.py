"""Per-user learning progress computation.

Meant to be called from the dashboard / progress routes.
All functions are pure data readers — they never modify lecture.json.
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple

from core import user as user_store
from core.lectures import load_book_info_xml, load_book_text
from core.lectures import list_lectures as _list_all_lectures, list_books as _list_lecture_books
from core.runlog import log_event

_cfg: Dict[str, Any] = {}
_TELEMETRY_READING_COLUMNS = ["ts", "uid", "bid", "ci", "si", "event", "scroll", "focus", "sel_text", "extra"]
_ENGAGING_READING_EVENTS = frozenset({
    "snapshot",
    "scroll",
    "selection",
    "session_complete",
    "chapter_complete",
    "focus_in",
})
_LEARNING_ACTIVE_RECORD_TYPES = frozenset({
    "chapter_completed",
    "study_time",
    "study_session",
    "learning_time",
})
_UNMEASURED_READING_LOG_KEYS: set = set()


def init_learning_progress(cfg: Dict[str, Any]) -> None:
    global _cfg
    _cfg = cfg


def parse_book_info_xml_chapters(xml_text: str, full_text_length: int) -> List[Dict[str, Any]]:
    """Extract chapter list from bookinfo.xml."""
    text = str(xml_text or "")
    entries: List[Dict[str, Any]] = []
    for match in re.finditer(
        r"<chapter_name>\s*(.*?)\s*</chapter_name>[\s\S]*?<chapter_range>\s*(.*?)\s*</chapter_range>",
        text,
        flags=re.IGNORECASE,
    ):
        title = str(match.group(1) or "").strip()
        range_text = str(match.group(2) or "").strip()
        if not title or ":" not in range_text:
            continue
        left, right = range_text.split(":", 1)
        try:
            start = max(0, int(str(left).strip()))
            length = max(0, int(str(right).strip()))
        except Exception:
            continue
        end = min(max(0, int(full_text_length or 0)), start + length)
        entries.append({
            "title": title,
            "start": start,
            "end": max(start, end),
            "range": f"{start}:{length}",
        })
    entries.sort(key=lambda row: int(row.get("start") or 0))
    return entries


def list_lecture_chapters(
    lecture_id: str,
    books: list,
) -> List[Dict[str, Any]]:
    """Return a flat list of chapter dicts across all books of a lecture."""
    chapters: List[Dict[str, Any]] = []
    for book in (books or []):
        book_id = str((book or {}).get("id") or "").strip()
        if not book_id:
            continue
        try:
            info_xml = str(load_book_info_xml(_cfg, lecture_id, book_id) or "")
            full_text = str(load_book_text(_cfg, lecture_id, book_id) or "")
            chapters.extend(parse_book_info_xml_chapters(info_xml, len(full_text)))
        except Exception:
            continue
    return chapters


def parse_book_info_xml_chapter_titles(xml_text: str) -> List[str]:
    """Extract chapter titles from bookinfo.xml without reading full book text."""
    text = str(xml_text or "")
    titles: List[str] = []
    for match in re.finditer(r"<chapter_name>\s*(.*?)\s*</chapter_name>", text, flags=re.IGNORECASE):
        title = str(match.group(1) or "").strip()
        if title:
            titles.append(title)
    return titles


def list_lecture_chapter_names(
    lecture_id: str,
    books: list,
) -> List[str]:
    """Return chapter names across all books using only lightweight metadata."""
    chapter_names: List[str] = []
    for book in (books or []):
        book_id = str((book or {}).get("id") or "").strip()
        if not book_id:
            continue

        try:
            info_xml = str(load_book_info_xml(_cfg, lecture_id, book_id) or "")
            chapter_names.extend(parse_book_info_xml_chapter_titles(info_xml))
        except Exception:
            continue

    return chapter_names


def list_completed_chapter_names(
    records: List[Dict[str, Any]],
    lecture_id: str,
) -> set:
    """Return the set of chapter_names completed by a user for a specific lecture."""
    completed: set = set()
    for r in records:
        if not isinstance(r, dict):
            continue
        if str(r.get("type") or "").strip() != "chapter_completed":
            continue
        if str(r.get("lecture_id") or "").strip() != lecture_id:
            continue
        ch = str(r.get("chapter_name") or "").strip()
        if ch:
            completed.add(ch)
    return completed


def compute_user_lecture_progress(
    user_id: str,
    lecture_id: str,
    books: list,
    records: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """从用户 learning.jsonl 计算该课程的 per-user 进度.

    返回 {progress, current_chapter, next_chapter}，覆盖 lecture.json 全局值.
    """
    learning_records = records if records is not None else user_store.list_learning_records(_cfg, user_id)
    completed = list_completed_chapter_names(learning_records, lecture_id)
    chapter_names = list_lecture_chapter_names(lecture_id, books)
    total = len(chapter_names)

    current_chapter = ""
    next_chapter = ""
    for i, name in enumerate(chapter_names):
        if name not in completed:
            current_chapter = name
            if i + 1 < len(chapter_names):
                next_chapter = chapter_names[i + 1]
            break

    if total <= 0:
        progress = 0
    else:
        progress = min(100, max(0, round(len(completed) / total * 100)))
    if not current_chapter and chapter_names:
        current_chapter = chapter_names[-1]

    return {
        "progress": progress,
        "current_chapter": current_chapter,
        "next_chapter": next_chapter,
    }


def build_user_study_hours_map(
    user_id: str,
    records: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, float]:
    """Aggregate per-lecture study hours for a user.

    Reads both ``learning.jsonl`` (if any explicit duration fields are set)
    and telemetry ``reading.csv`` (snapshot events count as ~10 s each).
    """
    hours_map: Dict[str, float] = {}

    # --- learning.jsonl (explicit duration fields) ---------------------------------
    try:
        rows = records if records is not None else user_store.list_learning_records(_cfg, user_id)
        for row in rows:
            if not isinstance(row, dict):
                continue
            lecture_id = str(row.get("lecture_id") or "").strip()
            if not lecture_id:
                continue

            seconds = row.get("study_seconds")
            minutes = row.get("study_minutes")
            hours = row.get("study_hours")

            amount_hours = 0.0
            try:
                if hours is not None:
                    amount_hours = max(0.0, float(hours))
                elif minutes is not None:
                    amount_hours = max(0.0, float(minutes) / 60.0)
                elif seconds is not None:
                    amount_hours = max(0.0, float(seconds) / 3600.0)
                elif str(row.get("type") or "").strip() in {"study_time", "study_session", "learning_time"}:
                    duration = row.get("duration")
                    if duration is not None:
                        amount_hours = max(0.0, float(duration) / 3600.0)
            except Exception:
                amount_hours = 0.0

            if amount_hours > 0:
                hours_map[lecture_id] = float(hours_map.get(lecture_id, 0.0) + amount_hours)
    except Exception:
        pass

    # --- telemetry reading.csv (verified active duration) --------------------------
    per_book_seconds = _telemetry_reading_seconds_per_book(user_id)

    if per_book_seconds:
        mapping = _build_book_to_lecture_mapping()

        for bid, seconds in per_book_seconds.items():
            lid = mapping.get(bid)

            if lid:
                hours = seconds / 3600.0
                hours_map[lid] = max(float(hours_map.get(lid, 0.0)), hours)

    return hours_map


# ── telemetry helpers ─────────────────────────────────────────────────

def _resolve_telemetry_csv(user_id: str) -> Path:
    """Return path to reading.csv for *user_id*."""
    data_dir = Path(_cfg.get("data_dir") or "data")
    uid = str(user_id or "").strip()
    return data_dir / "users" / uid / "telemetry" / "reading.csv"


def _timestamp_to_unix_seconds(value: Any) -> int:
    """Normalize frontend telemetry milliseconds / backend record seconds to unix seconds."""
    try:
        raw = float(value or 0)
    except (TypeError, ValueError):
        return 0

    if raw <= 0:
        return 0

    if raw > 10_000_000_000:
        return int(raw / 1000)

    return int(raw)


def _telemetry_reading_seconds_per_book(user_id: str) -> Dict[str, float]:
    """Return measurable per-book reading seconds from telemetry.

    Heartbeats and explicit session durations are evidence of active reading.
    Event timestamps only describe when activity happened and must never be
    converted into duration across idle gaps or separate visits.
    """
    csv_path = _resolve_telemetry_csv(user_id)
    if not csv_path.exists():
        return {}

    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, fieldnames=_TELEMETRY_READING_COLUMNS)
        next(reader, None)
        result, diagnostics = _measured_reading_seconds_per_book(list(reader))

    if diagnostics["unmeasured_engaging_events"] > 0 and not result:
        log_key = (str(user_id or "").strip(), csv_path.stat().st_mtime_ns)

        if log_key not in _UNMEASURED_READING_LOG_KEYS:
            _UNMEASURED_READING_LOG_KEYS.add(log_key)
            log_event(
                "learning_duration_unmeasured",
                "阅读事件缺少可验证时长，已拒绝按首末时间推算",
                payload={
                    "user_id": str(user_id or "").strip(),
                    "event_count": diagnostics["event_count"],
                    "unmeasured_engaging_events": diagnostics["unmeasured_engaging_events"],
                },
            )

    return result


def _measured_reading_seconds_per_book(
    rows: List[Mapping[str, Any]],
) -> Tuple[Dict[str, float], Dict[str, int]]:
    """Aggregate heartbeat and explicit session evidence without wall-clock inference."""
    snapshot_seconds: Dict[str, float] = {}
    session_duration_seconds: Dict[str, Dict[str, float]] = {}
    unmeasured_engaging_events = 0

    for raw in rows:
        bid = str(raw.get("bid") or "").strip()
        if not bid:
            continue

        event = str(raw.get("event") or "").strip()

        if event == "snapshot":
            snapshot_seconds[bid] = snapshot_seconds.get(bid, 0.0) + 10.0
            continue

        if event not in ("focus_out", "session_complete"):
            if event in _ENGAGING_READING_EVENTS:
                unmeasured_engaging_events += 1

            continue

        extra = _parse_extra_dict(raw.get("extra", ""))
        duration_ms = _parse_duration_ms_from_extra_dict(extra)

        if duration_ms <= 0:
            unmeasured_engaging_events += 1
            continue

        session_key = str(extra.get("session_key") or "").strip()

        if not session_key:
            session_key = "|".join([
                str(raw.get("ts") or "").strip(),
                str(raw.get("ci") or "").strip(),
                str(raw.get("si") or "").strip(),
                event,
            ])

        per_book_sessions = session_duration_seconds.setdefault(bid, {})
        per_book_sessions[session_key] = max(
            per_book_sessions.get(session_key, 0.0),
            duration_ms / 1000.0,
        )

    result: Dict[str, float] = {}
    all_bids = set(snapshot_seconds) | set(session_duration_seconds)

    for bid in all_bids:
        heartbeat_total = snapshot_seconds.get(bid, 0.0)
        session_total = sum(session_duration_seconds.get(bid, {}).values())
        measured_seconds = max(heartbeat_total, session_total)

        if measured_seconds > 0:
            result[bid] = measured_seconds

    return result, {
        "event_count": len(rows),
        "unmeasured_engaging_events": unmeasured_engaging_events,
    }


def _telemetry_reading_last_ts_per_book(user_id: str) -> Dict[str, int]:
    """Return latest engaging reading timestamp per book as unix seconds."""
    csv_path = _resolve_telemetry_csv(user_id)
    if not csv_path.exists():
        return {}

    last_by_book: Dict[str, int] = {}
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, fieldnames=_TELEMETRY_READING_COLUMNS)
        next(reader, None)

        for raw in reader:
            bid = str(raw.get("bid") or "").strip()
            if not bid:
                continue

            event = str(raw.get("event") or "").strip()
            if event not in _ENGAGING_READING_EVENTS:
                continue

            ts_val = _timestamp_to_unix_seconds(raw.get("ts"))
            if ts_val > last_by_book.get(bid, 0):
                last_by_book[bid] = ts_val

    return last_by_book


def _parse_extra_dict(raw_extra: Any) -> Dict[str, Any]:
    """Parse telemetry extra JSON while keeping invalid data visibly unmeasured."""
    text = str(raw_extra or "").strip()

    if not text:
        return {}

    try:
        value = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return {}

    return value if isinstance(value, dict) else {}


def _parse_duration_ms_from_extra_dict(extra: Mapping[str, Any]) -> float:
    """Read the first positive explicit duration from parsed telemetry metadata."""
    for key in ("duration_ms", "active_duration_ms"):
        value = extra.get(key)

        if value is None:
            continue

        try:
            duration_ms = float(value)
        except (ValueError, TypeError):
            continue

        if duration_ms > 0:
            return duration_ms

    return 0.0


def build_user_lecture_last_active_map(
    user_id: str,
    records: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, int]:
    """Aggregate latest real learning activity per lecture."""
    last_map: Dict[str, int] = {}

    rows = records if records is not None else user_store.list_learning_records(_cfg, user_id)
    for row in rows:
        if not isinstance(row, dict):
            continue

        record_type = str(row.get("type") or "").strip()
        if record_type not in _LEARNING_ACTIVE_RECORD_TYPES:
            continue

        lecture_id = str(row.get("lecture_id") or "").strip()
        if not lecture_id:
            continue

        ts_val = _timestamp_to_unix_seconds(row.get("timestamp") or row.get("ts"))
        if ts_val > last_map.get(lecture_id, 0):
            last_map[lecture_id] = ts_val

    book_last_map = _telemetry_reading_last_ts_per_book(user_id)
    if book_last_map:
        book_to_lecture = _build_book_to_lecture_mapping()

        for book_id, ts_val in book_last_map.items():
            lecture_id = book_to_lecture.get(book_id)
            if lecture_id and ts_val > last_map.get(lecture_id, 0):
                last_map[lecture_id] = ts_val

    return last_map


def _build_book_to_lecture_mapping() -> Dict[str, str]:
    """Build book_id → lecture_id mapping from the lecture catalog."""
    mapping: Dict[str, str] = {}
    try:
        for lecture in _list_all_lectures(_cfg):
            if not isinstance(lecture, dict):
                continue
            lecture_id = str(lecture.get("id") or "").strip()
            if not lecture_id:
                continue
            for book in _list_lecture_books(_cfg, lecture_id):
                if not isinstance(book, dict):
                    continue
                book_id = str(book.get("id") or "").strip()
                if book_id:
                    mapping[book_id] = lecture_id
    except Exception:
        pass
    return mapping


