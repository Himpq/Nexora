"""无图谱课程兜底：选课后自动补建 outline → mindmap，并给认知层一个「图谱状态」探针。

- `graph_status(cfg, lecture_id)`：ready / stale / building / missing。
  stale = mindmap 依据的大纲比现在的 outline.json 旧（2026-09-19 故障：07-29 的图谱按编号错配到 09-03 大纲的书）。
- `ensure_course_graph(cfg, lecture_id, *, user_id)`：缺文件就起 daemon 线程依次跑 outline、mindmap；
  stale 只重建 mindmap。同一课程同时只跑一个；生成失败只记事件，带 10 分钟冷却。
"""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, Mapping, Optional

from core.runlog import log_event

_LOCK = threading.Lock()
_BUILDING: set[str] = set()
_LAST_FAILURE: Dict[str, float] = {}
FAILURE_COOLDOWN_SECONDS = 600.0


def _solidified(cfg: Mapping[str, Any], lecture_id: str) -> Path:
    return Path(str(cfg.get("data_dir") or "data")) / "lectures" / lecture_id / "solidified"


def _load_outline(cfg: Mapping[str, Any], lecture_id: str) -> Optional[Dict[str, Any]]:
    from core.booksproc.outline import load_outline

    try:
        data = load_outline(cfg, lecture_id)
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _load_mindmap(cfg: Mapping[str, Any], lecture_id: str) -> Optional[Dict[str, Any]]:
    from core.booksproc.mindmap import load_mindmap

    try:
        data = load_mindmap(cfg, lecture_id)
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _mtime(path: Path) -> float:
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0.0


def mindmap_is_stale(cfg: Mapping[str, Any], lecture_id: str,
                     outline: Optional[Mapping[str, Any]] = None,
                     mindmap: Optional[Mapping[str, Any]] = None) -> bool:
    """mindmap 依据的大纲版本落后于当前 outline，或 section 集合对不上。"""
    outline = outline if outline is not None else _load_outline(cfg, lecture_id)
    mindmap = mindmap if mindmap is not None else _load_mindmap(cfg, lecture_id)
    if outline is None or mindmap is None:
        return False
    outline_at = int(outline.get("generated_at") or 0)
    based_on = int(mindmap.get("outline_generated_at") or 0)
    if based_on:
        if based_on < outline_at:
            return True
    else:
        folder = _solidified(cfg, lecture_id)
        if _mtime(folder / "mindmap.json") + 1 < _mtime(folder / "outline.json"):
            return True
    outline_ids = {str(s.get("id") or "").strip() for s in outline.get("sections") or [] if isinstance(s, Mapping)}
    nodes = mindmap.get("nodes")
    if isinstance(nodes, list):
        chapter_ids = {str(n.get("id") or "").strip() for n in nodes if isinstance(n, Mapping) and str(n.get("type") or "") == "chapter"}
    else:
        chapter_ids = {str(c.get("section_id") or "").strip() for c in mindmap.get("chapters") or [] if isinstance(c, Mapping)}
    return bool(outline_ids) and chapter_ids != outline_ids


def is_building(lecture_id: str) -> bool:
    with _LOCK:
        return str(lecture_id or "") in _BUILDING


def rebind_evidence_for_lecture(cfg: Mapping[str, Any], lecture_id: str) -> Dict[str, Any]:
    """图谱重建后 concept_id 全变：把选了这门课的每个用户的答题记录重新绑定到新概念。失败只记事件。"""
    from core import user as user_store
    from core.cognition.review_bridge import rebind_review_evidence

    results: Dict[str, Any] = {}
    try:
        users = user_store.list_users(dict(cfg)) or []
    except Exception:
        users = []
    for row in users:
        if not isinstance(row, Mapping):
            continue
        username = str(row.get("id") or row.get("username") or "").strip()
        if not username:
            continue
        try:
            if lecture_id not in set(user_store.list_selected_lecture_ids(dict(cfg), username) or []):
                continue
            results[username] = rebind_review_evidence(cfg, username, lecture_id=lecture_id)
        except Exception as exc:  # noqa: BLE001
            results[username] = {"error": str(exc)[:200]}
            log_event("review_evidence_rebind_failed", "图谱重建后重新绑定答题证据失败",
                      payload={"user_id": username, "lecture_id": lecture_id, "error": str(exc)[:200]})
    return results


def graph_status(cfg: Mapping[str, Any], lecture_id: str) -> str:
    lid = str(lecture_id or "").strip()
    if not lid:
        return "missing"
    if is_building(lid):
        return "building"
    outline = _load_outline(cfg, lid)
    mindmap = _load_mindmap(cfg, lid)
    if outline is not None and mindmap is not None:
        return "stale" if mindmap_is_stale(cfg, lid, outline, mindmap) else "ready"
    return "missing"


def reset_state() -> None:
    """测试用。"""
    with _LOCK:
        _BUILDING.clear()
        _LAST_FAILURE.clear()


def ensure_course_graph(cfg: Mapping[str, Any], lecture_id: str, *, user_id: str = "", sync: bool = False,
                        force: bool = False) -> str:
    """返回调用后的状态；ready 直接返回，缺或过期则安排构建（返回 building）。force=True 两步都重跑。"""
    lid = str(lecture_id or "").strip()
    if not lid:
        return "missing"
    status = graph_status(cfg, lid)
    if status == "ready" and not force:
        return "ready"
    if status == "building":
        return "building"
    now = time.time()
    with _LOCK:
        if lid in _BUILDING:
            return "building"
        if not force and now - _LAST_FAILURE.get(lid, 0.0) < FAILURE_COOLDOWN_SECONDS:
            return status
        _BUILDING.add(lid)
    need_outline = force or _load_outline(cfg, lid) is None
    need_mindmap = force or need_outline or _load_mindmap(cfg, lid) is None or status == "stale"

    def run() -> None:
        started = time.time()
        try:
            if need_outline:
                from core.booksproc.outline import generate_outline

                generate_outline(cfg, lid, user_id=user_id or "auto")
            if need_mindmap:
                from core.booksproc.mindmap import generate_mindmap

                generate_mindmap(cfg, lid, user_id=user_id or "auto")
                rebind_evidence_for_lecture(cfg, lid)
            log_event("course_graph_auto_built", "课程图谱自动补建/重建完成", payload={
                "lecture_id": lid, "user_id": user_id, "seconds": round(time.time() - started, 1),
                "outline": need_outline, "mindmap": need_mindmap, "reason": status,
            })
        except Exception as exc:  # noqa: BLE001
            with _LOCK:
                _LAST_FAILURE[lid] = time.time()
            log_event("course_graph_auto_failed", "课程图谱自动补建/重建失败", payload={
                "lecture_id": lid, "user_id": user_id, "error": str(exc)[:400], "reason": status,
            })
        finally:
            with _LOCK:
                _BUILDING.discard(lid)

    if sync:
        run()
        return graph_status(cfg, lid)
    threading.Thread(target=run, name=f"course-graph-{lid[:24]}", daemon=True).start()
    return "building"
