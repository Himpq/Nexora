"""Session-authenticated gateway to NexoraLearning's Agent API.

The mobile client supplies only its main-site session. Runtime credentials and
the effective learning user are selected here, never from client input.
"""

from __future__ import annotations

import json
import os
import re
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

from flask import Blueprint, jsonify, request, session

from basis.Permission.session_auth import require_login
from .Learning import _learning_cfg, _runtime_base_url


learning_agent_bp = Blueprint("learning_agent", __name__)

_GET_PATHS = {
    "context", "today", "events", "flow/state", "memories",
    "cognition/overview", "judgment/context",
}
_POST_PATHS = {
    "plan", "open-session", "ask-in-context", "review-plan", "review/submit",
    "events", "decision", "decision/respond", "flow/accept", "flow/event",
    "flow/submit", "flow/uncertain", "memories/update", "memories/forget",
    "cognition/verdict", "context/device", "prereq/check",
}
_IDENTITY_KEYS = {"username", "user_id"}
_MAX_REQUEST_BYTES = 256 * 1024
_MAX_RESPONSE_BYTES = 8 * 1024 * 1024


class _NoRedirect(urllib_request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # A redirect must never send the service key or user identity elsewhere.
        return None


def _failure(code: str, message: str, status: int):
    return jsonify({"success": False, "error": code, "message": message}), status


def _strip_identity(value):
    if isinstance(value, dict):
        return {
            key: _strip_identity(item)
            for key, item in value.items()
            if str(key).lower() not in _IDENTITY_KEYS
        }
    if isinstance(value, list):
        return [_strip_identity(item) for item in value]
    return value


@learning_agent_bp.route("/api/learning/agent/<path:agent_path>", methods=["GET", "POST"])
@require_login
def proxy_learning_agent(agent_path: str):
    allowed = agent_path in (_GET_PATHS if request.method == "GET" else _POST_PATHS)
    if request.method == "GET" and re.fullmatch(r"tasks/[A-Za-z0-9_-]{1,128}", agent_path):
        allowed = True
    if not allowed:
        return _failure("AGENT_ROUTE_NOT_ALLOWED", "不支持此 Agent 操作", 404)

    try:
        cfg = _learning_cfg()
        if not cfg.get("enabled", True):
            return _failure("LEARNING_DISABLED", "学习服务未启用", 503)
        api_key = str(os.environ.get("NEXORALEARNING_RUNTIME_API_KEY") or cfg.get("api_key") or "").strip()
        if not api_key:
            return _failure(
                "LEARNING_AUTH_NOT_CONFIGURED",
                "请管理员配置 NexoraLearning API Key，与学习服务 runtime_api.api_key 保持一致",
                503,
            )
        base_url = _runtime_base_url(cfg).rstrip("/")
        parsed = urllib_parse.urlsplit(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("invalid learning service URL")
        timeout = min(120.0, max(1.0, float(cfg.get("request_timeout") or 30)))
        if agent_path in {"ask-in-context", "plan", "review-plan", "flow/submit"}:
            timeout = max(timeout, 90.0)
    except (TypeError, ValueError, KeyError, AttributeError):
        return _failure("LEARNING_CONFIG_INVALID", "学习服务配置无效，请联系管理员", 503)

    username = str(session["username"])
    query = [(key, value) for key, value in request.args.items(multi=True) if key.lower() not in _IDENTITY_KEYS]
    url = base_url + "/api/agent/v1/" + agent_path
    if query:
        url += "?" + urllib_parse.urlencode(query)
    body = None
    if request.method == "POST":
        if request.content_length is not None and request.content_length > _MAX_REQUEST_BYTES:
            return _failure("REQUEST_TOO_LARGE", "Agent 请求内容过大", 413)
        raw = request.stream.read(_MAX_REQUEST_BYTES + 1)
        if len(raw) > _MAX_REQUEST_BYTES:
            return _failure("REQUEST_TOO_LARGE", "Agent 请求内容过大", 413)
        try:
            payload = json.loads(raw) if raw else {}
        except (ValueError, UnicodeError):
            return _failure("INVALID_ARGUMENT", "请求必须为 JSON 对象", 400)
        if not isinstance(payload, dict):
            return _failure("INVALID_ARGUMENT", "请求必须为 JSON 对象", 400)
        payload = _strip_identity(payload)
        payload["username"] = username
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    # Do not forward caller cookies, authorization, identity, host, or URLs.
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-API-Key": api_key,
        "X-Nexora-Username": username,
    }
    upstream_request = urllib_request.Request(url, data=body, headers=headers, method=request.method)
    try:
        opener = urllib_request.build_opener(_NoRedirect())
        try:
            response = opener.open(upstream_request, timeout=timeout)
        except urllib_error.HTTPError as error:
            response = error
        with response:
            status = response.code
            raw = response.read(_MAX_RESPONSE_BYTES + 1)
        if status == 401:
            return _failure("LEARNING_AUTH_FAILED", "学习服务鉴权失败，请管理员检查服务密钥", 502)
        if status < 200 or 300 <= status < 400:
            raise ValueError("unexpected upstream status")
        if len(raw) > _MAX_RESPONSE_BYTES:
            raise ValueError("upstream response too large")
        try:
            payload = json.loads(raw)
        except (ValueError, UnicodeError):
            raise ValueError("invalid upstream JSON")
        if not isinstance(payload, dict):
            raise ValueError("invalid upstream JSON")

        # 上游 4xx 属于业务错误，保留原有状态码与错误信封，供客户端识别具体原因。
        # 401 表示代理与学习服务之间鉴权失败，已在上面单独屏蔽内部响应。
        if status >= 500:
            return _failure("LEARNING_UNAVAILABLE", "学习服务暂时不可用，请稍后重试", 502)
        return jsonify(payload), status
    except (urllib_error.URLError, TimeoutError, OSError, ValueError):
        return _failure("LEARNING_UNAVAILABLE", "学习服务暂时不可用，请稍后重试", 502)
