import json
import os
import threading
import time
from copy import deepcopy
from typing import Any, Dict, List

from basis.Database import get_path_lock, safe_append_jsonl, safe_read_json, safe_read_jsonl_tail, safe_write_json


USAGE_LOG_FILENAMES = {
    "token_usage.json",
    "tool_usage.json",
}
USAGE_LOG_MAX_RECORDS = {
    "token_usage.json": 1000,
    "tool_usage.json": 5000,
}
USAGE_LOG_COMPACT_SIZE_BYTES = {
    "token_usage.json": 512 * 1024,
    "tool_usage.json": 1024 * 1024,
}
USAGE_LOG_COMPACT_MIN_INTERVAL_SEC = 60.0
_USAGE_LOG_READ_CACHE: Dict[str, Dict[str, Any]] = {}
_USAGE_LOG_READ_CACHE_LOCK = threading.Lock()
_USAGE_LOG_COMPACT_STATE: Dict[str, Dict[str, Any]] = {}
_USAGE_LOG_COMPACT_LOCK = threading.Lock()


def _file_stat(path: str) -> tuple:
    try:
        stat = os.stat(path)
        return int(stat.st_mtime_ns), int(stat.st_size)
    except OSError:
        return 0, 0


def _cache_key(json_path: str) -> str:
    return os.path.normpath(os.path.abspath(str(json_path or "").strip()))


def _combined_stat(json_path: str) -> tuple:
    return _file_stat(json_path), _file_stat(usage_jsonl_path(json_path))


def usage_jsonl_path(json_path: str) -> str:
    path = str(json_path or "").strip()

    if path.endswith(".json"):
        return path[:-5] + ".jsonl"

    return f"{path}.jsonl"


def is_usage_log_path(path: str) -> bool:
    return os.path.basename(str(path or "").strip()) in USAGE_LOG_FILENAMES


def append_usage_log_record(json_path: str, record: Dict[str, Any]) -> None:
    if not isinstance(record, dict):
        raise ValueError("usage log record must be a dict")

    safe_append_jsonl(usage_jsonl_path(json_path), record)
    maybe_compact_usage_log_async(json_path)


def _read_jsonl_records(path: str, limit: int = 0) -> List[Dict[str, Any]]:
    if not os.path.exists(path):
        return []

    if limit and limit > 0:
        rows = safe_read_jsonl_tail(path, limit=limit)
        return [row for row in rows if isinstance(row, dict)]

    rows: List[Dict[str, Any]] = []

    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            for line in f:
                text = str(line or "").strip()

                if not text:
                    continue

                try:
                    row = json.loads(text)
                except Exception:
                    continue

                if isinstance(row, dict):
                    rows.append(row)
    except Exception:
        return []

    rows.reverse()

    return rows


def _read_legacy_json_records(path: str) -> List[Dict[str, Any]]:
    data = safe_read_json(path, default=[])

    if not isinstance(data, list):
        return []

    return [row for row in data if isinstance(row, dict)]


def read_usage_log_records(json_path: str, limit: int = 0) -> List[Dict[str, Any]]:
    if not limit or limit <= 0:
        key = _cache_key(json_path)
        current_stat = _combined_stat(json_path)

        with _USAGE_LOG_READ_CACHE_LOCK:
            cached = _USAGE_LOG_READ_CACHE.get(key)

            if isinstance(cached, dict) and cached.get("stat") == current_stat:
                return deepcopy(cached.get("rows", []))

    jsonl_path = usage_jsonl_path(json_path)
    live_rows = _read_jsonl_records(jsonl_path, limit=limit)

    if limit and limit > 0 and len(live_rows) >= limit:
        return live_rows[:limit]

    legacy_rows = _read_legacy_json_records(json_path)
    rows = live_rows + legacy_rows

    if limit and limit > 0:
        return rows[:limit]

    with _USAGE_LOG_READ_CACHE_LOCK:
        _USAGE_LOG_READ_CACHE[_cache_key(json_path)] = {
            "stat": _combined_stat(json_path),
            "rows": deepcopy(rows),
        }

    return rows


def _invalidate_usage_log_cache(json_path: str) -> None:
    with _USAGE_LOG_READ_CACHE_LOCK:
        _USAGE_LOG_READ_CACHE.pop(_cache_key(json_path), None)


def replace_usage_log_records(json_path: str, records: List[Dict[str, Any]], indent: int = 4) -> None:
    payload = [row for row in records if isinstance(row, dict)]
    jsonl_path = usage_jsonl_path(json_path)

    with get_path_lock(json_path):
        with get_path_lock(jsonl_path):
            safe_write_json(json_path, payload, indent=indent)

            if os.path.exists(jsonl_path):
                with open(jsonl_path, "w", encoding="utf-8") as f:
                    f.write("")

            _invalidate_usage_log_cache(json_path)


def _usage_log_max_records(json_path: str) -> int:
    basename = os.path.basename(str(json_path or "").strip())

    return int(USAGE_LOG_MAX_RECORDS.get(basename, 2000))


def _usage_log_compact_size_bytes(json_path: str) -> int:
    basename = os.path.basename(str(json_path or "").strip())

    return int(USAGE_LOG_COMPACT_SIZE_BYTES.get(basename, 512 * 1024))


def _compact_usage_log_records(json_path: str, max_records: int) -> Dict[str, Any]:
    path = str(json_path or "").strip()
    jsonl_path = usage_jsonl_path(path)
    limit = max(1, int(max_records or _usage_log_max_records(path)))

    with get_path_lock(path):
        with get_path_lock(jsonl_path):
            live_rows = _read_jsonl_records(jsonl_path)
            legacy_rows = _read_legacy_json_records(path)
            merged_rows = (live_rows + legacy_rows)[:limit]
            safe_write_json(path, merged_rows, indent=4)

            if os.path.exists(jsonl_path):
                with open(jsonl_path, "w", encoding="utf-8") as f:
                    f.write("")

            _invalidate_usage_log_cache(path)

            return {
                "json_path": path,
                "jsonl_path": jsonl_path,
                "live_count": len(live_rows),
                "legacy_count": len(legacy_rows),
                "kept_count": len(merged_rows),
            }


def compact_usage_log_records(json_path: str, max_records: int = 0) -> Dict[str, Any]:
    return _compact_usage_log_records(json_path, max_records or _usage_log_max_records(json_path))


def maybe_compact_usage_log_async(json_path: str) -> bool:
    path = str(json_path or "").strip()

    if not is_usage_log_path(path):
        return False

    jsonl_path = usage_jsonl_path(path)
    _, jsonl_size = _file_stat(jsonl_path)

    if jsonl_size < _usage_log_compact_size_bytes(path):
        return False

    key = _cache_key(path)
    now = time.time()

    with _USAGE_LOG_COMPACT_LOCK:
        state = _USAGE_LOG_COMPACT_STATE.setdefault(key, {})

        if bool(state.get("running", False)):
            return False

        last_started = float(state.get("last_started", 0.0) or 0.0)

        if now - last_started < USAGE_LOG_COMPACT_MIN_INTERVAL_SEC:
            return False

        state["running"] = True
        state["last_started"] = now

    def _runner() -> None:
        try:
            _compact_usage_log_records(path, _usage_log_max_records(path))
        finally:
            with _USAGE_LOG_COMPACT_LOCK:
                state = _USAGE_LOG_COMPACT_STATE.setdefault(key, {})
                state["running"] = False
                state["last_finished"] = time.time()

    thread = threading.Thread(target=_runner, daemon=True, name=f"usage-log-compact-{os.path.basename(path)}")
    thread.start()

    return True
