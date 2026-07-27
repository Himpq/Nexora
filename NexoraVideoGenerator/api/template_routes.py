"""HTTP API for controlled Motion Canvas template rendering."""

from __future__ import annotations

from typing import Any, Dict, Mapping

from flask import Blueprint, jsonify, request, send_file

from core.motion_templates.registry import get_template, list_templates
from core.motion_templates.service import TemplateJobService


bp = Blueprint("motion_templates", __name__, url_prefix="/api")
_CFG: Dict[str, Any] = {}
_SERVICE: TemplateJobService | None = None


def init_template_routes(cfg: Mapping[str, Any]) -> None:
    """Attach runtime configuration and initialize the template job service."""
    global _SERVICE
    _CFG.clear()
    _CFG.update(dict(cfg or {}))
    _SERVICE = TemplateJobService(_CFG)


@bp.route("/templates", methods=["GET"])
def api_list_templates():
    return jsonify({"success": True, "templates": list_templates()})


@bp.route("/templates/<template_id>", methods=["GET"])
def api_get_template(template_id: str):
    definition = get_template(template_id)

    if not definition:
        return _failure("template not found", 404)

    return jsonify({"success": True, "template": definition.detail()})


@bp.route("/template-jobs/validate", methods=["POST"])
def api_validate_template_job():
    result = _service().validate(_request_json())
    return jsonify({"success": result["valid"], **result}), 200 if result["valid"] else 400


@bp.route("/template-jobs/preview", methods=["POST"])
def api_preview_template_job():
    return _create_job(preview=True)


@bp.route("/template-jobs/render", methods=["POST"])
def api_render_template_job():
    return _create_job(preview=False)


@bp.route("/template-jobs/generate", methods=["POST"])
def api_generate_template_job():
    """Plan a constrained template from a topic, then preview or render it asynchronously."""
    try:
        result = _service().create_generated_job(_request_json())
    except ValueError as exc:
        return _failure(str(exc), 400)

    return jsonify({"success": True, **result}), 202


@bp.route("/template-jobs/<job_id>", methods=["GET"])
def api_get_template_job(job_id: str):
    try:
        job = _service().get_job(job_id)
    except ValueError:
        job = None

    if not job:
        return _failure("template job not found", 404)

    return jsonify({"success": True, "job": job})


@bp.route("/template-jobs/<job_id>/files/<path:relative_path>", methods=["GET"])
def api_get_template_job_file(job_id: str, relative_path: str):
    try:
        target = _service().resolve_file(job_id, relative_path)
    except (FileNotFoundError, ValueError):
        return _failure("template artifact not found", 404)

    response = send_file(str(target), conditional=True)
    response.headers["Accept-Ranges"] = "bytes"
    return response


def _create_job(*, preview: bool):
    result = _service().create_job(_request_json(), preview=preview)

    if not result["valid"]:
        return jsonify({"success": False, **result}), 400

    return jsonify({"success": True, **result}), 202


def _request_json() -> Dict[str, Any]:
    payload = request.get_json(silent=True)

    if payload is None:
        return {}

    if not isinstance(payload, dict):
        raise ValueError("request body must be a JSON object")

    return payload


def _service() -> TemplateJobService:
    if _SERVICE is None:
        raise RuntimeError("template service is not initialized")

    return _SERVICE


def _failure(message: str, status_code: int):
    return jsonify({"success": False, "message": message}), status_code
