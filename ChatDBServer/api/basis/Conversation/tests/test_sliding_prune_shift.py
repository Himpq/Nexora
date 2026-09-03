"""
滑动裁剪坐标平移验证：_shift_indexed_context 在 dropped 条消息被物理删除后，
knowledge/profile/skill 事件、system_snapshots、compressions marker 的下标坐标
必须与幸存消息的新下标一致（回放契约：efm == 消息游标 精确匹配）。
"""

import os
import shutil
import sys
import tempfile
import unittest

# test file: ChatDBServer/api/basis/Conversation/tests/test_sliding_prune_shift.py
SERVER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
if os.path.join(SERVER_DIR, "api") not in sys.path:
    sys.path.insert(0, os.path.join(SERVER_DIR, "api"))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

from basis.Conversation.service import ConversationService


class TestShiftIndexedContext(unittest.TestCase):

    def setUp(self):
        self.svc = ConversationService.__new__(ConversationService)
        self.svc.username = "__shift_test__"

    def _data(self):
        return {
            "messages": [{"role": "user"}, {"role": "assistant"}] * 5,
            "context": {
                # efm 覆盖：被删区(<3)、临界(=3)、幸存区(>3)、非法(无字段)
                "knowledge_events": [
                    {"scope": "workspace", "effective_from_message": 0},
                    {"scope": "workspace", "effective_from_message": 2},
                    {"scope": "workspace", "effective_from_message": 3},
                    {"scope": "global", "effective_from_message": 8},
                    {"effective_from_message": "bad"},
                    {"scope": "workspace"},
                ],
                "profile_events": [
                    {"mode": "overwrite", "effective_from_message": 1},
                    {"mode": "overwrite", "effective_from_message": 7},
                ],
                "skill_events": [
                    {"effective_from_message": 9},
                ],
                "system_snapshots": [
                    {"epoch": 1, "effective_from_message": 0},
                    {"epoch": 2, "effective_from_message": 5},
                ],
                "compressions": [
                    # cut=2 已随消息删除 -> 整条移除
                    {"summary": "old", "history_cut_index": 2},
                    # cut=5 >= dropped -> 减 3 得 2
                    {"summary": "new", "history_cut_index": 5},
                    {"summary": "bad-cut", "history_cut_index": "x"},
                ],
            },
        }

    def test_remap_after_dropped_3(self):
        data = self._data()
        self.svc._shift_indexed_context(data, dropped=3)

        knowledge = data["context"]["knowledge_events"]
        # 前两条为 efm 0/3 平移后的幸存事件，后两条为非法 efm 原样保留
        self.assertEqual(
            [e["effective_from_message"] for e in knowledge[:2]],
            [0, 5],
        )
        self.assertEqual(knowledge[2], {"effective_from_message": "bad"})
        self.assertEqual(knowledge[3], {"scope": "workspace"})

        profile = data["context"]["profile_events"]
        self.assertEqual(
            [e["effective_from_message"] for e in profile],
            [4],
        )

        skill = data["context"]["skill_events"]
        self.assertEqual(
            [e["effective_from_message"] for e in skill],
            [6],
        )

        snaps = data["context"]["system_snapshots"]
        self.assertEqual(
            [s["effective_from_message"] for s in snaps],
            [2],
        )
        self.assertEqual(snaps[0]["epoch"], 2)

        compressions = data["context"]["compressions"]
        self.assertEqual(
            [c["history_cut_index"] for c in compressions],
            [2, "x"],
        )

    def test_dropped_zero_noop(self):
        data = self._data()
        before = data["context"]["knowledge_events"][0]["effective_from_message"]
        self.svc._shift_indexed_context(data, dropped=0)
        self.assertEqual(data["context"]["knowledge_events"][0]["effective_from_message"], before)

    def test_dropped_covers_all_markers(self):
        data = self._data()
        self.svc._shift_indexed_context(data, dropped=10)
        # 所有合法 efm/cut < 10 都被移除；仅剩非法字段条目原样保留
        self.assertEqual(data["context"]["knowledge_events"], [
            {"effective_from_message": "bad"},
            {"scope": "workspace"},
        ])
        self.assertEqual(data["context"]["profile_events"], [])
        self.assertEqual(data["context"]["skill_events"], [])
        self.assertEqual(data["context"]["system_snapshots"], [])
        self.assertEqual(data["context"]["compressions"], [{"summary": "bad-cut", "history_cut_index": "x"}])


class TestBeginUserTurnSlidingPrune(unittest.TestCase):
    """begin_user_turn 超窗写前裁剪端到端：消息裁剪、事件/快照/marker 下标联动 remap。"""

    def setUp(self):
        from basis.Conversation.repository import _server_data_root as _sdr
        from basis.Conversation.repository import conversation_base_path as _cbp

        self.tmpdir = tempfile.mkdtemp()
        self.username = f"test_prune_{os.path.basename(self.tmpdir).replace('-', '_')}"
        self.service = ConversationService(self.username)
        self.cid = self.service.create_conversation(title="prune")
        self._sdr = _sdr
        self._cbp = _cbp

    def tearDown(self):
        user_dir = os.path.join(self._sdr(), "users", self.username)
        if os.path.exists(user_dir):
            shutil.rmtree(user_dir, ignore_errors=True)
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _load(self):
        from basis.Conversation.repository import load_conversation_file

        return load_conversation_file(self.username, self.cid)

    def test_sliding_prune_remaps_indexed_context(self):
        from basis.Conversation.repository import conversation_update_session
        from basis.Database import safe_write_json

        # 10 轮 = 20 条消息，总序列化约 1.2 万 chars，远超 1024 窗口换算的 4096 chars 上限
        big = "长内容" * 200
        with conversation_update_session(self.username, self.cid) as (path, data):
            msgs = []
            for i in range(10):
                msgs.append({"role": "user", "content": f"{big}{i}", "attachments": []})
                msgs.append({"role": "assistant", "content": big})
            data["messages"] = msgs
            ctx = data["context"]
            ctx["knowledge_events"] = [
                {"scope": "workspace", "added": [{"title": "W0"}], "removed": [], "effective_from_message": 0},
                {"scope": "global", "added": [{"title": "G6"}], "removed": [], "effective_from_message": 6},
                {"scope": "workspace", "added": [{"title": "W18"}], "removed": [], "effective_from_message": 18},
            ]
            ctx["profile_events"] = [
                {"mode": "overwrite", "content": "画像", "effective_from_message": 19},
            ]
            ctx["system_snapshots"] = [
                {"epoch": 1, "content": "HEAD_OLD", "effective_from_message": 4},
                {"epoch": 2, "content": "HEAD", "effective_from_message": 16},
            ]
            ctx["compressions"] = [
                {"summary": "OLD_SUM", "history_cut_index": 2},
                {"summary": "SUM", "history_cut_index": 14},
            ]
            safe_write_json(path, data, indent=2)

        old_len = len(self._load()["messages"])

        turn = self.service.begin_user_turn(self.cid, "新问题", context_window_tokens=1024)

        saved = self._load()
        msgs = saved["messages"]
        new_len = len(msgs)
        # 平移单位 = 真删条数 = old - (裁剪后条数 + 本轮追加的 user + 占位 assistant)
        dropped = old_len - (new_len - 2)
        # 裁剪确实发生，且落在 6..18 之间以同时覆盖「删除区事件」与「幸存区事件 remap」
        self.assertGreater(dropped, 6)
        self.assertLess(dropped, 19)
        # 新 user + 占位 assistant 写入裁剪后尾部，user_index 与裁剪后消息数一致
        self.assertEqual(msgs[-2]["role"], "user")
        self.assertEqual(str(msgs[-2]["content"]), "新问题")
        self.assertEqual(msgs[-1]["role"], "assistant")
        self.assertEqual(int(turn["user_index"]), new_len - 2)

        ctx = saved["context"]
        knowledge = ctx["knowledge_events"]
        # 生效点已被删除的事件（efm < dropped）不再落库
        self.assertNotIn("W0", str(knowledge))
        self.assertNotIn("G6", str(knowledge))
        # 幸存事件下标整体前移 dropped，与新消息坐标一致
        w18 = [e for e in knowledge if str(e.get("added", [{}])[0].get("title", "")) == "W18"]
        self.assertEqual(len(w18), 1)
        self.assertEqual(int(w18[0]["effective_from_message"]), 18 - dropped)

        profile = ctx["profile_events"]
        self.assertEqual(len(profile), 1)
        self.assertEqual(int(profile[0]["effective_from_message"]), 19 - dropped)

        # 快照与压缩 marker 同规则：覆盖点被删的整条移除，幸存者平移
        snaps = ctx["system_snapshots"]
        self.assertNotIn("HEAD_OLD", str(snaps))
        self.assertEqual([s["effective_from_message"] for s in snaps], [16 - dropped])
        cuts = [c["history_cut_index"] for c in ctx["compressions"]]
        self.assertNotIn(2, cuts)
        self.assertEqual(cuts, [14 - dropped])


if __name__ == "__main__":
    unittest.main(verbosity=2)
