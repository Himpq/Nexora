"""Validate telemetry ingestion against temporary SQLite storage only."""

import importlib.util
from contextlib import closing
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask


SOURCE = Path(__file__).resolve().parents[1] / "api/App/Observability/telemetry.py"


class TelemetryIngestionTests(unittest.TestCase):
    """Reject unexpected event content and verify bounded daily aggregation."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        spec = importlib.util.spec_from_file_location("isolated_telemetry", SOURCE)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.module._DATA_DIR = Path(self.directory.name)
        self.module._DATABASE_PATH = self.module._DATA_DIR / "events.sqlite3"
        app = Flask(__name__)
        app.register_blueprint(self.module.telemetry_bp)
        self.client = app.test_client()
        self.identity = "a" * 32

    def activity(self, **changes):
        payload = {"installation_id": self.identity, "event_type": "activity", "active_seconds": 30}
        payload.update(changes)
        return self.client.post("/api/nexoracode/telemetry/events", json=payload)

    def test_activity_aggregates_by_installation_and_utc_day(self):
        self.assertEqual(self.activity().status_code, 201)
        self.assertEqual(self.activity(active_seconds=12).status_code, 201)

        with closing(sqlite3.connect(self.module._DATABASE_PATH)) as database:
            row = database.execute(
                "SELECT installation_id, day_utc, active_seconds FROM nexoracode_daily_activity"
            ).fetchone()

        self.assertEqual(row, (self.identity, datetime.now(timezone.utc).date().isoformat(), 42))

    def test_rejects_private_or_unexpected_fields(self):
        for field in ["project_hash", "path", "api_key", "message", "ip"]:
            with self.subTest(field=field):
                self.assertEqual(self.activity(**{field: "unexpected"}).status_code, 400)

    def test_rejects_invalid_activity_and_identifier(self):
        for value in [True, 0, 61, "30", None]:
            with self.subTest(value=value):
                self.assertEqual(self.activity(active_seconds=value).status_code, 400)

        self.assertEqual(self.activity(installation_id="not-an-installation-id").status_code, 400)

    def test_error_categories_are_allowlisted(self):
        payload = {
            "installation_id": self.identity,
            "event_type": "error",
            "error_category": "provider",
            "error_type": "TimeoutError",
        }
        self.assertEqual(self.client.post("/api/nexoracode/telemetry/events", json=payload).status_code, 201)
        payload["error_type"] = "ArbitrarySensitiveError"
        self.assertEqual(self.client.post("/api/nexoracode/telemetry/events", json=payload).status_code, 400)

    def test_daily_activity_cap_is_enforced(self):
        self.assertEqual(self.activity().status_code, 201)

        with closing(sqlite3.connect(self.module._DATABASE_PATH)) as database:
            database.execute("UPDATE nexoracode_daily_activity SET active_seconds = 86399")
            database.commit()

        self.assertEqual(self.activity().status_code, 201)

        with closing(sqlite3.connect(self.module._DATABASE_PATH)) as database:
            seconds = database.execute("SELECT active_seconds FROM nexoracode_daily_activity").fetchone()[0]

        self.assertEqual(seconds, 86400)

    def test_large_payload_is_rejected(self):
        self.assertEqual(self.activity(extra="x" * 1500).status_code, 413)


if __name__ == "__main__":
    unittest.main()
