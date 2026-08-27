"""Single authoritative parser and validator for book structure metadata.

Before this module the same ``bookinfo.xml`` / ``sections.xml`` /
``annotations.xml`` payloads were re-parsed with ad-hoc regexes in at least
four places (``api/route_helpers/common.py``, ``core/user/learning_progress.py``,
``core/booksproc/section.py`` and the browser). Nothing validated that chapters
were contiguous, non-overlapping or in range, so a malformed coarse-read result
degraded silently instead of being reported.

Everything here speaks the canonical *plain* coordinate space defined by
:mod:`core.bookindex.text_normalize`. Stored offsets live in raw ``content.txt``
coordinates, so :func:`build_book_index` translates them exactly once, at the
boundary, and records a diagnostic for every correction it had to make.

Stored range conventions (unchanged on disk, for backward compatibility):
  * ``chapter_range``  -> ``START:LENGTH`` absolute raw offsets
  * ``session_range``  -> ``START:LENGTH`` absolute raw offsets
  * annotation ``offset`` -> absolute raw offset, ``length`` in raw chars
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .text_normalize import NormalizedText, Paragraph

COORDINATE_SPACE = "plain"

# A leading/trailing gap larger than this fraction of the book becomes its own
# synthetic chapter instead of being folded into a neighbour.
_SYNTHETIC_GAP_RATIO = 0.02
_MIN_SYNTHETIC_GAP_CHARS = 400

_CHAPTER_BLOCK_RE = re.compile(
    r"<chapter_name>\s*(?P<name>.*?)\s*</chapter_name>"
    r"(?P<between>[\s\S]*?)"
    r"<chapter_range>\s*(?P<range>.*?)\s*</chapter_range>",
    flags=re.IGNORECASE,
)
_CHAPTER_SUMMARY_RE = re.compile(
    r"<chapter_summary>\s*([\s\S]*?)\s*</chapter_summary>", flags=re.IGNORECASE
)
_CHAPTER_SESSIONS_RE = re.compile(
    r"<chapter_sessions>\s*([\s\S]*?)\s*</chapter_sessions>", flags=re.IGNORECASE
)
_SESSION_ITEM_RE = re.compile(r"<session_item>\s*([\s\S]*?)\s*</session_item>", flags=re.IGNORECASE)
_ANNOTATION_RE = re.compile(r"<annotation>\s*([\s\S]*?)\s*</annotation>", flags=re.IGNORECASE)


def _tag(block: str, name: str) -> str:
    match = re.search(rf"<{name}>\s*([\s\S]*?)\s*</{name}>", str(block or ""), flags=re.IGNORECASE)
    return str(match.group(1) or "").strip() if match else ""


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return int(default)


def _document_coordinate_space(value: Any) -> str:
    """Return the declared stored-offset space, defaulting legacy files to raw."""
    declared = _tag(str(value or ""), "coordinate_space").strip().lower()
    return COORDINATE_SPACE if declared == COORDINATE_SPACE else "raw"


def parse_range(value: Any) -> Tuple[int, int]:
    """Parse a stored ``START:LENGTH`` range into ``(start, length)``."""
    text = str(value or "").strip()
    if ":" not in text:
        return 0, 0
    left, right = text.split(":", 1)
    start = _safe_int(left, -1)
    length = _safe_int(right, -1)
    if start < 0 or length < 0:
        return 0, 0
    return start, length


def normalize_title_key(value: Any) -> str:
    """Normalize a chapter/session title for tolerant matching."""
    text = str(value or "").strip().lower()
    if not text:
        return ""
    text = re.sub(r"\s+", "", text)
    return re.sub(r"[【】\[\]（）()《》<>「」『』\"'“”‘’`~!@#$%^&*+=|\\/:;,.?！？、。·\-—_]", "", text)


@dataclass(frozen=True)
class Session:
    """One study session inside a chapter, in canonical plain coordinates."""

    index: int
    chapter_index: int
    name: str
    start: int
    end: int
    summary: str = ""
    paragraph_start: int = -1
    paragraph_end: int = -1
    stored_range: str = ""

    @property
    def range(self) -> str:
        return f"{self.start}:{max(0, self.end - self.start)}"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "index": self.index,
            "session_index": self.index,
            "chapter_index": self.chapter_index,
            "name": self.name,
            "session_name": self.name,
            "start": self.start,
            "end": self.end,
            "range": self.range,
            "session_range": self.range,
            "summary": self.summary,
            "paragraph_start": self.paragraph_start,
            "paragraph_end": self.paragraph_end,
            "stored_range": self.stored_range,
        }


@dataclass(frozen=True)
class Chapter:
    """One chapter, in canonical plain coordinates."""

    index: int
    title: str
    start: int
    end: int
    summary: str = ""
    paragraph_start: int = -1
    paragraph_end: int = -1
    sessions: Tuple[Session, ...] = ()
    stored_range: str = ""
    synthetic: bool = False

    @property
    def range(self) -> str:
        return f"{self.start}:{max(0, self.end - self.start)}"

    @property
    def length(self) -> int:
        return max(0, self.end - self.start)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "index": self.index,
            "chapter_index": self.index,
            "title": self.title,
            "chapter_name": self.title,
            "start": self.start,
            "end": self.end,
            "range": self.range,
            "chapter_range": self.range,
            "length": self.length,
            "summary": self.summary,
            "paragraph_start": self.paragraph_start,
            "paragraph_end": self.paragraph_end,
            "stored_range": self.stored_range,
            "synthetic": self.synthetic,
            "sessions": [row.to_dict() for row in self.sessions],
        }


@dataclass(frozen=True)
class Annotation:
    """One annotation bound to a chapter and a concrete paragraph."""

    index: int
    chapter_index: int
    chapter_name: str
    offset: int
    length: int
    annotation_type: str
    content: str
    anchor_text: str = ""
    paragraph_index: int = -1
    bound_by: str = "offset"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "index": self.index,
            "chapter_index": self.chapter_index,
            "chapter_name": self.chapter_name,
            "offset": self.offset,
            "length": self.length,
            "type": self.annotation_type,
            "annotation_type": self.annotation_type,
            "content": self.content,
            "annotation_content": self.content,
            "anchor_text": self.anchor_text,
            "paragraph_index": self.paragraph_index,
            "bound_by": self.bound_by,
        }


@dataclass
class BookIndex:
    """Validated, plain-space structure for one book."""

    lecture_id: str = ""
    book_id: str = ""
    normalized: Optional[NormalizedText] = None
    chapters: List[Chapter] = field(default_factory=list)
    annotations: List[Annotation] = field(default_factory=list)
    diagnostics: List[Dict[str, Any]] = field(default_factory=list)
    coordinate_space: str = COORDINATE_SPACE

    @property
    def plain(self) -> str:
        return self.normalized.plain if self.normalized else ""

    @property
    def total_chars(self) -> int:
        return self.normalized.length if self.normalized else 0

    @property
    def raw_chars(self) -> int:
        return self.normalized.raw_length if self.normalized else 0

    @property
    def paragraphs(self) -> List[Paragraph]:
        return self.normalized.paragraphs if self.normalized else []

    def chapter_at(self, index: Any) -> Optional[Chapter]:
        try:
            idx = int(index)
        except Exception:
            return None
        if idx < 0 or idx >= len(self.chapters):
            return None
        return self.chapters[idx]

    def chapter_by_title(self, title: Any) -> Optional[Chapter]:
        key = normalize_title_key(title)
        if not key:
            return None
        for chapter in self.chapters:
            if normalize_title_key(chapter.title) == key:
                return chapter
        return None

    def chapter_index_at_offset(self, plain_offset: Any) -> int:
        offset = _safe_int(plain_offset, 0)
        for chapter in self.chapters:
            if chapter.start <= offset < chapter.end:
                return chapter.index
        if self.chapters and offset >= self.chapters[-1].end:
            return self.chapters[-1].index
        return -1

    def annotations_for_chapter(self, chapter_index: Any) -> List[Annotation]:
        idx = _safe_int(chapter_index, -1)
        return [row for row in self.annotations if row.chapter_index == idx]

    def chapter_paragraphs(self, chapter_index: Any) -> List[Paragraph]:
        chapter = self.chapter_at(chapter_index)
        if chapter is None or self.normalized is None:
            return []
        return self.normalized.slice_paragraphs(chapter.start, chapter.end)

    def chapter_text(self, chapter_index: Any) -> str:
        chapter = self.chapter_at(chapter_index)
        if chapter is None or self.normalized is None:
            return ""
        return self.normalized.text_slice(chapter.start, chapter.end)

    def to_dict(self, *, include_paragraphs: bool = False) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "lecture_id": self.lecture_id,
            "book_id": self.book_id,
            "coordinate_space": self.coordinate_space,
            "total_chars": self.total_chars,
            "raw_chars": self.raw_chars,
            "paragraph_count": len(self.paragraphs),
            "chapters": [row.to_dict() for row in self.chapters],
            "annotations": [row.to_dict() for row in self.annotations],
            "diagnostics": list(self.diagnostics),
        }
        if include_paragraphs:
            payload["paragraphs"] = [row.to_dict() for row in self.paragraphs]
        return payload


# ─────── raw XML readers (one implementation each) ────────────────────────


def parse_bookinfo_chapters(bookinfo_xml: Any) -> List[Dict[str, Any]]:
    """Read chapters from ``bookinfo.xml`` in stored raw coordinates."""
    text = str(bookinfo_xml or "")
    if not text.strip():
        return []
    coordinate_space = _document_coordinate_space(text)
    rows: List[Dict[str, Any]] = []
    for match in _CHAPTER_BLOCK_RE.finditer(text):
        title = str(match.group("name") or "").strip()
        raw_start, raw_length = parse_range(match.group("range"))
        tail = text[match.end(): match.end() + 4000]
        summary_match = _CHAPTER_SUMMARY_RE.search(tail)
        rows.append(
            {
                "title": title,
                "raw_start": raw_start,
                "raw_length": raw_length,
                "stored_range": f"{raw_start}:{raw_length}",
                "summary": str(summary_match.group(1) or "").strip() if summary_match else "",
                "coordinate_space": coordinate_space,
            }
        )
    return rows


def parse_sections_sessions(sections_xml: Any) -> Dict[str, List[Dict[str, Any]]]:
    """Read sessions from ``sections.xml``, keyed by normalized chapter title."""
    text = str(sections_xml or "")
    if not text.strip():
        return {}
    coordinate_space = _document_coordinate_space(text)
    result: Dict[str, List[Dict[str, Any]]] = {}
    for block_match in _CHAPTER_SESSIONS_RE.finditer(text):
        block = str(block_match.group(1) or "")
        chapter_name = _tag(block, "chapter_name")
        key = normalize_title_key(chapter_name)
        if not key:
            continue
        rows: List[Dict[str, Any]] = []
        for item_match in _SESSION_ITEM_RE.finditer(block):
            item = str(item_match.group(1) or "")
            name = _tag(item, "session_name")
            range_text = _tag(item, "session_range")
            if not name or not range_text:
                continue
            raw_start, raw_length = parse_range(range_text)
            rows.append(
                {
                    "name": name,
                    "raw_start": raw_start,
                    "raw_length": raw_length,
                    "stored_range": f"{raw_start}:{raw_length}",
                    "summary": _tag(item, "session_summary"),
                    "coordinate_space": coordinate_space,
                }
            )
        if rows:
            result[key] = rows
    return result


def parse_annotations(annotations_xml: Any) -> List[Dict[str, Any]]:
    """Read annotations from ``annotations.xml`` in stored raw coordinates."""
    text = str(annotations_xml or "")
    if not text.strip():
        return []
    coordinate_space = _document_coordinate_space(text)
    rows: List[Dict[str, Any]] = []
    for match in _ANNOTATION_RE.finditer(text):
        block = str(match.group(1) or "")
        chapter_name = _tag(block, "chapter_name")
        offset_text = _tag(block, "offset")
        content = _tag(block, "annotation_content")
        if not offset_text or not content:
            continue
        rows.append(
            {
                "chapter_name": chapter_name,
                "raw_offset": _safe_int(offset_text, 0),
                "raw_length": _safe_int(_tag(block, "length"), 0),
                "annotation_type": _tag(block, "annotation_type") or "思考点",
                "content": content,
                "anchor_text": re.sub(r"\s+", " ", _tag(block, "anchor_text")).strip(),
                "coordinate_space": coordinate_space,
            }
        )
    return rows


# ─────── validation / assembly ────────────────────────────────────────────


def _snap_to_paragraph_start(normalized: NormalizedText, offset: int) -> int:
    """Move an offset to the start of the paragraph that contains it."""
    para = normalized.paragraph_at(offset)
    if para is None:
        return max(0, min(offset, normalized.length))
    return para.start


def _build_sessions(
    normalized: NormalizedText,
    chapter_index: int,
    chapter_start: int,
    chapter_end: int,
    rows: List[Dict[str, Any]],
    diagnostics: List[Dict[str, Any]],
    chapter_title: str,
) -> Tuple[Session, ...]:
    if not rows:
        return ()
    mapped: List[Dict[str, Any]] = []
    for row in rows:
        stored_start = int(row["raw_start"])
        stored_end = stored_start + int(row["raw_length"])
        if row.get("coordinate_space") == COORDINATE_SPACE:
            start, end = stored_start, stored_end
        else:
            start, end = normalized.map_range(stored_start, stored_end)
        start = max(chapter_start, min(chapter_end, start))
        end = max(start, min(chapter_end, end))
        mapped.append({**row, "start": start, "end": end})
    mapped.sort(key=lambda item: (int(item["start"]), int(item["end"])))

    sessions: List[Session] = []
    cursor = chapter_start
    for position, row in enumerate(mapped):
        start = max(cursor, int(row["start"]))
        end = max(start, int(row["end"]))
        if position == len(mapped) - 1:
            end = chapter_end
        should_snap = row.get("coordinate_space") != COORDINATE_SPACE and not normalized.identity
        start = (
            _snap_to_paragraph_start(normalized, start)
            if should_snap and start > chapter_start
            else start
        )
        start = max(cursor, min(start, chapter_end))
        end = max(start, min(end, chapter_end))
        if end <= start and position != len(mapped) - 1:
            diagnostics.append(
                {
                    "level": "warning",
                    "code": "session_empty",
                    "chapter_index": chapter_index,
                    "chapter_title": chapter_title,
                    "session_name": row["name"],
                    "stored_range": row["stored_range"],
                    "message": "session 映射后长度为 0，已跳过",
                }
            )
            continue
        para_start = normalized.paragraph_index_at(start)
        para_end = normalized.paragraph_index_at(max(start, end - 1))
        sessions.append(
            Session(
                index=len(sessions),
                chapter_index=chapter_index,
                name=str(row["name"]),
                start=start,
                end=end,
                summary=str(row.get("summary") or ""),
                paragraph_start=para_start,
                paragraph_end=para_end,
                stored_range=str(row.get("stored_range") or ""),
            )
        )
        cursor = end
    if sessions and sessions[-1].end < chapter_end:
        last = sessions[-1]
        sessions[-1] = Session(
            index=last.index,
            chapter_index=last.chapter_index,
            name=last.name,
            start=last.start,
            end=chapter_end,
            summary=last.summary,
            paragraph_start=last.paragraph_start,
            paragraph_end=normalized.paragraph_index_at(max(last.start, chapter_end - 1)),
            stored_range=last.stored_range,
        )
    return tuple(sessions)


def _chapter_title_for_span(normalized: NormalizedText, start: int, end: int, fallback: str) -> str:
    """Pick a display title for a synthetic chapter from its first heading."""
    for para in normalized.slice_paragraphs(start, end):
        if para.kind == "heading" and para.text.strip():
            return para.text.strip()[:80]
    for para in normalized.slice_paragraphs(start, end):
        body = para.text.strip()
        if para.kind == "text" and 2 <= len(body) <= 60:
            return body[:80]
    return fallback


def build_book_index(
    *,
    raw_text: Any = "",
    normalized: Optional[NormalizedText] = None,
    bookinfo_xml: Any = "",
    sections_xml: Any = "",
    annotations_xml: Any = "",
    lecture_id: str = "",
    book_id: str = "",
) -> BookIndex:
    """Assemble a validated, plain-space :class:`BookIndex`.

    Chapters are guaranteed to be sorted, non-overlapping, paragraph-aligned and
    to tile ``[0, total_chars)`` exactly, so no book text is unreachable from the
    chapter list. Every correction is reported in ``diagnostics``.
    """
    from .text_normalize import normalize_book_text  # local import to avoid cycles

    norm = normalized if normalized is not None else normalize_book_text(raw_text)
    diagnostics: List[Dict[str, Any]] = []
    total = norm.length

    index = BookIndex(
        lecture_id=str(lecture_id or ""),
        book_id=str(book_id or ""),
        normalized=norm,
        chapters=[],
        annotations=[],
        diagnostics=diagnostics,
    )
    if total <= 0:
        return index

    stored_rows = parse_bookinfo_chapters(bookinfo_xml)
    mapped: List[Dict[str, Any]] = []
    for row in stored_rows:
        title = str(row.get("title") or "").strip()
        if not title:
            diagnostics.append(
                {
                    "level": "warning",
                    "code": "chapter_missing_title",
                    "stored_range": row.get("stored_range"),
                    "message": "章节缺少 chapter_name，已跳过",
                }
            )
            continue
        raw_start = int(row.get("raw_start") or 0)
        raw_length = int(row.get("raw_length") or 0)
        if raw_length <= 0:
            diagnostics.append(
                {
                    "level": "warning",
                    "code": "chapter_invalid_range",
                    "chapter_title": title,
                    "stored_range": row.get("stored_range"),
                    "message": "chapter_range 长度非正，已跳过",
                }
            )
            continue
        stored_limit = total if row.get("coordinate_space") == COORDINATE_SPACE else norm.raw_length
        if raw_start > stored_limit:
            diagnostics.append(
                {
                    "level": "error",
                    "code": "chapter_out_of_range",
                    "chapter_title": title,
                    "stored_range": row.get("stored_range"),
                    "message": f"chapter_range 起点超出正文长度 {stored_limit}，已跳过",
                }
            )
            continue
        if row.get("coordinate_space") == COORDINATE_SPACE:
            start, end = raw_start, min(total, raw_start + raw_length)
        else:
            start, end = norm.map_range(raw_start, raw_start + raw_length)
        mapped.append(
            {
                "title": title,
                "start": start,
                "end": end,
                "summary": str(row.get("summary") or ""),
                "stored_range": str(row.get("stored_range") or ""),
                "coordinate_space": str(row.get("coordinate_space") or "raw"),
            }
        )

    if not mapped:
        if stored_rows:
            diagnostics.append(
                {
                    "level": "error",
                    "code": "no_usable_chapters",
                    "message": "bookinfo.xml 中没有可用章节，已回退为单章整书",
                }
            )
        index.chapters = [
            Chapter(
                index=0,
                title=_chapter_title_for_span(norm, 0, total, "全文"),
                start=0,
                end=total,
                paragraph_start=0,
                paragraph_end=max(0, len(norm.paragraphs) - 1),
                synthetic=True,
            )
        ]
        index.annotations = _bind_annotations(norm, index.chapters, annotations_xml, diagnostics)
        return index

    mapped.sort(key=lambda item: (int(item["start"]), int(item["end"])))

    # Resolve overlaps and paragraph-align every boundary.
    for position, row in enumerate(mapped):
        bounded_start = max(0, min(total, int(row["start"])))
        should_snap = row.get("coordinate_space") != COORDINATE_SPACE and not norm.identity
        row["start"] = _snap_to_paragraph_start(norm, bounded_start) if should_snap else bounded_start
        row["end"] = max(row["start"], min(total, int(row["end"])))
    for position in range(1, len(mapped)):
        previous = mapped[position - 1]
        current = mapped[position]
        if current["start"] < previous["end"]:
            diagnostics.append(
                {
                    "level": "warning",
                    "code": "chapter_overlap",
                    "chapter_title": current["title"],
                    "stored_range": current["stored_range"],
                    "message": (
                        f"与上一章重叠（上一章结束于 {previous['end']}，本章起始于 {current['start']}），"
                        "已按本章起点截断上一章"
                    ),
                }
            )
            previous["end"] = current["start"]

    # Tile the document: fill interior gaps, and account for head/tail material.
    resolved: List[Dict[str, Any]] = []
    gap_threshold = max(_MIN_SYNTHETIC_GAP_CHARS, int(total * _SYNTHETIC_GAP_RATIO))

    first_start = int(mapped[0]["start"])
    if first_start > 0:
        if first_start >= gap_threshold:
            diagnostics.append(
                {
                    "level": "info",
                    "code": "front_matter_chapter",
                    "message": f"正文开头 {first_start} 字未被任何章节覆盖，已生成卷首章节",
                }
            )
            resolved.append(
                {
                    "title": _chapter_title_for_span(norm, 0, first_start, "卷首"),
                    "start": 0,
                    "end": first_start,
                    "summary": "",
                    "stored_range": "",
                    "synthetic": True,
                }
            )
        else:
            diagnostics.append(
                {
                    "level": "info",
                    "code": "chapter_gap_absorbed",
                    "chapter_title": mapped[0]["title"],
                    "message": f"首章前 {first_start} 字空隙已并入首章",
                }
            )
            mapped[0]["start"] = 0

    for position, row in enumerate(mapped):
        entry = dict(row)
        entry.setdefault("synthetic", False)
        if position + 1 < len(mapped):
            next_start = int(mapped[position + 1]["start"])
            if entry["end"] < next_start:
                diagnostics.append(
                    {
                        "level": "warning",
                        "code": "chapter_gap_filled",
                        "chapter_title": entry["title"],
                        "message": f"本章与下一章之间有 {next_start - entry['end']} 字空隙，已并入本章",
                    }
                )
                entry["end"] = next_start
        else:
            if entry["end"] < total:
                trailing = total - int(entry["end"])
                if trailing >= gap_threshold:
                    diagnostics.append(
                        {
                            "level": "info",
                            "code": "back_matter_chapter",
                            "message": f"正文结尾 {trailing} 字未被任何章节覆盖，已生成卷末章节",
                        }
                    )
                    resolved.append(entry)
                    resolved.append(
                        {
                            "title": _chapter_title_for_span(norm, int(entry["end"]), total, "卷末"),
                            "start": int(entry["end"]),
                            "end": total,
                            "summary": "",
                            "stored_range": "",
                            "synthetic": True,
                        }
                    )
                    continue
                diagnostics.append(
                    {
                        "level": "info",
                        "code": "chapter_gap_absorbed",
                        "chapter_title": entry["title"],
                        "message": f"末章后 {trailing} 字空隙已并入末章",
                    }
                )
                entry["end"] = total
        resolved.append(entry)

    session_map = parse_sections_sessions(sections_xml)
    chapters: List[Chapter] = []
    for position, row in enumerate(resolved):
        start = int(row["start"])
        end = int(row["end"])
        if end <= start:
            diagnostics.append(
                {
                    "level": "warning",
                    "code": "chapter_empty",
                    "chapter_title": row["title"],
                    "stored_range": row.get("stored_range"),
                    "message": "章节映射后长度为 0，已跳过",
                }
            )
            continue
        chapter_index = len(chapters)
        title = str(row["title"])
        session_rows = session_map.get(normalize_title_key(title)) or []
        sessions = _build_sessions(
            norm, chapter_index, start, end, session_rows, diagnostics, title
        )
        if session_rows and not sessions:
            diagnostics.append(
                {
                    "level": "warning",
                    "code": "sessions_unusable",
                    "chapter_title": title,
                    "message": "sections.xml 中的 session 全部无效，章节将不显示小节",
                }
            )
        chapters.append(
            Chapter(
                index=chapter_index,
                title=title,
                start=start,
                end=end,
                summary=str(row.get("summary") or ""),
                paragraph_start=norm.paragraph_index_at(start),
                paragraph_end=norm.paragraph_index_at(max(start, end - 1)),
                sessions=sessions,
                stored_range=str(row.get("stored_range") or ""),
                synthetic=bool(row.get("synthetic")),
            )
        )

    unmatched = set(session_map.keys()) - {normalize_title_key(row.title) for row in chapters}
    for key in sorted(unmatched):
        diagnostics.append(
            {
                "level": "warning",
                "code": "sessions_orphaned",
                "message": f"sections.xml 中的章节 “{key}” 在 bookinfo.xml 中不存在，已忽略",
            }
        )

    index.chapters = chapters
    index.annotations = _bind_annotations(norm, chapters, annotations_xml, diagnostics)
    return index


def _bind_annotations(
    normalized: NormalizedText,
    chapters: List[Chapter],
    annotations_xml: Any,
    diagnostics: List[Dict[str, Any]],
) -> List[Annotation]:
    """Map annotations into plain space and bind each to a concrete paragraph."""
    rows = parse_annotations(annotations_xml)
    if not rows:
        return []
    by_key = {normalize_title_key(chapter.title): chapter for chapter in chapters}
    results: List[Annotation] = []
    for row in rows:
        chapter_name = str(row.get("chapter_name") or "").strip()
        chapter = by_key.get(normalize_title_key(chapter_name))
        stored_offset = int(row["raw_offset"])
        is_plain = row.get("coordinate_space") == COORDINATE_SPACE
        plain_offset = max(0, min(normalized.length, stored_offset)) if is_plain else normalized.to_plain(stored_offset)
        bound_by = "offset"

        if chapter is None:
            for candidate in chapters:
                if candidate.start <= plain_offset < candidate.end:
                    chapter = candidate
                    bound_by = "offset_fallback"
                    break
        if chapter is None:
            diagnostics.append(
                {
                    "level": "warning",
                    "code": "annotation_unbound",
                    "chapter_name": chapter_name,
                    "message": "批注既无法按章节名也无法按偏移匹配，已忽略",
                }
            )
            continue

        anchor = str(row.get("anchor_text") or "").strip()
        paragraph_index = -1
        if not (chapter.start <= plain_offset < chapter.end):
            plain_offset = chapter.start
            bound_by = "chapter_start"
        if anchor:
            anchor_key = re.sub(r"\s+", "", anchor)
            if anchor_key:
                for para in normalized.slice_paragraphs(chapter.start, chapter.end):
                    if anchor_key in re.sub(r"\s+", "", para.text):
                        paragraph_index = para.index
                        plain_offset = para.start
                        bound_by = "anchor_text"
                        break
        if paragraph_index < 0:
            paragraph_index = normalized.paragraph_index_at(plain_offset)

        if is_plain:
            mapped_end = max(plain_offset, min(normalized.length, stored_offset + int(row["raw_length"])))
        else:
            _, mapped_end = normalized.map_range(stored_offset, stored_offset + int(row["raw_length"]))
        results.append(
            Annotation(
                index=len(results),
                chapter_index=chapter.index,
                chapter_name=chapter.title,
                offset=plain_offset,
                length=max(0, mapped_end - plain_offset) if row["raw_length"] else 0,
                annotation_type=str(row.get("annotation_type") or "思考点"),
                content=str(row.get("content") or ""),
                anchor_text=anchor,
                paragraph_index=paragraph_index,
                bound_by=bound_by,
            )
        )
    return results
