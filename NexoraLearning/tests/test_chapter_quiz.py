from __future__ import annotations

import unittest

from core.booksproc.chapter_quiz import _normalize_options, grade_question


class ChapterQuizGradeTests(unittest.TestCase):
    def test_placeholder_options_are_dropped(self):
        self.assertEqual(_normalize_options(["A.无", "B.暂无", "none"]), [])
        self.assertEqual(_normalize_options(["A.梯度下降", "B.随机猜测"]), ["梯度下降", "随机猜测"])

    def test_choice_letter_and_text(self):
        question = {
            "type": "choice",
            "options": ["梯度下降", "随机猜测"],
            "answer": "A",
        }
        self.assertTrue(grade_question(question, "A"))
        self.assertTrue(grade_question(question, "梯度下降"))
        self.assertFalse(grade_question(question, "随机猜测"))

    def test_short_answer_contains_expected(self):
        question = {"type": "text", "options": ["无"], "answer": "概念-逻辑-物理"}
        self.assertTrue(grade_question(question, "概念-逻辑-物理三层"))
        self.assertFalse(grade_question(question, "无"))
        self.assertFalse(grade_question(question, ""))


if __name__ == "__main__":
    unittest.main()
