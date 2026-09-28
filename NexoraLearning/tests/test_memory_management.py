"""Manage personal learning memories through the real API without a live model or index."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from flask import Flask

from api.agent_facade import agent_facade_bp, init_agent_facade
from core import user as user_store
from core.memory import evidence_memory
from core.memory.reflection import insert_insight


class MemoryManagementTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.cfg = {
            "data_dir": str(Path(directory.name) / "data"),
            "runtime_api": {"enabled": True, "api_key": ""},
            "nexora": {"base_url": "http://127.0.0.1:9", "api_key": ""},
            "models": {"default_nexora_model": ""},
        }
        app = Flask(__name__)
        init_agent_facade(self.cfg)
        app.register_blueprint(agent_facade_bp)
        self.client = app.test_client()
        self.username = "memory_fixture"
        self.headers = {"X-Nexora-Username": self.username}
        self.sequence = 0
        self.proxy = self.enterContext(mock.patch("api.agent_facade._PROXY"))
        self.proxy.complete_raw.return_value = {"success": True, "payload": {}}
        self.proxy.extract_output_text.return_value = "我会结合你的目标和当前教材解释。"
        self.rebut = self.enterContext(mock.patch("api.agent_facade.rebut"))
        self.index_updates = self.enterContext(mock.patch("core.memory.memory_index.index_async"))
        self.index_search = self.enterContext(mock.patch("core.memory.memory_index.search", return_value=[]))
        self.enterContext(mock.patch("core.memory.memory_extract.schedule_extraction"))
        self.enterContext(mock.patch("core.cognition.triggers.schedule_confusion_scan"))

    def remember(self, text, *, username=None, **kwargs):
        self.sequence += 1
        return evidence_memory.record_user_message(
            self.cfg, username or self.username, text=text, source_id=f"source_{self.sequence}",
            occurred_at=100 + self.sequence, **kwargs,
        )["memories"][0]

    def items(self, *, headers=None):
        response = self.client.get("/api/agent/v1/memories", headers=headers or self.headers)
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["success"])
        self.assertIsInstance(payload["data"]["generated_at"], int)
        return payload["data"]["items"]

    def change(self, action, memory_id, **data):
        return self.client.post(
            "/api/agent/v1/memories/" + action, headers=self.headers,
            json={"memory_id": memory_id, **data},
        )

    def ask(self, question):
        response = self.client.post("/api/agent/v1/ask-in-context", headers=self.headers,
                                    json={"question": question})
        self.assertEqual(response.status_code, 200)
        return json.dumps(self.proxy.complete_raw.call_args.kwargs["messages"], ensure_ascii=False)

    def test_list_filters_episodes_and_generated_observations_before_limit(self):
        statements = [
            "我的学习目标是通过数据库考试", "我喜欢先看图解", "我的专业是计算机",
            "我每天只能学习30分钟", "我不理解事务隔离级别", "我对数据库感兴趣",
        ]
        personal = [self.remember(text) for text in statements]
        for index in range(105):
            self.remember("🤣" if index == 0 else f"界面测试：仅回复“收到” {index}")
            insert_insight(self.cfg, self.username, text=f"生成的观察 {index}",
                           source_ids=[personal[0]["id"]], occurred_at=1000 + index)
        user_store.append_learning_record(self.cfg, self.username, {
            "type": "study_time", "lecture_id": "course", "study_seconds": 39900,
        })
        self.remember("我的专业是物理", username="other_user")

        items = self.items()
        self.assertEqual({item["text"] for item in items}, set(statements))
        self.assertEqual({item["id"] for item in items}, {row["id"] for row in personal})
        self.assertTrue(all(item["kind"] in evidence_memory.PERSONAL_MEMORY_KINDS for item in items))
        for item in items:
            self.assertEqual(set(item), {"id", "kind", "text", "updated_at", "lecture_id", "book_id"})
            self.assertIsInstance(item["updated_at"], int)
        self.proxy.complete_raw.assert_not_called()

    def test_empty_list_does_not_create_a_memory_store(self):
        self.assertEqual(self.items(), [])
        target = Path(self.cfg["data_dir"]) / "users" / self.username / "memories" / "evidence.sqlite3"
        self.assertFalse(target.exists())

    def test_explicit_interface_test_cannot_be_promoted_into_personal_memory(self):
        text = "界面测试，我喜欢先看图解"
        episode = self.remember(text)
        self.assertEqual(episode["kind"], "conversation")
        result = evidence_memory.apply_model_claims(
            self.cfg, self.username, source_id=episode["source_id"], text=text,
            occurred_at=episode["occurred_at"],
            claims=[{"kind": "preference", "quote": "我喜欢先看图解"}],
        )
        self.assertEqual(result["applied"], 0)
        self.assertEqual(self.items(), [])
        real_goal = self.remember("我的学习目标是准备软件测试考试")
        self.assertEqual([item["id"] for item in self.items()], [real_goal["id"]])

    def test_legacy_interface_test_facts_are_filtered_by_full_source_before_limit(self):
        real_goal = self.remember("我的学习目标是准备软件测试考试")
        # Old extractors retained the clause while losing the explicit test prefix.
        for index in range(105):
            quote = f"我不理解测试记录{index}"
            with mock.patch.object(evidence_memory, "_extract", return_value=[{
                "kind": "difficulty", "key": "weak_areas", "quote": quote,
            }]):
                self.remember("界面测试 ：" + quote)
        self.assertEqual([item["id"] for item in self.items()], [real_goal["id"]])

    def test_edit_replaces_preference_in_real_dialogue_and_decision_context(self):
        self.proxy.extract_output_text.return_value = "我会先给视频讲解。"
        self.ask("我喜欢先看视频")
        original = self.items()[0]
        model_calls = self.proxy.complete_raw.call_count
        response = self.change("update", original["id"], text="  我现在更喜欢先看图解  ")
        self.assertEqual(response.status_code, 200)
        changed = response.get_json()["data"]
        self.assertTrue(changed["updated"])
        item = changed["item"]
        self.assertEqual(item["text"], "我现在更喜欢先看图解")
        self.assertEqual(item["kind"], "preference")
        self.assertNotEqual(item["id"], original["id"])
        self.assertEqual(self.items(), [item])
        self.assertEqual(self.proxy.complete_raw.call_count, model_calls)
        self.rebut.assert_not_called()
        indexed = {row["id"]: row["status"] for row in self.index_updates.call_args.args[2]}
        self.assertEqual(indexed, {original["id"]: "superseded", item["id"]: "active"})

        # A delayed index must not resurrect a replaced source.
        self.index_search.return_value = [original["id"]]
        self.proxy.extract_output_text.return_value = "先看事务示意图。"
        prompt = self.ask("事务是什么？")
        self.assertIn("图解", prompt)
        self.assertNotIn("视频", prompt)
        response = self.client.get("/api/agent/v1/judgment/context", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        bundle = response.get_json()["data"]["bundle"]
        self.assertIn("图解", json.dumps(bundle["learner_memory"], ensure_ascii=False))
        self.assertNotIn("视频", json.dumps(bundle["dialog"], ensure_ascii=False))
        history = json.dumps(user_store.list_learning_records(self.cfg, self.username), ensure_ascii=False)
        self.assertIn("视频", history)

    def test_forget_excludes_memory_and_old_dialogue_without_deleting_history(self):
        self.proxy.extract_output_text.return_value = "我会先给视频讲解。"
        self.ask("我喜欢先看视频")
        original = self.items()[0]
        goal = self.remember("我的学习目标是通过数据库考试")
        model_calls = self.proxy.complete_raw.call_count
        response = self.change("forget", original["id"])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["data"], {"updated": True})
        self.assertEqual([item["id"] for item in self.items()], [goal["id"]])
        self.assertEqual(self.proxy.complete_raw.call_count, model_calls)
        self.rebut.assert_not_called()
        indexed = self.index_updates.call_args.args[2]
        self.assertEqual([(row["id"], row["status"]) for row in indexed], [(original["id"], "retracted")])

        self.index_search.return_value = [original["id"]]
        self.proxy.extract_output_text.return_value = "事务有四个基本性质。"
        prompt = self.ask("事务是什么？")
        self.assertNotIn("视频", prompt)
        self.assertIn("通过数据库考试", prompt)
        bundle = self.client.get("/api/agent/v1/judgment/context", headers=self.headers).get_json()["data"]["bundle"]
        self.assertNotIn("视频", json.dumps(bundle["learner_memory"], ensure_ascii=False))
        self.assertNotIn("视频", json.dumps(bundle["dialog"], ensure_ascii=False))
        self.assertIn("视频", json.dumps(user_store.list_learning_records(self.cfg, self.username), ensure_ascii=False))

    def test_late_extraction_cannot_restore_forgotten_difficulty_using_another_quote(self):
        text = "我不理解事务隔离级别"
        original = self.remember(text)
        self.assertEqual(self.change("forget", original["id"]).status_code, 200)
        indexed_calls = self.index_updates.call_count
        result = evidence_memory.apply_model_claims(
            self.cfg, self.username, source_id=original["source_id"], text=text,
            occurred_at=original["occurred_at"],
            claims=[{"kind": "difficulty", "quote": "不理解事务隔离级别"}],
        )
        self.assertEqual(result["applied"], 0)
        self.assertEqual(self.index_updates.call_count, indexed_calls)
        self.assertEqual(self.items(), [])
        self.assertNotIn("隔离级别", evidence_memory.build_memory_context(self.cfg, self.username))

    def test_late_extraction_after_edit_keeps_existing_sibling_facts_without_restoring_old_quote(self):
        text = "我的学习目标是通过数据库考试，我不理解事务隔离级别"
        goal = self.remember(text)
        original = next(row for row in evidence_memory.retrieve_memories(self.cfg, self.username)
                        if row["kind"] == "difficulty")
        response = self.change("update", original["id"], text="我不理解可重复读")
        self.assertEqual(response.status_code, 200)
        replacement = response.get_json()["data"]["item"]
        result = evidence_memory.apply_model_claims(
            self.cfg, self.username, source_id=original["source_id"], text=text,
            occurred_at=original["occurred_at"],
            claims=[{"kind": "difficulty", "quote": "不理解事务隔离级别"}],
        )
        self.assertEqual(result["applied"], 0)
        self.assertEqual({item["id"] for item in self.items()}, {goal["id"], replacement["id"]})
        context = evidence_memory.build_memory_context(self.cfg, self.username)
        self.assertIn("通过数据库考试", context)
        self.assertIn("可重复读", context)
        self.assertNotIn("隔离级别", context)

    def test_edit_preserves_learning_scope(self):
        original = self.remember("我不理解事务隔离级别", lecture_id="course_a", book_id="book_a")
        response = self.change("update", original["id"], text="我不理解可重复读")
        self.assertEqual(response.status_code, 200)
        item = response.get_json()["data"]["item"]
        self.assertEqual((item["kind"], item["lecture_id"], item["book_id"]), ("difficulty", "course_a", "book_a"))
        self.assertGreater(item["updated_at"], original["occurred_at"])

    def test_edit_text_is_literal_even_if_it_matches_a_feedback_command(self):
        original = self.remember("我喜欢先看视频")
        response = self.change("update", original["id"], text="删除")
        self.assertEqual(response.status_code, 200)
        item = response.get_json()["data"]["item"]
        self.assertEqual(item["text"], "删除")
        self.assertEqual(self.items(), [item])

    def test_cross_account_unknown_and_stale_ids_cannot_change_memories(self):
        original = self.remember("我喜欢先看图解")
        other = self.remember("我喜欢先看视频", username="other_user")
        updated = self.change("update", original["id"], text="我喜欢先看代码").get_json()["data"]["item"]
        for memory_id in (original["id"], other["id"], "mem_missing"):
            for action in ("update", "forget"):
                with self.subTest(memory_id=memory_id, action=action):
                    response = self.change(action, memory_id, text="我喜欢先看文字")
                    self.assertEqual(response.status_code, 404)
                    self.assertEqual(response.get_json()["error"]["code"], "NOT_FOUND")
        self.assertEqual(self.items(), [updated])
        self.assertEqual([item["id"] for item in self.items(headers={"X-Nexora-Username": "other_user"})], [other["id"]])

    def test_conversation_and_insight_are_not_editable_or_forgettable_through_personal_api(self):
        episode = self.remember("🤣")
        insight_id = insert_insight(self.cfg, self.username, text="我注意到一条观察", source_ids=[episode["id"]])
        for memory_id in (episode["id"], insight_id, "reading_course"):
            for action in ("update", "forget"):
                with self.subTest(memory_id=memory_id, action=action):
                    self.assertEqual(self.change(action, memory_id, text="我喜欢先看文字").status_code, 404)
        self.assertEqual(self.items(), [])
        self.assertEqual({row["id"] for row in evidence_memory.retrieve_memories(self.cfg, self.username)},
                         {episode["id"], insight_id})

    def test_identity_overrides_are_rejected(self):
        other = self.remember("我喜欢先看视频", username="other_user")
        for identity in ({"username": "other_user"}, {"user_id": "other_user"}):
            for action in ("update", "forget"):
                with self.subTest(identity=identity, action=action):
                    self.assertEqual(self.change(action, other["id"], text="我喜欢先看文字", **identity).status_code, 403)
        self.assertEqual(self.client.get("/api/agent/v1/memories?username=other_user", headers=self.headers).status_code, 403)
        self.assertEqual(self.client.post("/api/agent/v1/memories/forget?username=other_user", headers=self.headers,
                                         json={"memory_id": other["id"]}).status_code, 403)
        self.assertEqual(self.client.get("/api/agent/v1/memories", headers={**self.headers, "X-User-Id": "other_user"}).status_code, 403)
        self.assertEqual([item["id"] for item in self.items(headers={"X-Nexora-Username": "other_user"})], [other["id"]])

    def test_invalid_payloads_do_not_change_the_original(self):
        original = self.remember("我喜欢先看视频")
        for text in (None, True, 3, [], {}, "", " \n ", "x" * 2001, "a\x00b"):
            with self.subTest(text=repr(text)[:40]):
                response = self.change("update", original["id"], text=text)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json()["error"]["code"], "INVALID_ARGUMENT")
        for memory_id in (None, True, 3, [], {}, "", " ", "../another", "x" * 161, "a\x00b"):
            for action in ("update", "forget"):
                with self.subTest(memory_id=repr(memory_id)[:40], action=action):
                    self.assertEqual(self.change(action, memory_id, text="我喜欢先看图解").status_code, 400)
        malformed = self.client.post("/api/agent/v1/memories/update", headers=self.headers,
                                     data="{", content_type="application/json")
        self.assertEqual(malformed.status_code, 400)
        self.assertEqual([item["id"] for item in self.items()], [original["id"]])

    def test_endpoints_require_valid_user_and_runtime_authorization(self):
        for path in ("/memories", "/memories/update", "/memories/forget"):
            method = self.client.get if path == "/memories" else self.client.post
            with self.subTest(path=path):
                self.assertEqual(method("/api/agent/v1" + path).status_code, 400)
                self.assertEqual(method("/api/agent/v1" + path, headers={"X-Nexora-Username": "../outside"}).status_code, 400)
        self.cfg["runtime_api"]["api_key"] = "fixture_key"
        for path in ("/memories", "/memories/update", "/memories/forget"):
            method = self.client.get if path == "/memories" else self.client.post
            with self.subTest(path=path):
                self.assertEqual(method("/api/agent/v1" + path, headers=self.headers).status_code, 401)
        self.assertEqual(self.client.get("/api/agent/v1/memories", headers={**self.headers, "X-API-Key": "fixture_key"}).status_code, 200)


if __name__ == "__main__":
    unittest.main()
