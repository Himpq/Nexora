"""HTTP routes for NexoraVideoGenerator."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Mapping

from flask import Blueprint, jsonify, request, send_file

from core.learning_ingest import normalize_learning_project_payload, normalize_run_stages
from core.pipeline import VideoGenerationPipeline, run_project_generation
from core.providers.manim import render_manim_poc
from core.projects import create_project, get_project, list_projects, project_dir

bp = Blueprint("nexora_video_generator", __name__, url_prefix="/api")
_CFG: Dict[str, Any] = {}


def init_routes(cfg: Mapping[str, Any]) -> None:
    """Attach runtime config to the route module."""
    _CFG.clear()
    _CFG.update(dict(cfg or {}))


@bp.route("/projects", methods=["GET"])
def api_list_projects():
    limit = _query_int("limit", default=50, minimum=1, maximum=200)
    return jsonify({
        "success": True,
        "projects": list_projects(_CFG, limit=limit),
    })


@bp.route("/projects", methods=["POST"])
def api_create_project():
    try:
        payload = _request_json()
        project = create_project(_CFG, payload)
    except ValueError as exc:
        return _json_failure(str(exc), 400)

    return jsonify({
        "success": True,
        "project": project,
        "project_dir": str(project_dir(_CFG, str(project.get("id") or ""))),
    })


@bp.route("/projects/generate", methods=["POST"])
def api_generate_project():
    try:
        payload = _request_json()
        result = run_project_generation(_CFG, payload)
    except ValueError as exc:
        return _json_failure(str(exc), 400)
    except Exception as exc:
        return _json_failure(str(exc), 500)

    return jsonify({
        "success": True,
        "result": result,
    })


@bp.route("/projects/from-learning", methods=["POST"])
def api_create_project_from_learning():
    try:
        payload = _request_json()
        project_payload = normalize_learning_project_payload(payload)
        run_stages = normalize_run_stages(payload.get("run_stages"), VideoGenerationPipeline.STAGES)
        project = create_project(_CFG, project_payload)
        project_id = str(project.get("id") or "").strip()
        artifacts = {}

        if run_stages:
            pipeline = VideoGenerationPipeline(_CFG)

            for stage in run_stages:
                artifacts[stage] = pipeline.run_stage(project_id, stage)

            project = get_project(_CFG, project_id) or project

    except ValueError as exc:
        return _json_failure(str(exc), 400)
    except Exception as exc:
        return _json_failure(str(exc), 500)

    return jsonify({
        "success": True,
        "project": project,
        "project_dir": str(project_dir(_CFG, project_id)),
        "normalized_payload": project_payload,
        "artifacts": artifacts,
    })


@bp.route("/projects/<project_id>", methods=["GET"])
def api_get_project(project_id: str):
    project = get_project(_CFG, project_id)

    if not project:
        return jsonify({"success": False, "message": "project not found"}), 404

    return jsonify({
        "success": True,
        "project": project,
        "project_dir": str(project_dir(_CFG, project_id)),
    })


@bp.route("/projects/<project_id>/stages/<stage>", methods=["POST"])
def api_run_project_stage(project_id: str, stage: str):
    try:
        pipeline = VideoGenerationPipeline(_CFG)
        result = pipeline.run_stage(project_id, stage)
    except ValueError as exc:
        return _json_failure(str(exc), 400)
    except Exception as exc:
        return _json_failure(str(exc), 500)

    return jsonify({
        "success": True,
        "project": get_project(_CFG, project_id),
        "stage": stage,
        "result": result,
    })


@bp.route("/projects/<project_id>/manim", methods=["POST"])
def api_render_project_manim(project_id: str):
    try:
        payload = _request_json()
        result = render_manim_poc(
            _CFG,
            project_id,
            scene_id=str(payload.get("scene_id") or "").strip(),
            render=_json_bool(payload.get("render"), default=True),
        )
    except ValueError as exc:
        return _json_failure(str(exc), 400)
    except Exception as exc:
        return _json_failure(str(exc), 500)

    return jsonify({
        "success": True,
        "project": get_project(_CFG, project_id),
        "result": result,
    })


@bp.route("/projects/<project_id>/artifacts/<path:artifact_name>", methods=["GET"])
def api_get_artifact(project_id: str, artifact_name: str):
    try:
        target = _resolve_project_file(project_id, artifact_name)
    except FileNotFoundError:
        return jsonify({"success": False, "message": "artifact not found"}), 404

    if target.suffix.lower() != ".json":
        return jsonify({"success": False, "message": "artifact must be a JSON file"}), 400

    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return jsonify({"success": False, "message": f"artifact JSON invalid: {exc}"}), 400

    return jsonify({
        "success": True,
        "artifact": data,
    })


@bp.route("/projects/<project_id>/files/<path:relative_path>", methods=["GET"])
def api_get_project_file(project_id: str, relative_path: str):
    try:
        target = _resolve_project_file(project_id, relative_path)
    except FileNotFoundError:
        return jsonify({"success": False, "message": "file not found"}), 404

    return send_file(str(target))


def _request_json() -> Dict[str, Any]:
    payload = request.get_json(silent=True)

    if payload is None:
        return {}

    if not isinstance(payload, dict):
        raise ValueError("request body must be a JSON object")

    return payload


def _query_int(name: str, *, default: int, minimum: int, maximum: int) -> int:
    raw = request.args.get(name, default)
    value = int(raw)

    if value < minimum:
        return minimum

    if value > maximum:
        return maximum

    return value


def _json_bool(value: Any, *, default: bool) -> bool:
    if value is None:
        return default

    if isinstance(value, bool):
        return value

    if isinstance(value, str):
        return value.strip().lower() not in {"0", "false", "no", "off"}

    return bool(value)


def _is_inside(root: Path, target: Path) -> bool:
    try:
        target.relative_to(root)
        return True
    except ValueError:
        return False


def _resolve_project_file(project_id: str, relative_path: str) -> Path:
    root = project_dir(_CFG, project_id).resolve()
    target = (root / relative_path).resolve()

    if not _is_inside(root, target) or not target.is_file():
        raise FileNotFoundError(str(relative_path))

    return target


def _json_failure(message: str, status_code: int):
    return jsonify({
        "success": False,
        "message": str(message or "request failed"),
    }), status_code
