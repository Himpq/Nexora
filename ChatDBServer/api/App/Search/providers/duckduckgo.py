"""
Nexora.app.Search.providers.duckduckgo — DuckDuckGo 搜索适配器

封装原 duckduckgo_search.py 的能力，统一到 SearchProvider 接口
原函数保留兼容，内部逻辑收敛到此类
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict

from ..base import SearchHit, SearchProvider, SearchResult

logger = logging.getLogger(__name__)


class DuckDuckGoSearchProvider(SearchProvider):
    """DuckDuckGo 搜索实现（依赖 ddgs）"""

    @property
    def provider_type(self) -> str:
        return "duckduckgo"

    def search(
        self,
        query: str,
        num_results: int = 10,
        **kwargs: Any,
    ) -> SearchResult:
        query_text = str(query or "").strip()

        if not query_text:
            return SearchResult(
                ok=False,
                provider=self.provider_name,
                query=query_text,
                error="query is required",
            )

        # 参数归一：配置 < 显式 kwargs
        cfg = self.provider_config if isinstance(self.provider_config, dict) else {}

        backend = str(kwargs.get("backend") or cfg.get("backend") or "html").strip() or "html"
        fetch_content = bool(kwargs.get("fetch_content", cfg.get("fetch_content", False)))
        limit = int(kwargs.get("num_results", kwargs.get("limit", num_results)) or num_results)
        limit = max(1, min(limit, 20))

        try:
            from ddgs import DDGS
        except Exception as exc:
            return SearchResult(
                ok=False,
                provider=self.provider_name,
                query=query_text,
                error=f"ddgs not installed: {exc}",
            )

        try:
            results = []

            with DDGS() as ddgs:
                responses = ddgs.text(
                    query=query_text,
                    region=str(cfg.get("region") or "wt-wt"),
                    safesearch=str(cfg.get("safesearch") or "moderate"),
                    timelimit=str(cfg.get("timelimit") or "w"),
                    max_results=limit,
                    backend=backend,
                )

                for r in responses or []:
                    if not isinstance(r, dict):
                        continue

                    item = {
                        "title": str(r.get("title") or "").strip(),
                        "url": str(r.get("href") or "").strip(),
                        "snippet": str(r.get("body") or "").strip(),
                    }

                    if not item["url"]:
                        continue

                    results.append(item)

            if not results:
                return SearchResult(
                    ok=False,
                    provider=self.provider_name,
                    query=query_text,
                    error="No results found for query.",
                )

            # 可选：抓取正文
            if fetch_content:
                from ..duckduckgo_search import fetch_article

                for item in results:
                    try:
                        item["content"] = fetch_article(item["url"])
                    except Exception:
                        item["content"] = ""

            hits = []

            for item in results:
                hits.append(
                    SearchHit(
                        title=item.get("title", ""),
                        url=item.get("url", ""),
                        snippet=item.get("snippet", ""),
                        source="duckduckgo",
                        raw=item,
                    )
                )

            return SearchResult(
                ok=True,
                provider=self.provider_name,
                query=query_text,
                hits=hits,
                raw=results,
            )

        except Exception as exc:
            logger.error(f"DuckDuckGo search error: {exc}")

            return SearchResult(
                ok=False,
                provider=self.provider_name,
                query=query_text,
                error=str(exc),
            )

    def health_check(self) -> Dict[str, Any]:
        try:
            import ddgs  # noqa: F401

            return {
                "ok": True,
                "provider": self.provider_name,
                "provider_type": self.provider_type,
            }
        except Exception as exc:
            return {
                "ok": False,
                "provider": self.provider_name,
                "provider_type": self.provider_type,
                "error": str(exc),
            }
