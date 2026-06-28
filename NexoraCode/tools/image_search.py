"""
工具：本地图片搜索
"""

from tools.imgspd import (
    BingImageSearchConfig,
    BingImageSearcher,
    CrawleeBingImageSearchConfig,
    CrawleeBingImageSearcher,
    MediaWikiCommonsSearcher,
)


def image_search(
    query: str,
    source: str = "bing_crawlee",
    limit: int = 10,
    proxy: str = "",
    headless: bool = True,
    channel: str = "msedge",
    user_data_dir: str = "",
    timeout: int = 45,
    scrolls: int = 4,
) -> dict:
    """
    统一图片搜索入口。
    source 明确决定数据源，不做跨源静默切换。
    """
    normalized_source = str(source or "bing_crawlee").strip().lower()
    normalized_limit = _normalize_limit(limit)
    response = None

    if normalized_source == "bing":
        response = _search_bing(query, normalized_limit, proxy, headless, channel, user_data_dir, timeout, scrolls)

    elif normalized_source == "bing_crawlee":
        response = _search_bing_crawlee(query, normalized_limit, proxy, headless, channel, user_data_dir, timeout, scrolls)

    elif normalized_source == "commons":
        response = _search_commons(query, normalized_limit, proxy, timeout)

    else:
        return {
            "status": "error",
            "message": f"未知图片搜索源: {source}",
            "available_sources": ["bing", "bing_crawlee", "commons"],
        }

    return _attach_markdown_prompt(response)


def _search_bing(
    query: str,
    limit: int,
    proxy: str,
    headless: bool,
    channel: str,
    user_data_dir: str,
    timeout: int,
    scrolls: int,
) -> dict:
    config = BingImageSearchConfig(
        proxy=proxy or "",
        headless=bool(headless),
        channel=channel or "msedge",
        user_data_dir=user_data_dir or "",
        timeout_ms=int(timeout) * 1000,
        scroll_times=int(scrolls),
        pause_on_anti_spider=not bool(headless),
    )

    return BingImageSearcher(config).search(query, limit=limit).to_dict()


def _search_bing_crawlee(
    query: str,
    limit: int,
    proxy: str,
    headless: bool,
    channel: str,
    user_data_dir: str,
    timeout: int,
    scrolls: int,
) -> dict:
    config = CrawleeBingImageSearchConfig(
        proxy=proxy or "",
        headless=bool(headless),
        channel=channel or "msedge",
        user_data_dir=user_data_dir or "",
        timeout_sec=int(timeout),
        scroll_times=int(scrolls),
    )

    return CrawleeBingImageSearcher(config).search(query, limit=limit).to_dict()


def _search_commons(query: str, limit: int, proxy: str, timeout: int) -> dict:
    return MediaWikiCommonsSearcher(proxy=proxy or "", timeout=int(timeout)).search(query, limit=limit).to_dict()


def _normalize_limit(limit: int) -> int:
    value = int(limit)

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
