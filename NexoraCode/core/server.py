"""
本地 HTTP 服务
- 接收 Nexora 服务器的工具执行回调
- 作为本地反向代理，统一前端来源到 localhost，降低跨站登录态限制
"""

import logging
import re
import mimetypes
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import requests
from flask import Flask, request, jsonify, Response, stream_with_context

from core.tool_registry import ToolRegistry
from core.config import config

LOCAL_PORT = 27700

app = Flask(__name__, static_folder=None)
registry = ToolRegistry()
_NEXORA_SHELL_HTML = """<!doctype html><html><head><meta charset=\"utf-8\"><title>Nexora Shell</title></head><body>Shell not ready</body></html>"""
_NEXORA_NOTES_SHELL_HTML = """<!doctype html><html><head><meta charset=\"utf-8\"><title>Nexora Notes Shell</title></head><body>Notes shell not ready</body></html>"""
_NEXORA_SETTINGS_SHELL_HTML = """<!doctype html><html><head><meta charset=\"utf-8\"><title>Nexora Settings Shell</title></head><body>Settings shell not ready</body></html>"""
_PROXY_TIMEOUT = 30
_VERBOSE_PROXY_LOG = str(config.get("verbose_proxy_log", False)).strip().lower() in {"1", "true", "on", "yes"}
import sys

def _get_vendor_roots():
    roots = []
    
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


def _proxy_request(path: str):
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
    try:
        upstream = requests.request(
            method=method,
            url=remote_url,
            params=request.args,
            headers=incoming_headers,
            data=body,
            cookies=request.cookies,
            allow_redirects=False,
            timeout=_PROXY_TIMEOUT,
            stream=True,
        )
    except Exception as e:
        return jsonify({"success": False, "error": f"proxy request failed: {e}"}), 502

    if str(path or "").startswith("api/local_agent/register"):
        try:
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
                    for chunk in raw.stream(amt=chunk_size, decode_content=False):
                        if chunk:
                            yield chunk
                else:
                    for chunk in upstream.iter_content(chunk_size=chunk_size):
                        if chunk:
                            yield chunk
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


@app.route("/", defaults={"path": ""}, methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
@app.route("/<path:path>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
def proxy_all(path: str):
    # 已有精确路由会优先命中；其余统一走远端代理。
    return _proxy_request(path)


def start_local_server():
    log = logging.getLogger("werkzeug")
    log.setLevel(logging.ERROR)
    app.run(host="127.0.0.1", port=LOCAL_PORT, threaded=True)
