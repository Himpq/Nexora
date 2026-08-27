"""Cached access to per-book canonical text and validated structure.

This is the single entry point the API and the booksproc pipeline should use
when they need reader-facing coordinates. Normalizing a 250k-character book
costs tens of milliseconds, so results are cached and invalidated by the mtime
and size of the four files that feed them.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple

from .structure import BookIndex, Chapter, build_book_index
from .text_normalize import NormalizedText

_CACHE_LIMIT = 24
_cache_lock = threading.RLock()
_cache: Dict[str, Tuple[Tuple[Any, ...], BookIndex]] = {}


def _book_dir(cfg: Mapping[str, Any], lecture_id: str, book_id: str) -> Path:
    data_dir = Path(str((cfg or {}).get("data_dir") or "data"))
    return data_dir / "lectures" / str(lecture_id) / "books" / str(book_id)


def _file_signature(path: Path) -> Tuple[int, int]:
    try:
        stat = path.stat()
        return int(stat.st_mtime_ns), int(stat.st_size)
    except Exception:
        return (0, 0)


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def _source_paths(cfg: Mapping[str, Any], lecture_id: str, book_id: str) -> Dict[str, Path]:
    root = _book_dir(cfg, lecture_id, book_id)
    return {
        "text": root / "text" / "content.txt",
        "bookinfo": root / "bookinfo.xml",
        "sections": root / "sections.xml",
        "annotations": root / "annotations.xml",
    }


def get_book_index(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    refresh: bool = False,
) -> BookIndex:
    """Return the validated plain-space index for one book (cached)."""
    paths = _source_paths(cfg, lecture_id, book_id)
    cache_key = str(_book_dir(cfg, lecture_id, book_id))
    signature = tuple(_file_signature(path) for path in paths.values())

    if not refresh:
        with _cache_lock:
            cached = _cache.get(cache_key)
            if cached is not None and cached[0] == signature:
                return cached[1]

    index = build_book_index(
        raw_text=_read_text(paths["text"]),
        bookinfo_xml=_read_text(paths["bookinfo"]),
        sections_xml=_read_text(paths["sections"]),
        annotations_xml=_read_text(paths["annotations"]),
        lecture_id=str(lecture_id),
        book_id=str(book_id),
    )

    with _cache_lock:
        if len(_cache) >= _CACHE_LIMIT:
            _cache.pop(next(iter(_cache)), None)
        _cache[cache_key] = (signature, index)
    return index


def invalidate_book_index(cfg: Mapping[str, Any], lecture_id: str = "", book_id: str = "") -> None:
    """Drop cached indexes; call after writing text or structure files."""
    with _cache_lock:
        if not lecture_id or not book_id:
            _cache.clear()
            return
        _cache.pop(str(_book_dir(cfg, lecture_id, book_id)), None)


def get_plain_text(cfg: Mapping[str, Any], lecture_id: str, book_id: str) -> str:
    """Return the canonical reader text for one book."""
    return get_book_index(cfg, lecture_id, book_id).plain


def get_normalized_text(cfg: Mapping[str, Any], lecture_id: str, book_id: str) -> Optional[NormalizedText]:
    return get_book_index(cfg, lecture_id, book_id).normalized


def normalize_raw_offset(cfg: Mapping[str, Any], lecture_id: str, book_id: str, raw_offset: Any) -> int:
    """Translate a stored raw offset into canonical plain coordinates."""
    normalized = get_normalized_text(cfg, lecture_id, book_id)
    if normalized is None:
        return 0
    return normalized.to_plain(raw_offset)


def resolve_chapter(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    chapter_index: Any,
) -> Tuple[Optional[BookIndex], Optional[Chapter], str]:
    """Resolve a chapter index strictly.

    Returns ``(index, chapter, error)``. An out-of-range or non-numeric index
    yields an explicit error instead of silently falling back to the whole book.
    """
    index = get_book_index(cfg, lecture_id, book_id)
    if index.total_chars <= 0:
        return index, None, "book_text_empty"
    if not index.chapters:
        return index, None, "no_chapters"
    try:
        target = int(chapter_index)
    except Exception:
        return index, None, "chapter_index_invalid"
    if target < 0 or target >= len(index.chapters):
        return index, None, "chapter_index_out_of_range"
    return index, index.chapters[target], ""


def _iter_matches(haystack: str, needle: str, limit: int) -> List[int]:
    positions: List[int] = []
    if not needle:
        return positions
    cursor = 0
    lowered = haystack.lower()
    target = needle.lower()
    while len(positions) < limit:
        found = lowered.find(target, cursor)
        if found < 0:
            break
        positions.append(found)
        cursor = found + max(1, len(target))
    return positions


def search_book(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    query: Any,
    *,
    limit: int = 40,
    context: int = 60,
) -> Dict[str, Any]:
    """Search the canonical text and return fully anchored hits.

    Every hit carries the chapter, session, paragraph and plain offset needed to
    jump straight to the match, so callers never have to re-derive a location
    from a bare offset.
    """
    keyword = str(query or "").strip()
    index = get_book_index(cfg, lecture_id, book_id)
    safe_limit = max(1, min(200, int(limit or 40)))
    safe_context = max(10, min(400, int(context or 60)))

    if not keyword:
        return {
            "query": "",
            "coordinate_space": index.coordinate_space,
            "total_chars": index.total_chars,
            "hits_count": 0,
            "hits": [],
        }

    normalized = index.normalized
    plain = index.plain
    hits: List[Dict[str, Any]] = []
    for position in _iter_matches(plain, keyword, safe_limit):
        match_end = position + len(keyword)
        chapter_index = index.chapter_index_at_offset(position)
        chapter = index.chapter_at(chapter_index)
        session_index = -1
        session_name = ""
        if chapter is not None:
            for session in chapter.sessions:
                if session.start <= position < session.end:
                    session_index = session.index
                    session_name = session.name
                    break
        paragraph_index = normalized.paragraph_index_at(position) if normalized else -1
        snippet_start = max(0, position - safe_context)
        snippet_end = min(len(plain), match_end + safe_context)
        hits.append(
            {
                "offset": position,
                "end": match_end,
                "length": len(keyword),
                "chapter_index": chapter_index,
                "chapter_title": chapter.title if chapter else "",
                "session_index": session_index,
                "session_name": session_name,
                "paragraph_index": paragraph_index,
                "chapter_offset": position - chapter.start if chapter else position,
                "snippet": plain[snippet_start:snippet_end].replace("\n", " "),
                "snippet_match_start": position - snippet_start,
            }
        )

    return {
        "query": keyword,
        "coordinate_space": index.coordinate_space,
        "total_chars": index.total_chars,
        "hits_count": len(hits),
        "hits": hits,
        "truncated": len(hits) >= safe_limit,
    }


def build_chapter_payload(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    chapter_index: Any,
    *,
    include_paragraphs: bool = True,
) -> Tuple[Optional[Dict[str, Any]], str]:
    """Build the reader payload for one chapter, or return an error code."""
    index, chapter, error = resolve_chapter(cfg, lecture_id, book_id, chapter_index)
    if error or chapter is None:
        return None, error or "chapter_unavailable"

    normalized = index.normalized
    paragraphs = index.chapter_paragraphs(chapter.index)
    payload: Dict[str, Any] = {
        "coordinate_space": index.coordinate_space,
        "chapter_index": chapter.index,
        "chapter_title": chapter.title,
        "chapter_start": chapter.start,
        "chapter_end": chapter.end,
        "chapter_range": chapter.range,
        "chapter_count": len(index.chapters),
        "content": normalized.text_slice(chapter.start, chapter.end) if normalized else "",
        "total_chars": chapter.length,
        "book_total_chars": index.total_chars,
        "sessions": [row.to_dict() for row in chapter.sessions],
        "annotations": [row.to_dict() for row in index.annotations_for_chapter(chapter.index)],
    }
    if include_paragraphs:
        payload["paragraphs"] = [
            {
                "index": para.index,
                "start": para.start,
                "end": para.end,
                "chapter_offset": para.start - chapter.start,
                "kind": para.kind,
                "heading_level": para.heading_level,
                "text": para.text,
            }
            for para in paragraphs
        ]
    return payload, ""
