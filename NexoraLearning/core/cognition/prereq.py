"""B2 前置知识缺口（方案 §4.2）。

给定目标章节：prereq(章) = 该章概念集合 ∩ 其他课程已学概念集合，取 CognitiveStateEngine
掌握度，低于阈值的即为缺口。

事实依据：
- 概念目录按课程构建（core/cognition/catalog），概念名规范化与 catalog._normalize_key 同源
  （NFKC + casefold + 空白折叠）——跨课程同名概念按此匹配。
- 「已学」= 用户在其他课程存在该概念所在章节的 chapter_completed 学习记录。
- 掌握度 = CognitiveStateEngine.compute（证据来自 CognitiveEvidenceStore）；无评估证据
  （unverified）视为缺口（学了但没验证）。
- 缺口写 prereq 卡（agent_act，幂等：每概念每天一张）并送决策器（prereq_gap）。
"""

from __future__ import annotations

import hashlib
import re
import time
import unicodedata
from typing import Any, Dict, List, Mapping, Optional

from core import user as user_store
from core.cognition.attribution import _load_catalog
from core.cognition.engine import CognitiveStateEngine
from core.cognition.service import CognitionService
from core.cognition.storage import CognitiveEvidenceStore
from core.decision import evaluate as evaluate_decision
from core.runlog import log_event

DEFAULT_PARAMS: Dict[str, Any] = {
    "mastery_threshold": 0.6,
    "minutes": 3,
}


def _params(cfg: Mapping[str, Any]) -> Dict[str, Any]:
    params = dict(DEFAULT_PARAMS)
    override = cfg.get("prereq") if isinstance(cfg, dict) and isinstance(cfg.get("prereq"), dict) else {}
    for key in DEFAULT_PARAMS:
        if key in override:
            params[key] = override[key]
    return params


def _normalize_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", str(value or "")).strip().casefold()
    return re.sub(r"\s+", "", normalized)


def _completed_chapters(cfg: Mapping[str, Any], username: str) -> Dict[str, set]:
    """其他课程已学章节：{lecture_id: {chapter_index}}"""
    completed: Dict[str, set] = {}
    for row in user_store.list_learning_records(cfg, username) or []:
        if not isinstance(row, dict) or str(row.get("type") or "").strip() != "chapter_completed":
            continue
        lecture_id = str(row.get("lecture_id") or "").strip()
        if not lecture_id:
            continue
        try:
            chapter_index = int(row.get("chapter_index") or -1)
        except (TypeError, ValueError):
            chapter_index = -1
        if chapter_index < 0:
            continue
        completed.setdefault(lecture_id, set()).add(chapter_index)
    return completed


def _chapter_matched(concepts: List[Dict[str, Any]], lecture_id: str, book_id: str, chapter_index: int) -> List[Dict[str, Any]]:
    rows = []
    for row in concepts:
        if str(row.get("lecture_id") or "").strip() != lecture_id:
            continue
        if book_id and str(row.get("book_id") or "").strip() != book_id:
            continue
        try:
            if chapter_index is not None and int(row.get("chapter_index") or -1) != int(chapter_index):
                continue
        except (TypeError, ValueError):
            continue
        rows.append(row)
    return rows


def check_prereq(
    cfg: Mapping[str, Any],
    username: str,
    lecture_id: str,
    book_id: str,
    chapter_index: int,
    *,
    now: Optional[int] = None,
) -> Dict[str, Any]:
    """检查目标章节的前置知识缺口，产出 prereq 卡并送决策器。"""
    params = _params(cfg)
    current = int(now or time.time())
    service, concepts = _load_catalog(cfg, username)
    target_concepts = _chapter_matched(concepts, lecture_id, book_id, chapter_index)
    if not target_concepts:
        return {"ran": False, "reason": "no_concepts", "gaps": [], "matched": []}

    completed = _completed_chapters(cfg, username)
    store = CognitiveEvidenceStore(cfg)
    engine = CognitiveStateEngine()
    service = CognitionService(cfg)
    target_names = {_normalize_name(str(row.get("name") or "")) for row in target_concepts}
    target_by_name = {_normalize_name(str(row.get("name") or "")): row for row in target_concepts}

    matched: List[Dict[str, Any]] = []
    gaps: List[Dict[str, Any]] = []
    gap_concepts: List[Dict[str, Any]] = []
    for row in concepts:
        other_lecture = str(row.get("lecture_id") or "").strip()
        if other_lecture == lecture_id:
            continue
        name_key = _normalize_name(str(row.get("name") or ""))
        if name_key not in target_names:
            continue
        try:
            other_chapter = int(row.get("chapter_index") or -1)
        except (TypeError, ValueError):
            other_chapter = -1
        if other_chapter not in completed.get(other_lecture, set()):
            continue  # 未在其他课程学过 → 不算前置缺口
        other_book = str(row.get("book_id") or "").strip()
        evidence_rows = store.list(username, lecture_id=other_lecture, book_id=other_book, concept_id=str(row.get("concept_id") or ""))
        concept_node = service._concept_from_dict(row)
        state = engine.compute(concept_node, evidence_rows, now=current)
        mastery = state.mastery
        mastery_value = float(mastery) if isinstance(mastery, (int, float)) else 0.0
        matched.append({
            "concept": str(row.get("name") or ""),
            "fromLectureId": other_lecture,
            "fromBookId": other_book,
            "fromChapterIndex": other_chapter,
            "fromChapterName": str(row.get("chapter_name") or ""),
            "mastery": round(mastery_value, 2),
            "isGap": mastery is None or mastery_value < float(params["mastery_threshold"]),
        })
        if mastery is None or mastery_value < float(params["mastery_threshold"]):
            gaps.append({
                "concept": str(row.get("name") or ""),
                "conceptId": str(row.get("concept_id") or ""),
                "fromLectureId": other_lecture,
                "fromBookId": other_book,
                "fromChapterIndex": other_chapter,
                "fromChapterName": str(row.get("chapter_name") or ""),
                "mastery": round(mastery_value, 2),
                "minutes": int(params["minutes"]),
            })
            gap_concepts.append(row)

    cards_written = 0
    for gap in gaps:
        target_row = target_by_name.get(_normalize_name(gap["concept"]))
        concept_id = str(gap.get("conceptId") or target_row.get("concept_id") or "") if isinstance(target_row, dict) else str(gap.get("conceptId") or "")
        day = time.strftime("%Y-%m-%d", time.localtime(current))
        digest = hashlib.sha1(f"{concept_id}|{lecture_id}|{day}".encode("utf-8")).hexdigest()[:16]
        decision_id = f"dec_prereq_{digest}"
        records = user_store.list_learning_records(cfg, username) or []
        if any(isinstance(row, dict) and row.get("type") == "agent_decision" and row.get("decision_id") == decision_id for row in records):
            continue
        chapter_label = str((target_row or {}).get("chapter_name") or "这一章")
        record = {
            "type": "agent_decision",
            "decision_id": decision_id,
            "kind": "agent_act",
            "trigger": "prereq_gap",
            "fire": True,
            "unattended": False,
            "timestamp": current,
            "text": f"这节要用到{gap['concept']}，你在{gap['fromChapterName'] or '之前的课程'}学过但最近没碰。先花 {gap['minutes']} 分钟补一下？",
            "reason": "前置知识缺口。",
            "evidence": [{
                "label": f"前置缺口：{gap['concept']}（来自 {gap['fromChapterName'] or '旧课程'}）",
                "source": "prereq",
                "conceptId": concept_id,
            }],
            "card": {
                "type": "prereq",
                "concept": gap["concept"],
                "fromCourse": gap["fromChapterName"] or "之前的课程",
                "minutes": gap["minutes"],
                "masteryDelta": gap["mastery"],
                "fromLectureId": gap["fromLectureId"],
                "fromBookId": gap["fromBookId"],
                "fromChapterIndex": gap["fromChapterIndex"],
            },
            "status": "pending",
            "source": "prereq_check",
        }
        user_store.append_learning_record(cfg, username, record)
        cards_written += 1

        decision = evaluate_decision(
            cfg,
            username,
            trigger="prereq_gap",
            signals={"prereq_gap": {"concept": gap["concept"]}},
            target={
                "lecture_id": lecture_id,
                "book_id": book_id,
                "chapter_index": chapter_index,
                "chapter_name": chapter_label,
            },
            minutes=gap["minutes"],
            now=current,
        )
        decision_record = dict(decision)
        decision_record["type"] = "agent_decision"
        decision_record["username"] = username
        user_store.append_learning_record(cfg, username, decision_record)
        cards_written += 1

    log_event("prereq_check", "前置知识缺口检查完成", payload={"user_id": username, "matched": len(matched), "gaps": len(gaps), "cards_written": cards_written})
    return {
        "ran": True,
        "target": {"lecture_id": lecture_id, "book_id": book_id, "chapter_index": chapter_index},
        "matched": matched,
        "gaps": gaps,
        "cards_written": cards_written,
        "generated_at": current,
    }
