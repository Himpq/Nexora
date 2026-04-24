"""Lecture and book storage helpers for NexoraLearning.

Directory layout:
  data/
    lectures/
      {lecture_id}/
        lecture.json
        books/
          {book_id}/
            book.json
            text/
              content.txt
            vectors/
              chunks.jsonl
              papi_request.json
"""

from __future__ import annotations

import json
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

_lock = threading.RLock()


def _lectures_root(cfg: Dict[str, Any]) -> Path:
    return Path(cfg.get("data_dir") or "data") / "lectures"


def _lecture_dir(cfg: Dict[str, Any], lecture_id: str) -> Path:
    return _lectures_root(cfg) / lecture_id


def _lecture_json_path(cfg: Dict[str, Any], lecture_id: str) -> Path:
    return _lecture_dir(cfg, lecture_id) / "lecture.json"


def _books_dir(cfg: Dict[str, Any], lecture_id: str) -> Path:
    return _lecture_dir(cfg, lecture_id) / "books"


def _book_dir(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _books_dir(cfg, lecture_id) / book_id


def _book_json_path(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_dir(cfg, lecture_id, book_id) / "book.json"


def _book_text_dir(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_dir(cfg, lecture_id, book_id) / "text"


def _book_text_path(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_text_dir(cfg, lecture_id, book_id) / "content.txt"


def _book_vectors_dir(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_dir(cfg, lecture_id, book_id) / "vectors"


def _book_chunks_path(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_vectors_dir(cfg, lecture_id, book_id) / "chunks.jsonl"


def _book_papi_request_path(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_vectors_dir(cfg, lecture_id, book_id) / "papi_request.json"


def ensure_lecture_root(cfg: Dict[str, Any]) -> Path:
    root = _lectures_root(cfg)
    root.mkdir(parents=True, exist_ok=True)
    return root


def list_lectures(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    root = _lectures_root(cfg)
    if not root.exists():
        return []

    lectures: List[Dict[str, Any]] = []
    for entry in sorted(root.iterdir()):
        lecture_path = entry / "lecture.json"
        if entry.is_dir() and lecture_path.exists():
            data = _read_json(lecture_path)
            if data:
                lectures.append(data)
    return lectures


def get_lecture(cfg: Dict[str, Any], lecture_id: str) -> Optional[Dict[str, Any]]:
    return _read_json(_lecture_json_path(cfg, lecture_id))


def create_lecture(
    cfg: Dict[str, Any],
    title: str,
    *,
    description: str = "",
    category: str = "",
    status: str = "draft",
) -> Dict[str, Any]:
    lecture_id = f"l_{uuid.uuid4().hex[:12]}"
    lecture_dir = _lecture_dir(cfg, lecture_id)
    lecture_dir.mkdir(parents=True, exist_ok=True)
    _books_dir(cfg, lecture_id).mkdir(parents=True, exist_ok=True)

    now = int(time.time())
    lecture = {
        "id": lecture_id,
        "title": title.strip(),
        "description": description.strip(),
        "category": category.strip(),
        "status": status.strip() or "draft",
        "created_at": now,
        "updated_at": now,
        "book_count": 0,
        "vector_count": 0,
    }
    _write_json(_lecture_json_path(cfg, lecture_id), lecture)
    return lecture


def update_lecture(
    cfg: Dict[str, Any],
    lecture_id: str,
    updates: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    lecture = get_lecture(cfg, lecture_id)
    if lecture is None:
        return None

    sanitized = dict(updates or {})
    sanitized.pop("id", None)
    sanitized.pop("created_at", None)
    lecture.update(sanitized)
    lecture["updated_at"] = int(time.time())
    _write_json(_lecture_json_path(cfg, lecture_id), lecture)
    return lecture


def delete_lecture(cfg: Dict[str, Any], lecture_id: str) -> bool:
    lecture_dir = _lecture_dir(cfg, lecture_id)
    if not lecture_dir.exists():
        return False
    shutil.rmtree(str(lecture_dir))
    return True


def list_books(cfg: Dict[str, Any], lecture_id: str) -> List[Dict[str, Any]]:
    books_dir = _books_dir(cfg, lecture_id)
    if not books_dir.exists():
        return []

    books: List[Dict[str, Any]] = []
    for entry in sorted(books_dir.iterdir()):
        book_path = entry / "book.json"
        if entry.is_dir() and book_path.exists():
            data = _read_json(book_path)
            if data:
                books.append(data)
    return books


def get_book(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Optional[Dict[str, Any]]:
    return _read_json(_book_json_path(cfg, lecture_id, book_id))


def create_book(
    cfg: Dict[str, Any],
    lecture_id: str,
    title: str,
    *,
    description: str = "",
    source_type: str = "text",
    cover_path: str = "",
) -> Dict[str, Any]:
    if get_lecture(cfg, lecture_id) is None:
        raise ValueError(f"Lecture not found: {lecture_id}")

    book_id = f"b_{uuid.uuid4().hex[:12]}"
    book_dir = _book_dir(cfg, lecture_id, book_id)
    book_dir.mkdir(parents=True, exist_ok=True)
    _book_text_dir(cfg, lecture_id, book_id).mkdir(parents=True, exist_ok=True)
    _book_vectors_dir(cfg, lecture_id, book_id).mkdir(parents=True, exist_ok=True)

    now = int(time.time())
    book = {
        "id": book_id,
        "lecture_id": lecture_id,
        "title": title.strip(),
        "description": description.strip(),
        "source_type": source_type.strip() or "text",
        "cover_path": cover_path.strip(),
        "created_at": now,
        "updated_at": now,
        "text_status": "empty",
        "text_chars": 0,
        "text_filename": "",
        "vector_status": "idle",
        "vector_provider": "nexoradb_papi_placeholder",
        "chunks_count": 0,
        "vector_count": 0,
        "last_vectorized_at": None,
        "current_chapter": "",
        "next_chapter": "",
        "error": "",
    }
    _write_json(_book_json_path(cfg, lecture_id, book_id), book)
    _increment_lecture_field(cfg, lecture_id, "book_count", 1)
    return book


def update_book(
    cfg: Dict[str, Any],
    lecture_id: str,
    book_id: str,
    updates: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    book = get_book(cfg, lecture_id, book_id)
    if book is None:
        return None

    sanitized = dict(updates or {})
    sanitized.pop("id", None)
    sanitized.pop("lecture_id", None)
    sanitized.pop("created_at", None)
    book.update(sanitized)
    book["updated_at"] = int(time.time())
    _write_json(_book_json_path(cfg, lecture_id, book_id), book)
    return book


def delete_book(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> bool:
    book_dir = _book_dir(cfg, lecture_id, book_id)
    book = get_book(cfg, lecture_id, book_id)
    if not book_dir.exists():
        return False
    shutil.rmtree(str(book_dir))
    _increment_lecture_field(cfg, lecture_id, "book_count", -1)
    _increment_lecture_field(cfg, lecture_id, "vector_count", -int(book.get("vector_count") or 0) if book else 0)
    return True


def save_book_text(
    cfg: Dict[str, Any],
    lecture_id: str,
    book_id: str,
    content: str,
    *,
    filename: str = "content.txt",
) -> Dict[str, Any]:
    book = get_book(cfg, lecture_id, book_id)
    if book is None:
        raise ValueError(f"Book not found: {lecture_id}/{book_id}")

    text_dir = _book_text_dir(cfg, lecture_id, book_id)
    text_dir.mkdir(parents=True, exist_ok=True)
    text_path = _book_text_path(cfg, lecture_id, book_id)
    text_path.write_text(content, encoding="utf-8")

    return update_book(
        cfg,
        lecture_id,
        book_id,
        {
            "text_status": "ready" if content.strip() else "empty",
            "text_chars": len(content),
            "text_filename": filename.strip() or "content.txt",
            "text_path": str(text_path),
            "vector_status": "idle",
            "chunks_count": 0,
            "vector_count": 0,
            "last_vectorized_at": None,
            "error": "",
        },
    ) or book


def load_book_text(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> str:
    text_path = _book_text_path(cfg, lecture_id, book_id)
    if not text_path.exists():
        return ""
    return text_path.read_text(encoding="utf-8")


def save_book_chunks(
    cfg: Dict[str, Any],
    lecture_id: str,
    book_id: str,
    chunks: Iterable[str],
) -> int:
    chunks_path = _book_chunks_path(cfg, lecture_id, book_id)
    chunks_path.parent.mkdir(parents=True, exist_ok=True)
    with chunks_path.open("w", encoding="utf-8") as handle:
        count = 0
        for index, chunk in enumerate(chunks):
            handle.write(json.dumps({"index": index, "text": chunk}, ensure_ascii=False) + "\n")
            count += 1
    return count


def load_book_chunks(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> List[str]:
    chunks_path = _book_chunks_path(cfg, lecture_id, book_id)
    if not chunks_path.exists():
        return []

    chunks: List[str] = []
    for line in chunks_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            chunks.append(str(json.loads(line).get("text") or ""))
        except Exception:
            continue
    return chunks


def save_book_papi_request(
    cfg: Dict[str, Any],
    lecture_id: str,
    book_id: str,
    payload: Dict[str, Any],
) -> str:
    request_path = _book_papi_request_path(cfg, lecture_id, book_id)
    request_path.parent.mkdir(parents=True, exist_ok=True)
    _write_json(request_path, payload)
    return str(request_path)


def initialize_lecture_dirs(
    cfg: Dict[str, Any],
    lecture_id: str,
    extra_dirs: Optional[List[str]] = None,
) -> Dict[str, str]:
    lecture_dir = _lecture_dir(cfg, lecture_id)
    lecture_dir.mkdir(parents=True, exist_ok=True)

    books_dir = _books_dir(cfg, lecture_id)
    books_dir.mkdir(parents=True, exist_ok=True)

    created = {
        "lecture": str(lecture_dir),
        "books": str(books_dir),
    }

    for name in extra_dirs or []:
        safe_name = str(name or "").strip().strip("/\\")
        if not safe_name:
            continue
        path = lecture_dir / safe_name
        path.mkdir(parents=True, exist_ok=True)
        created[safe_name] = str(path)

    return created


def _read_json(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_json(path: Path, data: Any) -> None:
    with _lock:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _increment_lecture_field(cfg: Dict[str, Any], lecture_id: str, field: str, delta: int) -> None:
    with _lock:
        lecture = get_lecture(cfg, lecture_id)
        if lecture is None:
            return
        lecture[field] = max(0, int(lecture.get(field) or 0) + delta)
        lecture["updated_at"] = int(time.time())
        _write_json(_lecture_json_path(cfg, lecture_id), lecture)
