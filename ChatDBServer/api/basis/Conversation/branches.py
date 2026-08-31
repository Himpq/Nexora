"""
Nexora.basis.Conversation.branches — 分支复制

只复制目标之前的可见消息，保留 scope、清空 resume。
"""

from __future__ import annotations

import copy
from datetime import datetime
from typing import Any, Dict


def now_iso() -> str:
    return datetime.now().isoformat()


def fork_branch_data(
    source_data: Dict[str, Any],
    message_index: int,
    new_conversation_id: str,
    title: str | None = None,
) -> Dict[str, Any]:
    messages = source_data.get("messages", [])
    if not isinstance(messages, list):
        raise ValueError("对话内容格式无效")
    try:
        target_index = int(message_index)
    except Exception as error:
        raise ValueError("message_index 必须是整数") from error

    if target_index < 0 or target_index >= len(messages):
        raise ValueError("分支节点已过期，请刷新会话后重试")

    target_message = messages[target_index] if isinstance(messages[target_index], dict) else {}
    if str(target_message.get("role") or "").strip() != "assistant":
        raise ValueError("当前仅支持从 assistant 回答创建分支")

    copied_messages = copy.deepcopy(messages[: target_index + 1])

    source_branch = source_data.get("branch", {}) if isinstance(source_data.get("branch"), dict) else {}
    root_conversation_id = str(source_branch.get("root_conversation_id") or source_data.get("conversation_id") or "").strip()
    created_at = now_iso()

    branch_title = str(title or "").strip() or str(source_data.get("title") or "未命名对话").strip() or "未命名对话"
    branch_title = branch_title[:120]

    # 只复制合法的 scope
    from .schema import normalize_scope

    scope = normalize_scope(source_data.get("scope"))
    # 兼容旧：若 v4 scope 为空但旧字段有 workspace，需在迁移后已归一，此处不再猜

    # 裁剪 context 至 parent_message_index（含等于）
    raw_context = copy.deepcopy(source_data.get("context", {})) if isinstance(source_data.get("context"), dict) else {
        "system_snapshots": [],
        "knowledge": {"workspace": {"hash": "", "documents": []}, "global": {"hash": "", "titles": []}},
        "knowledge_events": [],
        "compressions": [],
        "legacy_events": [],
    }
    # system_snapshots 过滤
    filtered_snapshots = [s for s in (raw_context.get("system_snapshots", []) if isinstance(raw_context.get("system_snapshots"), list) else []) if isinstance(s, dict) and int(s.get("effective_from_message") or 0) <= int(target_index)]
    # knowledge_events 过滤
    filtered_events = [e for e in (raw_context.get("knowledge_events", []) if isinstance(raw_context.get("knowledge_events"), list) else []) if isinstance(e, dict) and int(e.get("effective_from_message") or 0) <= int(target_index)]
    # compressions 过滤（history_cut_index <= target_index）
    filtered_compressions = [c for c in (raw_context.get("compressions", []) if isinstance(raw_context.get("compressions"), list) else []) if isinstance(c, dict) and int(c.get("history_cut_index", -1) or -1) <= int(target_index)]
    filtered_legacy = [e for e in (raw_context.get("legacy_events", []) if isinstance(raw_context.get("legacy_events"), list) else []) if isinstance(e, dict) and int(e.get("effective_from_message") or 0) <= int(target_index)]
    # 重新计算 effective knowledge
    from .context import get_effective_knowledge_state
    effective_knowledge = get_effective_knowledge_state(source_data, int(target_index))
    trimmed_context = {
        "system_snapshots": filtered_snapshots,
        "knowledge": copy.deepcopy(effective_knowledge),
        "knowledge_events": filtered_events,
        "compressions": filtered_compressions,
        "legacy_events": filtered_legacy,
    }

    new_data: Dict[str, Any] = {
        "schema_version": int(source_data.get("schema_version") or 4),
        "conversation_id": str(new_conversation_id),
        "title": branch_title,
        "created_at": created_at,
        "updated_at": created_at,
        "pin": False,
        "scope": copy.deepcopy(scope),
        "messages": copied_messages,
        "context": trimmed_context,
        "branch": {
            "root_conversation_id": root_conversation_id,
            "parent_conversation_id": str(source_data.get("conversation_id") or "").strip(),
            "parent_message_index": int(target_index),
            "created_at": created_at,
        },
        "runtime": {"resume": None},
    }

    # 清理旧 resume 兼容字段
    for key in ("last_volc_response_id", "last_model_used", "metadata", "tags", "conversation_mode", "longterm"):
        if key in new_data:
            pass
    # 保留必要的兼容字段置空
    # 仅保留 puzzle_states 中与可见消息相关的
    puzzle_states = source_data.get("puzzle_states", {})
    if isinstance(puzzle_states, dict) and puzzle_states:
        # 收集可见消息中的 puzzle_id
        puzzle_ids: set[str] = set()

        def _collect(value: Any) -> None:
            if isinstance(value, dict):
                pid = str(value.get("puzzle_id") or "").strip()
                if pid:
                    puzzle_ids.add(pid)
                for nested in value.values():
                    _collect(nested)
            elif isinstance(value, list):
                for nested in value:
                    _collect(nested)

        _collect(copied_messages)
        if puzzle_ids:
            new_data["puzzle_states"] = {
                pid: copy.deepcopy(puzzle_states[pid])
                for pid in puzzle_ids
                if pid in puzzle_states
            }

    return new_data
