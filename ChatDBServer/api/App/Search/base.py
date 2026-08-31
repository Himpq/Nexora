"""
Nexora.app.Search.base — 搜索提供方抽象

职责：
- 定义统一的搜索接口，供 DuckDuckGo / Exa / 后续 Tavily/Brave 等实现
- 与 LLM ProviderInterface 对齐的设计思路：Manager 不关心厂商细节

设计原则：
- 无兜底：参数缺失直接返回明确错误，不静默降级
- 统一返回形状，方便 ToolExecutor / 前端消费
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# 统一数据结构
# ---------------------------------------------------------------------------

@dataclass
class SearchHit:
    """单条搜索命中，跨厂商归一化"""

    title: str = ""
    url: str = ""
    snippet: str = ""

    # Exa Highlights / 扩展字段
    highlights: List[str] = field(default_factory=list)
    published_date: str = ""
    score: Optional[float] = None
    source: str = ""

    # 原始厂商 payload
    raw: Optional[Dict[str, Any]] = None


@dataclass
class SearchResult:
    """搜索结果容器"""

    ok: bool = False
    provider: str = ""
    query: str = ""
    hits: List[SearchHit] = field(default_factory=list)
    error: str = ""
    raw: Any = None


# ---------------------------------------------------------------------------
# 抽象接口
# ---------------------------------------------------------------------------

class SearchProvider(ABC):
    """
    搜索提供方接口

    子类仅需实现厂商相关适配，不做业务编排
    """

    def __init__(self, provider_name: str, provider_config: Optional[Dict[str, Any]] = None):
        self._provider_name = str(provider_name or "").strip()
        self._provider_config = provider_config if isinstance(provider_config, dict) else {}

    @property
    def provider_name(self) -> str:
        return self._provider_name

    @property
    def provider_config(self) -> Dict[str, Any]:
        return self._provider_config

    @property
    @abstractmethod
    def provider_type(self) -> str:
        """厂商类型标识，如 duckduckgo / exa / tavily"""
        raise NotImplementedError

    @abstractmethod
    def search(
        self,
        query: str,
        num_results: int = 10,
        **kwargs: Any,
    ) -> SearchResult:
        """
        执行搜索

        Args:
            query: 检索词
            num_results: 期望条数
            **kwargs: 厂商透传参数（如 Exa 的 type/contents/includeDomains）

        Returns:
            SearchResult
        """
        raise NotImplementedError

    def health_check(self) -> Dict[str, Any]:
        """可选健康检查，默认返回未实现"""
        return {
            "ok": False,
            "provider": self.provider_name,
            "provider_type": self.provider_type,
            "error": "health_check_not_supported",
        }
