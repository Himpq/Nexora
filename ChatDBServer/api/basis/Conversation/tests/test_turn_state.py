"""
Modified Injection 通道测试：画像/技能基线采样、diff、事件落库与注入块构建
"""

import os
import sys
import unittest

# test file: ChatDBServer/api/basis/Conversation/tests/test_turn_state.py
SERVER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
if os.path.join(SERVER_DIR, "api") not in sys.path:
    sys.path.insert(0, os.path.join(SERVER_DIR, "api"))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)
try:
    os.chdir(SERVER_DIR)
except Exception:
    pass

from basis.Conversation.turn_state import (
    PROFILE_EVENTS_KEY,
    PROFILE_STATE_KEY,
    SKILL_EVENTS_KEY,
    SKILL_STATE_KEY,
    record_profile_state,
    record_skill_state,
)
from basis.Model.turn_injection import (
    PROFILE_UPDATED_MARKER,
    SKILLS_CHANGED_MARKER,
    build_profile_update_block,
    build_skill_update_block,
    is_volatile_injection,
)


class TestRecordProfileState(unittest.TestCase):
    def _data(self):
        return {"messages": [], "context": {}}

    def test_first_sample_builds_baseline_without_event(self):
        data = self._data()
        delta = record_profile_state(data, "用户喜欢咖啡", emit_event=False)
        self.assertIsNone(delta)
        self.assertEqual(data["context"][PROFILE_STATE_KEY]["text"], "用户喜欢咖啡")
        self.assertEqual(data["context"].get(PROFILE_EVENTS_KEY, []), [])

    def test_unchanged_profile_returns_none(self):
        data = self._data()
        record_profile_state(data, "用户喜欢咖啡", emit_event=False)
        delta = record_profile_state(data, "用户喜欢咖啡", emit_event=True)
        self.assertIsNone(delta)
        self.assertEqual(data["context"].get(PROFILE_EVENTS_KEY, []), [])

    def test_append_change_emits_append_delta(self):
        data = self._data()
        record_profile_state(data, "用户喜欢咖啡", emit_event=False)
        delta = record_profile_state(data, "用户喜欢咖啡\n用户在上海", emit_event=True)
        self.assertEqual(delta, {"mode": "append", "content": "用户在上海"})
        events = data["context"][PROFILE_EVENTS_KEY]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["mode"], "append")
        self.assertEqual(events[0]["effective_from_message"], 0)

    def test_overwrite_change_emits_full_text(self):
        data = self._data()
        record_profile_state(data, "用户喜欢咖啡\n用户在上海", emit_event=False)
        delta = record_profile_state(data, "用户喜欢茶", emit_event=True)
        self.assertEqual(delta, {"mode": "overwrite", "content": "用户喜欢茶"})
        self.assertEqual(data["context"][PROFILE_EVENTS_KEY][0]["mode"], "overwrite")


class TestRecordSkillState(unittest.TestCase):
    def _samples(self, pairs):
        return [{"title": title, "prompt": prompt} for title, prompt in pairs]

    def _data(self):
        return {"messages": [], "context": {}}

    def test_first_sample_builds_baseline_without_event(self):
        data = self._data()
        delta = record_skill_state(data, self._samples([("A", "prompt-a")]), emit_event=False)
        self.assertIsNone(delta)
        self.assertEqual(len(data["context"][SKILL_STATE_KEY]["skills"]), 1)
        self.assertEqual(data["context"].get(SKILL_EVENTS_KEY, []), [])

    def test_unchanged_skills_return_none(self):
        samples = self._samples([("A", "prompt-a"), ("B", "prompt-b")])
        data = self._data()
        record_skill_state(data, samples, emit_event=False)
        delta = record_skill_state(data, samples, emit_event=True)
        self.assertIsNone(delta)
        self.assertEqual(data["context"].get(SKILL_EVENTS_KEY, []), [])

    def test_add_change_and_remove_change(self):
        data = self._data()
        record_skill_state(data, self._samples([("A", "prompt-a")]), emit_event=False)
        # 新增 B
        delta = record_skill_state(data, self._samples([("A", "prompt-a"), ("B", "prompt-b")]), emit_event=True)
        self.assertEqual(delta["added"], [{"title": "B", "prompt": "prompt-b"}])
        self.assertEqual(delta["removed"], [])
        # 移除 A，B 内容变更
        delta = record_skill_state(data, self._samples([("B", "prompt-b2")]), emit_event=True)
        self.assertEqual(delta["added"], [{"title": "B", "prompt": "prompt-b2"}])
        self.assertEqual(delta["removed"], [{"title": "A"}])
        self.assertEqual(len(data["context"][SKILL_EVENTS_KEY]), 2)


class TestInjectionBlocks(unittest.TestCase):
    def test_profile_block_append_and_overwrite(self):
        block = build_profile_update_block({"mode": "append", "content": "用户在上海"})
        self.assertIn(PROFILE_UPDATED_MARKER, block)
        self.assertIn("追加", block)
        self.assertIn("用户在上海", block)
        block = build_profile_update_block({"mode": "overwrite", "content": "用户喜欢茶"})
        self.assertIn("覆盖", block)
        self.assertIn("用户喜欢茶", block)

    def test_skill_block_lists_removed_and_added(self):
        delta = {
            "added": [{"title": "B", "prompt": "prompt-b"}],
            "removed": [{"title": "A"}],
        }
        block = build_skill_update_block(delta)
        self.assertIn(SKILLS_CHANGED_MARKER, block)
        self.assertIn("[已移除] A", block)
        self.assertIn("[新增或更新] B", block)
        self.assertIn("prompt-b", block)

    def test_invalid_delta_returns_empty(self):
        self.assertEqual(build_profile_update_block(None), "")
        self.assertEqual(build_profile_update_block({"mode": "???"}), "")
        self.assertEqual(build_skill_update_block(None), "")
        self.assertEqual(build_skill_update_block({"added": [], "removed": []}), "")

    def test_markers_are_volatile(self):
        self.assertTrue(is_volatile_injection("前缀\n## User profile updated\n内容"))
        self.assertTrue(is_volatile_injection("## Skills changed"))
        self.assertFalse(is_volatile_injection("普通 stable 注入块"))


class TestBeginUserTurnIntegration(unittest.TestCase):
    """begin_user_turn 事务级集成：delta 返回、事件落库位置（efm）正确。"""

    def setUp(self):
        import shutil
        import tempfile

        self.tmpdir = tempfile.mkdtemp()
        self.username = f"test_turn_state_{os.path.basename(self.tmpdir).replace('-', '_')}"
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

    def test_begin_user_turn_samples_profile_and_skills(self):
        cid = self.service.create_conversation(title="turn_state")
        skill_a = [{"title": "A", "prompt": "prompt-a"}]

        # 首轮：仅建立基线，不落事件（调用方按 user_index=0 忽略 delta）
        first = self.service.begin_user_turn(
            cid, "q1", profile_text="P1", skill_samples=skill_a
        )
        self.assertEqual(first["user_index"], 0)

        self.service.finish_assistant_turn(cid, first["assistant_index"], {"content": "a1", "model": {"name": "m", "provider": "p"}})

        # 第二轮：画像 append + 技能新增，事件 efm 指向本轮 user（messages_before=2）
        second = self.service.begin_user_turn(
            cid,
            "q2",
            profile_text="P1\nP2",
            skill_samples=[{"title": "A", "prompt": "prompt-a"}, {"title": "B", "prompt": "prompt-b"}],
        )
        self.assertEqual(second["profile_delta"], {"mode": "append", "content": "P2"})
        self.assertEqual(second["skill_delta"]["added"], [{"title": "B", "prompt": "prompt-b"}])

        data = self.service.get_conversation(cid)
        profile_events = data["context"].get("profile_events", [])
        skill_events = data["context"].get("skill_events", [])
        self.assertEqual(len(profile_events), 1)
        self.assertEqual(profile_events[0]["effective_from_message"], 2)
        self.assertEqual(profile_events[0]["content"], "P2")
        self.assertEqual(len(skill_events), 1)
        self.assertEqual(skill_events[0]["effective_from_message"], 2)
        self.assertEqual(skill_events[0]["added"][0]["title"], "B")

        # 第三轮：无任何变更，无 delta 无事件
        self.service.finish_assistant_turn(cid, second["assistant_index"], {"content": "a2", "model": {"name": "m", "provider": "p"}})
        third = self.service.begin_user_turn(
            cid,
            "q3",
            profile_text="P1\nP2",
            skill_samples=[{"title": "A", "prompt": "prompt-a"}, {"title": "B", "prompt": "prompt-b"}],
        )
        self.assertIsNone(third["profile_delta"])
        self.assertIsNone(third["skill_delta"])


if __name__ == "__main__":
    unittest.main()

