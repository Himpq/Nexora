"""Safety and procfs parser tests for the admin memory diagnostic routes."""

import os
import sys
import unittest
from unittest.mock import patch

from flask import Flask


SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_DIR = os.path.join(SERVER_DIR, "api")

if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

if API_DIR not in sys.path:
    sys.path.insert(0, API_DIR)

from basis.User import load_users as _load_users
from basis.Permission import session_auth
from App.Observability.stats import stats_bp
from App.Observability.memory_diagnostics import (
    _parse_anonymous_mappings,
    _parse_proc_fields,
)


class MemoryDiagnosticParserTests(unittest.TestCase):
    def test_parse_proc_status_fields(self):
        result = _parse_proc_fields(
            "VmRSS: 12000 kB\nThreads: 7\nName: python\n",
            {"VmRSS", "Threads"},
        )

        self.assertEqual(result, {"VmRSS": 12000, "Threads": 7})

    def test_parse_anonymous_mapping_sizes_without_addresses(self):
        smaps = (
            "100000-102000 rw-p 00000000 00:00 0 [heap]\n"
            "Rss: 1200 kB\nAnonymous: 1200 kB\nSwap: 64 kB\n"
            "102000-104000 r--p 00000000 08:01 123 /lib/example.so\n"
            "Rss: 1800 kB\nAnonymous: 0 kB\nSwap: 0 kB\n"
            "200000-204000 rw-p 00000000 00:00 0\n"
            "Rss: 2200 kB\nAnonymous: 2200 kB\nSwap: 0 kB\n"
        )

        result = _parse_anonymous_mappings(smaps)

        self.assertEqual(result["count"], 2)
        self.assertEqual(result["rss_kb"], 3400)
        self.assertNotIn("address", result["top"][0])
        self.assertEqual(result["top"][0]["kind"], "anonymous")

    def test_memory_route_rejects_anonymous_request(self):
        app = Flask(__name__)
        app.secret_key = "test-only"
        app.register_blueprint(stats_bp)

        response = app.test_client().get("/api/admin/diagnostics/memory")

        self.assertEqual(response.status_code, 401)

    def test_memory_route_requires_admin_session(self):
        app = Flask(__name__)
        app.secret_key = "test-only"
        app.register_blueprint(stats_bp)
        client = app.test_client()

        with patch.object(session_auth, "load_users", return_value={"admin": {}}):
            with client.session_transaction() as session:
                session["username"] = "admin"
                session["role"] = "admin"

            with patch(
                "App.Observability.memory_diagnostics._build_memory_report",
                return_value={"success": True, "test": True},
            ):
                response = client.get("/api/admin/diagnostics/memory")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        self.assertEqual(response.get_json(), {"success": True, "test": True})

    def test_memory_route_rejects_member_session(self):
        app = Flask(__name__)
        app.secret_key = "test-only"
        app.register_blueprint(stats_bp)
        client = app.test_client()

        with patch.object(session_auth, "load_users", return_value={"member": {}}):
            with client.session_transaction() as session:
                session["username"] = "member"
                session["role"] = "member"

            response = client.get("/api/admin/diagnostics/memory")

        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
