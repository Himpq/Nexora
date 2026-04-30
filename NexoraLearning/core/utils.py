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
                parsed = _strip_html_text(raw)
                if parsed:
                    text_parts.append(parsed)
    except Exception as exc:
        raise RuntimeError(f"EPUB 解析失败: {exc}") from exc
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
