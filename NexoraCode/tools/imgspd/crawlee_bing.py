from __future__ import annotations

import asyncio
import logging
import tempfile
import threading
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from urllib.parse import quote_plus

from crawlee.crawlers import PlaywrightCrawler, PlaywrightCrawlingContext

from .bing_common import extract_dimensions_from_detail_url, is_valid_bing_result
from .models import AntiSpiderState, ImageSearchResponse, ImageSearchResult


# Crawlee 的全局单例（事件管理器/服务定位器）会把内部 asyncio.Lock 绑定到首次使用的
# 事件循环。若每次调用都用 asyncio.run() 新建并随即关闭事件循环，第二次调用复用这些全局
# 锁时就会抛出 "Lock ... is bound to a different event loop"。这里改用一个常驻、永不关闭、
# 由独立守护线程承载的事件循环，让所有 Crawlee 协程始终跑在同一个循环上。
_SHARED_LOOP: asyncio.AbstractEventLoop | None = None
_SHARED_LOOP_LOCK = threading.Lock()
# 默认所有搜索共用同一个 user_data_dir，禁止并发启动同一 Chromium 配置目录，因此串行化执行。
_RUN_LOCK = threading.Lock()


def _get_shared_loop() -> asyncio.AbstractEventLoop:
    global _SHARED_LOOP

    if _SHARED_LOOP is not None and not _SHARED_LOOP.is_closed():
        return _SHARED_LOOP

    with _SHARED_LOOP_LOCK:
        if _SHARED_LOOP is not None and not _SHARED_LOOP.is_closed():
            return _SHARED_LOOP

        loop = asyncio.new_event_loop()
        threading.Thread(
            target=loop.run_forever,
            name="imgspd-crawlee-loop",
            daemon=True,
        ).start()
        _SHARED_LOOP = loop
        return _SHARED_LOOP


def _run_on_shared_loop(coro):
    """在常驻事件循环上同步执行协程并返回结果（异常会原样向上抛出）。"""
    loop = _get_shared_loop()

    with _RUN_LOCK:
        return asyncio.run_coroutine_threadsafe(coro, loop).result()


@dataclass
class CrawleeBingImageSearchConfig:
    """Python Crawlee 版 Bing 图片搜索配置。"""

    proxy: str = ""
    headless: bool = False
    channel: str = "msedge"
    user_data_dir: str = ""
    timeout_sec: int = 45
    scroll_times: int = 4


class CrawleeBingImageSearcher:
    """使用 Python Crawlee 管理 Playwright 生命周期并抓取 Bing 图片结果。"""

    ENGINE = "bing_crawlee"
    BASE_URL = "https://cn.bing.com/images/search?q={query}"

    def __init__(self, config: CrawleeBingImageSearchConfig | None = None):
        self.config = config or CrawleeBingImageSearchConfig()

    def search(self, query: str, limit: int = 30) -> ImageSearchResponse:
        return _run_on_shared_loop(self.search_async(query, limit=limit))

    async def search_async(self, query: str, limit: int = 30) -> ImageSearchResponse:
        normalized_query = str(query or "").strip()

        if not normalized_query:
            return ImageSearchResponse(self.ENGINE, normalized_query, "error", message="query 不能为空")

        collected: list[ImageSearchResult] = []
        anti_spider = AntiSpiderState()
        target_url = self.BASE_URL.format(query=quote_plus(normalized_query))
        crawler = self._create_crawler()

        @crawler.router.default_handler
        async def request_handler(context: PlaywrightCrawlingContext) -> None:
            nonlocal anti_spider

            page = context.page
            await page.goto(target_url, wait_until="domcontentloaded", timeout=self.config.timeout_sec * 1000)
            await page.wait_for_timeout(800)
            anti_spider = await self._detect_anti_spider(page)

            if anti_spider.detected:
                return

            results = await self._collect_until_enough(page, limit)
            collected.extend(results)

        await crawler.run([target_url])

        if anti_spider.detected:
            return ImageSearchResponse(
                self.ENGINE,
                normalized_query,
                "need_human_verification",
                anti_spider=anti_spider,
                message="Bing 进入人机验证页面。",
            )

        status = "ok" if collected else "empty"
        message = "" if collected else "没有抓到图片结果，请检查页面是否正常渲染。"

        return ImageSearchResponse(
            self.ENGINE,
            normalized_query,
            status,
            results=collected,
            anti_spider=anti_spider,
            message=message,
        )

    def _create_crawler(self) -> PlaywrightCrawler:
        logging.getLogger("crawlee").setLevel(logging.ERROR)
        launch_options = {
            "channel": self.config.channel,
        }

        if self.config.proxy:
            launch_options["proxy"] = {
                "server": self.config.proxy,
            }

        return PlaywrightCrawler(
            headless=self.config.headless,
            user_data_dir=self._resolve_user_data_dir(),
            browser_launch_options=launch_options,
            max_requests_per_crawl=1,
            request_handler_timeout=timedelta(seconds=self.config.timeout_sec),
            configure_logging=False,
        )

    async def _collect_until_enough(self, page, limit: int) -> list[ImageSearchResult]:
        all_results: list[ImageSearchResult] = []
        seen = set()

        try:
            await page.wait_for_selector("a.iusc, img.mimg", timeout=8000)
        except Exception:
            pass

        for index in range(max(1, self.config.scroll_times + 1)):
            batch = await self._collect_visible_results(page)

            for item in batch:
                key = item.image_url

                if not key or key in seen:
                    continue

                seen.add(key)
                all_results.append(item)

                if len(all_results) >= limit:
                    return all_results

            if index < self.config.scroll_times:
                await page.evaluate("() => window.scrollBy(0, Math.max(900, window.innerHeight * 1.4))")
                await page.wait_for_timeout(900)

        return all_results[:limit]

    async def _collect_visible_results(self, page) -> list[ImageSearchResult]:
        raw_items = await page.evaluate(
            """
            () => {
                const parseMeta = (raw) => {
                    if (!raw) {
                        return {};
                    }

                    try {
                        return JSON.parse(raw);
                    } catch (error) {
                        return {};
                    }
                };

                return Array.from(document.querySelectorAll('a.iusc')).map((anchor) => {
                    const meta = parseMeta(anchor.getAttribute('m'));
                    const img = anchor.querySelector('img.mimg') || anchor.querySelector('img');

                    return {
                        title: meta.t || anchor.getAttribute('aria-label') || img?.getAttribute('alt') || '',
                        imageUrl: meta.murl || '',
                        thumbnailUrl: meta.turl || img?.currentSrc || img?.src || '',
                        sourceUrl: meta.purl || '',
                        pageUrl: anchor.href || ''
                    };
                });
            }
            """
        )
        results = []

        for raw in raw_items or []:
            image_url = str(raw.get("imageUrl") or "").strip()
            source_url = str(raw.get("sourceUrl") or "").strip()
            page_url = str(raw.get("pageUrl") or "").strip()

            if not is_valid_bing_result(image_url, source_url, page_url):
                continue

            width, height = extract_dimensions_from_detail_url(page_url)
            results.append(
                ImageSearchResult(
                    engine=self.ENGINE,
                    title=str(raw.get("title") or "").strip(),
                    image_url=image_url,
                    thumbnail_url=str(raw.get("thumbnailUrl") or "").strip(),
                    source_url=source_url,
                    page_url=page_url,
                    width=width,
                    height=height,
                    metadata={"source": "bing_crawlee_dom"},
                )
            )

        return results

    async def _detect_anti_spider(self, page) -> AntiSpiderState:
        current_url = page.url
        title = await page.title()
        lower_url = current_url.lower()

        for marker in ("captcha", "challenge", "verify", "checkpoint"):

            if marker in lower_url:
                return AntiSpiderState(True, f"url_marker:{marker}", current_url, title)

        visible_text = await page.evaluate("() => document.body?.innerText?.slice(0, 12000) || ''")
        lower_text = str(visible_text or "").lower()

        for marker in ("verify you are human", "unusual traffic", "captcha", "人机验证", "安全验证", "异常流量"):

            if marker.lower() in lower_text:
                return AntiSpiderState(True, f"text_marker:{marker}", current_url, title)

        return AntiSpiderState(False, "", current_url, title)

    def _resolve_user_data_dir(self) -> str:
        if self.config.user_data_dir:
            path = Path(self.config.user_data_dir)
        else:
            path = Path(tempfile.gettempdir()) / "nexoracode_imgspd" / "bing_crawlee_profile"

        path.mkdir(parents=True, exist_ok=True)

        return str(path)
