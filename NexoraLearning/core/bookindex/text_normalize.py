"""Canonical reader text normalization with exact offset mapping.

The book pipeline stores ``content.txt`` in a *raw* form that keeps HTML tags
(and, for legacy books, a prepended ``[EPUB_HEADING_CANDIDATES]`` block) because
the coarse/intensive models use that markup as structural hints. The reader, in
contrast, displays tag-free prose. Two different coordinate systems therefore
existed for the same book, and every stored offset (chapter_range,
session_range, annotation offset) silently drifted when rendered.

This module defines the single canonical *plain* coordinate space and the exact
raw <-> plain offset mapping, so any offset produced against the raw text can be
translated into the space the reader actually paints.

Guarantees of the canonical plain text:
  * no HTML tags, no comments, no script/style bodies;
  * no ``[EPUB_HEADING_CANDIDATES]`` metadata block;
  * ``{{nxl_image:...}}`` tokens preserved, each isolated as its own paragraph;
  * paragraphs separated by exactly one blank line (``\\n\\n``);
  * soft line breaks inside a paragraph are single ``\\n``;
  * runs of spaces/tabs collapsed to one space, never adjacent to ``\\n``;
  * no leading or trailing whitespace.

Because paragraphs are separated by exactly ``\\n\\n`` and never contain a blank
line, ``plain.split("\\n\\n")`` reproduces :attr:`NormalizedText.paragraphs`
byte for byte. That property is what lets the browser agree with the server
without re-implementing this normalizer.
"""

from __future__ import annotations

import html
import re
from array import array
from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, List, Optional, Tuple

HEADING_BLOCK_OPEN = "[EPUB_HEADING_CANDIDATES]"
HEADING_BLOCK_CLOSE = "[/EPUB_HEADING_CANDIDATES]"

PARAGRAPH_SEPARATOR = "\n\n"

# Zero-width characters and byte-order marks vanish entirely; unlike whitespace
# they must never collapse into a space, or every later offset shifts by one.
_SKIP_CHARS = "\r﻿​‌‍⁠"

_IMAGE_TOKEN = r"\{\{nxl_image:[A-Za-z0-9_\-]+:[A-Za-z0-9_\-]+:[A-Za-z0-9._\-]+(?::[^}]*)?\}\}"

# Tags that end a visual block; their presence forces a paragraph break.
_BLOCK_TAGS = (
    "p",
    "div",
    "section",
    "article",
    "blockquote",
    "tr",
    "table",
    "thead",
    "tbody",
    "ul",
    "ol",
    "li",
    "dl",
    "dd",
    "dt",
    "figure",
    "figcaption",
    "header",
    "footer",
    "main",
    "aside",
    "nav",
    "pre",
    "hr",
)
_BLOCK_TAG_GROUP = "|".join(_BLOCK_TAGS)

_TOKEN_RE = re.compile(
    r"(?is)"
    rf"(?P<headblock>{re.escape(HEADING_BLOCK_OPEN)}.*?{re.escape(HEADING_BLOCK_CLOSE)})"
    r"|(?P<head><head\b[^>]*>.*?</head\s*>)"
    r"|(?P<script><script\b[^>]*>.*?</script\s*>)"
    r"|(?P<style><style\b[^>]*>.*?</style\s*>)"
    r"|(?P<comment><!--.*?-->)"
    r"|(?P<doctype><[?!][^>]*>)"
    rf"|(?P<image>{_IMAGE_TOKEN})"
    r"|(?P<br><br\s*/?>)"
    r"|(?P<liopen><li\b[^>]*>)"
    r"|(?P<hopen><h(?P<hlevel>[1-6])\b[^>]*>)"
    r"|(?P<hclose></h(?P<hlevelclose>[1-6])\s*>)"
    rf"|(?P<blockclose></(?:{_BLOCK_TAG_GROUP})\s*>)"
    rf"|(?P<blockopen><(?:{_BLOCK_TAG_GROUP})\b[^>]*>)"
    r"|(?P<tag></?[A-Za-z][^>]*>)"
    r"|(?P<entity>&(?:\#[0-9]{1,7}|\#[xX][0-9A-Fa-f]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});)"
)

_INLINE_WS = " \t\f\v 　"


@dataclass(frozen=True)
class Paragraph:
    """One rendered block of the canonical plain text."""

    index: int
    start: int
    end: int
    text: str
    kind: str = "text"
    heading_level: int = 0

    def to_dict(self) -> Dict[str, Any]:
        row: Dict[str, Any] = {
            "index": self.index,
            "start": self.start,
            "end": self.end,
            "kind": self.kind,
            "text": self.text,
        }
        if self.heading_level:
            row["heading_level"] = self.heading_level
        return row


@dataclass
class NormalizedText:
    """Canonical plain text plus the exact map back to raw coordinates."""

    plain: str
    paragraphs: List[Paragraph] = field(default_factory=list)
    raw_length: int = 0
    identity: bool = False
    _raw_at: Any = None
    _para_starts: List[int] = field(default_factory=list, repr=False)

    @property
    def length(self) -> int:
        return len(self.plain)

    def to_plain(self, raw_offset: Any) -> int:
        """Map a raw-space offset onto the canonical plain space.

        Returns the plain index of the first surviving character whose raw
        source is at or after ``raw_offset``. Offsets landing inside dropped
        markup therefore snap forward to the next real content, which is what a
        reader jump should do.
        """
        try:
            target = int(raw_offset)
        except Exception:
            return 0
        if target <= 0:
            return 0
        if self.identity:
            return min(target, len(self.plain))
        if not self._raw_at:
            return 0
        return bisect_left(self._raw_at, target)

    def to_raw(self, plain_offset: Any) -> int:
        """Map a canonical plain offset back to raw coordinates."""
        try:
            target = int(plain_offset)
        except Exception:
            return 0
        if target <= 0:
            return 0
        if self.identity:
            return min(target, self.raw_length)
        if not self._raw_at:
            return 0
        if target >= len(self._raw_at):
            return self.raw_length
        return int(self._raw_at[target])

    def map_range(self, raw_start: Any, raw_end: Any) -> Tuple[int, int]:
        """Map a raw ``[start, end)`` span onto plain space, order-preserving."""
        start = self.to_plain(raw_start)
        end = self.to_plain(raw_end)
        if end < start:
            end = start
        return start, end

    def paragraph_index_at(self, plain_offset: Any) -> int:
        """Return the index of the paragraph containing ``plain_offset``."""
        if not self._para_starts:
            return -1
        try:
            target = int(plain_offset)
        except Exception:
            return 0
        if target <= 0:
            return 0
        idx = bisect_right(self._para_starts, target) - 1
        if idx < 0:
            return 0
        return min(idx, len(self.paragraphs) - 1)

    def paragraph_at(self, plain_offset: Any) -> Optional[Paragraph]:
        idx = self.paragraph_index_at(plain_offset)
        if idx < 0 or idx >= len(self.paragraphs):
            return None
        return self.paragraphs[idx]

    def slice_paragraphs(self, start: Any, end: Any) -> List[Paragraph]:
        """Return paragraphs overlapping the plain span ``[start, end)``."""
        try:
            lo = max(0, int(start))
            hi = max(lo, int(end))
        except Exception:
            return []
        rows: List[Paragraph] = []
        for para in self.paragraphs:
            if para.end <= lo:
                continue
            if para.start >= hi:
                break
            rows.append(para)
        return rows

    def text_slice(self, start: Any, end: Any) -> str:
        try:
            lo = max(0, min(len(self.plain), int(start)))
            hi = max(lo, min(len(self.plain), int(end)))
        except Exception:
            return ""
        return self.plain[lo:hi]


def _iter_pieces(raw: str) -> Iterator[Tuple[str, int, int, int]]:
    """Yield ``(text, raw_start, raw_end, heading_level)`` in document order.

    ``heading_level`` is the ``<hN>`` nesting level in effect for the piece (0
    when outside a heading), so heading paragraphs can be tagged during the same
    pass that builds the offset map. Injected separators (paragraph breaks, list
    bullets) carry a zero-width raw span so the mapping stays monotonic.
    """
    cursor = 0
    total = len(raw)
    heading_level = 0
    for match in _TOKEN_RE.finditer(raw):
        begin, finish = match.span()
        if begin > cursor:
            yield raw[cursor:begin], cursor, begin, heading_level
        if match.group("headblock") is not None or match.group("head") is not None:
            pass  # metadata blocks contribute nothing to reader prose
        elif match.group("script") is not None or match.group("style") is not None:
            pass
        elif match.group("comment") is not None or match.group("doctype") is not None:
            pass
        elif match.group("image") is not None:
            yield PARAGRAPH_SEPARATOR, begin, begin, 0
            yield match.group("image"), begin, finish, 0
            yield PARAGRAPH_SEPARATOR, finish, finish, 0
        elif match.group("br") is not None:
            yield "\n", begin, finish, heading_level
        elif match.group("liopen") is not None:
            yield PARAGRAPH_SEPARATOR, begin, begin, heading_level
            yield "- ", begin, finish, heading_level
        elif match.group("hopen") is not None:
            yield PARAGRAPH_SEPARATOR, begin, finish, 0
            try:
                heading_level = int(match.group("hlevel"))
            except Exception:
                heading_level = 1
        elif match.group("hclose") is not None:
            yield PARAGRAPH_SEPARATOR, begin, finish, heading_level
            heading_level = 0
        elif match.group("blockclose") is not None or match.group("blockopen") is not None:
            yield PARAGRAPH_SEPARATOR, begin, finish, heading_level
        elif match.group("entity") is not None:
            yield html.unescape(match.group("entity")), begin, finish, heading_level
        else:
            # Any other tag behaves as a word separator, mirroring the reader.
            yield " ", begin, finish, heading_level
        cursor = finish
    if cursor < total:
        yield raw[cursor:total], cursor, total, heading_level


def normalize_book_text(raw_text: Any) -> NormalizedText:
    """Build the canonical plain text and offset map for one book."""
    raw = str(raw_text or "")
    if not raw:
        return NormalizedText(plain="", paragraphs=[], raw_length=0, identity=True)

    chars: List[str] = []
    raw_at: List[int] = []
    heading_marks: List[Tuple[int, int]] = []

    pending_newlines = 0
    pending_space = False
    pending_anchor = 0
    started = False

    for text, piece_start, piece_end, heading_level in _iter_pieces(raw):
        if not text:
            continue
        is_injected = piece_end <= piece_start
        span = max(0, piece_end - piece_start)
        step = (span / len(text)) if (not is_injected and len(text) > 0) else 0.0
        for position, char in enumerate(text):
            source = piece_start if is_injected else piece_start + int(position * step)
            if char in _SKIP_CHARS:
                continue
            if char == "\n":
                pending_newlines += 1
                pending_space = False
                if not pending_anchor:
                    pending_anchor = source
                continue
            if char in _INLINE_WS:
                if pending_newlines == 0:
                    pending_space = True
                    if not pending_anchor:
                        pending_anchor = source
                continue
            starts_paragraph = (not started) or pending_newlines >= 2
            if started:
                # Separators are attributed to the markup that produced them, so
                # a raw offset pointing at real content never resolves backwards
                # onto the separator that precedes it.
                anchor = pending_anchor or source
                if pending_newlines > 0:
                    breaks = 2 if pending_newlines >= 2 else 1
                    for _ in range(breaks):
                        chars.append("\n")
                        raw_at.append(anchor)
                elif pending_space:
                    chars.append(" ")
                    raw_at.append(anchor)
            pending_newlines = 0
            pending_space = False
            pending_anchor = 0
            if heading_level and starts_paragraph:
                heading_marks.append((len(chars), int(heading_level)))
            chars.append(char)
            raw_at.append(source)
            started = True

    plain = "".join(chars)
    paragraphs = _split_paragraphs(plain)
    normalized = NormalizedText(
        plain=plain,
        paragraphs=paragraphs,
        raw_length=len(raw),
        identity=(plain == raw),
        # One 32-bit entry per plain character: ~4 bytes/char, exact at every
        # position. Compressing this into affine runs saves little and makes
        # mid-paragraph lookups (annotations, search hits) easy to get wrong.
        _raw_at=array("i", raw_at),
        _para_starts=[para.start for para in paragraphs],
    )
    _apply_heading_kinds(normalized, heading_marks)
    return normalized


def _split_paragraphs(plain: str) -> List[Paragraph]:
    """Split canonical text into paragraphs, tracking exact plain offsets."""
    if not plain:
        return []
    rows: List[Paragraph] = []
    cursor = 0
    index = 0
    total = len(plain)
    while cursor <= total:
        break_at = plain.find(PARAGRAPH_SEPARATOR, cursor)
        end = total if break_at < 0 else break_at
        body = plain[cursor:end]
        if body:
            rows.append(
                Paragraph(
                    index=index,
                    start=cursor,
                    end=end,
                    text=body,
                    kind="image" if _is_image_paragraph(body) else "text",
                )
            )
            index += 1
        if break_at < 0:
            break
        cursor = break_at + len(PARAGRAPH_SEPARATOR)
    return rows


_IMAGE_PARAGRAPH_RE = re.compile(rf"^{_IMAGE_TOKEN}$")


def _is_image_paragraph(body: str) -> bool:
    return bool(_IMAGE_PARAGRAPH_RE.match(str(body or "").strip()))


def _apply_heading_kinds(normalized: NormalizedText, heading_marks: List[Tuple[int, int]]) -> None:
    """Tag paragraphs whose first character came from ``<hN>`` markup."""
    if not heading_marks or not normalized.paragraphs:
        return
    by_paragraph: Dict[int, int] = {}
    for plain_offset, level in heading_marks:
        para_index = normalized.paragraph_index_at(plain_offset)
        if para_index < 0 or para_index >= len(normalized.paragraphs):
            continue
        para = normalized.paragraphs[para_index]
        if para.kind == "image" or para.start != plain_offset:
            continue
        current = by_paragraph.get(para_index)
        if current is None or level < current:
            by_paragraph[para_index] = int(level)
    for para_index, level in by_paragraph.items():
        old = normalized.paragraphs[para_index]
        normalized.paragraphs[para_index] = Paragraph(
            index=old.index,
            start=old.start,
            end=old.end,
            text=old.text,
            kind="heading",
            heading_level=int(level),
        )


def strip_heading_candidate_block(raw_text: Any) -> str:
    """Remove the legacy ``[EPUB_HEADING_CANDIDATES]`` block from raw text."""
    raw = str(raw_text or "")
    begin = raw.find(HEADING_BLOCK_OPEN)
    end = raw.find(HEADING_BLOCK_CLOSE)
    if begin < 0 or end < 0 or end <= begin:
        return raw
    return (raw[:begin] + raw[end + len(HEADING_BLOCK_CLOSE):]).lstrip("\n")


def heading_candidate_block_end(raw_text: Any) -> int:
    """Return the raw offset just past the legacy heading block, else 0."""
    raw = str(raw_text or "")
    end = raw.find(HEADING_BLOCK_CLOSE)
    if end < 0:
        return 0
    return end + len(HEADING_BLOCK_CLOSE)
