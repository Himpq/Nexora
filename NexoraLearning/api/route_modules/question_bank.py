"""Question bank routes."""

from api import routes as _routes
from core.cognition import QuestionCognitionBridge

# The first split keeps common helpers in api.routes while route handlers move by domain.
_routes._export_route_context(globals())


@bp.route("/frontend/question-bank", methods=["GET"])
def frontend_question_bank():
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    answer_state_filter = str(request.args.get("answer_state") or "").strip()
    question_type_filter = str(request.args.get("question_type") or "").strip()
    group_mode = str(request.args.get("group_mode") or "").strip().lower()
    page = max(1, _safe_int(request.args.get("page"), 1))
    page_size = min(50, max(1, _safe_int(request.args.get("page_size"), 5)))
    rows = list(user_store.list_question_bank_items(_cfg, username) or [])
    completions = list(user_store.list_question_completions(_cfg, username) or [])
    rows = _annotate_question_bank_rows(rows, completions)
    if lecture_id:
        rows = [row for row in rows if str((row or {}).get("lecture_id") or "").strip() == lecture_id]
    if answer_state_filter and answer_state_filter != "all":
        rows = [row for row in rows if str((row or {}).get("answer_state") or "").strip() == answer_state_filter]
    if question_type_filter and question_type_filter != "all":
        rows = [
            row
            for row in rows
            if _question_bank_type_label(_question_bank_question_payload(row)) == question_type_filter
        ]
    rows = list(reversed(rows))
    summary = {
        "total": len(rows),
        "pending": sum(1 for row in rows if str((row or {}).get("answer_state") or "") == "pending"),
        "submitted": sum(1 for row in rows if str((row or {}).get("answer_state") or "") == "submitted"),
        "needs_review": sum(1 for row in rows if str((row or {}).get("answer_state") or "") == "needs_review"),
    }
    if group_mode in {"chapter", "group", "groups"}:
        groups = _build_question_bank_groups(rows)
        total_groups = len(groups)
        total_pages = max(1, (total_groups + page_size - 1) // page_size)
        page = min(page, total_pages)
        start = (page - 1) * page_size
        page_groups = groups[start:start + page_size]
        return jsonify(
            {
                "success": True,
                "items": [item for group in page_groups for item in group.get("items", [])],
                "groups": page_groups,
                "total": len(rows),
                "total_groups": total_groups,
                "summary": summary,
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total": total_groups,
                    "total_items": len(rows),
                    "total_pages": total_pages,
                    "has_prev": page > 1,
                    "has_next": page < total_pages,
                },
            }
        )

    total = len(rows)
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = min(page, total_pages)
    start = (page - 1) * page_size
    page_rows = rows[start:start + page_size]
    return jsonify(
        {
            "success": True,
            "items": page_rows,
            "total": total,
            "summary": summary,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": total_pages,
                "has_prev": page > 1,
                "has_next": page < total_pages,
            },
        }
    )

@bp.route("/frontend/question-bank/groups/<path:group_id>", methods=["GET"])
def frontend_question_bank_group_detail(group_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    target_group_id = str(group_id or "").strip()
    if not target_group_id:
        return jsonify({"success": False, "error": "group_id is required."}), 400

    rows = list(user_store.list_question_bank_items(_cfg, username) or [])
    completions = list(user_store.list_question_completions(_cfg, username) or [])
    rows = list(reversed(_annotate_question_bank_rows(rows, completions)))
    groups = _build_question_bank_groups(rows)
    group = next(
        (
            item
            for item in groups
            if str(item.get("group_id") or item.get("question_group_id") or "").strip() == target_group_id
        ),
        None,
    )
    if group is None:
        return jsonify({"success": False, "error": "question group not found."}), 404
    return jsonify(
        {
            "success": True,
            "group": group,
            "items": group.get("items") if isinstance(group.get("items"), list) else [],
        }
    )

@bp.route("/frontend/question-bank/submit", methods=["POST"])
def frontend_question_bank_submit():
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400

    data = request.get_json(silent=True) or {}
    if not isinstance(data, MappingABC):
        return jsonify({"success": False, "error": "request body must be an object."}), 400

    question_id = str(data.get("question_id") or "").strip()
    student_answer = str(data.get("student_answer") or "").strip()
    if not question_id:
        return jsonify({"success": False, "error": "question_id is required."}), 400
    if not student_answer:
        return jsonify({"success": False, "error": "student_answer is required."}), 400

    rows = list(user_store.list_question_bank_items(_cfg, username) or [])
    source_row = None
    for row in rows:
        if isinstance(row, MappingABC) and str(row.get("question_id") or "").strip() == question_id:
            source_row = row
            break
    if source_row is None:
        return jsonify({"success": False, "error": "question not found."}), 404

    question = _question_bank_question_payload(source_row)
    title = question.get("title") or question.get("content") or "题库练习"
    is_correct = _question_bank_auto_judge(question, student_answer)
    review_state = "review_required" if is_correct is False else "submitted"
    record = {
        "type": "question_bank_answer",
        "question_id": question_id,
        "lecture_id": str(source_row.get("lecture_id") or "").strip(),
        "book_id": str(source_row.get("book_id") or "").strip(),
        "chapter_name": str(source_row.get("chapter_name") or "").strip(),
        "chapter_range": str(source_row.get("chapter_range") or "").strip(),
        "question_title": title,
        "question_content": question.get("content") or "",
        "question_difficulty": question.get("difficulty") or "",
        "question_type": question.get("type") or "",
        "question_options": question.get("options") or [],
        "question_hint": question.get("hint") or "",
        "student_answer": student_answer,
        "reference_answer": question.get("answer") or "",
        "answer_chars": len(student_answer),
        "review_state": review_state,
        "source": "question_bank_center",
    }
    if is_correct is not None:
        record["is_correct"] = bool(is_correct)

    saved = user_store.append_question_completion(_cfg, username, record)
    answer_state = "needs_review" if saved.get("is_correct") is False else "submitted"
    cognition = QuestionCognitionBridge(_cfg).record_submission(username, source_row, saved)
    log_event(
        "question_bank_answer_submitted",
        "题库中心作答已提交",
        payload={
            "username": username,
            "question_id": question_id,
            "lecture_id": saved.get("lecture_id"),
            "book_id": saved.get("book_id"),
            "answer_state": answer_state,
            "cognition_recorded": bool(cognition.get("recorded")),
            "cognition_reason": cognition.get("reason"),
        },
    )
    return jsonify(
        {
            "success": True,
            "record": saved,
            "answer_state": answer_state,
            "cognition": cognition,
        }
    )
