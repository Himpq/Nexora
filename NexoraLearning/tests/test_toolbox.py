"""B5 工具箱适配器测试（服务层 mock，不依赖真实 NexoraDB/NexoraMail）。"""

from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask

from api.agent_facade import agent_facade_bp, init_agent_facade
from core import toolbox
from core import user as user_store
from core.lectures import create_book, create_lecture
from core.user import set_lecture_selection


def _cfg(tmp_path):
    return {
        "data_dir": str(tmp_path / "data"),
        "runtime_api": {"enabled": True, "api_key": ""},
        "nexora": {"base_url": "http://127.0.0.1:9", "api_key": ""},
        "models": {"default_nexora_model": ""},
        "nexoradb": {"service_url": "http://127.0.0.1:8100", "api_key": "k"},
        "nexorasearch": {"service_url": "http://127.0.0.1:8101"},
        "nexora_mail": {"service_url": "http://127.0.0.1:17171"},
    }


class ToolboxTests(unittest.TestCase):
    def test_kb_upsert_and_query_cards(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(Path(directory))
            with patch.object(toolbox, "_http_json", side_effect=[
                {"success": True},
                {"chunks": [{"text": "教材原文片段：傅里叶变换", "source": "db.pdf"}]},
            ]) as mock_http:
                upsert = toolbox.kb_upsert(cfg, "demo", "p1", ["一段资料"])
                self.assertTrue(upsert["ok"])
                self.assertEqual(upsert["card"]["type"], "kbfile")
                query = toolbox.kb_query(cfg, "demo", "p1", "傅里叶变换")
                self.assertTrue(query["ok"])
                self.assertEqual(query["cards"][0]["type"], "citation")
                self.assertIn("傅里叶变换", query["cards"][0]["excerpt"])

    def test_unreachable_service_degrades(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(Path(directory))
            cfg["nexoradb"] = {"service_url": "http://127.0.0.1:9", "api_key": ""}
            result = toolbox.kb_upsert(cfg, "demo", "p1", ["x"])
            self.assertFalse(result["ok"])
            self.assertIn("失败", result["error"])

    def test_web_search_card(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(Path(directory))
            with patch.object(toolbox, "_http_json", return_value={"results": [{"title": "结果1", "url": "http://a", "snippet": "摘要"}]}):
                result = toolbox.web_search(cfg, "demo", "卷积")
                self.assertTrue(result["ok"])
                self.assertEqual(result["card"]["type"], "search")
                self.assertEqual(len(result["card"]["findings"]), 1)

    def test_mail_event_triggers_decision(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(Path(directory))
            lecture = create_lecture(cfg, "课程", status="published")
            set_lecture_selection(cfg, "demo", lecture["id"], selected=True, actor="test")
            mails = [{"from": "老师", "subject": "数据库作业", "body": "本周五截止"}]
            with patch.object(toolbox, "mail_fetch", return_value={"ok": True, "cards": [
                {"type": "mail", "from": "老师", "subject": "数据库作业", "summary": "本周五截止", "dueDate": None},
            ], "detail": {"mails": mails}}):
                first = toolbox.check_mail_events(cfg, "demo")
                self.assertEqual(first["new"], 1)
                second = toolbox.check_mail_events(cfg, "demo")
                self.assertEqual(second["new"], 0)
            records = user_store.list_learning_records(cfg, "demo")
            mail_cards = [
                row for row in records
                if row.get("type") == "agent_decision" and isinstance(row.get("card"), dict) and row["card"].get("type") == "mail"
            ]
            self.assertEqual(len(mail_cards), 1)
            # mail 卡 + 决策器条目各一条
            decisions = [row for row in records if row.get("type") == "agent_decision" and row.get("trigger") == "mail_arrived"]
            self.assertEqual(len(decisions), 2)

    def test_orchestrate_steps_recorded(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(Path(directory))
            with patch.object(toolbox, "mail_fetch", return_value={"ok": True, "cards": [
                {"type": "mail", "from": "老师", "subject": "数据库作业", "summary": "截止周五", "dueDate": None},
            ], "detail": {}}), patch.object(toolbox, "kb_upsert", return_value={"ok": True, "card": {"type": "kbfile", "fileName": "x", "kbName": "default", "chunks": 1}}):
                result = toolbox.orchestrate(cfg, "demo", "把最新作业邮件整理成计划")
                self.assertTrue(result["ok"])
                self.assertGreaterEqual(len(result["steps"]), 2)
            records = user_store.list_learning_records(cfg, "demo")
            tool_steps = [row for row in records if row.get("type") == "agent_decision" and row.get("kind") == "tool_step" and row.get("source") == "toolbox"]
            self.assertGreaterEqual(len(tool_steps), 3)

    def test_facade_endpoints(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(Path(directory))
            app = Flask(__name__)
            init_agent_facade(cfg)
            app.register_blueprint(agent_facade_bp)
            client = app.test_client()
            with patch.object(toolbox, "_http_json", return_value={"chunks": [{"text": "片段", "source": "x"}]}):
                response = client.post(
                    "/api/agent/v1/toolbox/kb-query",
                    headers={"X-Nexora-Username": "demo"},
                    json={"query": "概念"},
                )
                self.assertEqual(response.status_code, 200)
                body = response.get_json()
                self.assertTrue(body["success"])
                self.assertTrue(body["data"]["ok"])
            with patch.object(toolbox, "mail_fetch", return_value={"ok": True, "cards": [], "detail": {}}):
                response2 = client.post(
                    "/api/agent/v1/toolbox/orchestrate",
                    headers={"X-Nexora-Username": "demo"},
                    json={"command": "整理作业"},
                )
                self.assertEqual(response2.status_code, 200)
                self.assertFalse(response2.get_json()["data"]["ok"])


if __name__ == "__main__":
    unittest.main()
