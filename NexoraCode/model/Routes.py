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
import time
import threading
from typing import Any, Generator

from flask import Blueprint, Response, jsonify, request, send_file, stream_with_context

from core.config import config, get_app_root
from local import build_default_executor
from local.PathGuard import grant_temporary_permission
from .Provider import ProviderClient, load_provider, load_providers
from .ConversationStore import ConversationStore
from .AgentLoop import AgentLoop
from .StreamRuntime import (
    get_accumulated_content,
    get_session_meta,
    iter_session_chunks,
    list_sessions,
    request_cancel,
    start_session,
)
from .ToolPermissionPolicy import (
    PERMISSION_MODES,
    get_resolved_tool_action,
    get_permission_settings,
    list_approval_models,
    list_auto_approval_events,
    log_tool_permission_event,
    remember_resolved_tool_action,
    save_permission_settings,
    take_pending_tool_action,
)


_local_bp = Blueprint("local_agent", __name__)
_EXECUTOR = None


@_local_bp.after_request
def _local_no_store(resp):
    """本地动态 API 一律不缓存，避免模型/会话修改后拉到旧数据。"""
    resp.headers["Cache-Control"] = "no-store"
    return resp


@_local_bp.route("/permissions-settings.css", methods=["GET"])
def local_permissions_settings_css():
    return send_file(get_app_root() / "ui" / "permissions-settings.css", mimetype="text/css")


@_local_bp.route("/permissions-settings.js", methods=["GET"])
def local_permissions_settings_js():
    return send_file(get_app_root() / "ui" / "permissions-settings.js", mimetype="application/javascript")


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


def _build_system_prompt(conversation: dict | None) -> str:
    lines = [
        "你是 NexoraCode，运行在用户本地电脑上的编程助手。",
        "你可以通过 local_* 工具读取/修改用户本地文件、执行命令、搜索代码，以完成用户的开发任务。",
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

    return "\n".join(lines)


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

            metadata = dict(raw.get("metadata") or {})

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
            combined_metadata["process_steps"] = combined_steps

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

    return event


def _stream_worker_factory(body: dict):
    """构建 StreamRuntime 的 worker 回调：后台线程驱动 AgentLoop，chunks 写入 session。

    返回 worker(push_chunk, set_conversation_id, set_stage, is_cancel_requested)，
    与云端 start_stream_session 的 worker 签名对齐。
    """

    message = str(body.get("message") or "").strip()
    conversation_id = str(body.get("conversation_id") or "").strip()
    model_name = str(body.get("model_name") or "").strip()

    store = ConversationStore()
    conversation = store.get(conversation_id) if conversation_id else None
    system_prompt = _build_system_prompt(conversation)

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
        finished = threading.Event()

        def _watch_cancel():
            while not finished.wait(0.2):
                if is_cancel_requested():
                    loop.cancel()
                    return

        threading.Thread(target=_watch_cancel, daemon=True).start()

        try:
            for event in loop.stream_send(
                conversation_id,
                message,
                system_prompt=system_prompt,
                cancel_checker=is_cancel_requested,
                force_context_compression=body.get("force_context_compression") is True,
            ):
                event_type = str(event.get("type") or "")
                print(f"[LocalAgent] sse event: {event_type}")

                if event_type == "conversation_id" and event.get("conversation_id"):
                    set_conversation_id(str(event.get("conversation_id") or ""))

                push_chunk(_translate_event(event))
        except Exception as exc:
            print(f"[LocalAgent] stream error: {exc}")
            push_chunk({"type": "error", "message": f"本地对话失败: {exc}"})
            raise
        finally:
            finished.set()

        print("[LocalAgent] worker loop finished")

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

    return jsonify({"success": True, "conversation_id": conversation.get("conversation_id"), "title": title})


@_local_bp.route("/api/conversations/<conv_id>", methods=["GET"])
def local_agent_get_conversation(conv_id: str):
    store = ConversationStore()
    conversation = store.get(conv_id)

    if conversation is None:
        return jsonify({"success": False, "message": "会话不存在"}), 404

    conversation["messages"] = _normalize_history_messages(conversation.get("messages", []))

    return jsonify({"success": True, "conversation": conversation})


@_local_bp.route("/api/conversations/<conv_id>", methods=["DELETE"])
def local_agent_delete_conversation(conv_id: str):
    store = ConversationStore()
    deleted = store.delete(conv_id)

    if not deleted:
        return jsonify({"success": False, "message": "会话不存在"}), 404

    return jsonify({"success": True, "conversation_id": conv_id})


@_local_bp.route("/api/conversations/<conv_id>/messages", methods=["GET"])
def local_agent_get_messages(conv_id: str):
    store = ConversationStore()
    conversation = store.get(conv_id)

    if conversation is None:
        return jsonify({"success": False, "message": "会话不存在"}), 404

    normalized = _normalize_history_messages(conversation.get("messages", []))

    if request.args.get("merge_agent_rounds") == "1":
        normalized = _merge_agent_response_rounds(normalized)

    return jsonify({
        "success": True,
        "messages": normalized,
        "total": len(normalized),
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

    if not conversation_id:
        return jsonify({"success": False, "message": "conversation_id 不能为空"}), 400

    if not path:
        return jsonify({"success": False, "message": "授权路径不能为空"}), 400

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
        print(f"[LocalAgent] grant failed: {result.get('error')}")
        return jsonify({"success": False, "message": result.get("error") or "授权失败"}), 502

    print(f"[LocalAgent] grant OK: path={result.get('permission', {}).get('path')}")
    return jsonify({"success": True, "message": "已允许本次对话临时访问该路径", "permission": result.get("permission")})


@_local_bp.route("/api/local/permissions", methods=["GET", "POST"])
def local_agent_permission_settings():
    """读取或保存本地 Agent 工具权限模式与自动审批模型。"""
    if request.method == "GET":
        settings = get_permission_settings()
        return jsonify({
            "success": True,
            "mode": settings["mode"],
            "approval_model_id": settings["approval_model_id"],
            "models": list_approval_models(),
        })

    raw_body = request.get_json(silent=True)
    body = raw_body if isinstance(raw_body, dict) else {}

    try:
        save_permission_settings(
            mode=str(body.get("mode") or ""),
            approval_model_id=str(body.get("approval_model_id") or ""),
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
    mode = get_permission_settings()["mode"]
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
        tool_content = "用户拒绝执行本次工具操作。"
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

    response = {
        "success": True,
        "message": message_text,
        "executed": allowed,
        "tool_success": execution_success,
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
    """模型列表：本地 Provider 列表展开为 chat.js 期望的数组格式。"""
    from .Provider import get_default_provider, load_providers

    providers = load_providers()
    models = []

    for provider in providers:
        if not provider.is_configured():
            continue

        model_id = f"{provider.provider_id}/{provider.model}"
        models.append({
            "id": model_id,
            "name": provider.model,
            "provider": provider.name,
            "context_window": provider.context_window,
        })

    default = get_default_provider()
    default_model = f"{default.provider_id}/{default.model}" if default.is_configured() else ""

    return jsonify({
        "success": True,
        "models": models,
        "providers": {},
        "default_model": default_model,
    })


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


@_local_bp.route("/api/user/preferences", methods=["GET", "POST"])
def local_agent_preferences():
    if request.method == "POST":
        return jsonify({"success": True})

    return jsonify({"success": True, "preferences": {}})


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


def register_local_routes(app, executor=None) -> None:
    if executor is not None:
        set_default_executor(executor)

    app.register_blueprint(_local_bp)
    from .TaskService import task_bp, set_worker_factory

    set_worker_factory(_stream_worker_factory)
    app.register_blueprint(task_bp)


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
