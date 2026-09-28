"""Learner observations that do not require a generated knowledge graph.

Reading coverage describes exposure, self-reports describe what a learner said,
and assessment evidence describes demonstrated knowledge. Keep those distinct.
"""
from __future__ import annotations

import hashlib
import json
import time
from typing import Any, Dict, Mapping

from core import user as user_store
from core.lectures import get_lecture, list_books
from core.user.learning_progress import compute_user_lecture_progress, _timestamp_to_unix_seconds


def _observation_timestamp(*values: Any) -> int:
    """Keep legacy seconds/milliseconds sortable and safe to format locally."""
    for value in values:
        if isinstance(value, bool):
            continue
        try:
            at = _timestamp_to_unix_seconds(value)
            if 0 < at <= 253_402_300_799:  # Last Unix second in calendar year 9999.
                time.localtime(at)  # Windows may have a narrower calendar range.
                return at
        except (TypeError, ValueError, OverflowError, OSError):
            continue
    return 0


def learning_observations(cfg: Mapping[str, Any], username: str) -> Dict[str, Any]:
    # Normalize a view of the records before progress aggregation and display;
    # retain the original stored values for audit and preserve measured duration.
    records = []
    for row in user_store.list_learning_records(cfg, username) or []:
        if not isinstance(row, Mapping):
            continue
        at = _observation_timestamp(row.get("timestamp"), row.get("ts"))
        records.append({**row, "timestamp": at, "ts": at})
    selected = user_store.list_selected_lecture_ids(cfg, username)
    facets = []
    courses = []
    reading_seconds = 0.0
    read_chapters = 0
    latest_at = 0
    for lecture_id in selected:
        books = list_books(cfg, lecture_id)
        progress = compute_user_lecture_progress(username, lecture_id, books, records=records, cfg=cfg)
        course_records = [row for row in records if row.get("lecture_id") == lecture_id]
        activity = [row for row in course_records if row.get("type") in {
            "reading_progress", "chapter_completed", "session_completed", "study_time", "study_session",
        }]
        title = str((get_lecture(cfg, lecture_id) or {}).get("title") or lecture_id)
        seconds = float(progress.get("reading_seconds") or 0)
        count = int(progress.get("read_chapters") or 0)
        percent = float(progress.get("reading_progress") or 0)
        reading_seconds += seconds
        read_chapters += count
        courses.append({"lecture_id": lecture_id, "title": title, **progress})
        if not activity and seconds <= 0 and count <= 0:
            continue
        at = max((row["timestamp"] for row in activity), default=0)
        latest_at = max(latest_at, at)
        latest = max(activity, key=lambda row: row["timestamp"], default={})
        duration = f"{seconds / 60:.1f} 分钟" if seconds >= 60 else f"{seconds:.0f} 秒"
        claim = f"我记下了你在《{title}》的阅读：{duration}，已读到 {count} 个章节，覆盖 {percent:g}%。"
        if seconds > 0 and count == 0:
            claim = f"我记下了你在《{title}》的阅读：{duration}。已有记录缺少页面范围，我还不能据此估算阅读覆盖。"
        evidence = [{
            "label": f"{time.strftime('%m-%d %H:%M', time.localtime(at)) if at else ''} 阅读记录：{duration}，{int(progress.get('read_chars') or 0)} 字；阅读尚不等于掌握。",
            "source": "reading",
            "sourceId": str(latest.get("event_id") or latest.get("session_id") or ""),
            "occurredAt": at,
            "conceptId": "",
        }]
        facets.append({
            "id": "reading_" + hashlib.sha1(lecture_id.encode("utf-8")).hexdigest()[:16],
            "kind": "reading", "claim": claim, "confidence": 1.0,
            "concept": "阅读记录", "conceptId": "", "lectureId": lecture_id,
            "bookId": str(latest.get("book_id") or (books[0].get("id") if books else "") or ""),
            "evidence": evidence, "userVerdict": None, "updatedAt": at,
        })

    from core.memory.evidence_memory import retrieve_memories, memory_stats

    memories = retrieve_memories(cfg, username, limit=16)
    memory_counts = memory_stats(cfg, username)
    labels = {"goal": "学习目标", "preference": "学习偏好", "difficulty": "你提到的困难",
              "background": "你介绍的背景", "interest": "学习兴趣", "conversation": "最近交流", "insight": "我的观察"}
    for row in memories:
        at = _observation_timestamp(row.get("occurred_at"))
        latest_at = max(latest_at, at)
        kind = str(row.get("kind") or "conversation")
        said = str(row.get("said_on") or "")
        if kind == "insight":
            sources = []
            try:
                sources = [str(s) for s in json.loads(str(row.get("value") or "[]"))]
            except (TypeError, ValueError):
                sources = []
            facets.append({
                "id": "memory_" + row["id"], "kind": "insight",
                "claim": str(row.get("quote") or ""), "confidence": float(row.get("confidence") or 0),
                "concept": labels["insight"], "conceptId": "",
                "lectureId": "", "bookId": "",
                "evidence": [{"label": f"{said} 夜间反思，依据 {len(sources)} 条你的原话", "source": "reflection",
                              "sourceId": str(row.get("source_id") or ""), "occurredAt": at, "conceptId": ""}]
                            + [{"label": f"原话记忆 {sid}", "source": "user_message", "sourceId": sid, "occurredAt": 0, "conceptId": ""}
                               for sid in sources[:4]],
                "userVerdict": None, "updatedAt": at, "insight": True,
            })
            continue
        facets.append({
            "id": "memory_" + row["id"], "kind": kind,
            "claim": str(row.get("claim") or row.get("quote") or ""),
            "confidence": float(row.get("confidence") or 0),
            "concept": labels.get(kind, "你的自述"), "conceptId": "",
            "lectureId": str(row.get("lecture_id") or ""), "bookId": str(row.get("book_id") or ""),
            "evidence": [{"label": f"{time.strftime('%m-%d %H:%M', time.localtime(at)) if at else ''} 你说：{row.get('quote', '')}"
                                   + (f"（来源：{row.get('source') or 'app'}）" if row.get("source") else ""),
                          "source": "user_message", "sourceId": str(row.get("source_id") or ""),
                          "occurredAt": at, "conceptId": ""}],
            "userVerdict": None, "updatedAt": at, "saidOn": said,
        })
    return {
        "facets": facets, "courses": courses,
        "activity": {
            "reading_seconds": round(reading_seconds, 1), "read_chapters": read_chapters,
            "conversation_count": sum(1 for row in records if row.get("type") == "agent_user_msg"),
            "memory_count": memory_counts["active_count"], "last_activity_at": latest_at,
        },
    }
