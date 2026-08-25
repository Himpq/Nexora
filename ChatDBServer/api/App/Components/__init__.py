"""
Nexora.app.Components — 外部项目链接桥

职责：与其他 Nexora 子项目（NexoraMail / NexoraCode / NexoraLearning 等）的
链接桥梁。每个组件封装对子项目服务的 HTTP/协议调用，供应用层复用。

- Mail.py: NexoraMail 链接桥（MailMixin）
- Learning.py: NexoraLearning 链接桥（LearningRuntimeExecutor）
"""
from .Mail import MailMixin
from .Learning import (
    LearningRuntimeExecutor,
    build_learning_context_payload,
    build_learning_memory_blocks,
    get_learning_runtime_config,
    get_learning_runtime_local_config,
    get_learning_tools,
    increment_learning_turn_and_maybe_enqueue,
    mark_learning_context_compression,
    trigger_learning_memory_analysis,
)

__all__ = [
    "MailMixin",
    "LearningRuntimeExecutor",
    "build_learning_context_payload",
    "build_learning_memory_blocks",
    "get_learning_runtime_config",
    "get_learning_runtime_local_config",
    "get_learning_tools",
    "increment_learning_turn_and_maybe_enqueue",
    "mark_learning_context_compression",
    "trigger_learning_memory_analysis",
]
