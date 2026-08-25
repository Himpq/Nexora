"""Question bank route helper functions."""

import re
from collections.abc import Mapping as MappingABC
from typing import Any, Dict, List, Mapping

def _numbered_markdown_lines(content: str) -> str:
    lines = str(content or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    if lines and lines[-1] == "":
        lines = lines[:-1]
    if not lines:
        return ""
    return "\n".join(f"[{index}] {line}" for index, line in enumerate(lines, start=1))

def _normalize_question_bank_options(value: Any) -> List[Dict[str, str]]:
    if isinstance(value, str):
        raw_items = [line for line in value.splitlines() if line.strip()]
    elif isinstance(value, list):
        raw_items = value
    else:
        raw_items = []
    options: List[Dict[str, str]] = []
    for idx, item in enumerate(raw_items):
        fallback_label = chr(ord("A") + idx)
        label = ""
        text = ""
        if isinstance(item, MappingABC):
            label = str(item.get("id") or item.get("label") or item.get("key") or item.get("option_id") or "").strip()
            text = str(item.get("text") or item.get("content") or item.get("value") or item.get("title") or "").strip()
        else:
            text = str(item or "").strip()
        match = re.match(r"^\s*([a-zA-Z])\s*[.、:：)]\s*(.+)$", text)
        if match:
            if not label:
                label = match.group(1)
            text = match.group(2).strip()
        label = (label or fallback_label).upper()[:3]
        if not text and not label:
            continue
        options.append(
            {
                "label": label,
                "text": text,
                "value": f"{label}. {text}" if text else label,
            }
        )
    return options

def _question_bank_type_label(question: Mapping[str, Any]) -> str:
    options = question.get("options") if isinstance(question.get("options"), list) else []
    raw_type = str(question.get("type") or "").strip().lower()
    if raw_type in {"choice", "single_choice", "选择题", "单选题"}:
        return "选择题"
    if raw_type in {"multiple_choice", "多选题"}:
        return "多选题"
    if raw_type in {"true_false", "判断题"}:
        return "判断题"
    if raw_type in {"code", "practice", "实践题", "代码题"}:
        return "实践题"
    if len(options) >= 2:
        return "选择题"
    return "简答题"

def _normalize_question_bank_answer(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"^\s*(正确答案|参考答案|答案)\s*[:：]?\s*", "", text)
    text = re.sub(r"^\s*([a-z])\s*[.、:：)]\s*", r"\1 ", text)
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"[，。,.、:：;；（）()【】\\[\\]{}\"'`*_<>]", "", text)
    return text

def _extract_question_bank_choice_letter(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    patterns = (
        r"^\s*([a-zA-Z])\s*[.、:：)]",
        r"^\s*([a-zA-Z])\s*$",
        r"(?:正确答案|参考答案|答案|选择|选项|选)\s*[:：]?\s*([a-zA-Z])\b",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1).lower()
    return ""

def _extract_question_bank_choice_letters(value: Any) -> List[str]:
    text = str(value or "").strip()
    if not text:
        return []
    cleaned = re.sub(r"^\s*(正确答案|参考答案|答案|选择|选项|选)\s*[:：]?\s*", "", text)
    letters = re.findall(r"\b([a-zA-Z])\b|([a-zA-Z])\s*[.、:：)]", cleaned)
    result: List[str] = []
    for pair in letters:
        letter = str(pair[0] or pair[1] or "").strip().lower()
        if letter and letter not in result:
            result.append(letter)
    if result:
        return result
    single = _extract_question_bank_choice_letter(value)
    return [single] if single else []
