"""Profile-aware question bank generation."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Mapping, Optional

from .booksproc import build_profile_question_runner, get_profile_question_settings
from .lectures import get_book, get_lecture, load_book_detail_xml, load_book_info_xml, load_book_text
from .learning_feed import prepend_learning_feed_item
from .runlog import log_event
from .user import (
    append_question_bank_item,
    ensure_user_files,
    read_lecture_context_memory,
    read_memory,
)


QUESTION_BLOCK_RE = re.compile(r"<QUESTION>\s*(.*?)\s*</QUESTION>", flags=re.IGNORECASE | re.DOTALL)


def _xml_value(block: str, tag: str) -> str:
    match = re.search(
        rf"<{re.escape(tag)}>\s*(.*?)\s*</{re.escape(tag)}>",
        str(block or ""),
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return ""
    return str(match.group(1) or "").strip()


def _parse_question_blocks(content: str) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    for block in QUESTION_BLOCK_RE.findall(str(content or "")):
        row = {
            "question_title": _xml_value(block, "question_title"),
            "question_difficulty": _xml_value(block, "question_difficulty"),
            "question_content": _xml_value(block, "question_content"),
            "question_reason": _xml_value(block, "question_reason"),
            "question_answer": _xml_value(block, "question_answer"),
            "related_chapter": _xml_value(block, "related_chapter"),
        }
        if row["question_title"] or row["question_content"]:
            rows.append(row)
    return rows


def _normalize_markdown(text: str) -> str:
    normalized = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    if normalized and not normalized.endswith("\n"):
        normalized += "\n"
    return normalized


def run_profile_question_job(cfg: Mapping[str, Any], job: Mapping[str, Any]) -> None:
    user_id = str(job.get("user_id") or "").strip()
    lecture_id = str(job.get("lecture_id") or "").strip()
    payload = dict(job.get("payload") or {})
    job_id = str(job.get("job_id") or "").strip()
    reason = str(job.get("reason") or "").strip() or "manual"
    if not user_id:
        raise ValueError("profile question job missing user_id")
    if not lecture_id:
        raise ValueError("profile question job missing lecture_id")
    ensure_user_files(cfg, user_id)

    settings = dict(get_profile_question_settings(cfg) or {})
    log_event(
        "profile_question_job_run_input",
        "用户画像出题任务输入已加载",
        payload={
            "source": "profile_question",
            "job_id": job_id,
            "user_id": user_id,
            "lecture_id": lecture_id,
            "reason": reason,
            "payload_keys": sorted(str(key) for key in payload.keys()),
            "model_name": str(settings.get("model_name") or "").strip(),
            "enabled": bool(settings.get("enabled", True)),
        },
    )
    if not bool(settings.get("enabled", True)):
        log_event(
            "profile_question_job_skip",
            "用户画像出题任务已跳过：模型已禁用",
            payload={"source": "profile_question", "job_id": job_id, "user_id": user_id, "lecture_id": lecture_id},
        )
        return

    lecture = get_lecture(dict(cfg or {}), lecture_id)
    if not isinstance(lecture, dict):
        raise ValueError(f"Lecture not found: {lecture_id}")
    book_id = str(payload.get("book_id") or "").strip()
    book = get_book(dict(cfg or {}), lecture_id, book_id) if book_id else None
    if book_id and not isinstance(book, dict):
        raise ValueError(f"Book not found: {lecture_id}/{book_id}")

    chapter_name = str(payload.get("chapter_name") or "").strip()
    chapter_range = str(payload.get("chapter_range") or "").strip()
    chapter_context = str(payload.get("chapter_context") or "")
    chapter_detail_xml = str(payload.get("chapter_detail_xml") or "")
    if not chapter_detail_xml and book_id:
        chapter_detail_xml = str(load_book_detail_xml(dict(cfg or {}), lecture_id, book_id) or "")
    if not chapter_context and book_id:
        chapter_context = str(load_book_text(dict(cfg or {}), lecture_id, book_id) or "")
    lecture_context_memory = str(read_lecture_context_memory(dict(cfg or {}), user_id, lecture_id) or "")
    user_memory = str(read_memory(dict(cfg or {}), user_id, "user") or "")
    coarse_bookinfo = str(load_book_info_xml(dict(cfg or {}), lecture_id, book_id) or "") if book_id else ""

    runner = build_profile_question_runner(cfg, str(settings.get("model_name") or "").strip())
    request_text = (
        "请基于该用户画像与当前课程/章节，为题库生成一组高质量复习题。"
        "题目必须服务于后续巩固和差异化检验。"
    )
    prompt_notes = str(settings.get("prompt_notes") or "").strip()
    if prompt_notes:
        request_text = f"{request_text}\n附加要求：{prompt_notes}"
    content = runner.run(
        request_text,
        context_payload={
            "username": user_id,
            "lecture_id": lecture_id,
            "lecture_title": str(lecture.get("title") or "").strip(),
        },
        extra_prompt_vars={
            "lecture_name": str(lecture.get("title") or "").strip(),
            "book_name": str((book or {}).get("title") or "").strip(),
            "chapter_name": chapter_name,
            "chapter_range": chapter_range,
            "lecture_context_memory": _normalize_markdown(lecture_context_memory),
            "user_memory": _normalize_markdown(user_memory),
            "chapter_detail_xml": chapter_detail_xml,
            "chapter_context": chapter_context[:12000],
            "coarse_bookinfo": coarse_bookinfo,
        },
        model_name=str(settings.get("model_name") or "").strip() or None,
        username=user_id,
        api_mode=str(settings.get("api_mode") or "chat"),
        request_timeout=float(settings.get("request_timeout") or 240),
        options={
            "temperature": float(settings.get("temperature") or 0.2),
            "max_output_tokens": int(settings.get("max_output_tokens") or 4000),
            "stream": bool(settings.get("stream", True)),
            "think": bool(settings.get("think", False)),
        },
    )
    rows = _parse_question_blocks(content)
    for idx, row in enumerate(rows, start=1):
        append_question_bank_item(
            dict(cfg or {}),
            user_id,
            {
                "type": "profile_question",
                "job_id": job_id,
                "reason": reason,
                "lecture_id": lecture_id,
                "lecture_title": str(lecture.get("title") or "").strip(),
                "book_id": book_id,
                "book_title": str((book or {}).get("title") or "").strip(),
                "chapter_name": chapter_name,
                "chapter_range": chapter_range,
                "question_index": idx,
                "visibility": "public",
                "owner_user_id": user_id,
                "generation_mode": "profile_adaptive",
                "question": row,
            },
        )
    log_event(
        "profile_question_job_done",
        "用户画像出题任务完成",
        payload={
            "source": "profile_question",
            "job_id": job_id,
            "user_id": user_id,
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_name": chapter_name,
            "question_count": len(rows),
        },
        content=content[:12000],
    )
