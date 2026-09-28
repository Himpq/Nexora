"""Cold-start learner feedback across the actual Agent HTTP boundary.

These tests use temporary users, real evidence files and a stubbed model. Reading
and self-reports must be visible without pretending they are graded knowledge.
"""
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
from core.cognition.facets import build_facets, record_verdict
from core.cognition.service import CognitionService
from core.lectures import create_book, create_lecture, save_book_info_xml, save_book_text
from core.user.learning_progress import init_learning_progress


class AgentLearningFeedbackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.cfg = {
            "data_dir": str(Path(self.temp.name) / "data"),
            "runtime_api": {"enabled": True, "api_key": ""},
            "nexora": {"base_url": "http://127.0.0.1:9", "api_key": ""},
            "models": {"default_nexora_model": ""},
        }
        self.app = Flask(__name__)
        init_agent_facade(self.cfg)
        init_learning_progress(self.cfg)
        self.app.register_blueprint(agent_facade_bp)
        self.client = self.app.test_client()
        self.headers = {"X-Nexora-Username": "new_learner"}

    def seed_course(self, *, catalog=True):
        lecture = create_lecture(self.cfg, "数据库导论", status="published")
        book = create_book(self.cfg, lecture["id"], "数据库教材")
        body = "第一章 事务\n" + "事务保证操作的一致性。" * 80
        save_book_text(self.cfg, lecture["id"], book["id"], body)
        save_book_info_xml(self.cfg, lecture["id"], book["id"],
                           f"<book><chapter><chapter_name>第一章 事务</chapter_name>"
                           f"<chapter_range>0:{len(body)}</chapter_range></chapter></book>")
        user_store.set_lecture_selection(self.cfg, "new_learner", lecture["id"], selected=True)
        if catalog:
            solidified = Path(self.cfg["data_dir"]) / "lectures" / lecture["id"] / "solidified"
            solidified.mkdir(parents=True, exist_ok=True)
            outline = {"course_title": "数据库导论", "sections": [{
                "id": "sec_001", "title": "第一章 事务", "summary": "",
                "key_concepts": ["事务"], "objectives": [], "prerequisites": [],
                "sources": [{"book_id": book["id"], "chapter_name": "第一章 事务"}],
            }]}
            graph = {"course_title": "数据库导论", "chapters": [{
                "section_id": "sec_001", "name": "第一章 事务", "summary": "",
                "concepts": [{"name": "事务", "detail": "一致性"}],
            }], "relations": []}
            (solidified / "outline.json").write_text(json.dumps(outline, ensure_ascii=False), encoding="utf-8")
            (solidified / "mindmap.json").write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
        return lecture, book

    def ask(self, text):
        with patch("api.agent_facade._PROXY") as proxy:
            proxy.complete_raw.return_value = {"success": True, "payload": {}}
            proxy.extract_output_text.return_value = "我会结合你的学习情况来解释。"
            response = self.client.post("/api/agent/v1/ask-in-context", headers=self.headers,
                                        json={"question": text})
            self.assertEqual(response.status_code, 200)
            messages = proxy.complete_raw.call_args.kwargs["messages"]
        return response.get_json()["data"], json.dumps(messages, ensure_ascii=False)

    def enable_frontend(self):
        from api import routes
        from api.learning_progress import learning_progress_bp, init_learning_progress as init_progress_api
        from api.telemetry import init_telemetry
        with patch("api.routes.init_booksproc"), patch("api.routes.init_memory_queue"):
            routes.init_routes(self.cfg)
        init_progress_api(self.cfg)
        init_telemetry(self.cfg)
        self.app.register_blueprint(routes.bp)
        self.app.register_blueprint(learning_progress_bp)

    def checkpoint(self, lecture, book, *, seconds=1800, session="reading-session"):
        from core.bookindex import get_book_index
        chapter = get_book_index(self.cfg, lecture["id"], book["id"]).chapters[0]
        observed = int(time.time() * 1000)
        response = self.client.post("/api/frontend/learning/reading-progress", headers=self.headers, json={
            "lecture_id": lecture["id"], "book_id": book["id"], "chapter_index": 0,
            "chapter_name": chapter.title, "chapter_range": chapter.range,
            "session_id": session, "sequence": 1, "active_duration_ms": seconds * 1000,
            "started_at_ms": observed - seconds * 1000, "observed_at_ms": observed,
            "read_ranges": [[chapter.start, chapter.start + chapter.length // 2]],
            "paragraph_index": 0, "page_index": 0, "coordinate_space": "plain",
        })
        self.assertEqual(response.status_code, 200, response.get_json())

    def test_reading_updates_context_report_mirror_and_timeline_without_completion(self):
        self.enable_frontend()
        lecture, book = self.seed_course(catalog=False)
        self.checkpoint(lecture, book)
        context = self.client.get("/api/agent/v1/context", headers=self.headers).get_json()["data"]
        course = context["lectures"][0]
        self.assertGreater(course["reading_progress_percent"], 0)
        self.assertEqual(course["completed_chapters"], 0)
        report = self.client.get(f"/api/frontend/learning/report?lecture_id={lecture['id']}&book_id={book['id']}",
                                 headers=self.headers).get_json()
        self.assertTrue(report["success"], report)
        self.assertEqual(report["summary"]["reading_progress_percent"], course["reading_progress_percent"])
        self.assertEqual(report["summary"]["reading_seconds"], 1800)
        self.assertEqual(report["summary"]["completed_chapters"], 0)
        self.assertTrue(any("确认理解" in row["title"] for row in report["recommendations"]))
        overview = self.client.get("/api/agent/v1/cognition/overview", headers=self.headers).get_json()["data"]
        self.assertEqual(overview["activity"]["reading_seconds"], 1800)
        self.assertTrue(any(row["kind"] == "reading" for row in overview["facets"]))
        entries = self.client.get("/api/agent/v1/events", headers=self.headers).get_json()["data"]["entries"]
        self.assertTrue(any(row.get("trigger") == "reading_progress" for row in entries))
        self.assertFalse(any(row.get("type") == "chapter_completed" for row in user_store.list_learning_records(self.cfg, "new_learner")))

    def test_report_book_scope_and_unassessed_graph_keep_the_same_reading_state(self):
        self.enable_frontend()
        lecture, book = self.seed_course()
        other = create_book(self.cfg, lecture["id"], "另一本教材")
        save_book_text(self.cfg, lecture["id"], other["id"], "第一章 事务\n其他章节内容" * 20)
        self.checkpoint(lecture, book, seconds=40)
        report = self.client.get(f"/api/frontend/learning/report?lecture_id={lecture['id']}&book_id={book['id']}",
                                 headers=self.headers).get_json()
        self.assertEqual(report["summary"]["total_chapters"], 1)
        graph = self.client.get(f"/api/frontend/knowledge-graph?lecture_id={lecture['id']}&book_id={book['id']}",
                                headers=self.headers).get_json()["graph"]
        self.assertIsNotNone(graph)
        self.assertEqual(graph["chapters"][0]["reading_percent"], report["summary"]["reading_progress_percent"])
        self.assertFalse(graph["chapters"][0]["completed"])
        self.assertIsNone(graph["chapters"][0]["concepts"][0]["mastery"])

    def test_chat_updates_existing_profile_and_report_dimensions(self):
        self.enable_frontend()
        lecture, book = self.seed_course(catalog=False)
        self.ask("我的目标是通过数据库考试。")
        profile = self.client.get("/api/frontend/profile", headers=self.headers).get_json()
        self.assertGreater(profile["completion_rate"], 0)
        self.assertIn("数据库考试", profile["dimensions"]["learning_goal"]["value"])
        report = self.client.get(f"/api/frontend/learning/report?lecture_id={lecture['id']}", headers=self.headers).get_json()
        self.assertIn("数据库考试", json.dumps(report["recommendations"], ensure_ascii=False))

    def test_unassessed_concepts_are_unknown_instead_of_zero_mastery(self):
        self.seed_course()
        overview = self.client.get("/api/agent/v1/cognition/overview", headers=self.headers).get_json()["data"]
        self.assertTrue(overview["mastery"])
        self.assertIsNone(overview["mastery"][0]["mastery"])
        self.assertFalse(any(row.get("kind") == "mastery" for row in overview["facets"]))

    def test_reading_without_a_graph_produces_an_observation(self):
        lecture, book = self.seed_course(catalog=False)
        user_store.append_learning_record(self.cfg, "new_learner", {
            "type": "reading_progress", "lecture_id": lecture["id"], "book_id": book["id"],
            "chapter_index": 0, "chapter_name": "第一章 事务", "study_seconds": 1800,
            "read_ranges": [[0, 250]], "reading_percent": 25, "session_id": "reading-1",
            "sequence": 1, "active_duration_ms": 1800000, "timestamp": int(time.time()),
        })
        overview = build_facets(self.cfg, "new_learner")
        reading = [row for row in overview["facets"] if row.get("kind") == "reading"]
        self.assertTrue(reading, "Reading must remain visible before a knowledge graph exists")
        self.assertTrue(reading[0]["evidence"])
        self.assertEqual(overview["activity"]["reading_seconds"], 1800)
        self.assertEqual(overview["activity"]["assessed_concepts"], 0)

    def test_a_new_chat_preference_reaches_the_next_answer_and_mirror(self):
        self.ask("我更喜欢先看具体例子，再解释公式。")
        overview = self.client.get("/api/agent/v1/cognition/overview", headers=self.headers).get_json()["data"]
        self.assertTrue(any("具体例子" in row["claim"] for row in overview["facets"]))
        _, messages = self.ask("事务是什么？")
        self.assertIn("具体例子", messages)
        # Another account must not inherit the first student's preferences.
        self.headers = {"X-Nexora-Username": "another_learner"}
        _, other_messages = self.ask("事务是什么？")
        self.assertNotIn("具体例子", other_messages)

    def test_chat_preferences_reach_proactive_judgment(self):
        self.ask("我的目标是通过数据库考试。")
        bundle = self.client.get("/api/agent/v1/judgment/context", headers=self.headers).get_json()["data"]["bundle"]
        self.assertIn("数据库考试", json.dumps(bundle.get("learner_memory"), ensure_ascii=False))

    def test_correct_answers_are_an_observation_instead_of_a_risk(self):
        lecture, book = self.seed_course()
        for number in range(3):
            user_store.append_question_completion(self.cfg, "new_learner", {
                "lecture_id": lecture["id"], "book_id": book["id"], "chapter_index": 0,
                "question_id": f"question-{number}", "question_title": "事务的基本性质",
                "is_correct": True,
            })
        bundle = self.client.get("/api/agent/v1/judgment/context", headers=self.headers).get_json()["data"]["bundle"]
        cognition = bundle["cognition"]
        self.assertEqual(cognition["at_risk"], [])
        self.assertTrue(any("100%" in row for row in cognition["observations"]))
        self.assertEqual(cognition["stable"], [], "Three correct answers alone do not establish stable mastery")

    def test_low_accuracy_remains_a_risk_with_its_actual_sample(self):
        lecture, book = self.seed_course()
        for number, correct in enumerate([False, True, False]):
            user_store.append_question_completion(self.cfg, "new_learner", {
                "lecture_id": lecture["id"], "book_id": book["id"], "chapter_index": 0,
                "question_id": f"question-{number}", "question_title": "事务的基本性质",
                "is_correct": correct,
            })
        bundle = self.client.get("/api/agent/v1/judgment/context", headers=self.headers).get_json()["data"]["bundle"]
        self.assertTrue(any("33%" in row and "1/3" in row for row in bundle["cognition"]["at_risk"]))
        overview = self.client.get("/api/agent/v1/cognition/overview", headers=self.headers).get_json()["data"]
        accuracy = next(row for row in overview["facets"] if row["kind"] == "accuracy")
        self.assertEqual(accuracy["assessment"], {"accuracy": 1 / 3, "correct": 1, "total": 3})

    def test_rejecting_a_judgment_is_not_a_wrong_exam_answer(self):
        lecture, book = self.seed_course()
        service = CognitionService(self.cfg)
        concept = service.get_catalog(lecture["id"])["concepts"][0]
        service.record_evidence("new_learner", {
            "evidence_id": "graded-1", "lecture_id": lecture["id"], "book_id": book["id"],
            "concept_id": concept["concept_id"], "evidence_type": "objective_question",
            "source_type": "manual", "source_id": "quiz-1", "score": 0,
            "occurred_at": int(time.time()),
        })
        before = build_facets(self.cfg, "new_learner")
        facet = next(row for row in before["facets"] if row.get("kind") == "mastery")
        result = record_verdict(self.cfg, "new_learner", facet["id"], "disagree",
                                lecture_id=lecture["id"], book_id=book["id"], concept_id=concept["concept_id"])
        after = build_facets(self.cfg, "new_learner")
        self.assertEqual(after["mastery"][0]["mastery"], before["mastery"][0]["mastery"])
        self.assertFalse(result["evidence_written"])
        self.assertEqual(next(row for row in after["facets"] if row["id"] == facet["id"])["userVerdict"], "disagree")

    def test_old_feedback_rows_cannot_keep_corrupting_mastery(self):
        lecture, book = self.seed_course()
        service = CognitionService(self.cfg)
        concept = service.get_catalog(lecture["id"])["concepts"][0]
        service.record_evidence("new_learner", {
            "evidence_id": "legacy-verdict", "lecture_id": lecture["id"], "book_id": book["id"],
            "concept_id": concept["concept_id"], "evidence_type": "review", "source_type": "manual",
            "source_id": "facet:old", "score": 0, "occurred_at": int(time.time()),
            "metadata": {"facet_id": "old", "verdict": "disagree"},
        })
        result = build_facets(self.cfg, "new_learner")
        self.assertIsNone(result["mastery"][0]["mastery"])
        self.assertEqual(result["activity"]["assessed_concepts"], 0)


if __name__ == "__main__":
    unittest.main()
