"""教材处理主模块（booksproc）。

职责：
1. 维护教材提炼队列（人工选择后入队）。
2. 执行教材文本提取（从原文件提取纯文本）。
3. 调用粗读模型输出章节结构。
4. 记录教材处理关键日志（不记录请求访问日志）。
"""

from __future__ import annotations

import json
import re
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any, Deque, Dict, List, Mapping, Optional, Tuple

try:
    from NexoraLearning import prompts as learning_prompts
except ImportError:
    import prompts as learning_prompts

from ..lectures import (
    get_book,
    get_lecture,
    list_books,
    list_lectures,
    load_book_detail_xml,
    load_book_heading_candidates,
    load_book_info_xml,
    load_book_questions_xml,
    load_book_sections_xml,
    load_book_text,
    save_book_info_xml,
    save_book_detail_xml,
    save_book_questions_xml,
    save_book_sections_xml,
    save_book_text,
    update_book,
)
from ..bookextract import extract_epub_heading_candidates_from_text
from ..bookindex import heading_candidate_block_end
from .modeling import (
    build_coarse_reading_runner,
    build_intensive_reading_runner,
    build_question_generation_runner,
    build_split_chapters_runner,
    build_annotation_runner,
    build_book_summary_runner,
    get_intensive_reading_settings,
    get_question_generation_settings,
    get_rough_reading_settings,
    get_split_chapters_settings,
    get_annotation_settings,
    get_book_summary_settings,
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
from .section import run_section_generation_once as _run_section_generation_once_flow
from .annotation import run_annotation_generation_once as _run_annotation_generation_once_flow
from .summary import run_book_summary_once as _run_book_summary_once_flow
from .compress import build_llm_compress_func as _build_llm_compress_func
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
    push_model_output as state_push_model_output,
    push_tool_call as state_push_tool_call,
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
_BOOK_PIPELINE_STAGES = (
    ("coarse", "概读"),
    ("intensive", "精读"),
    ("section", "分节"),
    ("summary", "概述"),
    ("annotation", "批注"),
    ("video", "视频"),
)


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


def _push_model_output(lecture_id: str, book_id: str, content: str) -> None:
    """推送模型文本输出到活动日志（统一接口）"""
    state_push_model_output(lecture_id, book_id, content)


def _push_tool_call(lecture_id: str, book_id: str, tool_name: str, title: str, preview: str = "") -> None:
    """推送工具调用到活动日志（统一接口）"""
    state_push_tool_call(lecture_id, book_id, tool_name, title, preview)


def get_book_progress_steps(lecture_id: str, book_id: str) -> List[Dict[str, Any]]:
    """读取教材进度步骤列表。"""
    return state_get_book_progress_steps(lecture_id, book_id)


def init_booksproc(cfg: Mapping[str, Any]) -> None:
    """初始化教材处理队列工作线程。"""
    _CFG.clear()
    _CFG.update(dict(cfg or {}))
    _reset_stuck_jobs(_CFG)
    _reconcile_video_cache_statuses(_CFG)
    init_booksproc_queue(_CFG, run_job=_run_job, log_event=log_event)


def _reconcile_video_cache_statuses(cfg: Mapping[str, Any]) -> None:
    """启动时用真实缓存产物修正旧版视频处理状态。"""
    from ..video_search import has_video_search_cache

    updated_count = 0

    for lecture in list_lectures(cfg):
        lecture_id = str((lecture or {}).get("id") or "").strip()

        if not lecture_id:
            continue

        for book in list_books(cfg, lecture_id):
            book_id = str((book or {}).get("id") or "").strip()

            if not book_id or not has_video_search_cache(cfg, lecture_id, book_id):
                continue

            video_status = str((book or {}).get("video_status") or "").strip().lower()
            video_error = str((book or {}).get("video_error") or "").strip()

            if video_status == "done" and not video_error:
                continue

            updated = update_book(
                dict(cfg),
                lecture_id,
                book_id,
                {"video_status": "done", "video_error": ""},
            )

            if updated is None:
                raise ValueError(f"Book not found while reconciling video cache: {lecture_id}/{book_id}")

            updated_count += 1

    if updated_count:
        log_event(
            "video_cache_status_reconciled",
            "已根据视频缓存修正教材处理状态",
            payload={"updated_count": updated_count},
        )


def _reset_stuck_jobs(cfg: Mapping[str, Any]) -> None:
    """服务器重启时，将所有卡在 queued/running 状态的任务重置。"""
    try:
        for lecture in list_lectures(cfg):
            lecture_id = str(lecture.get("id") or "").strip()
            if not lecture_id:
                continue
            for book in list_books(cfg, lecture_id):
                book_id = str(book.get("id") or "").strip()
                if not book_id:
                    continue
                updates = {}
                for status_key in [
                    "coarse_status", "section_status", "intensive_status",
                    "question_status", "annotation_status", "summary_status",
                    "video_status", "pipeline_status",
                ]:
                    val = str(book.get(status_key) or "").strip().lower()
                    if val in ("queued", "running"):
                        base = status_key.replace("_status", "")
                        error_key = f"{base}_error"
                        # 如果之前没有完成过（没有对应的 xml 数据），重置为空闲
                        if val == "queued":
                            updates[status_key] = ""
                            updates[error_key] = ""
                        else:
                            # running 状态说明任务中断了，标记为错误
                            updates[status_key] = "error"
                            updates[error_key] = "任务因服务器重启而中断"
                if updates:
                    update_book(cfg, lecture_id, book_id, updates)
                    log_event(
                        "stuck_job_reset",
                        "重置卡住的任务状态",
                        payload={"lecture_id": lecture_id, "book_id": book_id, **updates},
                    )
    except Exception as exc:
        log_event("stuck_job_reset_error", f"重置卡住任务失败: {exc}", payload={"error": str(exc)})


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
            "coarse_error": "",
            "intensive_status": "idle",
            "intensive_error": "",
            "section_status": "idle",
            "section_error": "",
            "summary_status": "idle",
            "summary_error": "",
            "annotation_status": "idle",
            "annotation_error": "",
            "video_status": "idle",
            "video_error": "",
            "pipeline_status": "idle",
            "pipeline_error": "",
            "pipeline_job_id": "",
            "pipeline_requested_at": 0,
            "pipeline_finished_at": 0,
        },
    )
    if updated is None:
        raise ValueError(f"Book not found: {lecture_id}/{book_id}")
    log_event(
        "book_upload",
        "教材上传完成（等待自动处理）",
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


def enqueue_book_pipeline(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    actor: str = "",
    force: bool = False,
) -> Dict[str, Any]:
    """将教材加入自动处理流水线，按固定阶段顺序串行执行。"""
    resolved_cfg = dict(cfg or {})
    lecture_key = str(lecture_id or "").strip()
    book_key = str(book_id or "").strip()
    if not lecture_key or not book_key:
        raise ValueError("lecture_id and book_id are required.")

    if get_lecture(resolved_cfg, lecture_key) is None:
        raise ValueError(f"Lecture not found: {lecture_key}")

    book = get_book(resolved_cfg, lecture_key, book_key)
    if book is None:
        raise ValueError(f"Book not found: {lecture_key}/{book_key}")

    original_path = str(book.get("original_path") or "").strip()
    text_ready = str(book.get("text_status") or "").strip().lower() == "ready"
    if not original_path and not text_ready:
        raise ValueError("Book has no source file and no text content.")

    pipeline_status = str(book.get("pipeline_status") or "").strip().lower()
    if pipeline_status in {"queued", "running"}:
        raise ValueError("Book pipeline is already running.")

    existing_jobs = queue_get_snapshot().get("jobs", [])
    for existing in existing_jobs if isinstance(existing_jobs, list) else []:
        if not isinstance(existing, Mapping):
            continue
        same_book = (
            str(existing.get("lecture_id") or "").strip() == lecture_key
            and str(existing.get("book_id") or "").strip() == book_key
        )
        existing_status = str(existing.get("status") or "").strip().lower()
        if same_book and existing_status in {"queued", "running"}:
            raise ValueError("Book already has a processing task.")

    queued = queue_enqueue_job(
        lecture_key,
        book_key,
        actor=actor,
        force=force,
        job_type="pipeline",
    )
    job = dict(queued.get("job") or {})
    job_id = str(job.get("job_id") or "")
    now = int(job.get("created_at") or time.time())

    update_book(
        resolved_cfg,
        lecture_key,
        book_key,
        {
            "pipeline_status": "queued",
            "pipeline_error": "",
            "pipeline_job_id": job_id,
            "pipeline_requested_at": now,
        },
    )
    _set_book_progress(lecture_key, book_key, "教材自动处理已排队...")
    log_event(
        "book_pipeline_queue",
        "教材自动处理流水线已加入队列",
        payload={
            "lecture_id": lecture_key,
            "book_id": book_key,
            "job_id": job_id,
            "actor": actor,
            "force": bool(force),
            "stages": [stage for stage, _label in _BOOK_PIPELINE_STAGES],
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


def enqueue_book_section(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    actor: str = "",
    model_name: str = "",
) -> Dict[str, Any]:
    """将教材加入分节队列。"""
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
        raise ValueError("intensive reading must be completed before section generation.")

    queued = queue_enqueue_job(
        lecture_key,
        book_key,
        actor=actor,
        force=False,
        job_type="section",
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
            "section_status": "queued",
            "section_error": "",
            "section_model": selected_model,
            "refinement_job_id": job_id,
            "refinement_requested_at": now,
        },
    )
    _set_book_progress(lecture_key, book_key, "分节任务排队中...")
    log_event(
        "book_section_queue",
        "教材已加入分节队列",
        payload={
            "lecture_id": lecture_key,
            "book_id": book_key,
            "job_id": job_id,
            "actor": actor,
            "model_name": selected_model,
        },
    )
    return queued


def enqueue_book_annotation(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    actor: str = "",
    model_name: str = "",
) -> Dict[str, Any]:
    """将教材加入批注队列。"""
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
    section_status = str(book.get("section_status") or "").strip().lower()
    if section_status not in {"done", "completed", "success"}:
        raise ValueError("section generation must be completed before annotation generation.")

    queued = queue_enqueue_job(
        lecture_key,
        book_key,
        actor=actor,
        force=False,
        job_type="annotation",
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
            "annotation_status": "queued",
            "annotation_error": "",
            "annotation_model": selected_model,
            "annotation_job_id": job_id,
            "annotation_requested_at": now,
        },
    )
    _set_book_progress(lecture_key, book_key, "批注任务排队中...")
    log_event(
        "book_annotation_queue",
        "教材已加入批注队列",
        payload={
            "lecture_id": lecture_key,
            "book_id": book_key,
            "job_id": job_id,
            "actor": actor,
            "model_name": selected_model,
        },
    )
    return queued


def enqueue_book_summary(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    actor: str = "",
    model_name: str = "",
) -> Dict[str, Any]:
    """将教材加入全书概述队列。"""
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
    section_status = str(book.get("section_status") or "").strip().lower()
    if section_status not in {"done", "completed", "success"}:
        raise ValueError("section generation must be completed before book summary generation.")

    queued = queue_enqueue_job(
        lecture_key,
        book_key,
        actor=actor,
        force=False,
        job_type="summary",
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
            "summary_status": "queued",
            "summary_error": "",
            "summary_model": selected_model,
            "summary_job_id": job_id,
            "summary_requested_at": now,
        },
    )
    _set_book_progress(lecture_key, book_key, "全书概述任务排队中...")
    log_event(
        "book_summary_queue",
        "教材已加入全书概述队列",
        payload={
            "lecture_id": lecture_key,
            "book_id": book_key,
            "job_id": job_id,
            "actor": actor,
            "model_name": selected_model,
        },
    )
    return queued


def enqueue_book_video(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    actor: str = "",
) -> Dict[str, Any]:
    """将教材加入视频搜索队列（粗读完成后可执行）。"""
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

    # 视频搜索在管线最后，任何步骤完成后都可以触发
    any_done = any(
        str(book.get(f"{step}_status") or "").strip().lower() in {"done", "completed", "success"}
        for step in ("coarse", "section", "intensive", "question", "annotation", "summary")
    )
    if not any_done:
        raise ValueError("at least one processing step must be completed before video search.")

    queued = queue_enqueue_job(
        lecture_key,
        book_key,
        actor=actor,
        force=False,
        job_type="video",
    )
    job = dict(queued.get("job") or {})
    job_id = str(job.get("job_id") or "")
    now = int(job.get("created_at") or time.time())

    update_book(
        resolved_cfg,
        lecture_key,
        book_key,
        {
            "video_status": "queued",
            "video_error": "",
            "video_job_id": job_id,
            "video_requested_at": now,
        },
    )
    _set_book_progress(lecture_key, book_key, "视频搜索任务排队中...")
    log_event(
        "book_video_queue",
        "教材已加入视频搜索队列",
        payload={"lecture_id": lecture_key, "book_id": book_key, "job_id": job_id, "actor": actor},
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


def _find_active_course_jobs(
    lecture_id: str,
    job_type: str,
    *,
    exclude_job_id: str = "",
) -> List[Dict[str, Any]]:
    """返回当前课程指定类型的排队中或执行中任务。"""
    lecture_key = str(lecture_id or "").strip()
    type_key = str(job_type or "").strip().lower()
    excluded_id = str(exclude_job_id or "").strip()
    jobs = queue_get_snapshot().get("jobs", [])
    active_jobs: List[Dict[str, Any]] = []

    for job in jobs if isinstance(jobs, list) else []:
        if not isinstance(job, Mapping):
            continue

        job_id = str(job.get("job_id") or "").strip()
        if excluded_id and job_id == excluded_id:
            continue

        if str(job.get("lecture_id") or "").strip() != lecture_key:
            continue

        if str(job.get("job_type") or "").strip().lower() != type_key:
            continue

        status = str(job.get("status") or "").strip().lower()
        if status not in {"queued", "running"}:
            continue

        active_jobs.append(dict(job))

    return active_jobs


def _check_and_trigger_outline(lecture_id: str, *, completed_pipeline_job_id: str = "") -> None:
    """课程教材流水线全部收尾后，只排入一次课程大纲生成任务。"""
    try:
        books = list_books(_CFG, lecture_id)
        if not books:
            return

        pending_pipeline_jobs = _find_active_course_jobs(
            lecture_id,
            "pipeline",
            exclude_job_id=completed_pipeline_job_id,
        )
        if pending_pipeline_jobs:
            log_event(
                "outline_deferred",
                "课程仍有教材自动处理任务，大纲生成已延后",
                payload={
                    "lecture_id": lecture_id,
                    "pending_pipeline_job_ids": [
                        str(job.get("job_id") or "")
                        for job in pending_pipeline_jobs
                    ],
                    "pending_book_ids": [
                        str(job.get("book_id") or "")
                        for job in pending_pipeline_jobs
                    ],
                },
            )
            return

        incomplete_books = [
            {
                "book_id": str(book.get("id") or "").strip(),
                "title": str(book.get("title") or "").strip(),
                "summary_status": str(book.get("summary_status") or "").strip().lower(),
            }
            for book in books
            if str(book.get("summary_status") or "").strip().lower() != "done"
        ]
        if incomplete_books:
            log_event(
                "outline_waiting_for_summaries",
                "课程存在未完成概述的教材，暂不生成课程大纲",
                payload={
                    "lecture_id": lecture_id,
                    "incomplete_books": incomplete_books,
                },
            )
            return

        active_outline_jobs = _find_active_course_jobs(lecture_id, "outline")
        if active_outline_jobs:
            log_event(
                "outline_queue_duplicate",
                "课程大纲生成任务已存在，本次不重复入队",
                payload={
                    "lecture_id": lecture_id,
                    "outline_job_ids": [
                        str(job.get("job_id") or "")
                        for job in active_outline_jobs
                    ],
                },
            )
            return

        from core.booksproc.outline import build_outline_source_book_ids

        completed_book_ids = build_outline_source_book_ids(books)
        if not completed_book_ids:
            return

        try:
            queued = queue_enqueue_job(
                lecture_id,
                "outline",
                actor="system",
                force=False,
                job_type="outline",
            )
            log_event(
                "outline_queued",
                "课程大纲自动生成任务已加入队列",
                payload={
                    "lecture_id": lecture_id,
                    "reason": "course_pipeline_queue_drained",
                    "source_book_ids": completed_book_ids,
                    "duplicate": bool(queued.get("duplicate")),
                },
            )
        except Exception as exc:
            log_event(
                "outline_queue_error",
                f"课程大纲生成任务入队失败: {exc}",
                payload={"lecture_id": lecture_id, "error": str(exc)},
            )
    except Exception as exc:
        log_event(
            "outline_check_error",
            f"检查大纲生成条件失败: {exc}",
            payload={"lecture_id": lecture_id, "error": str(exc)},
        )


_JOB_TYPE_AGENT = {
    "coarse": "rough_reading",
    "intensive": "intensive_reading",
    "question": "question_generation",
    "pipeline": "material_pipeline",
}


def _run_job(job: Dict[str, Any]) -> None:
    """执行单个教材提炼任务（带执行时间线 run 上下文）。"""
    from core import runlog as _rl

    job_data = job if isinstance(job, dict) else {}
    job_type = str(job_data.get("job_type") or "coarse").strip().lower() or "coarse"
    run_id = _rl.begin_run(f"book_{job_type}", meta={
        "job_id": str(job_data.get("job_id") or ""),
        "lecture_id": str(job_data.get("lecture_id") or ""),
        "book_id": str(job_data.get("book_id") or ""),
        "model_name": str(job_data.get("model_name") or ""),
    })
    _rl.set_agent(_JOB_TYPE_AGENT.get(job_type, job_type))

    try:
        _run_job_impl(job)
    except Exception as exc:
        _rl.end_run(run_id, status="error", meta={"error": str(exc)})
        raise
    else:
        _rl.end_run(run_id, status="ok")
    finally:
        _rl.set_agent("")


def _pipeline_stage_done(book: Mapping[str, Any], stage: str) -> bool:
    status = str((book or {}).get(f"{stage}_status") or "").strip().lower()
    return status in {"done", "completed", "success"}


def _run_pipeline_job(job: Dict[str, Any]) -> None:
    """按固定顺序执行教材处理阶段，任一阶段失败即停止。"""
    lecture_id = str(job.get("lecture_id") or "").strip()
    book_id = str(job.get("book_id") or "").strip()
    job_id = str(job.get("job_id") or "").strip()
    actor = str(job.get("actor") or "").strip()
    force = bool(job.get("force"))
    key = _job_key(lecture_id, book_id)
    current_stage = ""
    now = int(time.time())

    if _is_cancelled_key(key):
        _update_job(job_id, {"status": "cancelled", "started_at": now, "finished_at": now, "error": "cancelled by admin"})
        _reset_book_unrefined(_CFG, lecture_id, book_id, now=now)
        _clear_cancelled_key(key)
        return

    _update_job(job_id, {"status": "running", "started_at": now, "error": "", "pipeline_stage": ""})
    update_book(
        _CFG,
        lecture_id,
        book_id,
        {
            "pipeline_status": "running",
            "pipeline_error": "",
            "pipeline_job_id": job_id,
        },
    )
    _set_book_progress(lecture_id, book_id, "教材自动处理开始...")

    try:
        for stage, label in _BOOK_PIPELINE_STAGES:
            if _is_cancelled_key(key):
                raise RuntimeError("cancelled by admin")

            book = get_book(_CFG, lecture_id, book_id)
            if book is None:
                raise ValueError(f"Book not found while running: {lecture_id}/{book_id}")

            if _pipeline_stage_done(book, stage) and not force:
                _push_book_progress_step(
                    lecture_id,
                    book_id,
                    {"type": "pipeline_stage", "title": f"自动流程：{label}", "preview": "已完成，跳过"},
                )
                continue

            current_stage = stage
            _update_job(job_id, {"pipeline_stage": stage})
            _set_book_progress(lecture_id, book_id, f"自动流程：正在执行{label}...")
            _push_book_progress_step(
                lecture_id,
                book_id,
                {"type": "pipeline_stage", "title": f"自动流程：{label}", "preview": "开始执行"},
            )

            stage_job = dict(job)
            stage_job.update(
                {
                    "job_id": f"{job_id}:{stage}",
                    "job_type": stage,
                    "force": force,
                }
            )

            coarse_pass = 0
            while True:
                _run_job_impl(stage_job)
                coarse_pass += 1

                updated_book = get_book(_CFG, lecture_id, book_id) or {}
                if _pipeline_stage_done(updated_book, stage):
                    break

                stage_status = str(updated_book.get(f"{stage}_status") or "").strip().lower()
                if stage != "coarse" or stage_status != "outlined" or coarse_pass >= _ROUND_MAX_RETRIES:
                    break

                _set_book_progress(lecture_id, book_id, "自动流程：继续补全概读章节摘要...")
                _push_book_progress_step(
                    lecture_id,
                    book_id,
                    {"type": "pipeline_stage", "title": "自动流程：概读", "preview": f"继续补全，第 {coarse_pass + 1} 次"},
                )

            if _is_cancelled_key(key):
                raise RuntimeError("cancelled by admin")

            updated_book = get_book(_CFG, lecture_id, book_id) or {}
            if not _pipeline_stage_done(updated_book, stage):
                stage_error = str(updated_book.get(f"{stage}_error") or "").strip()
                raise RuntimeError(f"{label}阶段未完成：{stage_error or '执行器未返回完成状态'}")

            _push_book_progress_step(
                lecture_id,
                book_id,
                {"type": "pipeline_stage", "title": f"自动流程：{label}", "preview": "执行完成"},
            )

        finished_at = int(time.time())
        update_book(
            _CFG,
            lecture_id,
            book_id,
            {
                "pipeline_status": "done",
                "pipeline_error": "",
                "pipeline_job_id": job_id,
                "pipeline_finished_at": finished_at,
            },
        )
        _set_book_progress(lecture_id, book_id, "教材自动处理完成")
        _update_job(
            job_id,
            {
                "status": "done",
                "finished_at": finished_at,
                "error": "",
                "pipeline_stage": "",
            },
        )
        log_event(
            "book_pipeline_done",
            "教材自动处理流水线完成",
            payload={
                "lecture_id": lecture_id,
                "book_id": book_id,
                "job_id": job_id,
                "stages": [stage for stage, _label in _BOOK_PIPELINE_STAGES],
            },
        )
        _check_and_trigger_outline(
            lecture_id,
            completed_pipeline_job_id=job_id,
        )
    except Exception as exc:
        message = str(exc)
        if _is_cancelled_key(key) or "cancelled by admin" in message.lower():
            _reset_book_unrefined(_CFG, lecture_id, book_id, now=int(time.time()))
            update_book(
                _CFG,
                lecture_id,
                book_id,
                {
                    "pipeline_status": "cancelled",
                    "pipeline_error": "cancelled by admin",
                    "pipeline_job_id": job_id,
                },
            )
            _update_job(job_id, {"status": "cancelled", "finished_at": int(time.time()), "error": "cancelled by admin", "pipeline_stage": current_stage})
            _clear_cancelled_key(key)
            _set_book_progress(lecture_id, book_id, "教材自动处理已取消")
            return

        if current_stage:
            update_book(
                _CFG,
                lecture_id,
                book_id,
                {
                    f"{current_stage}_status": "error",
                    f"{current_stage}_error": message,
                },
            )
        update_book(
            _CFG,
            lecture_id,
            book_id,
            {
                "pipeline_status": "error",
                "pipeline_error": message,
                "pipeline_job_id": job_id,
            },
        )
        _update_job(
            job_id,
            {
                "status": "error",
                "finished_at": int(time.time()),
                "error": message,
                "pipeline_stage": current_stage,
            },
        )
        _set_book_progress(lecture_id, book_id, f"自动流程在{current_stage or '启动'}阶段失败：{message[:120]}")
        log_event(
            "book_pipeline_error",
            "教材自动处理流水线失败",
            payload={
                "lecture_id": lecture_id,
                "book_id": book_id,
                "job_id": job_id,
                "stage": current_stage,
            },
            content=message,
        )


def _run_job_impl(job: Dict[str, Any]) -> None:
    """执行单个教材提炼任务。"""
    lecture_id = str(job.get("lecture_id") or "").strip()
    book_id = str(job.get("book_id") or "").strip()
    job_id = str(job.get("job_id") or "").strip()
    force = bool(job.get("force"))
    job_type = str(job.get("job_type") or "coarse").strip().lower() or "coarse"
    model_name = str(job.get("model_name") or "").strip()
    key = _job_key(lecture_id, book_id)
    now = int(time.time())

    if job_type == "pipeline":
        _run_pipeline_job(job)
        return

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
    elif job_type == "section":
        update_book(
            _CFG,
            lecture_id,
            book_id,
            {
                "section_status": "running",
                "section_error": "",
                "section_model": model_name,
            },
        )
        _set_book_progress(lecture_id, book_id, "模型正在进行章节分节...")
        log_event(
            "book_section_start",
            "教材开始分节（分节阶段）",
            payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id, "model_name": model_name},
        )
    elif job_type == "annotation":
        update_book(
            _CFG,
            lecture_id,
            book_id,
            {
                "annotation_status": "running",
                "annotation_error": "",
                "annotation_model": model_name,
            },
        )
        _set_book_progress(lecture_id, book_id, "模型正在生成批注...")
        log_event(
            "book_annotation_start",
            "教材开始批注（批注阶段）",
            payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id, "model_name": model_name},
        )
    elif job_type == "summary":
        update_book(
            _CFG,
            lecture_id,
            book_id,
            {
                "summary_status": "running",
                "summary_error": "",
                "summary_model": model_name,
            },
        )
        _set_book_progress(lecture_id, book_id, "模型正在生成全书概述...")
        log_event(
            "book_summary_start",
            "教材开始全书概述（概述阶段）",
            payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id, "model_name": model_name},
        )
    elif job_type == "video":
        update_book(
            _CFG,
            lecture_id,
            book_id,
            {
                "video_status": "running",
                "video_error": "",
            },
        )
        _set_book_progress(lecture_id, book_id, "正在搜索相关视频...")
        log_event(
            "book_video_start",
            "教材开始视频搜索",
            payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id},
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
        elif job_type == "section":
            result = run_section_generation_once(_CFG, lecture_id, book_id, actor=str(job.get("actor") or ""), model_name=model_name)
            finished_at = int(time.time())
            _set_book_progress(lecture_id, book_id, "分节完成")
            _update_job(
                job_id,
                {
                    "status": "done",
                    "finished_at": finished_at,
                    "error": "",
                    "section_status": "done",
                    "model_name": str(result.get("model_name") or model_name),
                },
            )
            log_event(
                "book_section_done",
                "教材提炼完成（分节阶段）",
                payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id},
                content=f"sections_chars={int(result.get('sections_chars') or 0)}; session_count={int(result.get('session_count') or 0)}",
            )
        elif job_type == "annotation":
            result = run_annotation_generation_once(_CFG, lecture_id, book_id, actor=str(job.get("actor") or ""), model_name=model_name)
            finished_at = int(time.time())
            _set_book_progress(lecture_id, book_id, "批注完成")
            _update_job(
                job_id,
                {
                    "status": "done",
                    "finished_at": finished_at,
                    "error": "",
                    "annotation_status": "done",
                    "model_name": str(result.get("model_name") or model_name),
                },
            )
            log_event(
                "book_annotation_done",
                "教材提炼完成（批注阶段）",
                payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id},
                content=f"annotations_chars={int(result.get('annotations_chars') or 0)}; annotation_count={int(result.get('annotation_count') or 0)}",
            )
        elif job_type == "summary":
            result = run_book_summary_once(_CFG, lecture_id, book_id, actor=str(job.get("actor") or ""), model_name=model_name)
            finished_at = int(time.time())
            _set_book_progress(lecture_id, book_id, "全书概述完成")
            _update_job(
                job_id,
                {
                    "status": "done",
                    "finished_at": finished_at,
                    "error": "",
                    "summary_status": "done",
                    "model_name": str(result.get("model_name") or model_name),
                },
            )
            log_event(
                "book_summary_done",
                "教材提炼完成（全书概述阶段）",
                payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id},
                content=f"summary_chars={int(result.get('summary_chars') or 0)}; chapter_count={int(result.get('chapter_count') or 0)}",
            )
        elif job_type == "video":
            from core.video_search import search_and_cache_videos
            lecture = get_lecture(_CFG, lecture_id)
            book = get_book(_CFG, lecture_id, book_id)
            lecture_title = str((lecture or {}).get("title") or "").strip()
            book_title = str((book or {}).get("title") or "").strip()
            bookinfo_xml = str(load_book_info_xml(_CFG, lecture_id, book_id) or "")
            items = search_and_cache_videos(
                _CFG, lecture_id, book_id,
                lecture_title=lecture_title,
                book_title=book_title,
                bookinfo_xml=bookinfo_xml,
            )
            finished_at = int(time.time())
            _set_book_progress(lecture_id, book_id, f"视频搜索完成，找到 {len(items)} 个视频")
            update_book(_CFG, lecture_id, book_id, {"video_status": "done", "video_error": ""})
            _update_job(job_id, {"status": "done", "finished_at": finished_at, "error": ""})
            log_event(
                "book_video_done",
                "视频搜索完成",
                payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id, "count": len(items)},
            )
        elif job_type == "outline":
            from core.booksproc.outline import generate_outline
            _set_book_progress(lecture_id, book_id, "正在生成课程大纲...")
            result = generate_outline(_CFG, lecture_id)
            finished_at = int(time.time())
            _set_book_progress(lecture_id, book_id, "课程大纲生成完成")
            _update_job(
                job_id,
                {
                    "status": "done",
                    "finished_at": finished_at,
                    "error": "",
                    "outline_status": "done",
                    "section_count": len(result.get("sections", [])),
                },
            )
            log_event(
                "outline_done",
                "课程大纲生成完成",
                payload={
                    "lecture_id": lecture_id,
                    "book_id": book_id,
                    "job_id": job_id,
                    "section_count": len(result.get("sections", [])),
                },
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
        elif job_type == "section":
            update_book(
                _CFG,
                lecture_id,
                book_id,
                {
                    "section_status": "error",
                    "section_error": message,
                },
            )
            _set_book_progress(lecture_id, book_id, f"分节执行失败：{message[:120]}")
            _update_job(job_id, {"status": "error", "finished_at": int(time.time()), "error": message, "section_status": "error"})
            log_event(
                "book_section_error",
                "教材提炼失败（分节阶段）",
                payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id},
                content=message,
            )
        elif job_type == "annotation":
            update_book(
                _CFG,
                lecture_id,
                book_id,
                {
                    "annotation_status": "error",
                    "annotation_error": message,
                },
            )
            _set_book_progress(lecture_id, book_id, f"批注执行失败：{message[:120]}")
            _update_job(job_id, {"status": "error", "finished_at": int(time.time()), "error": message, "annotation_status": "error"})
            log_event(
                "book_annotation_error",
                "教材提炼失败（批注阶段）",
                payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id},
                content=message,
            )
        elif job_type == "summary":
            update_book(
                _CFG,
                lecture_id,
                book_id,
                {
                    "summary_status": "error",
                    "summary_error": message,
                },
            )
            _set_book_progress(lecture_id, book_id, f"全书概述执行失败：{message[:120]}")
            _update_job(job_id, {"status": "error", "finished_at": int(time.time()), "error": message, "summary_status": "error"})
            log_event(
                "book_summary_error",
                "教材提炼失败（全书概述阶段）",
                payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id},
                content=message,
            )
        elif job_type == "video":
            update_book(_CFG, lecture_id, book_id, {"video_status": "error", "video_error": message})
            _set_book_progress(lecture_id, book_id, f"视频搜索失败：{message[:120]}")
            _update_job(job_id, {"status": "error", "finished_at": int(time.time()), "error": message})
            log_event(
                "book_video_error",
                "视频搜索失败",
                payload={"lecture_id": lecture_id, "book_id": book_id, "job_id": job_id},
                content=message,
            )
        elif job_type == "outline":
            _set_book_progress(lecture_id, book_id, f"大纲生成失败：{message[:120]}")
            _update_job(job_id, {"status": "error", "finished_at": int(time.time()), "error": message, "outline_status": "error"})
            log_event(
                "outline_error",
                "课程大纲生成失败",
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
        push_book_progress_step=_push_book_progress_step,
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


def run_section_generation_once(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    actor: str = "",
    model_name: str = "",
) -> Dict[str, Any]:
    """手动触发分节（委托 section.py，按章节拆成 Session）。"""
    return _run_section_generation_once_flow(
        cfg,
        lecture_id,
        book_id,
        actor=actor,
        model_name=model_name,
        get_lecture=get_lecture,
        get_book=get_book,
        load_book_info_xml=load_book_info_xml,
        load_book_detail_xml=load_book_detail_xml,
        load_book_sections_xml=load_book_sections_xml,
        save_book_sections_xml=save_book_sections_xml,
        update_book=update_book,
        resolve_book_text=_resolve_book_text,
        get_split_chapters_settings=get_split_chapters_settings,
        build_split_chapters_runner=build_split_chapters_runner,
        as_bool=_as_bool,
        log_event=log_event,
        append_log_text=append_log_text,
        push_book_progress_step=_push_book_progress_step,
    )


def run_annotation_generation_once(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    actor: str = "",
    model_name: str = "",
) -> Dict[str, Any]:
    """手动触发批注生成（委托 annotation.py，为章节生成学习批注）。"""
    # Load annotations.xml path helper
    from ..lectures import _book_sections_xml_path
    from .context import ContextPolicy
    from pathlib import Path

    def _book_annotations_xml_path(cfg: Mapping[str, Any], lecture_id: str, book_id: str) -> Path:
        data_dir = Path(str(cfg.get("data_dir") or "data"))
        return data_dir / "lectures" / lecture_id / "books" / book_id / "annotations.xml"

    def load_book_annotations_xml(cfg: Mapping[str, Any], lecture_id: str, book_id: str) -> str:
        path = _book_annotations_xml_path(cfg, lecture_id, book_id)
        if not path.exists():
            return ""
        try:
            return path.read_text(encoding="utf-8")
        except Exception:
            return ""

    def save_book_annotations_xml(cfg: Mapping[str, Any], lecture_id: str, book_id: str, content: str) -> str:
        path = _book_annotations_xml_path(cfg, lecture_id, book_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(str(content or ""), encoding="utf-8")
        return str(path)

    # 创建 LLM 压缩函数（简化版，批注流程不需要复杂压缩）
    def _llm_compress_func(text: str) -> str:
        """简单的文本截取压缩"""
        return text[:500] + "..." if len(text) > 500 else text

    return _run_annotation_generation_once_flow(
        cfg,
        lecture_id,
        book_id,
        actor=actor,
        model_name=model_name,
        get_lecture=get_lecture,
        get_book=get_book,
        load_book_info_xml=load_book_info_xml,
        load_book_detail_xml=load_book_detail_xml,
        load_book_annotations_xml=load_book_annotations_xml,
        save_book_annotations_xml=save_book_annotations_xml,
        update_book=update_book,
        resolve_book_text=_resolve_book_text,
        get_annotation_settings=get_annotation_settings,
        build_annotation_runner=build_annotation_runner,
        as_bool=_as_bool,
        log_event=log_event,
        append_log_text=append_log_text,
        push_model_output=_push_model_output,
        push_tool_call=_push_tool_call,
        policy=ContextPolicy.LLM_COMPRESS,
        llm_compress_func=_llm_compress_func,
    )


def run_book_summary_once(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    actor: str = "",
    model_name: str = "",
) -> Dict[str, Any]:
    """手动触发全书概述生成（委托 summary.py）。"""
    from pathlib import Path

    resolved_cfg = dict(cfg or {})
    lecture_key = str(lecture_id or "").strip()
    book_key = str(book_id or "").strip()
    data_dir = Path(str(resolved_cfg.get("data_dir") or "data")).resolve()
    summary_path = data_dir / "lectures" / lecture_key / "books" / book_key / "summary.xml"

    def save_book_summary(cfg: Mapping[str, Any], lecture_id: str, book_id: str, content: str) -> str:
        path = summary_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(str(content or ""), encoding="utf-8")
        return str(path)

    return _run_book_summary_once_flow(
        cfg,
        lecture_id,
        book_id,
        actor=actor,
        model_name=model_name,
        get_lecture=get_lecture,
        get_book=get_book,
        load_book_info_xml=load_book_info_xml,
        load_book_detail_xml=load_book_detail_xml,
        save_book_summary=save_book_summary,
        update_book=update_book,
        get_book_summary_settings=get_book_summary_settings,
        build_book_summary_runner=build_book_summary_runner,
        as_bool=_as_bool,
        log_event=log_event,
        append_log_text=append_log_text,
        push_model_output=_push_model_output,
        push_tool_call=_push_tool_call,
    )


def load_book_summary_from_storage(lecture_id: str, book_id: str) -> Dict[str, str]:
    """从 summary.xml 加载概述数据（供前端 API 调用）。"""
    from .summary import load_book_summary as _load_book_summary
    from pathlib import Path

    data_dir = str(Path(str((_CFG or {}).get("data_dir") or "./data")).resolve())
    return _load_book_summary(data_dir, lecture_id, book_id)


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
    section_review_model_name: str = "",
    section_review_temperature: float = 0.1,
    section_review_max_tokens: int = 1200,
    section_review_timeout: int = 120,
    section_review_stream: bool = True,
    section_review_think: bool = False,
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
    tempmem_key = _job_key(lecture_id, book_id)
    _set_tempmem_rows(tempmem_key, [])
    _set_read_progress(tempmem_key, {"max_end": 0, "calls": 0, "last_offset": 0, "last_length": 0})
    chunk_size = max(2000, int(max_input_chars))
    chunk_count = max(1, (total_len + chunk_size - 1) // chunk_size)
    resume_round = 1
    resume_reason = "initial"
    existing_planned_sections = _build_planned_sections_from_existing_chapters(chapters, total_len)

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
                    source="rough_reading",
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
            source="rough_reading",
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
            source="rough_reading",
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
            source="rough_reading",
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

    if existing_planned_sections:
        section_plan = {
            "mode": "sectioned",
            "sections": list(existing_planned_sections),
            "reason": "existing_bookinfo_outline",
            "candidates": [],
        }
        planned_sections = list(existing_planned_sections)
        plan_mode = "sectioned"
        heading_candidates: List[str] = []
    else:
        section_plan = _discover_coarse_sections(
            full_text,
            load_book_heading_candidates(_CFG, lecture_id, book_id),
        )
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
            body_search_start = heading_candidate_block_end(full_text)
            snapped_sections = _snap_outline_boundaries_by_index(
                full_text=full_text,
                sections=planned_sections,
                body_search_start=body_search_start,
            )
            if snapped_sections:
                planned_sections = snapped_sections
            log_event(
                "section_review_status",
                "分节复核阶段状态",
                payload={
                    "enabled": False,
                    "review_model": "",
                    "reason": "phase1_incremental_submit_chapter",
                    "sections_count": len(planned_sections),
                },
                content=_format_section_plan(planned_sections)[:1600],
            )
            log_model_text(
                (
                    "[section_review_status]\n"
                    "enabled=False\n"
                    "reason=phase1_incremental_submit_chapter\n"
                    f"sections_count={len(planned_sections)}\n"
                    f"{_format_section_plan(planned_sections)}"
                ),
                source="rough_reading",
            )
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
    if plan_mode == "sectioned" and planned_sections:
        existing_rows = _parse_existing_chapters(load_book_info_xml(_CFG, lecture_id, book_id))
        rows_by_range = {
            str(row.get("chapter_range") or "").strip(): dict(row)
            for row in existing_rows
            if str(row.get("chapter_range") or "").strip()
        }
        outline_changed = False

        for section in planned_sections:
            section_name = str(section.get("chapter_name") or "").strip()
            start = int(section.get("start") or 0)
            end = int(section.get("end") or 0)

            if not section_name or end <= start:
                continue

            section_range = f"{start}:{end - start}"

            if section_range in rows_by_range:
                continue

            rows_by_range[section_range] = {
                "chapter_name": section_name,
                "chapter_range": section_range,
                "chapter_summary": "",
                "chapter_status": "pending",
            }
            outline_changed = True

        if outline_changed or (not existing_rows and rows_by_range):
            def _range_start(row: Mapping[str, Any]) -> int:
                try:
                    return int(str(row.get("chapter_range") or "0:0").split(":", 1)[0])
                except Exception:
                    return 0

            chapters = sorted(rows_by_range.values(), key=_range_start)
            seen_signatures.clear()

            for row in chapters:
                seen_signatures.add(_chapter_signature(row))

            merged_output = _render_chapters_xml(chapters)
            outline_built = bool(chapters)
            save_book_info_xml(_CFG, lecture_id, book_id, merged_output)
            log_event(
                "bookinfo_outline_written",
                "第一阶段目录骨架已写入 bookinfo.xml",
                payload={
                    "lecture_id": lecture_id,
                    "book_id": book_id,
                    "chapters_count": len(chapters),
                    "reason": str(section_plan.get("reason") or ""),
                },
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
    log_model_text(
        (
            "[coarse_section_discovery]\n"
            f"mode={plan_mode}\n"
            f"sections_count={len(planned_sections)}\n"
            f"{_format_section_plan(planned_sections)}"
        ),
        source="rough_reading",
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
    section_mode: bool = False,
    current_section: Optional[Mapping[str, Any]] = None,
    rolling_read_window: bool = False,
    max_input_chars: int = 15000,
    lecture_id: str = "",
    book_id: str = "",
) -> Dict[str, Any]:
    """单轮粗读：使用工具读书并写章节，输出文本仅作调试。
    
    使用 Context Manager 管理上下文，自动处理截断。
    """
    from .coarse_loop import run_tool_driven_round_with_context
    from .context import ContextPolicy
    
    tools = _build_rough_read_tools()
    
    _llm_compress_func = _build_llm_compress_func(runner, _CFG)
    
    # 构建提示词
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
    
    # 使用新的 Context Manager 执行工具循环
    return run_tool_driven_round_with_context(
        runner=runner,
        tools=tools,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        full_text=full_text,
        total_len=total_len,
        chunk_start=chunk_start,
        chunk_end=chunk_end,
        max_input_chars=max_input_chars,
        max_turns=18,
        force_write_trigger_turns=4,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        request_timeout=request_timeout,
        stream=stream,
        think=think,
        on_delta=on_delta,
        on_save_chapter=on_save_chapter,
        on_update_chapter=on_update_chapter,
        log_event=log_event,
        log_model_text=log_model_text,
        log_tool_flow=log_tool_flow,
        push_book_progress_step=_push_book_progress_step,
        rolling_read_window=rolling_read_window,
        resume_round=resume_round,
        tempmem_key=tempmem_key,
        lecture_id=lecture_id,
        book_id=book_id,
        policy=ContextPolicy.LLM_COMPRESS,
        llm_compress_func=_llm_compress_func,
    )


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
            section_mode=True,
            current_section=section,
            rolling_read_window=False,
            lecture_id=lecture_id,
            book_id=book_id,
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
    max_input_chars: int = 15000,
) -> str:
    """Strict phase-2 summary filler: only update summary/status for existing outline rows.
    
    使用 Context Manager 管理上下文，自动处理截断。
    """
    from .summary_loop import run_summary_tool_loop
    from .context import ContextPolicy
    
    total_len = len(full_text)
    merged_output = str(previous_rough_summary or "")
    resume_round = 1

    def _exec_read(args: Dict[str, Any]) -> Dict[str, Any]:
        return _exec_read_book_text_tool(full_text=full_text, total_len=total_len, arguments=args)

    def _exec_index(args: Dict[str, Any]) -> Dict[str, Any]:
        return _exec_index_book_text_tool(full_text=full_text, total_len=total_len, arguments=args)

    def _exec_savemem(args: Dict[str, Any]) -> Dict[str, Any]:
        return _exec_save_tempmem_tool(tempmem_key=tempmem_key, arguments=args)

    _llm_compress_func = _build_llm_compress_func(runner, _CFG)

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
            str(getattr(learning_prompts, "COARSE_SECTION_SUMMARY_SYSTEM_PROMPT", "") or ""),
        )
        summary_user_tpl = _load_prompt_text(
            "coarse_section_summary.user",
            str(getattr(learning_prompts, "COARSE_SECTION_SUMMARY_USER_PROMPT", "") or ""),
        )
        system_prompt = _render_prompt(summary_system_tpl, {})
        user_prompt_template = summary_user_tpl
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
                    "name": "find",
                    "description": "Find keyword in the current chapter range and return exact offsets plus nearby context.",
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
                    "description": "Write chapter_summary for the current locked chapter only.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "chapter_summary": {"type": "string"},
                        },
                        "required": ["chapter_summary"],
                    },
                },
            },
        ]

        _set_book_progress(lecture_id, book_id, f"模型正在阅读章节<{chapter_name or '未命名章节'}>...")

        # 使用 Context Manager 执行工具循环
        result = run_summary_tool_loop(
            runner=runner,
            system_prompt=system_prompt,
            user_prompt_template=user_prompt_template,
            tools=tools,
            full_text=full_text,
            total_len=total_len,
            chunk_start=chunk_start,
            chunk_end=chunk_end,
            chapter_name=chapter_name,
            chapter_range=chapter_range,
            chapter_preload_text=chapter_preload_text,
            preload_start=preload_start,
            preload_end=preload_end,
            max_input_chars=max_input_chars,
            max_turns=40,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            request_timeout=request_timeout,
            stream=stream,
            think=think,
            on_delta=on_delta,
            on_update_summary=on_update_summary,
            on_read=_exec_read,
            on_index=_exec_index,
            on_savemem=_exec_savemem,
            log_event=log_event,
            is_cancelled=lambda: _is_cancelled_key(cancel_key),
            push_book_progress_step=_push_book_progress_step,
            resume_round=resume_round,
            section_index=section_index,
            lecture_id=lecture_id,
            book_id=book_id,
            policy=ContextPolicy.LLM_COMPRESS,
            llm_compress_func=_llm_compress_func,
        )

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
    """模型驱动的第一阶段：通过工具逐章提交目录骨架。"""
    from .context import Context, ContextPolicy

    effective_stream = bool(stream)
    stagnant_rounds = 0
    outline_sections: List[Dict[str, Any]] = []
    outline_submitted = False
    discovered_offsets: Dict[str, int] = {}
    raw_full_text = str(full_text or "")
    body_search_start = heading_candidate_block_end(raw_full_text)
    candidate_block = _format_heading_hints(heading_candidates)
    planning_system_tpl = _load_prompt_text(
        "coarse_section_planning.system",
        str(getattr(learning_prompts, "COARSE_SECTION_PLANNING_SYSTEM_PROMPT", "") or ""),
    )
    planning_user_tpl = _load_prompt_text(
        "coarse_section_planning.user",
        str(getattr(learning_prompts, "COARSE_SECTION_PLANNING_USER_PROMPT", "") or ""),
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
                "name": "submit_chapter",
                "description": "Submit exactly one confirmed chapter boundary. Do not submit multiple chapters in one call.",
                "parameters": {
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
        {
            "type": "function",
            "function": {
                "name": "finish_outline",
                "description": "Finish phase 1 after all real body chapters have been submitted with submit_chapter.",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": [],
                },
            },
        },
    ]
    assistant_text = ""
    turn = 0
    max_planning_turns = max(16, min(120, len(heading_candidates) + 12))
    llm_compress_func = _build_llm_compress_func(runner, _CFG)
    ctx = Context(
        max_chars=max(18000, min(60000, int(len(candidate_block) + 18000))),
        policy=ContextPolicy.LLM_COMPRESS,
        llm_compress_func=llm_compress_func,
        trace_meta={
            "flow": "coarse_section_planning",
            "lecture_id": str(lecture_id or ""),
            "book_id": str(book_id or ""),
        },
    )

    def _build_planning_state_prompt() -> str:
        """生成逐章分节状态提示，明确历史章节和下一章起点。"""
        if not outline_sections:
            return (
                "Backend state: no chapter has been submitted yet.\n"
                f"Current task: locate and submit the first real body chapter. Search from offset {int(body_search_start)} or later."
            )

        last_section = outline_sections[-1]
        next_start = int(last_section.get("end") or body_search_start)
        submitted_outline = _format_section_plan(outline_sections)
        return (
            "Backend state: submitted chapters so far:\n"
            f"{submitted_outline}\n\n"
            f"Current task: locate and submit the next chapter after offset {next_start}. "
            "Do not resubmit previous chapters. "
            "Use submit_chapter(chapter_name,start,end) for exactly one next chapter, "
            "or call finish_outline() only if the last submitted chapter reaches the real end of the book body."
        )

    ctx.add("system", prompt)
    ctx.add("user", user_prompt)
    ctx.add("user", _build_planning_state_prompt())

    while not outline_submitted:
        turn += 1
        _set_book_progress(lecture_id, book_id, "模型正在划分章节...")
        context_executed = ctx.prepare()
        if context_executed:
            log_event(
                "context_operation",
                "分节规划上下文压缩",
                payload={
                    "turn": int(turn),
                    "policy": ctx.policy.value,
                    "context_chars": ctx.chars(),
                    "messages_count": ctx.count(),
                },
            )

        request_messages = ctx.build()
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
        round_delta_parts: List[str] = []
        round_merge_key = f"planning:{turn}"

        def _on_planning_delta(delta_text: str) -> None:
            piece = str(delta_text or "")
            if not piece:
                return

            round_delta_parts.append(piece)

            if on_delta:
                on_delta(piece)

            _push_book_progress_step(
                lecture_id,
                book_id,
                {
                    "type": "model_text",
                    "title": f"模型输出（分节规划第 {turn} 轮）",
                    "preview": piece,
                    "merge_key": round_merge_key,
                },
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
            on_delta=_on_planning_delta,
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

        # 推送模型文本输出到活动日志：非流式响应也按轮次占一块。
        if content.strip() and not round_delta_parts:
            _push_book_progress_step(
                lecture_id,
                book_id,
                {
                    "type": "model_text",
                    "title": f"模型输出（分节规划第 {turn} 轮）",
                    "preview": content,
                    "merge_key": round_merge_key,
                },
            )
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
        if tool_calls:
            ctx.add("assistant", content if content else "", tool_calls=tool_calls)
        elif content:
            ctx.add("assistant", content)

        if not tool_calls:
            ctx.add(
                "user",
                (
                    "No valid tool call detected. "
                    "You must call submit_chapter(chapter_name, start, end) for one chapter, "
                    "or finish_outline() after all chapters have been submitted. "
                    "Do not answer in plain text."
                ),
            )
            stagnant_rounds += 1
            continue
        had_progress = False
        submitted_chapter_this_turn = False
        submitted_state_prompt = ""
        for call in tool_calls:
            if not isinstance(call, dict):
                continue
            call_id = str(call.get("id") or "")
            func = call.get("function") if isinstance(call.get("function"), dict) else {}
            tool_name = str(func.get("name") or "").strip()
            args_obj = _safe_json_obj(str(func.get("arguments") or "{}"))
            _push_book_progress_step(
                lecture_id,
                book_id,
                {
                    "type": "tool_call",
                    "title": f"工具调用：{tool_name or 'unknown'}",
                    "preview": _safe_json_dumps(args_obj),
                },
            )
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
                        offset = _select_heading_hit_offset(hits)
                        if offset >= 0:
                            prev = discovered_offsets.get(keyword)
                            if prev is None or offset < prev:
                                discovered_offsets[keyword] = offset
                except Exception:
                    pass
            elif tool_name in {"savemem", "save_tempmem"}:
                result_obj = {"ok": True, "saved": True, "note": str(args_obj.get("note") or "").strip()}
            elif tool_name == "submit_chapter":
                if submitted_chapter_this_turn:
                    result_obj = {
                        "ok": False,
                        "error": "only one submit_chapter call is allowed per round",
                        "next_action": "wait for the next model round before submitting another chapter",
                    }
                else:
                    name = str(args_obj.get("chapter_name") or "").strip()
                    try:
                        start = int(args_obj.get("start"))
                        end = int(args_obj.get("end"))
                    except Exception:
                        start = -1
                        end = -1

                    start = max(int(body_search_start), min(len(full_text) - 1, start))
                    end = max(start + 1, min(len(full_text), end))
                    previous_end = int(outline_sections[-1].get("end") or 0) if outline_sections else int(body_search_start)
                    previous_start = int(outline_sections[-1].get("start") or 0) if outline_sections else -1

                    if not name:
                        result_obj = {"ok": False, "error": "chapter_name is required"}
                    elif start <= previous_start:
                        result_obj = {
                            "ok": False,
                            "error": f"chapter start must be after previous chapter start {previous_start}",
                            "submitted_count": len(outline_sections),
                        }
                    elif start < previous_end:
                        result_obj = {
                            "ok": False,
                            "error": f"chapter overlaps previous chapter ending at {previous_end}",
                            "submitted_count": len(outline_sections),
                        }
                    else:
                        outline_sections.append(
                            {
                                "chapter_name": name,
                                "start": int(start),
                                "end": int(end),
                                "range": f"{int(start)}:{max(1, int(end) - int(start))}",
                            }
                        )
                        submitted_chapter_this_turn = True
                        had_progress = True
                        stagnant_rounds = 0
                        result_obj = {
                            "ok": True,
                            "submitted_count": len(outline_sections),
                            "current_chapter": f"{name} | {start}:{max(1, end - start)}",
                            "submitted_outline": _format_section_plan(outline_sections),
                            "next_search_start": int(end),
                            "next_action": "submit the next chapter with submit_chapter, or call finish_outline if this was the final chapter",
                        }
                        submitted_state_prompt = _build_planning_state_prompt()
            elif tool_name == "finish_outline":
                if outline_sections:
                    outline_submitted = True
                    result_obj = {"ok": True, "sections_count": len(outline_sections)}
                else:
                    result_obj = {"ok": False, "error": "cannot finish outline before submit_chapter succeeds at least once"}
            elif tool_name == "submit_outline":
                result_obj = {
                    "ok": False,
                    "error": "submit_outline is disabled. Submit exactly one chapter with submit_chapter(chapter_name,start,end).",
                }
            else:
                result_obj = {"ok": False, "error": f"unsupported tool: {tool_name}"}
            ctx.add("tool", _safe_json_dumps(result_obj), tool_call_id=call_id)
            log_event(
                "section_planning_tool_result",
                "分节规划工具结果",
                payload={"turn": int(turn), "tool_name": tool_name, "tool_call_id": call_id},
                content=_safe_json_dumps(result_obj)[:2400],
            )
        if outline_submitted and outline_sections:
            break
        if submitted_state_prompt:
            ctx.add("user", submitted_state_prompt)
        if not had_progress:
            stagnant_rounds += 1
        if stagnant_rounds >= 3:
            log_event(
                "section_planning_stagnant",
                "分节规划连续多轮未提交骨架",
                payload={"turn": int(turn), "stagnant_rounds": int(stagnant_rounds)},
                content="no valid submit_chapter or finish_outline tool call produced after repeated tool rounds",
            )
            ctx.add(
                "user",
                (
                    "Hard constraint: this phase can only progress through tools. "
                    "Call submit_chapter(chapter_name,start,end) for exactly one next chapter, "
                    "or finish_outline() if all chapters were already submitted."
                ),
            )
        if turn >= max_planning_turns:
            log_event(
                "section_planning_stop_no_submit",
                "分节规划达到最大轮次仍未提交骨架",
                payload={
                    "turn": int(turn),
                    "stagnant_rounds": int(stagnant_rounds),
                    "submitted_count": len(outline_sections),
                },
                content="model kept using tools without submit_chapter or finish_outline; stop phase-1 loop",
            )
            break
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
        first_start = int(sections[0].get("start") or 0)
        if first_start > max(50000, int(total_len) // 4):
            log_event(
                "section_planning_auto_outline_reject",
                "自动骨架起点过晚，拒绝写入，避免误用书末目录",
                payload={"sections_count": len(sections), "first_start": int(first_start), "total_len": int(total_len)},
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


def _snap_outline_boundaries_by_index(
    *,
    full_text: str,
    sections: List[Dict[str, Any]],
    body_search_start: int = 0,
) -> List[Dict[str, Any]]:
    """用标题 index 命中校准章节起点，再重算章节区间。"""
    raw = str(full_text or "")
    total_len = len(raw)
    if total_len <= 0 or not sections:
        return list(sections or [])
    normalized = sorted([dict(row or {}) for row in list(sections or [])], key=lambda x: int(x.get("start") or 0))
    snapped_starts: List[int] = []
    for idx, row in enumerate(normalized):
        title = str(row.get("chapter_name") or "").strip()
        try:
            old_start = int(row.get("start") or 0)
        except Exception:
            old_start = 0
        old_start = max(0, min(total_len - 1, old_start))
        if not title:
            snapped_starts.append(old_start)
            continue
        prev_start = int(normalized[idx - 1].get("start") or 0) if idx > 0 else int(body_search_start or 0)
        next_start = int(normalized[idx + 1].get("start") or total_len) if idx + 1 < len(normalized) else total_len
        search_start = max(int(body_search_start or 0), prev_start, old_start - 6000)
        search_end = min(total_len, max(old_start + 6000, next_start + 1200))
        if search_end <= search_start:
            search_start = max(int(body_search_start or 0), old_start - 6000)
            search_end = min(total_len, old_start + 6000)
        hit = _exec_index_book_text_tool(
            full_text=raw,
            total_len=total_len,
            arguments={
                "keyword": title,
                "range_start": int(search_start),
                "range_end": int(search_end),
                "context_range": 220,
                "max_hits": 6,
            },
        )
        best_start = old_start
        if isinstance(hit, dict):
            hits = hit.get("hits") if isinstance(hit.get("hits"), list) else []
            ranked: List[Tuple[int, int, int]] = []
            for item in hits:
                if not isinstance(item, dict):
                    continue
                try:
                    off = int(item.get("offset") or item.get("match_start") or -1)
                except Exception:
                    off = -1
                if off < 0:
                    continue
                snippet = str(item.get("text") or "")
                score = _score_heading_hit(snippet)
                dist = abs(off - old_start)
                ranked.append((score, -dist, off))
            if ranked:
                ranked.sort(reverse=True)
                best_start = int(ranked[0][2])
        snapped_starts.append(max(0, min(total_len - 1, best_start)))
    cleaned_starts: List[int] = []
    last = max(0, int(body_search_start or 0))
    for s in snapped_starts:
        cur = max(last, int(s))
        cleaned_starts.append(cur)
        last = cur + 1
    adjusted: List[Dict[str, Any]] = []
    for idx, row in enumerate(normalized):
        start = cleaned_starts[idx]
        end = cleaned_starts[idx + 1] if idx + 1 < len(cleaned_starts) else total_len
        end = max(start + 1, min(total_len, end))
        adjusted.append(
            {
                "chapter_name": str(row.get("chapter_name") or "").strip() or f"Chapter {idx + 1}",
                "start": int(start),
                "end": int(end),
                "range": f"{int(start)}:{max(1, int(end) - int(start))}",
            }
        )
    return adjusted


def _review_outline_sections_with_model(
    *,
    runner: Any,
    review_model_name: str,
    lecture_name: str,
    book_name: str,
    full_text: str,
    heading_candidates: List[str],
    planned_sections: List[Dict[str, Any]],
    body_search_start: int,
    temperature: float,
    max_tokens: int,
    request_timeout: int,
    stream: bool,
    think: bool,
) -> List[Dict[str, Any]]:
    """独立模型复核分节边界，必须走 submit_outline。失败返回原分节。"""
    model_to_use = str(review_model_name or "").strip()
    if not model_to_use:
        return list(planned_sections or [])
    candidate_block = _format_heading_hints(list(heading_candidates or []))
    total_len = len(str(full_text or ""))
    system_prompt = (
        "You are section-boundary reviewer for coarse reading phase-1.\n"
        "Goal: refine chapter boundaries with index/read tools.\n"
        "Rules:\n"
        "1) Keep chapter order and chapter count unless boundary is clearly wrong.\n"
        "2) Prefer chapter-level boundaries, avoid tiny fragments.\n"
        "3) Ignore matches in EPUB heading candidates header block.\n"
        "4) Must call submit_outline(sections=[...]) and finish the outline submission. No plain final text."
    )
    user_prompt = (
        f"Course: {lecture_name}\n"
        f"Book: {book_name}\n"
        f"Body search start offset: {int(body_search_start)}\n"
        f"Heading candidates:\n{candidate_block or '(none)'}\n\n"
        "Please find chapter boundaries from text by using index/read and submit sections."
    )
    tools = [
        {
            "type": "function",
            "function": {
                "name": "read",
                "description": "Read full-book text by global offset and length.",
                "parameters": {
                    "type": "object",
                    "properties": {"offset": {"type": "integer"}, "length": {"type": "integer"}},
                    "required": ["offset", "length"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "index",
                "description": "Find keyword in a range and return exact offsets with snippets.",
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
                "name": "submit_outline",
                "description": "Submit final reviewed sections with chapter_name/start/end.",
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
                        }
                    },
                    "required": ["sections"],
                },
            },
        },
    ]
    messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]
    turn_history: List[Dict[str, Any]] = []
    submitted: List[Dict[str, Any]] = []
    for turn in range(1, 9):
        request_messages = list(messages)
        if turn_history:
            request_messages.extend(turn_history)
        response = runner.nexora_client.proxy.chat_completions(
            messages=request_messages,
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
            log_event(
                "section_review_failed",
                "分节复核模型调用失败，回退原分节",
                payload={"turn": int(turn), "review_model": model_to_use},
                content=str(response.get("message") or ""),
            )
            return list(planned_sections or [])
        payload = response.get("payload") if isinstance(response.get("payload"), dict) else {}
        choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
        if not choices:
            continue
        msg = choices[0].get("message") if isinstance(choices[0], dict) else {}
        content = str((msg or {}).get("content") or "")
        raw_tool_calls = (msg or {}).get("tool_calls") if isinstance((msg or {}).get("tool_calls"), list) else []
        tool_calls: List[Dict[str, Any]] = []
        for raw_call in raw_tool_calls:
            if not isinstance(raw_call, dict):
                continue
            raw_func = raw_call.get("function") if isinstance(raw_call.get("function"), dict) else {}
            tool_calls.append(
                {
                    "id": str(raw_call.get("id") or ""),
                    "type": "function",
                    "function": {
                        "name": str(raw_func.get("name") or "").strip(),
                        "arguments": _safe_json_dumps(_safe_json_obj(str(raw_func.get("arguments") or "{}"))),
                    },
                }
            )
        turn_history.append({"role": "assistant", "content": content if content else None, "tool_calls": tool_calls if tool_calls else None})
        if not tool_calls:
            turn_history.append(
                {
                    "role": "user",
                    "content": "No valid tool call detected. You must call submit_outline(sections=[...]) and finish the outline submission.",
                }
            )
            continue
        for call in tool_calls:
            call_id = str(call.get("id") or "")
            func = call.get("function") if isinstance(call.get("function"), dict) else {}
            tool_name = str(func.get("name") or "").strip()
            args_obj = _safe_json_obj(str(func.get("arguments") or "{}"))
            if tool_name in {"read", "read_book_text"}:
                result_obj = _exec_read_book_text_tool(full_text=full_text, total_len=total_len, arguments=args_obj)
            elif tool_name in {"index", "index_book_text"}:
                try:
                    req_start = int(args_obj.get("range_start") or body_search_start)
                except Exception:
                    req_start = body_search_start
                args_obj["range_start"] = max(int(body_search_start), int(req_start))
                args_obj["range_end"] = int(total_len)
                result_obj = _exec_index_book_text_tool(full_text=full_text, total_len=total_len, arguments=args_obj)
            elif tool_name == "submit_outline":
                parsed: List[Dict[str, Any]] = []
                raw_sections = args_obj.get("sections")
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
                        start = max(int(body_search_start), min(total_len - 1, start))
                        end = max(start + 1, min(total_len, end))
                        parsed.append(
                            {
                                "chapter_name": name,
                                "start": int(start),
                                "end": int(end),
                                "range": f"{int(start)}:{max(1, int(end) - int(start))}",
                            }
                        )
                parsed.sort(key=lambda item: int(item.get("start") or 0))
                submitted = parsed
                result_obj = {"ok": bool(submitted), "sections_count": len(submitted)}
            else:
                result_obj = {"ok": False, "error": f"unsupported tool: {tool_name}"}
            turn_history.append({"role": "tool", "tool_call_id": call_id, "content": _safe_json_dumps(result_obj)})
        if submitted:
            snapped = _snap_outline_boundaries_by_index(
                full_text=full_text,
                sections=submitted,
                body_search_start=body_search_start,
            )
            if snapped:
                log_event(
                    "section_review_applied",
                    "分节复核结果已应用",
                    payload={"review_model": model_to_use, "sections_count": len(snapped)},
                    content=_format_section_plan(snapped)[:2400],
                )
                return snapped
    return list(planned_sections or [])


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
    # 标题常见问题：文本中会插入空白/换行/全角空格，导致精确子串匹配错失命中。
    # 这里增加一个宽松匹配形态（去空白）作为兜底。
    loose_needle = re.sub(r"\s+", "", needle)
    cursor = 0
    hits: List[Dict[str, Any]] = []
    header_block_end = heading_candidate_block_end(raw)
    while cursor < len(source) and len(hits) < max_hits:
        local_idx = source.find(needle, cursor)
        matched_len = len(needle)
        if local_idx < 0 and loose_needle:
            loose_source = re.sub(r"\s+", "", source[cursor:])
            loose_idx = loose_source.find(loose_needle)
            if loose_idx >= 0:
                # 将去空白后的命中大致映射回原始坐标：从 cursor 往后扫描到累计非空白字符位置。
                non_ws = 0
                mapped = -1
                for raw_idx, ch in enumerate(source[cursor:]):
                    if not ch.isspace():
                        if non_ws == loose_idx:
                            mapped = raw_idx
                            break
                        non_ws += 1
                if mapped >= 0:
                    local_idx = mapped
                    matched_len = max(1, len(keyword))
        if local_idx < 0:
            break
        match_start = range_start + local_idx
        if header_block_end > 0 and match_start < header_block_end:
            cursor = max(cursor + 1, local_idx + len(keyword))
            continue
        match_end = match_start + matched_len
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
        cursor = max(cursor + 1, local_idx + matched_len)
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


def _extract_epub_heading_candidates(
    full_text: str,
    sidecar_candidates: Optional[List[str]] = None,
) -> List[str]:
    """读取 EPUB 候选标题；优先用抽取阶段写入的 structure.json 侧车。

    新版抽取不再把候选标题写进正文，因此侧车是首选来源；旧文本仍保留内联块，
    再缺失时才从 XHTML 结构中重建候选。
    """
    rows: List[str] = []
    seen: set[str] = set()

    def _push(values: List[str]) -> None:
        for item in values:
            value = re.sub(r"\s+", " ", str(item or "").strip())
            if value.startswith("-"):
                value = value[1:].strip()
            if not value or len(value) > 80:
                continue
            key = value.lower()
            if key in seen:
                continue
            seen.add(key)
            rows.append(value)

    if sidecar_candidates:
        _push(list(sidecar_candidates))
        if rows:
            return rows

    raw = str(full_text or "")
    begin = raw.find("[EPUB_HEADING_CANDIDATES]")
    end = raw.find("[/EPUB_HEADING_CANDIDATES]")
    if begin < 0 or end < 0 or end <= begin:
        _push(extract_epub_heading_candidates_from_text(raw))
        return rows
    _push(raw[begin + len("[EPUB_HEADING_CANDIDATES]"):end].splitlines())
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
    if len(text) > 80:
        return False
    if "。" in text:
        return False
    if re.fullmatch(r"[0-9\s.]+", text):
        return False
    return True


def _heading_candidate_priority(value: str) -> int:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    if not text:
        return 2
    if re.match(r"^第\s*[0-9零〇一二三四五六七八九十百千万两]+\s*(章节|章|篇|卷)", text):
        return 0
    if re.match(r"(?i)^(chapter|part|book)\s+[0-9ivxlcdm]+", text):
        return 0
    if re.match(r"^第\s*[0-9零〇一二三四五六七八九十百千万两]+\s*(大部分|部分|部)", text):
        return 1
    if re.match(r"^[0-9]{1,3}\s+.{1,80}$", text):
        return 1
    return 2


def _prioritize_heading_candidates(headings: List[str]) -> List[str]:
    """把章/篇级标题排在候选列表前面，避免小节标题挤占规划上下文。"""
    primary: List[str] = []
    secondary: List[str] = []
    regular: List[str] = []
    seen: set[str] = set()
    for item in list(headings or []):
        text = re.sub(r"\s+", " ", str(item or "").strip())
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        priority = _heading_candidate_priority(text)
        if priority == 0:
            primary.append(text)
        elif priority == 1:
            secondary.append(text)
        else:
            regular.append(text)
    return primary + secondary + regular


def _score_heading_hit(snippet: str) -> int:
    """优先选择更像正文标题节点的命中位置。"""
    text = str(snippet or "")
    lower = text.lower()
    score = 0
    if re.search(r"<h[1-6][^>]*>", text, flags=re.IGNORECASE):
        score += 4
    if re.search(r"</h[1-6]>", text, flags=re.IGNORECASE):
        score += 2
    if re.search(r"<title>", text, flags=re.IGNORECASE):
        score += 1
    if re.search(r"\b(id|class)\s*=\s*['\"][^'\"]*(chapter|heading|title|filepos)", lower):
        score += 2
    if re.search(r">\s*(?:<[^>]+>\s*){0,8}第\s*[0-9零〇一二三四五六七八九十百千万两]+\s*(大部分|部分|章节|章|节|篇|卷|部)", text):
        score += 3
    if re.search(r"<a\b[^>]*href\s*=", text, flags=re.IGNORECASE):
        score -= 1
    if re.search(r"\b(toc|nav)\b|目录", lower):
        score -= 1
    return score


def _select_heading_hit_offset(hits: List[Any]) -> int:
    """从 index 命中中选择最像正文标题节点的位置。"""
    ranked: List[Tuple[int, int, int]] = []
    for item in list(hits or []):
        if not isinstance(item, dict):
            continue
        try:
            offset = int(item.get("offset") or item.get("match_start") or -1)
        except Exception:
            offset = -1
        if offset < 0:
            continue
        snippet = str(item.get("text") or "")
        ranked.append((_score_heading_hit(snippet), -offset, offset))
    if not ranked:
        return -1
    ranked.sort(reverse=True)
    return int(ranked[0][2])


def _discover_html_chapter_heading_sections(full_text: str) -> List[Dict[str, Any]]:
    """从 XHTML 正文标题节点直接提取章级边界，避免误用书末目录 filepos。"""
    raw = str(full_text or "")
    total_len = len(raw)
    if total_len <= 0:
        return []

    span_pattern = re.compile(
        r"(?is)<span\b([^>]*)>\s*(第\s*[0-9零〇一二三四五六七八九十百千两]+\s*章)\s*</span>"
    )
    title_pattern = re.compile(r"(?is)<span\b([^>]*)>\s*(.*?)\s*</span>")
    rows: List[Dict[str, Any]] = []
    seen_ordinals: set[int] = set()

    for match in span_pattern.finditer(raw):
        attrs = str(match.group(1) or "").lower()
        if "calibre_54" not in attrs:
            continue

        chapter_label = _preview_plain_text(match.group(2), limit=0)
        chapter_ordinal = _parse_chapter_ordinal(chapter_label)
        if chapter_ordinal is None or chapter_ordinal in seen_ordinals:
            continue

        title = ""
        follow_text = raw[match.end(): min(total_len, match.end() + 1800)]
        for title_match in title_pattern.finditer(follow_text):
            title_attrs = str(title_match.group(1) or "").lower()
            if "calibre_54" not in title_attrs:
                continue

            candidate = _preview_plain_text(title_match.group(2), limit=0)
            if not candidate:
                continue
            if _parse_chapter_ordinal(candidate) is not None:
                continue
            if len(candidate) > 80 or "。" in candidate:
                continue

            title = candidate
            break

        chapter_name = f"{chapter_label} {title}".strip()
        section_start = raw.rfind("<?xml", 0, match.start())
        if section_start < 0 or match.start() - section_start > 3000:
            section_start = match.start()

        rows.append(
            {
                "chapter_name": chapter_name,
                "start": int(section_start),
                "chapter_ordinal": int(chapter_ordinal),
            }
        )
        seen_ordinals.add(int(chapter_ordinal))

    rows.sort(key=lambda item: int(item.get("start") or 0))
    if len(rows) < 4:
        return []

    last_ordinal = 0
    for row in rows:
        current_ordinal = int(row.get("chapter_ordinal") or 0)
        if current_ordinal <= last_ordinal:
            return []
        last_ordinal = current_ordinal

    sections: List[Dict[str, Any]] = []
    for index, row in enumerate(rows):
        start = int(row.get("start") or 0)
        end = int(rows[index + 1].get("start") or total_len) if index + 1 < len(rows) else total_len
        end = max(start + 1, min(total_len, end))
        sections.append(
            {
                "chapter_name": str(row.get("chapter_name") or "").strip(),
                "start": int(start),
                "end": int(end),
                "range": f"{int(start)}:{max(1, int(end) - int(start))}",
            }
        )

    return sections


def _discover_coarse_sections(
    full_text: str,
    sidecar_candidates: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """发现可用于概读的章级结构；可靠正文标题优先直接生成骨架。"""
    raw = str(full_text or "")
    total_len = len(raw)
    if total_len <= 0:
        return {"mode": "fallback", "sections": [], "reason": "empty_text", "candidates": []}

    raw_headings = _extract_epub_heading_candidates(raw, sidecar_candidates)
    headings = _prioritize_heading_candidates([item for item in raw_headings if _is_probable_section_heading(item)])
    html_sections = _discover_html_chapter_heading_sections(raw)
    if html_sections:
        return {
            "mode": "sectioned",
            "sections": html_sections,
            "reason": "html_chapter_heading_structure",
            "candidates": headings,
        }

    reason = "no_structural_heading_candidates"

    if headings:
        if sidecar_candidates:
            reason = "structure_sidecar_candidates_available"
        elif "[EPUB_HEADING_CANDIDATES]" in raw:
            reason = "epub_heading_candidates_available"
        else:
            reason = "structural_heading_candidates_available"

    return {
        "mode": "model_planning" if headings else "fallback",
        "sections": [],
        "reason": reason,
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
        line = re.sub(r"^[#>\-\*•]+\s*", "", line)
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
        str(getattr(learning_prompts, "COARSE_SUMMARY_REVIEW_SYSTEM_PROMPT", "") or ""),
    )
    review_user_tpl = _load_prompt_text(
        "coarse_summary_review.user",
        str(getattr(learning_prompts, "COARSE_SUMMARY_REVIEW_USER_PROMPT", "") or ""),
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


def _build_planned_sections_from_existing_chapters(chapters: List[Dict[str, str]], total_len: int) -> List[Dict[str, Any]]:
    """把已存在的 bookinfo.xml 章节骨架转换为续跑用分节计划。"""
    sections: List[Dict[str, Any]] = []
    safe_total = max(0, int(total_len or 0))

    for row in list(chapters or []):
        name = str((row or {}).get("chapter_name") or "").strip()
        range_text = str((row or {}).get("chapter_range") or "").strip()

        if not name or not re.match(r"^\d+:\d+$", range_text):
            continue

        try:
            start_s, length_s = range_text.split(":", 1)
            start = int(start_s)
            length = int(length_s)
        except Exception:
            continue

        if start < 0 or length <= 0:
            continue

        end = min(safe_total, start + length) if safe_total > 0 else start + length
        if end <= start:
            continue

        sections.append({
            "chapter_name": name,
            "start": start,
            "end": end,
            "range": f"{start}:{end - start}",
        })

    return sections


def _render_chapters_xml(chapters: List[Dict[str, str]]) -> str:
    """将章节结构渲染为 bookinfo.xml 文本。"""
    lines: List[str] = ["<coordinate_space>plain</coordinate_space>", ""]
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
            "section_status": "idle",
            "section_error": "",
            "section_model": "",
            "summary_status": "idle",
            "summary_error": "",
            "summary_model": "",
            "annotation_status": "idle",
            "annotation_error": "",
            "annotation_model": "",
            "video_status": "idle",
            "video_error": "",
            "pipeline_status": "idle",
            "pipeline_error": "",
            "pipeline_job_id": "",
            "pipeline_requested_at": 0,
            "pipeline_finished_at": 0,
            "updated_at": ts,
        },
    )
    _set_book_progress(lecture_id, book_id, "")
