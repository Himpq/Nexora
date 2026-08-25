"""
NexoraCode.model — 本地对话模型层

对话完全在本地驱动（agent loop），只调用户配置的 Provider 模型 API：
- Provider: OpenAI 兼容 Provider 客户端（流式 / tools）
- AgentLoop: 本地 Agent Loop（消息历史 + 工具循环）
- ConversationStore: 本地会话存储
- Permission: 本地路径授权询问

对外提供：
- ProviderClient / ProviderConfig / load_provider / save_provider
- AgentLoop / ConversationStore
- build_local_permission_question / build_local_permission_request
"""

from __future__ import annotations

from .Provider import (
    ProviderClient,
    ProviderConfig,
    ProviderError,
    get_default_provider,
    load_provider,
    load_providers,
    save_providers,
)
from .ConversationStore import ConversationStore
from .AgentLoop import AgentLoop
from .Permission import build_local_permission_question, build_local_permission_request
