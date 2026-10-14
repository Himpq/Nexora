"""
NexoraCode.model.Routes — 本地 Agent 对话路由

注册到本地 Flask 应用，接管 NexoraCode 的对话与会话（不依赖云端引擎）：
- /api/chat/stream: 本地 AgentLoop 流式对话（SSE 对齐云端 chat.js 协议）
- /api/conversations 系列: 本地会话存储（NexoraCode 会话一律存本地）
- /api/agent/permission/grant: 写本地 PathGuard 临时授权
- /api/user/info / /api/config: 本地登录态与 Provider 模型

对外提供：
- register_local_routes(app, executor): 注册本地对话与会话路由
"""

from __future__ import annotations

import json
import logging
import time
import threading
from pathlib import Path
from typing import Any, Generator

from flask import Blueprint, Response, jsonify, request, send_file, stream_with_context

from core.config import config, get_app_root, get_bundle_root
from local import build_default_executor
from local.PathGuard import grant_temporary_permission
from .Provider import ProviderClient, load_provider, load_providers
from .ConversationStore import ConversationStore
from .AgentLoop import AgentLoop, VISUAL_OUTPUT_GUIDANCE
from .StreamRuntime import (
    append_chunk_to_conversation,
    get_accumulated_content,
    get_session_meta,
    iter_session_chunks,
    list_sessions,
    request_cancel,
    start_session,
)
from .ToolPermissionPolicy import (
    PERMISSION_MODES,
    get_global_permission_settings,
    get_resolved_tool_action,
    get_permission_settings,
    list_approval_models,
    list_auto_approval_events,
    log_tool_permission_event,
    remember_resolved_tool_action,
    save_permission_settings,
    take_pending_tool_action,
)
from .turn_injection import collapse_context_injection_steps, plan_injection


_LOGGER = logging.getLogger(__name__)
_local_bp = Blueprint("local_agent", __name__)

# 提示词注入长度上限：避免超长自定义内容挤占上下文窗口。
_AGENTS_MD_MAX_CHARS = 8000
_CUSTOM_PROMPT_MAX_CHARS = 8000
_EXECUTOR = None


@_local_bp.after_request
def _local_no_store(resp):
    """本地动态 API 一律不缓存，避免模型/会话修改后拉到旧数据。"""
    resp.headers["Cache-Control"] = "no-store"
    return resp


@_local_bp.route("/settings-controls.css", methods=["GET"])
@_local_bp.route("/settings-sections.css", methods=["GET"])
def local_settings_stylesheet():
    """提供本地设置页拆分后的样式文件。"""
    filename = request.path.rsplit("/", 1)[-1]
    allowed_files = {"settings-controls.css", "settings-sections.css"}

    if filename not in allowed_files:
        return Response(status=404)

    return send_file(get_bundle_root() / "ui" / filename, mimetype="text/css")


@_local_bp.route("/permissions-settings.css", methods=["GET"])
def local_permissions_settings_css():
    return send_file(get_bundle_root() / "ui" / "permissions-settings.css", mimetype="text/css")


@_local_bp.route("/permissions-settings.js", methods=["GET"])
def local_permissions_settings_js():
    return send_file(get_bundle_root() / "ui" / "permissions-settings.js", mimetype="application/javascript")


@_local_bp.route("/github-project-settings.css", methods=["GET"])
@_local_bp.route("/github-project-settings.js", methods=["GET"])
def local_github_project_asset():
    """提供 GitHub 项目概览使用的独立脚本和样式。"""
    filename = request.path.rsplit("/", 1)[-1]
    asset_types = {
        "github-project-settings.css": "text/css",
        "github-project-settings.js": "application/javascript",
    }
    mimetype = asset_types.get(filename)

    if mimetype is None:
        return Response(status=404)

    return send_file(get_bundle_root() / "ui" / filename, mimetype=mimetype)


def set_default_executor(executor) -> None:
    """注入全局工具执行器，避免每次对话重建线程池。"""
    global _EXECUTOR
    _EXECUTOR = executor


def _build_agent_loop(provider: ProviderClient | None = None) -> AgentLoop:
    executor = _EXECUTOR if _EXECUTOR is not None else build_default_executor()

    if provider is None:
        provider = ProviderClient(load_provider())

    return AgentLoop(
        provider,
        executor,
        ConversationStore(),
    )


def _read_project_agents_md(project_path: str) -> str:
    """读取项目根目录下的 AGENTS.md 作为项目级提示词约定。

    仅读取项目根内的固定文件名，限长并静默跳过缺失/越界/读取失败的情况，
    保证不会因为该文件而中断对话。返回空串表示无可用内容。
    """
    clean_root = str(project_path or "").strip()

    if not clean_root:
        return ""

    try:
        root = Path(clean_root).resolve()
    except (OSError, ValueError):
        return ""

    candidates = [
        root / "AGENTS.md",
        root / "NEXORA.md",
        root / ".nexora" / "AGENTS.md",
    ]

    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except (OSError, ValueError):
            continue

        # 只接受项目根内的文件，避免符号链接或相对路径逃逸。
        if root not in resolved.parents:
            continue

        if not resolved.is_file():
            continue

        try:
            text = resolved.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            continue

        if text:
            return text[:_AGENTS_MD_MAX_CHARS]

    return ""


def _build_system_prompt(conversation: dict | None) -> str:
    lines = [
        "你是 NexoraCode，运行在用户本地电脑上的编程助手。",
        "你可以通过 local_* 工具读取/修改用户本地文件、执行命令、搜索代码，以完成用户的开发任务。",
        VISUAL_OUTPUT_GUIDANCE,
    ]
    project = {}

    if isinstance(conversation, dict):
        metadata = conversation.get("metadata") if isinstance(conversation.get("metadata"), dict) else {}
        project = metadata.get("nexoracode_project") if isinstance(metadata.get("nexoracode_project"), dict) else {}

    project_path = str(project.get("path") or "").strip()

    if project_path:
        lines.extend([
            f"当前绑定本地项目路径：{project_path}",
            "涉及该项目的文件读写、搜索、命令执行请使用 local_* 工具，并保持在项目根路径内。",
            "所有文件路径必须以项目根路径为基准精确构造，禁止编造、猜测或沿用旧路径；不确定结构时先 local_file_list 项目根路径。",
            "需要访问项目外或敏感路径时，系统会自动向用户发起授权询问，无需额外调用权限工具。",
        ])
    else:
        lines.append("需要访问本地路径时，系统会自动向用户发起授权询问，无需额外调用权限工具。")

    # 注意：head 必须恒定。AGENTS.md 与自定义提示词都属于「用户随时可改」的内容，
    # 一旦拼进 head，用户改一次设置就会让已缓存的整段前缀失效。它们改由
    # _collect_injection_sources 采样后，经基线比对决定是否作为 tail 注入。
    return "\n".join(lines)


def _collect_injection_sources(conversation: dict | None) -> dict:
    """采样 tail 注入通道的当前文本：项目约定（AGENTS.md）与用户自定义提示词。

    这里只负责「取当前值」，不做比对：基线读写需要落盘会话，统一交给
    AgentLoop 在处理请求时完成（见 turn_injection.plan_injection）。
    """

    project = {}

    if isinstance(conversation, dict):
        metadata = conversation.get("metadata") if isinstance(conversation.get("metadata"), dict) else {}
        project = metadata.get("nexoracode_project") if isinstance(metadata.get("nexoracode_project"), dict) else {}

    project_path = str(project.get("path") or "").strip()
    agents_text = ""

    if project_path and bool(config.get("local_read_agents_md", True)):
        agents_text = _read_project_agents_md(project_path)

    custom_prompt = str(config.get("local_custom_system_prompt", "") or "").strip()

    return {
        "project_conventions": agents_text,
        "custom_instructions": custom_prompt[:_CUSTOM_PROMPT_MAX_CHARS],
    }


def _normalize_history_messages(messages: list) -> list:
    """
    把本地存储的 OpenAI 风格历史消息（assistant.tool_calls + 独立 role=tool）
    归一化为前端渲染期望的 metadata.process_steps 格式：
    - assistant 消息生成 content / function_call / function_result 步骤
    - 过滤独立 role=tool 消息（工具结果已并入 assistant.process_steps）
    """
    rows = [row for row in (messages or []) if isinstance(row, dict)]
    out: list = []
    current_assistant_pos = -1

    for raw in rows:
        role = str(raw.get("role") or "").strip()

        if role == "assistant":
            new_msg = dict(raw)
            process_steps = []
            content = raw.get("content")
            metadata = dict(raw.get("metadata") or {})

            # 压缩/注入卡片作为普通步骤参与时序渲染：二者都在本轮首轮请求前推送
            # （注入先于压缩），因此插在 process_steps 最前，位置与工具链一致。
            # 对齐云端 process_steps.append(ctx_status) 的语义。
            injection_step = metadata.get("context_injection")

            if isinstance(injection_step, dict):
                process_steps.append({"type": "context_injection", **injection_step})

            compression_step = metadata.get("context_compression")

            if isinstance(compression_step, dict):
                process_steps.append({"type": "context_compression_status", **compression_step})

            # 自动重试提示：与压缩/注入卡片同属"本轮过程事件"，按发生顺序插在正文之前。
            # 没有这一步，刷新页面后重试提示会消失（流式期间只在前端内存里）。
            auto_retries = metadata.get("auto_retries")

            if isinstance(auto_retries, list):
                for retry in auto_retries:
                    if isinstance(retry, dict):
                        process_steps.append({"type": "auto_retry", **retry})

            if isinstance(content, str) and content.strip():
                process_steps.append({"type": "content", "content": content})

            tool_calls = raw.get("tool_calls")

            if isinstance(tool_calls, list):
                for index, tool_call in enumerate(tool_calls):
                    if not isinstance(tool_call, dict):
                        continue

                    process_steps.append({
                        "type": "function_call",
                        "name": str(tool_call.get("name") or ""),
                        "arguments": json.dumps(tool_call.get("arguments") or {}, ensure_ascii=False),
                        "call_id": str(tool_call.get("id") or ""),
                        "index": index,
                    })

            if process_steps:
                metadata["process_steps"] = process_steps

            new_msg["metadata"] = metadata
            out.append(new_msg)
            current_assistant_pos = len(out) - 1
            continue

        if role == "tool":
            if current_assistant_pos < 0:
                continue

            target = out[current_assistant_pos]
            steps = (target.get("metadata") or {}).get("process_steps")

            if not isinstance(steps, list):
                continue

            tool_call_id = str(raw.get("tool_call_id") or "")
            match_name = ""
            match_index = None

            for step in steps:
                if step.get("type") == "function_call" and str(step.get("call_id") or "") == tool_call_id:
                    match_name = str(step.get("name") or "")
                    match_index = step.get("index")
                    break

            result = str(raw.get("content") or "")

            steps.append({
                "type": "function_result",
                "name": match_name,
                "result": result,
                "model_visible_result": result,
                "call_id": tool_call_id,
                "index": match_index,
            })
            continue

        out.append(raw)

    return out


def _merge_agent_response_rounds(messages: list) -> list:
    """Merge adjacent assistant rounds sharing one request trace for history display."""
    merged = []

    for raw in messages or []:
        if not isinstance(raw, dict):
            continue

        current = dict(raw)

        if current.get("role") != "assistant":
            merged.append(current)
            continue

        raw_metadata = current.get("metadata")

        if not isinstance(raw_metadata, dict):
            merged.append(current)
            continue

        current_metadata = dict(raw_metadata)
        current["metadata"] = current_metadata
        response_trace_id = str(current_metadata.get("response_trace_id") or "").strip()

        if not response_trace_id or not merged:
            merged.append(current)
            continue

        previous = merged[-1]
        raw_previous_metadata = previous.get("metadata")
        previous_metadata = dict(raw_previous_metadata) if isinstance(raw_previous_metadata, dict) else {}
        previous_trace_id = str(previous_metadata.get("response_trace_id") or "").strip()

        if previous.get("role") != "assistant" or previous_trace_id != response_trace_id:
            merged.append(current)
            continue

        previous_steps = previous_metadata.get("process_steps")
        current_steps = current_metadata.get("process_steps")
        combined_steps = list(previous_steps) if isinstance(previous_steps, list) else []

        if isinstance(current_steps, list):
            combined_steps.extend(current_steps)

        previous_calls = previous.get("tool_calls")
        current_calls = current.get("tool_calls")
        combined_calls = list(previous_calls) if isinstance(previous_calls, list) else []

        if isinstance(current_calls, list):
            combined_calls.extend(current_calls)

        previous_reasoning = str(previous_metadata.get("reasoning_content") or "")
        current_reasoning = str(current_metadata.get("reasoning_content") or "")
        combined_content = (
            _message_content_text(previous.get("content"))
            + _message_content_text(current.get("content"))
        )

        previous.update(current)
        previous["content"] = combined_content

        if combined_calls:
            previous["tool_calls"] = combined_calls
        else:
            previous.pop("tool_calls", None)

        combined_metadata = {**previous_metadata, **current_metadata}

        if combined_steps:
            # 同一请求的工具轮都会保存注入快照；历史在首次位置展示最新状态。
            combined_metadata["process_steps"] = collapse_context_injection_steps(
                combined_steps
            )

        if previous_reasoning or current_reasoning:
            combined_metadata["reasoning_content"] = previous_reasoning + current_reasoning

        previous["metadata"] = combined_metadata

    return merged


def _sse_event(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


def _message_content_text(content: Any) -> str:
    """把会话消息 content（可能是 str 或内容分块 list）转成展示文本。"""
    if content is None:
        return ""

    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts = []

        for part in content:
            if isinstance(part, dict):
                parts.append(str(part.get("text") or ""))

        return "".join(parts)

    try:
        return json.dumps(content, ensure_ascii=False)
    except Exception:
        return str(content)


def _safe_tokens(value: Any) -> int:
    """非负整数安全转换，非法输入返回 0。"""
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def _safe_float(value: Any) -> float:
    """非负浮点安全转换，非法输入返回 0.0。"""
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        return 0.0


def _message_io_tokens(message: dict) -> dict:
    """从 assistant 消息 metadata 提取 io_tokens（无则空 dict）。"""
    if not isinstance(message, dict):
        return {}

    metadata = message.get("metadata") if isinstance(message.get("metadata"), dict) else {}

    if isinstance(metadata.get("io_tokens"), dict):
        return metadata["io_tokens"]

    return {}


def _message_metadata(message: dict) -> dict:
    """取 assistant 消息 metadata（用于取 request 分组与模型名）。"""
    if not isinstance(message, dict):
        return {}

    return message.get("metadata") if isinstance(message.get("metadata"), dict) else {}


def _cache_hit_rate(raw_input: int, cached: int) -> float:
    """缓存命中率：命中量占上游原始输入的比例，原始输入为 0 时无命中率可言。"""
    if raw_input <= 0:
        return 0.0

    return round(min(1.0, max(0.0, cached / raw_input)), 6)


def _usage_record(
    io: dict,
    *,
    action: str,
    detail_ref: str,
    conversation_id: str,
    conversation_title: str,
    timestamp: str,
    model: str,
    response_trace_id: str = "",
    round_index: int = 0,
) -> dict:
    """统一的单次模型调用用量记录（对话轮次与压缩调用共用）。

    口径对齐云端：total_tokens = 原始输入 + 输出，不因缓存命中而扣减；
    计费输入 effective = 原始输入 - 缓存命中，命中率单独给出。
    """
    raw_input = _safe_tokens(io.get("raw_input"))
    cached = min(_safe_tokens(io.get("cached_input")), raw_input)
    effective = max(0, raw_input - cached)
    output = _safe_tokens(io.get("output"))
    uncached = _safe_tokens(io.get("uncached_input")) or effective

    return {
        "detail_ref": detail_ref,
        "conversation_id": conversation_id,
        "conversation_title": conversation_title,
        "action": action,
        "timestamp": timestamp,
        "model": model,
        "provider": "",
        # input_tokens 沿用「扣除缓存后的计费输入」，保持既有表格与徽标口径不变。
        "input_tokens": effective,
        "output_tokens": output,
        "total_tokens": raw_input + output,
        "raw_input_tokens": raw_input,
        "cached_input_tokens": cached,
        "cached_tokens": cached,
        "cached_tokens_source": str(io.get("cached_tokens_source") or ""),
        "uncached_input_tokens": uncached,
        "effective_input_tokens": effective,
        "reasoning_tokens": _safe_tokens(io.get("reasoning_tokens")),
        "cache_hit_rate": _cache_hit_rate(raw_input, cached),
        "response_trace_id": response_trace_id,
        "round_index": max(0, int(round_index or 0)),
    }


def _find_preceding_user_message(messages: list, assistant_index: int) -> dict | None:
    """在 assistant 消息之前查找最近的 user 消息。"""
    for index in range(assistant_index - 1, -1, -1):
        message = messages[index]

        if isinstance(message, dict) and str(message.get("role") or "").strip() == "user":
            return message

    return None


def _build_token_history(store: ConversationStore, conversation_id: str = "", limit: int = 20) -> list:
    """从本地会话消息 metadata.io_tokens 聚合 Token 历史（detail_ref 编码会话+消息索引）。"""
    conversations = []

    if conversation_id:
        conversation = store.get(conversation_id)

        if conversation is not None:
            conversations = [conversation]
    else:
        for meta in store.list():
            conversation = store.get(str(meta.get("conversation_id") or ""))

            if conversation is not None:
                conversations.append(conversation)

    rows = []

    for conversation in conversations:
        cid = str(conversation.get("conversation_id") or "")
        title = str(conversation.get("title") or "未命名会话")
        messages = conversation.get("messages") if isinstance(conversation.get("messages"), list) else []

        for index, message in enumerate(messages):
            io = _message_io_tokens(message)

            if not io:
                continue

            if _safe_tokens(io.get("input")) <= 0 and _safe_tokens(io.get("output")) <= 0:
                continue

            metadata = _message_metadata(message)
            rows.append(_usage_record(
                io,
                action="chat",
                detail_ref=f"{cid}:{index}",
                conversation_id=cid,
                conversation_title=title,
                timestamp=str(message.get("timestamp") or "") if isinstance(message, dict) else "",
                model=str(metadata.get("model_name") or ""),
                response_trace_id=str(metadata.get("response_trace_id") or ""),
                round_index=_safe_tokens(metadata.get("round_index")),
            ))

        for index, call in enumerate(conversation.get("context_compression_calls", [])):
            rows.append(_usage_record(
                call.get("usage") if isinstance(call.get("usage"), dict) else {},
                action="context_compression",
                detail_ref=f"{cid}:compression-{index}",
                conversation_id=cid,
                conversation_title=title,
                timestamp=str(call.get("timestamp") or ""),
                model=str(call.get("model_name") or ""),
                response_trace_id=str(call.get("response_trace_id") or ""),
                round_index=_safe_tokens(call.get("round_index")),
            ))

    rows.sort(key=lambda row: str(row.get("timestamp") or ""), reverse=True)

    if limit is None:
        return rows

    return rows[:max(1, int(limit))]


def _translate_event(event: dict) -> dict:
    """把 AgentLoop 事件转换为 SSE 对前端友好的格式。"""
    event_type = str(event.get("type") or "")

    if event_type == "function_call":
        return {
            "type": "function_call",
            "name": event.get("name"),
            "call_id": event.get("call_id"),
            "arguments": json.dumps(event.get("arguments") or {}, ensure_ascii=False),
        }

    if event_type == "function_result":
        return {
            "type": "function_result",
            "name": event.get("name"),
            "call_id": event.get("call_id"),
            "result": event.get("result"),
            "success": bool(event.get("success")),
        }

    if event_type == "question":
        return {
            "type": "question",
            "question": event.get("question"),
            "await": True,
        }

    if event_type == "conversation_id":
        return {
            "type": "conversation_id",
            "conversation_id": event.get("conversation_id"),
        }

    if event_type == "content":
        return {"type": "content", "content": event.get("content")}

    if event_type == "error":
        return {"type": "error", "message": event.get("message")}

    if event_type == "auto_retry":
        return {
            "type": "auto_retry",
            "reason": event.get("reason"),
            "attempt": event.get("attempt"),
            "limit": event.get("limit"),
        }

    if event_type == "done":
        return {"type": "done"}

    if event_type == "model_info":
        return {
            "type": "model_info",
            "model_name": event.get("model_name"),
            "provider": event.get("provider"),
            "search_enabled": bool(event.get("search_enabled", False)),
        }

    if event_type == "token_usage":
        return {
            "type": "token_usage",
            "input_tokens": event.get("input_tokens"),
            "output_tokens": event.get("output_tokens"),
            "total_tokens": event.get("total_tokens"),
            "raw_input_tokens": event.get("raw_input_tokens"),
            "cached_input_tokens": event.get("cached_input_tokens"),
        }

    if event_type == "context_injection":
        return {
            "type": "context_injection",
            "head_chars": event.get("head_chars"),
            "blocks": event.get("blocks") or [],
        }

    return event


def _stream_worker_factory(body: dict):
    """构建 StreamRuntime 的 worker 回调：后台线程驱动 AgentLoop，chunks 写入 session。

    返回 worker(push_chunk, set_conversation_id, set_stage, is_cancel_requested)，
    与云端 start_stream_session 的 worker 签名对齐。
    """

    message = str(body.get("message") or "").strip()
    conversation_id = str(body.get("conversation_id") or "").strip()
    model_name = str(body.get("model_name") or "").strip()
    requested_thinking = body.get("enable_thinking")
    enable_thinking = requested_thinking if isinstance(requested_thinking, bool) else None

    store = ConversationStore()
    conversation = store.get(conversation_id) if conversation_id else None

    # 请求没带模型时回退到该会话自己的设置：会话级模型是「每个会话独立持有」，
    # 云端下发等不带 model_name 的入口也能用对模型。
    if not model_name and conversation_id:
        model_name = str(store.get_settings(conversation_id).get("model_name") or "").strip()

    system_prompt = _build_system_prompt(conversation)
    injection_sources = _collect_injection_sources(conversation)

    target_config = None

    if model_name and "/" in model_name:
        provider_id, model_id = model_name.split("/", 1)

        for provider in load_providers():
            if provider.provider_id == provider_id:
                provider.model = model_id
                target_config = provider
                break

    # 任务路由的 provider 归属必须落到日志：provider 报 400/401 时，
    # 少了这行就只能靠猜是哪个 base_url 出的问题（/api/chat/stream 至少打了 model）。
    if target_config is not None:
        print(f"[LocalAgent] /api/local/tasks provider: id={target_config.provider_id} "
              f"name={target_config.name} model={target_config.model} base_url={target_config.base_url}")
    else:
        print(f"[LocalAgent] /api/local/tasks provider: (default) model_name={model_name or '(unset)'}")

    def _worker(push_chunk, set_conversation_id, set_stage, is_cancel_requested) -> None:
        if not message:
            push_chunk({"type": "error", "message": "消息不能为空"})

            return

        loop = _build_agent_loop(ProviderClient(target_config) if target_config is not None else None)
        from .MessageQueue import MessageQueue
        from .QueueRunner import run_queue_worker

        return run_queue_worker(
            push_chunk=push_chunk,
            set_conversation_id=set_conversation_id,
            is_cancel_requested=is_cancel_requested,
            loop=loop,
            store=store,
            queue_store=MessageQueue(),
            conversation_id=conversation_id,
            stream_id=str(body.get("_stream_id") or ""),
            message=message,
            system_prompt=system_prompt,
            injection_sources=injection_sources,
            enable_thinking=enable_thinking,
            body=body,
            normalize_messages=_normalize_history_messages,
            translate_event=_translate_event,
        )

    return _worker


def _iter_sse_from_session(stream_id: str, from_seq: int = 0) -> Generator[str, None, None]:
    """从 StreamRuntime session 读 chunks 并输出 SSE，对齐云端 _iter_sse_from_runtime_stream 协议。"""

    try:
        safe_from_seq = int(from_seq or 0)
    except Exception:
        safe_from_seq = 0

    meta = get_session_meta(stream_id)

    if not meta:
        yield "data: [DONE]\n\n"

        return

    session_info = {
        "type": "stream_session",
        "stream_id": str(stream_id or ""),
        "conversation_id": str(meta.get("conversation_id") or ""),
        "is_regenerate": bool(meta.get("is_regenerate", False)),
        "assistant_index": meta.get("assistant_index"),
        "regenerate_index": meta.get("regenerate_index"),
        "status": str(meta.get("status") or "running"),
        "from_seq": max(0, safe_from_seq),
        "head_seq": int(meta.get("head_seq") or 1),
        "last_seq": int(meta.get("last_seq") or 0),
    }
    yield f"data: {json.dumps(session_info, ensure_ascii=False, default=str)}\n\n"

    for _, payload in iter_session_chunks(stream_id, from_seq=max(0, safe_from_seq), heartbeat_sec=12):
        if not isinstance(payload, dict):
            continue

        if str(payload.get("type") or "").strip() == "ping":
            yield ": ping\n\n"
            continue

        yield f"data: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"

    final_meta = get_session_meta(stream_id) or {}
    final_session_info = {
        "type": "stream_session",
        "stream_id": str(stream_id or ""),
        "conversation_id": str(final_meta.get("conversation_id") or meta.get("conversation_id") or ""),
        "is_regenerate": bool(final_meta.get("is_regenerate", meta.get("is_regenerate", False))),
        "assistant_index": final_meta.get("assistant_index", meta.get("assistant_index")),
        "regenerate_index": final_meta.get("regenerate_index", meta.get("regenerate_index")),
        "status": str(final_meta.get("status") or "done"),
        "done": True,
        "cancel_requested": bool(final_meta.get("cancel_requested", False)),
        "cancel_reason": str(final_meta.get("cancel_reason") or ""),
        "error": str(final_meta.get("error") or ""),
        "head_seq": int(final_meta.get("head_seq") or meta.get("head_seq") or 1),
        "last_seq": int(final_meta.get("last_seq") or meta.get("last_seq") or 0),
    }
    yield f"data: {json.dumps(final_session_info, ensure_ascii=False, default=str)}\n\n"
    yield "data: [DONE]\n\n"


def _stream_chat_generator(stream_id: str) -> Generator[str, None, None]:
    """SSE 只消费 StreamRuntime session chunks。

    客户端断开（切页面 / 导航）只结束本生成器，worker 线程继续跑完并落盘，
    复刻云端并行对话（detach 后可通过 reconnect 续读）。
    """

    yield from _iter_sse_from_session(stream_id, from_seq=0)


@_local_bp.route("/api/chat/stream", methods=["POST"])
def local_agent_chat_stream():
    raw_body = request.get_json(silent=True)
    body = raw_body if isinstance(raw_body, dict) else {}
    conversation_id = str(body.get("conversation_id") or "").strip()
    model_name = str(body.get("model_name") or "").strip()
    message = str(body.get("message") or "").strip()

    print(f"[LocalAgent] /api/chat/stream request: message={message[:60]!r} conversation_id={conversation_id or '(new)'} model={model_name or '(default)'}")

    if not message:
        return jsonify({"success": False, "message": "消息不能为空"}), 400

    # 视图函数内先启动 session 拿到 stream_id，才能写进响应头 X-Stream-Id（前端 detach 依赖）。
    from .TaskService import start_task
    import uuid

    body.setdefault("request_id", uuid.uuid4().hex)

    try:
        stream_id = start_task(body)["stream_id"]
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 409

    resp = Response(
        stream_with_context(_stream_chat_generator(stream_id)),
        status=200,
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "X-Stream-Id": str(stream_id or ""),
        },
    )
    return resp


@_local_bp.route("/api/conversations", methods=["GET"])
def local_agent_list_conversations():
    store = ConversationStore()
    return jsonify({"success": True, "conversations": store.list()})


@_local_bp.route("/api/conversations", methods=["POST"])
def local_agent_create_conversation():
    data = request.get_json(silent=True) or {}
    title = str(data.get("title") or "新会话").strip() or "新会话"
    metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}

    store = ConversationStore()
    conversation = store.create(title, metadata)
    conversation_id = str(conversation.get("conversation_id") or "")

    # 新会话把当前全局默认复制成自己的独立设置：此后改这个会话不影响其他会话，
    # 改全局也只影响之后新建的会话。
    global_permission = get_global_permission_settings()

    try:
        store.save_settings(conversation_id, {
            "model_name": str(data.get("model_name") or "").strip(),
            "permission_mode": global_permission["mode"],
            "approval_model_id": global_permission["approval_model_id"],
        })
    except Exception:
        _LOGGER.exception("[LocalAgent] init_conversation_settings_failed conversation=%s", conversation_id)

    return jsonify({"success": True, "conversation_id": conversation_id, "title": title})


@_local_bp.route("/api/conversations/<conv_id>", methods=["GET"])
def local_agent_get_conversation(conv_id: str):
    store = ConversationStore()
    conversation = store.get(conv_id)

    if conversation is None:
        return jsonify({"success": False, "message": "会话不存在"}), 404

    conversation["messages"] = _normalize_history_messages(conversation.get("messages", []))

    return jsonify({"success": True, "conversation": conversation})


@_local_bp.route("/api/conversations/<conv_id>/settings", methods=["GET", "POST"])
def local_agent_conversation_settings(conv_id: str):
    """读取或保存单个会话的独立设置（模型 / 工具权限）。

    每个会话独立持有：新建时从全局默认复制一份，之后改本会话不影响其他会话。
    老会话没有 settings 段时用当前全局默认惰性补齐一次。
    """
    store = ConversationStore()

    if store.get(conv_id) is None:
        return jsonify({"success": False, "message": "会话不存在"}), 404

    if request.method == "GET":
        global_permission = get_global_permission_settings()
        settings = store.ensure_settings(conv_id, {
            "permission_mode": global_permission["mode"],
            "approval_model_id": global_permission["approval_model_id"],
        })
        permission = get_permission_settings(conv_id)

        return jsonify({
            "success": True,
            "settings": {
                "model_name": str(settings.get("model_name") or ""),
                "permission_mode": permission["mode"],
                "approval_model_id": permission["approval_model_id"],
            },
            "models": list_approval_models(),
        })

    raw_body = request.get_json(silent=True)
    body = raw_body if isinstance(raw_body, dict) else {}
    patch: dict = {}

    if "model_name" in body:
        patch["model_name"] = str(body.get("model_name") or "").strip()

    if "permission_mode" in body or "approval_model_id" in body:
        try:
            save_permission_settings(
                mode=str(body.get("permission_mode") or ""),
                approval_model_id=str(body.get("approval_model_id") or ""),
                conversation_id=conv_id,
            )
        except ValueError as exc:
            return jsonify({"success": False, "message": str(exc)}), 400

    try:
        if patch:
            store.save_settings(conv_id, patch)
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400

    global_permission = get_global_permission_settings()
    settings = store.ensure_settings(conv_id, {
        "permission_mode": global_permission["mode"],
        "approval_model_id": global_permission["approval_model_id"],
    })
    permission = get_permission_settings(conv_id)

    return jsonify({
        "success": True,
        "message": "会话设置已保存",
        "settings": {
            "model_name": str(settings.get("model_name") or ""),
            "permission_mode": permission["mode"],
            "approval_model_id": permission["approval_model_id"],
        },
    })


@_local_bp.route("/api/conversations/<conv_id>", methods=["DELETE"])
def local_agent_delete_conversation(conv_id: str):
    store = ConversationStore()
    deleted = store.delete(conv_id)

    if not deleted:
        return jsonify({"success": False, "message": "会话不存在"}), 404

    return jsonify({"success": True, "conversation_id": conv_id})


@_local_bp.route("/api/conversations/<conv_id>/title", methods=["PUT"])
def local_agent_update_conversation_title(conv_id: str):
    """手动更新会话标题（前端改名 / 智能标题回写）。"""
    data = request.get_json(silent=True) or {}
    title = str(data.get("title") or "").strip()

    if not title:
        return jsonify({"success": False, "message": "标题不能为空"}), 400

    store = ConversationStore()
    updated = store.set_title(conv_id, title)

    if not updated:
        return jsonify({"success": False, "message": "会话不存在"}), 404

    return jsonify({"success": True, "conversation_id": conv_id, "title": title})


@_local_bp.route("/api/conversations/<conv_id>/messages", methods=["GET"])
def local_agent_get_messages(conv_id: str):
    store = ConversationStore()
    conversation = store.get(conv_id)

    if conversation is None:
        return jsonify({"success": False, "message": "会话不存在"}), 404

    normalized = _normalize_history_messages(conversation.get("messages", []))

    if request.args.get("merge_agent_rounds") == "1":
        normalized = _merge_agent_response_rounds(normalized)

    total = len(normalized)
    total_user_messages = sum(
        1 for message in normalized
        if str(message.get("role") or "").strip() == "user"
    )
    before_raw = request.args.get("before")
    limit_raw = request.args.get("limit")

    if limit_raw is None and before_raw is not None:
        return jsonify({"success": False, "message": "before 必须与 limit 一起提供"}), 400

    if limit_raw is None:
        start_index = 0
        before_index = total
        limit = total
    else:
        try:
            limit = int(str(limit_raw).strip())
        except (TypeError, ValueError):
            return jsonify({"success": False, "message": "limit 必须是整数"}), 400

        if limit <= 0 or limit > 200:
            return jsonify({"success": False, "message": "limit 必须在 1 到 200 之间"}), 400

        if before_raw is None or not str(before_raw).strip():
            before_index = total
        else:
            try:
                before_index = int(str(before_raw).strip())
            except (TypeError, ValueError):
                return jsonify({"success": False, "message": "before 必须是整数"}), 400

        before_index = max(0, min(before_index, total))
        start_index = max(0, before_index - limit)

    return jsonify({
        "success": True,
        "messages": normalized[start_index:before_index],
        "start_index": start_index,
        "end_index": before_index - 1 if before_index > 0 else -1,
        "total": total,
        "limit": limit,
        "has_more_before": start_index > 0,
        "total_user_messages": total_user_messages,
    })


@_local_bp.route("/api/conversations/<conv_id>/turns", methods=["GET"])
def local_agent_get_turns(conv_id: str):
    """会话轮次列表（用户消息索引），供前端轮次指示面板 hover 展开跳转。"""
    store = ConversationStore()
    conversation = store.get(conv_id)

    if conversation is None:
        return jsonify({"success": False, "message": "会话不存在"}), 404

    normalized = _normalize_history_messages(conversation.get("messages", []))

    if request.args.get("merge_agent_rounds") == "1":
        normalized = _merge_agent_response_rounds(normalized)

    turns = []

    for index, message in enumerate(normalized):
        if str(message.get("role") or "") != "user":
            continue

        turns.append({
            "message_index": index,
            "id": str(message.get("id") or "") or f"msg_{index}",
            "content": _message_content_text(message.get("content")),
            "timestamp": str(message.get("timestamp") or ""),
        })

    return jsonify({"success": True, "turns": turns})


@_local_bp.route("/api/agent/permission/grant", methods=["POST"])
def local_agent_grant_permission():
    body = request.get_json(silent=True) or {}
    request_payload = body.get("permission_request") if isinstance(body.get("permission_request"), dict) else body

    conversation_id = str(body.get("conversation_id") or request_payload.get("conversation_id") or "").strip()
    path = str(request_payload.get("path") or "").strip()
    scope = str(request_payload.get("scope") or "file").strip().lower() or "file"
    access = str(request_payload.get("access") or request_payload.get("operation") or "read").strip().lower() or "read"
    reason = str(request_payload.get("reason") or "").strip()
    sensitive = bool(request_payload.get("sensitive", False))
    decision = str(body.get("decision") or request_payload.get("decision") or "allow").strip().lower() or "allow"

    if not conversation_id:
        return jsonify({"success": False, "message": "conversation_id 不能为空"}), 400

    if not path:
        return jsonify({"success": False, "message": "授权路径不能为空"}), 400

    if decision not in {"allow", "deny"}:
        return jsonify({"success": False, "message": "授权决定无效"}), 400

    # 拒绝：不写临时授权、不执行工具，只把「用户拒绝」写回并续跑本轮。
    if decision == "deny":
        print(f"[LocalAgent] deny permission: conversation_id={conversation_id} path={path}")
        resume = _resume_after_permission_deny(conversation_id, path)

        return jsonify({
            "success": True,
            "message": "已拒绝本次访问权限" + ("，正在继续" if resume.get("started") else ""),
            "resumed": bool(resume.get("started")),
            "resume_stream_id": str(resume.get("stream_id") or ""),
            "resume_message": str(resume.get("message") or ""),
        })

    print(f"[LocalAgent] grant permission: conversation_id={conversation_id} path={path} scope={scope} access={access}")

    result = grant_temporary_permission(
        path=path,
        conversation_id=conversation_id,
        scope=scope,
        access=access,
        reason=reason,
        sensitive=sensitive,
    )

    if not bool(result.get("success", False)):
        _LOGGER.error("[LocalAgent] permission_grant_failed conversation=%s", conversation_id)
        return jsonify({"success": False, "message": result.get("error") or "授权失败"}), 502

    print(f"[LocalAgent] grant OK: path={result.get('permission', {}).get('path')}")

    # 授权成功后自动续跑被权限阻断的本轮：此前弹卡时本轮已 done，
    # 若不续跑，用户必须手动再发一条消息，工具才会重试。
    resume = _resume_after_permission_grant(conversation_id, path)

    return jsonify({
        "success": True,
        "message": "已允许本次对话临时访问该路径" + ("，正在继续执行" if resume.get("started") else ""),
        "permission": result.get("permission"),
        "resumed": bool(resume.get("started")),
        "resume_stream_id": str(resume.get("stream_id") or ""),
        "resume_message": str(resume.get("message") or ""),
    })


def _execute_resumed_tool(
    conversation_id: str,
    tool_name: str,
    arguments: dict,
    project_root: str,
) -> tuple[bool, str]:
    """授权后续跑时直接执行被阻断的工具调用，返回 (是否成功, 结果文本)。

    以 permission_mode="full" 执行：用户已经在授权卡片上明确允许了这次访问，
    再走一遍审批只会重复弹卡。参数取自服务端登记，浏览器无法注入。
    """
    if not tool_name:
        return False, ""

    executor = _EXECUTOR if _EXECUTOR is not None else build_default_executor()

    try:
        execution = executor.execute(
            tool_name,
            arguments,
            context={
                "conversation_id": conversation_id,
                "project_root": project_root,
                "permission_mode": "full",
                "confirmed_tool_call": True,
            },
        )
    except Exception:
        _LOGGER.exception(
            "[LocalAgent] resume_tool_execution_failed conversation=%s tool=%s",
            conversation_id,
            tool_name,
        )
        return False, ""

    detail = execution.get("result") if isinstance(execution.get("result"), dict) else execution
    success = bool(execution.get("success", False))

    if not success:
        _LOGGER.error(
            "[LocalAgent] resume_tool_failed conversation=%s tool=%s error=%s",
            conversation_id,
            tool_name,
            str(execution.get("error") or detail.get("error") or "unknown"),
        )
        return False, ""

    from .Present import present_tool_result

    return True, present_tool_result(detail)


def _resolve_resume_model_name(conversation: dict) -> str:
    """取续跑要用的模型名：会话 metadata 优先，兜底倒序扫最近 assistant 消息。

    会话 metadata 通常只存项目信息，模型名要从最近一条 assistant 消息的
    metadata 里取，否则续跑会回退到默认 provider，用错模型。
    """
    metadata = conversation.get("metadata") if isinstance(conversation.get("metadata"), dict) else {}
    model_name = str(metadata.get("model_name") or "").strip()

    if model_name:
        return model_name

    messages = conversation.get("messages") if isinstance(conversation.get("messages"), list) else []

    for message in reversed(messages):
        if str(message.get("role") or "") != "assistant":
            continue

        message_metadata = message.get("metadata") if isinstance(message.get("metadata"), dict) else {}
        candidate = str(message_metadata.get("model_name") or "").strip()

        if candidate:
            return candidate

    return ""


def _start_resume_stream(conversation_id: str, conversation: dict, resume_message: str) -> dict:
    """启动一条续跑流（用户消息不落盘），返回 {started, stream_id, message}。"""
    import uuid

    model_name = _resolve_resume_model_name(conversation)

    body = {
        "message": resume_message,
        "conversation_id": conversation_id,
        "model_name": model_name,
        "skip_user_message": True,
        "queue_resume": True,
        "request_id": uuid.uuid4().hex,
    }

    try:
        from .TaskService import start_task

        record = start_task(body)
    except ValueError as exc:
        _LOGGER.error("[LocalAgent] resume_failed conversation=%s reason=%s", conversation_id, exc)
        return {"started": False, "message": str(exc)}

    print(f"[LocalAgent] resume started conversation={conversation_id} stream_id={record.get('stream_id')}")
    return {
        "started": True,
        "stream_id": str(record.get("stream_id") or ""),
        "message": "已自动续跑",
    }


def _take_resume_context(conversation_id: str) -> tuple[dict | None, dict | None, dict]:
    """领取待续跑登记并做公共守卫，返回 (pending, conversation, 早退结果)。

    早退结果非空时表示不满足续跑条件，调用方应直接返回它。
    """
    from .AgentLoop import take_pending_permission_resume

    pending = take_pending_permission_resume(conversation_id)

    if pending is None:
        print(f"[LocalAgent] resume skipped: no pending permission block conversation={conversation_id}")
        return None, None, {"started": False, "message": "没有等待授权的被阻断任务"}

    conversation = ConversationStore().get(conversation_id)

    if conversation is None:
        print(f"[LocalAgent] resume skipped: conversation missing conversation={conversation_id}")
        return None, None, {"started": False, "message": "会话不存在"}

    # 会话已有运行中的任务时不重复启动：用户可能已手动重发。
    if any(row["status"] in {"running", "cancelling"} for row in list_sessions(conversation_ids=[conversation_id])):
        print(f"[LocalAgent] resume skipped: conversation busy conversation={conversation_id}")
        return None, None, {"started": False, "message": "当前会话已有运行任务"}

    return pending, conversation, {}


def _resume_after_permission_deny(conversation_id: str, denied_path: str) -> dict:
    """用户拒绝路径授权后自动续跑本轮。

    拒绝不执行工具：把「用户拒绝」写回占位消息，再让模型基于这个结果继续
    （说明情况或改换方案）。不续跑的话本轮停在「等待授权」，用户拒绝后对话就断了。
    """
    pending, conversation, early = _take_resume_context(conversation_id)

    if pending is None:
        return early

    tool_call_id = str(pending.get("tool_call_id") or "").strip()
    path_text = str(pending.get("path") or denied_path or "").strip()

    ConversationStore().replace_tool_result(
        conversation_id, tool_call_id, "用户拒绝了该次操作。"
    )
    print(f"[LocalAgent] resume after deny conversation={conversation_id} path={path_text}")

    resume_message = "用户拒绝了该次操作。"
    result = _start_resume_stream(conversation_id, conversation, resume_message)
    print(f"[LocalAgent] resume result conversation={conversation_id} path={path_text} "
          f"denied=1 started={result.get('started')}")
    return result


def _resume_after_permission_grant(conversation_id: str, granted_path: str) -> dict:
    """授权后自动续跑被权限阻断的本轮。

    关键点：先由服务端**直接执行**被阻断的那次工具调用，把真实结果写回历史里的
    占位消息，再启动续跑让模型基于真实结果继续。不能只发一条「已授权，请重试」
    的 user 消息——历史末尾是模型自己说的「等待用户授权」，模型会顺着继续说话，
    而不是重新发起工具调用（实测确认）。
    """
    pending, conversation, early = _take_resume_context(conversation_id)

    if pending is None:
        return early

    # 授权路径与被阻断路径不一致时仍续跑：用户可能授权的是父目录，
    # 或模型同时请求了多个路径。续跑后模型会按最新权限继续。
    if granted_path and pending.get("path") and str(granted_path).strip() != str(pending["path"]).strip():
        print(f"[LocalAgent] resume with different path: granted={granted_path} blocked={pending.get('path')}")

    tool_name = str(pending.get("tool_name") or "").strip()
    path_text = str(pending.get("path") or "").strip()
    tool_call_id = str(pending.get("tool_call_id") or "").strip()
    arguments = pending.get("arguments") if isinstance(pending.get("arguments"), dict) else {}
    project_root = str(pending.get("project_root") or "").strip()

    # 第一步：直接执行被阻断的工具调用，把真实结果替换掉占位消息。
    executed, tool_content = _execute_resumed_tool(
        conversation_id, tool_name, arguments, project_root
    )

    if not executed:
        _LOGGER.error(
            "[LocalAgent] resume_aborted conversation=%s tool=%s",
            conversation_id,
            tool_name,
        )
        return {"started": False, "message": "工具重新执行失败，请手动重试"}

    ConversationStore().replace_tool_result(conversation_id, tool_call_id, tool_content)
    print(f"[LocalAgent] resume tool executed conversation={conversation_id} tool={tool_name} "
          f"call_id={tool_call_id} content_chars={len(tool_content)}")

    # 第二步：续跑让模型基于真实工具结果继续。用户消息不落盘。
    resume_message = (
        f"用户已允许本次对话临时访问 {path_text}。{tool_name} 的执行结果已写入上一条工具消息，"
        "请基于该结果继续完成用户请求。"
    )

    result = _start_resume_stream(conversation_id, conversation, resume_message)
    print(f"[LocalAgent] resume result conversation={conversation_id} tool={tool_name} "
          f"path={path_text} started={result.get('started')}")
    return result


@_local_bp.route("/api/local/permissions", methods=["GET", "POST"])
def local_agent_permission_settings():
    """读取或保存工具权限模式与自动审批模型。

    带 conversation_id 时读写该会话的独立设置；不带则读写全局默认
    （全局默认只作为新建会话的初值）。会话设置与全局互不影响。
    """
    if request.method == "GET":
        conversation_id = str(request.args.get("conversation_id") or "").strip()
        settings = get_permission_settings(conversation_id)
        return jsonify({
            "success": True,
            "mode": settings["mode"],
            "approval_model_id": settings["approval_model_id"],
            "models": list_approval_models(),
            "scope": "conversation" if conversation_id else "global",
        })

    raw_body = request.get_json(silent=True)
    body = raw_body if isinstance(raw_body, dict) else {}
    conversation_id = str(body.get("conversation_id") or "").strip()

    try:
        save_permission_settings(
            mode=str(body.get("mode") or ""),
            approval_model_id=str(body.get("approval_model_id") or ""),
            conversation_id=conversation_id,
        )
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400

    return jsonify({"success": True, "message": "工具权限设置已保存"})


@_local_bp.route("/api/local/permissions/auto-approval-events", methods=["GET"])
def local_agent_auto_approval_events():
    """读取设置页展示的自动审批模型判定记录。"""
    return jsonify({"success": True, "events": list_auto_approval_events()})


@_local_bp.route("/api/agent/tool-permission/resolve", methods=["POST"])
def local_agent_resolve_tool_permission():
    """对确认卡绑定的原始工具调用执行一次性批准或拒绝。"""
    raw_body = request.get_json(silent=True)
    body = raw_body if isinstance(raw_body, dict) else {}
    request_payload = body.get("tool_permission_request") if isinstance(body.get("tool_permission_request"), dict) else {}
    request_id = str(request_payload.get("request_id") or body.get("request_id") or "").strip()
    conversation_id = str(body.get("conversation_id") or "").strip()
    decision = str(body.get("decision") or "").strip().lower()

    if not request_id or not conversation_id:
        return jsonify({"success": False, "message": "授权请求信息不完整"}), 400

    if decision not in {"allow", "deny"}:
        return jsonify({"success": False, "message": "授权决定无效"}), 400

    store = ConversationStore()

    if store.get(conversation_id) is None:
        return jsonify({"success": False, "message": "本地会话不存在"}), 404

    pending = take_pending_tool_action(request_id, conversation_id)

    if pending is None:
        resolved = get_resolved_tool_action(request_id, conversation_id)

        if resolved is not None:
            return jsonify(resolved)

        return jsonify({"success": False, "message": "授权请求已过期或已处理"}), 404

    allowed = decision == "allow"
    mode = get_permission_settings(conversation_id)["mode"]
    execution_success = False

    if allowed and mode not in PERMISSION_MODES:
        tool_content = "操作未执行：当前权限模式配置无效。"
        message_text = "权限模式配置无效，本次操作未执行。"
        allowed = False
    elif allowed and mode == "read_only":
        tool_content = "操作未执行：当前权限模式已切换为只读。"
        message_text = "权限模式已切换为只读，本次操作未执行。"
        allowed = False
    elif not allowed:
        tool_content = "用户拒绝了该次操作。"
        message_text = "已拒绝本次工具操作。"
    else:
        executor = _EXECUTOR if _EXECUTOR is not None else build_default_executor()

        try:
            execution = executor.execute(
                pending["tool_name"],
                pending["arguments"],
                context={
                    "conversation_id": conversation_id,
                    "project_root": pending["project_root"],
                    "permission_mode": mode,
                    "confirmed_tool_call": True,
                },
            )
            execution_success = bool(execution.get("success", False))
            detail = execution.get("result") if isinstance(execution.get("result"), dict) else execution

            if execution_success:
                from .Present import present_tool_result

                tool_content = present_tool_result(detail)
                message_text = "本次工具操作已执行。"
            else:
                tool_content = str(execution.get("error") or detail.get("error") or "工具执行失败")
                message_text = "本次操作已确认，但工具执行失败。"
        except Exception as exc:
            tool_content = f"工具执行失败：{exc}"
            message_text = "本次操作已确认，但工具执行失败。"

    log_tool_permission_event(
        tool_name=pending["tool_name"],
        operation=pending["operation"],
        mode=mode,
        decision="allow" if allowed else "deny",
        stage="manual_resolution",
        user_decision=decision,
        tool_success=execution_success,
    )

    appended = store.replace_tool_result(conversation_id, pending["tool_call_id"], tool_content)

    if not appended:
        failure = {"success": False, "message": "工具结果未能写入本地会话"}
        remember_resolved_tool_action(request_id, conversation_id, failure)
        return jsonify(failure), 409

    # 工具已执行、结果已写回历史。允许与拒绝都要续跑本轮：
    # 此前只写回结果不续跑，用户作答后模型不会继续，必须手动再发一条消息。
    resume = {"started": False, "stream_id": "", "message": ""}
    conversation = store.get(conversation_id)

    if conversation is not None:
        if any(row["status"] in {"running", "cancelling"} for row in list_sessions(conversation_ids=[conversation_id])):
            print(f"[LocalAgent] tool-permission resume skipped: conversation busy conversation={conversation_id}")
        else:
            if allowed and execution_success:
                resume_message = (
                    f"用户已允许执行本次工具操作（{pending['tool_name']}）。"
                    "该操作的执行结果已写入上一条工具消息，请基于该结果继续完成用户请求。"
                )
            else:
                resume_message = "用户拒绝了该次操作。"

            resume = _start_resume_stream(conversation_id, conversation, resume_message)
            print(f"[LocalAgent] tool-permission resume conversation={conversation_id} "
                  f"tool={pending['tool_name']} allowed={allowed} started={resume.get('started')}")

    response = {
        "success": True,
        "message": message_text,
        "executed": allowed,
        "tool_success": execution_success,
        "resumed": bool(resume.get("started")),
        "resume_stream_id": str(resume.get("stream_id") or ""),
    }
    remember_resolved_tool_action(request_id, conversation_id, response)
    return jsonify(response)


@_local_bp.route("/api/user/info", methods=["GET"])
def local_agent_user_info():
    username = str(config.get("local_username", "local") or "local").strip() or "local"
    # 必须返回稳定的 id：前端 currentUsername 取 user.id 作为 localStorage 项目列表 key，
    # 缺失会导致 nexoracode_projects 无法持久化，重新打开后欢迎页历史项目丢失。
    return jsonify({"success": True, "user": {"id": username, "username": username, "nickname": "本地用户"}})


@_local_bp.route("/api/config", methods=["GET"])
def local_agent_config():
    """模型列表：本地 Provider 列表展开为 chat.js 期望的数组格式。

    default_model 是「用户上次选定的模型」：本地服务端口每次启动随机分配，
    WebView 的 localStorage 按 origin 隔离，重启后必然为空，任何依赖
    localStorage 的兜底都会失效。因此这里由后端作为唯一权威来源返回，
    前端不再自行缓存选中项。
    """
    models, default_model = _local_agent_model_catalog()
    model_ids = {model["id"] for model in models}
    selected_model_id = str(config.get("local_selected_model_id", "") or "").strip()

    if selected_model_id not in model_ids:
        selected_model_id = ""

    # 用户选过的模型优先于 Provider 的 default_id：后者只是「没选过」时的兜底，
    # 两者混用会让顶栏显示与实际使用的模型对不上。
    if selected_model_id:
        default_model = selected_model_id

    return jsonify({
        "success": True,
        "models": models,
        "providers": {},
        "default_model": default_model,
        "local_selected_model_id": selected_model_id,
    })


def _local_agent_model_catalog() -> tuple[list[dict[str, Any]], str]:
    """构建本地可用模型目录，并返回兜底默认模型（Provider 的 default_id）。"""
    from .Provider import get_default_provider

    models = []

    for provider in load_providers():
        if not provider.is_configured():
            continue

        model_id = f"{provider.provider_id}/{provider.model}"
        models.append({
            "id": model_id,
            "name": provider.model,
            "provider": provider.name,
            "context_window": provider.context_window,
            "thinking_protocol": provider.thinking_protocol,
        })

    default = get_default_provider()
    default_model = f"{default.provider_id}/{default.model}" if default.is_configured() else ""

    return models, default_model


@_local_bp.route("/api/local/default-model", methods=["POST"])
def local_agent_save_default_model():
    """保存没有活动会话时选定的模型，作为之后新会话的默认模型。"""
    raw_body = request.get_json(silent=True)
    body = raw_body if isinstance(raw_body, dict) else {}
    model_id = str(body.get("model_id") or "").strip()

    if not model_id:
        return jsonify({"success": False, "message": "模型 ID 不能为空"}), 400

    models, _ = _local_agent_model_catalog()

    if model_id not in {model["id"] for model in models}:
        return jsonify({"success": False, "message": "所选模型当前不可用"}), 400

    config.set("local_selected_model_id", model_id)

    return jsonify({"success": True, "local_selected_model_id": model_id})


@_local_bp.route("/api/local_agent/register", methods=["POST"])
def local_agent_register():
    """本地模式：工具注册即时返回，不依赖云端 WSS/register，避免阻塞本地加载。"""
    return jsonify({"success": True, "registered_tools": [], "local": True})


@_local_bp.route("/api/agent/status", methods=["GET"])
def local_agent_status():
    """本地模式：NexoraCode 本地工具始终在线，无需依赖云端 WSS。"""
    return jsonify({"online": True, "source": "local"})


@_local_bp.route("/api/chat/stream/cancel", methods=["POST"])
def local_agent_cancel_stream():
    """请求中断 StreamRuntime session（按 stream_id 或 conversation_id 定位）。"""
    data = request.get_json(silent=True) or {}
    stream_id = str(data.get("stream_id") or "").strip()
    conversation_id = str(data.get("conversation_id") or "").strip()

    if not stream_id and not conversation_id:
        return jsonify({"success": False, "message": "stream_id or conversation_id is required"}), 400

    if not stream_id:
        rows = list_sessions(conversation_ids=[conversation_id], include_done=False)
        cancelled_ids = []

        for row in rows:
            sid = str(row.get("stream_id") or "").strip()

            if sid and request_cancel(sid, reason="user_abort"):
                cancelled_ids.append(sid)

        if not cancelled_ids:
            return jsonify({"success": False, "message": "stream session not found"}), 404

        return jsonify({
            "success": True,
            "stream_ids": cancelled_ids,
            "conversation_id": conversation_id,
            "cancel_requested": True,
        })

    ok = request_cancel(stream_id, reason="user_abort")

    if not ok:
        return jsonify({"success": False, "message": "stream session not found"}), 404

    return jsonify({"success": True, "stream_id": stream_id, "cancel_requested": True})


@_local_bp.route("/api/chat/stream/reconnect", methods=["POST"])
def local_agent_reconnect_stream():
    """从指定 stream_id + from_seq 续读 SSE（切页面后回来自动重连）。"""
    data = request.get_json(silent=True) or {}
    stream_id = str(data.get("stream_id") or "").strip()

    if not stream_id:
        return jsonify({"success": False, "message": "stream_id is required"}), 400

    try:
        from_seq = int(data.get("from_seq") or 0)
    except Exception:
        from_seq = 0

    if get_session_meta(stream_id) is None:
        return jsonify({"success": False, "message": "stream session not found"}), 404

    resp = Response(
        stream_with_context(_iter_sse_from_session(stream_id, from_seq=from_seq)),
        status=200,
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
    return resp


@_local_bp.route("/api/chat/stream/content", methods=["GET"])
def local_agent_stream_content():
    """返回 session 累积的可见内容与可重放的 render chunks（reconnect 前补渲染用）。"""
    stream_id = str(request.args.get("stream_id") or "").strip()

    if not stream_id:
        return jsonify({"success": False, "message": "stream_id is required"}), 400

    result = get_accumulated_content(stream_id)

    if not result:
        return jsonify({"success": False, "message": "stream session not found"}), 404

    return jsonify({
        "success": True,
        "stream_id": result.get("stream_id", ""),
        "conversation_id": result.get("conversation_id", ""),
        "content": result.get("content", ""),
        "reasoning_content": result.get("reasoning_content", ""),
        "render_chunks": result.get("render_chunks", []),
        "last_seq": result.get("last_seq", 0),
        "status": result.get("status", ""),
    })


@_local_bp.route("/api/chat/stream/status", methods=["GET", "POST"])
def local_agent_stream_status():
    """返回指定 stream/conversation 的 session 状态（含 done 会话），供取消后轮询确认。"""
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        raw_ids = data.get("stream_ids", [])
        raw_conversation_ids = data.get("conversation_ids", [])
    else:
        raw = str(request.args.get("stream_ids") or request.args.get("ids") or "").strip()
        raw_ids = [part.strip() for part in raw.split(",")] if raw else []
        raw_conversation = str(request.args.get("conversation_ids") or request.args.get("conversation_id") or "").strip()
        raw_conversation_ids = [part.strip() for part in raw_conversation.split(",")] if raw_conversation else []

    if not isinstance(raw_ids, list):
        raw_ids = []

    if not isinstance(raw_conversation_ids, list):
        raw_conversation_ids = []

    stream_ids = [str(item or "").strip() for item in raw_ids if str(item or "").strip()]
    conversation_ids = [str(item or "").strip() for item in raw_conversation_ids if str(item or "").strip()]
    rows = list_sessions(stream_ids=stream_ids, conversation_ids=conversation_ids, include_done=True)

    return jsonify({"success": True, "sessions": rows})


# UI 偏好键：桌面端每次启动本地服务端口都会变（见 core/server.py bind_local_port），
# localStorage 按 origin 隔离会导致跨启动读不到，因此侧边栏折叠状态改由后端持久化。
_UI_PREFERENCE_KEYS = ("ui_sidebar_collapse",)


def _read_ui_preferences() -> dict:
    """读取已持久化的 UI 偏好；缺失/损坏时返回空对象，不阻断页面。"""
    stored = config.get("ui_preferences", {})

    if not isinstance(stored, dict):
        return {}

    return {
        key: stored[key]
        for key in _UI_PREFERENCE_KEYS
        if isinstance(stored.get(key), dict)
    }


@_local_bp.route("/api/user/preferences", methods=["GET", "POST"])
def local_agent_preferences():
    if request.method == "POST":
        payload = request.get_json(silent=True)
        incoming = payload.get("preferences") if isinstance(payload, dict) else None

        if not isinstance(incoming, dict):
            return jsonify({"success": False, "message": "preferences 必须是对象"}), 400

        # 只接受白名单键，避免任意键写入 config.json 污染其它设置。
        merged = _read_ui_preferences()

        for key in _UI_PREFERENCE_KEYS:
            if isinstance(incoming.get(key), dict):
                merged[key] = incoming[key]

        config.set("ui_preferences", merged)

        return jsonify({"success": True, "preferences": merged})

    return jsonify({"success": True, "preferences": _read_ui_preferences()})


@_local_bp.route("/api/user/profile", methods=["GET"])
def local_agent_profile():
    return jsonify({"success": True, "profile": {}})


@_local_bp.route("/api/notifications", methods=["GET"])
def local_agent_notifications():
    return jsonify({"success": True, "notifications": []})


@_local_bp.route("/api/tokens/stats", methods=["GET"])
def local_agent_token_stats():
    """从本地会话消息 metadata.io_tokens 聚合 Token 统计（支持按会话过滤）。

    汇总统计（input/output/raw_input/cached_input）基于完整历史计算，
    避免 limit 截断导致会话/全局统计只覆盖最近 20 条；history 仍只返回
    最近 20 条供 Token 详情弹窗展示。
    """
    conversation_id = str(request.args.get("conversation_id") or "").strip()
    store = ConversationStore()
    history = _build_token_history(store, conversation_id=conversation_id, limit=None)

    input_total = 0
    output_total = 0
    raw_input_total = 0
    cached_input_total = 0
    today_input = 0
    today_output = 0
    today_raw_input = 0
    today_cached_input = 0
    today_str = time.strftime("%Y-%m-%d")

    for item in history:
        input_total += int(item.get("input_tokens") or 0)
        output_total += int(item.get("output_tokens") or 0)
        raw_input_total += int(item.get("raw_input_tokens") or 0)
        cached_input_total += int(item.get("cached_input_tokens") or 0)

        if str(item.get("timestamp") or "").startswith(today_str):
            today_input += int(item.get("input_tokens") or 0)
            today_output += int(item.get("output_tokens") or 0)
            today_raw_input += int(item.get("raw_input_tokens") or 0)
            today_cached_input += int(item.get("cached_input_tokens") or 0)

    return jsonify({
        "success": True,
        "conversation_id": conversation_id or None,
        "input_total": input_total,
        "output_total": output_total,
        "raw_input_total": raw_input_total,
        "cached_input_total": cached_input_total,
        # 总量按原始输入计，与云端口径一致：缓存命中不从总量中扣减。
        "total": raw_input_total + output_total,
        "cache_hit_rate": _cache_hit_rate(raw_input_total, cached_input_total),
        "today_input": today_input,
        "today_output": today_output,
        "today_raw_input": today_raw_input,
        "today_cached_input": today_cached_input,
        "today": today_raw_input + today_output,
        "today_cache_hit_rate": _cache_hit_rate(today_raw_input, today_cached_input),
        "history": history[:20],
    })


@_local_bp.route("/api/tokens/detail", methods=["GET"])
def local_agent_token_detail():
    """按 detail_ref（{conversation_id}:{message_index}）返回单条 Token 调用详情。"""
    ref = str(request.args.get("ref") or "").strip()

    if not ref or ":" not in ref:
        return jsonify({"success": False, "message": "Token 详情引用无效"}), 400

    conversation_id, _, index_text = ref.partition(":")

    if index_text.startswith("compression-"):
        return _compression_token_detail(conversation_id, index_text)

    try:
        message_index = int(index_text)
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Token 详情引用无效"}), 400

    store = ConversationStore()
    conversation = store.get(conversation_id)

    if conversation is None:
        return jsonify({"success": False, "message": "会话不存在"}), 404

    messages = conversation.get("messages") if isinstance(conversation.get("messages"), list) else []

    if not (0 <= message_index < len(messages)):
        return jsonify({"success": False, "message": "Token 记录不存在或已过期"}), 404

    message = messages[message_index]

    if not isinstance(message, dict) or str(message.get("role") or "").strip() != "assistant":
        return jsonify({"success": False, "message": "Token 记录不存在或已过期"}), 404

    metadata = _message_metadata(message)
    io = metadata.get("io_tokens") if isinstance(metadata.get("io_tokens"), dict) else {}
    record = _usage_record(
        io,
        action="chat",
        detail_ref=f"{conversation_id}:{message_index}",
        conversation_id=conversation_id,
        conversation_title=str(conversation.get("title") or ""),
        timestamp=str(message.get("timestamp") or ""),
        model=str(metadata.get("model_name") or ""),
        response_trace_id=str(metadata.get("response_trace_id") or ""),
        round_index=_safe_tokens(metadata.get("round_index")),
    )
    cumulative = metadata.get("io_tokens_cumulative") if isinstance(metadata.get("io_tokens_cumulative"), dict) else {}
    user_message = _find_preceding_user_message(messages, message_index)
    assistant_content = _message_content_text(message.get("content"))

    return jsonify({
        "success": True,
        "detail": {
            **record,
            "title": "Token 调用详情",
            "available": True,
            # 累计口径是本次请求跨全部工具轮次的总和，与本轮窗口口径并列展示。
            "cumulative_input_tokens": _safe_tokens(cumulative.get("input")),
            "cumulative_output_tokens": _safe_tokens(cumulative.get("output")),
            "cumulative_raw_input_tokens": _safe_tokens(cumulative.get("raw_input")),
            "cumulative_cached_input_tokens": _safe_tokens(cumulative.get("cached_input")),
            "cost": _safe_float(io.get("cost")),
            "user_markdown": _message_content_text(user_message.get("content")) if user_message else "该消息没有文本内容。",
            "response_markdown": assistant_content or "该消息没有文本内容。",
        },
    })


def _on_title_generated(conversation_id: str, title: str) -> None:
    """标题生成完成后的即时推送：把新标题塞进该会话活跃流，前端无需刷新即可看到。"""
    append_chunk_to_conversation(conversation_id, {
        "type": "conversation_title",
        "conversation_id": str(conversation_id or ""),
        "title": str(title or ""),
    })


def register_local_routes(app, executor=None) -> None:
    if executor is not None:
        set_default_executor(executor)

    app.register_blueprint(_local_bp)
    plugin_manager = getattr(executor, "plugin_manager", None) if executor is not None else None
    if plugin_manager is not None:
        plugin_manager.register_routes(app)
    from .TaskService import task_bp, set_worker_factory
    from .TitleGenerator import set_title_listener

    set_worker_factory(_stream_worker_factory)
    set_title_listener(_on_title_generated)
    app.register_blueprint(task_bp)
    from .QueueRoutes import queue_bp
    app.register_blueprint(queue_bp)


def _compression_token_detail(conversation_id: str, index_text: str):
    conversation = ConversationStore().get(conversation_id)

    if conversation is None:
        return jsonify({"message": "会话不存在"}), 404

    try:
        index = int(index_text.removeprefix("compression-"))

        if index < 0:
            raise IndexError()

        call = conversation.get("context_compression_calls", [])[index]
    except (ValueError, IndexError):
        return jsonify({"message": "压缩调用记录不存在"}), 404

    record = _usage_record(
        call.get("usage") if isinstance(call.get("usage"), dict) else {},
        action="context_compression",
        detail_ref=f"{conversation_id}:compression-{index}",
        conversation_id=conversation_id,
        conversation_title=str(conversation.get("title") or ""),
        timestamp=str(call.get("timestamp") or ""),
        model=str(call.get("model_name") or ""),
        response_trace_id=str(call.get("response_trace_id") or ""),
        round_index=_safe_tokens(call.get("round_index")),
    )

    return jsonify({"success": True, "detail": {
        **record,
        "title": "上下文压缩调用",
        "available": True,
        "cost": _safe_float((call.get("usage") or {}).get("cost") if isinstance(call.get("usage"), dict) else 0),
        "finish_reason": str(call.get("finish_reason") or ""),
        "user_markdown": "上下文摘要请求",
        "response_markdown": str(call.get("summary") or ""),
    }})
