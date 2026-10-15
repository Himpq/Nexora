"""Local settings and provider-model discovery routes."""

from __future__ import annotations

import json
import logging
from ipaddress import ip_address
from urllib.parse import urlsplit

import requests
from flask import Blueprint, jsonify, request

from core.config import config
from .Provider import (
    ProviderClient,
    ProviderConfig,
    ProviderError,
    _PROVIDERS_PATH,
    load_providers,
    save_providers,
    validate_context_budget,
)
from .ProviderTemplates import (
    get_provider_template,
    list_provider_templates,
)
from .RetrySettings import (
    DEFAULT_EMPTY_RESPONSE_RETRY_COUNT,
    DEFAULT_ERROR_RETRY_COUNT,
    configured_retry_count,
    normalize_retry_count,
)


_LOGGER = logging.getLogger(__name__)
_provider_settings_bp = Blueprint("local_provider_settings", __name__)
_VALID_THEME_PREFERENCES = ("light", "dark", "system")


@_provider_settings_bp.after_request
def _provider_settings_no_store(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@_provider_settings_bp.before_request
def _check_provider_settings_origin():
    if request.method == "GET":
        return None

    origin = request.headers.get("Origin")

    if origin and origin.rstrip("/") != request.host_url.rstrip("/"):
        return jsonify({"success": False, "message": "禁止跨站访问本地 Provider 设置"}), 403

    return None


def normalize_theme_preference(value) -> str:
    """Keep the settings page's theme contract consistent across local routes."""
    text = str(value or "").strip().lower()

    return text if text in _VALID_THEME_PREFERENCES else "system"


def _provider_endpoint_matches(provider: ProviderConfig, template_id: str, base_url: str) -> bool:
    """Reuse a stored key only when the selected platform endpoint still matches."""
    if provider.template_id != template_id:
        return False

    if template_id != "custom":
        return True

    return provider.base_url.rstrip("/") == str(base_url or "").strip().rstrip("/")


@_provider_settings_bp.route("/api/local/settings", methods=["GET"])
def local_settings_get():
    """Read local settings with provider keys represented only as a presence flag."""
    providers = load_providers()
    default_id = ""

    try:
        if _PROVIDERS_PATH.is_file():
            with open(_PROVIDERS_PATH, "r", encoding="utf-8") as file:
                stored = json.load(file)

            default_id = str(stored.get("default_id") or "") if isinstance(stored, dict) else ""
    except Exception:
        default_id = ""

    return jsonify({
        "success": True,
        "provider": {
            "providers": [provider.to_public_dict() for provider in providers],
            "default_id": default_id,
        },
        "general": {
            "username": str(config.get("local_username", "local") or "local"),
            "custom_system_prompt": str(config.get("local_custom_system_prompt", "") or ""),
            "read_agents_md": bool(config.get("local_read_agents_md", True)),
            "tool_auto_expand": bool(config.get("local_tool_auto_expand", True)),
            "theme": normalize_theme_preference(config.get("local_theme", "system")),
            "auto_retry_count": configured_retry_count(
                config,
                "local_auto_retry_count",
                DEFAULT_ERROR_RETRY_COUNT,
            ),
            "empty_response_retry_count": configured_retry_count(
                config,
                "local_empty_response_retry_count",
                DEFAULT_EMPTY_RESPONSE_RETRY_COUNT,
            ),
        },
    }), 200


@_provider_settings_bp.route("/api/local/settings", methods=["POST"])
def local_settings_save():
    """Save local settings; a blank provider key keeps its current stored value."""
    body = request.get_json(silent=True) or {}
    provider_payload = body.get("provider") if isinstance(body.get("provider"), dict) else {}
    general_payload = body.get("general") if isinstance(body.get("general"), dict) else {}
    retry_settings = {
        "auto_retry_count": "local_auto_retry_count",
        "empty_response_retry_count": "local_empty_response_retry_count",
    }
    validated_retry_counts = {}

    for payload_key, config_key in retry_settings.items():
        if payload_key not in general_payload:
            continue

        try:
            validated_retry_counts[config_key] = normalize_retry_count(general_payload[payload_key])
        except ValueError as exc:
            return jsonify({"success": False, "message": str(exc)}), 400

    if (
        "tool_auto_expand" in general_payload
        and not isinstance(general_payload["tool_auto_expand"], bool)
    ):
        return jsonify({"success": False, "message": "工具调用自动展开设置必须是布尔值"}), 400

    if (
        "theme" in general_payload
        and str(general_payload.get("theme") or "").strip().lower() not in _VALID_THEME_PREFERENCES
    ):
        return jsonify({"success": False, "message": "主题设置必须是 light、dark 或 system"}), 400

    raw_providers = provider_payload.get("providers")

    if isinstance(raw_providers, list):
        current = {provider.provider_id: provider for provider in load_providers()}
        new_list = []

        for item in raw_providers:
            if not isinstance(item, dict):
                continue

            provider_id = str(item.get("id") or "").strip()
            old = current.get(provider_id)
            api_key = str(item.get("api_key") or "").strip()
            key_source_id = str(item.get("key_source_id") or "").strip()
            template_id = str(item.get("template_id") or "custom").strip() or "custom"
            template = None

            if template_id != "custom":
                template = get_provider_template(template_id)

                if template is None:
                    return jsonify({"success": False, "message": "Provider 模板无效，请重新选择"}), 400

            if template is not None:
                name = template["name"]
                base_url = template["base_url"]
            else:
                name = str(item.get("name") or "").strip()
                base_url = str(item.get("base_url") or "").strip()

            if not api_key and old is not None and _provider_endpoint_matches(old, template_id, base_url):
                api_key = old.api_key

            if not api_key and key_source_id:
                key_source = current.get(key_source_id)

                if (
                    key_source is not None
                    and _provider_endpoint_matches(key_source, template_id, base_url)
                ):
                    api_key = key_source.api_key

            model = str(item.get("model") or "").strip()

            if template is not None:
                if not api_key:
                    return jsonify({"success": False, "message": "请填写当前 Provider 对应的 API Key"}), 400

                if not model:
                    return jsonify({"success": False, "message": "请填写模型名称"}), 400

            try:
                temperature = float(item.get("temperature", 0.7))
            except (TypeError, ValueError):
                temperature = 0.7

            try:
                max_tokens = int(item.get("max_tokens", 4096))
            except (TypeError, ValueError):
                max_tokens = 4096

            try:
                context_window = int(item.get("context_window", 128000))
            except (TypeError, ValueError):
                context_window = 128000

            new_list.append(ProviderConfig(
                provider_id=provider_id or "",
                name=name,
                base_url=base_url,
                api_key=api_key,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                context_window=context_window,
                thinking_protocol=item.get("thinking_protocol", "none"),
                template_id=template_id,
            ))

        default_id = str(provider_payload.get("default_id") or "").strip()

        try:
            validate_context_budget(new_list)
        except ValueError as exc:
            return jsonify({"success": False, "message": str(exc)}), 400

        save_providers(new_list, default_id)

    if "username" in general_payload and str(general_payload.get("username") or "").strip():
        config.set("local_username", str(general_payload.get("username") or "").strip())

    if "custom_system_prompt" in general_payload:
        config.set("local_custom_system_prompt", str(general_payload.get("custom_system_prompt") or "")[:8000])

    if "read_agents_md" in general_payload:
        config.set("local_read_agents_md", bool(general_payload.get("read_agents_md")))

    if "tool_auto_expand" in general_payload:
        config.set("local_tool_auto_expand", general_payload["tool_auto_expand"])

    if "theme" in general_payload:
        config.set("local_theme", normalize_theme_preference(general_payload.get("theme")))

    for config_key, retry_count in validated_retry_counts.items():
        config.set(config_key, retry_count)

    return jsonify({"success": True, "message": "设置已保存"})


def _custom_models_url(base_url: str) -> str:
    """Derive /models from the same Chat Completions URL used by ProviderClient."""
    provider = ProviderConfig(base_url=base_url, model="model-discovery")
    completions_url = ProviderClient(provider)._completions_url()
    endpoint = "/chat/completions"

    if not completions_url.endswith(endpoint):
        raise ProviderError("Provider Chat Completions URL is invalid")

    return completions_url[:-len(endpoint)] + "/models"


def _is_loopback_host(hostname: str) -> bool:
    """Allow plain HTTP model discovery only for explicitly local custom providers."""
    if hostname == "localhost":
        return True

    try:
        return ip_address(hostname).is_loopback
    except ValueError:
        return False


def _model_rows(
    payload: object,
    parser: str,
    allowed_model_ids: tuple[str, ...] | None = None,
) -> list[dict]:
    """Normalize supported provider responses to safe model ID and display-name rows."""
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise ValueError("平台返回的模型列表格式不受支持")

    if parser == "opencode_chat" and allowed_model_ids is None:
        raise ValueError("OpenCode 模型列表缺少 Chat Completions 白名单")

    allowed_ids = set(allowed_model_ids or ())
    rows = []
    seen_ids = set()

    for item in payload["data"]:
        if not isinstance(item, dict):
            continue

        model_id = str(item.get("id") or "").strip()

        if not model_id or model_id in seen_ids:
            continue

        if parser == "opencode_chat" and model_id not in allowed_ids:
            continue

        if parser == "openrouter":
            architecture = item.get("architecture")

            if not isinstance(architecture, dict):
                raise ValueError("OpenRouter 模型列表缺少 architecture 字段")

            input_modalities = architecture.get("input_modalities")
            output_modalities = architecture.get("output_modalities")

            if not isinstance(input_modalities, list) or not isinstance(output_modalities, list):
                raise ValueError("OpenRouter 模型列表缺少模态信息")

            if "text" not in input_modalities or "text" not in output_modalities:
                continue

        elif parser not in ("openai", "opencode_chat"):
            raise ValueError("Provider 的模型列表解析器未配置")

        name = str(item.get("name") or model_id).strip() or model_id
        rows.append({"id": model_id, "name": name})
        seen_ids.add(model_id)

    rows.sort(key=lambda row: (row["name"].casefold(), row["id"].casefold()))

    return rows


def _resolve_api_key(body: dict) -> str:
    """Resolve a saved key without crossing from its configured endpoint to another."""
    api_key = str(body.get("api_key") or "").strip()

    if api_key:
        return api_key

    provider_id = str(body.get("provider_id") or "").strip()
    key_source_id = str(body.get("key_source_id") or "").strip()
    source_id = key_source_id or provider_id
    template_id = str(body.get("template_id") or "custom").strip() or "custom"

    if template_id == "custom":
        base_url = str(body.get("base_url") or "").strip()
    else:
        template = get_provider_template(template_id)

        if template is None:
            return ""

        base_url = template["base_url"]

    if not source_id:
        return ""

    provider = next(
        (item for item in load_providers() if item.provider_id == source_id),
        None,
    )

    if provider is None or not _provider_endpoint_matches(provider, template_id, base_url):
        return ""

    return provider.api_key


@_provider_settings_bp.route("/api/local/provider-templates", methods=["GET"])
def provider_templates_get():
    return jsonify({"success": True, "templates": list_provider_templates()})


@_provider_settings_bp.route("/api/local/provider-models", methods=["POST"])
def provider_models_get():
    """Fetch models from the selected platform's fixed HTTPS catalog endpoint."""
    body = request.get_json(silent=True)

    if not isinstance(body, dict):
        return jsonify({"success": False, "message": "模型列表请求内容无效"}), 400

    template_id = str(body.get("template_id") or "custom").strip() or "custom"
    allowed_model_ids = None

    if template_id == "custom":
        try:
            models_url = _custom_models_url(str(body.get("base_url") or "").strip())
        except (ProviderError, ValueError) as exc:
            return jsonify({"success": False, "message": str(exc)}), 400

        parser = "openai"
    else:
        template = get_provider_template(template_id)

        if template is None:
            return jsonify({"success": False, "message": "Provider 模板无效，请重新选择"}), 400

        models_url = template["model_list_url"]

        if not models_url:
            message = template.get(
                "model_list_hint",
                "该平台未提供可用的模型列表接口，请手动填写 Model ID。",
            )
            return jsonify({"success": False, "message": message}), 400

        parser = template["model_list_parser"]
        allowed_model_ids = template.get("model_list_model_ids")

    api_key = _resolve_api_key(body)

    if template_id != "custom" and not api_key:
        return jsonify({
            "success": False,
            "message": "请填写当前 Provider 对应的 API Key；切换平台后不能沿用其他平台的 Key",
        }), 400

    parsed_url = urlsplit(models_url)
    allows_loopback_http = (
        template_id == "custom"
        and parsed_url.scheme == "http"
        and parsed_url.hostname is not None
        and _is_loopback_host(parsed_url.hostname)
    )

    if (
        (parsed_url.scheme != "https" and not allows_loopback_http)
        or not parsed_url.hostname
        or parsed_url.username is not None
        or parsed_url.password is not None
        or (
            parsed_url.query
            and not (template_id == "siliconflow" and parsed_url.query == "sub_type=chat")
        )
        or parsed_url.fragment
    ):
        return jsonify({"success": False, "message": "模型列表地址配置无效"}), 500

    try:
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        response = requests.get(
            models_url,
            headers=headers,
            timeout=(5, 20),
            allow_redirects=False,
        )
    except requests.RequestException as exc:
        _LOGGER.warning(
            "[LocalProvider] model_list_request_failed provider=%s error=%s",
            template_id,
            type(exc).__name__,
        )
        return jsonify({"success": False, "message": "无法连接平台模型列表，请检查网络或平台状态"}), 502

    if 300 <= response.status_code < 400:
        return jsonify({"success": False, "message": "平台模型列表接口返回重定向，已停止请求"}), 502

    if response.status_code in (401, 403):
        return jsonify({"success": False, "message": "API Key 无效，或没有读取模型列表的权限"}), 401

    if response.status_code == 404:
        return jsonify({"success": False, "message": "平台模型列表接口不存在，请手动填写 Model ID"}), 404

    if response.status_code == 429:
        return jsonify({"success": False, "message": "平台模型列表请求过于频繁，请稍后再试"}), 429

    if response.status_code != 200:
        return jsonify({"success": False, "message": f"平台模型列表请求失败（HTTP {response.status_code}）"}), 502

    try:
        models = _model_rows(response.json(), parser, allowed_model_ids)
    except ValueError:
        return jsonify({"success": False, "message": "平台返回的模型列表格式不受支持"}), 502

    if not models:
        return jsonify({"success": False, "message": "平台没有返回可用于 Chat Completions 的模型"}), 404

    return jsonify({"success": True, "models": models})


def register_provider_settings_routes(app) -> None:
    app.register_blueprint(_provider_settings_bp)
