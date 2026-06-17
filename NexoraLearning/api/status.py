"""Status aggregation for NexoraLearning.

The public payload intentionally contains only service-level information.
When a request has a resolved viewer, user-specific metrics are scoped to
data/users/{viewer_id} and never scan another user's private directory.
"""

from __future__ import annotations

import csv
import json
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional


PROFILE_DONE_EVENTS = {"profile_extraction_done"}
PROFILE_QUESTION_DONE_EVENTS = {"profile_question_done"}
CONTENT_EVENT_PREFIXES = (
    "personalized_learning_path",
    "personalized_chapter",
)
SAFETY_KEYWORDS = (
    "guard",
    "reject",
    "rejected",
    "intercept",
    "unsupported",
    "disabled",
    "quality",
)


def build_status_overview(
    cfg: Mapping[str, Any],
    *,
    viewer: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    data_dir = _data_dir(cfg)
    viewer_payload = dict(viewer or {})
    user_id = str(viewer_payload.get("user_id") or "").strip()
    authenticated = bool(user_id)

    overview: Dict[str, Any] = {
        "snapshotAt": _now_iso(),
        "service": _build_service_status(cfg, data_dir),
        "public": _build_public_status(cfg, data_dir),
        "viewer": {
            "authenticated": authenticated,
            "user_id": user_id if authenticated else "",
            "role": str(viewer_payload.get("role") or "guest").strip() or "guest",
        },
        "private": None,
    }
    if authenticated:
        overview["private"] = _build_user_status(cfg, data_dir, user_id)
    return overview


def _data_dir(cfg: Mapping[str, Any]) -> Path:
    raw = str((cfg or {}).get("data_dir") or "data").strip() or "data"
    return Path(raw).resolve()


def _now_iso() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def _read_json(path: Path) -> Any:
    try:
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _read_jsonl(path: Path, *, limit: int = 0) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    rows: List[Dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except Exception:
        return []
    iterable = reversed(lines) if limit else lines
    for raw in iterable:
        line = str(raw or "").strip()
        if not line:
            continue
        try:
            item = json.loads(line)
        except Exception:
            continue
        if isinstance(item, dict):
            rows.append(item)
            if limit and len(rows) >= limit:
                break
    if limit:
        rows.reverse()
    return rows


def _count_jsonl(path: Path) -> int:
    if not path.exists():
        return 0
    try:
        return sum(1 for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
    except Exception:
        return 0


def _count_csv_rows(path: Path) -> int:
    if not path.exists():
        return 0
    try:
        with path.open("r", encoding="utf-8", newline="") as fh:
            return max(0, sum(1 for _ in fh) - 1)
    except Exception:
        return 0


def _is_within(parent: Path, child: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except Exception:
        return False


def _user_dir(data_dir: Path, user_id: str) -> Optional[Path]:
    safe_user_id = str(user_id or "").strip()
    if not safe_user_id or any(part in safe_user_id for part in ("/", "\\", "..")):
        return None
    path = data_dir / "users" / safe_user_id
    if not _is_within(data_dir / "users", path):
        return None
    return path


def _build_service_status(cfg: Mapping[str, Any], data_dir: Path) -> Dict[str, Any]:
    runtime_cfg = cfg.get("runtime_api") if isinstance(cfg.get("runtime_api"), dict) else {}
    nexora_cfg = cfg.get("nexora") if isinstance(cfg.get("nexora"), dict) else {}
    models_cfg = cfg.get("models") if isinstance(cfg.get("models"), dict) else {}
    enabled_models = []
    for key, value in models_cfg.items():
        if not isinstance(value, dict):
            continue
        if bool(value.get("enabled", True)):
            enabled_models.append(str(key))
    return {
        "name": "NexoraLearning",
        "status": "ok" if data_dir.exists() else "degraded",
        "version": "0.1.0",
        "data_dir_ready": data_dir.exists(),
        "runtime_api_enabled": bool(runtime_cfg.get("enabled", True)),
        "nexora_base_url": str(nexora_cfg.get("base_url") or "").strip(),
        "enabled_model_pipelines": enabled_models,
    }


def _build_public_status(cfg: Mapping[str, Any], data_dir: Path) -> Dict[str, Any]:
    lectures_root = data_dir / "lectures"
    logs_root = data_dir / "logs"
    lecture_count = 0
    book_count = 0
    if lectures_root.exists():
        try:
            for lecture_dir in lectures_root.iterdir():
                if not lecture_dir.is_dir():
                    continue
                if (lecture_dir / "lecture.json").exists():
                    lecture_count += 1
                books_dir = lecture_dir / "books"
                if books_dir.exists():
                    book_count += sum(1 for item in books_dir.iterdir() if item.is_dir())
        except Exception:
            pass
    latest_log = ""
    if logs_root.exists():
        try:
            latest = max(logs_root.glob("events_*.jsonl"), key=lambda p: p.stat().st_mtime, default=None)
            latest_log = latest.name if latest else ""
        except Exception:
            latest_log = ""
    return {
        "lectures": lecture_count,
        "books": book_count,
        "structured_log_files": len(list(logs_root.glob("events_*.jsonl"))) if logs_root.exists() else 0,
        "latest_log": latest_log,
    }


def _build_user_status(cfg: Mapping[str, Any], data_dir: Path, user_id: str) -> Dict[str, Any]:
    root = _user_dir(data_dir, user_id)
    if root is None:
        return {"available": False, "error": "invalid user id"}
    root.mkdir(parents=True, exist_ok=True)

    events = _iter_recent_structured_events(data_dir, max_files=80)
    user_events = [row for row in events if _event_belongs_to_user(row, user_id)]
    profile = _build_profile_status(root, user_events)
    content = _build_content_status(root, user_events)
    telemetry = _build_telemetry_status(root)
    activity = _build_activity_status(root)
    safety = _build_safety_status(user_events)
    return {
        "available": True,
        "profile": profile,
        "content_generation": content,
        "telemetry": telemetry,
        "activity": activity,
        "safety": safety,
    }


def _iter_recent_structured_events(data_dir: Path, *, max_files: int = 60) -> List[Dict[str, Any]]:
    logs_root = data_dir / "logs"
    if not logs_root.exists():
        return []
    try:
        paths = sorted(logs_root.glob("events_*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)[:max_files]
    except Exception:
        return []
    rows: List[Dict[str, Any]] = []
    for path in paths:
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except Exception:
            continue
        for raw in lines:
            line = str(raw or "").strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except Exception:
                continue
            if isinstance(item, dict):
                rows.append(item)
    return rows


def _event_type(row: Mapping[str, Any]) -> str:
    return str(row.get("event_type") or row.get("type") or "").strip()


def _event_payload(row: Mapping[str, Any]) -> Mapping[str, Any]:
    payload = row.get("payload")
    return payload if isinstance(payload, Mapping) else {}


def _event_belongs_to_user(row: Mapping[str, Any], user_id: str) -> bool:
    payload = _event_payload(row)
    candidates = {
        str(payload.get("user_id") or "").strip(),
        str(payload.get("username") or "").strip(),
        str(payload.get("actor") or "").strip(),
    }
    return str(user_id or "").strip() in candidates


def _build_profile_status(root: Path, user_events: Iterable[Mapping[str, Any]]) -> Dict[str, Any]:
    memory_path = root / "memories" / "user.md"
    content = ""
    try:
        content = memory_path.read_text(encoding="utf-8") if memory_path.exists() else ""
    except Exception:
        content = ""
    dimensions = _extract_profile_dimensions(content)
    filled = [item for item in dimensions if item.get("filled")]
    progress_count = len(_extract_timeline_entries(content, "最近进步")) + len(_extract_timeline_entries(content, "鏈€杩戣繘姝"))
    attention_count = len(_extract_timeline_entries(content, "需要注意")) + len(_extract_timeline_entries(content, "闇€瑕佹敞鎰"))
    update_count = sum(1 for row in user_events if _event_type(row) in PROFILE_DONE_EVENTS)
    question_count = sum(1 for row in user_events if _event_type(row) in PROFILE_QUESTION_DONE_EVENTS)
    updated_at = int(memory_path.stat().st_mtime) if memory_path.exists() else 0
    return {
        "filled_dimensions": len(filled),
        "total_dimensions": len(dimensions) or 8,
        "completion_rate": round((len(filled) / max(1, len(dimensions) or 8)) * 100, 1),
        "dimension_names": [str(item.get("name") or "") for item in filled],
        "update_count": update_count,
        "profile_question_count": question_count,
        "progress_entries": progress_count,
        "attention_entries": attention_count,
        "memory_chars": len(content),
        "updated_at": updated_at,
    }


def _extract_profile_dimensions(markdown: str) -> List[Dict[str, Any]]:
    text = str(markdown or "").replace("\r\n", "\n").replace("\r", "\n")
    names = [
        "专业方向",
        "知识基础",
        "认知风格",
        "兴趣方向",
        "薄弱环节",
        "学习节奏",
        "易错点",
        "学习目标",
        "涓撲笟鏂瑰悜",
        "鐭ヨ瘑鍩虹",
        "璁ょ煡椋庢牸",
        "鍏磋叮鏂瑰悜",
        "钖勫急鐜妭",
        "瀛︿範鑺傚",
        "鏄撻敊鐐",
        "瀛︿範鐩爣",
    ]
    rows: List[Dict[str, Any]] = []
    for name in names:
        marker = f"## {name}"
        start = text.find(marker)
        if start < 0:
            continue
        body_start = start + len(marker)
        next_start = text.find("\n## ", body_start)
        body = text[body_start: next_start if next_start >= 0 else len(text)].strip()
        if any(existing.get("name") == name for existing in rows):
            continue
        rows.append({"name": name, "filled": bool(body and "暂无" not in body and "鏆傛棤" not in body)})
    if rows:
        return rows
    return [{"name": f"dimension_{idx + 1}", "filled": False} for idx in range(8)]


def _extract_timeline_entries(markdown: str, heading_fragment: str) -> List[str]:
    text = str(markdown or "").replace("\r\n", "\n").replace("\r", "\n")
    pos = text.find(str(heading_fragment or ""))
    if pos < 0:
        return []
    next_pos = text.find("\n### ", pos + 1)
    if next_pos < 0:
        next_pos = text.find("\n## ", pos + 1)
    body = text[pos: next_pos if next_pos >= 0 else len(text)]
    return [line for line in body.splitlines() if line.strip().startswith("- [")]


def _build_content_status(root: Path, user_events: Iterable[Mapping[str, Any]]) -> Dict[str, Any]:
    courses_root = root / "personalized_courses"
    courses = 0
    learning_paths = 0
    chapter_files = 0
    state_counts: Dict[str, int] = {"running": 0, "done": 0, "error": 0, "idle": 0}
    recent_states: List[Dict[str, Any]] = []
    if courses_root.exists():
        try:
            for course_dir in courses_root.iterdir():
                if not course_dir.is_dir():
                    continue
                courses += 1
                if (course_dir / "learning_path.json").exists():
                    learning_paths += 1
                chapter_files += len(list(course_dir.glob("chapter_*.md")))
                for state_path in list(course_dir.glob("chapter_generation_state*.json")):
                    state = _read_json(state_path)
                    if not isinstance(state, dict):
                        continue
                    status = str(state.get("status") or "idle").strip().lower() or "idle"
                    if status not in state_counts:
                        state_counts[status] = 0
                    state_counts[status] += 1
                    recent_states.append(
                        {
                            "lecture_id": str(state.get("lecture_id") or course_dir.name),
                            "chapter_index": _safe_int(state.get("chapter_index"), -1),
                            "status": status,
                            "raw_content_chars": len(str(state.get("raw_content") or "")),
                            "updated_at": _safe_int(state.get("updated_at"), 0),
                            "error": str(state.get("error") or "")[:160],
                        }
                    )
        except Exception:
            pass
    recent_states.sort(key=lambda row: int(row.get("updated_at") or 0), reverse=True)
    event_counts: Dict[str, int] = {}
    for row in user_events:
        event_name = _event_type(row)
        if any(event_name.startswith(prefix) for prefix in CONTENT_EVENT_PREFIXES):
            event_counts[event_name] = event_counts.get(event_name, 0) + 1
    return {
        "courses": courses,
        "learning_paths": learning_paths,
        "generated_chapters": chapter_files,
        "state_counts": state_counts,
        "event_counts": event_counts,
        "recent_states": recent_states[:8],
    }


def _build_telemetry_status(root: Path) -> Dict[str, Any]:
    telemetry_root = root / "telemetry"
    streams = []
    for stream in ("reading", "annotation", "question"):
        path = telemetry_root / f"{stream}.csv"
        streams.append({"stream": stream, "rows": _count_csv_rows(path)})
    return {"streams": streams, "total_rows": sum(int(item["rows"]) for item in streams)}


def _build_activity_status(root: Path) -> Dict[str, Any]:
    notifications = _read_jsonl(root / "notifications.jsonl")
    unread = [row for row in notifications if not bool(row.get("removed"))]
    return {
        "learning_records": _count_jsonl(root / "learning.jsonl"),
        "notifications": len(notifications),
        "unread_notifications": len(unread),
        "question_completions": _count_jsonl(root / "question_completions.jsonl"),
        "question_bank_items": _count_jsonl(root / "question_bank.jsonl"),
    }


def _build_safety_status(user_events: Iterable[Mapping[str, Any]]) -> Dict[str, Any]:
    rows = []
    for row in user_events:
        event_name = _event_type(row)
        blob = " ".join(
            [
                event_name.lower(),
                str(row.get("title") or "").lower(),
                str(row.get("content") or "").lower(),
                json.dumps(_event_payload(row), ensure_ascii=False).lower(),
            ]
        )
        if not any(word in blob for word in SAFETY_KEYWORDS):
            continue
        rows.append(
            {
                "event_type": event_name,
                "timestamp": str(row.get("timestamp") or ""),
                "title": str(row.get("title") or "")[:120],
            }
        )
    rows.sort(key=lambda item: str(item.get("timestamp") or ""), reverse=True)
    return {
        "intercept_count": len(rows),
        "recent": rows[:8],
    }
