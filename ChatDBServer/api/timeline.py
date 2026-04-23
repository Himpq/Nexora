import difflib
import json
import os
import time
from typing import Any, Dict, List, Optional

from datastorage import get_user_lock, safe_append_jsonl, safe_read_jsonl_tail, safe_read_json

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
TIMELINE_DIR = os.path.join(DATA_DIR, "users")

def _timeline_path(username: str, is_jsonl: bool = True) -> str:
    user = str(username or "").strip() or "unknown"
    ext = "jsonl" if is_jsonl else "json"
    return os.path.join(TIMELINE_DIR, user, f"timeline.{ext}")

def _default_store() -> Dict[str, Any]:
    return {"version": 1, "items": []}

def _ensure_hot_migration(username: str):
    user = str(username or "").strip() or "unknown"
    old_path = _timeline_path(user, is_jsonl=False)
    new_path = _timeline_path(user, is_jsonl=True)
    
    with get_user_lock(user):
        if os.path.exists(old_path) and not os.path.exists(new_path):
            try:
                store = safe_read_json(old_path, default=_default_store())
                items = store.get("items", []) if isinstance(store, dict) else []
                if items:
                    real_items = [i for i in items if isinstance(i, dict)]
                    real_items.reverse()  # 旧版是最新的排最前，转换 JSONL 时老数据放前面
                    
                    directory = os.path.dirname(new_path)
                    if directory:
                        os.makedirs(directory, exist_ok=True)
                        
                    with open(new_path, "w", encoding="utf-8") as f:
                        for it in real_items:
                            f.write(json.dumps(it, ensure_ascii=False) + "\n")
                try:
                    os.remove(old_path)
                except: pass
            except Exception as e:
                print(f"[Timeline] 迁移 timeline 失败: {e}")


def _clip_one_line(text: Any, limit: int = 120) -> str:
    src = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    src = " ".join(part.strip() for part in src.split("\n") if part.strip())
    src = " ".join(src.split())
    if not src:
        return ""
    lim = max(24, min(int(limit or 120), 400))
    if len(src) <= lim:
        return src
    return src[:lim].rstrip() + "..."


def _timeline_action_prefix(action: Any) -> str:
    key = str(action or "update").strip().lower()
    if key == "add":
        return "新增"
    if key == "delete":
        return "删除"
    return "修改"


def _timeline_subject_label(value: Any, *, fallback: str = "记录", limit: int = 28) -> str:
    text = _clip_one_line(value, limit)
    return text or fallback


def _build_difference(before: Any = "", after: Any = "", *, limit: int = 120) -> str:
    old_text = _clip_one_line(before, limit)
    new_text = _clip_one_line(after, limit)
    if not old_text and not new_text:
        return ""
    if not old_text:
        return f"+{new_text}"
    if not new_text:
        return f"-{old_text}"
    if old_text == new_text:
        return f"±{new_text}"

    matcher = difflib.SequenceMatcher(None, old_text, new_text)
    best = ""
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        if tag in {"replace", "insert"}:
            best = new_text[max(0, j1 - 16):min(len(new_text), j2 + 64)]
            break
        if tag == "delete":
            best = old_text[max(0, i1 - 16):min(len(old_text), i2 + 64)]
            break
    if not best:
        best = new_text or old_text
    prefix = "+" if new_text else "-"
    return f"{prefix}{_clip_one_line(best, limit)}"


def build_update_by_label(actor_type: Any, actor_name: Any = "", conversation_title: Any = "") -> str:
    kind = str(actor_type or "user").strip().lower()
    name = str(actor_name or "").strip()
    title = str(conversation_title or "").strip()
    if kind in {"model", "model_tool"}:
        if name and title:
            return f"{name} - {title}"
        return name or title or "模型"
    return name or "用户"


def _normalize_entry(username: str, raw: Dict[str, Any]) -> Dict[str, Any]:
    item = raw if isinstance(raw, dict) else {}
    ts = item.get("ts", time.time())
    try:
        ts = float(ts)
    except Exception:
        ts = time.time()
    title = str(item.get("title") or "").strip()
    entry_type = str(item.get("type") or "").strip() or "misc"
    actor_type = str(item.get("actor_type") or "user").strip() or "user"
    actor_name = str(item.get("actor_name") or "").strip() or username
    meta = item.get("meta") if isinstance(item.get("meta"), dict) else {}
    action_key = str((meta or {}).get("action") or item.get("action") or "").strip().lower()
    if title and not title.startswith(("新增 ", "删除 ", "修改 ")):
        title = f"{_timeline_action_prefix(action_key)} {_timeline_subject_label(title, fallback='记录', limit=28)}"
    update_by = str(item.get("update_by") or "").strip() or build_update_by_label(
        actor_type,
        actor_name,
        item.get("conversation_title") or "",
    )
    difference = str(item.get("difference") or "").strip()
    return {
        "id": str(item.get("id") or f"tl_{int(ts * 1000)}_{os.urandom(4).hex()}").strip(),
        "ts": ts,
        "type": entry_type,
        "title": title,
        "update_by": update_by,
        "difference": difference,
        "actor_type": actor_type,
        "actor_name": actor_name,
        "conversation_id": str(item.get("conversation_id") or "").strip(),
        "conversation_title": str(item.get("conversation_title") or "").strip(),
        "kind": str(item.get("kind") or entry_type).strip(),
        "meta": meta
    }


def append_entry(username: str, entry: Dict[str, Any]) -> Dict[str, Any]:
    user = str(username or "").strip() or "unknown"
    _ensure_hot_migration(user)
    
    normalized = _normalize_entry(user, entry)
    new_path = _timeline_path(user, is_jsonl=True)
    
    lock = get_user_lock(user)
    safe_append_jsonl(new_path, normalized, lock=lock)
    return normalized


def list_entries(username: str, limit: int = 120, kind: Optional[str] = None) -> List[Dict[str, Any]]:
    user = str(username or "").strip() or "unknown"
    _ensure_hot_migration(user)
    
    new_path = _timeline_path(user, is_jsonl=True)

    try:
        lim = int(limit or 120)
    except Exception:
        lim = 120
    lim = max(1, min(lim, 5000))
    
    read_lim = lim
    if kind:
        read_lim = max(lim * 20, 5000)

    lock = get_user_lock(user)
    with lock:
        items = safe_read_jsonl_tail(new_path, limit=read_lim)

    if kind:
        k = str(kind or "").strip().lower()
        items = [item for item in items if str(item.get("kind") or item.get("type") or "").strip().lower() == k]

    return items[:lim]


def record_knowledge_change(
    username: str,
    *,
    title: str,
    before_text: Any = "",
    after_text: Any = "",
    action: str = "update",
    actor_type: str = "user",
    actor_name: str = "",
    conversation_id: str = "",
    conversation_title: str = "",
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    safe_title = str(title or "").strip()
    if not safe_title:
        return {}
    action_key = str(action or "update").strip().lower()
    diff = ""
    display_title = safe_title
    if action_key == "add":
        diff = _build_difference("", after_text)
    elif action_key == "delete":
        diff = _build_difference(before_text, "")
    elif action_key == "rename":
        old_title = str((extra or {}).get("old_title") or "").strip()
        new_title = str((extra or {}).get("new_title") or safe_title).strip()
        display_title = new_title or safe_title
        diff = f"标题：{old_title or safe_title} -> {new_title or safe_title}"
    else:
        diff = _build_difference(before_text, after_text)

    entry = {
        "type": "knowledge",
        "kind": "knowledge",
        "title": display_title,
        "difference": diff,
        "actor_type": actor_type,
        "actor_name": actor_name,
        "update_by": build_update_by_label(actor_type, actor_name, conversation_title),
        "conversation_id": conversation_id,
        "conversation_title": conversation_title,
        "meta": extra or {},
    }
    return append_entry(username, entry)


def _note_preview(note: Dict[str, Any]) -> str:
    return _clip_one_line(note.get("text") or "", 10)


def record_notes_snapshot_change(
    username: str,
    before_store: Dict[str, Any],
    after_store: Dict[str, Any],
    *,
    actor_type: str = "user",
    actor_name: str = "",
    conversation_id: str = "",
    conversation_title: str = "",
) -> List[Dict[str, Any]]:
    before = before_store if isinstance(before_store, dict) else {}
    after = after_store if isinstance(after_store, dict) else {}
    before_notes = before.get("notes", []) if isinstance(before.get("notes", []), list) else []
    after_notes = after.get("notes", []) if isinstance(after.get("notes", []), list) else []
    before_books = before.get("notebooks", []) if isinstance(before.get("notebooks", []), list) else []
    after_books = after.get("notebooks", []) if isinstance(after.get("notebooks", []), list) else []

    before_notes_map = {str(item.get("id") or ""): item for item in before_notes if isinstance(item, dict)}
    after_notes_map = {str(item.get("id") or ""): item for item in after_notes if isinstance(item, dict)}
    before_books_map = {str(item.get("id") or ""): item for item in before_books if isinstance(item, dict)}
    after_books_map = {str(item.get("id") or ""): item for item in after_books if isinstance(item, dict)}

    saved_entries: List[Dict[str, Any]] = []

    # notebooks
    for nb_id, nb in after_books_map.items():
        if nb_id not in before_books_map:
            saved_entries.append(append_entry(username, {
                "type": "notebook",
                "kind": "notebook",
                "title": str(nb.get("name") or "未命名笔记本"),
                "difference": "+" + _clip_one_line(f"笔记本：{nb.get('name') or '未命名笔记本'}"),
                "actor_type": actor_type,
                "actor_name": actor_name,
                "update_by": build_update_by_label(actor_type, actor_name, conversation_title),
                "conversation_id": conversation_id,
                "conversation_title": conversation_title,
                "meta": {"notebook_id": nb_id, "action": "add"},
            }))
        else:
            old = before_books_map.get(nb_id, {})
            old_name = str(old.get("name") or "").strip()
            new_name = str(nb.get("name") or "").strip()
            if old_name != new_name:
                saved_entries.append(append_entry(username, {
                    "type": "notebook",
                    "kind": "notebook",
                    "title": new_name or old_name or "未命名笔记本",
                    "difference": f"笔记本：{old_name or '未命名笔记本'} -> {new_name or '未命名笔记本'}",
                    "actor_type": actor_type,
                    "actor_name": actor_name,
                    "update_by": build_update_by_label(actor_type, actor_name, conversation_title),
                    "conversation_id": conversation_id,
                    "conversation_title": conversation_title,
                    "meta": {"notebook_id": nb_id, "action": "rename"},
                }))

    for nb_id, nb in before_books_map.items():
        if nb_id not in after_books_map:
            saved_entries.append(append_entry(username, {
                "type": "notebook",
                "kind": "notebook",
                "title": str(nb.get("name") or "未命名笔记本"),
                "difference": "-" + _clip_one_line(f"笔记本：{nb.get('name') or '未命名笔记本'}"),
                "actor_type": actor_type,
                "actor_name": actor_name,
                "update_by": build_update_by_label(actor_type, actor_name, conversation_title),
                "conversation_id": conversation_id,
                "conversation_title": conversation_title,
                "meta": {"notebook_id": nb_id, "action": "delete"},
            }))

    # notes
    for note_id, note in after_notes_map.items():
        if note_id not in before_notes_map:
            saved_entries.append(append_entry(username, {
                "type": "note",
                "kind": "note",
                "title": _note_preview(note) or "新笔记",
                "difference": "+" + _clip_one_line(note.get("text") or ""),
                "actor_type": actor_type,
                "actor_name": actor_name,
                "update_by": build_update_by_label(actor_type, actor_name, conversation_title),
                "conversation_id": conversation_id,
                "conversation_title": conversation_title,
                "meta": {"note_id": note_id, "action": "add"},
            }))
        else:
            old = before_notes_map.get(note_id, {})
            old_text = str(old.get("text") or "").strip()
            new_text = str(note.get("text") or "").strip()
            old_title = _note_preview(old)
            new_title = _note_preview(note)
            changed_fields = []
            if old_text != new_text:
                changed_fields.append("text")
            if str(old.get("notebookId") or "") != str(note.get("notebookId") or ""):
                changed_fields.append("notebook")
            if old_title != new_title or changed_fields:
                saved_entries.append(append_entry(username, {
                    "type": "note",
                    "kind": "note",
                    "title": new_title or old_title or "笔记",
                    "difference": _build_difference(old_text, new_text),
                    "actor_type": actor_type,
                    "actor_name": actor_name,
                    "update_by": build_update_by_label(actor_type, actor_name, conversation_title),
                    "conversation_id": conversation_id,
                    "conversation_title": conversation_title,
                    "meta": {"note_id": note_id, "action": "update"},
                }))

    for note_id, note in before_notes_map.items():
        if note_id not in after_notes_map:
            saved_entries.append(append_entry(username, {
                "type": "note",
                "kind": "note",
                "title": _note_preview(note) or "删除的笔记",
                "difference": "-" + _clip_one_line(note.get("text") or ""),
                "actor_type": actor_type,
                "actor_name": actor_name,
                "update_by": build_update_by_label(actor_type, actor_name, conversation_title),
                "conversation_id": conversation_id,
                "conversation_title": conversation_title,
                "meta": {"note_id": note_id, "action": "delete"},
            }))

    return saved_entries
