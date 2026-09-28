"""Read-only learner overlays on the shared textbook graph and chapter index."""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, List, Mapping

from core.cognition.errors import CognitionCatalogError
from core.cognition.service import CognitionService
from core.knowledge_graph import load_cached_graph
from core.lectures import get_book, list_books
from core.user.learning_progress import compute_user_lecture_progress

_RELATION_TYPES = {"prerequisite", "related", "contrast", "applies", "extends", "part_of"}


def _mindmap_relations(cfg: Mapping[str, Any], lecture_id: str) -> List[Dict[str, str]]:
    """课程级 mindmap.json 的横向关联（扁平 edges 里 type != hierarchy），按概念名输出。

    书级 knowledge_graph.json 的 relations 经常为空，而课程级 mindmap 有边；
    图谱页要画边，就从这里补。节点 label 即概念名，与 chapters[].concepts[].name 同源。
    """
    from core.booksproc.mindmap import load_mindmap

    try:
        mindmap = load_mindmap(cfg, lecture_id)
    except Exception:
        return []
    if not isinstance(mindmap, Mapping):
        return []
    rows: List[Dict[str, str]] = []
    nodes = mindmap.get("nodes")
    edges = mindmap.get("edges")
    if isinstance(nodes, list) and isinstance(edges, list):
        label = {str(node.get("id") or ""): str(node.get("label") or "") for node in nodes if isinstance(node, Mapping)}
        for edge in edges:
            if not isinstance(edge, Mapping):
                continue
            kind = str(edge.get("type") or "").strip()
            if kind == "hierarchy" or not kind:
                continue
            src, dst = label.get(str(edge.get("source") or "")), label.get(str(edge.get("target") or ""))
            if src and dst:
                rows.append({"from": src, "to": dst, "type": kind, "label": str(edge.get("label") or "")})
        return rows
    relations = mindmap.get("relations")
    if isinstance(relations, list):
        for rel in relations:
            if not isinstance(rel, Mapping):
                continue
            src, dst, kind = str(rel.get("from") or ""), str(rel.get("to") or ""), str(rel.get("type") or "")
            if src and dst and kind:
                rows.append({"from": src, "to": dst, "type": kind, "label": ""})
    return rows


def build_learning_graph(cfg: Mapping[str, Any], username: str, lecture_id: str, book_id: str) -> Dict[str, Any]:
    """Never store a student's reading or mastery in the shared graph cache."""
    book = get_book(cfg, lecture_id, book_id)
    if book is None:
        raise ValueError("book not found in this lecture")
    cached = load_cached_graph(cfg, lecture_id, book_id)
    progress = compute_user_lecture_progress(username, lecture_id, [book], cfg=cfg)
    try:
        overview = CognitionService(cfg).get_overview(username, lecture_id=lecture_id, book_id=book_id)
        states = overview.get("states") or []
    except CognitionCatalogError:
        # A learner can read a textbook before the model-generated concept map.
        states = []
    graph = deepcopy(cached) if cached else {"chapters": [], "relations": []}
    cached_chapters = graph.get("chapters") or []
    chapters = []
    for position in progress["chapters"]:
        candidates = [row for row in cached_chapters if row.get("name") == position["chapter_name"]]
        chapter = deepcopy(candidates[0]) if len(candidates) == 1 else {"name": position["chapter_name"], "summary": "", "concepts": []}
        chapter_states = [state for state in states if state.get("concept", {}).get("book_id") == book_id
                          and state.get("concept", {}).get("chapter_index") == position["chapter_index"]]
        exposed = position["read_chars"] > 0 or position["completed"]
        if chapter_states:
            chapter["concepts"] = [{
                "name": state["concept"]["name"], "detail": state["concept"].get("detail", ""),
                "concept_id": state["concept"]["concept_id"], "mastery": state.get("mastery"),
                "status": "unverified" if exposed and state.get("mastery") is None else state.get("status", "unknown"),
                "assessed_count": state.get("assessed_count", 0),
            } for state in chapter_states]
        else:
            for concept in chapter.get("concepts") or []:
                concept.update(mastery=None, status="unverified" if exposed else "unknown", assessed_count=0)
        chapter.update(chapter_index=position["chapter_index"], reading_percent=position["reading_percent"],
                       completed=position["completed"], reading_seconds=position["reading_seconds"])
        chapters.append(chapter)
    graph["chapters"] = chapters
    # 边：书级缓存没有就用课程级 mindmap 的横向关联，只保留两端都在本书概念里的。
    existing = graph.get("relations") if isinstance(graph.get("relations"), list) else []
    if not existing:
        names = {str(concept.get("name") or "") for chapter in chapters for concept in (chapter.get("concepts") or [])}
        graph["relations"] = [rel for rel in _mindmap_relations(cfg, lecture_id) if rel["from"] in names and rel["to"] in names]
    # 三个口径同屏：本书（这份 graph）、本课程（所有教材汇总）。
    graph["reading_progress_percent"] = progress["reading_progress"]
    graph["book_reading_progress_percent"] = progress["reading_progress"]
    try:
        course = compute_user_lecture_progress(username, lecture_id, list_books(cfg, lecture_id), cfg=cfg)
        graph["course_reading_progress_percent"] = course["reading_progress"]
    except Exception:
        graph["course_reading_progress_percent"] = progress["reading_progress"]
    graph["concepts_available"] = any(chapter.get("concepts") for chapter in chapters)
    return {"graph": graph, "cached": cached is not None}
