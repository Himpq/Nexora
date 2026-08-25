from typing import Any, Dict, List
import mimetypes

from flask import Blueprint, jsonify, request, send_file, session

from basis.User import User
from App.Observability import create_user_notification
from basis.Database import safe_read_json
from App.Storage import UserFileSandbox
from App.Utils import safe_filename
from App.errors import json_error

from .storage import (
    DATA_DIR,
    WorkspaceStore,
    find_store_for_visible_workspace,
    list_visible_workspaces,
    normalize_visibility,
    normalize_shared_users,
    normalize_text,
    validate_username,
    validate_workspace_id,
)


workspace_bp = Blueprint("workspace", __name__)
USERS_PATH = f"{DATA_DIR}/user.json"


def current_username() -> str:
    username = str(session.get("username") or "").strip()

    if not username:
        raise PermissionError("login required")

    return validate_username(username)


def parse_json_body() -> Dict[str, Any]:
    data = request.get_json(silent=True)

    if data is None:
        return {}

    if not isinstance(data, dict):
        raise ValueError("request body must be a JSON object")

    return data


def parse_bool_query(name: str) -> bool:
    value = str(request.args.get(name) or "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def parse_file_ref(value: Any) -> str:
    text = str(value or "").replace("\\", "/").strip()

    if len(text) > 260:
        raise ValueError("file_ref cannot exceed 260 characters")

    return text


def load_workspace_users() -> Dict[str, Any]:
    users = safe_read_json(USERS_PATH, default={})

    if not isinstance(users, dict):
        raise ValueError("user.json root must be an object")

    return users


def extract_workspace_shared_users(workspace: Dict[str, Any]) -> List[str]:
    settings = workspace.get("settings") if isinstance(workspace.get("settings"), dict) else {}
    owner = validate_username(str(workspace.get("owner_username") or ""))
    return normalize_shared_users(settings.get("shared_users", []), owner)


def assert_workspace_share_users_exist(shared_users: List[str]) -> None:
    users = load_workspace_users()
    missing_users = [user_id for user_id in shared_users if user_id not in users]

    if missing_users:
        raise ValueError(f"共享用户不存在: {', '.join(missing_users)}")


def notify_workspace_share_users(workspace: Dict[str, Any], added_users: List[str], actor_username: str) -> None:
    if not added_users:
        return

    workspace_id = validate_workspace_id(str(workspace.get("workspace_id") or ""))
    title = normalize_text(workspace.get("title") or "Untitled Workspace", 120) or "Untitled Workspace"
    actor = validate_username(actor_username)

    for target_username in added_users:
        create_user_notification(target_username, {
            "title": "Workspace 分享",
            "content": f"{actor} 将 Workspace「{title}」分享给你。",
            "source": "Workspace",
            "level": "info",
            "jumpto": f"workspace:{workspace_id}",
            "meta": {
                "type": "workspace_share",
                "workspace_id": workspace_id,
                "workspace_title": title,
                "actor": actor,
            },
        })


def assert_basis_knowledge_exists(username: str, title: str) -> None:
    try:
        User(username).getBasisContent(title)
    except KeyError:
        raise FileNotFoundError(f"knowledge not found: {title}")


def handle_workspace_error(error: Exception):
    if isinstance(error, PermissionError):
        message = str(error) or "permission denied"
        status = 401 if message == "login required" else 403
        return json_error(message, status)

    if isinstance(error, FileNotFoundError):
        return json_error(str(error) or "workspace not found", 404)

    if isinstance(error, ValueError):
        return json_error(str(error), 400)

    if isinstance(error, PermissionError):
        return json_error(str(error) or "workspace access denied", 403)

    return json_error(str(error) or "workspace request failed", 500)


@workspace_bp.route("/api/workspace/list", methods=["GET"])
def list_workspaces():
    try:
        username = current_username()
        include_marks = parse_bool_query("include_marks")

        return jsonify({
            "success": True,
            "workspaces": list_visible_workspaces(username, include_marks=include_marks),
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/create", methods=["POST"])
def create_workspace():
    try:
        username = current_username()
        data = parse_json_body()
        title = normalize_text(data.get("title") or data.get("name") or "Untitled Workspace", 120)
        shared_users = normalize_shared_users(data.get("shared_users", []), username)
        workspace = WorkspaceStore(username).create_workspace(title, shared_users)

        return jsonify({
            "success": True,
            "workspace": workspace,
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>", methods=["GET"])
def get_workspace(workspace_id):
    try:
        username = current_username()
        wid = validate_workspace_id(workspace_id)
        store = find_store_for_visible_workspace(username, wid)

        return jsonify({
            "success": True,
            "workspace": store.get_workspace(wid, username),
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>", methods=["DELETE"])
def delete_workspace(workspace_id):
    try:
        username = current_username()
        wid = validate_workspace_id(workspace_id)
        deleted = WorkspaceStore(username).delete_workspace(wid)

        return jsonify({
            "success": True,
            "workspace_id": deleted.get("workspace_id", wid),
            "title": deleted.get("title", ""),
            "message": "Workspace 已删除；关联的对话、知识库和文件未删除。",
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/conversations", methods=["POST"])
def add_workspace_conversation(workspace_id):
    try:
        username = current_username()
        data = parse_json_body()
        wid = validate_workspace_id(workspace_id)
        conversation_id = normalize_text(data.get("conversation_id"), 80)
        store = find_store_for_visible_workspace(username, wid)
        workspace = store.add_conversation(wid, conversation_id, username)

        return jsonify({
            "success": True,
            "workspace": workspace,
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/conversations/<conversation_id>/visibility", methods=["POST"])
def update_workspace_conversation_visibility(workspace_id, conversation_id):
    try:
        username = current_username()
        data = parse_json_body()
        wid = validate_workspace_id(workspace_id)
        cid = normalize_text(conversation_id or data.get("conversation_id"), 80)
        visibility = normalize_visibility(data.get("visibility"))
        store = find_store_for_visible_workspace(username, wid)
        workspace = store.update_conversation_visibility(wid, cid, username, visibility)

        return jsonify({
            "success": True,
            "workspace": workspace,
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/conversations/<conversation_id>/pin", methods=["POST"])
def update_workspace_conversation_pin(workspace_id, conversation_id):
    try:
        username = current_username()
        data = parse_json_body()
        wid = validate_workspace_id(workspace_id)
        cid = normalize_text(conversation_id or data.get("conversation_id"), 80)
        pin = bool(data.get("pin", False))
        store = find_store_for_visible_workspace(username, wid)
        workspace = store.update_conversation_pin(wid, cid, username, pin)

        return jsonify({
            "success": True,
            "workspace": workspace,
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/conversations/<conversation_id>", methods=["GET"])
def get_workspace_conversation(workspace_id, conversation_id):
    try:
        username = current_username()
        wid = validate_workspace_id(workspace_id)
        cid = normalize_text(conversation_id, 80)
        store = find_store_for_visible_workspace(username, wid)
        payload = store.get_visible_conversation(wid, cid, username)

        return jsonify({
            "success": True,
            "conversation": payload["conversation"],
            "marker": payload["marker"],
            "readonly": payload["readonly"],
            "owner_username": payload["owner_username"],
            "workspace_id": payload["workspace_id"],
            "workspace_title": payload["workspace_title"],
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/conversations/<conversation_id>", methods=["DELETE"])
def remove_workspace_conversation(workspace_id, conversation_id):
    try:
        username = current_username()
        wid = validate_workspace_id(workspace_id)
        cid = normalize_text(conversation_id, 80)
        store = find_store_for_visible_workspace(username, wid)
        workspace = store.remove_conversation(wid, cid, username)

        return jsonify({
            "success": True,
            "workspace": workspace,
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/knowledge", methods=["POST"])
def add_workspace_knowledge_document(workspace_id):
    try:
        username = current_username()
        data = parse_json_body()
        wid = validate_workspace_id(workspace_id)
        title = normalize_text(data.get("title") or data.get("knowledge_title"), 160)
        knowledge_type = normalize_text(data.get("knowledge_type") or data.get("type") or "basis", 32) or "basis"

        if not title:
            raise ValueError("knowledge title is required")

        if knowledge_type != "basis":
            raise ValueError("knowledge_type must be basis")

        assert_basis_knowledge_exists(username, title)
        store = find_store_for_visible_workspace(username, wid)
        workspace = store.add_knowledge_document(wid, title, username, knowledge_type)

        return jsonify({
            "success": True,
            "workspace": workspace,
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/knowledge", methods=["DELETE"])
def remove_workspace_knowledge_document(workspace_id):
    try:
        username = current_username()
        data = parse_json_body()
        wid = validate_workspace_id(workspace_id)
        title = normalize_text(data.get("title") or data.get("knowledge_title"), 160)
        knowledge_type = normalize_text(data.get("knowledge_type") or data.get("type") or "basis", 32) or "basis"

        if not title:
            raise ValueError("knowledge title is required")

        if knowledge_type != "basis":
            raise ValueError("knowledge_type must be basis")

        store = find_store_for_visible_workspace(username, wid)
        workspace = store.remove_knowledge_document(wid, title, username, knowledge_type)

        return jsonify({
            "success": True,
            "workspace": workspace,
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/knowledge/blank", methods=["POST"])
def create_workspace_blank_knowledge_document(workspace_id):
    try:
        username = current_username()
        data = parse_json_body()
        wid = validate_workspace_id(workspace_id)
        title_prefix = normalize_text(data.get("title_prefix") or data.get("title") or "未命名知识库", 120)
        store = find_store_for_visible_workspace(username, wid)

        store.assert_can_edit_workspace(wid, username)
        title = User(username).addBlankBasis(title_prefix or "未命名知识库", timeline_actor=username)
        workspace = store.add_knowledge_document(wid, title, username, "basis")

        return jsonify({
            "success": True,
            "title": title,
            "knowledge_type": "basis",
            "workspace": workspace,
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/knowledge/visibility", methods=["POST"])
def update_workspace_knowledge_visibility(workspace_id):
    try:
        username = current_username()
        data = parse_json_body()
        wid = validate_workspace_id(workspace_id)
        title = normalize_text(data.get("title") or data.get("knowledge_title"), 160)
        knowledge_type = normalize_text(data.get("knowledge_type") or data.get("type") or "basis", 32) or "basis"
        visibility = normalize_visibility(data.get("visibility"))
        store = find_store_for_visible_workspace(username, wid)
        workspace = store.update_knowledge_document_visibility(
            wid,
            title,
            username,
            visibility,
            knowledge_type,
        )

        return jsonify({
            "success": True,
            "workspace": workspace,
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/knowledge/pin", methods=["POST"])
def update_workspace_knowledge_pin(workspace_id):
    try:
        username = current_username()
        data = parse_json_body()
        wid = validate_workspace_id(workspace_id)
        title = normalize_text(data.get("title") or data.get("knowledge_title"), 160)
        knowledge_type = normalize_text(data.get("knowledge_type") or data.get("type") or "basis", 32) or "basis"
        added_by = normalize_text(data.get("added_by") or data.get("owner_username"), 128)
        pin = bool(data.get("pin", False))
        store = find_store_for_visible_workspace(username, wid)
        workspace = store.update_knowledge_document_pin(
            wid,
            title,
            username,
            pin,
            knowledge_type,
            added_by,
        )

        return jsonify({
            "success": True,
            "workspace": workspace,
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/files", methods=["POST"])
def add_workspace_file(workspace_id):
    try:
        username = current_username()
        data = parse_json_body()
        wid = validate_workspace_id(workspace_id)
        file_ref = parse_file_ref(data.get("file_ref") or data.get("sandbox_path") or data.get("alias"))
        store = find_store_for_visible_workspace(username, wid)
        workspace = store.add_file(wid, file_ref, username)

        return jsonify({
            "success": True,
            "workspace": workspace,
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/files/visibility", methods=["POST"])
def update_workspace_file_visibility(workspace_id):
    try:
        username = current_username()
        data = parse_json_body()
        wid = validate_workspace_id(workspace_id)
        file_ref = parse_file_ref(data.get("file_ref") or data.get("sandbox_path") or data.get("alias"))
        visibility = normalize_visibility(data.get("visibility"))
        store = find_store_for_visible_workspace(username, wid)
        workspace = store.update_file_visibility(wid, file_ref, username, visibility)

        return jsonify({
            "success": True,
            "workspace": workspace,
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/files/pin", methods=["POST"])
def update_workspace_file_pin(workspace_id):
    try:
        username = current_username()
        data = parse_json_body()
        wid = validate_workspace_id(workspace_id)
        file_ref = parse_file_ref(data.get("file_ref") or data.get("sandbox_path") or data.get("alias"))
        added_by = normalize_text(data.get("added_by") or data.get("owner_username"), 128)
        pin = bool(data.get("pin", False))
        store = find_store_for_visible_workspace(username, wid)
        workspace = store.update_file_pin(wid, file_ref, username, pin, added_by)

        return jsonify({
            "success": True,
            "workspace": workspace,
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/files/read", methods=["GET"])
def read_workspace_file(workspace_id):
    try:
        username = current_username()
        wid = validate_workspace_id(workspace_id)
        file_ref = parse_file_ref(request.args.get("file_ref") or request.args.get("sandbox_path") or "")
        added_by = normalize_text(request.args.get("added_by") or request.args.get("owner_username") or "", 128)
        store = find_store_for_visible_workspace(username, wid)
        payload = store.get_visible_file(wid, file_ref, username, added_by)
        owner = validate_username(str(payload.get("owner_username") or ""))
        marker = payload.get("marker") if isinstance(payload.get("marker"), dict) else {}
        file_payload = UserFileSandbox(owner).read_file(marker.get("file_ref") or file_ref)

        if not file_payload.get("success"):
            return json_error(file_payload.get("message") or "文件读取失败", 400)

        return jsonify({
            "success": True,
            "file": file_payload.get("file", {}),
            "content": file_payload.get("content", ""),
            "truncated": bool(file_payload.get("truncated", False)),
            "truncate_at": file_payload.get("truncate_at"),
            "limits": file_payload.get("limits", {}),
            "marker": marker,
            "readonly": payload.get("readonly", True),
            "owner_username": owner,
            "workspace_id": payload.get("workspace_id"),
            "workspace_title": payload.get("workspace_title"),
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/files/download", methods=["GET"])
def download_workspace_file(workspace_id):
    try:
        username = current_username()
        wid = validate_workspace_id(workspace_id)
        file_ref = parse_file_ref(request.args.get("file_ref") or request.args.get("sandbox_path") or "")
        added_by = normalize_text(request.args.get("added_by") or request.args.get("owner_username") or "", 128)
        store = find_store_for_visible_workspace(username, wid)
        payload = store.get_visible_file(wid, file_ref, username, added_by)
        owner = validate_username(str(payload.get("owner_username") or ""))
        marker = payload.get("marker") if isinstance(payload.get("marker"), dict) else {}
        sandbox = UserFileSandbox(owner)
        entry = sandbox._get_entry(marker.get("file_ref") or file_ref)
        abs_path = sandbox._get_abs_path(entry)
        download_name = safe_filename(
            entry.get("original_name") or entry.get("alias") or "download.txt",
            default="download.txt",
            max_len=180,
        )
        inline = str(request.args.get("inline") or "").strip().lower() in {"1", "true", "yes", "on"}
        mimetype = mimetypes.guess_type(download_name)[0] or "application/octet-stream"

        return send_file(abs_path, as_attachment=not inline, download_name=download_name, mimetype=mimetype)
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/tasks", methods=["POST"])
def create_workspace_task(workspace_id):
    try:
        username = current_username()
        data = parse_json_body()
        wid = validate_workspace_id(workspace_id)
        store = find_store_for_visible_workspace(username, wid)
        workspace = store.create_workspace_task(wid, username, data)

        return jsonify({
            "success": True,
            "workspace": workspace,
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/tasks/<task_id>", methods=["POST"])
def update_workspace_task(workspace_id, task_id):
    try:
        username = current_username()
        data = parse_json_body()
        wid = validate_workspace_id(workspace_id)
        safe_task_id = normalize_text(task_id or data.get("task_id"), 80)
        store = find_store_for_visible_workspace(username, wid)
        workspace = store.update_workspace_task(wid, safe_task_id, username, data)

        return jsonify({
            "success": True,
            "workspace": workspace,
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/tasks/<task_id>", methods=["DELETE"])
def delete_workspace_task(workspace_id, task_id):
    try:
        username = current_username()
        wid = validate_workspace_id(workspace_id)
        safe_task_id = normalize_text(task_id, 80)
        store = find_store_for_visible_workspace(username, wid)
        workspace = store.delete_workspace_task(wid, safe_task_id, username)

        return jsonify({
            "success": True,
            "workspace": workspace,
        })
    except Exception as error:
        return handle_workspace_error(error)


@workspace_bp.route("/api/workspace/<workspace_id>/settings", methods=["POST"])
def update_workspace_settings(workspace_id):
    try:
        username = current_username()
        data = parse_json_body()
        wid = validate_workspace_id(workspace_id)
        store = find_store_for_visible_workspace(username, wid)
        before_workspace = store.get_workspace(wid, username)
        before_shared_users = extract_workspace_shared_users(before_workspace)

        if "shared_users" in data:
            next_shared_users = normalize_shared_users(data.get("shared_users"), username)
            assert_workspace_share_users_exist(next_shared_users)
            data["shared_users"] = next_shared_users

        workspace = store.update_settings(wid, username, data)

        if "shared_users" in data:
            after_shared_users = extract_workspace_shared_users(workspace)
            added_users = [
                user_id
                for user_id in after_shared_users
                if user_id not in before_shared_users
            ]
            notify_workspace_share_users(workspace, added_users, username)

        return jsonify({
            "success": True,
            "workspace": workspace,
        })
    except Exception as error:
        return handle_workspace_error(error)
