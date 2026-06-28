"""ChatDB 聊天上下文管理组件。

该组件集中管理请求上下文构建、压缩摘要注入、压缩输入格式化与压缩轮次执行。
Model 只负责主流程编排和 Provider 调用细节。
"""

from __future__ import annotations

import json
from enum import Enum
from typing import Any, Callable, Dict, Generator, List, Mapping, Optional, Tuple

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
    ) -> List[Dict[str, Any]]:
        """构建模型首轮请求消息列表。"""
        context = self.build_initial_context(
            user_msg=user_msg,
            current_user_content=current_user_content,
            use_responses_api=use_responses_api,
            allow_history_images=allow_history_images,
            include_context=include_context,
            system_prompt_text=system_prompt_text,
            system_injection_texts=system_injection_texts,
            history_end_index_exclusive=history_end_index_exclusive,
        )
        context.prepare()
        return context.build()

    def build_current_turn_messages(
        self,
        *,
        current_user_content: Any,
        system_injection_texts: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """构建续接缓存命中时只发送的当前轮消息。"""
        messages: List[Dict[str, Any]] = []

        for text in self._normalize_system_injection_texts(system_injection_texts):
            messages.append({"role": "system", "content": text})

        messages.append({"role": "user", "content": current_user_content})
        return messages

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
    ) -> ChatContext:
        """构建并返回可继续 add/prepare/build 的上下文对象。"""
        model = self.model
        context_compact_mode = model._resolve_context_compact_mode()
        effective_system_prompt = str(system_prompt_text or model.system_prompt or "").strip()
        context = self.create_context(
            policy=ChatContextPolicy.NONE,
            trace_meta={
                "flow": "chat_initial",
                "conversation_id": str(model.conversation_id or ""),
                "model_name": str(model.model_name or ""),
            },
        )
        context.add("system", effective_system_prompt)

        for text in self._normalize_system_injection_texts(system_injection_texts):
            context.add("system", text)

        history_messages: List[Dict[str, Any]] = []
        compression_marker: Optional[Dict[str, Any]] = None

        if include_context and model.conversation_id:
            try:
                history_messages = model.conversation_manager.get_messages(model.conversation_id)
            except Exception:
                history_messages = []

            try:
                compression_marker = model.conversation_manager.get_latest_context_compression(model.conversation_id)
            except Exception:
                compression_marker = None

        history_messages = self._cut_history_for_regenerate(
            history_messages,
            history_end_index_exclusive,
        )
        history_messages = self._apply_latest_compression_marker(
            context,
            history_messages,
            compression_marker,
        )

        for item in history_messages:
            self._add_history_item_to_context(
                context,
                item,
                use_responses_api=use_responses_api,
                allow_history_images=allow_history_images,
                context_compact_mode=context_compact_mode,
            )

        final_user_content = current_user_content if current_user_content is not None else user_msg
        final_user_sig = model._content_signature_for_dedupe(
            self._strip_system_injection_from_content(final_user_content)
        )
        last_message = context.last()
        last_is_same_user = bool(
            last_message
            and last_message.role == "user"
            and model._content_signature_for_dedupe(
                self._strip_system_injection_from_content(last_message.content)
            ) == final_user_sig
        )

        if not last_is_same_user:
            context.add("user", final_user_content)

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

        model = self.model
        normalized = model._compact_context_content(normalized, context_compact_mode)
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

            return normalized

        return self._normalize_history_content(content)

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
        """剥离历史去重口径中的运行时 system 注入块。"""
        if isinstance(content, str):
            return self._strip_system_injection_text(content)

        if isinstance(content, list):
            stripped_items: List[Any] = []

            for item in content:
                if not isinstance(item, dict):
                    stripped_items.append(item)
                    continue

                item_copy = dict(item)
                item_type = str(item_copy.get("type", "") or "").strip().lower()

                if item_type in {"text", "input_text"} and isinstance(item_copy.get("text"), str):
                    item_copy["text"] = self._strip_system_injection_text(item_copy.get("text", ""))

                stripped_items.append(item_copy)

            return stripped_items

        if isinstance(content, dict):
            item_copy = dict(content)

            if isinstance(item_copy.get("text"), str):
                item_copy["text"] = self._strip_system_injection_text(item_copy.get("text", ""))

            if isinstance(item_copy.get("content"), str):
                item_copy["content"] = self._strip_system_injection_text(item_copy.get("content", ""))

            return item_copy

        return content

    def _strip_system_injection_text(self, text: str) -> str:
        marker = "\n\n[系统注入]"
        value = str(text or "")

        if value.startswith("[系统注入]"):
            return ""

        idx = value.find(marker)

        if idx < 0:
            return value

        return value[:idx].rstrip()

    def _build_assistant_history_messages(
        self,
        item: Dict[str, Any],
        *,
        use_responses_api: bool,
        context_compact_mode: str,
    ) -> List[Dict[str, Any]]:
        metadata = item.get("metadata", {}) if isinstance(item.get("metadata", {}), dict) else {}
        process_steps = metadata.get("process_steps", [])

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

            compacted_intro = model._compact_context_content(
                group.get("content", ""),
                context_compact_mode,
            )
            protocol_messages = self._build_tool_protocol_messages(
                calls=calls,
                results=results,
                intro_content=compacted_intro,
                use_responses_api=use_responses_api,
                context_compact_mode=context_compact_mode,
            )
            messages.extend(protocol_messages)

        normalized_final = self._normalize_history_content(final_content)

        if normalized_final is not None:
            normalized_final = model._compact_context_content(normalized_final, context_compact_mode)
            messages.append({"role": "assistant", "content": normalized_final})

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
            compacted_result = model._compact_context_content(
                result_by_call_id.get(call_id, ""),
                context_compact_mode,
            )
            messages.append(
                model.provider_adapter.build_function_output_message(
                    call_id=call_id,
                    result=str(compacted_result or ""),
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
            compacted_result = model._compact_context_content(
                result_by_call_id.get(call_id, ""),
                context_compact_mode,
            )
            messages.append(
                model.provider_adapter.build_function_output_message(
                    call_id=call_id,
                    result=str(compacted_result or ""),
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
            summary_text = str(compression_marker.get("summary", "") or "").strip()
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
        system_prompt = "你是对话上下文压缩器，只输出压缩后的上下文摘要。"
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
        update_short_text = "可用 updateShort：覆盖更新当前用户短期记忆画像。"
        add_short_text = "可用 addShort：追加一条短期记忆，适合记录新的离散偏好或近期事项。"
        prompt_text = prompts.build_context_compression_prompt(
            history_text,
            profile_text=profile_text,
            recent_dialogue=recent_dialogue_text,
            update_short=update_short_text,
            add_short=add_short_text,
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
            "update_short": update_short_text,
            "add_short": add_short_text,
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
