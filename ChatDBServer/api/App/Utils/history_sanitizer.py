"""Utilities for removing legacy history markers from visible chat text."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple


HISTORY_TIME_MARKER_PREFIXES = (
    "[TIME]",
    "[{TIME:",
    "[历史消息时间:",
)

HISTORY_SEPARATOR_LINE = "---"


def is_history_time_marker_line(line: str) -> bool:
    stripped = str(line or "").lstrip()
    return any(stripped.startswith(prefix) for prefix in HISTORY_TIME_MARKER_PREFIXES)


def is_history_separator_line(line: str) -> bool:
    return str(line or "").strip() == HISTORY_SEPARATOR_LINE


def is_history_separator_only_text(text: str) -> bool:
    lines = str(text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    content_lines = [line.strip() for line in lines if line.strip()]

    if not content_lines:
        return False

    return all(line == HISTORY_SEPARATOR_LINE for line in content_lines)


def _is_partial_history_time_marker_text(text: str) -> bool:
    stripped = str(text or "").lstrip()

    if not stripped:
        return False

    return any(
        prefix.startswith(stripped) or stripped.startswith(prefix)
        for prefix in HISTORY_TIME_MARKER_PREFIXES
    )


def _first_nonblank_index(text: str, start: int = 0) -> int:
    idx = max(0, int(start or 0))

    while idx < len(text) and text[idx].isspace():
        idx += 1

    return idx


def _line_end_index(text: str, start: int) -> int:
    idx = text.find("\n", max(0, int(start or 0)))

    if idx < 0:
        return -1

    return idx + 1


def strip_history_time_prefix_text(text: str) -> str:
    value = str(text or "")

    if not value:
        return ""

    normalized = value.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    start_index = 0
    changed = False

    while True:
        cursor = start_index

        while cursor < len(lines) and not str(lines[cursor] or "").strip():
            cursor += 1

        if cursor >= len(lines):
            return "" if changed else value

        marker_end = cursor

        if is_history_time_marker_line(lines[cursor]):
            pass
        elif is_history_separator_line(lines[cursor]):
            after_separator = cursor + 1

            while after_separator < len(lines) and not str(lines[after_separator] or "").strip():
                after_separator += 1

            if after_separator >= len(lines) or not is_history_time_marker_line(lines[after_separator]):
                break

            marker_end = after_separator
        else:
            break

        start_index = marker_end + 1
        changed = True

    if not changed:
        return value

    while start_index < len(lines) and not str(lines[start_index] or "").strip():
        start_index += 1

    if start_index >= len(lines):
        return ""

    return "\n".join(lines[start_index:]).lstrip()


def strip_history_time_prefix_from_content(content: Any) -> Any:
    if isinstance(content, str):
        return strip_history_time_prefix_text(content)

    if isinstance(content, list):
        stripped_items: List[Any] = []

        for item in content:
            if not isinstance(item, dict):
                stripped_items.append(item)
                continue

            item_copy = dict(item)
            item_type = str(item_copy.get("type", "") or "").strip().lower()

            if item_type in {"text", "input_text", "output_text"} and isinstance(item_copy.get("text"), str):
                item_copy["text"] = strip_history_time_prefix_text(item_copy.get("text", ""))

            stripped_items.append(item_copy)

        return stripped_items

    if isinstance(content, dict):
        item_copy: Dict[str, Any] = dict(content)

        if isinstance(item_copy.get("text"), str):
            item_copy["text"] = strip_history_time_prefix_text(item_copy.get("text", ""))

        if isinstance(item_copy.get("content"), str):
            item_copy["content"] = strip_history_time_prefix_text(item_copy.get("content", ""))

        return item_copy

    return content


def sanitize_assistant_visible_content(content: Any) -> str:
    cleaned = strip_history_time_prefix_text(str(content or ""))

    if is_history_separator_only_text(cleaned):
        return ""

    return cleaned


def strip_streamed_history_time_marker_echo(text: str) -> Tuple[str, bool, bool]:
    value = str(text or "")

    if not value:
        return "", False, False

    normalized = value.replace("\r\n", "\n").replace("\r", "\n")
    first_index = _first_nonblank_index(normalized)

    if first_index >= len(normalized):
        return "", False, True

    probe = normalized[first_index:]

    if is_history_separator_line(probe.split("\n", 1)[0]):
        separator_end = _line_end_index(normalized, first_index)

        if separator_end < 0:
            return "", False, True

        after_separator = _first_nonblank_index(normalized, separator_end)

        if after_separator >= len(normalized):
            return "", False, True

        time_probe = normalized[after_separator:]
        time_line = time_probe.split("\n", 1)[0]

        if is_history_time_marker_line(time_line):
            time_line_end = _line_end_index(normalized, after_separator)

            if time_line_end < 0:
                return "", False, True

            content_start = _first_nonblank_index(normalized, time_line_end)
            return normalized[content_start:].lstrip(), True, False

        if _is_partial_history_time_marker_text(time_probe):
            return "", False, True

        return value, False, False

    first_line = probe.split("\n", 1)[0]

    if is_history_time_marker_line(first_line):
        line_end = _line_end_index(normalized, first_index)

        if line_end < 0:
            return "", False, True

        content_start = _first_nonblank_index(normalized, line_end)
        return normalized[content_start:].lstrip(), True, False

    if _is_partial_history_time_marker_text(probe):
        return "", False, True

    return value, False, False
