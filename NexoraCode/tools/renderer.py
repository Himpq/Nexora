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
    try:
        import trafilatura
        result = trafilatura.extract(html, url=url, include_links=False, include_images=False)
        return result or "[No main content extracted]"
    except ImportError:
        # trafilatura 未安装时降级到全文
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

    try:
        return asyncio.run(_render_async(url, wait_for, extract_mode))
    except ModuleNotFoundError:
        try:
            data = _render_static(url, extract_mode)
            data["warning"] = "playwright 未安装，已降级为静态抓取"
            return data
        except Exception as e:
            return {"error": f"playwright 未安装且静态抓取失败: {e}"}
    except Exception as e:
        msg = str(e)
        lower = msg.lower()
        if "playwright" in lower and ("install" in lower or "executable doesn't exist" in lower):
            try:
                data = _render_static(url, extract_mode)
                data["warning"] = "playwright 浏览器未安装，已降级为静态抓取"
                return data
            except Exception as fallback_err:
                return {"error": f"{msg}; 静态抓取也失败: {fallback_err}"}
        return {"error": msg}
