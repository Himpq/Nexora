"""
Nexora.basis.Conversation.service — 唯一对外入口 ConversationService

所有外部代码只允许：
    from basis.Conversation import ConversationService

提供契约 §五 全部 API，返回值均为深拷贝，不暴露内部可变字典。
写路径保证：user 追加 + system/knowledge 更新在同一会话内完成，返回稳定 visible index。
"""

from __future__ import annotations

import copy
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from basis.Database import get_path_lock, safe_write_json

from . import branches as branches_mod
from . import context as context_mod
from . import index as index_mod
from . import messages as messages_mod
from . import telemetry as telemetry_mod
from . import turn_state as turn_state_mod
from .errors import ConversationIndexError, ConversationNotFoundError, ConversationValidationError
from .migration import migrate_all, migrate_conversation_file, migrate_single_conversation_data
from .repository import (
    conversation_base_path,
    conversation_file_path,
    conversation_index_path,
    conversation_update_session,
    ensure_conversation_dir,
    load_conversation_file,
    load_json_compat,
    save_conversation_file,
)
from .schema import SCHEMA_VERSION, build_v4_skeleton, normalize_scope, normalize_v4_conversation, validate_v4_conversation
from . import puzzle as puzzle_mod

# ------------------------------------------------------------------
# 会话上下文长度限流（对应用户反馈：cid=446 在 LLMFaker 5000 窗口下已超限仍可继续写入）
# ------------------------------------------------------------------
DEFAULT_MAX_CONVERSATION_CHARS = 5000
CHARS_PER_TOKEN_ESTIMATE = 4


class ConversationService:
    """Conversation v4 唯一对外服务。"""

    def __init__(self, username: str):
        self.username = str(username or "").strip()
        if not self.username:
            raise ConversationValidationError("username 不能为空")
        ensure_conversation_dir(self.username)
        # 确保索引存在
        index_mod.ensure_index(self.username)

    # ------------------------------------------------------------------
    # 基础读写
    # ------------------------------------------------------------------
    def _load_v4(self, conversation_id: str) -> Dict[str, Any]:
        data = load_conversation_file(self.username, conversation_id)
        # 若仍为旧版，实时迁移（内存），不自动写盘
        if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
            data = migrate_single_conversation_data(data)
            # 归一化
            data = normalize_v4_conversation(data)
        else:
            data = normalize_v4_conversation(data)
        return data

    def _save_v4(self, conversation_id: str, payload: Dict[str, Any]) -> None:
        validate_v4_conversation(payload)
        path = conversation_file_path(self.username, conversation_id)
        safe_write_json(path, payload, indent=2)
        index_mod.sync_index_from_file(self.username, path, payload)

    # ------------------------------------------------------------------
    # 上下文长度限流辅助
    # ------------------------------------------------------------------
    def get_serialized_length(self, conversation_id: str) -> int:
        """返回 role: content 序列化长度（与 ConversationContextReader 同口径）。"""

        try:
            from .context_reader import ConversationContextReader

            return int(ConversationContextReader(self.username).get_length(str(conversation_id)))
        except Exception:
            # 回退：直接用 _serialize_context_messages 口径
            return len(self._serialize_context_messages(str(conversation_id)))

    def _chars_limit_for_window(self, context_window_tokens: int | None) -> int:
        """将模型的 context_window(tokens) 换算为字符上限；无窗口时回退 5000。"""

        try:
            win = int(context_window_tokens or 0)
        except Exception:
            win = 0

        if win >= 1024:
            # 估算：1 token ≈ 4 chars（与 estimate_token_count 互为逆运算）
            return int(win * CHARS_PER_TOKEN_ESTIMATE)

        return int(DEFAULT_MAX_CONVERSATION_CHARS)

    def ensure_within_limit(
        self,
        conversation_id: str,
        *,
        context_window_tokens: int | None = None,
        incoming_chars: int = 0,
        auto_prune: bool = True,
    ) -> Dict[str, Any]:
        """
        检查会话是否已超限；若超限且 auto_prune=True，则按滑动窗口裁掉最旧轮次直到满足 limit-incoming。
        返回 {length_before, length_after, pruned_pairs, limit, exceeded_before}
        """

        cid = str(conversation_id or "").strip()
        if not cid:
            raise ConversationValidationError("conversation_id 不能为空")

        limit = self._chars_limit_for_window(context_window_tokens)
        cur_len = self.get_serialized_length(cid)
        exceeded_before = cur_len > limit
        pruned_pairs = 0

        if auto_prune and cur_len + int(incoming_chars or 0) > limit:
            # 在同一文件锁事务内裁剪，避免并发写入丢失
            from .repository import conversation_update_session
            from .schema import validate_v4_conversation as _validate
            from basis.Database import safe_write_json as _safe_write

            with conversation_update_session(self.username, cid) as (path, data):
                if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                    data = migrate_single_conversation_data(data)
                    data = normalize_v4_conversation(data)

                messages = data.get("messages", []) if isinstance(data.get("messages"), list) else []

                # 至少保留最后 1 轮（2 条）以保证对话可用；其余按轮次裁掉
                while messages and (self._estimate_serialized_len(messages) + int(incoming_chars or 0) > limit) and len(messages) > 2:
                    # 按轮次裁：一次删 2 条（user+assistant），若首条为 system 则单独删
                    if str((messages[0] or {}).get("role") or "").strip() == "system":
                        messages.pop(0)
                    elif len(messages) >= 2:
                        messages = messages[2:]
                        pruned_pairs += 1
                    else:
                        messages.pop(0)

                data["messages"] = messages
                from datetime import datetime as _dt

                data["updated_at"] = _dt.now().isoformat()
                _validate(data)
                _safe_write(path, data, indent=2)
                index_mod.sync_index_from_file(self.username, path, data)
                cur_len = self._estimate_serialized_len(messages)

        return {
            "length_before": int(cur_len if pruned_pairs == 0 else -1),  # pruned 时 before 已在事务内重算，简化返回
            "length_after": int(cur_len),
            "pruned_pairs": int(pruned_pairs),
            "limit": int(limit),
            "exceeded_before": bool(exceeded_before),
        }

    def _estimate_serialized_len(self, messages: List[Dict[str, Any]]) -> int:
        parts: List[str] = []

        for m in messages:
            if not isinstance(m, dict):
                continue

            role = str(m.get("role") or "").strip() or "unknown"
            content = m.get("content")
            if isinstance(content, list):
                texts: List[str] = []

                for seg in content:
                    if isinstance(seg, dict) and str(seg.get("type") or "").strip() == "text":
                        texts.append(str(seg.get("text") or ""))

                    elif isinstance(seg, str):
                        texts.append(seg)

                content_str = "\n".join(texts)
            elif content is None:
                content_str = ""
            else:
                content_str = str(content or "")

            parts.append(f"{role}: {content_str}")

        return len("\n\n".join(parts))

    # ------------------------------------------------------------------
    # 创建 / 获取
    # ------------------------------------------------------------------
    def create_conversation(
        self,
        conversation_id: str | None = None,
        title: str = "新对话",
        scope: Dict[str, Any] | None = None,
        tags: List[str] | None = None,
        metadata: Dict[str, Any] | None = None,
        conversation_mode: str | None = None,
    ) -> str:
        """
        创建会话。兼容旧调用：tags/metadata/conversation_mode 会被映射到 scope。
        """
        base_path = conversation_base_path(self.username)
        with get_path_lock(base_path):
            # 分配 ID
            if conversation_id is None:
                reserved: set[int] = set()
                if os.path.exists(base_path):
                    for filename in os.listdir(base_path):
                        if not filename.endswith(".json") or filename == os.path.basename(conversation_index_path(self.username)):
                            continue
                        try:
                            reserved.add(int(filename[:-5]))
                        except ValueError:
                            continue
                # 回收站占用
                trash_path = os.path.join(os.path.dirname(base_path), "trash")
                if os.path.isdir(trash_path):
                    for filename in os.listdir(trash_path):
                        if not filename.endswith(".json"):
                            continue
                        entry = load_json_compat(os.path.join(trash_path, filename), default=None)
                        if not isinstance(entry, dict) or str(entry.get("type") or "").strip() != "conversation":
                            continue
                        payload = entry.get("payload", {}) if isinstance(entry.get("payload"), dict) else {}
                        cid = str(entry.get("conversation_id") or payload.get("conversation_id") or "").strip()
                        try:
                            reserved.add(int(cid))
                        except ValueError:
                            continue
                new_id = str(max(reserved) + 1) if reserved else "1"
            else:
                new_id = str(conversation_id).strip()
                if not new_id:
                    raise ConversationValidationError("conversation_id 不能为空")
                if os.path.exists(conversation_file_path(self.username, new_id)):
                    raise ConversationValidationError(f"conversation_id 已存在: {new_id}")

            # scope 兼容映射
            scope_payload: Dict[str, Any] = {}
            if isinstance(scope, dict):
                scope_payload.update(scope)
            # 旧 tags -> scope.tags
            if isinstance(tags, list):
                scope_payload["tags"] = list(tags)
            if isinstance(metadata, dict):
                # 若 metadata 中有 workspace / learning 暗示，直接映射
                if metadata.get("workspace_id") and not scope_payload.get("workspace_id"):
                    scope_payload["workspace_id"] = str(metadata.get("workspace_id"))
                # learning 平铺
                learning_hint: Dict[str, Any] = {}
                for key in ("learning_lecture_id", "lecture_id", "learning_course_id", "course_id", "learning_course_title", "course_title"):
                    if key in metadata:
                        learning_hint[key] = metadata[key]
                if learning_hint:
                    # 转为 learning 块
                    existing_learning = scope_payload.get("learning") if isinstance(scope_payload.get("learning"), dict) else {}
                    merged_learning = dict(existing_learning)
                    for k, v in learning_hint.items():
                        merged_learning[k] = v
                    scope_payload["learning"] = merged_learning
                if isinstance(metadata.get("learning"), dict):
                    scope_payload["learning"] = dict(metadata.get("learning"))
                if isinstance(metadata.get("nexoracode_project"), dict):
                    # workspace 推断的辅助信息不直接入 scope，但保留于索引的兼容字段
                    pass

            # conversation_mode -> scope.learning.enabled
            if isinstance(conversation_mode, str) and conversation_mode.strip().lower() == "learning":
                learning = scope_payload.get("learning") if isinstance(scope_payload.get("learning"), dict) else {}
                learning["enabled"] = True
                scope_payload["learning"] = learning
                if "learning" not in [str(t).lower() for t in (scope_payload.get("tags") or [])]:
                    tags_list = list(scope_payload.get("tags") or [])
                    tags_list.append("learning")
                    scope_payload["tags"] = tags_list

            skeleton = build_v4_skeleton(new_id, title=title, scope=scope_payload)
            # 兼容：若调用方传入了旧 metadata.nexoracode_project，暂不持久化于 v4 主体，索引层自行提取
            self._save_v4(new_id, skeleton)
            return new_id

    def get_conversation(self, conversation_id: str) -> Dict[str, Any]:
        """返回会话深拷贝（完整 v4）。"""
        data = self._load_v4(conversation_id)
        return copy.deepcopy(data)

    def get_conversation_header(self, conversation_id: str) -> Dict[str, Any]:
        data = self._load_v4(conversation_id)
        return {
            "conversation_id": str(data.get("conversation_id")),
            "title": str(data.get("title") or "未命名对话"),
            "created_at": data.get("created_at"),
            "updated_at": data.get("updated_at"),
            "pin": bool(data.get("pin", False)),
            "scope": copy.deepcopy(data.get("scope", {})),
            "branch": copy.deepcopy(data.get("branch")),
            "message_count": len(data.get("messages", []) if isinstance(data.get("messages"), list) else []),
        }

    def get_messages(self, conversation_id: str, limit: int | None = None) -> List[Dict[str, Any]]:
        data = self._load_v4(conversation_id)
        messages = data.get("messages", []) if isinstance(data.get("messages"), list) else []
        copied = copy.deepcopy(messages)
        if limit is not None:
            try:
                lim = int(limit)
                if lim > 0:
                    copied = copied[-lim:]
            except Exception:
                pass
        return copied

    def get_context_bundle(self, conversation_id: str) -> Dict[str, Any]:
        """一次读盘返回上下文构建所需的全部数据（消息/压缩/快照/事件）。

        供 Context 层 build_initial_context 合并读取，避免 messages、compression、
        snapshots 三处各自整文件解析（读盘 + json.loads + 全量 normalize 的重复开销）。
        """
        data = self._load_v4(conversation_id)
        context = data.get("context", {}) if isinstance(data.get("context"), dict) else {}
        snaps = context.get("system_snapshots", [])
        events = context.get("knowledge_events", [])
        profile_events = context.get("profile_events", [])
        skill_events = context.get("skill_events", [])
        return {
            "messages": copy.deepcopy(data.get("messages", []) if isinstance(data.get("messages"), list) else []),
            "compression": copy.deepcopy(context_mod.get_latest_compression(data)),
            "system_snapshots": copy.deepcopy(snaps if isinstance(snaps, list) else []),
            "knowledge_events": copy.deepcopy(events if isinstance(events, list) else []),
            "profile_events": copy.deepcopy(profile_events if isinstance(profile_events, list) else []),
            "skill_events": copy.deepcopy(skill_events if isinstance(skill_events, list) else []),
        }

    def get_current_knowledge_state(self, workspace_context: Dict[str, Any] | None = None) -> Dict[str, Any]:
        """读取本轮发送实际可见的知识状态，供 begin_user_turn 原子记录快照。"""
        from basis.User import User, BASIS

        # 知识库基线取 data_basis（BASIS 类型），与 knowledge 全局标题口径一致
        knowledge_map = User(self.username).getKnowledgeList(BASIS)
        if isinstance(knowledge_map, dict):
            global_titles = [str(title).strip() for title in knowledge_map if str(title).strip()]
        elif isinstance(knowledge_map, list):
            global_titles = [str(title).strip() for title in knowledge_map if str(title).strip()]
        else:
            raise ConversationValidationError("知识库列表格式无效")

        workspace_documents: List[Dict[str, Any]] = []
        if workspace_context is not None:
            if not isinstance(workspace_context, dict):
                raise ConversationValidationError("workspace_context 必须是对象")
            raw_documents = workspace_context.get("knowledge_documents", [])
            if not isinstance(raw_documents, list):
                raise ConversationValidationError("workspace knowledge_documents 必须是数组")
            workspace_documents = [copy.deepcopy(item) for item in raw_documents if isinstance(item, dict)]

        return {
            "workspace_documents": workspace_documents,
            "global_titles": global_titles,
        }

    def get_context_events(self, conversation_id: str) -> List[Dict[str, Any]]:
        """返回会话 v4 context 中的知识变更事件，供前端时间线渲染。"""
        data = self._load_v4(conversation_id)
        raw_events = (data.get("context", {}) or {}).get("knowledge_events", [])
        if not isinstance(raw_events, list):
            return []
        return copy.deepcopy([event for event in raw_events if isinstance(event, dict)])

    # ------------------------------------------------------------------
    # 上下文构建
    # ------------------------------------------------------------------
    def build_model_context(
        self,
        conversation_id: str,
        current_user_content: Any = None,
        options: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        data = self._load_v4(conversation_id)
        opts = options if isinstance(options, dict) else {}
        return context_mod.build_model_context_payload(
            data,
            current_user_content=current_user_content,
            history_end_index_exclusive=opts.get("history_end_index_exclusive"),
            system_prompt_text=opts.get("system_prompt_text"),
            system_injection_texts=opts.get("system_injection_texts"),
        )

    # ------------------------------------------------------------------
    # 发送与流式事务
    # ------------------------------------------------------------------
    def begin_user_turn(
        self,
        conversation_id: str,
        content: Any,
        metadata: Dict[str, Any] | None = None,
        *,
        attachments: List[Any] | None = None,
        system_snapshot: str | None = None,
        system_reason: str = "chat_turn",
        workspace_documents: Any = context_mod._UNSET,
        global_titles: Any = context_mod._UNSET,
        profile_text: str | None = None,
        skill_samples: List[Dict[str, Any]] | None = None,
        context_window_tokens: int | None = None,
    ) -> Dict[str, Any]:
        """
        一个事务内完成：
        - 更新 system snapshot / knowledge snapshot（若提供）
        - 采样画像 / 技能基线并与上一基线 diff（若提供）
        - 追加 user 消息
        返回 {user_index, assistant_index, visible_count, knowledge_delta, profile_delta, skill_delta}
        assistant_index 为预留位（下一条 assistant 将写入的位置），调用方据此流式写入。
        knowledge_delta / profile_delta / skill_delta 为本轮开头的变更采样，无变更时为 None；
        user_index 为 0 表示本轮是首轮，此时 delta 是相对空基线算出的全量，调用方不应注入。
        """
        with conversation_update_session(self.username, conversation_id) as (path, data):
            # 若为旧版，先迁移
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                # 归一化
                data = normalize_v4_conversation(data)

            # ---- 超上下文限流：全量历史视角，客户端截断不影响判定 ----
            _incoming_chars = 0
            try:
                if isinstance(content, list):
                    _incoming_chars = sum(len(str(seg.get("text") or "")) if isinstance(seg, dict) else len(str(seg)) for seg in content)
                elif content is not None:
                    _incoming_chars = len(str(content))
            except Exception:
                _incoming_chars = len(str(content or ""))

            _limit_chars = self._chars_limit_for_window(context_window_tokens)

            _msgs_for_len = data.get("messages", []) if isinstance(data.get("messages"), list) else []
            _cur_len = self._estimate_serialized_len(_msgs_for_len)
            try:
                _fsize = int(path and __import__("os").path.getsize(path) or 0)
            except Exception:
                _fsize = 0
            print(f"[CTX_CHECK] cid={conversation_id} user={self.username} cur_len={_cur_len} incoming={_incoming_chars} limit={_limit_chars} fsize={_fsize} window={context_window_tokens}")
            if _cur_len + _incoming_chars > _limit_chars and len(_msgs_for_len) > 2:
                _orig_len = _cur_len
                _pruned = 0
                while _msgs_for_len and (self._estimate_serialized_len(_msgs_for_len) + _incoming_chars > _limit_chars) and len(_msgs_for_len) > 2:
                    if str((_msgs_for_len[0] or {}).get("role") or "").strip() == "system":
                        _msgs_for_len.pop(0)
                    elif len(_msgs_for_len) >= 2:
                        _msgs_for_len = _msgs_for_len[2:]
                        _pruned += 1
                    else:
                        _msgs_for_len.pop(0)
                if _pruned:
                    data["messages"] = _msgs_for_len
                    print(f"[CTX_LIMIT] cid={conversation_id} user={self.username} pruned {_pruned} pairs: {_orig_len}+{_incoming_chars} > {_limit_chars} (window={context_window_tokens})")
                    try:
                        _cut = _pruned * 2 - 1
                        _ctx = data.get("context", {}) if isinstance(data.get("context"), dict) else {}
                        for _key in ("knowledge_events", "profile_events", "skill_events"):
                            _evs = _ctx.get(_key)
                            if isinstance(_evs, list) and _evs:
                                _kept = []
                                for _ev in _evs:
                                    if not isinstance(_ev, dict):
                                        continue
                                    try:
                                        _efm = int(_ev.get("effective_from_message"))
                                    except Exception:
                                        _efm = -1
                                    if 0 <= _efm <= _cut:
                                        continue
                                    _kept.append(_ev)
                                _ctx[_key] = _kept
                        data["context"] = _ctx
                    except Exception as _e:
                        print(f"[CTX_LIMIT] prune events failed: {_e}")
            messages_before = len(data.get("messages", []) if isinstance(data.get("messages"), list) else [])

            # 预先记录 context（在追加 user 之前，effective_from_message 将为当前长度）
            if system_snapshot is not None:
                context_mod.record_system_snapshot(
                    data,
                    str(system_snapshot),
                    reason=system_reason,
                    effective_from_message=messages_before,
                )

            knowledge_delta = None

            if workspace_documents is not context_mod._UNSET or global_titles is not context_mod._UNSET:
                # delta 由本事务在轮次开头采样得出，是本轮知识库变更的唯一权威来源；
                # 调用方据此生成提示词注入，不得再自行维护基线（尾部回写会吞掉流式期间的变更）。
                knowledge_delta = context_mod.record_knowledge_state(
                    data,
                    workspace_documents=workspace_documents,
                    global_titles=global_titles,
                    effective_from_message=messages_before,
                    emit_event=messages_before > 0,
                )

            # 画像/技能基线与知识库同一事务采样：变更 delta 是本轮 tail 注入的唯一权威来源，
            # 基线推进与事件落库都发生在这里，model 层不做任何基线读写
            profile_delta = None

            if profile_text is not None:
                profile_delta = turn_state_mod.record_profile_state(
                    data,
                    str(profile_text),
                    effective_from_message=messages_before,
                    emit_event=messages_before > 0,
                )

            skill_delta = None

            if skill_samples is not None:
                skill_delta = turn_state_mod.record_skill_state(
                    data,
                    skill_samples,
                    effective_from_message=messages_before,
                    emit_event=messages_before > 0,
                )

            user_index = messages_mod.append_user_message(
                data,
                content,
                attachments=list(attachments or []),
            )

            # 追加一个占位的 assistant（streaming 状态），以固定 assistant_index
            # 若调用方不需要占位，可改为仅返回预留索引；此处采用占位以保证 finish 时严格写入同一位置
            placeholder = {
                "role": "assistant",
                "content": "",
                "status": "streaming",
                "model": {"name": "", "provider": ""},
                "summary": "",
                "usage": {"input": 0, "output": 0, "raw_input": 0, "cached_input": 0, "effective_input": 0},
                "trace": {"tool_calls": [], "tool_results": [], "content_segments": [], "errors": []},
                "versions": [],
            }
            assistant_index = messages_mod.append_assistant_message(data, placeholder)
            # 将占位改为 streaming 后，实际内容由 finish 时覆盖，此处先保留空
            # 保存
            validate_v4_conversation(data)
            safe_write_json(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)

            return {
                "user_index": int(user_index),
                "assistant_index": int(assistant_index),
                "visible_count": len(data.get("messages", [])),
                "knowledge_delta": knowledge_delta,
                "profile_delta": profile_delta,
                "skill_delta": skill_delta,
            }

    def finish_assistant_turn(
        self,
        conversation_id: str,
        message_index: int,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        with conversation_update_session(self.username, conversation_id) as (path, data):
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                data = normalize_v4_conversation(data)

            # 严格覆盖指定 assistant 位置，不做搜索
            messages = data.get("messages", []) if isinstance(data.get("messages"), list) else []
            try:
                idx = int(message_index)
            except Exception as error:
                raise ConversationIndexError(f"消息索引无效: {message_index}") from error
            if not (0 <= idx < len(messages)):
                raise ConversationIndexError(f"消息索引越界: index={idx}, message_count={len(messages)}")
            existing = messages[idx] if isinstance(messages[idx], dict) else {}
            if str(existing.get("role") or "").strip() != "assistant":
                from .errors import ConversationTargetRoleError as _RoleErr
                raise _RoleErr(
                    "finish_assistant_turn 目标必须是 assistant 占位",
                    details={"target_role": str(existing.get("role") or ""), "target_index": idx},
                )

            # 归一化 payload 并保留 versions
            old_versions = existing.get("versions", []) if isinstance(existing.get("versions"), list) else []
            new_payload = dict(payload or {})
            new_payload["role"] = "assistant"
            # 保留原占位的 versions
            if "versions" not in new_payload or not isinstance(new_payload.get("versions"), list):
                new_payload["versions"] = list(old_versions)
            else:
                # 合并
                combined = list(old_versions) + [v for v in new_payload.get("versions", []) if isinstance(v, dict)]
                # 去重
                seen = set()
                merged: List[Dict[str, Any]] = []
                for v in combined:
                    key = (str(v.get("timestamp") or ""), str(v.get("content") or "")[:200])
                    if key in seen:
                        continue
                    seen.add(key)
                    merged.append(v)
                new_payload["versions"] = merged

            from .schema import normalize_assistant_message as _norm_assist
            normalized = _norm_assist(new_payload)
            messages[idx] = normalized
            data["messages"] = messages
            from datetime import datetime as _dt
            data["updated_at"] = _dt.now().isoformat()
            validate_v4_conversation(data)
            safe_write_json(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)
            return copy.deepcopy(normalized)

    def update_assistant_partial(
        self,
        conversation_id: str,
        message_index: int,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """流式增量更新（仅更新 content/trace 部分，不改变 versions）。"""
        with conversation_update_session(self.username, conversation_id) as (path, data):
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                data = normalize_v4_conversation(data)
            messages = data.get("messages", []) if isinstance(data.get("messages"), list) else []
            try:
                idx = int(message_index)
            except Exception as error:
                raise ConversationIndexError(f"消息索引无效: {message_index}") from error
            if not (0 <= idx < len(messages)):
                raise ConversationIndexError(f"消息索引越界: index={idx}, message_count={len(messages)}")
            msg = messages[idx] if isinstance(messages[idx], dict) else {}
            if str(msg.get("role") or "").strip() != "assistant":
                from .errors import ConversationTargetRoleError as _RoleErr
                raise _RoleErr("update_assistant_partial 目标必须是 assistant", details={"target_index": idx})
            patch = dict(payload or {})
            # 仅允许部分字段
            if "content" in patch:
                from App.Utils import sanitize_assistant_visible_content as _san
                msg["content"] = _san(patch.get("content", ""))
            if "trace" in patch and isinstance(patch.get("trace"), dict):
                current_trace = msg.get("trace", {}) if isinstance(msg.get("trace"), dict) else {}
                for key, value in patch["trace"].items():
                    if isinstance(value, list) and isinstance(current_trace.get(key), list):
                        current_trace[key] = list(current_trace.get(key)) + list(value)
                    else:
                        current_trace[key] = value
                msg["trace"] = current_trace
            if "status" in patch:
                msg["status"] = str(patch.get("status") or "streaming").strip() or "streaming"
            if "model" in patch and isinstance(patch.get("model"), dict):
                msg["model"] = dict(patch.get("model"))
            messages[idx] = msg
            data["messages"] = messages
            from datetime import datetime as _dt
            data["updated_at"] = _dt.now().isoformat()
            validate_v4_conversation(data)
            safe_write_json(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)
            return copy.deepcopy(msg)

    # ------------------------------------------------------------------
    # 重答 / 编辑 / 删除 / 版本
    # ------------------------------------------------------------------
    def resolve_regenerate_target(self, conversation_id: str, message_index: int) -> Dict[str, Any]:
        data = self._load_v4(conversation_id)
        return messages_mod.resolve_regenerate_target(data, int(message_index))

    def validate_regenerate_target(self, conversation_id: str, message_index: int):
        """兼容旧 manager 签名：返回 (ok, message, meta)"""
        try:
            info = self.resolve_regenerate_target(conversation_id, message_index)
            return True, "ok", {
                "message_count": info.get("message_count"),
                "target_index": info.get("target_index"),
                "user_index": info.get("user_index"),
                "user_content": info.get("user_content"),
                "assistant_model_name": info.get("assistant_model_name"),
            }
        except Exception as e:
            return False, str(e), getattr(e, "details", {}) if hasattr(e, "details") else {}

    def replace_assistant(self, conversation_id: str, message_index: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        with conversation_update_session(self.username, conversation_id) as (path, data):
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                data = normalize_v4_conversation(data)
            result = messages_mod.replace_assistant_message(data, int(message_index), dict(payload or {}))
            validate_v4_conversation(data)
            safe_write_json(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)
            return result

    def edit_user_message(self, conversation_id: str, message_index: int, content: Any) -> None:
        with conversation_update_session(self.username, conversation_id) as (path, data):
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                data = normalize_v4_conversation(data)
            messages_mod.edit_user_message(data, int(message_index), content)
            validate_v4_conversation(data)
            safe_write_json(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)

    def delete_turn(self, conversation_id: str, message_index: int) -> Dict[str, Any]:
        with conversation_update_session(self.username, conversation_id) as (path, data):
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                data = normalize_v4_conversation(data)
            start, end = messages_mod.delete_turn(data, int(message_index))
            validate_v4_conversation(data)
            safe_write_json(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)
            return {"deleted_from": int(start), "deleted_to": int(end)}

    def save_message_version(self, conversation_id: str, message_index: int) -> None:
        with conversation_update_session(self.username, conversation_id) as (path, data):
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                data = normalize_v4_conversation(data)
            messages_mod.save_message_version(data, int(message_index))
            validate_v4_conversation(data)
            safe_write_json(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)

    def switch_message_version(self, conversation_id: str, message_index: int, version_index: int) -> None:
        with conversation_update_session(self.username, conversation_id) as (path, data):
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                data = normalize_v4_conversation(data)
            messages_mod.switch_message_version(data, int(message_index), int(version_index))
            validate_v4_conversation(data)
            safe_write_json(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)

    # ------------------------------------------------------------------
    # 系统快照 / 知识 / 压缩
    # ------------------------------------------------------------------
    def record_system_snapshot(
        self,
        conversation_id: str,
        snapshot: str | Dict[str, Any],
        *,
        effective_from_message: int | None = None,
    ) -> Dict[str, Any] | None:
        content = str(snapshot.get("content") if isinstance(snapshot, dict) else snapshot or "").strip()
        reason = str(snapshot.get("reason") if isinstance(snapshot, dict) else "chat_turn").strip() or "chat_turn"
        with conversation_update_session(self.username, conversation_id) as (path, data):
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                data = normalize_v4_conversation(data)
            result = context_mod.record_system_snapshot(
                data,
                content,
                reason=reason,
                effective_from_message=effective_from_message,
            )
            if result is None:
                return None
            validate_v4_conversation(data)
            safe_write_json(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)
            return result

    def record_knowledge_state(
        self,
        conversation_id: str,
        knowledge: Any = context_mod._UNSET,
        global_titles: Any = context_mod._UNSET,
    ) -> Dict[str, Any] | None:
        # 兼容旧：knowledge 可能是 list[docs] 或 dict；需区分未提供 vs 显式清空
        workspace_param: Any = context_mod._UNSET
        global_param: Any = context_mod._UNSET
        if knowledge is not context_mod._UNSET:
            if knowledge is None:
                workspace_param = []
            elif isinstance(knowledge, list):
                workspace_param = [dict(d) for d in knowledge if isinstance(d, dict)]
            elif isinstance(knowledge, dict):
                if "workspace" in knowledge or "documents" in knowledge:
                    if isinstance(knowledge.get("workspace"), list):
                        workspace_param = [dict(d) for d in knowledge.get("workspace", []) if isinstance(d, dict)]
                    elif isinstance(knowledge.get("documents"), list):
                        workspace_param = [dict(d) for d in knowledge.get("documents", []) if isinstance(d, dict)]
                    else:
                        workspace_param = []
                # global 可能在同一 dict 中
                if "global" in knowledge or "titles" in knowledge:
                    if isinstance(knowledge.get("global"), list):
                        global_param = [str(t) for t in knowledge.get("global", []) if str(t).strip()]
                    elif isinstance(knowledge.get("titles"), list):
                        global_param = [str(t) for t in knowledge.get("titles", []) if str(t).strip()]
                    else:
                        global_param = []
        if global_titles is not context_mod._UNSET:
            if global_titles is None:
                global_param = []
            elif isinstance(global_titles, list):
                global_param = [str(t) for t in global_titles if str(t).strip()]
            else:
                global_param = []

        with conversation_update_session(self.username, conversation_id) as (path, data):
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                data = normalize_v4_conversation(data)
            result = context_mod.record_knowledge_state(
                data,
                workspace_documents=workspace_param,
                global_titles=global_param,
            )
            if result is None:
                return None
            validate_v4_conversation(data)
            safe_write_json(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)
            return result

    def record_context_compression(self, conversation_id: str, marker: Dict[str, Any]) -> Dict[str, Any]:
        with conversation_update_session(self.username, conversation_id) as (path, data):
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                data = normalize_v4_conversation(data)
            result = context_mod.record_context_compression(data, dict(marker or {}))
            validate_v4_conversation(data)
            safe_write_json(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)
            return result

    def get_latest_compression(self, conversation_id: str) -> Dict[str, Any] | None:
        data = self._load_v4(conversation_id)
        return context_mod.get_latest_compression(data)

    def prune_turn_events_before(self, conversation_id: str, cut_index: int) -> int:
        """
        压缩换代：裁掉已被摘要覆盖的轮次事件（efm <= cut_index）。
        knowledge / profile / skill 三类事件同规则裁剪，返回裁掉的数量。
        efm > cut 的事件（含当前轮）保留；基线本身即为当前值，无需重置。
        """
        removed_total = 0

        with conversation_update_session(self.username, conversation_id) as (path, data):
            context = data.get("context") if isinstance(data.get("context"), dict) else {}

            for key in ("knowledge_events", "profile_events", "skill_events"):
                events = context.get(key)

                if not isinstance(events, list):
                    continue

                kept = []
                removed = 0

                for event in events:
                    if not isinstance(event, dict):
                        removed += 1
                        continue

                    # 注意：efm=0 是合法值（首轮），不能用 `or -1` 兜底，否则 0 被吞成 -1
                    try:
                        efm = int(event.get("effective_from_message"))
                    except (TypeError, ValueError):
                        efm = -1

                    if 0 <= efm <= int(cut_index):
                        removed += 1
                        continue

                    kept.append(event)

                if removed:
                    context[key] = kept
                    removed_total += removed

            if removed_total:
                data["context"] = context
                data["updated_at"] = datetime.now().isoformat()
                validate_v4_conversation(data)
                safe_write_json(path, data, indent=2)
                index_mod.sync_index_from_file(self.username, path, data)

            return removed_total

    # ------------------------------------------------------------------
    # Scope / Workspace / Learning
    # ------------------------------------------------------------------
    def get_scope(self, conversation_id: str) -> Dict[str, Any]:
        data = self._load_v4(conversation_id)
        return copy.deepcopy(data.get("scope", {}))

    def _validate_workspace_access(self, workspace_id: str) -> None:
        """校验 workspace 是否存在且当前用户有权限。空则视为清除，不校验。"""
        wid = str(workspace_id or "").strip()
        if not wid:
            return
        # 格式校验
        import re
        if not re.match(r"^[a-zA-Z0-9_-]{8,48}$", wid):
            from .errors import ConversationValidationError as _VE
            raise _VE(f"workspace_id 格式非法: {wid!r}")
        # 扫描所有用户的 workspaces 查找该 id
        import os as _os, json as _json
        from basis.Database import safe_read_json as _safe_read
        # 优先检查当前用户的 workspace
        found = False
        has_permission = False
        # 遍历 data/users/*/workspaces/*/workspace.json
        try:
            from .repository import _server_data_root
            users_root = _os.path.join(_server_data_root(), "users")
            if _os.path.isdir(users_root):
                for owner in _os.listdir(users_root):
                    ws_path = _os.path.join(users_root, owner, "workspaces", wid, "workspace.json")
                    if not _os.path.isfile(ws_path):
                        continue
                    payload = _safe_read(ws_path, default=None, ensure_dict=True)
                    if not isinstance(payload, dict):
                        continue
                    found = True
                    # 权限：owner 或 shared_users 包含当前用户
                    owner_user = str(payload.get("owner_username") or "").strip()
                    shared = payload.get("settings", {}) if isinstance(payload.get("settings"), dict) else {}
                    shared_users = shared.get("shared_users", []) if isinstance(shared.get("shared_users"), list) else []
                    if owner_user == self.username or self.username in [str(u or "").strip() for u in shared_users]:
                        has_permission = True
                        break
                    # 若 workspace 是 private 且当前用户非 owner/shared，则无权限
        except Exception:
            pass
        if not found:
            from .errors import ConversationValidationError as _VE
            raise _VE(f"workspace 不存在: {wid!r}")
        if not has_permission:
            from .errors import ConversationValidationError as _VE
            raise _VE(f"当前用户无权关联 workspace: {wid!r}")

    def set_workspace(self, conversation_id: str, workspace_id: str) -> Dict[str, Any]:
        wid = str(workspace_id or "").strip()
        # 服务层校验
        self._validate_workspace_access(wid)
        with conversation_update_session(self.username, conversation_id) as (path, data):
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                data = normalize_v4_conversation(data)
            scope = normalize_scope(data.get("scope"))
            scope["workspace_id"] = wid
            data["scope"] = scope
            from datetime import datetime as _dt
            data["updated_at"] = _dt.now().isoformat()
            validate_v4_conversation(data)
            safe_write_json(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)
            return copy.deepcopy(scope)

    def set_learning(self, conversation_id: str, learning_state: Dict[str, Any] | None) -> Dict[str, Any]:
        with conversation_update_session(self.username, conversation_id) as (path, data):
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                data = normalize_v4_conversation(data)
            scope = normalize_scope(data.get("scope"))
            learning = scope.get("learning", {}) if isinstance(scope.get("learning"), dict) else {}
            if learning_state is None:
                learning["enabled"] = False
                # 保留 ids 但标记关闭
            elif isinstance(learning_state, dict):
                # 兼容 lecture_id/course_id/course_title
                if "enabled" in learning_state:
                    learning["enabled"] = bool(learning_state.get("enabled"))
                elif learning_state:
                    learning["enabled"] = True
                for key in ("lecture_id", "course_id", "course_title"):
                    if key in learning_state:
                        learning[key] = str(learning_state.get(key) or "").strip()
                # 兼容 learning_course_id
                if "learning_course_id" in learning_state and not learning.get("course_id"):
                    learning["course_id"] = str(learning_state.get("learning_course_id") or "").strip()
                if learning.get("enabled") and "learning" not in [str(t).lower() for t in scope.get("tags", [])]:
                    tags = list(scope.get("tags", []))
                    tags.append("learning")
                    scope["tags"] = tags
                if not learning.get("enabled"):
                    # 关闭时移除 learning tag
                    scope["tags"] = [t for t in scope.get("tags", []) if str(t).lower() != "learning"]
            scope["learning"] = learning
            data["scope"] = scope
            from datetime import datetime as _dt
            data["updated_at"] = _dt.now().isoformat()
            validate_v4_conversation(data)
            safe_write_json(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)
            return copy.deepcopy(scope)

    # ------------------------------------------------------------------
    # 分支
    # ------------------------------------------------------------------
    def fork_conversation(self, conversation_id: str, message_index: int, title: str | None = None) -> Dict[str, Any]:
        source_data = self._load_v4(conversation_id)
        base_path = conversation_base_path(self.username)
        # 分配新 ID（与 create_conversation 相同逻辑）
        with get_path_lock(base_path):
            reserved: set[int] = set()
            if os.path.exists(base_path):
                for filename in os.listdir(base_path):
                    if not filename.endswith(".json") or filename == os.path.basename(conversation_index_path(self.username)):
                        continue
                    try:
                        reserved.add(int(filename[:-5]))
                    except ValueError:
                        continue
            new_id = str(max(reserved) + 1) if reserved else "1"

        new_data = branches_mod.fork_branch_data(source_data, int(message_index), new_id, title=title)
        # 归一化
        new_data = normalize_v4_conversation(new_data)
        self._save_v4(new_id, new_data)
        return {
            "conversation_id": str(new_id),
            "title": str(new_data.get("title")),
            "branch": copy.deepcopy(new_data.get("branch")),
        }

    # ------------------------------------------------------------------
    # 列表 / 迁移
    # ------------------------------------------------------------------
    def list_conversations(self) -> List[Dict[str, Any]]:
        return index_mod.list_conversations_sorted(self.username)

    def migrate_conversation(self, conversation_id: str, dry_run: bool = False) -> Dict[str, Any]:
        return migrate_conversation_file(self.username, conversation_id, dry_run=dry_run)

    def migrate_all(self, dry_run: bool = False) -> Dict[str, Any]:
        return migrate_all(self.username, dry_run=dry_run)

    # ------------------------------------------------------------------
    # 兼容投影
    # ------------------------------------------------------------------
    def get_message_process_steps(self, conversation_id: str, message_index: int) -> List[Dict[str, Any]]:
        data = self._load_v4(conversation_id)
        messages = data.get("messages", []) if isinstance(data.get("messages"), list) else []
        try:
            idx = int(message_index)
        except Exception:
            return []
        if not (0 <= idx < len(messages)):
            return []
        msg = messages[idx] if isinstance(messages[idx], dict) else {}
        trace = msg.get("trace", {}) if isinstance(msg.get("trace"), dict) else {}
        return telemetry_mod.extract_process_steps_from_trace(trace)

    # ------------------------------------------------------------------
    # 旧字段清理（供 server 层过渡调用）
    # ------------------------------------------------------------------
    def update_title(self, conversation_id: str, title: str) -> None:
        with conversation_update_session(self.username, conversation_id) as (path, data):
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                data = normalize_v4_conversation(data)
            data["title"] = str(title or "").strip() or "未命名对话"
            from datetime import datetime as _dt
            data["updated_at"] = _dt.now().isoformat()
            validate_v4_conversation(data)
            safe_write_json(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)

    def set_pin(self, conversation_id: str, pin: bool = True) -> None:
        with conversation_update_session(self.username, conversation_id) as (path, data):
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                data = normalize_v4_conversation(data)
            data["pin"] = bool(pin)
            from datetime import datetime as _dt
            data["updated_at"] = _dt.now().isoformat()
            validate_v4_conversation(data)
            safe_write_json(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)

    def delete_conversation(self, conversation_id: str) -> bool:
        path = conversation_file_path(self.username, conversation_id)
        if not os.path.exists(path):
            return False
        with get_path_lock(path):
            if os.path.exists(path):
                os.remove(path)
        index_mod.remove_from_index(self.username, conversation_id)
        return True

    def replace_conversation_messages(self, conversation_id: str, messages: List[Dict[str, Any]]) -> None:
        """显式替换可见消息列表（用于分支资产重写等），写入前完成标准化，确保读写一致"""
        if not isinstance(messages, list):
            raise ConversationValidationError("messages 必须是 list")
        with conversation_update_session(self.username, conversation_id) as (path, data):
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                data = normalize_v4_conversation(data)
            # 写入前统一标准化：白名单过滤与结构归一
            from .schema import normalize_user_message as _norm_user, normalize_assistant_message as _norm_assist
            normalized: List[Dict[str, Any]] = []
            for idx, m in enumerate(messages):
                if not isinstance(m, dict):
                    raise ConversationValidationError(f"messages[{idx}] 必须是 dict")
                role = str(m.get("role") or "").strip()
                if role == "user":
                    normalized.append(_norm_user(m))
                elif role == "assistant":
                    normalized.append(_norm_assist(m))
                else:
                    raise ConversationValidationError(f"messages[{idx}].role 非法: {role!r}")
            data["messages"] = normalized
            from datetime import datetime as _dt
            data["updated_at"] = _dt.now().isoformat()
            validate_v4_conversation(data)
            safe_write_json(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)

    # ------------------------------------------------------------------
    # 兼容旧调用（Deprecated）：仅为防止生产崩溃，内部转发至严格 API
    # ------------------------------------------------------------------
    def add_message(self, conversation_id: str, role: str, content: Any, metadata: Any = None, index: Any = None) -> int:
        """Deprecated: 兼容旧 PAPI/server 的 add_message，请新代码使用 begin_user_turn/finish_assistant_turn"""
        role = str(role or "").strip()
        if role == "user":
            if index is not None:
                raise ConversationIndexError("user 消息不支持 index 覆盖")
            # 明确的 append_user_message，不创建占位 assistant
            attachments = []
            if isinstance(metadata, dict) and isinstance(metadata.get("attachments"), list):
                attachments = list(metadata.get("attachments") or [])
            from .repository import conversation_update_session
            from .messages import append_user_message
            from basis.Database import safe_write_json as _safe_write
            from .schema import validate_v4_conversation as _validate
            with conversation_update_session(self.username, conversation_id) as (path, data):
                if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                    data = migrate_single_conversation_data(data)
                    data = normalize_v4_conversation(data)
                idx = append_user_message(data, content, attachments=attachments)
                _validate(data)
                _safe_write(path, data, indent=2)
                index_mod.sync_index_from_file(self.username, path, data)
                return int(idx)
        if role == "assistant":
            # 旧 assistant 的 metadata -> v4 payload 转换
            payload: Dict[str, Any] = {"content": str(content or "")}
            if isinstance(metadata, dict):
                if metadata.get("model_name"):
                    payload["model"] = {"name": str(metadata.get("model_name") or ""), "provider": str(metadata.get("provider") or "")}
                if metadata.get("exchange_summary"):
                    payload["summary"] = str(metadata.get("exchange_summary") or "")
                if isinstance(metadata.get("io_tokens"), dict):
                    io = metadata.get("io_tokens", {})
                    payload["usage"] = {"input": int(io.get("input") or 0), "output": int(io.get("output") or 0), "raw_input": int(io.get("raw_input") or 0), "cached_input": int(io.get("cached_input") or 0), "effective_input": int(io.get("effective_input") or 0)}
                if isinstance(metadata.get("process_steps"), list):
                    trace = telemetry_mod.build_trace_from_process_steps(metadata.get("process_steps"))
                    if trace.get("events"):
                        payload["trace"] = trace
                if metadata.get("terminal_error"):
                    terr = metadata.get("terminal_error")
                    payload["error"] = {"message": str(terr.get("content") or terr.get("message") or terr) if isinstance(terr, dict) else str(terr or "")}
                    payload["status"] = "error"
            if index is not None:
                self.replace_assistant(conversation_id, int(index), payload)
                return int(index)
            # 无 index 时追加
            # 需要先确保有 user 占位？直接追加 assistant
            from .repository import conversation_update_session
            from .messages import append_assistant_message
            from basis.Database import safe_write_json as _safe_write
            from .schema import validate_v4_conversation as _validate
            with conversation_update_session(self.username, conversation_id) as (path, data):
                if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                    data = migrate_single_conversation_data(data)
                    data = normalize_v4_conversation(data)
                idx = append_assistant_message(data, payload)
                _validate(data)
                _safe_write(path, data, indent=2)
                index_mod.sync_index_from_file(self.username, path, data)
                return int(idx)
        raise ConversationValidationError(f"不支持的 role: {role!r}")

    def update_conversation_fields(self, conversation_id: str, fields: Dict[str, Any]) -> None:
        """Deprecated: 兼容旧 server 的批量更新，请新代码使用 set_workspace/set_learning/update_title"""
        if not isinstance(fields, dict):
            raise ConversationValidationError("fields 必须是字典")
        # 显式拒绝 messages：必须使用 replace_conversation_messages
        if "messages" in fields:
            raise ConversationValidationError("messages 不能通过 update_conversation_fields 更新，请使用 replace_conversation_messages")
        # 仅允许白名单字段直接更新，其余通过 service 的明确 API
        allowed = {"title", "pin", "scope", "branch", "runtime"}
        deprecated_learning_keys = {"conversation_mode", "longterm", "tags", "metadata"}
        for k, v in fields.items():
            if k in deprecated_learning_keys:
                # 旧字段已废弃：映射到 v4 scope.learning，失败原样抛出，不静默
                if k == "tags" and isinstance(v, list):
                    self.set_learning(conversation_id, {"enabled": "learning" in [str(x).lower() for x in v]})
                elif k == "metadata" and isinstance(v, dict):
                    lecture_id = str(v.get("learning_lecture_id") or v.get("lecture_id") or "").strip()
                    course_id = str(v.get("learning_course_id") or v.get("course_id") or "").strip()
                    course_title = str(v.get("learning_course_title") or v.get("course_title") or "").strip()
                    learning_flag = v.get("learning")
                    if isinstance(learning_flag, dict):
                        lecture_id = lecture_id or str(learning_flag.get("lecture_id") or "").strip()
                        course_id = course_id or str(learning_flag.get("course_id") or "").strip()
                        course_title = course_title or str(learning_flag.get("course_title") or "").strip()
                    if lecture_id or course_id or course_title or learning_flag:
                        payload: Dict[str, Any] = {"enabled": True}
                        if lecture_id:
                            payload["lecture_id"] = lecture_id
                        if course_id:
                            payload["course_id"] = course_id
                        if course_title:
                            payload["course_title"] = course_title
                        self.set_learning(conversation_id, payload)
                elif k == "conversation_mode" and str(v or "").strip().lower() == "learning":
                    self.set_learning(conversation_id, {"enabled": True})
                continue
            if k not in allowed:
                raise ConversationValidationError(f"不支持的字段: {k!r}，请使用明确的 Service API")
            if k == "title":
                self.update_title(conversation_id, str(v or ""))
            elif k == "pin":
                self.set_pin(conversation_id, bool(v))
            elif k == "scope" and isinstance(v, dict):
                if "workspace_id" in v:
                    self.set_workspace(conversation_id, str(v.get("workspace_id") or ""))
                if "learning" in v and isinstance(v.get("learning"), dict):
                    self.set_learning(conversation_id, dict(v.get("learning") or {}))
            else:
                from .repository import conversation_update_session
                from basis.Database import safe_write_json as _safe_write
                from .schema import validate_v4_conversation as _validate
                with conversation_update_session(self.username, conversation_id) as (path, data):
                    if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                        data = migrate_single_conversation_data(data)
                        data = normalize_v4_conversation(data)
                    data[k] = v
                    from datetime import datetime as _dt
                    data["updated_at"] = _dt.now().isoformat()
                    _validate(data)
                    _safe_write(path, data, indent=2)
                    index_mod.sync_index_from_file(self.username, path, data)

    def update_message_metadata(self, conversation_id: str, message_index: int, metadata_patch: Dict[str, Any]) -> Dict[str, Any]:
        """Deprecated: 兼容 Memory 分析的 metadata 合并，新代码应使用 update_assistant_partial"""
        # 仅处理 memory 相关字段，其余转 trace
        patch = dict(metadata_patch or {})
        # 将 memory 字段映射为 trace 的扩展或直接合并
        # 保持与旧 manager 的行为：直接合并到 message 的 metadata（但 v4 已无 metadata）
        # 改为合并到 trace 的扩展字段
        from .repository import conversation_update_session
        from basis.Database import safe_write_json as _safe_write
        from .schema import validate_v4_conversation as _validate
        with conversation_update_session(self.username, conversation_id) as (path, data):
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                data = normalize_v4_conversation(data)
            msgs = data.get("messages", [])
            idx = int(message_index)
            if not (0 <= idx < len(msgs)):
                raise ConversationIndexError(f"索引越界 {idx}")
            msg = msgs[idx]
            allowed_memory_keys = {"memory_io_tokens", "memory_analysis"}
            unknown = [k for k in patch.keys() if k not in allowed_memory_keys]
            if unknown:
                raise ConversationValidationError(f"update_message_metadata 仅允许 {sorted(allowed_memory_keys)}，非法键: {unknown!r}")
            for k, v in patch.items():
                if k in ("memory_io_tokens", "memory_analysis"):
                    if "trace" not in msg or not isinstance(msg.get("trace"), dict):
                        msg["trace"] = {"tool_calls": [], "tool_results": [], "content_segments": [], "errors": []}
                    msg[k] = v
            msgs[idx] = msg
            data["messages"] = msgs
            from datetime import datetime as _dt
            data["updated_at"] = _dt.now().isoformat()
            _validate(data)
            _safe_write(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)
            return dict(patch)

    def get_last_response_id(self, conversation_id: str, current_model_name: str | None = None) -> str | None:
        data = self._load_v4(conversation_id)
        resume = (data.get("runtime", {}) or {}).get("resume")
        if not isinstance(resume, dict):
            return None
        resp = str(resume.get("response_id") or "").strip()
        model = str(resume.get("model") or "").strip()
        def _norm(v): return str(v or "").strip().lower()
        if _norm(current_model_name) and _norm(model) and _norm(current_model_name) != _norm(model):
            return None
        return resp or None

    def get_last_volc_response_id(self, conversation_id: str, current_model_name: str | None = None) -> str | None:
        return self.get_last_response_id(conversation_id, current_model_name)

    def update_last_response_id(self, conversation_id: str, response_id: str | None, model_name: str | None = None) -> None:
        from .repository import conversation_update_session
        from basis.Database import safe_write_json as _safe_write
        from .schema import validate_v4_conversation as _validate
        with conversation_update_session(self.username, conversation_id) as (path, data):
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                data = normalize_v4_conversation(data)
            runtime = data.get("runtime", {}) if isinstance(data.get("runtime"), dict) else {}
            if response_id is None:
                runtime["resume"] = None
            else:
                runtime["resume"] = {"response_id": str(response_id or "").strip(), "model": str(model_name or "").strip()}
            data["runtime"] = runtime
            from datetime import datetime as _dt
            data["updated_at"] = _dt.now().isoformat()
            _validate(data)
            _safe_write(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)

    def update_volc_response_id(self, conversation_id: str, response_id: str | None, model_name: str | None = None) -> None:
        return self.update_last_response_id(conversation_id, response_id, model_name)

    def update_assistant_analysis(self, conversation_id: str, message_index: int, analysis: Dict[str, Any], io_tokens: Dict[str, Any] | None = None) -> None:
        """写入 Memory 分析结果到 assistant 消息的 v4 明确字段 memory_analysis / memory_io_tokens"""
        with conversation_update_session(self.username, conversation_id) as (path, data):
            if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
                data = migrate_single_conversation_data(data)
                data = normalize_v4_conversation(data)
            msgs = data.get("messages", [])
            idx = int(message_index)
            if not (0 <= idx < len(msgs)):
                raise ConversationIndexError(f"索引越界 {idx}")
            msg = msgs[idx]
            if str(msg.get("role") or "").strip() != "assistant":
                raise ConversationValidationError("仅支持 assistant")
            # v4 明确字段：直接写入顶层并同步到 trace.extensions 以兼容旧读取
            msg["memory_analysis"] = dict(analysis or {})
            if io_tokens is not None:
                msg["memory_io_tokens"] = dict(io_tokens or {})
            else:
                msg.pop("memory_io_tokens", None)
            # 同步到 trace.extensions.memory_analysis（便于 normalize 兼容）
            trace = msg.get("trace", {}) if isinstance(msg.get("trace"), dict) else {}
            extensions = trace.get("extensions", {}) if isinstance(trace.get("extensions"), dict) else {}
            extensions["memory_analysis"] = dict(analysis or {})
            if io_tokens is not None:
                extensions["memory_io_tokens"] = dict(io_tokens or {})
            trace["extensions"] = extensions
            msg["trace"] = trace
            msgs[idx] = msg
            data["messages"] = msgs
            from datetime import datetime as _dt
            data["updated_at"] = _dt.now().isoformat()
            # 严格校验：memory_* 已在 ALLOWED_ASSISTANT_FIELDS 白名单内
            validate_v4_conversation(data)
            safe_write_json(path, data, indent=2)
            index_mod.sync_index_from_file(self.username, path, data)

    def get_conversation_usage(self, conversation_id: str) -> Dict[str, Any]:
        """会话级 usage 聚合（供 TokenUsage 统计使用，统一读取 v4 usage 兼容旧 metadata）"""
        data = self._load_v4(conversation_id)
        messages = data.get("messages", []) if isinstance(data.get("messages"), list) else []
        input_total = 0
        output_total = 0
        today_input = 0
        today_output = 0
        today_total = 0
        found = False
        from datetime import datetime as _dt
        import time as _time
        today_str = _time.strftime("%Y-%m-%d", _time.localtime())
        for msg in messages:
            if not isinstance(msg, dict):
                continue
            if str(msg.get("role") or "").strip() != "assistant":
                continue
            usage = msg.get("usage", {}) if isinstance(msg.get("usage"), dict) else {}
            if not usage:
                md = msg.get("metadata", {}) if isinstance(msg.get("metadata"), dict) else {}
                usage = md.get("io_tokens", {}) if isinstance(md.get("io_tokens"), dict) else {}
            if not isinstance(usage, dict):
                continue
            try:
                in_tok = int(usage.get("input") or 0)
                out_tok = int(usage.get("output") or 0)
            except Exception:
                continue
            if in_tok <= 0 and out_tok <= 0:
                continue
            found = True
            input_total += in_tok
            output_total += out_tok
            ts = str(msg.get("timestamp", "") or "")
            if ts.startswith(today_str):
                today_input += in_tok
                today_output += out_tok
                today_total += (in_tok + out_tok)
        return {
            "found": bool(found),
            "input_total": int(input_total),
            "output_total": int(output_total),
            "total": int(input_total + output_total),
            "today_input": int(today_input),
            "today_output": int(today_output),
            "today_total": int(today_total),
        }

    # ------------------------------------------------------------------
    # 兼容别名与下沉能力（供 server/Manager 纯转发，避免双重语义）
    # ------------------------------------------------------------------
    def get_message_count(self, conversation_id: str) -> int:
        return len(self.get_messages(conversation_id))

    def ensure_conversation_compatibility(self, conversation_id: str) -> Dict[str, Any]:
        return self.get_conversation(conversation_id)

    def get_conversation_header(self, conversation_id: str) -> Dict[str, Any]:
        data = self._load_v4(conversation_id)
        return {
            "conversation_id": str(data.get("conversation_id")),
            "title": str(data.get("title") or "未命名对话"),
            "created_at": data.get("created_at"),
            "updated_at": data.get("updated_at"),
            "pin": bool(data.get("pin", False)),
            "scope": copy.deepcopy(data.get("scope", {})),
            "branch": copy.deepcopy(data.get("branch")),
            "message_count": len(data.get("messages", []) if isinstance(data.get("messages"), list) else []),
        }

    def set_conversation_pin(self, conversation_id: str, pin: bool = True) -> None:
        return self.set_pin(conversation_id, pin=bool(pin))

    def update_conversation_title(self, conversation_id: str, title: str) -> None:
        return self.update_title(conversation_id, str(title or "").strip() or "未命名对话")

    def get_last_user_message_index(self, conversation_id: str) -> int:
        msgs = self.get_messages(conversation_id)
        for i in range(len(msgs) - 1, -1, -1):
            if str((msgs[i] or {}).get("role") or "").strip() == "user":
                return i
        return -1

    def get_last_system_snapshot(self, conversation_id: str) -> Dict[str, Any] | None:
        data = self._load_v4(conversation_id)
        snaps = (data.get("context", {}) or {}).get("system_snapshots", [])
        if isinstance(snaps, list) and snaps:
            last = snaps[-1]
            return {
                "role": "system",
                "content": last.get("content", ""),
                "timestamp": last.get("created_at", ""),
                "metadata": {"kind": "system_snapshot", "hash": last.get("hash", ""), "epoch": last.get("epoch", 0)},
            }
        return None

    def has_system_snapshot(self, conversation_id: str) -> bool:
        return self.get_last_system_snapshot(conversation_id) is not None

    def ensure_system_snapshot(self, conversation_id: str, system_text: str, reason: str = "", regenerate_index=None, insert_message=False):
        text = str(system_text or "").strip()
        if not text:
            return False, "", 0
        from .context import _system_hash

        new_hash = _system_hash(text)
        data = self._load_v4(conversation_id)
        snaps = (data.get("context", {}) or {}).get("system_snapshots", [])
        if snaps and str(snaps[-1].get("hash") or "") == new_hash:
            return False, new_hash, int(snaps[-1].get("epoch", 0) or 0)
        res = self.record_system_snapshot(conversation_id, {"content": text, "reason": reason or "chat_turn"})
        if res is None:
            return False, new_hash, int(snaps[-1].get("epoch", 0) or 0) if snaps else 0
        return True, new_hash, int(res.get("epoch", 0))

    def get_last_knowledge_snapshot(self, conversation_id: str) -> List[Dict[str, Any]]:
        data = self._load_v4(conversation_id)
        docs = (data.get("context", {}) or {}).get("knowledge", {}).get("workspace", {}).get("documents", [])
        return list(docs) if isinstance(docs, list) else []

    def ensure_knowledge_diff_snapshot(self, conversation_id: str, new_docs, max_diff_items=20, regenerate_index=None, insert_message=True):
        docs = [d for d in (new_docs or []) if isinstance(d, dict)]
        # 仅更新 workspace，global 保持 _UNSET 避免被清空
        from . import context as _ctx
        res = self.record_knowledge_state(conversation_id, docs, _ctx._UNSET)
        if res is None:
            return False, [], [], ""
        return True, res.get("ws_added", []), res.get("ws_removed", []), ""

    def get_last_global_knowledge_snapshot(self, conversation_id: str) -> List[Dict[str, Any]]:
        data = self._load_v4(conversation_id)
        titles = (data.get("context", {}) or {}).get("knowledge", {}).get("global", {}).get("titles", [])
        return [{"title": t} for t in (titles or [])]

    def ensure_global_knowledge_diff_snapshot(self, conversation_id: str, new_titles, max_diff_items=20, regenerate_index=None):
        titles: List[str] = []
        for item in (new_titles or []):
            if isinstance(item, dict):
                t = str(item.get("title") or "").strip()
                if t:
                    titles.append(t)
            elif isinstance(item, str) and item.strip():
                titles.append(item.strip())
        # 仅更新 global，workspace 保持 _UNSET 避免被清空
        from . import context as _ctx
        res = self.record_knowledge_state(conversation_id, _ctx._UNSET, titles)
        if res is None:
            return False, [], [], ""
        return True, [{"title": t} for t in res.get("global_added", [])], [{"title": t} for t in res.get("global_removed", [])], ""

    def _message_content_to_text(self, content: Any) -> str:
        if isinstance(content, list):
            texts: List[str] = []
            for seg in content:
                if isinstance(seg, dict) and str(seg.get("type") or "").strip() == "text":
                    texts.append(str(seg.get("text") or ""))
                elif isinstance(seg, str):
                    texts.append(seg)
            return "\n".join(texts)
        return str(content or "")

    def _serialize_context_messages(self, conversation_id: str) -> str:
        """统一序列化：role: content 行，三个上下文 API 共用同一文本坐标系"""
        msgs = self.get_messages(conversation_id)
        parts: List[str] = []
        for m in msgs:
            if not isinstance(m, dict):
                continue
            role = str(m.get("role") or "").strip() or "unknown"
            content_str = self._message_content_to_text(m.get("content"))
            parts.append(f"{role}: {content_str}")
        return "\n\n".join(parts)

    def _resolve_context_conversation_id(self, offset: Any = 0, conversation_id: str | None = None) -> str | None:
        # 允许 get_context_length(cid) 这种严格调用：offset 实际为 conversation_id 字符串
        if conversation_id is None and isinstance(offset, str):
            candidate = str(offset).strip()
            # 若 candidate 非纯数字且包含字母/下划线/连字符，视为 cid 而非 offset
            if candidate and not candidate.lstrip("-").isdigit():
                # 进一步判断：若 candidate 对应真实会话或包含非数字字符，视为 cid
                # 保守：字符串 cid 优先
                return candidate or None
            # 若为纯数字字符串，也可能是 offset，但严格 API 期望 conversation_id
            # 此时若 candidate 是数字 id，仍视为 cid
            if candidate:
                # 检查是否为已存在会话 id，若是则视为 cid
                try:
                    # 尝试直接视为 cid，若存在则返回
                    # 不展开索引扫描，仅按字符串处理
                    return candidate
                except Exception:
                    pass
        if conversation_id:
            return str(conversation_id).strip() or None
        try:
            off = int(offset) if not isinstance(offset, bool) else int(offset)
        except Exception:
            # offset 非法：交由上层严格校验，此处按 0 处理以兼容旧调用
            off = 0
        if off < 0:
            raise ConversationValidationError(f"offset 不能为负数: {off}")
        convs = self.list_conversations()
        if not convs or off >= len(convs):
            return None
        try:
            return str(convs[off].get("conversation_id") or "").strip() or None
        except Exception:
            return None

    def get_context_length(self, offset: Any = 0, conversation_id: str | None = None) -> int:
        # 新严格 API 委托至 context_reader；兼容旧 offset 形式保留但不再做猜测扫描
        # 若调用方传入 (conversation_id) 单参字符串，保持兼容
        if isinstance(offset, str) and conversation_id is None:
            # 严格单参：视为 conversation_id
            cid = str(offset).strip()
            if cid:
                from .context_reader import ConversationContextReader
                return ConversationContextReader(self.username).get_length(cid)
        # 兼容旧 offset 寻址：需要 conversation_id 明确或通过 offset 解析
        if conversation_id:
            from .context_reader import ConversationContextReader
            return ConversationContextReader(self.username).get_length(str(conversation_id).strip())
        # offset 形式：仍用统一序列化但校验 offset 合法性
        try:
            off = int(offset)
            if off < 0:
                raise ConversationValidationError(f"offset 不能为负数: {off}")
        except ConversationValidationError:
            raise
        except Exception:
            raise ConversationValidationError(f"offset 必须为 int，got {offset!r}")
        cid = self._resolve_context_conversation_id(off, None)
        if not cid:
            return 0
        from .context_reader import ConversationContextReader
        return ConversationContextReader(self.username).get_length(cid)

    def get_context(self, *a, **kw) -> str:
        """Deprecated context shim; strict parsing lives in compat/context_reader."""
        from .compat import legacy_get_context
        call_kwargs = dict(kw)
        call_kwargs["username"] = self.username
        return legacy_get_context(*a, **call_kwargs)

    def _legacy_get_context(self, *a, **kw) -> str:
        """
        兼容旧 tool 调用：get_context(offset, from_pos, to_pos, conversation_id)
        返回按字符范围切片的对话上下文文本（v4 messages 串联）。
        异常原样抛出，由工具执行器生成真实失败结果，不伪装为空。
        """
        # 解析位置参数，兼容多种调用签名
        offset = 0
        from_pos = 0
        to_pos = None
        conversation_id = None
        if len(a) >= 1:
            try:
                offset = int(a[0])
            except Exception:
                offset = 0
        if len(a) >= 2:
            try:
                from_pos = int(a[1])
            except Exception:
                from_pos = 0
        if len(a) >= 3:
            try:
                to_pos = int(a[2]) if a[2] is not None else None
            except Exception:
                to_pos = None
        if len(a) >= 4 and a[3] is not None:
            conversation_id = str(a[3]).strip() or None
        if "offset" in kw:
            try:
                offset = int(kw.get("offset", offset))
            except Exception:
                pass
        if "from_pos" in kw:
            try:
                from_pos = int(kw.get("from_pos", from_pos))
            except Exception:
                pass
        if "to_pos" in kw and kw.get("to_pos") is not None:
            try:
                to_pos = int(kw.get("to_pos"))
            except Exception:
                to_pos = None
        if "conversation_id" in kw and kw.get("conversation_id"):
            conversation_id = str(kw.get("conversation_id") or "").strip() or conversation_id
        cid = self._resolve_context_conversation_id(offset, conversation_id)
        if not cid:
            # 无对话：与 length 语义一致，返回空（调用方已传错误 offset，不属读取失败）
            return ""
        # 读取失败原样抛出，不返回 "" 伪装无内容
        full = self._serialize_context_messages(cid)
        # 字符范围切片
        try:
            fp = max(0, int(from_pos))
        except Exception:
            fp = 0
        if to_pos is None:
            sliced = full[fp:]
        else:
            try:
                tp = int(to_pos)
                if tp < 0:
                    sliced = full[fp:]
                else:
                    sliced = full[fp:tp]
            except Exception:
                sliced = full[fp:]
        # 限制单次返回，避免超大上下文撑爆模型
        if len(sliced) > 20000:
            sliced = sliced[:20000] + "\n\n...[truncated]..."
        return sliced

    def get_context_find_keyword(self, *a, **kw) -> str:
        """Deprecated context search shim; strict parsing lives in compat/context_reader."""
        from .compat import legacy_search
        call_kwargs = dict(kw)
        call_kwargs["username"] = self.username
        return legacy_search(*a, **call_kwargs)

    def _legacy_get_context_find_keyword(self, *a, **kw) -> str:
        """
        兼容旧 tool 调用：get_context_find_keyword(offset, keyword, range, conversation_id)
        按关键词在对话历史中搜索，返回命中的消息索引与上下文片段。
        """
        offset = 0
        keyword = ""
        window = 10
        conversation_id = None
        if len(a) >= 1:
            try:
                offset = int(a[0])
            except Exception:
                offset = 0
        if len(a) >= 2:
            keyword = str(a[1] or "").strip()
        if len(a) >= 3:
            try:
                window = int(a[2])
            except Exception:
                window = 10
        if len(a) >= 4 and a[3] is not None:
            conversation_id = str(a[3]).strip() or None
        if "offset" in kw:
            try:
                offset = int(kw.get("offset", offset))
            except Exception:
                pass
        if "keyword" in kw:
            keyword = str(kw.get("keyword") or keyword).strip()
        if "range" in kw:
            try:
                window = int(kw.get("range", window))
            except Exception:
                pass
        if "conversation_id" in kw and kw.get("conversation_id"):
            conversation_id = str(kw.get("conversation_id") or "").strip() or conversation_id
        if not keyword:
            return "关键词为空"
        cid = self._resolve_context_conversation_id(offset, conversation_id)
        if not cid:
            return "无对话或 offset 越界"
        # 读取失败原样抛出，不返回字符串伪装
        msgs = self.get_messages(cid)
        kw_lower = keyword.lower()
        hits: List[str] = []
        for idx, m in enumerate(msgs):
            if not isinstance(m, dict):
                continue
            content_str = self._message_content_to_text(m.get("content"))
            lower = content_str.lower()
            pos = lower.find(kw_lower)
            if pos == -1:
                continue
            # window 为上下文字符数，前后各 window*20 字符（兼容旧 range 语义）
            try:
                w = max(1, int(window))
            except Exception:
                w = 10
            radius = w * 80
            start = max(0, pos - radius)
            end = min(len(content_str), pos + len(keyword) + radius)
            snippet = content_str[start:end].replace("\n", " ").strip()
            if start > 0:
                snippet = "..." + snippet
            if end < len(content_str):
                snippet = snippet + "..."
            role = str(m.get("role") or "").strip()
            hits.append(f"[{idx}][{role}] ...{snippet}...")
            if len(hits) >= 20:
                break
        if not hits:
            return f"未找到关键词: {keyword}"
        header = f"关键词 '{keyword}' 命中 {len(hits)} 条："
        return header + "\n" + "\n".join(hits)

    def get_main_title(self, *a, **kw) -> str:
        return ""

    def get_recent_exchange_summaries(self, conversation_id: str, limit: int = 5) -> List[Dict[str, Any]]:
        msgs = self.get_messages(conversation_id)
        summaries: List[Dict[str, Any]] = []
        cur: Dict[str, Any] = {}
        for msg in msgs:
            if msg.get("role") == "user":
                cur = {"user": str(msg.get("content") or "")[:100]}
            elif msg.get("role") == "assistant" and msg.get("summary"):
                cur["summary"] = msg.get("summary")
                summaries.append(dict(cur))
                cur = {}
        return summaries[-limit:]

    def set_main_title(self, conversation_id: str, title: str) -> None:
        return self.update_title(conversation_id, str(title or ""))

    def restore_conversation(self, src: Dict[str, Any] | Any = None, original_conversation_id: str | None = None, title: str | None = None, **kw) -> str:
        """
        回收站恢复：校验并 normalize 回收站 payload，保留原 conversation_id，检查占用，文件锁内写入并同步 index。
        兼容两种调用：restore_conversation(src, original_id, title=...) / restore_conversation(payload=dict)
        成功返回 restored_conversation_id，失败抛异常由 server 决定是否删除回收站条目。
        """
        # 兼容位置参数与关键字
        payload = src
        if isinstance(kw.get("payload"), dict):
            payload = kw.get("payload")
        oid = str(original_conversation_id or kw.get("original_conversation_id") or kw.get("conversation_id") or "").strip()
        hint_title = str(title or kw.get("title") or "").strip()
        # 从 trash entry 中提取实际会话体
        raw = payload if isinstance(payload, dict) else {}
        # trash entry 结构：{type, conversation_id, payload: convo}
        inner = raw.get("payload") if isinstance(raw.get("payload"), dict) else None
        convo_data = inner if isinstance(inner, dict) else raw
        if not isinstance(convo_data, dict) or not convo_data:
            raise ConversationValidationError("回收站payload为空或格式错误")
        # 确定目标 conversation_id：优先 original_conversation_id，其次 payload 内的 id
        target_id = oid or str(convo_data.get("conversation_id") or raw.get("conversation_id") or "").strip()
        if not target_id:
            raise ConversationValidationError("回收站对话缺少原 conversation_id，无法恢复关系")
        if "/" in target_id or "\\" in target_id or ".." in target_id:
            raise ConversationValidationError(f"conversation_id 非法: {target_id!r}")
        # 若 hint 标题提供了，则覆盖
        if hint_title:
            convo_data = dict(convo_data)
            convo_data["title"] = hint_title
        # 校验并 normalize：旧版可能为非 v4，需迁移
        try:
            data = migrate_single_conversation_data(dict(convo_data))
            data = normalize_v4_conversation(data)
        except Exception as e:
            raise ConversationValidationError(f"回收站会话校验失败: {e}") from e
        # 强制保留原 id
        data["conversation_id"] = str(target_id).strip()
        # 检查 ID 是否被占用
        target_path = conversation_file_path(self.username, target_id)
        if os.path.exists(target_path):
            raise ConversationValidationError(f"conversation_id 已存在，无法恢复: {target_id}")
        # 文件锁内写入
        base_path = conversation_base_path(self.username)
        with get_path_lock(base_path):
            # 二次检查占用（锁内）
            if os.path.exists(target_path):
                raise ConversationValidationError(f"conversation_id 已存在，无法恢复: {target_id}")
            # 确保目录
            ensure_conversation_dir(self.username)
            validate_v4_conversation(data)
            safe_write_json(target_path, data, indent=2)
            index_mod.sync_index_from_file(self.username, target_path, data)
        return str(target_id)

    def update_user_message_content(self, *a, **kw) -> Any:
        # 兼容旧签名：(conv_id, idx, content, only_last?) 统一转 edit_user_message
        if len(a) >= 3 and isinstance(a[1], int):
            return self.edit_user_message(a[0], int(a[1]), a[2])
        return self.edit_user_message(*a, **kw)

    # ------------------------------------------------------------------
    # Puzzle 状态（v4 扩展顶层字段 puzzle_states）
    # ------------------------------------------------------------------
    def update_puzzle_state(self, conversation_id: str, puzzle_id: str, state: Dict[str, Any]) -> Dict[str, Any]:
        # 委托至 puzzle.py 单一生产实现（严格校验+原子写入）
        return puzzle_mod.update_puzzle_state(self.username, conversation_id, puzzle_id, state)

    def get_puzzle_states(self, conversation_id: str) -> Dict[str, Any]:
        return puzzle_mod.get_puzzle_states(self.username, conversation_id)

    def get_puzzle_state(self, conversation_id: str, puzzle_id: str) -> Dict[str, Any] | None:
        return puzzle_mod.get_puzzle_state(self.username, conversation_id, puzzle_id)
