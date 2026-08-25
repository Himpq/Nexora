"""
Nexora.app.Search — 搜索实现

承载外部搜索工具实现：
- duckduckgo_search.py: DuckDuckGo 搜索（依赖 ddgs）
- github.py: GitHub 搜索
- universal_webview_render.py: 通用网页渲染

注意：duckduckgo_search 依赖外部包 ddgs，仅在调用时按需导入，
避免 App.Search 顶层导入触发缺失依赖。
"""
from .universal_webview_render import render_page_async, universal_webview_render

__all__ = [n for n in globals() if not n.startswith('_')]
