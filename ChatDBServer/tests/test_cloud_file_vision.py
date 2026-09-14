import json
import os
import tempfile
import threading
import unittest

from App.Storage.file_sandbox import UserFileSandbox
from App.Core.model import Model


class _VisionAdapter:
    def __init__(self, supported):
        self.supported = supported

    def supports_vision_input(self, model_name):
        return self.supported


class _ImageToolExecutor:
    def __init__(self):
        self.calls = []

    def prepare_cloud_file_image_input(self, file_ref):
        self.calls.append(file_ref)
        return {
            "url": "data:image/png;base64,AAAA",
            "mime": "image/png",
            "name": "chart.png",
            "size": 4,
        }


class CloudFileVisionTest(unittest.TestCase):
    def _build_sandbox(self, root, image_bytes):
        sandbox = UserFileSandbox.__new__(UserFileSandbox)
        sandbox.username = "vision-test"
        sandbox.base_dir = root
        sandbox.temp_dir = root
        sandbox.user_dir = root
        sandbox.index_path = os.path.join(root, "file_sandbox.json")
        sandbox._lock = threading.Lock()

        image_path = os.path.join(root, "chart.png")
        with open(image_path, "wb") as f:
            f.write(image_bytes)

        with open(sandbox.index_path, "w", encoding="utf-8") as f:
            json.dump({
                "files": {
                    "chart.png": {
                        "alias": "chart.png",
                        "original_name": "chart.png",
                        "stored_path": "chart.png",
                        "sandbox_path": "vision-test/files/chart.png",
                        "source_ext": ".png",
                        "parser_mode": "image",
                        "size": len(image_bytes),
                    }
                }
            }, f)

        return sandbox

    def test_image_read_returns_metadata_without_binary_content(self):
        image_bytes = b"fake-png-content"

        with tempfile.TemporaryDirectory() as root:
            sandbox = self._build_sandbox(root, image_bytes)
            payload = sandbox.read_file("chart.png", include_image_metadata=True)

        self.assertTrue(payload["success"])
        self.assertEqual(payload["content_type"], "image")
        self.assertFalse(payload["readable_as_text"])
        self.assertEqual(payload["file"]["mime"], "image/png")
        self.assertNotIn("bytes", payload)
        self.assertNotIn("base64", json.dumps(payload, ensure_ascii=False))

    def test_default_file_read_still_rejects_image_text_reading(self):
        image_bytes = b"fake-png-content"

        with tempfile.TemporaryDirectory() as root:
            sandbox = self._build_sandbox(root, image_bytes)

            with self.assertRaisesRegex(ValueError, "图片文件不支持文本读取"):
                sandbox.read_file("chart.png")

    def test_image_asset_reader_returns_original_bytes_for_internal_delivery(self):
        image_bytes = b"fake-png-content"

        with tempfile.TemporaryDirectory() as root:
            sandbox = self._build_sandbox(root, image_bytes)
            asset = sandbox.read_image_asset("chart.png")

        self.assertEqual(asset["mime"], "image/png")
        self.assertEqual(asset["bytes"], image_bytes)

    def test_model_attaches_image_only_when_provider_supports_vision(self):
        model = Model.__new__(Model)
        model.provider = "test"
        model.model_name = "test-vision"
        model.provider_adapter = _VisionAdapter(True)
        model.tool_executor = _ImageToolExecutor()
        model._pending_tool_image_inputs = {}
        model._model_vision_input_capability = None
        raw_result = json.dumps({
            "success": True,
            "content_type": "image",
            "file": {"mime": "image/png"},
        }, ensure_ascii=False)

        updated = model._prepare_tool_image_attachment(
            "cloud_file_read",
            {"file_path": "chart.png"},
            raw_result,
            "call_1",
        )
        payload = json.loads(updated)

        self.assertTrue(payload["image_input"]["attached"])
        self.assertEqual(model.tool_executor.calls, ["chart.png"])
        self.assertIn("call_1", model._pending_tool_image_inputs)
        self.assertNotIn("base64", updated)

    def test_model_does_not_read_image_bytes_for_non_vision_model(self):
        model = Model.__new__(Model)
        model.provider = "test"
        model.model_name = "test-text"
        model.provider_adapter = _VisionAdapter(False)
        model.tool_executor = _ImageToolExecutor()
        model._pending_tool_image_inputs = {}
        model._model_vision_input_capability = None
        raw_result = json.dumps({
            "success": True,
            "content_type": "image",
            "file": {"mime": "image/png"},
        }, ensure_ascii=False)

        updated = model._prepare_tool_image_attachment(
            "cloud_file_read",
            {"file_path": "chart.png"},
            raw_result,
            "call_1",
        )
        payload = json.loads(updated)

        self.assertFalse(payload["image_input"]["attached"])
        self.assertEqual(model.tool_executor.calls, [])
        self.assertNotIn("call_1", model._pending_tool_image_inputs)


if __name__ == "__main__":
    unittest.main()
