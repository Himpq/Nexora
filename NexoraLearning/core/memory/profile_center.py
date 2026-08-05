"""Learner profile six-dimensional scoring, persistence, and quick-interview prompt assembly."""

from __future__ import annotations

import json
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Mapping

from core.memory.profile_extract import PROFILE_DIMENSIONS, parse_profile_dimensions, parse_profile_timeline
from core.runlog import log_event
from core.user import ensure_user_files, read_memory
from prompts import PROFILE_QUICK_INTERVIEW_PROMPT


PROFILE_SCORE_DIMENSIONS: List[Dict[str, str]] = [
    {"key": "initiative", "name": "积极性"},
    {"key": "exploration", "name": "探索性"},
    {"key": "stability", "name": "稳健性"},
    {"key": "autonomy", "name": "自主性"},
    {"key": "reflection", "name": "反思性"},
    {"key": "persistence", "name": "坚持性"},
]

_PROFILE_SCORE_KEYS = {item["key"] for item in PROFILE_SCORE_DIMENSIONS}
_PROFILE_CENTER_LOCK = threading.RLock()
_SAFE_USER_ID_RE = re.compile(r"^[A-Za-z0-9_.@-]+$")


def validate_profile_center_user_id(user_id: str) -> str:
    safe_user_id = str(user_id or "").strip()

    if not safe_user_id or not _SAFE_USER_ID_RE.fullmatch(safe_user_id):
        raise ValueError("invalid user_id")

    return safe_user_id


def _profile_center_path(cfg: Mapping[str, Any], user_id: str) -> Path:
    safe_user_id = validate_profile_center_user_id(user_id)
    return Path(str(cfg.get("data_dir") or "data")) / "users" / safe_user_id / "profile_center.json"


def _empty_scores() -> List[Dict[str, Any]]:
    return [
        {
            "key": item["key"],
            "name": item["name"],
            "score": None,
            "evidence": "待通过画像访谈完善",
            "confidence": None,
        }
        for item in PROFILE_SCORE_DIMENSIONS
    ]


def _initial_state() -> Dict[str, Any]:
    return {
        "version": 2,
        "messages": [],
        "scores": _empty_scores(),
        "updated_at": 0,
    }


def _normalize_stored_state(value: Any) -> Dict[str, Any]:
    state = _initial_state()

    if not isinstance(value, dict):
        return state

    messages: List[Dict[str, Any]] = []

    for item in value.get("messages") or []:
        if not isinstance(item, dict):
            continue

        role = str(item.get("role") or "").strip().lower()
        content = str(item.get("content") or "").strip()

        # 旧版欢迎语是前端打开即写死的问题，单独迁移掉后由模型主动开场。
        if str(item.get("id") or "").strip() == "profile_welcome":
            continue

        if role not in {"user", "assistant"} or not content:
            continue

        messages.append(
            {
                "id": str(item.get("id") or f"profile_{uuid.uuid4().hex[:16]}"),
                "role": role,
                "content": content[:4000],
                "created_at": int(item.get("created_at") or 0),
            }
        )

    if messages:
        state["messages"] = messages[-40:]

    stored_scores = {
        str(item.get("key") or "").strip(): item
        for item in value.get("scores") or []
        if isinstance(item, dict)
    }
    scores = []

    for definition in PROFILE_SCORE_DIMENSIONS:
        item = stored_scores.get(definition["key"], {})
        raw_score = item.get("score")
        score = int(raw_score) if isinstance(raw_score, (int, float)) and 0 <= raw_score <= 100 else None
        raw_confidence = item.get("confidence")
        confidence = (
            round(float(raw_confidence), 3)
            if score is not None and isinstance(raw_confidence, (int, float)) and 0 <= raw_confidence <= 1
            else None
        )
        scores.append(
            {
                "key": definition["key"],
                "name": definition["name"],
                "score": score,
                "evidence": str(item.get("evidence") or "待通过画像访谈完善").strip()[:300],
                "confidence": confidence,
            }
        )

    state["scores"] = scores
    state["updated_at"] = int(value.get("updated_at") or 0)
    return state


def _load_state(cfg: Mapping[str, Any], user_id: str) -> Dict[str, Any]:
    target = _profile_center_path(cfg, user_id)

    if not target.exists():
        return _initial_state()

    with _PROFILE_CENTER_LOCK:
        payload = json.loads(target.read_text(encoding="utf-8"))

    return _normalize_stored_state(payload)


def _save_state(cfg: Mapping[str, Any], user_id: str, state: Mapping[str, Any]) -> None:
    safe_user_id = validate_profile_center_user_id(user_id)
    ensure_user_files(dict(cfg), safe_user_id)
    target = _profile_center_path(cfg, safe_user_id)
    temporary = target.with_suffix(".json.tmp")
    payload = json.dumps(dict(state), ensure_ascii=False, indent=2)

    with _PROFILE_CENTER_LOCK:
        temporary.write_text(payload, encoding="utf-8")
        temporary.replace(target)


def build_profile_interview_prompt(state: Mapping[str, Any]) -> str:
    """Assemble the quick-interview kickoff prompt with the current score state embedded."""
    score_lines = []

    for item in state.get("scores") or []:
        name = str(item.get("name") or "").strip()
        key = str(item.get("key") or "").strip()

        if item.get("score") is None:
            score_lines.append(f"- {name} ({key})：未评分")
        else:
            score_lines.append(f"- {name} ({key})：{int(item['score'])} 分")

    current_scores = "\n".join(score_lines)
    return PROFILE_QUICK_INTERVIEW_PROMPT.replace("{{current_scores}}", current_scores)


def build_profile_center_payload(cfg: Mapping[str, Any], user_id: str) -> Dict[str, Any]:
    safe_user_id = validate_profile_center_user_id(user_id)
    state = _load_state(cfg, safe_user_id)
    user_md = str(read_memory(dict(cfg), safe_user_id, "user") or "")
    dimensions = parse_profile_dimensions(user_md)
    filled_count = sum(1 for item in dimensions.values() if item.get("filled"))
    scored_count = sum(1 for item in state["scores"] if item.get("score") is not None)

    return {
        **state,
        "dimensions": dimensions,
        "timeline": parse_profile_timeline(user_md),
        "profile_completion": round(filled_count / len(PROFILE_DIMENSIONS), 3),
        "profile_filled_count": filled_count,
        "profile_total": len(PROFILE_DIMENSIONS),
        "score_completion": round(scored_count / len(PROFILE_SCORE_DIMENSIONS), 3),
        "scored_count": scored_count,
        "score_total": len(PROFILE_SCORE_DIMENSIONS),
        "interview_prompt": build_profile_interview_prompt(state),
    }


def record_profile_center_score(
    cfg: Mapping[str, Any],
    *,
    user_id: str,
    dimension_key: str,
    score: Any,
    evidence: str,
    confidence: Any,
) -> Dict[str, Any]:
    """Record one dimension score from the sidebar quick interview (submit_profile_score tool)."""
    safe_user_id = validate_profile_center_user_id(user_id)
    key = str(dimension_key or "").strip()

    if key not in _PROFILE_SCORE_KEYS:
        raise ValueError(f"不支持的画像维度：{key}")

    if not isinstance(score, (int, float)) or isinstance(score, bool) or int(score) != score or not 0 <= score <= 100:
        raise ValueError("score 必须是 0-100 的整数")

    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or not 0 <= confidence <= 1:
        raise ValueError("confidence 必须是 0-1 之间的小数")

    evidence_text = str(evidence or "").strip()

    if not evidence_text:
        raise ValueError("缺少评分依据")

    state = _load_state(cfg, safe_user_id)

    for item in state["scores"]:
        if item["key"] == key:
            item["score"] = int(score)
            item["evidence"] = evidence_text[:300]
            item["confidence"] = round(float(confidence), 3)
            break

    state["updated_at"] = int(time.time())

    with _PROFILE_CENTER_LOCK:
        _save_state(cfg, safe_user_id, state)

    log_event(
        "profile_center_score_recorded",
        "画像中心维度评分已写回",
        payload={
            "user_id": safe_user_id,
            "dimension_key": key,
            "score": int(score),
        },
    )
    return build_profile_center_payload(cfg, safe_user_id)
