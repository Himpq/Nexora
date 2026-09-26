"""隔离远程网关和本地任务；全部凭据和会话均由测试临时生成。"""
import json
import threading
import time
import types
import unittest
import sys
import os
from pathlib import Path

import test_context_manager as fixtures
from test_context_manager import ROOT, module


class RemoteTests(unittest.TestCase):
    def setUp(self):
        fixtures.ContextTests.setUp(self)
        self.runtime = module("test_model.StreamRuntime", ROOT / "model/StreamRuntime.py")
        self.tasks = module("test_model.TaskService", ROOT / "model/TaskService.py")
        self.gateway_module = module("test_gateway", ROOT.parent / "ChatDBServer/api/App/Agent/remote_gateway.py")
        self.gateway = self.gateway_module.DeviceGateway(Path(self.temp.name) / "cloud/devices.json")

    def tearDown(self):
        fixtures.ContextTests.tearDown(self)

    def test_pair_is_single_use_and_owner_scoped(self):
        code = self.gateway.pairing_code("alice")
        device = self.gateway.claim(code, "computer")
        self.assertEqual(self.gateway.authenticate(device["device_id"], device["device_token"]), "alice")
        self.assertEqual(self.gateway.list_devices("bob"), [])
        with self.assertRaises(ValueError):
            self.gateway.claim(code, "another")
        with self.assertRaises(ValueError):
            self.gateway.authenticate(device["device_id"], "wrong")
        with self.assertRaises(PermissionError):
            self.gateway.rpc("bob", device["device_id"], {})
        self.assertNotIn(device["device_token"], self.gateway.path.read_text())

    def test_gateway_only_transfers_rpc_without_history_files(self):
        device = self.gateway.claim(self.gateway.pairing_code("alice"), "computer")
        gateway = self.gateway
        connection = {"send_lock": threading.Lock()}

        class Socket:
            def send(self, raw):
                message = json.loads(raw)
                gateway.complete(connection, message["request_id"], {"status": 200, "body": {"text": "private test history"}})

        connection["ws"] = Socket()
        gateway.connections[device["device_id"]] = connection
        result = gateway.rpc("alice", device["device_id"], {"path": "/api/conversations"})
        self.assertEqual(result["body"]["text"], "private test history")
        self.assertEqual(gateway.pending, {})
        self.assertNotIn("private test history", gateway.path.read_text())
        gateway.disconnect(device["device_id"], connection)
        with self.assertRaises(ConnectionError):
            gateway.rpc("alice", device["device_id"], {})

    def test_task_retry_never_reexecutes_and_journal_replays(self):
        starts = []
        gate = threading.Event()

        def factory(body):
            def worker(push, set_cid, stage, cancelled):
                starts.append(body["message"])
                push({"type": "content", "content": "中文执行事件"})
                gate.wait(2)
            return worker

        self.tasks.set_worker_factory(factory)
        body = {"request_id": "request-123", "conversation_id": self.cid, "message": "test"}
        first = self.tasks.start_task(body)
        second = self.tasks.start_task(body)
        self.assertEqual(first["stream_id"], second["stream_id"])
        with self.assertRaises(ValueError):
            self.tasks.start_task({**body, "message": "different"})
        with self.assertRaises(ValueError):
            self.tasks.start_task({**body, "request_id": "request-456"})
        gate.set()
        for _ in range(100):
            if self.runtime.get_session_meta(first["stream_id"])["status"] == "done":
                break
            time.sleep(0.01)
        self.assertEqual(starts, ["test"])
        journal = module("test_model.SessionJournal", ROOT / "model/SessionJournal.py")
        chunks, metadata = journal.SessionJournal().read(first["stream_id"], 0, 200)
        self.assertEqual(chunks[0]["content"], "中文执行事件")
        self.assertEqual(metadata["status"], "done")
        self.assertEqual(journal.SessionJournal().read(first["stream_id"], 1, 200)[0], [])

    def test_interrupted_process_does_not_resume_worker(self):
        journal_module = module("test_model.SessionJournal", ROOT / "model/SessionJournal.py")
        journal = journal_module.SessionJournal()
        sid = "a" * 32
        journal.save_meta({"stream_id": sid, "status": "running"})
        journal_module._PROCESS_SESSIONS.clear()
        _, metadata = journal.read(sid, 0, 200)
        self.assertEqual(metadata["status"], "interrupted")

    def test_cloud_routes_reject_cross_account_and_cross_origin(self):
        from flask import Flask
        app = Flask("isolated_remote", root_path=self.temp.name)
        app.secret_key = "temporary-test-key"
        app.register_blueprint(self.gateway_module.remote_gateway_bp)
        client = app.test_client()
        self.assertEqual(client.get("/api/nexoracode/devices").status_code, 401)
        with client.session_transaction() as session:
            session["username"] = "alice"
        self.assertEqual(client.post("/api/nexoracode/pair", headers={"Origin": "https://wrong.example"}).status_code, 403)
        code = client.post("/api/nexoracode/pair").get_json()["code"]
        device = client.post("/api/nexoracode/claim", json={"code": code}).get_json()
        with client.session_transaction() as session:
            session["username"] = "bob"
        self.assertEqual(client.get("/api/nexoracode/devices").get_json()["devices"], [])
        response = client.post(f'/api/nexoracode/devices/{device["device_id"]}/rpc', json={})
        self.assertEqual(response.status_code, 404)

    def test_real_websocket_transfers_local_task_and_replays_events(self):
        from flask import Flask, jsonify
        from werkzeug.serving import make_server

        cloud = Flask("test_cloud", root_path=self.temp.name)
        cloud.secret_key = "test-only-secret"
        cloud.register_blueprint(self.gateway_module.remote_gateway_bp)
        gateway = cloud.extensions["nexoracode_gateway"]
        server = make_server("127.0.0.1", 0, cloud, threaded=True)
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        local = Flask("test_local")
        local.register_blueprint(self.tasks.task_bp)

        @local.get("/api/conversations")
        def conversations():
            return jsonify({"conversations": self.store.list()})

        def factory(body):
            def worker(push, set_cid, stage, cancelled):
                push({"type": "content", "content": "模型在电脑执行的测试结果"})
            return worker

        self.tasks.set_worker_factory(factory)
        sys.modules["model"] = sys.modules["test_model"]
        sys.modules["model.ConversationStore"] = self.store_module
        remote = module("isolated_remote_connection", ROOT / "core/remote_connection.py")
        connection = remote.RemoteConnection(local)

        try:
            code = gateway.pairing_code("alice")
            connection.pair({"server_url": f"http://127.0.0.1:{server.server_port}", "code": code, "name": "test computer"})

            for _ in range(200):
                if connection.online:
                    break
                time.sleep(0.025)

            self.assertTrue(connection.online, connection.error)
            device_id = connection.status()["device_id"]
            self.assertNotIn("device_token", connection.status())
            result = gateway.rpc("alice", device_id, {"path": "/api/local/tasks", "method": "POST", "body": {
                "request_id": "ws-request-123", "conversation_id": self.cid, "message": "test task",
            }})
            self.assertEqual(result["status"], 200)
            sid = result["body"]["stream_id"]

            for _ in range(100):
                replay = gateway.rpc("alice", device_id, {"path": f"/api/local/tasks/{sid}/events", "query": {"after": 0}})
                if replay["body"]["session"]["status"] == "done":
                    break
                time.sleep(0.01)

            self.assertEqual(replay["body"]["events"][0]["content"], "模型在电脑执行的测试结果")
            denied = gateway.rpc("alice", device_id, {"path": "/api/local/settings"})
            self.assertEqual(denied["status"], 403)
            self.assertEqual(gateway.pending, {})
            self.assertNotIn("测试结果", gateway.path.read_text(encoding="utf-8"))
            connection.set_enabled(False)
            self.assertFalse(connection.online)
        finally:
            connection.pause()
            server.shutdown()
            server.server_close()

    def test_short_command_cancel_terminates_process_tree(self):
        package = types.ModuleType("test_tools")
        package.__path__ = [str(ROOT / "local/tools")]
        sys.modules["test_tools"] = package
        command = module("test_tools.CommandRuntime", ROOT / "local/tools/CommandRuntime.py")
        cancelled = threading.Event()
        timer = threading.Timer(0.3, cancelled.set)
        timer.start()
        started = time.monotonic()

        try:
            with self.assertRaisesRegex(RuntimeError, "stream_cancelled"):
                command.run_command(f'"{sys.executable}" -c "import time; time.sleep(30)"',
                                    cwd=self.temp.name, env={}, timeout=40, cancel_checker=cancelled.is_set)
            self.assertLess(time.monotonic() - started, 5)
        finally:
            timer.cancel()

    def test_worker_failure_reports_one_error_and_keeps_failed_state(self):
        journal = module("test_model.SessionJournal", ROOT / "model/SessionJournal.py")

        def factory(body):
            def worker(push, set_cid, stage, cancelled):
                push({"type": "error", "message": "本地对话失败: 磁盘已满"})
                raise RuntimeError("磁盘已满")
            return worker

        self.tasks.set_worker_factory(factory)
        record = self.tasks.start_task({"request_id": "error-once-1", "conversation_id": self.cid, "message": "test"})
        sid = record["stream_id"]

        for _ in range(200):
            if self.runtime.get_session_meta(sid)["status"] != "running":
                break
            time.sleep(0.01)

        chunks, metadata = journal.SessionJournal().read(sid, 0, 200)
        errors = [chunk for chunk in chunks if chunk.get("type") == "error"]
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]["message"], "本地对话失败: 磁盘已满")
        self.assertEqual(metadata["error"], "磁盘已满")

    def test_unreported_worker_failure_still_produces_error_chunk(self):
        journal = module("test_model.SessionJournal", ROOT / "model/SessionJournal.py")

        def factory(body):
            def worker(push, set_cid, stage, cancelled):
                raise ValueError("未上报的失败")
            return worker

        self.tasks.set_worker_factory(factory)
        record = self.tasks.start_task({"request_id": "error-silent-1", "conversation_id": self.cid, "message": "test"})
        sid = record["stream_id"]

        for _ in range(200):
            if self.runtime.get_session_meta(sid)["status"] != "running":
                break
            time.sleep(0.01)

        chunks, _ = journal.SessionJournal().read(sid, 0, 200)
        errors = [chunk for chunk in chunks if chunk.get("type") == "error"]
        self.assertEqual(len(errors), 1)
        self.assertIn("未上报的失败", errors[0]["content"])

    def test_cleanup_keeps_running_session_and_removes_finished_one(self):
        release = threading.Event()
        other_cid = self.store.create()["conversation_id"]

        def factory(body):
            def worker(push, set_cid, stage, cancelled):
                release.wait(5)
            return worker

        self.tasks.set_worker_factory(factory)
        running = self.tasks.start_task({"request_id": "cleanup-run-1", "conversation_id": self.cid, "message": "test"})["stream_id"]

        def finished_worker(push, set_cid, stage, cancelled):
            push({"type": "done"})

        self.tasks.set_worker_factory(lambda body: finished_worker)
        done = self.tasks.start_task({"request_id": "cleanup-done-1", "conversation_id": other_cid, "message": "test"})["stream_id"]

        for _ in range(200):
            if self.runtime.get_session_meta(done)["status"] != "running":
                break
            time.sleep(0.01)

        try:
            # 直接回拨 updated_at 模拟超长任务：运行中的会话不能因 TTL 被回收，否则仍在跑的 worker 会失去可续读 session。
            for sid in (running, done):
                self.runtime._SESSIONS[sid]["updated_at"] = time.time() - 86400

            self.runtime.cleanup_sessions()
            self.assertIn(running, self.runtime._SESSIONS)
            self.assertNotIn(done, self.runtime._SESSIONS)
        finally:
            release.set()

        # 等待 worker 真正结束，避免 tearDown 删临时目录时它还在写日志。
        for _ in range(500):
            if self.runtime.get_session_meta(running)["status"] == "running":
                time.sleep(0.01)
                continue
            break

    def test_usage_record_totals_raw_input_and_reports_cache_rate(self):
        routes = module("test_model.Routes", ROOT / "model/Routes.py")
        record = routes._usage_record(
            {"raw_input": 4000, "cached_input": 3000, "cached_tokens_source": "prompt_tokens_details.cached_tokens",
             "output": 120, "reasoning_tokens": 45},
            action="chat", detail_ref="conv_x:3", conversation_id="conv_x",
            conversation_title="测试会话", timestamp="2026-01-01 10:00:00", model="m1",
            response_trace_id="a" * 32, round_index=2,
        )
        # 合计 = 原始输入 + 输出，缓存命中不从总量扣减。
        self.assertEqual(record["total_tokens"], 4120)
        self.assertEqual(record["raw_input_tokens"], 4000)
        # 计费输入 = 原始输入 - 缓存命中。
        self.assertEqual(record["input_tokens"], 1000)
        self.assertEqual(record["effective_input_tokens"], 1000)
        self.assertEqual(record["cached_tokens"], 3000)
        self.assertEqual(record["cached_input_tokens"], 3000)
        self.assertEqual(record["cached_tokens_source"], "prompt_tokens_details.cached_tokens")
        self.assertEqual(record["cache_hit_rate"], 0.75)
        self.assertEqual(record["reasoning_tokens"], 45)
        self.assertEqual(record["response_trace_id"], "a" * 32)
        self.assertEqual(record["round_index"], 2)

    def test_usage_record_clamps_cache_and_handles_missing_raw_input(self):
        routes = module("test_model.Routes", ROOT / "model/Routes.py")
        clamped = routes._usage_record(
            {"raw_input": 100, "cached_input": 900, "output": 5},
            action="chat", detail_ref="c:0", conversation_id="c", conversation_title="t",
            timestamp="", model="m",
        )
        self.assertEqual(clamped["cached_tokens"], 100)
        self.assertEqual(clamped["input_tokens"], 0)
        self.assertEqual(clamped["cache_hit_rate"], 1.0)

        empty = routes._usage_record({}, action="chat", detail_ref="c:1", conversation_id="c",
                                    conversation_title="t", timestamp="", model="m")
        self.assertEqual(empty["total_tokens"], 0)
        self.assertEqual(empty["cache_hit_rate"], 0.0)
        self.assertEqual(empty["round_index"], 0)

    def test_token_stats_endpoint_aggregates_cache_hit_rate(self):
        from flask import Flask

        routes = module("test_model.Routes", ROOT / "model/Routes.py")
        app = Flask("isolated_tokens", root_path=self.temp.name)
        app.register_blueprint(routes._local_bp)
        client = app.test_client()

        self.store.append_message(self.cid, {"role": "user", "content": "问题"})
        self.store.append_message(self.cid, {"role": "assistant", "content": "回答", "metadata": {
            "model_name": "m1", "response_trace_id": "b" * 32, "round_index": 1,
            "io_tokens": {"input": 1000, "raw_input": 4000, "cached_input": 3000, "output": 50},
        }})
        self.store.append_message(self.cid, {"role": "user", "content": "再问"})
        self.store.append_message(self.cid, {"role": "assistant", "content": "再答", "metadata": {
            "model_name": "m1", "response_trace_id": "c" * 32, "round_index": 1,
            "io_tokens": {"input": 500, "raw_input": 1000, "cached_input": 0, "output": 20},
        }})

        stats = client.get(f"/api/tokens/stats?conversation_id={self.cid}").get_json()
        self.assertTrue(stats["success"])
        self.assertEqual(stats["raw_input_total"], 5000)
        self.assertEqual(stats["cached_input_total"], 3000)
        # 总量按原始输入计。
        self.assertEqual(stats["total"], 5070)
        self.assertEqual(stats["cache_hit_rate"], 0.6)
        self.assertEqual(len(stats["history"]), 2)
        self.assertEqual(sorted(row["cache_hit_rate"] for row in stats["history"]), [0.0, 0.75])

        detail = client.get(f"/api/tokens/detail?ref={self.cid}:1").get_json()["detail"]
        self.assertEqual(detail["total_tokens"], 4050)
        self.assertEqual(detail["cache_hit_rate"], 0.75)
        self.assertEqual(detail["round_index"], 1)
        self.assertEqual(detail["response_trace_id"], "b" * 32)

    def test_isolated_route_update_preserves_separate_methods(self):
        updater = module("test_route_updater", ROOT.parent / "ChatDBServer/tests/update_route_baseline.py")
        directory = Path(self.temp.name) / "route_update"
        tests = directory / "tests"
        tests.mkdir(parents=True)
        updater.TESTS_DIR = str(tests)
        baseline = tests / "baseline_routes.json"
        baseline.write_text(json.dumps({"routes": [["/existing", ["GET"]], ["/existing", ["POST"]]]}), encoding="utf-8")
        (directory / "addition.py").write_text(
            "from flask import Blueprint\nbp = Blueprint('addition', __name__)\n@bp.route('/new')\ndef added(): return {}\n", encoding="utf-8")
        self.assertEqual(updater.add_blueprint_routes("addition.py", "bp"), 3)
        self.assertEqual(updater.add_blueprint_routes("addition.py", "bp"), 3)
        rows = json.loads(baseline.read_text(encoding="utf-8"))["routes"]
        self.assertIn(["/existing", ["GET"]], rows)
        self.assertIn(["/existing", ["POST"]], rows)


if __name__ == "__main__":
    unittest.main()
