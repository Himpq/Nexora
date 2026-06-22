"""
工具：文件操作（读取、写入、列目录）
安全策略：只允许操作 config 中 allowed_dirs 内的路径
"""

import hashlib
import os
import re
from pathlib import Path
from core.config import config

TOOL_MANIFEST = [
    {
        "name": "local_file_read",
        "handler": "file_read",
        "description": "读取用户本地计算机上指定文件的内容（NexoraCode 本地工具）。",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "文件绝对路径"},
                "encoding": {"type": "string", "default": "utf-8"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "local_file_write",
        "handler": "file_write",
        "description": "将内容写入用户本地计算机上的指定文件，会覆盖原有内容（NexoraCode 本地工具）。",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "文件绝对路径"},
                "content": {"type": "string", "description": "写入内容"},
                "encoding": {"type": "string", "default": "utf-8"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "local_file_list",
        "handler": "file_list",
        "description": "列出用户本地计算机指定目录下的文件和子目录（NexoraCode 本地工具）。",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "目录绝对路径"},
            },
            "required": ["path"],
        },
    },
]


def _check_allowed(target: Path) -> bool:
    allowed_dirs: list = config.get("allowed_dirs", [])
    if not allowed_dirs:
        # 未配置白名单：拒绝，提示用户在设置中添加
        return False
    resolved = target.resolve()
    for d in allowed_dirs:
        allowed_root = Path(d).resolve()
        try:
            resolved.relative_to(allowed_root)
            return True
        except ValueError:
            continue
    return False


def _sha256_text(content: str, encoding: str) -> str:
    return hashlib.sha256(content.encode(encoding)).hexdigest()


def _detect_line_separator(content: str) -> str:
    if "\r\n" in content:
        return "\r\n"
    return "\n"


def _write_text_atomic(path: Path, content: str, encoding: str) -> None:
    temp_path = path.with_name(f".{path.name}.nexora_patch_tmp")
    try:
        temp_path.write_text(content, encoding=encoding)
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


_HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def _parse_unified_diff(patch_text: str) -> tuple[list[dict], str]:
    hunks = []
    current = None

    for line_number, raw_line in enumerate(patch_text.splitlines(), start=1):
        hunk_match = _HUNK_RE.match(raw_line)

        if hunk_match:
            old_start = int(hunk_match.group(1))
            old_count = int(hunk_match.group(2) or "1")
            new_start = int(hunk_match.group(3))
            new_count = int(hunk_match.group(4) or "1")
            current = {
                "old_start": old_start,
                "old_count": old_count,
                "new_start": new_start,
                "new_count": new_count,
                "lines": [],
                "line_number": line_number,
            }
            hunks.append(current)
            continue

        if current is None:

            if (
                not raw_line.strip()
                or raw_line.startswith("diff ")
                or raw_line.startswith("index ")
                or raw_line.startswith("--- ")
                or raw_line.startswith("+++ ")
            ):
                continue

            return [], f"第 {line_number} 行不是支持的统一 diff 头或 hunk。"

        if raw_line.startswith((" ", "+", "-", "\\")):
            current["lines"].append(raw_line)
            continue

        return [], f"第 {line_number} 行不是有效的 hunk 内容。"

    if not hunks:
        return [], "patch 中没有找到统一 diff hunk。"

    return hunks, ""


def _apply_unified_diff(original: str, patch_text: str) -> tuple[str, dict, str]:
    hunks, parse_error = _parse_unified_diff(patch_text)

    if parse_error:
        return original, {}, parse_error

    source_lines = original.splitlines()
    result_lines = []
    source_index = 0
    added_lines = 0
    removed_lines = 0

    for hunk in hunks:
        old_start = int(hunk["old_start"])
        old_count = int(hunk["old_count"])
        old_index = old_start if old_count == 0 else old_start - 1

        if old_index < source_index:
            return original, {}, f"第 {hunk['line_number']} 行 hunk 与前一个 hunk 范围重叠。"

        if old_index > len(source_lines):
            return original, {}, f"第 {hunk['line_number']} 行 hunk 起点超出文件范围。"

        result_lines.extend(source_lines[source_index:old_index])
        source_index = old_index
        old_seen = 0
        new_seen = 0

        for raw_line in hunk["lines"]:

            if raw_line.startswith("\\"):
                continue

            marker = raw_line[:1]
            value = raw_line[1:]

            if marker == " ":

                if source_index >= len(source_lines):
                    return original, {}, f"上下文行超出文件范围: {value}"

                if source_lines[source_index] != value:
                    return original, {}, f"上下文不匹配: 期望 `{value}`，实际 `{source_lines[source_index]}`。"

                result_lines.append(source_lines[source_index])
                source_index += 1
                old_seen += 1
                new_seen += 1
                continue

            if marker == "-":

                if source_index >= len(source_lines):
                    return original, {}, f"删除行超出文件范围: {value}"

                if source_lines[source_index] != value:
                    return original, {}, f"删除行不匹配: 期望 `{value}`，实际 `{source_lines[source_index]}`。"

                source_index += 1
                old_seen += 1
                removed_lines += 1
                continue

            if marker == "+":
                result_lines.append(value)
                new_seen += 1
                added_lines += 1
                continue

            return original, {}, f"不支持的 hunk 标记: {marker}"

        if old_seen != old_count:
            return original, {}, f"第 {hunk['line_number']} 行 hunk 的旧行数不一致: 声明 {old_count}，实际 {old_seen}。"

        if new_seen != int(hunk["new_count"]):
            return original, {}, f"第 {hunk['line_number']} 行 hunk 的新行数不一致: 声明 {hunk['new_count']}，实际 {new_seen}。"

    result_lines.extend(source_lines[source_index:])
    line_separator = _detect_line_separator(original)
    new_content = line_separator.join(result_lines)

    if original.endswith(("\n", "\r")):
        new_content += line_separator

    stats = {
        "mode": "unified_diff",
        "hunk_count": len(hunks),
        "added_lines": added_lines,
        "removed_lines": removed_lines,
    }
    return new_content, stats, ""


def _find_target_occurrence(content: str, target: str, occurrence) -> tuple[int, str]:
    if not target:
        return -1, "target 不能为空。"

    positions = []
    start = 0

    while True:
        index = content.find(target, start)

        if index < 0:
            break

        positions.append(index)
        start = index + len(target)

    if not positions:
        return -1, "target 在文件中不存在。"

    if occurrence is None:

        if len(positions) != 1:
            return -1, f"target 出现 {len(positions)} 次，请传入 occurrence 指定第几处。"

        return positions[0], ""

    try:
        occurrence_index = int(occurrence)
    except Exception:
        return -1, "occurrence 必须是正整数。"

    if occurrence_index <= 0:
        return -1, "occurrence 必须是正整数。"

    if occurrence_index > len(positions):
        return -1, f"target 只出现 {len(positions)} 次，无法选择第 {occurrence_index} 处。"

    return positions[occurrence_index - 1], ""


def _apply_structured_edits(original: str, edits: list) -> tuple[str, dict, str]:
    if not isinstance(edits, list) or not edits:
        return original, {}, "edits 必须是非空数组。"

    content = original
    applied_count = 0

    for edit_index, edit in enumerate(edits, start=1):

        if not isinstance(edit, dict):
            return original, {}, f"第 {edit_index} 个 edit 必须是对象。"

        action = str(edit.get("action") or "").strip()
        target = str(edit.get("target") or "")
        occurrence = edit.get("occurrence")
        target_index, target_error = _find_target_occurrence(content, target, occurrence)

        if target_error:
            return original, {}, f"第 {edit_index} 个 edit 失败: {target_error}"

        before = content[:target_index]
        after = content[target_index + len(target):]

        if action == "replace":
            replacement = str(edit.get("replacement") or "")
            content = before + replacement + after
        elif action == "insert_before":
            insert_content = str(edit.get("content") or "")
            content = before + insert_content + target + after
        elif action == "insert_after":
            insert_content = str(edit.get("content") or "")
            content = before + target + insert_content + after
        elif action == "delete":
            content = before + after
        else:
            return original, {}, f"第 {edit_index} 个 edit 的 action 不支持: {action}"

        applied_count += 1

    stats = {
        "mode": "structured_edits",
        "edit_count": applied_count,
        "added_lines": max(0, len(content.splitlines()) - len(original.splitlines())),
        "removed_lines": max(0, len(original.splitlines()) - len(content.splitlines())),
    }
    return content, stats, ""


def file_read(path: str, encoding: str = "utf-8") -> dict:
    p = Path(path)
    if not _check_allowed(p):
        return {"error": f"Path not in allowed_dirs: {path}. Add it in NexoraCode settings."}
    if not p.exists():
        return {"error": f"File not found: {path}"}
    if not p.is_file():
        return {"error": f"Not a file: {path}"}
    try:
        content = p.read_text(encoding=encoding)
        return {"content": content, "size": p.stat().st_size}
    except Exception as e:
        return {"error": str(e)}


def file_write(path: str, content: str, encoding: str = "utf-8") -> dict:
    p = Path(path)
    if not _check_allowed(p):
        return {"error": f"Path not in allowed_dirs: {path}. Add it in NexoraCode settings."}
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding=encoding)
        return {"success": True, "bytes_written": len(content.encode(encoding))}
    except Exception as e:
        return {"error": str(e)}


def file_patch(
    path: str,
    patch: str = "",
    edits: list = None,
    encoding: str = "utf-8",
    expected_sha256: str = "",
) -> dict:
    """对单个文件执行精确 patch，支持统一 diff 或结构化编辑。"""
    p = Path(path)

    if not _check_allowed(p):
        return {"error": f"Path not in allowed_dirs: {path}. Add it in NexoraCode settings."}

    if not p.exists():
        return {"error": f"File not found: {path}"}

    if not p.is_file():
        return {"error": f"Not a file: {path}"}

    patch_text = str(patch or "")
    has_patch = bool(patch_text.strip())
    has_edits = isinstance(edits, list) and len(edits) > 0

    if has_patch == has_edits:
        return {"error": "必须且只能提供 patch 或 edits 其中一种输入。"}

    try:
        original = p.read_text(encoding=encoding)
        old_sha256 = _sha256_text(original, encoding)

        if expected_sha256 and str(expected_sha256).strip().lower() != old_sha256:
            return {
                "error": "文件内容 SHA256 与 expected_sha256 不一致，已拒绝修改。",
                "actual_sha256": old_sha256,
            }

        if has_patch:
            new_content, stats, apply_error = _apply_unified_diff(original, patch_text)
        else:
            new_content, stats, apply_error = _apply_structured_edits(original, edits)

        if apply_error:
            return {"error": apply_error, "old_sha256": old_sha256}

        if new_content == original:
            return {
                "success": True,
                "changed": False,
                "path": str(p),
                "encoding": encoding,
                "old_sha256": old_sha256,
                "new_sha256": old_sha256,
                **stats,
            }

        _write_text_atomic(p, new_content, encoding)
        new_sha256 = _sha256_text(new_content, encoding)

        return {
            "success": True,
            "changed": True,
            "path": str(p),
            "encoding": encoding,
            "old_sha256": old_sha256,
            "new_sha256": new_sha256,
            "bytes_written": len(new_content.encode(encoding)),
            **stats,
        }
    except Exception as e:
        return {"error": str(e)}


def file_list(path: str) -> dict:
    p = Path(path)
    if not _check_allowed(p):
        return {"error": f"Path not in allowed_dirs: {path}. Add it in NexoraCode settings."}
    if not p.is_dir():
        return {"error": f"Not a directory: {path}"}
    try:
        entries = []
        for item in sorted(p.iterdir()):
            entries.append({
                "name": item.name,
                "type": "dir" if item.is_dir() else "file",
                "size": item.stat().st_size if item.is_file() else None,
            })
        return {"entries": entries, "count": len(entries)}
    except Exception as e:
        return {"error": str(e)}
