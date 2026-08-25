"""Learning resource routes."""

from api import routes as _routes

# The first split keeps common helpers in api.routes while route handlers move by domain.
_routes._export_route_context(globals())


@bp.route("/frontend/learning-resources", methods=["GET"])
def frontend_learning_resources():
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    _repair_interrupted_learning_resource_generations()
    include_drafts = _is_runtime_teacher() and str(request.args.get("include_drafts") or "").strip() == "1"
    limit = min(100, max(1, _safe_int(request.args.get("limit"), 30)))
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    rows = list_learning_resources(_cfg, limit=limit, include_drafts=include_drafts, lecture_id=lecture_id)
    return jsonify({"success": True, "items": rows, "total": len(rows)})

@bp.route("/frontend/learning-resources/<path:resource_id>", methods=["GET"])
def frontend_learning_resource_detail(resource_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    _repair_interrupted_learning_resource_generations()
    target_id = str(resource_id or "").strip()
    if not target_id:
        return jsonify({"success": False, "error": "resource_id is required."}), 400
    include_drafts = _is_runtime_teacher()
    rows = list_learning_resources(_cfg, limit=500, include_drafts=include_drafts)
    resource = next((row for row in rows if str(row.get("id") or "").strip() == target_id), None)
    if not resource:
        return jsonify({"success": False, "error": "resource not found."}), 404
    return jsonify({"success": True, "resource": resource})

@bp.route("/frontend/learning-resources/<path:resource_id>", methods=["DELETE"])
def frontend_learning_resource_delete(resource_id: str):
    username = _resolve_runtime_user_id()

    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can delete resources."}), 403

    target_id = str(resource_id or "").strip()

    if not target_id:
        return jsonify({"success": False, "error": "resource_id is required."}), 400

    resource = delete_learning_resource(_cfg, target_id)

    if not resource:
        return jsonify({"success": False, "error": "resource not found."}), 404

    log_event(
        "learning_resource_deleted",
        "学习资源已删除",
        payload={
            "resource_id": target_id,
            "source_task_id": resource.get("source_task_id"),
            "status": resource.get("status"),
            "title": resource.get("title"),
            "username": username,
        },
    )

    return jsonify({"success": True, "resource": resource})

@bp.route("/frontend/learning-resources/<path:resource_id>/status", methods=["POST"])
def frontend_learning_resource_status(resource_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can review resources."}), 403
    data = request.get_json(silent=True) or {}
    if not isinstance(data, MappingABC):
        return jsonify({"success": False, "error": "request body must be an object."}), 400
    target_status = str(data.get("status") or "").strip()
    if target_status not in {"published", "draft_ready", "draft", "failed"}:
        return jsonify({"success": False, "error": "unsupported status."}), 400
    if target_status == "published":
        target_id = str(resource_id or "").strip()
        resources = list_learning_resources(_cfg, limit=300, include_drafts=True)
        current = next((row for row in resources if str(row.get("id") or "").strip() == target_id), None)
        if not current:
            return jsonify({"success": False, "error": "resource not found."}), 404
        if data.get("confirmed") is not True:
            return jsonify({"success": False, "error": "publish confirmation is required."}), 400
        if not str(current.get("content") or "").strip():
            return jsonify({"success": False, "error": "resource content is required before publish."}), 409
    updates: Dict[str, Any] = {
        "status": target_status,
        "reviewed_by": username,
        "reviewed_at": int(time.time()),
    }
    if target_status == "published":
        updates["published_at"] = int(time.time())
        updates["reason"] = "管理员审核通过，已发布到学习资源。"
    elif str(data.get("reason") or "").strip():
        updates["reason"] = str(data.get("reason") or "").strip()
    resource = update_learning_resource(_cfg, resource_id, updates)
    if not resource:
        return jsonify({"success": False, "error": "resource not found."}), 404
    log_event(
        "learning_resource_review_status",
        "学习资源审核状态已更新",
        payload={"resource_id": resource_id, "status": target_status, "username": username},
    )
    return jsonify({"success": True, "resource": resource})

@bp.route("/frontend/learning-resources/<path:resource_id>/versions/<path:version_id>/select", methods=["POST"])
def frontend_learning_resource_version_select(resource_id: str, version_id: str):
    username = _resolve_runtime_user_id()

    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can switch resource versions."}), 403

    target_id = str(resource_id or "").strip()
    target_version_id = str(version_id or "").strip()

    if not target_id or not target_version_id:
        return jsonify({"success": False, "error": "resource_id and version_id are required."}), 400

    resources = list_learning_resources(_cfg, limit=300, include_drafts=True)
    current = next((row for row in resources if str(row.get("id") or "").strip() == target_id), None)

    if not current:
        return jsonify({"success": False, "error": "resource not found."}), 404

    if str(current.get("status") or "").strip() in {"queued", "generating"}:
        return jsonify({"success": False, "error": "resource is generating and cannot switch versions."}), 409

    _cancel_learning_resource_scan(target_id)
    resource = switch_learning_resource_version(_cfg, target_id, target_version_id)

    if not resource:
        return jsonify({"success": False, "error": "version not found."}), 404

    log_event(
        "learning_resource_version_selected",
        "学习资源当前版本已切换",
        payload={
            "resource_id": target_id,
            "version_id": target_version_id,
            "username": username,
        },
    )

    return jsonify({"success": True, "resource": resource})

@bp.route("/frontend/learning-resources/<path:resource_id>/scan", methods=["POST"])
def frontend_learning_resource_scan(resource_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can scan resources."}), 403
    target_id = str(resource_id or "").strip()
    resources = list_learning_resources(_cfg, limit=300, include_drafts=True)
    resource = next((row for row in resources if str(row.get("id") or "").strip() == target_id), None)
    if not resource:
        return jsonify({"success": False, "error": "resource not found."}), 404
    update_learning_resource(
        _cfg,
        target_id,
        {
            "review_scan": {
                "status": "running",
                "label": "模型复核中",
                "summary": "正在检查课程相关性、事实可靠性、结构可读性和发布风险。",
                "issues": [],
                "checked": [],
                "checked_at": int(time.time()),
                "reviewer": "model",
            },
            "reviewed_by_model_at": int(time.time()),
        },
    )
    try:
        scan = _scan_learning_resource_with_model(resource, username)
    except Exception as exc:
        scan = _learning_resource_scan_error(exc)
        log_event(
            "learning_resource_model_scan_error",
            "学习资源模型复核异常",
            payload={"resource_id": target_id, "username": username, "error": str(exc)},
        )

    updated = update_learning_resource(
        _cfg,
        target_id,
        {
            "review_scan": scan,
            "reviewed_by_model_at": int(time.time()),
        },
    )
    if not updated:
        return jsonify({"success": False, "error": "resource not found."}), 404
    log_event(
        "learning_resource_model_scan",
        "学习资源模型复核完成",
        payload={
            "resource_id": target_id,
            "version_id": updated.get("current_version_id"),
            "status": scan.get("status"),
            "username": username,
        },
    )
    if str(scan.get("status") or "").strip() == "rejected":
        log_event(
            "learning_resource_guard_rejected",
            "学习资源 scan 拒绝，已计入防幻觉拦截",
            payload={
                "resource_id": target_id,
                "version_id": updated.get("current_version_id"),
                "username": username,
                "summary": scan.get("summary"),
                "issue_count": len(scan.get("issues") if isinstance(scan.get("issues"), list) else []),
            },
        )
    return jsonify({"success": True, "resource": updated, "scan": scan})

@bp.route("/frontend/learning-resources/<path:resource_id>/scan-stream", methods=["POST"])
def frontend_learning_resource_scan_stream(resource_id: str):
    username = _resolve_runtime_user_id()

    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can scan resources."}), 403

    target_id = str(resource_id or "").strip()
    resources = list_learning_resources(_cfg, limit=300, include_drafts=True)
    resource = next((row for row in resources if str(row.get("id") or "").strip() == target_id), None)

    if not resource:
        return jsonify({"success": False, "error": "resource not found."}), 404

    event_queue = queue.Queue()
    cancel_event = _register_learning_resource_scan(target_id)

    def push_event(event_name: str, payload: Dict[str, Any]) -> None:
        event_queue.put((event_name, payload))

    def run_worker() -> None:
        running_scan = {
            "status": "running",
            "label": "模型复核中",
            "summary": "正在检查课程相关性、事实可靠性、结构可读性和发布风险。",
            "issues": [],
            "checked": [],
            "checked_at": int(time.time()),
            "reviewer": "model",
        }
        update_learning_resource(
            _cfg,
            target_id,
            {
                "review_scan": running_scan,
                "reviewed_by_model_at": int(time.time()),
            },
        )
        push_event("status", {"message": "模型复核已启动", "scan": running_scan})

        try:
            scan = _scan_learning_resource_with_model(
                resource,
                username,
                on_delta=lambda text: push_event("review_output", {"content": str(text or "")}),
                cancel_event=cancel_event,
            )
        except Exception as exc:
            if _is_learning_resource_scan_cancelled(cancel_event):
                push_event("cancelled", {"success": False, "message": "模型复核已取消"})
                push_event("complete", {})
                _clear_learning_resource_scan(target_id, cancel_event)
                return

            scan = _learning_resource_scan_error(exc)
            log_event(
                "learning_resource_model_scan_error",
                "学习资源模型复核异常",
                payload={"resource_id": target_id, "username": username, "error": str(exc)},
            )

        updated = update_learning_resource(
            _cfg,
            target_id,
            {
                "review_scan": scan,
                "reviewed_by_model_at": int(time.time()),
            },
        )

        if updated:
            log_event(
                "learning_resource_model_scan",
                "学习资源模型复核完成",
                payload={
                    "resource_id": target_id,
                    "version_id": updated.get("current_version_id"),
                    "status": scan.get("status"),
                    "username": username,
                    "stream": True,
                },
            )

            if str(scan.get("status") or "").strip() == "rejected":
                log_event(
                    "learning_resource_guard_rejected",
                    "学习资源 scan 拒绝，已计入防幻觉拦截",
                    payload={
                        "resource_id": target_id,
                        "version_id": updated.get("current_version_id"),
                        "username": username,
                        "summary": scan.get("summary"),
                        "issue_count": len(scan.get("issues") if isinstance(scan.get("issues"), list) else []),
                        "stream": True,
                    },
                )

            push_event("done", {"success": True, "resource": updated, "scan": scan})
        else:
            push_event("error", {"success": False, "error": "resource not found."})

        push_event("complete", {})
        _clear_learning_resource_scan(target_id, cancel_event)

    def event_stream():
        worker = threading.Thread(target=run_worker, name="learning-resource-scan-stream", daemon=True)
        worker.start()
        yield _reader_guide_sse_event("status", {"message": "learning resource scan stream started"})

        while True:
            try:
                event_name, event_payload = event_queue.get(timeout=15)
            except queue.Empty:
                yield _reader_guide_sse_event("ping", {"timestamp": time.time()})
                continue

            if event_name == "complete":
                break

            yield _reader_guide_sse_event(event_name, event_payload)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@bp.route("/frontend/learning-resources/<path:resource_id>/scan-cancel", methods=["POST"])
def frontend_learning_resource_scan_cancel(resource_id: str):
    username = _resolve_runtime_user_id()

    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can cancel resource scans."}), 403

    target_id = str(resource_id or "").strip()

    if not target_id:
        return jsonify({"success": False, "error": "resource_id is required."}), 400

    cancelled = _cancel_learning_resource_scan(target_id)

    if cancelled:
        log_event(
            "learning_resource_model_scan_cancelled",
            "学习资源模型复核已取消",
            payload={"resource_id": target_id, "username": username},
        )

    return jsonify({"success": True, "cancelled": cancelled})

@bp.route("/frontend/learning-resources/<path:resource_id>/regenerate", methods=["POST"])
def frontend_learning_resource_regenerate(resource_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can regenerate resources."}), 403
    _repair_interrupted_learning_resource_generations()
    target_id = str(resource_id or "").strip()
    resources = list_learning_resources(_cfg, limit=300, include_drafts=True)
    resource = next((row for row in resources if str(row.get("id") or "").strip() == target_id), None)
    if not resource:
        return jsonify({"success": False, "error": "resource not found."}), 404
    if str(resource.get("status") or "").strip() in {"queued", "generating"}:
        return jsonify({"success": False, "error": "resource is already generating."}), 409
    scan = resource.get("review_scan") if isinstance(resource.get("review_scan"), MappingABC) else {}
    feedback = _learning_resource_scan_feedback(scan)
    if not feedback:
        feedback = "管理员要求基于当前草稿重新生成一个改进版本。"
    lecture_id = str(resource.get("lecture_id") or "").strip()
    lecture_title = str(resource.get("lecture_title") or _learning_resource_lecture_title(lecture_id)).strip()
    resource_type = str(resource.get("resource_type") or "explainer").strip() or "explainer"
    title = str(resource.get("title") or "学习资源草稿").strip()
    record = append_learning_resource_task(
        _cfg,
        {
            "task_type": "regenerate",
            "status": "draft_queued",
            "resource_type": resource_type,
            "lecture_id": lecture_id,
            "lecture_title": lecture_title,
            "title": title,
            "topics": [],
            "selected_topic_ids": [],
            "quality_feedback": feedback,
            "regenerate_from_version_id": str(resource.get("current_version_id") or ""),
            "created_by": username,
        },
    )
    updated = create_learning_resource_version(
        _cfg,
        target_id,
        {
            "status": "queued",
            "summary": "已根据 scan 反馈创建新版本，等待模型重新生成。",
            "content": "",
            "blocks": [],
            "components": {},
            "review_scan": {},
            "generation_activity": [],
            "reason": "根据模型复核反馈重新生成。",
            "source_task_id": record.get("id"),
            "created_by": username,
        },
    )
    if not updated:
        return jsonify({"success": False, "error": "resource not found."}), 404
    worker = threading.Thread(
        target=_run_learning_resource_generation,
        args=(str(record.get("id") or ""), target_id, username),
        name="learning-resource-regenerate",
        daemon=True,
    )
    worker.start()
    log_event(
        "learning_resource_regenerate_created",
        "学习资源已根据 scan 反馈创建新版本",
        payload={
            "resource_id": target_id,
            "version_id": updated.get("current_version_id"),
            "from_version_id": record.get("regenerate_from_version_id"),
            "username": username,
        },
    )
    return jsonify({"success": True, "task": record, "resource": updated})

@bp.route("/frontend/learning-resources/tasks", methods=["GET"])
def frontend_learning_resource_tasks():
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can view resource tasks."}), 403
    limit = min(100, max(1, _safe_int(request.args.get("limit"), 30)))
    rows = list_learning_resource_tasks(_cfg, limit=limit)
    return jsonify({"success": True, "items": rows, "total": len(rows)})

@bp.route("/frontend/learning-resources/topics", methods=["POST"])
def frontend_learning_resource_topics():
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can generate resource topics."}), 403
    data = request.get_json(silent=True) or {}
    if not isinstance(data, MappingABC):
        return jsonify({"success": False, "error": "request body must be an object."}), 400
    lecture_id = str(data.get("lecture_id") or "").strip()
    resource_type = str(data.get("resource_type") or "explainer").strip() or "explainer"
    if not lecture_id:
        return jsonify({"success": False, "error": "请选择课程后再生成资源选题。"}), 400

    lecture_title = _learning_resource_lecture_title(lecture_id)

    try:
        topics = _build_learning_resource_topic_suggestions(lecture_id, lecture_title, resource_type, username)
    except Exception as exc:
        error_message = str(exc or "学习资源选题生成失败。").strip()
        record = append_learning_resource_task(
            _cfg,
            {
                "task_type": "topic_suggestions",
                "status": "failed",
                "resource_type": resource_type,
                "lecture_id": lecture_id,
                "lecture_title": lecture_title,
                "title": f"{lecture_title} {_learning_resource_type_label(resource_type)}选题",
                "topics": [],
                "selected_topic_ids": [],
                "topic_source": "llm",
                "error_message": error_message,
                "created_by": username,
            },
        )
        log_event(
            "learning_resource_topics_failed",
            "学习资源选题生成失败",
            payload={
                "username": username,
                "lecture_id": lecture_id,
                "resource_type": resource_type,
                "error": error_message,
            },
        )
        return jsonify({"success": False, "error": error_message, "message": "学习资源选题生成失败。", "task": record}), 502

    record = append_learning_resource_task(
        _cfg,
        {
            "task_type": "topic_suggestions",
            "status": "topics_ready",
            "resource_type": resource_type,
            "lecture_id": lecture_id,
            "lecture_title": lecture_title,
            "title": f"{lecture_title} {_learning_resource_type_label(resource_type)}选题",
            "topics": topics,
            "selected_topic_ids": [row["id"] for row in topics[:3]],
            "topic_source": "llm",
            "created_by": username,
        },
    )
    log_event(
        "learning_resource_topics_created",
        "学习资源选题已生成",
        payload={"username": username, "lecture_id": lecture_id, "resource_type": resource_type, "topic_count": len(topics), "topic_source": "llm"},
    )
    return jsonify({"success": True, "task": record, "topics": topics})

@bp.route("/frontend/learning-resources/drafts", methods=["POST"])
def frontend_learning_resource_draft():
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can create resource drafts."}), 403
    data = request.get_json(silent=True) or {}
    if not isinstance(data, MappingABC):
        return jsonify({"success": False, "error": "request body must be an object."}), 400
    lecture_id = str(data.get("lecture_id") or "").strip()
    resource_type = str(data.get("resource_type") or "explainer").strip() or "explainer"
    lecture_title = _learning_resource_lecture_title(lecture_id)
    title = str(data.get("title") or "").strip()
    topics = _normalize_learning_resource_draft_topics(
        data.get("topics") if isinstance(data.get("topics"), list) else [],
        data.get("selected_topic_ids") if isinstance(data.get("selected_topic_ids"), list) else [],
    )
    selected_topic_ids = data.get("selected_topic_ids") if isinstance(data.get("selected_topic_ids"), list) else []

    draft_specs: List[Dict[str, Any]] = []

    for topic in topics:
        topic_title = str(topic.get("title") or "").strip()
        topic_id = str(topic.get("id") or "").strip()

        if topic_title:
            draft_specs.append(
                {
                    "title": topic_title,
                    "topics": [topic],
                    "selected_topic_ids": [topic_id] if topic_id else [],
                }
            )

    if not draft_specs:
        manual_title = title or f"{lecture_title} {_learning_resource_type_label(resource_type)}草稿"
        draft_specs.append(
            {
                "title": manual_title,
                "topics": [],
                "selected_topic_ids": [str(item or "").strip() for item in selected_topic_ids if str(item or "").strip()],
            }
        )

    created_rows = [
        _create_learning_resource_draft_job(
            lecture_id=lecture_id,
            lecture_title=lecture_title,
            resource_type=resource_type,
            title=str(spec.get("title") or "").strip(),
            topics=spec.get("topics") if isinstance(spec.get("topics"), list) else [],
            selected_topic_ids=spec.get("selected_topic_ids") if isinstance(spec.get("selected_topic_ids"), list) else [],
            username=username,
        )
        for spec in draft_specs
    ]
    tasks = [row["task"] for row in created_rows]
    resources = [row["resource"] for row in created_rows]
    log_event(
        "learning_resource_draft_created",
        "学习资源草稿任务已创建并开始生成正文",
        payload={
            "username": username,
            "lecture_id": lecture_id,
            "resource_type": resource_type,
            "draft_count": len(resources),
            "titles": [str(item.get("title") or "") for item in resources],
        },
    )
    return jsonify(
        {
            "success": True,
            "task": tasks[0] if tasks else None,
            "resource": resources[0] if resources else None,
            "tasks": tasks,
            "resources": resources,
            "total": len(resources),
        }
    )
