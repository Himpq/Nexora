"""Cognitive twin catalog, evidence, and overview routes."""

from collections.abc import Mapping as MappingABC

from api import routes as _routes
from core.cognition import (
    CognitionCatalogError,
    CognitionConflictError,
    CognitionError,
    CognitionNotFoundError,
    CognitionService,
    CognitionStorageError,
    CognitionValidationError,
)


_routes._export_route_context(globals())


def _cognition_error_response(exc: CognitionError):
    status_code = 500

    if isinstance(exc, CognitionValidationError):
        status_code = 400
    elif isinstance(exc, CognitionNotFoundError):
        status_code = 404
    elif isinstance(exc, (CognitionCatalogError, CognitionConflictError)):
        status_code = 409
    elif isinstance(exc, CognitionStorageError):
        status_code = 500

    log_event(
        "cognition_request_error",
        "认知数字孪生请求失败",
        payload={
            "code": exc.code,
            "message": str(exc),
            "details": exc.details,
            "path": str(request.path or "").strip(),
        },
    )
    return jsonify({
        "success": False,
        "error": str(exc),
        "code": exc.code,
        "details": exc.details,
    }), status_code


def _cognition_runtime_user_id() -> str:
    user_id = str(_resolve_runtime_user_id() or "").strip()

    if not user_id:
        raise CognitionValidationError("user_id is required.")

    return user_id


@bp.route("/frontend/cognition/catalog", methods=["GET"])
def frontend_cognition_catalog():
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    book_id = str(request.args.get("book_id") or "").strip()

    try:
        catalog = CognitionService(_cfg).get_catalog(lecture_id, book_id=book_id)
        return jsonify({"success": True, "catalog": catalog})
    except CognitionError as exc:
        return _cognition_error_response(exc)


@bp.route("/frontend/cognition/evidence", methods=["GET"])
def frontend_cognition_evidence_list():
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    book_id = str(request.args.get("book_id") or "").strip()
    concept_id = str(request.args.get("concept_id") or "").strip()
    limit_raw = request.args.get("limit")

    try:
        limit = int(limit_raw) if limit_raw is not None else 200
    except (TypeError, ValueError):
        return _cognition_error_response(CognitionValidationError("limit must be an integer."))

    try:
        if limit < 1 or limit > 500:
            raise CognitionValidationError("limit must be between 1 and 500.")

        user_id = _cognition_runtime_user_id()
        result = CognitionService(_cfg).list_evidence(
            user_id,
            lecture_id=lecture_id,
            book_id=book_id,
            concept_id=concept_id,
            limit=limit,
        )
        return jsonify({"success": True, **result})
    except CognitionError as exc:
        return _cognition_error_response(exc)


@bp.route("/frontend/cognition/evidence", methods=["POST"])
def frontend_cognition_evidence_create():
    data = request.get_json(silent=True)

    if not isinstance(data, MappingABC):
        return _cognition_error_response(CognitionValidationError("request body must be an object."))

    try:
        user_id = _cognition_runtime_user_id()
        result = CognitionService(_cfg).record_evidence(user_id, data)
        evidence = result["evidence"]
        log_event(
            "cognition_evidence_recorded",
            "认知证据已记录",
            payload={
                "user_id": user_id,
                "lecture_id": evidence.get("lecture_id"),
                "book_id": evidence.get("book_id"),
                "concept_id": evidence.get("concept_id"),
                "evidence_id": evidence.get("evidence_id"),
                "evidence_type": evidence.get("evidence_type"),
                "created": bool(result.get("created")),
            },
        )
        return jsonify({"success": True, **result}), 201 if result.get("created") else 200
    except CognitionError as exc:
        return _cognition_error_response(exc)


@bp.route("/frontend/cognition/overview", methods=["GET"])
def frontend_cognition_overview():
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    book_id = str(request.args.get("book_id") or "").strip()

    try:
        user_id = _cognition_runtime_user_id()
        overview = CognitionService(_cfg).get_overview(
            user_id,
            lecture_id=lecture_id,
            book_id=book_id,
        )
        return jsonify({"success": True, "overview": overview})
    except CognitionError as exc:
        return _cognition_error_response(exc)
