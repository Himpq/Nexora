"""User storage helpers for NexoraLearning.

Directory layout:
  data/
    users/
      {user_id}/
        user.json
        learning.jsonl
        notifications.jsonl
        question_completions.jsonl
        question_bank.jsonl
    questions/
      bank/
        all_questions.jsonl
      users/
        {user_id}/
          question_refs.jsonl
        memories/
          soul.md
          user.md
          context/
            {lecture_id}.md
"""

from __future__ import annotations

import json
import hashlib
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

_lock = threading.Lock()

MEMORY_FILE_NAMES = {
    "soul": "soul.md",
    "user": "user.md",
}


def _users_root(cfg: Dict[str, Any]) -> Path:
    return Path(cfg.get("data_dir") or "data") / "users"


def _user_dir(cfg: Dict[str, Any], user_id: str) -> Path:
    return _users_root(cfg) / user_id


def _user_json_path(cfg: Dict[str, Any], user_id: str) -> Path:
    return _user_dir(cfg, user_id) / "user.json"


def _learning_jsonl_path(cfg: Dict[str, Any], user_id: str) -> Path:
    return _user_dir(cfg, user_id) / "learning.jsonl"


def _question_completions_jsonl_path(cfg: Dict[str, Any], user_id: str) -> Path:
    return _user_dir(cfg, user_id) / "question_completions.jsonl"


def _question_bank_jsonl_path(cfg: Dict[str, Any], user_id: str) -> Path:
    return _user_dir(cfg, user_id) / "question_bank.jsonl"


def _notifications_jsonl_path(cfg: Dict[str, Any], user_id: str) -> Path:
    return _user_dir(cfg, user_id) / "notifications.jsonl"


def _questions_root(cfg: Dict[str, Any]) -> Path:
    return Path(cfg.get("data_dir") or "data") / "questions"


def _question_bank_root(cfg: Dict[str, Any]) -> Path:
    return _questions_root(cfg) / "bank"


def _question_bank_all_path(cfg: Dict[str, Any]) -> Path:
    return _question_bank_root(cfg) / "all_questions.jsonl"


def _question_refs_root(cfg: Dict[str, Any]) -> Path:
    return _questions_root(cfg) / "users"


def _question_refs_path(cfg: Dict[str, Any], user_id: str) -> Path:
    return _question_refs_root(cfg) / user_id / "question_refs.jsonl"


def _memories_dir(cfg: Dict[str, Any], user_id: str) -> Path:
    return _user_dir(cfg, user_id) / "memories"


def _context_memories_dir(cfg: Dict[str, Any], user_id: str) -> Path:
    return _memories_dir(cfg, user_id) / "context"


def _memory_path(cfg: Dict[str, Any], user_id: str, memory_type: str) -> Path:
    filename = MEMORY_FILE_NAMES.get(memory_type)
    if not filename:
        raise ValueError(f"Unsupported memory type: {memory_type}")
    return _memories_dir(cfg, user_id) / filename


def _normalize_user_record(data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    user = dict(data or {})
    user["id"] = str(user.get("id") or "").strip()
    user["username"] = str(user.get("username") or "").strip()
    user["display_name"] = str(user.get("display_name") or "").strip()
    user["description"] = str(user.get("description") or "").strip()
    role = str(user.get("role") or "member").strip().lower() or "member"
    user["role"] = role
    identity = str(user.get("identity") or "").strip().lower()
    if identity not in {"student", "teacher"}:
        identity = "student"
    user["identity"] = identity
    return user


def _lecture_context_memory_path(cfg: Dict[str, Any], user_id: str, lecture_id: str) -> Path:
    lecture_key = str(lecture_id or "").strip()
    if not lecture_key:
        raise ValueError("lecture_id cannot be empty")
    return _context_memories_dir(cfg, user_id) / f"{lecture_key}.md"


def ensure_user_root(cfg: Dict[str, Any]) -> Path:
    root = _users_root(cfg)
    root.mkdir(parents=True, exist_ok=True)
    return root


def ensure_question_bank_files(cfg: Dict[str, Any], user_id: str = "") -> Dict[str, str]:
    root = _questions_root(cfg)
    bank_root = _question_bank_root(cfg)
    refs_root = _question_refs_root(cfg)
    root.mkdir(parents=True, exist_ok=True)
    bank_root.mkdir(parents=True, exist_ok=True)
    refs_root.mkdir(parents=True, exist_ok=True)
    all_path = _question_bank_all_path(cfg)
    if not all_path.exists():
        all_path.write_text("", encoding="utf-8")
    result = {
        "questions_root": str(root),
        "question_bank_root": str(bank_root),
        "question_bank_all": str(all_path),
        "question_refs_root": str(refs_root),
    }
    if user_id:
        ref_path = _question_refs_path(cfg, user_id)
        ref_path.parent.mkdir(parents=True, exist_ok=True)
        if not ref_path.exists():
            ref_path.write_text("", encoding="utf-8")
        result["question_refs"] = str(ref_path)
    return result


def list_users(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    root = _users_root(cfg)
    if not root.exists():
        return []

    users: List[Dict[str, Any]] = []
    for entry in sorted(root.iterdir()):
        user_path = entry / "user.json"
        if entry.is_dir() and user_path.exists():
            data = _read_json(user_path)
            if data:
                users.append(_normalize_user_record(data))
    return users


def get_user(cfg: Dict[str, Any], user_id: str) -> Optional[Dict[str, Any]]:
    data = _read_json(_user_json_path(cfg, user_id))
    return _normalize_user_record(data) if data else None


def create_user(
    cfg: Dict[str, Any],
    *,
    user_id: str = "",
    username: str = "",
    display_name: str = "",
    description: str = "",
    identity: str = "student",
) -> Dict[str, Any]:
    resolved_user_id = (user_id or f"u_{uuid.uuid4().hex[:12]}").strip()
    if not resolved_user_id:
        raise ValueError("user_id cannot be empty")

    user_dir = _user_dir(cfg, resolved_user_id)
    user_dir.mkdir(parents=True, exist_ok=True)

    ensure_user_files(cfg, resolved_user_id)

    now = int(time.time())
    user = {
        "id": resolved_user_id,
        "username": username.strip(),
        "display_name": display_name.strip(),
        "description": description.strip(),
        "identity": str(identity or "student").strip().lower() or "student",
        "created_at": now,
        "updated_at": now,
    }
    user = _normalize_user_record(user)
    _write_json(_user_json_path(cfg, resolved_user_id), user)
    return user


def update_user(cfg: Dict[str, Any], user_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    user = get_user(cfg, user_id)
    if user is None:
        return None

    user.update(dict(updates or {}))
    user = _normalize_user_record(user)
    user["updated_at"] = int(time.time())
    _write_json(_user_json_path(cfg, user_id), user)
    return user


def delete_user(cfg: Dict[str, Any], user_id: str) -> bool:
    user_dir = _user_dir(cfg, user_id)
    if not user_dir.exists():
        return False
    shutil.rmtree(str(user_dir))
    return True


def ensure_user_files(cfg: Dict[str, Any], user_id: str) -> Dict[str, str]:
    user_dir = _user_dir(cfg, user_id)
    memories_dir = _memories_dir(cfg, user_id)
    context_dir = _context_memories_dir(cfg, user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    memories_dir.mkdir(parents=True, exist_ok=True)
    context_dir.mkdir(parents=True, exist_ok=True)
    ensure_question_bank_files(cfg, user_id)

    user_json_path = _user_json_path(cfg, user_id)
    if not user_json_path.exists():
        _write_json(
            user_json_path,
            {
                "id": user_id,
                "username": "",
                "display_name": "",
                "description": "",
                "identity": "student",
                "created_at": int(time.time()),
                "updated_at": int(time.time()),
            },
        )

    for jsonl_path in (
        _learning_jsonl_path(cfg, user_id),
        _notifications_jsonl_path(cfg, user_id),
        _question_completions_jsonl_path(cfg, user_id),
        _question_bank_jsonl_path(cfg, user_id),
    ):
        if not jsonl_path.exists():
            jsonl_path.write_text("", encoding="utf-8")

    for memory_type in MEMORY_FILE_NAMES:
        path = _memory_path(cfg, user_id, memory_type)
        if not path.exists():
            path.write_text("", encoding="utf-8")

    return {
        "user": str(user_json_path),
        "learning": str(_learning_jsonl_path(cfg, user_id)),
        "notifications": str(_notifications_jsonl_path(cfg, user_id)),
        "question_completions": str(_question_completions_jsonl_path(cfg, user_id)),
        "question_bank": str(_question_bank_jsonl_path(cfg, user_id)),
        "memories": str(memories_dir),
        "context_memories": str(context_dir),
    }


def append_learning_record(
    cfg: Dict[str, Any],
    user_id: str,
    record: Dict[str, Any],
) -> Dict[str, Any]:
    ensure_user_files(cfg, user_id)
    payload = dict(record or {})
    payload.setdefault("completion_id", f"qc_{uuid.uuid4().hex[:20]}")
    payload.setdefault("timestamp", int(time.time()))
    _append_jsonl(_learning_jsonl_path(cfg, user_id), payload)
    return payload


def list_learning_records(cfg: Dict[str, Any], user_id: str) -> List[Dict[str, Any]]:
    return _read_jsonl(_learning_jsonl_path(cfg, user_id))


def remove_chapter_learning_records(
    cfg: Dict[str, Any],
    user_id: str,
    lecture_id: str,
    book_id: str,
    chapter_name: str,
    chapter_index: int,
) -> Dict[str, int]:
    """删除指定章节的阅读完成记录，保留测验与题库等独立文件。"""
    ensure_user_files(cfg, user_id)
    path = _learning_jsonl_path(cfg, user_id)
    rows = _read_jsonl(path)
    kept: List[Dict[str, Any]] = []
    removed = 0
    target_lecture_id = str(lecture_id or "").strip()
    target_book_id = str(book_id or "").strip()
    target_chapter_name = str(chapter_name or "").strip()
    target_chapter_index = int(chapter_index)

    for row in rows:
        record_type = str(row.get("type") or "").strip()
        same_book = (
            str(row.get("lecture_id") or "").strip() == target_lecture_id
            and str(row.get("book_id") or "").strip() == target_book_id
        )
        same_chapter_name = str(row.get("chapter_name") or "").strip() == target_chapter_name

        raw_chapter_index = str(row.get("chapter_index") if row.get("chapter_index") is not None else "").strip()
        row_chapter_index = int(raw_chapter_index) if raw_chapter_index.lstrip("-").isdigit() else -1
        same_chapter_index = row_chapter_index == target_chapter_index
        remove_record = same_book and (
            (record_type == "chapter_completed" and same_chapter_name)
            or (record_type == "session_completed" and (same_chapter_name or same_chapter_index))
        )

        if remove_record:
            removed += 1
            continue

        kept.append(row)

    serialized = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in kept)

    with _lock:
        path.write_text(serialized, encoding="utf-8")

    return {"removed": removed, "remaining": len(kept)}


def append_notification(
    cfg: Dict[str, Any],
    user_id: str,
    record: Dict[str, Any],
) -> Dict[str, Any]:
    ensure_user_files(cfg, user_id)
    payload = dict(record or {})
    payload.setdefault("notification_id", f"notice_{uuid.uuid4().hex[:16]}")
    payload.setdefault("type", "notification")
    payload.setdefault("date", int(time.time()))
    payload.setdefault("title", "")
    payload.setdefault("content", "")
    payload.setdefault("jumpto", "")
    payload.setdefault("removed", False)
    path = _notifications_jsonl_path(cfg, user_id)
    serialized = json.dumps(payload, ensure_ascii=False) + "\n"
    with _lock:
        previous = path.read_text(encoding="utf-8") if path.exists() else ""
        path.write_text(serialized + previous, encoding="utf-8")
    return payload


def _resolve_notification_id(payload: Dict[str, Any]) -> str:
    explicit_id = str(payload.get("notification_id") or payload.get("id") or "").strip()

    if explicit_id:
        return explicit_id

    stable_source = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha1(stable_source.encode("utf-8")).hexdigest()[:16]
    return f"notice_{digest}"


def list_notifications(cfg: Dict[str, Any], user_id: str) -> List[Dict[str, Any]]:
    path = _notifications_jsonl_path(cfg, user_id)
    rows = _read_jsonl(path)
    normalized: List[Dict[str, Any]] = []

    for row in rows:
        payload = dict(row)
        notification_id = _resolve_notification_id(payload)
        if payload.get("notification_id") != notification_id:
            payload["notification_id"] = notification_id

        normalized.append(payload)

    return normalized


def mark_notification_removed(
    cfg: Dict[str, Any],
    user_id: str,
    notification_id: str,
) -> Dict[str, Any]:
    """将通知标记为已移除，而不是从通知记录文件中删除。"""
    target_id = str(notification_id or "").strip()

    if not target_id:
        return {"updated": False, "notification_id": target_id}

    rows = list_notifications(cfg, user_id)
    updated = False
    now = int(time.time())
    kept_rows: List[Dict[str, Any]] = []

    for row in rows:
        payload = dict(row)
        row_id = str(payload.get("notification_id") or payload.get("id") or "").strip()

        if row_id == target_id:
            payload["removed"] = True
            payload["removed_at"] = now
            updated = True

        kept_rows.append(payload)

    if updated:
        _write_jsonl_rows(_notifications_jsonl_path(cfg, user_id), kept_rows)

    return {"updated": updated, "notification_id": target_id}


def append_question_completion(
    cfg: Dict[str, Any],
    user_id: str,
    record: Dict[str, Any],
) -> Dict[str, Any]:
    ensure_user_files(cfg, user_id)
    payload = dict(record or {})
    payload.setdefault("timestamp", int(time.time()))
    _append_jsonl(_question_completions_jsonl_path(cfg, user_id), payload)
    return payload


def list_question_completions(cfg: Dict[str, Any], user_id: str) -> List[Dict[str, Any]]:
    return _read_jsonl(_question_completions_jsonl_path(cfg, user_id))


def _question_group_id_from_record(record: Dict[str, Any]) -> str:
    existing = str(record.get("question_group_id") or record.get("group_id") or "").strip()
    if existing:
        return existing
    parts = [
        str(record.get("job_id") or "").strip(),
        str(record.get("lecture_id") or "").strip(),
        str(record.get("book_id") or "").strip(),
        str(record.get("chapter_name") or "").strip(),
        str(record.get("chapter_range") or "").strip(),
        str(record.get("generation_mode") or record.get("reason") or record.get("type") or "").strip(),
    ]
    raw = "|".join(parts)
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
    return f"qg_{digest}"


def append_question_bank_item(
    cfg: Dict[str, Any],
    user_id: str,
    record: Dict[str, Any],
) -> Dict[str, Any]:
    ensure_user_files(cfg, user_id)
    ensure_question_bank_files(cfg, user_id)
    payload = dict(record or {})
    payload.setdefault("question_id", f"q_{uuid.uuid4().hex[:16]}")
    if not str(payload.get("question_group_id") or payload.get("group_id") or "").strip():
        payload["question_group_id"] = _question_group_id_from_record(payload)
    payload.setdefault("timestamp", int(time.time()))
    _append_jsonl(_question_bank_jsonl_path(cfg, user_id), payload)
    _append_jsonl(_question_bank_all_path(cfg), payload)
    _append_jsonl(
        _question_refs_path(cfg, user_id),
        {
            "question_id": payload.get("question_id"),
            "question_group_id": payload.get("question_group_id"),
            "lecture_id": payload.get("lecture_id"),
            "book_id": payload.get("book_id"),
            "chapter_name": payload.get("chapter_name"),
            "timestamp": payload.get("timestamp"),
            "type": payload.get("type"),
        },
    )
    return payload


def list_question_bank_items(cfg: Dict[str, Any], user_id: str) -> List[Dict[str, Any]]:
    return _read_jsonl(_question_bank_jsonl_path(cfg, user_id))


def read_memory(cfg: Dict[str, Any], user_id: str, memory_type: str) -> str:
    path = _memory_path(cfg, user_id, memory_type)
    try:
        if not path.exists():
            return ""
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def write_memory(cfg: Dict[str, Any], user_id: str, memory_type: str, content: str) -> str:
    ensure_user_files(cfg, user_id)
    path = _memory_path(cfg, user_id, memory_type)
    with _lock:
        path.write_text(content or "", encoding="utf-8")
    return str(path)


def read_lecture_context_memory(cfg: Dict[str, Any], user_id: str, lecture_id: str) -> str:
    path = _lecture_context_memory_path(cfg, user_id, lecture_id)
    try:
        if not path.exists():
            return ""
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def write_lecture_context_memory(cfg: Dict[str, Any], user_id: str, lecture_id: str, content: str) -> str:
    ensure_user_files(cfg, user_id)
    path = _lecture_context_memory_path(cfg, user_id, lecture_id)
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content or "", encoding="utf-8")
    return str(path)


def list_lecture_context_memories(cfg: Dict[str, Any], user_id: str) -> Dict[str, str]:
    root = _context_memories_dir(cfg, user_id)
    rows: Dict[str, str] = {}
    if not root.exists():
        return rows

    try:
        for path in sorted(root.glob("*.md")):
            lecture_id = str(path.stem or "").strip()
            if not lecture_id:
                continue
            try:
                rows[lecture_id] = path.read_text(encoding="utf-8")
            except Exception:
                rows[lecture_id] = ""
    except Exception:
        return {}
    return rows


def get_user_state(cfg: Dict[str, Any], user_id: str) -> Dict[str, Any]:
    return {
        "user": get_user(cfg, user_id),
        "learning": list_learning_records(cfg, user_id),
        "notifications": list_notifications(cfg, user_id),
        "question_completions": list_question_completions(cfg, user_id),
        "question_bank": list_question_bank_items(cfg, user_id),
        "memories": {
            memory_type: read_memory(cfg, user_id, memory_type)
            for memory_type in MEMORY_FILE_NAMES
        },
        "context_memories": list_lecture_context_memories(cfg, user_id),
    }


def set_lecture_selection(
    cfg: Dict[str, Any],
    user_id: str,
    lecture_id: str,
    *,
    selected: bool,
    actor: str = "",
) -> Dict[str, Any]:
    lecture_key = str(lecture_id or "").strip()
    if not lecture_key:
        raise ValueError("lecture_id is required")
    record = {
        "type": "lecture_selection",
        "lecture_id": lecture_key,
        "selected": bool(selected),
        "actor": str(actor or "").strip(),
    }
    return append_learning_record(cfg, user_id, record)


def list_selected_lecture_ids(cfg: Dict[str, Any], user_id: str) -> List[str]:
    records = list_learning_records(cfg, user_id)
    states: Dict[str, bool] = {}
    for row in records:
        if not isinstance(row, dict):
            continue
        if str(row.get("type") or "").strip() != "lecture_selection":
            continue
        lecture_id = str(row.get("lecture_id") or "").strip()
        if not lecture_id:
            continue
        states[lecture_id] = bool(row.get("selected"))
    return [lecture_id for lecture_id, is_selected in states.items() if is_selected]


def _read_json(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _read_jsonl(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    rows: List[Dict[str, Any]] = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except Exception:
                continue
            if isinstance(data, dict):
                rows.append(data)
    except Exception:
        return []
    return rows


def _append_jsonl(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False) + "\n"
    with _lock:
        previous = path.read_text(encoding="utf-8") if path.exists() else ""
        path.write_text(previous + serialized, encoding="utf-8")


def _write_jsonl_rows(path: Path, rows: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)

    with _lock:
        path.write_text(serialized, encoding="utf-8")


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with _lock:
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
