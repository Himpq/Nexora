from __future__ import annotations

import unittest

from core.booksproc.question import validate_question_distribution
from core.memory.profile_question import _parse_question_blocks


def build_question(question_type: str, index: int):
    options = ["选项一", "选项二", "选项三", "选项四"] if question_type == "choice" else []

    return {
        "question_title": f"题目 {index}",
        "question_difficulty": "基础",
        "question_type": question_type,
        "question_options": options,
        "question_content": f"题干 {index}",
        "question_answer": "参考答案",
    }


class QuestionStructureTestCase(unittest.TestCase):
    def test_profile_parser_preserves_choice_type_and_options(self) -> None:
        content = """
<QUESTION>
<question_title>哪个说法正确</question_title>
<question_difficulty>基础</question_difficulty>
<question_type>choice</question_type>
<question_options>A. 第一个选项
B. 第二个选项
C. 第三个选项
D. 第四个选项</question_options>
<question_content>请选择正确答案。</question_content>
<question_reason>检验概念辨析。</question_reason>
<question_answer>选 A，因为它符合定义。</question_answer>
<related_chapter>第一章</related_chapter>
<related_concept_id>cx_test_concept</related_concept_id>
</QUESTION>
"""

        rows = _parse_question_blocks(content)

        self.assertEqual(1, len(rows))
        self.assertEqual("choice", rows[0]["question_type"])
        self.assertEqual(
            ["第一个选项", "第二个选项", "第三个选项", "第四个选项"],
            rows[0]["question_options"],
        )
        self.assertEqual("cx_test_concept", rows[0]["related_concept_id"])

    def test_profile_distribution_accepts_four_choices_and_two_text_questions(self) -> None:
        questions = [
            build_question("choice", 1),
            build_question("choice", 2),
            build_question("choice", 3),
            build_question("choice", 4),
            build_question("text", 5),
            build_question("text", 6),
        ]

        error = validate_question_distribution(
            questions,
            expected_count=6,
            minimum_choice_count=4,
            maximum_text_count=2,
        )

        self.assertEqual("", error)

    def test_distribution_rejects_missing_choice_quota(self) -> None:
        questions = [build_question("choice", 1)] + [build_question("text", index) for index in range(2, 7)]

        error = validate_question_distribution(
            questions,
            expected_count=6,
            minimum_choice_count=4,
            maximum_text_count=2,
        )

        self.assertIn("选择题至少需要 4 道", error)

    def test_distribution_rejects_choice_without_four_options(self) -> None:
        questions = [build_question("choice", index) for index in range(1, 7)]
        questions[2]["question_options"] = ["选项一", "选项二", "选项三"]

        error = validate_question_distribution(
            questions,
            expected_count=6,
            minimum_choice_count=4,
            maximum_text_count=2,
        )

        self.assertIn("第 3 题", error)
        self.assertIn("选项数量不是 4", error)


if __name__ == "__main__":
    unittest.main()
