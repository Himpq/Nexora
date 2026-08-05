"""Personalized learning and mindmap routes."""

from typing import Callable

from api import routes as _routes

# The first split keeps common helpers in api.routes while route handlers move by domain.
_routes._export_route_context(globals())


_MINDMAP_STREAM_LOCK = threading.Lock()
_ACTIVE_MINDMAP_STREAMS = set()


def _queue_learning_path_status(events: Any, message: str) -> None:
    """将非空学习路线进度写入 SSE 事件队列。"""
    text = str(message or "").strip()

    if text:
        events.put(("status", {"message": text}))


def _learning_path_wait_event(user_id: str, lecture_id: str, started_at: float) -> str:
    """记录模型等待心跳，并返回可展示的 SSE 状态。"""
    elapsed_seconds = max(0, int(time.monotonic() - started_at))
    log_event(
        "personalized_learning_path_stream_wait",
        "个性化学习路线模型请求仍在处理中",
        payload={
            "user_id": user_id,
            "lecture_id": lecture_id,
            "elapsed_seconds": elapsed_seconds,
        },
    )
    return _reader_guide_sse_event(
        "status",
        {"message": f"模型仍在规划学习路线，已等待 {elapsed_seconds} 秒"},
    )


@bp.route("/frontend/personalized-learning/generate-path", methods=["POST"])
def frontend_personalized_learning_generate_path():
    """SSE 流式生成个性化学习路线。"""
    try:
        data = request.get_json(silent=True) or {}
        lecture_id = str(data.get("lecture_id") or "").strip()
        if not lecture_id:
            raise ValueError("lecture_id is required.")
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400

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
                from core.booksproc.personalized_learning import (
                    generate_learning_path_with_tools,
                    save_learning_path,
                    load_pre_reading_qa,
                )
                from core.booksproc.outline import load_outline

                log_event(
                    "personalized_learning_path_stream_start",
                    "个性化学习路线流启动",
                    payload={"user_id": user_id, "lecture_id": lecture_id},
                )

                outline = load_outline(_cfg, lecture_id)
                if not outline:
                    push_event("error", {"success": False, "error": "课程大纲未生成，请先生成大纲。"})
                    return

                books_info, catalog_rows = _build_personalized_learning_catalog_context(lecture_id, outline)

                user_md = str(user_store.read_memory(_cfg, user_id, "user") or "")

                qa_data = load_pre_reading_qa(_cfg, user_id, lecture_id)

                from prompts import (
                    PERSONALIZED_LEARNING_PATH_SYSTEM_PROMPT,
                    PERSONALIZED_LEARNING_PATH_USER_PROMPT,
                )

                outline_json = json.dumps(outline, ensure_ascii=False)
                books_json = json.dumps(books_info, ensure_ascii=False)
                catalog_json = json.dumps(catalog_rows, ensure_ascii=False)
                qa_json = json.dumps(qa_data, ensure_ascii=False) if qa_data else "{}"
                profile_json = json.dumps({"user_profile": user_md[:3000]}, ensure_ascii=False)

                proxy = _cfg.get("__proxy__")
                if proxy is None:
                    from core.nexora_proxy import NexoraProxy as _NP
                    proxy = _NP(_cfg)
                    _cfg["__proxy__"] = proxy

                default_model = get_default_nexora_model(_cfg)

                log_event(
                    "personalized_learning_path_stream_context",
                    "个性化学习路线上下文已装载",
                    payload={
                        "user_id": user_id,
                        "lecture_id": lecture_id,
                        "books_count": len(books_info),
                        "catalog_chapters": len(catalog_rows),
                        "catalog_chars": len(catalog_json),
                        "outline_sections": len(outline.get("sections") or []) if isinstance(outline, dict) else 0,
                        "qa_present": bool(qa_data),
                    },
                )

                user_prompt = PERSONALIZED_LEARNING_PATH_USER_PROMPT.replace(
                    "{{outline_json}}", outline_json
                ).replace(
                    "{{books_json}}", books_json
                ).replace(
                    "{{catalog_json}}", catalog_json
                ).replace(
                    "{{qa_json}}", qa_json
                ).replace(
                    "{{profile_json}}", profile_json
                )

                advice_text, chapters = generate_learning_path_with_tools(
                    _cfg,
                    proxy=proxy,
                    model_name=default_model or "",
                    user_id=user_id,
                    lecture_id=lecture_id,
                    system_prompt=PERSONALIZED_LEARNING_PATH_SYSTEM_PROMPT,
                    user_prompt=user_prompt,
                    full_text=catalog_json,
                    request_timeout=180,
                    catalog_rows=catalog_rows,
                    on_delta=push_delta,
                    on_status=lambda message: _queue_learning_path_status(events, message),
                )

                if not chapters:
                    push_event("error", {"success": False, "error": "无法解析学习路线结果"})
                    return

                path_data = {
                    "advice": advice_text,
                    "chapters": chapters,
                    "outline": outline,
                    "books": books_info,
                    "catalog": catalog_rows,
                    "qa": qa_data,
                    "user_profile_summary": user_md[:1000],
                }
                save_learning_path(_cfg, user_id, lecture_id, path_data)

                push_event("done", {
                    "success": True,
                    "advice": advice_text,
                    "chapters": chapters,
                    "cached": False,
                })

            except Exception as exc:
                log_event(
                    "personalized_learning_path_error",
                    str(exc),
                    payload={"user_id": user_id, "lecture_id": lecture_id},
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                push_event("close", {})

        thread = threading.Thread(target=run_worker, name="personalized-learning-path", daemon=True)
        started_at = time.monotonic()
        thread.start()

        yield _reader_guide_sse_event("status", {"message": "个性化学习路线生成已启动"})

        while True:
            try:
                event_name, event_payload = events.get(timeout=30)
            except queue.Empty:
                yield _learning_path_wait_event(user_id, lecture_id, started_at)
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

@bp.route("/frontend/personalized-learning/generate-path-stream", methods=["GET"])
def frontend_personalized_learning_generate_path_stream():
    """GET SSE endpoint for learning path generation (for EventSource)."""
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    if not lecture_id:
        return Response("event: error\ndata: {\"error\": \"lecture_id is required\"}\n\n", mimetype="text/event-stream")

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return Response("event: error\ndata: {\"error\": \"user_id is required\"}\n\n", mimetype="text/event-stream")

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
                from core.booksproc.personalized_learning import (
                    generate_learning_path_with_tools,
                    save_learning_path,
                    load_pre_reading_qa,
                )
                from core.booksproc.outline import load_outline

                log_event(
                    "personalized_learning_path_stream_start",
                    "个性化学习路线流启动",
                    payload={"user_id": user_id, "lecture_id": lecture_id},
                )

                outline = load_outline(_cfg, lecture_id)
                if not outline:
                    push_event("error", {"success": False, "error": "课程大纲未生成"})
                    return

                books_info, catalog_rows = _build_personalized_learning_catalog_context(lecture_id, outline)

                user_md = str(user_store.read_memory(_cfg, user_id, "user") or "")
                qa_data = load_pre_reading_qa(_cfg, user_id, lecture_id)

                from prompts import (
                    PERSONALIZED_LEARNING_PATH_SYSTEM_PROMPT,
                    PERSONALIZED_LEARNING_PATH_USER_PROMPT,
                )

                outline_json = json.dumps(outline, ensure_ascii=False)
                books_json = json.dumps(books_info, ensure_ascii=False)
                catalog_json = json.dumps(catalog_rows, ensure_ascii=False)
                qa_json = json.dumps(qa_data, ensure_ascii=False) if qa_data else "{}"
                profile_json = json.dumps({"user_profile": user_md[:3000]}, ensure_ascii=False)

                proxy = _cfg.get("__proxy__")
                if proxy is None:
                    from core.nexora_proxy import NexoraProxy as _NP
                    proxy = _NP(_cfg)
                    _cfg["__proxy__"] = proxy

                default_model = get_default_nexora_model(_cfg)

                log_event(
                    "personalized_learning_path_stream_context",
                    "个性化学习路线上下文已装载",
                    payload={
                        "user_id": user_id,
                        "lecture_id": lecture_id,
                        "books_count": len(books_info),
                        "catalog_chapters": len(catalog_rows),
                        "catalog_chars": len(catalog_json),
                        "outline_sections": len(outline.get("sections") or []) if isinstance(outline, dict) else 0,
                        "qa_present": bool(qa_data),
                    },
                )

                user_prompt = PERSONALIZED_LEARNING_PATH_USER_PROMPT.replace(
                    "{{outline_json}}", outline_json
                ).replace(
                    "{{books_json}}", books_json
                ).replace(
                    "{{catalog_json}}", catalog_json
                ).replace(
                    "{{qa_json}}", qa_json
                ).replace(
                    "{{profile_json}}", profile_json
                )

                advice_text, chapters = generate_learning_path_with_tools(
                    _cfg,
                    proxy=proxy,
                    model_name=default_model or "",
                    user_id=user_id,
                    lecture_id=lecture_id,
                    system_prompt=PERSONALIZED_LEARNING_PATH_SYSTEM_PROMPT,
                    user_prompt=user_prompt,
                    full_text=catalog_json,
                    request_timeout=180,
                    catalog_rows=catalog_rows,
                    on_delta=push_delta,
                    on_status=lambda message: _queue_learning_path_status(events, message),
                )

                if not chapters:
                    push_event("error", {"success": False, "error": "无法解析学习路线结果"})
                    return

                path_data = {
                    "advice": advice_text,
                    "chapters": chapters,
                    "outline": outline,
                    "books": books_info,
                    "catalog": catalog_rows,
                    "qa": qa_data,
                    "user_profile_summary": user_md[:1000],
                }
                save_learning_path(_cfg, user_id, lecture_id, path_data)

                push_event("done", {
                    "success": True,
                    "advice": advice_text,
                    "chapters": chapters,
                    "cached": False,
                })

            except Exception as exc:
                log_event(
                    "personalized_learning_path_error",
                    str(exc),
                    payload={"user_id": user_id, "lecture_id": lecture_id},
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                push_event("close", {})

        thread = threading.Thread(target=run_worker, name="personalized-learning-path-get", daemon=True)
        started_at = time.monotonic()
        thread.start()

        yield _reader_guide_sse_event("status", {"message": "个性化学习路线生成已启动"})

        while True:
            try:
                event_name, event_payload = events.get(timeout=30)
            except queue.Empty:
                yield _learning_path_wait_event(user_id, lecture_id, started_at)
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

@bp.route("/frontend/personalized-learning/load-path", methods=["POST"])
def frontend_personalized_learning_load_path():
    """加载已生成的学习路线。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    if not lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required."}), 400

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    from core.booksproc.personalized_learning import (
        load_all_chapter_generation_states,
        load_chapter_generation_state,
        load_learning_path,
        load_all_chapter_status,
    )

    path_data = load_learning_path(_cfg, user_id, lecture_id)
    if not path_data:
        return jsonify({"success": True, "cached": False})

    chapters_status = load_all_chapter_status(_cfg, user_id, lecture_id)
    generation_states = load_all_chapter_generation_states(_cfg, user_id, lecture_id)
    generation_state = next(
        (
            row for row in generation_states
            if isinstance(row, dict) and str(row.get("status") or "").strip().lower() == "running"
        ),
        None,
    )
    chapter_generation = None
    if isinstance(generation_state, dict):
        chapter_generation = {
            key: generation_state.get(key)
            for key in (
                "job_id",
                "user_id",
                "lecture_id",
                "chapter_index",
                "status",
                "error",
                "started_at",
                "updated_at",
                "finished_at",
            )
        }
        chapter_generation["raw_content_chars"] = len(str(generation_state.get("raw_content") or ""))
    chapter_generations = []
    for row in generation_states:
        if not isinstance(row, dict):
            continue
        item = {
            key: row.get(key)
            for key in (
                "job_id",
                "user_id",
                "lecture_id",
                "chapter_index",
                "status",
                "error",
                "started_at",
                "updated_at",
                "finished_at",
            )
        }
        item["raw_content_chars"] = len(str(row.get("raw_content") or ""))
        chapter_generations.append(item)

    return jsonify({
        "success": True,
        "cached": True,
        "advice": path_data.get("advice", ""),
        "chapters": chapters_status,
        "chapter_generation": chapter_generation,
        "chapter_generations": chapter_generations,
    })

@bp.route("/frontend/personalized-learning/generate-chapter", methods=["POST"])
def frontend_personalized_learning_generate_chapter():
    """SSE 流式生成章节内容。"""
    try:
        data = request.get_json(silent=True) or {}
        lecture_id = str(data.get("lecture_id") or "").strip()
        chapter_index = data.get("chapter_index")
        if not lecture_id:
            raise ValueError("lecture_id is required.")
        if chapter_index is None:
            raise ValueError("chapter_index is required.")
        chapter_index = int(chapter_index)
    except (ValueError, TypeError) as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    return _personalized_learning_chapter_stream_response(user_id, lecture_id, chapter_index)

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
                from core.booksproc.personalized_learning import (
                    generate_chapter_markdown_with_tools,
                    load_learning_path,
                    save_chapter_content,
                )
                from core.lectures import load_book_text

                log_event(
                    "personalized_chapter_stream_start",
                    "个性化章节流启动",
                    payload={"user_id": user_id, "lecture_id": lecture_id, "chapter_index": chapter_index},
                )

                path_data = load_learning_path(_cfg, user_id, lecture_id)
                if not path_data:
                    push_event("error", {"success": False, "error": "学习路线未生成，请先生成学习路线。"})
                    return

                chapters = path_data.get("chapters") or []
                if chapter_index < 0 or chapter_index >= len(chapters):
                    push_event("error", {"success": False, "error": "章节索引超出范围。"})
                    return

                chapter = chapters[chapter_index]
                chapter_name = str(chapter.get("name") or "").strip()
                book_id = str(chapter.get("book_id") or "").strip()
                book_title = str(chapter.get("book_title") or "").strip()
                chapter_range = str(chapter.get("chapter_range") or "").strip()
                chapter_summary = str(chapter.get("chapter_summary") or "").strip()

                if not book_id:
                    push_event("error", {"success": False, "error": "章节未关联教材。"})
                    return
                if not chapter_range:
                    push_event("error", {"success": False, "error": "学习路线缺少章节范围，请重新生成学习路线。"})
                    return

                # 加载教材内容
                book_text = load_book_text(_cfg, lecture_id, book_id)
                if not book_text:
                    push_event("error", {"success": False, "error": "教材内容未找到。"})
                    return
                chapter_text = _clean_chapter_source_text(_slice_book_text_by_range(book_text, chapter_range))

                # 加载用户画像
                user_md = str(user_store.read_memory(_cfg, user_id, "user") or "")

                # 加载阅读前问答
                from core.booksproc.personalized_learning import load_pre_reading_qa
                qa_data = load_pre_reading_qa(_cfg, user_id, lecture_id)

                # 构建提示词
                from prompts import (
                    CHAPTER_CONTENT_GENERATION_SYSTEM_PROMPT,
                    CHAPTER_CONTENT_GENERATION_USER_PROMPT,
                )

                profile_json = json.dumps({"user_profile": user_md[:2000]}, ensure_ascii=False)
                qa_json = json.dumps(qa_data, ensure_ascii=False) if qa_data else "{}"
                advice_text = str(path_data.get("advice") or "").strip()

                user_prompt = CHAPTER_CONTENT_GENERATION_USER_PROMPT.replace(
                    "{{chapter_name}}", chapter_name
                ).replace(
                    "{{book_title}}", book_title
                ).replace(
                    "{{chapter_index}}", str(chapter_index)
                ).replace(
                    "{{chapter_range}}", chapter_range
                ).replace(
                    "{{chapter_summary}}", chapter_summary
                ).replace(
                    "{{book_content}}", chapter_text
                ).replace(
                    "{{profile_json}}", profile_json
                ).replace(
                    "{{qa_json}}", qa_json
                ).replace(
                    "{{learning_path_advice}}", advice_text
                )

                proxy = _cfg.get("__proxy__")
                if proxy is None:
                    from core.nexora_proxy import NexoraProxy as _NP
                    proxy = _NP(_cfg)
                    _cfg["__proxy__"] = proxy

                default_model = get_default_nexora_model(_cfg)
                markdown_content = generate_chapter_markdown_with_tools(
                    _cfg,
                    proxy=proxy,
                    model_name=default_model or "",
                    user_id=user_id,
                    lecture_id=lecture_id,
                    chapter_name=chapter_name,
                    system_prompt=CHAPTER_CONTENT_GENERATION_SYSTEM_PROMPT,
                    user_prompt=user_prompt,
                    full_text=chapter_text,
                    request_timeout=300,
                    on_delta=push_delta,
                )
                if not markdown_content:
                    push_event("error", {"success": False, "error": "生成内容为空"})
                    return

                save_chapter_content(_cfg, user_id, lecture_id, chapter_index, markdown_content)

                push_event("done", {
                    "success": True,
                    "chapter_index": chapter_index,
                    "chapter_name": chapter_name,
                    "content": markdown_content,
                })

            except Exception as exc:
                log_event(
                    "personalized_chapter_error",
                    str(exc),
                    payload={"user_id": user_id, "lecture_id": lecture_id, "chapter_index": chapter_index},
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                push_event("close", {})

        thread = threading.Thread(target=run_worker, name="personalized-chapter-gen", daemon=True)
        thread.start()

        yield _reader_guide_sse_event("status", {"message": "chapter content generation started"})

        while True:
            try:
                event_name, event_payload = events.get(timeout=30)
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

@bp.route("/frontend/personalized-learning/generate-chapter-stream", methods=["GET"])
def frontend_personalized_learning_generate_chapter_stream():
    """GET SSE endpoint for chapter content generation (for EventSource)."""
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    chapter_index_str = str(request.args.get("chapter_index") or "").strip()

    if not lecture_id:
        return Response("event: error\ndata: {\"error\": \"lecture_id is required\"}\n\n", mimetype="text/event-stream")

    try:
        chapter_index = int(chapter_index_str)
    except (ValueError, TypeError):
        return Response("event: error\ndata: {\"error\": \"chapter_index must be integer\"}\n\n", mimetype="text/event-stream")

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return Response("event: error\ndata: {\"error\": \"user_id is required\"}\n\n", mimetype="text/event-stream")

    return _personalized_learning_chapter_stream_response(user_id, lecture_id, chapter_index)

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
                from core.booksproc.personalized_learning import (
                    generate_chapter_markdown_with_tools,
                    load_learning_path,
                    save_chapter_content,
                )
                from core.lectures import load_book_text

                log_event(
                    "personalized_chapter_stream_start",
                    "个性化章节流启动",
                    payload={"user_id": user_id, "lecture_id": lecture_id, "chapter_index": chapter_index},
                )

                path_data = load_learning_path(_cfg, user_id, lecture_id)
                if not path_data:
                    push_event("error", {"success": False, "error": "学习路线未生成"})
                    return

                chapters = path_data.get("chapters") or []
                if chapter_index < 0 or chapter_index >= len(chapters):
                    push_event("error", {"success": False, "error": "章节索引超出范围"})
                    return

                chapter = chapters[chapter_index]
                chapter_name = str(chapter.get("name") or "").strip()
                book_id = str(chapter.get("book_id") or "").strip()
                book_title = str(chapter.get("book_title") or "").strip()
                chapter_range = str(chapter.get("chapter_range") or "").strip()
                chapter_summary = str(chapter.get("chapter_summary") or "").strip()

                if not book_id:
                    push_event("error", {"success": False, "error": "章节未关联教材"})
                    return
                if not chapter_range:
                    push_event("error", {"success": False, "error": "学习路线缺少章节范围，请重新生成学习路线。"})
                    return

                book_text = load_book_text(_cfg, lecture_id, book_id)
                if not book_text:
                    push_event("error", {"success": False, "error": "教材内容未找到"})
                    return
                chapter_text = _clean_chapter_source_text(_slice_book_text_by_range(book_text, chapter_range))

                user_md = str(user_store.read_memory(_cfg, user_id, "user") or "")

                from core.booksproc.personalized_learning import load_pre_reading_qa
                qa_data = load_pre_reading_qa(_cfg, user_id, lecture_id)

                from prompts import (
                    CHAPTER_CONTENT_GENERATION_SYSTEM_PROMPT,
                    CHAPTER_CONTENT_GENERATION_USER_PROMPT,
                )

                profile_json = json.dumps({"user_profile": user_md[:2000]}, ensure_ascii=False)
                qa_json = json.dumps(qa_data, ensure_ascii=False) if qa_data else "{}"
                advice_text = str(path_data.get("advice") or "").strip()

                user_prompt = CHAPTER_CONTENT_GENERATION_USER_PROMPT.replace(
                    "{{chapter_name}}", chapter_name
                ).replace(
                    "{{book_title}}", book_title
                ).replace(
                    "{{chapter_index}}", str(chapter_index)
                ).replace(
                    "{{chapter_range}}", chapter_range
                ).replace(
                    "{{chapter_summary}}", chapter_summary
                ).replace(
                    "{{book_content}}", chapter_text
                ).replace(
                    "{{profile_json}}", profile_json
                ).replace(
                    "{{qa_json}}", qa_json
                ).replace(
                    "{{learning_path_advice}}", advice_text
                )

                proxy = _cfg.get("__proxy__")
                if proxy is None:
                    from core.nexora_proxy import NexoraProxy as _NP
                    proxy = _NP(_cfg)
                    _cfg["__proxy__"] = proxy

                default_model = get_default_nexora_model(_cfg)
                markdown_content = generate_chapter_markdown_with_tools(
                    _cfg,
                    proxy=proxy,
                    model_name=default_model or "",
                    user_id=user_id,
                    lecture_id=lecture_id,
                    chapter_name=chapter_name,
                    system_prompt=CHAPTER_CONTENT_GENERATION_SYSTEM_PROMPT,
                    user_prompt=user_prompt,
                    full_text=chapter_text,
                    request_timeout=300,
                    on_delta=push_delta,
                )
                if not markdown_content:
                    push_event("error", {"success": False, "error": "生成内容为空"})
                    return

                save_chapter_content(_cfg, user_id, lecture_id, chapter_index, markdown_content)

                push_event("done", {
                    "success": True,
                    "chapter_index": chapter_index,
                    "chapter_name": chapter_name,
                    "content": markdown_content,
                })

            except Exception as exc:
                log_event(
                    "personalized_chapter_error",
                    str(exc),
                    payload={"user_id": user_id, "lecture_id": lecture_id, "chapter_index": chapter_index},
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                push_event("close", {})

        thread = threading.Thread(target=run_worker, name="personalized-chapter-gen-get", daemon=True)
        thread.start()

        yield _reader_guide_sse_event("status", {"message": "chapter content generation started"})

        while True:
            try:
                event_name, event_payload = events.get(timeout=30)
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

@bp.route("/frontend/personalized-learning/load-chapter", methods=["POST"])
def frontend_personalized_learning_load_chapter():
    """加载已生成的章节内容。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    chapter_index = data.get("chapter_index")

    if not lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required."}), 400
    if chapter_index is None:
        return jsonify({"success": False, "error": "chapter_index is required."}), 400

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    from core.booksproc.personalized_learning import load_chapter_content

    content = load_chapter_content(_cfg, user_id, lecture_id, int(chapter_index))
    if content is None:
        return jsonify({"success": True, "cached": False})

    return jsonify({
        "success": True,
        "cached": True,
        "content": content,
    })

@bp.route("/frontend/personalized-learning/chapter-complete", methods=["POST"])
def frontend_personalized_learning_chapter_complete():
    """标记个性化学习路线中的章节学习完成。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    try:
        chapter_index = int(data.get("chapter_index"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "chapter_index is required."}), 400

    if not lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required."}), 400

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    from core.booksproc.personalized_learning import (
        has_chapter_content,
        load_all_chapter_status,
        load_chapter_content,
        load_learning_path,
        mark_chapter_completed,
    )

    path_data = load_learning_path(_cfg, user_id, lecture_id)
    if not path_data:
        return jsonify({"success": False, "error": "学习路线未生成。"}), 404

    chapters = path_data.get("chapters") if isinstance(path_data, dict) else []
    if not isinstance(chapters, list) or chapter_index < 0 or chapter_index >= len(chapters):
        return jsonify({"success": False, "error": "章节索引超出范围。"}), 400

    if not has_chapter_content(_cfg, user_id, lecture_id, chapter_index):
        return jsonify({"success": False, "error": "请先生成并阅读本章学习素材。"}), 400

    chapter = chapters[chapter_index] if isinstance(chapters[chapter_index], dict) else {}
    chapter_name = str(chapter.get("name") or "").strip()
    book_id = str(chapter.get("book_id") or "").strip()
    chapter_range = str(chapter.get("chapter_range") or "").strip()
    outline_section_id = str(chapter.get("outline_section_id") or "").strip()

    if not chapter_name or not book_id:
        return jsonify({"success": False, "error": "学习路线章节缺少教材信息。"}), 400

    existing_records = user_store.list_learning_records(_cfg, user_id)
    already_completed = any(
        isinstance(row, dict)
        and str(row.get("type") or "").strip() == "chapter_completed"
        and str(row.get("lecture_id") or "").strip() == lecture_id
        and str(row.get("book_id") or "").strip() == book_id
        and str(row.get("chapter_name") or "").strip() == chapter_name
        for row in (existing_records or [])
    )

    updated_path = mark_chapter_completed(_cfg, user_id, lecture_id, chapter_index)
    if not updated_path:
        return jsonify({"success": False, "error": "章节完成状态更新失败。"}), 500

    if not already_completed:
        user_store.append_learning_record(
            _cfg,
            user_id,
            {
                "type": "chapter_completed",
                "source": "personalized_learning_path",
                "lecture_id": lecture_id,
                "book_id": book_id,
                "chapter_name": chapter_name,
                "chapter_index": chapter_index,
                "chapter_range": chapter_range,
                "outline_section_id": outline_section_id,
            },
        )

    memory_job = None
    if not already_completed:
        chapter_content = str(load_chapter_content(_cfg, user_id, lecture_id, chapter_index) or "")
        memory_job = enqueue_memory_job(
            _cfg,
            user_id=user_id,
            lecture_id=lecture_id,
            reason="personalized_chapter_complete",
            payload={
                "book_id": book_id,
                "chapter_name": chapter_name,
                "chapter_index": chapter_index,
                "chapter_range": chapter_range,
                "outline_section_id": outline_section_id,
                "chapter_context": chapter_content[:12000],
            },
        )

    chapters_status = load_all_chapter_status(_cfg, user_id, lecture_id)
    log_event(
        "personalized_chapter_complete",
        "个性化学习路线章节已标记完成",
        payload={
            "user_id": user_id,
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_index": chapter_index,
            "chapter_name": chapter_name,
            "already_completed": already_completed,
            "memory_job": dict(memory_job or {}),
        },
    )
    return jsonify({
        "success": True,
        "already_completed": already_completed,
        "chapters": chapters_status,
        "memory_enqueue": memory_job,
    })


def _load_personalized_chapter_quiz_context(
    user_id: str,
    lecture_id: str,
    chapter_index: int,
) -> Dict[str, Any]:
    """校验个性化章节并组装课后测验唯一上下文。"""
    from core.booksproc.personalized_learning import load_chapter_content, load_learning_path

    path_data = load_learning_path(_cfg, user_id, lecture_id)
    if not path_data:
        raise FileNotFoundError("学习路线未生成。")

    chapters = path_data.get("chapters") if isinstance(path_data, dict) else []
    if not isinstance(chapters, list) or chapter_index < 0 or chapter_index >= len(chapters):
        raise ValueError("章节索引超出范围。")

    chapter = chapters[chapter_index] if isinstance(chapters[chapter_index], dict) else {}
    chapter_name = str(chapter.get("name") or "").strip()
    book_id = str(chapter.get("book_id") or "").strip()
    chapter_range = str(chapter.get("chapter_range") or "").strip()
    chapter_content = str(load_chapter_content(_cfg, user_id, lecture_id, chapter_index) or "").strip()

    if not book_id or not chapter_name:
        raise ValueError("学习路线章节缺少教材信息。")

    if not chapter_content:
        raise ValueError("请先生成本章学习素材。")

    return {
        "book_id": book_id,
        "chapter_name": chapter_name,
        "chapter_range": chapter_range,
        "chapter_content": chapter_content[:12000],
    }


def _create_personalized_chapter_quiz(
    user_id: str,
    lecture_id: str,
    chapter_index: int,
    context: Mapping[str, Any],
    *,
    on_delta: Optional[Callable[[str], None]] = None,
    on_status: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """以同一入口读取或生成测验，供 JSON 与 SSE 路由复用。"""
    from core.booksproc.chapter_quiz import load_or_create_chapter_quiz

    return load_or_create_chapter_quiz(
        _cfg,
        user_id=user_id,
        lecture_id=lecture_id,
        book_id=str(context.get("book_id") or ""),
        chapter_index=chapter_index,
        chapter_name=str(context.get("chapter_name") or ""),
        chapter_range=str(context.get("chapter_range") or ""),
        chapter_context=str(context.get("chapter_content") or ""),
        chapter_detail_xml="",
        on_delta=on_delta,
        on_status=on_status,
    )


@bp.route("/frontend/personalized-learning/chapter-quiz", methods=["POST"])
def frontend_personalized_learning_chapter_quiz():
    """兼容非流式客户端读取或创建个性化章节练习。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()

    try:
        chapter_index = int(data.get("chapter_index"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "chapter_index is required."}), 400

    if not lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required."}), 400

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    try:
        context = _load_personalized_chapter_quiz_context(user_id, lecture_id, chapter_index)
        quiz = _create_personalized_chapter_quiz(user_id, lecture_id, chapter_index, context)
        return jsonify({
            "success": True,
            "quiz": quiz,
            "quiz_id": quiz.get("quiz_id"),
            "questions": quiz.get("questions") or [],
            "answers": quiz.get("answers") or {},
        }), 200
    except FileNotFoundError as exc:
        return jsonify({"success": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        log_event(
            "personalized_chapter_quiz_error",
            str(exc),
            payload={"user_id": user_id, "lecture_id": lecture_id, "chapter_index": chapter_index},
        )
        return jsonify({"success": False, "error": str(exc)}), 500


@bp.route("/frontend/personalized-learning/chapter-quiz-stream", methods=["GET"])
def frontend_personalized_learning_chapter_quiz_stream():
    """打开个性化章节后以 SSE 读取或流式生成课后测验。"""
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    chapter_index_text = str(request.args.get("chapter_index") or "").strip()

    if not lecture_id:
        return Response(
            _reader_guide_sse_event("error", {"success": False, "error": "lecture_id is required."}),
            mimetype="text/event-stream",
        )

    try:
        chapter_index = int(chapter_index_text)
    except (TypeError, ValueError):
        return Response(
            _reader_guide_sse_event("error", {"success": False, "error": "chapter_index must be integer."}),
            mimetype="text/event-stream",
        )

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return Response(
            _reader_guide_sse_event("error", {"success": False, "error": "user_id is required."}),
            mimetype="text/event-stream",
        )

    def event_stream():
        events: "queue.Queue[Tuple[str, Dict[str, Any]]]" = queue.Queue()

        def push_event(event_name: str, event_payload: Dict[str, Any]) -> None:
            events.put((event_name, event_payload))

        def push_delta(delta_text: str) -> None:
            text = str(delta_text or "")

            if text:
                push_event("delta", {"content": text})

        def push_status(message: str) -> None:
            text = str(message or "").strip()

            if text:
                push_event("status", {"message": text})

        def run_worker() -> None:
            try:
                context = _load_personalized_chapter_quiz_context(user_id, lecture_id, chapter_index)
                quiz = _create_personalized_chapter_quiz(
                    user_id,
                    lecture_id,
                    chapter_index,
                    context,
                    on_delta=push_delta,
                    on_status=push_status,
                )
                push_event("done", {
                    "success": True,
                    "quiz": quiz,
                    "quiz_id": quiz.get("quiz_id"),
                    "questions": quiz.get("questions") or [],
                    "answers": quiz.get("answers") or {},
                })
            except Exception as exc:
                log_event(
                    "personalized_chapter_quiz_stream_error",
                    str(exc),
                    payload={
                        "user_id": user_id,
                        "lecture_id": lecture_id,
                        "chapter_index": chapter_index,
                    },
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                push_event("close", {})

        thread = threading.Thread(
            target=run_worker,
            name="personalized-chapter-quiz-stream",
            daemon=True,
        )
        started_at = time.monotonic()
        thread.start()

        yield _reader_guide_sse_event("status", {"message": "正在准备本章测验"})

        while True:
            try:
                event_name, event_payload = events.get(timeout=15)
            except queue.Empty:
                elapsed_seconds = max(0, int(time.monotonic() - started_at))
                yield _reader_guide_sse_event(
                    "status",
                    {"message": f"模型仍在生成本章测验，已等待 {elapsed_seconds} 秒"},
                )
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


@bp.route("/frontend/personalized-learning/save-qa", methods=["POST"])
def frontend_personalized_learning_save_qa():
    """保存阅读前问答。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    if not lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required."}), 400

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    from core.booksproc.personalized_learning import save_pre_reading_qa

    qa_data = {
        "questions": data.get("questions") or [],
        "answers": data.get("answers") or {},
        "skipped": bool(data.get("skipped")),
    }

    path = save_pre_reading_qa(_cfg, user_id, lecture_id, qa_data)
    return jsonify({"success": True, "path": path})

@bp.route("/frontend/personalized-learning/load-qa", methods=["POST"])
def frontend_personalized_learning_load_qa():
    """加载阅读前问答。"""
    data = request.get_json(silent=True) or {}
    lecture_id = str(data.get("lecture_id") or "").strip()
    if not lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required."}), 400

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400

    from core.booksproc.personalized_learning import load_pre_reading_qa

    qa_data = load_pre_reading_qa(_cfg, user_id, lecture_id)
    if not qa_data:
        return jsonify({"success": True, "cached": False})

    return jsonify({"success": True, "cached": True, "data": qa_data})

@bp.route("/frontend/personalized-learning/generate-qa-stream", methods=["GET"])
def frontend_personalized_learning_generate_qa_stream():
    """GET SSE endpoint for learning path QA generation (no book_id required)."""
    lecture_id = str(request.args.get("lecture_id") or "").strip()
    if not lecture_id:
        return Response("event: error\ndata: {\"error\": \"lecture_id is required\"}\n\n", mimetype="text/event-stream")

    user_id = _resolve_runtime_user_id()
    if not user_id:
        return Response("event: error\ndata: {\"error\": \"user_id is required\"}\n\n", mimetype="text/event-stream")

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
                from core.booksproc.outline import load_outline
                from core.booksproc.guide import generate_pre_reading_questions
                from core.lectures import get_lecture as get_learning_lecture

                log_event(
                    "personalized_qa_stream_start",
                    "个性化学习阅读前问答流启动",
                    payload={"user_id": user_id, "lecture_id": lecture_id, "scope": "course"},
                )

                outline = load_outline(_cfg, lecture_id)
                if not outline:
                    push_event("error", {"success": False, "error": "课程大纲未生成"})
                    return
                push_event("status", {"message": "已读取课程大纲，正在整理教材上下文"})

                lecture = get_learning_lecture(_cfg, lecture_id)
                lecture_title = str(lecture.get("title") or "") if lecture else ""

                outline_text = json.dumps(outline, ensure_ascii=False)
                guide_context, books_info, books_with_content_count = _build_personalized_qa_guide_context(
                    lecture_id=lecture_id,
                    lecture_title=lecture_title,
                    outline=outline,
                )
                push_event("status", {"message": "阅读前问答上下文已装载，正在请求模型"})

                log_event(
                    "personalized_qa_stream_context",
                    "个性化学习阅读前问答上下文已加载",
                    payload={
                        "user_id": user_id,
                        "lecture_id": lecture_id,
                        "lecture_title": lecture_title,
                        "books_count": len(books_info),
                        "books_with_content_count": books_with_content_count,
                        "outline_chars": len(outline_text),
                        "guide_context_chars": len(guide_context),
                        "scope": "course",
                    },
                    content=guide_context[:1800],
                )

                result = generate_pre_reading_questions(
                    _cfg,
                    lecture_id=lecture_id,
                    book_id="",
                    chapter_name=lecture_title or "课程整体内容",
                    session_name="阅读前内容定位",
                    guide_context=guide_context,
                    stream=True,
                    on_delta=push_delta,
                )
                questions = result.get("questions") if isinstance(result, dict) else []
                if not questions:
                    push_event("error", {"success": False, "error": "模型未返回问题"})
                    return

                push_event("done", {"success": True, "questions": questions})

            except Exception as exc:
                log_event(
                    "personalized_qa_stream_error",
                    str(exc),
                    payload={"user_id": user_id, "lecture_id": lecture_id},
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                push_event("close", {})

        thread = threading.Thread(target=run_worker, name="personalized-qa-stream", daemon=True)
        thread.start()

        yield _reader_guide_sse_event("status", {"message": "personalized QA stream started"})

        while True:
            try:
                event_name, event_payload = events.get(timeout=30)
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

def _load_section_difficulty(lecture_id: str) -> Dict[str, str]:
    """读取课程大纲中各 section 的难度标注（知识图谱按难度着色节点）。"""
    from core.booksproc.outline import load_outline

    outline = load_outline(_cfg, lecture_id)
    if not isinstance(outline, dict):
        return {}

    difficulty_map: Dict[str, str] = {}
    for section in outline.get("sections") or []:
        if not isinstance(section, dict):
            continue

        section_id = str(section.get("id") or "").strip()
        difficulty = str(section.get("difficulty") or "").strip()

        if section_id and difficulty:
            difficulty_map[section_id] = difficulty

    return difficulty_map

@bp.route("/frontend/mindmap/<lecture_id>", methods=["GET"])
def frontend_get_mindmap(lecture_id: str):
    """读取已生成的课程级思维导图。"""
    from core.booksproc.mindmap import load_mindmap

    mindmap = load_mindmap(_cfg, lecture_id)
    if mindmap is None:
        return jsonify({"success": False, "error": "思维导图尚未生成"}), 404
    return jsonify({
        "success": True,
        "mindmap": mindmap,
        "section_difficulty": _load_section_difficulty(lecture_id),
    })

@bp.route("/frontend/mindmap/<lecture_id>/generate-stream", methods=["GET"])
def frontend_generate_mindmap_stream(lecture_id: str):
    """流式生成课程级思维导图，向课程主页推送模型活动。"""
    safe_lecture_id = str(lecture_id or "").strip()
    runtime_user_id = _resolve_runtime_user_id() or "manual"
    if not safe_lecture_id:
        return Response('event: error\ndata: {"error": "lecture_id is required"}\n\n', mimetype="text/event-stream")

    def event_stream():
        generation_key = (runtime_user_id, safe_lecture_id)
        generation_in_progress = False
        with _MINDMAP_STREAM_LOCK:
            if generation_key in _ACTIVE_MINDMAP_STREAMS:
                generation_in_progress = True
            else:
                _ACTIVE_MINDMAP_STREAMS.add(generation_key)

        if generation_in_progress:
            yield 'event: error\ndata: {"error": "该课程的知识图谱正在生成，请等待当前任务完成。"}\n\n'
            return

        events: "queue.Queue[Tuple[str, Dict[str, Any]]]" = queue.Queue()
        cancel_event = threading.Event()
        generation_started_at = time.monotonic()

        def push_event(event_name: str, event_payload: Dict[str, Any]) -> None:
            events.put((event_name, event_payload))

        def push_status(message: str) -> None:
            text = str(message or "").strip()
            if text:
                push_event("status", {"message": text})

        def push_delta(delta_text: str) -> None:
            text = str(delta_text or "")
            if text:
                append_log_text(text)
                push_event("delta", {"content": text})

        def to_sse(event_name: str, event_payload: Dict[str, Any]) -> str:
            return f"event: {event_name}\ndata: {json.dumps(event_payload, ensure_ascii=False)}\n\n"

        def run_worker() -> None:
            try:
                from core.booksproc.mindmap import generate_mindmap

                result = generate_mindmap(
                    _cfg,
                    safe_lecture_id,
                    user_id=runtime_user_id,
                    on_status=push_status,
                    on_delta=push_delta,
                    stream=True,
                    cancel_event=cancel_event,
                )
                push_event("done", {
                    "success": True,
                    "mindmap": result,
                    "section_difficulty": _load_section_difficulty(safe_lecture_id),
                })
            except Exception as exc:
                log_event(
                    "mindmap_stream_error",
                    str(exc),
                    payload={"lecture_id": safe_lecture_id},
                )
                push_event("error", {"success": False, "error": str(exc)})
            finally:
                with _MINDMAP_STREAM_LOCK:
                    _ACTIVE_MINDMAP_STREAMS.discard(generation_key)
                push_event("close", {})

        try:
            thread = threading.Thread(target=run_worker, name="mindmap-generate-stream", daemon=True)
            thread.start()

            yield to_sse("status", {"message": "思维导图流式生成已启动"})

            while True:
                try:
                    event_name, event_payload = events.get(timeout=15)
                except queue.Empty:
                    elapsed_seconds = max(0, int(time.monotonic() - generation_started_at))
                    yield to_sse(
                        "ping",
                        {"message": f"模型正在准备关系图谱，已等待 {elapsed_seconds} 秒（首个响应最长 90 秒）"},
                    )
                    continue

                if event_name == "close":
                    break

                yield to_sse(event_name, event_payload)
        finally:
            cancel_event.set()

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

@bp.route("/frontend/mindmap/<lecture_id>/section", methods=["POST"])
def frontend_generate_section_mindmap(lecture_id: str):
    """同步生成指定 section 的详细思维导图子树（不持久化）。"""
    safe_lecture_id = str(lecture_id or "").strip()
    if not safe_lecture_id:
        return jsonify({"success": False, "error": "lecture_id is required"}), 400

    body = request.get_json(silent=True) or {}
    section_id = str(body.get("section_id") or "").strip()
    if not section_id:
        return jsonify({"success": False, "error": "section_id is required"}), 400

    try:
        from core.booksproc.mindmap import generate_section_mindmap

        result = generate_section_mindmap(
            _cfg,
            safe_lecture_id,
            section_id,
            stream=False,
        )
        return jsonify({"success": True, "mindmap": result})
    except Exception as exc:
        log_event(
            "section_mindmap_error",
            str(exc),
            payload={"lecture_id": safe_lecture_id, "section_id": section_id},
        )
        return jsonify({"success": False, "error": str(exc)}), 500
