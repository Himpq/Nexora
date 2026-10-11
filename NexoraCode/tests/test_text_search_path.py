"""local_text_search 的 path 语义测试：目录递归 + 单文件。

SearchTool 使用包内相对导入（..PathGuard / ..Tool），因此这里构造一个
指向 NexoraCode/local 的假包层级，而不是直接按文件路径加载模块。
"""

import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class TextSearchPathTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

        core = types.ModuleType("core.config")
        core.config = {}
        core.get_app_root = lambda: self.root
        sys.modules["core.config"] = core

        # 假包层级：test_local -> local/，test_local.tools -> local/tools/
        # 这样 SearchTool 里的 `from ..PathGuard import ...` 才能解析。
        pkg = types.ModuleType("test_local")
        pkg.__path__ = [str(ROOT / "local")]
        sys.modules["test_local"] = pkg
        tools_pkg = types.ModuleType("test_local.tools")
        tools_pkg.__path__ = [str(ROOT / "local" / "tools")]
        sys.modules["test_local.tools"] = tools_pkg

        _load("test_local.PathGuard", ROOT / "local" / "PathGuard.py")
        self.tool_base = _load("test_local.Tool", ROOT / "local" / "Tool.py")
        self.search = _load("test_local.tools.SearchTool", ROOT / "local" / "tools" / "SearchTool.py")

        (self.root / "alpha.py").write_text("def target_symbol():\n    return 1\n", encoding="utf-8")
        (self.root / "notes.toml").write_text("[tool]\ntarget_symbol = true\n", encoding="utf-8")
        (self.root / "sub").mkdir()
        (self.root / "sub" / "beta.py").write_text("# target_symbol here\n", encoding="utf-8")
        (self.root / ".hidden.py").write_text("target_symbol hidden\n", encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def _context(self):
        return self.tool_base.ToolContext(
            conversation_id="c1",
            project_root=str(self.root),
            permission_mode="full",
        )

    def _run(self, **args):
        return self.search.TextSearchTool().run(args, self._context())

    def test_directory_search_still_recurses(self):
        result = self._run(path=str(self.root), query="target_symbol")

        self.assertTrue(result["success"], result)
        self.assertEqual(result["scope"], "directory")
        names = {Path(m["path"]).name for m in result["matches"]}
        self.assertEqual(names, {"alpha.py", "beta.py"})

    def test_single_file_path_is_accepted(self):
        result = self._run(path=str(self.root / "alpha.py"), query="target_symbol")

        self.assertTrue(result["success"], result)
        self.assertEqual(result["scope"], "file")
        self.assertEqual(result["scanned_files"], 1)
        self.assertEqual(len(result["matches"]), 1)
        self.assertEqual(result["matches"][0]["line_number"], 1)

    def test_single_file_ignores_extension_whitelist(self):
        """显式指定文件时不应因后缀不在白名单而被静默跳过。"""
        result = self._run(path=str(self.root / "notes.toml"), query="target_symbol")

        self.assertTrue(result["success"], result)
        self.assertEqual(result["scanned_files"], 1)
        self.assertEqual(len(result["matches"]), 1)

    def test_single_file_ignores_include_globs(self):
        result = self._run(path=str(self.root / "alpha.py"), query="target_symbol", include_globs=["*.ts"])

        self.assertTrue(result["success"], result)
        self.assertEqual(len(result["matches"]), 1)

    def test_single_file_ignores_hidden_filter(self):
        result = self._run(path=str(self.root / ".hidden.py"), query="target_symbol")

        self.assertTrue(result["success"], result)
        self.assertEqual(len(result["matches"]), 1)

    def test_single_file_regex_mode(self):
        result = self._run(path=str(self.root / "alpha.py"), query=r"def \w+", mode="regex")

        self.assertTrue(result["success"], result)
        self.assertEqual(len(result["matches"]), 1)

    def test_missing_path_reports_not_found(self):
        result = self._run(path=str(self.root / "nope.py"), query="x")

        self.assertFalse(result["success"])
        self.assertIn("Path not found", result["error"])

    def test_missing_path_hint_is_inside_error(self):
        """提示必须拼进 error：AgentLoop 失败时只取 error 字段。"""
        result = self._run(path=str(self.root / "nope.py"), query="x")

        self.assertIn("local_file_list", result["error"])
        self.assertIn("local_file_search_tree", result["error"])

    def test_missing_path_suggests_close_sibling(self):
        result = self._run(path=str(self.root / "alpah.py"), query="x")

        self.assertFalse(result["success"])
        self.assertIn("alpha.py", result["error"])
        self.assertEqual(result["suggestions"], ["alpha.py"])

    def test_missing_parent_dir_has_no_suggestions(self):
        result = self._run(path=str(self.root / "nodir" / "x.py"), query="x")

        self.assertFalse(result["success"])
        self.assertNotIn("suggestions", result)
        self.assertIn("local_file_list", result["error"])


if __name__ == "__main__":
    unittest.main()
