"""面二 facets / 反驳回喂、N4 briefing、B2 prereq 测试。"""

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
from core.cognition.facets import build_facets, record_verdict
from core.cognition.prereq import check_prereq
from core.cognition.service import CognitionService
from core.cognition.storage import CognitiveEvidenceStore
from core.lectures import create_book, create_lecture, save_book_info_xml, save_book_text
from core.user import set_lecture_selection


def _cfg(tmp_path):
    return {
        "data_dir": str(tmp_path / "data"),
        "runtime_api": {"enabled": True, "api_key": ""},
        "nexora": {"base_url": "http://127.0.0.1:9", "api_key": ""},
        "models": {"default_nexora_model": ""},
    }


def _seed_course(cfg, title, book_title, chapters, concepts, username="demo"):
    lecture = create_lecture(cfg, title, status="published")
    book = create_book(cfg, lecture["id"], book_title)
    text = "\n".join(name + "\n" + name + "的定义与例题。" for name in chapters)
    save_book_text(cfg, lecture["id"], book["id"], text)
    xml_blocks = []
    offset = 0
    for name in chapters:
        xml_blocks.append(f"<chapter><chapter_name>{name}</chapter_name><chapter_range>{offset}:36</chapter_range></chapter>")
        offset += 37
    save_book_info_xml(cfg, lecture["id"], book["id"], f"<book>{''.join(xml_blocks)}</book>")
    set_lecture_selection(cfg, username, lecture["id"], selected=True, actor="test")

    sections = []
    chapters_tree = []
    for index, name in enumerate(chapters):
        section_concepts = concepts.get(index, [])
        sections.append({
            "id": f"sec_{index + 1:03d}",
            "title": name,
            "summary": "",
            "objectives": [],
            "key_concepts": [item["name"] for item in section_concepts],
            "difficulty": "中等",
            "estimated_minutes": 30,
            "prerequisites": [],
            "sources": [{"book_id": book["id"], "chapter_name": name}],
            "exploration": {},
        })
        chapters_tree.append({
            "section_id": f"sec_{index + 1:03d}",
            "name": name,
            "summary": "",
            "concepts": [{"name": item["name"], "detail": item["detail"]} for item in section_concepts],
        })
    solidified = Path(cfg["data_dir"]) / "lectures" / lecture["id"] / "solidified"
    solidified.mkdir(parents=True, exist_ok=True)
    (solidified / "outline.json").write_text(json.dumps({"course_title": title, "sections": sections}, ensure_ascii=False), encoding="utf-8")
    (solidified / "mindmap.json").write_text(json.dumps({"course_title": title, "chapters": chapters_tree, "relations": []}, ensure_ascii=False), encoding="utf-8")
    return lecture, book


def _concept_ids(cfg, lecture_id):
    service = CognitionService(cfg)
    return {row["name"]: row for row in service.get_catalog(lecture_id)["concepts"]}


class FacetsPrereqBriefingTests(unittest.TestCase):
    def test_facets_from_confusion_and_verdict_loop(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(Path(directory))
            lecture, book = _seed_course(
                cfg, "机器学习", "教材一", ["第一章 数据模型", "第二章 傅里叶变换"],
                {0: [{"name": "数据模型", "detail": "抽象"}], 1: [{"name": "傅里叶变换", "detail": "频域"}]},
            )
            init_telemetry(cfg)
            now = int(time.time())
            ingest_batch("demo", [
                {"stream": "reading", "event": "selection", "bid": book["id"], "ci": 1, "si": 0, "sel_text": "傅里叶变换", "ts": now - 400},
                {"stream": "reading", "event": "selection", "bid": book["id"], "ci": 1, "si": 1, "sel_text": "傅里叶变换再看", "ts": now - 300},
                {"stream": "reading", "event": "ask", "bid": book["id"], "ci": 1, "si": 0, "sel_text": "傅里叶变换是什么？", "ts": now - 200},
            ])
            from core.cognition.attribution import scan_confusion

            scan_confusion(cfg, "demo", now=now)
            overview = build_facets(cfg, "demo")
            facets = overview["facets"]
            confusion_facets = [row for row in facets if row["claim"].startswith("你在傅里叶变换上卡过")]
            self.assertEqual(len(confusion_facets), 1)
            facet = confusion_facets[0]
            self.assertTrue(len(facet["evidence"]) >= 3)
            self.assertIsNone(facet["userVerdict"])

            # 反驳 → review 证据（score 0）→ userVerdict 即时可见
            verdict = record_verdict(cfg, "demo", facet["id"], "disagree", lecture_id=facet["lectureId"], book_id=facet["bookId"], concept_id=facet["conceptId"])
            self.assertTrue(verdict["updated"])
            overview2 = build_facets(cfg, "demo")
            facet2 = next(row for row in overview2["facets"] if row["id"] == facet["id"])
            self.assertEqual(facet2["userVerdict"], "disagree")

            # disagree 后掌握度被拉低 → 出现 mastery 判断
            self.assertTrue(any(row["claim"].startswith("你在傅里叶变换上掌握度") for row in overview2["facets"]))

    def test_briefing_from_confusion_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(Path(directory))
            lecture, book = _seed_course(
                cfg, "机器学习", "教材一", ["第一章 数据模型", "第二章 傅里叶变换"],
                {0: [{"name": "数据模型", "detail": "抽象"}], 1: [{"name": "傅里叶变换", "detail": "频域"}]},
            )
            init_telemetry(cfg)
            now = int(time.time())
            ingest_batch("demo", [
                {"stream": "reading", "event": "selection", "bid": book["id"], "ci": 1, "si": 0, "sel_text": "傅里叶变换", "ts": now - 400},
                {"stream": "reading", "event": "selection", "bid": book["id"], "ci": 1, "si": 1, "sel_text": "傅里叶变换", "ts": now - 300},
                {"stream": "reading", "event": "ask", "bid": book["id"], "ci": 1, "si": 0, "sel_text": "傅里叶变换怎么理解？", "ts": now - 200},
            ])
            from core.cognition.attribution import scan_confusion

            scan_confusion(cfg, "demo", now=now)
            targets = [{
                "lecture_id": lecture["id"],
                "book_id": book["id"],
                "chapter_index": 1,
                "chapter_name": "第二章 傅里叶变换",
                "chapter_range": "37:36",
            }]
            briefing = scheduler._briefing_for(cfg, "demo", targets)
            self.assertIsNotNone(briefing)
            self.assertEqual(briefing["concept"], "傅里叶变换")
            self.assertGreaterEqual(briefing["hitCount"], 3)
            self.assertEqual(briefing["minutes"], 3)
            self.assertIn("offset", briefing["anchor"])

            # 无 N3 数据 → None
            empty = scheduler._briefing_for(cfg, "nobody", targets)
            self.assertIsNone(empty)

    def test_prereq_gap_across_courses(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(Path(directory))
            _seed_course(
                cfg, "数据库导论", "数据库教材",
                ["第一章 数据模型", "第二章 傅里叶变换"],
                {0: [{"name": "数据模型", "detail": "抽象"}], 1: [{"name": "傅里叶变换", "detail": "频域"}]},
            )
            lecture_b, book_b = _seed_course(
                cfg, "信号与系统", "信号教材",
                ["第一章 信号", "第二章 傅里叶变换"],
                {0: [{"name": "信号", "detail": "函数"}], 1: [{"name": "傅里叶变换", "detail": "频域"}]},
            )
            # 用户在信号与系统已学第二章（傅里叶变换），但无评估证据 → unverified 缺口
            user_store.append_learning_record(cfg, "demo", {
                "type": "chapter_completed",
                "lecture_id": lecture_b["id"],
                "book_id": book_b["id"],
                "chapter_index": 1,
                "chapter_name": "第二章 傅里叶变换",
                "timestamp": int(time.time()) - 86400,
            })
            # 目标：数据库导论第二章（傅里叶变换）
            selected = user_store.list_selected_lecture_ids(cfg, "demo")
            lecture_a_id = selected[0]
            result = check_prereq(cfg, "demo", lecture_a_id, "", 1, now=int(time.time()))
            self.assertTrue(result["ran"])
            gaps = result["gaps"]
            self.assertTrue(any(gap["concept"] == "傅里叶变换" for gap in gaps))
            records = user_store.list_learning_records(cfg, "demo")
            prereq_cards = [
                row for row in records
                if row.get("type") == "agent_decision" and isinstance(row.get("card"), dict) and row["card"].get("type") == "prereq"
            ]
            self.assertEqual(len(prereq_cards), 1)
            card = prereq_cards[0]["card"]
            self.assertEqual(card["concept"], "傅里叶变换")
            self.assertEqual(card["fromLectureId"], lecture_b["id"])

    def test_facade_endpoints(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(Path(directory))
            _seed_course(cfg, "机器学习", "教材一", ["第一章 数据模型"], {0: [{"name": "数据模型", "detail": "抽象"}]})
            app = Flask(__name__)
            init_agent_facade(cfg)
            app.register_blueprint(agent_facade_bp)
            client = app.test_client()

            overview = client.get("/api/agent/v1/cognition/overview", headers={"X-Nexora-Username": "demo"})
            self.assertEqual(overview.status_code, 200)
            body = overview.get_json()
            self.assertTrue(body["success"])
            self.assertIn("facets", body["data"])
            self.assertIn("mastery", body["data"])

            prereq = client.post(
                "/api/agent/v1/prereq/check",
                headers={"X-Nexora-Username": "demo"},
                json={"lecture_id": "l_x", "book_id": "b_x", "chapter_index": 0},
            )
            self.assertEqual(prereq.status_code, 200)
            prereq_body = prereq.get_json()["data"]
            self.assertFalse(prereq_body["ran"])
            self.assertEqual(prereq_body["reason"], "no_concepts")


if __name__ == "__main__":
    unittest.main()
