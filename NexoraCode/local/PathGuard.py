"""
NexoraCode.local.PathGuard — 本地路径与隐私守卫

本地工具共享的路径准入契约：
- allowed_dirs 白名单根目录判定
- 敏感路径识别（.env / credentials / token 等）
- 会话级临时授权（grant / list / TTL 清理）
- 统一 permission_required 错误结构，供模型按 ask_for_permission 流程自愈

对外提供：
- resolve_allowed_path / build_permission_required
- grant_temporary_permission / list_temporary_permissions
- is_hidden_path / is_sensitive_path
"""

from __future__ import annotations

import threading
import time
from pathlib import Path

from core.config import config


SENSITIVE_NAME_PARTS = (
    ".env",
    ".npmrc",
    ".pypirc",
    ".netrc",
    "authorized_keys",
    "credentials",
    "cookie",
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "known_hosts",
    "password",
    "secret",
    "token",
)
_TEMP_PERMISSION_LOCK = threading.RLock()
_TEMP_PERMISSIONS: dict[str, list[dict]] = {}
_TEMP_PERMISSION_TTL_SECONDS = 12 * 60 * 60


def allowed_roots() -> list[Path]:
    roots = []

    for item in config.get("allowed_dirs", []) or []:
        text = str(item or "").strip()

        if not text:
            continue

        try:
            roots.append(Path(text).resolve())
        except Exception:
            continue

    return roots


def _project_root_from_context(context: dict | None) -> Path | None:
    if not isinstance(context, dict):
        return None

    root_text = str(context.get("project_root") or context.get("projectRoot") or "").strip()

    if not root_text:
        return None

    try:
        return Path(root_text).resolve()
    except Exception:
        return None


def resolve_allowed_path(
    raw_path: str,
    context: dict | None = None,
    access: str = "read",
    sensitive_access: bool = False,
) -> tuple[Path | None, str]:
    text = str(raw_path or "").strip()

    if not text:
        return None, "path is required."

    roots = allowed_roots()
    project_root = _project_root_from_context(context)

    try:
        resolved = Path(text).resolve()
    except Exception as exc:
        return None, f"Invalid path: {exc}"

    needs_sensitive_permission = bool(sensitive_access) or is_sensitive_path(resolved)

    if needs_sensitive_permission:
        if _is_temporarily_allowed(resolved, context, access=access, sensitive=True):
            return resolved, ""

        print(f"[LocalAgent] permission_required (sensitive): path={resolved} op={access} conv={_conversation_id_from_context(context)}")
        return None, _build_permission_required_error(raw_path, resolved, access)

    # 会话绑定项目根路径内视为可信根，非敏感路径直接放行。
    if project_root is not None:
        try:
            resolved.relative_to(project_root)
            return resolved, ""
        except ValueError:
            pass

    for root in roots:
        try:
            resolved.relative_to(root)
            return resolved, ""
        except ValueError:
            continue

    if _is_temporarily_allowed(resolved, context, access=access):
        return resolved, ""

    if not roots:
        print(f"[LocalAgent] permission_required (no allowed_dirs): path={resolved} op={access} conv={_conversation_id_from_context(context)} project_root={project_root}")
        return None, _build_permission_required_error(raw_path, resolved, access)

    print(f"[LocalAgent] permission_required (outside allowed_dirs): path={resolved} op={access} conv={_conversation_id_from_context(context)}")
    return None, f"Path not in allowed_dirs: {raw_path}"


def build_permission_required(path: str, operation: str = "read", sensitive: bool = False) -> dict:
    resolved_text = ""

    try:
        resolved_text = str(Path(str(path or "").strip()).resolve())
    except Exception:
        resolved_text = str(path or "").strip()

    resolved_path = Path(resolved_text)
    sensitive_path = bool(sensitive) or is_sensitive_path(resolved_path)
    suggested_scope = "dir" if resolved_path.is_dir() else "file"
    reason = (
        "需要用户单独允许后才能访问本地敏感路径。"
        if sensitive_path
        else "路径不在当前 NexoraCode allowed_dirs 中，需要用户临时授权。"
    )

    return {
        "success": False,
        "error": "permission_required",
        "permission_required": True,
        "path": str(path or "").strip(),
        "resolved_path": resolved_text,
        "operation": str(operation or "read").strip() or "read",
        "sensitive": sensitive_path,
        "suggested_scope": suggested_scope,
        "reason": reason,
        "message": _build_permission_required_error(path, resolved_path, operation),
    }


def grant_temporary_permission(
    path: str,
    conversation_id: str,
    scope: str = "file",
    access: str = "read",
    reason: str = "",
    sensitive: bool = False,
) -> dict:
    clean_conversation_id = str(conversation_id or "").strip()

    if not clean_conversation_id:
        return {"success": False, "error": "conversation_id is required."}

    clean_path = str(path or "").strip()

    if not clean_path:
        return {"success": False, "error": "path is required."}

    try:
        resolved = Path(clean_path).resolve()
    except Exception as exc:
        return {"success": False, "error": f"Invalid path: {exc}"}

    clean_scope = str(scope or "file").strip().lower()

    if clean_scope not in {"file", "dir"}:
        return {"success": False, "error": "scope must be file or dir."}

    clean_access = str(access or "read").strip().lower()

    if clean_access not in {"read", "write", "read_write"}:
        return {"success": False, "error": "access must be read, write, or read_write."}

    now = time.time()
    record = {
        "path": str(resolved),
        "scope": clean_scope,
        "access": clean_access,
        "reason": str(reason or "").strip(),
        "sensitive": bool(sensitive),
        "created_at": now,
        "expires_at": now + _TEMP_PERMISSION_TTL_SECONDS,
    }

    with _TEMP_PERMISSION_LOCK:
        _cleanup_temp_permissions_locked(now)
        bucket = _TEMP_PERMISSIONS.setdefault(clean_conversation_id, [])
        bucket[:] = [
            item
            for item in bucket
            if not (
                str(item.get("path") or "") == record["path"]
                and str(item.get("scope") or "") == record["scope"]
                and str(item.get("access") or "") == record["access"]
            )
        ]
        bucket.append(record)

    return {
        "success": True,
        "conversation_id": clean_conversation_id,
        "permission": record,
        "message": "Temporary permission granted for this conversation.",
    }


def list_temporary_permissions(conversation_id: str = "") -> dict:
    clean_conversation_id = str(conversation_id or "").strip()
    now = time.time()

    with _TEMP_PERMISSION_LOCK:
        _cleanup_temp_permissions_locked(now)

        if clean_conversation_id:
            return {
                "success": True,
                "conversation_id": clean_conversation_id,
                "permissions": list(_TEMP_PERMISSIONS.get(clean_conversation_id, [])),
            }

        return {
            "success": True,
            "permissions_by_conversation": {
                key: list(value)
                for key, value in _TEMP_PERMISSIONS.items()
            },
        }


def _build_permission_required_error(path, resolved: Path, operation: str) -> str:
    return (
        "permission_required: access to this path is not allowed. "
        f"operation={str(operation or 'read')}, path={path}, resolved_path={resolved}"
    )


def _conversation_id_from_context(context: dict | None) -> str:
    if not isinstance(context, dict):
        return ""

    return str(
        context.get("conversation_id")
        or context.get("conversationId")
        or ""
    ).strip()


def _is_temporarily_allowed(path: Path, context: dict | None, access: str = "read", sensitive: bool = False) -> bool:
    conversation_id = _conversation_id_from_context(context)

    if not conversation_id:
        return False

    now = time.time()

    with _TEMP_PERMISSION_LOCK:
        _cleanup_temp_permissions_locked(now)
        permissions = list(_TEMP_PERMISSIONS.get(conversation_id, []))

    clean_access = str(access or "read").strip().lower()

    for item in permissions:
        item_access = str(item.get("access") or "read").strip().lower()

        if sensitive and not bool(item.get("sensitive", False)):
            continue

        if clean_access == "write" and item_access not in {"write", "read_write"}:
            continue

        if clean_access == "read" and item_access not in {"read", "read_write"}:
            continue

        try:
            allowed_path = Path(str(item.get("path") or "")).resolve()
        except Exception:
            continue

        scope = str(item.get("scope") or "file").strip().lower()

        if scope == "file" and path == allowed_path:
            return True

        if scope == "dir":
            try:
                path.relative_to(allowed_path)
                return True
            except ValueError:
                continue

    return False


def _cleanup_temp_permissions_locked(now: float) -> None:
    empty_keys = []

    for conversation_id, permissions in _TEMP_PERMISSIONS.items():
        permissions[:] = [
            item
            for item in permissions
            if float(item.get("expires_at", 0) or 0) > now
        ]

        if not permissions:
            empty_keys.append(conversation_id)

    for conversation_id in empty_keys:
        _TEMP_PERMISSIONS.pop(conversation_id, None)


def is_hidden_path(path: Path, root: Path) -> bool:
    try:
        relative_parts = path.relative_to(root).parts
    except ValueError:
        relative_parts = path.parts

    return any(str(part).startswith(".") for part in relative_parts if str(part) not in {".", ".."})


def is_sensitive_path(path: Path) -> bool:
    lowered_parts = [str(part or "").strip().lower() for part in path.parts]

    for part in lowered_parts:
        if not part:
            continue

        for marker in SENSITIVE_NAME_PARTS:
            if marker in part:
                return True

    return False
