"""N5 点头即闭环：主动推送「好」之后的持久化执行链（方案 §4.5）。

链：accept → open-session → [用户读] → 读完(focus_out/session_complete) → review-plan
出题 → 用户作答判分 → cognition 画像更新 → 顺带备下一章 → wrapup 卡（含 uncertain 裁决）。

事实依据：
- 状态持久化沿用既有 append-only 学习记录（learning.jsonl）：每步追加一条
  `agent_flow_*` 记录，当前状态 = 最近一条记录 → 服务重启/进程被杀可恢复，
  与 active_session 的推导方式同构。
- 出题复用 core.booksproc.chapter_quiz（与 facade review-plan 同源）；
- 判分写 question_completions（喂画像/面二）；
- 掌握度变化 = 流程开始时快照 vs wrapup 时 CognitiveStateEngine 重算；
- 超 24h 未推进 → agent_hold 收敛（「那次没做完，要接着来吗？」），不悬挂。
- uncertain 裁决回喂 CognitiveEvidence（review 证据）。
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any, Dict, List, Mapping, Optional, Tuple

from core import user as user_store
from core.booksproc.chapter_quiz import grade_question, load_or_create_chapter_quiz
from core.booksproc import manager as booksproc_manager
from core.cognition.attribution import _load_catalog, _match_concepts
from core.cognition.engine import CognitiveStateEngine
from core.cognition.service import CognitionService
from core.cognition.storage import CognitiveEvidenceStore
from core.runlog import log_event

DEFAULT_PARAMS: Dict[str, Any] = {
    "expire_seconds": 86400,     # 24h 未推进 → 收敛
    "quiz_limit": 3,
    "quiz_poll_seconds": 5,
}

_FLOW_STEPS = (
    "opened",
    "reading_done",
    "quiz_generated",
    "quiz_submitted",
    "wrapup",
    "aborted",
)

_lock = threading.Lock()


def _params(cfg: Mapping[str, Any]) -> Dict[str, Any]:
    params = dict(DEFAULT_PARAMS)
    override = cfg.get("agent_flow") if isinstance(cfg, dict) and isinstance(cfg.get("agent_flow"), dict) else {}
    for key in DEFAULT_PARAMS:
        if key in override:
            params[key] = override[key]
    return params


def _append(cfg: Mapping[str, Any], username: str, record: Dict[str, Any]) -> Dict[str, Any]:
    return user_store.append_learning_record(cfg, username, record)


def _flow_records(cfg: Mapping[str, Any], username: str, flow_id: str = "") -> List[Dict[str, Any]]:
    records = user_store.list_learning_records(cfg, username) or []
    rows = [
        row for row in records
        if isinstance(row, dict)
        and str(row.get("type") or "").startswith("agent_flow_")
        and (not flow_id or str(row.get("flow_id") or "") == flow_id)
    ]
    return rows


def _record_timestamp(row: Mapping[str, Any]) -> int:
    raw = row.get("timestamp") or row.get("created_at") or row.get("ts") or 0
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return 0
    if value > 10_000_000_000:
        value /= 1000
    return int(value)


def flow_state(cfg: Mapping[str, Any], username: str, flow_id: str) -> Dict[str, Any]:
    """由记录推导当前状态（服务重启后可恢复）。"""
    rows = _flow_records(cfg, username, flow_id)
    if not rows:
        return {"flow_id": flow_id, "status": "not_found"}
    started = next((row for row in rows if row.get("type") == "agent_flow_started"), None)
    if started is None:
        return {"flow_id": flow_id, "status": "not_found"}
    steps = [row for row in rows if row.get("type") == "agent_flow_step"]
    last_step = steps[-1]["step"] if steps else "opened"
    last_ts = max(_record_timestamp(row) for row in rows)
    state = {
        "flow_id": flow_id,
        "status": "done" if last_step in {"wrapup", "aborted"} else "running",
        "step": last_step,
        "session_id": str(started.get("session_id") or ""),
        "target": started.get("target") if isinstance(started.get("target"), dict) else {},
        "started_at": _record_timestamp(started),
        "last_step_at": last_ts,
        "steps": [{"step": str(row.get("step") or ""), "ts": _record_timestamp(row)} for row in steps],
    }
    quiz_rows = [row for row in rows if row.get("type") == "agent_flow_quiz"]
    if quiz_rows:
        latest = quiz_rows[-1]
        state["task_id"] = str(latest.get("task_id") or "")
        state["quiz"] = latest.get("quiz") if isinstance(latest.get("quiz"), dict) else {}
    wrapup_rows = [row for row in rows if row.get("type") == "agent_flow_wrapup"]
    if wrapup_rows:
        state["wrapup"] = wrapup_rows[-1].get("wrapup") if isinstance(wrapup_rows[-1].get("wrapup"), dict) else {}
    mastery_rows = [row for row in rows if row.get("type") == "agent_flow_mastery"]
    if mastery_rows:
        state["mastery_before"] = mastery_rows[0].get("mastery")
    return state


def _concept_mastery_snapshot(cfg: Mapping[str, Any], username: str, target: Mapping[str, Any]) -> Dict[str, float]:
    """目标章节概念的当前掌握度快照（用于 wrapup 的 masteryShift）。"""
    try:
        _, concepts = _load_catalog(cfg, username)
    except Exception:
        return {}
    engine = CognitiveStateEngine()
    store = CognitiveEvidenceStore(cfg)
    service = CognitionService(cfg)
    lecture_id = str(target.get("lecture_id") or "").strip()
    book_id = str(target.get("book_id") or "").strip()
    try:
        chapter_index = int(target.get("chapter_index") or -1)
    except (TypeError, ValueError):
        chapter_index = -1
    snapshot: Dict[str, float] = {}
    for row in concepts:
        if str(row.get("lecture_id") or "").strip() != lecture_id:
            continue
        if book_id and str(row.get("book_id") or "").strip() != book_id:
            continue
        if chapter_index >= 0 and int(row.get("chapter_index") or -1) != chapter_index:
            continue
        concept_node = service._concept_from_dict(row)
        evidence = store.list(username, lecture_id=lecture_id, book_id=book_id, concept_id=str(row.get("concept_id") or ""))
        state = engine.compute(concept_node, evidence)
        if state.mastery is not None:
            snapshot[str(row.get("concept_id") or "")] = float(state.mastery)
    return snapshot


def start_flow(
    cfg: Mapping[str, Any],
    username: str,
    target: Mapping[str, Any],
    *,
    now: Optional[int] = None,
) -> Dict[str, Any]:
    """accept → 建流程 + open-session 语义，返回 flow_id/session_id/target。"""
    current = int(now or time.time())
    flow_id = f"flow_{uuid.uuid4().hex[:16]}"
    session_id = f"session_{uuid.uuid4().hex[:20]}"
    target_dict = {
        "lecture_id": str(target.get("lecture_id") or "").strip(),
        "book_id": str(target.get("book_id") or "").strip(),
        "chapter_index": target.get("chapter_index"),
        "chapter_name": str(target.get("chapter_name") or "").strip(),
        "chapter_range": str(target.get("chapter_range") or "").strip(),
    }
    _append(cfg, username, {
        "type": "agent_flow_started",
        "flow_id": flow_id,
        "session_id": session_id,
        "target": target_dict,
        "timestamp": current,
    })
    _append(cfg, username, {
        "type": "agent_flow_step",
        "flow_id": flow_id,
        "step": "opened",
        "timestamp": current,
    })
    mastery = _concept_mastery_snapshot(cfg, username, target_dict)
    _append(cfg, username, {
        "type": "agent_flow_mastery",
        "flow_id": flow_id,
        "mastery": mastery,
        "timestamp": current,
    })
    # 与 open-session 同语义的会话记录（阅读器/时间线可见）
    _append(cfg, username, {
        "type": "agent_session_opened",
        "session_id": session_id,
        "lecture_id": target_dict["lecture_id"],
        "book_id": target_dict["book_id"],
        "chapter_index": target_dict["chapter_index"],
        "chapter_name": target_dict["chapter_name"],
        "source": "agent_flow",
        "timestamp": current,
    })
    # 时间线留痕（§4.5 每步 tool_step）
    _append(cfg, username, {
        "type": "agent_decision",
        "decision_id": f"dec_flow_{uuid.uuid4().hex[:16]}",
        "kind": "tool_step",
        "trigger": "flow",
        "unattended": False,
        "timestamp": current,
        "text": f"我开了学习会话：{target_dict['chapter_name'] or '目标章节'}。",
        "reason": "你点了「好」，我接着往下做。",
        "evidence": [],
        "card": None,
        "status": "pending",
        "source": "agent_flow",
    })
    log_event("agent_flow_start", "点头闭环已启动", payload={"user_id": username, "flow_id": flow_id})
    return {"flow_id": flow_id, "session_id": session_id, "target": target_dict}


def flow_event(
    cfg: Mapping[str, Any],
    username: str,
    flow_id: str,
    event: str,
    *,
    now: Optional[int] = None,
) -> Dict[str, Any]:
    """流程事件推进（端侧唯一入口是 reading_done；其余步骤由后端推进）。"""
    current = int(now or time.time())
    state = flow_state(cfg, username, flow_id)
    if state.get("status") == "not_found":
        return {"error": "FLOW_NOT_FOUND", "state": state}
    if state.get("status") == "done":
        return {"state": state, "duplicate": True}
    if event not in {"reading_done"}:
        return {"error": "INVALID_ARGUMENT", "state": state}
    _append(cfg, username, {"type": "agent_flow_step", "flow_id": flow_id, "step": "reading_done", "timestamp": current})
    _append(cfg, username, {
        "type": "agent_decision",
        "decision_id": f"dec_flow_{uuid.uuid4().hex[:16]}",
        "kind": "tool_step",
        "trigger": "flow",
        "unattended": False,
        "timestamp": current,
        "text": "你读完了，我来出题。",
        "reason": "阅读完成（reading_done）。",
        "evidence": [],
        "card": None,
        "status": "pending",
        "source": "agent_flow",
    })
    quiz = _start_flow_quiz(cfg, username, flow_id, state, current)
    return {"state": flow_state(cfg, username, flow_id), "quiz": quiz}


def _start_flow_quiz(cfg: Mapping[str, Any], username: str, flow_id: str, state: Dict[str, Any], now: int) -> Dict[str, Any]:
    target = state.get("target") if isinstance(state.get("target"), dict) else {}
    lecture_id = str(target.get("lecture_id") or "")
    book_id = str(target.get("book_id") or "")
    try:
        chapter_index = int(target.get("chapter_index") or 0)
    except (TypeError, ValueError):
        chapter_index = 0
    chapter_name = str(target.get("chapter_name") or "")
    chapter_range = str(target.get("chapter_range") or "")
    # target 缺 range/name 时按 bookindex 解析（与 facade 章节解析同源）
    if (not chapter_range or not chapter_name) and lecture_id and book_id:
        try:
            from core.bookindex import get_book_index

            chapter = get_book_index(cfg, lecture_id, book_id).chapter_at(chapter_index)
            if chapter is not None:
                chapter_range = str(chapter.range or "") or chapter_range
                chapter_name = str(chapter.title or "") or chapter_name
        except Exception:
            pass
    task_id = f"task_flow_{uuid.uuid4().hex[:16]}"
    _append(cfg, username, {
        "type": "agent_flow_quiz",
        "flow_id": flow_id,
        "task_id": task_id,
        "quiz": {"status": "queued", "questions": []},
        "timestamp": now,
    })

    def run() -> None:
        try:
            quiz = load_or_create_chapter_quiz(
                cfg,
                user_id=username,
                lecture_id=lecture_id,
                book_id=book_id,
                chapter_index=chapter_index,
                chapter_name=chapter_name,
                chapter_range=chapter_range,
                limit=max(1, min(10, int(_params(cfg)["quiz_limit"]))),
            )
            payload = {
                "type": "agent_flow_quiz",
                "flow_id": flow_id,
                "task_id": task_id,
                "quiz": {
                    "status": "completed",
                    "quiz_id": str(quiz.get("quiz_id") or ""),
                    "questions": quiz.get("questions") if isinstance(quiz.get("questions"), list) else [],
                },
                "timestamp": int(time.time()),
            }
            _append(cfg, username, payload)
            _append(cfg, username, {"type": "agent_flow_step", "flow_id": flow_id, "step": "quiz_generated", "timestamp": int(time.time())})
            _append(cfg, username, {
                "type": "agent_decision",
                "decision_id": f"dec_flow_{uuid.uuid4().hex[:16]}",
                "kind": "tool_step",
                "trigger": "flow",
                "unattended": False,
                "timestamp": int(time.time()),
                "text": f"题出好了，{len(payload['quiz']['questions'])} 道。",
                "reason": "复习题生成完成。",
                "evidence": [],
                "card": {
                    "type": "quiz",
                    "questionId": str(quiz.get("quiz_id") or task_id),
                    "stem": f"完成阅读，{len(payload['quiz']['questions'])} 道题待作答。",
                    "options": [],
                    "flowId": flow_id,
                },
                "status": "pending",
                "source": "agent_flow",
            })
        except Exception as exc:
            _append(cfg, username, {
                "type": "agent_flow_quiz",
                "flow_id": flow_id,
                "task_id": task_id,
                "quiz": {"status": "failed", "questions": [], "error": str(exc)},
                "timestamp": int(time.time()),
            })
            log_event("agent_flow_quiz_failed", "闭环出题失败", payload={"user_id": username, "flow_id": flow_id, "error": str(exc)})

    threading.Thread(target=run, name=f"flow-quiz-{task_id}", daemon=True).start()
    return {"task_id": task_id, "status": "queued"}


def submit_answers(
    cfg: Mapping[str, Any],
    username: str,
    flow_id: str,
    answers: List[Mapping[str, Any]],
    *,
    force_uncertain: bool = False,
    now: Optional[int] = None,
) -> Dict[str, Any]:
    """判分 → 画像更新 → 备下一章 → wrapup 卡。"""
    current = int(now or time.time())
    state = flow_state(cfg, username, flow_id)
    if state.get("status") == "not_found":
        return {"error": "FLOW_NOT_FOUND", "state": state}
    if state.get("status") == "done":
        return {"state": state, "duplicate": True}
    quiz = state.get("quiz") if isinstance(state.get("quiz"), dict) else {}
    questions = quiz.get("questions") if isinstance(quiz.get("questions"), list) else []
    if not questions:
        return {"error": "QUIZ_NOT_READY", "state": state}

    answer_map: Dict[str, str] = {}
    for item in answers or []:
        if not isinstance(item, Mapping):
            continue
        question_id = str(item.get("question_id") or item.get("source_id") or "").strip()
        answer_map[question_id] = str(item.get("answer") or "").strip()

    correct = 0
    scored: List[Dict[str, Any]] = []
    uncertain: List[Dict[str, Any]] = []
    target = state.get("target") if isinstance(state.get("target"), dict) else {}
    for index, question in enumerate(questions):
        if not isinstance(question, dict):
            continue
        question_id = str(question.get("source_id") or question.get("question_id") or f"q{index}")
        expected = str(question.get("answer") or "").strip()
        user_answer = answer_map.get(question_id, "")
        is_correct = grade_question(question, user_answer) if user_answer else False
        if not is_correct and user_answer and user_answer == expected:
            is_correct = True
        if is_correct:
            correct += 1
        user_store.append_question_completion(cfg, username, {
            "lecture_id": str(target.get("lecture_id") or ""),
            "book_id": str(target.get("book_id") or ""),
            "chapter_index": target.get("chapter_index"),
            "chapter_name": str(target.get("chapter_name") or ""),
            "question_title": str(question.get("title") or question.get("content") or "")[:120],
            "is_correct": is_correct,
            "timestamp": current,
        })
        scored.append({"question_id": question_id, "is_correct": is_correct})
        if not user_answer:
            uncertain.append({"questionId": question_id, "why": f"第 {index + 1} 题你没有作答，我拿不准。"})
    if force_uncertain and not uncertain and scored:
        uncertain.append({"questionId": scored[0]["question_id"], "why": "这道题的判分置信度不高，请你裁决。"})

    _append(cfg, username, {
        "type": "agent_flow_step",
        "flow_id": flow_id,
        "step": "quiz_submitted",
        "quiz_score": f"{correct}/{len(scored)}",
        "timestamp": current,
    })

    # 顺带备下一章（§4.5：enqueue_book_intensive(下一章)）
    next_prep = ""
    try:
        from core.lectures import get_book as _get_book

        lecture_id = str(target.get("lecture_id") or "")
        book_id = str(target.get("book_id") or "")
        book = _get_book(cfg, lecture_id, book_id)
        if isinstance(book, Mapping):
            intensive = str(book.get("intensive_status") or "").strip().lower()
            coarse = str(book.get("coarse_status") or "").strip().lower()
            if coarse in {"done", "completed", "success"} and intensive not in {"done", "completed", "success", "queued", "running"}:
                booksproc_manager.enqueue_book_intensive(cfg, lecture_id, book_id, actor="agent_flow")
                next_prep = "下一章的精读已入队。"
    except Exception as exc:
        log_event("agent_flow_next_prep_failed", "顺带备下一章失败", payload={"user_id": username, "flow_id": flow_id, "error": str(exc)})

    # 掌握度变化（快照 vs 现在）
    mastery_before = state.get("mastery_before") if isinstance(state.get("mastery_before"), dict) else {}
    mastery_now = _concept_mastery_snapshot(cfg, username, target)
    mastery_shift: List[Dict[str, Any]] = []
    try:
        _, concepts = _load_catalog(cfg, username)
    except Exception:
        concepts = []
    name_by_id = {str(row.get("concept_id") or ""): str(row.get("name") or "") for row in concepts}
    for concept_id, before in mastery_before.items():
        after = mastery_now.get(concept_id)
        if after is None or abs(float(after) - float(before)) < 0.02:
            continue
        mastery_shift.append({
            "concept": name_by_id.get(concept_id, concept_id),
            "from": round(float(before), 2),
            "to": round(float(after), 2),
        })

    chapter_label = str(target.get("chapter_name") or "目标章节")
    minutes = max(1, int((current - int(state.get("started_at") or current)) / 60) or 12)
    text = (
        f"今晚 {minutes} 分钟做完了：读了{chapter_label}、{len(scored)} 道题对 {correct} 道"
        + (f"，{mastery_shift[0]['concept']}的掌握度从 {mastery_shift[0]['from']} 升到 {mastery_shift[0]['to']}" if mastery_shift else "")
        + (f"。有 {len(uncertain)} 道题我拿不准，你看一下。" if uncertain else "。")
    )
    wrapup = {
        "type": "wrapup",
        "minutes": minutes,
        "chapter": chapter_label,
        "quizScore": f"{correct}/{len(scored)}",
        "masteryShift": mastery_shift,
        "uncertain": uncertain,
        "flowId": flow_id,
    }
    _append(cfg, username, {
        "type": "agent_flow_wrapup",
        "flow_id": flow_id,
        "wrapup": wrapup,
        "timestamp": current,
    })
    _append(cfg, username, {
        "type": "agent_flow_step",
        "flow_id": flow_id,
        "step": "wrapup",
        "timestamp": current,
    })
    _append(cfg, username, {
        "type": "agent_decision",
        "decision_id": f"dec_flow_{uuid.uuid4().hex[:16]}",
        "kind": "agent_act",
        "trigger": "wrapup",
        "unattended": True,
        "timestamp": current,
        "text": text,
        "reason": "学习闭环完成。",
        "evidence": [{"label": f"答题 {correct}/{len(scored)} 正确", "source": "progress"}],
        "card": wrapup,
        "status": "pending",
        "source": "agent_flow",
    })
    if next_prep:
        _append(cfg, username, {
            "type": "agent_decision",
            "decision_id": f"dec_flow_{uuid.uuid4().hex[:16]}",
            "kind": "tool_step",
            "trigger": "flow",
            "unattended": True,
            "timestamp": current,
            "text": next_prep,
            "reason": "顺带备下一章。",
            "evidence": [],
            "card": None,
            "status": "pending",
            "source": "agent_flow",
        })
    log_event("agent_flow_wrapup", "闭环完成", payload={"user_id": username, "flow_id": flow_id, "score": wrapup["quizScore"]})
    return {"state": flow_state(cfg, username, flow_id), "wrapup": wrapup}


def uncertain_verdict(
    cfg: Mapping[str, Any],
    username: str,
    flow_id: str,
    question_id: str,
    verdict: str,
    *,
    now: Optional[int] = None,
) -> Dict[str, Any]:
    """wrapup 卡 uncertain 裁决（对/不对）→ 回喂 CognitiveEvidence。"""
    current = int(now or time.time())
    state = flow_state(cfg, username, flow_id)
    if state.get("status") == "not_found":
        return {"error": "FLOW_NOT_FOUND", "state": state}
    if verdict not in {"agree", "disagree"}:
        return {"error": "INVALID_ARGUMENT", "state": state}
    target = state.get("target") if isinstance(state.get("target"), dict) else {}
    quiz = state.get("quiz") if isinstance(state.get("quiz"), dict) else {}
    question: Optional[Dict[str, Any]] = None
    for index, row in enumerate(quiz.get("questions") or []):
        if not isinstance(row, dict):
            continue
        row_key = str(row.get("source_id") or row.get("question_id") or f"q{index}")
        if row_key == question_id:
            question = row
            break
    evidence_written = False
    if isinstance(question, dict):
        title = str(question.get("title") or question.get("content") or "")
        try:
            _, concepts = _load_catalog(cfg, username)
            matched = _match_concepts(title, concepts, int(target.get("chapter_index") or -1), str(target.get("book_id") or ""))
        except Exception:
            matched = []
        if matched:
            concept = matched[0]
            score = 1.0 if verdict == "agree" else 0.0
            service = CognitionService(cfg)
            try:
                outcome = service.record_evidence(username, {
                    "evidence_id": f"flowverdict_{flow_id}_{question_id[:16]}",
                    "lecture_id": str(concept.get("lecture_id") or ""),
                    "book_id": str(concept.get("book_id") or ""),
                    "concept_id": str(concept.get("concept_id") or ""),
                    "evidence_type": "objective_question",
                    "source_type": "manual",
                    "source_id": f"flow:{flow_id}:{question_id[:24]}",
                    "occurred_at": current,
                    "score": score,
                    "metadata": {"flow_id": flow_id, "question_id": question_id, "verdict": verdict},
                })
                evidence_written = True
            except Exception as exc:
                log_event("agent_flow_verdict_evidence_failed", "uncertain 裁决回喂失败", payload={"user_id": username, "flow_id": flow_id, "error": str(exc)})
    _append(cfg, username, {
        "type": "agent_event",
        "event": "flow_uncertain_verdict",
        "event_id": f"flowverdict_{flow_id}_{question_id}_{verdict}_{current}",
        "flow_id": flow_id,
        "question_id": question_id,
        "verdict": verdict,
        "source": "app",
    })
    return {"updated": True, "flow_id": flow_id, "question_id": question_id, "verdict": verdict, "evidence_written": evidence_written}


def expire_flows(cfg: Mapping[str, Any], now: Optional[int] = None) -> int:
    """超 24h 未推进的流程收敛为 agent_hold（不悬挂）。"""
    current = int(now or time.time())
    params = _params(cfg)
    expired = 0
    for user_row in user_store.list_users(cfg):
        if not isinstance(user_row, Mapping):
            continue
        username = str(user_row.get("id") or user_row.get("username") or "").strip()
        if not username:
            continue
        records = user_store.list_learning_records(cfg, username) or []
        started: Dict[str, Dict[str, Any]] = {}
        latest: Dict[str, int] = {}
        for row in records:
            if not isinstance(row, dict):
                continue
            flow_id = str(row.get("flow_id") or "").strip()
            if not flow_id:
                continue
            if row.get("type") == "agent_flow_started":
                started[flow_id] = row
            ts = _record_timestamp(row)
            if ts > latest.get(flow_id, 0):
                latest[flow_id] = ts
        for flow_id, row in started.items():
            if latest.get(flow_id, 0) == 0 or current - latest[flow_id] <= int(params["expire_seconds"]):
                continue
            target = row.get("target") if isinstance(row.get("target"), dict) else {}
            chapter_label = str(target.get("chapter_name") or "那一章")
            _append(cfg, username, {
                "type": "agent_flow_step",
                "flow_id": flow_id,
                "step": "aborted",
                "timestamp": current,
            })
            _append(cfg, username, {
                "type": "agent_decision",
                "decision_id": f"dec_flow_{uuid.uuid4().hex[:16]}",
                "kind": "agent_hold",
                "trigger": "flow",
                "fire": False,
                "unattended": True,
                "timestamp": current,
                "text": f"{chapter_label}那次没做完，要接着来吗？",
                "reason": "超过 24 小时没有推进，先记下来。",
                "evidence": [],
                "card": None,
                "status": "pending",
                "source": "agent_flow",
            })
            expired += 1
    return expired
