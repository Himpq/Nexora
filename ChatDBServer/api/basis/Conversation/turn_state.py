"""
Nexora.basis.Conversation.turn_state — 画像/技能轮次基线采样与事件落库

职责（与 record_knowledge_state 完全同构的四件套模式）：
- begin_user_turn 事务内采样当前画像 / 技能状态，与上一基线做 diff
- 基线存 context.profile_state / context.skill_state（模型当前可见的版本）
- 变更事件落 context.profile_events / context.skill_events（带 effective_from_message，
  供 Context 层历史回放按位重建，保证任意轮次重建出的上下文与首次发送时一致）

基线语义：head 由 turn-1 快照冻结后，基线代表「模型已经看到的版本」；
每轮采样若与基线不同，delta 返回给调用方走 tail 注入，同时基线推进为新版本。
"""

from __future__ import annotations

from typing import Any, Dict, List

from .schema import now_iso, sha16


PROFILE_STATE_KEY = "profile_state"
PROFILE_EVENTS_KEY = "profile_events"
SKILL_STATE_KEY = "skill_state"
SKILL_EVENTS_KEY = "skill_events"

# 事件数量上限：画像/技能事件按轮产生，超限裁掉最旧事件，防止长会话文件无限膨胀。
# 被裁掉的变更已累积体现在基线中；历史回放只覆盖保留区间，与压缩换代（step 2）衔接。
MAX_TURN_EVENTS = 200


def _ensure_context(conversation_data: Dict[str, Any]) -> Dict[str, Any]:
    context = conversation_data.get("context")
    if not isinstance(context, dict):
        context = {}
        conversation_data["context"] = context
    return context


def _read_events(context: Dict[str, Any], key: str) -> List[Dict[str, Any]]:
    events = context.get(key)
    if not isinstance(events, list):
        events = []
        context[key] = events
    return events


def _append_event(context: Dict[str, Any], key: str, event: Dict[str, Any]) -> None:
    events = _read_events(context, key)
    events.append(event)

    if len(events) > MAX_TURN_EVENTS:
        events[:] = events[-MAX_TURN_EVENTS:]

    context[key] = events


def _resolve_effective_from_message(
    conversation_data: Dict[str, Any],
    effective_from_message: int | None,
) -> int:
    if effective_from_message is not None:
        return int(effective_from_message)

    messages = conversation_data.get("messages")
    if not isinstance(messages, list):
        messages = []
    return len(messages)


def record_profile_state(
    conversation_data: Dict[str, Any],
    profile_text: str,
    *,
    effective_from_message: int | None = None,
    emit_event: bool = True,
) -> Dict[str, Any] | None:
    """
    采样用户画像状态并做 diff，画像变更时返回 delta 并落事件。

    diff 规则：
    - 新旧一致 -> None（基线不动）
    - 新文本以旧文本为前缀 -> append（只发新增后缀，块最小）
    - 其余 -> overwrite（发完整新文本）
    emit_event=False 仅建立基线（首轮），不落事件、不返回 delta。
    """

    context = _ensure_context(conversation_data)
    text = str(profile_text or "").strip()

    state = context.get(PROFILE_STATE_KEY) if isinstance(context.get(PROFILE_STATE_KEY), dict) else {}
    old_text = str(state.get("text") or "")

    if text == old_text:
        return None

    if text.startswith(old_text):
        delta = {"mode": "append", "content": text[len(old_text):].strip()}
    else:
        delta = {"mode": "overwrite", "content": text}

    context[PROFILE_STATE_KEY] = {
        "hash": sha16(text),
        "text": text,
        "updated_at": now_iso(),
    }

    if emit_event:
        _append_event(context, PROFILE_EVENTS_KEY, {
            "mode": delta["mode"],
            "content": delta["content"],
            "effective_from_message": _resolve_effective_from_message(conversation_data, effective_from_message),
            "created_at": now_iso(),
        })
        conversation_data["updated_at"] = now_iso()
        return delta

    # 首轮样本：仅建立基线，不落事件也不返回 delta（相对空基线的全量没有注入意义）
    return None


def record_skill_state(
    conversation_data: Dict[str, Any],
    skill_samples: List[Dict[str, Any]],
    *,
    effective_from_message: int | None = None,
    emit_event: bool = True,
) -> Dict[str, Any] | None:
    """
    采样当前生效技能集合并做 diff，技能集合变化时返回 delta 并落事件。

    skill_samples 结构：[{"title": 唯一身份键, "prompt": 该技能的完整注入块文本}]
    diff 以 title 为键、prompt 哈希为版本：新增 / 文本变化 -> added（发全文），
    基线有而当前没有 -> removed（发标题）。
    """

    context = _ensure_context(conversation_data)

    current: Dict[str, Dict[str, str]] = {}
    for item in skill_samples or []:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        prompt = str(item.get("prompt") or "").strip()
        if title and prompt:
            current[title] = {"title": title, "prompt": prompt, "hash": sha16(prompt)}

    state = context.get(SKILL_STATE_KEY) if isinstance(context.get(SKILL_STATE_KEY), dict) else {}
    baseline: Dict[str, str] = {}
    for item in state.get("skills") or []:
        if isinstance(item, dict) and str(item.get("title") or "").strip():
            baseline[str(item.get("title")).strip()] = str(item.get("hash") or "")

    added = [
        {"title": item["title"], "prompt": item["prompt"]}
        for title, item in current.items()
        if baseline.get(title) != item["hash"]
    ]
    removed = [{"title": title} for title in baseline if title not in current]

    if not added and not removed:
        return None

    context[SKILL_STATE_KEY] = {
        "skills": [{"title": item["title"], "hash": item["hash"]} for item in current.values()],
        "updated_at": now_iso(),
    }

    delta = {"added": added, "removed": removed}

    if emit_event:
        _append_event(context, SKILL_EVENTS_KEY, {
            "added": added,
            "removed": removed,
            "effective_from_message": _resolve_effective_from_message(conversation_data, effective_from_message),
            "created_at": now_iso(),
        })
        conversation_data["updated_at"] = now_iso()
        return delta

    # 首轮样本：仅建立基线，不落事件也不返回 delta（相对空基线的全量没有注入意义）
    return None
