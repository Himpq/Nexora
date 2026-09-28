"""答题结算 → 认知证据（今日复习 / 闭环 flow 两条路径共用）。

语义（2026-09-19 用户确认）：「看答案」不是上报点，上报的是答对 / 答错；
未作答直接看答案按错误算，但用更低权重的 `revealed_answer` 证据类型，
让掌握度既反映「没会」也不把一次偷看当成一次正式失分。

幂等：同一 (user, quiz_id, question_id) 只产生一条证据；重复结算不改写第一次的结果。
概念绑定：题目自带 related_concept_id → 题库记录的 concept_id → 概念名出现在题干（先限本章，再放宽到本书）。
匹配不到就跳过并留事件日志，不捏造概念。
"""

from __future__ import annotations

import hashlib
import re
import time
from typing import Any, Dict, List, Mapping, Optional, Tuple

from core import user as user_store
from core.runlog import log_event

from .attribution import _load_catalog, _match_concepts
from .errors import CognitionConflictError, CognitionError

_OBJECTIVE_TYPES = {"choice", "single_choice", "multiple_choice", "选择题", "单选题", "多选题"}


def review_evidence_id(user_id: str, quiz_id: str, question_id: str, concept_id: str = "", attempt_id: str = "") -> str:
    """幂等键 = (user, quiz, question, concept[, attempt])。带 concept 是为了图谱重建：旧概念 id 失效后，
    同一题重新绑定到新概念要能写出新行，而旧行作为孤儿被 overview 忽略。
    带 attempt 是为了「再练一次」：同一题组的新一轮练习是新的证据，不被上一轮的结果挡住。"""
    raw = f"{str(user_id or '').strip()}|{str(quiz_id or '').strip()}|{str(question_id or '').strip()}"
    if concept_id:
        raw += f"|{str(concept_id).strip()}"
    if attempt_id:
        raw += f"|{str(attempt_id).strip()}"
    return "ev_rv_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def completion_id_for(quiz_id: str, question_id: str, attempt_id: str = "") -> str:
    """一次练习（attempt）内同一题只作数一次；不同 attempt 各自入账。没有 attempt 的旧调用保持原键。"""
    raw = f"{str(quiz_id or '').strip()}|{str(question_id or '').strip()}"
    if attempt_id:
        raw += f"|{str(attempt_id).strip()}"
    return "qc_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]


def _evidence_type(question: Mapping[str, Any], *, revealed_without_answer: bool) -> str:
    if revealed_without_answer:
        return "revealed_answer"
    question_type = str(question.get("type") or question.get("question_type") or "").strip().lower()
    options = question.get("options") or question.get("question_options") or []
    if question_type in _OBJECTIVE_TYPES or (isinstance(options, list) and len(options) >= 2):
        return "objective_question"
    return "constructed_response"


def _bank_concept_ids(cfg: Mapping[str, Any], username: str) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    try:
        rows = user_store.list_question_bank_items(dict(cfg), username) or []
    except Exception:
        return mapping
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        question_id = str(row.get("question_id") or "").strip()
        concept_id = str(row.get("concept_id") or "").strip()
        if not concept_id:
            nested = row.get("question") if isinstance(row.get("question"), Mapping) else {}
            concept_id = str(nested.get("related_concept_id") or "").strip()
        if question_id and concept_id:
            mapping[question_id] = concept_id
    return mapping


def resolve_concept(
    cfg: Mapping[str, Any],
    username: str,
    question: Mapping[str, Any],
    *,
    question_id: str,
    lecture_id: str,
    book_id: str,
    chapter_index: int,
    concepts: Optional[List[Dict[str, Any]]] = None,
    chapter_name: str = "",
) -> Tuple[Optional[Dict[str, Any]], str]:
    """返回 (概念, 绑定方式)。概念为 None 表示无法绑定。"""
    if concepts is None:
        try:
            _, concepts = _load_catalog(cfg, username)
        except Exception:
            concepts = []
    by_id = {str(row.get("concept_id") or ""): row for row in concepts if isinstance(row, Mapping)}
    scoped = [row for row in concepts if not lecture_id or str(row.get("lecture_id") or "") == lecture_id]

    bound = str(question.get("related_concept_id") or question.get("concept_id") or "").strip()
    if bound and bound in by_id:
        return by_id[bound], "question"
    bank = _bank_concept_ids(cfg, username).get(question_id, "")
    if bank and bank in by_id:
        return by_id[bank], "question_bank"

    title = " ".join(str(question.get(key) or "") for key in ("title", "content"))
    matched = _match_concepts(title, scoped, chapter_index, book_id) if title.strip() else []
    if matched:
        return matched[0], "title_chapter"
    matched = _match_concepts(title, scoped, -1, book_id) if title.strip() else []
    if matched:
        return matched[0], "title_book"
    # 大纲 section 的 sources[].chapter_name 就是教材原章名，概念目录把它带在 source_refs 上：
    # (book_id, 教材章名) 精确对上 → 章确定，章内按题干词重叠选概念。这是多教材课程最可靠的一级。
    by_source = _source_ref_candidates(scoped, book_id, chapter_name)
    if by_source:
        return _pick_by_terms(title, by_source), "source_ref"
    # 章名模糊兜底：题目章名与图谱章名最长公共子串 ≥4。置信度调低，供下游打折。
    fallback = _chapter_fallback(title, scoped, chapter_name)
    if fallback is not None:
        return fallback, "chapter_name"
    return None, ""


def _normalize(text: str) -> str:
    return re.sub(r"\s+", "", str(text or "")).casefold()


def _terms(text: str) -> set:
    normalized = _normalize(text)
    tokens = set(re.findall(r"[a-z0-9_]+", normalized))
    for word in re.findall(r"[一-鿿]+", normalized):
        tokens.update(word[i:i + 2] for i in range(max(1, len(word) - 1)))
    return tokens


def _pick_by_terms(title: str, candidates: List[Dict[str, Any]]) -> Dict[str, Any]:
    question_terms = _terms(title)
    return sorted(
        candidates,
        key=lambda row: len(question_terms & _terms(f"{row.get('name') or ''} {row.get('detail') or ''}")),
        reverse=True,
    )[0]


def _source_ref_candidates(concepts: List[Dict[str, Any]], book_id: str, chapter_name: str) -> List[Dict[str, Any]]:
    wanted = _normalize(chapter_name)
    if not wanted or not book_id:
        return []
    exact: List[Dict[str, Any]] = []
    loose: List[Dict[str, Any]] = []
    for row in concepts:
        for ref in row.get("source_refs") or []:
            if not isinstance(ref, Mapping) or str(ref.get("book_id") or "") != book_id:
                continue
            name = _normalize(ref.get("chapter_name"))
            if not name:
                continue
            if name == wanted:
                exact.append(row)
                break
            if len(wanted) >= 4 and (wanted in name or name in wanted):
                loose.append(row)
                break
    return exact or loose


def _chapter_similarity(left: str, right: str) -> int:
    a, b = _normalize(left), _normalize(right)
    if not a or not b:
        return 0
    if a in b or b in a:
        return min(len(a), len(b))
    best = 0
    for i in range(len(a)):
        for j in range(len(b)):
            k = 0
            while i + k < len(a) and j + k < len(b) and a[i + k] == b[j + k]:
                k += 1
            best = max(best, k)
    return best


def _chapter_fallback(title: str, concepts: List[Dict[str, Any]], chapter_name: str) -> Optional[Dict[str, Any]]:
    if not concepts or not str(chapter_name or "").strip():
        return None
    by_chapter: Dict[str, List[Dict[str, Any]]] = {}
    for row in concepts:
        by_chapter.setdefault(str(row.get("chapter_name") or ""), []).append(row)
    ranked = sorted(((_chapter_similarity(name, chapter_name), name) for name in by_chapter), reverse=True)
    if not ranked or ranked[0][0] < 4:
        return None
    candidates = by_chapter[ranked[0][1]]
    return _pick_by_terms(title, candidates) if candidates else None


def record_review_evidence(
    cfg: Mapping[str, Any],
    username: str,
    *,
    quiz_id: str,
    question: Mapping[str, Any],
    question_id: str,
    lecture_id: str,
    book_id: str,
    chapter_index: int,
    chapter_name: str,
    is_correct: bool,
    revealed_without_answer: bool = False,
    occurred_at: Optional[int] = None,
    concepts: Optional[List[Dict[str, Any]]] = None,
    source_kind: str = "review",
    attempt_id: str = "",
) -> Dict[str, Any]:
    """一题一证据（按 attempt 区分轮次）。写不进认知层不影响判分（返回 recorded=False + reason）。"""
    from .service import CognitionService

    timestamp = int(occurred_at or time.time())
    concept, binding = resolve_concept(
        cfg, username, question,
        question_id=question_id, lecture_id=lecture_id, book_id=book_id,
        chapter_index=chapter_index, concepts=concepts, chapter_name=chapter_name,
    )
    base = {"quiz_id": quiz_id, "question_id": question_id, "user_id": username}
    if concept is None:
        log_event("review_evidence_skipped", "答题无法绑定概念，未写入认知证据",
                  payload={**base, "reason": "concept_unbound", "lecture_id": lecture_id})
        return {"recorded": False, "reason": "concept_unbound"}

    evidence_type = _evidence_type(question, revealed_without_answer=revealed_without_answer)
    attempt = str(attempt_id or "").strip()
    payload = {
        "evidence_id": review_evidence_id(username, quiz_id, question_id, str(concept.get("concept_id") or ""), attempt),
        "lecture_id": str(concept.get("lecture_id") or lecture_id),
        "book_id": str(concept.get("book_id") or book_id),
        "concept_id": str(concept.get("concept_id") or ""),
        "evidence_type": evidence_type,
        "source_type": "review",
        "source_id": (f"{quiz_id}:{question_id}" + (f":{attempt}" if attempt else ""))[:200],
        "occurred_at": timestamp,
        "score": 1.0 if is_correct else 0.0,
        "confidence": 0.6 if (revealed_without_answer or binding == "chapter_name") else (0.8 if binding == "source_ref" else 1.0),
        "metadata": {
            "question_id": question_id,
            "chapter_name": str(chapter_name or "")[:160],
            "is_correct": bool(is_correct),
            "revealed_without_answer": bool(revealed_without_answer),
            "binding": binding,
            "source_kind": source_kind,
            "attempt_id": attempt,
        },
    }
    try:
        result = CognitionService(cfg).record_evidence(username, payload)
    except CognitionConflictError:
        # 同一题第二次结算：第一次的结果作数，不改写。
        return {"recorded": True, "created": False, "reason": "already_recorded", "concept_id": payload["concept_id"]}
    except CognitionError as exc:
        log_event("review_evidence_failed", "答题已判分，但认知证据写入失败",
                  payload={**base, "concept_id": payload["concept_id"], "error": str(exc)})
        return {"recorded": False, "reason": "cognition_write_failed", "message": str(exc)}
    return {
        "recorded": True,
        "created": bool(result.get("created")),
        "concept_id": payload["concept_id"],
        "evidence_type": evidence_type,
        "binding": binding,
    }


def rebind_review_evidence(cfg: Mapping[str, Any], username: str, *, lecture_id: str = "") -> Dict[str, Any]:
    """把已有的答题记录重新绑定到当前图谱（图谱重建后调用；也可用于补写历史遗漏）。

    只处理带 quiz_id/question_id 的 question_completions（09-19 之后的记录）；题目从 chapter_quizzes 里取。
    幂等：同一 (question, concept) 已有证据则不重复。
    """
    from core.booksproc.chapter_quiz import load_quiz_by_id

    completions = [row for row in user_store.list_question_completions(dict(cfg), username) or []
                   if isinstance(row, Mapping) and row.get("quiz_id") and row.get("question_id")
                   and (not lecture_id or str(row.get("lecture_id") or "") == lecture_id)]
    try:
        _, concepts = _load_catalog(cfg, username)
    except Exception:
        concepts = []
    quizzes: Dict[str, Dict[str, Any]] = {}
    stats = {"completions": len(completions), "recorded": 0, "created": 0, "skipped": 0, "bindings": {}}
    for row in completions:
        quiz_id = str(row.get("quiz_id"))
        if quiz_id not in quizzes:
            try:
                quizzes[quiz_id] = load_quiz_by_id(cfg, username, quiz_id) or {}
            except Exception:
                quizzes[quiz_id] = {}
        questions = quizzes[quiz_id].get("questions") if isinstance(quizzes[quiz_id].get("questions"), list) else []
        question_id = str(row.get("question_id"))
        question = next((q for index, q in enumerate(questions) if isinstance(q, Mapping)
                         and str(q.get("source_id") or q.get("question_id") or f"q{index}") == question_id), None)
        if question is None:
            stats["skipped"] += 1
            continue
        try:
            chapter_index = int(row.get("chapter_index") if row.get("chapter_index") is not None else -1)
        except (TypeError, ValueError):
            chapter_index = -1
        outcome = record_review_evidence(
            cfg, username, quiz_id=quiz_id, question=question, question_id=question_id,
            lecture_id=str(row.get("lecture_id") or ""), book_id=str(row.get("book_id") or ""),
            chapter_index=chapter_index, chapter_name=str(row.get("chapter_name") or ""),
            is_correct=bool(row.get("is_correct")), revealed_without_answer=bool(row.get("revealed_without_answer")),
            occurred_at=int(row.get("timestamp") or 0) or None, concepts=concepts, source_kind="rebind",
            attempt_id=str(row.get("attempt_id") or ""),
        )
        if outcome.get("recorded"):
            stats["recorded"] += 1
            if outcome.get("created"):
                stats["created"] += 1
            binding = str(outcome.get("binding") or "existing")
            stats["bindings"][binding] = stats["bindings"].get(binding, 0) + 1
        else:
            stats["skipped"] += 1
    log_event("review_evidence_rebound", "答题记录重新绑定到当前图谱", payload={"user_id": username, "lecture_id": lecture_id, **stats})
    return stats
