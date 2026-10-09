"""NexoraCode 设备网关：仅转发请求，绝不保存会话、任务或执行事件。"""
from __future__ import annotations

import hashlib
import json
import secrets
import threading
import time
import urllib.parse as urllib_parse
import uuid
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, session


remote_gateway_bp = Blueprint("remote_gateway", __name__)


class DeviceGateway:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()
        self.pairs = {}
        self.connections = {}
        self.pending = {}

    def _devices(self):
        if not self.path.exists():
            return {}

        return json.loads(self.path.read_text(encoding="utf-8"))

    def _save(self, devices):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(devices, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self.path)

    def pairing_code(self, owner):
        with self.lock:
            now = time.time()
            self.pairs = {code: value for code, value in self.pairs.items() if value[1] > now}
            code = secrets.token_hex(8).upper()
            self.pairs[code] = (owner, now + 300)
            return code

    def claim(self, code, name):
        with self.lock:
            pair = self.pairs.pop(code, None)

            if pair is None or pair[1] <= time.time():
                raise ValueError("配对码无效或已过期")

            device_id = uuid.uuid4().hex
            token = secrets.token_urlsafe(32)
            devices = self._devices()
            devices[device_id] = {"owner": pair[0], "name": name[:80], "token_hash": hashlib.sha256(token.encode()).hexdigest()}
            self._save(devices)
            return {"device_id": device_id, "device_token": token}

    def authenticate(self, device_id, token):
        with self.lock:
            device = self._devices().get(device_id)

            if not device or not secrets.compare_digest(device["token_hash"], hashlib.sha256(token.encode()).hexdigest()):
                raise ValueError("设备凭据无效")

            return device["owner"]

    def list_devices(self, owner):
        with self.lock:
            return [{"device_id": key, "name": value["name"], "online": key in self.connections}
                    for key, value in self._devices().items() if value["owner"] == owner]

    def revoke(self, owner, device_id):
        with self.lock:
            devices = self._devices()

            if device_id not in devices or devices[device_id]["owner"] != owner:
                raise PermissionError("设备不存在")

            del devices[device_id]
            self._save(devices)
            connection = self.connections.pop(device_id, None)

        if connection:
            connection["ws"].close()

    def rpc(self, owner, device_id, payload, timeout=30):
        with self.lock:
            device = self._devices().get(device_id)

            if not device or device["owner"] != owner:
                raise PermissionError("设备不存在")

            connection = self.connections.get(device_id)

            if not connection:
                raise ConnectionError("电脑离线，无法读取历史或执行任务")

            request_id = uuid.uuid4().hex
            pending = {"device_id": device_id, "connection": connection, "event": threading.Event(), "result": None}
            self.pending[request_id] = pending

        try:
            with connection["send_lock"]:
                connection["ws"].send(json.dumps({"type": "rpc", "request_id": request_id, "payload": payload}, ensure_ascii=False))

            if not pending["event"].wait(timeout):
                raise TimeoutError("电脑响应超时；请查询任务状态，勿重复发送新任务")

            if pending["result"] is None:
                raise ConnectionError("电脑连接中断，任务可能仍在电脑运行")

            return pending["result"]
        finally:
            with self.lock:
                self.pending.pop(request_id, None)

    def complete(self, connection, request_id, result):
        with self.lock:
            pending = self.pending.get(request_id)

            if pending and pending["connection"] is connection:
                pending["result"] = result
                pending["event"].set()

    def disconnect(self, device_id, connection):
        with self.lock:
            if self.connections.get(device_id) is connection:
                del self.connections[device_id]

            for pending in self.pending.values():
                if pending["connection"] is connection:
                    pending["event"].set()


def _gateway():
    return current_app.extensions["nexoracode_gateway"]


def _normalize_origin(value: str) -> str:
    """归一化来源字符串：去掉末尾斜杠与默认端口。

    nginx 的 X-Host 带 ":443"/":80"，而浏览器的 Origin 不带默认端口，
    不归一化就会把同源请求判成跨站。
    """
    text = str(value or "").strip().rstrip("/")
    if not text:
        return ""

    parts = urllib_parse.urlsplit(text)

    if not parts.scheme or not parts.netloc:
        return text.lower()

    host = parts.hostname or ""
    port = parts.port

    if port and not ((parts.scheme == "https" and port == 443) or (parts.scheme == "http" and port == 80)):
        host = f"{host}:{port}"

    return f"{parts.scheme.lower()}://{host.lower()}"


def _public_origin() -> str:
    """从反向代理头还原浏览器实际访问的来源。

    123 的 nginx 覆盖 Host，并用 X-Forwarded-Proto 传递外部协议；Flask 收到的连接
    本身是 HTTP，因此只读 request.host_url 会把 HTTPS 页面误判成 HTTP。X-Scheme / X-Host
    仍供使用这组自定义头的部署读取；没有代理协议头时按直连请求处理。
    """
    scheme = str(
        request.headers.get("X-Scheme")
        or request.headers.get("X-Forwarded-Proto")
        or ""
    ).split(",")[0].strip()
    host = str(request.headers.get("X-Host") or request.host or "").split(",")[0].strip()

    if scheme and host:
        return _normalize_origin(f"{scheme}://{host}")

    return _normalize_origin(request.host_url)


@remote_gateway_bp.before_request
def _check_remote_access():
    # 带浏览器 Origin 的请求必须同源，防止第三方网页借登录 cookie 控制电脑。
    origin = request.headers.get("Origin")

    if origin and _normalize_origin(origin) != _public_origin():
        return jsonify({"message": "禁止跨站远程请求"}), 403

    if request.endpoint != "remote_gateway.claim" and not session.get("username"):
        return jsonify({"message": "请先登录"}), 401


@remote_gateway_bp.after_request
def _no_store(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@remote_gateway_bp.route("/api/nexoracode/pair", methods=["POST"])
def pair():
    return jsonify({"code": _gateway().pairing_code(session["username"]), "expires_in": 300})


@remote_gateway_bp.route("/api/nexoracode/claim", methods=["POST"])
def claim():
    body = request.get_json() or {}

    try:
        return jsonify(_gateway().claim(str(body.get("code") or "").strip().upper(), str(body.get("name") or "我的电脑")))
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 400


@remote_gateway_bp.route("/api/nexoracode/devices", methods=["GET"])
def devices():
    return jsonify({"devices": _gateway().list_devices(session["username"])})


@remote_gateway_bp.route("/api/nexoracode/devices/<device_id>", methods=["DELETE"])
def revoke(device_id):
    try:
        _gateway().revoke(session["username"], device_id)
        return jsonify({"success": True})
    except PermissionError as exc:
        return jsonify({"message": str(exc)}), 404


@remote_gateway_bp.route("/api/nexoracode/devices/<device_id>/rpc", methods=["POST"])
def rpc(device_id):
    try:
        result = _gateway().rpc(session["username"], device_id, request.get_json() or {})
        return jsonify(result.get("body")), int(result.get("status", 502))
    except PermissionError as exc:
        return jsonify({"message": str(exc)}), 404
    except ConnectionError as exc:
        return jsonify({"message": str(exc)}), 409
    except TimeoutError as exc:
        return jsonify({"message": str(exc)}), 504


@remote_gateway_bp.record_once
def _install(state):
    from flask_sock import Sock

    app = state.app
    gateway = DeviceGateway(Path(app.root_path) / "data" / "nexoracode" / "devices.json")
    app.extensions["nexoracode_gateway"] = gateway
    sock = Sock(app)

    @sock.route("/ws/nexoracode")
    def device_socket(ws):
        device_id = ""
        connection = None

        try:
            auth = json.loads(ws.receive(timeout=10) or "{}")

            if auth.get("type") != "auth":
                raise ValueError("首帧必须认证")

            device_id = str(auth.get("device_id") or "")
            connection = {"ws": ws, "send_lock": threading.Lock()}

            with gateway.lock:
                gateway.authenticate(device_id, str(auth.get("device_token") or ""))
                old = gateway.connections.get(device_id)
                gateway.connections[device_id] = connection

            if old:
                old["ws"].close()

            ws.send(json.dumps({"type": "auth_ok"}))
            print(f"[NexoraRemote] connected device={device_id}")

            while True:
                raw = ws.receive(timeout=45)

                if raw is None:
                    break

                payload = json.loads(raw)

                if payload.get("type") == "ping":
                    with connection["send_lock"]:
                        ws.send(json.dumps({"type": "pong"}))
                elif payload.get("type") == "rpc_result":
                    gateway.complete(connection, payload.get("request_id"), payload.get("result"))
        except Exception as exc:
            # 不记录凭据、请求正文或对话内容。
            print(f"[NexoraRemote] disconnected device={device_id} error={type(exc).__name__}")
        finally:
            if connection:
                gateway.disconnect(device_id, connection)

            ws.close()
