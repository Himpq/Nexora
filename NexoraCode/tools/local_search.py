"""
General local file discovery and text search tools.
"""

import fnmatch
import os
import re
from pathlib import Path

from core.config import config
from tools.path_guard import build_permission_required, is_hidden_path, is_sensitive_path, resolve_allowed_path


DEFAULT_EXCLUDE_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".venv",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
}

DEFAULT_TEXT_EXTENSIONS = {
    ".bat",
    ".cfg",
    ".conf",
    ".cpp",
    ".css",
    ".csv",
    ".go",
    ".h",
    ".hpp",
    ".html",
    ".ini",
    ".java",
    ".js",
    ".json",
    ".jsx",
    ".less",
    ".log",
    ".md",
    ".php",
    ".ps1",
    ".py",
    ".rs",
    ".scss",
    ".sh",
    ".sql",
    ".ts",
    ".tsx",
    ".txt",
    ".vue",
    ".xml",
    ".yaml",
    ".yml",
}


def _normalize_string_list(value) -> list[str]:
    if value is None:
        return []

    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []

    if isinstance(value, (list, tuple, set)):
        result = []

        for item in value:
            text = str(item or "").strip()

            if text:
                result.append(text)

        return result

    text = str(value or "").strip()
    return [text] if text else []


def _coerce_int(value, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default

    return max(minimum, min(maximum, parsed))


def _entry_depth(path: Path, root: Path) -> int:
    try:
        return len(path.relative_to(root).parts)
    except ValueError:
        return 0


def _should_exclude_dir(path: Path, root: Path, exclude_dirs: set[str], include_hidden: bool) -> bool:
    name = path.name

    if name in exclude_dirs:
        return True

    if not include_hidden and is_hidden_path(path, root):
        return True

    return False


def _matches_any_pattern(path: Path, root: Path, patterns: list[str]) -> bool:
    if not patterns:
        return True

    try:
        relative = path.relative_to(root).as_posix()
    except ValueError:
        relative = path.as_posix()

    return any(fnmatch.fnmatch(path.name, pattern) or fnmatch.fnmatch(relative, pattern) for pattern in patterns)


def _is_text_candidate(path: Path, include_extensions: list[str]) -> bool:
    if include_extensions:
        suffix = path.suffix.lower()
        normalized = [item.lower() if item.startswith(".") else f".{item.lower()}" for item in include_extensions]
        return suffix in normalized

    return path.suffix.lower() in DEFAULT_TEXT_EXTENSIONS


def _iter_files(
    root: Path,
    max_depth: int,
    include_hidden: bool,
    include_sensitive: bool,
    exclude_dirs: set[str],
):
    for current_root, dir_names, file_names in os.walk(root):
        current_path = Path(current_root)
        current_depth = _entry_depth(current_path, root)

        dir_names[:] = sorted([
            name
            for name in dir_names
            if current_depth < max_depth
            and not _should_exclude_dir(current_path / name, root, exclude_dirs, include_hidden)
        ])

        if current_depth >= max_depth:
            continue

        for file_name in sorted(file_names):
            path = current_path / file_name

            if not include_hidden and is_hidden_path(path, root):
                continue

            if not include_sensitive and is_sensitive_path(path):
                yield path, "sensitive"
                continue

            yield path, ""


def local_text_search(
    path: str,
    query: str,
    mode: str = "literal",
    case_sensitive: bool = False,
    max_depth: int = 8,
    max_results: int = 100,
    context_lines: int = 0,
    include_globs=None,
    exclude_dirs=None,
    include_extensions=None,
    include_hidden: bool = False,
    include_sensitive: bool = False,
    encoding: str = "utf-8-sig",
    max_file_bytes: int = 1048576,
    _nexora_context=None,
) -> dict:
    root, path_error = resolve_allowed_path(
        path,
        context=_nexora_context,
        access="read",
        sensitive_access=bool(include_sensitive),
    )

    if path_error:
        return build_permission_required(path, operation="read", sensitive=bool(include_sensitive))

    if not root.exists():
        return {"success": False, "error": f"Path not found: {path}"}

    if not root.is_dir():
        return {"success": False, "error": f"Path is not a directory: {path}"}

    search_text = str(query or "")

    if not search_text:
        return {"success": False, "error": "query is required."}

    search_mode = str(mode or "literal").strip().lower()

    if search_mode not in {"literal", "regex"}:
        return {"success": False, "error": "mode must be literal or regex."}

    default_max_results = _coerce_int(config.get("local_text_search_max_results", 100), 100, 1, 1000)
    safe_depth = _coerce_int(max_depth, 8, 0, 64)
    safe_max_results = _coerce_int(max_results, default_max_results, 1, 1000)
    safe_context_lines = _coerce_int(context_lines, 0, 0, 10)
    safe_max_file_bytes = _coerce_int(max_file_bytes, 1048576, 1024, 16 * 1024 * 1024)
    include_patterns = _normalize_string_list(include_globs)
    extensions = _normalize_string_list(include_extensions)
    blocked_dirs = DEFAULT_EXCLUDE_DIRS | set(_normalize_string_list(exclude_dirs))
    flags = 0 if bool(case_sensitive) else re.IGNORECASE

    try:
        pattern = re.compile(search_text if search_mode == "regex" else re.escape(search_text), flags)
    except re.error as exc:
        return {"success": False, "error": f"Invalid regex: {exc}"}

    matches = []
    scanned_files = 0
    skipped = {
        "decode_error": 0,
        "large_file": 0,
        "non_text_extension": 0,
        "sensitive": 0,
    }

    for file_path, skip_reason in _iter_files(
        root,
        safe_depth,
        bool(include_hidden),
        bool(include_sensitive),
        blocked_dirs,
    ):
        if skip_reason == "sensitive":
            skipped["sensitive"] += 1
            continue

        if not _matches_any_pattern(file_path, root, include_patterns):
            continue

        if not _is_text_candidate(file_path, extensions):
            skipped["non_text_extension"] += 1
            continue

        try:
            size = file_path.stat().st_size
        except OSError:
            continue

        if size > safe_max_file_bytes:
            skipped["large_file"] += 1
            continue

        try:
            text = file_path.read_text(encoding=str(encoding or "utf-8-sig"))
        except UnicodeDecodeError:
            skipped["decode_error"] += 1
            continue

        scanned_files += 1
        lines = text.splitlines()

        for line_index, line_text in enumerate(lines):
            found = pattern.search(line_text)

            if not found:
                continue

            before = []
            after = []

            if safe_context_lines:
                before_start = max(0, line_index - safe_context_lines)
                before = lines[before_start:line_index]
                after_end = min(len(lines), line_index + safe_context_lines + 1)
                after = lines[line_index + 1:after_end]

            matches.append({
                "path": str(file_path),
                "line_number": line_index + 1,
                "column": found.start() + 1,
                "line": line_text,
                "before": before,
                "after": after,
            })

            if len(matches) >= safe_max_results:
                return {
                    "success": True,
                    "truncated": True,
                    "path": str(root),
                    "query": search_text,
                    "mode": search_mode,
                    "scanned_files": scanned_files,
                    "skipped": skipped,
                    "matches": matches,
                    "match_count": len(matches),
                }

    return {
        "success": True,
        "truncated": False,
        "path": str(root),
        "query": search_text,
        "mode": search_mode,
        "scanned_files": scanned_files,
        "skipped": skipped,
        "matches": matches,
        "match_count": len(matches),
    }


def local_file_search_tree(
    path: str,
    max_depth: int = 3,
    pattern: str = "*",
    include_files: bool = True,
    include_dirs: bool = True,
    include_hidden: bool = False,
    include_sensitive: bool = False,
    exclude_dirs=None,
    max_entries: int = 500,
    _nexora_context=None,
) -> dict:
    root, path_error = resolve_allowed_path(
        path,
        context=_nexora_context,
        access="read",
        sensitive_access=bool(include_sensitive),
    )

    if path_error:
        return build_permission_required(path, operation="read", sensitive=bool(include_sensitive))

    if not root.exists():
        return {"success": False, "error": f"Path not found: {path}"}

    if not root.is_dir():
        return {"success": False, "error": f"Path is not a directory: {path}"}

    default_max_entries = _coerce_int(config.get("local_file_tree_max_entries", 500), 500, 1, 5000)
    safe_depth = _coerce_int(max_depth, 3, 0, 32)
    safe_max_entries = _coerce_int(max_entries, default_max_entries, 1, 5000)
    safe_pattern = str(pattern or "*").strip() or "*"
    blocked_dirs = DEFAULT_EXCLUDE_DIRS | set(_normalize_string_list(exclude_dirs))
    entries = []
    truncated = False
    skipped = {
        "hidden": 0,
        "sensitive": 0,
        "excluded_dir": 0,
    }

    for current_root, dir_names, file_names in os.walk(root):
        current_path = Path(current_root)
        current_depth = _entry_depth(current_path, root)

        kept_dirs = []

        for name in sorted(dir_names):
            dir_path = current_path / name

            if name in blocked_dirs:
                skipped["excluded_dir"] += 1
                continue

            if not include_hidden and is_hidden_path(dir_path, root):
                skipped["hidden"] += 1
                continue

            if not include_sensitive and is_sensitive_path(dir_path):
                skipped["sensitive"] += 1
                continue

            if current_depth < safe_depth:
                kept_dirs.append(name)

            if include_dirs and current_depth + 1 <= safe_depth and _matches_any_pattern(dir_path, root, [safe_pattern]):
                entries.append(_build_tree_entry(dir_path, root, "dir", current_depth + 1))

        dir_names[:] = kept_dirs

        if include_files and current_depth + 1 <= safe_depth:
            for name in sorted(file_names):
                file_path = current_path / name

                if not include_hidden and is_hidden_path(file_path, root):
                    skipped["hidden"] += 1
                    continue

                if not include_sensitive and is_sensitive_path(file_path):
                    skipped["sensitive"] += 1
                    continue

                if _matches_any_pattern(file_path, root, [safe_pattern]):
                    entries.append(_build_tree_entry(file_path, root, "file", current_depth + 1))

                if len(entries) >= safe_max_entries:
                    truncated = True
                    dir_names[:] = []
                    break

        if len(entries) >= safe_max_entries:
            truncated = True
            break

    return {
        "success": True,
        "path": str(root),
        "max_depth": safe_depth,
        "pattern": safe_pattern,
        "truncated": truncated,
        "entries": entries[:safe_max_entries],
        "entry_count": min(len(entries), safe_max_entries),
        "skipped": skipped,
    }


def _build_tree_entry(path: Path, root: Path, entry_type: str, depth: int) -> dict:
    item = {
        "path": str(path),
        "relative_path": path.relative_to(root).as_posix(),
        "name": path.name,
        "type": entry_type,
        "depth": depth,
    }

    if entry_type == "file":
        try:
            stat_result = path.stat()
            item["size"] = stat_result.st_size
            item["modified_at"] = stat_result.st_mtime
        except OSError:
            item["size"] = None

    return item
