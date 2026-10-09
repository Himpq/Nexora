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
    PERMISSION_EVENTS_KEY,
    PERMISSION_STATE_KEY,
    PROFILE_EVENTS_KEY,
    PROFILE_STATE_KEY,
    SKILL_EVENTS_KEY,
    SKILL_STATE_KEY,
    record_permission_state,
    record_profile_state,
    record_skill_state,
)
from basis.Model.turn_injection import (
    PROFILE_UPDATED_MARKER,
    SKILLS_CHANGED_MARKER,
    USER_PERMISSION_UPDATED_MARKER,
    build_profile_update_block,
    build_skill_update_block,
    build_user_permission_update_block,
    get_volatile_injection_name,
    is_volatile_injection,
)
from basis.Model.Context import ChatContextManager
from basis.Permission import build_permission_hint_by_role
from prompts import default_base


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


class TestRecordPermissionState(unittest.TestCase):
    def _data(self):
        return {"messages": [], "context": {}}

    def test_first_sample_establishes_baseline_without_event(self):
        data = self._data()

        delta = record_permission_state(data, "member", emit_event=False)

        self.assertIsNone(delta)
        self.assertEqual(data["context"][PERMISSION_STATE_KEY]["permission"], "member")
        self.assertEqual(data["context"].get(PERMISSION_EVENTS_KEY, []), [])

    def test_uninitialized_permission_emits_one_baseline_event(self):
        data = self._data()
        record_permission_state(data, "member", emit_event=False)

        delta = record_permission_state(data, "member", effective_from_message=2)

        self.assertEqual(delta, {"permission": "member"})
        self.assertEqual(len(data["context"][PERMISSION_EVENTS_KEY]), 1)
        self.assertEqual(data["context"][PERMISSION_EVENTS_KEY][0]["effective_from_message"], 2)

        next_delta = record_permission_state(data, "member", effective_from_message=3)

        self.assertIsNone(next_delta)
        self.assertEqual(len(data["context"][PERMISSION_EVENTS_KEY]), 1)

        data["context"][PERMISSION_EVENTS_KEY].clear()
        pruned_delta = record_permission_state(data, "member", effective_from_message=4)

        self.assertIsNone(pruned_delta)
        self.assertEqual(data["context"][PERMISSION_EVENTS_KEY], [])

    def test_changed_permission_emits_one_event(self):
        data = self._data()
        record_permission_state(data, "member", emit_event=False)

        delta = record_permission_state(data, "admin", effective_from_message=2)

        self.assertEqual(delta, {"permission": "admin"})
        self.assertEqual(data["context"][PERMISSION_EVENTS_KEY][0]["permission"], "admin")
        self.assertEqual(data["context"][PERMISSION_EVENTS_KEY][0]["effective_from_message"], 2)


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
        self.assertEqual(get_volatile_injection_name("## Knowledge changed\n+ 条目"), "knowledge_diff")
        self.assertEqual(get_volatile_injection_name("## Workspace Resource Index\n资源"), "workspace_resource_index")
        self.assertEqual(get_volatile_injection_name("普通 stable 注入块"), "")


class TestUserPermissionInjection(unittest.TestCase):
    def test_permission_block_is_volatile_and_named(self):
        block = build_user_permission_update_block("admin-current")

        self.assertIn(USER_PERMISSION_UPDATED_MARKER, block)
        self.assertIn("admin-current", block)
        self.assertTrue(is_volatile_injection(block))
        self.assertEqual(get_volatile_injection_name(block), "user_permission")
        self.assertEqual(build_user_permission_update_block(""), "")
        self.assertIn("仍须遵守系统与开发者指令", build_permission_hint_by_role("admin"))
        self.assertNotIn("权限：{{permission}}", default_base)

    def test_cache_resume_appends_the_latest_permission(self):
        context_manager = ChatContextManager(object())
        context_manager._current_turn_permission_block = build_user_permission_update_block("admin-current")
        messages = context_manager.build_current_turn_messages(
            current_user_content="继续",
            system_injection_texts=[
                f"{USER_PERMISSION_UPDATED_MARKER}\nstale-role",
                "## Knowledge changed\n+新增条目",
            ],
        )

        permission_messages = [
            item["content"]
            for item in messages
            if USER_PERMISSION_UPDATED_MARKER in item["content"]
        ]
        self.assertEqual(len(permission_messages), 1)
        self.assertIn("admin-current", permission_messages[0])
        self.assertNotIn("stale-role", permission_messages[0])
        self.assertEqual(messages[-1], {"role": "user", "content": "继续"})

    def test_cache_resume_does_not_repeat_permission_without_a_diff(self):
        context_manager = ChatContextManager(object())

        messages = context_manager.build_current_turn_messages(
            current_user_content="继续",
            system_injection_texts=["## Knowledge changed\n+新增条目"],
        )

        self.assertFalse(any(USER_PERMISSION_UPDATED_MARKER in item["content"] for item in messages))


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

    def test_begin_user_turn_injects_permission_once_then_only_when_role_changes(self):
        from unittest.mock import patch
        from basis.Permission import build_permission_hint_by_role

        cid = self.service.create_conversation(title="permission_state")
        admin_users = {self.username: {"role": "admin"}}
        member_users = {self.username: {"role": "member"}}

        with patch("basis.User.load_users", return_value=admin_users):
            first = self.service.begin_user_turn(cid, "q1")

        self.assertEqual(
            first["permission_delta"],
            {"permission": build_permission_hint_by_role("admin")},
        )
        self.service.finish_assistant_turn(
            cid,
            first["assistant_index"],
            {"content": "a1", "model": {"name": "m", "provider": "p"}},
        )

        with patch("basis.User.load_users", return_value=admin_users):
            second = self.service.begin_user_turn(cid, "q2")

        self.assertIsNone(second["permission_delta"])
        self.service.finish_assistant_turn(
            cid,
            second["assistant_index"],
            {"content": "a2", "model": {"name": "m", "provider": "p"}},
        )

        with patch("basis.User.load_users", return_value=member_users):
            third = self.service.begin_user_turn(cid, "q3")

        self.assertEqual(
            third["permission_delta"],
            {"permission": build_permission_hint_by_role("member")},
        )
        permission_events = self.service.get_conversation(cid)["context"]["permission_events"]
        self.assertEqual(len(permission_events), 2)
        self.assertEqual(permission_events[0]["effective_from_message"], 0)
        self.assertEqual(permission_events[1]["effective_from_message"], 4)


if __name__ == "__main__":
    unittest.main()
