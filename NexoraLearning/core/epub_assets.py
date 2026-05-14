from __future__ import annotations

import html
import mimetypes
import re
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any, Dict, List, Mapping, Optional


IMAGE_TOKEN_RE = re.compile(
    r"\{\{nxl_image:([A-Za-z0-9_\-]+):([A-Za-z0-9_\-]+):([A-Za-z0-9._\-]+)(?::([^}]*))?\}\}"
)


def extract_epub_with_assets(
    epub_path: str,
    *,
    lecture_id: str,
    book_id: str,
    assets_dir: Path,
) -> Dict[str, Any]:
    text_parts: List[str] = []
    heading_candidates: List[str] = []
    images: List[Dict[str, Any]] = []
    seen_headings = set()
    image_index = 0
    assets_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(epub_path, "r") as zf:
        names = list(zf.namelist())
        candidates = sorted(
            [
                name
                for name in names
                if name.lower().endswith((".xhtml", ".html", ".htm", ".xml"))
            ]
        )
        for name in candidates:
            try:
                raw = zf.read(name).decode("utf-8", errors="ignore")
            except Exception:
                continue
            for row in _extract_heading_candidates(raw):
                key = str(row or "").strip().lower()
                if key and key not in seen_headings:
                    seen_headings.add(key)
                    heading_candidates.append(str(row).strip())
            parsed = _preserve_html_with_image_tokens(
                raw,
                archive=zf,
                page_name=name,
                lecture_id=lecture_id,
                book_id=book_id,
                assets_dir=assets_dir,
                images=images,
                image_index_ref=[image_index],
            )
            image_index = int(parsed.pop("_image_index", image_index))
            content = str(parsed.get("content") or "").strip()
            if content:
                text_parts.append(content)

    text = ""
    if heading_candidates:
        heading_block = ["[EPUB_HEADING_CANDIDATES]"]
        heading_block.extend([f"- {item}" for item in heading_candidates[:400]])
        heading_block.append("[/EPUB_HEADING_CANDIDATES]")
        text = "\n".join(heading_block) + "\n\n"
    text += "\n\n".join(text_parts)
    return {
        "text": text,
        "images": images,
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


def _build_image_url(base_url: str, lecture_id: str, book_id: str, image_id: str) -> str:
    if not lecture_id or not book_id or not image_id:
        return ""
    base = str(base_url or "").strip().rstrip("/")
    path = f"/api/lectures/{lecture_id}/books/{book_id}/images/{image_id}"
    return f"{base}{path}" if base else path


def _extract_heading_candidates(raw: str) -> List[str]:
    rows: List[str] = []
    if not raw:
        return rows
    for m in re.finditer(r"(?is)<(h[1-6])\b[^>]*>(.*?)</\1>", raw):
        text = _strip_html_text(m.group(2) or "")
        if _is_reasonable_heading(text):
            rows.append(text)
    hint_pattern = re.compile(r"(?is)<(p|div|span)\b([^>]*)>(.*?)</\1>")
    for m in hint_pattern.finditer(raw):
        attrs = str(m.group(2) or "")
        inner = str(m.group(3) or "")
        if not _looks_like_heading_attrs(attrs):
            continue
        text = _strip_html_text(inner)
        if _is_reasonable_heading(text):
            rows.append(text)
    return rows


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


def _is_reasonable_heading(text: str) -> bool:
    value = str(text or "").strip()
    if not value:
        return False
    if len(value) > 120:
        return False
    if not re.search(r"[\u4e00-\u9fffA-Za-z0-9]", value):
        return False
    return True
