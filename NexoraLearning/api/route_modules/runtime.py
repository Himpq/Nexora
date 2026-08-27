"""Runtime API routes."""

from api import routes as _routes

# The first split keeps common helpers in api.routes while route handlers move by domain.
_routes._export_route_context(globals())


@bp.route("/runtime/config", methods=["GET"])
def runtime_config():
    auth_error = _require_runtime_api_auth()
    if auth_error is not None:
        return auth_error
    return jsonify(
        {
            "success": True,
            "runtime_api": {
                "enabled": _runtime_api_enabled(),
                "base_path": "/api/runtime",
                "frontend_url": _resolve_learning_frontend_url(),
                "request_timeout": int(_runtime_api_cfg().get("request_timeout") or 30),
            },
        }
    )

@bp.route("/runtime/tools", methods=["GET"])
def runtime_tools():
    auth_error = _require_runtime_api_auth()
    if auth_error is not None:
        return auth_error
    return jsonify({"success": True, "tools": _runtime_tool_specs()})

@bp.route("/runtime/context", methods=["POST"])
def runtime_context():
    auth_error = _require_runtime_api_auth()
    if auth_error is not None:
        return auth_error
    data = request.get_json(silent=True) or {}
    username = str(data.get("username") or "").strip()
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    return jsonify({"success": True, "payload": _build_runtime_context_payload(username, payload)})

@bp.route("/runtime/tool/execute", methods=["POST"])
def runtime_tool_execute():
    auth_error = _require_runtime_api_auth()
    if auth_error is not None:
        return auth_error
    data = request.get_json(silent=True) or {}
    username = str(data.get("username") or "").strip()
    tool_name = str(data.get("tool_name") or data.get("function_name") or "").strip()
    arguments = data.get("arguments") if isinstance(data.get("arguments"), dict) else {}
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    if not tool_name:
        return jsonify({"success": False, "error": "tool_name is required."}), 400
    try:
        payload = _runtime_execute_tool(username, tool_name, arguments)
        log_event(
            "runtime_tool_execute",
            "Runtime tool executed.",
            payload={
                "username": username,
                "tool_name": tool_name,
            },
        )
        return jsonify({"success": True, "result": payload})
    except PermissionError as exc:
        log_event(
            "runtime_tool_execute_denied",
            "Runtime tool access denied.",
            payload={
                "username": username,
                "tool_name": tool_name,
                "error": str(exc),
            },
        )
        return jsonify({"success": False, "error": str(exc)}), 403
    except Exception as exc:
        log_event(
            "runtime_tool_execute_error",
            "Runtime tool execution failed.",
            payload={
                "username": username,
                "tool_name": tool_name,
                "error": str(exc),
            },
        )
        return jsonify({"success": False, "error": str(exc)}), 500

@bp.route("/runtime/memory-blocks", methods=["POST"])
def runtime_memory_blocks():
    auth_error = _require_runtime_api_auth()
    if auth_error is not None:
        return auth_error
    data = request.get_json(silent=True) or {}
    username = str(data.get("username") or "").strip()
    lecture_id = str(data.get("lecture_id") or "").strip()
    if not username or not lecture_id:
        return jsonify({"success": False, "error": "username and lecture_id are required."}), 400
    try:
        _runtime_require_selected_lecture(username, lecture_id)
    except PermissionError as exc:
        return jsonify({"success": False, "error": str(exc)}), 403
    rows = _build_runtime_memory_blocks(username, lecture_id)
    return jsonify({"success": True, "blocks": rows})

@bp.route("/runtime/memory/trigger", methods=["POST"])
def runtime_memory_trigger():
    auth_error = _require_runtime_api_auth()
    if auth_error is not None:
        return auth_error
    data = request.get_json(silent=True) or {}
    username = str(data.get("username") or "").strip()
    lecture_id = str(data.get("lecture_id") or "").strip()
    reason = str(data.get("reason") or "").strip() or "manual"
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    if not username or not lecture_id:
        return jsonify({"success": False, "error": "username and lecture_id are required."}), 400
    try:
        _runtime_require_selected_lecture(username, lecture_id)
    except PermissionError as exc:
        return jsonify({"success": False, "error": str(exc)}), 403
    log_event(
        "runtime_memory_trigger_request",
        "Runtime memory trigger request received.",
        payload={
            "username": username,
            "lecture_id": lecture_id,
            "reason": reason,
            "payload_keys": sorted([str(key) for key in payload.keys()]),
        },
    )
    result = enqueue_memory_job(
        _cfg,
        user_id=username,
        lecture_id=lecture_id,
        reason=reason,
        payload=payload,
    )
    _append_learning_profile_trigger_notification(
        username=username,
        lecture_id=lecture_id,
        reason=reason,
        result=result if isinstance(result, Mapping) else {},
    )
    return jsonify({"success": True, "result": result})

@bp.route("/runtime/memory/context-compression", methods=["POST"])
def runtime_memory_context_compression():
    auth_error = _require_runtime_api_auth()
    if auth_error is not None:
        return auth_error
    data = request.get_json(silent=True) or {}
    username = str(data.get("username") or "").strip()
    lecture_id = str(data.get("lecture_id") or "").strip()
    job_id = str(data.get("job_id") or "").strip()
    if not username or not lecture_id:
        return jsonify({"success": False, "error": "username and lecture_id are required."}), 400
    try:
        _runtime_require_selected_lecture(username, lecture_id)
    except PermissionError as exc:
        return jsonify({"success": False, "error": str(exc)}), 403
    result = mark_context_compression_completed(_cfg, username, lecture_id, job_id=job_id)
    return jsonify({"success": True, "result": result})

@bp.route("/runtime/memory/turn", methods=["POST"])
def runtime_memory_turn():
    auth_error = _require_runtime_api_auth()
    if auth_error is not None:
        return auth_error
    data = request.get_json(silent=True) or {}
    username = str(data.get("username") or "").strip()
    lecture_id = str(data.get("lecture_id") or "").strip()
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    if not username or not lecture_id:
        return jsonify({"success": False, "error": "username and lecture_id are required."}), 400
    try:
        _runtime_require_selected_lecture(username, lecture_id)
    except PermissionError as exc:
        return jsonify({"success": False, "error": str(exc)}), 403
    log_event(
        "runtime_memory_turn_request",
        "Runtime memory turn request received.",
        payload={
            "username": username,
            "lecture_id": lecture_id,
            "payload_keys": sorted([str(key) for key in payload.keys()]),
        },
    )
    state = increment_learning_turn(_cfg, username, lecture_id)
    settings = get_memory_settings(_cfg) or {}
    enqueue_result = maybe_enqueue_interval_analysis(
        _cfg,
        user_id=username,
        lecture_id=lecture_id,
        turn_interval=int(settings.get("trigger_turn_interval", 10) or 10),
        payload=payload,
    )
    log_event(
        "runtime_memory_turn_result",
        "Runtime memory turn request processed.",
        payload={
            "username": username,
            "lecture_id": lecture_id,
            "state": dict(state or {}),
            "enqueue": dict(enqueue_result or {}),
        },
    )
    return jsonify({"success": True, "state": state, "enqueue": enqueue_result})

@bp.route("/runtime/memory/queue", methods=["GET"])
def runtime_memory_queue():
    auth_error = _require_runtime_api_auth()
    if auth_error is not None:
        return auth_error
    return jsonify({"success": True, "queue": get_memory_queue_snapshot()})
