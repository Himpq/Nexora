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

    def test_batch_compression_preserves_history_and_active_tool_round(self):
        for _ in range(5):
            self.add("user", "旧任务" * 100)
            self.add("assistant", "验证记录" * 100)

        self.add("user", "当前问题")
        self.add("assistant", "", tool_calls=[{"id": "a", "name": "read", "arguments": {"path": "F:/项目"}}])
        self.add("tool", "当前工具结果", tool_call_id="a")
        before = self.store.get(self.cid)["messages"]
        events, messages = self.consume(self.manager.prepare(self.cid, "system", [], force=True))
        self.assertGreater(len(self.calls), 1)
        self.assertEqual(self.store.get(self.cid)["messages"], before)
        self.assertEqual(self.store.get(self.cid)["context_state"]["history_cut_index"], 10)
        self.assertEqual(messages[-1]["content"], "当前工具结果")
        self.assertFalse(any(m.get("content") == "当前问题" for request, _ in self.calls for m in request))
        self.assertEqual(events[-1]["status"], "done")
        self.assertEqual(self.calls[0][1]["tools"], None)
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

    def test_cancel_does_not_commit_summary(self):
        self.add("user", "旧任务")
        self.add("assistant", "结果")
        self.add("user", "当前任务")
        with self.assertRaisesRegex(RuntimeError, "CANCELLED"):
            self.consume(self.manager.prepare(self.cid, "system", [], force=True, cancel_checker=lambda: True))
        self.assertNotIn("context_state", self.store.get(self.cid))

    def test_missing_tool_result_rejected(self):
        self.add("assistant", "", tool_calls=[{"id": "a", "name": "read", "arguments": {}}])
        self.add("user", "next")
        with self.assertRaisesRegex(ValueError, "工具调用缺少结果"):
            self.manager.build_messages(self.store.get(self.cid), "system")

    def test_truncated_summary_does_not_commit(self):
        self.add("user", "old")
        self.add("assistant", "old result")
        self.add("user", "new")

        def truncated(*args, **kwargs):
            yield {"type": "content", "delta": "incomplete"}
            yield {"type": "finish", "finish_reason": "length"}

        self.provider.stream_chat = truncated
        with self.assertRaises(self.context_module.ContextLimitError):
            self.consume(self.manager.prepare(self.cid, "system", [], force=True))
        self.assertNotIn("context_state", self.store.get(self.cid))

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

    def test_invalid_context_budget_error_names_the_model(self):
        self.provider.config.context_window = 0
        self.add("user", "hello")

        with self.assertRaises(self.context_module.ContextLimitError) as caught:
            self.consume(self.manager.prepare(self.cid, "system", []))

        message = str(caught.exception)
        self.assertIn("test", message)
        self.assertIn("上下文窗口 0", message)

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


if __name__ == "__main__":
    unittest.main()
