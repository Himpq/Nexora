from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class AntiSpiderState:
    """记录搜索页面是否进入人机验证或异常流量页面。"""

    detected: bool = False
    reason: str = ""
    url: str = ""
    title: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ImageSearchResult:
    """统一图片结果结构，供 CLI 和未来 NexoraCode 接入复用。"""

    engine: str
    title: str = ""
    image_url: str = ""
    thumbnail_url: str = ""
    source_url: str = ""
    page_url: str = ""
    width: int | None = None
    height: int | None = None
    mime: str = ""
    license: str = ""
    author: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)

        return data


@dataclass
class ImageSearchResponse:
    """统一搜索响应结构，明确区分正常结果与需要人工验证的状态。"""

    engine: str
    query: str
    status: str
    results: list[ImageSearchResult] = field(default_factory=list)
    anti_spider: AntiSpiderState = field(default_factory=AntiSpiderState)
    message: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "engine": self.engine,
            "query": self.query,
            "status": self.status,
            "message": self.message,
            "anti_spider": self.anti_spider.to_dict(),
            "results": [item.to_dict() for item in self.results],
        }
