import json
import logging
import os
import secrets
import string
import time
import urllib.request
from functools import wraps

from flask import Flask, jsonify, render_template, request, session, redirect, url_for, Response

from core.nexora_agent import NexoraPageAgentClient
from core.render import PLAYWRIGHT_AVAILABLE, RenderManager
from core.render_search import render_search
from core.search import search_clean


app = Flask(__name__)
app.secret_key = secrets.token_hex(32)
logger = logging.getLogger(__name__)
_START_TIME = time.time()


CONFIG_DIR = os.path.join(os.path.dirname(__file__), "config")
CONFIG_PATH = os.path.join(CONFIG_DIR, "config.json")


DEFAULT_CONFIG = {
    "auth": {
        "required": True,
        "token": "",
    },
    "render": {
        "max_concurrency": 3,
        "default_timeout_ms": 15000,
        "fallback_on_fail": True,
    },
    "nexora": {
        "base_url": "http://127.0.0.1:5000",
        "api_key": "",
        "models_path": "/api/papi/models",
        "completions_path": "/api/papi/completions",
        "responses_path": "/api/papi/responses",
        "chat_completions_path": "/api/papi/chat/completions",
        "request_timeout": 90,
    },
    "models": {
        "page_parse_agent": {
            "enabled": True,
            "model_name": "",
            "api_mode": "responses",
            "temperature": 0.2,
            "max_output_tokens": 4000,
            "request_timeout": 120,
            "stream": False,
            "think": False,
            "max_input_chars": 32000,
            "system_prompt": "You are a webpage parsing agent. Read the provided page content and return a strict JSON object only.",
            "prompt_notes": "",
        },
        "web_search_agent": {
            "enabled": True,
            "model_name": "",
            "api_mode": "chat",
            "temperature": 0.3,
            "max_output_tokens": 8000,
            "request_timeout": 180,
            "stream": True,
            "think": True,
            "max_input_chars": 32000,
            "system_prompt": "",
        },
    },
    "default_model": "",
    "web_search_prompt": (
        "你是 NexoraSearch 联网搜索助手。\n"
        "你必须主动使用工具来获取信息，绝不要只回复对话式回答。\n\n"
        "## 可用工具\n"
        "fetch_url(url) — 抓取并解析指定网页内容\n\n"
        "## 调用格式（严格遵守）\n"
        "当需要使用工具时，你的回复中必须包含以下格式的工具调用块：\n\n"
        "<tool_call>\n"
        "{\"name\": \"fetch_url\", \"arguments\": {\"url\": \"你要抓取的网址\"}}\n"
        "</tool_call>\n\n"
        "## 规则\n"
        "1. 收到用户问题后，立刻发起工具调用，不要询问用户\n"
        "2. 你可以直接构造 URL，如 https://zh.wikipedia.org/wiki/关键词\n"
        "3. 可以连续多次调用 fetch_url 直到信息充足\n"
        "4. 最终用中文回答，附上来源 URL\n\n"
        "## 示例\n"
        "用户：量子力学是什么\n"
        "你的回复：\n"
        "我来搜索量子力学的相关信息。\n"
        "<tool_call>\n"
        "{\"name\": \"fetch_url\", \"arguments\": {\"url\": \"https://zh.wikipedia.org/wiki/量子力学\"}}\n"
        "</tool_call>"
    ),
    "server": {
        "host": "127.0.0.1",
        "port": 8080,
        "debug": False,
    },
}


def generate_random_token(length: int = 32) -> str:
    chars = string.ascii_letters + string.digits
    return "".join(secrets.choice(chars) for _ in range(length))


def _deep_merge_dict(source, defaults):
    if not isinstance(defaults, dict):
        return source

    if not isinstance(source, dict):
        return json.loads(json.dumps(defaults))

    merged = dict(source)
    changed = False

    for key, default_value in defaults.items():
        if key not in merged:
            merged[key] = json.loads(json.dumps(default_value))
            changed = True
            continue

        current_value = merged.get(key)
        if isinstance(default_value, dict) and isinstance(current_value, dict):
            nested = _deep_merge_dict(current_value, default_value)
            if nested != current_value:
                merged[key] = nested
                changed = True

    return merged if changed else source


def _load_config():
    if not os.path.exists(CONFIG_DIR):
        os.makedirs(CONFIG_DIR, exist_ok=True)

    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            loaded = json.load(f)
    else:
        loaded = json.loads(json.dumps(DEFAULT_CONFIG))
        loaded["auth"]["token"] = generate_random_token()
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(loaded, f, indent=4, ensure_ascii=False)
        return loaded

    merged = _deep_merge_dict(loaded, DEFAULT_CONFIG)
    if merged != loaded:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(merged, f, indent=4, ensure_ascii=False)
        logger.info("config.json schema updated with Nexora agent settings")
    return merged


config = _load_config()


rm = RenderManager(
    max_concurrency=int(config.get("render", {}).get("max_concurrency", 3)),
    allow_fallback=bool(config.get("render", {}).get("fallback_on_fail", True)),
)

agent_client = NexoraPageAgentClient(config)


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_cfg = config.get("auth", {})
        if not auth_cfg.get("required", False):
            return f(*args, **kwargs)

        expected = str(auth_cfg.get("token") or "").strip()
        if not expected:
            # Auth required but no token configured → deny all
            return jsonify({"success": False, "error": "Unauthorized: no token configured"}), 401

        token = request.headers.get("Authorization", "")
        token = token.replace("Bearer ", "").strip()
        if not token:
            token = str(request.args.get("token") or "").strip()

        if token != expected:
            return jsonify({"success": False, "error": "Unauthorized"}), 401

        return f(*args, **kwargs)

    return decorated


def save_config():
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=4, ensure_ascii=False)


def _has_admin_account():
    """Check if at least one admin account is configured."""
    admin_cfg = config.get("admin") or {}
    users = admin_cfg.get("users")
    if isinstance(users, list) and len(users) > 0:
        return True
    if admin_cfg.get("username") and admin_cfg.get("password"):
        return True
    return False


def _is_admin():
    return bool(session.get("admin_user"))


# ---- Admin routes ----

@app.route("/admin", methods=["GET"])
def admin_index():
    if not _is_admin():
        return redirect(url_for("admin_login"))
    return render_template("admin.html")


@app.route("/admin/setup", methods=["GET", "POST"])
def admin_setup():
    if _has_admin_account():
        return redirect(url_for("admin_login"))
    if request.method == "GET":
        return render_template("admin_setup.html")
    data = request.get_json() or {}
    username = str(data.get("username") or "").strip()
    password = str(data.get("password") or "")
    if not username or not password:
        return jsonify({"success": False, "message": "用户名和密码不能为空"}), 400
    if len(password) < 6:
        return jsonify({"success": False, "message": "密码长度至少 6 位"}), 400
    admin_cfg = config.setdefault("admin", {})
    admin_cfg["users"] = [{"username": username, "password": password}]
    if not admin_cfg.get("secret_key"):
        admin_cfg["secret_key"] = secrets.token_hex(32)
    app.secret_key = admin_cfg["secret_key"]
    save_config()
    session["admin_user"] = username
    return jsonify({"success": True})


@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if not _has_admin_account():
        return redirect(url_for("admin_setup"))
    if request.method == "GET":
        return render_template("admin_login.html")
    data = request.get_json() or {}
    username = data.get("username")
    password = data.get("password")
    admins = config.get("admin", {}).get("users") or [
        {"username": config.get("admin", {}).get("username"), "password": config.get("admin", {}).get("password")}
    ]
    for admin in admins:
        if admin and admin.get("username") == username and admin.get("password") == password:
            session["admin_user"] = username
            return jsonify({"success": True})
    return jsonify({"success": False, "message": "Invalid credentials"}), 401


@app.route("/admin/logout", methods=["POST"])
def admin_logout():
    session.pop("admin_user", None)
    return jsonify({"success": True})


@app.route("/admin/api/status", methods=["GET"])
def admin_status():
    if not _is_admin():
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    return jsonify({
        "success": True,
        "uptime_sec": int(time.time() - _START_TIME),
        "auth_required": bool(config.get("auth", {}).get("required", False)),
        "playwright_available": PLAYWRIGHT_AVAILABLE,
        "config": config,
    })


@app.route("/admin/api/config", methods=["POST"])
def admin_update_config():
    if not _is_admin():
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    data = request.get_json() or {}
    section = str(data.get("section") or "").strip()
    section_data = data.get("data")
    is_string = bool(data.get("is_string"))
    if not section or section_data is None:
        return jsonify({"success": False, "message": "Missing section or data"}), 400
    if is_string:
        config[section] = section_data
    elif isinstance(section_data, dict):
        current = config.get(section)
        if not isinstance(current, dict):
            config[section] = section_data
        else:
            current.update(section_data)
    else:
        return jsonify({"success": False, "message": "Invalid data type"}), 400
    save_config()
    return jsonify({"success": True})


@app.route("/admin/api/token/rotate", methods=["POST"])
def admin_rotate_token():
    if not _is_admin():
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    new_token = generate_random_token(32)
    auth_cfg = config.setdefault("auth", {})
    auth_cfg["token"] = new_token
    save_config()
    return jsonify({"success": True, "token": new_token})


@app.route("/admin/api/nexora/status", methods=["GET"])
def admin_nexora_status():
    if not _is_admin():
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    nexora_cfg = config.get("nexora") or {}
    base_url = str(nexora_cfg.get("base_url") or "").strip().rstrip("/")
    api_key = str(nexora_cfg.get("api_key") or "").strip()
    models_path = str(nexora_cfg.get("models_path") or "/api/papi/models").strip()
    if not models_path.startswith("/"):
        models_path = "/" + models_path
    if not base_url:
        return jsonify({"success": True, "reachable": False, "message": "未配置 Nexora 地址"})
    url = f"{base_url}{models_path}"
    headers = {}
    if api_key:
        headers["X-API-Key"] = api_key
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return jsonify({"success": True, "reachable": True, "status": resp.status, "data": data})
    except Exception as e:
        return jsonify({"success": True, "reachable": False, "message": str(e)})


@app.route("/admin/api/nexora/models", methods=["GET"])
def admin_nexora_models():
    if not _is_admin():
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    nexora_cfg = config.get("nexora") or {}
    base_url = str(nexora_cfg.get("base_url") or "").strip().rstrip("/")
    api_key = str(nexora_cfg.get("api_key") or "").strip()
    models_path = str(nexora_cfg.get("models_path") or "/api/papi/models").strip()
    if not models_path.startswith("/"):
        models_path = "/" + models_path
    if not base_url:
        return jsonify({"success": False, "message": "未配置 Nexora 地址"}), 400
    url = f"{base_url}{models_path}"
    headers = {}
    if api_key:
        headers["X-API-Key"] = api_key
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            models = data.get("models") or data
            # Nexora returns {models: {data: [...], object: "list"}, success: true}
            if isinstance(models, dict) and isinstance(models.get("data"), list):
                models = models["data"]
            if not isinstance(models, list):
                models = []
            return jsonify({"success": True, "models": models})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 502


def _clean_html_for_parse(raw_html: str) -> str:
    """Aggressively strip HTML to keep only content-relevant structure."""
    import re as _re
    text = raw_html or ""

    # Remove HTML comments
    text = _re.sub(r"<!--.*?-->", "", text, flags=_re.DOTALL)
    # Remove <script>, <style>, <noscript>, <template> blocks
    for tag in ("script", "style", "noscript", "template"):
        text = _re.sub(rf"<{tag}[\s\S]*?</{tag}>", "", text, flags=_re.IGNORECASE)
    # Remove <svg> blocks entirely
    text = _re.sub(r"<svg[\s\S]*?</svg>", "", text, flags=_re.IGNORECASE)
    # Remove <head> block (meta, link, title tags etc.)
    text = _re.sub(r"<head[\s\S]*?</head>", "", text, flags=_re.IGNORECASE)
    # Remove <html>, <!doctype> tags
    text = _re.sub(r"<!doctype[^>]*>", "", text, flags=_re.IGNORECASE)
    text = _re.sub(r"</?html[^>]*>", "", text, flags=_re.IGNORECASE)
    # Remove <meta>, <link>, <base> self-closing tags
    text = _re.sub(r"<(?:meta|link|base)\b[^>]*/?>", "", text, flags=_re.IGNORECASE)

    # Remove inline style= attributes
    text = _re.sub(r'\s+style\s*=\s*"[^"]*"', "", text, flags=_re.IGNORECASE)
    text = _re.sub(r"\s+style\s*=\s*'[^']*'", "", text, flags=_re.IGNORECASE)
    # Remove event handler attributes
    text = _re.sub(r'\s+on\w+\s*=\s*"[^"]*"', "", text, flags=_re.IGNORECASE)
    text = _re.sub(r"\s+on\w+\s*=\s*'[^']*'", "", text, flags=_re.IGNORECASE)
    # Remove non-essential attributes (keep href, src, alt, title, colspan, rowspan, type, value, action, method)
    _strip_attrs = (
        r"class|id|name|data-[\w-]+|aria-[\w-]+|role|tabindex|contenteditable|draggable|spellcheck"
        r"|itemtype|itemscope|itemprop|itemref"
        r"|width|height|viewBox|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin"
        r"|xmlns|xmlns:\w+|xml:lang|lang|dir|translate"
        r"|target|rel|media|sizes|type|crossorigin|integrity|referrerpolicy"
        r"|loading|decoding|fetchpriority|intrinsicsize|srcset|sizes"
        r"|frameborder|scrolling|allowfullscreen|allow|sandbox"
        r"|cellpadding|cellspacing|border|valign|align|bgcolor|background"
        r"|placeholder|autofocus|autocomplete|autocorrect|autocapitalize"
        r"|tabindex|accesskey|contenteditable|spellcheck|hidden"
        r"|controls|autoplay|muted|loop|playsinline|preload|poster"
        r"|pattern|min|max|step|multiple|checked|disabled|readonly|required|selected"
        r"|(?:webkit|moz|ms)-[\w-]+"
    )
    text = _re.sub(rf'\s+(?:{_strip_attrs})\s*=\s*"[^"]*"', "", text, flags=_re.IGNORECASE)
    text = _re.sub(rf"\s+(?:{_strip_attrs})\s*=\s*'[^']*'", "", text, flags=_re.IGNORECASE)
    # Remove boolean attributes without value
    text = _re.sub(rf'\s+(?:{_strip_attrs})(?=[\s/>])', "", text, flags=_re.IGNORECASE)

    # Remove empty tags (self-closing like <br/>, <hr/>, <img> are fine)
    # Remove tags that became empty after cleaning
    text = _re.sub(r"<(\w+)\s*>\s*</\1>", "", text)

    # Collapse whitespace
    text = _re.sub(r">\s+<", "> <", text)
    text = _re.sub(r"[ \t]+", " ", text)
    text = _re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


@app.route("/admin/api/skills", methods=["GET"])
def admin_skills_list():
    if not _is_admin():
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    skills = config.get("skills") or []
    return jsonify({"success": True, "skills": skills})


@app.route("/admin/api/skills", methods=["POST"])
def admin_skills_save():
    if not _is_admin():
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    data = request.get_json() or {}
    skills = data.get("skills")
    if not isinstance(skills, list):
        return jsonify({"success": False, "message": "invalid skills"}), 400
    config["skills"] = skills
    save_config()
    return jsonify({"success": True})


@app.route("/admin/api/test/clean", methods=["POST"])
def admin_test_clean():
    if not _is_admin():
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    data = request.get_json() or {}
    html = str(data.get("html") or "").strip()
    if not html:
        return jsonify({"success": False, "message": "无内容"}), 400
    cleaned = _clean_html_for_parse(html)
    return jsonify({"success": True, "html": cleaned})


@app.route("/admin/api/test/parse", methods=["POST"])
def admin_test_parse():
    if not _is_admin():
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    data = request.get_json() or {}
    html = str(data.get("html") or "").strip()
    if not html:
        return jsonify({"success": False, "message": "无内容"}), 400

    cleaned = _clean_html_for_parse(html)
    model_cfg = (config.get("models") or {}).get("page_parse_agent") or {}
    model_name = str(model_cfg.get("model_name") or "").strip()
    api_mode = str(model_cfg.get("api_mode") or "responses").strip().lower()
    system_prompt = str(model_cfg.get("parse_prompt") or model_cfg.get("system_prompt") or "").strip()
    temperature = model_cfg.get("temperature")
    max_tokens = model_cfg.get("max_output_tokens")
    think = bool(model_cfg.get("think", False))
    timeout = int(model_cfg.get("request_timeout") or 120)

    # Truncate if too long
    max_chars = int(model_cfg.get("max_input_chars") or 32000)
    if len(cleaned) > max_chars:
        cleaned = cleaned[:max_chars]

    nexora_cfg = config.get("nexora") or {}
    base_url = str(nexora_cfg.get("base_url") or "").strip().rstrip("/")
    api_key = str(nexora_cfg.get("api_key") or "").strip()
    if not base_url:
        return jsonify({"success": False, "message": "未配置 Nexora 地址"}), 400

    chat_path = str(nexora_cfg.get("chat_completions_path") or "/api/papi/chat/completions").strip()
    if not chat_path.startswith("/"):
        chat_path = "/" + chat_path

    payload = {
        "model": model_name or str(config.get("default_model") or "").strip() or "gpt-4o-mini",
        "stream": True,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": cleaned},
        ],
    }
    if temperature is not None and temperature != "":
        payload["temperature"] = temperature
    if max_tokens:
        payload["max_tokens"] = int(max_tokens)
    if think:
        payload["think"] = True

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["X-API-Key"] = api_key
        headers["Authorization"] = f"Bearer {api_key}"

    url = f"{base_url}{chat_path}"
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    def generate():
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                buf = ""
                while True:
                    chunk = resp.read(1024)
                    if not chunk:
                        break
                    buf += chunk.decode("utf-8", errors="replace")
                    while "\n" in buf:
                        line, buf = buf.split("\n", 1)
                        line = line.strip()
                        if not line or line == "data: [DONE]":
                            continue
                        if line.startswith("data: "):
                            json_str = line[6:]
                            try:
                                obj = json.loads(json_str)
                                delta = (obj.get("choices") or [{}])[0].get("delta") or {}
                                content = delta.get("content") or ""
                                reasoning = delta.get("reasoning_content") or ""
                                if content:
                                    yield f"data: {json.dumps({'content': content})}\n\n"
                                if reasoning:
                                    yield f"data: {json.dumps({'think': reasoning})}\n\n"
                            except json.JSONDecodeError:
                                pass
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── Web Search Agent ──


def _parse_tool_calls(text: str):
    """Parse <tool_call>...</tool_call> blocks from model output."""
    import re
    calls = []
    for m in re.finditer(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", text, re.DOTALL):
        try:
            obj = json.loads(m.group(1))
            name = str(obj.get("name") or "").strip()
            args = obj.get("arguments") or {}
            if name:
                calls.append({"name": name, "arguments": args, "raw": m.group(0)})
        except json.JSONDecodeError:
            pass
    return calls


def _execute_fetch_url(url: str) -> str:
    """Fetch URL via Playwright, clean HTML, parse with model."""
    try:
        render_result = rm.render_webview(url, timeout=15000, use_sogou_fix=True)
    except Exception as e:
        return f"渲染失败: {e}"

    if not render_result.get("success"):
        return f"渲染失败: {render_result.get('error', 'unknown')}"

    full_html = render_result.get("full_html") or ""
    title = render_result.get("title") or ""
    cleaned = _clean_html_for_parse(full_html)

    model_cfg = (config.get("models") or {}).get("page_parse_agent") or {}
    model_name = str(model_cfg.get("model_name") or "").strip()
    parse_prompt = str(model_cfg.get("parse_prompt") or model_cfg.get("system_prompt") or "").strip()
    temperature = model_cfg.get("temperature")
    max_tokens = model_cfg.get("max_output_tokens")
    timeout = int(model_cfg.get("request_timeout") or 120)
    max_chars = int(model_cfg.get("max_input_chars") or 32000)

    if len(cleaned) > max_chars:
        cleaned = cleaned[:max_chars]

    nexora_cfg = config.get("nexora") or {}
    base_url = str(nexora_cfg.get("base_url") or "").strip().rstrip("/")
    api_key = str(nexora_cfg.get("api_key") or "").strip()
    chat_path = str(nexora_cfg.get("chat_completions_path") or "/api/papi/chat/completions").strip()
    if not chat_path.startswith("/"):
        chat_path = "/" + chat_path

    payload = {
        "model": model_name or str(config.get("default_model") or "").strip() or "gpt-4o-mini",
        "stream": True,
        "messages": [
            {"role": "system", "content": parse_prompt or "分析以下网页内容，提取关键信息并用中文总结。"},
            {"role": "user", "content": f"页面标题: {title}\n\n{cleaned}"},
        ],
    }
    if temperature is not None and temperature != "":
        payload["temperature"] = temperature
    if max_tokens:
        payload["max_tokens"] = int(max_tokens)

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["X-API-Key"] = api_key
        headers["Authorization"] = f"Bearer {api_key}"

    parsed_text = ""
    try:
        req = urllib.request.Request(
            f"{base_url}{chat_path}",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            buf = ""
            while True:
                chunk = resp.read(512)
                if not chunk:
                    break
                buf += chunk.decode("utf-8", errors="replace")
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    line = line.strip()
                    if not line or line == "data: [DONE]":
                        continue
                    if line.startswith("data: "):
                        try:
                            obj = json.loads(line[6:])
                            delta = (obj.get("choices") or [{}])[0].get("delta") or {}
                            c = delta.get("content") or ""
                            if c:
                                parsed_text += c
                        except json.JSONDecodeError:
                            pass
    except Exception as e:
        return f"模型解析失败: {e}"

    return parsed_text or "(模型未返回内容)"


def _execute_fetch_url_streaming(url: str, events: list) -> str:
    """Fetch URL via Playwright, clean HTML, parse with model. Appends SSE events to `events` list."""
    def _ev(msg):
        events.append(f'data: {json.dumps({"type": "tool_progress", "content": msg})}\n\n')

    _ev(f"正在渲染 {url} ...")
    try:
        render_result = rm.render_webview(url, timeout=15000, use_sogou_fix=True)
    except Exception as e:
        _ev(f"渲染失败: {e}")
        return f"渲染失败: {e}"

    if not render_result.get("success"):
        err = f"渲染失败: {render_result.get('error', 'unknown')}"
        _ev(err)
        return err

    title = render_result.get("title") or ""
    full_html = render_result.get("full_html") or ""
    _ev(f"渲染成功 [{title}]，HTML {len(full_html)} 字符")

    _ev("正在清理 HTML ...")
    cleaned = _clean_html_for_parse(full_html)
    _ev(f"清理完成 → {len(cleaned)} 字符")

    # Parse with sub-model
    model_cfg = (config.get("models") or {}).get("page_parse_agent") or {}
    model_name = str(model_cfg.get("model_name") or "").strip()
    actual_model = model_name or str(config.get("default_model") or "").strip() or "gpt-4o-mini"
    parse_prompt = str(model_cfg.get("parse_prompt") or model_cfg.get("system_prompt") or "").strip()
    temperature = model_cfg.get("temperature")
    max_tokens = model_cfg.get("max_output_tokens")
    timeout = int(model_cfg.get("request_timeout") or 120)
    max_chars = int(model_cfg.get("max_input_chars") or 32000)

    if len(cleaned) > max_chars:
        cleaned = cleaned[:max_chars]

    _ev(f"子模型解析中 (model={actual_model}) ...")

    nexora_cfg = config.get("nexora") or {}
    base_url = str(nexora_cfg.get("base_url") or "").strip().rstrip("/")
    api_key = str(nexora_cfg.get("api_key") or "").strip()
    chat_path = str(nexora_cfg.get("chat_completions_path") or "/api/papi/chat/completions").strip()
    if not chat_path.startswith("/"):
        chat_path = "/" + chat_path

    payload = {
        "model": actual_model,
        "stream": True,
        "messages": [
            {"role": "system", "content": parse_prompt or "分析以下网页内容，提取关键信息并用中文总结。"},
            {"role": "user", "content": f"页面标题: {title}\n\n{cleaned}"},
        ],
    }
    if temperature is not None and temperature != "":
        payload["temperature"] = temperature
    if max_tokens:
        payload["max_tokens"] = int(max_tokens)

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["X-API-Key"] = api_key
        headers["Authorization"] = f"Bearer {api_key}"

    parsed_text = ""
    try:
        req = urllib.request.Request(
            f"{base_url}{chat_path}",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            buf = ""
            while True:
                chunk = resp.read(512)
                if not chunk:
                    break
                buf += chunk.decode("utf-8", errors="replace")
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    line = line.strip()
                    if not line or line == "data: [DONE]":
                        continue
                    if line.startswith("data: "):
                        try:
                            obj = json.loads(line[6:])
                            delta = (obj.get("choices") or [{}])[0].get("delta") or {}
                            c = delta.get("content") or ""
                            r = delta.get("reasoning_content") or ""
                            if c:
                                parsed_text += c
                                events.append(f'data: {json.dumps({"type": "tool_result", "name": "fetch_url", "content": c})}\n\n')
                            if r:
                                parsed_text += r
                        except json.JSONDecodeError:
                            pass
    except Exception as e:
        _ev(f"子模型解析失败: {e}")
        return f"模型解析失败: {e}"

    _ev(f"解析完成 ({len(parsed_text)} 字符)")
    return parsed_text or "(模型未返回内容)"


def _call_search_agent_stream(messages, yield_fn):
    """Call Nexora PAPI, stream content/think, return full text."""
    model_cfg = (config.get("models") or {}).get("web_search_agent") or {}
    model_name = str(model_cfg.get("model_name") or "").strip()
    temperature = model_cfg.get("temperature")
    max_tokens = model_cfg.get("max_output_tokens")
    think = bool(model_cfg.get("think", False))
    timeout = int(model_cfg.get("request_timeout") or 180)
    actual_model = model_name or str(config.get("default_model") or "").strip() or "gpt-4o-mini"
    logger.info("[search_agent] model=%s think=%s msgs=%d", actual_model, think, len(messages))

    nexora_cfg = config.get("nexora") or {}
    base_url = str(nexora_cfg.get("base_url") or "").strip().rstrip("/")
    api_key = str(nexora_cfg.get("api_key") or "").strip()
    chat_path = str(nexora_cfg.get("chat_completions_path") or "/api/papi/chat/completions").strip()
    if not chat_path.startswith("/"):
        chat_path = "/" + chat_path

    payload = {
        "model": actual_model,
        "stream": True,
        "messages": messages,
    }
    if temperature is not None and temperature != "":
        payload["temperature"] = temperature
    if max_tokens:
        payload["max_tokens"] = int(max_tokens)

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["X-API-Key"] = api_key
        headers["Authorization"] = f"Bearer {api_key}"

    url = f"{base_url}{chat_path}"
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    full_content = ""
    full_reasoning = ""

    try:
        logger.info("[search_agent] POST %s payload_keys=%s", url, list(payload.keys()))
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            buf = ""
            while True:
                chunk = resp.read(512)
                if not chunk:
                    break
                buf += chunk.decode("utf-8", errors="replace")
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    line = line.strip()
                    if not line or line == "data: [DONE]":
                        continue
                    if not line.startswith("data: "):
                        continue
                    try:
                        obj = json.loads(line[6:])
                        delta = (obj.get("choices") or [{}])[0].get("delta") or {}
                        c = delta.get("content") or ""
                        if c:
                            full_content += c
                            yield_fn(f"data: {json.dumps({'type': 'content', 'content': c})}\n\n")
                        r = delta.get("reasoning_content") or ""
                        if r:
                            full_reasoning += r
                            yield_fn(f"data: {json.dumps({'type': 'think', 'content': r})}\n\n")
                    except json.JSONDecodeError:
                        pass
    except urllib.error.HTTPError as e:
        err_body = ""
        try: err_body = e.read().decode("utf-8", errors="replace")[:500]
        except Exception: pass
        logger.error("[search_agent] HTTP %d: %s", e.code, err_body)
        yield_fn(f"data: {json.dumps({'type': 'error', 'content': f'HTTP {e.code}: {err_body}'})}\n\n")
    except Exception as e:
        logger.error("[search_agent] error: %s", e)
        yield_fn(f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n")

    return full_content, full_reasoning


@app.route("/admin/api/test/search", methods=["POST"])
def admin_test_search():
    if not _is_admin():
        return jsonify({"success": False, "message": "Unauthorized"}), 401

    data = request.get_json() or {}
    user_prompt = str(data.get("prompt") or "").strip()
    if not user_prompt:
        return jsonify({"success": False, "message": "请输入提示词"}), 400

    skills = data.get("skills") or []
    skills_text = ""
    if isinstance(skills, list) and skills:
        parts = []
        for s in skills:
            t = str(s.get("title") or "").strip()
            c = str(s.get("content") or "").strip()
            if t and c:
                parts.append(f"【{t}】\n{c}")
        if parts:
            skills_text = "\n\n可用技能：\n" + "\n\n".join(parts)

    web_prompt = str(config.get("web_search_prompt") or "").strip()
    # If prompt is outdated (missing tool_call format), use default
    if "<tool_call>" not in web_prompt:
        web_prompt = str(DEFAULT_CONFIG.get("web_search_prompt") or "").strip()
    system_content = web_prompt + skills_text

    messages = [
        {"role": "system", "content": system_content},
        {"role": "user", "content": user_prompt},
    ]

    max_rounds = 8

    def generate():
        # Debug: show what's being sent
        ws_cfg = (config.get("models") or {}).get("web_search_agent") or {}
        dbg_model = str(ws_cfg.get("model_name") or "").strip() or str(config.get("default_model") or "").strip() or "?"
        yield f'data: {json.dumps({"type": "debug", "content": f"[Round 0] model={dbg_model} | system_prompt_len={len(system_content)} | user_prompt={user_prompt[:100]}"})}\n\n'
        yield f'data: {json.dumps({"type": "debug", "content": f"[System Prompt 前200字] {system_content[:200]}"})}\n\n'

        for round_i in range(max_rounds):
            _buf = []
            def capture(s):
                _buf.append(s)

            content, reasoning = _call_search_agent_stream(messages, capture)

            # Flush streamed output
            for item in _buf:
                yield item

            # Parse tool calls from the accumulated text
            tool_calls = _parse_tool_calls(content)

            tail = content[-200:] if content else "(empty)"
            yield f'data: {json.dumps({"type": "debug", "content": f"[Round {round_i}] output_len={len(content)} tool_calls={len(tool_calls)} | tail={tail}"})}\n\n'

            if not tool_calls:
                break

            # Execute each tool call
            messages.append({"role": "assistant", "content": content})
            tool_result_text = ""
            for tc in tool_calls:
                fn_name = tc["name"]
                fn_args = tc["arguments"]

                if fn_name == "fetch_url":
                    url = fn_args.get("url") or ""
                    yield f"data: {json.dumps({'type': 'tool_call', 'name': 'fetch_url', 'args': {'url': url}})}\n\n"
                    tool_events = []
                    result = _execute_fetch_url_streaming(url, tool_events)
                    # Yield all progress/result events collected during tool execution
                    for ev in tool_events:
                        yield ev
                else:
                    yield f"data: {json.dumps({'type': 'tool_call', 'name': fn_name, 'args': fn_args})}\n\n"
                    result = f"未知工具: {fn_name}"

                yield f"data: {json.dumps({'type': 'tool_result_end', 'name': fn_name, 'content': result[-500:] if len(result) > 500 else result})}\n\n"
                tool_result_text += f"工具 {fn_name} 的返回结果：\n{result}\n\n"

            messages.append({"role": "user", "content": tool_result_text.strip()})

        yield "data: [DONE]\n\n"

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.before_request
def _admin_auth_gate():
    """Gate admin routes: require login, redirect to setup if no admin exists."""
    path = request.path or "/"
    if not path.startswith("/admin"):
        return None
    # Public admin paths
    if path in ("/admin/login", "/admin/setup"):
        return None
    # No admin account yet → force setup
    if not _has_admin_account():
        return redirect(url_for("admin_setup"))
    # Not logged in → force login
    if not _is_admin():
        if path.startswith("/admin/api/"):
            return jsonify({"success": False, "message": "Unauthorized"}), 401
        return redirect(url_for("admin_login"))
    return None


@app.route("/api/search/ddg", methods=["GET"])
@require_auth
def api_search_ddg():
    query = request.args.get("query", "")
    if not query:
        return jsonify({"success": False, "error": "Missing query parameter"}), 400

    max_results = int(request.args.get("max_results", 5))
    fetch_content = request.args.get("fetch_content", "false").lower() == "true"
    result = search_clean(query, max_results, fetch_content)

    if not result.get("success"):
        return jsonify(result), 500

    return jsonify(result)


@app.route("/api/search/render", methods=["GET"])
@require_auth
def api_search_render():
    query = request.args.get("query", "")
    if not query:
        return jsonify({"success": False, "error": "Missing query parameter"}), 400

    payload = render_search(query)
    return jsonify(
        {
            "success": True,
            "query": query,
            "results": payload.get("results", {}),
            "meta": payload.get("meta", {}),
        }
    )


@app.route("/api/render/webview", methods=["GET"])
@require_auth
def api_render_webview():
    url = request.args.get("url", "")
    if not url:
        return jsonify({"success": False, "error": "Missing url parameter"}), 400

    timeout = int(request.args.get("timeout", config.get("render", {}).get("default_timeout_ms", 15000)))
    use_sogou_fix = request.args.get("use_sogou_fix", "true").lower() == "true"
    result = rm.render_webview(url, timeout=timeout, use_sogou_fix=use_sogou_fix)
    if not result.get("success"):
        return jsonify(result), 500

    return jsonify(result)


@app.route("/api/agent/parse", methods=["POST"])
@require_auth
def api_agent_parse():
    data = request.get_json(silent=True) or {}

    url = str(data.get("url") or "").strip()
    if not url:
        return jsonify({"success": False, "error": "Missing url parameter"}), 400

    timeout = int(request.args.get("timeout", config.get("render", {}).get("default_timeout_ms", 15000)))
    use_sogou_fix = request.args.get("use_sogou_fix", "true").lower() == "true"

    page_title = str(data.get("title") or "").strip()
    page_html = str(data.get("html") or "").strip()
    page_text = str(data.get("text") or "").strip()
    page_content_source = "request"

    if not page_html and not page_text:
        render_result = rm.render_webview(url, timeout=timeout, use_sogou_fix=use_sogou_fix)
        if not render_result.get("success"):
            return jsonify(
                {
                    "success": False,
                    "status": 502,
                    "error": "Page render failed before parse",
                    "render_result": render_result,
                }
            ), 502

        page_title = page_title or str(render_result.get("title") or "").strip()
        page_html = str(render_result.get("full_html") or "").strip()
        page_text = str(render_result.get("content") or "").strip()
        page_content_source = str(render_result.get("mode") or render_result.get("warning") or "render_webview")

    result = agent_client.parse_page(
        url=url,
        title=page_title,
        html=page_html,
        text=page_text,
        instructions=str(data.get("instructions") or "").strip(),
        model_name=str(data.get("model") or "").strip() or None,
    )
    result["page_content_source"] = page_content_source
    result["page_title"] = page_title
    result["page_text_length"] = len(page_text)
    result["playwright_available"] = PLAYWRIGHT_AVAILABLE

    status_code = int(result.get("status") or (200 if result.get("success") else 502))
    return jsonify(result), status_code


@app.route("/", methods=["GET"])
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"success": True, "service": "NexoraSearch"})


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    srv_cfg = config.get("server", {})
    host = srv_cfg.get("host", "127.0.0.1")
    port = srv_cfg.get("port", 8080)

    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        logger.info("NexoraSearch is starting on http://%s:%s", host, port)
        logger.info("Auth token: %s", config.get("auth", {}).get("token"))
        logger.info(
            "Page parse model: %s",
            str(config.get("models", {}).get("page_parse_agent", {}).get("model_name", "") or "<unset>"),
        )
        logger.info("Nexora PAPI base_url: %s", str(config.get("nexora", {}).get("base_url", "") or "<unset>"))

    app.run(
        host=host,
        port=port,
        debug=bool(srv_cfg.get("debug", False)),
        threaded=True,
    )
