"""HTTP routes for NexoraLearning."""

from __future__ import annotations

import json
import re
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib import error as urllib_error
from urllib import request as urllib_request

from flask import Blueprint, jsonify, request, send_file, send_from_directory
from werkzeug.utils import secure_filename

from core import storage
from core.lectures import (
    create_book as create_lecture_book,
    create_lecture as create_learning_lecture,
    delete_book as delete_lecture_book,
    delete_lecture as delete_learning_lecture,
    get_book as get_lecture_book,
    get_lecture as get_learning_lecture,
    list_books as list_lecture_books,
    list_lectures as list_learning_lectures,
    get_book_image_path,
    load_book_text,
    load_book_images_meta,
    load_book_info_xml,
    load_book_detail_xml,
    load_book_sections_xml,
    save_book_text,
    save_book_images_meta,
    save_book_info_xml,
    save_book_detail_xml,
    save_book_sections_xml,
    load_book_questions_xml,
    save_book_original_file,
    update_book as update_lecture_book,
    update_lecture as update_learning_lecture,
)
from core.models import (
    LearningModelFactory,
    get_default_nexora_model,
    update_default_nexora_model,
)
from core.nexora_proxy import NexoraProxy
from core.runlog import log_event
from core.runlog import available_log_sources, list_structured_logs
from core import user as user_store
from core.memory_analysis import run_memory_analysis_job
from core.profile_question import run_profile_question_job
from core.learning_feed import prepend_learning_feed_item
from core.learning_feed import list_learning_feed_items
from core.learning_feed import toggle_learning_feed_like
from core.learning_feed import append_learning_feed_comment
from core.learning_feed import delete_learning_feed_item
from core.learning_feed import delete_learning_feed_comment
from core.memory_queue import (
    enqueue_memory_job,
    get_memory_queue_snapshot,
    get_memory_state,
    increment_learning_turn,
    init_memory_queue,
    mark_context_compression_completed,
    maybe_enqueue_interval_analysis,
)
from core.tool_executor import ToolExecutor as LearningToolExecutor
from core.tools import TOOLS as LEARNING_TOOLS
from core.booksproc import (
    cancel_book_refinement,
    enqueue_book_intensive,
    enqueue_book_question,
    enqueue_book_refinement,
    enqueue_book_section,
    get_book_progress_steps,
    get_book_progress_text,
    get_intensive_reading_settings,
    get_memory_settings,
    get_profile_question_settings,
    get_refinement_queue_snapshot,
    get_rough_reading_settings,
    get_split_chapters_settings,
    init_booksproc,
    list_refinement_candidates,
    mark_book_uploaded,
    update_intensive_reading_settings,
    update_memory_settings,
    update_profile_question_settings,
    update_rough_reading_settings,
    update_split_chapters_settings,
)
from core.vector import (
    collection_stats as vector_collection_stats,
    delete_course_collection as vector_delete_course_collection,
    delete_material_chunks as vector_delete_material_chunks,
    query as vector_query,
    queue_vectorize_book,
    split_text_for_vector,
    upsert_chunks as vector_upsert_chunks,
    vectorize_book,
)
from core.utils import extract_text
from core.epub_assets import extract_epub_with_assets

bp = Blueprint("learning", __name__, url_prefix="/api")
_cfg: Dict[str, Any] = {}
_proxy: Optional[NexoraProxy] = None
_FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
_FRONTEND_ASSETS_DIR = _FRONTEND_DIR / "assets"

ALLOWED_EXT = {".pdf", ".txt", ".md", ".docx", ".doc", ".epub", ".c", ".h", ".py", ".rst"}
_NEXORA_OPTION_FIELDS = (
    "temperature",
    "top_p",
    "max_tokens",
    "max_output_tokens",
    "presence_penalty",
    "frequency_penalty",
    "seed",
    "stop",
    "tools",
    "tool_choice",
    "response_format",
    "stream_options",
    "parallel_tool_calls",
    "metadata",
    "text",
    "reasoning",
    "store",
    "include",
    "truncation",
    "previous_response_id",
    "allow_synthetic_fallback",
    "force_chat_bridge",
)


@bp.before_app_request
def _intercept_disabled_refinement_routes():
    if request.method != "POST":
        return None
    path = str(request.path or "").strip()
    if path != "/api/frontend/settings/refinement/question":
        return None
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    log_event(
        "frontend_question_disabled",
        "Question-generation refinement request was rejected because the flow is disabled.",
        payload={
            "lecture_id": lecture_id,
            "book_id": book_id,
            "is_admin": bool(_is_runtime_admin()),
        },
    )
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
    return jsonify(
        {
            "success": False,
            "lecture_id": lecture_id,
            "book_id": book_id,
            "error": "Question-generation refinement is currently disabled.",
        }
    ), 410


def init_routes(cfg: Dict[str, Any]) -> None:
    global _cfg, _proxy
    _cfg = cfg
    _proxy = NexoraProxy(cfg)
    init_booksproc(cfg)
    init_memory_queue(cfg, run_job=_run_background_memory_job)


def _run_background_memory_job(cfg: Mapping[str, Any], job: Mapping[str, Any]) -> None:
    reason = str(job.get("reason") or "").strip().lower()
    if reason == "profile_question":
        run_profile_question_job(cfg, job)
        return
    run_memory_analysis_job(cfg, job)


def _allowed(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXT


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def parse_book_info_xml_chapters(xml_text: str, full_text_length: int) -> List[Dict[str, Any]]:
    text = str(xml_text or "")
    entries: List[Dict[str, Any]] = []
    for match in re.finditer(
        r"<chapter_name>\s*(.*?)\s*</chapter_name>[\s\S]*?<chapter_range>\s*(.*?)\s*</chapter_range>",
        text,
        flags=re.IGNORECASE,
    ):
        title = str(match.group(1) or "").strip()
        range_text = str(match.group(2) or "").strip()
        if not title or ":" not in range_text:
            continue
        left, right = range_text.split(":", 1)
        try:
            start = max(0, int(str(left).strip()))
            length = max(0, int(str(right).strip()))
        except Exception:
            continue
        end = min(max(0, int(full_text_length or 0)), start + length)
        entries.append({"title": title, "start": start, "end": max(start, end), "range": f"{start}:{length}"})
    entries.sort(key=lambda row: int(row.get("start") or 0))
    return entries


def _runtime_api_cfg() -> Dict[str, Any]:
    branch = _cfg.get("runtime_api") if isinstance(_cfg.get("runtime_api"), dict) else {}
    return dict(branch or {})


def _runtime_api_enabled() -> bool:
    return _as_bool(_runtime_api_cfg().get("enabled"), default=True)


def _runtime_api_key() -> str:
    branch = _runtime_api_cfg()
    return str(branch.get("api_key") or "").strip()


def _resolve_learning_frontend_url() -> str:
    forwarded_host = str(request.headers.get("X-Forwarded-Host") or "").split(",")[0].strip()
    forwarded_proto = str(request.headers.get("X-Forwarded-Proto") or "").split(",")[0].strip()
    if forwarded_host:
        proto = forwarded_proto or request.scheme or "http"
        return f"{proto}://{forwarded_host}/api/frontend".rstrip("/")

    host = str(request.headers.get("Host") or request.host or "").strip()
    proto = forwarded_proto or request.scheme or "http"
    if host:
        return f"{proto}://{host}/api/frontend".rstrip("/")
    return request.host_url.rstrip("/") + "/api/frontend"


def _require_runtime_api_auth():
    if not _runtime_api_enabled():
        return jsonify({"success": False, "error": "Runtime API is disabled."}), 404

    expected = _runtime_api_key()
    if not expected:
        return None

    candidates = [
        str(request.headers.get("X-API-Key") or "").strip(),
        str(request.headers.get("X-NexoraLearning-Key") or "").strip(),
    ]
    auth_header = str(request.headers.get("Authorization") or "").strip()
    if auth_header.lower().startswith("bearer "):
        candidates.append(auth_header[7:].strip())
    if expected in candidates:
        return None
    return jsonify({"success": False, "error": "Invalid or missing runtime API key."}), 401


def _extract_nexora_options(data: Dict[str, Any]) -> Dict[str, Any]:
    options: Dict[str, Any] = {}
    for key in _NEXORA_OPTION_FIELDS:
        value = data.get(key)
        if value is not None:
            options[key] = value
    return options


def _fetch_session_user_from_nexora() -> Dict[str, Any]:
    if _proxy is None:
        log_event(
            "frontend_session_user_lookup",
            "Session user lookup skipped because proxy is not ready.",
            payload={"success": False, "reason": "proxy_not_ready"},
        )
        return {"success": False, "message": "proxy not ready"}

    base_url = str(getattr(_proxy, "base_url", "") or "").strip().rstrip("/")
    cookie_header = str(request.headers.get("Cookie") or "").strip()
    cookie_keys = sorted(
        {
            str(part.split("=", 1)[0]).strip()
            for part in cookie_header.split(";")
            if "=" in part
        }
    )
    if not base_url or not cookie_header:
        log_event(
            "frontend_session_user_lookup",
            "Session user lookup skipped because base_url or cookie is missing.",
            payload={
                "success": False,
                "reason": "missing_base_url_or_cookie",
                "has_base_url": bool(base_url),
                "has_cookie": bool(cookie_header),
                "cookie_keys": cookie_keys,
            },
        )
        return {"success": False, "message": "missing base_url or cookie"}

    url = f"{base_url}/api/user/info"
    req = urllib_request.Request(
        url,
        headers={
            "Accept": "application/json",
            "Cookie": cookie_header,
            "User-Agent": str(request.headers.get("User-Agent") or "NexoraLearning/1.0"),
        },
        method="GET",
    )
    try:
        with urllib_request.urlopen(req, timeout=8.0) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            payload = json.loads(raw) if raw.strip() else {}
            if not isinstance(payload, dict):
                log_event(
                    "frontend_session_user_lookup",
                    "Session user lookup returned a non-dict payload.",
                    payload={
                        "success": False,
                        "reason": "invalid_payload_type",
                        "url": url,
                        "status": int(getattr(resp, "status", 200) or 200),
                        "cookie_keys": cookie_keys,
                        "payload_type": type(payload).__name__,
                    },
                )
                return {"success": False, "message": "invalid payload type"}
            if payload.get("success") is False:
                log_event(
                    "frontend_session_user_lookup",
                    "Session user lookup returned an application-level failure.",
                    payload={
                        "success": False,
                        "reason": "app_failure",
                        "url": url,
                        "status": int(getattr(resp, "status", 200) or 200),
                        "cookie_keys": cookie_keys,
                        "message": str(payload.get("message") or "session user lookup failed"),
                    },
                )
                return {
                    "success": False,
                    "message": str(payload.get("message") or "session user lookup failed"),
                }
            user = payload.get("user")
            if isinstance(user, dict):
                log_event(
                    "frontend_session_user_lookup",
                    "Session user lookup succeeded.",
                    payload={
                        "success": True,
                        "url": url,
                        "status": int(getattr(resp, "status", 200) or 200),
                        "cookie_keys": cookie_keys,
                        "user_id": str(user.get("id") or "").strip(),
                        "username": str(user.get("username") or "").strip(),
                        "role": str(user.get("role") or "").strip(),
                    },
                )
                return {"success": True, "user": user}
            log_event(
                "frontend_session_user_lookup",
                "Session user lookup payload did not contain a user object.",
                payload={
                    "success": False,
                    "reason": "missing_user",
                    "url": url,
                    "status": int(getattr(resp, "status", 200) or 200),
                    "cookie_keys": cookie_keys,
                    "payload_keys": sorted([str(key) for key in payload.keys()]),
                },
            )
            return {"success": False, "message": "missing user in payload"}
    except urllib_error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8", errors="replace")
            payload = json.loads(body) if body.strip() else {}
            if isinstance(payload, dict):
                log_event(
                    "frontend_session_user_lookup",
                    "Session user lookup failed with HTTP error payload.",
                    payload={
                        "success": False,
                        "reason": "http_error_payload",
                        "url": url,
                        "status": int(getattr(exc, "code", 502) or 502),
                        "cookie_keys": cookie_keys,
                        "message": str(payload.get("message") or f"HTTP {exc.code}"),
                    },
                )
                return {"success": False, "message": str(payload.get("message") or f"HTTP {exc.code}")}
        except Exception:
            pass
        log_event(
            "frontend_session_user_lookup",
            "Session user lookup failed with HTTP error.",
            payload={
                "success": False,
                "reason": "http_error",
                "url": url,
                "status": int(getattr(exc, "code", 502) or 502),
                "cookie_keys": cookie_keys,
                "message": str(exc),
            },
        )
        return {"success": False, "message": f"HTTP {getattr(exc, 'code', 502)}"}
    except Exception as exc:
        log_event(
            "frontend_session_user_lookup",
            "Session user lookup raised an exception.",
            payload={
                "success": False,
                "reason": "exception",
                "url": url,
                "cookie_keys": cookie_keys,
                "message": str(exc),
            },
        )
        return {"success": False, "message": str(exc)}


def _lecture_or_404(lecture_id: str) -> Tuple[Optional[Dict[str, Any]], Optional[Tuple[Any, int]]]:
    lecture = get_learning_lecture(_cfg, lecture_id)
    if lecture is None:
        return None, (jsonify({"success": False, "error": "Lecture not found."}), 404)
    return lecture, None


def _resolve_runtime_user_id() -> str:
    query_username = str(request.args.get("username") or "").strip()
    if query_username:
        return query_username

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

    session_result = _fetch_session_user_from_nexora()
    if session_result.get("success"):
        user_payload = session_result.get("user") if isinstance(session_result.get("user"), dict) else {}
        resolved = str(user_payload.get("id") or user_payload.get("username") or "").strip()
        if resolved:
            return resolved

    if _proxy is not None:
        default_username = str(getattr(_proxy, "default_username", "") or "").strip()
        if default_username:
            return default_username

    return "guest"


def _build_user_study_hours_map(user_id: str) -> Dict[str, float]:
    """Aggregate per-lecture study hours from user learning records."""
    rows = user_store.list_learning_records(_cfg, user_id)
    hours_map: Dict[str, float] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        lecture_id = str(row.get("lecture_id") or "").strip()
        if not lecture_id:
            continue

        # 支持 seconds / minutes / hours 三种字段
        seconds = row.get("study_seconds")
        minutes = row.get("study_minutes")
        hours = row.get("study_hours")

        amount_hours = 0.0
        try:
            if hours is not None:
                amount_hours = max(0.0, float(hours))
            elif minutes is not None:
                amount_hours = max(0.0, float(minutes) / 60.0)
            elif seconds is not None:
                amount_hours = max(0.0, float(seconds) / 3600.0)
            elif str(row.get("type") or "").strip() in {"study_time", "study_session", "learning_time"}:
                # 兜底: duration 字段按秒
                duration = row.get("duration")
                if duration is not None:
                    amount_hours = max(0.0, float(duration) / 3600.0)
        except Exception:
            amount_hours = 0.0

        if amount_hours > 0:
            hours_map[lecture_id] = float(hours_map.get(lecture_id, 0.0) + amount_hours)
    return hours_map


def _escape_card_html(value: Any) -> str:
    text = str(value or "")
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def _build_lecture_display_card_payload(lecture_id: str) -> Dict[str, Any]:
    lecture = get_learning_lecture(_cfg, lecture_id)
    if lecture is None:
        raise ValueError("Lecture not found.")
    books = list_lecture_books(_cfg, lecture_id)
    title = str(lecture.get("title") or lecture.get("name") or lecture_id).strip() or lecture_id
    category = str(lecture.get("category") or "").strip() or "未分类"
    progress = int(lecture.get("progress") or 0)
    description = str(lecture.get("description") or "").strip()
    html = f"""
<article class="nxl-chat-card nxl-chat-card-lecture" data-lecture-id="{_escape_card_html(lecture_id)}">
  <div class="nxl-chat-card-kicker">Learning Lecture</div>
  <h3>{_escape_card_html(title)}</h3>
  <div class="nxl-chat-card-meta">{_escape_card_html(category)} · {len(books)} 本教材 · {progress}% 进度</div>
  <div class="nxl-chat-card-progress"><span style="width:{max(0, min(progress, 100))}%"></span></div>
  <p>{_escape_card_html(description or '暂无课程描述')}</p>
</article>
""".strip()
    return {
        "type": "lecture_display",
        "lecture_id": lecture_id,
        "lecture": lecture,
        "books_count": len(books),
        "html": html,
    }


def _build_chapter_range_card_payload(lecture_id: str, book_id: str, content_range: List[Any]) -> Dict[str, Any]:
    lecture = get_learning_lecture(_cfg, lecture_id)
    if lecture is None:
        raise ValueError("Lecture not found.")
    book = get_lecture_book(_cfg, lecture_id, book_id)
    if book is None:
        raise ValueError("Book not found.")
    if not isinstance(content_range, list) or len(content_range) != 2:
        raise ValueError("content_range must be [start, end].")
    start = max(0, int(content_range[0] or 0))
    end = max(start, int(content_range[1] or start))
    content = load_book_text(_cfg, lecture_id, book_id)
    snippet = content[start:end]
    title = str(book.get("title") or book_id).strip() or book_id
    lecture_title = str(lecture.get("title") or lecture_id).strip() or lecture_id
    html = f"""
<article class="nxl-chat-card nxl-chat-card-range" data-lecture-id="{_escape_card_html(lecture_id)}" data-book-id="{_escape_card_html(book_id)}">
  <div class="nxl-chat-card-kicker">Chapter Range</div>
  <h3>{_escape_card_html(title)}</h3>
  <div class="nxl-chat-card-meta">{_escape_card_html(lecture_title)} · [{start}, {end}]</div>
  <pre class="nxl-chat-card-snippet">{_escape_card_html(snippet[:1600] or '该区间暂无文本内容')}</pre>
</article>
""".strip()
    return {
        "type": "chapter_range",
        "lecture_id": lecture_id,
        "book_id": book_id,
        "content_range": [start, end],
        "lecture": lecture,
        "book": book,
        "content": snippet,
        "html": html,
    }


def _resolve_runtime_role() -> str:
    """解析当前请求对应用户角色，默认 member。"""
    session_result = _fetch_session_user_from_nexora()
    if session_result.get("success"):
        user_payload = session_result.get("user") if isinstance(session_result.get("user"), dict) else {}
        role = str(user_payload.get("role") or "").strip().lower()
        if role:
            return role

    user_id = _resolve_runtime_user_id()
    if _proxy is not None:
        result = _proxy.get_user_info(username=user_id or None)
        if result.get("success"):
            user_payload = result.get("user") if isinstance(result.get("user"), dict) else {}
            role = str(user_payload.get("role") or "").strip().lower()
            if role:
                return role
    return "member"


def _is_runtime_admin() -> bool:
    """判断当前请求是否管理员角色。"""
    return _resolve_runtime_role() == "admin"


def _extract_model_options(payload: Dict[str, Any]) -> List[Dict[str, str]]:
    """从 Nexora model list 响应中抽取模型选项。"""
    rows: List[Dict[str, str]] = []
    if not isinstance(payload, dict):
        return rows
    data_list = payload.get("data")
    if isinstance(data_list, list):
        for item in data_list:
            if not isinstance(item, dict):
                continue
            model_id = str(item.get("id") or "").strip()
            if not model_id:
                continue
            label = str(item.get("name") or item.get("label") or model_id).strip() or model_id
            rows.append({"id": model_id, "label": label})
    models_field = payload.get("models")
    if isinstance(models_field, list):
        for raw_name in models_field:
            model_id = str(raw_name or "").strip()
            if model_id:
                rows.append({"id": model_id, "label": model_id})
    elif isinstance(models_field, dict):
        for raw_name in models_field.keys():
            model_id = str(raw_name or "").strip()
            if model_id:
                rows.append({"id": model_id, "label": model_id})
    dedup: Dict[str, Dict[str, str]] = {}
    for row in rows:
        dedup[row["id"]] = row
    return list(dedup.values())


def _list_nexora_models_payload(username: str) -> Dict[str, Any]:
    """读取 Nexora 可用模型列表，支持多种 models 路径。"""
    if _proxy is None:
        return {"success": False, "message": "Nexora proxy not initialized.", "payload": {}}
    result = _proxy.list_models(username=username or None)
    if result.get("success"):
        return {
            "success": True,
            "message": "",
            "payload": result.get("payload") if isinstance(result.get("payload"), dict) else {},
        }
    # 兼容：如果 /api/papi/models 失败，尝试 /api/papi/model_list
    raw_username = str(username or "").strip()
    fallback_path = "/api/papi/model_list"
    if raw_username:
        fallback_path = f"{fallback_path}/{raw_username}"
    fallback = _proxy.get(fallback_path)
    if fallback.get("success"):
        return {
            "success": True,
            "message": "",
            "payload": fallback.get("payload") if isinstance(fallback.get("payload"), dict) else {},
        }
    return {
        "success": False,
        "message": str(result.get("message") or fallback.get("message") or "failed to load models"),
        "payload": {},
    }


def _book_or_404(
    lecture_id: str,
    book_id: str,
) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]], Optional[Tuple[Any, int]]]:
    lecture, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return None, None, error_response

    book = get_lecture_book(_cfg, lecture_id, book_id)
    if book is None:
        return lecture, None, (jsonify({"success": False, "error": "Book not found."}), 404)
    return lecture, book, None


@bp.route("/frontend/", methods=["GET"])
def frontend_index():
    return send_from_directory(str(_FRONTEND_DIR), "index.html")


@bp.route("/frontend/assets/<path:filename>", methods=["GET"])
def frontend_assets(filename: str):
    return send_from_directory(str(_FRONTEND_ASSETS_DIR), filename)


@bp.route("/frontend/context", methods=["GET"])
def frontend_context():
    requested_username = str(request.args.get("username") or "").strip()
    header_username = ""
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
            header_username = candidate
            break
    username = requested_username or header_username
    user_payload: Dict[str, Any] = {}
    is_admin = False
    integration: Dict[str, Any] = {
        "base_url": "",
        "endpoint": "",
        "connected": False,
        "models_count": 0,
        "message": "",
        "has_nexora_api_key": False,
    }
    if _proxy is not None:
        integration["base_url"] = str(getattr(_proxy, "base_url", "") or "")
        integration["endpoint"] = str(getattr(_proxy, "models_path", "") or "")
        integration["has_nexora_api_key"] = bool(str(getattr(_proxy, "api_key", "") or "").strip())
        # 优先使用当前会话用户，避免默认用户（如 guest）覆盖真实登录态。
        if not requested_username and not header_username:
            session_result = _fetch_session_user_from_nexora()
            if session_result.get("success"):
                user_payload = session_result.get("user") if isinstance(session_result.get("user"), dict) else {}
                role = str(user_payload.get("role") or "").strip().lower()
                is_admin = role == "admin"
                if not username:
                    username = str(
                        user_payload.get("id")
                        or user_payload.get("username")
                        or ""
                    ).strip()

        # 会话解析不到时，再走显式用户名或默认用户名。
        if not user_payload:
            if not username:
                username = str(getattr(_proxy, "default_username", "") or "").strip()
            result = _proxy.get_user_info(username=username or None)
            if result.get("success"):
                user_payload = result.get("user") if isinstance(result.get("user"), dict) else {}
                role = str(user_payload.get("role") or "").strip().lower()
                is_admin = role == "admin"
                if not username:
                    username = str(
                        user_payload.get("id")
                        or user_payload.get("username")
                        or ""
                    ).strip()

        probe = _proxy.list_models(username=username or None)
        if probe.get("success"):
            payload = probe.get("payload") if isinstance(probe.get("payload"), dict) else {}
            models_count = 0
            data_field = payload.get("data")
            models_field = payload.get("models")
            if isinstance(data_field, list):
                models_count = len(data_field)
            elif isinstance(models_field, list):
                models_count = len(models_field)
            elif isinstance(models_field, dict):
                models_count = len(models_field.keys())
            integration["connected"] = True
            integration["models_count"] = int(models_count)
            integration["message"] = ""
        else:
            integration["connected"] = False
            integration["message"] = str(probe.get("message") or "").strip()

    log_event(
        "frontend_context_resolution",
        "Resolved frontend context user.",
        payload={
            "requested_username": requested_username,
            "header_username": header_username,
            "resolved_username": str(username or "").strip(),
            "resolved_user_id": str(user_payload.get("id") or "").strip() if isinstance(user_payload, dict) else "",
            "resolved_role": str(user_payload.get("role") or "").strip() if isinstance(user_payload, dict) else "",
            "is_admin": bool(is_admin),
            "has_cookie": bool(str(request.headers.get("Cookie") or "").strip()),
            "integration_connected": bool(integration.get("connected")),
            "integration_message": str(integration.get("message") or "").strip(),
        },
    )

    return jsonify(
        {
            "success": True,
            "username": username,
            "user": user_payload,
            "is_admin": bool(is_admin),
            "integration": integration,
            "runtime_api": {
                "enabled": _runtime_api_enabled(),
                "base_path": "/api/runtime",
                "frontend_url": _resolve_learning_frontend_url(),
            },
        }
    )


def _build_feed_author_snapshot(username: str) -> Dict[str, str]:
    user_id = str(username or "").strip()
    snapshot = {"user_id": user_id}
    if not user_id:
        return snapshot
    session_result = _fetch_session_user_from_nexora()
    if session_result.get("success"):
        user = session_result.get("user") if isinstance(session_result.get("user"), dict) else {}
        session_user_id = str(user.get("id") or "").strip()
        if session_user_id and session_user_id == user_id:
            snapshot["user_id"] = session_user_id
            return snapshot
    if _proxy is None:
        return snapshot
    try:
        result = _proxy.get_user_info(username=user_id or None)
        if isinstance(result, dict) and result.get("success"):
            user = result.get("user") if isinstance(result.get("user"), dict) else {}
            snapshot["user_id"] = str(user.get("id") or user_id).strip() or user_id
    except Exception:
        pass
    return snapshot


@bp.route("/frontend/materials", methods=["GET"])
def frontend_materials():
    sort_by = str(request.args.get("sort_by") or "updated_at").strip().lower() or "updated_at"
    order = str(request.args.get("order") or "desc").strip().lower() or "desc"
    desc = order != "asc"

    lectures = list_learning_lectures(_cfg)
    rows = []
    total_books = 0
    for lecture in lectures:
        lecture_id = str((lecture or {}).get("id") or "").strip()
        books = list_lecture_books(_cfg, lecture_id) if lecture_id else []
        total_books += len(books)
        rows.append(
            {
                "lecture": lecture,
                "books": books,
                "books_count": len(books),
            }
        )

    def _row_sort_key(row: Dict[str, Any]):
        lecture = row.get("lecture") if isinstance(row.get("lecture"), dict) else {}
        books = row.get("books") if isinstance(row.get("books"), list) else []
        if sort_by == "title":
            return str((lecture or {}).get("title") or "").strip().lower()
        if sort_by == "progress":
            return int((lecture or {}).get("progress") or 0)
        if sort_by == "books_count":
            return int(row.get("books_count") or 0)
        if sort_by == "study_hours":
            return float((lecture or {}).get("study_hours") or 0.0)
        if sort_by == "book_updated_at":
            latest = 0
            for book in books:
                if not isinstance(book, dict):
                    continue
                latest = max(latest, int(book.get("updated_at") or 0))
            return latest
        if sort_by == "created_at":
            return int((lecture or {}).get("created_at") or 0)
        return int((lecture or {}).get("updated_at") or 0)

    rows.sort(key=_row_sort_key, reverse=desc)

    return jsonify(
        {
            "success": True,
            "lectures": rows,
            "total_lectures": len(rows),
            "total_books": total_books,
            "sort_by": sort_by,
            "order": "desc" if desc else "asc",
        }
    )


@bp.route("/frontend/dashboard", methods=["GET"])
def frontend_dashboard():
    user_id = _resolve_runtime_user_id()
    user_store.ensure_user_files(_cfg, user_id)
    selected_lecture_ids = set(user_store.list_selected_lecture_ids(_cfg, user_id))
    study_hours_map = _build_user_study_hours_map(user_id)

    lectures = list_learning_lectures(_cfg)
    selected_rows = []
    total_books = 0
    total_study_hours = 0.0
    for lecture in lectures:
        lecture_id = str((lecture or {}).get("id") or "").strip()
        if not lecture_id or lecture_id not in selected_lecture_ids:
            continue
        lecture_with_user_state = dict(lecture or {})
        lecture_hours = float(study_hours_map.get(lecture_id, 0.0))
        lecture_with_user_state["study_hours"] = lecture_hours
        total_study_hours += lecture_hours
        books = list_lecture_books(_cfg, lecture_id)
        total_books += len(books)
        selected_rows.append(
            {
                "lecture": lecture_with_user_state,
                "books": books,
                "books_count": len(books),
            }
        )

    return jsonify(
        {
            "success": True,
            "user_id": user_id,
            "selected_lecture_ids": sorted(selected_lecture_ids),
            "lectures": selected_rows,
            "total_lectures": len(selected_rows),
            "total_books": total_books,
            "total_study_hours": round(total_study_hours, 3),
        }
    )


def _legacy_frontend_chat_context_removed():
    """Legacy placeholder for the removed ChatDBServer bridge route."""
    return None
    data = request.get_json(silent=True) or {}
    user_id = _resolve_runtime_user_id()
    user_store.ensure_user_files(_cfg, user_id)
    selected_lecture_ids = set(user_store.list_selected_lecture_ids(_cfg, user_id))
    lectures = list_learning_lectures(_cfg)

    lecture_rows: List[Dict[str, Any]] = []
    cards: List[Dict[str, Any]] = []
    progress_lines: List[str] = []

    for lecture in lectures:
        lecture_id = str((lecture or {}).get("id") or "").strip()
        if not lecture_id or lecture_id not in selected_lecture_ids:
            continue
        books = list_lecture_books(_cfg, lecture_id)
        lecture_rows.append(
            {
                "id": lecture_id,
                "title": str((lecture or {}).get("title") or "").strip(),
                "category": str((lecture or {}).get("category") or "").strip(),
                "progress": int((lecture or {}).get("progress") or 0),
                "current_chapter": str((lecture or {}).get("current_chapter") or "").strip(),
                "books_count": len(books),
            }
        )
        progress_lines.append(
            f"- {str((lecture or {}).get('title') or '').strip() or lecture_id} | 进度 {int((lecture or {}).get('progress') or 0)}% | 当前 {str((lecture or {}).get('current_chapter') or '').strip() or '未开始'}"
        )
        try:
            cards.append(_build_lecture_display_card_payload(lecture_id))
        except Exception:
            pass

    user_payload = user_store.get_user(_cfg, user_id) or {}
    learning_records = user_store.list_learning_records(_cfg, user_id)
    recent_learning = learning_records[-8:] if isinstance(learning_records, list) else []

    system_prompt = (
        "你现在处于 NexoraLearning 学习对话模式。\n\n"
        "你的职责是围绕用户当前已选课程进行学习辅助，不要脱离学习语境。\n"
        "优先结合课程进度、教材、章节信息回答。\n"
        "如果用户问题与当前学习内容无关，可以正常回答，但要优先尝试连接到学习任务。\n"
        "当适合展示课程卡片或章节片段时，可以在回答中配合学习卡片信息。\n"
    ).strip()

    context_blocks = [
        {
            "type": "learning_profile",
            "title": "学习用户信息",
            "content": json.dumps(
                {
                    "user_id": user_id,
                    "user": user_payload,
                    "selected_lecture_ids": sorted(selected_lecture_ids),
                    "selected_lectures": lecture_rows,
                },
                ensure_ascii=False,
            ),
        },
        {
            "type": "learning_progress",
            "title": "当前课程进度",
            "content": "\n".join(progress_lines) if progress_lines else "当前还没有已选课程。",
        },
        {
            "type": "learning_recent_records",
            "title": "近期学习记录",
            "content": json.dumps(recent_learning, ensure_ascii=False),
        },
    ]

    active_tool_skills = [
        {
            "id": "learning-card-injection",
            "title": "Learning Card Injection",
            "required_tools": ["learning_card"],
            "mode": "force",
            "author": "NexoraLearning",
            "version": "1.0",
            "main_content": (
                "当前处于 NexoraLearning 学习对话模式。"
                "当需要展示课程总览卡片或章节片段卡片时，请主动调用 learning_card 工具。"
                "课程总览使用 type=lecture_display；章节片段使用 type=chapter_range，"
                "并传入 lecture_id、book_id 和 content_range。"
                "不要把卡片内容直接当普通文本输出。"
            ),
        },
        {
            "id": "learning-course-book-tools",
            "title": "Learning Course and Book Tools",
            "required_tools": [
                "listLectures",
                "createLecture",
                "getLecture",
                "updateLecture",
                "listBooks",
                "createBook",
                "getBook",
                "updateBook",
                "getBookText",
                "readBookTextRange",
                "searchBookText",
                "getBookInfoXml",
                "saveBookInfoXml",
                "getBookDetailXml",
                "saveBookDetailXml",
                "getBookQuestionsXml",
                "saveBookQuestionsXml",
                "triggerBookVectorization",
                "vectorSearch",
            ],
            "mode": "auto",
            "author": "NexoraLearning",
            "version": "1.0",
            "main_content": (
                "当前处于 NexoraLearning 学习对话模式。"
                "当需要查看课程列表、课程详情、教材列表、教材正文、文本区间、粗读/精读 XML、题目 XML、"
                "教材向量化或向量检索时，请主动使用对应工具完成，不要凭空编造课程结构或教材结构。"
                "课程容器相关操作使用 listLectures/createLecture/getLecture/updateLecture；"
                "教材相关操作使用 listBooks/createBook/getBook/updateBook；"
                "正文与片段读取使用 getBookText/readBookTextRange/searchBookText；"
                "结构 XML 读写使用 getBookInfoXml/saveBookInfoXml、getBookDetailXml/saveBookDetailXml、getBookQuestionsXml/saveBookQuestionsXml；"
                "向量化与检索使用 triggerBookVectorization 和 vectorSearch。"
            ),
        },
    ]

    return jsonify(
        {
            "success": True,
            "user_id": user_id,
            "system_prompt": system_prompt,
            "context_blocks": context_blocks,
            "active_tool_skills": active_tool_skills,
            "cards": cards,
            "meta": {
                "selected_lecture_count": len(lecture_rows),
            },
        }
    )


@bp.route("/frontend/card", methods=["POST"])
def frontend_card():
    data = request.get_json(silent=True) or {}
    card_type = str(data.get("type") or "").strip()
    if not card_type:
        return jsonify({"success": False, "error": "type is required."}), 400
    try:
        if card_type == "lecture_display":
            lecture_id = str(data.get("lecture_id") or "").strip()
            if not lecture_id:
                return jsonify({"success": False, "error": "lecture_id is required."}), 400
            payload = _build_lecture_display_card_payload(lecture_id)
        elif card_type == "chapter_range":
            lecture_id = str(data.get("lecture_id") or "").strip()
            book_id = str(data.get("book_id") or "").strip()
            content_range = data.get("content_range")
            if not lecture_id or not book_id:
                return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
            payload = _build_chapter_range_card_payload(lecture_id, book_id, content_range)
        else:
            return jsonify({"success": False, "error": f"unsupported card type: {card_type}"}), 400
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500
    return jsonify({"success": True, "card": payload})


@bp.route("/frontend/learning/select", methods=["POST"])
def frontend_select_learning_lecture():
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    if not lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required."}), 400

    lecture, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    selected = _as_bool(data.get("selected"), default=True)
    user_id = _resolve_runtime_user_id()
    user_store.ensure_user_files(_cfg, user_id)
    user_store.set_lecture_selection(
        _cfg,
        user_id,
        lecture_id,
        selected=selected,
        actor=str(data.get("actor") or "").strip(),
    )
    selected_ids = user_store.list_selected_lecture_ids(_cfg, user_id)
    return jsonify(
        {
            "success": True,
            "user_id": user_id,
            "lecture": lecture,
            "selected": bool(selected),
            "selected_lecture_ids": selected_ids,
        }
    )


@bp.route("/frontend/settings/refinement", methods=["GET"])
def frontend_settings_refinement():
    """设置页：待精读列表 + 队列状态。"""
    status = str(request.args.get("status") or "").strip()
    rows = list_refinement_candidates(_cfg, status=status)
    queue_snapshot = get_refinement_queue_snapshot()
    running_by_book: Dict[str, str] = {}
    running_count = 0
    for job in queue_snapshot.get("jobs", []) if isinstance(queue_snapshot.get("jobs"), list) else []:
        if not isinstance(job, dict):
            continue
        lecture_id = str(job.get("lecture_id") or "").strip()
        book_id = str(job.get("book_id") or "").strip()
        job_status = str(job.get("status") or "").strip().lower()
        job_type = str(job.get("job_type") or "").strip().lower()
        if job_status == "running":
            running_count += 1
        if lecture_id and book_id:
            suffix = f"::{job_type}" if job_type else ""
            running_by_book[f"{lecture_id}::{book_id}{suffix}"] = job_status
    queue_snapshot["running_count"] = int(running_count)
    items: List[Dict[str, Any]] = []
    for row in rows:
        lecture_id = str(row.get("lecture_id") or "").strip()
        lecture_title = str(row.get("lecture_title") or "").strip()
        book = row.get("book") if isinstance(row.get("book"), dict) else {}
        if not lecture_id or not book:
            continue
        book_id = str(book.get("id") or "").strip()
        refine_status = str(book.get("refinement_status") or "").strip().lower()
        coarse_status = str(book.get("coarse_status") or "").strip().lower()
        key = f"{lecture_id}::{book_id}"
        items.append(
            {
                "lecture_id": lecture_id,
                "lecture_title": lecture_title,
                "book_id": book_id,
                "book_title": str(book.get("title") or book_id),
                "refinement_status": str(book.get("refinement_status") or ""),
                "text_status": str(book.get("text_status") or ""),
                "coarse_status": str(book.get("coarse_status") or ""),
                "intensive_status": str(book.get("intensive_status") or ""),
                "question_status": str(book.get("question_status") or ""),
                "section_status": str(book.get("section_status") or ""),
                "coarse_model": str(book.get("coarse_model") or ""),
                "intensive_model": str(book.get("intensive_model") or ""),
                "question_model": str(book.get("question_model") or ""),
                "section_model": str(book.get("section_model") or ""),
                "coarse_error": str(book.get("coarse_error") or ""),
                "intensive_error": str(book.get("intensive_error") or ""),
                "question_error": str(book.get("question_error") or ""),
                "section_error": str(book.get("section_error") or ""),
                "refinement_error": str(book.get("refinement_error") or ""),
                "job_status": running_by_book.get(key, ""),
                "section_job_status": running_by_book.get(f"{key}::section", ""),
                "progress_text": get_book_progress_text(lecture_id, book_id),
                "progress_steps": get_book_progress_steps(lecture_id, book_id),
                "updated_at": int(book.get("updated_at") or 0),
            }
        )
    return jsonify(
        {
            "success": True,
            "status_filter": status,
            "queue": queue_snapshot,
            "items": items,
            "total": len(items),
        }
    )


@bp.route("/frontend/settings/refinement/start", methods=["POST"])
def frontend_settings_refinement_start():
    """设置页：手动触发教材精读。"""
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can start refinement."}), 403
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    actor = str(data.get("actor") or _resolve_runtime_user_id()).strip()
    force = _as_bool(data.get("force"), default=False)
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
    result = enqueue_book_refinement(_cfg, lecture_id, book_id, actor=actor, force=force)
    return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, **result}), 202


@bp.route("/frontend/settings/refinement/intensive", methods=["POST"])
def frontend_settings_refinement_intensive():
    """设置页：手动触发教材精读（输出写入 bookdetail.xml）。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    actor = str(data.get("actor") or _resolve_runtime_user_id()).strip()
    model_name = str(data.get("model_name") or "").strip()
    log_event(
        "frontend_intensive_request",
        "收到前端精读请求",
        payload={
            "lecture_id": lecture_id,
            "book_id": book_id,
            "actor": actor,
            "model_name": model_name,
            "is_admin": bool(_is_runtime_admin()),
        },
    )
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can start intensive reading."}), 403
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
    try:
        result = enqueue_book_intensive(_cfg, lecture_id, book_id, actor=actor, model_name=model_name)
        return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, **result}), 202
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@bp.route("/frontend/settings/refinement/question", methods=["POST"])
def frontend_settings_refinement_question():
    """设置页：手动触发教材出题（输出写入 questions.xml）。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    actor = str(data.get("actor") or _resolve_runtime_user_id()).strip()
    model_name = str(data.get("model_name") or "").strip()
    log_event(
        "frontend_question_request",
        "收到前端出题请求",
        payload={
            "lecture_id": lecture_id,
            "book_id": book_id,
            "actor": actor,
            "model_name": model_name,
            "is_admin": bool(_is_runtime_admin()),
        },
    )
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can start question generation."}), 403
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
    try:
        result = enqueue_book_question(_cfg, lecture_id, book_id, actor=actor, model_name=model_name)
        return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, **result}), 202
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@bp.route("/frontend/settings/refinement/section", methods=["POST"])
def frontend_settings_refinement_section():
    """设置页：手动触发教材分节（输出写入 sections.xml）。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    actor = str(data.get("actor") or _resolve_runtime_user_id()).strip()
    model_name = str(data.get("model_name") or "").strip()
    log_event(
        "frontend_section_request",
        "收到前端分节请求",
        payload={
            "lecture_id": lecture_id,
            "book_id": book_id,
            "actor": actor,
            "model_name": model_name,
            "is_admin": bool(_is_runtime_admin()),
        },
    )
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can start section generation."}), 403
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
    try:
        result = enqueue_book_section(_cfg, lecture_id, book_id, actor=actor, model_name=model_name)
        return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, **result}), 202
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@bp.route("/frontend/settings/refinement/stop", methods=["POST"])
def frontend_settings_refinement_stop():
    """设置页：停止教材精读并重置状态。"""
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can stop refinement."}), 403
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    actor = str(data.get("actor") or _resolve_runtime_user_id()).strip()
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
    result = cancel_book_refinement(_cfg, lecture_id, book_id, actor=actor)
    return jsonify({"success": True, **result}), 200


@bp.route("/frontend/settings/models", methods=["GET"])
def frontend_settings_models():
    """设置页：读取模型选项与当前模型设置。"""
    username = _resolve_runtime_user_id()
    listed = _list_nexora_models_payload(username)
    options = _extract_model_options(listed.get("payload") if isinstance(listed.get("payload"), dict) else {})
    options.sort(key=lambda row: row.get("id", ""))
    rough = get_rough_reading_settings(_cfg)
    default_model = get_default_nexora_model(_cfg)
    return jsonify(
        {
            "success": True,
            "is_admin": _is_runtime_admin(),
            "available_models": options,
            "available_count": len(options),
            "models_fetch_success": bool(listed.get("success")),
            "models_fetch_message": str(listed.get("message") or ""),
            "settings": {
                "default_nexora_model": default_model,
                "rough_reading": rough,
                "intensive_reading": get_intensive_reading_settings(_cfg),
                "split_chapters": get_split_chapters_settings(_cfg),
                "memory": get_memory_settings(_cfg),
                "profile_question": get_profile_question_settings(_cfg),
            },
        }
    )


@bp.route("/frontend/settings/models", methods=["PATCH"])
def frontend_settings_models_patch():
    """设置页：更新默认模型与粗读模型。"""
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can update model settings."}), 403
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"success": False, "error": "JSON body is required."}), 400
    default_model = data.get("default_nexora_model")
    rough_updates = data.get("rough_reading")
    intensive_updates = data.get("intensive_reading")
    split_chapters_updates = data.get("split_chapters")
    memory_updates = data.get("memory")
    profile_question_updates = data.get("profile_question")
    listed = _list_nexora_models_payload(_resolve_runtime_user_id())
    available_ids = {row.get("id", "") for row in _extract_model_options(listed.get("payload") if isinstance(listed.get("payload"), dict) else {})}
    updated_default = get_default_nexora_model(_cfg)
    updated_rough = get_rough_reading_settings(_cfg)
    updated_intensive = get_intensive_reading_settings(_cfg)
    updated_split_chapters = get_split_chapters_settings(_cfg)
    updated_memory = get_memory_settings(_cfg)
    updated_profile_question = get_profile_question_settings(_cfg)
    if default_model is not None:
        normalized_default = str(default_model or "").strip()
        if normalized_default and normalized_default not in available_ids:
            return jsonify({"success": False, "error": "default_nexora_model is not in available models."}), 400
        updated_default = update_default_nexora_model(_cfg, normalized_default)
    if isinstance(rough_updates, dict):
        rough_model_name = str(rough_updates.get("model_name") or "").strip()
        if rough_model_name and rough_model_name not in available_ids:
            return jsonify({"success": False, "error": "rough_reading.model_name is not in available models."}), 400
        updated_rough = update_rough_reading_settings(_cfg, rough_updates)
    if isinstance(intensive_updates, dict):
        intensive_model_name = str(intensive_updates.get("model_name") or "").strip()
        if intensive_model_name and intensive_model_name not in available_ids:
            return jsonify({"success": False, "error": "intensive_reading.model_name is not in available models."}), 400
        updated_intensive = update_intensive_reading_settings(_cfg, intensive_updates)
    if isinstance(split_chapters_updates, dict):
        split_model_name = str(split_chapters_updates.get("model_name") or "").strip()
        if split_model_name and split_model_name not in available_ids:
            return jsonify({"success": False, "error": "split_chapters.model_name is not in available models."}), 400
        updated_split_chapters = update_split_chapters_settings(_cfg, split_chapters_updates)
    if isinstance(memory_updates, dict):
        memory_model_name = str(memory_updates.get("model_name") or "").strip()
        if memory_model_name and memory_model_name not in available_ids:
            return jsonify({"success": False, "error": "memory.model_name is not in available models."}), 400
        updated_memory = update_memory_settings(_cfg, memory_updates)
    if isinstance(profile_question_updates, dict):
        profile_question_model_name = str(profile_question_updates.get("model_name") or "").strip()
        if profile_question_model_name and profile_question_model_name not in available_ids:
            return jsonify({"success": False, "error": "profile_question.model_name is not in available models."}), 400
        updated_profile_question = update_profile_question_settings(_cfg, profile_question_updates)
    return jsonify(
        {
            "success": True,
            "settings": {
                "default_nexora_model": updated_default,
                "rough_reading": updated_rough,
                "intensive_reading": updated_intensive,
                "split_chapters": updated_split_chapters,
                "memory": updated_memory,
                "profile_question": updated_profile_question,
            },
        }
    )


@bp.route("/nexora/models", methods=["GET"])
@bp.route("/nexora/model_list", methods=["GET"])
def list_nexora_models():
    if _proxy is None:
        return jsonify({"success": False, "error": "Nexora proxy not initialized."}), 503

    username = str(request.args.get("username") or "").strip() or None
    result = _proxy.list_models(username=username)
    status_code = 200 if result.get("success") else 502
    return jsonify(result), status_code


@bp.route("/nexora/papi/completions", methods=["POST"])
@bp.route("/nexora/papi/chat/completions", methods=["POST"])
def nexora_papi_completions():
    if _proxy is None:
        return jsonify({"success": False, "error": "Nexora proxy not initialized."}), 503

    data = request.get_json(silent=True) or {}
    messages = data.get("messages")
    if not isinstance(messages, list) or not messages:
        return jsonify({"success": False, "error": "messages is required."}), 400

    result = _proxy.chat_completions(
        messages=list(messages),
        model=str(data.get("model") or "").strip() or None,
        username=str(data.get("username") or "").strip() or None,
        options=_extract_nexora_options(data),
    )
    if not result.get("ok"):
        return jsonify({"success": False, "error": result.get("message") or "Nexora upstream failed."}), int(result.get("status") or 502)

    payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
    return jsonify(
        {
            "success": True,
            "api_mode": "chat",
            "endpoint": result.get("endpoint"),
            "content": _proxy.extract_output_text(payload),
            "raw": payload,
        }
    )


@bp.route("/nexora/papi/responses", methods=["POST"])
def nexora_papi_responses():
    if _proxy is None:
        return jsonify({"success": False, "error": "Nexora proxy not initialized."}), 503

    data = request.get_json(silent=True) or {}
    input_items = data.get("input")
    if not isinstance(input_items, list) or not input_items:
        return jsonify({"success": False, "error": "input is required for responses mode."}), 400

    result = _proxy.responses(
        model=str(data.get("model") or "").strip() or None,
        username=str(data.get("username") or "").strip() or None,
        input_items=list(input_items),
        instructions=str(data.get("instructions") or "").strip(),
        options=_extract_nexora_options(data),
    )
    if not result.get("ok"):
        return jsonify({"success": False, "error": result.get("message") or "Nexora upstream failed."}), int(result.get("status") or 502)

    payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
    return jsonify(
        {
            "success": True,
            "api_mode": "responses",
            "endpoint": result.get("endpoint"),
            "content": _proxy.extract_output_text(payload),
            "raw": payload,
        }
    )


@bp.route("/completions", methods=["POST"])
def completions():
    if _proxy is None:
        return jsonify({"success": False, "error": "Nexora proxy not initialized."}), 503

    data = request.get_json(silent=True) or {}
    model_type = str(data.get("model_type") or "").strip()
    system_prompt = str(data.get("system_prompt") or "").strip()
    prompt = str(data.get("prompt") or data.get("message") or "").strip()
    model = str(data.get("model") or "").strip() or None
    username = str(data.get("username") or "").strip() or None
    api_mode = str(data.get("api_mode") or data.get("backend_mode") or "chat").strip().lower()
    instructions = str(data.get("instructions") or "").strip()
    context_payload = data.get("context_payload") or {}
    extra_prompt_vars = data.get("extra_prompt_vars") or {}
    raw_messages = data.get("messages")
    raw_input_items = data.get("input")
    messages = raw_messages if isinstance(raw_messages, list) else None
    input_items = raw_input_items if isinstance(raw_input_items, list) else None

    request_options = _extract_nexora_options(data)

    if api_mode not in {"chat", "responses", "auto"}:
        return jsonify({"success": False, "error": "api_mode must be one of: chat, responses, auto."}), 400

    if not prompt and not messages and not input_items and not model_type:
        return jsonify({"success": False, "error": "prompt/messages/input is required."}), 400

    try:
        if model_type:
            if not prompt:
                return jsonify({"success": False, "error": "prompt is required for model_type."}), 400
            runner = LearningModelFactory.create(model_type, _cfg, model_name=model)
            safe_context_payload = context_payload if isinstance(context_payload, dict) else {}
            safe_extra_prompt_vars = extra_prompt_vars if isinstance(extra_prompt_vars, dict) else {}
            log_event(
                "model_context_input",
                "模型上下文输入（model_type）",
                payload={
                    "model_type": model_type,
                    "model": model or "",
                    "username": username or "",
                },
                content=json.dumps(
                    {
                        "prompt": prompt,
                        "context_payload": safe_context_payload,
                        "extra_prompt_vars": safe_extra_prompt_vars,
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
            )
            content = runner.run(
                prompt,
                context_payload=safe_context_payload,
                extra_prompt_vars=safe_extra_prompt_vars,
                username=username,
            )
            log_event(
                "model_output",
                "模型输出（model_type）",
                payload={
                    "model_type": model_type,
                    "model": model or "",
                    "username": username or "",
                },
                content=content[:12000],
            )
            preview = runner.preview_prompts(
                prompt,
                context_payload=safe_context_payload,
                extra_prompt_vars=safe_extra_prompt_vars,
            )
            return jsonify({
                "success": True,
                "content": content,
                "model": model,
                "model_type": model_type,
                "username": username,
                "resolved_prompts": preview,
            })

        if messages or input_items:
            log_event(
                "model_context_input",
                "模型上下文输入（raw messages/input）",
                payload={
                    "model_type": "",
                    "model": model or "",
                    "username": username or "",
                    "api_mode": api_mode,
                },
                content=json.dumps(
                    {"messages": messages or [], "input": input_items or [], "instructions": instructions},
                    ensure_ascii=False,
                    indent=2,
                )[:12000],
            )
            result = _proxy.complete_raw(
                messages=list(messages or []),
                model=model,
                username=username,
                api_mode=api_mode,
                input_items=list(input_items or []),
                instructions=instructions or system_prompt,
                options=request_options,
            )
            if not result.get("success"):
                return jsonify(
                    {
                        "success": False,
                        "error": result.get("message") or "Nexora upstream failed.",
                        "api_mode": api_mode,
                        "model": model,
                        "username": username,
                    }
                ), 502
            log_event(
                "model_output",
                "模型输出（raw messages/input）",
                payload={
                    "model": model or "",
                    "username": username or "",
                    "api_mode": result.get("api_mode") or api_mode,
                },
                content=str(result.get("content") or "")[:12000],
            )
            return jsonify(
                {
                    "success": True,
                    "content": str(result.get("content") or ""),
                    "model": model,
                    "model_type": None,
                    "username": username,
                    "api_mode": result.get("api_mode"),
                    "endpoint": result.get("endpoint"),
                    "raw": result.get("payload"),
                }
            )

        log_event(
            "model_context_input",
            "模型上下文输入（chat prompt）",
            payload={
                "model_type": model_type or "",
                "model": model or "",
                "username": username or "",
                "api_mode": "chat",
            },
            content=json.dumps({"system_prompt": system_prompt, "prompt": prompt}, ensure_ascii=False, indent=2)[:12000],
        )
        content = _proxy.chat_complete(system_prompt=system_prompt, user_prompt=prompt, model=model, username=username)
        log_event(
            "model_output",
            "模型输出（chat prompt）",
            payload={"model": model or "", "username": username or "", "api_mode": "chat"},
            content=content[:12000],
        )
        return jsonify({
            "success": True,
            "content": content,
            "model": model,
            "model_type": model_type or None,
            "username": username,
            "api_mode": "chat",
        })
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@bp.route("/models/rough-reading", methods=["GET"])
def get_rough_reading_model_settings():
    settings = get_rough_reading_settings(_cfg)
    return jsonify({"success": True, "model_type": "coarse_reading", "settings": settings})


@bp.route("/models/rough-reading", methods=["PATCH"])
def patch_rough_reading_model_settings():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"success": False, "error": "JSON body is required."}), 400
    settings = update_rough_reading_settings(_cfg, data)
    return jsonify({"success": True, "model_type": "coarse_reading", "settings": settings})


@bp.route("/courses", methods=["GET"])
def list_courses():
    courses = storage.list_courses(_cfg)
    return jsonify({"success": True, "courses": courses, "total": len(courses)})


@bp.route("/courses", methods=["POST"])
def create_course():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "error": "name is required."}), 400

    course = storage.create_course(
        _cfg,
        name,
        str(data.get("description") or "").strip(),
    )
    return jsonify({"success": True, "course": course}), 201


@bp.route("/courses/<course_id>", methods=["GET"])
def get_course(course_id: str):
    meta = storage.get_course(_cfg, course_id)
    if not meta:
        return jsonify({"success": False, "error": "Course not found."}), 404

    materials = storage.list_materials(_cfg, course_id)
    stats = vector_collection_stats(_cfg, course_id)
    return jsonify({
        "success": True,
        "course": meta,
        "materials": materials,
        "vector_stats": stats,
    })


@bp.route("/courses/<course_id>", methods=["PATCH"])
def update_course(course_id: str):
    data = request.get_json(silent=True) or {}
    allowed_fields = {"name", "description", "status"}
    updates = {key: value for key, value in data.items() if key in allowed_fields}
    if not updates:
        return jsonify({"success": False, "error": "No valid course fields provided."}), 400

    result = storage.update_course_meta(_cfg, course_id, updates)
    if result is None:
        return jsonify({"success": False, "error": "Course not found."}), 404
    return jsonify({"success": True, "course": result})


@bp.route("/courses/<course_id>", methods=["DELETE"])
def delete_course(course_id: str):
    if not storage.get_course(_cfg, course_id):
        return jsonify({"success": False, "error": "Course not found."}), 404

    vector_delete_course_collection(_cfg, course_id)
    storage.delete_course(_cfg, course_id)
    return jsonify({"success": True, "message": f"Course {course_id} deleted."})


@bp.route("/courses/<course_id>/materials", methods=["GET"])
def list_materials(course_id: str):
    if not storage.get_course(_cfg, course_id):
        return jsonify({"success": False, "error": "Course not found."}), 404

    materials = storage.list_materials(_cfg, course_id)
    return jsonify({"success": True, "materials": materials, "total": len(materials)})


@bp.route("/courses/<course_id>/materials", methods=["POST"])
def upload_material(course_id: str):
    if not storage.get_course(_cfg, course_id):
        return jsonify({"success": False, "error": "Course not found."}), 404

    if "file" not in request.files:
        return jsonify({"success": False, "error": "file is required."}), 400

    upload = request.files["file"]
    if not upload.filename:
        return jsonify({"success": False, "error": "filename is required."}), 400
    if not _allowed(upload.filename):
        return jsonify({"success": False, "error": f"Unsupported extension. Allowed: {sorted(ALLOWED_EXT)}"}), 400

    max_mb = int(_cfg.get("max_upload_mb") or 50)
    content = upload.read()
    if len(content) > max_mb * 1024 * 1024:
        return jsonify({"success": False, "error": f"file exceeds {max_mb}MB"}), 413

    safe_name = secure_filename(upload.filename)
    material = storage.create_material(_cfg, course_id, safe_name, len(content), "")

    from core.storage import _material_dir

    original_dir = _material_dir(_cfg, course_id, material["id"]) / "original"
    original_dir.mkdir(parents=True, exist_ok=True)
    saved_path = str(original_dir / safe_name)
    with open(saved_path, "wb") as output:
        output.write(content)

    storage.update_material_meta(_cfg, course_id, material["id"], {"saved_path": saved_path})
    material["saved_path"] = saved_path

    threading.Thread(
        target=_parse_and_store,
        args=(_cfg, course_id, material["id"], saved_path, safe_name),
        daemon=True,
    ).start()

    return jsonify({"success": True, "material": material}), 201


@bp.route("/courses/<course_id>/materials/<material_id>", methods=["DELETE"])
def delete_material(course_id: str, material_id: str):
    if not storage.get_course(_cfg, course_id):
        return jsonify({"success": False, "error": "Course not found."}), 404
    if not storage.get_material(_cfg, course_id, material_id):
        return jsonify({"success": False, "error": "Material not found."}), 404

    try:
        vector_delete_material_chunks(_cfg, course_id, material_id)
    except Exception:
        pass

    storage.delete_material(_cfg, course_id, material_id)
    return jsonify({"success": True, "message": f"Material {material_id} deleted."})


@bp.route("/courses/<course_id>/materials/<material_id>/ingest", methods=["POST"])
def ingest_material(course_id: str, material_id: str):
    material = storage.get_material(_cfg, course_id, material_id)
    if not material:
        return jsonify({"success": False, "error": "Material not found."}), 404

    chunks = storage.load_chunks(_cfg, course_id, material_id)
    if not chunks:
        return jsonify({"success": False, "error": "No parsed chunks available."}), 400

    threading.Thread(
        target=_ingest_chunks,
        args=(_cfg, course_id, material_id, chunks, material.get("filename", "")),
        daemon=True,
    ).start()

    return jsonify({
        "success": True,
        "message": "Vector ingestion started.",
        "chunks_count": len(chunks),
    })


@bp.route("/courses/<course_id>/query", methods=["GET"])
def query_course(course_id: str):
    if not storage.get_course(_cfg, course_id):
        return jsonify({"success": False, "error": "Course not found."}), 404

    query_text = str(request.args.get("q") or "").strip()
    if not query_text:
        return jsonify({"success": False, "error": "q is required."}), 400

    top_k = min(int(request.args.get("top_k") or 5), 20)
    results = vector_query(_cfg, course_id, query_text, top_k=top_k)
    return jsonify({"success": True, "results": results, "count": len(results)})


@bp.route("/courses/<course_id>/stats", methods=["GET"])
def course_stats(course_id: str):
    meta = storage.get_course(_cfg, course_id)
    if not meta:
        return jsonify({"success": False, "error": "Course not found."}), 404

    stats = vector_collection_stats(_cfg, course_id)
    materials = storage.list_materials(_cfg, course_id)
    return jsonify({
        "success": True,
        "course": meta,
        "materials_count": len(materials),
        "vector_stats": stats,
    })


@bp.route("/lectures", methods=["GET"])
def list_lectures():
    lectures = list_learning_lectures(_cfg)
    return jsonify({"success": True, "lectures": lectures, "total": len(lectures)})


@bp.route("/lectures", methods=["POST"])
def create_lecture():
    data = request.get_json(silent=True) or {}
    title = str(data.get("title") or "").strip()
    if not title:
        return jsonify({"success": False, "error": "title is required."}), 400

    lecture = create_learning_lecture(
        _cfg,
        title,
        description=str(data.get("description") or "").strip(),
        category=str(data.get("category") or "").strip(),
        status=str(data.get("status") or "draft").strip() or "draft",
    )
    return jsonify({"success": True, "lecture": lecture}), 201


@bp.route("/lectures/<lecture_id>", methods=["GET"])
def get_lecture(lecture_id: str):
    lecture, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    books = list_lecture_books(_cfg, lecture_id)
    return jsonify({
        "success": True,
        "lecture": lecture,
        "books": books,
        "total_books": len(books),
    })


@bp.route("/lectures/<lecture_id>", methods=["PATCH"])
def update_lecture(lecture_id: str):
    lecture, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    data = request.get_json(silent=True) or {}
    allowed_fields = {"title", "description", "category", "status"}
    updates = {key: value for key, value in data.items() if key in allowed_fields}
    if not updates:
        return jsonify({"success": False, "error": "No valid lecture fields provided."}), 400

    updated = update_learning_lecture(_cfg, lecture_id, updates) or lecture
    return jsonify({"success": True, "lecture": updated})


@bp.route("/lectures/<lecture_id>", methods=["DELETE"])
def delete_lecture(lecture_id: str):
    lecture, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    delete_learning_lecture(_cfg, lecture_id)
    return jsonify({"success": True, "lecture": lecture})


@bp.route("/lectures/<lecture_id>/books", methods=["GET"])
def list_books(lecture_id: str):
    _, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    books = list_lecture_books(_cfg, lecture_id)
    return jsonify({"success": True, "books": books, "total": len(books)})


@bp.route("/lectures/<lecture_id>/books", methods=["POST"])
def create_book(lecture_id: str):
    _, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    data = request.get_json(silent=True) or {}
    title = str(data.get("title") or "").strip()
    if not title:
        return jsonify({"success": False, "error": "title is required."}), 400

    book = create_lecture_book(
        _cfg,
        lecture_id,
        title,
        description=str(data.get("description") or "").strip(),
        source_type=str(data.get("source_type") or "text").strip() or "text",
        cover_path=str(data.get("cover_path") or "").strip(),
    )
    return jsonify({"success": True, "book": book}), 201


@bp.route("/lectures/<lecture_id>/books/<book_id>", methods=["GET"])
def get_book(lecture_id: str, book_id: str):
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    return jsonify({"success": True, "book": book})


@bp.route("/lectures/<lecture_id>/books/<book_id>", methods=["PATCH"])
def update_book(lecture_id: str, book_id: str):
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    data = request.get_json(silent=True) or {}
    allowed_fields = {
        "title",
        "description",
        "source_type",
        "cover_path",
        "status",
    }
    updates = {key: value for key, value in data.items() if key in allowed_fields}
    if not updates:
        return jsonify({"success": False, "error": "No valid book fields provided."}), 400

    updated = update_lecture_book(_cfg, lecture_id, book_id, updates) or book
    return jsonify({"success": True, "book": updated})


@bp.route("/lectures/<lecture_id>/books/<book_id>", methods=["DELETE"])
def delete_book(lecture_id: str, book_id: str):
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    delete_lecture_book(_cfg, lecture_id, book_id)
    return jsonify({"success": True, "book": book})


@bp.route("/lectures/<lecture_id>/books/<book_id>/text", methods=["GET"])
def get_book_text(lecture_id: str, book_id: str):
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    content = load_book_text(_cfg, lecture_id, book_id)
    images = load_book_images_meta(_cfg, lecture_id, book_id)
    return jsonify({
        "success": True,
        "book": book,
        "content": content,
        "chars": len(content),
        "images": images,
    })


@bp.route("/lectures/<lecture_id>/books/<book_id>/images/<image_id>", methods=["GET"])
def get_book_image(lecture_id: str, book_id: str, image_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    image_path = get_book_image_path(_cfg, lecture_id, book_id, image_id)
    if image_path is None or not image_path.exists():
        return jsonify({"success": False, "error": "image not found."}), 404
    return send_file(str(image_path))


@bp.route("/books/refinement/list", methods=["GET"])
@bp.route("/books/extract/list", methods=["GET"])
def list_books_for_refinement_all():
    status = str(request.args.get("status") or "").strip()
    rows = list_refinement_candidates(_cfg, status=status)
    return jsonify({"success": True, "items": rows, "total": len(rows)})


@bp.route("/lectures/<lecture_id>/books/refinement/list", methods=["GET"])
@bp.route("/lectures/<lecture_id>/books/extract/list", methods=["GET"])
def list_books_for_refinement_lecture(lecture_id: str):
    status = str(request.args.get("status") or "").strip()
    rows = list_refinement_candidates(_cfg, lecture_id=lecture_id, status=status)
    return jsonify({"success": True, "lecture_id": lecture_id, "items": rows, "total": len(rows)})


@bp.route("/refinement/queue", methods=["GET"])
@bp.route("/extract/queue", methods=["GET"])
def get_refinement_queue():
    return jsonify({"success": True, **get_refinement_queue_snapshot()})


@bp.route("/lectures/<lecture_id>/books/refinement", methods=["POST"])
@bp.route("/lectures/<lecture_id>/books/extract", methods=["POST"])
def enqueue_lecture_books_refinement(lecture_id: str):
    data = request.get_json(silent=True) or {}
    book_ids = data.get("book_ids")
    if not isinstance(book_ids, list) or not book_ids:
        return jsonify({"success": False, "error": "book_ids(list) is required."}), 400
    actor = str(data.get("actor") or "").strip()
    force = _as_bool(data.get("force"), default=False)

    queued: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    for raw_id in book_ids:
        book_id = str(raw_id or "").strip()
        if not book_id:
            continue
        try:
            result = enqueue_book_refinement(_cfg, lecture_id, book_id, actor=actor, force=force)
            queued.append({"book_id": book_id, **result})
        except Exception as exc:
            errors.append({"book_id": book_id, "error": str(exc)})

    return jsonify(
        {
            "success": True,
            "lecture_id": lecture_id,
            "queued_count": len(queued),
            "error_count": len(errors),
            "queued": queued,
            "errors": errors,
        }
    )


@bp.route("/lectures/<lecture_id>/books/<book_id>/refinement", methods=["POST"])
@bp.route("/lectures/<lecture_id>/books/<book_id>/extract", methods=["POST"])
def enqueue_single_book_refinement(lecture_id: str, book_id: str):
    data = request.get_json(silent=True) or {}
    actor = str(data.get("actor") or "").strip()
    force = _as_bool(data.get("force"), default=False)
    result = enqueue_book_refinement(_cfg, lecture_id, book_id, actor=actor, force=force)
    return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, **result}), 202


@bp.route("/lectures/<lecture_id>/books/<book_id>/file", methods=["POST"])
def upload_book_file(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    upload = request.files.get("file")
    if upload is None:
        return jsonify({"success": False, "error": "file is required."}), 400
    filename_raw = str(upload.filename or "").strip()
    if not filename_raw:
        return jsonify({"success": False, "error": "filename is required."}), 400
    if not _allowed(filename_raw):
        return jsonify({"success": False, "error": f"Unsupported extension. Allowed: {sorted(ALLOWED_EXT)}"}), 400

    max_mb = int(_cfg.get("max_upload_mb") or 50)
    content = upload.read()
    if len(content) > max_mb * 1024 * 1024:
        return jsonify({"success": False, "error": f"file exceeds {max_mb}MB"}), 413

    safe_name = secure_filename(filename_raw) or "content.bin"
    try:
        save_book_original_file(
            _cfg,
            lecture_id,
            book_id,
            content,
            filename=safe_name,
        )
        saved = mark_book_uploaded(
            _cfg,
            lecture_id,
            book_id,
            filename=safe_name,
            file_size=len(content),
            actor=str(request.headers.get("X-User") or request.headers.get("X-Username") or ""),
        )
        return jsonify(
            {
                "success": True,
                "book": saved,
                "message": "File uploaded. Refinement is not started automatically.",
            }
        ), 201
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@bp.route("/lectures/<lecture_id>/books/<book_id>/parse", methods=["POST"])
def parse_book_file(lecture_id: str, book_id: str):
    """手动解析教材原文件为纯文本，并写入教材存储。"""
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    original_path = str((book or {}).get("original_path") or "").strip()
    if not original_path:
        return jsonify({"success": False, "error": "book has no original file."}), 400

    source = Path(original_path)
    if not source.exists():
        return jsonify({"success": False, "error": "original file not found."}), 404

    filename = str((book or {}).get("original_filename") or source.name or "content.txt").strip() or "content.txt"
    try:
        parsed_text = ""
        saved_images = []
        if source.suffix.lower() == ".epub":
            images_dir = Path(str(_cfg.get("data_dir") or "data")) / "lectures" / lecture_id / "books" / book_id / "assets" / "images"
            epub_result = extract_epub_with_assets(
                str(source),
                lecture_id=lecture_id,
                book_id=book_id,
                assets_dir=images_dir,
            )
            parsed_text = str(epub_result.get("text") or "")
            saved_images = save_book_images_meta(_cfg, lecture_id, book_id, epub_result.get("images") or [])
        else:
            parsed_text = extract_text(str(source))
        if not str(parsed_text or "").strip():
            updated = update_lecture_book(
                _cfg,
                lecture_id,
                book_id,
                {
                    "text_status": "error",
                    "error": "parsed text is empty",
                },
            ) or book
            return jsonify({"success": False, "error": "parsed text is empty", "book": updated}), 422

        saved = save_book_text(_cfg, lecture_id, book_id, str(parsed_text), filename=filename)
        log_event(
            "book_parse_done",
            "教材文本解析完成",
            payload={
                "lecture_id": lecture_id,
                "book_id": book_id,
                "filename": filename,
                "chars": len(str(parsed_text)),
                "images_count": len(saved_images),
            },
        )
        return jsonify(
            {
                "success": True,
                "lecture_id": lecture_id,
                "book_id": book_id,
                "chars": len(str(parsed_text)),
                "images": saved_images,
                "book": saved,
            }
        ), 200
    except Exception as exc:
        updated = update_lecture_book(
            _cfg,
            lecture_id,
            book_id,
            {
                "text_status": "error",
                "error": str(exc),
            },
        ) or book
        return jsonify({"success": False, "error": str(exc), "book": updated}), 500


@bp.route("/lectures/<lecture_id>/books/<book_id>/text", methods=["POST"])
def upload_book_text(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    data = request.get_json(silent=True) or {}
    content = str(data.get("content") or "")
    if not content.strip():
        return jsonify({"success": False, "error": "content is required."}), 400

    filename = secure_filename(str(data.get("filename") or "content.txt").strip()) or "content.txt"
    auto_vectorize = _as_bool(data.get("auto_vectorize"), default=True)

    saved = save_book_text(_cfg, lecture_id, book_id, content, filename=filename)

    vectorization_result = None
    if auto_vectorize:
        vectorization_result = queue_vectorize_book(_cfg, lecture_id, book_id, force=True)

    return jsonify({
        "success": True,
        "book": saved,
        "vectorization": vectorization_result,
    }), 201


@bp.route("/lectures/<lecture_id>/books/<book_id>/bookinfo", methods=["GET"])
def get_book_info_xml(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    content = load_book_info_xml(_cfg, lecture_id, book_id)
    return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, "content": content})


@bp.route("/lectures/<lecture_id>/books/<book_id>/bookinfo", methods=["POST"])
def set_book_info_xml(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    data = request.get_json(silent=True) or {}
    content = str(data.get("content") or "")
    path = save_book_info_xml(_cfg, lecture_id, book_id, content)
    return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, "path": path})


@bp.route("/lectures/<lecture_id>/books/<book_id>/bookdetail", methods=["GET"])
def get_book_detail_xml(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    content = load_book_detail_xml(_cfg, lecture_id, book_id)
    return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, "content": content})


@bp.route("/lectures/<lecture_id>/books/<book_id>/bookdetail", methods=["POST"])
def set_book_detail_xml(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    data = request.get_json(silent=True) or {}
    content = str(data.get("content") or "")
    path = save_book_detail_xml(_cfg, lecture_id, book_id, content)
    return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, "path": path})


@bp.route("/lectures/<lecture_id>/books/<book_id>/vectorize", methods=["GET"])
def get_book_vectorize_status(lecture_id: str, book_id: str):
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    return jsonify({
        "success": True,
        "book_id": book_id,
        "vector_status": book.get("vector_status"),
        "vector_provider": book.get("vector_provider"),
        "chunks_count": book.get("chunks_count"),
        "vector_count": book.get("vector_count"),
        "request_path": book.get("vector_request_path") or "",
        "error": book.get("error") or "",
    })


@bp.route("/lectures/<lecture_id>/books/<book_id>/vectorize", methods=["POST"])
def trigger_book_vectorize(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    data = request.get_json(silent=True) or {}
    force = _as_bool(data.get("force"), default=False)
    async_mode = _as_bool(data.get("async"), default=True)

    if async_mode:
        result = queue_vectorize_book(_cfg, lecture_id, book_id, force=force)
        return jsonify({"success": True, "vectorization": result}), 202

    result = vectorize_book(_cfg, lecture_id, book_id, force=force)
    return jsonify({"success": True, "vectorization": result})


def _parse_and_store(cfg: Dict[str, Any], course_id: str, material_id: str, file_path: str, filename: str) -> None:
    try:
        storage.update_material_meta(cfg, course_id, material_id, {"parse_status": "parsing"})
        text = extract_text(file_path)
        chunks = split_text_for_vector(cfg, text)
        chunk_count = storage.save_chunks(cfg, course_id, material_id, chunks)
        storage.update_material_meta(
            cfg,
            course_id,
            material_id,
            {
                "parse_status": "done",
                "chunks_count": chunk_count,
            },
        )
        _ingest_chunks(cfg, course_id, material_id, chunks, filename)
    except Exception as exc:
        storage.update_material_meta(
            cfg,
            course_id,
            material_id,
            {
                "parse_status": "error",
                "error": str(exc),
            },
        )


def _ingest_chunks(cfg: Dict[str, Any], course_id: str, material_id: str, chunks, title: str) -> None:
    try:
        storage.update_material_meta(cfg, course_id, material_id, {"ingest_status": "ingesting"})
        vector_count = vector_upsert_chunks(cfg, course_id, material_id, chunks, title)
        storage.update_material_meta(
            cfg,
            course_id,
            material_id,
            {
                "ingest_status": "done",
                "vector_count": vector_count,
            },
        )
        storage.update_course_meta(cfg, course_id, {"status": "ready"})
    except Exception as exc:
        storage.update_material_meta(
            cfg,
            course_id,
            material_id,
            {
                "ingest_status": "error",
                "error": str(exc),
            },
        )


_RUNTIME_READONLY_TOOL_NAMES = {
    "listLectures",
    "getLecture",
    "listBooks",
    "getBook",
    "getBookText",
    "readBookTextRange",
    "searchBookText",
    "getBookInfoXml",
    "getBookDetailXml",
    "getBookQuestionsXml",
    "vectorSearch",
    "learning_card",
    "question",
    "read_learning_memory",
    "append_learning_memory",
    "update_learning_memory",
    "write_learning_memory",
}


def _runtime_question_tool_spec() -> Dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": "question",
            "description": "Ask the user a structured question and wait for an explicit response before continuing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "question_id": {"type": "string"},
                    "question_title": {"type": "string"},
                    "question_content": {"type": "string"},
                    "choices": {"type": "array", "items": {"type": "string"}},
                    "allow_other": {"type": "boolean"},
                },
                "required": ["question_title", "question_content"],
            },
        },
    }


def _runtime_learning_card_tool_spec() -> Dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": "learning_card",
            "description": "Render a learning card for a lecture overview or chapter range.",
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": ["lecture_display", "chapter_range"]},
                    "lecture_id": {"type": "string"},
                    "book_id": {"type": "string"},
                    "content_range": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "minItems": 2,
                        "maxItems": 2,
                    },
                },
                "required": ["type", "lecture_id"],
            },
        },
    }


def _runtime_memory_tool_spec(
    name: str,
    description: str,
    required: List[str],
    properties: Dict[str, Any],
) -> Dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
            },
        },
    }


def _runtime_tool_specs() -> List[Dict[str, Any]]:
    names = set()
    rows: List[Dict[str, Any]] = []
    for tool in list(LEARNING_TOOLS or []):
        if not isinstance(tool, dict) or str(tool.get("type") or "").strip() != "function":
            continue
        fn = tool.get("function") if isinstance(tool.get("function"), dict) else {}
        name = str(fn.get("name") or "").strip()
        if not name or name not in _RUNTIME_READONLY_TOOL_NAMES or name in names:
            continue
        rows.append(json.loads(json.dumps(tool, ensure_ascii=False)))
        names.add(name)
    if "learning_card" not in names:
        rows.append(_runtime_learning_card_tool_spec())
    if "question" not in names:
        rows.append(_runtime_question_tool_spec())
    if "read_learning_memory" not in names:
        rows.append(
            _runtime_memory_tool_spec(
                "read_learning_memory",
                "Read NexoraLearning memory markdown by line range and return line-numbered content.",
                ["memory_type"],
                {
                    "memory_type": {"type": "string", "enum": ["user", "soul", "context"]},
                    "lecture_id": {"type": "string"},
                    "start_line": {"type": "integer"},
                    "end_line": {"type": "integer"},
                },
            )
        )
    if "append_learning_memory" not in names:
        rows.append(
            _runtime_memory_tool_spec(
                "append_learning_memory",
                "Append markdown content to a NexoraLearning memory file.",
                ["memory_type", "content"],
                {
                    "memory_type": {"type": "string", "enum": ["user", "soul", "context"]},
                    "lecture_id": {"type": "string"},
                    "content": {"type": "string"},
                },
            )
        )
    if "update_learning_memory" not in names:
        rows.append(
            _runtime_memory_tool_spec(
                "update_learning_memory",
                "Replace a line range inside a NexoraLearning memory markdown file.",
                ["memory_type", "start_line", "end_line", "content"],
                {
                    "memory_type": {"type": "string", "enum": ["user", "soul", "context"]},
                    "lecture_id": {"type": "string"},
                    "start_line": {"type": "integer"},
                    "end_line": {"type": "integer"},
                    "content": {"type": "string"},
                },
            )
        )
    if "write_learning_memory" not in names:
        rows.append(
            _runtime_memory_tool_spec(
                "write_learning_memory",
                "Overwrite a NexoraLearning memory markdown file.",
                ["memory_type", "content"],
                {
                    "memory_type": {"type": "string", "enum": ["user", "soul", "context"]},
                    "lecture_id": {"type": "string"},
                    "content": {"type": "string"},
                },
            )
        )
    return rows


def _runtime_executor(username: str) -> LearningToolExecutor:
    runtime_cfg = dict(_cfg)
    runtime_cfg["_runtime_user_id"] = str(username or "").strip()
    return LearningToolExecutor(runtime_cfg)


def _runtime_render_memory_lines(content: str, start_line: int = 1, end_line: Optional[int] = None) -> List[str]:
    lines = str(content or "").splitlines()
    if not lines:
        return []
    start = max(1, int(start_line or 1))
    final_end = int(end_line or len(lines))
    final_end = max(start, min(final_end, len(lines)))
    return [f"[{idx + 1}] {lines[idx]}" for idx in range(start - 1, final_end)]


def _runtime_memory_target(arguments: Dict[str, Any]) -> Tuple[str, str]:
    memory_type = str(arguments.get("memory_type") or "").strip().lower()
    lecture_id = str(arguments.get("lecture_id") or "").strip()
    if memory_type not in {"user", "soul", "context"}:
        raise ValueError("memory_type must be one of user/soul/context.")
    if memory_type == "context" and not lecture_id:
        raise ValueError("lecture_id is required when memory_type=context.")
    return memory_type, lecture_id


def _runtime_read_memory(username: str, memory_type: str, lecture_id: str) -> str:
    user_store.ensure_user_files(_cfg, username)
    if memory_type == "context":
        return str(user_store.read_lecture_context_memory(_cfg, username, lecture_id) or "")
    return str(user_store.read_memory(_cfg, username, memory_type) or "")


def _runtime_write_memory(username: str, memory_type: str, lecture_id: str, content: str) -> str:
    user_store.ensure_user_files(_cfg, username)
    if memory_type == "context":
        return str(user_store.write_lecture_context_memory(_cfg, username, lecture_id, content) or "")
    return str(user_store.write_memory(_cfg, username, memory_type, content) or "")


def _runtime_execute_tool(username: str, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    name = str(tool_name or "").strip()
    safe_args = dict(arguments or {})
    if name not in _RUNTIME_READONLY_TOOL_NAMES:
        raise ValueError(f"Learning mode only supports configured runtime tools: {name}")

    if name == "question":
        title = str(safe_args.get("question_title") or "").strip()
        content = str(safe_args.get("question_content") or "").strip()
        if not title or not content:
            raise ValueError("question_title and question_content are required.")
        choices = [str(item or "").strip() for item in (safe_args.get("choices") or []) if str(item or "").strip()]
        return {
            "success": True,
            "question": {
                "question_id": str(safe_args.get("question_id") or "").strip(),
                "question_title": title,
                "question_content": content,
                "choices": choices,
                "allow_other": bool(safe_args.get("allow_other", True)),
            },
            "await": True,
        }

    if name == "learning_card":
        card_type = str(safe_args.get("type") or "").strip()
        lecture_id = str(safe_args.get("lecture_id") or "").strip()
        if not lecture_id:
            raise ValueError("lecture_id is required.")
        lecture = get_learning_lecture(_cfg, lecture_id)
        if not isinstance(lecture, dict):
            raise ValueError("Lecture not found.")
        books = list_lecture_books(_cfg, lecture_id) or []
        if card_type == "lecture_display":
            progress = max(0, min(100, _safe_int(lecture.get("progress"), 0)))
            html = (
                f'<article class="nxl-chat-card nxl-chat-card-lecture" data-lecture-id="{lecture_id}">'
                f'<div class="nxl-chat-card-kicker">Learning Lecture</div>'
                f'<h3>{str(lecture.get("title") or lecture_id)}</h3>'
                f'<div class="nxl-chat-card-meta">{len(books)} books | {progress}% progress</div>'
                f'<div class="nxl-chat-card-progress"><span style="width:{progress}%"></span></div>'
                f'<p>{str(lecture.get("description") or "")}</p>'
                f"</article>"
            )
            return {
                "success": True,
                "card": {
                    "type": "lecture_display",
                    "lecture_id": lecture_id,
                    "lecture": lecture,
                    "books_count": len(books),
                    "html": html,
                },
            }
        if card_type == "chapter_range":
            book_id = str(safe_args.get("book_id") or "").strip()
            if not book_id:
                raise ValueError("book_id is required for chapter_range.")
            book = get_lecture_book(_cfg, lecture_id, book_id)
            if not isinstance(book, dict):
                raise ValueError("Book not found.")
            content_range = safe_args.get("content_range") if isinstance(safe_args.get("content_range"), list) else []
            if len(content_range) != 2:
                raise ValueError("content_range must be [start, end].")
            start = max(0, _safe_int(content_range[0], 0))
            end = max(start, _safe_int(content_range[1], start))
            text = str(load_book_text(_cfg, lecture_id, book_id) or "")
            snippet = text[start:end]
            html = (
                f'<article class="nxl-chat-card nxl-chat-card-range" data-lecture-id="{lecture_id}" data-book-id="{book_id}">'
                f'<div class="nxl-chat-card-kicker">Chapter Range</div>'
                f'<h3>{str(book.get("title") or book_id)}</h3>'
                f'<div class="nxl-chat-card-meta">[{start}, {end}]</div>'
                f'<pre class="nxl-chat-card-snippet">{snippet[:1600]}</pre>'
                f"</article>"
            )
            return {
                "success": True,
                "card": {
                    "type": "chapter_range",
                    "lecture_id": lecture_id,
                    "book_id": book_id,
                    "range": [start, end],
                    "html": html,
                },
            }
        raise ValueError(f"unsupported card type: {card_type}")

    if name == "read_learning_memory":
        memory_type, lecture_id = _runtime_memory_target(safe_args)
        content = _runtime_read_memory(username, memory_type, lecture_id)
        start_line = _safe_int(safe_args.get("start_line"), 1)
        end_line = safe_args.get("end_line")
        numbered = _runtime_render_memory_lines(
            content,
            start_line,
            _safe_int(end_line, 0) if end_line is not None else None,
        )
        return {
            "success": True,
            "memory_type": memory_type,
            "lecture_id": lecture_id,
            "content": content,
            "lines": numbered,
            "total_lines": len(str(content or "").splitlines()),
        }

    if name == "append_learning_memory":
        memory_type, lecture_id = _runtime_memory_target(safe_args)
        current = _runtime_read_memory(username, memory_type, lecture_id)
        appended = str(safe_args.get("content") or "")
        next_content = current + ("" if (not current or current.endswith("\n") or not appended) else "\n") + appended
        path = _runtime_write_memory(username, memory_type, lecture_id, next_content)
        return {"success": True, "memory_type": memory_type, "lecture_id": lecture_id, "path": path}

    if name == "update_learning_memory":
        memory_type, lecture_id = _runtime_memory_target(safe_args)
        current = _runtime_read_memory(username, memory_type, lecture_id)
        lines = str(current or "").splitlines()
        start_line = max(1, _safe_int(safe_args.get("start_line"), 1))
        end_line = max(start_line, _safe_int(safe_args.get("end_line"), start_line))
        replacement = str(safe_args.get("content") or "").splitlines()
        if not lines:
            next_lines = list(replacement)
        else:
            start_idx = min(len(lines), start_line - 1)
            end_idx = min(len(lines), end_line)
            next_lines = lines[:start_idx] + replacement + lines[end_idx:]
        next_content = "\n".join(next_lines)
        if next_content:
            next_content += "\n"
        path = _runtime_write_memory(username, memory_type, lecture_id, next_content)
        return {"success": True, "memory_type": memory_type, "lecture_id": lecture_id, "path": path}

    if name == "write_learning_memory":
        memory_type, lecture_id = _runtime_memory_target(safe_args)
        path = _runtime_write_memory(username, memory_type, lecture_id, str(safe_args.get("content") or ""))
        return {"success": True, "memory_type": memory_type, "lecture_id": lecture_id, "path": path}

    payload = _runtime_executor(username).execute(name, safe_args)
    return dict(payload or {})


def _runtime_active_tool_skills() -> List[Dict[str, Any]]:
    return [
        {
            "title": "Learning Read-Only Mode",
            "required_tools": [
                "listLectures",
                "getLecture",
                "listBooks",
                "getBook",
                "getBookText",
                "readBookTextRange",
                "searchBookText",
                "getBookInfoXml",
                "getBookDetailXml",
                "getBookQuestionsXml",
                "vectorSearch",
                "learning_card",
                "question",
            ],
            "mode": "force",
            "version": "1.0",
            "author": "NexoraLearning",
            "main_content": (
                "This conversation is in NexoraLearning mode. Read course structure first, then inspect overview/detail/question material, "
                "and only read raw book text when those are insufficient."
            ),
        }
    ]


def _runtime_select_lecture_rows(username: str, payload: Optional[Dict[str, Any]] = None) -> Tuple[List[Dict[str, Any]], int]:
    lecture_filter = set(user_store.list_selected_lecture_ids(_cfg, username) or [])
    payload_map = payload if isinstance(payload, dict) else {}
    payload_lecture_id = str(payload_map.get("lecture_id") or "").strip()
    if payload_lecture_id:
        lecture_filter = {payload_lecture_id}
    lectures = list_learning_lectures(_cfg) or []
    rows: List[Dict[str, Any]] = []
    total_books = 0
    for lecture in lectures:
        if not isinstance(lecture, dict):
            continue
        lecture_id = str(lecture.get("id") or "").strip()
        if not lecture_id:
            continue
        if lecture_filter and lecture_id not in lecture_filter:
            continue
        books = list_lecture_books(_cfg, lecture_id) or []
        total_books += len(books)
        rows.append(
            {
                "id": lecture_id,
                "title": str(lecture.get("title") or "").strip(),
                "category": str(lecture.get("category") or "").strip(),
                "status": str(lecture.get("status") or "").strip(),
                "progress": _safe_int(lecture.get("progress"), 0),
                "current_chapter": str(lecture.get("current_chapter") or "").strip(),
                "books_count": len(books),
            }
        )
    return rows, total_books


def _build_runtime_context_payload(username: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    user_id = str(username or "").strip()
    payload_map = payload if isinstance(payload, dict) else {}
    user_store.ensure_user_files(_cfg, user_id)
    lecture_rows, total_books = _runtime_select_lecture_rows(user_id, payload_map)
    active_lecture_id = str(payload_map.get("lecture_id") or "").strip()
    if not active_lecture_id and lecture_rows:
        active_lecture_id = str(lecture_rows[0].get("id") or "").strip()
    recent_learning = user_store.list_learning_records(_cfg, user_id) or []
    recent_learning = recent_learning[-8:] if isinstance(recent_learning, list) else []
    user_payload = user_store.get_user(_cfg, user_id) or {}
    progress_lines = [
        f"- {row['title'] or row['id']} | progress {max(0, min(100, _safe_int(row.get('progress'), 0)))}% | current_chapter {row.get('current_chapter') or '-'} | books {row.get('books_count', 0)}"
        for row in lecture_rows
    ]
    return {
        "learning": True,
        "lecture_id": active_lecture_id,
        "system_prompt": (
            "You are in NexoraLearning mode. Use NexoraLearning tools to inspect lectures, books, overview XML, detail XML, questions XML, "
            "and only read raw text when needed. Prefer structured learning materials over direct full-text reads."
        ),
        "context_blocks": [
            {
                "type": "learning_profile",
                "title": "Learning Profile",
                "content": json.dumps(
                    {
                        "user_id": user_id,
                        "user": user_payload,
                        "selected_lectures": lecture_rows,
                    },
                    ensure_ascii=False,
                ),
            },
            {
                "type": "learning_progress",
                "title": "Learning Progress",
                "content": "\n".join(progress_lines) if progress_lines else "No active lecture progress.",
            },
            {
                "type": "learning_recent_records",
                "title": "Recent Learning Records",
                "content": json.dumps(recent_learning, ensure_ascii=False),
            },
        ],
        "meta": {
            "source": "nexoralearning_runtime",
            "selected_lecture_count": len(lecture_rows),
            "total_books": total_books,
            "lecture_id": active_lecture_id,
        },
        "cards": [],
        "active_tool_skills": _runtime_active_tool_skills(),
    }


def _numbered_markdown_lines(content: str) -> str:
    lines = str(content or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    if lines and lines[-1] == "":
        lines = lines[:-1]
    if not lines:
        return ""
    return "\n".join(f"[{index}] {line}" for index, line in enumerate(lines, start=1))


def _build_runtime_memory_blocks(username: str, lecture_id: str) -> List[Dict[str, str]]:
    user_id = str(username or "").strip()
    lecture_key = str(lecture_id or "").strip()
    if not user_id or not lecture_key:
        return []
    user_store.ensure_user_files(_cfg, user_id)
    soul_memory = str(user_store.read_memory(_cfg, user_id, "soul") or "").strip()
    user_memory = str(user_store.read_memory(_cfg, user_id, "user") or "").strip()
    lecture_context = str(user_store.read_lecture_context_memory(_cfg, user_id, lecture_key) or "").strip()
    memory_state = get_memory_state(_cfg, user_id, lecture_key)
    memory_settings = get_memory_settings(_cfg) or {}
    rows: List[Dict[str, str]] = []
    if soul_memory:
        rows.append(
            {
                "type": "learning_soul_memory",
                "title": "Learning Soul Memory",
                "content": _numbered_markdown_lines(soul_memory),
            }
        )
    if user_memory:
        rows.append(
            {
                "type": "learning_user_memory",
                "title": "Learning User Memory",
                "content": _numbered_markdown_lines(user_memory),
            }
        )
    if lecture_context:
        rows.append(
            {
                "type": "learning_lecture_context_memory",
                "title": "Learning Lecture Context Memory",
                "content": _numbered_markdown_lines(lecture_context),
            }
        )
    rows.append(
        {
            "type": "learning_memory_analysis_state",
            "title": "Learning Memory Analysis State",
            "content": json.dumps(
                {
                    "lecture_id": lecture_key,
                    "turns_since_last_analysis": int(memory_state.get("turns_since_last_analysis", 0) or 0),
                    "total_turns": int(memory_state.get("total_turns", 0) or 0),
                    "last_analysis_at": int(memory_state.get("last_analysis_at", 0) or 0),
                    "last_analysis_reason": str(memory_state.get("last_analysis_reason") or ""),
                    "trigger_turn_interval": int(memory_settings.get("trigger_turn_interval", 10) or 10),
                },
                ensure_ascii=False,
            ),
        }
    )
    return rows


@bp.route("/runtime/config", methods=["GET"])
def runtime_config():
    auth_error = _require_runtime_api_auth()
    if auth_error is not None:
        return auth_error
    return jsonify(
        {
            "success": True,
            "runtime_api": {
                "enabled": _runtime_api_enabled(),
                "base_path": "/api/runtime",
                "frontend_url": _resolve_learning_frontend_url(),
                "request_timeout": int(_runtime_api_cfg().get("request_timeout") or 30),
            },
        }
    )


@bp.route("/runtime/tools", methods=["GET"])
def runtime_tools():
    auth_error = _require_runtime_api_auth()
    if auth_error is not None:
        return auth_error
    return jsonify({"success": True, "tools": _runtime_tool_specs()})


@bp.route("/runtime/context", methods=["POST"])
def runtime_context():
    auth_error = _require_runtime_api_auth()
    if auth_error is not None:
        return auth_error
    data = request.get_json(silent=True) or {}
    username = str(data.get("username") or "").strip()
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    return jsonify({"success": True, "payload": _build_runtime_context_payload(username, payload)})


@bp.route("/runtime/tool/execute", methods=["POST"])
def runtime_tool_execute():
    auth_error = _require_runtime_api_auth()
    if auth_error is not None:
        return auth_error
    data = request.get_json(silent=True) or {}
    username = str(data.get("username") or "").strip()
    tool_name = str(data.get("tool_name") or data.get("function_name") or "").strip()
    arguments = data.get("arguments") if isinstance(data.get("arguments"), dict) else {}
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    if not tool_name:
        return jsonify({"success": False, "error": "tool_name is required."}), 400
    try:
        payload = _runtime_execute_tool(username, tool_name, arguments)
        log_event(
            "runtime_tool_execute",
            "Runtime tool executed.",
            payload={
                "username": username,
                "tool_name": tool_name,
            },
        )
        return jsonify({"success": True, "result": payload})
    except Exception as exc:
        log_event(
            "runtime_tool_execute_error",
            "Runtime tool execution failed.",
            payload={
                "username": username,
                "tool_name": tool_name,
                "error": str(exc),
            },
        )
        return jsonify({"success": False, "error": str(exc)}), 500


@bp.route("/runtime/memory-blocks", methods=["POST"])
def runtime_memory_blocks():
    auth_error = _require_runtime_api_auth()
    if auth_error is not None:
        return auth_error
    data = request.get_json(silent=True) or {}
    username = str(data.get("username") or "").strip()
    lecture_id = str(data.get("lecture_id") or "").strip()
    if not username or not lecture_id:
        return jsonify({"success": False, "error": "username and lecture_id are required."}), 400
    rows = _build_runtime_memory_blocks(username, lecture_id)
    return jsonify({"success": True, "blocks": rows})


@bp.route("/runtime/memory/trigger", methods=["POST"])
def runtime_memory_trigger():
    auth_error = _require_runtime_api_auth()
    if auth_error is not None:
        return auth_error
    data = request.get_json(silent=True) or {}
    username = str(data.get("username") or "").strip()
    lecture_id = str(data.get("lecture_id") or "").strip()
    reason = str(data.get("reason") or "").strip() or "manual"
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    if not username or not lecture_id:
        return jsonify({"success": False, "error": "username and lecture_id are required."}), 400
    log_event(
        "runtime_memory_trigger_request",
        "Runtime memory trigger request received.",
        payload={
            "username": username,
            "lecture_id": lecture_id,
            "reason": reason,
            "payload_keys": sorted([str(key) for key in payload.keys()]),
        },
    )
    result = enqueue_memory_job(
        _cfg,
        user_id=username,
        lecture_id=lecture_id,
        reason=reason,
        payload=payload,
    )
    return jsonify({"success": True, "result": result})


@bp.route("/runtime/memory/context-compression", methods=["POST"])
def runtime_memory_context_compression():
    auth_error = _require_runtime_api_auth()
    if auth_error is not None:
        return auth_error
    data = request.get_json(silent=True) or {}
    username = str(data.get("username") or "").strip()
    lecture_id = str(data.get("lecture_id") or "").strip()
    job_id = str(data.get("job_id") or "").strip()
    if not username or not lecture_id:
        return jsonify({"success": False, "error": "username and lecture_id are required."}), 400
    result = mark_context_compression_completed(_cfg, username, lecture_id, job_id=job_id)
    return jsonify({"success": True, "result": result})


@bp.route("/runtime/memory/turn", methods=["POST"])
def runtime_memory_turn():
    auth_error = _require_runtime_api_auth()
    if auth_error is not None:
        return auth_error
    data = request.get_json(silent=True) or {}
    username = str(data.get("username") or "").strip()
    lecture_id = str(data.get("lecture_id") or "").strip()
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    if not username or not lecture_id:
        return jsonify({"success": False, "error": "username and lecture_id are required."}), 400
    log_event(
        "runtime_memory_turn_request",
        "Runtime memory turn request received.",
        payload={
            "username": username,
            "lecture_id": lecture_id,
            "payload_keys": sorted([str(key) for key in payload.keys()]),
        },
    )
    state = increment_learning_turn(_cfg, username, lecture_id)
    settings = get_memory_settings(_cfg) or {}
    enqueue_result = maybe_enqueue_interval_analysis(
        _cfg,
        user_id=username,
        lecture_id=lecture_id,
        turn_interval=int(settings.get("trigger_turn_interval", 10) or 10),
        payload=payload,
    )
    log_event(
        "runtime_memory_turn_result",
        "Runtime memory turn request processed.",
        payload={
            "username": username,
            "lecture_id": lecture_id,
            "state": dict(state or {}),
            "enqueue": dict(enqueue_result or {}),
        },
    )
    return jsonify({"success": True, "state": state, "enqueue": enqueue_result})


@bp.route("/runtime/memory/queue", methods=["GET"])
def runtime_memory_queue():
    auth_error = _require_runtime_api_auth()
    if auth_error is not None:
        return auth_error
    return jsonify({"success": True, "queue": get_memory_queue_snapshot()})


@bp.route("/frontend/settings/logs", methods=["GET"])
def frontend_settings_logs():
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can view logs."}), 403
    category = str(request.args.get("category") or "all").strip()
    source = str(request.args.get("source") or "").strip()
    limit = _safe_int(request.args.get("limit"), 200)
    rows = list_structured_logs(_cfg, limit=limit, category=category, source=source)
    return jsonify(
        {
            "success": True,
            "sources": available_log_sources(_cfg, category="model"),
            "rows": rows,
            "selected_category": category,
            "selected_source": source,
        }
    )


@bp.route("/frontend/question-bank", methods=["GET"])
def frontend_question_bank():
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    rows = list(user_store.list_question_bank_items(_cfg, username) or [])
    if lecture_id:
        rows = [row for row in rows if str((row or {}).get("lecture_id") or "").strip() == lecture_id]
    rows = rows[-200:]
    return jsonify({"success": True, "items": rows, "total": len(rows)})


@bp.route("/frontend/learning-feeds", methods=["GET"])
def frontend_learning_feeds():
    limit = _safe_int(request.args.get("limit"), 50)
    rows = list_learning_feed_items(_cfg, limit=limit)
    author_cache: Dict[str, Dict[str, Any]] = {}
    current_user_id = str(_resolve_runtime_user_id() or "").strip()
    current_is_admin = bool(_is_runtime_admin())

    def _resolve_author_view(user_id: str) -> Dict[str, Any]:
        key = str(user_id or "").strip()
        if not key:
            return {}
        cached = author_cache.get(key)
        if cached is not None:
            return cached
        resolved: Dict[str, Any] = {"user_id": key, "username": key}
        if _proxy is not None:
            try:
                result = _proxy.get_user_info(username=key or None)
                if isinstance(result, dict) and result.get("success"):
                    user = result.get("user") if isinstance(result.get("user"), dict) else {}
                    resolved["user_id"] = str(user.get("id") or key).strip() or key
                    resolved["username"] = str(user.get("username") or key).strip() or key
                    nickname = str(user.get("nickname") or "").strip()
                    display_name = str(user.get("display_name") or "").strip()
                    avatar_url = str(user.get("avatar_url") or user.get("avatar") or "").strip()
                    if nickname:
                        resolved["nickname"] = nickname
                    if display_name:
                        resolved["display_name"] = display_name
                    if avatar_url:
                        resolved["avatar_url"] = avatar_url
                    if str(user.get("role") or "").strip().lower() == "admin":
                        resolved["author_is_admin"] = True
            except Exception:
                pass
        author_cache[key] = resolved
        return resolved

    def _build_author_payload(view: Dict[str, Any], fallback_user_id: str) -> Dict[str, str]:
        fallback = str(fallback_user_id or "").strip()
        payload = {
            "user_id": str(view.get("user_id") or fallback or "").strip(),
            "username": str(view.get("username") or fallback or "").strip(),
        }
        nickname = str(view.get("nickname") or "").strip()
        display_name = str(view.get("display_name") or "").strip()
        avatar_url = str(view.get("avatar_url") or "").strip()
        if nickname:
            payload["nickname"] = nickname
        if display_name:
            payload["display_name"] = display_name
        if avatar_url:
            payload["avatar_url"] = avatar_url
        return payload

    for row in rows:
        if not isinstance(row, dict):
            continue
        author = row.get("author") if isinstance(row.get("author"), dict) else {}
        author_id = str(author.get("user_id") or row.get("username") or row.get("user_id") or "").strip()
        author_view = _resolve_author_view(author_id)
        row["author"] = _build_author_payload(author_view, author_id)
        row["author_is_admin"] = bool(author_view.get("author_is_admin"))
        row["can_delete"] = bool(
            current_is_admin or (current_user_id and current_user_id == str(row["author"].get("user_id") or "").strip())
        )
        comments = row.get("comments")
        if isinstance(comments, list):
            rendered_comments = []
            for comment in comments:
                if not isinstance(comment, dict):
                    continue
                comment_author = comment.get("author") if isinstance(comment.get("author"), dict) else {}
                comment_author_id = str(comment_author.get("user_id") or comment.get("username") or "").strip()
                comment_author_view = _resolve_author_view(comment_author_id)
                rendered_comments.append(
                    {
                        **comment,
                        "author": _build_author_payload(comment_author_view, comment_author_id),
                        "author_is_admin": bool(comment_author_view.get("author_is_admin")),
                        "can_delete": bool(
                            current_is_admin
                            or (
                                current_user_id
                                and current_user_id == str(comment_author_view.get("user_id") or comment_author_id or "").strip()
                            )
                        ),
                    }
                )
            row["comments"] = rendered_comments
    return jsonify({"success": True, "items": rows, "total": len(rows)})


@bp.route("/frontend/learning-feeds", methods=["POST"])
def frontend_learning_feeds_create():
    data = request.get_json(silent=True) or {}
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    content = str(data.get("content") or data.get("summary") or "").strip()
    if not content:
        return jsonify({"success": False, "error": "content is required."}), 400
    author = _build_feed_author_snapshot(username)
    record = prepend_learning_feed_item(
        _cfg,
        {
            "type": "user_post",
            "summary": content,
            "content": content,
            "username": username,
            "author": author,
            "liked_user_ids": [],
            "likes_count": 0,
            "comments_count": 0,
        },
    )
    log_event("learning_feed_posted", {"username": username, "chars": len(content), "source": "feed"})
    return jsonify({"success": True, "item": record})


@bp.route("/frontend/learning-feeds/<feed_id>/like", methods=["POST"])
def frontend_learning_feed_like(feed_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    updated = toggle_learning_feed_like(_cfg, feed_id, username)
    if not isinstance(updated, dict):
        return jsonify({"success": False, "error": "feed not found."}), 404
    log_event("learning_feed_liked", {"feed_id": feed_id, "username": username, "source": "feed"})
    return jsonify({"success": True, "item": updated})


@bp.route("/frontend/learning-feeds/<feed_id>/comments", methods=["POST"])
def frontend_learning_feed_comment(feed_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    data = request.get_json(silent=True) or {}
    content = str(data.get("content") or "").strip()
    if not content:
        return jsonify({"success": False, "error": "content is required."}), 400
    comment = {
        "content": content,
        "author": _build_feed_author_snapshot(username),
        "username": username,
    }
    updated = append_learning_feed_comment(_cfg, feed_id, username, comment)
    if not isinstance(updated, dict):
        return jsonify({"success": False, "error": "feed not found."}), 404
    log_event("learning_feed_commented", {"feed_id": feed_id, "username": username, "chars": len(content), "source": "feed"})
    return jsonify({"success": True, "item": updated})


@bp.route("/frontend/learning-feeds/<feed_id>", methods=["DELETE"])
def frontend_learning_feed_delete(feed_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    rows = list_learning_feed_items(_cfg, limit=500)
    target = next((row for row in rows if isinstance(row, dict) and str(row.get("id") or "").strip() == str(feed_id or "").strip()), None)
    if not isinstance(target, dict):
        return jsonify({"success": False, "error": "feed not found."}), 404
    author = target.get("author") if isinstance(target.get("author"), dict) else {}
    author_id = str(author.get("user_id") or target.get("username") or "").strip()
    if not (_is_runtime_admin() or (author_id and author_id == username)):
        return jsonify({"success": False, "error": "forbidden"}), 403
    removed = delete_learning_feed_item(_cfg, feed_id)
    if not removed:
        return jsonify({"success": False, "error": "feed not found."}), 404
    log_event("learning_feed_deleted", {"feed_id": feed_id, "username": username, "source": "feed"})
    return jsonify({"success": True, "feed_id": feed_id})


@bp.route("/frontend/learning-feeds/<feed_id>/comments/<comment_id>", methods=["DELETE"])
def frontend_learning_feed_comment_delete(feed_id: str, comment_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    rows = list_learning_feed_items(_cfg, limit=500)
    target_feed = next((row for row in rows if isinstance(row, dict) and str(row.get("id") or "").strip() == str(feed_id or "").strip()), None)
    if not isinstance(target_feed, dict):
        return jsonify({"success": False, "error": "feed not found."}), 404
    comments = target_feed.get("comments") if isinstance(target_feed.get("comments"), list) else []
    target_comment = next((row for row in comments if isinstance(row, dict) and str(row.get("id") or "").strip() == str(comment_id or "").strip()), None)
    if not isinstance(target_comment, dict):
        return jsonify({"success": False, "error": "comment not found."}), 404
    comment_author = target_comment.get("author") if isinstance(target_comment.get("author"), dict) else {}
    comment_author_id = str(comment_author.get("user_id") or target_comment.get("username") or "").strip()
    if not (_is_runtime_admin() or (comment_author_id and comment_author_id == username)):
        return jsonify({"success": False, "error": "forbidden"}), 403
    updated = delete_learning_feed_comment(_cfg, feed_id, comment_id)
    if not isinstance(updated, dict):
        return jsonify({"success": False, "error": "comment not found."}), 404
    log_event("learning_feed_comment_deleted", {"feed_id": feed_id, "comment_id": comment_id, "username": username, "source": "feed"})
    return jsonify({"success": True, "item": updated})


@bp.route("/frontend/learning/chapter-complete", methods=["POST"])
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
    progress = max(0, min(100, _safe_int(lecture.get("progress"), 0)))
    if progress < 100:
        progress = min(100, progress + 5)
    next_chapter = ""
    if chapter_range:
        info_xml = str(load_book_info_xml(_cfg, lecture_id, book_id) or "")
        parsed = parse_book_info_xml_chapters(info_xml, len(str(load_book_text(_cfg, lecture_id, book_id) or "")))
        found_index = -1
        for idx, row in enumerate(parsed):
            if str(row.get("title") or "").strip() == chapter_name:
                found_index = idx
                break
        if found_index >= 0 and found_index + 1 < len(parsed):
            next_chapter = str(parsed[found_index + 1].get("title") or "").strip()
    update_learning_lecture(
        _cfg,
        lecture_id,
        {
            "current_chapter": chapter_name,
            "next_chapter": next_chapter,
            "progress": progress,
        },
    )
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
    job = enqueue_memory_job(
        _cfg,
        user_id=username,
        lecture_id=lecture_id,
        reason="profile_question",
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
        "用户完成章节并触发画像出题",
        payload={
            "username": username,
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_name": chapter_name,
            "question_job": dict(job or {}),
        },
    )
    return jsonify({"success": True, "enqueue": job, "progress": progress, "next_chapter": next_chapter})
