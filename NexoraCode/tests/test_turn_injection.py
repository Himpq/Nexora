"""隔离测试：tail 注入块的基线比对与 diff 生成（不加载用户配置、不联网）。"""
import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


class InjectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ti = module("test_turn_injection", ROOT / "model/turn_injection.py")

    def test_first_turn_injects_full_content_and_builds_baseline(self):
        """首轮无基线：全量注入，并返回新基线。"""

        blocks, baseline, diag = self.ti.plan_injection(
            {"project_conventions": "第一行\n第二行", "custom_instructions": ""},
            None,
        )
        self.assertEqual(len(blocks), 1)
        self.assertIn("## Project conventions", blocks[0])
        self.assertIn("第一行", blocks[0])
        self.assertIn("第二行", blocks[0])
        self.assertEqual(baseline["project_conventions"]["lines"], ["第一行", "第二行"])
        # 首轮全量：rows 标记为 added，mode=full，供界面按「新增内容」渲染。
        self.assertEqual(diag, [{
            "name": "project_conventions",
            "chars": len(blocks[0]),
            "mode": "full",
            "rows": [
                {"kind": "added", "text": "第一行"},
                {"kind": "added", "text": "第二行"},
            ],
        }])

    def test_unchanged_content_injects_nothing(self):
        """内容未变：不注入任何块（稳定轮次 tail 为空，前缀可缓存）。"""

        sources = {"project_conventions": "第一行\n第二行", "custom_instructions": "简短回答"}
        _, baseline, _ = self.ti.plan_injection(sources, None)
        blocks, new_baseline, diag = self.ti.plan_injection(sources, baseline)
        self.assertEqual(blocks, [])
        self.assertEqual(diag, [])
        # 基线保持等价，调用方据此跳过落盘。
        self.assertEqual(new_baseline, baseline)

    def test_changed_content_injects_diff_only(self):
        """内容变化：只注入 diff 行，不重复全量内容；诊断带结构化变更行。"""

        _, baseline, _ = self.ti.plan_injection({"custom_instructions": "旧要求\n保留行"}, None)
        blocks, new_baseline, diag = self.ti.plan_injection(
            {"custom_instructions": "新要求\n保留行"}, baseline
        )
        self.assertEqual(len(blocks), 1)
        self.assertIn("## Custom instructions", blocks[0])
        self.assertIn("- 旧要求", blocks[0])
        self.assertIn("+ 新要求", blocks[0])
        # 未变化的行不应出现在 diff 里。
        self.assertNotIn("保留行", blocks[0])
        self.assertEqual(new_baseline["custom_instructions"]["lines"], ["新要求", "保留行"])
        # 诊断的 rows 与块正文同源：界面渲染的 diff 就是真正注入的内容。
        self.assertEqual(diag[0]["mode"], "diff")
        self.assertEqual(diag[0]["rows"], [
            {"kind": "removed", "text": "旧要求"},
            {"kind": "added", "text": "新要求"},
        ])

    def test_empty_source_does_not_inject_or_create_baseline(self):
        """通道始终为空：不注入，也不写基线。"""

        blocks, baseline, diag = self.ti.plan_injection(
            {"project_conventions": "", "custom_instructions": "   "}, None
        )
        self.assertEqual(blocks, [])
        self.assertEqual(baseline, {})
        self.assertEqual(diag, [])

    def test_content_added_after_empty_injects_full(self):
        """先空后有：没有旧基线，按首轮全量注入。"""

        blocks, _, _ = self.ti.plan_injection({"custom_instructions": "新内容"}, {})
        self.assertEqual(len(blocks), 1)
        self.assertIn("新内容", blocks[0])

    def test_content_cleared_injects_removal_diff(self):
        """有变空：注入删除 diff，并清掉该通道基线。"""

        _, baseline, _ = self.ti.plan_injection({"custom_instructions": "要删掉"}, None)
        blocks, new_baseline, _ = self.ti.plan_injection({"custom_instructions": ""}, baseline)
        self.assertEqual(len(blocks), 1)
        self.assertIn("- 要删掉", blocks[0])
        self.assertNotIn("custom_instructions", new_baseline)

    def test_line_normalization_ignores_trailing_whitespace_and_blank_lines(self):
        """行尾空白与首尾空行不算变化，避免无谓 diff。"""

        _, baseline, _ = self.ti.plan_injection({"custom_instructions": "内容  \n"}, None)
        blocks, _, _ = self.ti.plan_injection({"custom_instructions": "\n内容"}, baseline)
        self.assertEqual(blocks, [])

    def test_both_channels_inject_independently(self):
        """两个通道各自独立比对：只有一个变了就只注入那一个。"""

        sources = {"project_conventions": "约定A", "custom_instructions": "要求A"}
        _, baseline, _ = self.ti.plan_injection(sources, None)
        blocks, _, diag = self.ti.plan_injection(
            {"project_conventions": "约定A", "custom_instructions": "要求B"}, baseline
        )
        self.assertEqual(len(blocks), 1)
        self.assertIn("## Custom instructions", blocks[0])
        self.assertNotIn("## Project conventions", blocks[0])
        self.assertEqual([item["name"] for item in diag], ["custom_instructions"])

    def test_large_diff_is_capped(self):
        """超大改写只展示前若干行并提示剩余条数，避免挤占窗口。"""

        old = "\n".join(f"旧行{i}" for i in range(100))
        new = "\n".join(f"新行{i}" for i in range(100))
        _, baseline, _ = self.ti.plan_injection({"custom_instructions": old}, None)
        blocks, _, _ = self.ti.plan_injection({"custom_instructions": new}, baseline)
        self.assertEqual(len(blocks), 1)
        self.assertIn("未展示", blocks[0])

    def test_diagnostics_rows_carry_changed_lines_without_lead(self):
        """诊断的 rows 只含变更行，标记与引导语不进入 rows。"""

        _, baseline, _ = self.ti.plan_injection({"custom_instructions": "旧约定"}, None)
        _, _, diag = self.ti.plan_injection({"custom_instructions": "新约定"}, baseline)
        self.assertEqual(diag, [{
            "name": "custom_instructions",
            "chars": diag[0]["chars"],
            "mode": "diff",
            "rows": [
                {"kind": "removed", "text": "旧约定"},
                {"kind": "added", "text": "新约定"},
            ],
        }])
        self.assertNotIn("引导语", str(diag))
        self.assertNotIn("## Custom instructions", str(diag))

    def test_full_mode_diagnostics_mark_every_line_added(self):
        """首轮全量：mode=full，rows 全部是 added，界面按新增内容渲染。"""

        _, _, diag = self.ti.plan_injection({"custom_instructions": "第一行\n第二行"}, None)
        self.assertEqual(diag[0]["mode"], "full")
        self.assertEqual(diag[0]["rows"], [
            {"kind": "added", "text": "第一行"},
            {"kind": "added", "text": "第二行"},
        ])

    def test_merged_response_keeps_latest_injection_snapshot_once(self):
        """同一次响应的多轮历史只保留一张注入卡，并显示最新快照。"""

        earlier = {
            "type": "context_injection",
            "blocks": [{"name": "project_conventions", "mode": "diff"}],
        }
        latest = {
            "type": "context_injection",
            "blocks": [{"name": "project_conventions", "mode": "full"}],
        }
        steps = [
            earlier,
            {"type": "function_call", "name": "read_file"},
            latest,
            {"type": "function_result", "name": "read_file"},
        ]

        collapsed = self.ti.collapse_context_injection_steps(steps)

        self.assertEqual([step["type"] for step in collapsed], [
            "context_injection",
            "function_call",
            "function_result",
        ])
        self.assertIs(collapsed[0], latest)


if __name__ == "__main__":
    unittest.main()
