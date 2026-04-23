"""Lecture storage helpers for NexoraLearning.

Directory layout:
  data/
    lectures/
      {lecture_id}/
        lecture.json
        books/
          {book_id}/
            book.json
"""

from __future__ import annotations

import json
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

_lock = threading.Lock()


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
    course_id: str = "",
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
        "course_id": course_id.strip(),
        "category": category.strip(),
        "status": status.strip() or "draft",
        "created_at": now,
        "updated_at": now,
        "book_count": 0,
        "progress": 0,
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

    lecture.update(dict(updates or {}))
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
    source_type: str = "placeholder",
    cover_path: str = "",
) -> Dict[str, Any]:
    if get_lecture(cfg, lecture_id) is None:
        raise ValueError(f"Lecture not found: {lecture_id}")

    book_id = f"b_{uuid.uuid4().hex[:12]}"
    book_dir = _book_dir(cfg, lecture_id, book_id)
    book_dir.mkdir(parents=True, exist_ok=True)

    now = int(time.time())
    book = {
        "id": book_id,
        "lecture_id": lecture_id,
        "title": title.strip(),
        "description": description.strip(),
        "source_type": source_type.strip() or "placeholder",
        "cover_path": cover_path.strip(),
        "created_at": now,
        "updated_at": now,
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

    book.update(dict(updates or {}))
    book["updated_at"] = int(time.time())
    _write_json(_book_json_path(cfg, lecture_id, book_id), book)
    return book


def delete_book(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> bool:
    book_dir = _book_dir(cfg, lecture_id, book_id)
    if not book_dir.exists():
        return False
    shutil.rmtree(str(book_dir))
    _increment_lecture_field(cfg, lecture_id, "book_count", -1)
    return True


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
