"""
Nexora.basis.Conversation.context — system/knowledge/compression/context 构建

职责：
- 记录 system snapshot / knowledge state / compression marker 到 context（不混入 messages）
- 根据可见消息位置选择适用的 system/knowledge 状态
- 为 Model层提供 build_model_context 的纯数据上下文
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any, Dict, List, Optional

from .schema import now_iso, sha16


def _system_hash(text: str) -> str:
    return sha16(text)


def _safe_parse_index(value: Any) -> int:
    """
    安全解析下标字段（history_cut_index / effective_from_message）。
    0 是合法值（cut=0 表示全部历史被压缩），不能用 `or -1` 兜底，
    否则 0 会被 falsy 吞成 -1 导致压缩摘要/首轮事件被判无效。
    """

    try:
        return int(value)
    except (TypeError, ValueError):
        return -1


def record_system_snapshot(
    conversation_data: Dict[str, Any],
    content: str,
    *,
    reason: str = "chat_turn",
    effective_from_message: int | None = None,
) -> Dict[str, Any] | None:
    """记录系统快照到 context.system_snapshots，哈希相同则不重复追加。"""
    text = str(content or "").strip()
    if not text:
        return None

    new_hash = _system_hash(text)
    context = conversation_data.get("context")
    if not isinstance(context, dict):
        context = {}
        conversation_data["context"] = context
    snapshots: List[Dict[str, Any]] = context.get("system_snapshots", [])
    if not isinstance(snapshots, list):
        snapshots = []
        context["system_snapshots"] = snapshots

    if snapshots:
        last = snapshots[-1] if isinstance(snapshots[-1], dict) else {}
        last_hash = str(last.get("hash") or "").strip()
        if last_hash == new_hash:
            return None

    existing_epochs = [int((s.get("epoch") or 0)) for s in snapshots if isinstance(s, dict)]
    next_epoch = (max(existing_epochs) + 1) if existing_epochs else 1

    messages = conversation_data.get("messages", []) if isinstance(conversation_data.get("messages"), list) else []
    if effective_from_message is None:
        effective_from_message = len(messages)

    snapshot = {
        "epoch": int(next_epoch),
        "hash": new_hash,
        "content": text,
        "effective_from_message": int(effective_from_message),
        "reason": str(reason or "chat_turn").strip() or "chat_turn",
        "created_at": now_iso(),
    }
    snapshots.append(snapshot)
    context["system_snapshots"] = snapshots
    conversation_data["updated_at"] = now_iso()
    return snapshot


def _knowledge_docs_hash(docs: Any) -> str:
    if not isinstance(docs, list):
        return ""
    normalized: List[Dict[str, Any]] = []
    for item in docs:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or item.get("name") or "").strip()
        if not title:
            continue
        normalized.append({
            "title": title,
            "knowledge_type": str(item.get("knowledge_type") or item.get("type") or "basis").strip(),
            "basis_id": str(item.get("basis_id") or "").strip(),
            "pin": bool(item.get("pin", False)),
        })
    normalized.sort(key=lambda x: (x["title"].lower(), x["basis_id"]))
    import json as _json
    try:
        raw = _json.dumps(normalized, ensure_ascii=False, sort_keys=True)
    except Exception:
        raw = str(normalized)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


_UNSET = object()

def record_knowledge_state(
    conversation_data: Dict[str, Any],
    *,
    workspace_documents: Any = _UNSET,
    global_titles: Any = _UNSET,
    effective_from_message: int | None = None,
    emit_event: bool = True,
) -> Dict[str, Any] | None:
    """
    记录知识库状态到 context.knowledge，并追加 knowledge_events。
    区分「未提供」与「显式空列表」：
      - 未提供 -> 保留旧值
      - 空列表 -> 清空
    哈希相同则不追加事件。首轮可传 emit_event=False，仅建立基线。
    """
    context = conversation_data.get("context")
    if not isinstance(context, dict):
        context = {}
        conversation_data["context"] = context

    knowledge = context.get("knowledge") if isinstance(context.get("knowledge"), dict) else {}
    if not isinstance(knowledge, dict):
        knowledge = {}
    workspace = knowledge.get("workspace") if isinstance(knowledge.get("workspace"), dict) else {}
    global_knowledge = knowledge.get("global") if isinstance(knowledge.get("global"), dict) else {}

    old_workspace_docs = workspace.get("documents", []) if isinstance(workspace.get("documents"), list) else []
    old_global_titles_raw = global_knowledge.get("titles", []) if isinstance(global_knowledge.get("titles"), list) else []
    if not old_global_titles_raw and isinstance(global_knowledge.get("documents"), list):
        old_global_titles_raw = [str(d.get("title") or "").strip() for d in global_knowledge.get("documents", []) if isinstance(d, dict)]

    # 区分未提供 vs 显式清空
    if workspace_documents is _UNSET:
        new_workspace_docs = [dict(d) for d in old_workspace_docs if isinstance(d, dict)]
    else:
        raw = workspace_documents if isinstance(workspace_documents, list) else []
        new_workspace_docs = [dict(d) for d in raw if isinstance(d, dict)]

    if global_titles is _UNSET:
        new_global_titles = [str(t or "").strip() for t in old_global_titles_raw if str(t or "").strip()]
    else:
        raw = global_titles if isinstance(global_titles, list) else []
        new_global_titles = [str(t or "").strip() for t in raw if str(t or "").strip()]

    old_workspace_hash = _knowledge_docs_hash(old_workspace_docs)
    new_workspace_hash = _knowledge_docs_hash(new_workspace_docs)

    old_global_docs = [{"title": t} for t in old_global_titles_raw]
    old_global_hash = _knowledge_docs_hash(old_global_docs)
    new_global_docs = [{"title": t} for t in new_global_titles]
    new_global_hash = _knowledge_docs_hash(new_global_docs)

    if old_workspace_hash == new_workspace_hash and old_global_hash == new_global_hash:
        return None

    knowledge["workspace"] = {
        "hash": new_workspace_hash,
        "documents": new_workspace_docs,
        "updated_at": now_iso(),
    }
    knowledge["global"] = {
        "hash": new_global_hash,
        "titles": list(new_global_titles),
        "updated_at": now_iso(),
    }
    context["knowledge"] = knowledge

    old_ws_titles = {str(d.get("title") or "").strip(): d for d in old_workspace_docs if str(d.get("title") or "").strip()}
    new_ws_titles = {str(d.get("title") or "").strip(): d for d in new_workspace_docs if str(d.get("title") or "").strip()}
    ws_added = [new_ws_titles[t] for t in new_ws_titles if t not in old_ws_titles]
    ws_removed = [old_ws_titles[t] for t in old_ws_titles if t not in new_ws_titles]

    old_global_set = {str(t or "").strip() for t in old_global_titles_raw if str(t or "").strip()}
    new_global_set = {str(t or "").strip() for t in new_global_titles if str(t or "").strip()}
    global_added = [t for t in new_global_set if t not in old_global_set]
    global_removed = [t for t in old_global_set if t not in new_global_set]

    messages = conversation_data.get("messages", []) if isinstance(conversation_data.get("messages"), list) else []
    if effective_from_message is None:
        effective_from_message = len(messages)

    events: List[Dict[str, Any]] = context.get("knowledge_events", [])
    if not isinstance(events, list):
        events = []
        context["knowledge_events"] = events

    # 仅当有可见标题变更时才落事件，避免 pin/排序等不可见属性变更产生空 banner 间歇出现
    if emit_event and (ws_added or ws_removed):
        events.append({
            "scope": "workspace",
            "added": ws_added,
            "removed": ws_removed,
            "hash": new_workspace_hash,
            "prev_hash": old_workspace_hash,
            "effective_from_message": int(effective_from_message),
            "created_at": now_iso(),
            # 保存完整快照用于历史回放
            "documents_snapshot": list(new_workspace_docs),
        })
    if emit_event and (global_added or global_removed):
        events.append({
            "scope": "global",
            "added": [{"title": t} for t in global_added],
            "removed": [{"title": t} for t in global_removed],
            "hash": new_global_hash,
            "prev_hash": old_global_hash,
            "effective_from_message": int(effective_from_message),
            "created_at": now_iso(),
            "titles_snapshot": list(new_global_titles),
        })

    context["knowledge_events"] = events
    conversation_data["updated_at"] = now_iso()

    return {
        "workspace_hash": new_workspace_hash,
        "global_hash": new_global_hash,
        "ws_added": ws_added,
        "ws_removed": ws_removed,
        "global_added": global_added,
        "global_removed": global_removed,
    }


def record_context_compression(
    conversation_data: Dict[str, Any],
    marker: Dict[str, Any],
) -> Dict[str, Any]:
    """追加一条压缩标记到 context.compressions。"""
    if not isinstance(marker, dict):
        raise ValueError("marker 必须是 dict")
    context = conversation_data.get("context")
    if not isinstance(context, dict):
        context = {}
        conversation_data["context"] = context
    compressions: List[Dict[str, Any]] = context.get("compressions", [])
    if not isinstance(compressions, list):
        compressions = []
    item = {
        "summary": str(marker.get("summary", "") or "").strip(),
        # cut=0 合法（全部历史被压缩），不能用 `or -1` 兜底
        "history_cut_index": _safe_parse_index(marker.get("history_cut_index")),
        "created_at": str(marker.get("created_at", now_iso()) or now_iso()),
        "model": str(marker.get("model", "") or "").strip(),
        "provider": str(marker.get("provider", "") or "").strip(),
        "trigger_raw_input_tokens": int(marker.get("trigger_raw_input_tokens", 0) or 0),
        "context_window": int(marker.get("context_window", 0) or 0),
        "history_message_count": int(marker.get("history_message_count", 0) or 0),
        "history_chars": int(marker.get("history_chars", 0) or 0),
    }
    # 兼容旧字段：history_cut_index 对应 visible message index
    compressions.append(item)
    if len(compressions) > 40:
        compressions = compressions[-40:]
    context["compressions"] = compressions
    conversation_data["updated_at"] = now_iso()
    # 兼容旧顶层字段
    legacy_arr = conversation_data.get("context_compressions")
    if isinstance(legacy_arr, list):
        # 同步一份到旧位置以便旧 Context 读取（过渡期）
        legacy_arr.append(item)
        if len(legacy_arr) > 40:
            legacy_arr = legacy_arr[-40:]
        conversation_data["context_compressions"] = legacy_arr
    return item


def get_latest_compression(
    conversation_data: Dict[str, Any],
) -> Dict[str, Any] | None:
    context = conversation_data.get("context") if isinstance(conversation_data.get("context"), dict) else {}
    arr = context.get("compressions", []) if isinstance(context, dict) else []
    if isinstance(arr, list) and arr:
        last = arr[-1]
        return last if isinstance(last, dict) else None
    # 兼容旧顶层
    legacy = conversation_data.get("context_compressions")
    if isinstance(legacy, list) and legacy:
        last = legacy[-1]
        return last if isinstance(last, dict) else None
    return None


def get_effective_system_snapshot(
    conversation_data: Dict[str, Any],
    visible_message_index: int | None = None,
) -> Dict[str, Any] | None:
    """根据可见消息位置选择适用的最新 system snapshot。"""
    context = conversation_data.get("context") if isinstance(conversation_data.get("context"), dict) else {}
    snapshots = context.get("system_snapshots", []) if isinstance(context, dict) else []
    if not isinstance(snapshots, list) or not snapshots:
        return None
    if visible_message_index is None:
        # 返回最后一条
        for item in reversed(snapshots):
            if isinstance(item, dict):
                return item
        return None
    # 选择 effective_from_message <= visible_message_index 的最新一条
    best: Dict[str, Any] | None = None
    for item in snapshots:
        if not isinstance(item, dict):
            continue
        eff = int(item.get("effective_from_message") or 0)
        if eff <= int(visible_message_index):
            if best is None or eff >= int(best.get("effective_from_message") or 0):
                best = item
    return best


def get_effective_knowledge_state(
    conversation_data: Dict[str, Any],
    visible_message_index: int | None = None,
) -> Dict[str, Any]:
    """返回在指定 visible_index 时生效的知识状态（workspace/global）。"""
    context = conversation_data.get("context") if isinstance(conversation_data.get("context"), dict) else {}
    knowledge = context.get("knowledge") if isinstance(context, dict) and isinstance(context.get("knowledge"), dict) else {}
    current_workspace = dict(knowledge.get("workspace", {})) if isinstance(knowledge.get("workspace"), dict) else {"hash": "", "documents": []}
    current_global = dict(knowledge.get("global", {})) if isinstance(knowledge.get("global"), dict) else {"hash": "", "titles": []}
    if visible_message_index is None:
        return {"workspace": current_workspace, "global": current_global}
    events = context.get("knowledge_events", []) if isinstance(context, dict) else []
    if not isinstance(events, list) or not events:
        return {"workspace": current_workspace, "global": current_global}

    # 分 scope 查找最新生效快照
    def _latest_snapshot(scope: str) -> Dict[str, Any] | None:
        best = None
        best_eff = -1
        for e in events:
            if not isinstance(e, dict) or str(e.get("scope") or "") != scope:
                continue
            try:
                eff = int(e.get("effective_from_message") or 0)
            except Exception:
                continue
            if eff <= int(visible_message_index) and eff >= best_eff:
                # 优先使用快照字段（新），兼容旧事件无快照时回退
                if scope == "workspace" and isinstance(e.get("documents_snapshot"), list):
                    best = {"hash": str(e.get("hash") or ""), "documents": list(e.get("documents_snapshot", [])), "titles": []}
                    # 兼容部分旧事件直接存 documents
                    if not best["documents"] and isinstance(e.get("documents"), list):
                        best["documents"] = list(e.get("documents", []))
                elif scope == "global" and isinstance(e.get("titles_snapshot"), list):
                    best = {"hash": str(e.get("hash") or ""), "titles": list(e.get("titles_snapshot", [])), "documents": []}
                else:
                    # 旧事件无快照：若为最新，尝试用当前快照的 hash 匹配
                    # 否则无法精确回放，返回当前对应 scope（保守）
                    # 对于历史回放，我们尽量返回空以避免错误知识
                    best = None
                best_eff = eff
        return best

    ws_snapshot = _latest_snapshot("workspace")
    gl_snapshot = _latest_snapshot("global")

    # 若该 scope 从未有事件，返回当前（视为初始即存在）
    # 若有事件但均在未来（best is None），说明在该 index 时尚未有该 scope 的知识，返回空
    has_ws_event = any(isinstance(e, dict) and str(e.get("scope") or "") == "workspace" for e in events)
    has_gl_event = any(isinstance(e, dict) and str(e.get("scope") or "") == "global" for e in events)

    result_workspace = ws_snapshot if ws_snapshot is not None else ({"hash": "", "documents": []} if has_ws_event else current_workspace)
    result_global = gl_snapshot if gl_snapshot is not None else ({"hash": "", "titles": []} if has_gl_event else current_global)

    # 归一化返回结构
    if result_workspace is None:
        result_workspace = {"hash": "", "documents": []}
    if result_global is None:
        result_global = {"hash": "", "titles": []}
    # 确保字段完整
    if "documents" not in result_workspace:
        result_workspace["documents"] = []
    if "titles" not in result_global:
        result_global["titles"] = []
    if "hash" not in result_workspace:
        result_workspace["hash"] = _knowledge_docs_hash(result_workspace.get("documents", []))
    if "hash" not in result_global:
        result_global["hash"] = _knowledge_docs_hash([{"title": t} for t in result_global.get("titles", [])])
    return {"workspace": result_workspace, "global": result_global}


def build_model_context_payload(
    conversation_data: Dict[str, Any],
    current_user_content: Any = None,
    *,
    history_end_index_exclusive: int | None = None,
    system_prompt_text: str | None = None,
    system_injection_texts: List[str] | None = None,
) -> Dict[str, Any]:
    """
    构建模型上下文所需的纯数据负载（不依赖 Model 实例）。

    返回结构：
    {
        "system_snapshot": {epoch, hash, content, effective_from_message} | None,
        "knowledge": {workspace, global},
        "compression": {...} | None,
        "messages": [...visible messages slice...],
        "current_user_content": ...,
        "system_prompt_text": ...,
        "system_injection_texts": [...]
    }
    """
    messages = conversation_data.get("messages", []) if isinstance(conversation_data.get("messages"), list) else []
    if history_end_index_exclusive is not None:
        try:
            cut = int(history_end_index_exclusive)
            if cut >= 0:
                messages = messages[:cut]
        except Exception:
            pass

    # 生效的 system/knowledge：对于“下一轮”上下文，需包含 effective == len(messages) 的更新
    # 空历史（len==0）应返回 None 而非最新快照，避免污染 regenerate 上下文
    if history_end_index_exclusive is not None:
        visible_index = len(messages) - 1 if messages else -1
    else:
        visible_index = len(messages)  # next turn index, includes post-last updates
    if visible_index < 0:
        system_snapshot = None
        knowledge = {"workspace": {"hash": "", "documents": []}, "global": {"hash": "", "titles": []}}
    else:
        system_snapshot = get_effective_system_snapshot(conversation_data, visible_index)
        knowledge = get_effective_knowledge_state(conversation_data, visible_index)
    compression = get_latest_compression(conversation_data)

    return {
        "system_snapshot": system_snapshot,
        "knowledge": knowledge,
        "compression": compression,
        "messages": [dict(m) for m in messages if isinstance(m, dict)],
        "current_user_content": current_user_content,
        "system_prompt_text": str(system_prompt_text or "").strip() if system_prompt_text else "",
        "system_injection_texts": list(system_injection_texts or []) if isinstance(system_injection_texts, list) else [],
    }
