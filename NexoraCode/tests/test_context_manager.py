"""隔离测试：不加载用户配置、不联网、不读取现有会话。"""
import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


class ContextTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.saved_modules = dict(sys.modules)
        package = types.ModuleType("test_model")
        package.__path__ = [str(ROOT / "model")]
        sys.modules["test_model"] = package
        core = types.ModuleType("core.config")
        core.get_app_root = lambda: Path(self.temp.name)
        core.config = {}
        self.runtime_config = core.config
        sys.modules["core.config"] = core
        self.provider_module = module("test_model.Provider", ROOT / "model/Provider.py")
        self.store_module = module("test_model.ConversationStore", ROOT / "model/ConversationStore.py")
        self.context_module = module("test_model.ContextManager", ROOT / "model/ContextManager.py")
        self.store = self.store_module.ConversationStore()
        self.conversation = self.store.create()
        self.cid = self.conversation["conversation_id"]
        self.calls = []
        calls = self.calls

        class Provider:
            config = types.SimpleNamespace(context_window=2200, max_tokens=256, model="test")

            def stream_chat(self, messages, **kwargs):
                calls.append((messages, kwargs))
                yield {"type": "content", "delta": "保留项目路径和已确认任务"}
                yield {"type": "usage", "usage": {"prompt_tokens": 500, "completion_tokens": 12}}
                yield {"type": "finish", "finish_reason": "stop"}

            def cancel(self):
                pass

        self.provider = Provider()
        self.manager = self.context_module.ContextManager(self.provider, self.store)

    def test_provider_retries_errors_before_output_using_configured_limit(self):
        provider_module = self.provider_module
        config = provider_module.ProviderConfig(
            name="test",
            base_url="https://provider.test",
            model="test-model",
        )
        client = provider_module.ProviderClient(config)
        client._cancel_event.wait = lambda _delay: False

        class Raw:
            def stream(self, amt, decode_content=False):
                yield (
                    b'data: {"choices":[{"delta":{"content":"retried"},'
                    b'"finish_reason":null}]}\n\n'
                )
                yield b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
                yield b"data: [DONE]\n\n"

        class Response:
            status_code = 200
            raw = Raw()

            def close(self):
                pass

        class ErrorRaw:
            def stream(self, amt, decode_content=False):
                yield b'data: {"error":{"code":"busy","message":"temporary upstream failure"}}\n\n'

        class ErrorResponse:
            status_code = 200
            raw = ErrorRaw()

            def close(self):
                pass

        class Session:
            def __init__(self):
                self.calls = 0

            def post(self, *args, **kwargs):
                self.calls += 1

                if self.calls == 1:
                    raise OSError("temporary connection failure")

                if self.calls == 2:
                    return ErrorResponse()

                return Response()

        session = Session()
        client._session = session
        self.runtime_config["local_auto_retry_count"] = 2

        events = list(client.stream_chat([{"role": "user", "content": "hello"}]))

        self.assertEqual(session.calls, 3)
        self.assertEqual([event.get("delta") for event in events if event["type"] == "content"], ["retried"])
        self.assertEqual(events[-1], {"type": "finish", "finish_reason": "stop"})

    def test_retry_settings_use_requested_defaults_and_reject_invalid_values(self):
        retry_settings = module("test_model.RetrySettings", ROOT / "model/RetrySettings.py")

        self.assertEqual(retry_settings.DEFAULT_ERROR_RETRY_COUNT, 5)
        self.assertEqual(retry_settings.DEFAULT_EMPTY_RESPONSE_RETRY_COUNT, 2)
        self.assertEqual(retry_settings.configured_retry_count(self.runtime_config, "local_auto_retry_count", 5), 5)
        self.assertEqual(retry_settings.configured_retry_count(self.runtime_config, "local_empty_response_retry_count", 2), 2)

        with self.assertRaises(ValueError):
            retry_settings.normalize_retry_count(11)

    def tearDown(self):
        for name in set(sys.modules) - set(self.saved_modules):
            del sys.modules[name]
        sys.modules.update(self.saved_modules)
        self.temp.cleanup()

    def add(self, role, content, **extra):
        self.store.append_message(self.cid, {"role": role, "content": content, **extra})

    @staticmethod
    def consume(generator):
        events = []

        while True:
            try:
                events.append(next(generator))
            except StopIteration as done:
                return events, done.value

    def build_agent_loop(self, provider):
        local = types.ModuleType("local")
        local.ToolExecutor = object
        sys.modules["local"] = local
        agent_module = module("test_model.AgentLoop", ROOT / "model/AgentLoop.py")

        class Executor:
            def list_tools_llm_format(self):
                return [{
                    "type": "function",
                    "function": {"name": "local_test_tool", "parameters": {"type": "object"}},
                }]

        agent_module.evaluate_tool_call = lambda *args, **kwargs: {
            "decision": "allow",
            "mode": "auto",
            "call": {"tool_name": "local_test_tool", "operation": "read"},
        }
        loop = agent_module.AgentLoop(provider, Executor(), self.store)
        loop._execute_tool = lambda *args, **kwargs: {
            "success": True,
            "content": "工具结果",
        }

        return loop

    @staticmethod
    def tool_call_events():
        return [
            {"type": "content", "delta": "正在读取。"},
            {
                "type": "tool_call",
                "index": 0,
                "id": "call-1",
                "name": "local_test_tool",
                "arguments_delta": "{}",
            },
            {"type": "finish", "finish_reason": "tool_calls"},
        ]

    def test_empty_post_tool_response_retries_and_returns_body(self):
        class Provider:
            config = types.SimpleNamespace(context_window=8000, max_tokens=4096, model="test")

            def __init__(self):
                self.calls = []

            def stream_chat(inner_self, messages, **kwargs):
                inner_self.calls.append((messages, kwargs))
                call_index = len(inner_self.calls)

                if call_index == 1:
                    events = self.tool_call_events()
                elif call_index == 2:
                    events = [
                        {"type": "reasoning_content", "delta": "只有推理，没有正文。"},
                        {"type": "usage", "usage": {"prompt_tokens": 500, "completion_tokens": 4096,
                                                       "total_tokens": 4596}},
                        {"type": "finish", "finish_reason": "length"},
                    ]
                else:
                    events = [
                        {"type": "content", "delta": "已根据工具结果完成回答。"},
                        {"type": "finish", "finish_reason": "stop"},
                    ]

                yield from events

            def cancel(self):
                pass

        provider = Provider()
        loop = self.build_agent_loop(provider)
        events = list(loop.stream_send(self.cid, "请读取并回答", system_prompt="system"))

        self.assertEqual(len(provider.calls), 3)
        retry_messages = provider.calls[2][0]
        self.assertTrue(any(message.get("role") == "tool" and message.get("content") == "工具结果"
                            for message in retry_messages))
        self.assertIn("上一轮工具结果已经返回", retry_messages[-1]["content"])
        self.assertEqual(sum(event["type"] == "done" for event in events), 1)
        self.assertFalse(any(event["type"] == "error" for event in events))

        saved = self.store.get(self.cid)
        empty_final_assistants = [
            message for message in saved["messages"]
            if message.get("role") == "assistant" and not message.get("tool_calls")
            and not str(message.get("content") or "").strip()
        ]
        self.assertFalse(empty_final_assistants)
        self.assertEqual(saved["messages"][-1]["content"], "已根据工具结果完成回答。")

    def test_empty_post_tool_response_retry_is_bounded_and_reported(self):
        class Provider:
            config = types.SimpleNamespace(context_window=8000, max_tokens=4096, model="test")

            def __init__(inner_self):
                inner_self.calls = 0

            def stream_chat(inner_self, messages, **kwargs):
                inner_self.calls += 1

                if inner_self.calls == 1:
                    yield from self.tool_call_events()
                else:
                    yield {"type": "reasoning_content", "delta": "没有正文。"}
                    yield {"type": "finish", "finish_reason": "length"}

            def cancel(self):
                pass

        provider = Provider()
        events = list(self.build_agent_loop(provider).stream_send(
            self.cid, "请读取并回答", system_prompt="system",
        ))

        self.assertEqual(provider.calls, 4)
        self.assertFalse(any(event["type"] == "done" for event in events))
        errors = [event for event in events if event["type"] == "error"]
        self.assertEqual(len(errors), 1)
        self.assertIn("自动重试 2 次后仍没有生成正文", errors[0]["message"])

    def test_empty_response_without_tool_is_reported_without_retry(self):
        class Provider:
            config = types.SimpleNamespace(context_window=8000, max_tokens=4096, model="test")

            def __init__(inner_self):
                inner_self.calls = 0

            def stream_chat(inner_self, messages, **kwargs):
                inner_self.calls += 1
                yield {"type": "reasoning_content", "delta": "只有推理。"}
                yield {"type": "finish", "finish_reason": "length"}

            def cancel(self):
                pass

        provider = Provider()
        events = list(self.build_agent_loop(provider).stream_send(
            self.cid, "新请求", system_prompt="system",
        ))

        self.assertEqual(provider.calls, 1)
        self.assertFalse(any(event["type"] == "done" for event in events))
        errors = [event for event in events if event["type"] == "error"]
        self.assertEqual(len(errors), 1)
        self.assertIn("已达到单轮输出上限", errors[0]["message"])

    def test_short_context_reduces_request_output_limit(self):
        self.provider.config.context_window = 8192
        self.provider.config.max_tokens = 4096
        self.add("user", "短上下文问题" * 1000)
        conversation = self.store.get(self.cid)
        messages = self.manager.build_messages(conversation, "system")
        events, prepared = self.consume(self.manager.prepare(self.cid, "system", []))

        self.assertEqual(events[-1]["status"], "output_limited")
        self.assertEqual(prepared, messages)

        output_limit = self.manager.request_output_limit(self.cid, prepared, [])

        self.assertLess(output_limit, self.provider.config.max_tokens)
        self.assertGreaterEqual(output_limit, self.manager._MIN_REQUEST_OUTPUT_TOKENS)

    def test_agent_passes_reduced_output_limit_to_provider(self):
        class Provider:
            config = types.SimpleNamespace(context_window=8192, max_tokens=4096, model="test")

            def __init__(inner_self):
                inner_self.request_limits = []

            def stream_chat(inner_self, messages, **kwargs):
                inner_self.request_limits.append(kwargs.get("max_tokens"))
                yield {"type": "content", "delta": "已完成。"}
                yield {"type": "finish", "finish_reason": "stop"}

            def cancel(self):
                pass

        provider = Provider()
        loop = self.build_agent_loop(provider)

        list(loop.stream_send(self.cid, "短上下文问题" * 1000, system_prompt="system"))

        self.assertEqual(len(provider.request_limits), 1)
        self.assertGreaterEqual(provider.request_limits[0], loop.context_manager._MIN_REQUEST_OUTPUT_TOKENS)
        self.assertLess(provider.request_limits[0], provider.config.max_tokens)

    def test_batch_compression_preserves_history_and_active_tool_round(self):
        for _ in range(5):
            self.add("user", "旧任务" * 100)
            self.add("assistant", "验证记录" * 100)

        self.add("user", "当前问题")
        self.add("assistant", "", tool_calls=[{"id": "a", "name": "read", "arguments": {"path": "F:/项目"}}])
        self.add("tool", "当前工具结果", tool_call_id="a")
        tools = [{"type": "function", "function": {"name": "local_file_read", "parameters": {}}}]
        before = self.store.get(self.cid)["messages"]
        events, messages = self.consume(self.manager.prepare(self.cid, "system", tools, force=True))
        self.assertGreater(len(self.calls), 1)
        self.assertEqual(self.store.get(self.cid)["messages"], before)
        self.assertEqual(self.store.get(self.cid)["context_state"]["history_cut_index"], 10)
        self.assertEqual(messages[-1]["content"], "当前工具结果")
        self.assertFalse(any(m.get("content") == "当前问题" for request, _ in self.calls for m in request))
        self.assertEqual(events[-1]["status"], "done")
        # 摘要正文流式展示：progress 事件应带 summary_text（边生成边推给前端）。
        progress_events = [e for e in events if e.get("status") == "progress"]
        self.assertTrue(progress_events, "应产生带摘要正文的 progress 事件")
        self.assertTrue(any(str(e.get("summary_text") or "") for e in progress_events),
                        "progress 事件应携带累积摘要正文")
        # done 事件应带完整摘要与压缩统计（前端卡片展开区据此渲染）。
        done_event = events[-1]
        self.assertEqual(done_event["summary_text"], self.store.get(self.cid)["context_state"]["summary"])
        self.assertGreater(done_event["raw_input_tokens"], 0)
        self.assertIn("saved_tokens", done_event)
        self.assertIn("saved_ratio", done_event)
        # 摘要请求必须带与主请求相同的 tools，否则 tools 块让两次请求的提示词前缀分叉。
        self.assertEqual(self.calls[0][1]["tools"], tools)
        # 摘要只需要文本输出，工具调用一律判错。
        self.assertEqual(self.calls[0][1]["tool_choice"], "none")
        # 摘要请求的消息（去掉尾部 instruction）必须是主请求消息的逐字节前缀，
        # 两次请求的提示词前缀才可能命中同一份 provider 缓存。
        summarizer_messages = self.calls[0][0][:-1]
        main_messages = [{"role": "system", "content": "system"}] + [self.manager.message_payload(m) for m in before]
        self.assertEqual(summarizer_messages, main_messages[:len(summarizer_messages)])
        self.assertEqual(self.manager.build_messages(self.store.get(self.cid), "system"), messages)

    def test_small_history_does_not_call_model(self):
        self.add("user", "hello")
        events, messages = self.consume(self.manager.prepare(self.cid, "system", []))
        self.assertEqual(events, [])
        self.assertEqual(self.calls, [])
        self.assertEqual(messages[-1]["content"], "hello")

    def test_oversized_active_turn_fails_without_deleting_history(self):
        self.add("user", "中文" * 2000)
        with self.assertRaises(self.context_module.ContextLimitError):
            self.consume(self.manager.prepare(self.cid, "system", []))
        self.assertEqual(len(self.store.get(self.cid)["messages"]), 1)

    def test_post_compression_overflow_trims_active_turn_instead_of_failing(self):
        """压缩历史后仍超窗时，应降级裁剪当前轮工具结果，而不是报错。

        场景：历史有可压缩轮次（触发压缩），但当前轮本身带大量工具结果，
        压缩历史后仍装不下。旧行为直接抛 ContextLimitError 让对话卡死。
        """
        for _ in range(5):
            self.add("user", "旧任务" * 100)
            self.add("assistant", "验证记录" * 100)
        self.add("user", "读一下大文件")
        self.add("assistant", "", tool_calls=[{"id": "a", "name": "read", "arguments": {"path": "big"}}])
        self.add("tool", "正文内容" * 3000, tool_call_id="a")
        tools = [{"type": "function", "function": {"name": "local_file_read", "parameters": {}}}]
        before = self.store.get(self.cid)["messages"]
        events, messages = self.consume(self.manager.prepare(self.cid, "system", tools, force=True))
        # 不报错，且压缩边界已推进。
        self.assertEqual(events[-1]["status"], "done")
        self.assertIn("context_state", self.store.get(self.cid))
        # 落盘历史保持完整，裁剪只作用于本次发送副本。
        self.assertEqual(self.store.get(self.cid)["messages"], before)
        # 工具配对关系不能被裁剪破坏。
        self.manager.validate_tools(messages)

    def test_oversized_tool_result_is_trimmed_instead_of_failing(self):
        """当前轮工具结果超窗时降级裁剪，而不是让对话彻底失败。"""

        self.add("user", "读一下大文件")
        self.add("assistant", "", tool_calls=[{"id": "a", "name": "read", "arguments": {"path": "big"}}])
        self.add("tool", "正文内容" * 3000, tool_call_id="a")
        tools = [{"type": "function", "function": {"name": "local_file_read", "parameters": {}}}]
        before = self.store.get(self.cid)["messages"]
        events, messages = self.consume(self.manager.prepare(self.cid, "system", tools))
        # 落盘历史保持原文完整，裁剪只作用于本次发送副本。
        self.assertEqual(self.store.get(self.cid)["messages"], before)
        self.assertEqual(events[-1]["status"], "trimmed")
        trimmed = messages[-1]["content"]
        self.assertLess(len(trimmed), len("正文内容" * 3000))
        self.assertIn("已省略中间", trimmed)
        # 工具配对关系不能被裁剪破坏。
        self.manager.validate_tools(messages)

    def test_tool_result_trim_uses_input_budget_once_for_short_context(self):
        """输入预算已经扣除输出额度，裁剪不能再重复扣除一次。"""

        self.provider.config.context_window = 8192
        self.provider.config.max_tokens = 4096
        self.add("user", "读一下大文件")
        self.add("assistant", "", tool_calls=[{"id": "a", "name": "read", "arguments": {"path": "big"}}])
        self.add("tool", "正文内容" * 5000, tool_call_id="a")
        tools = [{"type": "function", "function": {"name": "local_file_read", "parameters": {}}}]

        events, messages = self.consume(self.manager.prepare(self.cid, "system", tools))

        self.assertEqual(events[-1]["status"], "trimmed")
        input_estimate = self.manager.estimate_tokens({"messages": messages, "tools": tools})
        self.assertLess(
            input_estimate,
            self.provider.config.context_window
            - self.manager._minimum_request_output_tokens()
            - self.manager._input_safety_margin(self.provider.config.context_window),
        )
        self.assertLess(
            self.manager.request_output_limit(self.cid, messages, tools),
            self.provider.config.max_tokens,
        )
        self.manager.validate_tools(messages)

    def test_volatile_instructions_go_to_tail_and_head_stays_constant(self):
        """tail 注入块插在历史之后；head 不因注入内容变化。"""

        self.add("user", "任务")
        head = "恒定 head"
        blocks = ["## Custom instructions\n自定义要求"]
        messages = self.manager.build_messages(self.store.get(self.cid), head, blocks)
        self.assertEqual(messages[0], {"role": "system", "content": head})
        self.assertEqual(messages[-1], {"role": "system", "content": blocks[0]})
        # 同一 head 在有无注入时逐字节相同，前缀缓存才可能命中。
        plain = self.manager.build_messages(self.store.get(self.cid), head)
        self.assertEqual(plain[0], messages[0])
        self.assertEqual(plain[-1]["content"], "任务")

    def test_cancel_does_not_commit_summary(self):
        self.add("user", "旧任务")
        self.add("assistant", "结果")
        self.add("user", "当前任务")
        with self.assertRaisesRegex(RuntimeError, "CANCELLED"):
            self.consume(self.manager.prepare(self.cid, "system", [], force=True, cancel_checker=lambda: True))
        self.assertNotIn("context_state", self.store.get(self.cid))

    def test_missing_tool_result_is_repaired_not_rejected(self):
        """悬空工具调用（进程被外部终止）应补占位结果，而不是让会话永久卡死。"""
        self.add("assistant", "", tool_calls=[{"id": "a", "name": "read", "arguments": {}}])
        self.add("user", "next")
        messages = self.manager.build_messages(self.store.get(self.cid), "system")
        # 补齐后协议完整，可正常校验通过。
        self.manager.validate_tools(messages)
        repaired = [m for m in messages if m.get("role") == "tool"]
        self.assertEqual(len(repaired), 1)
        self.assertEqual(repaired[0]["tool_call_id"], "a")
        self.assertIn("未返回结果", repaired[0]["content"])
        # 占位结果必须紧跟在悬空调用之后，且 user 消息仍在其后。
        roles = [m["role"] for m in messages]
        self.assertEqual(roles, ["system", "assistant", "tool", "user"])

    def test_dangling_tool_calls_are_persisted_repaired(self):
        """落盘自愈：修补一次即长期有效，后续请求不再需要临时打补丁。"""
        self.add("user", "任务")
        self.add("assistant", "", tool_calls=[{"id": "a", "name": "read", "arguments": {}}])
        self.add("user", "next")
        added = self.store.repair_dangling_tool_calls(self.cid)
        self.assertEqual(added, 1)
        saved = self.store.get(self.cid)["messages"]
        self.assertEqual([m["role"] for m in saved], ["user", "assistant", "tool", "user"])
        self.assertEqual(saved[2]["tool_call_id"], "a")
        # 已修复的历史再次调用不应重复插入。
        self.assertEqual(self.store.repair_dangling_tool_calls(self.cid), 0)
        self.assertEqual(len(self.store.get(self.cid)["messages"]), 4)

    def test_orphan_tool_result_is_dropped(self):
        """孤儿工具结果（找不到对应调用）应丢弃，避免污染请求。"""
        self.add("user", "任务")
        self.add("tool", "无主结果", tool_call_id="ghost")
        self.add("assistant", "回答")
        messages = self.manager.build_messages(self.store.get(self.cid), "system")
        self.assertFalse(any(m.get("role") == "tool" for m in messages))
        self.manager.validate_tools(messages)

    def test_truncated_summary_is_kept_instead_of_failing(self):
        """摘要被输出上限截断时保留已生成部分，而不是让整轮对话直接报错。

        旧行为（finish_reason=length 即抛 ContextLimitError）会让小窗口模型
        的会话彻底卡死：摘要需整合已有摘要与新历史，很容易触顶。
        """
        self.add("user", "old")
        self.add("assistant", "old result")
        self.add("user", "new")

        def truncated(*args, **kwargs):
            yield {"type": "content", "delta": "incomplete"}
            yield {"type": "finish", "finish_reason": "length"}

        self.provider.stream_chat = truncated
        events, _messages = self.consume(self.manager.prepare(self.cid, "system", [], force=True))
        # 截断摘要仍应提交，压缩边界推进，对话可继续。
        self.assertEqual(events[-1]["status"], "done")
        self.assertIn("context_state", self.store.get(self.cid))
        self.assertEqual(self.store.get(self.cid)["context_state"]["summary"], "incomplete")

    def test_full_agent_uses_summary_and_accounts_compression_separately(self):
        local = types.ModuleType("local")
        local.ToolExecutor = object
        sys.modules["local"] = local
        agent = module("test_model.AgentLoop", ROOT / "model/AgentLoop.py")
        self.add("user", "此前任务")
        self.add("assistant", "已完成验证")

        class Executor:
            def list_tools_llm_format(self):
                return []

        events = list(agent.AgentLoop(self.provider, Executor(), self.store).stream_send(
            self.cid, "新任务", system_prompt="system", force_context_compression=True,
        ))
        self.assertTrue(any(e["type"] == "context_compression_status" and e["status"] == "done" for e in events))
        saved = self.store.get(self.cid)
        self.assertEqual(len(saved["context_compression_calls"]), 1)
        self.assertEqual(saved["context_state"]["history_cut_index"], 2)
        self.assertEqual(self.calls[-1][0][-1]["content"], "新任务")
        self.assertNotIn("此前任务", str(self.calls[-1][0]))
        # 压缩终态必须落盘进 assistant metadata：否则重进对话后压缩卡片消失，
        # 用户只看到 token 从接近满窗骤降却没有任何解释。
        persisted = [
            m.get("metadata", {}).get("context_compression")
            for m in saved["messages"]
            if m.get("role") == "assistant"
        ]
        persisted = [p for p in persisted if p]
        self.assertTrue(persisted, "压缩终态应写入 assistant metadata.context_compression")
        self.assertEqual(persisted[-1]["status"], "done")
        self.assertEqual(persisted[-1]["history_cut_index"], 2)

    def test_invalid_context_budget_is_rejected_before_saving(self):
        config_class = self.provider_module.ProviderConfig
        valid = config_class(provider_id="p1", name="可用", model="m1", max_tokens=4096, context_window=128000)
        zero_window = config_class(provider_id="p2", name="零窗口", model="m2", max_tokens=4096, context_window=0)
        too_small = config_class(provider_id="p3", name="窗口过小", model="m3", max_tokens=4096, context_window=2048)

        with self.assertRaisesRegex(ValueError, "上下文窗口必须大于 0"):
            self.provider_module.validate_context_budget([zero_window])

        with self.assertRaisesRegex(ValueError, "必须小于上下文窗口"):
            self.provider_module.validate_context_budget([too_small])

        self.provider_module.validate_context_budget([valid])
        self.provider_module.save_providers([valid], "p1")
        self.assertEqual([p.provider_id for p in self.provider_module.load_providers()], ["p1"])

    def test_cached_tokens_cover_known_and_custom_vendor_keys(self):
        extract = self.provider_module._extract_usage_io

        standard = extract({"prompt_tokens": 1000, "completion_tokens": 50,
                            "prompt_tokens_details": {"cached_tokens": 700}})
        self.assertEqual(standard["cached_input"], 700)
        self.assertEqual(standard["cached_tokens_source"], "prompt_tokens_details.cached_tokens")
        self.assertEqual(standard["effective_input"], 300)

        deepseek = extract({"prompt_tokens": 900, "completion_tokens": 10, "prompt_cache_hit_tokens": 512})
        self.assertEqual(deepseek["cached_input"], 512)
        self.assertEqual(deepseek["cached_tokens_source"], "prompt_cache_hit_tokens")

        # 固定候选键未命中时退回启发式扫描，兼容顶层自定义命名的兼容端点。
        custom = extract({"prompt_tokens": 800, "completion_tokens": 20, "vendor_cache_read_tokens": 640})
        self.assertEqual(custom["cached_input"], 640)
        self.assertEqual(custom["cached_tokens_source"], "vendor_cache_read_tokens")

    def test_cache_creation_tokens_are_not_counted_as_hits(self):
        """缓存写入量不是命中，误当命中会把计费输入压到 0。"""
        usage = {"prompt_tokens": 1000, "completion_tokens": 40,
                 "cache_creation_input_tokens": 900, "cached_tokens": 100}
        io = self.provider_module._extract_usage_io(usage)
        self.assertEqual(io["cached_input"], 100)
        self.assertEqual(io["effective_input"], 900)

        only_creation = self.provider_module._extract_usage_io(
            {"prompt_tokens": 1000, "completion_tokens": 40, "cache_creation_input_tokens": 900})
        self.assertEqual(only_creation["cached_input"], 0)
        self.assertEqual(only_creation["effective_input"], 1000)

    def test_cached_tokens_never_exceed_raw_input(self):
        io = self.provider_module._extract_usage_io({"prompt_tokens": 100, "completion_tokens": 5,
                                                     "prompt_tokens_details": {"cached_tokens": 900}})
        self.assertEqual(io["cached_input"], 100)
        self.assertEqual(io["effective_input"], 0)

    def test_invalid_context_budget_error_names_the_model(self):
        self.provider.config.context_window = 0
        self.add("user", "hello")

        with self.assertRaises(self.context_module.ContextLimitError) as caught:
            self.consume(self.manager.prepare(self.cid, "system", []))

        message = str(caught.exception)
        self.assertIn("test", message)
        self.assertIn("上下文窗口 0", message)

    def test_full_agent_records_trace_and_cache_detail_per_round(self):
        local = types.ModuleType("local")
        local.ToolExecutor = object
        sys.modules["local"] = local
        agent = module("test_model.AgentLoop", ROOT / "model/AgentLoop.py")

        class Provider:
            config = types.SimpleNamespace(context_window=8000, max_tokens=256, model="test")

            def stream_chat(self, messages, **kwargs):
                yield {"type": "content", "delta": "第一轮回答"}
                yield {"type": "usage", "usage": {"prompt_tokens": 4000, "completion_tokens": 30,
                                                   "prompt_tokens_details": {"cached_tokens": 3000}}}
                yield {"type": "finish", "finish_reason": "stop"}

            def cancel(self):
                pass

        self.add("user", "新任务")
        events = list(agent.AgentLoop(Provider(), type("E", (), {"list_tools_llm_format": lambda self: []})(),
                                      self.store).stream_send(self.cid, "新任务", system_prompt="system"))
        self.assertTrue(any(e["type"] == "done" for e in events))

        saved = self.store.get(self.cid)
        assistant = [m for m in saved["messages"] if m.get("role") == "assistant"][-1]
        metadata = assistant["metadata"]
        io = metadata["io_tokens"]

        # 每次请求一个 trace，轮次序号从 1 开始。
        self.assertEqual(len(metadata["response_trace_id"]), 32)
        self.assertEqual(metadata["round_index"], 1)
        # 缓存命中落到 io_tokens，并带上命中来源。
        self.assertEqual(io["cached_input"], 3000)
        self.assertEqual(io["cached_tokens_source"], "prompt_tokens_details.cached_tokens")
        self.assertEqual(io["input"], 1000)
        # 合计口径是原始输入 + 输出，不因命中扣减。
        self.assertEqual(metadata["io_tokens_cumulative"]["input"], 1000)
        self.assertEqual(metadata["io_tokens_cumulative"]["raw_input"], 4000)

    def test_badge_snapshot_carries_cache_data_on_cancel(self):
        """中断落盘也要带缓存命中，否则徽标只剩输出没有命中率。"""
        local = types.ModuleType("local")
        local.ToolExecutor = object
        sys.modules["local"] = local
        agent = module("test_model.AgentLoop", ROOT / "model/AgentLoop.py")

        class Provider:
            config = types.SimpleNamespace(context_window=8000, max_tokens=256, model="test")

            def __init__(self):
                self.calls = 0

            def stream_chat(self, messages, **kwargs):
                self.calls += 1
                yield {"type": "content", "delta": "第一段"}
                yield {"type": "usage", "usage": {"prompt_tokens": 5000, "completion_tokens": 20,
                                                   "prompt_tokens_details": {"cached_tokens": 4000}}}
                yield {"type": "finish", "finish_reason": "stop"}
                if self.calls >= 1:
                    # 产出后立刻置位取消，模拟用户在正文刚出现时点停。
                    self.cancelled["hit"] = True

            def cancel(self):
                pass

        provider = Provider()
        provider.cancelled = {"hit": False}
        self.add("user", "任务")
        executor = type("E", (), {"list_tools_llm_format": lambda self: []})()
        list(agent.AgentLoop(provider, executor, self.store).stream_send(
            self.cid, "任务", system_prompt="system", cancel_checker=lambda: provider.cancelled["hit"]))

        saved = self.store.get(self.cid)
        assistant = [m for m in saved["messages"] if m.get("role") == "assistant"]

        self.assertTrue(assistant, "取消前已产出的正文应落盘")
        timing = assistant[-1]["metadata"]["badge_timing"]
        self.assertEqual(timing["cachedInput"], 4000)
        self.assertEqual(timing["rawInput"], 5000)
        self.assertGreater(timing["endedAt"], 0)

    def test_compression_is_skipped_after_the_first_round_of_a_request(self):
        """非首轮越过软阈值也不压缩：保住本请求已缓存的前缀。"""
        # 窗口/输出比要留出软硬阈值之间的带：threshold=18000，hard_limit=19000。
        self.provider.config.context_window = 20000
        self.provider.config.max_tokens = 1000
        filler = "旧任务" * 463

        for _ in range(5):
            self.add("user", filler)
            self.add("assistant", filler)

        self.add("user", "当前问题")
        self.calls.clear()
        events, messages = self.consume(self.manager.prepare(self.cid, "system", [], allow_compression=False))
        self.assertEqual(self.calls, [], "非首轮不应发起摘要请求")
        self.assertEqual(events, [], "未压缩时不应推送压缩状态事件")
        self.assertNotIn("context_state", self.store.get(self.cid))
        self.assertEqual(messages[-1]["content"], "当前问题")

    def test_compression_still_runs_when_a_late_round_would_overflow(self):
        """非首轮真的装不下时仍要压缩，宁可丢一次缓存也不能让请求发不出去。"""
        self.provider.config.context_window = 20000
        self.provider.config.max_tokens = 1000
        # 10 条 × 2100 字 ≈ 21000 tokens，越过 hard_limit=19000。
        filler = "旧任务" * 700

        for _ in range(5):
            self.add("user", filler)
            self.add("assistant", filler)

        self.add("user", "当前问题")
        self.calls.clear()
        events, messages = self.consume(self.manager.prepare(self.cid, "system", [], allow_compression=False))
        self.assertTrue(self.calls, "硬上限之下必须兜底压缩")
        self.assertEqual(events[-1]["status"], "done")
        self.assertIn("history_cut_index", self.store.get(self.cid)["context_state"])
        self.assertEqual(messages[-1]["content"], "当前问题")

    def test_request_basis_anchors_on_measured_provider_input(self):
        """占用判定以 provider 实测为锚：历史部分一个字符都不重估。"""
        self.add("user", "第一轮")
        conversation = self.store.get(self.cid)
        messages = self.manager.build_messages(conversation, "system")
        # 故意让实测值远低于估算值：若实现仍在重估整段历史，判定值不可能等于实测值。
        plain = self.manager.estimate_tokens({"messages": messages, "tools": []})
        measured = int(plain * 0.4)
        self.store.record_context_usage(self.cid, measured, len(messages), plain)

        # 无新增消息时，判定值必须就是实测值本身。
        updated = self.store.get(self.cid)
        self.assertEqual(
            self.manager._measure_request_basis(updated, self.manager.build_messages(updated, "system"), []),
            measured,
        )

        # 有新增消息时，历史部分用实测、增量只保守高估，总量不会低于实测 + 增量估算。
        self.add("assistant", "新增的一轮回答" * 20)
        grown = self.store.get(self.cid)
        grown_messages = self.manager.build_messages(grown, "system")
        # 锚点覆盖了 system + user，因此增量只有新追加的 assistant。
        fresh_plain = self.manager.estimate_tokens({"messages": grown_messages[len(messages):]})
        basis = self.manager._measure_request_basis(grown, grown_messages, [])
        self.assertGreaterEqual(basis, measured + fresh_plain)

    def test_marginal_rate_never_shrinks_the_increment(self):
        """实测边际速率低于 1 时也不得调低增量：宁可高估不可低估越窗。"""
        conversation = {"context_state": {
            "last_input_tokens": 9000, "prev_input_tokens": 6000,
            "last_estimated_tokens": 8000, "last_measured_message_count": 1,
        }}
        manager = self.manager
        # 实测增量 3000，估算增量 4000 -> 边际速率 0.75
        self.assertAlmostEqual(manager._measured_marginal_rate(conversation, 12000), 0.75)
        messages = [{"role": "system", "content": "s"}] + [{"role": "user", "content": "x" * 60}] * 3
        basis = manager._measure_request_basis(conversation, messages, [])
        # 增量的 3 条消息按原估算计入，不被 0.75 打折
        self.assertGreaterEqual(basis, 9000 + manager.estimate_tokens({"messages": messages[1:]}))

    def test_marginal_rate_is_clamped_when_provider_report_is_absurd(self):
        conversation = {"context_state": {
            "last_input_tokens": 900000, "prev_input_tokens": 100,
            "last_estimated_tokens": 200, "last_measured_message_count": 1,
        }}
        self.assertEqual(self.manager._measured_marginal_rate(conversation, 1000), 10.0)

    def test_request_basis_falls_back_to_plain_estimate_without_measurement(self):
        """首轮没有实测基线时退回整体估算，不能凭空认定占用。"""
        self.add("user", "第一轮")
        conversation = self.store.get(self.cid)
        messages = self.manager.build_messages(conversation, "system")
        self.assertEqual(
            self.manager._measure_request_basis(conversation, messages, []),
            self.manager.estimate_tokens({"messages": messages, "tools": []}),
        )

    def test_measurement_anchor_is_dropped_when_summary_replaces_state(self):
        """摘要换代重写 context_state，旧锚点必须随之作废。"""
        self.add("user", "旧任务")
        self.add("assistant", "旧回答")
        self.store.record_context_usage(self.cid, 99999, 2, 120000)
        history = self.store.get(self.cid)["messages"]
        self.store.save_context(self.cid, {"summary": "摘要", "history_cut_index": 2,
                                           "created_at": 0, "model_name": "test", "usage": []}, history[:2])
        state = self.store.get(self.cid)["context_state"]
        self.assertNotIn("last_input_tokens", state)
        self.assertNotIn("last_measured_message_count", state)

    def test_match_results_are_capped_with_omitted_marker(self):
        present = module("test_model.Present", ROOT / "model/Present.py")
        detail = {"matches": [{"path": f"src/f{i}.py", "line": i, "text": "调用 client"} for i in range(1000)],
                  "query": "client", "match_count": 1000}
        text = present.present_tool_result(detail)
        self.assertIn(f"... 另有 {1000 - present.MATCH_RESULT_LIMIT} 条匹配未显示 ...", text)
        self.assertEqual(text.count("src/f"), present.MATCH_RESULT_LIMIT)
        # match_count 仍回报真实总数，模型知道还有更多。
        self.assertIn("match_count=1000", text)

    def test_history_search_reads_original_unicode_coordinates(self):
        history_module = module("test_model.ContextHistory", ROOT / "model/ContextHistory.py")
        self.add("user", "项目目录 F:/中文项目 已确认")
        history = history_module.ContextHistory(self.store, self.cid)
        hit = history.search("中文项目")["hits"][0]
        fragment = history.read(hit["position"], hit["position"] + 4)
        self.assertEqual(fragment["text"], "中文项目")
        self.assertEqual(history.length()["length"], len(history.text))
        with self.assertRaises(ValueError):
            history.read(-1)


    def test_estimate_tokens_uses_cl100k_base(self):
        import json
        from unittest.mock import patch

        value = {"messages": [{"role": "user", "content": "hello world"}], "tools": []}
        serialized = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        encoding_names = []
        encoded_texts = []

        class FakeEncoding:
            def encode_ordinary(self, text):
                encoded_texts.append(text)

                return list(text)

        def get_encoding(name):
            encoding_names.append(name)

            return FakeEncoding()

        fake_tiktoken = types.SimpleNamespace(get_encoding=get_encoding)
        self.context_module.TokenEstimator._encoding.cache_clear()

        with patch.dict(sys.modules, {"tiktoken": fake_tiktoken}):
            estimated = self.manager.estimate_tokens(value)

        self.context_module.TokenEstimator._encoding.cache_clear()

        self.assertEqual(encoding_names, ["cl100k_base"])
        self.assertEqual(encoded_texts, [serialized])
        self.assertEqual(estimated, len(serialized))


if __name__ == "__main__":
    unittest.main()
