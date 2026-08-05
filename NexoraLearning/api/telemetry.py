"""Telemetry collection and query subsystem.

Data layout:
  data/users/{user_id}/telemetry/
    {stream}.csv          – append-only event rows
    _meta.json            – column schemas per stream (registry)

Stream = a typed event series (reading, annotation, question).
Each stream maps to one CSV file with a fixed column set.
Adding a new stream only requires registering it in _STREAM_SCHEMAS
and writing any ingest logic; the core CSV machinery stays unchanged.

Register the blueprint in main.py:
    from api.telemetry import telemetry_bp
    app.register_blueprint(telemetry_bp)
"""

from __future__ import annotations

import csv
import io
import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple

from flask import Blueprint, jsonify, request

telemetry_bp = Blueprint("telemetry", __name__, url_prefix="/api/telemetry")

# ────────────────────────────────────────────────────────────
# Stream schema registry (THE SINGLE PLACE to add new streams)
# ────────────────────────────────────────────────────────────

_STREAM_SCHEMAS: Dict[str, Dict[str, Any]] = {
    "reading": {
        "kind": "reading",
        "label": "阅读行为",
        "columns": ["ts", "uid", "bid", "ci", "si", "event", "scroll", "focus", "sel_text", "extra"],
        "column_labels": {
            "ts": "时间戳(unix秒)",
            "uid": "用户ID",
            "bid": "教材ID",
            "ci": "章节索引",
            "si": "小节索引",
            "event": "事件类型(snapshot|scroll|selection|focus_in|focus_out)",
            "scroll": "滚动比例(0~1)",
            "focus": "焦点(reader|chat|blur)",
            "sel_text": "选中文本",
            "extra": "扩展JSON",
        },
    },
    "annotation": {
        "kind": "annotation",
        "label": "批注交互",
        "columns": ["ts", "uid", "bid", "ci", "si", "event", "ann_type", "offset", "duration_ms", "extra"],
        "column_labels": {
            "ts": "时间戳(unix秒)",
            "uid": "用户ID",
            "bid": "教材ID",
            "ci": "章节索引",
            "si": "小节索引",
            "event": "事件类型(view|ask|dwell)",
            "ann_type": "批注类型",
            "offset": "文本偏移量",
            "duration_ms": "停留时长(ms)",
            "extra": "扩展JSON",
        },
    },
    "question": {
        "kind": "question",
        "label": "答题记录",
        "columns": ["ts", "uid", "lid", "bid", "ci", "si", "qid", "difficulty", "answer", "is_correct", "duration_sec", "extra"],
        "column_labels": {
            "ts": "时间戳(unix秒)",
            "uid": "用户ID",
            "lid": "课程ID",
            "bid": "教材ID",
            "ci": "章节索引",
            "si": "小节索引",
            "qid": "题目ID",
            "difficulty": "难度(简单|中等|进阶)",
            "answer": "用户作答",
            "is_correct": "是否正确(0|1|-1=未知)",
            "duration_sec": "作答耗时(秒)",
            "extra": "扩展JSON",
        },
    },
}

# ────────────────────────────────────────────────────────────
# Internal state
# ────────────────────────────────────────────────────────────

_LOCK = threading.Lock()
_CFG: Dict[str, Any] = {}


def _data_dir() -> Path:
    return Path(str(_CFG.get("data_dir") or "data"))


# ────────────────────────────────────────────────────────────
# Path helpers
# ────────────────────────────────────────────────────────────

def _telemetry_dir(user_id: str) -> Path:
    return _data_dir() / "users" / user_id / "telemetry"


def _csv_path(user_id: str, stream: str) -> Path:
    return _telemetry_dir(user_id) / f"{stream}.csv"




# ────────────────────────────────────────────────────────────
# Schema helpers
# ────────────────────────────────────────────────────────────

def _columns_for(stream: str) -> List[str]:
    schema = _STREAM_SCHEMAS.get(stream)
    if not schema:
        return []
    return list(schema.get("columns") or [])


def _is_known_stream(stream: str) -> bool:
    return stream in _STREAM_SCHEMAS


# ────────────────────────────────────────────────────────────
# File I/O (thread-safe)
# ────────────────────────────────────────────────────────────


def _ensure_csv_header(user_id: str, stream: str) -> None:
    """Create CSV file with header row if it does not exist."""
    p = _csv_path(user_id, stream)
    if p.exists():
        return
    p.parent.mkdir(parents=True, exist_ok=True)
    columns = _columns_for(stream)
    if not columns:
        return
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(columns)
    with p.open("w", encoding="utf-8", newline="") as f:
        f.write(buf.getvalue())


def _append_rows(user_id: str, stream: str, rows: List[List[Any]]) -> int:
    """Append rows to CSV. Returns number of rows written. Thread-safe."""
    columns = _columns_for(stream)
    if not columns:
        return 0
    if not rows:
        return 0
    buf = io.StringIO()
    writer = csv.writer(buf)
    for row in rows:
        normalised = []
        for i, col in enumerate(columns):
            val = row.get(col) if isinstance(row, dict) else (row[i] if i < len(row) else "")
            normalised.append("" if val is None else str(val))
        writer.writerow(normalised)
    payload = buf.getvalue()
    with _LOCK:
        _ensure_csv_header(user_id, stream)
        p = _csv_path(user_id, stream)
        with open(p, "a", encoding="utf-8", newline="") as f:
            f.write(payload)
    return len(rows)


# ────────────────────────────────────────────────────────────
# Row normalisation
# ────────────────────────────────────────────────────────────

def _normalise_event(raw: Mapping[str, Any]) -> Optional[Tuple[str, Dict[str, Any]]]:
    """Validate and normalise a single event dict.

    Returns (stream, normalised_dict) or None if invalid.
    """
    stream = str(raw.get("stream") or "").strip()
    if not _is_known_stream(stream):
        return None
    columns = _columns_for(stream)
    out: Dict[str, Any] = {col: "" for col in columns}

    # ts: default to now if missing
    ts = raw.get("ts")
    if ts is None or not str(ts).strip():
        out["ts"] = int(time.time())
    else:
        try:
            out["ts"] = int(ts)
        except (ValueError, TypeError):
            out["ts"] = int(time.time())

    # Map every known column; pass through unknown keys into extra if extra exists
    extra_dict: Dict[str, Any] = {}
    for key, value in raw.items():
        if key == "stream":
            continue
        key_str = str(key)
        if key_str in columns and key_str != "ts":
            out[key_str] = value if value is not None else ""
        elif key_str == "extra":
            if isinstance(value, str):
                out["extra"] = value
            elif isinstance(value, dict):
                out["extra"] = json.dumps(value, ensure_ascii=False)
            else:
                out["extra"] = "" if value is None else str(value)
        elif key_str not in columns:
            extra_dict[key_str] = value

    # Merge unrecognised keys into extra
    if extra_dict:
        existing = out.get("extra", "")
        if existing:
            try:
                merged = json.loads(existing)
                if isinstance(merged, dict):
                    merged.update(extra_dict)
                    out["extra"] = json.dumps(merged, ensure_ascii=False)
                else:
                    out["extra"] = json.dumps(extra_dict, ensure_ascii=False)
            except (json.JSONDecodeError, TypeError):
                out["extra"] = json.dumps(extra_dict, ensure_ascii=False)
        else:
            out["extra"] = json.dumps(extra_dict, ensure_ascii=False)

    # Trim text fields to prevent CSV bloat
    for text_col in ("sel_text", "answer"):
        if text_col in out and isinstance(out[text_col], str) and len(out[text_col]) > 500:
            out[text_col] = out[text_col][:500] + "…"

    return stream, out


# ────────────────────────────────────────────────────────────
# Public API: init
# ────────────────────────────────────────────────────────────

def init_telemetry(cfg: Mapping[str, Any]) -> None:
    """Initialise the telemetry subsystem (store config ref)."""
    global _CFG
    _CFG = dict(cfg or {})


# ────────────────────────────────────────────────────────────
# Public API: ingest
# ────────────────────────────────────────────────────────────

class IngestResult:
    """Summary of a batch ingest call."""

    __slots__ = ("accepted", "rejected", "per_stream")

    def __init__(self) -> None:
        self.accepted: int = 0
        self.rejected: int = 0
        self.per_stream: Dict[str, int] = {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "accepted": self.accepted,
            "rejected": self.rejected,
            "per_stream": dict(self.per_stream),
        }


def ingest_batch(user_id: str, events: List[Mapping[str, Any]]) -> IngestResult:
    """Ingest a batch of events into their respective CSVs.

    events: list of dicts, each must have a 'stream' key.
    Unknown streams are rejected (counted in result.rejected).
    """
    uid = str(user_id or "").strip()
    if not uid:
        raise ValueError("user_id is required")

    result = IngestResult()
    # Group by stream
    buckets: Dict[str, List[Dict[str, Any]]] = {}
    for raw in events:
        if not isinstance(raw, dict):
            result.rejected += 1
            continue
        pair = _normalise_event(raw)
        if pair is None:
            result.rejected += 1
            continue
        stream, row = pair
        buckets.setdefault(stream, []).append(row)

    for stream, rows in buckets.items():
        n = _append_rows(uid, stream, rows)
        result.accepted += n
        result.per_stream[stream] = result.per_stream.get(stream, 0) + n

    return result


# ────────────────────────────────────────────────────────────
# Public API: metadata
# ────────────────────────────────────────────────────────────

def list_streams(user_id: str) -> List[Dict[str, Any]]:
    """Return metadata for all registered streams, enriched with row counts."""
    uid = str(user_id or "").strip()
    out: List[Dict[str, Any]] = []
    for stream, schema in _STREAM_SCHEMAS.items():
        p = _csv_path(uid, stream) if uid else None
        row_count = 0
        if p and p.exists():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    row_count = max(0, sum(1 for _ in f) - 1)  # minus header
            except Exception:
                row_count = 0
        out.append({
            "stream": stream,
            "label": schema["label"],
            "columns": schema["columns"],
            "column_labels": schema.get("column_labels", {}),
            "row_count": row_count,
            "path": str(p) if p else "",
        })
    return out


def get_schema() -> Dict[str, Any]:
    """Return the full schema registry (no user-specific data)."""
    out = {}
    for stream, schema in _STREAM_SCHEMAS.items():
        out[stream] = {
            "label": schema["label"],
            "columns": schema["columns"],
            "column_labels": schema.get("column_labels", {}),
        }
    return out


# ────────────────────────────────────────────────────────────
# Public API: query
# ────────────────────────────────────────────────────────────

def query_stream(
    user_id: str,
    stream: str,
    *,
    limit: int = 2000,
    offset: int = 0,
    since_ts: Optional[int] = None,
    event_filter: Optional[str] = None,
) -> List[Dict[str, str]]:
    """Read rows from a telemetry CSV.

    - limit/offset: pagination
    - since_ts: only return rows with ts >= since_ts
    - event_filter: only return rows where event == event_filter (if CSV has 'event' column)
    """
    uid = str(user_id or "").strip()
    if not uid:
        raise ValueError("user_id is required")
    if not _is_known_stream(stream):
        raise ValueError(f"unknown stream: {stream}")

    p = _csv_path(uid, stream)
    if not p.exists():
        return []

    columns = _columns_for(stream)
    has_event = "event" in columns
    has_ts = "ts" in columns
    rows: List[Dict[str, str]] = []
    skipped = 0

    with open(p, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, fieldnames=columns)
        next(reader, None)  # skip header row
        for row in reader:
            # ts filter
            if has_ts and since_ts is not None:
                try:
                    if int(row.get("ts", "0") or "0") < since_ts:
                        continue
                except (ValueError, TypeError):
                    continue
            # event filter
            if has_event and event_filter:
                if str(row.get("event", "")).strip() != event_filter:
                    continue
            # pagination
            if skipped < offset:
                skipped += 1
                continue
            rows.append(dict(row))
            if len(rows) >= limit:
                break

    return rows


# ────────────────────────────────────────────────────────────
# Public API: aggregate helpers (for analysis / teacher view)
# ────────────────────────────────────────────────────────────

def query_reading_summary(
    user_id: str,
    book_id: str = "",
    *,
    since_ts: Optional[int] = None,
) -> Dict[str, Any]:
    """Return aggregated reading behaviour stats for a user (optionally scoped to a book).

    Output:
        total_events: int
        total_snapshots: int              (10-second heartbeat events → ~10s each)
        chapter_dwell: {ci: seconds}      estimated per-chapter reading time
        scroll_depth_max: {ci: float}     deepest scroll position per chapter
        selection_count: int              how many text selections were made
        focus_distribution: {reader|chat|blur: count}
    """
    uid = str(user_id or "").strip()
    p = _csv_path(uid, "reading")
    if not p.exists():
        return {"total_events": 0, "total_snapshots": 0, "chapter_dwell": {},
                "scroll_depth_max": {}, "selection_count": 0, "focus_distribution": {}}

    columns = _columns_for("reading")
    total = 0
    snapshots = 0
    selections = 0
    chapter_dwell: Dict[str, int] = {}      # ci -> seconds
    scroll_max: Dict[str, float] = {}       # ci -> max scroll
    focus_dist: Dict[str, int] = {}

    with open(p, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, fieldnames=columns)
        next(reader, None)
        for row in reader:
            bid = str(row.get("bid", "")).strip()
            if book_id and bid != book_id:
                continue
            ts_str = row.get("ts", "0")
            try:
                ts = int(ts_str)
            except (ValueError, TypeError):
                ts = 0
            if since_ts is not None and ts < since_ts:
                continue

            total += 1
            event = str(row.get("event", "")).strip()
            ci = str(row.get("ci", "-1")).strip()

            if event == "snapshot":
                snapshots += 1
                chapter_dwell[ci] = chapter_dwell.get(ci, 0) + 10  # ~10s per snapshot
            if event == "selection":
                selections += 1
            if event in ("scroll", "snapshot"):
                try:
                    s = float(row.get("scroll", "0") or "0")
                    if s > scroll_max.get(ci, 0):
                        scroll_max[ci] = s
                except (ValueError, TypeError):
                    pass

            focus = str(row.get("focus", "")).strip()
            if focus:
                focus_dist[focus] = focus_dist.get(focus, 0) + 1

    return {
        "total_events": total,
        "total_snapshots": snapshots,
        "chapter_dwell": chapter_dwell,
        "scroll_depth_max": scroll_max,
        "selection_count": selections,
        "focus_distribution": focus_dist,
    }


def query_annotation_summary(
    user_id: str,
    book_id: str = "",
    *,
    since_ts: Optional[int] = None,
) -> Dict[str, Any]:
    """Return aggregated annotation interaction stats."""
    uid = str(user_id or "").strip()
    p = _csv_path(uid, "annotation")
    if not p.exists():
        return {"total_events": 0, "ask_count": 0, "view_count": 0, "by_chapter": {}}

    columns = _columns_for("annotation")
    total = 0
    asks = 0
    views = 0
    by_chapter: Dict[str, Dict[str, int]] = {}

    with open(p, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, fieldnames=columns)
        next(reader, None)
        for row in reader:
            bid = str(row.get("bid", "")).strip()
            if book_id and bid != book_id:
                continue
            ts_str = row.get("ts", "0")
            try:
                ts = int(ts_str)
            except (ValueError, TypeError):
                ts = 0
            if since_ts is not None and ts < since_ts:
                continue

            total += 1
            event = str(row.get("event", "")).strip()
            ci = str(row.get("ci", "-1")).strip()
            chapter_entry = by_chapter.setdefault(ci, {"ask": 0, "view": 0})
            if event == "ask":
                asks += 1
                chapter_entry["ask"] += 1
            elif event in ("view", "dwell"):
                views += 1
                chapter_entry["view"] += 1

    return {"total_events": total, "ask_count": asks, "view_count": views, "by_chapter": by_chapter}


def query_question_summary(
    user_id: str,
    lecture_id: str = "",
    *,
    since_ts: Optional[int] = None,
) -> Dict[str, Any]:
    """Return aggregated question attempt stats."""
    uid = str(user_id or "").strip()
    p = _csv_path(uid, "question")
    if not p.exists():
        return {"total_attempts": 0, "correct": 0, "incorrect": 0, "unknown": 0,
                "by_difficulty": {}, "avg_duration_sec": 0.0}

    columns = _columns_for("question")
    total = 0
    correct = 0
    incorrect = 0
    unknown = 0
    dur_sum = 0.0
    dur_count = 0
    by_diff: Dict[str, Dict[str, int]] = {}

    with open(p, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, fieldnames=columns)
        next(reader, None)
        for row in reader:
            lid = str(row.get("lid", "")).strip()
            if lecture_id and lid != lecture_id:
                continue
            ts_str = row.get("ts", "0")
            try:
                ts = int(ts_str)
            except (ValueError, TypeError):
                ts = 0
            if since_ts is not None and ts < since_ts:
                continue

            total += 1
            diff = str(row.get("difficulty", "")).strip() or "unknown"
            diff_entry = by_diff.setdefault(diff, {"correct": 0, "incorrect": 0, "unknown": 0})

            is_c = str(row.get("is_correct", "-1")).strip()
            if is_c == "1":
                correct += 1
                diff_entry["correct"] += 1
            elif is_c == "0":
                incorrect += 1
                diff_entry["incorrect"] += 1
            else:
                unknown += 1
                diff_entry["unknown"] += 1

            dur_str = row.get("duration_sec", "")
            try:
                dur = float(dur_str)
                dur_sum += dur
                dur_count += 1
            except (ValueError, TypeError):
                pass

    return {
        "total_attempts": total,
        "correct": correct,
        "incorrect": incorrect,
        "unknown": unknown,
        "by_difficulty": by_diff,
        "avg_duration_sec": round(dur_sum / dur_count, 1) if dur_count else 0.0,
    }


# ────────────────────────────────────────────────────────────
# Flask routes
# ────────────────────────────────────────────────────────────

@telemetry_bp.route("/ingest", methods=["POST"])
def _route_ingest():
    """Batch ingest telemetry events.

    Body JSON:
        { "user_id": "...", "events": [ { "stream": "reading", ... }, ... ] }
        — or —
        [ { "stream": "reading", ... }, ... ]
        (user_id taken from session / query param / body field)
    """
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"success": False, "error": "JSON body required"}), 400

    # Accept both {user_id, events} and bare [events] with user_id from query
    if isinstance(data, list):
        user_id = str(request.args.get("user_id") or "").strip()
        events = data
    elif isinstance(data, dict):
        user_id = str(data.get("user_id") or request.args.get("user_id") or "").strip()
        raw_events = data.get("events") or data.get("data") or []
        events = raw_events if isinstance(raw_events, list) else [raw_events]
    else:
        return jsonify({"success": False, "error": "invalid body"}), 400

    if not user_id:
        return jsonify({"success": False, "error": "user_id is required"}), 400
    if not events:
        return jsonify({"success": True, "result": {"accepted": 0, "rejected": 0, "per_stream": {}}}), 200

    try:
        result = ingest_batch(user_id, events)
        return jsonify({"success": True, "result": result.to_dict()}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@telemetry_bp.route("/schema", methods=["GET"])
def _route_schema():
    """Return all registered stream schemas."""
    return jsonify({"success": True, "schema": get_schema()}), 200


@telemetry_bp.route("/<user_id>/streams", methods=["GET"])
def _route_list_streams(user_id: str):
    """Return stream metadata (with row counts) for a user."""
    try:
        rows = list_streams(user_id)
        return jsonify({"success": True, "streams": rows}), 200
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@telemetry_bp.route("/<user_id>/query/<stream>", methods=["GET"])
def _route_query(user_id: str, stream: str):
    """Query rows from a specific telemetry stream.

    Query params: limit, offset, since_ts, event
    """
    try:
        limit = int(request.args.get("limit", "2000"))
        offset = int(request.args.get("offset", "0"))
        since_ts_str = request.args.get("since_ts")
        since_ts = int(since_ts_str) if since_ts_str else None
        event_filter = request.args.get("event") or None
        rows = query_stream(user_id, stream, limit=limit, offset=offset,
                            since_ts=since_ts, event_filter=event_filter)
        return jsonify({"success": True, "rows": rows, "count": len(rows)}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@telemetry_bp.route("/<user_id>/summary/reading", methods=["GET"])
def _route_summary_reading(user_id: str):
    """Return aggregated reading behaviour summary."""
    try:
        book_id = request.args.get("book_id", "")
        since_ts_str = request.args.get("since_ts")
        since_ts = int(since_ts_str) if since_ts_str else None
        summary = query_reading_summary(user_id, book_id=book_id, since_ts=since_ts)
        return jsonify({"success": True, "summary": summary}), 200
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@telemetry_bp.route("/<user_id>/summary/annotation", methods=["GET"])
def _route_summary_annotation(user_id: str):
    """Return aggregated annotation interaction summary."""
    try:
        book_id = request.args.get("book_id", "")
        since_ts_str = request.args.get("since_ts")
        since_ts = int(since_ts_str) if since_ts_str else None
        summary = query_annotation_summary(user_id, book_id=book_id, since_ts=since_ts)
        return jsonify({"success": True, "summary": summary}), 200
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@telemetry_bp.route("/<user_id>/summary/question", methods=["GET"])
def _route_summary_question(user_id: str):
    """Return aggregated question attempt summary."""
    try:
        lecture_id = request.args.get("lecture_id", "")
        since_ts_str = request.args.get("since_ts")
        since_ts = int(since_ts_str) if since_ts_str else None
        summary = query_question_summary(user_id, lecture_id=lecture_id, since_ts=since_ts)
        return jsonify({"success": True, "summary": summary}), 200
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


# ────────────────────────────────────────────────────────────
# Public API: unified user analysis
# ────────────────────────────────────────────────────────────

def _collect_reading_events(user_id: str, book_id: str = "", since_ts: Optional[int] = None) -> List[Dict[str, Any]]:
    """Load raw reading events for analysis, returning dicts with float-parsed fields."""
    uid = str(user_id or "").strip()
    p = _csv_path(uid, "reading")
    if not p.exists():
        return []
    columns = _columns_for("reading")
    rows: List[Dict[str, Any]] = []
    with open(p, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, fieldnames=columns)
        next(reader, None)  # skip header
        for raw in reader:
            bid = str(raw.get("bid", "")).strip()
            if book_id and bid != book_id:
                continue
            ts_str = raw.get("ts", "0")
            try:
                ts = int(ts_str)
            except (ValueError, TypeError):
                ts = 0
            if since_ts is not None and ts < since_ts:
                continue
            rows.append({
                "ts": ts,
                "bid": bid,
                "ci_raw": raw.get("ci", ""),
                "si_raw": raw.get("si", ""),
                "event": str(raw.get("event", "")).strip(),
                "focus": str(raw.get("focus", "")).strip(),
                "scroll": raw.get("scroll", ""),
                "extra": raw.get("extra", ""),
            })
    return rows


def _compute_reading_analysis(events: List[Dict[str, Any]], *, idle_threshold_sec: int = 60) -> Dict[str, Any]:
    # --- helpers -----------------------------------------------------------
    def _ci_key(row: Dict[str, Any]) -> str:
        return str(row.get("ci_raw", "-1")).strip()

    # --- verified reader sessions -----------------------------------------
    # 只接收会话离开事件携带的明确 duration_ms；事件首末时间不能证明中间一直在学习。
    session_map: Dict[str, Dict[str, Any]] = {}
    unmeasured_session_events = 0

    for event in sorted(events, key=lambda row: row["ts"]):
        if event["event"] not in ("focus_out", "session_complete"):
            continue

        extra_text = str(event.get("extra") or "").strip()

        try:
            extra = json.loads(extra_text) if extra_text else {}
        except (json.JSONDecodeError, TypeError):
            extra = {}

        if not isinstance(extra, dict):
            extra = {}

        duration_ms = 0.0

        for key in ("duration_ms", "active_duration_ms"):
            try:
                candidate = float(extra.get(key) or 0)
            except (ValueError, TypeError):
                candidate = 0.0

            if candidate > 0:
                duration_ms = candidate
                break

        if duration_ms <= 0:
            unmeasured_session_events += 1
            continue

        session_key = str(extra.get("session_key") or "").strip()

        if not session_key:
            session_key = "|".join([
                str(event.get("bid") or "").strip(),
                str(event.get("ci_raw") or "").strip(),
                str(event.get("si_raw") or "").strip(),
                str(event.get("ts") or "").strip(),
                event["event"],
            ])

        duration_sec = duration_ms / 1000.0
        current = session_map.get(session_key)

        if current and float(current.get("duration_sec") or 0.0) >= duration_sec:
            continue

        session_map[session_key] = {
            "start_ts": int(event["ts"] - duration_ms),
            "end_ts": event["ts"],
            "duration_sec": round(duration_sec, 1),
            "bid": event.get("bid", ""),
            "ci_raw": event.get("ci_raw", ""),
        }

    sessions = sorted(session_map.values(), key=lambda row: row["start_ts"])

    # --- idle gaps ---------------------------------------------------------
    sorted_events = sorted(events, key=lambda r: r["ts"])
    idle_gaps: List[Dict[str, Any]] = []
    for i in range(1, len(sorted_events)):
        prev = sorted_events[i - 1]
        curr = sorted_events[i]
        gap_ms = curr["ts"] - prev["ts"]
        if gap_ms <= 0:
            continue
        gap_sec = gap_ms / 1000
        if gap_sec >= idle_threshold_sec:
            idle_gaps.append({
                "start_ts": prev["ts"],
                "end_ts": curr["ts"],
                "idle_sec": round(gap_sec, 1),
            })

    # --- scroll depth max per chapter (from scroll + snapshot events) ------
    scroll_max: Dict[str, float] = {}
    for e in events:
        if e["event"] not in ("scroll", "snapshot"):
            continue
        ci = _ci_key(e)
        try:
            s = float(e["scroll"] or "0")
        except (ValueError, TypeError):
            s = 0.0
        if s > scroll_max.get(ci, 0.0):
            scroll_max[ci] = s

    # --- selection events --------------------------------------------------
    selection_events = [e for e in events if e["event"] == "selection"]

    # --- per-chapter focus distribution & dwell proxy ----------------------
    chapter_focus: Dict[str, Dict[str, int]] = {}  # ci -> {focus -> count}
    snapshot_counts: Dict[str, int] = {}  # ci -> count (each ≈ 10 s)
    for e in events:
        ci = _ci_key(e)
        focus = e["focus"]
        if focus:
            chapter_focus.setdefault(ci, {})
            chapter_focus[ci][focus] = chapter_focus[ci].get(focus, 0) + 1
        if e["event"] == "snapshot":
            snapshot_counts[ci] = snapshot_counts.get(ci, 0) + 1

    chapter_dwell: Dict[str, float] = {ci: cnt * 10.0 for ci, cnt in snapshot_counts.items()}

    # --- totals -----------------------------------------------------------
    total_idle_sec = round(sum(g["idle_sec"] for g in idle_gaps), 1)
    total_reading_sec = round(sum(s["duration_sec"] for s in sessions), 1)

    return {
        "session_count": len(sessions),
        "sessions": sessions[:200],
        "unmeasured_session_events": unmeasured_session_events,
        "idle_gap_count": len(idle_gaps),
        "total_idle_sec": total_idle_sec,
        "idle_gaps": idle_gaps[:200],
        "total_reading_sec": total_reading_sec,
        "total_events": len(events),
        "scroll_depth_max": scroll_max,
        "selection_count": len(selection_events),
        "chapter_dwell": chapter_dwell,
        "chapter_focus": chapter_focus,
    }


def query_user_analysis(
    user_id: str,
    *,
    book_id: str = "",
    lecture_id: str = "",
    since_ts: Optional[int] = None,
    idle_threshold_sec: int = 60,
) -> Dict[str, Any]:
    """Unified per-user telemetry analysis across all streams."""
    uid = str(user_id or "").strip()

    reading_events = _collect_reading_events(uid, book_id=book_id, since_ts=since_ts)
    reading = _compute_reading_analysis(reading_events, idle_threshold_sec=idle_threshold_sec)

    annotation = query_annotation_summary(uid, book_id=book_id, since_ts=since_ts)
    question = query_question_summary(uid, lecture_id=lecture_id, since_ts=since_ts)

    return {
        "user_id": uid,
        "params": {
            "book_id": book_id or None,
            "lecture_id": lecture_id or None,
            "since_ts": since_ts,
            "idle_threshold_sec": idle_threshold_sec,
        },
        "reading": reading,
        "annotation": annotation,
        "question": question,
    }


# ────────────────────────────────────────────────────────────
# Auth helper (minimal, avoids circular import with routes.py)
# ────────────────────────────────────────────────────────────

def _current_user_id() -> str:
    """Best-effort resolution of the current request user from the proxy session."""
    from flask import request as _req  # already imported, alias for clarity
    candidate_headers = (
        "X-Nexora-Username",
        "X-Username",
        "X-User",
        "X-User-Id",
        "X-Auth-User",
        "X-Forwarded-User",
    )
    for h in candidate_headers:
        v = str(_req.headers.get(h) or "").strip()
        if v:
            return v
    return ""


def _current_is_admin() -> bool:
    """Best-effort admin check without importing routes (avoids circular deps).

    On first call we lazily initialise a static NexoraProxy to resolve the session user.
    """
    uid = _current_user_id()
    if not uid:
        try:
            import urllib.request, urllib.error, json, urllib.parse  # noqa: local import
            base_url = str(_CFG.get("nexora", {}).get("base_url") or "").rstrip("/")
            api_key = str(_CFG.get("nexora", {}).get("api_key") or "").strip()
            if base_url:
                req = urllib.request.Request(f"{base_url}/api/user/info", method="GET")
                if api_key:
                    req.add_header("Authorization", f"Bearer {api_key}")
                    req.add_header("X-API-Key", api_key)
                try:
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        data = json.loads(resp.read().decode("utf-8", errors="replace"))
                        if isinstance(data, dict) and data.get("success"):
                            user = data.get("user") or {}
                            uid = str(user.get("id") or user.get("username") or "").strip()
                            return str(user.get("role") or "").strip().lower() == "admin"
                except Exception:
                    pass
        except Exception:
            pass
    return False


@telemetry_bp.route("/<user_id>/analysis", methods=["GET"])
def _route_analysis(user_id: str):
    """Unified per-user telemetry analysis endpoints.

    Access: admin OR the user themself.

    Query params:
        book_id      – scope reading annotation to a specific book
        lecture_id   – scope questions to a lecture
        since_ts     – only include events after this millisecond timestamp
        idle_threshold_sec – gap (seconds) considered idle, default 60
    """
    try:
        target_uid = str(user_id or "").strip()
        if not target_uid:
            return jsonify({"success": False, "error": "user_id is required"}), 400

        current_uid = _current_user_id()
        is_admin = False
        if current_uid == target_uid:
            pass  # self-access, no further check
        else:
            is_admin = _current_is_admin()
            if not is_admin:
                return jsonify({"success": False, "error": "Only admin or the user themself can access this endpoint."}), 403

        # Parse params
        book_id      = str(request.args.get("book_id", "")).strip()
        lecture_id   = str(request.args.get("lecture_id", "")).strip()
        since_ts_str = request.args.get("since_ts")
        since_ts     = int(since_ts_str) if since_ts_str else None
        idle_threshold_sec = int(request.args.get("idle_threshold_sec", "60") or "60")

        analysis = query_user_analysis(
            target_uid,
            book_id=book_id,
            lecture_id=lecture_id,
            since_ts=since_ts,
            idle_threshold_sec=idle_threshold_sec,
        )
        return jsonify({"success": True, "analysis": analysis}), 200
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500
