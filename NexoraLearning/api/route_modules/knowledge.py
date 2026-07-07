"""Knowledge graph and teacher dashboard routes."""

from api import routes as _routes

# The first split keeps common helpers in api.routes while route handlers move by domain.
_routes._export_route_context(globals())


@bp.route("/frontend/knowledge-graph", methods=["GET"])
def frontend_knowledge_graph():
    """读取已缓存的知识图谱。"""
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    book_id = str(request.args.get("book_id") or "").strip()
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400

    from core.knowledge_graph import load_cached_graph
    graph = load_cached_graph(_cfg, lecture_id, book_id)
    if graph:
        return jsonify({"success": True, "graph": graph, "cached": True})

    return jsonify({"success": True, "graph": None, "cached": False})

@bp.route("/frontend/knowledge-graph/generate", methods=["POST"])
def frontend_knowledge_graph_generate():
    """手动触发知识图谱生成。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400

    lecture = get_learning_lecture(_cfg, lecture_id)
    if not lecture:
        return jsonify({"success": False, "error": "Lecture not found."}), 404

    lecture_title = str(lecture.get("title") or "").strip()
    bookinfo_xml = str(load_book_info_xml(_cfg, lecture_id, book_id) or "")
    bookdetail_xml = str(load_book_detail_xml(_cfg, lecture_id, book_id) or "")

    # 获取教材标题
    book_title = ""
    books = list_lecture_books(_cfg, lecture_id)
    for book in books:
        if str(book.get("id") or "") == book_id:
            book_title = str(book.get("title") or "").strip()
            break

    try:
        from core.knowledge_graph import generate_knowledge_graph
        graph = generate_knowledge_graph(
            _cfg, lecture_id, book_id,
            lecture_title=lecture_title,
            book_title=book_title,
            bookinfo_xml=bookinfo_xml,
            bookdetail_xml=bookdetail_xml,
        )
        return jsonify({"success": True, "graph": graph, "cached": False})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500

@bp.route("/frontend/teacher/class-overview", methods=["GET"])
def frontend_teacher_class_overview():
    """教师 Panel 数据接口：返回全班学生的阅读状态与章节进度。"""
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can access this endpoint."}), 403

    lecture_id = str(request.args.get("lecture_id") or "").strip()
    lectures = list_learning_lectures(_cfg)
    if not lecture_id and lectures:
        lecture_id = str(lectures[0].get("id") or "").strip()

    # ── 章节列表（热力图列头） ──
    lecture_chapters: List[Dict[str, Any]] = []
    if lecture_id:
        books = list_lecture_books(_cfg, lecture_id)
        from core.user.learning_progress import list_lecture_chapters as _list_lp_chapters, \
            list_completed_chapter_names as _list_completed_names
        lecture_chapters = _list_lp_chapters(lecture_id, books)

    chapter_names = [str(c.get("title") or "").strip() for c in lecture_chapters if c.get("title")]

    # ── 遍历全班学生 ──
    students: List[Dict[str, Any]] = []
    for u in user_store.list_users(_cfg):
        if not isinstance(u, dict):
            continue
        uid = str(u.get("id") or "").strip()
        identity = str(u.get("identity") or "").strip().lower()
        if not uid or identity not in ("student", ""):
            continue
        # identity 为空也算学生（兼容旧行为）

        username = str(u.get("username") or uid).strip()
        display_name = str(u.get("display_name") or u.get("nickname") or "").strip() or username

        selected_ids = user_store.list_selected_lecture_ids(_cfg, uid)
        is_in_course = lecture_id in selected_ids if lecture_id else False

        # 学习时长
        study_hours_map = _build_user_study_hours_map(uid)
        lecture_hours = float(study_hours_map.get(lecture_id, 0.0)) if lecture_id else 0.0

        # 章节完成情况
        records = user_store.list_learning_records(_cfg, uid)
        completed_set = _list_completed_names(records, lecture_id) if lecture_id else set()

        # 最近活动时间
        last_active_ts = 0
        for r in (records or []):
            try:
                t = int(r.get("timestamp") or r.get("ts") or 0)
                if t > last_active_ts:
                    last_active_ts = t
            except Exception:
                pass

        # 用户进度
        progress_info = {"progress": 0, "current_chapter": "", "next_chapter": ""}
        if lecture_id and is_in_course:
            try:
                books = list_lecture_books(_cfg, lecture_id)
                progress_info = _compute_user_lecture_progress(uid, lecture_id, books)
            except Exception:
                pass

        # 章节完成状态 (热力图数据)
        chapter_status: List[bool] = []
        for ch_name in chapter_names:
            chapter_status.append(ch_name in completed_set)

        students.append({
            "user_id": uid,
            "username": username,
            "display_name": display_name,
            "is_in_course": is_in_course,
            "study_hours": round(lecture_hours, 2),
            "chapter_count": len(completed_set),
            "total_chapters": len(chapter_names),
            "progress": int(progress_info.get("progress") or 0),
            "current_chapter": progress_info.get("current_chapter", ""),
            "last_active_ts": last_active_ts,
            "chapter_status": chapter_status,
        })

    # 按学习时长降序
    students.sort(key=lambda s: (-s.get("study_hours", 0), s.get("display_name", "")))

    return jsonify({
        "success": True,
        "lecture_id": lecture_id,
        "chapters": [{"name": n} for n in chapter_names],
        "students": students,
    })

@bp.route("/frontend/teacher/student-analysis", methods=["GET"])
def frontend_teacher_student_analysis():
    """教师 Panel 学生详情接口：返回单个学生的 telemetry 分析数据。"""
    if not _is_runtime_teacher():
        return jsonify({"success": False, "error": "Only admin or teacher can access this endpoint."}), 403

    target_uid = str(request.args.get("user_id") or "").strip()
    if not target_uid:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    book_id = str(request.args.get("book_id") or "").strip()
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    since_ts_str = request.args.get("since_ts")
    since_ts = int(since_ts_str) if since_ts_str else None

    from api.telemetry import query_user_analysis
    analysis = query_user_analysis(
        target_uid,
        book_id=book_id,
        lecture_id=lecture_id,
        since_ts=since_ts,
    )

    return jsonify({"success": True, "analysis": analysis})
