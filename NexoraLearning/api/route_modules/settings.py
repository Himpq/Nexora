"""Frontend settings routes."""

from api import routes as _routes

# The first split keeps common helpers in api.routes while route handlers move by domain.
_routes._export_route_context(globals())


@bp.route("/frontend/settings/users", methods=["GET"])
def frontend_settings_users():
    """设置页：读取用户列表与身份信息。"""
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can view user settings."}), 403
    query = str(request.args.get("q") or "").strip()
    limit = _safe_int(request.args.get("limit"), 200)
    rows = _list_settings_users(query, limit)
    summary = {
        "total": len(rows),
        "admins": sum(1 for row in rows if str(row.get("role") or "").strip().lower() == "admin"),
        "teachers": sum(1 for row in rows if str(row.get("identity") or "").strip().lower() == "teacher"),
        "students": sum(1 for row in rows if str(row.get("identity") or "").strip().lower() == "student"),
    }
    return jsonify(
        {
            "success": True,
            "query": query,
            "items": rows,
            "total": len(rows),
            "summary": summary,
        }
    )

@bp.route("/frontend/settings/users/<user_id>", methods=["PATCH"])
def frontend_settings_users_patch(user_id: str):
    """设置页：更新用户身份标签。"""
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can update user settings."}), 403
    resolved_user_id = str(user_id or "").strip()
    if not resolved_user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"success": False, "error": "JSON body is required."}), 400
    identity = str(data.get("identity") or "").strip().lower()
    if identity not in {"student", "teacher"}:
        return jsonify({"success": False, "error": "identity must be student or teacher."}), 400

    current = user_store.get_user(_cfg, resolved_user_id)
    if not current:
        return jsonify({"success": False, "error": "user not found."}), 404
    actor = str(_resolve_runtime_user_id() or "").strip()
    is_target_admin = str(current.get("role") or "").strip().lower() == "admin"
    if is_target_admin and actor != resolved_user_id:
        return jsonify({"success": False, "error": "不允许修改其他管理员的身份。"}), 400

    updated = user_store.update_user(_cfg, resolved_user_id, {"identity": identity})
    if not isinstance(updated, dict):
        return jsonify({"success": False, "error": "user not found."}), 404
    remote: Dict[str, Any] = {}
    if _proxy is not None:
        try:
            result = _get_cached_nexora_user_info(resolved_user_id)
            if isinstance(result, dict) and result.get("success"):
                remote = result.get("user") if isinstance(result.get("user"), dict) else {}
        except Exception:
            pass
    log_event(
        "settings_user_identity_updated",
        "Updated user identity from Settings.",
        payload={
            "user_id": resolved_user_id,
            "identity": identity,
            "actor": _resolve_runtime_user_id(),
        },
    )
    return jsonify({"success": True, "user": _serialize_settings_user(updated, remote=remote)})

@bp.route("/frontend/settings/models", methods=["GET"])
def frontend_settings_models():
    """设置页：读取模型选项与当前模型设置。"""
    username = _resolve_runtime_user_id()
    listed = _list_nexora_models_payload(username)
    options = _extract_model_options(listed.get("payload") if isinstance(listed.get("payload"), dict) else {})
    options.sort(key=lambda row: row.get("id", ""))
    rough = get_rough_reading_settings(_cfg)
    default_model = get_default_nexora_model(_cfg)
    return jsonify(
        {
            "success": True,
            "is_admin": _is_runtime_admin(),
            "available_models": options,
            "available_count": len(options),
            "models_fetch_success": bool(listed.get("success")),
            "models_fetch_message": str(listed.get("message") or ""),
            "settings": {
                "default_nexora_model": default_model,
                "rough_reading": rough,
                "intensive_reading": get_intensive_reading_settings(_cfg),
                "split_chapters": get_split_chapters_settings(_cfg),
                "annotation": get_annotation_settings(_cfg),
                "memory": get_memory_settings(_cfg),
                "profile_question": get_profile_question_settings(_cfg),
            },
        }
    )

@bp.route("/frontend/settings/models", methods=["PATCH"])
def frontend_settings_models_patch():
    """设置页：更新默认模型与粗读模型。"""
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can update model settings."}), 403
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"success": False, "error": "JSON body is required."}), 400
    default_model = data.get("default_nexora_model")
    rough_updates = data.get("rough_reading")
    intensive_updates = data.get("intensive_reading")
    split_chapters_updates = data.get("split_chapters")
    annotation_updates = data.get("annotation")
    memory_updates = data.get("memory")
    profile_question_updates = data.get("profile_question")
    listed = _list_nexora_models_payload(_resolve_runtime_user_id())
    available_ids = {row.get("id", "") for row in _extract_model_options(listed.get("payload") if isinstance(listed.get("payload"), dict) else {})}
    updated_default = get_default_nexora_model(_cfg)
    updated_rough = get_rough_reading_settings(_cfg)
    updated_intensive = get_intensive_reading_settings(_cfg)
    updated_split_chapters = get_split_chapters_settings(_cfg)
    updated_annotation = get_annotation_settings(_cfg)
    updated_memory = get_memory_settings(_cfg)
    updated_profile_question = get_profile_question_settings(_cfg)
    if default_model is not None:
        normalized_default = str(default_model or "").strip()
        if normalized_default and normalized_default not in available_ids:
            return jsonify({"success": False, "error": "default_nexora_model is not in available models."}), 400
        updated_default = update_default_nexora_model(_cfg, normalized_default)
    if isinstance(rough_updates, dict):
        rough_model_name = str(rough_updates.get("model_name") or "").strip()
        if rough_model_name and rough_model_name not in available_ids:
            return jsonify({"success": False, "error": "rough_reading.model_name is not in available models."}), 400
        updated_rough = update_rough_reading_settings(_cfg, rough_updates)
    if isinstance(intensive_updates, dict):
        intensive_model_name = str(intensive_updates.get("model_name") or "").strip()
        if intensive_model_name and intensive_model_name not in available_ids:
            return jsonify({"success": False, "error": "intensive_reading.model_name is not in available models."}), 400
        updated_intensive = update_intensive_reading_settings(_cfg, intensive_updates)
    if isinstance(split_chapters_updates, dict):
        split_model_name = str(split_chapters_updates.get("model_name") or "").strip()
        if split_model_name and split_model_name not in available_ids:
            return jsonify({"success": False, "error": "split_chapters.model_name is not in available models."}), 400
        updated_split_chapters = update_split_chapters_settings(_cfg, split_chapters_updates)
    if isinstance(annotation_updates, dict):
        annotation_model_name = str(annotation_updates.get("model_name") or "").strip()
        if annotation_model_name and annotation_model_name not in available_ids:
            return jsonify({"success": False, "error": "annotation.model_name is not in available models."}), 400
        updated_annotation = update_annotation_settings(_cfg, annotation_updates)
    if isinstance(memory_updates, dict):
        memory_model_name = str(memory_updates.get("model_name") or "").strip()
        if memory_model_name and memory_model_name not in available_ids:
            return jsonify({"success": False, "error": "memory.model_name is not in available models."}), 400
        updated_memory = update_memory_settings(_cfg, memory_updates)
    if isinstance(profile_question_updates, dict):
        profile_question_model_name = str(profile_question_updates.get("model_name") or "").strip()
        if profile_question_model_name and profile_question_model_name not in available_ids:
            return jsonify({"success": False, "error": "profile_question.model_name is not in available models."}), 400
        updated_profile_question = update_profile_question_settings(_cfg, profile_question_updates)
    return jsonify(
        {
            "success": True,
            "settings": {
                "default_nexora_model": updated_default,
                "rough_reading": updated_rough,
                "intensive_reading": updated_intensive,
                "split_chapters": updated_split_chapters,
                "annotation": updated_annotation,
                "memory": updated_memory,
                "profile_question": updated_profile_question,
            },
        }
    )

@bp.route("/frontend/settings/logs", methods=["GET"])
def frontend_settings_logs():
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can view logs."}), 403
    category = str(request.args.get("category") or "all").strip()
    source = str(request.args.get("source") or "").strip()
    limit = _safe_int(request.args.get("limit"), 200)
    rows = list_structured_logs(_cfg, limit=limit, category=category, source=source)
    return jsonify(
        {
            "success": True,
            "sources": available_log_sources(_cfg, category="model"),
            "rows": rows,
            "selected_category": category,
            "selected_source": source,
        }
    )
