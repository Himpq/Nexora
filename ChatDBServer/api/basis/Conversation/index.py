"""
Nexora.basis.Conversation.index — conversation_index.json 读写与同步

v4 索引升级：
- version 4
- 单条 item 中包含 scope.workspace_id / scope.learning / scope.tags 的投影
- 向下兼容读取 v3 索引（自动重建为 v4）
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Dict, List

from basis.Database import get_path_lock, safe_write_json

from .repository import (
    conversation_base_path,
    conversation_index_path,
    ensure_conversation_dir,
    load_json_compat,
)
from .schema import normalize_scope

INDEX_VERSION = 4


def _compact_preview(text: str, limit: int = 120) -> str:
    value = " ".join(str(text or "").split())
    if len(value) <= limit:
        return value
    return value[:limit].rstrip() + "..."


def _conversation_id_from_path(file_path: str, index_path: str) -> str:
    filename = os.path.basename(str(file_path or "").strip())
    if not filename.endswith(".json"):
        return ""
    if filename == os.path.basename(index_path):
        return ""
    return filename[:-5].strip()


def _extract_learning_fields_for_index(scope: Dict[str, Any]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not isinstance(scope, dict):
        return out
    learning = scope.get("learning") if isinstance(scope.get("learning"), dict) else {}
    course_id = str(learning.get("course_id") or "").strip()
    course_title = str(learning.get("course_title") or "").strip()
    lecture_id = str(learning.get("lecture_id") or "").strip()
    if course_id:
        out["learning_course_id"] = course_id
    elif lecture_id:
        out["learning_course_id"] = lecture_id
    if course_title:
        out["learning_course_title"] = course_title
    return out


def build_index_item(conversation_id: str, conversation_data: Dict[str, Any]) -> Dict[str, Any]:
    messages = conversation_data.get("messages", [])
    if not isinstance(messages, list):
        messages = []

    preview = ""
    for msg in reversed(messages):
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role") or "").strip().lower()
        if role not in {"assistant", "user"}:
            continue
        # v4: summary / content
        exchange_summary = str(msg.get("summary") or msg.get("exchange_summary") or "").strip()
        content = str(msg.get("content") or "").strip()
        # content 可能是 list，转为文本用于预览
        if isinstance(msg.get("content"), list):
            try:
                import json as _json
                content = _json.dumps(msg.get("content"), ensure_ascii=False)[:500]
            except Exception:
                content = str(content)
        raw_text = exchange_summary if exchange_summary else content
        if raw_text:
            preview = _compact_preview(raw_text)
            break

    # scope 归一化
    scope = normalize_scope(conversation_data.get("scope"))
    # 兼容旧字段：若 v4 scope 为空但旧文件仍有散落字段，此处不猜，仅按 scope 为准
    tags = list(scope.get("tags", []))

    item: Dict[str, Any] = {
        "conversation_id": str(conversation_id),
        "title": str(conversation_data.get("title", "未命名对话") or "未命名对话"),
        "created_at": conversation_data.get("created_at"),
        "updated_at": conversation_data.get("updated_at"),
        "pin": bool(conversation_data.get("pin", False)),
        "message_count": len(messages),
        "preview": preview,
        "scope": {
            "workspace_id": str(scope.get("workspace_id") or ""),
            "learning": dict(scope.get("learning") or {}),
            "tags": list(tags),
        },
        "tags": list(tags),
    }

    # 扁平兼容字段（供旧前端读取）
    learning_fields = _extract_learning_fields_for_index(scope)
    item.update(learning_fields)

    # branch
    branch = conversation_data.get("branch", {})
    if isinstance(branch, dict):
        parent_conversation_id = str(branch.get("parent_conversation_id") or "").strip()
        root_conversation_id = str(branch.get("root_conversation_id") or "").strip()
        if parent_conversation_id and root_conversation_id:
            item["branch"] = {
                "root_conversation_id": root_conversation_id,
                "parent_conversation_id": parent_conversation_id,
                "parent_message_index": int(branch.get("parent_message_index") or 0),
                "created_at": str(branch.get("created_at") or "").strip(),
            }

    # v4: conversation_mode 由 scope.learning 派生，不再存储旧 metadata
    if bool(scope.get("learning", {}).get("enabled")):
        item["conversation_mode"] = "learning"
    else:
        item["conversation_mode"] = "chat"

    return item


def load_index(username: str) -> Dict[str, Any] | None:
    index_path = conversation_index_path(username)
    if not os.path.exists(index_path):
        return None
    data = load_json_compat(index_path, default=None)
    if not isinstance(data, dict):
        return None
    conversations = data.get("conversations", {})
    if isinstance(conversations, list):
        normalized: Dict[str, Any] = {}
        for item in conversations:
            if not isinstance(item, dict):
                continue
            cid = str(item.get("conversation_id") or item.get("id") or "").strip()
            if not cid:
                continue
            normalized[cid] = item
        conversations = normalized
    elif not isinstance(conversations, dict):
        conversations = {}
    data["conversations"] = conversations
    return data


def write_index(username: str, index_data: Dict[str, Any]) -> None:
    index_path = conversation_index_path(username)
    ensure_conversation_dir(username)
    safe_write_json(index_path, index_data, indent=2)


def rebuild_index(username: str) -> Dict[str, Any]:
    base_path = conversation_base_path(username)
    ensure_conversation_dir(username)
    index_path = conversation_index_path(username)
    conversations: Dict[str, Any] = {}
    if os.path.exists(base_path):
        for filename in os.listdir(base_path):
            if not filename.endswith(".json"):
                continue
            if filename == os.path.basename(index_path):
                continue
            cid = filename[:-5].strip()
            if not cid:
                continue
            file_path = os.path.join(base_path, filename)
            data = load_json_compat(file_path, default=None)
            if not isinstance(data, dict):
                continue
            conversations[cid] = build_index_item(cid, data)
    index_data: Dict[str, Any] = {
        "version": INDEX_VERSION,
        "updated_at": datetime.now().isoformat(),
        "conversations": conversations,
    }
    write_index(username, index_data)
    return index_data


def ensure_index(username: str) -> Dict[str, Any]:
    data = load_index(username)
    if isinstance(data, dict) and int(data.get("version") or 0) >= INDEX_VERSION:
        return data
    return rebuild_index(username)


def sync_index_from_file(username: str, file_path: str, payload: Dict[str, Any]) -> None:
    index_path = conversation_index_path(username)
    cid = _conversation_id_from_path(file_path, index_path)
    if not cid:
        return
    if not isinstance(payload, dict):
        return
    # 用 index 文件锁保护并发
    with get_path_lock(index_path):
        index_data = load_index(username)
        if not isinstance(index_data, dict):
            index_data = {
                "version": INDEX_VERSION,
                "updated_at": datetime.now().isoformat(),
                "conversations": {},
            }
        conversations = index_data.get("conversations", {})
        if not isinstance(conversations, dict):
            conversations = {}
        conversations[cid] = build_index_item(cid, payload)
        index_data["version"] = INDEX_VERSION
        index_data["updated_at"] = datetime.now().isoformat()
        index_data["conversations"] = conversations
        write_index(username, index_data)


def remove_from_index(username: str, conversation_id: str) -> None:
    cid = str(conversation_id or "").strip()
    if not cid:
        return
    index_path = conversation_index_path(username)
    with get_path_lock(index_path):
        data = load_index(username)
        if not isinstance(data, dict):
            return
        conversations = data.get("conversations", {})
        if not isinstance(conversations, dict):
            conversations = {}
        if cid not in conversations:
            return
        del conversations[cid]
        data["updated_at"] = datetime.now().isoformat()
        data["conversations"] = conversations
        write_index(username, data)


def list_conversations_sorted(username: str) -> List[Dict[str, Any]]:
    data = load_index(username)
    if not isinstance(data, dict):
        data = rebuild_index(username)
    conversation_map = data.get("conversations", {}) if isinstance(data.get("conversations"), dict) else {}
    conversations: List[Dict[str, Any]] = []
    for cid, item in conversation_map.items():
        if not isinstance(item, dict):
            continue
        snapshot = dict(item)
        snapshot["conversation_id"] = str(snapshot.get("conversation_id") or cid)
        conversations.append(snapshot)
    conversations.sort(
        key=lambda x: (
            1 if bool(x.get("pin", False)) else 0,
            str(x.get("updated_at") or ""),
        ),
        reverse=True,
    )
    return conversations
