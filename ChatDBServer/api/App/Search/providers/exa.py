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
from ..config import resolve_exa_api_key, resolve_exa_team_api_key

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

            # 图片与站点信息（Exa 顶层 image/favicon/author）
            image = str(item.get("image") or "").strip()
            favicon = str(item.get("favicon") or "").strip()
            author = str(item.get("author") or "").strip()

            # 仅保留 https 外链，避免内联风险
            if image and not image.startswith("https://"):
                if image.startswith("http://"):
                    # 允许 http 但后续 Presenter 仅渲染 https
                    pass
                else:
                    image = ""

            if favicon and not favicon.startswith(("https://", "http://")):
                favicon = ""

            hits.append(
                SearchHit(
                    title=title or url,
                    url=url,
                    snippet=snippet[:500],
                    highlights=highlights_clean,
                    published_date=str(item.get("publishedDate") or "").strip(),
                    score=item.get("score") if isinstance(item.get("score"), (int, float)) else None,
                    source="exa",
                    image=image,
                    favicon=favicon,
                    author=author,
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

    def get_billing(self) -> Dict[str, Any]:
        """
        查询 Exa 账单/用量

        正确端点（Team Management）：
            GET {base_url}/api-keys              — 列出当前 team 的所有 API Key，拿到 id
            GET {base_url}/api-keys/{id}/usage   — 检索指定 Key 的用量与账单

        认证：x-api-key
        返回：{ total_cost_usd, period, cost_breakdown, api_key_name, ... }
        兼容：旧文档的 /reference/billing 尝试保留作为 fallback（已 404）
        """

        cfg = self.provider_config if isinstance(self.provider_config, dict) else {}
        # 搜索与用量权限分离：用量优先使用 team_api_key
        team_api_key = resolve_exa_team_api_key(cfg)
        api_key = resolve_exa_api_key(cfg)
        billing_key = team_api_key or api_key

        if not billing_key:
            return {
                "ok": False,
                "provider": self.provider_name,
                "error": "missing EXA_API_KEY: 请在 web_search.providers.exa.api_key 或环境变量 EXA_API_KEY 中配置",
            }

        # 若未配置 team key，给出明确提示（搜索 Key 会 404）
        team_key_missing = not str(cfg.get("team_api_key") or "").strip() and not str(cfg.get("teamApiKey") or "").strip()

        base_url = str(cfg.get("base_url") or "https://api.exa.ai").strip().rstrip("/")
        timeout = float(cfg.get("timeout", 20) or 20)
        timeout = max(5.0, min(timeout, 60.0))

        headers = {
            "x-api-key": billing_key,
            "Accept": "application/json",
        }

        # 允许通过配置显式指定 api_key_id，避免每次都 list
        explicit_id = str(cfg.get("team_api_key_id") or cfg.get("teamApiKeyId") or cfg.get("api_key_id") or cfg.get("apiKeyId") or "").strip()

        api_key_id = explicit_id or ""

        # 1) 若未显式指定，先尝试列出 Keys 获取 id
        if not api_key_id:
            list_endpoint = f"{base_url}/api-keys"

            try:
                resp = requests.get(
                    list_endpoint,
                    headers=headers,
                    timeout=timeout,
                )
            except Exception as exc:
                logger.error(f"Exa list api-keys failed: {exc}")
                return {
                    "ok": False,
                    "provider": self.provider_name,
                    "error": f"request failed (list keys): {exc}",
                    "endpoint": list_endpoint,
                }

            if resp.status_code != 200:
                detail = ""

                try:
                    detail = resp.text[:800]
                except Exception:
                    detail = ""

                if resp.status_code == 404 and "NOT_FOUND" in detail:
                    hint = ""
                    if team_key_missing:
                        hint = "未配置 Team API Key，已回落使用搜索 Key，因此无 Team 权限。请在下方“Team API Key”填入 Dashboard → Team Settings → API Keys 中的 Team Key（与搜索 Key 分开）。"

                    # 搜索 Key 无 Team Management 权限是已知情况，给出可操作提示
                    return {
                        "ok": False,
                        "provider": self.provider_name,
                        "error": (
                            "Exa 搜索 Key 不支持 Team Management 用量接口（api.exa.ai 返回 NOT_FOUND）。"
                            f"{hint} "
                            "请前往 https://dashboard.exa.ai 查看完整账单；"
                            "单次搜索约 $0.007-0.015（openapi x-payment-info）。"
                            f" 详情: http_404: {detail}"
                        ),
                        "status_code": resp.status_code,
                        "endpoint": list_endpoint,
                        "raw": detail,
                    }

                return {
                    "ok": False,
                    "provider": self.provider_name,
                    "error": f"http_{resp.status_code}: {detail}",
                    "status_code": resp.status_code,
                    "endpoint": list_endpoint,
                    "raw": detail,
                }

            try:
                list_data = resp.json()
            except Exception as exc:
                return {
                    "ok": False,
                    "provider": self.provider_name,
                    "error": f"invalid json response (list keys): {exc}",
                    "raw": resp.text[:2000],
                    "endpoint": list_endpoint,
                }

            # 兼容多种返回形状
            candidates: List[Dict[str, Any]] = []

            if isinstance(list_data, list):
                candidates = [x for x in list_data if isinstance(x, dict)]
            elif isinstance(list_data, dict):
                for k in ("apiKeys", "api_keys", "keys", "data", "items", "results"):
                    v = list_data.get(k)
                    if isinstance(v, list):
                        candidates = [x for x in v if isinstance(x, dict)]
                        break
                # 单对象也可能是直接的 key 详情
                if not candidates and isinstance(list_data.get("id"), str):
                    candidates = [list_data]

            if not candidates:
                return {
                    "ok": False,
                    "provider": self.provider_name,
                    "error": "invalid response: no api keys found",
                    "raw": list_data,
                    "endpoint": list_endpoint,
                }

            # 尝试按 key 精确匹配，否则取第一个
            matched = None

            # 优先通过后缀/前缀匹配（避免明文泄露时仅返回 masked）
            api_key_suffix = api_key[-6:] if len(api_key) >= 6 else api_key

            for item in candidates:
                # 常见字段：id, key, api_key, masked_key, name
                raw_key = str(item.get("key") or item.get("api_key") or item.get("apiKey") or "").strip()
                masked = str(item.get("masked_key") or item.get("maskedKey") or item.get("key_preview") or "").strip()

                if raw_key and raw_key == api_key:
                    matched = item
                    break

                if api_key_suffix and masked and api_key_suffix in masked:
                    matched = item
                    break

            if matched is None:
                # 多 key 场景下，若无法精确匹配，优先取 created 最近或第一个
                matched = candidates[0]

            api_key_id = str(matched.get("id") or matched.get("api_key_id") or matched.get("apiKeyId") or "").strip()

            if not api_key_id:
                return {
                    "ok": False,
                    "provider": self.provider_name,
                    "error": "invalid response: api key id not found",
                    "raw": matched,
                    "endpoint": list_endpoint,
                }

        # 2) 查询用量
        usage_endpoint = f"{base_url}/api-keys/{api_key_id}/usage"

        # 默认查询近 30 天，服务端默认值也是 30 天，此处显式透传便于前端展示 period
        # 可选 query：start_date, end_date, group_by

        try:
            resp = requests.get(
                usage_endpoint,
                headers=headers,
                timeout=timeout,
            )
        except Exception as exc:
            logger.error(f"Exa usage request failed ({usage_endpoint}): {exc}")
            return {
                "ok": False,
                "provider": self.provider_name,
                "error": f"request failed: {exc}",
                "endpoint": usage_endpoint,
            }

        if resp.status_code != 200:
            detail = ""

            try:
                detail = resp.text[:800]
            except Exception:
                detail = ""

            if resp.status_code == 404 and "NOT_FOUND" in detail:
                hint = ""
                if team_key_missing:
                    hint = "未配置 Team API Key，已回落使用搜索 Key。"

                return {
                    "ok": False,
                    "provider": self.provider_name,
                    "error": (
                        "Exa 用量接口返回 NOT_FOUND（api.exa.ai /api-keys/{id}/usage 不可用）。"
                        f"{hint} 该 Key 可能无 Team Management 权限，请前往 https://dashboard.exa.ai 查看账单；"
                        "单次搜索约 $0.007-0.015。"
                        f" 详情: http_404: {detail}"
                    ),
                    "status_code": resp.status_code,
                    "endpoint": usage_endpoint,
                    "raw": detail,
                }

            return {
                "ok": False,
                "provider": self.provider_name,
                "error": f"http_{resp.status_code}: {detail}",
                "status_code": resp.status_code,
                "endpoint": usage_endpoint,
                "raw": detail,
            }

        try:
            data = resp.json()
        except Exception as exc:
            return {
                "ok": False,
                "provider": self.provider_name,
                "error": f"invalid json response: {exc}",
                "raw": resp.text[:2000],
                "endpoint": usage_endpoint,
            }

        if not isinstance(data, dict):
            return {
                "ok": False,
                "provider": self.provider_name,
                "error": "invalid response: expected json object",
                "raw": data,
                "endpoint": usage_endpoint,
            }

        # 标准字段
        total_cost = data.get("total_cost_usd")
        # 兼容 total_cost / amount
        if total_cost is None:
            total_cost = data.get("totalCostUsd") or data.get("total_cost") or data.get("cost")

        try:
            total_cost_num = float(total_cost) if total_cost is not None else 0.0
        except Exception:
            total_cost_num = 0.0

        period = data.get("period") if isinstance(data.get("period"), dict) else {}
        cost_breakdown = data.get("cost_breakdown") if isinstance(data.get("cost_breakdown"), list) else data.get("costBreakdown") if isinstance(data.get("costBreakdown"), list) else []

        # 为了兼容旧前端的 balance 字段，同步返回 balance = total_cost
        return {
            "ok": True,
            "provider": self.provider_name,
            "api_key_id": api_key_id,
            "api_key_name": str(data.get("api_key_name") or data.get("apiKeyName") or "").strip(),
            "team_id": str(data.get("team_id") or data.get("teamId") or "").strip(),
            "period": period,
            "total_cost_usd": total_cost_num,
            "balance": total_cost_num,
            "currency": "USD",
            "cost_breakdown": cost_breakdown,
            "raw": data,
            "endpoint": usage_endpoint,
        }

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
