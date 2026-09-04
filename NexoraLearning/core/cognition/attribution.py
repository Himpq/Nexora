"""B3 困惑地图：把阅读行为信号归因到概念节点（方案 §4.3）。

信号 → 归因 → 权重（§4.3 表格）：
- selection（划线但未提问）：选中文本匹配概念名 → 1.0
- ask（提问）：问题文本 + 章节上下文匹配概念名 → 1.5
- 阅读停顿（focus_out / idle）：停顿位置所在章节 → 该章概念 → 0.5
- 答错（question_completions is_correct=False）：题目文本匹配概念名 → 2.0

事实依据：
- telemetry 数据源：data/users/{user}/telemetry/reading.csv（列 ts,uid,bid,ci,si,event,scroll,focus,sel_text,extra）
- 答题数据源：user_store.list_question_completions
- 概念目录：core.cognition.service.CognitionService.get_catalog（消费 solidified/mindmap.json + outline.json）
- 证据存储：CognitiveEvidenceStore（append-only，evidence_id 幂等）
命中数超阈值 → 写 CognitiveEvidence + 时间线 confusion 卡（agent_act），并送决策器
（confusion_spike 触发）。所有参数可经 config.json "confusion" 段覆盖。
"""

from __future__ import annotations

import csv
import hashlib
import re
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple

from core import user as user_store
from core.cognition.service import CognitionService
from core.decision import evaluate as evaluate_decision
from core.runlog import log_event

DEFAULT_PARAMS: Dict[str, Any] = {
    "weights": {"selection": 1.0, "ask": 1.5, "idle": 0.5, "wrong": 2.0},
    "hit_threshold": 3.0,      # 累计命中权重超阈值 → 困惑
    "max_evidence_per_concept": 40,
    "lookback_days": 21,
}

_KIND_LABELS = {
    "selection": "划线没问",
    "ask": "提问",
    "idle": "停顿",
    "wrong": "做错",
}


def _params(cfg: Mapping[str, Any]) -> Dict[str, Any]:
    params = {
        key: (dict(value) if isinstance(value, dict) else value)
        for key, value in DEFAULT_PARAMS.items()
    }
    override = cfg.get("confusion") if isinstance(cfg, dict) and isinstance(cfg.get("confusion"), dict) else {}
    for key, default in DEFAULT_PARAMS.items():
        if key in override:
            value = override[key]
            if isinstance(default, dict) and isinstance(value, dict):
                params[key].update(value)
            else:
                params[key] = value
    return params


def _reading_csv_path(cfg: Mapping[str, Any], username: str) -> Path:
    return Path(cfg.get("data_dir") or "data") / "users" / username / "telemetry" / "reading.csv"


def _reading_events(cfg: Mapping[str, Any], username: str) -> List[Dict[str, Any]]:
    path = _reading_csv_path(cfg, username)
    if not path.is_file():
        return []
    rows: List[Dict[str, Any]] = []
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                try:
                    ts = int(row.get("ts") or 0)
                except (TypeError, ValueError):
                    ts = 0
                try:
                    ci = int(row.get("ci") or -1)
                except (TypeError, ValueError):
                    ci = -1
                rows.append({
                    "ts": ts,
                    "bid": str(row.get("bid") or "").strip(),
                    "ci": ci,
                    "si": str(row.get("si") or "").strip(),
                    "event": str(row.get("event") or "").strip(),
                    "sel_text": str(row.get("sel_text") or "").strip(),
                    "focus": str(row.get("focus") or "").strip(),
                })
    except OSError:
        return []
    return rows


def _load_catalog(cfg: Mapping[str, Any], username: str) -> Tuple[CognitionService, List[Dict[str, Any]]]:
    service = CognitionService(cfg)
    selected_ids = user_store.list_selected_lecture_ids(cfg, username)
    concepts: List[Dict[str, Any]] = []
    for lecture_id in selected_ids:
        try:
            catalog = service.get_catalog(lecture_id)
        except Exception:
            continue
        for row in catalog.get("concepts") or []:
            if isinstance(row, dict):
                concepts.append(dict(row))
    return service, concepts


def _normalize(text: str) -> str:
    return re.sub(r"\s+", "", str(text or "")).casefold()


def _match_concepts(text: str, concepts: List[Dict[str, Any]], chapter_index: int, book_id: str) -> List[Dict[str, Any]]:
    """文本 → 概念匹配：概念名出现在文本中（NFKC 无关空白），章节不匹配则丢弃；
    文本为空时回退到该章节的概念（用于停顿归因）。"""
    normalized_text = _normalize(text)
    matched: List[Dict[str, Any]] = []
    for concept in concepts:
        concept_book = str(concept.get("book_id") or "").strip()
        try:
            concept_chapter = int(concept.get("chapter_index") or -1)
        except (TypeError, ValueError):
            concept_chapter = -1
        if chapter_index >= 0 and concept_chapter >= 0 and concept_chapter != chapter_index:
            continue
        if book_id and concept_book and concept_book != book_id:
            continue
        name = str(concept.get("name") or "").strip()
        if not name:
            continue
        if normalized_text and _normalize(name) not in normalized_text:
            continue
        matched.append(concept)
    return matched


def _attributed_events(
    cfg: Mapping[str, Any],
    username: str,
    concepts: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    """归因四类信号，返回 (事件列表, 按概念的命中聚合)。"""
    weights = _params(cfg)["weights"]
    events: List[Dict[str, Any]] = []
    aggregate: Dict[str, Dict[str, Any]] = {}

    def add_hit(concept: Dict[str, Any], kind: str, event: Dict[str, Any]) -> None:
        concept_id = str(concept.get("concept_id") or "")
        if not concept_id:
            return
        bucket = aggregate.setdefault(concept_id, {
            "concept": concept,
            "total": 0.0,
            "breakdown": {kind: 0 for kind in _KIND_LABELS},
        })
        bucket["total"] += float(weights.get(kind, 1.0))
        bucket["breakdown"][kind] = bucket["breakdown"].get(kind, 0) + 1
        events.append({
            "kind": kind,
            "concept": concept,
            "event": event,
            "weight": float(weights.get(kind, 1.0)),
        })

    for row in _reading_events(cfg, username):
        if row["event"] == "selection" and row["sel_text"]:
            for concept in _match_concepts(row["sel_text"], concepts, row["ci"], row["bid"]):
                add_hit(concept, "selection", row)
        elif row["event"] == "ask" and row["sel_text"]:
            for concept in _match_concepts(row["sel_text"], concepts, row["ci"], row["bid"]):
                add_hit(concept, "ask", row)
        elif row["event"] == "focus_out":
            for concept in _match_concepts("", concepts, row["ci"], row["bid"]):
                add_hit(concept, "idle", row)

    for row in user_store.list_question_completions(cfg, username) or []:
        if not isinstance(row, dict) or row.get("is_correct") is not False:
            continue
        title = str(row.get("question_title") or row.get("title") or "").strip()
        book_id = str(row.get("book_id") or "").strip()
        try:
            chapter_index = int(row.get("chapter_index") or -1)
        except (TypeError, ValueError):
            chapter_index = -1
        for concept in _match_concepts(title, concepts, chapter_index, book_id):
            add_hit(concept, "wrong", {
                "ts": row.get("timestamp") or int(time.time()),
                "bid": book_id,
                "ci": chapter_index,
                "si": "",
                "sel_text": title,
                "event": "wrong_answer",
            })
    return events, aggregate


def _evidence_payload(concept: Dict[str, Any], kind: str, event: Dict[str, Any]) -> Dict[str, Any]:
    source = event.get("sel_text") or event.get("event") or ""
    raw = f"{event.get('ts') or 0}|{event.get('event') or ''}|{event.get('si') or ''}|{kind}|{concept.get('concept_id') or ''}"
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
    payload: Dict[str, Any] = {
        "evidence_id": f"att_{digest}",
        "lecture_id": str(concept.get("lecture_id") or ""),
        "book_id": str(concept.get("book_id") or ""),
        "concept_id": str(concept.get("concept_id") or ""),
        "source_type": "question" if kind == "wrong" else "reading",
        "source_id": f"telemetry:{event.get('ts') or 0}:{event.get('event') or ''}:{event.get('si') or ''}",
        "occurred_at": event.get("ts") or int(time.time()),
        "metadata": {
            "kind": kind,
            "text": str(source)[:160],
            "chapter_name": str(concept.get("chapter_name") or ""),
        },
    }
    if kind == "wrong":
        payload["evidence_type"] = "objective_question"
        payload["score"] = 0.0
    else:
        payload["evidence_type"] = "exposure"
    return payload


def _confusion_card_id(concept_id: str, now: int) -> str:
    day = time.strftime("%Y-%m-%d", time.localtime(now))
    digest = hashlib.sha1(f"{concept_id}|{day}".encode("utf-8")).hexdigest()[:16]
    return f"dec_confusion_{digest}"


def _already_card_written(cfg: Mapping[str, Any], username: str, decision_id: str) -> bool:
    records = user_store.list_learning_records(cfg, username) or []
    return any(
        isinstance(row, dict) and row.get("type") == "agent_decision" and row.get("decision_id") == decision_id
        for row in records
    )


def scan_confusion(cfg: Mapping[str, Any], username: str, *, now: Optional[int] = None) -> Dict[str, Any]:
    """执行一次困惑扫描：归因 → 证据落盘 → 超阈概念写 confusion 卡 + 送决策器。"""
    params = _params(cfg)
    current = int(now or time.time())
    threshold = float(params["hit_threshold"])
    service, concepts = _load_catalog(cfg, username)
    if not concepts:
        return {"ran": False, "reason": "no_concepts", "results": []}

    events, aggregate = _attributed_events(cfg, username, concepts)
    evidence_written = 0
    results: List[Dict[str, Any]] = []
    cards_written: List[Dict[str, Any]] = []

    for concept_id, bucket in aggregate.items():
        concept = bucket["concept"]
        total = float(bucket["total"])
        breakdown = {key: int(value) for key, value in bucket["breakdown"].items() if value}
        hits = sum(breakdown.values())
        result = {
            "concept_id": concept_id,
            "concept": str(concept.get("name") or ""),
            "lecture_id": str(concept.get("lecture_id") or ""),
            "book_id": str(concept.get("book_id") or ""),
            "chapter_index": concept.get("chapter_index"),
            "chapter_name": str(concept.get("chapter_name") or ""),
            "score": round(total, 2),
            "hits": hits,
            "breakdown": breakdown,
            "confused": total >= threshold,
        }
        results.append(result)

        # 证据落盘（幂等：evidence_id 由事件指纹确定）
        concept_events = [item for item in events if item["concept"].get("concept_id") == concept_id]
        for item in concept_events[: max(1, int(params["max_evidence_per_concept"]))]:
            payload = _evidence_payload(concept, item["kind"], item["event"])
            try:
                outcome = service.record_evidence(username, payload)
                if outcome.get("created"):
                    evidence_written += 1
            except Exception as exc:
                log_event("confusion_evidence_failed", "困惑证据写入失败", payload={"user_id": username, "concept_id": concept_id, "error": str(exc)})

        if not result["confused"]:
            continue

        decision_id = _confusion_card_id(concept_id, current)
        if _already_card_written(cfg, username, decision_id):
            continue
        parts = "、".join(f"{_KIND_LABELS.get(kind, kind)}{count}次" for kind, count in breakdown.items())
        record = {
            "type": "agent_decision",
            "decision_id": decision_id,
            "kind": "agent_act",
            "trigger": "confusion_spike",
            "fire": True,
            "unattended": True,
            "timestamp": current,
            "text": f"你在{result['concept']}上卡过 {hits} 次——{parts}。",
            "reason": "困惑信号累计超过阈值。",
            "evidence": [
                {"label": f"{_KIND_LABELS.get(kind, kind)}：{count} 次", "source": "confusion", "conceptId": concept_id}
                for kind, count in breakdown.items()
            ],
            "card": {
                "type": "confusion",
                "concept": result["concept"],
                "hitCount": hits,
                "breakdown": [{"kind": kind, "count": count} for kind, count in breakdown.items()],
            },
            "status": "pending",
            "source": "confusion_scan",
        }
        user_store.append_learning_record(cfg, username, record)
        cards_written.append(record)

        decision = evaluate_decision(
            cfg,
            username,
            trigger="confusion_spike",
            signals={"confusion_spike": {"concept": result["concept"], "hit_count": hits}},
            target={
                "lecture_id": result["lecture_id"],
                "book_id": result["book_id"],
                "chapter_index": result["chapter_index"],
                "chapter_name": result["chapter_name"],
            },
            minutes=10,
            now=current,
        )
        decision_record = dict(decision)
        decision_record["type"] = "agent_decision"
        decision_record["username"] = username
        user_store.append_learning_record(cfg, username, decision_record)
        cards_written.append({"decision": decision_record, "fire": decision["fire"], "suppressed_by": decision["suppressed_by"]})

    results.sort(key=lambda row: row["score"], reverse=True)
    log_event("confusion_scan", "困惑地图扫描完成", payload={"user_id": username, "concepts": len(results), "confused": sum(1 for row in results if row["confused"]), "evidence_written": evidence_written})
    return {
        "ran": True,
        "threshold": threshold,
        "results": results,
        "evidence_written": evidence_written,
        "cards_written": len(cards_written),
        "generated_at": current,
    }
