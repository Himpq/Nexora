"""
index_codec 收敛 + falsy-zero 静态守卫

覆盖：
1. parse_message_index / parse_effective_from / snapshot_effective_from 单元语义（0 合法）。
2. longterm current_index=0 真 bug 回归：conversation_longterm_root_state 二次包装
   不再把 0 吞成 -1（修复前此用例必红）。
3. 静态守卫：全仓 api/ 非测试代码禁止 `int(... or -1)` 模式回潮。
"""

import io
import os
import re
import sys
import tokenize
import unittest

# test file: ChatDBServer/api/basis/Conversation/tests/test_index_codec.py
SERVER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
API_DIR = os.path.join(SERVER_DIR, "api")
if API_DIR not in sys.path:
    sys.path.insert(0, API_DIR)
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)
try:
    os.chdir(SERVER_DIR)
except Exception:
    pass

from basis.index_codec import (
    parse_effective_from,
    parse_message_index,
    snapshot_effective_from,
)
from longterm.longterm_api import conversation_longterm_root_state


class TestParseMessageIndex(unittest.TestCase):
    """0 是合法值，缺失/非法回 default。"""

    def test_zero_is_preserved(self):
        self.assertEqual(parse_message_index(0), 0)
        self.assertEqual(parse_message_index("0"), 0)

    def test_positive_preserved(self):
        self.assertEqual(parse_message_index(5), 5)
        self.assertEqual(parse_message_index("12"), 12)

    def test_missing_none_returns_default(self):
        self.assertEqual(parse_message_index(None), -1)
        self.assertEqual(parse_message_index(""), -1)

    def test_invalid_returns_default(self):
        self.assertEqual(parse_message_index("abc"), -1)
        self.assertEqual(parse_message_index([]), -1)
        self.assertEqual(parse_message_index("abc", default=0), 0)


class TestParseEffectiveFrom(unittest.TestCase):
    def test_zero_ok(self):
        self.assertEqual(parse_effective_from(0), 0)

    def test_negative_and_invalid_are_none(self):
        self.assertIsNone(parse_effective_from(-1))
        self.assertIsNone(parse_effective_from(None))
        self.assertIsNone(parse_effective_from("x"))

    def test_snapshot_helper(self):
        self.assertEqual(snapshot_effective_from({"effective_from_message": 0}), 0)
        self.assertEqual(snapshot_effective_from({"effective_from_message": 3}), 3)
        self.assertIsNone(snapshot_effective_from({}))
        self.assertIsNone(snapshot_effective_from(None))
        self.assertIsNone(snapshot_effective_from({"effective_from_message": "bad"}))


class TestLongtermCurrentIndexRegression(unittest.TestCase):
    """修复前 current_index=0 被 `or -1` 吞成 -1 → 本用例必红。"""

    def _build_payload(self, current_index):
        return {
            "task": "整理报告",
            "plan": ["收集素材", "写初稿", "校对"],
            "current_index": current_index,
            "done_indices": [],
        }

    def test_current_index_zero_survives_root_state(self):
        state = conversation_longterm_root_state(self._build_payload(0))
        self.assertEqual(state["current_index"], 0)

    def test_current_index_positive_survives(self):
        state = conversation_longterm_root_state(self._build_payload(2))
        self.assertEqual(state["current_index"], 2)

    def test_missing_current_index_stays_minus_one(self):
        state = conversation_longterm_root_state({"task": "t", "plan": ["a", "b"]})
        self.assertEqual(state["current_index"], -1)


_FALSY_ZERO_PATTERN = re.compile(r"\bint\([^)]*\bor\s*-1\s*\)")

_SKIP_DIR_PARTS = ("tests", "__pycache__", ".git", "node_modules", "venv", ".venv")


def _iter_source_py_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIR_PARTS]
        for name in filenames:
            if name.endswith(".py"):
                yield os.path.join(dirpath, name)


def _strip_strings_and_comments(source):
    """用 tokenize 把字符串/注释替换为等长空格，保留代码行列，避免文档误报。"""
    out = []
    try:
        for tok in tokenize.generate_tokens(io.StringIO(source).readline):
            if tok.type in (tokenize.STRING, tokenize.COMMENT):
                out.append(" " * len(tok.string))
            else:
                out.append(tok.string)
    except (tokenize.TokenError, IndentationError):
        return source
    return "".join(out)


class TestNoFalsyZeroGuard(unittest.TestCase):
    """静态守卫：全仓非测试 Python 代码禁止 int(... or -1)。"""

    def test_no_or_minus_one_index_parse(self):
        violations = []
        for path in _iter_source_py_files(API_DIR):
            with open(path, encoding="utf-8") as fh:
                source = fh.read()
            clean = _strip_strings_and_comments(source)
            for lineno, line in enumerate(clean.splitlines(), start=1):
                if _FALSY_ZERO_PATTERN.search(line):
                    rel = os.path.relpath(path, API_DIR)
                    violations.append(f"{rel}:{lineno}: {line.strip()}")
        self.assertEqual(
            violations,
            [],
            "检测到 int(... or -1) falsy-zero 兜底（0 会被吞成 -1）。"
            "请改用 basis.index_codec.parse_message_index：\n" + "\n".join(violations),
        )


if __name__ == "__main__":
    unittest.main()
