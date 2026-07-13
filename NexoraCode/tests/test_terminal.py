import subprocess
import sys
import time
import unittest
from pathlib import Path


NEXORA_CODE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(NEXORA_CODE_ROOT))

from core.tool_registry import ToolRegistry
from tools.terminal import local_terminal


class LocalTerminalTests(unittest.TestCase):
    """验证终端工具的完成、超时保留和显式终止流程。"""

    def test_completed_command_returns_output(self):
        result = local_terminal(
            action="run",
            command=self._python_command("print('completed', flush=True)"),
            cwd=str(NEXORA_CODE_ROOT),
            wait_seconds=2,
        )

        self.assertTrue(result["success"], result)
        self.assertFalse(result["wait_expired"])
        self.assertEqual(result["status"], "exited")
        self.assertEqual(result["returncode"], 0)
        self.assertIn("completed", result["output"])

    def test_wait_window_preserves_process_and_reads_only_new_output(self):
        running = local_terminal(
            action="run",
            command=self._python_command(
                "import time; print('initial', flush=True); time.sleep(2); "
                "print('later', flush=True); time.sleep(30)"
            ),
            cwd=str(NEXORA_CODE_ROOT),
            wait_seconds=1,
        )

        self.assertTrue(running["success"], running)
        self.assertTrue(running["wait_expired"])
        self.assertEqual(running["status"], "running")
        self.assertIn("initial", running["output"])

        try:
            time.sleep(1.5)
            current = local_terminal(
                action="read",
                terminal_id=running["terminal_id"],
            )

            self.assertTrue(current["success"], current)
            self.assertEqual(current["status"], "running")
            self.assertIn("later", current["output"])
            self.assertNotIn("initial", current["output"])
        finally:
            local_terminal(action="terminate", terminal_id=running["terminal_id"])

    def test_terminate_returns_only_unread_output(self):
        running = local_terminal(
            action="run",
            command=self._python_command("import time; print('running', flush=True); time.sleep(30)"),
            cwd=str(NEXORA_CODE_ROOT),
            wait_seconds=1,
        )

        self.assertTrue(running["success"], running)
        self.assertTrue(running["wait_expired"])
        self.assertEqual(running["status"], "running")
        self.assertIn("running", running["output"])

        current = local_terminal(
            action="read",
            terminal_id=running["terminal_id"],
        )

        self.assertTrue(current["success"], current)
        self.assertEqual(current["status"], "running")
        self.assertEqual(current["output"], "")

        terminated = local_terminal(
            action="terminate",
            terminal_id=running["terminal_id"],
        )

        self.assertTrue(terminated["success"], terminated)
        self.assertEqual(terminated["status"], "terminated")
        self.assertIsNotNone(terminated["returncode"])
        self.assertNotIn("running", terminated["output"])

    def test_multibyte_output_is_read_in_order_across_chunks(self):
        result = local_terminal(
            action="run",
            command=self._python_command(
                "import sys; sys.stdout.buffer.write(('中' * 9000).encode('utf-8')); "
                "sys.stdout.buffer.flush()"
            ),
            cwd=str(NEXORA_CODE_ROOT),
            wait_seconds=2,
        )

        self.assertTrue(result["success"], result)
        self.assertEqual(result["status"], "exited")
        self.assertTrue(result["has_more"])
        self.assertEqual(result["output"], "中" * 8000)

        remaining = local_terminal(
            action="read",
            terminal_id=result["terminal_id"],
        )

        self.assertTrue(remaining["success"], remaining)
        self.assertFalse(remaining["has_more"])
        self.assertEqual(remaining["output"], "中" * 1000)

    def test_incomplete_multibyte_character_waits_for_next_read(self):
        running = local_terminal(
            action="run",
            command=self._python_command(
                "import sys, time; sys.stdout.buffer.write(bytes([0xE4, 0xB8])); "
                "sys.stdout.buffer.flush(); time.sleep(2); "
                "sys.stdout.buffer.write(bytes([0xAD])); sys.stdout.buffer.flush(); time.sleep(30)"
            ),
            cwd=str(NEXORA_CODE_ROOT),
            wait_seconds=1,
        )

        self.assertTrue(running["success"], running)
        self.assertEqual(running["output"], "")

        try:
            time.sleep(1.5)
            current = local_terminal(
                action="read",
                terminal_id=running["terminal_id"],
            )

            self.assertTrue(current["success"], current)
            self.assertEqual(current["output"], "中")
        finally:
            local_terminal(action="terminate", terminal_id=running["terminal_id"])

    def test_tool_registry_exposes_terminal_contract(self):
        tools = ToolRegistry().list_tools()
        tool_names = {item["name"] for item in tools}
        manifest = next(item for item in tools if item["name"] == "local_terminal")
        properties = manifest["parameters"]["properties"]

        self.assertIn("local_shell_exec", tool_names)
        self.assertNotIn("local_shell_session", tool_names)
        self.assertEqual(properties["wait_seconds"]["default"], 10)
        self.assertEqual(
            set(properties),
            {"action", "command", "terminal_id", "cwd", "wait_seconds"},
        )
        self.assertEqual(properties["action"]["enum"], ["run", "read", "terminate"])

    @staticmethod
    def _python_command(code: str) -> str:
        return subprocess.list2cmdline([sys.executable, "-u", "-c", code])


if __name__ == "__main__":
    unittest.main()
