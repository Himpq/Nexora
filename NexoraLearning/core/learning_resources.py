"""Learning resource storage helpers."""

from __future__ import annotations

import json
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Mapping

_LOCK = threading.Lock()
THINKING_BLOCK_PATTERN = re.compile(r"(?is)<\s*(?:think|thinking)\b[^>]*>.*?<\s*/\s*(?:think|thinking)\s*>")
THINKING_FENCE_PATTERN = re.compile(r"(?is)```\s*(?:think|thinking|reasoning)\b[^\n`]*\n.*?```")
UNFINISHED_THINKING_BLOCK_PATTERN = re.compile(r"(?is)<\s*(?:think|thinking)\b[^>]*>.*\Z")
PLAIN_TEXT_RESOURCE_LANGUAGES = {"text", "txt", "plain", "plaintext", "markdown", "md", "mdown"}


def is_learning_resource_plain_text_language(language: Any) -> bool:
    """判断 fenced block 语言是否只是正文容器，而不是可执行或示例代码。"""
    value = str(language or "").strip().lower()
    return value in PLAIN_TEXT_RESOURCE_LANGUAGES


def strip_model_thinking_blocks(text: Any) -> str:
    """移除模型思考块，避免审稿或正文展示混入非正文内容。"""
    content = str(text or "")

    previous = None
    while previous != content:
        previous = content
        content = THINKING_FENCE_PATTERN.sub("", content)
        content = THINKING_BLOCK_PATTERN.sub("", content)

    content = UNFINISHED_THINKING_BLOCK_PATTERN.sub("", content)
    return content.strip()


def _data_dir(cfg: Mapping[str, Any]) -> Path:
    return Path(str((cfg or {}).get("data_dir") or "data"))


def _resource_tasks_path(cfg: Mapping[str, Any]) -> Path:
    return _data_dir(cfg) / "learning_resource_tasks.jsonl"


def _resources_path(cfg: Mapping[str, Any]) -> Path:
    return _data_dir(cfg) / "learning_resources.jsonl"


def ensure_learning_resource_tasks_file(cfg: Mapping[str, Any]) -> Path:
    path = _resource_tasks_path(cfg)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("", encoding="utf-8")
    return path


def ensure_learning_resources_file(cfg: Mapping[str, Any]) -> Path:
    path = _resources_path(cfg)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("", encoding="utf-8")
    return path


def _normalize_topic(raw: Any, index: int = 0) -> Dict[str, Any]:
    if isinstance(raw, Mapping):
        title = str(raw.get("title") or raw.get("name") or "").strip()
        topic_id = str(raw.get("id") or f"topic_{index + 1}").strip()
        reason = str(raw.get("reason") or raw.get("description") or "").strip()
        source = str(raw.get("source") or "").strip()
    else:
        title = str(raw or "").strip()
        topic_id = f"topic_{index + 1}"
        reason = ""
        source = ""
    payload = {
        "id": topic_id or f"topic_{index + 1}",
        "title": title,
    }
    if reason:
        payload["reason"] = reason
    if source:
        payload["source"] = source
    return payload


def _normalize_resource_task(raw: Mapping[str, Any]) -> Dict[str, Any]:
    payload = dict(raw or {})
    payload["id"] = str(payload.get("id") or f"resource_task_{uuid.uuid4().hex[:12]}").strip()
    payload["task_type"] = str(payload.get("task_type") or "draft").strip()
    payload["status"] = str(payload.get("status") or "pending").strip()
    payload["resource_type"] = str(payload.get("resource_type") or "explainer").strip()
    payload["lecture_id"] = str(payload.get("lecture_id") or "").strip()
    payload["lecture_title"] = str(payload.get("lecture_title") or "").strip()
    payload["title"] = str(payload.get("title") or "").strip()
    payload["created_by"] = str(payload.get("created_by") or "").strip()
    payload["created_at"] = int(payload.get("created_at") or time.time())
    payload["updated_at"] = int(payload.get("updated_at") or payload["created_at"])
    topics = payload.get("topics")
    if isinstance(topics, list):
        normalized_topics: List[Dict[str, Any]] = []
        for idx, item in enumerate(topics):
            topic = _normalize_topic(item, idx)
            if topic.get("title"):
                normalized_topics.append(topic)
        payload["topics"] = normalized_topics
    else:
        payload["topics"] = []
    selected = payload.get("selected_topic_ids")
    if isinstance(selected, list):
        payload["selected_topic_ids"] = [str(item or "").strip() for item in selected if str(item or "").strip()]
    else:
        payload["selected_topic_ids"] = []
    return payload


def _normalize_block(raw: Any, index: int = 0) -> Dict[str, Any]:
    if isinstance(raw, Mapping):
        block_type = str(raw.get("type") or "markdown").strip() or "markdown"
        content = strip_model_thinking_blocks(raw.get("content") or raw.get("text") or "")
        language = str(raw.get("language") or raw.get("lang") or "").strip()
        runnable = bool(raw.get("runnable")) if block_type == "code" else False
    else:
        block_type = "markdown"
        content = strip_model_thinking_blocks(raw)
        language = ""
        runnable = False
    payload = {
        "type": block_type,
        "content": content,
    }
    if language:
        payload["language"] = language
    if runnable:
        payload["runnable"] = True
    return payload


def _normalize_components(raw: Any) -> Dict[str, Any]:
    data = raw if isinstance(raw, Mapping) else {}
    quick_summary = strip_model_thinking_blocks(data.get("quick_summary") or "")
    article_markdown = strip_model_thinking_blocks(data.get("article_markdown") or data.get("content") or "")

    concept_cards: List[Dict[str, str]] = []
    if isinstance(data.get("concept_cards"), list):
        for item in data.get("concept_cards") or []:
            if not isinstance(item, Mapping):
                continue
            title = str(item.get("title") or item.get("name") or "").strip()
            content = str(item.get("content") or item.get("description") or "").strip()
            if title or content:
                concept_cards.append({"title": title or "关键概念", "content": content})

    review_questions: List[Dict[str, str]] = []
    if isinstance(data.get("review_questions"), list):
        for item in data.get("review_questions") or []:
            if isinstance(item, Mapping):
                question = str(item.get("question") or item.get("title") or "").strip()
                answer = str(item.get("answer") or "").strip()
            else:
                question = str(item or "").strip()
                answer = ""
            if question:
                review_questions.append({"question": question, "answer": answer})

    practice_blocks: List[Dict[str, Any]] = []
    if isinstance(data.get("practice_blocks"), list):
        for idx, item in enumerate(data.get("practice_blocks") or []):
            language = item.get("language") if isinstance(item, Mapping) else ""

            if is_learning_resource_plain_text_language(language):
                continue

            block = _normalize_block(
                {
                    "type": "code",
                    "language": language,
                    "content": (item.get("content") or item.get("code")) if isinstance(item, Mapping) else str(item or ""),
                    "runnable": bool(item.get("runnable")) if isinstance(item, Mapping) else False,
                },
                idx,
            )
            if block.get("content"):
                block["type"] = "code"
                practice_blocks.append(block)

    return {
        "quick_summary": quick_summary,
        "concept_cards": concept_cards,
        "review_questions": review_questions,
        "practice_blocks": practice_blocks,
        "article_markdown": article_markdown,
    }


def _normalize_review_scan(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, Mapping):
        return {}
    payload = dict(raw or {})
    payload["status"] = str(payload.get("status") or "").strip()
    payload["label"] = str(payload.get("label") or "").strip()
    payload["summary"] = str(payload.get("summary") or "").strip()
    payload["reviewer"] = str(payload.get("reviewer") or "").strip()
    try:
        payload["checked_at"] = int(payload.get("checked_at") or 0)
    except Exception:
        payload["checked_at"] = 0
    issues = payload.get("issues") if isinstance(payload.get("issues"), list) else []
    payload["issues"] = [item for item in issues if isinstance(item, Mapping)]
    checked = payload.get("checked") if isinstance(payload.get("checked"), list) else []
    payload["checked"] = [str(item or "").strip() for item in checked if str(item or "").strip()]
    if not payload["status"] and not payload["summary"] and not payload["issues"] and not payload["checked"]:
        return {}
    return payload


def _normalize_activity(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    rows: List[Dict[str, Any]] = []
    for item in raw[-40:]:
        if not isinstance(item, Mapping):
            continue
        rows.append(
            {
                "time": int(item.get("time") or time.time()),
                "type": str(item.get("type") or "status").strip() or "status",
                "message": str(item.get("message") or "").strip(),
            }
        )
    return rows


def _normalize_version(raw: Any, index: int = 0) -> Dict[str, Any]:
    data = raw if isinstance(raw, Mapping) else {}
    number = int(data.get("number") or data.get("version") or (index + 1))
    version_id = str(data.get("id") or data.get("version_id") or f"v{number}").strip() or f"v{number}"
    payload: Dict[str, Any] = {
        "id": version_id,
        "version_id": version_id,
        "number": number,
        "status": str(data.get("status") or "draft_ready").strip() or "draft_ready",
        "summary": str(data.get("summary") or data.get("description") or "").strip(),
        "content": strip_model_thinking_blocks(data.get("content") or ""),
        "reason": str(data.get("reason") or "").strip(),
        "created_by": str(data.get("created_by") or "").strip(),
        "source_task_id": str(data.get("source_task_id") or "").strip(),
        "created_at": int(data.get("created_at") or time.time()),
        "updated_at": int(data.get("updated_at") or data.get("created_at") or time.time()),
        "reviewed_by": str(data.get("reviewed_by") or "").strip(),
        "reviewed_at": int(data.get("reviewed_at") or 0),
        "published_at": int(data.get("published_at") or 0),
    }
    raw_blocks = data.get("blocks")
    if isinstance(raw_blocks, list):
        blocks: List[Dict[str, Any]] = []
        for idx, item in enumerate(raw_blocks):
            block = _normalize_block(item, idx)
            if block.get("content"):
                blocks.append(block)
        payload["blocks"] = blocks
    elif payload["content"]:
        payload["blocks"] = [{"type": "markdown", "content": payload["content"]}]
    else:
        payload["blocks"] = []
    payload["components"] = _normalize_components(data.get("components"))
    payload["review_scan"] = _normalize_review_scan(data.get("review_scan"))
    payload["generation_activity"] = _normalize_activity(data.get("generation_activity"))
    return payload


def _normalize_resource(raw: Mapping[str, Any]) -> Dict[str, Any]:
    payload = dict(raw or {})
    now = int(time.time())
    payload["id"] = str(payload.get("id") or f"resource_{uuid.uuid4().hex[:12]}").strip()
    payload["status"] = str(payload.get("status") or "draft").strip()
    payload["visibility"] = str(payload.get("visibility") or "public").strip()
    payload["resource_type"] = str(payload.get("resource_type") or "explainer").strip()
    payload["lecture_id"] = str(payload.get("lecture_id") or "").strip()
    payload["lecture_title"] = str(payload.get("lecture_title") or "").strip()
    payload["title"] = str(payload.get("title") or "未命名学习资源").strip()
    payload["summary"] = str(payload.get("summary") or payload.get("description") or "").strip()
    payload["content"] = strip_model_thinking_blocks(payload.get("content") or "")
    payload["reason"] = str(payload.get("reason") or "").strip()
    payload["source_task_id"] = str(payload.get("source_task_id") or "").strip()
    payload["created_by"] = str(payload.get("created_by") or "").strip()
    payload["created_at"] = int(payload.get("created_at") or now)
    payload["updated_at"] = int(payload.get("updated_at") or payload["created_at"])
    payload["published_at"] = int(payload.get("published_at") or 0)
    raw_versions = payload.get("versions") if isinstance(payload.get("versions"), list) else []
    versions: List[Dict[str, Any]] = []
    for idx, item in enumerate(raw_versions):
        version = _normalize_version(item, idx)
        if version.get("id"):
            versions.append(version)
    if not versions:
        versions.append(
            _normalize_version(
                {
                    "id": "v1",
                    "number": 1,
                    "status": payload["status"],
                    "summary": payload.get("summary"),
                    "content": payload.get("content"),
                    "reason": payload.get("reason"),
                    "blocks": payload.get("blocks"),
                    "components": payload.get("components"),
                    "review_scan": payload.get("review_scan"),
                    "generation_activity": payload.get("generation_activity"),
                    "source_task_id": payload.get("source_task_id"),
                    "created_by": payload.get("created_by"),
                    "created_at": payload.get("created_at"),
                    "updated_at": payload.get("updated_at"),
                    "reviewed_by": payload.get("reviewed_by"),
                    "reviewed_at": payload.get("reviewed_at"),
                    "published_at": payload.get("published_at"),
                },
                0,
            )
        )
    current_version_id = str(payload.get("current_version_id") or "").strip()
    current = next((item for item in versions if str(item.get("id") or "") == current_version_id), None)
    if current is None:
        current = versions[-1]
        current_version_id = str(current.get("id") or "v1")
    # Keep legacy top-level fields and the active version in sync.
    current.update(
        _normalize_version(
            {
                **current,
                "status": payload.get("version_status") or current.get("status") or payload["status"],
                "summary": payload.get("summary"),
                "content": payload.get("content"),
                "reason": payload.get("reason"),
                "blocks": payload.get("blocks"),
                "components": payload.get("components"),
                "review_scan": payload.get("review_scan"),
                "generation_activity": payload.get("generation_activity"),
                "source_task_id": payload.get("source_task_id"),
                "created_by": current.get("created_by") or payload.get("created_by"),
                "created_at": current.get("created_at") or payload.get("created_at"),
                "updated_at": payload.get("updated_at") or current.get("updated_at"),
                "reviewed_by": payload.get("reviewed_by") or current.get("reviewed_by"),
                "reviewed_at": payload.get("reviewed_at") or current.get("reviewed_at"),
                "published_at": payload.get("published_at") or current.get("published_at"),
            },
            max(0, int(current.get("number") or 1) - 1),
        )
    )
    payload["versions"] = versions
    payload["current_version_id"] = current_version_id
    payload["current_version"] = current
    payload["version_count"] = len(versions)
    payload["summary"] = str(current.get("summary") or "").strip()
    payload["content"] = str(current.get("content") or "").strip()
    payload["reason"] = str(current.get("reason") or "").strip()
    payload["blocks"] = list(current.get("blocks") or [])
    payload["components"] = _normalize_components(current.get("components"))
    payload["review_scan"] = _normalize_review_scan(current.get("review_scan"))
    payload["generation_activity"] = _normalize_activity(current.get("generation_activity"))
    return payload


def append_learning_resource(cfg: Mapping[str, Any], record: Mapping[str, Any]) -> Dict[str, Any]:
    path = ensure_learning_resources_file(cfg)
    payload = _normalize_resource(record or {})
    serialized = json.dumps(payload, ensure_ascii=False) + "\n"
    with _LOCK:
        previous = path.read_text(encoding="utf-8") if path.exists() else ""
        path.write_text(serialized + previous, encoding="utf-8")
    return payload


def list_learning_resources(
    cfg: Mapping[str, Any],
    *,
    limit: int = 100,
    include_drafts: bool = False,
    lecture_id: str = "",
) -> List[Dict[str, Any]]:
    path = ensure_learning_resources_file(cfg)
    rows: List[Dict[str, Any]] = []
    target_lecture_id = str(lecture_id or "").strip()
    try:
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            raw_line = str(raw_line or "").strip()
            if not raw_line:
                continue
            try:
                row = json.loads(raw_line)
            except Exception:
                continue
            if not isinstance(row, Mapping):
                continue
            item = _normalize_resource(row)
            if target_lecture_id and str(item.get("lecture_id") or "").strip() != target_lecture_id:
                continue
            if not include_drafts and str(item.get("status") or "").strip() != "published":
                continue
            rows.append(item)
            if len(rows) >= max(1, int(limit or 100)):
                break
    except Exception:
        return []
    return rows


def update_learning_resource(
    cfg: Mapping[str, Any],
    resource_id: str,
    updates: Mapping[str, Any],
) -> Dict[str, Any]:
    path = ensure_learning_resources_file(cfg)
    target_id = str(resource_id or "").strip()
    if not target_id:
        return {}
    updated: Dict[str, Any] = {}
    with _LOCK:
        rows: List[Dict[str, Any]] = []
        found = False
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            raw_line = str(raw_line or "").strip()
            if not raw_line:
                continue
            try:
                row = json.loads(raw_line)
            except Exception:
                continue
            if not isinstance(row, Mapping):
                continue
            item = dict(row)
            if str(item.get("id") or "").strip() == target_id:
                item.update(dict(updates or {}))
                if "status" in dict(updates or {}):
                    item["version_status"] = item.get("status")
                item["updated_at"] = int(time.time())
                item = _normalize_resource(item)
                updated = item
                found = True
            rows.append(item)
        if not found:
            return {}
        path.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
            encoding="utf-8",
        )
    return updated


def delete_learning_resource(cfg: Mapping[str, Any], resource_id: str) -> Dict[str, Any]:
    path = ensure_learning_resources_file(cfg)
    target_id = str(resource_id or "").strip()

    if not target_id:
        return {}

    deleted: Dict[str, Any] = {}

    with _LOCK:
        rows: List[Dict[str, Any]] = []

        for raw_line in path.read_text(encoding="utf-8").splitlines():
            raw_line = str(raw_line or "").strip()

            if not raw_line:
                continue

            try:
                row = json.loads(raw_line)
            except Exception:
                continue

            if not isinstance(row, Mapping):
                continue

            item = _normalize_resource(row)

            if str(item.get("id") or "").strip() == target_id:
                deleted = item
                continue

            rows.append(item)

        if not deleted:
            return {}

        path.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
            encoding="utf-8",
        )

    return deleted


def create_learning_resource_version(
    cfg: Mapping[str, Any],
    resource_id: str,
    version_fields: Mapping[str, Any],
) -> Dict[str, Any]:
    path = ensure_learning_resources_file(cfg)
    target_id = str(resource_id or "").strip()
    if not target_id:
        return {}
    updated: Dict[str, Any] = {}
    with _LOCK:
        rows: List[Dict[str, Any]] = []
        found = False
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            raw_line = str(raw_line or "").strip()
            if not raw_line:
                continue
            try:
                row = json.loads(raw_line)
            except Exception:
                continue
            if not isinstance(row, Mapping):
                continue
            item = _normalize_resource(row)
            if str(item.get("id") or "").strip() == target_id:
                versions = list(item.get("versions") or [])
                next_number = max([int(v.get("number") or 0) for v in versions] or [0]) + 1
                version_id = f"v{next_number}"
                now = int(time.time())
                version = _normalize_version(
                    {
                        "id": version_id,
                        "number": next_number,
                        "created_at": now,
                        "updated_at": now,
                        **dict(version_fields or {}),
                    },
                    next_number - 1,
                )
                versions.append(version)
                item["versions"] = versions
                item["current_version_id"] = version_id
                item["version_status"] = version.get("status") or "queued"
                item["summary"] = version.get("summary") or ""
                item["content"] = version.get("content") or ""
                item["reason"] = version.get("reason") or ""
                item["blocks"] = version.get("blocks") or []
                item["components"] = version.get("components") or {}
                item["review_scan"] = version.get("review_scan") or {}
                item["generation_activity"] = version.get("generation_activity") or []
                item["updated_at"] = now
                item = _normalize_resource(item)
                updated = item
                found = True
            rows.append(item)
        if not found:
            return {}
        path.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
            encoding="utf-8",
        )
    return updated


def switch_learning_resource_version(
    cfg: Mapping[str, Any],
    resource_id: str,
    version_id: str,
) -> Dict[str, Any]:
    path = ensure_learning_resources_file(cfg)
    target_id = str(resource_id or "").strip()
    target_version_id = str(version_id or "").strip()

    if not target_id or not target_version_id:
        return {}

    updated: Dict[str, Any] = {}

    with _LOCK:
        rows: List[Dict[str, Any]] = []
        found = False

        for raw_line in path.read_text(encoding="utf-8").splitlines():
            raw_line = str(raw_line or "").strip()

            if not raw_line:
                continue

            try:
                row = json.loads(raw_line)
            except Exception:
                continue

            if not isinstance(row, Mapping):
                continue

            item = _normalize_resource(row)

            if str(item.get("id") or "").strip() == target_id:
                versions = list(item.get("versions") or [])
                version = next((entry for entry in versions if str(entry.get("id") or entry.get("version_id") or "").strip() == target_version_id), None)

                if version is None:
                    return {}

                item["current_version_id"] = str(version.get("id") or target_version_id).strip()
                item["version_status"] = str(version.get("status") or item.get("status") or "draft_ready").strip()
                item["status"] = item["version_status"]
                item["summary"] = str(version.get("summary") or "").strip()
                item["content"] = strip_model_thinking_blocks(version.get("content") or "")
                item["reason"] = str(version.get("reason") or "").strip()
                item["blocks"] = list(version.get("blocks") or [])
                item["components"] = dict(version.get("components") or {})
                item["review_scan"] = dict(version.get("review_scan") or {})
                item["generation_activity"] = list(version.get("generation_activity") or [])
                item["source_task_id"] = str(version.get("source_task_id") or item.get("source_task_id") or "").strip()
                item["reviewed_by"] = str(version.get("reviewed_by") or "").strip()
                item["reviewed_at"] = int(version.get("reviewed_at") or 0)
                item["published_at"] = int(version.get("published_at") or 0)
                item["updated_at"] = int(time.time())
                item = _normalize_resource(item)
                updated = item
                found = True

            rows.append(item)

        if not found:
            return {}

        path.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
            encoding="utf-8",
        )

    return updated


def append_learning_resource_task(cfg: Mapping[str, Any], record: Mapping[str, Any]) -> Dict[str, Any]:
    path = ensure_learning_resource_tasks_file(cfg)
    payload = _normalize_resource_task(record or {})
    serialized = json.dumps(payload, ensure_ascii=False) + "\n"
    with _LOCK:
        previous = path.read_text(encoding="utf-8") if path.exists() else ""
        path.write_text(serialized + previous, encoding="utf-8")
    return payload


def list_learning_resource_tasks(cfg: Mapping[str, Any], *, limit: int = 100) -> List[Dict[str, Any]]:
    path = ensure_learning_resource_tasks_file(cfg)
    rows: List[Dict[str, Any]] = []
    try:
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            raw_line = str(raw_line or "").strip()
            if not raw_line:
                continue
            try:
                row = json.loads(raw_line)
            except Exception:
                continue
            if isinstance(row, Mapping):
                rows.append(_normalize_resource_task(row))
            if len(rows) >= max(1, int(limit or 100)):
                break
    except Exception:
        return []
    return rows


def update_learning_resource_task(
    cfg: Mapping[str, Any],
    task_id: str,
    updates: Mapping[str, Any],
) -> Dict[str, Any]:
    path = ensure_learning_resource_tasks_file(cfg)
    target_id = str(task_id or "").strip()
    if not target_id:
        return {}
    updated: Dict[str, Any] = {}
    with _LOCK:
        rows: List[Dict[str, Any]] = []
        found = False
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            raw_line = str(raw_line or "").strip()
            if not raw_line:
                continue
            try:
                row = json.loads(raw_line)
            except Exception:
                continue
            if not isinstance(row, Mapping):
                continue
            item = dict(row)
            if str(item.get("id") or "").strip() == target_id:
                item.update(dict(updates or {}))
                item["updated_at"] = int(time.time())
                item = _normalize_resource_task(item)
                updated = item
                found = True
            rows.append(item)
        if not found:
            return {}
        path.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
            encoding="utf-8",
        )
    return updated
