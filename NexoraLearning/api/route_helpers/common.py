"""Common route helper functions."""

import html as html_lib
import re
from pathlib import Path
from typing import Any, Dict, List

ALLOWED_EXT = {".pdf", ".txt", ".md", ".docx", ".doc", ".epub", ".c", ".h", ".py", ".rst"}

_NEXORA_OPTION_FIELDS = (
    "temperature",
    "top_p",
    "max_tokens",
    "max_output_tokens",
    "presence_penalty",
    "frequency_penalty",
    "seed",
    "stop",
    "tools",
    "tool_choice",
    "response_format",
    "stream_options",
    "parallel_tool_calls",
    "metadata",
    "text",
    "reasoning",
    "store",
    "include",
    "truncation",
    "previous_response_id",
    "allow_synthetic_fallback",
    "force_chat_bridge",
)

def _allowed(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXT

def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}

def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)

def parse_book_info_xml_chapters(xml_text: str, full_text_length: int) -> List[Dict[str, Any]]:
    text = str(xml_text or "")
    entries: List[Dict[str, Any]] = []
    for match in re.finditer(
        r"<chapter_name>\s*(.*?)\s*</chapter_name>[\s\S]*?<chapter_range>\s*(.*?)\s*</chapter_range>",
        text,
        flags=re.IGNORECASE,
    ):
        title = str(match.group(1) or "").strip()
        range_text = str(match.group(2) or "").strip()
        if not title or ":" not in range_text:
            continue
        left, right = range_text.split(":", 1)
        try:
            start = max(0, int(str(left).strip()))
            length = max(0, int(str(right).strip()))
        except Exception:
            continue
        end = min(max(0, int(full_text_length or 0)), start + length)
        entries.append({"title": title, "start": start, "end": max(start, end), "range": f"{start}:{length}"})
    entries.sort(key=lambda row: int(row.get("start") or 0))
    return entries

def _extract_nexora_options(data: Dict[str, Any]) -> Dict[str, Any]:
    options: Dict[str, Any] = {}
    for key in _NEXORA_OPTION_FIELDS:
        value = data.get(key)
        if value is not None:
            options[key] = value
    return options

def _escape_card_html(value: Any) -> str:
    text = str(value or "")
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )

def _append_model_option(
    rows: List[Dict[str, str]],
    model_id: Any,
    *,
    label: Any = "",
    provider: Any = "",
    status: Any = "",
) -> None:
    """追加模型选项，并保留前端展示所需的 provider 元数据。"""
    normalized_id = str(model_id or "").strip()

    if not normalized_id:
        return

    normalized_label = str(label or normalized_id).strip() or normalized_id
    row = {
        "id": normalized_id,
        "label": normalized_label,
        "provider": str(provider or "").strip(),
    }
    normalized_status = str(status or "").strip()

    if normalized_status:
        row["status"] = normalized_status

    rows.append(row)

def _extract_model_options(payload: Dict[str, Any]) -> List[Dict[str, str]]:
    """从 Nexora model list 响应中抽取模型选项。"""
    rows: List[Dict[str, str]] = []

    if not isinstance(payload, dict):
        return rows

    data_list = payload.get("data")

    if isinstance(data_list, list):
        for item in data_list:
            if not isinstance(item, dict):
                continue

            model_id = str(item.get("id") or "").strip()
            _append_model_option(
                rows,
                model_id,
                label=item.get("name") or item.get("label") or model_id,
                provider=item.get("provider") or item.get("owned_by") or item.get("provider_key") or item.get("vendor"),
                status=item.get("status") or item.get("state"),
            )

    models_field = payload.get("models")

    if isinstance(models_field, list):
        for item in models_field:
            if isinstance(item, dict):
                model_id = item.get("id") or item.get("model") or item.get("name")
                _append_model_option(
                    rows,
                    model_id,
                    label=item.get("label") or item.get("name") or model_id,
                    provider=item.get("provider") or item.get("owned_by") or item.get("provider_key") or item.get("vendor"),
                    status=item.get("status") or item.get("state"),
                )
            else:
                _append_model_option(rows, item, label=item)

    elif isinstance(models_field, dict):
        for raw_name, item in models_field.items():
            if isinstance(item, dict):
                _append_model_option(
                    rows,
                    raw_name,
                    label=item.get("label") or item.get("name") or raw_name,
                    provider=item.get("provider") or item.get("owned_by") or item.get("provider_key") or item.get("vendor"),
                    status=item.get("status") or item.get("state"),
                )
            else:
                _append_model_option(rows, raw_name, label=raw_name)

    dedup: Dict[str, Dict[str, str]] = {}

    for row in rows:
        model_id = row["id"]
        existing = dedup.get(model_id)

        if not existing:
            dedup[model_id] = row
            continue

        merged = dict(existing)

        if row.get("label") and (not merged.get("label") or merged.get("label") == model_id):
            merged["label"] = row["label"]

        if row.get("provider") and not merged.get("provider"):
            merged["provider"] = row["provider"]

        if row.get("status") and not merged.get("status"):
            merged["status"] = row["status"]

        dedup[model_id] = merged

    return list(dedup.values())
