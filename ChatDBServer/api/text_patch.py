import difflib
import re
from typing import Any, Dict, List, Tuple


_HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def _detect_line_separator(text: str) -> str:
    if "\r\n" in text:
        return "\r\n"

    if "\r" in text:
        return "\r"

    return "\n"


def line_separator_name(text: str) -> str:
    sep = _detect_line_separator(text)

    if sep == "\r\n":
        return "crlf"

    if sep == "\r":
        return "cr"

    return "lf"


def build_preview_diff(label: str, original: str, new_content: str) -> str:
    if original == new_content:
        return ""

    safe_label = str(label or "content").strip() or "content"

    return "".join(difflib.unified_diff(
        str(original or "").splitlines(keepends=True),
        str(new_content or "").splitlines(keepends=True),
        fromfile=f"a/{safe_label}",
        tofile=f"b/{safe_label}",
    ))


def parse_unified_diff(patch_text: str) -> Tuple[List[Dict[str, Any]], str]:
    hunks: List[Dict[str, Any]] = []
    current = None

    for line_number, raw_line in enumerate(str(patch_text or "").splitlines(), start=1):
        hunk_match = _HUNK_RE.match(raw_line)

        if hunk_match:
            current = {
                "old_start": int(hunk_match.group(1)),
                "old_count": int(hunk_match.group(2) or "1"),
                "new_start": int(hunk_match.group(3)),
                "new_count": int(hunk_match.group(4) or "1"),
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


def apply_unified_diff(original: str, patch_text: str) -> Tuple[str, Dict[str, Any], str]:
    source = str(original or "")
    hunks, parse_error = parse_unified_diff(str(patch_text or ""))

    if parse_error:
        return source, {}, parse_error

    source_lines = source.splitlines()
    result_lines: List[str] = []
    source_index = 0
    added_lines = 0
    removed_lines = 0

    for hunk in hunks:
        old_start = int(hunk["old_start"])
        old_count = int(hunk["old_count"])
        old_index = old_start if old_count == 0 else old_start - 1

        if old_index < source_index:
            return source, {}, f"第 {hunk['line_number']} 行 hunk 与前一个 hunk 范围重叠。"

        if old_index > len(source_lines):
            return source, {}, f"第 {hunk['line_number']} 行 hunk 起点超出内容范围。"

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
                    return source, {}, f"上下文行超出内容范围: {value}"

                if source_lines[source_index] != value:
                    return source, {}, f"上下文不匹配: 期望 `{value}`，实际 `{source_lines[source_index]}`。"

                result_lines.append(source_lines[source_index])
                source_index += 1
                old_seen += 1
                new_seen += 1
                continue

            if marker == "-":
                if source_index >= len(source_lines):
                    return source, {}, f"删除行超出内容范围: {value}"

                if source_lines[source_index] != value:
                    return source, {}, f"删除行不匹配: 期望 `{value}`，实际 `{source_lines[source_index]}`。"

                source_index += 1
                old_seen += 1
                removed_lines += 1
                continue

            if marker == "+":
                result_lines.append(value)
                new_seen += 1
                added_lines += 1
                continue

            return source, {}, f"不支持的 hunk 标记: {marker}"

        if old_seen != old_count:
            return source, {}, f"第 {hunk['line_number']} 行 hunk 的旧行数不一致: 声明 {old_count}，实际 {old_seen}。"

        if new_seen != int(hunk["new_count"]):
            return source, {}, f"第 {hunk['line_number']} 行 hunk 的新行数不一致: 声明 {hunk['new_count']}，实际 {new_seen}。"

    result_lines.extend(source_lines[source_index:])
    line_separator = _detect_line_separator(source)
    new_content = line_separator.join(result_lines)

    if source.endswith(("\n", "\r")):
        new_content += line_separator

    return new_content, {
        "mode": "unified_diff",
        "hunk_count": len(hunks),
        "added_lines": added_lines,
        "removed_lines": removed_lines,
    }, ""


def _find_target_occurrence(content: str, target: str, occurrence: Any) -> Tuple[int, str]:
    if not target:
        return -1, "target 不能为空。"

    positions: List[int] = []
    start = 0

    while True:
        index = content.find(target, start)

        if index < 0:
            break

        positions.append(index)
        start = index + len(target)

    if not positions:
        return -1, "target 在内容中不存在。"

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


def apply_structured_edits(original: str, edits: Any) -> Tuple[str, Dict[str, Any], str]:
    if not isinstance(edits, list) or not edits:
        return str(original or ""), {}, "edits 必须是非空数组。"

    source = str(original or "")
    content = source
    applied_count = 0

    for edit_index, edit in enumerate(edits, start=1):
        if not isinstance(edit, dict):
            return source, {}, f"第 {edit_index} 个 edit 必须是对象。"

        action = str(edit.get("action") or "").strip()
        target = str(edit.get("target") or "")
        occurrence = edit.get("occurrence")
        target_index, target_error = _find_target_occurrence(content, target, occurrence)

        if target_error:
            return source, {}, f"第 {edit_index} 个 edit 失败: {target_error}"

        before = content[:target_index]
        after = content[target_index + len(target):]

        if action == "replace":
            content = before + str(edit.get("replacement") or "") + after
        elif action == "insert_before":
            content = before + str(edit.get("content") or "") + target + after
        elif action == "insert_after":
            content = before + target + str(edit.get("content") or "") + after
        elif action == "delete":
            content = before + after
        else:
            return source, {}, f"第 {edit_index} 个 edit 的 action 不支持: {action}"

        applied_count += 1

    return content, {
        "mode": "structured_edits",
        "edit_count": applied_count,
        "added_lines": max(0, len(content.splitlines()) - len(source.splitlines())),
        "removed_lines": max(0, len(source.splitlines()) - len(content.splitlines())),
    }, ""


def apply_text_patch(original: str, patch_text: str = "", edits: Any = None) -> Tuple[str, Dict[str, Any], str]:
    has_patch = bool(str(patch_text or "").strip())
    has_edits = isinstance(edits, list) and len(edits) > 0

    if has_patch == has_edits:
        return str(original or ""), {}, "必须且只能提供 patch 或 edits 其中一种输入。"

    if has_patch:
        return apply_unified_diff(str(original or ""), str(patch_text or ""))

    return apply_structured_edits(str(original or ""), edits)


def apply_range_replacements(
    original: str,
    from_pos: Any = None,
    to_pos: Any = None,
    replacement: Any = None,
    replacements: Any = None
) -> Tuple[str, Dict[str, Any], str]:
    source = str(original or "")
    ops = []

    try:
        if isinstance(replacements, list) and replacements:
            for item in replacements:
                if not isinstance(item, dict):
                    return source, {}, "replacements 必须是对象数组。"

                start = item.get("from_pos")
                end = item.get("to_pos")

                if start is None or end is None:
                    return source, {}, "每个 replacement 都必须提供 from_pos 和 to_pos。"

                ops.append((int(start), int(end), str(item.get("replacement", ""))))
        else:
            start = 0 if from_pos is None else int(from_pos)
            end = len(source) if to_pos is None else int(to_pos)
            ops.append((start, end, "" if replacement is None else str(replacement)))
    except Exception as exc:
        return source, {}, f"区间参数必须是整数: {exc}"

    content = source

    for start, end, rep in sorted(ops, key=lambda x: x[0], reverse=True):
        if start < 0 or end < 0:
            return source, {}, "range index cannot be negative"

        if start > end:
            start, end = end, start

        if end > len(content):
            return source, {}, f"range out of bounds: ({start}, {end}) > {len(content)}"

        content = content[:start] + rep + content[end:]

    return content, {
        "mode": "range_replacements",
        "edit_count": len(ops),
        "added_lines": max(0, len(content.splitlines()) - len(source.splitlines())),
        "removed_lines": max(0, len(source.splitlines()) - len(content.splitlines())),
    }, ""
