import unittest
from unittest.mock import patch

from basis.Model.Provider.dashscope import DashScopeProvider


class _FakeResponse:
    status_code = 200
    reason_phrase = "OK"
    text = '{"output": {"choices": []}}'

    def json(self):
        return {
            "output": {
                "choices": [{
                    "message": {
                        "content": [{"image": "https://example.com/qwen.png"}],
                    },
                }],
            },
        }


class _FakeClient:
    def __init__(self):
        self.url = ""
        self.headers = {}
        self.payload = {}

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def post(self, url, headers, json):
        self.url = url
        self.headers = headers
        self.payload = json
        return _FakeResponse()


class DashScopeImageGenerationTest(unittest.TestCase):
    @patch("basis.Model.Provider.dashscope.httpx.Client")
    def test_native_image_generation_uses_dashscope_payload(self, client_factory):
        client = _FakeClient()
        client_factory.return_value = client
        provider = DashScopeProvider("qwen-image", {})

        result = provider.generate_image(
            api_key="test-key",
            base_url="https://dashscope.aliyuncs.com/api/v1",
            model_id="qwen-image-2.0-pro-2026-06-22",
            prompt="a test image",
            size="1024x1024",
            n=2,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["images"][0]["url"], "https://example.com/qwen.png")
        self.assertEqual(
            client.url,
            "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
        )
        self.assertEqual(client.payload["model"], "qwen-image-2.0-pro-2026-06-22")
        self.assertEqual(client.payload["parameters"]["size"], "1024*1024")
        self.assertEqual(client.payload["parameters"]["n"], 2)
        self.assertEqual(
            client.payload["input"]["messages"][0]["content"],
            [{"text": "a test image"}],
        )

    def test_native_image_generation_rejects_compatible_base_url(self):
        provider = DashScopeProvider("qwen-image", {})

        with self.assertRaisesRegex(ValueError, "必须以 /api/v1 结尾"):
            provider.generate_image(
                api_key="test-key",
                base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
                model_id="qwen-image-2.0-pro-2026-06-22",
                prompt="a test image",
            )


if __name__ == "__main__":
    unittest.main()
