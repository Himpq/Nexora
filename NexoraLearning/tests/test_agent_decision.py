"""B4 主动决策器测试。

验收对应 NEXORA_HARMONYOS_复赛方案.md §4.6：
- 「第 1 章到期 + 第 3 章未收尾 + 21:00」→ fire=true，reason 是一句人话
- 夜间备课完成 → trigger='prep_done'
- 同章节 24h 二次 → suppressedBy='cooldown'；23:30 → 'silent_hours'；免打扰 → 'do_not_disturb'
- 每次调用都在时间线留条目（GET /events）
另有 §6.1 卡片回喂：好 / 晚点 / 不用了（accept/defer/dismiss）。
"""

from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from flask import Flask

from api.agent_facade import agent_facade_bp, init_agent_facade


def _app(tmp_path):
    cfg = {
        "data_dir": str(tmp_path / "data"),
        "runtime_api": {"enabled": True, "api_key": ""},
        "nexora": {"base_url": "http://127.0.0.1:9", "api_key": ""},
        "models": {"default_nexora_model": ""},
        # 本文件验收的是规则地板；模型裁决在 test_agent_judgment.py 单独覆盖。
        "proactive": {"judgment": {"enabled": False}},
    }
    app = Flask(__name__)
    init_agent_facade(cfg)
    app.register_blueprint(agent_facade_bp)
    return app, cfg


def _at(day: int, hour: int, minute: int = 0) -> int:
    return int(time.mktime((2026, 9, day, hour, minute, 0, 0, 0, -1)))


def _target(chapter_index: int, chapter_name: str = "") -> dict:
    return {
        "lecture_id": "l_demo",
        "book_id": "b_demo",
        "chapter_index": chapter_index,
        "chapter_name": chapter_name or f"第 {chapter_index + 1} 章",
    }


def _evaluate(app, *, trigger: str = "", signals: dict | None = None, target: dict | None = None,
              minutes: int | None = None, now: int | None = None):
    payload: dict = {}
    if trigger:
        payload["trigger"] = trigger
    if signals:
        payload["signals"] = signals
    if target:
        payload["target"] = target
    if minutes is not None:
        payload["minutes"] = minutes
    if now is not None:
        payload["now"] = now
    return app.test_client().post(
        "/api/agent/v1/decision",
        headers={"X-Nexora-Username": "demo"},
        json=payload,
    )


def _respond(app, decision_id: str, response: str):
    return app.test_client().post(
        "/api/agent/v1/decision/respond",
        headers={"X-Nexora-Username": "demo"},
        json={"decision_id": decision_id, "response": response},
    )


def _events(app):
    return app.test_client().get("/api/agent/v1/events", headers={"X-Nexora-Username": "demo"}).get_json()


class AgentDecisionTests(unittest.TestCase):
    def test_prep_done_fires_and_logs_agent_act(self):
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            response = _evaluate(
                app,
                trigger="prep_done",
                target=_target(4, "第 5 章 傅里叶变换"),
                minutes=12,
                now=_at(15, 9),
            )
            self.assertEqual(response.status_code, 200)
            decision = response.get_json()["data"]["decision"]
            self.assertTrue(decision["fire"])
            self.assertEqual(decision["kind"], "agent_act")
            self.assertEqual(decision["trigger"], "prep_done")
            self.assertIsNone(decision["suppressed_by"])
            self.assertTrue(decision["text"])
            self.assertTrue(decision["reason"])
            self.assertEqual(decision["card"]["type"], "proactive")
            self.assertEqual(response.get_json()["next_actions"][0]["type"], "open_session")

            entries = _events(app)["data"]["entries"]
            self.assertTrue(any(item["kind"] == "agent_act" and item["unattended"] for item in entries))
            first = next(item for item in entries if item["kind"] == "agent_act")
            self.assertEqual(first["card"]["type"], "proactive")
            self.assertEqual(len(first["actions"]), 3)

    def test_overdue_plus_unfinished_at_21h_fires(self):
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            response = _evaluate(
                app,
                signals={
                    "overdue_days": 1,
                    "unfinished_chapter": {"chapter_name": "第 3 章 卷积"},
                    "est_minutes": 25,
                },
                target=_target(0, "第 1 章 信号"),
                minutes=25,
                now=_at(15, 21),
            )
            decision = response.get_json()["data"]["decision"]
            self.assertTrue(decision["fire"])
            self.assertEqual(decision["trigger"], "forgetting_curve")
            # reason 是一句人话：同时提到到期与未收尾
            self.assertIn("复习", decision["text"])
            self.assertIn("收尾", decision["text"])

    def test_silent_hours_suppress(self):
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            response = _evaluate(app, trigger="prep_done", target=_target(0), now=_at(15, 23, 30))
            decision = response.get_json()["data"]["decision"]
            self.assertFalse(decision["fire"])
            self.assertEqual(decision["kind"], "agent_hold")
            self.assertEqual(decision["suppressed_by"], "silent_hours")
            entries = _events(app)["data"]["entries"]
            self.assertTrue(any(item["kind"] == "agent_hold" for item in entries))

    def test_daily_cap(self):
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            for index in (0, 1, 2):
                response = _evaluate(app, trigger="prep_done", target=_target(index), now=_at(15, 10))
                decision = response.get_json()["data"]["decision"]
                if index < 2:
                    self.assertTrue(decision["fire"], f"chapter {index} should fire")
                else:
                    self.assertFalse(decision["fire"])
                    self.assertEqual(decision["suppressed_by"], "daily_cap")

    def test_cooldown_same_target(self):
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            first = _evaluate(app, trigger="prep_done", target=_target(3), now=_at(15, 10)).get_json()["data"]["decision"]
            self.assertTrue(first["fire"])
            second = _evaluate(app, trigger="prep_done", target=_target(3), now=_at(16, 9)).get_json()["data"]["decision"]
            self.assertFalse(second["fire"])
            self.assertEqual(second["suppressed_by"], "cooldown")

    def test_dismiss_twice_backoff(self):
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            day = 15
            for index in (0, 1):
                decision = _evaluate(app, trigger="prep_done", target=_target(index), now=_at(day, 10)).get_json()["data"]["decision"]
                self.assertTrue(decision["fire"])
                _respond(app, decision["decision_id"], "dismiss")
                day += 1
            third = _evaluate(app, trigger="prep_done", target=_target(2), now=_at(day, 10)).get_json()["data"]["decision"]
            self.assertFalse(third["fire"])
            self.assertEqual(third["suppressed_by"], "backoff")

    def test_defer_retry_once_then_stop(self):
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            first = _evaluate(app, trigger="prep_done", target=_target(0), now=_at(15, 10)).get_json()["data"]["decision"]
            self.assertTrue(first["fire"])
            respond = _respond(app, first["decision_id"], "defer").get_json()["data"]
            self.assertTrue(respond["updated"])
            self.assertIsNotNone(respond["retry_at"])

            too_early = _evaluate(app, trigger="prep_done", target=_target(0), now=_at(15, 10, 10)).get_json()["data"]["decision"]
            self.assertFalse(too_early["fire"])
            self.assertEqual(too_early["suppressed_by"], "defer")

            retry = _evaluate(app, trigger="prep_done", target=_target(0), now=_at(15, 10, 41)).get_json()["data"]["decision"]
            self.assertTrue(retry["fire"])
            self.assertTrue(retry["retry"])

            later = _evaluate(app, trigger="prep_done", target=_target(1), now=_at(16, 10)).get_json()["data"]["decision"]
            self.assertFalse(later["fire"])
            self.assertEqual(later["suppressed_by"], "defer")

    def test_do_not_disturb(self):
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            decision = _evaluate(
                app,
                trigger="prep_done",
                target=_target(0),
                signals={"do_not_disturb": True},
                now=_at(15, 10),
            ).get_json()["data"]["decision"]
            self.assertFalse(decision["fire"])
            self.assertEqual(decision["suppressed_by"], "do_not_disturb")

    def test_low_score_without_signals(self):
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            decision = _evaluate(app, target=_target(0), now=_at(15, 10)).get_json()["data"]["decision"]
            self.assertFalse(decision["fire"])
            self.assertEqual(decision["suppressed_by"], "low_score")

    def test_accept_returns_open_session(self):
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            decision = _evaluate(app, trigger="prep_done", target=_target(0), now=_at(15, 10)).get_json()["data"]["decision"]
            response = _respond(app, decision["decision_id"], "accept")
            body = response.get_json()
            self.assertEqual(response.status_code, 200)
            self.assertTrue(body["data"]["updated"])
            self.assertEqual(body["data"]["status"], "accept")
            self.assertEqual(body["next_actions"][0]["type"], "open_session")

    def test_respond_unknown_decision(self):
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            response = _respond(app, "dec_missing", "accept")
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.get_json()["error"]["code"], "DECISION_NOT_FOUND")


if __name__ == "__main__":
    unittest.main()
