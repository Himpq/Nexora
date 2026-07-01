"""HTTP routes for NexoraLearning."""

from __future__ import annotations

import json
import hashlib
import html as html_lib
import queue
import random
import re
import threading
import time
from collections.abc import Mapping as MappingABC
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Mapping
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

from flask import Blueprint, Response, jsonify, request, send_file, send_from_directory, stream_with_context
from werkzeug.utils import secure_filename

from core import storage
from prompts import PROFILE_INTERVIEW_PROMPT, PROFILE_UPDATE_PROMPT
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
    list_book_cover_assets,
    list_lecture_cover_assets,
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
    PromptContextManager,
    get_default_nexora_model,
    update_default_nexora_model,
)
from core.nexora_proxy import NexoraProxy
from core.runlog import append_log_text, log_event
from core.runlog import available_log_sources, list_structured_logs
from core import user as user_store
from core.memory.memory_analysis import run_memory_analysis_job
from core.memory.profile_extract import parse_profile_dimensions, run_profile_extraction_job
from core.memory.profile_question import run_profile_question_job
from core.learning_feed import prepend_learning_feed_item
from core.learning_feed import list_learning_feed_items
from core.learning_feed import list_learning_feed_channels
from core.learning_feed import upsert_learning_feed_channel
from core.learning_feed import delete_learning_feed_channel
from core.learning_feed import toggle_learning_feed_like
from core.learning_feed import toggle_learning_feed_comment_like
from core.learning_feed import append_learning_feed_comment
from core.learning_feed import delete_learning_feed_item
from core.learning_feed import delete_learning_feed_comment
from core.learning_resources import append_learning_resource
from core.learning_resources import append_learning_resource_task
from core.learning_resources import create_learning_resource_version
from core.learning_resources import delete_learning_resource
from core.learning_resources import list_learning_resource_tasks
from core.learning_resources import list_learning_resources
from core.learning_resources import is_learning_resource_plain_text_language
from core.learning_resources import strip_model_thinking_blocks
from core.learning_resources import switch_learning_resource_version
from core.learning_resources import update_learning_resource
from core.learning_resources import update_learning_resource_task
from core.user import append_notification
from core.user.learning_progress import (
    build_user_lecture_last_active_map as _build_user_lecture_last_active_map,
    build_user_study_hours_map as _build_user_study_hours_map,
    compute_user_lecture_progress as _compute_user_lecture_progress,
)
from core.memory.memory_queue import (
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
from core.booksproc.context import Context, ContextPolicy
from core.booksproc import (
    cancel_book_refinement,
    enqueue_book_intensive,
    enqueue_book_question,
    enqueue_book_refinement,
    enqueue_book_section,
    enqueue_book_annotation,
    enqueue_book_summary,
    get_book_progress_steps,
    get_book_progress_text,
    get_intensive_reading_settings,
    get_memory_settings,
    get_profile_question_settings,
    get_refinement_queue_snapshot,
    get_rough_reading_settings,
    get_split_chapters_settings,
    get_annotation_settings,
    get_book_summary_settings,
    init_booksproc,
    list_refinement_candidates,
    mark_book_uploaded,
    update_intensive_reading_settings,
    update_memory_settings,
    update_profile_question_settings,
    update_rough_reading_settings,
    update_split_chapters_settings,
    update_annotation_settings,
    update_book_summary_settings,
)
from core.vector import (
    collection_stats as vector_collection_stats,
    delete_course_collection as vector_delete_course_collection,
    delete_material_chunks as vector_delete_material_chunks,
    get_nexoradb_status,
    is_nexoradb_available,
    query as vector_query,
    queue_vectorize_book,
    require_nexoradb_available,
    split_text_for_vector,
    upsert_chunks as vector_upsert_chunks,
    vectorize_book,
)
from core.utils import extract_text
from core.bookextract import extract_epub_with_assets
from api.status import build_status_overview

bp = Blueprint("learning", __name__, url_prefix="/api")
_cfg: Dict[str, Any] = {}
_proxy: Optional[NexoraProxy] = None
_FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
_FRONTEND_ASSETS_DIR = _FRONTEND_DIR / "assets"
_VIDEO_GENERATOR_STAGES = (
    "outline",
    "script",
    "storyboard",
    "images",
    "vision_description",
    "canvas",
    "audio",
    "clips",
    "timeline",
    "export",
)
_VIDEO_GENERATOR_RUN_LOCK = threading.RLock()
_VIDEO_GENERATOR_RUNNING_PROJECTS: set[str] = set()
_LEARNING_RESOURCE_SCAN_LOCK = threading.RLock()
_LEARNING_RESOURCE_SCAN_CANCEL_EVENTS: Dict[str, threading.Event] = {}
_LEARNING_RESOURCE_PROCESS_STARTED_AT = int(time.time())
_LEARNING_RESOURCE_GENERATION_LOCK = threading.RLock()
_LEARNING_RESOURCE_GENERATION_ACTIVE_TASKS: set[str] = set()

ALLOWED_EXT = {".pdf", ".txt", ".md", ".docx", ".doc", ".epub", ".c", ".h", ".py", ".rst"}
VECTOR_TOOL_NAMES = {"triggerBookVectorization", "vectorSearch"}
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
    # 章节完成触发完整链：记忆分析 → 画像提取 → 画像出题
    if reason in {"chapter_complete", "personalized_chapter_complete"}:
        try:
            run_profile_extraction_job(cfg, job)
        except Exception as exc:
            log_event(
                "profile_extraction_chain_error",
                "画像提取串联执行失败",
                payload={
                    "job_id": str(job.get("job_id") or "").strip(),
                    "user_id": str(job.get("user_id") or "").strip(),
                    "error": str(exc),
                },
            )
        try:
            run_profile_question_job(cfg, job)
        except Exception as exc:
            log_event(
                "profile_question_chain_error",
                "画像出题串联执行失败",
                payload={
                    "job_id": str(job.get("job_id") or "").strip(),
                    "user_id": str(job.get("user_id") or "").strip(),
                    "error": str(exc),
                },
            )


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


def _vector_disabled_payload(status: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    status = status or get_nexoradb_status(_cfg)
    return {
        "success": False,
        "status": "disabled",
        "available": False,
        "service_url": str(status.get("service_url") or ""),
        "message": str(status.get("message") or "NexoraDB 未连接，向量流程已停用"),
    }


def _vector_unavailable_response(status: Optional[Dict[str, Any]] = None):
    payload = _vector_disabled_payload(status)
    return jsonify({"success": False, "error": payload["message"], "nexoradb": payload}), 503


def _vector_tools_available() -> bool:
    return is_nexoradb_available(_cfg)


def _filter_vector_tool_names(names: List[str], vector_tools_available: Optional[bool] = None) -> List[str]:
    available = _vector_tools_available() if vector_tools_available is None else bool(vector_tools_available)

    if available:
        return list(names)

    return [name for name in names if name not in VECTOR_TOOL_NAMES]


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

    log_event(
        "runtime_user_resolution_failed",
        "Runtime user resolution failed because no Nexora session user was available.",
        payload={
            "has_cookie": bool(str(request.headers.get("Cookie") or "").strip()),
            "session_lookup_success": bool(session_result.get("success")),
            "session_lookup_message": str(session_result.get("message") or "").strip(),
        },
    )
    return ""


def _feed_user_keys_from_values(*values: Any) -> set:
    """收集同一用户可能出现的 id / username 标识。"""
    keys = set()

    for value in values:
        if isinstance(value, MappingABC):
            candidates = (
                value.get("id"),
                value.get("user_id"),
                value.get("username"),
            )
        else:
            candidates = (value,)

        for candidate in candidates:
            key = str(candidate or "").strip()

            if key:
                keys.add(key)

    return keys


def _resolve_feed_user_key_set(user_id: str) -> set:
    """把当前用户解析成可用于动态作者权限判断的标识集合。"""
    keys = _feed_user_keys_from_values(user_id)

    if not keys:
        return keys

    session_result = _fetch_session_user_from_nexora()

    if session_result.get("success"):
        session_user = session_result.get("user") if isinstance(session_result.get("user"), dict) else {}
        session_keys = _feed_user_keys_from_values(session_user)

        if keys.intersection(session_keys):
            keys.update(session_keys)

    if _proxy is None:
        return keys

    for key in list(keys):
        result = _proxy.get_user_info(username=key or None)

        if isinstance(result, dict) and result.get("success"):
            user = result.get("user") if isinstance(result.get("user"), dict) else {}
            keys.update(_feed_user_keys_from_values(user))

    return keys


def _feed_user_keys_match(current_user_keys: set, *author_values: Any) -> bool:
    """判断当前用户是否和动态/评论作者为同一人。"""
    if not current_user_keys:
        return False

    author_keys = _feed_user_keys_from_values(*author_values)

    return bool(current_user_keys.intersection(author_keys))


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


def _is_runtime_teacher() -> bool:
    """判断当前请求是否教师角色。"""
    return _resolve_runtime_role() in ("admin", "teacher")


def _append_model_option(
    rows: List[Dict[str, str]],
    model_id: Any,
    *,
    label: Any = "",
    provider: Any = "",
    status: Any = "",
) -> None:
    """追加模型选项，并保留前端展示所需的 provider 元数据。"""
    normalized_id = str(model_id or "").strip()

    if not normalized_id:
        return

    normalized_label = str(label or normalized_id).strip() or normalized_id
    row = {
        "id": normalized_id,
        "label": normalized_label,
        "provider": str(provider or "").strip(),
    }
    normalized_status = str(status or "").strip()

    if normalized_status:
        row["status"] = normalized_status

    rows.append(row)


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
            _append_model_option(
                rows,
                model_id,
                label=item.get("name") or item.get("label") or model_id,
                provider=item.get("provider") or item.get("owned_by") or item.get("provider_key") or item.get("vendor"),
                status=item.get("status") or item.get("state"),
            )

    models_field = payload.get("models")

    if isinstance(models_field, list):
        for item in models_field:
            if isinstance(item, dict):
                model_id = item.get("id") or item.get("model") or item.get("name")
                _append_model_option(
                    rows,
                    model_id,
                    label=item.get("label") or item.get("name") or model_id,
                    provider=item.get("provider") or item.get("owned_by") or item.get("provider_key") or item.get("vendor"),
                    status=item.get("status") or item.get("state"),
                )
            else:
                _append_model_option(rows, item, label=item)

    elif isinstance(models_field, dict):
        for raw_name, item in models_field.items():
            if isinstance(item, dict):
                _append_model_option(
                    rows,
                    raw_name,
                    label=item.get("label") or item.get("name") or raw_name,
                    provider=item.get("provider") or item.get("owned_by") or item.get("provider_key") or item.get("vendor"),
                    status=item.get("status") or item.get("state"),
                )
            else:
                _append_model_option(rows, raw_name, label=raw_name)

    dedup: Dict[str, Dict[str, str]] = {}

    for row in rows:
        model_id = row["id"]
        existing = dedup.get(model_id)

        if not existing:
            dedup[model_id] = row
            continue

        merged = dict(existing)

        if row.get("label") and (not merged.get("label") or merged.get("label") == model_id):
            merged["label"] = row["label"]

        if row.get("provider") and not merged.get("provider"):
            merged["provider"] = row["provider"]

        if row.get("status") and not merged.get("status"):
            merged["status"] = row["status"]

        dedup[model_id] = merged

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


@bp.route("/frontend/puzzle", methods=["GET"])
def frontend_puzzle():
    return send_from_directory(str(_FRONTEND_DIR), "puzzle.html")


@bp.route("/frontend/assets/<path:filename>", methods=["GET"])
def frontend_assets(filename: str):
    return send_from_directory(str(_FRONTEND_ASSETS_DIR), filename)


@bp.route("/frontend/status", methods=["GET"])
def frontend_status():
    return send_from_directory(str(_FRONTEND_DIR), "status.html")


@bp.route("/status/overview", methods=["GET"])
def frontend_status_overview():
    viewer = _resolve_status_viewer()
    return jsonify({"success": True, "status": build_status_overview(_cfg, viewer=viewer)})


def _resolve_status_viewer() -> Dict[str, Any]:
    """Resolve the current viewer without accepting query-string impersonation."""
    cookie_header = str(request.headers.get("Cookie") or "").strip()
    if cookie_header:
        session_result = _fetch_session_user_from_nexora()
        if session_result.get("success"):
            user_payload = session_result.get("user") if isinstance(session_result.get("user"), dict) else {}
            user_id = str(user_payload.get("id") or user_payload.get("username") or "").strip()
            if user_id:
                return {
                    "user_id": user_id,
                    "role": str(user_payload.get("role") or "member").strip().lower() or "member",
                }

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
            role = "member"
            if _proxy is not None:
                try:
                    result = _proxy.get_user_info(username=candidate)
                    if isinstance(result, dict) and result.get("success"):
                        user = result.get("user") if isinstance(result.get("user"), dict) else {}
                        role = str(user.get("role") or "member").strip().lower() or "member"
                except Exception:
                    role = "member"
            return {"user_id": candidate, "role": role}

    return {"user_id": "", "role": "guest"}


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

        # 会话解析不到时，只允许显式用户名继续；否则直接返回认证错误。
        if not user_payload:
            if not username and not requested_username and not header_username:
                log_event(
                    "frontend_context_auth_missing",
                    "Frontend context rejected because Nexora session user could not be resolved.",
                    payload={
                        "has_cookie": bool(str(request.headers.get("Cookie") or "").strip()),
                        "integration_base_url": str(integration.get("base_url") or "").strip(),
                    },
                )
                return jsonify(
                    {
                        "success": False,
                        "error": "Nexora 登录态缺失，请从已登录的 Nexora 页面进入 NexoraLearning。",
                        "integration": integration,
                    }
                ), 401

            result = _proxy.get_user_info(username=username)

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
    elif not username:
        log_event(
            "frontend_context_proxy_missing",
            "Frontend context rejected because Nexora proxy is not initialized.",
            payload={
                "has_cookie": bool(str(request.headers.get("Cookie") or "").strip()),
            },
        )
        return jsonify(
            {
                "success": False,
                "error": "NexoraLearning 未初始化 Nexora 代理，无法解析当前登录用户。",
                "integration": integration,
            }
        ), 503

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


def _build_feed_actor_payload(username: str) -> Dict[str, str]:
    """解析动态发起者的公开展示字段，供动态流和通知列表复用。"""
    user_id = str(username or "").strip()
    snapshot = {"user_id": user_id, "username": user_id}
    if not user_id:
        return snapshot

    session_result = _fetch_session_user_from_nexora()
    if session_result.get("success"):
        user = session_result.get("user") if isinstance(session_result.get("user"), dict) else {}
        session_user_id = str(user.get("id") or "").strip()
        if session_user_id and session_user_id == user_id:
            snapshot.update(
                {
                    "user_id": session_user_id,
                    "username": str(user.get("username") or session_user_id).strip() or session_user_id,
                }
            )
            for key in ("display_name", "nickname"):
                value = str(user.get(key) or "").strip()
                if value:
                    snapshot[key] = value
            avatar_url = str(user.get("avatar_url") or user.get("avatar") or "").strip()
            if avatar_url:
                snapshot["avatar_url"] = avatar_url
            return snapshot

    if _proxy is None:
        return snapshot

    try:
        result = _proxy.get_user_info(username=user_id or None)
        if isinstance(result, dict) and result.get("success"):
            user = result.get("user") if isinstance(result.get("user"), dict) else {}
            snapshot["user_id"] = str(user.get("id") or user_id).strip() or user_id
            snapshot["username"] = str(user.get("username") or user_id).strip() or user_id
            for key in ("display_name", "nickname"):
                value = str(user.get(key) or "").strip()
                if value:
                    snapshot[key] = value
            avatar_url = str(user.get("avatar_url") or user.get("avatar") or "").strip()
            if avatar_url:
                snapshot["avatar_url"] = avatar_url
    except Exception:
        pass

    return snapshot


def _build_feed_author_snapshot(username: str) -> Dict[str, str]:
    """构建动态记录中的 author 快照。"""
    return _build_feed_actor_payload(username)


def _extract_legacy_feed_notice_actor_id(row: Mapping[str, Any]) -> str:
    """从旧动态通知标题里提取发起者，用于补齐通知头像展示。"""
    title = str(row.get("title") or "").strip()
    if not (title.startswith("你在动态中") or title.startswith("你在评论中")):
        return ""

    match = re.search(r"@\s*([A-Za-z0-9_][A-Za-z0-9_.-]{0,63})", title)
    return str(match.group(1) if match else "").strip()


def _enrich_feed_notice_actor(row: Dict[str, Any]) -> Dict[str, Any]:
    """补齐动态通知的发起者字段，前端据此渲染头像。"""
    payload = dict(row or {})
    source = str(payload.get("source") or "").strip().lower()
    actor = payload.get("actor") if isinstance(payload.get("actor"), dict) else {}
    actor_id = str(
        payload.get("actor_user_id")
        or actor.get("user_id")
        or actor.get("username")
        or ""
    ).strip()

    if source != "feed":
        actor_id = actor_id or _extract_legacy_feed_notice_actor_id(payload)
        if not actor_id:
            return payload
        payload["source"] = "feed"

    if actor_id and not actor.get("avatar_url"):
        payload["actor"] = _build_feed_actor_payload(actor_id)
    elif actor:
        payload["actor"] = dict(actor)

    return payload


def _extract_mentioned_user_ids(text: str) -> List[str]:
    found = re.findall(r"(?<![\w@])@([A-Za-z0-9_][A-Za-z0-9_.-]{0,63})", str(text or ""))
    seen: set[str] = set()
    rows: List[str] = []
    for item in found:
        key = str(item or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        rows.append(key)
    return rows


def _notify_feed_mentions(author_user_id: str, content: str, *, title: str, jumpto: str = "") -> None:
    author_key = str(author_user_id or "").strip()
    actor_payload = _build_feed_actor_payload(author_key)

    for mentioned_user_key in _extract_mentioned_user_ids(content):
        mention_key = str(mentioned_user_key or "").strip()
        if not mention_key:
            continue
        resolved_username = mention_key
        resolved_user_id = mention_key
        if _proxy is not None:
            try:
                lookup = _proxy.get_user_info(username=mention_key)
                if not (isinstance(lookup, dict) and lookup.get("success")):
                    log_event(
                        "learning_feed_mention_notify_skipped",
                        "Skipped learning-feed mention notification because the mentioned user could not be resolved.",
                        payload={
                            "author_user_id": author_key,
                            "mentioned_key": mention_key,
                            "source": "feed",
                        },
                    )
                    continue
                user = lookup.get("user") if isinstance(lookup.get("user"), dict) else {}
                resolved_username = str(user.get("username") or mention_key).strip() or mention_key
                resolved_user_id = str(user.get("id") or resolved_username).strip() or resolved_username
            except Exception:
                log_event(
                    "learning_feed_mention_notify_error",
                    "Failed to resolve mentioned user while writing learning-feed notification.",
                    payload={
                        "author_user_id": author_key,
                        "mentioned_key": mention_key,
                        "source": "feed",
                    },
                )
                continue
        try:
            append_notification(
                _cfg,
                resolved_username,
                {
                    "type": "notification",
                    "source": "feed",
                    "date": int(time.time()),
                    "title": str(title or "").strip(),
                    "content": str(content or "").strip(),
                    "jumpto": str(jumpto or "").strip(),
                    "actor_user_id": author_key,
                    "actor": actor_payload,
                },
            )
            log_event(
                "learning_feed_mention_notified",
                "Wrote a learning-feed mention notification.",
                payload={
                    "author_user_id": author_key,
                    "mentioned_key": mention_key,
                    "mentioned_username": resolved_username,
                    "mentioned_user_id": resolved_user_id,
                    "source": "feed",
                },
            )
        except Exception:
            log_event(
                "learning_feed_mention_notify_error",
                "Failed to append learning-feed mention notification.",
                payload={
                    "author_user_id": author_key,
                    "mentioned_key": mention_key,
                    "mentioned_username": resolved_username,
                    "source": "feed",
                },
            )
            continue


def _resolve_teacher_infos(teacher_ids: List[str]) -> List[Dict[str, Any]]:
    """Resolve teacher user IDs to full user objects (with avatar_url)."""
    if not teacher_ids or _proxy is None:
        return [{"user_id": uid, "display_name": uid} for uid in teacher_ids]
    resolved: List[Dict[str, Any]] = []
    for uid in teacher_ids:
        uid_str = str(uid or "").strip()
        if not uid_str:
            continue
        try:
            info = _proxy.get_user_info(username=uid_str)
            if isinstance(info, dict) and info.get("success"):
                user = info.get("user") if isinstance(info.get("user"), dict) else {}
                resolved.append({
                    "user_id": str(user.get("id") or uid_str).strip() or uid_str,
                    "username": str(user.get("username") or uid_str).strip() or uid_str,
                    "display_name": str(user.get("display_name") or "").strip(),
                    "nickname": str(user.get("nickname") or "").strip(),
                    "avatar_url": str(user.get("avatar_url") or "").strip(),
                })
            else:
                resolved.append({"user_id": uid_str, "display_name": uid_str})
        except Exception:
            resolved.append({"user_id": uid_str, "display_name": uid_str})
    return resolved


def _search_nexora_users(query: str, limit: int = 8) -> List[Dict[str, Any]]:
    """Search users from Nexora via proxy."""
    q = str(query or "").strip()
    if not q or _proxy is None:
        return []
    endpoint = f"/api/papi/user/search?q={urllib_parse.quote(q)}&limit={max(1, min(int(limit or 8), 20))}"
    status, resp, _used_endpoint = _proxy._request_json(endpoint, method="GET", payload=None, username=None)
    if int(status or 0) < 200 or int(status or 0) >= 300:
        return []
    if not isinstance(resp, dict):
        return []
    items = resp.get("items")
    if not isinstance(items, list):
        return []
    rows: List[Dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        user_id = str(item.get("user_id") or item.get("username") or "").strip()
        username = str(item.get("username") or user_id).strip() or user_id
        if not user_id or not username:
            continue
        rows.append(
            {
                "user_id": user_id,
                "username": username,
                "display_name": str(item.get("display_name") or "").strip(),
                "nickname": str(item.get("nickname") or "").strip(),
                "avatar_url": str(item.get("avatar_url") or "").strip(),
                "role": str(item.get("role") or "member").strip() or "member",
            }
        )
    return rows


def _list_recent_feed_user_examples(limit: int = 5) -> List[Dict[str, Any]]:
    rows = list_learning_feed_items(_cfg, limit=120)
    seen: set[str] = set()
    user_ids: List[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        author = row.get("author") if isinstance(row.get("author"), dict) else {}
        author_id = str(author.get("user_id") or "").strip()
        if author_id and author_id not in seen:
            seen.add(author_id)
            user_ids.append(author_id)
        comments = row.get("comments") if isinstance(row.get("comments"), list) else []
        for comment in comments:
            if not isinstance(comment, dict):
                continue
            comment_author = comment.get("author") if isinstance(comment.get("author"), dict) else {}
            comment_author_id = str(comment_author.get("user_id") or "").strip()
            if comment_author_id and comment_author_id not in seen:
                seen.add(comment_author_id)
                user_ids.append(comment_author_id)
        if len(user_ids) >= max(1, int(limit or 5)):
            break
    result: List[Dict[str, Any]] = []
    for user_id in user_ids[: max(1, int(limit or 5))]:
        if _proxy is None:
            result.append({"user_id": user_id, "username": user_id, "display_name": "", "nickname": "", "avatar_url": "", "role": "member"})
            continue
        try:
            info = _proxy.get_user_info(username=user_id or None)
            if isinstance(info, dict) and info.get("success"):
                user = info.get("user") if isinstance(info.get("user"), dict) else {}
                result.append(
                    {
                        "user_id": str(user.get("id") or user_id).strip() or user_id,
                        "username": str(user.get("username") or user_id).strip() or user_id,
                        "display_name": str(user.get("display_name") or "").strip(),
                        "nickname": str(user.get("nickname") or "").strip(),
                        "avatar_url": str(user.get("avatar_url") or "").strip(),
                        "role": str(user.get("role") or "member").strip() or "member",
                    }
                )
        except Exception:
            continue
    return result


@bp.route("/frontend/materials", methods=["GET"])
def frontend_materials():
    started_at = time.perf_counter()
    sort_by = str(request.args.get("sort_by") or "updated_at").strip().lower() or "updated_at"
    order = str(request.args.get("order") or "desc").strip().lower() or "desc"
    desc = order != "asc"

    user_id = _resolve_runtime_user_id()
    learning_records = user_store.list_learning_records(_cfg, user_id) if user_id else []
    study_hours_map = _build_user_study_hours_map(user_id, records=learning_records) if user_id else {}
    teacher_info_cache: Dict[str, Dict[str, Any]] = {}

    lectures = list_learning_lectures(_cfg)
    rows = []
    total_books = 0

    def _resolve_teacher_infos_for_materials(teacher_ids: List[str]) -> List[Dict[str, Any]]:
        resolved_rows: List[Dict[str, Any]] = []
        missing_ids: List[str] = []

        for teacher_id in teacher_ids:
            uid = str(teacher_id or "").strip()
            if not uid:
                continue

            cached = teacher_info_cache.get(uid)
            if cached is not None:
                resolved_rows.append(dict(cached))
            else:
                missing_ids.append(uid)

        if missing_ids:
            fetched_rows = _resolve_teacher_infos(missing_ids)
            for row in fetched_rows:
                if not isinstance(row, dict):
                    continue

                uid = str(row.get("user_id") or row.get("username") or "").strip()
                if uid:
                    teacher_info_cache[uid] = dict(row)

            for uid in missing_ids:
                cached = teacher_info_cache.get(uid)
                if cached is not None:
                    resolved_rows.append(dict(cached))

        return resolved_rows

    for lecture in lectures:
        lecture_id = str((lecture or {}).get("id") or "").strip()
        books = list_lecture_books(_cfg, lecture_id) if lecture_id else []
        total_books += len(books)
        lecture_with_user = dict(lecture or {})
        # Resolve teacher user IDs to objects with avatar_url
        raw_teacher = lecture_with_user.get("teacher") or []
        if isinstance(raw_teacher, list) and raw_teacher:
            lecture_with_user["teacher_info"] = _resolve_teacher_infos_for_materials([
                str(t or "") for t in raw_teacher
            ])
        if user_id and lecture_id:
            user_progress = _compute_user_lecture_progress(user_id, lecture_id, books, records=learning_records)
            lecture_with_user["progress"] = user_progress["progress"]
            lecture_with_user["current_chapter"] = user_progress["current_chapter"]
            lecture_with_user["next_chapter"] = user_progress["next_chapter"]
            lecture_with_user["study_hours"] = float(study_hours_map.get(lecture_id, 0.0))
        rows.append(
            {
                "lecture": lecture_with_user,
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
    duration_ms = int((time.perf_counter() - started_at) * 1000)

    if duration_ms >= 800:
        log_event(
            "frontend_materials_slow",
            "NexoraLearning materials list request exceeded the slow threshold.",
            payload={
                "duration_ms": duration_ms,
                "lectures": len(rows),
                "total_books": total_books,
                "user_id": user_id,
                "teacher_cache_size": len(teacher_info_cache),
            },
        )

    return jsonify(
        {
            "success": True,
            "lectures": rows,
            "total_lectures": len(rows),
            "total_books": total_books,
            "sort_by": sort_by,
            "order": "desc" if desc else "asc",
            "duration_ms": duration_ms,
        }
    )


@bp.route("/frontend/dashboard", methods=["GET"])
def frontend_dashboard():
    user_id = _resolve_runtime_user_id()
    user_store.ensure_user_files(_cfg, user_id)
    learning_records = user_store.list_learning_records(_cfg, user_id)
    selected_lecture_ids = set(user_store.list_selected_lecture_ids(_cfg, user_id))
    study_hours_map = _build_user_study_hours_map(user_id, records=learning_records)
    last_active_map = _build_user_lecture_last_active_map(user_id, records=learning_records)

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
        lecture_with_user_state["last_active_ts"] = int(last_active_map.get(lecture_id, 0))
        total_study_hours += lecture_hours
        books = list_lecture_books(_cfg, lecture_id)
        total_books += len(books)
        user_progress = _compute_user_lecture_progress(user_id, lecture_id, books, records=learning_records)
        lecture_with_user_state["progress"] = user_progress["progress"]
        lecture_with_user_state["current_chapter"] = user_progress["current_chapter"]
        lecture_with_user_state["next_chapter"] = user_progress["next_chapter"]
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


def _is_book_pending_parse(book: Mapping[str, Any]) -> bool:
    """判断教材是否还没有完成首页可用的粗读解析。"""
    coarse_status = str(book.get("coarse_status") or "").strip().lower()
    if coarse_status in {"done", "completed", "success"}:
        return False

    return True


def _build_pending_parse_summary() -> Dict[str, Any]:
    """统计管理员首页通知栏中的待解析教材。"""
    items: List[Dict[str, Any]] = []

    for lecture in list_learning_lectures(_cfg):
        lecture_id = str((lecture or {}).get("id") or "").strip()
        if not lecture_id:
            continue

        lecture_title = str((lecture or {}).get("title") or lecture_id).strip()
        books = list_lecture_books(_cfg, lecture_id)

        for book in books:
            if not isinstance(book, MappingABC) or not _is_book_pending_parse(book):
                continue

            items.append(
                {
                    "lecture_id": lecture_id,
                    "lecture_title": lecture_title,
                    "book_id": str(book.get("id") or "").strip(),
                    "book_title": str(book.get("title") or book.get("id") or "").strip(),
                    "coarse_status": str(book.get("coarse_status") or "").strip(),
                    "refinement_status": str(book.get("refinement_status") or "").strip(),
                    "updated_at": int(book.get("updated_at") or 0),
                }
            )

    items.sort(key=lambda row: int(row.get("updated_at") or 0), reverse=True)
    return {
        "count": len(items),
        "items": items[:5],
    }


@bp.route("/frontend/notifications", methods=["GET"])
def frontend_notifications():
    """返回首页右侧通知面板数据。"""
    user_id = _resolve_runtime_user_id()
    user_store.ensure_user_files(_cfg, user_id)

    try:
        limit = int(request.args.get("limit") or 20)
    except (TypeError, ValueError):
        limit = 20

    limit = max(1, min(limit, 50))
    notifications = user_store.list_notifications(_cfg, user_id)
    rows = [
        _enrich_feed_notice_actor(row)
        for row in notifications
        if isinstance(row, dict) and not bool(row.get("removed"))
    ][:limit]

    return jsonify(
        {
            "success": True,
            "user_id": user_id,
            "items": rows,
            "admin_pending_parse": _build_pending_parse_summary() if _is_runtime_admin() else {"count": 0, "items": []},
        }
    )


@bp.route("/frontend/notifications/<notification_id>/remove", methods=["POST"])
def frontend_notification_remove(notification_id: str):
    """将首页通知标记为已移除。"""
    user_id = _resolve_runtime_user_id()
    user_store.ensure_user_files(_cfg, user_id)
    result = user_store.mark_notification_removed(_cfg, user_id, notification_id)

    if not result.get("updated"):
        return jsonify({"success": False, "error": "notification not found."}), 404

    return jsonify({"success": True, **result})


@bp.route("/frontend/profile", methods=["GET"])
def frontend_profile():
    """返回用户画像的结构化维度数据。"""
    user_id = _resolve_runtime_user_id()
    user_store.ensure_user_files(_cfg, user_id)

    from core.memory import PROFILE_DIMENSIONS, parse_profile_dimensions, parse_profile_timeline

    user_md = str(user_store.read_memory(_cfg, user_id, "user") or "")
    dimensions = parse_profile_dimensions(user_md)
    timeline = parse_profile_timeline(user_md)

    filled_count = sum(1 for d in dimensions.values() if d.get("filled"))
    total_count = len(PROFILE_DIMENSIONS)
    completion_rate = round(filled_count / total_count, 3) if total_count > 0 else 0.0

    return jsonify(
        {
            "success": True,
            "user_id": user_id,
            "dimensions": dimensions,
            "timeline": timeline,
            "completion_rate": completion_rate,
            "filled_count": filled_count,
            "total_count": total_count,
        }
    )




def _learning_report_record_matches(
    row: Mapping[str, Any],
    lecture_id: str,
    book_id: str = "",
    chapter_index: int = -1,
) -> bool:
    """判断一条学习/测验记录是否属于当前报告范围。"""
    if not isinstance(row, MappingABC):
        return False

    if str(row.get("lecture_id") or "").strip() != str(lecture_id or "").strip():
        return False

    target_book_id = str(book_id or "").strip()
    if target_book_id and str(row.get("book_id") or "").strip() != target_book_id:
        return False

    if chapter_index >= 0 and _safe_int(row.get("chapter_index"), -1) != chapter_index:
        return False

    return True


def _learning_report_count_sessions(lecture_id: str, books: List[Dict[str, Any]], book_id: str = "") -> int:
    """统计课程或教材范围内的 session 数，用于报告展示完成度。"""
    target_book_id = str(book_id or "").strip()
    total = 0

    for book in books:
        current_book_id = str((book or {}).get("id") or "").strip()
        if not current_book_id:
            continue

        if target_book_id and current_book_id != target_book_id:
            continue

        sections_xml = str(load_book_sections_xml(_cfg, lecture_id, current_book_id) or "")
        total += len(re.findall(r"<session_name>\s*(.*?)\s*</session_name>", sections_xml, flags=re.IGNORECASE))

    return total


def _learning_report_question_stats(
    rows: List[Dict[str, Any]],
    lecture_id: str,
    book_id: str = "",
    chapter_index: int = -1,
) -> Dict[str, Any]:
    """汇总题目提交记录，区分已提交与可判定正确率。"""
    matched = [
        row for row in rows
        if _learning_report_record_matches(row, lecture_id, book_id, chapter_index)
    ]
    submitted = len(matched)
    reviewed = 0
    correct = 0
    by_difficulty: Dict[str, int] = {}

    for row in matched:
        difficulty = str(row.get("question_difficulty") or row.get("difficulty") or "未标注").strip() or "未标注"
        by_difficulty[difficulty] = by_difficulty.get(difficulty, 0) + 1

        if "is_correct" not in row:
            continue

        raw_correct = row.get("is_correct")
        if isinstance(raw_correct, bool):
            reviewed += 1
            correct += 1 if raw_correct else 0
            continue

        correct_text = str(raw_correct).strip().lower()
        if correct_text in {"1", "true", "yes", "correct"}:
            reviewed += 1
            correct += 1
        elif correct_text in {"0", "false", "no", "incorrect"}:
            reviewed += 1

    accuracy = round(correct / reviewed, 3) if reviewed > 0 else None
    recent = sorted(
        matched,
        key=lambda row: _safe_int(row.get("timestamp") or row.get("ts"), 0),
        reverse=True,
    )[:5]

    return {
        "submitted": submitted,
        "reviewed": reviewed,
        "correct": correct,
        "accuracy": accuracy,
        "by_difficulty": by_difficulty,
        "recent": [
            {
                "timestamp": _safe_int(row.get("timestamp") or row.get("ts"), 0),
                "chapter_name": str(row.get("chapter_name") or "").strip(),
                "session_name": str(row.get("session_name") or "").strip(),
                "question_title": str(row.get("question_title") or row.get("question_content") or "").strip()[:120],
                "question_difficulty": str(row.get("question_difficulty") or row.get("difficulty") or "").strip(),
                "review_state": str(row.get("review_state") or "").strip(),
            }
            for row in recent
        ],
    }


def _learning_report_reading_stats(user_id: str, lecture_id: str, books: List[Dict[str, Any]], book_id: str = "") -> Dict[str, Any]:
    """按课程教材范围聚合 telemetry 阅读行为。"""
    from api.telemetry import query_user_analysis

    target_book_id = str(book_id or "").strip()
    book_ids = [
        str((book or {}).get("id") or "").strip()
        for book in books
        if str((book or {}).get("id") or "").strip()
    ]
    if target_book_id:
        book_ids = [item for item in book_ids if item == target_book_id]

    reading_total_sec = 0.0
    reading_events = 0
    selections = 0
    annotation_asks = 0
    annotation_views = 0
    deep_read_chapters = 0

    for current_book_id in book_ids:
        analysis = query_user_analysis(user_id, book_id=current_book_id, lecture_id=lecture_id)
        reading = analysis.get("reading") if isinstance(analysis.get("reading"), dict) else {}
        annotation = analysis.get("annotation") if isinstance(analysis.get("annotation"), dict) else {}
        scroll_depth = reading.get("scroll_depth_max") if isinstance(reading.get("scroll_depth_max"), dict) else {}

        reading_total_sec += float(reading.get("total_reading_sec") or 0)
        reading_events += _safe_int(reading.get("total_events"), 0)
        selections += _safe_int(reading.get("selection_count"), 0)
        annotation_asks += _safe_int(annotation.get("ask_count"), 0)
        annotation_views += _safe_int(annotation.get("view_count"), 0)
        deep_read_chapters += sum(1 for value in scroll_depth.values() if float(value or 0) >= 0.85)

    return {
        "book_count": len(book_ids),
        "total_reading_sec": round(reading_total_sec, 1),
        "total_reading_minutes": round(reading_total_sec / 60.0, 1),
        "total_events": reading_events,
        "selection_count": selections,
        "annotation_ask_count": annotation_asks,
        "annotation_view_count": annotation_views,
        "deep_read_chapters": deep_read_chapters,
    }


def _learning_report_profile_summary(user_id: str) -> Dict[str, Any]:
    """读取用户画像维度和时间线，提供给报告面板展示。"""
    from core.memory import PROFILE_DIMENSIONS, parse_profile_dimensions, parse_profile_timeline

    user_md = str(user_store.read_memory(_cfg, user_id, "user") or "")
    dimensions = parse_profile_dimensions(user_md)
    timeline = parse_profile_timeline(user_md)
    rows = []

    for dim in PROFILE_DIMENSIONS:
        key = str(dim.get("key") or "").strip()
        row = dimensions.get(key) if isinstance(dimensions, dict) else {}
        value = str((row or {}).get("value") or "").strip()
        rows.append({
            "key": key,
            "name": str(dim.get("name") or key).strip(),
            "filled": bool((row or {}).get("filled")),
            "value": value,
            "brief": value[:120],
        })

    filled_count = sum(1 for item in rows if item.get("filled"))
    total_count = len(rows)

    return {
        "filled_count": filled_count,
        "total_count": total_count,
        "completion_rate": round(filled_count / total_count, 3) if total_count > 0 else 0.0,
        "dimensions": rows,
        "timeline": timeline,
    }


def _learning_report_recent_records(rows: List[Dict[str, Any]], lecture_id: str, book_id: str = "", chapter_index: int = -1) -> List[Dict[str, Any]]:
    """抽取最近学习行为，供报告面板展示。"""
    matched = [
        row for row in rows
        if _learning_report_record_matches(row, lecture_id, book_id, chapter_index)
    ]
    matched.sort(key=lambda row: _safe_int(row.get("timestamp") or row.get("ts"), 0), reverse=True)

    return [
        {
            "type": str(row.get("type") or "").strip(),
            "timestamp": _safe_int(row.get("timestamp") or row.get("ts"), 0),
            "book_id": str(row.get("book_id") or "").strip(),
            "chapter_name": str(row.get("chapter_name") or "").strip(),
            "session_name": str(row.get("session_name") or "").strip(),
            "source": str(row.get("source") or "").strip(),
        }
        for row in matched[:8]
    ]


def _learning_report_recommendations(
    progress_info: Mapping[str, Any],
    profile: Mapping[str, Any],
    question_stats: Mapping[str, Any],
    completed_sessions: int,
    total_sessions: int,
) -> Tuple[List[Dict[str, str]], List[Dict[str, str]]]:
    """根据报告指标生成可解释的薄弱点和下一步动作。"""
    weaknesses: List[Dict[str, str]] = []
    recommendations: List[Dict[str, str]] = []

    dimensions = profile.get("dimensions") if isinstance(profile.get("dimensions"), list) else []
    weak_area = next((row for row in dimensions if row.get("key") == "weak_areas" and row.get("filled")), None)
    error_patterns = next((row for row in dimensions if row.get("key") == "error_patterns" and row.get("filled")), None)
    next_chapter = str(progress_info.get("next_chapter") or "").strip()
    current_chapter = str(progress_info.get("current_chapter") or "").strip()
    profile_completion = float(profile.get("completion_rate") or 0)
    submitted = _safe_int(question_stats.get("submitted"), 0)
    reviewed = _safe_int(question_stats.get("reviewed"), 0)

    if weak_area:
        weaknesses.append({
            "title": "画像薄弱环节",
            "detail": str(weak_area.get("brief") or weak_area.get("value") or "").strip(),
        })

    if error_patterns:
        weaknesses.append({
            "title": "易错模式",
            "detail": str(error_patterns.get("brief") or error_patterns.get("value") or "").strip(),
        })

    if submitted > 0 and reviewed == 0:
        weaknesses.append({
            "title": "测验尚未判定",
            "detail": "已有作答记录，但当前题目还没有稳定的正确性判定。",
        })

    if total_sessions > 0 and completed_sessions < total_sessions:
        recommendations.append({
            "title": "继续推进小节",
            "detail": f"已完成 {completed_sessions}/{total_sessions} 个小节，建议先补齐当前课程的小节学习记录。",
        })

    if current_chapter:
        recommendations.append({
            "title": "下一步章节",
            "detail": f"当前应优先学习：{current_chapter}" + (f"，随后进入：{next_chapter}" if next_chapter else ""),
        })

    if profile_completion < 1:
        recommendations.append({
            "title": "补全学习画像",
            "detail": "画像维度越完整，学习路径、题目和资源推荐越稳定。",
        })

    if not recommendations:
        recommendations.append({
            "title": "保持复盘节奏",
            "detail": "当前课程数据较完整，可以继续通过测验和章节复盘巩固学习效果。",
        })

    return weaknesses, recommendations


@bp.route("/frontend/learning/report", methods=["GET"])
def frontend_learning_report():
    """返回课程/章节学习报告，聚合进度、阅读行为、测验和画像数据。"""
    user_id = _resolve_runtime_user_id()
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    user_store.ensure_user_files(_cfg, user_id)
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    book_id = str(request.args.get("book_id") or "").strip()
    chapter_index = _safe_int(request.args.get("chapter_index"), -1)

    if not lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required."}), 400

    lecture = get_learning_lecture(_cfg, lecture_id)
    if not isinstance(lecture, MappingABC):
        return jsonify({"success": False, "error": "lecture not found."}), 404

    books = list_lecture_books(_cfg, lecture_id)
    learning_records = user_store.list_learning_records(_cfg, user_id)
    question_records = user_store.list_question_completions(_cfg, user_id)
    study_hours_map = _build_user_study_hours_map(user_id, records=learning_records)

    from core.user.learning_progress import list_lecture_chapter_names as _list_lecture_chapter_names

    chapter_names = _list_lecture_chapter_names(lecture_id, books)
    scoped_learning_records = [
        row for row in learning_records
        if _learning_report_record_matches(row, lecture_id, book_id, chapter_index)
    ]
    completed_chapter_names = {
        str(row.get("chapter_name") or "").strip()
        for row in scoped_learning_records
        if str(row.get("type") or "").strip() == "chapter_completed" and str(row.get("chapter_name") or "").strip()
    }
    completed_sessions = sum(
        1
        for row in scoped_learning_records
        if str(row.get("type") or "").strip() == "session_completed"
    )
    total_sessions = _learning_report_count_sessions(lecture_id, books, book_id=book_id)
    progress_info = _compute_user_lecture_progress(user_id, lecture_id, books, records=learning_records)
    question_stats = _learning_report_question_stats(question_records, lecture_id, book_id, chapter_index)
    reading_stats = _learning_report_reading_stats(user_id, lecture_id, books, book_id=book_id)
    profile = _learning_report_profile_summary(user_id)
    weaknesses, recommendations = _learning_report_recommendations(
        progress_info,
        profile,
        question_stats,
        completed_sessions,
        total_sessions,
    )

    return jsonify({
        "success": True,
        "user_id": user_id,
        "lecture_id": lecture_id,
        "lecture_title": str(lecture.get("title") or lecture_id).strip(),
        "scope": {
            "book_id": book_id,
            "chapter_index": chapter_index,
        },
        "summary": {
            "progress_percent": _safe_int(progress_info.get("progress"), 0),
            "completed_chapters": len(completed_chapter_names),
            "total_chapters": len(chapter_names),
            "completed_sessions": completed_sessions,
            "total_sessions": total_sessions,
            "study_hours": round(float(study_hours_map.get(lecture_id, 0.0)), 2),
            "submitted_questions": _safe_int(question_stats.get("submitted"), 0),
            "reviewed_questions": _safe_int(question_stats.get("reviewed"), 0),
            "correct_questions": _safe_int(question_stats.get("correct"), 0),
            "accuracy": question_stats.get("accuracy"),
            "profile_completion_rate": profile.get("completion_rate"),
        },
        "progress": progress_info,
        "reading": reading_stats,
        "quiz": question_stats,
        "profile": profile,
        "weaknesses": weaknesses,
        "recommendations": recommendations,
        "recent_records": _learning_report_recent_records(learning_records, lecture_id, book_id, chapter_index),
        "generated_at": int(time.time()),
    })


def _learning_path_cache_path(lecture_id: str, book_id: str, user_id: str = "") -> Path:
    data_dir = Path(str(_cfg.get("data_dir") or "data")).resolve()
    if user_id:
        return data_dir / "users" / user_id / "learning_path" / f"{lecture_id}_{book_id}.json"
    return data_dir / "lectures" / lecture_id / "books" / book_id / "learning_path.json"


@bp.route("/frontend/learning-path", methods=["POST"])
def frontend_learning_path():
    """生成个性化学习路径。基于章节结构 + 用户画像，用 LLM 生成推荐顺序和原因。"""
    user_id = _resolve_runtime_user_id()
    user_store.ensure_user_files(_cfg, user_id)
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    force = bool(data.get("force"))
    cache_version = 3
    allowed_statuses = {"completed", "current", "recommended", "pending"}

    def _sanitize_path_items(raw_items):
        items = raw_items if isinstance(raw_items, list) else []
        sanitized = []

        for item in items:
            if not isinstance(item, dict):
                continue

            name = str(item.get("name") or "").strip()
            if not name:
                continue

            status = str(item.get("status") or "").strip().lower()
            if status not in allowed_statuses:
                continue

            priority_num = item.get("priority")
            try:
                priority = int(priority_num)
            except Exception:
                continue

            sanitized.append({
                "name": name,
                "priority": priority,
                "status": status,
                "reason": str(item.get("reason") or "").strip(),
            })

        return sanitized

    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400

    # 检查持久化缓存
    cache_path = _learning_path_cache_path(lecture_id, book_id, user_id)
    if not force and cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            cached_path = _sanitize_path_items(cached.get("path") if isinstance(cached, dict) else [])
            if (
                isinstance(cached, dict)
                and int(cached.get("version") or 0) == cache_version
                and cached_path
                and all(str(item.get("reason") or "").strip() for item in cached_path)
            ):
                return jsonify({"success": True, "advice": cached.get("advice", ""), "path": cached_path, "cached": True})
        except Exception:
            pass

    from core.memory import PROFILE_DIMENSIONS, parse_profile_dimensions
    from core.booksproc import build_memory_runner, get_memory_settings

    # 读取章节结构
    bookinfo_xml = str(load_book_info_xml(_cfg, lecture_id, book_id) or "")
    if not bookinfo_xml:
        return jsonify({"success": False, "error": "Book info not found. Please run coarse reading first."}), 404

    # 解析章节列表
    import re as _re
    all_chapters = []
    for m in _re.finditer(
        r"<chapter_name>\s*(.*?)\s*</chapter_name>[\s\S]*?<chapter_range>\s*(.*?)\s*</chapter_range>[\s\S]*?<chapter_summary>\s*(.*?)\s*</chapter_summary>",
        bookinfo_xml, flags=_re.IGNORECASE | _re.DOTALL,
    ):
        all_chapters.append({
            "name": str(m.group(1) or "").strip(),
            "range": str(m.group(2) or "").strip(),
            "summary": str(m.group(3) or "").strip()[:200],
        })

    if not all_chapters:
        return jsonify({"success": False, "error": "No chapters found in bookinfo."}), 404

    # 读取用户画像
    user_md = str(user_store.read_memory(_cfg, user_id, "user") or "")
    profile_dims = parse_profile_dimensions(user_md)
    weak_areas = profile_dims.get("weak_areas", {}).get("value", "")
    interest = profile_dims.get("interest_direction", {}).get("value", "")
    learning_pace = profile_dims.get("learning_pace", {}).get("value", "")

    # 读取已完成章节
    records = user_store.list_learning_records(_cfg, user_id)
    completed = set()
    for r in (records or []):
        if isinstance(r, dict) and str(r.get("type") or "").strip() == "chapter_completed" and str(r.get("lecture_id") or "").strip() == lecture_id:
            completed.add(str(r.get("chapter_name") or "").strip())

    # 只把未完成的章节传给模型，已完成的不参与路径规划
    incomplete_chapters = [c for c in all_chapters if c["name"] not in completed]

    chapters_json = json.dumps(incomplete_chapters, ensure_ascii=False)
    profile_summary = json.dumps({
        "weak_areas": weak_areas,
        "interest_direction": interest,
        "learning_pace": learning_pace,
        "completed_count": len(completed),
        "total_count": len(all_chapters),
    }, ensure_ascii=False)

    # 调用 LLM 生成路径（直接用 completions API，避免 memory model 的 system prompt 干扰）
    chapters_brief = [{"name": c["name"], "summary": c["summary"][:100]} for c in incomplete_chapters]
    chapters_brief_json = json.dumps(chapters_brief, ensure_ascii=False)

    from prompts import LEARNING_PATH_SYSTEM_PROMPT, LEARNING_PATH_USER_PROMPT
    user_prompt = LEARNING_PATH_USER_PROMPT.replace(
        "{{chapters_json}}", chapters_brief_json
    ).replace(
        "{{profile_summary}}", profile_summary
    )

    advice_text = ""
    path_items = []

    try:
        proxy = _cfg.get("__proxy__")
        if proxy is None:
            from core.nexora_proxy import NexoraProxy as _NP
            proxy = _NP(_cfg)
            _cfg["__proxy__"] = proxy
        messages = [
            {"role": "system", "content": LEARNING_PATH_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]
        default_model = get_default_nexora_model(_cfg)
        result = proxy.complete_raw(
            messages=messages,
            model=default_model or None,
            username=user_id,
            api_mode="chat",
            options={"temperature": 0.3, "max_output_tokens": 2000},
            request_timeout=120,
        )
        if not result.get("success"):
            raise RuntimeError(str(result.get("message") or "API调用失败"))
        result_text = str(result.get("content") or "")
        # 提取建议文本
        advice_match = _re.search(r"<advice>\s*(.*?)\s*</advice>", result_text, flags=_re.DOTALL)
        advice_text = str(advice_match.group(1) or "").strip() if advice_match else ""
        # 提取 JSON
        json_match = _re.search(r"\[[\s\S]*\]", str(result_text or ""))
        if json_match:
            path_items = json.loads(json_match.group(0))
        else:
            path_items = []
    except Exception as exc:
        log_event("learning_path_error", "学习路径生成失败", payload={"error": str(exc)})
        return jsonify({"success": False, "error": f"学习路径生成失败：{str(exc)}"}), 502

    path_items = _sanitize_path_items(path_items)
    if not path_items:
        return jsonify({"success": False, "error": "模型未返回有效推荐阅读。"}), 502

    if not all(str(item.get("reason") or "").strip() for item in path_items):
        return jsonify({"success": False, "error": "模型未为推荐阅读编写完整理由。"}), 502

    # 持久化缓存
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({"version": cache_version, "advice": advice_text, "path": path_items}, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass

    return jsonify({"success": True, "advice": advice_text, "path": path_items})



@bp.route("/frontend/videos", methods=["GET"])
def frontend_videos():
    """获取课程相关视频（从缓存读取，粗读时自动生成）。"""
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    book_id = str(request.args.get("book_id") or "").strip()
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400

    from core.video_search import load_cached_videos

    items = load_cached_videos(_cfg, lecture_id, book_id)
    if items:
        return jsonify({"success": True, "items": items, "cached": True})

    try:
        items = _run_frontend_video_search(lecture_id, book_id)
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "items": []}), 500

    return jsonify({"success": True, "items": items, "cached": False})


@bp.route("/frontend/lecture-videos", methods=["GET"])
def frontend_lecture_videos():
    """读取课程下所有教材已经缓存的视频，不触发新的视频搜索。"""
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    if not lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required."}), 400

    from core.video_search import load_cached_videos

    items: List[Dict[str, Any]] = []
    seen_urls: set[str] = set()
    books = list_lecture_books(_cfg, lecture_id)
    cached_book_count = 0

    for book in books:
        if not isinstance(book, MappingABC):
            continue

        book_id = str(book.get("id") or "").strip()
        if not book_id:
            continue

        rows = load_cached_videos(_cfg, lecture_id, book_id)
        if not rows:
            continue

        cached_book_count += 1
        book_title = str(book.get("title") or book_id).strip()

        for row in rows:
            if not isinstance(row, dict):
                continue

            url = str(row.get("url") or "").strip()
            if not url or url in seen_urls:
                continue

            seen_urls.add(url)
            item = dict(row)
            item["lecture_id"] = lecture_id
            item["book_id"] = book_id
            item["book_title"] = book_title
            items.append(item)

    return jsonify(
        {
            "success": True,
            "items": items,
            "cached": True,
            "book_count": len(books),
            "cached_book_count": cached_book_count,
        }
    )


@bp.route("/frontend/learning-resource-pushes", methods=["GET"])
def frontend_learning_resource_pushes():
    """后端统一抽取资源中心推送项。"""
    user_id = _resolve_runtime_user_id()
    user_store.ensure_user_files(_cfg, user_id)
    refresh = _as_bool(request.args.get("refresh"), default=False)
    selected_lecture_ids = [
        str(item or "").strip()
        for item in user_store.list_selected_lecture_ids(_cfg, user_id)
        if str(item or "").strip()
    ]

    candidate_rows, source_errors = _build_learning_resource_push_candidates(selected_lecture_ids)
    selected_rows, state = _select_learning_resource_push_rows(user_id, candidate_rows, refresh=refresh)
    stats = _learning_resource_push_stats(selected_rows)

    return jsonify(
        {
            "success": True,
            "items": selected_rows,
            "stats": stats,
            "candidate_count": len(candidate_rows),
            "selected_lecture_ids": selected_lecture_ids,
            "errors": source_errors,
            "state": {
                "current_ids": state.get("current_ids", []),
                "previous_ids": state.get("previous_ids", []),
                "signature": state.get("signature", ""),
            },
        }
    )


def _build_learning_resource_push_candidates(selected_lecture_ids: List[str]) -> Tuple[List[Dict[str, Any]], List[str]]:
    lecture_ids = [str(item or "").strip() for item in selected_lecture_ids if str(item or "").strip()]
    lecture_id_set = set(lecture_ids)
    lecture_title_map = _learning_resource_push_lecture_title_map(lecture_ids)
    rows: List[Dict[str, Any]] = []
    errors: List[str] = []

    if not lecture_ids:
        return rows, errors

    rows.extend(_build_learning_resource_article_pushes(lecture_id_set))
    cached_videos, cached_errors = _build_learning_resource_cached_video_pushes(lecture_ids, lecture_title_map)
    generated_videos, generated_errors = _build_learning_resource_generated_video_pushes(lecture_id_set, lecture_title_map)
    rows.extend(cached_videos)
    rows.extend(generated_videos)
    errors.extend(cached_errors)
    errors.extend(generated_errors)
    return _dedupe_learning_resource_push_rows(rows), errors


def _learning_resource_push_lecture_title_map(lecture_ids: List[str]) -> Dict[str, str]:
    rows: Dict[str, str] = {}

    for lecture_id in lecture_ids:
        lecture = get_learning_lecture(_cfg, lecture_id)
        if isinstance(lecture, MappingABC):
            rows[lecture_id] = str(lecture.get("title") or lecture_id).strip() or lecture_id
        else:
            rows[lecture_id] = lecture_id

    return rows


def _build_learning_resource_article_pushes(lecture_id_set: set[str]) -> List[Dict[str, Any]]:
    # 资源推送面向学习者，只允许已发布文章进入推送候选池。
    resources = list_learning_resources(_cfg, limit=300, include_drafts=False)
    rows: List[Dict[str, Any]] = []

    for resource in resources:

        if not isinstance(resource, MappingABC):
            continue

        lecture_id = str(resource.get("lecture_id") or "").strip()
        if lecture_id not in lecture_id_set:
            continue

        item = _normalize_learning_resource_article_push(resource)
        if item:
            rows.append(item)

    return rows


def _normalize_learning_resource_article_push(resource: Mapping[str, Any]) -> Dict[str, Any]:
    status = str(resource.get("status") or "").strip()
    resource_type = str(resource.get("resource_type") or "explainer").strip() or "explainer"
    title = str(resource.get("title") or "学习资源").strip()
    summary = str(resource.get("summary") or resource.get("description") or resource.get("content") or "").strip()
    lecture_title = str(resource.get("lecture_title") or "").strip()
    status_map = {
        "queued": "已排队",
        "generating": "生成中",
        "draft": "草稿",
        "draft_ready": "草稿完成",
        "failed": "失败",
    }
    badge_suffix = status_map.get(status, "草稿") if status and status != "published" else ""
    badge = f"{_learning_resource_type_label(resource_type)}{f' · {badge_suffix}' if badge_suffix else ''}"

    return {
        "id": str(resource.get("id") or f"resource_{hashlib.sha1(title.encode('utf-8')).hexdigest()[:12]}").strip(),
        "type": "practice" if resource_type == "practice" else "article",
        "source": "article",
        "badge": badge,
        "title": title,
        "subtitle": lecture_title or "学习资源",
        "description": summary or "这条资源已从后端保存，等待补充摘要或正文。",
        "reason": "草稿仅管理员可见，发布后会进入普通用户的学习资源流。" if status and status != "published" else str(resource.get("reason") or "").strip(),
        "lectureId": str(resource.get("lecture_id") or "").strip(),
        "coverUrl": "",
        "blocks": _normalize_learning_resource_push_blocks(resource),
        "content": str(resource.get("content") or "").strip(),
        "components": resource.get("components") if isinstance(resource.get("components"), MappingABC) else {},
        "resourceStatus": status,
    }


def _learning_resource_blocks_contain_plain_text_code(blocks: Any) -> bool:
    if not isinstance(blocks, list):
        return False

    for block in blocks:
        if not isinstance(block, MappingABC):
            continue

        block_type = str(block.get("type") or "").strip().lower()
        language = str(block.get("language") or block.get("lang") or "").strip()

        if block_type == "code" and is_learning_resource_plain_text_language(language):
            return True

    return False


def _normalize_learning_resource_push_blocks(resource: Mapping[str, Any]) -> List[Dict[str, Any]]:
    blocks = resource.get("blocks") if isinstance(resource.get("blocks"), list) else []
    content = str(resource.get("content") or "").strip()

    if not content:
        return blocks

    if blocks and not _learning_resource_blocks_contain_plain_text_code(blocks):
        return blocks

    components = resource.get("components") if isinstance(resource.get("components"), MappingABC) else {}

    if components and str(components.get("article_markdown") or "").strip():
        return _learning_resource_blocks_from_components(components, str(resource.get("title") or "学习资源").strip())

    return _split_learning_resource_blocks(content)


def _build_learning_resource_cached_video_pushes(
    lecture_ids: List[str],
    lecture_title_map: Mapping[str, str],
) -> Tuple[List[Dict[str, Any]], List[str]]:
    from core.video_search import load_cached_videos

    rows: List[Dict[str, Any]] = []
    errors: List[str] = []

    for lecture_id in lecture_ids:
        books = list_lecture_books(_cfg, lecture_id)

        for book in books:

            if not isinstance(book, MappingABC):
                continue

            book_id = str(book.get("id") or "").strip()
            if not book_id:
                continue

            try:
                videos = load_cached_videos(_cfg, lecture_id, book_id)
            except Exception as exc:
                errors.append(f"{lecture_title_map.get(lecture_id, lecture_id)}：缓存视频读取失败：{exc}")
                continue

            book_title = str(book.get("title") or book_id).strip()

            for index, video in enumerate(videos):
                item = _normalize_learning_resource_cached_video_push(video, lecture_id, lecture_title_map.get(lecture_id, ""), book_id, book_title, index)

                if item:
                    rows.append(item)

    return rows, errors


def _normalize_learning_resource_cached_video_push(
    video: Mapping[str, Any],
    lecture_id: str,
    lecture_title: str,
    book_id: str,
    book_title: str,
    index: int,
) -> Dict[str, Any]:
    if not isinstance(video, MappingABC):
        return {}

    url = str(video.get("url") or "").strip()
    cover_url = str(video.get("cover") or video.get("pic") or video.get("thumbnail") or "").strip()
    if not _is_learning_resource_push_url(url) or not _is_learning_resource_push_url(cover_url):
        return {}

    title = str(video.get("title") or "课程视频").strip()
    source = str(video.get("source") or "视频链接").strip()
    up_name = str(video.get("up_name") or "").strip()
    play_count = str(video.get("play_count") or "").strip()
    duration = str(video.get("duration") or "").strip()
    keyword = str(video.get("keyword") or "").strip()
    id_key = url or f"{lecture_id}:{book_id}:{title}:{index}"

    return {
        "id": f"cached-video-{hashlib.sha1(id_key.encode('utf-8')).hexdigest()[:16]}",
        "type": "video",
        "source": "cached_video",
        "badge": "缓存视频链接",
        "title": title,
        "subtitle": _join_learning_resource_push_meta([book_title or lecture_title, source]),
        "description": _join_learning_resource_push_meta([up_name, f"{play_count} 次学习" if play_count else "", duration, f"关键词：{keyword}" if keyword else ""]) or "粗读流程已经筛选并缓存的课程相关视频。",
        "reason": "来自课程教材的视频缓存，可直接跳转到原平台观看。",
        "lectureId": lecture_id,
        "bookId": book_id,
        "coverUrl": cover_url,
        "externalUrl": url,
        "action": "open-external-video",
        "actionLabel": "观看",
        "blocks": [],
        "content": f"视频来源：{_join_learning_resource_push_meta([source, up_name]) or source}\n\n链接：{url}",
        "components": {},
    }


def _build_learning_resource_generated_video_pushes(
    lecture_id_set: set[str],
    lecture_title_map: Mapping[str, str],
) -> Tuple[List[Dict[str, Any]], List[str]]:
    if not _is_runtime_teacher():
        return [], []

    rows: List[Dict[str, Any]] = []
    errors: List[str] = []

    try:
        status, payload = _request_video_generator_json("/api/projects?limit=100", method="GET")
    except Exception as exc:
        return rows, [f"已生成视频读取失败：{exc}"]

    if status >= 400 or payload.get("success") is False:
        return rows, [str(payload.get("error") or payload.get("message") or "已生成视频读取失败")]

    projects = payload.get("projects") if isinstance(payload.get("projects"), list) else []

    for project in projects:

        if not isinstance(project, MappingABC):
            continue

        item = _normalize_learning_resource_generated_video_push(project, lecture_id_set, lecture_title_map)

        if item:
            rows.append(item)

    return rows, errors


def _normalize_learning_resource_generated_video_push(
    project: Mapping[str, Any],
    lecture_id_set: set[str],
    lecture_title_map: Mapping[str, str],
) -> Dict[str, Any]:
    project_id = str(project.get("id") or "").strip()
    stages = project.get("stages") if isinstance(project.get("stages"), MappingABC) else {}
    options = project.get("options") if isinstance(project.get("options"), MappingABC) else {}
    lecture_id = str(options.get("lecture_id") or "").strip()

    if not project_id or stages.get("export") != "done" or lecture_id not in lecture_id_set:
        return {}

    cover_url = _learning_resource_generated_video_cover_url(project_id)
    if not cover_url:
        return {}

    title = str(project.get("title") or project_id or "已生成视频").strip()
    duration = str(options.get("duration") or "").strip()
    ratio = str(options.get("ratio") or "").strip()
    style = str(options.get("style") or "").strip()
    external_url = f"/api/frontend/video-generator/projects/{urllib_parse.quote(project_id, safe='')}/files/exports/video.mp4"

    return {
        "id": f"generated-video-{project_id}",
        "type": "video",
        "source": "generated_video",
        "badge": "已生成视频",
        "title": title,
        "subtitle": _join_learning_resource_push_meta([lecture_title_map.get(lecture_id, "") or "视频工作台", ratio]),
        "description": _join_learning_resource_push_meta([f"约 {duration} 秒" if duration else "", f"风格：{style}" if style else "", "MP4 成片已导出"]) or "视频工作台已完成导出的课程讲解成片。",
        "reason": "NexoraVideoGenerator 已完成导出，可直接观看生成结果。",
        "lectureId": lecture_id,
        "coverUrl": cover_url,
        "externalUrl": external_url,
        "action": "open-external-video",
        "actionLabel": "观看",
        "blocks": [],
        "content": f"视频项目：{project_id}\n\n导出文件：{external_url}",
        "components": {},
    }


def _learning_resource_generated_video_cover_url(project_id: str) -> str:
    try:
        status, payload = _request_video_generator_json(
            f"/api/projects/{urllib_parse.quote(project_id, safe='')}/artifacts/source/slides.json",
            method="GET",
        )
    except Exception:
        return ""

    if status >= 400 or payload.get("success") is False:
        return ""

    slides = payload.get("artifact") if isinstance(payload.get("artifact"), list) else []
    first = next((item for item in slides if isinstance(item, MappingABC) and str(item.get("scene_id") or "").strip()), None)

    if not isinstance(first, MappingABC):
        return ""

    scene_id = str(first.get("scene_id") or "").strip()
    return f"/api/frontend/video-generator/projects/{urllib_parse.quote(project_id, safe='')}/files/source/slides/{urllib_parse.quote(scene_id, safe='')}.png"


def _select_learning_resource_push_rows(
    user_id: str,
    candidates: List[Dict[str, Any]],
    *,
    refresh: bool,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    state = _load_learning_resource_push_state(user_id)
    rows = [row for row in candidates if isinstance(row, dict) and str(row.get("id") or "").strip()]
    signature = _learning_resource_push_signature(rows)
    stored_signature = str(state.get("signature") or "").strip()

    if signature != stored_signature:
        state = {"signature": signature, "current_ids": [], "previous_ids": [], "updated_at": 0}

    current_ids = [str(item or "").strip() for item in state.get("current_ids", []) if str(item or "").strip()]
    rows_by_id = {str(row.get("id") or "").strip(): row for row in rows}

    if (not refresh) and current_ids:
        current_rows = [rows_by_id[item_id] for item_id in current_ids if item_id in rows_by_id]

        if current_rows:
            return current_rows, state

    previous_ids = current_ids if refresh else [str(item or "").strip() for item in state.get("previous_ids", []) if str(item or "").strip()]
    selected = _draw_learning_resource_push_rows(rows, previous_ids)
    state = {
        "signature": signature,
        "current_ids": [str(row.get("id") or "").strip() for row in selected],
        "previous_ids": previous_ids,
        "updated_at": int(time.time()),
    }
    _save_learning_resource_push_state(user_id, state)
    return selected, state


def _draw_learning_resource_push_rows(rows: List[Dict[str, Any]], previous_ids: List[str]) -> List[Dict[str, Any]]:
    limit = min(6, len(rows))
    if limit <= 0:
        return []

    previous_id_set = {str(item or "").strip() for item in previous_ids if str(item or "").strip()}
    drawable = [row for row in rows if str(row.get("id") or "").strip() not in previous_id_set]

    selected = _draw_weighted_learning_resource_push_rows(drawable, limit)

    if len(selected) < limit:
        selected_ids = {str(row.get("id") or "").strip() for row in selected}
        refill_rows = [
            row
            for row in rows
            if str(row.get("id") or "").strip() not in selected_ids
        ]
        selected.extend(_draw_weighted_learning_resource_push_rows(refill_rows, limit - len(selected)))

    random.shuffle(selected)
    return selected[:limit]


def _draw_weighted_learning_resource_push_rows(rows: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    if limit <= 0:
        return []

    buckets = _bucket_learning_resource_push_rows(rows)
    selected: List[Dict[str, Any]] = []
    selected_ids: set[str] = set()

    for source, count in _learning_resource_push_source_plan(limit).items():
        selected.extend(_take_learning_resource_push_bucket_rows(buckets, source, count, selected_ids))

    if len(selected) < limit:
        selected.extend(_take_learning_resource_push_remainder_rows(rows, limit - len(selected), selected_ids))

    return selected[:limit]


def _learning_resource_push_source_plan(limit: int) -> Dict[str, int]:
    plan = {
        "article": 3,
        "cached_video": 2,
        "generated_video": 1,
    }

    total = sum(plan.values())
    if limit >= total:
        return plan

    order = ["article", "cached_video", "generated_video", "article", "cached_video", "article"]
    result = {"article": 0, "cached_video": 0, "generated_video": 0}

    for source in order[:limit]:
        result[source] += 1

    return result


def _bucket_learning_resource_push_rows(rows: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    buckets = {
        "article": [],
        "cached_video": [],
        "generated_video": [],
    }

    for row in rows:
        source = str(row.get("source") or "").strip()

        if source not in buckets:
            source = "article" if str(row.get("type") or "").strip() != "video" else "cached_video"

        buckets[source].append(row)

    for bucket_rows in buckets.values():
        random.shuffle(bucket_rows)

    return buckets


def _take_learning_resource_push_bucket_rows(
    buckets: Dict[str, List[Dict[str, Any]]],
    source: str,
    count: int,
    selected_ids: set[str],
) -> List[Dict[str, Any]]:
    if count <= 0:
        return []

    result: List[Dict[str, Any]] = []
    bucket_rows = buckets.get(source, [])

    for row in bucket_rows:
        item_id = str(row.get("id") or "").strip()

        if not item_id or item_id in selected_ids:
            continue

        selected_ids.add(item_id)
        result.append(row)

        if len(result) >= count:
            break

    return result


def _take_learning_resource_push_remainder_rows(
    rows: List[Dict[str, Any]],
    count: int,
    selected_ids: set[str],
) -> List[Dict[str, Any]]:
    if count <= 0:
        return []

    remaining = [
        row
        for row in rows
        if str(row.get("id") or "").strip() and str(row.get("id") or "").strip() not in selected_ids
    ]
    random.shuffle(remaining)
    result = remaining[:count]

    for row in result:
        selected_ids.add(str(row.get("id") or "").strip())

    return result


def _load_learning_resource_push_state(user_id: str) -> Dict[str, Any]:
    path = _learning_resource_push_state_path(user_id)

    if not path.exists():
        return {"signature": "", "current_ids": [], "previous_ids": [], "updated_at": 0}

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"signature": "", "current_ids": [], "previous_ids": [], "updated_at": 0}

    return data if isinstance(data, dict) else {"signature": "", "current_ids": [], "previous_ids": [], "updated_at": 0}


def _save_learning_resource_push_state(user_id: str, state: Mapping[str, Any]) -> None:
    path = _learning_resource_push_state_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(dict(state or {}), ensure_ascii=False, indent=2), encoding="utf-8")


def _learning_resource_push_state_path(user_id: str) -> Path:
    data_dir = Path(str(_cfg.get("data_dir") or "data")).resolve()
    return data_dir / "users" / str(user_id or "").strip() / "learning_resource_push_state.json"


def _learning_resource_push_signature(rows: List[Dict[str, Any]]) -> str:
    ids = sorted(str(row.get("id") or "").strip() for row in rows if str(row.get("id") or "").strip())
    return hashlib.sha1("\n".join(ids).encode("utf-8")).hexdigest()


def _learning_resource_push_stats(rows: List[Dict[str, Any]]) -> Dict[str, int]:
    article_count = 0
    video_count = 0

    for row in rows:
        if str(row.get("type") or "").strip() == "video":
            video_count += 1
        else:
            article_count += 1

    return {
        "total": len(rows),
        "article": article_count,
        "video": video_count,
    }


def _dedupe_learning_resource_push_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: set[str] = set()
    result: List[Dict[str, Any]] = []

    for row in rows:
        item_id = str(row.get("id") or "").strip()
        if not item_id or item_id in seen:
            continue

        seen.add(item_id)
        result.append(row)

    return result


def _is_learning_resource_push_url(value: str) -> bool:
    text = str(value or "").strip()
    return (text.startswith("/") and not text.startswith("//")) or text.startswith("http://") or text.startswith("https://")


def _join_learning_resource_push_meta(parts: List[str]) -> str:
    return " · ".join(str(part or "").strip() for part in parts if str(part or "").strip())


@bp.route("/frontend/video-generator/status", methods=["GET"])
def frontend_video_generator_status():
    """读取 NexoraVideoGenerator 服务状态。"""
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can access this endpoint."}), 403

    try:
        status, payload = _request_video_generator_json("/health", method="GET")
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 502

    return jsonify({
        "success": status < 400,
        "status": payload,
    }), 200 if status < 400 else status


@bp.route("/frontend/video-generator/projects", methods=["GET"])
def frontend_video_generator_projects():
    """读取 NexoraVideoGenerator 项目列表。"""
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can access this endpoint."}), 403

    limit = str(request.args.get("limit") or "50").strip()
    query = urllib_parse.urlencode({"limit": limit})

    try:
        status, payload = _request_video_generator_json(f"/api/projects?{query}", method="GET")
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 502

    return jsonify(payload), 200 if status < 400 else status


@bp.route("/frontend/video-generator/projects", methods=["POST"])
def frontend_video_generator_create_project():
    """从 NexoraLearning 课程资料创建视频生成项目。"""
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can create video projects."}), 403

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"success": False, "error": "JSON body is required."}), 400

    try:
        payload = _build_video_generator_learning_payload(data)
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    try:
        status, response_payload = _request_video_generator_json(
            "/api/projects/from-learning",
            method="POST",
            payload=payload,
        )
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 502

    if status >= 400 or response_payload.get("success") is False:
        return jsonify(response_payload), status

    project = response_payload.get("project") if isinstance(response_payload.get("project"), dict) else {}
    project_id = str(project.get("id") or "").strip()

    if not project_id:
        return jsonify({"success": False, "error": "VideoGenerator did not return project.id."}), 502

    queued = _start_video_generator_pipeline(project_id, "outline")
    response_payload["auto_run"] = {
        "queued": queued,
        "start_stage": "outline",
        "stages": list(_VIDEO_GENERATOR_STAGES),
    }

    return jsonify(response_payload), 202


@bp.route("/frontend/video-generator/projects/<project_id>", methods=["GET"])
def frontend_video_generator_project(project_id: str):
    """读取单个视频生成项目。"""
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can access this endpoint."}), 403

    try:
        safe_project_id = _safe_video_generator_path_part(project_id, "project_id")
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    if safe_stage not in _VIDEO_GENERATOR_STAGES:
        return jsonify({"success": False, "error": f"stage is not allowed: {safe_stage}"}), 400

    try:
        status, payload = _request_video_generator_json(f"/api/projects/{safe_project_id}", method="GET")
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 502

    return jsonify(payload), 200 if status < 400 else status


@bp.route("/frontend/video-generator/projects/<project_id>/stages/<stage>", methods=["POST"])
def frontend_video_generator_run_stage(project_id: str, stage: str):
    """从指定阶段开始继续执行视频生成项目。"""
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can run video project stages."}), 403

    try:
        safe_project_id = _safe_video_generator_path_part(project_id, "project_id")
        safe_stage = _safe_video_generator_path_part(stage, "stage")
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    try:
        status, payload = _request_video_generator_json(f"/api/projects/{safe_project_id}", method="GET")
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 502

    if status >= 400 or payload.get("success") is False:
        return jsonify(payload), status

    queued = _start_video_generator_pipeline(safe_project_id, safe_stage)

    return jsonify({
        "success": True,
        "project": payload.get("project"),
        "auto_run": {
            "queued": queued,
            "start_stage": safe_stage,
            "stages": list(_VIDEO_GENERATOR_STAGES[_VIDEO_GENERATOR_STAGES.index(safe_stage):]),
        },
    }), 202


@bp.route("/frontend/video-generator/projects/<project_id>/artifacts/<path:artifact_name>", methods=["GET"])
def frontend_video_generator_artifact(project_id: str, artifact_name: str):
    """读取视频生成项目 JSON 产物。"""
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can access this endpoint."}), 403

    try:
        safe_project_id = _safe_video_generator_path_part(project_id, "project_id")
        safe_artifact = _safe_video_generator_relative_path(artifact_name)
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    try:
        status, payload = _request_video_generator_json(
            f"/api/projects/{safe_project_id}/artifacts/{safe_artifact}",
            method="GET",
        )
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 502

    return jsonify(payload), 200 if status < 400 else status


@bp.route("/frontend/video-generator/projects/<project_id>/files/<path:relative_path>", methods=["GET"])
def frontend_video_generator_file(project_id: str, relative_path: str):
    """转发视频生成项目文件，供前端预览或下载。"""
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can access this endpoint."}), 403

    try:
        safe_project_id = _safe_video_generator_path_part(project_id, "project_id")
        safe_relative_path = _safe_video_generator_relative_path(relative_path)
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    try:
        status, body, content_type, headers = _request_video_generator_bytes(
            f"/api/projects/{safe_project_id}/files/{safe_relative_path}",
            request_headers=_video_generator_file_request_headers(),
        )
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 502

    response_headers = _video_generator_file_response_headers(headers)
    log_event(
        "video_generator_file_proxy",
        "视频生成文件代理响应",
        payload={
            "project_id": safe_project_id,
            "relative_path": safe_relative_path,
            "status": status,
            "range": str(request.headers.get("Range") or "").strip(),
            "content_range": str(response_headers.get("Content-Range") or "").strip(),
            "content_length": str(response_headers.get("Content-Length") or "").strip(),
        },
    )

    return Response(
        body,
        status=status,
        content_type=content_type,
        headers=response_headers,
    )


def _video_generator_cfg() -> Dict[str, Any]:
    branch = _cfg.get("video_generator") if isinstance(_cfg.get("video_generator"), dict) else {}
    return dict(branch)


def _video_generator_base_url() -> str:
    service_url = str(_video_generator_cfg().get("service_url") or "").strip().rstrip("/")

    if not service_url:
        raise ValueError("video_generator.service_url is required.")

    return service_url


def _video_generator_timeout() -> float:
    raw_value = _video_generator_cfg().get("request_timeout")

    if raw_value is None:
        raise ValueError("video_generator.request_timeout is required.")

    try:
        return max(10.0, min(float(raw_value), 1800.0))
    except Exception as exc:
        raise ValueError("video_generator.request_timeout must be a number.") from exc


def _request_video_generator_json(
    path: str,
    *,
    method: str,
    payload: Optional[Mapping[str, Any]] = None,
) -> Tuple[int, Dict[str, Any]]:
    url = f"{_video_generator_base_url()}{_normalize_video_generator_path(path)}"
    body = None
    headers = {"Accept": "application/json"}

    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib_request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib_request.urlopen(req, timeout=_video_generator_timeout()) as resp:
            status = int(getattr(resp, "status", 200) or 200)
            text = resp.read().decode("utf-8", errors="replace")
            data = json.loads(text) if text.strip() else {}
            return status, data if isinstance(data, dict) else {"success": False, "error": "VideoGenerator returned non-object JSON."}
    except urllib_error.HTTPError as exc:
        status = int(getattr(exc, "code", 502) or 502)
        text = exc.read().decode("utf-8", errors="replace")

        try:
            data = json.loads(text) if text.strip() else {}
        except Exception:
            data = {"success": False, "error": text or str(exc)}

        return status, data if isinstance(data, dict) else {"success": False, "error": "VideoGenerator returned non-object JSON."}
    except (urllib_error.URLError, TimeoutError, ConnectionError, OSError) as exc:
        raise RuntimeError(f"VideoGenerator 请求失败: {url} | {type(exc).__name__}: {exc}") from exc


def _video_generator_file_request_headers() -> Dict[str, str]:
    headers = {
        "Accept": "*/*",
        "Accept-Encoding": "identity",
    }

    for name in ("Range", "If-Range"):
        value = str(request.headers.get(name) or "").strip()

        if value:
            headers[name] = value

    return headers


def _video_generator_file_response_headers(source_headers: Mapping[str, Any]) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    normalized_source_headers = {
        str(key).lower(): value
        for key, value in source_headers.items()
    }

    for name in (
        "Accept-Ranges",
        "Cache-Control",
        "Content-Disposition",
        "Content-Length",
        "Content-Range",
        "ETag",
        "Last-Modified",
    ):
        value = str(normalized_source_headers.get(name.lower()) or "").strip()

        if value:
            headers[name] = value

    if "Accept-Ranges" not in headers:
        headers["Accept-Ranges"] = "bytes"

    return headers


def _request_video_generator_bytes(
    path: str,
    *,
    request_headers: Mapping[str, str],
) -> Tuple[int, bytes, str, Dict[str, str]]:
    url = f"{_video_generator_base_url()}{_normalize_video_generator_path(path)}"
    req = urllib_request.Request(url, headers=dict(request_headers), method="GET")

    try:
        with urllib_request.urlopen(req, timeout=_video_generator_timeout()) as resp:
            status = int(getattr(resp, "status", 200) or 200)
            content_type = str(resp.headers.get("Content-Type") or "application/octet-stream")
            return status, resp.read(), content_type, dict(resp.headers.items())
    except urllib_error.HTTPError as exc:
        status = int(getattr(exc, "code", 502) or 502)
        content_type = str(exc.headers.get("Content-Type") or "application/json")
        return status, exc.read(), content_type, dict(exc.headers.items())
    except (urllib_error.URLError, TimeoutError, ConnectionError, OSError) as exc:
        raise RuntimeError(f"VideoGenerator 文件请求失败: {url} | {type(exc).__name__}: {exc}") from exc


def _start_video_generator_pipeline(project_id: str, start_stage: str) -> bool:
    safe_project_id = _safe_video_generator_path_part(project_id, "project_id")
    safe_stage = _safe_video_generator_path_part(start_stage, "stage")

    if safe_stage not in _VIDEO_GENERATOR_STAGES:
        raise ValueError(f"stage is not allowed: {safe_stage}")

    with _VIDEO_GENERATOR_RUN_LOCK:

        if safe_project_id in _VIDEO_GENERATOR_RUNNING_PROJECTS:
            return False

        _VIDEO_GENERATOR_RUNNING_PROJECTS.add(safe_project_id)

    worker = threading.Thread(
        target=_run_video_generator_pipeline_worker,
        args=(safe_project_id, safe_stage),
        name=f"VideoGeneratorPipeline-{safe_project_id}",
        daemon=True,
    )
    worker.start()
    return True


def _run_video_generator_pipeline_worker(project_id: str, start_stage: str) -> None:
    stage_index = _VIDEO_GENERATOR_STAGES.index(start_stage)
    stages = _VIDEO_GENERATOR_STAGES[stage_index:]

    log_event(
        "video_generator_pipeline_start",
        "视频生成后台流程开始",
        payload={
            "project_id": project_id,
            "start_stage": start_stage,
            "stages": list(stages),
        },
    )

    try:

        for stage in stages:
            log_event(
                "video_generator_stage_start",
                "视频生成阶段开始",
                payload={
                    "project_id": project_id,
                    "stage": stage,
                },
            )
            status, payload = _request_video_generator_json(
                f"/api/projects/{project_id}/stages/{stage}",
                method="POST",
                payload={},
            )

            if status >= 400 or payload.get("success") is False:
                message = str(payload.get("message") or payload.get("error") or f"HTTP {status}").strip()
                raise RuntimeError(f"{stage} 失败: {message}")

            log_event(
                "video_generator_stage_done",
                "视频生成阶段完成",
                payload={
                    "project_id": project_id,
                    "stage": stage,
                },
            )

        log_event(
            "video_generator_pipeline_done",
            "视频生成后台流程完成",
            payload={
                "project_id": project_id,
                "start_stage": start_stage,
                "stages": list(stages),
            },
        )
    except Exception as exc:
        log_event(
            "video_generator_pipeline_failed",
            "视频生成后台流程失败",
            payload={
                "project_id": project_id,
                "start_stage": start_stage,
                "error": str(exc),
            },
        )
    finally:

        with _VIDEO_GENERATOR_RUN_LOCK:
            _VIDEO_GENERATOR_RUNNING_PROJECTS.discard(project_id)


def _normalize_video_generator_path(path: str) -> str:
    text = str(path or "").strip()

    if not text.startswith("/"):
        text = f"/{text}"

    return text


def _safe_video_generator_path_part(value: str, field_name: str) -> str:
    text = str(value or "").strip()

    if not text or not re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", text):
        raise ValueError(f"{field_name} is invalid.")

    return text


def _safe_video_generator_relative_path(value: str) -> str:
    text = str(value or "").strip().replace("\\", "/")
    parts = [part for part in text.split("/") if part]

    if not parts or any(part in {".", ".."} for part in parts):
        raise ValueError("relative path is invalid.")

    for part in parts:

        if not re.fullmatch(r"[A-Za-z0-9_.\-一-龥]+", part):
            raise ValueError("relative path contains invalid characters.")

    return "/".join(urllib_parse.quote(part, safe="") for part in parts)


def _build_video_generator_learning_payload(data: Mapping[str, Any]) -> Dict[str, Any]:
    lecture_id = str(data.get("lecture_id") or "").strip()
    title = str(data.get("title") or "").strip()

    if not lecture_id:
        raise ValueError("lecture_id is required.")

    if not title:
        raise ValueError("title is required.")

    lecture = get_learning_lecture(_cfg, lecture_id)

    if not isinstance(lecture, dict):
        raise ValueError("Lecture not found.")

    raw_book_ids = data.get("book_ids")
    if raw_book_ids is not None and not isinstance(raw_book_ids, list):
        raise ValueError("book_ids must be an array.")

    selected_book_ids = [str(item or "").strip() for item in raw_book_ids or [] if str(item or "").strip()]
    books = list_lecture_books(_cfg, lecture_id)
    book_rows = []

    if selected_book_ids:
        book_by_id = {str(book.get("id") or "").strip(): book for book in books if isinstance(book, MappingABC)}

        for book_id in selected_book_ids:
            book = book_by_id.get(book_id)

            if not isinstance(book, dict):
                raise ValueError(f"Book not found: {book_id}")

            book_rows.append(book)
    else:
        book_rows = [book for book in books if isinstance(book, dict)]

    if not book_rows:
        raise ValueError("lecture must include at least one book.")

    learning = _collect_video_generator_learning_context(lecture_id, lecture, book_rows)

    if not _video_generator_learning_has_content(learning):
        raise ValueError("课程缺少可用于生成视频的粗读、精读、章节结构或资料笔记，请先完成教材解析流程。")

    duration = str(data.get("duration") or "").strip()
    style = str(data.get("style") or "").strip()
    ratio = str(data.get("ratio") or "").strip()
    created_by = str(data.get("created_by") or _resolve_runtime_user_id() or "").strip()
    book_ids = [str(book.get("id") or "").strip() for book in book_rows if str(book.get("id") or "").strip()]

    return {
        "title": title,
        "created_by": created_by,
        "learning": learning,
        "extra_prompts": {
            "all": _video_generator_extra_prompt(duration=duration, style=style, ratio=ratio),
        },
        "options": {
            "lecture_id": lecture_id,
            "book_ids": book_ids,
            "duration": duration,
            "style": style,
            "ratio": ratio,
        },
    }


def _collect_video_generator_learning_context(
    lecture_id: str,
    lecture: Mapping[str, Any],
    book_rows: List[Mapping[str, Any]],
) -> Dict[str, Any]:
    lecture_title = str(lecture.get("title") or lecture_id).strip()
    learning: Dict[str, Any] = {
        "course_title": lecture_title,
        "audience": "课程学习者",
        "learning_goal": "生成面向课程学习的视频讲解",
    }
    coarse_blocks: List[str] = []
    intensive_blocks: List[str] = []
    chapter_structure: List[Dict[str, str]] = []
    source_notes: List[Dict[str, str]] = []

    for book in book_rows:
        book_id = str(book.get("id") or "").strip()
        book_title = str(book.get("title") or book_id).strip()

        if not book_id:
            continue

        bookinfo_xml = str(load_book_info_xml(_cfg, lecture_id, book_id) or "").strip()
        bookdetail_xml = str(load_book_detail_xml(_cfg, lecture_id, book_id) or "").strip()
        sections_xml = str(load_book_sections_xml(_cfg, lecture_id, book_id) or "").strip()
        book_text = str(load_book_text(_cfg, lecture_id, book_id) or "").strip()

        if bookinfo_xml:
            coarse_blocks.append(f"【{book_title}】\n{bookinfo_xml}")
            source_notes.append({
                "title": f"{book_title} 粗读概括",
                "content": _fit_video_generator_text(bookinfo_xml, 20000),
                "source": f"{lecture_id}/{book_id}/bookinfo.xml",
            })

        if bookdetail_xml:
            intensive_blocks.append(f"【{book_title}】\n{bookdetail_xml}")
            source_notes.append({
                "title": f"{book_title} 精读内容",
                "content": _fit_video_generator_text(bookdetail_xml, 20000),
                "source": f"{lecture_id}/{book_id}/bookdetail.xml",
            })

        if sections_xml:
            chapter_structure.append({
                "book_id": book_id,
                "book_title": book_title,
                "sections": _fit_video_generator_text(sections_xml, 12000),
            })

        if book_text and len(source_notes) < 20:
            source_notes.append({
                "title": f"{book_title} 原文节选",
                "content": _fit_video_generator_text(book_text, 20000),
                "source": f"{lecture_id}/{book_id}/book.txt",
            })

    if coarse_blocks:
        learning["coarse_reading"] = _fit_video_generator_text("\n\n".join(coarse_blocks), 20000)

    if intensive_blocks:
        learning["intensive_reading"] = _fit_video_generator_text("\n\n".join(intensive_blocks), 20000)

    if chapter_structure:
        learning["chapter_structure"] = chapter_structure

    if source_notes:
        learning["source_notes"] = source_notes[:20]

    return learning


def _fit_video_generator_text(text: str, max_chars: int) -> str:
    value = str(text or "").strip()

    if len(value) <= max_chars:
        return value

    return value[:max_chars]


def _video_generator_learning_has_content(learning: Mapping[str, Any]) -> bool:
    for key in ("coarse_reading", "intensive_reading"):
        value = learning.get(key)

        if isinstance(value, str) and value.strip():
            return True

    for key in ("chapter_structure", "source_notes"):
        value = learning.get(key)

        if isinstance(value, list) and value:
            return True

    return False


def _video_generator_extra_prompt(*, duration: str, style: str, ratio: str) -> str:
    details = []

    if duration:
        details.append(f"目标时长约 {duration} 秒")

    if style:
        details.append(f"呈现方式为 {style}")

    if ratio:
        details.append(f"画面比例为 {ratio}")

    if not details:
        return "基于课程资料生成适合课堂讲解的视频。"

    return "基于课程资料生成适合课堂讲解的视频，" + "，".join(details) + "。"


def _run_frontend_video_search(lecture_id: str, book_id: str) -> List[Dict[str, Any]]:
    """执行前端视频搜索，并把失败原因写入结构化日志。"""
    from core.video_search import search_and_cache_videos

    lecture = get_learning_lecture(_cfg, lecture_id)
    book = get_lecture_book(_cfg, lecture_id, book_id)
    lecture_title = str((lecture or {}).get("title") or "").strip()
    book_title = str((book or {}).get("title") or "").strip()
    bookinfo_xml = str(load_book_info_xml(_cfg, lecture_id, book_id) or "")

    try:
        return search_and_cache_videos(
            _cfg,
            lecture_id,
            book_id,
            lecture_title=lecture_title,
            book_title=book_title,
            bookinfo_xml=bookinfo_xml,
        )
    except Exception as exc:
        log_event(
            "frontend_video_search_error",
            "前端视频搜索失败",
            payload={
                "lecture_id": lecture_id,
                "book_id": book_id,
                "lecture_title": lecture_title,
                "book_title": book_title,
                "error": str(exc),
            },
        )
        raise


@bp.route("/frontend/videos/refresh", methods=["POST"])
def frontend_videos_refresh():
    """强制刷新视频（删除缓存后重新搜索）。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400

    from core.video_search import _videos_path as _vp
    cache_path = _vp(_cfg, lecture_id, book_id)
    if cache_path.exists():
        cache_path.unlink()

    try:
        items = _run_frontend_video_search(lecture_id, book_id)
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "items": []}), 500

    return jsonify({"success": True, "items": items, "cached": False})


@bp.route("/frontend/knowledge-graph", methods=["GET"])
def frontend_knowledge_graph():
    """读取已缓存的知识图谱。"""
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    book_id = str(request.args.get("book_id") or "").strip()
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400

    from core.knowledge_graph import load_cached_graph
    graph = load_cached_graph(_cfg, lecture_id, book_id)
    if graph:
        return jsonify({"success": True, "graph": graph, "cached": True})

    return jsonify({"success": True, "graph": None, "cached": False})


@bp.route("/frontend/knowledge-graph/generate", methods=["POST"])
def frontend_knowledge_graph_generate():
    """手动触发知识图谱生成。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400

    lecture = get_learning_lecture(_cfg, lecture_id)
    if not lecture:
        return jsonify({"success": False, "error": "Lecture not found."}), 404

    lecture_title = str(lecture.get("title") or "").strip()
    bookinfo_xml = str(load_book_info_xml(_cfg, lecture_id, book_id) or "")
    bookdetail_xml = str(load_book_detail_xml(_cfg, lecture_id, book_id) or "")

    # 获取教材标题
    book_title = ""
    books = list_lecture_books(_cfg, lecture_id)
    for book in books:
        if str(book.get("id") or "") == book_id:
            book_title = str(book.get("title") or "").strip()
            break

    try:
        from core.knowledge_graph import generate_knowledge_graph
        graph = generate_knowledge_graph(
            _cfg, lecture_id, book_id,
            lecture_title=lecture_title,
            book_title=book_title,
            bookinfo_xml=bookinfo_xml,
            bookdetail_xml=bookdetail_xml,
        )
        return jsonify({"success": True, "graph": graph, "cached": False})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@bp.route("/frontend/teacher/class-overview", methods=["GET"])
def frontend_teacher_class_overview():
    """教师 Panel 数据接口：返回全班学生的阅读状态与章节进度。"""
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can access this endpoint."}), 403

    lecture_id = str(request.args.get("lecture_id") or "").strip()
    lectures = list_learning_lectures(_cfg)
    if not lecture_id and lectures:
        lecture_id = str(lectures[0].get("id") or "").strip()

    # ── 章节列表（热力图列头） ──
    lecture_chapters: List[Dict[str, Any]] = []
    if lecture_id:
        books = list_lecture_books(_cfg, lecture_id)
        from core.user.learning_progress import list_lecture_chapters as _list_lp_chapters, \
            list_completed_chapter_names as _list_completed_names
        lecture_chapters = _list_lp_chapters(lecture_id, books)

    chapter_names = [str(c.get("title") or "").strip() for c in lecture_chapters if c.get("title")]

    # ── 遍历全班学生 ──
    students: List[Dict[str, Any]] = []
    for u in user_store.list_users(_cfg):
        if not isinstance(u, dict):
            continue
        uid = str(u.get("id") or "").strip()
        identity = str(u.get("identity") or "").strip().lower()
        if not uid or identity not in ("student", ""):
            continue
        # identity 为空也算学生（兼容旧行为）

        username = str(u.get("username") or uid).strip()
        display_name = str(u.get("display_name") or u.get("nickname") or "").strip() or username

        selected_ids = user_store.list_selected_lecture_ids(_cfg, uid)
        is_in_course = lecture_id in selected_ids if lecture_id else False

        # 学习时长
        study_hours_map = _build_user_study_hours_map(uid)
        lecture_hours = float(study_hours_map.get(lecture_id, 0.0)) if lecture_id else 0.0

        # 章节完成情况
        records = user_store.list_learning_records(_cfg, uid)
        completed_set = _list_completed_names(records, lecture_id) if lecture_id else set()

        # 最近活动时间
        last_active_ts = 0
        for r in (records or []):
            try:
                t = int(r.get("timestamp") or r.get("ts") or 0)
                if t > last_active_ts:
                    last_active_ts = t
            except Exception:
                pass

        # 用户进度
        progress_info = {"progress": 0, "current_chapter": "", "next_chapter": ""}
        if lecture_id and is_in_course:
            try:
                books = list_lecture_books(_cfg, lecture_id)
                progress_info = _compute_user_lecture_progress(uid, lecture_id, books)
            except Exception:
                pass

        # 章节完成状态 (热力图数据)
        chapter_status: List[bool] = []
        for ch_name in chapter_names:
            chapter_status.append(ch_name in completed_set)

        students.append({
            "user_id": uid,
            "username": username,
            "display_name": display_name,
            "is_in_course": is_in_course,
            "study_hours": round(lecture_hours, 2),
            "chapter_count": len(completed_set),
            "total_chapters": len(chapter_names),
            "progress": int(progress_info.get("progress") or 0),
            "current_chapter": progress_info.get("current_chapter", ""),
            "last_active_ts": last_active_ts,
            "chapter_status": chapter_status,
        })

    # 按学习时长降序
    students.sort(key=lambda s: (-s.get("study_hours", 0), s.get("display_name", "")))

    return jsonify({
        "success": True,
        "lecture_id": lecture_id,
        "chapters": [{"name": n} for n in chapter_names],
        "students": students,
    })


@bp.route("/frontend/teacher/student-analysis", methods=["GET"])
def frontend_teacher_student_analysis():
    """教师 Panel 学生详情接口：返回单个学生的 telemetry 分析数据。"""
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can access this endpoint."}), 403

    target_uid = str(request.args.get("user_id") or "").strip()
    if not target_uid:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    book_id = str(request.args.get("book_id") or "").strip()
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    since_ts_str = request.args.get("since_ts")
    since_ts = int(since_ts_str) if since_ts_str else None

    from api.telemetry import query_user_analysis
    analysis = query_user_analysis(
        target_uid,
        book_id=book_id,
        lecture_id=lecture_id,
        since_ts=since_ts,
    )

    return jsonify({"success": True, "analysis": analysis})


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

    vector_tools_available = _vector_tools_available()
    required_tools = [
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
    ]
    required_tools = _filter_vector_tool_names(required_tools, vector_tools_available)
    vector_tool_instruction = (
        "向量化与检索使用 triggerBookVectorization 和 vectorSearch。"
        if vector_tools_available
        else "NexoraDB 未连接，当前不要使用向量化或 vectorSearch；需要检索原文时使用 searchBookText。"
    )

    active_tool_skills = [
        {
            "id": "learning-course-book-tools",
            "title": "Learning Course and Book Tools",
            "required_tools": required_tools,
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
                f"{vector_tool_instruction}"
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
    # 检查每个 lecture 的大纲状态（从 job 队列获取，包含 error 状态）
    outline_status_cache: Dict[str, str] = {}
    outline_error_cache: Dict[str, str] = {}
    for job in queue_snapshot.get("jobs", []) if isinstance(queue_snapshot.get("jobs"), list) else []:
        if not isinstance(job, dict):
            continue
        job_type = str(job.get("job_type") or "").strip().lower()
        if job_type != "outline":
            continue
        lid = str(job.get("lecture_id") or "").strip()
        if not lid:
            continue
        job_status = str(job.get("status") or "").strip().lower()
        if job_status in ("running", "queued"):
            outline_status_cache[lid] = "running"
            outline_error_cache[lid] = ""
        elif job_status == "done":
            outline_status_cache[lid] = "done"
            outline_error_cache[lid] = ""
        elif job_status == "error":
            outline_status_cache[lid] = "error"
            outline_error_cache[lid] = str(job.get("error") or "").strip()
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

        # 获取大纲状态（优先使用 job 状态，否则检查文件）
        if lecture_id not in outline_status_cache:
            try:
                from core.booksproc.outline import load_outline
                outline = load_outline(_cfg, lecture_id)
                outline_status_cache[lecture_id] = "done" if outline else ""
            except Exception:
                outline_status_cache[lecture_id] = ""

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
                "summary_status": str(book.get("summary_status") or ""),
                "annotation_status": str(book.get("annotation_status") or ""),
                "outline_status": outline_status_cache.get(lecture_id, ""),
                "outline_error": outline_error_cache.get(lecture_id, ""),
                "coarse_model": str(book.get("coarse_model") or ""),
                "intensive_model": str(book.get("intensive_model") or ""),
                "question_model": str(book.get("question_model") or ""),
                "section_model": str(book.get("section_model") or ""),
                "summary_model": str(book.get("summary_model") or ""),
                "annotation_model": str(book.get("annotation_model") or ""),
                "coarse_error": str(book.get("coarse_error") or ""),
                "intensive_error": str(book.get("intensive_error") or ""),
                "question_error": str(book.get("question_error") or ""),
                "section_error": str(book.get("section_error") or ""),
                "summary_error": str(book.get("summary_error") or ""),
                "annotation_error": str(book.get("annotation_error") or ""),
                "refinement_error": str(book.get("refinement_error") or ""),
                "job_status": running_by_book.get(key, ""),
                "section_job_status": running_by_book.get(f"{key}::section", ""),
                "summary_job_status": running_by_book.get(f"{key}::summary", ""),
                "annotation_job_status": running_by_book.get(f"{key}::annotation", ""),
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


@bp.route("/frontend/settings/refinement/annotation", methods=["POST"])
def frontend_settings_refinement_annotation():
    """设置页：手动触发教材批注生成（输出写入 annotations.xml）。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    actor = str(data.get("actor") or _resolve_runtime_user_id()).strip()
    model_name = str(data.get("model_name") or "").strip()
    log_event(
        "frontend_annotation_request",
        "收到前端批注请求",
        payload={
            "lecture_id": lecture_id,
            "book_id": book_id,
            "actor": actor,
            "model_name": model_name,
            "is_admin": bool(_is_runtime_admin()),
        },
    )
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can start annotation generation."}), 403
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
    try:
        result = enqueue_book_annotation(_cfg, lecture_id, book_id, actor=actor, model_name=model_name)
        return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, **result}), 202
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@bp.route("/frontend/settings/refinement/summary", methods=["POST"])
def frontend_settings_refinement_summary():
    """设置页：手动触发全书概述生成（输出写入 booksummary.md）。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    actor = str(data.get("actor") or _resolve_runtime_user_id()).strip()
    model_name = str(data.get("model_name") or "").strip()
    log_event(
        "frontend_summary_request",
        "收到前端全书概述请求",
        payload={
            "lecture_id": lecture_id,
            "book_id": book_id,
            "actor": actor,
            "model_name": model_name,
            "is_admin": bool(_is_runtime_admin()),
        },
    )
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can start book summary generation."}), 403
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
    try:
        result = enqueue_book_summary(_cfg, lecture_id, book_id, actor=actor, model_name=model_name)
        return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, **result}), 202
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@bp.route("/frontend/settings/refinement/video", methods=["POST"])
def frontend_settings_refinement_video():
    """设置页：手动触发视频搜索。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    actor = str(data.get("actor") or _resolve_runtime_user_id()).strip()
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can start video search."}), 403
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
    try:
        from core.booksproc import enqueue_book_video
        result = enqueue_book_video(_cfg, lecture_id, book_id, actor=actor)
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


def _serialize_settings_user(user: Dict[str, Any], *, remote: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    user_data = dict(user or {})
    remote = dict(remote or {})
    role = str(remote.get("role") or user_data.get("role") or "member").strip().lower() or "member"
    identity = str(user_data.get("identity") or "").strip().lower()
    if identity not in {"student", "teacher"}:
        identity = "student"
    created_at = user_data.get("created_at") or 0
    local_user_id = str(user_data.get("id") or user_data.get("user_id") or remote.get("username") or remote.get("id") or "").strip()
    return {
        "user_id": local_user_id,
        "remote_user_id": str(remote.get("id") or "").strip(),
        "username": str(remote.get("username") or user_data.get("username") or "").strip(),
        "display_name": str(remote.get("display_name") or user_data.get("display_name") or "").strip(),
        "nickname": str(remote.get("nickname") or user_data.get("nickname") or "").strip(),
        "description": str(user_data.get("description") or "").strip(),
        "avatar_url": str(remote.get("avatar_url") or remote.get("avatar") or "").strip(),
        "role": role,
        "identity": identity,
        "is_admin": role == "admin",
        "created_at": _safe_int(created_at, 0),
    }


def _list_settings_users(query: str = "", limit: int = 200) -> List[Dict[str, Any]]:
    q = str(query or "").strip().lower()
    rows: List[Dict[str, Any]] = []
    for user in user_store.list_users(_cfg):
        if not isinstance(user, dict):
            continue
        user_id = str(user.get("id") or user.get("username") or "").strip()
        if not user_id:
            continue
        # Enrich from Nexora so avatar/role/nickname are always current.
        remote: Dict[str, Any] = {}
        if _proxy is not None:
            try:
                result = _proxy.get_user_info(username=user_id or None)
                if isinstance(result, dict) and result.get("success"):
                    remote = result.get("user") if isinstance(result.get("user"), dict) else {}
            except Exception:
                pass
        row = _serialize_settings_user(user, remote=remote)
        if not row.get("user_id"):
            continue
        if q:
            haystack = " ".join(
                str(row.get(val) or "")
                for val in ("user_id", "username", "display_name", "nickname", "description", "role", "identity")
            ).lower()
            if q not in haystack:
                continue
        rows.append(row)

    def _sort_key(item: Dict[str, Any]) -> Tuple[int, int, str]:
        role = str(item.get("role") or "").strip().lower()
        identity = str(item.get("identity") or "").strip().lower()
        if role == "admin":
            priority = 0
        elif identity == "teacher" or role == "teacher":
            priority = 1
        else:
            priority = 2
        try:
            updated_value = int(item.get("updated_at") or item.get("created_at") or 0)
        except (TypeError, ValueError):
            updated_value = 0
        return (priority, -updated_value, str(item.get("user_id") or ""))

    rows.sort(key=_sort_key)
    return rows[: max(1, min(int(limit or 200), 500))]


@bp.route("/frontend/settings/users", methods=["GET"])
def frontend_settings_users():
    """设置页：读取用户列表与身份信息。"""
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can view user settings."}), 403
    query = str(request.args.get("q") or "").strip()
    limit = _safe_int(request.args.get("limit"), 200)
    rows = _list_settings_users(query, limit)
    summary = {
        "total": len(rows),
        "admins": sum(1 for row in rows if str(row.get("role") or "").strip().lower() == "admin"),
        "teachers": sum(1 for row in rows if str(row.get("identity") or "").strip().lower() == "teacher"),
        "students": sum(1 for row in rows if str(row.get("identity") or "").strip().lower() == "student"),
    }
    return jsonify(
        {
            "success": True,
            "query": query,
            "items": rows,
            "total": len(rows),
            "summary": summary,
        }
    )


@bp.route("/frontend/settings/users/<user_id>", methods=["PATCH"])
def frontend_settings_users_patch(user_id: str):
    """设置页：更新用户身份标签。"""
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can update user settings."}), 403
    resolved_user_id = str(user_id or "").strip()
    if not resolved_user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"success": False, "error": "JSON body is required."}), 400
    identity = str(data.get("identity") or "").strip().lower()
    if identity not in {"student", "teacher"}:
        return jsonify({"success": False, "error": "identity must be student or teacher."}), 400

    current = user_store.get_user(_cfg, resolved_user_id)
    if not current:
        return jsonify({"success": False, "error": "user not found."}), 404
    actor = str(_resolve_runtime_user_id() or "").strip()
    is_target_admin = str(current.get("role") or "").strip().lower() == "admin"
    if is_target_admin and actor != resolved_user_id:
        return jsonify({"success": False, "error": "不允许修改其他管理员的身份。"}), 400

    updated = user_store.update_user(_cfg, resolved_user_id, {"identity": identity})
    if not isinstance(updated, dict):
        return jsonify({"success": False, "error": "user not found."}), 404
    remote: Dict[str, Any] = {}
    if _proxy is not None:
        try:
            result = _proxy.get_user_info(username=resolved_user_id or None)
            if isinstance(result, dict) and result.get("success"):
                remote = result.get("user") if isinstance(result.get("user"), dict) else {}
        except Exception:
            pass
    log_event(
        "settings_user_identity_updated",
        "Updated user identity from Settings.",
        payload={
            "user_id": resolved_user_id,
            "identity": identity,
            "actor": _resolve_runtime_user_id(),
        },
    )
    return jsonify({"success": True, "user": _serialize_settings_user(updated, remote=remote)})


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
                "annotation": get_annotation_settings(_cfg),
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
    annotation_updates = data.get("annotation")
    memory_updates = data.get("memory")
    profile_question_updates = data.get("profile_question")
    listed = _list_nexora_models_payload(_resolve_runtime_user_id())
    available_ids = {row.get("id", "") for row in _extract_model_options(listed.get("payload") if isinstance(listed.get("payload"), dict) else {})}
    updated_default = get_default_nexora_model(_cfg)
    updated_rough = get_rough_reading_settings(_cfg)
    updated_intensive = get_intensive_reading_settings(_cfg)
    updated_split_chapters = get_split_chapters_settings(_cfg)
    updated_annotation = get_annotation_settings(_cfg)
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
    if isinstance(annotation_updates, dict):
        annotation_model_name = str(annotation_updates.get("model_name") or "").strip()
        if annotation_model_name and annotation_model_name not in available_ids:
            return jsonify({"success": False, "error": "annotation.model_name is not in available models."}), 400
        updated_annotation = update_annotation_settings(_cfg, annotation_updates)
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
                "annotation": updated_annotation,
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

    nexoradb_status = get_nexoradb_status(_cfg)
    if not nexoradb_status.get("available"):
        return _vector_unavailable_response(nexoradb_status)

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
    nexoradb_status = get_nexoradb_status(_cfg)
    if not nexoradb_status.get("available"):
        return _vector_unavailable_response(nexoradb_status)

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
        teacher=data.get("teacher"),
        cover_path=str(data.get("cover_path") or "").strip(),
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
    allowed_fields = {"title", "description", "category", "status", "teacher", "cover_path"}
    updates = {key: value for key, value in data.items() if key in allowed_fields}
    if not updates:
        return jsonify({"success": False, "error": "No valid lecture fields provided."}), 400

    updated = update_learning_lecture(_cfg, lecture_id, updates) or lecture
    return jsonify({"success": True, "lecture": updated})


@bp.route("/lectures/<lecture_id>/teacher", methods=["PATCH"])
def update_lecture_teacher(lecture_id: str):
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can modify lecture teachers."}), 403

    lecture, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    data = request.get_json(silent=True) or {}
    if "teacher" not in data:
        return jsonify({"success": False, "error": "teacher field is required."}), 400

    updated = update_learning_lecture(_cfg, lecture_id, {"teacher": data.get("teacher")}) or lecture
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
    response = send_file(str(image_path))
    response.headers["Cache-Control"] = "public, max-age=86400"
    return response


@bp.route("/lectures/<lecture_id>/cover-assets", methods=["GET"])
def get_lecture_cover_assets(lecture_id: str):
    _, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    items = list_lecture_cover_assets(_cfg, lecture_id)
    return jsonify({"success": True, "items": items, "total": len(items)})


@bp.route("/lectures/<lecture_id>/books/<book_id>/cover-assets", methods=["GET"])
def get_book_cover_assets(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    items = list_book_cover_assets(_cfg, lecture_id, book_id)
    return jsonify({"success": True, "items": items, "total": len(items)})


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
        nexoradb_status = get_nexoradb_status(_cfg)
        vectorization_result = (
            queue_vectorize_book(_cfg, lecture_id, book_id, force=True)
            if nexoradb_status.get("available")
            else _vector_disabled_payload(nexoradb_status)
        )

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


@bp.route("/lectures/<lecture_id>/books/<book_id>/chapter/<int:chapter_index>", methods=["GET"])
def get_book_chapter_text(lecture_id: str, book_id: str, chapter_index: int):
    """按章节获取文本内容，支持按需加载。"""
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    content = load_book_text(_cfg, lecture_id, book_id)
    if not content:
        return jsonify({"success": True, "content": "", "chapter_index": chapter_index})

    # 解析章节信息
    bookinfo_xml = load_book_info_xml(_cfg, lecture_id, book_id)
    from core.user.learning_progress import parse_book_info_xml_chapters
    chapters = parse_book_info_xml_chapters(bookinfo_xml, len(content))

    if not chapters or chapter_index < 0 or chapter_index >= len(chapters):
        # 如果没有章节信息或索引无效，返回全部内容
        return jsonify({
            "success": True,
            "content": content,
            "chapter_index": chapter_index,
            "total_chars": len(content),
        })

    chapter = chapters[chapter_index]
    start = max(0, min(len(content), chapter.get("start", 0)))
    end = max(start, min(len(content), chapter.get("end", len(content))))
    chapter_content = content[start:end].strip()

    return jsonify({
        "success": True,
        "content": chapter_content,
        "chapter_index": chapter_index,
        "chapter_title": chapter.get("title", ""),
        "chapter_start": start,
        "chapter_end": end,
        "total_chars": len(chapter_content),
    })


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


@bp.route("/lectures/<lecture_id>/books/<book_id>/sections", methods=["GET"])
def get_book_sections_xml(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    content = load_book_sections_xml(_cfg, lecture_id, book_id)
    return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, "content": content})


@bp.route("/frontend/quiz/generate", methods=["POST"])
def frontend_quiz_generate():
    """为指定session生成测验题目。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    chapter_index = int(data.get("chapter_index") or 0)
    session_index = int(data.get("session_index") or 0)
    chapter_name = str(data.get("chapter_name") or "").strip()
    session_name = str(data.get("session_name") or "").strip()
    session_range = str(data.get("session_range") or "").strip()

    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400

    try:
        from core.booksproc.question import generate_session_quiz
        result = generate_session_quiz(
            _cfg,
            lecture_id=lecture_id,
            book_id=book_id,
            chapter_index=chapter_index,
            session_index=session_index,
            chapter_name=chapter_name,
            session_name=session_name,
            session_range=session_range,
        )
        return jsonify({"success": True, **result}), 200
    except Exception as exc:
        log_event("quiz_generate_error", str(exc), payload={"lecture_id": lecture_id, "book_id": book_id})
        return jsonify({"success": False, "error": str(exc)}), 500


@bp.route("/frontend/quiz/chapter", methods=["POST"])
def frontend_chapter_quiz_load():
    """读取或创建章节完成后的小测，题目一旦选定会固化到用户文件。"""
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    chapter_name = str(data.get("chapter_name") or "").strip()
    chapter_range = str(data.get("chapter_range") or "").strip()
    chapter_context = str(data.get("chapter_context") or "")
    chapter_detail_xml = str(data.get("chapter_detail_xml") or "")

    try:
        chapter_index = int(data.get("chapter_index") or 0)
    except Exception:
        return jsonify({"success": False, "error": "chapter_index is required."}), 400

    if not lecture_id or not book_id or not chapter_name:
        return jsonify({"success": False, "error": "lecture_id, book_id and chapter_name are required."}), 400

    try:
        from core.booksproc.chapter_quiz import load_or_create_chapter_quiz
        quiz = load_or_create_chapter_quiz(
            _cfg,
            user_id=username,
            lecture_id=lecture_id,
            book_id=book_id,
            chapter_index=chapter_index,
            chapter_name=chapter_name,
            chapter_range=chapter_range,
            chapter_context=chapter_context,
            chapter_detail_xml=chapter_detail_xml,
        )
        return jsonify({
            "success": True,
            "quiz": quiz,
            "quiz_id": quiz.get("quiz_id"),
            "questions": quiz.get("questions") or [],
            "answers": quiz.get("answers") or {},
        }), 200
    except Exception as exc:
        log_event(
            "chapter_quiz_load_error",
            str(exc),
            payload={"username": username, "lecture_id": lecture_id, "book_id": book_id, "chapter_name": chapter_name},
        )
        return jsonify({"success": False, "error": str(exc)}), 500


def _read_reader_guide_request_payload() -> Dict[str, Any]:
    """读取导读请求参数，供普通接口和流式接口共享。"""
    data = request.get_json(silent=True) or {}
    payload = {
        "lecture_id": str(data.get("lecture_id") or "").strip(),
        "book_id": str(data.get("book_id") or "").strip(),
        "chapter_name": str(data.get("chapter_name") or "").strip(),
        "session_name": str(data.get("session_name") or "").strip(),
        "guide_context": str(data.get("guide_context") or "").strip(),
        "pre_reading_answers": data.get("pre_reading_answers"),
        "user_profile": str(data.get("user_profile") or "").strip(),
    }

    if not payload["lecture_id"] or not payload["book_id"]:
        raise ValueError("lecture_id and book_id are required.")

    if not payload["guide_context"]:
        raise ValueError("guide_context is required.")

    return payload


def _reader_guide_sse_event(event_name: str, payload: Dict[str, Any]) -> str:
    """序列化导读 SSE 事件，统一输出 JSON data。"""
    data = json.dumps(payload, ensure_ascii=False)
    return f"event: {event_name}\ndata: {data}\n\n"


@bp.route("/frontend/reader-guide/generate", methods=["POST"])
def frontend_reader_guide_generate():
    """为当前阅读章节或小节生成导读卡片。"""
    try:
        payload = _read_reader_guide_request_payload()
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    try:
        from core.booksproc.guide import generate_reader_guide
        result = generate_reader_guide(
            _cfg,
            lecture_id=payload["lecture_id"],
            book_id=payload["book_id"],
            chapter_name=payload["chapter_name"],
            session_name=payload["session_name"],
            guide_context=payload["guide_context"],
        )
        return jsonify({"success": True, **result}), 200
    except Exception as exc:
        log_event(
            "reader_guide_error",
            str(exc),
            payload={"lecture_id": payload["lecture_id"], "book_id": payload["book_id"]},
        )
        return jsonify({"success": False, "error": str(exc)}), 500


@bp.route("/frontend/reader-guide/stream", methods=["POST"])
def frontend_reader_guide_stream():
    """以 SSE 形式流式生成当前阅读章节或小节导读。"""
    try:
        payload = _read_reader_guide_request_payload()
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    def event_stream():
        events: "queue.Queue[Tuple[str, Dict[str, Any]]]" = queue.Queue()

        def push_event(event_name: str, event_payload: Dict[str, Any]) -> None:
            events.put((event_name, event_payload))

        def push_delta(delta_text: str) -> None:
            text = str(delta_text or "")

            if text:
                append_log_text(text)
                push_event("delta", {"content": text})

        def run_worker() -> None:
            try:
                from core.booksproc.guide import generate_reader_guide

                result = generate_reader_guide(
                    _cfg,
                    lecture_id=payload["lecture_id"],
                    book_id=payload["book_id"],
                    chapter_name=payload["chapter_name"],
                    session_name=payload["session_name"],
                    guide_context=payload["guide_context"],
                    stream=True,
                    on_delta=push_delta,
                )
                push_event("done", {"success": True, **result})
            except Exception as exc:
                log_event(
                    "reader_guide_stream_error",
                    str(exc),
                    payload={"lecture_id": payload["lecture_id"], "book_id": payload["book_id"]},
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                push_event("close", {})

        thread = threading.Thread(target=run_worker, name="reader-guide-stream", daemon=True)
        thread.start()

        yield _reader_guide_sse_event("status", {"message": "reader guide stream started"})

        while True:
            try:
                event_name, event_payload = events.get(timeout=20)
            except queue.Empty:
                yield _reader_guide_sse_event("ping", {"timestamp": time.time()})
                continue

            if event_name == "close":
                break

            yield _reader_guide_sse_event(event_name, event_payload)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@bp.route("/frontend/reader-guide/pre-questions", methods=["POST"])
def frontend_reader_guide_pre_questions():
    """以 SSE 形式流式生成阅读前问题。"""
    try:
        data = request.get_json(silent=True) or {}
        lecture_id = str(data.get("lecture_id") or "").strip()
        book_id = str(data.get("book_id") or "").strip()
        chapter_name = str(data.get("chapter_name") or "").strip()
        session_name = str(data.get("session_name") or "").strip()
        guide_context = str(data.get("guide_context") or "").strip()

        if not lecture_id or not book_id:
            raise ValueError("lecture_id and book_id are required.")
        if not guide_context:
            raise ValueError("guide_context is required.")
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    def event_stream():
        events: "queue.Queue[Tuple[str, Dict[str, Any]]]" = queue.Queue()

        def push_event(event_name: str, event_payload: Dict[str, Any]) -> None:
            events.put((event_name, event_payload))

        def push_delta(delta_text: str) -> None:
            text = str(delta_text or "")
            if text:
                append_log_text(text)
                push_event("delta", {"content": text})

        def run_worker() -> None:
            try:
                from core.booksproc.guide import generate_pre_reading_questions

                result = generate_pre_reading_questions(
                    _cfg,
                    lecture_id=lecture_id,
                    book_id=book_id,
                    chapter_name=chapter_name,
                    session_name=session_name,
                    guide_context=guide_context,
                    stream=True,
                    on_delta=push_delta,
                )
                push_event("done", {"success": True, **result})
            except Exception as exc:
                log_event(
                    "pre_reading_questions_stream_error",
                    str(exc),
                    payload={"lecture_id": lecture_id, "book_id": book_id},
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                push_event("close", {})

        thread = threading.Thread(target=run_worker, name="pre-reading-questions-stream", daemon=True)
        thread.start()

        yield _reader_guide_sse_event("status", {"message": "pre-reading questions stream started"})

        while True:
            try:
                event_name, event_payload = events.get(timeout=20)
            except queue.Empty:
                yield _reader_guide_sse_event("ping", {"timestamp": time.time()})
                continue

            if event_name == "close":
                break

            yield _reader_guide_sse_event(event_name, event_payload)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@bp.route("/frontend/reader-guide/pre-questions/save", methods=["POST"])
def frontend_reader_guide_pre_questions_save():
    """保存阅读前问答结果。"""
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    chapter_index = data.get("chapter_index")
    questions = data.get("questions", [])
    answers = data.get("answers", {})
    skipped = bool(data.get("skipped"))

    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400

    if chapter_index is None:
        return jsonify({"success": False, "error": "chapter_index is required."}), 400

    # 持久化到用户目录
    from pathlib import Path

    data_dir = Path(str(_cfg.get("data_dir") or "data"))
    qa_dir = data_dir / "users" / username / "guide_qa"
    qa_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{lecture_id}_{book_id}_{chapter_index}.json"
    qa_path = qa_dir / filename

    qa_data = {
        "lecture_id": lecture_id,
        "book_id": book_id,
        "chapter_index": chapter_index,
        "questions": questions,
        "answers": answers,
        "skipped": skipped,
        "timestamp": int(time.time()),
    }

    qa_path.write_text(json.dumps(qa_data, ensure_ascii=False, indent=2), encoding="utf-8")

    log_event(
        "pre_reading_qa_saved",
        "阅读前问答已保存",
        payload={
            "username": username,
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_index": chapter_index,
            "skipped": skipped,
            "answers_count": len(answers),
        },
    )

    return jsonify({"success": True, "path": str(qa_path)})


@bp.route("/frontend/reader-guide/pre-questions/check", methods=["POST"])
def frontend_reader_guide_pre_questions_check():
    """检查是否存在阅读前问答缓存。"""
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    chapter_index = data.get("chapter_index")

    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400

    if chapter_index is None:
        return jsonify({"success": False, "error": "chapter_index is required."}), 400

    from pathlib import Path

    data_dir = Path(str(_cfg.get("data_dir") or "data"))
    qa_dir = data_dir / "users" / username / "guide_qa"
    filename = f"{lecture_id}_{book_id}_{chapter_index}.json"
    qa_path = qa_dir / filename

    if qa_path.exists():
        try:
            qa_data = json.loads(qa_path.read_text(encoding="utf-8"))
            return jsonify({"success": True, "cached": True, "data": qa_data})
        except Exception:
            return jsonify({"success": True, "cached": False})

    return jsonify({"success": True, "cached": False})


@bp.route("/frontend/reader-guide/user-profile", methods=["POST"])
def frontend_reader_guide_user_profile():
    """获取用户画像。"""
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    from pathlib import Path

    data_dir = Path(str(_cfg.get("data_dir") or "data"))
    profile_path = data_dir / "users" / username / "user.md"

    profile_content = ""
    if profile_path.exists():
        try:
            profile_content = profile_path.read_text(encoding="utf-8")
        except Exception:
            pass

    return jsonify({"success": True, "profile": profile_content})


@bp.route("/frontend/outline/<lecture_id>", methods=["GET"])
def frontend_get_outline(lecture_id: str):
    """获取课程的固化大纲。"""
    from core.booksproc.outline import load_outline

    outline = load_outline(_cfg, lecture_id)
    if outline is None:
        return jsonify({"success": False, "error": "大纲尚未生成"}), 404
    return jsonify({"success": True, "outline": outline})


@bp.route("/frontend/outline/<lecture_id>/generate", methods=["POST"])
def frontend_generate_outline(lecture_id: str):
    """手动触发课程大纲生成（异步，通过队列执行）。"""
    try:
        from core.booksproc.queue import enqueue_job

        enqueue_job(
            lecture_id,
            "outline",
            actor=_resolve_runtime_user_id() or "manual",
            force=True,
            job_type="outline",
        )
        return jsonify({"success": True, "message": "大纲生成任务已加入队列"})
    except Exception as exc:
        log_event(
            "outline_manual_error",
            str(exc),
            payload={"lecture_id": lecture_id},
        )
        return jsonify({"success": False, "error": str(exc)}), 500


@bp.route("/frontend/outline/<lecture_id>/generate-stream", methods=["GET"])
def frontend_generate_outline_stream(lecture_id: str):
    """流式生成课程大纲，向课程管理返回模型活动。"""
    safe_lecture_id = str(lecture_id or "").strip()
    runtime_user_id = _resolve_runtime_user_id() or "manual"
    if not safe_lecture_id:
        return Response("event: error\ndata: {\"error\": \"lecture_id is required\"}\n\n", mimetype="text/event-stream")

    def event_stream():
        events: "queue.Queue[Tuple[str, Dict[str, Any]]]" = queue.Queue()

        def push_event(event_name: str, event_payload: Dict[str, Any]) -> None:
            events.put((event_name, event_payload))

        def push_status(message: str) -> None:
            text = str(message or "").strip()
            if text:
                push_event("status", {"message": text})

        def push_delta(delta_text: str) -> None:
            text = str(delta_text or "")
            if text:
                append_log_text(text)
                push_event("delta", {"content": text})

        def to_sse(event_name: str, event_payload: Dict[str, Any]) -> str:
            return f"event: {event_name}\ndata: {json.dumps(event_payload, ensure_ascii=False)}\n\n"

        def run_worker() -> None:
            try:
                from core.booksproc.outline import generate_outline

                result = generate_outline(
                    _cfg,
                    safe_lecture_id,
                    user_id=runtime_user_id,
                    on_status=push_status,
                    on_delta=push_delta,
                )
                push_event("done", {"success": True, "outline": result})
            except Exception as exc:
                log_event(
                    "outline_stream_error",
                    str(exc),
                    payload={"lecture_id": safe_lecture_id},
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                push_event("close", {})

        thread = threading.Thread(target=run_worker, name="outline-generate-stream", daemon=True)
        thread.start()

        yield to_sse("status", {"message": "大纲流式生成已启动"})

        while True:
            try:
                event_name, event_payload = events.get(timeout=20)
            except queue.Empty:
                yield to_sse("ping", {"timestamp": time.time()})
                continue

            if event_name == "close":
                break

            yield to_sse(event_name, event_payload)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _quiz_answer_id(
    lecture_id: str,
    book_id: str,
    chapter_index: int,
    session_index: int,
    question_index: int,
    question_title: str,
    question_content: str,
) -> str:
    """生成稳定的测验作答记录ID，便于后续评估接口聚合。"""
    raw = "|".join(
        [
            lecture_id,
            book_id,
            str(chapter_index),
            str(session_index),
            str(question_index),
            question_title,
            question_content,
        ]
    )
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
    return f"quiz_{digest}"


def _strip_quiz_markdown(value: Any) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    text = re.sub(r"```[\s\S]*?```", lambda match: str(match.group(0)).replace("```", ""), text)
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*\d+[.)]\s+", "", text, flags=re.MULTILINE)
    text = text.replace("**", "").replace("__", "").replace("`", "")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _build_frontend_quiz_answer_record(data: Mapping[str, Any]) -> Tuple[Optional[Dict[str, Any]], str, Optional[str]]:
    """校验测验作答载荷，并构造可写入用户记录的标准结构。"""
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    chapter_name = str(data.get("chapter_name") or "").strip()
    session_name = str(data.get("session_name") or "").strip()
    question_title = str(data.get("question_title") or "").strip()
    question_content = str(data.get("question_content") or "").strip()
    question_difficulty = str(data.get("question_difficulty") or "").strip()
    question_type = str(data.get("question_type") or "").strip()
    raw_question_options = data.get("question_options")
    question_options = [
        str(item).strip()
        for item in raw_question_options
        if str(item).strip()
    ] if isinstance(raw_question_options, list) else []
    question_hint = str(data.get("question_hint") or "").strip()
    reference_answer = _strip_quiz_markdown(data.get("reference_answer"))
    student_answer = str(data.get("student_answer") or "").strip()
    quiz_id = str(data.get("quiz_id") or "").strip()

    try:
        chapter_index = int(data.get("chapter_index"))
        session_index = int(data.get("session_index"))
        question_index = int(data.get("question_index"))
    except (TypeError, ValueError):
        return None, "", "chapter_index, session_index and question_index are required."

    if not lecture_id or not book_id:
        return None, "", "lecture_id and book_id are required."

    if chapter_index < 0 or session_index < 0 or question_index < 0:
        return None, "", "chapter_index, session_index and question_index must be non-negative."

    if not question_title and not question_content:
        return None, "", "question_title or question_content is required."

    if not reference_answer:
        return None, "", "reference_answer is required for quiz feedback."

    if not student_answer:
        return None, "", "student_answer is required."

    record = {
        "type": "session_quiz_answer",
        "question_id": _quiz_answer_id(
            lecture_id,
            book_id,
            chapter_index,
            session_index,
            question_index,
            question_title,
            question_content,
        ),
        "lecture_id": lecture_id,
        "book_id": book_id,
        "chapter_index": chapter_index,
        "session_index": session_index,
        "chapter_name": chapter_name,
        "session_name": session_name,
        "question_index": question_index,
        "question_title": question_title,
        "question_content": question_content,
        "question_difficulty": question_difficulty,
        "question_type": question_type,
        "question_options": question_options,
        "question_hint": question_hint,
        "student_answer": student_answer,
        "reference_answer": reference_answer,
        "answer_chars": len(student_answer),
        "review_state": "submitted",
    }

    return record, quiz_id, None


def _save_frontend_quiz_answer_record(username: str, record: Dict[str, Any], quiz_id: str) -> Dict[str, Any]:
    """保存测验作答记录，并同步章节小测缓存文件。"""
    saved = user_store.append_question_completion(_cfg, username, record)

    if quiz_id:
        from core.booksproc.chapter_quiz import save_chapter_quiz_answer
        save_chapter_quiz_answer(
            _cfg,
            user_id=username,
            quiz_id=quiz_id,
            question_index=int(record.get("question_index") or 0),
            record=saved,
        )

    return saved


@bp.route("/frontend/quiz/submit", methods=["POST"])
def frontend_quiz_submit():
    """提交学生在测验浮层中的单题作答，并写入用户答题记录。"""
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    data = request.get_json(silent=True) or {}
    if not isinstance(data, MappingABC):
        return jsonify({"success": False, "error": "request body must be an object."}), 400

    record, quiz_id, error_message = _build_frontend_quiz_answer_record(data)
    if error_message or record is None:
        return jsonify({"success": False, "error": error_message or "invalid quiz answer payload."}), 400

    saved = _save_frontend_quiz_answer_record(username, record, quiz_id)
    log_event(
        "quiz_answer_submitted",
        "学生测验作答已提交",
        payload={
            "username": username,
            "lecture_id": record.get("lecture_id"),
            "book_id": record.get("book_id"),
            "chapter_name": record.get("chapter_name"),
            "session_name": record.get("session_name"),
            "question_index": record.get("question_index"),
            "question_id": saved.get("question_id"),
        },
    )
    return jsonify({"success": True, "record": saved})


@bp.route("/frontend/quiz/submit-batch", methods=["POST"])
def frontend_quiz_submit_batch():
    """一次性提交测验浮层中的多道题作答。"""
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    data = request.get_json(silent=True) or {}
    if not isinstance(data, MappingABC):
        return jsonify({"success": False, "error": "request body must be an object."}), 400

    raw_answers = data.get("answers")
    if not isinstance(raw_answers, list) or not raw_answers:
        return jsonify({"success": False, "error": "answers are required."}), 400

    prepared: List[Tuple[Dict[str, Any], str]] = []

    for item_index, item in enumerate(raw_answers):
        if not isinstance(item, MappingABC):
            return jsonify({"success": False, "error": f"answer {item_index + 1} must be an object."}), 400

        record, quiz_id, error_message = _build_frontend_quiz_answer_record(item)
        if error_message or record is None:
            return jsonify({"success": False, "error": error_message or "invalid quiz answer payload.", "answer_index": item_index}), 400

        prepared.append((record, quiz_id))

    records = [
        _save_frontend_quiz_answer_record(username, record, quiz_id)
        for record, quiz_id in prepared
    ]

    first_record = prepared[0][0]
    log_event(
        "quiz_answers_submitted",
        "学生测验作答已批量提交",
        payload={
            "username": username,
            "lecture_id": first_record.get("lecture_id"),
            "book_id": first_record.get("book_id"),
            "chapter_name": first_record.get("chapter_name"),
            "session_name": first_record.get("session_name"),
            "answer_count": len(records),
        },
    )
    return jsonify({"success": True, "records": records})


@bp.route("/lectures/<lecture_id>/books/<book_id>/annotations", methods=["GET"])
def get_book_annotations(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    from pathlib import Path
    data_dir = Path(str(_cfg.get("data_dir") or "data"))
    annotations_path = data_dir / "lectures" / lecture_id / "books" / book_id / "annotations.xml"
    content = ""
    if annotations_path.exists():
        try:
            content = annotations_path.read_text(encoding="utf-8")
        except Exception:
            content = ""
    return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, "content": content})


@bp.route("/lectures/<lecture_id>/books/<book_id>/summary", methods=["GET"])
def get_book_summary(lecture_id: str, book_id: str):
    """加载 summary.xml 并返回解析后的 summary_brief 和 summary_detail。"""
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    from core.booksproc import load_book_summary_from_storage
    summary = load_book_summary_from_storage(lecture_id, book_id)
    return jsonify({
        "success": True,
        "lecture_id": lecture_id,
        "book_id": book_id,
        "summary_brief": summary.get("summary_brief", ""),
        "summary_detail": summary.get("summary_detail", ""),
    })


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

    nexoradb_status = get_nexoradb_status(_cfg)
    if not nexoradb_status.get("available"):
        return _vector_unavailable_response(nexoradb_status)

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
        nexoradb_status = get_nexoradb_status(cfg)
        if nexoradb_status.get("available"):
            _ingest_chunks(cfg, course_id, material_id, chunks, filename)
        else:
            storage.update_material_meta(
                cfg,
                course_id,
                material_id,
                {
                    "ingest_status": "pending",
                    "vector_count": 0,
                    "error": str(nexoradb_status.get("message") or "NexoraDB 未连接，已跳过自动向量入库"),
                },
            )
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
        require_nexoradb_available(cfg)
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
    "read_learning_memory",
    "append_learning_memory",
    "update_learning_memory",
    "write_learning_memory",
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
    vector_tools_available = _vector_tools_available()

    for tool in list(LEARNING_TOOLS or []):
        if not isinstance(tool, dict) or str(tool.get("type") or "").strip() != "function":
            continue
        fn = tool.get("function") if isinstance(tool.get("function"), dict) else {}
        name = str(fn.get("name") or "").strip()
        if not name or name not in _RUNTIME_READONLY_TOOL_NAMES or name in names:
            continue
        if name in VECTOR_TOOL_NAMES and not vector_tools_available:
            continue
        rows.append(json.loads(json.dumps(tool, ensure_ascii=False)))
        names.add(name)
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
    vector_tools_available = _vector_tools_available()
    required_tools = [
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
        "question",
    ]
    required_tools = _filter_vector_tool_names(required_tools, vector_tools_available)
    search_instruction = (
        "and searchBookText/vectorSearch for browsing and searching course textbook information. "
        if vector_tools_available
        else "and searchBookText for browsing and searching course textbook information. NexoraDB is not connected, so vectorSearch is disabled. "
    )

    return [
        {
            "title": "Learning Read-Only Mode",
            "required_tools": required_tools,
            "mode": "force",
            "version": "1.0",
            "author": "NexoraLearning",
            "main_content": (
                "This conversation is in NexoraLearning mode. Use listLectures/getLecture/listBooks/getBook to inspect course and textbook metadata. "
                "Use getBookInfoXml for textbook coarse-reading content, getBookDetailXml for intensive-reading content, "
                "getBookQuestionsXml for generated questions, readBookTextRange/getBookText for original text reading, "
                f"{search_instruction}"
                "Do not answer from guesses when course or textbook information can be read with these tools."
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


def _runtime_select_book_rows(lecture_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for lecture_row in lecture_rows:
        if not isinstance(lecture_row, dict):
            continue
        lecture_id = str(lecture_row.get("id") or "").strip()
        lecture_title = str(lecture_row.get("title") or "").strip()
        if not lecture_id:
            continue
        books = list_lecture_books(_cfg, lecture_id) or []
        for book in books:
            if not isinstance(book, dict):
                continue
            book_id = str(book.get("id") or "").strip()
            if not book_id:
                continue
            rows.append(
                {
                    "lecture_id": lecture_id,
                    "lecture_title": lecture_title,
                    "book_id": book_id,
                    "book_title": str(book.get("title") or "").strip(),
                    "description": str(book.get("description") or "").strip(),
                    "text_chars": _safe_int(book.get("text_chars"), 0),
                    "coarse_status": str(book.get("coarse_status") or "").strip(),
                    "intensive_status": str(book.get("intensive_status") or "").strip(),
                    "question_status": str(book.get("question_status") or "").strip(),
                    "section_status": str(book.get("section_status") or "").strip(),
                    "vector_status": str(book.get("vector_status") or "").strip(),
                }
            )
    return rows


def _build_runtime_context_payload(username: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    user_id = str(username or "").strip()
    payload_map = payload if isinstance(payload, dict) else {}
    user_store.ensure_user_files(_cfg, user_id)
    lecture_rows, total_books = _runtime_select_lecture_rows(user_id, payload_map)
    book_rows = _runtime_select_book_rows(lecture_rows)
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
    from core.memory import PROFILE_DIMENSIONS, parse_profile_dimensions, parse_profile_timeline

    user_md = str(user_store.read_memory(_cfg, user_id, "user") or "")
    profile_dims = parse_profile_dimensions(user_md)
    profile_timeline = parse_profile_timeline(user_md)
    profile_rate = sum(1 for d in profile_dims.values() if d.get("filled"))
    profile_total = len(PROFILE_DIMENSIONS)
    empty_dims = [d["name"] for d in PROFILE_DIMENSIONS if not profile_dims.get(d["key"], {}).get("filled")]
    interview_active = bool(payload_map.get("interview"))

    base_system_prompt = (
        "You are in NexoraLearning mode. Use NexoraLearning tools to inspect lectures, books, overview XML, detail XML, questions XML, "
        "and only read raw text when needed. Prefer structured learning materials over direct full-text reads."
        "\n\nWhen using the question tool, set track_answer=false and omit question_id for ordinary one-off clarification questions. "
        "Set track_answer=true and provide a stable question_id only when the user's answer must be tracked, reused, or written as durable learning state."
    )

    if interview_active:
        filled_list = [
            d["name"] for d in PROFILE_DIMENSIONS if profile_dims.get(d["key"], {}).get("filled")
        ]
        filled_summary = "、".join(filled_list) or "无"
        empty_summary = "、".join(empty_dims) or "无"

        if empty_dims:
            template = PROFILE_INTERVIEW_PROMPT
        else:
            template = PROFILE_UPDATE_PROMPT

        interview_instruction = template.replace("{{filled_summary}}", filled_summary).replace("{{empty_list}}", empty_summary)
        base_system_prompt += "\n\n## 画像访谈模式（已激活）\n\n" + interview_instruction

    return {
        "learning": True,
        "lecture_id": active_lecture_id,
        "system_prompt": base_system_prompt,
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
                "type": "learning_course_books",
                "title": "Learning Course Books",
                "content": json.dumps(book_rows, ensure_ascii=False),
            },
            {
                "type": "learning_recent_records",
                "title": "Recent Learning Records",
                "content": json.dumps(recent_learning, ensure_ascii=False),
            },
            {
                "type": "learning_profile_dimensions",
                "title": "学习画像",
                "content": (
                    f"画像完整度：{profile_rate}/{profile_total}\n"
                    + "\n".join(
                        f"- {d['name']}（{d['key']}）：{'已填写 — ' + profile_dims[d['key']]['value'] if profile_dims.get(d['key'], {}).get('filled') else '未填写'}"
                        for d in PROFILE_DIMENSIONS
                    )
                    + ("\n\n待填写维度：" + "、".join(empty_dims) if empty_dims else "\n\n所有维度已填写完毕。")
                    + "\n\n## 最近进步\n"
                    + ("\n".join(f"- [{e['date']}] {e['text']}" for e in profile_timeline["progress"]) if profile_timeline["progress"] else "- 暂无记录")
                    + "\n\n## 需要注意\n"
                    + ("\n".join(f"- [{e['date']}] {e['text']}" for e in profile_timeline["attention"]) if profile_timeline["attention"] else "- 暂无")
                ),
            },
        ],
        "meta": {
            "source": "nexoralearning_runtime",
            "selected_lecture_count": len(lecture_rows),
            "total_books": total_books,
            "selected_book_count": len(book_rows),
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


def _append_learning_profile_trigger_notification(
    *,
    username: str,
    lecture_id: str,
    reason: str,
    result: Mapping[str, Any],
) -> None:
    safe_username = str(username or "").strip()
    safe_lecture_id = str(lecture_id or "").strip()
    if not safe_username:
        return
    normalized_reason = str(reason or "").strip().lower()
    profile_reasons = {
        "chapter_complete",
        "personalized_chapter_complete",
        "profile_extraction",
        "profile_question",
        "manual",
    }
    if normalized_reason not in profile_reasons:
        return
    try:
        append_notification(
            _cfg,
            safe_username,
            {
                "type": "notification",
                "source": "learning_profile_trigger",
                "title": "学习画像分析已开始",
                "content": "NexoraLearning 正在根据最新学习记录更新你的学习画像。",
                "jumpto": "learning_profile",
                "lecture_id": safe_lecture_id,
                "reason": normalized_reason,
                "job_id": str((result or {}).get("job_id") or "").strip(),
            },
        )
    except Exception as exc:
        log_event(
            "learning_profile_trigger_notification_error",
            "Failed to write learning profile trigger notification.",
            payload={
                "username": safe_username,
                "lecture_id": safe_lecture_id,
                "reason": normalized_reason,
                "error": str(exc),
            },
        )


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
    _append_learning_profile_trigger_notification(
        username=username,
        lecture_id=lecture_id,
        reason=reason,
        result=result if isinstance(result, Mapping) else {},
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


def _annotate_question_bank_rows(rows: List[Dict[str, Any]], completions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    def _question_text(row: MappingABC) -> Tuple[str, str]:
        question = row.get("question") if isinstance(row.get("question"), MappingABC) else {}
        title = str(
            question.get("question_title")
            or question.get("title")
            or question.get("question")
            or row.get("question_title")
            or row.get("title")
            or ""
        ).strip()
        content = str(
            question.get("question_content")
            or question.get("content")
            or row.get("question_content")
            or row.get("content")
            or ""
        ).strip()
        return title, content

    completion_by_question_id: Dict[str, Dict[str, Any]] = {}
    completion_by_fingerprint: Dict[str, Dict[str, Any]] = {}
    for completion in completions:
        if not isinstance(completion, MappingABC):
            continue
        completion_row = dict(completion)
        qid = str(completion_row.get("question_id") or "").strip()
        if qid:
            completion_by_question_id[qid] = completion_row
        title = str(completion_row.get("question_title") or "").strip()
        content = str(completion_row.get("question_content") or "").strip()
        fingerprint = "|".join(
            [
                str(completion_row.get("lecture_id") or "").strip(),
                str(completion_row.get("book_id") or "").strip(),
                str(completion_row.get("chapter_name") or "").strip(),
                title,
                content,
            ]
        )
        if fingerprint.strip("|"):
            completion_by_fingerprint[fingerprint] = completion_row

    annotated_rows: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, MappingABC):
            continue
        item = dict(row)
        qid = str(item.get("question_id") or "").strip()
        latest = completion_by_question_id.get(qid)
        if latest is None:
            title, content = _question_text(item)
            fingerprint = "|".join(
                [
                    str(item.get("lecture_id") or "").strip(),
                    str(item.get("book_id") or "").strip(),
                    str(item.get("chapter_name") or "").strip(),
                    title,
                    content,
                ]
            )
            latest = completion_by_fingerprint.get(fingerprint)
        if latest:
            item["latest_completion"] = latest
            item["answer_state"] = "needs_review" if latest.get("is_correct") is False else "submitted"
        else:
            item["answer_state"] = "pending"
        annotated_rows.append(item)
    return annotated_rows


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
    answer_state_filter = str(request.args.get("answer_state") or "").strip()
    question_type_filter = str(request.args.get("question_type") or "").strip()
    group_mode = str(request.args.get("group_mode") or "").strip().lower()
    page = max(1, _safe_int(request.args.get("page"), 1))
    page_size = min(50, max(1, _safe_int(request.args.get("page_size"), 5)))
    rows = list(user_store.list_question_bank_items(_cfg, username) or [])
    completions = list(user_store.list_question_completions(_cfg, username) or [])
    rows = _annotate_question_bank_rows(rows, completions)
    if lecture_id:
        rows = [row for row in rows if str((row or {}).get("lecture_id") or "").strip() == lecture_id]
    if answer_state_filter and answer_state_filter != "all":
        rows = [row for row in rows if str((row or {}).get("answer_state") or "").strip() == answer_state_filter]
    if question_type_filter and question_type_filter != "all":
        rows = [
            row
            for row in rows
            if _question_bank_type_label(_question_bank_question_payload(row)) == question_type_filter
        ]
    rows = list(reversed(rows))
    summary = {
        "total": len(rows),
        "pending": sum(1 for row in rows if str((row or {}).get("answer_state") or "") == "pending"),
        "submitted": sum(1 for row in rows if str((row or {}).get("answer_state") or "") == "submitted"),
        "needs_review": sum(1 for row in rows if str((row or {}).get("answer_state") or "") == "needs_review"),
    }
    if group_mode in {"chapter", "group", "groups"}:
        groups = _build_question_bank_groups(rows)
        total_groups = len(groups)
        total_pages = max(1, (total_groups + page_size - 1) // page_size)
        page = min(page, total_pages)
        start = (page - 1) * page_size
        page_groups = groups[start:start + page_size]
        return jsonify(
            {
                "success": True,
                "items": [item for group in page_groups for item in group.get("items", [])],
                "groups": page_groups,
                "total": len(rows),
                "total_groups": total_groups,
                "summary": summary,
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total": total_groups,
                    "total_items": len(rows),
                    "total_pages": total_pages,
                    "has_prev": page > 1,
                    "has_next": page < total_pages,
                },
            }
        )

    total = len(rows)
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = min(page, total_pages)
    start = (page - 1) * page_size
    page_rows = rows[start:start + page_size]
    return jsonify(
        {
            "success": True,
            "items": page_rows,
            "total": total,
            "summary": summary,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": total_pages,
                "has_prev": page > 1,
                "has_next": page < total_pages,
            },
        }
    )


@bp.route("/frontend/question-bank/groups/<path:group_id>", methods=["GET"])
def frontend_question_bank_group_detail(group_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    target_group_id = str(group_id or "").strip()
    if not target_group_id:
        return jsonify({"success": False, "error": "group_id is required."}), 400

    rows = list(user_store.list_question_bank_items(_cfg, username) or [])
    completions = list(user_store.list_question_completions(_cfg, username) or [])
    rows = list(reversed(_annotate_question_bank_rows(rows, completions)))
    groups = _build_question_bank_groups(rows)
    group = next(
        (
            item
            for item in groups
            if str(item.get("group_id") or item.get("question_group_id") or "").strip() == target_group_id
        ),
        None,
    )
    if group is None:
        return jsonify({"success": False, "error": "question group not found."}), 404
    return jsonify(
        {
            "success": True,
            "group": group,
            "items": group.get("items") if isinstance(group.get("items"), list) else [],
        }
    )


def _question_bank_group_key(row: MappingABC) -> str:
    explicit = str(row.get("question_group_id") or row.get("group_id") or "").strip()
    if explicit:
        return explicit
    raw = "|".join(
        [
            str(row.get("lecture_id") or "").strip(),
            str(row.get("book_id") or "").strip(),
            str(row.get("chapter_name") or "").strip(),
            str(row.get("chapter_range") or "").strip(),
            str(row.get("generation_mode") or row.get("reason") or row.get("type") or "").strip(),
        ]
    )
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
    return f"qg_{digest}"


def _question_bank_group_title(row: MappingABC) -> str:
    explicit = str(row.get("question_group_title") or row.get("group_title") or row.get("paper_title") or "").strip()
    if explicit:
        return explicit
    source = _question_bank_group_source(row)
    chapter_name = str(row.get("chapter_name") or "").strip()
    book_title = str(row.get("book_title") or "").strip()
    base = chapter_name or book_title
    if source == "画像出题":
        return f"{base} 画像专项练习" if base else "画像专项练习"
    if source == "章节小测":
        return f"{base} 章节小测" if base else "章节小测"
    return f"{base} 练习题组" if base else "未命名题组"


def _question_bank_group_source(row: MappingABC) -> str:
    mode = str(row.get("generation_mode") or "").strip()
    reason = str(row.get("reason") or "").strip()
    if mode == "profile_adaptive":
        return "画像出题"
    if mode == "chapter_quiz_sync" or reason == "chapter_quiz_empty_bank":
        return "章节小测"
    return "题库沉淀"


def _build_question_bank_groups(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    groups: List[Dict[str, Any]] = []
    group_by_id: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, MappingABC):
            continue
        group_id = _question_bank_group_key(row)
        group = group_by_id.get(group_id)
        if group is None:
            group = {
                "group_id": group_id,
                "question_group_id": group_id,
                "title": _question_bank_group_title(row),
                "source": _question_bank_group_source(row),
                "lecture_id": str(row.get("lecture_id") or "").strip(),
                "lecture_title": str(row.get("lecture_title") or "").strip(),
                "book_id": str(row.get("book_id") or "").strip(),
                "book_title": str(row.get("book_title") or "").strip(),
                "chapter_name": str(row.get("chapter_name") or "").strip(),
                "chapter_range": str(row.get("chapter_range") or "").strip(),
                "generation_mode": str(row.get("generation_mode") or "").strip(),
                "reason": str(row.get("reason") or "").strip(),
                "items": [],
                "total_count": 0,
                "answered_count": 0,
                "correct_count": 0,
                "pending_count": 0,
                "needs_review_count": 0,
                "created_timestamp": 0,
                "latest_timestamp": 0,
            }
            group_by_id[group_id] = group
            groups.append(group)
        group["items"].append(row)
        group["total_count"] = len(group["items"])
        answer_state = str(row.get("answer_state") or "").strip()
        if answer_state == "pending":
            group["pending_count"] = int(group.get("pending_count") or 0) + 1
        else:
            group["answered_count"] = int(group.get("answered_count") or 0) + 1
        if answer_state == "needs_review":
            group["needs_review_count"] = int(group.get("needs_review_count") or 0) + 1
        latest = row.get("latest_completion") if isinstance(row.get("latest_completion"), MappingABC) else {}
        if latest.get("is_correct") is True:
            group["correct_count"] = int(group.get("correct_count") or 0) + 1
        try:
            row_timestamp = int(row.get("timestamp") or 0)
            if row_timestamp > 0:
                current_created = int(group.get("created_timestamp") or 0)
                group["created_timestamp"] = row_timestamp if current_created <= 0 else min(current_created, row_timestamp)
                group["latest_timestamp"] = max(int(group.get("latest_timestamp") or 0), row_timestamp)
        except Exception:
            pass
    title_counts: Dict[str, int] = {}
    for group in groups:
        title = str(group.get("title") or "").strip()
        if title:
            title_counts[title] = title_counts.get(title, 0) + 1
    title_seen: Dict[str, int] = {}
    for group in groups:
        title = str(group.get("title") or "").strip()
        if not title or title_counts.get(title, 0) <= 1:
            continue
        title_seen[title] = title_seen.get(title, 0) + 1
        group["base_title"] = title
        timestamp = _safe_int(group.get("latest_timestamp"), 0)
        suffix = time.strftime("%m-%d %H:%M", time.localtime(timestamp)) if timestamp > 0 else "生成记录"
        suffix = f"{suffix} #{title_seen[title]}"
        group["title"] = f"{title} · {suffix}"
    return groups


def _normalize_question_bank_options(value: Any) -> List[Dict[str, str]]:
    if isinstance(value, str):
        raw_items = [line for line in value.splitlines() if line.strip()]
    elif isinstance(value, list):
        raw_items = value
    else:
        raw_items = []
    options: List[Dict[str, str]] = []
    for idx, item in enumerate(raw_items):
        fallback_label = chr(ord("A") + idx)
        label = ""
        text = ""
        if isinstance(item, MappingABC):
            label = str(item.get("id") or item.get("label") or item.get("key") or item.get("option_id") or "").strip()
            text = str(item.get("text") or item.get("content") or item.get("value") or item.get("title") or "").strip()
        else:
            text = str(item or "").strip()
        match = re.match(r"^\s*([a-zA-Z])\s*[.、:：)]\s*(.+)$", text)
        if match:
            if not label:
                label = match.group(1)
            text = match.group(2).strip()
        label = (label or fallback_label).upper()[:3]
        if not text and not label:
            continue
        options.append(
            {
                "label": label,
                "text": text,
                "value": f"{label}. {text}" if text else label,
            }
        )
    return options


def _question_bank_question_payload(row: MappingABC) -> Dict[str, Any]:
    question = row.get("question") if isinstance(row.get("question"), MappingABC) else {}
    options = (
        question.get("question_options")
        or question.get("options")
        or row.get("question_options")
        or row.get("options")
    )
    return {
        "title": str(
            question.get("question_title")
            or question.get("title")
            or question.get("question")
            or row.get("question_title")
            or row.get("title")
            or ""
        ).strip(),
        "content": str(
            question.get("question_content")
            or question.get("content")
            or row.get("question_content")
            or row.get("content")
            or ""
        ).strip(),
        "answer": str(
            question.get("question_answer")
            or question.get("answer")
            or row.get("reference_answer")
            or ""
        ).strip(),
        "hint": str(question.get("question_hint") or question.get("hint") or row.get("question_hint") or "").strip(),
        "difficulty": str(question.get("question_difficulty") or question.get("difficulty") or row.get("question_difficulty") or "").strip(),
        "type": str(question.get("question_type") or question.get("type") or row.get("question_type") or row.get("type") or "").strip(),
        "options": _normalize_question_bank_options(options),
    }


def _question_bank_type_label(question: Mapping[str, Any]) -> str:
    options = question.get("options") if isinstance(question.get("options"), list) else []
    raw_type = str(question.get("type") or "").strip().lower()
    if raw_type in {"choice", "single_choice", "选择题", "单选题"}:
        return "选择题"
    if raw_type in {"multiple_choice", "多选题"}:
        return "多选题"
    if raw_type in {"true_false", "判断题"}:
        return "判断题"
    if raw_type in {"code", "practice", "实践题", "代码题"}:
        return "实践题"
    if len(options) >= 2:
        return "选择题"
    return "简答题"


def _normalize_question_bank_answer(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"^\s*(正确答案|参考答案|答案)\s*[:：]?\s*", "", text)
    text = re.sub(r"^\s*([a-z])\s*[.、:：)]\s*", r"\1 ", text)
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"[，。,.、:：;；（）()【】\\[\\]{}\"'`*_<>]", "", text)
    return text


def _extract_question_bank_choice_letter(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    patterns = (
        r"^\s*([a-zA-Z])\s*[.、:：)]",
        r"^\s*([a-zA-Z])\s*$",
        r"(?:正确答案|参考答案|答案|选择|选项|选)\s*[:：]?\s*([a-zA-Z])\b",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1).lower()
    return ""


def _extract_question_bank_choice_letters(value: Any) -> List[str]:
    text = str(value or "").strip()
    if not text:
        return []
    cleaned = re.sub(r"^\s*(正确答案|参考答案|答案|选择|选项|选)\s*[:：]?\s*", "", text)
    letters = re.findall(r"\b([a-zA-Z])\b|([a-zA-Z])\s*[.、:：)]", cleaned)
    result: List[str] = []
    for pair in letters:
        letter = str(pair[0] or pair[1] or "").strip().lower()
        if letter and letter not in result:
            result.append(letter)
    if result:
        return result
    single = _extract_question_bank_choice_letter(value)
    return [single] if single else []


def _question_bank_auto_judge(question: Mapping[str, Any], student_answer: str) -> Optional[bool]:
    reference_answer = str(question.get("answer") or "").strip()
    if not reference_answer:
        return None
    normalized_student = _normalize_question_bank_answer(student_answer)
    normalized_reference = _normalize_question_bank_answer(reference_answer)
    if not normalized_student or not normalized_reference:
        return None

    options = question.get("options") if isinstance(question.get("options"), list) else []
    question_type = str(question.get("type") or "").strip().lower()
    looks_choice = len(options) >= 2 or question_type in {"choice", "single_choice", "multiple_choice", "选择题", "单选题", "多选题"}
    if looks_choice:
        if question_type in {"multiple_choice", "多选题"}:
            student_letters = _extract_question_bank_choice_letters(student_answer)
            reference_letters = _extract_question_bank_choice_letters(reference_answer)
            if student_letters and reference_letters:
                return set(student_letters) == set(reference_letters)
        student_letter = _extract_question_bank_choice_letter(student_answer)
        reference_letter = _extract_question_bank_choice_letter(reference_answer)
        if student_letter and reference_letter:
            return student_letter == reference_letter
    if normalized_student == normalized_reference:
        return True
    if looks_choice:
        return normalized_student in normalized_reference or normalized_reference in normalized_student
    return None


@bp.route("/frontend/question-bank/submit", methods=["POST"])
def frontend_question_bank_submit():
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    data = request.get_json(silent=True) or {}
    if not isinstance(data, MappingABC):
        return jsonify({"success": False, "error": "request body must be an object."}), 400

    question_id = str(data.get("question_id") or "").strip()
    student_answer = str(data.get("student_answer") or "").strip()
    if not question_id:
        return jsonify({"success": False, "error": "question_id is required."}), 400
    if not student_answer:
        return jsonify({"success": False, "error": "student_answer is required."}), 400

    rows = list(user_store.list_question_bank_items(_cfg, username) or [])
    source_row = None
    for row in rows:
        if isinstance(row, MappingABC) and str(row.get("question_id") or "").strip() == question_id:
            source_row = row
            break
    if source_row is None:
        return jsonify({"success": False, "error": "question not found."}), 404

    question = _question_bank_question_payload(source_row)
    title = question.get("title") or question.get("content") or "题库练习"
    is_correct = _question_bank_auto_judge(question, student_answer)
    review_state = "review_required" if is_correct is False else "submitted"
    record = {
        "type": "question_bank_answer",
        "question_id": question_id,
        "lecture_id": str(source_row.get("lecture_id") or "").strip(),
        "book_id": str(source_row.get("book_id") or "").strip(),
        "chapter_name": str(source_row.get("chapter_name") or "").strip(),
        "chapter_range": str(source_row.get("chapter_range") or "").strip(),
        "question_title": title,
        "question_content": question.get("content") or "",
        "question_difficulty": question.get("difficulty") or "",
        "question_type": question.get("type") or "",
        "question_options": question.get("options") or [],
        "question_hint": question.get("hint") or "",
        "student_answer": student_answer,
        "reference_answer": question.get("answer") or "",
        "answer_chars": len(student_answer),
        "review_state": review_state,
        "source": "question_bank_center",
    }
    if is_correct is not None:
        record["is_correct"] = bool(is_correct)

    saved = user_store.append_question_completion(_cfg, username, record)
    answer_state = "needs_review" if saved.get("is_correct") is False else "submitted"
    log_event(
        "question_bank_answer_submitted",
        "题库中心作答已提交",
        payload={
            "username": username,
            "question_id": question_id,
            "lecture_id": saved.get("lecture_id"),
            "book_id": saved.get("book_id"),
            "answer_state": answer_state,
        },
    )
    return jsonify({"success": True, "record": saved, "answer_state": answer_state})


RESOURCE_TYPE_LABELS = {
    "explainer": "科普解释",
    "concept": "概念辨析",
    "practice": "实操案例",
    "review": "复习清单",
}


def _learning_resource_type_label(value: Any) -> str:
    key = str(value or "explainer").strip()
    return RESOURCE_TYPE_LABELS.get(key, "资源文章")


def _learning_resource_lecture_title(lecture_id: str) -> str:
    target_id = str(lecture_id or "").strip()
    if not target_id:
        return "当前课程"
    lecture = get_learning_lecture(_cfg, target_id) or {}
    return str(lecture.get("title") or lecture.get("name") or target_id).strip() or target_id


def _normalize_learning_resource_topic_payload(data: Any) -> List[Dict[str, str]]:
    if not isinstance(data, MappingABC):
        raise ValueError("选题工具参数根节点必须是对象。")

    raw_topics = data.get("topics")
    if not isinstance(raw_topics, list):
        raise ValueError("选题工具参数缺少 topics 数组。")

    topics: List[Dict[str, str]] = []
    seen = set()

    for item in raw_topics:
        if isinstance(item, MappingABC):
            title = str(item.get("title") or item.get("name") or "").strip()
            reason = str(item.get("reason") or item.get("description") or "").strip()
        else:
            title = str(item or "").strip()
            reason = ""
        title = re.sub(r"\s+", " ", title).strip(" -:：。")
        if not title or title in seen:
            continue
        seen.add(title)
        topics.append(
            {
                "id": f"topic_{len(topics) + 1}",
                "title": title[:80],
                "reason": reason[:180],
                "source": "llm",
            }
        )
        if len(topics) >= 10:
            break

    if len(topics) < 10:
        raise ValueError(f"选题工具参数中有效选题不足 10 个，实际为 {len(topics)} 个。")

    return topics


def _learning_resource_topic_tool_spec() -> Dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": "submit_resource_topics",
            "description": "Submit learning resource topic suggestions for admin selection.",
            "parameters": {
                "type": "object",
                "properties": {
                    "topics": {
                        "type": "array",
                        "description": "Ten concrete topic suggestions based on the course context.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "reason": {"type": "string"},
                            },
                            "required": ["title", "reason"],
                        },
                    },
                },
                "required": ["topics"],
            },
        },
    }


def _build_learning_resource_topic_suggestions(
    lecture_id: str,
    lecture_title: str,
    resource_type: str,
    username: str = "",
) -> List[Dict[str, str]]:
    course_context = _build_learning_resource_course_context(lecture_id)
    variables = {
        "lecture_id": lecture_id,
        "lecture_title": lecture_title or "当前课程",
        "resource_type": resource_type,
        "resource_type_label": _learning_resource_type_label(resource_type),
        "course_context": course_context[:9000] if course_context else "暂无课程/教材上下文。",
        "username": username,
    }
    system_prompt = _render_learning_resource_prompt(
        _learning_resource_prompt_text("LEARNING_RESOURCE_TOPIC_SYSTEM_PROMPT"),
        variables,
    )
    user_prompt = _render_learning_resource_prompt(
        _learning_resource_prompt_text("LEARNING_RESOURCE_TOPIC_USER_PROMPT"),
        variables,
    )
    proxy = _proxy or NexoraProxy(_cfg)
    model = get_default_nexora_model(_cfg) or None
    ctx = _new_learning_resource_context(
        system_prompt,
        user_prompt,
        flow="learning_resource_topics",
        max_chars=18000,
    )
    result = proxy.chat_completions(
        messages=_learning_resource_context_messages(ctx),
        model=model,
        username=username or None,
        options={
            "temperature": 0.65,
            "stream": False,
            "tools": [_learning_resource_topic_tool_spec()],
            "tool_choice": {"type": "function", "function": {"name": "submit_resource_topics"}},
        },
        request_timeout=240,
    )

    if not result.get("ok"):
        status = result.get("status")
        endpoint = str(result.get("endpoint") or "").strip()
        message = str(result.get("message") or "request failed").strip()
        raise RuntimeError(f"Nexora 选题调用失败：{message}，status={status}，endpoint={endpoint}。")

    payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
    choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
    message = choices[0].get("message") if choices and isinstance(choices[0], MappingABC) else {}
    tool_calls = message.get("tool_calls") if isinstance(message.get("tool_calls"), list) else []

    for call in tool_calls:
        if not isinstance(call, MappingABC):
            continue

        func = call.get("function") if isinstance(call.get("function"), MappingABC) else {}

        if str(func.get("name") or "").strip() != "submit_resource_topics":
            continue

        try:
            args = json.loads(str(func.get("arguments") or "{}"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"submit_resource_topics 参数不是合法 JSON：{exc.msg}。") from exc

        return _normalize_learning_resource_topic_payload(args)

    raise ValueError("模型没有调用 submit_resource_topics 工具提交选题。")


def _learning_resource_scan_tool_spec() -> Dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": "submit_resource_scan",
            "description": "Submit the final publish scan result for a learning resource.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {"type": "string", "enum": ["passed", "rejected"]},
                    "summary": {"type": "string"},
                    "checked": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "issues": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                                "title": {"type": "string"},
                                "detail": {"type": "string"},
                            },
                            "required": ["severity", "title", "detail"],
                        },
                    },
                },
                "required": ["status", "summary", "checked", "issues"],
            },
        },
    }


def _learning_resource_summary(title: str, resource_type: str, lecture_title: str) -> str:
    type_label = _learning_resource_type_label(resource_type)
    clean_title = str(title or "").strip()
    clean_lecture = str(lecture_title or "当前课程").strip() or "当前课程"
    if clean_title:
        return f"{type_label}草稿已创建，后续会围绕「{clean_title}」生成正文并发布给学习者。"
    return f"围绕「{clean_lecture}」创建的{type_label}草稿，等待生成正文。"


def _learning_resource_prompt_text(name: str, fallback: str = "") -> str:
    try:
        import prompts as learning_prompts
    except Exception:
        learning_prompts = None
    return str(getattr(learning_prompts, name, fallback) if learning_prompts else fallback)


def _render_learning_resource_prompt(template: str, variables: Mapping[str, Any]) -> str:
    manager = PromptContextManager()
    context = manager.build_context(
        {
            "lecture_title": variables.get("lecture_title"),
            "lecture_id": variables.get("lecture_id"),
            "username": variables.get("username"),
        }
    )
    return manager.render(str(template or ""), context, variables)


def _new_learning_resource_context(
    system_prompt: str,
    user_prompt: str,
    *,
    flow: str,
    max_chars: int = 28000,
) -> Context:
    ctx = Context(
        max_chars=max_chars,
        max_messages=48,
        policy=ContextPolicy.SLIDING_WINDOW,
        trace_meta={"flow": flow},
    )
    if str(system_prompt or "").strip():
        ctx.add("system", str(system_prompt or "").strip())
    ctx.add("user", str(user_prompt or "").strip())
    return ctx


def _learning_resource_context_messages(ctx: Context) -> List[Dict[str, Any]]:
    ctx.prepare()
    return ctx.build()


def _strip_learning_resource_context_text(value: Any, max_chars: int = 2000) -> str:
    text = str(value or "")
    if not text.strip():
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = html_lib.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    if max_chars > 0 and len(text) > max_chars:
        return text[:max_chars].rstrip() + "..."
    return text


def _build_learning_resource_course_context(lecture_id: str) -> str:
    target_lecture_id = str(lecture_id or "").strip()
    if not target_lecture_id:
        return ""
    lecture = get_learning_lecture(_cfg, target_lecture_id) or {}
    rows: List[str] = []
    lecture_title = str(lecture.get("title") or lecture.get("name") or "").strip()
    lecture_desc = str(lecture.get("description") or lecture.get("summary") or "").strip()
    if lecture_title:
        rows.append(f"课程名称：{lecture_title}")
    if lecture_desc:
        rows.append(f"课程说明：{_strip_learning_resource_context_text(lecture_desc, 900)}")
    try:
        books = list_lecture_books(_cfg, target_lecture_id) or []
    except Exception:
        books = []
    for book in books[:3]:
        if not isinstance(book, MappingABC):
            continue
        book_id = str(book.get("id") or "").strip()
        book_title = str(book.get("title") or book.get("name") or book_id).strip()
        if not book_id:
            continue
        rows.append(f"\n教材：{book_title}")
        book_desc = str(book.get("description") or book.get("summary") or "").strip()
        if book_desc:
            rows.append(f"教材说明：{_strip_learning_resource_context_text(book_desc, 700)}")
        try:
            info_text = _strip_learning_resource_context_text(load_book_info_xml(_cfg, target_lecture_id, book_id), 1800)
            if info_text:
                rows.append(f"教材解析信息：{info_text}")
        except Exception:
            pass
        try:
            detail_text = _strip_learning_resource_context_text(load_book_detail_xml(_cfg, target_lecture_id, book_id), 2400)
            if detail_text:
                rows.append(f"精读内容：{detail_text}")
        except Exception:
            pass
        try:
            sections_text = _strip_learning_resource_context_text(load_book_sections_xml(_cfg, target_lecture_id, book_id), 1600)
            if sections_text:
                rows.append(f"章节/分节结构：{sections_text}")
        except Exception:
            pass
        try:
            book_text = _strip_learning_resource_context_text(load_book_text(_cfg, target_lecture_id, book_id), 1800)
            if book_text:
                rows.append(f"教材正文片段：{book_text}")
        except Exception:
            pass
    context = "\n".join(row for row in rows if str(row or "").strip()).strip()
    if len(context) > 9000:
        context = context[:9000].rstrip() + "..."
    return context


def _build_learning_resource_source_texts(lecture_id: str) -> List[Dict[str, Any]]:
    target_lecture_id = str(lecture_id or "").strip()
    if not target_lecture_id:
        return []
    try:
        books = list_lecture_books(_cfg, target_lecture_id) or []
    except Exception:
        books = []
    rows: List[Dict[str, Any]] = []
    for book in books[:5]:
        if not isinstance(book, MappingABC):
            continue
        book_id = str(book.get("id") or "").strip()
        if not book_id:
            continue
        try:
            text = str(load_book_text(_cfg, target_lecture_id, book_id) or "")
        except Exception:
            text = ""
        if not text.strip():
            continue
        rows.append(
            {
                "book_id": book_id,
                "book_title": str(book.get("title") or book.get("name") or book_id).strip(),
                "text": text,
                "length": len(text),
            }
        )
    return rows


def _learning_resource_source_catalog(sources: List[Dict[str, Any]]) -> str:
    rows = []
    for item in sources:
        rows.append(f"- {item.get('book_id')}: {item.get('book_title')}（{item.get('length')} 字）")
    return "\n".join(rows) or "- 暂无可读取原文"


def _search_learning_resource_sources(
    sources: List[Dict[str, Any]],
    *,
    query: str,
    book_id: str = "",
    limit: int = 5,
) -> Dict[str, Any]:
    q = str(query or "").strip()
    target_book_id = str(book_id or "").strip()
    if not q:
        return {"items": [], "message": "query is required"}
    rows: List[Dict[str, Any]] = []
    query_terms = [q]
    for part in re.split(r"[\s,，。；;、]+", q):
        part = part.strip()
        if len(part) >= 2 and part not in query_terms:
            query_terms.append(part)
    for source in sources:
        source_book_id = str(source.get("book_id") or "").strip()
        if target_book_id and source_book_id != target_book_id:
            continue
        text = str(source.get("text") or "")
        text_lower = text.lower()
        for term in query_terms:
            term_lower = term.lower()
            start = text_lower.find(term_lower)
            while start >= 0:
                left = max(0, start - 180)
                right = min(len(text), start + len(term) + 260)
                rows.append(
                    {
                        "book_id": source_book_id,
                        "book_title": str(source.get("book_title") or source_book_id),
                        "start": left,
                        "end": right,
                        "snippet": _strip_learning_resource_context_text(text[left:right], 520),
                    }
                )
                if len(rows) >= max(1, limit):
                    return {"items": rows}
                start = text_lower.find(term_lower, start + max(1, len(term_lower)))
    return {"items": rows}


def _read_learning_resource_source(
    sources: List[Dict[str, Any]],
    *,
    book_id: str,
    start: int,
    length: int,
) -> Dict[str, Any]:
    target_book_id = str(book_id or "").strip()
    source = next((item for item in sources if str(item.get("book_id") or "").strip() == target_book_id), None)
    if not source:
        return {"error": "book_id not found", "available": [item.get("book_id") for item in sources]}
    text = str(source.get("text") or "")
    safe_start = max(0, min(int(start or 0), len(text)))
    safe_length = max(200, min(int(length or 1200), 3000))
    safe_end = min(len(text), safe_start + safe_length)
    return {
        "book_id": target_book_id,
        "book_title": str(source.get("book_title") or target_book_id),
        "start": safe_start,
        "end": safe_end,
        "text": _strip_learning_resource_context_text(text[safe_start:safe_end], 3200),
    }


def _learning_resource_source_tool_specs() -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "search_original",
                "description": "Search original textbook text for grounding snippets before writing a learning resource.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Keyword or phrase to search in original text."},
                        "book_id": {"type": "string", "description": "Optional book id from the source catalog."},
                        "limit": {"type": "integer", "description": "Max snippets to return, 1-8."},
                    },
                    "required": ["query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "read_original",
                "description": "Read a bounded range from original textbook text by book id and offset.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "book_id": {"type": "string", "description": "Book id from the source catalog."},
                        "start": {"type": "integer", "description": "Start offset."},
                        "length": {"type": "integer", "description": "Characters to read, max 3000."},
                    },
                    "required": ["book_id", "start"],
                },
            },
        },
    ]


def _learning_resource_component_tool_spec() -> Dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": "submit_resource_components",
            "description": "Submit the final structured learning resource components for admin review.",
            "parameters": {
                "type": "object",
                "properties": {
                    "quick_summary": {"type": "string", "description": "A short speed-read summary in Chinese."},
                    "concept_cards": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "content": {"type": "string"},
                            },
                            "required": ["title", "content"],
                        },
                    },
                    "review_questions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "question": {"type": "string"},
                                "answer": {"type": "string"},
                            },
                            "required": ["question"],
                        },
                    },
                    "practice_blocks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "language": {"type": "string"},
                                "content": {"type": "string"},
                                "runnable": {"type": "boolean"},
                            },
                            "required": ["language", "content"],
                        },
                    },
                    "article_markdown": {
                        "type": "string",
                        "description": "The complete article body in Markdown. Do not include review questions, reference answers, details tags, or text/plain fenced blocks here; put review questions in review_questions and code in practice_blocks.",
                    },
                },
                "required": ["quick_summary", "concept_cards", "review_questions", "article_markdown"],
            },
        },
    }


def _normalize_learning_resource_components(raw: Any) -> Dict[str, Any]:
    data = raw if isinstance(raw, MappingABC) else {}
    components: Dict[str, Any] = {
        "quick_summary": strip_model_thinking_blocks(data.get("quick_summary") or ""),
        "concept_cards": [],
        "review_questions": [],
        "practice_blocks": [],
        "article_markdown": strip_model_thinking_blocks(data.get("article_markdown") or data.get("content") or ""),
    }
    for item in (data.get("concept_cards") if isinstance(data.get("concept_cards"), list) else []):
        if not isinstance(item, MappingABC):
            continue
        title = strip_model_thinking_blocks(item.get("title") or item.get("name") or "")
        content = strip_model_thinking_blocks(item.get("content") or item.get("description") or "")
        if title or content:
            components["concept_cards"].append({"title": title or "关键概念", "content": content})
    for item in (data.get("review_questions") if isinstance(data.get("review_questions"), list) else []):
        if isinstance(item, MappingABC):
            question = strip_model_thinking_blocks(item.get("question") or item.get("title") or "")
            answer = strip_model_thinking_blocks(item.get("answer") or "")
        else:
            question = strip_model_thinking_blocks(item)
            answer = ""
        if question:
            components["review_questions"].append({"question": question, "answer": answer})
    for item in (data.get("practice_blocks") if isinstance(data.get("practice_blocks"), list) else []):
        if isinstance(item, MappingABC):
            language = str(item.get("language") or item.get("lang") or "text").strip() or "text"
            content = strip_model_thinking_blocks(item.get("content") or item.get("code") or "")
            runnable = bool(item.get("runnable")) or language.lower() in {"python", "py"}
        else:
            language = "text"
            content = strip_model_thinking_blocks(item)
            runnable = False

        if content and not is_learning_resource_plain_text_language(language):
            components["practice_blocks"].append({"type": "code", "language": language, "content": content, "runnable": runnable})
    return components


def _learning_resource_markdown_from_components(components: Mapping[str, Any], title: str) -> str:
    article = strip_model_thinking_blocks(components.get("article_markdown") or "")
    if article:
        return article
    rows = [f"# {title}"]
    summary = str(components.get("quick_summary") or "").strip()
    if summary:
        rows.extend(["", "## 速读摘要", summary])
    concept_cards = components.get("concept_cards") if isinstance(components.get("concept_cards"), list) else []
    if concept_cards:
        rows.extend(["", "## 关键概念"])
        for item in concept_cards:
            if isinstance(item, MappingABC):
                rows.append(f"- **{item.get('title') or '概念'}**：{item.get('content') or ''}")
    review_questions = components.get("review_questions") if isinstance(components.get("review_questions"), list) else []
    if review_questions:
        rows.extend(["", "## 复盘问题"])
        for idx, item in enumerate(review_questions, start=1):
            if isinstance(item, MappingABC):
                rows.append(f"{idx}. {item.get('question') or ''}")
                if item.get("answer"):
                    rows.append(f"   - 参考：{item.get('answer')}")
    return "\n".join(rows).strip()


def _learning_resource_blocks_from_components(components: Mapping[str, Any], title: str) -> List[Dict[str, Any]]:
    markdown = _learning_resource_markdown_from_components(components, title)
    blocks = _split_learning_resource_blocks(markdown)
    practice_blocks = components.get("practice_blocks") if isinstance(components.get("practice_blocks"), list) else []
    for block in practice_blocks:
        if isinstance(block, MappingABC) and str(block.get("content") or "").strip():
            blocks.append(
                {
                    "type": "code",
                    "language": str(block.get("language") or "text").strip() or "text",
                    "content": str(block.get("content") or "").strip(),
                    "runnable": bool(block.get("runnable")),
                }
            )
    return blocks


def _run_learning_resource_component_generation(
    *,
    proxy: NexoraProxy,
    messages: List[Dict[str, Any]],
    model: Optional[str],
    username: str,
    push_activity,
) -> Optional[Dict[str, Any]]:
    final_messages = list(messages)
    final_messages.append(
        {
            "role": "user",
            "content": _learning_resource_prompt_text("LEARNING_RESOURCE_COMPONENT_SUBMIT_PROMPT"),
        }
    )
    push_activity("model_call", "正在调用 Nexora 模型生成结构化资源组件")
    result = proxy.chat_completions(
        messages=final_messages,
        model=model,
        username=username or None,
        options={
            "temperature": 0.45,
            "tools": [_learning_resource_component_tool_spec()],
            "tool_choice": {"type": "function", "function": {"name": "submit_resource_components"}},
            "stream": False,
        },
        request_timeout=600,
    )
    if not result.get("ok"):
        push_activity("tool_error", f"结构化组件生成失败：{result.get('message') or 'request failed'}")
        return None
    payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
    choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
    message = choices[0].get("message") if choices and isinstance(choices[0], MappingABC) else {}
    tool_calls = message.get("tool_calls") if isinstance(message.get("tool_calls"), list) else []
    for call in tool_calls:
        if not isinstance(call, MappingABC):
            continue
        func = call.get("function") if isinstance(call.get("function"), MappingABC) else {}
        if str(func.get("name") or "").strip() != "submit_resource_components":
            continue
        try:
            args = json.loads(str(func.get("arguments") or "{}"))
        except Exception:
            args = {}
        components = _normalize_learning_resource_components(args)
        if str(components.get("article_markdown") or "").strip():
            push_activity("tool_submit", "模型已提交结构化资源组件")
            return components
    push_activity("tool_error", "模型没有提交结构化组件，准备回退普通正文生成")
    return None


def _prepare_learning_resource_source_messages(
    *,
    proxy: NexoraProxy,
    model: Optional[str],
    username: str,
    system_prompt: str,
    user_prompt: str,
    sources: List[Dict[str, Any]],
    push_activity,
) -> List[Dict[str, Any]]:
    source_catalog = _learning_resource_source_catalog(sources)
    source_prompt = _render_learning_resource_prompt(
        _learning_resource_prompt_text("LEARNING_RESOURCE_SOURCE_TOOL_USER_PROMPT"),
        {"draft_prompt": user_prompt, "source_catalog": source_catalog},
    )
    ctx = _new_learning_resource_context(
        system_prompt,
        source_prompt if sources else user_prompt,
        flow="learning_resource_source",
    )
    if not sources:
        return _learning_resource_context_messages(ctx)
    tools = _learning_resource_source_tool_specs()
    for turn in range(3):
        result = proxy.chat_completions(
            messages=_learning_resource_context_messages(ctx),
            model=model,
            username=username or None,
            options={"temperature": 0.2, "tools": tools, "tool_choice": "auto", "stream": False},
            request_timeout=240,
        )
        if not result.get("ok"):
            push_activity("tool_error", f"原文工具准备失败：{result.get('message') or 'request failed'}")
            return _learning_resource_context_messages(ctx)
        payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
        choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
        message = choices[0].get("message") if choices and isinstance(choices[0], dict) else {}
        if not isinstance(message, dict):
            return _learning_resource_context_messages(ctx)
        tool_calls = message.get("tool_calls") if isinstance(message.get("tool_calls"), list) else []
        assistant_kwargs: Dict[str, Any] = {}
        if tool_calls:
            assistant_kwargs["tool_calls"] = tool_calls
        ctx.add("assistant", str(message.get("content") or ""), **assistant_kwargs)
        if not tool_calls:
            if str(message.get("content") or "").strip():
                push_activity("tool_context", "模型判断无需继续查询原文")
            return _learning_resource_context_messages(ctx)
        for call in tool_calls:
            if not isinstance(call, MappingABC):
                continue
            func = call.get("function") if isinstance(call.get("function"), MappingABC) else {}
            tool_name = str(func.get("name") or "").strip()
            try:
                args = json.loads(str(func.get("arguments") or "{}"))
            except Exception:
                args = {}
            if not isinstance(args, dict):
                args = {}
            if tool_name == "search_original":
                query = str(args.get("query") or "").strip()
                push_activity("tool_call", f"查询原文：{query[:40] or '空查询'}")
                tool_result = _search_learning_resource_sources(
                    sources,
                    query=query,
                    book_id=str(args.get("book_id") or ""),
                    limit=max(1, min(_safe_int(args.get("limit"), 5), 8)),
                )
            elif tool_name == "read_original":
                push_activity("tool_call", "读取原文片段")
                tool_result = _read_learning_resource_source(
                    sources,
                    book_id=str(args.get("book_id") or ""),
                    start=_safe_int(args.get("start"), 0),
                    length=_safe_int(args.get("length"), 1200),
                )
            else:
                tool_result = {"error": f"unknown tool: {tool_name}"}
            ctx.add(
                "tool",
                json.dumps(tool_result, ensure_ascii=False),
                tool_call_id=str(call.get("id") or ""),
                name=tool_name,
            )
    ctx.add("user", _learning_resource_prompt_text("LEARNING_RESOURCE_SOURCE_TOOL_DONE_PROMPT"))
    return _learning_resource_context_messages(ctx)


def _split_learning_resource_blocks(markdown: str) -> List[Dict[str, Any]]:
    text = strip_model_thinking_blocks(markdown)
    if not text:
        return []
    blocks: List[Dict[str, Any]] = []
    cursor = 0
    pattern = re.compile(r"```([A-Za-z0-9_+\-.#]*)\s*\n(.*?)```", re.S)
    for match in pattern.finditer(text):
        before = text[cursor:match.start()].strip()
        if before:
            blocks.append({"type": "markdown", "content": before})
        language = str(match.group(1) or "").strip()
        display_language = language or "text"
        code = str(match.group(2) or "").strip("\n")

        if code.strip() and is_learning_resource_plain_text_language(language):
            blocks.append({"type": "markdown", "content": code.strip()})
        elif code.strip():
            blocks.append(
                {
                    "type": "code",
                    "language": display_language,
                    "content": code,
                    "runnable": display_language.lower() in {"python", "py"},
                }
            )
        cursor = match.end()
    tail = text[cursor:].strip()
    if tail:
        blocks.append({"type": "markdown", "content": tail})
    return blocks or [{"type": "markdown", "content": text}]


def _summarize_learning_resource_markdown(markdown: str, fallback_title: str) -> str:
    text = re.sub(r"```.*?```", "", strip_model_thinking_blocks(markdown), flags=re.S)
    text = re.sub(r"[#>*_`\-\[\]()]|^\s*\d+\.\s*", "", text, flags=re.M)
    text = re.sub(r"\s+", " ", text).strip()
    if text:
        return text[:180]
    return f"围绕「{fallback_title}」生成的学习资源草稿。"


def _build_learning_resource_prompt(
    *,
    title: str,
    resource_type: str,
    lecture_title: str,
    topics: List[Dict[str, Any]],
    course_context: str = "",
    quality_feedback: str = "",
) -> Tuple[str, str]:
    type_label = _learning_resource_type_label(resource_type)
    topic_lines = []
    for item in topics[:8]:
        if isinstance(item, MappingABC):
            topic_title = str(item.get("title") or "").strip()
        else:
            topic_title = str(item or "").strip()
        if topic_title:
            topic_lines.append(f"- {topic_title}")
    topic_text = "\n".join(topic_lines) or "- 无额外选题"
    context_text = str(course_context or "").strip() or "暂无课程/教材上下文。若上下文不足，请明确写成“基于当前课程标题的通用解释”，不要编造教材细节。"
    variables = {
        "title": title,
        "resource_type": resource_type,
        "resource_type_label": type_label,
        "lecture_title": lecture_title or "当前课程",
        "topic_text": topic_text,
        "course_context": context_text,
        "quality_feedback": str(quality_feedback or "").strip() or "无",
    }
    system_prompt = _render_learning_resource_prompt(
        _learning_resource_prompt_text("LEARNING_RESOURCE_AUTHOR_SYSTEM_PROMPT"),
        variables,
    )
    user_prompt = _render_learning_resource_prompt(
        _learning_resource_prompt_text("LEARNING_RESOURCE_AUTHOR_USER_PROMPT"),
        variables,
    )
    return system_prompt, user_prompt


def _register_learning_resource_generation(task_id: str) -> None:
    safe_task_id = str(task_id or "").strip()

    if not safe_task_id:
        return

    with _LEARNING_RESOURCE_GENERATION_LOCK:
        _LEARNING_RESOURCE_GENERATION_ACTIVE_TASKS.add(safe_task_id)


def _clear_learning_resource_generation(task_id: str) -> None:
    safe_task_id = str(task_id or "").strip()

    if not safe_task_id:
        return

    with _LEARNING_RESOURCE_GENERATION_LOCK:
        _LEARNING_RESOURCE_GENERATION_ACTIVE_TASKS.discard(safe_task_id)


def _is_learning_resource_generation_active(task_id: str) -> bool:
    safe_task_id = str(task_id or "").strip()

    if not safe_task_id:
        return False

    with _LEARNING_RESOURCE_GENERATION_LOCK:
        return safe_task_id in _LEARNING_RESOURCE_GENERATION_ACTIVE_TASKS


def _run_learning_resource_generation(task_id: str, resource_id: str, username: str) -> None:
    task_id = str(task_id or "").strip()
    resource_id = str(resource_id or "").strip()
    username = str(username or "").strip()
    if not task_id or not resource_id:
        return
    _register_learning_resource_generation(task_id)
    activity_rows: List[Dict[str, Any]] = []

    def push_activity(kind: str, message: str) -> None:
        activity_rows.append(
            {
                "time": int(time.time()),
                "type": str(kind or "status").strip() or "status",
                "message": str(message or "").strip(),
            }
        )
        del activity_rows[:-30]

    try:
        tasks = list_learning_resource_tasks(_cfg, limit=200)
        task = next((row for row in tasks if str(row.get("id") or "").strip() == task_id), {})
        resources = list_learning_resources(_cfg, limit=200, include_drafts=True)
        resource = next((row for row in resources if str(row.get("id") or "").strip() == resource_id), {})
        if not task or not resource:
            return

        push_activity("status", "资源生成任务已启动")
        update_learning_resource_task(_cfg, task_id, {"status": "draft_generating"})
        update_learning_resource(
            _cfg,
            resource_id,
            {
                "status": "generating",
                "summary": "模型正在生成正文，稍后会自动写入草稿。",
                "generation_activity": list(activity_rows),
            },
        )

        proxy = _proxy or NexoraProxy(_cfg)
        title = str(resource.get("title") or task.get("title") or "学习资源草稿").strip()
        resource_type = str(resource.get("resource_type") or task.get("resource_type") or "explainer").strip()
        lecture_id = str(resource.get("lecture_id") or task.get("lecture_id") or "").strip()
        lecture_title = str(resource.get("lecture_title") or task.get("lecture_title") or "当前课程").strip()
        topics = task.get("topics") if isinstance(task.get("topics"), list) else []
        quality_feedback = str(task.get("quality_feedback") or "").strip()
        course_context = _build_learning_resource_course_context(lecture_id)
        push_activity(
            "context",
            f"已读取课程上下文：{len(course_context)} 字" if course_context else "未读取到课程上下文，将按课程标题生成",
        )
        system_prompt, user_prompt = _build_learning_resource_prompt(
            title=title,
            resource_type=resource_type,
            lecture_title=lecture_title,
            topics=topics,
            course_context=course_context,
            quality_feedback=quality_feedback,
        )
        source_texts = _build_learning_resource_source_texts(lecture_id)
        if source_texts:
            push_activity("tool_context", f"已准备原文读取工具：{len(source_texts)} 本教材")
        final_messages = _prepare_learning_resource_source_messages(
            proxy=proxy,
            model=get_default_nexora_model(_cfg) or None,
            username=username,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            sources=source_texts,
            push_activity=push_activity,
        )
        components = _run_learning_resource_component_generation(
            proxy=proxy,
            messages=final_messages,
            model=get_default_nexora_model(_cfg) or None,
            username=username,
            push_activity=push_activity,
        )
        if components:
            content = _learning_resource_markdown_from_components(components, title)
            blocks = _learning_resource_blocks_from_components(components, title)
            summary = str(components.get("quick_summary") or "").strip() or _summarize_learning_resource_markdown(content, title)
            push_activity("done", "结构化资源组件已生成，等待管理员审核")
            update_learning_resource(
                _cfg,
                resource_id,
                {
                    "status": "draft_ready",
                    "summary": summary,
                    "content": content,
                    "blocks": blocks,
                    "components": components,
                    "reason": "结构化资源已生成，等待管理员审核发布。",
                    "generation_activity": list(activity_rows),
                },
            )
            update_learning_resource_task(_cfg, task_id, {"status": "draft_ready"})
            log_event(
                "learning_resource_generation_ready",
                "学习资源结构化组件已生成",
                payload={"task_id": task_id, "resource_id": resource_id, "block_count": len(blocks)},
            )
            return

        final_messages.append(
            {
                "role": "user",
                "content": _learning_resource_prompt_text("LEARNING_RESOURCE_FALLBACK_MARKDOWN_PROMPT"),
            }
        )
        streamed_parts: List[str] = []
        last_persist = 0.0

        def on_delta(delta: str) -> None:
            nonlocal last_persist
            piece = str(delta or "")
            if not piece:
                return
            streamed_parts.append(piece)
            now = time.time()
            content = strip_model_thinking_blocks("".join(streamed_parts))
            if last_persist > 0 and now - last_persist < 1.0:
                return
            last_persist = now
            if not any(row.get("type") == "model_output" for row in activity_rows):
                push_activity("model_output", "模型开始返回正文")
            update_learning_resource(
                _cfg,
                resource_id,
                {
                    "status": "generating",
                    "content": content,
                    "blocks": _split_learning_resource_blocks(content),
                    "summary": "模型正在生成正文，已写入部分内容。",
                    "generation_activity": list(activity_rows),
                },
            )

        push_activity("model_call", "正在调用 Nexora 模型生成正文")
        result = proxy.complete_raw(
            messages=final_messages,
            model=get_default_nexora_model(_cfg) or None,
            username=username or None,
            api_mode="chat",
            options={"temperature": 0.55, "stream": True},
            request_timeout=600,
            on_delta=on_delta,
        )
        if not result.get("success") and not streamed_parts:
            push_activity("model_call", "流式生成不可用，改用普通生成重试")
            result = proxy.complete_raw(
                messages=final_messages,
                model=get_default_nexora_model(_cfg) or None,
                username=username or None,
                api_mode="chat",
                options={"temperature": 0.55, "stream": False},
                request_timeout=600,
            )
        if not result.get("success"):
            message = str(result.get("message") or "模型生成失败").strip()
            push_activity("failed", message)
            update_learning_resource_task(_cfg, task_id, {"status": "failed", "error": message})
            update_learning_resource(
                _cfg,
                resource_id,
                {
                    "status": "failed",
                    "reason": message,
                    "generation_activity": list(activity_rows),
                },
            )
            log_event(
                "learning_resource_generation_failed",
                "学习资源正文生成失败",
                payload={"task_id": task_id, "resource_id": resource_id, "message": message},
            )
            return

        content = strip_model_thinking_blocks(result.get("content") or "".join(streamed_parts))
        if not content:
            raise RuntimeError("模型没有返回正文")
        blocks = _split_learning_resource_blocks(content)
        summary = _summarize_learning_resource_markdown(content, title)
        push_activity("done", "正文生成完成，已写入草稿")
        update_learning_resource(
            _cfg,
            resource_id,
            {
                "status": "draft_ready",
                "summary": summary,
                "content": content,
                "blocks": blocks,
                "reason": "正文已生成，等待管理员发布。",
                "generation_activity": list(activity_rows),
            },
        )
        update_learning_resource_task(_cfg, task_id, {"status": "draft_ready"})
        log_event(
            "learning_resource_generation_ready",
            "学习资源正文已生成",
            payload={"task_id": task_id, "resource_id": resource_id, "block_count": len(blocks)},
        )
    except Exception as exc:
        message = str(exc) or "resource generation failed"
        push_activity("failed", message)
        update_learning_resource_task(_cfg, task_id, {"status": "failed", "error": message})
        update_learning_resource(
            _cfg,
            resource_id,
            {
                "status": "failed",
                "reason": message,
                "generation_activity": list(activity_rows),
            },
        )
        log_event(
            "learning_resource_generation_error",
            "学习资源正文生成异常",
            payload={"task_id": task_id, "resource_id": resource_id, "error": message},
        )
    finally:
        _clear_learning_resource_generation(task_id)


def _normalize_learning_resource_scan(raw: Any, *, fallback_status: str = "rejected") -> Dict[str, Any]:
    data = raw if isinstance(raw, MappingABC) else {}
    status = str(data.get("status") or data.get("result") or fallback_status).strip().lower()
    if status in {"pass", "passed", "ok", "approved", "success"}:
        status = "passed"
    elif status in {"reject", "rejected", "failed", "fail", "blocked", "risk"}:
        status = "rejected"
    else:
        status = fallback_status
    issues: List[Dict[str, str]] = []
    raw_issues = data.get("issues") if isinstance(data.get("issues"), list) else []
    for item in raw_issues[:12]:
        if isinstance(item, MappingABC):
            title = str(item.get("title") or item.get("name") or "复核问题").strip()
            detail = str(item.get("detail") or item.get("description") or item.get("message") or "").strip()
            severity = str(item.get("severity") or "medium").strip().lower()
        else:
            title = "复核问题"
            detail = str(item or "").strip()
            severity = "medium"
        if detail or title:
            issues.append(
                {
                    "severity": severity if severity in {"high", "medium", "low"} else "medium",
                    "title": title,
                    "detail": detail,
                }
            )
    if status == "rejected" and not issues:
        issues.append({"severity": "medium", "title": "scan 拒绝", "detail": "模型认为文章暂不适合发布。"})
    checked = data.get("checked") if isinstance(data.get("checked"), list) else []
    return {
        "status": status,
        "label": "模型已 review" if status == "passed" else "scan 拒绝",
        "summary": str(data.get("summary") or data.get("message") or "").strip(),
        "issues": issues,
        "checked": [str(item or "").strip() for item in checked if str(item or "").strip()][:10],
        "checked_at": int(time.time()),
        "reviewer": "model",
    }


def _learning_resource_scan_feedback(scan: Mapping[str, Any]) -> str:
    if not isinstance(scan, MappingABC):
        return ""
    rows: List[str] = []
    summary = str(scan.get("summary") or "").strip()
    if summary:
        rows.append(f"复核结论：{summary}")
    issues = scan.get("issues") if isinstance(scan.get("issues"), list) else []
    for idx, item in enumerate(issues[:12], start=1):
        if not isinstance(item, MappingABC):
            continue
        severity = str(item.get("severity") or "medium").strip()
        title = str(item.get("title") or "复核问题").strip()
        detail = str(item.get("detail") or "").strip()
        rows.append(f"{idx}. [{severity}] {title}：{detail}")
    checked = scan.get("checked") if isinstance(scan.get("checked"), list) else []
    if checked:
        rows.append("已检查项：" + "、".join(str(item or "").strip() for item in checked if str(item or "").strip()))
    return "\n".join(row for row in rows if row.strip()).strip()


def _prepare_learning_resource_review_context(
    *,
    proxy: NexoraProxy,
    model: Optional[str],
    username: str,
    system_prompt: str,
    user_prompt: str,
    sources: List[Dict[str, Any]],
    cancel_event=None,
) -> Context:
    ctx = _new_learning_resource_context(
        system_prompt,
        user_prompt,
        flow="learning_resource_review",
        max_chars=32000,
    )
    if not sources:
        ctx.add("user", _learning_resource_prompt_text("LEARNING_RESOURCE_REVIEW_FINAL_JSON_PROMPT"))
        return ctx

    tools = _learning_resource_source_tool_specs()
    for _turn in range(3):
        if _is_learning_resource_scan_cancelled(cancel_event):
            raise RuntimeError("模型复核已取消")

        result = proxy.chat_completions(
            messages=_learning_resource_context_messages(ctx),
            model=model,
            username=username or None,
            options={"temperature": 0.1, "tools": tools, "tool_choice": "auto", "stream": False},
            request_timeout=240,
        )

        if _is_learning_resource_scan_cancelled(cancel_event):
            raise RuntimeError("模型复核已取消")

        if not result.get("ok"):
            break
        payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
        choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
        message = choices[0].get("message") if choices and isinstance(choices[0], MappingABC) else {}
        if not isinstance(message, MappingABC):
            break
        tool_calls = message.get("tool_calls") if isinstance(message.get("tool_calls"), list) else []
        assistant_kwargs: Dict[str, Any] = {}
        if tool_calls:
            assistant_kwargs["tool_calls"] = tool_calls
        ctx.add("assistant", str(message.get("content") or ""), **assistant_kwargs)
        if not tool_calls:
            break
        for call in tool_calls:
            if not isinstance(call, MappingABC):
                continue
            func = call.get("function") if isinstance(call.get("function"), MappingABC) else {}
            tool_name = str(func.get("name") or "").strip()
            try:
                args = json.loads(str(func.get("arguments") or "{}"))
            except Exception:
                args = {}
            if not isinstance(args, dict):
                args = {}
            if tool_name == "search_original":
                tool_result = _search_learning_resource_sources(
                    sources,
                    query=str(args.get("query") or "").strip(),
                    book_id=str(args.get("book_id") or ""),
                    limit=max(1, min(_safe_int(args.get("limit"), 5), 8)),
                )
            elif tool_name == "read_original":
                tool_result = _read_learning_resource_source(
                    sources,
                    book_id=str(args.get("book_id") or ""),
                    start=_safe_int(args.get("start"), 0),
                    length=_safe_int(args.get("length"), 1200),
                )
            else:
                tool_result = {"error": f"unknown tool: {tool_name}"}
            ctx.add(
                "tool",
                json.dumps(tool_result, ensure_ascii=False),
                tool_call_id=str(call.get("id") or ""),
                name=tool_name,
            )
    ctx.add("user", _learning_resource_prompt_text("LEARNING_RESOURCE_REVIEW_FINAL_JSON_PROMPT"))
    return ctx


def _is_learning_resource_scan_cancelled(cancel_event: Any) -> bool:
    return cancel_event is not None and cancel_event.is_set()


def _register_learning_resource_scan(resource_id: str) -> threading.Event:
    target_id = str(resource_id or "").strip()
    event = threading.Event()

    with _LEARNING_RESOURCE_SCAN_LOCK:
        previous = _LEARNING_RESOURCE_SCAN_CANCEL_EVENTS.get(target_id)

        if previous is not None:
            previous.set()

        _LEARNING_RESOURCE_SCAN_CANCEL_EVENTS[target_id] = event

    return event


def _cancel_learning_resource_scan(resource_id: str) -> bool:
    target_id = str(resource_id or "").strip()

    with _LEARNING_RESOURCE_SCAN_LOCK:
        event = _LEARNING_RESOURCE_SCAN_CANCEL_EVENTS.get(target_id)

    if event is None:
        return False

    event.set()
    return True


def _clear_learning_resource_scan(resource_id: str, cancel_event: threading.Event) -> None:
    target_id = str(resource_id or "").strip()

    with _LEARNING_RESOURCE_SCAN_LOCK:
        if _LEARNING_RESOURCE_SCAN_CANCEL_EVENTS.get(target_id) is cancel_event:
            _LEARNING_RESOURCE_SCAN_CANCEL_EVENTS.pop(target_id, None)


def _scan_learning_resource_with_model(resource: Mapping[str, Any], username: str, on_delta=None, cancel_event=None) -> Dict[str, Any]:
    title = str(resource.get("title") or "学习资源").strip()
    content = str(resource.get("content") or "").strip()
    summary = str(resource.get("summary") or "").strip()
    lecture_id = str(resource.get("lecture_id") or "").strip()
    lecture_title = str(resource.get("lecture_title") or _learning_resource_lecture_title(lecture_id)).strip()
    resource_type = str(resource.get("resource_type") or "explainer").strip()
    context = _build_learning_resource_course_context(lecture_id)
    components = resource.get("components") if isinstance(resource.get("components"), MappingABC) else {}

    if _is_learning_resource_scan_cancelled(cancel_event):
        raise RuntimeError("模型复核已取消")

    if not content and not summary:
        return _normalize_learning_resource_scan(
            {
                "status": "rejected",
                "summary": "正文为空，无法通过复核。",
                "issues": [{"severity": "high", "title": "正文为空", "detail": "资源没有可审核的正文内容。"}],
            }
        )
    proxy = _proxy or NexoraProxy(_cfg)
    model = get_default_nexora_model(_cfg) or None
    sources = _build_learning_resource_source_texts(lecture_id)
    variables = {
        "title": title,
        "summary": summary,
        "resource_type": resource_type,
        "resource_type_label": _learning_resource_type_label(resource_type),
        "lecture_id": lecture_id,
        "lecture_title": lecture_title or "当前课程",
        "components_json": json.dumps(components, ensure_ascii=False)[:5000],
        "course_context": context[:9000] if context else "暂无课程上下文。",
        "source_catalog": _learning_resource_source_catalog(sources),
        "content": content[:14000],
        "username": username,
    }
    system_prompt = _render_learning_resource_prompt(
        _learning_resource_prompt_text("LEARNING_RESOURCE_REVIEW_SYSTEM_PROMPT"),
        variables,
    )
    user_prompt = _render_learning_resource_prompt(
        _learning_resource_prompt_text("LEARNING_RESOURCE_REVIEW_USER_PROMPT"),
        variables,
    )
    review_ctx = _prepare_learning_resource_review_context(
        proxy=proxy,
        model=model,
        username=username,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        sources=sources,
        cancel_event=cancel_event,
    )

    if _is_learning_resource_scan_cancelled(cancel_event):
        raise RuntimeError("模型复核已取消")

    if callable(on_delta):
        on_delta("正在提交结构化复核结果...\n")

    result = proxy.chat_completions(
        messages=_learning_resource_context_messages(review_ctx),
        model=model,
        username=username or None,
        options={
            "temperature": 0.1,
            "stream": False,
            "tools": [_learning_resource_scan_tool_spec()],
            "tool_choice": {"type": "function", "function": {"name": "submit_resource_scan"}},
        },
        request_timeout=240,
        cancel_event=cancel_event,
    )
    if not result.get("ok"):
        return _normalize_learning_resource_scan(
            {
                "status": "rejected",
                "summary": f"模型复核调用失败：{result.get('message') or 'unknown error'}",
                "issues": [{"severity": "medium", "title": "复核调用失败", "detail": str(result.get("message") or "unknown error")}],
            }
        )
    payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
    choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
    message = choices[0].get("message") if choices and isinstance(choices[0], MappingABC) else {}
    tool_calls = message.get("tool_calls") if isinstance(message.get("tool_calls"), list) else []

    for call in tool_calls:
        if not isinstance(call, MappingABC):
            continue

        func = call.get("function") if isinstance(call.get("function"), MappingABC) else {}

        if str(func.get("name") or "").strip() != "submit_resource_scan":
            continue

        try:
            args = json.loads(str(func.get("arguments") or "{}"))
        except json.JSONDecodeError as exc:
            return _normalize_learning_resource_scan(
                {
                    "status": "rejected",
                    "summary": "模型复核工具参数不是合法 JSON。",
                    "issues": [{"severity": "medium", "title": "工具参数错误", "detail": exc.msg}],
                }
            )

        scan = _normalize_learning_resource_scan(args)
        scan["model"] = str(model or "").strip()

        if callable(on_delta):
            on_delta(json.dumps(scan, ensure_ascii=False, indent=2))

        return scan

    return _normalize_learning_resource_scan(
        {
            "status": "rejected",
            "summary": "模型没有调用 submit_resource_scan 工具提交复核结果。",
            "issues": [
                {
                    "severity": "medium",
                    "title": "缺少复核工具调用",
                    "detail": "复核链路要求通过 submit_resource_scan 提交结构化结果。",
                }
            ],
        }
    )


def _learning_resource_scan_error(error: Any) -> Dict[str, Any]:
    message = str(error or "模型复核调用异常").strip()
    return _normalize_learning_resource_scan(
        {
            "status": "rejected",
            "summary": f"模型复核异常：{message}",
            "issues": [
                {
                    "severity": "medium",
                    "title": "复核调用异常",
                    "detail": message,
                }
            ],
        }
    )


def _repair_interrupted_learning_resource_generations() -> None:
    resources = list_learning_resources(_cfg, limit=500, include_drafts=True)
    interrupted_statuses = {"queued", "generating"}
    task_statuses = {"draft_queued", "draft_generating"}
    repaired = 0

    for resource in resources:
        if not isinstance(resource, MappingABC):
            continue

        status = str(resource.get("status") or "").strip()

        if status not in interrupted_statuses:
            continue

        source_task_id = str(resource.get("source_task_id") or "").strip()

        if _is_learning_resource_generation_active(source_task_id):
            continue

        updated_at = _safe_int(resource.get("updated_at"), 0)

        if updated_at >= _LEARNING_RESOURCE_PROCESS_STARTED_AT:
            continue

        resource_id = str(resource.get("id") or "").strip()
        message = "资源生成进程已中断：服务在生成过程中停止或重启，后台生成线程已丢失。请重新生成该版本。"
        activity_rows = list(resource.get("generation_activity") if isinstance(resource.get("generation_activity"), list) else [])
        activity_rows.append(
            {
                "time": int(time.time()),
                "type": "failed",
                "message": message,
            }
        )

        if source_task_id:
            tasks = list_learning_resource_tasks(_cfg, limit=500)
            task = next((row for row in tasks if str(row.get("id") or "").strip() == source_task_id), {})

            if not task or str(task.get("status") or "").strip() in task_statuses:
                update_learning_resource_task(
                    _cfg,
                    source_task_id,
                    {
                        "status": "failed",
                        "error": message,
                    },
                )

        update_learning_resource(
            _cfg,
            resource_id,
            {
                "status": "failed",
                "reason": message,
                "generation_activity": activity_rows[-30:],
            },
        )
        repaired += 1

    if repaired:
        log_event(
            "learning_resource_generation_interrupted_repaired",
            "学习资源中断生成任务已标记失败",
            payload={"count": repaired, "process_started_at": _LEARNING_RESOURCE_PROCESS_STARTED_AT},
        )


@bp.route("/frontend/learning-resources", methods=["GET"])
def frontend_learning_resources():
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    _repair_interrupted_learning_resource_generations()
    include_drafts = _is_runtime_teacher() and str(request.args.get("include_drafts") or "").strip() == "1"
    limit = min(100, max(1, _safe_int(request.args.get("limit"), 30)))
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    rows = list_learning_resources(_cfg, limit=limit, include_drafts=include_drafts, lecture_id=lecture_id)
    return jsonify({"success": True, "items": rows, "total": len(rows)})


@bp.route("/frontend/learning-resources/<path:resource_id>", methods=["GET"])
def frontend_learning_resource_detail(resource_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    _repair_interrupted_learning_resource_generations()
    target_id = str(resource_id or "").strip()
    if not target_id:
        return jsonify({"success": False, "error": "resource_id is required."}), 400
    include_drafts = _is_runtime_teacher()
    rows = list_learning_resources(_cfg, limit=500, include_drafts=include_drafts)
    resource = next((row for row in rows if str(row.get("id") or "").strip() == target_id), None)
    if not resource:
        return jsonify({"success": False, "error": "resource not found."}), 404
    return jsonify({"success": True, "resource": resource})


@bp.route("/frontend/learning-resources/<path:resource_id>", methods=["DELETE"])
def frontend_learning_resource_delete(resource_id: str):
    username = _resolve_runtime_user_id()

    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can delete resources."}), 403

    target_id = str(resource_id or "").strip()

    if not target_id:
        return jsonify({"success": False, "error": "resource_id is required."}), 400

    resource = delete_learning_resource(_cfg, target_id)

    if not resource:
        return jsonify({"success": False, "error": "resource not found."}), 404

    log_event(
        "learning_resource_deleted",
        "学习资源已删除",
        payload={
            "resource_id": target_id,
            "source_task_id": resource.get("source_task_id"),
            "status": resource.get("status"),
            "title": resource.get("title"),
            "username": username,
        },
    )

    return jsonify({"success": True, "resource": resource})


@bp.route("/frontend/learning-resources/<path:resource_id>/status", methods=["POST"])
def frontend_learning_resource_status(resource_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can review resources."}), 403
    data = request.get_json(silent=True) or {}
    if not isinstance(data, MappingABC):
        return jsonify({"success": False, "error": "request body must be an object."}), 400
    target_status = str(data.get("status") or "").strip()
    if target_status not in {"published", "draft_ready", "draft", "failed"}:
        return jsonify({"success": False, "error": "unsupported status."}), 400
    if target_status == "published":
        target_id = str(resource_id or "").strip()
        resources = list_learning_resources(_cfg, limit=300, include_drafts=True)
        current = next((row for row in resources if str(row.get("id") or "").strip() == target_id), None)
        if not current:
            return jsonify({"success": False, "error": "resource not found."}), 404
        if data.get("confirmed") is not True:
            return jsonify({"success": False, "error": "publish confirmation is required."}), 400
        if not str(current.get("content") or "").strip():
            return jsonify({"success": False, "error": "resource content is required before publish."}), 409
    updates: Dict[str, Any] = {
        "status": target_status,
        "reviewed_by": username,
        "reviewed_at": int(time.time()),
    }
    if target_status == "published":
        updates["published_at"] = int(time.time())
        updates["reason"] = "管理员审核通过，已发布到学习资源。"
    elif str(data.get("reason") or "").strip():
        updates["reason"] = str(data.get("reason") or "").strip()
    resource = update_learning_resource(_cfg, resource_id, updates)
    if not resource:
        return jsonify({"success": False, "error": "resource not found."}), 404
    log_event(
        "learning_resource_review_status",
        "学习资源审核状态已更新",
        payload={"resource_id": resource_id, "status": target_status, "username": username},
    )
    return jsonify({"success": True, "resource": resource})


@bp.route("/frontend/learning-resources/<path:resource_id>/versions/<path:version_id>/select", methods=["POST"])
def frontend_learning_resource_version_select(resource_id: str, version_id: str):
    username = _resolve_runtime_user_id()

    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can switch resource versions."}), 403

    target_id = str(resource_id or "").strip()
    target_version_id = str(version_id or "").strip()

    if not target_id or not target_version_id:
        return jsonify({"success": False, "error": "resource_id and version_id are required."}), 400

    resources = list_learning_resources(_cfg, limit=300, include_drafts=True)
    current = next((row for row in resources if str(row.get("id") or "").strip() == target_id), None)

    if not current:
        return jsonify({"success": False, "error": "resource not found."}), 404

    if str(current.get("status") or "").strip() in {"queued", "generating"}:
        return jsonify({"success": False, "error": "resource is generating and cannot switch versions."}), 409

    _cancel_learning_resource_scan(target_id)
    resource = switch_learning_resource_version(_cfg, target_id, target_version_id)

    if not resource:
        return jsonify({"success": False, "error": "version not found."}), 404

    log_event(
        "learning_resource_version_selected",
        "学习资源当前版本已切换",
        payload={
            "resource_id": target_id,
            "version_id": target_version_id,
            "username": username,
        },
    )

    return jsonify({"success": True, "resource": resource})


@bp.route("/frontend/learning-resources/<path:resource_id>/scan", methods=["POST"])
def frontend_learning_resource_scan(resource_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can scan resources."}), 403
    target_id = str(resource_id or "").strip()
    resources = list_learning_resources(_cfg, limit=300, include_drafts=True)
    resource = next((row for row in resources if str(row.get("id") or "").strip() == target_id), None)
    if not resource:
        return jsonify({"success": False, "error": "resource not found."}), 404
    update_learning_resource(
        _cfg,
        target_id,
        {
            "review_scan": {
                "status": "running",
                "label": "模型复核中",
                "summary": "正在检查课程相关性、事实可靠性、结构可读性和发布风险。",
                "issues": [],
                "checked": [],
                "checked_at": int(time.time()),
                "reviewer": "model",
            },
            "reviewed_by_model_at": int(time.time()),
        },
    )
    try:
        scan = _scan_learning_resource_with_model(resource, username)
    except Exception as exc:
        scan = _learning_resource_scan_error(exc)
        log_event(
            "learning_resource_model_scan_error",
            "学习资源模型复核异常",
            payload={"resource_id": target_id, "username": username, "error": str(exc)},
        )

    updated = update_learning_resource(
        _cfg,
        target_id,
        {
            "review_scan": scan,
            "reviewed_by_model_at": int(time.time()),
        },
    )
    if not updated:
        return jsonify({"success": False, "error": "resource not found."}), 404
    log_event(
        "learning_resource_model_scan",
        "学习资源模型复核完成",
        payload={
            "resource_id": target_id,
            "version_id": updated.get("current_version_id"),
            "status": scan.get("status"),
            "username": username,
        },
    )
    if str(scan.get("status") or "").strip() == "rejected":
        log_event(
            "learning_resource_guard_rejected",
            "学习资源 scan 拒绝，已计入防幻觉拦截",
            payload={
                "resource_id": target_id,
                "version_id": updated.get("current_version_id"),
                "username": username,
                "summary": scan.get("summary"),
                "issue_count": len(scan.get("issues") if isinstance(scan.get("issues"), list) else []),
            },
        )
    return jsonify({"success": True, "resource": updated, "scan": scan})


@bp.route("/frontend/learning-resources/<path:resource_id>/scan-stream", methods=["POST"])
def frontend_learning_resource_scan_stream(resource_id: str):
    username = _resolve_runtime_user_id()

    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can scan resources."}), 403

    target_id = str(resource_id or "").strip()
    resources = list_learning_resources(_cfg, limit=300, include_drafts=True)
    resource = next((row for row in resources if str(row.get("id") or "").strip() == target_id), None)

    if not resource:
        return jsonify({"success": False, "error": "resource not found."}), 404

    event_queue = queue.Queue()
    cancel_event = _register_learning_resource_scan(target_id)

    def push_event(event_name: str, payload: Dict[str, Any]) -> None:
        event_queue.put((event_name, payload))

    def run_worker() -> None:
        running_scan = {
            "status": "running",
            "label": "模型复核中",
            "summary": "正在检查课程相关性、事实可靠性、结构可读性和发布风险。",
            "issues": [],
            "checked": [],
            "checked_at": int(time.time()),
            "reviewer": "model",
        }
        update_learning_resource(
            _cfg,
            target_id,
            {
                "review_scan": running_scan,
                "reviewed_by_model_at": int(time.time()),
            },
        )
        push_event("status", {"message": "模型复核已启动", "scan": running_scan})

        try:
            scan = _scan_learning_resource_with_model(
                resource,
                username,
                on_delta=lambda text: push_event("review_output", {"content": str(text or "")}),
                cancel_event=cancel_event,
            )
        except Exception as exc:
            if _is_learning_resource_scan_cancelled(cancel_event):
                push_event("cancelled", {"success": False, "message": "模型复核已取消"})
                push_event("complete", {})
                _clear_learning_resource_scan(target_id, cancel_event)
                return

            scan = _learning_resource_scan_error(exc)
            log_event(
                "learning_resource_model_scan_error",
                "学习资源模型复核异常",
                payload={"resource_id": target_id, "username": username, "error": str(exc)},
            )

        updated = update_learning_resource(
            _cfg,
            target_id,
            {
                "review_scan": scan,
                "reviewed_by_model_at": int(time.time()),
            },
        )

        if updated:
            log_event(
                "learning_resource_model_scan",
                "学习资源模型复核完成",
                payload={
                    "resource_id": target_id,
                    "version_id": updated.get("current_version_id"),
                    "status": scan.get("status"),
                    "username": username,
                    "stream": True,
                },
            )

            if str(scan.get("status") or "").strip() == "rejected":
                log_event(
                    "learning_resource_guard_rejected",
                    "学习资源 scan 拒绝，已计入防幻觉拦截",
                    payload={
                        "resource_id": target_id,
                        "version_id": updated.get("current_version_id"),
                        "username": username,
                        "summary": scan.get("summary"),
                        "issue_count": len(scan.get("issues") if isinstance(scan.get("issues"), list) else []),
                        "stream": True,
                    },
                )

            push_event("done", {"success": True, "resource": updated, "scan": scan})
        else:
            push_event("error", {"success": False, "error": "resource not found."})

        push_event("complete", {})
        _clear_learning_resource_scan(target_id, cancel_event)

    def event_stream():
        worker = threading.Thread(target=run_worker, name="learning-resource-scan-stream", daemon=True)
        worker.start()
        yield _reader_guide_sse_event("status", {"message": "learning resource scan stream started"})

        while True:
            try:
                event_name, event_payload = event_queue.get(timeout=15)
            except queue.Empty:
                yield _reader_guide_sse_event("ping", {"timestamp": time.time()})
                continue

            if event_name == "complete":
                break

            yield _reader_guide_sse_event(event_name, event_payload)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@bp.route("/frontend/learning-resources/<path:resource_id>/scan-cancel", methods=["POST"])
def frontend_learning_resource_scan_cancel(resource_id: str):
    username = _resolve_runtime_user_id()

    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can cancel resource scans."}), 403

    target_id = str(resource_id or "").strip()

    if not target_id:
        return jsonify({"success": False, "error": "resource_id is required."}), 400

    cancelled = _cancel_learning_resource_scan(target_id)

    if cancelled:
        log_event(
            "learning_resource_model_scan_cancelled",
            "学习资源模型复核已取消",
            payload={"resource_id": target_id, "username": username},
        )

    return jsonify({"success": True, "cancelled": cancelled})


@bp.route("/frontend/learning-resources/<path:resource_id>/regenerate", methods=["POST"])
def frontend_learning_resource_regenerate(resource_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can regenerate resources."}), 403
    _repair_interrupted_learning_resource_generations()
    target_id = str(resource_id or "").strip()
    resources = list_learning_resources(_cfg, limit=300, include_drafts=True)
    resource = next((row for row in resources if str(row.get("id") or "").strip() == target_id), None)
    if not resource:
        return jsonify({"success": False, "error": "resource not found."}), 404
    if str(resource.get("status") or "").strip() in {"queued", "generating"}:
        return jsonify({"success": False, "error": "resource is already generating."}), 409
    scan = resource.get("review_scan") if isinstance(resource.get("review_scan"), MappingABC) else {}
    feedback = _learning_resource_scan_feedback(scan)
    if not feedback:
        feedback = "管理员要求基于当前草稿重新生成一个改进版本。"
    lecture_id = str(resource.get("lecture_id") or "").strip()
    lecture_title = str(resource.get("lecture_title") or _learning_resource_lecture_title(lecture_id)).strip()
    resource_type = str(resource.get("resource_type") or "explainer").strip() or "explainer"
    title = str(resource.get("title") or "学习资源草稿").strip()
    record = append_learning_resource_task(
        _cfg,
        {
            "task_type": "regenerate",
            "status": "draft_queued",
            "resource_type": resource_type,
            "lecture_id": lecture_id,
            "lecture_title": lecture_title,
            "title": title,
            "topics": [],
            "selected_topic_ids": [],
            "quality_feedback": feedback,
            "regenerate_from_version_id": str(resource.get("current_version_id") or ""),
            "created_by": username,
        },
    )
    updated = create_learning_resource_version(
        _cfg,
        target_id,
        {
            "status": "queued",
            "summary": "已根据 scan 反馈创建新版本，等待模型重新生成。",
            "content": "",
            "blocks": [],
            "components": {},
            "review_scan": {},
            "generation_activity": [],
            "reason": "根据模型复核反馈重新生成。",
            "source_task_id": record.get("id"),
            "created_by": username,
        },
    )
    if not updated:
        return jsonify({"success": False, "error": "resource not found."}), 404
    worker = threading.Thread(
        target=_run_learning_resource_generation,
        args=(str(record.get("id") or ""), target_id, username),
        name="learning-resource-regenerate",
        daemon=True,
    )
    worker.start()
    log_event(
        "learning_resource_regenerate_created",
        "学习资源已根据 scan 反馈创建新版本",
        payload={
            "resource_id": target_id,
            "version_id": updated.get("current_version_id"),
            "from_version_id": record.get("regenerate_from_version_id"),
            "username": username,
        },
    )
    return jsonify({"success": True, "task": record, "resource": updated})


@bp.route("/frontend/learning-resources/tasks", methods=["GET"])
def frontend_learning_resource_tasks():
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can view resource tasks."}), 403
    limit = min(100, max(1, _safe_int(request.args.get("limit"), 30)))
    rows = list_learning_resource_tasks(_cfg, limit=limit)
    return jsonify({"success": True, "items": rows, "total": len(rows)})


@bp.route("/frontend/learning-resources/topics", methods=["POST"])
def frontend_learning_resource_topics():
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can generate resource topics."}), 403
    data = request.get_json(silent=True) or {}
    if not isinstance(data, MappingABC):
        return jsonify({"success": False, "error": "request body must be an object."}), 400
    lecture_id = str(data.get("lecture_id") or "").strip()
    resource_type = str(data.get("resource_type") or "explainer").strip() or "explainer"
    if not lecture_id:
        return jsonify({"success": False, "error": "请选择课程后再生成资源选题。"}), 400

    lecture_title = _learning_resource_lecture_title(lecture_id)

    try:
        topics = _build_learning_resource_topic_suggestions(lecture_id, lecture_title, resource_type, username)
    except Exception as exc:
        error_message = str(exc or "学习资源选题生成失败。").strip()
        record = append_learning_resource_task(
            _cfg,
            {
                "task_type": "topic_suggestions",
                "status": "failed",
                "resource_type": resource_type,
                "lecture_id": lecture_id,
                "lecture_title": lecture_title,
                "title": f"{lecture_title} {_learning_resource_type_label(resource_type)}选题",
                "topics": [],
                "selected_topic_ids": [],
                "topic_source": "llm",
                "error_message": error_message,
                "created_by": username,
            },
        )
        log_event(
            "learning_resource_topics_failed",
            "学习资源选题生成失败",
            payload={
                "username": username,
                "lecture_id": lecture_id,
                "resource_type": resource_type,
                "error": error_message,
            },
        )
        return jsonify({"success": False, "error": error_message, "message": "学习资源选题生成失败。", "task": record}), 502

    record = append_learning_resource_task(
        _cfg,
        {
            "task_type": "topic_suggestions",
            "status": "topics_ready",
            "resource_type": resource_type,
            "lecture_id": lecture_id,
            "lecture_title": lecture_title,
            "title": f"{lecture_title} {_learning_resource_type_label(resource_type)}选题",
            "topics": topics,
            "selected_topic_ids": [row["id"] for row in topics[:3]],
            "topic_source": "llm",
            "created_by": username,
        },
    )
    log_event(
        "learning_resource_topics_created",
        "学习资源选题已生成",
        payload={"username": username, "lecture_id": lecture_id, "resource_type": resource_type, "topic_count": len(topics), "topic_source": "llm"},
    )
    return jsonify({"success": True, "task": record, "topics": topics})


def _normalize_learning_resource_draft_topics(raw_topics: List[Any], selected_topic_ids: List[Any]) -> List[Dict[str, Any]]:
    selected_ids = {str(item or "").strip() for item in selected_topic_ids if str(item or "").strip()}
    rows: List[Dict[str, Any]] = []
    seen_titles: set[str] = set()

    for index, item in enumerate(raw_topics):
        if isinstance(item, MappingABC):
            topic_id = str(item.get("id") or f"topic_{index + 1}").strip()
            title = str(item.get("title") or item.get("name") or "").strip()
            reason = str(item.get("reason") or item.get("description") or "").strip()
            source = str(item.get("source") or "").strip()
        else:
            topic_id = f"topic_{index + 1}"
            title = str(item or "").strip()
            reason = ""
            source = ""

        if selected_ids and topic_id not in selected_ids:
            continue

        title = re.sub(r"\s+", " ", title).strip(" -:：。")

        if not title or title in seen_titles:
            continue

        seen_titles.add(title)
        row: Dict[str, Any] = {
            "id": topic_id,
            "title": title,
        }

        if reason:
            row["reason"] = reason

        if source:
            row["source"] = source

        rows.append(row)

    return rows


def _create_learning_resource_draft_job(
    *,
    lecture_id: str,
    lecture_title: str,
    resource_type: str,
    title: str,
    topics: List[Dict[str, Any]],
    selected_topic_ids: List[Any],
    username: str,
) -> Dict[str, Any]:
    clean_title = str(title or "").strip()
    record = append_learning_resource_task(
        _cfg,
        {
            "task_type": "draft",
            "status": "draft_queued",
            "resource_type": resource_type,
            "lecture_id": lecture_id,
            "lecture_title": lecture_title,
            "title": clean_title,
            "topics": topics,
            "selected_topic_ids": [str(item or "").strip() for item in selected_topic_ids if str(item or "").strip()],
            "created_by": username,
        },
    )
    resource = append_learning_resource(
        _cfg,
        {
            "status": "queued",
            "visibility": "public",
            "resource_type": resource_type,
            "lecture_id": lecture_id,
            "lecture_title": lecture_title,
            "title": clean_title,
            "summary": _learning_resource_summary(clean_title, resource_type, lecture_title),
            "content": "",
            "source_task_id": record.get("id"),
            "created_by": username,
        },
    )
    worker = threading.Thread(
        target=_run_learning_resource_generation,
        args=(str(record.get("id") or ""), str(resource.get("id") or ""), username),
        name="learning-resource-generation",
        daemon=True,
    )
    worker.start()

    return {
        "task": record,
        "resource": resource,
    }


@bp.route("/frontend/learning-resources/drafts", methods=["POST"])
def frontend_learning_resource_draft():
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can create resource drafts."}), 403
    data = request.get_json(silent=True) or {}
    if not isinstance(data, MappingABC):
        return jsonify({"success": False, "error": "request body must be an object."}), 400
    lecture_id = str(data.get("lecture_id") or "").strip()
    resource_type = str(data.get("resource_type") or "explainer").strip() or "explainer"
    lecture_title = _learning_resource_lecture_title(lecture_id)
    title = str(data.get("title") or "").strip()
    topics = _normalize_learning_resource_draft_topics(
        data.get("topics") if isinstance(data.get("topics"), list) else [],
        data.get("selected_topic_ids") if isinstance(data.get("selected_topic_ids"), list) else [],
    )
    selected_topic_ids = data.get("selected_topic_ids") if isinstance(data.get("selected_topic_ids"), list) else []

    draft_specs: List[Dict[str, Any]] = []

    for topic in topics:
        topic_title = str(topic.get("title") or "").strip()
        topic_id = str(topic.get("id") or "").strip()

        if topic_title:
            draft_specs.append(
                {
                    "title": topic_title,
                    "topics": [topic],
                    "selected_topic_ids": [topic_id] if topic_id else [],
                }
            )

    if not draft_specs:
        manual_title = title or f"{lecture_title} {_learning_resource_type_label(resource_type)}草稿"
        draft_specs.append(
            {
                "title": manual_title,
                "topics": [],
                "selected_topic_ids": [str(item or "").strip() for item in selected_topic_ids if str(item or "").strip()],
            }
        )

    created_rows = [
        _create_learning_resource_draft_job(
            lecture_id=lecture_id,
            lecture_title=lecture_title,
            resource_type=resource_type,
            title=str(spec.get("title") or "").strip(),
            topics=spec.get("topics") if isinstance(spec.get("topics"), list) else [],
            selected_topic_ids=spec.get("selected_topic_ids") if isinstance(spec.get("selected_topic_ids"), list) else [],
            username=username,
        )
        for spec in draft_specs
    ]
    tasks = [row["task"] for row in created_rows]
    resources = [row["resource"] for row in created_rows]
    log_event(
        "learning_resource_draft_created",
        "学习资源草稿任务已创建并开始生成正文",
        payload={
            "username": username,
            "lecture_id": lecture_id,
            "resource_type": resource_type,
            "draft_count": len(resources),
            "titles": [str(item.get("title") or "") for item in resources],
        },
    )
    return jsonify(
        {
            "success": True,
            "task": tasks[0] if tasks else None,
            "resource": resources[0] if resources else None,
            "tasks": tasks,
            "resources": resources,
            "total": len(resources),
        }
    )


def _builtin_feed_channels(username: str, is_admin: bool) -> List[Dict[str, Any]]:
    rows = [
        {
            "id": "public_all",
            "title": "所有动态",
            "type": "public",
            "member_user_ids": [],
            "builtin": True,
        }
    ]
    rows.append(
        {
            "id": "public_admin",
            "title": "公告",
            "type": "public",
            "member_user_ids": [],
            "builtin": True,
        }
    )
    return rows


def _normalize_channel_members(raw_members: Any) -> List[str]:
    if not isinstance(raw_members, list):
        return []
    rows: List[str] = []
    seen = set()
    for item in raw_members:
        value = str(item or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        rows.append(value)
    return rows


def _resolve_learning_feed_channels_for_user(username: str, is_admin: bool) -> List[Dict[str, Any]]:
    custom_rows = list_learning_feed_channels(_cfg)
    visible_rows: List[Dict[str, Any]] = []
    for row in custom_rows:
        if not isinstance(row, dict):
            continue
        channel_type = str(row.get("type") or "private").strip().lower()
        member_user_ids = _normalize_channel_members(row.get("member_user_ids"))
        if channel_type == "public" or (username and username in member_user_ids) or is_admin:
            visible_rows.append(
                {
                    **row,
                    "member_user_ids": member_user_ids,
                    "builtin": False,
                }
            )
    return _builtin_feed_channels(username, is_admin) + visible_rows


def _can_view_feed_channel(channel: Dict[str, Any], username: str, is_admin: bool) -> bool:
    channel_id = str(channel.get("id") or "").strip()
    if channel_id == "public_all":
        return True
    if channel_id == "public_admin":
        return True
    channel_type = str(channel.get("type") or "private").strip().lower()
    member_user_ids = _normalize_channel_members(channel.get("member_user_ids"))
    return bool(channel_type == "public" or is_admin or (username and username in member_user_ids))


@bp.route("/frontend/learning-feeds/channels", methods=["GET"])
def frontend_learning_feed_channels():
    username = str(_resolve_runtime_user_id() or "").strip()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    is_admin = bool(_is_runtime_admin())
    rows = _resolve_learning_feed_channels_for_user(username, is_admin)
    return jsonify({"success": True, "items": rows, "total": len(rows)})


@bp.route("/frontend/settings/feed-channels", methods=["POST"])
def frontend_settings_feed_channels_create():
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can create channels."}), 403
    data = request.get_json(silent=True) or {}
    title = str(data.get("title") or "").strip()
    if not title:
        return jsonify({"success": False, "error": "title is required."}), 400
    member_user_ids = _normalize_channel_members(data.get("member_user_ids"))
    if "ALL" in {item.upper() for item in member_user_ids}:
        member_user_ids = []
        channel_type = "public"
    else:
        channel_type = "private"
    record = upsert_learning_feed_channel(
        _cfg,
        {
            "title": title,
            "type": channel_type,
            "member_user_ids": member_user_ids,
            "created_by": str(_resolve_runtime_user_id() or "").strip(),
        },
    )
    return jsonify({"success": True, "item": record})


@bp.route("/frontend/settings/feed-channels/<channel_id>", methods=["DELETE"])
def frontend_settings_feed_channels_delete(channel_id: str):
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can delete channels."}), 403
    removed = delete_learning_feed_channel(_cfg, channel_id)
    if not removed:
        return jsonify({"success": False, "error": "channel not found."}), 404
    return jsonify({"success": True, "channel_id": channel_id})


@bp.route("/frontend/settings/feed-channels/<channel_id>", methods=["PATCH"])
def frontend_settings_feed_channels_update(channel_id: str):
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can update channels."}), 403

    data = request.get_json(silent=True) or {}

    # 获取现有频道记录
    from core.learning_feed import list_learning_feed_channels
    existing_channels = list_learning_feed_channels(_cfg)
    existing_channel = None
    for ch in existing_channels:
        if str(ch.get("id") or "").strip() == channel_id:
            existing_channel = ch
            break

    if not existing_channel:
        return jsonify({"success": False, "error": "channel not found."}), 404

    # 合并更新字段
    updates = {}

    if "title" in data:
        title = str(data.get("title") or "").strip()
        if not title:
            return jsonify({"success": False, "error": "title cannot be empty."}), 400
        updates["title"] = title

    if "member_user_ids" in data:
        member_user_ids = _normalize_channel_members(data.get("member_user_ids"))
        if "ALL" in {item.upper() for item in member_user_ids}:
            member_user_ids = []
            updates["type"] = "public"
        else:
            updates["type"] = "private"
        updates["member_user_ids"] = member_user_ids

    if not updates:
        return jsonify({"success": False, "error": "No valid fields to update."}), 400

    # 合并现有记录和更新
    merged_record = {**existing_channel, **updates, "id": channel_id}

    record = upsert_learning_feed_channel(
        _cfg,
        merged_record,
    )
    return jsonify({"success": True, "item": record})


@bp.route("/frontend/learning-feeds", methods=["GET"])
def frontend_learning_feeds():
    username = str(_resolve_runtime_user_id() or "").strip()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    limit = _safe_int(request.args.get("limit"), 50)
    selected_channel_id = str(request.args.get("channel_id") or "public_all").strip() or "public_all"
    current_is_admin = bool(_is_runtime_admin())
    visible_channels = _resolve_learning_feed_channels_for_user(username, current_is_admin)
    channel_map = {str(row.get("id") or "").strip(): row for row in visible_channels if isinstance(row, dict)}
    if selected_channel_id not in channel_map:
        selected_channel_id = "public_all"
    rows = list_learning_feed_items(_cfg, limit=max(limit, 200))
    rows = [
        row for row in rows
        if isinstance(row, dict)
        and str(row.get("channel_id") or "public_all").strip() == selected_channel_id
        and _can_view_feed_channel(channel_map.get(selected_channel_id, {"id": "public_all", "type": "public"}), username, current_is_admin)
    ][:limit]
    author_cache: Dict[str, Dict[str, Any]] = {}
    current_user_keys = _resolve_feed_user_key_set(username)

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
            current_is_admin
            or _feed_user_keys_match(current_user_keys, author, author_view, row.get("username"), row.get("user_id"))
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
                        "likes_count": max(0, _safe_int(comment.get("likes_count"), 0)),
                        "liked_user_ids": comment.get("liked_user_ids") if isinstance(comment.get("liked_user_ids"), list) else [],
                        "can_delete": bool(
                            current_is_admin
                            or _feed_user_keys_match(
                                current_user_keys,
                                comment_author,
                                comment_author_view,
                                comment_author_id,
                                comment.get("username"),
                            )
                        ),
                    }
                )
            row["comments"] = rendered_comments
    return jsonify(
        {
            "success": True,
            "items": rows,
            "total": len(rows),
            "channel_id": selected_channel_id,
            "channels": visible_channels,
        }
    )


@bp.route("/frontend/learning-feeds", methods=["POST"])
def frontend_learning_feeds_create():
    data = request.get_json(silent=True) or {}
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    current_is_admin = bool(_is_runtime_admin())
    content = str(data.get("content") or data.get("summary") or "").strip()
    if not content:
        return jsonify({"success": False, "error": "content is required."}), 400
    selected_channel_id = str(data.get("channel_id") or "public_all").strip() or "public_all"
    visible_channels = _resolve_learning_feed_channels_for_user(str(username), current_is_admin)
    channel_map = {str(row.get("id") or "").strip(): row for row in visible_channels if isinstance(row, dict)}
    channel = channel_map.get(selected_channel_id)
    if not channel or not _can_view_feed_channel(channel, str(username), current_is_admin):
        return jsonify({"success": False, "error": "invalid channel."}), 400
    if selected_channel_id == "public_admin" and not current_is_admin:
        return jsonify({"success": False, "error": "only admin can post to admin channel."}), 403
    author = _build_feed_author_snapshot(username)
    record = prepend_learning_feed_item(
        _cfg,
        {
            "type": "user_post",
            "channel_id": selected_channel_id,
            "summary": content,
            "content": content,
            "username": username,
            "author": author,
            "liked_user_ids": [],
            "likes_count": 0,
            "comments_count": 0,
        },
    )
    _notify_feed_mentions(
        username,
        content,
        title=f"你在动态中被 @{username} 提到",
    )
    log_event("learning_feed_posted", {"username": username, "chars": len(content), "channel_id": selected_channel_id, "source": "feed"})
    return jsonify({"success": True, "item": record})


@bp.route("/frontend/learning-feeds/users/search", methods=["GET"])
def frontend_learning_feed_users_search():
    username = str(_resolve_runtime_user_id() or "").strip()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    query = str(request.args.get("q") or "").strip()
    limit = max(1, min(_safe_int(request.args.get("limit"), 8), 20))
    if not query:
        rows = _list_recent_feed_user_examples(limit=min(limit, 5))
        return jsonify({"success": True, "items": rows, "total": len(rows), "query": ""})
    rows = _search_nexora_users(query, limit=limit)
    return jsonify({"success": True, "items": rows, "total": len(rows), "query": query})


@bp.route("/frontend/users/search", methods=["GET"])
def frontend_users_search():
    """通用用户搜索接口 (教师管理等场景)"""
    query = str(request.args.get("q") or "").strip()
    limit = max(1, min(_safe_int(request.args.get("limit"), 10), 30))
    if not query:
        # 空查询：优先获取最近活跃用户，不足时用通用搜索补充
        rows = _list_recent_feed_user_examples(limit=limit)
        if len(rows) < limit and _proxy is not None:
            seen = {str(r.get("user_id") or "").strip() for r in rows}
            # 用常见字符做宽泛搜索，补充更多用户
            for filler_q in ["a", "e", "1", "2"]:
                extra = _search_nexora_users(filler_q, limit=limit)
                for u in extra:
                    uid = str(u.get("user_id") or "").strip()
                    if uid and uid not in seen:
                        seen.add(uid)
                        rows.append(u)
                    if len(rows) >= limit:
                        break
                if len(rows) >= limit:
                    break
        return jsonify({"success": True, "items": rows[:limit], "total": len(rows[:limit]), "query": ""})
    rows = _search_nexora_users(query, limit=limit)
    return jsonify({"success": True, "items": rows, "total": len(rows), "query": query})


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
    _notify_feed_mentions(
        username,
        content,
        title=f"你在评论中被 @{username} 提到",
    )
    log_event("learning_feed_commented", {"feed_id": feed_id, "username": username, "chars": len(content), "source": "feed"})
    return jsonify({"success": True, "item": updated})


@bp.route("/frontend/learning-feeds/<feed_id>/comments/<comment_id>/like", methods=["POST"])
def frontend_learning_feed_comment_like(feed_id: str, comment_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    updated = toggle_learning_feed_comment_like(_cfg, feed_id, comment_id, username)
    if not isinstance(updated, dict):
        return jsonify({"success": False, "error": "comment not found."}), 404
    log_event(
        "learning_feed_comment_liked",
        {"feed_id": feed_id, "comment_id": comment_id, "username": username, "source": "feed"},
    )
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
    current_user_keys = _resolve_feed_user_key_set(username)
    if not (
        _is_runtime_admin()
        or _feed_user_keys_match(current_user_keys, author, author_id, target.get("username"), target.get("user_id"))
    ):
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
    current_user_keys = _resolve_feed_user_key_set(username)
    if not (
        _is_runtime_admin()
        or _feed_user_keys_match(
            current_user_keys,
            comment_author,
            comment_author_id,
            target_comment.get("username"),
        )
    ):
        return jsonify({"success": False, "error": "forbidden"}), 403
    updated = delete_learning_feed_comment(_cfg, feed_id, comment_id)
    if not isinstance(updated, dict):
        return jsonify({"success": False, "error": "comment not found."}), 404
    log_event("learning_feed_comment_deleted", {"feed_id": feed_id, "comment_id": comment_id, "username": username, "source": "feed"})
    return jsonify({"success": True, "item": updated})


# ── 个性化学习路线与章节内容 ─────────────────────────────────────────

def _reader_guide_sse_event(event: str, data: Any) -> str:
    """Format an SSE event."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _build_personalized_learning_catalog_context(
    lecture_id: str,
    outline: Any,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """基于课程大纲与教材目录构建学习路线输入上下文。"""
    from core.booksproc.summary import _extract_chapter_summaries

    books = list_lecture_books(_cfg, lecture_id) or []
    if not books:
        raise ValueError("课程教材列表为空，请先上传并解析教材。")

    if not isinstance(outline, dict) or not isinstance(outline.get("sections"), list):
        raise ValueError("课程大纲结构无效，请重新生成课程大纲。")

    books_info: List[Dict[str, Any]] = []
    catalog_rows: List[Dict[str, Any]] = []
    missing_catalog_titles: List[str] = []

    for book in books:
        if not isinstance(book, dict):
            continue

        book_id = str(book.get("id") or "").strip()
        book_title = str(book.get("title") or "").strip()
        if not book_id:
            continue

        chapter_rows = _extract_chapter_summaries(load_book_info_xml(_cfg, lecture_id, book_id))
        if not chapter_rows:
            missing_catalog_titles.append(book_title or book_id)
            continue

        books_info.append({
            "book_id": book_id,
            "title": book_title or book_id,
            "catalog_chapters": len(chapter_rows),
        })

        for chapter_index, chapter in enumerate(chapter_rows):
            catalog_rows.append({
                "book_id": book_id,
                "book_title": book_title or book_id,
                "chapter_index": chapter_index,
                "chapter_name": str(chapter.get("chapter_name") or "").strip(),
                "chapter_range": str(chapter.get("chapter_range") or "").strip(),
                "chapter_summary": str(chapter.get("chapter_summary") or "").strip(),
            })

    if missing_catalog_titles:
        joined_titles = "、".join(missing_catalog_titles)
        raise ValueError(f"以下教材缺少可用目录，请先完成教材粗读解析：{joined_titles}")

    if not catalog_rows:
        raise ValueError("教材目录为空，请先完成教材粗读解析后再生成学习路线。")

    return books_info, catalog_rows


def _parse_start_length_range(range_text: str) -> Tuple[int, int]:
    """解析 START:LENGTH 章节范围。"""
    text = str(range_text or "").strip()
    left, sep, right = text.partition(":")
    if not sep:
        raise ValueError(f"章节范围格式无效：{text}")

    try:
        start = int(left.strip())
        length = int(right.strip())
    except ValueError as exc:
        raise ValueError(f"章节范围格式无效：{text}") from exc

    if start < 0 or length <= 0:
        raise ValueError(f"章节范围数值无效：{text}")

    return start, length


def _slice_book_text_by_range(book_text: str, range_text: str) -> str:
    """按学习路线保存的章节范围截取教材原文。"""
    start, length = _parse_start_length_range(range_text)
    text = str(book_text or "")
    end = start + length

    if start >= len(text) or end > len(text):
        raise ValueError(f"章节范围超出教材原文长度：{range_text}")

    chapter_text = text[start:end].strip()
    if not chapter_text:
        raise ValueError(f"章节范围内原文为空：{range_text}")

    return chapter_text


def _clean_chapter_source_text(raw_text: str) -> str:
    """清理原文章节中的 HTML 标签，避免模型把排版标签当成可引用原文。"""
    text = html_lib.unescape(str(raw_text or ""))

    if not text.strip():
        raise ValueError("章节原文为空，无法生成文章阅读。")

    text = re.sub(r"(?is)<\s*(script|style)[^>]*>.*?<\s*/\s*\1\s*>", "", text)
    text = re.sub(r"(?is)<\s*br\s*/?\s*>", "\n", text)
    text = re.sub(
        r"(?is)<\s*/?\s*(?:address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)(?:\s+[^>]*)?\s*/?\s*>",
        "\n",
        text,
    )
    text = re.sub(
        r"(?is)<\s*/?\s*(?:a|abbr|b|bdi|bdo|cite|code|data|dfn|em|font|i|kbd|mark|q|rp|rt|ruby|s|samp|small|span|strong|sub|sup|time|u|var|wbr)(?:\s+[^>]*)?\s*/?\s*>",
        "",
        text,
    )
    text = re.sub(r"(?is)<\s*/?\s*[a-z][a-z0-9:-]*(?:\s+[^>]*)?\s*/?\s*>", "", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    cleaned = text.strip()
    if not cleaned:
        raise ValueError("章节原文清理 HTML 标签后为空，无法生成文章阅读。")

    return cleaned


@bp.route("/frontend/personalized-learning/generate-path", methods=["POST"])
def frontend_personalized_learning_generate_path():
    """SSE 流式生成个性化学习路线。"""
    try:
        data = request.get_json(silent=True) or {}
        lecture_id = str(data.get("lecture_id") or "").strip()
        if not lecture_id:
            raise ValueError("lecture_id is required.")
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    def event_stream():
        events: "queue.Queue[Tuple[str, Dict[str, Any]]]" = queue.Queue()

        def push_event(event_name: str, event_payload: Dict[str, Any]) -> None:
            events.put((event_name, event_payload))

        def push_delta(delta_text: str) -> None:
            text = str(delta_text or "")
            if text:
                append_log_text(text)
                push_event("delta", {"content": text})

        def run_worker() -> None:
            try:
                from core.booksproc.personalized_learning import (
                    generate_learning_path_with_tools,
                    save_learning_path,
                    load_pre_reading_qa,
                )
                from core.booksproc.outline import load_outline

                log_event(
                    "personalized_learning_path_stream_start",
                    "个性化学习路线流启动",
                    payload={"user_id": user_id, "lecture_id": lecture_id},
                )

                outline = load_outline(_cfg, lecture_id)
                if not outline:
                    push_event("error", {"success": False, "error": "课程大纲未生成，请先生成大纲。"})
                    return

                books_info, catalog_rows = _build_personalized_learning_catalog_context(lecture_id, outline)

                user_md = str(user_store.read_memory(_cfg, user_id, "user") or "")

                qa_data = load_pre_reading_qa(_cfg, user_id, lecture_id)

                from prompts import (
                    PERSONALIZED_LEARNING_PATH_SYSTEM_PROMPT,
                    PERSONALIZED_LEARNING_PATH_USER_PROMPT,
                )

                outline_json = json.dumps(outline, ensure_ascii=False)
                books_json = json.dumps(books_info, ensure_ascii=False)
                catalog_json = json.dumps(catalog_rows, ensure_ascii=False)
                qa_json = json.dumps(qa_data, ensure_ascii=False) if qa_data else "{}"
                profile_json = json.dumps({"user_profile": user_md[:3000]}, ensure_ascii=False)

                proxy = _cfg.get("__proxy__")
                if proxy is None:
                    from core.nexora_proxy import NexoraProxy as _NP
                    proxy = _NP(_cfg)
                    _cfg["__proxy__"] = proxy

                default_model = get_default_nexora_model(_cfg)

                log_event(
                    "personalized_learning_path_stream_context",
                    "个性化学习路线上下文已装载",
                    payload={
                        "user_id": user_id,
                        "lecture_id": lecture_id,
                        "books_count": len(books_info),
                        "catalog_chapters": len(catalog_rows),
                        "catalog_chars": len(catalog_json),
                        "outline_sections": len(outline.get("sections") or []) if isinstance(outline, dict) else 0,
                        "qa_present": bool(qa_data),
                    },
                )

                user_prompt = PERSONALIZED_LEARNING_PATH_USER_PROMPT.replace(
                    "{{outline_json}}", outline_json
                ).replace(
                    "{{books_json}}", books_json
                ).replace(
                    "{{catalog_json}}", catalog_json
                ).replace(
                    "{{qa_json}}", qa_json
                ).replace(
                    "{{profile_json}}", profile_json
                )

                advice_text, chapters = generate_learning_path_with_tools(
                    _cfg,
                    proxy=proxy,
                    model_name=default_model or "",
                    user_id=user_id,
                    lecture_id=lecture_id,
                    system_prompt=PERSONALIZED_LEARNING_PATH_SYSTEM_PROMPT,
                    user_prompt=user_prompt,
                    full_text=catalog_json,
                    request_timeout=180,
                    catalog_rows=catalog_rows,
                    on_delta=push_delta,
                )

                if not chapters:
                    push_event("error", {"success": False, "error": "无法解析学习路线结果"})
                    return

                path_data = {
                    "advice": advice_text,
                    "chapters": chapters,
                    "outline": outline,
                    "books": books_info,
                    "catalog": catalog_rows,
                    "qa": qa_data,
                    "user_profile_summary": user_md[:1000],
                }
                save_learning_path(_cfg, user_id, lecture_id, path_data)

                push_event("done", {
                    "success": True,
                    "advice": advice_text,
                    "chapters": chapters,
                    "cached": False,
                })

            except Exception as exc:
                log_event(
                    "personalized_learning_path_error",
                    str(exc),
                    payload={"user_id": user_id, "lecture_id": lecture_id},
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                push_event("close", {})

        thread = threading.Thread(target=run_worker, name="personalized-learning-path", daemon=True)
        thread.start()

        yield _reader_guide_sse_event("status", {"message": "personalized learning path generation started"})

        while True:
            try:
                event_name, event_payload = events.get(timeout=30)
            except queue.Empty:
                yield _reader_guide_sse_event("ping", {"timestamp": time.time()})
                continue

            if event_name == "close":
                break

            yield _reader_guide_sse_event(event_name, event_payload)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@bp.route("/frontend/personalized-learning/generate-path-stream", methods=["GET"])
def frontend_personalized_learning_generate_path_stream():
    """GET SSE endpoint for learning path generation (for EventSource)."""
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    if not lecture_id:
        return Response("event: error\ndata: {\"error\": \"lecture_id is required\"}\n\n", mimetype="text/event-stream")

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return Response("event: error\ndata: {\"error\": \"user_id is required\"}\n\n", mimetype="text/event-stream")

    def event_stream():
        events: "queue.Queue[Tuple[str, Dict[str, Any]]]" = queue.Queue()

        def push_event(event_name: str, event_payload: Dict[str, Any]) -> None:
            events.put((event_name, event_payload))

        def push_delta(delta_text: str) -> None:
            text = str(delta_text or "")
            if text:
                append_log_text(text)
                push_event("delta", {"content": text})

        def run_worker() -> None:
            try:
                from core.booksproc.personalized_learning import (
                    generate_learning_path_with_tools,
                    save_learning_path,
                    load_pre_reading_qa,
                )
                from core.booksproc.outline import load_outline

                log_event(
                    "personalized_learning_path_stream_start",
                    "个性化学习路线流启动",
                    payload={"user_id": user_id, "lecture_id": lecture_id},
                )

                outline = load_outline(_cfg, lecture_id)
                if not outline:
                    push_event("error", {"success": False, "error": "课程大纲未生成"})
                    return

                books_info, catalog_rows = _build_personalized_learning_catalog_context(lecture_id, outline)

                user_md = str(user_store.read_memory(_cfg, user_id, "user") or "")
                qa_data = load_pre_reading_qa(_cfg, user_id, lecture_id)

                from prompts import (
                    PERSONALIZED_LEARNING_PATH_SYSTEM_PROMPT,
                    PERSONALIZED_LEARNING_PATH_USER_PROMPT,
                )

                outline_json = json.dumps(outline, ensure_ascii=False)
                books_json = json.dumps(books_info, ensure_ascii=False)
                catalog_json = json.dumps(catalog_rows, ensure_ascii=False)
                qa_json = json.dumps(qa_data, ensure_ascii=False) if qa_data else "{}"
                profile_json = json.dumps({"user_profile": user_md[:3000]}, ensure_ascii=False)

                proxy = _cfg.get("__proxy__")
                if proxy is None:
                    from core.nexora_proxy import NexoraProxy as _NP
                    proxy = _NP(_cfg)
                    _cfg["__proxy__"] = proxy

                default_model = get_default_nexora_model(_cfg)

                log_event(
                    "personalized_learning_path_stream_context",
                    "个性化学习路线上下文已装载",
                    payload={
                        "user_id": user_id,
                        "lecture_id": lecture_id,
                        "books_count": len(books_info),
                        "catalog_chapters": len(catalog_rows),
                        "catalog_chars": len(catalog_json),
                        "outline_sections": len(outline.get("sections") or []) if isinstance(outline, dict) else 0,
                        "qa_present": bool(qa_data),
                    },
                )

                user_prompt = PERSONALIZED_LEARNING_PATH_USER_PROMPT.replace(
                    "{{outline_json}}", outline_json
                ).replace(
                    "{{books_json}}", books_json
                ).replace(
                    "{{catalog_json}}", catalog_json
                ).replace(
                    "{{qa_json}}", qa_json
                ).replace(
                    "{{profile_json}}", profile_json
                )

                advice_text, chapters = generate_learning_path_with_tools(
                    _cfg,
                    proxy=proxy,
                    model_name=default_model or "",
                    user_id=user_id,
                    lecture_id=lecture_id,
                    system_prompt=PERSONALIZED_LEARNING_PATH_SYSTEM_PROMPT,
                    user_prompt=user_prompt,
                    full_text=catalog_json,
                    request_timeout=180,
                    catalog_rows=catalog_rows,
                    on_delta=push_delta,
                )

                if not chapters:
                    push_event("error", {"success": False, "error": "无法解析学习路线结果"})
                    return

                path_data = {
                    "advice": advice_text,
                    "chapters": chapters,
                    "outline": outline,
                    "books": books_info,
                    "catalog": catalog_rows,
                    "qa": qa_data,
                    "user_profile_summary": user_md[:1000],
                }
                save_learning_path(_cfg, user_id, lecture_id, path_data)

                push_event("done", {
                    "success": True,
                    "advice": advice_text,
                    "chapters": chapters,
                    "cached": False,
                })

            except Exception as exc:
                log_event(
                    "personalized_learning_path_error",
                    str(exc),
                    payload={"user_id": user_id, "lecture_id": lecture_id},
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                push_event("close", {})

        thread = threading.Thread(target=run_worker, name="personalized-learning-path-get", daemon=True)
        thread.start()

        yield _reader_guide_sse_event("status", {"message": "personalized learning path generation started"})

        while True:
            try:
                event_name, event_payload = events.get(timeout=30)
            except queue.Empty:
                yield _reader_guide_sse_event("ping", {"timestamp": time.time()})
                continue

            if event_name == "close":
                break

            yield _reader_guide_sse_event(event_name, event_payload)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@bp.route("/frontend/personalized-learning/load-path", methods=["POST"])
def frontend_personalized_learning_load_path():
    """加载已生成的学习路线。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    if not lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required."}), 400

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    from core.booksproc.personalized_learning import (
        load_all_chapter_generation_states,
        load_chapter_generation_state,
        load_learning_path,
        load_all_chapter_status,
    )

    path_data = load_learning_path(_cfg, user_id, lecture_id)
    if not path_data:
        return jsonify({"success": True, "cached": False})

    chapters_status = load_all_chapter_status(_cfg, user_id, lecture_id)
    generation_states = load_all_chapter_generation_states(_cfg, user_id, lecture_id)
    generation_state = next(
        (
            row for row in generation_states
            if isinstance(row, dict) and str(row.get("status") or "").strip().lower() == "running"
        ),
        None,
    )
    chapter_generation = None
    if isinstance(generation_state, dict):
        chapter_generation = {
            key: generation_state.get(key)
            for key in (
                "job_id",
                "user_id",
                "lecture_id",
                "chapter_index",
                "status",
                "error",
                "started_at",
                "updated_at",
                "finished_at",
            )
        }
        chapter_generation["raw_content_chars"] = len(str(generation_state.get("raw_content") or ""))
    chapter_generations = []
    for row in generation_states:
        if not isinstance(row, dict):
            continue
        item = {
            key: row.get(key)
            for key in (
                "job_id",
                "user_id",
                "lecture_id",
                "chapter_index",
                "status",
                "error",
                "started_at",
                "updated_at",
                "finished_at",
            )
        }
        item["raw_content_chars"] = len(str(row.get("raw_content") or ""))
        chapter_generations.append(item)

    return jsonify({
        "success": True,
        "cached": True,
        "advice": path_data.get("advice", ""),
        "chapters": chapters_status,
        "chapter_generation": chapter_generation,
        "chapter_generations": chapter_generations,
    })


def _build_personalized_chapter_generation_worker(user_id: str, lecture_id: str, chapter_index: int):
    def worker(on_delta):
        from core.booksproc.personalized_learning import (
            generate_chapter_markdown_with_tools,
            load_learning_path,
            load_pre_reading_qa,
            save_chapter_content,
        )
        from core.lectures import load_book_text

        log_event(
            "personalized_chapter_stream_start",
            "个性化章节内容生成任务启动",
            payload={"user_id": user_id, "lecture_id": lecture_id, "chapter_index": chapter_index},
        )

        path_data = load_learning_path(_cfg, user_id, lecture_id)
        if not path_data:
            raise ValueError("学习路径未生成，请先生成学习路径。")

        chapters = path_data.get("chapters") or []
        if chapter_index < 0 or chapter_index >= len(chapters):
            raise ValueError("章节索引超出范围。")

        chapter = chapters[chapter_index] if isinstance(chapters[chapter_index], dict) else {}
        chapter_name = str(chapter.get("name") or "").strip()
        book_id = str(chapter.get("book_id") or "").strip()
        book_title = str(chapter.get("book_title") or "").strip()
        chapter_range = str(chapter.get("chapter_range") or "").strip()
        chapter_summary = str(chapter.get("chapter_summary") or "").strip()

        if not book_id:
            raise ValueError("章节未关联教材。")
        if not chapter_range:
            raise ValueError("学习路径缺少章节范围，请重新生成学习路径。")

        book_text = load_book_text(_cfg, lecture_id, book_id)
        if not book_text:
            raise ValueError("教材内容未找到。")

        chapter_text = _clean_chapter_source_text(_slice_book_text_by_range(book_text, chapter_range))
        user_md = str(user_store.read_memory(_cfg, user_id, "user") or "")
        qa_data = load_pre_reading_qa(_cfg, user_id, lecture_id)

        from prompts import (
            CHAPTER_CONTENT_GENERATION_SYSTEM_PROMPT,
            CHAPTER_CONTENT_GENERATION_USER_PROMPT,
        )

        profile_json = json.dumps({"user_profile": user_md[:2000]}, ensure_ascii=False)
        qa_json = json.dumps(qa_data, ensure_ascii=False) if qa_data else "{}"
        advice_text = str(path_data.get("advice") or "").strip()

        user_prompt = CHAPTER_CONTENT_GENERATION_USER_PROMPT.replace(
            "{{chapter_name}}", chapter_name
        ).replace(
            "{{book_title}}", book_title
        ).replace(
            "{{chapter_index}}", str(chapter_index)
        ).replace(
            "{{chapter_range}}", chapter_range
        ).replace(
            "{{chapter_summary}}", chapter_summary
        ).replace(
            "{{book_content}}", chapter_text
        ).replace(
            "{{profile_json}}", profile_json
        ).replace(
            "{{qa_json}}", qa_json
        ).replace(
            "{{learning_path_advice}}", advice_text
        )

        proxy = _cfg.get("__proxy__")
        if proxy is None:
            from core.nexora_proxy import NexoraProxy as _NP
            proxy = _NP(_cfg)
            _cfg["__proxy__"] = proxy

        def push_delta(delta_text: str) -> None:
            text = str(delta_text or "")
            if text:
                append_log_text(text)
                on_delta(text)

        default_model = get_default_nexora_model(_cfg)
        markdown_content = generate_chapter_markdown_with_tools(
            _cfg,
            proxy=proxy,
            model_name=default_model or "",
            user_id=user_id,
            lecture_id=lecture_id,
            chapter_name=chapter_name,
            system_prompt=CHAPTER_CONTENT_GENERATION_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            full_text=chapter_text,
            request_timeout=300,
            on_delta=push_delta,
        )
        if not markdown_content:
            raise ValueError("生成内容为空")

        save_chapter_content(_cfg, user_id, lecture_id, chapter_index, markdown_content)
        return {
            "success": True,
            "chapter_index": chapter_index,
            "chapter_name": chapter_name,
            "content": markdown_content,
        }

    return worker


def _personalized_learning_chapter_stream_response(user_id: str, lecture_id: str, chapter_index: int):
    def event_stream():
        from core.booksproc.personalized_learning import (
            load_chapter_content,
            start_or_attach_chapter_generation,
        )

        cached_content = load_chapter_content(_cfg, user_id, lecture_id, chapter_index)
        if cached_content is not None:
            yield _reader_guide_sse_event(
                "done",
                {
                    "success": True,
                    "cached": True,
                    "chapter_index": chapter_index,
                    "content": cached_content,
                },
            )
            return

        job, mode = start_or_attach_chapter_generation(
            _cfg,
            user_id=user_id,
            lecture_id=lecture_id,
            chapter_index=chapter_index,
            worker=_build_personalized_chapter_generation_worker(user_id, lecture_id, chapter_index),
        )
        snapshot = job.snapshot()
        active_index = int(snapshot.get("chapter_index") or chapter_index)
        yield _reader_guide_sse_event(
            "status",
            {
                "message": "chapter content generation attached" if mode != "started" else "chapter content generation started",
                "mode": mode,
                "job_id": str(snapshot.get("job_id") or ""),
                "chapter_index": active_index,
            },
        )

        raw_content = str(snapshot.get("raw_content") or "")
        raw_len = len(raw_content)
        if raw_content:
            yield _reader_guide_sse_event(
                "delta",
                {"content": raw_content, "replay": True, "chapter_index": active_index},
            )

        while True:
            snapshot = job.wait_for_change(raw_len, timeout=30)
            raw_content = str(snapshot.get("raw_content") or "")
            if len(raw_content) > raw_len:
                yield _reader_guide_sse_event(
                    "delta",
                    {"content": raw_content[raw_len:], "chapter_index": active_index},
                )
                raw_len = len(raw_content)

            status = str(snapshot.get("status") or "").strip().lower()
            if status == "done":
                yield _reader_guide_sse_event(
                    "done",
                    {
                        "success": True,
                        "chapter_index": active_index,
                        "content": str(snapshot.get("content") or ""),
                        "job_id": str(snapshot.get("job_id") or ""),
                    },
                )
                break
            if status == "error":
                yield _reader_guide_sse_event(
                    "error",
                    {
                        "success": False,
                        "chapter_index": active_index,
                        "error": str(snapshot.get("error") or "章节内容生成失败"),
                    },
                )
                break

            yield _reader_guide_sse_event(
                "ping",
                {
                    "timestamp": time.time(),
                    "job_id": str(snapshot.get("job_id") or ""),
                    "chapter_index": active_index,
                },
            )

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@bp.route("/frontend/personalized-learning/generate-chapter", methods=["POST"])
def frontend_personalized_learning_generate_chapter():
    """SSE 流式生成章节内容。"""
    try:
        data = request.get_json(silent=True) or {}
        lecture_id = str(data.get("lecture_id") or "").strip()
        chapter_index = data.get("chapter_index")
        if not lecture_id:
            raise ValueError("lecture_id is required.")
        if chapter_index is None:
            raise ValueError("chapter_index is required.")
        chapter_index = int(chapter_index)
    except (ValueError, TypeError) as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    return _personalized_learning_chapter_stream_response(user_id, lecture_id, chapter_index)

    def event_stream():
        events: "queue.Queue[Tuple[str, Dict[str, Any]]]" = queue.Queue()

        def push_event(event_name: str, event_payload: Dict[str, Any]) -> None:
            events.put((event_name, event_payload))

        def push_delta(delta_text: str) -> None:
            text = str(delta_text or "")
            if text:
                append_log_text(text)
                push_event("delta", {"content": text})

        def run_worker() -> None:
            try:
                from core.booksproc.personalized_learning import (
                    generate_chapter_markdown_with_tools,
                    load_learning_path,
                    save_chapter_content,
                )
                from core.lectures import load_book_text

                log_event(
                    "personalized_chapter_stream_start",
                    "个性化章节流启动",
                    payload={"user_id": user_id, "lecture_id": lecture_id, "chapter_index": chapter_index},
                )

                path_data = load_learning_path(_cfg, user_id, lecture_id)
                if not path_data:
                    push_event("error", {"success": False, "error": "学习路线未生成，请先生成学习路线。"})
                    return

                chapters = path_data.get("chapters") or []
                if chapter_index < 0 or chapter_index >= len(chapters):
                    push_event("error", {"success": False, "error": "章节索引超出范围。"})
                    return

                chapter = chapters[chapter_index]
                chapter_name = str(chapter.get("name") or "").strip()
                book_id = str(chapter.get("book_id") or "").strip()
                book_title = str(chapter.get("book_title") or "").strip()
                chapter_range = str(chapter.get("chapter_range") or "").strip()
                chapter_summary = str(chapter.get("chapter_summary") or "").strip()

                if not book_id:
                    push_event("error", {"success": False, "error": "章节未关联教材。"})
                    return
                if not chapter_range:
                    push_event("error", {"success": False, "error": "学习路线缺少章节范围，请重新生成学习路线。"})
                    return

                # 加载教材内容
                book_text = load_book_text(_cfg, lecture_id, book_id)
                if not book_text:
                    push_event("error", {"success": False, "error": "教材内容未找到。"})
                    return
                chapter_text = _clean_chapter_source_text(_slice_book_text_by_range(book_text, chapter_range))

                # 加载用户画像
                user_md = str(user_store.read_memory(_cfg, user_id, "user") or "")

                # 加载阅读前问答
                from core.booksproc.personalized_learning import load_pre_reading_qa
                qa_data = load_pre_reading_qa(_cfg, user_id, lecture_id)

                # 构建提示词
                from prompts import (
                    CHAPTER_CONTENT_GENERATION_SYSTEM_PROMPT,
                    CHAPTER_CONTENT_GENERATION_USER_PROMPT,
                )

                profile_json = json.dumps({"user_profile": user_md[:2000]}, ensure_ascii=False)
                qa_json = json.dumps(qa_data, ensure_ascii=False) if qa_data else "{}"
                advice_text = str(path_data.get("advice") or "").strip()

                user_prompt = CHAPTER_CONTENT_GENERATION_USER_PROMPT.replace(
                    "{{chapter_name}}", chapter_name
                ).replace(
                    "{{book_title}}", book_title
                ).replace(
                    "{{chapter_index}}", str(chapter_index)
                ).replace(
                    "{{chapter_range}}", chapter_range
                ).replace(
                    "{{chapter_summary}}", chapter_summary
                ).replace(
                    "{{book_content}}", chapter_text
                ).replace(
                    "{{profile_json}}", profile_json
                ).replace(
                    "{{qa_json}}", qa_json
                ).replace(
                    "{{learning_path_advice}}", advice_text
                )

                proxy = _cfg.get("__proxy__")
                if proxy is None:
                    from core.nexora_proxy import NexoraProxy as _NP
                    proxy = _NP(_cfg)
                    _cfg["__proxy__"] = proxy

                default_model = get_default_nexora_model(_cfg)
                markdown_content = generate_chapter_markdown_with_tools(
                    _cfg,
                    proxy=proxy,
                    model_name=default_model or "",
                    user_id=user_id,
                    lecture_id=lecture_id,
                    chapter_name=chapter_name,
                    system_prompt=CHAPTER_CONTENT_GENERATION_SYSTEM_PROMPT,
                    user_prompt=user_prompt,
                    full_text=chapter_text,
                    request_timeout=300,
                    on_delta=push_delta,
                )
                if not markdown_content:
                    push_event("error", {"success": False, "error": "生成内容为空"})
                    return

                save_chapter_content(_cfg, user_id, lecture_id, chapter_index, markdown_content)

                push_event("done", {
                    "success": True,
                    "chapter_index": chapter_index,
                    "chapter_name": chapter_name,
                    "content": markdown_content,
                })

            except Exception as exc:
                log_event(
                    "personalized_chapter_error",
                    str(exc),
                    payload={"user_id": user_id, "lecture_id": lecture_id, "chapter_index": chapter_index},
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                push_event("close", {})

        thread = threading.Thread(target=run_worker, name="personalized-chapter-gen", daemon=True)
        thread.start()

        yield _reader_guide_sse_event("status", {"message": "chapter content generation started"})

        while True:
            try:
                event_name, event_payload = events.get(timeout=30)
            except queue.Empty:
                yield _reader_guide_sse_event("ping", {"timestamp": time.time()})
                continue

            if event_name == "close":
                break

            yield _reader_guide_sse_event(event_name, event_payload)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@bp.route("/frontend/personalized-learning/generate-chapter-stream", methods=["GET"])
def frontend_personalized_learning_generate_chapter_stream():
    """GET SSE endpoint for chapter content generation (for EventSource)."""
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    chapter_index_str = str(request.args.get("chapter_index") or "").strip()

    if not lecture_id:
        return Response("event: error\ndata: {\"error\": \"lecture_id is required\"}\n\n", mimetype="text/event-stream")

    try:
        chapter_index = int(chapter_index_str)
    except (ValueError, TypeError):
        return Response("event: error\ndata: {\"error\": \"chapter_index must be integer\"}\n\n", mimetype="text/event-stream")

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return Response("event: error\ndata: {\"error\": \"user_id is required\"}\n\n", mimetype="text/event-stream")

    return _personalized_learning_chapter_stream_response(user_id, lecture_id, chapter_index)

    def event_stream():
        events: "queue.Queue[Tuple[str, Dict[str, Any]]]" = queue.Queue()

        def push_event(event_name: str, event_payload: Dict[str, Any]) -> None:
            events.put((event_name, event_payload))

        def push_delta(delta_text: str) -> None:
            text = str(delta_text or "")
            if text:
                append_log_text(text)
                push_event("delta", {"content": text})

        def run_worker() -> None:
            try:
                from core.booksproc.personalized_learning import (
                    generate_chapter_markdown_with_tools,
                    load_learning_path,
                    save_chapter_content,
                )
                from core.lectures import load_book_text

                log_event(
                    "personalized_chapter_stream_start",
                    "个性化章节流启动",
                    payload={"user_id": user_id, "lecture_id": lecture_id, "chapter_index": chapter_index},
                )

                path_data = load_learning_path(_cfg, user_id, lecture_id)
                if not path_data:
                    push_event("error", {"success": False, "error": "学习路线未生成"})
                    return

                chapters = path_data.get("chapters") or []
                if chapter_index < 0 or chapter_index >= len(chapters):
                    push_event("error", {"success": False, "error": "章节索引超出范围"})
                    return

                chapter = chapters[chapter_index]
                chapter_name = str(chapter.get("name") or "").strip()
                book_id = str(chapter.get("book_id") or "").strip()
                book_title = str(chapter.get("book_title") or "").strip()
                chapter_range = str(chapter.get("chapter_range") or "").strip()
                chapter_summary = str(chapter.get("chapter_summary") or "").strip()

                if not book_id:
                    push_event("error", {"success": False, "error": "章节未关联教材"})
                    return
                if not chapter_range:
                    push_event("error", {"success": False, "error": "学习路线缺少章节范围，请重新生成学习路线。"})
                    return

                book_text = load_book_text(_cfg, lecture_id, book_id)
                if not book_text:
                    push_event("error", {"success": False, "error": "教材内容未找到"})
                    return
                chapter_text = _clean_chapter_source_text(_slice_book_text_by_range(book_text, chapter_range))

                user_md = str(user_store.read_memory(_cfg, user_id, "user") or "")

                from core.booksproc.personalized_learning import load_pre_reading_qa
                qa_data = load_pre_reading_qa(_cfg, user_id, lecture_id)

                from prompts import (
                    CHAPTER_CONTENT_GENERATION_SYSTEM_PROMPT,
                    CHAPTER_CONTENT_GENERATION_USER_PROMPT,
                )

                profile_json = json.dumps({"user_profile": user_md[:2000]}, ensure_ascii=False)
                qa_json = json.dumps(qa_data, ensure_ascii=False) if qa_data else "{}"
                advice_text = str(path_data.get("advice") or "").strip()

                user_prompt = CHAPTER_CONTENT_GENERATION_USER_PROMPT.replace(
                    "{{chapter_name}}", chapter_name
                ).replace(
                    "{{book_title}}", book_title
                ).replace(
                    "{{chapter_index}}", str(chapter_index)
                ).replace(
                    "{{chapter_range}}", chapter_range
                ).replace(
                    "{{chapter_summary}}", chapter_summary
                ).replace(
                    "{{book_content}}", chapter_text
                ).replace(
                    "{{profile_json}}", profile_json
                ).replace(
                    "{{qa_json}}", qa_json
                ).replace(
                    "{{learning_path_advice}}", advice_text
                )

                proxy = _cfg.get("__proxy__")
                if proxy is None:
                    from core.nexora_proxy import NexoraProxy as _NP
                    proxy = _NP(_cfg)
                    _cfg["__proxy__"] = proxy

                default_model = get_default_nexora_model(_cfg)
                markdown_content = generate_chapter_markdown_with_tools(
                    _cfg,
                    proxy=proxy,
                    model_name=default_model or "",
                    user_id=user_id,
                    lecture_id=lecture_id,
                    chapter_name=chapter_name,
                    system_prompt=CHAPTER_CONTENT_GENERATION_SYSTEM_PROMPT,
                    user_prompt=user_prompt,
                    full_text=chapter_text,
                    request_timeout=300,
                    on_delta=push_delta,
                )
                if not markdown_content:
                    push_event("error", {"success": False, "error": "生成内容为空"})
                    return

                save_chapter_content(_cfg, user_id, lecture_id, chapter_index, markdown_content)

                push_event("done", {
                    "success": True,
                    "chapter_index": chapter_index,
                    "chapter_name": chapter_name,
                    "content": markdown_content,
                })

            except Exception as exc:
                log_event(
                    "personalized_chapter_error",
                    str(exc),
                    payload={"user_id": user_id, "lecture_id": lecture_id, "chapter_index": chapter_index},
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                push_event("close", {})

        thread = threading.Thread(target=run_worker, name="personalized-chapter-gen-get", daemon=True)
        thread.start()

        yield _reader_guide_sse_event("status", {"message": "chapter content generation started"})

        while True:
            try:
                event_name, event_payload = events.get(timeout=30)
            except queue.Empty:
                yield _reader_guide_sse_event("ping", {"timestamp": time.time()})
                continue

            if event_name == "close":
                break

            yield _reader_guide_sse_event(event_name, event_payload)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@bp.route("/frontend/personalized-learning/load-chapter", methods=["POST"])
def frontend_personalized_learning_load_chapter():
    """加载已生成的章节内容。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    chapter_index = data.get("chapter_index")

    if not lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required."}), 400
    if chapter_index is None:
        return jsonify({"success": False, "error": "chapter_index is required."}), 400

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    from core.booksproc.personalized_learning import load_chapter_content

    content = load_chapter_content(_cfg, user_id, lecture_id, int(chapter_index))
    if content is None:
        return jsonify({"success": True, "cached": False})

    return jsonify({
        "success": True,
        "cached": True,
        "content": content,
    })


@bp.route("/frontend/personalized-learning/chapter-complete", methods=["POST"])
def frontend_personalized_learning_chapter_complete():
    """标记个性化学习路线中的章节学习完成。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    try:
        chapter_index = int(data.get("chapter_index"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "chapter_index is required."}), 400

    if not lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required."}), 400

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    from core.booksproc.personalized_learning import (
        has_chapter_content,
        load_all_chapter_status,
        load_chapter_content,
        load_learning_path,
        mark_chapter_completed,
    )

    path_data = load_learning_path(_cfg, user_id, lecture_id)
    if not path_data:
        return jsonify({"success": False, "error": "学习路线未生成。"}), 404

    chapters = path_data.get("chapters") if isinstance(path_data, dict) else []
    if not isinstance(chapters, list) or chapter_index < 0 or chapter_index >= len(chapters):
        return jsonify({"success": False, "error": "章节索引超出范围。"}), 400

    if not has_chapter_content(_cfg, user_id, lecture_id, chapter_index):
        return jsonify({"success": False, "error": "请先生成并阅读本章学习素材。"}), 400

    chapter = chapters[chapter_index] if isinstance(chapters[chapter_index], dict) else {}
    chapter_name = str(chapter.get("name") or "").strip()
    book_id = str(chapter.get("book_id") or "").strip()
    chapter_range = str(chapter.get("chapter_range") or "").strip()
    outline_section_id = str(chapter.get("outline_section_id") or "").strip()

    if not chapter_name or not book_id:
        return jsonify({"success": False, "error": "学习路线章节缺少教材信息。"}), 400

    existing_records = user_store.list_learning_records(_cfg, user_id)
    already_completed = any(
        isinstance(row, dict)
        and str(row.get("type") or "").strip() == "chapter_completed"
        and str(row.get("lecture_id") or "").strip() == lecture_id
        and str(row.get("book_id") or "").strip() == book_id
        and str(row.get("chapter_name") or "").strip() == chapter_name
        for row in (existing_records or [])
    )

    updated_path = mark_chapter_completed(_cfg, user_id, lecture_id, chapter_index)
    if not updated_path:
        return jsonify({"success": False, "error": "章节完成状态更新失败。"}), 500

    if not already_completed:
        user_store.append_learning_record(
            _cfg,
            user_id,
            {
                "type": "chapter_completed",
                "source": "personalized_learning_path",
                "lecture_id": lecture_id,
                "book_id": book_id,
                "chapter_name": chapter_name,
                "chapter_index": chapter_index,
                "chapter_range": chapter_range,
                "outline_section_id": outline_section_id,
            },
        )

    memory_job = None
    if not already_completed:
        chapter_content = str(load_chapter_content(_cfg, user_id, lecture_id, chapter_index) or "")
        memory_job = enqueue_memory_job(
            _cfg,
            user_id=user_id,
            lecture_id=lecture_id,
            reason="personalized_chapter_complete",
            payload={
                "book_id": book_id,
                "chapter_name": chapter_name,
                "chapter_index": chapter_index,
                "chapter_range": chapter_range,
                "outline_section_id": outline_section_id,
                "chapter_context": chapter_content[:12000],
            },
        )

    chapters_status = load_all_chapter_status(_cfg, user_id, lecture_id)
    log_event(
        "personalized_chapter_complete",
        "个性化学习路线章节已标记完成",
        payload={
            "user_id": user_id,
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_index": chapter_index,
            "chapter_name": chapter_name,
            "already_completed": already_completed,
            "memory_job": dict(memory_job or {}),
        },
    )
    return jsonify({
        "success": True,
        "already_completed": already_completed,
        "chapters": chapters_status,
        "memory_enqueue": memory_job,
    })


@bp.route("/frontend/personalized-learning/chapter-quiz", methods=["POST"])
def frontend_personalized_learning_chapter_quiz():
    """读取或创建基于个性化学习素材的章节练习。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    try:
        chapter_index = int(data.get("chapter_index"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "chapter_index is required."}), 400

    if not lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required."}), 400

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    from core.booksproc.personalized_learning import load_chapter_content, load_learning_path

    path_data = load_learning_path(_cfg, user_id, lecture_id)
    if not path_data:
        return jsonify({"success": False, "error": "学习路线未生成。"}), 404

    chapters = path_data.get("chapters") if isinstance(path_data, dict) else []
    if not isinstance(chapters, list) or chapter_index < 0 or chapter_index >= len(chapters):
        return jsonify({"success": False, "error": "章节索引超出范围。"}), 400

    chapter = chapters[chapter_index] if isinstance(chapters[chapter_index], dict) else {}
    chapter_name = str(chapter.get("name") or "").strip()
    book_id = str(chapter.get("book_id") or "").strip()
    chapter_range = str(chapter.get("chapter_range") or "").strip()
    chapter_content = str(load_chapter_content(_cfg, user_id, lecture_id, chapter_index) or "").strip()

    if not book_id or not chapter_name:
        return jsonify({"success": False, "error": "学习路线章节缺少教材信息。"}), 400
    if not chapter_content:
        return jsonify({"success": False, "error": "请先生成本章学习素材。"}), 400

    try:
        from core.booksproc.chapter_quiz import load_or_create_chapter_quiz
        quiz = load_or_create_chapter_quiz(
            _cfg,
            user_id=user_id,
            lecture_id=lecture_id,
            book_id=book_id,
            chapter_index=chapter_index,
            chapter_name=chapter_name,
            chapter_range=chapter_range,
            chapter_context=chapter_content[:12000],
            chapter_detail_xml="",
        )
        return jsonify({
            "success": True,
            "quiz": quiz,
            "quiz_id": quiz.get("quiz_id"),
            "questions": quiz.get("questions") or [],
            "answers": quiz.get("answers") or {},
        }), 200
    except Exception as exc:
        log_event(
            "personalized_chapter_quiz_error",
            str(exc),
            payload={"user_id": user_id, "lecture_id": lecture_id, "chapter_index": chapter_index},
        )
        return jsonify({"success": False, "error": str(exc)}), 500


@bp.route("/frontend/personalized-learning/save-qa", methods=["POST"])
def frontend_personalized_learning_save_qa():
    """保存阅读前问答。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    if not lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required."}), 400

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    from core.booksproc.personalized_learning import save_pre_reading_qa

    qa_data = {
        "questions": data.get("questions") or [],
        "answers": data.get("answers") or {},
        "skipped": bool(data.get("skipped")),
    }

    path = save_pre_reading_qa(_cfg, user_id, lecture_id, qa_data)
    return jsonify({"success": True, "path": path})


@bp.route("/frontend/personalized-learning/load-qa", methods=["POST"])
def frontend_personalized_learning_load_qa():
    """加载阅读前问答。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    if not lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required."}), 400

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    from core.booksproc.personalized_learning import load_pre_reading_qa

    qa_data = load_pre_reading_qa(_cfg, user_id, lecture_id)
    if not qa_data:
        return jsonify({"success": True, "cached": False})

    return jsonify({"success": True, "cached": True, "data": qa_data})


def _build_personalized_qa_guide_context(
    *,
    lecture_id: str,
    lecture_title: str,
    outline: Any,
) -> Tuple[str, List[Dict[str, Any]], int]:
    """构建个性化学习路线问答上下文，确保问题生成能看到课程和教材内容。"""
    books = list_lecture_books(_cfg, lecture_id) or []
    books_info: List[Dict[str, Any]] = []
    book_text_rows: List[Tuple[str, str, str]] = []

    for book in books:
        if not isinstance(book, dict):
            continue

        book_id = str(book.get("id") or "").strip()
        book_title = str(book.get("title") or "").strip()
        if not book_id:
            continue

        books_info.append({
            "book_id": book_id,
            "title": book_title or book_id,
        })

        book_text = str(load_book_text(_cfg, lecture_id, book_id) or "").strip()
        if book_text:
            book_text_rows.append((book_id, book_title or book_id, book_text))

    if not book_text_rows:
        raise ValueError("课程教材解析内容为空，请先完成教材解析后再生成阅读前问答。")

    outline_text = json.dumps(outline, ensure_ascii=False)[:2600]
    books_info_text = json.dumps(books_info, ensure_ascii=False)[:1400]
    book_context_parts: List[str] = []
    remaining_chars = 5200

    for index, (book_id, book_title, book_text) in enumerate(book_text_rows):
        remaining_books = max(1, len(book_text_rows) - index)
        excerpt_limit = max(900, remaining_chars // remaining_books)
        excerpt = book_text[:excerpt_limit]
        remaining_chars = max(0, remaining_chars - len(excerpt))

        book_context_parts.append(
            f"## 教材内容摘录\nbook_id: {book_id}\nbook_title: {book_title}\n\n{excerpt}"
        )

        if remaining_chars <= 0:
            break

    guide_context = "\n\n".join([
        f"## 课程信息\nlecture_id: {lecture_id}\nlecture_title: {lecture_title or lecture_id}",
        f"## 教材清单\n{books_info_text}",
        f"## 课程大纲\n{outline_text}",
        "\n\n".join(book_context_parts),
    ])

    return guide_context, books_info, len(book_text_rows)


@bp.route("/frontend/personalized-learning/generate-qa-stream", methods=["GET"])
def frontend_personalized_learning_generate_qa_stream():
    """GET SSE endpoint for learning path QA generation (no book_id required)."""
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    if not lecture_id:
        return Response("event: error\ndata: {\"error\": \"lecture_id is required\"}\n\n", mimetype="text/event-stream")

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return Response("event: error\ndata: {\"error\": \"user_id is required\"}\n\n", mimetype="text/event-stream")

    def event_stream():
        events: "queue.Queue[Tuple[str, Dict[str, Any]]]" = queue.Queue()

        def push_event(event_name: str, event_payload: Dict[str, Any]) -> None:
            events.put((event_name, event_payload))

        def push_delta(delta_text: str) -> None:
            text = str(delta_text or "")
            if text:
                append_log_text(text)
                push_event("delta", {"content": text})

        def run_worker() -> None:
            try:
                from core.booksproc.outline import load_outline
                from core.booksproc.guide import generate_pre_reading_questions
                from core.lectures import get_lecture as get_learning_lecture

                log_event(
                    "personalized_qa_stream_start",
                    "个性化学习阅读前问答流启动",
                    payload={"user_id": user_id, "lecture_id": lecture_id, "scope": "course"},
                )

                outline = load_outline(_cfg, lecture_id)
                if not outline:
                    push_event("error", {"success": False, "error": "课程大纲未生成"})
                    return
                push_event("status", {"message": "已读取课程大纲，正在整理教材上下文"})

                lecture = get_learning_lecture(_cfg, lecture_id)
                lecture_title = str(lecture.get("title") or "") if lecture else ""

                outline_text = json.dumps(outline, ensure_ascii=False)
                guide_context, books_info, books_with_content_count = _build_personalized_qa_guide_context(
                    lecture_id=lecture_id,
                    lecture_title=lecture_title,
                    outline=outline,
                )
                push_event("status", {"message": "阅读前问答上下文已装载，正在请求模型"})

                log_event(
                    "personalized_qa_stream_context",
                    "个性化学习阅读前问答上下文已加载",
                    payload={
                        "user_id": user_id,
                        "lecture_id": lecture_id,
                        "lecture_title": lecture_title,
                        "books_count": len(books_info),
                        "books_with_content_count": books_with_content_count,
                        "outline_chars": len(outline_text),
                        "guide_context_chars": len(guide_context),
                        "scope": "course",
                    },
                    content=guide_context[:1800],
                )

                result = generate_pre_reading_questions(
                    _cfg,
                    lecture_id=lecture_id,
                    book_id="",
                    chapter_name=lecture_title or "课程整体内容",
                    session_name="阅读前内容定位",
                    guide_context=guide_context,
                    stream=True,
                    on_delta=push_delta,
                )
                questions = result.get("questions") if isinstance(result, dict) else []
                if not questions:
                    push_event("error", {"success": False, "error": "模型未返回问题"})
                    return

                push_event("done", {"success": True, "questions": questions})

            except Exception as exc:
                log_event(
                    "personalized_qa_stream_error",
                    str(exc),
                    payload={"user_id": user_id, "lecture_id": lecture_id},
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                push_event("close", {})

        thread = threading.Thread(target=run_worker, name="personalized-qa-stream", daemon=True)
        thread.start()

        yield _reader_guide_sse_event("status", {"message": "personalized QA stream started"})

        while True:
            try:
                event_name, event_payload = events.get(timeout=30)
            except queue.Empty:
                yield _reader_guide_sse_event("ping", {"timestamp": time.time()})
                continue

            if event_name == "close":
                break

            yield _reader_guide_sse_event(event_name, event_payload)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )



# ==================== 思维导图（Knowledge Graph）====================

@bp.route("/frontend/mindmap/<lecture_id>", methods=["GET"])
def frontend_get_mindmap(lecture_id: str):
    """读取已生成的课程级思维导图。"""
    from core.booksproc.mindmap import load_mindmap

    mindmap = load_mindmap(_cfg, lecture_id)
    if mindmap is None:
        return jsonify({"success": False, "error": "思维导图尚未生成"}), 404
    return jsonify({"success": True, "mindmap": mindmap})


@bp.route("/frontend/mindmap/<lecture_id>/generate-stream", methods=["GET"])
def frontend_generate_mindmap_stream(lecture_id: str):
    """流式生成课程级思维导图，向课程主页推送模型活动。"""
    safe_lecture_id = str(lecture_id or "").strip()
    runtime_user_id = _resolve_runtime_user_id() or "manual"
    if not safe_lecture_id:
        return Response('event: error\ndata: {"error": "lecture_id is required"}\n\n', mimetype="text/event-stream")

    def event_stream():
        events: "queue.Queue[Tuple[str, Dict[str, Any]]]" = queue.Queue()

        def push_event(event_name: str, event_payload: Dict[str, Any]) -> None:
            events.put((event_name, event_payload))

        def push_status(message: str) -> None:
            text = str(message or "").strip()
            if text:
                push_event("status", {"message": text})

        def push_delta(delta_text: str) -> None:
            text = str(delta_text or "")
            if text:
                append_log_text(text)
                push_event("delta", {"content": text})

        def to_sse(event_name: str, event_payload: Dict[str, Any]) -> str:
            return f"event: {event_name}\ndata: {json.dumps(event_payload, ensure_ascii=False)}\n\n"

        def run_worker() -> None:
            try:
                from core.booksproc.mindmap import generate_mindmap

                result = generate_mindmap(
                    _cfg,
                    safe_lecture_id,
                    user_id=runtime_user_id,
                    on_status=push_status,
                    on_delta=push_delta,
                    stream=True,
                )
                push_event("done", {"success": True, "mindmap": result})
            except Exception as exc:
                log_event(
                    "mindmap_stream_error",
                    str(exc),
                    payload={"lecture_id": safe_lecture_id},
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                push_event("close", {})

        thread = threading.Thread(target=run_worker, name="mindmap-generate-stream", daemon=True)
        thread.start()

        yield to_sse("status", {"message": "思维导图流式生成已启动"})

        while True:
            try:
                event_name, event_payload = events.get(timeout=20)
            except queue.Empty:
                yield to_sse("ping", {"timestamp": time.time()})
                continue

            if event_name == "close":
                break

            yield to_sse(event_name, event_payload)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@bp.route("/frontend/mindmap/<lecture_id>/section", methods=["POST"])
def frontend_generate_section_mindmap(lecture_id: str):
    """同步生成指定 section 的详细思维导图子树（不持久化）。"""
    safe_lecture_id = str(lecture_id or "").strip()
    if not safe_lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required"}), 400

    body = request.get_json(silent=True) or {}
    section_id = str(body.get("section_id") or "").strip()
    if not section_id:
        return jsonify({"success": False, "error": "section_id is required"}), 400

    try:
        from core.booksproc.mindmap import generate_section_mindmap

        result = generate_section_mindmap(
            _cfg,
            safe_lecture_id,
            section_id,
            stream=False,
        )
        return jsonify({"success": True, "mindmap": result})
    except Exception as exc:
        log_event(
            "section_mindmap_error",
            str(exc),
            payload={"lecture_id": safe_lecture_id, "section_id": section_id},
        )
        return jsonify({"success": False, "error": str(exc)}), 500
