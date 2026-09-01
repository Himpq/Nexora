"""
Nexora.app.Search.service — 联网搜索统一服务层

职责：
- 封装配置解析 + 工厂创建 + 统一调用
- 供 ToolExecutor / API 层直接使用，无需关心厂商细节

与 NexoraSearch (self-hosted) 的关系：
- NexoraSearch 是独立的自建渲染搜索服务（tool_executor._unified_search_web 已有）
- 本服务是直连第三方搜索 API 的轻量路径，两者可并存
"""

from __future__ import annotations

import json
from typing import Any, Dict, List

from .base import SearchHit, SearchResult
from .config import get_active_provider_name, is_web_search_enabled
from .factory import create_search_provider_from_main_config


def search_with_config(
    main_config: Dict[str, Any],
    query: str,
    num_results: int = 8,
    **kwargs: Any,
) -> SearchResult:
    """
    按主配置执行搜索

    Args:
        main_config: 主配置字典
        query: 检索词
        num_results: 条数
        **kwargs: 厂商透传参数

    Returns:
        SearchResult
    """
    active = get_active_provider_name(main_config)

    if not is_web_search_enabled(main_config):
        return SearchResult(
            ok=False,
            provider=str(active or "disabled"),
            query=str(query or "").strip(),
            error="web search disabled: 请在 web_search.active_provider 中启用 duckduckgo 或 exa",
        )

    provider = create_search_provider_from_main_config(main_config, active)

    return provider.search(query=query, num_results=num_results, **kwargs)


def search_to_tool_payload(result: SearchResult, limit: int = 8) -> str:
    """
    将 SearchResult 转为 ToolExecutor 友好的 JSON 字符串

    保持与旧 duckduckgo_search 返回兼容，同时提供更丰富的结构
    """
    limit = max(1, min(int(limit or 8), 20))

    if not result.ok:
        return json.dumps(
            {
                "success": False,
                "provider": result.provider,
                "error": result.error,
            },
            ensure_ascii=False,
        )

    items: List[Dict[str, Any]] = []

    for hit in result.hits[:limit]:
        items.append(
            {
                "title": hit.title,
                "url": hit.url,
                "snippet": hit.snippet,
                "highlights": hit.highlights,
                "published_date": hit.published_date,
                "score": hit.score,
                "image": hit.image,
                "favicon": hit.favicon,
                "author": hit.author,
            }
        )

    return json.dumps(
        {
            "success": True,
            "provider": result.provider,
            "query": result.query,
            "results": items,
        },
        ensure_ascii=False,
    )


def get_search_service_status(main_config: Dict[str, Any]) -> Dict[str, Any]:
    """获取搜索服务状态，供健康检查 / 设置页展示"""
    from .config import get_provider_config, list_configured_providers
    from .factory import list_available_providers

    active = get_active_provider_name(main_config)
    enabled = is_web_search_enabled(main_config)

    providers_status: Dict[str, Any] = {}

    for name in list_available_providers():
        cfg = get_provider_config(main_config, name)

        # 仅对已知厂商做轻量可用性判断
        if name in {"exa", "duckduckgo", "ddg"}:
            try:
                from .factory import create_search_provider

                provider = create_search_provider(name, cfg)
                providers_status[name] = provider.health_check()
            except Exception as exc:
                providers_status[name] = {
                    "ok": False,
                    "provider": name,
                    "error": str(exc),
                }

    return {
        "enabled": enabled,
        "active_provider": active,
        "configured_providers": list_configured_providers(main_config),
        "available_providers": list_available_providers(),
        "providers": providers_status,
    }
