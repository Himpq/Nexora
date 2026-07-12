import hashlib
import json
import threading
import time
import uuid
from typing import Any, Callable, Dict, List, Optional


def _text_hash(content: Any) -> str:
    return hashlib.sha256(str(content or "").encode("utf-8")).hexdigest()


def _clamp_index(value: Any, text: str) -> int:
    try:
        index = int(value)
    except Exception:
        index = 0

    return max(0, min(len(text), index))


def _normalize_operation(raw: Dict[str, Any], content: str) -> Dict[str, Any]:
    op = raw if isinstance(raw, dict) else {}

    try:
        start = max(0, int(op.get("start") or 0))
    except Exception:
        start = 0

    try:
        delete_count = max(0, int(op.get("delete_count") or 0))
    except Exception:
        delete_count = 0

    return {
        "op_id": str(op.get("op_id") or uuid.uuid4().hex),
        "start": start,
        "delete_count": delete_count,
        "insert_text": str(op.get("insert_text") or ""),
    }


def _apply_operation(content: str, op: Dict[str, Any]) -> str:
    start = _clamp_index(op.get("start"), content)
    delete_count = max(0, int(op.get("delete_count") or 0))
    insert_text = str(op.get("insert_text") or "")
    end = min(len(content), start + delete_count)

    return content[:start] + insert_text + content[end:]


def _operation_delta(op: Dict[str, Any]) -> int:
    return len(str(op.get("insert_text") or "")) - max(0, int(op.get("delete_count") or 0))


def _offset_to_line_col(text: str, offset: int) -> Dict[str, int]:
    safe_text = str(text or "")
    safe_offset = max(0, min(len(safe_text), int(offset or 0)))
    before = safe_text[:safe_offset]
    lines = before.split("\n")

    return {
        "offset": safe_offset,
        "line": max(0, len(lines) - 1),
        "col": max(0, len(lines[-1] if lines else "")),
    }


def _line_col_to_offset(text: str, line: int, col: int) -> int:
    safe_text = str(text or "")
    safe_line = max(0, int(line or 0))
    safe_col = max(0, int(col or 0))
    lines = safe_text.split("\n")

    if safe_line >= len(lines):
        return len(safe_text)

    offset = sum(len(lines[i]) + 1 for i in range(safe_line))
    return max(0, min(len(safe_text), offset + min(safe_col, len(lines[safe_line]))))


def _transform_index(index: int, op: Dict[str, Any], prefer_after_insert: bool) -> int:
    start = max(0, int(op.get("start") or 0))
    delete_count = max(0, int(op.get("delete_count") or 0))
    insert_len = len(str(op.get("insert_text") or ""))
    end = start + delete_count

    if index < start:
        return index

    if index > end:
        return max(0, index + insert_len - delete_count)

    if index == start and prefer_after_insert:
        return start + insert_len

    return start


def _transform_operation(op: Dict[str, Any], committed: Dict[str, Any]) -> Dict[str, Any]:
    transformed = dict(op)
    start = max(0, int(transformed.get("start") or 0))
    end = start + max(0, int(transformed.get("delete_count") or 0))

    next_start = _transform_index(start, committed, False)
    next_end = _transform_index(end, committed, False)
    transformed["start"] = max(0, next_start)
    transformed["delete_count"] = max(0, next_end - next_start)

    return transformed


def _normalize_cursor(cursor: Any, content: str) -> Optional[Dict[str, int]]:
    if not isinstance(cursor, dict):
        return None

    if cursor.get("offset") is not None:
        try:
            offset = int(cursor.get("offset") or 0)
        except Exception:
            offset = 0
    else:
        offset = _line_col_to_offset(content, int(cursor.get("line") or 0), int(cursor.get("col") or 0))

    normalized = _offset_to_line_col(content, offset)

    try:
        anchor = int(cursor.get("anchor")) if cursor.get("anchor") is not None else normalized["offset"]
    except Exception:
        anchor = normalized["offset"]

    normalized["anchor"] = max(0, min(len(str(content or "")), anchor))
    return normalized


def _transform_cursor(cursor: Any, old_content: str, new_content: str, op: Dict[str, Any]) -> Optional[Dict[str, int]]:
    if not isinstance(cursor, dict):
        return None

    if cursor.get("offset") is not None:
        try:
            offset = int(cursor.get("offset") or 0)
        except Exception:
            offset = 0
    else:
        offset = _line_col_to_offset(old_content, int(cursor.get("line") or 0), int(cursor.get("col") or 0))

    try:
        anchor = int(cursor.get("anchor")) if cursor.get("anchor") is not None else offset
    except Exception:
        anchor = offset

    next_offset = _transform_index(offset, op, False)
    transformed = _offset_to_line_col(new_content, next_offset)
    transformed["anchor"] = max(0, min(len(str(new_content or "")), _transform_index(anchor, op, False)))
    return transformed


class KnowledgeCollabHub:
    """In-memory character operation room for one knowledge share."""

    def __init__(self) -> None:
        self._rooms: Dict[str, Dict[str, Any]] = {}
        self._rooms_lock = threading.Lock()
        self._history_limit = 800
        self._flush_delay = 1.2

    def _room_key(self, owner_username: str, share_id: str) -> str:
        owner = str(owner_username or "").strip()
        sid = str(share_id or "").strip()

        if not owner or not sid:
            return ""

        return f"{owner}:{sid}"

    def _ensure_room(
        self,
        *,
        owner_username: str,
        share_id: str,
        title: str,
        content: str,
        save_callback: Callable[[str], Optional[Dict[str, Any]]],
    ) -> Dict[str, Any]:
        room_key = self._room_key(owner_username, share_id)

        with self._rooms_lock:
            room = self._rooms.get(room_key)

            if not room:
                room = {
                    "room_key": room_key,
                    "owner_username": str(owner_username or "").strip(),
                    "share_id": str(share_id or "").strip(),
                    "title": str(title or "").strip(),
                    "content": str(content or ""),
                    "revision": 0,
                    "history": [],
                    "clients": {},
                    "lock": threading.RLock(),
                    "dirty": False,
                    "flush_timer": None,
                    "save_callback": save_callback,
                    "last_saved_hash": _text_hash(content),
                }
                self._rooms[room_key] = room
            else:
                room["title"] = str(title or room.get("title") or "").strip()
                room["save_callback"] = save_callback

        return room

    def _safe_send(self, client: Dict[str, Any], payload: Dict[str, Any]) -> bool:
        ws = client.get("ws")
        send_lock = client.get("send_lock")

        if not ws or not send_lock:
            return False

        try:
            with send_lock:
                ws.send(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))

            return True
        except Exception:
            return False

    def _members_payload(self, room: Dict[str, Any]) -> List[Dict[str, Any]]:
        members = []

        for client_id, client in room.get("clients", {}).items():
            members.append({
                "client_id": client_id,
                "role": str(client.get("role") or "public").strip(),
                "display_name": str(client.get("display_name") or "").strip(),
                "cursor": client.get("cursor") or None,
                "connected_at": client.get("connected_at") or 0,
            })

        members.sort(key=lambda item: (item.get("role") != "owner", item.get("connected_at") or 0))
        return members

    def _broadcast(self, room: Dict[str, Any], payload: Dict[str, Any]) -> None:
        with room["lock"]:
            clients = dict(room.get("clients") or {})

        dead_client_ids = []

        for client_id, client in clients.items():

            if not self._safe_send(client, payload):
                dead_client_ids.append(client_id)

        if dead_client_ids:
            with room["lock"]:
                for client_id in dead_client_ids:
                    room.get("clients", {}).pop(client_id, None)

    def _broadcast_members(self, room: Dict[str, Any]) -> None:
        self._broadcast(room, {
            "type": "knowledge_collab_members",
            "room": room.get("room_key") or "",
            "revision": room.get("revision") or 0,
            "members": self._members_payload(room),
        })

    def _schedule_flush(self, room: Dict[str, Any]) -> None:
        def flush_room() -> None:
            self.flush_room(room)

        with room["lock"]:
            old_timer = room.get("flush_timer")

            if old_timer:
                old_timer.cancel()

            timer = threading.Timer(self._flush_delay, flush_room)
            timer.daemon = True
            room["flush_timer"] = timer
            timer.start()

    def flush_room(self, room: Dict[str, Any]) -> None:
        with room["lock"]:
            room["flush_timer"] = None

            if not room.get("dirty"):
                return

            content = str(room.get("content") or "")
            content_hash = _text_hash(content)

            if content_hash == room.get("last_saved_hash"):
                room["dirty"] = False
                return

            save_callback = room.get("save_callback")
            revision = int(room.get("revision") or 0)

        if not callable(save_callback):
            return

        try:
            result = save_callback(content) or {}
        except Exception as exc:
            result = {"success": False, "message": repr(exc)}

        with room["lock"]:
            if result.get("success") is not False and revision == int(room.get("revision") or 0):
                room["dirty"] = False

            if result.get("success") is not False:
                room["last_saved_hash"] = content_hash

        self._broadcast(room, {
            "type": "knowledge_collab_saved",
            "room": room.get("room_key") or "",
            "revision": room.get("revision") or 0,
            "content_hash": content_hash,
            "saved": result.get("success") is not False,
            "message": str(result.get("message") or ""),
            "version": result if isinstance(result, dict) else {},
        })

    def attach_client(
        self,
        ws: Any,
        *,
        owner_username: str,
        share_id: str,
        title: str,
        content: str,
        role: str,
        display_name: str,
        save_callback: Callable[[str], Optional[Dict[str, Any]]],
    ) -> None:
        room = self._ensure_room(
            owner_username=owner_username,
            share_id=share_id,
            title=title,
            content=content,
            save_callback=save_callback,
        )
        client_id = uuid.uuid4().hex
        client = {
            "client_id": client_id,
            "ws": ws,
            "send_lock": threading.Lock(),
            "role": str(role or "public").strip() or "public",
            "display_name": str(display_name or "").strip(),
            "cursor": None,
            "connected_at": int(time.time()),
        }

        with room["lock"]:
            room.setdefault("clients", {})[client_id] = client
            snapshot = {
                "type": "knowledge_collab_snapshot",
                "client_id": client_id,
                "room": room.get("room_key") or "",
                "owner_username": room.get("owner_username") or "",
                "share_id": room.get("share_id") or "",
                "title": room.get("title") or "",
                "revision": room.get("revision") or 0,
                "content": room.get("content") or "",
                "content_hash": _text_hash(room.get("content") or ""),
                "members": self._members_payload(room),
            }

        self._safe_send(client, snapshot)
        self._broadcast_members(room)

        try:
            while True:
                raw = ws.receive()

                if raw is None:
                    break

                try:
                    payload = json.loads(raw) if raw else {}
                except Exception:
                    payload = {}

                self._handle_client_payload(room, client_id, payload)
        finally:
            with room["lock"]:
                room.get("clients", {}).pop(client_id, None)

            self._broadcast_members(room)

    def _handle_client_payload(self, room: Dict[str, Any], client_id: str, payload: Dict[str, Any]) -> None:
        data = payload if isinstance(payload, dict) else {}
        msg_type = str(data.get("type") or "").strip()

        if msg_type == "ping":
            client = (room.get("clients") or {}).get(client_id)

            if client:
                self._safe_send(client, {
                    "type": "pong",
                    "client_id": client_id,
                    "revision": room.get("revision") or 0,
                })

            return

        if msg_type == "cursor":
            self._update_cursor(room, client_id, data.get("cursor"))
            return

        if msg_type == "edit_op":
            self._apply_client_operation(room, client_id, data)

    def _update_cursor(self, room: Dict[str, Any], client_id: str, cursor: Any) -> None:
        with room["lock"]:
            client = (room.get("clients") or {}).get(client_id)

            if not client:
                return

            if isinstance(cursor, dict):
                client["cursor"] = _normalize_cursor(cursor, str(room.get("content") or ""))
            else:
                client["cursor"] = None

            payload = {
                "type": "knowledge_collab_cursor",
                "client_id": client_id,
                "cursor": client.get("cursor"),
                "members": self._members_payload(room),
            }

        self._broadcast(room, payload)

    def _apply_client_operation(self, room: Dict[str, Any], client_id: str, payload: Dict[str, Any]) -> None:
        with room["lock"]:
            client = (room.get("clients") or {}).get(client_id)

            if not client:
                return

            content = str(room.get("content") or "")
            base_revision = max(0, int(payload.get("revision") or 0))
            current_revision = int(room.get("revision") or 0)
            op = _normalize_operation(payload, content)
            history = list(room.get("history") or [])

            for item in history:
                item_revision = int(item.get("revision") or 0)

                if item_revision > base_revision:
                    op = _transform_operation(op, item.get("op") or {})

            next_content = _apply_operation(content, op)
            next_revision = current_revision + 1
            room["content"] = next_content
            room["revision"] = next_revision
            room["dirty"] = True

            history.append({
                "revision": next_revision,
                "op": dict(op),
                "client_id": client_id,
                "created_at": time.time(),
            })
            room["history"] = history[-self._history_limit:]

            cursor = payload.get("cursor") if isinstance(payload.get("cursor"), dict) else None

            for member_client_id, member_client in (room.get("clients") or {}).items():

                if member_client_id == client_id:

                    if cursor:
                        member_client["cursor"] = _normalize_cursor(cursor, next_content)

                    continue

                member_client["cursor"] = _transform_cursor(member_client.get("cursor"), content, next_content, op)

            broadcast_payload = {
                "type": "knowledge_collab_op",
                "room": room.get("room_key") or "",
                "client_id": client_id,
                "role": client.get("role") or "public",
                "display_name": client.get("display_name") or "",
                "revision": next_revision,
                "base_revision": base_revision,
                "op": op,
                "cursor": client.get("cursor"),
                "content_hash": _text_hash(next_content),
                "members": self._members_payload(room),
            }

        self._broadcast(room, broadcast_payload)
        self._schedule_flush(room)
