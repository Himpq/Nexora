"""Per-user learning progress computation.

Meant to be called from the dashboard / progress routes.
All functions are pure data readers — they never modify lecture.json.
"""

from __future__ import annotations

import csv
import json
import math
import re
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple

from core import user as user_store
from core.lectures import load_book_info_xml, load_book_text
from core.lectures import list_lectures as _list_all_lectures, list_books as _list_lecture_books
from core.runlog import log_event
from core.bookindex import get_book_index
from core.user.reading_progress import chapter_for_record, merge_read_ranges

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
    "session_completed",
    "reading_progress",
    "study_time",
    "study_session",
    "learning_time",
})
_UNMEASURED_READING_LOG_KEYS: set = set()


def init_learning_progress(cfg: Dict[str, Any]) -> None:
    global _cfg
    _cfg = cfg


def parse_book_info_xml_chapters(xml_text: str, full_text_length: int) -> List[Dict[str, Any]]:
    """Extract chapters from bookinfo.xml in stored (raw) coordinates.

    Delegates to :mod:`core.bookindex.structure`, the single parser for this
    XML. Offsets are raw ``content.txt`` offsets; use
    ``core.bookindex.get_book_index`` when reader coordinates are needed.
    """
    from core.bookindex import parse_bookinfo_chapters

    limit = max(0, int(full_text_length or 0))
    entries: List[Dict[str, Any]] = []
    for row in parse_bookinfo_chapters(xml_text):
        title = str(row.get("title") or "").strip()
        start = int(row.get("raw_start") or 0)
        length = int(row.get("raw_length") or 0)
        if not title or length <= 0:
            continue
        end = min(limit, start + length) if limit else start + length
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
    book_id: str = "",
    cfg: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Summarize observed reading coverage, separate from assessed mastery.

    Canonical book/chapter identities and ranges are shared with the reader.
    Partially read chapters and completed sessions count immediately; unknown
    historical completion titles cannot inflate the denominator or numerator.
    """
    active_cfg = cfg if cfg is not None else _cfg
    learning_records = records if records is not None else user_store.list_learning_records(active_cfg, user_id)
    chapter_rows: List[Dict[str, Any]] = []
    indexes: Dict[str, Any] = {}
    by_key: Dict[Tuple[str, int], Dict[str, Any]] = {}
    for book in books or []:
        bid = str((book or {}).get("id") or "").strip()
        if not bid or bid in indexes or (book_id and bid != book_id):
            continue
        index = get_book_index(active_cfg, lecture_id, bid)
        indexes[bid] = index
        for chapter in index.chapters:
            row = {
                "book_id": bid,
                "chapter_index": chapter.index,
                "chapter_name": chapter.title,
                "chapter_range": chapter.range,
                "completed": False,
                "read_chars": 0,
                "total_chars": chapter.length,
                "reading_percent": 0.0,
                "reading_seconds": 0.0,
                "paragraph_index": chapter.paragraph_start,
                "page_index": 0,
                "last_active_ts": 0,
                "_ranges": [],
                "_completed_sessions": set(),
                "_visit_sequences": {},
                "_records": [],
            }
            chapter_rows.append(row)
            by_key[(bid, chapter.index)] = row

    scope_records: List[Dict[str, Any]] = []
    latest_position: Optional[Tuple[Tuple[int, int], Dict[str, Any]]] = None
    visit_order: Dict[str, Tuple[int, int]] = {}
    for record_order, record in enumerate(learning_records):
        if not isinstance(record, dict) or str(record.get("lecture_id") or "") != lecture_id:
            continue
        bid = str(record.get("book_id") or "").strip()
        if book_id and bid != book_id:
            continue
        scope_records.append(record)
        index = indexes.get(bid)
        if index is None:
            continue
        chapter = chapter_for_record(index, record)
        if chapter is None:
            continue
        row = by_key[(bid, chapter.index)]
        row["_records"].append(record)
        record_type = str(record.get("type") or "")
        if record_type == "reading_progress_reset":
            row["completed"] = False
            row["_ranges"] = []
            row["_completed_sessions"] = set()
            if latest_position and latest_position[1] is row:
                latest_position = None
            continue
        elif record_type == "chapter_completed":
            row["completed"] = True
            row["_ranges"].append([chapter.start, chapter.end])
        elif record_type == "session_completed":
            session_index = _record_int(record.get("session_index"), -1)
            session = next((item for item in chapter.sessions if item.index == session_index), None)
            if session is None or (
                record.get("session_name") and record["session_name"] != session.name
            ):
                continue
            row["_ranges"].append([session.start, session.end])
            row["_completed_sessions"].add(session.index)
        elif record_type == "reading_progress":
            if record.get("coordinate_space", "plain") != "plain":
                continue
            if record.get("chapter_range") and record["chapter_range"] != chapter.range:
                continue
            raw_ranges = record.get("read_ranges")
            if isinstance(raw_ranges, list):
                row["_ranges"].extend(merge_read_ranges(raw_ranges, chapter.start, chapter.end))
            session_id = str(record.get("session_id") or "")
            sequence = _record_int(record.get("sequence"), -1)
            old_sequence = row["_visit_sequences"].get(session_id, -1)
            if sequence <= old_sequence:
                continue
            row["_visit_sequences"][session_id] = sequence
            first_seen = visit_order.setdefault(session_id, (
                _record_int(record.get("started_at_ms"))
                or _timestamp_to_unix_seconds(record.get("timestamp")) * 1000,
                record_order,
            ))
            # A late retry from an earlier visit cannot move the resume target
            # back across a chapter switch.
            if latest_position is None or first_seen >= latest_position[0]:
                row["paragraph_index"] = _record_int(record.get("paragraph_index"), chapter.paragraph_start)
                row["page_index"] = _record_int(record.get("page_index"), 0)
                latest_position = (first_seen, row)
        else:
            continue
        row["last_active_ts"] = max(
            row["last_active_ts"], _timestamp_to_unix_seconds(record.get("timestamp") or record.get("ts"))
        )

    for row in chapter_rows:
        chapter = indexes[row["book_id"]].chapter_at(row["chapter_index"])
        if chapter.sessions and len(row["_completed_sessions"]) == len(chapter.sessions):
            row["completed"] = True
            row["_ranges"].append([chapter.start, chapter.end])
        ranges = merge_read_ranges(row.pop("_ranges"), chapter.start, chapter.end)
        row["read_chars"] = sum(right - left for left, right in ranges)
        row["reading_percent"] = round(row["read_chars"] / chapter.length * 100, 2) if chapter.length else 0.0
        row.pop("_completed_sessions")
        row.pop("_visit_sequences")
        row["reading_seconds"] = _records_study_seconds(row.pop("_records"))

    read_chars = sum(row["read_chars"] for row in chapter_rows)
    total_chars = sum(row["total_chars"] for row in chapter_rows)
    reading_progress = round(read_chars / total_chars * 100, 2) if total_chars else 0.0
    current_row = latest_position[1] if latest_position and not latest_position[1]["completed"] else None
    if current_row is None:
        current_row = next((row for row in chapter_rows if not row["completed"]), None)
    if current_row is None and chapter_rows:
        current_row = chapter_rows[-1]
    current_index = chapter_rows.index(current_row) if current_row else -1
    next_row = next((
        row for row in chapter_rows[current_index + 1:] if not row["completed"]
    ), None)

    # Old reader builds only emitted measured telemetry. Preserve their duration
    # without pretending that a heartbeat identifies which characters were read.
    telemetry = _telemetry_reading_seconds_per_book(user_id, cfg=active_cfg)
    reading_seconds = _reconcile_reading_seconds(
        scope_records, {bid: telemetry.get(bid, 0.0) for bid in indexes}
    )

    return {
        "progress": round(reading_progress),
        "reading_progress": reading_progress,
        "current_chapter": current_row["chapter_name"] if current_row else "",
        "current_book_id": current_row["book_id"] if current_row else "",
        "current_chapter_index": current_row["chapter_index"] if current_row else -1,
        "next_chapter": next_row["chapter_name"] if next_row else "",
        "completed_chapters": sum(1 for row in chapter_rows if row["completed"]),
        "total_chapters": len(chapter_rows),
        "read_chapters": sum(1 for row in chapter_rows if row["read_chars"] > 0),
        "read_chars": read_chars,
        "total_chars": total_chars,
        "reading_seconds": reading_seconds,
        "chapters": chapter_rows,
    }


def _record_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        return default


def _positive_number(value: Any) -> float:
    try:
        amount = float(value)
    except (TypeError, ValueError, OverflowError):
        return 0.0
    return amount if math.isfinite(amount) and amount > 0 else 0.0


def _explicit_study_seconds(row: Mapping[str, Any]) -> float:
    for name, multiplier in (("study_hours", 3600), ("study_minutes", 60), ("study_seconds", 1)):
        if row.get(name) is not None:
            return _positive_number(row[name]) * multiplier
    if row.get("type") in {"study_time", "study_session", "learning_time"}:
        return _positive_number(row.get("duration"))
    return 0.0


def _records_study_seconds(rows: List[Dict[str, Any]]) -> float:
    visits: Dict[Tuple[str, str, str], float] = {}
    explicit_seconds = 0.0
    for row in rows:
        if row.get("type") == "reading_progress" and row.get("session_id"):
            key = (str(row.get("lecture_id") or ""), str(row.get("book_id") or ""), str(row["session_id"]))
            visits[key] = max(visits.get(key, 0.0), _positive_number(row.get("active_duration_ms")) / 1000.0)
        else:
            explicit_seconds += _explicit_study_seconds(row)
    return explicit_seconds + sum(visits.values())


def learning_records_with_measured_duration(
    records: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Reconstruct per-checkpoint durations in visit order before day filtering.

    Persisted study_seconds describes what was newly received by the server.
    With offline or out-of-order uploads that delta can belong to an earlier
    day. The visit's cumulative counter and sequence recover those increments
    without adding idle time between timestamps. Input records are not mutated.
    """
    rows = [dict(record) for record in records if isinstance(record, dict)]
    visits: Dict[Tuple[str, str, str], List[int]] = {}
    for index, row in enumerate(rows):
        if row.get("type") != "reading_progress" or not row.get("session_id"):
            continue
        key = (str(row.get("lecture_id") or ""), str(row.get("book_id") or ""), str(row["session_id"]))
        visits.setdefault(key, []).append(index)
    for indices in visits.values():
        elapsed = 0.0
        for index in sorted(indices, key=lambda item: (_record_int(rows[item].get("sequence")), item)):
            seconds = _positive_number(rows[index].get("active_duration_ms")) / 1000.0
            rows[index]["study_seconds"] = max(0.0, seconds - elapsed)
            elapsed = max(elapsed, seconds)
    return rows


def _reconcile_reading_seconds(
    rows: List[Dict[str, Any]], telemetry: Mapping[str, float],
) -> float:
    per_book: Dict[str, List[Dict[str, Any]]] = {}
    unscoped: List[Dict[str, Any]] = []
    for row in rows:
        bid = str(row.get("book_id") or "").strip()
        if bid:
            per_book.setdefault(bid, []).append(row)
        else:
            unscoped.append(row)
    explicit_by_book = {bid: _records_study_seconds(book_rows) for bid, book_rows in per_book.items()}
    measured = sum(
        max(explicit_by_book.get(bid, 0.0), telemetry.get(bid, 0.0))
        for bid in set(per_book) | set(telemetry)
    )
    # Old lecture-only study_time records may already summarize its telemetry.
    return max(measured, _records_study_seconds(unscoped) + sum(explicit_by_book.values()))


def build_user_study_hours_map(
    user_id: str,
    records: Optional[List[Dict[str, Any]]] = None,
    cfg: Optional[Mapping[str, Any]] = None,
) -> Dict[str, float]:
    """Aggregate per-lecture study hours for a user.

    Reads explicit per-visit durations and legacy measured telemetry. Telemetry
    mirroring the same reading activity is a fallback, not an added duration.
    """
    hours_map: Dict[str, float] = {}

    active_cfg = cfg if cfg is not None else _cfg
    rows = records if records is not None else user_store.list_learning_records(active_cfg, user_id)
    per_lecture: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        lecture_id = str(row.get("lecture_id") or "").strip()
        if lecture_id:
            per_lecture.setdefault(lecture_id, []).append(row)

    # --- telemetry reading.csv (verified active duration) --------------------------
    per_book_seconds = _telemetry_reading_seconds_per_book(user_id, cfg=active_cfg)

    mapping = _build_book_to_lecture_mapping(cfg=active_cfg) if per_book_seconds else {}
    telemetry_by_lecture: Dict[str, Dict[str, float]] = {}
    for bid, seconds in per_book_seconds.items():
        lid = mapping.get(bid)
        if lid:
            telemetry_by_lecture.setdefault(lid, {})[bid] = seconds
    for lid in set(per_lecture) | set(telemetry_by_lecture):
        seconds = _reconcile_reading_seconds(per_lecture.get(lid, []), telemetry_by_lecture.get(lid, {}))
        if seconds > 0:
            hours_map[lid] = seconds / 3600.0

    return hours_map


# ── telemetry helpers ─────────────────────────────────────────────────

def _resolve_telemetry_csv(user_id: str, cfg: Optional[Mapping[str, Any]] = None) -> Path:
    """Return path to reading.csv for *user_id*."""
    active_cfg = cfg if cfg is not None else _cfg
    data_dir = Path(active_cfg.get("data_dir") or "data")
    uid = str(user_id or "").strip()
    return data_dir / "users" / uid / "telemetry" / "reading.csv"


def _timestamp_to_unix_seconds(value: Any) -> int:
    """Normalize frontend telemetry milliseconds / backend record seconds to unix seconds."""
    try:
        raw = float(value or 0)
    except (TypeError, ValueError, OverflowError):
        return 0

    if not math.isfinite(raw) or raw <= 0:
        return 0

    if raw > 10_000_000_000:
        return int(raw / 1000)

    return int(raw)


def _telemetry_reading_seconds_per_book(
    user_id: str, cfg: Optional[Mapping[str, Any]] = None,
) -> Dict[str, float]:
    """Return measurable per-book reading seconds from telemetry.

    Heartbeats and explicit session durations are evidence of active reading.
    Event timestamps only describe when activity happened and must never be
    converted into duration across idle gaps or separate visits.
    """
    csv_path = _resolve_telemetry_csv(user_id, cfg=cfg)
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
    keyed_snapshot_seconds: Dict[str, Dict[str, float]] = {}
    keyed_duration_seconds: Dict[str, Dict[str, float]] = {}
    session_duration_seconds: Dict[str, Dict[str, float]] = {}
    unmeasured_engaging_events = 0
    seen_snapshots: set = set()

    for raw in rows:
        bid = str(raw.get("bid") or "").strip()
        if not bid:
            continue

        event = str(raw.get("event") or "").strip()
        extra = _parse_extra_dict(raw.get("extra", ""))
        session_key = str(extra.get("session_key") or extra.get("session_id") or "").strip()
        duration_ms = _parse_duration_ms_from_extra_dict(extra)

        if event == "snapshot":
            if session_key:
                if "active_duration_ms" in extra or "duration_ms" in extra:
                    per_book = keyed_duration_seconds.setdefault(bid, {})
                    per_book[session_key] = max(per_book.get(session_key, 0.0), duration_ms / 1000.0)
                    continue
                snapshot_key = (bid, session_key, str(raw.get("ts") or ""))
                if snapshot_key not in seen_snapshots:
                    seen_snapshots.add(snapshot_key)
                    per_book = keyed_snapshot_seconds.setdefault(bid, {})
                    per_book[session_key] = per_book.get(session_key, 0.0) + 10.0
                continue
            snapshot_key = (bid, str(raw.get("ci") or ""), str(raw.get("si") or ""), str(raw.get("ts") or ""))
            if snapshot_key in seen_snapshots:
                continue
            seen_snapshots.add(snapshot_key)
            snapshot_seconds[bid] = snapshot_seconds.get(bid, 0.0) + 10.0
            continue

        if event not in ("focus_out", "session_complete"):
            if event in _ENGAGING_READING_EVENTS:
                unmeasured_engaging_events += 1

            continue

        if duration_ms <= 0:
            unmeasured_engaging_events += 1
            continue

        if session_key:
            per_book = keyed_duration_seconds.setdefault(bid, {})
            per_book[session_key] = max(per_book.get(session_key, 0.0), duration_ms / 1000.0)
            continue
        else:
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
    all_bids = set(snapshot_seconds) | set(session_duration_seconds) | set(keyed_snapshot_seconds) | set(keyed_duration_seconds)

    for bid in all_bids:
        heartbeat_total = snapshot_seconds.get(bid, 0.0)
        session_total = sum(session_duration_seconds.get(bid, {}).values())
        keyed_heartbeats = keyed_snapshot_seconds.get(bid, {})
        keyed_durations = keyed_duration_seconds.get(bid, {})
        keyed_total = sum(
            max(keyed_heartbeats.get(key, 0.0), keyed_durations.get(key, 0.0))
            for key in set(keyed_heartbeats) | set(keyed_durations)
        )
        measured_seconds = keyed_total + max(heartbeat_total, session_total)

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
    if isinstance(raw_extra, dict):
        return raw_extra
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

        if math.isfinite(duration_ms) and duration_ms > 0:
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


def _build_book_to_lecture_mapping(cfg: Optional[Mapping[str, Any]] = None) -> Dict[str, str]:
    """Build book_id → lecture_id mapping from the lecture catalog."""
    mapping: Dict[str, str] = {}
    active_cfg = cfg if cfg is not None else _cfg
    try:
        for lecture in _list_all_lectures(active_cfg):
            if not isinstance(lecture, dict):
                continue
            lecture_id = str(lecture.get("id") or "").strip()
            if not lecture_id:
                continue
            for book in _list_lecture_books(active_cfg, lecture_id):
                if not isinstance(book, dict):
                    continue
                book_id = str(book.get("id") or "").strip()
                if book_id:
                    mapping[book_id] = lecture_id
    except Exception:
        pass
    return mapping


