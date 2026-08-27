"""Lecture and book storage helpers for NexoraLearning.

Directory layout:
  data/
    lectures/
      {lecture_id}/
        lecture.json
        books/
          {book_id}/
            book.json
            bookinfo.xml
            bookdetail.xml
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
from typing import Any, Dict, Iterable, List, Optional, Tuple
from .utils import read_chunks_jsonl, write_chunks_jsonl

_lock = threading.RLock()
_LECTURE_LIST_CACHE: Dict[str, Tuple[Tuple[Tuple[str, int, int], ...], List[Dict[str, Any]]]] = {}
_BOOK_LIST_CACHE: Dict[str, Tuple[Tuple[Tuple[str, int, int], ...], List[Dict[str, Any]]]] = {}
_BOOK_SUMMARY_KEYS = {
    "coarse_output",
    "coarse_model_name",
    "current_chapter",
    "next_chapter",
}


def _normalize_teacher_list(value: Any) -> List[str]:
    if isinstance(value, str):
        raw_items = [value]
    elif isinstance(value, (list, tuple, set, frozenset)):
        raw_items = list(value)
    else:
        raw_items = []

    rows: List[str] = []
    seen = set()
    for item in raw_items:
        teacher_id = str(item or "").strip()
        if not teacher_id or teacher_id in seen:
            continue
        seen.add(teacher_id)
        rows.append(teacher_id)
    return rows


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


def _book_info_xml_path(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_dir(cfg, lecture_id, book_id) / "bookinfo.xml"


def _book_detail_xml_path(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_dir(cfg, lecture_id, book_id) / "bookdetail.xml"


def _book_questions_xml_path(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_dir(cfg, lecture_id, book_id) / "questions.xml"


def _book_sections_xml_path(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_dir(cfg, lecture_id, book_id) / "sections.xml"


def _book_text_dir(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_dir(cfg, lecture_id, book_id) / "text"


def _book_assets_dir(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_dir(cfg, lecture_id, book_id) / "assets"


def _book_images_dir(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_assets_dir(cfg, lecture_id, book_id) / "images"


def _book_images_meta_path(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_images_dir(cfg, lecture_id, book_id) / "images.json"


def _book_original_dir(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_dir(cfg, lecture_id, book_id) / "original"


def _book_text_path(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_text_dir(cfg, lecture_id, book_id) / "content.txt"


def _book_structure_path(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_text_dir(cfg, lecture_id, book_id) / "structure.json"


def _book_vectors_dir(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_dir(cfg, lecture_id, book_id) / "vectors"


def _book_chunks_path(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Path:
    return _book_vectors_dir(cfg, lecture_id, book_id) / "chunks.jsonl"


def _json_children_signature(root: Path, json_filename: str) -> Tuple[Tuple[str, int, int], ...]:
    if not root.exists():
        return tuple()

    rows: List[Tuple[str, int, int]] = []

    for entry in sorted(root.iterdir()):
        json_path = entry / json_filename

        if not entry.is_dir() or not json_path.exists():
            continue

        stat = json_path.stat()
        rows.append((entry.name, int(stat.st_mtime_ns), int(stat.st_size)))

    return tuple(rows)


def _copy_metadata_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [dict(row or {}) for row in rows]


def _invalidate_lecture_metadata_cache(cfg: Dict[str, Any], lecture_id: str = "") -> None:
    root_key = str(_lectures_root(cfg).resolve())
    _LECTURE_LIST_CACHE.pop(root_key, None)

    lecture_key = str(lecture_id or "").strip()

    if lecture_key:
        _BOOK_LIST_CACHE.pop(str(_books_dir(cfg, lecture_key).resolve()), None)
        return

    _BOOK_LIST_CACHE.clear()


def ensure_lecture_root(cfg: Dict[str, Any]) -> Path:
    root = _lectures_root(cfg)
    root.mkdir(parents=True, exist_ok=True)
    return root


def list_lectures(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    root = _lectures_root(cfg)
    if not root.exists():
        return []

    cache_key = str(root.resolve())
    signature = _json_children_signature(root, "lecture.json")
    cached = _LECTURE_LIST_CACHE.get(cache_key)

    if cached and cached[0] == signature:
        return _copy_metadata_rows(cached[1])

    lectures: List[Dict[str, Any]] = []
    for entry in sorted(root.iterdir()):
        lecture_path = entry / "lecture.json"
        if entry.is_dir() and lecture_path.exists():
            data = _read_json(lecture_path)
            if data:
                lectures.append(data)

    _LECTURE_LIST_CACHE[cache_key] = (signature, _copy_metadata_rows(lectures))
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
    teacher: Any = None,
    cover_path: str = "",
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
        "teacher": _normalize_teacher_list(teacher),
        "cover_path": str(cover_path or "").strip(),
        "created_at": now,
        "updated_at": now,
        "book_count": 0,
        "vector_count": 0,
    }
    _write_json(_lecture_json_path(cfg, lecture_id), lecture)
    _invalidate_lecture_metadata_cache(cfg, lecture_id)
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
    if "teacher" in sanitized:
        sanitized["teacher"] = _normalize_teacher_list(sanitized.get("teacher"))
    if "cover_path" in sanitized:
        sanitized["cover_path"] = str(sanitized.get("cover_path") or "").strip()
    lecture.update(sanitized)
    lecture["teacher"] = _normalize_teacher_list(lecture.get("teacher"))
    lecture["updated_at"] = int(time.time())
    _write_json(_lecture_json_path(cfg, lecture_id), lecture)
    _invalidate_lecture_metadata_cache(cfg, lecture_id)
    return lecture


def delete_lecture(cfg: Dict[str, Any], lecture_id: str) -> bool:
    lecture_dir = _lecture_dir(cfg, lecture_id)
    if not lecture_dir.exists():
        return False
    shutil.rmtree(str(lecture_dir))
    _invalidate_lecture_metadata_cache(cfg, lecture_id)
    return True


def list_books(cfg: Dict[str, Any], lecture_id: str) -> List[Dict[str, Any]]:
    books_dir = _books_dir(cfg, lecture_id)
    if not books_dir.exists():
        return []

    cache_key = str(books_dir.resolve())
    signature = _json_children_signature(books_dir, "book.json")
    cached = _BOOK_LIST_CACHE.get(cache_key)

    if cached and cached[0] == signature:
        return _copy_metadata_rows(cached[1])

    books: List[Dict[str, Any]] = []
    for entry in sorted(books_dir.iterdir()):
        book_path = entry / "book.json"
        if entry.is_dir() and book_path.exists():
            data = _read_json(book_path)
            if data:
                books.append(_sanitize_book_metadata(cfg, lecture_id, data))

    _BOOK_LIST_CACHE[cache_key] = (signature, _copy_metadata_rows(books))
    return books


def get_book(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Optional[Dict[str, Any]]:
    data = _read_json(_book_json_path(cfg, lecture_id, book_id))
    if not isinstance(data, dict):
        return data
    return _sanitize_book_metadata(cfg, lecture_id, data)


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
    _book_original_dir(cfg, lecture_id, book_id).mkdir(parents=True, exist_ok=True)
    _book_text_dir(cfg, lecture_id, book_id).mkdir(parents=True, exist_ok=True)
    _book_images_dir(cfg, lecture_id, book_id).mkdir(parents=True, exist_ok=True)
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
        "images_count": 0,
        "original_filename": "",
        "original_path": "",
        "refinement_status": "empty",
        "refinement_error": "",
        "refinement_job_id": "",
        "refinement_requested_at": None,
        "refined_at": None,
        "coarse_status": "idle",
        "coarse_error": "",
        "intensive_status": "idle",
        "intensive_error": "",
        "intensive_model": "",
        "question_status": "idle",
        "question_error": "",
        "question_model": "",
        "section_status": "idle",
        "section_error": "",
        "section_model": "",
        "annotation_status": "idle",
        "annotation_error": "",
        "annotation_model": "",
        "video_status": "idle",
        "video_error": "",
        "pipeline_status": "idle",
        "pipeline_error": "",
        "pipeline_job_id": "",
        "pipeline_requested_at": None,
        "pipeline_finished_at": None,
        "summary_status": "idle",
        "summary_error": "",
        "summary_model": "",
        "summary_at": None,
        "vector_status": "idle",
        "vector_provider": "nexoradb_service",
        "chunks_count": 0,
        "vector_count": 0,
        "last_vectorized_at": None,
        "error": "",
    }
    _write_json(_book_json_path(cfg, lecture_id, book_id), book)
    _write_text(_book_info_xml_path(cfg, lecture_id, book_id), "")
    _write_text(_book_detail_xml_path(cfg, lecture_id, book_id), "")
    _write_text(_book_questions_xml_path(cfg, lecture_id, book_id), "")
    _write_text(_book_sections_xml_path(cfg, lecture_id, book_id), "")
    _invalidate_lecture_metadata_cache(cfg, lecture_id)
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
    for key in _BOOK_SUMMARY_KEYS:
        sanitized.pop(key, None)
    book.update(sanitized)
    for key in _BOOK_SUMMARY_KEYS:
        book.pop(key, None)
    book["updated_at"] = int(time.time())
    _write_json(_book_json_path(cfg, lecture_id, book_id), book)
    _invalidate_lecture_metadata_cache(cfg, lecture_id)
    return book


def delete_book(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> bool:
    book_dir = _book_dir(cfg, lecture_id, book_id)
    book = get_book(cfg, lecture_id, book_id)
    if not book_dir.exists():
        return False
    shutil.rmtree(str(book_dir))
    _invalidate_lecture_metadata_cache(cfg, lecture_id)
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
            "refinement_status": "extracted" if content.strip() else "empty",
            "refinement_error": "",
            "coarse_error": "",
            "intensive_status": "idle",
            "intensive_error": "",
            "intensive_model": "",
            "question_status": "idle",
            "question_error": "",
            "question_model": "",
            "section_status": "idle",
            "section_error": "",
            "section_model": "",
            "vector_status": "idle",
            "chunks_count": 0,
            "vector_count": 0,
            "last_vectorized_at": None,
            "error": "",
        },
    ) or book


def save_book_images_meta(
    cfg: Dict[str, Any],
    lecture_id: str,
    book_id: str,
    images: Iterable[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    rows = [dict(item or {}) for item in (images or []) if isinstance(item, dict)]
    images_dir = _book_images_dir(cfg, lecture_id, book_id)
    images_dir.mkdir(parents=True, exist_ok=True)
    path = _book_images_meta_path(cfg, lecture_id, book_id)
    _write_json(path, rows)
    update_book(
        cfg,
        lecture_id,
        book_id,
        {
            "images_count": len(rows),
        },
    )
    return rows


def load_book_images_meta(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> List[Dict[str, Any]]:
    path = _book_images_meta_path(cfg, lecture_id, book_id)
    if not path.exists():
        return []
    data = _read_json(path)
    if isinstance(data, list):
        return [dict(item or {}) for item in data if isinstance(item, dict)]
    return []


def get_book_image_path(cfg: Dict[str, Any], lecture_id: str, book_id: str, image_id: str) -> Optional[Path]:
    safe_id = str(image_id or "").strip()
    if not safe_id:
        return None
    for item in load_book_images_meta(cfg, lecture_id, book_id):
        if str(item.get("id") or "").strip() != safe_id:
            continue
        file_name = str(item.get("file_name") or "").strip()
        if not file_name:
            return None
        path = _book_images_dir(cfg, lecture_id, book_id) / file_name
        return path if path.exists() else None
    return None


def list_book_cover_assets(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> List[Dict[str, Any]]:
    book = get_book(cfg, lecture_id, book_id) or {}
    book_title = str(book.get("title") or book_id or "").strip()
    rows: List[Dict[str, Any]] = []

    for item in load_book_images_meta(cfg, lecture_id, book_id):
        image_id = str(item.get("id") or "").strip()
        file_name = str(item.get("file_name") or "").strip()

        if not image_id or not file_name:
            continue

        image_path = _book_images_dir(cfg, lecture_id, book_id) / file_name
        if not image_path.exists():
            continue

        cover_path = f"/api/lectures/{lecture_id}/books/{book_id}/images/{image_id}"
        rows.append(
            {
                "asset_key": f"{book_id}:{image_id}",
                "lecture_id": lecture_id,
                "book_id": book_id,
                "book_title": book_title,
                "image_id": image_id,
                "name": str(item.get("name") or file_name).strip() or file_name,
                "file_name": file_name,
                "source_path": str(item.get("source_path") or "").strip(),
                "mime_type": str(item.get("mime_type") or "").strip(),
                "size": int(item.get("size") or image_path.stat().st_size or 0),
                "alt": str(item.get("alt") or item.get("name") or image_id).strip() or image_id,
                "cover_path": cover_path,
                "image_url": cover_path,
            }
        )

    return rows


def list_lecture_cover_assets(cfg: Dict[str, Any], lecture_id: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []

    for book in list_books(cfg, lecture_id):
        book_id = str((book or {}).get("id") or "").strip()
        if not book_id:
            continue
        rows.extend(list_book_cover_assets(cfg, lecture_id, book_id))

    return rows


def save_book_original_file(
    cfg: Dict[str, Any],
    lecture_id: str,
    book_id: str,
    content: bytes,
    *,
    filename: str,
) -> Dict[str, Any]:
    book = get_book(cfg, lecture_id, book_id)
    if book is None:
        raise ValueError(f"Book not found: {lecture_id}/{book_id}")

    target_dir = _book_original_dir(cfg, lecture_id, book_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    safe_name = (filename or "").strip() or "source.bin"
    target_path = target_dir / safe_name
    target_path.write_bytes(content)

    return update_book(
        cfg,
        lecture_id,
        book_id,
        {
            "original_filename": safe_name,
            "original_path": str(target_path),
            "refinement_status": "uploaded",
            "refinement_error": "",
            "coarse_status": "idle",
            "coarse_error": "",
            "intensive_status": "idle",
            "intensive_error": "",
            "intensive_model": "",
            "question_status": "idle",
            "question_error": "",
            "question_model": "",
            "section_status": "idle",
            "section_error": "",
            "section_model": "",
            "summary_status": "idle",
            "summary_error": "",
            "summary_model": "",
            "annotation_status": "idle",
            "annotation_error": "",
            "annotation_model": "",
            "video_status": "idle",
            "video_error": "",
            "pipeline_status": "idle",
            "pipeline_error": "",
            "pipeline_job_id": "",
            "pipeline_requested_at": None,
            "pipeline_finished_at": None,
        },
    ) or book


def load_book_info_xml(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> str:
    """读取教材粗读结果 XML。"""
    path = _book_info_xml_path(cfg, lecture_id, book_id)
    if not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def save_book_info_xml(cfg: Dict[str, Any], lecture_id: str, book_id: str, content: str) -> str:
    """保存教材粗读结果 XML。"""
    path = _book_info_xml_path(cfg, lecture_id, book_id)
    _write_text(path, str(content or ""))
    return str(path)


def load_book_detail_xml(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> str:
    """读取教材精读结果 XML。"""
    path = _book_detail_xml_path(cfg, lecture_id, book_id)
    if not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def save_book_detail_xml(cfg: Dict[str, Any], lecture_id: str, book_id: str, content: str) -> str:
    """保存教材精读结果 XML。"""
    path = _book_detail_xml_path(cfg, lecture_id, book_id)
    _write_text(path, str(content or ""))
    return str(path)


def load_book_questions_xml(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> str:
    """读取教材题目结果 XML。"""
    path = _book_questions_xml_path(cfg, lecture_id, book_id)
    if not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def save_book_questions_xml(cfg: Dict[str, Any], lecture_id: str, book_id: str, content: str) -> str:
    """保存教材题目结果 XML。"""
    path = _book_questions_xml_path(cfg, lecture_id, book_id)
    _write_text(path, str(content or ""))
    return str(path)


def load_book_sections_xml(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> str:
    """读取教材分节结果 XML。"""
    path = _book_sections_xml_path(cfg, lecture_id, book_id)
    if not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def save_book_sections_xml(cfg: Dict[str, Any], lecture_id: str, book_id: str, content: str) -> str:
    """保存教材分节结果 XML。"""
    path = _book_sections_xml_path(cfg, lecture_id, book_id)
    _write_text(path, str(content or ""))
    return str(path)


def save_book_structure(
    cfg: Dict[str, Any],
    lecture_id: str,
    book_id: str,
    structure: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Persist the extractor's structural sidecar (heading index, spine map).

    Heading candidates live here instead of inside ``content.txt`` so they never
    shift body offsets or leak into search results.
    """
    rows = dict(structure or {})
    path = _book_structure_path(cfg, lecture_id, book_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    _write_json(path, rows)
    return rows


def load_book_structure(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> Dict[str, Any]:
    """Read the extractor's structural sidecar; returns ``{}`` when absent."""
    data = _read_json(_book_structure_path(cfg, lecture_id, book_id))
    return data if isinstance(data, dict) else {}


def load_book_heading_candidates(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> List[str]:
    """Return heading candidates recorded by the extractor, in document order."""
    structure = load_book_structure(cfg, lecture_id, book_id)
    rows = structure.get("heading_candidates")
    if isinstance(rows, list):
        return [str(item).strip() for item in rows if str(item or "").strip()]
    return []


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
    return write_chunks_jsonl(chunks_path, list(chunks))


def load_book_chunks(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> List[str]:
    chunks_path = _book_chunks_path(cfg, lecture_id, book_id)
    return read_chunks_jsonl(chunks_path)


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


def _write_text(path: Path, content: str) -> None:
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(str(content or ""), encoding="utf-8")


def _increment_lecture_field(cfg: Dict[str, Any], lecture_id: str, field: str, delta: int) -> None:
    with _lock:
        lecture = get_lecture(cfg, lecture_id)
        if lecture is None:
            return
        lecture[field] = max(0, int(lecture.get(field) or 0) + delta)
        lecture["updated_at"] = int(time.time())
        _write_json(_lecture_json_path(cfg, lecture_id), lecture)
        _invalidate_lecture_metadata_cache(cfg, lecture_id)


def _sanitize_book_metadata(cfg: Dict[str, Any], lecture_id: str, book: Dict[str, Any]) -> Dict[str, Any]:
    """返回不含模型摘要字段的 book 元数据副本，读路径不写回磁盘。"""
    data = dict(book or {})

    for key in _BOOK_SUMMARY_KEYS:
        data.pop(key, None)

    return data
