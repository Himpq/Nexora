"""User-owned scheduled task API."""

import os

from flask import Blueprint, jsonify, request, session

from .store import create_task, delete_task, list_runs, list_tasks, update_task
from .worker import start_worker


scheduled_tasks_bp = Blueprint("scheduled_tasks", __name__)


@scheduled_tasks_bp.record_once
def _start_scheduled_tasks(_state):
    """Start polling when the parent blueprint is registered by ChatDBServer."""
    if os.environ.get("NEXORA_DISABLE_SCHEDULED_TASK_WORKER") == "1":
        return

    start_worker()


@scheduled_tasks_bp.before_app_request
def _ensure_scheduled_tasks_started():
    """Start a poller in each serving process, including workers forked after import."""
    if os.environ.get("NEXORA_DISABLE_SCHEDULED_TASK_WORKER") == "1":
        return

    start_worker()


def _username():
    username = str(session.get("username") or "").strip()

    if not username:
        raise PermissionError("请先登录")

    return username


def _error_response(exc):
    if isinstance(exc, PermissionError):
        code = 401
    elif isinstance(exc, LookupError):
        code = 404
    elif isinstance(exc, ValueError):
        code = 400
    else:
        print(f"[ScheduledTasks] API failed: {exc}")
        code = 500

    message = str(exc) if code != 500 else "定时任务操作失败，请查看服务端日志"
    return jsonify({"success": False, "message": message}), code


@scheduled_tasks_bp.route("/api/scheduled-tasks", methods=["GET"])
def get_scheduled_tasks():
    try:
        return jsonify({"success": True, "tasks": list_tasks(_username())})
    except Exception as exc:
        return _error_response(exc)


@scheduled_tasks_bp.route("/api/scheduled-tasks", methods=["POST"])
def post_scheduled_task():
    try:
        username = _username()
        payload = request.get_json(silent=True)

        if not isinstance(payload, dict):
            raise ValueError("请求体必须是 JSON object")

        task = create_task(
            username,
            payload.get("title"),
            payload.get("prompt"),
            payload.get("weekdays"),
            payload.get("hour"),
            payload.get("minute"),
        )
        return jsonify({"success": True, "task": task}), 201
    except Exception as exc:
        return _error_response(exc)


@scheduled_tasks_bp.route("/api/scheduled-tasks/<task_id>", methods=["PATCH"])
def patch_scheduled_task(task_id):
    try:
        username = _username()
        payload = request.get_json(silent=True)
        task = update_task(username, task_id, payload)
        return jsonify({"success": True, "task": task})
    except Exception as exc:
        return _error_response(exc)


@scheduled_tasks_bp.route("/api/scheduled-tasks/<task_id>", methods=["DELETE"])
def remove_scheduled_task(task_id):
    try:
        delete_task(_username(), task_id)
        return jsonify({"success": True})
    except Exception as exc:
        return _error_response(exc)


@scheduled_tasks_bp.route("/api/scheduled-tasks/<task_id>/runs", methods=["GET"])
def get_scheduled_task_runs(task_id):
    try:
        return jsonify({"success": True, "runs": list_runs(_username(), task_id)})
    except Exception as exc:
        return _error_response(exc)
