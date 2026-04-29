"""教材处理主模块（booksproc）。

职责：
1. 维护教材提炼队列（人工选择后入队）。
2. 执行教材文本提取（从原文件提取纯文本）。
3. 调用粗读模型输出章节结构。
4. 记录教材处理关键日志（不记录请求访问日志）。
"""

from __future__ import annotations

import re
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any, Deque, Dict, List, Mapping, Optional

from ..lectures import (
    get_book,
    get_lecture,
    list_books,
    list_lectures,
    load_book_text,
    save_book_text,
    update_book,
)
from .modeling import build_coarse_reading_runner, get_rough_reading_settings
from ..runlog import log_event
from ..utils import extract_text

_LOCK = threading.RLock()
_QUEUE: Deque[Dict[str, Any]] = deque()
_JOBS: Dict[str, Dict[str, Any]] = {}
_WORKER: Optional[threading.Thread] = None
_RUNNING = False
_CFG: Dict[str, Any] = {}


def init_booksproc(cfg: Mapping[str, Any]) -> None:
    """初始化教材处理队列工作线程。"""
    global _WORKER, _RUNNING, _CFG
    with _LOCK:
        _CFG = dict(cfg or {})
        if _RUNNING and _WORKER and _WORKER.is_alive():
            return
        _RUNNING = True
        _WORKER = threading.Thread(target=_worker_loop, name="NXLBooksProcQueue", daemon=True)
        _WORKER.start()
    log_event("booksproc_start", "教材处理队列已启动", payload={"worker": "NXLBooksProcQueue"})


def mark_book_uploaded(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    filename: str,
    file_size: int,
    actor: str = "",
) -> Dict[str, Any]:
    """标记教材已上传（不自动提炼）。"""
    updated = update_book(
        dict(cfg),
        lecture_id,
        book_id,
        {
            "source_type": "file",
            "error": "",
            "text_status": "pending_extract",
            "refinement_status": "uploaded",
            "refinement_error": "",
            "coarse_status": "idle",
        },
    )
    if updated is None:
        raise ValueError(f"Book not found: {lecture_id}/{book_id}")
    log_event(
        "book_upload",
        "教材上传完成（等待手动提炼）",
        payload={
            "lecture_id": lecture_id,
            "book_id": book_id,
            "filename": filename,
            "file_size": int(file_size or 0),
            "actor": actor,
        },
    )
    return updated


def list_refinement_candidates(cfg: Mapping[str, Any], lecture_id: str = "", status: str = "") -> List[Dict[str, Any]]:
    """列出可提炼教材。"""
    resolved_cfg = dict(cfg or {})
    target_status = str(status or "").strip().lower()
    lecture_filter = str(lecture_id or "").strip()
    rows: List[Dict[str, Any]] = []
    for lecture in list_lectures(resolved_cfg):
        current_lecture_id = str((lecture or {}).get("id") or "").strip()
        if not current_lecture_id:
            continue
        if lecture_filter and current_lecture_id != lecture_filter:
            continue
        for book in list_books(resolved_cfg, current_lecture_id):
            refine_status = str((book or {}).get("refinement_status") or "").strip().lower() or "unknown"
            if target_status and refine_status != target_status:
                continue
            rows.append(
                {
                    "lecture_id": current_lecture_id,
                    "lecture_title": str((lecture or {}).get("title") or ""),
                    "book": book,
                }
            )
    return rows


def enqueue_book_refinement(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    actor: str = "",
    force: bool = False,
) -> Dict[str, Any]:
    """将教材加入提炼队列。"""
    resolved_cfg = dict(cfg or {})
    lecture_key = str(lecture_id or "").strip()
    book_key = str(book_id or "").strip()
    if not lecture_key or not book_key:
        raise ValueError("lecture_id and book_id are required.")

    lecture = get_lecture(resolved_cfg, lecture_key)
    if lecture is None:
        raise ValueError(f"Lecture not found: {lecture_key}")
    book = get_book(resolved_cfg, lecture_key, book_key)
    if book is None:
        raise ValueError(f"Book not found: {lecture_key}/{book_key}")

    original_path = str(book.get("original_path") or "").strip()
    text_ready = str(book.get("text_status") or "").strip().lower() == "ready"
    if not original_path and not text_ready:
        raise ValueError("Book has no source file and no text content.")

    with _LOCK:
        duplicate = next(
            (
                item
                for item in _QUEUE
                if str(item.get("lecture_id")) == lecture_key and str(item.get("book_id")) == book_key
            ),
            None,
        )
        if duplicate:
            return {
                "success": True,
                "queued": True,
                "job": dict(_JOBS.get(str(duplicate.get("job_id") or ""), {})),
                "duplicate": True,
            }

        now = int(time.time())
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        job = {
            "job_id": job_id,
            "lecture_id": lecture_key,
            "book_id": book_key,
            "actor": str(actor or "").strip(),
            "force": bool(force),
            "status": "queued",
            "created_at": now,
            "started_at": None,
            "finished_at": None,
            "error": "",
        }
        _JOBS[job_id] = job
        _QUEUE.append(job)

    update_book(
        resolved_cfg,
        lecture_key,
        book_key,
        {
            "refinement_status": "queued",
            "refinement_error": "",
            "refinement_job_id": job_id,
            "refinement_requested_at": now,
            "coarse_status": "queued",
        },
    )
    log_event(
        "book_refinement_queue",
        "教材已加入提炼队列",
        payload={
            "lecture_id": lecture_key,
            "book_id": book_key,
            "job_id": job_id,
            "actor": actor,
            "force": bool(force),
        },
    )
    return {"success": True, "queued": True, "job": dict(job), "duplicate": False}


def get_refinement_queue_snapshot() -> Dict[str, Any]:
    """获取当前提炼队列快照。"""
    with _LOCK:
        queued = [dict(item) for item in list(_QUEUE)]
        jobs = sorted(
            (dict(item) for item in _JOBS.values()),
            key=lambda row: int(row.get("created_at") or 0),
            reverse=True,
        )
    return {
        "queue_size": len(queued),
        "queued_jobs": queued,
        "jobs": jobs[:120],
    }


def _worker_loop() -> None:
    """后台轮询提炼队列。"""
    while _RUNNING:
        job: Optional[Dict[str, Any]] = None
        with _LOCK:
            if _QUEUE:
                job = _QUEUE.popleft()
        if not job:
            time.sleep(0.35)
            continue
        _run_job(dict(job))


def _run_job(job: Dict[str, Any]) -> None:
    """执行单个教材提炼任务。"""
    lecture_id = str(job.get("lecture_id") or "").strip()
    book_id = str(job.get("book_id") or "").strip()
    job_id = str(job.get("job_id") or "").strip()
    force = bool(job.get("force"))
    now = int(time.time())

    _update_job(job_id, {"status": "running", "started_at": now, "error": ""})
    update_book(
        _CFG,
        lecture_id,
        book_id,
        {
            "refinement_status": "extracting",
            "refinement_error": "",
            "coarse_status": "running",
        },
    )
    log_event(
        "book_refinement_start",
        "教材开始精读（当前阶段：概读）",
        payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id, "force": force},
    )

    try:
        lecture = get_lecture(_CFG, lecture_id)
        book = get_book(_CFG, lecture_id, book_id)
        if lecture is None or book is None:
            raise ValueError(f"Book not found while running: {lecture_id}/{book_id}")

        text = _resolve_book_text(_CFG, lecture_id, book_id, book, force=force)
        rough_result = _run_rough_model(_CFG, lecture, book, text)
        chapter_info = _extract_first_two_chapters(rough_result.get("content") or "")

        updates = {
            "refinement_status": "extracted",
            "refinement_error": "",
            "refined_at": int(time.time()),
            "coarse_status": rough_result.get("status") or "skipped",
            "coarse_output": rough_result.get("content") or "",
            "coarse_model_name": rough_result.get("model_name") or "",
            "coarse_error": rough_result.get("error") or "",
        }
        if chapter_info.get("current_chapter"):
            updates["current_chapter"] = chapter_info["current_chapter"]
        if chapter_info.get("next_chapter"):
            updates["next_chapter"] = chapter_info["next_chapter"]
        update_book(_CFG, lecture_id, book_id, updates)
        _update_job(
            job_id,
            {
                "status": "done",
                "finished_at": int(time.time()),
                "error": "",
                "coarse_status": rough_result.get("status") or "skipped",
            },
        )
        log_event(
            "book_refinement_done",
            "教材提炼完成（概读阶段）",
            payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id},
            content=str(rough_result.get("content") or "")[:12000],
        )
    except Exception as exc:
        message = str(exc)
        update_book(
            _CFG,
            lecture_id,
            book_id,
            {
                "refinement_status": "error",
                "refinement_error": message,
                "coarse_status": "error",
                "coarse_error": message,
            },
        )
        _update_job(job_id, {"status": "error", "finished_at": int(time.time()), "error": message})
        log_event(
            "book_refinement_error",
            "教材提炼失败",
            payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id},
            content=message,
        )


def _resolve_book_text(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    book: Mapping[str, Any],
    *,
    force: bool = False,
) -> str:
    """获取教材文本，不存在时尝试从原文件提取并保存。"""
    if not force:
        existing = load_book_text(dict(cfg), lecture_id, book_id)
        if existing.strip():
            return existing

    original_path = str(book.get("original_path") or "").strip()
    if not original_path:
        existing = load_book_text(dict(cfg), lecture_id, book_id)
        if existing.strip():
            return existing
        raise ValueError("No original_path found for extraction.")

    source_path = Path(original_path)
    if not source_path.exists():
        raise ValueError(f"Original file not found: {source_path}")
    text = extract_text(str(source_path))
    if not text.strip():
        raise ValueError("Parsed text is empty.")
    save_book_text(dict(cfg), lecture_id, book_id, text, filename=str(book.get("original_filename") or "content.txt"))
    return text


def _run_rough_model(
    cfg: Mapping[str, Any],
    lecture: Mapping[str, Any],
    book: Mapping[str, Any],
    text: str,
) -> Dict[str, Any]:
    """调用粗读模型处理教材。"""
    model_cfg = get_rough_reading_settings(cfg)
    if not bool(model_cfg.get("enabled", True)):
        return {"status": "skipped", "content": "", "model_name": "", "error": ""}

    model_name = str(model_cfg.get("model_name") or "").strip() or None
    max_input_chars = max(1000, int(model_cfg.get("max_input_chars") or 120000))
    clipped_text = text[:max_input_chars]
    notes = str(model_cfg.get("prompt_notes") or "").strip()
    request_text = "请输出章节结构、章节范围和章节摘要。"
    if notes:
        request_text = f"{request_text}\n附加要求：{notes}"

    log_event(
        "model_context_input",
        "粗读模型输入",
        payload={
            "model_type": "coarse_reading",
            "model_name": model_name or "",
            "lecture_id": str(lecture.get("id") or ""),
            "book_id": str(book.get("id") or ""),
            "text_chars": len(clipped_text),
        },
        content=clipped_text[:12000],
    )

    runner = build_coarse_reading_runner(cfg, model_name=model_name or "")
    output = runner.run(
        request_text,
        context_payload={
            "lecture_name": str(lecture.get("title") or ""),
            "book_name": str(book.get("title") or ""),
        },
        extra_prompt_vars={
            "lecture_name": str(lecture.get("title") or ""),
            "book_name": str(book.get("title") or ""),
            "book_text": clipped_text,
        },
        model_name=model_name,
    )
    log_event(
        "model_output",
        "粗读模型输出",
        payload={
            "model_type": "coarse_reading",
            "model_name": model_name or runner.model_name,
            "lecture_id": str(lecture.get("id") or ""),
            "book_id": str(book.get("id") or ""),
        },
        content=output[:12000],
    )
    return {"status": "done", "content": output, "model_name": model_name or runner.model_name, "error": ""}


def _extract_first_two_chapters(content: str) -> Dict[str, str]:
    """从粗读输出提取前两个章节名称，用作当前章节与下一章节占位。"""
    text = str(content or "")
    names = re.findall(r"<chapter_name>\s*(.*?)\s*</chapter_name>", text, flags=re.IGNORECASE | re.DOTALL)
    cleaned = [item.strip() for item in names if item and item.strip()]
    return {
        "current_chapter": cleaned[0] if len(cleaned) >= 1 else "",
        "next_chapter": cleaned[1] if len(cleaned) >= 2 else "",
    }


def _update_job(job_id: str, patch: Mapping[str, Any]) -> None:
    """原子更新任务状态。"""
    with _LOCK:
        if not job_id or job_id not in _JOBS:
            return
        row = _JOBS[job_id]
        row.update(dict(patch or {}))
