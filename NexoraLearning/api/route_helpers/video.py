"""Video route helper functions."""

import re
from typing import Dict, List
from urllib import parse as urllib_parse

def _learning_resource_push_source_plan(limit: int) -> Dict[str, int]:
    plan = {
        "article": 3,
        "cached_video": 2,
        "generated_video": 1,
    }

    total = sum(plan.values())
    if limit >= total:
        return plan

    order = ["article", "cached_video", "generated_video", "article", "cached_video", "article"]
    result = {"article": 0, "cached_video": 0, "generated_video": 0}

    for source in order[:limit]:
        result[source] += 1

    return result

def _is_learning_resource_push_url(value: str) -> bool:
    text = str(value or "").strip()
    return (text.startswith("/") and not text.startswith("//")) or text.startswith("http://") or text.startswith("https://")

def _join_learning_resource_push_meta(parts: List[str]) -> str:
    return " · ".join(str(part or "").strip() for part in parts if str(part or "").strip())

def _normalize_video_generator_path(path: str) -> str:
    text = str(path or "").strip()

    if not text.startswith("/"):
        text = f"/{text}"

    return text

def _safe_video_generator_path_part(value: str, field_name: str) -> str:
    text = str(value or "").strip()

    if not text or not re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", text):
        raise ValueError(f"{field_name} is invalid.")

    return text

def _safe_video_generator_relative_path(value: str) -> str:
    text = str(value or "").strip().replace("\\", "/")
    parts = [part for part in text.split("/") if part]

    if not parts or any(part in {".", ".."} for part in parts):
        raise ValueError("relative path is invalid.")

    for part in parts:

        if not re.fullmatch(r"[A-Za-z0-9_.\-一-龥]+", part):
            raise ValueError("relative path contains invalid characters.")

    return "/".join(urllib_parse.quote(part, safe="") for part in parts)

def _fit_video_generator_text(text: str, max_chars: int) -> str:
    value = str(text or "").strip()

    if len(value) <= max_chars:
        return value

    return value[:max_chars]
