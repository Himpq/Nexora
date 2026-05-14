"""HTTP runtime adapter for NexoraLearning.

ChatDBServer must not import NexoraLearning internals directly.
This module talks to NexoraLearning over its runtime API.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request


ROOT_DIR = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT_DIR / "data" / "config.json"


def _load_config() -> Dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {}
    try:
        payload = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return dict(payload) if isinstance(payload, dict) else {}


def _learning_cfg() -> Dict[str, Any]:
    cfg = _load_config()
    branch = cfg.get("nexora_learning") if isinstance(cfg.get("nexora_learning"), dict) else {}
    merged = dict(branch or {})
    frontend_url = _normalize_learning_base_url(
        merged.get("frontend_url"),
        fallback_cfg=cfg,
        legacy_branch=merged,
    )
    merged = {
        "host": str(merged.get("host") or "").strip(),
        "port": int(merged.get("port") or 5001),
        "frontend_url": frontend_url,
        "api_key": str(merged.get("api_key") or "").strip(),
        "request_timeout": float(merged.get("request_timeout") or 30),
    }
    return merged


def _is_local_host(hostname: str) -> bool:
    host = str(hostname or "").strip().lower()
    return host in {"127.0.0.1", "localhost", "0.0.0.0", "::1", "[::1]"}


def _public_base_url() -> str:
    cfg = _load_config()
    if not isinstance(cfg, dict):
        return ""
    api_cfg = cfg.get("api") if isinstance(cfg.get("api"), dict) else {}
    for raw in (
        cfg.get("public_base_url"),
        api_cfg.get("public_base_url"),
    ):
        value = str(raw or "").strip()
        if value:
            return value.rstrip("/")
    return ""


def _normalize_learning_base_url(
    value: Any,
    *,
    fallback_cfg: Optional[Mapping[str, Any]] = None,
    legacy_branch: Optional[Mapping[str, Any]] = None,
) -> str:
    text = str(value or "").strip().rstrip("/")
    if text.endswith("/api/frontend"):
        text = text[:-len("/api/frontend")]
    elif text.endswith("/api/runtime"):
        text = text[:-len("/api/runtime")]
    text = text.rstrip("/")
    if text:
        return text

    branch = dict(legacy_branch or {})
    legacy_service_url = str(branch.get("service_url") or "").strip().rstrip("/")
    if legacy_service_url:
        if legacy_service_url.endswith("/api/frontend"):
            legacy_service_url = legacy_service_url[:-len("/api/frontend")]
        elif legacy_service_url.endswith("/api/runtime"):
            legacy_service_url = legacy_service_url[:-len("/api/runtime")]
        legacy_service_url = legacy_service_url.rstrip("/")
        if legacy_service_url:
            return legacy_service_url

    host = str(branch.get("host") or "").strip()
    if host:
        cfg = dict(fallback_cfg or _load_config())
        public_base = str(cfg.get("public_base_url") or "").strip()
        scheme = "https"
        if public_base.lower().startswith("http://"):
            scheme = "http"
        try:
            port = int(branch.get("port") or 5001)
        except Exception:
            port = 5001
        default_port = 443 if scheme == "https" else 80
        host_part = host
        if port != default_port:
            host_part = f"{host_part}:{port}"
        return f"{scheme}://{host_part}"

    return ""


def _derive_frontend_url(cfg: Optional[Mapping[str, Any]] = None) -> str:
    branch = dict(cfg or _learning_cfg())
    base = _normalize_learning_base_url(branch.get("frontend_url"))
    if base:
        return f"{base}/api/frontend"
    return "http://127.0.0.1:5001/api/frontend"


def _normalize_frontend_url(frontend_url: str, cfg: Optional[Mapping[str, Any]] = None) -> str:
    return _derive_frontend_url(cfg)


def _fallback_runtime_config() -> Dict[str, Any]:
    cfg = _learning_cfg()
    return {
        "enabled": True,
        "base_path": "/api/runtime",
        "frontend_url": _derive_frontend_url(cfg),
        "request_timeout": int(float(cfg.get("request_timeout") or 30)),
    }


def _runtime_headers() -> Dict[str, str]:
    cfg = _learning_cfg()
    api_key = str(cfg.get("api_key") or "").strip()
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if api_key:
        headers["X-API-Key"] = api_key
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _runtime_base_url(cfg: Optional[Mapping[str, Any]] = None) -> str:
    branch = dict(cfg or _learning_cfg())
    host = str(branch.get("host") or "").strip()
    try:
        port = int(branch.get("port") or 5001)
    except Exception:
        port = 5001
    if host:
        return f"http://{host}:{port}"
    base = _normalize_learning_base_url(branch.get("frontend_url"))
    if base:
        return base
    return "http://127.0.0.1:5001"


def _runtime_url(path: str) -> str:
    base = _runtime_base_url(_learning_cfg())
    root = "/api/runtime"
    suffix = "/" + str(path or "").lstrip("/")
    return base + root + suffix


def _post_json(path: str, payload: Mapping[str, Any]) -> Dict[str, Any]:
    body = json.dumps(dict(payload or {}), ensure_ascii=False).encode("utf-8")
    req = urllib_request.Request(
        _runtime_url(path),
        data=body,
        headers=_runtime_headers(),
        method="POST",
    )
    timeout = float(_learning_cfg().get("request_timeout") or 30)
    try:
        with urllib_request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib_error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            payload_obj = json.loads(raw) if raw.strip() else {}
        except Exception:
            payload_obj = {}
        message = str(payload_obj.get("error") or payload_obj.get("message") or f"HTTP {exc.code}")
        raise RuntimeError(message) from exc
    except Exception as exc:
        raise RuntimeError(str(exc)) from exc
    try:
        payload_obj = json.loads(raw) if raw.strip() else {}
    except Exception as exc:
        raise RuntimeError(f"Invalid NexoraLearning runtime response: {exc}") from exc
    if not isinstance(payload_obj, dict):
        raise RuntimeError("Invalid NexoraLearning runtime response type.")
    if payload_obj.get("success") is False:
        raise RuntimeError(str(payload_obj.get("error") or payload_obj.get("message") or "NexoraLearning runtime request failed."))
    return payload_obj


def _get_json(path: str) -> Dict[str, Any]:
    req = urllib_request.Request(_runtime_url(path), headers=_runtime_headers(), method="GET")
    timeout = float(_learning_cfg().get("request_timeout") or 30)
    try:
        with urllib_request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib_error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            payload_obj = json.loads(raw) if raw.strip() else {}
        except Exception:
            payload_obj = {}
        message = str(payload_obj.get("error") or payload_obj.get("message") or f"HTTP {exc.code}")
        raise RuntimeError(message) from exc
    except Exception as exc:
        raise RuntimeError(str(exc)) from exc
    try:
        payload_obj = json.loads(raw) if raw.strip() else {}
    except Exception as exc:
        raise RuntimeError(f"Invalid NexoraLearning runtime response: {exc}") from exc
    if not isinstance(payload_obj, dict):
        raise RuntimeError("Invalid NexoraLearning runtime response type.")
    if payload_obj.get("success") is False:
        raise RuntimeError(str(payload_obj.get("error") or payload_obj.get("message") or "NexoraLearning runtime request failed."))
    return payload_obj


def get_learning_tools() -> List[Dict[str, Any]]:
    payload = _get_json("/tools")
    tools = payload.get("tools")
    return list(tools) if isinstance(tools, list) else []


class LearningRuntimeExecutor:
    def __init__(self, cfg: Optional[Mapping[str, Any]] = None):
        self.cfg = dict(cfg or {})

    def execute(self, function_name: str, arguments: Optional[Mapping[str, Any]] = None) -> str:
        username = str(self.cfg.get("_runtime_user_id") or "").strip()
        if not username:
            raise ValueError("runtime user id missing")
        payload = _post_json(
            "/tool/execute",
            {
                "username": username,
                "tool_name": str(function_name or "").strip(),
                "arguments": dict(arguments or {}),
            },
        )
        return json.dumps(payload.get("result") or {}, ensure_ascii=False)


def build_learning_context_payload(
    username: str,
    payload: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    response = _post_json(
        "/context",
        {
            "username": str(username or "").strip(),
            "payload": dict(payload or {}),
        },
    )
    result = response.get("payload")
    return dict(result) if isinstance(result, dict) else {}


def build_learning_memory_blocks(
    username: str,
    lecture_id: str,
    *,
    cfg: Optional[Mapping[str, Any]] = None,
) -> List[Dict[str, str]]:
    response = _post_json(
        "/memory-blocks",
        {
            "username": str(username or "").strip(),
            "lecture_id": str(lecture_id or "").strip(),
        },
    )
    blocks = response.get("blocks")
    return list(blocks) if isinstance(blocks, list) else []


def trigger_learning_memory_analysis(
    username: str,
    lecture_id: str,
    *,
    reason: str,
    payload: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    response = _post_json(
        "/memory/trigger",
        {
            "username": str(username or "").strip(),
            "lecture_id": str(lecture_id or "").strip(),
            "reason": str(reason or "").strip() or "manual",
            "payload": dict(payload or {}),
        },
    )
    result = response.get("result")
    return dict(result) if isinstance(result, dict) else {}


def mark_learning_context_compression(
    username: str,
    lecture_id: str,
    *,
    job_id: str = "",
) -> Dict[str, Any]:
    response = _post_json(
        "/memory/context-compression",
        {
            "username": str(username or "").strip(),
            "lecture_id": str(lecture_id or "").strip(),
            "job_id": str(job_id or "").strip(),
        },
    )
    result = response.get("result")
    return dict(result) if isinstance(result, dict) else {}


def increment_learning_turn_and_maybe_enqueue(
    username: str,
    lecture_id: str,
    *,
    payload: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    response = _post_json(
        "/memory/turn",
        {
            "username": str(username or "").strip(),
            "lecture_id": str(lecture_id or "").strip(),
            "payload": dict(payload or {}),
        },
    )
    return {
        "state": dict(response.get("state") or {}) if isinstance(response.get("state"), dict) else {},
        "enqueue": dict(response.get("enqueue") or {}) if isinstance(response.get("enqueue"), dict) else {},
    }


def get_learning_runtime_config() -> Dict[str, Any]:
    fallback = _fallback_runtime_config()
    try:
        response = _get_json("/config")
    except Exception:
        return fallback
    result = response.get("runtime_api")
    if not isinstance(result, dict):
        return fallback
    merged = dict(fallback)
    merged.update(dict(result))
    merged["frontend_url"] = _derive_frontend_url(_learning_cfg())
    return merged
