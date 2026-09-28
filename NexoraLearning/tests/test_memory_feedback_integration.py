"""Exercise memory correction through the real facade with an offline model stub."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from flask import Flask

from api.agent_facade import agent_facade_bp, init_agent_facade
from core import user as user_store
from core.memory import evidence_memory


class MemoryFeedbackIntegrationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.cfg = {
            "data_dir": str(Path(directory.name) / "data"),
            "runtime_api": {"enabled": True, "api_key": ""},
            "nexora": {"base_url": "http://127.0.0.1:9", "api_key": ""},
            "models": {"default_nexora_model": ""},
        }
        app = Flask(__name__)
        init_agent_facade(self.cfg)
        app.register_blueprint(agent_facade_bp)
        self.client = app.test_client()
        self.headers = {"X-Nexora-Username": "memory_fixture"}
        model_patch = mock.patch("api.agent_facade._PROXY")
        self.proxy = model_patch.start()
        self.addCleanup(model_patch.stop)
        self.proxy.complete_raw.return_value = {"success": True, "payload": {}}
        self.proxy.extract_output_text.return_value = "我会结合你的目标和当前教材解释。"
        rebut_patch = mock.patch("api.agent_facade.rebut", return_value=None)
        rebut_patch.start()
        self.addCleanup(rebut_patch.stop)

    def ask(self, question):
        response = self.client.post("/api/agent/v1/ask-in-context", headers=self.headers,
                                    json={"question": question})
        self.assertEqual(response.status_code, 200)
        return json.dumps(self.proxy.complete_raw.call_args.kwargs["messages"], ensure_ascii=False)

    def correct(self, original):
        response = self.client.post("/api/agent/v1/cognition/verdict", headers=self.headers, json={
            "facet_id": "memory_" + original["id"], "verdict": "disagree",
            "claim": original["claim"], "note": "我现在更喜欢图解",
        })
        self.assertEqual(response.status_code, 200)

    def test_corrected_preference_does_not_return_through_dialogue_prompt(self):
        self.proxy.extract_output_text.return_value = "我会先给视频讲解。"
        self.ask("我喜欢先看视频")
        original = evidence_memory.retrieve_memories(self.cfg, "memory_fixture")[0]
        self.correct(original)
        self.proxy.extract_output_text.return_value = "先看事务示意图。"
        prompt = self.ask("事务是什么？")
        self.assertIn("图解", prompt)
        self.assertNotIn("视频", prompt)

    def test_correction_filters_judgment_dialogue_and_keeps_valid_technical_answer(self):
        self.proxy.extract_output_text.return_value = "ATOMICITY_FIXTURE_ANSWER"
        self.ask("数据库事务的原子性是什么？")
        self.proxy.extract_output_text.return_value = "我会先给视频讲解。"
        self.ask("我喜欢先看视频")
        original = next(row for row in evidence_memory.retrieve_memories(self.cfg, "memory_fixture")
                        if row["kind"] == "preference")
        self.correct(original)
        response = self.client.get("/api/agent/v1/judgment/context", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        bundle = response.get_json()["data"]["bundle"]
        dialogue = json.dumps(bundle["dialog"], ensure_ascii=False)
        self.assertIn("ATOMICITY_FIXTURE_ANSWER", dialogue)
        self.assertNotIn("视频", dialogue)
        self.assertIn("图解", json.dumps(bundle["learner_memory"], ensure_ascii=False))
        # Historical audit entries remain on disk; filtering affects recall only.
        history = json.dumps(user_store.list_learning_records(self.cfg, "memory_fixture"), ensure_ascii=False)
        self.assertIn("视频", history)


if __name__ == "__main__":
    unittest.main()
