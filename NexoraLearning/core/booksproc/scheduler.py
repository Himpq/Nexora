"""夜间备课调度器（B1，方案 §4.1）。

云端等价物是每晚一次的 cron；本地阶段以同参数的后台线程实现（每天 run_hour
触发一次），并提供手动排练入口（facade `POST /api/agent/v1/prep/run`）。

事实依据（与真实管线一致，不做主观猜测）：
- 队列为单 worker 串行（core/booksproc/queue.py），并发上限 1 天然成立。
- 入队接口是书级：enqueue_book_intensive / _section / _annotation / _question，
  管线断点续跑（每次处理下一个未完成章节）。
- 阶段前置依赖（manager.py 内校验）：intensive 需 coarse done；
  section 需 intensive done；annotation 需 section done；question 需 intensive done。
- 批注结果在 annotations.xml（<annotation> 块，含 chapter_name/anchor_text）；
  题目结果在 questions.xml（<chapter_questions> 块，含 chapter_range）。

调度链路（§4.1）：候选章节 = 用户课程中「下一学习目标」及其后 1 章；对每个候选
章节所在教材，若 精读/批注/题目 任一阶段缺失则按前置依赖顺序补齐（缺 section 时
作为批注的前置一并补齐）；全部补齐后写 agent_act prep 卡（划重点条数/题目数/耗时），
并把「备课完成」信号送决策器（prep_done → 主动推送或 agent_hold）。
"""

from __future__ import annotations

import json
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

from core import user as user_store
from core.bookindex import get_book_index
from core.booksproc import manager as booksproc_manager
from core.decision import evaluate as evaluate_decision
from core.lectures import get_book, list_books, list_lectures, load_book_questions_xml
from core.runlog import log_event
from core.user.learning_progress import compute_user_lecture_progress

DEFAULT_PARAMS: Dict[str, Any] = {
    "enabled": True,
    "run_hour": 2,                    # 每天 02:00（服务端本地时间）触发一次
    "check_interval_seconds": 30,     # 调度线程检查间隔
    "monitor_interval_seconds": 30,   # 完成监控间隔
    "max_candidate_chapters": 2,      # 下一学习目标 + 其后 1 章
    "prep_stages": ["intensive", "annotation", "question"],
    "max_highlight_preview": 5,
}

# 阶段 → 入队函数与前置阶段（与 manager.py 内校验一致）。
_STAGE_DEFS = {
    "intensive": {"enqueue": "enqueue_book_intensive", "requires": ["coarse"]},
    "section": {"enqueue": "enqueue_book_section", "requires": ["intensive"]},
    "annotation": {"enqueue": "enqueue_book_annotation", "requires": ["section"]},
    "question": {"enqueue": "enqueue_book_question", "requires": ["intensive"]},
}

_DONE_STATUSES = {"done", "completed", "success"}
_FLIGHT_STATUSES = {"queued", "running"}

_lock = threading.Lock()
_thread: Optional[threading.Thread] = None
_running = False


def _params(cfg: Mapping[str, Any]) -> Dict[str, Any]:
    params = {key: (dict(value) if isinstance(value, dict) else list(value) if isinstance(value, list) else value) for key, value in DEFAULT_PARAMS.items()}
    override = cfg.get("nightly_prep") if isinstance(cfg, dict) and isinstance(cfg.get("nightly_prep"), dict) else {}
    for key, default in DEFAULT_PARAMS.items():
        if key in override:
            value = override[key]
            if isinstance(default, dict) and isinstance(value, dict):
                params[key].update(value)
            else:
                params[key] = value
    return params


def _state_path(cfg: Mapping[str, Any]) -> Path:
    return Path(cfg.get("data_dir") or "data") / "nightly_prep.json"


def load_state(cfg: Mapping[str, Any]) -> Dict[str, Any]:
    path = _state_path(cfg)
    if not path.is_file():
        return {"last_scheduled_run": 0, "last_run_day": "", "batches": {}}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {"last_scheduled_run": 0, "last_run_day": "", "batches": {}}
    if not isinstance(value, dict):
        return {"last_scheduled_run": 0, "last_run_day": "", "batches": {}}
    if not isinstance(value.get("batches"), dict):
        value["batches"] = {}
    return value


def save_state(cfg: Mapping[str, Any], state: Dict[str, Any]) -> None:
    path = _state_path(cfg)
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.tmp")
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)


def _stage_status(book: Mapping[str, Any], stage: str) -> str:
    value = str((book or {}).get(f"{stage}_status") or "").strip().lower()
    if not value:
        return "missing"
    if value in _DONE_STATUSES:
        return "done"
    if value in _FLIGHT_STATUSES:
        return "in_flight"
    return "failed"


def resolve_targets(cfg: Mapping[str, Any], username: str) -> List[Dict[str, Any]]:
    """候选章节 = 用户已选课程中「下一学习目标」及其后 1 章（与 facade 的
    _resolve_session_target 同源：第一门课 → 第一本书 → 当前/下一章）。"""
    records = user_store.list_learning_records(cfg, username) or []
    selected_ids = set(user_store.list_selected_lecture_ids(cfg, username))
    lectures = [
        row for row in list_lectures(cfg)
        if isinstance(row, Mapping) and str(row.get("id") or "").strip() in selected_ids
    ]
    if not lectures:
        return []
    lecture = lectures[0]
    lecture_id = str(lecture.get("id") or "").strip()
    books = list_books(cfg, lecture_id)
    if not books:
        return []
    book = books[0]
    book_id = str(book.get("id") or "").strip()
    try:
        index = get_book_index(cfg, lecture_id, book_id)
        chapters = [row for row in index.chapters]
    except Exception:
        chapters = []
    if not chapters:
        return []

    progress = compute_user_lecture_progress(username, lecture_id, books, records=records)
    anchor_title = str(progress.get("current_chapter") or progress.get("next_chapter") or "").strip()
    anchor = 0
    if anchor_title:
        for row in chapters:
            if str(row.title or "").strip() == anchor_title:
                anchor = int(row.index)
                break

    max_count = max(1, int(_params(cfg)["max_candidate_chapters"]))
    targets: List[Dict[str, Any]] = []
    for offset in range(max_count):
        position = anchor + offset
        if position >= len(chapters):
            break
        chapter = chapters[position]
        targets.append({
            "lecture_id": lecture_id,
            "lecture_title": str(lecture.get("title") or lecture_id).strip(),
            "book_id": book_id,
            "book_title": str(book.get("title") or book_id).strip(),
            "chapter_index": int(chapter.index),
            "chapter_name": str(chapter.title or "").strip(),
            "chapter_range": str(chapter.range or "").strip(),
        })
    return targets


def _stage_job_ids(lecture_id: str, book_id: str, stage: str) -> List[str]:
    """队列里该教材该阶段的任务（用于耗时统计与在飞判定）。"""
    snapshot = booksproc_manager.get_refinement_queue_snapshot()
    jobs = snapshot.get("jobs") if isinstance(snapshot, dict) else {}
    result: List[str] = []
    if not isinstance(jobs, dict):
        return result
    for job_id, job in jobs.items():
        if not isinstance(job, dict):
            continue
        if str(job.get("lecture_id") or "").strip() == lecture_id and str(job.get("book_id") or "").strip() == book_id and str(job.get("job_type") or "").strip() == stage:
            result.append(str(job_id or "").strip())
    return result


def request_missing_stages(
    cfg: Mapping[str, Any],
    username: str,
    targets: List[Dict[str, Any]],
    *,
    batch_id: str = "",
    now: Optional[int] = None,
) -> Dict[str, Any]:
    """为候选章节所在教材按前置依赖补齐缺失阶段，返回本轮批次结果。"""
    current = int(now or time.time())
    prep_stages = set(_params(cfg)["prep_stages"])
    # 批注依赖 section：section 缺时必须作为前置一并补齐（不被 prep_stages 计数）。
    chained_stages = prep_stages | {"section"}
    result: Dict[str, Any] = {"batch_id": batch_id or "", "requested": [], "skipped": [], "enqueued": 0}
    if not targets:
        result["skipped"].append({"reason": "no_candidates"})
        return result

    for target in targets:
        lecture_id = str(target["lecture_id"])
        book_id = str(target["book_id"])
        book = get_book(cfg, lecture_id, book_id)
        if not isinstance(book, Mapping):
            result["skipped"].append({"reason": "book_not_found", "book_id": book_id})
            continue
        statuses = {stage: _stage_status(book, stage) for stage in ("coarse", "intensive", "section", "annotation", "question")}
        if any(status == "in_flight" for status in statuses.values()):
            result["skipped"].append({"reason": "in_flight", "book_id": book_id})
            continue
        missing = [stage for stage in _STAGE_DEFS if statuses[stage] != "done" and (stage in prep_stages or statuses.get(stage) == "missing")]
        if not missing:
            result["skipped"].append({"reason": "stages_complete", "book_id": book_id})
            continue
        queued_any = False
        for stage in missing:
            definition = _STAGE_DEFS[stage]
            prerequisites_ok = all(statuses.get(req) == "done" for req in definition["requires"])
            if not prerequisites_ok:
                result["skipped"].append({"reason": f"prereq_missing:{stage}", "book_id": book_id})
                continue
            try:
                enqueue_fn = getattr(booksproc_manager, definition["enqueue"])
                queued = enqueue_fn(cfg, lecture_id, book_id, actor="nightly_prep")
                job = queued.get("job") if isinstance(queued, dict) else {}
                job_ids = [str(job.get("job_id") or "").strip()] if str(job.get("job_id") or "").strip() else _stage_job_ids(lecture_id, book_id, stage)
                result["requested"].append({
                    "stage": stage,
                    "lecture_id": lecture_id,
                    "book_id": book_id,
                    "chapter_index": target.get("chapter_index"),
                    "chapter_name": target.get("chapter_name"),
                    "job_ids": job_ids,
                    "enqueued_at": current,
                    "duplicate": bool((queued or {}).get("duplicate")) if isinstance(queued, dict) else False,
                })
                queued_any = True
                result["enqueued"] += 1
            except ValueError as exc:
                result["skipped"].append({"reason": f"enqueue_failed:{stage}", "book_id": book_id, "error": str(exc)})
                log_event("nightly_prep_enqueue_failed", "夜间备课入队失败", payload={"user_id": username, "stage": stage, "book_id": book_id, "error": str(exc)})
        if queued_any and not batch_id:
            batch_id = f"prep_{uuid.uuid4().hex[:16]}"
        result["batch_id"] = batch_id
    return result


def _annotations_xml_path(cfg: Mapping[str, Any], lecture_id: str, book_id: str) -> Path:
    """与 run_annotation_generation_once 内嵌实现同约定：
    data/lectures/{lecture_id}/books/{book_id}/annotations.xml"""
    data_dir = Path(str(cfg.get("data_dir") or "data"))
    return data_dir / "lectures" / str(lecture_id) / "books" / str(book_id) / "annotations.xml"


def load_annotations_xml(cfg: Mapping[str, Any], lecture_id: str, book_id: str) -> str:
    path = _annotations_xml_path(cfg, lecture_id, book_id)
    if not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def save_annotations_xml(cfg: Mapping[str, Any], lecture_id: str, book_id: str, content: str) -> str:
    path = _annotations_xml_path(cfg, lecture_id, book_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(content or ""), encoding="utf-8")
    return str(path)


def _count_annotations(cfg: Mapping[str, Any], target: Dict[str, Any]) -> List[str]:
    """目标章节的批注（划重点）anchor 文本，取前 max_highlight_preview 条。"""
    text = load_annotations_xml(cfg, target["lecture_id"], target["book_id"])
    if not text.strip():
        return []
    chapter_name = str(target.get("chapter_name") or "").strip()
    anchors: List[str] = []
    pattern = re.compile(r"<annotation>\s*.*?\s*</annotation>", flags=re.IGNORECASE | re.DOTALL)
    for block in pattern.findall(text):
        name_match = re.search(r"<chapter_name>\s*(.*?)\s*</chapter_name>", block, flags=re.IGNORECASE | re.DOTALL)
        block_chapter = str(name_match.group(1) or "").strip() if name_match else ""
        if chapter_name and block_chapter and block_chapter != chapter_name:
            continue
        anchor_match = re.search(r"<anchor_text>\s*(.*?)\s*</anchor_text>", block, flags=re.IGNORECASE | re.DOTALL)
        anchor = str(anchor_match.group(1) or "").strip() if anchor_match else ""
        if anchor:
            anchors.append(anchor)
    return anchors


def _count_questions(cfg: Mapping[str, Any], target: Dict[str, Any]) -> int:
    """目标章节范围内的题目数（questions.xml 的 chapter_questions 块按 range 计数）。"""
    text = str(load_book_questions_xml(cfg, target["lecture_id"], target["book_id"]) or "")
    if not text.strip():
        return 0
    target_range = str(target.get("chapter_range") or "").strip()
    count = 0
    pattern = re.compile(r"<chapter_questions>\s*.*?\s*</chapter_questions>", flags=re.IGNORECASE | re.DOTALL)
    for block in pattern.findall(text):
        range_match = re.search(r"<chapter_range>\s*(.*?)\s*</chapter_range>", block, flags=re.IGNORECASE | re.DOTALL)
        block_range = str(range_match.group(1) or "").strip() if range_match else ""
        if target_range and block_range and block_range != target_range:
            continue
        count += len(re.findall(r"<question_item>", block, flags=re.IGNORECASE))
    return count


def _duration_ms(cfg: Mapping[str, Any], requested: List[Dict[str, Any]], fallback: int) -> int:
    snapshot = booksproc_manager.get_refinement_queue_snapshot()
    jobs = snapshot.get("jobs") if isinstance(snapshot, dict) else {}
    started: List[int] = []
    finished: List[int] = []
    for item in requested:
        for job_id in item.get("job_ids") or []:
            job = jobs.get(job_id) if isinstance(jobs, dict) else None
            if not isinstance(job, dict):
                continue
            try:
                started_at = int(job.get("started_at") or 0)
                finished_at = int(job.get("finished_at") or 0)
            except (TypeError, ValueError):
                continue
            if started_at:
                started.append(started_at)
            if finished_at:
                finished.append(finished_at)
    if started and finished:
        return max(0, (max(finished) - min(started)) * 1000)
    return max(0, fallback)


def _briefing_for(
    cfg: Mapping[str, Any],
    username: str,
    targets: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """N4 预判讲解（B1×N3）：目标章节概念中，N3 困惑证据命中最高且超阈者 → briefing。

    事实依据：困惑证据存于 CognitiveEvidenceStore（metadata.kind ∈ selection/ask/idle/wrong，
    权重同 B3）；讲解位按 §3.2 briefing 契约（conceptId/concept/hitCount/minutes），
    另附概念在本章正文中的实际出现位置（anchor offset）。每次最多 1 个。
    """
    from core.cognition.attribution import _load_catalog
    from core.cognition.storage import CognitiveEvidenceStore

    if not targets:
        return None
    try:
        _, concepts = _load_catalog(cfg, username)
    except Exception:
        return None
    target = targets[0]
    lecture_id = str(target.get("lecture_id") or "").strip()
    book_id = str(target.get("book_id") or "").strip()
    chapter_indexes = {int(row.get("chapter_index") or -1) for row in targets}
    chapter_names = {str(row.get("chapter_name") or "").strip() for row in targets}
    candidate_ids = {
        str(row.get("concept_id") or "")
        for row in concepts
        if str(row.get("lecture_id") or "").strip() == lecture_id
        and str(row.get("book_id") or "").strip() == book_id
        and int(row.get("chapter_index") or -1) in chapter_indexes
    }
    if not candidate_ids:
        return None

    weights = {"selection": 1.0, "ask": 1.5, "idle": 0.5, "wrong": 2.0}
    threshold = 3.0
    if isinstance(cfg, dict) and isinstance(cfg.get("confusion"), dict):
        try:
            threshold = float(cfg["confusion"].get("hit_threshold", threshold))
        except (TypeError, ValueError):
            threshold = 3.0

    store = CognitiveEvidenceStore(cfg)
    scores: Dict[str, float] = {}
    for row in store.list(username, lecture_id=lecture_id, book_id=book_id):
        if row.concept_id not in candidate_ids:
            continue
        metadata = row.metadata if isinstance(row.metadata, dict) else {}
        kind = str(metadata.get("kind") or "")
        if kind not in weights:
            continue
        scores[row.concept_id] = scores.get(row.concept_id, 0.0) + weights[kind]
    if not scores:
        return None
    best_id = max(scores, key=lambda key: scores[key])
    if scores[best_id] < threshold:
        return None
    concept = next((row for row in concepts if str(row.get("concept_id") or "") == best_id), None)
    if not isinstance(concept, dict):
        return None

    # 概念在本章正文中的实际出现位置（用于「讲解引用本章实际位置」验收）
    anchor: Dict[str, Any] = {}
    try:
        from core.bookindex import get_book_index

        index = get_book_index(cfg, lecture_id, book_id)
        name = str(concept.get("name") or "").strip()
        for chapter_index in sorted(chapter_indexes):
            text = index.chapter_text(chapter_index) if index.chapter_at(chapter_index) is not None else ""
            offset = text.find(name)
            if offset >= 0:
                anchor = {"chapter_index": chapter_index, "chapter_name": str(target.get("chapter_name") or ""), "offset": offset}
                break
    except Exception:
        anchor = {}

    return {
        "conceptId": best_id,
        "concept": str(concept.get("name") or ""),
        "hitCount": int(round(scores[best_id])),
        "minutes": 3,
        "anchor": anchor,
    }


def _write_prep_card(
    cfg: Mapping[str, Any],
    username: str,
    batch: Dict[str, Any],
    targets: List[Dict[str, Any]],
    now: int,
) -> Dict[str, Any]:
    """阶段全部补齐后的完成回调：agent_act prep 卡 + prep_done 送决策器。"""
    target = targets[0] if targets else {}
    highlights: List[str] = []
    quiz_count = 0
    for row in targets:
        highlights.extend(_count_annotations(cfg, row))
        quiz_count += _count_questions(cfg, row)
    limit = max(1, int(_params(cfg)["max_highlight_preview"]))
    highlights = highlights[:limit]

    fallback_duration = max(0, (now - int(batch.get("enqueued_at") or now)) * 1000)
    duration_ms = _duration_ms(cfg, batch.get("requested") if isinstance(batch.get("requested"), list) else [], fallback_duration)
    chapter_label = str(target.get("chapter_name") or "").strip() or "下一章"
    count_note = f"，划了 {len(highlights)} 个重点" if highlights else ""
    text = f"我昨晚把{chapter_label}读完了{count_note}，出了 {quiz_count} 道题。"

    # §4.1 验收「点开可看 _push_tool_call 留下的阶段步骤」：取最近 8 步。
    try:
        raw_steps = booksproc_manager.get_book_progress_steps(str(target.get("lecture_id") or ""), str(target.get("book_id") or "")) or []
    except Exception:
        raw_steps = []
    steps: List[Dict[str, Any]] = []
    for item in raw_steps[-8:]:
        if not isinstance(item, dict):
            continue
        steps.append({
            "type": str(item.get("type") or "").strip(),
            "title": str(item.get("title") or "").strip(),
            "preview": str(item.get("preview") or "")[:80],
        })
    steps = [item for item in steps if item["title"] or item["type"]]

    # N4 预判讲解（N1×N3）：无 N3 数据时 briefing 缺省，prep 卡正常。
    briefing = _briefing_for(cfg, username, targets)

    record = {
        "type": "agent_decision",
        "decision_id": f"dec_{uuid.uuid4().hex[:20]}",
        "kind": "agent_act",
        "trigger": "prep_done",
        "timestamp": now,
        "unattended": True,
        "text": text,
        "reason": "夜间备课完成。",
        "evidence": [{"label": f"昨晚备课完成：{chapter_label}", "source": "prep"}],
        "card": {
            "type": "prep",
            "chapter": chapter_label,
            "highlights": highlights,
            "quizCount": quiz_count,
            "durationMs": duration_ms,
            "steps": steps,
        },
        "status": "pending",
        "source": "nightly_prep",
    }
    if briefing:
        record["card"]["briefing"] = briefing
    user_store.append_learning_record(cfg, username, record)
    log_event("nightly_prep_done", "夜间备课完成", payload={"user_id": username, "decision_id": record["decision_id"], "highlights": len(highlights), "quiz_count": quiz_count})

    decision = evaluate_decision(
        cfg,
        username,
        trigger="prep_done",
        signals={"prep_done": True},
        target=target if target else None,
        minutes=15,
        now=now,
    )
    decision_record = dict(decision)
    decision_record["type"] = "agent_decision"
    decision_record["username"] = username
    user_store.append_learning_record(cfg, username, decision_record)
    return {"prep_record_id": record["decision_id"], "decision_id": decision["decision_id"], "decision_fire": decision["fire"], "suppressed_by": decision["suppressed_by"]}


def _complete_batches(cfg: Mapping[str, Any], now: Optional[int] = None) -> None:
    """监控 open 批次：为新解锁的阶段补链入队；阶段补齐后写 prep 卡；失败则记录错误不再追。"""
    current = int(now or time.time())
    state = load_state(cfg)
    batches = state["batches"]
    changed = False
    for batch_id, batch in list(batches.items()):
        if not isinstance(batch, dict) or batch.get("status") in {"done", "failed"}:
            continue
        username = str(batch.get("username") or "").strip()
        targets = batch.get("targets") if isinstance(batch.get("targets"), list) else []
        if not username or not targets:
            continue
        lecture_id = str(targets[0].get("lecture_id") or "").strip()
        book_id = str(targets[0].get("book_id") or "").strip()
        book = get_book(cfg, lecture_id, book_id)
        if not isinstance(book, Mapping):
            continue

        requested = batch.get("requested") if isinstance(batch.get("requested"), list) else []
        requested_stages = {str(item.get("stage") or "") for item in requested if isinstance(item, dict)}
        statuses = {stage: _stage_status(book, stage) for stage in ("intensive", "section", "annotation", "question")}

        if any(statuses.get(stage) == "failed" for stage in requested_stages):
            batch["status"] = "failed"
            batch["error"] = "夜间备课阶段失败，已停止。"
            batch["finished_at"] = current
            changed = True
            log_event("nightly_prep_failed", "夜间备课阶段失败", payload={"user_id": username, "batch_id": batch_id})
            continue

        # 补链：为前置刚完成而尚未入队的阶段入队（request_missing_stages 会跳过
        # 在飞与已完成的阶段，只入队新解锁者）。
        if not any(status == "in_flight" for status in statuses.values()):
            outcome = request_missing_stages(cfg, username, targets, batch_id=batch_id, now=current)
            existing_keys = {(str(item.get("stage") or ""), str(item.get("book_id") or "")) for item in requested}
            for item in outcome.get("requested") or []:
                key = (str(item.get("stage") or ""), str(item.get("book_id") or ""))
                if key not in existing_keys:
                    requested.append(item)
                    existing_keys.add(key)
            if outcome.get("requested"):
                batch["requested"] = requested
                changed = True
            requested_stages = {str(item.get("stage") or "") for item in requested if isinstance(item, dict)}

        if any(statuses.get(stage) != "done" for stage in requested_stages):
            continue

        # 全部请求阶段完成
        outcome = _write_prep_card(cfg, username, batch, targets, current)
        batch["status"] = "done"
        batch["prep_written"] = True
        batch["finished_at"] = current
        batch.update(outcome)
        changed = True
    if changed:
        save_state(cfg, state)


def run_nightly_pass(cfg: Mapping[str, Any], usernames: Optional[List[str]] = None, now: Optional[int] = None) -> Dict[str, Any]:
    """执行一次夜间备课扫描：解析候选章节、补齐缺失阶段。"""
    current = int(now or time.time())
    params = _params(cfg)
    if not bool(params.get("enabled", True)):
        return {"ran": False, "reason": "disabled"}
    if usernames is None:
        usernames = [str(row.get("id") or row.get("username") or "").strip() for row in user_store.list_users(cfg) if isinstance(row, Mapping)]
        usernames = [name for name in usernames if name and user_store.list_selected_lecture_ids(cfg, name)]
    state = load_state(cfg)
    ran_for: List[Dict[str, Any]] = []
    for username in usernames:
        targets = resolve_targets(cfg, username)
        if not targets:
            ran_for.append({"username": username, "targets": 0, "reason": "no_candidates"})
            continue
        batch_id = f"prep_{uuid.uuid4().hex[:16]}"
        outcome = request_missing_stages(cfg, username, targets, batch_id=batch_id, now=current)
        if outcome.get("requested"):
            batch = {
                "batch_id": batch_id,
                "username": username,
                "targets": targets,
                "requested": outcome["requested"],
                "status": "running",
                "enqueued_at": current,
                "prep_written": False,
            }
            state["batches"][batch_id] = batch
        ran_for.append({
            "username": username,
            "targets": [{"chapter_name": row.get("chapter_name"), "chapter_index": row.get("chapter_index")} for row in targets],
            "requested": outcome.get("requested"),
            "skipped": outcome.get("skipped"),
        })
    state["last_scheduled_run"] = current
    state["last_run_day"] = time.strftime("%Y-%m-%d", time.localtime(current))
    save_state(cfg, state)
    log_event("nightly_prep_pass", "夜间备课扫描完成", payload={"ran_for": ran_for})
    return {"ran": True, "ran_for": ran_for, "batches": list(state["batches"].keys())}


def run_prep_now(cfg: Mapping[str, Any], username: str, now: Optional[int] = None) -> Dict[str, Any]:
    """手动排练入口：立即执行一次夜间备课扫描并做一轮完成检查。"""
    result = run_nightly_pass(cfg, usernames=[username], now=now)
    _complete_batches(cfg, now=now)
    return result


def should_run_nightly(cfg: Mapping[str, Any], now: Optional[int] = None) -> bool:
    params = _params(cfg)
    if not bool(params.get("enabled", True)):
        return False
    current = int(now or time.time())
    state = load_state(cfg)
    local = time.localtime(current)
    if int(local.tm_hour) < int(params["run_hour"]):
        return False
    if state.get("last_run_day") == time.strftime("%Y-%m-%d", local):
        return False
    last_run = int(state.get("last_scheduled_run") or 0)
    return last_run == 0 or current - last_run >= 3600


def _loop(cfg: Mapping[str, Any]) -> None:
    global _running
    params = _params(cfg)
    check_interval = max(5, int(params["check_interval_seconds"]))
    monitor_interval = max(5, int(params["monitor_interval_seconds"]))
    last_check = 0
    last_monitor = 0
    while _running:
        now = int(time.time())
        try:
            if now - last_check >= check_interval:
                last_check = now
                if should_run_nightly(cfg, now):
                    run_nightly_pass(cfg, now=now)
            if now - last_monitor >= monitor_interval:
                last_monitor = now
                _complete_batches(cfg, now=now)
                # N5 闭环 24h 收敛检查（§4.5 放弃语义）
                try:
                    from core.agent_flow import expire_flows

                    expire_flows(cfg, now=now)
                except Exception:
                    pass
                # T5 邮件事件：新作业邮件 → 决策器 mail_arrived（§5）
                try:
                    from core import user as user_store_t5
                    from core.toolbox import check_mail_events

                    for user_row in user_store_t5.list_users(cfg):
                        if isinstance(user_row, dict):
                            user_id = str(user_row.get("id") or user_row.get("username") or "").strip()
                            if user_id and user_store_t5.list_selected_lecture_ids(cfg, user_id):
                                check_mail_events(cfg, user_id, now=now)
                except Exception:
                    pass
        except Exception as exc:
            log_event("nightly_prep_loop_error", "夜间备课调度循环异常", payload={"error": str(exc)})
        time.sleep(min(check_interval, monitor_interval, 30))


def start_nightly_scheduler(cfg: Mapping[str, Any]) -> None:
    """启动后台调度线程（幂等）。"""
    global _running, _thread
    with _lock:
        if _running and _thread and _thread.is_alive():
            return
        _running = True
        _thread = threading.Thread(target=_loop, args=(dict(cfg or {}),), name="NXLNightlyPrep", daemon=True)
        _thread.start()
    log_event("nightly_prep_start", "夜间备课调度器已启动", payload={})


def stop_nightly_scheduler() -> None:
    global _running
    _running = False
