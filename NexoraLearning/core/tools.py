"""Tool definitions for NexoraLearning models."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence


def _string_field(description: str, *, enum: Optional[Sequence[str]] = None) -> Dict[str, Any]:
    field: Dict[str, Any] = {"type": "string", "description": description}
    if enum:
        field["enum"] = list(enum)
    return field


def _integer_field(description: str) -> Dict[str, Any]:
    return {"type": "integer", "description": description}


def _boolean_field(description: str) -> Dict[str, Any]:
    return {"type": "boolean", "description": description}


def _object_tool(
    name: str,
    description: str,
    properties: Dict[str, Any],
    required: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    parameters: Dict[str, Any] = {
        "type": "object",
        "properties": properties,
    }
    required_fields = list(required or [])
    if required_fields:
        parameters["required"] = required_fields
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters,
        },
    }


class NexoraTools:
    """Structured tool catalog for course and book operations."""

    @classmethod
    def lecture_tools(cls) -> List[Dict[str, Any]]:
        return [
            _object_tool(
                "listLectures",
                "List all lectures (course containers) in NexoraLearning.",
                {},
            ),
            _object_tool(
                "createLecture",
                "Create a new lecture container in NexoraLearning.",
                {
                    "title": _string_field("Lecture title."),
                    "description": _string_field("Optional lecture description."),
                    "category": _string_field("Optional lecture category."),
                    "status": _string_field("Lecture status, default is draft."),
                },
                ["title"],
            ),
            _object_tool(
                "getLecture",
                "Fetch lecture metadata and its book list.",
                {
                    "lecture_id": _string_field("Target lecture id."),
                },
                ["lecture_id"],
            ),
            _object_tool(
                "updateLecture",
                "Update lecture metadata.",
                {
                    "lecture_id": _string_field("Target lecture id."),
                    "title": _string_field("Updated lecture title."),
                    "description": _string_field("Updated lecture description."),
                    "category": _string_field("Updated lecture category."),
                    "status": _string_field("Updated lecture status."),
                },
                ["lecture_id"],
            ),
        ]

    @classmethod
    def book_tools(cls) -> List[Dict[str, Any]]:
        return [
            _object_tool(
                "listBooks",
                "List all books under a lecture.",
                {
                    "lecture_id": _string_field("Target lecture id."),
                },
                ["lecture_id"],
            ),
            _object_tool(
                "createBook",
                "Create a new book under a lecture.",
                {
                    "lecture_id": _string_field("Target lecture id."),
                    "title": _string_field("Book title."),
                    "description": _string_field("Optional book description."),
                    "source_type": _string_field("Source type, default is text."),
                    "cover_path": _string_field("Optional local cover path."),
                },
                ["lecture_id", "title"],
            ),
            _object_tool(
                "getBook",
                "Fetch metadata for a book.",
                {
                    "lecture_id": _string_field("Target lecture id."),
                    "book_id": _string_field("Target book id."),
                },
                ["lecture_id", "book_id"],
            ),
            _object_tool(
                "updateBook",
                "Update book metadata.",
                {
                    "lecture_id": _string_field("Target lecture id."),
                    "book_id": _string_field("Target book id."),
                    "title": _string_field("Updated book title."),
                    "description": _string_field("Updated book description."),
                    "source_type": _string_field("Updated source type."),
                    "cover_path": _string_field("Updated local cover path."),
                    "status": _string_field("Updated book status."),
                },
                ["lecture_id", "book_id"],
            ),
        ]

    @classmethod
    def content_tools(cls) -> List[Dict[str, Any]]:
        return [
            _object_tool(
                "getBookText",
                "Read the stored plain text content of a book.",
                {
                    "lecture_id": _string_field("Target lecture id."),
                    "book_id": _string_field("Target book id."),
                },
                ["lecture_id", "book_id"],
            ),
            _object_tool(
                "readBookTextRange",
                "Read a bounded slice of the parsed book text by offset and length.",
                {
                    "lecture_id": _string_field("Target lecture id."),
                    "book_id": _string_field("Target book id."),
                    "offset": _integer_field("Zero-based start offset."),
                    "length": _integer_field("Number of characters to read."),
                },
                ["lecture_id", "book_id", "offset", "length"],
            ),
            _object_tool(
                "searchBookText",
                "Search one book or all books under a lecture and return matched snippets.",
                {
                    "lecture_id": _string_field("Target lecture id."),
                    "keyword": _string_field("Search keyword or phrase."),
                    "book_id": _string_field("Optional book id filter."),
                    "context_range": _integer_field("Context characters around each hit."),
                    "max_hits": _integer_field("Maximum hits to return."),
                },
                ["lecture_id", "keyword"],
            ),
            _object_tool(
                "getBookInfoXml",
                "Read the coarse-reading structure XML (bookinfo.xml).",
                {
                    "lecture_id": _string_field("Target lecture id."),
                    "book_id": _string_field("Target book id."),
                },
                ["lecture_id", "book_id"],
            ),
            _object_tool(
                "saveBookInfoXml",
                "Save the coarse-reading structure XML (bookinfo.xml).",
                {
                    "lecture_id": _string_field("Target lecture id."),
                    "book_id": _string_field("Target book id."),
                    "content": _string_field("XML content to persist."),
                },
                ["lecture_id", "book_id", "content"],
            ),
            _object_tool(
                "getBookDetailXml",
                "Read the intensive-reading XML (bookdetail.xml).",
                {
                    "lecture_id": _string_field("Target lecture id."),
                    "book_id": _string_field("Target book id."),
                },
                ["lecture_id", "book_id"],
            ),
            _object_tool(
                "saveBookDetailXml",
                "Save the intensive-reading XML (bookdetail.xml).",
                {
                    "lecture_id": _string_field("Target lecture id."),
                    "book_id": _string_field("Target book id."),
                    "content": _string_field("XML content to persist."),
                },
                ["lecture_id", "book_id", "content"],
            ),
            _object_tool(
                "getBookQuestionsXml",
                "Read the question-generation XML (questions.xml).",
                {
                    "lecture_id": _string_field("Target lecture id."),
                    "book_id": _string_field("Target book id."),
                },
                ["lecture_id", "book_id"],
            ),
            _object_tool(
                "saveBookQuestionsXml",
                "Save the question-generation XML (questions.xml).",
                {
                    "lecture_id": _string_field("Target lecture id."),
                    "book_id": _string_field("Target book id."),
                    "content": _string_field("XML content to persist."),
                },
                ["lecture_id", "book_id", "content"],
            ),
        ]

    @classmethod
    def vector_tools(cls) -> List[Dict[str, Any]]:
        return [
            _object_tool(
                "triggerBookVectorization",
                "Trigger NexoraDB vectorization for a book.",
                {
                    "lecture_id": _string_field("Target lecture id."),
                    "book_id": _string_field("Target book id."),
                    "force": _boolean_field("Force re-vectorization."),
                    "async": _boolean_field("Run in background, default true."),
                },
                ["lecture_id", "book_id"],
            ),
            _object_tool(
                "vectorSearch",
                "Search vectorized lecture chunks (local fallback over chunks when needed).",
                {
                    "lecture_id": _string_field("Target lecture id."),
                    "query": _string_field("Search query text."),
                    "book_id": _string_field("Optional book id filter."),
                    "top_k": _integer_field("Maximum results to return."),
                },
                ["lecture_id", "query"],
            ),
        ]

    @classmethod
    def all(cls) -> List[Dict[str, Any]]:
        tools: List[Dict[str, Any]] = []
        for group in (cls.lecture_tools(), cls.book_tools(), cls.content_tools(), cls.vector_tools()):
            tools.extend(group)
        return tools


TOOLS = NexoraTools.all()

Tools = TOOLS
