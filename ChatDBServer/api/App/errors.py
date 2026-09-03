"""
ChatDBServer.api.App.errors — 统一错误模板系统

全站错误响应的唯一事实来源：
- ApiError: 业务异常类（status / error_type / error_code / extras）
- json_error: 统一错误响应构造函数（{success, message, error, error_type, error_code, ...extras}）
- extract_exception_message: 从各类异常/嵌套 JSON 提取可读核心 message
- register_error_handlers: 注册 Flask 全局 404 / 500 / ApiError / HTTPException 处理器

字段约定（对前端稳定的契约）：
- success: false      业务失败标识
- message: 人类可读的中文/英文错误描述
- error:   message 的别名（兼容历史字段）
- error_type: 错误类别（auth / permission / not_found / invalid_request /
              rate_limit / quota / provider_error / upstream / internal）
- error_code: 稳定机器码（对应类别的小写 snake_case）
- 各业务模块可追加 model / provider / username 等上下文字段（extras）

用法：
    from api.App.errors import ApiError, json_error, register_error_handlers

    # 方式一：直接返回
    return json_error('用户名不能为空', status=400, error_type='invalid_request')

    # 方式二：抛异常（由全局 handler 捕获）
    raise ApiError('任务不存在', status=404, error_type='not_found')
"""

from __future__ import annotations

import json
from typing import Any, Optional

from flask import Flask, jsonify, request


_ERROR_TYPE_DEFAULT = "invalid_request"
_ERROR_CODE_MAP = {
    "auth": "unauthorized",
    "permission": "forbidden",
    "not_found": "not_found",
    "invalid_request": "invalid_request_error",
    "rate_limit": "rate_limit_exceeded",
    "quota": "quota_exceeded",
    "provider_error": "upstream_error",
    "upstream": "upstream_error",
    "internal": "internal_error",
}


class ApiError(Exception):
    """业务错误异常：由全局 errorhandler 转换为统一 JSON 响应。"""

    def __init__(
        self,
        message: str = "请求失败",
        *,
        status: int = 400,
        error_type: str = "invalid_request",
        error_code: Optional[str] = None,
        extras: Optional[dict] = None,
    ):
        super().__init__(message)
        self.message = str(message or "请求失败")
        self.status = int(status or 400)
        self.error_type = str(error_type or "invalid_request")
        self.error_code = error_code or _ERROR_CODE_MAP.get(self.error_type, self.error_type)
        self.extras = dict(extras) if isinstance(extras, dict) else {}


def extract_exception_message(exc: Any) -> str:
    """从各类异常 / 错误对象中提取可读的核心 message（OpenAI SDK / dict / 嵌套 JSON）。"""
    if exc is None:
        return ""

    # ApiError / 带 message 属性的异常
    message_attr = getattr(exc, "message", None)

    if isinstance(message_attr, str) and message_attr.strip():
        return message_attr.strip()[:500]

    # OpenAI SDK 异常：e.body
    body = getattr(exc, "body", None)

    if isinstance(body, dict):
        candidate = body.get("message") or body.get("error")

        if isinstance(candidate, dict):
            candidate = candidate.get("message") or candidate.get("error")

            if isinstance(candidate, dict):
                candidate = candidate.get("message") or candidate.get("error")

        if candidate:
            return str(candidate).strip()[:500]

    # OpenAI SDK 异常：e.response.text
    response_obj = getattr(exc, "response", None)

    if response_obj is not None:
        try:
            text = str(getattr(response_obj, "text", "") or "")
            parsed = json.loads(text)

            if isinstance(parsed, dict):
                candidate = parsed.get("message") or parsed.get("error")

                if isinstance(candidate, dict):
                    candidate = candidate.get("message") or candidate.get("error")

                if candidate:
                    return str(candidate).strip()[:500]
        except Exception:
            pass

    # 直接 dict 异常
    if isinstance(exc, dict):
        candidate = exc.get("message") or exc.get("error")

        if isinstance(candidate, dict):
            candidate = candidate.get("message")

        if candidate:
            return str(candidate).strip()[:500]

    return str(exc or "").strip()[:500]


def _normalize_error_type(error_type: Optional[str]) -> str:
    text = str(error_type or "").strip().lower()

    if not text:
        return _ERROR_TYPE_DEFAULT

    # 兼容历史取值：rate_limit / quota_exhausted / provider_error 等
    if text in {"rate_limit", "rate_limit_exceeded", "quota_exhausted", "quota_exceeded"}:
        return "rate_limit" if "rate" in text else "quota"

    if text in {"auth", "unauthorized", "login_required"}:
        return "auth"

    if text in {"permission", "forbidden"}:
        return "permission"

    if text in {"not_found", "notfound"}:
        return "not_found"

    if text in {"internal", "internal_error", "server_error"}:
        return "internal"

    if text in {"provider_error", "upstream", "upstream_error", "bad_gateway"}:
        return "provider_error"

    return text


def json_error(
    message: Any,
    status: int = 400,
    *,
    error_type: Optional[str] = None,
    error_code: Optional[str] = None,
    extras: Optional[dict] = None,
) -> tuple:
    """统一构建错误响应：{success, message, error, error_type, error_code, ...extras}。"""
    safe_status = 200

    try:
        safe_status = int(status or 400)

        if safe_status < 400:
            safe_status = 400
    except (TypeError, ValueError):
        safe_status = 400

    normalized_type = _normalize_error_type(error_type)

    if not error_type:
        # 未显式指定类别时按状态码推断，保证 404/401/403/429/500 语义一致
        if safe_status == 404:
            normalized_type = "not_found"
        elif safe_status == 401:
            normalized_type = "auth"
        elif safe_status == 403:
            normalized_type = "permission"
        elif safe_status == 429:
            normalized_type = "rate_limit"
        elif safe_status >= 500:
            normalized_type = "internal"

    final_code = error_code or _ERROR_CODE_MAP.get(normalized_type, normalized_type)
    text_message = extract_exception_message(message) or "请求失败"

    payload = {
        "success": False,
        "message": text_message,
        "error": text_message,
        "error_type": normalized_type,
        "error_code": final_code,
    }

    if isinstance(extras, dict):
        payload.update({str(key): value for key, value in extras.items() if key not in payload})

    return jsonify(payload), safe_status


def _api_error_response(exc: ApiError):
    return json_error(
        exc.message,
        status=exc.status,
        error_type=exc.error_type,
        error_code=exc.error_code,
        extras=exc.extras,
    )


def _http_exception_response(exc):
    """Werkzeug HTTPException → 统一 JSON（404/405/413 等）。"""
    try:
        from werkzeug.exceptions import HTTPException

        status = int(exc.code or 500) if isinstance(exc, HTTPException) else 500
    except Exception:
        status = 500

    if status == 404:
        return json_error("资源不存在", status=404, error_type="not_found")

    if status == 405:
        return json_error("请求方法不允许", status=405, error_type="invalid_request")

    if status == 429:
        return json_error("请求过于频繁，请稍后重试", status=429, error_type="rate_limit")

    if status == 413:
        return json_error("请求内容过大", status=413, error_type="invalid_request")

    text = getattr(exc, "description", None) or getattr(exc, "name", None) or "请求失败"
    return json_error(text, status=status, error_type="invalid_request")


def _internal_error_response(exc):
    try:
        from werkzeug.exceptions import HTTPException

        if isinstance(exc, HTTPException):
            return _http_exception_response(exc)
    except Exception:
        pass

    message = extract_exception_message(exc) or "服务器内部错误"

    return json_error(message, status=500, error_type="internal")


def _conversation_conflict_response(exc):
    """Conversation 冲突域（索引过期/角色不符等）→ 409，机器码 conversation_index_stale。

    前端依据 error_code=conversation_index_stale 识别"本地消息序号已过期"，
    应刷新会话数据而不是把原始错误展示为未知错误。
    """
    details = dict(getattr(exc, "details", None) or {})
    return json_error(
        str(exc) or "会话状态冲突，消息索引已过期",
        status=409,
        error_type="conflict",
        error_code="conversation_index_stale",
        extras=details,
    )


def _conversation_not_found_response(exc):
    return json_error(str(exc) or "会话不存在", status=404, error_type="not_found")


def _conversation_validation_response(exc):
    details = dict(getattr(exc, "details", None) or {})
    return json_error(
        str(exc) or "会话参数无效",
        status=400,
        error_type="invalid_request",
        extras=details,
    )


def register_error_handlers(app: Flask) -> None:
    """注册全局错误处理器：ApiError / HTTPException / 通用 Exception / 404。"""
    app.register_error_handler(ApiError, _api_error_response)
    app.register_error_handler(Exception, _internal_error_response)
    app.register_error_handler(404, _http_exception_response)

    # Conversation 域受控异常 → 结构化契约（懒导入避免与 basis 包循环依赖；
    # errors.py 模块别名机制保证与服务层抛出的是同一异常对象）
    try:
        from basis.Conversation.errors import (
            ConversationConflictError,
            ConversationNotFoundError,
            ConversationValidationError,
        )
    except Exception:
        ConversationConflictError = None  # type: ignore[assignment]

    if ConversationConflictError is not None:
        app.register_error_handler(ConversationConflictError, _conversation_conflict_response)
        app.register_error_handler(ConversationNotFoundError, _conversation_not_found_response)
        app.register_error_handler(ConversationValidationError, _conversation_validation_response)
