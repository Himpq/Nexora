"""HTTP routes for NexoraLearning."""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib import error as urllib_error
from urllib import request as urllib_request

from flask import Blueprint, jsonify, request, send_from_directory
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
    load_book_text,
    load_book_info_xml,
    load_book_detail_xml,
    save_book_text,
    save_book_info_xml,
    save_book_detail_xml,
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
from core import user as user_store
from core.booksproc import (
    cancel_book_refinement,
    enqueue_book_refinement,
    get_refinement_queue_snapshot,
    get_rough_reading_settings,
    init_booksproc,
    list_refinement_candidates,
    mark_book_uploaded,
    update_rough_reading_settings,
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


def init_routes(cfg: Dict[str, Any]) -> None:
    global _cfg, _proxy
    _cfg = cfg
    _proxy = NexoraProxy(cfg)
    init_booksproc(cfg)


def _allowed(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXT


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _extract_nexora_options(data: Dict[str, Any]) -> Dict[str, Any]:
    options: Dict[str, Any] = {}
    for key in _NEXORA_OPTION_FIELDS:
        value = data.get(key)
        if value is not None:
            options[key] = value
    return options


def _fetch_session_user_from_nexora() -> Dict[str, Any]:
    if _proxy is None:
        return {"success": False, "message": "proxy not ready"}

    base_url = str(getattr(_proxy, "base_url", "") or "").strip().rstrip("/")
    cookie_header = str(request.headers.get("Cookie") or "").strip()
    if not base_url or not cookie_header:
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
                return {"success": False, "message": "invalid payload type"}
            if payload.get("success") is False:
                return {
                    "success": False,
                    "message": str(payload.get("message") or "session user lookup failed"),
                }
            user = payload.get("user")
            if isinstance(user, dict):
                return {"success": True, "user": user}
            return {"success": False, "message": "missing user in payload"}
    except urllib_error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8", errors="replace")
            payload = json.loads(body) if body.strip() else {}
            if isinstance(payload, dict):
                return {"success": False, "message": str(payload.get("message") or f"HTTP {exc.code}")}
        except Exception:
            pass
        return {"success": False, "message": f"HTTP {getattr(exc, 'code', 502)}"}
    except Exception as exc:
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
        "has_public_api_key": False,
    }
    if _proxy is not None:
        integration["base_url"] = str(getattr(_proxy, "base_url", "") or "")
        integration["endpoint"] = str(getattr(_proxy, "models_path", "") or "")
        integration["has_public_api_key"] = bool(str(getattr(_proxy, "api_key", "") or "").strip())
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

    return jsonify(
        {
            "success": True,
            "username": username,
            "user": user_payload,
            "is_admin": bool(is_admin),
            "integration": integration,
        }
    )


@bp.route("/frontend/materials", methods=["GET"])
def frontend_materials():
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
    return jsonify(
        {
            "success": True,
            "lectures": rows,
            "total_lectures": len(rows),
            "total_books": total_books,
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
    for job in queue_snapshot.get("jobs", []) if isinstance(queue_snapshot.get("jobs"), list) else []:
        if not isinstance(job, dict):
            continue
        lecture_id = str(job.get("lecture_id") or "").strip()
        book_id = str(job.get("book_id") or "").strip()
        job_status = str(job.get("status") or "").strip().lower()
        if lecture_id and book_id:
            running_by_book[f"{lecture_id}::{book_id}"] = job_status
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
        if not status and coarse_status in {"done", "completed"} and refine_status in {"done", "extracted"}:
            continue
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
                "coarse_model": str(book.get("coarse_model") or ""),
                "coarse_error": str(book.get("coarse_error") or ""),
                "refinement_error": str(book.get("refinement_error") or ""),
                "job_status": running_by_book.get(key, ""),
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
    listed = _list_nexora_models_payload(_resolve_runtime_user_id())
    available_ids = {row.get("id", "") for row in _extract_model_options(listed.get("payload") if isinstance(listed.get("payload"), dict) else {})}
    updated_default = get_default_nexora_model(_cfg)
    updated_rough = get_rough_reading_settings(_cfg)
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
    return jsonify(
        {
            "success": True,
            "settings": {
                "default_nexora_model": updated_default,
                "rough_reading": updated_rough,
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
    return jsonify({
        "success": True,
        "book": book,
        "content": content,
        "chars": len(content),
    })


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
            },
        )
        return jsonify(
            {
                "success": True,
                "lecture_id": lecture_id,
                "book_id": book_id,
                "chars": len(str(parsed_text)),
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
