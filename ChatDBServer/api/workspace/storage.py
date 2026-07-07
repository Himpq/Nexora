import hashlib
import os
import re
import secrets
from datetime import datetime
from typing import Any, Dict, List

from api.conversation_manager import ConversationManager
from api.datastorage import get_path_lock, safe_read_json, safe_write_json
from api.text_patch import apply_text_patch, build_preview_diff


BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA_DIR = os.path.join(BASE_DIR, "data")
WORKSPACE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{8,48}$")
USER_ID_RE = re.compile(r"^[^/\\\s][^/\\]{0,127}$")
VISIBILITY_VALUES = {"share", "private"}
WORKSPACE_TASK_STATUS_VALUES = {"todo", "doing", "blocked", "done", "cancelled"}
WORKSPACE_TASK_SOURCE_VALUES = {"manual", "conversation", "knowledge", "file", "mail", "memory", "other"}
WORKSPACE_TASK_COLOR_VALUES = {"blue", "green", "amber", "rose", "violet", "cyan", "slate"}
WORKSPACE_TASK_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
WORKSPACE_TEXT_LIMIT = 5000
WORKSPACE_FILE_REF_LIMIT = 260
WORKSPACE_TASK_NOTES_LIMIT = 1000
WORKSPACE_ACTIVITY_LIMIT = 200


def utc_now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def normalize_text(value: Any, limit: int = 120) -> str:
    text = " ".join(str(value or "").split())

    if len(text) > limit:
        text = text[:limit].strip()

    return text


def normalize_workspace_markdown(value: Any, limit: int = WORKSPACE_TEXT_LIMIT) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()

    if len(text) > limit:
        text = text[:limit].rstrip()

    return text


def validate_workspace_markdown(value: Any, field_name: str, limit: int = WORKSPACE_TEXT_LIMIT) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()

    if len(text) > limit:
        raise ValueError(f"{field_name} cannot exceed {limit} characters")

    return text


def workspace_text_sha256(content: Any) -> str:
    return hashlib.sha256(str(content or "").encode("utf-8")).hexdigest()


def normalize_workspace_text_block(value: Any) -> Dict[str, Any]:
    block = value if isinstance(value, dict) else {"content": value}

    return {
        "enabled": bool(block.get("enabled", True)),
        "content": normalize_workspace_markdown(block.get("content"), WORKSPACE_TEXT_LIMIT),
        "updated_by": normalize_text(block.get("updated_by"), 128),
        "updated_at": normalize_text(block.get("updated_at"), 64),
    }


def message_content_to_text(content: Any) -> str:
    """Extract readable text from the stored chat message content structure."""
    if content is None:
        return ""

    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts: List[str] = []

        for item in content:
            if isinstance(item, str):
                text = item.strip()

                if text:
                    parts.append(text)

                continue

            if isinstance(item, dict):
                text = str(item.get("text") or item.get("input_text") or item.get("content") or "").strip()

                if text:
                    parts.append(text)

        return "\n".join(parts)

    if isinstance(content, dict):
        return str(content.get("text") or content.get("input_text") or content.get("content") or "")

    return str(content)


def last_user_question_from_messages(messages: Any) -> str:
    """Return the latest user question from a conversation messages list."""
    if not isinstance(messages, list):
        return ""

    for message in reversed(messages):
        if not isinstance(message, dict):
            continue

        role = str(message.get("role") or "").strip().lower()

        if role != "user":
            continue

        text = normalize_text(message_content_to_text(message.get("content")), 220)

        if text:
            return text

    return ""


def validate_username(username: str) -> str:
    user = normalize_text(username, 128)

    if not user:
        raise ValueError("username is required")

    if not USER_ID_RE.match(user):
        raise ValueError("username contains invalid path characters")

    return user


def validate_workspace_id(workspace_id: str) -> str:
    wid = normalize_text(workspace_id, 64)

    if not WORKSPACE_ID_RE.match(wid):
        raise ValueError("workspace_id is invalid")

    return wid


def normalize_visibility(value: Any) -> str:
    visibility = normalize_text(value, 16).lower()

    if visibility not in VISIBILITY_VALUES:
        raise ValueError("visibility must be share or private")

    return visibility


def normalize_shared_users(value: Any, owner_username: str) -> List[str]:
    if value is None:
        return []

    if not isinstance(value, list):
        raise ValueError("shared_users must be a list")

    owner = validate_username(owner_username)
    result: List[str] = []
    seen = set()

    for item in value:
        user = validate_username(str(item or ""))

        if user == owner:
            continue

        if user in seen:
            continue

        seen.add(user)
        result.append(user)

    return result


def normalize_workspace_file_ref(value: Any, default_username: str) -> Dict[str, str]:
    raw = str(value or "").replace("\\", "/").strip().strip("/")
    default_user = validate_username(default_username)

    if not raw:
        raise ValueError("file_ref is required")

    if len(raw) > WORKSPACE_FILE_REF_LIMIT:
        raise ValueError(f"file_ref cannot exceed {WORKSPACE_FILE_REF_LIMIT} characters")

    owner = default_user
    alias_source = raw
    marker = "/files/"
    alt_prefix = f"files/{default_user}/"

    if marker in raw:
        owner_raw, alias_raw = raw.split(marker, 1)
        owner = validate_username(owner_raw.strip("/"))
        alias_source = alias_raw
    elif raw.startswith(alt_prefix):
        alias_source = raw[len(alt_prefix):]

    alias = alias_source.replace("\\", "/").strip().strip("/")

    if not alias or alias in {".", ".."} or "/../" in f"/{alias}/" or "/./" in f"/{alias}/":
        raise ValueError("file_ref is invalid")

    if len(alias) > 260:
        raise ValueError("file alias cannot exceed 260 characters")

    return {
        "added_by": owner,
        "alias": alias,
        "file_ref": f"{owner}/files/{alias}",
    }


def user_root(username: str) -> str:
    user = validate_username(username)
    root = os.path.abspath(os.path.join(DATA_DIR, "users", user))
    users_root = os.path.abspath(os.path.join(DATA_DIR, "users"))

    if os.path.commonpath([users_root, root]) != users_root:
        raise ValueError("resolved user path escaped users root")

    return root


def workspaces_root(username: str) -> str:
    return os.path.join(user_root(username), "workspaces")


def workspace_dir(username: str, workspace_id: str) -> str:
    user = validate_username(username)
    wid = validate_workspace_id(workspace_id)
    root = os.path.abspath(workspaces_root(user))
    target = os.path.abspath(os.path.join(root, wid))

    if os.path.commonpath([root, target]) != root:
        raise ValueError("resolved workspace path escaped workspace root")

    return target


def workspace_json_path(username: str, workspace_id: str) -> str:
    return os.path.join(workspace_dir(username, workspace_id), "workspace.json")


def new_workspace_id() -> str:
    return "ws_" + secrets.token_urlsafe(12).replace("-", "_")


def new_workspace_task_id() -> str:
    return "task_" + secrets.token_urlsafe(10).replace("-", "_")


def new_workspace_activity_id() -> str:
    return "act_" + secrets.token_urlsafe(10).replace("-", "_")


def normalize_workspace_task_status(value: Any) -> str:
    status = normalize_text(value or "todo", 32).lower() or "todo"

    if status not in WORKSPACE_TASK_STATUS_VALUES:
        raise ValueError("task status must be todo, doing, blocked, done or cancelled")

    return status


def normalize_workspace_task_source_type(value: Any) -> str:
    source_type = normalize_text(value or "manual", 32).lower() or "manual"

    if source_type not in WORKSPACE_TASK_SOURCE_VALUES:
        raise ValueError("task source_type must be manual, conversation, knowledge, file, mail, memory or other")

    return source_type


def normalize_workspace_task_color(value: Any) -> str:
    color = normalize_text(value or "blue", 32).lower() or "blue"

    if color not in WORKSPACE_TASK_COLOR_VALUES:
        raise ValueError("task color must be blue, green, amber, rose, violet, cyan or slate")

    return color


def normalize_workspace_task_date(value: Any, field_name: str) -> str:
    text = normalize_text(value, 32)

    if not text:
        return ""

    if not WORKSPACE_TASK_DATE_RE.match(text):
        raise ValueError(f"{field_name} must use YYYY-MM-DD")

    try:
        datetime.strptime(text, "%Y-%m-%d")
    except ValueError:
        raise ValueError(f"{field_name} must be a valid date")

    return text


def default_workspace_payload(
    owner_username: str,
    workspace_id: str,
    title: str,
    shared_users: List[str],
) -> Dict[str, Any]:
    now = utc_now_iso()

    return {
        "schema_version": 1,
        "workspace_id": workspace_id,
        "title": title,
        "owner_username": owner_username,
        "created_at": now,
        "updated_at": now,
        "settings": {
            "shared_users": shared_users,
            "conversation_sharing_enabled": True,
            "allow_new_conversation": True,
        },
        "workspace_memory": {
            "enabled": True,
            "content": "",
            "updated_by": "",
            "updated_at": "",
        },
        "workspace_prompt": {
            "enabled": True,
            "content": "",
            "updated_by": "",
            "updated_at": "",
        },
        "conversations": [],
        "knowledge_documents": [],
        "workspace_files": [],
        "workspace_tasks": [],
        "workspace_activity": [{
            "activity_id": new_workspace_activity_id(),
            "action": "workspace_created",
            "resource_type": "workspace",
            "title": title,
            "subtitle": "",
            "actor": owner_username,
            "time": now,
            "ref": workspace_id,
            "metadata": {},
        }],
        "temp_netdisk": {
            "files": [],
        },
    }


class WorkspaceStore:
    """User-scoped storage for Workspaces metadata."""

    def __init__(self, username: str):
        self.username = validate_username(username)
        self.root = workspaces_root(self.username)

    def _list_workspace_ids(self) -> List[str]:
        if not os.path.isdir(self.root):
            return []

        result: List[str] = []

        for name in os.listdir(self.root):
            if not WORKSPACE_ID_RE.match(str(name or "")):
                continue

            path = workspace_json_path(self.username, name)

            if os.path.isfile(path):
                result.append(name)

        result.sort()
        return result

    def _read_workspace(self, workspace_id: str) -> Dict[str, Any]:
        path = workspace_json_path(self.username, workspace_id)
        payload = safe_read_json(path, default=None, ensure_dict=True)

        if not isinstance(payload, dict):
            raise FileNotFoundError(f"workspace not found: {workspace_id}")

        return self._normalize_workspace(payload)

    def _write_workspace(self, workspace: Dict[str, Any]) -> Dict[str, Any]:
        workspace_id = validate_workspace_id(str(workspace.get("workspace_id") or ""))
        path = workspace_json_path(self.username, workspace_id)
        normalized = self._normalize_workspace(workspace)

        with get_path_lock(path):
            safe_write_json(path, normalized, indent=2)

        return normalized

    def _normalize_workspace(self, workspace: Dict[str, Any]) -> Dict[str, Any]:
        owner = validate_username(str(workspace.get("owner_username") or self.username))
        workspace_id = validate_workspace_id(str(workspace.get("workspace_id") or ""))
        title = normalize_text(workspace.get("title") or "Untitled Workspace", 120) or "Untitled Workspace"
        settings = workspace.get("settings") if isinstance(workspace.get("settings"), dict) else {}
        shared_users = normalize_shared_users(settings.get("shared_users", []), owner)
        conversations = self._normalize_conversations(workspace.get("conversations", []), owner)
        knowledge_documents = self._normalize_knowledge_documents(workspace.get("knowledge_documents", []), owner)
        workspace_tasks = self._normalize_workspace_tasks(workspace.get("workspace_tasks", []), owner)
        workspace_activity = self._normalize_workspace_activity(workspace.get("workspace_activity", []), owner)
        raw_workspace_files = workspace.get("workspace_files")

        if raw_workspace_files is None:
            temp_netdisk = workspace.get("temp_netdisk") if isinstance(workspace.get("temp_netdisk"), dict) else {}
            raw_workspace_files = temp_netdisk.get("files", [])

        workspace_files = self._normalize_workspace_files(raw_workspace_files, owner)
        workspace_memory = normalize_workspace_text_block(workspace.get("workspace_memory"))
        workspace_prompt = normalize_workspace_text_block(workspace.get("workspace_prompt"))

        return {
            "schema_version": 1,
            "workspace_id": workspace_id,
            "title": title,
            "owner_username": owner,
            "created_at": normalize_text(workspace.get("created_at"), 64),
            "updated_at": normalize_text(workspace.get("updated_at"), 64),
            "settings": {
                "shared_users": shared_users,
                "conversation_sharing_enabled": bool(settings.get("conversation_sharing_enabled", True)),
                "allow_new_conversation": bool(settings.get("allow_new_conversation", True)),
            },
            "workspace_memory": workspace_memory,
            "workspace_prompt": workspace_prompt,
            "conversations": conversations,
            "knowledge_documents": knowledge_documents,
            "workspace_files": workspace_files,
            "workspace_tasks": workspace_tasks,
            "workspace_activity": workspace_activity,
            "temp_netdisk": {"files": []},
        }

    def _normalize_conversations(self, value: Any, owner_username: str) -> List[Dict[str, Any]]:
        if value is None:
            return []

        if not isinstance(value, list):
            raise ValueError("conversations must be a list")

        result: List[Dict[str, Any]] = []
        seen = set()

        for item in value:
            if not isinstance(item, dict):
                continue

            conversation_id = normalize_text(item.get("conversation_id"), 80)

            if not conversation_id or conversation_id in seen:
                continue

            visibility = normalize_visibility(item.get("visibility") or "private")
            added_by = validate_username(str(item.get("added_by") or owner_username))
            seen.add(conversation_id)
            result.append({
                "conversation_id": conversation_id,
                "visibility": visibility,
                "added_by": added_by,
                "added_at": normalize_text(item.get("added_at"), 64),
                "title": normalize_text(item.get("title"), 160),
                "pin": bool(item.get("pin", False)),
            })

        return result

    def _normalize_knowledge_documents(self, value: Any, owner_username: str) -> List[Dict[str, Any]]:
        if value is None:
            return []

        if not isinstance(value, list):
            raise ValueError("knowledge_documents must be a list")

        result: List[Dict[str, Any]] = []
        seen = set()

        for item in value:
            source = item if isinstance(item, dict) else {}
            title = normalize_text(
                source.get("title")
                or source.get("name")
                or source.get("document_id")
                or item,
                160,
            )

            if not title:
                continue

            knowledge_type = normalize_text(source.get("knowledge_type") or source.get("type") or "basis", 32) or "basis"
            visibility = normalize_visibility(source.get("visibility") or "private")
            added_by = validate_username(str(source.get("added_by") or owner_username))
            key = (added_by, knowledge_type, title)

            if key in seen:
                continue

            seen.add(key)
            result.append({
                "title": title,
                "knowledge_type": knowledge_type,
                "visibility": visibility,
                "added_by": added_by,
                "added_at": normalize_text(source.get("added_at"), 64),
                "pin": bool(source.get("pin", False)),
            })

        return result

    def _normalize_workspace_files(self, value: Any, owner_username: str) -> List[Dict[str, Any]]:
        if value is None:
            return []

        if not isinstance(value, list):
            raise ValueError("workspace_files must be a list")

        result: List[Dict[str, Any]] = []
        seen = set()

        for item in value:
            source = item if isinstance(item, dict) else {}
            raw_ref = (
                source.get("file_ref")
                or source.get("sandbox_path")
                or source.get("path")
                or source.get("alias")
                or source.get("filename")
                or source.get("name")
                or source.get("title")
                or item
            )
            default_added_by = validate_username(str(source.get("added_by") or owner_username))
            ref = normalize_workspace_file_ref(raw_ref, default_added_by)
            visibility = normalize_visibility(source.get("visibility") or "private")
            title = normalize_text(
                source.get("title")
                or source.get("original_name")
                or source.get("name")
                or ref["alias"],
                180,
            )
            key = (ref["added_by"], ref["alias"])

            if key in seen:
                continue

            seen.add(key)
            result.append({
                "file_ref": ref["file_ref"],
                "alias": ref["alias"],
                "title": title or ref["alias"],
                "visibility": visibility,
                "added_by": ref["added_by"],
                "added_at": normalize_text(source.get("added_at"), 64),
                "pin": bool(source.get("pin", False)),
            })

        return result

    def _normalize_workspace_tasks(self, value: Any, owner_username: str) -> List[Dict[str, Any]]:
        if value is None:
            return []

        if not isinstance(value, list):
            raise ValueError("workspace_tasks must be a list")

        result: List[Dict[str, Any]] = []
        seen = set()

        for item in value:
            if not isinstance(item, dict):
                continue

            task_id = normalize_text(item.get("task_id"), 80)
            title = normalize_text(item.get("title"), 160)

            if not task_id or not title or task_id in seen:
                continue

            created_by = validate_username(str(item.get("created_by") or owner_username))
            updated_by = validate_username(str(item.get("updated_by") or created_by))
            seen.add(task_id)
            result.append({
                "task_id": task_id,
                "title": title,
                "status": normalize_workspace_task_status(item.get("status")),
                "color": normalize_workspace_task_color(item.get("color")),
                "assignee": normalize_text(item.get("assignee") or created_by, 128),
                "start_date": normalize_workspace_task_date(item.get("start_date"), "start_date"),
                "due_date": normalize_workspace_task_date(item.get("due_date"), "due_date"),
                "source_type": normalize_workspace_task_source_type(item.get("source_type")),
                "source_title": normalize_text(item.get("source_title"), 180),
                "source_ref": normalize_text(item.get("source_ref"), 260),
                "notes": normalize_workspace_markdown(item.get("notes"), WORKSPACE_TASK_NOTES_LIMIT),
                "created_by": created_by,
                "created_at": normalize_text(item.get("created_at"), 64),
                "updated_by": updated_by,
                "updated_at": normalize_text(item.get("updated_at"), 64),
            })

        return result

    def _normalize_workspace_activity(self, value: Any, owner_username: str) -> List[Dict[str, Any]]:
        if value is None:
            return []

        if not isinstance(value, list):
            raise ValueError("workspace_activity must be a list")

        result: List[Dict[str, Any]] = []
        seen = set()

        for item in value:
            if not isinstance(item, dict):
                continue

            activity_id = normalize_text(item.get("activity_id"), 80) or new_workspace_activity_id()

            if activity_id in seen:
                continue

            action = normalize_text(item.get("action"), 64)
            resource_type = normalize_text(item.get("resource_type") or item.get("type"), 32)
            title = normalize_text(item.get("title"), 180)
            actor = validate_username(str(item.get("actor") or item.get("actor_username") or owner_username))
            time = normalize_text(item.get("time") or item.get("created_at") or item.get("updated_at"), 64)

            if not action or not resource_type or not title or not time:
                continue

            metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            safe_metadata: Dict[str, str] = {}

            for key, raw_value in metadata.items():
                key_text = normalize_text(key, 64)
                value_text = normalize_text(raw_value, 180)

                if key_text and value_text:
                    safe_metadata[key_text] = value_text

            seen.add(activity_id)
            result.append({
                "activity_id": activity_id,
                "action": action,
                "resource_type": resource_type,
                "title": title,
                "subtitle": normalize_text(item.get("subtitle"), 220),
                "actor": actor,
                "time": time,
                "ref": normalize_text(item.get("ref"), 260),
                "metadata": safe_metadata,
            })

        result.sort(key=lambda row: str(row.get("time") or ""), reverse=True)
        return result[:WORKSPACE_ACTIVITY_LIMIT]

    def _append_workspace_activity(
        self,
        workspace: Dict[str, Any],
        *,
        action: str,
        resource_type: str,
        title: str,
        actor: str,
        time: str = "",
        subtitle: str = "",
        ref: str = "",
        metadata: Dict[str, Any] = None,
    ) -> None:
        owner = validate_username(str(workspace.get("owner_username") or self.username))
        created_at = normalize_text(time, 64) or utc_now_iso()
        activity = self._normalize_workspace_activity(workspace.get("workspace_activity", []), owner)
        activity.insert(0, {
            "activity_id": new_workspace_activity_id(),
            "action": normalize_text(action, 64),
            "resource_type": normalize_text(resource_type, 32),
            "title": normalize_text(title, 180) or "Workspace 活动",
            "subtitle": normalize_text(subtitle, 220),
            "actor": validate_username(actor),
            "time": created_at,
            "ref": normalize_text(ref, 260),
            "metadata": metadata if isinstance(metadata, dict) else {},
        })
        workspace["workspace_activity"] = self._normalize_workspace_activity(activity, owner)

    def create_workspace(self, title: str, shared_users: Any = None) -> Dict[str, Any]:
        workspace_id = new_workspace_id()

        while os.path.exists(workspace_json_path(self.username, workspace_id)):
            workspace_id = new_workspace_id()

        normalized_title = normalize_text(title, 120) or "Untitled Workspace"
        normalized_shared_users = normalize_shared_users(shared_users, self.username)
        payload = default_workspace_payload(
            self.username,
            workspace_id,
            normalized_title,
            normalized_shared_users,
        )

        return self._write_workspace(payload)

    def delete_workspace(self, workspace_id: str) -> Dict[str, Any]:
        """Delete only the Workspace metadata file; linked resources remain untouched."""
        wid = validate_workspace_id(workspace_id)
        workspace = self._read_workspace(wid)
        owner = validate_username(str(workspace.get("owner_username") or ""))

        if owner != self.username:
            raise PermissionError("workspace delete requires owner")

        path = workspace_json_path(self.username, wid)

        with get_path_lock(path):

            if not os.path.isfile(path):
                raise FileNotFoundError(f"workspace not found: {wid}")

            os.remove(path)

            try:
                os.rmdir(os.path.dirname(path))
            except OSError:
                pass

        return {
            "workspace_id": wid,
            "title": str(workspace.get("title") or "").strip(),
        }

    def get_workspace(self, workspace_id: str, viewer_username: str = "") -> Dict[str, Any]:
        workspace = self._read_workspace(workspace_id)
        viewer = validate_username(viewer_username or self.username)
        self._assert_can_view(workspace, viewer)

        return self._filter_for_viewer(workspace, viewer)

    def list_owned_workspaces(self, viewer_username: str = "", include_marks: bool = False) -> List[Dict[str, Any]]:
        viewer = validate_username(viewer_username or self.username)
        result: List[Dict[str, Any]] = []

        for workspace_id in self._list_workspace_ids():
            workspace = self._read_workspace(workspace_id)

            if not self.can_view(workspace, viewer):
                continue

            result.append(self._summary_for_viewer(workspace, viewer, include_marks=include_marks))

        result.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
        return result

    def add_conversation(self, workspace_id: str, conversation_id: str, added_by: str) -> Dict[str, Any]:
        wid = validate_workspace_id(workspace_id)
        cid = normalize_text(conversation_id, 80)

        if not cid:
            raise ValueError("conversation_id is required")

        actor = validate_username(added_by)
        workspace = self._read_workspace(wid)
        self._assert_can_edit(workspace, actor)
        conversation = ConversationManager(actor).get_conversation(cid)
        title = normalize_text(conversation.get("title"), 160)
        conversations = workspace.get("conversations", [])

        if not isinstance(conversations, list):
            conversations = []

        now = utc_now_iso()
        updated = False

        for item in conversations:
            if not isinstance(item, dict):
                continue

            if str(item.get("conversation_id") or "").strip() != cid:
                continue

            item["visibility"] = normalize_visibility(item.get("visibility") or "private")
            item["added_by"] = actor
            item["title"] = title
            item["added_at"] = normalize_text(item.get("added_at"), 64) or now
            updated = True
            break

        if not updated:
            conversations.append({
                "conversation_id": cid,
                "visibility": "private",
                "added_by": actor,
                "added_at": now,
                "title": title,
            })
            self._append_workspace_activity(
                workspace,
                action="conversation_added",
                resource_type="conversation",
                title=title or cid,
                actor=actor,
                time=now,
                subtitle="添加了对话",
                ref=cid,
            )

        workspace["conversations"] = conversations
        workspace["updated_at"] = now
        saved = self._write_workspace(workspace)
        return self._filter_for_viewer(saved, actor)

    def add_knowledge_document(
        self,
        workspace_id: str,
        title: str,
        added_by: str,
        knowledge_type: str = "basis",
        visibility: str = "private",
    ) -> Dict[str, Any]:
        wid = validate_workspace_id(workspace_id)
        safe_title = normalize_text(title, 160)
        safe_type = normalize_text(knowledge_type, 32) or "basis"
        safe_visibility = normalize_visibility(visibility or "private")

        if not safe_title:
            raise ValueError("knowledge title is required")

        if safe_type != "basis":
            raise ValueError("knowledge_type must be basis")

        actor = validate_username(added_by)
        workspace = self._read_workspace(wid)
        self._assert_can_edit(workspace, actor)
        documents = self._normalize_knowledge_documents(workspace.get("knowledge_documents", []), actor)
        now = utc_now_iso()
        updated = False

        for item in documents:
            if item.get("title") != safe_title:
                continue

            if item.get("knowledge_type") != safe_type:
                continue

            if item.get("added_by") != actor:
                continue

            item["visibility"] = normalize_visibility(item.get("visibility") or safe_visibility)
            item["added_at"] = normalize_text(item.get("added_at"), 64) or now
            item["added_by"] = actor
            updated = True
            break

        if not updated:
            documents.append({
                "title": safe_title,
                "knowledge_type": safe_type,
                "visibility": safe_visibility,
                "added_by": actor,
                "added_at": now,
            })
            self._append_workspace_activity(
                workspace,
                action="knowledge_added",
                resource_type="knowledge",
                title=safe_title,
                actor=actor,
                time=now,
                subtitle="添加了知识库",
                ref=safe_title,
                metadata={"visibility": safe_visibility},
            )

        workspace["knowledge_documents"] = documents
        workspace["updated_at"] = now
        saved = self._write_workspace(workspace)
        return self._filter_for_viewer(saved, actor)

    def _get_sandbox_file_entry(self, owner_username: str, file_ref: str) -> Dict[str, Any]:
        owner = validate_username(owner_username)
        ref = normalize_workspace_file_ref(file_ref, owner)

        if ref["added_by"] != owner:
            raise PermissionError("workspace file owner mismatch")

        from api.file_sandbox import UserFileSandbox

        return UserFileSandbox(owner)._get_entry(ref["file_ref"])

    def add_file(
        self,
        workspace_id: str,
        file_ref: str,
        added_by: str,
        visibility: str = "private",
    ) -> Dict[str, Any]:
        wid = validate_workspace_id(workspace_id)
        actor = validate_username(added_by)
        ref = normalize_workspace_file_ref(file_ref, actor)
        safe_visibility = normalize_visibility(visibility or "private")

        if ref["added_by"] != actor:
            raise PermissionError("workspace file must belong to current user")

        entry = self._get_sandbox_file_entry(actor, ref["file_ref"])
        ref["alias"] = normalize_text(entry.get("alias") or ref["alias"], 260)
        ref["file_ref"] = normalize_text(entry.get("sandbox_path") or ref["file_ref"], WORKSPACE_FILE_REF_LIMIT)
        workspace = self._read_workspace(wid)
        self._assert_can_edit(workspace, actor)
        owner = validate_username(str(workspace.get("owner_username") or self.username))
        files = self._normalize_workspace_files(workspace.get("workspace_files", []), owner)
        now = utc_now_iso()
        title = normalize_text(entry.get("original_name") or entry.get("alias") or ref["alias"], 180) or ref["alias"]
        updated = False

        for item in files:
            if item.get("added_by") != actor:
                continue

            if item.get("alias") != ref["alias"]:
                continue

            item["file_ref"] = ref["file_ref"]
            item["title"] = title
            item["visibility"] = normalize_visibility(item.get("visibility") or safe_visibility)
            item["added_at"] = normalize_text(item.get("added_at"), 64) or now
            updated = True
            break

        if not updated:
            files.append({
                "file_ref": ref["file_ref"],
                "alias": ref["alias"],
                "title": title,
                "visibility": safe_visibility,
                "added_by": actor,
                "added_at": now,
                "pin": False,
            })
            self._append_workspace_activity(
                workspace,
                action="file_added",
                resource_type="file",
                title=title,
                actor=actor,
                time=now,
                subtitle="添加了文件",
                ref=ref["file_ref"],
                metadata={"visibility": safe_visibility},
            )

        workspace["workspace_files"] = files
        workspace["updated_at"] = now
        saved = self._write_workspace(workspace)
        return self._filter_for_viewer(saved, actor)

    def _normalize_task_mutation_payload(
        self,
        payload: Dict[str, Any],
        actor_username: str,
        require_title: bool = False,
    ) -> Dict[str, Any]:
        """Normalize user supplied task fields before saving Workspace metadata."""
        if not isinstance(payload, dict):
            raise ValueError("task payload must be an object")

        actor = validate_username(actor_username)
        fields: Dict[str, Any] = {}

        if require_title or "title" in payload:
            title = normalize_text(payload.get("title"), 160)

            if not title:
                raise ValueError("task title is required")

            fields["title"] = title

        if require_title or "status" in payload:
            fields["status"] = normalize_workspace_task_status(payload.get("status"))

        if require_title or "color" in payload:
            fields["color"] = normalize_workspace_task_color(payload.get("color"))

        if require_title or "assignee" in payload:
            assignee = normalize_text(payload.get("assignee") or actor, 128)

            if not assignee:
                raise ValueError("task assignee is required")

            fields["assignee"] = assignee

        if require_title or "start_date" in payload:
            fields["start_date"] = normalize_workspace_task_date(payload.get("start_date"), "start_date")

        if require_title or "due_date" in payload:
            fields["due_date"] = normalize_workspace_task_date(payload.get("due_date"), "due_date")

        if require_title or "source_type" in payload:
            fields["source_type"] = normalize_workspace_task_source_type(payload.get("source_type"))

        if require_title or "source_title" in payload:
            fields["source_title"] = normalize_text(payload.get("source_title"), 180)

        if require_title or "source_ref" in payload:
            fields["source_ref"] = normalize_text(payload.get("source_ref"), 260)

        if require_title or "notes" in payload:
            fields["notes"] = validate_workspace_markdown(
                payload.get("notes"),
                "task notes",
                WORKSPACE_TASK_NOTES_LIMIT,
            )

        return fields

    def create_workspace_task(
        self,
        workspace_id: str,
        actor_username: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Create a Workspace task as a first-class office item."""
        wid = validate_workspace_id(workspace_id)
        actor = validate_username(actor_username)
        fields = self._normalize_task_mutation_payload(payload, actor, require_title=True)
        workspace = self._read_workspace(wid)
        self._assert_can_edit(workspace, actor)
        owner = validate_username(str(workspace.get("owner_username") or self.username))
        tasks = self._normalize_workspace_tasks(workspace.get("workspace_tasks", []), owner)
        existing_ids = {str(item.get("task_id") or "") for item in tasks if isinstance(item, dict)}
        task_id = new_workspace_task_id()

        while task_id in existing_ids:
            task_id = new_workspace_task_id()

        now = utc_now_iso()
        task = {
            "task_id": task_id,
            "created_by": actor,
            "created_at": now,
            "updated_by": actor,
            "updated_at": now,
        }
        task.update(fields)
        tasks.append(task)
        self._append_workspace_activity(
            workspace,
            action="task_created",
            resource_type="task",
            title=str(task.get("title") or "未命名任务"),
            actor=actor,
            time=now,
            subtitle="创建了任务",
            ref=task_id,
            metadata={"status": str(task.get("status") or "todo")},
        )
        workspace["workspace_tasks"] = tasks
        workspace["updated_at"] = now
        saved = self._write_workspace(workspace)
        return self._filter_for_viewer(saved, actor)

    def update_workspace_task(
        self,
        workspace_id: str,
        task_id: str,
        actor_username: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Update a Workspace task without changing unrelated resources."""
        wid = validate_workspace_id(workspace_id)
        tid = normalize_text(task_id, 80)
        actor = validate_username(actor_username)

        if not tid:
            raise ValueError("task_id is required")

        fields = self._normalize_task_mutation_payload(payload, actor, require_title=False)

        if not fields:
            raise ValueError("task update payload is empty")

        workspace = self._read_workspace(wid)
        self._assert_can_edit(workspace, actor)
        owner = validate_username(str(workspace.get("owner_username") or self.username))
        tasks = self._normalize_workspace_tasks(workspace.get("workspace_tasks", []), owner)
        matched = False
        now = utc_now_iso()

        activity_title = ""
        activity_action = "task_updated"
        activity_metadata: Dict[str, Any] = {}

        for item in tasks:
            if item.get("task_id") != tid:
                continue

            previous_status = normalize_workspace_task_status(item.get("status"))
            item.update(fields)
            item["updated_by"] = actor
            item["updated_at"] = now
            next_status = normalize_workspace_task_status(item.get("status"))
            activity_title = str(item.get("title") or "未命名任务")
            activity_metadata["status"] = next_status

            if previous_status != next_status:
                activity_action = "task_status_updated"
                activity_metadata["previous_status"] = previous_status

            matched = True
            break

        if not matched:
            raise FileNotFoundError(f"workspace task not found: {tid}")

        workspace["workspace_tasks"] = tasks
        self._append_workspace_activity(
            workspace,
            action=activity_action,
            resource_type="task",
            title=activity_title,
            actor=actor,
            time=now,
            subtitle="更新了任务",
            ref=tid,
            metadata=activity_metadata,
        )
        workspace["updated_at"] = now
        saved = self._write_workspace(workspace)
        return self._filter_for_viewer(saved, actor)

    def delete_workspace_task(
        self,
        workspace_id: str,
        task_id: str,
        actor_username: str,
    ) -> Dict[str, Any]:
        """Delete a Workspace task while keeping linked resources untouched."""
        wid = validate_workspace_id(workspace_id)
        tid = normalize_text(task_id, 80)
        actor = validate_username(actor_username)

        if not tid:
            raise ValueError("task_id is required")

        workspace = self._read_workspace(wid)
        self._assert_can_edit(workspace, actor)
        owner = validate_username(str(workspace.get("owner_username") or self.username))
        tasks = self._normalize_workspace_tasks(workspace.get("workspace_tasks", []), owner)
        deleted_task = None
        next_tasks = []

        for item in tasks:
            if not isinstance(item, dict):
                continue

            if item.get("task_id") == tid:
                deleted_task = item
                continue

            next_tasks.append(item)

        if len(next_tasks) == len(tasks):
            raise FileNotFoundError(f"workspace task not found: {tid}")

        workspace["workspace_tasks"] = next_tasks
        now = utc_now_iso()
        self._append_workspace_activity(
            workspace,
            action="task_deleted",
            resource_type="task",
            title=str((deleted_task or {}).get("title") or "未命名任务"),
            actor=actor,
            time=now,
            subtitle="删除了任务",
            ref=tid,
        )
        workspace["updated_at"] = now
        saved = self._write_workspace(workspace)
        return self._filter_for_viewer(saved, actor)

    def assert_can_edit_workspace(self, workspace_id: str, actor_username: str) -> None:
        wid = validate_workspace_id(workspace_id)
        actor = validate_username(actor_username)
        workspace = self._read_workspace(wid)

        self._assert_can_edit(workspace, actor)

    def update_conversation_visibility(
        self,
        workspace_id: str,
        conversation_id: str,
        actor_username: str,
        visibility: str,
    ) -> Dict[str, Any]:
        """Update a Workspace conversation sharing marker."""
        wid = validate_workspace_id(workspace_id)
        cid = normalize_text(conversation_id, 80)
        actor = validate_username(actor_username)
        safe_visibility = normalize_visibility(visibility)

        if not cid:
            raise ValueError("conversation_id is required")

        workspace = self._read_workspace(wid)
        self._assert_can_edit(workspace, actor)
        owner = validate_username(str(workspace.get("owner_username") or self.username))
        conversations = self._normalize_conversations(workspace.get("conversations", []), owner)
        matched = False
        activity_title = cid

        for item in conversations:
            if item.get("conversation_id") != cid:
                continue

            if item.get("added_by") != actor:
                continue

            item["visibility"] = safe_visibility
            activity_title = str(item.get("title") or cid)
            matched = True
            break

        if not matched:
            raise FileNotFoundError(f"workspace conversation not found: {cid}")

        workspace["conversations"] = conversations
        now = utc_now_iso()
        self._append_workspace_activity(
            workspace,
            action="conversation_shared" if safe_visibility == "share" else "conversation_private",
            resource_type="conversation",
            title=activity_title,
            actor=actor,
            time=now,
            subtitle="设为 Share" if safe_visibility == "share" else "设为 Private",
            ref=cid,
            metadata={"visibility": safe_visibility},
        )
        workspace["updated_at"] = now
        saved = self._write_workspace(workspace)
        return self._filter_for_viewer(saved, actor)

    def update_conversation_pin(
        self,
        workspace_id: str,
        conversation_id: str,
        actor_username: str,
        pin: bool,
    ) -> Dict[str, Any]:
        """Update only the Workspace-local conversation pin marker."""
        wid = validate_workspace_id(workspace_id)
        cid = normalize_text(conversation_id, 80)
        actor = validate_username(actor_username)

        if not cid:
            raise ValueError("conversation_id is required")

        workspace = self._read_workspace(wid)
        self._assert_can_edit(workspace, actor)
        owner = validate_username(str(workspace.get("owner_username") or self.username))
        conversations = self._normalize_conversations(workspace.get("conversations", []), owner)
        matched = False

        for item in conversations:
            if item.get("conversation_id") != cid:
                continue

            if not self._resource_visible_to_viewer(item, actor):
                continue

            item["pin"] = bool(pin)
            matched = True
            break

        if not matched:
            raise FileNotFoundError(f"workspace conversation not found: {cid}")

        workspace["conversations"] = conversations
        workspace["updated_at"] = utc_now_iso()
        saved = self._write_workspace(workspace)
        return self._filter_for_viewer(saved, actor)

    def update_knowledge_document_visibility(
        self,
        workspace_id: str,
        title: str,
        actor_username: str,
        visibility: str,
        knowledge_type: str = "basis",
    ) -> Dict[str, Any]:
        """Update a Workspace knowledge document sharing marker."""
        wid = validate_workspace_id(workspace_id)
        safe_title = normalize_text(title, 160)
        safe_type = normalize_text(knowledge_type, 32) or "basis"
        actor = validate_username(actor_username)
        safe_visibility = normalize_visibility(visibility)

        if not safe_title:
            raise ValueError("knowledge title is required")

        workspace = self._read_workspace(wid)
        self._assert_can_edit(workspace, actor)
        owner = validate_username(str(workspace.get("owner_username") or self.username))
        documents = self._normalize_knowledge_documents(workspace.get("knowledge_documents", []), owner)
        matched = False

        for item in documents:
            if item.get("title") != safe_title:
                continue

            if item.get("knowledge_type") != safe_type:
                continue

            if item.get("added_by") != actor:
                continue

            item["visibility"] = safe_visibility
            matched = True
            break

        if not matched:
            raise FileNotFoundError(f"workspace knowledge not found: {safe_title}")

        workspace["knowledge_documents"] = documents
        now = utc_now_iso()
        self._append_workspace_activity(
            workspace,
            action="knowledge_shared" if safe_visibility == "share" else "knowledge_private",
            resource_type="knowledge",
            title=safe_title,
            actor=actor,
            time=now,
            subtitle="设为 Share" if safe_visibility == "share" else "设为 Private",
            ref=safe_title,
            metadata={"visibility": safe_visibility},
        )
        workspace["updated_at"] = now
        saved = self._write_workspace(workspace)
        return self._filter_for_viewer(saved, actor)

    def update_knowledge_document_pin(
        self,
        workspace_id: str,
        title: str,
        actor_username: str,
        pin: bool,
        knowledge_type: str = "basis",
        added_by_username: str = "",
    ) -> Dict[str, Any]:
        """Update only the Workspace-local knowledge pin marker."""
        wid = validate_workspace_id(workspace_id)
        safe_title = normalize_text(title, 160)
        safe_type = normalize_text(knowledge_type, 32) or "basis"
        actor = validate_username(actor_username)
        requested_added_by = normalize_text(added_by_username, 128)

        if not safe_title:
            raise ValueError("knowledge title is required")

        if requested_added_by:
            requested_added_by = validate_username(requested_added_by)

        workspace = self._read_workspace(wid)
        self._assert_can_edit(workspace, actor)
        owner = validate_username(str(workspace.get("owner_username") or self.username))
        documents = self._normalize_knowledge_documents(workspace.get("knowledge_documents", []), owner)
        matched = False

        for item in documents:
            if item.get("title") != safe_title:
                continue

            if item.get("knowledge_type") != safe_type:
                continue

            if requested_added_by and item.get("added_by") != requested_added_by:
                continue

            if not self._resource_visible_to_viewer(item, actor):
                continue

            item["pin"] = bool(pin)
            matched = True
            break

        if not matched:
            raise FileNotFoundError(f"workspace knowledge not found: {safe_title}")

        workspace["knowledge_documents"] = documents
        workspace["updated_at"] = utc_now_iso()
        saved = self._write_workspace(workspace)
        return self._filter_for_viewer(saved, actor)

    def update_file_visibility(
        self,
        workspace_id: str,
        file_ref: str,
        actor_username: str,
        visibility: str,
    ) -> Dict[str, Any]:
        """Update a Workspace file sharing marker owned by the current user."""
        wid = validate_workspace_id(workspace_id)
        actor = validate_username(actor_username)
        ref = normalize_workspace_file_ref(file_ref, actor)
        safe_visibility = normalize_visibility(visibility)

        if ref["added_by"] != actor:
            raise PermissionError("workspace file visibility owner mismatch")

        workspace = self._read_workspace(wid)
        self._assert_can_edit(workspace, actor)
        owner = validate_username(str(workspace.get("owner_username") or self.username))
        files = self._normalize_workspace_files(workspace.get("workspace_files", []), owner)
        matched = False
        activity_title = ref["alias"]

        for item in files:
            if item.get("added_by") != actor:
                continue

            if item.get("alias") != ref["alias"]:
                continue

            item["visibility"] = safe_visibility
            activity_title = str(item.get("title") or item.get("alias") or ref["alias"])
            matched = True
            break

        if not matched:
            raise FileNotFoundError(f"workspace file not found: {ref['file_ref']}")

        workspace["workspace_files"] = files
        now = utc_now_iso()
        self._append_workspace_activity(
            workspace,
            action="file_shared" if safe_visibility == "share" else "file_private",
            resource_type="file",
            title=activity_title,
            actor=actor,
            time=now,
            subtitle="设为 Share" if safe_visibility == "share" else "设为 Private",
            ref=ref["file_ref"],
            metadata={"visibility": safe_visibility},
        )
        workspace["updated_at"] = now
        saved = self._write_workspace(workspace)
        return self._filter_for_viewer(saved, actor)

    def update_file_pin(
        self,
        workspace_id: str,
        file_ref: str,
        actor_username: str,
        pin: bool,
        added_by_username: str = "",
    ) -> Dict[str, Any]:
        """Update only the Workspace-local file pin marker."""
        wid = validate_workspace_id(workspace_id)
        actor = validate_username(actor_username)
        requested_added_by = normalize_text(added_by_username, 128)

        if requested_added_by:
            requested_added_by = validate_username(requested_added_by)

        ref = normalize_workspace_file_ref(file_ref, requested_added_by or actor)
        workspace = self._read_workspace(wid)
        self._assert_can_edit(workspace, actor)
        owner = validate_username(str(workspace.get("owner_username") or self.username))
        files = self._normalize_workspace_files(workspace.get("workspace_files", []), owner)
        matched = False

        for item in files:
            if item.get("added_by") != ref["added_by"]:
                continue

            if item.get("alias") != ref["alias"]:
                continue

            if not self._resource_visible_to_viewer(item, actor):
                continue

            item["pin"] = bool(pin)
            matched = True
            break

        if not matched:
            raise FileNotFoundError(f"workspace file not found: {ref['file_ref']}")

        workspace["workspace_files"] = files
        workspace["updated_at"] = utc_now_iso()
        saved = self._write_workspace(workspace)
        return self._filter_for_viewer(saved, actor)

    def update_settings(self, workspace_id: str, actor_username: str, settings_updates: Dict[str, Any]) -> Dict[str, Any]:
        wid = validate_workspace_id(workspace_id)
        actor = validate_username(actor_username)
        workspace = self._read_workspace(wid)
        self._assert_owner(workspace, actor)
        settings = workspace.get("settings") if isinstance(workspace.get("settings"), dict) else {}
        previous_title = normalize_text(workspace.get("title") or "Untitled Workspace", 120) or "Untitled Workspace"
        previous_shared_users = normalize_shared_users(settings.get("shared_users", []), actor)
        now = utc_now_iso()

        if "title" in settings_updates:
            title = normalize_text(settings_updates.get("title"), 120)

            if not title:
                raise ValueError("workspace title is required")

            workspace["title"] = title

            if title != previous_title:
                self._append_workspace_activity(
                    workspace,
                    action="workspace_renamed",
                    resource_type="workspace",
                    title=title,
                    actor=actor,
                    time=now,
                    subtitle=f"原名称：{previous_title}",
                    ref=wid,
                )

        if "shared_users" in settings_updates:
            next_shared_users = normalize_shared_users(settings_updates.get("shared_users"), actor)
            added_users = [item for item in next_shared_users if item not in previous_shared_users]
            removed_users = [item for item in previous_shared_users if item not in next_shared_users]
            settings["shared_users"] = next_shared_users

            for shared_user in added_users:
                self._append_workspace_activity(
                    workspace,
                    action="workspace_shared",
                    resource_type="workspace",
                    title=normalize_text(workspace.get("title") or previous_title, 120),
                    actor=actor,
                    time=now,
                    subtitle=f"分享给 {shared_user}",
                    ref=wid,
                    metadata={"target_user": shared_user},
                )

            for shared_user in removed_users:
                self._append_workspace_activity(
                    workspace,
                    action="workspace_unshared",
                    resource_type="workspace",
                    title=normalize_text(workspace.get("title") or previous_title, 120),
                    actor=actor,
                    time=now,
                    subtitle=f"移除 {shared_user}",
                    ref=wid,
                    metadata={"target_user": shared_user},
                )

        if "conversation_sharing_enabled" in settings_updates:
            settings["conversation_sharing_enabled"] = bool(settings_updates.get("conversation_sharing_enabled"))

        if "allow_new_conversation" in settings_updates:
            settings["allow_new_conversation"] = bool(settings_updates.get("allow_new_conversation"))

        if "workspace_prompt" in settings_updates:
            prompt_content = validate_workspace_markdown(settings_updates.get("workspace_prompt"), "workspace_prompt")
            workspace["workspace_prompt"] = {
                "enabled": True,
                "content": prompt_content,
                "updated_by": actor,
                "updated_at": now,
            }
            self._append_workspace_activity(
                workspace,
                action="workspace_prompt_updated",
                resource_type="workspace_prompt",
                title=normalize_text(workspace.get("title") or previous_title, 120),
                actor=actor,
                time=now,
                subtitle="更新了 Workspace Prompt",
                ref=wid,
            )

        workspace["settings"] = settings
        workspace["updated_at"] = now
        saved = self._write_workspace(workspace)
        return self._filter_for_viewer(saved, actor)

    def get_visible_conversation_marker(
        self,
        workspace_id: str,
        conversation_id: str,
        viewer_username: str,
    ) -> Dict[str, Any]:
        wid = validate_workspace_id(workspace_id)
        cid = normalize_text(conversation_id, 80)
        viewer = validate_username(viewer_username)

        if not cid:
            raise ValueError("conversation_id is required")

        workspace = self._read_workspace(wid)
        self._assert_can_view(workspace, viewer)
        owner = validate_username(str(workspace.get("owner_username") or self.username))
        conversations = self._normalize_conversations(workspace.get("conversations", []), owner)

        for item in conversations:
            if normalize_text(item.get("conversation_id"), 80) != cid:
                continue

            if not self._resource_visible_to_viewer(item, viewer):
                break

            return item

        raise FileNotFoundError(f"workspace conversation not found: {cid}")

    def get_visible_file_marker(
        self,
        workspace_id: str,
        file_ref: str,
        viewer_username: str,
        added_by_username: str = "",
    ) -> Dict[str, Any]:
        wid = validate_workspace_id(workspace_id)
        viewer = validate_username(viewer_username)
        requested_added_by = normalize_text(added_by_username, 128)

        if requested_added_by:
            requested_added_by = validate_username(requested_added_by)

        ref = normalize_workspace_file_ref(file_ref, requested_added_by or viewer)
        workspace = self._read_workspace(wid)
        self._assert_can_view(workspace, viewer)
        owner = validate_username(str(workspace.get("owner_username") or self.username))
        files = self._normalize_workspace_files(workspace.get("workspace_files", []), owner)

        for item in files:
            if item.get("added_by") != ref["added_by"]:
                continue

            if item.get("alias") != ref["alias"]:
                continue

            if not self._resource_visible_to_viewer(item, viewer):
                continue

            return dict(item)

        raise FileNotFoundError(f"workspace file not found: {ref['file_ref']}")

    def _workspace_memory_result(
        self,
        workspace_id: str,
        old_content: str,
        new_content: str,
        dry_run: bool,
        stats: Dict[str, Any],
        preview_label: str = "workspace_memory.md",
    ) -> Dict[str, Any]:
        old_sha = workspace_text_sha256(old_content)
        new_sha = workspace_text_sha256(new_content)
        preview_diff = build_preview_diff(preview_label, old_content, new_content)

        return {
            "success": True,
            "workspace_id": workspace_id,
            "dry_run": bool(dry_run),
            "changed": old_content != new_content,
            "old_sha256": old_sha,
            "new_sha256": new_sha,
            "sha256": new_sha,
            "chars": len(new_content),
            "limit": WORKSPACE_TEXT_LIMIT,
            "stats": stats if isinstance(stats, dict) else {},
            "content": new_content,
            "preview_diff": preview_diff[:4000],
        }

    def _update_workspace_memory_content(
        self,
        workspace_id: str,
        actor_username: str,
        new_content: str,
        expected_sha256: Any = "",
        dry_run: bool = False,
        stats: Dict[str, Any] = None,
    ) -> Dict[str, Any]:
        wid = validate_workspace_id(workspace_id)
        actor = validate_username(actor_username)
        content = validate_workspace_markdown(new_content, "workspace_memory")
        workspace = self._read_workspace(wid)
        self._assert_can_edit(workspace, actor)
        memory = normalize_workspace_text_block(workspace.get("workspace_memory"))
        old_content = str(memory.get("content") or "")
        old_sha = workspace_text_sha256(old_content)
        expected = str(expected_sha256 or "").strip().lower()

        if expected and expected != old_sha:
            return {
                "success": False,
                "workspace_id": wid,
                "message": "workspace memory SHA256 与 expected_sha256 不一致，已拒绝修改。",
                "old_sha256": old_sha,
                "expected_sha256": expected,
                "content": old_content,
            }

        result = self._workspace_memory_result(wid, old_content, content, dry_run, stats or {})

        if dry_run or old_content == content:
            return result

        now = utc_now_iso()
        workspace["workspace_memory"] = {
            "enabled": True,
            "content": content,
            "updated_by": actor,
            "updated_at": now,
        }
        self._append_workspace_activity(
            workspace,
            action="workspace_memory_updated",
            resource_type="workspace_memory",
            title=normalize_text(workspace.get("title") or "Workspace", 120),
            actor=actor,
            time=now,
            subtitle="更新了 Workspace 记忆",
            ref=wid,
            metadata={"mode": str((stats or {}).get("mode") or "patch")},
        )
        workspace["updated_at"] = now
        self._write_workspace(workspace)

        return result

    def write_workspace_memory(
        self,
        workspace_id: str,
        actor_username: str,
        content: Any,
        expected_sha256: Any = "",
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        memory_content = validate_workspace_markdown(content, "workspace_memory")

        return self._update_workspace_memory_content(
            workspace_id,
            actor_username,
            memory_content,
            expected_sha256=expected_sha256,
            dry_run=dry_run,
            stats={"mode": "write"},
        )

    def add_workspace_memory(
        self,
        workspace_id: str,
        actor_username: str,
        content: Any,
        expected_sha256: Any = "",
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        wid = validate_workspace_id(workspace_id)
        addition = validate_workspace_markdown(content, "workspace_memory_addition")

        if not addition:
            raise ValueError("workspace memory addition is required")

        workspace = self._read_workspace(wid)
        self._assert_can_edit(workspace, actor_username)
        memory = normalize_workspace_text_block(workspace.get("workspace_memory"))
        old_content = str(memory.get("content") or "")
        old_sha = workspace_text_sha256(old_content)
        effective_expected_sha256 = str(expected_sha256 or "").strip() or old_sha
        next_content = addition if not old_content else f"{old_content.rstrip()}\n\n{addition}"

        return self._update_workspace_memory_content(
            wid,
            actor_username,
            next_content,
            expected_sha256=effective_expected_sha256,
            dry_run=dry_run,
            stats={"mode": "append"},
        )

    def patch_workspace_memory(
        self,
        workspace_id: str,
        actor_username: str,
        patch: Any = "",
        edits: Any = None,
        expected_sha256: Any = "",
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        wid = validate_workspace_id(workspace_id)
        actor = validate_username(actor_username)
        workspace = self._read_workspace(wid)
        self._assert_can_edit(workspace, actor)
        memory = normalize_workspace_text_block(workspace.get("workspace_memory"))
        old_content = str(memory.get("content") or "")
        old_sha = workspace_text_sha256(old_content)
        expected = str(expected_sha256 or "").strip().lower()

        if expected and expected != old_sha:
            return {
                "success": False,
                "workspace_id": wid,
                "message": "workspace memory SHA256 与 expected_sha256 不一致，已拒绝修改。",
                "old_sha256": old_sha,
                "expected_sha256": expected,
                "content": old_content,
            }

        new_content, stats, error = apply_text_patch(
            old_content,
            patch_text=str(patch or ""),
            edits=edits if isinstance(edits, list) else None,
        )

        if error:
            return {
                "success": False,
                "workspace_id": wid,
                "message": error,
                "old_sha256": old_sha,
                "sha256": old_sha,
                "content": old_content,
            }

        return self._update_workspace_memory_content(
            wid,
            actor,
            new_content,
            expected_sha256=old_sha,
            dry_run=dry_run,
            stats=stats,
        )

    def can_view(self, workspace: Dict[str, Any], viewer_username: str) -> bool:
        viewer = validate_username(viewer_username)
        owner = validate_username(str(workspace.get("owner_username") or ""))

        if viewer == owner:
            return True

        settings = workspace.get("settings") if isinstance(workspace.get("settings"), dict) else {}
        shared_users = normalize_shared_users(settings.get("shared_users", []), owner)
        return viewer in shared_users

    def _assert_can_view(self, workspace: Dict[str, Any], viewer_username: str) -> None:
        if not self.can_view(workspace, viewer_username):
            raise PermissionError("workspace access denied")

    def _assert_can_edit(self, workspace: Dict[str, Any], actor_username: str) -> None:
        actor = validate_username(actor_username)
        owner = validate_username(str(workspace.get("owner_username") or ""))
        settings = workspace.get("settings") if isinstance(workspace.get("settings"), dict) else {}
        shared_users = normalize_shared_users(settings.get("shared_users", []), owner)

        if actor == owner or actor in shared_users:
            return

        raise PermissionError("workspace edit denied")

    def _assert_owner(self, workspace: Dict[str, Any], actor_username: str) -> None:
        actor = validate_username(actor_username)
        owner = validate_username(str(workspace.get("owner_username") or ""))

        if actor == owner:
            return

        raise PermissionError("workspace owner required")

    def _resource_visible_to_viewer(self, item: Dict[str, Any], viewer_username: str) -> bool:
        viewer = validate_username(viewer_username)
        added_by = validate_username(str(item.get("added_by") or self.username))

        if added_by == viewer:
            return True

        return normalize_visibility(item.get("visibility") or "private") == "share"

    def get_visible_conversation(
        self,
        workspace_id: str,
        conversation_id: str,
        viewer_username: str,
    ) -> Dict[str, Any]:
        """Resolve a Workspace conversation marker and load the real conversation owner file."""
        wid = validate_workspace_id(workspace_id)
        cid = normalize_text(conversation_id, 80)
        viewer = validate_username(viewer_username)

        if not cid:
            raise ValueError("conversation_id is required")

        workspace = self._read_workspace(wid)
        self._assert_can_view(workspace, viewer)
        owner = validate_username(str(workspace.get("owner_username") or self.username))
        conversations = self._normalize_conversations(workspace.get("conversations", []), owner)

        for item in conversations:
            if item.get("conversation_id") != cid:
                continue

            if not self._resource_visible_to_viewer(item, viewer):
                break

            added_by = validate_username(str(item.get("added_by") or owner))
            conversation = ConversationManager(added_by).get_conversation(cid)
            messages = conversation.get("messages", [])
            snapshot = dict(item)
            snapshot["title"] = normalize_text(conversation.get("title"), 160)
            snapshot["last_user_question"] = last_user_question_from_messages(messages)
            snapshot["updated_at"] = normalize_text(conversation.get("updated_at"), 64)
            snapshot["created_at"] = normalize_text(conversation.get("created_at"), 64)

            return {
                "conversation": conversation,
                "marker": snapshot,
                "readonly": added_by != viewer,
                "owner_username": added_by,
                "workspace_id": wid,
                "workspace_title": normalize_text(workspace.get("title"), 120),
            }

        raise FileNotFoundError(f"workspace conversation not found: {cid}")

    def get_visible_file(
        self,
        workspace_id: str,
        file_ref: str,
        viewer_username: str,
        added_by_username: str = "",
    ) -> Dict[str, Any]:
        """Resolve a Workspace file marker and load the real file sandbox entry."""
        marker = self.get_visible_file_marker(
            workspace_id,
            file_ref,
            viewer_username,
            added_by_username=added_by_username,
        )
        owner = validate_username(str(marker.get("added_by") or self.username))
        entry = self._get_sandbox_file_entry(owner, marker.get("file_ref") or marker.get("alias"))
        snapshot = self._file_snapshot_for_detail(marker)
        workspace = self._read_workspace(workspace_id)

        return {
            "file": entry,
            "marker": snapshot,
            "readonly": owner != validate_username(viewer_username),
            "owner_username": owner,
            "workspace_id": validate_workspace_id(workspace_id),
            "workspace_title": normalize_text(workspace.get("title"), 120),
        }

    def get_visible_knowledge_document(
        self,
        workspace_id: str,
        title: str,
        viewer_username: str,
        knowledge_type: str = "basis",
        added_by_username: str = "",
    ) -> Dict[str, Any]:
        wid = validate_workspace_id(workspace_id)
        safe_title = normalize_text(title, 160)
        safe_type = normalize_text(knowledge_type, 32) or "basis"
        viewer = validate_username(viewer_username)
        requested_added_by = normalize_text(added_by_username, 128)

        if not safe_title:
            raise ValueError("knowledge title is required")

        if requested_added_by:
            requested_added_by = validate_username(requested_added_by)

        workspace = self._read_workspace(wid)
        self._assert_can_view(workspace, viewer)
        owner = validate_username(str(workspace.get("owner_username") or self.username))
        documents = self._normalize_knowledge_documents(workspace.get("knowledge_documents", []), owner)

        for item in documents:
            if item.get("title") != safe_title:
                continue

            if item.get("knowledge_type") != safe_type:
                continue

            if requested_added_by and item.get("added_by") != requested_added_by:
                continue

            if not self._resource_visible_to_viewer(item, viewer):
                continue

            return dict(item)

        raise FileNotFoundError(f"workspace knowledge not found: {safe_title}")

    def update_knowledge_document_title(
        self,
        workspace_id: str,
        old_title: str,
        new_title: str,
        viewer_username: str,
        added_by_username: str,
        knowledge_type: str = "basis",
    ) -> Dict[str, Any]:
        wid = validate_workspace_id(workspace_id)
        safe_old_title = normalize_text(old_title, 160)
        safe_new_title = normalize_text(new_title, 160)
        safe_type = normalize_text(knowledge_type, 32) or "basis"
        viewer = validate_username(viewer_username)
        added_by = validate_username(added_by_username)

        if not safe_old_title or not safe_new_title:
            raise ValueError("knowledge title is required")

        workspace = self._read_workspace(wid)
        self._assert_can_view(workspace, viewer)
        owner = validate_username(str(workspace.get("owner_username") or self.username))
        documents = self._normalize_knowledge_documents(workspace.get("knowledge_documents", []), owner)
        matched = False

        for item in documents:
            if item.get("added_by") != added_by:
                continue

            if item.get("knowledge_type") != safe_type:
                continue

            if item.get("title") == safe_new_title and safe_old_title != safe_new_title:
                raise ValueError("workspace knowledge title already exists")

        for item in documents:
            if item.get("title") != safe_old_title:
                continue

            if item.get("knowledge_type") != safe_type:
                continue

            if item.get("added_by") != added_by:
                continue

            if not self._resource_visible_to_viewer(item, viewer):
                raise PermissionError("workspace knowledge access denied")

            item["title"] = safe_new_title
            matched = True
            break

        if not matched:
            raise FileNotFoundError(f"workspace knowledge not found: {safe_old_title}")

        workspace["knowledge_documents"] = documents
        workspace["updated_at"] = utc_now_iso()
        saved = self._write_workspace(workspace)
        return self._filter_for_viewer(saved, viewer)

    def _conversation_snapshot_for_detail(self, item: Dict[str, Any]) -> Dict[str, Any]:
        conversation_id = normalize_text(item.get("conversation_id"), 80)
        added_by = validate_username(str(item.get("added_by") or self.username))
        conversation = ConversationManager(added_by).get_conversation(conversation_id)
        messages = conversation.get("messages", [])
        snapshot = dict(item)
        live_title = normalize_text(conversation.get("title"), 160)
        last_user_question = last_user_question_from_messages(messages)

        snapshot["title"] = live_title
        snapshot["last_user_question"] = last_user_question
        snapshot["updated_at"] = normalize_text(conversation.get("updated_at"), 64)
        snapshot["created_at"] = normalize_text(conversation.get("created_at"), 64)

        return snapshot

    def _conversation_snapshots_for_detail(self, conversations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []

        for item in conversations:
            result.append(self._conversation_snapshot_for_detail(item))

        return result

    def _knowledge_document_snapshot_for_detail(self, item: Dict[str, Any]) -> Dict[str, Any]:
        """Attach live basis knowledge metadata used by the Workspace detail list."""
        snapshot = dict(item)
        title = normalize_text(snapshot.get("title"), 160)
        knowledge_type = normalize_text(snapshot.get("knowledge_type") or "basis", 32) or "basis"
        added_by = validate_username(str(snapshot.get("added_by") or self.username))

        snapshot["title"] = title
        snapshot["knowledge_type"] = knowledge_type
        snapshot["visibility"] = normalize_visibility(snapshot.get("visibility") or "private")

        if knowledge_type != "basis" or not title:
            return snapshot

        from api.database import User

        metadata = User(added_by).getBasisMetadata(title)

        if isinstance(metadata, dict):
            snapshot["basis_id"] = normalize_text(metadata.get("basis_id"), 80)
            snapshot["created_at"] = normalize_text(metadata.get("created_at"), 64)
            snapshot["updated_at"] = normalize_text(metadata.get("updated_at"), 64)

        return snapshot

    def _knowledge_document_snapshots_for_detail(self, documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []

        for item in documents:
            result.append(self._knowledge_document_snapshot_for_detail(item))

        return result

    def _file_snapshot_for_detail(self, item: Dict[str, Any]) -> Dict[str, Any]:
        """Attach live file sandbox metadata used by the Workspace file list."""
        snapshot = dict(item)
        added_by = validate_username(str(snapshot.get("added_by") or self.username))
        ref = normalize_workspace_file_ref(snapshot.get("file_ref") or snapshot.get("alias"), added_by)
        entry = self._get_sandbox_file_entry(added_by, ref["file_ref"])

        snapshot["file_ref"] = normalize_text(entry.get("sandbox_path") or ref["file_ref"], WORKSPACE_FILE_REF_LIMIT)
        snapshot["alias"] = normalize_text(entry.get("alias") or ref["alias"], 180)
        snapshot["title"] = normalize_text(entry.get("original_name") or entry.get("alias") or snapshot.get("title"), 180)
        snapshot["original_name"] = normalize_text(entry.get("original_name"), 180)
        snapshot["source_ext"] = normalize_text(entry.get("source_ext"), 32)
        snapshot["parser_mode"] = normalize_text(entry.get("parser_mode"), 64)
        snapshot["encoding"] = normalize_text(entry.get("encoding"), 64)
        snapshot["size"] = int(entry.get("size") or 0)
        snapshot["created_at"] = str(entry.get("created_at") or "")
        snapshot["updated_at"] = str(entry.get("updated_at") or "")
        snapshot["visibility"] = normalize_visibility(snapshot.get("visibility") or "private")

        return snapshot

    def _file_snapshots_for_detail(self, files: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []

        for item in files:
            result.append(self._file_snapshot_for_detail(item))

        return result

    def _overview_item_time(self, item: Dict[str, Any]) -> str:
        return normalize_text(
            item.get("updated_at")
            or item.get("added_at")
            or item.get("created_at"),
            64,
        )

    def _filter_workspace_activity_for_visible_resources(
        self,
        activity_items: List[Dict[str, Any]],
        conversations: List[Dict[str, Any]],
        knowledge_documents: List[Dict[str, Any]],
        workspace_files: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        conversation_refs = {
            normalize_text(item.get("conversation_id"), 80)
            for item in conversations
            if isinstance(item, dict)
        }
        knowledge_refs = {
            normalize_text(item.get("title"), 160)
            for item in knowledge_documents
            if isinstance(item, dict)
        }
        file_refs = set()

        for item in workspace_files:
            if not isinstance(item, dict):
                continue

            file_refs.add(normalize_text(item.get("file_ref"), WORKSPACE_FILE_REF_LIMIT))
            file_refs.add(normalize_text(item.get("alias"), 260))

        allowed_global_types = {"workspace", "workspace_memory", "workspace_prompt", "task"}
        result: List[Dict[str, Any]] = []

        for item in activity_items:
            if not isinstance(item, dict):
                continue

            resource_type = normalize_text(item.get("resource_type") or item.get("type"), 32)
            ref = normalize_text(item.get("ref"), 260)
            title = normalize_text(item.get("title"), 180)

            if resource_type in allowed_global_types:
                result.append(item)
                continue

            if resource_type == "conversation" and ref in conversation_refs:
                result.append(item)
                continue

            if resource_type == "knowledge" and (ref in knowledge_refs or title in knowledge_refs):
                result.append(item)
                continue

            if resource_type == "file" and ref in file_refs:
                result.append(item)

        return result

    def _build_workspace_overview(self, workspace: Dict[str, Any]) -> Dict[str, Any]:
        """Build the Workspace office overview from visible detail resources."""
        conversations = workspace.get("conversations", [])
        knowledge_documents = workspace.get("knowledge_documents", [])
        workspace_files = workspace.get("workspace_files", [])
        workspace_tasks = workspace.get("workspace_tasks", [])
        activity_items = workspace.get("workspace_activity", [])
        task_status_counts = {
            status: 0
            for status in sorted(WORKSPACE_TASK_STATUS_VALUES)
        }
        recent_items: List[Dict[str, Any]] = []
        pinned_resources: List[Dict[str, Any]] = []
        open_tasks: List[Dict[str, Any]] = []
        today = datetime.utcnow().date().isoformat()

        for item in workspace_tasks:
            if not isinstance(item, dict):
                continue

            status = normalize_workspace_task_status(item.get("status"))
            task_status_counts[status] = task_status_counts.get(status, 0) + 1

            if status not in {"done", "cancelled"}:
                open_tasks.append(dict(item))

            recent_items.append({
                "type": "task",
                "title": normalize_text(item.get("title") or "未命名任务", 160),
                "subtitle": normalize_text(item.get("assignee"), 128),
                "time": self._overview_item_time(item),
                "status": status,
                "ref": normalize_text(item.get("task_id"), 80),
            })

        for item in conversations:
            if not isinstance(item, dict):
                continue

            title = normalize_text(item.get("title") or item.get("conversation_id") or "Untitled Conversation", 160)
            recent_items.append({
                "type": "conversation",
                "title": title,
                "subtitle": normalize_text(item.get("last_user_question"), 180),
                "time": self._overview_item_time(item),
                "ref": normalize_text(item.get("conversation_id"), 80),
            })

            if bool(item.get("pin", False)):
                pinned_resources.append({
                    "type": "conversation",
                    "title": title,
                    "subtitle": normalize_text(item.get("added_by"), 128),
                    "time": self._overview_item_time(item),
                    "ref": normalize_text(item.get("conversation_id"), 80),
                })

        for item in knowledge_documents:
            if not isinstance(item, dict):
                continue

            title = normalize_text(item.get("title") or "知识库文档", 160)
            recent_items.append({
                "type": "knowledge",
                "title": title,
                "subtitle": normalize_text(item.get("added_by"), 128),
                "time": self._overview_item_time(item),
                "ref": title,
            })

            if bool(item.get("pin", False)):
                pinned_resources.append({
                    "type": "knowledge",
                    "title": title,
                    "subtitle": normalize_text(item.get("added_by"), 128),
                    "time": self._overview_item_time(item),
                    "ref": title,
                })

        for item in workspace_files:
            if not isinstance(item, dict):
                continue

            title = normalize_text(
                item.get("title")
                or item.get("original_name")
                or item.get("alias")
                or "文件",
                180,
            )
            recent_items.append({
                "type": "file",
                "title": title,
                "subtitle": normalize_text(item.get("added_by"), 128),
                "time": self._overview_item_time(item),
                "ref": normalize_text(item.get("file_ref") or item.get("alias"), WORKSPACE_FILE_REF_LIMIT),
            })

            if bool(item.get("pin", False)):
                pinned_resources.append({
                    "type": "file",
                    "title": title,
                    "subtitle": normalize_text(item.get("added_by"), 128),
                    "time": self._overview_item_time(item),
                    "ref": normalize_text(item.get("file_ref") or item.get("alias"), WORKSPACE_FILE_REF_LIMIT),
                })

        recent_items.sort(key=lambda item: str(item.get("time") or ""), reverse=True)
        pinned_resources.sort(key=lambda item: str(item.get("time") or ""), reverse=True)
        open_tasks.sort(key=lambda item: (
            normalize_workspace_task_date(item.get("due_date"), "due_date") or "9999-99-99",
            normalize_workspace_task_date(item.get("start_date"), "start_date") or "9999-99-99",
            str(item.get("created_at") or ""),
        ))

        overdue_task_count = len([
            item for item in open_tasks
            if normalize_workspace_task_date(item.get("due_date"), "due_date")
            and normalize_workspace_task_date(item.get("due_date"), "due_date") < today
        ])

        return {
            "resource_counts": {
                "conversations": len(conversations),
                "knowledge_documents": len(knowledge_documents),
                "workspace_files": len(workspace_files),
                "workspace_tasks": len(workspace_tasks),
            },
            "task_status_counts": task_status_counts,
            "open_task_count": len(open_tasks),
            "overdue_task_count": overdue_task_count,
            "upcoming_tasks": open_tasks[:8],
            "recent_items": recent_items[:10],
            "activity_items": activity_items[:12],
            "pinned_resources": pinned_resources[:8],
        }

    def _filter_for_viewer(
        self,
        workspace: Dict[str, Any],
        viewer_username: str,
        include_conversation_detail: bool = True,
        include_knowledge_detail: bool = True,
        include_file_detail: bool = True,
    ) -> Dict[str, Any]:
        viewer = validate_username(viewer_username)
        owner = validate_username(str(workspace.get("owner_username") or ""))
        result = dict(workspace)
        conversations = workspace.get("conversations", [])
        knowledge_documents = workspace.get("knowledge_documents", [])
        workspace_files = workspace.get("workspace_files", [])
        workspace_tasks = workspace.get("workspace_tasks", [])

        conversations = [
            item for item in conversations
            if isinstance(item, dict) and self._resource_visible_to_viewer(item, viewer)
        ]
        knowledge_documents = [
            item for item in knowledge_documents
            if isinstance(item, dict) and self._resource_visible_to_viewer(item, viewer)
        ]
        workspace_files = [
            item for item in workspace_files
            if isinstance(item, dict) and self._resource_visible_to_viewer(item, viewer)
        ]
        workspace_tasks = [
            item for item in workspace_tasks
            if isinstance(item, dict)
        ]
        workspace_activity = self._filter_workspace_activity_for_visible_resources(
            self._normalize_workspace_activity(workspace.get("workspace_activity", []), owner),
            conversations,
            knowledge_documents,
            workspace_files,
        )

        if include_conversation_detail:
            result["conversations"] = self._conversation_snapshots_for_detail(conversations)
        else:
            result["conversations"] = conversations

        if include_knowledge_detail:
            result["knowledge_documents"] = self._knowledge_document_snapshots_for_detail(knowledge_documents)
        else:
            result["knowledge_documents"] = knowledge_documents

        if include_file_detail:
            result["workspace_files"] = self._file_snapshots_for_detail(workspace_files)
        else:
            result["workspace_files"] = workspace_files

        result["workspace_tasks"] = workspace_tasks
        result["workspace_activity"] = workspace_activity
        result["conversation_count"] = len(conversations)
        result["knowledge_document_count"] = len(knowledge_documents)
        result["workspace_file_count"] = len(workspace_files)
        result["file_count"] = len(workspace_files)
        result["workspace_task_count"] = len(workspace_tasks)
        result["open_task_count"] = len([
            item for item in workspace_tasks
            if normalize_workspace_task_status(item.get("status")) not in {"done", "cancelled"}
        ])
        result["overview"] = self._build_workspace_overview(result)
        return result

    def _summary_for_viewer(
        self,
        workspace: Dict[str, Any],
        viewer_username: str,
        include_marks: bool = False,
    ) -> Dict[str, Any]:
        filtered = self._filter_for_viewer(
            workspace,
            viewer_username,
            include_conversation_detail=False,
            include_knowledge_detail=False,
            include_file_detail=False,
        )
        settings = filtered.get("settings") if isinstance(filtered.get("settings"), dict) else {}
        summary = {
            "workspace_id": filtered.get("workspace_id"),
            "title": filtered.get("title"),
            "owner_username": filtered.get("owner_username"),
            "created_at": filtered.get("created_at"),
            "updated_at": filtered.get("updated_at"),
            "shared_users": settings.get("shared_users", []),
            "conversation_count": filtered.get("conversation_count", 0),
            "knowledge_document_count": len(filtered.get("knowledge_documents", [])),
            "workspace_file_count": len(filtered.get("workspace_files", [])),
            "workspace_task_count": len(filtered.get("workspace_tasks", [])),
            "open_task_count": filtered.get("open_task_count", 0),
            "temp_file_count": len(filtered.get("workspace_files", [])),
        }

        if include_marks:
            summary["conversation_ids"] = [
                normalize_text(item.get("conversation_id"), 80)
                for item in filtered.get("conversations", [])
                if isinstance(item, dict) and normalize_text(item.get("conversation_id"), 80)
            ]
            summary["knowledge_documents"] = [
                {
                    "title": normalize_text(item.get("title"), 160),
                    "knowledge_type": normalize_text(item.get("knowledge_type") or "basis", 32) or "basis",
                    "visibility": normalize_visibility(item.get("visibility") or "private"),
                    "added_by": normalize_text(item.get("added_by"), 128),
                    "pin": bool(item.get("pin", False)),
                }
                for item in filtered.get("knowledge_documents", [])
                if isinstance(item, dict) and normalize_text(item.get("title"), 160)
            ]
            summary["workspace_files"] = [
                {
                    "file_ref": normalize_text(item.get("file_ref"), WORKSPACE_FILE_REF_LIMIT),
                    "alias": normalize_text(item.get("alias"), 180),
                    "visibility": normalize_visibility(item.get("visibility") or "private"),
                    "added_by": normalize_text(item.get("added_by"), 128),
                    "pin": bool(item.get("pin", False)),
                }
                for item in filtered.get("workspace_files", [])
                if isinstance(item, dict) and normalize_text(item.get("file_ref"), WORKSPACE_FILE_REF_LIMIT)
            ]

        return summary


def list_visible_workspaces(username: str, include_marks: bool = False) -> List[Dict[str, Any]]:
    viewer = validate_username(username)
    users_root = os.path.abspath(os.path.join(DATA_DIR, "users"))

    if not os.path.isdir(users_root):
        return []

    result: List[Dict[str, Any]] = []

    for owner in os.listdir(users_root):
        try:
            store = WorkspaceStore(owner)
        except ValueError:
            continue

        result.extend(store.list_owned_workspaces(viewer, include_marks=include_marks))

    result.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
    return result


def find_store_for_visible_workspace(username: str, workspace_id: str) -> WorkspaceStore:
    viewer = validate_username(username)
    wid = validate_workspace_id(workspace_id)

    own_store = WorkspaceStore(viewer)

    try:
        own_store.get_workspace(wid, viewer)
        return own_store
    except FileNotFoundError:
        pass

    users_root = os.path.abspath(os.path.join(DATA_DIR, "users"))

    if not os.path.isdir(users_root):
        raise FileNotFoundError(f"workspace not found: {wid}")

    for owner in os.listdir(users_root):
        if owner == viewer:
            continue

        store = WorkspaceStore(owner)

        try:
            store.get_workspace(wid, viewer)
            return store
        except FileNotFoundError:
            continue
        except PermissionError:
            continue

    raise FileNotFoundError(f"workspace not found: {wid}")
