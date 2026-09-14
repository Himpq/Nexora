from __future__ import annotations

import time
import unittest
from unittest.mock import patch

from flask import Flask

from api.agent_facade import agent_facade_bp, init_agent_facade
from core.lectures import create_book, create_lecture, save_book_info_xml, save_book_text
from core.user import set_lecture_selection


def _app(tmp_path, *, api_key: str = ""):
    cfg = {
        "data_dir": str(tmp_path / "data"),
        "runtime_api": {"enabled": True, "api_key": api_key},
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
        "<book><chapter><chapter_name>第一章 梯度下降</chapter_name><chapter_range>0:36</chapter_range></chapter><chapter><chapter_name>第二章 反向传播</chapter_name><chapter_range>36:26</chapter_range></chapter></book>",
    )
    set_lecture_selection(cfg, username, lecture["id"], selected=True, actor="test")
    return lecture, book


class AgentFacadeTests(unittest.TestCase):
    def test_context_requires_username(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(__import__("pathlib").Path(directory))
            response = app.test_client().get("/api/agent/v1/context")
            self.assertEqual(response.status_code, 400)
            body = response.get_json()
            self.assertFalse(body["success"])
            self.assertEqual(body["error"]["code"], "AUTH_REQUIRED")
            self.assertTrue(body["request_id"].startswith("req_"))

    def test_today_returns_daily_brief_and_resumes_open_session(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            from core import user as user_store

            user_store.append_learning_record(
                cfg,
                "demo",
                {"type": "study_time", "lecture_id": lecture["id"], "study_seconds": 900},
            )
            user_store.append_question_completion(
                cfg,
                "demo",
                {"lecture_id": lecture["id"], "book_id": book["id"], "is_correct": True},
            )
            user_store.append_question_completion(
                cfg,
                "demo",
                {"lecture_id": lecture["id"], "book_id": book["id"], "is_correct": False},
            )
            client = app.test_client()

            brief = client.get("/api/agent/v1/today", headers={"X-Nexora-Username": "demo"})
            self.assertEqual(brief.status_code, 200)
            brief_body = brief.get_json()
            self.assertEqual(brief_body["action"], "today")
            self.assertEqual(brief_body["data"]["status"], "ready")
            self.assertEqual(brief_body["data"]["today"]["study_minutes"], 15.0)
            self.assertEqual(brief_body["data"]["today"]["submitted_questions"], 2)
            self.assertEqual(brief_body["data"]["today"]["accuracy"], 0.5)
            self.assertEqual(brief_body["next_actions"][0]["type"], "open_session")

            opened = client.post(
                "/api/agent/v1/open-session",
                headers={"X-Nexora-Username": "demo"},
                json={"lecture_id": lecture["id"], "book_id": book["id"], "chapter_index": 1},
            )
            self.assertEqual(opened.status_code, 200)
            resumed = client.get("/api/agent/v1/today", headers={"X-Nexora-Username": "demo"})
            self.assertEqual(resumed.status_code, 200)
            resumed_body = resumed.get_json()
            self.assertEqual(resumed_body["data"]["status"], "resume")
            self.assertEqual(resumed_body["next_actions"][0]["type"], "resume_session")
            self.assertEqual(resumed_body["data"]["focus"]["chapter_index"], 1)

            other_lecture = create_lecture(cfg, "另一门课程", status="published")
            other_book = create_book(cfg, other_lecture["id"], "另一册教材")
            save_book_text(cfg, other_lecture["id"], other_book["id"], "另一门课程正文")
            set_lecture_selection(cfg, "demo", other_lecture["id"], selected=True, actor="test")
            selected = client.get(
                f"/api/agent/v1/today?lecture_id={other_lecture['id']}",
                headers={"X-Nexora-Username": "demo"},
            )
            self.assertEqual(selected.status_code, 200)
            selected_body = selected.get_json()
            self.assertEqual(selected_body["data"]["status"], "ready")
            self.assertEqual(selected_body["next_actions"][0]["type"], "open_session")
            self.assertEqual(selected_body["data"]["focus"]["lecture_id"], other_lecture["id"])

    def test_external_identifiers_cannot_escape_local_store(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            app, _ = _app(Path(directory))
            response = app.test_client().get(
                "/api/agent/v1/context?username=..%2Foutside",
            )
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.get_json()["error"]["code"], "INVALID_ARGUMENT")


    def test_plan_and_open_session_use_selected_course(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            client = app.test_client()

            planned = client.post(
                "/api/agent/v1/plan",
                json={"username": "demo", "intent": "continue_learning", "available_minutes": 20},
            )
            self.assertEqual(planned.status_code, 200)
            plan_body = planned.get_json()
            self.assertTrue(plan_body["success"])
            self.assertEqual(plan_body["data"]["plan"]["target"]["lecture_id"], lecture["id"])
            self.assertEqual(plan_body["data"]["plan"]["target"]["book_id"], book["id"])
            planned_events = client.get("/api/agent/v1/events", headers={"X-Nexora-Username": "demo"}).get_json()["data"]["entries"]
            self.assertTrue(any(item["kind"] == "user_msg" and item["text"] == "continue_learning" for item in planned_events))
            self.assertTrue(any(item["kind"] == "agent_msg" and item["card"]["type"] == "plan" for item in planned_events))

            opened = client.post(
                "/api/agent/v1/open-session",
                headers={"X-Nexora-Username": "demo"},
                json={"lecture_id": lecture["id"], "book_id": book["id"], "chapter_index": 1},
            )
            self.assertEqual(opened.status_code, 200)
            opened_body = opened.get_json()
            self.assertEqual(opened_body["action"], "open_session")
            self.assertEqual(opened_body["data"]["target"]["chapter_name"], "第二章 反向传播")
            self.assertIn("lecture_id=" + lecture["id"], opened_body["data"]["entry_url"])

            context = client.get(
                "/api/agent/v1/context",
                headers={"X-Nexora-Username": "demo"},
            ).get_json()
            self.assertEqual(
                context["data"]["active_session"]["session_id"],
                opened_body["data"]["session_id"],
            )

            closed = client.post(
                "/api/agent/v1/events",
                headers={"X-Nexora-Username": "demo"},
                json={
                    "event": "session_completed",
                    "event_id": "session-close-1",
                    "session_id": opened_body["data"]["session_id"],
                },
            )
            self.assertEqual(closed.status_code, 200)
            context_after_close = client.get(
                "/api/agent/v1/context",
                headers={"X-Nexora-Username": "demo"},
            ).get_json()
            self.assertEqual(context_after_close["data"]["active_session"], {})

    def test_requested_unselected_course_is_rejected(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            _seed_course(cfg)
            hidden_lecture = create_lecture(cfg, "未授权课程", status="published")
            hidden_book = create_book(cfg, hidden_lecture["id"], "未授权教材")
            save_book_text(cfg, hidden_lecture["id"], hidden_book["id"], "不应被读取的正文")

            client = app.test_client()
            planned = client.post(
                "/api/agent/v1/plan",
                json={"username": "demo", "lecture_id": hidden_lecture["id"], "book_id": hidden_book["id"]},
            )
            self.assertEqual(planned.status_code, 404)

            asked = client.post(
                "/api/agent/v1/ask-in-context",
                json={
                    "username": "demo",
                    "lecture_id": hidden_lecture["id"],
                    "book_id": hidden_book["id"],
                    "question": "教材写了什么？",
                },
            )
            self.assertEqual(asked.status_code, 403)
            self.assertEqual(asked.get_json()["error"]["code"], "PERMISSION_DENIED")

    def test_invalid_chapter_index_is_rejected(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            client = app.test_client()

            out_of_range = client.post(
                "/api/agent/v1/open-session",
                json={
                    "username": "demo",
                    "lecture_id": lecture["id"],
                    "book_id": book["id"],
                    "chapter_index": 99,
                },
            )
            self.assertEqual(out_of_range.status_code, 400)
            self.assertEqual(out_of_range.get_json()["error"]["code"], "INVALID_ARGUMENT")

            invalid_type = client.post(
                "/api/agent/v1/open-session",
                json={
                    "username": "demo",
                    "lecture_id": lecture["id"],
                    "book_id": book["id"],
                    "chapter_index": "not-a-number",
                },
            )
            self.assertEqual(invalid_type.status_code, 400)

    def test_api_key_and_event_idempotency(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory), api_key="secret")
            _seed_course(cfg)
            client = app.test_client()
            missing = client.get("/api/agent/v1/context", headers={"X-Nexora-Username": "demo"})
            self.assertEqual(missing.status_code, 401)
            self.assertEqual(missing.get_json()["error"]["code"], "AUTH_REQUIRED")

            headers = {"X-API-Key": "secret", "X-Nexora-Username": "demo"}
            first = client.post("/api/agent/v1/events", headers=headers, json={"event": "session_started", "event_id": "evt_1"})
            second = client.post("/api/agent/v1/events", headers=headers, json={"event": "session_started", "event_id": "evt_1"})
            self.assertEqual(first.status_code, 200)
            self.assertEqual(second.status_code, 200)
            self.assertFalse(first.get_json()["data"]["duplicate"])
            self.assertTrue(second.get_json()["data"]["duplicate"])

    def test_ask_in_context_uses_requested_chapter(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            save_book_info_xml(
                cfg,
                lecture["id"],
                book["id"],
                "<book><chapter><chapter_name>第一章 梯度下降</chapter_name><chapter_range>0:22</chapter_range></chapter><chapter><chapter_name>第二章 反向传播</chapter_name><chapter_range>22:20</chapter_range></chapter></book>",
            )
            calls = []

            class FakeProxy:
                def complete_raw(self, **kwargs):
                    calls.append(kwargs)
                    return {"success": True, "payload": {"answer": "基于第二章的回答"}}

                def extract_output_text(self, payload):
                    return str(payload.get("answer") or "")

            with patch("api.agent_facade._PROXY", FakeProxy()):
                response = app.test_client().post(
                    "/api/agent/v1/ask-in-context",
                    json={
                        "username": "demo",
                        "lecture_id": lecture["id"],
                        "book_id": book["id"],
                        "chapter_index": 1,
                        "question": "这一章讲了什么？",
                    },
                )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.get_json()["data"]["answer"], "基于第二章的回答")
            self.assertEqual(len(calls), 1)
            prompt = calls[0]["messages"][0]["content"]
            self.assertIn("第二章 反向传播", prompt)
            self.assertNotIn("第一章 梯度下降是一种优化方法", prompt)

    def test_natural_chapter_question_and_dialog_are_persisted(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            calls = []

            class FakeProxy:
                def complete_raw(self, **kwargs):
                    calls.append(kwargs)
                    return {"success": True, "payload": {"answer": "傅里叶变换把信号表示为不同频率正弦波的叠加。"}}

                def extract_output_text(self, payload):
                    return str(payload.get("answer") or "")

            with patch("api.agent_facade._PROXY", FakeProxy()):
                client = app.test_client()
                response = client.post(
                    "/api/agent/v1/ask-in-context",
                    json={
                        "username": "demo",
                        "lecture_id": lecture["id"],
                        "book_id": book["id"],
                        "question": "请用一句话解释第二章的核心概念。",
                    },
                )
                self.assertEqual(response.status_code, 200)
                self.assertIn("学生问题：请用一句话解释第二章的核心概念。", calls[0]["messages"][0]["content"])
                entries = client.get("/api/agent/v1/events", headers={"X-Nexora-Username": "demo"}).get_json()["data"]["entries"]
                self.assertTrue(any(item["kind"] == "user_msg" and "第二章" in item["text"] for item in entries))
                self.assertTrue(any(item["kind"] == "agent_msg" and "傅里叶变换" in item["text"] for item in entries))

    def test_context_refusal_is_retried_with_general_knowledge(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            calls = []

            class FakeProxy:
                def complete_raw(self, **kwargs):
                    calls.append(kwargs)
                    answer = "无法依据上下文回答。" if len(calls) == 1 else "傅里叶变换将信号分解为不同频率成分。"
                    return {"success": True, "payload": {"answer": answer}}

                def extract_output_text(self, payload):
                    return str(payload.get("answer") or "")

            with patch("api.agent_facade._PROXY", FakeProxy()):
                response = app.test_client().post(
                    "/api/agent/v1/ask-in-context",
                    json={
                        "username": "demo",
                        "lecture_id": lecture["id"],
                        "book_id": book["id"],
                        "question": "请解释第二章傅里叶变换。",
                    },
                )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.get_json()["data"]["answer"], "傅里叶变换将信号分解为不同频率成分。")
            self.assertEqual(len(calls), 2)

    def test_fourier_question_has_offline_fallback_when_model_unavailable(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            with patch("api.agent_facade._PROXY", None):
                response = app.test_client().post(
                    "/api/agent/v1/ask-in-context",
                    json={
                        "username": "demo",
                        "lecture_id": lecture["id"],
                        "book_id": book["id"],
                        "question": "请解释傅里叶变换。",
                    },
                )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.get_json()["data"]["source"], "general_knowledge_fallback")

    def test_review_task_is_pollable_and_idempotent(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)

            def fake_quiz(*args, **kwargs):
                return {"quiz_id": "quiz_demo", "questions": [{"question": "x"}]}

            with patch("api.agent_facade.load_or_create_chapter_quiz", fake_quiz):
                client = app.test_client()
                headers = {"X-Nexora-Username": "demo", "Idempotency-Key": "review_1"}
                response = client.post("/api/agent/v1/review-plan", headers=headers, json={"lecture_id": lecture["id"], "book_id": book["id"]})
                self.assertEqual(response.status_code, 200)
                body = response.get_json()
                task_id = body["data"]["task"]["task_id"]
                repeat = client.post("/api/agent/v1/review-plan", headers=headers, json={"lecture_id": lecture["id"], "book_id": book["id"]})
                self.assertEqual(repeat.get_json()["data"]["task"]["task_id"], task_id)

                missing_user = client.get(f"/api/agent/v1/tasks/{task_id}")
                self.assertEqual(missing_user.status_code, 400)
                self.assertEqual(missing_user.get_json()["error"]["code"], "AUTH_REQUIRED")
                wrong_user = client.get(
                    f"/api/agent/v1/tasks/{task_id}",
                    headers={"X-Nexora-Username": "another-user"},
                )
                self.assertEqual(wrong_user.status_code, 403)

                status = ""
                for _ in range(20):
                    polled = client.get(f"/api/agent/v1/tasks/{task_id}", headers={"X-Nexora-Username": "demo"})
                    status = polled.get_json()["data"]["task"]["status"]
                    if status == "completed":
                        break
                    time.sleep(0.01)
                self.assertEqual(status, "completed")

                # Simulate polling on another worker, where the creator's
                # process-local cache does not contain the task.
                from api import agent_facade

                with agent_facade._LOCK:
                    agent_facade._TASKS[task_id]["status"] = "running"
                cross_worker = client.get(
                    f"/api/agent/v1/tasks/{task_id}",
                    headers={"X-Nexora-Username": "demo"},
                )
                self.assertEqual(cross_worker.status_code, 200)
                self.assertEqual(cross_worker.get_json()["data"]["task"]["status"], "completed")

    def test_public_base_url_overrides_request_host_for_deep_links(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            cfg["public_base_url"] = "https://chat.himpqblog.cn:5002"
            lecture, book = _seed_course(cfg)
            response = app.test_client().post(
                "/api/agent/v1/open-session",
                headers={"Host": "chat.himpqblog.cn"},
                json={"username": "demo", "lecture_id": lecture["id"], "book_id": book["id"]},
            )
            self.assertEqual(response.status_code, 200)
            self.assertTrue(
                response.get_json()["data"]["entry_url"].startswith("https://chat.himpqblog.cn:5002/api/frontend/?")
            )

    def test_review_submit_grades_choice_and_short_answer(self):
        import json
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            quiz_id = "chapter_quiz_review_demo"
            quiz_path = Path(cfg["data_dir"]) / "users" / "demo" / "chapter_quizzes" / f"{quiz_id}.json"
            quiz_path.parent.mkdir(parents=True, exist_ok=True)
            quiz_path.write_text(json.dumps({
                "quiz_id": quiz_id,
                "lecture_id": lecture["id"],
                "book_id": book["id"],
                "chapter_index": 0,
                "chapter_name": "第一章 梯度下降",
                "questions": [
                    {
                        "title": "选择题",
                        "content": "哪一项是优化方法",
                        "type": "choice",
                        "options": ["梯度下降", "随机猜测"],
                        "answer": "A",
                        "source_id": "q1",
                    },
                    {
                        "title": "简答题",
                        "content": "数据模型的抽象层次",
                        "type": "text",
                        "options": ["无"],
                        "answer": "概念-逻辑-物理",
                        "source_id": "q2",
                    },
                ],
            }, ensure_ascii=False), encoding="utf-8")
            client = app.test_client()
            response = client.post(
                "/api/agent/v1/review/submit",
                headers={"X-Nexora-Username": "demo"},
                json={
                    "quiz_id": quiz_id,
                    "lecture_id": lecture["id"],
                    "book_id": book["id"],
                    "chapter_index": 0,
                    "chapter_name": "第一章 梯度下降",
                    "answers": [
                        {"question_id": "q1", "answer": "梯度下降"},
                        {"question_id": "q2", "answer": "概念-逻辑-物理三层"},
                    ],
                },
            )
            self.assertEqual(response.status_code, 200)
            body = response.get_json()
            self.assertEqual(body["data"]["score"], "2/2")
            self.assertEqual(body["data"]["correct"], 2)
            entries = client.get("/api/agent/v1/events", headers={"X-Nexora-Username": "demo"}).get_json()["data"]["entries"]
            self.assertTrue(any(item["kind"] == "agent_msg" and "2/2" in item["text"] for item in entries))

    def test_dialog_keeps_long_answers(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            long_answer = "答案" + ("很长的讲解。" * 80)

            class FakeProxy:
                def complete_raw(self, **kwargs):
                    return {"success": True, "payload": {"answer": long_answer}}

                def extract_output_text(self, payload):
                    return str(payload.get("answer") or "")

            with patch("api.agent_facade._PROXY", FakeProxy()):
                client = app.test_client()
                response = client.post(
                    "/api/agent/v1/ask-in-context",
                    json={
                        "username": "demo",
                        "lecture_id": lecture["id"],
                        "book_id": book["id"],
                        "question": "请详细讲",
                    },
                )
            self.assertEqual(response.status_code, 200)
            entries = client.get("/api/agent/v1/events", headers={"X-Nexora-Username": "demo"}).get_json()["data"]["entries"]
            stored = [item["text"] for item in entries if item["kind"] == "agent_msg"]
            self.assertTrue(any(len(text) > 400 for text in stored))
            self.assertTrue(any(long_answer[:200] in text for text in stored))


if __name__ == "__main__":
    unittest.main()
