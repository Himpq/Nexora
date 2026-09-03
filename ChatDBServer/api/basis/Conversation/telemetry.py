"""
Nexora.basis.Conversation.telemetry — token / trace 调试数据

v4 中调试数据与可见消息分离：
- assistant.usage 仅保留精简 token 统计（input/output/raw_input/cached_input/effective_input）
- assistant.trace 保留结构化 tool_calls/tool_results/content_segments/errors
- 旧字段 reasoning_content / request_debug / io_tokens_cumulative / io_tokens_window 等
  在迁移时被有意丢弃，不进入 sidecar 存储（若需完整回放，可基于 trace 重建）
  迁移保证：可见消息 content 完全不丢失，调试数据仅保留精简后的 usage/trace

对外提供 projection：get_message_process_steps（将 trace 投影为旧 process_steps 供前端兼容）
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List


def build_trace_from_process_steps(process_steps: Any) -> Dict[str, Any]:
    """将旧 process_steps 转成 v4 trace，并保留完整有序事件。"""
    events: List[Dict[str, Any]] = []
    if isinstance(process_steps, list):
        for seq, raw_step in enumerate(process_steps, start=1):
            if not isinstance(raw_step, dict):
                continue
            event_type = str(raw_step.get("type") or "").strip()
            if not event_type:
                continue
            event = copy.deepcopy(raw_step)
            event["type"] = event_type
            event["seq"] = int(raw_step.get("seq") or seq)
            events.append(event)

    events.sort(key=lambda item: int(item.get("seq") or 0))
    trace: Dict[str, Any] = {
        "events": events,
        "tool_calls": [],
        "tool_results": [],
        "content_segments": [],
        "errors": [],
    }
    for event in events:
        event_type = event.get("type")
        if event_type == "function_call":
            trace["tool_calls"].append(copy.deepcopy(event))
        elif event_type == "function_result":
            trace["tool_results"].append(copy.deepcopy(event))
        elif event_type in {"content", "reasoning_content"}:
            trace["content_segments"].append(copy.deepcopy(event))
        elif event_type == "error":
            trace["errors"].append(copy.deepcopy(event))
    return trace


def extract_process_steps_from_trace(trace: Dict[str, Any]) -> List[Dict[str, Any]]:
    """将 v4 trace 投影为旧 process_steps 形态（供前端兼容）。"""
    if not isinstance(trace, dict):
        return []
    events = trace.get("events")
    if isinstance(events, list) and events:
        return [copy.deepcopy(item) for item in events if isinstance(item, dict)]
    steps: List[Dict[str, Any]] = []
    tool_calls = trace.get("tool_calls", []) if isinstance(trace.get("tool_calls"), list) else []
    tool_results = trace.get("tool_results", []) if isinstance(trace.get("tool_results"), list) else []
    content_segments = trace.get("content_segments", []) if isinstance(trace.get("content_segments"), list) else []
    errors = trace.get("errors", []) if isinstance(trace.get("errors"), list) else []

    for seg in content_segments:
        if isinstance(seg, dict):
            steps.append({"type": "content", "content": str(seg.get("content") or "")})
        elif isinstance(seg, str) and seg.strip():
            steps.append({"type": "content", "content": seg})

    for call in tool_calls:
        if not isinstance(call, dict):
            continue
        steps.append({
            "type": "function_call",
            "name": str(call.get("name") or ""),
            "arguments": call.get("arguments", "{}"),
            "call_id": str(call.get("call_id") or ""),
        })

    for result in tool_results:
        if not isinstance(result, dict):
            continue
        steps.append({
            "type": "function_result",
            "name": str(result.get("name") or ""),
            "result": result.get("result", ""),
            "model_visible_result": result.get("model_visible_result", ""),
            "display_result": result.get("display_result", result.get("display_model_visible_result", "")),
            "display_model_visible_result": result.get("display_model_visible_result", result.get("display_result", "")),
            "call_id": str(result.get("call_id") or ""),
            "success": bool(result.get("success", True)),
            "round": result.get("round"),
        })

    for err in errors:
        if isinstance(err, dict):
            steps.append({"type": "error", "content": str(err.get("message") or err.get("content") or "")})
        elif isinstance(err, str) and err.strip():
            steps.append({"type": "error", "content": err})

    return steps


def get_telemetry_for_message(conversation_data: Dict[str, Any], message_index: int) -> Dict[str, Any]:
    """返回指定 assistant 消息的 telemetry 投影（usage/trace/error）。"""
    messages = conversation_data.get("messages", []) if isinstance(conversation_data.get("messages"), list) else []
    try:
        idx = int(message_index)
    except Exception:
        return {}
    if not (0 <= idx < len(messages)):
        return {}
    msg = messages[idx] if isinstance(messages[idx], dict) else {}
    if str(msg.get("role") or "").strip() != "assistant":
        return {}
    return {
        "usage": dict(msg.get("usage", {})) if isinstance(msg.get("usage"), dict) else {},
        "trace": dict(msg.get("trace", {})) if isinstance(msg.get("trace"), dict) else {},
        "error": dict(msg.get("error", {})) if isinstance(msg.get("error"), dict) else {},
        "model": dict(msg.get("model", {})) if isinstance(msg.get("model"), dict) else {},
        "status": str(msg.get("status") or "completed"),
    }


def update_assistant_telemetry(
    conversation_data: Dict[str, Any],
    message_index: int,
    *,
    usage_patch: Dict[str, Any] | None = None,
    trace_patch: Dict[str, Any] | None = None,
    error_patch: Dict[str, Any] | None = None,
    status: str | None = None,
) -> Dict[str, Any]:
    """原子合并单条 assistant 的 telemetry 字段。"""
    messages = conversation_data.get("messages", []) if isinstance(conversation_data.get("messages"), list) else []
    try:
        idx = int(message_index)
    except Exception as error:
        raise ValueError(f"消息索引无效: {message_index}") from error
    if not (0 <= idx < len(messages)):
        raise ValueError(f"消息索引越界: index={idx}, message_count={len(messages)}")
    msg = messages[idx] if isinstance(messages[idx], dict) else {}
    if str(msg.get("role") or "").strip() != "assistant":
        raise ValueError("仅支持更新 assistant 消息的 telemetry")

    if usage_patch is not None:
        if not isinstance(usage_patch, dict):
            raise ValueError("usage_patch 必须是 dict")
        current = msg.get("usage", {}) if isinstance(msg.get("usage"), dict) else {}
        merged = dict(current)
        merged.update(usage_patch)
        msg["usage"] = merged

    if trace_patch is not None:
        if not isinstance(trace_patch, dict):
            raise ValueError("trace_patch 必须是 dict")
        current = msg.get("trace", {}) if isinstance(msg.get("trace"), dict) else {}
        merged = dict(current)
        for key, value in trace_patch.items():
            if isinstance(value, list) and isinstance(merged.get(key), list):
                merged[key] = list(merged.get(key)) + list(value)
            else:
                merged[key] = value
        msg["trace"] = merged

    if error_patch is not None:
        if not isinstance(error_patch, dict):
            raise ValueError("error_patch 必须是 dict")
        msg["error"] = dict(error_patch)

    if status is not None:
        msg["status"] = str(status).strip() or "completed"

    messages[idx] = msg
    conversation_data["messages"] = messages
    from datetime import datetime
    conversation_data["updated_at"] = datetime.now().isoformat()
    return dict(msg)
