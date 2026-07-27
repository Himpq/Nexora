"""个性化学习路线与章节内容存储模块。"""

from __future__ import annotations

import json
import math
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, Optional, Set, Tuple

from ..runlog import log_event


CHAPTER_CONTENT_START_MARKER = "<!-- NEXORA_CONTENT_START -->"
HTML_TAG_PATTERN = re.compile(
    r"(?is)<\s*/?\s*[a-z][a-z0-9:-]*(?:\s+[^>]*)?\s*/?\s*>|"
    r"&lt;\s*/?\s*[a-z][a-z0-9:-]*(?:\s+[^&]*?)?/?\s*&gt;"
)
HTML_BREAK_TAG_PATTERN = re.compile(r"(?is)<\s*br\s*/?\s*>|&lt;\s*br\s*/?\s*&gt;")
HTML_BLOCK_TAG_PATTERN = re.compile(
    r"(?is)<\s*/?\s*(?:p|div|section|article|header|footer|main|aside|nav|"
    r"blockquote|ul|ol|li|table|thead|tbody|tfoot|tr|h[1-6])\b[^>]*>|"
    r"&lt;\s*/?\s*(?:p|div|section|article|header|footer|main|aside|nav|"
    r"blockquote|ul|ol|li|table|thead|tbody|tfoot|tr|h[1-6])\b[^&]*?&gt;"
)
MARKDOWN_FENCE_PATTERN = re.compile(r"^\s*(```|~~~)")
NXL_LAB_FENCE_START_PATTERN = re.compile(r"^```nxl-lab[ \t]*$", re.IGNORECASE)
NXL_LAB_FENCE_END_PATTERN = re.compile(r"^```[ \t]*$")
NXL_LAB_NAME_PATTERN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
NXL_LAB_EXPRESSION_PATTERN = re.compile(r"^[0-9A-Za-z_+\-*/%^().,\s]+$")
NXL_LAB_TEMPLATE_NAME_PATTERN = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")
NXL_LAB_ALLOWED_TYPES = {
    "canvas_scene",
    "step_flow",
    "chart_experiment",
    "formula_simulation",
    "code_trace",
    "sandbox_component",
}
NXL_LAB_CHART_SERIES_TYPES = {
    "line",
    "bar",
    "pie",
    "scatter",
    "effectScatter",
    "radar",
    "tree",
    "treemap",
    "sunburst",
    "boxplot",
    "candlestick",
    "heatmap",
    "parallel",
    "lines",
    "graph",
    "sankey",
    "funnel",
    "gauge",
    "pictorialBar",
    "themeRiver",
}
NXL_LAB_CHART_SOURCE_TYPES = {"xy", "sequence", "matrix"}
NXL_LAB_CHART_FORBIDDEN_KEYS = {
    "__proto__",
    "prototype",
    "constructor",
    "renderItem",
    "js",
    "script",
    "callback",
    "event",
    "events",
    "onClick",
    "onHover",
}
NXL_LAB_CHART_MAX_OPTION_CHARS = 60000
NXL_LAB_CHART_MAX_DEPTH = 14
NXL_LAB_CHART_MAX_NODES = 2400
NXL_LAB_CHART_MAX_SOURCES = 12
NXL_LAB_CHART_MAX_POINTS = 600
NXL_LAB_CHART_MAX_MATRIX_CELLS = 1600
NXL_LAB_ALLOWED_ELEMENT_TYPES = {
    "rect",
    "circle",
    "line",
    "arrow",
    "text",
    "particle_field",
    "graph",
    "plot",
}
NXL_LAB_ALLOWED_FORMULA_KEYS = {"ideal_gas"}
NXL_LAB_PLOT_AXIS_NAME = "x"
NXL_LAB_SANDBOX_MAX_HTML_CHARS = 12000
NXL_LAB_SANDBOX_MAX_CSS_CHARS = 12000
NXL_LAB_SANDBOX_MAX_JS_CHARS = 24000
NXL_LAB_SANDBOX_MAX_TOTAL_CHARS = 36000
NXL_LAB_SANDBOX_FORBIDDEN_URL_PATTERN = re.compile(r"(?i)\b(?:https?:)?//")
NXL_LAB_SANDBOX_FORBIDDEN_HTML_PATTERN = re.compile(
    r"(?is)<\s*(?:script|iframe|object|embed|form|base|link|meta|style)\b|"
    r"\b(?:src|href|srcdoc)\s*="
)
NXL_LAB_SANDBOX_FORBIDDEN_CSS_PATTERN = re.compile(r"(?i)@import\b|url\s*\(")
NXL_LAB_SANDBOX_FORBIDDEN_JS_PATTERNS = (
    (re.compile(r"\bfetch\s*\("), "fetch"),
    (re.compile(r"\bXMLHttpRequest\b"), "XMLHttpRequest"),
    (re.compile(r"\bWebSocket\b"), "WebSocket"),
    (re.compile(r"\bEventSource\b"), "EventSource"),
    (re.compile(r"\bsendBeacon\s*\("), "sendBeacon"),
    (re.compile(r"\bimportScripts\s*\("), "importScripts"),
    (re.compile(r"\bimport\s*\("), "dynamic import"),
    (re.compile(r"\bWorker\s*\("), "Worker"),
    (re.compile(r"\bSharedWorker\s*\("), "SharedWorker"),
    (re.compile(r"\bServiceWorker\b"), "ServiceWorker"),
    (re.compile(r"\blocalStorage\b"), "localStorage"),
    (re.compile(r"\bsessionStorage\b"), "sessionStorage"),
    (re.compile(r"\bindexedDB\b"), "indexedDB"),
    (re.compile(r"\bdocument\s*\.\s*cookie\b"), "document.cookie"),
    (re.compile(r"\b(?:window\s*\.\s*)?parent\b"), "parent"),
    (re.compile(r"\b(?:window\s*\.\s*)?top\b"), "top"),
    (re.compile(r"\b(?:window\s*\.\s*)?opener\b"), "opener"),
    (re.compile(r"\b(?:window\s*\.\s*)?location\b"), "location"),
    (re.compile(r"\beval\s*\("), "eval"),
    (re.compile(r"\bFunction\s*\("), "Function"),
)
NXL_LAB_MATH_NAMES = {
    "abs",
    "sqrt",
    "sin",
    "cos",
    "tan",
    "exp",
    "log",
    "min",
    "max",
    "floor",
    "ceil",
    "round",
    "pi",
    "clamp",
}
NXL_LAB_SCENE_NAMES = {"t", "W", "H"}
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

    _canonicalize_learning_path_data_sources(path_data)

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

    target = _learning_path_path(cfg, safe_uid, safe_lid)
    path_data = _read_json(target)
    if not isinstance(path_data, dict):
        return None

    changed = _canonicalize_learning_path_data_sources(path_data)
    if changed:
        _write_json(target, path_data)
        log_event(
            "personalized_learning_path_source_repaired",
            "个性化学习路线来源已按教材目录修正",
            payload={"user_id": safe_uid, "lecture_id": safe_lid},
        )

    return path_data


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

def _extract_nxl_lab_blocks(markdown: str) -> List[Tuple[int, str]]:
    """提取正文中的 nxl-lab 配置块，并检查代码围栏是否完整闭合。"""
    lines = str(markdown or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: List[Tuple[int, str]] = []
    index = 0

    while index < len(lines):
        line = lines[index].strip()

        if not NXL_LAB_FENCE_START_PATTERN.match(line):
            index += 1
            continue

        start_line = index + 1
        index += 1
        block_lines: List[str] = []

        while index < len(lines):

            if NXL_LAB_FENCE_END_PATTERN.match(lines[index].strip()):
                break

            block_lines.append(lines[index])
            index += 1

        if index >= len(lines):
            raise ValueError(f"第 {start_line} 行的 nxl-lab 代码块没有闭合。")

        blocks.append((start_line, "\n".join(block_lines)))
        index += 1

    return blocks


def _validate_nxl_lab_no_html(value: Any, path: str) -> None:
    if isinstance(value, str) and HTML_TAG_PATTERN.search(value):
        raise ValueError(f"{path} 包含 HTML 标签，nxl-lab 只允许结构化 JSON 配置。")

    if isinstance(value, list):

        for idx, item in enumerate(value):
            _validate_nxl_lab_no_html(item, f"{path}[{idx}]")

        return

    if isinstance(value, dict):

        for key, item in value.items():
            _validate_nxl_lab_no_html(item, f"{path}.{key}")


def _require_nxl_lab_object(value: Any, path: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{path} 必须是 JSON object。")

    return value


def _require_nxl_lab_array(value: Any, path: str) -> List[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{path} 必须是 JSON array。")

    return value


def _validate_nxl_lab_text(value: Any, path: str, *, required: bool = False) -> str:
    if value is None:

        if required:
            raise ValueError(f"{path} 不能为空。")

        return ""

    if not isinstance(value, str):
        raise ValueError(f"{path} 必须是字符串。")

    text = value.strip()

    if required and not text:
        raise ValueError(f"{path} 不能为空。")

    return text


def _validate_nxl_lab_template_text(value: Any, path: str, *, required: bool = False) -> str:
    """校验只支持 {{parameter}} 插值的画布文本字段。"""
    text = _validate_nxl_lab_text(value, path, required=required)

    if text.startswith("="):
        raise ValueError(
            f"{path} 不支持表达式。流程条件、步骤状态和动态说明请改用 step_flow。"
        )

    return text


def _validate_nxl_lab_literal_text(value: Any, path: str, *, required: bool = False) -> str:
    """校验画布颜色和类型等必须保持静态的字符串字段。"""
    text = _validate_nxl_lab_template_text(value, path, required=required)

    if NXL_LAB_TEMPLATE_NAME_PATTERN.search(text):
        raise ValueError(f"{path} 不支持动态模板，请使用固定值。")

    return text


def _validate_nxl_lab_limited_text(
    value: Any,
    path: str,
    *,
    required: bool,
    max_chars: int,
) -> str:
    text = _validate_nxl_lab_text(value, path, required=required)

    if len(text) > max_chars:
        raise ValueError(f"{path} 超过长度限制：最多 {max_chars} 字符。")

    return text


def _validate_nxl_lab_number(value: Any, path: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ValueError(f"{path} 必须是有效数字。")

    return float(value)


def _validate_nxl_lab_expression(expression: str, path: str, allowed_names: Set[str]) -> None:
    source = str(expression or "").strip()

    if not source:
        raise ValueError(f"{path} 表达式不能为空。")

    if not NXL_LAB_EXPRESSION_PATTERN.match(source):
        raise ValueError(f"{path} 表达式包含未允许的字符。")

    names = set(NXL_LAB_NAME_PATTERN.findall(source))
    unknown_names = sorted(name for name in names if name not in allowed_names)

    if unknown_names:
        raise ValueError(f"{path} 表达式使用了未注册变量：{', '.join(unknown_names)}。")


def _nxl_lab_expression_names(expression: str) -> Set[str]:
    return set(NXL_LAB_NAME_PATTERN.findall(str(expression or "")))


def _collect_nxl_lab_dynamic_names(value: Any) -> Set[str]:
    """收集场景表达式和文本模板实际引用的动态变量。"""
    names: Set[str] = set()

    if isinstance(value, str):
        text = value.strip()

        if text.startswith("="):
            names.update(_nxl_lab_expression_names(text[1:]))

        names.update(NXL_LAB_TEMPLATE_NAME_PATTERN.findall(text))
        return names

    if isinstance(value, list):

        for item in value:
            names.update(_collect_nxl_lab_dynamic_names(item))

        return names

    if isinstance(value, dict):

        for item in value.values():
            names.update(_collect_nxl_lab_dynamic_names(item))

    return names


def _validate_nxl_lab_number_or_expression(value: Any, path: str, allowed_names: Set[str]) -> None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        _validate_nxl_lab_number(value, path)
        return

    if isinstance(value, str) and value.strip().startswith("="):
        _validate_nxl_lab_expression(value.strip()[1:], path, allowed_names)
        return

    raise ValueError(f"{path} 必须是数字，或以 = 开头的安全表达式。")


def _validate_nxl_lab_number_fields(
    data: Mapping[str, Any],
    fields: List[str],
    path: str,
    allowed_names: Set[str],
    *,
    required: bool,
) -> None:
    for field in fields:

        if field not in data:

            if required:
                raise ValueError(f"{path}.{field} 不能为空。")

            continue

        _validate_nxl_lab_number_or_expression(data[field], f"{path}.{field}", allowed_names)


def _validate_nxl_lab_parameters(value: Any, path: str, *, required: bool) -> Set[str]:
    if value is None:

        if required:
            raise ValueError(f"{path} 不能为空。")

        return set()

    parameters = _require_nxl_lab_array(value, path)

    if required and not parameters:
        raise ValueError(f"{path} 至少需要 1 个参数。")

    keys: Set[str] = set()

    for idx, raw_param in enumerate(parameters):
        item_path = f"{path}[{idx}]"
        param = _require_nxl_lab_object(raw_param, item_path)
        key = _validate_nxl_lab_text(param.get("key"), f"{item_path}.key", required=True)

        if not NXL_LAB_NAME_PATTERN.fullmatch(key):
            raise ValueError(f"{item_path}.key 必须是可用于表达式的变量名。")

        if key in keys:
            raise ValueError(f"{item_path}.key 重复：{key}。")

        keys.add(key)
        _validate_nxl_lab_text(param.get("label"), f"{item_path}.label", required=True)

        if "unit" not in param:
            raise ValueError(f"{item_path}.unit 必须提供，可为空字符串。")

        _validate_nxl_lab_text(param.get("unit"), f"{item_path}.unit")

        minimum = _validate_nxl_lab_number(param.get("min"), f"{item_path}.min")
        maximum = _validate_nxl_lab_number(param.get("max"), f"{item_path}.max")
        step = _validate_nxl_lab_number(param.get("step"), f"{item_path}.step")
        value_number = _validate_nxl_lab_number(param.get("value"), f"{item_path}.value")

        if maximum < minimum:
            raise ValueError(f"{item_path}.max 不能小于 min。")

        if step <= 0:
            raise ValueError(f"{item_path}.step 必须大于 0。")

        if value_number < minimum or value_number > maximum:
            raise ValueError(f"{item_path}.value 必须位于 min 与 max 之间。")

    return keys


def _validate_nxl_lab_formula(config: Mapping[str, Any], path: str) -> None:
    _validate_nxl_lab_text(config.get("formula"), f"{path}.formula", required=True)
    _validate_nxl_lab_text(config.get("result_unit"), f"{path}.result_unit")

    formula_key = _validate_nxl_lab_text(config.get("formula_key"), f"{path}.formula_key", required=True)

    if formula_key not in NXL_LAB_ALLOWED_FORMULA_KEYS:
        raise ValueError(f"{path}.formula_key 未注册：{formula_key}。")

    parameter_keys = _validate_nxl_lab_parameters(config.get("parameters"), f"{path}.parameters", required=True)
    required_keys = {"n", "T", "V"}
    missing_keys = sorted(required_keys - parameter_keys)

    if missing_keys:
        raise ValueError(f"{path}.parameters 缺少理想气体实验参数：{', '.join(missing_keys)}。")


def _validate_nxl_lab_graph(element: Mapping[str, Any], path: str, allowed_names: Set[str]) -> None:
    nodes = _require_nxl_lab_array(element.get("nodes"), f"{path}.nodes")
    edges = _require_nxl_lab_array(element.get("edges"), f"{path}.edges")

    if not nodes:
        raise ValueError(f"{path}.nodes 至少需要 1 个节点。")

    if not edges:
        raise ValueError(f"{path}.edges 至少需要 1 条连接。")

    node_ids: Set[str] = set()

    for idx, raw_node in enumerate(nodes):
        node_path = f"{path}.nodes[{idx}]"
        node = _require_nxl_lab_object(raw_node, node_path)
        node_id = _validate_nxl_lab_text(node.get("id"), f"{node_path}.id", required=True)

        if node_id in node_ids:
            raise ValueError(f"{node_path}.id 重复：{node_id}。")

        node_ids.add(node_id)
        _validate_nxl_lab_template_text(node.get("label"), f"{node_path}.label", required=True)
        _validate_nxl_lab_literal_text(node.get("shape"), f"{node_path}.shape")
        _validate_nxl_lab_literal_text(node.get("fill"), f"{node_path}.fill")
        _validate_nxl_lab_literal_text(node.get("stroke"), f"{node_path}.stroke")
        _validate_nxl_lab_literal_text(node.get("text_color"), f"{node_path}.text_color")
        _validate_nxl_lab_number_fields(
            node,
            ["x", "y"],
            node_path,
            allowed_names,
            required=True,
        )
        _validate_nxl_lab_number_fields(
            node,
            ["radius", "width", "height", "line_width", "size"],
            node_path,
            allowed_names,
            required=False,
        )

    for idx, raw_edge in enumerate(edges):
        edge_path = f"{path}.edges[{idx}]"
        edge = _require_nxl_lab_object(raw_edge, edge_path)
        from_id = _validate_nxl_lab_text(edge.get("from"), f"{edge_path}.from", required=True)
        to_id = _validate_nxl_lab_text(edge.get("to"), f"{edge_path}.to", required=True)

        if from_id not in node_ids:
            raise ValueError(f"{edge_path}.from 未引用已声明节点：{from_id}。")

        if to_id not in node_ids:
            raise ValueError(f"{edge_path}.to 未引用已声明节点：{to_id}。")

        _validate_nxl_lab_literal_text(edge.get("color"), f"{edge_path}.color")
        _validate_nxl_lab_template_text(edge.get("label"), f"{edge_path}.label")
        _validate_nxl_lab_number_fields(
            edge,
            ["line_width", "head_size"],
            edge_path,
            allowed_names,
            required=False,
        )


def _validate_nxl_lab_plot(element: Mapping[str, Any], path: str, allowed_names: Set[str]) -> None:
    _validate_nxl_lab_number_fields(
        element,
        ["x", "y", "width", "height", "x_min", "x_max", "y_min", "y_max"],
        path,
        allowed_names,
        required=True,
    )
    _validate_nxl_lab_number_fields(
        element,
        ["samples", "line_width"],
        path,
        allowed_names,
        required=False,
    )
    _validate_nxl_lab_template_text(element.get("label"), f"{path}.label")

    curves = _require_nxl_lab_array(element.get("curves"), f"{path}.curves")

    if not curves:
        raise ValueError(f"{path}.curves 至少需要 1 条曲线。")

    plot_names = set(allowed_names)
    plot_names.add(NXL_LAB_PLOT_AXIS_NAME)
    has_axis_curve = False

    for idx, raw_curve in enumerate(curves):
        curve_path = f"{path}.curves[{idx}]"
        curve = _require_nxl_lab_object(raw_curve, curve_path)
        expression = _validate_nxl_lab_text(curve.get("expression"), f"{curve_path}.expression", required=True)
        _validate_nxl_lab_expression(expression, f"{curve_path}.expression", plot_names)

        if NXL_LAB_PLOT_AXIS_NAME in _nxl_lab_expression_names(expression):
            has_axis_curve = True

        _validate_nxl_lab_literal_text(curve.get("color"), f"{curve_path}.color")
        _validate_nxl_lab_number_fields(
            curve,
            ["line_width"],
            curve_path,
            allowed_names,
            required=False,
        )

    if not has_axis_curve:
        raise ValueError(f"{path}.curves 至少需要 1 条曲线表达式使用 x 作为横轴变量。")


def _validate_nxl_lab_canvas_element(element: Mapping[str, Any], path: str, allowed_names: Set[str]) -> None:
    element_type = _validate_nxl_lab_text(element.get("type"), f"{path}.type", required=True)

    if element_type not in NXL_LAB_ALLOWED_ELEMENT_TYPES:
        raise ValueError(f"{path}.type 未注册：{element_type}。")

    _validate_nxl_lab_literal_text(element.get("fill"), f"{path}.fill")
    _validate_nxl_lab_literal_text(element.get("stroke"), f"{path}.stroke")
    _validate_nxl_lab_literal_text(element.get("color"), f"{path}.color")

    if element_type == "rect":
        _validate_nxl_lab_number_fields(
            element,
            ["x", "y", "width", "height"],
            path,
            allowed_names,
            required=True,
        )
        _validate_nxl_lab_number_fields(element, ["line_width"], path, allowed_names, required=False)
        return

    if element_type == "circle":
        _validate_nxl_lab_number_fields(
            element,
            ["x", "y", "radius"],
            path,
            allowed_names,
            required=True,
        )
        _validate_nxl_lab_number_fields(element, ["line_width"], path, allowed_names, required=False)
        return

    if element_type in {"line", "arrow"}:
        _validate_nxl_lab_number_fields(
            element,
            ["x1", "y1", "x2", "y2"],
            path,
            allowed_names,
            required=True,
        )
        _validate_nxl_lab_number_fields(
            element,
            ["line_width", "head_size"],
            path,
            allowed_names,
            required=False,
        )
        return

    if element_type == "text":
        _validate_nxl_lab_template_text(element.get("text"), f"{path}.text", required=True)
        _validate_nxl_lab_number_fields(
            element,
            ["x", "y"],
            path,
            allowed_names,
            required=True,
        )
        _validate_nxl_lab_number_fields(element, ["size"], path, allowed_names, required=False)
        return

    if element_type == "particle_field":
        bounds = _require_nxl_lab_object(element.get("bounds"), f"{path}.bounds")
        _validate_nxl_lab_number_fields(
            bounds,
            ["x", "y", "width", "height"],
            f"{path}.bounds",
            allowed_names,
            required=True,
        )
        _validate_nxl_lab_number_fields(
            element,
            ["count", "speed", "radius"],
            path,
            allowed_names,
            required=True,
        )
        return

    if element_type == "graph":
        _validate_nxl_lab_graph(element, path, allowed_names)
        return

    if element_type == "plot":
        _validate_nxl_lab_plot(element, path, allowed_names)


def _validate_nxl_lab_canvas_scene(config: Mapping[str, Any], path: str) -> None:
    parameter_names = _validate_nxl_lab_parameters(config.get("parameters"), f"{path}.parameters", required=False)
    allowed_names = set(parameter_names) | NXL_LAB_SCENE_NAMES | NXL_LAB_MATH_NAMES
    _validate_nxl_lab_template_text(config.get("result_template"), f"{path}.result_template")
    scene = _require_nxl_lab_object(config.get("scene"), f"{path}.scene")
    _validate_nxl_lab_literal_text(scene.get("background"), f"{path}.scene.background")
    _validate_nxl_lab_number_fields(
        scene,
        ["width", "height"],
        f"{path}.scene",
        allowed_names,
        required=True,
    )

    elements = _require_nxl_lab_array(scene.get("elements"), f"{path}.scene.elements")

    if not elements:
        raise ValueError(f"{path}.scene.elements 至少需要 1 个图元。")

    for idx, raw_element in enumerate(elements):
        element_path = f"{path}.scene.elements[{idx}]"
        element = _require_nxl_lab_object(raw_element, element_path)
        _validate_nxl_lab_canvas_element(element, element_path, allowed_names)

    referenced_names = _collect_nxl_lab_dynamic_names(scene)
    unused_parameters = sorted(parameter_names - referenced_names)

    if unused_parameters:
        raise ValueError(
            f"{path}.parameters 未实际驱动画布：{', '.join(unused_parameters)}。"
            "请在场景数值表达式或文本模板中使用这些参数。"
        )


def _validate_nxl_lab_code_trace(config: Mapping[str, Any], path: str) -> None:
    code_lines = _require_nxl_lab_array(config.get("code"), f"{path}.code")
    steps = _require_nxl_lab_array(config.get("steps"), f"{path}.steps")

    if not code_lines:
        raise ValueError(f"{path}.code 至少需要 1 行代码。")

    if not steps:
        raise ValueError(f"{path}.steps 至少需要 1 个执行步骤。")

    for idx, code_line in enumerate(code_lines):
        _validate_nxl_lab_text(code_line, f"{path}.code[{idx}]", required=True)

    for idx, raw_step in enumerate(steps):
        step_path = f"{path}.steps[{idx}]"
        step = _require_nxl_lab_object(raw_step, step_path)
        line_index = step.get("line_index")

        if isinstance(line_index, bool) or not isinstance(line_index, int):
            raise ValueError(f"{step_path}.line_index 必须是整数。")

        if line_index < 0 or line_index >= len(code_lines):
            raise ValueError(f"{step_path}.line_index 超出 code 行范围。")

        variables = step.get("variables")

        if variables is not None:
            _require_nxl_lab_object(variables, f"{step_path}.variables")

        _validate_nxl_lab_text(step.get("output"), f"{step_path}.output")


def _validate_nxl_lab_step_flow(config: Mapping[str, Any], path: str) -> None:
    """校验语义化流程实验，避免模型用坐标图冒充可交互流程。"""
    parameter_keys = _validate_nxl_lab_parameters(config.get("parameters"), f"{path}.parameters", required=True)
    active_parameter = _validate_nxl_lab_text(
        config.get("active_parameter"),
        f"{path}.active_parameter",
        required=True,
    )

    if active_parameter not in parameter_keys:
        raise ValueError(f"{path}.active_parameter 未引用已注册参数：{active_parameter}。")

    _validate_nxl_lab_text(config.get("result_template"), f"{path}.result_template")
    steps = _require_nxl_lab_array(config.get("steps"), f"{path}.steps")

    if len(steps) < 2 or len(steps) > 8:
        raise ValueError(f"{path}.steps 数量必须位于 2 到 8 之间。")

    step_ids: Set[str] = set()

    for idx, raw_step in enumerate(steps):
        step_path = f"{path}.steps[{idx}]"
        step = _require_nxl_lab_object(raw_step, step_path)
        step_id = _validate_nxl_lab_text(step.get("id"), f"{step_path}.id", required=True)

        if step_id in step_ids:
            raise ValueError(f"{step_path}.id 重复：{step_id}。")

        step_ids.add(step_id)
        _validate_nxl_lab_text(step.get("title"), f"{step_path}.title", required=True)
        _validate_nxl_lab_text(step.get("summary"), f"{step_path}.summary", required=True)
        _validate_nxl_lab_text(step.get("detail"), f"{step_path}.detail", required=True)
        _validate_nxl_lab_text(step.get("tag"), f"{step_path}.tag")


def _validate_nxl_lab_chart_expression(value: Any, path: str, allowed_names: Set[str]) -> Set[str]:
    """校验图表数据源表达式，并返回实际引用的变量名。"""
    expression = _validate_nxl_lab_text(value, path, required=True)

    if not expression.startswith("="):
        raise ValueError(f"{path} 必须是以 = 开头的安全表达式。")

    source = expression[1:].strip()
    _validate_nxl_lab_expression(source, path, allowed_names)

    return _nxl_lab_expression_names(source)


def _validate_nxl_lab_chart_positive_integer(value: Any, path: str, maximum: int) -> int:
    number = _validate_nxl_lab_number(value, path)

    if not number.is_integer() or number < 1 or number > maximum:
        raise ValueError(f"{path} 必须是 1 到 {maximum} 之间的整数。")

    return int(number)


def _validate_nxl_lab_chart_source(
    source: Mapping[str, Any],
    path: str,
    parameter_names: Set[str],
) -> Tuple[str, Set[str]]:
    """校验通用图表数据源，并返回数据源 ID 与实际引用的参数。"""
    source_id = _validate_nxl_lab_text(source.get("id"), f"{path}.id", required=True)

    if not NXL_LAB_NAME_PATTERN.fullmatch(source_id):
        raise ValueError(f"{path}.id 必须是合法变量名。")

    source_type = _validate_nxl_lab_text(source.get("type"), f"{path}.type", required=True)

    if source_type not in NXL_LAB_CHART_SOURCE_TYPES:
        raise ValueError(f"{path}.type 未注册：{source_type}。")

    fields_by_type = {
        "xy": {"id", "type", "x_min", "x_max", "step", "y"},
        "sequence": {"id", "type", "count", "value"},
        "matrix": {"id", "type", "rows", "columns", "value"},
    }
    extra_fields = sorted(set(source.keys()) - fields_by_type[source_type])

    if extra_fields:
        raise ValueError(f"{path} 包含未定义字段：{', '.join(extra_fields)}。")

    allowed_names = set(parameter_names) | NXL_LAB_MATH_NAMES
    referenced_names: Set[str] = set()

    if source_type == "xy":
        x_min = _validate_nxl_lab_number(source.get("x_min"), f"{path}.x_min")
        x_max = _validate_nxl_lab_number(source.get("x_max"), f"{path}.x_max")
        step = _validate_nxl_lab_number(source.get("step"), f"{path}.step")

        if x_max <= x_min:
            raise ValueError(f"{path}.x_max 必须大于 x_min。")

        if step <= 0:
            raise ValueError(f"{path}.step 必须大于 0。")

        point_count = math.floor((x_max - x_min) / step) + 1

        if point_count > NXL_LAB_CHART_MAX_POINTS:
            raise ValueError(f"{path} 生成点数超过 {NXL_LAB_CHART_MAX_POINTS}。")

        expression_names = _validate_nxl_lab_chart_expression(
            source.get("y"),
            f"{path}.y",
            allowed_names | {"x", "i"},
        )
        referenced_names.update(expression_names & parameter_names)

    if source_type == "sequence":
        _validate_nxl_lab_chart_positive_integer(
            source.get("count"),
            f"{path}.count",
            NXL_LAB_CHART_MAX_POINTS,
        )
        expression_names = _validate_nxl_lab_chart_expression(
            source.get("value"),
            f"{path}.value",
            allowed_names | {"i"},
        )
        referenced_names.update(expression_names & parameter_names)

    if source_type == "matrix":
        rows = _validate_nxl_lab_chart_positive_integer(source.get("rows"), f"{path}.rows", 64)
        columns = _validate_nxl_lab_chart_positive_integer(source.get("columns"), f"{path}.columns", 64)

        if rows * columns > NXL_LAB_CHART_MAX_MATRIX_CELLS:
            raise ValueError(f"{path} 生成单元格数量超过 {NXL_LAB_CHART_MAX_MATRIX_CELLS}。")

        expression_names = _validate_nxl_lab_chart_expression(
            source.get("value"),
            f"{path}.value",
            allowed_names | {"i", "j"},
        )
        referenced_names.update(expression_names & parameter_names)

    return source_id, referenced_names


def _validate_nxl_lab_chart_option_value(
    value: Any,
    path: str,
    allowed_names: Set[str],
    source_ids: Set[str],
    referenced_sources: Set[str],
    referenced_parameters: Set[str],
    counter: List[int],
    depth: int = 0,
) -> None:
    """递归校验纯 JSON ECharts option，禁止回调、脚本和外部资源。"""
    if depth > NXL_LAB_CHART_MAX_DEPTH:
        raise ValueError(f"{path} 嵌套深度超过 {NXL_LAB_CHART_MAX_DEPTH}。")

    counter[0] += 1

    if counter[0] > NXL_LAB_CHART_MAX_NODES:
        raise ValueError(f"{path} JSON 节点数量超过 {NXL_LAB_CHART_MAX_NODES}。")

    if value is None or isinstance(value, bool):
        return

    if isinstance(value, (int, float)):
        _validate_nxl_lab_number(value, path)
        return

    if isinstance(value, str):
        text = value.strip()

        if re.search(r"(?i)(?:https?:)?//|\bjavascript\s*:|\bimage\s*://|<\s*script\b", text):
            raise ValueError(f"{path} 不能引用外部资源或脚本。")

        if text.startswith("="):
            _validate_nxl_lab_expression(text[1:].strip(), path, allowed_names)
            referenced_parameters.update(_nxl_lab_expression_names(text[1:]) & allowed_names)

        template_names = set(NXL_LAB_TEMPLATE_NAME_PATTERN.findall(text))
        unknown_names = sorted(template_names - allowed_names)

        if unknown_names:
            raise ValueError(f"{path} 使用了未注册模板变量：{', '.join(unknown_names)}。")

        referenced_parameters.update(template_names & allowed_names)
        return

    if isinstance(value, list):

        for idx, item in enumerate(value):
            _validate_nxl_lab_chart_option_value(
                item,
                f"{path}[{idx}]",
                allowed_names,
                source_ids,
                referenced_sources,
                referenced_parameters,
                counter,
                depth + 1,
            )

        return

    if not isinstance(value, dict):
        raise ValueError(f"{path} 必须是合法 JSON 值。")

    if "$source" in value:

        if set(value.keys()) != {"$source"}:
            raise ValueError(f"{path} 的 $source 引用不能包含其他字段。")

        source_id = _validate_nxl_lab_text(value.get("$source"), f"{path}.$source", required=True)

        if source_id not in source_ids:
            raise ValueError(f"{path} 引用了未声明数据源：{source_id}。")

        referenced_sources.add(source_id)
        return

    forbidden_lookup = {key.lower() for key in NXL_LAB_CHART_FORBIDDEN_KEYS}
    forbidden_keys = sorted(str(key) for key in value if str(key).lower() in forbidden_lookup)

    if forbidden_keys:
        raise ValueError(f"{path} 包含不允许的回调或脚本字段：{', '.join(forbidden_keys)}。")

    for key, item in value.items():
        key_text = str(key)

        if not key_text:
            raise ValueError(f"{path} 不能包含空字段名。")

        _validate_nxl_lab_chart_option_value(
            item,
            f"{path}.{key_text}",
            allowed_names,
            source_ids,
            referenced_sources,
            referenced_parameters,
            counter,
            depth + 1,
        )


def _validate_nxl_lab_chart_prediction(config: Mapping[str, Any], path: str) -> None:
    prediction_fields = {"prediction_prompt", "prediction_options", "correct_prediction"}

    if not any(field in config for field in prediction_fields):
        return

    _validate_nxl_lab_text(config.get("prediction_prompt"), f"{path}.prediction_prompt", required=True)
    correct_prediction = _validate_nxl_lab_text(
        config.get("correct_prediction"),
        f"{path}.correct_prediction",
        required=True,
    )
    prediction_options = _require_nxl_lab_array(config.get("prediction_options"), f"{path}.prediction_options")

    if len(prediction_options) < 2 or len(prediction_options) > 4:
        raise ValueError(f"{path}.prediction_options 数量必须位于 2 到 4 之间。")

    prediction_ids: Set[str] = set()

    for idx, raw_option in enumerate(prediction_options):
        option_path = f"{path}.prediction_options[{idx}]"
        option = _require_nxl_lab_object(raw_option, option_path)
        option_id = _validate_nxl_lab_text(option.get("id"), f"{option_path}.id", required=True)

        if option_id in prediction_ids:
            raise ValueError(f"{option_path}.id 重复：{option_id}。")

        prediction_ids.add(option_id)
        _validate_nxl_lab_text(option.get("label"), f"{option_path}.label", required=True)

    if correct_prediction not in prediction_ids:
        raise ValueError(f"{path}.correct_prediction 必须引用 prediction_options 中的 id。")


def _validate_nxl_lab_chart_experiment(config: Mapping[str, Any], path: str) -> None:
    """校验通用纯 JSON ECharts 组件及其安全数据生成规则。"""
    allowed_fields = {
        "type",
        "title",
        "description",
        "height",
        "parameters",
        "data_sources",
        "option",
        "conclusion",
        "prediction_prompt",
        "prediction_options",
        "correct_prediction",
    }
    extra_fields = sorted(set(config.keys()) - allowed_fields)

    if extra_fields:
        raise ValueError(f"{path} 包含通用图表未定义字段：{', '.join(extra_fields)}。")

    parameter_names = _validate_nxl_lab_parameters(
        config.get("parameters"),
        f"{path}.parameters",
        required=False,
    )
    _validate_nxl_lab_text(config.get("conclusion"), f"{path}.conclusion", required=True)
    _validate_nxl_lab_chart_prediction(config, path)

    if "height" in config:
        height = _validate_nxl_lab_number(config.get("height"), f"{path}.height")

        if height < 320 or height > 720:
            raise ValueError(f"{path}.height 必须位于 320 到 720 之间。")

    raw_sources = config.get("data_sources")
    source_rows = [] if raw_sources is None else _require_nxl_lab_array(raw_sources, f"{path}.data_sources")

    if len(source_rows) > NXL_LAB_CHART_MAX_SOURCES:
        raise ValueError(f"{path}.data_sources 数量不能超过 {NXL_LAB_CHART_MAX_SOURCES}。")

    source_ids: Set[str] = set()
    referenced_parameters: Set[str] = set()

    for idx, raw_source in enumerate(source_rows):
        source_path = f"{path}.data_sources[{idx}]"
        source = _require_nxl_lab_object(raw_source, source_path)
        source_id, source_parameters = _validate_nxl_lab_chart_source(source, source_path, parameter_names)

        if source_id in source_ids:
            raise ValueError(f"{source_path}.id 重复：{source_id}。")

        source_ids.add(source_id)
        referenced_parameters.update(source_parameters)

    option = _require_nxl_lab_object(config.get("option"), f"{path}.option")
    option_chars = len(json.dumps(option, ensure_ascii=False, separators=(",", ":")))

    if option_chars > NXL_LAB_CHART_MAX_OPTION_CHARS:
        raise ValueError(f"{path}.option 超过长度限制：最多 {NXL_LAB_CHART_MAX_OPTION_CHARS} 字符。")

    series = _require_nxl_lab_array(option.get("series"), f"{path}.option.series")

    if not series or len(series) > 12:
        raise ValueError(f"{path}.option.series 数量必须位于 1 到 12 之间。")

    for idx, raw_series in enumerate(series):
        series_path = f"{path}.option.series[{idx}]"
        series_item = _require_nxl_lab_object(raw_series, series_path)
        series_type = _validate_nxl_lab_text(series_item.get("type"), f"{series_path}.type", required=True)

        if series_type not in NXL_LAB_CHART_SERIES_TYPES:
            raise ValueError(f"{series_path}.type 未注册：{series_type}。")

    referenced_sources: Set[str] = set()
    option_parameters: Set[str] = set()
    _validate_nxl_lab_chart_option_value(
        option,
        f"{path}.option",
        parameter_names | NXL_LAB_MATH_NAMES | {"W", "H"},
        source_ids,
        referenced_sources,
        option_parameters,
        [0],
    )
    referenced_parameters.update(option_parameters & parameter_names)

    unused_sources = sorted(source_ids - referenced_sources)

    if unused_sources:
        raise ValueError(f"{path}.data_sources 未被 option 引用：{', '.join(unused_sources)}。")

    unused_parameters = sorted(parameter_names - referenced_parameters)

    if unused_parameters:
        raise ValueError(
            f"{path}.parameters 未实际驱动图表：{', '.join(unused_parameters)}。"
            "请在 option 表达式、文本模板或 data_sources 表达式中使用这些参数。"
        )


def _validate_nxl_lab_sandbox_component(config: Mapping[str, Any], path: str) -> None:
    _validate_nxl_lab_parameters(config.get("parameters"), f"{path}.parameters", required=False)
    component = _require_nxl_lab_object(config.get("component"), f"{path}.component")
    html = _validate_nxl_lab_limited_text(
        component.get("html"),
        f"{path}.component.html",
        required=True,
        max_chars=NXL_LAB_SANDBOX_MAX_HTML_CHARS,
    )
    css = _validate_nxl_lab_limited_text(
        component.get("css"),
        f"{path}.component.css",
        required=False,
        max_chars=NXL_LAB_SANDBOX_MAX_CSS_CHARS,
    )
    js = _validate_nxl_lab_limited_text(
        component.get("js"),
        f"{path}.component.js",
        required=True,
        max_chars=NXL_LAB_SANDBOX_MAX_JS_CHARS,
    )
    total_chars = len(html) + len(css) + len(js)

    if total_chars > NXL_LAB_SANDBOX_MAX_TOTAL_CHARS:
        raise ValueError(f"{path}.component 超过总长度限制：最多 {NXL_LAB_SANDBOX_MAX_TOTAL_CHARS} 字符。")

    for field_name, source in (("html", html), ("css", css), ("js", js)):

        if NXL_LAB_SANDBOX_FORBIDDEN_URL_PATTERN.search(source):
            raise ValueError(f"{path}.component.{field_name} 不能引用外部 URL。")

    if NXL_LAB_SANDBOX_FORBIDDEN_HTML_PATTERN.search(html):
        raise ValueError(f"{path}.component.html 不能包含脚本、框架、表单、外链资源或内嵌样式标签。")

    if NXL_LAB_SANDBOX_FORBIDDEN_CSS_PATTERN.search(css):
        raise ValueError(f"{path}.component.css 不能使用 @import 或 url()。")

    for pattern, label in NXL_LAB_SANDBOX_FORBIDDEN_JS_PATTERNS:

        if pattern.search(js):
            raise ValueError(f"{path}.component.js 不能使用 {label}。")


def _validate_nxl_lab_config(config: Mapping[str, Any], path: str) -> None:
    lab_type = _validate_nxl_lab_text(config.get("type"), f"{path}.type", required=True)

    if lab_type not in NXL_LAB_ALLOWED_TYPES:
        raise ValueError(f"{path}.type 未注册：{lab_type}。")

    _validate_nxl_lab_text(config.get("title"), f"{path}.title", required=True)
    _validate_nxl_lab_text(config.get("description"), f"{path}.description")

    if lab_type != "sandbox_component":
        _validate_nxl_lab_no_html(config, path)

    if lab_type == "formula_simulation":
        _validate_nxl_lab_formula(config, path)
        return

    if lab_type == "canvas_scene":
        _validate_nxl_lab_canvas_scene(config, path)
        return

    if lab_type == "step_flow":
        _validate_nxl_lab_step_flow(config, path)
        return

    if lab_type == "chart_experiment":
        _validate_nxl_lab_chart_experiment(config, path)
        return

    if lab_type == "code_trace":
        _validate_nxl_lab_code_trace(config, path)
        return

    if lab_type == "sandbox_component":
        _validate_nxl_lab_sandbox_component(config, path)


def validate_nxl_lab_blocks(markdown: str) -> int:
    """校验 Markdown 中所有 nxl-lab 实验配置，返回实验块数量。"""
    blocks = _extract_nxl_lab_blocks(markdown)

    for block_index, (line_number, raw_config) in enumerate(blocks, start=1):
        block_path = f"nxl-lab[{block_index}]"

        try:
            parsed = json.loads(raw_config)
        except json.JSONDecodeError as exc:
            raise ValueError(f"第 {line_number} 行的 nxl-lab JSON 无法解析：{exc.msg}。") from exc

        config = _require_nxl_lab_object(parsed, block_path)
        _validate_nxl_lab_config(config, block_path)

    return len(blocks)


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

    raw_markdown = str(markdown or "")
    markdown_text = _normalize_chapter_markdown_html(raw_markdown)

    if markdown_text != raw_markdown:
        log_event(
            "personalized_chapter_html_normalized",
            "个性化章节正文中的 HTML 排版标签已规范化",
            payload={"user_id": safe_uid, "lecture_id": safe_lid, "chapter_index": chapter_index},
        )

    try:
        lab_count = validate_nxl_lab_blocks(markdown_text)
    except ValueError as exc:
        log_event(
            "personalized_chapter_lab_validation_error",
            "个性化章节互动实验配置校验失败",
            payload={"user_id": safe_uid, "lecture_id": safe_lid, "chapter_index": chapter_index},
            content=str(exc),
        )
        raise

    target = _chapter_path(cfg, safe_uid, safe_lid, chapter_index)
    _write_text(target, markdown_text)

    log_event(
        "personalized_chapter_saved",
        "个性化章节内容已保存",
        payload={
            "user_id": safe_uid,
            "lecture_id": safe_lid,
            "chapter_index": chapter_index,
            "lab_count": lab_count,
        },
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
                                    "source_id": {
                                        "type": "string",
                                        "description": "Exact source_id from the provided catalog",
                                    },
                                    "outline_section_id": {"type": "string"},
                                    "priority": {"type": "integer"},
                                    "status": {
                                        "type": "string",
                                        "enum": ["completed", "current", "recommended", "pending"],
                                    },
                                    "reason": {"type": "string"},
                                },
                                "required": [
                                    "source_id",
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


def _normalize_catalog_source_text(value: Any) -> str:
    """归一化目录匹配文本，防止模型输出中的空白差异影响来源校验。"""
    return re.sub(r"\s+", "", str(value or "").strip()).lower()


def _build_catalog_source_candidates(catalog_rows: Any) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]], set]:
    """构建教材目录索引，用于把模型输出校正为真实教材来源。"""
    by_source_id: Dict[str, Dict[str, Any]] = {}
    by_name: Dict[str, Dict[str, Any]] = {}
    by_range: Dict[str, Dict[str, Any]] = {}
    by_range_length: Dict[str, Dict[str, Any]] = {}
    valid_book_ids = set()

    if not isinstance(catalog_rows, list):
        return by_source_id, by_name, by_range, by_range_length, valid_book_ids

    duplicate_names = set()
    duplicate_ranges = set()
    duplicate_lengths = set()

    for row in catalog_rows:
        if not isinstance(row, dict):
            continue

        book_id = str(row.get("book_id") or "").strip()
        chapter_name = str(row.get("chapter_name") or "").strip()
        chapter_range = str(row.get("chapter_range") or "").strip()
        if not book_id or not chapter_name or not chapter_range:
            continue

        valid_book_ids.add(book_id)

        source_id = str(row.get("source_id") or "").strip()
        if source_id:
            by_source_id[source_id] = row

        name_key = _normalize_catalog_source_text(chapter_name)
        if name_key in by_name:
            duplicate_names.add(name_key)
        else:
            by_name[name_key] = row

        if chapter_range in by_range:
            duplicate_ranges.add(chapter_range)
        else:
            by_range[chapter_range] = row

        _, sep, range_length = chapter_range.partition(":")
        if sep and range_length:
            if range_length in by_range_length:
                duplicate_lengths.add(range_length)
            else:
                by_range_length[range_length] = row

    for key in duplicate_names:
        by_name.pop(key, None)
    for key in duplicate_ranges:
        by_range.pop(key, None)
    for key in duplicate_lengths:
        by_range_length.pop(key, None)

    return by_source_id, by_name, by_range, by_range_length, valid_book_ids


def _canonicalize_learning_path_source(
    item: Mapping[str, Any],
    catalog_index: Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]], set],
) -> Dict[str, str]:
    """按真实目录修正学习路线来源，避免模型抄错 book_id 或章节范围。"""
    by_source_id, by_name, by_range, by_range_length, valid_book_ids = catalog_index
    source_id = str(item.get("source_id") or "").strip()
    name = str(item.get("name") or "").strip()
    book_id = str(item.get("book_id") or "").strip()
    book_title = str(item.get("book_title") or "").strip()
    chapter_range = str(item.get("chapter_range") or "").strip()

    catalog_row: Optional[Mapping[str, Any]] = None
    name_key = _normalize_catalog_source_text(name)
    if source_id and source_id in by_source_id:
        catalog_row = by_source_id[source_id]
    elif name_key and name_key in by_name:
        catalog_row = by_name[name_key]
    elif chapter_range in by_range:
        catalog_row = by_range[chapter_range]
    elif len(valid_book_ids) == 1:
        _, sep, range_length = chapter_range.partition(":")
        if sep and range_length and range_length in by_range_length:
            catalog_row = by_range_length[range_length]

    if catalog_row is not None:
        return {
            "source_id": str(catalog_row.get("source_id") or source_id).strip(),
            "name": str(catalog_row.get("chapter_name") or name).strip(),
            "book_id": str(catalog_row.get("book_id") or "").strip(),
            "book_title": str(catalog_row.get("book_title") or book_title).strip(),
            "chapter_range": str(catalog_row.get("chapter_range") or "").strip(),
            "chapter_summary": str(catalog_row.get("chapter_summary") or "").strip(),
        }

    if valid_book_ids and book_id not in valid_book_ids:
        book_id = ""

    return {
        "source_id": source_id,
        "name": name,
        "book_id": book_id,
        "book_title": book_title,
        "chapter_range": chapter_range,
        "chapter_summary": str(item.get("chapter_summary") or "").strip(),
    }


def _canonicalize_learning_path_data_sources(path_data: Dict[str, Any]) -> bool:
    """修正已保存学习路线中的教材来源字段，保留用户学习状态。"""
    if not isinstance(path_data, dict):
        return False

    chapters = path_data.get("chapters")
    catalog_rows = path_data.get("catalog")
    if not isinstance(chapters, list) or not isinstance(catalog_rows, list):
        return False

    catalog_index = _build_catalog_source_candidates(catalog_rows)
    changed = False

    for chapter in chapters:
        if not isinstance(chapter, dict):
            continue

        source = _canonicalize_learning_path_source(chapter, catalog_index)
        if not source["book_id"] or not source["chapter_range"]:
            continue

        for key in ("source_id", "name", "book_id", "book_title", "chapter_range", "chapter_summary"):
            if str(chapter.get(key) or "").strip() == source[key]:
                continue

            chapter[key] = source[key]
            changed = True

    return changed


def _normalize_learning_path_chapters(raw_chapters: Any, catalog_rows: Any = None) -> List[Dict[str, Any]]:
    chapters: List[Dict[str, Any]] = []
    if not isinstance(raw_chapters, list):
        return chapters

    catalog_index = _build_catalog_source_candidates(catalog_rows)

    for idx, item in enumerate(raw_chapters):
        if not isinstance(item, dict):
            continue

        source = _canonicalize_learning_path_source(item, catalog_index)
        source_id = source["source_id"]
        name = source["name"]
        book_id = source["book_id"]
        book_title = source["book_title"]
        chapter_range = source["chapter_range"]
        chapter_summary = source["chapter_summary"]
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
                "source_id": source_id,
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
    catalog_rows: Any = None,
    on_delta: Optional[Callable[[str], None]] = None,
    on_status: Optional[Callable[[str], None]] = None,
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

    def emit_status(message: str) -> None:
        text = str(message or "").strip()

        if text and callable(on_status):
            on_status(text)

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
        emit_status(f"模型第 {turn} 轮正在规划学习路线")
        log_event(
            "personalized_learning_path_round_start",
            "个性化学习路线轮次开始",
            payload={
                "user_id": safe_user_id,
                "lecture_id": safe_lecture_id,
                "turn": turn,
                "messages_count": len(messages),
            },
        )
        reasoning_started = False
        reasoning_chars = 0

        def on_reasoning_delta(delta_text: str) -> None:
            nonlocal reasoning_chars, reasoning_started

            piece = str(delta_text or "")
            if not piece:
                return

            reasoning_chars += len(piece)

            if not reasoning_started:
                reasoning_started = True
                emit_status("模型正在分析课程结构、阅读前回答和学习偏好")
                log_event(
                    "personalized_learning_path_reasoning_start",
                    "个性化学习路线模型开始推理",
                    payload={
                        "user_id": safe_user_id,
                        "lecture_id": safe_lecture_id,
                        "turn": turn,
                    },
                )

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
            on_reasoning_delta=on_reasoning_delta,
        )

        log_event(
            "personalized_learning_path_round",
            "个性化学习路线轮次响应",
            payload={
                "user_id": safe_user_id,
                "lecture_id": safe_lecture_id,
                "turn": turn,
                "ok": bool(response.get("ok")),
                "reasoning_chars": reasoning_chars,
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
        stream_debug = payload.get("_stream_debug") if isinstance(payload.get("_stream_debug"), dict) else {}

        log_event(
            "personalized_learning_path_model_output",
            "个性化学习路线模型输出",
            payload={
                "user_id": safe_user_id,
                "lecture_id": safe_lecture_id,
                "turn": turn,
                "tool_calls": len(tool_calls),
                "content_len": len(assistant_content),
                "stream_debug": stream_debug,
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
                emit_status("模型已提交学习路线，正在校验章节来源和学习顺序")
                advice_text = str(args_obj.get("advice") or "").strip()
                chapters = _normalize_learning_path_chapters(args_obj.get("chapters"), catalog_rows)
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


def _normalize_chapter_markdown_html(markdown: str) -> str:
    """清理正文排版标签，同时完整保留代码围栏和 nxl-lab 配置。"""
    lines = str(markdown or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    normalized_lines: List[str] = []
    active_fence = ""

    for line in lines:
        fence_match = MARKDOWN_FENCE_PATTERN.match(line)

        if fence_match:
            fence_token = fence_match.group(1)

            if not active_fence:
                active_fence = fence_token
            elif line.strip().startswith(active_fence):
                active_fence = ""

            normalized_lines.append(line)
            continue

        if active_fence:
            normalized_lines.append(line)
            continue

        normalized_line = HTML_BREAK_TAG_PATTERN.sub("\n", line)
        normalized_line = HTML_BLOCK_TAG_PATTERN.sub("\n", normalized_line)
        normalized_line = HTML_TAG_PATTERN.sub("", normalized_line)
        normalized_lines.extend(normalized_line.split("\n"))

    return "\n".join(normalized_lines)


def _extract_markdown_after_content_marker(raw_text: str) -> str:
    """提取章节 Markdown 正文，确保模型遵守流式正文起始协议。"""
    text = str(raw_text or "")
    marker_index = text.find(CHAPTER_CONTENT_START_MARKER)

    if marker_index < 0:
        raise ValueError("章节内容缺少正文起始标记 <!-- NEXORA_CONTENT_START -->")

    markdown = text[marker_index + len(CHAPTER_CONTENT_START_MARKER):].lstrip()
    if not markdown.strip():
        raise ValueError("章节正文起始标记后没有 Markdown 内容")

    normalized_markdown = _normalize_chapter_markdown_html(markdown)

    if normalized_markdown != markdown:
        log_event(
            "personalized_chapter_markdown_normalized",
            "个性化章节 Markdown 排版标签已规范化",
            payload={"raw_chars": len(markdown), "normalized_chars": len(normalized_markdown)},
        )

    return normalized_markdown


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
    """流式生成章节 Markdown，并在返回前完成实验配置校验与纠错。"""
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

    max_attempts = 3

    for attempt in range(1, max_attempts + 1):
        response = proxy.chat_completions(
            messages=messages,
            model=model_name or None,
            username=safe_user_id,
            options={
                "temperature": 0.4 if attempt == 1 else 0.2,
                "max_tokens": 12000,
                "stream": attempt == 1,
            },
            use_chat_path=False,
            request_timeout=request_timeout,
            on_delta=on_delta if attempt == 1 else None,
        )

        log_event(
            "personalized_chapter_response",
            "个性化章节模型响应",
            payload={
                "user_id": safe_user_id,
                "lecture_id": safe_lecture_id,
                "chapter_name": chapter_name,
                "attempt": attempt,
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
                "attempt": attempt,
                "content_len": len(assistant_content),
            },
            content=assistant_content[:3000],
        )

        try:
            markdown_text = _extract_markdown_after_content_marker(assistant_content)
            lab_count = validate_nxl_lab_blocks(markdown_text)
        except ValueError as exc:
            validation_error = str(exc)
            log_event(
                "personalized_chapter_validation_retry",
                "个性化章节生成结果校验失败，要求模型纠正",
                payload={
                    "user_id": safe_user_id,
                    "lecture_id": safe_lecture_id,
                    "chapter_name": chapter_name,
                    "attempt": attempt,
                    "max_attempts": max_attempts,
                },
                content=validation_error,
            )

            if attempt >= max_attempts:
                raise

            messages.extend(
                [
                    {"role": "assistant", "content": assistant_content},
                    {
                        "role": "user",
                        "content": (
                            "你生成的章节未通过保存前校验，请修正后重新输出完整文章。\n"
                            f"校验错误：{validation_error}\n"
                            "第一行仍必须是 <!-- NEXORA_CONTENT_START -->。\n"
                            "不要删除正文，只修正导致错误的部分。\n"
                            "nxl-lab 数值表达式只允许算术和已注册数学函数，禁止比较、逻辑运算和 ?: 条件表达式。\n"
                            "canvas_scene 的每个滑块参数必须实际出现在画布表达式或 {{参数名}} 文本模板中；"
                            "chart_experiment 必须提供纯 JSON option，动态数据通过 data_sources 生成并由 $source 引用。"
                        ),
                    },
                ]
            )
            continue

        log_event(
            "personalized_chapter_validated",
            "个性化章节内容已通过保存前校验",
            payload={
                "user_id": safe_user_id,
                "lecture_id": safe_lecture_id,
                "chapter_name": chapter_name,
                "attempt": attempt,
                "chars": len(markdown_text),
                "lab_count": lab_count,
            },
        )

        return markdown_text

    raise RuntimeError("章节内容生成未产生可保存结果")
