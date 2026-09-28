"""Gateway contract tests using the real session guard and a local HTTP peer.

The peer records transport, not model behavior. These tests do not claim to
validate NexoraLearning generation or a deployed model provider.
"""

import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

API_DIR = Path(__file__).resolve().parents[1] / "api"
sys.path.insert(0, str(API_DIR))

from flask import Flask
from basis import User as user_store
from App.Components import learning_agent_routes as gateway


class _Peer(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.respond()

    def do_POST(self):
        self.respond()

    def respond(self):
        size = int(self.headers.get("Content-Length") or 0)
        self.server.requests.append({
            "path": self.path,
            "headers": dict(self.headers),
            "body": json.loads(self.rfile.read(size)) if size else None,
        })
        self.send_response(self.server.response_status)
        self.send_header("Content-Type", "application/json")
        if self.server.response_status == 302:
            self.send_header("Location", "/redirect-target")
        self.end_headers()
        self.wfile.write(json.dumps(self.server.response_payload).encode())


class LearningAgentProxyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.peer = ThreadingHTTPServer(("127.0.0.1", 0), _Peer)
        cls.thread = threading.Thread(target=cls.peer.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.peer.shutdown()
        cls.peer.server_close()
        cls.thread.join(timeout=2)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        previous_path = user_store.USERS_PATH
        user_path = Path(self.tmp.name) / "users.json"
        user_path.write_text(json.dumps({"alice": {"role": "user"}}), encoding="utf-8")
        user_store.set_users_path(str(user_path))
        self.addCleanup(user_store.set_users_path, previous_path)
        self.app = Flask(__name__)
        self.app.secret_key = "proxy-contract-test-only"
        self.app.register_blueprint(gateway.learning_agent_bp)
        self.client = self.app.test_client()
        self.peer.requests = []
        self.peer.response_status = 200
        self.peer.response_payload = {"success": True, "data": {"marker": "upstream"}}
        self.cfg = {
            "enabled": True, "host": "127.0.0.1", "port": self.peer.server_port,
            "api_key": "server-test-key", "request_timeout": 2,
        }
        self.addCleanup(patch.stopall)
        patch.object(gateway, "_learning_cfg", side_effect=lambda: self.cfg).start()
        patch.dict(os.environ, {"NEXORALEARNING_RUNTIME_API_KEY": ""}).start()

    def login(self, username="alice"):
        with self.client.session_transaction() as session:
            session["username"] = username

    def test_anonymous_and_deleted_users_never_reach_learning(self):
        self.assertEqual(self.client.get("/api/learning/agent/today").status_code, 401)
        self.login("deleted-user")
        self.assertEqual(self.client.get("/api/learning/agent/today").status_code, 401)
        self.assertEqual(self.peer.requests, [])

    def test_get_binds_session_identity_and_preserves_business_query(self):
        self.login()
        response = self.client.get(
            "/api/learning/agent/events?username=bob&user_id=eve&limit=120",
            headers={"X-Nexora-Username": "mallory", "X-User-Id": "eve", "Authorization": "Bearer client-secret"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), self.peer.response_payload)
        sent = self.peer.requests[0]
        self.assertEqual(sent["path"], "/api/agent/v1/events?limit=120")
        headers = {k.lower(): v for k, v in sent["headers"].items()}
        self.assertEqual(headers["x-nexora-username"], "alice")
        self.assertEqual(headers["x-api-key"], "server-test-key")
        for key in ("cookie", "authorization", "x-user-id"):
            self.assertNotIn(key, headers)

    def test_post_cannot_select_another_user_even_in_nested_tool_arguments(self):
        self.login()
        response = self.client.post("/api/learning/agent/ask-in-context", json={
            "username": "bob", "user_id": "eve", "question": "explain this",
            "target": {"username": "bob", "lecture_id": "course-1"},
            "client_message_id": "turn-1",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.peer.requests[0]["body"], {
            "username": "alice", "question": "explain this",
            "target": {"lecture_id": "course-1"}, "client_message_id": "turn-1",
        })

    def test_route_allowlist_and_json_shape_are_enforced(self):
        self.login()
        for path in ("admin/reset", "toolbox/orchestrate", "tasks/../today", "tasks/id/extra"):
            self.assertEqual(self.client.get("/api/learning/agent/" + path).status_code, 404)
        self.assertEqual(self.client.get("/api/learning/agent/flow/submit").status_code, 404)
        self.assertEqual(self.client.post("/api/learning/agent/plan", json=[]).status_code, 400)
        self.assertEqual(self.client.post("/api/learning/agent/plan", data="{").status_code, 400)
        self.assertEqual(self.peer.requests, [])
        self.assertEqual(self.client.get("/api/learning/agent/tasks/task_123-abc").status_code, 200)

    def test_missing_key_fails_closed_and_environment_key_is_supported(self):
        self.login()
        self.cfg["api_key"] = ""
        response = self.client.get("/api/learning/agent/today")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "LEARNING_AUTH_NOT_CONFIGURED")
        self.assertEqual(self.peer.requests, [])
        with patch.dict(os.environ, {"NEXORALEARNING_RUNTIME_API_KEY": "env-test-key"}):
            self.assertEqual(self.client.get("/api/learning/agent/today").status_code, 200)
        headers = {k.lower(): v for k, v in self.peer.requests[0]["headers"].items()}
        self.assertEqual(headers["x-api-key"], "env-test-key")

    def test_upstream_business_errors_keep_status_but_redirects_are_not_followed(self):
        self.login()
        self.peer.response_status = 403
        self.peer.response_payload = {"success": False, "error": "FORBIDDEN"}
        response = self.client.get("/api/learning/agent/tasks/other-user-task")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "FORBIDDEN")
        self.peer.response_status = 302
        self.peer.requests = []
        self.assertEqual(self.client.get("/api/learning/agent/today").status_code, 502)
        self.assertEqual(len(self.peer.requests), 1)

    def test_upstream_auth_failure_does_not_return_internal_error_body(self):
        self.login()
        self.peer.response_status = 401
        self.peer.response_payload = {"debug": "server-test-key"}
        response = self.client.get("/api/learning/agent/today")
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("server-test-key", response.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
