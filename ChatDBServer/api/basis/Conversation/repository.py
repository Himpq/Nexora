"""
Nexora.basis.Conversation.repository — JSON 文件、锁、原子写入

职责：
- 按用户隔离 base_path / index_path 解析
- 提供 load / save 原子操作（委托 basis.Database）
- 提供 _conversation_update_session 事务上下文
- 备份与迁移目录管理

不做业务语义判断，业务校验在 service/schema 层。
"""

from __future__ import annotations

import json
import os
import shutil
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Dict, Generator, Optional, Tuple

from basis.Database import get_path_lock, safe_write_json

from .errors import ConversationNotFoundError, ConversationValidationError
from .repair import recover_conversation_bytes


def _server_data_root() -> str:
    candidate = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "data"))
    if os.path.isdir(candidate):
        return candidate
    raise ConversationValidationError(f"数据根目录不存在: {candidate!r}，请检查部署路径")


def conversation_base_path(username: str) -> str:
    name = str(username or "").strip()
    if not name:
        raise ConversationValidationError("username 不能为空")
    return os.path.join(_server_data_root(), "users", name, "conversations")


def conversation_file_path(username: str, conversation_id: str) -> str:
    base = conversation_base_path(username)
    cid = str(conversation_id or "").strip()
    if not cid:
        raise ConversationValidationError("conversation_id 不能为空")
    # 防止路径穿越
    if "/" in cid or "\\" in cid or ".." in cid:
        raise ConversationValidationError(f"conversation_id 非法: {cid!r}")
    return os.path.join(base, f"{cid}.json")


def conversation_index_path(username: str) -> str:
    return os.path.join(conversation_base_path(username), "conversation_index.json")


def conversation_migration_backup_dir(username: str, timestamp: str | None = None) -> str:
    base = os.path.join(_server_data_root(), "users", str(username or "").strip(), "conversation_migrations")
    ts = str(timestamp or datetime.now().strftime("%Y%m%d_%H%M%S"))
    # 保证目录名安全
    safe_ts = "".join(ch if ch.isalnum() or ch in ("_", "-") else "_" for ch in ts)
    return os.path.join(base, safe_ts)


def ensure_conversation_dir(username: str) -> str:
    base = conversation_base_path(username)
    os.makedirs(base, exist_ok=True)
    return base


def load_json_compat(file_path: str, default: Any = None) -> Any:
    """尽量兼容损坏或非 UTF-8 历史文件。"""
    try:
        with open(file_path, "rb") as f:
            raw = f.read()
    except FileNotFoundError:
        return default
    except Exception:
        return default

    if not raw:
        return default

    for encoding in ("utf-8", "utf-8-sig"):
        try:
            return json.loads(raw.decode(encoding))
        except UnicodeDecodeError:
            continue
        except Exception:
            break

    try:
        return json.loads(raw.decode("utf-8", errors="replace"))
    except Exception:
        recovered = recover_conversation_bytes(raw, source_path=file_path)
        if isinstance(recovered, dict):
            return recovered
        return default


def load_conversation_file(username: str, conversation_id: str) -> Dict[str, Any]:
    path = conversation_file_path(username, conversation_id)
    if not os.path.exists(path):
        raise ConversationNotFoundError(f"对话不存在: {conversation_id}", conversation_id=conversation_id)
    data = load_json_compat(path, default=None)
    if not isinstance(data, dict):
        raise ConversationNotFoundError(
            f"无法读取或解析对话文件: {conversation_id}",
            conversation_id=conversation_id,
        )
    return data


def save_conversation_file(username: str, conversation_id: str, payload: Dict[str, Any]) -> None:
    path = conversation_file_path(username, conversation_id)
    # 委托 basis.Database 原子写入（含 .bak 备份）
    safe_write_json(path, payload, indent=2)


@contextmanager
def conversation_update_session(
    username: str, conversation_id: str
) -> Generator[Tuple[str, Dict[str, Any]], None, None]:
    """以文件锁保护的读-改-写会话；yield 后由调用方负责 save。"""
    path = conversation_file_path(username, conversation_id)
    with get_path_lock(path):
        if not os.path.exists(path):
            raise ConversationNotFoundError(f"对话不存在: {conversation_id}", conversation_id=conversation_id)
        data = load_json_compat(path, default=None)
        if not isinstance(data, dict):
            raise ConversationNotFoundError(
                f"无法读取或解析对话文件: {conversation_id}",
                conversation_id=conversation_id,
            )
        yield path, data


def backup_conversation_file(username: str, conversation_id: str, backup_dir: str) -> str:
    src = conversation_file_path(username, conversation_id)
    if not os.path.exists(src):
        raise ConversationNotFoundError(f"对话不存在: {conversation_id}", conversation_id=conversation_id)
    os.makedirs(backup_dir, exist_ok=True)
    dst = os.path.join(backup_dir, f"{conversation_id}.json")
    shutil.copy2(src, dst)
    return dst
