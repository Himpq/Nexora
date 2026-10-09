"""本地请求上下文：追加式摘要、完整历史保留和工具协议校验。"""

from __future__ import annotations

import json
import math
import time

from .ShortRequest import run_short_request


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

    def _measured_marginal_rate(self, conversation: dict, plain_now: int) -> float:
        """相邻两轮实测差值给出的「每单位估算 token 的真实 token 数」。

        上游实测之差就是这轮新增内容的真实开销，除以同期估算增量即得边际速率。
        有了它，新增内容不再按固定字符比估算：英文正文约 0.75、中文约 1.0，
        都会由实测自己体现，而不是写死一个系数。
        """
        state = conversation.get("context_state", {})
        measured = int(state.get("last_input_tokens") or 0)
        previous = int(state.get("prev_input_tokens") or 0)
        plain_previous = int(state.get("last_estimated_tokens") or 0)
        delta_real = measured - previous
        delta_plain = plain_now - plain_previous

        if delta_plain <= 0 or delta_real <= 0:
            return 1.0

        # 上游回报异常（重连回放、口径变化）时钳制，避免速率失控放大判定值。
        return min(10.0, max(0.1, delta_real / delta_plain))

    def _measure_request_basis(self, conversation: dict, messages: list, tools: list) -> int:
        """估算本轮输入占用：历史部分用上游实测值，未实测的增量保持保守。

        字符启发式对同一份内容会系统性偏差（英文按 3 字符/token 高估约 33%），
        反复对整段历史重估等于把这份偏差硬塞进触发判定。改成两段处理：
        - 已发送过的部分：直接沿用上游实测的 prompt_tokens，一个字符都不重估；
        - 尚未发送的新增消息：按实测边际速率折算，但不设下限——
          宁可高估这几百个 token，也不能因为低估而让请求越窗。
        偏差因此被限制在单轮增量上，历史再长也不会放大。

        无实测基线（首轮 / 摘要换代后）时退回整体估算。
        """
        state = conversation.get("context_state", {})
        measured = int(state.get("last_input_tokens") or 0)
        measured_count = int(state.get("last_measured_message_count") or 0)
        plain_now = self.estimate_tokens({"messages": messages, "tools": tools})

        if measured <= 0 or not 0 <= measured_count <= len(messages):
            return plain_now

        # 实测值已包含 tools（每轮固定），因此增量只算新消息，不再叠加 tools。
        fresh = messages[measured_count:]

        if not fresh:
            return measured

        fresh_plain = self.estimate_tokens({"messages": fresh})

        return measured + math.ceil(max(1.0, self._measured_marginal_rate(conversation, plain_now)) * fresh_plain)

    def prepare(self, conversation_id, system_prompt, tools, *, force=False, cancel_checker=None,
                response_trace_id="", allow_compression=True):
        """必要时分批总结历史；当前 user 轮次及其工具结果始终保持原样。

        allow_compression=False 表示本次请求已经发出过前缀：摘要坑位一改写，
        已缓存的整段前缀立即失效，所以非首轮不再压缩，只有真的装不下时才兜底压缩。
        """
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
        measured_estimate = self._measure_request_basis(conversation, messages, tools)
        state = conversation.get("context_state", {})
        threshold = min(int(window * 0.9), window - output)
        hard_limit = window - output

        if not force and measured_estimate < threshold:
            return messages

        if not allow_compression and measured_estimate < hard_limit:
            # 已越过软阈值但仍装得下：保住本轮前缀，压缩留给下一次请求的首轮。
            return messages

        if not allow_compression:
            print(f"[LocalContext] late_compression conversation={conversation_id} "
                  f"input_estimate={measured_estimate} hard_limit={hard_limit}")

        history = conversation.get("messages", [])
        start = int(state.get("history_cut_index", 0))
        user_positions = [i for i in range(start, len(history)) if history[i].get("role") == "user"]
        end = user_positions[-1] if user_positions else start

        if end <= start:
            if measured_estimate >= hard_limit:
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

                if self.estimate_tokens({"messages": trial + [instruction], "tools": tools}) + summary_output >= window:
                    break

                boundary = next_boundary
                candidate = trial

            if boundary == cursor:
                raise ContextLimitError("单个历史轮次超过摘要请求预算；请使用更大窗口模型处理该会话")

            self.validate_tools(candidate)
            # 摘要请求与主请求共用同一份 tools：tools 块渲染在提示词开头，
            # 不传就会让两次请求的提示词前缀分叉，压缩调用全价冷读。
            # 摘要只需要文本输出，因此 tool_choice 固定为 none，真出现工具调用直接判错。
            result = None

            try:
                result = run_short_request(
                    self.provider,
                    candidate + [instruction],
                    tools=tools,
                    tool_choice="none",
                    max_tokens=summary_output,
                    cancel_checker=cancel_checker,
                    cancel_message="__STREAM_CANCELLED__",
                    tool_call_message="摘要请求返回了工具调用",
                )
            finally:
                if result is not None and result.has_usage:
                    # 压缩调用挂在触发它的请求 trace 下，round_index 固定 0 表示请求正文之前发生。
                    self.store.record_compression_call(conversation_id, {
                        "model_name": self.provider.config.model,
                        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                        "usage": result.usage,
                        "summary": result.text,
                        "finish_reason": result.finish_reason,
                        "response_trace_id": str(response_trace_id or ""),
                        "round_index": 0,
                    })

            if result.finish_reason == "length":
                raise ContextLimitError("摘要输出达到上限，未保存不完整摘要")

            summary = result.text.strip()

            if not summary:
                raise ValueError("模型未返回上下文摘要，原始历史保持完整")

            if result.has_usage:
                usages.append(result.usage)
            else:
                print(f"[LocalContext] usage_missing conversation={conversation_id} cut={boundary}")

            cursor = boundary
            yield {"type": "context_compression_status", "status": "progress", "content": "正在整理历史上下文", "history_cut_index": cursor}

        updated = dict(conversation)
        updated["context_state"] = {"summary": summary, "history_cut_index": end}
        messages = self.build_messages(updated, system_prompt)
        post_estimate = self._measure_request_basis(updated, messages, tools)

        if post_estimate + output >= window:
            raise ContextLimitError("摘要与当前任务仍超过模型窗口，未修改摘要边界")

        record = {"summary": summary, "history_cut_index": end, "created_at": time.time(), "model_name": self.provider.config.model, "usage": usages}
        self.store.save_context(conversation_id, record, history[:end])
        print(f"[LocalContext] compressed conversation={conversation_id} cut={end} "
              f"input_basis={measured_estimate} post_basis={post_estimate} batches={len(usages)}")
        yield {"type": "context_compression_status", "status": "done", "content": "上下文压缩完成", "history_cut_index": end, "summary_chars": len(summary)}
        return messages
