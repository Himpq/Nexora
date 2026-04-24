"""Vectorization helpers for lecture books.

This module prepares NexoraDB PAPI payloads and stores placeholder results
locally until the real PAPI integration is wired in by Nexora.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Dict, List, Optional

from . import parser
from .lectures import (
    get_book,
    get_lecture,
    load_book_text,
    save_book_chunks,
    save_book_papi_request,
    update_book,
    update_lecture,
)

_thread_lock = threading.Lock()


class NexoraVectorPAPIPlaceholder:
    """Builds the future PAPI request and returns placeholder vector ids."""

    provider_name = "nexoradb_papi_placeholder"

    def __init__(self, cfg: Dict[str, Any]):
        self.cfg = dict(cfg or {})

    def build_book_upsert_payload(
        self,
        lecture: Dict[str, Any],
        book: Dict[str, Any],
        chunks: List[str],
    ) -> Dict[str, Any]:
        lecture_id = str(lecture.get("id") or "")
        book_id = str(book.get("id") or "")
        return {
            "provider": self.provider_name,
            "username": "nexoralearning",
            "library": f"lecture_{lecture_id}",
            "operation": "upsert_texts",
            "items": [
                {
                    "title": book.get("title") or lecture.get("title") or "",
                    "text": chunk,
                    "chunk_id": index,
                    "metadata": {
                        "lecture_id": lecture_id,
                        "lecture_title": lecture.get("title") or "",
                        "book_id": book_id,
                        "book_title": book.get("title") or "",
                    },
                }
                for index, chunk in enumerate(chunks)
            ],
        }

    def upsert_book_chunks(
        self,
        cfg: Dict[str, Any],
        lecture: Dict[str, Any],
        book: Dict[str, Any],
        chunks: List[str],
    ) -> Dict[str, Any]:
        payload = self.build_book_upsert_payload(lecture, book, chunks)
        request_path = save_book_papi_request(cfg, lecture["id"], book["id"], payload)
        vector_ids = [f'{book["id"]}_chunk_{index}' for index in range(len(chunks))]
        return {
            "success": True,
            "provider": self.provider_name,
            "placeholder": True,
            "request_path": request_path,
            "vector_ids": vector_ids,
        }


def vectorize_book(
    cfg: Dict[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    force: bool = False,
) -> Dict[str, Any]:
    lecture = get_lecture(cfg, lecture_id)
    if lecture is None:
        raise ValueError(f"Lecture not found: {lecture_id}")

    book = get_book(cfg, lecture_id, book_id)
    if book is None:
        raise ValueError(f"Book not found: {lecture_id}/{book_id}")

    text = load_book_text(cfg, lecture_id, book_id)
    if not text.strip():
        raise ValueError("Book text is empty.")

    if not force and str(book.get("vector_status") or "") == "vectorizing":
        return {
            "success": True,
            "queued": False,
            "status": "vectorizing",
            "book": book,
        }

    update_book(
        cfg,
        lecture_id,
        book_id,
        {
            "vector_status": "vectorizing",
            "error": "",
        },
    )

    chunks = parser.chunk_text(text)
    chunk_count = save_book_chunks(cfg, lecture_id, book_id, chunks)

    placeholder_client = NexoraVectorPAPIPlaceholder(cfg)
    result = placeholder_client.upsert_book_chunks(cfg, lecture, book, chunks)
    vector_ids = result.get("vector_ids") or []
    now = int(time.time())

    updated_book = update_book(
        cfg,
        lecture_id,
        book_id,
        {
            "vector_status": "done",
            "vector_provider": result.get("provider") or placeholder_client.provider_name,
            "vector_request_path": result.get("request_path") or "",
            "chunks_count": chunk_count,
            "vector_count": len(vector_ids),
            "last_vectorized_at": now,
            "error": "",
        },
    ) or book

    books = [
        candidate
        for candidate in (get_book(cfg, lecture_id, current["id"]) for current in _safe_list_books(cfg, lecture_id))
        if candidate
    ]
    update_lecture(
        cfg,
        lecture_id,
        {
            "vector_count": sum(int(item.get("vector_count") or 0) for item in books),
            "updated_at": now,
        },
    )

    return {
        "success": True,
        "queued": False,
        "status": "done",
        "chunks_count": chunk_count,
        "vector_count": len(vector_ids),
        "placeholder": bool(result.get("placeholder")),
        "request_path": result.get("request_path") or "",
        "book": updated_book,
    }


def queue_vectorize_book(
    cfg: Dict[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    force: bool = False,
) -> Dict[str, Any]:
    book = get_book(cfg, lecture_id, book_id)
    if book is None:
        raise ValueError(f"Book not found: {lecture_id}/{book_id}")

    with _thread_lock:
        update_book(
            cfg,
            lecture_id,
            book_id,
            {
                "vector_status": "queued",
                "error": "",
            },
        )
        threading.Thread(
            target=_vectorize_book_safe,
            args=(dict(cfg), lecture_id, book_id, force),
            daemon=True,
        ).start()

    return {
        "success": True,
        "queued": True,
        "status": "queued",
    }


def _vectorize_book_safe(cfg: Dict[str, Any], lecture_id: str, book_id: str, force: bool) -> None:
    try:
        vectorize_book(cfg, lecture_id, book_id, force=force)
    except Exception as exc:
        update_book(
            cfg,
            lecture_id,
            book_id,
            {
                "vector_status": "error",
                "error": str(exc),
            },
        )


def _safe_list_books(cfg: Dict[str, Any], lecture_id: str) -> List[Dict[str, Any]]:
    from .lectures import list_books

    return list_books(cfg, lecture_id)
