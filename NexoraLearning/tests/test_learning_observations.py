"""Legacy learner timestamps must not break observation and chat endpoints."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask

from api.agent_facade import agent_facade_bp, init_agent_facade
from core import user as user_store
from core.cognition.learning_observations import learning_observations
from core.lectures import create_book, create_lecture, save_book_info_xml, save_book_text
from core.memory.evidence_memory import record_user_message
from core.user.learning_progress import init_learning_progress


class LearningObservationTimestampTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.cfg = {
            "data_dir": str(Path(temporary.name) / "data"),
            "runtime_api": {"enabled": True, "api_key": ""},
            "nexora": {"base_url": "http://127.0.0.1:9", "api_key": ""},
            "models": {"default_nexora_model": ""},
        }
        init_agent_facade(self.cfg)
        init_learning_progress(self.cfg)
        app = Flask(__name__)
        app.register_blueprint(agent_facade_bp)
        self.client = app.test_client()
        self.headers = {"X-Nexora-Username": "legacy_learner"}
        self.lecture = create_lecture(self.cfg, "数据库", status="published")
        self.book = create_book(self.cfg, self.lecture["id"], "事务教材")
        body = "第一章 事务\n事务保证操作的一致性。"
        save_book_text(self.cfg, self.lecture["id"], self.book["id"], body)
        save_book_info_xml(self.cfg, self.lecture["id"], self.book["id"],
                           f"<book><chapter><chapter_name>第一章 事务</chapter_name>"
                           f"<chapter_range>0:{len(body)}</chapter_range></chapter></book>")
        user_store.set_lecture_selection(self.cfg, "legacy_learner", self.lecture["id"], selected=True)

    def record(self, **fields):
        return user_store.append_learning_record(self.cfg, "legacy_learner", {
            "type": "study_time", "lecture_id": self.lecture["id"],
            "book_id": self.book["id"], "chapter_index": 0, "study_seconds": 120,
            **fields,
        })

    def ask(self):
        with patch("api.agent_facade._PROXY") as proxy:
            proxy.complete_raw.return_value = {"success": True, "payload": {}}
            proxy.extract_output_text.return_value = "事务保证一组操作全部完成或全部撤销。"
            response = self.client.post("/api/agent/v1/ask-in-context", headers=self.headers,
                                        json={"question": "事务是什么？"})
            self.assertEqual(response.status_code, 200, response.get_json())
            return "\n".join(message["content"] for message in proxy.complete_raw.call_args.kwargs["messages"])

    def test_millisecond_reading_keeps_observations_and_chat_available(self):
        occurred_at = 1_700_000_000
        self.record(timestamp=occurred_at * 1000, event_id="legacy-milliseconds")
        response = self.client.get("/api/agent/v1/cognition/overview", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.get_json())
        overview = response.get_json()["data"]
        reading = next(row for row in overview["facets"] if row["kind"] == "reading")
        self.assertEqual(reading["updatedAt"], occurred_at)
        self.assertEqual(reading["evidence"][0]["occurredAt"], occurred_at)
        self.assertEqual(overview["activity"]["last_activity_at"], occurred_at)
        self.assertEqual(overview["activity"]["reading_seconds"], 120)
        self.assertIn('"reading_seconds": 120', self.ask())

    def test_invalid_timestamps_preserve_reading_without_replacing_valid_recency(self):
        invalid_values = [None, "", "not-a-time", float("nan"), float("inf"), -1,
                          10 ** 400, 10 ** 22, {"bad": "time"}, [1], True]
        for index, value in enumerate(invalid_values):
            self.record(timestamp=value, ts=value, event_id=f"invalid-{index}",
                        type="reading_progress", session_id=f"visit-{index}", sequence=1,
                        active_duration_ms=120_000)
        unknown = learning_observations(self.cfg, "legacy_learner")
        self.assertEqual(unknown["activity"]["last_activity_at"], 0)
        self.assertEqual(unknown["activity"]["reading_seconds"], 120 * len(invalid_values))
        occurred_at = 1_700_000_000
        self.record(timestamp=occurred_at, event_id="valid-time")
        response = self.client.get("/api/agent/v1/cognition/overview", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.get_json())
        overview = response.get_json()["data"]
        reading = next(row for row in overview["facets"] if row["kind"] == "reading")
        self.assertEqual(reading["evidence"][0]["sourceId"], "valid-time")
        self.assertEqual(overview["activity"]["last_activity_at"], occurred_at)
        self.assertEqual(overview["activity"]["reading_seconds"], 120 * (len(invalid_values) + 1))
        self.assertIn('"reading_seconds":', self.ask())

    def test_mixed_units_and_ts_alias_keep_the_actual_latest_record(self):
        occurred_at = 1_700_000_000
        self.record(timestamp=occurred_at * 1000, event_id="older-milliseconds")
        self.record(timestamp=occurred_at + 60, event_id="newer-seconds")
        self.record(timestamp=None, ts=(occurred_at + 120) * 1000, event_id="ts-only")
        self.record(timestamp="invalid", ts=str((occurred_at + 180) * 1000), event_id="fallback-ts")
        stored_before = json.dumps(user_store.list_learning_records(self.cfg, "legacy_learner"))
        observed = learning_observations(self.cfg, "legacy_learner")
        reading = next(row for row in observed["facets"] if row["kind"] == "reading")
        self.assertEqual(reading["updatedAt"], occurred_at + 180)
        self.assertEqual(reading["evidence"][0]["sourceId"], "fallback-ts")
        self.assertEqual(observed["activity"]["last_activity_at"], occurred_at + 180)
        self.assertEqual(observed["activity"]["reading_seconds"], 480)
        self.assertEqual(json.dumps(user_store.list_learning_records(self.cfg, "legacy_learner")), stored_before)

    def test_memory_observations_also_normalize_milliseconds_before_display(self):
        occurred_at = 1_700_000_000
        record_user_message(self.cfg, "legacy_learner", text="我喜欢先看图解。",
                            source_id="legacy-memory-time", occurred_at=occurred_at * 1000)
        observed = learning_observations(self.cfg, "legacy_learner")
        memory = next(row for row in observed["facets"] if row["kind"] == "preference")
        self.assertEqual(memory["updatedAt"], occurred_at)
        self.assertEqual(memory["evidence"][0]["occurredAt"], occurred_at)
        self.assertEqual(observed["activity"]["last_activity_at"], occurred_at)


if __name__ == "__main__":
    unittest.main()
