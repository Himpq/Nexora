"""
Universal page rendering crawler powered by Crawlee PlaywrightCrawler.

Crawls any given URL, waits for full page render, extracts text and HTML content.
Supports waiting for custom CSS selectors for SPA / dynamic pages.
"""

import asyncio
import random
from datetime import timedelta

from crawlee.crawlers import PlaywrightCrawler, PlaywrightCrawlingContext

from .loop import run_crawlee


USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
]


def crawl_page(
    url: str,
    wait_selector: str = "",
    scroll: bool = True,
    extract_html: bool = True,
    timeout_ms: int = 30000,
    event_callback=None,
) -> dict:
    """Crawl a single page with full rendering.

    Args:
        url: The URL to crawl.
        wait_selector: Optional CSS selector to wait for before extraction.
        scroll: Whether to scroll down to trigger lazy-loaded content.
        extract_html: Whether to include full HTML in the result.
        timeout_ms: Page load timeout in milliseconds.
        event_callback: Optional callable(event_dict) for streaming progress.

    Returns:
        dict with 'success', 'title', 'url', 'text', 'html', 'text_length', 'error' keys.
    """

    def _emit(event_type: str, data: dict):
        if event_callback:
            try:
                event_callback({"type": event_type, **data})
            except Exception:
                pass

    if not url:
        return {"success": False, "error": "URL 不能为空"}

    # Ensure URL has scheme
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    _emit("log", {"content": "初始化 Crawlee PlaywrightCrawler"})
    _emit("log", {"content": f"目标: {url}"})
    if wait_selector:
        _emit("log", {"content": f"等待选择器: {wait_selector}"})

    collected_result = {}

    async def _run():
        crawler = PlaywrightCrawler(
            max_requests_per_crawl=1,
            headless=True,
            request_handler_timeout=timedelta(seconds=timeout_ms // 1000 + 10),
        )

        @crawler.router.default_handler
        async def request_handler(context: PlaywrightCrawlingContext) -> None:
            context.log.info(f"正在渲染: {context.request.url}")

            page = context.page

            user_agent = random.choice(USER_AGENTS)
            await page.set_extra_http_headers({"User-Agent": user_agent})

            _emit("progress", {"content": "页面加载中..."})

            # Wait for specific selector if provided
            if wait_selector:
                try:
                    _emit("progress", {"content": f"等待元素: {wait_selector}"})
                    await page.wait_for_selector(wait_selector, timeout=timeout_ms)
                    _emit("log", {"content": f"选择器匹配成功: {wait_selector}"})
                except Exception as e:
                    _emit("log", {"content": f"选择器等待超时: {wait_selector} ({e})"})

            # Scroll to trigger lazy loading
            if scroll:
                _emit("progress", {"content": "模拟滚动加载..."})
                for _i in range(3):
                    await page.evaluate("window.scrollBy(0, 800)")
                    await asyncio.sleep(random.uniform(0.5, 1.0))
                await page.evaluate("window.scrollTo(0, 0)")
                await asyncio.sleep(0.5)

            _emit("progress", {"content": "提取页面内容..."})

            # Extract title
            title = await page.title()

            # Extract text content
            text = await page.evaluate("""
                () => {
                    const clone = document.body.cloneNode(true);
                    clone.querySelectorAll('script, style, noscript, template').forEach(el => el.remove());
                    return clone.innerText || '';
                }
            """)

            # Extract HTML if requested
            html = ""
            if extract_html:
                html = await page.content()

            result_data = {
                "title": title or "",
                "url": context.request.url,
                "text": text or "",
                "html": html,
                "text_length": len(text or ""),
                "html_length": len(html),
            }

            collected_result.update(result_data)

            await context.push_data(result_data)

            _emit("progress", {
                "content": f"提取完成: 标题={title or '(无)'} | 文本={len(text or '')} 字符 | HTML={len(html)} 字符"
            })

        _emit("log", {"content": "开始渲染..."})
        await crawler.run([url])

    try:
        run_crawlee(_run())

        if not collected_result:
            _emit("error", {"content": "未能提取到页面内容"})
            return {"success": False, "error": "未能提取到页面内容"}

        _emit("log", {"content": "渲染完成"})

        return {
            "success": True,
            "title": collected_result.get("title", ""),
            "url": collected_result.get("url", url),
            "text": collected_result.get("text", ""),
            "html": collected_result.get("html", ""),
            "text_length": collected_result.get("text_length", 0),
            "html_length": collected_result.get("html_length", 0),
        }
    except Exception as e:
        _emit("error", {"content": f"渲染异常: {str(e)}"})
        return {
            "success": False,
            "error": str(e),
            "title": collected_result.get("title", ""),
            "url": url,
            "text": collected_result.get("text", ""),
            "html": collected_result.get("html", ""),
            "text_length": collected_result.get("text_length", 0),
            "html_length": collected_result.get("html_length", 0),
        }
