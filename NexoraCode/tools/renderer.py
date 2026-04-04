"""
工具：网页渲染 + Readability 正文提取
"""

import re
from core.config import config, get_app_root

# Tool definitions are centralized in tools/catalog.py.
TOOL_MANIFEST = []

# Readability.js 的 Python 移植（使用 trafilatura 库）
def _extract_readability(html: str, url: str) -> str:
    # 优先尝试利用 BeautifulSoup 对 HTML 节点进行修改：将 <a> 标签和 onclick 转为 [URL] Title 格式
    try:
        from bs4 import BeautifulSoup
        import urllib.parse
        soup = BeautifulSoup(html, 'html.parser')
        
        # 处理普通 <a> 标签
        for a in soup.find_all('a', href=True):
            href = a['href'].strip()
            text = a.get_text(strip=True)
            if href and not href.startswith('javascript:') and text:
                full_href = urllib.parse.urljoin(url, href)
                a.string = f"[{full_href}] {text}"
                
        # 处理带有 onclick 类似 location.href 跳转的元素
        for el in soup.find_all(attrs={'onclick': True}):
            onclick = el['onclick'].strip()
            m = re.search(r"(?:window\.)?location(?:\[\'href\'\]|\.href)?\s*=\s*['\"](.*?)['\"]", onclick)
            if m:
                href = m.group(1).strip()
                text = el.get_text(strip=True)
                if href and not href.startswith('javascript:') and text:
                    full_href = urllib.parse.urljoin(url, href)
                    el.string = f"[{full_href}] {text}"
                    
        # 用替换后的 HTML 送入 trafilatura 获取结构化干净文本
        html = str(soup)
    except Exception as bs_err:
        import logging
        logging.warning(f"BeautifulSoup preprocessing failed: {bs_err}")

    try:
        import trafilatura
        # trafilatura在处理自己生成的结果时有时会吞掉链接，所以关闭 include_links，完全依赖上面 bs4 提前重写的文本。
        result = trafilatura.extract(html, url=url, include_links=False, include_images=False)
        return result or "[No main content extracted]"
    except Exception as e:
        # trafilatura 未安装或执行失败（如缺少配置文件）时降级到全文
        import logging
        logging.warning(f"Trafilatura extraction failed: {e}, falling back to Basic HTMLParser")
        from html.parser import HTMLParser
        class _TextExtractor(HTMLParser):
            def __init__(self):
                super().__init__()
                self.texts = []
                self._skip_tags = {"script", "style", "noscript", "head"}
                self._current_skip = 0

            def handle_starttag(self, tag, attrs):
                if tag in self._skip_tags:
                    self._current_skip += 1
            def handle_endtag(self, tag):
                if tag in self._skip_tags:
                    self._current_skip = max(0, self._current_skip - 1)
            def handle_data(self, data):
                if self._current_skip == 0:
                    text = data.strip()
                    if text:
                        self.texts.append(text)
        extractor = _TextExtractor()
        extractor.feed(html)
        return "\n".join(extractor.texts)


def _extract_title(html: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", html or "", flags=re.IGNORECASE | re.DOTALL)
    if not m:
        return ""
    return re.sub(r"\s+", " ", (m.group(1) or "").strip())


import threading
import time
import uuid
from pathlib import Path

_INTERACTIVE_WIN = None
_INTERACTIVE_READY = threading.Event()
_STATIC_COOKIE_LOCK = threading.Lock()
_STATIC_REQUESTS_SESSION = None
_STATIC_COOKIE_JAR_PATH = Path(get_app_root()) / "renderer_cookies.lwp"


def _get_static_requests_session():
    global _STATIC_REQUESTS_SESSION
    if _STATIC_REQUESTS_SESSION is not None:
        return _STATIC_REQUESTS_SESSION
    import requests
    from http.cookiejar import LWPCookieJar

    session = requests.Session()
    jar = LWPCookieJar(str(_STATIC_COOKIE_JAR_PATH))
    try:
        if _STATIC_COOKIE_JAR_PATH.exists():
            jar.load(ignore_discard=True, ignore_expires=True)
    except Exception:
        pass
    session.cookies = jar
    _STATIC_REQUESTS_SESSION = session
    return session


def _save_static_requests_cookies(session=None):
    sess = session or _STATIC_REQUESTS_SESSION
    if not sess:
        return
    jar = getattr(sess, "cookies", None)
    if not jar or not hasattr(jar, "save"):
        return
    with _STATIC_COOKIE_LOCK:
        try:
            _STATIC_COOKIE_JAR_PATH.parent.mkdir(parents=True, exist_ok=True)
            jar.save(ignore_discard=True, ignore_expires=True)
        except Exception:
            pass


def _merge_document_cookies_into_static_session(url: str, cookie_text: str):
    from http.cookies import SimpleCookie
    from urllib.parse import urlsplit
    from requests.cookies import create_cookie

    target_url = str(url or "").strip()
    raw_cookie = str(cookie_text or "").strip()
    if not target_url or not raw_cookie:
        return

    host = str(urlsplit(target_url).hostname or "").strip()
    if not host:
        return

    parsed = SimpleCookie()
    try:
        parsed.load(raw_cookie)
    except Exception:
        return

    session = _get_static_requests_session()
    changed = False
    for key, morsel in parsed.items():
        name = str(key or "").strip()
        if not name:
            continue
        try:
            cookie = create_cookie(
                name=name,
                value=str(morsel.value or ""),
                domain=host,
                path="/",
                secure=target_url.lower().startswith("https://"),
            )
            session.cookies.set_cookie(cookie)
            changed = True
        except Exception:
            continue
    if changed:
        _save_static_requests_cookies(session)


def _sync_interactive_cookies_to_static_session():
    if not _INTERACTIVE_WIN:
        return
    payload, err = _interactive_eval_js_safe(
        "(function(){return {url:String(window.location.href||''), cookie:String(document.cookie||'')};})();",
        timeout_sec=2.5,
    )
    if err or not isinstance(payload, dict):
        return
    _merge_document_cookies_into_static_session(payload.get("url"), payload.get("cookie"))


def _run_with_timeout(func, timeout_sec: float = 4.0):
    done = threading.Event()
    box = {}

    def _runner():
        try:
            box["value"] = func()
        except Exception as e:
            box["error"] = e
        finally:
            done.set()

    t = threading.Thread(target=_runner, daemon=True)
    t.start()
    if not done.wait(timeout=max(0.2, float(timeout_sec or 0))):
        return False, {"error": f"Interactive call timeout ({timeout_sec}s)"}
    if "error" in box:
        return False, {"error": str(box["error"])}
    return True, box.get("value")


def _interactive_eval_js_safe(js_code: str, timeout_sec: float = 4.0):
    global _INTERACTIVE_WIN
    if not _INTERACTIVE_WIN:
        return None, {"error": "Interactive window not initialized"}
    ok, res = _run_with_timeout(lambda: _INTERACTIVE_WIN.evaluate_js(js_code), timeout_sec)
    if not ok:
        # Window may have been closed manually; force re-init on next call.
        _INTERACTIVE_WIN = None
        return None, res
    return res, None


def _interactive_window_alive() -> bool:
    value, err = _interactive_eval_js_safe("(function(){return true;})();", timeout_sec=1.2)
    return (err is None) and bool(value)


def _interactive_dom_js() -> str:
    return """
    (function() {
        function splitWords(v) {
            var s = String(v || '').trim();
            if (!s) return [];
            var out = [];
            var cur = '';
            for (var i = 0; i < s.length; i++) {
                var ch = s.charAt(i);
                var isWs = (ch === ' ' || ch === '\\n' || ch === '\\r' || ch === '\\t' || ch === '\\f' || ch === '\\v');
                if (isWs) {
                    if (cur) out.push(cur);
                    cur = '';
                } else {
                    cur += ch;
                }
            }
            if (cur) out.push(cur);
            return out;
        }
        function escCss(v) {
            var s = String(v || '');
            if (!s) return '';
            if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
            var specials = " !\\\"#$%&'()*+,./:;<=>?@[\\\\]^`{|}~";
            var out = '';
            for (var i = 0; i < s.length; i++) {
                var ch = s.charAt(i);
                if (specials.indexOf(ch) >= 0) out += '\\\\';
                out += ch;
            }
            return out;
        }
        function escAttr(v) {
            var s = String(v || '');
            return s.split('\\\\').join('\\\\\\\\').split('"').join('\\\\\"');
        }
        function normText(v) {
            var parts = splitWords(v);
            return parts.join(' ').trim();
        }
        function nthOfType(el) {
            var idx = 1;
            var cur = el;
            while (cur && cur.previousElementSibling) {
                cur = cur.previousElementSibling;
                if (cur.tagName === el.tagName) idx += 1;
            }
            return idx;
        }
        function cssPath(el) {
            var parts = [];
            var cur = el;
            var depth = 0;
            while (cur && cur.nodeType === 1 && depth < 6) {
                var tag = String(cur.tagName || '').toLowerCase();
                if (!tag) break;
                var seg = tag;
                if (cur.id) {
                    seg += '#' + escCss(cur.id);
                    parts.unshift(seg);
                    break;
                }
                var cls = splitWords(cur.className || '').slice(0, 2);
                if (cls.length) seg += '.' + cls.map(escCss).join('.');
                else seg += ':nth-of-type(' + nthOfType(cur) + ')';
                parts.unshift(seg);
                cur = cur.parentElement;
                depth += 1;
            }
            return parts.join(' > ');
        }
        function buildNode(el, nodeId, rect) {
            var tag = String(el.tagName || '').toLowerCase();
            var classes = splitWords(el.className || '').slice(0, 4);
            var text = normText(el.innerText || el.textContent || el.value || el.placeholder || el.name || el.id || tag).slice(0, 80);
            var selectors = [];
            function pushSel(v) {
                if (!v) return;
                if (selectors.indexOf(v) < 0) selectors.push(v);
            }
            var dataSel = '[data-nexora-id="' + nodeId + '"]';
            var byId = el.id ? ('#' + escCss(el.id)) : '';
            var byClass = classes.length ? (tag + '.' + classes.map(escCss).join('.')) : '';
            var byName = el.name ? (tag + '[name="' + escAttr(el.name) + '"]') : '';
            var byPlaceholder = el.placeholder ? (tag + '[placeholder="' + escAttr(el.placeholder) + '"]') : '';
            var byType = el.type ? (tag + '[type="' + escAttr(el.type) + '"]') : '';
            var path = cssPath(el);
            pushSel(byId);
            pushSel(byName);
            pushSel(byPlaceholder);
            pushSel(byClass);
            pushSel(byType);
            pushSel(path);
            pushSel(dataSel);
            return {
                node_id: nodeId,
                tag: tag,
                text: text,
                rect: [
                    Math.round(rect.left),
                    Math.round(rect.top),
                    Math.round(rect.width),
                    Math.round(rect.height)
                ],
                id: String(el.id || ''),
                class_name: classes.join(' '),
                name: String(el.name || ''),
                type: String(el.type || ''),
                placeholder: String(el.placeholder || ''),
                role: String(el.getAttribute('role') || ''),
                aria_label: String(el.getAttribute('aria-label') || ''),
                locator: {
                    preferred: selectors[0] || dataSel,
                    css: {
                        data_nexora: dataSel,
                        by_id: byId,
                        by_name: byName,
                        by_placeholder: byPlaceholder,
                        by_class: byClass,
                        by_type: byType,
                        path: path
                    },
                    alternatives: selectors
                }
            };
        }

        var out = [];
        var seen = 0;
        var elements = document.querySelectorAll('a, button, input, select, textarea, [role="button"], summary, [contenteditable=""], [contenteditable="true"]');
        for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            var rect = el.getBoundingClientRect();
            if (!(rect.width > 0 && rect.height > 0)) continue;
            if (!(rect.top < window.innerHeight * 2.5 && rect.bottom > -window.innerHeight)) continue;
            seen += 1;
            el.setAttribute('data-nexora-id', String(seen));
            out.push(buildNode(el, seen, rect));
        }
        return {
            title: String(document.title || ''),
            url: String(window.location.href || ''),
            viewport: {
                width: Math.round(window.innerWidth || 0),
                height: Math.round(window.innerHeight || 0),
                scroll_x: Math.round(window.scrollX || 0),
                scroll_y: Math.round(window.scrollY || 0)
            },
            nodes: out
        };
    })();
    """


def _format_interactive_node_line(node: dict) -> str:
    tag = str(node.get("tag", "") or "").upper()
    node_id = int(node.get("node_id", 0) or 0)
    text = str(node.get("text", "") or "").strip()
    rect = node.get("rect", []) if isinstance(node.get("rect", []), list) else []
    rect_text = f"[{', '.join(str(int(x)) for x in rect[:4])}]" if rect else "[]"
    locator = node.get("locator", {}) if isinstance(node.get("locator"), dict) else {}
    preferred = str(locator.get("preferred", "") or "")
    extras = []
    if node.get("id"):
        extras.append(f"id={node.get('id')}")
    if node.get("class_name"):
        extras.append(f"class={node.get('class_name')}")
    if preferred:
        extras.append(f"selector={preferred}")
    meta = " | ".join(extras)
    if meta:
        meta = " | " + meta
    return f"[ID:{node_id} {tag} ({text}) rect:{rect_text}{meta}]"


def _build_interactive_snapshot(payload) -> dict:
    import json
    import ast
    if payload is None:
        payload = {}
    if isinstance(payload, bool):
        payload = {}
    if isinstance(payload, str):
        txt = payload.strip()
        if txt:
            try:
                payload = json.loads(txt)
            except Exception:
                try:
                    payload = ast.literal_eval(txt)
                except Exception:
                    payload = {}
    if isinstance(payload, list) and len(payload) == 1 and isinstance(payload[0], dict):
        payload = payload[0]
    if not isinstance(payload, dict):
        payload = {}
    title = str(payload.get("title", "") or "")
    url = str(payload.get("url", "") or "")
    nodes = payload.get("nodes", [])
    if not isinstance(nodes, list):
        nodes = []
    lines = [_format_interactive_node_line(node) for node in nodes if isinstance(node, dict)]
    content = f"网页已准备：{title}\nURL：{url}\n\n【当前视窗节点分布】\n" + ("\n".join(lines) if lines else "(none)")
    return {
        "title": title,
        "url": url,
        "viewport": payload.get("viewport", {}),
        "nodes": nodes,
        "content": content,
    }


def _interactive_basic_snapshot() -> dict:
    title, err1 = _interactive_eval_js_safe("(function(){return String(document.title || '');})();", timeout_sec=2.0)
    if err1:
        return err1
    url, err2 = _interactive_eval_js_safe("(function(){return String(window.location.href || '');})();", timeout_sec=2.0)
    if err2:
        return err2
    payload = {
        "title": str(title or ""),
        "url": str(url or ""),
        "viewport": {},
        "nodes": []
    }
    _sync_interactive_cookies_to_static_session()
    return _build_interactive_snapshot(payload)


def _get_interactive_dom():
    if not _INTERACTIVE_WIN:
        return {"error": "Interactive window not initialized"}
    try:
        last_err = None
        for _ in range(3):
            payload, err = _interactive_eval_js_safe(_interactive_dom_js(), timeout_sec=5.0)
            if err:
                last_err = err
                time.sleep(0.25)
                continue
            _sync_interactive_cookies_to_static_session()
            snap = _build_interactive_snapshot(payload)
            # During navigation transition, payload may be empty/non-structured; retry briefly.
            if snap.get("title") or snap.get("url") or snap.get("nodes"):
                return snap
            time.sleep(0.25)
        if last_err:
            return last_err
        return _interactive_basic_snapshot()
    except Exception as e:
        return {"error": f"Evaluate Error: {str(e)}"}

def _init_interactive_window(url: str):
    global _INTERACTIVE_WIN
    import webview
    
    if _INTERACTIVE_WIN is not None:
        try:
            if not _interactive_window_alive():
                _INTERACTIVE_WIN = None
            else:
                _INTERACTIVE_READY.clear()
                ok, res = _run_with_timeout(lambda: _INTERACTIVE_WIN.load_url(url), timeout_sec=2.5)
                if not ok:
                    _INTERACTIVE_WIN = None
                else:
                    import time
                    time.sleep(1.5) # wait for DOM build
                    return _get_interactive_dom()
        except:
            _INTERACTIVE_WIN = None

    if _INTERACTIVE_WIN is not None:
        return _get_interactive_dom()

    try:
        window_id = f"interactive_{uuid.uuid4().hex[:8]}"
        _INTERACTIVE_READY.clear()

        # Needs to be a bit large
        import webview
        import time
        w = webview.create_window(window_id, url, hidden=False, width=1280, height=800)
        _INTERACTIVE_WIN = w

        def on_loaded():
            _INTERACTIVE_READY.set()

        def on_closed():
            global _INTERACTIVE_WIN
            if _INTERACTIVE_WIN is w:
                _INTERACTIVE_WIN = None
                _INTERACTIVE_READY.clear()

        w.events.loaded += on_loaded
        if hasattr(w.events, "closed"):
            w.events.closed += on_closed
        # _INTERACTIVE_READY.wait(timeout=20)
        time.sleep(2)
        return _get_interactive_dom()
    except Exception as e:
        _INTERACTIVE_WIN = None
        return {"error": f"Interactive window create failed: {e}"}

def handle_web_click(node_id: int) -> dict:
    if not _INTERACTIVE_WIN:
        return {"error": "驻留浏览器未启动，请先使用 local_web_render 并指定 extract_mode='interactive'"}
    js = f"""
    (function() {{
        var el = document.querySelector('[data-nexora-id="{node_id}"]');
        if (el) {{
            // Remove target so new_window behavior is blocked
            if (el.tagName && el.tagName.toLowerCase() === 'a') el.removeAttribute('target');
            let parent = el.closest ? el.closest('a[target="_blank"]') : null;
            if (parent) parent.removeAttribute('target');
            
            el.click(); 
            return true; 
        }}
        return false;
    }})();
    """
    try:
        ok, err = _interactive_eval_js_safe(js, timeout_sec=4.5)
        if err:
            return err
        if not ok:
            return {"error": f"找不到 ID 为 {node_id} 的元素"}
        import time
        time.sleep(3) # Wait for page load or JS mutation
        return _get_interactive_dom()
    except Exception as e:
        return {"error": f"Click Error: {str(e)}"}

def handle_web_exec_js(code: str) -> dict:
    if not _INTERACTIVE_WIN:
        return {"error": "驻留浏览器未启动"}
    try:
        import time
        # Ensure it is safely evaluated and returned
        # Wrap the code in an IIFE to ensure variables are locally scoped and the return value escapes
        if "return" in code and not "(function(" in code:
            wrapped_code = f"(function() {{\n{code}\n}})();"
        else:
            wrapped_code = code
        res, err = _interactive_eval_js_safe(wrapped_code, timeout_sec=6.0)
        if err:
            return err
        time.sleep(1) # Short wait for DOM to settle
        return {"result": str(res), "dom": _get_interactive_dom()}
    except Exception as e:
        return {"error": f"JS eval failed: {str(e)}"}


def handle_web_input(selector: str, text: str, submit: bool = False) -> dict:
    if not _INTERACTIVE_WIN:
        return {"error": "驻留浏览器未启动，请先使用 local_web_render 并指定 extract_mode='interactive'"}
    safe_selector = str(selector or "").strip()
    if not safe_selector:
        return {"error": "selector 不能为空"}
    import json
    js = f"""
    (function() {{
        var selector = {json.dumps(safe_selector, ensure_ascii=False)};
        var text = {json.dumps(str(text or ""), ensure_ascii=False)};
        var submit = {str(bool(submit)).lower()};
        var el = document.querySelector(selector);
        if (!el) {{
            return {{ ok: false, error: 'element_not_found', selector: selector }};
        }}
        function setValue(node, value) {{
            var tag = String(node.tagName || '').toUpperCase();
            var proto = null;
            if (tag === 'TEXTAREA') proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
            else if (tag === 'SELECT') proto = window.HTMLSelectElement && window.HTMLSelectElement.prototype;
            else proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
            var desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
            if (desc && typeof desc.set === 'function') desc.set.call(node, value);
            else node.value = value;
        }}
        el.focus();
        if (el.isContentEditable) {{
            el.innerText = text;
            el.dispatchEvent(new InputEvent('input', {{ bubbles: true, data: text }}));
        }} else {{
            setValue(el, text);
            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
            el.dispatchEvent(new Event('change', {{ bubbles: true }}));
        }}
        if (submit) {{
            try {{
                el.dispatchEvent(new KeyboardEvent('keydown', {{ key: 'Enter', code: 'Enter', bubbles: true }}));
                el.dispatchEvent(new KeyboardEvent('keypress', {{ key: 'Enter', code: 'Enter', bubbles: true }}));
                el.dispatchEvent(new KeyboardEvent('keyup', {{ key: 'Enter', code: 'Enter', bubbles: true }}));
            }} catch (_) {{}}
            var form = el.form || (el.closest ? el.closest('form') : null);
            if (form) {{
                if (typeof form.requestSubmit === 'function') form.requestSubmit();
                else if (typeof form.submit === 'function') form.submit();
            }}
        }}
        return {{
            ok: true,
            selector: selector,
            tag: String(el.tagName || '').toLowerCase(),
            value: el.isContentEditable ? String(el.innerText || '') : String(el.value || '')
        }};
    }})();
    """
    try:
        import time
        result, err = _interactive_eval_js_safe(js, timeout_sec=6.0)
        if err:
            return err
        time.sleep(1)
        return {"result": result, "dom": _get_interactive_dom()}
    except Exception as e:
        return {"error": f"Input Error: {str(e)}"}

def handle_web_scroll(direction: str) -> dict:
    if not _INTERACTIVE_WIN:
        return {"error": "驻留浏览器未启动"}
    js_map = {
        "down": "window.scrollBy(0, window.innerHeight * 0.8)",
        "up": "window.scrollBy(0, -window.innerHeight * 0.8)",
        "top": "window.scrollTo(0, 0)",
        "bottom": "window.scrollTo(0, document.body.scrollHeight)"
    }
    js = js_map.get(direction, "window.scrollBy(0, window.innerHeight * 0.5)")
    try:
        _, err = _interactive_eval_js_safe(js, timeout_sec=4.5)
        if err:
            return err
        import time
        time.sleep(1)
        return _get_interactive_dom()
    except Exception as e:
        return {"error": f"Scroll Error: {str(e)}"}

def _render_webview(

url: str, extract_mode: str) -> dict:
    import webview
    import threading
    import time
    import uuid
    
    timeout_sec = int(config.get("renderer_timeout", 20))
    event = threading.Event()
    result = {}
    
    window_id = f"hidden_render_{uuid.uuid4().hex[:8]}"
    
    def on_loaded():
        # wait a bit for dynamic JS
        time.sleep(1.5)
        try:
            html = w.evaluate_js('document.documentElement.outerHTML')
            title = w.evaluate_js('document.title')
            result["html"] = html
            result["title"] = title
        except Exception as e:
            result["error"] = str(e)
        finally:
            event.set()

    try:
        w = webview.create_window(window_id, url, hidden=True)
        w.events.loaded += on_loaded
    except Exception as e:
        return {"error": f"创建后台 WebView 失败: {e}"}

    success = event.wait(timeout=timeout_sec)
    
    try:
        w.destroy()
    except:
        pass
        
    if not success:
        return {"error": f"WebView 渲染超时 ({timeout_sec}s)"}

    if "error" in result:
        return {"error": f"WebView JS 执行异常: {result['error']}"}

    html = result.get("html", "")
    title = result.get("title", url)
    
    # WebView 动态执行拿到的 HTML，通常比较干净
    if extract_mode == "html":
        content = html
    else:
        content = _extract_readability(html, url)
        
    return {
        "title": title,
        "content": content,
        "url": url,
        "engine": "webview",
    }


def _render_static(url: str, extract_mode: str) -> dict:
    timeout_sec = int(config.get("renderer_timeout", 20))
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        )
    }
    session = _get_static_requests_session()
    resp = session.get(url, headers=headers, timeout=timeout_sec, allow_redirects=True)
    resp.raise_for_status()
    _save_static_requests_cookies(session)
    html = resp.text or ""
    title = _extract_title(html) or (resp.url or url)
    if extract_mode == "html":
        content = html
    else:
        content = _extract_readability(html, resp.url or url)
    return {
        "title": title,
        "content": content,
        "url": resp.url or url,
        "engine": "requests_fallback",
    }


def web_render(url: str, wait_for: str = "networkidle", extract_mode: str = "readability") -> dict:
    engine = str(config.get("renderer_engine", "auto") or "auto").strip().lower()
    if engine == "requests":
        try:
            return _render_static(url, extract_mode)
        except Exception as e:
            return {"error": str(e)}

    # 优先尝试 WebView 后台无头渲染
    try:
        import webview
        # 如果已经有活跃的 webview（通过 webview.windows 判断应用是否已经启动 GUI 循环）
        if len(webview.windows) > 0:
            if extract_mode == "interactive":
                return _init_interactive_window(url)
            
            res = _render_webview(url, extract_mode)
            if "error" not in res:
                return res
            # 如果 webview 报错，回退到 static
            import logging
            logging.warning(f"WebView render API fallback due to: {res['error']}")
    except Exception as e:
        import logging
        logging.warning(f"WebView initialization skipped: {e}")

    try:
        data = _render_static(url, extract_mode)
        data["warning"] = "后台 WebView 不可用，已降级为纯静态抓取"
        return data
    except Exception as e:
        return {"error": f"网页渲染器与静态抓取全部失败: {e}"}
