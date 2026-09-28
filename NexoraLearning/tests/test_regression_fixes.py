from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from core.booksproc.chapter_quiz import _generate_profile_question_bank_questions
from core.booksproc.runtime import resolve_book_text
from core.lectures import create_book, create_lecture, save_book_text
from core.vector import vectorize_book


class _FakeQuestionRunner:
    def __init__(self, scripts=None):
        self.prompt_vars = {}
        self.requests = []
        # scripts: 每次 run 返回的 (choice_count, text_count)；默认每次都返回合格的 4+2。
        self.scripts = list(scripts or [])

    def run(self, _request, **kwargs):
        self.prompt_vars = dict(kwargs.get("extra_prompt_vars") or {})
        self.requests.append(str(_request))
        choice_count, text_count = self.scripts.pop(0) if self.scripts else (4, 2)
        blocks = []
        for index in range(choice_count + text_count):
            question_type = "choice" if index < choice_count else "text"
            options = "A. 甲\nB. 乙\nC. 丙\nD. 丁" if index < choice_count else ""
            blocks.append(
                "<QUESTION>"
                f"<question_title>题目{index}</question_title>"
                f"<question_type>{question_type}</question_type>"
                f"<question_options>{options}</question_options>"
                "<question_content>内容</question_content>"
                "<question_answer>答案</question_answer>"
                "</QUESTION>"
            )
        return "".join(blocks)


class CoordinateRegressionTests(unittest.TestCase):
    def _seed(self, directory: str):
        cfg = {"data_dir": str(Path(directory) / "data")}
        lecture = create_lecture(cfg, "坐标课程")
        book = create_book(cfg, lecture["id"], "坐标教材")
        save_book_text(cfg, lecture["id"], book["id"], "<p>AAA</p><p>BBB</p>")
        return cfg, lecture, book

    def test_runtime_resolves_cached_text_in_plain_coordinates(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg, lecture, book = self._seed(directory)
            text = resolve_book_text(cfg, lecture["id"], book["id"], book)
        self.assertEqual(text, "AAA\n\nBBB")

    def test_quiz_fallback_slices_plain_coordinates(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg, lecture, book = self._seed(directory)
            runner = _FakeQuestionRunner()
            with (
                patch("core.booksproc.chapter_quiz.build_profile_question_runner", return_value=runner),
                patch("core.booksproc.chapter_quiz.load_chapter_concept_candidates", return_value=[]),
                patch("core.booksproc.chapter_quiz.validate_question_distribution", return_value=""),
                patch("core.booksproc.chapter_quiz.validate_question_concept_bindings", return_value=""),
            ):
                _generate_profile_question_bank_questions(
                    cfg,
                    user_id="demo",
                    lecture_id=lecture["id"],
                    book_id=book["id"],
                    chapter_name="第二段",
                    chapter_range="5:3",
                    chapter_context="",
                    chapter_detail_xml="<details />",
                    limit=6,
                )
        self.assertEqual(runner.prompt_vars["chapter_context"], "BBB")

    def test_quiz_generation_retries_once_on_validation_failure(self):
        """2026-09-21 审查：结构校验失败先把错误喂回模型重试一轮，而不是直接判死。"""
        with tempfile.TemporaryDirectory() as directory:
            cfg, lecture, book = self._seed(directory)
            runner = _FakeQuestionRunner(scripts=[(3, 0), (4, 2)])
            with (
                patch("core.booksproc.chapter_quiz.build_profile_question_runner", return_value=runner),
                patch("core.booksproc.chapter_quiz.load_chapter_concept_candidates", return_value=[]),
            ):
                rows = _generate_profile_question_bank_questions(
                    cfg, user_id="demo", lecture_id=lecture["id"], book_id=book["id"],
                    chapter_name="第二段", chapter_range="5:3", chapter_context="", chapter_detail_xml="<details />", limit=6,
                )
        self.assertEqual(len(runner.requests), 2)
        self.assertIn("上一次输出未通过校验", runner.requests[1])
        self.assertEqual(len(rows), 6)

    def test_quiz_generation_relaxes_when_pool_is_enough_and_fails_readably_otherwise(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg, lecture, book = self._seed(directory)
            # 两轮都只有 3 道选择题：够拼一组 3 题 → 降级接受。
            runner = _FakeQuestionRunner(scripts=[(3, 0), (3, 0)])
            with (
                patch("core.booksproc.chapter_quiz.build_profile_question_runner", return_value=runner),
                patch("core.booksproc.chapter_quiz.load_chapter_concept_candidates", return_value=[]),
            ):
                rows = _generate_profile_question_bank_questions(
                    cfg, user_id="demo", lecture_id=lecture["id"], book_id=book["id"],
                    chapter_name="第二段", chapter_range="5:3", chapter_context="", chapter_detail_xml="<details />", limit=3,
                )
            self.assertEqual(len(rows), 3)
            # 两轮都只有 1 道题：拼不出一组 → 抛可读的中文原因。
            runner = _FakeQuestionRunner(scripts=[(1, 0), (1, 0)])
            with (
                patch("core.booksproc.chapter_quiz.build_profile_question_runner", return_value=runner),
                patch("core.booksproc.chapter_quiz.load_chapter_concept_candidates", return_value=[]),
            ):
                with self.assertRaises(ValueError) as caught:
                    _generate_profile_question_bank_questions(
                        cfg, user_id="demo", lecture_id=lecture["id"], book_id=book["id"],
                        chapter_name="第二段", chapter_range="5:3", chapter_context="", chapter_detail_xml="<details />", limit=3,
                    )
            self.assertIn("出了两遍都不合格", str(caught.exception))


class VectorReplacementTests(unittest.TestCase):
    def test_revectorization_deletes_old_material_before_upsert(self):
        events = []
        cfg = {"vectorization": {"chunk_size": 50, "chunk_overlap": 0}}
        lecture = {"id": "lecture-1", "title": "课程"}
        book = {"id": "book-1", "title": "教材", "vector_status": "done", "vector_count": 3}
        index = SimpleNamespace(plain="新的正文内容 " * 20)

        def fake_delete(*args, **kwargs):
            events.append(("delete", args, kwargs))

        def fake_upsert(*args, **kwargs):
            events.append(("upsert", args, kwargs))
            return len(kwargs["chunks"])

        with (
            patch("core.vector.get_lecture", return_value=lecture),
            patch("core.vector.get_book", return_value=book),
            patch("core.bookindex.get_book_index", return_value=index),
            patch("core.vector.require_nexoradb_available", return_value={"available": True}),
            patch("core.vector.update_book", return_value=book),
            patch("core.vector.save_book_chunks", return_value=1),
            patch("core.vector.delete_material_chunks", side_effect=fake_delete),
            patch("core.vector.upsert_chunks_to_library", side_effect=fake_upsert),
            patch("core.vector.list_books", return_value=[book]),
            patch("core.vector.update_lecture"),
        ):
            vectorize_book(cfg, lecture["id"], book["id"], force=True)

        self.assertEqual([event[0] for event in events], ["delete", "upsert"])
        self.assertEqual(events[0][2]["library"], "lecture_lecture-1")


class RuntimeAuthorizationTests(unittest.TestCase):
    def test_requested_lecture_only_narrows_selected_courses(self):
        from api.routes import _runtime_select_lecture_rows

        lectures = [
            {"id": "selected", "title": "已选课程"},
            {"id": "hidden", "title": "未选课程"},
        ]
        with (
            patch("api.routes.user_store.list_selected_lecture_ids", return_value=["selected"]),
            patch("api.routes.list_learning_lectures", return_value=lectures),
            patch("api.routes.list_lecture_books", return_value=[]),
        ):
            selected, _ = _runtime_select_lecture_rows("demo", {"lecture_id": "selected"})
            hidden, _ = _runtime_select_lecture_rows("demo", {"lecture_id": "hidden"})

        self.assertEqual([row["id"] for row in selected], ["selected"])
        self.assertEqual(hidden, [])

    def test_runtime_tools_cannot_read_unselected_lecture(self):
        from api.routes import _runtime_execute_tool

        fake_executor = SimpleNamespace(
            execute=lambda name, arguments: {
                "success": True,
                "lectures": [
                    {"id": "selected", "title": "已选课程"},
                    {"id": "hidden", "title": "未选课程"},
                ],
                "total": 2,
            }
        )
        with (
            patch("api.routes.user_store.list_selected_lecture_ids", return_value=["selected"]),
            patch("api.routes._runtime_executor", return_value=fake_executor),
        ):
            listed = _runtime_execute_tool("demo", "listLectures", {})
            with self.assertRaises(PermissionError):
                _runtime_execute_tool(
                    "demo",
                    "getBookText",
                    {"lecture_id": "hidden", "book_id": "hidden-book"},
                )

        self.assertEqual([row["id"] for row in listed["lectures"]], ["selected"])
        self.assertEqual(listed["total"], 1)


if __name__ == "__main__":
    unittest.main()
