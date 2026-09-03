"""
Nexora.basis.Conversation.errors — v4 统一异常类型

所有 ConversationService 抛出的受控异常均继承 ConversationError，
便于上层统一映射为 HTTP 4xx。
"""

from __future__ import annotations


class ConversationError(Exception):
    """Conversation 域根异常。"""

    def __init__(self, message: str, *, conversation_id: str = "", details: dict | None = None):
        super().__init__(message)
        self.conversation_id = str(conversation_id or "")
        self.details = dict(details or {})


class ConversationNotFoundError(ConversationError):
    """会话不存在。"""


class ConversationValidationError(ConversationError):
    """参数校验失败。"""


class ConversationConflictError(ConversationError):
    """状态冲突（如索引已过期）。"""


class ConversationTargetRoleError(ConversationConflictError):
    """重答/覆盖目标角色不符（严格校验失败）。"""


class ConversationMigrationError(ConversationError):
    """迁移失败（原文件保持不变）。"""


class ConversationIndexError(ConversationConflictError):
    """消息索引越界或失效。"""


# 统一双路径导入：basis.Conversation.errors 与 api.basis.Conversation.errors 指向同一模块对象
# 避免 Service(经 basis)与路由(经 api.basis)捕获时 isinstance 失效
try:
    import sys as _sys
    _this = _sys.modules[__name__]
    for _alias in (
        "basis.Conversation.errors",
        "api.basis.Conversation.errors",
        "ChatDBServer.api.basis.Conversation.errors",
    ):
        if _alias not in _sys.modules:
            _sys.modules[_alias] = _this
        else:
            # 若已存在但为不同对象，强制覆盖为同一对象以保证 same_class
            _sys.modules[_alias] = _this
    # 同时保证父包别名
    for _pkg_alias, _real in (
        ("basis.Conversation", "api.basis.Conversation"),
        ("basis", "api.basis"),
    ):
        if _pkg_alias not in _sys.modules and _real in _sys.modules:
            _sys.modules[_pkg_alias] = _sys.modules[_real]
except Exception:
    pass
