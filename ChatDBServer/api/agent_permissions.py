from __future__ import annotations

from typing import Any, Dict

from flask import Blueprint, jsonify, request, session

from agent_tunnel import call_local_tool_sync, get_agent_tools, is_agent_online


agent_permissions_bp = Blueprint("agent_permissions", __name__)


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _has_registered_tool(username: str, tool_name: str) -> bool:
    target = _clean_text(tool_name)

    if not target:
        return False

    for item in get_agent_tools(username) or []:
        if not isinstance(item, dict):
            continue

        name = _clean_text(item.get("name"))
        function = item.get("function") if isinstance(item.get("function"), dict) else {}

        if not name:
            name = _clean_text(function.get("name"))

        if name == target:
            return True

    return False


def _normalize_scope(value: Any) -> str:
    scope = _clean_text(value).lower() or "file"

    if scope not in {"file", "dir"}:
        return ""

    return scope


def _normalize_access(value: Any) -> str:
    access = _clean_text(value).lower() or "read"

    if access not in {"read", "write", "read_write"}:
        return ""

    return access


@agent_permissions_bp.route("/api/agent/permission/grant", methods=["POST"])
def grant_agent_permission():
    username = _clean_text(session.get("username"))

    if not username:
        return jsonify({"success": False, "message": "请先登录"}), 401

    payload = request.get_json(silent=True) or {}

    if not isinstance(payload, dict):
        return jsonify({"success": False, "message": "请求格式无效"}), 400

    request_payload = payload.get("permission_request")
    if not isinstance(request_payload, dict):
        request_payload = payload

    conversation_id = _clean_text(payload.get("conversation_id") or request_payload.get("conversation_id"))
    path = _clean_text(request_payload.get("path"))
    scope = _normalize_scope(request_payload.get("scope"))
    access = _normalize_access(request_payload.get("access") or request_payload.get("operation"))
    reason = _clean_text(request_payload.get("reason"))
    sensitive = bool(request_payload.get("sensitive", False))

    if not conversation_id:
        return jsonify({"success": False, "message": "conversation_id 不能为空"}), 400

    if not path:
        return jsonify({"success": False, "message": "授权路径不能为空"}), 400

    if not scope:
        return jsonify({"success": False, "message": "授权范围必须是 file 或 dir"}), 400

    if not access:
        return jsonify({"success": False, "message": "授权类型必须是 read、write 或 read_write"}), 400

    if not reason:
        return jsonify({"success": False, "message": "授权原因不能为空"}), 400

    if not is_agent_online(username):
        return jsonify({"success": False, "message": "NexoraCode 未在线，无法写入本次对话临时授权"}), 409

    if not _has_registered_tool(username, "local_permission_grant"):
        return jsonify({"success": False, "message": "NexoraCode 尚未注册 local_permission_grant 工具"}), 409

    result = call_local_tool_sync(
        username,
        "local_permission_grant",
        {
            "path": path,
            "scope": scope,
            "access": access,
            "reason": reason,
            "sensitive": sensitive,
            "conversation_id": conversation_id,
        },
        timeout_sec=15,
        context={
            "conversation_id": conversation_id,
            "username": username,
        },
    )

    if not isinstance(result, dict):
        return jsonify({"success": False, "message": "NexoraCode 返回格式无效"}), 502

    if result.get("error") and not result.get("success", True):
        return jsonify({
            "success": False,
            "message": _clean_text(result.get("message") or result.get("error") or "授权失败"),
            "result": result,
        }), 502

    local_result = result.get("result", result)

    if not isinstance(local_result, dict):
        return jsonify({"success": False, "message": "本地授权工具返回格式无效", "result": result}), 502

    if not bool(local_result.get("success", False)):
        return jsonify({
            "success": False,
            "message": _clean_text(local_result.get("message") or local_result.get("error") or "授权失败"),
            "result": local_result,
        }), 502

    return jsonify({
        "success": True,
        "message": "已允许本次对话临时访问该路径",
        "permission": local_result.get("permission"),
        "conversation_id": conversation_id,
    })
