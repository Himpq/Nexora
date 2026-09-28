"""面二「它眼里的你」：从认知状态与困惑证据构建可反驳判断（方案 §6.3）。

判断（UserModelFacet）三类来源：
- 掌握度：CognitiveStateEngine 状态（at_risk / mastery<0.6 → 「还没过」；stable → 「已经稳了」）
- 困惑地图（N3）：confusion 证据（metadata.kind ∈ selection/ask/idle/wrong）按概念聚合，
  命中超阈 → 「你在X上卡过 N 次——…」，依据可下钻到具体事件
- 答题正确率：question_completions 按概念归因（≥3 次作答才出判断，避免小样本噪音）

阅读与自述独立呈现，不把尚未测验的概念显示成 0 分。
反驳写可追溯反馈；赞同或反对判断都不是一道已判分的题目。
"""

from __future__ import annotations

import hashlib
import time
import uuid
from typing import Any, Dict, List, Mapping, Optional

from core import user as user_store
from core.cognition.attribution import _load_catalog, _match_concepts
from core.cognition.service import CognitionService
from core.cognition.storage import CognitiveEvidenceStore
from core.runlog import log_event

_KIND_LABELS = {
    "selection": "划线没问",
    "ask": "提问",
    "idle": "停顿",
    "wrong": "做错",
}
_CONFUSION_KINDS = set(_KIND_LABELS)
_MASTERY_LOW = 0.6
_MASTERY_STABLE = 0.75
_MIN_QUESTION_SAMPLE = 3
_CONFUSION_HIT_THRESHOLD = 3.0
_CONFUSION_WEIGHTS = {"selection": 1.0, "ask": 1.5, "idle": 0.5, "wrong": 2.0}


def _facet_id(kind: str, concept_id: str) -> str:
    digest = hashlib.sha1(f"{kind}|{concept_id}".encode("utf-8")).hexdigest()[:12]
    return f"facet_{digest}"


def _verdict_state(store: CognitiveEvidenceStore, username: str, facet_id: str) -> Optional[str]:
    rows = store.list(username)
    for row in reversed(rows):
        metadata = row.metadata if isinstance(row.metadata, dict) else {}
        if metadata.get("facet_id") == facet_id:
            verdict = metadata.get("verdict")
            if verdict in {"agree", "disagree"}:
                return str(verdict)
    return None


def _feedback_state(cfg: Mapping[str, Any], username: str) -> Dict[str, Dict[str, Any]]:
    result = {}
    for row in user_store.list_learning_records(cfg, username) or []:
        if row.get("type") == "agent_event" and row.get("event") == "facet_verdict":
            result[str(row.get("facet_id") or "")] = row
    return result


def _format_time(ts: Optional[int]) -> str:
    if not ts:
        return ""
    return time.strftime("%m-%d %H:%M", time.localtime(int(ts)))


def build_facets(cfg: Mapping[str, Any], username: str) -> Dict[str, Any]:
    """构建面二数据：mastery 热力图 + facets 判断列表。"""
    service, concepts = _load_catalog(cfg, username)
    store = CognitiveEvidenceStore(cfg)
    selected_ids = user_store.list_selected_lecture_ids(cfg, username)
    feedback = _feedback_state(cfg, username)

    mastery_cells: List[Dict[str, Any]] = []
    facets: List[Dict[str, Any]] = []
    seen_facet_keys = set()

    def add_facet(
        *,
        kind: str,
        concept: Dict[str, Any],
        claim: str,
        confidence: float,
        evidence: List[Dict[str, Any]],
        assessment: Optional[Dict[str, Any]] = None,
    ) -> None:
        concept_id = str(concept.get("concept_id") or "")
        if not concept_id:
            return
        key = (kind, concept_id)
        if key in seen_facet_keys:
            return
        seen_facet_keys.add(key)
        facet_id = _facet_id(kind, concept_id)
        facets.append({
            "id": facet_id,
            "kind": kind,
            "claim": claim,
            "confidence": round(max(0.0, min(1.0, confidence)), 2),
            "concept": str(concept.get("name") or ""),
            "conceptId": concept_id,
            "lectureId": str(concept.get("lecture_id") or ""),
            "bookId": str(concept.get("book_id") or ""),
            "evidence": evidence,
            "userVerdict": feedback.get(facet_id, {}).get("verdict") or _verdict_state(store, username, facet_id),
            **({"assessment": assessment} if assessment is not None else {}),
        })

    # 1) 认知状态 → 掌握度热力图 + 掌握度判断
    for lecture_id in selected_ids:
        try:
            overview = service.get_overview(username, lecture_id=lecture_id)
        except Exception:
            continue
        lecture_title = ""
        if isinstance(overview.get("lecture"), dict):
            lecture_title = str(overview["lecture"].get("title") or "").strip()
        for state in overview.get("states") or []:
            if not isinstance(state, dict):
                continue
            concept = state.get("concept") if isinstance(state.get("concept"), dict) else {}
            mastery = state.get("mastery")
            uncertainty = state.get("uncertainty")
            mastery_cells.append({
                "concept": str(concept.get("name") or ""),
                "mastery": float(mastery) if isinstance(mastery, (int, float)) else None,
                "status": str(state.get("status") or "unknown"),
                "lectureTitle": lecture_title,
                "chapterName": str(concept.get("chapter_name") or ""),
                "conceptId": str(concept.get("concept_id") or ""),
                "lectureId": lecture_id,
                "bookId": str(concept.get("book_id") or ""),
                "chapterIndex": concept.get("chapter_index"),
                "evidenceCount": int(state.get("evidence_count") or 0),
                "assessedCount": int(state.get("assessed_count") or 0),
            })
            status = str(state.get("status") or "")
            if status == "at_risk" or (isinstance(mastery, (int, float)) and mastery < _MASTERY_LOW):
                pct = int(round(float(mastery) * 100)) if isinstance(mastery, (int, float)) else 0
                add_facet(
                    kind="mastery",
                    concept=concept,
                    claim=f"你在{concept.get('name')}上掌握度只有 {pct}%，我觉得还没过。",
                    confidence=round(1.0 - float(uncertainty or 1.0), 2) if isinstance(uncertainty, (int, float)) else 0.5,
                    assessment={"mastery": mastery, "status": status},
                    evidence=[{
                        "label": f"认知状态：{status}，掌握度 {pct}%",
                        "source": "progress",
                        "conceptId": str(concept.get("concept_id") or ""),
                    }],
                )
            elif status == "stable":
                pct = int(round(float(mastery) * 100)) if isinstance(mastery, (int, float)) else 0
                add_facet(
                    kind="mastery",
                    concept=concept,
                    claim=f"你在{concept.get('name')}上已经稳了（{pct}%）。",
                    confidence=round(1.0 - float(uncertainty or 1.0), 2) if isinstance(uncertainty, (int, float)) else 0.5,
                    assessment={"mastery": mastery, "status": status},
                    evidence=[{
                        "label": f"认知状态：{status}，掌握度 {pct}%",
                        "source": "progress",
                        "conceptId": str(concept.get("concept_id") or ""),
                    }],
                )

    # 2) 困惑证据 → 困惑判断（N3 依据，可下钻具体事件）
    confusion_by_concept: Dict[str, Dict[str, Any]] = {}
    for lecture_id in selected_ids:
        for row in store.list(username, lecture_id=lecture_id):
            metadata = row.metadata if isinstance(row.metadata, dict) else {}
            kind = str(metadata.get("kind") or "")
            if kind not in _CONFUSION_KINDS:
                continue
            bucket = confusion_by_concept.setdefault(row.concept_id, {"score": 0.0, "counts": {}, "rows": []})
            bucket["score"] += _CONFUSION_WEIGHTS.get(kind, 1.0)
            bucket["counts"][kind] = bucket["counts"].get(kind, 0) + 1
            bucket["rows"].append(row)
    concept_by_id = {str(row.get("concept_id") or ""): row for row in concepts}
    for concept_id, bucket in confusion_by_concept.items():
        if bucket["score"] < _CONFUSION_HIT_THRESHOLD:
            continue
        concept = concept_by_id.get(concept_id)
        if not isinstance(concept, dict):
            continue
        hits = sum(bucket["counts"].values())
        parts = "、".join(f"{_KIND_LABELS[kind]}{count}次" for kind, count in sorted(bucket["counts"].items()))
        evidence = []
        for row in bucket["rows"][-6:]:
            metadata = row.metadata if isinstance(row.metadata, dict) else {}
            kind = str(metadata.get("kind") or "")
            evidence.append({
                "label": f"{_format_time(row.occurred_at)} {_KIND_LABELS.get(kind, kind)}：{str(metadata.get('text') or '')[:60]}",
                "source": "confusion",
                "conceptId": concept_id,
            })
        add_facet(
            kind="confusion",
            concept=concept,
            claim=f"你在{concept.get('name')}上卡过 {hits} 次——{parts}。",
            confidence=0.8,
            evidence=evidence,
        )

    # 3) 答题正确率 → 表现判断（≥3 次作答）
    accuracy: Dict[str, Dict[str, Any]] = {}
    for row in user_store.list_question_completions(cfg, username) or []:
        if not isinstance(row, dict) or not isinstance(row.get("is_correct"), bool):
            continue
        title = str(row.get("question_title") or "").strip()
        book_id = str(row.get("book_id") or "").strip()
        try:
            chapter_index = int(row.get("chapter_index", -1))
        except (TypeError, ValueError):
            chapter_index = -1
        for concept in _match_concepts(title, concepts, chapter_index, book_id):
            concept_id = str(concept.get("concept_id") or "")
            bucket = accuracy.setdefault(concept_id, {"concept": concept, "correct": 0, "total": 0})
            bucket["total"] += 1
            if row.get("is_correct") is True:
                bucket["correct"] += 1
    for concept_id, bucket in accuracy.items():
        if bucket["total"] < _MIN_QUESTION_SAMPLE:
            continue
        rate = bucket["correct"] / bucket["total"]
        pct = int(round(rate * 100))
        concept = bucket["concept"]
        add_facet(
            kind="accuracy",
            concept=concept,
            claim=f"你在{concept.get('name')}的题目上正确率 {pct}%（{bucket['correct']}/{bucket['total']}）。",
            confidence=round(0.5 + 0.1 * min(5, bucket["total"]), 2),
            assessment={"accuracy": rate, "correct": bucket["correct"], "total": bucket["total"]},
            evidence=[{
                "label": f"答题 {bucket['correct']}/{bucket['total']} 正确",
                "source": "progress",
                "conceptId": concept_id,
            }],
        )

    from core.cognition.learning_observations import learning_observations

    observed = learning_observations(cfg, username)
    facets.extend(observed["facets"])
    read_targets = {
        (course["lecture_id"], chapter["book_id"], chapter["chapter_index"])
        for course in observed["courses"] for chapter in course.get("chapters", [])
        if chapter.get("read_chars", 0) > 0 or chapter.get("completed")
    }
    for cell in mastery_cells:
        if cell["mastery"] is None and (cell["lectureId"], cell["bookId"], cell["chapterIndex"]) in read_targets:
            cell["status"] = "unverified"
    for facet in facets:
        correction = feedback.get(facet["id"], {})
        if correction.get("verdict"):
            facet["userVerdict"] = correction["verdict"]
        if correction.get("verdict") == "disagree" and facet.get("kind") not in {"reading", "conversation"}:
            note = str(correction.get("note") or "").strip()
            facet["claim"] = f"你不同意我对{facet.get('concept') or '这条记录'}的判断，我会重新核实。" + (f"你说：{note}" if note else "")
            facet["confidence"] = min(facet["confidence"], 0.5)
    # insight（夜间反思结论）排最前，其余按更新时间与置信度。
    facets.sort(key=lambda row: (bool(row.get("insight")), row.get("updatedAt", 0), row["confidence"]), reverse=True)
    activity = observed["activity"]
    activity["assessed_concepts"] = sum(1 for row in mastery_cells if row["mastery"] is not None)
    activity["observed_concepts"] = sum(1 for row in mastery_cells if row["status"] != "unknown")
    # 图谱状态：任一已选课程缺 outline/mindmap 就不是 ready；正在补建则 building。
    from core.cognition.graph_builder import graph_status

    graph_states = {lecture_id: graph_status(cfg, lecture_id) for lecture_id in selected_ids}
    if not graph_states:
        overall = "missing"
    elif all(state in {"ready", "stale"} for state in graph_states.values()):
        overall = "stale" if any(state == "stale" for state in graph_states.values()) else "ready"
    elif any(state == "building" for state in graph_states.values()):
        overall = "building"
    else:
        overall = "missing"
    return {
        "mastery": mastery_cells,
        "facets": facets,
        "activity": activity,
        "courses": observed["courses"],
        "graph_status": overall,
        "graph_states": graph_states,
        "generated_at": int(time.time()),
    }


def record_verdict(
    cfg: Mapping[str, Any],
    username: str,
    facet_id: str,
    verdict: str,
    *,
    lecture_id: str = "",
    book_id: str = "",
    concept_id: str = "",
    note: str = "",
) -> Dict[str, Any]:
    """Persist a correction without creating fabricated assessment evidence."""
    event_id = "verdict_" + uuid.uuid4().hex[:20]
    if facet_id.startswith("memory_mem_"):
        from core.memory.evidence_memory import correct_memory

        corrected = correct_memory(cfg, username, facet_id.removeprefix("memory_"),
                                   verdict=verdict, note=note, source_id=event_id)
        if not corrected.get("updated"):
            return {"updated": False, "facet_id": facet_id, "verdict": verdict, "evidence_written": False}
    user_store.append_learning_record(cfg, username, {
        "type": "agent_event",
        "event": "facet_verdict",
        "event_id": event_id,
        "facet_id": facet_id,
        "verdict": verdict,
        "note": note[:1000],
        "lecture_id": lecture_id,
        "book_id": book_id,
        "concept_id": concept_id,
        "source": "mirror",
    })
    return {"updated": True, "facet_id": facet_id, "verdict": verdict, "evidence_written": False}
