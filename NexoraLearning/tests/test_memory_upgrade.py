"""§6 记忆升级：模型抽取并入、分层预算、时间有效性、反思 insight、可见可纠。"""

from __future__ import annotations

import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask

from api.agent_facade import agent_facade_bp, init_agent_facade
from core import user as user_store
from core.lectures import create_book, create_lecture, save_book_info_xml, save_book_text
from core.memory import evidence_memory as em
from core.memory import memory_extract, reflection
from core.user import set_lecture_selection


class FakeProxy:
    def __init__(self, answer: str):
        self.answer = answer
        self.calls = []

    def complete_raw(self, **kwargs):
        self.calls.append(kwargs)
        return {"success": True, "payload": {"answer": self.answer}}

    def extract_output_text(self, payload):
        return str(payload.get("answer") or "")


class MemoryUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.cfg = {"data_dir": str(Path(self.temporary.name) / "data"),
                    "runtime_api": {"enabled": True, "api_key": ""},
                    "nexora": {"base_url": "http://127.0.0.1:9", "api_key": ""},
                    "models": {"default_nexora_model": ""}}

    def test_model_claims_supersede_and_keep_provenance(self):
        # 「我更喜欢图解」→ 正则已抓到 preference；之后「其实我还是喜欢例子」由模型抽取并 supersede
        first = em.record_user_message(self.cfg, "u", text="我更喜欢图解", source_id="m1", occurred_at=100)
        old_id = [row for row in first["memories"] if row["kind"] == "preference"][0]["id"]
        em.record_user_message(self.cfg, "u", text="行吧，说实话我还是觉得例子好懂", source_id="m2", occurred_at=200)
        proxy = FakeProxy(json.dumps([{"op": "supersede", "kind": "preference", "quote": "我还是觉得例子好懂",
                                       "confidence": 0.85, "supersedes": old_id},
                                      {"op": "remember", "kind": "goal", "quote": "这句不在原话里", "confidence": 0.9}]))
        outcome = memory_extract.run_extraction(proxy, self.cfg, "u", text="行吧，说实话我还是觉得例子好懂", answer="好的",
                                                source_id="m2", occurred_at=200)
        self.assertEqual(outcome["applied"], 1)
        self.assertEqual(outcome["skipped"], 1)  # 非原话片段被拒
        active = em.retrieve_memories(self.cfg, "u", limit=20)
        prefs = [row for row in active if row["kind"] == "preference"]
        self.assertEqual(len(prefs), 1)
        self.assertEqual(prefs[0]["quote"], "我还是觉得例子好懂")
        self.assertEqual(prefs[0]["source_id"], "m2")
        self.assertTrue(prefs[0]["said_on"])
        # 原话已抽成偏好，不再作为 conversation 占预算
        self.assertFalse(any(row["kind"] == "conversation" and row["source_id"] == "m2" for row in active))
        # 时间线出现「我记住了」
        notes = [row for row in user_store.list_learning_records(self.cfg, "u") if row.get("event") == "memory_noted"]
        self.assertEqual(len(notes), 1)
        context = em.build_memory_context(self.cfg, "u", query="讲讲索引")
        self.assertIn("稳定画像", context)
        self.assertNotIn("图解", context)

    def test_plain_question_produces_only_conversation(self):
        em.record_user_message(self.cfg, "u", text="索引的代价是什么", source_id="q1", occurred_at=100)
        proxy = FakeProxy("[]")
        outcome = memory_extract.run_extraction(proxy, self.cfg, "u", text="索引的代价是什么", answer="写放大", source_id="q1")
        self.assertEqual(outcome["applied"], 0)
        kinds = {row["kind"] for row in em.retrieve_memories(self.cfg, "u", limit=20)}
        self.assertEqual(kinds, {"conversation"})

    def test_core_profile_is_always_carried_and_related_is_bounded(self):
        em.record_user_message(self.cfg, "u", text="我是计算机专业的学生", source_id="a", occurred_at=100)
        em.record_user_message(self.cfg, "u", text="我更喜欢用例子讲解", source_id="b", occurred_at=101)
        for index in range(12):
            em.record_user_message(self.cfg, "u", text=f"备份还原第 {index} 问", source_id=f"c{index}", occurred_at=200 + index)
        context = em.build_memory_context(self.cfg, "u", query="备份还原", limit=8)
        self.assertIn("稳定画像", context)
        self.assertIn("我是计算机专业的学生", context)
        self.assertIn("与本题相关", context)
        related = context.split("与本题相关")[1]
        self.assertLessEqual(related.count('"kind": "conversation"'), 6)

    def test_difficulty_expires_when_concept_stable(self):
        em.record_user_message(self.cfg, "u", text="我不太懂数据库备份和还原的区别", source_id="d1", occurred_at=100)
        self.assertEqual(em.expire_difficulties(self.cfg, "u", "备份", reason_id="c_backup"), 1)
        self.assertEqual(em.expire_difficulties(self.cfg, "u", "备份", reason_id="c_backup"), 0)
        self.assertFalse(any(row["kind"] == "difficulty" for row in em.retrieve_memories(self.cfg, "u", limit=20)))

    def test_conversation_decays_after_30_days_but_stays(self):
        now = int(time.time())
        em.record_user_message(self.cfg, "u", text="备份还原怎么做", source_id="old", occurred_at=now - 40 * 86400)
        em.record_user_message(self.cfg, "u", text="备份还原的顺序", source_id="new", occurred_at=now - 10)
        rows = em.retrieve_memories(self.cfg, "u", query="备份还原", limit=5)
        self.assertEqual(rows[0]["source_id"], "new")
        self.assertEqual({row["source_id"] for row in rows}, {"old", "new"})

    def test_reflection_writes_insight_and_mirror_ranks_it_first(self):
        now = int(time.time())
        ids = []
        for index in range(5):
            result = em.record_user_message(self.cfg, "u", text=f"备份还原第 {index} 次提问", source_id=f"r{index}", occurred_at=now - index * 3600)
            ids.append(result["memories"][0]["id"])
        proxy = FakeProxy(json.dumps([{"text": "我注意到你最近多次在备份还原上提问。", "source_ids": ids[:3], "confidence": 0.8},
                                      {"text": "没有依据的结论", "source_ids": ["mem_nope"]}]))
        outcome = reflection.run_reflection(proxy, self.cfg, "u", now=now)
        self.assertTrue(outcome["ran"])
        self.assertEqual(len(outcome["written"]), 1)
        # 幂等：同一天再跑不重复
        self.assertEqual(len(reflection.run_reflection(proxy, self.cfg, "u", now=now)["written"]), 0)
        from core.cognition.learning_observations import learning_observations

        facets = learning_observations(self.cfg, "u")["facets"]
        insight = [row for row in facets if row["kind"] == "insight"]
        self.assertEqual(len(insight), 1)
        self.assertIn("备份还原", insight[0]["claim"])
        self.assertGreaterEqual(len(insight[0]["evidence"]), 2)

        from core.cognition.facets import build_facets

        with patch("core.cognition.facets._load_catalog", return_value=(None, [])):
            ordered = build_facets(self.cfg, "u")["facets"]
        self.assertEqual(ordered[0]["kind"], "insight")

    def test_ask_in_context_schedules_model_extraction(self):
        lecture = create_lecture(self.cfg, "课", status="published")
        book = create_book(self.cfg, lecture["id"], "书")
        save_book_text(self.cfg, lecture["id"], book["id"], "第一章 备份\n备份是数据库的副本。\n")
        save_book_info_xml(self.cfg, lecture["id"], book["id"],
                           "<book><chapter><chapter_name>第一章 备份</chapter_name><chapter_range>0:20</chapter_range></chapter></book>")
        set_lecture_selection(self.cfg, "u", lecture["id"], selected=True, actor="test")
        app = Flask(__name__)
        init_agent_facade(self.cfg)
        app.register_blueprint(agent_facade_bp)
        with patch("api.agent_facade._PROXY", FakeProxy("备份是副本。")), \
                patch("core.memory.memory_extract.schedule_extraction") as scheduled:
            response = app.test_client().post("/api/agent/v1/ask-in-context", headers={"X-Nexora-Username": "u"},
                                              json={"question": "我平时晚上才有时间学，备份是什么"})
            self.assertEqual(response.status_code, 200)
            scheduled.assert_called_once()
            self.assertEqual(scheduled.call_args.kwargs.get("text"), "我平时晚上才有时间学，备份是什么")


if __name__ == "__main__":
    unittest.main()
