"""booksproc queue/runtime orchestration helpers.

This module owns queue lifecycle, enqueue/cancel operations, and worker
thread startup. Business updates (book status, logs, model execution)
stay in manager.py.
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any, Callable, Dict, Mapping, Optional

from . import state


def init_booksproc_queue(
    cfg: Mapping[str, Any],
    *,
    run_job: Callable[[Dict[str, Any]], None],
    log_event: Callable[..., None],
    worker_name: str = "NXLBooksProcQueue",
    poll_interval: float = 0.35,
) -> None:
    """Initialize background queue worker once."""
    with state.LOCK:
        if cfg is not state.CFG:
            new_cfg = dict(cfg or {})
            state.CFG.clear()
            state.CFG.update(new_cfg)
        if state.RUNNING and state.WORKER and state.WORKER.is_alive():
            return
        state.RUNNING = True
        state.WORKER = threading.Thread(
            target=lambda: worker_loop(run_job=run_job, poll_interval=poll_interval),
            name=worker_name,
            daemon=True,
        )
        state.WORKER.start()
    log_event("booksproc_start", "教材处理队列已启动", payload={"worker": worker_name})


def worker_loop(*, run_job: Callable[[Dict[str, Any]], None], poll_interval: float = 0.35) -> None:
    """Poll queued jobs and dispatch them to the manager callback."""
    while state.RUNNING:
        job: Optional[Dict[str, Any]] = None
        with state.LOCK:
            if state.QUEUE:
                job = state.QUEUE.popleft()
        if not job:
            time.sleep(float(poll_interval or 0.35))
            continue
        run_job(dict(job))


def enqueue_job(
    lecture_id: str,
    book_id: str,
    *,
    actor: str = "",
    force: bool = False,
    job_type: str = "coarse",
    model_name: str = "",
) -> Dict[str, Any]:
    """Append one job to the in-memory queue unless a queued duplicate exists."""
    lecture_key = str(lecture_id or "").strip()
    book_key = str(book_id or "").strip()
    key = state.job_key(lecture_key, book_key)
    with state.LOCK:
        state.CANCELLED_KEYS.discard(key)
        duplicate = next(
            (
                item
                for item in state.QUEUE
                if str(item.get("lecture_id") or "") == lecture_key
                and str(item.get("book_id") or "") == book_key
            ),
            None,
        )
        if duplicate:
            return {
                "success": True,
                "queued": True,
                "job": dict(state.JOBS.get(str(duplicate.get("job_id") or ""), {})),
                "duplicate": True,
            }

        now = int(time.time())
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        job: Dict[str, Any] = {
            "job_id": job_id,
            "lecture_id": lecture_key,
            "book_id": book_key,
            "actor": str(actor or "").strip(),
            "force": bool(force),
            "status": "queued",
            "job_type": str(job_type or "coarse").strip().lower() or "coarse",
            "model_name": str(model_name or "").strip(),
            "created_at": now,
            "started_at": None,
            "finished_at": None,
            "error": "",
        }
        state.JOBS[job_id] = job
        state.QUEUE.append(job)
    return {"success": True, "queued": True, "job": dict(job), "duplicate": False}


def cancel_job(lecture_id: str, book_id: str) -> Dict[str, Any]:
    """Cancel queued/running jobs for one lecture/book pair."""
    lecture_key = str(lecture_id or "").strip()
    book_key = str(book_id or "").strip()
    key = state.job_key(lecture_key, book_key)
    now = int(time.time())
    removed = 0
    cancelled_jobs = []
    with state.LOCK:
        state.CANCELLED_KEYS.add(key)
        remained = []
        while state.QUEUE:
            item = state.QUEUE.popleft()
            if state.job_key(str(item.get("lecture_id") or ""), str(item.get("book_id") or "")) == key:
                removed += 1
                jid = str(item.get("job_id") or "").strip()
                if jid and jid in state.JOBS:
                    state.JOBS[jid].update({"status": "cancelled", "finished_at": now, "error": "cancelled by admin"})
                    cancelled_jobs.append(jid)
                continue
            remained.append(item)
        state.QUEUE.extend(remained)
        for jid, row in state.JOBS.items():
            if state.job_key(str(row.get("lecture_id") or ""), str(row.get("book_id") or "")) != key:
                continue
            status = str(row.get("status") or "").strip().lower()
            if status in {"running", "queued"}:
                row.update({"status": "cancelled", "finished_at": now, "error": "cancelled by admin"})
                if jid not in cancelled_jobs:
                    cancelled_jobs.append(jid)
    return {"removed": removed, "cancelled_jobs": cancelled_jobs}


def get_queue_snapshot() -> Dict[str, Any]:
    """Expose current queue/jobs snapshot."""
    return state.get_queue_snapshot()
