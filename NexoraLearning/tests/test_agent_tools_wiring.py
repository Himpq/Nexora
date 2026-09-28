"""Conversation tools, durable retries and restored flow state through Flask."""
from __future__ import annotations

import tempfile
import json
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from api import agent_facade
from core import user as user_store
from core.agent_flow import flow_event, flow_state, start_flow, submit_answers
from core.agent_tools import available_minutes, explicit_tool
from core.decision.device_context import load_device_context, save_device_context, merge_into_signals
from core.decision.judgment import _device
from test_agent_flow import _app, _seed_course


class AnswerProxy:
    def __init__(self, responses=None):
        self.responses = list(responses or [])
        self.calls = []

    def complete_raw(self, **kwargs):
        self.calls.append(kwargs)
        return self.responses.pop(0) if self.responses else {"success": True, "payload": {"choices": [{"message": {"content": "已结合记录回答。"}}]}}

    @staticmethod
    def extract_output_text(payload):
        return payload.get("choices", [{}])[0].get("message", {}).get("content", "")


class AgentToolsWiring(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.app, self.cfg = _app(Path(self.directory.name))
        self.lecture, self.book = _seed_course(self.cfg)
        self.target = {"lecture_id": self.lecture["id"], "book_id": self.book["id"], "chapter_index": 0,
                       "chapter_name": "第一章 数据模型", "chapter_range": "0:9"}
        self.client = self.app.test_client()
        self.headers = {"X-Nexora-Username": "demo"}
        for name in ("core.cognition.triggers.schedule_confusion_scan", "core.memory.memory_extract.schedule_extraction"):
            patcher = patch(name, return_value=False)
            patcher.start()
            self.addCleanup(patcher.stop)

    def post(self, path, data):
        return self.client.post("/api/agent/v1/" + path, headers=self.headers, json=data)

    def events(self):
        return self.client.get("/api/agent/v1/events", headers=self.headers).get_json()["data"]["entries"]

    def wait_quiz(self, flow_id):
        for _ in range(200):
            state = flow_state(self.cfg, "demo", flow_id)
            if state.get("quiz", {}).get("status") in {"completed", "failed"}:
                return state
            time.sleep(.005)
        self.fail("quiz thread did not finish")

    def wait_task(self, task_id):
        for _ in range(200):
            result = self.client.get("/api/agent/v1/tasks/" + task_id, headers=self.headers).get_json()["data"]["task"]
            if result["status"] in {"completed", "failed"}:
                return result
            time.sleep(.005)
        self.fail("review task did not finish")

    def test_ask_retry_uses_durable_receipt_and_one_user_message(self):
        proxy = AnswerProxy()
        data = {"question": "解释数据模型", "client_message_id": "client-one", "notes_context": "我的学习随笔", **self.target}
        with patch.object(agent_facade, "_PROXY", proxy):
            first = self.post("ask-in-context", data)
            # Receipt must survive a cleared in-memory facade cache.
            agent_facade._IDEMPOTENT_RESULTS.clear()
            second = self.post("ask-in-context", data)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.get_json(), second.get_json())
        self.assertEqual(len(proxy.calls), 1)
        self.assertIn("我的学习随笔", proxy.calls[0]["messages"][0]["content"])
        messages = [row for row in self.events() if row["kind"] == "user_msg"]
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["client_message_id"], "client-one")
        conflict = self.post("ask-in-context", {**data, "question": "different"})
        self.assertEqual(conflict.status_code, 409)
        self.cfg["runtime_api"]["api_key"] = "now-required"
        self.assertEqual(self.post("ask-in-context", data).status_code, 401)

    def test_model_failure_retries_without_duplicating_user_input(self):
        proxy = AnswerProxy([{"success": False, "message": "temporary failure"}])
        data = {"question": "解释数据模型", "client_message_id": "retry-one", **self.target}
        with patch.object(agent_facade, "_PROXY", proxy):
            self.assertEqual(self.post("ask-in-context", data).status_code, 503)
            self.assertEqual(self.post("ask-in-context", data).status_code, 200)
        self.assertEqual(len(proxy.calls), 2)
        self.assertEqual(len([row for row in self.events() if row["kind"] == "user_msg"]), 1)

    def test_explicit_search_executes_once_and_persists_clickable_card(self):
        card = {"type": "search", "query": "数据模型", "findings": [{"title": "真实资料", "url": "https://example.org/data", "snippet": "摘要"}]}
        with patch("core.toolbox.web_search", return_value={"ok": True, "card": card}) as search, patch.object(agent_facade, "_PROXY", None):
            request = {"question": "帮我联网搜索数据模型", "client_message_id": "search-one"}
            first = self.post("ask-in-context", request).get_json()
            second = self.post("ask-in-context", request).get_json()
        self.assertEqual(first, second)
        self.assertEqual(search.call_count, 1)
        self.assertEqual(search.call_args.args[1], "demo")
        self.assertEqual(first["data"]["cards"], [card])
        self.assertEqual(len([row for row in self.events() if (row.get("card") or {}).get("type") == "search"]), 1)

    def test_model_tool_call_is_executed_and_returned_to_model(self):
        proxy = AnswerProxy([{"success": True, "payload": {"choices": [{"message": {"content": None,
                 "tool_calls": [{"id": "call-1", "type": "function", "function": {"name": "kb_query", "arguments": '{"query":"数据模型","username":"someone_else"}'}}]}}]}}])
        card = {"type": "citation", "book": "笔记", "chapter": "", "excerpt": "资料内容", "anchor": ""}
        with patch.object(agent_facade, "_PROXY", proxy), patch("core.toolbox.kb_query", return_value={"ok": True, "cards": [card]}) as query:
            result = self.post("ask-in-context", {"question": "我之前存过的数据模型资料讲了什么？"}).get_json()
        self.assertTrue(result["data"]["tool_execution"]["ok"])
        self.assertEqual(query.call_args.args[1], "demo")
        self.assertEqual(len(proxy.calls), 2)
        self.assertTrue(any(message["role"] == "tool" for message in proxy.calls[1]["messages"]))

    def test_tool_failure_does_not_claim_success_or_cache_failed_execution(self):
        request = {"question": "帮我联网搜索数据模型", "client_message_id": "search-failed"}
        with patch("core.toolbox.web_search", side_effect=[{"ok": False, "error": "搜索服务不可用"}, {"ok": True, "card": {"type": "search", "query": "数据模型", "findings": []}}]) as search:
            first = self.post("ask-in-context", request).get_json()
            second = self.post("ask-in-context", request).get_json()
        self.assertFalse(first["data"]["tool_execution"]["ok"])
        self.assertIn("不可用", first["data"]["answer"])
        self.assertTrue(second["data"]["tool_execution"]["ok"])
        self.assertEqual(search.call_count, 2)

    def test_partial_tool_retry_preserves_successful_plan_and_review(self):
        def tool_reply(intent):
            return {"success": True, "payload": {"choices": [{"message": {"tool_calls": [
                {"id": "plan", "type": "function", "function": {"name": "plan", "arguments": json.dumps({"intent": intent})}},
                {"id": "review", "type": "function", "function": {"name": "review_plan", "arguments": "{}"}},
                {"id": "search", "type": "function", "function": {"name": "search", "arguments": '{"query":"数据模型"}'}}
            ]}}]}}
        answer = {"success": True, "payload": {"choices": [{"message": {"content": "已处理，搜索结果见卡片。"}}]}}
        proxy = AnswerProxy([tool_reply("继续学20分钟"), answer, tool_reply("从数据模型开始继续学习"), answer])
        request = {"question": "继续帮我处理刚才的事情", "client_message_id": "partial-retry", **self.target}
        with patch.object(agent_facade, "_PROXY", proxy), patch("core.toolbox.web_search", side_effect=[
            {"ok": False, "error": "暂时不可用"}, {"ok": True, "card": {"type": "search", "findings": []}}
        ]) as search:
            first = self.post("ask-in-context", request).get_json()
            task_id = next(card["taskId"] for card in first["data"]["cards"] if card["type"] == "quiz")
            self.wait_task(task_id)
            agent_facade._IDEMPOTENT_RESULTS.clear()
            second = self.post("ask-in-context", request).get_json()
        self.assertFalse(first["data"]["tool_execution"]["ok"])
        self.assertTrue(second["data"]["tool_execution"]["ok"])
        self.assertEqual(search.call_count, 2)
        self.assertEqual(next(card["taskId"] for card in second["data"]["cards"] if card["type"] == "quiz"), task_id)
        plans = [row for row in user_store.list_learning_records(self.cfg, "demo") if row.get("type") == "agent_plan_response"]
        self.assertEqual(len(plans), 1)
        self.assertEqual(len(list((Path(self.cfg["data_dir"]) / "agent_tasks").glob("*.json"))), 1)

    def test_partial_orchestration_retry_preserves_completed_stages(self):
        request = {"question": "把最新邮件安排成二十分钟学习计划，并将正文存入知识库", "client_message_id": "mail-partial", **self.target}
        original = agent_facade._create_tool_review
        attempts = []
        def review(username, target):
            attempts.append(True)
            if len(attempts) == 1:
                raise RuntimeError("review temporarily unavailable")
            return original(username, target)
        mail = {"type": "mail", "mailId": "m1", "subject": "作业", "content": "full homework"}
        with patch.object(agent_facade, "_create_tool_review", side_effect=review), \
             patch("core.toolbox.mail_fetch", return_value={"ok": True, "cards": [mail]}) as fetch, \
             patch("core.toolbox.kb_upsert", return_value={"ok": True}) as upsert:
            first = self.post("ask-in-context", request).get_json()
            second = self.post("ask-in-context", request).get_json()
        self.assertFalse(first["data"]["tool_execution"]["ok"])
        self.assertTrue(second["data"]["tool_execution"]["ok"])
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(upsert.call_count, 1)
        plans = [row for row in user_store.list_learning_records(self.cfg, "demo") if row.get("type") == "agent_plan_response"]
        self.assertEqual(len(plans), 1)
        task_id = next(card["taskId"] for card in second["data"]["cards"] if card["type"] == "quiz")
        self.assertEqual(self.wait_task(task_id)["status"], "completed")

    def test_interrupted_review_and_flow_are_retryable_after_restart(self):
        task_id = "task_interrupted"
        agent_facade._save_task({"task_id": task_id, "type": "review_plan", "user_id": "demo", "status": "running"})
        agent_facade._TASKS.clear()
        task = self.client.get("/api/agent/v1/tasks/" + task_id, headers=self.headers).get_json()["data"]["task"]
        self.assertEqual(task["status"], "failed")
        self.assertTrue(task["retryable"])
        self.assertEqual(task["error"]["code"], "TASK_INTERRUPTED")
        started = start_flow(self.cfg, "demo", self.target)
        user_store.append_learning_record(self.cfg, "demo", {"type": "agent_flow_quiz", "flow_id": started["flow_id"],
            "task_id": "task_flow_interrupted", "quiz": {"status": "queued", "questions": []}, "timestamp": int(time.time())})
        restored = self.client.get("/api/agent/v1/today", headers=self.headers).get_json()["data"]["active_flow"]
        self.assertEqual(restored["quiz"]["status"], "failed")
        self.assertTrue(restored["quiz"]["retryable"])
        resumed = flow_event(self.cfg, "demo", started["flow_id"], "reading_done")
        self.assertFalse(resumed.get("duplicate", False))
        self.assertEqual(self.wait_quiz(started["flow_id"])["quiz"]["status"], "completed")

    def test_read_only_mail_mentions_do_not_turn_into_write_or_plan_requests(self):
        for text in ("帮我查询知识库里提到的邮件", "帮我查看知识库里的邮件"):
            self.assertEqual(explicit_tool(text)["name"], "kb_query")
        self.assertEqual(explicit_tool("读取最新邮件")["name"], "mail")
        proxy = AnswerProxy([{"success": True, "payload": {"choices": [{"message": {"tool_calls": [
            {"id": "bad-call", "type": "function", "function": {"name": "kb_upsert", "arguments": '{"text":"must not be saved"}'}}
        ]}}]}}])
        with patch.object(agent_facade, "_PROXY", proxy), patch("core.toolbox.kb_upsert") as upsert:
            result = self.post("ask-in-context", {"question": "不要保存到知识库，只解释这个概念"}).get_json()
        upsert.assert_not_called()
        self.assertFalse(result["data"]["tool_execution"]["ok"])

    def test_plan_respects_chinese_time_and_is_idempotent(self):
        request = {"intent": "帮我安排二十分钟的学习计划", "client_message_id": "plan-one"}
        first = self.post("plan", request).get_json()
        self.assertEqual(first["data"]["plan"]["estimated_minutes"], 20)
        self.assertEqual(first, self.post("plan", request).get_json())
        explicit = self.post("plan", {"intent": "学习半小时", "available_minutes": 12}).get_json()
        self.assertEqual(explicit["data"]["plan"]["available_minutes"], 12)
        self.assertEqual(available_minutes("学习1.5小时"), 90)

    def test_conversation_review_and_mail_orchestration_create_real_tasks(self):
        direct = self.post("ask-in-context", {"question": "给我出三道复习题", **self.target}).get_json()
        task_id = direct["data"]["cards"][0]["taskId"]
        self.assertEqual(self.wait_task(task_id)["status"], "completed")
        mail_card = {"type": "mail", "mailId": "m1", "from": "teacher", "subject": "作业", "summary": "preview", "content": "full homework"}
        with patch("core.toolbox.mail_fetch", return_value={"ok": True, "cards": [mail_card]}), patch("core.toolbox.kb_upsert", return_value={"ok": True, "card": {"type": "kbfile", "fileName": "邮件正文", "kbName": "default", "chunks": 1}}) as upsert:
            result = self.post("toolbox/orchestrate", {"command": "把最新邮件安排成二十分钟学习计划，并将正文存入知识库"}).get_json()
        self.assertTrue(result["data"]["ok"])
        self.assertIn("full homework", upsert.call_args.args[3][0])
        self.assertEqual(result["data"]["plan"]["available_minutes"], 20)
        self.assertEqual(self.wait_task(result["data"]["task_id"])["status"], "completed")
        self.assertEqual(result["next_actions"][0]["type"], "review_task")

    def test_today_restores_active_flow_and_uncertain_updates_all_surfaces(self):
        started = start_flow(self.cfg, "demo", self.target)
        today = self.client.get("/api/agent/v1/today", headers=self.headers).get_json()["data"]
        self.assertEqual(today["active_flow"]["flow_id"], started["flow_id"])
        self.assertEqual(today["active_flow"]["step"], "opened")
        flow_event(self.cfg, "demo", started["flow_id"], "reading_done")
        state = self.wait_quiz(started["flow_id"])
        result = submit_answers(self.cfg, "demo", started["flow_id"], [])
        qid = result["wrapup"]["uncertain"][0]["questionId"]
        verdict = self.post("flow/uncertain", {"flow_id": started["flow_id"], "question_id": qid, "verdict": "agree"}).get_json()["data"]
        self.assertEqual(len(verdict["state"]["wrapup"]["uncertain"]), len(result["wrapup"]["uncertain"]) - 1)
        completion = next(row for row in user_store.list_question_completions(self.cfg, "demo") if row["question_id"] == qid)
        self.assertIs(completion["is_correct"], True)
        wrapup_card = next(row["card"] for row in self.events() if (row.get("card") or {}).get("type") == "wrapup")
        self.assertNotIn(qid, [row["questionId"] for row in wrapup_card["uncertain"]])
        again = self.post("flow/uncertain", {"flow_id": started["flow_id"], "question_id": qid, "verdict": "agree"}).get_json()["data"]
        self.assertTrue(again["duplicate"])
        today = self.client.get("/api/agent/v1/today", headers=self.headers).get_json()["data"]
        self.assertIsNone(today["active_flow"])
        self.assertEqual(today["active_session"], {})

    def test_flow_cannot_start_for_another_users_course(self):
        response = self.client.post("/api/agent/v1/flow/accept", headers={"X-Nexora-Username": "other"}, json={"target": self.target})
        self.assertEqual(response.status_code, 404)

    def test_device_unknown_dnd_and_newest_sample_are_preserved(self):
        save_device_context(self.cfg, "demo", {"scene": "app_background", "sampled_at_ms": 2002, "dnd_status": "unavailable"}, now=2)
        save_device_context(self.cfg, "demo", {"scene": "app_foreground", "sampled_at_ms": 2001}, now=2)
        stored = load_device_context(self.cfg, "demo", now=3)
        self.assertEqual(stored["scene"], "app_background")
        self.assertIsNone(stored["do_not_disturb"])
        self.assertEqual(stored["dnd_status"], "unavailable")
        self.assertIsNone(_device({})["do_not_disturb"])
        save_device_context(self.cfg, "demo", {"do_not_disturb": False, "sampled_at_ms": 2003}, now=2)
        signals = merge_into_signals(self.cfg, "demo", {}, now=3)
        self.assertIs(_device(signals)["do_not_disturb"], False)


if __name__ == "__main__":
    unittest.main()
