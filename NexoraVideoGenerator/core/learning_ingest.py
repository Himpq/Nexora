"""NexoraLearning payload normalization for video generation."""

from __future__ import annotations

from typing import Any, Dict, List, Mapping

LEARNING_CONTENT_KEYS = (
    "coarse_reading",
    "intensive_reading",
    "key_points",
    "chapter_structure",
    "source_notes",
)


def normalize_learning_project_payload(payload: Mapping[str, Any]) -> Dict[str, Any]:
    """Convert a strict NexoraLearning aggregation payload into a project payload."""
    if not isinstance(payload, Mapping):
        raise ValueError("learning request body must be a JSON object")

    title = _required_text(payload, "title", max_chars=80)
    learning = payload.get("learning")

    if not isinstance(learning, Mapping):
        raise ValueError("learning must be a JSON object")

    normalized_learning = _normalize_learning_context(learning)
    extra_prompts = _normalize_extra_prompts(payload.get("extra_prompts"))
    created_by = _optional_text(payload, "created_by", max_chars=80)
    options = payload.get("options")

    if options is None:
        options = {}

    if not isinstance(options, Mapping):
        raise ValueError("options must be a JSON object")

    return {
        "title": title,
        "created_by": created_by,
        "context": {
            "source_type": "nexora_learning",
            "title": title,
            "learning": normalized_learning,
        },
        "extra_prompts": extra_prompts,
        "tools": [],
        "tool_results": [],
        "options": dict(options),
    }


def normalize_run_stages(value: Any, allowed_stages: tuple) -> List[str]:
    """Validate optional stage execution list for the learning ingestion endpoint."""
    if value is None:
        return []

    if not isinstance(value, list):
        raise ValueError("run_stages must be an array")

    rows: List[str] = []

    for index, item in enumerate(value, start=1):
        stage = str(item or "").strip()

        if not stage:
            raise ValueError(f"run_stages[{index}] is empty")

        if stage not in allowed_stages:
            raise ValueError(f"run_stages[{index}] is not allowed: {stage}")

        rows.append(stage)

    return rows


def _normalize_learning_context(learning: Mapping[str, Any]) -> Dict[str, Any]:
    normalized: Dict[str, Any] = {}
    text_fields = (
        "course_title",
        "chapter_title",
        "audience",
        "user_goal",
        "learning_goal",
        "coarse_reading",
        "intensive_reading",
        "summary",
    )

    for key in text_fields:
        value = _optional_text(learning, key, max_chars=20000)

        if value:
            normalized[key] = value

    list_fields = (
        "key_points",
        "important_points",
        "quiz_focus",
        "misconceptions",
        "terms",
    )

    for key in list_fields:
        rows = _optional_text_list(learning, key, max_items=80, max_chars=800)

        if rows:
            normalized[key] = rows

    chapter_structure = learning.get("chapter_structure")

    if chapter_structure is not None:

        if not isinstance(chapter_structure, (dict, list)):
            raise ValueError("learning.chapter_structure must be an object or array")

        normalized["chapter_structure"] = chapter_structure

    source_notes = learning.get("source_notes")

    if source_notes is not None:
        normalized["source_notes"] = _normalize_source_notes(source_notes)

    user_profile = learning.get("user_profile")

    if user_profile is not None:

        if not isinstance(user_profile, Mapping):
            raise ValueError("learning.user_profile must be a JSON object")

        normalized["user_profile"] = dict(user_profile)

    if not _has_learning_content(normalized):
        raise ValueError("learning must include at least one content field: coarse_reading, intensive_reading, key_points, chapter_structure, source_notes")

    return normalized


def _normalize_extra_prompts(value: Any) -> Dict[str, str]:
    prompts: Dict[str, str] = {
        "all": (
            "基于 NexoraLearning 提供的学习资料生成视频。"
            "优先使用资料中的事实、章节结构、粗读、精读和要点内容，"
            "不要编造资料之外的结论。"
        ),
        "canvas": (
            "生成结构化课堂 PPT 页面，画面简洁，信息层级清晰，"
            "每页只保留最适合讲解的核心视觉。"
        ),
    }

    if value is None:
        return prompts

    if not isinstance(value, Mapping):
        raise ValueError("extra_prompts must be a JSON object")

    for key, raw_text in value.items():
        prompt_key = str(key or "").strip()

        if not prompt_key:
            raise ValueError("extra_prompts contains empty key")

        text = str(raw_text or "").strip()

        if prompt_key in prompts and text:
            prompts[prompt_key] = f"{prompts[prompt_key]}\n{text}"

        elif text:
            prompts[prompt_key] = text

    return prompts


def _normalize_source_notes(value: Any) -> List[Dict[str, str]]:
    if not isinstance(value, list):
        raise ValueError("learning.source_notes must be an array")

    rows: List[Dict[str, str]] = []

    for index, item in enumerate(value, start=1):

        if not isinstance(item, Mapping):
            raise ValueError(f"learning.source_notes[{index}] must be a JSON object")

        title = _optional_text(item, "title", max_chars=200)
        content = _required_text(item, "content", max_chars=20000)
        source = _optional_text(item, "source", max_chars=500)
        rows.append({
            "title": title,
            "content": content,
            "source": source,
        })

    return rows


def _has_learning_content(learning: Mapping[str, Any]) -> bool:
    for key in LEARNING_CONTENT_KEYS:
        value = learning.get(key)

        if isinstance(value, str) and value.strip():
            return True

        if isinstance(value, (list, dict)) and value:
            return True

    return False


def _required_text(data: Mapping[str, Any], key: str, *, max_chars: int) -> str:
    text = _optional_text(data, key, max_chars=max_chars)

    if not text:
        raise ValueError(f"{key} is required")

    return text


def _optional_text(data: Mapping[str, Any], key: str, *, max_chars: int) -> str:
    value = data.get(key)

    if value is None:
        return ""

    text = str(value).strip()

    if len(text) > max_chars:
        raise ValueError(f"{key} is too long: {len(text)} > {max_chars}")

    return text


def _optional_text_list(data: Mapping[str, Any], key: str, *, max_items: int, max_chars: int) -> List[str]:
    value = data.get(key)

    if value is None:
        return []

    if not isinstance(value, list):
        raise ValueError(f"{key} must be an array")

    if len(value) > max_items:
        raise ValueError(f"{key} has too many items: {len(value)} > {max_items}")

    rows: List[str] = []

    for index, item in enumerate(value, start=1):
        text = str(item or "").strip()

        if not text:
            raise ValueError(f"{key}[{index}] is empty")

        if len(text) > max_chars:
            raise ValueError(f"{key}[{index}] is too long: {len(text)} > {max_chars}")

        rows.append(text)

    return rows
