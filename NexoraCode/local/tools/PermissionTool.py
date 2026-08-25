"""
NexoraCode.local.tools.PermissionTool — 会话临时授权工具

两个工具：
- local_permission_grant: 用户明确允许后，为当前会话授予临时路径权限
- local_permission_list: 列出当前会话的临时路径权限

只更新 NexoraCode 内存权限状态，不读写目标路径；真实准入仍由 PathGuard 校验。
"""

from __future__ import annotations

from ..PathGuard import grant_temporary_permission, list_temporary_permissions
from ..Tool import LocalTool, ToolContext


def _resolve_conversation_id(conversation_id: str, context: ToolContext) -> str:
    return str(
        conversation_id
        or context.conversation_id
        or ""
    ).strip()


class PermissionGrantTool(LocalTool):
    name = "local_permission_grant"
    description = (
        "Grant temporary path permission for the current conversation after the user explicitly allowed it. "
        "This tool only updates NexoraCode in-memory permission state; it does not read or write the target path."
    )
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Path approved by the user."},
            "scope": {"type": "string", "enum": ["file", "dir"], "default": "file"},
            "access": {"type": "string", "enum": ["read", "write", "read_write"], "default": "read"},
            "reason": {"type": "string", "description": "Short reason shown to the user."},
            "sensitive": {
                "type": "boolean",
                "default": False,
                "description": "True only after the user explicitly approved access to a suspected secret or private path.",
            },
            "conversation_id": {
                "type": "string",
                "description": "Optional. Usually injected by NexoraCode bridge for this conversation.",
            },
        },
        "required": ["path"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        return grant_temporary_permission(
            path=str(args.get("path") or ""),
            conversation_id=_resolve_conversation_id(str(args.get("conversation_id") or ""), context),
            scope=str(args.get("scope") or "file"),
            access=str(args.get("access") or "read"),
            reason=str(args.get("reason") or ""),
            sensitive=bool(args.get("sensitive", False)),
        )


class PermissionListTool(LocalTool):
    name = "local_permission_list"
    description = "List temporary path permissions for the current NexoraCode conversation."
    parameters = {
        "type": "object",
        "properties": {
            "conversation_id": {
                "type": "string",
                "description": "Optional. Usually injected by NexoraCode bridge for this conversation.",
            },
        },
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        return list_temporary_permissions(_resolve_conversation_id(str(args.get("conversation_id") or ""), context))
