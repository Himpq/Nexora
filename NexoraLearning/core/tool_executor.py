"""Local tool execution for NexoraLearning."""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Mapping

from .lectures import (
    create_book as create_learning_book,
    create_lecture as create_learning_lecture,
    get_book as get_learning_book,
    get_lecture as get_learning_lecture,
    list_books as list_learning_books,
    list_lectures as list_learning_lectures,
    load_book_chunks as load_learning_book_chunks,
    load_book_detail_xml as load_learning_book_detail_xml,
    load_book_info_xml as load_learning_book_info_xml,
    load_book_questions_xml as load_learning_book_questions_xml,
    load_book_text as load_learning_book_text,
    save_book_detail_xml as save_learning_book_detail_xml,
    save_book_info_xml as save_learning_book_info_xml,
    save_book_questions_xml as save_learning_book_questions_xml,
    save_book_text as save_learning_book_text,
    update_book as update_learning_book,
    update_lecture as update_learning_lecture,
)
from .tools import TOOLS
from .vector import queue_vectorize_book, vectorize_book


MAX_BOOK_TEXT_READ_CHARS = 8000
MAX_BOOK_TEXT_SEARCH_CONTEXT = 600
MAX_BOOK_TEXT_SEARCH_HITS = 50


class ToolExecutor:
    """Executes local NexoraLearning tool calls."""

    def __init__(self, cfg: Mapping[str, Any]):
        self.cfg = dict(cfg or {})
        self._handlers: Dict[str, Callable[..., Dict[str, Any]]] = {
            "listLectures": self.list_lectures,
            "createLecture": self.create_lecture,
            "updateLecture": self.update_lecture,
            "getLecture": self.get_lecture,
            "listBooks": self.list_books,
            "createBook": self.create_book,
            "updateBook": self.update_book,
            "getBook": self.get_book,
            "getBookText": self.get_book_text,
            "readBookTextRange": self.read_book_text_range,
            "searchBookText": self.search_book_text,
            "getBookInfoXml": self.get_book_info_xml,
            "saveBookInfoXml": self.save_book_info_xml,
            "getBookDetailXml": self.get_book_detail_xml,
            "saveBookDetailXml": self.save_book_detail_xml,
            "getBookQuestionsXml": self.get_book_questions_xml,
            "saveBookQuestionsXml": self.save_book_questions_xml,
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

    def _require_lecture(self, lecture_id: str) -> Dict[str, Any]:
        lecture = get_learning_lecture(self.cfg, lecture_id)
        if lecture is None:
            raise ValueError(f"Lecture not found: {lecture_id}")
        return lecture

    def _require_book(self, lecture_id: str, book_id: str) -> Dict[str, Any]:
        book = get_learning_book(self.cfg, lecture_id, book_id)
        if book is None:
            raise ValueError(f"Book not found: {lecture_id}/{book_id}")
        return book

    @staticmethod
    def _coerce_int(value: Any, default: int = 0) -> int:
        try:
            return int(value)
        except Exception:
            return int(default)

    def list_lectures(self) -> Dict[str, Any]:
        lectures = list_learning_lectures(self.cfg)
        return {"success": True, "lectures": lectures, "total": len(lectures)}

    def create_lecture(
        self,
        title: str,
        description: str = "",
        category: str = "",
        status: str = "draft",
    ) -> Dict[str, Any]:
        lecture = create_learning_lecture(
            self.cfg,
            title,
            description=description,
            category=category,
            status=status,
        )
        return {"success": True, "lecture": lecture}

    def update_lecture(self, lecture_id: str, **kwargs: Any) -> Dict[str, Any]:
        updates = {key: kwargs[key] for key in ("title", "description", "category", "status") if key in kwargs}
        if not updates:
            raise ValueError("No valid lecture fields provided.")
        lecture = update_learning_lecture(self.cfg, lecture_id, updates)
        if lecture is None:
            raise ValueError(f"Lecture not found: {lecture_id}")
        return {"success": True, "lecture": lecture}

    def get_lecture(self, lecture_id: str) -> Dict[str, Any]:
        lecture = self._require_lecture(lecture_id)
        books = list_learning_books(self.cfg, lecture_id)
        return {"success": True, "lecture": lecture, "books": books, "total_books": len(books)}

    def list_books(self, lecture_id: str) -> Dict[str, Any]:
        self._require_lecture(lecture_id)
        books = list_learning_books(self.cfg, lecture_id)
        return {"success": True, "lecture_id": lecture_id, "books": books, "total": len(books)}

    def create_book(
        self,
        lecture_id: str,
        title: str,
        description: str = "",
        source_type: str = "text",
        cover_path: str = "",
    ) -> Dict[str, Any]:
        book = create_learning_book(
            self.cfg,
            lecture_id,
            title,
            description=description,
            source_type=source_type,
            cover_path=cover_path,
        )
        return {"success": True, "book": book}

    def update_book(self, lecture_id: str, book_id: str, **kwargs: Any) -> Dict[str, Any]:
        updates = {
            key: kwargs[key]
            for key in ("title", "description", "source_type", "cover_path", "status")
            if key in kwargs
        }
        if not updates:
            raise ValueError("No valid book fields provided.")
        book = update_learning_book(self.cfg, lecture_id, book_id, updates)
        if book is None:
            raise ValueError(f"Book not found: {lecture_id}/{book_id}")
        return {"success": True, "book": book}

    def get_book(self, lecture_id: str, book_id: str) -> Dict[str, Any]:
        book = self._require_book(lecture_id, book_id)
        return {"success": True, "book": book}

    def get_book_text(self, lecture_id: str, book_id: str) -> Dict[str, Any]:
        book = self._require_book(lecture_id, book_id)
        content = load_learning_book_text(self.cfg, lecture_id, book_id)
        return {"success": True, "book": book, "content": content, "chars": len(content)}

    def read_book_text_range(self, lecture_id: str, book_id: str, offset: int, length: int) -> Dict[str, Any]:
        book = self._require_book(lecture_id, book_id)
        content = load_learning_book_text(self.cfg, lecture_id, book_id)
        total_len = len(content)
        start = self._coerce_int(offset, default=0)
        requested_length = self._coerce_int(length, default=0)
        if start < 0:
            raise ValueError("offset must be >= 0")
        if requested_length <= 0:
            raise ValueError("length must be > 0")
        if start >= total_len:
            raise ValueError("offset out of range")
        safe_length = min(requested_length, MAX_BOOK_TEXT_READ_CHARS)
        end = min(total_len, start + safe_length)
        text = content[start:end]
        return {
            "success": True,
            "book": book,
            "offset": start,
            "length": end - start,
            "chars": total_len,
            "content": text,
            "text": text,
        }

    def search_book_text(
        self,
        lecture_id: str,
        keyword: str,
        book_id: str = "",
        context_range: int = 160,
        max_hits: int = 12,
    ) -> Dict[str, Any]:
        query_text = str(keyword or "").strip()
        if not query_text:
            raise ValueError("keyword is required.")

        search_context = self._coerce_int(context_range, default=160)
        search_context = max(20, min(MAX_BOOK_TEXT_SEARCH_CONTEXT, search_context))
        limit = self._coerce_int(max_hits, default=12)
        limit = max(1, min(MAX_BOOK_TEXT_SEARCH_HITS, limit))

        if book_id:
            candidate_books = [self._require_book(lecture_id, book_id)]
        else:
            self._require_lecture(lecture_id)
            candidate_books = list_learning_books(self.cfg, lecture_id)

        hits: List[Dict[str, Any]] = []
        needle = query_text.lower()
        for book in candidate_books:
            if len(hits) >= limit:
                break
            book_content = load_learning_book_text(self.cfg, lecture_id, str(book.get("id") or ""))
            if not book_content:
                continue
            source = book_content.lower()
            cursor = 0
            while cursor < len(source) and len(hits) < limit:
                idx = source.find(needle, cursor)
                if idx < 0:
                    break
                match_end = idx + len(query_text)
                block_start = max(0, idx - search_context)
                block_end = min(len(book_content), match_end + search_context)
                hits.append(
                    {
                        "lecture_id": lecture_id,
                        "book_id": str(book.get("id") or ""),
                        "book_title": str(book.get("title") or ""),
                        "offset": idx,
                        "match_start": idx,
                        "match_end": match_end,
                        "range": f"{block_start}:{max(0, block_end - block_start)}",
                        "text": book_content[block_start:block_end],
                    }
                )
                cursor = max(cursor + 1, match_end)

        return {
            "success": True,
            "query": query_text,
            "lecture_id": lecture_id,
            "book_id": book_id,
            "context_range": search_context,
            "hits": hits,
            "count": len(hits),
            "truncated": len(hits) >= limit,
        }

    def get_book_info_xml(self, lecture_id: str, book_id: str) -> Dict[str, Any]:
        book = self._require_book(lecture_id, book_id)
        content = load_learning_book_info_xml(self.cfg, lecture_id, book_id)
        return {"success": True, "book": book, "content": content, "chars": len(content)}

    def save_book_info_xml(self, lecture_id: str, book_id: str, content: str) -> Dict[str, Any]:
        if not str(content or "").strip():
            raise ValueError("content is required.")
        book = self._require_book(lecture_id, book_id)
        path = save_learning_book_info_xml(self.cfg, lecture_id, book_id, content)
        return {"success": True, "book": book, "path": path, "chars": len(content)}

    def get_book_detail_xml(self, lecture_id: str, book_id: str) -> Dict[str, Any]:
        book = self._require_book(lecture_id, book_id)
        content = load_learning_book_detail_xml(self.cfg, lecture_id, book_id)
        return {"success": True, "book": book, "content": content, "chars": len(content)}

    def save_book_detail_xml(self, lecture_id: str, book_id: str, content: str) -> Dict[str, Any]:
        if not str(content or "").strip():
            raise ValueError("content is required.")
        book = self._require_book(lecture_id, book_id)
        path = save_learning_book_detail_xml(self.cfg, lecture_id, book_id, content)
        return {"success": True, "book": book, "path": path, "chars": len(content)}

    def get_book_questions_xml(self, lecture_id: str, book_id: str) -> Dict[str, Any]:
        book = self._require_book(lecture_id, book_id)
        content = load_learning_book_questions_xml(self.cfg, lecture_id, book_id)
        return {"success": True, "book": book, "content": content, "chars": len(content)}

    def save_book_questions_xml(self, lecture_id: str, book_id: str, content: str) -> Dict[str, Any]:
        if not str(content or "").strip():
            raise ValueError("content is required.")
        book = self._require_book(lecture_id, book_id)
        path = save_learning_book_questions_xml(self.cfg, lecture_id, book_id, content)
        return {"success": True, "book": book, "path": path, "chars": len(content)}

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

        book = save_learning_book_text(
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

        if book_id:
            candidate_books = [self._require_book(lecture_id, book_id)]
        else:
            self._require_lecture(lecture_id)
            candidate_books = list_learning_books(self.cfg, lecture_id)

        rows: List[Dict[str, Any]] = []
        for current_book in candidate_books:
            current_book_id = str(current_book.get("id") or "").strip()
            if not current_book_id:
                continue
            chunks = load_learning_book_chunks(self.cfg, lecture_id, current_book_id)
            for index, chunk in enumerate(chunks):
                score = _score_text(query_text, chunk)
                if score <= 0:
                    continue
                rows.append(
                    {
                        "lecture_id": lecture_id,
                        "book_id": current_book_id,
                        "book_title": current_book.get("title") or "",
                        "chunk_index": index,
                        "score": score,
                        "text": chunk,
                    }
                )

        rows.sort(key=lambda item: item["score"], reverse=True)
        limit = max(1, min(self._coerce_int(top_k, default=5), 20))
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
