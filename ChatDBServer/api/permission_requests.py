"""Stable identities for temporary local permission requests."""

import hashlib
import ntpath
import posixpath
import re


def build_permission_question_id(path: str, operation: str, scope: str) -> str:
    """Build one stable ID for the same path and access request across retries."""
    normalized_path = _normalize_permission_path(path)
    normalized_operation = str(operation or "read").strip().lower()
    normalized_scope = str(scope or "file").strip().lower()
    identity = "\n".join((normalized_path, normalized_operation, normalized_scope))
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]

    return f"permission_{digest}"


def _normalize_permission_path(path: str) -> str:
    raw = str(path or "").strip()
    normalized = re.sub(r"/+", "/", raw.replace("\\", "/")).rstrip("/")

    if re.match(r"^[A-Za-z]:/", normalized) or raw.startswith("\\\\"):
        normalized = normalized.casefold()

    return normalized


def normalize_project_permission_request(
    path: str,
    operation: str,
    scope: str,
    project_root: str,
    sensitive: bool = False,
) -> tuple[str, str, str, bool]:
    """Promote a non-sensitive path inside a bound Project to one project-root request."""
    clean_path = str(path or "").strip()
    clean_operation = str(operation or "read").strip().lower()
    clean_scope = str(scope or "file").strip().lower()
    clean_root = str(project_root or "").strip()

    if sensitive or not clean_path or not clean_root:
        return clean_path, clean_operation, clean_scope, False

    path_module = _permission_path_module(clean_path, clean_root)
    normalized_path = path_module.normcase(path_module.normpath(clean_path))
    normalized_root = path_module.normcase(path_module.normpath(clean_root))

    if not path_module.isabs(normalized_path) or not path_module.isabs(normalized_root):
        return clean_path, clean_operation, clean_scope, False

    try:
        common_root = path_module.commonpath((normalized_path, normalized_root))
    except ValueError:
        return clean_path, clean_operation, clean_scope, False

    if common_root != normalized_root:
        return clean_path, clean_operation, clean_scope, False

    return clean_root, "read_write", "dir", True


def _permission_path_module(path: str, project_root: str):
    windows_path = bool(
        re.match(r"^[A-Za-z]:[\\/]", path)
        or re.match(r"^[A-Za-z]:[\\/]", project_root)
        or path.startswith("\\\\")
        or project_root.startswith("\\\\")
    )

    return ntpath if windows_path else posixpath
