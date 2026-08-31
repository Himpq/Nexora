"""
对话管理器 - 管理用户的对话记录
"""
import os
import json
import shutil
import threading
from copy import deepcopy
from contextlib import contextmanager
from datetime import datetime

from .repair import recover_conversation_bytes
from App.Utils import sanitize_assistant_visible_content
from longterm.longterm_api import conversation_longterm_root_state, normalize_longterm_state
from basis.Database import get_path_lock, safe_write_json

CONVERSATION_INDEX_VERSION = 3

class ConversationManager:
    """对话记录管理类"""
    
    def __init__(self, username):
        """
        初始化对话管理器
        
        Args:
            username: 用户名
        """
        self.username = username
        self.base_path = f"./data/users/{username}/conversations"
        self.index_path = os.path.join(self.base_path, "conversation_index.json")
        
        # 确保对话目录存在
        os.makedirs(self.base_path, exist_ok=True)
        self._ensure_conversation_index()

    @contextmanager
    def _conversation_update_session(self, conversation_id):
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        with get_path_lock(conversation_path):
            if not os.path.exists(conversation_path):
                raise ValueError(f"对话不存在: {conversation_id}")
            conversation_data = self._load_json_data(conversation_path, default=None)
            if not isinstance(conversation_data, dict):
                raise ValueError(f"无法读取或解析对话文件: {conversation_id}")
            yield conversation_path, conversation_data

    def _load_json_data(self, file_path, default=None):
        """尽量兼容损坏或非 UTF-8 的历史对话文件。"""
        try:
            with open(file_path, 'rb') as f:
                raw = f.read()
        except FileNotFoundError:
            return default
        except Exception:
            return default

        for encoding in ('utf-8', 'utf-8-sig'):
            try:
                return json.loads(raw.decode(encoding))
            except UnicodeDecodeError:
                continue
            except Exception:
                break

        try:
            return json.loads(raw.decode('utf-8', errors='replace'))
        except Exception:
            recovered = recover_conversation_bytes(raw, source_path=file_path)
            if isinstance(recovered, dict):
                return recovered
            return default

    def _load_conversation_data_for_update(self, conversation_id):
        """仅在会话文件可正常解析时返回数据，避免把坏文件回写成空对象。"""
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        if not os.path.exists(conversation_path):
            raise ValueError(f"对话不存在: {conversation_id}")

        conversation_data = self._load_json_data(conversation_path, default=None)
        if not isinstance(conversation_data, dict):
            raise ValueError(f"无法读取或解析对话文件: {conversation_id}")
        return conversation_path, conversation_data

    def _save_json_atomic(self, file_path, payload):
        """原子写入包裹"""
        safe_write_json(file_path, payload, indent=2)

        if os.path.normpath(os.path.abspath(file_path)) == os.path.normpath(os.path.abspath(self.index_path)):
            return

        self._sync_conversation_index_from_file(file_path, payload)

    def _normalize_message_model_fields(self, message):
        """同步历史 assistant 消息的模型字段，保证重答可以读取确定的模型来源。"""
        if not isinstance(message, dict):
            return False

        role = str(message.get("role") or "").strip()
        if role != "assistant":
            return False

        changed = False
        metadata = message.get("metadata", {})
        if not isinstance(metadata, dict):
            metadata = {}
            message["metadata"] = metadata
            changed = True

        top_model = str(message.get("model_name") or "").strip()
        meta_model = str(metadata.get("model_name") or "").strip()
        resolved_model = top_model or meta_model

        if resolved_model:
            if top_model != resolved_model:
                message["model_name"] = resolved_model
                changed = True

            if meta_model != resolved_model:
                metadata["model_name"] = resolved_model
                changed = True

        return changed

    def _assistant_process_steps_have_visible_output(self, metadata):
        if not isinstance(metadata, dict):
            return False

        process_steps = metadata.get("process_steps", [])

        if not isinstance(process_steps, list):
            return False

        return any(
            isinstance(step, dict)
            and str(step.get("type") or "").strip() not in {"", "reasoning_content"}
            for step in process_steps
        )

    def _assistant_variant_has_visible_output(self, content, metadata):
        visible_content = sanitize_assistant_visible_content(content)

        return bool(str(visible_content or "").strip()) or self._assistant_process_steps_have_visible_output(metadata)

    def _sanitize_assistant_versions(self, versions):
        if not isinstance(versions, list):
            return []

        cleaned_versions = []

        for version in versions:
            if not isinstance(version, dict):
                continue

            next_version = dict(version)
            next_metadata = next_version.get("metadata", {})

            if not isinstance(next_metadata, dict):
                next_metadata = {}

            next_version["metadata"] = next_metadata
            next_version["content"] = sanitize_assistant_visible_content(next_version.get("content", ""))

            if self._assistant_variant_has_visible_output(next_version.get("content", ""), next_metadata):
                cleaned_versions.append(next_version)

        return cleaned_versions

    def ensure_conversation_compatibility(self, conversation_id):
        """
        懒迁移历史对话结构。
        只同步已经存在的字段，不猜测缺失模型，避免把错误模型写入历史记录。
        """
        with self._conversation_update_session(conversation_id) as (conversation_path, conversation_data):
            messages = conversation_data.get("messages", [])
            if not isinstance(messages, list):
                raise ValueError(f"对话内容格式无效: {conversation_id}")

            changed = False
            for message in messages:
                if self._normalize_message_model_fields(message):
                    changed = True

            if int(conversation_data.get("schema_version") or 1) < 2:
                conversation_data["schema_version"] = 2
                changed = True

            if changed:
                conversation_data["updated_at"] = datetime.now().isoformat()
                self._save_json_atomic(conversation_path, conversation_data)

            return conversation_data

    def _compact_preview_text(self, text, limit=120):
        value = " ".join(str(text or "").split())
        if len(value) <= limit:
            return value

        return value[:limit].rstrip() + "..."

    def _conversation_id_from_path(self, file_path):
        filename = os.path.basename(str(file_path or "").strip())
        if not filename.endswith(".json"):
            return ""
        if filename == os.path.basename(self.index_path):
            return ""
        return filename[:-5].strip()

    def _load_conversation_index(self):
        if not os.path.exists(self.index_path):
            return None

        index_data = self._load_json_data(self.index_path, default=None)
        if not isinstance(index_data, dict):
            return None

        conversations = index_data.get("conversations", {})
        if isinstance(conversations, list):
            normalized = {}
            for item in conversations:
                if not isinstance(item, dict):
                    continue
                conversation_id = str(item.get("conversation_id") or item.get("id") or "").strip()
                if not conversation_id:
                    continue
                normalized[conversation_id] = item
            conversations = normalized
        elif not isinstance(conversations, dict):
            conversations = {}

        index_data["conversations"] = conversations
        return index_data

    def _build_conversation_index_item(self, conversation_id, conversation_data):
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

            exchange_summary = str(msg.get("exchange_summary") or "").strip()
            content = str(msg.get("content") or "").strip()
            raw_text = exchange_summary if exchange_summary else content
            if raw_text:
                preview = self._compact_preview_text(raw_text)
                break

        longterm = normalize_longterm_state(conversation_data.get("longterm", {}))
        tags = conversation_data.get("tags", [])
        if not isinstance(tags, list):
            tags = []

        metadata = conversation_data.get("metadata", {})
        if not isinstance(metadata, dict):
            metadata = {}

        learning_course_id = self._extract_learning_course_id(metadata)
        learning_course_title = self._extract_learning_course_title(metadata)

        nexoracode_project = metadata.get("nexoracode_project")
        nexoracode_project_payload = {}
        if isinstance(nexoracode_project, dict):
            for key in ("project_id", "name", "path", "subtitle", "tree_scanned_at"):
                value = str(nexoracode_project.get(key) or "").strip()

                if value:
                    nexoracode_project_payload[key] = value

        item = {
            "conversation_id": str(conversation_id),
            "title": str(conversation_data.get("title", "未命名对话") or "未命名对话"),
            "created_at": conversation_data.get("created_at"),
            "updated_at": conversation_data.get("updated_at"),
            "pin": bool(conversation_data.get("pin", False)),
            "message_count": len(messages),
            "conversation_mode": str(conversation_data.get("conversation_mode", "chat") or "chat"),
            "tags": list(tags),
            "longterm_active": bool(longterm.get("active", False)),
            "longterm_task": str(longterm.get("task", "") or ""),
            "longterm_step": str(longterm.get("step", "") or ""),
            "preview": preview,
        }

        if learning_course_id:
            item["learning_course_id"] = learning_course_id

        if learning_course_title:
            item["learning_course_title"] = learning_course_title

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

        if nexoracode_project_payload:
            item["nexoracode_project"] = nexoracode_project_payload

        return item

    @staticmethod
    def _extract_learning_course_id(metadata):
        """从学习会话元数据中提取稳定的课程 ID，供侧栏分组使用。"""
        source = metadata if isinstance(metadata, dict) else {}
        nested_learning = source.get("learning") if isinstance(source.get("learning"), dict) else {}
        candidates = (
            source.get("learning_course_id"),
            source.get("course_id"),
            source.get("lecture_id"),
            nested_learning.get("learning_course_id"),
            nested_learning.get("course_id"),
            nested_learning.get("lecture_id"),
        )

        for candidate in candidates:
            value = str(candidate or "").strip()

            if value:
                return value

        return ""

    @staticmethod
    def _extract_learning_course_title(metadata):
        """从学习会话元数据中提取课程名称，课程 ID 仅用于稳定分组。"""
        source = metadata if isinstance(metadata, dict) else {}
        nested_learning = source.get("learning") if isinstance(source.get("learning"), dict) else {}
        candidates = (
            source.get("learning_course_title"),
            source.get("course_title"),
            source.get("lecture_title"),
            nested_learning.get("learning_course_title"),
            nested_learning.get("course_title"),
            nested_learning.get("lecture_title"),
        )

        for candidate in candidates:
            value = str(candidate or "").strip()

            if value:
                return value

        return ""

    def _write_conversation_index(self, index_data):
        safe_write_json(self.index_path, index_data, indent=2)

    def _rebuild_conversation_index(self):
        conversations = {}

        if os.path.exists(self.base_path):
            for filename in os.listdir(self.base_path):
                if not filename.endswith(".json"):
                    continue
                if filename == os.path.basename(self.index_path):
                    continue

                conversation_id = filename[:-5].strip()
                if not conversation_id:
                    continue

                conversation_path = os.path.join(self.base_path, filename)
                data = self._load_json_data(conversation_path, default=None)
                if not isinstance(data, dict):
                    continue

                conversations[conversation_id] = self._build_conversation_index_item(conversation_id, data)

        index_data = {
            "version": CONVERSATION_INDEX_VERSION,
            "updated_at": datetime.now().isoformat(),
            "conversations": conversations,
        }
        self._write_conversation_index(index_data)
        return index_data

    def _ensure_conversation_index(self):
        index_data = self._load_conversation_index()

        if isinstance(index_data, dict) and int(index_data.get("version") or 0) >= CONVERSATION_INDEX_VERSION:
            return index_data

        return self._rebuild_conversation_index()

    def _sync_conversation_index_from_file(self, file_path, payload):
        conversation_id = self._conversation_id_from_path(file_path)
        if not conversation_id:
            return
        if not isinstance(payload, dict):
            return

        index_data = self._load_conversation_index()
        if not isinstance(index_data, dict):
            index_data = {
                "version": CONVERSATION_INDEX_VERSION,
                "updated_at": datetime.now().isoformat(),
                "conversations": {},
            }

        conversations = index_data.get("conversations", {})
        if not isinstance(conversations, dict):
            conversations = {}

        conversations[conversation_id] = self._build_conversation_index_item(conversation_id, payload)
        index_data["version"] = CONVERSATION_INDEX_VERSION
        index_data["updated_at"] = datetime.now().isoformat()
        index_data["conversations"] = conversations
        self._write_conversation_index(index_data)

    def _collect_reserved_numeric_conversation_ids(self):
        """收集活跃会话和回收站会话占用的数字 ID，防止删除后被新会话复用。"""
        reserved_ids = set()

        if os.path.exists(self.base_path):
            for filename in os.listdir(self.base_path):

                if not filename.endswith('.json') or filename == os.path.basename(self.index_path):
                    continue

                try:
                    reserved_ids.add(int(filename[:-5]))
                except ValueError:
                    continue

        trash_path = os.path.join(os.path.dirname(self.base_path), "trash")

        if not os.path.isdir(trash_path):
            return reserved_ids

        for filename in os.listdir(trash_path):

            if not filename.endswith('.json'):
                continue

            entry = self._load_json_data(os.path.join(trash_path, filename), default=None)

            if not isinstance(entry, dict) or str(entry.get("type") or "").strip() != "conversation":
                continue

            payload = entry.get("payload", {})
            payload = payload if isinstance(payload, dict) else {}
            conversation_id = str(entry.get("conversation_id") or payload.get("conversation_id") or "").strip()

            try:
                reserved_ids.add(int(conversation_id))
            except ValueError:
                continue

        return reserved_ids

    def restore_conversation(self, conversation_data, conversation_id, title=None):
        """使用原 ID 原样恢复回收站会话，使仍保留关系的子分支自动重新归属。"""
        if not isinstance(conversation_data, dict):
            raise ValueError("恢复的对话内容格式无效")

        restored_conversation_id = str(conversation_id or "").strip()

        if not restored_conversation_id:
            raise ValueError("恢复的对话缺少原 conversation_id")

        conversation_path = os.path.join(self.base_path, f"{restored_conversation_id}.json")

        with get_path_lock(self.base_path):

            if os.path.exists(conversation_path):
                raise ValueError(f"原 conversation_id 已被占用: {restored_conversation_id}")

            restored_data = deepcopy(conversation_data)
            restored_data["conversation_id"] = restored_conversation_id
            restored_data["title"] = str(title or restored_data.get("title") or "恢复的对话").strip() or "恢复的对话"
            restored_data["created_at"] = str(restored_data.get("created_at") or datetime.now().isoformat())
            restored_data["updated_at"] = datetime.now().isoformat()

            if not isinstance(restored_data.get("messages"), list):
                restored_data["messages"] = []

            self._save_json_atomic(conversation_path, restored_data)

        return restored_conversation_id
    
    def create_conversation(
        self,
        conversation_id=None,
        title="新对话",
        conversation_mode="chat",
        tags=None,
        metadata=None,
    ):
        """
        创建新对话
        
        Args:
            conversation_id: 对话ID，如果为None则自动生成数字ID
            title: 对话标题
            
        Returns:
            str: 对话ID
        """
        with get_path_lock(self.base_path):
            if conversation_id is None:
                reserved_ids = self._collect_reserved_numeric_conversation_ids()
                conversation_id = str(max(reserved_ids) + 1) if reserved_ids else "1"

            conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
            normalized_mode = str(conversation_mode or "chat").strip() or "chat"
            normalized_tags = []
            if isinstance(tags, list):
                seen = set()
                for item in tags:
                    tag = str(item or "").strip().lower()
                    if not tag or tag in seen:
                        continue
                    seen.add(tag)
                    normalized_tags.append(tag)
            normalized_metadata = metadata if isinstance(metadata, dict) else {}
            conversation_data = {
                "conversation_id": conversation_id,
                "title": title,
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
                "pin": False,
                "messages": [],
                "conversation_mode": normalized_mode,
                "tags": normalized_tags,
                "metadata": normalized_metadata,
                "longterm": conversation_longterm_root_state()
            }
            self._save_json_atomic(conversation_path, conversation_data)
            return conversation_id

    def _build_branch_title(self, source_conversation_id, source_title):
        """根据直接父会话生成稳定、可区分的分支标题。"""
        parent_id = str(source_conversation_id or "").strip()
        base_title = str(source_title or "未命名对话").strip() or "未命名对话"
        index_data = self._ensure_conversation_index()
        conversations = index_data.get("conversations", {}) if isinstance(index_data, dict) else {}
        branch_count = 0

        if isinstance(conversations, dict):

            for item in conversations.values():
                branch = item.get("branch", {}) if isinstance(item, dict) else {}

                if not isinstance(branch, dict):
                    continue

                if str(branch.get("parent_conversation_id") or "").strip() == parent_id:
                    branch_count += 1

        suffix = f" · 分支 {branch_count + 1}"
        title_limit = 120
        safe_base = base_title[:max(1, title_limit - len(suffix))].rstrip()
        return f"{safe_base}{suffix}"

    def _collect_puzzle_ids(self, value, result):
        """递归收集已复制消息中真正出现的 puzzle_id。"""
        if isinstance(value, dict):
            puzzle_id = str(value.get("puzzle_id") or "").strip()

            if puzzle_id:
                result.add(puzzle_id)

            for nested in value.values():
                self._collect_puzzle_ids(nested, result)

        elif isinstance(value, list):

            for nested in value:
                self._collect_puzzle_ids(nested, result)

    def _copy_branch_puzzle_states(self, source_conversation, messages):
        """只复制分支历史中仍可见的 Puzzle 状态，避免带入未来节点。"""
        puzzle_ids = set()
        self._collect_puzzle_ids(messages, puzzle_ids)

        if not puzzle_ids:
            return {}

        source_states = source_conversation.get("puzzle_states", {})

        if not isinstance(source_states, dict):
            return {}

        return {
            puzzle_id: deepcopy(source_states[puzzle_id])
            for puzzle_id in puzzle_ids
            if puzzle_id in source_states
        }

    def fork_conversation(self, source_conversation_id, message_index, title=""):
        """从一个已落库的 assistant 回答节点创建独立会话快照。"""
        source_id = str(source_conversation_id or "").strip()

        if not source_id:
            raise ValueError("source_conversation_id 不能为空")

        try:
            target_index = int(message_index)
        except Exception as error:
            raise ValueError("message_index 必须是整数") from error

        source = self.get_conversation(source_id)
        messages = source.get("messages", [])

        if not isinstance(messages, list):
            raise ValueError(f"对话内容格式无效: {source_id}")

        if target_index < 0 or target_index >= len(messages):
            raise ValueError("分支节点已过期，请刷新会话后重试")

        target_message = messages[target_index] if isinstance(messages[target_index], dict) else {}

        if str(target_message.get("role") or "").strip() != "assistant":
            raise ValueError("当前仅支持从 assistant 回答创建分支")

        copied_messages = deepcopy(messages[:target_index + 1])
        source_branch = source.get("branch", {}) if isinstance(source.get("branch"), dict) else {}
        root_conversation_id = str(source_branch.get("root_conversation_id") or source_id).strip()
        created_at = datetime.now().isoformat()
        branch_title = str(title or "").strip()

        if not branch_title:
            branch_title = self._build_branch_title(source_id, source.get("title"))

        branch_title = branch_title[:120]
        metadata = deepcopy(source.get("metadata", {})) if isinstance(source.get("metadata"), dict) else {}
        tags = deepcopy(source.get("tags", [])) if isinstance(source.get("tags"), list) else []
        conversation_mode = str(source.get("conversation_mode") or "chat").strip() or "chat"
        new_conversation_id = self.create_conversation(
            title=branch_title,
            conversation_mode=conversation_mode,
            tags=tags,
            metadata=metadata,
        )

        try:
            with self._conversation_update_session(new_conversation_id) as (conversation_path, conversation_data):
                conversation_data["messages"] = copied_messages
                conversation_data["branch"] = {
                    "root_conversation_id": root_conversation_id,
                    "parent_conversation_id": source_id,
                    "parent_message_index": target_index,
                    "created_at": created_at,
                }
                conversation_data["schema_version"] = int(source.get("schema_version") or 2)
                puzzle_states = self._copy_branch_puzzle_states(source, copied_messages)

                if puzzle_states:
                    conversation_data["puzzle_states"] = puzzle_states

                conversation_data["updated_at"] = created_at
                self._invalidate_resume_cache_fields(conversation_data)
                self._save_json_atomic(conversation_path, conversation_data)
        except Exception:
            self.delete_conversation(new_conversation_id)
            raise

        return {
            "conversation_id": str(new_conversation_id),
            "title": branch_title,
            "branch": {
                "root_conversation_id": root_conversation_id,
                "parent_conversation_id": source_id,
                "parent_message_index": target_index,
                "created_at": created_at,
            },
        }
    
    def update_title(self, conversation_id, title):
        """
        更新对话标题
        
        Args:
            conversation_id: 对话ID
            title: 新标题
        """
        conversation_path, conversation_data = self._load_conversation_data_for_update(conversation_id)
        
        conversation_data["title"] = title
        conversation_data["updated_at"] = datetime.now().isoformat()
        
        self._save_json_atomic(conversation_path, conversation_data)
    
    def update_conversation_title(self, conversation_id, title):
        """
        更新对话标题
        
        Args:
            conversation_id: 对话ID
            title: 新标题
        """
        conversation_path, conversation_data = self._load_conversation_data_for_update(conversation_id)
        
        # 更新标题
        conversation_data["title"] = title
        conversation_data["updated_at"] = datetime.now().isoformat()
        
        # 保存对话
        self._save_json_atomic(conversation_path, conversation_data)

    def update_volc_response_id(self, conversation_id, response_id, model_name=None):
        """
        更新VolcEngine的Response ID，用于上下文续接
        """
        try:
            with self._conversation_update_session(conversation_id) as (conversation_path, conversation_data):
                conversation_data["last_volc_response_id"] = response_id
                if model_name:
                    conversation_data["last_model_used"] = model_name
                self._save_json_atomic(conversation_path, conversation_data)
        except ValueError:
            return

    def update_conversation_fields(self, conversation_id, fields):
        """
        批量更新会话根字段，遇到字典值时做浅合并。
        """
        if not isinstance(fields, dict):
            raise ValueError("fields 必须是字典")

        with self._conversation_update_session(conversation_id) as (conversation_path, conversation_data):
            for key, value in fields.items():
                if isinstance(value, dict) and isinstance(conversation_data.get(key), dict):
                    merged = dict(conversation_data.get(key) or {})
                    merged.update(value)
                    conversation_data[key] = merged
                else:
                    conversation_data[key] = value

            conversation_data["updated_at"] = datetime.now().isoformat()
            self._save_json_atomic(conversation_path, conversation_data)

    def update_last_response_id(self, conversation_id, response_id, model_name=None):
        """
        更新可续接的 last response id（通用命名，兼容历史 volc 命名字段）
        """
        self.update_volc_response_id(conversation_id, response_id, model_name=model_name)

    def _invalidate_resume_cache_fields(self, conversation_data):
        """
        会话分支被本地改写（删消息/切版本）后，必须清理远端续接ID，
        否则下次请求会沿用旧 remote context，导致与当前可见历史不一致。
        """
        if not isinstance(conversation_data, dict):
            return
        for key in ("last_volc_response_id", "last_model_used"):
            if key in conversation_data:
                try:
                    del conversation_data[key]
                except Exception:
                    conversation_data[key] = None
            
    def get_last_volc_response_id(self, conversation_id, current_model_name=None):
        """
        获取VolcEngine的Last Response ID
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        if not os.path.exists(conversation_path):
            return None

        data = self._load_json_data(conversation_path, default={}) or {}
        last_id = data.get("last_volc_response_id")
        last_model = data.get("last_model_used")

        def _norm_model_name(v):
            return str(v or "").strip().lower()

        current_model_norm = _norm_model_name(current_model_name)
        last_model_norm = _norm_model_name(last_model)

        # Check for model compatibility
        # logic: if current model is known, and (last_model is different OR missing), reset it.
        # (Assuming missing last_model implies it was the default/old model,
        # so if we are using a specific new model, it's a mismatch).
        if current_model_norm and last_model_norm and last_model_norm != current_model_norm:
            print(f"[CACHE] Model mismatch. Last: {last_model}, Current: {current_model_name}. Resetting context ID.")
            return None

        return last_id

    def get_last_response_id(self, conversation_id, current_model_name=None):
        """
        获取可续接的 last response id（通用命名，兼容历史 volc 命名字段）
        """
        return self.get_last_volc_response_id(conversation_id, current_model_name=current_model_name)

    def add_message(self, conversation_id, role, content, metadata=None, index=None):
        """
        添加消息到对话
        
        Args:
            conversation_id: 对话ID
            role: 角色 (user/assistant/function)
            content: 消息内容
            metadata: 额外元数据（如函数调用信息、交流总结等）
            index: 如果提供且有效，则覆盖该索引处的消息（用于重新生成覆盖旧回答）
        """
        saved_index = None
        normalized_role = str(role or "").strip()

        if normalized_role == "assistant":
            content = sanitize_assistant_visible_content(content)

        # 用户消息时间：不污染 content，存入 metadata，经 Context 在 user 头单次注入（缓存友好）
        if normalized_role == "user" and index is None:
            raw_content = str(content or "")
            # 兼容旧数据：若 content 已带 [TIME] 前缀，剥离后存回 metadata
            stripped_for_storage = raw_content
            if raw_content.lstrip().startswith("[TIME]") or raw_content.lstrip().startswith("[历史消息时间:"):
                # 剥离时间前缀，仅保留纯文本
                stripped = raw_content.lstrip()
                # 剥离首行时间标记
                first_nl = stripped.find("\n")
                if first_nl >= 0:
                    stripped_for_storage = stripped[first_nl + 1:].lstrip()
                else:
                    stripped_for_storage = ""
                content = stripped_for_storage
            else:
                content = raw_content

            # metadata 注入 wall time（用于 Context 前缀）
            time_marker = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            if metadata is None:
                metadata = {}
            elif not isinstance(metadata, dict):
                metadata = dict(metadata) if isinstance(metadata, dict) else {}

            # 仅当调用方未显式提供时写入
            if "time_marker" not in metadata and "time" not in metadata:
                metadata["time_marker"] = time_marker

        with self._conversation_update_session(conversation_id) as (conversation_path, conversation_data):
            messages = conversation_data.get("messages", [])
            if not isinstance(messages, list):
                raise ValueError(f"对话内容格式无效: {conversation_id}")

            message = {
                "role": role,
                "content": content,
                "timestamp": datetime.now().isoformat()
            }

            if index is not None:
                try:
                    index = int(index)
                except Exception:
                    raise ValueError(f"消息索引无效: index={index}")

                if index < 0 or index >= len(messages):
                    raise ValueError(
                        f"消息索引越界: index={index}, message_count={len(messages)}"
                    )

                old_msg = messages[index]
                old_role = str((old_msg if isinstance(old_msg, dict) else {}).get("role") or "").strip()
                new_role = str(role or "").strip()
                fallback_to_append = False
                if old_role != new_role:
                    # 兼容增量 system/knowledge 插入以及并发导致的索引漂移：附近找最近同角色
                    # 原逻辑仅处理 system->assistant，频繁出现 user->assistant 的漂移（如本轮 index=3 指向 user）
                    found_idx = None
                    for off in range(1, 6):
                        for cand_idx in (index + off, index - off):
                            if 0 <= cand_idx < len(messages):
                                cand = messages[cand_idx] if isinstance(messages[cand_idx], dict) else {}
                                if str(cand.get("role") or "").strip() == new_role:
                                    found_idx = cand_idx
                                    break
                        if found_idx is not None:
                            break
                    if found_idx is not None:
                        # 若找到的同角色距离过远且原位置在尾部附近（并发后旧索引指向刚插入的 user），
                        # 直接追加更安全，避免污染更早的 assistant（如 421 号会话的富士山内容覆盖到上一条回答）
                        if new_role == "assistant" and old_role == "user" and found_idx < index and index >= len(messages) - 3:
                            # 尾部 user->assistant 且最近 assistant 在更早位置，视为并发漂移，追加而非覆盖
                            print(f"[ADD_MESSAGE] index drift fallback append index={index} ({old_role}->{new_role}) len={len(messages)} found={found_idx}")
                            fallback_to_append = True
                            index = None
                        else:
                            print(f"[ADD_MESSAGE] index drift fix {index}->{found_idx} ({old_role}->{new_role})")
                            index = found_idx
                            old_msg = messages[index]
                            old_role = str((old_msg if isinstance(old_msg, dict) else {}).get("role") or "").strip()
                    else:
                        # 无最近同角色：尾部 user 被 assistant 覆盖时直接追加，避免抛错导致 terminal_error 合并到错误位置
                        if new_role == "assistant" and old_role in ("user", "system") and index >= len(messages) - 3:
                            print(f"[ADD_MESSAGE] index drift fallback append index={index} ({old_role}->{new_role}) len={len(messages)} no_candidate")
                            fallback_to_append = True
                            index = None
                        else:
                            raise ValueError(
                                f"消息索引角色不匹配: index={index}, expected={new_role}, actual={old_role}"
                            )

                if index is not None and not fallback_to_append:
                    old_metadata = old_msg.get("metadata", {}) if isinstance(old_msg.get("metadata", {}), dict) else {}
                    old_versions = self._sanitize_assistant_versions(old_metadata.get("versions", []))

                    if "metadata" not in message:
                        message["metadata"] = {}
                    message["metadata"]["versions"] = list(old_versions)

                    if role == "assistant" and str(old_msg.get("role", "")).strip() == "assistant":
                        prev_content = sanitize_assistant_visible_content(old_msg.get("content", ""))
                        prev_ts = old_msg.get("timestamp", "")
                        prev_meta_without_versions = {
                            k: v for k, v in old_metadata.items() if k != "versions"
                        }
                        prev_variant = {
                            "content": prev_content,
                            "timestamp": prev_ts,
                            "metadata": prev_meta_without_versions
                        }
                        if "exchange_summary" in old_msg:
                            prev_variant["exchange_summary"] = old_msg["exchange_summary"]

                        has_meaningful_content = bool(str(prev_content or "").strip())
                        has_meaningful_steps = self._assistant_process_steps_have_visible_output(prev_meta_without_versions)
                        if has_meaningful_content or has_meaningful_steps:
                            existed = False
                            for v in message["metadata"]["versions"]:
                                if not isinstance(v, dict):
                                    continue
                                if (
                                    str(v.get("timestamp", "")) == str(prev_variant.get("timestamp", ""))
                                    and str(v.get("content", "")) == str(prev_variant.get("content", ""))
                                ):
                                    existed = True
                                    break
                            if not existed:
                                message["metadata"]["versions"].append(prev_variant)
                elif fallback_to_append:
                    # 追加路径：确保 metadata 初始化，不继承旧版本
                    if "metadata" not in message:
                        message["metadata"] = {}

            if metadata:
                if "metadata" not in message:
                    message["metadata"] = {}
                message["metadata"].update(metadata)

            if role == "assistant" and metadata and "exchange_summary" in metadata:
                message["exchange_summary"] = metadata["exchange_summary"]
            if role == "assistant":
                model_name = ""
                if isinstance(message.get("metadata"), dict):
                    model_name = str(message["metadata"].get("model_name", "") or "").strip()
                if model_name:
                    message["model_name"] = model_name
                elif "model_name" in message:
                    del message["model_name"]

            if index is not None:
                messages[index] = message
                saved_index = index
                self._invalidate_resume_cache_fields(conversation_data)
            else:
                messages.append(message)
                saved_index = len(messages) - 1

            conversation_data["messages"] = messages
            conversation_data["updated_at"] = datetime.now().isoformat()
            self._save_json_atomic(conversation_path, conversation_data)

        return saved_index

    def update_message_metadata(self, conversation_id, message_index, metadata_patch):
        """原子合并单条消息元数据，不改写消息内容或版本。"""
        try:
            index = int(message_index)
        except Exception as error:
            raise ValueError(f"消息索引无效: index={message_index}") from error

        patch = metadata_patch if isinstance(metadata_patch, dict) else {}

        if not patch:
            raise ValueError("消息元数据补丁不能为空")

        with self._conversation_update_session(conversation_id) as (conversation_path, conversation_data):
            messages = conversation_data.get("messages", [])

            if not isinstance(messages, list):
                raise ValueError(f"对话内容格式无效: {conversation_id}")

            if index < 0 or index >= len(messages):
                raise ValueError(
                    f"消息索引越界: index={index}, message_count={len(messages)}"
                )

            message = messages[index]

            if not isinstance(message, dict):
                raise ValueError(f"消息格式无效: index={index}")

            metadata = message.get("metadata", {})

            if not isinstance(metadata, dict):
                metadata = {}

            next_metadata = dict(metadata)
            next_metadata.update(patch)
            message["metadata"] = next_metadata
            messages[index] = message
            conversation_data["messages"] = messages
            conversation_data["updated_at"] = datetime.now().isoformat()
            self._save_json_atomic(conversation_path, conversation_data)

        return next_metadata

    def validate_regenerate_target(self, conversation_id, message_index):
        """
        校验重答目标，确保覆盖点一定是 assistant，且前一条是触发它的 user。
        """
        try:
            idx = int(message_index)
        except Exception:
            return False, "消息索引无效", {}

        try:
            conversation = self.get_conversation(conversation_id)
        except Exception as e:
            return False, str(e), {}

        messages = conversation.get("messages", [])
        if not isinstance(messages, list):
            return False, "对话内容格式无效", {
                "message_count": 0
            }

        if idx < 0 or idx >= len(messages):
            return False, "消息索引已过期，请刷新后重试", {
                "message_count": len(messages)
            }

        # 兼容增量 system/knowledge 插入：目标附近找最近 assistant，user 前跳过 system
        actual_idx = idx
        target = messages[idx] if isinstance(messages[idx], dict) else {}
        target_role = str(target.get("role") or "").strip()

        if target_role != "assistant":
            # 前后 5 格找最近 assistant
            found = None
            for off in range(1, 6):
                for cand_idx in (idx - off, idx + off):
                    if 0 <= cand_idx < len(messages):
                        cand = messages[cand_idx] if isinstance(messages[cand_idx], dict) else {}
                        if str(cand.get("role") or "").strip() == "assistant":
                            found = cand_idx
                            break
                if found is not None:
                    break
            if found is not None:
                actual_idx = found
                target = messages[found] if isinstance(messages[found], dict) else {}
                target_role = str(target.get("role") or "").strip()
            else:
                return False, "重答目标必须是 assistant 消息", {
                    "message_count": len(messages),
                    "target_role": target_role,
                    "target_index": idx
                }

        # 找 user，跳过中间的 system
        user_index = actual_idx - 1
        while user_index >= 0:
            cand = messages[user_index] if isinstance(messages[user_index], dict) else {}
            if str(cand.get("role") or "").strip() == "user":
                break
            if str(cand.get("role") or "").strip() == "system":
                user_index -= 1
                continue
            break

        if user_index < 0:
            return False, "重答目标前缺少 user 消息", {
                "message_count": len(messages),
                "target_index": actual_idx
            }

        source = messages[user_index] if isinstance(messages[user_index], dict) else {}
        source_role = str(source.get("role") or "").strip()
        if source_role != "user":
            return False, "重答目标前一条不是 user 消息", {
                "message_count": len(messages),
                "target_index": actual_idx,
                "source_role": source_role
            }

        return True, "ok", {
            "message_count": len(messages),
            "target_index": actual_idx,
            "user_index": user_index,
            "user_content": str(source.get("content") or ""),
            "assistant_model_name": str(
                target.get("model_name")
                or (target.get("metadata", {}) if isinstance(target.get("metadata", {}), dict) else {}).get("model_name")
                or ""
            ).strip()
        }

    def delete_message(self, conversation_id, message_index):
        """
        删除指定索引所属的“单轮消息”
        - 点击 user：删除该 user 以及其后紧邻的 assistant（若存在）
        - 点击 assistant：删除该 assistant 以及其前紧邻的 user（若存在）
        """
        try:
            conversation_path, conversation_data = self._load_conversation_data_for_update(conversation_id)
        except ValueError:
            return False

        messages = conversation_data.get("messages", [])
        if not isinstance(messages, list):
            return False
        if 0 <= message_index < len(messages):
            start = message_index
            end = message_index
            role = str(messages[message_index].get('role') or '').strip()

            if role == 'user':
                # user + next assistant
                if message_index + 1 < len(messages):
                    next_role = str(messages[message_index + 1].get('role') or '').strip()
                    if next_role == 'assistant':
                        end = message_index + 1
            elif role == 'assistant':
                # prev user + assistant
                if message_index - 1 >= 0:
                    prev_role = str(messages[message_index - 1].get('role') or '').strip()
                    if prev_role == 'user':
                        start = message_index - 1

            del messages[start:end + 1]
            conversation_data["messages"] = messages
            self._invalidate_resume_cache_fields(conversation_data)
            
            conversation_data["updated_at"] = datetime.now().isoformat()
            
            self._save_json_atomic(conversation_path, conversation_data)
            return True
        return False

    def save_message_version(self, conversation_id, message_index):
        """
        为指定消息保存一个历史版本（用于重新回答切换）
        将当前内容移入元数据的 versions 列表中
        """
        try:
            conversation_path, conversation_data = self._load_conversation_data_for_update(conversation_id)
        except ValueError:
            return False

        messages = conversation_data.get("messages", [])
        if not isinstance(messages, list):
            return False
        if 0 <= message_index < len(messages):
            msg = messages[message_index]
            if msg.get('role') != 'assistant':
                return False
                
            # 初始化 metadata 和 versions
            if "metadata" not in msg:
                msg["metadata"] = {}
            if "versions" not in msg["metadata"]:
                msg["metadata"]["versions"] = []
            msg["metadata"]["versions"] = self._sanitize_assistant_versions(msg["metadata"]["versions"])
                
            # 保存当前内容到版本列表 (不含 versions 自身以防无限嵌套)
            version_data = {
                "content": sanitize_assistant_visible_content(msg.get("content", "")),
                "timestamp": msg.get("timestamp", ""),
                "metadata": {k: v for k, v in msg.get("metadata", {}).items() if k != "versions"}
            }
            if "exchange_summary" in msg:
                version_data["exchange_summary"] = msg["exchange_summary"]

            has_meaningful_content = bool(str(version_data.get("content", "")).strip())
            has_meaningful_steps = self._assistant_process_steps_have_visible_output(version_data.get("metadata", {}))
            if has_meaningful_content or has_meaningful_steps:
                existed = False
                for v in msg["metadata"]["versions"]:
                    if not isinstance(v, dict):
                        continue
                    if (
                        str(v.get("timestamp", "")) == str(version_data.get("timestamp", ""))
                        and str(v.get("content", "")) == str(version_data.get("content", ""))
                    ):
                        existed = True
                        break
                if not existed:
                    msg["metadata"]["versions"].append(version_data)
            
            conversation_data["updated_at"] = datetime.now().isoformat()
            self._save_json_atomic(conversation_path, conversation_data)
            return True
        return False

    def switch_message_version(self, conversation_id, message_index, version_index):
        """
        切换到指定的历史版本
        """
        try:
            conversation_path, conversation_data = self._load_conversation_data_for_update(conversation_id)
        except ValueError:
            return False

        messages = conversation_data.get("messages", [])
        if not isinstance(messages, list):
            return False
        if 0 <= message_index < len(messages):
            msg = messages[message_index]
            versions = msg.get("metadata", {}).get("versions", [])
            
            if 0 <= version_index <= len(versions):
                # 如果 version_index == len(versions)，表示当前就是最新（或正在切换回当前路径）
                # 这里逻辑需要稍微绕一下：versions里存的是“旧版本”
                # 我们把当前内容和目标版本互换
                
                # 简单做法：把当前所有可能的状态（当前+历史）看做一个池子
                all_variants = versions + [{
                    "content": sanitize_assistant_visible_content(msg.get("content", "")),
                    "timestamp": msg.get("timestamp", ""),
                    "metadata": {k: v for k, v in msg.get("metadata", {}).items() if k != "versions"},
                    "exchange_summary": msg.get("exchange_summary")
                }]
                
                target = all_variants[version_index]
                
                # 更新消息
                msg["content"] = sanitize_assistant_visible_content(target["content"])
                msg["timestamp"] = target["timestamp"]
                if target.get("exchange_summary"):
                    msg["exchange_summary"] = target["exchange_summary"]
                elif "exchange_summary" in msg:
                    del msg["exchange_summary"]
                
                # 更新元数据（保留 versions 列表）
                msg["metadata"] = target.get("metadata", {})

                # 切换时保留全部其余变体(含正文为空的中途终止版本):
                # 用户刚以"N/M 版本"看过它们,按可见性丢弃会导致 M 缩水、无法切回;
                # 仅做结构清洗(非 dict 剔除/正文净化/剥离嵌套 versions 防无限嵌套)
                kept_versions = []

                for i, variant in enumerate(all_variants):
                    if i == version_index or not isinstance(variant, dict):
                        continue

                    cleaned_variant = dict(variant)

                    cleaned_variant["content"] = sanitize_assistant_visible_content(cleaned_variant.get("content", ""))
                    cleaned_variant["metadata"] = {
                        k: v for k, v in (cleaned_variant.get("metadata") or {}).items()
                        if k != "versions"
                    }

                    kept_versions.append(cleaned_variant)

                msg["metadata"]["versions"] = kept_versions
                model_name = str(msg.get("metadata", {}).get("model_name", "") or "").strip()
                if model_name:
                    msg["model_name"] = model_name
                elif "model_name" in msg:
                    del msg["model_name"]
                self._invalidate_resume_cache_fields(conversation_data)
                
                conversation_data["updated_at"] = datetime.now().isoformat()
                self._save_json_atomic(conversation_path, conversation_data)
                return True
        return False

    def get_conversation(self, conversation_id):
        """
        获取对话记录
        
        Args:
            conversation_id: 对话ID
            
        Returns:
            dict: 对话数据
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        
        if not os.path.exists(conversation_path):
            raise ValueError(f"对话不存在: {conversation_id}")
        
        data = self._load_json_data(conversation_path, default=None)
        if data is None:
            raise ValueError(f"无法读取或解析对话文件: {conversation_id}")
        return data

    def get_message_count(self, conversation_id):
        """
        获取对话中的消息总数
        """
        try:
            conversation = self.get_conversation(conversation_id)
            return len(conversation.get('messages', []))
        except:
            return 0

    def get_last_user_message_index(self, conversation_id):
        """
        获取最后一条 user 消息索引，不存在返回 -1
        """
        try:
            messages = self.get_messages(conversation_id)
        except Exception:
            return -1
        for i in range(len(messages) - 1, -1, -1):
            role = str((messages[i] or {}).get("role") or "").strip()
            if role == "user":
                return i
        return -1

    def update_user_message_content(self, conversation_id, message_index, new_content, only_last=True):
        """
        更新一条 user 消息内容。
        - only_last=True 时仅允许修改最后一条 user 消息。
        """
        try:
            conversation_path, conversation_data = self._load_conversation_data_for_update(conversation_id)
        except ValueError as e:
            return False, str(e)

        try:
            idx = int(message_index)
        except Exception:
            return False, "消息索引无效"

        text = str(new_content or "").strip()
        if not text:
            return False, "消息内容不能为空"

        messages = conversation_data.get("messages", [])
        if not isinstance(messages, list):
            return False, "对话内容格式无效"
        if not (0 <= idx < len(messages)):
            return False, "消息不存在"

        msg = messages[idx] if isinstance(messages[idx], dict) else {}
        role = str(msg.get("role") or "").strip()
        if role != "user":
            return False, "仅支持修改用户消息"

        if only_last:
            last_user_index = -1
            for i in range(len(messages) - 1, -1, -1):
                m = messages[i] if isinstance(messages[i], dict) else {}
                if str(m.get("role") or "").strip() == "user":
                    last_user_index = i
                    break
            if idx != last_user_index:
                return False, "仅支持修改最后一条用户消息"

        msg["content"] = text
        msg["timestamp"] = datetime.now().isoformat()
        messages[idx] = msg
        self._invalidate_resume_cache_fields(conversation_data)
        conversation_data["messages"] = messages
        conversation_data["updated_at"] = datetime.now().isoformat()

        self._save_json_atomic(conversation_path, conversation_data)
        return True, "ok"
    
    def list_conversations(self):
        """
        列出所有对话。

        这里直接读取轻量索引，避免把每个会话的完整 messages 全量加载进内存。
        
        Returns:
            list: 对话ID列表，按创建时间倒序排列
        """
        if not os.path.exists(self.base_path):
            return []

        index_data = self._load_conversation_index()
        if not isinstance(index_data, dict):
            index_data = self._rebuild_conversation_index()

        conversation_map = index_data.get("conversations", {})
        if not isinstance(conversation_map, dict):
            conversation_map = {}

        conversations = []
        for conversation_id, item in conversation_map.items():
            if not isinstance(item, dict):
                continue

            snapshot = dict(item)
            snapshot["conversation_id"] = str(snapshot.get("conversation_id") or conversation_id)
            conversations.append(snapshot)
        
        # 置顶优先，其次按更新时间倒序
        conversations.sort(
            key=lambda x: (
                1 if bool(x.get('pin', False)) else 0,
                str(x.get('updated_at') or "")
            ),
            reverse=True
        )
        return conversations

    def set_conversation_pin(self, conversation_id, pin=True):
        """设置对话置顶状态"""
        conversation_path, conversation_data = self._load_conversation_data_for_update(conversation_id)

        conversation_data["pin"] = bool(pin)

        self._save_json_atomic(conversation_path, conversation_data)
    
    def delete_conversation(self, conversation_id):
        """
        删除对话
        
        Args:
            conversation_id: 对话ID
            
        Returns:
            bool: 是否成功删除
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        
        if not os.path.exists(conversation_path):
            return False
        
        os.remove(conversation_path)
        self._remove_conversation_index(conversation_id)
        return True

    def _remove_conversation_index(self, conversation_id):
        cid = str(conversation_id or "").strip()
        if not cid:
            return

        with get_path_lock(self.index_path):
            index_data = self._load_conversation_index()
            if not isinstance(index_data, dict):
                return

            conversations = index_data.get("conversations", {})
            if not isinstance(conversations, dict):
                conversations = {}

            if cid not in conversations:
                return

            del conversations[cid]
            index_data["updated_at"] = datetime.now().isoformat()
            index_data["conversations"] = conversations
            self._write_conversation_index(index_data)
    
    def get_messages(self, conversation_id, limit=None):
        """
        获取对话中的消息
        
        Args:
            conversation_id: 对话ID
            limit: 限制返回的消息数量（从最新开始）
            
        Returns:
            list: 消息列表
        """
        conversation = self.get_conversation(conversation_id)
        messages = conversation.get('messages', [])
        
        if limit:
            messages = messages[-limit:]
        
        return messages

    def get_latest_context_compression(self, conversation_id):
        """
        获取最近一次上下文压缩标记。
        返回结构示例：
        {
          "summary": "...",
          "history_cut_index": 42,
          "created_at": "...",
          "model": "...",
          "provider": "..."
        }
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        if not os.path.exists(conversation_path):
            return None
        try:
            conversation_data = self._load_json_data(conversation_path, default={}) or {}
            arr = conversation_data.get("context_compressions", [])
            if not isinstance(arr, list) or not arr:
                return None
            last = arr[-1]
            return last if isinstance(last, dict) else None
        except Exception:
            return None

    def append_context_compression(self, conversation_id, marker):
        """
        追加一条上下文压缩标记。
        """
        if not isinstance(marker, dict):
            return False
        try:
            with self._conversation_update_session(conversation_id) as (conversation_path, conversation_data):
                arr = conversation_data.get("context_compressions", [])
                if not isinstance(arr, list):
                    arr = []
                item = {
                    "summary": str(marker.get("summary", "") or "").strip(),
                    "history_cut_index": int(marker.get("history_cut_index", -1) or -1),
                    "created_at": str(marker.get("created_at", datetime.now().isoformat()) or datetime.now().isoformat()),
                    "model": str(marker.get("model", "") or "").strip(),
                    "provider": str(marker.get("provider", "") or "").strip(),
                    "trigger_raw_input_tokens": int(marker.get("trigger_raw_input_tokens", 0) or 0),
                    "context_window": int(marker.get("context_window", 0) or 0),
                    "history_message_count": int(marker.get("history_message_count", 0) or 0),
                    "history_chars": int(marker.get("history_chars", 0) or 0),
                }
                arr.append(item)
                if len(arr) > 40:
                    arr = arr[-40:]
                conversation_data["context_compressions"] = arr
                conversation_data["updated_at"] = datetime.now().isoformat()
                self._save_json_atomic(conversation_path, conversation_data)
                return True
        except Exception:
            return False

    # ------------------------------------------------------------------
    # System Snapshot 增量存储（DSH 式前缀缓存优化）
    # ------------------------------------------------------------------
    @staticmethod
    def _system_snapshot_hash(text: str) -> str:
        """计算系统提示词稳定哈希（16位 hex，足够区分变更且便于日志）。"""
        import hashlib

        return hashlib.sha256(str(text or "").encode("utf-8")).hexdigest()[:16]

    @staticmethod
    def _is_system_snapshot_message(msg: dict) -> bool:
        """判断是否为系统快照消息。"""
        if not isinstance(msg, dict):
            return False

        if str(msg.get("role") or "").strip() != "system":
            return False

        meta = msg.get("metadata", {}) if isinstance(msg.get("metadata", {}), dict) else {}
        return str(meta.get("kind") or "").strip() == "system_snapshot"

    def get_last_system_snapshot(self, conversation_id: str):
        """返回最后一条系统快照消息，不存在则 None。"""
        try:
            conversation = self.get_conversation(conversation_id)
        except Exception:
            return None

        messages = conversation.get("messages", []) if isinstance(conversation, dict) else []

        if not isinstance(messages, list):
            return None

        for msg in reversed(messages):
            if self._is_system_snapshot_message(msg):
                return msg

        return None

    def has_system_snapshot(self, conversation_id: str) -> bool:
        """会话是否已采用增量系统快照存储。"""
        return self.get_last_system_snapshot(conversation_id) is not None

    def ensure_system_snapshot(self, conversation_id: str, system_text: str, reason: str = "", regenerate_index=None, insert_message: bool = True):
        """
        确保会话的系统快照与当前 `system_text` 一致。

        - 首次调用：插入到 messages[0]
        - 哈希不同：追加新快照（带 [System Prompt Changed] 标记 + 新内容）
        - 哈希相同：无操作
        - 重答时：插入到 regenerate_index 前（保证重答上下文包含新 system）

        返回 (changed:bool, hash:str, epoch:int)
        """
        import hashlib

        text = str(system_text or "").strip()

        if not text:
            return False, "", 0

        new_hash = self._system_snapshot_hash(text)

        with self._conversation_update_session(conversation_id) as (conversation_path, conversation_data):
            messages = conversation_data.get("messages", [])

            if not isinstance(messages, list):
                messages = []
                conversation_data["messages"] = messages

            # 收集已有快照 epoch
            existing_epochs = [
                int((m.get("metadata", {}) or {}).get("epoch", 0) or 0)
                for m in messages
                if self._is_system_snapshot_message(m)
            ]
            next_epoch = (max(existing_epochs) + 1) if existing_epochs else 1

            last_snapshot = None

            for msg in reversed(messages):
                if self._is_system_snapshot_message(msg):
                    last_snapshot = msg
                    break

            if last_snapshot is not None:
                last_hash = str((last_snapshot.get("metadata", {}) or {}).get("hash", "") or "").strip()

                if last_hash == new_hash:
                    return False, new_hash, int((last_snapshot.get("metadata", {}) or {}).get("epoch", next_epoch - 1) or 0)

                # 哈希不同：追加新 epoch（若刚写入了当前轮 user，则插在其前，保证 system 在 user 之前）
                epoch = next_epoch
                snapshot_msg = {
                    "role": "system",
                    "content": text,
                    "timestamp": datetime.now().isoformat(),
                    "metadata": {
                        "kind": "system_snapshot",
                        "hash": new_hash,
                        "epoch": int(epoch),
                        "prev_hash": last_hash,
                        "reason": str(reason or "system_changed").strip() or "system_changed",
                    },
                }
                # 重答时插入到重答点前，保证重答上下文包含新 system
                try:
                    ri = int(regenerate_index) if regenerate_index is not None else None
                except Exception:
                    ri = None

                if ri is not None and 0 <= ri <= len(messages):
                    # regenerate_index 指向待覆盖的 assistant，system 应在其前的 user 之前
                    insert_pos = max(0, ri - 1) if ri > 0 and isinstance(messages[ri - 1], dict) and str(messages[ri - 1].get("role") or "").strip() == "user" else ri
                    messages.insert(insert_pos, snapshot_msg)
                elif messages and isinstance(messages[-1], dict) and str(messages[-1].get("role") or "").strip() == "user":
                    # 刚落库的当前轮 user 在末尾时，system 应在其前，否则前缀顺序错乱
                    messages.insert(len(messages) - 1, snapshot_msg)
                else:
                    messages.append(snapshot_msg)
                conversation_data["messages"] = messages
                conversation_data["updated_at"] = datetime.now().isoformat()
                self._save_json_atomic(conversation_path, conversation_data)
                print(f"[SYSTEM_SNAPSHOT] append epoch={epoch} hash={new_hash} prev={last_hash} reason={reason}")
                return True, new_hash, int(epoch)

            # 首次：插入到最前
            epoch = 1
            snapshot_msg = {
                "role": "system",
                "content": text,
                "timestamp": datetime.now().isoformat(),
                "metadata": {
                    "kind": "system_snapshot",
                    "hash": new_hash,
                    "epoch": int(epoch),
                    "prev_hash": "",
                    "reason": str(reason or "initial").strip() or "initial",
                },
            }
            messages.insert(0, snapshot_msg)
            conversation_data["messages"] = messages
            conversation_data["updated_at"] = datetime.now().isoformat()
            self._save_json_atomic(conversation_path, conversation_data)
            print(f"[SYSTEM_SNAPSHOT] initial epoch=1 hash={new_hash}")
            return True, new_hash, 1

    # ------------------------------------------------------------------
    # Knowledge Index 增量 diff 注入（避免知识库微变导致 system 全量重写）
    # ------------------------------------------------------------------
    def get_last_knowledge_snapshot(self, conversation_id: str):
        """返回上次持久化的知识索引快照列表，不存在则 []。"""
        try:
            conversation = self.get_conversation(conversation_id)
        except Exception:
            return []

        snap = conversation.get("knowledge_snapshot", None)

        if isinstance(snap, dict) and isinstance(snap.get("documents"), list):
            return snap.get("documents", [])

        if isinstance(snap, list):
            return snap

        return []

    def _knowledge_docs_hash(self, docs) -> str:
        """对 knowledge_documents 列表计算稳定哈希（按标题排序）。"""
        import hashlib, json

        if not isinstance(docs, list):
            return ""

        normalized = []

        for item in docs:
            if not isinstance(item, dict):
                continue

            title = str(item.get("title") or item.get("name") or "").strip()
            if not title:
                continue

            normalized.append({
                "title": title,
                "knowledge_type": str(item.get("knowledge_type") or item.get("type") or "basis").strip(),
                "basis_id": str(item.get("basis_id") or "").strip(),
                "pin": bool(item.get("pin", False)),
            })

        normalized.sort(key=lambda x: (x["title"].lower(), x["basis_id"]))

        try:
            raw = json.dumps(normalized, ensure_ascii=False, sort_keys=True)
        except Exception:
            raw = str(normalized)

        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    def ensure_knowledge_diff_snapshot(self, conversation_id: str, new_docs, max_diff_items: int = 20, regenerate_index=None, insert_message: bool = True):
        """
        对比上次知识快照与新列表，若有变更则：
        1. 更新 conversation.knowledge_snapshot
        2. 追加一条 role=system, kind=knowledge_diff 的增量提示词（列表 join 的后续段）

        返回 (changed, added, removed, diff_text)
        """
        new_list = [d for d in (new_docs or []) if isinstance(d, dict)]
        old_list = self.get_last_knowledge_snapshot(conversation_id)
        old_hash = self._knowledge_docs_hash(old_list)
        new_hash = self._knowledge_docs_hash(new_list)

        if old_hash == new_hash:
            return False, [], [], ""

        # 首次初始化：静默落库，不发 tool 卡，避免旧会话一次性 +全部
        is_initial = not old_list and old_hash == self._knowledge_docs_hash([])

        if is_initial:
            with self._conversation_update_session(conversation_id) as (conversation_path, conversation_data):
                conversation_data["knowledge_snapshot"] = {
                    "hash": new_hash,
                    "updated_at": datetime.now().isoformat(),
                    "documents": [dict(d) for d in new_list],
                }
                conversation_data["updated_at"] = datetime.now().isoformat()
                self._save_json_atomic(conversation_path, conversation_data)
            print(f"[KNOWLEDGE_DIFF] initial snapshot hash={new_hash} docs={len(new_list)} (silent)")
            return False, [], [], ""

        # 计算 diff（按标题）
        old_titles = {str(d.get("title") or "").strip(): d for d in old_list if str(d.get("title") or "").strip()}
        new_titles = {str(d.get("title") or "").strip(): d for d in new_list if str(d.get("title") or "").strip()}

        added = [new_titles[t] for t in new_titles if t not in old_titles]
        removed = [old_titles[t] for t in old_titles if t not in new_titles]

        # 构建 diff 文本（控制长度，适配缓存：增量而非全量）
        lines = []

        if added:
            lines.append(f"新增知识 {len(added)} 项：")

            for item in added[:max_diff_items]:
                title = str(item.get("title") or "").strip()
                ktype = str(item.get("knowledge_type") or item.get("type") or "basis").strip()
                lines.append(f"- + {title} ({ktype})")

            if len(added) > max_diff_items:
                lines.append(f"- ... 还有 {len(added) - max_diff_items} 项新增未列出")

        if removed:
            lines.append(f"移除知识 {len(removed)} 项：")

            for item in removed[:max_diff_items]:
                title = str(item.get("title") or "").strip()
                lines.append(f"- - {title}")

            if len(removed) > max_diff_items:
                lines.append(f"- ... 还有 {len(removed) - max_diff_items} 项移除未列出")

        if not lines:
            # 仅属性变更（如 pin），视为更新
            lines.append(f"知识索引属性更新：{len(new_list)} 项")

        diff_text = "## Workspace Knowledge Index 更新\n" + "\n".join(lines)

        with self._conversation_update_session(conversation_id) as (conversation_path, conversation_data):
            # 更新快照
            conversation_data["knowledge_snapshot"] = {
                "hash": new_hash,
                "updated_at": datetime.now().isoformat(),
                "documents": [dict(d) for d in new_list],
            }

            if insert_message:
                # 追加增量系统消息（列表 join 的尾部，保证前缀缓存）
                diff_msg = {
                    "role": "system",
                    "content": diff_text,
                    "timestamp": datetime.now().isoformat(),
                    "metadata": {
                        "kind": "knowledge_diff",
                        "hash": new_hash,
                        "prev_hash": old_hash,
                        "added_count": len(added),
                        "removed_count": len(removed),
                    },
                }
                messages = conversation_data.get("messages", [])

                if not isinstance(messages, list):
                    messages = []

                # 重答时插到重答点前，否则若末条是刚写入的 user 插其前
                try:
                    ri = int(regenerate_index) if regenerate_index is not None else None
                except Exception:
                    ri = None

                if ri is not None and 0 <= ri <= len(messages):
                    insert_pos = max(0, ri - 1) if ri > 0 and isinstance(messages[ri - 1], dict) and str(messages[ri - 1].get("role") or "").strip() == "user" else ri
                    messages.insert(insert_pos, diff_msg)
                elif messages and isinstance(messages[-1], dict) and str(messages[-1].get("role") or "").strip() == "user":
                    messages.insert(len(messages) - 1, diff_msg)
                else:
                    messages.append(diff_msg)

                conversation_data["messages"] = messages
            conversation_data["updated_at"] = datetime.now().isoformat()
            self._save_json_atomic(conversation_path, conversation_data)

        print(f"[KNOWLEDGE_DIFF] hash {old_hash}->{new_hash} +{len(added)} -{len(removed)} insert={insert_message}")
        return True, added, removed, diff_text

    def get_last_global_knowledge_snapshot(self, conversation_id: str):
        """全局 USER_KNOWLEDGE_INDEX 快照。"""
        try:
            conversation = self.get_conversation(conversation_id)
        except Exception:
            return []

        snap = conversation.get("global_knowledge_snapshot", None)

        if isinstance(snap, dict) and isinstance(snap.get("documents"), list):
            return snap.get("documents", [])

        if isinstance(snap, list):
            return snap

        return []

    def ensure_global_knowledge_diff_snapshot(self, conversation_id: str, new_titles, max_diff_items: int = 20, regenerate_index=None):
        """
        全局知识索引 diff（USER_KNOWLEDGE_INDEX），new_titles 为标题列表或文档列表。
        首次静默落库，后续变更追加 knowledge_diff（kind=global_knowledge_diff）。
        """
        # 归一化为文档列表
        new_list = []

        for item in (new_titles or []):
            if isinstance(item, dict):
                title = str(item.get("title") or item.get("name") or "").strip()
                if title:
                    new_list.append({"title": title})
            elif isinstance(item, str):
                title = str(item or "").strip()
                if title:
                    new_list.append({"title": title})

        old_list = self.get_last_global_knowledge_snapshot(conversation_id)
        old_hash = self._knowledge_docs_hash(old_list)
        new_hash = self._knowledge_docs_hash(new_list)

        if old_hash == new_hash:
            return False, [], [], ""

        is_initial = not old_list and old_hash == self._knowledge_docs_hash([])

        if is_initial:
            with self._conversation_update_session(conversation_id) as (conversation_path, conversation_data):
                conversation_data["global_knowledge_snapshot"] = {
                    "hash": new_hash,
                    "updated_at": datetime.now().isoformat(),
                    "documents": [dict(d) for d in new_list],
                }
                conversation_data["updated_at"] = datetime.now().isoformat()
                self._save_json_atomic(conversation_path, conversation_data)
            print(f"[GLOBAL_KNOWLEDGE_DIFF] initial snapshot hash={new_hash} docs={len(new_list)} (silent)")
            return False, [], [], ""

        old_titles = {str(d.get("title") or "").strip(): d for d in old_list if str(d.get("title") or "").strip()}
        new_titles_map = {str(d.get("title") or "").strip(): d for d in new_list if str(d.get("title") or "").strip()}
        added = [new_titles_map[t] for t in new_titles_map if t not in old_titles]
        removed = [old_titles[t] for t in old_titles if t not in new_titles_map]

        lines = []

        if added:
            lines.append(f"新增知识 {len(added)} 项：")
            for item in added[:max_diff_items]:
                lines.append(f"- + {str(item.get('title') or '').strip()}")
            if len(added) > max_diff_items:
                lines.append(f"- ... 还有 {len(added) - max_diff_items} 项新增未列出")

        if removed:
            lines.append(f"移除知识 {len(removed)} 项：")
            for item in removed[:max_diff_items]:
                lines.append(f"- - {str(item.get('title') or '').strip()}")
            if len(removed) > max_diff_items:
                lines.append(f"- ... 还有 {len(removed) - max_diff_items} 项移除未列出")

        if not lines:
            lines.append(f"知识索引属性更新：{len(new_list)} 项")

        diff_text = "## User Knowledge Index 更新\n" + "\n".join(lines)

        with self._conversation_update_session(conversation_id) as (conversation_path, conversation_data):
            conversation_data["global_knowledge_snapshot"] = {
                "hash": new_hash,
                "updated_at": datetime.now().isoformat(),
                "documents": [dict(d) for d in new_list],
            }
            diff_msg = {
                "role": "system",
                "content": diff_text,
                "timestamp": datetime.now().isoformat(),
                "metadata": {
                    "kind": "knowledge_diff",
                    "scope": "global",
                    "hash": new_hash,
                    "prev_hash": old_hash,
                    "added_count": len(added),
                    "removed_count": len(removed),
                },
            }
            messages = conversation_data.get("messages", [])
            if not isinstance(messages, list):
                messages = []
            try:
                ri = int(regenerate_index) if regenerate_index is not None else None
            except Exception:
                ri = None
            if ri is not None and 0 <= ri <= len(messages):
                insert_pos = max(0, ri - 1) if ri > 0 and isinstance(messages[ri - 1], dict) and str(messages[ri - 1].get("role") or "").strip() == "user" else ri
                messages.insert(insert_pos, diff_msg)
            elif messages and isinstance(messages[-1], dict) and str(messages[-1].get("role") or "").strip() == "user":
                messages.insert(len(messages) - 1, diff_msg)
            else:
                messages.append(diff_msg)
            conversation_data["messages"] = messages
            conversation_data["updated_at"] = datetime.now().isoformat()
            self._save_json_atomic(conversation_path, conversation_data)

        print(f"[GLOBAL_KNOWLEDGE_DIFF] hash {old_hash}->{new_hash} +{len(added)} -{len(removed)}")
        return True, added, removed, diff_text
    
    def set_main_title(self, conversation_id, main_title):
        """
        设置当前这次交流的总结（针对最后一条assistant消息）
        
        Args:
            conversation_id: 对话ID
            main_title: 这次交流的总结
        """
        conversation_path, conversation_data = self._load_conversation_data_for_update(conversation_id)

        messages = conversation_data.get("messages", [])
        if not isinstance(messages, list):
            raise ValueError(f"对话内容格式无效: {conversation_id}")

        # 找到最后一条assistant消息，添加exchange_summary
        for msg in reversed(messages):
            if msg["role"] == "assistant":
                msg["exchange_summary"] = main_title
                break
        
        conversation_data["updated_at"] = datetime.now().isoformat()
        
        self._save_json_atomic(conversation_path, conversation_data)
    
    def get_recent_exchange_summaries(self, conversation_id, limit=5):
        """
        获取最近几次交流的总结
        
        Args:
            conversation_id: 对话ID
            limit: 返回最近N次交流的总结
            
        Returns:
            list: 交流总结列表 [{"user": "...", "summary": "..."}, ...]
        """
        messages = self.get_messages(conversation_id)
        
        summaries = []
        current_pair = {}
        
        for msg in messages:
            if msg["role"] == "user":
                current_pair = {"user": msg["content"][:100]}  # 截取前100字
            elif msg["role"] == "assistant":
                if "exchange_summary" in msg:
                    current_pair["summary"] = msg["exchange_summary"]
                    summaries.append(current_pair)
                    current_pair = {}
        
        return summaries[-limit:] if len(summaries) > limit else summaries
    
    def get_context_length(self, offset=0, conversation_id=None):
        """
        获取前offset个对话的总字符长度
        
        Args:
            offset: 从最新往前数第offset个对话（0=当前，1=上一个）
            conversation_id: 指定对话ID（如果指定则忽略offset，直接获取该对话长度）
            
        Returns:
            int: 字符总长度
        """
        if conversation_id:
            target_conv_id = conversation_id
        else:
            conversations = self.list_conversations()
            if offset >= len(conversations):
                return 0
            target_conv_id = conversations[offset]['conversation_id']
            
        messages = self.get_messages(target_conv_id)
        
        total_length = 0
        for msg in messages:
            total_length += len(msg.get('content', ''))
        
        return total_length
    
    def get_context(self, offset=0, from_pos=0, to_pos=None, conversation_id=None):
        """
        获取前offset个对话从from_pos到to_pos字符的内容
        
        Args:
            offset: 从最新往前数第offset个对话
            from_pos: 起始字符位置
            to_pos: 结束字符位置（None表示到结尾）
            conversation_id: 指定对话ID（如果指定则忽略offset，直接获取该对话内容）
            
        Returns:
            str: 截取的内容
        """
        if conversation_id:
            target_conv_id = conversation_id
        else:
            conversations = self.list_conversations()
            if offset >= len(conversations):
                return ""
            target_conv_id = conversations[offset]['conversation_id']

        messages = self.get_messages(target_conv_id)
        
        # 拼接所有消息
        full_text = ""
        for msg in messages:
            role = msg.get('role', 'unknown')
            content = msg.get('content', '')
            full_text += f"[{role}]: {content}\n\n"
        
        # 截取指定范围
        if to_pos is None:
            return full_text[from_pos:]
        else:
            return full_text[from_pos:to_pos]
    
    def get_context_find_keyword(self, offset=0, keyword="", range_size=10, conversation_id=None):
        """
        在前offset个对话中搜索关键词，返回关键词前后range_size个字符的上下文
        
        Args:
            offset: 从最新往前数第offset个对话
            keyword: 搜索关键词
            range_size: 关键词前后返回的字符数
            conversation_id: 指定对话ID（如果指定则忽略offset，直接在该对话中搜索）
            
        Returns:
            str: 格式化的搜索结果
        """
        if conversation_id:
            target_conv_id = conversation_id
        else:
            conversations = self.list_conversations()
            if offset >= len(conversations):
                return "对话不存在"
            target_conv_id = conversations[offset]['conversation_id']

        messages = self.get_messages(target_conv_id)
        
        results = []
        for msg in messages:
            role = msg.get('role', 'unknown')
            content = msg.get('content', '')
            
            # 查找关键词的所有出现位置
            start = 0
            while True:
                pos = content.find(keyword, start)
                if pos == -1:
                    break
                
                # 提取关键词前后的文本
                context_start = max(0, pos - range_size)
                context_end = min(len(content), pos + len(keyword) + range_size)
                
                before = content[context_start:pos]
                match = content[pos:pos+len(keyword)]
                after = content[pos+len(keyword):context_end]
                
                results.append(f"[{role}]: ...{before}【{match}】{after}...")
                start = pos + 1
        
        if not results:
            return f"未找到关键词: {keyword}"
        
        return "\n".join(results)
    
    def get_main_title(self, conversation_id, offset=0):
        """
        获取指定对话中前offset次交流的总结（从最近往前数）
        
        Args:
            conversation_id: 对话ID
            offset: 从最新往前数第offset次交流（0=当前未完成的交流，1=上一次交流）
            
        Returns:
            str: 交流总结
        """
        messages = self.get_messages(conversation_id)
        
        # 找到所有有exchange_summary的assistant消息
        summaries = []
        for msg in messages:
            if msg["role"] == "assistant" and "exchange_summary" in msg:
                summaries.append(msg["exchange_summary"])
        
        if not summaries:
            return "无交流总结"
        
        # offset=0返回最后一次，offset=1返回倒数第二次
        index = -(offset + 1)
        if abs(index) > len(summaries):
            return "交流不存在"
        
        return summaries[index]


if __name__ == "__main__":
    # 测试代码
    os.chdir("../")
    
    manager = ConversationManager("test_user")
    
    # 创建对话
    conv_id = manager.create_conversation()
    print(f"创建对话: {conv_id}")
    
    # 添加消息
    manager.add_message(conv_id, "user", "你好")
    manager.add_message(conv_id, "assistant", "你好！有什么我可以帮助你的吗？")
    
    # 获取对话
    conversation = manager.get_conversation(conv_id)
    print(f"对话内容: {conversation}")
    
    # 列出所有对话
    conversations = manager.list_conversations()
    print(f"所有对话: {conversations}")
