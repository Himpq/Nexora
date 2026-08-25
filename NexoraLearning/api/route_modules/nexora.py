"""Nexora proxy and model routes."""

from api import routes as _routes

# The first split keeps common helpers in api.routes while route handlers move by domain.
_routes._export_route_context(globals())


@bp.route("/nexora/models", methods=["GET"])
@bp.route("/nexora/model_list", methods=["GET"])
def list_nexora_models():
    if _proxy is None:
        return jsonify({"success": False, "error": "Nexora proxy not initialized."}), 503

    username = str(request.args.get("username") or "").strip() or None
    result = _proxy.list_models(username=username)
    status_code = 200 if result.get("success") else 502
    return jsonify(result), status_code

@bp.route("/nexora/papi/completions", methods=["POST"])
@bp.route("/nexora/papi/chat/completions", methods=["POST"])
def nexora_papi_completions():
    if _proxy is None:
        return jsonify({"success": False, "error": "Nexora proxy not initialized."}), 503

    data = request.get_json(silent=True) or {}
    messages = data.get("messages")
    if not isinstance(messages, list) or not messages:
        return jsonify({"success": False, "error": "messages is required."}), 400

    result = _proxy.chat_completions(
        messages=list(messages),
        model=str(data.get("model") or "").strip() or None,
        username=str(data.get("username") or "").strip() or None,
        options=_extract_nexora_options(data),
    )
    if not result.get("ok"):
        return jsonify({"success": False, "error": result.get("message") or "Nexora upstream failed."}), int(result.get("status") or 502)

    payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
    return jsonify(
        {
            "success": True,
            "api_mode": "chat",
            "endpoint": result.get("endpoint"),
            "content": _proxy.extract_output_text(payload),
            "raw": payload,
        }
    )

@bp.route("/nexora/papi/responses", methods=["POST"])
def nexora_papi_responses():
    if _proxy is None:
        return jsonify({"success": False, "error": "Nexora proxy not initialized."}), 503

    data = request.get_json(silent=True) or {}
    input_items = data.get("input")
    if not isinstance(input_items, list) or not input_items:
        return jsonify({"success": False, "error": "input is required for responses mode."}), 400

    result = _proxy.responses(
        model=str(data.get("model") or "").strip() or None,
        username=str(data.get("username") or "").strip() or None,
        input_items=list(input_items),
        instructions=str(data.get("instructions") or "").strip(),
        options=_extract_nexora_options(data),
    )
    if not result.get("ok"):
        return jsonify({"success": False, "error": result.get("message") or "Nexora upstream failed."}), int(result.get("status") or 502)

    payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
    return jsonify(
        {
            "success": True,
            "api_mode": "responses",
            "endpoint": result.get("endpoint"),
            "content": _proxy.extract_output_text(payload),
            "raw": payload,
        }
    )

@bp.route("/completions", methods=["POST"])
def completions():
    if _proxy is None:
        return jsonify({"success": False, "error": "Nexora proxy not initialized."}), 503

    data = request.get_json(silent=True) or {}
    model_type = str(data.get("model_type") or "").strip()
    system_prompt = str(data.get("system_prompt") or "").strip()
    prompt = str(data.get("prompt") or data.get("message") or "").strip()
    model = str(data.get("model") or "").strip() or None
    username = str(data.get("username") or "").strip() or None
    api_mode = str(data.get("api_mode") or data.get("backend_mode") or "chat").strip().lower()
    instructions = str(data.get("instructions") or "").strip()
    context_payload = data.get("context_payload") or {}
    extra_prompt_vars = data.get("extra_prompt_vars") or {}
    raw_messages = data.get("messages")
    raw_input_items = data.get("input")
    messages = raw_messages if isinstance(raw_messages, list) else None
    input_items = raw_input_items if isinstance(raw_input_items, list) else None

    request_options = _extract_nexora_options(data)

    if api_mode not in {"chat", "responses", "auto"}:
        return jsonify({"success": False, "error": "api_mode must be one of: chat, responses, auto."}), 400

    if not prompt and not messages and not input_items and not model_type:
        return jsonify({"success": False, "error": "prompt/messages/input is required."}), 400

    try:
        if model_type:
            if not prompt:
                return jsonify({"success": False, "error": "prompt is required for model_type."}), 400
            runner = LearningModelFactory.create(model_type, _cfg, model_name=model)
            safe_context_payload = context_payload if isinstance(context_payload, dict) else {}
            safe_extra_prompt_vars = extra_prompt_vars if isinstance(extra_prompt_vars, dict) else {}
            log_event(
                "model_context_input",
                "模型上下文输入（model_type）",
                payload={
                    "model_type": model_type,
                    "model": model or "",
                    "username": username or "",
                },
                content=json.dumps(
                    {
                        "prompt": prompt,
                        "context_payload": safe_context_payload,
                        "extra_prompt_vars": safe_extra_prompt_vars,
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
            )
            content = runner.run(
                prompt,
                context_payload=safe_context_payload,
                extra_prompt_vars=safe_extra_prompt_vars,
                username=username,
            )
            log_event(
                "model_output",
                "模型输出（model_type）",
                payload={
                    "model_type": model_type,
                    "model": model or "",
                    "username": username or "",
                },
                content=content[:12000],
            )
            preview = runner.preview_prompts(
                prompt,
                context_payload=safe_context_payload,
                extra_prompt_vars=safe_extra_prompt_vars,
            )
            return jsonify({
                "success": True,
                "content": content,
                "model": model,
                "model_type": model_type,
                "username": username,
                "resolved_prompts": preview,
            })

        if messages or input_items:
            log_event(
                "model_context_input",
                "模型上下文输入（raw messages/input）",
                payload={
                    "model_type": "",
                    "model": model or "",
                    "username": username or "",
                    "api_mode": api_mode,
                },
                content=json.dumps(
                    {"messages": messages or [], "input": input_items or [], "instructions": instructions},
                    ensure_ascii=False,
                    indent=2,
                )[:12000],
            )
            result = _proxy.complete_raw(
                messages=list(messages or []),
                model=model,
                username=username,
                api_mode=api_mode,
                input_items=list(input_items or []),
                instructions=instructions or system_prompt,
                options=request_options,
            )
            if not result.get("success"):
                return jsonify(
                    {
                        "success": False,
                        "error": result.get("message") or "Nexora upstream failed.",
                        "api_mode": api_mode,
                        "model": model,
                        "username": username,
                    }
                ), 502
            log_event(
                "model_output",
                "模型输出（raw messages/input）",
                payload={
                    "model": model or "",
                    "username": username or "",
                    "api_mode": result.get("api_mode") or api_mode,
                },
                content=str(result.get("content") or "")[:12000],
            )
            return jsonify(
                {
                    "success": True,
                    "content": str(result.get("content") or ""),
                    "model": model,
                    "model_type": None,
                    "username": username,
                    "api_mode": result.get("api_mode"),
                    "endpoint": result.get("endpoint"),
                    "raw": result.get("payload"),
                }
            )

        log_event(
            "model_context_input",
            "模型上下文输入（chat prompt）",
            payload={
                "model_type": model_type or "",
                "model": model or "",
                "username": username or "",
                "api_mode": "chat",
            },
            content=json.dumps({"system_prompt": system_prompt, "prompt": prompt}, ensure_ascii=False, indent=2)[:12000],
        )
        content = _proxy.chat_complete(system_prompt=system_prompt, user_prompt=prompt, model=model, username=username)
        log_event(
            "model_output",
            "模型输出（chat prompt）",
            payload={"model": model or "", "username": username or "", "api_mode": "chat"},
            content=content[:12000],
        )
        return jsonify({
            "success": True,
            "content": content,
            "model": model,
            "model_type": model_type or None,
            "username": username,
            "api_mode": "chat",
        })
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500

@bp.route("/models/rough-reading", methods=["GET"])
def get_rough_reading_model_settings():
    settings = get_rough_reading_settings(_cfg)
    return jsonify({"success": True, "model_type": "coarse_reading", "settings": settings})

@bp.route("/models/rough-reading", methods=["PATCH"])
def patch_rough_reading_model_settings():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"success": False, "error": "JSON body is required."}), 400
    settings = update_rough_reading_settings(_cfg, data)
    return jsonify({"success": True, "model_type": "coarse_reading", "settings": settings})
