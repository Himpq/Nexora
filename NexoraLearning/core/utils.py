"""文本解析与切片工具。"""

from __future__ import annotations

import html
import json
import re
import zipfile
from pathlib import Path
from typing import List


CHUNK_SIZE = 600
CHUNK_OVERLAP = 80


def extract_text(file_path: str) -> str:
    """从教材文件中提取纯文本内容。"""
    p = Path(file_path)
    suffix = p.suffix.lower()

    if suffix == ".pdf":
        return _parse_pdf(str(p))
    if suffix in {".docx", ".doc"}:
        return _parse_docx(str(p))
    if suffix == ".epub":
        return _parse_epub(str(p))
    if suffix in {".txt", ".md", ".c", ".h", ".py", ".rst"}:
        return p.read_text(encoding="utf-8", errors="ignore")

    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception as exc:
        raise ValueError(f"不支持的文件类型: {suffix}") from exc


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """按固定窗口切分文本，供向量化与模型读取使用。"""
    if not text.strip():
        return []

    chunks: List[str] = []
    step = max(1, size - overlap)
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start += step
    return chunks


def write_chunks_jsonl(path: Path, chunks: List[str]) -> int:
    """将文本切片写为 JSONL 文件。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for index, chunk in enumerate(chunks):
            handle.write(json.dumps({"index": index, "text": chunk}, ensure_ascii=False) + "\n")
    return len(chunks)


def read_chunks_jsonl(path: Path) -> List[str]:
    """读取 JSONL 切片文件。"""
    if not path.exists():
        return []
    chunks: List[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            chunks.append(str(json.loads(line).get("text") or ""))
        except Exception:
            continue
    return chunks


def _parse_pdf(path: str) -> str:
    """解析 PDF 文本。"""
    pdf_reader_cls = None
    try:
        from pypdf import PdfReader  # type: ignore
        pdf_reader_cls = PdfReader
    except Exception:
        try:
            from PyPDF2 import PdfReader  # type: ignore
            pdf_reader_cls = PdfReader
        except Exception as exc:
            raise RuntimeError("缺少 PDF 解析依赖，请安装: pip install pypdf") from exc

    pages: List[str] = []
    with open(path, "rb") as fh:
        reader = pdf_reader_cls(fh)
        for page in reader.pages:
            text = page.extract_text() or ""
            text = text.strip()
            if text:
                pages.append(text)
    return "\n\n".join(pages)


def _parse_docx(path: str) -> str:
    """解析 DOC/DOCX 文本。"""
    try:
        import docx  # type: ignore
    except Exception as exc:
        raise RuntimeError("缺少 DOCX 解析依赖，请安装: pip install python-docx") from exc
    doc = docx.Document(path)
    return "\n\n".join(p.text.strip() for p in doc.paragraphs if p.text and p.text.strip())


def _parse_epub(path: str) -> str:
    """解析 EPUB 文本。"""
    text_parts: List[str] = []
    heading_candidates: List[str] = []
    try:
        with zipfile.ZipFile(path, "r") as zf:
            candidates = sorted(
                [
                    name
                    for name in zf.namelist()
                    if name.lower().endswith((".xhtml", ".html", ".htm", ".xml"))
                ]
            )
            for name in candidates:
                try:
                    raw = zf.read(name).decode("utf-8", errors="ignore")
                except Exception:
                    continue
                heading_candidates.extend(_extract_heading_candidates(raw))
                parsed = _preserve_html_for_model(raw)
                if parsed:
                    text_parts.append(parsed)
    except Exception as exc:
        raise RuntimeError(f"EPUB 解析失败: {exc}") from exc
    # De-duplicate while keeping order.
    seen = set()
    uniq_headings: List[str] = []
    for row in heading_candidates:
        key = str(row or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        uniq_headings.append(str(row).strip())
    if uniq_headings:
        heading_block = ["[EPUB_HEADING_CANDIDATES]"]
        heading_block.extend([f"- {item}" for item in uniq_headings[:400]])
        heading_block.append("[/EPUB_HEADING_CANDIDATES]")
        return "\n".join(heading_block) + "\n\n" + "\n\n".join(text_parts)
    return "\n\n".join(text_parts)


def _strip_html_text(raw: str) -> str:
    """剥离 HTML 标签并做简单清洗。"""
    text = re.sub(r"(?is)<script.*?>.*?</script>", " ", raw)
    text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = html.unescape(text)
    text = text.replace("\r", "\n")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _preserve_html_for_model(raw: str) -> str:
    """Keep HTML structure for model parsing (remove noisy tags only)."""
    text = str(raw or "")
    if not text:
        return ""
    text = re.sub(r"(?is)<script.*?>.*?</script>", " ", text)
    text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)
    text = text.replace("\r", "\n")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _extract_heading_candidates(raw: str) -> List[str]:
    """Extract potential chapter/title lines from EPUB HTML using tags/classes/style hints."""
    if not raw:
        return []
    rows: List[str] = []
    # 1) Native heading tags are strongest signals.
    tag_pattern = re.compile(r"(?is)<(h[1-6])\b[^>]*>(.*?)</\1>")
    for m in tag_pattern.finditer(raw):
        text = _strip_html_text(m.group(2) or "")
        if _is_reasonable_heading(text):
            rows.append(text)

    # 2) Class/id/style hints for title-like lines.
    # Match p/div/span that likely carry heading semantics.
    hint_pattern = re.compile(
        r'(?is)<(p|div|span)\b([^>]*)>(.*?)</\1>'
    )
    for m in hint_pattern.finditer(raw):
        attrs = str(m.group(2) or "")
        inner = str(m.group(3) or "")
        if not _looks_like_heading_attrs(attrs):
            continue
        text = _strip_html_text(inner)
        if _is_reasonable_heading(text):
            rows.append(text)
    return rows


def _looks_like_heading_attrs(attrs: str) -> bool:
    lower = str(attrs or "").lower()
    if not lower:
        return False
    # Semantic class/id keywords.
    if re.search(r"(chapter|title|heading|toc|目录|章节|卷|篇)", lower):
        return True
    # Inline font-size hint.
    m = re.search(r"font-size\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*(px|pt|em|rem|%)", lower)
    if not m:
        return False
    try:
        size = float(m.group(1))
    except Exception:
        return False
    unit = m.group(2)
    # Conservative threshold.
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
    # Exclude very short punctuation-only strings.
    if not re.search(r"[\u4e00-\u9fffA-Za-z0-9]", value):
        return False
    return True
