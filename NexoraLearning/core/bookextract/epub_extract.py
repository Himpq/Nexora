"""EPUB extraction helpers.

Keep book-format-specific parsers here so additional extractors like
pdf_extract.py or docx_extract.py can be added without growing core/utils.py.
"""

from __future__ import annotations

import html
import mimetypes
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Dict, List, Optional
from urllib.parse import unquote


IMAGE_TOKEN_RE = re.compile(
    r"\{\{nxl_image:([A-Za-z0-9_\-]+):([A-Za-z0-9_\-]+):([A-Za-z0-9._\-]+)(?::([^}]*))?\}\}"
)

_CONTENT_SUFFIXES = (".xhtml", ".html", ".htm", ".xml")
_NATURAL_KEY_RE = re.compile(r"(\d+)")


@dataclass
class SpineDocument:
    """One reading-order document resolved from the EPUB package."""

    name: str
    order: int
    item_id: str = ""
    is_navigation: bool = False
    reason: str = ""


def _natural_sort_key(name: str) -> List[Any]:
    """Sort ``txt2`` before ``txt10`` instead of lexicographically."""
    parts = _NATURAL_KEY_RE.split(str(name or "").lower())
    return [int(token) if token.isdigit() else token for token in parts]


def _resolve_archive_path(base: str, href: str) -> str:
    """Resolve an OPF-relative href against the archive root."""
    target = str(href or "").split("#", 1)[0].strip()
    if not target:
        return ""
    try:
        target = unquote(target)
    except Exception:
        pass
    base_dir = PurePosixPath(str(base or "")).parent
    raw = (base_dir / target).as_posix() if base_dir.as_posix() not in {".", ""} else target
    parts: List[str] = []
    for chunk in str(raw).split("/"):
        token = str(chunk or "").strip()
        if not token or token == ".":
            continue
        if token == "..":
            if parts:
                parts.pop()
            continue
        parts.append(token)
    return "/".join(parts)


def _find_opf_path(archive: zipfile.ZipFile) -> str:
    """Locate the OPF package document via META-INF/container.xml."""
    names = archive.namelist()
    for container in ("META-INF/container.xml", "meta-inf/container.xml"):
        if container not in names:
            continue
        try:
            raw = archive.read(container).decode("utf-8", errors="ignore")
        except Exception:
            continue
        match = re.search(r"""(?is)<rootfile\b[^>]*\bfull-path\s*=\s*["']([^"']+)["']""", raw)
        if match:
            candidate = _resolve_archive_path("", match.group(1))
            if candidate in names:
                return candidate
    for name in names:
        if name.lower().endswith(".opf"):
            return name
    return ""


def _looks_like_toc_document(raw: str) -> bool:
    """Detect an in-spine table-of-contents page by its link density."""
    text = str(raw or "")
    if not text:
        return False
    links = re.findall(r"(?is)<a\b[^>]*href\s*=", text)
    if len(links) < 8:
        return False
    body_text = _strip_html_text(re.sub(r"(?is)<a\b[^>]*>.*?</a>", " ", text))
    linked_text = " ".join(
        _strip_html_text(m.group(1)) for m in re.finditer(r"(?is)<a\b[^>]*>(.*?)</a>", text)
    )
    linked_len = len(re.sub(r"\s+", "", linked_text))
    other_len = len(re.sub(r"\s+", "", body_text))
    if linked_len <= 0:
        return False
    return linked_len >= max(40, other_len * 1.5)


def _iter_epub_spine_documents(archive: zipfile.ZipFile) -> List[SpineDocument]:
    """Return body documents in publisher reading order.

    EPUB reading order lives in the OPF ``<spine>``; sorting archive entries by
    filename is wrong whenever names do not happen to be alphabetical (an
    appendix named ``att001`` sorts before ``txt001`` and lands at the front of
    the book). Navigation documents are flagged so they can be excluded from the
    body without disturbing the order of real content.
    """
    names = archive.namelist()
    name_set = set(names)
    opf_path = _find_opf_path(archive)
    documents: List[SpineDocument] = []

    if opf_path and opf_path in name_set:
        try:
            opf = archive.read(opf_path).decode("utf-8", errors="ignore")
        except Exception:
            opf = ""
        manifest: Dict[str, Dict[str, str]] = {}
        for match in re.finditer(r"(?is)<item\b([^>]*)/?>", opf):
            attrs = str(match.group(1) or "")
            item_id = _attr(attrs, "id")
            href = _attr(attrs, "href")
            if not item_id or not href:
                continue
            manifest[item_id] = {
                "href": _resolve_archive_path(opf_path, href),
                "media_type": _attr(attrs, "media-type").lower(),
                "properties": _attr(attrs, "properties").lower(),
            }
        spine_match = re.search(r"(?is)<spine\b([^>]*)>(.*?)</spine\s*>", opf)
        if spine_match:
            toc_id = _attr(str(spine_match.group(1) or ""), "toc")
            order = 0
            for ref in re.finditer(r"(?is)<itemref\b([^>]*)/?>", str(spine_match.group(2) or "")):
                attrs = str(ref.group(1) or "")
                item_id = _attr(attrs, "idref")
                item = manifest.get(item_id)
                if not item:
                    continue
                href = item["href"]
                if not href or href not in name_set:
                    continue
                if not href.lower().endswith(_CONTENT_SUFFIXES):
                    continue
                is_nav = "nav" in item["properties"].split() or item_id == toc_id
                documents.append(
                    SpineDocument(
                        name=href,
                        order=order,
                        item_id=item_id,
                        is_navigation=is_nav,
                        reason="opf_nav_property" if is_nav else "",
                    )
                )
                order += 1

    if not documents:
        # No usable spine: fall back to natural (not lexicographic) ordering.
        candidates = [
            name
            for name in names
            if _is_fallback_content_document(archive, name)
        ]
        for order, name in enumerate(sorted(candidates, key=_natural_sort_key)):
            base = PurePosixPath(name).name.lower()
            is_nav = base in {"nav.xhtml", "nav.html", "toc.xhtml", "toc.html"}
            documents.append(
                SpineDocument(
                    name=name,
                    order=order,
                    is_navigation=is_nav,
                    reason="filename_nav" if is_nav else "",
                )
            )

    # Flag in-spine table-of-contents pages so they stay out of the body text.
    for doc in documents:
        if doc.is_navigation:
            continue
        base = PurePosixPath(doc.name).name.lower()
        if not re.search(r"(toc|contents|catalog|mulu)", base) and not re.search(
            r"(toc|contents)", doc.item_id.lower()
        ):
            continue
        try:
            raw = archive.read(doc.name).decode("utf-8", errors="ignore")
        except Exception:
            continue
        if _looks_like_toc_document(raw):
            doc.is_navigation = True
            doc.reason = "toc_link_density"

    return documents


def _is_fallback_content_document(archive: zipfile.ZipFile, name: str) -> bool:
    """Identify body-like files without treating EPUB package XML as prose."""
    lower = str(name or "").lower()
    if not lower.endswith(_CONTENT_SUFFIXES):
        return False
    if lower.endswith((".xhtml", ".html", ".htm")):
        return True
    base = PurePosixPath(lower).name
    if lower.startswith("meta-inf/") or base in {
        "container.xml",
        "encryption.xml",
        "signatures.xml",
        "metadata.xml",
    }:
        return False
    try:
        sample = archive.read(name).decode("utf-8", errors="ignore")[:8192]
    except Exception:
        return False
    return bool(re.search(r"(?is)<(?:[a-z0-9_-]+:)?(?:html|body)\b", sample))


def _attr(attrs: str, key: str) -> str:
    match = re.search(rf"""(?is)\b{re.escape(key)}\s*=\s*["']([^"']*)["']""", str(attrs or ""))
    return str(match.group(1) or "").strip() if match else ""


def extract_epub_text(epub_path: str) -> str:
    """Parse EPUB content into plain text in publisher reading order."""
    try:
        with zipfile.ZipFile(epub_path, "r") as zf:
            result = _read_epub_documents(zf)
    except Exception as exc:
        raise RuntimeError(f"EPUB 解析失败: {exc}") from exc
    return "\n\n".join(result["text_parts"])



def _read_epub_documents(
    archive: zipfile.ZipFile,
    *,
    image_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Read spine documents in order, collecting text, headings and images."""
    documents = _iter_epub_spine_documents(archive)
    text_parts: List[str] = []
    heading_rows: List[Dict[str, Any]] = []
    images: List[Dict[str, Any]] = []
    skipped: List[Dict[str, str]] = []
    seen_headings: set = set()
    image_index_ref = [0]

    # NCX / nav / OPF documents carry the publisher's own outline. They are read
    # for heading candidates only and never contribute body text.
    for name in _iter_epub_navigation_names(archive):
        try:
            raw = archive.read(name).decode("utf-8", errors="ignore")
        except Exception:
            continue
        for value in extract_epub_heading_candidates_from_text(raw):
            key = str(value or "").strip().lower()
            if not key or key in seen_headings:
                continue
            seen_headings.add(key)
            heading_rows.append(
                {
                    "title": str(value).strip(),
                    "document": name,
                    "spine_order": -1,
                    "from_navigation": True,
                }
            )

    for doc in documents:
        try:
            raw = archive.read(doc.name).decode("utf-8", errors="ignore")
        except Exception:
            continue

        for value in extract_epub_heading_candidates_from_text(raw):
            key = str(value or "").strip().lower()
            if not key or key in seen_headings:
                continue
            seen_headings.add(key)
            heading_rows.append(
                {
                    "title": str(value).strip(),
                    "document": doc.name,
                    "spine_order": doc.order,
                    "from_navigation": doc.is_navigation,
                }
            )

        if doc.is_navigation:
            # Navigation pages feed the heading index only; keeping them in the
            # body would inject catalogue metadata into prose and search.
            skipped.append({"document": doc.name, "reason": doc.reason or "navigation"})
            continue

        if image_context is None:
            content = _preserve_html_for_model(raw)
        else:
            parsed = _preserve_html_with_image_tokens(
                raw,
                archive=archive,
                page_name=doc.name,
                lecture_id=str(image_context["lecture_id"]),
                book_id=str(image_context["book_id"]),
                assets_dir=image_context["assets_dir"],
                images=images,
                image_index_ref=image_index_ref,
            )
            parsed.pop("_image_index", None)
            content = str(parsed.get("content") or "").strip()
        if content:
            text_parts.append(content)

    return {
        "text_parts": text_parts,
        "headings": heading_rows,
        "images": images,
        "documents": [
            {
                "name": doc.name,
                "document": doc.name,
                "spine_order": doc.order,
                "item_id": doc.item_id,
                "is_navigation": doc.is_navigation,
                "reason": doc.reason,
            }
            for doc in documents
        ],
        "skipped_documents": skipped,
    }


def extract_epub_with_assets(
    epub_path: str,
    *,
    lecture_id: str,
    book_id: str,
    assets_dir: Path,
) -> Dict[str, Any]:
    """Extract EPUB body text, image assets and a structural heading index.

    Heading candidates are returned as ``structure`` rather than prepended to
    ``text``. Inlining them used to shift every downstream offset by the size of
    the block and made catalogue metadata searchable as if it were prose.
    """
    assets_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(epub_path, "r") as zf:
        result = _read_epub_documents(
            zf,
            image_context={
                "lecture_id": lecture_id,
                "book_id": book_id,
                "assets_dir": assets_dir,
            },
        )

    heading_rows = result["headings"]
    return {
        "text": "\n\n".join(result["text_parts"]),
        "images": result["images"],
        "structure": {
            "source": "epub",
            "heading_candidates": [str(row.get("title") or "") for row in heading_rows],
            "headings": heading_rows,
            "documents": result["documents"],
            "skipped_documents": result["skipped_documents"],
        },
    }



def render_reader_image_tokens(text: str, base_url: str = "") -> str:
    src = str(text or "")
    if not src:
        return ""

    def repl(match: re.Match[str]) -> str:
        lecture_id = str(match.group(1) or "").strip()
        book_id = str(match.group(2) or "").strip()
        image_id = str(match.group(3) or "").strip()
        alt = html.escape(str(match.group(4) or "").strip() or image_id)
        url = _build_image_url(base_url, lecture_id, book_id, image_id)
        if not url:
            return ""
        return (
            f'<figure class="materials-preview-figure">'
            f'<img class="materials-preview-image" src="{html.escape(url)}" alt="{alt}" loading="lazy">'
            f"</figure>"
        )

    return IMAGE_TOKEN_RE.sub(repl, src)


def _iter_epub_navigation_names(archive: zipfile.ZipFile) -> List[str]:
    """Navigation documents used for heading candidates only, never body text."""
    rows: List[str] = []
    for name in archive.namelist():
        lower = name.lower()
        base_name = PurePosixPath(name).name.lower()
        if lower.endswith((".ncx", ".opf")):
            rows.append(name)
            continue
        if base_name in {"nav.xhtml", "nav.html", "toc.xhtml", "toc.html"}:
            rows.append(name)
    return sorted(rows)


def _dedupe_keep_order(rows: List[str]) -> List[str]:
    seen = set()
    uniq: List[str] = []
    for row in rows:
        key = str(row or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        uniq.append(str(row).strip())
    return uniq


def _build_image_url(base_url: str, lecture_id: str, book_id: str, image_id: str) -> str:
    if not lecture_id or not book_id or not image_id:
        return ""
    base = str(base_url or "").strip().rstrip("/")
    path = f"/api/lectures/{lecture_id}/books/{book_id}/images/{image_id}"
    return f"{base}{path}" if base else path


def extract_epub_heading_candidates_from_text(raw: str) -> List[str]:
    """Extract structural heading candidates from EPUB navigation or HTML text."""
    rows: List[str] = []
    rows.extend(_extract_navigation_heading_candidates(raw))
    rows.extend(_extract_heading_candidates(raw))
    rows.extend(_extract_loose_heading_candidates(raw))
    return _dedupe_keep_order(rows)


def _extract_navigation_heading_candidates(raw: str) -> List[str]:
    rows: List[str] = []
    text = str(raw or "")
    if not text:
        return rows

    for m in re.finditer(r"(?is)<navLabel\b[^>]*>.*?<text\b[^>]*>(.*?)</text>.*?</navLabel>", text):
        value = _strip_candidate_heading_text(m.group(1) or "")
        if _is_reasonable_heading(value):
            rows.append(value)

    for nav_match in re.finditer(r"(?is)<nav\b[^>]*(?:toc|目录)[^>]*>.*?</nav>", text):
        block = nav_match.group(0) or ""
        for link_match in re.finditer(r"(?is)<a\b[^>]*>(.*?)</a>", block):
            value = _strip_candidate_heading_text(link_match.group(1) or "")
            if _is_reasonable_heading(value):
                rows.append(value)

    return rows


def _extract_heading_candidates(raw: str) -> List[str]:
    rows: List[str] = []
    if not raw:
        return rows
    for m in re.finditer(r"(?is)<(h[1-6])\b[^>]*>(.*?)</\1>", raw):
        text = _strip_candidate_heading_text(m.group(2) or "")
        if _is_reasonable_heading(text):
            rows.append(text)
    hint_pattern = re.compile(r"(?is)<(p|div|span)\b([^>]*)>(.*?)</\1>")
    for m in hint_pattern.finditer(raw):
        attrs = str(m.group(2) or "")
        inner = str(m.group(3) or "")
        if not _looks_like_heading_attrs(attrs):
            continue
        text = _strip_candidate_heading_text(inner)
        if _is_reasonable_heading(text):
            rows.append(text)
    return rows


def _extract_loose_heading_candidates(raw: str) -> List[str]:
    rows: List[str] = []
    text = str(raw or "")
    if not text:
        return rows

    block_pattern = re.compile(r"(?is)<(p|div|blockquote|span)\b([^>]*)>(.*?)</\1>")
    for m in block_pattern.finditer(text):
        attrs = str(m.group(2) or "")
        inner = str(m.group(3) or "")
        value = _strip_candidate_heading_text(inner)
        if not _is_reasonable_heading(value):
            continue
        if (
            _looks_like_heading_attrs(attrs)
            or _looks_like_numbered_heading(value)
            or _looks_like_anchor_heading(attrs, value)
        ):
            rows.append(value)
    return rows


def _preserve_html_for_model(raw: str) -> str:
    text = str(raw or "")
    if not text:
        return ""
    text = re.sub(r"(?is)<script.*?>.*?</script>", " ", text)
    text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)
    text = text.replace("\r", "\n")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _preserve_html_with_image_tokens(
    raw: str,
    *,
    archive: zipfile.ZipFile,
    page_name: str,
    lecture_id: str,
    book_id: str,
    assets_dir: Path,
    images: List[Dict[str, Any]],
    image_index_ref: List[int],
) -> Dict[str, Any]:
    text = str(raw or "")
    if not text:
        return {"content": "", "_image_index": image_index_ref[0]}
    text = re.sub(r"(?is)<script.*?>.*?</script>", " ", text)
    text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)

    def repl(match: re.Match[str]) -> str:
        attrs = str(match.group(1) or "")
        src_match = re.search(r'''(?i)\bsrc\s*=\s*["']([^"']+)["']''', attrs)
        if not src_match:
            return ""
        src = str(src_match.group(1) or "").strip()
        if not src or src.startswith(("data:", "http://", "https://", "//")):
            return ""
        alt_match = re.search(r'''(?i)\balt\s*=\s*["']([^"']*)["']''', attrs)
        alt = str(alt_match.group(1) or "").strip() if alt_match else ""
        saved = _save_epub_image_asset(
            archive=archive,
            page_name=page_name,
            src=src,
            lecture_id=lecture_id,
            book_id=book_id,
            assets_dir=assets_dir,
            images=images,
            image_index_ref=image_index_ref,
            alt=alt,
        )
        if not saved:
            return ""
        token_alt = saved.get("alt") or saved.get("name") or saved.get("id") or "image"
        return f"\n\n{{{{nxl_image:{lecture_id}:{book_id}:{saved['id']}:{token_alt}}}}}\n\n"

    text = re.sub(r"(?is)<img\b([^>]*?)\/?>", repl, text)
    text = text.replace("\r", "\n")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return {"content": text.strip(), "_image_index": image_index_ref[0]}


def _save_epub_image_asset(
    *,
    archive: zipfile.ZipFile,
    page_name: str,
    src: str,
    lecture_id: str,
    book_id: str,
    assets_dir: Path,
    images: List[Dict[str, Any]],
    image_index_ref: List[int],
    alt: str = "",
) -> Optional[Dict[str, Any]]:
    page_dir = PurePosixPath(page_name).parent
    raw_target = (page_dir / src).as_posix() if page_dir.as_posix() not in {".", ""} else PurePosixPath(src).as_posix()
    parts: List[str] = []
    for part in str(raw_target).split("/"):
        token = str(part or "").strip()
        if not token or token == ".":
            continue
        if token == "..":
            if parts:
                parts.pop()
            continue
        parts.append(token)
    target_name = "/".join(parts)
    if target_name.startswith("/"):
        target_name = target_name.lstrip("/")
    if target_name not in archive.namelist():
        return None

    data = archive.read(target_name)
    suffix = Path(target_name).suffix.lower()
    if not suffix:
        mime_guess = mimetypes.guess_type(target_name)[0] or ""
        suffix = mimetypes.guess_extension(mime_guess or "") or ".bin"
    image_index_ref[0] = int(image_index_ref[0]) + 1
    image_id = f"img_{image_index_ref[0]:04d}"
    file_name = f"{image_id}{suffix}"
    out_path = assets_dir / file_name
    out_path.write_bytes(data)

    item = {
        "id": image_id,
        "name": Path(target_name).name,
        "file_name": file_name,
        "source_path": target_name,
        "mime_type": mimetypes.guess_type(target_name)[0] or "application/octet-stream",
        "size": len(data),
        "alt": alt.strip(),
    }
    images.append(item)
    return item


def _strip_html_text(raw: str) -> str:
    text = re.sub(r"(?is)<script.*?>.*?</script>", " ", raw)
    text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = html.unescape(text)
    text = text.replace("\r", "\n")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _strip_candidate_heading_text(raw: str) -> str:
    text = IMAGE_TOKEN_RE.sub(" ", str(raw or ""))
    text = _strip_html_text(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _looks_like_heading_attrs(attrs: str) -> bool:
    lower = str(attrs or "").lower()
    if not lower:
        return False
    if re.search(r"(chapter|title|heading|toc|目录|章节|卷|篇)", lower):
        return True
    m = re.search(r"font-size\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*(px|pt|em|rem|%)", lower)
    if not m:
        return False
    try:
        size = float(m.group(1))
    except Exception:
        return False
    unit = m.group(2)
    if unit in {"px", "pt"}:
        return size >= 18
    if unit in {"em", "rem"}:
        return size >= 1.15
    if unit == "%":
        return size >= 115
    return False


def _looks_like_anchor_heading(attrs: str, text: str) -> bool:
    lower_attrs = str(attrs or "").lower()
    value = str(text or "").strip()
    if "filepos" not in lower_attrs and "chapter" not in lower_attrs:
        return False
    return 2 <= len(value) <= 80


def _looks_like_numbered_heading(text: str) -> bool:
    value = str(text or "").strip()
    if not value:
        return False
    if re.match(r"^第\s*[0-9零〇一二三四五六七八九十百千万两]+\s*(大部分|部分|章节|章|节|篇|卷|部)", value):
        return True
    if re.match(r"^[0-9]{1,3}(?:\.[0-9]{1,3}){0,3}\s+.{1,80}$", value):
        return True
    if re.match(r"(?i)^(chapter|part|section)\s+[0-9ivxlcdm]+", value):
        return True
    return False


def _is_reasonable_heading(text: str) -> bool:
    value = str(text or "").strip()
    if not value:
        return False
    if len(value) > 120:
        return False
    if not re.search(r"[一-鿿A-Za-z0-9]", value):
        return False
    return True
