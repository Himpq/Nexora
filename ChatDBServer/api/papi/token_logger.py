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


def build_papi_token_log_context(
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

    return {
        "log_id": f"papi_log_{uuid.uuid4().hex}",
        "request_started_at": time.time(),
        "request_path": str(request_path or getattr(request_obj, "path", "") or "").strip(),
        "method": str(getattr(request_obj, "method", "") or "").strip().upper(),
        "username": str(username or "").strip(),
        "api_key_id": key_id,
        "api_key_slug": key_slug,
        "api_key_name": str(key_state.get("name") or "").strip(),
        "api_key_preview": str(key_state.get("key_preview") or "").strip(),
        "required_permission": str(auth.get("required_permission") or "").strip(),
        "remote_addr": _request_remote_addr(request_obj),
        "user_agent": _request_header(request_obj, "User-Agent")[:240],
    }


def token_log_path_for_context(context: Dict[str, Any]) -> str:
    ctx = context if isinstance(context, dict) else {}
    key_slug = str(ctx.get("api_key_slug") or "").strip()
    if not key_slug:
        raise ValueError("PAPI token log requires api_key_id in request auth context")
    return os.path.join(PAPI_LOG_ROOT, key_slug, TOKEN_LOG_FILENAME)


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


def iter_papi_token_log_entries() -> Iterator[Dict[str, Any]]:
    if not os.path.isdir(PAPI_LOG_ROOT):
        return

    for key_slug in sorted(os.listdir(PAPI_LOG_ROOT)):
        key_dir = os.path.join(PAPI_LOG_ROOT, key_slug)
        if not os.path.isdir(key_dir):
            continue

        log_path = os.path.join(key_dir, TOKEN_LOG_FILENAME)
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
