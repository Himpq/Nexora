"""Isolated telemetry regression tests: temporary storage, fake config, no network."""

import importlib.util
from contextlib import closing
import sqlite3
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[1]


def load_source(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)

    return module


class FakeConfig(dict):
    def set(self, key, value):
        self[key] = value


class TelemetryServiceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="telemetry-test-", dir=ROOT / "tests")
        self.addCleanup(self.temporary.cleanup)
        self.app_root = Path(self.temporary.name)
        self.config = FakeConfig(local_telemetry_enabled=True, local_telemetry_notice_seen=True)
        config_module = types.ModuleType("core.config")
        config_module.config = self.config
        config_module.get_app_root = lambda: self.app_root
        modules = patch.dict(sys.modules, {
            "core": types.ModuleType("core"),
            "core.config": config_module,
        })
        modules.start()
        self.addCleanup(modules.stop)
        self.telemetry = load_source("_isolated_telemetry_service", ROOT / "model/TelemetryService.py")
        self.service = self.telemetry.TelemetryService()
        self.service._enqueue = Mock()
        self.telemetry.urlopen = Mock(side_effect=AssertionError("Network is forbidden in tests"))

    def conversation(self, project_name):
        return {"metadata": {"nexoracode_project": {"path": str(self.app_root / project_name)}}}

    def metrics(self):
        with closing(sqlite3.connect(self.app_root / "data/nexoracode_telemetry.sqlite3")) as connection:
            return dict(
                (row[0], row[1:])
                for row in connection.execute(
                    "SELECT project_hash, active_seconds, provider_errors, tool_errors FROM local_project_metrics"
                )
            )

    def test_running_project_errors_survive_switching_visible_conversation(self):
        """A keeps executing while the user opens B; only activity belongs to B."""
        project_a = str(self.app_root / "project-a")
        project_b = str(self.app_root / "project-b")
        self.service.set_active_project(self.conversation("project-a"))
        self.service.set_active_project(self.conversation("project-b"))
        self.service.record_error("provider", "TimeoutError", project_path=project_a)
        self.service.record_error("tool", "ToolReportedFailure", project_path=project_a)
        self.service.record_active_seconds(15)

        self.assertEqual(self.metrics(), {
            self.service._hash_project_path(project_a): (0, 1, 1),
            self.service._hash_project_path(project_b): (15, 0, 0),
        })
        self.assertEqual(self.service._enqueue.call_args_list[0].args[0], {
            "event_type": "error", "error_category": "provider", "error_type": "TimeoutError",
        })
        self.telemetry.urlopen.assert_not_called()

    def test_error_without_execution_project_never_uses_visible_project(self):
        self.service.set_active_project(self.conversation("visible-project"))
        self.service.record_error("provider", "private error text", project_path="")

        self.assertFalse((self.app_root / "data").exists())
        self.service._enqueue.assert_called_once_with({
            "event_type": "error", "error_category": "provider", "error_type": "OtherError",
        })

    def test_collection_requires_notice_and_enabled_setting(self):
        for enabled, notice_seen in [(False, True), (True, False)]:
            with self.subTest(enabled=enabled, notice_seen=notice_seen):
                self.config.update(local_telemetry_enabled=enabled, local_telemetry_notice_seen=notice_seen)
                self.service.set_active_project(self.conversation("project"))
                self.service.record_active_seconds(30)
                self.service.record_error("tool", "ValueError", project_path=str(self.app_root / "project"))

        self.service._enqueue.assert_not_called()
        self.assertFalse((self.app_root / "data").exists())

    def test_disabling_discards_queued_events(self):
        self.service._queue.put((0, {"event_type": "activity", "active_seconds": 15}))
        self.service.set_enabled(False)

        self.assertTrue(self.service._queue.empty())
        self.assertEqual(self.service._queue.unfinished_tasks, 0)
        self.assertFalse(self.service.status()["enabled"])

    def test_tool_failures_use_tool_context_project(self):
        """Both returned tool failures and raised errors retain their execution context."""
        local_package = types.ModuleType("_isolated_telemetry_local")
        local_package.__path__ = []
        telemetry_module = types.ModuleType("model.TelemetryService")
        telemetry_module.get_telemetry_service = lambda: self.service

        with patch.dict(sys.modules, {
            "_isolated_telemetry_local": local_package,
            "model": types.ModuleType("model"),
            "model.TelemetryService": telemetry_module,
        }):
            tool_module = load_source("_isolated_telemetry_local.Tool", ROOT / "local/Tool.py")
            load_source("_isolated_telemetry_local.Schema", ROOT / "local/Schema.py")
            executor_module = load_source("_isolated_telemetry_local.ToolExecutor", ROOT / "local/ToolExecutor.py")

            class FailingTool(tool_module.LocalTool):
                name = "test_failure"

                def run(self, args, context):
                    if context.task_id == "raise":
                        raise ValueError("synthetic failure")

                    return {"success": False, "error": "synthetic failure"}

            executor = executor_module.ToolExecutor(max_workers=1)
            self.addCleanup(executor._pool.shutdown, wait=True)
            executor.register(FailingTool())
            project_path = str(self.app_root / "execution-project")
            self.service.set_active_project(self.conversation("visible-project"))

            for task_id in ["returned", "raise"]:
                result = executor.execute("test_failure", {}, context={
                    "task_id": task_id,
                    "conversation_id": "execution-conversation",
                    "project_root": project_path,
                })
                self.assertFalse(result["success"])

        self.assertEqual(self.metrics(), {self.service._hash_project_path(project_path): (0, 0, 2)})


if __name__ == "__main__":
    unittest.main()
