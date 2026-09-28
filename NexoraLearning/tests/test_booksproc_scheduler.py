"""B1 夜间备课调度器测试。

不启动真实模型任务：worker 未启动时入队只停留在队列里（无模型调用），
完成路径用直接落盘的书级状态 + annotations.xml / questions.xml 模拟。
"""

from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from flask import Flask

from api.agent_facade import agent_facade_bp, init_agent_facade
from core import user as user_store
from core.booksproc import scheduler
from core.lectures import create_book, create_lecture, save_book_info_xml, save_book_text, update_book
from core.user import set_lecture_selection


def _app(tmp_path):
    cfg = {
        "data_dir": str(tmp_path / "data"),
        "runtime_api": {"enabled": True, "api_key": ""},
        "nexora": {"base_url": "http://127.0.0.1:9", "api_key": ""},
        "models": {"default_nexora_model": ""},
    }
    app = Flask(__name__)
    init_agent_facade(cfg)
    app.register_blueprint(agent_facade_bp)
    return app, cfg


def _seed_course(cfg, username: str = "demo"):
    lecture = create_lecture(cfg, "机器学习入门", description="演示课程", status="published")
    book = create_book(cfg, lecture["id"], "教材第一册")
    save_book_text(cfg, lecture["id"], book["id"], "第一章 梯度下降\n梯度下降是一种优化方法。\n第二章 反向传播\n反向传播用于计算梯度。")
    save_book_info_xml(
        cfg,
        lecture["id"],
        book["id"],
        "<book><chapter><chapter_name>第一章 梯度下降</chapter_name><chapter_range>0:36</chapter_range></chapter>"
        "<chapter><chapter_name>第二章 反向传播</chapter_name><chapter_range>36:26</chapter_range></chapter></book>",
    )
    set_lecture_selection(cfg, username, lecture["id"], selected=True, actor="test")
    return lecture, book


def _finish_stages(cfg, lecture_id, book_id):
    """模拟三个备课阶段完成 + 落盘批注与题目。"""
    update_book(cfg, lecture_id, book_id, {
        "coarse_status": "done",
        "intensive_status": "done",
        "section_status": "done",
        "annotation_status": "done",
        "question_status": "done",
    })
    scheduler.save_annotations_xml(
        cfg,
        lecture_id,
        book_id,
        "<annotations><coordinate_space>plain</coordinate_space>"
        "<annotation><chapter_name>第一章 梯度下降</chapter_name><anchor_text>梯度下降是一种优化方法</anchor_text></annotation>"
        "<annotation><chapter_name>第一章 梯度下降</chapter_name><anchor_text>沿着梯度反方向更新参数</anchor_text></annotation>"
        "</annotations>",
    )
    from core.lectures import save_book_questions_xml

    save_book_questions_xml(
        cfg,
        lecture_id,
        book_id,
        "<questions>"
        "<chapter_questions><chapter_range>0:36</chapter_range><question_items>"
        "<question_item><question_title>什么是梯度下降</question_title><question_answer>优化方法</question_answer></question_item>"
        "<question_item><question_title>学习率的作用</question_title><question_answer>步长</question_answer></question_item>"
        "</question_items></chapter_questions>"
        "</questions>",
    )


class NightlyPrepSchedulerTests(unittest.TestCase):
    def test_resolve_targets_anchor_and_next_chapter(self):
        with tempfile.TemporaryDirectory() as directory:
            _, cfg = _app(Path(directory))
            _seed_course(cfg)
            targets = scheduler.resolve_targets(cfg, "demo")
            self.assertEqual(len(targets), 2)
            self.assertEqual(targets[0]["chapter_index"], 0)
            self.assertEqual(targets[1]["chapter_index"], 1)
            self.assertEqual(targets[0]["chapter_name"], "第一章 梯度下降")
            self.assertEqual(targets[1]["chapter_name"], "第二章 反向传播")

    def test_run_pass_enqueues_intensive_only_when_coarse_done(self):
        with tempfile.TemporaryDirectory() as directory:
            _, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            update_book(cfg, lecture["id"], book["id"], {"coarse_status": "done"})
            result = scheduler.run_nightly_pass(cfg, usernames=["demo"])
            self.assertTrue(result["ran"])
            ran_for = result["ran_for"][0]
            stages = {item["stage"] for item in ran_for["requested"]}
            # 精读缺 → 只入队精读；批注/题目前置不满足 → 跳过
            self.assertIn("intensive", stages)
            self.assertNotIn("annotation", stages)
            self.assertNotIn("question", stages)
            skipped_reasons = {item["reason"] for item in ran_for["skipped"]}
            self.assertTrue(any(reason.startswith("prereq_missing") for reason in skipped_reasons))

    def test_duplicate_pass_does_not_double_enqueue(self):
        with tempfile.TemporaryDirectory() as directory:
            _, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            update_book(cfg, lecture["id"], book["id"], {"coarse_status": "done"})
            first = scheduler.run_nightly_pass(cfg, usernames=["demo"])
            second = scheduler.run_nightly_pass(cfg, usernames=["demo"])
            first_enqueued = first["ran_for"][0]["requested"]
            self.assertEqual(len(first_enqueued), 1)
            # 第二次：书状态 queued → in_flight 跳过，不再入队
            self.assertEqual(second["ran_for"][0]["requested"], [])

    def test_completion_writes_prep_card_and_decision(self):
        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            update_book(cfg, lecture["id"], book["id"], {"coarse_status": "done"})
            scheduler.run_nightly_pass(cfg, usernames=["demo"])
            state = scheduler.load_state(cfg)
            batch_id = next(iter(state["batches"]))
            self.assertEqual(state["batches"][batch_id]["status"], "running")
            # 模拟阶段完成（真实管线由 worker 完成，测试直接落盘）
            _finish_stages(cfg, lecture["id"], book["id"])
            scheduler._complete_batches(cfg)
            state = scheduler.load_state(cfg)
            batch = state["batches"][batch_id]
            self.assertEqual(batch["status"], "done")
            self.assertTrue(batch["prep_written"])
            self.assertTrue(batch.get("decision_id"))
            self.assertTrue(batch.get("prep_record_id"))
            self.assertNotEqual(batch["decision_id"], batch["prep_record_id"])
            # 时间线里出现 prep 卡 agent_act + 决策器条目
            records = user_store.list_learning_records(cfg, "demo")
            prep_records = [
                row for row in records
                if row.get("type") == "agent_decision" and isinstance(row.get("card"), dict) and row["card"].get("type") == "prep"
            ]
            self.assertEqual(len(prep_records), 1)
            prep = prep_records[0]
            self.assertTrue(prep["unattended"])
            self.assertEqual(prep["card"]["quizCount"], 2)
            self.assertEqual(len(prep["card"]["highlights"]), 2)
            self.assertIn("我昨晚把第一章 梯度下降读完了", prep["text"])
            # 决策器条目存在（夜间 02:00 → agent_hold；本测试用当前墙钟，静默与否取决于运行时刻，
            # 只断言已写入决策条目）
            decision_records = [
                row for row in records
                if row.get("type") == "agent_decision" and row.get("decision_id") == batch["decision_id"]
            ]
            self.assertEqual(len(decision_records), 1)

    def test_prep_run_endpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            update_book(cfg, lecture["id"], book["id"], {"coarse_status": "done"})
            response = app.test_client().post(
                "/api/agent/v1/prep/run",
                headers={"X-Nexora-Username": "demo"},
                json={},
            )
            self.assertEqual(response.status_code, 200)
            body = response.get_json()
            self.assertTrue(body["success"])
            self.assertTrue(body["data"]["ran"])
            ran_for = body["data"]["ran_for"][0]
            self.assertTrue(any(item["stage"] == "intensive" for item in ran_for["requested"]))

    def test_silent_hours_prep_decision_holds_at_0200(self):
        with tempfile.TemporaryDirectory() as directory:
            _, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            update_book(cfg, lecture["id"], book["id"], {"coarse_status": "done"})
            scheduler.run_nightly_pass(cfg, usernames=["demo"])
            _finish_stages(cfg, lecture["id"], book["id"])
            night = int(time.mktime((2026, 9, 16, 2, 0, 0, 0, 0, -1)))
            scheduler._complete_batches(cfg, now=night)
            state = scheduler.load_state(cfg)
            batch = next(iter(state["batches"].values()))
            self.assertEqual(batch["status"], "done")
            records = user_store.list_learning_records(cfg, "demo")
            decision = next(
                row for row in records
                if row.get("type") == "agent_decision" and row.get("decision_id") == batch["decision_id"]
            )
            self.assertFalse(decision["fire"])
            self.assertEqual(decision["suppressed_by"], "silent_hours")
            self.assertEqual(decision["kind"], "agent_hold")


if __name__ == "__main__":
    unittest.main()
