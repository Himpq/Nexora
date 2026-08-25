"""
NexoraCode.local.tools.SearchTool — 本地文件发现与文本搜索

两个工具：
- local_text_search: 在 allowed_dirs 路径内按文本 / 正则搜索文件内容
- local_file_search_tree: 列出目录树（元数据，带深度 / 条目上限）

共享路径权限由 PathGuard 统一判定。
"""

from __future__ import annotations

import fnmatch
import os
import re
from pathlib import Path

from core.config import config
from ..PathGuard import build_permission_required, is_hidden_path, is_sensitive_path, resolve_allowed_path
from ..Tool import LocalTool, ToolContext


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


class TextSearchTool(LocalTool):
    name = "local_text_search"
    description = (
        "Search text in files under a configured allowed_dirs path. This is a general local search tool, "
        "not a project manager. It does not read sensitive-looking files unless include_sensitive is explicitly true."
    )
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Directory path inside allowed_dirs."},
            "query": {"type": "string", "description": "Text or regex to search for."},
            "mode": {
                "type": "string",
                "enum": ["literal", "regex"],
                "default": "literal",
                "description": "Search mode.",
            },
            "case_sensitive": {"type": "boolean", "default": False},
            "max_depth": {"type": "integer", "default": 8, "description": "Maximum directory depth to scan."},
            "max_results": {"type": "integer", "default": 100, "description": "Maximum matches to return."},
            "context_lines": {"type": "integer", "default": 0, "description": "Context lines before and after each match."},
            "include_globs": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional filename or relative-path glob patterns.",
            },
            "exclude_dirs": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Additional directory names to skip.",
            },
            "include_extensions": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional text file extensions to scan, such as py, js, md.",
            },
            "include_hidden": {"type": "boolean", "default": False},
            "include_sensitive": {
                "type": "boolean",
                "default": False,
                "description": "Requires explicit user permission before reading suspected secrets.",
            },
            "encoding": {"type": "string", "default": "utf-8-sig"},
            "max_file_bytes": {"type": "integer", "default": 1048576},
        },
        "required": ["path", "query"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        path = str(args.get("path") or "").strip()
        include_sensitive = bool(args.get("include_sensitive", False))

        root, path_error = resolve_allowed_path(
            path,
            context=context.as_dict(),
            access="read",
            sensitive_access=include_sensitive,
        )

        if path_error:
            return build_permission_required(path, operation="read", sensitive=include_sensitive)

        if not root.exists():
            return {"success": False, "error": f"Path not found: {path}"}

        if not root.is_dir():
            return {"success": False, "error": f"Path is not a directory: {path}"}

        search_text = str(args.get("query") or "")

        if not search_text:
            return {"success": False, "error": "query is required."}

        search_mode = str(args.get("mode") or "literal").strip().lower()

        if search_mode not in {"literal", "regex"}:
            return {"success": False, "error": "mode must be literal or regex."}

        default_max_results = _coerce_int(config.get("local_text_search_max_results", 100), 100, 1, 1000)
        safe_depth = _coerce_int(args.get("max_depth"), 8, 0, 64)
        safe_max_results = _coerce_int(args.get("max_results"), default_max_results, 1, 1000)
        safe_context_lines = _coerce_int(args.get("context_lines"), 0, 0, 10)
        safe_max_file_bytes = _coerce_int(args.get("max_file_bytes"), 1048576, 1024, 16 * 1024 * 1024)
        include_patterns = _normalize_string_list(args.get("include_globs"))
        extensions = _normalize_string_list(args.get("include_extensions"))
        blocked_dirs = DEFAULT_EXCLUDE_DIRS | set(_normalize_string_list(args.get("exclude_dirs")))
        flags = 0 if bool(args.get("case_sensitive", False)) else re.IGNORECASE

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
            bool(args.get("include_hidden", False)),
            include_sensitive,
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
                text = file_path.read_text(encoding=str(args.get("encoding") or "utf-8-sig"))
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


class FileSearchTreeTool(LocalTool):
    name = "local_file_search_tree"
    description = (
        "List files and directories under a configured allowed_dirs path with an explicit maximum depth. "
        "This returns metadata only and is not tied to any project workflow."
    )
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Directory path inside allowed_dirs."},
            "max_depth": {"type": "integer", "default": 3, "description": "Maximum tree depth."},
            "pattern": {"type": "string", "default": "*", "description": "Filename or relative-path glob pattern."},
            "include_files": {"type": "boolean", "default": True},
            "include_dirs": {"type": "boolean", "default": True},
            "include_hidden": {"type": "boolean", "default": False},
            "include_sensitive": {
                "type": "boolean",
                "default": False,
                "description": "Requires explicit user permission before returning suspected secret paths.",
            },
            "exclude_dirs": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Additional directory names to skip.",
            },
            "max_entries": {"type": "integer", "default": 500},
        },
        "required": ["path"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        path = str(args.get("path") or "").strip()
        include_sensitive = bool(args.get("include_sensitive", False))

        root, path_error = resolve_allowed_path(
            path,
            context=context.as_dict(),
            access="read",
            sensitive_access=include_sensitive,
        )

        if path_error:
            return build_permission_required(path, operation="read", sensitive=include_sensitive)

        if not root.exists():
            return {"success": False, "error": f"Path not found: {path}"}

        if not root.is_dir():
            return {"success": False, "error": f"Path is not a directory: {path}"}

        default_max_entries = _coerce_int(config.get("local_file_tree_max_entries", 500), 500, 1, 5000)
        safe_depth = _coerce_int(args.get("max_depth"), 3, 0, 32)
        safe_max_entries = _coerce_int(args.get("max_entries"), default_max_entries, 1, 5000)
        safe_pattern = str(args.get("pattern") or "*").strip() or "*"
        include_files = bool(args.get("include_files", True))
        include_dirs = bool(args.get("include_dirs", True))
        include_hidden = bool(args.get("include_hidden", False))
        blocked_dirs = DEFAULT_EXCLUDE_DIRS | set(_normalize_string_list(args.get("exclude_dirs")))
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
