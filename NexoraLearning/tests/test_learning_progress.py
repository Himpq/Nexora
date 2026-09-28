"""Reader-to-progress regressions using the real HTTP and per-user stores."""

from __future__ import annotations

import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from flask import Flask

from api.learning_progress import init_learning_progress, learning_progress_bp
from core import user as user_store
from core.lectures import (
    create_book,
    create_lecture,
    save_book_info_xml,
    save_book_sections_xml,
    save_book_text,
)
from core.user.learning_progress import build_user_study_hours_map, compute_user_lecture_progress


class LearningProgressTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.cfg = {"data_dir": str(Path(self.directory.name) / "data")}
        init_learning_progress(self.cfg)
        app = Flask(__name__)
        app.config["TESTING"] = True
        app.register_blueprint(learning_progress_bp)
        self.client = app.test_client()
        self.headers = {"X-Nexora-Username": "fresh-student"}
        self.lecture = create_lecture(self.cfg, "阅读课程", status="published")
        self.book = self._book("第一册")
        user_store.set_lecture_selection(
            self.cfg, "fresh-student", self.lecture["id"], selected=True, actor="test"
        )
        queue = patch("api.learning_progress.enqueue_memory_job", return_value={"job_id": "test-job"})
        self.enqueue = queue.start()
        self.addCleanup(queue.stop)

    def _book(self, title):
        book = create_book(self.cfg, self.lecture["id"], title)
        save_book_text(self.cfg, self.lecture["id"], book["id"], "甲" * 100 + "乙" * 100)
        save_book_info_xml(
            self.cfg,
            self.lecture["id"],
            book["id"],
            "<book><chapter><chapter_name>引言</chapter_name><chapter_range>0:100</chapter_range></chapter>"
            "<chapter><chapter_name>应用</chapter_name><chapter_range>100:100</chapter_range></chapter></book>",
        )
        save_book_sections_xml(
            self.cfg,
            self.lecture["id"],
            book["id"],
            "<sections><chapter_sessions><chapter_name>引言</chapter_name>"
            "<session_item><session_name>第一节</session_name><session_range>0:50</session_range></session_item>"
            "<session_item><session_name>第二节</session_name><session_range>50:50</session_range></session_item>"
            "</chapter_sessions></sections>",
        )
        return book

    def _complete_chapter(self, book, chapter_index=0, chapter_name="引言"):
        return self.client.post(
            "/api/frontend/learning/chapter-complete",
            headers=self.headers,
            json={
                "lecture_id": self.lecture["id"],
                "book_id": book["id"],
                "chapter_index": chapter_index,
                "chapter_name": chapter_name,
            },
        )

    def _progress(self, books=None, user_id="fresh-student", **kwargs):
        return compute_user_lecture_progress(
            user_id, self.lecture["id"], books or [self.book], **kwargs
        )

    def _reading_records(self):
        return [
            row for row in user_store.list_learning_records(self.cfg, "fresh-student")
            if row.get("type") != "lecture_selection"
        ]

    def _checkpoint(self, **overrides):
        payload = {
            "lecture_id": self.lecture["id"],
            "book_id": self.book["id"],
            "chapter_index": 0,
            "chapter_name": "引言",
            "chapter_range": "0:100",
            "coordinate_space": "plain",
            "session_id": "reading-visit-a",
            "sequence": 1,
            "active_duration_ms": 10_000,
            "read_ranges": [[0, 20]],
            "paragraph_index": 0,
            "page_index": 0,
        }
        payload.update(overrides)
        return self.client.post(
            "/api/frontend/learning/reading-progress", headers=self.headers, json=payload
        )

    def test_session_completion_advances_partial_course_progress(self):
        response = self.client.post(
            "/api/frontend/learning/session-complete",
            headers=self.headers,
            json={
                "lecture_id": self.lecture["id"],
                "book_id": self.book["id"],
                "chapter_index": 0,
                "chapter_name": "引言",
                "session_index": 0,
                "session_name": "第一节",
                "session_range": "0:50",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._progress()["progress"], 25)
        self.assertEqual(self._progress(user_id="another-student")["progress"], 0)

    def test_two_books_with_same_chapter_names_complete_independently(self):
        second = self._book("第二册")
        for book in (self.book, second):
            for chapter_index, chapter_name in enumerate(("引言", "应用")):
                response = self._complete_chapter(book, chapter_index, chapter_name)
                self.assertEqual(response.status_code, 200)
        self.assertEqual(self._progress([self.book, second])["progress"], 100)

    def test_nonexistent_chapter_cannot_create_progress(self):
        response = self._complete_chapter(self.book, 99, "不存在的章节")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._progress()["progress"], 0)
        self.assertEqual(self._reading_records(), [])

    def test_partial_reading_is_visible_before_any_chapter_completion(self):
        response = self._checkpoint(read_ranges=[[0, 30], [20, 60]], active_duration_ms=60_000)
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertTrue(body["success"])
        self.assertEqual(body["progress"]["reading_progress"], 30)
        self.assertEqual(body["chapter"]["reading_percent"], 60)
        progress = self._progress()
        self.assertEqual(progress["progress"], 30)
        self.assertEqual(progress["reading_seconds"], 60)
        self.assertEqual(progress["completed_chapters"], 0)
        self.assertEqual(progress["read_chapters"], 1)
        self.assertEqual(self._progress(user_id="another-student")["progress"], 0)
        self.assertEqual(user_store.list_question_completions(self.cfg, "fresh-student"), [])

    def test_retry_and_out_of_order_checkpoints_do_not_inflate_duration(self):
        newer = {"sequence": 2, "read_ranges": [[0, 60]], "active_duration_ms": 60_000, "page_index": 2}
        self.assertEqual(self._checkpoint(**newer).status_code, 200)
        repeated = self._checkpoint(**newer)
        self.assertTrue(repeated.get_json()["already_recorded"])
        self.assertEqual(self._checkpoint(read_ranges=[[50, 70]], active_duration_ms=20_000).status_code, 200)
        progress = self._progress()
        self.assertEqual(progress["read_chars"], 70)
        self.assertEqual(progress["reading_seconds"], 60)
        self.assertEqual(progress["chapters"][0]["page_index"], 2)
        self.assertEqual(len(self._reading_records()), 2)

    def test_chapter_switch_uses_separate_sessions_and_keeps_coverage(self):
        self.assertEqual(self._checkpoint(active_duration_ms=30_000).status_code, 200)
        response = self._checkpoint(
            chapter_index=1, chapter_name="应用", chapter_range="100:100",
            session_id="reading-visit-b", read_ranges=[[150, 190]], active_duration_ms=20_000,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._progress()["reading_progress"], 30)
        self.assertEqual(self._progress()["reading_seconds"], 50)
        self.assertEqual(self._progress()["read_chapters"], 2)
        self.assertEqual(self._progress()["completed_chapters"], 0)
        self.assertEqual(self._progress()["current_chapter"], "应用")

    def test_checkpoint_rejects_wrong_coordinates_and_foreign_chapter_range(self):
        for overrides in (
            {"coordinate_space": "raw"},
            {"read_ranges": [[0, 150]]},
            {"read_ranges": [[50, 10]]},
            {"read_ranges": [[0, "20"]]},
            {"active_duration_ms": -10},
            {"sequence": -1},
            {"chapter_index": 99},
            {"chapter_range": "0:999"},
        ):
            with self.subTest(overrides=overrides):
                self.assertEqual(self._checkpoint(**overrides).status_code, 400)
        self.assertEqual(self._progress()["progress"], 0)

    def test_same_session_cannot_be_reused_for_a_different_chapter(self):
        self.assertEqual(self._checkpoint().status_code, 200)
        response = self._checkpoint(
            chapter_index=1, chapter_name="应用", chapter_range="100:100",
            sequence=2, read_ranges=[[100, 120]],
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self._progress()["read_chars"], 20)

    def test_checkpoint_identity_cannot_escape_or_override_header_user(self):
        response = self._checkpoint(username="another-student")
        self.assertEqual(response.status_code, 400)
        self.headers = {"X-Nexora-Username": "../outside"}
        self.assertEqual(self._checkpoint().status_code, 400)
        self.assertFalse((Path(self.cfg["data_dir"]) / "outside").exists())

    def test_concurrent_retries_append_once(self):
        with ThreadPoolExecutor(max_workers=6) as workers:
            responses = list(workers.map(lambda _: self._checkpoint(), range(6)))
        self.assertTrue(all(response.status_code == 200 for response in responses))
        self.assertEqual(len(self._reading_records()), 1)
        self.assertEqual(self._progress()["reading_seconds"], 10)

    def test_full_coverage_does_not_generate_completion_or_mastery(self):
        response = self._checkpoint(read_ranges=[[0, 100]], active_duration_ms=60_000)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._progress()["completed_chapters"], 0)
        self.assertFalse(any(
            row["type"] == "chapter_completed"
            for row in user_store.list_learning_records(self.cfg, "fresh-student")
        ))

    def test_book_scoped_progress_does_not_include_other_books(self):
        second = self._book("第二册")
        self.assertEqual(self._checkpoint().status_code, 200)
        first_progress = self._progress([self.book, second], book_id=self.book["id"])
        second_progress = self._progress([self.book, second], book_id=second["id"])
        self.assertEqual(first_progress["reading_progress"], 10)
        self.assertEqual(second_progress["reading_progress"], 0)
        self.assertEqual(second_progress["reading_seconds"], 0)

    def test_learning_and_telemetry_evidence_are_not_counted_twice(self):
        self.assertEqual(self._checkpoint(active_duration_ms=60_000).status_code, 200)
        with patch("core.user.learning_progress._telemetry_reading_seconds_per_book", return_value={self.book["id"]: 60}):
            hours = build_user_study_hours_map("fresh-student")
        self.assertAlmostEqual(hours[self.lecture["id"]], 60 / 3600)

    def test_study_hours_sum_distinct_books_in_same_lecture(self):
        second = self._book("第二册")
        with patch(
            "core.user.learning_progress._telemetry_reading_seconds_per_book",
            return_value={self.book["id"]: 60, second["id"]: 120},
        ):
            hours = build_user_study_hours_map("fresh-student")
        self.assertAlmostEqual(hours[self.lecture["id"]], 180 / 3600)

    def test_old_telemetry_and_new_reading_in_distinct_books_are_both_counted(self):
        second = self._book("第二册")
        self.assertEqual(self._checkpoint(active_duration_ms=60_000).status_code, 200)
        with patch(
            "core.user.learning_progress._telemetry_reading_seconds_per_book",
            return_value={second["id"]: 120},
        ):
            hours = build_user_study_hours_map("fresh-student")
            progress = self._progress([self.book, second])
        self.assertAlmostEqual(hours[self.lecture["id"]], 180 / 3600)
        self.assertEqual(progress["reading_seconds"], 180)

    def test_plain_unicode_ranges_are_not_raw_html_or_utf16_offsets(self):
        raw = "<p>甲😀乙</p><p>丙丁</p>"
        save_book_text(self.cfg, self.lecture["id"], self.book["id"], raw)
        save_book_info_xml(
            self.cfg, self.lecture["id"], self.book["id"],
            f"<book><chapter><chapter_name>引言</chapter_name><chapter_range>0:{len(raw)}</chapter_range></chapter></book>",
        )
        response = self._checkpoint(chapter_range="0:7", read_ranges=[[0, 3]])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["chapter"]["read_chars"], 3)
        self.assertEqual(response.get_json()["chapter"]["total_chars"], 7)

    def test_clear_chapter_resets_coverage_without_replaying_pending_old_visits(self):
        self.assertEqual(self._checkpoint(active_duration_ms=60_000).status_code, 200)
        self.assertEqual(self._complete_chapter(self.book).status_code, 200)
        response = self.client.post(
            "/api/frontend/learning/chapter-record/clear", headers=self.headers,
            json={"lecture_id": self.lecture["id"], "book_id": self.book["id"], "chapter_index": 0, "chapter_name": "引言"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._progress()["read_chars"], 0)
        self.assertEqual(self._progress()["completed_chapters"], 0)
        self.assertEqual(self._checkpoint(sequence=2, read_ranges=[[0, 50]], active_duration_ms=65_000).status_code, 200)
        self.assertEqual(self._progress()["read_chars"], 0)
        self.assertEqual(self._progress()["reading_seconds"], 60)
        self.assertEqual(self._checkpoint(session_id="new-after-reset", read_ranges=[[20, 40]]).status_code, 200)
        self.assertEqual(self._progress()["read_chars"], 20)

    def test_progress_can_use_explicit_config_independent_of_global_initialization(self):
        self.assertEqual(self._checkpoint().status_code, 200)
        original_progress = self._progress(cfg=self.cfg)
        with tempfile.TemporaryDirectory() as other:
            init_learning_progress({"data_dir": str(Path(other) / "data")})
            progress = self._progress(cfg=self.cfg)
        self.assertEqual(progress, original_progress)

    def test_offline_retry_keeps_activity_on_the_day_it_happened(self):
        day_one = 1_800_000_000
        with patch("time.time", return_value=day_one + 86_400):
            response = self._checkpoint(
                started_at_ms=day_one * 1000,
                observed_at_ms=(day_one + 60) * 1000,
                active_duration_ms=60_000,
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._reading_records()[0]["timestamp"], day_one + 60)

    def test_restarting_service_preserves_checkpoint_idempotence(self):
        self.assertEqual(self._checkpoint().status_code, 200)
        app = Flask("restarted-learning-service")
        init_learning_progress(self.cfg)
        app.register_blueprint(learning_progress_bp)
        self.client = app.test_client()
        repeated = self._checkpoint()
        self.assertEqual(repeated.status_code, 200)
        self.assertTrue(repeated.get_json()["already_recorded"])
        self.assertEqual(len(self._reading_records()), 1)
        self.assertEqual(self._checkpoint(sequence=2, active_duration_ms=20_000).status_code, 200)
        self.assertEqual(self._progress()["reading_seconds"], 20)

    def test_unseen_offline_visit_cannot_resurrect_a_cleared_chapter(self):
        now = 1_800_000_000
        with patch("time.time", return_value=now):
            response = self.client.post(
                "/api/frontend/learning/chapter-record/clear", headers=self.headers,
                json={"lecture_id": self.lecture["id"], "book_id": self.book["id"], "chapter_index": 0, "chapter_name": "引言"},
            )
        self.assertEqual(response.status_code, 200)
        with patch("time.time", return_value=now + 86_400):
            response = self._checkpoint(
                session_id="never-arrived-before-reset",
                started_at_ms=(now - 60) * 1000,
                observed_at_ms=(now - 30) * 1000,
                active_duration_ms=30_000,
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["already_recorded"])
        self.assertEqual(self._progress()["read_chars"], 0)

    def test_delayed_previous_visit_does_not_replace_newer_resume_target(self):
        now = 1_800_000_000
        with patch("time.time", return_value=now + 120):
            self.assertEqual(self._checkpoint(
                chapter_index=1, chapter_name="应用", chapter_range="100:100",
                session_id="newer-visit", read_ranges=[[100, 120]],
                started_at_ms=(now + 60) * 1000, observed_at_ms=(now + 90) * 1000,
            ).status_code, 200)
            self.assertEqual(self._checkpoint(
                started_at_ms=now * 1000, observed_at_ms=(now + 30) * 1000,
            ).status_code, 200)
        self.assertEqual(self._progress()["current_chapter"], "应用")

    def test_out_of_order_cross_day_checkpoints_keep_daily_duration_correct(self):
        from api.agent_facade import _today_data, _today_start_timestamp

        now = 1_800_090_000
        midnight = _today_start_timestamp(now)
        with patch("time.time", return_value=now):
            self.assertEqual(self._checkpoint(
                sequence=2, active_duration_ms=60_000,
                started_at_ms=(midnight - 100) * 1000, observed_at_ms=(midnight + 20) * 1000,
            ).status_code, 200)
            self.assertEqual(self._checkpoint(
                sequence=1, active_duration_ms=40_000,
                started_at_ms=(midnight - 100) * 1000, observed_at_ms=(midnight - 20) * 1000,
            ).status_code, 200)
        today = _today_data(self._reading_records(), [], now=now)
        self.assertEqual(today["study_minutes"], 0.3)

    def test_repeated_resets_and_retries_keep_historical_duration_monotonic(self):
        self.assertEqual(self._checkpoint(active_duration_ms=60_000).status_code, 200)
        clear_payload = {"lecture_id": self.lecture["id"], "book_id": self.book["id"], "chapter_index": 0, "chapter_name": "引言"}
        for _ in range(2):
            response = self.client.post("/api/frontend/learning/chapter-record/clear", headers=self.headers, json=clear_payload)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(self._checkpoint(sequence=2, active_duration_ms=100_000).status_code, 200)
            self.assertEqual(self._progress()["reading_seconds"], 60)
            self.assertEqual(self._progress()["read_chars"], 0)
        self.assertEqual(self._checkpoint(session_id="visit-after-resets").status_code, 200)
        self.assertEqual(self._progress()["reading_seconds"], 70)
        self.assertEqual(self._progress()["read_chars"], 20)

    def _duplicate_chapter_titles(self):
        save_book_info_xml(
            self.cfg, self.lecture["id"], self.book["id"],
            "<book><chapter><chapter_name>引言</chapter_name><chapter_range>0:100</chapter_range></chapter>"
            "<chapter><chapter_name>引言</chapter_name><chapter_range>100:100</chapter_range></chapter></book>",
        )

    def test_clearing_one_of_two_same_named_chapters_preserves_the_other(self):
        self._duplicate_chapter_titles()
        self.assertEqual(self._complete_chapter(self.book, 0).status_code, 200)
        self.assertEqual(self._complete_chapter(self.book, 1).status_code, 200)
        response = self.client.post(
            "/api/frontend/learning/chapter-record/clear", headers=self.headers,
            json={"lecture_id": self.lecture["id"], "book_id": self.book["id"], "chapter_index": 1, "chapter_name": "引言"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._progress()["completed_chapters"], 1)
        self.assertEqual(self._progress()["reading_progress"], 50)

    def test_ambiguous_old_chapter_completion_does_not_block_an_indexed_completion(self):
        self._duplicate_chapter_titles()
        user_store.append_learning_record(self.cfg, "fresh-student", {
            "type": "chapter_completed", "lecture_id": self.lecture["id"], "book_id": self.book["id"], "chapter_name": "引言",
        })
        response = self._complete_chapter(self.book, 1)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.get_json()["already_completed"])
        self.assertEqual(self._progress()["completed_chapters"], 1)


if __name__ == "__main__":
    unittest.main()
