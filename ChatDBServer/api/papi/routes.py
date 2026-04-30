import importlib
import sys
from typing import Any, Dict
from flask import Blueprint, request, jsonify

papi_bp = Blueprint('papi', __name__)

from .core import (
    require_papi_key,
    _papi_pick_model,
    _papi_normalize_messages,
    _papi_stringify_instruction_content,
    _papi_extract_instruction_messages,
    _papi_extract_instructions_from_input_items,
    _papi_prepare_chat_messages,
    _papi_normalize_tool_spec,
    _papi_normalize_tool_choice,
    _papi_normalize_responses_input_payload,
    _papi_has_function_call_outputs,
    _papi_build_synthetic_messages_from_function_outputs,
    _papi_build_openai_payload,
    _papi_stream_openai_chat,
    _papi_stream_openai_responses,
    _papi_create_openai_responses_payload,
    _papi_log,
)
from api.database import User
from api.conversation_manager import ConversationManager
from api.server_quota import get_generation_quota_gate
from provider_factory import create_provider_adapter


def _resolve_server_module():
    for module_name in ('__main__', 'server'):
        module = sys.modules.get(module_name)
        if module is not None and hasattr(module, 'get_config_all'):
            return module
    return importlib.import_module('server')


def _server_attr(name: str):
    module = _resolve_server_module()
    return getattr(module, name)


def get_config_all():
    return _server_attr('get_config_all')()


def _is_model_disabled_entry(model_info):
    return _server_attr('_is_model_disabled_entry')(model_info)


def _as_bool(value, default=False):
    return _server_attr('_as_bool')(value, default)


def get_chroma_store():
    return _server_attr('get_chroma_store')()


def _build_over_budget_unavailable_response(extra_payload):
    return _server_attr('_build_over_budget_unavailable_response')(extra_payload)


def _build_quota_block_message(quota_gate, model_name):
    return _server_attr('_build_quota_block_message')(quota_gate, model_name)


def _is_rate_limit_exception(exc: Exception) -> bool:
    return bool(_server_attr('_is_rate_limit_exception')(exc))


def _disable_model_by_quota(model_id, provider_name=None, reason='quota_exhausted'):
    return _server_attr('_disable_model_by_quota')(model_id, provider_name=provider_name, reason=reason)


def _get_client_cache() -> Dict[str, Any]:
    cache = _server_attr('_CLIENT_CACHE')
    if isinstance(cache, dict):
        return cache
    return {}


def load_users_meta() -> Dict[str, Any]:
    return _server_attr('load_users')()



@papi_bp.route('/api/papi/knowledge/list/<username>', methods=['GET'])
@require_papi_key
def papi_list_knowledge(username):
    """获取指定用户的知识库列表"""
    try:
        user = User(username)
        basis = user.getKnowledgeList(1)
        return jsonify({
            'success': True,
            'username': username,
            'knowledge': list(basis.keys())
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@papi_bp.route('/api/papi/user/info/<username>', methods=['GET'])
@require_papi_key
def papi_user_info(username):
    """PAPI: lightweight user profile/meta query"""
    try:
        users_meta = load_users_meta()
        row = users_meta.get(username, {}) if isinstance(users_meta, dict) else {}
        if not isinstance(row, dict) or not row:
            return jsonify({'success': False, 'message': f'user not found: {username}'}), 404
        return jsonify({
            'success': True,
            'user': {
                'id': username,
                'username': str(row.get('username') or username),
                'role': str(row.get('role') or 'member'),
                'avatar_url': str(row.get('avatar_url') or ''),
                'created_at': row.get('created_at', ''),
                'last_login': row.get('last_login', ''),
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@papi_bp.route('/api/papi/knowledge/basis/<username>/<path:title>', methods=['GET'])
@require_papi_key
def papi_get_knowledge(username, title):
    """获取指定用户的某个知识内容"""
    try:
        user = User(username)
        content = user.getBasisContent(title)
        meta = user.getBasisMetadata(title)
        return jsonify({
            'success': True,
            'username': username,
            'title': title,
            'content': content,
            'metadata': meta
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@papi_bp.route('/api/papi/tokens/stats/<username>', methods=['GET'])
@require_papi_key
def papi_token_stats(username):
    """获取指定用户的 Token 消耗记录"""
    try:
        user = User(username)
        logs = user.get_token_logs()
        total_tokens = sum(log.get('total_tokens', 0) for log in logs)
        return jsonify({
            'success': True,
            'username': username,
            'total': total_tokens,
            'logs': logs
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@papi_bp.route('/api/papi/conversations/<username>', methods=['GET'])
@require_papi_key
def papi_list_conversations(username):
    """获取指定用户的对话列表"""
    try:
        manager = ConversationManager(username)
        conversations = manager.list_conversations()
        return jsonify({
            'success': True,
            'username': username,
            'conversations': conversations
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@papi_bp.route('/api/papi/conversations/<username>/<conv_id>', methods=['GET'])
@require_papi_key
def papi_get_conversation(username, conv_id):
    """获取指定用户的详细对话记录"""
    try:
        manager = ConversationManager(username)
        conversation = manager.get_conversation(conv_id)
        return jsonify({
            'success': True,
            'username': username,
            'conversation': conversation
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@papi_bp.route('/api/papi/knowledge/query/<username>', methods=['POST'])
@require_papi_key
def papi_query_vectors(username):
    """PAPI: vector query"""
    data = request.get_json() or {}
    query_text = data.get('text') or data.get('query')
    top_k = int(data.get('top_k') or 5)

    if not query_text:
        return jsonify({'success': False, 'message': 'missing query text'})

    store, store_err = get_chroma_store()
    if not store:
        return jsonify({'success': False, 'message': f'ChromaDB unavailable: {store_err}'})

    try:
        if getattr(store, 'mode', '') != 'service':
            return jsonify({'success': False, 'message': 'NexoraDB service mode required'})
        result = store.query_text(username, query_text, top_k=top_k)
        return jsonify({'success': True, 'result': result})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@papi_bp.route('/api/papi/completions', methods=['POST'])
@papi_bp.route('/api/papi/chat/completions', methods=['POST'])
@papi_bp.route('/api/papi/responses', methods=['POST'])
@papi_bp.route('/api/papi/v1/completions', methods=['POST'])
@papi_bp.route('/api/papi/v1/chat/completions', methods=['POST'])
@papi_bp.route('/api/papi/v1/responses', methods=['POST'])
@papi_bp.route('/api/papi/completions/<username>', methods=['POST'])
@papi_bp.route('/api/papi/chat/completions/<username>', methods=['POST'])
@papi_bp.route('/api/papi/responses/<username>', methods=['POST'])
@papi_bp.route('/api/papi/v1/completions/<username>', methods=['POST'])
@papi_bp.route('/api/papi/v1/chat/completions/<username>', methods=['POST'])
@papi_bp.route('/api/papi/v1/responses/<username>', methods=['POST'])
@require_papi_key
def papi_completions(username=None):
    """PAPI: OpenAI 兼容的 chat/completions 接口，支持流式与非流式。"""
    data = request.get_json(silent=True) or {}
    config = get_config_all()
    request_username = str(username or data.get('username') or '').strip()
    request_path = str(request.path or '').strip().lower()
    use_responses_compat = ('/responses' in request_path)
    previous_response_id = str(
        data.get('previous_response_id')
        or data.get('parent_response_id')
        or data.get('response_id')
        or data.get('parent_id')
        or ''
    ).strip() or None
    allow_synthetic_fallback = _as_bool(data.get('allow_synthetic_fallback', True), True)
    raw_input_items = data.get('input') if isinstance(data.get('input'), list) else None
    responses_input_items = _papi_normalize_responses_input_payload(raw_input_items) if (use_responses_compat and isinstance(raw_input_items, list)) else None
    has_function_outputs = _papi_has_function_call_outputs(responses_input_items)
    if use_responses_compat:
        _papi_log(
            f"[PAPI_RESP_IN] prev={'yes' if previous_response_id else 'no'} "
            f"input_items={len(responses_input_items or [])} "
            f"has_function_outputs={'yes' if has_function_outputs else 'no'}"
        )
    if use_responses_compat and has_function_outputs and not previous_response_id:
        if allow_synthetic_fallback:
            _papi_log("[PAPI_RESP_IN] missing previous_response_id while function_call_output exists; will force chat_bridge")
        else:
            _papi_log("[PAPI_RESP_IN] missing previous_response_id while function_call_output exists; strict compatibility mode")

    requested_model = str(data.get('model') or '').strip()
    raw_models_cfg = config.get('models', {}) if isinstance(config.get('models', {}), dict) else {}
    if requested_model and requested_model not in raw_models_cfg:
        return jsonify({
            'success': False,
            'message': f'模型不存在：{requested_model}',
            'model': requested_model,
            'username': request_username or username,
        }), 400

    if requested_model and requested_model in raw_models_cfg and _is_model_disabled_entry(raw_models_cfg.get(requested_model, {})):
        return jsonify({
            'success': False,
            'message': f'模型已停用：{requested_model}',
            'model': requested_model,
            'username': request_username or username,
        }), 403

    model_name, _model_info, provider_name, provider_info = _papi_pick_model(config, requested_model)
    if not model_name:
        return jsonify({'success': False, 'message': '没有可用模型'}), 400

    if _is_model_disabled_entry(_model_info):
        return jsonify({
            'success': False,
            'message': f'模型已停用：{model_name}',
            'model': model_name,
            'provider': provider_name,
            'username': request_username or username,
        }), 403

    messages = _papi_normalize_messages(data)
    responses_instructions = ''
    if use_responses_compat:
        responses_instructions = _papi_stringify_instruction_content(data.get('instructions'))
        if isinstance(responses_input_items, list) and responses_input_items:
            responses_instructions, responses_input_items = _papi_extract_instructions_from_input_items(
                responses_input_items,
                seed_instructions=responses_instructions,
            )
        else:
            responses_instructions, messages = _papi_extract_instruction_messages(
                messages,
                seed_instructions=responses_instructions,
            )
    else:
        messages = _papi_prepare_chat_messages(messages)

    if not messages and not responses_input_items:
        return jsonify({'success': False, 'message': 'messages 或 prompt 不能为空'}), 400

    if (not responses_input_items) and (not any(item.get('role') == 'user' for item in messages)):
        return jsonify({'success': False, 'message': '缺少 user 消息'}), 400

    want_stream = _as_bool(data.get('stream', False), False)

    quota_gate = get_generation_quota_gate(provider_name=provider_name, model_name=model_name)
    if quota_gate.get('should_disable_model'):
        _disable_model_by_quota(model_name, provider_name=provider_name, reason='quota_exhausted')

    quota_status = quota_gate.get('quota', {}) if isinstance(quota_gate.get('quota'), dict) else {}
    if quota_gate.get('should_block'):
        return _build_over_budget_unavailable_response({
            'message': _build_quota_block_message(quota_gate, model_name),
            'model': model_name,
            'provider': provider_name,
            'username': request_username or username,
            'quota': quota_status,
        })

    def _coerce_float(value, default=None):
        if value is None or value == '':
            return default
        try:
            return float(value)
        except Exception:
            return default

    def _coerce_int(value, default=None):
        if value is None or value == '':
            return default
        try:
            return int(float(value))
        except Exception:
            return default

    temperature = _coerce_float(data.get('temperature'), 0.3)
    top_p = _coerce_float(data.get('top_p'), None)
    max_tokens = _coerce_int(data.get('max_tokens', data.get('max_completion_tokens', None)), None)

    request_kwargs: Dict[str, Any] = {}
    for key, value in (
        ('temperature', temperature),
        ('top_p', top_p),
        ('max_tokens', max_tokens),
        ('stop', data.get('stop')),
        ('presence_penalty', _coerce_float(data.get('presence_penalty'), None)),
        ('frequency_penalty', _coerce_float(data.get('frequency_penalty'), None)),
        ('seed', _coerce_int(data.get('seed'), None)),
    ):
        if value is not None:
            request_kwargs[key] = value

    # 透传 tools / tool_choice / response_format / stream_options
    for _k in ('tools', 'tool_choice', 'response_format', 'stream_options'):
        val = data.get(_k)
        if val is not None:
            if _k == 'tools':
                if not isinstance(val, list):
                    continue
                normalized_tools = []
                for t in val:
                    normalized_tool = _papi_normalize_tool_spec(t, use_responses_api=use_responses_compat)
                    if normalized_tool is not None:
                        normalized_tools.append(normalized_tool)
                if not normalized_tools:
                    continue
                request_kwargs[_k] = normalized_tools
                continue
            if _k == 'tool_choice':
                request_kwargs[_k] = _papi_normalize_tool_choice(val, use_responses_api=use_responses_compat)
                continue
            if _k == 'tools':
                if not isinstance(val, list):
                    continue
                valid_tools = []
                for t in val:
                    # 必须包含明确的 function 定义才被认为是合法的 tool
                    if isinstance(t, dict) and 'function' in t and isinstance(t['function'], dict):
                        valid_tools.append(t)
                if not valid_tools:
                    continue
                request_kwargs[_k] = valid_tools
                continue
            request_kwargs[_k] = val

    _tools_payload = request_kwargs.get('tools') if isinstance(request_kwargs.get('tools'), list) else []
    _tool_names: List[str] = []
    for _tool in _tools_payload:
        if not isinstance(_tool, dict):
            continue
        if isinstance(_tool.get('function'), dict):
            _name = str((_tool.get('function') or {}).get('name') or '').strip()
        else:
            _name = str(_tool.get('name') or '').strip()
        if _name:
            _tool_names.append(_name)
    _papi_log(
        f"[PAPI_TOOLS] model={model_name} use_responses_compat={'yes' if use_responses_compat else 'no'} "
        f"tool_count={len(_tools_payload)} tool_names={_tool_names}"
    )

    if use_responses_compat and responses_instructions:
        request_kwargs['instructions'] = responses_instructions

    if use_responses_compat:
        for _k in ('parallel_tool_calls', 'metadata', 'text', 'reasoning', 'store', 'include', 'truncation', 'max_output_tokens'):
            val = data.get(_k)
            if val is not None:
                request_kwargs[_k] = val

    api_key = str(provider_info.get('api_key') or '').strip()
    base_url = provider_info.get('base_url') or provider_info.get('api_base')
    adapter = create_provider_adapter(provider_name, provider_info)
    adapter_api_type = str(getattr(adapter, 'api_type', '') or '').strip().lower()
    use_responses_upstream = bool(adapter.use_responses_api(request_kwargs)) if use_responses_compat else False

    bridge_reason_parts = []
    if use_responses_compat and use_responses_upstream:
        # Critical safety fallback: when function_call_output exists but there is no
        # previous_response_id, upstream responses APIs are frequently unstable.
        if (not previous_response_id) and has_function_outputs:
            bridge_reason_parts.append('missing_prev_with_function_outputs')

        # Colon-style model ids are usually local OpenAI-compatible models (e.g. ollama).
        # Force bridge to avoid routing these through native responses endpoints.
        if ':' in str(model_name or ''):
            bridge_reason_parts.append('colon_model_id')

        # OpenAI-compatible/Ollama adapters should default to chat bridge here.
        if adapter_api_type in {'openai', 'openai_compatible', 'ollama'}:
            bridge_reason_parts.append(f'api_type={adapter_api_type}')

        if _as_bool(data.get('force_chat_bridge', False), False):
            bridge_reason_parts.append('force_chat_bridge=1')

    if bridge_reason_parts:
        use_responses_upstream = False

    if use_responses_compat and (not use_responses_upstream) and (not bridge_reason_parts):
        # Keep explicit reason for non-upstream path to ease production debugging.
        if adapter_api_type:
            bridge_reason_parts.append(f'api_type={adapter_api_type}')
        if ':' in str(model_name or ''):
            bridge_reason_parts.append('colon_model_id')
        if not bridge_reason_parts:
            bridge_reason_parts.append('adapter_policy')

    if use_responses_compat:
        if use_responses_upstream:
            _papi_log(
                f"[PAPI_RESP_MODE] model={model_name} provider={provider_name} api_type={adapter_api_type or 'unknown'} mode=responses_upstream"
            )
        else:
            reason_text = ','.join(bridge_reason_parts) if bridge_reason_parts else 'adapter_policy'
            _papi_log(
                f"[PAPI_RESP_MODE] model={model_name} provider={provider_name} api_type={adapter_api_type or 'unknown'} mode=chat_bridge reason={reason_text}"
            )

    client_cache = _get_client_cache()
    cache_key = adapter.client_cache_key(api_key, scope='papi')
    if cache_key in client_cache:
        client = client_cache[cache_key]
    else:
        client = adapter.create_client(api_key=api_key, base_url=base_url, timeout=60.0)
        client_cache[cache_key] = client

    # ---- 流式响应 ----
    if want_stream:
        try:
            if use_responses_compat:
                resp = _papi_stream_openai_responses(
                    adapter=adapter,
                    client=client,
                    model_name=model_name,
                    messages=messages,
                    request_kwargs=request_kwargs,
                    previous_response_id=previous_response_id,
                    input_items=responses_input_items,
                    allow_synthetic_fallback=allow_synthetic_fallback,
                    use_responses_upstream=use_responses_upstream,
                )
            else:
                resp = _papi_stream_openai_chat(
                    adapter=adapter,
                    client=client,
                    model_name=model_name,
                    messages=messages,
                    request_kwargs=request_kwargs,
                )
            resp.headers['Cache-Control'] = 'no-cache, no-transform'
            resp.headers['X-Accel-Buffering'] = 'no'
            resp.headers['Connection'] = 'keep-alive'
            return resp
        except Exception as e:
            _papi_log(f"[PAPI_COMPLETIONS_STREAM] model={model_name} provider={provider_name} error={e}", level='error')
            is_rate_limit_error = _is_rate_limit_exception(e)
            status_code = 429 if is_rate_limit_error else 502
            message_text = str(e or '').strip()
            if is_rate_limit_error and not message_text:
                message_text = '请求触发模型限流或额度不足。'
            return jsonify({
                'success': False,
                'message': message_text,
                'error_type': 'rate_limit' if is_rate_limit_error else 'provider_error',
                'model': model_name,
                'provider': provider_name,
                'username': request_username or (username or ''),
            }), status_code

    # ---- 非流式响应 ----
    try:
        if use_responses_compat:
            payload = _papi_create_openai_responses_payload(
                adapter=adapter,
                client=client,
                model_name=model_name,
                messages=messages,
                request_kwargs=request_kwargs,
                provider_name=provider_name,
                request_username=request_username or (username or ''),
                quota_status=quota_status,
                previous_response_id=previous_response_id,
                input_items=responses_input_items,
                allow_synthetic_fallback=allow_synthetic_fallback,
                use_responses_upstream=use_responses_upstream,
            )
        else:
            response = adapter.create_chat_completion(
                client=client,
                model=model_name,
                messages=messages,
                stream=False,
                **request_kwargs
            )
            payload = _papi_build_openai_payload(
                response_obj=response,
                model_name=model_name,
                provider_name=provider_name,
                request_username=request_username or (username or ''),
                quota_status=quota_status,
            )
        return jsonify(payload)
    except Exception as e:
        _papi_log(f"[PAPI_COMPLETIONS] model={model_name} provider={provider_name} error={e}", level='error')
        is_rate_limit_error = _is_rate_limit_exception(e)
        status_code = 429 if is_rate_limit_error else 502
        message_text = str(e or '').strip()
        if is_rate_limit_error and not message_text:
            message_text = '请求触发模型限流或额度不足。'
        return jsonify({
            'success': False,
            'message': message_text,
            'error_type': 'rate_limit' if is_rate_limit_error else 'provider_error',
            'model': model_name,
            'provider': provider_name,
            'username': request_username or (username or ''),
        }), status_code

# ==================== PAPI - 模型列表 ====================

@papi_bp.route('/api/papi/models', methods=['GET'])
@papi_bp.route('/api/papi/model_list', methods=['GET'])
@papi_bp.route('/api/papi/v1/models', methods=['GET'])
@require_papi_key
def papi_list_models():
    """PAPI: 返回已配置的可用模型列表（OpenAI /v1/models 格式）。"""
    config = get_config_all()
    models_cfg = config.get('models', {}) if isinstance(config.get('models', {}), dict) else {}
    data_list = []
    for name, info in models_cfg.items():
        if _is_model_disabled_entry(info if isinstance(info, dict) else {}):
            continue
        provider = str((info or {}).get('provider', 'custom') if isinstance(info, dict) else 'custom')
        data_list.append({
            'id': name,
            'object': 'model',
            'created': 0,
            'owned_by': provider,
        })
    return jsonify({'object': 'list', 'data': data_list})


@papi_bp.route('/api/papi/v1', methods=['GET'])
@require_papi_key
def papi_v1_root():
    return jsonify({
        'object': 'api_root',
        'service': 'nexora-papi',
        'version': 'v1',
        'endpoints': {
            'models': '/api/papi/v1/models',
            'chat_completions': '/api/papi/v1/chat/completions',
            'responses': '/api/papi/v1/responses',
        },
    })



