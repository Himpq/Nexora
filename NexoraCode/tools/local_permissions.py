"""
Temporary permission tools for NexoraCode local path access.
"""

from tools.path_guard import grant_temporary_permission, list_temporary_permissions


def local_permission_grant(
    path: str,
    scope: str = "file",
    access: str = "read",
    reason: str = "",
    sensitive: bool = False,
    conversation_id: str = "",
    _nexora_context=None,
) -> dict:
    context = _nexora_context if isinstance(_nexora_context, dict) else {}
    resolved_conversation_id = str(
        conversation_id
        or context.get("conversation_id")
        or context.get("conversationId")
        or ""
    ).strip()

    return grant_temporary_permission(
        path=path,
        conversation_id=resolved_conversation_id,
        scope=scope,
        access=access,
        reason=reason,
        sensitive=bool(sensitive),
    )


def local_permission_list(conversation_id: str = "", _nexora_context=None) -> dict:
    context = _nexora_context if isinstance(_nexora_context, dict) else {}
    resolved_conversation_id = str(
        conversation_id
        or context.get("conversation_id")
        or context.get("conversationId")
        or ""
    ).strip()

    return list_temporary_permissions(resolved_conversation_id)
