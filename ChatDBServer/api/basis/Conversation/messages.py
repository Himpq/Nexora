"""
Nexora.basis.Conversation.messages — 消息、重答、删除、版本

核心原则：
- messages 仅包含 user / assistant，无 system/knowledge 混合
- 重答严格校验，不做 +-5 搜索，不做 fallback append
- versions 不递归嵌套，内部结构归一化
"""

from __future__ import annotations

import copy
from datetime import datetime
from typing import Any, Dict, List, Tuple

from App.Utils import sanitize_assistant_visible_content

from .errors import ConversationIndexError, ConversationTargetRoleError, ConversationValidationError
from .schema import normalize_assistant_message, normalize_user_message


def now_iso() -> str:
    return datetime.now().isoformat()


def _sanitize_visible(content: Any) -> str:
    return sanitize_assistant_visible_content(content)


def _assistant_process_steps_have_visible_output(metadata: Dict[str, Any]) -> bool:
    if not isinstance(metadata, dict):
        return False
    process_steps = metadata.get("process_steps", [])
    if not isinstance(process_steps, list):
        return False
    for step in process_steps:
        if not isinstance(step, dict):
            continue
        if str(step.get("type") or "").strip() not in {"", "reasoning_content"}:
            return True
    return False


def _assistant_variant_has_visible_output(content: Any, metadata: Dict[str, Any]) -> bool:
    visible = _sanitize_visible(content)
    return bool(str(visible or "").strip()) or _assistant_process_steps_have_visible_output(metadata)


def sanitize_versions(versions: Any) -> List[Dict[str, Any]]:
    if not isinstance(versions, list):
        return []
    cleaned: List[Dict[str, Any]] = []
    for version in versions:
        if not isinstance(version, dict):
            continue
        nv = dict(version)
        metadata = nv.get("metadata", {})
        if not isinstance(metadata, dict):
            metadata = {}
        nv["metadata"] = metadata
        nv["content"] = _sanitize_visible(nv.get("content", ""))
        if _assistant_variant_has_visible_output(nv.get("content", ""), metadata):
            cleaned.append(nv)
    return cleaned


def append_user_message(
    conversation_data: Dict[str, Any],
    content: Any,
    *,
    attachments: List[Any] | None = None,
) -> int:
    messages: List[Dict[str, Any]] = conversation_data.get("messages", [])
    if not isinstance(messages, list):
        messages = []
        conversation_data["messages"] = messages
    raw_content = str(content or "") if isinstance(content, str) else content
    # 剥离旧 [TIME] 前缀
    if isinstance(raw_content, str) and raw_content.lstrip().startswith(("[TIME]", "[历史消息时间:")):
        first_nl = raw_content.lstrip().find("\n")
        if first_nl >= 0:
            raw_content = raw_content.lstrip()[first_nl + 1:].lstrip()
        else:
            raw_content = ""
    msg = normalize_user_message({
        "role": "user",
        "content": raw_content,
        "timestamp": now_iso(),
        "attachments": list(attachments or []),
    })
    messages.append(msg)
    conversation_data["messages"] = messages
    conversation_data["updated_at"] = now_iso()
    return len(messages) - 1


def append_assistant_message(
    conversation_data: Dict[str, Any],
    payload: Dict[str, Any],
) -> int:
    messages: List[Dict[str, Any]] = conversation_data.get("messages", [])
    if not isinstance(messages, list):
        messages = []
        conversation_data["messages"] = messages
    if not isinstance(payload, dict):
        raise ConversationValidationError("assistant payload 必须是 dict")
    payload = dict(payload)
    if "role" not in payload:
        payload["role"] = "assistant"
    if str(payload.get("role") or "").strip() != "assistant":
        raise ConversationValidationError("仅支持追加 assistant 消息")
    if "content" in payload:
        payload["content"] = _sanitize_visible(payload.get("content", ""))
    if "timestamp" not in payload or not str(payload.get("timestamp") or "").strip():
        payload["timestamp"] = now_iso()
    normalized = normalize_assistant_message(payload)
    messages.append(normalized)
    conversation_data["messages"] = messages
    conversation_data["updated_at"] = now_iso()
    return len(messages) - 1


def resolve_regenerate_target(
    conversation_data: Dict[str, Any],
    message_index: int,
) -> Dict[str, Any]:
    """严格校验重答目标：必须是 assistant，且前一条是触发它的 user。"""
    try:
        idx = int(message_index)
    except Exception as error:
        raise ConversationIndexError(f"消息索引无效: {message_index}") from error

    messages = conversation_data.get("messages", [])
    if not isinstance(messages, list):
        raise ConversationValidationError("对话内容格式无效")

    if idx < 0 or idx >= len(messages):
        raise ConversationIndexError(
            f"消息索引越界: index={idx}, message_count={len(messages)}",
            details={"message_count": len(messages), "target_index": idx},
        )

    target = messages[idx] if isinstance(messages[idx], dict) else {}
    target_role = str(target.get("role") or "").strip()

    if target_role != "assistant":
        raise ConversationTargetRoleError(
            "重答目标必须是 assistant 消息",
            details={
                "message_count": len(messages),
                "target_role": target_role,
                "target_index": idx,
            },
        )

    # 找紧邻的前一条 user（v4 中无 system 夹在中间，无需跳过）
    user_index = idx - 1
    if user_index < 0:
        raise ConversationTargetRoleError(
            "重答目标前缺少 user 消息",
            details={"message_count": len(messages), "target_index": idx},
        )
    source = messages[user_index] if isinstance(messages[user_index], dict) else {}
    source_role = str(source.get("role") or "").strip()
    if source_role != "user":
        raise ConversationTargetRoleError(
            "重答目标前一条不是 user 消息",
            details={
                "message_count": len(messages),
                "target_index": idx,
                "source_role": source_role,
            },
        )

    return {
        "message_count": len(messages),
        "target_index": idx,
        "user_index": user_index,
        "user_content": source.get("content", ""),
        "assistant_model_name": str(
            (target.get("model") or {}).get("name") if isinstance(target.get("model"), dict) else ""
        ).strip(),
    }


def replace_assistant_message(
    conversation_data: Dict[str, Any],
    message_index: int,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """严格覆盖指定 assistant 位置；旧回答进入 versions。"""
    target_info = resolve_regenerate_target(conversation_data, message_index)
    idx = int(target_info["target_index"])
    messages: List[Dict[str, Any]] = conversation_data.get("messages", [])
    old_msg = messages[idx] if isinstance(messages[idx], dict) else {}

    # 旧版本归档
    old_versions = sanitize_versions(old_msg.get("versions", []))
    # 兼容旧结构：metadata.versions
    old_metadata = old_msg.get("metadata", {}) if isinstance(old_msg.get("metadata"), dict) else {}
    if isinstance(old_metadata.get("versions"), list):
        old_versions = sanitize_versions(old_metadata.get("versions"))

    new_payload = dict(payload or {})
    new_payload["role"] = "assistant"
    if "content" in new_payload:
        new_payload["content"] = _sanitize_visible(new_payload.get("content", ""))
    if "timestamp" not in new_payload or not str(new_payload.get("timestamp") or "").strip():
        new_payload["timestamp"] = now_iso()

    # 将旧回答作为版本保存
    prev_variant: Dict[str, Any] = {
        "content": _sanitize_visible(old_msg.get("content", "")),
        "timestamp": str(old_msg.get("timestamp") or ""),
        "model": dict(old_msg.get("model") or {}),
        "summary": str(old_msg.get("summary") or ""),
        "usage": dict(old_msg.get("usage") or {}),
        "trace": dict(old_msg.get("trace") or {}),
    }
    if old_msg.get("error"):
        prev_variant["error"] = dict(old_msg.get("error"))

    has_visible = bool(str(prev_variant.get("content") or "").strip())
    # trace 中有可见 tool 调用也视为有意义
    if not has_visible:
        trace = prev_variant.get("trace", {})
        if isinstance(trace, dict) and (trace.get("tool_calls") or trace.get("tool_results")):
            has_visible = True

    # 归一化新消息
    normalized = normalize_assistant_message(new_payload)
    # 合并版本链
    existing_versions = list(normalized.get("versions", []))
    # 去重：若旧版本已在链中则不重复
    if has_visible:
        exists = any(
            isinstance(v, dict)
            and str(v.get("timestamp") or "") == str(prev_variant.get("timestamp") or "")
            and str(v.get("content") or "") == str(prev_variant.get("content") or "")
            for v in existing_versions
        )
        if not exists:
            # 若新 payload 自带 versions，则追加
            combined = list(old_versions) + existing_versions
            # 去重 old_versions vs existing
            merged: List[Dict[str, Any]] = []
            seen = set()
            for v in combined:
                key = (str(v.get("timestamp") or ""), str(v.get("content") or "")[:200])
                if key in seen:
                    continue
                seen.add(key)
                merged.append(v)
            merged.append(prev_variant)
            normalized["versions"] = merged
        else:
            normalized["versions"] = list(old_versions) + existing_versions
    else:
        normalized["versions"] = list(old_versions) + existing_versions

    # 清理可能从旧 metadata 透传的 versions 嵌套
    normalized["versions"] = [dict(v) for v in normalized.get("versions", []) if isinstance(v, dict)]

    # 空结果禁止覆盖旧回复：新内容无可见文本、无工具调用、无错误时，
    # 不得覆盖已有可见旧回复（330 号对话曾被空 partial 覆盖丢失 eSIM 回复）。
    new_visible = str(normalized.get("content") or "").strip()

    new_trace = normalized.get("trace") if isinstance(normalized.get("trace"), dict) else {}

    new_has_tools = bool(
        isinstance(new_trace, dict)
        and (new_trace.get("tool_calls") or new_trace.get("tool_results"))
    )

    new_has_error = bool(normalized.get("error"))

    if not new_visible and not new_has_tools and not new_has_error and has_visible:
        raise ConversationValidationError(
            f"空结果不得覆盖已有回复: index={idx}",
            details={"index": idx},
        )

    messages[idx] = normalized
    conversation_data["messages"] = messages
    conversation_data["updated_at"] = now_iso()
    # 清理 resume
    _invalidate_resume(conversation_data)
    return target_info


def delete_turn(
    conversation_data: Dict[str, Any],
    message_index: int,
) -> Tuple[int, int]:
    """按可见轮次删除：user→删除 user+后继 assistant；assistant→删除前驱 user+assistant。"""
    try:
        idx = int(message_index)
    except Exception as error:
        raise ConversationIndexError(f"消息索引无效: {message_index}") from error

    messages = conversation_data.get("messages", [])
    if not isinstance(messages, list):
        raise ConversationValidationError("对话内容格式无效")
    if idx < 0 or idx >= len(messages):
        raise ConversationIndexError(
            f"消息索引越界: index={idx}, message_count={len(messages)}",
            details={"message_count": len(messages)},
        )

    role = str((messages[idx] or {}).get("role") or "").strip() if isinstance(messages[idx], dict) else ""
    start = idx
    end = idx

    if role == "user":
        if idx + 1 < len(messages):
            next_role = str((messages[idx + 1] or {}).get("role") or "").strip() if isinstance(messages[idx + 1], dict) else ""
            if next_role == "assistant":
                end = idx + 1
    elif role == "assistant":
        if idx - 1 >= 0:
            prev_role = str((messages[idx - 1] or {}).get("role") or "").strip() if isinstance(messages[idx - 1], dict) else ""
            if prev_role == "user":
                start = idx - 1
    else:
        raise ConversationValidationError(f"不支持删除该类型消息: role={role!r}")

    del messages[start : end + 1]
    conversation_data["messages"] = messages
    conversation_data["updated_at"] = now_iso()
    _invalidate_resume(conversation_data)
    return start, end


def edit_user_message(
    conversation_data: Dict[str, Any],
    message_index: int,
    content: Any,
) -> None:
    try:
        idx = int(message_index)
    except Exception as error:
        raise ConversationIndexError(f"消息索引无效: {message_index}") from error

    text = str(content or "").strip()
    if not text:
        raise ConversationValidationError("消息内容不能为空")

    messages = conversation_data.get("messages", [])
    if not isinstance(messages, list):
        raise ConversationValidationError("对话内容格式无效")
    if not (0 <= idx < len(messages)):
        raise ConversationIndexError(f"消息不存在: index={idx}")

    msg = messages[idx] if isinstance(messages[idx], dict) else {}
    role = str(msg.get("role") or "").strip()
    if role != "user":
        raise ConversationValidationError("仅支持修改用户消息")

    msg["content"] = text
    msg["timestamp"] = now_iso()
    messages[idx] = msg
    conversation_data["messages"] = messages
    conversation_data["updated_at"] = now_iso()
    _invalidate_resume(conversation_data)


def save_message_version(
    conversation_data: Dict[str, Any],
    message_index: int,
) -> None:
    try:
        idx = int(message_index)
    except Exception as error:
        raise ConversationIndexError(f"消息索引无效: {message_index}") from error

    messages = conversation_data.get("messages", [])
    if not isinstance(messages, list):
        raise ConversationValidationError("对话内容格式无效")
    if not (0 <= idx < len(messages)):
        raise ConversationIndexError(f"消息不存在: index={idx}")

    msg = messages[idx] if isinstance(messages[idx], dict) else {}
    if str(msg.get("role") or "").strip() != "assistant":
        raise ConversationValidationError("仅支持保存 assistant 版本")

    versions = sanitize_versions(msg.get("versions", []))
    # 也兼容 metadata.versions
    metadata = msg.get("metadata", {}) if isinstance(msg.get("metadata"), dict) else {}
    if isinstance(metadata.get("versions"), list):
        versions = sanitize_versions(metadata.get("versions"))

    version_data: Dict[str, Any] = {
        "content": _sanitize_visible(msg.get("content", "")),
        "timestamp": str(msg.get("timestamp") or ""),
        "model": dict(msg.get("model") or {}),
        "summary": str(msg.get("summary") or ""),
        "usage": dict(msg.get("usage") or {}),
        "trace": dict(msg.get("trace") or {}),
    }
    if msg.get("error"):
        version_data["error"] = dict(msg.get("error"))

    has_visible = bool(str(version_data.get("content") or "").strip())
    if not has_visible and isinstance(version_data.get("trace"), dict):
        trace = version_data.get("trace", {})
        if trace.get("tool_calls") or trace.get("tool_results"):
            has_visible = True

    if has_visible:
        exists = any(
            isinstance(v, dict)
            and str(v.get("timestamp") or "") == str(version_data.get("timestamp") or "")
            and str(v.get("content") or "") == str(version_data.get("content") or "")
            for v in versions
        )
        if not exists:
            versions.append(version_data)

    msg["versions"] = versions
    # 清理旧 metadata.versions 残留
    if isinstance(msg.get("metadata"), dict) and "versions" in msg["metadata"]:
        del msg["metadata"]["versions"]
    messages[idx] = msg
    conversation_data["messages"] = messages
    conversation_data["updated_at"] = now_iso()


def switch_message_version(
    conversation_data: Dict[str, Any],
    message_index: int,
    version_index: int,
) -> None:
    try:
        idx = int(message_index)
        v_idx = int(version_index)
    except Exception as error:
        raise ConversationIndexError(f"索引无效: message_index={message_index}, version_index={version_index}") from error

    messages = conversation_data.get("messages", [])
    if not isinstance(messages, list):
        raise ConversationValidationError("对话内容格式无效")
    if not (0 <= idx < len(messages)):
        raise ConversationIndexError(f"消息不存在: index={idx}")

    msg = messages[idx] if isinstance(messages[idx], dict) else {}
    if str(msg.get("role") or "").strip() != "assistant":
        raise ConversationValidationError("仅支持切换 assistant 版本")

    versions = msg.get("versions", [])
    if not isinstance(versions, list):
        versions = []

    # all_variants = versions + [current]
    current_variant: Dict[str, Any] = {
        "content": _sanitize_visible(msg.get("content", "")),
        "timestamp": str(msg.get("timestamp") or ""),
        "model": dict(msg.get("model") or {}),
        "summary": str(msg.get("summary") or ""),
        "usage": dict(msg.get("usage") or {}),
        "trace": dict(msg.get("trace") or {}),
    }
    if msg.get("error"):
        current_variant["error"] = dict(msg.get("error"))

    all_variants: List[Dict[str, Any]] = []
    for v in versions:
        if isinstance(v, dict):
            all_variants.append(dict(v))
    all_variants.append(current_variant)

    if not (0 <= v_idx < len(all_variants)):
        raise ConversationIndexError(
            f"版本索引越界: version_index={v_idx}, version_count={len(all_variants)}",
            details={"version_count": len(all_variants)},
        )

    target = all_variants[v_idx]

    # 应用 target 到 msg
    msg["content"] = _sanitize_visible(target.get("content", ""))
    msg["timestamp"] = str(target.get("timestamp") or now_iso())
    if target.get("model"):
        msg["model"] = dict(target.get("model"))
    if "summary" in target:
        msg["summary"] = str(target.get("summary") or "")
    if target.get("usage"):
        msg["usage"] = dict(target.get("usage"))
    if target.get("trace"):
        msg["trace"] = dict(target.get("trace"))
    if target.get("error"):
        msg["error"] = dict(target.get("error"))
    elif "error" in msg:
        del msg["error"]

    # 保留其余变体
    kept: List[Dict[str, Any]] = []
    for i, variant in enumerate(all_variants):
        if i == v_idx or not isinstance(variant, dict):
            continue
        cleaned = dict(variant)
        if isinstance(cleaned.get("metadata"), dict) and "versions" in cleaned["metadata"]:
            cleaned["metadata"] = {k: v for k, v in cleaned["metadata"].items() if k != "versions"}
        kept.append(cleaned)

    msg["versions"] = kept
    # 清理旧 metadata.versions 残留
    if isinstance(msg.get("metadata"), dict) and "versions" in msg["metadata"]:
        del msg["metadata"]["versions"]
    messages[idx] = msg
    conversation_data["messages"] = messages
    conversation_data["updated_at"] = now_iso()
    _invalidate_resume(conversation_data)


def _invalidate_resume(conversation_data: Dict[str, Any]) -> None:
    if not isinstance(conversation_data, dict):
        return
    runtime = conversation_data.get("runtime")
    if isinstance(runtime, dict) and "resume" in runtime:
        runtime["resume"] = None
    # 兼容旧字段
    for key in ("last_volc_response_id", "last_model_used"):
        if key in conversation_data:
            try:
                del conversation_data[key]
            except Exception:
                conversation_data[key] = None
