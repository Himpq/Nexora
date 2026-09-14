"""Judgment Loop 测试（重构方案 §二·第一步）。

- 规则放行 + 模型 hold → agent_hold，suppressed_by='judgment'，reason 是模型的话
- 规则放行 + 模型 card → agent_act，channel='card'，text 用模型措辞，context 快照落时间线
- 低分 + 模型 notify → 模型可越过分数门槛（天花板）
- 静默时段 + 模型想说 → 仍 hold（地板），text 写「我本想说…」
- 模型不可用 → 回退到 low_score
- ask-in-context 留痕为 agent_dialog，进入下一次 bundle.dialog
- 反驳带 note → reply 回来且留痕
"""

from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from flask import Flask

from api.agent_facade import agent_facade_bp, init_agent_facade
from core.decision import set_judge_override

USER = {"X-Nexora-Username": "demo"}


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


def _at(day: int, hour: int, minute: int = 0) -> int:
    return int(time.mktime((2026, 9, day, hour, minute, 0, 0, 0, -1)))


def _target(index: int = 0) -> dict:
    return {"lecture_id": "l_demo", "book_id": "b_demo", "chapter_index": index, "chapter_name": f"第 {index + 1} 章"}


def _decide(app, **payload):
    return app.test_client().post("/api/agent/v1/decision", headers=USER, json=payload).get_json()["data"]["decision"]


def _events(app):
    return app.test_client().get("/api/agent/v1/events", headers=USER).get_json()["data"]["entries"]


def _judgment(act: str, one_liner: str = "", reason: str = "模型理由"):
    return {"act": act, "reason": reason, "payload": {"title": one_liner, "one_liner": one_liner, "actions": ["好", "晚点", "不用了"]}, "confidence": 0.8, "hold_until": None}


class JudgmentLoopTests(unittest.TestCase):
    def tearDown(self):
        set_judge_override(None)

    def test_model_hold_overrides_high_score(self):
        seen = {}

        def fake(bundle):
            seen.update(bundle)
            return _judgment("hold", "你 14:00 有考试，我先不打扰。", "日历里 14:00 有期中考")

        set_judge_override(fake)
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            decision = _decide(app, trigger="prep_done", target=_target(), now=_at(15, 10),
                               signals={"calendar": [{"title": "信号与系统 期中考", "start": _at(15, 14)}]})
            self.assertFalse(decision["fire"])
            self.assertEqual(decision["suppressed_by"], "judgment")
            self.assertEqual(decision["channel"], "hold")
            self.assertIn("考试", decision["text"])
            self.assertEqual(decision["reason"], "日历里 14:00 有期中考")
            self.assertEqual(decision["judgment"]["source"], "model")
            # bundle 里能看到日历事件被识别为考试
            self.assertTrue(seen["calendar"][0]["is_exam"])
            self.assertIsNone(seen["hard_block"])
            self.assertEqual(decision["context"]["calendar"][0].endswith("期中考"), True)

    def test_model_card_uses_model_wording_and_context_lands_in_timeline(self):
        set_judge_override(lambda bundle: _judgment("card", "我把卷积讲解提前到今晚。", "你明天有课"))
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            decision = _decide(app, trigger="prep_done", target=_target(), now=_at(15, 10))
            self.assertTrue(decision["fire"])
            self.assertEqual(decision["channel"], "card")
            self.assertEqual(decision["text"], "我把卷积讲解提前到今晚。")
            self.assertEqual(decision["card"]["channel"], "card")
            entry = next(item for item in _events(app) if item["kind"] == "agent_act")
            self.assertEqual(entry["channel"], "card")
            self.assertEqual(entry["judgment"]["source"], "model")
            self.assertEqual(entry["context"]["time"], "2026-09-15 10:00")

    def test_model_can_lift_low_score(self):
        set_judge_override(lambda bundle: _judgment("notify", "你问过三次卷积，现在补十分钟？"))
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            decision = _decide(app, target=_target(), now=_at(15, 10))
            self.assertTrue(decision["fire"])
            self.assertEqual(decision["channel"], "notify")
            self.assertIsNone(decision["suppressed_by"])

    def test_hard_block_wins_but_records_what_it_wanted_to_say(self):
        set_judge_override(lambda bundle: _judgment("card", "第 5 章备好了。", "备课刚完成"))
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            decision = _decide(app, trigger="prep_done", target=_target(), now=_at(15, 2, 10))
            self.assertFalse(decision["fire"])
            self.assertEqual(decision["suppressed_by"], "silent_hours")
            self.assertIn("我本想说", decision["text"])
            self.assertIn("第 5 章备好了", decision["text"])
            self.assertEqual(decision["judgment"]["wanted_to_say"], "第 5 章备好了。")

    def test_model_unavailable_falls_back_to_rules(self):
        set_judge_override(lambda bundle: None)
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            decision = _decide(app, target=_target(), now=_at(15, 10))
            self.assertFalse(decision["fire"])
            self.assertEqual(decision["suppressed_by"], "low_score")
            self.assertEqual(decision["judgment"]["source"], "rules")

    def test_dialog_record_feeds_next_bundle(self):
        captured = {}

        def fake(bundle):
            captured.update(bundle)
            return _judgment("hold")

        set_judge_override(fake)
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            fake_result = {"success": True, "payload": {"choices": [{"message": {"content": "卷积就是翻转平移相乘再积分。"}}]}}
            with mock.patch("api.agent_facade._PROXY") as proxy:
                proxy.complete_raw.return_value = fake_result
                proxy.extract_output_text.return_value = "卷积就是翻转平移相乘再积分。"
                response = app.test_client().post(
                    "/api/agent/v1/ask-in-context", headers=USER,
                    json={"question": "卷积是什么", "source": "xiaoyi", "photo_text": "例 2.3 求 x(t)*h(t)"},
                )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.get_json()["data"]["entry_source"], "xiaoyi")
            dialog_entry = next(item for item in _events(app) if item["kind"] == "agent_msg")
            self.assertIn("在小艺里问我", dialog_entry["reason"])
            _decide(app, target=_target(), now=int(time.time()))
            self.assertEqual(captured["dialog"][-1]["q"], "卷积是什么")
            self.assertEqual(captured["dialog"][-1]["source"], "xiaoyi")

    def test_device_context_report_feeds_bundle(self):
        captured = {}

        def fake(bundle):
            captured.update(bundle)
            return _judgment("hold")

        set_judge_override(fake)
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            now = int(time.time())
            response = app.test_client().post(
                "/api/agent/v1/context/device", headers=USER,
                json={"calendar": [{"title": "线代 期末考", "start": now + 5 * 3600}], "do_not_disturb": False, "scene": "study", "location": "school", "device": "phone"},
            )
            self.assertEqual(response.get_json()["data"]["calendar_count"], 1)
            _decide(app, trigger="prep_done", target=_target(), now=now)
            self.assertEqual(captured["calendar"][0]["title"], "线代 期末考")
            self.assertTrue(captured["calendar"][0]["is_exam"])
            self.assertEqual(captured["location"], "school")
            self.assertEqual(captured["device"]["scene"], "study")
            snapshot = app.test_client().get("/api/agent/v1/judgment/context", headers=USER).get_json()["data"]["bundle"]
            self.assertEqual(snapshot["calendar"][0]["title"], "线代 期末考")

    def test_device_context_dnd_is_hard_block(self):
        set_judge_override(lambda bundle: _judgment("card", "现在开始复习。"))
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            now = _at(3, 12)
            app.test_client().post(
                "/api/agent/v1/context/device", headers=USER,
                json={"do_not_disturb": True, "scene": "sleep", "device": "phone", "now": now},
            )
            decision = _decide(app, trigger="prep_done", target=_target(), now=now)
            self.assertFalse(decision["fire"])
            self.assertEqual(decision["suppressed_by"], "do_not_disturb")
            self.assertIn("免打扰", decision["text"])

    def test_rebuttal_note_returns_reply_and_logs_dialog(self):
        set_judge_override(lambda bundle: _judgment("hold"))
        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            with mock.patch("core.cognition.facets.record_verdict", return_value={"recorded": True}):
                response = app.test_client().post(
                    "/api/agent/v1/cognition/verdict", headers=USER,
                    json={"facet_id": "mastery_c1", "verdict": "disagree", "claim": "你在卷积上还没过", "note": "我上周考了 90 分"},
                )
            body = response.get_json()["data"]
            self.assertTrue(body["reply"]["changed"])
            self.assertIn("90 分", body["reply"]["reply"])
            entry = next(item for item in _events(app) if item["kind"] == "agent_msg")
            self.assertIn("反驳", entry["reason"])


if __name__ == "__main__":
    unittest.main()
