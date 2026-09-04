"""Persistent chapter quiz selection for the reader floating panel."""

from __future__ import annotations

import hashlib
import html
import json
import re
import threading
import time
from collections.abc import Mapping as MappingABC
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, Optional

from core.booksproc.modeling import build_profile_question_runner, get_profile_question_settings
from core.booksproc.question import validate_question_distribution
from core.cognition.question_binding import (
    load_chapter_concept_candidates,
    serialize_concept_candidates,
    validate_question_concept_bindings,
)
from core.lectures import (
    get_book,
    get_lecture,
    load_book_detail_xml,
    load_book_info_xml,
    load_book_questions_xml,
    load_book_text,
)
from core.runlog import log_event
from core.user import (
    append_question_bank_item,
    ensure_user_files,
    list_question_bank_items,
    read_lecture_context_memory,
    read_memory,
)


_QUIZ_LOCK = threading.Lock()
_QUESTION_BLOCK_RE = re.compile(r"<QUESTION>\s*(.*?)\s*</QUESTION>", flags=re.IGNORECASE | re.DOTALL)
_PLACEHOLDER_OPTIONS = {
    "",
    "-",
    "/",
    "—",
    "——",
    "无",
    "暂无",
    "略",
    "选项",
    "none",
    "n/a",
    "null",
    "nil",
}


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _emit_quiz_generation_status(
    callback: Optional[Callable[[str], None]],
    message: str,
) -> None:
    """向真实存在的章节测验流消费者发送生成阶段。"""
    text = _safe_text(message)

    if callback is not None and text:
        callback(text)


def _strip_markdown_answer(value: Any) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    text = re.sub(r"```[\s\S]*?```", lambda match: str(match.group(0)).replace("```", ""), text)
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*\d+[.)]\s+", "", text, flags=re.MULTILINE)
    text = text.replace("**", "").replace("__", "").replace("`", "")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _normalize_options(value: Any) -> List[str]:
    raw_items = value if isinstance(value, list) else str(value or "").splitlines()
    rows: List[str] = []

    for item in raw_items:
        if isinstance(item, MappingABC):
            text = _safe_text(
                item.get("text")
                or item.get("content")
                or item.get("value")
                or item.get("title")
            )
        else:
            text = _safe_text(item)

        text = re.sub(r"^[A-Da-d][.、)\s]+", "", text).strip()

        if not text or text.lower() in _PLACEHOLDER_OPTIONS:
            continue

        rows.append(text[:160])

    return rows[:4]


def _as_choice_letter(text: str) -> str:
    token = str(text or "").strip()
    if len(token) == 1 and "A" <= token.upper() <= "D":
        return token.upper()
    return ""


def grade_question(question: Mapping[str, Any], user_answer: str) -> bool:
    """选择题按字母/选项原文判；简答题按归一化包含关系判。"""
    expected = _strip_markdown_answer(question.get("answer") if isinstance(question, Mapping) else "")
    user = _strip_markdown_answer(user_answer)
    if not user or not expected:
        return False

    options = _normalize_options(question.get("options") if isinstance(question, Mapping) else [])
    qtype = _normalize_question_type(question.get("type") if isinstance(question, Mapping) else "", options)
    user_letter = _as_choice_letter(user)
    expected_letter = _as_choice_letter(expected)

    if qtype == "choice" and options:
        if user_letter and expected_letter:
            return user_letter == expected_letter
        if user_letter:
            index = ord(user_letter) - 65
            if 0 <= index < len(options):
                choice = options[index]
                return choice == expected or expected_letter == user_letter or expected in {choice, user_letter}
        if expected_letter:
            index = ord(expected_letter) - 65
            if 0 <= index < len(options) and user == options[index]:
                return True
        if user == expected:
            return True
        if user in options and expected in options:
            return user == expected
        return False

    if user == expected:
        return True
    user_compact = re.sub(r"\s+", "", user).lower()
    expected_compact = re.sub(r"\s+", "", expected).lower()
    if user_compact == expected_compact:
        return True
    if len(expected_compact) >= 2 and expected_compact in user_compact:
        return True
    if len(user_compact) >= 4 and user_compact in expected_compact:
        return True
    return False


def load_quiz_by_id(cfg: Mapping[str, Any], user_id: str, quiz_id: str) -> Dict[str, Any]:
    path = _chapter_quiz_path(cfg, user_id, quiz_id)
    data = _read_json(path)
    return data if isinstance(data, dict) else {}


def _normalize_question_type(value: Any, options: List[str]) -> str:
    text = _safe_text(value).lower()

    if text in {"choice", "single_choice", "multiple_choice", "选择题", "单选题"}:
        return "choice"

    if text in {"text", "reading", "short_answer", "简答题", "文本题", "阅读题"}:
        return "text"

    return "choice" if len(options) >= 2 else "text"


def _data_dir(cfg: Mapping[str, Any]) -> Path:
    return Path(str((cfg or {}).get("data_dir") or "data"))


def _chapter_quiz_dir(cfg: Mapping[str, Any], user_id: str) -> Path:
    return _data_dir(cfg) / "users" / _safe_text(user_id) / "chapter_quizzes"


def _chapter_quiz_path(cfg: Mapping[str, Any], user_id: str, quiz_id: str) -> Path:
    safe_quiz_id = re.sub(r"[^a-zA-Z0-9_-]+", "_", _safe_text(quiz_id))
    return _chapter_quiz_dir(cfg, user_id) / f"{safe_quiz_id}.json"


def _read_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}

    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(dict(payload or {}), ensure_ascii=False, indent=2), encoding="utf-8")


def build_chapter_quiz_id(
    *,
    user_id: str,
    lecture_id: str,
    book_id: str,
    chapter_index: int,
    chapter_name: str,
    chapter_range: str,
) -> str:
    """生成稳定章节小测 ID，同一用户同一章节固定命中同一份文件。"""
    raw = "|".join(
        [
            _safe_text(user_id),
            _safe_text(lecture_id),
            _safe_text(book_id),
            str(int(chapter_index or 0)),
            _safe_text(chapter_name),
            _safe_text(chapter_range),
        ]
    )
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]
    return f"chapter_quiz_{digest}"


def _xml_value(block: str, tag: str) -> str:
    match = re.search(
        rf"<{re.escape(tag)}>\s*([\s\S]*?)\s*</{re.escape(tag)}>",
        str(block or ""),
        flags=re.IGNORECASE,
    )

    if not match:
        return ""

    return html.unescape(str(match.group(1) or "").strip())


def _parse_range(value: str) -> List[int]:
    parts = _safe_text(value).split(":", 1)

    if len(parts) != 2:
        return [0, 0]

    try:
        return [max(0, int(parts[0])), max(0, int(parts[1]))]
    except Exception:
        return [0, 0]


def _normalize_question(
    raw_question: Mapping[str, Any],
    *,
    source: str,
    source_id: str = "",
) -> Dict[str, Any]:
    question = dict(raw_question or {})
    title = _safe_text(question.get("question_title") or question.get("title") or question.get("question"))
    content = _safe_text(question.get("question_content") or question.get("content"))
    options = _normalize_options(question.get("question_options") or question.get("options"))
    question_type = _normalize_question_type(question.get("question_type") or question.get("type"), options)
    answer = _strip_markdown_answer(
        question.get("question_answer")
        or question.get("answer")
        or question.get("reference_answer")
    )

    if question_type == "choice" and len(options) < 2:
        question_type = "text"
        options = []

    if not title and content:
        title = content[:60]

    if not content and title:
        content = title

    if not title or not content or not answer:
        return {}

    return {
        "title": title,
        "difficulty": _safe_text(question.get("question_difficulty") or question.get("difficulty")),
        "type": question_type,
        "options": options,
        "content": content,
        "hint": _safe_text(question.get("question_hint") or question.get("hint") or question.get("question_reason")),
        "answer": answer,
        "source": _safe_text(source) or _safe_text(question.get("source")),
        "source_id": _safe_text(source_id) or _safe_text(question.get("source_id") or question.get("question_id")),
    }


def _canonicalize_existing_quiz_questions(questions: Any) -> Dict[str, Any]:
    """把历史固化小测题目统一为阅读器渲染所需的标准结构。"""
    if not isinstance(questions, list) or not questions:
        return {
            "questions": [],
            "changed": False,
            "invalid_indexes": [],
        }

    normalized_questions: List[Dict[str, Any]] = []
    invalid_indexes: List[int] = []
    changed = False

    for idx, raw_question in enumerate(questions):
        if not isinstance(raw_question, MappingABC):
            invalid_indexes.append(idx)
            changed = True
            continue

        normalized = _normalize_question(
            raw_question,
            source=_safe_text(raw_question.get("source")) or "chapter_quiz_cache",
            source_id=_safe_text(raw_question.get("source_id") or raw_question.get("question_id")),
        )

        if not normalized:
            invalid_indexes.append(idx)
            changed = True
            continue

        normalized_questions.append(normalized)

        for key, value in normalized.items():
            if raw_question.get(key) != value:
                changed = True
                break

        if not changed:
            for key in raw_question.keys():
                if key not in normalized:
                    changed = True
                    break

    return {
        "questions": normalized_questions,
        "changed": changed,
        "invalid_indexes": invalid_indexes,
    }


def _load_existing_chapter_quiz(path: Path, *, user_id: str, lecture_id: str, book_id: str, chapter_name: str) -> Dict[str, Any]:
    """读取固化小测，并在返回前保证题目结构可被 Web Reader 直接渲染。"""
    existing = _read_json(path)

    if not existing or not isinstance(existing.get("questions"), list) or not existing.get("questions"):
        return {}

    result = _canonicalize_existing_quiz_questions(existing.get("questions"))
    invalid_indexes = list(result.get("invalid_indexes") or [])
    normalized_questions = result.get("questions") if isinstance(result.get("questions"), list) else []

    if invalid_indexes or not normalized_questions:
        log_event(
            "chapter_quiz_existing_schema_invalid",
            "固化章节小测题目结构无效，已停止复用旧文件并重新生成",
            payload={
                "user_id": user_id,
                "lecture_id": lecture_id,
                "book_id": book_id,
                "chapter_name": chapter_name,
                "path": str(path),
                "question_count": len(existing.get("questions") or []),
                "invalid_indexes": invalid_indexes,
            },
        )
        return {}

    if bool(result.get("changed")):
        repaired = dict(existing)
        repaired["questions"] = normalized_questions
        repaired["updated_at"] = int(time.time())
        repaired["schema_version"] = "reader_quiz_v1"
        _write_json(path, repaired)
        log_event(
            "chapter_quiz_existing_schema_repaired",
            "固化章节小测题目结构已标准化",
            payload={
                "user_id": user_id,
                "lecture_id": lecture_id,
                "book_id": book_id,
                "chapter_name": chapter_name,
                "path": str(path),
                "question_count": len(normalized_questions),
            },
        )
        return repaired

    return existing


def _chapter_text_matches(value: Any, chapter_name: str) -> bool:
    text = _safe_text(value)
    target = _safe_text(chapter_name)

    if not text or not target:
        return False

    return text == target or text in target or target in text


def _question_bank_row_matches(row: Mapping[str, Any], *, lecture_id: str, book_id: str, chapter_name: str, chapter_range: str) -> bool:
    if _safe_text(row.get("lecture_id")) != _safe_text(lecture_id):
        return False

    row_book_id = _safe_text(row.get("book_id"))

    if row_book_id and row_book_id != _safe_text(book_id):
        return False

    question = row.get("question") if isinstance(row.get("question"), dict) else {}
    related_chapter = _safe_text(question.get("related_chapter"))
    row_chapter_name = _safe_text(row.get("chapter_name"))
    row_chapter_range = _safe_text(row.get("chapter_range"))

    if row_chapter_range and row_chapter_range == _safe_text(chapter_range):
        return True

    return _chapter_text_matches(row_chapter_name, chapter_name) or _chapter_text_matches(related_chapter, chapter_name)


def _select_user_question_bank_questions(
    cfg: Mapping[str, Any],
    *,
    user_id: str,
    lecture_id: str,
    book_id: str,
    chapter_name: str,
    chapter_range: str,
    limit: int,
) -> List[Dict[str, Any]]:
    rows = list_question_bank_items(dict(cfg or {}), user_id)
    selected: List[Dict[str, Any]] = []

    for row in reversed(rows or []):
        if not isinstance(row, dict):
            continue

        if not _question_bank_row_matches(
            row,
            lecture_id=lecture_id,
            book_id=book_id,
            chapter_name=chapter_name,
            chapter_range=chapter_range,
        ):
            continue

        raw_question = row.get("question") if isinstance(row.get("question"), dict) else row
        normalized = _normalize_question(
            raw_question,
            source="user_question_bank",
            source_id=_safe_text(row.get("question_id")),
        )

        if normalized:
            selected.append(normalized)

        if len(selected) >= limit:
            break

    return selected


def _shape_chapter_quiz_questions(questions: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    safe_limit = max(1, int(limit or 3))
    choices = [row for row in questions if _safe_text(row.get("type")) == "choice"]
    texts = [row for row in questions if _safe_text(row.get("type")) != "choice"]
    selected: List[Dict[str, Any]] = []

    if safe_limit >= 3:
        selected.extend(choices[:2])
        selected.extend(texts[:1])
    else:
        selected.extend(choices[:safe_limit])

    used_ids = {id(row) for row in selected}

    for row in questions:
        if len(selected) >= safe_limit:
            break

        if id(row) in used_ids:
            continue

        selected.append(row)
        used_ids.add(id(row))

    return selected[:safe_limit]


def _parse_book_questions_xml(questions_xml: str, *, chapter_name: str, chapter_range: str, limit: int) -> List[Dict[str, Any]]:
    selected: List[Dict[str, Any]] = []
    text = str(questions_xml or "")
    block_pattern = re.compile(r"<chapter_questions>\s*([\s\S]*?)\s*</chapter_questions>", flags=re.IGNORECASE)

    for block_match in block_pattern.finditer(text):
        block = str(block_match.group(1) or "")
        block_chapter_name = _xml_value(block, "chapter_name")
        block_chapter_range = _xml_value(block, "chapter_range")

        if block_chapter_range != _safe_text(chapter_range) and not _chapter_text_matches(block_chapter_name, chapter_name):
            continue

        item_pattern = re.compile(r"<question_item>\s*([\s\S]*?)\s*</question_item>", flags=re.IGNORECASE)

        for item_match in item_pattern.finditer(block):
            item_block = str(item_match.group(1) or "")
            normalized = _normalize_question(
                {
                    "question_title": _xml_value(item_block, "question_title"),
                    "question_difficulty": _xml_value(item_block, "question_difficulty"),
                    "question_type": _xml_value(item_block, "question_type"),
                    "question_options": _xml_value(item_block, "question_options"),
                    "question_content": _xml_value(item_block, "question_content"),
                    "question_hint": _xml_value(item_block, "question_hint"),
                    "question_answer": _xml_value(item_block, "question_answer"),
                },
                source="book_questions_xml",
            )

            if normalized:
                selected.append(normalized)

            if len(selected) >= limit:
                return selected

    return selected


def _select_book_question_bank_questions(
    cfg: Mapping[str, Any],
    *,
    lecture_id: str,
    book_id: str,
    chapter_name: str,
    chapter_range: str,
    limit: int,
) -> List[Dict[str, Any]]:
    questions_xml = load_book_questions_xml(dict(cfg or {}), lecture_id, book_id)
    return _parse_book_questions_xml(questions_xml, chapter_name=chapter_name, chapter_range=chapter_range, limit=limit)


def _parse_profile_question_blocks(content: str) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []

    for block in _QUESTION_BLOCK_RE.findall(str(content or "")):
        row = {
            "question_title": _xml_value(block, "question_title"),
            "question_difficulty": _xml_value(block, "question_difficulty"),
            "question_type": _xml_value(block, "question_type"),
            "question_options": _xml_value(block, "question_options"),
            "question_content": _xml_value(block, "question_content"),
            "question_reason": _xml_value(block, "question_reason"),
            "question_answer": _xml_value(block, "question_answer"),
            "related_chapter": _xml_value(block, "related_chapter"),
            "related_concept_id": _xml_value(block, "related_concept_id"),
        }

        if row["question_title"] or row["question_content"]:
            rows.append(row)

    return rows


def _normalize_markdown(text: str) -> str:
    normalized = str(text or "").replace("\r\n", "\n").replace("\r", "\n")

    if normalized and not normalized.endswith("\n"):
        normalized += "\n"

    return normalized


def _generate_profile_question_bank_questions(
    cfg: Mapping[str, Any],
    *,
    user_id: str,
    lecture_id: str,
    book_id: str,
    chapter_name: str,
    chapter_range: str,
    chapter_context: str,
    chapter_detail_xml: str,
    limit: int,
    on_delta: Optional[Callable[[str], None]] = None,
) -> List[Dict[str, Any]]:
    lecture = get_lecture(dict(cfg or {}), lecture_id)
    book = get_book(dict(cfg or {}), lecture_id, book_id)

    if not isinstance(lecture, dict) or not isinstance(book, dict):
        raise ValueError(f"Book not found: {lecture_id}/{book_id}")

    settings = dict(get_profile_question_settings(cfg) or {})
    # 概念目录只是出题提示的增强：课程还没生成知识图谱时（例如刚挂上的整本 EPUB）
    # 不应让整次出题失败，退化为只按章节正文出题。
    try:
        concept_candidates = load_chapter_concept_candidates(cfg, lecture_id, book_id, chapter_name)
    except Exception as exc:  # noqa: BLE001 - 图谱缺失属于可降级情况
        log_event(
            "chapter_quiz_concepts_unavailable",
            "章节概念目录不可用，改为仅按正文出题",
            payload={"lecture_id": lecture_id, "book_id": book_id, "chapter_name": chapter_name, "error": str(exc)},
        )
        concept_candidates = []
    concept_catalog = serialize_concept_candidates(concept_candidates)
    runner = build_profile_question_runner(cfg, _safe_text(settings.get("model_name")))
    loaded_chapter_context = _safe_text(chapter_context)

    if not loaded_chapter_context:
        start, length = _parse_range(chapter_range)
        from ..bookindex import get_plain_text

        full_text = get_plain_text(dict(cfg or {}), lecture_id, book_id)
        loaded_chapter_context = str(full_text or "")[start:start + length]

    loaded_chapter_detail_xml = str(chapter_detail_xml or "").strip()

    if not loaded_chapter_detail_xml:
        loaded_chapter_detail_xml = str(load_book_detail_xml(dict(cfg or {}), lecture_id, book_id) or "")

    request_text = (
        "请为当前章节生成可用于阅读后小测的题目。"
        "题目要贴合章节内容，并结合用户画像中的薄弱点、兴趣和学习节奏。"
        "固定生成 6 道题：前 4 道为选择题，后 2 道为文本阅读题。"
        "题干必须短、清楚、口语化，每题只考一个明确点。"
        "答案不能包含 Markdown 标记。"
    )
    prompt_notes = _safe_text(settings.get("prompt_notes"))

    if prompt_notes:
        request_text = f"{request_text}\n附加要求：{prompt_notes}"

    model_name = _safe_text(settings.get("model_name"))
    request_timeout = float(settings.get("request_timeout") or 240)
    generation_options = {
        "temperature": float(settings.get("temperature") or 0.2),
        "max_output_tokens": int(settings.get("max_output_tokens") or 4000),
        # 只有 SSE 路径提供增量消费者时才请求模型流，普通 JSON 接口保持完整响应。
        "stream": on_delta is not None,
        "think": False,
    }
    generation_started_at = time.monotonic()

    log_event(
        "chapter_quiz_profile_generate_start",
        "章节小测题库为空，开始调用画像出题模型",
        payload={
            "user_id": user_id,
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_name": chapter_name,
            "chapter_range": chapter_range,
            "model_name": model_name,
            "api_mode": _safe_text(settings.get("api_mode")) or "chat",
            "request_timeout": request_timeout,
            "stream": generation_options["stream"],
            "think": generation_options["think"],
        },
    )
    content = runner.run(
        request_text,
        context_payload={
            "username": user_id,
            "lecture_id": lecture_id,
            "lecture_title": _safe_text(lecture.get("title")),
        },
        extra_prompt_vars={
            "lecture_name": _safe_text(lecture.get("title")),
            "lecture_id": lecture_id,
            "book_name": _safe_text(book.get("title")),
            "chapter_name": chapter_name,
            "chapter_range": chapter_range,
            "lecture_context_memory": _normalize_markdown(read_lecture_context_memory(dict(cfg or {}), user_id, lecture_id)),
            "user_memory": _normalize_markdown(read_memory(dict(cfg or {}), user_id, "user")),
            "chapter_detail_xml": loaded_chapter_detail_xml,
            "chapter_context": loaded_chapter_context[:12000],
            "coarse_bookinfo": str(load_book_info_xml(dict(cfg or {}), lecture_id, book_id) or ""),
            "concept_catalog": concept_catalog,
        },
        model_name=model_name or None,
        username=user_id,
        api_mode=_safe_text(settings.get("api_mode")) or "chat",
        request_timeout=request_timeout,
        options=generation_options,
        on_delta=on_delta,
    )
    rows = _parse_profile_question_blocks(content)
    candidate_types = [
        _normalize_question_type(
            row.get("question_type"),
            _normalize_options(row.get("question_options")),
        )
        for row in rows
    ]

    log_event(
        "chapter_quiz_profile_model_done",
        "章节小测画像模型已返回完整结构化结果",
        payload={
            "user_id": user_id,
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_name": chapter_name,
            "duration_ms": round((time.monotonic() - generation_started_at) * 1000, 2),
            "content_chars": len(str(content or "")),
            "question_block_count": len(rows),
            "choice_candidate_count": candidate_types.count("choice"),
            "text_candidate_count": candidate_types.count("text"),
        },
    )
    validation_error = validate_question_distribution(
        rows,
        expected_count=6,
        minimum_choice_count=4,
        maximum_text_count=2,
    )

    if validation_error:
        log_event(
            "chapter_quiz_profile_generate_rejected",
            "章节小测画像题结果未通过结构校验",
            payload={
                "user_id": user_id,
                "lecture_id": lecture_id,
                "book_id": book_id,
                "chapter_name": chapter_name,
                "validation_error": validation_error,
            },
        )
        raise ValueError(f"章节小测题目未通过结构校验：{validation_error}")

    # 没有概念目录（课程尚无知识图谱）时，题目不可能绑定 concept_id，跳过绑定校验；
    # 题目仍按正文生成，只是不进入认知状态统计。
    concept_validation_error = validate_question_concept_bindings(rows, concept_candidates) if concept_candidates else ""

    if concept_validation_error:
        log_event(
            "chapter_quiz_profile_generate_rejected",
            "章节小测题目缺少有效知识概念绑定",
            payload={
                "user_id": user_id,
                "lecture_id": lecture_id,
                "book_id": book_id,
                "chapter_name": chapter_name,
                "validation_error": concept_validation_error,
            },
        )
        raise ValueError(f"章节小测题目未通过概念绑定校验：{concept_validation_error}")

    selected: List[Dict[str, Any]] = []
    question_group_raw = "|".join(
        [
            user_id,
            lecture_id,
            book_id,
            chapter_name,
            chapter_range,
            str(time.time_ns()),
        ]
    )
    question_group_id = f"qg_{hashlib.sha1(question_group_raw.encode('utf-8')).hexdigest()[:16]}"

    for idx, row in enumerate(rows, start=1):
        record = append_question_bank_item(
            dict(cfg or {}),
            user_id,
            {
                "type": "profile_question",
                "question_group_id": question_group_id,
                "reason": "chapter_quiz_empty_bank",
                "lecture_id": lecture_id,
                "lecture_title": _safe_text(lecture.get("title")),
                "book_id": book_id,
                "book_title": _safe_text(book.get("title")),
                "chapter_name": chapter_name,
                "chapter_range": chapter_range,
                "question_index": idx,
                "visibility": "public",
                "owner_user_id": user_id,
                "generation_mode": "chapter_quiz_sync",
                "concept_id": row["related_concept_id"],
                "question": row,
            },
        )
        normalized = _normalize_question(
            row,
            source="profile_question_model",
            source_id=_safe_text(record.get("question_id")),
        )

        if normalized:
            selected.append(normalized)

        if len(selected) >= limit:
            break

    log_event(
        "chapter_quiz_profile_generate_done",
        "章节小测画像出题模型生成完成",
        payload={
            "user_id": user_id,
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_name": chapter_name,
            "question_count": len(selected),
        },
        content=content[:12000],
    )
    return selected


def _select_chapter_quiz_questions(
    cfg: Mapping[str, Any],
    *,
    user_id: str,
    lecture_id: str,
    book_id: str,
    chapter_name: str,
    chapter_range: str,
    chapter_context: str,
    chapter_detail_xml: str,
    limit: int,
    on_delta: Optional[Callable[[str], None]] = None,
    on_status: Optional[Callable[[str], None]] = None,
) -> List[Dict[str, Any]]:
    candidate_limit = max(int(limit or 3) * 2, 6)
    _emit_quiz_generation_status(on_status, "正在匹配个人练习题库")
    user_questions = _select_user_question_bank_questions(
        cfg,
        user_id=user_id,
        lecture_id=lecture_id,
        book_id=book_id,
        chapter_name=chapter_name,
        chapter_range=chapter_range,
        limit=candidate_limit,
    )

    if user_questions:
        _emit_quiz_generation_status(on_status, "已从个人练习题库匹配本章题目")
        return _shape_chapter_quiz_questions(user_questions, limit)

    _emit_quiz_generation_status(on_status, "正在匹配教材章节题库")
    book_questions = _select_book_question_bank_questions(
        cfg,
        lecture_id=lecture_id,
        book_id=book_id,
        chapter_name=chapter_name,
        chapter_range=chapter_range,
        limit=candidate_limit,
    )

    if book_questions:
        _emit_quiz_generation_status(on_status, "已从教材章节题库匹配本章题目")
        return _shape_chapter_quiz_questions(book_questions, limit)

    _emit_quiz_generation_status(on_status, "题库暂无可用题目，正在按本章内容生成")
    generated_questions = _generate_profile_question_bank_questions(
        cfg,
        user_id=user_id,
        lecture_id=lecture_id,
        book_id=book_id,
        chapter_name=chapter_name,
        chapter_range=chapter_range,
        chapter_context=chapter_context,
        chapter_detail_xml=chapter_detail_xml,
        limit=candidate_limit,
        on_delta=on_delta,
    )
    return _shape_chapter_quiz_questions(generated_questions, limit)


def load_or_create_chapter_quiz(
    cfg: Mapping[str, Any],
    *,
    user_id: str,
    lecture_id: str,
    book_id: str,
    chapter_index: int,
    chapter_name: str,
    chapter_range: str,
    chapter_context: str = "",
    chapter_detail_xml: str = "",
    limit: int = 3,
    on_delta: Optional[Callable[[str], None]] = None,
    on_status: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """读取或创建章节小测；一旦创建，题目固定写入用户文件。"""
    safe_user_id = _safe_text(user_id)
    safe_lecture_id = _safe_text(lecture_id)
    safe_book_id = _safe_text(book_id)
    safe_chapter_name = _safe_text(chapter_name)
    safe_chapter_range = _safe_text(chapter_range)

    if not safe_user_id:
        raise ValueError("user_id is required.")

    if not safe_lecture_id or not safe_book_id or not safe_chapter_name:
        raise ValueError("lecture_id, book_id and chapter_name are required.")

    ensure_user_files(dict(cfg or {}), safe_user_id)
    quiz_id = build_chapter_quiz_id(
        user_id=safe_user_id,
        lecture_id=safe_lecture_id,
        book_id=safe_book_id,
        chapter_index=int(chapter_index or 0),
        chapter_name=safe_chapter_name,
        chapter_range=safe_chapter_range,
    )
    path = _chapter_quiz_path(cfg, safe_user_id, quiz_id)

    with _QUIZ_LOCK:
        existing = _load_existing_chapter_quiz(
            path,
            user_id=safe_user_id,
            lecture_id=safe_lecture_id,
            book_id=safe_book_id,
            chapter_name=safe_chapter_name,
        )

    if existing:
        _emit_quiz_generation_status(on_status, "已读取本章测验")
        return existing

    questions = _select_chapter_quiz_questions(
        cfg,
        user_id=safe_user_id,
        lecture_id=safe_lecture_id,
        book_id=safe_book_id,
        chapter_name=safe_chapter_name,
        chapter_range=safe_chapter_range,
        chapter_context=str(chapter_context or ""),
        chapter_detail_xml=str(chapter_detail_xml or ""),
        limit=max(1, int(limit or 3)),
        on_delta=on_delta,
        on_status=on_status,
    )

    if not questions:
        raise RuntimeError("章节题库为空，画像出题模型也没有返回有效题目")

    now = int(time.time())
    quiz = {
        "quiz_id": quiz_id,
        "type": "chapter_quiz",
        "user_id": safe_user_id,
        "lecture_id": safe_lecture_id,
        "book_id": safe_book_id,
        "chapter_index": int(chapter_index or 0),
        "chapter_name": safe_chapter_name,
        "chapter_range": safe_chapter_range,
        "questions": questions,
        "answers": {},
        "created_at": now,
        "updated_at": now,
    }

    with _QUIZ_LOCK:
        existing = _load_existing_chapter_quiz(
            path,
            user_id=safe_user_id,
            lecture_id=safe_lecture_id,
            book_id=safe_book_id,
            chapter_name=safe_chapter_name,
        )

        if existing:
            return existing

        _write_json(path, quiz)

    log_event(
        "chapter_quiz_created",
        "章节小测已固化写入用户文件",
        payload={
            "user_id": safe_user_id,
            "lecture_id": safe_lecture_id,
            "book_id": safe_book_id,
            "chapter_name": safe_chapter_name,
            "question_count": len(questions),
            "quiz_id": quiz_id,
            "path": str(path),
        },
    )
    return quiz


def save_chapter_quiz_answer(
    cfg: Mapping[str, Any],
    *,
    user_id: str,
    quiz_id: str,
    question_index: int,
    record: Mapping[str, Any],
) -> Dict[str, Any]:
    """把章节小测作答同步写回固化文件。"""
    safe_user_id = _safe_text(user_id)
    safe_quiz_id = _safe_text(quiz_id)

    if not safe_user_id or not safe_quiz_id:
        raise ValueError("user_id and quiz_id are required.")

    path = _chapter_quiz_path(cfg, safe_user_id, safe_quiz_id)

    with _QUIZ_LOCK:
        quiz = _read_json(path)

        if not quiz:
            raise ValueError(f"Chapter quiz not found: {safe_quiz_id}")

        answers = quiz.get("answers") if isinstance(quiz.get("answers"), dict) else {}
        answers[str(int(question_index or 0))] = dict(record or {})
        quiz["answers"] = answers
        quiz["updated_at"] = int(time.time())
        _write_json(path, quiz)

    return quiz
