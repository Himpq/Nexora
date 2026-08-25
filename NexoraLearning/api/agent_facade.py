"""Small, stable API surface for the Nexora Learning Agent.

The existing frontend API is intentionally broad and mirrors the web UI.  This
blueprint is the narrow contract exposed to an external Agent (for example a
test-state XiaoYi Agent).  It composes existing local learning stores and keeps
Agent-facing responses short and predictable.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Mapping
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlencode

from flask import Blueprint, jsonify, request

from core import user as user_store
from core.booksproc.chapter_quiz import load_or_create_chapter_quiz
from core.lectures import (
    get_book,
    get_lecture,
    list_books,
    list_lectures,
    load_book_info_xml,
    load_book_text,
)
from core.nexora_proxy import NexoraProxy
from core.runlog import log_event
from core.user.learning_progress import (
    compute_user_lecture_progress,
    parse_book_info_xml_chapters,
)


agent_facade_bp = Blueprint("agent_facade", __name__, url_prefix="/api/agent/v1")

_CFG: Dict[str, Any] = {}
_PROXY: Optional[NexoraProxy] = None
_LOCK = threading.RLock()
_TASKS: Dict[str, Dict[str, Any]] = {}
_IDEMPOTENT_RESULTS: Dict[str, Dict[str, Any]] = {}
_MAX_TASKS = 256
_MAX_IDEMPOTENT_RESULTS = 512


def _valid_identifier(value: Any, *, max_length: int = 160) -> bool:
    """Keep external IDs from becoming filesystem paths in the local store."""
    text = str(value or "").strip()
    return bool(text) and len(text) <= max_length and text not in {".", ".."} and "/" not in text and "\\" not in text and "\x00" not in text


def init_agent_facade(cfg: Dict[str, Any]) -> None:
    """Initialize the facade with the same config used by NexoraLearning."""
    global _CFG, _PROXY
    _CFG = cfg
    _PROXY = NexoraProxy(cfg)


def _request_id() -> str:
    supplied = str(request.headers.get("X-Request-ID") or "").strip()
    return supplied[:96] or f"req_{uuid.uuid4().hex[:20]}"


def _response(
    *,
    action: str,
    data: Optional[Dict[str, Any]] = None,
    next_actions: Optional[list[Dict[str, Any]]] = None,
    error: Optional[Dict[str, Any]] = None,
    status: int = 200,
):
    payload = {
        "success": error is None,
        "request_id": _request_id(),
        "action": str(action or "unknown"),
        "data": data if isinstance(data, dict) else {},
        "next_actions": next_actions if isinstance(next_actions, list) else [],
        "error": error,
    }
    return jsonify(payload), status


def _failure(action: str, code: str, message: str, *, status: int = 400, details: Optional[Dict[str, Any]] = None):
    error: Dict[str, Any] = {"code": code, "message": message}
    if isinstance(details, dict) and details:
        error["details"] = details
    return _response(action=action, error=error, status=status)


def _body() -> Dict[str, Any]:
    value = request.get_json(silent=True)
    return dict(value) if isinstance(value, dict) else {}


def _runtime_cfg() -> Dict[str, Any]:
    value = _CFG.get("runtime_api")
    return dict(value) if isinstance(value, dict) else {}


def _auth_error():
    runtime = _runtime_cfg()
    if not bool(runtime.get("enabled", True)):
        return _failure("auth", "API_DISABLED", "Agent API is disabled.", status=404)
    expected = str(runtime.get("api_key") or "").strip()
    if not expected:
        return None
    candidates = [
        str(request.headers.get("X-API-Key") or "").strip(),
        str(request.headers.get("X-NexoraLearning-Key") or "").strip(),
    ]
    authorization = str(request.headers.get("Authorization") or "").strip()
    if authorization.lower().startswith("bearer "):
        candidates.append(authorization[7:].strip())
    if expected not in candidates:
        return _failure("auth", "AUTH_REQUIRED", "A valid Agent API key is required.", status=401)
    return None


def _resolve_username(data: Optional[Mapping[str, Any]] = None) -> str:
    body = data if isinstance(data, Mapping) else {}
    for value in (
        body.get("username"),
        body.get("user_id"),
        request.args.get("username"),
        request.headers.get("X-Nexora-Username"),
        request.headers.get("X-Username"),
        request.headers.get("X-User-Id"),
    ):
        normalized = str(value or "").strip()
        if normalized:
            return normalized
    return ""


def _require_user(data: Optional[Mapping[str, Any]], action: str) -> Tuple[str, Optional[Any]]:
    username = _resolve_username(data)
    if not username:
        return "", _failure(action, "AUTH_REQUIRED", "username is required.", status=400)
    if not _valid_identifier(username, max_length=128):
        return "", _failure(action, "INVALID_ARGUMENT", "username is invalid.", status=400)
    user_store.ensure_user_files(_CFG, username)
    return username, None


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return int(default)


def _selected_lecture_ids(username: str) -> set[str]:
    return set(str(item).strip() for item in user_store.list_selected_lecture_ids(_CFG, username) if str(item).strip())


def _lecture_snapshot(username: str, lecture: Mapping[str, Any], records: list[Dict[str, Any]]) -> Dict[str, Any]:
    lecture_id = str(lecture.get("id") or "").strip()
    books = list_books(_CFG, lecture_id)
    progress = compute_user_lecture_progress(username, lecture_id, books, records=records)
    return {
        "id": lecture_id,
        "title": str(lecture.get("title") or lecture_id).strip(),
        "description": str(lecture.get("description") or "").strip(),
        "category": str(lecture.get("category") or "").strip(),
        "status": str(lecture.get("status") or "").strip(),
        "progress_percent": max(0, min(100, _safe_int(progress.get("progress"), 0))),
        "current_chapter": str(progress.get("current_chapter") or "").strip(),
        "next_chapter": str(progress.get("next_chapter") or "").strip(),
        "books": [
            {
                "id": str(book.get("id") or "").strip(),
                "title": str(book.get("title") or book.get("id") or "").strip(),
                "description": str(book.get("description") or "").strip(),
                "text_status": str(book.get("text_status") or "").strip(),
                "refinement_status": str(book.get("refinement_status") or "").strip(),
                "text_chars": _safe_int(book.get("text_chars"), 0),
            }
            for book in books
            if isinstance(book, Mapping)
        ],
    }


def _context(username: str, requested_lecture_id: str = "") -> Dict[str, Any]:
    records = user_store.list_learning_records(_CFG, username) or []
    selected_ids = _selected_lecture_ids(username)
    lectures = [row for row in list_lectures(_CFG) if isinstance(row, Mapping)]
    if requested_lecture_id:
        lectures = [row for row in lectures if str(row.get("id") or "").strip() == requested_lecture_id]
    elif selected_ids:
        lectures = [row for row in lectures if str(row.get("id") or "").strip() in selected_ids]
    snapshots = [_lecture_snapshot(username, row, records) for row in lectures]
    recent = [dict(row) for row in records[-8:] if isinstance(row, Mapping)]
    user = user_store.get_user(_CFG, username) or {"id": username, "username": username}
    active = recent[-1] if recent else {}
    return {
        "user": {
            "id": str(user.get("id") or username).strip(),
            "username": str(user.get("username") or username).strip(),
            "display_name": str(user.get("display_name") or "").strip(),
            "role": str(user.get("role") or "member").strip(),
        },
        "lectures": snapshots,
        "selected_lecture_ids": sorted(selected_ids),
        "recent_learning_records": recent,
        "active_record": active,
        "active_session": _active_session(records),
        "generated_at": int(time.time()),
    }


def _active_session(records: list[Dict[str, Any]]) -> Dict[str, Any]:
    """Return the latest persisted Agent session that has not been closed.

    Session state is represented as append-only learning records. This keeps
    resume behavior available after a process restart without introducing a
    second persistence store.
    """
    opened: Dict[str, Dict[str, Any]] = {}
    closed: set[str] = set()
    close_events = {
        "session_completed",
        "session_closed",
        "learning_session_completed",
    }
    for row in records:
        if not isinstance(row, Mapping):
            continue
        session_id = str(row.get("session_id") or "").strip()
        if not session_id:
            continue
        record_type = str(row.get("type") or "").strip()
        event_name = str(row.get("event") or "").strip().lower()
        if record_type == "agent_session_opened":
            opened[session_id] = dict(row)
        elif record_type == "agent_session_closed" or (record_type == "agent_event" and event_name in close_events):
            closed.add(session_id)

    for row in reversed(records):
        if not isinstance(row, Mapping):
            continue
        session_id = str(row.get("session_id") or "").strip()
        if session_id in opened and session_id not in closed:
            session = dict(opened[session_id])
            session.pop("type", None)
            session["status"] = "open"
            return session
    return {}


def _chapters(lecture_id: str, book_id: str) -> list[Dict[str, Any]]:
    xml = str(load_book_info_xml(_CFG, lecture_id, book_id) or "")
    text = str(load_book_text(_CFG, lecture_id, book_id) or "")
    rows = parse_book_info_xml_chapters(xml, len(text))
    for index, row in enumerate(rows):
        row["chapter_index"] = index
        row["book_id"] = book_id
    return rows


def _resolve_session_target(username: str, data: Mapping[str, Any], context: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    requested_lecture = str(data.get("lecture_id") or "").strip()
    requested_book = str(data.get("book_id") or "").strip()
    requested_chapter = _safe_int(data.get("chapter_index"), -1)
    lectures = context.get("lectures") if isinstance(context.get("lectures"), list) else []
    lecture = next((row for row in lectures if str(row.get("id") or "") == requested_lecture), None) if requested_lecture else (lectures[0] if lectures else None)
    if not isinstance(lecture, Mapping):
        return None, "No selected lecture is available for this user."
    lecture_id = str(lecture.get("id") or "").strip()
    books = lecture.get("books") if isinstance(lecture.get("books"), list) else []
    book = next((row for row in books if str(row.get("id") or "") == requested_book), None) if requested_book else (books[0] if books else None)
    if not isinstance(book, Mapping):
        return None, "No textbook is available for the selected lecture."
    book_id = str(book.get("id") or "").strip()
    chapters = _chapters(lecture_id, book_id)
    if requested_chapter >= 0 and requested_chapter < len(chapters):
        chapter = chapters[requested_chapter]
    else:
        current_name = str(lecture.get("current_chapter") or "").strip()
        chapter = next((row for row in chapters if str(row.get("title") or "") == current_name), None)
        chapter = chapter or (chapters[0] if chapters else {"chapter_index": 0, "title": str(book.get("title") or "教材"), "range": ""})
    return {
        "lecture_id": lecture_id,
        "lecture_title": str(lecture.get("title") or lecture_id).strip(),
        "book_id": book_id,
        "book_title": str(book.get("title") or book_id).strip(),
        "chapter_index": _safe_int(chapter.get("chapter_index"), 0),
        "chapter_name": str(chapter.get("title") or "").strip(),
        "chapter_range": str(chapter.get("range") or "").strip(),
    }, None


def _frontend_entry_url(target: Mapping[str, Any], username: str) -> str:
    host = str(request.headers.get("X-Forwarded-Host") or request.host or "").split(",")[0].strip()
    proto = str(request.headers.get("X-Forwarded-Proto") or request.scheme or "http").split(",")[0].strip()
    base = f"{proto}://{host}/api/frontend/" if host else "/api/frontend/"
    params = urlencode({
        "source": "agent",
        "username": username,
        "lecture_id": str(target.get("lecture_id") or ""),
        "book_id": str(target.get("book_id") or ""),
        "chapter_index": str(target.get("chapter_index") or 0),
    })
    return f"{base}?{params}"


def _idempotent(key: str) -> Optional[Dict[str, Any]]:
    if not key:
        return None
    with _LOCK:
        return _IDEMPOTENT_RESULTS.get(key)


def _remember_idempotent(key: str, payload: Dict[str, Any]) -> None:
    if not key:
        return
    with _LOCK:
        _IDEMPOTENT_RESULTS[key] = payload
        while len(_IDEMPOTENT_RESULTS) > _MAX_IDEMPOTENT_RESULTS:
            _IDEMPOTENT_RESULTS.pop(next(iter(_IDEMPOTENT_RESULTS)))


def _task_snapshot(task: Mapping[str, Any]) -> Dict[str, Any]:
    return {key: value for key, value in dict(task).items() if key not in {"internal"}}


def _start_review_task(username: str, target: Dict[str, Any], limit: int) -> Dict[str, Any]:
    task_id = f"task_{uuid.uuid4().hex[:20]}"
    task: Dict[str, Any] = {
        "task_id": task_id,
        "type": "review_plan",
        "status": "queued",
        "user_id": username,
        "lecture_id": target["lecture_id"],
        "book_id": target["book_id"],
        "chapter_index": target["chapter_index"],
        "created_at": int(time.time()),
        "updated_at": int(time.time()),
    }
    with _LOCK:
        _TASKS[task_id] = task
        while len(_TASKS) > _MAX_TASKS:
            _TASKS.pop(next(iter(_TASKS)))

    def run() -> None:
        with _LOCK:
            task["status"] = "running"
            task["updated_at"] = int(time.time())
        try:
            quiz = load_or_create_chapter_quiz(
                _CFG,
                user_id=username,
                lecture_id=target["lecture_id"],
                book_id=target["book_id"],
                chapter_index=target["chapter_index"],
                chapter_name=target["chapter_name"],
                chapter_range=target["chapter_range"],
                limit=max(1, min(10, limit)),
            )
            with _LOCK:
                task["status"] = "completed"
                task["result"] = {
                    "quiz_id": str(quiz.get("quiz_id") or ""),
                    "lecture_id": target["lecture_id"],
                    "book_id": target["book_id"],
                    "chapter_index": target["chapter_index"],
                    "chapter_name": target["chapter_name"],
                    "questions": quiz.get("questions") if isinstance(quiz.get("questions"), list) else [],
                }
                task["updated_at"] = int(time.time())
        except Exception as exc:
            with _LOCK:
                task["status"] = "failed"
                task["error"] = {"code": "TASK_FAILED", "message": str(exc)}
                task["updated_at"] = int(time.time())
            log_event("agent_review_plan_failed", "Agent review plan task failed.", payload={"user_id": username, "task_id": task_id, "error": str(exc)})

    threading.Thread(target=run, name=f"agent-review-{task_id}", daemon=True).start()
    return _task_snapshot(task)


@agent_facade_bp.route("/context", methods=["GET"])
def agent_context():
    action = "context"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    username, error = _require_user(None, action)
    if error is not None:
        return error
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    return _response(action=action, data=_context(username, lecture_id))


@agent_facade_bp.route("/plan", methods=["POST"])
def agent_plan():
    action = "plan"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    context = _context(username, str(data.get("lecture_id") or "").strip())
    lectures = context.get("lectures") if isinstance(context.get("lectures"), list) else []
    if not lectures:
        return _response(action=action, data={"status": "needs_course", "message": "请先选择一门课程。"}, next_actions=[{"type": "select_course", "required": True}])
    target, target_error = _resolve_session_target(username, data, context)
    if target_error or target is None:
        return _failure(action, "COURSE_NOT_FOUND", target_error or "No learning target is available.", status=404)
    available_minutes = max(5, min(240, _safe_int(data.get("available_minutes"), 30)))
    intent = str(data.get("intent") or "continue_learning").strip() or "continue_learning"
    plan = {
        "status": "ready",
        "intent": intent,
        "available_minutes": available_minutes,
        "reason": "根据当前课程进度选择尚未完成的下一章节。",
        "target": target,
        "estimated_minutes": min(available_minutes, 25),
    }
    return _response(action=action, data={"plan": plan}, next_actions=[{"type": "open_session", "target": target}])


@agent_facade_bp.route("/open-session", methods=["POST"])
def agent_open_session():
    action = "open_session"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    context = _context(username, str(data.get("lecture_id") or "").strip())
    target, target_error = _resolve_session_target(username, data, context)
    if target_error or target is None:
        return _failure(action, "COURSE_NOT_FOUND", target_error or "No learning target is available.", status=404)
    session_id = f"session_{uuid.uuid4().hex[:20]}"
    data_out = {
        "session_id": session_id,
        "target": target,
        "entry_url": _frontend_entry_url(target, username),
        "entry_type": "nexoralearning_web",
        "resume": True,
        "created_at": int(time.time()),
    }
    user_store.append_learning_record(
        _CFG,
        username,
        {
            "type": "agent_session_opened",
            "session_id": session_id,
            "lecture_id": target["lecture_id"],
            "book_id": target["book_id"],
            "chapter_index": target["chapter_index"],
            "chapter_name": target["chapter_name"],
            "chapter_range": target["chapter_range"],
            "source": "agent",
            "status": "open",
        },
    )
    log_event("agent_open_session", "Agent opened a learning session.", payload={"user_id": username, "session_id": session_id, **target})
    return _response(action=action, data=data_out, next_actions=[{"type": "ask_in_context", "session_id": session_id}])


@agent_facade_bp.route("/ask-in-context", methods=["POST"])
def agent_ask_in_context():
    action = "ask_in_context"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    question = str(data.get("question") or data.get("message") or "").strip()
    if not question:
        return _failure(action, "INVALID_ARGUMENT", "question is required.")
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    context_text = str(data.get("context_text") or data.get("selected_text") or "").strip()
    if lecture_id and book_id:
        if not _valid_identifier(lecture_id) or not _valid_identifier(book_id):
            return _failure(action, "INVALID_ARGUMENT", "lecture_id or book_id is invalid.")
        if get_lecture(_CFG, lecture_id) is None or get_book(_CFG, lecture_id, book_id) is None:
            return _failure(action, "COURSE_NOT_FOUND", "lecture or book not found.", status=404)
        if not context_text:
            context_text = str(load_book_text(_CFG, lecture_id, book_id) or "")[:12000]
        chapter_index = _safe_int(data.get("chapter_index"), -1)
        if chapter_index >= 0:
            chapters = _chapters(lecture_id, book_id)
            if chapter_index < len(chapters):
                row = chapters[chapter_index]
                context_text = str(load_book_text(_CFG, lecture_id, book_id) or "")[int(row.get("start") or 0):int(row.get("end") or 0)][:12000]
    if not context_text:
        context_text = "当前没有可用的教材上下文。"
    if _PROXY is None:
        return _failure(action, "MODEL_UNAVAILABLE", "Nexora model proxy is not initialized.", status=503)
    model_cfg = _CFG.get("models") if isinstance(_CFG.get("models"), dict) else {}
    intensive = model_cfg.get("intensive_reading") if isinstance(model_cfg.get("intensive_reading"), dict) else {}
    model = str(intensive.get("model_name") or model_cfg.get("default_nexora_model") or "").strip() or None
    prompt = (
        "你是 Nexora Learning 的教材辅导助手。只依据给定教材上下文回答，若上下文不足请明确说明。"
        "回答简洁、适合学生继续学习，不要编造教材中不存在的事实。\n\n"
        f"教材上下文：\n{context_text[:12000]}\n\n学生问题：{question}"
    )
    result = _PROXY.complete_raw(
        messages=[{"role": "user", "content": prompt}],
        model=model,
        username=username,
        api_mode="chat",
        options={"temperature": 0.2, "max_tokens": 1200},
        request_timeout=30,
    )
    if not result.get("success"):
        return _failure(action, "MODEL_UNAVAILABLE", str(result.get("message") or "model request failed"), status=503)
    answer = _PROXY.extract_output_text(result.get("payload") if isinstance(result.get("payload"), dict) else {})
    if not answer:
        return _failure(action, "MODEL_EMPTY", "model returned an empty answer.", status=502)
    return _response(action=action, data={"answer": answer, "source": "textbook_context", "lecture_id": lecture_id, "book_id": book_id, "context_chars": len(context_text)})


@agent_facade_bp.route("/review-plan", methods=["POST"])
def agent_review_plan():
    action = "review_plan"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    context = _context(username, str(data.get("lecture_id") or "").strip())
    target, target_error = _resolve_session_target(username, data, context)
    if target_error or target is None:
        return _failure(action, "COURSE_NOT_FOUND", target_error or "No learning target is available.", status=404)
    key = str(request.headers.get("Idempotency-Key") or data.get("idempotency_key") or "").strip()
    cache_key = f"{username}:review-plan:{key}" if key else ""
    cached = _idempotent(cache_key)
    if cached is not None:
        return jsonify(cached)
    task = _start_review_task(username, target, _safe_int(data.get("limit"), 3))
    response_payload = _response(action=action, data={"task": task}, next_actions=[{"type": "poll_task", "task_id": task["task_id"]}])[0].get_json()
    if isinstance(response_payload, dict):
        _remember_idempotent(cache_key, response_payload)
    return jsonify(response_payload)


@agent_facade_bp.route("/tasks/<task_id>", methods=["GET"])
def agent_task(task_id: str):
    action = "task"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    username, error = _require_user(None, action)
    if error is not None:
        return error
    with _LOCK:
        task = _TASKS.get(str(task_id or "").strip())
    if task is None:
        return _failure(action, "TASK_NOT_FOUND", "task not found.", status=404)
    if username != str(task.get("user_id") or ""):
        return _failure(action, "PERMISSION_DENIED", "task belongs to another user.", status=403)
    return _response(action=action, data={"task": _task_snapshot(task)})


@agent_facade_bp.route("/events", methods=["POST"])
def agent_event():
    action = "event"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    event_name = str(data.get("event") or data.get("event_name") or "").strip()
    if not event_name:
        return _failure(action, "INVALID_ARGUMENT", "event is required.")
    event_id = str(data.get("event_id") or request.headers.get("Idempotency-Key") or uuid.uuid4().hex).strip()
    record = {
        "type": "agent_event",
        "event_id": event_id,
        "event": event_name,
        "lecture_id": str(data.get("lecture_id") or "").strip(),
        "book_id": str(data.get("book_id") or "").strip(),
        "chapter_index": _safe_int(data.get("chapter_index"), -1),
        "session_id": str(data.get("session_id") or "").strip(),
        "source": str(data.get("source") or "xiaoyi").strip() or "xiaoyi",
        "created_at": int(time.time()),
    }
    existing = user_store.list_learning_records(_CFG, username) or []
    duplicate = any(str(row.get("type") or "") == "agent_event" and str(row.get("event_id") or "") == event_id for row in existing if isinstance(row, Mapping))
    if not duplicate:
        user_store.append_learning_record(_CFG, username, record)
    log_event("agent_event", "Agent learning event recorded.", payload={"user_id": username, "event": event_name, "event_id": event_id, "duplicate": duplicate})
    return _response(action=action, data={"accepted": True, "duplicate": duplicate, "event_id": event_id})
