import json
import ssl
import unittest
from unittest.mock import patch

from basis.Model.Provider.openai import OpenAIProvider


class _FakeResponse:
    def __init__(self, payload):
        self._payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def read(self):
        return self._payload


class OpenAIImageTransportTest(unittest.TestCase):
    @patch("basis.Model.Provider.openai.urllib_request.urlopen")
    def test_image_request_uses_verified_ca_context(self, urlopen_mock):
        urlopen_mock.return_value = _FakeResponse({
            "data": [{"url": "https://example.com/generated.png"}],
        })
        provider = OpenAIProvider("test", {})

        result = provider.generate_image(
            api_key="test-key",
            base_url="https://example.com/v1",
            model_id="image-model",
            prompt="a test image",
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["images"][0]["url"], "https://example.com/generated.png")

        _, kwargs = urlopen_mock.call_args
        context = kwargs["context"]
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)


if __name__ == "__main__":
    unittest.main()
