"""远程白名单测试作业输入接口放行接口，越权路径仍拒绝。"""

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def load_module(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class AllowedRequestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.remote = load_module("test_core.remote_connection", "core/remote_connection.py")

    def test_queue_paths_are_allowed(self):
        allowed = [
            ("GET", "/api/chat/queue"),
            ("POST", "/api/chat/queue"),
            ("PATCH", "/api/chat/queue/abc123"),
            ("DELETE", "/api/chat/queue/abc123"),
            ("POST", "/api/chat/queue/abc123/steer"),
        ]

        for method, path in allowed:
            with self.subTest(method=method, path=path):
                self.assertTrue(self.remote.allowed_request(method, path), f"{method} {path} 应被放行行接口")

    def test_queue_item_id_with_uuid_and_dash(self):
        item_id = "3f2a1b4c-5d6e-7f80-9a1b-2c3d4e5f6071"

        self.assertTrue(self.remote.allowed_request("PATCH", f"/api/chat/queue/{item_id}"))
        self.assertTrue(self.remote.allowed_request("DELETE", f"/api/chat/queue/{item_id}"))
        self.assertTrue(self.remote.allowed_request("POST", f"/api/chat/queue/{item_id}/steer"))

    def test_queue_subpaths_are_not_allowed(self):
        denied = [
            ("GET", "/api/chat/queue/abc/extra"),
            ("POST", "/api/chat/queue/abc/other"),
            ("PATCH", "/api/chat/queue"),
            ("DELETE", "/api/chat/queue"),
            ("GET", "/api/chat/queue/abc123"),
        ]

        for method, path in denied:
            with self.subTest(method=method, path=path):
                self.assertFalse(self.remote.allowed_request(method, path), f"{method} {path} 不应⊢放行行接口")

    def test_item_id_with_path_traversal_is_rejected(self):
        denied = [
            ("PATCH", "/api/chat/queue/abc.def"),
            ("PATCH", "/api/chat/queue/abc def"),
            ("PATCH", "/api/chat/queue/abc/def"),
        ]

        for method, path in denied:
            with self.subTest(path=path):
                self.assertFalse(self.remote.allowed_request(method, path), f"{method} {path} 不应被放行")

    def test_sensitive_paths_remain_denied(self):
        denied = [
            ("GET", "/api/config/secret"),
            ("POST", "/api/local/exec"),
            ("GET", "/api/chat/stream"),
            ("POST", "/api/chat/send"),
        ]

        for method, path in denied:
            with self.subTest(method=method, path=path):
                self.assertFalse(self.remote.allowed_request(method, path))

    def test_existing_rules_still_work(self):
        allowed = [
            ("GET", "/api/config"),
            ("GET", "/api/conversations"),
            ("GET", "/api/conversations/conv_0123456789/messages"),
            ("POST", "/api/conversations"),
            ("GET", "/api/local/permissions"),
            ("POST", "/api/local/permissions"),
        ]

        for method, path in allowed:
            with self.subTest(method=method, path=path):
                self.assertTrue(self.remote.allowed_request(method, path))


if __name__ == "__main__":
    unittest.main()
