"""Frontend shell and dashboard routes."""

import json as _json
import queue as _queue

from flask import Response as _Response, stream_with_context as _stream_with_context

from core import runlog as _runlog

from api import routes as _routes

# The first split keeps common helpers in api.routes while route handlers move by domain.
_routes._export_route_context(globals())


def _send_frontend_html(filename: str):
    """发送前端 HTML 入口，保持每次可重新验证版本。"""
    response = send_from_directory(str(_FRONTEND_DIR), filename)
    response.headers["Cache-Control"] = "no-cache, must-revalidate"
    return response


def _send_frontend_asset(filename: str):
    """发送前端静态资源，带版本号的资源允许长期缓存。"""
    response = send_from_directory(str(_FRONTEND_ASSETS_DIR), filename)
    version_token = str(request.args.get("v") or "").strip()

    if version_token:
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    else:
        response.headers["Cache-Control"] = "public, max-age=3600"

    response.headers.pop("Pragma", None)
    return response


@bp.route("/frontend/", methods=["GET"])
def frontend_index():
    return _send_frontend_html("index.html")

@bp.route("/frontend/puzzle", methods=["GET"])
def frontend_puzzle():
    return _send_frontend_html("puzzle.html")

@bp.route("/sample/agents", methods=["GET"])
def sample_agents():
    """多智能体协作可视化面板(实时 runlog 事件 + 演示回放)。"""
    return _send_frontend_html("agents_sample.html")


def _agents_sse_frame(row):
    seq = int((row or {}).get("seq") or 0)
    return "id: " + str(seq) + "\nevent: runlog\ndata: " + _json.dumps(row, ensure_ascii=False) + "\n\n"


# 首次回放时在服务端过滤请求级噪音事件(与面板前端 NOISE_RE 对齐),避免占满回放窗口。
_AGENTS_BACKLOG_NOISE_PREFIXES = (
    "frontend_session_user_lookup",
    "frontend_context_",
    "runtime_user_resolution",
    "request_performance",
    "frontend_materials_slow",
    "learning_progress_user_resolution",
    "server_start",
    "frontend_video_search",
    "video_api_",
)


@bp.route("/sample/agents/events", methods=["GET"])
def sample_agents_events():
    """协作面板事件轮询接口:返回 since 之后的结构化 runlog 事件。"""
    try:
        since = int(request.args.get("since") or 0)
    except (TypeError, ValueError):
        since = 0
    rows = _runlog.recent_events(since_seq=since, limit=300)
    last_seq = int(rows[-1].get("seq") or 0) if rows else since
    return jsonify({"success": True, "events": rows, "last_seq": last_seq})


@bp.route("/sample/agents/stream", methods=["GET"])
def sample_agents_stream():
    """协作面板 SSE:首次连接回放服务启动以来的日志尾部,再实时推送;Last-Event-ID/since 断点续传。"""
    try:
        since = int(request.headers.get("Last-Event-ID") or request.args.get("since") or 0)
    except (TypeError, ValueError):
        since = 0
    # 服务重启后 seq 回卷,客户端携带的旧 seq 会吞掉新事件,此时从头回放。
    if since > _runlog.current_event_seq():
        since = 0

    def event_stream(start_seq: int):
        sub = _runlog.subscribe_events()
        try:
            last = start_seq
            if start_seq <= 0:
                # 首次连接:从当前运行的结构化日志尾部一次性回放(自服务器启动起记录)。
                backlog = _runlog.recent_file_events(
                    limit=80,
                    exclude_event_prefixes=_AGENTS_BACKLOG_NOISE_PREFIXES,
                )
            else:
                backlog = _runlog.recent_events(since_seq=start_seq, limit=300)
            for row in backlog:
                last = max(last, int(row.get("seq") or 0))
                yield _agents_sse_frame(row)
            yield "event: ready\ndata: {\"last_seq\": " + str(last) + "}\n\n"
            while True:
                try:
                    row = sub.get(timeout=15)
                except _queue.Empty:
                    yield "event: ping\ndata: {}\n\n"
                    continue
                seq = int((row or {}).get("seq") or 0)
                if seq <= last:
                    continue
                last = seq
                yield _agents_sse_frame(row)
        finally:
            _runlog.unsubscribe_events(sub)

    return _Response(
        _stream_with_context(event_stream(since)),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

@bp.route("/frontend/assets/<path:filename>", methods=["GET"])
def frontend_assets(filename: str):
    return _send_frontend_asset(filename)

@bp.route("/frontend/status", methods=["GET"])
def frontend_status():
    return _send_frontend_html("status.html")

@bp.route("/status/overview", methods=["GET"])
def frontend_status_overview():
    viewer = _resolve_status_viewer()
    return jsonify({"success": True, "status": build_status_overview(_cfg, viewer=viewer)})

@bp.route("/frontend/context", methods=["GET"])
def frontend_context():
    requested_username = str(request.args.get("username") or "").strip()
    header_username = ""
    for header_name in (
        "X-Nexora-Username",
        "X-Username",
        "X-User",
        "X-User-Id",
        "X-Auth-User",
        "X-Forwarded-User",
    ):
        candidate = str(request.headers.get(header_name) or "").strip()
        if candidate:
            header_username = candidate
            break
    username = requested_username or header_username
    user_payload: Dict[str, Any] = {}
    is_admin = False
    integration: Dict[str, Any] = {
        "base_url": "",
        "endpoint": "",
        "connected": False,
        "models_count": 0,
        "message": "",
        "has_nexora_api_key": False,
    }
    if _proxy is not None:
        integration["base_url"] = str(getattr(_proxy, "base_url", "") or "")
        integration["endpoint"] = str(getattr(_proxy, "models_path", "") or "")
        integration["has_nexora_api_key"] = bool(str(getattr(_proxy, "api_key", "") or "").strip())
        # 优先使用当前会话用户，避免默认用户（如 guest）覆盖真实登录态。
        if not requested_username and not header_username:
            session_result = _fetch_session_user_from_nexora(use_cache=False)
            if session_result.get("success"):
                user_payload = session_result.get("user") if isinstance(session_result.get("user"), dict) else {}
                role = str(user_payload.get("role") or "").strip().lower()
                is_admin = role == "admin"
                if not username:
                    username = str(
                        user_payload.get("id")
                        or user_payload.get("username")
                        or ""
                    ).strip()

        # 会话解析不到时，只允许显式用户名继续；否则直接返回认证错误。
        if not user_payload:
            if not username and not requested_username and not header_username:
                log_event(
                    "frontend_context_auth_missing",
                    "Frontend context rejected because Nexora session user could not be resolved.",
                    payload={
                        "has_cookie": bool(str(request.headers.get("Cookie") or "").strip()),
                        "integration_base_url": str(integration.get("base_url") or "").strip(),
                    },
                )
                return jsonify(
                    {
                        "success": False,
                        "error": "Nexora 登录态缺失，请从已登录的 Nexora 页面进入 NexoraLearning。",
                        "integration": integration,
                    }
                ), 401

            result = _get_cached_nexora_user_info(username, use_cache=False)

            if result.get("success"):
                user_payload = result.get("user") if isinstance(result.get("user"), dict) else {}
                role = str(user_payload.get("role") or "").strip().lower()
                is_admin = role == "admin"

                if not username:
                    username = str(
                        user_payload.get("id")
                        or user_payload.get("username")
                        or ""
                    ).strip()

        probe = _proxy.list_models(username=username or None)
        if probe.get("success"):
            payload = probe.get("payload") if isinstance(probe.get("payload"), dict) else {}
            models_count = 0
            data_field = payload.get("data")
            models_field = payload.get("models")
            if isinstance(data_field, list):
                models_count = len(data_field)
            elif isinstance(models_field, list):
                models_count = len(models_field)
            elif isinstance(models_field, dict):
                models_count = len(models_field.keys())
            integration["connected"] = True
            integration["models_count"] = int(models_count)
            integration["message"] = ""
        else:
            integration["connected"] = False
            integration["message"] = str(probe.get("message") or "").strip()
    elif not username:
        log_event(
            "frontend_context_proxy_missing",
            "Frontend context rejected because Nexora proxy is not initialized.",
            payload={
                "has_cookie": bool(str(request.headers.get("Cookie") or "").strip()),
            },
        )
        return jsonify(
            {
                "success": False,
                "error": "NexoraLearning 未初始化 Nexora 代理，无法解析当前登录用户。",
                "integration": integration,
            }
        ), 503

    log_event(
        "frontend_context_resolution",
        "Resolved frontend context user.",
        payload={
            "requested_username": requested_username,
            "header_username": header_username,
            "resolved_username": str(username or "").strip(),
            "resolved_user_id": str(user_payload.get("id") or "").strip() if isinstance(user_payload, dict) else "",
            "resolved_role": str(user_payload.get("role") or "").strip() if isinstance(user_payload, dict) else "",
            "is_admin": bool(is_admin),
            "has_cookie": bool(str(request.headers.get("Cookie") or "").strip()),
            "integration_connected": bool(integration.get("connected")),
            "integration_message": str(integration.get("message") or "").strip(),
        },
    )

    return jsonify(
        {
            "success": True,
            "username": username,
            "user": user_payload,
            "is_admin": bool(is_admin),
            "integration": integration,
            "runtime_api": {
                "enabled": _runtime_api_enabled(),
                "base_path": "/api/runtime",
                "frontend_url": _resolve_learning_frontend_url(),
            },
        }
    )

@bp.route("/frontend/materials", methods=["GET"])
def frontend_materials():
    started_at = time.perf_counter()
    sort_by = str(request.args.get("sort_by") or "updated_at").strip().lower() or "updated_at"
    order = str(request.args.get("order") or "desc").strip().lower() or "desc"
    desc = order != "asc"

    user_id = _resolve_runtime_user_id()
    learning_records = user_store.list_learning_records(_cfg, user_id) if user_id else []
    study_hours_map = _build_user_study_hours_map(user_id, records=learning_records) if user_id else {}
    teacher_info_cache: Dict[str, Dict[str, Any]] = {}

    lectures = list_learning_lectures(_cfg)
    rows = []
    total_books = 0

    def _resolve_teacher_infos_for_materials(teacher_ids: List[str]) -> List[Dict[str, Any]]:
        resolved_rows: List[Dict[str, Any]] = []
        missing_ids: List[str] = []

        for teacher_id in teacher_ids:
            uid = str(teacher_id or "").strip()
            if not uid:
                continue

            cached = teacher_info_cache.get(uid)
            if cached is not None:
                resolved_rows.append(dict(cached))
            else:
                missing_ids.append(uid)

        if missing_ids:
            fetched_rows = _resolve_teacher_infos(missing_ids)
            for row in fetched_rows:
                if not isinstance(row, dict):
                    continue

                uid = str(row.get("user_id") or row.get("username") or "").strip()
                if uid:
                    teacher_info_cache[uid] = dict(row)

            for uid in missing_ids:
                cached = teacher_info_cache.get(uid)
                if cached is not None:
                    resolved_rows.append(dict(cached))

        return resolved_rows

    for lecture in lectures:
        lecture_id = str((lecture or {}).get("id") or "").strip()
        books = list_lecture_books(_cfg, lecture_id) if lecture_id else []
        total_books += len(books)
        lecture_with_user = dict(lecture or {})
        # Resolve teacher user IDs to objects with avatar_url
        raw_teacher = lecture_with_user.get("teacher") or []
        if isinstance(raw_teacher, list) and raw_teacher:
            lecture_with_user["teacher_info"] = _resolve_teacher_infos_for_materials([
                str(t or "") for t in raw_teacher
            ])
        if user_id and lecture_id:
            user_progress = _compute_user_lecture_progress(user_id, lecture_id, books, records=learning_records)
            lecture_with_user["progress"] = user_progress["progress"]
            lecture_with_user["current_chapter"] = user_progress["current_chapter"]
            lecture_with_user["next_chapter"] = user_progress["next_chapter"]
            lecture_with_user["study_hours"] = float(study_hours_map.get(lecture_id, 0.0))
        rows.append(
            {
                "lecture": lecture_with_user,
                "books": books,
                "books_count": len(books),
            }
        )

    def _row_sort_key(row: Dict[str, Any]):
        lecture = row.get("lecture") if isinstance(row.get("lecture"), dict) else {}
        books = row.get("books") if isinstance(row.get("books"), list) else []
        if sort_by == "title":
            return str((lecture or {}).get("title") or "").strip().lower()
        if sort_by == "progress":
            return int((lecture or {}).get("progress") or 0)
        if sort_by == "books_count":
            return int(row.get("books_count") or 0)
        if sort_by == "study_hours":
            return float((lecture or {}).get("study_hours") or 0.0)
        if sort_by == "book_updated_at":
            latest = 0
            for book in books:
                if not isinstance(book, dict):
                    continue
                latest = max(latest, int(book.get("updated_at") or 0))
            return latest
        if sort_by == "created_at":
            return int((lecture or {}).get("created_at") or 0)
        return int((lecture or {}).get("updated_at") or 0)

    rows.sort(key=_row_sort_key, reverse=desc)
    duration_ms = int((time.perf_counter() - started_at) * 1000)

    if duration_ms >= 800:
        log_event(
            "frontend_materials_slow",
            "NexoraLearning materials list request exceeded the slow threshold.",
            payload={
                "duration_ms": duration_ms,
                "lectures": len(rows),
                "total_books": total_books,
                "user_id": user_id,
                "teacher_cache_size": len(teacher_info_cache),
            },
        )

    return jsonify(
        {
            "success": True,
            "lectures": rows,
            "total_lectures": len(rows),
            "total_books": total_books,
            "sort_by": sort_by,
            "order": "desc" if desc else "asc",
            "duration_ms": duration_ms,
        }
    )

@bp.route("/frontend/dashboard", methods=["GET"])
def frontend_dashboard():
    user_id = _resolve_runtime_user_id()
    learning_records = user_store.list_learning_records(_cfg, user_id)
    selected_lecture_ids = set(user_store.list_selected_lecture_ids(_cfg, user_id))
    study_hours_map = _build_user_study_hours_map(user_id, records=learning_records)
    last_active_map = _build_user_lecture_last_active_map(user_id, records=learning_records)

    lectures = list_learning_lectures(_cfg)
    selected_rows = []
    total_books = 0
    total_study_hours = 0.0
    for lecture in lectures:
        lecture_id = str((lecture or {}).get("id") or "").strip()
        if not lecture_id or lecture_id not in selected_lecture_ids:
            continue
        lecture_with_user_state = dict(lecture or {})
        lecture_hours = float(study_hours_map.get(lecture_id, 0.0))
        lecture_with_user_state["study_hours"] = lecture_hours
        lecture_with_user_state["last_active_ts"] = int(last_active_map.get(lecture_id, 0))
        total_study_hours += lecture_hours
        books = list_lecture_books(_cfg, lecture_id)
        total_books += len(books)
        user_progress = _compute_user_lecture_progress(user_id, lecture_id, books, records=learning_records)
        lecture_with_user_state["progress"] = user_progress["progress"]
        lecture_with_user_state["current_chapter"] = user_progress["current_chapter"]
        lecture_with_user_state["next_chapter"] = user_progress["next_chapter"]
        selected_rows.append(
            {
                "lecture": lecture_with_user_state,
                "books": books,
                "books_count": len(books),
            }
        )

    return jsonify(
        {
            "success": True,
            "user_id": user_id,
            "selected_lecture_ids": sorted(selected_lecture_ids),
            "lectures": selected_rows,
            "total_lectures": len(selected_rows),
            "total_books": total_books,
            "total_study_hours": round(total_study_hours, 3),
        }
    )

@bp.route("/frontend/notifications", methods=["GET"])
def frontend_notifications():
    """返回首页右侧通知面板数据。"""
    user_id = _resolve_runtime_user_id()

    try:
        limit = int(request.args.get("limit") or 20)
    except (TypeError, ValueError):
        limit = 20

    limit = max(1, min(limit, 50))
    notifications = user_store.list_notifications(_cfg, user_id)
    rows = [
        _enrich_feed_notice_actor(row)
        for row in notifications
        if isinstance(row, dict) and not bool(row.get("removed"))
    ][:limit]

    return jsonify(
        {
            "success": True,
            "user_id": user_id,
            "items": rows,
            "admin_pending_parse": _build_pending_parse_summary() if _is_runtime_admin() else {"count": 0, "items": []},
        }
    )

@bp.route("/frontend/notifications/<notification_id>/remove", methods=["POST"])
def frontend_notification_remove(notification_id: str):
    """将首页通知标记为已移除。"""
    user_id = _resolve_runtime_user_id()
    user_store.ensure_user_files(_cfg, user_id)
    result = user_store.mark_notification_removed(_cfg, user_id, notification_id)

    if not result.get("updated"):
        return jsonify({"success": False, "error": "notification not found."}), 404

    return jsonify({"success": True, **result})

@bp.route("/frontend/profile", methods=["GET"])
def frontend_profile():
    """返回用户画像的结构化维度数据。"""
    user_id = _resolve_runtime_user_id()

    from core.memory import PROFILE_DIMENSIONS, parse_profile_dimensions, parse_profile_timeline

    user_md = str(user_store.read_memory(_cfg, user_id, "user") or "")
    dimensions = parse_profile_dimensions(user_md)
    timeline = parse_profile_timeline(user_md)

    filled_count = sum(1 for d in dimensions.values() if d.get("filled"))
    total_count = len(PROFILE_DIMENSIONS)
    completion_rate = round(filled_count / total_count, 3) if total_count > 0 else 0.0

    return jsonify(
        {
            "success": True,
            "user_id": user_id,
            "dimensions": dimensions,
            "timeline": timeline,
            "completion_rate": completion_rate,
            "filled_count": filled_count,
            "total_count": total_count,
        }
    )

@bp.route("/frontend/learning/report", methods=["GET"])
def frontend_learning_report():
    """返回课程/章节学习报告，聚合进度、阅读行为、测验和画像数据。"""
    user_id = _resolve_runtime_user_id()
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    lecture_id = str(request.args.get("lecture_id") or "").strip()
    book_id = str(request.args.get("book_id") or "").strip()
    chapter_index = _safe_int(request.args.get("chapter_index"), -1)

    if not lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required."}), 400

    lecture = get_learning_lecture(_cfg, lecture_id)
    if not isinstance(lecture, MappingABC):
        return jsonify({"success": False, "error": "lecture not found."}), 404

    books = list_lecture_books(_cfg, lecture_id)
    learning_records = user_store.list_learning_records(_cfg, user_id)
    question_records = user_store.list_question_completions(_cfg, user_id)
    study_hours_map = _build_user_study_hours_map(user_id, records=learning_records)

    from core.user.learning_progress import list_lecture_chapter_names as _list_lecture_chapter_names

    chapter_names = _list_lecture_chapter_names(lecture_id, books)
    scoped_learning_records = [
        row for row in learning_records
        if _learning_report_record_matches(row, lecture_id, book_id, chapter_index)
    ]
    completed_chapter_names = {
        str(row.get("chapter_name") or "").strip()
        for row in scoped_learning_records
        if str(row.get("type") or "").strip() == "chapter_completed" and str(row.get("chapter_name") or "").strip()
    }
    completed_sessions = sum(
        1
        for row in scoped_learning_records
        if str(row.get("type") or "").strip() == "session_completed"
    )
    total_sessions = _learning_report_count_sessions(lecture_id, books, book_id=book_id)
    progress_info = _compute_user_lecture_progress(user_id, lecture_id, books, records=learning_records)
    question_stats = _learning_report_question_stats(question_records, lecture_id, book_id, chapter_index)
    reading_stats = _learning_report_reading_stats(user_id, lecture_id, books, book_id=book_id)
    profile = _learning_report_profile_summary(user_id)
    weaknesses, recommendations = _learning_report_recommendations(
        progress_info,
        profile,
        question_stats,
        completed_sessions,
        total_sessions,
    )

    return jsonify({
        "success": True,
        "user_id": user_id,
        "lecture_id": lecture_id,
        "lecture_title": str(lecture.get("title") or lecture_id).strip(),
        "scope": {
            "book_id": book_id,
            "chapter_index": chapter_index,
        },
        "summary": {
            "progress_percent": _safe_int(progress_info.get("progress"), 0),
            "completed_chapters": len(completed_chapter_names),
            "total_chapters": len(chapter_names),
            "completed_sessions": completed_sessions,
            "total_sessions": total_sessions,
            "study_hours": round(float(study_hours_map.get(lecture_id, 0.0)), 2),
            "submitted_questions": _safe_int(question_stats.get("submitted"), 0),
            "reviewed_questions": _safe_int(question_stats.get("reviewed"), 0),
            "correct_questions": _safe_int(question_stats.get("correct"), 0),
            "accuracy": question_stats.get("accuracy"),
            "profile_completion_rate": profile.get("completion_rate"),
        },
        "progress": progress_info,
        "reading": reading_stats,
        "quiz": question_stats,
        "profile": profile,
        "weaknesses": weaknesses,
        "recommendations": recommendations,
        "recent_records": _learning_report_recent_records(learning_records, lecture_id, book_id, chapter_index),
        "generated_at": int(time.time()),
    })

@bp.route("/frontend/learning-path", methods=["POST"])
def frontend_learning_path():
    """生成个性化学习路径。基于章节结构 + 用户画像，用 LLM 生成推荐顺序和原因。"""
    user_id = _resolve_runtime_user_id()
    user_store.ensure_user_files(_cfg, user_id)
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    force = bool(data.get("force"))
    cache_version = 3
    allowed_statuses = {"completed", "current", "recommended", "pending"}

    def _sanitize_path_items(raw_items):
        items = raw_items if isinstance(raw_items, list) else []
        sanitized = []

        for item in items:
            if not isinstance(item, dict):
                continue

            name = str(item.get("name") or "").strip()
            if not name:
                continue

            status = str(item.get("status") or "").strip().lower()
            if status not in allowed_statuses:
                continue

            priority_num = item.get("priority")
            try:
                priority = int(priority_num)
            except Exception:
                continue

            sanitized.append({
                "name": name,
                "priority": priority,
                "status": status,
                "reason": str(item.get("reason") or "").strip(),
            })

        return sanitized

    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400

    # 检查持久化缓存
    cache_path = _learning_path_cache_path(lecture_id, book_id, user_id)
    if not force and cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            cached_path = _sanitize_path_items(cached.get("path") if isinstance(cached, dict) else [])
            if (
                isinstance(cached, dict)
                and int(cached.get("version") or 0) == cache_version
                and cached_path
                and all(str(item.get("reason") or "").strip() for item in cached_path)
            ):
                return jsonify({"success": True, "advice": cached.get("advice", ""), "path": cached_path, "cached": True})
        except Exception:
            pass

    from core.memory import PROFILE_DIMENSIONS, parse_profile_dimensions
    from core.booksproc import build_memory_runner, get_memory_settings

    # 读取章节结构
    bookinfo_xml = str(load_book_info_xml(_cfg, lecture_id, book_id) or "")
    if not bookinfo_xml:
        return jsonify({"success": False, "error": "Book info not found. Please run coarse reading first."}), 404

    # 解析章节列表
    import re as _re
    all_chapters = []
    for m in _re.finditer(
        r"<chapter_name>\s*(.*?)\s*</chapter_name>[\s\S]*?<chapter_range>\s*(.*?)\s*</chapter_range>[\s\S]*?<chapter_summary>\s*(.*?)\s*</chapter_summary>",
        bookinfo_xml, flags=_re.IGNORECASE | _re.DOTALL,
    ):
        all_chapters.append({
            "name": str(m.group(1) or "").strip(),
            "range": str(m.group(2) or "").strip(),
            "summary": str(m.group(3) or "").strip()[:200],
        })

    if not all_chapters:
        return jsonify({"success": False, "error": "No chapters found in bookinfo."}), 404

    # 读取用户画像
    user_md = str(user_store.read_memory(_cfg, user_id, "user") or "")
    profile_dims = parse_profile_dimensions(user_md)
    weak_areas = profile_dims.get("weak_areas", {}).get("value", "")
    interest = profile_dims.get("interest_direction", {}).get("value", "")
    learning_pace = profile_dims.get("learning_pace", {}).get("value", "")

    # 读取已完成章节
    records = user_store.list_learning_records(_cfg, user_id)
    completed = set()
    for r in (records or []):
        if isinstance(r, dict) and str(r.get("type") or "").strip() == "chapter_completed" and str(r.get("lecture_id") or "").strip() == lecture_id:
            completed.add(str(r.get("chapter_name") or "").strip())

    # 只把未完成的章节传给模型，已完成的不参与路径规划
    incomplete_chapters = [c for c in all_chapters if c["name"] not in completed]

    chapters_json = json.dumps(incomplete_chapters, ensure_ascii=False)
    profile_summary = json.dumps({
        "weak_areas": weak_areas,
        "interest_direction": interest,
        "learning_pace": learning_pace,
        "completed_count": len(completed),
        "total_count": len(all_chapters),
    }, ensure_ascii=False)

    # 调用 LLM 生成路径（直接用 completions API，避免 memory model 的 system prompt 干扰）
    chapters_brief = [{"name": c["name"], "summary": c["summary"][:100]} for c in incomplete_chapters]
    chapters_brief_json = json.dumps(chapters_brief, ensure_ascii=False)

    from prompts import LEARNING_PATH_SYSTEM_PROMPT, LEARNING_PATH_USER_PROMPT
    user_prompt = LEARNING_PATH_USER_PROMPT.replace(
        "{{chapters_json}}", chapters_brief_json
    ).replace(
        "{{profile_summary}}", profile_summary
    )

    advice_text = ""
    path_items = []

    try:
        proxy = _cfg.get("__proxy__")
        if proxy is None:
            from core.nexora_proxy import NexoraProxy as _NP
            proxy = _NP(_cfg)
            _cfg["__proxy__"] = proxy
        messages = [
            {"role": "system", "content": LEARNING_PATH_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]
        default_model = get_default_nexora_model(_cfg)
        result = proxy.complete_raw(
            messages=messages,
            model=default_model or None,
            username=user_id,
            api_mode="chat",
            options={"temperature": 0.3, "max_output_tokens": 2000},
            request_timeout=120,
        )
        if not result.get("success"):
            raise RuntimeError(str(result.get("message") or "API调用失败"))
        result_text = str(result.get("content") or "")
        # 提取建议文本
        advice_match = _re.search(r"<advice>\s*(.*?)\s*</advice>", result_text, flags=_re.DOTALL)
        advice_text = str(advice_match.group(1) or "").strip() if advice_match else ""
        # 提取 JSON
        json_match = _re.search(r"\[[\s\S]*\]", str(result_text or ""))
        if json_match:
            path_items = json.loads(json_match.group(0))
        else:
            path_items = []
    except Exception as exc:
        log_event("learning_path_error", "学习路径生成失败", payload={"error": str(exc)})
        return jsonify({"success": False, "error": f"学习路径生成失败：{str(exc)}"}), 502

    path_items = _sanitize_path_items(path_items)
    if not path_items:
        return jsonify({"success": False, "error": "模型未返回有效推荐阅读。"}), 502

    if not all(str(item.get("reason") or "").strip() for item in path_items):
        return jsonify({"success": False, "error": "模型未为推荐阅读编写完整理由。"}), 502

    # 持久化缓存
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({"version": cache_version, "advice": advice_text, "path": path_items}, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass

    return jsonify({"success": True, "advice": advice_text, "path": path_items})

@bp.route("/frontend/card", methods=["POST"])
def frontend_card():
    data = request.get_json(silent=True) or {}
    card_type = str(data.get("type") or "").strip()
    if not card_type:
        return jsonify({"success": False, "error": "type is required."}), 400
    try:
        if card_type == "lecture_display":
            lecture_id = str(data.get("lecture_id") or "").strip()
            if not lecture_id:
                return jsonify({"success": False, "error": "lecture_id is required."}), 400
            payload = _build_lecture_display_card_payload(lecture_id)
        elif card_type == "chapter_range":
            lecture_id = str(data.get("lecture_id") or "").strip()
            book_id = str(data.get("book_id") or "").strip()
            content_range = data.get("content_range")
            if not lecture_id or not book_id:
                return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
            payload = _build_chapter_range_card_payload(lecture_id, book_id, content_range)
        else:
            return jsonify({"success": False, "error": f"unsupported card type: {card_type}"}), 400
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500
    return jsonify({"success": True, "card": payload})

@bp.route("/frontend/learning/select", methods=["POST"])
def frontend_select_learning_lecture():
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    if not lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required."}), 400

    lecture, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    selected = _as_bool(data.get("selected"), default=True)
    user_id = _resolve_runtime_user_id()
    user_store.ensure_user_files(_cfg, user_id)
    user_store.set_lecture_selection(
        _cfg,
        user_id,
        lecture_id,
        selected=selected,
        actor=str(data.get("actor") or "").strip(),
    )
    selected_ids = user_store.list_selected_lecture_ids(_cfg, user_id)
    return jsonify(
        {
            "success": True,
            "user_id": user_id,
            "lecture": lecture,
            "selected": bool(selected),
            "selected_lecture_ids": selected_ids,
        }
    )
