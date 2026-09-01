"""
Nexora.basis.Conversation.schema — v4 schema 定义、归一化与校验

v4 核心约束：
- messages 仅包含 role=user / assistant
- system_snapshot / knowledge_diff / context_compression 全部移入 context
- scope 统一承载 workspace 归属与 learning 标记
- 不允许任意 metadata 大杂烩，assistant 字段白名单见 ALLOWED_ASSISTANT_FIELDS
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from datetime import datetime
from typing import Any, Dict, List, Tuple

from .errors import ConversationValidationError
from .telemetry import build_trace_from_process_steps, extract_process_steps_from_trace

SCHEMA_VERSION = 4

ALLOWED_USER_FIELDS = {"role", "content", "timestamp", "attachments"}
ALLOWED_ASSISTANT_FIELDS = {
    "role",
    "content",
    "timestamp",
    "status",
    "model",
    "summary",
    "usage",
    "trace",
    "error",
    "versions",
    "attachments",
    "memory_analysis",
    "memory_io_tokens",
}

ASSISTANT_STATUS_VALUES = {"completed", "partial", "error", "streaming"}

# context 中由本模块托管结构的字段；其余字段属于调用方扩展，归一化时必须原样透传
CONTEXT_MANAGED_KEYS = frozenset({
    "system_snapshots",
    "knowledge",
    "knowledge_events",
    "compressions",
    "legacy_events",
})


def now_iso() -> str:
    return datetime.now().isoformat()


def sha16(text: str) -> str:
    return hashlib.sha256(str(text or "").encode("utf-8")).hexdigest()[:16]


def _coerce_str(value: Any) -> str:
    return str(value or "").strip()


def normalize_scope(raw: Any) -> Dict[str, Any]:
    """归一化 scope；不复制 Workspace 内容，仅保存归属。"""
    scope: Dict[str, Any] = {
        "workspace_id": "",
        "learning": {
            "enabled": False,
            "lecture_id": "",
            "course_id": "",
            "course_title": "",
        },
        "tags": [],
    }
    if not isinstance(raw, dict):
        return scope

    wid = _coerce_str(raw.get("workspace_id"))
    if wid:
        scope["workspace_id"] = wid

    learning = raw.get("learning") if isinstance(raw.get("learning"), dict) else {}
    enabled = bool(learning.get("enabled", False))
    # tags 中若含 learning 则同样视为启用
    tags_raw = raw.get("tags", [])
    tags: List[str] = []
    if isinstance(tags_raw, list):
        for item in tags_raw:
            tag = _coerce_str(item).lower()
            if tag and tag not in tags:
                tags.append(tag)
                if tag == "learning":
                    enabled = True
    scope["tags"] = tags

    scope["learning"]["enabled"] = bool(enabled)
    scope["learning"]["lecture_id"] = _coerce_str(learning.get("lecture_id"))
    scope["learning"]["course_id"] = _coerce_str(learning.get("course_id"))
    scope["learning"]["course_title"] = _coerce_str(learning.get("course_title"))

    return scope


def normalize_model(raw: Any) -> Dict[str, str]:
    if not isinstance(raw, dict):
        return {"name": "", "provider": ""}
    return {
        "name": _coerce_str(raw.get("name") or raw.get("model_name")),
        "provider": _coerce_str(raw.get("provider")),
    }


def normalize_usage(raw: Any) -> Dict[str, int]:
    if not isinstance(raw, dict):
        return {"input": 0, "output": 0, "raw_input": 0, "cached_input": 0, "effective_input": 0}
    def _int(key: str) -> int:
        try:
            return int(raw.get(key) or 0)
        except Exception:
            return 0
    return {
        "input": _int("input"),
        "output": _int("output"),
        "raw_input": _int("raw_input"),
        "cached_input": _int("cached_input"),
        "effective_input": _int("effective_input"),
    }


def normalize_trace(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        return {"events": [], "tool_calls": [], "tool_results": [], "content_segments": [], "errors": []}
    def _list(key: str) -> List[Any]:
        value = raw.get(key)
        return list(value) if isinstance(value, list) else []
    return {
        "events": _list("events"),
        "tool_calls": _list("tool_calls"),
        "tool_results": _list("tool_results"),
        "content_segments": _list("content_segments"),
        "errors": _list("errors"),
    }


def normalize_user_message(raw: Dict[str, Any]) -> Dict[str, Any]:
    content = raw.get("content", "")
    # content 允许 str / list(多模态) / dict
    timestamp = _coerce_str(raw.get("timestamp")) or now_iso()
    attachments = raw.get("attachments") if isinstance(raw.get("attachments"), list) else []
    msg: Dict[str, Any] = {
        "role": "user",
        "content": content,
        "timestamp": timestamp,
        "attachments": list(attachments),
    }
    # 去除非白名单字段
    return msg


def _normalize_legacy_version(raw_version: Dict[str, Any]) -> Dict[str, Any]:
    """将旧格式 version（content/metadata/process_steps）转为 v4 version。"""
    if not isinstance(raw_version, dict):
        return {}
    # 若已是 v4 形态（有 model/trace 且无 metadata.process_steps），直接补全
    has_legacy = False
    meta = raw_version.get("metadata") if isinstance(raw_version.get("metadata"), dict) else None
    # v4 版本不应包含 metadata；任何 metadata 非空即视为旧格式
    if isinstance(meta, dict) and meta:
        has_legacy = True
    if "process_steps" in raw_version or "model_name" in raw_version or "exchange_summary" in raw_version:
        has_legacy = True
    if not has_legacy and isinstance(raw_version.get("model"), dict) and isinstance(raw_version.get("trace"), dict):
        # 已是 v4，清理嵌套 versions 并补全字段
        out = dict(raw_version)
        if isinstance(out.get("metadata"), dict) and "versions" in out["metadata"]:
            out["metadata"] = {k: v for k, v in out["metadata"].items() if k != "versions"}
            if not out["metadata"]:
                del out["metadata"]
        # 确保必要字段存在
        out["content"] = raw_version.get("content", "")
        out["timestamp"] = _coerce_str(raw_version.get("timestamp")) or now_iso()
        out["model"] = normalize_model(raw_version.get("model"))
        out["summary"] = _coerce_str(raw_version.get("summary"))
        out["usage"] = normalize_usage(raw_version.get("usage"))
        out["trace"] = normalize_trace(raw_version.get("trace"))
        # 去除多余字段
        for k in ("metadata", "process_steps", "model_name", "exchange_summary", "io_tokens"):
            if k in out and k not in ("content", "timestamp", "model", "summary", "usage", "trace", "error", "versions"):
                # 仅保留 v4 允许的扩展，metadata 若非空则保留但清理
                pass
        # 若残留 metadata 且为空则删除
        if "metadata" in out and not out["metadata"]:
            del out["metadata"]
        # 清理非法顶层字段
        allowed_v_keys = {"content", "timestamp", "model", "summary", "usage", "trace", "error", "versions", "metadata"}
        out = {k: v for k, v in out.items() if k in allowed_v_keys}
        return out

    # 旧格式转换
    content = raw_version.get("content", "")
    timestamp = _coerce_str(raw_version.get("timestamp")) or now_iso()
    # 兼容部分旧 version 直接存 content 为字符串且有 metadata
    metadata = raw_version.get("metadata", {}) if isinstance(raw_version.get("metadata"), dict) else {}
    # model
    model_name = _coerce_str(raw_version.get("model_name") or metadata.get("model_name"))
    provider = _coerce_str(metadata.get("provider"))
    model = {"name": model_name, "provider": provider}
    # summary
    summary = _coerce_str(raw_version.get("exchange_summary") or raw_version.get("summary") or metadata.get("exchange_summary") or metadata.get("summary"))
    # usage
    usage = {}
    io_tokens = metadata.get("io_tokens") if isinstance(metadata.get("io_tokens"), dict) else None
    if isinstance(io_tokens, dict):
        usage = {"input": int(io_tokens.get("input") or 0), "output": int(io_tokens.get("output") or 0), "raw_input": int(io_tokens.get("raw_input") or 0), "cached_input": int(io_tokens.get("cached_input") or 0), "effective_input": int(io_tokens.get("effective_input") or 0)}
    # trace
    process_steps = metadata.get("process_steps") if isinstance(metadata.get("process_steps"), list) else []
    if not process_steps and isinstance(raw_version.get("process_steps"), list):
        process_steps = raw_version.get("process_steps", [])
    trace = build_trace_from_process_steps(process_steps)
    error: Dict[str, Any] = {}
    if "terminal_error" in metadata:
        error = {"message": _coerce_str(metadata.get("terminal_error"))}
    elif isinstance(metadata.get("error"), dict):
        error = dict(metadata.get("error"))
    elif isinstance(raw_version.get("error"), dict):
        error = dict(raw_version.get("error"))

    out: Dict[str, Any] = {
        "content": content,
        "timestamp": timestamp,
        "model": normalize_model(model),
        "summary": summary,
        "usage": normalize_usage(usage),
        "trace": normalize_trace(trace),
    }
    if error:
        out["error"] = error
    return out


def normalize_assistant_message(raw: Dict[str, Any]) -> Dict[str, Any]:
    content = raw.get("content", "")
    timestamp = _coerce_str(raw.get("timestamp")) or now_iso()
    status = _coerce_str(raw.get("status") or "completed").lower()
    if status not in ASSISTANT_STATUS_VALUES:
        status = "completed"
    model = normalize_model(raw.get("model"))
    # 兼容旧字段：若 model 为空但 metadata/model_name 存在
    if not model.get("name"):
        meta = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
        if isinstance(meta, dict):
            legacy_name = _coerce_str(meta.get("model_name") or raw.get("model_name"))
            if legacy_name:
                model = {"name": legacy_name, "provider": _coerce_str(meta.get("provider"))}
    summary = _coerce_str(raw.get("summary") or raw.get("exchange_summary"))
    if not summary:
        meta = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
        if isinstance(meta, dict):
            summary = _coerce_str(meta.get("exchange_summary") or meta.get("summary"))
    usage = normalize_usage(raw.get("usage"))
    if not usage.get("input") and not usage.get("output"):
        meta = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
        if isinstance(meta, dict) and isinstance(meta.get("io_tokens"), dict):
            io = meta.get("io_tokens", {})
            usage = {"input": int(io.get("input") or 0), "output": int(io.get("output") or 0), "raw_input": int(io.get("raw_input") or 0), "cached_input": int(io.get("cached_input") or 0), "effective_input": int(io.get("effective_input") or 0)}
    trace = normalize_trace(raw.get("trace"))
    if not trace.get("events") and any(trace.get(key) for key in ("tool_calls", "tool_results", "content_segments", "errors")):
        trace = build_trace_from_process_steps(extract_process_steps_from_trace(trace))
    # 兼容旧 process_steps -> trace
    if not trace.get("events") and not trace.get("tool_calls") and not trace.get("tool_results") and not trace.get("content_segments"):
        meta = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
        if isinstance(meta, dict) and isinstance(meta.get("process_steps"), list):
            trace = build_trace_from_process_steps(meta.get("process_steps"))
    error = raw.get("error") if isinstance(raw.get("error"), dict) else {}
    if not error:
        meta = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
        if isinstance(meta, dict) and "terminal_error" in meta:
            error = {"message": _coerce_str(meta.get("terminal_error"))}
    versions = raw.get("versions") if isinstance(raw.get("versions"), list) else []
    # 兼容旧 metadata.versions
    if not versions:
        meta = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
        if isinstance(meta, dict) and isinstance(meta.get("versions"), list):
            versions = meta.get("versions", [])
    # 清洗 versions 内部结构（去递归嵌套 + 旧格式转 v4）
    cleaned_versions: List[Dict[str, Any]] = []
    for version in versions:
        if not isinstance(version, dict):
            continue
        normalized = _normalize_legacy_version(version)
        # 去除空
        if not normalized.get("content") and not normalized.get("trace", {}).get("tool_calls"):
            # 但保留至少有时间戳的版本
            if not str(normalized.get("timestamp") or "").strip():
                continue
        cleaned_versions.append(normalized)

    msg: Dict[str, Any] = {
        "role": "assistant",
        "content": content if isinstance(content, (str, list, dict)) else str(content),
        "timestamp": timestamp,
        "status": status,
        "model": model,
        "summary": summary,
        "usage": usage,
        "trace": trace,
        "versions": cleaned_versions,
    }
    if error:
        msg["error"] = dict(error)
    attachments = raw.get("attachments") if isinstance(raw.get("attachments"), list) else None
    if attachments is not None:
        msg["attachments"] = list(attachments)
    # Memory 分析扩展（v4 明确字段，避免 normalize 丢失）
    mem_analysis = raw.get("memory_analysis")
    if isinstance(mem_analysis, dict) and mem_analysis:
        msg["memory_analysis"] = dict(mem_analysis)
    mem_tokens = raw.get("memory_io_tokens")
    if isinstance(mem_tokens, dict) and mem_tokens:
        msg["memory_io_tokens"] = dict(mem_tokens)
    # 向后兼容：trace.extensions.memory_analysis
    trace_ext = msg.get("trace", {}) if isinstance(msg.get("trace"), dict) else {}
    if isinstance(trace_ext, dict) and isinstance(trace_ext.get("extensions"), dict):
        ext_mem = trace_ext["extensions"].get("memory_analysis")
        if isinstance(ext_mem, dict) and ext_mem and "memory_analysis" not in msg:
            msg["memory_analysis"] = dict(ext_mem)
    return msg


def normalize_context(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raw = {}
    system_snapshots = raw.get("system_snapshots") if isinstance(raw.get("system_snapshots"), list) else []
    knowledge = raw.get("knowledge") if isinstance(raw.get("knowledge"), dict) else {}
    knowledge_events = raw.get("knowledge_events") if isinstance(raw.get("knowledge_events"), list) else []
    compressions = raw.get("compressions") if isinstance(raw.get("compressions"), list) else []
    legacy_events = raw.get("legacy_events") if isinstance(raw.get("legacy_events"), list) else []

    # 规范化 knowledge
    workspace = knowledge.get("workspace") if isinstance(knowledge.get("workspace"), dict) else {}
    global_knowledge = knowledge.get("global") if isinstance(knowledge.get("global"), dict) else {}
    normalized_knowledge = {
        "workspace": {
            "hash": _coerce_str(workspace.get("hash")),
            "documents": list(workspace.get("documents", [])) if isinstance(workspace.get("documents"), list) else [],
        },
        "global": {
            "hash": _coerce_str(global_knowledge.get("hash")),
            "titles": list(global_knowledge.get("titles", [])) if isinstance(global_knowledge.get("titles"), list) else [],
        },
    }

    # 规范化 system_snapshots
    normalized_snapshots: List[Dict[str, Any]] = []
    for item in system_snapshots:
        if not isinstance(item, dict):
            continue
        normalized_snapshots.append({
            "epoch": int(item.get("epoch") or 0),
            "hash": _coerce_str(item.get("hash")),
            "content": str(item.get("content") or ""),
            "effective_from_message": int(item.get("effective_from_message") or 0),
            "reason": _coerce_str(item.get("reason") or "chat_turn"),
        })

    normalized: Dict[str, Any] = {
        "system_snapshots": normalized_snapshots,
        "knowledge": normalized_knowledge,
        "knowledge_events": [dict(e) for e in knowledge_events if isinstance(e, dict)],
        "compressions": [dict(c) for c in compressions if isinstance(c, dict)],
        "legacy_events": [dict(e) for e in legacy_events if isinstance(e, dict)],
    }

    # 扩展字段透传：context 允许调用方存放自定义状态，其结构由写入方自行保证。
    # 归一化只收敛托管字段，不得丢弃扩展字段（存量的 base_knowledge_titles 等旧字段
    # 一并保留），否则「写入保留、读取丢弃」会让依赖它的增量逻辑永远读不到基线。
    for key, value in raw.items():
        if key not in CONTEXT_MANAGED_KEYS:
            normalized[key] = copy.deepcopy(value)

    return normalized


def build_v4_skeleton(
    conversation_id: str,
    title: str = "新对话",
    scope: Dict[str, Any] | None = None,
    created_at: str | None = None,
    updated_at: str | None = None,
) -> Dict[str, Any]:
    cid = _coerce_str(conversation_id)
    if not cid:
        raise ConversationValidationError("conversation_id 不能为空")
    now = now_iso()
    return {
        "schema_version": SCHEMA_VERSION,
        "conversation_id": cid,
        "title": _coerce_str(title) or "新对话",
        "created_at": created_at or now,
        "updated_at": updated_at or now,
        "pin": False,
        "scope": normalize_scope(scope),
        "messages": [],
        "context": normalize_context({}),
        "branch": None,
        "runtime": {"resume": None},
    }


def validate_v4_conversation(data: Dict[str, Any]) -> None:
    if not isinstance(data, dict):
        raise ConversationValidationError("conversation 必须是 dict")
    if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
        raise ConversationValidationError(f"schema_version 必须为 {SCHEMA_VERSION}")
    if not _coerce_str(data.get("conversation_id")):
        raise ConversationValidationError("conversation_id 不能为空")
    messages = data.get("messages")
    if not isinstance(messages, list):
        raise ConversationValidationError("messages 必须是 list")
    for idx, msg in enumerate(messages):
        if not isinstance(msg, dict):
            raise ConversationValidationError(f"messages[{idx}] 必须是 dict")
        role = _coerce_str(msg.get("role"))
        if role not in {"user", "assistant"}:
            raise ConversationValidationError(f"messages[{idx}].role 非法: {role!r}")
        if role == "user" and not isinstance(msg.get("attachments", []), list):
            raise ConversationValidationError(f"messages[{idx}].attachments 必须是 list")
    scope = data.get("scope")
    if not isinstance(scope, dict):
        raise ConversationValidationError("scope 必须是 dict")
    context = data.get("context")
    if not isinstance(context, dict):
        raise ConversationValidationError("context 必须是 dict")
    # puzzle_states 严格校验（明确扩展）
    if "puzzle_states" in data and data.get("puzzle_states") is not None:
        ps = data.get("puzzle_states")
        if not isinstance(ps, dict):
            raise ConversationValidationError("puzzle_states 必须是 dict")
        if len(ps) > 50:
            raise ConversationValidationError("puzzle_states 超过上限 50")
        for pid, state in ps.items():
            if not isinstance(state, dict):
                raise ConversationValidationError(f"puzzle_states[{pid!r}] 必须是 dict")
            from .puzzle import validate_state as _validate_puzzle_state
            try:
                _validate_puzzle_state(state)
            except ConversationValidationError as e:
                raise ConversationValidationError(f"puzzle_states[{pid!r}] 校验失败: {e}") from e


def normalize_v4_conversation(data: Dict[str, Any]) -> Dict[str, Any]:
    """对已是 v4 的数据做幂等归一化（不改变语义）。"""
    out = copy.deepcopy(data)
    out["schema_version"] = SCHEMA_VERSION
    out["conversation_id"] = _coerce_str(out.get("conversation_id"))
    out["title"] = _coerce_str(out.get("title") or "新对话") or "新对话"
    out["pin"] = bool(out.get("pin", False))
    out["scope"] = normalize_scope(out.get("scope"))
    raw_messages = out.get("messages", [])
    if not isinstance(raw_messages, list):
        raw_messages = []
    normalized_messages: List[Dict[str, Any]] = []
    for idx, msg in enumerate(raw_messages):
        if not isinstance(msg, dict):
            raise ConversationValidationError(f"messages[{idx}] 必须是 dict")
        role = _coerce_str(msg.get("role"))
        if role == "user":
            normalized_messages.append(normalize_user_message(msg))
        elif role == "assistant":
            normalized_messages.append(normalize_assistant_message(msg))
        else:
            raise ConversationValidationError(
                f"messages[{idx}].role 非法: {role!r} (conversation_id={out.get('conversation_id')!r})",
                conversation_id=str(out.get("conversation_id") or ""),
                details={"index": idx, "role": role},
            )
    out["messages"] = normalized_messages
    out["context"] = normalize_context(out.get("context"))
    branch = out.get("branch")
    if branch is not None and not isinstance(branch, dict):
        out["branch"] = None
    runtime = out.get("runtime")
    if not isinstance(runtime, dict):
        out["runtime"] = {"resume": None}
    elif "resume" not in runtime:
        runtime["resume"] = None
    validate_v4_conversation(out)
    return out


def strip_system_injection_from_visible_content(content: Any) -> Any:
    """与 Context._strip_system_injection_text 对齐的可见内容清洗。"""
    if isinstance(content, str):
        markers = (
            "[系统注入]",
            "## Skill Instructions",
            "## Learning Context",
            "## Workspace Operating Contract",
        )
        for marker in markers:
            if marker in content:
                # 简单截断，避免把注入块带入可见历史
                idx = content.find(marker)
                # 仅当注入在末尾或独立段时截断
                if idx >= 0:
                    # 寻找 marker 前的双换行
                    cut = content.find(f"\n\n{marker}")
                    if cut >= 0:
                        return content[:cut].rstrip()
        return content
    return content
