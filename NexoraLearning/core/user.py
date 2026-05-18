"""User storage helpers for NexoraLearning.

Directory layout:
  data/
    users/
      {user_id}/
        user.json
        learning.jsonl
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
                users.append(data)
    return users


def get_user(cfg: Dict[str, Any], user_id: str) -> Optional[Dict[str, Any]]:
    return _read_json(_user_json_path(cfg, user_id))


def create_user(
    cfg: Dict[str, Any],
    *,
    user_id: str = "",
    username: str = "",
    display_name: str = "",
    description: str = "",
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
        "created_at": now,
        "updated_at": now,
    }
    _write_json(_user_json_path(cfg, resolved_user_id), user)
    return user


def update_user(cfg: Dict[str, Any], user_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    user = get_user(cfg, user_id)
    if user is None:
        return None

    user.update(dict(updates or {}))
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
                "created_at": int(time.time()),
                "updated_at": int(time.time()),
            },
        )

    for jsonl_path in (
        _learning_jsonl_path(cfg, user_id),
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
    payload.setdefault("timestamp", int(time.time()))
    _append_jsonl(_learning_jsonl_path(cfg, user_id), payload)
    return payload


def list_learning_records(cfg: Dict[str, Any], user_id: str) -> List[Dict[str, Any]]:
    return _read_jsonl(_learning_jsonl_path(cfg, user_id))


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


def append_question_bank_item(
    cfg: Dict[str, Any],
    user_id: str,
    record: Dict[str, Any],
) -> Dict[str, Any]:
    ensure_user_files(cfg, user_id)
    ensure_question_bank_files(cfg, user_id)
    payload = dict(record or {})
    payload.setdefault("question_id", f"q_{uuid.uuid4().hex[:16]}")
    payload.setdefault("timestamp", int(time.time()))
    _append_jsonl(_question_bank_jsonl_path(cfg, user_id), payload)
    _append_jsonl(_question_bank_all_path(cfg), payload)
    _append_jsonl(
        _question_refs_path(cfg, user_id),
        {
            "question_id": payload.get("question_id"),
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
    ensure_user_files(cfg, user_id)
    path = _memory_path(cfg, user_id, memory_type)
    try:
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
    ensure_user_files(cfg, user_id)
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
    ensure_user_files(cfg, user_id)
    root = _context_memories_dir(cfg, user_id)
    rows: Dict[str, str] = {}
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
    ensure_user_files(cfg, user_id)
    return {
        "user": get_user(cfg, user_id),
        "learning": list_learning_records(cfg, user_id),
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


def _write_json(path: Path, data: Any) -> None:
    with _lock:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _append_jsonl(path: Path, data: Dict[str, Any]) -> None:
    with _lock:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(data, ensure_ascii=False) + "\n")


def _read_jsonl(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    rows: List[Dict[str, Any]] = []
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
    return rows
