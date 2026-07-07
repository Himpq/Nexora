"""Lecture, book, quiz, and reader routes."""

from api import routes as _routes

# The first split keeps common helpers in api.routes while route handlers move by domain.
_routes._export_route_context(globals())


@bp.route("/frontend/settings/refinement", methods=["GET"])
def frontend_settings_refinement():
    """设置页：待精读列表 + 队列状态。"""
    status = str(request.args.get("status") or "").strip()
    rows = list_refinement_candidates(_cfg, status=status)
    queue_snapshot = get_refinement_queue_snapshot()
    running_by_book: Dict[str, str] = {}
    running_count = 0
    for job in queue_snapshot.get("jobs", []) if isinstance(queue_snapshot.get("jobs"), list) else []:
        if not isinstance(job, dict):
            continue
        lecture_id = str(job.get("lecture_id") or "").strip()
        book_id = str(job.get("book_id") or "").strip()
        job_status = str(job.get("status") or "").strip().lower()
        job_type = str(job.get("job_type") or "").strip().lower()
        if job_status == "running":
            running_count += 1
        if lecture_id and book_id:
            suffix = f"::{job_type}" if job_type else ""
            running_by_book[f"{lecture_id}::{book_id}{suffix}"] = job_status
    queue_snapshot["running_count"] = int(running_count)
    items: List[Dict[str, Any]] = []
    # 检查每个 lecture 的大纲状态（从 job 队列获取，包含 error 状态）
    outline_status_cache: Dict[str, str] = {}
    outline_error_cache: Dict[str, str] = {}
    for job in queue_snapshot.get("jobs", []) if isinstance(queue_snapshot.get("jobs"), list) else []:
        if not isinstance(job, dict):
            continue
        job_type = str(job.get("job_type") or "").strip().lower()
        if job_type != "outline":
            continue
        lid = str(job.get("lecture_id") or "").strip()
        if not lid:
            continue
        job_status = str(job.get("status") or "").strip().lower()
        if job_status in ("running", "queued"):
            outline_status_cache[lid] = "running"
            outline_error_cache[lid] = ""
        elif job_status == "done":
            outline_status_cache[lid] = "done"
            outline_error_cache[lid] = ""
        elif job_status == "error":
            outline_status_cache[lid] = "error"
            outline_error_cache[lid] = str(job.get("error") or "").strip()
    for row in rows:
        lecture_id = str(row.get("lecture_id") or "").strip()
        lecture_title = str(row.get("lecture_title") or "").strip()
        book = row.get("book") if isinstance(row.get("book"), dict) else {}
        if not lecture_id or not book:
            continue
        book_id = str(book.get("id") or "").strip()
        refine_status = str(book.get("refinement_status") or "").strip().lower()
        coarse_status = str(book.get("coarse_status") or "").strip().lower()
        key = f"{lecture_id}::{book_id}"

        # 获取大纲状态（优先使用 job 状态，否则检查文件）
        if lecture_id not in outline_status_cache:
            try:
                from core.booksproc.outline import load_outline
                outline = load_outline(_cfg, lecture_id)
                outline_status_cache[lecture_id] = "done" if outline else ""
            except Exception:
                outline_status_cache[lecture_id] = ""

        items.append(
            {
                "lecture_id": lecture_id,
                "lecture_title": lecture_title,
                "book_id": book_id,
                "book_title": str(book.get("title") or book_id),
                "refinement_status": str(book.get("refinement_status") or ""),
                "text_status": str(book.get("text_status") or ""),
                "coarse_status": str(book.get("coarse_status") or ""),
                "intensive_status": str(book.get("intensive_status") or ""),
                "question_status": str(book.get("question_status") or ""),
                "section_status": str(book.get("section_status") or ""),
                "summary_status": str(book.get("summary_status") or ""),
                "annotation_status": str(book.get("annotation_status") or ""),
                "outline_status": outline_status_cache.get(lecture_id, ""),
                "outline_error": outline_error_cache.get(lecture_id, ""),
                "coarse_model": str(book.get("coarse_model") or ""),
                "intensive_model": str(book.get("intensive_model") or ""),
                "question_model": str(book.get("question_model") or ""),
                "section_model": str(book.get("section_model") or ""),
                "summary_model": str(book.get("summary_model") or ""),
                "annotation_model": str(book.get("annotation_model") or ""),
                "coarse_error": str(book.get("coarse_error") or ""),
                "intensive_error": str(book.get("intensive_error") or ""),
                "question_error": str(book.get("question_error") or ""),
                "section_error": str(book.get("section_error") or ""),
                "summary_error": str(book.get("summary_error") or ""),
                "annotation_error": str(book.get("annotation_error") or ""),
                "refinement_error": str(book.get("refinement_error") or ""),
                "job_status": running_by_book.get(key, ""),
                "section_job_status": running_by_book.get(f"{key}::section", ""),
                "summary_job_status": running_by_book.get(f"{key}::summary", ""),
                "annotation_job_status": running_by_book.get(f"{key}::annotation", ""),
                "progress_text": get_book_progress_text(lecture_id, book_id),
                "progress_steps": get_book_progress_steps(lecture_id, book_id),
                "updated_at": int(book.get("updated_at") or 0),
            }
        )
    return jsonify(
        {
            "success": True,
            "status_filter": status,
            "queue": queue_snapshot,
            "items": items,
            "total": len(items),
        }
    )

@bp.route("/frontend/settings/refinement/start", methods=["POST"])
def frontend_settings_refinement_start():
    """设置页：手动触发教材精读。"""
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can start refinement."}), 403
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    actor = str(data.get("actor") or _resolve_runtime_user_id()).strip()
    force = _as_bool(data.get("force"), default=False)
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
    result = enqueue_book_refinement(_cfg, lecture_id, book_id, actor=actor, force=force)
    return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, **result}), 202

@bp.route("/frontend/settings/refinement/intensive", methods=["POST"])
def frontend_settings_refinement_intensive():
    """设置页：手动触发教材精读（输出写入 bookdetail.xml）。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    actor = str(data.get("actor") or _resolve_runtime_user_id()).strip()
    model_name = str(data.get("model_name") or "").strip()
    log_event(
        "frontend_intensive_request",
        "收到前端精读请求",
        payload={
            "lecture_id": lecture_id,
            "book_id": book_id,
            "actor": actor,
            "model_name": model_name,
            "is_admin": bool(_is_runtime_admin()),
        },
    )
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can start intensive reading."}), 403
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
    try:
        result = enqueue_book_intensive(_cfg, lecture_id, book_id, actor=actor, model_name=model_name)
        return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, **result}), 202
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500

@bp.route("/frontend/settings/refinement/question", methods=["POST"])
def frontend_settings_refinement_question():
    """设置页：手动触发教材出题（输出写入 questions.xml）。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    actor = str(data.get("actor") or _resolve_runtime_user_id()).strip()
    model_name = str(data.get("model_name") or "").strip()
    log_event(
        "frontend_question_request",
        "收到前端出题请求",
        payload={
            "lecture_id": lecture_id,
            "book_id": book_id,
            "actor": actor,
            "model_name": model_name,
            "is_admin": bool(_is_runtime_admin()),
        },
    )
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can start question generation."}), 403
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
    try:
        result = enqueue_book_question(_cfg, lecture_id, book_id, actor=actor, model_name=model_name)
        return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, **result}), 202
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500

@bp.route("/frontend/settings/refinement/section", methods=["POST"])
def frontend_settings_refinement_section():
    """设置页：手动触发教材分节（输出写入 sections.xml）。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    actor = str(data.get("actor") or _resolve_runtime_user_id()).strip()
    model_name = str(data.get("model_name") or "").strip()
    log_event(
        "frontend_section_request",
        "收到前端分节请求",
        payload={
            "lecture_id": lecture_id,
            "book_id": book_id,
            "actor": actor,
            "model_name": model_name,
            "is_admin": bool(_is_runtime_admin()),
        },
    )
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can start section generation."}), 403
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
    try:
        result = enqueue_book_section(_cfg, lecture_id, book_id, actor=actor, model_name=model_name)
        return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, **result}), 202
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500

@bp.route("/frontend/settings/refinement/annotation", methods=["POST"])
def frontend_settings_refinement_annotation():
    """设置页：手动触发教材批注生成（输出写入 annotations.xml）。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    actor = str(data.get("actor") or _resolve_runtime_user_id()).strip()
    model_name = str(data.get("model_name") or "").strip()
    log_event(
        "frontend_annotation_request",
        "收到前端批注请求",
        payload={
            "lecture_id": lecture_id,
            "book_id": book_id,
            "actor": actor,
            "model_name": model_name,
            "is_admin": bool(_is_runtime_admin()),
        },
    )
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can start annotation generation."}), 403
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
    try:
        result = enqueue_book_annotation(_cfg, lecture_id, book_id, actor=actor, model_name=model_name)
        return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, **result}), 202
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500

@bp.route("/frontend/settings/refinement/summary", methods=["POST"])
def frontend_settings_refinement_summary():
    """设置页：手动触发全书概述生成（输出写入 booksummary.md）。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    actor = str(data.get("actor") or _resolve_runtime_user_id()).strip()
    model_name = str(data.get("model_name") or "").strip()
    log_event(
        "frontend_summary_request",
        "收到前端全书概述请求",
        payload={
            "lecture_id": lecture_id,
            "book_id": book_id,
            "actor": actor,
            "model_name": model_name,
            "is_admin": bool(_is_runtime_admin()),
        },
    )
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can start book summary generation."}), 403
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
    try:
        result = enqueue_book_summary(_cfg, lecture_id, book_id, actor=actor, model_name=model_name)
        return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, **result}), 202
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500

@bp.route("/frontend/settings/refinement/video", methods=["POST"])
def frontend_settings_refinement_video():
    """设置页：手动触发视频搜索。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    actor = str(data.get("actor") or _resolve_runtime_user_id()).strip()
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can start video search."}), 403
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
    try:
        from core.booksproc import enqueue_book_video
        result = enqueue_book_video(_cfg, lecture_id, book_id, actor=actor)
        return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, **result}), 202
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500

@bp.route("/frontend/settings/refinement/stop", methods=["POST"])
def frontend_settings_refinement_stop():
    """设置页：停止教材精读并重置状态。"""
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can stop refinement."}), 403
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    actor = str(data.get("actor") or _resolve_runtime_user_id()).strip()
    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400
    result = cancel_book_refinement(_cfg, lecture_id, book_id, actor=actor)
    return jsonify({"success": True, **result}), 200

@bp.route("/lectures", methods=["GET"])
def list_lectures():
    lectures = list_learning_lectures(_cfg)
    return jsonify({"success": True, "lectures": lectures, "total": len(lectures)})

@bp.route("/lectures", methods=["POST"])
def create_lecture():
    data = request.get_json(silent=True) or {}
    title = str(data.get("title") or "").strip()
    if not title:
        return jsonify({"success": False, "error": "title is required."}), 400

    lecture = create_learning_lecture(
        _cfg,
        title,
        description=str(data.get("description") or "").strip(),
        category=str(data.get("category") or "").strip(),
        status=str(data.get("status") or "draft").strip() or "draft",
        teacher=data.get("teacher"),
        cover_path=str(data.get("cover_path") or "").strip(),
    )
    return jsonify({"success": True, "lecture": lecture}), 201

@bp.route("/lectures/<lecture_id>", methods=["GET"])
def get_lecture(lecture_id: str):
    lecture, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    books = list_lecture_books(_cfg, lecture_id)
    return jsonify({
        "success": True,
        "lecture": lecture,
        "books": books,
        "total_books": len(books),
    })

@bp.route("/lectures/<lecture_id>", methods=["PATCH"])
def update_lecture(lecture_id: str):
    lecture, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    data = request.get_json(silent=True) or {}
    allowed_fields = {"title", "description", "category", "status", "teacher", "cover_path"}
    updates = {key: value for key, value in data.items() if key in allowed_fields}
    if not updates:
        return jsonify({"success": False, "error": "No valid lecture fields provided."}), 400

    updated = update_learning_lecture(_cfg, lecture_id, updates) or lecture
    return jsonify({"success": True, "lecture": updated})

@bp.route("/lectures/<lecture_id>/teacher", methods=["PATCH"])
def update_lecture_teacher(lecture_id: str):
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can modify lecture teachers."}), 403

    lecture, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    data = request.get_json(silent=True) or {}
    if "teacher" not in data:
        return jsonify({"success": False, "error": "teacher field is required."}), 400

    updated = update_learning_lecture(_cfg, lecture_id, {"teacher": data.get("teacher")}) or lecture
    return jsonify({"success": True, "lecture": updated})

@bp.route("/lectures/<lecture_id>", methods=["DELETE"])
def delete_lecture(lecture_id: str):
    lecture, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    delete_learning_lecture(_cfg, lecture_id)
    return jsonify({"success": True, "lecture": lecture})

@bp.route("/lectures/<lecture_id>/books", methods=["GET"])
def list_books(lecture_id: str):
    _, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    books = list_lecture_books(_cfg, lecture_id)
    return jsonify({"success": True, "books": books, "total": len(books)})

@bp.route("/lectures/<lecture_id>/books", methods=["POST"])
def create_book(lecture_id: str):
    _, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    data = request.get_json(silent=True) or {}
    title = str(data.get("title") or "").strip()
    if not title:
        return jsonify({"success": False, "error": "title is required."}), 400

    book = create_lecture_book(
        _cfg,
        lecture_id,
        title,
        description=str(data.get("description") or "").strip(),
        source_type=str(data.get("source_type") or "text").strip() or "text",
        cover_path=str(data.get("cover_path") or "").strip(),
    )
    return jsonify({"success": True, "book": book}), 201

@bp.route("/lectures/<lecture_id>/books/<book_id>", methods=["GET"])
def get_book(lecture_id: str, book_id: str):
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    return jsonify({"success": True, "book": book})

@bp.route("/lectures/<lecture_id>/books/<book_id>", methods=["PATCH"])
def update_book(lecture_id: str, book_id: str):
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    data = request.get_json(silent=True) or {}
    allowed_fields = {
        "title",
        "description",
        "source_type",
        "cover_path",
        "status",
    }
    updates = {key: value for key, value in data.items() if key in allowed_fields}
    if not updates:
        return jsonify({"success": False, "error": "No valid book fields provided."}), 400

    updated = update_lecture_book(_cfg, lecture_id, book_id, updates) or book
    return jsonify({"success": True, "book": updated})

@bp.route("/lectures/<lecture_id>/books/<book_id>", methods=["DELETE"])
def delete_book(lecture_id: str, book_id: str):
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    delete_lecture_book(_cfg, lecture_id, book_id)
    return jsonify({"success": True, "book": book})

@bp.route("/lectures/<lecture_id>/books/<book_id>/text", methods=["GET"])
def get_book_text(lecture_id: str, book_id: str):
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    content = load_book_text(_cfg, lecture_id, book_id)
    images = load_book_images_meta(_cfg, lecture_id, book_id)
    return jsonify({
        "success": True,
        "book": book,
        "content": content,
        "chars": len(content),
        "images": images,
    })

@bp.route("/lectures/<lecture_id>/books/<book_id>/images/<image_id>", methods=["GET"])
def get_book_image(lecture_id: str, book_id: str, image_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    image_path = get_book_image_path(_cfg, lecture_id, book_id, image_id)
    if image_path is None or not image_path.exists():
        return jsonify({"success": False, "error": "image not found."}), 404
    response = send_file(str(image_path))
    response.headers["Cache-Control"] = "public, max-age=86400"
    return response

@bp.route("/lectures/<lecture_id>/cover-assets", methods=["GET"])
def get_lecture_cover_assets(lecture_id: str):
    _, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    items = list_lecture_cover_assets(_cfg, lecture_id)
    return jsonify({"success": True, "items": items, "total": len(items)})

@bp.route("/lectures/<lecture_id>/books/<book_id>/cover-assets", methods=["GET"])
def get_book_cover_assets(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    items = list_book_cover_assets(_cfg, lecture_id, book_id)
    return jsonify({"success": True, "items": items, "total": len(items)})

@bp.route("/books/refinement/list", methods=["GET"])
@bp.route("/books/extract/list", methods=["GET"])
def list_books_for_refinement_all():
    status = str(request.args.get("status") or "").strip()
    rows = list_refinement_candidates(_cfg, status=status)
    return jsonify({"success": True, "items": rows, "total": len(rows)})

@bp.route("/lectures/<lecture_id>/books/refinement/list", methods=["GET"])
@bp.route("/lectures/<lecture_id>/books/extract/list", methods=["GET"])
def list_books_for_refinement_lecture(lecture_id: str):
    status = str(request.args.get("status") or "").strip()
    rows = list_refinement_candidates(_cfg, lecture_id=lecture_id, status=status)
    return jsonify({"success": True, "lecture_id": lecture_id, "items": rows, "total": len(rows)})

@bp.route("/refinement/queue", methods=["GET"])
@bp.route("/extract/queue", methods=["GET"])
def get_refinement_queue():
    return jsonify({"success": True, **get_refinement_queue_snapshot()})

@bp.route("/lectures/<lecture_id>/books/refinement", methods=["POST"])
@bp.route("/lectures/<lecture_id>/books/extract", methods=["POST"])
def enqueue_lecture_books_refinement(lecture_id: str):
    data = request.get_json(silent=True) or {}
    book_ids = data.get("book_ids")
    if not isinstance(book_ids, list) or not book_ids:
        return jsonify({"success": False, "error": "book_ids(list) is required."}), 400
    actor = str(data.get("actor") or "").strip()
    force = _as_bool(data.get("force"), default=False)

    queued: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    for raw_id in book_ids:
        book_id = str(raw_id or "").strip()
        if not book_id:
            continue
        try:
            result = enqueue_book_refinement(_cfg, lecture_id, book_id, actor=actor, force=force)
            queued.append({"book_id": book_id, **result})
        except Exception as exc:
            errors.append({"book_id": book_id, "error": str(exc)})

    return jsonify(
        {
            "success": True,
            "lecture_id": lecture_id,
            "queued_count": len(queued),
            "error_count": len(errors),
            "queued": queued,
            "errors": errors,
        }
    )

@bp.route("/lectures/<lecture_id>/books/<book_id>/refinement", methods=["POST"])
@bp.route("/lectures/<lecture_id>/books/<book_id>/extract", methods=["POST"])
def enqueue_single_book_refinement(lecture_id: str, book_id: str):
    data = request.get_json(silent=True) or {}
    actor = str(data.get("actor") or "").strip()
    force = _as_bool(data.get("force"), default=False)
    result = enqueue_book_refinement(_cfg, lecture_id, book_id, actor=actor, force=force)
    return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, **result}), 202

@bp.route("/lectures/<lecture_id>/books/<book_id>/file", methods=["POST"])
def upload_book_file(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    upload = request.files.get("file")
    if upload is None:
        return jsonify({"success": False, "error": "file is required."}), 400
    filename_raw = str(upload.filename or "").strip()
    if not filename_raw:
        return jsonify({"success": False, "error": "filename is required."}), 400
    if not _allowed(filename_raw):
        return jsonify({"success": False, "error": f"Unsupported extension. Allowed: {sorted(ALLOWED_EXT)}"}), 400

    max_mb = int(_cfg.get("max_upload_mb") or 50)
    content = upload.read()
    if len(content) > max_mb * 1024 * 1024:
        return jsonify({"success": False, "error": f"file exceeds {max_mb}MB"}), 413

    safe_name = secure_filename(filename_raw) or "content.bin"
    try:
        save_book_original_file(
            _cfg,
            lecture_id,
            book_id,
            content,
            filename=safe_name,
        )
        saved = mark_book_uploaded(
            _cfg,
            lecture_id,
            book_id,
            filename=safe_name,
            file_size=len(content),
            actor=str(request.headers.get("X-User") or request.headers.get("X-Username") or ""),
        )
        return jsonify(
            {
                "success": True,
                "book": saved,
                "message": "File uploaded. Refinement is not started automatically.",
            }
        ), 201
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500

@bp.route("/lectures/<lecture_id>/books/<book_id>/parse", methods=["POST"])
def parse_book_file(lecture_id: str, book_id: str):
    """手动解析教材原文件为纯文本，并写入教材存储。"""
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    original_path = str((book or {}).get("original_path") or "").strip()
    if not original_path:
        return jsonify({"success": False, "error": "book has no original file."}), 400

    source = Path(original_path)
    if not source.exists():
        return jsonify({"success": False, "error": "original file not found."}), 404

    filename = str((book or {}).get("original_filename") or source.name or "content.txt").strip() or "content.txt"
    try:
        parsed_text = ""
        saved_images = []
        if source.suffix.lower() == ".epub":
            images_dir = Path(str(_cfg.get("data_dir") or "data")) / "lectures" / lecture_id / "books" / book_id / "assets" / "images"
            epub_result = extract_epub_with_assets(
                str(source),
                lecture_id=lecture_id,
                book_id=book_id,
                assets_dir=images_dir,
            )
            parsed_text = str(epub_result.get("text") or "")
            saved_images = save_book_images_meta(_cfg, lecture_id, book_id, epub_result.get("images") or [])
        else:
            parsed_text = extract_text(str(source))
        if not str(parsed_text or "").strip():
            updated = update_lecture_book(
                _cfg,
                lecture_id,
                book_id,
                {
                    "text_status": "error",
                    "error": "parsed text is empty",
                },
            ) or book
            return jsonify({"success": False, "error": "parsed text is empty", "book": updated}), 422

        saved = save_book_text(_cfg, lecture_id, book_id, str(parsed_text), filename=filename)
        log_event(
            "book_parse_done",
            "教材文本解析完成",
            payload={
                "lecture_id": lecture_id,
                "book_id": book_id,
                "filename": filename,
                "chars": len(str(parsed_text)),
                "images_count": len(saved_images),
            },
        )
        return jsonify(
            {
                "success": True,
                "lecture_id": lecture_id,
                "book_id": book_id,
                "chars": len(str(parsed_text)),
                "images": saved_images,
                "book": saved,
            }
        ), 200
    except Exception as exc:
        updated = update_lecture_book(
            _cfg,
            lecture_id,
            book_id,
            {
                "text_status": "error",
                "error": str(exc),
            },
        ) or book
        return jsonify({"success": False, "error": str(exc), "book": updated}), 500

@bp.route("/lectures/<lecture_id>/books/<book_id>/text", methods=["POST"])
def upload_book_text(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    data = request.get_json(silent=True) or {}
    content = str(data.get("content") or "")
    if not content.strip():
        return jsonify({"success": False, "error": "content is required."}), 400

    filename = secure_filename(str(data.get("filename") or "content.txt").strip()) or "content.txt"
    auto_vectorize = _as_bool(data.get("auto_vectorize"), default=True)

    saved = save_book_text(_cfg, lecture_id, book_id, content, filename=filename)

    vectorization_result = None
    if auto_vectorize:
        nexoradb_status = get_nexoradb_status(_cfg)
        vectorization_result = (
            queue_vectorize_book(_cfg, lecture_id, book_id, force=True)
            if nexoradb_status.get("available")
            else _vector_disabled_payload(nexoradb_status)
        )

    return jsonify({
        "success": True,
        "book": saved,
        "vectorization": vectorization_result,
    }), 201

@bp.route("/lectures/<lecture_id>/books/<book_id>/bookinfo", methods=["GET"])
def get_book_info_xml(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    content = load_book_info_xml(_cfg, lecture_id, book_id)
    return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, "content": content})

@bp.route("/lectures/<lecture_id>/books/<book_id>/chapter/<int:chapter_index>", methods=["GET"])
def get_book_chapter_text(lecture_id: str, book_id: str, chapter_index: int):
    """按章节获取文本内容，支持按需加载。"""
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    content = load_book_text(_cfg, lecture_id, book_id)
    if not content:
        return jsonify({"success": True, "content": "", "chapter_index": chapter_index})

    # 解析章节信息
    bookinfo_xml = load_book_info_xml(_cfg, lecture_id, book_id)
    from core.user.learning_progress import parse_book_info_xml_chapters
    chapters = parse_book_info_xml_chapters(bookinfo_xml, len(content))

    if not chapters or chapter_index < 0 or chapter_index >= len(chapters):
        # 如果没有章节信息或索引无效，返回全部内容
        return jsonify({
            "success": True,
            "content": content,
            "chapter_index": chapter_index,
            "total_chars": len(content),
        })

    chapter = chapters[chapter_index]
    start = max(0, min(len(content), chapter.get("start", 0)))
    end = max(start, min(len(content), chapter.get("end", len(content))))
    chapter_content = content[start:end].strip()

    return jsonify({
        "success": True,
        "content": chapter_content,
        "chapter_index": chapter_index,
        "chapter_title": chapter.get("title", ""),
        "chapter_start": start,
        "chapter_end": end,
        "total_chars": len(chapter_content),
    })

@bp.route("/lectures/<lecture_id>/books/<book_id>/bookinfo", methods=["POST"])
def set_book_info_xml(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    data = request.get_json(silent=True) or {}
    content = str(data.get("content") or "")
    path = save_book_info_xml(_cfg, lecture_id, book_id, content)
    return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, "path": path})

@bp.route("/lectures/<lecture_id>/books/<book_id>/bookdetail", methods=["GET"])
def get_book_detail_xml(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    content = load_book_detail_xml(_cfg, lecture_id, book_id)
    return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, "content": content})

@bp.route("/lectures/<lecture_id>/books/<book_id>/bookdetail", methods=["POST"])
def set_book_detail_xml(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    data = request.get_json(silent=True) or {}
    content = str(data.get("content") or "")
    path = save_book_detail_xml(_cfg, lecture_id, book_id, content)
    return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, "path": path})

@bp.route("/lectures/<lecture_id>/books/<book_id>/sections", methods=["GET"])
def get_book_sections_xml(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    content = load_book_sections_xml(_cfg, lecture_id, book_id)
    return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, "content": content})

@bp.route("/frontend/quiz/generate", methods=["POST"])
def frontend_quiz_generate():
    """为指定session生成测验题目。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    chapter_index = int(data.get("chapter_index") or 0)
    session_index = int(data.get("session_index") or 0)
    chapter_name = str(data.get("chapter_name") or "").strip()
    session_name = str(data.get("session_name") or "").strip()
    session_range = str(data.get("session_range") or "").strip()

    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400

    try:
        from core.booksproc.question import generate_session_quiz
        result = generate_session_quiz(
            _cfg,
            lecture_id=lecture_id,
            book_id=book_id,
            chapter_index=chapter_index,
            session_index=session_index,
            chapter_name=chapter_name,
            session_name=session_name,
            session_range=session_range,
        )
        return jsonify({"success": True, **result}), 200
    except Exception as exc:
        log_event("quiz_generate_error", str(exc), payload={"lecture_id": lecture_id, "book_id": book_id})
        return jsonify({"success": False, "error": str(exc)}), 500

@bp.route("/frontend/quiz/chapter", methods=["POST"])
def frontend_chapter_quiz_load():
    """读取或创建章节完成后的小测，题目一旦选定会固化到用户文件。"""
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    chapter_name = str(data.get("chapter_name") or "").strip()
    chapter_range = str(data.get("chapter_range") or "").strip()
    chapter_context = str(data.get("chapter_context") or "")
    chapter_detail_xml = str(data.get("chapter_detail_xml") or "")

    try:
        chapter_index = int(data.get("chapter_index") or 0)
    except Exception:
        return jsonify({"success": False, "error": "chapter_index is required."}), 400

    if not lecture_id or not book_id or not chapter_name:
        return jsonify({"success": False, "error": "lecture_id, book_id and chapter_name are required."}), 400

    try:
        from core.booksproc.chapter_quiz import load_or_create_chapter_quiz
        quiz = load_or_create_chapter_quiz(
            _cfg,
            user_id=username,
            lecture_id=lecture_id,
            book_id=book_id,
            chapter_index=chapter_index,
            chapter_name=chapter_name,
            chapter_range=chapter_range,
            chapter_context=chapter_context,
            chapter_detail_xml=chapter_detail_xml,
        )
        return jsonify({
            "success": True,
            "quiz": quiz,
            "quiz_id": quiz.get("quiz_id"),
            "questions": quiz.get("questions") or [],
            "answers": quiz.get("answers") or {},
        }), 200
    except Exception as exc:
        log_event(
            "chapter_quiz_load_error",
            str(exc),
            payload={"username": username, "lecture_id": lecture_id, "book_id": book_id, "chapter_name": chapter_name},
        )
        return jsonify({"success": False, "error": str(exc)}), 500

@bp.route("/frontend/reader-guide/generate", methods=["POST"])
def frontend_reader_guide_generate():
    """为当前阅读章节或小节生成导读卡片。"""
    try:
        payload = _read_reader_guide_request_payload()
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    try:
        from core.booksproc.guide import generate_reader_guide
        result = generate_reader_guide(
            _cfg,
            lecture_id=payload["lecture_id"],
            book_id=payload["book_id"],
            chapter_name=payload["chapter_name"],
            session_name=payload["session_name"],
            guide_context=payload["guide_context"],
        )
        return jsonify({"success": True, **result}), 200
    except Exception as exc:
        log_event(
            "reader_guide_error",
            str(exc),
            payload={"lecture_id": payload["lecture_id"], "book_id": payload["book_id"]},
        )
        return jsonify({"success": False, "error": str(exc)}), 500

@bp.route("/frontend/reader-guide/stream", methods=["POST"])
def frontend_reader_guide_stream():
    """以 SSE 形式流式生成当前阅读章节或小节导读。"""
    try:
        payload = _read_reader_guide_request_payload()
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    def event_stream():
        events: "queue.Queue[Tuple[str, Dict[str, Any]]]" = queue.Queue()

        def push_event(event_name: str, event_payload: Dict[str, Any]) -> None:
            events.put((event_name, event_payload))

        def push_delta(delta_text: str) -> None:
            text = str(delta_text or "")

            if text:
                append_log_text(text)
                push_event("delta", {"content": text})

        def run_worker() -> None:
            try:
                from core.booksproc.guide import generate_reader_guide

                result = generate_reader_guide(
                    _cfg,
                    lecture_id=payload["lecture_id"],
                    book_id=payload["book_id"],
                    chapter_name=payload["chapter_name"],
                    session_name=payload["session_name"],
                    guide_context=payload["guide_context"],
                    stream=True,
                    on_delta=push_delta,
                )
                push_event("done", {"success": True, **result})
            except Exception as exc:
                log_event(
                    "reader_guide_stream_error",
                    str(exc),
                    payload={"lecture_id": payload["lecture_id"], "book_id": payload["book_id"]},
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                push_event("close", {})

        thread = threading.Thread(target=run_worker, name="reader-guide-stream", daemon=True)
        thread.start()

        yield _reader_guide_sse_event("status", {"message": "reader guide stream started"})

        while True:
            try:
                event_name, event_payload = events.get(timeout=20)
            except queue.Empty:
                yield _reader_guide_sse_event("ping", {"timestamp": time.time()})
                continue

            if event_name == "close":
                break

            yield _reader_guide_sse_event(event_name, event_payload)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

@bp.route("/frontend/reader-guide/pre-questions", methods=["POST"])
def frontend_reader_guide_pre_questions():
    """以 SSE 形式流式生成阅读前问题。"""
    try:
        data = request.get_json(silent=True) or {}
        lecture_id = str(data.get("lecture_id") or "").strip()
        book_id = str(data.get("book_id") or "").strip()
        chapter_name = str(data.get("chapter_name") or "").strip()
        session_name = str(data.get("session_name") or "").strip()
        guide_context = str(data.get("guide_context") or "").strip()

        if not lecture_id or not book_id:
            raise ValueError("lecture_id and book_id are required.")
        if not guide_context:
            raise ValueError("guide_context is required.")
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    def event_stream():
        events: "queue.Queue[Tuple[str, Dict[str, Any]]]" = queue.Queue()

        def push_event(event_name: str, event_payload: Dict[str, Any]) -> None:
            events.put((event_name, event_payload))

        def push_delta(delta_text: str) -> None:
            text = str(delta_text or "")
            if text:
                append_log_text(text)
                push_event("delta", {"content": text})

        def run_worker() -> None:
            try:
                from core.booksproc.guide import generate_pre_reading_questions

                result = generate_pre_reading_questions(
                    _cfg,
                    lecture_id=lecture_id,
                    book_id=book_id,
                    chapter_name=chapter_name,
                    session_name=session_name,
                    guide_context=guide_context,
                    stream=True,
                    on_delta=push_delta,
                )
                push_event("done", {"success": True, **result})
            except Exception as exc:
                log_event(
                    "pre_reading_questions_stream_error",
                    str(exc),
                    payload={"lecture_id": lecture_id, "book_id": book_id},
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                push_event("close", {})

        thread = threading.Thread(target=run_worker, name="pre-reading-questions-stream", daemon=True)
        thread.start()

        yield _reader_guide_sse_event("status", {"message": "pre-reading questions stream started"})

        while True:
            try:
                event_name, event_payload = events.get(timeout=20)
            except queue.Empty:
                yield _reader_guide_sse_event("ping", {"timestamp": time.time()})
                continue

            if event_name == "close":
                break

            yield _reader_guide_sse_event(event_name, event_payload)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

@bp.route("/frontend/reader-guide/pre-questions/save", methods=["POST"])
def frontend_reader_guide_pre_questions_save():
    """保存阅读前问答结果。"""
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    chapter_index = data.get("chapter_index")
    questions = data.get("questions", [])
    answers = data.get("answers", {})
    skipped = bool(data.get("skipped"))

    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400

    if chapter_index is None:
        return jsonify({"success": False, "error": "chapter_index is required."}), 400

    # 持久化到用户目录
    from pathlib import Path

    data_dir = Path(str(_cfg.get("data_dir") or "data"))
    qa_dir = data_dir / "users" / username / "guide_qa"
    qa_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{lecture_id}_{book_id}_{chapter_index}.json"
    qa_path = qa_dir / filename

    qa_data = {
        "lecture_id": lecture_id,
        "book_id": book_id,
        "chapter_index": chapter_index,
        "questions": questions,
        "answers": answers,
        "skipped": skipped,
        "timestamp": int(time.time()),
    }

    qa_path.write_text(json.dumps(qa_data, ensure_ascii=False, indent=2), encoding="utf-8")

    log_event(
        "pre_reading_qa_saved",
        "阅读前问答已保存",
        payload={
            "username": username,
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_index": chapter_index,
            "skipped": skipped,
            "answers_count": len(answers),
        },
    )

    return jsonify({"success": True, "path": str(qa_path)})

@bp.route("/frontend/reader-guide/pre-questions/check", methods=["POST"])
def frontend_reader_guide_pre_questions_check():
    """检查是否存在阅读前问答缓存。"""
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    book_id = str(data.get("book_id") or "").strip()
    chapter_index = data.get("chapter_index")

    if not lecture_id or not book_id:
        return jsonify({"success": False, "error": "lecture_id and book_id are required."}), 400

    if chapter_index is None:
        return jsonify({"success": False, "error": "chapter_index is required."}), 400

    from pathlib import Path

    data_dir = Path(str(_cfg.get("data_dir") or "data"))
    qa_dir = data_dir / "users" / username / "guide_qa"
    filename = f"{lecture_id}_{book_id}_{chapter_index}.json"
    qa_path = qa_dir / filename

    if qa_path.exists():
        try:
            qa_data = json.loads(qa_path.read_text(encoding="utf-8"))
            return jsonify({"success": True, "cached": True, "data": qa_data})
        except Exception:
            return jsonify({"success": True, "cached": False})

    return jsonify({"success": True, "cached": False})

@bp.route("/frontend/reader-guide/user-profile", methods=["POST"])
def frontend_reader_guide_user_profile():
    """获取用户画像。"""
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    from pathlib import Path

    data_dir = Path(str(_cfg.get("data_dir") or "data"))
    profile_path = data_dir / "users" / username / "user.md"

    profile_content = ""
    if profile_path.exists():
        try:
            profile_content = profile_path.read_text(encoding="utf-8")
        except Exception:
            pass

    return jsonify({"success": True, "profile": profile_content})

@bp.route("/frontend/outline/<lecture_id>", methods=["GET"])
def frontend_get_outline(lecture_id: str):
    """获取课程的固化大纲。"""
    from core.booksproc.outline import load_outline

    outline = load_outline(_cfg, lecture_id)
    if outline is None:
        return jsonify({"success": False, "error": "大纲尚未生成"}), 404
    return jsonify({"success": True, "outline": outline})

@bp.route("/frontend/outline/<lecture_id>/generate", methods=["POST"])
def frontend_generate_outline(lecture_id: str):
    """手动触发课程大纲生成（异步，通过队列执行）。"""
    try:
        from core.booksproc.queue import enqueue_job

        enqueue_job(
            lecture_id,
            "outline",
            actor=_resolve_runtime_user_id() or "manual",
            force=True,
            job_type="outline",
        )
        return jsonify({"success": True, "message": "大纲生成任务已加入队列"})
    except Exception as exc:
        log_event(
            "outline_manual_error",
            str(exc),
            payload={"lecture_id": lecture_id},
        )
        return jsonify({"success": False, "error": str(exc)}), 500

@bp.route("/frontend/outline/<lecture_id>/generate-stream", methods=["GET"])
def frontend_generate_outline_stream(lecture_id: str):
    """流式生成课程大纲，向课程管理返回模型活动。"""
    safe_lecture_id = str(lecture_id or "").strip()
    runtime_user_id = _resolve_runtime_user_id() or "manual"
    if not safe_lecture_id:
        return Response("event: error\ndata: {\"error\": \"lecture_id is required\"}\n\n", mimetype="text/event-stream")

    def event_stream():
        events: "queue.Queue[Tuple[str, Dict[str, Any]]]" = queue.Queue()

        def push_event(event_name: str, event_payload: Dict[str, Any]) -> None:
            events.put((event_name, event_payload))

        def push_status(message: str) -> None:
            text = str(message or "").strip()
            if text:
                push_event("status", {"message": text})

        def push_delta(delta_text: str) -> None:
            text = str(delta_text or "")
            if text:
                push_event("delta", {"content": text})

        def to_sse(event_name: str, event_payload: Dict[str, Any]) -> str:
            return f"event: {event_name}\ndata: {json.dumps(event_payload, ensure_ascii=False)}\n\n"

        def run_worker() -> None:
            try:
                from core.booksproc.outline import generate_outline

                result = generate_outline(
                    _cfg,
                    safe_lecture_id,
                    user_id=runtime_user_id,
                    on_status=push_status,
                    on_delta=push_delta,
                )
                push_event("done", {"success": True, "outline": result})
            except Exception as exc:
                log_event(
                    "outline_stream_error",
                    str(exc),
                    payload={"lecture_id": safe_lecture_id},
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                push_event("close", {})

        thread = threading.Thread(target=run_worker, name="outline-generate-stream", daemon=True)
        thread.start()

        yield to_sse("status", {"message": "大纲流式生成已启动"})

        while True:
            try:
                event_name, event_payload = events.get(timeout=20)
            except queue.Empty:
                yield to_sse("ping", {"timestamp": time.time()})
                continue

            if event_name == "close":
                break

            yield to_sse(event_name, event_payload)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

@bp.route("/frontend/quiz/submit", methods=["POST"])
def frontend_quiz_submit():
    """提交学生在测验浮层中的单题作答，并写入用户答题记录。"""
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    data = request.get_json(silent=True) or {}
    if not isinstance(data, MappingABC):
        return jsonify({"success": False, "error": "request body must be an object."}), 400

    record, quiz_id, error_message = _build_frontend_quiz_answer_record(data)
    if error_message or record is None:
        return jsonify({"success": False, "error": error_message or "invalid quiz answer payload."}), 400

    saved = _save_frontend_quiz_answer_record(username, record, quiz_id)
    log_event(
        "quiz_answer_submitted",
        "学生测验作答已提交",
        payload={
            "username": username,
            "lecture_id": record.get("lecture_id"),
            "book_id": record.get("book_id"),
            "chapter_name": record.get("chapter_name"),
            "session_name": record.get("session_name"),
            "question_index": record.get("question_index"),
            "question_id": saved.get("question_id"),
        },
    )
    return jsonify({"success": True, "record": saved})

@bp.route("/frontend/quiz/submit-batch", methods=["POST"])
def frontend_quiz_submit_batch():
    """一次性提交测验浮层中的多道题作答。"""
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    data = request.get_json(silent=True) or {}
    if not isinstance(data, MappingABC):
        return jsonify({"success": False, "error": "request body must be an object."}), 400

    raw_answers = data.get("answers")
    if not isinstance(raw_answers, list) or not raw_answers:
        return jsonify({"success": False, "error": "answers are required."}), 400

    prepared: List[Tuple[Dict[str, Any], str]] = []

    for item_index, item in enumerate(raw_answers):
        if not isinstance(item, MappingABC):
            return jsonify({"success": False, "error": f"answer {item_index + 1} must be an object."}), 400

        record, quiz_id, error_message = _build_frontend_quiz_answer_record(item)
        if error_message or record is None:
            return jsonify({"success": False, "error": error_message or "invalid quiz answer payload.", "answer_index": item_index}), 400

        prepared.append((record, quiz_id))

    records = [
        _save_frontend_quiz_answer_record(username, record, quiz_id)
        for record, quiz_id in prepared
    ]

    first_record = prepared[0][0]
    log_event(
        "quiz_answers_submitted",
        "学生测验作答已批量提交",
        payload={
            "username": username,
            "lecture_id": first_record.get("lecture_id"),
            "book_id": first_record.get("book_id"),
            "chapter_name": first_record.get("chapter_name"),
            "session_name": first_record.get("session_name"),
            "answer_count": len(records),
        },
    )
    return jsonify({"success": True, "records": records})

@bp.route("/lectures/<lecture_id>/books/<book_id>/annotations", methods=["GET"])
def get_book_annotations(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    from pathlib import Path
    data_dir = Path(str(_cfg.get("data_dir") or "data"))
    annotations_path = data_dir / "lectures" / lecture_id / "books" / book_id / "annotations.xml"
    content = ""
    if annotations_path.exists():
        try:
            content = annotations_path.read_text(encoding="utf-8")
        except Exception:
            content = ""
    return jsonify({"success": True, "lecture_id": lecture_id, "book_id": book_id, "content": content})

@bp.route("/lectures/<lecture_id>/books/<book_id>/summary", methods=["GET"])
def get_book_summary(lecture_id: str, book_id: str):
    """加载 summary.xml 并返回解析后的 summary_brief 和 summary_detail。"""
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    from core.booksproc import load_book_summary_from_storage
    summary = load_book_summary_from_storage(lecture_id, book_id)
    return jsonify({
        "success": True,
        "lecture_id": lecture_id,
        "book_id": book_id,
        "summary_brief": summary.get("summary_brief", ""),
        "summary_detail": summary.get("summary_detail", ""),
    })

@bp.route("/lectures/<lecture_id>/books/<book_id>/vectorize", methods=["GET"])
def get_book_vectorize_status(lecture_id: str, book_id: str):
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    return jsonify({
        "success": True,
        "book_id": book_id,
        "vector_status": book.get("vector_status"),
        "vector_provider": book.get("vector_provider"),
        "chunks_count": book.get("chunks_count"),
        "vector_count": book.get("vector_count"),
        "request_path": book.get("vector_request_path") or "",
        "error": book.get("error") or "",
    })

@bp.route("/lectures/<lecture_id>/books/<book_id>/vectorize", methods=["POST"])
def trigger_book_vectorize(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    data = request.get_json(silent=True) or {}
    force = _as_bool(data.get("force"), default=False)
    async_mode = _as_bool(data.get("async"), default=True)

    nexoradb_status = get_nexoradb_status(_cfg)
    if not nexoradb_status.get("available"):
        return _vector_unavailable_response(nexoradb_status)

    if async_mode:
        result = queue_vectorize_book(_cfg, lecture_id, book_id, force=force)
        return jsonify({"success": True, "vectorization": result}), 202

    result = vectorize_book(_cfg, lecture_id, book_id, force=force)
    return jsonify({"success": True, "vectorization": result})
