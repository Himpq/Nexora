"""Build a strict concept catalog from the course knowledge graph."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections.abc import Mapping
from typing import Any, Dict, List, Sequence, Set, Tuple

from .errors import CognitionCatalogError
from .models import ConceptNode


class ConceptCatalogBuilder:
    """Convert course graph nodes into stable concepts with source references."""

    schema_version = 2

    def build_course_catalog(
        self,
        lecture_id: str,
        graph: Mapping[str, Any],
        outline: Mapping[str, Any],
        *,
        book_id: str = "",
        available_book_ids: Sequence[str] = (),
    ) -> List[ConceptNode]:
        normalized_lecture_id = str(lecture_id or "").strip()
        normalized_book_id = str(book_id or "").strip()
        available_ids = {
            str(item or "").strip()
            for item in available_book_ids
            if str(item or "").strip()
        }

        if not normalized_lecture_id:
            raise CognitionCatalogError("lecture_id is required to build a concept catalog.")

        if not isinstance(graph, Mapping):
            raise CognitionCatalogError("Course knowledge graph must be an object.")

        if not isinstance(outline, Mapping):
            raise CognitionCatalogError("Course outline must be an object.")

        chapters = graph.get("chapters")

        if not isinstance(chapters, list) or not chapters:
            raise CognitionCatalogError("Course knowledge graph must contain a non-empty chapters array.")

        section_sources = self._build_section_sources(outline, available_ids)
        concepts: List[ConceptNode] = []
        seen_ids: Set[str] = set()
        seen_section_ids: Set[str] = set()

        for chapter_index, chapter in enumerate(chapters):

            if not isinstance(chapter, Mapping):
                raise CognitionCatalogError(
                    "Course knowledge graph chapter must be an object.",
                    details={"chapter_index": chapter_index},
                )

            section_id = str(chapter.get("section_id") or "").strip()

            if not section_id:
                raise CognitionCatalogError(
                    "Course knowledge graph chapter section_id is required.",
                    details={"chapter_index": chapter_index},
                )

            if section_id in seen_section_ids:
                raise CognitionCatalogError(
                    "Course knowledge graph contains a duplicate section_id.",
                    details={"section_id": section_id},
                )

            seen_section_ids.add(section_id)
            source_refs = section_sources.get(section_id)

            if source_refs is None:
                raise CognitionCatalogError(
                    "Course knowledge graph section is missing from the course outline.",
                    details={"section_id": section_id},
                )

            if normalized_book_id and not any(
                source_book_id == normalized_book_id
                for source_book_id, _source_chapter_name in source_refs
            ):
                continue

            chapter_name = str(chapter.get("name") or "").strip()

            if not chapter_name:
                raise CognitionCatalogError(
                    "Course knowledge graph chapter name is required.",
                    details={"chapter_index": chapter_index, "section_id": section_id},
                )

            chapter_concepts = chapter.get("concepts")

            if not isinstance(chapter_concepts, list):
                raise CognitionCatalogError(
                    "Course knowledge graph chapter concepts must be an array.",
                    details={"chapter_index": chapter_index, "section_id": section_id},
                )

            self._append_nodes(
                concepts,
                seen_ids,
                lecture_id=normalized_lecture_id,
                book_id=normalized_book_id or self._single_source_book_id(source_refs),
                section_id=section_id,
                chapter_index=chapter_index,
                chapter_name=chapter_name,
                source_refs=source_refs,
                rows=chapter_concepts,
                parent_path=(),
            )

        if not concepts:
            if normalized_book_id:
                raise CognitionCatalogError(
                    "The course knowledge graph has no concepts sourced from the requested book.",
                    details={"book_id": normalized_book_id},
                )

            raise CognitionCatalogError("Course knowledge graph does not contain any concepts.")

        return concepts

    def _build_section_sources(
        self,
        outline: Mapping[str, Any],
        available_book_ids: Set[str],
    ) -> Dict[str, Tuple[Tuple[str, str], ...]]:
        sections = outline.get("sections")

        if not isinstance(sections, list) or not sections:
            raise CognitionCatalogError("Course outline must contain a non-empty sections array.")

        section_sources: Dict[str, Tuple[Tuple[str, str], ...]] = {}

        for section_index, section in enumerate(sections):

            if not isinstance(section, Mapping):
                raise CognitionCatalogError(
                    "Course outline section must be an object.",
                    details={"section_index": section_index},
                )

            section_id = str(section.get("id") or "").strip()

            if not section_id:
                raise CognitionCatalogError(
                    "Course outline section id is required.",
                    details={"section_index": section_index},
                )

            if section_id in section_sources:
                raise CognitionCatalogError(
                    "Course outline contains a duplicate section id.",
                    details={"section_id": section_id},
                )

            raw_sources = section.get("sources")

            if not isinstance(raw_sources, list) or not raw_sources:
                raise CognitionCatalogError(
                    "Course outline section must contain source references.",
                    details={"section_id": section_id},
                )

            refs: List[Tuple[str, str]] = []
            seen_refs: Set[Tuple[str, str]] = set()

            for source_index, source in enumerate(raw_sources):

                if not isinstance(source, Mapping):
                    raise CognitionCatalogError(
                        "Course outline source reference must be an object.",
                        details={"section_id": section_id, "source_index": source_index},
                    )

                source_book_id = str(source.get("book_id") or "").strip()
                source_chapter_name = str(source.get("chapter_name") or "").strip()

                if not source_book_id or not source_chapter_name:
                    raise CognitionCatalogError(
                        "Course outline source reference requires book_id and chapter_name.",
                        details={"section_id": section_id, "source_index": source_index},
                    )

                if available_book_ids and source_book_id not in available_book_ids:
                    raise CognitionCatalogError(
                        "Course outline references a book that does not exist in the lecture.",
                        details={"section_id": section_id, "book_id": source_book_id},
                    )

                ref = (source_book_id, source_chapter_name)

                if ref in seen_refs:
                    continue

                seen_refs.add(ref)
                refs.append(ref)

            if not refs:
                raise CognitionCatalogError(
                    "Course outline section has no valid source references.",
                    details={"section_id": section_id},
                )

            section_sources[section_id] = tuple(refs)

        return section_sources

    def _append_nodes(
        self,
        output: List[ConceptNode],
        seen_ids: Set[str],
        *,
        lecture_id: str,
        book_id: str,
        section_id: str,
        chapter_index: int,
        chapter_name: str,
        source_refs: Tuple[Tuple[str, str], ...],
        rows: Sequence[Any],
        parent_path: Tuple[str, ...],
    ) -> None:
        for concept_index, row in enumerate(rows):

            if not isinstance(row, Mapping):
                raise CognitionCatalogError(
                    "Course knowledge graph concept must be an object.",
                    details={
                        "section_id": section_id,
                        "chapter_index": chapter_index,
                        "concept_index": concept_index,
                        "parent_path": list(parent_path),
                    },
                )

            name = str(row.get("name") or "").strip()

            if not name:
                raise CognitionCatalogError(
                    "Course knowledge graph concept name is required.",
                    details={
                        "section_id": section_id,
                        "chapter_index": chapter_index,
                        "concept_index": concept_index,
                        "parent_path": list(parent_path),
                    },
                )

            path = parent_path + (name,)
            concept_id = self._concept_id(lecture_id, section_id, path)

            if concept_id in seen_ids:
                raise CognitionCatalogError(
                    "Course knowledge graph contains a duplicate concept path.",
                    details={"section_id": section_id, "path": list(path)},
                )

            seen_ids.add(concept_id)
            output.append(
                ConceptNode(
                    concept_id=concept_id,
                    lecture_id=lecture_id,
                    book_id=book_id,
                    section_id=section_id,
                    chapter_index=chapter_index,
                    chapter_name=chapter_name,
                    path=path,
                    name=name,
                    detail=str(row.get("detail") or "").strip(),
                    source_refs=source_refs,
                )
            )

            children = row.get("children")

            if children is None:
                continue

            if not isinstance(children, list):
                raise CognitionCatalogError(
                    "Course knowledge graph concept children must be an array.",
                    details={"section_id": section_id, "path": list(path)},
                )

            self._append_nodes(
                output,
                seen_ids,
                lecture_id=lecture_id,
                book_id=book_id,
                section_id=section_id,
                chapter_index=chapter_index,
                chapter_name=chapter_name,
                source_refs=source_refs,
                rows=children,
                parent_path=path,
            )

    def _single_source_book_id(self, source_refs: Tuple[Tuple[str, str], ...]) -> str:
        source_book_ids = {book_id for book_id, _chapter_name in source_refs}
        return next(iter(source_book_ids)) if len(source_book_ids) == 1 else ""

    def _concept_id(
        self,
        lecture_id: str,
        section_id: str,
        path: Sequence[str],
    ) -> str:
        canonical = {
            "lecture_id": lecture_id,
            "section_id": section_id,
            "path": [self._normalize_key(item) for item in path],
        }
        raw = json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return "cx_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]

    def _normalize_key(self, value: str) -> str:
        normalized = unicodedata.normalize("NFKC", str(value or "")).strip().casefold()
        return re.sub(r"\s+", " ", normalized)
