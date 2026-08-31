"""
Nexora.app.Search.factory — 搜索提供方工厂

对齐 Model Provider 的 factory 思路，但保持独立演进
"""

from __future__ import annotations

from typing import Any, Dict

from .base import SearchProvider
from .config import get_provider_config
from .providers.duckduckgo import DuckDuckGoSearchProvider
from .providers.exa import ExaSearchProvider


# 厂商注册表
_PROVIDER_REGISTRY = {
    "duckduckgo": DuckDuckGoSearchProvider,
    "ddg": DuckDuckGoSearchProvider,
    "exa": ExaSearchProvider,
}


def create_search_provider(
    provider_name: str,
    provider_config: Dict[str, Any],
) -> SearchProvider:
    """
    按名称创建搜索提供方实例

    Args:
        provider_name: 提供方名称（exa / duckduckgo）
        provider_config: 该提供方的配置段

    Returns:
        SearchProvider 实例
    """
    key = str(provider_name or "").strip().lower()

    if not key or key in {"disabled", "none", "off"}:
        raise ValueError(f"search provider disabled: {provider_name}")

    provider_cls = _PROVIDER_REGISTRY.get(key)

    if provider_cls is None:
        raise ValueError(f"unknown search provider: {provider_name}，可选: {', '.join(sorted(_PROVIDER_REGISTRY.keys()))}")

    return provider_cls(provider_name=key, provider_config=provider_config)


def create_search_provider_from_main_config(
    main_config: Dict[str, Any],
    provider_name: str = "",
) -> SearchProvider:
    """
    从主配置创建提供方

    Args:
        main_config: 主 config.json 内容
        provider_name: 指定提供方，未指定时取 active_provider

    Returns:
        SearchProvider 实例
    """
    from .config import get_active_provider_name

    target = str(provider_name or "").strip().lower() or get_active_provider_name(main_config)
    cfg = get_provider_config(main_config, target)

    return create_search_provider(target, cfg)


def list_available_providers() -> list[str]:
    """列出可用提供方"""
    return sorted(set(_PROVIDER_REGISTRY.keys()))
