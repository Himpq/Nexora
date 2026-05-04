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
from typing import Any, Deque, Dict, List, Mapping, Optional, Tuple

import prompts

from ..lectures import (
    get_book,
    get_lecture,
    list_books,
    list_lectures,
    load_book_detail_xml,
    load_book_info_xml,
    load_book_questions_xml,
    load_book_text,
    save_book_info_xml,
    save_book_detail_xml,
    save_book_questions_xml,
    save_book_text,
    update_book,
)
from .modeling import (
    build_coarse_reading_runner,
    build_intensive_reading_runner,
    build_question_generation_runner,
    get_intensive_reading_settings,
    get_question_generation_settings,
    get_rough_reading_settings,
)
from .coarse import run_rough_model as _run_rough_model_flow
from .intensive import (
    run_intensive_reading_once as _run_intensive_reading_once_flow,
    run_intensive_with_tools_strict as _run_intensive_with_tools_strict,
)
from .question import (
    run_question_generation_once as _run_question_generation_once_flow,
    run_question_with_tools_strict as _run_question_with_tools_strict,
)
from .queue import (
    cancel_job as queue_cancel_job,
    enqueue_job as queue_enqueue_job,
    get_queue_snapshot as queue_get_snapshot,
    init_booksproc_queue,
)
from .runtime import (
    MAX_READ_CHARS_PER_CALL as _RUNTIME_MAX_READ_CHARS_PER_CALL,
    as_bool as runtime_as_bool,
    exec_read_book_text_tool as runtime_exec_read_book_text_tool,
    exec_search_book_text_tool as runtime_exec_search_book_text_tool,
    resolve_book_text as runtime_resolve_book_text,
    safe_json_obj as runtime_safe_json_obj,
)
from .state import (
    BOOK_PROGRESS,
    BOOK_PROGRESS_STEPS,
    CANCELLED_KEYS,
    CFG as STATE_CFG,
    JOBS,
    LOCK as STATE_LOCK,
    QUEUE,
    RUNNING as STATE_RUNNING,
    TEMPMEM,
    WORKER as STATE_WORKER,
    READ_PROGRESS,
    clear_cancelled_key as state_clear_cancelled_key,
    get_book_progress_steps as state_get_book_progress_steps,
    get_book_progress_text as state_get_book_progress_text,
    get_queue_snapshot as state_get_queue_snapshot,
    is_cancelled_key as state_is_cancelled_key,
    job_key as state_job_key,
    push_book_progress_step as state_push_book_progress_step,
    set_book_progress as state_set_book_progress,
    update_job as state_update_job,
)
from ..runlog import append_log_text, log_event, log_model_text, log_tool_flow
from ..utils import extract_text

_LOCK = STATE_LOCK
_QUEUE = QUEUE
_JOBS = JOBS
_CANCELLED_KEYS = CANCELLED_KEYS
_WORKER = STATE_WORKER
_RUNNING = STATE_RUNNING
_CFG = STATE_CFG
_TEMPMEM = TEMPMEM
_BOOK_PROGRESS = BOOK_PROGRESS
_BOOK_PROGRESS_STEPS = BOOK_PROGRESS_STEPS
_READ_PROGRESS = READ_PROGRESS
_MAX_READ_CHARS_PER_CALL = _RUNTIME_MAX_READ_CHARS_PER_CALL
_MAX_ROUND_CONTEXT_CHARS = 120000
_ROUND_MAX_RETRIES = 3


def _render_prompt(template: str, values: Mapping[str, Any]) -> str:
    """Render {{var}} placeholders with plain string substitution."""
    text = str(template or "")
    pattern = re.compile(r"\{\{\s*([a-zA-Z0-9_\-]+)\s*\}\}")

    def _replace(match: re.Match[str]) -> str:
        key = str(match.group(1) or "").strip()
        return str(values.get(key, ""))

    return pattern.sub(_replace, text)


def _load_prompt_text(key: str, fallback_text: str) -> str:
    """Load prompt from data/prompts/<key>.md, fallback to code prompt text."""
    base_dir = Path(str((_CFG or {}).get("data_dir") or "./data")).resolve()
    prompt_dir = base_dir / "prompts"
    prompt_file = prompt_dir / f"{str(key or '').strip()}.md"
    try:
        prompt_dir.mkdir(parents=True, exist_ok=True)
        if prompt_file.exists():
            text = prompt_file.read_text(encoding="utf-8")
            if str(text).strip():
                return str(text)
        prompt_file.write_text(str(fallback_text or ""), encoding="utf-8")
    except Exception:
        pass
    return str(fallback_text or "")


def _parse_chapter_ordinal(name: str) -> Optional[int]:
    """从章节名中提取章节序号，用于保持写入顺序单调递增。"""
    text = str(name or "").strip()
    if not text:
        return None
    match = re.search(r"第\s*([0-9一二三四五六七八九十百千〇零]+)\s*章", text)
    if not match:
        return None
    token = str(match.group(1) or "").strip()
    if not token:
        return None
    if token.isdigit():
        try:
            return int(token)
        except Exception:
            return None

    digit_map = {
        "零": 0,
        "〇": 0,
        "一": 1,
        "二": 2,
        "两": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
    }
    unit_map = {"十": 10, "百": 100, "千": 1000}
    if token in digit_map:
        return int(digit_map[token])

    total = 0
    section = 0
    number = 0
    for char in token:
        if char in digit_map:
            number = int(digit_map[char])
        elif char in unit_map:
            unit = int(unit_map[char])
            if number == 0:
                number = 1
            section += number * unit
            number = 0
        else:
            return None
    total = section + number
    return total if total > 0 else None


def _set_book_progress(lecture_id: str, book_id: str, text: str) -> None:
    """更新教材的中文实时进度文本。"""
    state_set_book_progress(lecture_id, book_id, text)


def get_book_progress_text(lecture_id: str, book_id: str) -> str:
    """读取教材的中文实时进度文本。"""
    return state_get_book_progress_text(lecture_id, book_id)


def _push_book_progress_step(lecture_id: str, book_id: str, step: Mapping[str, Any]) -> None:
    """追加教材进度步骤（用于前端展开工具链），并限制最大长度。"""
    row = dict(step or {})
    row["ts"] = int(time.time())
    state_push_book_progress_step(lecture_id, book_id, row)


def get_book_progress_steps(lecture_id: str, book_id: str) -> List[Dict[str, Any]]:
    """读取教材进度步骤列表。"""
    return state_get_book_progress_steps(lecture_id, book_id)


def init_booksproc(cfg: Mapping[str, Any]) -> None:
    """初始化教材处理队列工作线程。"""
    _CFG.clear()
    _CFG.update(dict(cfg or {}))
    init_booksproc_queue(_CFG, run_job=_run_job, log_event=log_event)


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

    queued = queue_enqueue_job(
        lecture_key,
        book_key,
        actor=actor,
        force=force,
        job_type="coarse",
    )
    job = dict(queued.get("job") or {})
    job_id = str(job.get("job_id") or "")
    now = int(job.get("created_at") or time.time())

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
    _set_book_progress(lecture_key, book_key, "模型排队中...")
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
    return queued


def enqueue_book_intensive(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    actor: str = "",
    model_name: str = "",
) -> Dict[str, Any]:
    """将教材加入精读队列（异步执行，避免前端请求阻塞）。"""
    resolved_cfg = dict(cfg or {})
    lecture_key = str(lecture_id or "").strip()
    book_key = str(book_id or "").strip()
    selected_model = str(model_name or "").strip()
    if not lecture_key or not book_key:
        raise ValueError("lecture_id and book_id are required.")

    lecture = get_lecture(resolved_cfg, lecture_key)
    if lecture is None:
        raise ValueError(f"Lecture not found: {lecture_key}")
    book = get_book(resolved_cfg, lecture_key, book_key)
    if book is None:
        raise ValueError(f"Book not found: {lecture_key}/{book_key}")

    coarse_status = str(book.get("coarse_status") or "").strip().lower()
    if coarse_status not in {"done", "completed", "success"}:
        raise ValueError("coarse reading is not completed yet.")

    queued = queue_enqueue_job(
        lecture_key,
        book_key,
        actor=actor,
        force=False,
        job_type="intensive",
        model_name=selected_model,
    )
    job = dict(queued.get("job") or {})
    job_id = str(job.get("job_id") or "")
    now = int(job.get("created_at") or time.time())

    update_book(
        resolved_cfg,
        lecture_key,
        book_key,
        {
            "intensive_status": "queued",
            "intensive_error": "",
            "intensive_model": selected_model,
            "refinement_job_id": job_id,
            "refinement_requested_at": now,
        },
    )
    _set_book_progress(lecture_key, book_key, "精读任务排队中...")
    log_event(
        "book_intensive_queue",
        "教材已加入精读队列",
        payload={
            "lecture_id": lecture_key,
            "book_id": book_key,
            "job_id": job_id,
            "actor": actor,
            "model_name": selected_model,
        },
    )
    return queued


def enqueue_book_question(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    actor: str = "",
    model_name: str = "",
) -> Dict[str, Any]:
    """将教材加入出题队列。"""
    resolved_cfg = dict(cfg or {})
    lecture_key = str(lecture_id or "").strip()
    book_key = str(book_id or "").strip()
    selected_model = str(model_name or "").strip()
    if not lecture_key or not book_key:
        raise ValueError("lecture_id and book_id are required.")

    lecture = get_lecture(resolved_cfg, lecture_key)
    if lecture is None:
        raise ValueError(f"Lecture not found: {lecture_key}")
    book = get_book(resolved_cfg, lecture_key, book_key)
    if book is None:
        raise ValueError(f"Book not found: {lecture_key}/{book_key}")

    intensive_status = str(book.get("intensive_status") or "").strip().lower()
    if intensive_status not in {"done", "completed", "success"}:
        raise ValueError("intensive reading is not completed yet.")

    queued = queue_enqueue_job(
        lecture_key,
        book_key,
        actor=actor,
        force=False,
        job_type="question",
        model_name=selected_model,
    )
    job = dict(queued.get("job") or {})
    job_id = str(job.get("job_id") or "")
    now = int(job.get("created_at") or time.time())

    update_book(
        resolved_cfg,
        lecture_key,
        book_key,
        {
            "question_status": "queued",
            "question_error": "",
            "question_model": selected_model,
            "refinement_job_id": job_id,
            "refinement_requested_at": now,
        },
    )
    _set_book_progress(lecture_key, book_key, "出题任务排队中...")
    log_event(
        "book_question_queue",
        "教材已加入出题队列",
        payload={
            "lecture_id": lecture_key,
            "book_id": book_key,
            "job_id": job_id,
            "actor": actor,
            "model_name": selected_model,
        },
    )
    return queued


def get_refinement_queue_snapshot() -> Dict[str, Any]:
    """获取当前提炼队列快照。"""
    return queue_get_snapshot()


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

    now = int(time.time())
    cancelled = queue_cancel_job(lecture_key, book_key)
    removed = int(cancelled.get("removed") or 0)
    cancelled_jobs = list(cancelled.get("cancelled_jobs") or [])

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
    job_type = str(job.get("job_type") or "coarse").strip().lower() or "coarse"
    model_name = str(job.get("model_name") or "").strip()
    key = _job_key(lecture_id, book_id)
    now = int(time.time())

    if _is_cancelled_key(key):
        _update_job(job_id, {"status": "cancelled", "started_at": now, "finished_at": now, "error": "cancelled by admin"})
        _reset_book_unrefined(_CFG, lecture_id, book_id, now=now)
        _clear_cancelled_key(key)
        _clear_tempmem_key(key)
        return

    _update_job(job_id, {"status": "running", "started_at": now, "error": ""})
    if job_type == "intensive":
        update_book(
            _CFG,
            lecture_id,
            book_id,
            {
                "intensive_status": "running",
                "intensive_error": "",
                "intensive_model": model_name,
            },
        )
        _set_book_progress(lecture_id, book_id, "模型正在执行精读...")
        log_event(
            "book_intensive_start",
            "教材开始精读（精读阶段）",
            payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id, "model_name": model_name},
        )
    elif job_type == "question":
        update_book(
            _CFG,
            lecture_id,
            book_id,
            {
                "question_status": "running",
                "question_error": "",
                "question_model": model_name,
            },
        )
        _set_book_progress(lecture_id, book_id, "模型正在生成章节题目...")
        log_event(
            "book_question_start",
            "教材开始出题（出题阶段）",
            payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id, "model_name": model_name},
        )
    else:
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
        _set_book_progress(lecture_id, book_id, "模型正在提取教材文本...")
        log_event(
            "book_refinement_start",
            "教材开始精读（当前阶段：概读）",
            payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id, "force": force},
        )

    try:
        if job_type == "intensive":
            result = run_intensive_reading_once(_CFG, lecture_id, book_id, actor=str(job.get("actor") or ""), model_name=model_name)
            finished_at = int(time.time())
            _set_book_progress(lecture_id, book_id, "精读完成")
            _update_job(
                job_id,
                {
                    "status": "done",
                    "finished_at": finished_at,
                    "error": "",
                    "intensive_status": "done",
                    "model_name": str(result.get("model_name") or model_name),
                },
            )
            log_event(
                "book_intensive_done",
                "教材提炼完成（精读阶段）",
                payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id},
                content=f"bookdetail_chars={int(result.get('bookdetail_chars') or 0)}",
            )
        elif job_type == "question":
            result = run_question_generation_once(_CFG, lecture_id, book_id, actor=str(job.get("actor") or ""), model_name=model_name)
            finished_at = int(time.time())
            _set_book_progress(lecture_id, book_id, "出题完成")
            _update_job(
                job_id,
                {
                    "status": "done",
                    "finished_at": finished_at,
                    "error": "",
                    "question_status": "done",
                    "model_name": str(result.get("model_name") or model_name),
                },
            )
            log_event(
                "book_question_done",
                "教材提炼完成（出题阶段）",
                payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id},
                content=f"questions_chars={int(result.get('questions_chars') or 0)}",
            )
        else:
            lecture = get_lecture(_CFG, lecture_id)
            book = get_book(_CFG, lecture_id, book_id)
            if lecture is None or book is None:
                raise ValueError(f"Book not found while running: {lecture_id}/{book_id}")

            text = _resolve_book_text(_CFG, lecture_id, book_id, book, force=force)
            _set_book_progress(lecture_id, book_id, "模型正在划分章节...")
            rough_result = _run_rough_model(_CFG, lecture, book, text)
            if _is_cancelled_key(key):
                _update_job(job_id, {"status": "cancelled", "finished_at": int(time.time()), "error": "cancelled by admin"})
                _reset_book_unrefined(_CFG, lecture_id, book_id, now=int(time.time()))
                _clear_cancelled_key(key)
                _clear_tempmem_key(key)
                return

            coarse_status = str(rough_result.get("status") or "skipped").strip().lower() or "skipped"
            finished_at = int(time.time())
            updates = {
                "refinement_status": "done" if coarse_status == "done" else "extracted",
                "refinement_error": "",
                "refined_at": finished_at,
                "coarse_status": coarse_status,
                "coarse_error": rough_result.get("error") or "",
                "coarse_model": str(rough_result.get("model_name") or ""),
            }
            save_book_info_xml(_CFG, lecture_id, book_id, str(rough_result.get("content") or ""))
            update_book(_CFG, lecture_id, book_id, updates)
            _set_book_progress(lecture_id, book_id, "粗读完成，待精读")
            _update_job(
                job_id,
                {
                    "status": "done" if coarse_status == "done" else "outlined",
                    "finished_at": finished_at,
                    "error": "",
                    "coarse_status": coarse_status,
                },
            )
            log_event(
                "book_refinement_done" if coarse_status == "done" else "book_refinement_outlined",
                "教材提炼完成（概读阶段）",
                payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id, "coarse_status": coarse_status},
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
        if job_type == "intensive":
            update_book(
                _CFG,
                lecture_id,
                book_id,
                {
                    "intensive_status": "error",
                    "intensive_error": message,
                },
            )
            _set_book_progress(lecture_id, book_id, f"精读执行失败：{message[:120]}")
            _update_job(job_id, {"status": "error", "finished_at": int(time.time()), "error": message, "intensive_status": "error"})
            log_event(
                "book_intensive_error",
                "教材提炼失败（精读阶段）",
                payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id},
                content=message,
            )
        elif job_type == "question":
            update_book(
                _CFG,
                lecture_id,
                book_id,
                {
                    "question_status": "error",
                    "question_error": message,
                },
            )
            _set_book_progress(lecture_id, book_id, f"出题执行失败：{message[:120]}")
            _update_job(job_id, {"status": "error", "finished_at": int(time.time()), "error": message, "question_status": "error"})
            log_event(
                "book_question_error",
                "教材提炼失败（出题阶段）",
                payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id},
                content=message,
            )
        else:
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
            _set_book_progress(lecture_id, book_id, f"模型执行失败：{message[:120]}")
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
    """???????????????????????"""
    return runtime_resolve_book_text(
        cfg,
        lecture_id,
        book_id,
        book,
        force=force,
    )

def _run_rough_model(
    cfg: Mapping[str, Any],
    lecture: Mapping[str, Any],
    book: Mapping[str, Any],
    text: str,
) -> Dict[str, Any]:
    """调用粗读模型处理教材（委托 coarse.py）。"""
    return _run_rough_model_flow(
        cfg,
        lecture,
        book,
        text,
        get_rough_reading_settings=get_rough_reading_settings,
        build_coarse_reading_runner=build_coarse_reading_runner,
        as_bool=_as_bool,
        job_key=_job_key,
        is_cancelled_key=_is_cancelled_key,
        append_log_text=append_log_text,
        log_event=log_event,
        run_coarse_reading_chunked=_run_coarse_reading_chunked,
    )


def run_intensive_reading_once(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    actor: str = "",
    model_name: str = "",
) -> Dict[str, Any]:
    """手动触发精读（委托 intensive.py，强循环工具约束）。"""
    return _run_intensive_reading_once_flow(
        cfg,
        lecture_id,
        book_id,
        actor=actor,
        model_name=model_name,
        get_lecture=get_lecture,
        get_book=get_book,
        load_book_info_xml=load_book_info_xml,
        load_book_detail_xml=load_book_detail_xml,
        save_book_detail_xml=save_book_detail_xml,
        update_book=update_book,
        resolve_book_text=_resolve_book_text,
        get_intensive_reading_settings=get_intensive_reading_settings,
        build_intensive_reading_runner=build_intensive_reading_runner,
        as_bool=_as_bool,
        log_event=log_event,
        append_log_text=append_log_text,
        log_tool_flow=log_tool_flow,
        push_book_progress_step=_push_book_progress_step,
        run_intensive_with_tools=lambda **kwargs: _run_intensive_with_tools_strict(
            **kwargs,
            safe_json_obj=_safe_json_obj,
            exec_read_book_text_tool=_exec_read_book_text_tool,
            exec_search_book_text_tool=_exec_search_book_text_tool,
            log_event=log_event,
        ),
    )


def run_question_generation_once(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    actor: str = "",
    model_name: str = "",
) -> Dict[str, Any]:
    """手动触发出题（委托 question.py，强循环工具约束）。"""
    return _run_question_generation_once_flow(
        cfg,
        lecture_id,
        book_id,
        actor=actor,
        model_name=model_name,
        get_lecture=get_lecture,
        get_book=get_book,
        load_book_info_xml=load_book_info_xml,
        load_book_detail_xml=load_book_detail_xml,
        load_book_questions_xml=load_book_questions_xml,
        save_book_questions_xml=save_book_questions_xml,
        update_book=update_book,
        resolve_book_text=_resolve_book_text,
        get_question_generation_settings=get_question_generation_settings,
        build_question_generation_runner=build_question_generation_runner,
        as_bool=_as_bool,
        log_event=log_event,
        append_log_text=append_log_text,
        log_tool_flow=log_tool_flow,
        push_book_progress_step=_push_book_progress_step,
        run_question_with_tools=lambda **kwargs: _run_question_with_tools_strict(
            **kwargs,
            safe_json_obj=_safe_json_obj,
            exec_read_book_text_tool=_exec_read_book_text_tool,
            log_event=log_event,
        ),
    )


def _run_coarse_reading_chunked(
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
    stream: bool,
    think: bool,
    full_text: str,
    max_input_chars: int,
    max_output_chars: int,
    lecture_id: str,
    book_id: str,
    on_delta,
    cancel_key: str,
    summary_review_model_name: str = "",
    summary_review_temperature: float = 0.1,
    summary_review_max_tokens: int = 900,
    summary_review_timeout: int = 120,
    summary_review_stream: bool = True,
    summary_review_think: bool = False,
) -> str:
    """粗读模型两阶段执行：第一阶段建骨架，第二阶段仅补摘要。"""
    total_len = len(full_text)
    if total_len <= 0:
        return ""
    chapters: List[Dict[str, str]] = _parse_existing_chapters(load_book_info_xml(_CFG, lecture_id, book_id))
    seen_signatures: set[str] = set(_chapter_signature(row) for row in chapters)
    last_chapter_ordinal = 0
    for _row in chapters:
        _ordinal = _parse_chapter_ordinal(str((_row or {}).get("chapter_name") or ""))
        if _ordinal is not None and _ordinal > last_chapter_ordinal:
            last_chapter_ordinal = _ordinal
    merged_output = _render_chapters_xml(chapters)
    outline_built = bool(chapters)
    done_marked = False
    tempmem_key = _job_key(lecture_id, book_id)
    _set_tempmem_rows(tempmem_key, [])
    _set_read_progress(tempmem_key, {"max_end": 0, "calls": 0, "last_offset": 0, "last_length": 0})
    chunk_size = max(2000, int(max_input_chars))
    chunk_count = max(1, (total_len + chunk_size - 1) // chunk_size)
    resume_round = 1
    resume_reason = "initial"

    def _save_chapter_tool(chapter_name: str, chapter_range: str, chapter_summary: str) -> Dict[str, Any]:
        nonlocal merged_output
        name = str(chapter_name or "").strip()
        rng = str(chapter_range or "").strip()
        summary = str(chapter_summary or "").strip()
        status = _chapter_status_from_summary(summary)
        # 容错：部分模型会错误地把整段 XML 塞进 chapter_name。
        # 这里尽量抽回三个字段，避免因此无限重试。
        if ("<chapter_" in name.lower()) or ("</chapter_" in name.lower()):
            try:
                extracted_name = re.search(r"<chapter_name>\s*(.*?)\s*</chapter_name>", name, flags=re.IGNORECASE | re.DOTALL)
                extracted_range = re.search(r"<chapter_range>\s*(.*?)\s*</chapter_range>", name, flags=re.IGNORECASE | re.DOTALL)
                extracted_summary = re.search(r"<chapter_summary>\s*(.*?)\s*</chapter_summary>", name, flags=re.IGNORECASE | re.DOTALL)
                if extracted_name:
                    name = str(extracted_name.group(1) or "").strip()
                if (not rng) and extracted_range:
                    rng = str(extracted_range.group(1) or "").strip()
                if (not summary) and extracted_summary:
                    summary = str(extracted_summary.group(1) or "").strip()
            except Exception:
                pass
        if not name:
            return {"ok": False, "error": "chapter_name is required"}
        if not re.match(r"^\d+:\d+$", rng):
            return {"ok": False, "error": "chapter_range must be START:LENGTH"}
        try:
            _start_s, _len_s = rng.split(":", 1)
            _range_len = int(_len_s)
        except Exception:
            return {"ok": False, "error": "chapter_range parse failed"}
        if _range_len <= 0:
            return {"ok": False, "error": "chapter_range length must be > 0"}
        if _range_len > 30000:
            return {"ok": False, "error": "chapter_range length too large (>30000), split into smaller chapters"}
        chapter_ordinal = _parse_chapter_ordinal(name)
        if chapter_ordinal is not None and chapter_ordinal < last_chapter_ordinal:
            return {
                "ok": False,
                "error": (
                    f"chapter order regression detected: current chapter ordinal {chapter_ordinal} "
                    f"must not be smaller than last saved ordinal {last_chapter_ordinal}. "
                    "Use update_chapter only if you need to revise the latest chapter; otherwise keep reading forward."
                ),
                "action_required": "read_forward",
                "last_chapter_ordinal": int(last_chapter_ordinal),
                "chapter_ordinal": int(chapter_ordinal),
            }
        # Merge policy: chapter_range is the primary key for one chapter slot.
        # If same range already exists, overwrite the old chapter to avoid duplicates.
        for idx, old_row in enumerate(chapters):
            if str(old_row.get("chapter_range") or "").strip() == rng:
                old_sig = _chapter_signature(old_row)
                if old_sig in seen_signatures:
                    seen_signatures.discard(old_sig)
                chapters[idx] = {
                    "chapter_name": name,
                    "chapter_range": rng,
                    "chapter_summary": summary,
                    "chapter_status": status,
                }
                seen_signatures.add(_chapter_signature(chapters[idx]))
                merged_output = _render_chapters_xml(chapters)
                save_book_info_xml(_CFG, lecture_id, book_id, merged_output)
                if chapter_ordinal is not None and chapter_ordinal > last_chapter_ordinal:
                    last_chapter_ordinal = chapter_ordinal
                log_event(
                    "bookinfo_realtime_update",
                    "粗读章节同范围覆盖更新",
                    payload={"resume_round": int(resume_round), "chapters_count": len(chapters)},
                    content=f"{name} | {rng}",
                )
                log_model_text(
                    f"[save_chapter:update-by-range]\nchapter_name={name}\nchapter_range={rng}\nchapter_summary={summary}",
                    source="save_chapter",
                )
                return {
                    "ok": True,
                    "dedup": False,
                    "updated": True,
                    "chapters_count": len(chapters),
                    "chapter_status": status,
                    "completed_chapters": _count_completed_chapters(chapters),
                }

        row = {"chapter_name": name, "chapter_range": rng, "chapter_summary": summary, "chapter_status": status}
        sig = _chapter_signature(row)
        if sig in seen_signatures:
            return {
                "ok": False,
                "dedup": True,
                "error": "duplicate chapter content detected; do not call write again for the same chapter. Use update_chapter to revise existing content.",
                "action_required": "update_chapter",
                "chapter_range": rng,
                "chapter_name": name,
                "chapters_count": len(chapters),
            }
        seen_signatures.add(sig)
        chapters.append(row)
        merged_output = _render_chapters_xml(chapters)
        save_book_info_xml(_CFG, lecture_id, book_id, merged_output)
        if chapter_ordinal is not None and chapter_ordinal > last_chapter_ordinal:
            last_chapter_ordinal = chapter_ordinal
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
        return {
            "ok": True,
            "dedup": False,
            "chapters_count": len(chapters),
            "chapter_status": status,
            "completed_chapters": _count_completed_chapters(chapters),
        }

    def _update_chapter_tool(
        chapter_range: str,
        chapter_name: str,
        chapter_summary: str,
        old_chapter_name: str = "",
    ) -> Dict[str, Any]:
        nonlocal merged_output
        target_range = str(chapter_range or "").strip()
        new_name = str(chapter_name or "").strip()
        new_summary = str(chapter_summary or "").strip()
        old_name = str(old_chapter_name or "").strip()
        if not target_range:
            return {"ok": False, "error": "chapter_range is required"}
        if not new_name:
            return {"ok": False, "error": "chapter_name is required"}
        status = _chapter_status_from_summary(new_summary)
        target_idx = -1
        if old_name:
            for idx, row in enumerate(chapters):
                if str(row.get("chapter_range") or "").strip() == target_range and str(row.get("chapter_name") or "").strip() == old_name:
                    target_idx = idx
                    break
        if target_idx < 0:
            for idx, row in enumerate(chapters):
                if str(row.get("chapter_range") or "").strip() == target_range:
                    target_idx = idx
                    break
        if target_idx < 0:
            return {"ok": False, "error": "target chapter not found"}

        old_row = dict(chapters[target_idx])
        old_sig = _chapter_signature(old_row)
        if old_sig in seen_signatures:
            seen_signatures.discard(old_sig)
        chapters[target_idx] = {
            "chapter_name": new_name,
            "chapter_range": target_range,
            "chapter_summary": new_summary,
            "chapter_status": status,
        }
        seen_signatures.add(_chapter_signature(chapters[target_idx]))
        merged_output = _render_chapters_xml(chapters)
        save_book_info_xml(_CFG, lecture_id, book_id, merged_output)
        log_event(
            "bookinfo_realtime_update",
            "粗读章节修订写入",
            payload={"resume_round": int(resume_round), "chapter_range": target_range},
            content=f"{old_row.get('chapter_name') or ''} -> {new_name}",
        )
        log_model_text(
            f"[update_chapter]\nchapter_range={target_range}\nold_name={old_name or old_row.get('chapter_name') or ''}\nchapter_name={new_name}\nchapter_summary={new_summary}",
            source="update_chapter",
        )
        return {
            "ok": True,
            "updated": True,
            "chapters_count": len(chapters),
            "chapter_status": status,
            "completed_chapters": _count_completed_chapters(chapters),
        }

    def _update_chapter_summary_tool(chapter_range: str, chapter_summary: str) -> Dict[str, Any]:
        nonlocal merged_output
        target_range = str(chapter_range or "").strip()
        new_summary = _normalize_chapter_summary(str(chapter_summary or "").strip())
        if not target_range:
            return {"ok": False, "error": "chapter_range is required"}
        if not new_summary:
            return {"ok": False, "error": "chapter_summary is required"}
        src_text = _get_text_by_range(full_text, target_range)
        review = _review_summary_with_model(
            runner=runner,
            review_model_name=summary_review_model_name,
            chapter_range=target_range,
            source_text=src_text,
            summary_text=new_summary,
            temperature=float(summary_review_temperature),
            max_tokens=int(summary_review_max_tokens),
            request_timeout=int(summary_review_timeout),
            stream=bool(summary_review_stream),
            think=bool(summary_review_think),
        )
        if not bool(review.get("pass")):
            return {
                "ok": False,
                "error": "summary_quality_not_enough",
                "quality_feedback": str(review.get("reason") or ""),
                "quality_detail": review,
            }
        target_idx = -1
        for idx, row in enumerate(chapters):
            if str(row.get("chapter_range") or "").strip() == target_range:
                target_idx = idx
                break
        if target_idx < 0:
            return {"ok": False, "error": "chapter_range not found in current outline"}
        old_row = dict(chapters[target_idx])
        fixed_name = str(old_row.get("chapter_name") or "").strip()
        chapters[target_idx] = {
            "chapter_name": fixed_name,
            "chapter_range": target_range,
            "chapter_summary": new_summary,
            "chapter_status": _chapter_status_from_summary(new_summary),
        }
        seen_signatures.add(_chapter_signature(chapters[target_idx]))
        merged_output = _render_chapters_xml(chapters)
        save_book_info_xml(_CFG, lecture_id, book_id, merged_output)
        log_event(
            "bookinfo_realtime_update",
            "粗读章节摘要写入",
            payload={"resume_round": int(resume_round), "chapter_range": target_range},
            content=f"{fixed_name} | {target_range}",
        )
        log_model_text(
            f"[update_summary]\nchapter_range={target_range}\nchapter_name={fixed_name}\nchapter_summary={new_summary}",
            source="update_summary",
        )
        return {
            "ok": True,
            "updated": True,
            "chapter_name": fixed_name,
            "chapter_range": target_range,
            "chapter_status": "done",
            "chapters_count": len(chapters),
            "completed_chapters": _count_completed_chapters(chapters),
        }

    def _mark_book_done_tool() -> Dict[str, Any]:
        nonlocal done_marked
        # `done` tool is treated as current chunk completion only.
        # Full-book completion should be decided by chunk loop progress or explicit <DONE> marker.
        done_marked = False
        return {"ok": True, "done": True}

    section_plan = _discover_coarse_sections(full_text)
    planned_sections = list(section_plan.get("sections") or [])
    plan_mode = str(section_plan.get("mode") or "fallback").strip()
    heading_candidates = list(section_plan.get("candidates") or [])
    if plan_mode == "model_planning" and heading_candidates:
        planning_result = _run_coarse_section_planning(
            runner=runner,
            lecture_id=lecture_id,
            book_id=book_id,
            lecture_name=lecture_name,
            book_name=book_name,
            model_name=model_name,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            request_timeout=request_timeout,
            stream=stream,
            think=think,
            full_text=full_text,
            heading_candidates=heading_candidates,
            on_delta=on_delta,
        )
        planned_sections = list(planning_result.get("sections") or [])
        plan_mode = "sectioned" if planned_sections else "fallback"
        if planned_sections:
            section_plan["reason"] = "model_section_plan" if str(planning_result.get("raw_text") or "").strip() else "tool_auto_outline"
        else:
            section_plan["reason"] = "model_section_plan_empty"
        if planned_sections:
            chapters = []
            seen_signatures.clear()
            for section in planned_sections:
                section_name = str(section.get("chapter_name") or "").strip()
                start = int(section.get("start") or 0)
                end = int(section.get("end") or 0)
                if not section_name or end <= start:
                    continue
                row = {
                    "chapter_name": section_name,
                    "chapter_range": f"{start}:{end - start}",
                    "chapter_summary": "",
                    "chapter_status": "pending",
                }
                chapters.append(row)
                seen_signatures.add(_chapter_signature(row))
            merged_output = _render_chapters_xml(chapters)
            if chapters:
                outline_built = True
                save_book_info_xml(_CFG, lecture_id, book_id, merged_output)
                log_event(
                    "bookinfo_outline_written",
                    "第一阶段目录骨架已写入 bookinfo.xml",
                    payload={"lecture_id": lecture_id, "book_id": book_id, "chapters_count": len(chapters)},
                    content=merged_output[:12000],
                )
    log_event(
        "coarse_section_discovery",
        "概读分节发现阶段",
        payload={
            "lecture_id": lecture_id,
            "book_id": book_id,
            "mode": plan_mode,
            "sections_count": len(planned_sections),
            "reason": str(section_plan.get("reason") or ""),
        },
        content=_format_section_plan(planned_sections)[:12000],
    )
    section_plan_reliable = plan_mode == "sectioned" and bool(planned_sections)
    if not section_plan_reliable:
        raise RuntimeError(
            "phase 1 failed: no reliable outline generated. "
            "coarse reading has no fallback mode now, please rerun outline phase."
        )

    section_output = _run_coarse_reading_sectioned_summary_only(
        runner=runner,
        request_text=request_text,
        lecture_name=lecture_name,
        book_name=book_name,
        model_name=model_name,
        api_mode=api_mode,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        request_timeout=request_timeout,
        stream=stream,
        think=think,
        full_text=full_text,
        lecture_id=lecture_id,
        book_id=book_id,
        planned_sections=planned_sections,
        previous_rough_summary=merged_output,
        tempmem_key=tempmem_key,
        on_delta=on_delta,
        on_update_summary=_update_chapter_summary_tool,
        cancel_key=cancel_key,
    )
    if str(section_output or "").strip():
        merged_output = str(section_output or "").strip()
    chapters = _parse_existing_chapters(merged_output)
    all_done = _all_chapters_completed(chapters) and len(chapters) == len(planned_sections)
    return {
        "status": "done" if all_done else "outlined",
        "content": str(merged_output or "").strip(),
        "outline_built": True,
        "completed_chapters": _count_completed_chapters(chapters),
        "chapters_count": len(chapters),
        "fulltext_complete": bool(all_done),
        "max_read_end": 0,
        "max_saved_end": _max_chapter_end(chapters),
    }


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
    stream: bool,
    think: bool,
    full_text: str,
    total_len: int,
    resume_round: int,
    resume_reason: str,
    chunk_start: int,
    chunk_end: int,
    chunk_index: int,
    chunk_count: int,
    previous_rough_summary: str,
    tempmem_key: str,
    on_delta,
    on_save_chapter,
    on_update_chapter,
    on_mark_done,
    section_mode: bool = False,
    current_section: Optional[Mapping[str, Any]] = None,
    rolling_read_window: bool = False,
) -> Dict[str, Any]:
    """单轮粗读：使用工具读书并写章节，输出文本仅作调试。"""
    tools = _build_rough_read_tools()
    effective_stream = bool(stream)
    # if effective_stream:
    #     # 工具调用在部分上游（尤其 OpenAI-compatible + 本地模型）对 stream 支持不稳定：
    #     # 可能只返回规划文本而不返回 tool_calls。这里强制降级到非流式，优先保证工具可用性。
    #     effective_stream = False
    #     log_event(
    #         "model_tool_stream_downgrade",
    #         "工具模式自动禁用 stream",
    #         payload={"resume_round": int(resume_round), "reason": "tool_calls_reliability"},
    #         content="stream=true downgraded to stream=false for tool-driven round",
    #     )
    max_turns = 18
    force_done_trigger_turns = 4
    output_text = ""
    assistant_concat: List[str] = []
    round_context_chars = 0
    context_rolled = False
    saved_chapter_calls = 0
    total_tool_calls = 0
    chunk_done = False
    no_done_turn_streak = 0
    force_done_injected = False
    turn_history: List[Dict[str, Any]] = []
    read_seen: Dict[str, int] = {}
    last_read_end = 0

    for turn in range(1, max_turns + 1):
        force_round_active = (no_done_turn_streak >= force_done_trigger_turns) and (not force_done_injected)
        if force_round_active:
            force_done_injected = True
        prompt_vars = {
            "lecture_name": str(lecture_name or ""),
            "book_name": str(book_name or ""),
            "book_total_chars": str(total_len),
            "resume_round": str(resume_round),
            "resume_reason": str(resume_reason),
            "chunk_start": str(int(chunk_start)),
            "chunk_end": str(int(chunk_end)),
            "chunk_length": str(max(0, int(chunk_end) - int(chunk_start))),
            "chunk_index": str(int(chunk_index)),
            "chunk_count": str(int(chunk_count)),
            "previous_rough_summary": str(previous_rough_summary or ""),
            "tempmem_dump": _format_tempmem_dump(_get_tempmem_rows(tempmem_key)),
        }
        if section_mode and current_section:
            prompt_vars["section_mode"] = "sectioned"
            prompt_vars["section_title_hint"] = str(current_section.get("chapter_name") or "").strip()
            prompt_vars["section_range_hint"] = str(current_section.get("range") or "").strip()
        else:
            prompt_vars["section_mode"] = "fallback_fulltext"
            prompt_vars["section_title_hint"] = ""
            prompt_vars["section_range_hint"] = ""
        context = runner.context_manager.build_context({"lecture_name": lecture_name, "book_name": book_name})
        prompt_pack = runner.get_prompt_templates()
        system_prompt = runner.context_manager.render(prompt_pack["system"], context, {"request": request_text, **prompt_vars})
        user_prompt = runner.context_manager.render(prompt_pack["user"], context, {"request": request_text, **prompt_vars})
        if force_round_active:
            hard_constraint = (
                "\n\n[HARD_CONSTRAINT_ROUND]\n"
                "你已经连续多轮未调用 done。"
                "本轮你必须立刻完成以下三项工具调用并结束：\n"
                "1) savemem(...)\n"
                "2) write(...)\n"
                "3) done(...)\n"
                "严禁仅输出计划文本；严禁只读不写；本轮未满足将视为失败。"
            )
            user_prompt = f"{user_prompt}{hard_constraint}"
            log_event(
                "model_hard_constraint_round",
                "触发硬约束回合（必须 savemem + write + done）",
                payload={"resume_round": int(resume_round), "turn": int(turn), "streak": int(no_done_turn_streak)},
                content="",
            )
        messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]
        if turn_history:
            messages.extend(turn_history)
        response = runner.nexora_client.proxy.chat_completions(
            messages=messages,
            model=model_name or runner.model_name,
            username=None,
            options={
                "temperature": temperature,
                "max_tokens": max_output_tokens,
                "stream": bool(effective_stream),
                "think": bool(think),
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
        raw_tool_calls = msg.get("tool_calls") if isinstance(msg.get("tool_calls"), list) else []
        tool_calls: List[Dict[str, Any]] = []
        for raw_call in raw_tool_calls:
            if not isinstance(raw_call, dict):
                continue
            raw_func = raw_call.get("function") if isinstance(raw_call.get("function"), dict) else {}
            normalized_name = str(raw_func.get("name") or "").strip()
            normalized_args_obj = _safe_json_obj(str(raw_func.get("arguments") or "{}"))
            normalized_call: Dict[str, Any] = {
                "id": str(raw_call.get("id") or ""),
                "type": "function",
                "function": {
                    "name": normalized_name,
                    "arguments": _safe_json_dumps(normalized_args_obj),
                },
            }
            tool_calls.append(normalized_call)
        round_context_chars += len(assistant_content)
        if assistant_content.strip():
            assistant_concat.append(assistant_content)
            log_model_text(assistant_content, source="assistant_content")
        turn_history.append(
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
            # Assistant-only planning text is not accepted as valid progress in tool-driven mode.
            if assistant_content.strip():
                log_event(
                    "model_no_tool_progress",
                    "模型未调用工具，仅返回规划文本",
                    payload={"resume_round": int(resume_round), "turn": int(turn)},
                    content=assistant_content[:1200],
                )
            output_text = ""
            continue

        stop_this_round = False
        turn_has_write = False
        turn_has_savemem = False
        turn_has_done = False
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
            if tool_name in {"read", "read_book_text"}:
                req_offset = int(args_obj.get("offset") or 0)
                req_length = int(args_obj.get("length") or 0)
                allow_out_of_chunk = bool(args_obj.get("allow_out_of_chunk") is True)
                if not allow_out_of_chunk:
                    if req_offset < chunk_start:
                        req_offset = chunk_start
                    if req_offset >= chunk_end:
                        req_offset = max(chunk_start, chunk_end - 1)
                    max_len_in_chunk = max(1, chunk_end - req_offset)
                    if req_length > max_len_in_chunk:
                        req_length = max_len_in_chunk
                    args_obj["offset"] = req_offset
                    args_obj["length"] = req_length
                read_key = f"{req_offset}:{req_length}"
                read_seen[read_key] = int(read_seen.get(read_key) or 0) + 1
                if read_seen[read_key] >= 2:
                    # Backend guard: auto-advance when model repeatedly reads same range.
                    safe_next_offset = max(last_read_end, req_offset + max(1, min(req_length, 5000)))
                    if safe_next_offset < total_len:
                        args_obj["offset"] = safe_next_offset
                        log_event(
                            "model_read_guard_shift",
                            "检测到重复读取同一区间，后端自动推进 offset",
                            payload={
                                "resume_round": int(resume_round),
                                "turn": int(turn),
                                "from_offset": int(req_offset),
                                "to_offset": int(safe_next_offset),
                                "length": int(req_length),
                            },
                            content="",
                        )
                result_obj = _exec_read_book_text_tool(full_text=full_text, total_len=total_len, arguments=args_obj)
                _update_read_progress(
                    tempmem_key,
                    offset=int(result_obj.get("offset") or 0),
                    length=int(result_obj.get("length") or 0),
                )
                last_read_end = max(last_read_end, int(result_obj.get("offset") or 0) + int(result_obj.get("length") or 0))
            elif tool_name in {"savemem", "save_tempmem"}:
                result_obj = _exec_save_tempmem_tool(tempmem_key=tempmem_key, arguments=args_obj)
                turn_has_savemem = True
            elif tool_name in {"write", "save_chapter"}:
                result_obj = on_save_chapter(
                    str(args_obj.get("chapter_name") or ""),
                    str(args_obj.get("chapter_range") or ""),
                    str(args_obj.get("chapter_summary") or ""),
                )
                if bool(result_obj.get("ok")):
                    saved_chapter_calls += 1
                    turn_history = []
                    chunk_done = True
                    turn_has_done = True
                    done_marked = True
                    log_event(
                        "model_tool_history_trim",
                        "write 后清空工具历史上下文",
                        payload={"resume_round": int(resume_round), "turn": int(turn)},
                        content="",
                    )
                turn_has_write = True
                if bool(result_obj.get("dedup")) or str(result_obj.get("action_required") or "").strip() == "update_chapter":
                    turn_history = []
                    turn_history.append(
                        {
                            "role": "user",
                            "content": (
                                "你刚刚对已存在章节重复 write 了。"
                                "不要再次 write 相同章节。"
                                "如果要修改已有章节，下一轮必须调用 update_chapter，"
                                "并使用同一个 chapter_range 更新标题或摘要。"
                            ),
                        }
                    )
                    log_event(
                        "model_duplicate_write_guidance",
                        "检测到重复 write，明确要求模型改用 update_chapter",
                        payload={
                            "resume_round": int(resume_round),
                            "turn": int(turn),
                            "chapter_range": str(result_obj.get("chapter_range") or ""),
                            "chapter_name": str(result_obj.get("chapter_name") or ""),
                        },
                        content=str(result_obj.get("error") or ""),
                    )
            elif tool_name in {"update_chapter"}:
                result_obj = on_update_chapter(
                    str(args_obj.get("chapter_range") or ""),
                    str(args_obj.get("chapter_name") or ""),
                    str(args_obj.get("chapter_summary") or ""),
                    str(args_obj.get("old_chapter_name") or ""),
                )
                if bool(result_obj.get("ok")):
                    saved_chapter_calls += 1
                    turn_history = []
                    chunk_done = True
                    turn_has_done = True
                    done_marked = True
                    log_event(
                        "model_tool_history_trim",
                        "update_chapter 后清空工具历史上下文",
                        payload={"resume_round": int(resume_round), "turn": int(turn)},
                        content="",
                    )
                turn_has_write = True
            elif tool_name in {"mark_book_done", "done"}:
                result_obj = on_mark_done()
                chunk_done = True
                turn_has_done = True
            else:
                result_obj = {"ok": False, "error": f"unsupported tool: {tool_name}"}
            inject_tool_history = tool_name in {"read", "write", "save_chapter", "update_chapter"}
            if inject_tool_history:
                if rolling_read_window and tool_name in {"read", "read_book_text"}:
                    turn_history = [msg for msg in turn_history if not _is_read_tool_message(msg)]
                turn_history.append({"role": "tool", "tool_call_id": call_id, "content": _safe_json_dumps(result_obj)})
            if tool_name in {"read"}:
                text_part = str(result_obj.get("text") or "")
                round_context_chars += len(text_part)
            log_tool_flow(
                tool_name=tool_name,
                arguments=args_obj,
                tool_output=result_obj,
                model_output=assistant_content,
            )
            log_event(
                "model_tool_result",
                "粗读模型工具结果",
                payload={"resume_round": int(resume_round), "turn": int(turn), "tool_name": tool_name, "tool_call_id": call_id},
                content=_safe_json_dumps(result_obj)[:2400],
            )
            next_messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]
            if turn_history:
                next_messages.extend(turn_history)
            try:
                next_context_chars = len(_safe_json_dumps(next_messages))
            except Exception:
                next_context_chars = 0
            log_event(
                "model_context_size",
                "current context size (with tool outputs)",
                payload={
                    "resume_round": int(resume_round),
                    "turn": int(turn),
                    "tool_name": tool_name,
                    "messages_count": len(next_messages),
                    "context_chars": int(next_context_chars),
                },
                content="",
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
        if force_round_active:
            if not (turn_has_savemem and turn_has_write and turn_has_done):
                missing = []
                if not turn_has_savemem:
                    missing.append("savemem")
                if not turn_has_write:
                    missing.append("write")
                if not turn_has_done:
                    missing.append("done")
                log_event(
                    "model_hard_constraint_miss",
                    "硬约束回合未满足必需工具调用",
                    payload={"resume_round": int(resume_round), "turn": int(turn), "missing": missing},
                    content="",
                )
                turn_history.append(
                    {
                        "role": "user",
                        "content": (
                            "你刚刚未满足硬约束。"
                            f"缺失工具: {', '.join(missing)}。"
                            "下一轮必须先调用缺失工具并完成 done。"
                        ),
                    }
                )
                no_done_turn_streak += 1
                continue
        if stop_this_round:
            break
        if turn_has_done:
            no_done_turn_streak = 0
        else:
            no_done_turn_streak += 1
        if chunk_done:
            break
    assistant_text = str(output_text).strip() if output_text.strip() else "\n".join([part for part in assistant_concat if str(part or "").strip()]).strip()
    return {
        "assistant_text": assistant_text,
        "context_rolled": context_rolled,
        "saved_chapter_calls": saved_chapter_calls,
        "tool_calls": total_tool_calls,
        "context_chars": round_context_chars,
        "chunk_done": bool(chunk_done),
    }


def _run_coarse_reading_sectioned(
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
    stream: bool,
    think: bool,
    full_text: str,
    lecture_id: str,
    book_id: str,
    planned_sections: List[Dict[str, Any]],
    previous_rough_summary: str,
    tempmem_key: str,
    on_delta,
    on_save_chapter,
    on_update_chapter,
    on_mark_done,
    cancel_key: str,
) -> str:
    """按已发现的章节区间逐章概读，正常路径优先走这里。"""
    total_len = len(full_text)
    merged_output = str(previous_rough_summary or "")
    resume_round = 1
    for section_index, section in enumerate(planned_sections):
        if _is_cancelled_key(cancel_key):
            raise RuntimeError("cancelled by admin")
        chapter_name = str(section.get("chapter_name") or "").strip()
        chunk_start = int(section.get("start") or 0)
        chunk_end = int(section.get("end") or total_len)
        chunk_end = max(chunk_start + 1, min(total_len, chunk_end))
        chapter_range = f"{chunk_start}:{max(1, chunk_end - chunk_start)}"
        preload_len = max(1, chunk_end - chunk_start)
        preload_start = chunk_start
        preload_end = chunk_end
        chapter_preload_text = full_text[preload_start:preload_end]
        existing_rows = _parse_existing_chapters(load_book_info_xml(_CFG, lecture_id, book_id))
        existing_row = None
        for row in existing_rows:
            if str(row.get("chapter_range") or "").strip() == chapter_range:
                existing_row = row
                break
        if existing_row and str(existing_row.get("chapter_status") or "").strip().lower() == "done":
            continue
        round_result = _run_tool_driven_resume_round(
            runner=runner,
            request_text=(
                f"{request_text}\n"
                "当前任务不是全文兜底概读，而是对已分节章节做概括。"
                f" 当前章节标题候选：{chapter_name or '未命名章节'}。"
                " 你必须优先验证这个章节范围并只概括这一章。"
            ),
            lecture_name=lecture_name,
            book_name=book_name,
            model_name=model_name,
            api_mode=api_mode,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            request_timeout=request_timeout,
            stream=stream,
            think=think,
            full_text=full_text,
            total_len=total_len,
            resume_round=resume_round,
            resume_reason="sectioned_summary",
            chunk_start=chunk_start,
            chunk_end=chunk_end,
            chunk_index=section_index,
            chunk_count=len(planned_sections),
            previous_rough_summary=merged_output,
            tempmem_key=tempmem_key,
            on_delta=on_delta,
            on_save_chapter=on_save_chapter,
            on_update_chapter=on_update_chapter,
            on_mark_done=on_mark_done,
            section_mode=True,
            current_section=section,
            rolling_read_window=False,
        )
        assistant_piece = str((round_result or {}).get("assistant_text") or "").strip()
        if assistant_piece:
            merged_output = _render_chapters_xml(_parse_existing_chapters(load_book_info_xml(_CFG, lecture_id, book_id)))
        resume_round += 1
    return merged_output


def _run_coarse_reading_sectioned_summary_only(
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
    stream: bool,
    think: bool,
    full_text: str,
    lecture_id: str,
    book_id: str,
    planned_sections: List[Dict[str, Any]],
    previous_rough_summary: str,
    tempmem_key: str,
    on_delta,
    on_update_summary,
    cancel_key: str,
) -> str:
    """Strict phase-2 summary filler: only update summary/status for existing outline rows."""
    total_len = len(full_text)
    merged_output = str(previous_rough_summary or "")
    resume_round = 1
    effective_stream = bool(stream)

    def _clamp_to_section(args: Dict[str, Any], start: int, end: int) -> Dict[str, Any]:
        safe = dict(args or {})
        try:
            offset = int(safe.get("offset") or start)
        except Exception:
            offset = start
        try:
            length = int(safe.get("length") or min(1500, max(1, end - start)))
        except Exception:
            length = min(1500, max(1, end - start))
        offset = max(start, min(max(start, end - 1), offset))
        max_len = max(1, end - offset)
        length = max(1, min(length, max_len))
        safe["offset"] = offset
        safe["length"] = length
        try:
            range_start = int(safe.get("range_start") or start)
        except Exception:
            range_start = start
        try:
            range_end = int(safe.get("range_end") or end)
        except Exception:
            range_end = end
        range_start = max(start, min(end, range_start))
        range_end = max(range_start, min(end, range_end))
        safe["range_start"] = range_start
        safe["range_end"] = range_end
        return safe

    def _merge_covered_range(ranges: List[Tuple[int, int]], start: int, end: int) -> None:
        if end <= start:
            return
        ranges.append((int(start), int(end)))
        ranges.sort(key=lambda row: row[0])
        merged: List[Tuple[int, int]] = []
        for cur_start, cur_end in ranges:
            if not merged or cur_start > merged[-1][1]:
                merged.append((cur_start, cur_end))
            else:
                prev_start, prev_end = merged[-1]
                merged[-1] = (prev_start, max(prev_end, cur_end))
        ranges.clear()
        ranges.extend(merged)

    def _covered_chars(ranges: List[Tuple[int, int]]) -> int:
        total = 0
        for start, end in ranges:
            total += max(0, int(end) - int(start))
        return total
    for section_index, section in enumerate(planned_sections):
        if _is_cancelled_key(cancel_key):
            raise RuntimeError("cancelled by admin")
        chapter_name = str(section.get("chapter_name") or "").strip()
        chunk_start = int(section.get("start") or 0)
        chunk_end = int(section.get("end") or total_len)
        chunk_end = max(chunk_start + 1, min(total_len, chunk_end))
        chapter_range = f"{chunk_start}:{max(1, chunk_end - chunk_start)}"
        preload_len = min(10000, max(1, chunk_end - chunk_start))
        preload_start = chunk_start
        preload_end = min(chunk_end, preload_start + preload_len)
        chapter_preload_text = full_text[preload_start:preload_end]
        existing_rows = _parse_existing_chapters(load_book_info_xml(_CFG, lecture_id, book_id))
        existing_row = None
        for row in existing_rows:
            if str(row.get("chapter_range") or "").strip() == chapter_range:
                existing_row = row
                break
        if existing_row and str(existing_row.get("chapter_status") or "").strip().lower() == "done":
            resume_round += 1
            continue

        summary_system_tpl = _load_prompt_text(
            "coarse_section_summary.system",
            str(getattr(prompts, "COARSE_SECTION_SUMMARY_SYSTEM_PROMPT", "") or ""),
        )
        summary_user_tpl = _load_prompt_text(
            "coarse_section_summary.user",
            str(getattr(prompts, "COARSE_SECTION_SUMMARY_USER_PROMPT", "") or ""),
        )
        system_prompt = _render_prompt(summary_system_tpl, {})
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "read",
                    "description": "Read a slice of the current book.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "offset": {"type": "integer"},
                            "length": {"type": "integer"},
                        },
                        "required": ["offset", "length"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "index",
                    "description": "Find keyword in an optional range and return exact offsets plus nearby context.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "keyword": {"type": "string"},
                            "range_start": {"type": "integer"},
                            "range_end": {"type": "integer"},
                            "context_range": {"type": "integer"},
                            "max_hits": {"type": "integer"},
                        },
                        "required": ["keyword"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "savemem",
                    "description": "Save temporary notes while summarizing this chapter.",
                    "parameters": {
                        "type": "object",
                        "properties": {"note": {"type": "string"}},
                        "required": ["note"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "update_summary",
                    "description": "Write chapter_summary for the current locked chapter_range only.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "chapter_range": {"type": "string"},
                            "chapter_summary": {"type": "string"},
                        },
                        "required": ["chapter_range", "chapter_summary"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "done",
                    "description": "Finish the current chapter summary task.",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                    },
                },
            },
        ]
        turn_history: List[Dict[str, Any]] = []
        section_done = False
        queried_ranges: List[Tuple[int, int]] = []
        latest_quality_feedback = ""
        turn = 0
        while not section_done:
            turn += 1
            _set_book_progress(lecture_id, book_id, f"模型正在阅读章节<{chapter_name or '未命名章节'}>...")
            user_prompt = _render_prompt(
                summary_user_tpl,
                {
                    "request": request_text,
                    "chapter_name": chapter_name or "Untitled Chapter",
                    "chapter_range": chapter_range,
                    "preload_range": f"{preload_start}:{max(1, preload_end - preload_start)}",
                    "chapter_preload": chapter_preload_text,
                    "quality_feedback": latest_quality_feedback,
                },
            )
            request_messages: List[Dict[str, Any]] = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]
            if turn_history:
                request_messages.extend(turn_history)
            log_event(
                "section_summary_round",
                "第二阶段章节摘要轮次",
                payload={
                    "resume_round": int(resume_round),
                    "section_index": int(section_index),
                    "turn": int(turn),
                    "chapter_name": chapter_name,
                    "chapter_range": chapter_range,
                    "stream": bool(effective_stream),
                },
                content="",
            )
            response = runner.nexora_client.proxy.chat_completions(
                messages=request_messages,
                model=model_name or runner.model_name,
                username=None,
                options={
                    "temperature": float(temperature),
                    "max_tokens": int(max_output_tokens),
                    "stream": bool(effective_stream),
                    "think": bool(think),
                    "tools": tools,
                    "tool_choice": "auto",
                },
                use_chat_path=False,
                request_timeout=int(request_timeout),
                on_delta=on_delta,
            )
            if not bool(response.get("ok")):
                raise RuntimeError(f"Nexora API Error: {response.get('message') or 'request failed'}")
            payload = response.get("payload") if isinstance(response.get("payload"), dict) else {}
            choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
            if not choices:
                break
            msg = choices[0].get("message") if isinstance(choices[0], dict) else {}
            assistant_content = str((msg or {}).get("content") or "")
            raw_tool_calls = (msg or {}).get("tool_calls") if isinstance((msg or {}).get("tool_calls"), list) else []
            tool_calls: List[Dict[str, Any]] = []
            for raw_call in raw_tool_calls:
                if not isinstance(raw_call, dict):
                    continue
                raw_func = raw_call.get("function") if isinstance(raw_call.get("function"), dict) else {}
                normalized_name = str(raw_func.get("name") or "").strip()
                normalized_args_obj = _safe_json_obj(str(raw_func.get("arguments") or "{}"))
                tool_calls.append(
                    {
                        "id": str(raw_call.get("id") or ""),
                        "type": "function",
                        "function": {
                            "name": normalized_name,
                            "arguments": _safe_json_dumps(normalized_args_obj),
                        },
                    }
                )
            turn_history.append({"role": "assistant", "content": assistant_content if assistant_content else None, "tool_calls": tool_calls if tool_calls else None})
            if not tool_calls:
                # Relax tool-call hard restriction:
                # if model already produced a plain summary text, persist it directly.
                plain_summary = _normalize_chapter_summary(assistant_content)
                if plain_summary:
                    result_obj = on_update_summary(
                        chapter_range=chapter_range,
                        chapter_summary=plain_summary,
                    )
                    log_event(
                        "section_summary_plain_commit",
                        "第二阶段无工具直出摘要提交",
                        payload={
                            "resume_round": int(resume_round),
                            "section_index": int(section_index),
                            "turn": int(turn),
                            "chapter_range": chapter_range,
                        },
                        content=_safe_json_dumps(result_obj)[:2400],
                    )
                    if bool(result_obj.get("ok")):
                        section_done = True
                        merged_output = _render_chapters_xml(_parse_existing_chapters(load_book_info_xml(_CFG, lecture_id, book_id)))
                        continue
                    latest_quality_feedback = str(
                        result_obj.get("quality_feedback")
                        or result_obj.get("error")
                        or ""
                    ).strip()
                    if latest_quality_feedback:
                        turn_history.append(
                            {
                                "role": "user",
                                "content": (
                                    "summary quality rejected. "
                                    f"feedback: {latest_quality_feedback}. "
                                    "rewrite with concrete details and call update_summary again."
                                ),
                            }
                        )
                turn_history.append(
                    {
                        "role": "user",
                        "content": (
                            "No valid tool call detected. "
                            "Please continue and call update_summary when ready."
                        ),
                    }
                )
                continue
            turn_has_update = False
            turn_has_done = False
            for call in tool_calls:
                if not isinstance(call, dict):
                    continue
                call_id = str(call.get("id") or "")
                func = call.get("function") if isinstance(call.get("function"), dict) else {}
                tool_name = str(func.get("name") or "").strip()
                args_obj = _safe_json_obj(str(func.get("arguments") or "{}"))
                if tool_name in {"read", "read_book_text"}:
                    args_obj = _clamp_to_section(args_obj, chunk_start, chunk_end)
                    # Enforce minimal read size to reduce tiny fragmented reads.
                    try:
                        req_len = int(args_obj.get("length") or 0)
                    except Exception:
                        req_len = 0
                    if (chunk_end - chunk_start) >= 2000 and req_len < 2000:
                        args_obj["length"] = 2000
                        args_obj = _clamp_to_section(args_obj, chunk_start, chunk_end)
                    result_obj = _exec_read_book_text_tool(full_text=full_text, total_len=total_len, arguments=args_obj)
                    read_start = int(result_obj.get("offset") or 0)
                    read_len = int(result_obj.get("length") or 0)
                    _merge_covered_range(queried_ranges, read_start, read_start + read_len)
                    _push_book_progress_step(
                        lecture_id,
                        book_id,
                        {
                            "type": "read",
                            "title": f"读取内容 [{read_start}, {read_start + max(0, read_len)}]",
                            "preview": _preview_plain_text(result_obj.get("text"), 50),
                        },
                    )
                elif tool_name in {"index", "index_book_text"}:
                    args_obj = _clamp_to_section(args_obj, chunk_start, chunk_end)
                    result_obj = _exec_index_book_text_tool(full_text=full_text, total_len=total_len, arguments=args_obj)
                    index_start = int(args_obj.get("range_start") or chunk_start)
                    index_end = int(args_obj.get("range_end") or chunk_end)
                    _merge_covered_range(queried_ranges, index_start, index_end)
                    _push_book_progress_step(
                        lecture_id,
                        book_id,
                        {
                            "type": "index",
                            "title": f"检索关键词 [{index_start}, {index_end}]",
                            "preview": _preview_plain_text(args_obj.get("keyword"), 50),
                        },
                    )
                elif tool_name in {"savemem", "save_tempmem"}:
                    result_obj = _exec_save_tempmem_tool(tempmem_key=tempmem_key, arguments=args_obj)
                    _push_book_progress_step(
                        lecture_id,
                        book_id,
                        {
                            "type": "savemem",
                            "title": "保存临时记忆",
                            "preview": _preview_plain_text(args_obj.get("note"), 50),
                        },
                    )
                elif tool_name == "update_summary":
                    forced_range = str(args_obj.get("chapter_range") or "").strip()
                    if forced_range != chapter_range:
                        result_obj = {
                            "ok": False,
                            "error": "chapter_range mismatch in summary-only phase",
                            "chapter_range": chapter_range,
                        }
                    else:
                        result_obj = on_update_summary(
                            chapter_range=chapter_range,
                            chapter_summary=str(args_obj.get("chapter_summary") or "").strip(),
                        )
                        _push_book_progress_step(
                            lecture_id,
                            book_id,
                            {
                                "type": "update_summary",
                                "title": f"写入章节摘要 {chapter_range}",
                                "preview": _preview_plain_text(args_obj.get("chapter_summary"), 50),
                            },
                        )
                        if bool(result_obj.get("ok")):
                            turn_has_update = True
                            section_done = True
                            latest_quality_feedback = ""
                        else:
                            quality_feedback = str(result_obj.get("quality_feedback") or "")
                            if quality_feedback:
                                latest_quality_feedback = quality_feedback
                                turn_history.append(
                                    {
                                        "role": "user",
                                        "content": (
                                            "summary quality rejected. "
                                            f"feedback: {quality_feedback}. "
                                            "rewrite with concrete events and人物, then call update_summary again."
                                        ),
                                    }
                                )
                elif tool_name == "done":
                    result_obj = {"ok": True, "done": True}
                    _push_book_progress_step(
                        lecture_id,
                        book_id,
                        {
                            "type": "done",
                            "title": "章节处理完成",
                            "preview": "",
                        },
                    )
                    turn_has_done = True
                    if turn_has_update:
                        section_done = True
                else:
                    # Remove hard restriction on unexpected tool names in summary phase.
                    result_obj = {"ok": True, "skipped": True, "tool_name": tool_name}
                if tool_name in {"read", "update_summary", "done"}:
                    turn_history.append({"role": "tool", "tool_call_id": call_id, "content": _safe_json_dumps(result_obj)})
                log_event(
                    "section_summary_tool_result",
                    "第二阶段章节摘要工具结果",
                    payload={
                        "resume_round": int(resume_round),
                        "section_index": int(section_index),
                        "turn": int(turn),
                        "tool_name": tool_name,
                        "tool_call_id": call_id,
                        "chapter_range": chapter_range,
                    },
                    content=_safe_json_dumps(result_obj)[:2400],
                )
            if turn_has_update and not turn_has_done:
                turn_history.append(
                    {
                        "role": "user",
                        "content": "summary saved; stop extra narration. call done or continue next section.",
                    }
                )
            if section_done:
                merged_output = _render_chapters_xml(_parse_existing_chapters(load_book_info_xml(_CFG, lecture_id, book_id)))
                continue
        merged_output = _render_chapters_xml(_parse_existing_chapters(load_book_info_xml(_CFG, lecture_id, book_id)))
        resume_round += 1
    return merged_output


def _run_coarse_section_planning(
    *,
    runner: Any,
    lecture_id: str,
    book_id: str,
    lecture_name: str,
    book_name: str,
    model_name: Optional[str],
    temperature: float,
    max_output_tokens: int,
    request_timeout: int,
    stream: bool,
    think: bool,
    full_text: str,
    heading_candidates: List[str],
    on_delta,
) -> Dict[str, Any]:
    """模型驱动的第一阶段：仅通过工具提交目录骨架。"""
    effective_stream = bool(stream)
    stagnant_rounds = 0
    outline_sections: List[Dict[str, Any]] = []
    outline_submitted = False
    discovered_offsets: Dict[str, int] = {}
    raw_full_text = str(full_text or "")
    body_search_start = 0
    header_block_end = raw_full_text.find("[/EPUB_HEADING_CANDIDATES]")
    if header_block_end >= 0:
        body_search_start = header_block_end + len("[/EPUB_HEADING_CANDIDATES]")
    candidate_block = _format_heading_hints(heading_candidates)
    planning_system_tpl = _load_prompt_text(
        "coarse_section_planning.system",
        str(getattr(prompts, "COARSE_SECTION_PLANNING_SYSTEM_PROMPT", "") or ""),
    )
    planning_user_tpl = _load_prompt_text(
        "coarse_section_planning.user",
        str(getattr(prompts, "COARSE_SECTION_PLANNING_USER_PROMPT", "") or ""),
    )
    prompt = _render_prompt(
        planning_system_tpl,
        {
            "body_search_start": body_search_start,
        },
    )
    user_prompt = _render_prompt(
        planning_user_tpl,
        {
            "lecture_name": lecture_name,
            "book_name": book_name,
            "body_search_start": body_search_start,
            "candidate_block": candidate_block or "(none)",
        },
    )
    tools = [
        {
            "type": "function",
            "function": {
                "name": "read",
                "description": "Read full-book text by global offset and length.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "offset": {"type": "integer"},
                        "length": {"type": "integer"},
                    },
                    "required": ["offset", "length"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "index",
                "description": "Find keyword in a specific range and return exact offsets plus nearby context.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "keyword": {"type": "string"},
                        "range_start": {"type": "integer"},
                        "range_end": {"type": "integer"},
                        "context_range": {"type": "integer"},
                        "max_hits": {"type": "integer"},
                    },
                    "required": ["keyword"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "savemem",
                "description": "Save temporary findings during section planning.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "note": {"type": "string"},
                    },
                    "required": ["note"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "submit_outline",
                "description": "Submit final outline sections. Each section needs chapter_name, start, end.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "sections": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "chapter_name": {"type": "string"},
                                    "start": {"type": "integer"},
                                    "end": {"type": "integer"},
                                },
                                "required": ["chapter_name", "start", "end"],
                            },
                        },
                    },
                    "required": ["sections"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "done",
                "description": "Finish phase 1 after submit_outline succeeds.",
                "parameters": {
                    "type": "object",
                    "properties": {},
                },
            },
        },
    ]
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": user_prompt},
    ]
    turn_history: List[Dict[str, Any]] = []
    assistant_text = ""
    turn = 0
    while not outline_submitted:
        turn += 1
        _set_book_progress(lecture_id, book_id, "模型正在划分章节...")
        request_messages = list(messages)
        if turn_history:
            request_messages.extend(turn_history)
        log_event(
            "section_planning_round",
            "分节规划轮次",
            payload={
                "turn": int(turn),
                "messages_count": len(request_messages),
                "heading_candidates_count": len(heading_candidates),
                "stream": bool(effective_stream),
            },
            content="",
        )
        response = runner.nexora_client.proxy.chat_completions(
            messages=request_messages,
            model=model_name or runner.model_name,
            username=None,
            options={
                "temperature": float(temperature),
                "max_tokens": int(max_output_tokens),
                "stream": bool(effective_stream),
                "think": bool(think),
                "tools": tools,
                "tool_choice": "auto",
            },
            use_chat_path=False,
            request_timeout=int(request_timeout),
            on_delta=on_delta,
        )
        if not bool(response.get("ok")):
            raise RuntimeError(f"Nexora API Error: {response.get('message') or 'request failed'}")
        payload = response.get("payload") if isinstance(response.get("payload"), dict) else {}
        choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
        if not choices:
            break
        msg = choices[0].get("message") if isinstance(choices[0], dict) else {}
        content = str((msg or {}).get("content") or "")
        assistant_text = content or assistant_text
        log_event(
            "section_planning_model_output",
            "分节规划模型输出",
            payload={"turn": int(turn), "assistant_content_len": len(content)},
            content=content[:2400],
        )
        raw_tool_calls = (msg or {}).get("tool_calls") if isinstance((msg or {}).get("tool_calls"), list) else []
        tool_calls: List[Dict[str, Any]] = []
        for raw_call in raw_tool_calls:
            if not isinstance(raw_call, dict):
                continue
            raw_func = raw_call.get("function") if isinstance(raw_call.get("function"), dict) else {}
            normalized_name = str(raw_func.get("name") or "").strip()
            normalized_args_obj = _safe_json_obj(str(raw_func.get("arguments") or "{}"))
            normalized_call: Dict[str, Any] = {
                "id": str(raw_call.get("id") or ""),
                "type": "function",
                "function": {
                    "name": normalized_name,
                    "arguments": _safe_json_dumps(normalized_args_obj),
                },
            }
            tool_calls.append(normalized_call)
        turn_history.append({"role": "assistant", "content": content if content else None, "tool_calls": tool_calls if tool_calls else None})
        if not tool_calls:
            turn_history.append(
                {
                    "role": "user",
                    "content": (
                        "No valid tool call detected. "
                        "You must call submit_outline(sections=[...]) and then done. "
                        "Do not answer in plain text."
                    ),
                }
            )
            stagnant_rounds += 1
            continue
        had_progress = False
        for call in tool_calls:
            if not isinstance(call, dict):
                continue
            call_id = str(call.get("id") or "")
            func = call.get("function") if isinstance(call.get("function"), dict) else {}
            tool_name = str(func.get("name") or "").strip()
            args_obj = _safe_json_obj(str(func.get("arguments") or "{}"))
            log_event(
                "section_planning_tool_call",
                "分节规划工具调用",
                payload={"turn": int(turn), "tool_name": tool_name, "tool_call_id": call_id},
                content=_safe_json_dumps(args_obj)[:1600],
            )
            if tool_name in {"read", "read_book_text"}:
                result_obj = _exec_read_book_text_tool(full_text=full_text, total_len=len(full_text), arguments=args_obj)
            elif tool_name in {"index", "index_book_text"}:
                # Phase-1 guard: always search through full body to avoid model
                # narrowing range_end to a tiny prefix and producing broken outline.
                try:
                    req_start = int(args_obj.get("range_start") or body_search_start)
                except Exception:
                    req_start = body_search_start
                args_obj["range_start"] = max(int(body_search_start), int(req_start))
                args_obj["range_end"] = int(len(full_text))
                result_obj = _exec_index_book_text_tool(full_text=full_text, total_len=len(full_text), arguments=args_obj)
                try:
                    keyword = str(args_obj.get("keyword") or "").strip()
                    hits = result_obj.get("hits") if isinstance(result_obj, dict) else []
                    if keyword and isinstance(hits, list) and hits:
                        first = hits[0] if isinstance(hits[0], dict) else {}
                        offset = int(first.get("offset") or first.get("match_start") or -1)
                        if offset >= 0:
                            prev = discovered_offsets.get(keyword)
                            if prev is None or offset < prev:
                                discovered_offsets[keyword] = offset
                except Exception:
                    pass
            elif tool_name in {"savemem", "save_tempmem"}:
                result_obj = {"ok": True, "saved": True, "note": str(args_obj.get("note") or "").strip()}
            elif tool_name == "submit_outline":
                raw_sections = args_obj.get("sections")
                parsed_sections: List[Dict[str, Any]] = []
                if isinstance(raw_sections, list):
                    for row in raw_sections:
                        if not isinstance(row, dict):
                            continue
                        name = str(row.get("chapter_name") or "").strip()
                        try:
                            start = int(row.get("start"))
                            end = int(row.get("end"))
                        except Exception:
                            continue
                        if not name:
                            continue
                        if end <= start:
                            continue
                        start = max(0, min(len(full_text), start))
                        end = max(start + 1, min(len(full_text), end))
                        parsed_sections.append(
                            {
                                "chapter_name": name,
                                "start": int(start),
                                "end": int(end),
                                "range": f"{start}:{max(1, end - start)}",
                            }
                        )
                parsed_sections.sort(key=lambda item: int(item.get("start") or 0))
                deduped: List[Dict[str, Any]] = []
                last_start = -1
                for row in parsed_sections:
                    current_start = int(row.get("start") or 0)
                    if current_start <= last_start:
                        continue
                    deduped.append(row)
                    last_start = current_start
                if deduped:
                    outline_sections = deduped
                    outline_submitted = True
                    result_obj = {"ok": True, "sections_count": len(outline_sections)}
                else:
                    result_obj = {"ok": False, "error": "sections is empty or invalid"}
            elif tool_name == "done":
                result_obj = {"ok": True, "done": True, "outline_submitted": bool(outline_submitted)}
            else:
                result_obj = {"ok": False, "error": f"unsupported tool: {tool_name}"}
            turn_history.append({"role": "tool", "tool_call_id": call_id, "content": _safe_json_dumps(result_obj)})
            log_event(
                "section_planning_tool_result",
                "分节规划工具结果",
                payload={"turn": int(turn), "tool_name": tool_name, "tool_call_id": call_id},
                content=_safe_json_dumps(result_obj)[:2400],
            )
            had_progress = True
        if outline_submitted and outline_sections:
            break
        if had_progress:
            stagnant_rounds += 1
        else:
            stagnant_rounds += 1
        if stagnant_rounds >= 3:
            log_event(
                "section_planning_stagnant",
                "分节规划连续多轮未提交骨架",
                payload={"turn": int(turn), "stagnant_rounds": int(stagnant_rounds)},
                content="no valid submit_outline tool call produced after repeated tool rounds",
            )
            turn_history.append(
                {
                    "role": "user",
                    "content": (
                        "Hard constraint: this phase cannot finish without submit_outline. "
                        "Call submit_outline(sections=[...]) now."
                    ),
                }
            )
    return {
        "sections": list(outline_sections if outline_submitted and outline_sections else []),
        "raw_text": assistant_text,
    }


def _build_outline_from_discovered_offsets(
    *,
    discovered_offsets: Mapping[str, int],
    heading_candidates: List[str],
    total_len: int,
) -> List[Dict[str, Any]]:
    """用第一阶段工具命中结果自动合成骨架（仅基于工具输出，不读模型正文文本）。"""
    rows: List[Tuple[str, int]] = []
    for title in list(heading_candidates or []):
        key = str(title or "").strip()
        if not key:
            continue
        if key in discovered_offsets:
            try:
                offset = int(discovered_offsets.get(key) or 0)
            except Exception:
                continue
            if offset >= 0:
                rows.append((key, offset))
    # 补充 discovered 中但不在候选顺序里的标题
    for key, raw_offset in dict(discovered_offsets or {}).items():
        title = str(key or "").strip()
        if not title:
            continue
        if any(title == item[0] for item in rows):
            continue
        try:
            offset = int(raw_offset)
        except Exception:
            continue
        if offset >= 0:
            rows.append((title, offset))
    rows.sort(key=lambda item: int(item[1]))
    deduped: List[Tuple[str, int]] = []
    seen_pos: set[int] = set()
    for title, offset in rows:
        if offset in seen_pos:
            continue
        seen_pos.add(offset)
        deduped.append((title, offset))
    sections: List[Dict[str, Any]] = []
    for idx, (title, start) in enumerate(deduped):
        next_start = deduped[idx + 1][1] if idx + 1 < len(deduped) else int(total_len)
        end = max(start + 1, min(int(total_len), int(next_start)))
        if end <= start:
            continue
        sections.append(
            {
                "chapter_name": str(title),
                "start": int(start),
                "end": int(end),
                "range": f"{int(start)}:{max(1, int(end) - int(start))}",
            }
        )
    if sections:
        # Quality gate for auto-outline: prevent a tiny partial hit-set from
        # becoming a giant trailing chapter (for example 9440:234483).
        if len(sections) < 4:
            log_event(
                "section_planning_auto_outline_reject",
                "自动骨架命中数量过少，拒绝写入，避免错误大分段",
                payload={"sections_count": len(sections)},
                content=_format_section_plan(sections)[:2000],
            )
            return []
        total_span = max(1, int(total_len))
        largest_span = max(int(item.get("end") or 0) - int(item.get("start") or 0) for item in sections)
        if largest_span / float(total_span) > 0.75:
            log_event(
                "section_planning_auto_outline_reject",
                "自动骨架存在超大尾章，拒绝写入，避免错误分段",
                payload={
                    "sections_count": len(sections),
                    "largest_span": int(largest_span),
                    "total_len": int(total_span),
                },
                content=_format_section_plan(sections)[:2000],
            )
            return []
        log_event(
            "section_planning_auto_outline",
            "第一阶段未提交骨架，已根据工具命中自动合成骨架",
            payload={"sections_count": len(sections)},
            content=_format_section_plan(sections)[:2400],
        )
    return sections


def _run_intensive_with_tools(
    *,
    runner: Any,
    request_text: str,
    lecture_name: str,
    book_name: str,
    full_text: str,
    chapters_xml: str,
    lecture_id: str,
    book_id: str,
    temperature: float,
    max_output_tokens: int,
    request_timeout: int,
    stream: bool,
    think: bool,
) -> Dict[str, Any]:
    """精读模型工具调用流程：通过 save_book_detail 工具落盘。"""
    saved_xml = ""
    effective_stream = bool(stream)

    def _save_book_detail_tool(bookdetail_xml: str) -> Dict[str, Any]:
        nonlocal saved_xml
        value = str(bookdetail_xml or "").strip()
        if not value:
            return {"ok": False, "error": "bookdetail_xml is required"}
        saved_xml = value
        return {"ok": True, "chars": len(value)}

    prompt_vars = {
        "lecture_name": str(lecture_name or ""),
        "book_name": str(book_name or ""),
        "chapter_name": "ALL",
        "chapter_range": f"0:{len(full_text)}",
        "chapter_context": str(full_text[:120000] or ""),
        "request": request_text,
        "coarse_bookinfo": str(chapters_xml or ""),
    }
    context = runner.context_manager.build_context({"lecture_name": lecture_name, "book_name": book_name})
    prompt_pack = runner.get_prompt_templates()
    system_prompt = runner.context_manager.render(prompt_pack["system"], context, prompt_vars)
    user_prompt = runner.context_manager.render(prompt_pack["user"], context, prompt_vars)
    messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]
    tools = [
        {
            "type": "function",
            "function": {
                "name": "read",
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
                "name": "grep",
                "description": "Search keyword in full book text and return matched ranges with snippets.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "keyword": {"type": "string", "description": "keyword to search"},
                        "context_range": {"type": "integer", "description": "left/right context chars per hit, 20..600"},
                        "max_hits": {"type": "integer", "description": "max number of hits, 1..50"},
                    },
                    "required": ["keyword"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "write",
                "description": "Write intensive-reading output XML to bookdetail.xml",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chapter_name": {"type": "string"},
                        "chapter_range": {"type": "string"},
                        "chapter_summary": {"type": "string"},
                        "bookdetail_xml": {"type": "string"},
                    },
                    "required": ["chapter_name", "chapter_range", "chapter_summary"],
                },
            },
        }
    ]

    response = runner.nexora_client.proxy.chat_completions(
        messages=messages,
        model=runner.model_name,
        username=None,
        options={
            "temperature": float(temperature),
            "max_tokens": int(max_output_tokens),
            "stream": bool(effective_stream),
            "think": bool(think),
            "tools": tools,
            "tool_choice": "auto",
        },
        use_chat_path=False,
        request_timeout=int(request_timeout),
        on_delta=None,
    )
    if not bool(response.get("ok")):
        raise RuntimeError(f"Nexora API Error: {response.get('message') or 'request failed'}")
    payload = response.get("payload") if isinstance(response.get("payload"), dict) else {}
    choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
    if not choices:
        raise RuntimeError("Intensive reading returned empty choices")
    msg = choices[0].get("message") if isinstance(choices[0], dict) else {}
    tool_calls = msg.get("tool_calls") if isinstance(msg, dict) and isinstance(msg.get("tool_calls"), list) else []
    for call in tool_calls:
        if not isinstance(call, dict):
            continue
        func = call.get("function") if isinstance(call.get("function"), dict) else {}
        args = _safe_json_obj(str(func.get("arguments") or "{}"))
        tool_name = str(func.get("name") or "")
        if tool_name in {"write", "save_book_detail"}:
            xml_text = str(args.get("bookdetail_xml") or "").strip()
            if not xml_text:
                chapter_name = str(args.get("chapter_name") or "").strip()
                chapter_range = str(args.get("chapter_range") or "").strip()
                chapter_summary = str(args.get("chapter_summary") or "").strip()
                xml_text = (
                    "<book_detail>\n"
                    f"  <chapter_name>{chapter_name}</chapter_name>\n"
                    f"  <chapter_range>{chapter_range}</chapter_range>\n"
                    f"  <chapter_summary>{chapter_summary}</chapter_summary>\n"
                    "</book_detail>"
                )
            _save_book_detail_tool(xml_text)
            continue
        if tool_name in {"read", "read_book_text"}:
            _exec_read_book_text_tool(full_text=full_text, total_len=len(full_text), arguments=args)
            continue
        if tool_name in {"grep", "search_book_text"}:
            _exec_search_book_text_tool(full_text=full_text, total_len=len(full_text), arguments=args)
            continue
    if not saved_xml:
        content = str(msg.get("content") or "") if isinstance(msg, dict) else ""
        if content.strip():
            saved_xml = content.strip()
    if not saved_xml:
        raise RuntimeError("Intensive model did not output/save book detail content")
    return {
        "bookdetail_xml": saved_xml,
        "model_name": runner.model_name,
        "lecture_id": lecture_id,
        "book_id": book_id,
    }


def _build_rough_read_tools() -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "read",
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
                "name": "savemem",
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
                "name": "write",
                "description": "Persist one finalized chapter result immediately.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chapter_name": {"type": "string"},
                        "chapter_range": {"type": "string", "description": "START:LENGTH, 不是 FROM:TO"},
                        "chapter_summary": {"type": "string"},
                    },
                    "required": ["chapter_name", "chapter_range", "chapter_summary"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "done",
                "description": "Call this only when current chunk has completed required persistence.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
    ]


def _exec_read_book_text_tool(*, full_text: str, total_len: int, arguments: Mapping[str, Any]) -> Dict[str, Any]:
    return runtime_exec_read_book_text_tool(
        full_text=full_text,
        total_len=total_len,
        arguments=arguments,
    )


def _exec_search_book_text_tool(*, full_text: str, total_len: int, arguments: Mapping[str, Any]) -> Dict[str, Any]:
    """??????????????????????"""
    return runtime_exec_search_book_text_tool(
        full_text=full_text,
        total_len=total_len,
        arguments=arguments,
    )

def _exec_index_book_text_tool(*, full_text: str, total_len: int, arguments: Mapping[str, Any]) -> Dict[str, Any]:
    """Locate keyword within an optional range and return exact offsets plus nearby context."""
    keyword = str(arguments.get("keyword") or "").strip()
    if not keyword:
        return {"ok": False, "error": "keyword is required"}
    try:
        range_start = int(arguments.get("range_start") or 0)
    except Exception:
        range_start = 0
    try:
        range_end = int(arguments.get("range_end") or total_len)
    except Exception:
        range_end = total_len
    try:
        context_range = int(arguments.get("context_range") or 180)
    except Exception:
        context_range = 180
    try:
        max_hits = int(arguments.get("max_hits") or 8)
    except Exception:
        max_hits = 8
    range_start = max(0, min(total_len, range_start))
    range_end = max(range_start, min(total_len, range_end))
    context_range = max(20, min(800, context_range))
    max_hits = max(1, min(30, max_hits))
    raw = str(full_text or "")
    scan_text = raw[range_start:range_end]
    source = scan_text.lower()
    needle = keyword.lower()
    cursor = 0
    hits: List[Dict[str, Any]] = []
    header_block_end = raw.find("[/EPUB_HEADING_CANDIDATES]")
    if header_block_end >= 0:
        header_block_end += len("[/EPUB_HEADING_CANDIDATES]")
    while cursor < len(source) and len(hits) < max_hits:
        local_idx = source.find(needle, cursor)
        if local_idx < 0:
            break
        match_start = range_start + local_idx
        if header_block_end > 0 and match_start < header_block_end:
            cursor = max(cursor + 1, local_idx + len(keyword))
            continue
        match_end = match_start + len(keyword)
        block_start = max(0, match_start - context_range)
        block_end = min(total_len, match_end + context_range)
        snippet = raw[block_start:block_end]
        hits.append(
            {
                "offset": int(match_start),
                "match_start": int(match_start),
                "match_end": int(match_end),
                "range_start": int(range_start),
                "range_end": int(range_end),
                "context_range": int(context_range),
                "range": f"{block_start}:{max(0, block_end - block_start)}",
                "text": snippet,
            }
        )
        cursor = max(cursor + 1, local_idx + len(keyword))
    return {
        "ok": True,
        "keyword": keyword,
        "range_start": int(range_start),
        "range_end": int(range_end),
        "hits_count": len(hits),
        "hits": hits,
        "text": "\n\n".join([f"[offset={row['offset']}, {row['range']}]\n{row['text']}" for row in hits]),
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


def _extract_epub_heading_candidates(full_text: str) -> List[str]:
    """从提取文本头部的 EPUB 候选标题块中读取目录候选。"""
    raw = str(full_text or "")
    begin = raw.find("[EPUB_HEADING_CANDIDATES]")
    end = raw.find("[/EPUB_HEADING_CANDIDATES]")
    if begin < 0 or end < 0 or end <= begin:
        return []
    block = raw[begin + len("[EPUB_HEADING_CANDIDATES]"):end]
    rows: List[str] = []
    seen: set[str] = set()
    for line in block.splitlines():
        value = re.sub(r"\s+", " ", str(line or "").strip())
        if value.startswith("-"):
            value = value[1:].strip()
        if not value:
            continue
        if len(value) > 80:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        rows.append(value)
    return rows


def _preview_plain_text(value: Any, limit: int = 50) -> str:
    """将工具输出预览转为纯文本，自动过滤 HTML/XML 标签并压缩空白。"""
    text = str(value or "")
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if limit <= 0:
        return text
    return text[:limit]


def _is_probable_section_heading(value: str) -> bool:
    """对 EPUB 候选标题做轻量过滤，尽量保留真实章节标题。"""
    text = str(value or "").strip()
    if not text:
        return False
    lower = text.lower()
    blacklist = (
        "翻译",
        "校对",
        "扫图",
        "制作信息",
        "copyright",
        "contents",
    )
    if any(token in lower for token in blacklist):
        return False
    if len(text) <= 1:
        return False
    if re.fullmatch(r"[0-9\s.]+", text):
        return False
    return True


def _score_heading_hit(snippet: str) -> int:
    """优先选择更像正文标题节点的命中位置。"""
    text = str(snippet or "")
    score = 0
    if re.search(r"<h[1-6][^>]*>", text, flags=re.IGNORECASE):
        score += 4
    if re.search(r"</h[1-6]>", text, flags=re.IGNORECASE):
        score += 2
    if re.search(r"<title>", text, flags=re.IGNORECASE):
        score += 1
    return score


def _discover_coarse_sections(full_text: str) -> Dict[str, Any]:
    """只提供 EPUB 结构线索；真正的分节交给模型处理。"""
    raw = str(full_text or "")
    total_len = len(raw)
    if total_len <= 0:
        return {"mode": "fallback", "sections": [], "reason": "empty_text", "candidates": []}
    headings = [item for item in _extract_epub_heading_candidates(raw) if _is_probable_section_heading(item)]
    return {
        "mode": "model_planning" if headings else "fallback",
        "sections": [],
        "reason": "epub_heading_candidates_available" if headings else "no_epub_heading_candidates",
        "candidates": headings,
    }


def _format_section_plan(sections: List[Dict[str, Any]]) -> str:
    """将分节计划格式化到日志或提示词中。"""
    if not sections:
        return ""
    rows: List[str] = []
    for idx, row in enumerate(sections, start=1):
        rows.append(
            f"{idx}. {str(row.get('chapter_name') or '').strip()} | "
            f"{str(row.get('range') or '').strip()}"
        )
    return "\n".join(rows)


def _is_read_tool_message(message: Mapping[str, Any]) -> bool:
    """识别 turn_history 中的 read 工具结果，用于滚动窗口清理。"""
    if str((message or {}).get("role") or "") != "tool":
        return False
    try:
        payload = _safe_json_obj(str((message or {}).get("content") or ""))
    except Exception:
        return False
    return all(key in payload for key in ("offset", "length", "text"))


def _format_heading_hints(headings: List[str]) -> str:
    """将 EPUB 候选标题格式化为提示词文本。"""
    rows = [str(item or "").strip() for item in list(headings or []) if str(item or "").strip()]
    if not rows:
        return ""
    return "\n".join([f"- {row}" for row in rows[:80]])


def _parse_model_section_plan(text: str, total_len: int) -> List[Dict[str, Any]]:
    """解析模型返回的分节计划。格式：title|||start|||end 或 title|||start:length。"""
    raw = str(text or "")
    block_match = re.search(r"<SECTION_PLAN>\s*(.*?)\s*</SECTION_PLAN>", raw, flags=re.IGNORECASE | re.DOTALL)
    block = block_match.group(1) if block_match else raw
    rows: List[Dict[str, Any]] = []
    for line in str(block or "").splitlines():
        current = str(line or "").strip()
        if not current or current.startswith("#"):
            continue
        parts = [part.strip() for part in current.split("|||")]
        if len(parts) < 2:
            continue
        title = str(parts[0] or "").strip()
        if not title:
            continue
        start = -1
        end = -1
        if len(parts) >= 3:
            try:
                start = int(parts[1])
                end = int(parts[2])
            except Exception:
                start = -1
                end = -1
        else:
            range_text = str(parts[1] or "").strip()
            if re.match(r"^\d+:\d+$", range_text):
                try:
                    start_s, len_s = range_text.split(":", 1)
                    start = int(start_s)
                    end = start + int(len_s)
                except Exception:
                    start = -1
                    end = -1
        if start < 0 or end <= start:
            continue
        start = min(max(0, start), total_len)
        end = min(max(start + 1, end), total_len)
        rows.append(
            {
                "chapter_name": title,
                "start": int(start),
                "end": int(end),
                "range": f"{start}:{max(0, end - start)}",
            }
        )
    rows.sort(key=lambda item: int(item.get("start") or 0))
    normalized: List[Dict[str, Any]] = []
    last_start = -1
    seen_title_start: set[str] = set()
    for row in rows:
        start = int(row.get("start") or 0)
        title = str(row.get("chapter_name") or "").strip()
        dedup_key = f"{title.lower()}::{start}"
        if dedup_key in seen_title_start:
            continue
        if last_start >= 0 and start <= last_start:
            continue
        seen_title_start.add(dedup_key)
        normalized.append(dict(row))
        last_start = start
    return normalized


def _safe_json_obj(raw: str) -> Dict[str, Any]:
    return runtime_safe_json_obj(raw)

def _safe_json_dumps(obj: Any) -> str:
    try:
        return __import__("json").dumps(obj, ensure_ascii=False)
    except Exception:
        return str(obj)


def _as_bool(value: Any, default: bool = False) -> bool:
    """Parse bool-like runtime values safely."""
    return runtime_as_bool(value, default)


def _chapter_status_from_summary(summary: str) -> str:
    return "done" if str(summary or "").strip() else "pending"


def _normalize_chapter_summary(summary: str) -> str:
    """清洗模型摘要：去掉标题化噪声、markdown 标记和多余空行。"""
    raw = str(summary or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not raw:
        return ""
    lines = [str(line or "").strip() for line in raw.split("\n")]
    cleaned: List[str] = []
    for line in lines:
        if not line:
            continue
        line = re.sub(r"^[#>\-\*\u2022]+\s*", "", line)
        line = re.sub(r"^\*+\s*", "", line)
        line = re.sub(r"\s*\*+$", "", line)
        lower = line.lower()
        if lower in {"章节结构", "章节范围", "章节摘要"}:
            continue
        if lower.startswith("章节结构") or lower.startswith("章节范围") or lower.startswith("章节摘要"):
            continue
        cleaned.append(line)
    text = "\n".join(cleaned).strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    if "\n\n" in text:
        # 章摘要统一为单段，避免存入大段结构化清单。
        text = " ".join([part.strip() for part in text.splitlines() if part.strip()]).strip()
    return text


def _get_text_by_range(full_text: str, chapter_range: str) -> str:
    raw = str(full_text or "")
    rng = str(chapter_range or "").strip()
    if not re.match(r"^\d+:\d+$", rng):
        return ""
    try:
        start_s, len_s = rng.split(":", 1)
        start = int(start_s)
        length = int(len_s)
    except Exception:
        return ""
    if start < 0 or length <= 0:
        return ""
    end = min(len(raw), start + length)
    if end <= start:
        return ""
    return raw[start:end]


def _review_summary_with_model(
    *,
    runner: Any,
    review_model_name: str,
    chapter_range: str,
    source_text: str,
    summary_text: str,
    temperature: float,
    max_tokens: int,
    request_timeout: int,
    stream: bool,
    think: bool,
) -> Dict[str, Any]:
    """用独立审核模型判定摘要质量；必须通过 write(status, reason) 输出结果。"""
    model_to_use = str(review_model_name or "").strip() or str(getattr(runner, "model_name", "") or "")
    src_preview = str(source_text or "")
    if len(src_preview) > 6000:
        src_preview = src_preview[:6000]
    review_system_tpl = _load_prompt_text(
        "coarse_summary_review.system",
        str(getattr(prompts, "COARSE_SUMMARY_REVIEW_SYSTEM_PROMPT", "") or ""),
    )
    review_user_tpl = _load_prompt_text(
        "coarse_summary_review.user",
        str(getattr(prompts, "COARSE_SUMMARY_REVIEW_USER_PROMPT", "") or ""),
    )
    review_prompt = _render_prompt(review_system_tpl, {})
    review_user = _render_prompt(
        review_user_tpl,
        {
            "chapter_range": chapter_range,
            "source_preview": src_preview,
            "summary_text": str(summary_text or ""),
        },
    )
    tools = [
        {
            "type": "function",
            "function": {
                "name": "write",
                "description": "write(status, reason): status=1 pass, status=0 reject with feedback.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "status": {"type": "integer"},
                        "reason": {"type": "string"},
                    },
                    "required": ["status", "reason"],
                },
            },
        }
    ]
    messages: List[Dict[str, Any]] = [{"role": "system", "content": review_prompt}, {"role": "user", "content": review_user}]
    result_pass = False
    result_reason = ""
    for turn in range(1, 7):
        response = runner.nexora_client.proxy.chat_completions(
            messages=messages,
            model=model_to_use,
            username=None,
            options={
                "temperature": float(temperature),
                "max_tokens": int(max_tokens),
                "stream": bool(stream),
                "think": bool(think),
                "tools": tools,
                "tool_choice": "auto",
            },
            use_chat_path=False,
            request_timeout=int(request_timeout),
            on_delta=None,
        )
        if not bool(response.get("ok")):
            return {"pass": False, "reason": f"审核模型调用失败: {response.get('message') or 'request failed'}"}
        payload = response.get("payload") if isinstance(response.get("payload"), dict) else {}
        choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
        if not choices:
            continue
        msg = choices[0].get("message") if isinstance(choices[0], dict) else {}
        tool_calls = (msg or {}).get("tool_calls") if isinstance((msg or {}).get("tool_calls"), list) else []
        messages.append({"role": "assistant", "content": str((msg or {}).get("content") or ""), "tool_calls": tool_calls if tool_calls else None})
        if not tool_calls:
            continue
        for call in tool_calls:
            if not isinstance(call, dict):
                continue
            func = call.get("function") if isinstance(call.get("function"), dict) else {}
            name = str(func.get("name") or "").strip()
            args_obj = _safe_json_obj(str(func.get("arguments") or "{}"))
            if name != "write":
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": str(call.get("id") or ""),
                        "content": _safe_json_dumps({"ok": False, "error": "unsupported tool"}),
                    }
                )
                continue
            try:
                status = int(args_obj.get("status"))
            except Exception:
                status = 0
            reason = str(args_obj.get("reason") or "").strip()
            result_pass = status == 1
            result_reason = reason or ("通过" if result_pass else "未给出原因")
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": str(call.get("id") or ""),
                    "content": _safe_json_dumps({"ok": True, "status": status, "reason": result_reason}),
                }
            )
            log_event(
                "summary_review_result",
                "章节摘要审核模型结果",
                payload={"chapter_range": chapter_range, "status": int(status), "review_model": model_to_use, "turn": int(turn)},
                content=result_reason[:1200],
            )
            return {"pass": bool(result_pass), "reason": result_reason}
    return {"pass": False, "reason": "审核模型未返回有效 write(status, reason) 结果"}


def _parse_existing_chapters(xml_text: str) -> List[Dict[str, str]]:
    """从现有 bookinfo.xml 解析章节，支持续传恢复。"""
    value = str(xml_text or "")
    if not value.strip():
        return []
    pattern = re.compile(
        r"<chapter_name>\s*(.*?)\s*</chapter_name>\s*"
        r"<chapter_range>\s*(.*?)\s*</chapter_range>\s*"
        r"(?:<chapter_status>\s*(.*?)\s*</chapter_status>\s*)?"
        r"<chapter_summary>\s*(.*?)\s*</chapter_summary>",
        flags=re.IGNORECASE | re.DOTALL,
    )
    fallback_pattern = re.compile(
        r"<chapter_name>\s*(.*?)\s*(?:</chapter_name>|/chapter_name>)\s*"
        r"<chapter_range>\s*(.*?)\s*(?:</chapter_range>|/chapter_range>)\s*"
        r"(?:<chapter_status>\s*(.*?)\s*(?:</chapter_status>|/chapter_status>)\s*)?"
        r"<chapter_summary>\s*(.*?)\s*(?:</chapter_summary>|/chapter_summary>)",
        flags=re.IGNORECASE | re.DOTALL,
    )
    rows: List[Dict[str, str]] = []
    for m in pattern.finditer(value):
        name = str(m.group(1) or "").strip()
        rng = str(m.group(2) or "").strip()
        status = str(m.group(3) or "").strip().lower()
        summary = str(m.group(4) or "").strip()
        if not name or not rng:
            continue
        rows.append({"chapter_name": name, "chapter_range": rng, "chapter_summary": summary, "chapter_status": status or _chapter_status_from_summary(summary)})
    if rows:
        return rows
    for m in fallback_pattern.finditer(value):
        name = str(m.group(1) or "").strip()
        rng = str(m.group(2) or "").strip()
        status = str(m.group(3) or "").strip().lower()
        summary = str(m.group(4) or "").strip()
        if not name or not rng:
            continue
        rows.append({"chapter_name": name, "chapter_range": rng, "chapter_summary": summary, "chapter_status": status or _chapter_status_from_summary(summary)})
    return rows


def _render_chapters_xml(chapters: List[Dict[str, str]]) -> str:
    """将章节结构渲染为 bookinfo.xml 文本。"""
    lines: List[str] = []
    for row in chapters:
        name = str(row.get("chapter_name") or "").strip()
        rng = str(row.get("chapter_range") or "").strip()
        summary = str(row.get("chapter_summary") or "").strip()
        status = str(row.get("chapter_status") or "").strip().lower() or _chapter_status_from_summary(summary)
        if not name or not rng:
            continue
        lines.append(f"<chapter_name>{name}</chapter_name>")
        lines.append(f"<chapter_range>{rng}</chapter_range>")
        lines.append(f"<chapter_status>{status}</chapter_status>")
        lines.append(f"<chapter_summary>{summary}</chapter_summary>")
        lines.append("")
    return "\n".join(lines).strip()


def _render_completed_chapters_outline(chapters: List[Dict[str, str]]) -> str:
    """Render a compact completed-chapters index for prompt continuity."""
    if not chapters:
        return ""
    rows: List[str] = []
    for idx, row in enumerate(chapters, start=1):
        name = str(row.get("chapter_name") or "").strip()
        rng = str(row.get("chapter_range") or "").strip()
        status = str(row.get("chapter_status") or "").strip().lower()
        if not name or not rng or status != "done":
            continue
        rows.append(f"{idx}. {name} | {rng}")
    return "\n".join(rows)


def _count_completed_chapters(chapters: List[Dict[str, str]]) -> int:
    return sum(1 for row in chapters if str(row.get("chapter_status") or "").strip().lower() == "done")


def _all_chapters_completed(chapters: List[Dict[str, str]]) -> bool:
    if not chapters:
        return False
    return all(
        str(row.get("chapter_name") or "").strip()
        and str(row.get("chapter_range") or "").strip()
        and str(row.get("chapter_status") or "").strip().lower() == "done"
        for row in chapters
    )


def _max_chapter_end(chapters: List[Dict[str, str]]) -> int:
    max_end = 0
    for row in chapters:
        rng = str(row.get("chapter_range") or "").strip()
        if not re.match(r"^\d+:\d+$", rng):
            continue
        try:
            start_s, len_s = rng.split(":", 1)
            end = int(start_s) + int(len_s)
        except Exception:
            continue
        if end > max_end:
            max_end = end
    return max_end


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
    state_update_job(job_id, dict(patch or {}))


def _job_key(lecture_id: str, book_id: str) -> str:
    return state_job_key(lecture_id, book_id)


def _is_cancelled_key(key: str) -> bool:
    return state_is_cancelled_key(key)


def _clear_cancelled_key(key: str) -> None:
    state_clear_cancelled_key(key)


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
            "intensive_status": "idle",
            "intensive_error": "",
            "intensive_model": "",
            "question_status": "idle",
            "question_error": "",
            "question_model": "",
            "updated_at": ts,
        },
    )
    _set_book_progress(lecture_id, book_id, "")
