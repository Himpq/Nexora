"""Build a strict, stable concept catalog from cached knowledge graphs."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections.abc import Mapping
from typing import Any, Dict, List, Sequence, Tuple

from .errors import CognitionCatalogError
from .models import ConceptNode


class ConceptCatalogBuilder:
    """Convert graph nodes into stable IDs without guessing malformed content."""

    schema_version = 1

    def build_book_catalog(
        self,
        lecture_id: str,
        book_id: str,
        graph: Mapping[str, Any],
    ) -> List[ConceptNode]:
        normalized_lecture_id = str(lecture_id or "").strip()
        normalized_book_id = str(book_id or "").strip()

        if not normalized_lecture_id or not normalized_book_id:
            raise CognitionCatalogError("lecture_id and book_id are required to build a concept catalog.")

        if not isinstance(graph, Mapping):
            raise CognitionCatalogError("Knowledge graph must be an object.")

        chapters = graph.get("chapters")

        if not isinstance(chapters, list) or not chapters:
            raise CognitionCatalogError("Knowledge graph must contain a non-empty chapters array.")

        concepts: List[ConceptNode] = []
        seen_ids = set()

        for chapter_index, chapter in enumerate(chapters):
            if not isinstance(chapter, Mapping):
                raise CognitionCatalogError(
                    "Knowledge graph chapter must be an object.",
                    details={"chapter_index": chapter_index},
                )

            chapter_name = str(chapter.get("name") or "").strip()

            if not chapter_name:
                raise CognitionCatalogError(
                    "Knowledge graph chapter name is required.",
                    details={"chapter_index": chapter_index},
                )

            chapter_concepts = chapter.get("concepts")

            if not isinstance(chapter_concepts, list):
                raise CognitionCatalogError(
                    "Knowledge graph chapter concepts must be an array.",
                    details={"chapter_index": chapter_index, "chapter_name": chapter_name},
                )

            self._append_nodes(
                concepts,
                seen_ids,
                lecture_id=normalized_lecture_id,
                book_id=normalized_book_id,
                chapter_index=chapter_index,
                chapter_name=chapter_name,
                rows=chapter_concepts,
                parent_path=(),
            )

        if not concepts:
            raise CognitionCatalogError("Knowledge graph does not contain any concepts.")

        return concepts

    def _append_nodes(
        self,
        output: List[ConceptNode],
        seen_ids: set[str],
        *,
        lecture_id: str,
        book_id: str,
        chapter_index: int,
        chapter_name: str,
        rows: Sequence[Any],
        parent_path: Tuple[str, ...],
    ) -> None:
        for concept_index, row in enumerate(rows):
            if not isinstance(row, Mapping):
                raise CognitionCatalogError(
                    "Knowledge graph concept must be an object.",
                    details={
                        "chapter_index": chapter_index,
                        "concept_index": concept_index,
                        "parent_path": list(parent_path),
                    },
                )

            name = str(row.get("name") or "").strip()

            if not name:
                raise CognitionCatalogError(
                    "Knowledge graph concept name is required.",
                    details={
                        "chapter_index": chapter_index,
                        "concept_index": concept_index,
                        "parent_path": list(parent_path),
                    },
                )

            path = parent_path + (name,)
            concept_id = self._concept_id(
                lecture_id,
                book_id,
                chapter_name,
                path,
            )

            if concept_id in seen_ids:
                raise CognitionCatalogError(
                    "Knowledge graph contains a duplicate concept path.",
                    details={
                        "chapter_index": chapter_index,
                        "chapter_name": chapter_name,
                        "path": list(path),
                    },
                )

            seen_ids.add(concept_id)
            output.append(
                ConceptNode(
                    concept_id=concept_id,
                    lecture_id=lecture_id,
                    book_id=book_id,
                    chapter_index=chapter_index,
                    chapter_name=chapter_name,
                    path=path,
                    name=name,
                    detail=str(row.get("detail") or "").strip(),
                )
            )

            children = row.get("children")

            if children is None:
                continue

            if not isinstance(children, list):
                raise CognitionCatalogError(
                    "Knowledge graph concept children must be an array.",
                    details={"chapter_index": chapter_index, "path": list(path)},
                )

            self._append_nodes(
                output,
                seen_ids,
                lecture_id=lecture_id,
                book_id=book_id,
                chapter_index=chapter_index,
                chapter_name=chapter_name,
                rows=children,
                parent_path=path,
            )

    def _concept_id(
        self,
        lecture_id: str,
        book_id: str,
        chapter_name: str,
        path: Sequence[str],
    ) -> str:
        canonical = {
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_name": self._normalize_key(chapter_name),
            "path": [self._normalize_key(item) for item in path],
        }
        raw = json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return "cx_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]

    def _normalize_key(self, value: str) -> str:
        normalized = unicodedata.normalize("NFKC", str(value or "")).strip().casefold()
        return re.sub(r"\s+", " ", normalized)
