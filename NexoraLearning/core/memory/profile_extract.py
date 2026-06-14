"""User profile dimension extraction from memory files.

Parses structured profile dimensions from user.md markdown content,
and provides a job executor that uses LLM to extract/update profile dimensions.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping, Optional

from core.booksproc import build_memory_runner, get_memory_settings
from core.runlog import log_event
from core.user import ensure_user_files, read_memory, write_memory

# ── Profile dimension definitions ─────────────────────────────────────

PROFILE_DIMENSIONS: List[Dict[str, str]] = [
    {"key": "major",              "name": "专业方向", "description": "学生的专业和学科方向"},
    {"key": "knowledge_base",     "name": "知识基础", "description": "当前已掌握的知识和技能水平"},
    {"key": "cognitive_style",    "name": "认知风格", "description": "学习偏好：视觉型/听觉型/实践型/理论型"},
    {"key": "interest_direction", "name": "兴趣方向", "description": "对哪些领域或主题特别感兴趣"},
    {"key": "weak_areas",         "name": "薄弱环节", "description": "学习中感到困难或容易出错的领域"},
    {"key": "learning_pace",      "name": "学习节奏", "description": "学习速度偏好：快速浏览/稳步深入/反复巩固"},
    {"key": "error_patterns",     "name": "易错点",   "description": "常见的错误类型和思维误区"},
    {"key": "learning_goal",      "name": "学习目标", "description": "短期和长期的学习目标"},
]

_DIMENSION_KEYS = {d["key"] for d in PROFILE_DIMENSIONS}
_DIMENSION_NAMES = {d["name"] for d in PROFILE_DIMENSIONS}


def _normalize_markdown(text: str) -> str:
    normalized = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    if normalized and not normalized.endswith("\n"):
        normalized += "\n"
    return normalized


def parse_profile_dimensions(user_md: str) -> Dict[str, Dict[str, Any]]:
    """Parse structured profile dimensions from user.md markdown.

    Looks for sections like:
        ## 专业方向
        计算机科学与技术

    Returns a dict keyed by dimension key, each with {name, value, filled}.
    """
    text = str(user_md or "").strip()
    result: Dict[str, Dict[str, Any]] = {}

    for dim in PROFILE_DIMENSIONS:
        result[dim["key"]] = {
            "name": dim["name"],
            "value": "",
            "filled": False,
        }

    if not text:
        return result

    # Try to find dimension sections by name (## 维度名)
    for dim in PROFILE_DIMENSIONS:
        dim_name = dim["name"]
        dim_key = dim["key"]

        # Match ## 维度名 ... (content until next ## or end)
        pattern = re.compile(
            rf"^##\s*{re.escape(dim_name)}\s*\n([\s\S]*?)(?=^##\s|\Z)",
            re.MULTILINE,
        )
        match = pattern.search(text)
        if match:
            value = str(match.group(1) or "").strip()
            if value:
                result[dim_key] = {
                    "name": dim_name,
                    "value": value,
                    "filled": True,
                }

    return result


def parse_profile_timeline(user_md: str) -> Dict[str, List[Dict[str, str]]]:
    """Parse progress and attention timeline entries from user.md.

    Returns {"progress": [...], "attention": [...]} where each entry has {date, text}.
    Entries are sorted by date descending (newest first).
    """
    text = str(user_md or "").strip()
    result: Dict[str, List[Dict[str, str]]] = {
        "progress": [],
        "attention": [],
    }
    if not text:
        return result

    _ENTRY_RE = re.compile(r"^-\s*\[(\d{4}-\d{2}-\d{2})\]\s*(.+)$", re.MULTILINE)

    for section_key, section_name in [("progress", "最近进步"), ("attention", "需要注意")]:
        pattern = re.compile(
            rf"^##\s*{re.escape(section_name)}\s*\n([\s\S]*?)(?=^##\s|\Z)",
            re.MULTILINE,
        )
        match = pattern.search(text)
        if not match:
            continue
        body = str(match.group(1) or "").strip()
        for entry_match in _ENTRY_RE.finditer(body):
            date = str(entry_match.group(1) or "").strip()
            entry_text = str(entry_match.group(2) or "").strip()
            if date and entry_text and entry_text != "暂无":
                result[section_key].append({"date": date, "text": entry_text})

    # Sort by date descending
    for key in result:
        result[key].sort(key=lambda x: x["date"], reverse=True)

    return result


def build_profile_extraction_prompt(
    recent_records: List[Dict[str, Any]],
    current_profile: str,
) -> str:
    """Build a prompt for LLM to extract/update profile dimensions."""
    from prompts import PROFILE_EXTRACTION_PROMPT

    dim_list = "\n".join(
        f"- **{d['name']}** ({d['key']}): {d['description']}"
        for d in PROFILE_DIMENSIONS
    )
    records_json = str(recent_records or [])
    if len(records_json) > 8000:
        records_json = records_json[:8000] + "..."

    return PROFILE_EXTRACTION_PROMPT.replace(
        "{{dim_list}}", dim_list
    ).replace(
        "{{current_profile}}", current_profile or "（暂无画像数据）"
    ).replace(
        "{{records_json}}", records_json
    )


def run_profile_extraction_job(cfg: Mapping[str, Any], job: Mapping[str, Any]) -> None:
    """Execute profile extraction: use LLM to update user.md with structured dimensions."""
    user_id = str(job.get("user_id") or "").strip()
    lecture_id = str(job.get("lecture_id") or "").strip()
    job_id = str(job.get("job_id") or "").strip()
    reason = str(job.get("reason") or "").strip() or "profile_extraction"

    if not user_id:
        raise ValueError("profile extraction job missing user_id")
    if not lecture_id:
        raise ValueError("profile extraction job missing lecture_id")

    ensure_user_files(cfg, user_id)

    settings = dict(get_memory_settings(cfg) or {})
    if not bool(settings.get("enabled", True)):
        log_event(
            "profile_extraction_skip",
            "画像提取已跳过：记忆模型已禁用",
            payload={"job_id": job_id, "user_id": user_id, "lecture_id": lecture_id},
        )
        return

    from core.user import list_learning_records
    recent_rows = list_learning_records(cfg, user_id)
    # Filter for the specific lecture and take last 20
    lecture_rows = [
        r for r in recent_rows
        if isinstance(r, dict) and str(r.get("lecture_id") or "").strip() == lecture_id
    ][-20:]

    current_user_md = str(read_memory(cfg, user_id, "user") or "")

    runner = build_memory_runner(cfg, str(settings.get("model_name") or "").strip())
    prompt = build_profile_extraction_prompt(lecture_rows, current_user_md)

    updated_md = runner.update_memory(
        "user",
        prompt,
        current_memory=current_user_md,
        context_payload={
            "username": user_id,
            "lecture_id": lecture_id,
        },
        model_name=str(settings.get("model_name") or "").strip() or None,
        username=user_id,
    )

    write_memory(cfg, user_id, "user", _normalize_markdown(updated_md))

    # Parse the updated profile for logging
    dimensions = parse_profile_dimensions(updated_md)
    filled_count = sum(1 for d in dimensions.values() if d.get("filled"))

    log_event(
        "profile_extraction_done",
        "画像提取完成",
        payload={
            "job_id": job_id,
            "user_id": user_id,
            "lecture_id": lecture_id,
            "filled_dimensions": filled_count,
            "total_dimensions": len(PROFILE_DIMENSIONS),
        },
    )
