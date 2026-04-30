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
    load_book_info_xml,
    load_book_text,
    save_book_info_xml,
    save_book_text,
    update_book,
)
from .modeling import build_coarse_reading_runner, get_rough_reading_settings
from ..runlog import append_log_text, log_event, log_model_text
from ..utils import extract_text

_LOCK = threading.RLock()
_QUEUE: Deque[Dict[str, Any]] = deque()
_JOBS: Dict[str, Dict[str, Any]] = {}
_CANCELLED_KEYS: set[str] = set()
_WORKER: Optional[threading.Thread] = None
_RUNNING = False
_CFG: Dict[str, Any] = {}
_TEMPMEM: Dict[str, List[str]] = {}
_READ_PROGRESS: Dict[str, Dict[str, int]] = {}
_MAX_READ_CHARS_PER_CALL = 8000
_MAX_ROUND_CONTEXT_CHARS = 120000
_ROUND_MAX_RETRIES = 3


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
        # 用户重新发起提炼即视为覆盖此前的取消请求，避免残留取消标记导致任务秒取消。
        _CANCELLED_KEYS.discard(_job_key(lecture_key, book_key))
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


def cancel_book_refinement(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    actor: str = "",
) -> Dict[str, Any]:
    """取消教材提炼：清队列、请求停止运行中任务，并重置教材状态。"""
    resolved_cfg = dict(cfg or {})
    lecture_key = str(lecture_id or "").strip()
    book_key = str(book_id or "").strip()
    if not lecture_key or not book_key:
        raise ValueError("lecture_id and book_id are required.")
    if get_book(resolved_cfg, lecture_key, book_key) is None:
        raise ValueError(f"Book not found: {lecture_key}/{book_key}")

    key = _job_key(lecture_key, book_key)
    now = int(time.time())
    removed = 0
    cancelled_jobs: List[str] = []
    with _LOCK:
        _CANCELLED_KEYS.add(key)
        remained: Deque[Dict[str, Any]] = deque()
        while _QUEUE:
            item = _QUEUE.popleft()
            if _job_key(str(item.get("lecture_id") or ""), str(item.get("book_id") or "")) == key:
                removed += 1
                jid = str(item.get("job_id") or "").strip()
                if jid and jid in _JOBS:
                    _JOBS[jid].update({"status": "cancelled", "finished_at": now, "error": "cancelled by admin"})
                    cancelled_jobs.append(jid)
                continue
            remained.append(item)
        _QUEUE.extend(remained)
        for jid, row in _JOBS.items():
            if _job_key(str(row.get("lecture_id") or ""), str(row.get("book_id") or "")) != key:
                continue
            status = str(row.get("status") or "").strip().lower()
            if status in {"running", "queued"}:
                row.update({"status": "cancelled", "finished_at": now, "error": "cancelled by admin"})
                if jid not in cancelled_jobs:
                    cancelled_jobs.append(jid)

    _reset_book_unrefined(resolved_cfg, lecture_key, book_key, now=now)
    log_event(
        "book_refinement_cancel",
        "教材提炼已取消并重置",
        payload={
            "lecture_id": lecture_key,
            "book_id": book_key,
            "actor": str(actor or "").strip(),
            "removed_from_queue": removed,
            "cancelled_jobs": cancelled_jobs,
        },
    )
    return {"success": True, "lecture_id": lecture_key, "book_id": book_key, "removed": removed, "cancelled_jobs": cancelled_jobs}


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
    key = _job_key(lecture_id, book_id)
    now = int(time.time())

    if _is_cancelled_key(key):
        _update_job(job_id, {"status": "cancelled", "started_at": now, "finished_at": now, "error": "cancelled by admin"})
        _reset_book_unrefined(_CFG, lecture_id, book_id, now=now)
        _clear_cancelled_key(key)
        _clear_tempmem_key(key)
        return

    _update_job(job_id, {"status": "running", "started_at": now, "error": ""})
    update_book(
        _CFG,
        lecture_id,
        book_id,
        {
            "refinement_status": "extracting",
            "refinement_error": "",
            "coarse_status": "running",
            "coarse_error": "",
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
        if _is_cancelled_key(key):
            _update_job(job_id, {"status": "cancelled", "finished_at": int(time.time()), "error": "cancelled by admin"})
            _reset_book_unrefined(_CFG, lecture_id, book_id, now=int(time.time()))
            _clear_cancelled_key(key)
            _clear_tempmem_key(key)
            return

        updates = {
            "refinement_status": "extracted",
            "refinement_error": "",
            "refined_at": int(time.time()),
            "coarse_status": rough_result.get("status") or "skipped",
            "coarse_error": rough_result.get("error") or "",
        }
        save_book_info_xml(_CFG, lecture_id, book_id, str(rough_result.get("content") or ""))
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
        _clear_tempmem_key(key)
    except Exception as exc:
        message = str(exc)
        # 便于直接在控制台/日志定位流式兼容问题。
        print(f"[BOOKS_PROC_ERROR] lecture={lecture_id} book={book_id} job={job_id} error={message}")
        if _is_cancelled_key(key) or "cancelled by admin" in message.lower():
            _update_job(job_id, {"status": "cancelled", "finished_at": int(time.time()), "error": "cancelled by admin"})
            _reset_book_unrefined(_CFG, lecture_id, book_id, now=int(time.time()))
            _clear_cancelled_key(key)
            _clear_tempmem_key(key)
            return
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
        _clear_tempmem_key(key)


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
    max_output_chars = max(2000, int(model_cfg.get("max_output_chars") or 240000))
    max_output_tokens = max(256, int(model_cfg.get("max_output_tokens") or 4000))
    request_timeout = max(30, int(model_cfg.get("request_timeout") or 240))
    api_mode = str(model_cfg.get("api_mode") or "chat").strip().lower() or "chat"
    try:
        temperature = float(model_cfg.get("temperature") or 0.2)
    except Exception:
        temperature = 0.2
    full_text = str(text or "")
    total_chars = len(full_text)
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
            "text_chars": total_chars,
            "max_output_chars": max_output_chars,
        },
        content="coarse_reading uses single-run with resume mode.",
    )

    runner = build_coarse_reading_runner(cfg, model_name=model_name or "")
    cancel_key = _job_key(str(lecture.get("id") or ""), str(book.get("id") or ""))
    def _on_delta(delta: str) -> None:
        piece = str(delta or "")
        if not piece:
            return
        # 按用户要求：delta 直接逐段写入日志正文，不额外包成单独 event。
        append_log_text(piece)
        if _is_cancelled_key(cancel_key):
            raise RuntimeError("cancelled by admin")

    output = _run_coarse_reading_single_with_resume(
        runner=runner,
        request_text=request_text,
        lecture_name=str(lecture.get("title") or ""),
        book_name=str(book.get("title") or ""),
        model_name=model_name,
        api_mode=api_mode,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        request_timeout=request_timeout,
        full_text=full_text,
        max_output_chars=max_output_chars,
        lecture_id=str(lecture.get("id") or ""),
        book_id=str(book.get("id") or ""),
        on_delta=_on_delta,
        cancel_key=cancel_key,
    )
    if not str(output or "").strip():
        raise RuntimeError("粗读模型返回空内容（stream success but empty output）")
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


def _run_coarse_reading_single_with_resume(
    *,
    runner: Any,
    request_text: str,
    lecture_name: str,
    book_name: str,
    model_name: Optional[str],
    api_mode: str,
    temperature: float,
    max_output_tokens: int,
    request_timeout: int,
    full_text: str,
    max_output_chars: int,
    lecture_id: str,
    book_id: str,
    on_delta,
    cancel_key: str,
) -> str:
    """粗读模型单次执行并支持续传：通过工具写入章节，直到 mark_book_done 或输出达上限。"""
    total_len = len(full_text)
    if total_len <= 0:
        return ""
    chapters: List[Dict[str, str]] = _parse_existing_chapters(load_book_info_xml(_CFG, lecture_id, book_id))
    seen_signatures: set[str] = set(_chapter_signature(row) for row in chapters)
    merged_output = _render_chapters_xml(chapters)
    done_marked = False
    tempmem_key = _job_key(lecture_id, book_id)
    _set_tempmem_rows(tempmem_key, [])
    _set_read_progress(tempmem_key, {"max_end": 0, "calls": 0, "last_offset": 0, "last_length": 0})
    resume_round = 1
    resume_reason = "initial"
    max_rounds = 24

    def _save_chapter_tool(chapter_name: str, chapter_range: str, chapter_summary: str) -> Dict[str, Any]:
        nonlocal merged_output
        name = str(chapter_name or "").strip()
        rng = str(chapter_range or "").strip()
        summary = str(chapter_summary or "").strip()
        if not name:
            return {"ok": False, "error": "chapter_name is required"}
        if not re.match(r"^\d+:\d+$", rng):
            return {"ok": False, "error": "chapter_range must be START:LENGTH"}
        if not summary:
            return {"ok": False, "error": "chapter_summary is required"}
        row = {"chapter_name": name, "chapter_range": rng, "chapter_summary": summary}
        sig = _chapter_signature(row)
        if sig in seen_signatures:
            return {"ok": True, "dedup": True, "chapters_count": len(chapters)}
        seen_signatures.add(sig)
        chapters.append(row)
        merged_output = _render_chapters_xml(chapters)
        save_book_info_xml(_CFG, lecture_id, book_id, merged_output)
        log_event(
            "bookinfo_realtime_merge",
            "粗读章节实时写入",
            payload={"resume_round": int(resume_round), "chapters_count": len(chapters)},
            content=f"{name} | {rng}",
        )
        log_model_text(
            f"[save_chapter]\nchapter_name={name}\nchapter_range={rng}\nchapter_summary={summary}",
            source="save_chapter",
        )
        return {"ok": True, "dedup": False, "chapters_count": len(chapters)}

    def _mark_book_done_tool() -> Dict[str, Any]:
        nonlocal done_marked
        done_marked = True
        return {"ok": True, "done": True}

    while resume_round <= max_rounds:
        if _is_cancelled_key(cancel_key):
            raise RuntimeError("cancelled by admin")
        log_event(
            "model_resume_round",
            "粗读续传轮次",
            payload={
                "resume_round": resume_round,
                "resume_reason": resume_reason,
                "book_total_chars": total_len,
                "history_chars": len(merged_output),
                "max_output_chars": int(max_output_chars),
                "chapters_count": len(chapters),
                "tempmem_count": len(_get_tempmem_rows(tempmem_key)),
            },
            content="",
        )

        round_before_count = len(chapters)
        round_result: Optional[Dict[str, Any]] = None
        retry_error = ""
        for attempt in range(1, _ROUND_MAX_RETRIES + 1):
            try:
                round_result = _run_tool_driven_resume_round(
                    runner=runner,
                    request_text=request_text,
                    lecture_name=lecture_name,
                    book_name=book_name,
                    model_name=model_name,
                    api_mode=api_mode,
                    temperature=temperature,
                    max_output_tokens=max_output_tokens,
                    request_timeout=request_timeout,
                    full_text=full_text,
                    total_len=total_len,
                    resume_round=resume_round,
                    resume_reason=resume_reason,
                    previous_rough_summary=merged_output,
                    tempmem_key=tempmem_key,
                    on_delta=on_delta,
                    on_save_chapter=_save_chapter_tool,
                    on_mark_done=_mark_book_done_tool,
                )
            except Exception as exc:
                retry_error = str(exc)
                log_event(
                    "model_resume_retry",
                    "粗读轮次失败，自动重试",
                    payload={
                        "resume_round": int(resume_round),
                        "attempt": int(attempt),
                        "max_retries": int(_ROUND_MAX_RETRIES),
                    },
                    content=retry_error,
                )
                if attempt >= _ROUND_MAX_RETRIES:
                    raise RuntimeError(f"resume round failed after retries: {retry_error}") from exc
                time.sleep(0.45 * attempt)
                continue

            assistant_text = str((round_result or {}).get("assistant_text") or "").strip()
            chapter_count_changed = len(chapters) > round_before_count
            tool_calls = int((round_result or {}).get("tool_calls") or 0)
            saved_calls = int((round_result or {}).get("saved_chapter_calls") or 0)
            has_progress = bool(assistant_text) or chapter_count_changed or tool_calls > 0 or saved_calls > 0
            if has_progress:
                break
            retry_error = "model produced no output and no tool progress"
            log_event(
                "model_resume_retry",
                "粗读轮次无输出，自动重试",
                payload={
                    "resume_round": int(resume_round),
                    "attempt": int(attempt),
                    "max_retries": int(_ROUND_MAX_RETRIES),
                },
                content=retry_error,
            )
            if attempt >= _ROUND_MAX_RETRIES:
                raise RuntimeError("model produced no output for 3 attempts")
            time.sleep(0.45 * attempt)

        if round_result is None:
            raise RuntimeError(f"resume round failed without result: {retry_error}")
        piece = str(round_result.get("assistant_text") or "")
        context_rolled = bool(round_result.get("context_rolled"))
        done_hit = done_marked or _has_done_marker(piece)
        length_hit = len(merged_output) >= int(max_output_chars)
        if done_hit or length_hit:
            break
        # 本轮既没有新增章节也没有 DONE，停止避免空转。
        chapter_count_changed = len(chapters) > round_before_count
        if (not chapter_count_changed) and (not done_marked) and context_rolled:
            log_event(
                "model_rollover_no_chapter",
                "发生续传换轮但未写入章节",
                payload={"resume_round": int(resume_round), "reason": str(resume_reason or "")},
                content="建议检查模型是否陷入连续 read_book_text 而不调用 save_chapter。",
            )
        if (not chapter_count_changed) and (not done_marked) and (not context_rolled):
            # 无新增输出时停止，避免空转重试。
            break
        resume_round += 1
        resume_reason = "context_rollover" if context_rolled else "continue"

    return str(merged_output or "").strip()


def _run_tool_driven_resume_round(
    *,
    runner: Any,
    request_text: str,
    lecture_name: str,
    book_name: str,
    model_name: Optional[str],
    api_mode: str,
    temperature: float,
    max_output_tokens: int,
    request_timeout: int,
    full_text: str,
    total_len: int,
    resume_round: int,
    resume_reason: str,
    previous_rough_summary: str,
    tempmem_key: str,
    on_delta,
    on_save_chapter,
    on_mark_done,
) -> Dict[str, Any]:
    """单轮粗读：使用工具读书并写章节，输出文本仅作调试。"""
    prompt_vars = {
        "lecture_name": str(lecture_name or ""),
        "book_name": str(book_name or ""),
        "book_total_chars": str(total_len),
        "resume_round": str(resume_round),
        "resume_reason": str(resume_reason),
        "previous_rough_summary": str(previous_rough_summary or ""),
        "tempmem_dump": _format_tempmem_dump(_get_tempmem_rows(tempmem_key)),
    }
    context = runner.context_manager.build_context({"lecture_name": lecture_name, "book_name": book_name})
    prompt_pack = runner.get_prompt_templates()
    system_prompt = runner.context_manager.render(prompt_pack["system"], context, {"request": request_text, **prompt_vars})
    user_prompt = runner.context_manager.render(prompt_pack["user"], context, {"request": request_text, **prompt_vars})
    messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]
    tools = _build_rough_read_tools()
    max_turns = 18
    output_text = ""
    assistant_concat: List[str] = []
    round_context_chars = 0
    context_rolled = False
    saved_chapter_calls = 0
    total_tool_calls = 0

    for turn in range(1, max_turns + 1):
        response = runner.nexora_client.proxy.chat_completions(
            messages=messages,
            model=model_name or runner.model_name,
            username=None,
            options={
                "temperature": temperature,
                "max_tokens": max_output_tokens,
                "stream": False,
                "think": False,
                "tools": tools,
                "tool_choice": "auto",
            },
            use_chat_path=False,
            request_timeout=request_timeout,
            on_delta=on_delta,
        )
        if not bool(response.get("ok")):
            raise RuntimeError(f"Nexora API Error: {response.get('message') or 'request failed'}")
        payload = response.get("payload") if isinstance(response.get("payload"), dict) else {}
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            break
        msg = choices[0].get("message") if isinstance(choices[0].get("message"), dict) else {}
        assistant_content = str(msg.get("content") or "")
        tool_calls = msg.get("tool_calls") if isinstance(msg.get("tool_calls"), list) else []
        round_context_chars += len(assistant_content)
        if assistant_content.strip():
            assistant_concat.append(assistant_content)
            log_model_text(assistant_content, source="assistant_content")
        messages.append(
            {
                "role": "assistant",
                "content": assistant_content if assistant_content else None,
                "tool_calls": tool_calls if tool_calls else None,
            }
        )
        log_event(
            "model_tool_round",
            "粗读工具轮次",
            payload={
                "resume_round": int(resume_round),
                "turn": int(turn),
                "tool_call_count": len(tool_calls),
                "assistant_content_len": len(assistant_content),
            },
            content=assistant_content[:2000],
        )
        if not tool_calls:
            output_text = assistant_content
            break

        stop_this_round = False
        for call in tool_calls:
            if not isinstance(call, dict):
                continue
            total_tool_calls += 1
            call_id = str(call.get("id") or "")
            func = call.get("function") if isinstance(call.get("function"), dict) else {}
            tool_name = str(func.get("name") or "").strip()
            args_raw = str(func.get("arguments") or "{}")
            args_obj = _safe_json_obj(args_raw)
            log_event(
                "model_tool_call",
                "粗读模型工具调用",
                payload={"resume_round": int(resume_round), "turn": int(turn), "tool_name": tool_name, "tool_call_id": call_id},
                content=str(args_raw)[:1200],
            )
            if tool_name == "read_book_text":
                result_obj = _exec_read_book_text_tool(full_text=full_text, total_len=total_len, arguments=args_obj)
                _update_read_progress(
                    tempmem_key,
                    offset=int(result_obj.get("offset") or 0),
                    length=int(result_obj.get("length") or 0),
                )
            elif tool_name == "save_tempmem":
                result_obj = _exec_save_tempmem_tool(tempmem_key=tempmem_key, arguments=args_obj)
            elif tool_name == "save_chapter":
                result_obj = on_save_chapter(
                    str(args_obj.get("chapter_name") or ""),
                    str(args_obj.get("chapter_range") or ""),
                    str(args_obj.get("chapter_summary") or ""),
                )
                if bool(result_obj.get("ok")) and not bool(result_obj.get("dedup")):
                    saved_chapter_calls += 1
            elif tool_name == "mark_book_done":
                result_obj = on_mark_done()
            else:
                result_obj = {"ok": False, "error": f"unsupported tool: {tool_name}"}
            messages.append({"role": "tool", "tool_call_id": call_id, "content": _safe_json_dumps(result_obj)})
            if tool_name == "read_book_text":
                text_part = str(result_obj.get("text") or "")
                round_context_chars += len(text_part)
            log_event(
                "model_tool_result",
                "粗读模型工具结果",
                payload={"resume_round": int(resume_round), "turn": int(turn), "tool_name": tool_name, "tool_call_id": call_id},
                content=_safe_json_dumps(result_obj)[:2400],
            )
            if round_context_chars >= _MAX_ROUND_CONTEXT_CHARS:
                context_rolled = True
                stop_this_round = True
                log_event(
                    "model_context_rollover",
                    "单轮上下文预算已满，触发续传换轮",
                    payload={
                        "resume_round": int(resume_round),
                        "turn": int(turn),
                        "context_chars": int(round_context_chars),
                        "budget_chars": int(_MAX_ROUND_CONTEXT_CHARS),
                    },
                    content="",
                )
                break
        if stop_this_round:
            break
    assistant_text = str(output_text).strip() if output_text.strip() else "\n".join([part for part in assistant_concat if str(part or "").strip()]).strip()
    return {
        "assistant_text": assistant_text,
        "context_rolled": context_rolled,
        "saved_chapter_calls": saved_chapter_calls,
        "tool_calls": total_tool_calls,
        "context_chars": round_context_chars,
    }


def _build_rough_read_tools() -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "read_book_text",
                "description": "Read full-book text by global offset and length.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "offset": {"type": "integer", "description": "Global start offset, >=0"},
                        "length": {"type": "integer", "description": "Read length, 1..30000"},
                    },
                    "required": ["offset", "length"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "save_tempmem",
                "description": "Save temporary high-value findings for later continuation rounds.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "note": {"type": "string", "description": "A concise temporary note."},
                    },
                    "required": ["note"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "save_chapter",
                "description": "Persist one finalized chapter result immediately.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chapter_name": {"type": "string"},
                        "chapter_range": {"type": "string", "description": "START:LENGTH"},
                        "chapter_summary": {"type": "string"},
                    },
                    "required": ["chapter_name", "chapter_range", "chapter_summary"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "mark_book_done",
                "description": "Call this when full-book rough reading is complete.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
    ]


def _exec_read_book_text_tool(*, full_text: str, total_len: int, arguments: Mapping[str, Any]) -> Dict[str, Any]:
    try:
        offset = int(arguments.get("offset"))
        length = int(arguments.get("length"))
    except Exception:
        return {"ok": False, "error": "offset/length must be integer"}
    if offset < 0:
        return {"ok": False, "error": "offset must be >= 0"}
    if length <= 0:
        return {"ok": False, "error": "length must be > 0"}
    safe_len = min(length, _MAX_READ_CHARS_PER_CALL)
    if offset >= total_len:
        return {"ok": False, "error": "offset out of range", "text_len": total_len}
    end = min(total_len, offset + safe_len)
    return {
        "ok": True,
        "offset": offset,
        "length": end - offset,
        "text": str(full_text[offset:end] or ""),
    }


def _exec_save_tempmem_tool(*, tempmem_key: str, arguments: Mapping[str, Any]) -> Dict[str, Any]:
    note = str(arguments.get("note") or "").strip()
    if not note:
        return {"ok": False, "error": "note is required"}
    rows = _get_tempmem_rows(tempmem_key)
    rows.append(note)
    if len(rows) > 120:
        rows = rows[-120:]
    _set_tempmem_rows(tempmem_key, rows)
    return {"ok": True, "tempmem_count": len(rows)}


def _get_tempmem_rows(key: str) -> List[str]:
    with _LOCK:
        return list(_TEMPMEM.get(key) or [])


def _set_tempmem_rows(key: str, rows: List[str]) -> None:
    with _LOCK:
        _TEMPMEM[key] = list(rows or [])


def _clear_tempmem_key(key: str) -> None:
    with _LOCK:
        _TEMPMEM.pop(str(key or ""), None)
        _READ_PROGRESS.pop(str(key or ""), None)


def _format_tempmem_dump(rows: List[str]) -> str:
    if not rows:
        return ""
    return "\n".join([f"- {item}" for item in rows if str(item).strip()])


def _set_read_progress(key: str, state: Dict[str, int]) -> None:
    with _LOCK:
        _READ_PROGRESS[str(key or "")] = {
            "max_end": int(state.get("max_end") or 0),
            "calls": int(state.get("calls") or 0),
            "last_offset": int(state.get("last_offset") or 0),
            "last_length": int(state.get("last_length") or 0),
        }


def _get_read_progress(key: str) -> Dict[str, int]:
    with _LOCK:
        raw = dict(_READ_PROGRESS.get(str(key or "")) or {})
    return {
        "max_end": int(raw.get("max_end") or 0),
        "calls": int(raw.get("calls") or 0),
        "last_offset": int(raw.get("last_offset") or 0),
        "last_length": int(raw.get("last_length") or 0),
    }


def _update_read_progress(key: str, *, offset: int, length: int) -> None:
    with _LOCK:
        row = dict(_READ_PROGRESS.get(str(key or "")) or {})
        prev_calls = int(row.get("calls") or 0)
        prev_max_end = int(row.get("max_end") or 0)
        end = max(0, int(offset) + max(0, int(length)))
        row["calls"] = prev_calls + 1
        row["last_offset"] = max(0, int(offset))
        row["last_length"] = max(0, int(length))
        row["max_end"] = max(prev_max_end, end)
        _READ_PROGRESS[str(key or "")] = row


def _format_read_progress(state: Mapping[str, Any]) -> str:
    calls = int(state.get("calls") or 0)
    max_end = int(state.get("max_end") or 0)
    last_offset = int(state.get("last_offset") or 0)
    last_length = int(state.get("last_length") or 0)
    return (
        f"calls={calls}; max_end={max_end}; "
        f"last_offset={last_offset}; last_length={last_length}. "
        "优先继续读取 max_end 之后的新范围，除非必须回溯。"
    )


def _safe_json_obj(raw: str) -> Dict[str, Any]:
    text = str(raw or "").strip()
    if not text:
        return {}
    try:
        data = __import__("json").loads(text)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _safe_json_dumps(obj: Any) -> str:
    try:
        return __import__("json").dumps(obj, ensure_ascii=False)
    except Exception:
        return str(obj)


def _parse_existing_chapters(xml_text: str) -> List[Dict[str, str]]:
    """从现有 bookinfo.xml 解析章节，支持续传恢复。"""
    value = str(xml_text or "")
    if not value.strip():
        return []
    pattern = re.compile(
        r"<chapter_name>\s*(.*?)\s*</chapter_name>\s*"
        r"<chapter_range>\s*(.*?)\s*</chapter_range>\s*"
        r"<chapter_summary>\s*(.*?)\s*</chapter_summary>",
        flags=re.IGNORECASE | re.DOTALL,
    )
    rows: List[Dict[str, str]] = []
    for m in pattern.finditer(value):
        name = str(m.group(1) or "").strip()
        rng = str(m.group(2) or "").strip()
        summary = str(m.group(3) or "").strip()
        if not name or not rng or not summary:
            continue
        rows.append({"chapter_name": name, "chapter_range": rng, "chapter_summary": summary})
    return rows


def _render_chapters_xml(chapters: List[Dict[str, str]]) -> str:
    """将章节结构渲染为 bookinfo.xml 文本。"""
    lines: List[str] = []
    for row in chapters:
        name = str(row.get("chapter_name") or "").strip()
        rng = str(row.get("chapter_range") or "").strip()
        summary = str(row.get("chapter_summary") or "").strip()
        if not name or not rng or not summary:
            continue
        lines.append(f"<chapter_name>{name}</chapter_name>")
        lines.append(f"<chapter_range>{rng}</chapter_range>")
        lines.append(f"<chapter_summary>{summary}</chapter_summary>")
        lines.append("")
    return "\n".join(lines).strip()


def _chapter_signature(row: Mapping[str, Any]) -> str:
    name = str(row.get("chapter_name") or "").strip().lower()
    rng = str(row.get("chapter_range") or "").strip().lower()
    return f"{name}::{rng}"


def _has_done_marker(text: str) -> bool:
    value = str(text or "")
    if not value:
        return False
    return "<DONE>" in value.upper()


def _strip_done_marker(text: str) -> str:
    value = str(text or "")
    if not value:
        return ""
    return re.sub(r"</?\s*DONE\s*>", "", value, flags=re.IGNORECASE).strip()


def _extract_chapter_units(text: str) -> List[str]:
    """提取完整章节块，支持章节级实时落盘。"""
    value = str(text or "")
    if not value.strip():
        return []
    pattern = re.compile(
        r"(<chapter_name>\s*.*?\s*</chapter_name>\s*"
        r"<chapter_range>\s*.*?\s*</chapter_range>\s*"
        r"<chapter_summary>\s*.*?\s*</chapter_summary>)",
        flags=re.IGNORECASE | re.DOTALL,
    )
    return [str(item or "").strip() for item in pattern.findall(value) if str(item or "").strip()]


def _normalize_unit(text: str) -> str:
    value = str(text or "").strip()
    if not value:
        return ""
    return re.sub(r"\n{3,}", "\n\n", value).strip()


def _unit_signature(text: str) -> str:
    value = str(text or "").strip().lower()
    value = re.sub(r"\s+", " ", value)
    return value


def _clean_model_output(text: str) -> str:
    """清理模型输出中的 thinking 标记，避免污染章节解析。"""
    value = str(text or "")
    if not value:
        return ""
    cleaned = re.sub(r"<think>.*?</think>", "", value, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"```thinking.*?```", "", cleaned, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"^\s*THINKING:.*?$", "", cleaned, flags=re.IGNORECASE | re.MULTILINE)
    return cleaned.strip()


def _update_job(job_id: str, patch: Mapping[str, Any]) -> None:
    """原子更新任务状态。"""
    with _LOCK:
        if not job_id or job_id not in _JOBS:
            return
        row = _JOBS[job_id]
        row.update(dict(patch or {}))


def _job_key(lecture_id: str, book_id: str) -> str:
    return f"{str(lecture_id or '').strip()}::{str(book_id or '').strip()}"


def _is_cancelled_key(key: str) -> bool:
    with _LOCK:
        return key in _CANCELLED_KEYS


def _clear_cancelled_key(key: str) -> None:
    with _LOCK:
        _CANCELLED_KEYS.discard(key)


def _reset_book_unrefined(cfg: Mapping[str, Any], lecture_id: str, book_id: str, *, now: Optional[int] = None) -> None:
    ts = int(now or time.time())
    book = get_book(dict(cfg), lecture_id, book_id) or {}
    source_status = "uploaded" if str(book.get("original_path") or "").strip() else "empty"
    coarse_status = "idle"
    update_book(
        dict(cfg),
        lecture_id,
        book_id,
        {
            "refinement_status": source_status,
            "refinement_error": "",
            "refinement_job_id": "",
            "refinement_requested_at": 0,
            "refined_at": 0,
            "coarse_status": coarse_status,
            "coarse_error": "",
            "updated_at": ts,
        },
    )
