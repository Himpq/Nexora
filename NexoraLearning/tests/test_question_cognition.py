from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from core.cognition import CognitionService, QuestionCognitionBridge
from core.cognition.question_binding import validate_question_concept_bindings
from core.lectures import create_book, create_lecture


class QuestionCognitionBridgeTestCase(unittest.TestCase):
    graph = {
        "chapters": [
            {
                "name": "优化基础",
                "concepts": [
                    {"name": "梯度下降", "detail": "参数更新方法。", "children": []},
                ],
            }
        ]
    }

    def _fixture(self):
        temp_dir = tempfile.TemporaryDirectory()
        cfg = {"data_dir": temp_dir.name}
        lecture = create_lecture(cfg, "机器学习")
        book = create_book(cfg, lecture["id"], "优化方法")
        graph_path = (
            Path(temp_dir.name)
            / "lectures"
            / lecture["id"]
            / "books"
            / book["id"]
            / "knowledge_graph.json"
        )
        graph_path.write_text(json.dumps(self.graph, ensure_ascii=False), encoding="utf-8")
        catalog = CognitionService(cfg).get_catalog(lecture["id"], book_id=book["id"])
        return temp_dir, cfg, lecture, book, catalog["concepts"][0]["concept_id"]

    def _question(self, lecture, book, concept_id):
        return {
            "question_id": "question-1",
            "lecture_id": lecture["id"],
            "book_id": book["id"],
            "chapter_name": "优化基础",
            "question": {
                "question_type": "choice",
                "question_options": ["A", "B", "C", "D"],
                "related_concept_id": concept_id,
            },
        }

    def test_judged_submission_records_idempotent_evidence(self) -> None:
        temp_dir, cfg, lecture, book, concept_id = self._fixture()
        try:
            bridge = QuestionCognitionBridge(cfg)
            question = self._question(lecture, book, concept_id)
            completion = {
                "completion_id": "qc-1",
                "timestamp": 1_700_000_000,
                "is_correct": True,
            }

            first = bridge.record_submission("learner-1", question, completion)
            second = bridge.record_submission("learner-1", question, completion)
            evidence = CognitionService(cfg).list_evidence(
                "learner-1",
                lecture_id=lecture["id"],
                book_id=book["id"],
            )

            self.assertTrue(first["recorded"])
            self.assertTrue(first["created"])
            self.assertTrue(second["recorded"])
            self.assertFalse(second["created"])
            self.assertEqual(1, evidence["count"])
            self.assertEqual("objective_question", evidence["items"][0]["evidence_type"])
            self.assertEqual(1.0, evidence["items"][0]["score"])
        finally:
            temp_dir.cleanup()

    def test_unassessed_and_unbound_submissions_are_explicitly_skipped(self) -> None:
        temp_dir, cfg, lecture, book, concept_id = self._fixture()
        try:
            bridge = QuestionCognitionBridge(cfg)
            question = self._question(lecture, book, concept_id)
            unassessed = bridge.record_submission(
                "learner-1",
                question,
                {"completion_id": "qc-2", "timestamp": 1_700_000_001},
            )
            unbound_question = self._question(lecture, book, "")
            unbound = bridge.record_submission(
                "learner-1",
                unbound_question,
                {"completion_id": "qc-3", "timestamp": 1_700_000_002, "is_correct": False},
            )

            self.assertFalse(unassessed["recorded"])
            self.assertEqual("unassessed_completion", unassessed["reason"])
            self.assertFalse(unbound["recorded"])
            self.assertEqual("question_concept_unbound", unbound["reason"])
        finally:
            temp_dir.cleanup()

    def test_concept_binding_rejects_ids_outside_current_chapter(self) -> None:
        error = validate_question_concept_bindings(
            [{"related_concept_id": "cx-other"}],
            [{"concept_id": "cx-current"}],
        )

        self.assertIn("第 1 题", error)
        self.assertIn("有效 concept_id", error)


if __name__ == "__main__":
    unittest.main()
