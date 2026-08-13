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
from typing import Any, Generator

from flask import Blueprint, Response, jsonify, request, stream_with_context

from core.config import config, get_app_root
from local import build_default_executor
from local.PathGuard import grant_temporary_permission
from .Provider import ProviderClient, load_provider
from .ConversationStore import ConversationStore
from .AgentLoop import AgentLoop


_local_bp = Blueprint("local_agent", __name__)
_EXECUTOR = None


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
            "需要访问项目外或敏感路径时，系统会自动向用户发起授权询问，无需额外调用权限工具。",
        ])
    else:
        lines.append("需要访问本地路径时，系统会自动向用户发起授权询问，无需额外调用权限工具。")

    return "\n".join(lines)


def _sse_event(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


def _stream_chat_generator(body: dict) -> Generator[str, None, None]:
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

    loop = _build_agent_loop(ProviderClient(target_config) if target_config is not None else None)

    if not message:
        yield _sse_event({"type": "error", "message": "消息不能为空"})

        return

    try:
        for event in loop.stream_send(conversation_id, message, system_prompt=system_prompt):
            event_type = str(event.get("type") or "")

            if event_type == "function_call":
                yield _sse_event({
                    "type": "function_call",
                    "name": event.get("name"),
                    "call_id": event.get("call_id"),
                    "arguments": json.dumps(event.get("arguments") or {}, ensure_ascii=False),
                })

            elif event_type == "function_result":
                yield _sse_event({
                    "type": "function_result",
                    "name": event.get("name"),
                    "call_id": event.get("call_id"),
                    "result": event.get("result"),
                    "success": bool(event.get("success")),
                })

            elif event_type == "question":
                yield _sse_event({
                    "type": "question",
                    "question": event.get("question"),
                    "await": True,
                })

            elif event_type == "conversation_id":
                yield _sse_event({
                    "type": "conversation_id",
                    "conversation_id": event.get("conversation_id"),
                })

            elif event_type == "content":
                yield _sse_event({
                    "type": "content",
                    "content": event.get("content"),
                })

            elif event_type == "error":
                yield _sse_event({"type": "error", "message": event.get("message")})

            elif event_type == "done":
                yield _sse_event({"type": "done"})

            else:
                yield _sse_event(event)
    except Exception as exc:
        try:
            print(f"[LocalAgent] stream error: {exc}")
        except Exception:
            pass

        yield _sse_event({"type": "error", "message": f"本地对话失败: {exc}"})

    yield "data: [DONE]\n\n"


@_local_bp.route("/api/chat/stream", methods=["POST"])
def local_agent_chat_stream():
    body = request.get_json(silent=True) or {}
    return Response(
        stream_with_context(_stream_chat_generator(body)),
        status=200,
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


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

    return jsonify({"success": True, "conversation": conversation})


@_local_bp.route("/api/conversations/<conv_id>/messages", methods=["GET"])
def local_agent_get_messages(conv_id: str):
    store = ConversationStore()
    conversation = store.get(conv_id)

    if conversation is None:
        return jsonify({"success": False, "message": "会话不存在"}), 404

    return jsonify({
        "success": True,
        "messages": conversation.get("messages", []),
        "total": len(conversation.get("messages", [])),
    })


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

    result = grant_temporary_permission(
        path=path,
        conversation_id=conversation_id,
        scope=scope,
        access=access,
        reason=reason,
        sensitive=sensitive,
    )

    if not bool(result.get("success", False)):
        return jsonify({"success": False, "message": result.get("error") or "授权失败"}), 502

    return jsonify({"success": True, "message": "已允许本次对话临时访问该路径", "permission": result.get("permission")})


@_local_bp.route("/api/user/info", methods=["GET"])
def local_agent_user_info():
    username = str(config.get("local_username", "local") or "local").strip() or "local"
    return jsonify({"success": True, "user": {"username": username, "nickname": "本地用户"}})


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
            "name": f"{provider.name} · {provider.model}",
            "provider": provider.name,
            "context_window": 0,
        })

    default = get_default_provider()
    default_model = f"{default.provider_id}/{default.model}" if default.is_configured() else ""

    return jsonify({
        "success": True,
        "models": models,
        "providers": {},
        "default_model": default_model,
    })


@_local_bp.route("/api/chat/stream/cancel", methods=["POST"])
def local_agent_cancel_stream():
    return jsonify({"success": True})


def register_local_routes(app, executor=None) -> None:
    if executor is not None:
        set_default_executor(executor)

    app.register_blueprint(_local_bp)
