"""booksproc in-memory shared state.

This module centralizes queue/process/progress memory so manager.py can
focus on orchestration instead of owning all globals directly.
"""

from __future__ import annotations

import threading
from collections import deque
from typing import Any, Deque, Dict, List, Optional

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


def job_key(lecture_id: str, book_id: str) -> str:
    """Stable in-memory key for one lecture/book pipeline."""
    return f"{str(lecture_id or '').strip()}::{str(book_id or '').strip()}"


def set_book_progress(lecture_id: str, book_id: str, text: str) -> None:
    """Update one book's short progress line."""
    key = job_key(lecture_id, book_id)
    value = str(text or "").strip()
    with LOCK:
        if value:
            BOOK_PROGRESS[key] = value
        else:
            BOOK_PROGRESS.pop(key, None)
            BOOK_PROGRESS_STEPS.pop(key, None)


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
        bucket.append(row)
        if len(bucket) > 60:
            del bucket[:-60]


def get_book_progress_steps(lecture_id: str, book_id: str) -> List[Dict[str, Any]]:
    """Return a copy of progress steps for frontend rendering."""
    with LOCK:
        return [dict(item) for item in (BOOK_PROGRESS_STEPS.get(job_key(lecture_id, book_id)) or [])]


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
