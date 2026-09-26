"""Scheduled task ownership, calendar and one-claim-per-run behavior."""

import os
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

from flask import Flask


SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_DIR = os.path.join(SERVER_DIR, "api")

if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

if API_DIR not in sys.path:
    sys.path.insert(0, API_DIR)

from App.ScheduledTasks import store
from App.ScheduledTasks.routes import scheduled_tasks_bp
from App.ScheduledTasks import worker


class ScheduledTaskStoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path_patch = patch.object(store, "DATABASE_PATH", os.path.join(self.directory.name, "tasks.sqlite3"))
        self.path_patch.start()

    def tearDown(self):
        self.path_patch.stop()
        self.directory.cleanup()

    def test_weekly_schedule_and_ownership(self):
        task = store.create_task("alice", "论文周报", "整理新论文", [0, 2], 9, 0)
        self.assertEqual(task["weekdays"], [0, 2])
        self.assertEqual(len(store.list_tasks("alice")), 1)
        self.assertEqual(store.list_tasks("bob"), [])

        with self.assertRaises(LookupError):
            store.update_task("bob", task["task_id"], {"enabled": False})

        updated = store.update_task("alice", task["task_id"], {"enabled": False})
        self.assertFalse(updated["enabled"])

        with self.assertRaises(LookupError):
            store.delete_task("bob", task["task_id"])

    def test_due_slot_is_claimed_once(self):
        task = store.create_task("alice", "论文周报", "整理新论文", [0], 9, 0)

        with store._connection() as connection:
            connection.execute(
                "UPDATE scheduled_tasks SET next_run_at = ? WHERE task_id = ?",
                (int(store.time.time()), task["task_id"]),
            )

        first = store.claim_due_task()
        second = store.claim_due_task()
        self.assertIsNotNone(first)
        self.assertIsNone(second)
        self.assertEqual(len(store.list_runs("alice", task["task_id"])), 1)
        store.finish_run(first, "success", knowledge_title="报告")
        self.assertEqual(store.list_tasks("alice")[0]["last_knowledge_title"], "报告")

    def test_api_uses_session_owner(self):
        app = Flask(__name__)
        app.secret_key = "test-only"

        with patch.dict(os.environ, {"NEXORA_DISABLE_SCHEDULED_TASK_WORKER": "1"}):
            app.register_blueprint(scheduled_tasks_bp)
            client = app.test_client()

            with client.session_transaction() as session:
                session["username"] = "alice"

            response = client.post("/api/scheduled-tasks", json={
                "title": "论文周报",
                "prompt": "整理新论文",
                "weekdays": [0],
                "hour": 9,
                "minute": 0,
            })
            self.assertEqual(response.status_code, 201)
            task_id = response.json["task"]["task_id"]

            with client.session_transaction() as session:
                session["username"] = "bob"

            self.assertEqual(client.get("/api/scheduled-tasks").json["tasks"], [])
            self.assertEqual(client.get(f"/api/scheduled-tasks/{task_id}/runs").status_code, 404)

    def test_worker_uses_transient_model_with_tools(self):
        captured = {}

        class FakeModel:
            def __init__(self, username, **options):
                captured["username"] = username
                captured["options"] = options

            def sendMessage(self, prompt, **options):
                captured["prompt"] = prompt
                captured["send_options"] = options
                yield {"type": "done", "content": "完整报告"}

        fake_module = types.ModuleType("App.Core.model")
        fake_module.Model = FakeModel

        with patch.dict(sys.modules, {"App.Core.model": fake_module}):
            report = worker._generate_report({"username": "alice", "prompt": "整理新论文"})

        self.assertEqual(report, "完整报告")
        self.assertFalse(captured["options"]["persist_conversation"])
        self.assertFalse(captured["options"]["auto_create"])
        self.assertTrue(captured["send_options"]["enable_tools"])

    def test_completed_run_writes_knowledge_and_notification(self):
        task = store.create_task("alice", "论文周报", "整理新论文", [0], 9, 0)

        with store._connection() as connection:
            connection.execute(
                "UPDATE scheduled_tasks SET next_run_at = ? WHERE task_id = ?",
                (int(store.time.time()), task["task_id"]),
            )

        claimed = store.claim_due_task()
        saved = {}
        notices = []

        class FakeUser:
            def __init__(self, username):
                saved["username"] = username

            def addBasis(self, title, content, url, timeline_actor=None):
                saved.update({"title": title, "content": content, "url": url, "actor": timeline_actor})

        fake_user_module = types.ModuleType("basis.User")
        fake_user_module.User = FakeUser
        fake_notification_module = types.ModuleType("App.Observability.notification")
        fake_notification_module.create_user_notification = lambda username, payload: notices.append((username, payload))

        with patch.object(worker, "_generate_report", return_value="完整报告"), patch.dict(sys.modules, {
            "basis.User": fake_user_module,
            "App.Observability.notification": fake_notification_module,
        }):
            worker._run_task(claimed)

        self.assertEqual(saved["content"], "完整报告")
        self.assertEqual(saved["username"], "alice")
        self.assertEqual(notices[0][0], "alice")
        self.assertEqual(notices[0][1]["level"], "success")
        self.assertEqual(store.list_runs("alice", task["task_id"])[0]["status"], "success")


if __name__ == "__main__":
    unittest.main()
