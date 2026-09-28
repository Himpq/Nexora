"""Run adapter requests through the sibling services' actual route functions.

Only embedding/storage and network transport are replaced. Loading selected
functions avoids booting Chroma, mail listeners or browser crawlers in tests.
"""
from __future__ import annotations

import __future__
import ast
import functools
import hashlib
import io
import json
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import urlsplit

from flask import Flask, g, jsonify, request
from core import toolbox

ROOT = Path(__file__).resolve().parents[2]


def source_functions(relative, names, namespace):
    path = ROOT / relative
    tree = ast.parse(path.read_text(encoding="utf-8-sig"))
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert {node.name for node in selected} == set(names)
    for node in selected:
        node.decorator_list = []
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(path), "exec",
                 flags=__future__.annotations.compiler_flag), namespace)


class Collection:
    def __init__(self):
        self.rows = {}

    def upsert(self, *, ids, documents, metadatas, **_):
        self.rows.update({key: (doc, meta) for key, doc, meta in zip(ids, documents, metadatas)})

    def query(self, *, n_results, **_):
        rows = list(self.rows.values())[:n_results]
        return {"documents": [[row[0] for row in rows]], "metadatas": [[row[1] for row in rows]]}


class ToolboxContracts(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.cfg = {"data_dir": self.directory.name,
                    "nexoradb": {"service_url": "http://db.local", "api_key": "db-test"},
                    "nexorasearch": {"service_url": "http://search.local", "api_key": "search-test"},
                    "nexora_mail": {"service_url": "http://mail.local", "api_key": "mail-test"}}
        self.collections = {}
        base = {"request": request, "jsonify": jsonify, "g": g, "hashlib": hashlib, "wraps": functools.wraps}
        db = {**base, "CONFIG": {"api_key": "db-test"}, "embed_texts": lambda texts: [[1.] for _ in texts],
              "get_collection": lambda user: self.collections.setdefault(user, Collection())}
        source_functions("NexoraDB/app.py", ["require_api_key", "_normalize_library", "_build_where_with_library", "safe_id", "upsert_texts", "query_text"], db)
        db_app = Flask("db_contract")
        db_app.before_request(lambda: None if db["require_api_key"]() else (jsonify({"success": False}), 401))
        db_app.add_url_rule("/upsert_texts", view_func=db["upsert_texts"], methods=["POST"])
        db_app.add_url_rule("/query_text", view_func=db["query_text"], methods=["POST"])

        self.search_calls = []
        def search_clean(query, max_results, fetch_content):
            self.search_calls.append((query, max_results, fetch_content))
            return {"success": True, "results": [{"title": "Search result", "url": "https://example.org/article", "snippet": query}]}
        search = {**base, "config": {"auth": {"required": True, "token": "search-test"}}, "search_clean": search_clean}
        source_functions("NexoraSearch/app.py", ["require_auth", "api_search_ddg"], search)
        search_app = Flask("search_contract")
        search_app.add_url_rule("/api/search/ddg", view_func=search["require_auth"](search["api_search_ddg"]))

        mail = {**base, "_get_expected_api_key": lambda: "mail-test",
                "_get_user": lambda group, user: (group, None, user, {"path": user}),
                "_list_mails": lambda path: [{"id": "mail-1", "sender": "teacher@example.org", "subject": "Homework",
                                               "preview_text": "preview only", "is_read": False}],
                "_mail_dir_for": lambda path, key: path + "/" + key, "_safe_commonpath": lambda *args: True,
                "os": types.SimpleNamespace(path=types.SimpleNamespace(isdir=lambda path: True)),
                "_load_mail_entry": lambda path, **kwargs: {"id": "mail-1", "sender": "teacher@example.org", "subject": "Homework", "preview_text": "preview only", "content_text": "The complete homework body."}}
        source_functions("NexoraMail/api/server.py", ["_extract_token", "require_api_token", "list_user_mails", "get_user_mail"], mail)
        mail_app = Flask("mail_contract")
        mail_app.add_url_rule("/api/mailboxes/<group>/<username>/mails", view_func=mail["require_api_token"](mail["list_user_mails"]))
        mail_app.add_url_rule("/api/mailboxes/<group>/<username>/mails/<mail_id>", view_func=mail["require_api_token"](mail["get_user_mail"]))
        self.clients = {"db.local": db_app.test_client(), "search.local": search_app.test_client(), "mail.local": mail_app.test_client()}
        self.requests = []
        def urlopen(req, timeout):
            parsed = urlsplit(req.full_url)
            self.requests.append((parsed.hostname, req.get_method(), parsed.path, dict(req.headers)))
            response = self.clients[parsed.hostname].open(parsed.path + ("?" + parsed.query if parsed.query else ""),
                       method=req.get_method(), data=req.data, headers=dict(req.headers))
            if response.status_code >= 400:
                raise HTTPError(req.full_url, response.status_code, response.status, {}, io.BytesIO(response.data))
            return io.BytesIO(response.data)
        self.network = patch.object(toolbox.urllib.request, "urlopen", side_effect=urlopen)
        self.network.start()
        self.addCleanup(self.network.stop)

    def test_real_db_contract_preserves_identity_and_retry_is_an_upsert(self):
        first = toolbox.kb_upsert(self.cfg, "alice", "default", ["Fourier notes"])
        again = toolbox.kb_upsert(self.cfg, "alice", "default", ["Fourier notes"])
        self.assertTrue(first["ok"])
        self.assertTrue(again["ok"])
        self.assertEqual(len(self.collections["alice"].rows), 1)
        found = toolbox.kb_query(self.cfg, "alice", "default", "Fourier")
        self.assertEqual(found["cards"][0]["excerpt"], "Fourier notes")
        self.assertEqual(toolbox.kb_query(self.cfg, "bob", "default", "Fourier")["cards"], [])

    def test_real_search_route_receives_auth_query_and_limit(self):
        result = toolbox.web_search(self.cfg, "alice", "Fourier transform", limit=2)
        self.assertTrue(result["ok"])
        self.assertEqual(self.search_calls, [("Fourier transform", 2, False)])
        self.assertEqual(result["card"]["findings"][0]["url"], "https://example.org/article")

    def test_real_mail_routes_receive_auth_and_read_full_body(self):
        result = toolbox.mail_fetch(self.cfg, "alice", include_content=True)
        self.assertTrue(result["ok"])
        card = result["cards"][0]
        self.assertEqual(card["from"], "teacher@example.org")
        self.assertEqual(card["summary"], "preview only")
        self.assertEqual(card["content"], "The complete homework body.")
        self.assertFalse(toolbox.mail_fetch(self.cfg, "alice", user="bob")["ok"])

    def test_auth_or_business_failures_cannot_be_reported_as_success(self):
        self.cfg["nexora_mail"]["api_key"] = "wrong"
        self.assertFalse(toolbox.mail_fetch(self.cfg, "alice")["ok"])
        with patch.object(toolbox, "_http_json", return_value={"success": False, "message": "backend rejected"}):
            self.assertFalse(toolbox.kb_upsert(self.cfg, "alice", "default", ["x"])["ok"])
            self.assertFalse(toolbox.web_search(self.cfg, "alice", "x")["ok"])


if __name__ == "__main__":
    unittest.main()
