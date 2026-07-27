import json
import os
import re
import time
import uuid
from datetime import datetime
from typing import Any, Dict, Iterator, Optional

from datastorage import safe_append_jsonl


BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(BASE_DIR, "data")
PAPI_LOG_ROOT = os.path.join(DATA_DIR, "papi")
TOKEN_LOG_FILENAME = "token_log.jsonl"
IMAGE_LOG_FILENAME = "image_log.jsonl"


def _utc_iso_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _safe_int(value: Any) -> int:
    try:
        return max(0, int(float(value or 0)))
    except Exception:
        return 0


def _clean_slug(value: Any) -> str:
    text = str(value or "").strip().replace("-", "_")
    text = re.sub(r"[^A-Za-z0-9_.]+", "_", text)
    text = re.sub(r"_+", "_", text).strip("._")
    return text[:120]


def _request_header(request_obj: Any, name: str) -> str:
    headers = getattr(request_obj, "headers", None)
    if headers is None:
        return ""
    try:
        return str(headers.get(name) or "").strip()
    except Exception:
        return ""


def _request_remote_addr(request_obj: Any) -> str:
    direct = str(getattr(request_obj, "remote_addr", "") or "").strip()
    forwarded = _request_header(request_obj, "X-Forwarded-For")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return direct


def normalize_papi_usage(raw_usage: Any) -> Dict[str, int]:
    usage = raw_usage if isinstance(raw_usage, dict) else {}
    input_tokens = _safe_int(
        usage.get("input_tokens", usage.get("prompt_tokens", 0))
    )
    output_tokens = _safe_int(
        usage.get("output_tokens", usage.get("completion_tokens", 0))
    )
    total_raw = usage.get("total_tokens")
    total_tokens = _safe_int(total_raw) if total_raw is not None else input_tokens + output_tokens
    if total_tokens <= 0 and (input_tokens > 0 or output_tokens > 0):
        total_tokens = input_tokens + output_tokens

    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
    }


def extract_usage_from_payload(payload: Any) -> Dict[str, int]:
    data = payload if isinstance(payload, dict) else {}
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    return normalize_papi_usage(usage)


def infer_papi_action(request_path: Any) -> str:
    path = str(request_path or "").strip().lower()
    if "/learning/chat" in path:
        return "papi_learning_chat"
    if "/responses" in path:
        return "papi_responses"
    if "/chat/completions" in path:
        return "papi_chat_completions"
    if "/completions" in path:
        return "papi_completions"
    return "papi_model_inference"


def build_papi_log_context(
    request_obj: Any,
    *,
    username: str = "",
    request_path: str = "",
) -> Dict[str, Any]:
    environ = getattr(request_obj, "environ", {}) if request_obj is not None else {}
    auth = environ.get("papi.auth") if isinstance(environ, dict) else {}
    auth = auth if isinstance(auth, dict) else {}
    key_state = auth.get("key") if isinstance(auth.get("key"), dict) else {}
    key_id = str(key_state.get("id") or "").strip()
    key_slug = _clean_slug(key_id)
    api_key_created_by = str(key_state.get("created_by") or "").strip()
    api_key_scope = str(key_state.get("scope") or "").strip().lower()
    api_key_owner = str(key_state.get("owner") or "").strip()

    if api_key_scope == "owner":
        if not api_key_owner:
            raise ValueError("Owner-scoped PAPI key has no owner")

        resolved_username = api_key_owner
    elif api_key_scope == "global":
        resolved_username = str(username or "").strip() or api_key_created_by
    else:
        raise ValueError("PAPI key scope is missing or invalid")

    return {
        "log_id": f"papi_log_{uuid.uuid4().hex}",
        "request_started_at": time.time(),
        "request_path": str(request_path or getattr(request_obj, "path", "") or "").strip(),
        "method": str(getattr(request_obj, "method", "") or "").strip().upper(),
        "username": resolved_username,
        "api_key_id": key_id,
        "api_key_slug": key_slug,
        "api_key_name": str(key_state.get("name") or "").strip(),
        "api_key_preview": str(key_state.get("key_preview") or "").strip(),
        "api_key_created_by": api_key_created_by,
        "api_key_scope": api_key_scope,
        "api_key_owner": api_key_owner,
        "required_permission": str(auth.get("required_permission") or "").strip(),
        "remote_addr": _request_remote_addr(request_obj),
        "user_agent": _request_header(request_obj, "User-Agent")[:240],
    }


def build_papi_token_log_context(
    request_obj: Any,
    *,
    username: str = "",
    request_path: str = "",
) -> Dict[str, Any]:
    return build_papi_log_context(
        request_obj,
        username=username,
        request_path=request_path,
    )


def build_image_generation_log_context(
    *,
    username: str = "",
    conversation_id: str = "",
    request_path: str = "chat.generate_image",
    method: str = "TOOL",
    log_group: str = "chat_internal",
    source: str = "chat",
    action: str = "chat_image_generation",
    remote_addr: str = "",
    user_agent: str = "",
) -> Dict[str, Any]:
    log_group_id = str(log_group or "chat_internal").strip() or "chat_internal"

    return {
        "log_id": f"image_log_{uuid.uuid4().hex}",
        "request_started_at": time.time(),
        "request_path": str(request_path or "").strip(),
        "method": str(method or "TOOL").strip().upper(),
        "username": str(username or "").strip(),
        "conversation_id": str(conversation_id or "").strip(),
        "api_key_id": log_group_id,
        "api_key_slug": _clean_slug(log_group_id),
        "api_key_name": "Chat Internal Image Generation",
        "api_key_preview": "",
        "required_permission": "chat_generate_image",
        "remote_addr": str(remote_addr or "").strip(),
        "user_agent": str(user_agent or "").strip()[:240],
        "source": str(source or "chat").strip() or "chat",
        "action": str(action or "chat_image_generation").strip() or "chat_image_generation",
    }


def token_log_path_for_context(context: Dict[str, Any]) -> str:
    ctx = context if isinstance(context, dict) else {}
    key_slug = str(ctx.get("api_key_slug") or "").strip()
    if not key_slug:
        raise ValueError("PAPI token log requires api_key_id in request auth context")
    return os.path.join(PAPI_LOG_ROOT, key_slug, TOKEN_LOG_FILENAME)


def image_log_path_for_context(context: Dict[str, Any]) -> str:
    ctx = context if isinstance(context, dict) else {}
    key_slug = str(ctx.get("api_key_slug") or "").strip()
    if not key_slug:
        raise ValueError("PAPI image log requires api_key_id in request auth context")
    return os.path.join(PAPI_LOG_ROOT, key_slug, IMAGE_LOG_FILENAME)


def record_papi_token_usage(
    context: Dict[str, Any],
    *,
    usage: Any,
    provider: str,
    model: str,
    action: str,
    request_path: str,
    stream: bool,
    status: str = "success",
    response_id: str = "",
    duration_ms: Optional[int] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    ctx = context if isinstance(context, dict) else {}
    normalized_usage = normalize_papi_usage(usage)
    if (
        normalized_usage["input_tokens"] <= 0
        and normalized_usage["output_tokens"] <= 0
        and normalized_usage["total_tokens"] <= 0
    ):
        return {"success": False, "message": "PAPI usage is empty; token log was not written"}

    started_at = ctx.get("request_started_at")
    if duration_ms is None:
        try:
            duration_ms = int(max(0, (time.time() - float(started_at)) * 1000))
        except Exception:
            duration_ms = 0

    log_path = token_log_path_for_context(ctx)
    now_ts = time.time()
    payload = {
        "id": str(ctx.get("log_id") or f"papi_log_{uuid.uuid4().hex}"),
        "timestamp": _utc_iso_now(),
        "timestamp_ms": int(now_ts * 1000),
        "source": "papi",
        "status": str(status or "success").strip() or "success",
        "api_key_id": str(ctx.get("api_key_id") or "").strip(),
        "api_key_name": str(ctx.get("api_key_name") or "").strip(),
        "api_key_preview": str(ctx.get("api_key_preview") or "").strip(),
        "api_key_created_by": str(ctx.get("api_key_created_by") or "").strip(),
        "api_key_scope": str(ctx.get("api_key_scope") or "").strip(),
        "api_key_owner": str(ctx.get("api_key_owner") or "").strip(),
        "username": str(ctx.get("username") or "").strip(),
        "request_path": str(request_path or ctx.get("request_path") or "").strip(),
        "method": str(ctx.get("method") or "").strip(),
        "action": str(action or infer_papi_action(request_path)).strip(),
        "provider": str(provider or "unknown").strip() or "unknown",
        "model": str(model or "unknown").strip() or "unknown",
        "stream": bool(stream),
        "response_id": str(response_id or "").strip(),
        "input_tokens": normalized_usage["input_tokens"],
        "output_tokens": normalized_usage["output_tokens"],
        "total_tokens": normalized_usage["total_tokens"],
        "duration_ms": _safe_int(duration_ms),
        "remote_addr": str(ctx.get("remote_addr") or "").strip(),
        "user_agent": str(ctx.get("user_agent") or "").strip(),
        "required_permission": str(ctx.get("required_permission") or "").strip(),
    }
    if isinstance(extra, dict) and extra:
        payload["extra"] = extra

    safe_append_jsonl(log_path, payload)
    return {
        "success": True,
        "path": log_path,
        "tokens": normalized_usage,
    }


def _normalize_image_output_rows(rows: Any) -> list:
    normalized = []
    image_rows = rows if isinstance(rows, list) else []

    for index, item in enumerate(image_rows):
        if not isinstance(item, dict):
            continue

        b64_json = str(item.get("b64_json") or "").strip()
        image_url = str(item.get("url") or item.get("asset_url") or "").strip()
        revised_prompt = str(item.get("revised_prompt") or "").strip()
        row = {
            "index": index,
            "has_b64_json": bool(b64_json),
            "b64_json_length": len(b64_json),
            "has_url": bool(image_url),
            "url": image_url,
            "revised_prompt": revised_prompt,
        }
        normalized.append(row)

    return normalized


def record_papi_image_generation(
    context: Dict[str, Any],
    *,
    prompt: str,
    provider: str,
    model: str,
    size: str,
    quality: str,
    response_format: str,
    requested_count: int,
    images: Any,
    request_path: str,
    status: str = "success",
    duration_ms: Optional[int] = None,
    error: str = "",
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Record one PAPI image generation request without storing image binary payloads."""
    ctx = context if isinstance(context, dict) else {}
    started_at = ctx.get("request_started_at")

    if duration_ms is None:
        try:
            duration_ms = int(max(0, (time.time() - float(started_at)) * 1000))
        except Exception:
            duration_ms = 0

    image_outputs = _normalize_image_output_rows(images)
    log_path = image_log_path_for_context(ctx)
    now_ts = time.time()
    payload = {
        "id": str(ctx.get("log_id") or f"papi_log_{uuid.uuid4().hex}"),
        "timestamp": _utc_iso_now(),
        "timestamp_ms": int(now_ts * 1000),
        "source": str(ctx.get("source") or "papi").strip() or "papi",
        "status": str(status or "success").strip() or "success",
        "api_key_id": str(ctx.get("api_key_id") or "").strip(),
        "api_key_name": str(ctx.get("api_key_name") or "").strip(),
        "api_key_preview": str(ctx.get("api_key_preview") or "").strip(),
        "api_key_scope": str(ctx.get("api_key_scope") or "").strip(),
        "api_key_owner": str(ctx.get("api_key_owner") or "").strip(),
        "username": str(ctx.get("username") or "").strip(),
        "request_path": str(request_path or ctx.get("request_path") or "").strip(),
        "method": str(ctx.get("method") or "").strip(),
        "action": str(ctx.get("action") or "papi_image_generation").strip() or "papi_image_generation",
        "provider": str(provider or "unknown").strip() or "unknown",
        "model": str(model or "unknown").strip() or "unknown",
        "size": str(size or "").strip(),
        "quality": str(quality or "").strip(),
        "response_format": str(response_format or "").strip(),
        "requested_count": _safe_int(requested_count),
        "image_count": len(image_outputs),
        "prompt": str(prompt or "").strip(),
        "prompt_length": len(str(prompt or "")),
        "images": image_outputs,
        "duration_ms": _safe_int(duration_ms),
        "remote_addr": str(ctx.get("remote_addr") or "").strip(),
        "user_agent": str(ctx.get("user_agent") or "").strip(),
        "required_permission": str(ctx.get("required_permission") or "").strip(),
    }

    conversation_id = str(ctx.get("conversation_id") or "").strip()
    if conversation_id:
        payload["conversation_id"] = conversation_id

    if error:
        payload["error"] = str(error or "").strip()

    if isinstance(extra, dict) and extra:
        payload["extra"] = extra

    safe_append_jsonl(log_path, payload)
    return {
        "success": True,
        "path": log_path,
        "image_count": len(image_outputs),
    }


def _iter_papi_log_entries(filename: str) -> Iterator[Dict[str, Any]]:
    if not os.path.isdir(PAPI_LOG_ROOT):
        return

    for key_slug in sorted(os.listdir(PAPI_LOG_ROOT)):
        key_dir = os.path.join(PAPI_LOG_ROOT, key_slug)
        if not os.path.isdir(key_dir):
            continue

        log_path = os.path.join(key_dir, filename)
        if not os.path.exists(log_path):
            continue

        try:
            with open(log_path, "r", encoding="utf-8-sig") as f:
                for line in f:
                    text = str(line or "").strip()
                    if not text:
                        continue
                    try:
                        row = json.loads(text)
                    except Exception:
                        continue
                    if isinstance(row, dict):
                        item = dict(row)
                        item["_papi_key_slug"] = key_slug
                        item["_papi_log_path"] = log_path
                        yield item
        except Exception:
            continue


def iter_papi_token_log_entries() -> Iterator[Dict[str, Any]]:
    yield from _iter_papi_log_entries(TOKEN_LOG_FILENAME)


def iter_papi_image_log_entries() -> Iterator[Dict[str, Any]]:
    yield from _iter_papi_log_entries(IMAGE_LOG_FILENAME)
