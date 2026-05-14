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

    @staticmethod
    def _clean_text(value: Any, limit: int = 240) -> str:
        text = str(value or "").strip()
        if len(text) <= limit:
            return text
        return text[: max(0, limit - 3)].rstrip() + "..."

    def _lecture_payload(self, lecture: Mapping[str, Any], *, books_count: int | None = None) -> Dict[str, Any]:
        row = dict(lecture or {})
        result = {
            "id": str(row.get("id") or "").strip(),
            "title": str(row.get("title") or "").strip(),
            "description": self._clean_text(row.get("description") or "", limit=320),
            "category": str(row.get("category") or "").strip(),
            "status": str(row.get("status") or "").strip() or "draft",
            "progress": self._coerce_int(row.get("progress"), 0),
            "current_chapter": str(row.get("current_chapter") or "").strip(),
        }
        if books_count is not None:
            result["books_count"] = int(books_count)
        summary_bits = [
            result["title"] or result["id"],
            f"状态 {result['status']}",
        ]
        if result["category"]:
            summary_bits.append(f"分类 {result['category']}")
        if books_count is not None:
            summary_bits.append(f"{int(books_count)} 本教材")
        if result["progress"] > 0:
            summary_bits.append(f"进度 {result['progress']}%")
        if result["current_chapter"]:
            summary_bits.append(f"当前章节 {result['current_chapter']}")
        result["summary"] = " | ".join(summary_bits)
        return result

    def _book_payload(self, book: Mapping[str, Any]) -> Dict[str, Any]:
        row = dict(book or {})
        result = {
            "id": str(row.get("id") or "").strip(),
            "lecture_id": str(row.get("lecture_id") or "").strip(),
            "title": str(row.get("title") or "").strip(),
            "description": self._clean_text(row.get("description") or "", limit=320),
            "source_type": str(row.get("source_type") or "").strip() or "text",
            "text_status": str(row.get("text_status") or "").strip() or "empty",
            "text_chars": self._coerce_int(row.get("text_chars"), 0),
            "images_count": self._coerce_int(row.get("images_count"), 0),
            "refinement_status": str(row.get("refinement_status") or "").strip() or "empty",
            "coarse_status": str(row.get("coarse_status") or "").strip() or "idle",
            "intensive_status": str(row.get("intensive_status") or "").strip() or "idle",
            "question_status": str(row.get("question_status") or "").strip() or "idle",
            "section_status": str(row.get("section_status") or "").strip() or "idle",
            "vector_status": str(row.get("vector_status") or "").strip() or "idle",
            "chunks_count": self._coerce_int(row.get("chunks_count"), 0),
            "vector_count": self._coerce_int(row.get("vector_count"), 0),
            "error": self._clean_text(row.get("error") or row.get("refinement_error") or "", limit=200),
        }
        summary_bits = [
            result["title"] or result["id"],
            f"文本 {result['text_status']}",
            f"粗读 {result['coarse_status']}",
            f"精读 {result['intensive_status']}",
            f"分节 {result['section_status']}",
        ]
        if result["text_chars"] > 0:
            summary_bits.append(f"{result['text_chars']} 字")
        if result["images_count"] > 0:
            summary_bits.append(f"{result['images_count']} 张图")
        if result["chunks_count"] > 0:
            summary_bits.append(f"{result['chunks_count']} 个切片")
        if result["error"]:
            summary_bits.append(f"错误: {result['error']}")
        result["summary"] = " | ".join(summary_bits)
        return result

    def _xml_payload(self, book: Mapping[str, Any], content: str, *, kind: str) -> Dict[str, Any]:
        book_payload = self._book_payload(book)
        return {
            "success": True,
            "kind": kind,
            "book": book_payload,
            "content": str(content or ""),
            "chars": len(str(content or "")),
            "summary": f"{book_payload.get('title') or book_payload.get('id')} 的 {kind}，长度 {len(str(content or ''))} 字符",
        }

    @staticmethod
    def _vectorization_payload(result: Mapping[str, Any] | None) -> Dict[str, Any]:
        row = dict(result or {})
        return {
            "success": bool(row.get("success", True)),
            "status": str(row.get("status") or row.get("vector_status") or "").strip(),
            "message": str(row.get("message") or row.get("error") or "").strip(),
            "chunks_count": int(row.get("chunks_count") or 0),
            "vector_count": int(row.get("vector_count") or 0),
            "summary": " | ".join(
                [
                    part
                    for part in [
                        str(row.get("status") or row.get("vector_status") or "").strip(),
                        f"{int(row.get('chunks_count') or 0)} 个切片" if int(row.get("chunks_count") or 0) > 0 else "",
                        f"{int(row.get('vector_count') or 0)} 条向量" if int(row.get("vector_count") or 0) > 0 else "",
                        str(row.get("message") or row.get("error") or "").strip(),
                    ]
                    if part
                ]
            ),
        }

    def list_lectures(self) -> Dict[str, Any]:
        lectures = list_learning_lectures(self.cfg)
        rows = [self._lecture_payload(item) for item in lectures]
        return {"success": True, "lectures": rows, "total": len(rows)}

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
        return {"success": True, "lecture": self._lecture_payload(lecture)}

    def update_lecture(self, lecture_id: str, **kwargs: Any) -> Dict[str, Any]:
        updates = {key: kwargs[key] for key in ("title", "description", "category", "status") if key in kwargs}
        if not updates:
            raise ValueError("No valid lecture fields provided.")
        lecture = update_learning_lecture(self.cfg, lecture_id, updates)
        if lecture is None:
            raise ValueError(f"Lecture not found: {lecture_id}")
        return {"success": True, "lecture": self._lecture_payload(lecture)}

    def get_lecture(self, lecture_id: str) -> Dict[str, Any]:
        lecture = self._require_lecture(lecture_id)
        books = list_learning_books(self.cfg, lecture_id)
        return {
            "success": True,
            "lecture": self._lecture_payload(lecture, books_count=len(books)),
            "books": [self._book_payload(item) for item in books],
            "total_books": len(books),
        }

    def list_books(self, lecture_id: str) -> Dict[str, Any]:
        lecture = self._require_lecture(lecture_id)
        books = list_learning_books(self.cfg, lecture_id)
        return {
            "success": True,
            "lecture": self._lecture_payload(lecture, books_count=len(books)),
            "books": [self._book_payload(item) for item in books],
            "total": len(books),
        }

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
        return {"success": True, "book": self._book_payload(book)}

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
        return {"success": True, "book": self._book_payload(book)}

    def get_book(self, lecture_id: str, book_id: str) -> Dict[str, Any]:
        book = self._require_book(lecture_id, book_id)
        return {"success": True, "book": self._book_payload(book)}

    def get_book_text(self, lecture_id: str, book_id: str) -> Dict[str, Any]:
        book = self._require_book(lecture_id, book_id)
        content = load_learning_book_text(self.cfg, lecture_id, book_id)
        return {
            "success": True,
            "book": self._book_payload(book),
            "content": content,
            "chars": len(content),
            "summary": f"{str(book.get('title') or book_id)} 正文长度 {len(content)} 字符",
        }

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
            "book": self._book_payload(book),
            "offset": start,
            "length": end - start,
            "chars": total_len,
            "content": text,
            "text": text,
            "summary": f"{str(book.get('title') or book_id)} 正文片段 [{start}, {end})，共 {end - start} 字符",
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
            "summary": f"命中 {len(hits)} 条与“{query_text}”相关的文本片段",
        }

    def get_book_info_xml(self, lecture_id: str, book_id: str) -> Dict[str, Any]:
        book = self._require_book(lecture_id, book_id)
        content = load_learning_book_info_xml(self.cfg, lecture_id, book_id)
        return self._xml_payload(book, content, kind="粗读 XML")

    def save_book_info_xml(self, lecture_id: str, book_id: str, content: str) -> Dict[str, Any]:
        if not str(content or "").strip():
            raise ValueError("content is required.")
        book = self._require_book(lecture_id, book_id)
        save_learning_book_info_xml(self.cfg, lecture_id, book_id, content)
        return {
            "success": True,
            "book": self._book_payload(book),
            "chars": len(content),
            "summary": f"{str(book.get('title') or book_id)} 的粗读 XML 已更新，长度 {len(content)} 字符",
        }

    def get_book_detail_xml(self, lecture_id: str, book_id: str) -> Dict[str, Any]:
        book = self._require_book(lecture_id, book_id)
        content = load_learning_book_detail_xml(self.cfg, lecture_id, book_id)
        return self._xml_payload(book, content, kind="精读 XML")

    def save_book_detail_xml(self, lecture_id: str, book_id: str, content: str) -> Dict[str, Any]:
        if not str(content or "").strip():
            raise ValueError("content is required.")
        book = self._require_book(lecture_id, book_id)
        save_learning_book_detail_xml(self.cfg, lecture_id, book_id, content)
        return {
            "success": True,
            "book": self._book_payload(book),
            "chars": len(content),
            "summary": f"{str(book.get('title') or book_id)} 的精读 XML 已更新，长度 {len(content)} 字符",
        }

    def get_book_questions_xml(self, lecture_id: str, book_id: str) -> Dict[str, Any]:
        book = self._require_book(lecture_id, book_id)
        content = load_learning_book_questions_xml(self.cfg, lecture_id, book_id)
        return self._xml_payload(book, content, kind="题目 XML")

    def save_book_questions_xml(self, lecture_id: str, book_id: str, content: str) -> Dict[str, Any]:
        if not str(content or "").strip():
            raise ValueError("content is required.")
        book = self._require_book(lecture_id, book_id)
        save_learning_book_questions_xml(self.cfg, lecture_id, book_id, content)
        return {
            "success": True,
            "book": self._book_payload(book),
            "chars": len(content),
            "summary": f"{str(book.get('title') or book_id)} 的题目 XML 已更新，长度 {len(content)} 字符",
        }

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

        return {
            "success": True,
            "book": self._book_payload(book),
            "vectorization": self._vectorization_payload(vectorization),
        }

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
        return {"success": True, "vectorization": self._vectorization_payload(result)}

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
            "summary": f"向量检索返回 {min(len(rows), limit)} 条与“{query_text}”最相关的片段",
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
