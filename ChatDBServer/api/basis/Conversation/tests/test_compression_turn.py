"""
Append 式上下文压缩测试：压缩消息构建、marker 应用（摘要块分离）、事件换代裁剪
"""

import os
import sys
import unittest

# test file: ChatDBServer/api/basis/Conversation/tests/test_compression_turn.py
SERVER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
if os.path.join(SERVER_DIR, "api") not in sys.path:
    sys.path.insert(0, os.path.join(SERVER_DIR, "api"))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)
try:
    os.chdir(SERVER_DIR)
except Exception:
    pass

import prompts
from basis.Model.Context import ChatContextManager
from basis.Model.compression_turn import build_append_compression_messages


class TestBuildAppendCompressionMessages(unittest.TestCase):

    def test_slices_off_current_user_and_appends_instruction(self):
        messages = [
            {"role": "system", "content": "head"},
            {"role": "user", "content": "q1"},
            {"role": "assistant", "content": "a1"},
            {"role": "user", "content": "q2"},
            {"role": "assistant", "content": "a2"},
            {"role": "user", "content": "当前轮提问"},
        ]
        instruction = prompts.build_context_compression_append_prompt(6000)

        compress_messages, last_user_pos = build_append_compression_messages(messages, instruction)

        self.assertEqual(last_user_pos, 5)
        # 当前轮 user 被截掉，末尾是指令消息
        self.assertEqual(len(compress_messages), 6)
        self.assertEqual(compress_messages[-1]["role"], "user")
        self.assertEqual(compress_messages[-1]["content"], instruction)
        self.assertEqual(compress_messages[-2], {"role": "assistant", "content": "a2"})
        # 前缀与主请求逐字节一致（缓存命中前提）
        self.assertEqual(compress_messages[:5], messages[:5])

    def test_no_user_returns_empty(self):
        messages = [{"role": "system", "content": "head"}, {"role": "assistant", "content": "a"}]
        compress_messages, last_user_pos = build_append_compression_messages(messages, "指令")
        self.assertEqual(last_user_pos, -1)
        self.assertEqual(compress_messages, [])

    def test_user_at_zero_returns_empty(self):
        messages = [{"role": "user", "content": "q"}]
        compress_messages, last_user_pos = build_append_compression_messages(messages, "指令")
        self.assertEqual(last_user_pos, -1)
        self.assertEqual(compress_messages, [])

    def test_instruction_prompt_contains_rules(self):
        instruction = prompts.build_context_compression_append_prompt(6000)
        self.assertIn("上下文压缩任务", instruction)
        self.assertIn("6000", instruction)


class TestApplyLatestCompressionMarker(unittest.TestCase):
    """marker 应用：返回 (截断历史, 摘要块)，不再直接写入 context。"""

    def setUp(self):
        self.manager = ChatContextManager(model=None)

    def _marker(self, cut):
        return {"summary": "这是压缩摘要", "history_cut_index": cut}

    def test_returns_truncated_history_and_memory_block(self):
        history = [{"role": "user", "content": f"m{i}"} for i in range(5)]
        truncated, block = self.manager._apply_latest_compression_marker(history, self._marker(2))
        self.assertEqual(len(truncated), 2)
        self.assertIn("这是压缩摘要", block)
        self.assertIn("历史上下文压缩摘要", block)

    def test_invalid_marker_returns_untouched(self):
        history = [{"role": "user", "content": "m"}]
        truncated, block = self.manager._apply_latest_compression_marker(history, None)
        self.assertEqual(truncated, history)
        self.assertEqual(block, "")

    def test_cut_out_of_range_returns_untouched(self):
        history = [{"role": "user", "content": "m"}]
        truncated, block = self.manager._apply_latest_compression_marker(history, self._marker(5))
        self.assertEqual(truncated, history)
        self.assertEqual(block, "")


class TestPruneTurnEventsBefore(unittest.TestCase):
    """压缩换代：efm <= cut 的三类事件被裁掉，efm > cut 保留。"""

    def setUp(self):
        import tempfile

        self.tmpdir = tempfile.mkdtemp()
        self.username = f"test_compression_{os.path.basename(self.tmpdir).replace('-', '_')}"
        from basis.Conversation.repository import conversation_base_path as _cbp

        self.base_path = _cbp(self.username)
        os.makedirs(self.base_path, exist_ok=True)
        from basis.Conversation.service import ConversationService

        self.service = ConversationService(self.username)

    def tearDown(self):
        import shutil

        from basis.Conversation.repository import _server_data_root as _sdr

        user_dir = os.path.join(_sdr(), "users", self.username)
        if os.path.exists(user_dir):
            shutil.rmtree(user_dir, ignore_errors=True)
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _seed_events(self, cid):
        from basis.Conversation.repository import conversation_update_session
        from basis.Database import safe_write_json

        with conversation_update_session(self.username, cid) as (path, data):
            context = data["context"]
            context["knowledge_events"] = [
                {"mode": "append", "content": "k0", "effective_from_message": 0},
                {"mode": "append", "content": "k2", "effective_from_message": 2},
                {"mode": "overwrite", "content": "k3", "effective_from_message": 3},
            ]
            context["profile_events"] = [
                {"mode": "append", "content": "p1", "effective_from_message": 1},
                {"mode": "overwrite", "content": "p3", "effective_from_message": 3},
            ]
            context["skill_events"] = [
                {"added": [{"title": "A"}], "removed": [], "effective_from_message": 2},
                {"added": [{"title": "B"}], "removed": [], "effective_from_message": 4},
            ]
            data["context"] = context
            safe_write_json(path, data, indent=2)

    def test_prune_keeps_events_after_cut(self):
        cid = self.service.create_conversation(title="compression")
        self._seed_events(cid)

        removed = self.service.prune_turn_events_before(cid, 2)

        self.assertEqual(removed, 4)
        data = self.service.get_conversation(cid)
        context = data["context"]
        self.assertEqual([e["effective_from_message"] for e in context["knowledge_events"]], [3])
        self.assertEqual([e["effective_from_message"] for e in context["profile_events"]], [3])
        self.assertEqual([e["effective_from_message"] for e in context["skill_events"]], [4])

    def test_prune_with_no_hits_is_noop(self):
        cid = self.service.create_conversation(title="compression2")
        self._seed_events(cid)

        removed = self.service.prune_turn_events_before(cid, -1)

        self.assertEqual(removed, 0)
        data = self.service.get_conversation(cid)
        self.assertEqual(len(data["context"]["knowledge_events"]), 3)
        self.assertEqual(len(data["context"]["skill_events"]), 2)


if __name__ == "__main__":
    unittest.main()
