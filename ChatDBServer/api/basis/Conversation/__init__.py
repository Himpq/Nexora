"""
Nexora.basis.Conversation — 会话基础层

职责：会话的创建/加载/更新/索引/版本管理，会话文件修复，会话资产存储。
- manager.py: ConversationManager 会话管理
- repair.py: 会话文件修复工具
- asset_store.py: 会话资产存储

对外提供：
- ConversationManager
- recover_conversation_bytes（repair）
"""
from .manager import ConversationManager
from .repair import recover_conversation_bytes
from .asset_store import (
    cleanup_conversation_assets,
    clone_referenced_assets,
    collect_referenced_asset_ids,
    conversation_asset_dir,
    conversation_asset_index_path,
    conversation_asset_root,
    get_conversation_asset_file,
    load_conversation_asset_index,
    parse_image_data_url,
    persist_conversation_image_asset,
    persist_conversation_image_bytes,
    remove_conversation_assets_dir,
    safe_asset_ext,
    save_conversation_asset_index,
)
from . import asset_store

__all__ = [
    "ConversationManager",
    "recover_conversation_bytes",
    "persist_conversation_image_bytes",
    "asset_store",
]
