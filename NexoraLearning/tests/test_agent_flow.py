"""N5 点头即闭环流程测试（方案 §4.5）。

确定性：预设 questions.xml（chapter_quiz 直接读教材题库，不调模型）；
出题线程完成后轮询状态；答题/裁决/超时收敛全链路断言。
"""

from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from flask import Flask

from api.agent_facade import agent_facade_bp, init_agent_facade
from core import user as user_store
from core.agent_flow import (
    expire_flows,
    flow_event,
    flow_state,
    start_flow,
    submit_answers,
    uncertain_verdict,
)
from core.lectures import create_book, create_lecture, save_book_info_xml, save_book_questions_xml, save_book_text
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


def _seed_course(cfg):
    import json

    lecture = create_lecture(cfg, "机器学习入门", status="published")
    book = create_book(cfg, lecture["id"], "教材第一册")
    save_book_text(cfg, lecture["id"], book["id"], "第一章 数据模型\n第二章 傅里叶变换\n")
    save_book_info_xml(
        cfg,
        lecture["id"],
        book["id"],
        "<book><chapter><chapter_name>第一章 数据模型</chapter_name><chapter_range>0:36</chapter_range></chapter>"
        "<chapter><chapter_name>第二章 傅里叶变换</chapter_name><chapter_range>37:26</chapter_range></chapter></book>",
    )
    save_book_questions_xml(
        cfg,
        lecture["id"],
        book["id"],
        "<questions>"
        "<chapter_questions><chapter_range>0:36</chapter_range><question_items>"
        "<question_item><question_title>数据模型的抽象层次</question_title><question_answer>概念-逻辑-物理</question_answer></question_item>"
        "<question_item><question_title>数据模型是什么</question_title><question_answer>抽象表示</question_answer></question_item>"
        "</question_items></chapter_questions>"
        "</questions>",
    )
    # 出题链路（load_or_create_chapter_quiz）需要知识图谱固化产物
    solidified = Path(cfg["data_dir"]) / "lectures" / lecture["id"] / "solidified"
    solidified.mkdir(parents=True, exist_ok=True)
    (solidified / "outline.json").write_text(json.dumps({
        "course_title": "机器学习入门",
        "sections": [
            {"id": "sec_001", "title": "第一章 数据模型", "summary": "", "objectives": [], "key_concepts": ["数据模型"],
             "difficulty": "中等", "estimated_minutes": 30, "prerequisites": [],
             "sources": [{"book_id": book["id"], "chapter_name": "第一章 数据模型"}], "exploration": {}},
            {"id": "sec_002", "title": "第二章 傅里叶变换", "summary": "", "objectives": [], "key_concepts": ["傅里叶变换"],
             "difficulty": "中等", "estimated_minutes": 30, "prerequisites": [],
             "sources": [{"book_id": book["id"], "chapter_name": "第二章 傅里叶变换"}], "exploration": {}},
        ],
    }, ensure_ascii=False), encoding="utf-8")
    (solidified / "mindmap.json").write_text(json.dumps({
        "course_title": "机器学习入门",
        "chapters": [
            {"section_id": "sec_001", "name": "第一章 数据模型", "summary": "",
             "concepts": [{"name": "数据模型", "detail": "数据抽象"}]},
            {"section_id": "sec_002", "name": "第二章 傅里叶变换", "summary": "",
             "concepts": [{"name": "傅里叶变换", "detail": "频域"}]},
        ],
        "relations": [],
    }, ensure_ascii=False), encoding="utf-8")
    set_lecture_selection(cfg, "demo", lecture["id"], selected=True, actor="test")
    return lecture, book


def _qkey(question, index):
    return str(question.get("source_id") or question.get("question_id") or f"q{index}")


class AgentFlowTests(unittest.TestCase):
    def _target(self, lecture, book, chapter_index: int = 0):
        return {
            "lecture_id": lecture["id"],
            "book_id": book["id"],
            "chapter_index": chapter_index,
            "chapter_name": "第一章 数据模型" if chapter_index == 0 else "第二章 傅里叶变换",
            "chapter_range": "0:36" if chapter_index == 0 else "37:26",
        }

    def test_full_chain_reading_done_to_wrapup(self):
        with tempfile.TemporaryDirectory() as directory:
            _, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            target = self._target(lecture, book)

            flow = start_flow(cfg, "demo", target)
            flow_id = flow["flow_id"]
            state = flow_state(cfg, "demo", flow_id)
            self.assertEqual(state["status"], "running")
            self.assertEqual(state["step"], "opened")

            # 读完 → 出题（后台线程，预设题库免模型）
            outcome = flow_event(cfg, "demo", flow_id, "reading_done")
            self.assertNotIn("error", outcome)
            deadline = time.time() + 10
            quiz_status = ""
            while time.time() < deadline:
                state = flow_state(cfg, "demo", flow_id)
                quiz = state.get("quiz") if isinstance(state.get("quiz"), dict) else {}
                quiz_status = str(quiz.get("status") or "")
                if quiz_status in {"completed", "failed"}:
                    break
                time.sleep(0.2)
            self.assertEqual(quiz_status, "completed")
            questions = state["quiz"]["questions"]
            self.assertEqual(len(questions), 2)

            # 作答：第 1 题对、第 2 题留空（→ uncertain）
            answers = [{"question_id": _qkey(questions[0], 0), "answer": questions[0]["answer"]}]
            result = submit_answers(cfg, "demo", flow_id, answers)
            self.assertNotIn("error", result)
            wrapup = result["wrapup"]
            self.assertEqual(wrapup["quizScore"], "1/2")
            self.assertEqual(len(wrapup["uncertain"]), 1)
            self.assertEqual(wrapup["chapter"], "第一章 数据模型")

            state = flow_state(cfg, "demo", flow_id)
            self.assertEqual(state["status"], "done")
            self.assertEqual(state["step"], "wrapup")

            # 时间线出现 wrapup 卡 + tool_step 留痕
            records = user_store.list_learning_records(cfg, "demo")
            wrapup_cards = [
                row for row in records
                if row.get("type") == "agent_decision" and isinstance(row.get("card"), dict) and row["card"].get("type") == "wrapup"
            ]
            self.assertEqual(len(wrapup_cards), 1)
            tool_steps = [row for row in records if row.get("type") == "agent_decision" and row.get("kind") == "tool_step"]
            self.assertGreaterEqual(len(tool_steps), 3)

            # uncertain 裁决回喂（题目含概念名 → 命中概念 → 写证据）
            uncertain_id = wrapup["uncertain"][0]["questionId"]
            verdict = uncertain_verdict(cfg, "demo", flow_id, uncertain_id, "agree")
            self.assertTrue(verdict["updated"])
            self.assertTrue(verdict["evidence_written"])

            # 恢复：flow_state 在「重启」后仍可推导（记录层持久化）
            state2 = flow_state(cfg, "demo", flow_id)
            self.assertEqual(state2["step"], "wrapup")

    def test_expire_after_24h_converges_to_hold(self):
        with tempfile.TemporaryDirectory() as directory:
            _, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            target = self._target(lecture, book)
            now = int(time.time()) - 90000  # 25 小时前
            flow = start_flow(cfg, "demo", target, now=now)
            expired = expire_flows(cfg)
            self.assertEqual(expired, 1)
            state = flow_state(cfg, "demo", flow["flow_id"])
            self.assertEqual(state["step"], "aborted")
            records = user_store.list_learning_records(cfg, "demo")
            holds = [
                row for row in records
                if row.get("type") == "agent_decision" and row.get("kind") == "agent_hold" and row.get("source") == "agent_flow"
            ]
            self.assertEqual(len(holds), 1)
            self.assertIn("没做完", holds[0]["text"])

    def test_facade_endpoints(self):
        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            client = app.test_client()
            target = self._target(lecture, book)
            accepted = client.post(
                "/api/agent/v1/flow/accept",
                headers={"X-Nexora-Username": "demo"},
                json={"target": target},
            )
            self.assertEqual(accepted.status_code, 200)
            flow_id = accepted.get_json()["data"]["flow_id"]

            state = client.get(f"/api/agent/v1/flow/state?flow_id={flow_id}", headers={"X-Nexora-Username": "demo"})
            self.assertEqual(state.status_code, 200)
            self.assertEqual(state.get_json()["data"]["step"], "opened")

            event = client.post(
                "/api/agent/v1/flow/event",
                headers={"X-Nexora-Username": "demo"},
                json={"flow_id": flow_id, "event": "reading_done"},
            )
            self.assertEqual(event.status_code, 200)

            deadline = time.time() + 10
            while time.time() < deadline:
                current = client.get(f"/api/agent/v1/flow/state?flow_id={flow_id}", headers={"X-Nexora-Username": "demo"}).get_json()["data"]
                quiz = current.get("quiz") if isinstance(current.get("quiz"), dict) else {}
                if quiz.get("status") == "completed":
                    break
                time.sleep(0.2)
            current = client.get(f"/api/agent/v1/flow/state?flow_id={flow_id}", headers={"X-Nexora-Username": "demo"}).get_json()["data"]
            questions = current["quiz"]["questions"]
            submitted = client.post(
                "/api/agent/v1/flow/submit",
                headers={"X-Nexora-Username": "demo"},
                json={
                    "flow_id": flow_id,
                    "answers": [{"question_id": _qkey(questions[0], 0), "answer": questions[0]["answer"]}],
                },
            )
            self.assertEqual(submitted.status_code, 200)
            self.assertEqual(submitted.get_json()["data"]["wrapup"]["quizScore"], "1/2")

    def test_accept_respond_starts_flow(self):
        with tempfile.TemporaryDirectory() as directory:
            app, cfg = _app(Path(directory))
            lecture, book = _seed_course(cfg)
            client = app.test_client()
            target = self._target(lecture, book)
            decision = client.post(
                "/api/agent/v1/decision",
                headers={"X-Nexora-Username": "demo"},
                json={"trigger": "prep_done", "target": target, "minutes": 12},
            ).get_json()["data"]["decision"]
            responded = client.post(
                "/api/agent/v1/decision/respond",
                headers={"X-Nexora-Username": "demo"},
                json={"decision_id": decision["decision_id"], "response": "accept"},
            )
            self.assertEqual(responded.status_code, 200)
            actions = responded.get_json()["next_actions"]
            self.assertEqual(actions[0]["type"], "open_session")
            self.assertEqual(actions[1]["type"], "flow")
            flow_id = actions[1]["flow_id"]
            state = client.get(f"/api/agent/v1/flow/state?flow_id={flow_id}", headers={"X-Nexora-Username": "demo"}).get_json()["data"]
            self.assertEqual(state["step"], "opened")


if __name__ == "__main__":
    unittest.main()
