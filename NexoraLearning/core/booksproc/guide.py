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


def _render_reader_guide_prompt(
    *,
    lecture_title: str,
    book_title: str,
    chapter_name: str,
    session_name: str,
    guide_context: str,
) -> str:
    """渲染导读提示词，提示词正文统一维护在 prompts.py。"""
    try:
        from NexoraLearning.prompts import READER_GUIDE_PROMPT
    except ImportError:
        from prompts import READER_GUIDE_PROMPT

    safe_session_name = str(session_name or "").strip() or "整章导读"
    values = {
        "lecture_title": str(lecture_title or ""),
        "book_title": str(book_title or ""),
        "chapter_name": str(chapter_name or ""),
        "session_name": safe_session_name,
        "guide_context": str(guide_context or "")[:9000],
    }
    prompt = str(READER_GUIDE_PROMPT or "")

    for key, value in values.items():
        prompt = prompt.replace("{{" + key + "}}", value)

    return prompt


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
