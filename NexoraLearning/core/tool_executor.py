"""Local tool execution for NexoraLearning."""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Mapping

from .lectures import (
    create_book,
    create_lecture,
    get_book,
    get_lecture,
    list_books,
    load_book_chunks,
    load_book_text,
    save_book_text,
)
from .tools import TOOLS
from .vector import queue_vectorize_book, vectorize_book


class ToolExecutor:
    """Executes local NexoraLearning tool calls."""

    def __init__(self, cfg: Mapping[str, Any]):
        self.cfg = dict(cfg or {})
        self._handlers: Dict[str, Callable[..., Dict[str, Any]]] = {
            "createLecture": self.create_lecture,
            "createBook": self.create_book,
            "uploadBookText": self.upload_book_text,
            "getLecture": self.get_lecture,
            "getBook": self.get_book,
            "getBookText": self.get_book_text,
            "triggerBookVectorization": self.trigger_book_vectorization,
            "vectorSearch": self.vector_search,
        }

    @property
    def tools(self) -> List[Dict[str, Any]]:
        return TOOLS

    def execute(self, tool_name: str, arguments: Mapping[str, Any] | None = None) -> Dict[str, Any]:
        try:
            handler = self._handlers[tool_name]
        except KeyError as exc:
            raise ValueError(f"Unsupported tool: {tool_name}") from exc
        return handler(**dict(arguments or {}))

    def create_lecture(
        self,
        title: str,
        description: str = "",
        category: str = "",
        status: str = "draft",
    ) -> Dict[str, Any]:
        lecture = create_lecture(
            self.cfg,
            title,
            description=description,
            category=category,
            status=status,
        )
        return {"success": True, "lecture": lecture}

    def create_book(
        self,
        lecture_id: str,
        title: str,
        description: str = "",
        source_type: str = "text",
        cover_path: str = "",
    ) -> Dict[str, Any]:
        book = create_book(
            self.cfg,
            lecture_id,
            title,
            description=description,
            source_type=source_type,
            cover_path=cover_path,
        )
        return {"success": True, "book": book}

    def upload_book_text(
        self,
        lecture_id: str,
        book_id: str,
        content: str,
        filename: str = "content.txt",
        auto_vectorize: bool = True,
    ) -> Dict[str, Any]:
        if not str(content or "").strip():
            raise ValueError("content is required.")

        book = save_book_text(
            self.cfg,
            lecture_id,
            book_id,
            content,
            filename=filename,
        )

        vectorization = None
        if auto_vectorize:
            vectorization = queue_vectorize_book(self.cfg, lecture_id, book_id, force=True)

        return {"success": True, "book": book, "vectorization": vectorization}

    def get_lecture(self, lecture_id: str) -> Dict[str, Any]:
        lecture = get_lecture(self.cfg, lecture_id)
        if lecture is None:
            raise ValueError(f"Lecture not found: {lecture_id}")
        books = list_books(self.cfg, lecture_id)
        return {"success": True, "lecture": lecture, "books": books}

    def get_book(self, lecture_id: str, book_id: str) -> Dict[str, Any]:
        book = get_book(self.cfg, lecture_id, book_id)
        if book is None:
            raise ValueError(f"Book not found: {lecture_id}/{book_id}")
        return {"success": True, "book": book}

    def get_book_text(self, lecture_id: str, book_id: str) -> Dict[str, Any]:
        book = get_book(self.cfg, lecture_id, book_id)
        if book is None:
            raise ValueError(f"Book not found: {lecture_id}/{book_id}")
        content = load_book_text(self.cfg, lecture_id, book_id)
        return {"success": True, "book": book, "content": content, "chars": len(content)}

    def trigger_book_vectorization(
        self,
        lecture_id: str,
        book_id: str,
        force: bool = False,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        async_mode = bool(kwargs.get("async", True))
        if async_mode:
            result = queue_vectorize_book(self.cfg, lecture_id, book_id, force=force)
        else:
            result = vectorize_book(self.cfg, lecture_id, book_id, force=force)
        return {"success": True, "vectorization": result}

    def vector_search(
        self,
        lecture_id: str,
        query: str,
        book_id: str = "",
        top_k: int = 5,
    ) -> Dict[str, Any]:
        query_text = str(query or "").strip()
        if not query_text:
            raise ValueError("query is required.")

        candidate_books = []
        if book_id:
            book = get_book(self.cfg, lecture_id, book_id)
            if book is None:
                raise ValueError(f"Book not found: {lecture_id}/{book_id}")
            candidate_books = [book]
        else:
            candidate_books = list_books(self.cfg, lecture_id)

        rows: List[Dict[str, Any]] = []
        for book in candidate_books:
            chunks = load_book_chunks(self.cfg, lecture_id, book["id"])
            for index, chunk in enumerate(chunks):
                score = _score_text(query_text, chunk)
                if score <= 0:
                    continue
                rows.append(
                    {
                        "lecture_id": lecture_id,
                        "book_id": book["id"],
                        "book_title": book.get("title") or "",
                        "chunk_index": index,
                        "score": score,
                        "text": chunk,
                    }
                )

        rows.sort(key=lambda item: item["score"], reverse=True)
        limit = max(1, min(int(top_k or 5), 20))
        return {
            "success": True,
            "query": query_text,
            "results": rows[:limit],
            "count": min(len(rows), limit),
            "placeholder": True,
        }


def _score_text(query: str, text: str) -> float:
    query_value = str(query or "").strip().lower()
    text_value = str(text or "").lower()
    if not query_value or not text_value:
        return 0.0

    score = 0.0
    if query_value in text_value:
        score += 10.0

    tokens = [token for token in re.split(r"\s+", query_value) if token]
    if tokens:
        for token in tokens:
            if token in text_value:
                score += 2.0
    else:
        for char in set(query_value):
            if char.strip() and char in text_value:
                score += 0.2

    return score
