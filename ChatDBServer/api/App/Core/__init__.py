"""
Nexora.app.Core — 核心编排层

承载核心对话编排与运行时：
- model.py: Model 大模型封装类（编排中枢）
- stream_runtime.py: 流式会话运行时
- system_settings_runtime.py: 配置保存后运行时同步

对外提供：
- Model / StreamCancelled / SystemSettingsRuntimeSyncer
- stream_runtime 函数（start_session/iter_session_chunks 等）
"""
from .model import Model
from .stream_runtime import (
    StreamCancelled,
    cleanup_sessions,
    get_accumulated_content,
    get_session_meta,
    is_cancel_requested,
    is_stream_cancelled_error,
    iter_session_chunks,
    list_sessions,
    request_cancel,
    start_session,
)
from .system_settings_runtime import SystemSettingsRuntimeSyncer

__all__ = [n for n in globals() if not n.startswith('_')]
