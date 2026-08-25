"""
NexoraCode.model.Present — 工具结果 Markdown 呈现

把本地工具返回的结构化 dict（目录列表 / 代码扫描 / 文件读取 / 文件修改 / 搜索匹配 / 命令输出）
渲染为简洁的 Markdown 文本喂给模型，替代整段 JSON dump（opencode 风格）。

输出格式与云端 ToolResultPresenter 对齐（## 标题 + - Field: 值），
前端 tool-usage 卡片据此解析标题 / File / Lines / Mode 等字段做折叠与 diff 统计展示。

对外提供：
- present_tool_result(detail): 任意工具结果 → Markdown 文本
"""

from __future__ import annotations

import os
from typing import Any


# code_scan 符号地图单次呈现的符号行上限，超出部分折叠为省略提示。
CODE_SCAN_SYMBOL_LINE_LIMIT = 800
# file_read 正文单次呈现上限（与云端 Presenter._fenced_text limit 一致）。
FILE_READ_CONTENT_LIMIT = 12000
# patch diff 呈现上限。
PATCH_DIFF_LIMIT = 12000


def present_tool_result(detail: Any) -> str:
    """把工具结果转成简洁 Markdown；未知结构回退为精简字段渲染。"""
    if isinstance(detail, str):
        return detail

    if detail is None:
        return ""

    if not isinstance(detail, dict):
        return _compact_scalar(detail)

    entries = detail.get("entries")

    if isinstance(entries, list):
        return _present_entries(entries)

    # code_scan 的 files 是「文件 → 符号列表」结构；非空列表要求首项带 symbols 才判定，
    # 空列表靠 scanned_files/root 字段识别，避免误伤其他恰好返回 files 字段的工具。
    files = detail.get("files")
    is_code_scan = isinstance(files, list) and (
        (
            bool(files)
            and isinstance(files[0], dict)
            and isinstance(files[0].get("symbols"), list)
        )
        or (
            not files
            and ("scanned_files" in detail or "root" in detail)
        )
    )

    if is_code_scan:
        return _present_code_scan(files, detail)

    matches = detail.get("matches")

    if isinstance(matches, list):
        return _present_matches(matches, detail)

    # 文件读取 / 文件修改走云端同款结构化呈现（前端依赖 ## 标题与 - Field 解析）。
    if _is_file_read_detail(detail):
        return _present_file_read(detail)

    if _is_file_patch_detail(detail):
        return _present_file_patch(detail)

    if _is_file_probe_detail(detail):
        return _present_file_probe(detail)

    # 命令执行走云端同款结构（前端按 ## Shell Command 标题解析 exit/command 摘要）。
    if detail.get("stdout") is not None or detail.get("stderr") is not None or detail.get("returncode") is not None:
        return _present_shell_exec(detail)

    return _present_fields(detail)


def _is_file_read_detail(detail: dict) -> bool:
    """file_read 判定：带 content + 文件元信息（sha256 / total_chars / mode 至少其一）。"""
    content = detail.get("content")

    if not isinstance(content, str):
        return False

    return bool(
        detail.get("sha256")
        or detail.get("total_chars") is not None
        or detail.get("mode")
        or detail.get("path")
    )


def _is_file_patch_detail(detail: dict) -> bool:
    """file_patch 判定：带 patch / edits 或 preview_id / confirm_preview_id 相关字段。"""
    return bool(
        detail.get("preview_id")
        or detail.get("confirmed_preview_id")
        or detail.get("requires_confirm") is not None
        or detail.get("dry_run") is not None
        or detail.get("changed") is not None
        or detail.get("old_sha256")
        or detail.get("new_sha256")
        or detail.get("diff") is not None
    )


def _is_file_probe_detail(detail: dict) -> bool:
    """file_probe 判定：带 readable/writable + 文件元信息，无 content。"""
    return bool(
        detail.get("readable") is not None
        and detail.get("writable") is not None
        and detail.get("path")
    )


def _language_for_path(path: Any) -> str:
    ext = os.path.splitext(str(path or ""))[1].lower()
    mapping = {
        ".py": "python",
        ".js": "javascript",
        ".jsx": "jsx",
        ".ts": "typescript",
        ".tsx": "tsx",
        ".json": "json",
        ".md": "markdown",
        ".html": "html",
        ".css": "css",
        ".xml": "xml",
        ".yaml": "yaml",
        ".yml": "yaml",
        ".toml": "toml",
        ".ps1": "powershell",
        ".sh": "bash",
        ".bat": "bat",
        ".sql": "sql",
    }
    return mapping.get(ext, "text")


def _clip(text: Any, limit: int = 12000) -> str:
    value = str(text or "")

    if len(value) <= limit:
        return value

    head = max(0, int(limit * 0.65))
    tail = max(0, limit - head)
    omitted = len(value) - head - tail

    return (
        value[:head]
        + f"\n\n...[omitted {omitted} chars]...\n\n"
        + value[-tail:]
    )


def _fenced_text(text: Any, language: str = "text", limit: int = 12000) -> str:
    content = _clip(text, limit=limit)
    fence = "```"

    if "```" in content:
        fence = "````"

    lang = str(language or "text").strip()
    return f"{fence}{lang}\n{content}\n{fence}"


def _short_hash(value: Any) -> str:
    text = str(value or "").strip()

    if len(text) <= 16:
        return text

    return f"{text[:12]}...{text[-8:]}"


def _as_bool_text(value: Any) -> str:
    return "yes" if bool(value) else "no"


def _extract_file_label(detail: dict) -> str:
    return str(detail.get("path") or detail.get("file") or "(unknown)")


def _present_file_read(detail: dict) -> str:
    """云端 _render_file_read 同款：标题 + 元信息 + 截断正文，前端据此解析。"""
    success = detail.get("success", True) is not False and not detail.get("error")
    file_label = _extract_file_label(detail)
    lines = [
        "## File Read" if success else "## File Read Failed",
        "",
        f"- File: `{file_label}`",
    ]

    if detail.get("mode"):
        lines.append(f"- Mode: `{detail.get('mode')}`")

    if detail.get("sha256"):
        lines.append(f"- SHA256: `{str(detail.get('sha256') or '').strip()}`")

    if detail.get("size") is not None:
        lines.append(f"- Size: {detail.get('size')} bytes")

    if detail.get("total_chars") is not None:
        lines.append(f"- Total Chars: {detail.get('total_chars')}")

    if detail.get("returned_chars") is not None:
        lines.append(f"- Returned Chars: {detail.get('returned_chars')}")

    if detail.get("returned_line_count") is not None:
        lines.append(f"- Returned Lines: {detail.get('returned_line_count')}")

    slice_obj = detail.get("slice") if isinstance(detail.get("slice"), dict) else {}

    if slice_obj:
        slice_bits = [f"{key}={value}" for key, value in slice_obj.items()]
        lines.append(f"- Slice: {', '.join(slice_bits)}")

    if "truncated" in detail:
        lines.append(f"- Truncated: {_as_bool_text(detail.get('truncated'))}")

    if not success:
        lines.extend(["", f"- Reason: {detail.get('message') or detail.get('error') or 'unknown error'}"])
        return "\n".join(lines).strip()

    lines.extend([
        "",
        "### Content",
        "",
        _fenced_text(detail.get("content", ""), language=_language_for_path(file_label), limit=FILE_READ_CONTENT_LIMIT),
    ])
    return "\n".join(lines).strip()


def _present_file_patch(detail: dict) -> str:
    """云端 _render_file_patch 同款：标题 + 元信息 + diff，前端据此渲染修改统计。"""
    success = detail.get("success", True) is not False and not detail.get("error")
    changed = bool(detail.get("changed", False))
    file_label = str(detail.get("path") or detail.get("file") or "(unknown)")
    success_title = "## File Patch Preview" if detail.get("dry_run") else "## File Modified Success"
    lines = [
        success_title if success else "## File Modify Failed",
        "",
        f"- File: `{file_label}`",
        f"- Changed: {_as_bool_text(changed)}",
    ]

    if detail.get("dry_run") is not None:
        lines.append(f"- Dry Run: {_as_bool_text(detail.get('dry_run'))}")

    if detail.get("requires_confirm") is not None:
        lines.append(f"- Requires Confirm: {_as_bool_text(detail.get('requires_confirm'))}")

    if detail.get("preview_id"):
        lines.append(f"- Preview ID: `{detail.get('preview_id')}`")

    if detail.get("confirmed_preview_id"):
        lines.append(f"- Confirmed Preview ID: `{detail.get('confirmed_preview_id')}`")

    if detail.get("mode"):
        lines.append(f"- Mode: `{detail.get('mode')}`")

    if detail.get("edit_count") is not None:
        lines.append(f"- Edits: {detail.get('edit_count')}")

    if detail.get("hunk_count") is not None:
        lines.append(f"- Hunks: {detail.get('hunk_count')}")

    if not detail.get("dry_run") and (
        detail.get("added_lines") is not None or detail.get("removed_lines") is not None
    ):
        lines.append(f"- Lines: +{detail.get('added_lines', 0)} / -{detail.get('removed_lines', 0)}")

    if detail.get("old_sha256") or detail.get("new_sha256"):
        lines.append(
            f"- SHA256: `{_short_hash(detail.get('old_sha256'))}` -> `{_short_hash(detail.get('new_sha256'))}`"
        )

    if not success:
        lines.extend(["", f"- Reason: {detail.get('error') or detail.get('message') or 'unknown error'}"])
        return "\n".join(lines).strip()

    diff_text = detail.get("diff")

    if isinstance(diff_text, str) and diff_text.strip():
        lines.extend([
            "",
            "### Result Diff",
            "",
            _fenced_text(diff_text, language="diff", limit=PATCH_DIFF_LIMIT),
        ])

    return "\n".join(lines).strip()


def _present_file_probe(detail: dict) -> str:
    """云端 _render_local_file_probe 同款：探测文件元信息。"""
    success = detail.get("success", True) is not False and not detail.get("error")
    file_label = str(detail.get("path") or "(unknown)")
    lines = [
        "## Local File Probe" if success else "## Local File Probe Failed",
        "",
        f"- File: `{file_label}`",
    ]

    if detail.get("readable") is not None:
        lines.append(f"- Readable: {_as_bool_text(detail.get('readable'))}")

    if detail.get("writable") is not None:
        lines.append(f"- Writable: {_as_bool_text(detail.get('writable'))}")

    if detail.get("size") is not None:
        lines.append(f"- Size: {detail.get('size')} bytes")

    encoding_hint = detail.get("encoding_hint")

    if encoding_hint:
        lines.append(f"- Encoding Hint: `{encoding_hint}`")

    if detail.get("bom") is not None:
        lines.append(f"- BOM: `{detail.get('bom') or ''}`")

    if detail.get("line_separator"):
        lines.append(f"- Line Separator: `{detail.get('line_separator')}`")

    if detail.get("has_trailing_newline") is not None:
        lines.append(f"- Trailing Newline: {_as_bool_text(detail.get('has_trailing_newline'))}")

    if detail.get("sha256"):
        lines.append(f"- SHA256: `{str(detail.get('sha256') or '').strip()}`")

    if not success:
        lines.extend(["", f"- Reason: {detail.get('message') or detail.get('error') or 'unknown error'}"])
        return "\n".join(lines).strip()

    return "\n".join(lines).strip()


def _present_shell_exec(detail: dict) -> str:
    """云端 _render_shell_exec 同款：标题 + Command/Exit Code + STDOUT/STDERR。"""
    has_error = bool(detail.get("error"))
    returncode = detail.get("returncode")
    success = (not has_error) and (returncode in (0, "0", None))
    lines = [
        "## Shell Command Completed" if success else "## Shell Command Failed",
        "",
    ]

    if detail.get("command"):
        lines.append(f"- Command: `{detail.get('command')}`")

    if detail.get("cwd"):
        lines.append(f"- CWD: `{detail.get('cwd')}`")

    if returncode is not None:
        lines.append(f"- Exit Code: `{returncode}`")

    if has_error:
        lines.extend(["", f"- Reason: {detail.get('error')}"])

    stdout = str(detail.get("stdout") or "")
    stderr = str(detail.get("stderr") or "")

    if stdout:
        lines.extend([
            "",
            "### STDOUT",
            "",
            _fenced_text(stdout, language="text", limit=8000),
        ])

    if stderr:
        lines.extend([
            "",
            "### STDERR",
            "",
            _fenced_text(stderr, language="text", limit=8000),
        ])

    return "\n".join(lines).strip()


def _present_entries(entries: list) -> str:
    lines = []

    for item in entries:
        if not isinstance(item, dict):
            lines.append(f"- {item}")
            continue

        name = str(item.get("name") or "").strip()
        is_dir = str(item.get("type") or "").strip() == "dir"
        size = item.get("size")
        size_text = f" ({size} B)" if isinstance(size, (int, float)) else ""
        lines.append(f"[dir]  {name}" if is_dir else f"- {name}{size_text}")

    return "\n".join(lines) if lines else "(空目录)"


def _present_code_scan(files: list, detail: dict) -> str:
    """把 local_code_scan 的符号地图渲染为紧凑 Markdown，替代被丢弃的 files 列表。

    输出结构：每个文件一行标题（相对路径 + 语言），下面每行一个符号：
        `type name (line)`，如 `function  _clamp (line 45)`、`method  Class.method (line 12)`。
    符号行超过 CODE_SCAN_SYMBOL_LINE_LIMIT 时折叠为省略提示，避免撑爆上下文。
    """

    root = str(detail.get("root") or "").strip()
    scanned_files = detail.get("scanned_files")
    total_symbols = detail.get("total_symbols")
    truncated = bool(detail.get("truncated"))

    header = ["## Code Scan Map"]

    if root:
        header.append(f"- Root: `{root}`")

    meta_parts = []
    if isinstance(scanned_files, int):
        meta_parts.append(f"Files: {scanned_files}")

    if isinstance(total_symbols, int):
        meta_parts.append(f"Symbols: {total_symbols}")

    if truncated:
        meta_parts.append("Truncated: yes")

    if meta_parts:
        header.append(f"- {' | '.join(meta_parts)}")

    lines: list[str] = []
    shown = 0
    folded_files = 0

    for entry in files:
        if not isinstance(entry, dict):
            continue

        symbols = entry.get("symbols")

        if not isinstance(symbols, list) or not symbols:
            continue

        relative = str(entry.get("file") or "").strip()
        language = str(entry.get("language") or "").strip()
        lines.append("")
        lines.append(f"**{relative}**" + (f" [{language}]" if language else ""))

        for symbol in symbols:
            if not isinstance(symbol, dict):
                continue

            if shown >= CODE_SCAN_SYMBOL_LINE_LIMIT:
                folded_files += 1
                continue

            symbol_type = str(symbol.get("type") or "").strip()
            symbol_name = str(symbol.get("name") or "").strip()
            line_no = symbol.get("line")
            label = symbol_name

            if symbol_type:
                label = f"{symbol_type}  {label}"

            if isinstance(line_no, (int, float)):
                label = f"{label} (line {int(line_no)})"

            lines.append(f"- {label}")
            shown += 1

    if not lines:
        return "\n".join(header) + "\n\n(无符号)"

    if folded_files:
        lines.extend([
            "",
            f"... 剩余 {folded_files} 个符号未显示，请用 local_file_read 按行号分段精读目标位置。",
        ])

    return "\n".join(header + lines)


def _present_matches(matches: list, detail: dict) -> str:
    lines = []

    for match in matches:
        if not isinstance(match, dict):
            lines.append(f"- {match}")
            continue

        path = str(match.get("path") or match.get("file") or "").strip()
        line_number = match.get("line_number") or match.get("line")
        line_text = str(match.get("line") or match.get("line_text") or match.get("text") or "").strip()
        prefix = ""

        if path or line_number:
            prefix = f"{path}:{line_number}"

        if prefix:
            lines.append(f"{prefix}  {line_text}" if line_text else prefix)
        else:
            lines.append(line_text or "-")

    result = "\n".join(lines) if lines else "(无匹配)"

    query = str(detail.get("query") or "").strip()
    match_count = detail.get("match_count")

    if query and isinstance(match_count, int):
        result = f"query={query} match_count={match_count}\n\n{result}"

    return result


def _present_fields(detail: dict) -> str:
    parts = []

    for key, value in detail.items():
        if value is None:
            continue

        # 跳过嵌套结构，避免整段 JSON；上层已有 entries/matches/content/stdout 分支覆盖。
        if isinstance(value, (dict, list)):
            continue

        parts.append(f"{key}: {value}")

    if parts:
        return "\n".join(parts)

    return _compact_scalar(detail)


def _compact_scalar(value: Any) -> str:
    text = str(value)
    limit = 1000

    if len(text) <= limit:
        return text

    return f"{text[:limit]}...(共 {len(text)} 字符，已截断)"
