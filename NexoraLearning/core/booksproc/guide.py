"""Reader guide generation for NexoraLearning."""

from __future__ import annotations

import json
import re
from typing import Any, Callable, Dict, List, Mapping, Optional


def _strip_json_fence(content: str) -> str:
    text = str(content or "").strip()
    fenced = re.search(r"```json\s*([\s\S]*?)\s*```", text, flags=re.IGNORECASE)

    if fenced:
        return str(fenced.group(1) or "").strip()

    return text


def _parse_json_object(content: str) -> Dict[str, Any]:
    text = _strip_json_fence(content)

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)

        if not match:
            raise ValueError("模型未返回 JSON 对象")

        parsed = json.loads(match.group(0))

    if not isinstance(parsed, dict):
        raise ValueError("模型返回内容不是 JSON 对象")

    return parsed


def _normalize_list(value: Any, limit: int) -> List[str]:
    rows: List[str] = []
    items = value if isinstance(value, list) else []

    for item in items:
        text = str(item or "").strip()

        if text:
            rows.append(text[:limit])

    return rows


def _normalize_patch(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        return {"paragraph": "", "keywords": [], "note": ""}

    paragraph = str(value.get("paragraph") or value.get("text") or value.get("quote") or "").strip()
    keywords = _normalize_list(value.get("keywords"), 40)
    keyword = str(value.get("keyword") or "").strip()

    if keyword and keyword not in keywords:
        keywords.append(keyword[:40])

    return {
        "paragraph": paragraph[:260],
        "keywords": keywords[:3],
        "note": str(value.get("note") or "").strip()[:160],
    }


def _normalize_guide_cards(value: Any) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    items = value if isinstance(value, list) else []

    for item in items:
        if not isinstance(item, dict):
            continue

        stage = str(item.get("stage") or "").strip()
        title = str(item.get("title") or "").strip()
        guidance = str(item.get("guidance") or "").strip()
        anchor = str(item.get("anchor") or "").strip()
        question = str(item.get("question") or "").strip()
        reason = str(item.get("reason") or "").strip()
        patch = _normalize_patch(item.get("patch"))

        if not title or not guidance:
            continue

        rows.append(
            {
                "stage": stage[:24],
                "title": title[:80],
                "guidance": guidance[:420],
                "anchor": anchor[:180],
                "question": question[:260],
                "reason": reason[:260],
                "patch": patch,
            }
        )

    return rows


def _normalize_reader_guide(content: str) -> Dict[str, Any]:
    parsed = _parse_json_object(content)
    guide = parsed.get("guide") if isinstance(parsed.get("guide"), dict) else parsed
    cards = _normalize_guide_cards(guide.get("guide_cards"))

    if not cards:
        raise ValueError("模型未返回有效导读卡")

    return {
        "overview": str(guide.get("overview") or "").strip()[:500],
        "reading_strategy": str(guide.get("reading_strategy") or "").strip()[:360],
        "focus_points": _normalize_list(guide.get("focus_points"), 120),
        "guide_cards": cards[:6],
        "questions": cards[:6],
    }


def _normalize_pre_reading_questions(content: str) -> List[Dict[str, Any]]:
    parsed = _parse_json_object(content)
    questions = parsed.get("questions") if isinstance(parsed.get("questions"), list) else []

    result = []
    for q in questions:
        if not isinstance(q, dict):
            continue

        options = []
        for opt in (q.get("options") or []):
            if isinstance(opt, dict):
                options.append({
                    "id": str(opt.get("id") or "").strip(),
                    "text": str(opt.get("text") or "").strip(),
                })

        result.append({
            "id": str(q.get("id") or "").strip(),
            "type": str(q.get("type") or "").strip(),
            "title": str(q.get("title") or "").strip(),
            "options": options,
        })

    return result


def _render_reader_guide_prompt(
    *,
    lecture_title: str,
    book_title: str,
    chapter_name: str,
    session_name: str,
    guide_context: str,
    user_profile: str = "",
    pre_reading_answers: Optional[Dict[str, Any]] = None,
) -> str:
    """渲染导读提示词，提示词正文统一维护在 prompts.py。"""
    try:
        from NexoraLearning.prompts import READER_GUIDE_PROMPT
    except ImportError:
        from prompts import READER_GUIDE_PROMPT

    safe_session_name = str(session_name or "").strip() or "整章导读"

    # 构建用户画像注入段
    user_profile_section = ""
    if user_profile:
        user_profile_section = f"""## 用户画像
以下是学生的学习画像，请根据其背景和偏好调整导读的重点和深度：
{user_profile[:1500]}"""

    # 构建阅读前回答注入段
    pre_reading_answers_section = ""
    if pre_reading_answers and isinstance(pre_reading_answers, dict):
        answers = pre_reading_answers.get("answers", {})
        skipped = pre_reading_answers.get("skipped", False)

        if skipped:
            pre_reading_answers_section = """## 阅读前问答
学生跳过了阅读前问答，请根据用户画像自动生成个性化导读。"""
        elif answers:
            answer_lines = []
            for q_id, answer in answers.items():
                if isinstance(answer, dict):
                    question_title = str(answer.get("question_title") or "").strip()
                    answer_text = str(answer.get("answer_text") or "").strip()
                    if question_title and answer_text:
                        answer_lines.append(f"- {question_title}：{answer_text}")

            if answer_lines:
                pre_reading_answers_section = f"""## 阅读前问答
以下是学生在阅读前的自我评估，请据此调整导读的深度和侧重点：
{chr(10).join(answer_lines)}"""

    values = {
        "lecture_title": str(lecture_title or ""),
        "book_title": str(book_title or ""),
        "chapter_name": str(chapter_name or ""),
        "session_name": safe_session_name,
        "guide_context": str(guide_context or "")[:9000],
        "user_profile_section": user_profile_section,
        "pre_reading_answers_section": pre_reading_answers_section,
    }
    prompt = str(READER_GUIDE_PROMPT or "")

    for key, value in values.items():
        prompt = prompt.replace("{{" + key + "}}", value)

    return prompt


def generate_pre_reading_questions(
    cfg: Mapping[str, Any],
    *,
    lecture_id: str,
    book_id: str,
    chapter_name: str,
    session_name: str,
    guide_context: str,
    stream: bool = False,
    on_delta: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Generate pre-reading questions for the active reader chapter or session."""
    from .modeling import build_question_generation_runner
    from .modeling import get_question_generation_settings
    from ..lectures import get_book
    from ..lectures import get_lecture
    from ..runlog import log_event

    try:
        from NexoraLearning.prompts import PRE_READING_QUESTIONS_PROMPT
    except ImportError:
        from prompts import PRE_READING_QUESTIONS_PROMPT

    resolved_cfg = dict(cfg or {})
    safe_lecture_id = str(lecture_id or "").strip()
    safe_book_id = str(book_id or "").strip()
    safe_context = str(guide_context or "").strip()

    if not safe_lecture_id or not safe_book_id:
        raise ValueError("lecture_id and book_id are required.")

    if not safe_context:
        raise ValueError("guide_context is required.")

    lecture = get_lecture(resolved_cfg, safe_lecture_id)
    book = get_book(resolved_cfg, safe_lecture_id, safe_book_id)

    if lecture is None or book is None:
        raise ValueError(f"Book not found: {safe_lecture_id}/{safe_book_id}")

    settings = get_question_generation_settings(resolved_cfg)
    runner = build_question_generation_runner(resolved_cfg)

    safe_session_name = str(session_name or "").strip() or "整章导读"
    prompt = str(PRE_READING_QUESTIONS_PROMPT or "")
    values = {
        "lecture_title": str(lecture.get("title") or ""),
        "book_title": str(book.get("title") or ""),
        "chapter_name": str(chapter_name or ""),
        "session_name": safe_session_name,
        "guide_context": safe_context[:9000],
    }

    for key, value in values.items():
        prompt = prompt.replace("{{" + key + "}}", value)

    log_event(
        "pre_reading_questions_start",
        "阅读前问答生成开始",
        payload={
            "lecture_id": safe_lecture_id,
            "book_id": safe_book_id,
            "chapter_name": str(chapter_name or ""),
            "session_name": str(session_name or ""),
        },
    )

    content = runner.run(
        request=prompt,
        api_mode="chat",
        options={
            "temperature": float(settings.get("temperature") or 0.3),
            "max_tokens": 1000,
            "stream": bool(stream),
        },
        request_timeout=float(settings.get("request_timeout") or 120),
        on_delta=on_delta,
    )

    if not content:
        raise RuntimeError("Model returned empty pre-reading questions")

    questions = _normalize_pre_reading_questions(content)

    if not questions:
        raise ValueError("模型未返回有效问题")

    log_event(
        "pre_reading_questions_done",
        "阅读前问答生成完成",
        payload={
            "lecture_id": safe_lecture_id,
            "book_id": safe_book_id,
            "chapter_name": str(chapter_name or ""),
            "session_name": str(session_name or ""),
            "questions_count": len(questions),
        },
    )

    return {
        "questions": questions,
        "model_name": str(runner.model_name or ""),
        "chapter_name": str(chapter_name or ""),
        "session_name": str(session_name or ""),
    }


def generate_reader_guide(
    cfg: Mapping[str, Any],
    *,
    lecture_id: str,
    book_id: str,
    chapter_name: str,
    session_name: str,
    guide_context: str,
    stream: bool = False,
    on_delta: Optional[Callable[[str], None]] = None,
    user_profile: str = "",
    pre_reading_answers: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Generate guide questions for the active reader chapter or session."""
    from .modeling import build_question_generation_runner
    from .modeling import get_question_generation_settings
    from ..lectures import get_book
    from ..lectures import get_lecture
    from ..runlog import log_event

    resolved_cfg = dict(cfg or {})
    safe_lecture_id = str(lecture_id or "").strip()
    safe_book_id = str(book_id or "").strip()
    safe_context = str(guide_context or "").strip()

    if not safe_lecture_id or not safe_book_id:
        raise ValueError("lecture_id and book_id are required.")

    if not safe_context:
        raise ValueError("guide_context is required.")

    lecture = get_lecture(resolved_cfg, safe_lecture_id)
    book = get_book(resolved_cfg, safe_lecture_id, safe_book_id)

    if lecture is None or book is None:
        raise ValueError(f"Book not found: {safe_lecture_id}/{safe_book_id}")

    settings = get_question_generation_settings(resolved_cfg)
    runner = build_question_generation_runner(resolved_cfg)
    prompt = _render_reader_guide_prompt(
        lecture_title=str(lecture.get("title") or ""),
        book_title=str(book.get("title") or ""),
        chapter_name=str(chapter_name or ""),
        session_name=str(session_name or ""),
        guide_context=safe_context,
        user_profile=user_profile,
        pre_reading_answers=pre_reading_answers,
    )

    log_event(
        "reader_guide_start",
        "Reader 导读生成开始",
        payload={
            "lecture_id": safe_lecture_id,
            "book_id": safe_book_id,
            "chapter_name": str(chapter_name or ""),
            "session_name": str(session_name or ""),
            "stream": bool(stream),
        },
    )

    content = runner.run(
        request=prompt,
        api_mode="chat",
        options={
            "temperature": float(settings.get("temperature") or 0.3),
            "max_tokens": 1800,
            "stream": bool(stream),
        },
        request_timeout=float(settings.get("request_timeout") or 240),
        on_delta=on_delta,
    )

    if not content:
        raise RuntimeError("Model returned empty reader guide")

    guide = _normalize_reader_guide(content)
    log_event(
        "reader_guide_done",
        "Reader 导读生成完成",
        payload={
            "lecture_id": safe_lecture_id,
            "book_id": safe_book_id,
            "chapter_name": str(chapter_name or ""),
            "session_name": str(session_name or ""),
            "guide_cards_count": len(guide.get("guide_cards") or []),
        },
    )

    return {
        "guide": guide,
        "model_name": str(runner.model_name or ""),
        "chapter_name": str(chapter_name or ""),
        "session_name": str(session_name or ""),
    }
