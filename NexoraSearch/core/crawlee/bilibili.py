"""
Bilibili crawler powered by Crawlee PlaywrightCrawler.

Supports two modes:
- popular: crawl https://www.bilibili.com/v/popular/all/ for trending videos
- search: crawl https://search.bilibili.com/all?keyword=... for keyword search results
"""

import asyncio
import random
from datetime import timedelta
from urllib.parse import quote

from crawlee.crawlers import PlaywrightCrawler, PlaywrightCrawlingContext

from .loop import run_crawlee


USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
]


def crawl_bilibili(
    keyword: str = "",
    mode: str = "popular",
    max_results: int = 20,
    event_callback=None,
) -> dict:
    """Crawl Bilibili videos.

    Args:
        keyword: Search keyword (used when mode='search').
        mode: 'popular' for trending page, 'search' for keyword search.
        max_results: Maximum number of results to collect.
        event_callback: Optional callable(event_dict) for streaming progress.

    Returns:
        dict with 'success', 'items', 'count', 'error' keys.
    """

    def _emit(event_type: str, data: dict):
        if event_callback:
            try:
                event_callback({"type": event_type, **data})
            except Exception:
                pass

    if mode == "search":
        if not keyword:
            return {"success": False, "error": "搜索模式需要提供关键词", "items": [], "count": 0}
        url = f"https://search.bilibili.com/all?keyword={quote(keyword)}"
        _emit("log", {"content": f"搜索模式: keyword={keyword}"})
    else:
        url = "https://www.bilibili.com/v/popular/all/"
        _emit("log", {"content": "热门模式: 爬取热门视频列表"})

    _emit("log", {"content": f"初始化 Crawlee PlaywrightCrawler (max={max_results})"})

    collected_items = []

    async def _run():
        crawler = PlaywrightCrawler(
            max_requests_per_crawl=1,
            headless=True,
            request_handler_timeout=timedelta(seconds=60),
        )

        @crawler.router.default_handler
        async def request_handler(context: PlaywrightCrawlingContext) -> None:
            context.log.info(f"正在打开页面: {context.request.url}")

            page = context.page

            user_agent = random.choice(USER_AGENTS)
            await page.set_extra_http_headers({"User-Agent": user_agent})

            _emit("progress", {"content": "等待页面元素加载..."})

            try:
                await page.wait_for_selector(".bili-video-card", timeout=10000)
            except Exception:
                try:
                    await page.wait_for_selector(".video-card", timeout=10000)
                except Exception:
                    _emit("log", {"content": "未找到视频卡片元素，页面可能未完全加载"})

            await asyncio.sleep(random.uniform(1, 3))
            await page.evaluate("window.scrollBy(0, 1000)")
            await asyncio.sleep(random.uniform(1, 2))

            _emit("progress", {"content": "正在解析视频卡片..."})

            # Detect card style
            is_new_style = False
            video_cards = await page.locator(".bili-video-card").all()
            if video_cards:
                is_new_style = True
            else:
                video_cards = await page.locator(".video-card").all()

            is_search_page = "search.bilibili.com" in context.request.url
            card_count = len(video_cards)
            context.log.info(f"捕获到 {card_count} 个视频卡片")
            _emit("log", {"content": f"找到 {card_count} 个视频卡片 (样式: {'新' if is_new_style else '旧'})"})

            for i, card in enumerate(video_cards):
                if len(collected_items) >= max_results:
                    break
                try:
                    if is_new_style:
                        title_el = card.locator(".bili-video-card__info--tit")
                        title = await title_el.inner_text() if await title_el.count() > 0 else "未知标题"

                        link_el = card.locator(".bili-video-card__wrap a").first
                        video_url = await link_el.get_attribute("href") if await link_el.count() > 0 else ""

                        up_el = card.locator(".bili-video-card__info--author")
                        up_name = await up_el.inner_text() if await up_el.count() > 0 else "未知UP主"

                        stats_items = card.locator(".bili-video-card__stats--item")
                        play_count = "0"
                        danmaku_count = "0"
                        if await stats_items.count() >= 2:
                            play_count = await stats_items.nth(0).inner_text()
                            danmaku_count = await stats_items.nth(1).inner_text()
                        elif await stats_items.count() == 1:
                            play_count = await stats_items.nth(0).inner_text()

                        duration_el = card.locator(".bili-video-card__stats__duration")
                        duration = await duration_el.inner_text() if await duration_el.count() > 0 else ""
                    else:
                        title_el = card.locator(".video-name")
                        title = await title_el.inner_text() if await title_el.count() > 0 else "未知标题"

                        link_el = card.locator(".video-card__content a").first
                        video_url = await link_el.get_attribute("href") if await link_el.count() > 0 else ""

                        up_el = card.locator(".up-name__text")
                        up_name = await up_el.inner_text() if await up_el.count() > 0 else "未知UP主"

                        play_el = card.locator(".play-text")
                        play_count = await play_el.inner_text() if await play_el.count() > 0 else "0"
                        danmaku_count = "0"
                        duration = ""

                    if video_url and video_url.startswith("//"):
                        video_url = "https:" + video_url

                    video_data = {
                        "title": title.strip(),
                        "up_name": up_name.strip(),
                        "play_count": play_count.strip(),
                        "danmaku_count": danmaku_count.strip() if danmaku_count else "0",
                        "duration": duration.strip() if duration else "",
                        "url": video_url,
                        "source": "search" if is_search_page else "popular",
                    }

                    collected_items.append(video_data)
                    await context.push_data(video_data)

                    _emit("result", {
                        "index": len(collected_items),
                        "title": video_data["title"],
                        "up_name": video_data["up_name"],
                        "play_count": video_data["play_count"],
                        "danmaku_count": video_data["danmaku_count"],
                        "duration": video_data["duration"],
                        "url": video_data["url"],
                        "source": video_data["source"],
                    })

                except Exception as e:
                    context.log.error(f"提取卡片数据出错: {e}")
                    _emit("error", {"content": f"卡片 #{i+1} 提取失败: {str(e)}"})

        _emit("log", {"content": f"开始爬取: {url}"})
        await crawler.run([url])

    try:
        run_crawlee(_run())
        _emit("log", {"content": f"爬取完成，共 {len(collected_items)} 条结果"})
        return {
            "success": True,
            "items": collected_items,
            "count": len(collected_items),
        }
    except Exception as e:
        _emit("error", {"content": f"爬取异常: {str(e)}"})
        return {
            "success": False,
            "error": str(e),
            "items": collected_items,
            "count": len(collected_items),
        }
