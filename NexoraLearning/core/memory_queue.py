"""Learning memory/profile analysis queue.

This queue is keyed by (user_id, lecture_id) and is independent from booksproc.
It is used for:
1. periodic user/lecture memory profile analysis
2. learning-mode context overflow compression + analysis
"""

from __future__ import annotations

import json
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, Optional

from .runlog import log_event

_LOCK = threading.RLock()
_CFG: Dict[str, Any] = {}
_QUEUE: List[Dict[str, Any]] = []
_JOBS: Dict[str, Dict[str, Any]] = {}
_RUNNING_KEYS: Dict[str, str] = {}
_WORKER: Optional[threading.Thread] = None
_RUN_JOB: Optional[Callable[[Mapping[str, Any], Mapping[str, Any]], None]] = None


def _data_dir(cfg: Mapping[str, Any]) -> Path:
    return Path(str((cfg or {}).get("data_dir") or "data"))


def _memory_state_path(cfg: Mapping[str, Any]) -> Path:
    return _data_dir(cfg) / "memory_queue_state.json"


def _memory_lock_key(user_id: str, lecture_id: str) -> str:
    return f"{str(user_id or '').strip()}::{str(lecture_id or '').strip()}"


def _lecture_state_key(user_id: str, lecture_id: str) -> str:
    return _memory_lock_key(user_id, lecture_id)


def _now_ts() -> int:
    return int(time.time())


def _default_lecture_state(user_id: str, lecture_id: str) -> Dict[str, Any]:
    return {
        "user_id": str(user_id or "").strip(),
        "lecture_id": str(lecture_id or "").strip(),
        "turns_since_last_analysis": 0,
        "total_turns": 0,
        "last_analysis_at": 0,
        "last_analysis_reason": "",
        "last_job_id": "",
        "last_context_compression_at": 0,
    }


def _load_state(cfg: Mapping[str, Any]) -> Dict[str, Any]:
    path = _memory_state_path(cfg)
    if not path.exists():
        return {"lectures": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"lectures": {}}
    if not isinstance(data, dict):
        return {"lectures": {}}
    if not isinstance(data.get("lectures"), dict):
        data["lectures"] = {}
    return data


def _save_state(cfg: Mapping[str, Any], payload: Mapping[str, Any]) -> None:
    path = _memory_state_path(cfg)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(dict(payload or {}), ensure_ascii=False, indent=2), encoding="utf-8")


def get_memory_state(cfg: Mapping[str, Any], user_id: str, lecture_id: str) -> Dict[str, Any]:
    state = _load_state(cfg)
    lectures = state.get("lectures") if isinstance(state.get("lectures"), dict) else {}
    key = _lecture_state_key(user_id, lecture_id)
    row = lectures.get(key)
    if isinstance(row, dict):
        return dict(row)
    return _default_lecture_state(user_id, lecture_id)


def update_memory_state(cfg: Mapping[str, Any], user_id: str, lecture_id: str, updates: Mapping[str, Any]) -> Dict[str, Any]:
    with _LOCK:
        state = _load_state(cfg)
        lectures = state.get("lectures")
        if not isinstance(lectures, dict):
            lectures = {}
            state["lectures"] = lectures
        key = _lecture_state_key(user_id, lecture_id)
        current = get_memory_state(cfg, user_id, lecture_id)
        current.update(dict(updates or {}))
        current["user_id"] = str(user_id or "").strip()
        current["lecture_id"] = str(lecture_id or "").strip()
        lectures[key] = current
        _save_state(cfg, state)
        return dict(current)


def increment_learning_turn(cfg: Mapping[str, Any], user_id: str, lecture_id: str) -> Dict[str, Any]:
    current = get_memory_state(cfg, user_id, lecture_id)
    return update_memory_state(
        cfg,
        user_id,
        lecture_id,
        {
            "total_turns": int(current.get("total_turns", 0) or 0) + 1,
            "turns_since_last_analysis": int(current.get("turns_since_last_analysis", 0) or 0) + 1,
        },
    )


def mark_analysis_completed(cfg: Mapping[str, Any], user_id: str, lecture_id: str, *, job_id: str, reason: str) -> Dict[str, Any]:
    return update_memory_state(
        cfg,
        user_id,
        lecture_id,
        {
            "turns_since_last_analysis": 0,
            "last_analysis_at": _now_ts(),
            "last_analysis_reason": str(reason or "").strip(),
            "last_job_id": str(job_id or "").strip(),
        },
    )


def mark_context_compression_completed(cfg: Mapping[str, Any], user_id: str, lecture_id: str, *, job_id: str = "") -> Dict[str, Any]:
    current = get_memory_state(cfg, user_id, lecture_id)
    updated = update_memory_state(
        cfg,
        user_id,
        lecture_id,
        {
            "last_context_compression_at": _now_ts(),
            "last_job_id": str(job_id or "").strip() or str(current.get("last_job_id") or "").strip(),
        },
    )
    log_event(
        "memory_context_compression_marked",
        "Learning context compression was marked.",
        payload={
            "user_id": str(user_id or "").strip(),
            "lecture_id": str(lecture_id or "").strip(),
            "job_id": str(job_id or "").strip(),
            "last_context_compression_at": int(updated.get("last_context_compression_at", 0) or 0),
        },
    )
    return updated


def init_memory_queue(cfg: Mapping[str, Any], *, run_job: Callable[[Mapping[str, Any], Mapping[str, Any]], None]) -> None:
    global _CFG, _RUN_JOB, _WORKER
    _CFG.clear()
    _CFG.update(dict(cfg or {}))
    _RUN_JOB = run_job
    if _WORKER is not None and _WORKER.is_alive():
        return
    worker = threading.Thread(target=_worker_loop, name="NexoraLearningMemoryQueue", daemon=True)
    _WORKER = worker
    worker.start()


def _worker_loop() -> None:
    while True:
        job: Optional[Dict[str, Any]] = None
        with _LOCK:
            if _QUEUE:
                job = _QUEUE.pop(0)
                job_id = str(job.get("job_id") or "").strip()
                if job_id and isinstance(_JOBS.get(job_id), dict):
                    _JOBS[job_id]["status"] = "running"
                    _JOBS[job_id]["started_at"] = _now_ts()
                    _RUNNING_KEYS[_memory_lock_key(str(job.get("user_id") or ""), str(job.get("lecture_id") or ""))] = job_id
        if not job:
            time.sleep(0.2)
            continue

        job_id = str(job.get("job_id") or "").strip()
        try:
            if _RUN_JOB is None:
                raise RuntimeError("memory queue runner not initialized")
            log_event(
                "memory_job_start",
                "Memory analysis job started.",
                payload={
                    "job_id": job_id,
                    "user_id": str(job.get("user_id") or "").strip(),
                    "lecture_id": str(job.get("lecture_id") or "").strip(),
                    "reason": str(job.get("reason") or "").strip(),
                },
            )
            _RUN_JOB(dict(_CFG), dict(job))
            with _LOCK:
                if job_id and isinstance(_JOBS.get(job_id), dict):
                    _JOBS[job_id]["status"] = "done"
                    _JOBS[job_id]["finished_at"] = _now_ts()
        except Exception as exc:
            error_details = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)).strip()
            with _LOCK:
                if job_id and isinstance(_JOBS.get(job_id), dict):
                    _JOBS[job_id]["status"] = "error"
                    _JOBS[job_id]["finished_at"] = _now_ts()
                    _JOBS[job_id]["error"] = str(exc)
                    _JOBS[job_id]["traceback"] = error_details
            print(
                f"[LEARNING_MEMORY][WORKER_ERROR] job={job_id} "
                f"user={str(job.get('user_id') or '').strip()} "
                f"lecture={str(job.get('lecture_id') or '').strip()} "
                f"reason={str(job.get('reason') or '').strip()} "
                f"error={exc}"
            )
            log_event(
                "memory_job_error",
                "Memory analysis job failed.",
                payload={
                    "job_id": job_id,
                    "user_id": str(job.get("user_id") or "").strip(),
                    "lecture_id": str(job.get("lecture_id") or "").strip(),
                    "reason": str(job.get("reason") or "").strip(),
                    "error": str(exc),
                },
                content=error_details or str(exc),
            )
        finally:
            with _LOCK:
                key = _memory_lock_key(str(job.get("user_id") or ""), str(job.get("lecture_id") or ""))
                if _RUNNING_KEYS.get(key) == job_id:
                    _RUNNING_KEYS.pop(key, None)


def enqueue_memory_job(
    cfg: Mapping[str, Any],
    *,
    user_id: str,
    lecture_id: str,
    reason: str,
    payload: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    resolved_user_id = str(user_id or "").strip()
    resolved_lecture_id = str(lecture_id or "").strip()
    if not resolved_user_id:
        raise ValueError("user_id is required")
    if not resolved_lecture_id:
        raise ValueError("lecture_id is required")
    reason_text = str(reason or "").strip() or "manual"
    key = _memory_lock_key(resolved_user_id, resolved_lecture_id)
    with _LOCK:
        running_job_id = _RUNNING_KEYS.get(key)
        if running_job_id and isinstance(_JOBS.get(running_job_id), dict):
            return {
                "queued": False,
                "job_id": running_job_id,
                "status": str(_JOBS[running_job_id].get("status") or "running"),
                "deduped": True,
            }
        for row in _QUEUE:
            if _memory_lock_key(str(row.get("user_id") or ""), str(row.get("lecture_id") or "")) == key:
                return {
                    "queued": False,
                    "job_id": str(row.get("job_id") or "").strip(),
                    "status": "queued",
                    "deduped": True,
                }
        job_id = f"mem_{uuid.uuid4().hex[:12]}"
        job = {
            "job_id": job_id,
            "user_id": resolved_user_id,
            "lecture_id": resolved_lecture_id,
            "reason": reason_text,
            "payload": dict(payload or {}),
            "status": "queued",
            "created_at": _now_ts(),
        }
        _QUEUE.append(job)
        _JOBS[job_id] = dict(job)

    update_memory_state(
        cfg,
        resolved_user_id,
        resolved_lecture_id,
        {
            "last_job_id": job_id,
        },
    )
    log_event(
        "memory_job_enqueue",
        "Memory analysis job enqueued.",
        payload={
            "job_id": job_id,
            "user_id": resolved_user_id,
            "lecture_id": resolved_lecture_id,
            "reason": reason_text,
        },
    )
    return {"queued": True, "job_id": job_id, "status": "queued", "deduped": False}


def maybe_enqueue_interval_analysis(
    cfg: Mapping[str, Any],
    *,
    user_id: str,
    lecture_id: str,
    turn_interval: int,
    payload: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    state = get_memory_state(cfg, user_id, lecture_id)
    current_turns = int(state.get("turns_since_last_analysis", 0) or 0)
    interval = max(1, int(turn_interval or 10))
    if current_turns < interval:
        result = {
            "queued": False,
            "reason": "interval_not_reached",
            "turns_since_last_analysis": current_turns,
            "turn_interval": interval,
        }
        log_event(
            "memory_job_trigger_decision",
            "Interval memory analysis trigger was skipped because the threshold was not reached.",
            payload={
                "user_id": str(user_id or "").strip(),
                "lecture_id": str(lecture_id or "").strip(),
                "turns_since_last_analysis": current_turns,
                "turn_interval": interval,
                "queued": False,
                "reason": "interval_not_reached",
            },
        )
        return result
    result = enqueue_memory_job(
        cfg,
        user_id=user_id,
        lecture_id=lecture_id,
        reason="interval",
        payload=payload,
    )
    log_event(
        "memory_job_trigger_decision",
        "Interval memory analysis trigger was evaluated.",
        payload={
            "user_id": str(user_id or "").strip(),
            "lecture_id": str(lecture_id or "").strip(),
            "turns_since_last_analysis": current_turns,
            "turn_interval": interval,
            "queued": bool(result.get("queued")),
            "deduped": bool(result.get("deduped")),
            "job_id": str(result.get("job_id") or "").strip(),
            "reason": "interval",
        },
    )
    return result


def get_memory_queue_snapshot() -> Dict[str, Any]:
    with _LOCK:
        queued = [dict(row) for row in _QUEUE]
        jobs = {key: dict(value) for key, value in _JOBS.items()}
        running = dict(_RUNNING_KEYS)
    return {
        "queue_size": len(queued),
        "queued": queued,
        "jobs": jobs,
        "running": running,
    }
