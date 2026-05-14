"""Learning memory/profile analysis runner."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Mapping

from .booksproc import build_memory_runner, get_memory_settings
from .memory_queue import mark_analysis_completed
from .runlog import log_event
from .user import (
    ensure_user_files,
    list_learning_records,
    read_lecture_context_memory,
    read_memory,
    write_lecture_context_memory,
    write_memory,
)


def _recent_records_for_lecture(cfg: Mapping[str, Any], user_id: str, lecture_id: str, limit: int = 12) -> List[Dict[str, Any]]:
    rows = list_learning_records(cfg, user_id)
    out: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("lecture_id") or "").strip() != str(lecture_id or "").strip():
            continue
        out.append(dict(row))
    return out[-max(1, int(limit or 12)) :]


def _normalize_markdown(text: str) -> str:
    normalized = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    if normalized and not normalized.endswith("\n"):
        normalized += "\n"
    return normalized


def _analysis_prompt(memory_type: str, reason: str, lecture_id: str, recent_rows: List[Dict[str, Any]]) -> str:
    recent_json = json.dumps(recent_rows, ensure_ascii=False, indent=2)
    if memory_type == "user":
        return (
            "Update the global `user.md` memory for this learner.\n"
            "Keep only durable cross-course user profile facts: study habits, stable preferences, long-term strengths, and repeated weaknesses.\n"
            "Do not include temporary dialogue state or lecture-specific details.\n"
            "Return the full updated markdown file only.\n\n"
            f"Trigger reason: {reason}\n"
            f"Lecture ID: {lecture_id}\n"
            f"Recent lecture records (JSON): {recent_json}"
        )
    if memory_type == "soul":
        return (
            "Update the global `soul.md` memory for this learner.\n"
            "Keep only stable response strategy guidance for future assistant replies: pacing, explanation order, teaching style, and formatting preferences.\n"
            "Do not include lecture facts or temporary conversation state.\n"
            "Return the full updated markdown file only.\n\n"
            f"Trigger reason: {reason}\n"
            f"Lecture ID: {lecture_id}\n"
            f"Recent lecture records (JSON): {recent_json}"
        )
    return (
        "Update the lecture-specific `context/{lecture_id}.md` memory for this learner.\n"
        "Keep only stable course-level context for the current lecture: progress, recurring misconceptions, important open questions, and durable chapter conclusions.\n"
        "Do not include temporary per-thread planning or short-lived dialogue state.\n"
        "Return the full updated markdown file only.\n\n"
        f"Trigger reason: {reason}\n"
        f"Lecture ID: {lecture_id}\n"
        f"Recent lecture records (JSON): {recent_json}"
    )


def run_memory_analysis_job(cfg: Mapping[str, Any], job: Mapping[str, Any]) -> None:
    ensure_user_files(cfg, str(job.get("user_id") or "").strip())
    user_id = str(job.get("user_id") or "").strip()
    lecture_id = str(job.get("lecture_id") or "").strip()
    job_id = str(job.get("job_id") or "").strip()
    reason = str(job.get("reason") or "").strip() or "manual"
    payload = dict(job.get("payload") or {})
    if not user_id:
        raise ValueError("memory analysis job missing user_id")
    if not lecture_id:
        raise ValueError("memory analysis job missing lecture_id")

    settings = dict(get_memory_settings(cfg) or {})
    recent_conversation_messages = payload.get("recent_conversation_messages") if isinstance(payload.get("recent_conversation_messages"), list) else []
    log_event(
        "memory_job_run_input",
        "Memory analysis job input loaded.",
        payload={
            "source": "memory",
            "job_id": job_id,
            "user_id": user_id,
            "lecture_id": lecture_id,
            "reason": reason,
            "payload_keys": sorted([str(key) for key in payload.keys()]),
            "memory_enabled": bool(settings.get("enabled", True)),
            "model_name": str(settings.get("model_name") or "").strip(),
            "recent_conversation_messages_count": len(recent_conversation_messages),
        },
    )
    if not bool(settings.get("enabled", True)):
        log_event(
            "memory_job_skip",
            "Memory analysis job skipped because the memory model is disabled.",
            payload={"source": "memory", "job_id": job_id, "user_id": user_id, "lecture_id": lecture_id},
        )
        return

    runner = build_memory_runner(cfg, str(settings.get("model_name") or "").strip())
    recent_rows = _recent_records_for_lecture(cfg, user_id, lecture_id)
    user_memory = str(read_memory(cfg, user_id, "user") or "")
    soul_memory = str(read_memory(cfg, user_id, "soul") or "")
    context_memory = str(read_lecture_context_memory(cfg, user_id, lecture_id) or "")
    context_payload = {
        "username": user_id,
        "lecture_id": lecture_id,
        "user_progress": {
            "recent_records_count": len(recent_rows),
        },
    }
    base_extra_vars = {
        "reason": reason,
        "payload_json": json.dumps(payload, ensure_ascii=False, indent=2),
        "recent_records_json": json.dumps(recent_rows, ensure_ascii=False, indent=2),
        "recent_conversation_messages_json": json.dumps(recent_conversation_messages, ensure_ascii=False, indent=2),
        "lecture_id": lecture_id,
        "job_id": job_id,
    }
    shared_input_suffix = (
        "\n\nRecent conversation messages (JSON): "
        + json.dumps(recent_conversation_messages, ensure_ascii=False, indent=2)
    )

    next_user_memory = runner.update_memory(
        "user",
        _analysis_prompt("user", reason, lecture_id, recent_rows) + shared_input_suffix,
        current_memory=user_memory,
        context_payload=context_payload,
        extra_prompt_vars=base_extra_vars,
        model_name=str(settings.get("model_name") or "").strip() or None,
        username=user_id,
    )
    next_soul_memory = runner.update_memory(
        "soul",
        _analysis_prompt("soul", reason, lecture_id, recent_rows) + shared_input_suffix,
        current_memory=soul_memory,
        context_payload=context_payload,
        extra_prompt_vars=base_extra_vars,
        model_name=str(settings.get("model_name") or "").strip() or None,
        username=user_id,
    )
    next_context_memory = runner.update_memory(
        "context",
        _analysis_prompt("context", reason, lecture_id, recent_rows) + shared_input_suffix,
        current_memory=context_memory,
        context_payload=context_payload,
        extra_prompt_vars=base_extra_vars,
        model_name=str(settings.get("model_name") or "").strip() or None,
        username=user_id,
    )

    write_memory(cfg, user_id, "user", _normalize_markdown(next_user_memory))
    write_memory(cfg, user_id, "soul", _normalize_markdown(next_soul_memory))
    write_lecture_context_memory(cfg, user_id, lecture_id, _normalize_markdown(next_context_memory))

    mark_analysis_completed(
        cfg,
        user_id,
        lecture_id,
        job_id=job_id,
        reason=reason,
    )
    log_event(
        "memory_job_done",
        "Memory analysis job completed.",
        payload={
            "source": "memory",
            "job_id": job_id,
            "user_id": user_id,
            "lecture_id": lecture_id,
            "reason": reason,
            "recent_records_count": len(recent_rows),
            "user_chars": len(str(next_user_memory or "")),
            "soul_chars": len(str(next_soul_memory or "")),
            "context_chars": len(str(next_context_memory or "")),
        },
    )
