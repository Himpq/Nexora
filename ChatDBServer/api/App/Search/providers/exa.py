"""
Nexora.app.Search.providers.exa — Exa AI 搜索适配器

Canonical reference:
    https://docs.exa.ai/reference/search-api-guide-for-coding-agents

核心特性：
- type: auto / fast / instant / deep-lite / deep / deep-reasoning
- contents: {highlights:true} 为默认，支持 text/summary 互斥选择
- 支持 includeDomains / excludeDomains / outputSchema / systemPrompt 等透传
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

import requests

from ..base import SearchHit, SearchProvider, SearchResult
from ..config import resolve_exa_api_key

logger = logging.getLogger(__name__)

# Exa 官方支持的 search type
ALLOWED_SEARCH_TYPES = {
    "auto",
    "fast",
    "instant",
    "deep-lite",
    "deep",
    "deep-reasoning",
}


class ExaSearchProvider(SearchProvider):
    """Exa AI 搜索实现"""

    @property
    def provider_type(self) -> str:
        return "exa"

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

        cfg = self.provider_config if isinstance(self.provider_config, dict) else {}

        # 鉴权
        api_key = resolve_exa_api_key(cfg)

        if not api_key:
            return SearchResult(
                ok=False,
                provider=self.provider_name,
                query=query_text,
                error="missing EXA_API_KEY: 请在 web_search.providers.exa.api_key 或环境变量 EXA_API_KEY 中配置",
            )

        # 基础参数
        base_url = str(cfg.get("base_url") or "https://api.exa.ai").strip().rstrip("/")
        endpoint = f"{base_url}/search"

        search_type = str(kwargs.get("type") or kwargs.get("search_type") or cfg.get("type") or "auto").strip().lower()

        if search_type not in ALLOWED_SEARCH_TYPES:
            search_type = "auto"

        limit = int(kwargs.get("num_results", kwargs.get("numResults", kwargs.get("limit", num_results))) or num_results)
        limit = max(1, min(limit, 20))

        # contents：配置与显式参数合并，显式优先
        contents = self._build_contents(cfg, kwargs)

        # 组装请求体
        payload: Dict[str, Any] = {
            "query": query_text,
            "type": search_type,
            "numResults": limit,
        }

        if contents:
            payload["contents"] = contents

        # 可选透传参数（仅当显式提供时携带，避免污染请求）
        for key in ("includeDomains", "excludeDomains", "category", "systemPrompt", "outputSchema", "additionalQueries"):
            if key in kwargs and kwargs[key] is not None:
                payload[key] = kwargs[key]
            elif key in cfg and cfg[key] is not None:
                # 兼容 snake_case 配置
                pass

        # snake_case -> camelCase 兼容
        if "include_domains" in kwargs and "includeDomains" not in payload:
            payload["includeDomains"] = kwargs["include_domains"]

        if "exclude_domains" in kwargs and "excludeDomains" not in payload:
            payload["excludeDomains"] = kwargs["exclude_domains"]

        if "system_prompt" in kwargs and "systemPrompt" not in payload:
            payload["systemPrompt"] = kwargs["system_prompt"]

        if "output_schema" in kwargs and "outputSchema" not in payload:
            payload["outputSchema"] = kwargs["output_schema"]

        timeout = float(kwargs.get("timeout", cfg.get("timeout", 20)) or 20)
        timeout = max(5.0, min(timeout, 60.0))

        headers = {
            "x-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        try:
            resp = requests.post(
                endpoint,
                headers=headers,
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                timeout=timeout,
            )

        except Exception as exc:
            logger.error(f"Exa search request failed: {exc}")

            return SearchResult(
                ok=False,
                provider=self.provider_name,
                query=query_text,
                error=f"request failed: {exc}",
            )

        if resp.status_code != 200:
            detail = ""

            try:
                detail = resp.text[:800]
            except Exception:
                detail = ""

            return SearchResult(
                ok=False,
                provider=self.provider_name,
                query=query_text,
                error=f"http_{resp.status_code}: {detail}",
                raw={"status_code": resp.status_code, "body": detail},
            )

        try:
            data = resp.json()
        except Exception as exc:
            return SearchResult(
                ok=False,
                provider=self.provider_name,
                query=query_text,
                error=f"invalid json response: {exc}",
                raw=resp.text[:2000],
            )

        results = data.get("results") if isinstance(data, dict) else None

        if not isinstance(results, list):
            return SearchResult(
                ok=False,
                provider=self.provider_name,
                query=query_text,
                error="invalid response: missing results array",
                raw=data,
            )

        hits: List[SearchHit] = []

        for item in results:
            if not isinstance(item, dict):
                continue

            title = str(item.get("title") or "").strip()
            url = str(item.get("url") or "").strip()
            snippet = str(item.get("text") or item.get("snippet") or "").strip()

            # highlights 优先
            highlights = item.get("highlights") if isinstance(item.get("highlights"), list) else []
            highlights_clean = [str(h).strip() for h in highlights if str(h).strip()]

            # snippet 回退：用 highlights 拼接
            if not snippet and highlights_clean:
                snippet = " ".join(highlights_clean)[:400]

            if not url:
                continue

            hits.append(
                SearchHit(
                    title=title or url,
                    url=url,
                    snippet=snippet[:500],
                    highlights=highlights_clean,
                    published_date=str(item.get("publishedDate") or "").strip(),
                    score=item.get("score") if isinstance(item.get("score"), (int, float)) else None,
                    source="exa",
                    raw=item,
                )
            )

        # output 透传（structured output 场景）
        output = data.get("output") if isinstance(data, dict) else None

        return SearchResult(
            ok=True,
            provider=self.provider_name,
            query=query_text,
            hits=hits,
            raw={
                "results": results,
                "output": output,
                "raw_response": data,
            },
        )

    def _build_contents(
        self,
        cfg: Dict[str, Any],
        kwargs: Dict[str, Any],
    ) -> Dict[str, Any]:
        """合并 contents 配置：显式 kwargs 优先，其次 provider 配置"""

        # 显式 contents 优先
        if "contents" in kwargs and isinstance(kwargs["contents"], dict):
            return json.loads(json.dumps(kwargs["contents"]))

        cfg_contents = cfg.get("contents") if isinstance(cfg.get("contents"), dict) else None

        if isinstance(cfg_contents, dict) and cfg_contents:
            return json.loads(json.dumps(cfg_contents))

        # 默认：highlights
        return {"highlights": True}

    def health_check(self) -> Dict[str, Any]:
        cfg = self.provider_config if isinstance(self.provider_config, dict) else {}
        api_key = resolve_exa_api_key(cfg)

        if not api_key:
            return {
                "ok": False,
                "provider": self.provider_name,
                "provider_type": self.provider_type,
                "error": "missing EXA_API_KEY",
            }

        return {
            "ok": True,
            "provider": self.provider_name,
            "provider_type": self.provider_type,
        }
