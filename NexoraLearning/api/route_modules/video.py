"""Video and learning-resource push routes."""

from api import routes as _routes

# The first split keeps common helpers in api.routes while route handlers move by domain.
_routes._export_route_context(globals())


@bp.route("/frontend/videos", methods=["GET"])
def frontend_videos():
    """获取课程相关视频（从缓存读取，粗读时自动生成）。"""
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    book_id = str(request.args.get("book_id") or "").strip()
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400

    from core.video_search import has_video_search_cache, load_cached_videos

    if has_video_search_cache(_cfg, lecture_id, book_id):
        items = load_cached_videos(_cfg, lecture_id, book_id)
        return jsonify({"success": True, "items": items, "cached": True})

    try:
        items = _run_frontend_video_search(lecture_id, book_id)
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "items": []}), 500

    return jsonify({"success": True, "items": items, "cached": False})

@bp.route("/frontend/lecture-videos", methods=["GET"])
def frontend_lecture_videos():
    """读取课程下所有教材已经缓存的视频，不触发新的视频搜索。"""
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    if not lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required."}), 400

    from core.video_search import load_cached_videos

    items: List[Dict[str, Any]] = []
    seen_urls: set[str] = set()
    books = list_lecture_books(_cfg, lecture_id)
    cached_book_count = 0

    for book in books:
        if not isinstance(book, MappingABC):
            continue

        book_id = str(book.get("id") or "").strip()
        if not book_id:
            continue

        rows = load_cached_videos(_cfg, lecture_id, book_id)
        if not rows:
            continue

        cached_book_count += 1
        book_title = str(book.get("title") or book_id).strip()

        for row in rows:
            if not isinstance(row, dict):
                continue

            url = str(row.get("url") or "").strip()
            if not url or url in seen_urls:
                continue

            seen_urls.add(url)
            item = dict(row)
            item["lecture_id"] = lecture_id
            item["book_id"] = book_id
            item["book_title"] = book_title
            items.append(item)

    return jsonify(
        {
            "success": True,
            "items": items,
            "cached": True,
            "book_count": len(books),
            "cached_book_count": cached_book_count,
        }
    )

@bp.route("/frontend/learning-resource-pushes", methods=["GET"])
def frontend_learning_resource_pushes():
    """后端统一抽取资源中心推送项。"""
    user_id = _resolve_runtime_user_id()
    user_store.ensure_user_files(_cfg, user_id)
    refresh = _as_bool(request.args.get("refresh"), default=False)
    selected_lecture_ids = [
        str(item or "").strip()
        for item in user_store.list_selected_lecture_ids(_cfg, user_id)
        if str(item or "").strip()
    ]

    candidate_rows, source_errors = _build_learning_resource_push_candidates(selected_lecture_ids)
    selected_rows, state = _select_learning_resource_push_rows(user_id, candidate_rows, refresh=refresh)
    stats = _learning_resource_push_stats(selected_rows)

    return jsonify(
        {
            "success": True,
            "items": selected_rows,
            "stats": stats,
            "candidate_count": len(candidate_rows),
            "selected_lecture_ids": selected_lecture_ids,
            "errors": source_errors,
            "state": {
                "current_ids": state.get("current_ids", []),
                "previous_ids": state.get("previous_ids", []),
                "signature": state.get("signature", ""),
            },
        }
    )

@bp.route("/frontend/video-generator/status", methods=["GET"])
def frontend_video_generator_status():
    """读取 NexoraVideoGenerator 服务状态。"""
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can access this endpoint."}), 403

    try:
        status, payload = _request_video_generator_json("/health", method="GET")
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 502

    return jsonify({
        "success": status < 400,
        "status": payload,
    }), 200 if status < 400 else status

@bp.route("/frontend/video-generator/projects", methods=["GET"])
def frontend_video_generator_projects():
    """读取 NexoraVideoGenerator 项目列表。"""
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can access this endpoint."}), 403

    limit = str(request.args.get("limit") or "50").strip()
    query = urllib_parse.urlencode({"limit": limit})

    try:
        status, payload = _request_video_generator_json(f"/api/projects?{query}", method="GET")
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 502

    return jsonify(payload), 200 if status < 400 else status

@bp.route("/frontend/video-generator/projects", methods=["POST"])
def frontend_video_generator_create_project():
    """从 NexoraLearning 课程资料创建视频生成项目。"""
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can create video projects."}), 403

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"success": False, "error": "JSON body is required."}), 400

    try:
        payload = _build_video_generator_learning_payload(data)
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    try:
        status, response_payload = _request_video_generator_json(
            "/api/projects/from-learning",
            method="POST",
            payload=payload,
        )
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 502

    if status >= 400 or response_payload.get("success") is False:
        return jsonify(response_payload), status

    project = response_payload.get("project") if isinstance(response_payload.get("project"), dict) else {}
    project_id = str(project.get("id") or "").strip()

    if not project_id:
        return jsonify({"success": False, "error": "VideoGenerator did not return project.id."}), 502

    queued = _start_video_generator_pipeline(project_id, "outline")
    response_payload["auto_run"] = {
        "queued": queued,
        "start_stage": "outline",
        "stages": list(_VIDEO_GENERATOR_STAGES),
    }

    return jsonify(response_payload), 202

@bp.route("/frontend/video-generator/projects/<project_id>", methods=["GET"])
def frontend_video_generator_project(project_id: str):
    """读取单个视频生成项目。"""
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can access this endpoint."}), 403

    try:
        safe_project_id = _safe_video_generator_path_part(project_id, "project_id")
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    if safe_stage not in _VIDEO_GENERATOR_STAGES:
        return jsonify({"success": False, "error": f"stage is not allowed: {safe_stage}"}), 400

    try:
        status, payload = _request_video_generator_json(f"/api/projects/{safe_project_id}", method="GET")
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 502

    return jsonify(payload), 200 if status < 400 else status

@bp.route("/frontend/video-generator/projects/<project_id>/stages/<stage>", methods=["POST"])
def frontend_video_generator_run_stage(project_id: str, stage: str):
    """从指定阶段开始继续执行视频生成项目。"""
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can run video project stages."}), 403

    try:
        safe_project_id = _safe_video_generator_path_part(project_id, "project_id")
        safe_stage = _safe_video_generator_path_part(stage, "stage")
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    try:
        status, payload = _request_video_generator_json(f"/api/projects/{safe_project_id}", method="GET")
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 502

    if status >= 400 or payload.get("success") is False:
        return jsonify(payload), status

    queued = _start_video_generator_pipeline(safe_project_id, safe_stage)

    return jsonify({
        "success": True,
        "project": payload.get("project"),
        "auto_run": {
            "queued": queued,
            "start_stage": safe_stage,
            "stages": list(_VIDEO_GENERATOR_STAGES[_VIDEO_GENERATOR_STAGES.index(safe_stage):]),
        },
    }), 202

@bp.route("/frontend/video-generator/projects/<project_id>/artifacts/<path:artifact_name>", methods=["GET"])
def frontend_video_generator_artifact(project_id: str, artifact_name: str):
    """读取视频生成项目 JSON 产物。"""
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can access this endpoint."}), 403

    try:
        safe_project_id = _safe_video_generator_path_part(project_id, "project_id")
        safe_artifact = _safe_video_generator_relative_path(artifact_name)
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    try:
        status, payload = _request_video_generator_json(
            f"/api/projects/{safe_project_id}/artifacts/{safe_artifact}",
            method="GET",
        )
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 502

    return jsonify(payload), 200 if status < 400 else status

@bp.route("/frontend/video-generator/projects/<project_id>/files/<path:relative_path>", methods=["GET"])
def frontend_video_generator_file(project_id: str, relative_path: str):
    """转发视频生成项目文件，供前端预览或下载。"""
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can access this endpoint."}), 403

    try:
        safe_project_id = _safe_video_generator_path_part(project_id, "project_id")
        safe_relative_path = _safe_video_generator_relative_path(relative_path)
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    try:
        status, body, content_type, headers = _request_video_generator_bytes(
            f"/api/projects/{safe_project_id}/files/{safe_relative_path}",
            request_headers=_video_generator_file_request_headers(),
        )
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 502

    response_headers = _video_generator_file_response_headers(headers)
    log_event(
        "video_generator_file_proxy",
        "视频生成文件代理响应",
        payload={
            "project_id": safe_project_id,
            "relative_path": safe_relative_path,
            "status": status,
            "range": str(request.headers.get("Range") or "").strip(),
            "content_range": str(response_headers.get("Content-Range") or "").strip(),
            "content_length": str(response_headers.get("Content-Length") or "").strip(),
        },
    )

    return Response(
        body,
        status=status,
        content_type=content_type,
        headers=response_headers,
    )

@bp.route("/frontend/videos/refresh", methods=["POST"])
def frontend_videos_refresh():
    """强制刷新视频（删除缓存后重新搜索）。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400

    from core.video_search import _videos_path as _vp
    cache_path = _vp(_cfg, lecture_id, book_id)
    if cache_path.exists():
        cache_path.unlink()

    try:
        items = _run_frontend_video_search(lecture_id, book_id)
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "items": []}), 500

    return jsonify({"success": True, "items": items, "cached": False})
