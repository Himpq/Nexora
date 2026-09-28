"""Local, deterministic checks for learner memory provenance and correction."""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

from core.memory import memory_analysis
from core.user import write_memory


class EvidenceMemoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.cfg = {"data_dir": str(Path(self.temporary.name) / "data")}

    def memory(self):
        from core.memory import evidence_memory

        return evidence_memory

    def record(self, text, source_id="msg_one", **kwargs):
        return self.memory().record_user_message(
            self.cfg, "alice", text=text, source_id=source_id, occurred_at=100, **kwargs
        )

    def test_background_analysis_never_uses_assistant_as_learner_evidence(self):
        seen = []

        class FakeRunner:
            def update_memory(self, *args, **kwargs):
                seen.append(json.dumps([args, kwargs], ensure_ascii=False))
                return "# 来自用户的记录\n"

        with (
            mock.patch.object(memory_analysis, "build_memory_runner", return_value=FakeRunner()),
            mock.patch.object(memory_analysis, "get_memory_settings", return_value={"enabled": True}),
            mock.patch.object(memory_analysis, "list_learning_records", return_value=[{
                "type": "agent_dialog", "lecture_id": "course", "source": "app",
                "question": "我的目标是通过期末考试", "answer": "__ASSISTANT_CLAIM__",
            }]),
        ):
            memory_analysis.run_memory_analysis_job(self.cfg, {
                "user_id": "alice", "lecture_id": "course", "job_id": "test", "reason": "interval",
                "payload": {"recent_conversation_messages": [
                    {"role": "assistant", "content": "__ASSISTANT_CLAIM__"},
                    {"role": "user", "content": "我喜欢先看图解"},
                ]},
            })
        self.assertTrue(seen)
        for prompt in seen:
            self.assertNotIn("__ASSISTANT_CLAIM__", prompt)
            self.assertIn("我的目标是通过期末考试", prompt)
            self.assertIn("我喜欢先看图解", prompt)

    def test_fact_is_durable_attributed_and_idempotent(self):
        first = self.record("我的学习目标是通过线性代数考试")
        self.assertTrue(first["created"])
        self.assertFalse(self.record("我的学习目标是通过线性代数考试")["created"])
        # A fresh reader has no in-process cache or open connection to rely on.
        rows = self.memory().retrieve_memories(dict(self.cfg), "alice", query="线性代数")
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["kind"], "goal")
        self.assertEqual(row["source_id"], "msg_one")
        self.assertEqual(row["source_type"], "user_message")
        self.assertEqual(row["occurred_at"], 100)
        self.assertIn("我的学习目标是通过线性代数考试", row["quote"])
        self.assertIn("你说过", row["claim"])
        self.assertNotIn("mastery", row)

    def test_question_is_an_episode_not_an_inferred_weakness(self):
        self.record("傅里叶变换是什么？")
        rows = self.memory().retrieve_memories(self.cfg, "alice")
        self.assertEqual([row["kind"] for row in rows], ["conversation"])
        self.assertNotIn("不会", rows[0]["claim"])
        dimensions = self.memory().read_profile_dimensions(self.cfg, "alice")
        self.assertFalse(any(item["filled"] for item in dimensions.values()))

    def test_quoted_and_hypothetical_statements_are_not_personal_facts(self):
        for index, text in enumerate([
            "老师说：我喜欢图解", "假如我是计算机专业，我应该怎么学？",
            "书上写着我不理解卷积，这是举例", "翻译：我的目标是通过考试",
            "我朋友说他学过概率论", "我想问一下什么是卷积",
            "我的专业是什么？", "我的学习目标是什么？", "我喜欢哪种讲解方法？",
        ]):
            self.record(text, source_id=f"quoted_{index}")
        rows = self.memory().retrieve_memories(self.cfg, "alice", limit=20)
        self.assertTrue(all(row["kind"] == "conversation" for row in rows))

    def test_explicit_negative_preference_replaces_previous_preference(self):
        self.record("我喜欢看视频")
        self.memory().record_user_message(self.cfg, "alice", text="我现在不喜欢看视频了",
                                          source_id="changed", occurred_at=200)
        rows = self.memory().retrieve_memories(self.cfg, "alice")
        self.assertEqual(len(rows), 1)
        self.assertIn("不喜欢", rows[0]["quote"])

    def test_latest_explicit_preference_supersedes_old_statement(self):
        old = self.record("我喜欢先看视频")["memories"][0]
        self.memory().record_user_message(self.cfg, "alice", text="更正一下，我更喜欢先看图解",
                                          source_id="msg_two", occurred_at=200)
        rows = self.memory().retrieve_memories(self.cfg, "alice")
        self.assertEqual(len(rows), 1)
        self.assertIn("图解", rows[0]["quote"])
        self.assertEqual(rows[0]["supersedes"], old["id"])
        self.assertNotIn("视频", self.memory().build_memory_context(self.cfg, "alice"))

    def test_replayed_older_statement_cannot_replace_newer_preference(self):
        self.memory().record_user_message(self.cfg, "alice", text="我更喜欢图解",
                                          source_id="new", occurred_at=200)
        self.record("我喜欢视频", source_id="late_old")
        rows = self.memory().retrieve_memories(self.cfg, "alice")
        self.assertEqual(len(rows), 1)
        self.assertIn("图解", rows[0]["quote"])

    def test_multiple_preference_clauses_are_atomic_and_keep_latest(self):
        self.record("我喜欢视频。我更喜欢图解。")
        rows = self.memory().retrieve_memories(self.cfg, "alice")
        self.assertEqual(len(rows), 1)
        self.assertIn("图解", rows[0]["quote"])

    def test_late_statement_cannot_resurrect_retracted_preference(self):
        original = self.record("我喜欢视频")["memories"][0]
        self.memory().correct_memory(self.cfg, "alice", original["id"], verdict="disagree",
                                     source_id="forget", occurred_at=200)
        self.memory().record_user_message(self.cfg, "alice", text="我喜欢先看视频",
                                          source_id="delayed", occurred_at=150)
        self.assertEqual(self.memory().retrieve_memories(self.cfg, "alice"), [])

    def test_correction_id_cannot_be_reused_for_a_different_verdict(self):
        original = self.record("我喜欢图解")["memories"][0]
        self.memory().correct_memory(self.cfg, "alice", original["id"], verdict="agree", source_id="feedback")
        with self.assertRaises(ValueError):
            self.memory().correct_memory(self.cfg, "alice", original["id"], verdict="disagree", source_id="feedback")

    def test_correction_replaces_quote_and_does_not_resurrect_legacy(self):
        write_memory(self.cfg, "alice", "user", "## 认知风格\n我喜欢视频\n")
        write_memory(self.cfg, "alice", "soul", "总是先给视频\n")
        old = self.record("我喜欢先看视频")["memories"][0]
        result = self.memory().correct_memory(self.cfg, "alice", old["id"], verdict="disagree",
                                              note="我现在更喜欢先看图解", source_id="correction_one",
                                              occurred_at=200)
        self.assertTrue(result["updated"])
        self.assertEqual(result["memory"]["supersedes"], old["id"])
        context = self.memory().build_memory_context(self.cfg, "alice", query="解释方法")
        self.assertIn("图解", context)
        self.assertNotIn("视频", context)
        retry = self.memory().correct_memory(self.cfg, "alice", old["id"], verdict="disagree",
                                             note="我现在更喜欢先看图解", source_id="correction_one",
                                             occurred_at=200)
        self.assertTrue(retry["duplicate"])
        self.assertEqual(retry["memory"]["id"], result["memory"]["id"])

    def test_retract_without_replacement_hides_old_fact(self):
        old = self.record("我的专业是计算机科学")["memories"][0]
        self.memory().correct_memory(self.cfg, "alice", old["id"], verdict="disagree",
                                     source_id="retract_one", occurred_at=200)
        self.assertEqual(self.memory().retrieve_memories(self.cfg, "alice"), [])

    def test_user_and_course_isolation_and_old_relevant_retrieval(self):
        self.record("我不理解傅里叶变换", lecture_id="signals")
        self.record("我喜欢图解", source_id="preference", lecture_id="signals")
        for index in range(20):
            self.record(f"数据库第 {index} 节的例题是什么", source_id=f"recent_{index}", lecture_id="database")
        self.assertEqual(self.memory().retrieve_memories(self.cfg, "bob"), [])
        selected = self.memory().retrieve_memories(self.cfg, "alice", query="傅里叶", lecture_id="signals", limit=2)
        self.assertEqual(selected[0]["kind"], "difficulty")
        other_course = self.memory().retrieve_memories(self.cfg, "alice", lecture_id="database", limit=30)
        self.assertFalse(any(row["kind"] == "difficulty" for row in other_course))
        self.assertTrue(any(row["kind"] == "preference" for row in other_course))

    def test_chinese_account_uses_the_same_isolated_memory_contract(self):
        self.memory().record_user_message(self.cfg, "同学甲", text="我的专业是计算机科学",
                                          source_id="same_id", occurred_at=100)
        self.memory().record_user_message(self.cfg, "同学乙", text="我的专业是数学",
                                          source_id="same_id", occurred_at=100)
        self.assertIn("计算机科学", self.memory().build_memory_context(self.cfg, "同学甲"))
        self.assertNotIn("计算机科学", self.memory().build_memory_context(self.cfg, "同学乙"))
        from core.memory.profile_center import build_profile_center_payload

        self.assertTrue(build_profile_center_payload(self.cfg, "同学甲")["dimensions"]["major"]["filled"])

    def test_corrected_preference_reaches_adaptive_question_generation(self):
        from core.memory import profile_question

        write_memory(self.cfg, "alice", "user", "## 认知风格\n我喜欢视频\n")
        original = self.record("我喜欢视频")["memories"][0]
        self.memory().correct_memory(self.cfg, "alice", original["id"], verdict="disagree",
                                     note="我更喜欢先看图解", source_id="correction")
        seen = {}

        class FakeRunner:
            def run(self, *args, **kwargs):
                seen.update(kwargs)
                raise RuntimeError("fixture stopped before generation")

        with (
            mock.patch.object(profile_question, "build_profile_question_runner", return_value=FakeRunner()),
            mock.patch.object(profile_question, "get_profile_question_settings", return_value={"enabled": True}),
            mock.patch.object(profile_question, "get_lecture", return_value={"id": "course", "title": "课程"}),
            mock.patch.object(profile_question, "load_chapter_concept_candidates", return_value=[]),
            self.assertRaisesRegex(RuntimeError, "fixture stopped before generation"),
        ):
            profile_question.run_profile_question_job(self.cfg, {"user_id": "alice", "lecture_id": "course"})
        context = seen["extra_prompt_vars"]["user_memory"]
        self.assertIn("图解", context)
        self.assertNotIn("视频", context)

    def test_parallel_messages_are_not_lost(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda n: self.record(f"例题 {n} 怎么做", source_id=f"concurrent_{n}"), range(16)))
        rows = self.memory().retrieve_memories(self.cfg, "alice", limit=30)
        self.assertEqual(len(rows), 16)

    def test_read_recovers_database_interrupted_during_first_initialization(self):
        target = Path(self.cfg["data_dir"]) / "users" / "alice" / "memories" / "evidence.sqlite3"
        target.parent.mkdir(parents=True)
        sqlite3.connect(target).close()
        self.assertEqual(self.memory().retrieve_memories(self.cfg, "alice"), [])
        self.record("我喜欢图解")
        self.assertEqual(len(self.memory().retrieve_memories(self.cfg, "alice")), 1)

    def test_reading_an_unknown_user_does_not_create_database_files(self):
        for _ in range(3):
            self.assertEqual(self.memory().retrieve_memories(self.cfg, "unknown"), [])
            self.assertEqual(self.memory().memory_stats(self.cfg, "unknown")["active_count"], 0)
        self.assertFalse(Path(self.cfg["data_dir"]).exists())

    def test_stable_preference_survives_many_relevant_conversation_episodes(self):
        self.record("我喜欢先看图解")
        for index in range(12):
            self.record(f"数据库事务第 {index} 个例子是什么", source_id=f"discussion_{index}")
        context = self.memory().build_memory_context(self.cfg, "alice", query="数据库事务怎么实现？")
        self.assertIn("图解", context)
        self.assertIn("数据库事务", context)

    def test_rejects_assistant_role_and_unsafe_user_directory(self):
        with self.assertRaises(ValueError):
            self.record("我的学习目标是掌握全部内容", role="assistant")
        for user in ["..", ".", "../alice", "alice/../bob", "alice\\..\\bob"]:
            with self.assertRaises(ValueError):
                self.memory().retrieve_memories(self.cfg, user)

    def test_legacy_memory_is_labeled_and_profile_updates_immediately(self):
        write_memory(self.cfg, "alice", "user", "## 专业方向\n计算机科学\n")
        write_memory(self.cfg, "alice", "soul", "先给一个简短例子\n")
        legacy = self.memory().build_memory_context(self.cfg, "alice")
        self.assertIn("未溯源", legacy)
        self.assertIn("计算机科学", legacy)
        self.assertIn("简短例子", legacy)
        self.record("我的学习目标是通过期末考试")
        from core.memory.profile_center import build_profile_center_payload

        profile = build_profile_center_payload(self.cfg, "alice")
        self.assertTrue(profile["dimensions"]["learning_goal"]["filled"])
        self.assertIn("通过期末考试", profile["dimensions"]["learning_goal"]["value"])
        self.assertGreater(profile["profile_completion"], 0)
        self.assertTrue(all(row["score"] is None for row in profile["scores"]))


if __name__ == "__main__":
    unittest.main()
