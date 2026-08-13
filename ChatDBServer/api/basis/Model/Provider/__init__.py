"""
Nexora.basis.Model.Provider — 模型 Provider 契约层

职责：模型服务商（Provider）的抽象协议与实现注册。
- base.py: ProviderInterface 协议基类（请求构建/流解析/结果提取）
- factory.py: create_provider_adapter 工厂（按 api_type 路由到具体实现）
- dashscope/openai/ollama/vllm/volcengine: 5 个内置实现

对外提供：
- ProviderInterface: 协议基类
- create_provider_adapter / infer_api_type: 工厂与类型推断
"""
from .base import ProviderInterface
from .factory import _infer_api_type as infer_api_type
from .factory import create_provider_adapter

__all__ = [
    "ProviderInterface",
    "create_provider_adapter",
    "infer_api_type",
]
