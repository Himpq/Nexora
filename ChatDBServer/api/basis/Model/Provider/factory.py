from typing import Any, Dict

from .dashscope import DashScopeProvider
from .openai import OpenAIProvider
from .vllm import VLLMProvider
from .volcengine import VolcengineProvider


def _infer_api_type(provider_name: str, provider_config: Dict[str, Any]) -> str:
    # 内置专用 adapter 的 provider 优先按 provider 名路由，避免 api_type 误判为通用 openai。
    # 例：volcengine 配置 api_type=openai_compatible 时会错误落到 OpenAIProvider（use_responses_api=False），
    #     导致 Chat Completions + native web_search 触发 Ark 报 missing tools.function。
    p = str(provider_name or "").strip().lower()
    if p == "volcengine":
        return "volcengine"
    if p == "aliyun":
        return "dashscope"

    api_type = str(provider_config.get("api_type", "") or "").strip().lower()
    if api_type:
        if api_type in {"openaiapi", "openai-api", "openai_compatibleapi"}:
            return "openai"
        if api_type in {"openai-compatible", "openai compatible"}:
            return "openai_compatible"
        return api_type
    if p == "vllm":
        return "vllm"
    return "openai"


def create_provider_adapter(provider_name: str, provider_config: Dict[str, Any]):
    cfg = provider_config if isinstance(provider_config, dict) else {}
    api_type = _infer_api_type(provider_name, cfg)
    provider_key = str(provider_name or "").strip().lower()
    if api_type == "vllm" or provider_key == "vllm":
        return VLLMProvider(provider_name, cfg)
    if api_type == "volcengine":
        return VolcengineProvider(provider_name, cfg)
    if api_type == "dashscope":
        return DashScopeProvider(provider_name, cfg)
    if api_type == "ollama":
        from .ollama import OllamaProvider
        return OllamaProvider(provider_name, cfg)
    if api_type in {"openai", "openai_compatible"}:
        return OpenAIProvider(provider_name, cfg)
    return OpenAIProvider(provider_name, cfg)

