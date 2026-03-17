"""
工具：Playwright 网页渲染 + Readability 正文提取
"""

import asyncio
import re
from core.config import config

TOOL_MANIFEST = [
    {
        "name": "local_web_render",
        "handler": "web_render",
        "description": "使用用户本地浏览器渲染指定 URL，提取正文文本内容，支持 JS 渲染的动态页面（NexoraCode 本地工具）。可以进行搜索、爬取网页等操作。",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "目标页面 URL"},
                "wait_for": {
                    "type": "string",
                    "enum": ["load", "networkidle", "domcontentloaded"],
                    "default": "networkidle",
                    "description": "等待策略",
                },
                "extract_mode": {
                    "type": "string",
                    "enum": ["readability", "full_text", "html", "interactive"],
                    "default": "readability",
                    "description": "提取模式：readability(正文), full_text(全文), html(源码), interactive(驻留坐标获取模式)",
                },
            },
            "required": ["url"],
        },
    },
    {
        "name": "web_click",
        "handler": "handle_web_click",
        "description": "在 interactive 模式下点击目标网页上的元素节点",
        "parameters": {
            "type": "object",
            "properties": {
                "node_id": {"type": "integer", "description": "要点击的元素的 data-nexora-id"}
            },
            "required": ["node_id"]
        }
    },
    {
        "name": "web_exec_js",
        "handler": "handle_web_exec_js",
        "description": "在 interactive 模式下向目标被代理网页注入、执行自定义纯 JS 代码。可用于设置输入框数值、处理下拉列表或自定义 DOM 追踪等更深度的操作。执行完毕会返回最新的交互 DOM",
        "parameters": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "要注入执行的 JavaScript 代码内容。内部需要包含 return 或者直接进行 DOM 操作。"}
            },
            "required": ["code"]
        }
    },
    {
        "name": "web_scroll",
        "handler": "handle_web_scroll",
        "description": "在 interactive 模式下向下或向上滚动页面",
        "parameters": {
            "type": "object",
            "properties": {
                "direction": {"type": "string", "enum": ["down", "up", "bottom", "top"], "description": "滚动方向"}
            },
            "required": ["direction"]
        }
    }
]

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

_INTERACTIVE_WIN = None
_INTERACTIVE_READY = threading.Event()

def _get_interactive_dom():
    if not _INTERACTIVE_WIN:
        return {"error": "Interactive window not initialized"}
    
    js_code = """
    (function() {
        let res = [];
        let eid = 0;
        let elements = document.querySelectorAll('a, button, input, select, textarea, [role="button"], summary');
        for (let i = 0; i < elements.length; i++) {
            let el = elements[i];
            let rect = el.getBoundingClientRect();
            if(rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight * 2.5 && rect.bottom > -window.innerHeight) {
                eid++;
                el.setAttribute('data-nexora-id', eid);
                let raw_text = el.innerText || el.value || el.name || el.id || el.tagName || "";
                let text = String(raw_text).substring(0, 50).split(String.fromCharCode(10)).join(' ').trim();
                res.push(`[ID:${eid} ${el.tagName} (${text}) pos:(${Math.round(rect.left)},${Math.round(rect.top)})]`);
            }
        }
        return res.join(String.fromCharCode(10));
    })();
    """
    try:
        nodes = _INTERACTIVE_WIN.evaluate_js(js_code)
        title = _INTERACTIVE_WIN.evaluate_js("document.title")
        url = _INTERACTIVE_WIN.evaluate_js("window.location.href")
        content = f"网页已准备：{title}\nURL：{url}\n\n【当前视窗节点分布】：\n{nodes}"
        return {"title": title, "url": url, "content": content}
    except Exception as e:
        return {"error": f"Evaluate Error: {str(e)}"}

def _init_interactive_window(url: str):
    global _INTERACTIVE_WIN
    import webview
    
    if _INTERACTIVE_WIN is not None:
        try:
            _INTERACTIVE_READY.clear()
            _INTERACTIVE_WIN.load_url(url)
            # _INTERACTIVE_READY.wait(timeout=10)
            import time
            time.sleep(1.5) # wait for DOM build
            return _get_interactive_dom()
        except:
            _INTERACTIVE_WIN = None
            
    window_id = f"interactive_{uuid.uuid4().hex[:8]}"
    _INTERACTIVE_READY.clear()
    
    # Needs to be a bit large
    import webview
    import time
    w = webview.create_window(window_id, url, hidden=False, width=1280, height=800)
    _INTERACTIVE_WIN = w
    
    def on_loaded():
        _INTERACTIVE_READY.set()
        
    w.events.loaded += on_loaded
    # _INTERACTIVE_READY.wait(timeout=20)
    time.sleep(2)
    return _get_interactive_dom()

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
        ok = _INTERACTIVE_WIN.evaluate_js(js)
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
        res = _INTERACTIVE_WIN.evaluate_js(wrapped_code)
        time.sleep(1) # Short wait for DOM to settle
        return {"result": str(res), "dom": _get_interactive_dom()}
    except Exception as e:
        return {"error": f"JS eval failed: {str(e)}"}

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
        _INTERACTIVE_WIN.evaluate_js(js)
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
    import requests

    timeout_sec = int(config.get("renderer_timeout", 20))
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        )
    }
    resp = requests.get(url, headers=headers, timeout=timeout_sec, allow_redirects=True)
    resp.raise_for_status()
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


async def _render_async(url: str, wait_for: str, extract_mode: str) -> dict:
    from playwright.async_api import async_playwright

    timeout_ms = config.get("renderer_timeout", 20) * 1000

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            )
        )
        page = await context.new_page()

        try:
            await page.goto(url, wait_until=wait_for, timeout=timeout_ms)
        except Exception as e:
            await browser.close()
            return {"error": f"Navigation failed: {e}"}

        title = await page.title()
        html = await page.content()
        await browser.close()

    if extract_mode == "html":
        return {"title": title, "content": html, "url": url}
    elif extract_mode == "full_text":
        content = _extract_readability(html, url)
        return {"title": title, "content": content, "url": url}
    else:  # readability
        content = _extract_readability(html, url)
        return {"title": title, "content": content, "url": url}


def web_render(url: str, wait_for: str = "networkidle", extract_mode: str = "readability") -> dict:
    engine = str(config.get("renderer_engine", "auto") or "auto").strip().lower()
    if engine == "requests":
        try:
            return _render_static(url, extract_mode)
        except Exception as e:
            return {"error": str(e)}

    # 优先尝试 WebView 后台无头渲染（无需安装庞大的 Playwright）
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
        return asyncio.run(_render_async(url, wait_for, extract_mode))
    except ModuleNotFoundError:
        try:
            data = _render_static(url, extract_mode)
            data["warning"] = "后台 WebView 与 Playwright 均不可用，已降级为纯静态抓取"
            return data
        except Exception as e:
            return {"error": f"网页渲染器与静态抓取全部失败: {e}"}
    except Exception as e:
        msg = str(e)
        lower = msg.lower()
        if "playwright" in lower and ("install" in lower or "executable doesn't exist" in lower):
            try:
                data = _render_static(url, extract_mode)
                data["warning"] = "后台 WebView 与 Playwright 均不可用，已降级为纯静态抓取"
                return data
            except Exception as fallback_err:
                return {"error": f"{msg}; 静态抓取也失败: {fallback_err}"}
        return {"error": msg}
