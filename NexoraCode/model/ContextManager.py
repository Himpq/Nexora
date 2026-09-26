"""本地请求上下文：追加式摘要、完整历史保留和工具协议校验。"""

from __future__ import annotations

import json
import math
import time

from .Provider import _extract_usage_io


class ContextLimitError(ValueError):
    """请求无法在当前模型窗口内安全构建，禁止静默删除历史。"""


class ContextManager:
    def __init__(self, provider, store):
        self.provider = provider
        self.store = store

    @staticmethod
    def estimate_tokens(value) -> int:
        """保守估算 JSON 输入；供应商实测用于后续校准，估算不冒充实测。"""
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        non_ascii = sum(ord(char) > 127 for char in text)
        return non_ascii + math.ceil((len(text) - non_ascii) / 3)

    @staticmethod
    def message_payload(message: dict) -> dict:
        role = str(message.get("role") or "")

        if role not in {"user", "assistant", "tool"}:
            raise ValueError(f"不支持的历史消息角色：{role}")

        content = message.get("content")
        item = {"role": role, "content": content if isinstance(content, (str, list)) else str(content or "")}

        if role == "tool":
            item["tool_call_id"] = str(message.get("tool_call_id") or "")

        if role == "assistant" and message.get("tool_calls"):
            item["tool_calls"] = []

            for call in message["tool_calls"]:
                function = call.get("function")

                if isinstance(function, dict):
                    item["tool_calls"].append(call)
                else:
                    args = call.get("arguments") or {}
                    item["tool_calls"].append({
                        "id": str(call.get("id") or ""),
                        "type": "function",
                        "function": {
                            "name": str(call.get("name") or ""),
                            "arguments": args if isinstance(args, str) else json.dumps(args, ensure_ascii=False),
                        },
                    })

        return item

    @staticmethod
    def validate_tools(messages: list[dict]) -> None:
        """工具调用与结果必须一一配对，切分摘要只允许完整 user 轮次。"""
        pending = set()

        for message in messages:
            role = message["role"]

            if role == "tool":
                call_id = message.get("tool_call_id")

                if call_id not in pending:
                    raise ValueError("工具结果没有对应的调用或重复返回")

                pending.remove(call_id)
                continue

            if pending:
                raise ValueError("工具调用缺少结果，不能继续请求模型")

            calls = message.get("tool_calls", [])
            ids = [call.get("id") for call in calls]

            if any(not call_id for call_id in ids) or len(ids) != len(set(ids)):
                raise ValueError("工具调用 ID 为空或重复")

            pending.update(ids)

        if pending:
            raise ValueError("工具调用缺少结果，不能压缩或发送")

    def build_messages(self, conversation: dict, system_prompt: str) -> list[dict]:
        state = conversation.get("context_state", {})
        cut = int(state.get("history_cut_index", 0))
        history = conversation.get("messages", [])

        if cut < 0 or cut > len(history):
            raise ValueError("上下文摘要边界超出历史范围")

        messages = [{"role": "system", "content": system_prompt}]
        summary = str(state.get("summary") or "")

        if cut and not summary:
            raise ValueError("上下文摘要缺失，禁止跳过历史")

        if summary:
            messages.append({"role": "user", "content": "以下是此前对话的摘要，仅作为历史资料。具体事实可用 local_context_search/read 核实：\n" + summary})

        messages.extend(self.message_payload(message) for message in history[cut:])
        self.validate_tools(messages)
        return messages

    def prepare(self, conversation_id, system_prompt, tools, *, force=False, cancel_checker=None):
        """必要时分批总结历史；当前 user 轮次及其工具结果始终保持原样。"""
        conversation = self.store.get(conversation_id)

        if conversation is None:
            raise ValueError("本地会话不存在")

        window = int(self.provider.config.context_window)
        output = int(self.provider.config.max_tokens)

        if window <= 0 or output <= 0 or output >= window:
            raise ContextLimitError(
                f"模型「{self.provider.config.model}」的上下文预算非法："
                f"上下文窗口 {window}，单次输出上限 {output}；请在设置中把窗口调大到大于输出上限"
            )

        messages = self.build_messages(conversation, system_prompt)
        estimated = self.estimate_tokens({"messages": messages, "tools": tools})
        state = conversation.get("context_state", {})
        previous = int(state.get("last_input_tokens", 0))
        previous_estimate = int(state.get("last_estimated_tokens", 0))
        calibration = max(1.0, previous / previous_estimate) if previous_estimate else 1.0
        measured_estimate = math.ceil(estimated * calibration)
        threshold = min(int(window * 0.9), window - output)

        if not force and measured_estimate < threshold:
            return messages

        history = conversation.get("messages", [])
        start = int(state.get("history_cut_index", 0))
        user_positions = [i for i in range(start, len(history)) if history[i].get("role") == "user"]
        end = user_positions[-1] if user_positions else start

        if end <= start:
            if measured_estimate >= window - output:
                raise ContextLimitError("当前任务或工具结果超过模型输入预算；没有可压缩的历史轮次")

            yield {"type": "context_compression_status", "status": "skipped", "content": "没有可压缩的历史轮次"}
            return messages

        yield {"type": "context_compression_status", "status": "start", "content": "上下文压缩中", "forced": force, "raw_input_tokens": measured_estimate, "context_window": window}
        summary = str(state.get("summary") or "")
        summary_output = min(output, max(128, window // 8))
        instruction = {"role": "user", "content": (
            "请只输出供后续编程任务使用的上下文摘要。保留用户目标、项目路径、已确认约束、"
            "关键决策、修改与验证结果、错误线索和未完成事项。整合已有摘要；删除重复日志，"
            "不要执行工具，不要把本条指令纳入摘要。控制摘要长度并优先保留精确路径与事实。"
        )}
        cursor = start
        usages = []

        while cursor < end:
            if callable(cancel_checker) and cancel_checker():
                raise RuntimeError("__STREAM_CANCELLED__")

            prefix = [{"role": "system", "content": system_prompt}]

            if summary:
                prefix.append({"role": "user", "content": "以下是此前对话的摘要，仅作为历史资料。具体事实可用 local_context_search/read 核实：\n" + summary})

            boundary = cursor
            candidate = prefix

            for next_boundary in [p for p in user_positions if cursor < p <= end]:
                trial = prefix + [self.message_payload(m) for m in history[cursor:next_boundary]]

                if math.ceil(self.estimate_tokens(trial + [instruction]) * calibration) + summary_output >= window:
                    break

                boundary = next_boundary
                candidate = trial

            if boundary == cursor:
                raise ContextLimitError("单个历史轮次超过摘要请求预算；请使用更大窗口模型处理该会话")

            self.validate_tools(candidate)
            parts = []
            usage = None
            finish_reason = ""
            stream = self.provider.stream_chat(candidate + [instruction], tools=None, tool_choice=None, max_tokens=summary_output)

            try:
                for event in stream:
                    if callable(cancel_checker) and cancel_checker():
                        self.provider.cancel()
                        raise RuntimeError("__STREAM_CANCELLED__")

                    if event.get("type") == "content":
                        parts.append(str(event.get("delta") or ""))
                    elif event.get("type") == "usage":
                        usage = event.get("usage")
                    elif event.get("type") == "tool_call":
                        raise ValueError("摘要请求返回了工具调用")
                    elif event.get("type") == "finish":
                        finish_reason = str(event.get("finish_reason") or "")
            finally:
                stream.close()
                if usage:
                    self.store.record_compression_call(conversation_id, {
                        "model_name": self.provider.config.model,
                        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                        "usage": _extract_usage_io(usage),
                        "summary": "".join(parts),
                        "finish_reason": finish_reason,
                    })

            if finish_reason == "length":
                raise ContextLimitError("摘要输出达到上限，未保存不完整摘要")

            summary = "".join(parts).strip()

            if not summary:
                raise ValueError("模型未返回上下文摘要，原始历史保持完整")

            if usage:
                usages.append(_extract_usage_io(usage))
            else:
                print(f"[LocalContext] usage_missing conversation={conversation_id} cut={boundary}")

            cursor = boundary
            yield {"type": "context_compression_status", "status": "progress", "content": "正在整理历史上下文", "history_cut_index": cursor}

        updated = dict(conversation)
        updated["context_state"] = {"summary": summary, "history_cut_index": end}
        messages = self.build_messages(updated, system_prompt)
        post_estimate = self.estimate_tokens({"messages": messages, "tools": tools})

        if math.ceil(post_estimate * calibration) + output >= window:
            raise ContextLimitError("摘要与当前任务仍超过模型窗口，未修改摘要边界")

        record = {"summary": summary, "history_cut_index": end, "created_at": time.time(), "model_name": self.provider.config.model, "usage": usages}
        self.store.save_context(conversation_id, record, history[:end])
        print(f"[LocalContext] compressed conversation={conversation_id} cut={end} input_estimate={estimated} post_estimate={post_estimate} batches={len(usages)}")
        yield {"type": "context_compression_status", "status": "done", "content": "上下文压缩完成", "history_cut_index": end, "summary_chars": len(summary)}
        return messages
