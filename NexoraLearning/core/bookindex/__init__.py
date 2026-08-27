"""Canonical book text and structure indexing.

The reader, annotations, sections and search all need to agree on *one*
coordinate system. This package owns that contract:

  * :mod:`text_normalize` defines the canonical plain text and the exact
    raw <-> plain offset mapping;
  * :mod:`structure` is the single parser/validator for ``bookinfo.xml``,
    ``sections.xml`` and ``annotations.xml``;
  * :mod:`service` caches per-book indexes and serves anchored search.
"""

from __future__ import annotations

from .structure import (
    COORDINATE_SPACE,
    Annotation,
    BookIndex,
    Chapter,
    Session,
    build_book_index,
    normalize_title_key,
    parse_annotations,
    parse_bookinfo_chapters,
    parse_range,
    parse_sections_sessions,
)
from .service import (
    build_chapter_payload,
    get_book_index,
    get_normalized_text,
    get_plain_text,
    invalidate_book_index,
    normalize_raw_offset,
    resolve_chapter,
    search_book,
)
from .text_normalize import (
    HEADING_BLOCK_CLOSE,
    HEADING_BLOCK_OPEN,
    NormalizedText,
    Paragraph,
    heading_candidate_block_end,
    normalize_book_text,
    strip_heading_candidate_block,
)

__all__ = [
    "COORDINATE_SPACE",
    "HEADING_BLOCK_CLOSE",
    "HEADING_BLOCK_OPEN",
    "Annotation",
    "BookIndex",
    "Chapter",
    "NormalizedText",
    "Paragraph",
    "Session",
    "build_book_index",
    "build_chapter_payload",
    "get_book_index",
    "get_normalized_text",
    "get_plain_text",
    "heading_candidate_block_end",
    "invalidate_book_index",
    "normalize_book_text",
    "normalize_raw_offset",
    "normalize_title_key",
    "parse_annotations",
    "parse_bookinfo_chapters",
    "parse_range",
    "parse_sections_sessions",
    "resolve_chapter",
    "search_book",
    "strip_heading_candidate_block",
]
