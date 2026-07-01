import difflib
import re
import unicodedata
from typing import Any, Dict, List, Tuple


_HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")
_NO_BREAK_SPACE = chr(0x00a0)
_ZERO_WIDTH_SPACE = chr(0x200b)
_BYTE_ORDER_MARK = chr(0xfeff)


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
                    return source, {}, f"第 {hunk['line_number']} 行 hunk 上下文行超出内容范围: {value}"

                if source_lines[source_index] != value:
                    return source, {}, _format_diff_mismatch_error(
                        hunk["line_number"],
                        source,
                        source_lines,
                        source_index,
                        value,
                        source_lines[source_index],
                        "上下文行",
                    )

                result_lines.append(source_lines[source_index])
                source_index += 1
                old_seen += 1
                new_seen += 1
                continue

            if marker == "-":
                if source_index >= len(source_lines):
                    return source, {}, f"第 {hunk['line_number']} 行 hunk 删除行超出内容范围: {value}"

                if source_lines[source_index] != value:
                    return source, {}, _format_diff_mismatch_error(
                        hunk["line_number"],
                        source,
                        source_lines,
                        source_index,
                        value,
                        source_lines[source_index],
                        "删除行",
                    )

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


def _collect_text_positions(content: str, target: str) -> List[int]:
    positions: List[int] = []
    start = 0

    while True:
        index = content.find(target, start)

        if index < 0:
            break

        positions.append(index)
        start = index + len(target)

    return positions


def _select_occurrence_position(positions: List[int], occurrence: Any, target_name: str) -> Tuple[int, str]:
    if not positions:
        return -1, f"{target_name} 在内容中不存在。"

    if occurrence is None:
        if len(positions) != 1:
            return -1, f"{target_name} 出现 {len(positions)} 次，请传入 occurrence 指定第几处。"

        return positions[0], ""

    try:
        occurrence_index = int(occurrence)
    except Exception:
        return -1, "occurrence 必须是正整数。"

    if occurrence_index <= 0:
        return -1, "occurrence 必须是正整数。"

    if occurrence_index > len(positions):
        return -1, f"{target_name} 只出现 {len(positions)} 次，无法选择第 {occurrence_index} 处。"

    return positions[occurrence_index - 1], ""


def _line_col_for_offset(content: str, offset: int) -> Tuple[int, int]:
    safe_offset = max(0, min(int(offset), len(content)))
    line = content.count("\n", 0, safe_offset) + 1
    line_start = content.rfind("\n", 0, safe_offset)

    if line_start < 0:
        return line, safe_offset + 1

    return line, safe_offset - line_start


def _line_offsets(content: str) -> List[Tuple[int, int, str]]:
    offsets: List[Tuple[int, int, str]] = []
    start = 0

    for raw_line in str(content or "").splitlines(keepends=True):
        line_body = raw_line.rstrip("\r\n")
        end = start + len(line_body)
        offsets.append((start, end, line_body))
        start += len(raw_line)

    if not offsets and content == "":
        offsets.append((0, 0, ""))

    return offsets


def _normalize_width(content: str) -> str:
    return unicodedata.normalize("NFKC", str(content or ""))


def _is_space_like(char: str) -> bool:
    return bool(char) and (char.isspace() or char == _NO_BREAK_SPACE)


def _is_ignored_noise_char(char: str) -> bool:
    return bool(char) and char in {_ZERO_WIDTH_SPACE, _BYTE_ORDER_MARK}


def _normalize_anchor_line(content: str) -> str:
    normalized = _normalize_width(content)
    normalized = normalized.replace(_ZERO_WIDTH_SPACE, "").replace(_BYTE_ORDER_MARK, "")
    normalized = re.sub(r"[^\S\r\n]+", " ", normalized)
    return normalized.strip()


def _looks_like_line_anchor(target: str) -> bool:
    stripped = str(target or "").strip()

    if not stripped or "\n" in stripped or "\r" in stripped:
        return False

    return stripped.startswith("#") or stripped.startswith("<!--")


def _find_line_anchor_occurrences(content: str, target: str) -> List[Tuple[int, int]]:
    normalized_target = _normalize_anchor_line(target)

    if not normalized_target:
        return []

    positions: List[Tuple[int, int]] = []

    for start, end, line_body in _line_offsets(content):
        if _normalize_anchor_line(line_body) == normalized_target:
            positions.append((start, end))

    return positions


def _normalize_markdown_noise_with_offsets(content: str) -> Tuple[str, List[int], List[int]]:
    """Build a searchable copy while preserving offsets back to the original text."""
    normalized_chars: List[str] = []
    start_offsets: List[int] = []
    end_offsets: List[int] = []
    index = 0
    pending_space_start = -1
    pending_space_end = -1

    def flush_pending_space() -> None:
        nonlocal pending_space_start, pending_space_end

        if pending_space_start < 0:
            return

        if normalized_chars:
            normalized_chars.append(" ")
            start_offsets.append(pending_space_start)
            end_offsets.append(pending_space_end)

        pending_space_start = -1
        pending_space_end = -1

    while index < len(content):
        char = content[index]
        raw_end = index + 1

        if char == "\r" and index + 1 < len(content) and content[index + 1] == "\n":
            raw_end = index + 2

        if _is_ignored_noise_char(char):
            index = raw_end
            continue

        if _is_space_like(char):
            if pending_space_start < 0:
                pending_space_start = index

            pending_space_end = raw_end
            index = raw_end
            continue

        normalized_piece = _normalize_width(char)

        for piece_char in normalized_piece:
            if _is_ignored_noise_char(piece_char):
                continue

            if _is_space_like(piece_char):
                if pending_space_start < 0:
                    pending_space_start = index

                pending_space_end = raw_end
                continue

            flush_pending_space()
            normalized_chars.append(piece_char)
            start_offsets.append(index)
            end_offsets.append(raw_end)

        index = raw_end

    return "".join(normalized_chars), start_offsets, end_offsets


def _collect_span_positions(content: str, target: str) -> List[Tuple[int, int]]:
    normalized_content, start_offsets, end_offsets = _normalize_markdown_noise_with_offsets(content)
    normalized_target, _target_start_offsets, _target_end_offsets = _normalize_markdown_noise_with_offsets(target)
    normalized_target = normalized_target.strip()

    if not normalized_target:
        return []

    positions: List[Tuple[int, int]] = []
    start = 0

    while True:
        index = normalized_content.find(normalized_target, start)

        if index < 0:
            break

        normalized_end_index = index + len(normalized_target) - 1

        if index < len(start_offsets) and normalized_end_index < len(end_offsets):
            positions.append((start_offsets[index], end_offsets[normalized_end_index]))

        start = index + len(normalized_target)

    return positions


def _select_occurrence_span(
    positions: List[Tuple[int, int]],
    occurrence: Any,
    target_name: str,
) -> Tuple[int, int, str]:
    starts = [item[0] for item in positions]
    selected_start, error = _select_occurrence_position(starts, occurrence, target_name)

    if error:
        return -1, -1, error

    for start, end in positions:
        if start == selected_start:
            return start, end, ""

    return -1, -1, f"{target_name} 在内容中不存在。"


def _preview_text(content: str, max_chars: int = 180) -> str:
    text = str(content or "").replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\n", "\\n")

    if len(text) <= max_chars:
        return text

    return text[:max_chars] + "..."


def _nearest_line_hint(content: str, target: str) -> str:
    """Return the closest line window to help users repair a failed target."""
    normalized_target = _normalize_markdown_noise_with_offsets(target)[0].strip()

    if not normalized_target:
        return ""

    target_lines = str(target or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    window_size = max(1, min(8, len([line for line in target_lines if line.strip()])))
    lines = _line_offsets(content)
    best_ratio = 0.0
    best_line = 0
    best_snippet = ""

    for index in range(0, len(lines)):
        window = lines[index:index + window_size]

        if not window:
            continue

        snippet = "\n".join(item[2] for item in window)
        normalized_snippet = _normalize_markdown_noise_with_offsets(snippet)[0].strip()

        if not normalized_snippet:
            continue

        ratio = difflib.SequenceMatcher(None, normalized_target, normalized_snippet).ratio()

        if ratio > best_ratio:
            best_ratio = ratio
            best_line = index + 1
            best_snippet = snippet

    if best_line <= 0:
        return ""

    return f" 最接近位置：第 {best_line} 行附近，相似度 {best_ratio:.2f}，候选片段 `{_preview_text(best_snippet)}`。"


def _target_not_found_error(content: str, target: str) -> str:
    target_preview = _preview_text(target)
    hint = _nearest_line_hint(content, target)

    return f"target 在内容中不存在。target 片段 `{target_preview}`。{hint}".strip()


def _format_diff_mismatch_error(
    hunk_line_number: Any,
    source: str,
    source_lines: List[str],
    source_index: int,
    expected: str,
    actual: str,
    label: str,
) -> str:
    """Explain unified diff mismatches with source line and nearby candidate details."""
    source_line = source_index + 1
    hint = ""

    for index, line in enumerate(source_lines, start=1):
        if line == expected:
            hint = f" 期望行在当前内容第 {index} 行也出现过，请检查 hunk 起点或上下文。"
            break

    if not hint:
        hint = _nearest_line_hint(source, expected)

    return (
        f"第 {hunk_line_number} 行 hunk {label}不匹配："
        f"源内容第 {source_line} 行期望 `{_preview_text(expected)}`，"
        f"实际 `{_preview_text(actual)}`。{hint}"
    )


def _normalize_newlines_with_offsets(content: str) -> Tuple[str, List[int], List[int]]:
    normalized_chars: List[str] = []
    start_offsets: List[int] = []
    end_offsets: List[int] = []
    index = 0

    while index < len(content):
        char = content[index]

        if char == "\r":
            if index + 1 < len(content) and content[index + 1] == "\n":
                normalized_chars.append("\n")
                start_offsets.append(index)
                end_offsets.append(index + 2)
                index += 2
                continue

            normalized_chars.append("\n")
            start_offsets.append(index)
            end_offsets.append(index + 1)
            index += 1
            continue

        normalized_chars.append(char)
        start_offsets.append(index)
        end_offsets.append(index + 1)
        index += 1

    return "".join(normalized_chars), start_offsets, end_offsets


def _normalize_text_line_separator(content: str, line_separator: str) -> str:
    return re.sub(r"\r\n|\r|\n", line_separator, content)


def _find_target_occurrence(content: str, target: str, occurrence: Any) -> Tuple[int, int, Dict[str, Any], str]:
    """Find one edit target through deterministic exact, anchor, newline, then Markdown-noise matching."""
    if not target:
        return -1, -1, {}, "target 不能为空。"

    positions = _collect_text_positions(content, target)

    if positions:
        target_index, target_error = _select_occurrence_position(positions, occurrence, "target")

        if target_error:
            return -1, -1, {}, target_error

        return target_index, target_index + len(target), {"match_strategy": "exact"}, ""

    if _looks_like_line_anchor(target):
        anchor_positions = _find_line_anchor_occurrences(content, target)

        if anchor_positions:
            target_start, target_end, target_error = _select_occurrence_span(
                anchor_positions,
                occurrence,
                "标题/注释锚点 target",
            )

            if target_error:
                return -1, -1, {}, target_error

            line, column = _line_col_for_offset(content, target_start)

            return target_start, target_end, {
                "match_strategy": "line_anchor_normalized",
                "line": line,
                "column": column,
                "message": "target 未精确匹配，已按 Markdown 标题/HTML 注释锚点归一化后唯一命中。",
            }, ""

    normalized_content, start_offsets, end_offsets = _normalize_newlines_with_offsets(content)
    normalized_target, _target_start_offsets, _target_end_offsets = _normalize_newlines_with_offsets(target)
    normalized_positions = _collect_text_positions(normalized_content, normalized_target)

    if normalized_positions:
        normalized_index, target_error = _select_occurrence_position(
            normalized_positions,
            occurrence,
            "换行归一化后的 target",
        )

        if target_error:
            return -1, -1, {}, target_error

        normalized_end_index = normalized_index + len(normalized_target) - 1
        target_start = start_offsets[normalized_index]
        target_end = end_offsets[normalized_end_index]

        return target_start, target_end, {
            "match_strategy": "newline_normalized",
            "message": "target 未精确匹配，已将 CRLF/CR/LF 按换行归一化后唯一命中。",
        }, ""

    noise_positions = _collect_span_positions(content, target)

    if noise_positions:
        target_start, target_end, target_error = _select_occurrence_span(
            noise_positions,
            occurrence,
            "Markdown 噪声归一化后的 target",
        )

        if target_error:
            return -1, -1, {}, target_error

        line, column = _line_col_for_offset(content, target_start)

        return target_start, target_end, {
            "match_strategy": "markdown_noise_normalized",
            "line": line,
            "column": column,
            "message": "target 未精确匹配，已忽略首尾空白、连续空白、换行差异和全半角差异后唯一命中。",
        }, ""

    return -1, -1, {}, _target_not_found_error(content, target)


def _validate_structured_edit(edit: Dict[str, Any], edit_index: int) -> str:
    action = str(edit.get("action") or "").strip()

    if action not in {"replace", "insert_before", "insert_after", "delete"}:
        return f"第 {edit_index} 个 edit 的 action 不支持: {action}"

    if action == "replace":
        if "replacement" not in edit:
            return f"第 {edit_index} 个 edit 使用 replace 时必须提供 replacement。"

        return ""

    if action in {"insert_before", "insert_after"}:
        if "content" not in edit:
            if "replacement" in edit:
                return f"第 {edit_index} 个 edit 使用 {action} 时必须提供 content，不能使用 replacement。"

            return f"第 {edit_index} 个 edit 使用 {action} 时必须提供 content。"

        return ""

    if "replacement" in edit or "content" in edit:
        return f"第 {edit_index} 个 edit 使用 delete 时不能提供 replacement 或 content。"

    return ""


def apply_structured_edits(original: str, edits: Any) -> Tuple[str, Dict[str, Any], str]:
    if not isinstance(edits, list) or not edits:
        return str(original or ""), {}, "edits 必须是非空数组。"

    source = str(original or "")
    content = source
    applied_count = 0
    match_messages: List[str] = []
    match_locations: List[Dict[str, Any]] = []

    for edit_index, edit in enumerate(edits, start=1):
        if not isinstance(edit, dict):
            return source, {}, f"第 {edit_index} 个 edit 必须是对象。"

        validation_error = _validate_structured_edit(edit, edit_index)

        if validation_error:
            return source, {}, validation_error

        action = str(edit.get("action") or "").strip()
        target = str(edit.get("target") or "")
        occurrence = edit.get("occurrence")
        target_start, target_end, match_meta, target_error = _find_target_occurrence(content, target, occurrence)

        if target_error:
            return source, {}, (
                f"第 {edit_index} 个 edit 失败: {target_error} "
                "注意：edits 会按顺序串行执行，后一条 target 会在前面 edit 修改后的内容中匹配。"
            )

        before = content[:target_start]
        matched_target = content[target_start:target_end]
        after = content[target_end:]
        line_separator = _detect_line_separator(content)
        start_line, start_column = _line_col_for_offset(content, target_start)
        end_line, end_column = _line_col_for_offset(content, target_end)

        if action == "replace":
            replacement = _normalize_text_line_separator(str(edit.get("replacement") or ""), line_separator)
            content = before + replacement + after
        elif action == "insert_before":
            insert_content = _normalize_text_line_separator(str(edit.get("content") or ""), line_separator)
            content = before + insert_content + matched_target + after
        elif action == "insert_after":
            insert_content = _normalize_text_line_separator(str(edit.get("content") or ""), line_separator)
            content = before + matched_target + insert_content + after
        elif action == "delete":
            content = before + after

        applied_count += 1
        match_locations.append({
            "edit_index": edit_index,
            "action": action,
            "match_strategy": str(match_meta.get("match_strategy") or "exact"),
            "start": target_start,
            "end": target_end,
            "line": start_line,
            "column": start_column,
            "end_line": end_line,
            "end_column": end_column,
        })

        if match_meta.get("match_strategy") != "exact":
            message = str(match_meta.get("message") or "").strip()

            if message:
                match_messages.append(message)

    stats = {
        "mode": "structured_edits",
        "edit_count": applied_count,
        "added_lines": max(0, len(content.splitlines()) - len(source.splitlines())),
        "removed_lines": max(0, len(source.splitlines()) - len(content.splitlines())),
    }

    if match_messages:
        stats["match_notes"] = match_messages

    if match_locations:
        stats["match_locations"] = match_locations

    return content, stats, ""


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
