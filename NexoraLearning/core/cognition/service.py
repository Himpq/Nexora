"""Application service joining knowledge graphs, evidence, and state."""

from __future__ import annotations

import time
from collections import Counter, defaultdict
from collections.abc import Mapping
from typing import Any, Dict, List, Optional

from core.knowledge_graph import load_cached_graph
from core.lectures import get_book, get_lecture, list_books

from .catalog import ConceptCatalogBuilder
from .engine import CognitiveStateEngine
from .errors import CognitionCatalogError, CognitionNotFoundError, CognitionValidationError
from .models import CognitiveEvidence, ConceptNode
from .storage import CognitiveEvidenceStore


class CognitionService:
    """Provide strict catalog, evidence, and overview operations."""

    def __init__(self, cfg: Mapping[str, Any]) -> None:
        self._cfg = dict(cfg or {})
        self._catalog_builder = ConceptCatalogBuilder()
        self._store = CognitiveEvidenceStore(self._cfg)
        self._engine = CognitiveStateEngine()

    def get_catalog(self, lecture_id: str, *, book_id: str = "") -> Dict[str, Any]:
        normalized_lecture_id = str(lecture_id or "").strip()
        normalized_book_id = str(book_id or "").strip()

        if not normalized_lecture_id:
            raise CognitionValidationError("lecture_id is required.")

        lecture = get_lecture(self._cfg, normalized_lecture_id)

        if lecture is None:
            raise CognitionNotFoundError(
                "Lecture not found.",
                details={"lecture_id": normalized_lecture_id},
            )

        if normalized_book_id:
            book = get_book(self._cfg, normalized_lecture_id, normalized_book_id)

            if book is None:
                raise CognitionNotFoundError(
                    "Book not found.",
                    details={"lecture_id": normalized_lecture_id, "book_id": normalized_book_id},
                )

            selected_books = [book]
        else:
            selected_books = list_books(self._cfg, normalized_lecture_id)

        if not selected_books:
            raise CognitionCatalogError(
                "Lecture does not contain any books.",
                details={"lecture_id": normalized_lecture_id},
            )

        concepts: List[ConceptNode] = []
        missing_graph_book_ids: List[str] = []

        for book in selected_books:
            current_book_id = str(book.get("id") or "").strip()

            if not current_book_id:
                raise CognitionCatalogError(
                    "Book metadata is missing id.",
                    details={"lecture_id": normalized_lecture_id},
                )

            graph = load_cached_graph(self._cfg, normalized_lecture_id, current_book_id)

            if graph is None:
                missing_graph_book_ids.append(current_book_id)
                continue

            concepts.extend(
                self._catalog_builder.build_book_catalog(
                    normalized_lecture_id,
                    current_book_id,
                    graph,
                )
            )

        if missing_graph_book_ids:
            raise CognitionCatalogError(
                "Knowledge graph must be generated before cognitive state can be calculated.",
                details={
                    "lecture_id": normalized_lecture_id,
                    "missing_graph_book_ids": missing_graph_book_ids,
                },
            )

        return {
            "schema_version": self._catalog_builder.schema_version,
            "lecture": {
                "id": normalized_lecture_id,
                "title": str(lecture.get("title") or "").strip(),
            },
            "book_ids": [str(book.get("id") or "").strip() for book in selected_books],
            "concept_count": len(concepts),
            "concepts": [concept.to_dict() for concept in concepts],
        }

    def record_evidence(self, user_id: str, payload: Mapping[str, Any]) -> Dict[str, Any]:
        evidence = CognitiveEvidence.from_payload(user_id, payload)
        catalog = self.get_catalog(evidence.lecture_id, book_id=evidence.book_id)
        concept_ids = {str(row.get("concept_id") or "") for row in catalog["concepts"]}

        if evidence.concept_id not in concept_ids:
            raise CognitionValidationError(
                "concept_id does not exist in the current knowledge graph catalog.",
                details={
                    "lecture_id": evidence.lecture_id,
                    "book_id": evidence.book_id,
                    "concept_id": evidence.concept_id,
                },
            )

        stored, created = self._store.append(evidence)
        return {"created": created, "evidence": stored.to_dict()}

    def list_evidence(
        self,
        user_id: str,
        *,
        lecture_id: str,
        book_id: str = "",
        concept_id: str = "",
        limit: int = 200,
    ) -> Dict[str, Any]:
        catalog = self.get_catalog(lecture_id, book_id=book_id)
        catalog_concept_ids = {str(row.get("concept_id") or "") for row in catalog["concepts"]}
        normalized_concept_id = str(concept_id or "").strip()

        if normalized_concept_id and normalized_concept_id not in catalog_concept_ids:
            raise CognitionValidationError(
                "concept_id does not exist in the requested catalog.",
                details={"concept_id": normalized_concept_id},
            )

        rows = self._store.list(
            user_id,
            lecture_id=str(lecture_id or "").strip(),
            book_id=str(book_id or "").strip(),
            concept_id=normalized_concept_id,
            limit=limit,
        )
        return {
            "lecture_id": str(lecture_id or "").strip(),
            "book_id": str(book_id or "").strip(),
            "concept_id": normalized_concept_id,
            "count": len(rows),
            "items": [row.to_dict() for row in rows],
        }

    def get_overview(
        self,
        user_id: str,
        *,
        lecture_id: str,
        book_id: str = "",
        now: Optional[int] = None,
    ) -> Dict[str, Any]:
        catalog = self.get_catalog(lecture_id, book_id=book_id)
        concept_nodes = [self._concept_from_dict(row) for row in catalog["concepts"]]
        evidence_rows = self._store.list(
            user_id,
            lecture_id=str(lecture_id or "").strip(),
            book_id=str(book_id or "").strip(),
        )
        catalog_ids = {concept.concept_id for concept in concept_nodes}
        orphan_ids = sorted({row.concept_id for row in evidence_rows if row.concept_id not in catalog_ids})

        if orphan_ids:
            raise CognitionCatalogError(
                "Stored evidence references concepts missing from the current knowledge graph.",
                details={"orphan_concept_ids": orphan_ids},
            )

        grouped: Dict[str, List[CognitiveEvidence]] = defaultdict(list)

        for row in evidence_rows:
            grouped[row.concept_id].append(row)

        calculated_at = int(now if now is not None else time.time())
        states = [
            self._engine.compute(concept, grouped.get(concept.concept_id, []), now=calculated_at)
            for concept in concept_nodes
        ]
        status_counts = Counter(state.status for state in states)
        due_review_count = sum(
            1
            for state in states
            if state.next_review_at is not None and state.next_review_at <= calculated_at
        )

        return {
            "schema_version": 1,
            "engine_version": self._engine.version,
            "generated_at": calculated_at,
            "user_id": str(user_id or "").strip(),
            "lecture": catalog["lecture"],
            "book_ids": catalog["book_ids"],
            "summary": {
                "concept_count": len(states),
                "evidence_count": len(evidence_rows),
                "due_review_count": due_review_count,
                "status_counts": {
                    status: int(status_counts.get(status, 0))
                    for status in ("unknown", "unverified", "developing", "stable", "at_risk")
                },
            },
            "states": [state.to_dict() for state in states],
        }

    def _concept_from_dict(self, payload: Mapping[str, Any]) -> ConceptNode:
        path = payload.get("path")

        if not isinstance(path, list) or not path:
            raise CognitionCatalogError(
                "Catalog concept path is invalid.",
                details={"concept_id": str(payload.get("concept_id") or "")},
            )

        return ConceptNode(
            concept_id=str(payload.get("concept_id") or "").strip(),
            lecture_id=str(payload.get("lecture_id") or "").strip(),
            book_id=str(payload.get("book_id") or "").strip(),
            chapter_index=int(payload.get("chapter_index")),
            chapter_name=str(payload.get("chapter_name") or "").strip(),
            path=tuple(str(item or "").strip() for item in path),
            name=str(payload.get("name") or "").strip(),
            detail=str(payload.get("detail") or "").strip(),
        )
