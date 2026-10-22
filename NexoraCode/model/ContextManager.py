"""本地请求上下文：追加式摘要、完整历史保留和工具协议校验。"""

from __future__ import annotations

import json
import math
import queue
import threading
import time

from .ConversationStore import INTERRUPTED_TOOL_RESULT
from .ShortRequest import run_short_request
from .TokenEstimator import TokenEstimator


class ContextLimitError(ValueError):
    """请求无法在当前模型窗口内安全构建，禁止静默删除历史。"""


class ContextManager:
    _MIN_REQUEST_OUTPUT_TOKENS = 256
    _MAX_INPUT_SAFETY_MARGIN = 512

    def __init__(self, provider, store):
        self.provider = provider
        self.store = store

    @classmethod
    def _input_safety_margin(cls, window: int) -> int:
        """Leave room for differences between serialized-token estimates and provider accounting."""
        return min(cls._MAX_INPUT_SAFETY_MARGIN, max(64, math.ceil(window * 0.05)))

    def _minimum_request_output_tokens(self) -> int:
        configured = int(self.provider.config.max_tokens)

        return min(configured, self._MIN_REQUEST_OUTPUT_TOKENS)

    def request_output_limit(self, conversation_id, messages: list, tools: list) -> int:
        """按本次输入占用动态分配输出，避免短窗口固定预留过多额度。"""
        conversation = self.store.get(conversation_id)

        if conversation is None:
            raise ValueError("本地会话不存在")

        window = int(self.provider.config.context_window)
        configured = int(self.provider.config.max_tokens)
        input_basis = self._measure_request_basis(conversation, messages, tools)
        safety_margin = self._input_safety_margin(window)
        available = window - input_basis - safety_margin
        minimum = self._minimum_request_output_tokens()

        if available < minimum:
            raise ContextLimitError(
                f"当前输入估算 {input_basis} token，无法在上下文窗口 {window} 内"
                f"保留至少 {minimum} token 的回答空间"
            )

        output_limit = min(configured, available)

        if output_limit < configured:
            print(f"[LocalContext] output_budget_reduced conversation={conversation_id} "
                  f"input_basis={input_basis} safety_margin={safety_margin} "
                  f"configured_output={configured} request_output={output_limit} window={window}")

        return output_limit

    @staticmethod
    def estimate_tokens(value) -> int:
        """Estimate serialized JSON input; provider usage remains the source for calibration."""
        return TokenEstimator.count(value)

    @staticmethod
    def message_payload(message: dict) -> dict:
        role = str(message.get("role") or "")

        if role not in {"system", "user", "assistant", "tool"}:
            raise ValueError(f"不支持的历史消息角色：{role}")

        content = message.get("content")
        item = {"role": role, "content": content if isinstance(content, (str, list)) else str(content or "")}

        # 注入块以 system 消息持久化：只取正文，metadata 里的诊断信息不进请求。
        if role == "system":
            return item

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

    # 悬空工具调用的占位结果：进程被外部终止（如工具命令杀掉自身）时，
    # 落盘历史会停在 assistant.tool_calls 而没有对应的 tool 结果。
    # 补齐这条结果即可恢复协议完整，而不是让整个会话永久卡死。
    _INTERRUPTED_TOOL_RESULT = INTERRUPTED_TOOL_RESULT

    @classmethod
    def repair_tools(cls, messages: list[dict]) -> list[dict]:
        """补齐悬空工具调用的终止结果，使历史满足工具协议。

        进程被外部杀死（工具命令杀掉自身、崩溃、断电）时，assistant 消息里的
        tool_calls 可能永远等不到 tool 结果。这类悬空调用不是用户错误，也不该
        让会话永久不可用：就地补一条明确的「未返回结果」占位结果即可。
        孤儿 tool 结果（找不到对应调用）同样丢弃，避免污染请求。
        """
        repaired: list[dict] = []
        pending: list[str] = []

        for message in messages:
            role = str(message.get("role") or "")

            if role == "tool":
                call_id = str(message.get("tool_call_id") or "")

                if call_id not in pending:
                    # 孤儿结果：没有对应调用，丢弃。
                    continue

                pending.remove(call_id)
                repaired.append(message)
                continue

            if pending:
                # 上一条 assistant 的调用没等到结果：补占位结果后再继续。
                for open_id in pending:
                    repaired.append({
                        "role": "tool",
                        "tool_call_id": open_id,
                        "content": cls._INTERRUPTED_TOOL_RESULT,
                    })

                pending = []

            calls = message.get("tool_calls", [])
            pending.extend(str(call.get("id") or "") for call in calls)
            repaired.append(message)

        if pending:
            for open_id in pending:
                repaired.append({
                    "role": "tool",
                    "tool_call_id": open_id,
                    "content": cls._INTERRUPTED_TOOL_RESULT,
                })

        return repaired

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

    def build_messages(self, conversation: dict, system_prompt: str, volatile_instructions: list[str] | None = None) -> list[dict]:
        """组装请求消息：[head, 摘要?, 历史..., 临时块...]。

        head 恒定；项目约定 / 自定义提示词以 system 消息持久化在历史里（由
        AgentLoop 在轮次开头追加），随历史原样重发，位置不再变化，保证请求
        序列是前缀扩展；这里只额外追加「逐轮临时」的注入块（如空响应重试提示），
        它们不进历史，也不影响已缓存前缀。
        """
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

        # 悬空工具调用（进程被外部终止时落盘的历史）先补占位结果再校验：
        # 这类历史不是用户错误，补齐即恢复协议，不该让会话永久卡死。
        messages = self.repair_tools(messages)

        # 临时注入块：紧跟历史之后。工具配对校验必须在插入前完成，
        # 否则插在 assistant.tool_calls 与 tool 结果之间会破坏配对关系。
        self.validate_tools(messages)

        for block in volatile_instructions or []:
            text = str(block or "").strip()

            if text:
                messages.append({"role": "system", "content": text})

        return messages

    # 单条工具结果裁剪后保留的头尾字符数：头部含结构信息（文件头/命令回显），
    # 尾部含错误栈与结论，中间通常是重复的正文，省略代价最小。
    _TRIM_HEAD_CHARS = 2000
    _TRIM_TAIL_CHARS = 1000
    # 裁剪下限：比这还短的结果截了也没意义，直接跳过该条。
    _TRIM_MIN_CHARS = 2000
    # 迭代收缩的保留下限：触底仍装不下说明不是工具结果的问题，交给调用方抛错。
    _TRIM_FLOOR_CHARS = 800

    @staticmethod
    def _trim_tool_content(content, head_chars: int, tail_chars: int) -> str:
        """把超长工具结果截成「头 + 省略提示 + 尾」，保留可读的结构与结论。"""

        text = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False, default=str)

        if len(text) <= head_chars + tail_chars:
            return text

        omitted = len(text) - head_chars - tail_chars

        return (
            text[:head_chars]
            + f"\n\n[工具结果过长，已省略中间 {omitted} 字符；"
              "如需完整内容请用更精确的参数重新调用工具]\n\n"
            + text[-tail_chars:]
        )

    def _trim_oversized_tool_results(self, messages, tools, input_budget):
        """当前轮超窗时反复收缩最长的工具结果，直到输入低于可用预算。

        只处理本次发送副本，落盘历史不动。仍装不下（如单条 user 消息本身就超窗）
        时返回 None，由调用方抛 ContextLimitError。

        收缩必须迭代而非一次到位：窗口大小与结果长度无关，一次裁到固定长度
        未必够用（小窗口下尤其明显），因此每轮把当前最长的结果再砍半。
        每次都从原始内容重新裁剪，避免省略提示层层叠加。
        """

        initial_estimate = self.estimate_tokens({"messages": messages, "tools": tools})
        indexes = [
            index for index, message in enumerate(messages)
            if message.get("role") == "tool"
            and isinstance(message.get("content"), str)
            and len(message["content"]) > self._TRIM_MIN_CHARS
        ]

        if not indexes:
            print(f"[LocalContext] tool_result_trim_unavailable input_estimate={initial_estimate} "
                  f"input_budget={input_budget} candidates=0")
            return None

        originals = {index: messages[index]["content"] for index in indexes}
        keep = {index: len(originals[index]) for index in indexes}
        trial = [dict(message) for message in messages]

        # 每轮减半，2^32 的收缩幅度远超任何真实窗口，循环上限只是防御性兜底。
        for _ in range(32):
            estimate = self.estimate_tokens({"messages": trial, "tools": tools})

            if estimate < input_budget:
                print(f"[LocalContext] tool_results_trimmed input_before={initial_estimate} "
                      f"input_after={estimate} input_budget={input_budget} candidates={len(indexes)}")
                return trial

            # 总是先收缩最长的那条：截一条大的往往就能省下足够空间，
            # 避免把多条小结果一起切碎。
            longest = max(indexes, key=lambda index: keep[index])

            if keep[longest] <= self._TRIM_FLOOR_CHARS:
                print(f"[LocalContext] tool_result_trim_blocked input_estimate={estimate} "
                      f"input_budget={input_budget} candidates={len(indexes)} "
                      f"smallest_keep={keep[longest]}")
                return None

            keep[longest] = max(self._TRIM_FLOOR_CHARS, keep[longest] // 2)
            half = max(1, keep[longest] // 2)
            trial[longest]["content"] = self._trim_tool_content(originals[longest], half, half)

        return None

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
        """Use measured provider usage as an anchor and tiktoken for new content."""
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
                response_trace_id="", allow_compression=True, volatile_instructions=None,
                rebuild_injections=None):
        """必要时分批总结历史；当前 user 轮次及其工具结果始终保持原样。

        allow_compression=False 表示本次请求已经发出过前缀：摘要坑位一改写，
        已缓存的整段前缀立即失效，所以非首轮不再压缩，只有真的装不下时才兜底压缩。

        volatile_instructions 为逐轮临时注入块（如空响应重试提示），不进历史。

        rebuild_injections 为压缩重建用的全量注入消息（role=system）。压缩后历史
        被摘要替换、原有注入块随之消失，必须把全量块追加到保留历史之前，否则模型
        在重建后的上下文里看不到项目约定。消息与摘要同事务落盘，且只在此次确实
        发生压缩时使用。
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

        messages = self.build_messages(conversation, system_prompt, volatile_instructions)
        original_messages = messages
        measured_estimate = self._measure_request_basis(conversation, messages, tools)
        state = conversation.get("context_state", {})
        threshold = min(int(window * 0.9), window - output)
        hard_limit = window - output
        minimum_output = min(output, self._MIN_REQUEST_OUTPUT_TOKENS)
        adaptive_input_limit = window - minimum_output - self._input_safety_margin(window)

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
                if measured_estimate < adaptive_input_limit:
                    print(f"[LocalContext] active_turn_output_reduction conversation={conversation_id} "
                          f"input_estimate={measured_estimate} configured_input_limit={hard_limit} "
                          f"minimum_output_input_limit={adaptive_input_limit}")
                    yield {
                        "type": "context_compression_status",
                        "status": "output_limited",
                        "content": "当前输入接近上下文窗口，本轮回答上限已调低",
                        "raw_input_tokens": measured_estimate,
                        "context_window": window,
                    }
                    return messages

                # 历史里没有可压缩的轮次，说明超窗的是「当前轮自己」（通常是超长工具结果）。
                # 直接抛错会让对话彻底卡死，因此先尝试对当前轮的超大工具结果做降级裁剪：
                # 只改本次发送副本，落盘历史保持原文完整，用户随时可回看。
                trimmed = self._trim_oversized_tool_results(messages, tools, adaptive_input_limit)

                if trimmed is not None:
                    print(f"[LocalContext] active_turn_trimmed conversation={conversation_id} "
                          f"input_estimate={measured_estimate} hard_limit={hard_limit}")
                    yield {
                        "type": "context_compression_status",
                        "status": "trimmed",
                        "content": "当前任务过大，已截断超长工具结果",
                        "raw_input_tokens": measured_estimate,
                        "context_window": window,
                    }
                    return trimmed

                raise ContextLimitError(
                    f"当前任务或工具结果估算 {measured_estimate} token，超过可用输入预算 "
                    f"{adaptive_input_limit}（窗口 {window}，至少保留回答 {minimum_output} token）；"
                    "没有可压缩的历史轮次"
                )

            yield {"type": "context_compression_status", "status": "skipped", "content": "没有可压缩的历史轮次"}
            return messages

        yield {"type": "context_compression_status", "status": "start", "content": "上下文压缩中", "forced": force, "raw_input_tokens": measured_estimate, "context_window": window}
        summary = str(state.get("summary") or "")
        # 摘要输出预算：不能按 window//8 缩放——小窗口模型下会缩到 128，
        # 而摘要需整合已有摘要（可能数千字符）与新历史，必然被截断。
        # 对齐云端：摘要上限与窗口解耦，取输出上限的合理份额（至少 2048 token）。
        summary_output = max(2048, min(output, 8192)) if output > 0 else 2048
        # 预留空间不能吃满窗口，否则分批循环会因装不下任何轮次而直接报错。
        summary_output = min(summary_output, max(256, window // 3))
        # 摘要字符上限：超出即截断保存（对齐云端 final_text[:safe_max_chars]），
        # 不因 finish_reason=length 直接判错——那会让对话彻底卡死。
        summary_max_chars = max(2000, min(60000, summary_output * 3))
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

            candidate = self.repair_tools(candidate)
            self.validate_tools(candidate)
            # 摘要请求与主请求共用同一份 tools：tools 块渲染在提示词开头，
            # 不传就会让两次请求的提示词前缀分叉，压缩调用全价冷读。
            # 摘要只需要文本输出，因此 tool_choice 固定为 none，真出现工具调用直接判错。
            result = None
            # 摘要正文流式转发：run_short_request 是阻塞调用，无法在回调里 yield，
            # 因此放到子线程执行，增量经队列回传，主生成器边收边 yield progress 事件，
            # 前端压缩卡片即可看到摘要边生成边呈现（而不是等 done 才一次性出现）。
            delta_queue: "queue.Queue" = queue.Queue()
            worker_error: list = []

            def _run_summary() -> None:
                try:
                    nonlocal result
                    result = run_short_request(
                        self.provider,
                        candidate + [instruction],
                        tools=tools,
                        tool_choice="none",
                        max_tokens=summary_output,
                        cancel_checker=cancel_checker,
                        cancel_message="__STREAM_CANCELLED__",
                        tool_call_message="摘要请求返回了工具调用",
                        on_delta=lambda _delta, accumulated: delta_queue.put(accumulated),
                    )
                except BaseException as exc:  # 原样回抛到主线程，保持原有异常语义
                    worker_error.append(exc)
                finally:
                    delta_queue.put(None)

            worker = threading.Thread(target=_run_summary, daemon=True)
            worker.start()

            # 节流：逐 token 推送会产生几百条 SSE 事件（日志刷屏 + 前端频繁重渲染）。
            # 每累积一定字符或距上次推送超过一定时长才发一条，兼顾流式观感与开销。
            last_pushed_chars = 0
            last_pushed_at = time.monotonic()
            push_min_chars = 80
            push_min_interval = 0.25

            try:
                while True:
                    accumulated = delta_queue.get()

                    if accumulated is None:
                        break

                    now = time.monotonic()
                    should_push = (
                        len(accumulated) - last_pushed_chars >= push_min_chars
                        or now - last_pushed_at >= push_min_interval
                    )

                    if not should_push:
                        continue

                    last_pushed_chars = len(accumulated)
                    last_pushed_at = now

                    yield {
                        "type": "context_compression_status",
                        "status": "progress",
                        "content": "正在整理历史上下文",
                        "history_cut_index": cursor,
                        "summary_text": accumulated,
                        "summary_chars": len(accumulated),
                    }

                # 节流可能吞掉最后一段增量：补推一次完整摘要，避免流式末尾“跳变”。
                final_text = str(getattr(result, "text", "") or "").strip()

                if final_text and len(final_text) > last_pushed_chars:
                    yield {
                        "type": "context_compression_status",
                        "status": "progress",
                        "content": "正在整理历史上下文",
                        "history_cut_index": cursor,
                        "summary_text": final_text,
                        "summary_chars": len(final_text),
                    }

                worker.join()

                if worker_error:
                    raise worker_error[0]
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

            summary = result.text.strip()

            if result.finish_reason == "length":
                # 摘要被输出上限截断：保留已生成部分并告警，而不是让整轮对话失败。
                # 截断的摘要仍能大幅压缩历史，远优于“压缩失败→请求直接报错”。
                print(f"[LocalContext] summary_truncated conversation={conversation_id} "
                      f"chars={len(summary)} finish_reason=length")

            if len(summary) > summary_max_chars:
                summary = summary[:summary_max_chars]
                print(f"[LocalContext] summary_clipped conversation={conversation_id} "
                      f"max_chars={summary_max_chars}")

            if not summary:
                raise ValueError("模型未返回上下文摘要，原始历史保持完整")

            if result.has_usage:
                usages.append(result.usage)
            else:
                print(f"[LocalContext] usage_missing conversation={conversation_id} cut={boundary}")

            cursor = boundary

        updated = dict(conversation)
        updated_messages = list(conversation.get("messages", []))
        updated["messages"] = updated_messages
        updated["context_state"] = {"summary": summary, "history_cut_index": end}

        # 压缩重建后历史被摘要替换，此前的注入块已从窗口消失：把全量块插到保留
        # 历史之前（即当前 user 之前），与摘要一起落盘，之后每轮随历史重发。
        rebuild_messages = [dict(message) for message in (rebuild_injections or [])]

        if rebuild_messages:
            position = max(0, min(end, len(updated_messages)))
            updated_messages[position:position] = rebuild_messages

        messages = self.build_messages(updated, system_prompt, volatile_instructions)
        post_estimate = self._measure_request_basis(updated, messages, tools)
        trimmed = None
        output_reduced = False

        if post_estimate >= hard_limit:
            if post_estimate < adaptive_input_limit:
                output_reduced = True
            else:
                # 输出额度已降到最小值仍放不下时，再裁剪当前轮工具结果。
                # 这里只改本次发送副本，落盘历史保持完整。
                trimmed = self._trim_oversized_tool_results(
                    messages, tools, adaptive_input_limit
                )

                if trimmed is None:
                    raise ContextLimitError(
                        f"摘要与当前任务估算 {post_estimate} token，超过可用输入预算 "
                        f"{adaptive_input_limit}，未修改摘要边界"
                    )

                post_estimate = self.estimate_tokens({"messages": trimmed, "tools": tools})

        # 软阈值触发但压缩后没省下 token：这次压缩只会改写摘要坑位、让刚缓存的
        # 整段前缀失效，收益为零。保留原请求，等历史继续增长后再压。
        # 超过硬上限时不适用——那种情况必须压出空间才能发出请求。
        if not force and measured_estimate < hard_limit and post_estimate >= measured_estimate:
            print(f"[LocalContext] compression_no_gain conversation={conversation_id} "
                  f"input_basis={measured_estimate} post_basis={post_estimate} cut={end}")
            yield {
                "type": "context_compression_status",
                "status": "skipped",
                "content": "压缩未能减少上下文，已保留当前请求",
                "raw_input_tokens": measured_estimate,
                "post_raw_input_tokens": post_estimate,
                "context_window": window,
            }
            return original_messages

        record = {"summary": summary, "history_cut_index": end, "created_at": time.time(), "model_name": self.provider.config.model, "usage": usages}
        self.store.save_context(conversation_id, record, history[:end], injections=rebuild_messages)

        if trimmed is not None:
            print(f"[LocalContext] post_compression_trimmed conversation={conversation_id} "
                  f"post_basis={post_estimate} input_budget={adaptive_input_limit}")
        elif output_reduced:
            print(f"[LocalContext] compressed_with_reduced_output conversation={conversation_id} "
                  f"post_basis={post_estimate} configured_output={output} window={window}")

        print(f"[LocalContext] compressed conversation={conversation_id} cut={end} "
              f"input_basis={measured_estimate} post_basis={post_estimate} batches={len(usages)}")
        if trimmed is not None:
            status_content = "上下文压缩完成（当前轮工具结果已降级裁剪）"
        elif output_reduced:
            status_content = "上下文压缩完成（本轮输出上限已调整）"
        else:
            status_content = "上下文压缩完成"

        yield {
            "type": "context_compression_status",
            "status": "done",
            "content": status_content,
            "history_cut_index": end,
            "summary_chars": len(summary),
            "summary_text": summary,
            "raw_input_tokens": measured_estimate,
            "post_raw_input_tokens": post_estimate,
            "saved_tokens": max(0, measured_estimate - post_estimate),
            "saved_ratio": (max(0, measured_estimate - post_estimate) / measured_estimate) if measured_estimate > 0 else 0.0,
            "context_window": window,
        }
        return trimmed if trimmed is not None else messages
