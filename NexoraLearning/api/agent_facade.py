"""Small, stable API surface for the Nexora Learning Agent.

The existing frontend API is intentionally broad and mirrors the web UI.  This
blueprint is the narrow contract exposed to an external Agent (for example a
test-state XiaoYi Agent).  It composes existing local learning stores and keeps
Agent-facing responses short and predictable.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlencode

from flask import Blueprint, jsonify, request

from core import user as user_store
from core.booksproc.chapter_quiz import grade_question, load_or_create_chapter_quiz, load_quiz_by_id
from core.decision import DIALOG_RECORD_TYPE, build_context_bundle, mark_decision_response, rebut
from core.decision import evaluate as evaluate_decision
from core.lectures import (
    get_book,
    get_lecture,
    list_books,
    list_lectures,
)
from core.nexora_proxy import NexoraProxy
from core.runlog import log_event
from core.user.learning_progress import compute_user_lecture_progress


agent_facade_bp = Blueprint("agent_facade", __name__, url_prefix="/api/agent/v1")

_CFG: Dict[str, Any] = {}
_PROXY: Optional[NexoraProxy] = None
_LOCK = threading.RLock()
_TASKS: Dict[str, Dict[str, Any]] = {}
_IDEMPOTENT_RESULTS: Dict[str, Dict[str, Any]] = {}
_MAX_TASKS = 256
_MAX_IDEMPOTENT_RESULTS = 512
_SESSION_CLOSE_EVENTS = frozenset({
    "session_completed",
    "session_closed",
    "learning_session_completed",
})


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
    lectures = [
        row
        for row in list_lectures(_CFG)
        if isinstance(row, Mapping)
        and str(row.get("id") or "").strip() in selected_ids
    ]
    if requested_lecture_id:
        lectures = [row for row in lectures if str(row.get("id") or "").strip() == requested_lecture_id]
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
        elif record_type == "agent_session_closed" or (record_type == "agent_event" and event_name in _SESSION_CLOSE_EVENTS):
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


def _record_timestamp(value: Mapping[str, Any]) -> int:
    """Return a learning record timestamp in seconds, accepting ms telemetry."""
    raw = value.get("timestamp") or value.get("created_at") or value.get("ts") or 0
    try:
        timestamp = float(raw)
    except (TypeError, ValueError):
        return 0
    if timestamp > 10_000_000_000:
        timestamp /= 1000
    return max(0, int(timestamp))


def _today_start_timestamp(now: Optional[int] = None) -> int:
    current = int(now or time.time())
    local = time.localtime(current)
    midnight = (
        local.tm_year,
        local.tm_mon,
        local.tm_mday,
        0,
        0,
        0,
        local.tm_wday,
        local.tm_yday,
        local.tm_isdst,
    )
    return int(time.mktime(midnight))


def _record_duration_seconds(record: Mapping[str, Any]) -> float:
    for key, multiplier in (("study_seconds", 1), ("study_minutes", 60), ("study_hours", 3600)):
        value = record.get(key)
        if value is not None:
            try:
                return max(0.0, float(value) * multiplier)
            except (TypeError, ValueError):
                return 0.0
    if str(record.get("type") or "").strip() in {"study_time", "study_session", "learning_time"}:
        try:
            return max(0.0, float(record.get("duration") or 0))
        except (TypeError, ValueError):
            return 0.0
    return 0.0


def _today_data(
    records: list[Dict[str, Any]],
    question_records: list[Dict[str, Any]],
    now: Optional[int] = None,
) -> Dict[str, Any]:
    current = int(now or time.time())
    start = _today_start_timestamp(current)
    learning_today = [
        row for row in records
        if isinstance(row, Mapping) and _record_timestamp(row) >= start
    ]
    questions_today = [
        row for row in question_records
        if isinstance(row, Mapping) and _record_timestamp(row) >= start
    ]
    completed_session_count = sum(
        1
        for row in learning_today
        if str(row.get("type") or "").strip() == "session_completed"
        or (
            str(row.get("type") or "").strip() == "agent_event"
            and str(row.get("event") or "").strip().lower() in _SESSION_CLOSE_EVENTS
        )
    )
    completed_chapter_keys = {
        (
            str(row.get("lecture_id") or "").strip(),
            str(row.get("book_id") or "").strip(),
            str(
                row.get("chapter_index")
                if row.get("chapter_index") is not None
                else row.get("chapter_name") or ""
            ).strip(),
        )
        for row in learning_today
        if str(row.get("type") or "").strip() == "chapter_completed"
    }
    correct_count = sum(1 for row in questions_today if row.get("is_correct") is True)
    reviewed_count = sum(1 for row in questions_today if isinstance(row.get("is_correct"), bool))
    return {
        "date": time.strftime("%Y-%m-%d", time.localtime(current)),
        "study_minutes": round(sum(_record_duration_seconds(row) for row in learning_today) / 60, 1),
        "completed_sessions": completed_session_count,
        "completed_chapters": len(completed_chapter_keys),
        "submitted_questions": len(questions_today),
        "correct_questions": correct_count,
        "accuracy": round(correct_count / reviewed_count, 3) if reviewed_count else None,
    }


def _today_target(
    username: str,
    context: Dict[str, Any],
    active_session: Mapping[str, Any],
    requested_lecture_id: str = "",
) -> Tuple[Optional[Dict[str, Any]], Optional[Tuple[str, str, int]]]:
    """Resolve an active session first, then the normal next learning target."""
    if active_session and not requested_lecture_id:
        active_lecture_id = str(active_session.get("lecture_id") or "").strip()
        active_book_id = str(active_session.get("book_id") or "").strip()
        context_lecture_ids = {
            str(row.get("id") or "").strip()
            for row in context.get("lectures", [])
            if isinstance(row, Mapping)
        }
        if active_lecture_id and active_book_id and active_lecture_id in context_lecture_ids:
            return _resolve_session_target(
                username,
                {
                    "lecture_id": active_lecture_id,
                    "book_id": active_book_id,
                    "chapter_index": active_session.get("chapter_index", 0),
                },
                context,
            )
    return _resolve_session_target(
        username,
        {"lecture_id": requested_lecture_id} if requested_lecture_id else {},
        context,
    )


def _chapters(lecture_id: str, book_id: str) -> list[Dict[str, Any]]:
    """Chapters in reader coordinates.

    The agent hands ``chapter_index`` to the reader through a deep link, so both
    sides must resolve it against the same validated index — parsing
    bookinfo.xml separately here would drift as soon as the validator drops,
    merges or inserts a chapter.
    """
    from core.bookindex import get_book_index

    index = get_book_index(_CFG, lecture_id, book_id)
    rows: list[Dict[str, Any]] = []
    for chapter in index.chapters:
        rows.append(
            {
                "chapter_index": chapter.index,
                "book_id": book_id,
                "title": chapter.title,
                "start": chapter.start,
                "end": chapter.end,
                "range": chapter.range,
            }
        )
    return rows


def _chapter_context_text(lecture_id: str, book_id: str, chapter_index: int, limit: int = 12000) -> str:
    """Return canonical reader text for a previously validated chapter."""
    from core.bookindex import get_book_index

    index = get_book_index(_CFG, lecture_id, book_id)
    chapter = index.chapter_at(chapter_index)
    if chapter is None:
        return ""
    return index.chapter_text(chapter.index)[:limit]


def _chapter_number_from_question(question: str) -> Optional[int]:
    """Extract a Chinese/Arabic chapter reference from a natural-language question."""
    import re

    match = re.search(r"第\s*([0-9一二三四五六七八九十百零两]+)\s*章", question or "")
    if match is None:
        return None
    raw = match.group(1)
    if raw.isdigit():
        value = int(raw)
    else:
        digits = {"零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
        if raw == "十":
            value = 10
        elif "十" in raw:
            left, _, right = raw.partition("十")
            value = (digits.get(left, 1) * 10) + (digits.get(right, 0) if right else 0)
        elif "百" in raw:
            left, _, right = raw.partition("百")
            value = digits.get(left, 1) * 100 + (digits.get(right, 0) if right else 0)
        else:
            value = digits.get(raw, -1)
    return value - 1 if value > 0 else None


def _looks_like_context_refusal(answer: str) -> bool:
    """Recognize a model refusal caused only by missing textbook detail."""
    text = str(answer or "").strip()
    return any(marker in text for marker in (
        "无法依据上下文回答",
        "无法回答",
        "信息不足",
        "未提供具体",
        "没有提供具体",
        "请问您具体想了解",
    ))


def _offline_learning_answer(question: str) -> str:
    """Small deterministic fallback for local/offline demos when no model is configured."""
    if "傅里叶变换" in question:
        return "傅里叶变换把一个信号分解为不同频率的正弦波（或复指数）叠加，从而把时域问题转换到频域分析。"
    if "卷积" in question and ("是什么" in question or "概念" in question or "解释" in question):
        return "卷积描述一个函数沿另一个函数滑动时的加权累积，是信号处理和神经网络中提取局部模式的基础运算。"
    if "梯度下降" in question:
        return "梯度下降沿损失函数梯度相反的方向迭代更新参数，使模型逐步接近误差更小的解。"
    return ""


def _resolve_session_target(
    username: str,
    data: Mapping[str, Any],
    context: Dict[str, Any],
) -> Tuple[Optional[Dict[str, Any]], Optional[Tuple[str, str, int]]]:
    requested_lecture = str(data.get("lecture_id") or "").strip()
    requested_book = str(data.get("book_id") or "").strip()
    lectures = context.get("lectures") if isinstance(context.get("lectures"), list) else []
    lecture = next((row for row in lectures if str(row.get("id") or "") == requested_lecture), None) if requested_lecture else (lectures[0] if lectures else None)
    if not isinstance(lecture, Mapping):
        return None, ("COURSE_NOT_FOUND", "No selected lecture is available for this user.", 404)
    lecture_id = str(lecture.get("id") or "").strip()
    books = lecture.get("books") if isinstance(lecture.get("books"), list) else []
    book = next((row for row in books if str(row.get("id") or "") == requested_book), None) if requested_book else (books[0] if books else None)
    if not isinstance(book, Mapping):
        return None, ("COURSE_NOT_FOUND", "No textbook is available for the selected lecture.", 404)
    book_id = str(book.get("id") or "").strip()
    chapters = _chapters(lecture_id, book_id)
    if "chapter_index" in data:
        from core.bookindex import resolve_chapter

        _, resolved_chapter, chapter_error = resolve_chapter(
            _CFG, lecture_id, book_id, data.get("chapter_index")
        )
        if chapter_error or resolved_chapter is None:
            return None, ("INVALID_ARGUMENT", "chapter_index is invalid or out of range.", 400)
        chapter = next(
            (row for row in chapters if int(row.get("chapter_index") or 0) == resolved_chapter.index),
            None,
        )
        if chapter is None:
            return None, ("INVALID_ARGUMENT", "chapter_index is invalid or out of range.", 400)
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
    public_base = str(_CFG.get("public_base_url") or "").strip().rstrip("/")
    if public_base:
        base = f"{public_base}/api/frontend/"
    else:
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


def _task_path(task_id: str) -> Optional[Path]:
    normalized = str(task_id or "").strip()
    if not _valid_identifier(normalized) or not normalized.startswith("task_"):
        return None
    return Path(str(_CFG.get("data_dir") or "data")) / "agent_tasks" / f"{normalized}.json"


def _persist_task_locked(task: Mapping[str, Any]) -> None:
    snapshot = _task_snapshot(task)
    path = _task_path(str(snapshot.get("task_id") or ""))
    if path is None:
        raise ValueError("Invalid Agent task id.")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary.replace(path)


def _save_task(task: Dict[str, Any]) -> None:
    with _LOCK:
        task_id = str(task.get("task_id") or "")
        _TASKS[task_id] = task
        _persist_task_locked(task)
        while len(_TASKS) > _MAX_TASKS:
            _TASKS.pop(next(iter(_TASKS)))


def _load_task(task_id: str) -> Optional[Dict[str, Any]]:
    path = _task_path(task_id)
    if path is None or not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    if not isinstance(value, dict) or str(value.get("task_id") or "") != str(task_id):
        return None
    with _LOCK:
        _TASKS[str(task_id)] = value
    return value


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
    _save_task(task)

    def run() -> None:
        with _LOCK:
            task["status"] = "running"
            task["updated_at"] = int(time.time())
            _persist_task_locked(task)
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
                _persist_task_locked(task)
        except Exception as exc:
            with _LOCK:
                task["status"] = "failed"
                task["error"] = {"code": "TASK_FAILED", "message": str(exc)}
                task["updated_at"] = int(time.time())
                _persist_task_locked(task)
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


@agent_facade_bp.route("/today", methods=["GET"])
def agent_today():
    """Return a compact, model-free daily brief for proactive Agent prompts."""
    action = "today"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    username, error = _require_user(None, action)
    if error is not None:
        return error

    requested_lecture_id = str(request.args.get("lecture_id") or "").strip()
    context = _context(username, requested_lecture_id)
    lectures = context.get("lectures") if isinstance(context.get("lectures"), list) else []
    if requested_lecture_id and not lectures:
        return _failure(action, "COURSE_NOT_FOUND", "Requested lecture is not selected by this user.", status=404)

    records = user_store.list_learning_records(_CFG, username) or []
    question_records = user_store.list_question_completions(_CFG, username) or []
    active_session = _active_session(records)
    today = _today_data(records, question_records)
    if not lectures:
        return _response(
            action=action,
            data={"status": "needs_course", "today": today, "active_session": active_session},
            next_actions=[{"type": "select_course", "required": True}],
        )

    target, target_error = _today_target(username, context, active_session, requested_lecture_id)
    if target_error or target is None:
        code, message, status = target_error or ("COURSE_NOT_FOUND", "No learning target is available.", 404)
        return _failure(action, code, message, status=status)

    resumes_active_session = bool(
        active_session
        and str(active_session.get("lecture_id") or "").strip() == str(target.get("lecture_id") or "").strip()
        and str(active_session.get("book_id") or "").strip() == str(target.get("book_id") or "").strip()
        and _safe_int(active_session.get("chapter_index"), -1) == _safe_int(target.get("chapter_index"), -2)
    )
    status = "resume" if resumes_active_session else "ready"
    next_action_type = "resume_session" if resumes_active_session else "open_session"
    return _response(
        action=action,
        data={
            "status": status,
            "today": today,
            "focus": target,
            "active_session": active_session,
            "lectures": [
                {
                    "id": row.get("id"),
                    "title": row.get("title"),
                    "progress_percent": row.get("progress_percent"),
                    "current_chapter": row.get("current_chapter"),
                    "next_chapter": row.get("next_chapter"),
                }
                for row in lectures
                if isinstance(row, Mapping)
            ],
        },
        next_actions=[{"type": next_action_type, "target": target}],
    )


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
        if str(data.get("lecture_id") or "").strip():
            return _failure(
                action,
                "COURSE_NOT_FOUND",
                "Requested lecture is not selected by this user.",
                status=404,
            )
        return _response(action=action, data={"status": "needs_course", "message": "请先选择一门课程。"}, next_actions=[{"type": "select_course", "required": True}])
    target, target_error = _resolve_session_target(username, data, context)
    if target_error or target is None:
        code, message, status = target_error or ("COURSE_NOT_FOUND", "No learning target is available.", 404)
        return _failure(action, code, message, status=status)
    available_minutes = max(5, min(240, _safe_int(data.get("available_minutes"), 30)))
    intent = str(data.get("intent") or "continue_learning").strip() or "continue_learning"
    timestamp = int(time.time())
    user_store.append_learning_record(_CFG, username, {
        "type": "agent_user_msg",
        "message_id": f"usr_{uuid.uuid4().hex[:20]}",
        "text": intent,
        "timestamp": timestamp,
        "source": "app",
    })
    plan = {
        "status": "ready",
        "intent": intent,
        "available_minutes": available_minutes,
        "reason": "根据当前课程进度选择尚未完成的下一章节。",
        "target": target,
        "estimated_minutes": min(available_minutes, 25),
    }
    user_store.append_learning_record(_CFG, username, {
        "type": "agent_plan_response",
        "message_id": f"plan_{uuid.uuid4().hex[:20]}",
        "text": plan["reason"],
        "reason": plan["reason"],
        "target": target,
        "estimated_minutes": plan["estimated_minutes"],
        "timestamp": timestamp,
    })
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
        code, message, status = target_error or ("COURSE_NOT_FOUND", "No learning target is available.", 404)
        return _failure(action, code, message, status=status)
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
    # 入口来源（app / xiaoyi / a2a / photo）与拍照文本：进入对话留痕，成为下一次裁决的上下文。
    source = str(data.get("source") or "app").strip()[:16] or "app"
    photo_text = str(data.get("photo_text") or data.get("image_text") or "").strip()[:4000]
    if photo_text and source == "app":
        source = "photo"
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    context_text = str(data.get("context_text") or data.get("selected_text") or "").strip()
    requested_chapter = data.get("chapter_index")
    if requested_chapter is None:
        requested_chapter = _chapter_number_from_question(question)
    if lecture_id and book_id:
        if not _valid_identifier(lecture_id) or not _valid_identifier(book_id):
            return _failure(action, "INVALID_ARGUMENT", "lecture_id or book_id is invalid.")
        if lecture_id not in _selected_lecture_ids(username):
            return _failure(
                action,
                "PERMISSION_DENIED",
                "lecture is not selected by this user.",
                status=403,
            )
        if get_lecture(_CFG, lecture_id) is None or get_book(_CFG, lecture_id, book_id) is None:
            return _failure(action, "COURSE_NOT_FOUND", "lecture or book not found.", status=404)
        from core.bookindex import get_book_index, resolve_chapter

        if requested_chapter is not None:
            _, chapter, chapter_error = resolve_chapter(
                _CFG, lecture_id, book_id, requested_chapter
            )
            if chapter_error or chapter is None:
                return _failure(
                    action,
                    "INVALID_ARGUMENT",
                    "chapter_index is invalid or out of range.",
                    status=400,
                )
            context_text = _chapter_context_text(lecture_id, book_id, chapter.index)
        elif not context_text:
            context_text = get_book_index(_CFG, lecture_id, book_id).plain[:12000]
    if not context_text:
        context_text = "当前没有可用的教材上下文。"
    if photo_text:
        context_text = f"学生拍下的教材/题目内容：\n{photo_text}\n\n{context_text}"
    timestamp = int(time.time())
    # 先写用户消息，再调用模型；网络/模型失败也不能丢失用户的输入。
    user_store.append_learning_record(_CFG, username, {
        "type": "agent_user_msg",
        "message_id": f"usr_{uuid.uuid4().hex[:20]}",
        "text": question[:400],
        "timestamp": timestamp,
        "source": source,
        "lecture_id": lecture_id,
        "book_id": book_id,
    })
    answer_source = "textbook_context"
    if _PROXY is None:
        answer = _offline_learning_answer(question)
        if not answer:
            return _failure(action, "MODEL_UNAVAILABLE", "Nexora model proxy is not initialized.", status=503)
        answer_source = "general_knowledge_fallback"
    else:
        answer = ""
    model_cfg = _CFG.get("models") if isinstance(_CFG.get("models"), dict) else {}
    intensive = model_cfg.get("intensive_reading") if isinstance(model_cfg.get("intensive_reading"), dict) else {}
    model = str(intensive.get("model_name") or model_cfg.get("default_nexora_model") or "").strip() or None
    prompt = (
        "你是 Nexora Learning 的教材辅导助手。优先依据教材上下文回答；教材没有覆盖时，"
        "允许用可靠的通用知识补充，并明确说出哪些是教材外补充。回答简洁、适合学生继续学习，"
        "不要因为上下文不完整就拒答，也不要编造教材中不存在的具体引用。\n\n"
        f"教材上下文：\n{context_text[:12000]}\n\n学生问题：{question}"
    )
    if _PROXY is not None:
        result = _PROXY.complete_raw(
            messages=[{"role": "user", "content": prompt}],
            model=model,
            username=username,
            api_mode="chat",
            options={"temperature": 0.2, "max_tokens": 1200},
            request_timeout=30,
        )
        if not result.get("success"):
            answer = _offline_learning_answer(question)
            answer_source = "general_knowledge_fallback" if answer else "textbook_context"
            if not answer:
                return _failure(action, "MODEL_UNAVAILABLE", str(result.get("message") or "model request failed"), status=503)
        else:
            answer = _PROXY.extract_output_text(result.get("payload") if isinstance(result.get("payload"), dict) else {})
    if not answer:
        answer = _offline_learning_answer(question)
        answer_source = "general_knowledge_fallback" if answer else "textbook_context"
        if not answer:
            return _failure(action, "MODEL_EMPTY", "model returned an empty answer.", status=502)
    if _PROXY is not None and _looks_like_context_refusal(answer):
        # 模型有时仍会被“教材优先”误导成拒答；第二次明确要求通用知识补足，避免学习对话卡死。
        rescue_prompt = (
            "请直接回答学生问题。教材上下文仅作为参考，若没有覆盖定义，必须使用可靠的通用知识补充；"
            "先给出结论，不要拒答，不要反问。控制在一到三句话，并说明这是通用知识补充。\n\n"
            f"教材上下文：\n{context_text[:8000]}\n\n学生问题：{question}"
        )
        rescue = _PROXY.complete_raw(
            messages=[{"role": "user", "content": rescue_prompt}],
            model=model,
            username=username,
            api_mode="chat",
            options={"temperature": 0.35, "max_tokens": 500},
            request_timeout=30,
        )
        rescue_answer = _PROXY.extract_output_text(rescue.get("payload") if isinstance(rescue.get("payload"), dict) else {}) if rescue.get("success") else ""
        if rescue_answer and not _looks_like_context_refusal(rescue_answer):
            answer = rescue_answer
        elif "傅里叶变换" in question:
            answer = _offline_learning_answer(question)
            answer_source = "general_knowledge_fallback"
    user_store.append_learning_record(_CFG, username, {
        "type": DIALOG_RECORD_TYPE,
        "dialog_id": f"dlg_{uuid.uuid4().hex[:20]}",
        "source": source,
        "question": question[:8000],
        "answer": answer[:8000],
        "lecture_id": lecture_id,
        "book_id": book_id,
        "has_photo": bool(photo_text),
        "timestamp": timestamp,
    })
    return _response(action=action, data={"answer": answer, "source": answer_source, "entry_source": source, "lecture_id": lecture_id, "book_id": book_id, "context_chars": len(context_text)})


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
        code, message, status = target_error or ("COURSE_NOT_FOUND", "No learning target is available.", 404)
        return _failure(action, code, message, status=status)
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


@agent_facade_bp.route("/review/submit", methods=["POST"])
def agent_review_submit():
    """今日复习交卷：判分并写进答题记录 / 时间线。"""
    action = "review_submit"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    quiz_id = str(data.get("quiz_id") or "").strip()
    if not quiz_id:
        return _failure(action, "INVALID_ARGUMENT", "quiz_id is required.")
    answers = data.get("answers")
    if answers is not None and not isinstance(answers, list):
        return _failure(action, "INVALID_ARGUMENT", "answers must be an array.")
    quiz = load_quiz_by_id(_CFG, username, quiz_id)
    questions = quiz.get("questions") if isinstance(quiz.get("questions"), list) else []
    if not questions:
        return _failure(action, "QUIZ_NOT_FOUND", "review quiz not found.", status=404)
    answer_map: Dict[str, str] = {}
    for item in answers or []:
        if not isinstance(item, Mapping):
            continue
        question_id = str(item.get("question_id") or item.get("source_id") or "").strip()
        if question_id:
            answer_map[question_id] = str(item.get("answer") or "").strip()
    timestamp = int(time.time())
    lecture_id = str(data.get("lecture_id") or quiz.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or quiz.get("book_id") or "").strip()
    chapter_index = _safe_int(data.get("chapter_index"), _safe_int(quiz.get("chapter_index"), 0))
    chapter_name = str(data.get("chapter_name") or quiz.get("chapter_name") or "").strip()
    scored: list[Dict[str, Any]] = []
    correct = 0
    for index, question in enumerate(questions):
        if not isinstance(question, Mapping):
            continue
        question_id = str(question.get("source_id") or question.get("question_id") or f"q{index}").strip()
        user_answer = answer_map.get(question_id, "")
        is_correct = grade_question(question, user_answer) if user_answer else False
        if is_correct:
            correct += 1
        user_store.append_question_completion(_CFG, username, {
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_index": chapter_index,
            "chapter_name": chapter_name,
            "question_title": str(question.get("title") or question.get("content") or "")[:120],
            "is_correct": is_correct,
            "timestamp": timestamp,
        })
        scored.append({"question_id": question_id, "is_correct": is_correct})
    total = len(scored)
    score_text = f"{correct}/{total}" if total else "0/0"
    user_store.append_learning_record(_CFG, username, {
        "type": DIALOG_RECORD_TYPE,
        "dialog_id": f"dlg_{uuid.uuid4().hex[:20]}",
        "source": "app",
        "question": f"我做完了「{chapter_name or '这一章'}」的复习题",
        "answer": f"这组题你对了 {score_text}。" + ("错的几道，回头在原文里再看一眼。" if total and correct < total else "这章你吃得很稳。"),
        "lecture_id": lecture_id,
        "book_id": book_id,
        "timestamp": timestamp,
    })
    user_store.append_learning_record(_CFG, username, {
        "type": "agent_event",
        "event": "quiz_submitted",
        "event_id": f"rev_{uuid.uuid4().hex[:16]}",
        "chapter_name": chapter_name,
        "timestamp": timestamp,
    })
    log_event("agent_review_submit", "复习交卷", payload={"user_id": username, "quiz_id": quiz_id, "score": score_text})
    return _response(action=action, data={
        "quiz_id": quiz_id,
        "score": score_text,
        "correct": correct,
        "total": total,
        "items": scored,
    })


@agent_facade_bp.route("/tasks/<task_id>", methods=["GET"])
def agent_task(task_id: str):
    action = "task"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    username, error = _require_user(None, action)
    if error is not None:
        return error
    normalized_task_id = str(task_id or "").strip()
    task = _load_task(normalized_task_id)
    if task is None:
        with _LOCK:
            task = _TASKS.get(normalized_task_id)
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


# ---------------------------------------------------------------------------
# 主动决策器（B4）：/decision 调试评估入口、/decision/respond 卡片回复回喂、
# GET /events 时间线读取（§3.1 TimelineEntry 契约）。
# ---------------------------------------------------------------------------


def _entry_ts(record: Mapping[str, Any]) -> int:
    """学习记录时间戳（秒）→ 时间线条目毫秒时间戳。"""
    return int(_record_timestamp(record) * 1000)


def _proactive_actions(record: Mapping[str, Any]) -> list[Dict[str, Any]]:
    decision_id = str(record.get("decision_id") or "").strip()
    if not decision_id:
        return []
    return [
        {"label": "好", "action": "decision_accept", "payload": {"decision_id": decision_id}},
        {"label": "晚点", "action": "decision_defer", "payload": {"decision_id": decision_id}},
        {"label": "不用了", "action": "decision_dismiss", "payload": {"decision_id": decision_id}},
    ]


def _timeline_entries(records: list[Dict[str, Any]], limit: int = 100) -> list[Dict[str, Any]]:
    """把学习记录映射为 §3.1 TimelineEntry 列表（ts 升序，取最近 limit 条）。"""
    entries: list[Dict[str, Any]] = []
    for row in records:
        if not isinstance(row, Mapping):
            continue
        record_type = str(row.get("type") or "").strip()
        if record_type == "agent_decision":
            card = row.get("card")
            entries.append({
                "id": str(row.get("decision_id") or "").strip(),
                "kind": str(row.get("kind") or "agent_hold").strip(),
                "ts": _entry_ts(row),
                "text": str(row.get("text") or "").strip(),
                "reason": str(row.get("reason") or "").strip(),
                "evidence": [dict(item) for item in row.get("evidence") or [] if isinstance(item, Mapping)],
                "card": dict(card) if isinstance(card, Mapping) else None,
                "actions": _proactive_actions(row) if isinstance(card, Mapping) else [],
                "unattended": True,
                "status": str(row.get("status") or "pending").strip(),
                "trigger": str(row.get("trigger") or "").strip(),
                # 决策器已算出抑制原因与综合分（core/decision/engine.py），此前未下发。
                # 端侧据此渲染「它为什么没打扰你」——§11.4 第 4 条「克制是设计的一部分」的可视化载体。
                "suppressed_by": str(row.get("suppressed_by") or "").strip(),
                "score": row.get("score"),
                # Judgment Loop：出现形态、模型裁决摘要、它当时看到的上下文（长按展开）。
                "channel": str(row.get("channel") or "").strip(),
                "judgment": dict(row["judgment"]) if isinstance(row.get("judgment"), Mapping) else None,
                "context": dict(row["context"]) if isinstance(row.get("context"), Mapping) else None,
            })
        elif record_type == DIALOG_RECORD_TYPE:
            source = str(row.get("source") or "app").strip()
            source_label = {"xiaoyi": "在小艺里", "a2a": "通过另一个智能体", "photo": "拍了张教材"}.get(source, "")
            entries.append({
                "id": str(row.get("dialog_id") or "").strip(),
                "kind": "agent_msg",
                "ts": _entry_ts(row),
                "text": str(row.get("answer") or "").strip()[:8000],
                "reason": f"你{source_label}问我：{str(row.get('question') or '').strip()[:200]}",
                "evidence": [],
                "card": None,
                "actions": [],
                "unattended": False,
                "channel": source,
            })
        elif record_type == "agent_user_msg":
            entries.append({
                "id": str(row.get("message_id") or uuid.uuid4().hex).strip(),
                "kind": "user_msg",
                "ts": _entry_ts(row),
                "text": str(row.get("text") or row.get("question") or "").strip(),
                "reason": "",
                "evidence": [],
                "card": None,
                "actions": [],
                "unattended": False,
                "channel": str(row.get("source") or "app").strip(),
            })
        elif record_type == "agent_plan_response":
            target = row.get("target") if isinstance(row.get("target"), Mapping) else {}
            entries.append({
                "id": str(row.get("message_id") or uuid.uuid4().hex).strip(),
                "kind": "agent_msg",
                "ts": _entry_ts(row),
                "text": str(row.get("text") or "").strip(),
                "reason": str(row.get("reason") or "").strip(),
                "evidence": [],
                "card": {
                    "type": "plan",
                    "chapter": str(target.get("chapter_name") or "下一章"),
                    "minutes": int(row.get("estimated_minutes") or 25),
                    "why": str(row.get("reason") or ""),
                },
                "actions": [],
                "unattended": False,
                "channel": "app",
            })
        elif record_type == "agent_session_opened":
            chapter = str(row.get("chapter_name") or "").strip()
            entries.append({
                "id": str(row.get("session_id") or "").strip(),
                "kind": "system",
                "ts": _entry_ts(row),
                "text": f"我开了一个学习会话：{chapter}" if chapter else "我开了一个学习会话。",
                "reason": "",
                "evidence": [],
                "card": None,
                "actions": [],
                "unattended": False,
            })
        elif record_type == "agent_event":
            event_name = str(row.get("event") or "").strip()
            if event_name in _SILENT_EVENTS:
                # 内部记账事件（裁决回喂、心跳）不上时间线：那是它的账本，不是它的日记。
                continue
            text = _EVENT_COPY.get(event_name)
            if text is None:
                text = f"你完成了章节：{str(row.get('chapter_name') or str(row.get('chapter_index') or '')).strip()}" if event_name == "chapter_completed" else f"我记下了一件事：{_humanize_event(event_name)}。"
            entries.append({
                "id": str(row.get("event_id") or "").strip(),
                "kind": "system",
                "ts": _entry_ts(row),
                "text": text,
                "reason": "",
                "evidence": [],
                "card": None,
                "actions": [],
                "unattended": False,
            })
    entries.sort(key=lambda item: int(item["ts"] or 0))
    entries = _collapse_repeats(entries)
    return entries[-max(1, min(500, limit)):]


# 只记账、不上日记的事件。
_SILENT_EVENTS = frozenset({"facet_verdict", "heartbeat", "telemetry_flush", "form_refresh"})

_EVENT_COPY = {
    "session_started": "你开始了学习。",
    "session_completed": "你学完了这一节。",
    "session_closed": "你合上了书。",
    "learning_session_completed": "你学完了这一节。",
    "quiz_submitted": "你交了卷。",
    "reading_done": "你读完了这一章。",
}


def _humanize_event(event_name: str) -> str:
    return event_name.replace("_", " ") if event_name else "未命名事件"


def _collapse_repeats(entries: list[Dict[str, Any]], window_ms: int = 45 * 60 * 1000) -> list[Dict[str, Any]]:
    """同一句系统话在 45 分钟内重复出现，折成一条「……（×N）」——四条「我开了一个学习会话」不是四件事。"""
    collapsed: list[Dict[str, Any]] = []
    for entry in entries:
        previous = collapsed[-1] if collapsed else None
        if (
            previous is not None
            and entry["kind"] == "system"
            and previous["kind"] == "system"
            and previous.get("_base_text", previous["text"]) == entry["text"]
            and int(entry["ts"]) - int(previous["ts"]) <= window_ms
        ):
            count = int(previous.get("_repeat", 1)) + 1
            previous["_repeat"] = count
            previous["_base_text"] = previous.get("_base_text", previous["text"])
            previous["text"] = f"{previous['_base_text']}（这段时间里 {count} 次）"
            previous["ts"] = entry["ts"]
            continue
        collapsed.append(dict(entry))
    for entry in collapsed:
        entry.pop("_repeat", None)
        entry.pop("_base_text", None)
    return collapsed


@agent_facade_bp.route("/events", methods=["GET"])
def agent_events():
    """时间线：最近 N 条 §3.1 TimelineEntry（ts 升序）。"""
    action = "events"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    username, error = _require_user(None, action)
    if error is not None:
        return error
    limit = _safe_int(request.args.get("limit"), 100)
    records = user_store.list_learning_records(_CFG, username) or []
    entries = _timeline_entries(records, limit)
    return _response(action=action, data={"entries": entries, "count": len(entries), "generated_at": int(time.time())})


@agent_facade_bp.route("/decision", methods=["POST"])
def agent_decision():
    """决策器调试入口（§4.6）：手动注入信号并立即求值，用于排练与录制兜底。

    无论 fire 真假都写入时间线（agent_act / agent_hold）。
    """
    action = "decision"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    target = data.get("target")
    if target is not None and not isinstance(target, dict):
        return _failure(action, "INVALID_ARGUMENT", "target must be an object.")
    if isinstance(target, dict):
        for field in ("lecture_id", "book_id"):
            value = str(target.get(field) or "").strip()
            if value and not _valid_identifier(value):
                return _failure(action, "INVALID_ARGUMENT", f"{field} is invalid.")
    signals = data.get("signals")
    if signals is not None and not isinstance(signals, dict):
        return _failure(action, "INVALID_ARGUMENT", "signals must be an object.")
    now = _safe_int(data.get("now"), 0) or None
    minutes = _safe_int(data.get("minutes"), 0) or None
    trigger = str(data.get("trigger") or "").strip()
    decision = evaluate_decision(
        _CFG,
        username,
        trigger=trigger,
        signals=dict(signals) if isinstance(signals, dict) else None,
        target=dict(target) if isinstance(target, dict) else None,
        minutes=minutes,
        now=now,
    )
    record = dict(decision)
    record["type"] = "agent_decision"
    record["username"] = username
    user_store.append_learning_record(_CFG, username, record)
    log_event(
        "agent_decision",
        "Proactive decision evaluated.",
        payload={"user_id": username, "decision_id": decision["decision_id"], "fire": decision["fire"], "trigger": decision["trigger"]},
    )
    next_actions: list[Dict[str, Any]] = []
    if decision["fire"] and isinstance(decision.get("target"), dict) and decision["target"].get("lecture_id"):
        next_actions.append({"type": "open_session", "target": decision["target"]})
    return _response(action=action, data={"decision": decision}, next_actions=next_actions)


@agent_facade_bp.route("/flow/accept", methods=["POST"])
def agent_flow_accept():
    """N5 闭环排练入口：建流程（同 decision accept 语义）。"""
    action = "flow_accept"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    from core.agent_flow import start_flow

    target = data.get("target")
    if not isinstance(target, dict):
        return _failure(action, "INVALID_ARGUMENT", "target is required.")
    if not str(target.get("lecture_id") or "").strip() or not str(target.get("book_id") or "").strip():
        return _failure(action, "INVALID_ARGUMENT", "target.lecture_id and target.book_id are required.")
    result = start_flow(_CFG, username, target, now=_safe_int(data.get("now"), 0) or None)
    log_event("agent_flow_accept", "闭环流程启动", payload={"user_id": username, "flow_id": result["flow_id"]})
    return _response(action=action, data=result)


@agent_facade_bp.route("/flow/event", methods=["POST"])
def agent_flow_event():
    """流程事件推进（reading_done）。"""
    action = "flow_event"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    flow_id = str(data.get("flow_id") or "").strip()
    if not _valid_identifier(flow_id):
        return _failure(action, "INVALID_ARGUMENT", "flow_id is invalid.")
    from core.agent_flow import flow_event

    result = flow_event(_CFG, username, flow_id, str(data.get("event") or "").strip())
    if result.get("error"):
        return _failure(action, result["error"], "flow event rejected.")
    return _response(action=action, data=result)


@agent_facade_bp.route("/flow/submit", methods=["POST"])
def agent_flow_submit():
    """判分 + 画像更新 + 备下一章 + wrapup 卡。"""
    action = "flow_submit"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    flow_id = str(data.get("flow_id") or "").strip()
    if not _valid_identifier(flow_id):
        return _failure(action, "INVALID_ARGUMENT", "flow_id is invalid.")
    answers = data.get("answers")
    if answers is not None and not isinstance(answers, list):
        return _failure(action, "INVALID_ARGUMENT", "answers must be an array.")
    from core.agent_flow import submit_answers

    result = submit_answers(_CFG, username, flow_id, answers or [], force_uncertain=bool(data.get("force_uncertain")))
    if result.get("error"):
        return _failure(action, result["error"], "flow submit rejected.")
    return _response(action=action, data=result)


@agent_facade_bp.route("/flow/uncertain", methods=["POST"])
def agent_flow_uncertain():
    """wrapup 卡 uncertain 裁决回喂。"""
    action = "flow_uncertain"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    flow_id = str(data.get("flow_id") or "").strip()
    question_id = str(data.get("question_id") or "").strip()
    verdict = str(data.get("verdict") or "").strip()
    if not _valid_identifier(flow_id) or not question_id:
        return _failure(action, "INVALID_ARGUMENT", "flow_id and question_id are required.")
    from core.agent_flow import uncertain_verdict

    result = uncertain_verdict(_CFG, username, flow_id, question_id, verdict)
    if result.get("error"):
        return _failure(action, result["error"], "uncertain verdict rejected.")
    return _response(action=action, data=result)


@agent_facade_bp.route("/flow/state", methods=["GET"])
def agent_flow_state():
    """流程状态（断点恢复渲染用）。"""
    action = "flow_state"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    username, error = _require_user(None, action)
    if error is not None:
        return error
    flow_id = str(request.args.get("flow_id") or "").strip()
    if not flow_id:
        return _failure(action, "INVALID_ARGUMENT", "flow_id is required.")
    from core.agent_flow import flow_state

    return _response(action=action, data=flow_state(_CFG, username, flow_id))


@agent_facade_bp.route("/toolbox/kb-upsert", methods=["POST"])
def agent_toolbox_kb_upsert():
    """T1：资料入库 → kbfile 卡。"""
    action = "toolbox_kb_upsert"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    project_id = str(data.get("project_id") or "default").strip()
    texts = data.get("texts")
    if not isinstance(texts, list) or not texts:
        return _failure(action, "INVALID_ARGUMENT", "texts must be a non-empty array.")
    from core.toolbox import kb_upsert

    result = kb_upsert(_CFG, username, project_id, texts)
    if not result.get("ok"):
        return _response(action=action, data=result)
    return _response(action=action, data=result)


@agent_facade_bp.route("/toolbox/kb-query", methods=["POST"])
def agent_toolbox_kb_query():
    """T2：知识库检索 → citation 卡。"""
    action = "toolbox_kb_query"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    query = str(data.get("query") or "").strip()
    if not query:
        return _failure(action, "INVALID_ARGUMENT", "query is required.")
    from core.toolbox import kb_query

    result = kb_query(_CFG, username, str(data.get("project_id") or "default").strip(), query, _safe_int(data.get("k"), 3))
    return _response(action=action, data=result)


@agent_facade_bp.route("/toolbox/search", methods=["POST"])
def agent_toolbox_search():
    """T3：联网补充 → search 卡。"""
    action = "toolbox_search"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    query = str(data.get("query") or "").strip()
    if not query:
        return _failure(action, "INVALID_ARGUMENT", "query is required.")
    from core.toolbox import web_search

    result = web_search(_CFG, username, query, _safe_int(data.get("limit"), 3))
    return _response(action=action, data=result)


@agent_facade_bp.route("/toolbox/mail-latest", methods=["POST"])
def agent_toolbox_mail_latest():
    """T4：最新邮件 → mail 卡。"""
    action = "toolbox_mail"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    from core.toolbox import mail_fetch

    result = mail_fetch(_CFG, username, str(data.get("group") or "").strip(), str(data.get("user") or "").strip(), _safe_int(data.get("limit"), 3))
    return _response(action=action, data=result)


@agent_facade_bp.route("/toolbox/videos", methods=["POST"])
def agent_toolbox_videos():
    """T6：章节配套视频 → video 卡。"""
    action = "toolbox_videos"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    lecture_id = str(data.get("lecture_id") or "").strip()
    if not lecture_id:
        return _failure(action, "INVALID_ARGUMENT", "lecture_id is required.")
    from core.toolbox import video_for_lecture

    result = video_for_lecture(_CFG, username, lecture_id, _safe_int(data.get("limit"), 3))
    return _response(action=action, data=result)


@agent_facade_bp.route("/toolbox/orchestrate", methods=["POST"])
def agent_toolbox_orchestrate():
    """跨域编排：「把最新作业邮件整理成计划，附件入库」。"""
    action = "toolbox_orchestrate"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    from core.toolbox import orchestrate

    result = orchestrate(_CFG, username, str(data.get("command") or "").strip())
    return _response(action=action, data=result)


@agent_facade_bp.route("/prereq/check", methods=["POST"])
def agent_prereq_check():
    """前置知识缺口检查（B2，§4.2）：给定章节 → 跨课程同名概念的掌握度缺口 + prereq 卡。"""
    action = "prereq_check"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    chapter_index = _safe_int(data.get("chapter_index"), -1)
    if not lecture_id or not book_id or chapter_index < 0:
        return _failure(action, "INVALID_ARGUMENT", "lecture_id, book_id and chapter_index are required.")
    now = _safe_int(data.get("now"), 0) or None
    from core.cognition.prereq import check_prereq

    result = check_prereq(_CFG, username, lecture_id, book_id, chapter_index, now=now)
    log_event("agent_prereq_check", "前置知识缺口检查", payload={"user_id": username, "lecture_id": lecture_id, "chapter_index": chapter_index})
    return _response(action=action, data=result)


@agent_facade_bp.route("/cognition/overview", methods=["GET"])
def agent_cognition_overview():
    """面二（§6.3）：用户全部已选课程的认知状态 → UserModelFacet 判断列表 + 掌握度热力图数据。"""
    action = "cognition_overview"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    username, error = _require_user(None, action)
    if error is not None:
        return error
    from core.cognition.facets import build_facets

    data = build_facets(_CFG, username)
    return _response(action=action, data=data)


@agent_facade_bp.route("/cognition/verdict", methods=["POST"])
def agent_cognition_verdict():
    """面二反驳回喂（§6.3）：agree/disagree 写 review 证据（disagree=0 拉低掌握度，即时生效）。"""
    action = "cognition_verdict"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    facet_id = str(data.get("facet_id") or "").strip()
    verdict = str(data.get("verdict") or "").strip()
    if not _valid_identifier(facet_id, max_length=160):
        return _failure(action, "INVALID_ARGUMENT", "facet_id is invalid.")
    if verdict not in {"agree", "disagree"}:
        return _failure(action, "INVALID_ARGUMENT", "verdict must be agree or disagree.")
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    concept_id = str(data.get("concept_id") or "").strip()
    from core.cognition.facets import record_verdict

    result = record_verdict(_CFG, username, facet_id, verdict, lecture_id=lecture_id, book_id=book_id, concept_id=concept_id)
    # 反驳变成对话：带 note 的 disagree 送回模型，由它回应并改写判断；同时留痕为对话上下文。
    note = str(data.get("note") or "").strip()[:300]
    claim = str(data.get("claim") or "").strip()[:200]
    if note:
        evidence_labels = [str(item) for item in data.get("evidence") or [] if str(item).strip()][:6] if isinstance(data.get("evidence"), list) else []
        reply = rebut(_CFG, claim=claim or facet_id, evidence=evidence_labels, note=note)
        result = dict(result)
        result["reply"] = reply
        user_store.append_learning_record(_CFG, username, {
            "type": DIALOG_RECORD_TYPE,
            "dialog_id": f"dlg_{uuid.uuid4().hex[:20]}",
            "source": "rebuttal",
            "question": f"反驳「{claim or facet_id}」：{note}",
            "answer": str((reply or {}).get("reply") or "我记下了你的反驳。"),
            "lecture_id": lecture_id,
            "book_id": book_id,
        })
    log_event("agent_cognition_verdict", "面二判断已回喂", payload={"user_id": username, "facet_id": facet_id, "verdict": verdict})
    return _response(action=action, data=result)


@agent_facade_bp.route("/judgment/context", methods=["GET"])
def agent_judgment_context():
    """它此刻看到了什么：ContextBundle 只读快照（演示与排练用，不落时间线、不调模型）。"""
    action = "judgment_context"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    username, error = _require_user(None, action)
    if error is not None:
        return error
    now = _safe_int(request.args.get("now"), 0) or int(time.time())
    bundle = build_context_bundle(_CFG, username, now=now, trigger=str(request.args.get("trigger") or "").strip())
    return _response(action=action, data={"bundle": bundle})


@agent_facade_bp.route("/context/device", methods=["POST"])
def agent_context_device():
    """端侧上报设备上下文（未来 24h 日历、免打扰、情景、粗粒度位置）。

    手机前台时上报一次；此后夜间备课、邮件、困惑等任何触发源求值时，决策器都能看到。
    """
    action = "context_device"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    from core.decision.device_context import save_device_context

    reported_at = _safe_int(data.get("now"), 0) or None
    record = save_device_context(_CFG, username, data, now=reported_at)
    return _response(action=action, data={"stored": True, "calendar_count": len(record["calendar"]), "reported_at": record["reported_at"]})


@agent_facade_bp.route("/confusion/scan", methods=["POST"])
def agent_confusion_scan():
    """困惑地图手动排练入口（B3，§4.3）：归因阅读信号、写证据与 confusion 卡。"""
    action = "confusion_scan"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    now = _safe_int(data.get("now"), 0) or None
    from core.cognition.attribution import scan_confusion

    result = scan_confusion(_CFG, username, now=now)
    log_event("agent_confusion_scan", "困惑地图手动触发", payload={"user_id": username})
    return _response(action=action, data=result)


@agent_facade_bp.route("/prep/run", methods=["POST"])
def agent_prep_run():
    """夜间备课手动排练入口（B1，§4.1）：立即执行一次备课扫描并做一轮完成检查。"""
    action = "prep_run"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    now = _safe_int(data.get("now"), 0) or None
    from core.booksproc.scheduler import run_prep_now

    result = run_prep_now(_CFG, username, now=now)
    log_event("agent_prep_run", "夜间备课手动触发", payload={"user_id": username})
    return _response(action=action, data=result)


@agent_facade_bp.route("/decision/respond", methods=["POST"])
def agent_decision_respond():
    """主动推送卡三按钮回喂（§6.1）：accept / defer / dismiss。"""
    action = "decision_respond"
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    data = _body()
    username, error = _require_user(data, action)
    if error is not None:
        return error
    decision_id = str(data.get("decision_id") or "").strip()
    if not _valid_identifier(decision_id):
        return _failure(action, "INVALID_ARGUMENT", "decision_id is invalid.")
    response = str(data.get("response") or "").strip()
    if response not in {"accept", "defer", "dismiss"}:
        return _failure(action, "INVALID_ARGUMENT", "response must be accept, defer or dismiss.")
    result = mark_decision_response(_CFG, username, decision_id, response)
    if not result.get("updated"):
        return _failure(action, "DECISION_NOT_FOUND", "decision not found for this user.", status=404)
    record = result.get("record") if isinstance(result.get("record"), dict) else {}
    next_actions: list[Dict[str, Any]] = []
    if response == "accept" and isinstance(record.get("target"), dict) and record["target"].get("lecture_id"):
        next_actions.append({"type": "open_session", "target": record["target"]})
        # N5 点头即闭环：accept 自动启动持久化执行链。
        from core.agent_flow import start_flow

        flow = start_flow(_CFG, username, record["target"])
        next_actions.append({"type": "flow", "flow_id": flow["flow_id"], "session_id": flow["session_id"], "target": record["target"]})
        log_event("agent_decision_accept_flow", "主动推送接受并启动闭环", payload={"user_id": username, "decision_id": decision_id, "flow_id": flow["flow_id"]})
    log_event(
        "agent_decision_respond",
        "Proactive decision responded.",
        payload={"user_id": username, "decision_id": decision_id, "response": response},
    )
    return _response(
        action=action,
        data={
            "updated": True,
            "decision_id": decision_id,
            "status": response,
            "backoff": bool(result.get("backoff")),
            "retry_at": result.get("retry_at"),
        },
        next_actions=next_actions,
    )
