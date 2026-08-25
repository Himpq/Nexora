"""Regression tests for evidence-based learning duration aggregation."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from api.telemetry import _compute_reading_analysis
from core.user.learning_progress import _measured_reading_seconds_per_book


class LearningDurationAggregationTests(unittest.TestCase):
    def test_cross_day_events_do_not_create_study_duration(self) -> None:
        rows = [
            {"ts": "1000", "bid": "book-a", "event": "focus_in", "extra": ""},
            {"ts": "104_401_000", "bid": "book-a", "event": "scroll", "extra": ""},
        ]

        result, diagnostics = _measured_reading_seconds_per_book(rows)

        self.assertEqual(result, {})
        self.assertEqual(diagnostics["unmeasured_engaging_events"], 2)

    def test_heartbeats_measure_fixed_active_intervals(self) -> None:
        rows = [
            {"ts": str(index), "bid": "book-a", "event": "snapshot", "extra": ""}
            for index in range(3)
        ]

        result, diagnostics = _measured_reading_seconds_per_book(rows)

        self.assertEqual(result, {"book-a": 30.0})
        self.assertEqual(diagnostics["unmeasured_engaging_events"], 0)

    def test_session_duration_is_deduplicated_by_session_key(self) -> None:
        rows = [
            {
                "ts": "1000",
                "bid": "book-a",
                "event": "focus_out",
                "extra": '{"session_key":"session-a","duration_ms":60000}',
            },
            {
                "ts": "1001",
                "bid": "book-a",
                "event": "session_complete",
                "extra": '{"session_key":"session-a","duration_ms":60000}',
            },
            {
                "ts": "2000",
                "bid": "book-a",
                "event": "focus_out",
                "extra": '{"session_key":"session-b","duration_ms":120000}',
            },
        ]

        result, _ = _measured_reading_seconds_per_book(rows)

        self.assertEqual(result, {"book-a": 180.0})

    def test_reading_analysis_rejects_timestamp_pair_inference(self) -> None:
        events = [
            {
                "ts": 1_000,
                "bid": "book-a",
                "ci_raw": "0",
                "si_raw": "0",
                "event": "focus_in",
                "focus": "reader",
                "scroll": "",
                "extra": "",
            },
            {
                "ts": 86_401_000,
                "bid": "book-a",
                "ci_raw": "0",
                "si_raw": "0",
                "event": "focus_out",
                "focus": "blur",
                "scroll": "",
                "extra": "",
            },
        ]

        analysis = _compute_reading_analysis(events)

        self.assertEqual(analysis["total_reading_sec"], 0)
        self.assertEqual(analysis["session_count"], 0)
        self.assertEqual(analysis["unmeasured_session_events"], 1)


if __name__ == "__main__":
    unittest.main()
