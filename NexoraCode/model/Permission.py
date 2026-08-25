"""
NexoraCode.model.Permission — 本地路径授权询问

本地工具返回 permission_required 时，由 AgentLoop 构造授权询问 payload，
推送 question 事件给 UI 渲染授权卡片；用户允许后经本地 /api/agent/permission/grant
写入 PathGuard 会话级临时权限。

对外提供：
- build_local_permission_question(detail): 从工具错误结果构建完整 question payload
- build_local_permission_request(detail): 仅权限请求字段（供 UI 授权提交）
"""

from __future__ import annotations

import hashlib
import uuid
from typing import Any


def _normalize_path(path: str) -> str:
    text = str(path or "").strip()
    normalized = text.replace("\\", "/").rstrip("/")

    while "//" in normalized:
        normalized = normalized.replace("//", "/")

    if len(normalized) >= 2 and normalized[1] == ":":
        normalized = normalized.casefold()

    return normalized


def build_permission_question_id(path: str, operation: str, scope: str) -> str:
    identity = "\n".join((_normalize_path(path), str(operation or "read").lower(), str(scope or "file").lower()))
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]
    return f"permission_{digest}"


def build_local_permission_request(detail: Any) -> dict:
    """从本地工具 permission_required 结果提取权限请求字段。"""
    payload = detail if isinstance(detail, dict) else {}

    return {
        "path": str(payload.get("path") or payload.get("resolved_path") or "").strip(),
        "operation": str(payload.get("operation") or "read").strip().lower() or "read",
        "scope": str(payload.get("suggested_scope") or "file").strip().lower() or "file",
        "reason": str(payload.get("reason") or payload.get("message") or "本地工具需要访问该路径。").strip(),
        "sensitive": bool(payload.get("sensitive", False)),
    }


def build_local_permission_question(detail: Any) -> dict:
    """构建完整 question payload，供 UI 渲染授权卡片。"""
    request = build_local_permission_request(detail)
    operation_text = {"read": "读取", "write": "写入", "read_write": "读取和写入"}.get(request["operation"], request["operation"])
    scope_text = "目录" if request["scope"] == "dir" else "文件"

    content_lines = [
        f"模型需要临时{operation_text}这个本地{scope_text}:",
        request["path"],
        "",
        f"原因: {request['reason']}",
    ]

    if request["sensitive"]:
        content_lines.extend([
            "",
            "这个路径可能包含密钥、令牌、Cookie 或其他隐私信息，请确认你真的允许本次对话访问。",
        ])

    return {
        "track_answer": True,
        "question_id": build_permission_question_id(request["path"], request["operation"], request["scope"]),
        "question_card_id": f"permission_request_{uuid.uuid4().hex}",
        "question_title": "请求本次对话临时访问权限",
        "question_content": "\n".join(content_lines),
        "choices": [
            f"允许本次对话访问此{scope_text}",
            "拒绝访问",
        ],
        "allow_other": False,
        "permission_request": request,
    }
