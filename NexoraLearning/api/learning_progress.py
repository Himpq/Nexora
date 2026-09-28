"""Learning progress routes.

Blueprint name: learning_progress_bp
Prefix: /api

Endpoints:
    POST  /api/frontend/learning/chapter-complete
    POST  /api/frontend/learning/session-complete
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from flask import Blueprint, jsonify, request

from core import user as user_store
from core.bookindex import get_book_index
from core.lectures import get_book as get_lecture_book, get_lecture as get_learning_lecture, list_books
from core.memory.memory_queue import enqueue_memory_job
from core.runlog import log_event
from core.user.learning_progress import (
    build_user_study_hours_map,
    compute_user_lecture_progress,
    init_learning_progress as _init_lp,
)
from core.user.reading_progress import (
    PROGRESS_LOCK,
    ProgressConflict,
    chapter_for_record,
    nonnegative_integer,
    record_reading_checkpoint,
    reset_chapter_reading_progress,
    resolve_progress_chapter,
    valid_identifier,
)

learning_progress_bp = Blueprint("learning_progress", __name__, url_prefix="/api")
_cfg: Dict[str, Any] = {}


def init_learning_progress(cfg: Dict[str, Any]) -> None:
    global _cfg
    _cfg = cfg
    _init_lp(cfg)


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def _resolve_runtime_user_id() -> str:
    """Resolve one explicit identity; conflicting request identities are rejected."""
    candidates = [str(request.args.get("username") or "").strip()]
    data = request.get_json(silent=True) or {}
    if isinstance(data, dict):
        candidates.extend([str(data.get("username") or "").strip(), str(data.get("user_id") or "").strip()])
    for header_name in (
        "X-Nexora-Username",
        "X-Username",
        "X-User",
        "X-User-Id",
        "X-Auth-User",
        "X-Forwarded-User",
    ):
        candidates.append(str(request.headers.get(header_name) or "").strip())
    identities = {candidate for candidate in candidates if candidate}
    if len(identities) == 1:
        username = identities.pop()
        if valid_identifier(username):
            return username

    log_event(
        "learning_progress_user_resolution_failed",
        "Learning progress rejected because no explicit runtime user was provided.",
        payload={
            "has_cookie": bool(str(request.headers.get("Cookie") or "").strip()),
            "path": str(request.path or "").strip(),
        },
    )
    return ""


@learning_progress_bp.route("/frontend/learning/reading-progress", methods=["POST"])
def frontend_learning_reading_progress():
    """Persist observed coverage immediately without asserting comprehension."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"success": False, "error": "A JSON object is required."}), 400
    username = _resolve_runtime_user_id()
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    if not username or not valid_identifier(lecture_id) or not valid_identifier(book_id):
        return jsonify({"success": False, "error": "Valid username, lecture_id and book_id are required."}), 400
    if not get_learning_lecture(_cfg, lecture_id) or not get_lecture_book(_cfg, lecture_id, book_id):
        return jsonify({"success": False, "error": "lecture or book not found."}), 404
    try:
        recorded = record_reading_checkpoint(_cfg, username, data)
    except ProgressConflict as exc:
        return jsonify({"success": False, "error": str(exc)}), 409
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    progress = compute_user_lecture_progress(username, lecture_id, list_books(_cfg, lecture_id), cfg=_cfg)
    record = recorded["record"]
    chapter = next((
        item for item in progress["chapters"]
        if item["book_id"] == book_id and item["chapter_index"] == record["chapter_index"]
    ), {})
    return jsonify({
        "success": True,
        "already_recorded": recorded["already_recorded"],
        "study_seconds": recorded["study_seconds"],
        "progress": progress,
        "chapter": chapter,
    })


# ─────────────────────────────────────────────────────────────────────
#  POST /api/frontend/learning/chapter-complete
# ─────────────────────────────────────────────────────────────────────

@learning_progress_bp.route("/frontend/learning/chapter-complete", methods=["POST"])
def frontend_learning_chapter_complete():
    data = request.get_json(silent=True) or {}
    username = _resolve_runtime_user_id()
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    chapter_name = str(data.get("chapter_name") or "").strip()
    chapter_range = str(data.get("chapter_range") or "").strip()
    chapter_context = str(data.get("chapter_context") or "")
    chapter_detail_xml = str(data.get("chapter_detail_xml") or "")

    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    if not valid_identifier(lecture_id) or not valid_identifier(book_id) or not chapter_name:
        return jsonify({"success": False, "error": "lecture_id, book_id and chapter_name are required."}), 400

    lecture = get_learning_lecture(_cfg, lecture_id)
    book = get_lecture_book(_cfg, lecture_id, book_id)
    if not isinstance(lecture, dict) or not isinstance(book, dict):
        return jsonify({"success": False, "error": "lecture or book not found."}), 404
    try:
        chapter = resolve_progress_chapter(_cfg, lecture_id, book_id, data)
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    chapter_range = chapter.range
    book_index = get_book_index(_cfg, lecture_id, book_id)

    with PROGRESS_LOCK:
        existing_records = user_store.list_learning_records(_cfg, username)
        already_completed = any(
            str(r.get("type") or "").strip() == "chapter_completed"
            and str(r.get("lecture_id") or "").strip() == lecture_id
            and str(r.get("book_id") or "").strip() == book_id
            and chapter_for_record(book_index, r) == chapter
            for r in (existing_records or [])
        )
        if already_completed:
            return jsonify({"success": True, "enqueue": None, "already_completed": True})
        user_store.append_learning_record(_cfg, username, {
            "type": "chapter_completed",
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_index": chapter.index,
            "chapter_name": chapter.title,
            "chapter_range": chapter_range,
            "coordinate_space": "plain",
        })

    # 章节完成触发完整画像更新链：记忆分析 → 画像提取 → 画像出题
    job = enqueue_memory_job(
        _cfg,
        user_id=username,
        lecture_id=lecture_id,
        reason="chapter_complete",
        payload={
            "book_id": book_id,
            "chapter_name": chapter_name,
            "chapter_range": chapter_range,
            "chapter_context": chapter_context,
            "chapter_detail_xml": chapter_detail_xml,
        },
    )
    log_event(
        "frontend_chapter_complete",
        "用户完成章节并触发记忆分析+画像提取+画像出题",
        payload={
            "username": username,
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_name": chapter_name,
            "memory_job": dict(job or {}),
        },
    )
    return jsonify({"success": True, "enqueue": job, "already_completed": already_completed})


@learning_progress_bp.route("/frontend/learning/chapter-record/clear", methods=["POST"])
def frontend_learning_chapter_record_clear():
    """清空指定章节阅读记录，不删除已固化的小测验文件。"""
    data = request.get_json(silent=True) or {}
    username = _resolve_runtime_user_id()
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    chapter_name = str(data.get("chapter_name") or "").strip()
    chapter_index = _safe_int(data.get("chapter_index"), -1)

    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    if not valid_identifier(lecture_id) or not valid_identifier(book_id) or not chapter_name:
        return jsonify({"success": False, "error": "lecture_id, book_id and chapter_name are required."}), 400
    if chapter_index < 0:
        return jsonify({"success": False, "error": "chapter_index is required."}), 400

    try:
        chapter = resolve_progress_chapter(_cfg, lecture_id, book_id, data)
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    result = reset_chapter_reading_progress(_cfg, username, lecture_id, book_id, chapter)
    log_event(
        "frontend_chapter_record_clear",
        "用户清空章节阅读记录",
        payload={
            "username": username,
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_name": chapter_name,
            "chapter_index": chapter_index,
            "removed": int(result.get("removed") or 0),
        },
    )
    return jsonify({"success": True, **result})


# ─────────────────────────────────────────────────────────────────────
#  POST /api/frontend/learning/session-complete
# ─────────────────────────────────────────────────────────────────────

@learning_progress_bp.route("/frontend/learning/session-complete", methods=["POST"])
def frontend_learning_session_complete():
    data = request.get_json(silent=True) or {}
    username = _resolve_runtime_user_id()
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    chapter_name = str(data.get("chapter_name") or "").strip()
    chapter_index = _safe_int(data.get("chapter_index"), -1)
    session_name = str(data.get("session_name") or "").strip()
    session_index = _safe_int(data.get("session_index"), -1)
    session_range = str(data.get("session_range") or "").strip()

    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    if not valid_identifier(lecture_id) or not valid_identifier(book_id) or not chapter_name or not session_name:
        return jsonify({"success": False, "error": "lecture_id, book_id, chapter_name and session_name are required."}), 400
    if chapter_index < 0 or session_index < 0:
        return jsonify({"success": False, "error": "chapter_index and session_index are required."}), 400

    lecture = get_learning_lecture(_cfg, lecture_id)
    book = get_lecture_book(_cfg, lecture_id, book_id)
    if not isinstance(lecture, dict) or not isinstance(book, dict):
        return jsonify({"success": False, "error": "lecture or book not found."}), 404
    try:
        chapter = resolve_progress_chapter(_cfg, lecture_id, book_id, data)
        nonnegative_integer(data.get("session_index"), "session_index")
        session = next((item for item in chapter.sessions if item.index == session_index), None)
        if session is None or session.name != session_name:
            raise ValueError("session_index and session_name must identify an existing session.")
        if session_range and session_range not in {session.range, session.stored_range}:
            raise ValueError("session_range no longer matches this session.")
        session_range = session.range
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    with PROGRESS_LOCK:
        existing_records = user_store.list_learning_records(_cfg, username)
        already_completed = any(
            str(r.get("type") or "").strip() == "session_completed"
            and str(r.get("lecture_id") or "").strip() == lecture_id
            and str(r.get("book_id") or "").strip() == book_id
            and _safe_int(r.get("chapter_index"), -1) == chapter_index
            and _safe_int(r.get("session_index"), -1) == session_index
            for r in (existing_records or [])
        )
        if already_completed:
            return jsonify({"success": True, "already_completed": True, "memory_enqueue": None})
        user_store.append_learning_record(
            _cfg,
            username,
            {
                "type": "session_completed",
                "lecture_id": lecture_id,
                "book_id": book_id,
                "chapter_name": chapter_name,
                "chapter_index": chapter_index,
                "session_name": session_name,
                "session_index": session_index,
                "session_range": session_range,
                "coordinate_space": "plain",
            },
        )

    # 小节完成触发记忆分析更新
    memory_job = enqueue_memory_job(
        _cfg,
        user_id=username,
        lecture_id=lecture_id,
        reason="session_complete",
        payload={
            "book_id": book_id,
            "chapter_name": chapter_name,
            "session_name": session_name,
            "session_index": session_index,
        },
    )

    log_event(
        "frontend_session_complete",
        "用户完成小节学习并触发记忆分析",
        payload={
            "username": username,
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_name": chapter_name,
            "chapter_index": chapter_index,
            "session_name": session_name,
            "session_index": session_index,
            "memory_job": dict(memory_job or {}),
        },
    )
    # 阅读会话结束是困惑信号最集中的时刻：异步归因一次（节流、幂等）。
    from core.cognition.triggers import schedule_confusion_scan

    schedule_confusion_scan(_cfg, username, reason="session_complete")
    return jsonify({"success": True, "already_completed": already_completed, "memory_enqueue": memory_job})
