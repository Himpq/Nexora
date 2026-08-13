"""
NexoraCode.local.tools.ImageSearchTool — 本地图片搜索工具

image_search：在用户本地计算机上按来源搜索图片并返回结构化结果。
source 可选 bing_crawlee / bing / commons，明确决定数据源，不做跨源静默切换。
"""

from __future__ import annotations

from ..Tool import LocalTool, ToolContext
from tools.imgspd import (
    BingImageSearchConfig,
    BingImageSearcher,
    CrawleeBingImageSearchConfig,
    CrawleeBingImageSearcher,
    MediaWikiCommonsSearcher,
)


class ImageSearchTool(LocalTool):
    name = "image_search"
    description = (
        "在用户本地计算机上搜索图片并返回结构化图片结果。"
        "source 可选 bing_crawlee、bing、commons；bing_crawlee 使用 Python Crawlee + Playwright，"
        "bing 使用直接 Playwright，commons 使用 Wikimedia Commons API。"
        "返回结果会包含 markdown_prompt，模型可直接用其中的描述和图片链接按 Markdown 展示图片。"
    )
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "图片搜索关键词"},
            "source": {
                "type": "string",
                "enum": ["bing_crawlee", "bing", "commons"],
                "default": "bing_crawlee",
                "description": "图片搜索来源。不会在失败时自动切换来源。",
            },
            "limit": {"type": "integer", "description": "最多返回图片数量，范围 1-50，默认 10", "default": 10},
            "proxy": {"type": "string", "description": "可选代理，例如 http://127.0.0.1:15555"},
            "headless": {"type": "boolean", "description": "Bing 浏览器搜索是否使用无界面模式，默认 true", "default": True},
            "channel": {"type": "string", "description": "Chromium 通道，默认 msedge", "default": "msedge"},
            "user_data_dir": {"type": "string", "description": "可选浏览器持久化用户目录"},
            "timeout": {"type": "integer", "description": "超时秒数，默认 45", "default": 45},
            "scrolls": {"type": "integer", "description": "Bing 搜索滚动加载次数，默认 4", "default": 4},
        },
        "required": ["query"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        query = str(args.get("query") or "").strip()

        if not query:
            return {"success": False, "error": "query is required."}

        source = str(args.get("source") or "bing_crawlee").strip().lower()
        limit = _normalize_limit(args.get("limit"))
        proxy = str(args.get("proxy") or "").strip()
        headless = bool(args.get("headless", True))
        channel = str(args.get("channel") or "msedge").strip()
        user_data_dir = str(args.get("user_data_dir") or "").strip()
        timeout = args.get("timeout")
        scrolls = args.get("scrolls")

        try:
            timeout_int = int(timeout if timeout is not None else 45)
        except (TypeError, ValueError):
            timeout_int = 45

        try:
            scrolls_int = int(scrolls if scrolls is not None else 4)
        except (TypeError, ValueError):
            scrolls_int = 4

        if source == "bing":
            response = _search_bing(query, limit, proxy, headless, channel, user_data_dir, timeout_int, scrolls_int)
        elif source == "bing_crawlee":
            response = _search_bing_crawlee(query, limit, proxy, headless, channel, user_data_dir, timeout_int, scrolls_int)
        elif source == "commons":
            response = _search_commons(query, limit, proxy, timeout_int)
        else:
            return {
                "success": False,
                "error": f"未知图片搜索源: {source}",
                "available_sources": ["bing", "bing_crawlee", "commons"],
            }

        return _attach_markdown_prompt(response)


def _search_bing(query, limit, proxy, headless, channel, user_data_dir, timeout, scrolls) -> dict:
    search_config = BingImageSearchConfig(
        proxy=proxy or "",
        headless=headless,
        channel=channel or "msedge",
        user_data_dir=user_data_dir or "",
        timeout_ms=int(timeout) * 1000,
        scroll_times=int(scrolls),
        pause_on_anti_spider=not headless,
    )

    return BingImageSearcher(search_config).search(query, limit=limit).to_dict()


def _search_bing_crawlee(query, limit, proxy, headless, channel, user_data_dir, timeout, scrolls) -> dict:
    search_config = CrawleeBingImageSearchConfig(
        proxy=proxy or "",
        headless=headless,
        channel=channel or "msedge",
        user_data_dir=user_data_dir or "",
        timeout_sec=int(timeout),
        scroll_times=int(scrolls),
    )

    return CrawleeBingImageSearcher(search_config).search(query, limit=limit).to_dict()


def _search_commons(query, limit, proxy, timeout) -> dict:
    return MediaWikiCommonsSearcher(proxy=proxy or "", timeout=int(timeout)).search(query, limit=limit).to_dict()


def _normalize_limit(limit) -> int:
    try:
        value = int(limit)
    except (TypeError, ValueError):
        value = 10

    if value < 1:
        return 1

    if value > 50:
        return 50

    return value


def _attach_markdown_prompt(response: dict) -> dict:
    response["markdown_prompt"] = _build_markdown_prompt(response)
    return response


def _build_markdown_prompt(response: dict) -> str:
    results = response.get("results") or []

    if not results:
        return "没有可展示的图片结果。"

    lines = [
        "请用 Markdown 展示以下图片搜索结果。",
        "每张图片需要显示描述、图片和来源链接。",
        "",
    ]

    for index, item in enumerate(results, 1):
        title = _markdown_text(_result_description(item, index))
        image_url = str(item.get("image_url") or item.get("thumbnail_url") or "").strip()
        source_url = str(item.get("source_url") or item.get("page_url") or "").strip()
        license_text = str(item.get("license") or "").strip()
        author = str(item.get("author") or "").strip()

        if not image_url:
            continue

        lines.append(f"{index}. {title}")
        lines.append(f"![{title}]({image_url})")

        if source_url:
            lines.append(f"来源：[{_markdown_text(source_url)}]({source_url})")

        if author or license_text:
            lines.append(f"署名/许可证：{_markdown_text(_join_present([author, license_text]))}")

        lines.append("")

    return "\n".join(lines).strip()


def _result_description(item: dict, index: int) -> str:
    metadata = item.get("metadata") or {}
    description = str(metadata.get("description") or "").strip()

    if description:
        return description

    return str(item.get("title") or f"图片 {index}")


def _join_present(values: list[str]) -> str:
    return " / ".join([value for value in values if value])


def _markdown_text(value: str) -> str:
    return value.replace("[", "\\[").replace("]", "\\]")
