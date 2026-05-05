"""Local NexoraLearning runtime injection for ChatDBServer.

This module keeps the architecture simple:
1. ChatDBServer still owns conversations and history.
2. NexoraLearning provides learning-mode prompt/context injection.
3. NexoraLearning tools are injected only when conversation_mode=learning.
4. Tool execution is local Python delegation, not HTTP proxying.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple


ROOT_DIR = Path(__file__).resolve().parents[2]
NEXORA_LEARNING_DIR = ROOT_DIR / "NexoraLearning"

if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


def _deps() -> Dict[str, Any]:
    from NexoraLearning.core.tool_executor import ToolExecutor as LearningToolExecutor
    from NexoraLearning.core.tools import TOOLS as LEARNING_TOOLS
    from NexoraLearning.core.lectures import (
        get_book,
        get_lecture,
        list_books,
        list_lectures,
        load_book_detail_xml,
        load_book_info_xml,
        load_book_questions_xml,
        load_book_text,
    )
    from NexoraLearning.core.user import (
        ensure_user_files,
        get_user,
        list_learning_records,
        list_selected_lecture_ids,
    )

    return {
        "ToolExecutor": LearningToolExecutor,
        "TOOLS": LEARNING_TOOLS,
        "get_book": get_book,
        "get_lecture": get_lecture,
        "list_books": list_books,
        "list_lectures": list_lectures,
        "load_book_detail_xml": load_book_detail_xml,
        "load_book_info_xml": load_book_info_xml,
        "load_book_questions_xml": load_book_questions_xml,
        "load_book_text": load_book_text,
        "ensure_user_files": ensure_user_files,
        "get_user": get_user,
        "list_learning_records": list_learning_records,
        "list_selected_lecture_ids": list_selected_lecture_ids,
    }


def build_learning_cfg() -> Dict[str, Any]:
    data_dir = NEXORA_LEARNING_DIR / "data"
    return {
        "data_dir": str(data_dir),
        "_config_path": str(NEXORA_LEARNING_DIR / "config.json"),
        "_project_root": str(NEXORA_LEARNING_DIR),
    }


LEARNING_READONLY_TOOL_NAMES = {
    "listLectures",
    "getLecture",
    "listBooks",
    "getBook",
    "getBookText",
    "readBookTextRange",
    "searchBookText",
    "getBookInfoXml",
    "getBookDetailXml",
    "getBookQuestionsXml",
    "vectorSearch",
    "learning_card",
    "question",
}


def _escape_html(value: Any) -> str:
    text = str(value or "")
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def _get_active_lecture_ids(
    username: str,
    payload: Optional[Mapping[str, Any]] = None,
    *,
    cfg: Optional[Mapping[str, Any]] = None,
) -> List[str]:
    deps = _deps()
    runtime_cfg = dict(cfg or build_learning_cfg())
    user_id = str(username or "").strip()
    deps["ensure_user_files"](runtime_cfg, user_id)
    selected_ids = [
        str(item or "").strip()
        for item in (deps["list_selected_lecture_ids"](runtime_cfg, user_id) or [])
        if str(item or "").strip()
    ]
    if selected_ids:
        return selected_ids
    raw_payload = payload if isinstance(payload, Mapping) else {}
    lecture_id = str(raw_payload.get("lecture_id") or "").strip()
    return [lecture_id] if lecture_id else []


def _study_hours_map(username: str, *, cfg: Optional[Mapping[str, Any]] = None) -> Dict[str, float]:
    deps = _deps()
    runtime_cfg = dict(cfg or build_learning_cfg())
    user_id = str(username or "").strip()
    deps["ensure_user_files"](runtime_cfg, user_id)
    rows = deps["list_learning_records"](runtime_cfg, user_id) or []
    result: Dict[str, float] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        lecture_id = str(row.get("lecture_id") or "").strip()
        if not lecture_id:
            continue
        hours = row.get("study_hours")
        minutes = row.get("study_minutes")
        seconds = row.get("study_seconds")
        duration = row.get("duration")
        amount = 0.0
        try:
            if hours is not None:
                amount = max(0.0, float(hours))
            elif minutes is not None:
                amount = max(0.0, float(minutes) / 60.0)
            elif seconds is not None:
                amount = max(0.0, float(seconds) / 3600.0)
            elif duration is not None:
                amount = max(0.0, float(duration) / 3600.0)
        except Exception:
            amount = 0.0
        if amount > 0:
            result[lecture_id] = float(result.get(lecture_id, 0.0) + amount)
    return result


def _lecture_card_payload(lecture_id: str, *, cfg: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    deps = _deps()
    runtime_cfg = dict(cfg or build_learning_cfg())
    lecture = deps["get_lecture"](runtime_cfg, lecture_id)
    if not isinstance(lecture, dict):
        raise ValueError("Lecture not found.")
    books = deps["list_books"](runtime_cfg, lecture_id) or []
    title = str(lecture.get("title") or lecture.get("name") or lecture_id).strip() or lecture_id
    category = str(lecture.get("category") or "").strip() or "未分类"
    progress = max(0, min(100, _safe_int(lecture.get("progress"), 0)))
    description = str(lecture.get("description") or "").strip() or "暂无课程描述。"
    html = f"""
<article class="nxl-chat-card nxl-chat-card-lecture" data-lecture-id="{_escape_html(lecture_id)}">
  <div class="nxl-chat-card-kicker">Learning Lecture</div>
  <h3>{_escape_html(title)}</h3>
  <div class="nxl-chat-card-meta">{_escape_html(category)} · {len(books)} 本教材 · {progress}% 进度</div>
  <div class="nxl-chat-card-progress"><span style="width:{progress}%"></span></div>
  <p>{_escape_html(description)}</p>
</article>
""".strip()
    return {
        "type": "lecture_display",
        "lecture_id": lecture_id,
        "lecture": lecture,
        "books_count": len(books),
        "html": html,
    }


def _chapter_card_payload(
    lecture_id: str,
    book_id: str,
    content_range: Sequence[Any],
    *,
    cfg: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    deps = _deps()
    runtime_cfg = dict(cfg or build_learning_cfg())
    lecture = deps["get_lecture"](runtime_cfg, lecture_id)
    if not isinstance(lecture, dict):
        raise ValueError("Lecture not found.")
    book = deps["get_book"](runtime_cfg, lecture_id, book_id)
    if not isinstance(book, dict):
        raise ValueError("Book not found.")
    if not isinstance(content_range, Sequence) or len(content_range) != 2:
        raise ValueError("content_range must be [start, end].")
    start = max(0, _safe_int(content_range[0], 0))
    end = max(start, _safe_int(content_range[1], start))
    text = str(deps["load_book_text"](runtime_cfg, lecture_id, book_id) or "")
    snippet = text[start:end]
    lecture_title = str(lecture.get("title") or lecture_id).strip() or lecture_id
    book_title = str(book.get("title") or book_id).strip() or book_id
    html = f"""
<article class="nxl-chat-card nxl-chat-card-range" data-lecture-id="{_escape_html(lecture_id)}" data-book-id="{_escape_html(book_id)}">
  <div class="nxl-chat-card-kicker">Chapter Range</div>
  <h3>{_escape_html(book_title)}</h3>
  <div class="nxl-chat-card-meta">{_escape_html(lecture_title)} · [{start}, {end}]</div>
  <pre class="nxl-chat-card-snippet">{_escape_html(snippet[:1600] or "该范围暂无文本内容。")}</pre>
</article>
""".strip()
    return {
        "type": "chapter_range",
        "lecture_id": lecture_id,
        "book_id": book_id,
        "content_range": [start, end],
        "lecture": lecture,
        "book": book,
        "content": snippet,
        "html": html,
    }


def _learning_card_tool() -> Dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": "learning_card",
            "description": "Create a structured Learning card for a lecture overview or a chapter text range.",
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["lecture_display", "chapter_range"],
                        "description": "Card type to render.",
                    },
                    "lecture_id": {
                        "type": "string",
                        "description": "Target lecture id.",
                    },
                    "book_id": {
                        "type": "string",
                        "description": "Required for chapter_range cards.",
                    },
                    "content_range": {
                        "type": "array",
                        "description": "For chapter_range cards: [start, end] character offsets.",
                        "items": {"type": "integer"},
                        "minItems": 2,
                        "maxItems": 2,
                    },
                },
                "required": ["type", "lecture_id"],
            },
        },
    }


def _question_tool() -> Dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": "question",
            "description": "Ask the user a structured question and wait for an explicit response before continuing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "question_title": {
                        "type": "string",
                        "description": "Short question title.",
                    },
                    "question_content": {
                        "type": "string",
                        "description": "Main question body shown to the user.",
                    },
                    "choices": {
                        "type": "array",
                        "description": "Suggested choices for the user.",
                        "items": {"type": "string"},
                    },
                    "allow_other": {
                        "type": "boolean",
                        "description": "Whether the user may type a custom answer.",
                    },
                },
                "required": ["question_title", "question_content"],
            },
        },
    }


def get_learning_tools() -> List[Dict[str, Any]]:
    deps = _deps()
    tools = list(deps["TOOLS"] or [])
    names = set()
    normalized: List[Dict[str, Any]] = []
    for tool in tools:
        if not isinstance(tool, dict) or str(tool.get("type", "") or "").strip() != "function":
            continue
        fn = tool.get("function") if isinstance(tool.get("function"), dict) else {}
        name = str(fn.get("name") or "").strip()
        if not name or name in names or name not in LEARNING_READONLY_TOOL_NAMES:
            continue
        names.add(name)
        normalized.append(json.loads(json.dumps(tool, ensure_ascii=False)))
    if "learning_card" not in names:
        normalized.append(_learning_card_tool())
        names.add("learning_card")
    if "question" not in names:
        normalized.append(_question_tool())
    return normalized


class LearningRuntimeExecutor:
    """Local adapter so ChatDBServer can execute NexoraLearning tools."""

    def __init__(self, cfg: Optional[Mapping[str, Any]] = None):
        deps = _deps()
        self.cfg = dict(cfg or build_learning_cfg())
        self._executor = deps["ToolExecutor"](self.cfg)

    def execute(self, function_name: str, arguments: Optional[Mapping[str, Any]] = None) -> str:
        tool_name = str(function_name or "").strip()
        safe_args = dict(arguments or {})
        if tool_name not in LEARNING_READONLY_TOOL_NAMES:
            raise ValueError(f"Learning mode only supports read-only tools: {tool_name}")
        if tool_name == "learning_card":
            payload = self._execute_learning_card(safe_args)
            return json.dumps(payload, ensure_ascii=False)
        if tool_name == "question":
            payload = self._execute_question(safe_args)
            return json.dumps(payload, ensure_ascii=False)
        if tool_name == "listLectures":
            payload = self._execute_list_lectures()
        elif tool_name == "getLecture":
            payload = self._execute_get_lecture(safe_args)
        elif tool_name == "listBooks":
            payload = self._execute_list_books(safe_args)
        elif tool_name == "getBook":
            payload = self._execute_get_book(safe_args)
        elif tool_name == "getBookText":
            payload = self._execute_get_book_text(safe_args)
        elif tool_name == "readBookTextRange":
            payload = self._execute_read_book_text_range(safe_args)
        elif tool_name == "searchBookText":
            payload = self._execute_search_book_text(safe_args)
        elif tool_name == "getBookInfoXml":
            payload = self._execute_get_book_info_xml(safe_args)
        elif tool_name == "getBookDetailXml":
            payload = self._execute_get_book_detail_xml(safe_args)
        elif tool_name == "getBookQuestionsXml":
            payload = self._execute_get_book_questions_xml(safe_args)
        else:
            payload = self._executor.execute(tool_name, safe_args)
        return json.dumps(payload, ensure_ascii=False)

    def _execute_learning_card(self, arguments: Mapping[str, Any]) -> Dict[str, Any]:
        card_type = str(arguments.get("type") or "").strip()
        lecture_id = str(arguments.get("lecture_id") or "").strip()
        if not lecture_id:
            raise ValueError("lecture_id is required.")
        if card_type == "lecture_display":
            card = _lecture_card_payload(lecture_id, cfg=self.cfg)
        elif card_type == "chapter_range":
            book_id = str(arguments.get("book_id") or "").strip()
            if not book_id:
                raise ValueError("book_id is required for chapter_range.")
            content_range = arguments.get("content_range")
            card = _chapter_card_payload(lecture_id, book_id, content_range, cfg=self.cfg)
        else:
            raise ValueError(f"unsupported card type: {card_type}")
        return {"success": True, "card": card}

    def _execute_question(self, arguments: Mapping[str, Any]) -> Dict[str, Any]:
        title = str(arguments.get("question_title") or "").strip()
        content = str(arguments.get("question_content") or "").strip()
        if not title or not content:
            raise ValueError("question_title and question_content are required.")
        raw_choices = arguments.get("choices")
        choices = [str(item or "").strip() for item in (raw_choices or []) if str(item or "").strip()]
        question_id = str(arguments.get("question_id") or "").strip()
        return {
            "success": True,
            "question": {
                "question_id": question_id,
                "question_title": title,
                "question_content": content,
                "choices": choices,
                "allow_other": bool(arguments.get("allow_other", True)),
            },
            "await": True,
        }

    def _build_book_views(self, lecture_id: str, book: Mapping[str, Any]) -> Dict[str, Any]:
        deps = _deps()
        book_id = str(book.get("id") or "").strip()
        text = str(deps["load_book_text"](self.cfg, lecture_id, book_id) or "")
        coarse = str(deps["load_book_info_xml"](self.cfg, lecture_id, book_id) or "")
        intensive = str(deps["load_book_detail_xml"](self.cfg, lecture_id, book_id) or "")
        questions = str(deps["load_book_questions_xml"](self.cfg, lecture_id, book_id) or "")
        return {
            "coarse": {
                "tool": "getBookInfoXml",
                "chars": len(coarse),
                "available": bool(coarse.strip()),
                "content": coarse,
            },
            "intensive": {
                "tool": "getBookDetailXml",
                "chars": len(intensive),
                "available": bool(intensive.strip()),
                "content": intensive,
            },
            "questions": {
                "tool": "getBookQuestionsXml",
                "chars": len(questions),
                "available": bool(questions.strip()),
                "content": questions,
            },
            "full_text": {
                "tool": "getBookText",
                "chars": len(text),
                "available": bool(text),
                "preview": text[:1200],
            },
        }

    def _book_reading_entry(self, lecture_id: str, book: Mapping[str, Any]) -> Dict[str, Any]:
        book_id = str(book.get("id") or "").strip()
        return {
            "book_id": book_id,
            "title": str(book.get("title") or "").strip(),
            "description": str(book.get("description") or "").strip(),
            "status": str(book.get("status") or "").strip(),
            "source_type": str(book.get("source_type") or "").strip(),
            "views": self._build_book_views(lecture_id, book),
        }

    def _book_listing_entry(self, lecture_id: str, book: Mapping[str, Any]) -> Dict[str, Any]:
        """Return a lightweight book row for lecture/list views.

        We keep the rich chapter view data behind getBook/getBookInfoXml/getBookDetailXml,
        because embedding all view contents in lecture/listBooks makes the prompt too heavy
        and tends to stop the learning model from producing a final answer.
        """
        book_id = str(book.get("id") or "").strip()
        views = self._build_book_views(lecture_id, book)
        view_summary = {
            key: {
                "tool": str(view.get("tool") or "").strip(),
                "chars": _safe_int(view.get("chars"), 0),
                "available": bool(view.get("available")),
            }
            for key, view in views.items()
            if isinstance(view, Mapping)
        }
        return {
            "book_id": book_id,
            "title": str(book.get("title") or "").strip(),
            "description": str(book.get("description") or "").strip(),
            "status": str(book.get("status") or "").strip(),
            "source_type": str(book.get("source_type") or "").strip(),
            "view_summary": view_summary,
        }

    def _execute_list_lectures(self) -> Dict[str, Any]:
        deps = _deps()
        lectures = deps["list_lectures"](self.cfg) or []
        rows: List[Dict[str, Any]] = []
        for lecture in lectures:
            if not isinstance(lecture, Mapping):
                continue
            lecture_id = str(lecture.get("id") or "").strip()
            if not lecture_id:
                continue
            books = deps["list_books"](self.cfg, lecture_id) or []
            rows.append(
                {
                    "lecture_id": lecture_id,
                    "title": str(lecture.get("title") or "").strip(),
                    "description": str(lecture.get("description") or "").strip(),
                    "category": str(lecture.get("category") or "").strip(),
                    "progress": _safe_int(lecture.get("progress"), 0),
                    "books": [self._book_listing_entry(lecture_id, book) for book in books if isinstance(book, Mapping)],
                }
            )
        return {"success": True, "lectures": rows, "total": len(rows)}

    def _execute_get_lecture(self, arguments: Mapping[str, Any]) -> Dict[str, Any]:
        deps = _deps()
        lecture_id = str(arguments.get("lecture_id") or "").strip()
        if not lecture_id:
            raise ValueError("lecture_id is required.")
        lecture = deps["get_lecture"](self.cfg, lecture_id)
        if not isinstance(lecture, Mapping):
            raise ValueError("Lecture not found.")
        books = deps["list_books"](self.cfg, lecture_id) or []
        return {
            "success": True,
            "lecture": lecture,
            "books": [self._book_listing_entry(lecture_id, book) for book in books if isinstance(book, Mapping)],
            "total_books": len(books),
        }

    def _execute_list_books(self, arguments: Mapping[str, Any]) -> Dict[str, Any]:
        deps = _deps()
        lecture_id = str(arguments.get("lecture_id") or "").strip()
        if not lecture_id:
            raise ValueError("lecture_id is required.")
        lecture = deps["get_lecture"](self.cfg, lecture_id)
        if not isinstance(lecture, Mapping):
            raise ValueError("Lecture not found.")
        books = deps["list_books"](self.cfg, lecture_id) or []
        return {
            "success": True,
            "lecture": lecture,
            # Keep the first-hop book list lightweight so the learning model can continue
            # with a follow-up request instead of treating the whole book view as the answer.
            "books": [self._book_listing_entry(lecture_id, book) for book in books if isinstance(book, Mapping)],
            "total": len(books),
        }

    def _execute_get_book(self, arguments: Mapping[str, Any]) -> Dict[str, Any]:
        deps = _deps()
        lecture_id = str(arguments.get("lecture_id") or "").strip()
        book_id = str(arguments.get("book_id") or "").strip()
        if not lecture_id or not book_id:
            raise ValueError("lecture_id and book_id are required.")
        lecture = deps["get_lecture"](self.cfg, lecture_id)
        book = deps["get_book"](self.cfg, lecture_id, book_id)
        if not isinstance(lecture, Mapping):
            raise ValueError("Lecture not found.")
        if not isinstance(book, Mapping):
            raise ValueError("Book not found.")
        return {
            "success": True,
            "lecture": lecture,
            "book": dict(book),
            "views": self._build_book_views(lecture_id, book),
        }

    def _execute_get_book_text(self, arguments: Mapping[str, Any]) -> Dict[str, Any]:
        payload = self._executor.execute("getBookText", dict(arguments))
        if isinstance(payload, Mapping):
            book = payload.get("book") if isinstance(payload.get("book"), Mapping) else {}
            return {
                "success": True,
                "lecture_id": str(arguments.get("lecture_id") or "").strip(),
                "book_id": str(arguments.get("book_id") or "").strip(),
                "book_title": str(book.get("title") or "").strip(),
                "content": str(payload.get("content") or ""),
                "chars": _safe_int(payload.get("chars"), 0),
                "view": "full_text",
            }
        return dict(payload)

    def _execute_read_book_text_range(self, arguments: Mapping[str, Any]) -> Dict[str, Any]:
        payload = self._executor.execute("readBookTextRange", dict(arguments))
        if isinstance(payload, Mapping):
            return {
                "success": True,
                "lecture_id": str(arguments.get("lecture_id") or "").strip(),
                "book_id": str(arguments.get("book_id") or "").strip(),
                "offset": _safe_int(payload.get("offset"), 0),
                "length": _safe_int(payload.get("length"), 0),
                "chars": _safe_int(payload.get("chars"), 0),
                "content": str(payload.get("content") or payload.get("text") or ""),
                "view": "full_text_range",
            }
        return dict(payload)

    def _execute_search_book_text(self, arguments: Mapping[str, Any]) -> Dict[str, Any]:
        payload = self._executor.execute("searchBookText", dict(arguments))
        if isinstance(payload, Mapping):
            return {
                "success": True,
                "lecture_id": str(payload.get("lecture_id") or arguments.get("lecture_id") or "").strip(),
                "book_id": str(payload.get("book_id") or arguments.get("book_id") or "").strip(),
                "query": str(payload.get("query") or arguments.get("keyword") or "").strip(),
                "hits": list(payload.get("hits") or []),
                "count": _safe_int(payload.get("count"), 0),
                "view": "full_text_search",
            }
        return dict(payload)

    def _execute_get_book_info_xml(self, arguments: Mapping[str, Any]) -> Dict[str, Any]:
        payload = self._executor.execute("getBookInfoXml", dict(arguments))
        if isinstance(payload, Mapping):
            return {
                "success": True,
                "lecture_id": str(arguments.get("lecture_id") or "").strip(),
                "book_id": str(arguments.get("book_id") or "").strip(),
                "content": str(payload.get("content") or ""),
                "chars": _safe_int(payload.get("chars"), 0),
                "view": "coarse",
            }
        return dict(payload)

    def _execute_get_book_detail_xml(self, arguments: Mapping[str, Any]) -> Dict[str, Any]:
        payload = self._executor.execute("getBookDetailXml", dict(arguments))
        if isinstance(payload, Mapping):
            return {
                "success": True,
                "lecture_id": str(arguments.get("lecture_id") or "").strip(),
                "book_id": str(arguments.get("book_id") or "").strip(),
                "content": str(payload.get("content") or ""),
                "chars": _safe_int(payload.get("chars"), 0),
                "view": "intensive",
            }
        return dict(payload)

    def _execute_get_book_questions_xml(self, arguments: Mapping[str, Any]) -> Dict[str, Any]:
        payload = self._executor.execute("getBookQuestionsXml", dict(arguments))
        if isinstance(payload, Mapping):
            return {
                "success": True,
                "lecture_id": str(arguments.get("lecture_id") or "").strip(),
                "book_id": str(arguments.get("book_id") or "").strip(),
                "content": str(payload.get("content") or ""),
                "chars": _safe_int(payload.get("chars"), 0),
                "view": "questions",
            }
        return dict(payload)


def build_learning_active_tool_skills() -> List[Dict[str, Any]]:
    return [
        {
            "title": "Learning Card Injection",
            "required_tools": ["learning_card"],
            "mode": "force",
            "version": "1.0",
            "author": "NexoraLearning",
            "main_content": (
                "当需要向用户展示课程概览、教材片段、章节范围或学习提示卡片时，"
                "请主动调用 learning_card 工具。"
                "课程总览使用 type=lecture_display；教材片段使用 type=chapter_range，"
                "并传入 lecture_id、book_id、content_range。"
            ),
        },
        {
            "title": "Learning Read-Only Course and Book Tools",
            "required_tools": [
                "listLectures",
                "getLecture",
                "listBooks",
                "getBook",
                "getBookText",
                "readBookTextRange",
                "searchBookText",
                "getBookInfoXml",
                "getBookDetailXml",
                "getBookQuestionsXml",
                "vectorSearch",
            ],
            "mode": "force",
            "version": "1.0",
            "author": "NexoraLearning",
            "main_content": (
                "当前对话处于 NexoraLearning 学习模式。"
                "本模式只允许读取课程、教材、概读、精读、题目和正文，不允许创建、修改、删除学习数据。"
                "当用户询问课程、教材、书籍文本、章节摘要、精读内容或题目内容时，"
                "优先调用对应 Learning 工具查询，不要凭空假设。"
                "默认优先查看概读、精读和题目，不要一上来直接读取教材正文。"
                "先用课程列表和教材目录建立结构，再按需查看概读、精读和题目。"
                "只有当概读、精读和题目仍不足以回答，才补充使用 readBookTextRange 或 searchBookText。"
            ),
        },
    ]


def _select_learning_rows(
    username: str,
    payload: Optional[Mapping[str, Any]] = None,
    *,
    cfg: Optional[Mapping[str, Any]] = None,
) -> Tuple[List[Dict[str, Any]], int]:
    deps = _deps()
    runtime_cfg = dict(cfg or build_learning_cfg())
    lecture_filter = set(_get_active_lecture_ids(username, payload, cfg=runtime_cfg))
    lectures = deps["list_lectures"](runtime_cfg) or []
    rows: List[Dict[str, Any]] = []
    total_books = 0
    for lecture in lectures:
        if not isinstance(lecture, dict):
            continue
        lecture_id = str(lecture.get("id") or "").strip()
        if not lecture_id:
            continue
        if lecture_filter and lecture_id not in lecture_filter:
            continue
        books = deps["list_books"](runtime_cfg, lecture_id) or []
        total_books += len(books)
        rows.append(
            {
                "id": lecture_id,
                "title": str(lecture.get("title") or "").strip(),
                "category": str(lecture.get("category") or "").strip(),
                "status": str(lecture.get("status") or "").strip(),
                "progress": _safe_int(lecture.get("progress"), 0),
                "current_chapter": str(lecture.get("current_chapter") or "").strip(),
                "books_count": len(books),
            }
        )
    return rows, total_books


def build_learning_context_payload(
    username: str,
    payload: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    deps = _deps()
    cfg = build_learning_cfg()
    user_id = str(username or "").strip()
    deps["ensure_user_files"](cfg, user_id)

    lecture_rows, total_books = _select_learning_rows(user_id, payload, cfg=cfg)
    progress_lines = [
        f"- {row['title'] or row['id']} | 进度 {max(0, min(100, _safe_int(row.get('progress'), 0)))}% | 当前章节 {row.get('current_chapter') or '暂无'} | 教材 {row.get('books_count', 0)} 本"
        for row in lecture_rows
    ]
    recent_learning = deps["list_learning_records"](cfg, user_id) or []
    recent_learning = recent_learning[-8:] if isinstance(recent_learning, list) else []
    selected_lecture_ids = [row["id"] for row in lecture_rows if str(row.get("id") or "").strip()]
    user_payload = deps["get_user"](cfg, user_id) or {}

    cards: List[Dict[str, Any]] = []
    for row in lecture_rows[:4]:
        lecture_id = str(row.get("id") or "").strip()
        if not lecture_id:
            continue
        try:
            cards.append(_lecture_card_payload(lecture_id, cfg=cfg))
        except Exception:
            continue

    system_prompt = (
        "你当前处于 NexoraLearning 学习模式。\n"
        "Nexora 只负责对话历史管理；NexoraLearning 负责学习上下文、学习提示词和学习工具注入。\n"
        "不要使用任何非学习用途的工具来替代 Learning 工具。\n"
        "当用户询问课程、教材、章节、摘要、精读内容、题目、知识点时，请优先调用 Learning 工具获取信息。\n"
        "默认先读取概读、精读、题目与课程结构，不要直接阅读教材正文；只有现有摘要仍不够时，才补充读取正文范围。\n"
        "你可以结合用户知识库工具做补充检索，但学习模式的主数据源始终是 NexoraLearning。\n"
        "如有必要，可调用 learning_card 生成可视化学习卡片，但卡片不是必须步骤。"
    )

    return {
        "learning": True,
        "system_prompt": system_prompt,
        "context_blocks": [
            {
                "type": "learning_profile",
                "title": "学习用户档案",
                "content": json.dumps(
                    {
                        "user_id": user_id,
                        "user": user_payload,
                        "selected_lecture_ids": selected_lecture_ids,
                        "selected_lectures": lecture_rows,
                        "study_hours_map": _study_hours_map(user_id, cfg=cfg),
                    },
                    ensure_ascii=False,
                ),
            },
            {
                "type": "learning_injection_contract",
                "title": "学习模式注入说明",
                "content": json.dumps(
                    {
                        "history_owner": "Nexora",
                        "learning_owner": "NexoraLearning",
                        "tool_policy": {
                            "learning_tools": "readonly_only",
                            "knowledge_tools": "readonly_only",
                            "tmp_tools": "disabled",
                            "longterm_tools": "disabled",
                        },
                        "suggested_external_injection": [
                            "用户知识库列表",
                            "用户描述",
                            "课程进度",
                            "近期学习记录",
                        ],
                    },
                    ensure_ascii=False,
                ),
            },
            {
                "type": "learning_progress",
                "title": "课程学习进度",
                "content": "\n".join(progress_lines) if progress_lines else "当前还没有加入学习中的课程。",
            },
            {
                "type": "learning_recent_records",
                "title": "最近学习记录",
                "content": json.dumps(recent_learning, ensure_ascii=False),
            },
            {
                "type": "learning_card_suggestion",
                "title": "推荐卡片",
                "content": json.dumps(
                    [
                        {
                            "tool": "learning_card",
                            "type": "lecture_display",
                            "lecture_id": card.get("lecture_id"),
                        }
                        for card in cards
                        if isinstance(card, dict) and str(card.get("lecture_id") or "").strip()
                    ],
                    ensure_ascii=False,
                ),
            },
        ],
        "meta": {
            "source": "chatdbserver_learning_mode",
            "selected_lecture_count": len(lecture_rows),
            "total_books": total_books,
            "cards": cards,
        },
        "cards": cards,
        "active_tool_skills": build_learning_active_tool_skills(),
    }
