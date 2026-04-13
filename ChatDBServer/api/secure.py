"""Shared helper functions for input hardening and safe filesystem access."""

from __future__ import annotations

import html
import os
import re
from typing import Any, Optional


_SAFE_FILENAME_RE = re.compile(r"[^\w\-.()\u4e00-\u9fff]+", re.UNICODE)


def normalize_text(
    value: Any,
    *,
    default: str = "",
    max_len: int = 0,
    strip: bool = True,
    collapse_whitespace: bool = True,
) -> str:
    text = default if value is None else str(value)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if collapse_whitespace:
        text = re.sub(r"\s+", " ", text)
    if strip:
        text = text.strip()
    if max_len and max_len > 0 and len(text) > max_len:
        text = text[:max_len]
    return text


def escape_html_text(value: Any, *, default: str = "", max_len: int = 0) -> str:
    return html.escape(normalize_text(value, default=default, max_len=max_len), quote=True)


def safe_filename(value: Any, *, default: str = "untitled.txt", max_len: int = 120) -> str:
    name = normalize_text(value, default=default, max_len=max_len, collapse_whitespace=True)
    name = os.path.basename(name)
    name = name.replace("\\", "_").replace("/", "_")
    name = re.sub(r"\s+", "_", name)
    name = _SAFE_FILENAME_RE.sub("_", name)
    if not name:
        name = default
    if len(name) > max_len:
        root, ext = os.path.splitext(name)
        keep_root = max(1, max_len - min(len(ext), max_len // 3))
        name = root[:keep_root] + ext[: max_len - keep_root]
    if name.startswith("."):
        name = f"file{name}"
    return name


def safe_join_path(root: str, *parts: Any) -> str:
    root_path = os.path.abspath(normalize_text(root, default="", collapse_whitespace=False))
    if not root_path:
        raise ValueError("root path is required")

    candidate = root_path
    for part in parts:
        piece = normalize_text(part, default="", strip=False, collapse_whitespace=False)
        if not piece:
            continue
        candidate = os.path.join(candidate, piece)

    candidate = os.path.abspath(os.path.normpath(candidate))
    try:
        if os.path.commonpath([root_path, candidate]) != root_path:
            raise ValueError("path escapes root")
    except ValueError:
        raise ValueError("path escapes root")
    return candidate


def resolve_configured_path(root: str, raw_path: Any, *, fallback: Optional[str] = None) -> str:
    root_path = os.path.abspath(normalize_text(root, default="", collapse_whitespace=False))
    if not root_path:
        raise ValueError("root path is required")

    fallback_path = os.path.abspath(normalize_text(fallback or root_path, default="", collapse_whitespace=False))
    text = normalize_text(raw_path, default="", strip=True, collapse_whitespace=False)
    if not text:
        return fallback_path

    if os.path.isabs(text):
        candidate = os.path.abspath(os.path.normpath(text))
    else:
        candidate = os.path.abspath(os.path.normpath(os.path.join(root_path, text)))

    try:
        if os.path.commonpath([root_path, candidate]) != root_path:
            return fallback_path
    except ValueError:
        return fallback_path

    return candidate