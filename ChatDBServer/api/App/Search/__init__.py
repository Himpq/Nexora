"""
Nexora.app.Search — 联网搜索模块

目录结构（避免堆屎山）：
- base.py          抽象接口 + 统一数据结构
- config.py        独立配置（web_search），后续对接 设置-搜索设置
- factory.py       提供方工厂
- service.py       统一服务层（供 ToolExecutor 调用）
- providers/       各厂商适配器
  - duckduckgo.py  DuckDuckGo 实现
  - exa.py         Exa AI 实现
- duckduckgo_search.py  旧函数兼容（委托至 Provider）
- universal_webview_render.py  通用网页渲染

使用方式：
    from App.Search.service import search_with_config

    result = search_with_config(config, "Next.js auth", num_results=10)
"""

from .base import SearchHit, SearchProvider, SearchResult
from .config import (
    DEFAULT_WEB_SEARCH_CONFIG,
    get_active_provider_name,
    get_provider_config,
    get_web_search_config,
    is_web_search_enabled,
)
from .factory import create_search_provider, create_search_provider_from_main_config
from .service import get_search_service_status, search_to_tool_payload, search_with_config
from .universal_webview_render import render_page_async, universal_webview_render

__all__ = [
    # base
    "SearchHit",
    "SearchResult",
    "SearchProvider",
    # config
    "DEFAULT_WEB_SEARCH_CONFIG",
    "get_web_search_config",
    "get_active_provider_name",
    "get_provider_config",
    "is_web_search_enabled",
    # factory
    "create_search_provider",
    "create_search_provider_from_main_config",
    # service
    "search_with_config",
    "search_to_tool_payload",
    "get_search_service_status",
    # render
    "render_page_async",
    "universal_webview_render",
]
