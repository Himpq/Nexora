"""booksproc in-memory shared state.

This module centralizes queue/process/progress memory so manager.py can
focus on orchestration instead of owning all globals directly.
"""

from __future__ import annotations

import json
import threading
from collections import deque
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Mapping

LOCK = threading.RLock()
QUEUE: Deque[Dict[str, Any]] = deque()
JOBS: Dict[str, Dict[str, Any]] = {}
CANCELLED_KEYS: set[str] = set()
WORKER: Optional[threading.Thread] = None
RUNNING = False
CFG: Dict[str, Any] = {}
TEMPMEM: Dict[str, List[str]] = {}
BOOK_PROGRESS: Dict[str, str] = {}
BOOK_PROGRESS_STEPS: Dict[str, List[Dict[str, Any]]] = {}
READ_PROGRESS: Dict[str, Dict[str, int]] = {}
MODEL_TEXT_PREVIEW_LIMIT = 4000


def job_key(lecture_id: str, book_id: str) -> str:
    """Stable in-memory key for one lecture/book pipeline."""
    return f"{str(lecture_id or '').strip()}::{str(book_id or '').strip()}"


def _book_json_path(lecture_id: str, book_id: str) -> Path:
    data_dir = Path(str(CFG.get("data_dir") or "data")).resolve()
    return data_dir / "lectures" / lecture_id / "books" / book_id / "book.json"


def _is_model_text_step(step: Mapping[str, Any]) -> bool:
    return str(step.get("type") or "").strip() == "model_text"


def _model_text_merge_key(step: Mapping[str, Any]) -> str:
    return str(step.get("merge_key") or "").strip()


def _can_merge_model_text_step(previous: Mapping[str, Any], current: Mapping[str, Any]) -> bool:
    if not (_is_model_text_step(previous) and _is_model_text_step(current)):
        return False

    previous_key = _model_text_merge_key(previous)
    current_key = _model_text_merge_key(current)

    if previous_key or current_key:
        return previous_key == current_key

    return True


def _merge_model_text_preview(previous: str, current: str) -> str:
    merged = f"{str(previous or '')}{str(current or '')}"

    if len(merged) <= MODEL_TEXT_PREVIEW_LIMIT:
        return merged

    return merged[-MODEL_TEXT_PREVIEW_LIMIT:]


def _coalesce_progress_steps(steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Merge streaming model deltas into one visible model activity row."""
    merged_steps: List[Dict[str, Any]] = []

    for step in steps:
        row = dict(step or {})

        if merged_steps and _can_merge_model_text_step(merged_steps[-1], row):
            previous = merged_steps[-1]
            previous["preview"] = _merge_model_text_preview(
                str(previous.get("preview") or ""),
                str(row.get("preview") or ""),
            )
            previous["title"] = str(previous.get("title") or row.get("title") or "模型输出")
            continue

        merged_steps.append(row)

    return merged_steps


def _append_progress_step(bucket: List[Dict[str, Any]], row: Dict[str, Any]) -> None:
    # 模型正文是流式 delta，连续片段应当更新同一条活动记录。
    if bucket and _can_merge_model_text_step(bucket[-1], row):
        bucket[-1]["preview"] = _merge_model_text_preview(
            str(bucket[-1].get("preview") or ""),
            str(row.get("preview") or ""),
        )
        bucket[-1]["title"] = str(bucket[-1].get("title") or row.get("title") or "模型输出")
        return

    bucket.append(row)


def _save_steps_to_book(lecture_id: str, book_id: str, steps: List[Dict[str, Any]]) -> None:
    """Persist progress steps to book.json."""
    path = _book_json_path(lecture_id, book_id)
    if not path.exists():
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        data["progress_steps"] = _coalesce_progress_steps(steps)[-30:]
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def _load_steps_from_book(lecture_id: str, book_id: str) -> List[Dict[str, Any]]:
    """Load persisted progress steps from book.json."""
    path = _book_json_path(lecture_id, book_id)
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        steps = data.get("progress_steps")
        if isinstance(steps, list):
            return _coalesce_progress_steps([dict(s) for s in steps if isinstance(s, dict)])
    except Exception:
        pass
    return []


def set_book_progress(lecture_id: str, book_id: str, text: str) -> None:
    """Update one book's short progress line. Persists steps on clear."""
    key = job_key(lecture_id, book_id)
    value = str(text or "").strip()
    with LOCK:
        if value:
            BOOK_PROGRESS[key] = value
        else:
            BOOK_PROGRESS.pop(key, None)
            # Persist steps before clearing from memory
            steps = BOOK_PROGRESS_STEPS.pop(key, None)
            if steps:
                _save_steps_to_book(lecture_id, book_id, steps)


def flush_book_progress_steps(lecture_id: str, book_id: str) -> None:
    """Persist current in-memory steps to disk without clearing."""
    key = job_key(lecture_id, book_id)
    with LOCK:
        steps = list(BOOK_PROGRESS_STEPS.get(key) or [])
        if steps:
            _save_steps_to_book(lecture_id, book_id, steps)


def get_book_progress_text(lecture_id: str, book_id: str) -> str:
    """Read one book's short progress line."""
    with LOCK:
        return str(BOOK_PROGRESS.get(job_key(lecture_id, book_id)) or "")


def push_book_progress_step(lecture_id: str, book_id: str, step: Dict[str, Any]) -> None:
    """Append one UI-visible progress/toolchain step."""
    key = job_key(lecture_id, book_id)
    row = dict(step or {})
    with LOCK:
        bucket = BOOK_PROGRESS_STEPS.setdefault(key, [])
        _append_progress_step(bucket, row)
        if len(bucket) > 60:
            del bucket[:-60]


def push_model_output(lecture_id: str, book_id: str, content: str) -> None:
    """推送模型文本输出到活动日志（统一接口）"""
    if not content or not content.strip():
        return
    push_book_progress_step(lecture_id, book_id, {
        "type": "model_text",
        "title": "模型输出",
        "preview": content[:200],
    })


def push_tool_call(lecture_id: str, book_id: str, tool_name: str, title: str, preview: str = "") -> None:
    """推送工具调用到活动日志（统一接口）"""
    push_book_progress_step(lecture_id, book_id, {
        "type": tool_name,
        "title": title,
        "preview": str(preview or "")[:100],
    })


def get_book_progress_steps(lecture_id: str, book_id: str) -> List[Dict[str, Any]]:
    """Return a copy of progress steps. Falls back to persisted book.json."""
    with LOCK:
        memory_steps = BOOK_PROGRESS_STEPS.get(job_key(lecture_id, book_id))
        if memory_steps:
            return _coalesce_progress_steps([dict(item) for item in memory_steps])
    # Fallback: load from disk
    return _load_steps_from_book(lecture_id, book_id)


def update_job(job_id: str, patch: Dict[str, Any]) -> None:
    """Atomically patch one queued/running job row."""
    with LOCK:
        if not job_id or job_id not in JOBS:
            return
        JOBS[job_id].update(dict(patch or {}))


def is_cancelled_key(key: str) -> bool:
    """Check whether one book pipeline has been marked cancelled."""
    with LOCK:
        return key in CANCELLED_KEYS


def clear_cancelled_key(key: str) -> None:
    """Clear cancellation mark for one book pipeline."""
    with LOCK:
        CANCELLED_KEYS.discard(str(key or ""))


def get_queue_snapshot() -> Dict[str, Any]:
    """Return current queue/jobs snapshot for admin/frontend."""
    with LOCK:
        queued = [dict(item) for item in list(QUEUE)]
        jobs = sorted(
            (dict(item) for item in JOBS.values()),
            key=lambda row: int(row.get("created_at") or 0),
            reverse=True,
        )
        running_count = 0
        for row in JOBS.values():
            if str((row or {}).get("status") or "").strip().lower() == "running":
                running_count += 1
    return {
        "queue_size": len(queued),
        "running_count": int(running_count),
        "queued_jobs": queued,
        "jobs": jobs[:120],
    }
