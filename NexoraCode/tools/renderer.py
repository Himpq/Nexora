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
                    "enum": ["readability", "full_text", "html"],
                    "default": "readability",
                    "description": "提取模式：readability=正文、full_text=全文、html=原始HTML",
                },
            },
            "required": ["url"],
        },
    }
]

# Readability.js 的 Python 移植（使用 trafilatura 库）
def _extract_readability(html: str, url: str) -> str:
    # 优先尝试利用 BeautifulSoup 对 HTML 节点进行修改：将 <a> 标签和 onclick 转为 [URL] Title 格式
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, 'html.parser')
        
        # 处理普通 <a> 标签
        for a in soup.find_all('a', href=True):
            href = a['href'].strip()
            text = a.get_text(strip=True)
            if href and not href.startswith('javascript:') and text:
                a.string = f"[{href}] {text}"
                
        # 处理带有 onclick 类似 location.href 跳转的元素
        for el in soup.find_all(attrs={'onclick': True}):
            onclick = el['onclick'].strip()
            m = re.search(r"(?:window\.)?location(?:\[\'href\'\]|\.href)?\s*=\s*['\"](.*?)['\"]", onclick)
            if m:
                href = m.group(1).strip()
                text = el.get_text(strip=True)
                if href and not href.startswith('javascript:') and text:
                    el.string = f"[{href}] {text}"
                    
        # 用替换后的 HTML 送入 trafilatura 获取结构化干净文本
        html = str(soup)
    except Exception as bs_err:
        import logging
        logging.warning(f"BeautifulSoup preprocessing failed: {bs_err}")

    try:
        import trafilatura
        # trafilatura在处理自己生成的结果时有时会吞掉链接，所以提前使用bs4把带链接的文字重写上去。
        result = trafilatura.extract(html, url=url, include_links=True, include_images=False)
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


def _render_webview(url: str, extract_mode: str) -> dict:
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
