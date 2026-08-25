"""Personalized learning route helper functions."""

import html as html_lib
import re
from typing import Tuple

def _parse_start_length_range(range_text: str) -> Tuple[int, int]:
    """解析 START:LENGTH 章节范围。"""
    text = str(range_text or "").strip()
    left, sep, right = text.partition(":")
    if not sep:
        raise ValueError(f"章节范围格式无效：{text}")

    try:
        start = int(left.strip())
        length = int(right.strip())
    except ValueError as exc:
        raise ValueError(f"章节范围格式无效：{text}") from exc

    if start < 0 or length <= 0:
        raise ValueError(f"章节范围数值无效：{text}")

    return start, length

def _slice_book_text_by_range(book_text: str, range_text: str) -> str:
    """按学习路线保存的章节范围截取教材原文。"""
    start, length = _parse_start_length_range(range_text)
    text = str(book_text or "")
    end = start + length

    if start >= len(text) or end > len(text):
        raise ValueError(f"章节范围超出教材原文长度：{range_text}")

    chapter_text = text[start:end].strip()
    if not chapter_text:
        raise ValueError(f"章节范围内原文为空：{range_text}")

    return chapter_text

def _clean_chapter_source_text(raw_text: str) -> str:
    """清理原文章节中的 HTML 标签，避免模型把排版标签当成可引用原文。"""
    text = html_lib.unescape(str(raw_text or ""))

    if not text.strip():
        raise ValueError("章节原文为空，无法生成文章阅读。")

    text = re.sub(r"(?is)<\s*(script|style)[^>]*>.*?<\s*/\s*\1\s*>", "", text)
    text = re.sub(r"(?is)<\s*br\s*/?\s*>", "\n", text)
    text = re.sub(
        r"(?is)<\s*/?\s*(?:address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)(?:\s+[^>]*)?\s*/?\s*>",
        "\n",
        text,
    )
    text = re.sub(
        r"(?is)<\s*/?\s*(?:a|abbr|b|bdi|bdo|cite|code|data|dfn|em|font|i|kbd|mark|q|rp|rt|ruby|s|samp|small|span|strong|sub|sup|time|u|var|wbr)(?:\s+[^>]*)?\s*/?\s*>",
        "",
        text,
    )
    text = re.sub(r"(?is)<\s*/?\s*[a-z][a-z0-9:-]*(?:\s+[^>]*)?\s*/?\s*>", "", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    cleaned = text.strip()
    if not cleaned:
        raise ValueError("章节原文清理 HTML 标签后为空，无法生成文章阅读。")

    return cleaned
