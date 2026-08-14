"""
NexoraCode.model.AgentLoop — 本地 Agent Loop

对话在本地驱动：维护消息历史 → 调 Provider 流式推理 → 解析 tool_calls →
本地执行工具 → 回传结果 → 循环，直到模型不再调用工具。

对外提供：
- AgentLoop.stream_send(): 流式生成器，yield 对齐云端 SSE 的事件：
  content / function_call / function_result / question / conversation_id / done
"""

from __future__ import annotations

import json
from typing import Any, Generator, Optional

from local import ToolExecutor
from .Provider import ProviderClient, ProviderConfig
from .ConversationStore import ConversationStore


MAX_TOOL_ROUNDS = 12

DEFAULT_SYSTEM_PROMPT = (
    "你是 NexoraCode，运行在用户本地电脑上的编程助手。"
    "你可以通过 local_* 工具读取/修改用户本地文件、执行命令、搜索代码，"
    "以完成用户的开发任务。执行文件操作时保持在用户项目根路径内。"
    "需要用户授权访问路径时，系统会自动向用户发起权限询问，无需额外调用权限工具。"
)


class AgentLoop:
    def __init__(
        self,
        provider: ProviderClient,
        executor: ToolExecutor,
        store: ConversationStore,
    ):
        self.provider = provider
        self.executor = executor
        self.store = store

    def stream_send(self, conversation_id: str, user_text: str, system_prompt: str = "", cancel_checker: Any = None) -> Generator[dict, None, None]:
        conversation = self.store.get(conversation_id) if conversation_id else None

        if conversation is None:
            conversation = self.store.create()

        conversation_id = str(conversation.get("conversation_id") or "")
        yield {"type": "conversation_id", "conversation_id": conversation_id}

        self.store.append_message(conversation_id, {"role": "user", "content": user_text, "timestamp": _now()})

        effective_system = str(system_prompt or "").strip() or DEFAULT_SYSTEM_PROMPT

        tool_calls_seen = 0

        while True:
            if self._is_cancelled(cancel_checker):
                break

            if tool_calls_seen >= MAX_TOOL_ROUNDS:
                yield {"type": "error", "message": f"工具调用轮次超过上限（{MAX_TOOL_ROUNDS}）"}

                break

            messages = self._build_messages(conversation_id, effective_system)
            tools = self.executor.list_tools_llm_format()

            assistant_parts = []
            assistant_tool_calls = []

            try:
                for event in self.provider.stream_chat(messages, tools=tools):
                    event_type = event.get("type")

                    if event_type == "content":
                        assistant_parts.append(str(event.get("delta") or ""))
                        yield {"type": "content", "content": str(event.get("delta") or "")}

                    elif event_type == "tool_call":
                        assistant_tool_calls.append(event)

                    elif event_type == "finish":
                        yield {"type": "finish", "finish_reason": str(event.get("finish_reason") or "")}
            except Exception as exc:
                yield {"type": "error", "message": f"模型调用失败: {exc}"}

                break

            content_text = "".join(assistant_parts)
            grouped_tool_calls = self._group_tool_calls(assistant_tool_calls)

            if not grouped_tool_calls:
                self.store.append_message(
                    conversation_id,
                    {"role": "assistant", "content": content_text, "timestamp": _now()},
                )
                yield {"type": "done", "conversation_id": conversation_id}

                break

            assistant_message = {"role": "assistant", "content": content_text, "tool_calls": grouped_tool_calls}
            self.store.append_message(conversation_id, assistant_message)

            for tool_call in grouped_tool_calls:
                if self._is_cancelled(cancel_checker):
                    break

                call_id = str(tool_call.get("id") or "")
                tool_name = str(tool_call.get("name") or "")
                arguments = tool_call.get("arguments")

                yield {"type": "function_call", "name": tool_name, "call_id": call_id, "arguments": arguments}

                result = self._execute_tool(tool_name, arguments, conversation_id)
                tool_content = result.get("content")
                success = result.get("success")

                if result.get("permission_required"):
                    yield {
                        "type": "question",
                        "question": result.get("permission_question"),
                        "conversation_id": conversation_id,
                    }

                yield {
                    "type": "function_result",
                    "name": tool_name,
                    "call_id": call_id,
                    "result": tool_content,
                    "success": success,
                }

                self.store.append_message(
                    conversation_id,
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": tool_content,
                        "timestamp": _now(),
                    },
                )

            tool_calls_seen += 1

    def _is_cancelled(self, cancel_checker) -> bool:
        if callable(cancel_checker):
            try:
                return bool(cancel_checker())
            except Exception:
                return False

        return False

    def cancel(self) -> None:
        """中断当前 Provider 请求，使阻塞读取立即返回。"""
        self.provider.cancel()

    def _build_messages(self, conversation_id: str, system_prompt: str) -> list[dict]:
        conversation = self.store.get(conversation_id) or {}
        messages: list[dict] = [{"role": "system", "content": system_prompt}]

        for message in conversation.get("messages", []):
            role = str(message.get("role") or "").strip()
            content = message.get("content")

            if role == "user":
                messages.append({"role": "user", "content": self._stringify_content(content)})

            elif role == "assistant":
                item: dict[str, Any] = {"role": "assistant", "content": self._stringify_content(content)}
                tool_calls = message.get("tool_calls")

                if isinstance(tool_calls, list) and tool_calls:
                    item["tool_calls"] = [
                        {
                            "id": str(tc.get("id") or ""),
                            "type": "function",
                            "function": {
                                "name": str(tc.get("name") or ""),
                                "arguments": json.dumps(tc.get("arguments") or {}, ensure_ascii=False),
                            },
                        }
                        for tc in tool_calls
                    ]

                messages.append(item)

            elif role == "tool":
                messages.append({
                    "role": "tool",
                    "tool_call_id": str(message.get("tool_call_id") or ""),
                    "content": self._stringify_content(content),
                })

        return messages

    def _execute_tool(self, tool_name: str, arguments: Any, conversation_id: str) -> dict:
        args = arguments if isinstance(arguments, dict) else {}

        if isinstance(arguments, str):
            try:
                args = json.loads(arguments)
            except Exception:
                args = {}

        if not isinstance(args, dict):
            args = {}

        result = self.executor.execute(
            tool_name,
            args,
            context={"conversation_id": conversation_id},
        )

        success = bool(result.get("success", False))
        detail = result.get("result") if isinstance(result.get("result"), dict) else result

        permission_required = bool(
            detail.get("permission_required")
            or str(detail.get("error") or "") == "permission_required"
        )

        if permission_required:
            from .Permission import build_local_permission_question

            return {
                "success": False,
                "permission_required": True,
                "permission_question": build_local_permission_question(detail),
                "content": "权限不足，已向用户发起授权询问，等待用户允许后重试。",
            }

        if not success:
            return {
                "success": False,
                "content": str(result.get("error") or detail.get("error") or "工具执行失败"),
            }

        content = detail if detail is not None else ""

        if not isinstance(content, str):
            try:
                content = json.dumps(content, ensure_ascii=False, default=str)
            except Exception:
                content = str(content)

        return {"success": True, "content": content}

    @staticmethod
    def _group_tool_calls(events: list[dict]) -> list[dict]:
        grouped: dict[int, dict] = {}
        order: list[int] = []

        for event in events:
            index = int(event.get("index", 0) or 0)

            if index not in grouped:
                grouped[index] = {"id": "", "name": "", "arguments": ""}
                order.append(index)

            target = grouped[index]

            if event.get("id"):
                target["id"] = str(event.get("id") or "")

            if event.get("name"):
                target["name"] = str(event.get("name") or "")

            target["arguments"] += str(event.get("arguments_delta") or "")

        result = []

        for index in order:
            item = grouped[index]
            arguments = item["arguments"]

            try:
                parsed = json.loads(arguments) if arguments.strip() else {}
            except Exception:
                parsed = {}

            result.append({
                "id": item["id"],
                "name": item["name"],
                "arguments": parsed if isinstance(parsed, dict) else {},
            })

        return result

    @staticmethod
    def _stringify_content(content: Any) -> str:
        if content is None:
            return ""

        if isinstance(content, str):
            return content

        if isinstance(content, list):
            parts = []

            for part in content:
                if isinstance(part, dict):
                    parts.append(str(part.get("text") or ""))

            return "".join(parts)

        try:
            return json.dumps(content, ensure_ascii=False)
        except Exception:
            return str(content)


def _now() -> str:
    import datetime

    return datetime.datetime.now().isoformat()
