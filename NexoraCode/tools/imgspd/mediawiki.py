from __future__ import annotations

import re
from html import unescape

import requests

from .models import ImageSearchResponse, ImageSearchResult


class MediaWikiCommonsSearcher:
    """通过 Wikimedia Commons API 搜索文件，并返回可引用的图片元数据。"""

    ENGINE = "wikimedia_commons"
    API_URL = "https://commons.wikimedia.org/w/api.php"

    def __init__(self, proxy: str = "", timeout: int = 25):
        self.proxy = proxy
        self.timeout = timeout

    def search(self, query: str, limit: int = 20) -> ImageSearchResponse:
        normalized_query = str(query or "").strip()

        if not normalized_query:
            return ImageSearchResponse(self.ENGINE, normalized_query, "error", message="query 不能为空")

        params = {
            "action": "query",
            "format": "json",
            "formatversion": "2",
            "generator": "search",
            "gsrnamespace": "6",
            "gsrsearch": normalized_query,
            "gsrlimit": str(limit),
            "prop": "imageinfo|info",
            "inprop": "url",
            "iiprop": "url|size|mime|extmetadata",
            "iiurlwidth": "600",
        }
        response = requests.get(
            self.API_URL,
            params=params,
            headers=self._headers(),
            proxies=self._proxies(),
            timeout=self.timeout,
        )
        response.raise_for_status()
        payload = response.json()
        pages = payload.get("query", {}).get("pages", [])
        results = [self._build_result(page) for page in pages]
        results = [item for item in results if item.image_url or item.thumbnail_url]
        status = "ok" if results else "empty"

        return ImageSearchResponse(self.ENGINE, normalized_query, status, results=results[:limit])

    def _build_result(self, page: dict) -> ImageSearchResult:
        info_items = page.get("imageinfo") or []
        info = info_items[0] if info_items else {}
        extmetadata = info.get("extmetadata") or {}

        return ImageSearchResult(
            engine=self.ENGINE,
            title=str(page.get("title") or ""),
            image_url=str(info.get("url") or ""),
            thumbnail_url=str(info.get("thumburl") or ""),
            source_url=str(page.get("fullurl") or info.get("descriptionurl") or ""),
            page_url=str(info.get("descriptionurl") or page.get("fullurl") or ""),
            width=info.get("width"),
            height=info.get("height"),
            mime=str(info.get("mime") or ""),
            license=self._metadata_value(extmetadata, "LicenseShortName"),
            author=self._metadata_value(extmetadata, "Artist"),
            metadata={
                "credit": self._metadata_value(extmetadata, "Credit"),
                "description": self._metadata_value(extmetadata, "ImageDescription"),
                "usage_terms": self._metadata_value(extmetadata, "UsageTerms"),
            },
        )

    def _metadata_value(self, extmetadata: dict, key: str) -> str:
        value = extmetadata.get(key, {}).get("value", "")
        text = unescape(str(value or ""))
        text = re.sub(r"<[^>]+>", "", text)
        text = re.sub(r"\s+", " ", text)

        return text.strip()

    def _headers(self) -> dict[str, str]:
        return {
            "User-Agent": "NexoraCode-imgspd/0.1 local image search tool",
        }

    def _proxies(self) -> dict[str, str] | None:
        if not self.proxy:
            return None

        return {
            "http": self.proxy,
            "https": self.proxy,
        }
