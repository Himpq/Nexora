import json
import os
import time
import uuid
import glob
from typing import Any, Dict, List, Tuple


EVENT_DIR = os.path.join(".", "data", "events")
EVENT_FILE = os.path.join(EVENT_DIR, "mail_events.jsonl")
MAX_EVENT_FILE_SIZE = 10 * 1024 * 1024
MAX_EVENT_FILES = 5


def _rotate_if_needed():
    if not os.path.exists(EVENT_FILE):
        return
    if os.path.getsize(EVENT_FILE) < MAX_EVENT_FILE_SIZE:
        return

    base, ext = os.path.splitext(EVENT_FILE)
    existing = sorted(glob.glob(f"{base}.*{ext}"), reverse=True)
    for old in existing:
        try:
            head, tail = os.path.splitext(old)
            num = int(tail.split('.')[-1]) + 1
            new_name = f"{head}.{num}{ext}"
            if num <= MAX_EVENT_FILES:
                os.rename(old, new_name)
        except Exception:
            try:
                os.remove(old)
            except Exception:
                pass

    try:
        os.rename(EVENT_FILE, f"{base}.1{ext}")
    except Exception:
        pass


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _mail_username_from_address(address: str) -> str:
    text = _normalize_text(address)

    if "@" in text:
        return text.split("@", 1)[0].strip()

    return text


def append_mail_event(action: str, folder: str, user_group: Any, mail_info: Dict[str, Any]) -> Dict[str, Any]:
    """记录邮件落盘事件，供 NexoraMail API 的 WSS 事件流读取。"""
    info = mail_info if isinstance(mail_info, dict) else {}
    folder_name = _normalize_text(folder) or "inbox"
    sender = _normalize_text(info.get("sender"))
    recipient = _normalize_text(info.get("recipient"))
    address = sender if folder_name == "sent" else recipient
    timestamp_raw = info.get("timestamp") or time.time()

    try:
        timestamp = int(timestamp_raw)
    except Exception:
        timestamp = int(time.time())

    event = {
        "type": "mail_changed",
        "event_id": uuid.uuid4().hex,
        "action": _normalize_text(action) or "changed",
        "folder": folder_name,
        "group": _normalize_text(getattr(user_group, "groupname", "")),
        "id": _normalize_text(info.get("id")),
        "mail_id": _normalize_text(info.get("id")),
        "sender": sender,
        "recipient": recipient,
        "address": address,
        "mail_username": _mail_username_from_address(address),
        "timestamp": timestamp,
        "created_at": int(time.time()),
    }

    os.makedirs(EVENT_DIR, exist_ok=True)
    _rotate_if_needed()
    line = json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"

    with open(EVENT_FILE, "ab") as f:
        f.write(line)
        f.flush()

    return event


def get_event_cursor_end() -> int:
    if not os.path.exists(EVENT_FILE):
        return 0

    return os.path.getsize(EVENT_FILE)


def read_events_after(cursor: int, limit: int = 100) -> Tuple[List[Dict[str, Any]], int]:
    safe_cursor = max(0, int(cursor or 0))
    max_items = min(max(1, int(limit or 100)), 500)

    if not os.path.exists(EVENT_FILE):
        return [], 0

    file_size = os.path.getsize(EVENT_FILE)

    if safe_cursor > file_size:
        safe_cursor = 0

    events: List[Dict[str, Any]] = []

    with open(EVENT_FILE, "rb") as f:
        f.seek(safe_cursor)

        while len(events) < max_items:
            raw_line = f.readline()

            if not raw_line:
                break

            safe_cursor = f.tell()
            line = raw_line.decode("utf-8").strip()

            if not line:
                continue

            event = json.loads(line)

            if not isinstance(event, dict):
                raise ValueError("mail event line must be a JSON object")

            event["_cursor"] = safe_cursor
            events.append(event)

    return events, safe_cursor
