"""Build the provider-specific tool schema for one model request."""

from typing import Any, Callable, Dict, List, Set


def parse_model_tools(
    *,
    model: Any,
    tools_config: List[Dict[str, Any]],
    config: Dict[str, Any],
    mail_tool_names: Set[str],
    learning_allowed_base_tool_names: Set[str],
    get_learning_tools: Callable[[], List[Dict[str, Any]]],
    canonicalize_tool_name: Callable[[str], str],
) -> List[Dict[str, Any]]:
    """Convert configured and runtime tools to the selected provider schema."""

    parsed_tools: List[Dict[str, Any]] = []
    learning_mode = str(getattr(model, "_runtime_conversation_mode", "") or "").strip().lower() == "learning"
    mode_payload = getattr(model, "_runtime_conversation_mode_payload", {})
    profile_interview = learning_mode and isinstance(mode_payload, dict) and bool(mode_payload.get("interview"))
    mail_tools_enabled, _ = model._can_inject_mail_tools()
    nexora_search_cfg = config.get("nexora_search", {}) if isinstance(config, dict) else {}
    nexora_search_enabled = bool(nexora_search_cfg.get("nexora_search_enabled", False))
    gen_image_cfg = config.get("gen_image", {}) if isinstance(config, dict) else {}
    gen_image_enabled = (
        isinstance(gen_image_cfg, dict)
        and bool(str(gen_image_cfg.get("enabled_api", "") or "").strip())
        and isinstance(gen_image_cfg.get("apis", {}), dict)
        and str(gen_image_cfg.get("enabled_api", "") or "").strip() in gen_image_cfg.get("apis", {})
    )
    provider = getattr(model, "provider", "volcengine")
    use_responses_api = model._provider_use_responses_api(provider)
    disabled_injected_tool_names = {
        "knowledge_graph_read",
        "server_render_page",
        "arxiv_search",
        "conversation_context_length",
        "conversation_context_read",
        "conversation_context_search",
        "knowledge_search_keyword",
        "knowledge_search_vector",
        "cloud_file_search_semantic",
    }

    if getattr(model, "native_search_tools", None) and not profile_interview:
        for native_tool in model.native_search_tools:
            if use_responses_api:
                parsed_tools.append(native_tool)
            elif str(native_tool.get("type", "")).strip() == "function":
                parsed_tools.append(native_tool)

    for tool in tools_config:
        if tool["type"] != "function":
            continue

        func_def = tool["function"]
        func_name = str(func_def.get("name") or "").strip()
        canonical_func_name = canonicalize_tool_name(func_name)

        if canonical_func_name in disabled_injected_tool_names:
            continue

        if profile_interview and canonical_func_name != "question":
            continue

        if learning_mode and func_name not in learning_allowed_base_tool_names:
            continue

        if canonical_func_name in mail_tool_names and not mail_tools_enabled:
            continue

        if func_def.get("name") == "server_render_page" and not nexora_search_enabled:
            continue

        if func_def.get("name") == "generate_image" and not gen_image_enabled:
            continue

        if use_responses_api:
            parsed_tools.append({
                "type": "function",
                "name": func_def["name"],
                "description": func_def["description"],
                "parameters": func_def.get("parameters", {}),
            })
        else:
            parsed_tools.append({
                "type": "function",
                "function": {
                    "name": func_def["name"],
                    "description": func_def["description"],
                    "parameters": func_def.get("parameters", {}),
                },
            })

    if learning_mode:
        for tool in get_learning_tools() or []:
            if not isinstance(tool, dict) or tool.get("type") != "function":
                continue

            func_def = tool.get("function") if isinstance(tool.get("function"), dict) else {}
            func_name = str(func_def.get("name") or "").strip()

            if not func_name:
                continue

            if profile_interview and func_name != "submit_profile_score":
                continue

            if use_responses_api:
                parsed_tools.append({
                    "type": "function",
                    "name": func_name,
                    "description": func_def.get("description", ""),
                    "parameters": func_def.get("parameters", {}),
                })
            else:
                parsed_tools.append({
                    "type": "function",
                    "function": {
                        "name": func_name,
                        "description": func_def.get("description", ""),
                        "parameters": func_def.get("parameters", {}),
                    },
                })

    return parsed_tools
