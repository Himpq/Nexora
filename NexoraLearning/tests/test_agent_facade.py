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
            # 按钮值 continue_learning 不是学生原话：不进时间线，也不进记忆。
            self.assertFalse(any(item["kind"] == "user_msg" for item in planned_events))
            self.assertTrue(any(item["kind"] == "agent_msg" and item["card"]["type"] == "plan" for item in planned_events))
            from core.memory.evidence_memory import retrieve_memories
            self.assertEqual(retrieve_memories(cfg, "demo", limit=20), [])

            spoken = client.post(
                "/api/agent/v1/plan",
                json={"username": "demo", "intent": "帮我安排今天的学习", "available_minutes": 20},
            )
            self.assertEqual(spoken.status_code, 200)
            spoken_events = client.get("/api/agent/v1/events", headers={"X-Nexora-Username": "demo"}).get_json()["data"]["entries"]
            self.assertTrue(any(item["kind"] == "user_msg" and item["text"] == "帮我安排今天的学习" for item in spoken_events))
            self.assertEqual(len(retrieve_memories(cfg, "demo", limit=20)), 1)

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

    def test_review_submit_per_question_writes_cognitive_evidence(self):
        """逐题结算：翻牌即结算；未作答看答案按错（revealed_answer 低权重）；三题齐后才出总结；重复结算幂等。"""
        import json
        import tempfile
        from pathlib import Path

        from core.cognition.storage import CognitiveEvidenceStore

        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            solidified = Path(cfg["data_dir"]) / "lectures" / lecture["id"] / "solidified"
            solidified.mkdir(parents=True, exist_ok=True)
            (solidified / "outline.json").write_text(json.dumps({
                "course_title": "机器学习入门",
                "sections": [
                    {"id": "sec_001", "title": "第一章 梯度下降", "summary": "", "objectives": [], "key_concepts": ["梯度下降"],
                     "difficulty": "中等", "estimated_minutes": 30, "prerequisites": [],
                     "sources": [{"book_id": book["id"], "chapter_name": "第一章 梯度下降"}], "exploration": {}},
                ],
            }, ensure_ascii=False), encoding="utf-8")
            (solidified / "mindmap.json").write_text(json.dumps({
                "course_title": "机器学习入门",
                "chapters": [{"section_id": "sec_001", "name": "第一章 梯度下降", "summary": "",
                              "concepts": [{"name": "梯度下降", "detail": ""}, {"name": "学习率", "detail": ""}]}],
                "relations": [],
            }, ensure_ascii=False), encoding="utf-8")
            quiz_id = "chapter_quiz_review_evidence"
            quiz_path = Path(cfg["data_dir"]) / "users" / "demo" / "chapter_quizzes" / f"{quiz_id}.json"
            quiz_path.parent.mkdir(parents=True, exist_ok=True)
            quiz_path.write_text(json.dumps({
                "quiz_id": quiz_id, "lecture_id": lecture["id"], "book_id": book["id"],
                "chapter_index": 0, "chapter_name": "第一章 梯度下降",
                "questions": [
                    {"title": "梯度下降的方向", "content": "梯度下降沿什么方向更新", "type": "choice",
                     "options": ["负梯度", "正梯度"], "answer": "A", "source_id": "q1"},
                    {"title": "学习率过大会怎样", "content": "学习率过大", "type": "choice",
                     "options": ["发散", "收敛更快"], "answer": "A", "source_id": "q2"},
                    {"title": "与本课无关的题", "content": "事务隔离级别", "type": "choice",
                     "options": ["读未提交", "串行化"], "answer": "B", "source_id": "q3"},
                ],
            }, ensure_ascii=False), encoding="utf-8")
            # 云端真实情况：题干不含概念名、题目无 related_concept_id。
            # ① 章名与大纲 sources[].chapter_name 精确对上（同一本书）→ source_ref
            from core.cognition.review_bridge import resolve_concept
            concept, binding = resolve_concept(
                cfg, "demo", {"title": "安装介质挂载位置", "content": "安装前要挂载哪个目录的 iso"},
                question_id="qx", lecture_id=lecture["id"], book_id=book["id"], chapter_index=5,
                chapter_name="第一章 梯度下降",
            )
            self.assertIsNotNone(concept)
            self.assertEqual(binding, "source_ref")
            # ② 另一本书、章名只是相似 → 模糊章名兜底
            concept, binding = resolve_concept(
                cfg, "demo", {"title": "安装介质挂载位置", "content": "安装前要挂载哪个目录的 iso"},
                question_id="qx", lecture_id=lecture["id"], book_id="b_other", chapter_index=5,
                chapter_name="任务1 梯度下降安装服务",
            )
            self.assertIsNotNone(concept)
            self.assertEqual(binding, "chapter_name")
            self.assertIn(concept["name"], {"梯度下降", "学习率"})
            missing, _ = resolve_concept(
                cfg, "demo", {"title": "无关", "content": "无关"},
                question_id="qy", lecture_id=lecture["id"], book_id="b_other", chapter_index=5,
                chapter_name="完全不相干的章",
            )
            self.assertIsNone(missing)
            client = app.test_client()
            headers = {"X-Nexora-Username": "demo"}
            base = {"quiz_id": quiz_id, "lecture_id": lecture["id"], "book_id": book["id"],
                    "chapter_index": 0, "chapter_name": "第一章 梯度下降"}

            first = client.post("/api/agent/v1/review/submit", headers=headers,
                                json={**base, "answers": [{"question_id": "q1", "answer": "负梯度"}]}).get_json()["data"]
            self.assertEqual(first["score"], "1/1")
            self.assertFalse(first["completed"])
            self.assertEqual(first["quiz_settled"], 1)
            self.assertEqual(first["evidence_written"], 1)

            second = client.post("/api/agent/v1/review/submit", headers=headers,
                                 json={**base, "answers": [{"question_id": "q2", "answer": "", "revealed_without_answer": True}]}).get_json()["data"]
            self.assertEqual(second["score"], "0/1")
            self.assertFalse(second["completed"])
            self.assertEqual(second["evidence_written"], 1)

            # 时间线此时不应有总结
            entries = client.get("/api/agent/v1/events", headers=headers).get_json()["data"]["entries"]
            self.assertFalse(any("我做完了" in str(item.get("reason") or "") for item in entries))

            third = client.post("/api/agent/v1/review/submit", headers=headers,
                                json={**base, "answers": [{"question_id": "q3", "answer": "串行化"}]}).get_json()["data"]
            self.assertTrue(third["completed"])
            self.assertEqual(third["quiz_correct"], 2)
            self.assertEqual(third["quiz_total"], 3)
            # q3 题干不含概念名，但章名能对上图谱 → 按章兜底绑定（低置信度），不再静默跳过
            self.assertEqual(third["evidence_written"], 1)
            self.assertTrue(third["items"][0]["concept_id"])
            entries = client.get("/api/agent/v1/events", headers=headers).get_json()["data"]["entries"]
            self.assertTrue(any("2/3" in str(item.get("text") or "") for item in entries))

            # 重复结算 q1：幂等，不再新增 completion / evidence，也不重复总结
            again = client.post("/api/agent/v1/review/submit", headers=headers,
                                json={**base, "answers": [{"question_id": "q1", "answer": "正梯度"}]}).get_json()["data"]
            self.assertTrue(again["items"][0].get("duplicate"))
            self.assertEqual(again["quiz_correct"], 2)

            rows = CognitiveEvidenceStore(cfg).list("demo")
            self.assertEqual(len(rows), 3)
            by_type = {row.evidence_type: row for row in rows}
            # q3 题干不含概念名，但 quiz 的章名「第一章 梯度下降」与大纲 sources 精确对上 → source_ref、0.8
            source_bound = [row for row in rows if row.metadata.get("binding") == "source_ref"]
            self.assertEqual(len(source_bound), 1)
            self.assertEqual(source_bound[0].confidence, 0.8)
            self.assertIn("objective_question", by_type)
            self.assertIn("revealed_answer", by_type)
            self.assertEqual(by_type["revealed_answer"].score, 0.0)
            self.assertTrue(by_type["revealed_answer"].metadata["revealed_without_answer"])

            overview = client.get("/api/agent/v1/cognition/overview", headers=headers).get_json()["data"]
            self.assertGreaterEqual(overview["activity"]["assessed_concepts"], 1)
            statuses = {cell["concept"]: cell["status"] for cell in overview["mastery"]}
            self.assertNotEqual(statuses.get("梯度下降"), "unknown")
            self.assertNotEqual(statuses.get("学习率"), "unknown")

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

    def _write_quiz(self, cfg, lecture, book, quiz_id: str, chapter_index: int = 0, chapter_name: str = "第一章 梯度下降"):
        import json
        from pathlib import Path

        quiz_path = Path(cfg["data_dir"]) / "users" / "demo" / "chapter_quizzes" / f"{quiz_id}.json"
        quiz_path.parent.mkdir(parents=True, exist_ok=True)
        quiz_path.write_text(json.dumps({
            "quiz_id": quiz_id, "lecture_id": lecture["id"], "book_id": book["id"],
            "chapter_index": chapter_index, "chapter_name": chapter_name,
            "questions": [
                {"title": "梯度下降的方向", "content": "梯度下降沿什么方向更新", "type": "choice",
                 "options": ["负梯度", "正梯度"], "answer": "A", "source_id": "q1"},
                {"title": "学习率过大会怎样", "content": "学习率过大", "type": "choice",
                 "options": ["发散", "收敛更快"], "answer": "A", "source_id": "q2"},
            ],
        }, ensure_ascii=False), encoding="utf-8")

    def test_review_submit_attempts_are_isolated_and_score_uses_quiz_origin(self):
        """2026-09-21 审查 P1：① 「再出一组」拿到同一 quiz_id 时，新一轮不能继承上一轮的完成态和成绩；
        ② 端侧换书/换章后提交旧题，成绩归到题组自身的来源，而不是请求里的当前选择。"""
        import tempfile
        from pathlib import Path

        from core import user as user_store

        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            quiz_id = "chapter_quiz_attempts"
            self._write_quiz(cfg, lecture, book, quiz_id)
            client = app.test_client()
            headers = {"X-Nexora-Username": "demo"}
            base = {"quiz_id": quiz_id, "lecture_id": lecture["id"], "book_id": book["id"],
                    "chapter_index": 0, "chapter_name": "第一章 梯度下降"}

            # 第一轮：两题都结算，完成，1/2。
            first = client.post("/api/agent/v1/review/submit", headers=headers, json={
                **base, "attempt_id": "task_round_one",
                "answers": [{"question_id": "q1", "answer": "负梯度"}, {"question_id": "q2", "answer": "收敛更快"}],
            }).get_json()["data"]
            self.assertTrue(first["completed"])
            self.assertEqual(first["quiz_correct"], 1)
            self.assertEqual(first["attempt_id"], "task_round_one")

            # 第二轮：新 attempt 只结算第一题 → 不能因为上一轮已满而 completed，也不能带上一轮的分。
            second = client.post("/api/agent/v1/review/submit", headers=headers, json={
                **base, "attempt_id": "task_round_two",
                "answers": [{"question_id": "q1", "answer": "负梯度"}],
            }).get_json()["data"]
            self.assertFalse(second["completed"])
            self.assertEqual(second["quiz_settled"], 1)
            self.assertEqual(second["quiz_correct"], 1)
            self.assertEqual(second["settled_ids"], ["q1"])
            self.assertFalse(second["items"][0].get("duplicate"))

            # 第二轮把第二题也答对 → 这一轮 2/2，独立于第一轮的 1/2。
            done = client.post("/api/agent/v1/review/submit", headers=headers, json={
                **base, "attempt_id": "task_round_two",
                "answers": [{"question_id": "q2", "answer": "发散"}],
            }).get_json()["data"]
            self.assertTrue(done["completed"])
            self.assertEqual(done["quiz_correct"], 2)
            # 两轮各自入账。
            rows = [row for row in user_store.list_question_completions(cfg, "demo") if row.get("quiz_id") == quiz_id]
            self.assertEqual(len(rows), 4)
            self.assertEqual({row["attempt_id"] for row in rows}, {"task_round_one", "task_round_two"})
            # 时间线两轮各出一次总结。
            entries = client.get("/api/agent/v1/events", headers=headers).get_json()["data"]["entries"]
            summaries = [item for item in entries if "这组题你对了" in str(item.get("text") or "")]
            self.assertEqual(len(summaries), 2)

            # 归属：请求里带另一本书另一章，成绩仍记到题组自己的来源。
            other = client.post("/api/agent/v1/review/submit", headers=headers, json={
                "quiz_id": quiz_id, "attempt_id": "task_round_three",
                "lecture_id": lecture["id"], "book_id": "b_someone_else", "chapter_index": 7, "chapter_name": "别的章",
                "answers": [{"question_id": "q1", "answer": "负梯度"}],
            }).get_json()["data"]
            self.assertEqual(other["book_id"], book["id"])
            self.assertEqual(other["chapter_index"], 0)
            self.assertEqual(other["chapter_name"], "第一章 梯度下降")
            latest = [row for row in user_store.list_question_completions(cfg, "demo") if row.get("attempt_id") == "task_round_three"]
            self.assertEqual(latest[0]["book_id"], book["id"])
            self.assertEqual(latest[0]["chapter_name"], "第一章 梯度下降")

    def test_review_plan_task_carries_attempt_id_and_plan_card_carries_target(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            client = app.test_client()
            headers = {"X-Nexora-Username": "demo"}
            fake_quiz = {"quiz_id": "chapter_quiz_x", "questions": [{"title": "t", "content": "c", "type": "choice",
                                                                       "options": ["a", "b"], "answer": "A", "source_id": "q1"}]}
            with patch("api.agent_facade.load_or_create_chapter_quiz", return_value=fake_quiz):
                created = client.post("/api/agent/v1/review-plan", headers=headers,
                                      json={"lecture_id": lecture["id"], "book_id": book["id"], "chapter_index": 0, "limit": 3})
                task_id = created.get_json()["data"]["task"]["task_id"]
                deadline = time.time() + 5
                result = None
                while time.time() < deadline:
                    task = client.get(f"/api/agent/v1/tasks/{task_id}", headers=headers).get_json()["data"]["task"]
                    if task["status"] in {"completed", "failed"}:
                        result = task
                        break
                    time.sleep(0.05)
            self.assertIsNotNone(result)
            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["result"]["attempt_id"], task_id)
            self.assertEqual(result["result"]["quiz_id"], "chapter_quiz_x")

            # 历史计划卡自带目标。
            plan = client.post("/api/agent/v1/plan", headers=headers,
                               json={"intent": "帮我安排今天的学习", "lecture_id": lecture["id"], "book_id": book["id"], "chapter_index": 1})
            self.assertEqual(plan.status_code, 200)
            entries = client.get("/api/agent/v1/events", headers=headers).get_json()["data"]["entries"]
            cards = [item["card"] for item in entries if item.get("card") and item["card"].get("type") == "plan"]
            self.assertTrue(cards)
            target = cards[-1]["target"]
            self.assertEqual(target["book_id"], book["id"])
            self.assertEqual(target["chapter_index"], 1)
            self.assertEqual(cards[-1]["chapter"], target["chapter_name"])


if __name__ == "__main__":
    unittest.main()
