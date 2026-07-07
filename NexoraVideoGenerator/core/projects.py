"""Project storage for NexoraVideoGenerator."""

from __future__ import annotations

import json
import mimetypes
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

_LOCK = threading.RLock()


def projects_root(cfg: Mapping[str, Any]) -> Path:
    data_dir = Path(str((cfg or {}).get("data_dir") or "data"))
    root = data_dir / "projects"
    root.mkdir(parents=True, exist_ok=True)
    return root


def project_dir(cfg: Mapping[str, Any], project_id: str) -> Path:
    safe_id = _safe_project_id(project_id)
    if not safe_id:
        raise ValueError("project_id is required")
    return projects_root(cfg) / safe_id


def create_project(cfg: Mapping[str, Any], payload: Mapping[str, Any]) -> Dict[str, Any]:
    now = int(time.time())
    project_id = f"video_{uuid.uuid4().hex[:12]}"
    root = project_dir(cfg, project_id)
    for rel in ("source/imgs", "source/canvas", "source/audio", "source/slides", "exports"):
        (root / rel).mkdir(parents=True, exist_ok=True)

    title = str((payload or {}).get("title") or "未命名视频项目").strip() or "未命名视频项目"
    project = {
        "id": project_id,
        "title": title,
        "status": "created",
        "created_by": str((payload or {}).get("created_by") or "").strip(),
        "created_at": now,
        "updated_at": now,
        "stages": {
            "outline": "pending",
            "script": "pending",
            "storyboard": "pending",
            "images": "pending",
            "vision_description": "pending",
            "canvas": "pending",
            "slides": "pending",
            "audio": "pending",
            "clips": "pending",
            "timeline": "pending",
            "export": "pending",
        },
        "providers": {
            "llm": "nexora",
            "image": "nexora",
            "tts": "windows_sapi",
            "renderer": "remotion",
        },
        "options": dict((payload or {}).get("options") if isinstance((payload or {}).get("options"), dict) else {}),
        "logs": [],
    }
    _append_log_to_project(project, "created", "项目已创建")
    write_json(root / "project.json", project)
    write_json(root / "source" / "context.json", {
        "context": (payload or {}).get("context") if isinstance((payload or {}).get("context"), dict) else {},
        "extra_prompts": (payload or {}).get("extra_prompts") if isinstance((payload or {}).get("extra_prompts"), dict) else {},
        "tools": (payload or {}).get("tools") if isinstance((payload or {}).get("tools"), list) else [],
        "tool_results": (payload or {}).get("tool_results") if isinstance((payload or {}).get("tool_results"), list) else [],
    })
    return project


def get_project(cfg: Mapping[str, Any], project_id: str) -> Optional[Dict[str, Any]]:
    path = project_dir(cfg, project_id) / "project.json"
    if not path.exists():
        return None
    return read_json(path)


def list_projects(cfg: Mapping[str, Any], limit: int = 50) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for path in sorted(projects_root(cfg).glob("video_*/project.json"), reverse=True):
        try:
            item = read_json(path)
        except Exception:
            continue
        if isinstance(item, dict):
            rows.append(item)
        if len(rows) >= max(1, int(limit or 50)):
            break
    return rows


def list_project_files(cfg: Mapping[str, Any], project_id: str) -> List[Dict[str, Any]]:
    """List project files with project-relative paths for preview links."""
    root = project_dir(cfg, project_id)

    if not root.is_dir():
        raise ValueError("project not found")

    rows: List[Dict[str, Any]] = []

    for path in sorted(root.rglob("*")):

        if not path.is_file():
            continue

        relative_path = path.relative_to(root).as_posix()
        stat = path.stat()
        mime_type = mimetypes.guess_type(path.name)[0] or ""
        suffix = path.suffix.lower()
        rows.append({
            "name": path.name,
            "relative_path": relative_path,
            "area": _file_area(relative_path),
            "kind": _file_kind(suffix, mime_type),
            "mime_type": mime_type,
            "size": stat.st_size,
            "updated_at": int(stat.st_mtime),
        })

    return rows


def load_source_context(cfg: Mapping[str, Any], project_id: str) -> Dict[str, Any]:
    path = project_dir(cfg, project_id) / "source" / "context.json"
    if not path.exists():
        return {"context": {}, "extra_prompts": {}, "tools": [], "tool_results": []}
    data = read_json(path)
    return data if isinstance(data, dict) else {"context": {}, "extra_prompts": {}, "tools": [], "tool_results": []}


def update_project(cfg: Mapping[str, Any], project_id: str, updates: Mapping[str, Any]) -> Dict[str, Any]:
    root = project_dir(cfg, project_id)
    project = read_json(root / "project.json")
    if not isinstance(project, dict):
        raise ValueError("project not found")

    project.update(dict(updates or {}))
    project["updated_at"] = int(time.time())
    write_json(root / "project.json", project)
    return project


def update_stage(cfg: Mapping[str, Any], project_id: str, stage: str, status: str, message: str = "") -> Dict[str, Any]:
    root = project_dir(cfg, project_id)
    project = read_json(root / "project.json")
    if not isinstance(project, dict):
        raise ValueError("project not found")

    stages = project.get("stages") if isinstance(project.get("stages"), dict) else {}
    stages[str(stage or "").strip()] = str(status or "").strip() or "pending"
    project["stages"] = stages
    project["status"] = f"{stage}_{status}".strip("_")
    project["updated_at"] = int(time.time())
    if message:
        _append_log_to_project(project, stage, message)
    write_json(root / "project.json", project)
    return project


def append_log(cfg: Mapping[str, Any], project_id: str, event_type: str, message: str) -> None:
    root = project_dir(cfg, project_id)
    path = root / "project.json"
    if not path.exists():
        return
    project = read_json(path)
    if not isinstance(project, dict):
        return
    _append_log_to_project(project, event_type, message)
    project["updated_at"] = int(time.time())
    write_json(path, project)


def save_artifact(cfg: Mapping[str, Any], project_id: str, name: str, data: Any) -> Path:
    path = project_dir(cfg, project_id) / name
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json(path, data)
    return path


def load_artifact(cfg: Mapping[str, Any], project_id: str, name: str) -> Any:
    return read_json(project_dir(cfg, project_id) / name)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=4), encoding="utf-8")


def _append_log_to_project(project: Dict[str, Any], event_type: str, message: str) -> None:
    rows = project.get("logs") if isinstance(project.get("logs"), list) else []
    rows.append({
        "time": int(time.time()),
        "type": str(event_type or "").strip() or "event",
        "message": str(message or "").strip(),
    })
    project["logs"] = rows[-100:]


def _safe_project_id(project_id: str) -> str:
    text = str(project_id or "").strip()
    return re.sub(r"[^a-zA-Z0-9_.-]", "", text)[:80]


def _file_area(relative_path: str) -> str:
    text = str(relative_path or "").strip()

    if text.startswith("exports/"):
        return "exports"

    if text.startswith("source/"):
        return "source"

    return "project"


def _file_kind(suffix: str, mime_type: str) -> str:
    if suffix == ".json":
        return "json"

    if mime_type.startswith("image/"):
        return "image"

    if mime_type.startswith("audio/"):
        return "audio"

    if mime_type.startswith("video/"):
        return "video"

    if suffix in {".srt", ".txt", ".js", ".html", ".css", ".md"} or mime_type.startswith("text/"):
        return "text"

    return "file"
