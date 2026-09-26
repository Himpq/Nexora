"""
NexoraCode.model.ConversationStore — 本地会话存储

对话历史以 JSON 文件保存在本地 data/conversations/：
- index.json: 会话索引（id / title / updated_at）
- {id}.json: 会话详情（消息历史）

对外提供：
- ConversationStore: 会话增删改查与消息追加
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from typing import Any, Optional

from core.config import get_app_root


# 多个本地/远程请求创建不同 Store 实例，共享锁才能避免文件读改写互相覆盖。
_STORE_LOCK = threading.RLock()


def _sanitize_filename(value: str) -> str:
    text = str(value or "").strip()

    text = re.sub(r'[\\/:*?"<>|]', "_", text)
    text = re.sub(r"\s+", "_", text)
    return text[:60]


class ConversationStore:
    def __init__(self):
        self._root = get_app_root() / "data" / "conversations"
        self._root.mkdir(parents=True, exist_ok=True)
        self._lock = _STORE_LOCK

    def _index_path(self):
        return self._root / "index.json"

    def _conversation_path(self, conversation_id: str):
        return self._root / f"{_sanitize_filename(conversation_id)}.json"

    def _load_index(self) -> dict:
        path = self._index_path()

        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _save_index(self, index: dict) -> None:
        self._write_json(self._index_path(), index)

    def list(self) -> list[dict]:
        with self._lock:
            index = self._load_index()
            cleaned = False

            # 会话文件缺失时清理 index，避免显示幽灵会话
            for conversation_id in list(index.keys()):
                if not self._conversation_path(conversation_id).is_file():
                    index.pop(conversation_id, None)
                    cleaned = True

            if cleaned:
                self._save_index(index)

            items = []

            for conversation_id, meta in index.items():
                item = {
                    "conversation_id": conversation_id,
                    "title": str(meta.get("title") or "未命名会话"),
                    "created_at": meta.get("created_at"),
                    "updated_at": meta.get("updated_at"),
                }

                if isinstance(meta.get("metadata"), dict):
                    item["metadata"] = meta["metadata"]

                items.append(item)

            items.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
            return items

    def get(self, conversation_id: str) -> Optional[dict]:
        with self._lock:
            path = self._conversation_path(conversation_id)

            if not path.is_file():
                return None

            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return data if isinstance(data, dict) else None
            except Exception:
                return None

    def create(self, title: str = "", metadata: dict | None = None) -> dict:
        conversation_id = f"conv_{uuid.uuid4().hex[:10]}"
        now = time.time()
        conversation = {
            "conversation_id": conversation_id,
            "title": str(title or "").strip() or "新会话",
            "created_at": now,
            "updated_at": now,
            "messages": [],
            "metadata": metadata if isinstance(metadata, dict) and metadata else {},
        }

        with self._lock:
            self._save_conversation(conversation)
            index = self._load_index()
            index[conversation_id] = {
                "title": conversation["title"],
                "created_at": now,
                "updated_at": now,
                "metadata": dict(conversation["metadata"]),
            }
            self._save_index(index)

        return conversation

    def delete(self, conversation_id: str) -> bool:
        with self._lock:
            path = self._conversation_path(conversation_id)

            if path.is_file():
                try:
                    path.unlink()
                except Exception:
                    pass

            index = self._load_index()

            if conversation_id in index:
                index.pop(conversation_id, None)
                self._save_index(index)
                return True

            return False

    def append_message(self, conversation_id: str, message: dict) -> bool:
        with self._lock:
            conversation = self.get(conversation_id)

            if conversation is None:
                return False

            conversation.setdefault("messages", []).append(message)
            conversation["updated_at"] = time.time()
            self._save_conversation(conversation)

            index = self._load_index()
            meta = index.setdefault(conversation_id, {})

            if not str(meta.get("title") or "").strip() or str(meta.get("title") or "").strip() == "新会话":
                title = self._guess_title(message)

                if title:
                    meta["title"] = title
                    conversation["title"] = title
                    self._save_conversation(conversation)

            meta["updated_at"] = conversation["updated_at"]
            self._save_index(index)
            return True

    def _save_conversation(self, conversation: dict) -> None:
        path = self._conversation_path(str(conversation.get("conversation_id") or ""))
        self._write_json(path, conversation)

    @staticmethod
    def _write_json(path, data: dict) -> None:
        """同目录临时文件原子替换，读取方不会看到写到一半的 JSON。"""
        temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")

        try:
            with open(temporary, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.flush()
                os.fsync(f.fileno())

            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def save_context(self, conversation_id: str, record: dict, expected_prefix: list) -> None:
        """摘要只移动请求边界，保留所有消息；历史被改写时拒绝提交旧摘要。"""
        with self._lock:
            conversation = self.get(conversation_id)

            if conversation is None or conversation.get("messages", [])[:len(expected_prefix)] != expected_prefix:
                raise ValueError("摘要生成期间历史已变化，未保存旧摘要")

            conversation["context_state"] = {
                "summary": record["summary"],
                "history_cut_index": record["history_cut_index"],
            }
            conversation.setdefault("context_compressions", []).append(record)
            self._save_conversation(conversation)

    def record_context_usage(self, conversation_id: str, input_tokens: int, estimated_tokens: int) -> None:
        """实测输入校准下一轮估算，摘要更新后不沿用旧窗口占用。"""
        with self._lock:
            conversation = self.get(conversation_id)

            if conversation is None:
                raise ValueError("本地会话不存在")

            state = conversation.setdefault("context_state", {})
            state["last_input_tokens"] = input_tokens
            state["last_estimated_tokens"] = estimated_tokens
            self._save_conversation(conversation)

    def record_compression_call(self, conversation_id: str, record: dict) -> None:
        """压缩请求用量独立保存，即使摘要最终未提交也不能漏计该调用。"""
        with self._lock:
            conversation = self.get(conversation_id)

            if conversation is None:
                raise ValueError("本地会话不存在")

            conversation.setdefault("context_compression_calls", []).append(record)
            self._save_conversation(conversation)

    def _guess_title(self, message: dict) -> str:
        content = message.get("content") if isinstance(message, dict) else ""

        if isinstance(content, list):
            parts = []

            for part in content:
                if isinstance(part, dict):
                    parts.append(str(part.get("text") or ""))

            content = "".join(parts)

        text = str(content or "").strip()
        return text[:24]
