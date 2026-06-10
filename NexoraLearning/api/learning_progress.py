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
from core.lectures import get_book as get_lecture_book, get_lecture as get_learning_lecture
from core.memory.memory_queue import enqueue_memory_job
from core.runlog import log_event
from core.user.learning_progress import (
    build_user_study_hours_map,
    compute_user_lecture_progress,
    init_learning_progress as _init_lp,
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
    """Best-effort username resolution from request context."""
    qs = str(request.args.get("username") or "").strip()
    if qs:
        return qs

    data = request.get_json(silent=True) or {}
    if isinstance(data, dict):
        body_username = str(data.get("username") or data.get("user_id") or "").strip()

        if body_username:
            return body_username

    for header_name in (
        "X-Nexora-Username",
        "X-Username",
        "X-User",
        "X-User-Id",
        "X-Auth-User",
        "X-Forwarded-User",
    ):
        candidate = str(request.headers.get(header_name) or "").strip()
        if candidate:
            return candidate
    # Fallback: use default_username from config or cookie session
    from core.nexora_proxy import NexoraProxy as _NP
    proxy = _cfg.get("__proxy__")
    if proxy is None:
        try:
            proxy = _NP(_cfg)
            _cfg["__proxy__"] = proxy
        except Exception:
            proxy = None
    if proxy is not None:
        return str(getattr(proxy, "default_username", "") or "").strip()
    return ""


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
    if not lecture_id or not book_id or not chapter_name:
        return jsonify({"success": False, "error": "lecture_id, book_id and chapter_name are required."}), 400

    lecture = get_learning_lecture(_cfg, lecture_id)
    book = get_lecture_book(_cfg, lecture_id, book_id)
    if not isinstance(lecture, dict) or not isinstance(book, dict):
        return jsonify({"success": False, "error": "lecture or book not found."}), 404

    existing_records = user_store.list_learning_records(_cfg, username)
    already_completed = any(
        str(r.get("type") or "").strip() == "chapter_completed"
        and str(r.get("lecture_id") or "").strip() == lecture_id
        and str(r.get("book_id") or "").strip() == book_id
        and str(r.get("chapter_name") or "").strip() == chapter_name
        for r in (existing_records or [])
    )

    if already_completed:
        return jsonify({"success": True, "enqueue": None, "already_completed": True})

    user_store.append_learning_record(
        _cfg,
        username,
        {
            "type": "chapter_completed",
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_name": chapter_name,
            "chapter_range": chapter_range,
        },
    )

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
    if not lecture_id or not book_id or not chapter_name:
        return jsonify({"success": False, "error": "lecture_id, book_id and chapter_name are required."}), 400
    if chapter_index < 0:
        return jsonify({"success": False, "error": "chapter_index is required."}), 400

    result = user_store.remove_chapter_learning_records(
        _cfg,
        username,
        lecture_id=lecture_id,
        book_id=book_id,
        chapter_name=chapter_name,
        chapter_index=chapter_index,
    )
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
    if not lecture_id or not book_id or not chapter_name or not session_name:
        return jsonify({"success": False, "error": "lecture_id, book_id, chapter_name and session_name are required."}), 400
    if chapter_index < 0 or session_index < 0:
        return jsonify({"success": False, "error": "chapter_index and session_index are required."}), 400

    lecture = get_learning_lecture(_cfg, lecture_id)
    book = get_lecture_book(_cfg, lecture_id, book_id)
    if not isinstance(lecture, dict) or not isinstance(book, dict):
        return jsonify({"success": False, "error": "lecture or book not found."}), 404

    existing_records = user_store.list_learning_records(_cfg, username)
    already_completed = any(
        str(r.get("type") or "").strip() == "session_completed"
        and str(r.get("lecture_id") or "").strip() == lecture_id
        and str(r.get("book_id") or "").strip() == book_id
        and _safe_int(r.get("chapter_index"), -1) == chapter_index
        and _safe_int(r.get("session_index"), -1) == session_index
        for r in (existing_records or [])
    )

    if not already_completed:
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
    return jsonify({"success": True, "already_completed": already_completed, "memory_enqueue": memory_job})
