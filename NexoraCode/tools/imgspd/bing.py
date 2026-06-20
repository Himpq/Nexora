from __future__ import annotations

import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote_plus

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from .anti_spider import AntiSpiderDetector
from .bing_common import extract_dimensions_from_detail_url, is_valid_bing_result, read_dimension
from .models import ImageSearchResponse, ImageSearchResult


@dataclass
class BingImageSearchConfig:
    """Bing 图片搜索配置，默认使用本机 Edge 持久化资料目录。"""

    proxy: str = ""
    headless: bool = False
    channel: str = "msedge"
    user_data_dir: str = ""
    timeout_ms: int = 30000
    scroll_times: int = 4
    scroll_wait_ms: int = 900
    locale: str = "zh-CN"
    pause_on_anti_spider: bool = True


class BingImageSearcher:
    """通过本地真实浏览器渲染 Bing 图片搜索并收集图片结果。"""

    ENGINE = "bing"
    BASE_URL = "https://cn.bing.com/images/search?q={query}"

    def __init__(self, config: BingImageSearchConfig | None = None):
        self.config = config or BingImageSearchConfig()
        self.detector = AntiSpiderDetector()

    def search(self, query: str, limit: int = 30) -> ImageSearchResponse:
        normalized_query = str(query or "").strip()

        if not normalized_query:
            return ImageSearchResponse(self.ENGINE, normalized_query, "error", message="query 不能为空")

        user_data_dir = self._resolve_user_data_dir()
        url = self.BASE_URL.format(query=quote_plus(normalized_query))

        with sync_playwright() as playwright:
            context = self._launch_context(playwright, user_data_dir)

            try:
                page = context.new_page()
                page.goto(url, wait_until="domcontentloaded", timeout=self.config.timeout_ms)
                page.wait_for_timeout(800)

                anti_spider = self.detector.detect_page(page)

                if anti_spider.detected:
                    handled = self._handle_anti_spider(page, anti_spider)

                    if not handled:
                        return ImageSearchResponse(
                            self.ENGINE,
                            normalized_query,
                            "need_human_verification",
                            anti_spider=anti_spider,
                            message="Bing 进入人机验证页面，请使用 headed 模式完成人工验证后继续。",
                        )

                results = self._collect_until_enough(page, limit)
                status = "ok" if results else "empty"
                message = "" if results else "没有抓到图片结果，请检查页面是否正常渲染。"

                return ImageSearchResponse(
                    self.ENGINE,
                    normalized_query,
                    status,
                    results=results,
                    anti_spider=anti_spider,
                    message=message,
                )
            finally:
                context.close()

    def _launch_context(self, playwright, user_data_dir: str):
        launch_options = {
            "headless": self.config.headless,
            "channel": self.config.channel,
            "locale": self.config.locale,
            "viewport": {
                "width": 1365,
                "height": 900,
            },
        }

        if self.config.proxy:
            launch_options["proxy"] = {"server": self.config.proxy}

        return playwright.chromium.launch_persistent_context(user_data_dir, **launch_options)

    def _collect_until_enough(self, page, limit: int) -> list[ImageSearchResult]:
        all_results: list[ImageSearchResult] = []
        seen = set()

        self._wait_for_image_area(page)

        for index in range(max(1, self.config.scroll_times + 1)):
            batch = self._collect_visible_results(page)

            for item in batch:
                key = item.image_url or item.thumbnail_url or item.page_url

                if not key or key in seen:
                    continue

                seen.add(key)
                all_results.append(item)

                if len(all_results) >= limit:
                    return all_results

            if index < self.config.scroll_times:
                page.evaluate("() => window.scrollBy(0, Math.max(900, window.innerHeight * 1.4))")
                page.wait_for_timeout(self.config.scroll_wait_ms)

        return all_results[:limit]

    def _collect_visible_results(self, page) -> list[ImageSearchResult]:
        raw_items = page.evaluate(
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

                const readImage = (root) => {
                    const img = root.querySelector('img.mimg') || root.querySelector('img');

                    if (!img) {
                        return {};
                    }

                    return {
                        alt: img.getAttribute('alt') || '',
                        src: img.currentSrc || img.src || '',
                        dataSrc: img.getAttribute('data-src') || img.getAttribute('data-original') || ''
                    };
                };

                const anchors = Array.from(document.querySelectorAll('a.iusc'));
                const items = [];

                for (const anchor of anchors) {
                    const meta = parseMeta(anchor.getAttribute('m'));
                    const img = readImage(anchor);

                    items.push({
                        title: meta.t || anchor.getAttribute('aria-label') || img.alt || '',
                        imageUrl: meta.murl || '',
                        thumbnailUrl: meta.turl || img.src || img.dataSrc || '',
                        sourceUrl: meta.purl || '',
                        pageUrl: anchor.href || '',
                        width: Number(meta.md || meta.w || 0) || null,
                        height: Number(meta.mh || meta.h || 0) || null
                    });
                }

                if (items.length > 0) {
                    return items;
                }

                return Array.from(document.querySelectorAll('img.mimg')).map((img) => ({
                    title: img.getAttribute('alt') || '',
                    imageUrl: '',
                    thumbnailUrl: img.currentSrc || img.src || img.getAttribute('data-src') || '',
                    sourceUrl: '',
                    pageUrl: '',
                    width: Number(img.naturalWidth || 0) || null,
                    height: Number(img.naturalHeight || 0) || null
                }));
            }
            """
        )
        results = []

        for raw in raw_items or []:
            image_url = str(raw.get("imageUrl") or "").strip()
            thumbnail_url = str(raw.get("thumbnailUrl") or "").strip()
            source_url = str(raw.get("sourceUrl") or "").strip()
            page_url = str(raw.get("pageUrl") or "").strip()

            if not is_valid_bing_result(image_url, source_url, page_url):
                continue

            width = read_dimension(raw.get("width"))
            height = read_dimension(raw.get("height"))
            parsed_width, parsed_height = extract_dimensions_from_detail_url(page_url)

            results.append(
                ImageSearchResult(
                    engine=self.ENGINE,
                    title=str(raw.get("title") or "").strip(),
                    image_url=image_url,
                    thumbnail_url=thumbnail_url,
                    source_url=source_url,
                    page_url=page_url,
                    width=width or parsed_width,
                    height=height or parsed_height,
                    metadata={"source": "bing_dom"},
                )
            )

        return results

    def _handle_anti_spider(self, page, anti_spider) -> bool:
        if self.config.headless or not self.config.pause_on_anti_spider:
            return False

        page.bring_to_front()
        print(f"Bing 需要人工验证: {anti_spider.reason}")
        print("请在弹出的浏览器中完成验证，完成后回到终端按 Enter 继续。")
        input()
        time.sleep(0.5)
        current_state = self.detector.detect_page(page)

        return not current_state.detected

    def _wait_for_image_area(self, page) -> None:
        try:
            page.wait_for_selector("a.iusc, img.mimg", timeout=min(8000, self.config.timeout_ms))
        except PlaywrightTimeoutError:
            return

    def _resolve_user_data_dir(self) -> str:
        if self.config.user_data_dir:
            path = Path(self.config.user_data_dir)
        else:
            path = Path(tempfile.gettempdir()) / "nexoracode_imgspd" / "bing_profile"

        path.mkdir(parents=True, exist_ok=True)

        return str(path)
