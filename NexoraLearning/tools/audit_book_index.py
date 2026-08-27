"""Audit (and optionally repair) book text extraction for reader coordinates.

Two classes of problem exist in books extracted before the bookindex refactor:

1. **Recoverable without re-extraction.** ``content.txt`` keeps HTML markup and,
   for EPUB imports, a prepended ``[EPUB_HEADING_CANDIDATES]`` block. Stored
   offsets are in that raw space. ``core.bookindex`` maps them onto the reader's
   canonical plain space exactly, so these books already display correctly —
   nothing has to be re-run.

2. **Not recoverable without re-extraction.** EPUB bodies were assembled in
   filename order rather than publisher spine order, so the *content itself* is
   out of sequence (an appendix named ``att001`` sorts ahead of ``txt001``).
   No offset mapping can undo that; the book has to be extracted again, and
   because re-extraction moves every offset, the coarse/section/annotation
   artifacts derived from the old text must be discarded and regenerated.

Usage:
    python -m tools.audit_book_index                     # report only
    python -m tools.audit_book_index --apply             # re-extract affected books
    python -m tools.audit_book_index --apply --lecture l_x --book b_y
"""

from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.bookextract.epub_extract import _iter_epub_spine_documents
from core.bookindex import HEADING_BLOCK_OPEN, invalidate_book_index, normalize_book_text
from core.lectures import (
    _book_detail_xml_path,
    _book_info_xml_path,
    _book_sections_xml_path,
    list_books,
    list_lectures,
    load_book_structure,
    load_book_text,
)


def _load_cfg() -> Dict[str, Any]:
    import main

    cfg = main.ensure_bootstrap()
    cfg["_config_path"] = str(main.CONFIG_PATH)
    return cfg


def _spine_order_differs(epub_path: Path) -> Optional[bool]:
    """True when publisher spine order differs from the old filename ordering.

    This is a property of the EPUB itself, not of the stored text, so callers
    must combine it with a freshness check on the extraction sidecar.
    """
    try:
        with zipfile.ZipFile(epub_path) as archive:
            documents = _iter_epub_spine_documents(archive)
            if not documents:
                return None
            spine_names = [doc.name for doc in documents]
            legacy_names = sorted(
                name
                for name in archive.namelist()
                if name.lower().endswith((".xhtml", ".html", ".htm", ".xml"))
            )
    except Exception:
        return None
    if any(doc.is_navigation for doc in documents):
        return True
    body_names = [doc.name for doc in documents if not doc.is_navigation]
    return body_names != [name for name in legacy_names if name in set(body_names)]


def _extracted_with_spine_order(structure: Dict[str, Any]) -> bool:
    """True when the stored text came from the spine-aware extractor."""
    documents = (structure or {}).get("documents")
    return isinstance(documents, list) and bool(documents)


def audit(cfg: Dict[str, Any], lecture_filter: str = "", book_filter: str = "") -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for lecture in list_lectures(cfg):
        lecture_id = str(lecture.get("id") or "")
        if lecture_filter and lecture_id != lecture_filter:
            continue
        for book in list_books(cfg, lecture_id):
            book_id = str(book.get("id") or "")
            if book_filter and book_id != book_filter:
                continue
            raw = load_book_text(cfg, lecture_id, book_id)
            if not raw.strip():
                continue
            structure = load_book_structure(cfg, lecture_id, book_id)
            normalized = normalize_book_text(raw)
            original = str(book.get("original_path") or "").strip()
            is_epub = original.lower().endswith(".epub") and Path(original).exists()

            reasons: List[str] = []
            fresh = _extracted_with_spine_order(structure)
            if HEADING_BLOCK_OPEN in raw:
                reasons.append("inline_heading_block")
            if not structure:
                reasons.append("missing_structure_sidecar")
            reorder = False
            if is_epub and not fresh:
                reorder = bool(_spine_order_differs(Path(original)))
                if reorder:
                    reasons.append("epub_reading_order_wrong")

            rows.append(
                {
                    "lecture_id": lecture_id,
                    "lecture_title": str(lecture.get("title") or ""),
                    "book_id": book_id,
                    "book_title": str(book.get("title") or ""),
                    "raw_chars": len(raw),
                    "plain_chars": normalized.length,
                    "paragraphs": len(normalized.paragraphs),
                    "is_epub": is_epub,
                    "needs_reextract": bool(reorder),
                    "reasons": reasons,
                }
            )
    return rows


def reextract(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Dict[str, Any]:
    """Re-extract one book and discard structure derived from the old text."""
    from core.booksproc.runtime import resolve_book_text
    from core.lectures import get_book, save_book_structure

    book = get_book(cfg, lecture_id, book_id)
    if book is None:
        raise ValueError(f"Book not found: {lecture_id}/{book_id}")

    before = len(load_book_text(cfg, lecture_id, book_id))
    text = resolve_book_text(cfg, lecture_id, book_id, book, force=True)

    # Every stored offset was computed against the previous text. Keeping the
    # old XML would let the validator remap stale offsets into plausible-looking
    # but wrong chapters, so the derived artifacts are cleared instead.
    cleared: List[str] = []
    for path in (
        _book_info_xml_path(cfg, lecture_id, book_id),
        _book_detail_xml_path(cfg, lecture_id, book_id),
        _book_sections_xml_path(cfg, lecture_id, book_id),
        Path(str(_book_info_xml_path(cfg, lecture_id, book_id).parent / "annotations.xml")),
    ):
        try:
            if path.exists() and path.read_text(encoding="utf-8").strip():
                path.write_text("", encoding="utf-8")
                cleared.append(path.name)
        except Exception:
            continue

    structure = load_book_structure(cfg, lecture_id, book_id)
    structure["reextracted"] = True
    save_book_structure(cfg, lecture_id, book_id, structure)
    invalidate_book_index(cfg, lecture_id, book_id)

    return {
        "lecture_id": lecture_id,
        "book_id": book_id,
        "raw_chars_before": before,
        "raw_chars_after": len(text),
        "plain_chars_after": normalize_book_text(text).length,
        "cleared": cleared,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit book extraction for reader coordinates.")
    parser.add_argument("--apply", action="store_true", help="re-extract books whose reading order is wrong")
    parser.add_argument("--all", action="store_true", help="with --apply, re-extract every flagged book")
    parser.add_argument("--lecture", default="", help="limit to one lecture id")
    parser.add_argument("--book", default="", help="limit to one book id")
    args = parser.parse_args()

    cfg = _load_cfg()
    rows = audit(cfg, args.lecture, args.book)
    if not rows:
        print("No books with extracted text were found.")
        return 0

    print(f"{'lecture':<18}{'book':<18}{'raw':>9}{'plain':>9}{'paras':>7}  reasons")
    print("-" * 96)
    for row in rows:
        print(
            f"{row['lecture_id']:<18}{row['book_id']:<18}"
            f"{row['raw_chars']:>9}{row['plain_chars']:>9}{row['paragraphs']:>7}  "
            f"{','.join(row['reasons']) or 'ok'}"
        )

    remap_only = [row for row in rows if row["reasons"] and not row["needs_reextract"]]
    needs = [row for row in rows if row["needs_reextract"]]
    print()
    print(f"{len(rows)} book(s) scanned.")
    print(f"  {len(remap_only)} display correctly via offset remapping — no action needed.")
    print(f"  {len(needs)} have wrong EPUB reading order and need re-extraction.")

    if not needs:
        return 0
    if not args.apply:
        print("\nRe-run with --apply to re-extract them. This clears bookinfo/bookdetail/"
              "sections/annotations for those books, which must then be regenerated.")
        return 0

    targets = needs if (args.all or args.lecture or args.book) else needs[:1]
    if targets is not needs:
        print(f"\nRe-extracting {len(targets)} of {len(needs)} book(s); pass --all for the rest.")
    for row in targets:
        try:
            result = reextract(cfg, row["lecture_id"], row["book_id"])
            print(
                f"  re-extracted {result['book_id']}: "
                f"{result['raw_chars_before']} -> {result['raw_chars_after']} raw chars, "
                f"{result['plain_chars_after']} plain; cleared {result['cleared'] or 'nothing'}"
            )
        except Exception as exc:
            print(f"  FAILED {row['book_id']}: {exc}")
    print("\nRe-run the coarse read (and section/annotation stages) for the re-extracted books.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
