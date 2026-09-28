"""Regression tests for evidence-based learning duration aggregation."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from api.telemetry import _compute_reading_analysis, ingest_batch, init_telemetry, query_reading_summary, query_user_analysis
from core.user.learning_progress import _measured_reading_seconds_per_book


class LearningDurationAggregationTests(unittest.TestCase):
    def test_reading_analysis_measures_active_heartbeats_before_reader_exit(self) -> None:
        events = [
            {"ts": timestamp, "bid": "book-a", "ci_raw": "0", "si_raw": "0", "event": "snapshot", "focus": "reader", "scroll": 0.2,
             "extra": {"session_key": "a", "active_duration_ms": duration}}
            for timestamp, duration in ((1000, 8000), (2000, 16000), (2000, 16000))
        ]
        analysis = _compute_reading_analysis(events)
        self.assertEqual(analysis["total_reading_sec"], 16)
        self.assertEqual(analysis["chapter_dwell"], {"0": 16})
        self.assertEqual(analysis["session_count"], 1)

    def test_telemetry_summary_and_analysis_use_same_active_duration(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            init_telemetry({"data_dir": directory})
            row = {"stream": "reading", "ts": 1_800_000_000_000, "bid": "book-a", "ci": 0, "event": "snapshot", "focus": "reader",
                   "extra": {"session_key": "a", "active_duration_ms": 8000}}
            ingest_batch("reader-a", [row, dict(row)])
            summary = query_reading_summary("reader-a", book_id="book-a")
            analysis = query_user_analysis("reader-a", book_id="book-a")["reading"]
        self.assertEqual(summary["chapter_dwell"], {"0": 8})
        self.assertEqual(analysis["total_reading_sec"], 8)

    def test_keyed_heartbeats_and_completions_count_each_visit_once(self) -> None:
        rows = [
            {"ts": "1", "bid": "book-a", "event": "snapshot", "extra": '{"session_key":"a","active_duration_ms":8000}'},
            {"ts": "1", "bid": "book-a", "event": "snapshot", "extra": '{"session_key":"a","active_duration_ms":8000}'},
            {"ts": "2", "bid": "book-a", "event": "snapshot", "extra": '{"session_key":"a","active_duration_ms":16000}'},
            {"ts": "3", "bid": "book-a", "event": "focus_out", "extra": '{"session_key":"a","duration_ms":18000}'},
            {"ts": "4", "bid": "book-a", "event": "session_complete", "extra": '{"session_key":"a","duration_ms":18000}'},
            {"ts": "5", "bid": "book-a", "event": "snapshot", "extra": '{"session_key":"b","active_duration_ms":7000}'},
        ]
        result, _ = _measured_reading_seconds_per_book(rows)
        self.assertEqual(result, {"book-a": 25.0})

    def test_zero_measured_snapshot_does_not_invent_ten_seconds(self) -> None:
        result, _ = _measured_reading_seconds_per_book([
            {"ts": "1", "bid": "book-a", "event": "snapshot", "extra": '{"session_key":"a","active_duration_ms":0}'},
        ])
        self.assertEqual(result, {})

    def test_duplicate_legacy_snapshot_does_not_inflate_duration(self) -> None:
        row = {"ts": "1000", "bid": "book-a", "event": "snapshot", "extra": ""}
        result, _ = _measured_reading_seconds_per_book([row, dict(row)])
        self.assertEqual(result, {"book-a": 10.0})

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
