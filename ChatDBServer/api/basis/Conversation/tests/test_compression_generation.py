"""
压缩换代端到端：压缩后上下文重建的结构与事件回放对齐。

覆盖链路：落库 marker（history_cut_index）+ 事件换代裁剪 -> build_initial_context 重建
[head, 摘要, 新历史(含回放块)...] -> volatile tail -> 当前 user。
"""

import json
import os
import shutil
import sys
import tempfile
import unittest

# test file: ChatDBServer/api/basis/Conversation/tests/test_compression_generation.py
SERVER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
if os.path.join(SERVER_DIR, "api") not in sys.path:
    sys.path.insert(0, os.path.join(SERVER_DIR, "api"))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)
try:
    os.chdir(SERVER_DIR)
except Exception:
    pass

from basis.Model.Context import ChatContextManager
from basis.Model.turn_injection import PROFILE_UPDATED_MARKER, SKILLS_CHANGED_MARKER


class StubModel:
    """Context 构建所需的最小 model 契约（只读会话 + 诊断回写）。"""

    def __init__(self, service, conversation_id, persist=False):
        self.system_prompt = "SYS"
        self.model_name = "stub-model"
        self.conversation_id = conversation_id
        self.conversation_service = service
        self.persist_conversation = persist
        self._last_context = None

    def record_context_diagnostics(self, diagnostics):
        return None

    def _content_signature_for_dedupe(self, content):
        return json.dumps(content, ensure_ascii=False, sort_keys=True, default=str)

    def _collect_history_attachment_image_urls(self, metadata, conversation_id):
        return []

    def _strip_reasoning_content(self, content):
        return content

    def _build_user_content_payload(self, content, image_urls, use_responses_api):
        return content


class TestCompressionGenerationRebuild(unittest.TestCase):
    """压缩换代后的上下文重建：结构、回放游标、事件裁剪三者一致。"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.username = f"test_gen_{os.path.basename(self.tmpdir).replace('-', '_')}"
        from basis.Conversation.repository import conversation_base_path as _cbp

        self.base_path = _cbp(self.username)
        os.makedirs(self.base_path, exist_ok=True)
        from basis.Conversation.service import ConversationService

        self.service = ConversationService(self.username)
        self.cid = self.service.create_conversation(title="generation")

    def tearDown(self):
        from basis.Conversation.repository import _server_data_root as _sdr

        user_dir = os.path.join(_sdr(), "users", self.username)
        if os.path.exists(user_dir):
            shutil.rmtree(user_dir, ignore_errors=True)
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _seed(self, events, cut):
        from basis.Conversation.repository import conversation_update_session
        from basis.Database import safe_write_json

        with conversation_update_session(self.username, self.cid) as (path, data):
            data["messages"] = [
                {"role": "user", "content": "m0"},
                {"role": "assistant", "content": "m1"},
                {"role": "user", "content": "m2"},
                {"role": "assistant", "content": "m3"},
                {"role": "user", "content": "m4"},
                {"role": "assistant", "content": "m5"},
            ]
            context = data["context"]
            context.update(events)
            if cut is not None:
                context.setdefault("compressions", []).append({
                    "summary": "压缩摘要内容",
                    "history_cut_index": cut,
                    "created_at": "2026-01-01T00:00:00",
                })
            data["context"] = context
            safe_write_json(path, data, indent=2)

    # persist 必须为真：Context 仅在持久化主对话下读取事件与快照（子请求不参与）
    def _build(self, persist=True, current_user_index=4, injections=None):
        model = StubModel(self.service, self.cid, persist=persist)
        return ChatContextManager(model).build_initial_context(
            user_msg="当前轮提问",
            current_user_content="当前轮提问",
            include_context=True,
            system_prompt_text="SYS",
            system_injection_texts=injections or [],
            current_user_index=current_user_index,
        )

    def _system_texts(self, context):
        return [str(m.content or "") for m in context._messages if m.role == "system"]

    def test_rebuild_layout_is_head_summary_history(self):
        """压缩后结构固定为 [head, 摘要, 新历史...]，摘要占 head 之后的坑位。"""
        self._seed({"knowledge_events": [], "profile_events": [], "skill_events": []}, cut=2)

        context = self._build()

        messages = context.build()
        self.assertEqual(messages[0]["role"], "system")
        self.assertEqual(messages[0]["content"], "SYS")
        self.assertEqual(messages[1]["role"], "system")
        self.assertIn("压缩摘要内容", str(messages[1]["content"]))
        # 被摘要覆盖的 0..2 不出现，仅剩 3 号历史（4/5 属当前轮，走 tail）
        assistant_texts = [str(m["content"]) for m in messages if m["role"] == "assistant"]
        self.assertEqual(assistant_texts, ["m3"])

    def test_event_replay_cursor_stays_aligned_after_cut(self):
        """压缩后回放游标仍与持久化下标对齐：efm > cut 的事件插在正确历史位置。"""
        self._seed({
            "knowledge_events": [],
            "profile_events": [{"mode": "append", "content": "画像增量", "effective_from_message": 4}],
            "skill_events": [{"added": [{"title": "A", "prompt": "技能A全文"}], "removed": [], "effective_from_message": 3}],
        }, cut=2)

        context = self._build()

        system_texts = self._system_texts(context)
        skill_blocks = [t for t in system_texts if SKILLS_CHANGED_MARKER in t]
        profile_blocks = [t for t in system_texts if PROFILE_UPDATED_MARKER in t]

        # efm=3 的技能块属于历史区间，必须回放
        self.assertEqual(len(skill_blocks), 1)
        self.assertIn("技能A全文", skill_blocks[0])
        # efm=4 等于当前轮下标，由 tail 注入，历史回放不重复注入
        self.assertEqual(profile_blocks, [])

    def test_events_covered_by_summary_are_not_replayed(self):
        """已被摘要覆盖的事件（efm <= cut）不得回放，即便落库裁剪未执行。"""
        self._seed({
            "knowledge_events": [{"mode": "append", "content": "旧知识", "effective_from_message": 1}],
            "profile_events": [{"mode": "overwrite", "content": "旧画像", "effective_from_message": 0}],
            "skill_events": [
                {"added": [{"title": "OLD", "prompt": "旧技能"}], "removed": [], "effective_from_message": 1},
                {"added": [{"title": "NEW", "prompt": "新技能"}], "removed": [], "effective_from_message": 3},
            ],
        }, cut=2)

        context = self._build()

        system_texts = self._system_texts(context)
        joined = "\n".join(system_texts)
        self.assertNotIn("旧知识", joined)
        self.assertNotIn("旧画像", joined)
        self.assertNotIn("旧技能", joined)
        # 旧事件不得阻塞后续事件回放（单指针卡死回归）
        self.assertIn("新技能", joined)

    def test_volatile_tail_and_current_user_after_history(self):
        """volatile 注入块与当前 user 位于历史之后，保持 head+history 前缀可缓存。"""
        self._seed({"knowledge_events": [], "profile_events": [], "skill_events": []}, cut=2)

        context = self._build(injections=[
            "## Knowledge changed\n知识增量",
            f"{PROFILE_UPDATED_MARKER}\n画像增量",
        ])

        messages = context.build()
        roles = [m["role"] for m in messages]
        self.assertEqual(roles[-1], "user")
        tail_positions = [
            i for i, m in enumerate(messages)
            if m["role"] == "system" and ("## Knowledge changed" in str(m["content"]) or PROFILE_UPDATED_MARKER in str(m["content"]))
        ]
        self.assertEqual(len(tail_positions), 2)
        # volatile 块必须排在历史消息（assistant m3）之后、当前 user 之前
        history_positions = [i for i, m in enumerate(messages) if m["role"] == "assistant"]
        self.assertGreater(min(tail_positions), max(history_positions))
        self.assertLess(max(tail_positions), len(messages) - 1)

    def test_multiple_events_on_same_efm_all_replayed(self):
        """同轮多类变更（workspace+global 知识、画像、技能共 efm）必须全部回放，不得只注入第一个。"""
        self._seed({
            "knowledge_events": [
                {"scope": "workspace", "added": [{"title": "WS文档"}], "removed": [], "effective_from_message": 3},
                {"scope": "global", "added": [{"title": "GLOBAL标题"}], "removed": [], "effective_from_message": 3},
            ],
            "profile_events": [{"mode": "append", "content": "画像增量", "effective_from_message": 3}],
            "skill_events": [{"added": [{"title": "SK", "prompt": "技能全文"}], "removed": [], "effective_from_message": 3}],
        }, cut=2)

        context = self._build()

        joined = "\n".join(self._system_texts(context))
        # 四类事件同 efm=3 且 < current_user_index=4，均在历史区间，全部应注入
        self.assertIn("WS文档", joined)
        self.assertIn("GLOBAL标题", joined)
        self.assertIn("画像增量", joined)
        self.assertIn("技能全文", joined)


class TestSnapshotGeneration(unittest.TestCase):
    """压缩换代与 head 快照：过期全量重建，重建后继续复用命中缓存。"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.username = f"test_snap_{os.path.basename(self.tmpdir).replace('-', '_')}"
        from basis.Conversation.repository import conversation_base_path as _cbp

        self.base_path = _cbp(self.username)
        os.makedirs(self.base_path, exist_ok=True)
        from basis.Conversation.service import ConversationService

        self.service = ConversationService(self.username)
        self.cid = self.service.create_conversation(title="snapshot")

    def tearDown(self):
        from basis.Conversation.repository import _server_data_root as _sdr

        user_dir = os.path.join(_sdr(), "users", self.username)
        if os.path.exists(user_dir):
            shutil.rmtree(user_dir, ignore_errors=True)
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _seed_with_stale_snapshot(self):
        from basis.Conversation.repository import conversation_update_session
        from basis.Database import safe_write_json

        with conversation_update_session(self.username, self.cid) as (path, data):
            data["messages"] = [
                {"role": "user", "content": "m0"},
                {"role": "assistant", "content": "m1"},
                {"role": "user", "content": "m2"},
                {"role": "assistant", "content": "m3"},
                {"role": "user", "content": "m4"},
                {"role": "assistant", "content": "m5"},
            ]
            data["context"]["compressions"].append({
                "summary": "压缩摘要内容",
                "history_cut_index": 2,
                "created_at": "2026-01-01T00:00:00",
            })
            safe_write_json(path, data, indent=2)

        self.service.record_system_snapshot(
            self.cid,
            {"content": "压缩前旧head", "reason": "chat_turn"},
            effective_from_message=0,
        )

    def _build(self, current_user_index=4, injections=None):
        model = StubModel(self.service, self.cid, persist=True)
        return ChatContextManager(model).build_initial_context(
            user_msg="当前轮提问",
            current_user_content="当前轮提问",
            include_context=True,
            system_prompt_text="SYS",
            system_injection_texts=injections or [],
            current_user_index=current_user_index,
        )

    def test_stale_snapshot_is_rebuilt_with_new_efm(self):
        """快照生效点 <= cut 判定过期：head 全量重建，新快照 efm 取当前轮下标。"""
        self._seed_with_stale_snapshot()

        context = self._build(injections=["## 稳定注入块"])

        head = str(context.build()[0]["content"])
        self.assertNotIn("压缩前旧head", head)
        self.assertIn("## 稳定注入块", head)

        data = self.service.get_conversation(self.cid)
        snapshots = data["context"]["system_snapshots"]
        self.assertEqual(snapshots[-1]["effective_from_message"], 4)
        self.assertIn("## 稳定注入块", snapshots[-1]["content"])

    def test_rebuilt_snapshot_is_reused_on_later_turns(self):
        """新快照 efm > cut：后续轮次复用快照，head 不再重建（前缀稳定）。"""
        self._seed_with_stale_snapshot()
        first_head = str(self._build(injections=["## 稳定注入块"]).build()[0]["content"])

        # 后续轮：同一 head 内容但注入块变化，仍复用已存快照
        later_head = str(self._build(current_user_index=6, injections=[]).build()[0]["content"])

        self.assertEqual(later_head, first_head)


if __name__ == "__main__":
    unittest.main()
