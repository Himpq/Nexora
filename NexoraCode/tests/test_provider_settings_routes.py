"""Exercise provider settings with temporary storage and no real credentials or network."""

import importlib
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from flask import Flask


ROOT = Path(__file__).resolve().parents[1]


class MemoryConfig(dict):
    def set(self, key, value):
        self[key] = value


class ProviderSettingsTests(unittest.TestCase):
    """Keep settings serialization and saved-key ownership under regression coverage."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.config = MemoryConfig()
        fake_config = types.ModuleType("core.config")
        fake_config.config = self.config
        fake_config.get_app_root = lambda: Path(self.directory.name)
        package = types.ModuleType("provider_settings_test_model")
        package.__path__ = [str(ROOT / "model")]
        self.modules = patch.dict(sys.modules, {
            "core.config": fake_config,
            "provider_settings_test_model": package,
        })
        self.modules.start()
        self.addCleanup(self.modules.stop)
        self.routes = importlib.import_module("provider_settings_test_model.ProviderSettingsRoutes")
        self.provider = self.routes.ProviderConfig(
            provider_id="saved-provider",
            name="Test provider",
            base_url="https://provider.example/v1",
            model="test-model",
            api_key="unit-test-secret",
        )
        self.routes.load_providers = lambda: [self.provider]
        self.saved = []
        self.routes.save_providers = lambda rows, default: self.saved.append((rows, default))
        self.network = patch.object(self.routes.requests, "get")
        self.request = self.network.start()
        self.addCleanup(self.network.stop)
        self.app = Flask(__name__)
        self.routes.register_provider_settings_routes(self.app)
        self.client = self.app.test_client()

    def save(self, provider):
        return self.client.post("/api/local/settings", json={
            "provider": {"providers": [provider], "default_id": "saved-provider"},
        })

    def test_get_never_returns_stored_key(self):
        response = self.client.get("/api/local/settings")
        self.assertEqual(response.status_code, 200)
        public = response.json["provider"]["providers"][0]
        self.assertTrue(public["has_api_key"])
        self.assertNotIn("api_key", public)
        self.assertNotIn("unit-test-secret", response.get_data(as_text=True))
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_edit_keeps_key_for_same_custom_endpoint(self):
        response = self.save({
            "id": self.provider.provider_id,
            "template_id": "custom",
            "base_url": self.provider.base_url,
            "model": "updated-model",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.saved[0][0][0].api_key, "unit-test-secret")

    def test_clone_uses_saved_key_only_for_matching_endpoint(self):
        response = self.save({
            "key_source_id": self.provider.provider_id,
            "template_id": "custom",
            "base_url": self.provider.base_url,
            "model": "second-model",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.saved[0][0][0].api_key, "unit-test-secret")

    def test_changed_custom_endpoint_does_not_inherit_key(self):
        response = self.save({
            "id": self.provider.provider_id,
            "key_source_id": self.provider.provider_id,
            "template_id": "custom",
            "base_url": "https://different.example/v1",
            "model": "second-model",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.saved[0][0][0].api_key, "")

    def test_changed_template_cannot_reuse_other_platform_key(self):
        response = self.save({
            "id": self.provider.provider_id,
            "key_source_id": self.provider.provider_id,
            "template_id": "openai",
            "model": "test-model",
        })
        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.saved)

    def test_nonlocal_origin_is_rejected_before_network(self):
        response = self.client.post("/api/local/provider-models", json={}, headers={
            "Origin": "https://foreign.example",
        })
        self.assertEqual(response.status_code, 403)
        self.request.assert_not_called()

    def test_custom_loopback_catalog_is_normalized_and_deduplicated(self):
        self.request.return_value = Mock(status_code=200)
        self.request.return_value.json.return_value = {"data": [
            {"id": "z"}, {"id": "a", "name": "Alpha"}, {"id": "z"}, {"id": ""},
        ]}
        response = self.client.post("/api/local/provider-models", json={
            "template_id": "custom",
            "base_url": "http://127.0.0.1:11434/v1",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.json["models"]], ["a", "z"])
        self.assertEqual(self.request.call_args.args[0], "http://127.0.0.1:11434/v1/models")
        self.assertFalse(self.request.call_args.kwargs["allow_redirects"])

    def test_catalog_redirect_is_rejected(self):
        self.request.return_value = Mock(status_code=302)
        response = self.client.post("/api/local/provider-models", json={
            "template_id": "custom", "base_url": "https://provider.example/v1",
        })
        self.assertEqual(response.status_code, 502)

    def test_template_controls_endpoint_instead_of_submitted_url(self):
        self.request.return_value = Mock(status_code=200)
        self.request.return_value.json.return_value = {"data": [{"id": "test-model"}]}
        response = self.client.post("/api/local/provider-models", json={
            "template_id": "openai",
            "base_url": "https://different.example/v1",
            "api_key": "unit-test-secret",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.request.call_args.args[0], "https://api.openai.com/v1/models")


if __name__ == "__main__":
    unittest.main()
