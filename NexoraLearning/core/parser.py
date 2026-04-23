"""
NexoraLearning — 文件解析器
支持 PDF / TXT / MD / DOCX，返回纯文本
"""

from __future__ import annotations

from pathlib import Path
from typing import List


CHUNK_SIZE = 600      # 字符数（适合中文/代码混合）
CHUNK_OVERLAP = 80


def extract_text(file_path: str) -> str:
    """从文件中提取纯文本内容。"""
    p = Path(file_path)
    suffix = p.suffix.lower()

    if suffix == ".pdf":
        return _parse_pdf(str(p))
    elif suffix in {".docx", ".doc"}:
        return _parse_docx(str(p))
    elif suffix in {".txt", ".md", ".c", ".h", ".py", ".rst"}:
        return p.read_text(encoding="utf-8", errors="ignore")
    else:
        # 尝试当纯文本读
        try:
            return p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            raise ValueError(f"不支持的文件类型: {suffix}")


def _parse_pdf(path: str) -> str:
    try:
        import PyPDF2
    except ImportError:
        raise RuntimeError("需要安装 PyPDF2: pip install PyPDF2")
    pages = []
    with open(path, "rb") as f:
        reader = PyPDF2.PdfReader(f)
        for page in reader.pages:
            t = page.extract_text()
            if t:
                pages.append(t.strip())
    return "\n\n".join(pages)


def _parse_docx(path: str) -> str:
    try:
        import docx
    except ImportError:
        raise RuntimeError("需要安装 python-docx: pip install python-docx")
    doc = docx.Document(path)
    return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """将文本按字符数切片，带重叠，跳过空块。"""
    if not text.strip():
        return []
    chunks, start = [], 0
    while start < len(text):
        end = min(start + size, len(text))
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start += size - overlap
    return chunks
