"""
本地 HTTP 服务
- 接收 Nexora 服务器的工具执行回调
- 作为本地反向代理，统一前端来源到 localhost，降低跨站登录态限制
"""

import logging
import re
import mimetypes
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import requests
from flask import Flask, request, jsonify, Response, stream_with_context, render_template

try:
    from flask_sock import Sock as _FlaskSock
except Exception as _flask_sock_import_error:
    _FlaskSock = None
    print(f"[NexoraProxy] flask-sock 不可用，WebSocket 转发已禁用: {_flask_sock_import_error}")

try:
    import websocket as _ws_client_lib
except Exception as _ws_client_import_error:
    _ws_client_lib = None
    print(f"[NexoraProxy] websocket-client 不可用，WebSocket 转发已禁用: {_ws_client_import_error}")

from local import build_default_executor
from core.config import config, get_app_root

LOCAL_PORT = 27700

app = Flask(__name__, static_folder=None)
# 本地精简云端前端模板（NexoraCode/ui/chat.html）
app.template_folder = str(get_app_root() / "ui")
_LOCAL_STATIC_ROOT = Path(__file__).resolve().parents[2] / "ChatDBServer" / "static"
sock = _FlaskSock(app) if (_FlaskSock is not None and _ws_client_lib is not None) else None
registry = build_default_executor()


@app.after_request
def _api_global_no_store(resp):
    """所有 /api/* 与页面路由一律不缓存，避免浏览器缓存导致本地数据更新后读到旧值。"""
    try:
        path = str(request.path or "")

        if path.startswith("/api/") or path in ("/", "/chat", "/settings"):
            resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass

    return resp


# 本地对话与会话路由（会话一律存本地，不依赖云端引擎）
from model.Routes import register_local_routes

register_local_routes(app, executor=registry)
_NEXORA_SHELL_HTML = """<!doctype html><html><head><meta charset=\"utf-8\"><title>Nexora Shell</title></head><body>Shell not ready</body></html>"""
_NEXORA_NOTES_SHELL_HTML = """<!doctype html><html><head><meta charset=\"utf-8\"><title>Nexora Notes Shell</title></head><body>Notes shell not ready</body></html>"""
_NEXORA_SETTINGS_SHELL_HTML = """<!doctype html><html><head><meta charset=\"utf-8\"><title>Nexora Settings Shell</title></head><body>Settings shell not ready</body></html>"""
_PROXY_TIMEOUT = 30
_PROXY_STREAM_CONNECT_TIMEOUT = 10
_VERBOSE_PROXY_LOG = str(config.get("verbose_proxy_log", False)).strip().lower() in {"1", "true", "on", "yes"}
_UPSTREAM_SESSION = requests.Session()
_UPSTREAM_SESSION_LOCK = threading.RLock()
import sys

def _get_vendor_roots():
    roots = []

    # 本地独立副本优先（拷贝自 ChatDBServer/static/vendor）
    local_vendor = get_app_root() / "ui" / "static" / "vendor"

    if local_vendor.is_dir():
        roots.append(local_vendor)

    workspace = Path(__file__).resolve().parents[2]
    roots.append(workspace / "ChatDBServer" / "static" / "vendor")
    
    if getattr(sys, 'frozen', False):
        base = Path(sys._MEIPASS) if hasattr(sys, '_MEIPASS') else Path(sys.executable).parent

        roots.extend([
            base / "ChatDBServer" / "static" / "vendor",
            base / "static" / "vendor",
        ])

        # 获取 .exe 所在目录
        exe_dir = Path(sys.executable).parent
        roots.extend([
            exe_dir / "ChatDBServer" / "static" / "vendor",  
        ])

    return [r for r in roots if r.exists()]

_VENDOR_ROOTS = _get_vendor_roots()
_VENDOR_REMOTE_PREFIXES = {
    "katex/": "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/",
}
_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


def _rewrite_html_for_local_proxy(html: str) -> str:
    text = str(html or "")
    if not text:
        return text

    # Enforce local vendor assets even when upstream templates still use CDNs.
    cdn_map = {
        "https://fonts.googleapis.com/css2?family=inter:wght@300;400;500;600&family=jetbrains+mono:wght@400;500&display=swap": "/nc/vendor/fonts/fonts.css",
        "https://fonts.googleapis.com/css2?family=inter:wght@400;500;600&display=swap": "/nc/vendor/fonts/fonts.css",
        "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css": "/nc/vendor/highlightjs/styles/github.min.css",
        "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js": "/nc/vendor/highlightjs/highlight.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/marked/11.1.1/marked.min.js": "/nc/vendor/marked/marked.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css": "/nc/vendor/fontawesome/css/all.min.css",
        "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css": "/nc/vendor/katex/katex.min.css",
        "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js": "/nc/vendor/katex/katex.min.js",
        "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js": "/nc/vendor/katex/contrib/auto-render.min.js",
        "https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.css": "/nc/vendor/easymde/easymde.min.css",
        "https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.js": "/nc/vendor/easymde/easymde.min.js",
        "https://cdn.jsdelivr.net/npm/easymde@2.18.0/dist/easymde.min.css": "/nc/vendor/easymde/easymde.min.css",
        "https://cdn.jsdelivr.net/npm/easymde@2.18.0/dist/easymde.min.js": "/nc/vendor/easymde/easymde.min.js",
    }

    for old, new in cdn_map.items():
        text = re.sub(re.escape(old), new, text, flags=re.IGNORECASE)

    # Remove preconnect hints for third-party domains once local assets are used.
    text = re.sub(
        r'<link[^>]*rel=["\']preconnect["\'][^>]*href=["\']https?://fonts\.(googleapis|gstatic)\.com[^"\']*["\'][^>]*>\s*',
        "",
        text,
        flags=re.IGNORECASE,
    )

    # Only tune known blocking stylesheet hosts/resources.
    # Keep icon and script CDNs intact to avoid feature regressions.
    target_markers = (
        "fonts.googleapis.com",
        "fonts.gstatic.com",
        "easymde.min.css",
    )

    # Convert remaining external stylesheet links to non-render-blocking form.
    pattern = re.compile(
        r'<link(?P<attrs>[^>]*?rel=["\']stylesheet["\'][^>]*?href=["\']https?://[^"\']+["\'][^>]*)>',
        flags=re.IGNORECASE,
    )

    def _replace(m: re.Match) -> str:
        attrs = m.group("attrs") or ""
        low = attrs.lower()
        if not any(mark in low for mark in target_markers):
            return m.group(0)
        if "data-nc-nonblocking" in low:
            return m.group(0)
        if "media=" in low:
            # Preserve explicit media declarations from upstream.
            return m.group(0)
        return (
            f"<link{attrs} media=\"print\" onload=\"this.media='all'\" "
            f"data-nc-nonblocking=\"1\">"
        )

    out = pattern.sub(_replace, text)

    # Add fallback for browsers that ignore onload on stylesheet links.
    fallback = (
        "<script>(function(){"
        "setTimeout(function(){"
        "try{document.querySelectorAll('link[data-nc-nonblocking=\"1\"]').forEach(function(l){l.media='all';});}catch(_){ }"
        "},2500);"
        "})();</script>"
    )
    if "data-nc-nonblocking=\"1\"" in out and "__nc_nonblocking_fallback__" not in out:
        out = out.replace("</head>", "<!-- __nc_nonblocking_fallback__ -->" + fallback + "</head>")

    if "data-nc-nonblocking=\"1\"" in out:
        print("[NexoraProxy] html rewrite enabled non-blocking styles for external CSS")
    return out


def _resolve_vendor_asset(asset_path: str) -> Path | None:
    rel = str(asset_path or "").strip().lstrip("/").replace("\\", "/")
    if not rel or ".." in rel.split("/"):
        return None
    for root in _VENDOR_ROOTS:
        try:
            full = (root / rel).resolve()
            root_resolved = root.resolve()
            if not str(full).startswith(str(root_resolved)):
                continue
            if full.is_file():
                return full
        except Exception:
            continue
    return None


def _resolve_vendor_remote_url(asset_path: str) -> str:
    rel = str(asset_path or "").strip().lstrip("/").replace("\\", "/")
    if not rel or ".." in rel.split("/"):
        return ""
    for prefix, base in _VENDOR_REMOTE_PREFIXES.items():
        if rel.startswith(prefix):
            suffix = rel[len(prefix):]
            return str(base or "") + suffix
    return ""


def set_shell_html(html: str) -> None:
    global _NEXORA_SHELL_HTML
    txt = str(html or "").strip()
    if txt:
        _NEXORA_SHELL_HTML = txt


def set_notes_shell_html(html: str) -> None:
    global _NEXORA_NOTES_SHELL_HTML
    txt = str(html or "").strip()
    if txt:
        _NEXORA_NOTES_SHELL_HTML = txt


def set_settings_shell_html(html: str) -> None:
    global _NEXORA_SETTINGS_SHELL_HTML
    txt = str(html or "").strip()
    if txt:
        _NEXORA_SETTINGS_SHELL_HTML = txt


def _check_token() -> bool:
    """验证请求来自 Nexora 服务器（使用持久化的 agent_token）"""
    token = request.headers.get("X-Agent-Token") or request.args.get("token")
    return token == config.get("agent_token")


def _remote_base_url() -> str:
    raw = str(config.get("nexora_url", "https://chat.himpqblog.cn") or "https://chat.himpqblog.cn").strip()
    if not raw:
        raw = "https://chat.himpqblog.cn"
    raw = raw.rstrip("/")
    if raw.endswith("/chat"):
        raw = raw[:-5]
    return raw


def _build_remote_url(path: str) -> str:
    base = _remote_base_url().rstrip("/")
    p = str(path or "").lstrip("/")
    if p:
        return f"{base}/{p}"
    return f"{base}/"


def _build_upstream_request_session() -> requests.Session:
    """Create an isolated upstream session with the shared proxy cookies copied in."""
    upstream_session = requests.Session()

    with _UPSTREAM_SESSION_LOCK:
        upstream_session.cookies.update(_UPSTREAM_SESSION.cookies)

    return upstream_session


def _merge_upstream_response_cookies(upstream_session: requests.Session) -> None:
    """Merge cookies learned by one upstream request back into the shared proxy jar."""
    if upstream_session is None:
        return

    with _UPSTREAM_SESSION_LOCK:
        _UPSTREAM_SESSION.cookies.update(upstream_session.cookies)


def _rewrite_set_cookie(v: str) -> str:
    val = str(v or "")
    if not val:
        return val
    # localhost 代理场景下，移除 Domain/Secure 以便浏览器在本地源保存会话。
    val = re.sub(r";\s*Domain=[^;]+", "", val, flags=re.IGNORECASE)
    val = re.sub(r";\s*Secure", "", val, flags=re.IGNORECASE)
    # 对跨站策略敏感场景，尽量转为 Lax，避免被浏览器直接丢弃。
    val = re.sub(r";\s*SameSite=None", "; SameSite=Lax", val, flags=re.IGNORECASE)
    return val


def _rewrite_location(location: str) -> str:
    loc = str(location or "").strip()
    if not loc:
        return loc
    remote = urlsplit(_remote_base_url())
    parsed = urlsplit(loc)
    # 相对重定向保持在 localhost 同源。
    if not parsed.scheme and not parsed.netloc:
        return loc
    if parsed.netloc.lower() != (remote.netloc or "").lower():
        return loc
    # 远端绝对重定向改写为本地同路径。
    return urlunsplit(("", "", parsed.path or "/", parsed.query, parsed.fragment))


def _collect_upstream_cookie_debug(remote_url: str) -> dict:
    """返回即将发往 ChatDBServer 的 cookie 视图，用于定位登录态同步问题。"""
    merged = {}
    req = requests.Request("GET", remote_url)
    upstream_session = _build_upstream_request_session()
    prepared = upstream_session.prepare_request(req)

    cookie_header = str(prepared.headers.get("Cookie") or "")

    for part in cookie_header.split(";"):

        if "=" not in part:
            continue

        key, value = part.split("=", 1)
        key = key.strip()

        if key:
            merged[key] = value.strip()

    for key, value in request.cookies.items():
        merged[str(key)] = str(value)

    return merged


def _proxy_request(path: str):
    request_started_at = time.perf_counter()
    remote_url = _build_remote_url(path)
    remote_base = _remote_base_url()
    remote_parts = urlsplit(remote_base)
    remote_origin = f"{remote_parts.scheme}://{remote_parts.netloc}" if remote_parts.scheme and remote_parts.netloc else remote_base
    incoming_headers = {}
    for k, v in request.headers.items():
        lk = str(k or "").lower()
        if lk in _HOP_HEADERS or lk in {"host", "content-length"}:
            continue
        incoming_headers[k] = v

    # Upstream auth/CSRF checks often rely on Origin/Referer host.
    # In localhost proxy mode, rewrite them to remote origin.
    incoming_headers["Origin"] = remote_origin
    incoming_headers["Referer"] = remote_origin + "/"
    # Avoid encoding mismatch (requests may decode body while upstream encoding header remains).
    incoming_headers["Accept-Encoding"] = "identity"

    method = request.method
    body = request.get_data() if method in {"POST", "PUT", "PATCH", "DELETE"} else None
    body_text = ""
    if body:
        try:
            body_text = body.decode("utf-8", errors="ignore")
        except Exception:
            body_text = ""
    accept_lower_pre = str(request.headers.get("Accept", "") or "").lower()
    path_lower_pre = str(path or "").lower()
    body_indicates_stream_pre = bool(re.search(r'"stream"\s*:\s*true', body_text, flags=re.IGNORECASE))
    path_likely_stream_pre = any(k in path_lower_pre for k in (
        "chat/completions",
        "/responses",
        "/api/chat",
        "/v1/chat",
    ))
    request_wants_stream = (
        "text/event-stream" in accept_lower_pre
        or str(request.args.get("stream", "")).strip().lower() in {"1", "true", "yes", "on"}
        or body_indicates_stream_pre
        or path_likely_stream_pre
    )

    # For SSE/chat streaming, disable read timeout; otherwise default timeout is fine.
    req_timeout = (_PROXY_STREAM_CONNECT_TIMEOUT, None) if request_wants_stream else _PROXY_TIMEOUT
    upstream_session = _build_upstream_request_session()
    session_ready_at = time.perf_counter()
    upstream_headers_at = None

    def _log_proxy_latency(reason: str, status_code: int = 0, error: str = "") -> None:
        total_ms = max(0.0, (time.perf_counter() - request_started_at) * 1000.0)
        if total_ms < 700.0 and not error:
            return

        try:
            print(
                "[NexoraProxyLatency] "
                f"reason={str(reason or '')} method={method} path=/{str(path or '').lstrip('/')} "
                f"status={int(status_code or 0)} total_ms={total_ms:.1f} "
                f"session_copy_ms={max(0.0, (session_ready_at - request_started_at) * 1000.0):.1f} "
                f"upstream_headers_ms={max(0.0, ((upstream_headers_at or time.perf_counter()) - session_ready_at) * 1000.0):.1f} "
                f"stream={bool(request_wants_stream)} error={str(error or '')[:300]}"
            )
        except Exception:
            pass

    try:
        # 使用持久化 Session 捕获上游 HttpOnly session cookie。浏览器 JS 读不到
        # HttpOnly cookie，但本地代理必须在后续 register / Learning 请求中继续携带它。
        upstream = upstream_session.request(
            method=method,
            url=remote_url,
            params=request.args,
            headers=incoming_headers,
            data=body,
            cookies=dict(request.cookies),
            allow_redirects=False,
            timeout=req_timeout,
            stream=True,
        )
        upstream_headers_at = time.perf_counter()
        _merge_upstream_response_cookies(upstream_session)
    except Exception as e:
        _log_proxy_latency("upstream_request_failed", error=str(e))
        return jsonify({"success": False, "error": f"proxy request failed: {e}"}), 502

    if str(path or "").startswith("api/local_agent/register"):
        try:
            print(f"[NexoraProxy DEBUG] cookies sent to upstream: {_collect_upstream_cookie_debug(remote_url)}")
            print(
                f"[NexoraProxy] register upstream status={upstream.status_code} "
                f"location={upstream.headers.get('Location','')} set-cookie={'yes' if upstream.headers.get('Set-Cookie') else 'no'}"
            )
        except Exception:
            pass

    content_type = str(upstream.headers.get("Content-Type", "") or "")
    ct_lower = content_type.lower()
    accept_lower = str(request.headers.get("Accept", "") or "").lower()
    path_lower = str(path or "").lower()
    body_indicates_stream = bool(re.search(r'"stream"\s*:\s*true', body_text, flags=re.IGNORECASE))
    path_likely_stream = any(k in path_lower for k in (
        "chat/completions",
        "/responses",
        "/api/chat",
        "/v1/chat",
    ))
    is_streaming_response = (
        "text/event-stream" in ct_lower
        or "application/x-ndjson" in ct_lower
        or "text/event-stream" in accept_lower
        or str(request.args.get("stream", "")).strip().lower() in {"1", "true", "yes", "on"}
        or body_indicates_stream
        or path_likely_stream
    )
    if int(upstream.status_code or 0) >= 400 and "text/event-stream" not in ct_lower and "application/x-ndjson" not in ct_lower:
        is_streaming_response = False

    _log_proxy_latency("upstream_headers", status_code=int(upstream.status_code or 0))

    if _VERBOSE_PROXY_LOG:
        try:
            print(
                f"[NexoraProxy] stream_detect path=/{path_lower} accept_sse={'text/event-stream' in accept_lower} "
                f"body_stream={body_indicates_stream} ct={ct_lower} result={is_streaming_response}"
            )
        except Exception:
            pass

    if is_streaming_response:
        # Preserve incremental token delivery for chat streaming responses.
        def _iter_chunks():
            try:
                chunk_size = 1 if "text/event-stream" in ct_lower else 64
                raw = getattr(upstream, "raw", None)
                if raw is not None and hasattr(raw, "stream"):
                    try:
                        for chunk in raw.stream(amt=chunk_size, decode_content=False):
                            if chunk:
                                yield chunk
                    except Exception as stream_err:
                        # Avoid crashing Flask response generator on upstream read timeout/reset.
                        try:
                            print(f"[NexoraProxy] stream read interrupted: {stream_err}")
                        except Exception:
                            pass
                else:
                    try:
                        for chunk in upstream.iter_content(chunk_size=chunk_size):
                            if chunk:
                                yield chunk
                    except Exception as stream_err:
                        try:
                            print(f"[NexoraProxy] stream iter interrupted: {stream_err}")
                        except Exception:
                            pass
            finally:
                try:
                    upstream.close()
                except Exception:
                    pass

        resp = Response(stream_with_context(_iter_chunks()), status=upstream.status_code, direct_passthrough=True)
        resp.headers["Cache-Control"] = "no-cache, no-transform"
        resp.headers["X-Accel-Buffering"] = "no"
    else:
        body_bytes = upstream.content

        if str(path or "").startswith("api/local_agent/register"):
            try:
                print(f"[NexoraProxy] register upstream body={body_bytes.decode('utf-8', errors='replace')[:1200]}")
            except Exception as log_error:
                print(f"[NexoraProxy] register upstream body log error={log_error}")

        if "text/html" in ct_lower:
            try:
                txt = body_bytes.decode(upstream.encoding or "utf-8", errors="replace")
                txt = _rewrite_html_for_local_proxy(txt)
                body_bytes = txt.encode("utf-8", errors="replace")
                content_type = "text/html; charset=utf-8"
            except Exception:
                pass
        resp = Response(body_bytes, status=upstream.status_code)
        try:
            upstream.close()
        except Exception:
            pass

    # 复制响应头（排除 hop-by-hop、长度、cookie/location 单独处理）
    for k, v in upstream.headers.items():
        lk = str(k or "").lower()
        if lk in _HOP_HEADERS or lk in {"content-length", "content-encoding", "set-cookie", "location"}:
            continue
        if lk == "content-type" and "text/html" in content_type.lower():
            resp.headers[k] = content_type
            continue
        resp.headers[k] = v

    # 重写 Location，避免跳出 localhost 同源。
    loc = upstream.headers.get("Location")
    if loc:
        resp.headers["Location"] = _rewrite_location(loc)

    # 重写 Set-Cookie 到 localhost 可用形式。
    raw_headers = getattr(upstream.raw, "headers", None)
    cookie_headers = []
    if raw_headers is not None and hasattr(raw_headers, "getlist"):
        cookie_headers = list(raw_headers.getlist("Set-Cookie"))
    elif raw_headers is not None and hasattr(raw_headers, "get_all"):
        cookie_headers = list(raw_headers.get_all("Set-Cookie") or [])
    if not cookie_headers:
        one = upstream.headers.get("Set-Cookie")
        if one:
            cookie_headers = [one]
    for c in cookie_headers:
        rewritten = _rewrite_set_cookie(c)
        if rewritten:
            resp.headers.add("Set-Cookie", rewritten)

    return resp


# ── 工具执行回调（Nexora 服务器 → NexoraCode）────────────────────
@app.route("/api/tool/execute", methods=["POST"])
def tool_execute():
    if not _check_token():
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    tool_name = data.get("tool")
    params = data.get("params", {})

    result = registry.execute(tool_name, params)
    return jsonify(result)


# ── 健康检查（可选）──────────────────────────────────────────────
@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/nc/shell")
def nc_shell():
    resp = Response(_NEXORA_SHELL_HTML, mimetype="text/html; charset=utf-8")
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


@app.route("/nc/notes-shell")
def nc_notes_shell():
    resp = Response(_NEXORA_NOTES_SHELL_HTML, mimetype="text/html; charset=utf-8")
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


@app.route("/nc/settings-shell")
def nc_settings_shell():
    try:
        print("[NexoraSettings] serve /nc/settings-shell")
    except Exception:
        pass
    resp = Response(_NEXORA_SETTINGS_SHELL_HTML, mimetype="text/html; charset=utf-8")
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


@app.route("/favicon.ico")
def favicon():
    return Response(status=204)


@app.route("/nc/vendor/<path:asset_path>")
def nc_vendor_asset(asset_path: str):
    target = _resolve_vendor_asset(asset_path)
    if target:
        try:
            data = target.read_bytes()
            mime, _ = mimetypes.guess_type(str(target))
            resp = Response(data, status=200, mimetype=(mime or "application/octet-stream"))
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return resp
        except Exception:
            return Response(status=500)

    remote_url = _resolve_vendor_remote_url(asset_path)
    if not remote_url:
        return Response(status=404)
    try:
        upstream = requests.get(remote_url, timeout=_PROXY_TIMEOUT)
        data = upstream.content
        mime = str(upstream.headers.get("Content-Type") or "").strip() or None
        if not mime:
            mime, _ = mimetypes.guess_type(str(asset_path))
        resp = Response(data, status=upstream.status_code, mimetype=(mime or "application/octet-stream"))
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp
    except Exception:
        return Response(status=502)


if sock is not None:
    def _local_browser_ws(client_ws) -> None:
        """本地模式 /ws/browser：保持连接，周期推送 agent 在线状态，不依赖云端。"""
        import json as _json
        import threading as _threading

        stop = _threading.Event()
        send_lock = _threading.Lock()

        def _safe_send(message: str) -> bool:
            try:
                with send_lock:
                    client_ws.send(message)
                return True
            except Exception:
                return False

        def _pump() -> None:
            while not stop.is_set():
                if not _safe_send(_json.dumps({"type": "agent_status", "online": True})):
                    break
                stop.wait(15)

        pump_thread = _threading.Thread(target=_pump, daemon=True, name="nc-local-browser-ws")
        pump_thread.start()

        try:
            while not stop.is_set():
                data = client_ws.receive()

                if data is None:
                    break
        finally:
            stop.set()

    @sock.route("/ws/<path:ws_path>")
    def ws_bridge(client_ws, ws_path: str):
        """将浏览器侧 WebSocket 透明转发到远端 ChatDBServer。

        本地代理原本只能转发普通 HTTP，/ws/browser 等升级请求会被以 400 拒绝，
        导致 iframe 内页面收不到 agent_status / knowledge_changed 等实时事件。
        """
        # 本地模式：/ws/browser 由本地直接应答（agent 在线状态），不依赖云端 WSS
        if str(ws_path or "").strip() == "browser":
            _local_browser_ws(client_ws)
            return

        remote_base = _remote_base_url()
        parts = urlsplit(remote_base)
        ws_scheme = "wss" if parts.scheme == "https" else "ws"
        query = request.query_string.decode("utf-8", errors="ignore")
        safe_path = str(ws_path or "").lstrip("/")
        remote_ws_url = urlunsplit((ws_scheme, parts.netloc, f"/ws/{safe_path}", query, ""))
        remote_origin = f"{parts.scheme}://{parts.netloc}"

        # 与 _proxy_request 相同的 cookie 语义：代理捕获的 HttpOnly 会话 cookie
        # 打底，浏览器可见 cookie 覆盖，保证远端 Flask session 鉴权可用。
        merged_cookies = {}
        with _UPSTREAM_SESSION_LOCK:
            for item in _UPSTREAM_SESSION.cookies:
                merged_cookies[str(item.name)] = str(item.value or "")
        for key, value in request.cookies.items():
            merged_cookies[str(key)] = str(value)
        cookie_header = "; ".join(f"{k}={v}" for k, v in merged_cookies.items())
        handshake_headers = [f"Cookie: {cookie_header}"] if cookie_header else []

        try:
            remote_ws = _ws_client_lib.create_connection(
                remote_ws_url,
                timeout=10,
                header=handshake_headers,
                origin=remote_origin,
                enable_multithread=True,
            )
        except Exception as e:
            print(f"[NexoraProxy] WS 转发连接失败 path=/ws/{safe_path} error={e}")
            return

        remote_ws.settimeout(None)
        print(f"[NexoraProxy] WS 转发已建立 path=/ws/{safe_path}")
        closed = threading.Event()

        def _close_both():
            if closed.is_set():
                return

            closed.set()

            try:
                remote_ws.close()
            except Exception:
                pass

            try:
                client_ws.close()
            except Exception:
                pass

        def _pump_remote_to_client():
            try:
                while not closed.is_set():
                    frame = remote_ws.recv()

                    if frame is None or frame == "":
                        break

                    client_ws.send(frame)
            except Exception:
                pass
            finally:
                _close_both()

        pump_thread = threading.Thread(
            target=_pump_remote_to_client,
            daemon=True,
            name=f"nc-ws-bridge-{safe_path}",
        )
        pump_thread.start()

        try:
            while not closed.is_set():
                data = client_ws.receive()

                if data is None:
                    break

                if isinstance(data, bytes):
                    remote_ws.send_binary(data)
                else:
                    remote_ws.send(data)
        except Exception:
            pass
        finally:
            _close_both()
            print(f"[NexoraProxy] WS 转发已关闭 path=/ws/{safe_path}")


@app.route("/nc/api/select-folder", methods=["POST"])
def nc_select_folder():
    """弹出原生文件夹选择对话框（同源页面直接调用，不依赖 pywebview 注入桥）。"""
    try:
        import webview as _webview

        win = _webview.windows[0] if _webview.windows else None

        if win is None:
            return jsonify({"success": False, "message": "主窗口未就绪"})

        result = win.create_file_dialog(_webview.FOLDER_DIALOG)
        path = ""

        if isinstance(result, (list, tuple)) and result:
            path = str(result[0] or "")
        elif isinstance(result, str):
            path = result

        path = path.strip()

        if not path:
            return jsonify({"success": False, "cancelled": True})

        print(f"[NexoraCode] project folder selected: {path}")
        return jsonify({"success": True, "path": path})
    except Exception as e:
        print(f"[NexoraCode] select folder failed: {e}")
        return jsonify({"success": False, "message": str(e)})


def _serve_file(path: Path, cache_seconds: int = 300) -> Response:
    try:
        mime, _ = mimetypes.guess_type(str(path))
        data = path.read_bytes()
        resp = Response(data, status=200, mimetype=(mime or "application/octet-stream"))
        if cache_seconds > 0:
            resp.headers["Cache-Control"] = f"public, max-age={cache_seconds}"
        else:
            resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return resp
    except Exception:
        return Response(status=500)


@app.route("/static/<path:filename>")
def local_cloud_static(filename: str):
    """本地精简前端的静态资源（js/css/img）：优先本地副本，否则读 ChatDBServer/static。"""
    safe_parts = [part for part in str(filename or "").replace("\\", "/").split("/") if part not in {"", ".", ".."}]
    if not safe_parts:
        return Response(status=404)

    # 本地可改副本（如 chat.js）优先
    local_root = get_app_root() / "ui" / "static"
    local_target = local_root.joinpath(*safe_parts)

    if str(local_target.resolve()).startswith(str(local_root.resolve())) and local_target.is_file():
        return _serve_file(local_target)

    target = _LOCAL_STATIC_ROOT.joinpath(*safe_parts)

    if not str(target.resolve()).startswith(str(_LOCAL_STATIC_ROOT.resolve())):
        return Response(status=404)

    if not target.is_file():
        return Response(status=404)

    return _serve_file(target)


@app.route("/")
@app.route("/chat")
def local_cloud_chat():
    """本地精简云端前端入口；Jinja 变量取默认值（项目模式关闭邮件/地图），API 走本地代理。"""
    try:
        return render_template(
            "chat.html",
            username=str(config.get("local_username", "local") or "local"),
            nexora_mail_enabled=False,
            map_renderer_config={},
        )
    except Exception as e:
        return Response(f"chat template render failed: {e}", status=500, mimetype="text/plain")


def _local_agent_enabled_value() -> bool:
    return str(config.get("local_agent", False)).strip().lower() in {"1", "true", "on", "yes"}


@app.route("/settings.css")
@app.route("/settings.js")
def local_settings_asset():
    """本地设置页静态资源。"""
    name = str(request.path or "").lstrip("/")
    target = get_app_root() / "ui" / name
    if not target.is_file():
        return Response(status=404)
    return _serve_file(target, cache_seconds=0)


@app.route("/settings")
def local_settings_page():
    """本地自绘设置页。"""
    target = get_app_root() / "ui" / "settings.html"
    if not target.is_file():
        return Response("settings not built", status=503, mimetype="text/plain")
    return _serve_file(target, cache_seconds=0)


@app.route("/api/local/settings", methods=["GET"])
def local_settings_get():
    """读取本地设置（Provider 列表 + 对话配置）。api_key 不回显明文。"""
    from model.Provider import load_providers

    providers = load_providers()
    default_id = ""

    try:
        import json as _json
        from model.Provider import _PROVIDERS_PATH

        if _PROVIDERS_PATH.is_file():
            with open(_PROVIDERS_PATH, "r", encoding="utf-8") as f:
                _data = _json.load(f)
            default_id = str(_data.get("default_id") or "") if isinstance(_data, dict) else ""
    except Exception:
        default_id = ""

    return jsonify({
        "success": True,
        "provider": {
            "providers": [provider.to_dict() for provider in providers],
            "default_id": default_id,
        },
        "general": {
            "username": str(config.get("local_username", "local") or "local"),
        },
    }), 200, {"Cache-Control": "no-store"}


@app.route("/api/local/settings", methods=["POST"])
def local_settings_save():
    """保存本地设置。api_key 留空表示保留原 key。"""
    from model.Provider import ProviderConfig, load_providers, save_providers

    body = request.get_json(silent=True) or {}
    provider_payload = body.get("provider") if isinstance(body.get("provider"), dict) else {}
    general_payload = body.get("general") if isinstance(body.get("general"), dict) else {}

    raw_providers = provider_payload.get("providers")

    if isinstance(raw_providers, list):
        current = {p.provider_id: p for p in load_providers()}
        new_list = []

        for item in raw_providers:
            if not isinstance(item, dict):
                continue

            provider_id = str(item.get("id") or "").strip()
            old = current.get(provider_id)
            api_key = str(item.get("api_key") or "").strip()

            if not api_key and old is not None:
                api_key = old.api_key

            try:
                temperature = float(item.get("temperature", 0.7))
            except (TypeError, ValueError):
                temperature = 0.7

            try:
                max_tokens = int(item.get("max_tokens", 4096))
            except (TypeError, ValueError):
                max_tokens = 4096

            try:
                context_window = int(item.get("context_window", 128000))
            except (TypeError, ValueError):
                context_window = 128000

            new_list.append(ProviderConfig(
                provider_id=provider_id or "",
                name=str(item.get("name") or "").strip(),
                base_url=str(item.get("base_url") or "").strip(),
                api_key=api_key,
                model=str(item.get("model") or "").strip(),
                temperature=temperature,
                max_tokens=max_tokens,
                context_window=context_window,
            ))

        default_id = str(provider_payload.get("default_id") or "").strip()
        save_providers(new_list, default_id)

    if "username" in general_payload and str(general_payload.get("username") or "").strip():
        config.set("local_username", str(general_payload.get("username") or "").strip())

    return jsonify({"success": True, "message": "设置已保存"})


@app.route("/<path:path>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
def proxy_all(path: str):
    # 已有精确路由会优先命中；其余统一走远端代理。
    return _proxy_request(path)


def start_local_server():
    log = logging.getLogger("werkzeug")
    log.setLevel(logging.ERROR)
    app.run(host="127.0.0.1", port=LOCAL_PORT, threaded=True)
