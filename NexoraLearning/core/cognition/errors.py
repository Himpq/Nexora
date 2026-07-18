"""Explicit cognition-domain errors used by services and HTTP routes."""

from __future__ import annotations

from typing import Any, Dict, Optional


class CognitionError(RuntimeError):
    """Base error carrying a stable machine-readable code."""

    code = "cognition_error"

    def __init__(self, message: str, *, details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(message)
        self.details = dict(details or {})


class CognitionValidationError(CognitionError):
    code = "cognition_validation_error"


class CognitionNotFoundError(CognitionError):
    code = "cognition_not_found"


class CognitionCatalogError(CognitionError):
    code = "cognition_catalog_error"


class CognitionConflictError(CognitionError):
    code = "cognition_conflict"


class CognitionStorageError(CognitionError):
    code = "cognition_storage_error"
