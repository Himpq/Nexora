"""B3 困惑地图归因测试（方案 §4.3）。

确定性构造 telemetry（reading 流）+ 错题 + 概念目录（outline/mindmap 固化文件），
断言四类信号权重、超阈判定、证据幂等与 confusion 卡落盘。
"""

from __future__ import annotations

import json
import tempfile
import time
import unittest
from pathlib import Path

from flask import Flask

from api.agent_facade import agent_facade_bp, init_agent_facade
from api.telemetry import ingest_batch, init_telemetry
from core import user as user_store
from core.booksproc import scheduler
from core.cognition.attribution import scan_confusion
from core.cognition.storage import CognitiveEvidenceStore
from core.lectures import create_book, create_lecture, save_book_info_xml, save_book_text
from core.user import set_lecture_selection


def _seed_course(cfg, username: str = "demo"):
    lecture = create_lecture(cfg, "机器学习入门", status="published")
    book = create_book(cfg, lecture["id"], "教材第一册")
    save_book_text(cfg, lecture["id"], book["id"], "第一章 数据模型\n第二章 傅里叶变换与卷积\n")
    save_book_info_xml(
        cfg,
        lecture["id"],
        book["id"],
        "<book><chapter><chapter_name>第一章 数据模型</chapter_name><chapter_range>0:36</chapter_range></chapter>"
        "<chapter><chapter_name>第二章 傅里叶变换与卷积</chapter_name><chapter_range>36:26</chapter_range></chapter></book>",
    )
    set_lecture_selection(cfg, username, lecture["id"], selected=True, actor="test")
    return lecture, book


def _write_solidified(cfg, lecture_id, book_id):
    """概念目录数据源：outline.json + mindmap.json（与 seed_demo 同构）。"""
    solidified = Path(cfg["data_dir"]) / "lectures" / lecture_id / "solidified"
    solidified.mkdir(parents=True, exist_ok=True)
    outline = {
        "course_title": "机器学习入门",
        "course_summary": "",
        "course_long_summary": "",
        "learning_objectives": [],
        "learning_tasks": [],
        "sections": [
            {
                "id": "sec_001",
                "title": "第一章 数据模型",
                "summary": "",
                "objectives": [],
                "key_concepts": ["数据模型"],
                "difficulty": "中等",
                "estimated_minutes": 30,
                "prerequisites": [],
                "sources": [{"book_id": book_id, "chapter_name": "第一章 数据模型"}],
                "exploration": {},
            },
            {
                "id": "sec_002",
                "title": "第二章 傅里叶变换与卷积",
                "summary": "",
                "objectives": [],
                "key_concepts": ["傅里叶变换", "卷积"],
                "difficulty": "中等",
                "estimated_minutes": 30,
                "prerequisites": [],
                "sources": [{"book_id": book_id, "chapter_name": "第二章 傅里叶变换与卷积"}],
                "exploration": {},
            },
        ],
    }
    mindmap = {
        "course_title": "机器学习入门",
        "chapters": [
            {
                "section_id": "sec_001",
                "name": "第一章 数据模型",
                "summary": "",
                "concepts": [{"name": "数据模型", "detail": "数据抽象"}],
            },
            {
                "section_id": "sec_002",
                "name": "第二章 傅里叶变换与卷积",
                "summary": "",
                "concepts": [
                    {"name": "傅里叶变换", "detail": "时域到频域"},
                    {"name": "卷积", "detail": "线性系统输出"},
                ],
            },
        ],
        "relations": [
            {"from": "卷积", "to": "傅里叶变换", "type": "prerequisite"},
        ],
    }
    (solidified / "outline.json").write_text(json.dumps(outline, ensure_ascii=False), encoding="utf-8")
    (solidified / "mindmap.json").write_text(json.dumps(mindmap, ensure_ascii=False), encoding="utf-8")


class ConfusionAttributionTests(unittest.TestCase):
    def _setup(self, directory):
        cfg = {
            "data_dir": str(Path(directory) / "data"),
            "runtime_api": {"enabled": True, "api_key": ""},
            "nexora": {"base_url": "http://127.0.0.1:9", "api_key": ""},
            "models": {"default_nexora_model": ""},
        }
        lecture, book = _seed_course(cfg)
        _write_solidified(cfg, lecture["id"], book["id"])
        init_telemetry(cfg)
        return cfg, lecture, book

    def test_attribution_weights_and_threshold(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg, lecture, book = self._setup(directory)
            now = int(time.time())
            ingest_batch("demo", [
                {"stream": "reading", "event": "selection", "bid": book["id"], "ci": 1, "si": 0, "sel_text": "傅里叶变换把信号变换到频域", "ts": now - 600},
                {"stream": "reading", "event": "selection", "bid": book["id"], "ci": 1, "si": 1, "sel_text": "再划一次傅里叶变换", "ts": now - 500},
                {"stream": "reading", "event": "ask", "bid": book["id"], "ci": 1, "si": 0, "sel_text": "傅里叶变换和卷积是什么关系？", "focus": "chat", "ts": now - 400},
                {"stream": "reading", "event": "focus_out", "bid": book["id"], "ci": 1, "si": 0, "focus": "blur", "ts": now - 300},
            ])
            user_store.append_question_completion(cfg, "demo", {
                "lecture_id": lecture["id"], "book_id": book["id"], "chapter_index": 1,
                "question_title": "傅里叶变换的物理意义", "is_correct": False, "timestamp": now - 200,
            })
            user_store.append_question_completion(cfg, "demo", {
                "lecture_id": lecture["id"], "book_id": book["id"], "chapter_index": 0,
                "question_title": "事务的隔离级别有哪些", "is_correct": False, "timestamp": now - 100,
            })

            result = scan_confusion(cfg, "demo", now=now)
            self.assertTrue(result["ran"])
            rows = {row["concept"]: row for row in result["results"]}

            fourier = rows["傅里叶变换"]
            # selection 2×1.0 + ask 1.5 + idle 0.5 + wrong 2.0 = 6.0
            self.assertAlmostEqual(fourier["score"], 6.0, places=1)
            self.assertTrue(fourier["confused"])
            self.assertEqual(fourier["breakdown"]["selection"], 2)
            self.assertEqual(fourier["breakdown"]["ask"], 1)
            self.assertEqual(fourier["breakdown"]["idle"], 1)
            self.assertEqual(fourier["breakdown"]["wrong"], 1)

            conv = rows["卷积"]
            # ask 1.5 + idle 0.5 = 2.0 < 3.0 → 不产卡（无噪音）
            self.assertAlmostEqual(conv["score"], 2.0, places=1)
            self.assertFalse(conv["confused"])

            # 无关错题（事务）不归因到任何概念
            self.assertNotIn("事务", rows)

            # 时间线出现 confusion 卡（agent_act）+ 决策器条目
            records = user_store.list_learning_records(cfg, "demo")
            confusion_cards = [
                row for row in records
                if row.get("type") == "agent_decision" and isinstance(row.get("card"), dict) and row["card"].get("type") == "confusion"
            ]
            self.assertEqual(len(confusion_cards), 1)
            card = confusion_cards[0]["card"]
            self.assertEqual(card["concept"], "傅里叶变换")
            self.assertEqual(card["hitCount"], 5)
            decision_records = [
                row for row in records
                if row.get("type") == "agent_decision"
                and row.get("trigger") == "confusion_spike"
                and row.get("source") != "confusion_scan"
            ]
            self.assertEqual(len(decision_records), 1)

            # 证据落盘（exposure + objective_question）
            store = CognitiveEvidenceStore(cfg)
            evidence = store.list("demo")
            kinds = {row.evidence_type for row in evidence}
            self.assertIn("exposure", kinds)
            self.assertIn("objective_question", kinds)

    def test_rescan_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg, lecture, book = self._setup(directory)
            now = int(time.time())
            ingest_batch("demo", [
                {"stream": "reading", "event": "selection", "bid": book["id"], "ci": 1, "si": 0, "sel_text": "傅里叶变换", "ts": now - 600},
                {"stream": "reading", "event": "selection", "bid": book["id"], "ci": 1, "si": 1, "sel_text": "傅里叶变换再划线", "ts": now - 500},
                {"stream": "reading", "event": "ask", "bid": book["id"], "ci": 1, "si": 0, "sel_text": "傅里叶变换怎么理解？", "ts": now - 400},
            ])
            first = scan_confusion(cfg, "demo", now=now)
            second = scan_confusion(cfg, "demo", now=now)
            # 首次：confusion 卡 + 决策器条目 = 2；重扫：0（幂等不重复写）
            self.assertEqual(first["cards_written"], 2)
            self.assertEqual(second["cards_written"], 0)
            self.assertEqual(second["evidence_written"], 0)
            records = user_store.list_learning_records(cfg, "demo")
            confusion_cards = [
                row for row in records
                if row.get("type") == "agent_decision" and isinstance(row.get("card"), dict) and row["card"].get("type") == "confusion"
            ]
            self.assertEqual(len(confusion_cards), 1)

    def test_scan_endpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg, lecture, book = self._setup(directory)
            app = Flask(__name__)
            init_agent_facade(cfg)
            app.register_blueprint(agent_facade_bp)
            now = int(time.time())
            ingest_batch("demo", [
                {"stream": "reading", "event": "selection", "bid": book["id"], "ci": 1, "si": 0, "sel_text": "傅里叶变换", "ts": now - 600},
                {"stream": "reading", "event": "selection", "bid": book["id"], "ci": 1, "si": 1, "sel_text": "傅里叶变换", "ts": now - 500},
                {"stream": "reading", "event": "ask", "bid": book["id"], "ci": 1, "si": 0, "sel_text": "傅里叶变换是什么？", "ts": now - 400},
            ])
            response = app.test_client().post(
                "/api/agent/v1/confusion/scan",
                headers={"X-Nexora-Username": "demo"},
                json={},
            )
            self.assertEqual(response.status_code, 200)
            body = response.get_json()
            self.assertTrue(body["success"])
            self.assertTrue(body["data"]["ran"])
            self.assertTrue(any(row["confused"] for row in body["data"]["results"]))


if __name__ == "__main__":
    unittest.main()
