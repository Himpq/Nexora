from __future__ import annotations

import unittest

from tools.seed_demo import COURSE_A_CHAPTERS, COURSE_B_CHAPTERS, _build_course, _chapter_body


class SeedDemoRangeTests(unittest.TestCase):
    def test_chapter_ranges_are_contiguous_and_unique(self):
        text, xml, ranges = _build_course(COURSE_A_CHAPTERS)
        self.assertEqual(len(ranges), len(COURSE_A_CHAPTERS))
        offset = 0
        seen = set()
        for start, length, name in ranges:
            self.assertEqual(start, offset)
            self.assertGreater(length, 40)
            self.assertEqual(text[start:start + length], _chapter_body(name))
            self.assertNotIn(name, seen)
            seen.add(name)
            offset += length
        self.assertEqual(offset, len(text))
        self.assertIn("<chapter_range>0:", xml)
        other = _build_course(COURSE_B_CHAPTERS)
        self.assertEqual(other[2][0][0], 0)
        self.assertEqual(other[2][1][0], len(_chapter_body(COURSE_B_CHAPTERS[0])))


if __name__ == "__main__":
    unittest.main()
