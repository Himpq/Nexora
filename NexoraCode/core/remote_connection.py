"""本地 Agent 远程连接；白名单 RPC 只进入本地业务接口。"""
from __future__ import annotations

import json
import re
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit

import requests
from flask import Blueprint, jsonify, request
from core.config import get_app_root
from model.ConversationStore import ConversationStore, write_json_atomic


remote_bp = Blueprint("local_remote", __name__)
_MANAGER = None


def normalize_server_url(value):
    parsed = urlsplit(str(value).strip())

    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise ValueError("服务器地址必须只包含协议和主机")

    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}):
        raise ValueError("远程服务器必须使用 HTTPS")

    if not parsed.hostname:
        raise ValueError("服务器地址缺少主机")

    return f"{parsed.scheme}://{parsed.netloc}"


def allowed_request(method, path):
    """不转发任意 URL、设置、密钥、代理及原始工具执行接口。"""
    rules = {
        "GET": [r"/api/config", r"/api/conversations", r"/api/conversations/conv_[a-f0-9]{10}(?:/messages|/turns)?", r"/api/local/tasks", r"/api/local/tasks/[a-f0-9]{32}/events"],
        "POST": [r"/api/conversations", r"/api/local/tasks", r"/api/local/tasks/[a-f0-9]{32}/cancel", r"/api/agent/permission/grant"],
    }
    return any(re.fullmatch(pattern, path) for pattern in rules.get(method, []))


class RemoteConnection:
    def __init__(self, app):
        self.app = app
        self.path = get_app_root() / "data" / "remote_connection.json"
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.thread = None
        self.ws = None
        self.online = False
        self.error = ""

    def settings(self):
        with self.lock:
            if not self.path.exists():
                return {"enabled": False}

            return json.loads(self.path.read_text(encoding="utf-8"))

    def status(self):
        settings = self.settings()
        return {"enabled": settings.get("enabled", False), "online": self.online, "error": self.error,
                "server_url": settings.get("server_url", ""), "device_id": settings.get("device_id", ""), "name": settings.get("name", "")}

    def pair(self, body):
        url = normalize_server_url(body.get("server_url", ""))
        response = requests.post(url + "/api/nexoracode/claim", json={"code": body.get("code"), "name": body.get("name") or socket.gethostname()}, timeout=15)

        if not response.ok:
            raise ValueError("配对失败，请检查配对码是否有效及服务器地址")

        credentials = response.json()

        if not credentials.get("device_id") or not credentials.get("device_token"):
            raise ValueError("服务器未返回设备凭据")

        self.pause()
        credentials.update(server_url=url, name=body.get("name") or socket.gethostname(), enabled=True)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        write_json_atomic(self.path, credentials)
        self.start()

    def pause(self):
        self.stop.set()

        if self.ws:
            self.ws.close()

        if self.thread and self.thread is not threading.current_thread():
            self.thread.join(timeout=12)

            if self.thread.is_alive():
                raise RuntimeError("旧连接尚未关闭，请稍后重试")

        self.online = False

    def set_enabled(self, enabled):
        settings = self.settings()

        if enabled and not settings.get("device_token"):
            raise ValueError("请先配对电脑")

        self.pause()
        settings["enabled"] = enabled
        self.path.parent.mkdir(parents=True, exist_ok=True)
        write_json_atomic(self.path, settings)

        if enabled:
            self.start()

    def start(self):
        if not self.settings().get("enabled"):
            return

        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True, name="nc-remote")
        self.thread.start()

    def dispatch(self, payload):
        method = str(payload.get("method", "GET")).upper()
        path = str(payload.get("path", ""))

        if not allowed_request(method, path):
            return {"status": 403, "body": {"message": "远程接口不在允许范围内"}}

        if method == "POST" and path == "/api/conversations":
            # 项目只能来自电脑已存在的项目登记，不能远程伪造路径扩大授权范围。
            data = payload.get("body") or {}
            project = (data.get("metadata") or {}).get("nexoracode_project")

            if project:
                known = [(row.get("metadata") or {}).get("nexoracode_project") for row in ConversationStore().list()]

                if project not in known:
                    return {"status": 403, "body": {"message": "请先在电脑登记该项目"}}

        with self.app.test_client() as client:
            response = client.open(path, method=method, json=payload.get("body") if method == "POST" else None,
                                   query_string=payload.get("query") if method == "GET" else None)
            result = response.get_json()

            if result is None:
                return {"status": 502, "body": {"message": "本地接口返回了非 JSON 响应"}}

            return {"status": response.status_code, "body": result}

    def run(self):
        import websocket

        backoff = 1

        while not self.stop.is_set():
            settings = self.settings()
            ws = None

            try:
                url = normalize_server_url(settings["server_url"])
                ws_url = ("wss" if url.startswith("https:") else "ws") + "://" + urlsplit(url).netloc + "/ws/nexoracode"
                ws = websocket.create_connection(ws_url, timeout=10)
                self.ws = ws
                send_lock = threading.Lock()
                ws.send(json.dumps({"type": "auth", "device_id": settings["device_id"], "device_token": settings["device_token"]}))

                if json.loads(ws.recv()).get("type") != "auth_ok":
                    raise ValueError("设备认证失败，请重新配对")

                self.online = True
                self.error = ""
                backoff = 1
                ws.settimeout(2)
                last_ping = time.monotonic()

                def handle(message):
                    try:
                        result = self.dispatch(message["payload"])
                    except Exception as exc:
                        print(f"[NexoraRemote] rpc_failed error={type(exc).__name__}")
                        result = {"status": 500, "body": {"message": "电脑处理请求失败，请查看本地日志"}}

                    with send_lock:
                        ws.send(json.dumps({"type": "rpc_result", "request_id": message["request_id"], "result": result}, ensure_ascii=False))

                with ThreadPoolExecutor(max_workers=4) as pool:
                    while not self.stop.is_set():
                        if time.monotonic() - last_ping > 15:
                            with send_lock:
                                ws.send(json.dumps({"type": "ping"}))

                            last_ping = time.monotonic()

                        try:
                            raw = ws.recv()
                        except websocket.WebSocketTimeoutException:
                            continue

                        if not raw:
                            raise ConnectionError("连接关闭")

                        message = json.loads(raw)

                        if message.get("type") == "rpc":
                            pool.submit(handle, message)
            except Exception as exc:
                self.error = "远程连接中断，正在重连；请检查网络和设备配对"
                print(f"[NexoraRemote] connection_failed error={type(exc).__name__}")
            finally:
                self.online = False

                if ws:
                    ws.close()

                self.ws = None

            self.stop.wait(backoff)
            backoff = min(backoff * 2, 30)


@remote_bp.before_request
def check_local_origin():
    origin = request.headers.get("Origin")

    if origin and origin.rstrip("/") != request.host_url.rstrip("/"):
        return jsonify({"message": "禁止跨站修改远程连接"}), 403


@remote_bp.route("/api/local/remote", methods=["GET", "POST"])
def configure_remote():
    try:
        if request.method == "POST":
            body = request.get_json() or {}

            if body.get("action") == "pair":
                _MANAGER.pair(body)
            elif body.get("action") == "enable" and isinstance(body.get("enabled"), bool):
                _MANAGER.set_enabled(body["enabled"])
            else:
                raise ValueError("远程连接操作无效")

        return jsonify(_MANAGER.status())
    except (ValueError, RuntimeError, requests.RequestException) as exc:
        return jsonify({"message": str(exc)}), 400


def install_remote(app):
    global _MANAGER
    _MANAGER = RemoteConnection(app)
    app.register_blueprint(remote_bp)
    return _MANAGER
