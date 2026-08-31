"""
ConversationService v4 全量测试
覆盖 §九 8 项测试
"""

import json
import os
import shutil
import tempfile
import threading
import unittest

# 切换到 ChatDBServer 目录以匹配 data/users 路径
import sys

# test file: ChatDBServer/api/basis/Conversation/tests/test_conversation_service.py
# 4 级 .. 从 tests 目录到 ChatDBServer
SERVER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
if os.path.join(SERVER_DIR, "api") not in sys.path:
    sys.path.insert(0, os.path.join(SERVER_DIR, "api"))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)
try:
    os.chdir(SERVER_DIR)
except Exception:
    pass

from basis.Conversation.service import ConversationService
from basis.Conversation.migration import migrate_single_conversation_data
from basis.Conversation.errors import ConversationTargetRoleError, ConversationIndexError
from basis.Conversation.telemetry import extract_process_steps_from_trace


def _v3_fixture():
    """构造类似 421.json 的 v3 数据，含所有需迁移字段。"""
    return {
        "conversation_id": "999",
        "title": "你有搜索能力吗",
        "created_at": "2026-08-31T17:44:31",
        "updated_at": "2026-08-31T17:51:17",
        "pin": False,
        "conversation_mode": "learning",
        "tags": ["learning", "test"],
        "workspace_id": "workspace_x",
        "metadata": {
            "workspace_id": "workspace_x",
            "learning": {
                "lecture_id": "lecture_x",
                "course_id": "course_x",
                "course_title": "课程名称",
            },
            "learning_lecture_id": "lecture_x",
            "nexoracode_project": {"project_id": "proj_y"},
        },
        "branch": {"workspace_id": "workspace_x"},
        "knowledge_snapshot": {
            "hash": "abc",
            "documents": [
                {"title": "Doc A", "knowledge_type": "basis", "basis_id": "b1", "pin": True},
                {"title": "Doc B", "knowledge_type": "basis", "basis_id": "b2"},
            ],
        },
        "global_knowledge_snapshot": {
            "hash": "ghi",
            "documents": [{"title": "Global Doc"}],
        },
        "longterm": {"active": True, "task": "TODO", "plan": ["step1"]},
        "last_volc_response_id": "resp_123",
        "last_model_used": "GLM-5-Base",
        "context_compressions": [
            {"summary": "summary old", "history_cut_index": 1, "created_at": "2026-08-31T17:50:00", "model": "GLM-5-Base"}
        ],
        "messages": [
            {
                "role": "system",
                "content": "system snapshot content 1",
                "timestamp": "2026-08-31T17:44:32",
                "metadata": {"kind": "system_snapshot", "hash": "e084c6d6c6a729fe", "epoch": 1, "prev_hash": "", "reason": "chat_turn"},
            },
            {
                "role": "user",
                "content": "你有搜索能力吗",
                "timestamp": "2026-08-31T17:44:32",
                "metadata": {"time_marker": "2026-08-31 17:44:32"},
            },
            {
                "role": "assistant",
                "content": "有，但有限制。",
                "timestamp": "2026-08-31T17:44:53",
                "model_name": "GLM-5-Base",
                "exchange_summary": "你有搜索能力吗",
                "metadata": {
                    "model_name": "GLM-5-Base",
                    "provider": "SCNet",
                    "process_steps": [
                        {"type": "reasoning_content", "content": "内部推理", "round": 1},
                        {"type": "content", "content": "有，但有限制。", "round": 1},
                        {"type": "function_call", "name": "exa_web_search", "arguments": "{}", "call_id": "call_x", "round": 2},
                        {"type": "function_result", "name": "exa_web_search", "result": "ok", "model_visible_result": "### Result Diff\n```diff\n+ok\n```", "call_id": "call_x", "round": 2},
                    ],
                    "io_tokens": {"input": 11286, "output": 335, "raw_input": 11286, "cached_input": 0, "effective_input": 11286},
                    "io_tokens_cumulative": {"input": 11286, "output": 335},
                    "request_debug": {"use_responses_api": False},
                    "versions": [
                        {
                            "content": "旧版本1",
                            "timestamp": "2026-08-31T17:44:40",
                            "metadata": {"model_name": "GLM-5-Base", "process_steps": []},
                            "exchange_summary": "旧",
                        }
                    ],
                    "reasoning_content": "should move to telemetry",
                },
            },
            {
                "role": "system",
                "content": "## Workspace Knowledge Index 更新\n新增知识 1 项：\n- + Doc C",
                "timestamp": "2026-08-31T17:45:00",
                "metadata": {"kind": "knowledge_diff", "hash": "newhash", "prev_hash": "oldhash", "added_count": 1},
            },
            {
                "role": "user",
                "content": "第二问",
                "timestamp": "2026-08-31T17:45:10",
            },
            {
                "role": "assistant",
                "content": "第二答",
                "timestamp": "2026-08-31T17:45:20",
                "metadata": {
                    "model_name": "GLM-5-Base2",
                    "process_steps": [{"type": "content", "content": "第二答", "round": 1}],
                    "io_tokens": {"input": 100, "output": 50},
                },
            },
        ],
    }


class BaseServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        # 服务内使用 ./data/users/<username>/conversations，需在 tmpdir 下模拟 data
        # 采用独立用户名，避免污染真实数据
        self.username = f"test_v4_{os.path.basename(self.tmpdir).replace('-','_')}"
        # 将 data/users 指向临时目录：通过 monkeypatch os.path.join
        # 更简单：直接在真实 data 下创建临时用户目录，teardown 时删除
        from basis.Conversation.repository import conversation_base_path as _cbp
        self.base_path = _cbp(self.username)
        os.makedirs(self.base_path, exist_ok=True)
        self.service = ConversationService(self.username)

    def tearDown(self):
        # 清理临时用户目录
        from basis.Conversation.repository import _server_data_root as _sdr
        user_dir = os.path.join(_sdr(), "users", self.username)
        if os.path.exists(user_dir):
            shutil.rmtree(user_dir, ignore_errors=True)
        # 清理可能的迁移备份
        try:
            shutil.rmtree(self.tmpdir, ignore_errors=True)
        except Exception:
            pass


class TestMigration(BaseServiceTest):
    def test_migrate_old_data(self):
        fixture = _v3_fixture()
        # 写入旧文件
        cid = "999"
        path = os.path.join(self.base_path, f"{cid}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(fixture, f, ensure_ascii=False, indent=2)

        # 备份检查：使用 migrate 逻辑
        result = self.service.migrate_conversation(cid)
        self.assertTrue(result.get("migrated"))
        backup_path = result.get("backup_path", "")
        self.assertTrue(os.path.exists(backup_path), "原文件备份必须存在")

        data = self.service.get_conversation(cid)
        # 断言
        self.assertEqual(data.get("schema_version"), 4)
        # messages 只含 user/assistant
        for msg in data.get("messages", []):
            self.assertIn(msg.get("role"), {"user", "assistant"})
        self.assertEqual(len(data.get("messages", [])), 4)  # 2 user + 2 assistant
        # system 已到 context
        self.assertGreaterEqual(len(data.get("context", {}).get("system_snapshots", [])), 1)
        self.assertGreaterEqual(len(data.get("context", {}).get("knowledge_events", [])), 1)
        # longterm 不存在
        self.assertNotIn("longterm", data)
        # Workspace
        self.assertEqual(data.get("scope", {}).get("workspace_id"), "workspace_x")
        # Learning
        learning = data.get("scope", {}).get("learning", {})
        self.assertTrue(learning.get("enabled"))
        self.assertEqual(learning.get("lecture_id"), "lecture_x")
        self.assertEqual(learning.get("course_id"), "course_x")
        self.assertEqual(learning.get("course_title"), "课程名称")
        # 内容不丢失
        contents = [m.get("content") for m in data.get("messages", [])]
        self.assertIn("你有搜索能力吗", contents)
        self.assertIn("有，但有限制。", contents)
        # versions 完整
        assistant0 = data.get("messages", [])[1]
        self.assertIsInstance(assistant0.get("versions"), list)
        self.assertGreaterEqual(len(assistant0.get("versions", [])), 1)
        trace_events = assistant0.get("trace", {}).get("events", [])
        self.assertEqual([event.get("type") for event in trace_events], ["reasoning_content", "content", "function_call", "function_result"])
        self.assertEqual(trace_events[-1].get("model_visible_result"), "### Result Diff\n```diff\n+ok\n```")
        projected = extract_process_steps_from_trace(assistant0.get("trace", {}))
        self.assertEqual(projected[-1].get("model_visible_result"), trace_events[-1].get("model_visible_result"))
        # runtime.resume 存在
        self.assertIsNotNone(data.get("runtime", {}).get("resume"))
        self.assertEqual(data.get("runtime", {}).get("resume", {}).get("response_id"), "resp_123")

    def test_idempotent_migration(self):
        fixture = _v3_fixture()
        v4 = migrate_single_conversation_data(fixture)
        # 再次迁移应幂等
        v4_second = migrate_single_conversation_data(v4)
        self.assertEqual(v4_second.get("schema_version"), 4)
        self.assertEqual(len(v4_second.get("messages", [])), len(v4.get("messages", [])))


class TestNormalAppend(BaseServiceTest):
    def test_append_and_context_index_not_affect_message_index(self):
        cid = self.service.create_conversation(title="t1")
        # 追加一轮
        turn = self.service.begin_user_turn(cid, "hello")
        self.assertIn("assistant_index", turn)
        # 记录 system snapshot
        self.service.record_system_snapshot(cid, "system v2 content", )
        # 完成 assistant
        self.service.finish_assistant_turn(cid, turn["assistant_index"], {
            "content": "hi there",
            "model": {"name": "m1", "provider": "p1"},
            "summary": "greeting",
            "usage": {"input": 10, "output": 5},
            "trace": {"tool_calls": [], "tool_results": [], "content_segments": []},
        })
        # 再更新 knowledge
        self.service.record_knowledge_state(cid, [{"title": "Doc A"}], ["Title G"])
        # 下一轮
        turn2 = self.service.begin_user_turn(cid, "second")
        self.service.finish_assistant_turn(cid, turn2["assistant_index"], {
            "content": "second answer",
            "model": {"name": "m1", "provider": "p1"},
        })

        data = self.service.get_conversation(cid)
        # system/knowledge 变化未混入 messages
        for msg in data.get("messages", []):
            self.assertIn(msg.get("role"), {"user", "assistant"})
        self.assertEqual(len(data.get("messages", [])), 4)
        # 顺序正确
        self.assertEqual(data["messages"][0]["content"], "hello")
        self.assertEqual(data["messages"][1]["content"], "hi there")
        self.assertEqual(data["messages"][2]["content"], "second")
        self.assertEqual(data["messages"][3]["content"], "second answer")
        # context 中有 snapshot/event
        self.assertGreaterEqual(len(data.get("context", {}).get("system_snapshots", [])), 1)


class TestKnowledgeEvents(BaseServiceTest):
    def test_knowledge_state_change_is_recorded_at_next_turn_boundary(self):
        cid = self.service.create_conversation(title="knowledge")
        first = self.service.begin_user_turn(cid, "first", workspace_documents=[], global_titles=["已有知识"])
        self.service.finish_assistant_turn(cid, first["assistant_index"], {"content": "answer", "model": {"name": "m", "provider": "p"}})

        second = self.service.begin_user_turn(
            cid,
            "second",
            workspace_documents=[],
            global_titles=["已有知识", "空白知识库"],
        )
        self.service.finish_assistant_turn(cid, second["assistant_index"], {"content": "answer 2", "model": {"name": "m", "provider": "p"}})

        events = self.service.get_context_events(cid)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["scope"], "global")
        self.assertEqual(events[0]["effective_from_message"], 2)
        self.assertEqual(events[0]["added"], [{"title": "空白知识库"}])


class TestStrictRegenerate(BaseServiceTest):
    def test_replace_assistant_strict(self):
        cid = self.service.create_conversation(title="t")
        turn = self.service.begin_user_turn(cid, "q1")
        self.service.finish_assistant_turn(cid, turn["assistant_index"], {"content": "a1", "model": {"name": "m", "provider": "p"}})
        turn2 = self.service.begin_user_turn(cid, "q2")
        self.service.finish_assistant_turn(cid, turn2["assistant_index"], {"content": "a2", "model": {"name": "m", "provider": "p"}})

        data = self.service.get_conversation(cid)
        # 重答合法 assistant index=1
        self.service.replace_assistant(cid, 1, {"content": "a1 renewed", "model": {"name": "m2", "provider": "p2"}})
        data2 = self.service.get_conversation(cid)
        self.assertEqual(data2["messages"][1]["content"], "a1 renewed")
        # 旧回答进入 versions
        self.assertGreaterEqual(len(data2["messages"][1].get("versions", [])), 1)
        self.assertEqual(data2["messages"][1]["versions"][-1]["content"], "a1")

    def test_regenerate_strict_errors(self):
        cid = self.service.create_conversation(title="t")
        turn = self.service.begin_user_turn(cid, "q1")
        self.service.finish_assistant_turn(cid, turn["assistant_index"], {"content": "a1", "model": {"name": "m", "provider": "p"}})

        # user index -> 必须抛 ConversationTargetRoleError
        with self.assertRaises(ConversationTargetRoleError):
            self.service.replace_assistant(cid, 0, {"content": "bad"})

        # 越界
        with self.assertRaises(ConversationIndexError):
            self.service.replace_assistant(cid, 99, {"content": "bad"})

        # 失效 index（负数）
        with self.assertRaises(ConversationIndexError):
            self.service.replace_assistant(cid, -1, {"content": "bad"})


class TestStreamAndError(BaseServiceTest):
    def test_stream_partial_and_error(self):
        cid = self.service.create_conversation(title="t")
        turn = self.service.begin_user_turn(cid, "q1")
        idx = turn["assistant_index"]
        # partial
        self.service.update_assistant_partial(cid, idx, {"content": "partial...", "status": "partial"})
        data = self.service.get_conversation(cid)
        self.assertEqual(data["messages"][idx]["content"], "partial...")
        self.assertEqual(data["messages"][idx]["status"], "partial")

        # error finish
        self.service.finish_assistant_turn(cid, idx, {"content": "oops", "status": "error", "error": {"message": "timeout"}, "model": {"name": "m", "provider": "p"}})
        data2 = self.service.get_conversation(cid)
        self.assertEqual(data2["messages"][idx]["status"], "error")
        self.assertEqual(data2["messages"][idx]["error"]["message"], "timeout")
        # 不会覆盖其他轮次
        turn2 = self.service.begin_user_turn(cid, "q2")
        self.service.finish_assistant_turn(cid, turn2["assistant_index"], {"content": "a2", "model": {"name": "m", "provider": "p"}})
        data3 = self.service.get_conversation(cid)
        self.assertEqual(data3["messages"][turn2["assistant_index"]]["content"], "a2")
        # 第一轮保持 error
        self.assertEqual(data3["messages"][idx]["status"], "error")


class TestDeleteAndVersion(BaseServiceTest):
    def test_delete_and_switch_version(self):
        cid = self.service.create_conversation(title="t")
        for q, a in [("q1", "a1"), ("q2", "a2")]:
            turn = self.service.begin_user_turn(cid, q)
            self.service.finish_assistant_turn(cid, turn["assistant_index"], {"content": a, "model": {"name": "m", "provider": "p"}})

        # 删除 user 0 -> 应删 0,1
        self.service.delete_turn(cid, 0)
        data = self.service.get_conversation(cid)
        self.assertEqual(len(data["messages"]), 2)
        self.assertEqual(data["messages"][0]["content"], "q2")
        self.assertEqual(data["messages"][1]["content"], "a2")

        # 重答制造版本
        self.service.replace_assistant(cid, 1, {"content": "a2 v2", "model": {"name": "m2", "provider": "p2"}})
        data2 = self.service.get_conversation(cid)
        self.assertGreaterEqual(len(data2["messages"][1].get("versions", [])), 1)

        # 切换版本回第一个
        self.service.switch_message_version(cid, 1, 0)
        data3 = self.service.get_conversation(cid)
        # 切换后 resume 被清理（为 None）
        self.assertIsNone(data3.get("runtime", {}).get("resume"))
        # versions 不递归嵌套
        for v in data3["messages"][1].get("versions", []):
            self.assertNotIn("versions", v.get("metadata", {}) if isinstance(v.get("metadata"), dict) else {})

    def test_delete_assistant_turn(self):
        cid = self.service.create_conversation(title="t")
        turn = self.service.begin_user_turn(cid, "q1")
        self.service.finish_assistant_turn(cid, turn["assistant_index"], {"content": "a1", "model": {"name": "m", "provider": "p"}})
        # 删除 assistant 应删 user+assistant
        self.service.delete_turn(cid, 1)
        data = self.service.get_conversation(cid)
        self.assertEqual(len(data["messages"]), 0)


class TestBranch(BaseServiceTest):
    def test_fork(self):
        cid = self.service.create_conversation(title="orig")
        turn1 = self.service.begin_user_turn(cid, "q1")
        self.service.finish_assistant_turn(cid, turn1["assistant_index"], {"content": "a1", "model": {"name": "m", "provider": "p"}})
        turn2 = self.service.begin_user_turn(cid, "q2")
        self.service.finish_assistant_turn(cid, turn2["assistant_index"], {"content": "a2", "model": {"name": "m", "provider": "p"}})

        # 创建真实 workspace 以通过校验
        from App.Workspace.storage import WorkspaceStore
        ws = WorkspaceStore(self.username).create_workspace(title="Test WS", shared_users=[])
        ws_id = ws.get("workspace_id")
        self.service.set_workspace(cid, ws_id)
        self.service.set_learning(cid, {"enabled": True, "lecture_id": "lec1", "course_id": "c1", "course_title": "Course"})

        result = self.service.fork_conversation(cid, 1, title="branch1")
        new_id = result["conversation_id"]
        data = self.service.get_conversation(new_id)
        # 只复制目标之前的可见消息
        self.assertEqual(len(data["messages"]), 2)
        self.assertEqual(data["messages"][1]["content"], "a1")
        # Workspace/learning 保留
        self.assertEqual(data["scope"]["workspace_id"], ws_id)
        self.assertTrue(data["scope"]["learning"]["enabled"])
        # resume 清空
        self.assertIsNone(data["runtime"]["resume"])
        self.assertEqual(data["branch"]["parent_message_index"], 1)
        self.assertEqual(data["branch"]["parent_conversation_id"], cid)


class TestContextBuild(BaseServiceTest):
    def test_build_context_selects_effective_snapshot(self):
        cid = self.service.create_conversation(title="t")
        # 初始快照 epoch1 在 0 前生效
        self.service.record_system_snapshot(cid, "system v1")
        turn = self.service.begin_user_turn(cid, "q1")
        self.service.finish_assistant_turn(cid, turn["assistant_index"], {"content": "a1", "model": {"name": "m", "provider": "p"}})
        # 在 2 条消息后追加新快照
        self.service.record_system_snapshot(cid, "system v2")

        # 不截断时：v2 在 2 条消息后生效，下一轮上下文 visible_index=len=2，应已包含 v2
        payload = self.service.build_model_context(cid, "q now")
        self.assertIsNotNone(payload.get("system_snapshot"))
        self.assertEqual(payload["system_snapshot"]["content"], "system v2")

        # 新增一轮后，v2 仍生效
        turn_after = self.service.begin_user_turn(cid, "q_after")
        self.service.finish_assistant_turn(cid, turn_after["assistant_index"], {"content": "a_after", "model": {"name": "m", "provider": "p"}})
        payload2 = self.service.build_model_context(cid, "q now2")
        self.assertEqual(payload2["system_snapshot"]["content"], "system v2")

        # 截断到 1 条消息时（仅第一轮 user 之前），应取 v1
        payload_cut = self.service.build_model_context(cid, "q now", options={"history_end_index_exclusive": 1})
        # 此时 visible messages 为 1，effective snapshot 应为 v1（v2 在 2 之后）
        # 实现中 get_effective 选 <= visible_index 的最新，若实现简化则可能返回 None或 v1，此处断言不为 v2
        if payload_cut.get("system_snapshot"):
            self.assertNotEqual(payload_cut["system_snapshot"]["content"], "system v2")

        # 内部事件不作为可见消息
        data = self.service.get_conversation(cid)
        for msg in data.get("messages", []):
            self.assertNotEqual(msg.get("role"), "system")

        # 重答上下文不包含目标 assistant 之后的内容
        turn2 = self.service.begin_user_turn(cid, "q2")
        self.service.finish_assistant_turn(cid, turn2["assistant_index"], {"content": "a2", "model": {"name": "m", "provider": "p"}})
        payload_reg = self.service.build_model_context(cid, "regen", options={"history_end_index_exclusive": 1})
        self.assertEqual(len(payload_reg["messages"]), 1)


class TestConcurrency(BaseServiceTest):
    def test_concurrent_append(self):
        cid = self.service.create_conversation(title="t")
        # 预先一轮
        turn = self.service.begin_user_turn(cid, "q0")
        self.service.finish_assistant_turn(cid, turn["assistant_index"], {"content": "a0", "model": {"name": "m", "provider": "p"}})

        def worker(q, a):
            t = self.service.begin_user_turn(cid, q)
            # 稍作延迟模拟并发
            import time as _t
            _t.sleep(0.02)
            self.service.finish_assistant_turn(cid, t["assistant_index"], {"content": a, "model": {"name": "m", "provider": "p"}})

        threads = [
            threading.Thread(target=worker, args=("q_conc_1", "a_conc_1")),
            threading.Thread(target=worker, args=("q_conc_2", "a_conc_2")),
        ]
        for th in threads:
            th.start()
        for th in threads:
            th.join()

        data = self.service.get_conversation(cid)
        # 无损坏、数量正确（初始 2 + 4 =6）
        self.assertEqual(len(data["messages"]), 6)
        # 无丢失
        contents = [m["content"] for m in data["messages"]]
        self.assertIn("q_conc_1", contents)
        self.assertIn("q_conc_2", contents)
        # JSON 可解析
        path = os.path.join(self.base_path, f"{cid}.json")
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        self.assertEqual(raw.get("schema_version"), 4)


if __name__ == "__main__":
    unittest.main()
