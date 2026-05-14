"""booksproc shared runtime helpers.

Keep queue orchestration in manager.py, while moving reusable
book-text/tool/runtime helpers here so coarse/intensive/question flows
depend on a smaller surface.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Mapping

from ..epub_assets import extract_epub_with_assets
from ..lectures import load_book_text, save_book_images_meta, save_book_text
from ..utils import extract_text

MAX_READ_CHARS_PER_CALL = 8000


def as_bool(value: Any, default: bool = False) -> bool:
    """Parse bool-like runtime values safely."""
    if value is None:
        return bool(default)
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y", "on"}:
        return True
    if text in {"0", "false", "no", "n", "off", ""}:
        return False
    return bool(default)


def safe_json_obj(raw: str) -> Dict[str, Any]:
    """Parse one or multiple concatenated JSON object fragments."""
    text = str(raw or "").strip()
    if not text:
        return {}
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    except Exception:
        try:
            decoder = json.JSONDecoder()
            idx = 0
            merged: Dict[str, Any] = {}
            text_len = len(text)
            while idx < text_len:
                while idx < text_len and text[idx] in " \t\r\n,;":
                    idx += 1
                if idx >= text_len:
                    break
                obj, end = decoder.raw_decode(text, idx)
                if isinstance(obj, dict):
                    merged.update(obj)
                idx = max(end, idx + 1)
            return merged
        except Exception:
            return {}


def resolve_book_text(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    book: Mapping[str, Any],
    *,
    force: bool = False,
) -> str:
    """Load cached parsed text, or extract from original file and persist it."""
    if not force:
        existing = load_book_text(dict(cfg), lecture_id, book_id)
        if existing.strip():
            return existing

    original_path = str(book.get("original_path") or "").strip()
    if not original_path:
        existing = load_book_text(dict(cfg), lecture_id, book_id)
        if existing.strip():
            return existing
        raise ValueError("No original_path found for extraction.")

    source_path = Path(original_path)
    if not source_path.exists():
        raise ValueError(f"Original file not found: {source_path}")
    if source_path.suffix.lower() == ".epub":
        images_dir = Path(str(cfg.get("data_dir") or "data")) / "lectures" / lecture_id / "books" / book_id / "assets" / "images"
        epub_result = extract_epub_with_assets(
            str(source_path),
            lecture_id=lecture_id,
            book_id=book_id,
            assets_dir=images_dir,
        )
        text = str(epub_result.get("text") or "")
        save_book_images_meta(dict(cfg), lecture_id, book_id, epub_result.get("images") or [])
    else:
        text = extract_text(str(source_path))
    if not text.strip():
        raise ValueError("Parsed text is empty.")
    save_book_text(
        dict(cfg),
        lecture_id,
        book_id,
        text,
        filename=str(book.get("original_filename") or "content.txt"),
    )
    return text


def exec_read_book_text_tool(*, full_text: str, total_len: int, arguments: Mapping[str, Any]) -> Dict[str, Any]:
    """Read a bounded text slice from the parsed book content."""
    try:
        offset = int(arguments.get("offset"))
        length = int(arguments.get("length"))
    except Exception:
        return {"ok": False, "error": "offset/length must be integer"}
    if offset < 0:
        return {"ok": False, "error": "offset must be >= 0"}
    if length <= 0:
        return {"ok": False, "error": "length must be > 0"}
    safe_len = min(length, MAX_READ_CHARS_PER_CALL)
    if offset >= total_len:
        return {"ok": False, "error": "offset out of range", "text_len": total_len}
    end = min(total_len, offset + safe_len)
    return {
        "ok": True,
        "offset": offset,
        "length": end - offset,
        "text": str(full_text[offset:end] or ""),
    }


def exec_search_book_text_tool(*, full_text: str, total_len: int, arguments: Mapping[str, Any]) -> Dict[str, Any]:
    """Search keyword in the parsed book text and return local snippets."""
    keyword = str(arguments.get("keyword") or "").strip()
    if not keyword:
        return {"ok": False, "error": "keyword is required"}
    try:
        context_range = int(arguments.get("context_range") or 160)
    except Exception:
        context_range = 160
    context_range = max(20, min(600, context_range))
    try:
        max_hits = int(arguments.get("max_hits") or 12)
    except Exception:
        max_hits = 12
    max_hits = max(1, min(50, max_hits))

    raw = str(full_text or "")
    source = raw.lower()
    needle = keyword.lower()
    cursor = 0
    hits = []
    header_block_end = raw.find("[/EPUB_HEADING_CANDIDATES]")
    if header_block_end >= 0:
        header_block_end += len("[/EPUB_HEADING_CANDIDATES]")
    while cursor < len(source) and len(hits) < max_hits:
        idx = source.find(needle, cursor)
        if idx < 0:
            break
        if header_block_end > 0 and idx < header_block_end:
            cursor = max(cursor + 1, idx + len(keyword))
            continue
        match_start = idx
        match_end = idx + len(keyword)
        block_start = max(0, match_start - context_range)
        block_end = min(total_len, match_end + context_range)
        snippet = raw[block_start:block_end]
        hits.append(
            {
                "match_start": int(match_start),
                "match_end": int(match_end),
                "range": f"{block_start}:{max(0, block_end - block_start)}",
                "text": snippet,
            }
        )
        cursor = max(cursor + 1, match_end)
    return {
        "ok": True,
        "keyword": keyword,
        "hits_count": len(hits),
        "hits": hits,
        "text": "\n\n".join([f"[{row['range']}]\n{row['text']}" for row in hits]),
    }
