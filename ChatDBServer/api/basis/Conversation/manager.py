"""
Nexora.basis.Conversation.manager — 兼容代理（Deprecated）

此模块仅为旧导入兼容，内部全部转发至 ConversationService，零业务逻辑。
新代码请直接使用：

    from basis.Conversation import ConversationService
"""

from __future__ import annotations

from .service import ConversationService
from .repository import conversation_base_path, conversation_index_path

CONVERSATION_INDEX_VERSION = 4


class ConversationManager:
    """Deprecated: 纯代理"""

    def __init__(self, username: str):
        self.username = str(username or "").strip()
        self._svc = ConversationService(self.username)
        self.base_path = conversation_base_path(self.username)
        self.index_path = conversation_index_path(self.username)

    def create_conversation(self, *a, **kw):
        return self._svc.create_conversation(*a, **kw)

    def get_conversation(self, *a, **kw):
        return self._svc.get_conversation(*a, **kw)

    def get_messages(self, *a, **kw):
        return self._svc.get_messages(*a, **kw)

    def get_message_count(self, *a, **kw):
        return self._svc.get_message_count(*a, **kw)

    def get_last_user_message_index(self, *a, **kw):
        return self._svc.get_last_user_message_index(*a, **kw)

    def list_conversations(self, *a, **kw):
        return self._svc.list_conversations(*a, **kw)

    def delete_conversation(self, *a, **kw):
        return self._svc.delete_conversation(*a, **kw)

    def restore_conversation(self, *a, **kw):
        return self._svc.restore_conversation(*a, **kw)

    def update_title(self, *a, **kw):
        return self._svc.update_title(*a, **kw)

    def update_conversation_title(self, *a, **kw):
        return self._svc.update_conversation_title(*a, **kw)

    def set_conversation_pin(self, *a, **kw):
        return self._svc.set_conversation_pin(*a, **kw)

    def set_pin(self, *a, **kw):
        return self._svc.set_pin(*a, **kw)

    def update_conversation_fields(self, *a, **kw):
        return self._svc.update_conversation_fields(*a, **kw)

    def ensure_conversation_compatibility(self, *a, **kw):
        return self._svc.ensure_conversation_compatibility(*a, **kw)

    def add_message(self, *a, **kw):
        return self._svc.add_message(*a, **kw)

    def update_message_metadata(self, *a, **kw):
        return self._svc.update_message_metadata(*a, **kw)

    def validate_regenerate_target(self, *a, **kw):
        return self._svc.validate_regenerate_target(*a, **kw)

    def resolve_regenerate_target(self, *a, **kw):
        return self._svc.resolve_regenerate_target(*a, **kw)

    def replace_assistant(self, *a, **kw):
        return self._svc.replace_assistant(*a, **kw)

    def edit_user_message(self, *a, **kw):
        return self._svc.edit_user_message(*a, **kw)

    def delete_turn(self, *a, **kw):
        return self._svc.delete_turn(*a, **kw)

    def delete_message(self, *a, **kw):
        return self._svc.delete_turn(*a, **kw)

    def save_message_version(self, *a, **kw):
        return self._svc.save_message_version(*a, **kw)

    def switch_message_version(self, *a, **kw):
        return self._svc.switch_message_version(*a, **kw)

    def update_user_message_content(self, *a, **kw):
        return self._svc.update_user_message_content(*a, **kw)

    def get_last_volc_response_id(self, *a, **kw):
        return self._svc.get_last_volc_response_id(*a, **kw)

    def get_last_response_id(self, *a, **kw):
        return self._svc.get_last_response_id(*a, **kw)

    def update_volc_response_id(self, *a, **kw):
        return self._svc.update_volc_response_id(*a, **kw)

    def update_last_response_id(self, *a, **kw):
        return self._svc.update_last_response_id(*a, **kw)

    def get_latest_compression(self, *a, **kw):
        return self._svc.get_latest_compression(*a, **kw)

    def get_latest_context_compression(self, *a, **kw):
        return self._svc.get_latest_compression(*a, **kw)

    def record_context_compression(self, *a, **kw):
        return self._svc.record_context_compression(*a, **kw)

    def append_context_compression(self, *a, **kw):
        return self._svc.record_context_compression(*a, **kw)

    def record_system_snapshot(self, *a, **kw):
        return self._svc.record_system_snapshot(*a, **kw)

    def record_knowledge_state(self, *a, **kw):
        return self._svc.record_knowledge_state(*a, **kw)

    def get_last_system_snapshot(self, *a, **kw):
        return self._svc.get_last_system_snapshot(*a, **kw)

    def has_system_snapshot(self, *a, **kw):
        return self._svc.has_system_snapshot(*a, **kw)

    def ensure_system_snapshot(self, *a, **kw):
        return self._svc.ensure_system_snapshot(*a, **kw)

    def get_last_knowledge_snapshot(self, *a, **kw):
        return self._svc.get_last_knowledge_snapshot(*a, **kw)

    def ensure_knowledge_diff_snapshot(self, *a, **kw):
        return self._svc.ensure_knowledge_diff_snapshot(*a, **kw)

    def get_last_global_knowledge_snapshot(self, *a, **kw):
        return self._svc.get_last_global_knowledge_snapshot(*a, **kw)

    def ensure_global_knowledge_diff_snapshot(self, *a, **kw):
        return self._svc.ensure_global_knowledge_diff_snapshot(*a, **kw)

    def set_main_title(self, *a, **kw):
        return self._svc.set_main_title(*a, **kw)

    def fork_conversation(self, *a, **kw):
        return self._svc.fork_conversation(*a, **kw)

    def get_context_length(self, *a, **kw):
        return self._svc.get_context_length(*a, **kw)

    def get_context(self, *a, **kw):
        return self._svc.get_context(*a, **kw)

    def get_context_find_keyword(self, *a, **kw):
        return self._svc.get_context_find_keyword(*a, **kw)

    def get_main_title(self, *a, **kw):
        return self._svc.get_main_title(*a, **kw)

    def get_recent_exchange_summaries(self, *a, **kw):
        return self._svc.get_recent_exchange_summaries(*a, **kw)

    def get_scope(self, *a, **kw):
        return self._svc.get_scope(*a, **kw)

    def set_workspace(self, *a, **kw):
        return self._svc.set_workspace(*a, **kw)

    def set_learning(self, *a, **kw):
        return self._svc.set_learning(*a, **kw)

    def replace_conversation_messages(self, *a, **kw):
        return self._svc.replace_conversation_messages(*a, **kw)

    def update_puzzle_state(self, *a, **kw):
        return self._svc.update_puzzle_state(*a, **kw)

    def get_puzzle_states(self, *a, **kw):
        return self._svc.get_puzzle_states(*a, **kw)

    def get_puzzle_state(self, *a, **kw):
        return self._svc.get_puzzle_state(*a, **kw)

    def get_conversation_usage(self, *a, **kw):
        return self._svc.get_conversation_usage(*a, **kw)

    def __getattr__(self, name):
        if hasattr(self._svc, name):
            return getattr(self._svc, name)
        raise AttributeError(f"'{self.__class__.__name__}' object has no attribute '{name}'")
