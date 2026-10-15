"""NexoraCode supports a reviewed set of OpenAI Chat Completions providers."""

from __future__ import annotations

from copy import deepcopy


# OpenCode's /models response contains models from several API families. Keep
# only models whose documented endpoint is OpenAI Chat Completions.
_OPENCODE_ZEN_CHAT_MODELS = (
    "qwen3.8-max",
    "deepseek-v4.1-flash",
    "deepseek-v4-pro",
    "minimax-m3",
    "minimax-m2.7",
    "minimax-m2.5",
    "glm-5.3-flash",
    "glm-5.3",
    "glm-5.2",
    "glm-5.1",
    "glm-5",
    "kimi-k2.5",
    "kimi-k2.6",
    "kimi-k2.7-code",
    "kimi-k3",
    "mistral-large-4",
    "big-pickle",
    "space-bunny-free",
    "cat-jam-free",
    "longcat-2.5-preview-free",
    "step-5-preview-free",
    "exo-free",
    "mimo-v2.6-flash-free",
    "mimo-v2.5-free",
    "nemotron-3-ultra-free",
    "nemotron-3.5-lightning-free",
)
_OPENCODE_GO_CHAT_MODELS = (
    "glm-5.3-flash",
    "glm-5.3",
    "glm-5.2",
    "kimi-k3",
    "kimi-k2.7-code",
    "kimi-k2.6",
    "longcat-2.0",
    "deepseek-v4.1-flash",
    "deepseek-v4-pro",
    "mimo-v2.6-flash",
    "mimo-v2.6-pro",
    "mimo-v2.5",
    "mimo-v2.5-pro",
    "hy4-preview",
    "hy3",
    "space-bunny",
    "longcat-2.5-preview-free",
    "step-5-preview-free",
    "cat-jam-free",
)


# Provider endpoints follow each platform's OpenAI Chat Completions documentation.
# The registry is bundled so settings can display templates without a network call.
_PROVIDER_TEMPLATES = {
    "openai": {
        "id": "openai",
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "model_list_url": "https://api.openai.com/v1/models",
        "model_list_parser": "openai",
        "docs_url": "https://developers.openai.com/api/reference/resources/models/methods/list",
    },
    "deepseek": {
        "id": "deepseek",
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com/chat/completions",
        "model_list_url": "https://api.deepseek.com/models",
        "model_list_parser": "openai",
        "docs_url": "https://api-docs.deepseek.com/api/list-models/",
    },
    "openrouter": {
        "id": "openrouter",
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "model_list_url": "https://openrouter.ai/api/v1/models",
        "model_list_parser": "openrouter",
        "docs_url": "https://openrouter.ai/docs/api/api-reference/models/get-models",
    },
    "opencode_zen": {
        "id": "opencode_zen",
        "name": "OpenCode Zen",
        "base_url": "https://opencode.ai/inference/openai/v1/chat/completions",
        "model_list_url": "https://opencode.ai/inference/v1/models",
        "model_list_parser": "opencode_chat",
        "model_list_model_ids": _OPENCODE_ZEN_CHAT_MODELS,
        "docs_url": "https://opencode.ai/v2/docs/console/models/",
        "model_list_hint": "只显示 OpenAI Chat Completions 兼容模型；Responses、Anthropic 和 Gemini 模型不会列出。",
    },
    "opencode_go": {
        "id": "opencode_go",
        "name": "OpenCode Go",
        "base_url": "https://opencode.ai/inference/go/v1/chat/completions",
        "model_list_url": "https://opencode.ai/inference/go/v1/models",
        "model_list_parser": "opencode_chat",
        "model_list_model_ids": _OPENCODE_GO_CHAT_MODELS,
        "docs_url": "https://opencode.ai/v2/docs/console/go/",
        "model_list_hint": "只显示 OpenAI Chat Completions 兼容模型；Responses、Anthropic 和 Gemini 模型不会列出。",
    },
    "zai": {
        "id": "zai",
        "name": "Z.AI",
        "base_url": "https://api.z.ai/api/paas/v4",
        "model_list_url": "",
        "model_list_parser": "",
        "docs_url": "https://docs.z.ai/api-reference/llm/chat-completion",
        "model_list_hint": "Z.AI 未提供可确认的公开模型列表接口，请手动填写 Model ID。",
    },
    "siliconflow": {
        "id": "siliconflow",
        "name": "SiliconFlow",
        "base_url": "https://api.siliconflow.cn/v1",
        "model_list_url": "https://api.siliconflow.cn/v1/models?sub_type=chat",
        "model_list_parser": "openai",
        "docs_url": "https://siliconflow.readme.io/reference/retrieve-a-list-of-models",
    },
    "moonshot": {
        "id": "moonshot",
        "name": "Moonshot",
        "base_url": "https://api.moonshot.cn/v1",
        "model_list_url": "https://api.moonshot.cn/v1/models",
        "model_list_parser": "openai",
        "docs_url": "https://platform.moonshot.cn/docs",
    },
    "dashscope": {
        "id": "dashscope",
        "name": "DashScope",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model_list_url": "",
        "model_list_parser": "",
        "docs_url": "https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope",
        "model_list_hint": "DashScope 国内模型目录接口需要 Workspace ID，当前模板只收 API Key，请手动填写 Model ID。",
    },
    "volcengine": {
        "id": "volcengine",
        "name": "火山引擎",
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "model_list_url": "",
        "model_list_parser": "",
        "docs_url": "https://docs.volcengine.com/docs/ark/model-list?lang=en",
        "model_list_hint": "火山方舟的账号模型列表接口需要另一套签名鉴权，请手动填写 Model ID。",
    },
}


def get_provider_template(template_id: str) -> dict | None:
    """Return a copy of a known template so callers cannot mutate the registry."""
    template = _PROVIDER_TEMPLATES.get(str(template_id or "").strip())

    return deepcopy(template) if template is not None else None


def list_provider_templates() -> list[dict]:
    """Return the safe settings-page fields for the supported provider presets."""
    result = []

    for template in _PROVIDER_TEMPLATES.values():
        result.append({
            "id": template["id"],
            "name": template["name"],
            "base_url": template["base_url"],
            "model_list_supported": bool(template["model_list_url"]),
            "model_list_hint": template.get(
                "model_list_hint",
                "从平台读取当前模型列表。",
            ),
            "docs_url": template["docs_url"],
        })

    return result
