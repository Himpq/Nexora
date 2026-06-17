"""个性化学习路线与章节内容存储模块。"""

from __future__ import annotations

import json
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple

from ..runlog import log_event


CHAPTER_CONTENT_START_MARKER = "<!-- NEXORA_CONTENT_START -->"
HTML_TAG_PATTERN = re.compile(
    r"(?is)<\s*/?\s*[a-z][a-z0-9:-]*(?:\s+[^>]*)?\s*/?\s*>|"
    r"&lt;\s*/?\s*[a-z][a-z0-9:-]*(?:\s+[^&]*?)?/?\s*&gt;"
)
_GENERATION_LOCK = threading.RLock()
_CHAPTER_GENERATION_JOBS: Dict[str, "ChapterGenerationJob"] = {}


def _data_dir(cfg: Mapping[str, Any]) -> Path:
    return Path(str((cfg or {}).get("data_dir") or "data"))


def _course_dir(cfg: Mapping[str, Any], user_id: str, lecture_id: str) -> Path:
    """个性化课程目录：data/users/{user_id}/personalized_courses/{lecture_id}/"""
    return _data_dir(cfg) / "users" / user_id / "personalized_courses" / lecture_id


def _learning_path_path(cfg: Mapping[str, Any], user_id: str, lecture_id: str) -> Path:
    return _course_dir(cfg, user_id, lecture_id) / "learning_path.json"


def _pre_reading_qa_path(cfg: Mapping[str, Any], user_id: str, lecture_id: str) -> Path:
    return _course_dir(cfg, user_id, lecture_id) / "pre_reading_qa.json"


def _chapter_path(cfg: Mapping[str, Any], user_id: str, lecture_id: str, chapter_index: int) -> Path:
    return _course_dir(cfg, user_id, lecture_id) / f"chapter_{chapter_index}.md"


def _chapter_generation_state_path(
    cfg: Mapping[str, Any],
    user_id: str,
    lecture_id: str,
    chapter_index: Optional[int] = None,
) -> Path:
    course_dir = _course_dir(cfg, user_id, lecture_id)
    if chapter_index is None:
        return course_dir / "chapter_generation_state.json"
    return course_dir / f"chapter_generation_state_{int(chapter_index)}.json"


def _chapter_generation_key(user_id: str, lecture_id: str, chapter_index: int) -> str:
    return f"{str(user_id or '').strip()}::{str(lecture_id or '').strip()}::{int(chapter_index)}"


def _read_json(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_text(path: Path) -> Optional[str]:
    if not path.exists():
        return None
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return None


def _write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class ChapterGenerationJob:
    def __init__(
        self,
        cfg: Mapping[str, Any],
        *,
        user_id: str,
        lecture_id: str,
        chapter_index: int,
        worker: Callable[[Callable[[str], None]], Dict[str, Any]],
    ) -> None:
        self.cfg = dict(cfg or {})
        self.user_id = str(user_id or "").strip()
        self.lecture_id = str(lecture_id or "").strip()
        self.chapter_index = int(chapter_index)
        self.job_id = f"lpchap_{uuid.uuid4().hex[:12]}"
        self.status = "running"
        self.raw_content = ""
        self.content = ""
        self.error = ""
        self.started_at = int(time.time())
        self.updated_at = self.started_at
        self.finished_at = 0
        self._last_persist_at = 0.0
        self._worker = worker
        self._condition = threading.Condition(threading.RLock())
        self.thread = threading.Thread(
            target=self._run,
            name=f"personalized-chapter-{self.job_id}",
            daemon=True,
        )

    def start(self) -> None:
        self._persist(force=True)
        self.thread.start()

    def append_delta(self, text: str) -> None:
        piece = str(text or "")
        if not piece:
            return
        with self._condition:
            self.raw_content += piece
            self.updated_at = int(time.time())
            self._persist()
            self._condition.notify_all()

    def complete(self, result: Mapping[str, Any]) -> None:
        with self._condition:
            payload = dict(result or {})
            self.status = "done"
            self.content = str(payload.get("content") or "")
            self.updated_at = int(time.time())
            self.finished_at = self.updated_at
            self._persist(force=True)
            self._condition.notify_all()

    def fail(self, error: str) -> None:
        with self._condition:
            self.status = "error"
            self.error = str(error or "chapter generation failed")
            self.updated_at = int(time.time())
            self.finished_at = self.updated_at
            self._persist(force=True)
            self._condition.notify_all()

    def snapshot(self) -> Dict[str, Any]:
        with self._condition:
            return {
                "job_id": self.job_id,
                "user_id": self.user_id,
                "lecture_id": self.lecture_id,
                "chapter_index": self.chapter_index,
                "status": self.status,
                "raw_content": self.raw_content,
                "content": self.content,
                "error": self.error,
                "started_at": self.started_at,
                "updated_at": self.updated_at,
                "finished_at": self.finished_at,
            }

    def wait_for_change(self, raw_length: int, timeout: float = 30.0) -> Dict[str, Any]:
        deadline = time.time() + max(0.1, float(timeout or 30.0))
        with self._condition:
            while (
                len(self.raw_content) <= raw_length
                and self.status == "running"
                and time.time() < deadline
            ):
                self._condition.wait(timeout=max(0.1, deadline - time.time()))
            return self.snapshot()

    def _run(self) -> None:
        try:
            result = self._worker(self.append_delta)
            self.complete(result if isinstance(result, Mapping) else {"content": str(result or "")})
        except Exception as exc:
            self.fail(str(exc))
            log_event(
                "personalized_chapter_generation_job_error",
                str(exc),
                payload={
                    "job_id": self.job_id,
                    "user_id": self.user_id,
                    "lecture_id": self.lecture_id,
                    "chapter_index": self.chapter_index,
                },
            )

    def _persist(self, *, force: bool = False) -> None:
        now = time.time()
        if not force and now - self._last_persist_at < 1.0:
            return
        self._last_persist_at = now
        _write_json(
            _chapter_generation_state_path(self.cfg, self.user_id, self.lecture_id, self.chapter_index),
            self.snapshot(),
        )


def load_chapter_generation_state(
    cfg: Mapping[str, Any],
    user_id: str,
    lecture_id: str,
    chapter_index: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    safe_uid = str(user_id or "").strip()
    safe_lid = str(lecture_id or "").strip()
    if not safe_uid or not safe_lid:
        return None

    if chapter_index is not None:
        idx = int(chapter_index)
        key = _chapter_generation_key(safe_uid, safe_lid, idx)
        with _GENERATION_LOCK:
            job = _CHAPTER_GENERATION_JOBS.get(key)
            if job is not None:
                snapshot = job.snapshot()
                if snapshot.get("status") == "running":
                    return snapshot

        state = _read_json(_chapter_generation_state_path(cfg, safe_uid, safe_lid, idx))
        if not isinstance(state, dict):
            return None
        status = str(state.get("status") or "").strip().lower()
        if status != "running":
            return state

        # A persisted running state without an in-memory worker means the server restarted.
        state["status"] = "error"
        state["error"] = "chapter generation worker is no longer running"
        state["finished_at"] = int(time.time())
        _write_json(_chapter_generation_state_path(cfg, safe_uid, safe_lid, idx), state)
        return state

    with _GENERATION_LOCK:
        for key, job in list(_CHAPTER_GENERATION_JOBS.items()):
            if not key.startswith(f"{safe_uid}::{safe_lid}::"):
                continue
            snapshot = job.snapshot()
            if snapshot.get("status") == "running":
                return snapshot

    state = _read_json(_chapter_generation_state_path(cfg, safe_uid, safe_lid))
    if not isinstance(state, dict):
        return None
    status = str(state.get("status") or "").strip().lower()
    if status != "running":
        return state

    # A persisted running state without an in-memory worker means the server restarted.
    state["status"] = "error"
    state["error"] = "chapter generation worker is no longer running"
    state["finished_at"] = int(time.time())
    _write_json(_chapter_generation_state_path(cfg, safe_uid, safe_lid), state)
    return state


def load_all_chapter_generation_states(
    cfg: Mapping[str, Any],
    user_id: str,
    lecture_id: str,
) -> List[Dict[str, Any]]:
    safe_uid = str(user_id or "").strip()
    safe_lid = str(lecture_id or "").strip()
    if not safe_uid or not safe_lid:
        return []

    rows_by_index: Dict[int, Dict[str, Any]] = {}
    with _GENERATION_LOCK:
        for key, job in list(_CHAPTER_GENERATION_JOBS.items()):
            if not key.startswith(f"{safe_uid}::{safe_lid}::"):
                continue
            snapshot = job.snapshot()
            idx = int(snapshot.get("chapter_index") or -1)
            if idx >= 0:
                rows_by_index[idx] = snapshot

    course_dir = _course_dir(cfg, safe_uid, safe_lid)
    try:
        paths = list(course_dir.glob("chapter_generation_state_*.json"))
    except Exception:
        paths = []

    for path in paths:
        state = _read_json(path)
        if not isinstance(state, dict):
            continue
        idx = int(state.get("chapter_index") or -1)
        if idx < 0 or idx in rows_by_index:
            continue
        rows_by_index[idx] = load_chapter_generation_state(cfg, safe_uid, safe_lid, idx) or state

    legacy = load_chapter_generation_state(cfg, safe_uid, safe_lid)
    if isinstance(legacy, dict):
        idx = int(legacy.get("chapter_index") or -1)
        if idx >= 0 and idx not in rows_by_index:
            rows_by_index[idx] = legacy

    return [rows_by_index[idx] for idx in sorted(rows_by_index)]


def start_or_attach_chapter_generation(
    cfg: Mapping[str, Any],
    *,
    user_id: str,
    lecture_id: str,
    chapter_index: int,
    worker: Callable[[Callable[[str], None]], Dict[str, Any]],
) -> Tuple[ChapterGenerationJob, str]:
    safe_uid = str(user_id or "").strip()
    safe_lid = str(lecture_id or "").strip()
    idx = int(chapter_index)
    if not safe_uid or not safe_lid:
        raise ValueError("user_id and lecture_id are required")

    key = _chapter_generation_key(safe_uid, safe_lid, idx)
    with _GENERATION_LOCK:
        existing = _CHAPTER_GENERATION_JOBS.get(key)
        if existing is not None:
            snapshot = existing.snapshot()
            if snapshot.get("status") == "running":
                mode = "attached" if int(snapshot.get("chapter_index") or -1) == idx else "attached_active"
                return existing, mode
            _CHAPTER_GENERATION_JOBS.pop(key, None)

        job = ChapterGenerationJob(
            cfg,
            user_id=safe_uid,
            lecture_id=safe_lid,
            chapter_index=idx,
            worker=worker,
        )
        _CHAPTER_GENERATION_JOBS[key] = job
        job.start()
        return job, "started"


# ── 学习路线 ──────────────────────────────────────────────────────

def save_learning_path(
    cfg: Mapping[str, Any],
    user_id: str,
    lecture_id: str,
    path_data: Dict[str, Any],
) -> str:
    """保存学习路线，返回文件路径。"""
    safe_uid = str(user_id or "").strip()
    safe_lid = str(lecture_id or "").strip()
    if not safe_uid or not safe_lid:
        raise ValueError("user_id and lecture_id are required.")

    path_data["lecture_id"] = safe_lid
    path_data["updated_at"] = int(time.time())

    target = _learning_path_path(cfg, safe_uid, safe_lid)
    _write_json(target, path_data)

    log_event(
        "personalized_learning_path_saved",
        "个性化学习路线已保存",
        payload={"user_id": safe_uid, "lecture_id": safe_lid},
    )
    return str(target)


def load_learning_path(
    cfg: Mapping[str, Any],
    user_id: str,
    lecture_id: str,
) -> Optional[Dict[str, Any]]:
    """加载学习路线。"""
    safe_uid = str(user_id or "").strip()
    safe_lid = str(lecture_id or "").strip()
    if not safe_uid or not safe_lid:
        return None
    return _read_json(_learning_path_path(cfg, safe_uid, safe_lid))


def load_all_chapter_status(
    cfg: Mapping[str, Any],
    user_id: str,
    lecture_id: str,
) -> List[Dict[str, Any]]:
    """返回所有章节状态（含内容是否已生成、是否完成学习）。"""
    path_data = load_learning_path(cfg, user_id, lecture_id)
    if not path_data:
        return []

    chapters = path_data.get("chapters") if isinstance(path_data, dict) else []
    if not isinstance(chapters, list):
        return []

    result = []
    for idx, ch in enumerate(chapters):
        if not isinstance(ch, dict):
            continue
        has_content = _chapter_path(cfg, user_id, lecture_id, idx).exists()
        generation_state = load_chapter_generation_state(cfg, user_id, lecture_id, idx)
        generation_status = str((generation_state or {}).get("status") or "").strip().lower() if isinstance(generation_state, dict) else ""
        status = str(ch.get("status") or "pending").strip()
        learning_completed = status == "completed"
        result.append({
            "index": idx,
            "name": str(ch.get("name") or "").strip(),
            "book_id": str(ch.get("book_id") or "").strip(),
            "book_title": str(ch.get("book_title") or "").strip(),
            "chapter_range": str(ch.get("chapter_range") or "").strip(),
            "chapter_summary": str(ch.get("chapter_summary") or "").strip(),
            "outline_section_id": str(ch.get("outline_section_id") or "").strip(),
            "status": status,
            "priority": int(ch.get("priority") or idx + 1),
            "reason": str(ch.get("reason") or "").strip(),
            "content_generated": has_content,
            "content_generating": generation_status == "running",
            "generation_status": generation_status,
            "generation_job_id": str((generation_state or {}).get("job_id") or "") if isinstance(generation_state, dict) else "",
            "generation_raw_content_chars": len(str((generation_state or {}).get("raw_content") or "")) if isinstance(generation_state, dict) else 0,
            "learning_completed": learning_completed,
            "completed_at": int(ch.get("completed_at") or 0) if learning_completed else 0,
        })
    return result


def update_chapter_status(
    cfg: Mapping[str, Any],
    user_id: str,
    lecture_id: str,
    chapter_index: int,
    status: str,
) -> bool:
    """更新指定章节的状态。"""
    path_data = load_learning_path(cfg, user_id, lecture_id)
    if not path_data:
        return False

    chapters = path_data.get("chapters")
    if not isinstance(chapters, list) or chapter_index < 0 or chapter_index >= len(chapters):
        return False

    chapters[chapter_index]["status"] = status
    save_learning_path(cfg, user_id, lecture_id, path_data)
    return True


def mark_chapter_completed(
    cfg: Mapping[str, Any],
    user_id: str,
    lecture_id: str,
    chapter_index: int,
) -> Optional[Dict[str, Any]]:
    """将个性化学习路线中的章节标记为已完成，并推进下一章 current。"""
    path_data = load_learning_path(cfg, user_id, lecture_id)
    if not path_data:
        return None

    chapters = path_data.get("chapters")
    if not isinstance(chapters, list) or chapter_index < 0 or chapter_index >= len(chapters):
        return None

    now = int(time.time())
    target = chapters[chapter_index]
    if not isinstance(target, dict):
        return None

    target["status"] = "completed"
    target["completed_at"] = now

    next_current_index = -1
    for idx in range(chapter_index + 1, len(chapters)):
        row = chapters[idx]
        if not isinstance(row, dict):
            continue
        if str(row.get("status") or "").strip().lower() == "completed":
            continue
        next_current_index = idx
        break

    for idx, row in enumerate(chapters):
        if not isinstance(row, dict):
            continue
        status = str(row.get("status") or "").strip().lower()
        if status == "completed":
            continue
        if idx == next_current_index:
            row["status"] = "current"
        elif status == "current":
            row["status"] = "recommended"

    save_learning_path(cfg, user_id, lecture_id, path_data)
    return path_data


# ── 阅读前问答 ────────────────────────────────────────────────────

def save_pre_reading_qa(
    cfg: Mapping[str, Any],
    user_id: str,
    lecture_id: str,
    qa_data: Dict[str, Any],
) -> str:
    """保存阅读前问答。"""
    safe_uid = str(user_id or "").strip()
    safe_lid = str(lecture_id or "").strip()
    if not safe_uid or not safe_lid:
        raise ValueError("user_id and lecture_id are required.")

    qa_data["saved_at"] = int(time.time())
    target = _pre_reading_qa_path(cfg, safe_uid, safe_lid)
    _write_json(target, qa_data)
    return str(target)


def load_pre_reading_qa(
    cfg: Mapping[str, Any],
    user_id: str,
    lecture_id: str,
) -> Optional[Dict[str, Any]]:
    """加载阅读前问答。"""
    safe_uid = str(user_id or "").strip()
    safe_lid = str(lecture_id or "").strip()
    if not safe_uid or not safe_lid:
        return None
    return _read_json(_pre_reading_qa_path(cfg, safe_uid, safe_lid))


# ── 章节内容 ──────────────────────────────────────────────────────

def save_chapter_content(
    cfg: Mapping[str, Any],
    user_id: str,
    lecture_id: str,
    chapter_index: int,
    markdown: str,
) -> str:
    """保存章节 Markdown 内容，返回文件路径。"""
    safe_uid = str(user_id or "").strip()
    safe_lid = str(lecture_id or "").strip()
    if not safe_uid or not safe_lid:
        raise ValueError("user_id and lecture_id are required.")

    target = _chapter_path(cfg, safe_uid, safe_lid, chapter_index)
    _write_text(target, str(markdown or ""))

    log_event(
        "personalized_chapter_saved",
        "个性化章节内容已保存",
        payload={"user_id": safe_uid, "lecture_id": safe_lid, "chapter_index": chapter_index},
    )
    return str(target)


def load_chapter_content(
    cfg: Mapping[str, Any],
    user_id: str,
    lecture_id: str,
    chapter_index: int,
) -> Optional[str]:
    """加载章节 Markdown 内容。"""
    safe_uid = str(user_id or "").strip()
    safe_lid = str(lecture_id or "").strip()
    if not safe_uid or not safe_lid:
        return None
    return _read_text(_chapter_path(cfg, safe_uid, safe_lid, chapter_index))


def has_chapter_content(
    cfg: Mapping[str, Any],
    user_id: str,
    lecture_id: str,
    chapter_index: int,
) -> bool:
    """检查章节内容是否已生成。"""
    safe_uid = str(user_id or "").strip()
    safe_lid = str(lecture_id or "").strip()
    if not safe_uid or not safe_lid:
        return False
    return _chapter_path(cfg, safe_uid, safe_lid, chapter_index).exists()


def _safe_json_obj(raw: str) -> Dict[str, Any]:
    text = str(raw or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _parse_tool_args_obj(raw: str, tool_name: str) -> Dict[str, Any]:
    """Parse required tool-call arguments and keep malformed tool calls out of chat history."""
    text = str(raw or "").strip()

    if not text:
        raise ValueError(f"{tool_name} arguments is empty")

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        preview = text[:800]
        raise ValueError(
            f"{tool_name} arguments JSON parse failed at line {exc.lineno} column {exc.colno}: {exc.msg}; "
            f"preview={preview}"
        ) from exc

    if not isinstance(parsed, dict):
        raise ValueError(f"{tool_name} arguments must be a JSON object")

    return parsed


def _safe_json_dumps(data: Any) -> str:
    try:
        return json.dumps(data, ensure_ascii=False)
    except Exception:
        return "{}"


def _build_learning_path_tools() -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "submit_learning_path",
                "description": "Submit the personalized learning path for this course.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "advice": {
                            "type": "string",
                            "description": "2-3 sentence overall learning advice",
                        },
                        "chapters": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "index": {"type": "integer"},
                                    "name": {"type": "string"},
                                    "book_id": {"type": "string"},
                                    "book_title": {"type": "string"},
                                    "chapter_range": {"type": "string"},
                                    "chapter_summary": {"type": "string"},
                                    "outline_section_id": {"type": "string"},
                                    "priority": {"type": "integer"},
                                    "status": {
                                        "type": "string",
                                        "enum": ["completed", "current", "recommended", "pending"],
                                    },
                                    "reason": {"type": "string"},
                                },
                                "required": [
                                    "index",
                                    "name",
                                    "book_id",
                                    "book_title",
                                    "chapter_range",
                                    "chapter_summary",
                                    "outline_section_id",
                                    "priority",
                                    "status",
                                    "reason",
                                ],
                            },
                        },
                    },
                    "required": ["advice", "chapters"],
                },
            },
        },
    ]


def _normalize_learning_path_chapters(raw_chapters: Any) -> List[Dict[str, Any]]:
    chapters: List[Dict[str, Any]] = []
    if not isinstance(raw_chapters, list):
        return chapters

    for idx, item in enumerate(raw_chapters):
        if not isinstance(item, dict):
            continue

        name = str(item.get("name") or "").strip()
        book_id = str(item.get("book_id") or "").strip()
        book_title = str(item.get("book_title") or "").strip()
        chapter_range = str(item.get("chapter_range") or "").strip()
        chapter_summary = str(item.get("chapter_summary") or "").strip()
        outline_section_id = str(item.get("outline_section_id") or "").strip()
        status = str(item.get("status") or "pending").strip().lower() or "pending"
        reason = str(item.get("reason") or "").strip()

        try:
            priority = int(item.get("priority") or idx + 1)
        except Exception:
            priority = idx + 1

        if not name or not book_id or not chapter_range:
            continue

        if status not in {"completed", "current", "recommended", "pending"}:
            status = "pending"

        chapters.append(
            {
                "index": idx,
                "name": name,
                "book_id": book_id,
                "book_title": book_title,
                "chapter_range": chapter_range,
                "chapter_summary": chapter_summary,
                "outline_section_id": outline_section_id,
                "priority": max(1, priority),
                "status": status,
                "reason": reason,
            }
        )

    chapters.sort(key=lambda row: (int(row.get("priority") or 9999), int(row.get("index") or 0)))

    current_seen = False
    for idx, chapter in enumerate(chapters):
        chapter["index"] = idx
        if chapter["status"] == "current":
            if current_seen:
                chapter["status"] = "recommended"
            else:
                current_seen = True

    if chapters and not current_seen:
        chapters[0]["status"] = "current"

    return chapters


def generate_learning_path_with_tools(
    cfg: Mapping[str, Any],
    *,
    proxy: Any,
    model_name: str,
    user_id: str,
    lecture_id: str,
    system_prompt: str,
    user_prompt: str,
    full_text: str,
    request_timeout: int,
    on_delta: Optional[Callable[[str], None]] = None,
) -> Tuple[str, List[Dict[str, Any]]]:
    safe_user_id = str(user_id or "").strip()
    safe_lecture_id = str(lecture_id or "").strip()
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    tools = _build_learning_path_tools()
    tool_choice = {"type": "function", "function": {"name": "submit_learning_path"}}
    advice_text = ""
    chapters: List[Dict[str, Any]] = []

    log_event(
        "personalized_learning_path_start",
        "个性化学习路线生成开始",
        payload={
            "user_id": safe_user_id,
            "lecture_id": safe_lecture_id,
            "model_name": str(model_name or ""),
            "text_chars": len(full_text),
        },
    )

    for turn in range(1, 7):
        response = proxy.chat_completions(
            messages=messages,
            model=model_name or None,
            username=safe_user_id,
            options={
                "temperature": 0.3,
                "max_tokens": 12000,
                "stream": True,
                "tools": tools,
                "tool_choice": tool_choice,
            },
            use_chat_path=False,
            request_timeout=request_timeout,
            on_delta=on_delta,
        )

        log_event(
            "personalized_learning_path_round",
            "个性化学习路线轮次响应",
            payload={
                "user_id": safe_user_id,
                "lecture_id": safe_lecture_id,
                "turn": turn,
                "ok": bool(response.get("ok")),
            },
        )

        if not bool(response.get("ok")):
            raise RuntimeError(f"Nexora API Error: {response.get('message') or 'request failed'}")

        payload = response.get("payload") if isinstance(response.get("payload"), dict) else {}
        choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
        if not choices:
            raise RuntimeError("Model returned no choices")

        msg = choices[0].get("message") if isinstance(choices[0], dict) else {}
        assistant_content = str((msg or {}).get("content") or "")
        tool_calls = msg.get("tool_calls") if isinstance(msg, dict) and isinstance(msg.get("tool_calls"), list) else []

        log_event(
            "personalized_learning_path_model_output",
            "个性化学习路线模型输出",
            payload={
                "user_id": safe_user_id,
                "lecture_id": safe_lecture_id,
                "turn": turn,
                "tool_calls": len(tool_calls),
                "content_len": len(assistant_content),
            },
            content=assistant_content[:3000],
        )

        if not tool_calls:
            messages.append(
                {
                    "role": "assistant",
                    "content": assistant_content if assistant_content else None,
                }
            )
            messages.append(
                {
                    "role": "user",
                    "content": "The parsed course materials are already provided in the prompt. You must call submit_learning_path(advice=..., chapters=[...]) to submit the final result. Do not return plain JSON text.",
                }
            )
            continue

        sanitized_tool_calls: List[Dict[str, Any]] = []
        parsed_tool_calls: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []

        for call in tool_calls:
            if not isinstance(call, dict):
                continue

            call_id = str(call.get("id") or "")
            func = call.get("function") if isinstance(call.get("function"), dict) else {}
            tool_name = str(func.get("name") or "").strip()
            raw_arguments = str(func.get("arguments") or "")

            try:
                args_obj = _parse_tool_args_obj(raw_arguments, tool_name or "unknown_tool")
            except ValueError as exc:
                log_event(
                    "personalized_learning_path_tool_args_invalid",
                    str(exc),
                    payload={
                        "user_id": safe_user_id,
                        "lecture_id": safe_lecture_id,
                        "turn": turn,
                        "tool_name": tool_name,
                        "tool_call_id": call_id,
                        "raw_chars": len(raw_arguments),
                    },
                    content=raw_arguments[:2400],
                )
                raise RuntimeError(str(exc)) from exc

            sanitized_call = {
                "id": call_id,
                "type": "function",
                "function": {
                    "name": tool_name,
                    "arguments": _safe_json_dumps(args_obj),
                },
            }
            sanitized_tool_calls.append(sanitized_call)
            parsed_tool_calls.append((sanitized_call, args_obj))

        if not parsed_tool_calls:
            messages.append(
                {
                    "role": "assistant",
                    "content": assistant_content if assistant_content else None,
                }
            )
            messages.append(
                {
                    "role": "user",
                    "content": "You returned no usable tool call. Call submit_learning_path(advice=..., chapters=[...]) with valid arguments.",
                }
            )
            continue

        messages.append(
            {
                "role": "assistant",
                "content": assistant_content if assistant_content else None,
                "tool_calls": sanitized_tool_calls,
            }
        )

        for call, args_obj in parsed_tool_calls:
            call_id = str(call.get("id") or "")
            func = call.get("function") if isinstance(call.get("function"), dict) else {}
            tool_name = str(func.get("name") or "").strip()

            log_event(
                "personalized_learning_path_tool_call",
                "个性化学习路线工具调用",
                payload={
                    "user_id": safe_user_id,
                    "lecture_id": safe_lecture_id,
                    "turn": turn,
                    "tool_name": tool_name,
                    "tool_call_id": call_id,
                },
                content=_safe_json_dumps(args_obj)[:2400],
            )

            if tool_name == "submit_learning_path":
                advice_text = str(args_obj.get("advice") or "").strip()
                chapters = _normalize_learning_path_chapters(args_obj.get("chapters"))
                tool_result = {"ok": bool(advice_text and chapters), "chapters_count": len(chapters)}
            else:
                tool_result = {"ok": False, "error": f"unsupported tool: {tool_name}"}

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": _safe_json_dumps(tool_result),
                }
            )

            log_event(
                "personalized_learning_path_tool_result",
                "个性化学习路线工具结果",
                payload={
                    "user_id": safe_user_id,
                    "lecture_id": safe_lecture_id,
                    "turn": turn,
                    "tool_name": tool_name,
                    "ok": bool(tool_result.get("ok")),
                },
                content=_safe_json_dumps(tool_result)[:2400],
            )

            if tool_name == "submit_learning_path" and advice_text and chapters:
                log_event(
                    "personalized_learning_path_done",
                    "个性化学习路线生成完成",
                    payload={
                        "user_id": safe_user_id,
                        "lecture_id": safe_lecture_id,
                        "chapters_count": len(chapters),
                    },
                    content=advice_text[:1000],
                )
                return advice_text, chapters

    raise RuntimeError("Model failed to submit learning path via tool call")


def _extract_markdown_after_content_marker(raw_text: str) -> str:
    """提取章节 Markdown 正文，确保模型遵守流式正文起始协议。"""
    text = str(raw_text or "")
    marker_index = text.find(CHAPTER_CONTENT_START_MARKER)

    if marker_index < 0:
        raise ValueError("章节内容缺少正文起始标记 <!-- NEXORA_CONTENT_START -->")

    markdown = text[marker_index + len(CHAPTER_CONTENT_START_MARKER):].lstrip()
    if not markdown.strip():
        raise ValueError("章节正文起始标记后没有 Markdown 内容")

    if HTML_TAG_PATTERN.search(markdown):
        raise ValueError("章节正文包含 HTML 标签，请重新生成并只保留 Markdown 原文引用。")

    return markdown


def generate_chapter_markdown_with_tools(
    cfg: Mapping[str, Any],
    *,
    proxy: Any,
    model_name: str,
    user_id: str,
    lecture_id: str,
    chapter_name: str,
    system_prompt: str,
    user_prompt: str,
    full_text: str,
    request_timeout: int,
    on_delta: Optional[Callable[[str], None]] = None,
) -> str:
    """流式生成章节 Markdown；保留旧函数名以维持路由调用兼容。"""
    safe_user_id = str(user_id or "").strip()
    safe_lecture_id = str(lecture_id or "").strip()
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    log_event(
        "personalized_chapter_start",
        "个性化章节内容生成开始",
        payload={
            "user_id": safe_user_id,
            "lecture_id": safe_lecture_id,
            "chapter_name": chapter_name,
            "model_name": str(model_name or ""),
            "text_chars": len(full_text),
        },
    )

    response = proxy.chat_completions(
        messages=messages,
        model=model_name or None,
        username=safe_user_id,
        options={
            "temperature": 0.4,
            "max_tokens": 12000,
            "stream": True,
        },
        use_chat_path=False,
        request_timeout=request_timeout,
        on_delta=on_delta,
    )

    log_event(
        "personalized_chapter_response",
        "个性化章节流式响应",
        payload={
            "user_id": safe_user_id,
            "lecture_id": safe_lecture_id,
            "chapter_name": chapter_name,
            "ok": bool(response.get("ok")),
        },
    )

    if not bool(response.get("ok")):
        raise RuntimeError(f"Nexora API Error: {response.get('message') or 'request failed'}")

    payload = response.get("payload") if isinstance(response.get("payload"), dict) else {}
    choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
    if not choices:
        raise RuntimeError("Model returned no choices")

    msg = choices[0].get("message") if isinstance(choices[0], dict) else {}
    assistant_content = str((msg or {}).get("content") or "")

    log_event(
        "personalized_chapter_model_output",
        "个性化章节模型输出",
        payload={
            "user_id": safe_user_id,
            "lecture_id": safe_lecture_id,
            "chapter_name": chapter_name,
            "content_len": len(assistant_content),
        },
        content=assistant_content[:3000],
    )

    markdown_text = _extract_markdown_after_content_marker(assistant_content)

    log_event(
        "personalized_chapter_done",
        "个性化章节内容生成完成",
        payload={
            "user_id": safe_user_id,
            "lecture_id": safe_lecture_id,
            "chapter_name": chapter_name,
            "chars": len(markdown_text),
        },
    )

    return markdown_text
