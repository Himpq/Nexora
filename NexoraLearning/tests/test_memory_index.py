"""§7 NexoraDB 记忆索引：未配置时静默、写路径接线、状态翻转、检索融合。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core.memory import evidence_memory as em
from core.memory import memory_index


class MemoryIndexTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.cfg = {"data_dir": str(Path(self.temporary.name) / "data"),
                    "nexoradb": {"service_url": "http://127.0.0.1:8100", "api_key": ""}}

    def test_disabled_when_pointing_to_default_url(self):
        self.assertFalse(memory_index.enabled(self.cfg))
        self.assertEqual(memory_index.search(self.cfg, "u", "备份"), [])
        self.assertFalse(memory_index.index(self.cfg, "u", {"id": "mem_x", "quote": "x"}))

    def test_write_paths_index_rows_and_status_flips(self):
        cfg = dict(self.cfg, nexoradb={"service_url": "http://db.example:9951", "api_key": "k"})
        posted = []

        def fake_post(cfg_, path, payload):
            posted.append((path, payload))
            return {"success": True, "vector_ids": ["v"]}

        with patch("core.vector.require_nexoradb_available", return_value={"available": True}), \
                patch("core.vector._post", side_effect=fake_post), \
                patch("core.memory.memory_index.index_async",
                      side_effect=lambda c, u, rows, status=None: [memory_index.index(c, u, r, status=status) for r in rows]):
            first = em.record_user_message(cfg, "u", text="我更喜欢用例子讲解", source_id="a", occurred_at=100)
            pref_id = first["memories"][0]["id"]
            self.assertEqual(len(posted), 1)
            self.assertEqual(posted[0][1]["library"], "memory_u")
            meta = posted[0][1]["items"][0]["metadata"]
            self.assertEqual(meta["memory_id"], pref_id)
            self.assertEqual(meta["status"], "active")
            self.assertIsInstance(meta["occurred_at"], int)
            em.correct_memory(cfg, "u", pref_id, verdict="disagree", note="其实我更喜欢图解", source_id="c1", occurred_at=200)
            statuses = {item["metadata"]["memory_id"]: item["metadata"]["status"] for _, p in posted for item in p["items"]}
            self.assertEqual(statuses[pref_id], "superseded")
            self.assertTrue(any(s == "active" and mid != pref_id for mid, s in statuses.items()))

    def test_semantic_candidates_reorder_keyword_results(self):
        cfg = dict(self.cfg, nexoradb={"service_url": "http://db.example:9951", "api_key": "k"})
        with patch("core.memory.memory_index.index_async"):
            em.record_user_message(cfg, "u", text="数据备份怎么做", source_id="a", occurred_at=100)
            em.record_user_message(cfg, "u", text="容灾演练的步骤", source_id="b", occurred_at=101)
        rows = em.retrieve_memories(cfg, "u", limit=5)
        target = [row for row in rows if row["source_id"] == "b"][0]["id"]
        with patch("core.memory.memory_index.search", return_value=[target]):
            ranked = em.retrieve_memories(cfg, "u", query="备份", limit=5)
        # 词重叠会把「数据备份」排前，向量候选把「容灾演练」提到第一
        self.assertEqual(ranked[0]["source_id"], "b")
        with patch("core.memory.memory_index.search", return_value=[]):
            fallback = em.retrieve_memories(cfg, "u", query="备份", limit=5)
        self.assertEqual(fallback[0]["source_id"], "a")


if __name__ == "__main__":
    unittest.main()
