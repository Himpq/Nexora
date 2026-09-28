"""§2 困惑触发、§4 图谱边/口径、§5 无图谱兜底 的接线测试。"""

from __future__ import annotations

import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask

from api.agent_facade import agent_facade_bp, init_agent_facade
from api.telemetry import ingest_batch, init_telemetry
from core import user as user_store
from core.cognition import graph_builder, triggers
from core.lectures import create_book, create_lecture, save_book_info_xml, save_book_text
from core.user import set_lecture_selection


def _cfg(directory):
    return {
        "data_dir": str(Path(directory) / "data"),
        "runtime_api": {"enabled": True, "api_key": ""},
        "nexora": {"base_url": "http://127.0.0.1:9", "api_key": ""},
        "models": {"default_nexora_model": ""},
    }


def _seed(cfg, *, with_graph: bool, username: str = "demo"):
    lecture = create_lecture(cfg, "机器学习入门", status="published")
    book = create_book(cfg, lecture["id"], "教材第一册")
    save_book_text(cfg, lecture["id"], book["id"],
                   "第一章 数据模型\n数据模型是对现实世界数据特征的抽象。\n\n第二章 傅里叶变换与卷积\n傅里叶变换把时域信号变换到频域，卷积描述线性系统。\n")
    text = "第一章 数据模型\n数据模型是对现实世界数据特征的抽象。\n\n第二章 傅里叶变换与卷积\n傅里叶变换把时域信号变换到频域，卷积描述线性系统。\n"
    second = text.index("第二章")
    save_book_info_xml(
        cfg, lecture["id"], book["id"],
        f"<book><chapter><chapter_name>第一章 数据模型</chapter_name><chapter_range>0:{second}</chapter_range></chapter>"
        f"<chapter><chapter_name>第二章 傅里叶变换与卷积</chapter_name><chapter_range>{second}:{len(text) - second}</chapter_range></chapter></book>",
    )
    set_lecture_selection(cfg, username, lecture["id"], selected=True, actor="test")
    if with_graph:
        solidified = Path(cfg["data_dir"]) / "lectures" / lecture["id"] / "solidified"
        solidified.mkdir(parents=True, exist_ok=True)
        (solidified / "outline.json").write_text(json.dumps({
            "course_title": "机器学习入门",
            "sections": [
                {"id": "sec_001", "title": "第一章 数据模型", "summary": "", "objectives": [], "key_concepts": ["数据模型"],
                 "difficulty": "中等", "estimated_minutes": 30, "prerequisites": [],
                 "sources": [{"book_id": book["id"], "chapter_name": "第一章 数据模型"}], "exploration": {}},
                {"id": "sec_002", "title": "第二章 傅里叶变换与卷积", "summary": "", "objectives": [], "key_concepts": ["傅里叶变换", "卷积"],
                 "difficulty": "中等", "estimated_minutes": 30, "prerequisites": [],
                 "sources": [{"book_id": book["id"], "chapter_name": "第二章 傅里叶变换与卷积"}], "exploration": {}},
            ],
        }, ensure_ascii=False), encoding="utf-8")
        # 扁平 v2 结构（nodes/edges），与线上 mindmap.json 同构
        (solidified / "mindmap.json").write_text(json.dumps({
            "course_title": "机器学习入门",
            "nodes": [
                {"id": "sec_001", "label": "第一章 数据模型", "type": "chapter", "detail": "", "parent": None},
                {"id": "sec_001_k0", "label": "数据模型", "type": "concept", "detail": "数据抽象", "parent": "sec_001"},
                {"id": "sec_002", "label": "第二章 傅里叶变换与卷积", "type": "chapter", "detail": "", "parent": None},
                {"id": "sec_002_k0", "label": "傅里叶变换", "type": "concept", "detail": "时域到频域", "parent": "sec_002"},
                {"id": "sec_002_k1", "label": "卷积", "type": "concept", "detail": "线性系统输出", "parent": "sec_002"},
            ],
            "edges": [
                {"source": "sec_001", "target": "sec_001_k0", "type": "hierarchy", "label": ""},
                {"source": "sec_002", "target": "sec_002_k0", "type": "hierarchy", "label": ""},
                {"source": "sec_002", "target": "sec_002_k1", "type": "hierarchy", "label": ""},
                {"source": "sec_001_k0", "target": "sec_002_k0", "type": "prerequisite", "label": "先修"},
                {"source": "sec_002_k1", "target": "sec_002_k0", "type": "related", "label": "相关"},
            ],
        }, ensure_ascii=False), encoding="utf-8")
    return lecture, book


class ConfusionTriggerTests(unittest.TestCase):
    def setUp(self):
        triggers.reset_throttle()

    def test_trigger_is_throttled_per_user_and_runs_scan(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(directory)
            lecture, book = _seed(cfg, with_graph=True)
            init_telemetry(cfg)
            now = int(time.time())
            ingest_batch("demo", [
                {"stream": "reading", "event": "selection", "bid": book["id"], "ci": 1, "si": 0, "sel_text": "傅里叶变换", "ts": now - 600},
                {"stream": "reading", "event": "selection", "bid": book["id"], "ci": 1, "si": 1, "sel_text": "傅里叶变换再划线", "ts": now - 500},
                {"stream": "reading", "event": "ask", "bid": book["id"], "ci": 1, "si": 0, "sel_text": "傅里叶变换怎么理解？", "ts": now - 400},
            ])
            self.assertTrue(triggers.schedule_confusion_scan(cfg, "demo", reason="test", sync=True))
            # 60 秒内第二次被节流
            self.assertFalse(triggers.schedule_confusion_scan(cfg, "demo", reason="test", sync=True))
            # 另一个用户不受影响
            self.assertTrue(triggers.schedule_confusion_scan(cfg, "other", reason="test", sync=True))
            records = user_store.list_learning_records(cfg, "demo")
            cards = [row for row in records if row.get("type") == "agent_decision"
                     and isinstance(row.get("card"), dict) and row["card"].get("type") == "confusion"]
            self.assertEqual(len(cards), 1)

    def test_ask_in_context_schedules_scan(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(directory)
            _seed(cfg, with_graph=True)
            app = Flask(__name__)
            init_agent_facade(cfg)
            app.register_blueprint(agent_facade_bp)

            class FakeProxy:
                def complete_raw(self, **kwargs):
                    return {"success": True, "payload": {"answer": "傅里叶变换把时域信号变到频域。"}}

                def extract_output_text(self, payload):
                    return str(payload.get("answer") or "")

            with patch("api.agent_facade._PROXY", FakeProxy()), \
                    patch("core.cognition.triggers.schedule_confusion_scan") as scheduled:
                response = app.test_client().post(
                    "/api/agent/v1/ask-in-context", headers={"X-Nexora-Username": "demo"},
                    json={"question": "傅里叶变换是什么"},
                )
                self.assertEqual(response.status_code, 200)
                scheduled.assert_called_once()
                self.assertEqual(scheduled.call_args.kwargs.get("reason"), "ask_in_context")


class LearningGraphEdgeTests(unittest.TestCase):
    def test_edges_come_from_course_mindmap_when_book_graph_has_none(self):
        from core.cognition.learning_graph import build_learning_graph

        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(directory)
            lecture, book = _seed(cfg, with_graph=True)
            result = build_learning_graph(cfg, "demo", lecture["id"], book["id"])
            graph = result["graph"]
            relations = graph["relations"]
            self.assertEqual(len(relations), 2)
            self.assertEqual({(r["from"], r["to"], r["type"]) for r in relations},
                             {("数据模型", "傅里叶变换", "prerequisite"), ("卷积", "傅里叶变换", "related")})
            self.assertIn("book_reading_progress_percent", graph)
            self.assertIn("course_reading_progress_percent", graph)


class GraphBuilderTests(unittest.TestCase):
    def setUp(self):
        graph_builder.reset_state()

    def test_status_and_select_triggers_build(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(directory)
            lecture, _ = _seed(cfg, with_graph=False)
            self.assertEqual(graph_builder.graph_status(cfg, lecture["id"]), "missing")
            calls = []

            def fake_outline(cfg_, lecture_id, **kwargs):
                calls.append("outline")
                solidified = Path(cfg_["data_dir"]) / "lectures" / lecture_id / "solidified"
                solidified.mkdir(parents=True, exist_ok=True)
                (solidified / "outline.json").write_text("{}", encoding="utf-8")
                return {}

            def fake_mindmap(cfg_, lecture_id, **kwargs):
                calls.append("mindmap")
                solidified = Path(cfg_["data_dir"]) / "lectures" / lecture_id / "solidified"
                (solidified / "mindmap.json").write_text("{}", encoding="utf-8")
                return {}

            with patch("core.booksproc.outline.generate_outline", fake_outline), \
                    patch("core.booksproc.mindmap.generate_mindmap", fake_mindmap):
                state = graph_builder.ensure_course_graph(cfg, lecture["id"], user_id="demo", sync=True)
            self.assertEqual(calls, ["outline", "mindmap"])
            self.assertEqual(state, "ready")
            self.assertEqual(graph_builder.ensure_course_graph(cfg, lecture["id"], user_id="demo", sync=True), "ready")

    def test_failure_has_cooldown(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(directory)
            lecture, _ = _seed(cfg, with_graph=False)

            def boom(cfg_, lecture_id, **kwargs):
                raise RuntimeError("model down")

            with patch("core.booksproc.outline.generate_outline", boom):
                self.assertEqual(graph_builder.ensure_course_graph(cfg, lecture["id"], sync=True), "missing")
                # 冷却期内不再重试
                self.assertEqual(graph_builder.ensure_course_graph(cfg, lecture["id"], sync=True), "missing")

    def test_overview_reports_graph_status(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(directory)
            _seed(cfg, with_graph=False)
            app = Flask(__name__)
            init_agent_facade(cfg)
            app.register_blueprint(agent_facade_bp)
            data = app.test_client().get("/api/agent/v1/cognition/overview", headers={"X-Nexora-Username": "demo"}).get_json()["data"]
            self.assertEqual(data["graph_status"], "missing")
            self.assertEqual(data["mastery"], [])

    def test_stale_mindmap_is_detected_and_rebuilt(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(directory)
            lecture, book = _seed(cfg, with_graph=True)
            solidified = Path(cfg["data_dir"]) / "lectures" / lecture["id"] / "solidified"
            # 大纲比图谱新，且 section 集合变了（模拟 09-03 重生成大纲、07-29 旧图谱）
            outline = json.loads((solidified / "outline.json").read_text(encoding="utf-8"))
            outline["generated_at"] = int(time.time())
            outline["sections"].append({"id": "sec_003", "title": "第三章 新增", "summary": "", "objectives": [], "key_concepts": ["新增"],
                                        "difficulty": "中等", "estimated_minutes": 20, "prerequisites": [],
                                        "sources": [{"book_id": book["id"], "chapter_name": "第一章 数据模型"}], "exploration": {}})
            (solidified / "outline.json").write_text(json.dumps(outline, ensure_ascii=False), encoding="utf-8")
            self.assertTrue(graph_builder.mindmap_is_stale(cfg, lecture["id"]))
            self.assertEqual(graph_builder.graph_status(cfg, lecture["id"]), "stale")
            calls = []

            def fake_outline(cfg_, lecture_id, **kwargs):
                calls.append("outline")
                return {}

            def fake_mindmap(cfg_, lecture_id, **kwargs):
                calls.append("mindmap")
                mm = json.loads((solidified / "mindmap.json").read_text(encoding="utf-8"))
                mm["nodes"].append({"id": "sec_003", "label": "第三章 新增", "type": "chapter", "detail": "", "parent": None})
                mm["outline_generated_at"] = outline["generated_at"]
                (solidified / "mindmap.json").write_text(json.dumps(mm, ensure_ascii=False), encoding="utf-8")
                return mm

            with patch("core.booksproc.outline.generate_outline", fake_outline), \
                    patch("core.booksproc.mindmap.generate_mindmap", fake_mindmap):
                state = graph_builder.ensure_course_graph(cfg, lecture["id"], sync=True)
            self.assertEqual(calls, ["mindmap"])  # stale 只重建图谱，不重跑大纲
            self.assertEqual(state, "ready")

    def test_overview_ignores_orphan_evidence_after_rebuild(self):
        from core.cognition.service import CognitionService

        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(directory)
            lecture, book = _seed(cfg, with_graph=True)
            service = CognitionService(cfg)
            concept = service.get_catalog(lecture["id"])["concepts"][0]
            service.record_evidence("demo", {
                "evidence_id": "ev_keep", "lecture_id": lecture["id"], "book_id": book["id"],
                "concept_id": concept["concept_id"], "evidence_type": "objective_question", "source_type": "review",
                "source_id": "s1", "occurred_at": int(time.time()), "score": 1.0,
            })
            # 直接往 evidence.jsonl 追加一条指向已不存在概念的旧证据
            path = Path(cfg["data_dir"]) / "users" / "demo" / "cognition" / "evidence.jsonl"
            stale = json.loads(path.read_text(encoding="utf-8").splitlines()[0])
            stale.update(evidence_id="ev_orphan", concept_id="cx_gone")
            path.open("a", encoding="utf-8").write(json.dumps(stale, ensure_ascii=False) + "\n")
            overview = service.get_overview("demo", lecture_id=lecture["id"])
            self.assertEqual(overview["summary"]["orphan_concept_count"], 1)
            self.assertEqual(overview["summary"]["evidence_count"], 1)


class OutlineAndMindmapGuardTests(unittest.TestCase):
    def test_rebind_after_graph_rebuild_restores_assessment(self):
        """图谱重建 → 旧证据成孤儿 → rebind 把已有答题记录绑到新概念，掌握度恢复。"""
        from core.cognition.review_bridge import rebind_review_evidence
        from core.cognition.service import CognitionService

        with tempfile.TemporaryDirectory() as directory:
            cfg = _cfg(directory)
            lecture, book = _seed(cfg, with_graph=True)
            quiz_id = "chapter_quiz_rebind"
            quiz_path = Path(cfg["data_dir"]) / "users" / "demo" / "chapter_quizzes" / f"{quiz_id}.json"
            quiz_path.parent.mkdir(parents=True, exist_ok=True)
            quiz_path.write_text(json.dumps({
                "quiz_id": quiz_id, "lecture_id": lecture["id"], "book_id": book["id"], "chapter_index": 1,
                "chapter_name": "第二章 傅里叶变换与卷积",
                "questions": [{"title": "频域变换", "content": "把信号变到频域的是什么", "type": "choice",
                               "options": ["傅里叶变换", "卷积"], "answer": "A", "source_id": "q1"}],
            }, ensure_ascii=False), encoding="utf-8")
            user_store.append_question_completion(cfg, "demo", {
                "completion_id": "qc_1", "quiz_id": quiz_id, "question_id": "q1", "lecture_id": lecture["id"],
                "book_id": book["id"], "chapter_index": 1, "chapter_name": "第二章 傅里叶变换与卷积",
                "question_title": "频域变换", "is_correct": True, "timestamp": int(time.time()),
            })
            first = rebind_review_evidence(cfg, "demo", lecture_id=lecture["id"])
            self.assertEqual(first["created"], 1)
            self.assertEqual(rebind_review_evidence(cfg, "demo", lecture_id=lecture["id"])["created"], 0)  # 幂等
            service = CognitionService(cfg)
            self.assertEqual(service.get_overview("demo", lecture_id=lecture["id"])["summary"]["evidence_count"], 1)

            # 模拟图谱重建：section_id 变了 → concept_id 全变
            solidified = Path(cfg["data_dir"]) / "lectures" / lecture["id"] / "solidified"
            for name in ("outline.json", "mindmap.json"):
                text = (solidified / name).read_text(encoding="utf-8").replace("sec_002", "sec_202").replace("sec_001", "sec_101")
                (solidified / name).write_text(text, encoding="utf-8")
            overview = service.get_overview("demo", lecture_id=lecture["id"])
            self.assertEqual(overview["summary"]["orphan_concept_count"], 1)
            self.assertEqual(overview["summary"]["evidence_count"], 0)
            rebound = rebind_review_evidence(cfg, "demo", lecture_id=lecture["id"])
            self.assertEqual(rebound["created"], 1)
            overview = service.get_overview("demo", lecture_id=lecture["id"])
            self.assertEqual(overview["summary"]["evidence_count"], 1)
            assessed = [s for s in overview["states"] if s["assessed_count"]]
            self.assertEqual(len(assessed), 1)
            self.assertEqual(assessed[0]["concept"]["name"], "傅里叶变换")

    def test_outline_coverage_gap_reports_missing_books(self):
        from core.booksproc.outline import outline_coverage_gap

        books = [{"id": "bA", "summary_status": "done"}, {"id": "bB", "summary_status": "done"}, {"id": "bC", "summary_status": "idle"}]
        sections = [{"sources": [{"book_id": "bB", "chapter_name": "x"}]}, {"sources": [{"book_id": "bZ", "chapter_name": "y"}]}]
        gap = outline_coverage_gap(sections, books)
        self.assertEqual(gap, {"missing": ["bA"], "unknown": ["bZ"]})
        self.assertEqual(outline_coverage_gap([{"sources": [{"book_id": "bA", "chapter_name": "a"}, {"book_id": "bB", "chapter_name": "b"}]}], books),
                         {"missing": [], "unknown": []})

    def test_chapter_prompt_keeps_every_book(self):
        from core.booksproc.outline import _format_chapters_for_prompt

        rows = [{"book_id": "bA", "book_title": "甲", "chapter_name": f"甲{i}", "chapter_summary": "摘" * 400} for i in range(30)]
        rows += [{"book_id": "bB", "book_title": "乙", "chapter_name": f"乙{i}", "chapter_summary": "摘" * 400} for i in range(6)]
        text = _format_chapters_for_prompt(rows, limit=6000)
        self.assertIn("book_id=bA", text)
        self.assertIn("book_id=bB", text)
        self.assertIn("乙5", text)

    def test_mindmap_rejects_section_mismatch(self):
        from core.booksproc.mindmap import _normalize_mindmap

        payload = {"course_title": "c", "chapters": [
            {"section_id": "sec_001", "name": "一", "concepts": [{"name": "a", "detail": ""}, {"name": "b", "detail": ""}]},
            {"section_id": "sec_009", "name": "九", "concepts": [{"name": "c", "detail": ""}, {"name": "d", "detail": ""}]},
        ], "relations": []}
        with self.assertRaises(ValueError) as ctx:
            _normalize_mindmap(payload, expected_section_ids=["sec_001", "sec_002"])
        self.assertIn("sec_002", str(ctx.exception))
        self.assertIn("sec_009", str(ctx.exception))
        ok = _normalize_mindmap(payload, expected_section_ids=["sec_001", "sec_009"])
        self.assertEqual(len([n for n in ok["nodes"] if n["type"] == "chapter"]), 2)


if __name__ == "__main__":
    unittest.main()
