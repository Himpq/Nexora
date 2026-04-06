from typing import Any, Dict

from providers.dashscope import DashScopeProvider
from providers.openai import OpenAIProvider
from providers.volcengine import VolcengineProvider


def _infer_api_type(provider_name: str, provider_config: Dict[str, Any]) -> str:
    api_type = str(provider_config.get("api_type", "") or "").strip().lower()
    if api_type:
        return api_type
    p = str(provider_name or "").strip().lower()
    if p == "volcengine":
        return "volcengine"
    if p == "aliyun":
        return "dashscope"
    return "openai"


def create_provider_adapter(provider_name: str, provider_config: Dict[str, Any]):
    cfg = provider_config if isinstance(provider_config, dict) else {}
    api_type = _infer_api_type(provider_name, cfg)
    if api_type == "volcengine":
        return VolcengineProvider(provider_name, cfg)
    if api_type == "dashscope":
        return DashScopeProvider(provider_name, cfg)
    if api_type == "ollama":
        from providers.ollama import OllamaProvider
        return OllamaProvider(provider_name, cfg)
    if api_type in {"openai", "openai_compatible"}:
        return OpenAIProvider(provider_name, cfg)
    return OpenAIProvider(provider_name, cfg)

