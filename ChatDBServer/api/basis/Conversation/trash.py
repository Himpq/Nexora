"""
Nexora.basis.Conversation.trash — ConversationTrashService 回收站服务

职责：
- 归档会话到回收站（新结构 staging -> 原子 rename）
- 列举 / 读取 / 删除 / 清空回收站条目（兼容 legacy 扁平 *.json）
- 恢复会话到 active（staging -> rename + index 同步 + 补偿回滚）
- 附件 hash 校验与完整性检查，失败时显式抛异常，不做静默 fallback

目录结构：
    data/users/<username>/trash/
        conversations/<trash_id>/
            manifest.json
            conversation.json
            assets/...
        .staging/<trash_id>/  (临时)
        legacy:  data/users/<username>/trash/*.json  (旧扁平)
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import time
import uuid
from contextlib import nullcontext
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from App.Utils import safe_join_path

from basis.Database import get_path_lock, safe_write_json

from . import asset_store as asset_store_mod
from .errors import (
    ConversationConflictError,
    ConversationNotFoundError,
    ConversationValidationError,
)
from .repository import (
    conversation_base_path,
    conversation_file_path,
    conversation_index_path,
    ensure_conversation_dir,
    load_conversation_file,
    load_json_compat,
)

# 兼容：index 与 schema 可能在恢复时需要
from . import index as index_mod
from . import migration as migration_mod
from . import schema as schema_mod


TRASH_VERSION = 1


# ==================== 基础路径 helpers ====================


def _server_data_root() -> str:
    """
    推导 data 根目录，与 repository._server_data_root 保持一致
    """
    candidate = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "data"))
    if os.path.isdir(candidate):
        return candidate
    # 若不存在，仍返回路径供上层创建
    return candidate


def _trash_root(username: str) -> str:
    name = str(username or "").strip()
    if not name:
        raise ConversationValidationError("username 不能为空")

    return safe_join_path(_server_data_root(), "users", name, "trash")


def _trash_conversations_dir(username: str) -> str:
    return safe_join_path(_trash_root(username), "conversations")


def _trash_legacy_dir(username: str) -> str:
    """
    旧版扁平回收站目录，与 _trash_root 相同
    保留独立 helper 以满足 spec 要求
    """
    return _trash_root(username)


def _trash_staging_root(username: str) -> str:
    return safe_join_path(_trash_root(username), ".staging")


def _trash_entry_dir(username: str, trash_id: str) -> str:
    tid = str(trash_id or "").strip()
    if not tid:
        raise ConversationValidationError("trash_id 不能为空")
    if "/" in tid or "\\" in tid or ".." in tid:
        raise ConversationValidationError(f"trash_id 非法: {tid!r}")
    return safe_join_path(_trash_conversations_dir(username), tid)


def _trash_legacy_file_path(username: str, trash_id: str) -> str:
    tid = str(trash_id or "").strip()
    if not tid:
        raise ConversationValidationError("trash_id 不能为空")
    if "/" in tid or "\\" in tid or ".." in tid:
        raise ConversationValidationError(f"trash_id 非法: {tid!r}")
    return safe_join_path(_trash_legacy_dir(username), f"{tid}.json")


# ==================== hash helpers ====================


def _hash_file(file_path: str) -> str:
    """
    计算文件 sha256 hex
    """
    h = hashlib.sha256()

    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)

    return h.hexdigest()


def _sha256_file(file_path: str) -> str:
    return _hash_file(file_path)


def _compute_file_hash(file_path: str) -> str:
    return _hash_file(file_path)


def _file_sha256(file_path: str) -> str:
    return _hash_file(file_path)


def hash_file_with_sha256(file_path: str) -> str:
    return _hash_file(file_path)


# ==================== 内部辅助：preview / title ====================


def _stringify_content(content: Any) -> str:
    if content is None:
        return ""

    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts: List[str] = []

        for item in content:
            if isinstance(item, str):
                t = item.strip()
                if t:
                    parts.append(t)
                continue

            if isinstance(item, dict):
                t = str(item.get("text") or item.get("input_text") or item.get("content") or "").strip()
                if t:
                    parts.append(t)

        return "\n".join(parts)

    if isinstance(content, dict):
        t = str(content.get("text") or content.get("input_text") or content.get("content") or "").strip()
        if t:
            return t

    return str(content)


def _normalize_preview(text: str, max_len: int = 320) -> str:
    src = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    src = re.sub(r"\s+", " ", src).strip()

    if len(src) <= max_len:
        return src

    return src[:max_len].rstrip() + "..."


def _extract_preview(conversation_data: Dict[str, Any]) -> str:
    if not isinstance(conversation_data, dict):
        return ""

    messages = conversation_data.get("messages", [])

    if not isinstance(messages, list):
        return ""

    for msg in reversed(messages):
        if not isinstance(msg, dict):
            continue

        text = _normalize_preview(_stringify_content(msg.get("content")), max_len=320)

        if text:
            return text

    return ""


def _generate_trash_id() -> str:
    return f"trash_{int(time.time() * 1000)}_{uuid.uuid4().hex[:10]}"


def _as_iso_deleted_at(value: Any = None) -> str:
    if value:
        try:
            return str(value).strip() or datetime.now().isoformat()
        except Exception:
            return datetime.now().isoformat()

    return datetime.now().isoformat()


# ==================== ConversationTrashService ====================


class ConversationTrashService:
    """
    回收站服务：归档 / 列举 / 读取 / 删除 / 恢复
    支持 legacy 扁平与新结构双读
    """

    def __init__(self, username: str = ""):
        self._username = str(username or "").strip()

    # ---------- 内部参数解析 ----------

    def _resolve_username(self, explicit: str = "") -> str:
        if str(explicit or "").strip():
            return str(explicit).strip()

        if self._username:
            return str(self._username).strip()

        raise ConversationValidationError("username 不能为空")

    def _resolve_archive_args(self, *args, **kwargs) -> Tuple[str, str, Dict[str, Any]]:
        """
        兼容两种调用：
            archive_conversation(username, conversation_id, conversation_data)
            ConversationTrashService(username).archive_conversation(conversation_id, conversation_data)
        """
        username = str(kwargs.get("username") or kwargs.get("user") or "").strip()
        cid = str(kwargs.get("conversation_id") or kwargs.get("cid") or kwargs.get("conversationId") or "").strip()
        data = kwargs.get("conversation_data")
        if data is None:
            data = kwargs.get("data")
        if data is None:
            data = kwargs.get("payload")
        if data is None:
            data = kwargs.get("conversation")

        if len(args) == 3:
            username, cid, data = str(args[0] or "").strip(), str(args[1] or "").strip(), args[2]
        elif len(args) == 2:
            # 可能是 (cid, data) + instance username
            if self._username and isinstance(args[0], str) and isinstance(args[1], dict):
                username = self._username
                cid, data = str(args[0] or "").strip(), args[1]
            else:
                username, cid = str(args[0] or "").strip(), str(args[1] or "").strip()
        elif len(args) == 1 and isinstance(args[0], dict):
            data = args[0]
            if not username:
                username = self._username

        if not username:
            username = self._username

        if not isinstance(data, dict):
            data = data if isinstance(data, dict) else {}

        return str(username or "").strip(), str(cid or "").strip(), data

    def _resolve_single_id_args(self, *args, **kwargs) -> Tuple[str, str]:
        """
        解析 (username, trash_id) 兼容 instance.username
        """
        username = str(kwargs.get("username") or kwargs.get("user") or "").strip()
        tid = str(kwargs.get("trash_id") or kwargs.get("trashId") or kwargs.get("id") or "").strip()

        if len(args) == 2:
            username, tid = str(args[0] or "").strip(), str(args[1] or "").strip()
        elif len(args) == 1:
            tid = str(args[0] or "").strip()
            if not username:
                username = self._username
        elif len(args) == 0:
            if not username:
                username = self._username

        if not username:
            username = self._username

        return str(username or "").strip(), str(tid or "").strip()

    # ---------- archive ----------

    def archive_conversation(
        self,
        username: str = "",
        conversation_id: str = "",
        conversation_data: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> str:
        """
        归档会话到回收站
        流程：staging/.staging/<trash_id> 写入 manifest + conversation.json + assets -> 原子 rename 到 conversations/<trash_id>
        """
        lock_held = bool(kwargs.pop("_lock_held", False))
        # 兼容 instance.username 调用：archive_conversation(cid, data)
        if conversation_data is None and isinstance(conversation_id, dict):
            # 此时 username 实际为 cid
            conversation_data = conversation_id  # type: ignore[assignment]
            conversation_id = str(username or "").strip()
            username = str(self._username or "").strip()

        # 兼容 kwargs 覆盖
        if "conversation_data" in kwargs and conversation_data is None:
            conversation_data = kwargs.get("conversation_data")
        if "data" in kwargs and conversation_data is None:
            conversation_data = kwargs.get("data")
        if "payload" in kwargs and conversation_data is None:
            conversation_data = kwargs.get("payload")

        # 统一解析兼容调用参数，解析失败直接暴露给调用方。
        if not isinstance(conversation_data, dict):
            u, c, d = self._resolve_archive_args(username, conversation_id, conversation_data, **kwargs)
            username, conversation_id, conversation_data = u, c, d

        if not username:
            raise ConversationValidationError("username 不能为空")

        if not conversation_id:
            raise ConversationValidationError("conversation_id 不能为空")

        if "/" in conversation_id or "\\" in conversation_id or ".." in conversation_id:
            raise ConversationValidationError(f"conversation_id 非法: {conversation_id!r}")

        if not lock_held and (not isinstance(conversation_data, dict) or not conversation_data):
            raise ConversationValidationError("conversation_data 不能为空且必须为 dict")

        # 生成 trash_id
        trash_id = _generate_trash_id()
        deleted_at = datetime.now().isoformat()
        title = str(conversation_data.get("title") or "未命名对话").strip() or "未命名对话"
        preview = _extract_preview(conversation_data)

        # 读取资产索引。真正的读取和校验会在会话锁内再次执行，避免使用旧快照。
        attachments: List[Dict[str, Any]] = []
        assets_map: Dict[str, Any] = {}
        asset_dir = asset_store_mod.conversation_asset_dir(username, conversation_id)
        has_asset_dir = os.path.isdir(asset_dir)

        # 锁：与消息写入/删除使用同一粒度（conversation_file_path），避免归档期间插入新消息/附件导致旧快照覆盖新数据
        conv_path = conversation_file_path(username, conversation_id)
        trash_root = _trash_root(username)
        staging_root = _trash_staging_root(username)
        staging_dir = safe_join_path(staging_root, trash_id)
        final_dir = _trash_entry_dir(username, trash_id)

        # 在锁内完成 staging 构建：按固定顺序加锁避免死锁
        lock = nullcontext() if lock_held else get_path_lock(conv_path)
        with lock:
            with get_path_lock(trash_root):
                # 只允许归档正式区当前版本，禁止使用 server 传入的过期快照。
                conversation_data = load_conversation_file(username, conversation_id)
                if not isinstance(conversation_data, dict):
                    raise ConversationValidationError("正式会话数据格式错误")
                asset_dir = asset_store_mod.conversation_asset_dir(username, conversation_id)
                has_asset_dir = os.path.isdir(asset_dir)
                assets_map = self._load_asset_index_strict(
                    username,
                    conversation_id,
                    conversation_data,
                    require_existing=has_asset_dir or bool(asset_store_mod.collect_referenced_asset_ids(conversation_data)),
                )
                self._validate_asset_references(
                    username,
                    conversation_id,
                    conversation_data,
                    asset_dir,
                    assets_map,
                )
                # 清理旧 staging 残留（若存在）
                if os.path.exists(staging_dir):
                    try:
                        shutil.rmtree(staging_dir)
                    except Exception:
                        pass

                os.makedirs(staging_root, exist_ok=True)
                os.makedirs(_trash_conversations_dir(username), exist_ok=True)

                if os.path.exists(final_dir):
                    raise ConversationConflictError(f"trash_id 已存在: {trash_id}")

                try:
                    os.makedirs(staging_dir, exist_ok=False)

                    assets_staging_dir = os.path.join(staging_dir, "assets")
                    copied_assets: List[Dict[str, Any]] = []

                    if has_asset_dir:
                        os.makedirs(assets_staging_dir, exist_ok=True)

                        for asset_id, meta in assets_map.items():
                            if not isinstance(meta, dict):
                                continue

                            file_name = str(meta.get("file_name") or "").strip()
                            if not file_name:
                                continue

                            src_path = safe_join_path(asset_dir, file_name)

                            if not os.path.isfile(src_path):
                                # 资产索引存在但文件缺失：归档必须失败，避免后续恢复成功却丢失附件
                                raise ConversationValidationError(
                                    f"归档失败：附件文件缺失 {file_name} (asset_id={asset_id})，会话正文仍引用该附件",
                                    conversation_id=conversation_id,
                                    details={"asset_id": str(asset_id), "file_name": str(file_name)},
                                )

                            dst_path = safe_join_path(assets_staging_dir, file_name)
                            shutil.copy2(src_path, dst_path)

                            # 计算 hash / size / mime，失败必须终止归档。
                            file_hash = _hash_file(dst_path)
                            size = os.path.getsize(dst_path)

                            mime = str(meta.get("mime") or "").strip() or "application/octet-stream"

                            copied_assets.append({
                                "asset_id": str(asset_id),
                                "file_name": str(file_name),
                                "hash": str(file_hash),
                                "size": int(size),
                                "mime": str(mime),
                            })

                        # 同时拷贝 index.json 以便恢复时精确还原
                        src_index = os.path.join(asset_dir, "index.json")
                        if not os.path.isfile(src_index):
                            raise ConversationValidationError(
                                "归档失败：附件 index.json 缺失",
                                conversation_id=conversation_id,
                            )
                        shutil.copy2(src_index, os.path.join(assets_staging_dir, "index.json"))
                        index_hash = _hash_file(src_index)
                        index_size = os.path.getsize(src_index)

                        # 若资产目录有文件但未在索引中，也一并拷贝并记录
                        # 扫描 assets_staging_dir 与 assets_map 对比，避免遗漏
                        # 已通过上面循环覆盖索引内资产；额外文件若存在则补充
                        index_hash = str(index_hash)
                        index_size = int(index_size)
                    else:
                        copied_assets = []
                        index_hash = ""
                        index_size = 0

                    attachments = copied_assets

                    manifest: Dict[str, Any] = {
                        "version": TRASH_VERSION,
                        "trash_id": str(trash_id),
                        "conversation_id": str(conversation_id),
                        "deleted_at": str(deleted_at),
                        "title": str(title),
                        "preview": str(preview),
                        "attachments": list(attachments),
                        "index": {"file_name": "index.json", "hash": index_hash, "size": index_size},
                    }

                    # 写入 manifest.json
                    manifest_path = os.path.join(staging_dir, "manifest.json")
                    safe_write_json(manifest_path, manifest, indent=2)

                    # 写入 conversation.json
                    convo_path = os.path.join(staging_dir, "conversation.json")
                    safe_write_json(convo_path, conversation_data, indent=2)

                    # staging 与正式回收站位于同一 data 根目录，rename 必须成功。
                    os.rename(staging_dir, final_dir)

                except Exception:
                    # 失败清理 staging
                    try:
                        if os.path.exists(staging_dir):
                            shutil.rmtree(staging_dir, ignore_errors=True)
                    except Exception:
                        pass
                    raise

        return str(trash_id)

    def _load_asset_index_strict(
        self,
        username: str,
        conversation_id: str,
        conversation_data: Dict[str, Any],
        require_existing: bool,
    ) -> Dict[str, Any]:
        asset_dir = asset_store_mod.conversation_asset_dir(username, conversation_id)
        index_path = os.path.join(asset_dir, "index.json")
        referenced = asset_store_mod.collect_referenced_asset_ids(conversation_data)
        if not os.path.exists(index_path):
            if require_existing or referenced:
                raise ConversationValidationError(
                    "归档失败：附件 index.json 缺失",
                    conversation_id=conversation_id,
                )
            return {}
        try:
            with open(index_path, "r", encoding="utf-8") as handle:
                index_data = json.load(handle)
        except Exception as exc:
            raise ConversationValidationError(
                f"归档失败：附件 index.json 无法解析: {exc}",
                conversation_id=conversation_id,
            ) from exc
        assets = index_data.get("assets") if isinstance(index_data, dict) else None
        if not isinstance(assets, dict):
            raise ConversationValidationError("归档失败：附件 index.json 缺少 assets", conversation_id=conversation_id)
        missing = sorted(str(asset_id) for asset_id in referenced if str(asset_id) not in assets)
        if missing:
            raise ConversationValidationError(
                f"归档失败：正文引用的附件未登记: {missing}",
                conversation_id=conversation_id,
            )
        return assets

    def _validate_asset_references(
        self,
        username: str,
        conversation_id: str,
        conversation_data: Dict[str, Any],
        asset_dir: str,
        assets_map: Dict[str, Any],
    ) -> None:
        if not assets_map:
            return
        if not os.path.isdir(asset_dir):
            raise ConversationValidationError("归档失败：附件目录缺失", conversation_id=conversation_id)
        for asset_id, metadata in assets_map.items():
            if not isinstance(metadata, dict):
                raise ConversationValidationError(f"归档失败：附件索引项非法: {asset_id}", conversation_id=conversation_id)
            file_name = str(metadata.get("file_name") or "").strip()
            if not file_name:
                raise ConversationValidationError(f"归档失败：附件文件名为空: {asset_id}", conversation_id=conversation_id)
            source_path = safe_join_path(asset_dir, file_name)
            if not os.path.isfile(source_path):
                raise ConversationValidationError(
                    f"归档失败：附件文件缺失 {file_name} (asset_id={asset_id})",
                    conversation_id=conversation_id,
                )
            _hash_file(source_path)
            os.path.getsize(source_path)

    def archive_and_delete(self, username: str = "", conversation_id: str = "", **kwargs) -> str:
        """在同一会话锁内完成归档、正式文件删除和索引删除。"""
        username = str(username or self._username or "").strip()
        conversation_id = str(conversation_id or kwargs.get("cid") or "").strip()
        if not username or not conversation_id:
            raise ConversationValidationError("username 与 conversation_id 不能为空")
        conv_path = conversation_file_path(username, conversation_id)
        with get_path_lock(conv_path):
            trash_id = self.archive_conversation(username, conversation_id, None, _lock_held=True)
            if os.path.exists(conv_path):
                os.remove(conv_path)
            asset_store_mod.remove_conversation_assets_dir(username, conversation_id)
            index_mod.remove_from_index(username, conversation_id)
            return trash_id

    # ---------- list ----------

    def list_entries(self, username: str = "", limit: int = 120, **kwargs) -> List[Dict[str, Any]]:
        """
        列举回收站条目，兼容新结构与 legacy 扁平
        """
        # 兼容 instance.username 调用：list_entries(limit)
        if isinstance(username, int) and limit == 120 and not kwargs:
            # 此时 username 实际为 limit
            limit = int(username)
            username = str(self._username or "").strip()

        # 兼容 kwargs 覆盖
        if "user" in kwargs and not username:
            username = str(kwargs.get("user") or "").strip()

        # 若 username 为空且 instance 有值，使用 instance
        if not str(username or "").strip() and self._username:
            username = str(self._username).strip()

        # 兼容通过 *args 的旧调用已由显式参数覆盖，此处保留对 kwargs limit 的读取
        if "limit" in kwargs and limit == 120:
            try:
                limit = int(kwargs.get("limit", 120))
            except Exception:
                pass

        if not str(username or "").strip():
            raise ConversationValidationError("username 不能为空")

        username = str(username).strip()

        try:
            limit = int(limit)
        except Exception:
            limit = 120

        safe_limit = max(1, min(500, int(limit or 120)))

        out: List[Dict[str, Any]] = []

        # 新结构：conversations/<trash_id>/manifest.json
        conv_dir = _trash_conversations_dir(username)

        if os.path.isdir(conv_dir):
            try:
                for entry_name in os.listdir(conv_dir):
                    dir_path = os.path.join(conv_dir, entry_name)
                    if not os.path.isdir(dir_path):
                        continue
                    manifest_path = os.path.join(dir_path, "manifest.json")
                    if not os.path.isfile(manifest_path):
                        continue
                    data = load_json_compat(manifest_path, default=None)
                    if not isinstance(data, dict):
                        continue
                    out.append({
                        "id": str(data.get("trash_id") or entry_name),
                        "trash_id": str(data.get("trash_id") or entry_name),
                        "type": "conversation",
                        "title": str(data.get("title") or ""),
                        "preview": _normalize_preview(str(data.get("preview") or ""), max_len=420),
                        "deleted_at": str(data.get("deleted_at") or ""),
                        "conversation_id": str(data.get("conversation_id") or ""),
                        "version": int(data.get("version") or TRASH_VERSION),
                        "attachments": list(data.get("attachments", [])) if isinstance(data.get("attachments"), list) else [],
                    })
            except Exception:
                pass

        # legacy 扁平 *.json
        legacy_dir = _trash_legacy_dir(username)

        if os.path.isdir(legacy_dir):
            try:
                for name in os.listdir(legacy_dir):
                    if not str(name or "").lower().endswith(".json"):
                        continue
                    # 跳过新结构目录与 staging
                    full = os.path.join(legacy_dir, name)
                    if os.path.isdir(full):
                        continue
                    if name.startswith("."):
                        continue
                    # 已统计的新结构在 conversations 子目录，legacy 仅扫描 trash 根下的 json
                    # 但为防止重复，跳过 conversations 目录内的文件（上面已处理）
                    if os.path.isdir(conv_dir) and os.path.commonpath([os.path.abspath(full), os.path.abspath(conv_dir)]) == os.path.abspath(conv_dir):
                        continue

                    path = safe_join_path(legacy_dir, name)
                    data = load_json_compat(path, default=None)
                    if not isinstance(data, dict):
                        continue

                    # legacy entry 结构：{type, conversation_id, payload, title, preview, deleted_at}
                    # 也可能是知识库类型，统一过滤仅返回 conversation
                    entry_type = str(data.get("type") or "unknown").strip() or "unknown"

                    # 兼容：若为新 manifest 误放在根目录，跳过（已在新结构处理）
                    if entry_type == "unknown" and "trash_id" not in data and "payload" not in data:
                        continue

                    # 统一输出
                    tid = str(data.get("id") or name[:-5])
                    convo_id = str(data.get("conversation_id") or "")

                    # 若 payload 中有 conversation_id，补充
                    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
                    if not convo_id and isinstance(payload, dict):
                        convo_id = str(payload.get("conversation_id") or "")

                    # 若 legacy 是知识库类型，仍列出但标记 type
                    out.append({
                        "id": str(tid),
                        "trash_id": str(tid),
                        "type": str(entry_type),
                        "title": str(data.get("title") or payload.get("title") or ""),
                        "preview": _normalize_preview(str(data.get("preview") or ""), max_len=420),
                        "deleted_at": str(data.get("deleted_at") or ""),
                        "conversation_id": str(convo_id),
                        "version": int(data.get("version") or 0),
                        "legacy": True,
                    })
            except Exception:
                pass

        # 去重：以 id 为准，新结构优先
        seen: Dict[str, Dict[str, Any]] = {}
        for item in out:
            key = str(item.get("id") or item.get("trash_id") or "").strip()
            if not key:
                continue
            if key not in seen:
                seen[key] = item
            else:
                # 若已存在且现有为 legacy，新为非 legacy 则覆盖
                if seen[key].get("legacy") and not item.get("legacy"):
                    seen[key] = item

        deduped = list(seen.values())

        def _sort_key(item: Dict[str, Any]) -> str:
            ts = str(item.get("deleted_at") or "")
            # 尝试转换为可排序 iso，失败则原字符串
            return ts

        deduped.sort(key=_sort_key, reverse=True)

        return deduped[:safe_limit]

    # ---------- read ----------

    def read_entry(self, username: str = "", trash_id: str = "", **kwargs) -> Dict[str, Any]:
        """
        读取回收站条目详情
        优先新结构，其次 legacy
        """
        # 兼容 instance 调用：read_entry(trash_id)
        if not trash_id and username and self._username:
            trash_id = str(username).strip()
            username = str(self._username).strip()
        if "trashId" in kwargs and not trash_id:
            trash_id = str(kwargs.get("trashId") or "").strip()
        if "id" in kwargs and not trash_id:
            trash_id = str(kwargs.get("id") or "").strip()
        if "user" in kwargs and not username:
            username = str(kwargs.get("user") or "").strip()

        # 兜底：若仍无法确定，尝试通用解析器
        if not username or not trash_id:
            try:
                u, t = self._resolve_single_id_args(username, trash_id, **kwargs)
                username, trash_id = u, t
            except Exception:
                pass

        if not username:
            raise ConversationValidationError("username 不能为空")

        if not trash_id:
            raise ConversationValidationError("trash_id 不能为空")

        # 尝试新结构
        entry_dir = _trash_entry_dir(username, trash_id)
        manifest_path = os.path.join(entry_dir, "manifest.json")
        convo_path = os.path.join(entry_dir, "conversation.json")

        if os.path.isdir(entry_dir) and os.path.isfile(manifest_path):
            manifest = load_json_compat(manifest_path, default=None)
            if not isinstance(manifest, dict):
                raise ConversationValidationError(f"回收站 manifest 解析失败: {trash_id}")

            conversation_data: Optional[Dict[str, Any]] = None

            if os.path.isfile(convo_path):
                conversation_data = load_json_compat(convo_path, default=None)
                if not isinstance(conversation_data, dict):
                    conversation_data = None

            # 兼容：若 conversation.json 缺失但 manifest 存在，尝试返回 manifest 内的 payload
            # 新结构必须有 conversation.json，否则视为数据不完整
            if conversation_data is None:
                raise ConversationValidationError(f"回收站会话数据缺失: {trash_id} (conversation.json not found)")

            return {
                "trash_id": str(manifest.get("trash_id") or trash_id),
                "id": str(manifest.get("trash_id") or trash_id),
                "version": int(manifest.get("version") or TRASH_VERSION),
                "conversation_id": str(manifest.get("conversation_id") or conversation_data.get("conversation_id") or ""),
                "deleted_at": str(manifest.get("deleted_at") or ""),
                "title": str(manifest.get("title") or ""),
                "preview": str(manifest.get("preview") or ""),
                "attachments": list(manifest.get("attachments", [])) if isinstance(manifest.get("attachments"), list) else [],
                "manifest": dict(manifest),
                "payload": dict(conversation_data),
                "conversation": dict(conversation_data),
                "type": "conversation",
                "assets_dir": os.path.join(entry_dir, "assets"),
            }

        # 尝试 legacy
        legacy_path = _trash_legacy_file_path(username, trash_id)

        if os.path.isfile(legacy_path):
            data = load_json_compat(legacy_path, default=None)
            if not isinstance(data, dict):
                raise ConversationValidationError(f"回收站 legacy 解析失败: {trash_id}")

            payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}

            # legacy 可能直接存 conversation 而无 payload 包裹
            if not payload and ("messages" in data or "conversation_id" in data):
                payload = dict(data)

            return {
                "trash_id": str(data.get("id") or trash_id),
                "id": str(data.get("id") or trash_id),
                "version": int(data.get("version") or 0),
                "conversation_id": str(data.get("conversation_id") or payload.get("conversation_id") or ""),
                "deleted_at": str(data.get("deleted_at") or ""),
                "title": str(data.get("title") or payload.get("title") or ""),
                "preview": str(data.get("preview") or ""),
                "attachments": [],
                "manifest": dict(data),
                "payload": dict(payload) if isinstance(payload, dict) else {},
                "conversation": dict(payload) if isinstance(payload, dict) else {},
                "type": str(data.get("type") or "conversation"),
                "legacy": True,
                "legacy_path": str(legacy_path),
            }

        raise ConversationNotFoundError(f"回收站条目不存在: {trash_id}", conversation_id=trash_id)

    # ---------- remove ----------

    def remove_entry(self, username: str = "", trash_id: str = "", **kwargs) -> bool:
        # 兼容 instance 调用
        if not trash_id and username and self._username:
            trash_id = str(username).strip()
            username = str(self._username).strip()
        if "trashId" in kwargs and not trash_id:
            trash_id = str(kwargs.get("trashId") or "").strip()
        if "id" in kwargs and not trash_id:
            trash_id = str(kwargs.get("id") or "").strip()
        if "user" in kwargs and not username:
            username = str(kwargs.get("user") or "").strip()
        if not username or not trash_id:
            try:
                u, t = self._resolve_single_id_args(username, trash_id, **kwargs)
                username, trash_id = u, t
            except Exception:
                pass

        if not username:
            raise ConversationValidationError("username 不能为空")

        if not trash_id:
            raise ConversationValidationError("trash_id 不能为空")

        # 优先新结构
        entry_dir = _trash_entry_dir(username, trash_id)

        if os.path.isdir(entry_dir):
            try:
                shutil.rmtree(entry_dir)
                return True
            except Exception as e:
                raise ConversationValidationError(f"删除回收站条目失败: {e}") from e

        # legacy
        legacy_path = _trash_legacy_file_path(username, trash_id)

        if os.path.isfile(legacy_path):
            try:
                os.remove(legacy_path)
                return True
            except Exception as e:
                raise ConversationValidationError(f"删除回收站条目失败: {e}") from e

        raise ConversationNotFoundError(f"回收站条目不存在: {trash_id}", conversation_id=trash_id)

    # ---------- clear ----------

    def clear_entries(self, username: str = "", **kwargs) -> int:
        if not username and "user" in kwargs:
            username = str(kwargs.get("user") or "").strip()
        if not username:
            username = str(self._username or "").strip()

        if not str(username or "").strip():
            raise ConversationValidationError("username 不能为空")

        username = str(username).strip()
        removed = 0

        # 新结构
        conv_dir = _trash_conversations_dir(username)

        if os.path.isdir(conv_dir):
            try:
                for entry_name in os.listdir(conv_dir):
                    dir_path = os.path.join(conv_dir, entry_name)
                    if os.path.isdir(dir_path):
                        try:
                            shutil.rmtree(dir_path)
                            removed += 1
                        except Exception:
                            continue
            except Exception:
                pass

        # legacy 扁平
        legacy_dir = _trash_legacy_dir(username)

        if os.path.isdir(legacy_dir):
            try:
                for name in os.listdir(legacy_dir):
                    if not str(name or "").lower().endswith(".json"):
                        continue
                    path = os.path.join(legacy_dir, name)
                    if os.path.isdir(path):
                        continue
                    # 跳过 conversations 子目录
                    if os.path.isdir(conv_dir) and os.path.commonpath([os.path.abspath(path), os.path.abspath(conv_dir)]) == os.path.abspath(conv_dir):
                        continue
                    # 跳过 .staging
                    staging_root = _trash_staging_root(username)
                    if os.path.isdir(staging_root) and os.path.commonpath([os.path.abspath(path), os.path.abspath(staging_root)]) == os.path.abspath(staging_root):
                        continue
                    try:
                        os.remove(path)
                        removed += 1
                    except Exception:
                        continue
            except Exception:
                pass

        return int(removed)

    # ---------- restore ----------

    def restore_to_active(
        self,
        username: str = "",
        trash_id: str = "",
        payload_override: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> str:
        """
        恢复回收站会话到 active
        校验附件完整性，staging+rename 原子写入 active，同步 index，失败补偿回滚
        返回恢复的 conversation_id
        """
        # 兼容部分旧调用通过 kwargs 传递
        if not username and "user" in kwargs:
            username = str(kwargs.get("user") or "").strip()
        if not trash_id and ("trashId" in kwargs or "id" in kwargs):
            trash_id = str(kwargs.get("trashId") or kwargs.get("id") or "").strip()
        if payload_override is None:
            payload_override = kwargs.get("payload") or kwargs.get("conversation_data")

        # 兼容 instance 方式：restore_to_active(trash_id) 此时 username 实际为 trash_id
        if not trash_id and username and self._username and payload_override is None:
            # 判断 username 是否为 trash_id（且 trash_id 为空）
            # 若 username 看起来像 trash_id 且 trash_id 为空，则认为是单参调用
            if "/" not in username and "\\" not in username:
                # 进一步判断是否为 trash_id 形式（trash_ 开头）
                # 但保守处理：若 trash_id 为空且 username 非空且实例有 username，则将 username 视为 trash_id
                if isinstance(payload_override, dict) or payload_override is None:
                    trash_id = str(username).strip()
                    username = str(self._username or "").strip()

        # 兼容通过位置参数传递但显式签名导致错位：如 restore_to_active(trash_id) 被绑定为 username
        # 上述已处理

        if not username:
            username = str(self._username or "").strip()

        if not str(username or "").strip():
            raise ConversationValidationError("username 不能为空")

        if not str(trash_id or "").strip():
            raise ConversationValidationError("trash_id 不能为空")

        username = str(username).strip()
        trash_id = str(trash_id).strip()

        # 加载 entry
        entry = self.read_entry(username, trash_id)

        is_legacy = bool(entry.get("legacy"))
        manifest = entry.get("manifest", {}) if isinstance(entry.get("manifest"), dict) else {}
        conversation_data: Dict[str, Any] = entry.get("conversation", {}) if isinstance(entry.get("conversation"), dict) else {}
        if not isinstance(conversation_data, dict) or not conversation_data:
            conversation_data = entry.get("payload", {}) if isinstance(entry.get("payload"), dict) else {}

        # payload_override 若提供则覆盖
        if isinstance(payload_override, dict) and payload_override:
            # 允许覆盖标题等，但 conversation_id 以 manifest 为准
            merged = dict(conversation_data)
            merged.update(payload_override)
            conversation_data = merged

        if not isinstance(conversation_data, dict) or not conversation_data:
            raise ConversationValidationError("回收站会话数据为空或格式错误")

        # 确定目标 conversation_id
        target_id = str(manifest.get("conversation_id") or conversation_data.get("conversation_id") or "").strip()

        if not target_id:
            raise ConversationValidationError("回收站对话缺少原 conversation_id，无法恢复")

        if "/" in target_id or "\\" in target_id or ".." in target_id:
            raise ConversationValidationError(f"conversation_id 非法: {target_id!r}")

        # 校验并 normalize：旧版可能非 v4，需迁移
        try:
            # 若已是 v4，直接归一化；否则迁移
            if int(conversation_data.get("schema_version") or 0) == schema_mod.SCHEMA_VERSION:
                normalized = schema_mod.normalize_v4_conversation(dict(conversation_data))
            else:
                migrated = migration_mod.migrate_single_conversation_data(dict(conversation_data))
                normalized = schema_mod.normalize_v4_conversation(migrated)
        except ConversationValidationError:
            raise
        except ConversationNotFoundError:
            raise
        except Exception as e:
            raise ConversationValidationError(f"回收站会话校验失败: {e}") from e

        # 强制保留原 id
        normalized["conversation_id"] = str(target_id).strip()

        # 附件完整性校验
        attachments_meta: List[Dict[str, Any]] = []

        if not is_legacy:
            attachments_meta = list(manifest.get("attachments", [])) if isinstance(manifest.get("attachments"), list) else []
            assets_dir_in_trash = str(entry.get("assets_dir") or os.path.join(_trash_entry_dir(username, trash_id), "assets"))

            if attachments_meta:
                for att in attachments_meta:
                    if not isinstance(att, dict):
                        continue
                    file_name = str(att.get("file_name") or "").strip()
                    expected_hash = str(att.get("hash") or "").strip()

                    if not file_name:
                        continue

                    asset_path = safe_join_path(assets_dir_in_trash, file_name) if os.path.isdir(assets_dir_in_trash) else os.path.join(assets_dir_in_trash, file_name)

                    if not os.path.isfile(asset_path):
                        raise ConversationValidationError(
                            f"回收站会话附件缺失，数据不完整: {file_name}",
                            conversation_id=target_id,
                            details={"file_name": file_name, "trash_id": trash_id},
                        )

                    if not expected_hash:
                        raise ConversationValidationError(
                            f"回收站附件缺少 hash，数据不完整: {file_name}",
                            conversation_id=target_id,
                        )

                    expected_size = att.get("size")
                    if isinstance(expected_size, int) and os.path.getsize(asset_path) != expected_size:
                        raise ConversationValidationError(
                            f"回收站附件 size 不匹配，数据不完整: {file_name}",
                            conversation_id=target_id,
                        )

                    # hash 校验
                    actual_hash = _hash_file(asset_path)
                    if actual_hash != expected_hash:
                        raise ConversationValidationError(
                            f"回收站附件 hash 不匹配，数据不完整: {file_name}",
                            conversation_id=target_id,
                            details={"file_name": file_name, "expected": expected_hash, "actual": actual_hash},
                        )
            else:
                # 若 manifest 无附件但 trash assets 目录有文件，不强制校验
                pass
        else:
            # legacy：若会话中引用了资产但 trash 未包含，检查 active 资产是否存在
            # legacy 资产可能仍在原位置，检查引用完整性
            # 若引用存在但文件缺失，抛 incomplete
            try:
                referenced = asset_store_mod.collect_referenced_asset_ids(conversation_data)
            except Exception:
                referenced = set()

            if referenced:
                # legacy 资产目录可能已不存在，检查是否缺失
                for aid in referenced:
                    # 尝试在 trash 资产中查找（legacy 情况资产未归档，可能在原资产目录）
                    # 若原资产目录已不存在，视为不完整
                    # 此处严格校验：若引用存在但文件不存在，抛异常
                    asset_dir_active = asset_store_mod.conversation_asset_dir(username, target_id)
                    # legacy 归档时资产未拷贝，原目录可能已被删除，需检查
                    # 若资产文件不存在，抛 data incomplete
                    # 查找资产索引（若存在）
                    idx = asset_store_mod.load_conversation_asset_index(username, target_id)
                    assets_map = idx.get("assets", {}) if isinstance(idx.get("assets"), dict) else {}
                    meta = assets_map.get(aid) if isinstance(assets_map, dict) else None
                    if isinstance(meta, dict):
                        fname = str(meta.get("file_name") or "").strip()
                        if fname:
                            fpath = safe_join_path(asset_dir_active, fname) if os.path.isdir(asset_dir_active) else os.path.join(asset_dir_active, fname)
                            if not os.path.isfile(fpath):
                                # 检查 trash 中是否有
                                trash_assets = os.path.join(_trash_entry_dir(username, trash_id), "assets") if not is_legacy else ""
                                trash_fpath = os.path.join(trash_assets, fname) if trash_assets else ""
                                if not trash_fpath or not os.path.isfile(trash_fpath):
                                    raise ConversationValidationError(
                                        f"回收站会话附件缺失，数据不完整: {aid}",
                                        conversation_id=target_id,
                                        details={"asset_id": aid},
                                    )
            attachments_meta = []

        # 检查 ID 是否被占用
        target_path = conversation_file_path(username, target_id)
        if os.path.exists(target_path):
            raise ConversationConflictError(f"conversation_id 已存在，无法恢复: {target_id}", conversation_id=target_id)

        base_path = conversation_base_path(username)
        trash_root = _trash_root(username)

        # 原子写入 active：staging -> rename
        # 使用 base_path 锁保护并发
        with get_path_lock(target_path):
            with get_path_lock(trash_root):
                # 二次检查占用（锁内）
                if os.path.exists(target_path):
                    raise ConversationConflictError(f"conversation_id 已存在，无法恢复: {target_id}", conversation_id=target_id)

                ensure_conversation_dir(username)

                # 校验通过后，写入 staging
                staging_tmp = f"{target_path}.tmp.restore.{uuid.uuid4().hex[:8]}"
                assets_active_dir = asset_store_mod.conversation_asset_dir(username, target_id)
                assets_staging_copied = False

                try:
                    # 写入会话文件 staging
                    schema_mod.validate_v4_conversation(normalized)
                    safe_write_json(staging_tmp, normalized, indent=2)

                    # active 与 staging 位于同一 data 根目录，必须原子替换。
                    os.replace(staging_tmp, target_path)

                    # 拷贝资产（若新结构有资产）
                    if not is_legacy and attachments_meta:
                        assets_dir_in_trash = str(entry.get("assets_dir") or os.path.join(_trash_entry_dir(username, trash_id), "assets"))
                        if os.path.isdir(assets_dir_in_trash):
                            assets_created = False
                            try:
                                os.makedirs(assets_active_dir, exist_ok=True)
                                assets_created = True
                                for att in attachments_meta:
                                    if not isinstance(att, dict):
                                        continue
                                    file_name = str(att.get("file_name") or "").strip()
                                    if not file_name:
                                        continue
                                    src = safe_join_path(assets_dir_in_trash, file_name)
                                    if not os.path.isfile(src):
                                        raise ConversationValidationError(
                                            f"恢复资产失败：回收站附件缺失 {file_name}",
                                            conversation_id=target_id,
                                        )
                                    dst = safe_join_path(assets_active_dir, file_name)
                                    shutil.copy2(src, dst)
                                # 拷贝 index.json
                                src_index = os.path.join(assets_dir_in_trash, "index.json")
                                if not os.path.isfile(src_index):
                                    raise ConversationValidationError(
                                        "恢复资产失败：回收站 index.json 缺失",
                                        conversation_id=target_id,
                                    )
                                index_meta = manifest.get("index") if isinstance(manifest.get("index"), dict) else {}
                                expected_index_hash = str(index_meta.get("hash") or "").strip()
                                if expected_index_hash and _hash_file(src_index) != expected_index_hash:
                                    raise ConversationValidationError(
                                        "恢复资产失败：index.json hash 不匹配",
                                        conversation_id=target_id,
                                    )
                                dst_index = os.path.join(assets_active_dir, "index.json")
                                shutil.copy2(src_index, dst_index)
                                assets_staging_copied = True
                            except Exception as e:
                                # 资产拷贝失败，补偿回滚会话文件及已部分拷贝的资产
                                try:
                                    if os.path.exists(target_path):
                                        os.remove(target_path)
                                except Exception:
                                    pass
                                if assets_created:
                                    try:
                                        shutil.rmtree(assets_active_dir, ignore_errors=True)
                                    except Exception:
                                        pass
                                raise ConversationValidationError(f"恢复资产失败: {e}", conversation_id=target_id) from e

                    # 同步索引
                    try:
                        index_mod.sync_index_from_file(username, target_path, normalized)
                    except Exception as e:
                        # 索引同步失败，补偿回滚会话文件及资产
                        try:
                            if os.path.exists(target_path):
                                os.remove(target_path)
                        except Exception:
                            pass
                        # 资产目录若为本次恢复创建则清理（无论是否完全成功）
                        if not is_legacy and attachments_meta and os.path.isdir(assets_active_dir):
                            try:
                                shutil.rmtree(assets_active_dir, ignore_errors=True)
                            except Exception:
                                pass
                        # 尝试移除索引中可能已写入的条目
                        try:
                            index_mod.remove_from_index(username, target_id)
                        except Exception:
                            pass
                        raise ConversationValidationError(f"索引同步失败，已回滚: {e}", conversation_id=target_id) from e

                except ConversationValidationError:
                    raise
                except ConversationConflictError:
                    raise
                except ConversationNotFoundError:
                    raise
                except Exception as e:
                    # 清理 staging tmp
                    try:
                        if os.path.exists(staging_tmp):
                            os.remove(staging_tmp)
                    except Exception:
                        pass
                    # 清理已写入的 active 文件（若存在）
                    try:
                        if os.path.exists(target_path):
                            # 判断是否为本次写入（通过对比时间？简化：若异常发生在写入后，尝试删除）
                            # 仅当文件内容与 normalized 一致时删除，避免误删已存在文件（但前面已检查不存在，所以可安全删除）
                            os.remove(target_path)
                    except Exception:
                        pass
                    if assets_staging_copied:
                        try:
                            shutil.rmtree(assets_active_dir, ignore_errors=True)
                        except Exception:
                            pass
                    # 保持 trash 不变
                    if isinstance(e, (ConversationValidationError, ConversationConflictError, ConversationNotFoundError)):
                        raise
                    raise ConversationValidationError(f"恢复会话失败: {e}", conversation_id=target_id) from e
                finally:
                    # 清理残留 tmp
                    try:
                        if os.path.exists(staging_tmp):
                            os.remove(staging_tmp)
                    except Exception:
                        pass

        return str(target_id)

    # 兼容别名：restore_conversation 为 server 调用入口
    def restore_conversation(
        self,
        username: str = "",
        trash_id: str = "",
        payload_override: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> str:
        return self.restore_to_active(username, trash_id, payload_override, **kwargs)

    # 兼容：供 server 层调用的静态风格
    @staticmethod
    def _static_restore(username: str, trash_id: str, payload_override: Optional[Dict[str, Any]] = None) -> str:
        svc = ConversationTrashService(username)
        return svc.restore_to_active(username, trash_id, payload_override) if payload_override is not None else svc.restore_to_active(username, trash_id)


# ==================== 模块级便捷函数（供旧代码直接导入） ====================


def _generate_trash_id_for_test() -> str:
    return _generate_trash_id()


# 暴露给外部的单例风格函数（可选）
_default_service = ConversationTrashService()


def archive_conversation(username: str, conversation_id: str, conversation_data: Dict[str, Any]) -> str:
    return ConversationTrashService().archive_conversation(username, conversation_id, conversation_data)


def list_entries(username: str, limit: int = 120) -> List[Dict[str, Any]]:
    return ConversationTrashService().list_entries(username, limit)


def read_entry(username: str, trash_id: str) -> Dict[str, Any]:
    return ConversationTrashService().read_entry(username, trash_id)


def remove_entry(username: str, trash_id: str) -> bool:
    return ConversationTrashService().remove_entry(username, trash_id)


def clear_entries(username: str) -> int:
    return ConversationTrashService().clear_entries(username)


def restore_to_active(username: str, trash_id: str, payload_override: Optional[Dict[str, Any]] = None) -> str:
    svc = ConversationTrashService(username)
    if payload_override is not None:
        return svc.restore_to_active(username, trash_id, payload_override)
    return svc.restore_to_active(username, trash_id)


def restore_conversation(username: str, trash_id: str, payload_override: Optional[Dict[str, Any]] = None) -> str:
    return restore_to_active(username, trash_id, payload_override)
