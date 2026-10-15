"""Local-only controls and active-time input for optional telemetry."""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from .TelemetryService import get_telemetry_service


local_telemetry_bp = Blueprint("local_telemetry", __name__)


@local_telemetry_bp.after_request
def _telemetry_no_store(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@local_telemetry_bp.before_request
def _check_telemetry_origin():
    if request.method == "GET":
        return None

    origin = request.headers.get("Origin")

    if origin and origin.rstrip("/") != request.host_url.rstrip("/"):
        return jsonify({"success": False, "message": "禁止跨站访问本地统计设置"}), 403

    return None


@local_telemetry_bp.route("/api/local/telemetry/status", methods=["GET"])
def local_telemetry_status():
    return jsonify({"success": True, **get_telemetry_service().status()})


@local_telemetry_bp.route("/api/local/telemetry/notice", methods=["POST"])
def local_telemetry_acknowledge_notice():
    body = request.get_json(silent=True)

    if not isinstance(body, dict) or body:
        return jsonify({"success": False, "message": "统计提示请求无效"}), 400

    get_telemetry_service().acknowledge_notice()

    return jsonify({"success": True})


@local_telemetry_bp.route("/api/local/telemetry/activity", methods=["POST"])
def local_telemetry_record_activity():
    body = request.get_json(silent=True)

    if not isinstance(body, dict) or set(body) != {"active_seconds"}:
        return jsonify({"success": False, "message": "活跃时长请求无效"}), 400

    seconds = body.get("active_seconds")

    if type(seconds) is not int or not 1 <= seconds <= 60:
        return jsonify({"success": False, "message": "活跃时长必须为 1 到 60 秒"}), 400

    get_telemetry_service().record_active_seconds(seconds)

    return jsonify({"success": True})


def register_telemetry_routes(app) -> None:
    app.register_blueprint(local_telemetry_bp)
