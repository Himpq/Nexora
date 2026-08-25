"""
Nexora.app.Collaboration — 协作与搜索

承载知识协作与全局搜索：
- knowledge_collab.py: 知识协作（KnowledgeCollabHub）
- global_search.py: 全局搜索

对外提供：
- KnowledgeCollabHub / global_search
"""
from .knowledge_collab import KnowledgeCollabHub
from .global_search import global_search, global_search_bp

__all__ = [n for n in globals() if not n.startswith('_')]
