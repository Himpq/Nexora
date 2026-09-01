"""
Nexora.basis.Model.Context — 模型上下文构建层

职责：构建模型请求的消息列表（system prompt + 历史消息）、上下文压缩、
上下文策略控制。从 context_manager.py 迁移，归入 basis.Model。

对外提供：
- ChatContextManager: 上下文管理器
- ChatContext / ChatContextMessage / ChatContextPolicy: 上下文模型
"""

from __future__ import annotations

import json
from enum import Enum
from typing import Any, Callable, Dict, Generator, List, Mapping, Optional, Set, Tuple

import sys as _sys
try:
    if hasattr(_sys.stdout, "reconfigure"):
        _sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(_sys.stderr, "reconfigure"):
        _sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from App.Utils import (
    sanitize_assistant_visible_content,
    strip_history_time_prefix_from_content,
    strip_history_time_prefix_text,
)
import prompts


CONTEXT_COMPRESSION_MAX_CHARS_DEFAULT = 60000
CONTEXT_COMPRESSION_MAX_CHARS_MIN = 600
CONTEXT_COMPRESSION_MAX_CHARS_MAX = 120000
CONTEXT_COMPRESSION_HISTORY_MAX_CHARS_DEFAULT = 1500000
CONTEXT_COMPRESSION_HISTORY_MAX_CHARS_MIN = 50000
CONTEXT_COMPRESSION_HISTORY_MAX_CHARS_MAX = 4000000


class ChatContextPolicy(Enum):
    """聊天上下文处理策略。"""

    LLM_COMPRESS = "llm_compress"
    TRUNCATE = "truncate"
    SLIDING_WINDOW = "sliding_window"
    NONE = "none"


class ChatContextMessage:
    """聊天上下文消息对象。"""

    def __init__(self, role: str, content: Any = "", raw: Optional[Dict[str, Any]] = None, **kwargs):
        self.raw = dict(raw) if isinstance(raw, dict) else None
        self.role = str(role or "").strip()
        self.content = content
        self.extra = dict(kwargs or {})

        if self.raw is not None:
            self.role = str(self.raw.get("role") or self.raw.get("type") or "").strip()
            self.content = self.raw.get("content", self.raw.get("output", self.raw.get("arguments", "")))

    def to_dict(self) -> Dict[str, Any]:
        if self.raw is not None:
            return dict(self.raw)

        message = {
            "role": self.role,
            "content": self.content,
        }
        message.update(self.extra)
        return message

    def text_length(self, stringify_content: Callable[[Any], str]) -> int:
        return len(str(stringify_content(self.content) or ""))


class ChatContext:
    """ChatDB 请求上下文对象。

    设计对齐 NexoraLearning 的 Context：调用侧向上下文 add 消息，
    请求前 prepare，最后 build 得到 provider 请求消息。
    """

    def __init__(
        self,
        *,
        max_chars: int = 0,
        policy: ChatContextPolicy = ChatContextPolicy.NONE,
        llm_compress_func: Optional[Callable[[str], str]] = None,
        stringify_content: Optional[Callable[[Any], str]] = None,
        strip_reasoning_func: Optional[Callable[[List[Dict[str, Any]]], List[Dict[str, Any]]]] = None,
        trace_meta: Optional[Mapping[str, Any]] = None,
    ):
        self.max_chars = int(max(0, max_chars or 0))
        self.policy = policy
        self._messages: List[ChatContextMessage] = []
        self._llm_compress_func = llm_compress_func
        self._stringify_content = stringify_content or (lambda value: str(value or ""))
        self._strip_reasoning_func = strip_reasoning_func
        self._trace_meta = dict(trace_meta or {})
        self._stats = {
            "total_input_chars": 0,
            "compression_count": 0,
            "truncation_count": 0,
        }

    def add(self, role: str, content: Any = "", **kwargs) -> ChatContextMessage:
        message = ChatContextMessage(role, content, **kwargs)
        self._messages.append(message)
        return message

    def add_raw(self, raw_message: Dict[str, Any]) -> ChatContextMessage:
        message = ChatContextMessage("", raw=raw_message)
        self._messages.append(message)
        return message

    def insert(self, index: int, role: str, content: Any = "", **kwargs) -> ChatContextMessage:
        message = ChatContextMessage(role, content, **kwargs)
        self._messages.insert(index, message)
        return message

    def get(self, index: int) -> Optional[ChatContextMessage]:
        try:
            return self._messages[index]
        except IndexError:
            return None

    def last(self) -> Optional[ChatContextMessage]:
        return self.get(-1)

    def count(self) -> int:
        return len(self._messages)

    def chars(self) -> int:
        return sum(message.text_length(self._stringify_content) for message in self._messages)

    def mark_degraded(self, reason: str, error: str = "") -> None:
        """公开标记上下文降级，供外部构建流程调用。"""
        self._trace_meta["context_degraded"] = True
        self._trace_meta["context_degraded_reason"] = str(reason or "")
        if error:
            self._trace_meta["context_degraded_error"] = str(error)
        self._stats["context_degraded"] = 1
        self._stats["context_degraded_reason"] = str(reason or "")

    def is_degraded(self) -> bool:
        return bool(self._trace_meta.get("context_degraded"))

    def diagnostics(self) -> Dict[str, Any]:
        return {
            "degraded": self.is_degraded(),
            "reason": str(self._trace_meta.get("context_degraded_reason") or ""),
            "error": str(self._trace_meta.get("context_degraded_error") or str(self._trace_meta.get("compression_error") or "")),
            "trace_meta": dict(self._trace_meta),
            "stats": dict(self._stats),
        }

    def build(self) -> List[Dict[str, Any]]:
        messages = [message.to_dict() for message in self._messages]

        if self._strip_reasoning_func:
            return self._strip_reasoning_func(messages)

        return messages

    def _get_system_and_other_messages(self) -> Tuple[List[ChatContextMessage], List[ChatContextMessage]]:
        system_messages = [message for message in self._messages if message.role == "system"]
        other_messages = [message for message in self._messages if message.role != "system"]
        return system_messages, other_messages

    def _build_compress_text(self, messages: List[ChatContextMessage]) -> str:
        rows: List[str] = []

        for message in messages:
            text = str(self._stringify_content(message.content) or "").strip()

            if text:
                rows.append(f"[{message.role}]: {text}")

        return "\n".join(rows).strip()

    def _select_active_tail_messages(self, messages: List[ChatContextMessage]) -> List[ChatContextMessage]:
        if not messages:
            return []

        last_message = messages[-1]

        if last_message.role == "user":
            return [last_message]

        if last_message.role == "assistant" and bool(last_message.extra.get("tool_calls")):
            return [last_message]

        if last_message.role == "tool":
            tail_start = len(messages) - 1

            while tail_start - 1 >= 0 and messages[tail_start - 1].role == "tool":
                tail_start -= 1

            if tail_start - 1 >= 0:
                prev_message = messages[tail_start - 1]

                if prev_message.role == "assistant" and bool(prev_message.extra.get("tool_calls")):
                    tail_start -= 1

            return messages[tail_start:]

        return []

    def _execute_llm_compress(self) -> bool:
        if self.max_chars <= 0 or self.chars() <= self.max_chars:
            return False

        if not self._llm_compress_func:
            raise RuntimeError("LLM compress function is not set.")

        system_messages, other_messages = self._get_system_and_other_messages()

        if len(other_messages) <= 1:
            return False

        retained_tail = self._select_active_tail_messages(other_messages)
        retained_count = len(retained_tail)
        messages_to_compress = other_messages[:-retained_count] if retained_count else list(other_messages)

        if not messages_to_compress:
            return False

        compress_text = self._build_compress_text(messages_to_compress)

        if not compress_text:
            return False

        compressed = str(self._llm_compress_func(compress_text) or "").strip()

        if not compressed:
            raise RuntimeError("LLM compression returned empty result.")

        summary_message = ChatContextMessage("assistant", f"[上下文压缩摘要]\n{compressed}")
        self._messages = system_messages + [summary_message] + list(retained_tail)
        self._stats["compression_count"] += 1
        return True

    def _execute_truncate(self) -> bool:
        if self.max_chars <= 0 or self.chars() <= self.max_chars:
            return False

        system_messages, other_messages = self._get_system_and_other_messages()

        while other_messages and self._messages_chars(system_messages + other_messages) > self.max_chars:
            if len(other_messages) <= 1:
                break

            other_messages.pop(0)

        self._messages = system_messages + other_messages
        self._stats["truncation_count"] += 1
        return True

    def _execute_sliding_window(self) -> bool:
        if self.max_chars <= 0 or self.chars() <= self.max_chars:
            return False

        system_messages, other_messages = self._get_system_and_other_messages()

        while len(other_messages) > 1 and self._messages_chars(system_messages + other_messages) > self.max_chars:
            other_messages.pop(0)

        self._messages = system_messages + other_messages
        self._stats["truncation_count"] += 1
        return True

    def _messages_chars(self, messages: List[ChatContextMessage]) -> int:
        return sum(message.text_length(self._stringify_content) for message in messages)

    def execute_policy(self) -> bool:
        if self.policy == ChatContextPolicy.LLM_COMPRESS:
            return self._execute_llm_compress()

        if self.policy == ChatContextPolicy.TRUNCATE:
            return self._execute_truncate()

        if self.policy == ChatContextPolicy.SLIDING_WINDOW:
            return self._execute_sliding_window()

        if self.policy == ChatContextPolicy.NONE:
            return False

        raise ValueError(f"Unknown context policy: {self.policy}")

    def prepare(self) -> bool:
        executed = self.execute_policy()
        self._stats["total_input_chars"] += self.chars()
        return executed

    def stats(self) -> Dict[str, Any]:
        return {
            **self._stats,
            "current_chars": self.chars(),
            "current_messages": self.count(),
            "policy": self.policy.value,
            "trace_meta": dict(self._trace_meta),
        }


class ChatContextManager:
    """聊天上下文管理器。

    负责把会话历史、压缩摘要、当前用户输入组装成模型请求上下文，
    并执行专用的上下文压缩模型轮次。
    """

    def __init__(self, model: Any):
        self.model = model

    def create_context(
        self,
        *,
        max_chars: int = 0,
        policy: ChatContextPolicy = ChatContextPolicy.NONE,
        llm_compress_func: Optional[Callable[[str], str]] = None,
        trace_meta: Optional[Mapping[str, Any]] = None,
    ) -> ChatContext:
        """创建一个 NexoraLearning 风格的上下文对象。"""
        return ChatContext(
            max_chars=max_chars,
            policy=policy,
            llm_compress_func=llm_compress_func,
            stringify_content=self.content_to_text_for_context_compression,
            strip_reasoning_func=self.model._strip_reasoning_content,
            trace_meta=trace_meta,
        )

    def build_initial_messages(
        self,
        user_msg: str,
        current_user_content: Any = None,
        use_responses_api: bool = False,
        allow_history_images: bool = True,
        include_context: bool = True,
        system_prompt_text: Optional[str] = None,
        system_injection_texts: Optional[List[str]] = None,
        history_end_index_exclusive: Optional[int] = None,
        current_user_index: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """构建模型首轮请求消息列表。

        current_user_index：当前轮 user 消息的绝对下标（begin_user_turn 的 user_index）。
        历史 diff 重建只覆盖严格早于它的变更，当前轮变更由 tail 注入，避免双重注入。
        """

        context = self.build_initial_context(
            user_msg=user_msg,
            current_user_content=current_user_content,
            use_responses_api=use_responses_api,
            allow_history_images=allow_history_images,
            include_context=include_context,
            system_prompt_text=system_prompt_text,
            system_injection_texts=system_injection_texts,
            history_end_index_exclusive=history_end_index_exclusive,
            current_user_index=current_user_index,
        )
        context.prepare()
        self.model.record_context_diagnostics(context.diagnostics())
        return context.build()

    def build_current_turn_messages(
        self,
        *,
        current_user_content: Any,
        system_injection_texts: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """构建续接缓存命中时只发送的增量：仅尾部易变块 + 新用户，头稳定块已在缓存中。

        消息顺序固定为「易变块（diff/沙箱/资源）→ 新用户」，配合 provider 的续接 ID，
        实际语义为 SystemPrompt_001 + 历史 + Diff Inject + 新用户，head 不重建。
        """

        volatile_markers = (
            "## Workspace Resource Index",
            "## Sandbox Files",
            "## Knowledge changed",
        )
        all_injections = self._normalize_system_injection_texts(system_injection_texts)
        volatile_injections = [
            t for t in all_injections if any(vm in t for vm in volatile_markers)
        ]
        messages: List[Dict[str, Any]] = []

        for text in volatile_injections:
            messages.append({"role": "system", "content": text})

        messages.append({"role": "user", "content": current_user_content})
        return messages

    def build_knowledge_diff_injection(self, knowledge_delta: Optional[Dict[str, Any]]) -> str:
        """把当前轮知识库变更格式化为 tail 注入块（head 保持基线不动）。

        delta 由 Conversation Manager（service.begin_user_turn）在同一事务内于轮次
        开头采样得出，与 context.knowledge_events 同源，是本轮变更的唯一权威来源。
        本方法只负责格式化，不做任何基线读写 —— 在流式结束后回写基线的做法会把
        「流式期间发生的变更」静默吞掉，导致下一轮 diff 恒为空。
        """

        if not isinstance(knowledge_delta, dict):
            return ""

        return self._build_knowledge_changed_text(
            list(knowledge_delta.get("ws_removed") or [])
            + list(knowledge_delta.get("global_removed") or []),
            list(knowledge_delta.get("ws_added") or [])
            + list(knowledge_delta.get("global_added") or []),
        )

    def _build_knowledge_event_block(self, event: Dict[str, Any]) -> str:
        """从已落库的 knowledge_event 重建 diff 注入块（历史回放用）。

        event 结构与轮次 delta 不同：added/removed 已是最终条目列表
        （global 为 [{"title": t}]，workspace 为文档 dict），直接格式化即可。
        """

        if not isinstance(event, dict):
            return ""

        return self._build_knowledge_changed_text(event.get("removed"), event.get("added"))

    def _build_knowledge_changed_text(self, removed_entries: Any, added_entries: Any) -> str:
        """统一把知识库变更条目格式化为注入块，保持 head 前缀稳定。"""

        removed = self._collect_knowledge_titles(removed_entries)
        added = self._collect_knowledge_titles(added_entries)

        if not added and not removed:
            return ""

        lines: List[str] = ["## Knowledge changed"]

        for title in removed:
            lines.append(f"- {title}")

        for title in added:
            lines.append(f"+ {title}")

        return "\n".join(lines).strip()

    def _collect_knowledge_titles(self, entries: Any) -> List[str]:
        """把 workspace 文档 dict 与 global 裸标题统一成去重后的标题列表。"""

        titles: List[str] = []
        seen: Set[str] = set()

        for entry in entries or []:
            title = self._knowledge_document_title(entry)

            if title and title not in seen:
                seen.add(title)
                titles.append(title)

        return titles

    def _knowledge_document_title(self, document: Any) -> str:
        """取知识库条目标题：workspace 文档是 dict，global 列表是裸标题字符串。"""

        if isinstance(document, dict):
            return str(document.get("title") or document.get("name") or "").strip()

        return str(document or "").strip()

    def _save_head_snapshot(self, model: Any, username: str, merged_head: str, history_count: int) -> None:
        """把本次构建的 head 快照写入会话 context.system_snapshots（主对话专用）。

        与 Conversation Manager 的 record_system_snapshot 语义一致（按 hash 去重），
        快照用于后续轮次复用 head，保证前缀缓存命中。
        """

        from basis.Conversation.repository import conversation_update_session as _cus_snap
        from basis.Database import safe_write_json as _swj_snap
        from basis.Conversation.schema import validate_v4_conversation as _v4c_snap
        from basis.Conversation import index as _idx_snap
        import hashlib as _hl_snap
        import time as _time_snap

        snap_hash = _hl_snap.sha256(merged_head.encode("utf-8")).hexdigest()[:16]
        with _cus_snap(username, model.conversation_id) as (_p_snap, _d_snap):
            _c_snap = _d_snap.get("context", {}) if isinstance(_d_snap.get("context"), dict) else {}
            _snaps = _c_snap.get("system_snapshots", []) if isinstance(_c_snap.get("system_snapshots"), list) else []
            if not _snaps or str(_snaps[-1].get("hash") or "") != snap_hash:
                _snaps.append({
                    "epoch": int(_time_snap.time()),
                    "hash": snap_hash,
                    "content": merged_head,
                    "effective_from_message": history_count,
                    "reason": "chat_turn",
                })
                _c_snap["system_snapshots"] = _snaps
                _d_snap["context"] = _c_snap
                from basis.Conversation.schema import normalize_context as _norm_ctx
                _d_snap["context"] = _norm_ctx(_c_snap)
                _v4c_snap(_d_snap)
                _swj_snap(_p_snap, _d_snap, indent=2)
                try:
                    _idx_snap.sync_index_from_file(username, _p_snap, _d_snap)
                except Exception:
                    pass

    def build_initial_context(
        self,
        user_msg: str,
        current_user_content: Any = None,
        use_responses_api: bool = False,
        allow_history_images: bool = True,
        include_context: bool = True,
        system_prompt_text: Optional[str] = None,
        system_injection_texts: Optional[List[str]] = None,
        history_end_index_exclusive: Optional[int] = None,
        current_user_index: Optional[int] = None,
    ) -> ChatContext:
        """构建并返回可继续 add/prepare/build 的上下文对象。纯排序器，不做内容变换。"""
        model = self.model
        # 纯排序器：compact 模式固定 off，内容已在外部归一化
        context_compact_mode = "off"
        effective_system_prompt = str(system_prompt_text or model.system_prompt or "").strip()
        context = self.create_context(
            policy=ChatContextPolicy.NONE,
            trace_meta={
                "flow": "chat_initial",
                "conversation_id": str(model.conversation_id or ""),
                "model_name": str(model.model_name or ""),
            },
        )

        history_messages: List[Dict[str, Any]] = []
        compression_marker: Optional[Dict[str, Any]] = None

        if include_context and model.conversation_id:
            # 优先使用 ConversationService
            svc = getattr(model, "conversation_service", None) or getattr(model, "conversation_manager", None)
            try:
                if svc is not None and hasattr(svc, "get_messages"):
                    history_messages = svc.get_messages(model.conversation_id)
                else:
                    history_messages = model.conversation_manager.get_messages(model.conversation_id)
            except Exception as e:
                print(f"[CONTEXT] get_messages 失败 conversation_id={model.conversation_id}: {e}")
                # 会话读取失败不应伪装为空历史，向上抛出以中止上下文构建
                raise

            try:
                if svc is not None and hasattr(svc, "get_latest_compression"):
                    compression_marker = svc.get_latest_compression(model.conversation_id)
                elif svc is not None and hasattr(svc, "get_latest_context_compression"):
                    compression_marker = svc.get_latest_context_compression(model.conversation_id)
                else:
                    compression_marker = model.conversation_manager.get_latest_context_compression(model.conversation_id)
            except Exception as e:
                print(f"[CONTEXT] get_latest_compression 失败 conversation_id={model.conversation_id}: {e}")
                compression_marker = None
                context.mark_degraded("compression_load_failed", str(e))
                model.record_context_diagnostics(context.diagnostics())

        history_messages = self._cut_history_for_regenerate(
            history_messages,
            history_end_index_exclusive,
        )
        history_messages = self._apply_latest_compression_marker(
            context,
            history_messages,
            compression_marker,
        )

        # 头尾契约（重构后）：头稳定可缓存（system主prompt + Skill + 画像/知识库基线），尾仅 diff/沙箱/资源
        # 顺序固定 头 + 历史 + 尾 + 新用户，保证 head+history 前缀可被 prefix cache 命中
        # LRU 快照：head 首次构建后存快照，后续复用快照保证前缀命中，diff 仅 tail 追加
        # 快照仅对主对话生效（persist_conversation）：记忆分析等子请求不得读写主对话快照
        volatile_markers = (
            "## Workspace Resource Index",
            "## Sandbox Files",
            "## Knowledge changed",
        )
        all_injections = self._normalize_system_injection_texts(system_injection_texts)
        stable_injections = [
            t for t in all_injections if not any(vm in t for vm in volatile_markers)
        ]
        volatile_injections = [
            t for t in all_injections if any(vm in t for vm in volatile_markers)
        ]

        # 尝试加载已存快照（LRU 命中关键）；仅主对话参与，避免子请求复用/污染 head
        # 顺带读取 knowledge_events，供历史回放时重建 diff（保证前缀稳定）
        snapshot_content: Optional[str] = None
        knowledge_events_raw: List[Dict[str, Any]] = []
        try:
            if model.persist_conversation and model.conversation_id:
                svc_snap = getattr(model, "conversation_service", None) or getattr(model, "conversation_manager", None)
                if svc_snap and hasattr(svc_snap, "_load_v4"):
                    snap_data = svc_snap._load_v4(model.conversation_id)
                    snaps = snap_data.get("context", {}).get("system_snapshots", [])
                    if isinstance(snaps, list) and snaps:
                        latest = snaps[-1] if isinstance(snaps[-1], dict) else {}
                        snapshot_content = str(latest.get("content") or "").strip() or None
                    raw_events = snap_data.get("context", {}).get("knowledge_events", [])
                    if isinstance(raw_events, list):
                        knowledge_events_raw = [e for e in raw_events if isinstance(e, dict)]
        except Exception:
            snapshot_content = None

        # 历史 diff 重建索引：按 effective_from_message 定位到生效的 user 消息前
        history_event_blocks: List[Tuple[int, str]] = []
        for event in knowledge_events_raw:
            try:
                efm = int(event.get("effective_from_message") or -1)
            except Exception:
                efm = -1
            if efm < 0:
                continue
            block = self._build_knowledge_event_block(event)
            if block:
                history_event_blocks.append((efm, block))
        history_event_blocks.sort(key=lambda item: item[0])

        if snapshot_content and history_messages:
            # 非首轮：复用快照保证 LRU 命中，head 不重建
            merged_head = snapshot_content
            if merged_head:
                context.add("system", merged_head)
        else:
            # 首轮或无快照：构建新 head 并存快照
            sanitized_head = str(effective_system_prompt or "").strip()
            head_parts: List[str] = []
            if sanitized_head:
                head_parts.append(sanitized_head)
            head_parts.extend(stable_injections)
            merged_head = "\n\n".join([p for p in head_parts if str(p or "").strip()]).strip()
            if merged_head:
                context.add("system", merged_head)
                # 存快照（仅主对话；子请求不参与，避免污染主对话 LRU 前缀）
                try:
                    if model.persist_conversation and model.conversation_id:
                        snap_username = str(getattr(model, "username", "") or "").strip()
                        if not snap_username:
                            snap_username = str(
                                getattr(getattr(model, "conversation_service", None), "username", "") or ""
                            ).strip()
                        if not snap_username:
                            print(f"[SNAPSHOT] skip save: missing username conversation_id={model.conversation_id}")
                        else:
                            self._save_head_snapshot(model, snap_username, merged_head, len(history_messages))
                except Exception as _e_snap:
                    print(f"[SNAPSHOT] save failed: {_e_snap}".replace("\xa0", " "))

        # 历史（V4 无 system 消息，仅 user/assistant）—— 紧跟 head，保证 head+history 前缀可缓存
        # 知识库 diff 按生效点回放：在 effective_from_message 指向的 user 消息之前插入，
        # 使任意轮次重建出的上下文与首次发送时一致，前缀缓存不因 diff 位置漂移而失效
        compression_cut_index = -1
        if compression_marker:
            try:
                compression_cut_index = int(compression_marker.get("history_cut_index", -1) or -1)
            except Exception:
                compression_cut_index = -1
        history_msg_cursor = compression_cut_index + 1 if compression_cut_index >= 0 else 0
        # 历史 diff 重建边界：只回放严格早于当前轮的变更（efm < 当前轮 user 下标），
        # 当前轮的变更由 tail 注入，避免「历史重建 + tail」双重注入
        history_event_boundary = current_user_index if current_user_index is not None else len(history_messages)
        history_event_idx = 0
        for item in history_messages:
            if (
                current_user_index is not None
                and history_msg_cursor >= current_user_index
            ):
                # 当前轮的 user 与占位 assistant 已由「尾部易变块 + 新 user」处理，
                # 跳过历史回放，保证 diff 固定在生效 user 之前、且只注入一次
                history_msg_cursor += 1
                continue
            if (
                history_event_idx < len(history_event_blocks)
                and history_event_blocks[history_event_idx][0] == history_msg_cursor
                and history_event_blocks[history_event_idx][0] < history_event_boundary
            ):
                context.add("system", history_event_blocks[history_event_idx][1])
                history_event_idx += 1
            self._add_history_item_to_context(
                context,
                item,
                use_responses_api=use_responses_api,
                allow_history_images=allow_history_images,
                context_compact_mode=context_compact_mode,
            )
            history_msg_cursor += 1

        # 尾部易变块：仅沙箱/资源索引等，紧跟历史之后、新用户之前
        for text in volatile_injections:
            context.add("system", text)

        final_user_content = current_user_content if current_user_content is not None else user_msg
        final_user_sig = model._content_signature_for_dedupe(
            self._normalize_current_turn_dedupe_content(final_user_content)
        )
        last_user = None
        for _idx in range(context.count() - 1, -1, -1):
            _cand = context.get(_idx)
            if _cand and _cand.role == "user":
                last_user = _cand
                break
        last_is_same_user = bool(
            last_user
            and model._content_signature_for_dedupe(
                self._normalize_current_turn_dedupe_content(last_user.content)
            ) == final_user_sig
        )

        if not last_is_same_user:
            final_user_content = self._inject_time_prefix_to_user_content(final_user_content, use_responses_api)
            context.add("user", final_user_content)

        try:
            print(f"[CTX_FINAL] roles={[m.role for m in context._messages]} hist={len(history_messages)} vol={len(volatile_injections)}".replace("\xa0"," "))
        except Exception:
            pass
        model.record_context_diagnostics(context.diagnostics())
        model._last_context = context
        return context

    def _normalize_system_injection_texts(self, system_injection_texts: Optional[List[str]]) -> List[str]:
        """规整当前轮运行时 system 注入块。"""
        if not isinstance(system_injection_texts, list):
            return []

        normalized: List[str] = []

        for item in system_injection_texts:
            text = str(item or "").strip()

            if text:
                normalized.append(text)

        return normalized

    def _inject_time_prefix_to_user_content(self, content: Any, use_responses_api: bool = False) -> Any:
        """为当前轮 user 内容单次注入 [TIME] 前缀（不入 system，确保前缀缓存）。"""
        from datetime import datetime

        time_marker = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        prefix = f"[TIME] {time_marker}\n"

        if content is None:
            return f"{prefix}"

        if isinstance(content, str):
            # 已带前缀则不重复
            if content.lstrip().startswith("[TIME]") or content.lstrip().startswith("[历史消息时间:"):
                return content

            return f"{prefix}{content}"

        if isinstance(content, list):
            # 多模态：前置文本块
            text_type = "input_text" if bool(use_responses_api) else "text"
            # 检查首块是否已含时间
            if content and isinstance(content[0], dict):
                first_text = str(content[0].get("text") or content[0].get("content") or "")
                if first_text.lstrip().startswith("[TIME]") or first_text.lstrip().startswith("[历史消息时间:"):
                    return content

            return [{ "type": text_type, "text": prefix.rstrip() }] + list(content)

        # 其他类型转字符串
        text = str(content)
        if text.lstrip().startswith("[TIME]") or text.lstrip().startswith("[历史消息时间:"):
            return text

        return f"{prefix}{text}"

    def _add_history_item_to_context(
        self,
        context: ChatContext,
        item: Dict[str, Any],
        *,
        use_responses_api: bool,
        allow_history_images: bool,
        context_compact_mode: str,
    ) -> None:
        """把单条持久化历史消息转换为模型协议消息。"""
        if not isinstance(item, dict):
            return

        role = str(item.get("role", "") or "").strip()

        # DSH 式增量存储：history 中已包含 system 快照，直接还原
        if role == "system":
            content = item.get("content", "")
            # 系统快照为纯文本，无需图片/压缩处理
            normalized = self._normalize_history_content(content)

            if normalized is None:
                return

            # 保留原始文本，不做 compact，避免哈希漂移
            context.add("system", normalized)
            return

        if role not in ("user", "assistant"):
            return

        if role == "assistant":
            expanded_messages = self._build_assistant_history_messages(
                item,
                use_responses_api=use_responses_api,
                context_compact_mode=context_compact_mode,
            )

            if expanded_messages:
                for message in expanded_messages:
                    self._add_protocol_message_to_context(context, message)

                return

        normalized = self._normalize_history_message_content(
            item,
            use_responses_api=use_responses_api,
            allow_history_images=allow_history_images,
        )

        if normalized is None:
            return

        # 纯排序器：不做 compact/sanitize，时间标记为唯一例外（保证时序可追溯）
        if role == "user":
            metadata = item.get("metadata", {}) if isinstance(item.get("metadata", {}), dict) else {}
            time_marker = str(metadata.get("time_marker") or metadata.get("time") or "").strip()

            if not time_marker:
                ts_raw = str(item.get("timestamp") or "").strip()
                if ts_raw:
                    try:
                        from datetime import datetime

                        dt = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
                        time_marker = dt.strftime("%Y-%m-%d %H:%M:%S")
                    except Exception:
                        time_marker = ""

            if time_marker:
                if isinstance(normalized, str):
                    normalized = f"[TIME] {time_marker}\n{normalized}"
                elif isinstance(normalized, list):
                    time_text = f"[TIME] {time_marker}\n"
                    text_type = "input_text" if bool(use_responses_api) else "text"
                    normalized = [{"type": text_type, "text": time_text}] + list(normalized)

        context.add(role, normalized)

    def _normalize_history_message_content(
        self,
        item: Dict[str, Any],
        *,
        use_responses_api: bool,
        allow_history_images: bool,
    ) -> Any:
        role = str(item.get("role", "") or "").strip()
        content = item.get("content", "")
        metadata = item.get("metadata", {}) if isinstance(item.get("metadata", {}), dict) else {}
        image_urls = []
        model = self.model

        if role == "user" and allow_history_images and model.conversation_id:
            image_urls = model._collect_history_attachment_image_urls(metadata, model.conversation_id)

        if image_urls:
            normalized = model._build_user_content_payload(content, image_urls, use_responses_api)

            if not isinstance(normalized, list) or not normalized:
                return None

            stripped_normalized = self._strip_system_injection_from_content(normalized)

            if isinstance(stripped_normalized, list) and not stripped_normalized:
                return None

            return stripped_normalized

        stripped_content = self._strip_system_injection_from_content(content)
        return self._normalize_history_content(stripped_content)

    def _add_protocol_message_to_context(self, context: ChatContext, message: Dict[str, Any]) -> None:
        if not isinstance(message, dict):
            return

        role = str(message.get("role", "") or "").strip()

        if role:
            extra = {
                key: value
                for key, value in message.items()
                if key not in {"role", "content"}
            }
            context.add(role, message.get("content", ""), **extra)
            return

        context.add_raw(message)

    def _strip_system_injection_from_content(self, content: Any) -> Any:
        """剥离历史内容中的运行时 system 注入块。"""
        if isinstance(content, str):
            return self._strip_system_injection_text(content)

        text_item_types = {"text", "input_text", "output_text"}

        if isinstance(content, list):
            stripped_items: List[Any] = []

            for item in content:
                if isinstance(item, str):
                    stripped_text = self._strip_system_injection_text(item)

                    if stripped_text.strip():
                        stripped_items.append(stripped_text)

                    continue

                if not isinstance(item, dict):
                    stripped_items.append(item)
                    continue

                item_copy = dict(item)
                item_type = str(item_copy.get("type", "") or "").strip().lower()

                if isinstance(item_copy.get("text"), str):
                    item_copy["text"] = self._strip_system_injection_text(item_copy.get("text", ""))

                if isinstance(item_copy.get("content"), str):
                    item_copy["content"] = self._strip_system_injection_text(item_copy.get("content", ""))

                if (
                    (item_type in text_item_types or self._is_text_only_payload(item_copy))
                    and not self._has_visible_text_payload(item_copy)
                ):
                    continue

                stripped_items.append(item_copy)

            return stripped_items

        if isinstance(content, dict):
            item_copy = dict(content)
            item_type = str(item_copy.get("type", "") or "").strip().lower()

            if isinstance(item_copy.get("text"), str):
                item_copy["text"] = self._strip_system_injection_text(item_copy.get("text", ""))

            if isinstance(item_copy.get("content"), str):
                item_copy["content"] = self._strip_system_injection_text(item_copy.get("content", ""))

            if (
                (item_type in text_item_types or self._is_text_only_payload(item_copy))
                and not self._has_visible_text_payload(item_copy)
            ):
                return None

            return item_copy

        return content

    def _has_visible_text_payload(self, item: Dict[str, Any]) -> bool:
        """判断文本协议节点剥离系统注入后是否仍有可见文本。"""
        for key in ("text", "content"):
            value = item.get(key)

            if isinstance(value, str) and value.strip():
                return True

        return False

    def _is_text_only_payload(self, item: Dict[str, Any]) -> bool:
        """识别没有显式 type 但只承载 text/content 的历史节点。"""
        if not any(key in item for key in ("text", "content")):
            return False

        return all(key in {"type", "text", "content"} for key in item.keys())

    def _normalize_current_turn_dedupe_content(self, content: Any) -> Any:
        """统一当前用户消息与已持久化历史消息的去重口径。"""
        stripped = self._strip_system_injection_from_content(content)
        return self._strip_history_time_prefix_from_content(stripped)

    def _strip_history_time_prefix_from_content(self, content: Any) -> Any:
        return strip_history_time_prefix_from_content(content)

    def _strip_history_time_prefix_text(self, text: str) -> str:
        return strip_history_time_prefix_text(text)

    def _strip_system_injection_text(self, text: str) -> str:
        value = str(text or "")
        injection_markers = (
            "[系统注入]",
            "## Skill Instructions",
            "## Learning Context",
            "## Workspace Operating Contract",
            "## Workspace Mode",
            "## Workspace Memory Context",
            "## Workspace Custom Instructions",
            "## Workspace Knowledge Index",
            "## Workspace Resource Index",
            "## Current Turn Memory Check",
            "## Sandbox Files",
            "## Longdoc Skill Catalog",
            "[可按需读取的 Longdoc Skill]",
        )

        for marker in injection_markers:
            if value.startswith(marker):
                return ""

        marker_positions = [
            value.find(f"\n\n{marker}")
            for marker in injection_markers
            if value.find(f"\n\n{marker}") >= 0
        ]

        if not marker_positions:
            return value

        return value[:min(marker_positions)].rstrip()

    def _build_assistant_history_messages(
        self,
        item: Dict[str, Any],
        *,
        use_responses_api: bool,
        context_compact_mode: str,
    ) -> List[Dict[str, Any]]:
        metadata = item.get("metadata", {}) if isinstance(item.get("metadata", {}), dict) else {}
        process_steps = metadata.get("process_steps", []) if isinstance(metadata.get("process_steps"), list) else []

        # 架构兼容：v4 存储为 trace，历史回放需投影为 process_steps
        if not process_steps:
            trace = item.get("trace", {}) if isinstance(item.get("trace"), dict) else {}

            if isinstance(trace, dict) and trace.get("events"):
                try:
                    from basis.Conversation.telemetry import extract_process_steps_from_trace

                    projected = extract_process_steps_from_trace(trace)
                    if isinstance(projected, list) and projected:
                        process_steps = projected
                except Exception:
                    process_steps = []

        if not isinstance(process_steps, list) or not process_steps:
            return []

        groups, final_content = self._extract_tool_trace_groups(process_steps)

        if not groups:
            return []

        messages: List[Dict[str, Any]] = []
        model = self.model

        for group in groups:
            calls = group.get("calls", [])
            results = group.get("results", [])

            if not calls or not results:
                print("[CTX_HISTORY_TOOL_TRACE] skip incomplete assistant tool group")
                continue

            # 纯回放：intro 保持原样，不做 compact/sanitize
            protocol_messages = self._build_tool_protocol_messages(
                calls=calls,
                results=results,
                intro_content=group.get("content", ""),
                use_responses_api=use_responses_api,
                context_compact_mode=context_compact_mode,
            )
            messages.extend(protocol_messages)

        # 最终 assistant 文本：保持落库原样，不做二次清洗
        if final_content and str(final_content).strip():
            messages.append({"role": "assistant", "content": final_content})

        return messages

    def _extract_tool_trace_groups(
        self,
        process_steps: List[Dict[str, Any]],
    ) -> Tuple[List[Dict[str, Any]], str]:
        groups: List[Dict[str, Any]] = []
        pending_content_parts: List[str] = []
        active_group: Optional[Dict[str, Any]] = None
        active_round: Optional[int] = None
        saw_group = False

        def flush_group() -> None:
            nonlocal active_group, active_round, saw_group

            if active_group is None:
                return

            if active_group.get("calls") and active_group.get("results"):
                groups.append(active_group)
                saw_group = True
            else:
                print("[CTX_HISTORY_TOOL_TRACE] drop incomplete tool trace group")

            active_group = None
            active_round = None

        for raw_step in process_steps:
            if not isinstance(raw_step, dict):
                continue

            step_type = str(raw_step.get("type", "") or "").strip()
            step_round = self._safe_step_round(raw_step)

            if step_type == "content":
                flush_group()

                content = str(raw_step.get("content", "") or "").strip()

                if content:
                    pending_content_parts.append(content)

                continue

            if step_type == "function_call":
                if (
                    active_group is not None
                    and active_round is not None
                    and step_round is not None
                    and step_round != active_round
                ):
                    flush_group()

                if active_group is None:
                    active_group = {
                        "content": "\n".join(pending_content_parts).strip(),
                        "calls": [],
                        "results": [],
                    }
                    pending_content_parts = []
                    active_round = step_round

                call = self._normalize_tool_call_step(raw_step)

                if call:
                    active_group["calls"].append(call)

                continue

            if step_type == "function_result":
                if active_group is None:
                    print("[CTX_HISTORY_TOOL_TRACE] skip function_result without active call")
                    continue

                result = self._normalize_tool_result_step(raw_step)

                if result:
                    active_group["results"].append(result)

                continue

        flush_group()

        if saw_group:
            return groups, "\n".join(pending_content_parts).strip()

        return groups, ""

    def _safe_step_round(self, step: Dict[str, Any]) -> Optional[int]:
        raw_round = step.get("round", None)

        if raw_round is None:
            return None

        try:
            return int(raw_round)
        except Exception:
            return None

    def _normalize_tool_call_step(self, step: Dict[str, Any]) -> Optional[Dict[str, str]]:
        name = str(step.get("name", "") or "").strip()
        call_id = str(step.get("call_id", "") or "").strip()
        arguments = str(step.get("arguments", "{}") or "{}")

        if not name or not call_id:
            print("[CTX_HISTORY_TOOL_TRACE] skip function_call missing name or call_id")
            return None

        return {
            "name": name,
            "call_id": call_id,
            "arguments": arguments,
        }

    def _normalize_tool_result_step(self, step: Dict[str, Any]) -> Optional[Dict[str, str]]:
        call_id = str(step.get("call_id", "") or "").strip()
        result = step.get("model_visible_result", step.get("result", ""))

        if not call_id:
            print("[CTX_HISTORY_TOOL_TRACE] skip function_result missing call_id")
            return None

        return {
            "call_id": call_id,
            "result": str(result or ""),
        }

    def _build_tool_protocol_messages(
        self,
        *,
        calls: List[Dict[str, str]],
        results: List[Dict[str, str]],
        intro_content: Any,
        use_responses_api: bool,
        context_compact_mode: str,
    ) -> List[Dict[str, Any]]:
        result_by_call_id = {
            str(item.get("call_id", "") or ""): str(item.get("result", "") or "")
            for item in results
            if str(item.get("call_id", "") or "").strip()
        }
        missing_results = [
            str(call.get("call_id", "") or "")
            for call in calls
            if str(call.get("call_id", "") or "") not in result_by_call_id
        ]

        if missing_results:
            print(
                "[CTX_HISTORY_TOOL_TRACE] skip tool group missing results: "
                + ",".join(missing_results)
            )
            return []

        if use_responses_api:
            return self._build_responses_tool_protocol_messages(
                calls=calls,
                result_by_call_id=result_by_call_id,
                intro_content=intro_content,
                context_compact_mode=context_compact_mode,
            )

        return self._build_chat_tool_protocol_messages(
            calls=calls,
            result_by_call_id=result_by_call_id,
            intro_content=intro_content,
            context_compact_mode=context_compact_mode,
        )

    def _build_chat_tool_protocol_messages(
        self,
        *,
        calls: List[Dict[str, str]],
        result_by_call_id: Dict[str, str],
        intro_content: Any,
        context_compact_mode: str,
    ) -> List[Dict[str, Any]]:
        model = self.model
        assistant_message = model.provider_adapter.build_assistant_tool_call_message(
            function_calls=calls,
            round_content=str(intro_content or ""),
        )
        messages: List[Dict[str, Any]] = []

        if isinstance(assistant_message, dict) and assistant_message:
            messages.append(assistant_message)

        for call in calls:
            call_id = str(call.get("call_id", "") or "").strip()
            # 工具结果保持落库原样，不做 compact，保证三轮一致
            raw_result = result_by_call_id.get(call_id, "")
            messages.append(
                model.provider_adapter.build_function_output_message(
                    call_id=call_id,
                    result=str(raw_result or ""),
                    use_responses_api=False,
                )
            )

        return messages

    def _build_responses_tool_protocol_messages(
        self,
        *,
        calls: List[Dict[str, str]],
        result_by_call_id: Dict[str, str],
        intro_content: Any,
        context_compact_mode: str,
    ) -> List[Dict[str, Any]]:
        model = self.model
        messages: List[Dict[str, Any]] = []
        intro_text = str(intro_content or "").strip()

        if intro_text:
            messages.append({"role": "assistant", "content": intro_text})

        for call in calls:
            call_id = str(call.get("call_id", "") or "").strip()
            messages.append({
                "type": "function_call",
                "call_id": call_id,
                "name": str(call.get("name", "") or "").strip(),
                "arguments": str(call.get("arguments", "{}") or "{}"),
            })
            raw_result = result_by_call_id.get(call_id, "")
            messages.append(
                model.provider_adapter.build_function_output_message(
                    call_id=call_id,
                    result=str(raw_result or ""),
                    use_responses_api=True,
                )
            )

        return messages

    def _cut_history_for_regenerate(
        self,
        history_messages: List[Dict[str, Any]],
        history_end_index_exclusive: Optional[int],
    ) -> List[Dict[str, Any]]:
        """按重新生成分支截断历史。"""
        if not history_messages or history_end_index_exclusive is None:
            return history_messages

        try:
            cut_end = int(history_end_index_exclusive)
        except Exception:
            return history_messages

        if cut_end <= 0:
            return []

        return history_messages[:cut_end]

    def _apply_latest_compression_marker(
        self,
        context: ChatContext,
        history_messages: List[Dict[str, Any]],
        compression_marker: Optional[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """把最近一次压缩摘要作为旧历史替代上下文注入。"""
        if not compression_marker or not isinstance(compression_marker, dict):
            return history_messages

        try:
            summary_text = self._strip_history_time_prefix_text(
                str(compression_marker.get("summary", "") or "").strip()
            )
            cut_index = int(compression_marker.get("history_cut_index", -1) or -1)
        except Exception:
            summary_text = ""
            cut_index = -1

        if not summary_text or cut_index < 0 or not history_messages:
            return history_messages

        if cut_index >= len(history_messages):
            return history_messages

        memory_block = self.build_context_compression_memory_block(summary_text)

        if memory_block:
            context.add("system", memory_block)

        return history_messages[cut_index + 1:]

    def _normalize_history_content(self, content: Any) -> Any:
        """把历史内容规整成可放入模型消息的内容。"""
        if content is None:
            return None

        if isinstance(content, str):
            if not content.strip():
                return None

            return content

        if isinstance(content, list):
            if not content:
                return None

            return content

        if isinstance(content, dict):
            if not content:
                return None

            return content

        normalized = str(content)

        if not normalized.strip():
            return None

        return normalized

    def content_to_text_for_context_compression(self, content: Any) -> str:
        """将多模态消息内容转换为可压缩的纯文本表达。"""
        if content is None:
            return ""

        if isinstance(content, str):
            return content

        if isinstance(content, list):
            parts: List[str] = []

            for item in content:
                if isinstance(item, str):
                    if item.strip():
                        parts.append(item)

                    continue

                if not isinstance(item, dict):
                    continue

                item_type = str(item.get("type", "") or "").strip().lower()

                if item_type in {"text", "input_text", "output_text"}:
                    text_val = item.get("text")

                    if text_val is not None and str(text_val).strip():
                        parts.append(str(text_val))

                    continue

                if item_type in {"image_url", "input_image"}:
                    parts.append("[image]")
                    continue

                if item_type in {"input_file", "file"}:
                    file_id = str(item.get("file_id", "") or item.get("id", "") or "").strip()
                    parts.append(f"[file]{':' + file_id if file_id else ''}")
                    continue

                if isinstance(item.get("text"), str) and str(item.get("text")).strip():
                    parts.append(str(item.get("text")))
                    continue

                if isinstance(item.get("content"), str) and str(item.get("content")).strip():
                    parts.append(str(item.get("content")))

            if parts:
                return "\n".join(parts).strip()

            return self._json_or_text(content)

        if isinstance(content, dict):
            if isinstance(content.get("text"), str):
                return str(content.get("text") or "")

            if isinstance(content.get("content"), str):
                return str(content.get("content") or "")

            return self._json_or_text(content)

        return str(content)

    def _json_or_text(self, value: Any) -> str:
        try:
            return json.dumps(value, ensure_ascii=False, default=str)
        except Exception:
            return str(value)

    def build_context_compression_memory_block(self, summary_text: str) -> str:
        """构建压缩摘要注入块。"""
        summary = str(summary_text or "").strip()

        if not summary:
            return ""

        return (
            "[历史上下文压缩摘要]\n"
            "以下为已压缩历史的稳定记忆，请将其视为更早对话的替代上下文：\n"
            f"{summary}"
        )

    def format_messages_for_context_compression(self, messages: List[Dict[str, Any]]) -> str:
        """格式化待压缩历史消息。"""
        model = self.model
        compact_mode = model._resolve_context_compact_mode()
        lines: List[str] = []

        for item in messages or []:
            if not isinstance(item, dict):
                continue

            role = str(item.get("role", "") or "").strip().upper()

            if role not in {"USER", "ASSISTANT"}:
                continue

            compacted = model._compact_context_content(item.get("content", ""), compact_mode)
            compacted = self._strip_history_time_prefix_from_content(compacted)

            if role == "ASSISTANT" and isinstance(compacted, str):
                compacted = sanitize_assistant_visible_content(compacted)

            text = self.content_to_text_for_context_compression(compacted).strip()

            if not text:
                continue

            lines.append(f"[{role}] {text}")

        text = "\n".join(lines).strip()
        history_limit = int(max(
            CONTEXT_COMPRESSION_HISTORY_MAX_CHARS_MIN,
            min(
                CONTEXT_COMPRESSION_HISTORY_MAX_CHARS_MAX,
                int(getattr(model, "_context_compression_history_max_chars", CONTEXT_COMPRESSION_HISTORY_MAX_CHARS_DEFAULT)),
            ),
        ))

        if len(text) <= history_limit:
            return text

        head_len = int(max(20000, min(history_limit - 5000, int(history_limit * 0.35))))
        tail_len = int(max(30000, history_limit - head_len - 80))

        if head_len + tail_len > history_limit:
            tail_len = max(12000, history_limit - head_len - 80)

        head = text[:head_len]
        tail = text[-tail_len:]
        return f"{head}\n...[历史过长，已截断中段]...\n{tail}"

    def run_context_compression_round(
        self,
        history_messages: List[Dict[str, Any]],
        max_chars: int = CONTEXT_COMPRESSION_MAX_CHARS_DEFAULT,
    ) -> Generator[Dict[str, Any], None, Dict[str, Any]]:
        """执行专用上下文压缩轮次。"""
        model = self.model
        system_prompt = str(prompts.context_compression_system_prompt or "")
        safe_max_chars = max(
            CONTEXT_COMPRESSION_MAX_CHARS_MIN,
            min(CONTEXT_COMPRESSION_MAX_CHARS_MAX, int(max_chars or CONTEXT_COMPRESSION_MAX_CHARS_DEFAULT)),
        )
        history_text = self.format_messages_for_context_compression(history_messages)
        profile_text = model._get_user_profile_memory_text()
        recent_dialogue_text = model._get_recent_dialogue_memory_text()
        print(
            "[CTX_COMPRESS] source "
            f"messages={len(history_messages or [])} "
            f"history_chars={len(str(history_text or ''))} "
            f"profile_chars={len(str(profile_text or ''))} "
            f"recent_chars={len(str(recent_dialogue_text or ''))}"
        )
        prompt_text = prompts.build_context_compression_prompt(
            history_text,
            profile_text=profile_text,
            recent_dialogue=recent_dialogue_text,
            max_chars=safe_max_chars,
        )
        history_truncated = ("...[历史过长，已截断中段]..." in history_text)
        out: Dict[str, Any] = {
            "summary": "",
            "prompt_text": str(prompt_text or ""),
            "system_prompt": system_prompt,
            "prompt_template": str(getattr(prompts, "context_compression_prompt_template", "") or ""),
            "profile_text": str(profile_text or ""),
            "recent_dialogue": str(recent_dialogue_text or ""),
            "history_text": str(history_text or ""),
            "model_reply": "",
            "error": "",
            "history_message_count": int(len(history_messages or [])),
            "history_chars": int(len(str(history_text or ""))),
            "history_truncated": bool(history_truncated),
            "history_limit_chars": int(getattr(model, "_context_compression_history_max_chars", CONTEXT_COMPRESSION_HISTORY_MAX_CHARS_DEFAULT)),
            "summary_max_chars": int(safe_max_chars),
        }

        if not history_text:
            out["error"] = "empty_history"
            return out

        req_messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt_text},
        ]
        stream_text = ""
        stream_error = ""
        stream_emitted = False

        try:
            stream_response = model.provider_adapter.create_chat_completion(
                client=model.client,
                model=model.model_name,
                messages=req_messages,
                stream=True,
            )
            stream_events = model.provider_adapter.iter_stream_events(
                stream_response,
                use_responses_api=False,
                native_web_search_enabled=False,
            )

            for event in stream_events:
                if not isinstance(event, dict):
                    continue

                ev_type = str(event.get("type", "") or "").strip()

                if ev_type != "content_delta":
                    continue

                delta = str(event.get("delta", "") or "")

                if not delta:
                    continue

                stream_emitted = True
                stream_text += delta
                yield {
                    "type": "model_reply_delta",
                    "delta": delta,
                    "model_reply": stream_text,
                    "chars": int(len(stream_text)),
                    "from_stream": True,
                }
        except Exception as exc:
            stream_error = str(exc or "")
            out["error"] = stream_error
            print(f"[CTX_COMPRESS] stream compression round failed: {exc}")
            yield {"type": "error", "error": stream_error, "from_stream": True}

        final_stream_text = str(stream_text or "").strip()

        if final_stream_text:
            out["model_reply"] = final_stream_text
            out["summary"] = final_stream_text[:safe_max_chars]
            return out

        try:
            response = model.provider_adapter.create_chat_completion(
                client=model.client,
                model=model.model_name,
                messages=req_messages,
                stream=False,
            )
            text = str(model._extract_completion_text(response) or "").strip()
            out["model_reply"] = text

            if text:
                if not stream_emitted:
                    yield {
                        "type": "model_reply_delta",
                        "delta": text,
                        "model_reply": text,
                        "chars": int(len(text)),
                        "from_stream": False,
                    }

                out["summary"] = text[:safe_max_chars]
                return out
        except Exception as exc:
            print(f"[CTX_COMPRESS] model compression round failed: {exc}")
            out["error"] = str(exc or "") or stream_error
            yield {"type": "error", "error": out["error"], "from_stream": False}

        if not out["error"] and stream_error:
            out["error"] = stream_error

        return out
