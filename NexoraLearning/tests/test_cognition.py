from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from core.cognition import (
    CognitionCatalogError,
    CognitionConflictError,
    CognitionService,
    CognitiveEvidence,
    CognitiveEvidenceStore,
    CognitiveStateEngine,
    ConceptCatalogBuilder,
)
from core.lectures import create_book, create_lecture


class CognitionTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.builder = ConceptCatalogBuilder()
        self.graph = {
            "chapters": [
                {
                    "name": "优化基础",
                    "concepts": [
                        {
                            "name": "梯度下降",
                            "detail": "通过梯度更新参数。",
                            "children": [
                                {
                                    "name": "学习率",
                                    "detail": "控制单次更新幅度。",
                                    "children": [],
                                }
                            ],
                        }
                    ],
                }
            ]
        }
        self.concepts = self.builder.build_book_catalog("lecture-1", "book-1", self.graph)
        self.concept = self.concepts[0]

    def _evidence(self, evidence_id: str, **updates):
        payload = {
            "evidence_id": evidence_id,
            "lecture_id": "lecture-1",
            "book_id": "book-1",
            "concept_id": self.concept.concept_id,
            "evidence_type": "objective_question",
            "source_type": "question",
            "source_id": "question-1",
            "occurred_at": 1_700_000_000,
            "score": 1.0,
            "confidence": 0.8,
            "metadata": {},
        }
        payload.update(updates)
        return CognitiveEvidence.from_payload("learner-1", payload)

    def test_catalog_ids_are_stable_and_include_nested_concepts(self) -> None:
        repeated = self.builder.build_book_catalog("lecture-1", "book-1", self.graph)

        self.assertEqual(2, len(repeated))
        self.assertEqual([row.concept_id for row in self.concepts], [row.concept_id for row in repeated])
        self.assertEqual(("梯度下降", "学习率"), repeated[1].path)

    def test_catalog_ids_do_not_change_when_chapters_are_reordered(self) -> None:
        graph = {
            "chapters": [
                {
                    "name": "先修知识",
                    "concepts": [{"name": "导数", "detail": "变化率", "children": []}],
                },
                self.graph["chapters"][0],
            ]
        }
        reordered = {"chapters": list(reversed(graph["chapters"]))}
        first = self.builder.build_book_catalog("lecture-1", "book-1", graph)
        second = self.builder.build_book_catalog("lecture-1", "book-1", reordered)
        first_ids = {row.name: row.concept_id for row in first}
        second_ids = {row.name: row.concept_id for row in second}

        self.assertEqual(first_ids, second_ids)

    def test_catalog_rejects_missing_concepts_array(self) -> None:
        malformed = {"chapters": [{"name": "章节"}]}

        with self.assertRaises(CognitionCatalogError):
            self.builder.build_book_catalog("lecture-1", "book-1", malformed)

    def test_exposure_does_not_create_mastery(self) -> None:
        exposure = self._evidence(
            "evidence-exposure",
            evidence_type="exposure",
            source_type="reading",
            score=None,
            confidence=None,
        )
        state = CognitiveStateEngine().compute(self.concept, [exposure], now=1_700_000_000)

        self.assertEqual("unverified", state.status)
        self.assertIsNone(state.mastery)
        self.assertIsNone(state.retention)

    def test_state_tracks_misconception_and_resolution(self) -> None:
        incorrect = self._evidence(
            "evidence-wrong",
            score=0.0,
            confidence=0.95,
            metadata={"misconception_ids": ["learning-rate-always-faster"]},
        )
        resolved = self._evidence(
            "evidence-review",
            evidence_type="review",
            source_type="review",
            source_id="review-1",
            occurred_at=1_700_086_400,
            score=1.0,
            confidence=0.8,
            metadata={"resolved_misconception_ids": ["learning-rate-always-faster"]},
        )
        engine = CognitiveStateEngine()
        before = engine.compute(self.concept, [incorrect], now=1_700_000_000)
        after = engine.compute(self.concept, [incorrect, resolved], now=1_700_086_400)

        self.assertEqual("at_risk", before.status)
        self.assertEqual(1, len(before.misconceptions))
        self.assertEqual([], list(after.misconceptions))
        self.assertGreater(before.calibration_gap, 0)

    def test_store_is_idempotent_and_rejects_conflicting_duplicate(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            store = CognitiveEvidenceStore({"data_dir": temp_dir})
            evidence = self._evidence("evidence-stable")

            _, first_created = store.append(evidence)
            _, second_created = store.append(evidence)

            self.assertTrue(first_created)
            self.assertFalse(second_created)
            self.assertEqual(1, len(store.list("learner-1")))

            conflict = self._evidence("evidence-stable", score=0.0)

            with self.assertRaises(CognitionConflictError):
                store.append(conflict)

    def test_store_reports_malformed_json_instead_of_skipping_it(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "users" / "learner-1" / "cognition" / "evidence.jsonl"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(self._evidence("valid").to_dict(), ensure_ascii=False) + "\n{broken\n", encoding="utf-8")
            store = CognitiveEvidenceStore({"data_dir": temp_dir})

            with self.assertRaisesRegex(RuntimeError, "invalid JSON"):
                store.list("learner-1")

    def test_service_records_evidence_and_builds_overview(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cfg = {"data_dir": temp_dir}
            lecture = create_lecture(cfg, "机器学习")
            book = create_book(cfg, lecture["id"], "优化方法")
            graph_path = (
                Path(temp_dir)
                / "lectures"
                / lecture["id"]
                / "books"
                / book["id"]
                / "knowledge_graph.json"
            )
            graph_path.write_text(json.dumps(self.graph, ensure_ascii=False), encoding="utf-8")
            service = CognitionService(cfg)
            catalog = service.get_catalog(lecture["id"], book_id=book["id"])
            concept_id = catalog["concepts"][0]["concept_id"]
            result = service.record_evidence(
                "learner-1",
                {
                    "evidence_id": "exam-1-question-1",
                    "lecture_id": lecture["id"],
                    "book_id": book["id"],
                    "concept_id": concept_id,
                    "evidence_type": "objective_question",
                    "source_type": "question",
                    "source_id": "question-1",
                    "occurred_at": 1_700_000_000,
                    "score": 1.0,
                    "confidence": 0.8,
                    "metadata": {},
                },
            )
            overview = service.get_overview(
                "learner-1",
                lecture_id=lecture["id"],
                book_id=book["id"],
                now=1_700_000_000,
            )

            self.assertTrue(result["created"])
            self.assertEqual(1, overview["summary"]["evidence_count"])
            self.assertEqual("developing", overview["states"][0]["status"])
            self.assertEqual("unknown", overview["states"][1]["status"])


if __name__ == "__main__":
    unittest.main()
