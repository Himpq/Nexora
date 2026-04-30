import json
import uuid
import time
import traceback
import importlib
import sys
from typing import Any, Dict, List, Tuple, Optional, Generator
from flask import request, jsonify, Response, stream_with_context, current_app
from functools import wraps


def _resolve_server_module():
    for module_name in ('__main__', 'server'):
        module = sys.modules.get(module_name)
        if module is not None and hasattr(module, 'get_config_all'):
            return module
    return importlib.import_module('server')


def _load_config() -> Dict[str, Any]:
    module = _resolve_server_module()
    return getattr(module, 'get_config_all')()


_PAPI_PERMISSION_DEFAULTS: Dict[str, bool] = {
    'model_inference': True,
    'knowledge_read': True,
    'conversations_read': True,
    'conversations_write': True,
    'token_stats_read': True,
    'user_read': True,
}


def _papi_coerce_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {'1', 'true', 'yes', 'on'}


def _papi_normalize_permissions(raw_permissions: Any) -> Dict[str, bool]:
    normalized = dict(_PAPI_PERMISSION_DEFAULTS)
    if isinstance(raw_permissions, dict):
        for key in _PAPI_PERMISSION_DEFAULTS.keys():
            if key in raw_permissions:
                normalized[key] = _papi_coerce_bool(raw_permissions.get(key), normalized[key])
    return normalized


def require_papi_key(f):
    """公有 API 密钥验证装饰器"""
    from functools import wraps
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_key = (
            request.headers.get('X-API-Key')
            or _extract_bearer_token(request.headers.get('Authorization'))
            or request.args.get('api_key')
        )
        module = _resolve_server_module()
        resolver = getattr(module, 'resolve_public_api_key_auth', None)
        if callable(resolver):
            auth = resolver(auth_key, request_path=request.path, method=request.method)
            if not isinstance(auth, dict) or not bool(auth.get('ok')):
                status_code = int((auth or {}).get('status') or 401)
                message = str((auth or {}).get('message') or 'Invalid or missing API Key')
                return jsonify({'success': False, 'message': message}), status_code
            request.environ['papi.auth'] = auth
        else:
            # Backward compatibility: if resolver is unavailable, keep legacy single-key check.
            config = _load_config()
            api_config = config.get('api', {})
            if not _papi_coerce_bool(api_config.get('public_api_enabled'), False):
                return jsonify({'success': False, 'message': 'Public API is disabled'}), 403
            expected_key = str(api_config.get('public_api_key') or '').strip()
            if not expected_key:
                return jsonify({'success': False, 'message': 'Public API key is not configured'}), 401
            if not auth_key or str(auth_key).strip() != expected_key:
                return jsonify({'success': False, 'message': 'Invalid or missing API Key'}), 401
        return f(*args, **kwargs)
    return decorated_function


def _extract_bearer_token(header_value: Any) -> str:
    raw = str(header_value or '').strip()
    if not raw:
        return ''
    if raw.lower().startswith('bearer '):
        return raw[7:].strip()
    return ''


def _papi_pick_model(config: Dict[str, Any], requested_model: str) -> Tuple[str, Dict[str, Any], str, Dict[str, Any]]:
    """为 PAPI 请求解析可用模型与供应商配置。"""
    config = config if isinstance(config, dict) else {}
    models_cfg = config.get('models', {}) if isinstance(config.get('models', {}), dict) else {}
    providers_cfg = config.get('providers', {}) if isinstance(config.get('providers', {}), dict) else {}
    model_name = str(requested_model or '').strip()
    if model_name not in models_cfg or not model_name:
        default_model = str(config.get('default_model') or '').strip()
        if default_model in models_cfg:
            model_name = default_model
        elif models_cfg:
            model_name = next(iter(models_cfg.keys()))
        else:
            return '', {}, '', {}

    model_info = dict(models_cfg.get(model_name, {}) or {})

    provider_name = str(model_info.get('provider') or '').strip() or 'volcengine'
    provider_info = dict(providers_cfg.get(provider_name, {}) or {})

    # 允许模型条目直接携带连接参数，作为 provider 配置的兜底。
    for key in ('api_key', 'base_url', 'api_base'):
        if not provider_info.get(key) and model_info.get(key):
            provider_info[key] = model_info.get(key)

    return model_name, model_info, provider_name, provider_info


def _papi_normalize_messages(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """兼容 messages / prompt / system_prompt 的输入格式。"""
    data = data if isinstance(data, dict) else {}
    raw_messages = data.get('messages')
    if not isinstance(raw_messages, list) and isinstance(data.get('input'), list):
        raw_messages = data.get('input')
    normalized: List[Dict[str, Any]] = []

    if isinstance(raw_messages, list):
        for item in raw_messages:
            if not isinstance(item, dict):
                continue
            item_type = str(item.get('type') or '').strip().lower()
            role = str(item.get('role') or '').strip().lower()
            
            if item_type == 'function_call' or (('call_id' in item) and ('name' in item) and 'output' not in item):
                call_id = str(item.get('call_id') or '').strip()
                name = str(item.get('name') or '').strip()
                arguments = str(item.get('arguments') or '{}').strip()
                if normalized and normalized[-1].get('role') == 'assistant':
                    if not normalized[-1].get('tool_calls'):
                        normalized[-1]['tool_calls'] = []
                    normalized[-1]['tool_calls'].append({
                        'id': call_id,
                        'type': 'function',
                        'function': {'name': name, 'arguments': arguments}
                    })
                else:
                    normalized.append({
                        'role': 'assistant',
                        'content': None,
                        'tool_calls': [{
                            'id': call_id,
                            'type': 'function',
                            'function': {'name': name, 'arguments': arguments}
                        }]
                    })
                continue
            elif item_type == 'function_call_output' or (('call_id' in item) and ('output' in item)):
                call_id = str(item.get('call_id') or '').strip()
                output_val = item.get('output')
                output_text = str(output_val) if not isinstance(output_val, str) else output_val
                normalized.append({
                    'role': 'tool',
                    'tool_call_id': call_id,
                    'content': output_text
                })
                continue

            if role not in {'system', 'developer', 'user', 'assistant', 'tool'}:
                continue

            content = item.get('content')
            if content is None:
                content = None if role == 'assistant' and isinstance(item.get('tool_calls'), list) else ''
            elif not isinstance(content, (str, list, dict)):
                content = str(content)

            msg: Dict[str, Any] = {'role': role, 'content': content}

            name = str(item.get('name') or '').strip()
            if name:
                msg['name'] = name

            tool_call_id = str(item.get('tool_call_id') or '').strip()
            if tool_call_id:
                msg['tool_call_id'] = tool_call_id

            tool_calls = item.get('tool_calls')
            if isinstance(tool_calls, list) and tool_calls:
                msg['tool_calls'] = tool_calls

            normalized.append(msg)

    system_prompt = str(data.get('system_prompt') or '').strip()
    raw_prompt: Any = data.get('prompt')
    if raw_prompt in (None, ''):
        raw_prompt = data.get('message')
    if raw_prompt in (None, ''):
        input_candidate = data.get('input')
        # Do not stringify structured responses `input` (list/dict) into a fake user prompt.
        if isinstance(input_candidate, (str, int, float, bool)):
            raw_prompt = input_candidate
    if raw_prompt in (None, ''):
        raw_prompt = data.get('content')
    if isinstance(raw_prompt, (list, dict)):
        prompt_text = ''
    else:
        prompt_text = str(raw_prompt or '').strip()

    if system_prompt and not any(item.get('role') == 'system' for item in normalized):
        normalized.insert(0, {'role': 'system', 'content': system_prompt})

    if prompt_text and not any(item.get('role') == 'user' for item in normalized):
        normalized.append({'role': 'user', 'content': prompt_text})

    return normalized


def _papi_stringify_instruction_content(content: Any) -> str:
    if content is None:
        return ''
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: List[str] = []
        for piece in content:
            if isinstance(piece, str):
                text = piece.strip()
                if text:
                    parts.append(text)
                continue
            if not isinstance(piece, dict):
                text = str(piece or '').strip()
                if text:
                    parts.append(text)
                continue
            piece_type = str(piece.get('type') or '').strip().lower()
            if piece_type in {'text', 'input_text', 'output_text'}:
                text = str(piece.get('text') or '').strip()
                if text:
                    parts.append(text)
                continue
            if 'text' in piece:
                text = str(piece.get('text') or '').strip()
                if text:
                    parts.append(text)
        return '\n'.join([part for part in parts if part]).strip()
    if isinstance(content, dict):
        piece_type = str(content.get('type') or '').strip().lower()
        if piece_type in {'text', 'input_text', 'output_text'} or 'text' in content:
            return str(content.get('text') or '').strip()
        try:
            return json.dumps(content, ensure_ascii=False, default=str).strip()
        except Exception:
            return str(content).strip()
    return str(content).strip()


def _papi_merge_instruction_parts(*parts: Any) -> str:
    merged = []
    for part in parts:
        text = _papi_stringify_instruction_content(part)
        if text:
            merged.append(text)
    return '\n\n'.join(merged).strip()


def _papi_extract_instruction_messages(messages: List[Dict[str, Any]], seed_instructions: Any = None) -> Tuple[str, List[Dict[str, Any]]]:
    instruction_parts: List[str] = []
    seed_text = _papi_stringify_instruction_content(seed_instructions)
    if seed_text:
        instruction_parts.append(seed_text)

    filtered_messages: List[Dict[str, Any]] = []
    for item in (messages or []):
        if not isinstance(item, dict):
            continue
        role = str(item.get('role') or '').strip().lower()
        if role in {'system', 'developer'}:
            text = _papi_stringify_instruction_content(item.get('content'))
            if text:
                instruction_parts.append(text)
            continue
        filtered_messages.append(item)

    return '\n\n'.join(instruction_parts).strip(), filtered_messages


def _papi_extract_instructions_from_input_items(input_items: Any, seed_instructions: Any = None) -> Tuple[str, List[Dict[str, Any]]]:
    instruction_parts: List[str] = []
    seed_text = _papi_stringify_instruction_content(seed_instructions)
    if seed_text:
        instruction_parts.append(seed_text)

    filtered_items: List[Dict[str, Any]] = []
    for item in (input_items or []):
        if not isinstance(item, dict):
            continue
        item_type = str(item.get('type') or '').strip().lower()
        role = str(item.get('role') or '').strip().lower()
        if item_type == 'message' and role in {'system', 'developer'}:
            text = _papi_stringify_instruction_content(item.get('content'))
            if text:
                instruction_parts.append(text)
            continue
        filtered_items.append(item)

    return '\n\n'.join(instruction_parts).strip(), filtered_items


def _papi_prepare_chat_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    def _stringify_chat_content(content: Any) -> str:
        if content is None:
            return ''
        if isinstance(content, str):
            return content
        if isinstance(content, (int, float, bool)):
            return str(content)
        if isinstance(content, list):
            parts: List[str] = []
            for piece in content:
                if isinstance(piece, str):
                    text = piece.strip()
                    if text:
                        parts.append(text)
                    continue
                if isinstance(piece, dict):
                    piece_type = str(piece.get('type') or '').strip().lower()
                    if piece_type in {'text', 'input_text', 'output_text'} or ('text' in piece):
                        text = str(piece.get('text') or piece.get('content') or '').strip()
                        if text:
                            parts.append(text)
                        continue
                    if 'content' in piece:
                        text = _stringify_chat_content(piece.get('content'))
                        if text.strip():
                            parts.append(text.strip())
                        continue
                else:
                    text = str(piece or '').strip()
                    if text:
                        parts.append(text)
            return '\n'.join([part for part in parts if part]).strip()
        if isinstance(content, dict):
            piece_type = str(content.get('type') or '').strip().lower()
            if piece_type in {'text', 'input_text', 'output_text'} or ('text' in content):
                return str(content.get('text') or content.get('content') or '').strip()
            if 'content' in content:
                return _stringify_chat_content(content.get('content')).strip()
            try:
                return json.dumps(content, ensure_ascii=False, default=str)
            except Exception:
                return str(content)
        return str(content)

    prepared: List[Dict[str, Any]] = []
    for item in (messages or []):
        if not isinstance(item, dict):
            continue
        role = str(item.get('role') or '').strip().lower()
        if role == 'developer':
            role = 'system'
        if role not in {'system', 'user', 'assistant', 'tool'}:
            continue

        msg: Dict[str, Any] = {'role': role}
        content_text = _stringify_chat_content(item.get('content')).strip()

        if role == 'assistant' and isinstance(item.get('tool_calls'), list) and item.get('tool_calls'):
            msg['tool_calls'] = item.get('tool_calls')
            msg['content'] = content_text if content_text else None
        else:
            msg['content'] = content_text

        name = str(item.get('name') or '').strip()
        if name:
            msg['name'] = name
        tool_call_id = str(item.get('tool_call_id') or '').strip()
        if role == 'tool' and tool_call_id:
            msg['tool_call_id'] = tool_call_id

        prepared.append(msg)

    return prepared


def _papi_build_chat_bridge_messages_from_input_items(input_items: Any) -> List[Dict[str, Any]]:
    if not isinstance(input_items, list):
        return []

    bridge_messages: List[Dict[str, Any]] = []
    for item in input_items:
        if not isinstance(item, dict):
            continue

        item_type = str(item.get('type') or '').strip().lower()
        if item_type == 'function_call' or (('call_id' in item) and ('name' in item) and 'output' not in item):
            call_id = str(item.get('call_id') or f"call_{len(bridge_messages)}").strip()
            name = str(item.get('name') or '').strip()
            arguments = str(item.get('arguments') or '{}').strip()
            # 找到前一个 message 如果它是 assistant 且没有 tool_calls，合并到它身上；否则新建
            if bridge_messages and bridge_messages[-1].get('role') == 'assistant' and not bridge_messages[-1].get('tool_calls'):
                if not bridge_messages[-1].get('tool_calls'):
                    bridge_messages[-1]['tool_calls'] = []
                bridge_messages[-1]['tool_calls'].append({
                    'id': call_id,
                    'type': 'function',
                    'function': {'name': name, 'arguments': arguments}
                })
            else:
                bridge_messages.append({
                    'role': 'assistant',
                    'content': None,
                    'tool_calls': [{
                        'id': call_id,
                        'type': 'function',
                        'function': {'name': name, 'arguments': arguments}
                    }]
                })
            continue

        if item_type in {'function_call_output'} or (('call_id' in item) and ('output' in item)):
            call_id = str(item.get('call_id') or '').strip()
            output_value = item.get('output')
            if isinstance(output_value, str):
                output_text = output_value
            else:
                try:
                    output_text = json.dumps(output_value, ensure_ascii=False, default=str)
                except Exception:
                    output_text = str(output_value or '')
            bridge_messages.append({
                'role': 'tool',
                'tool_call_id': call_id or 'unknown',
                'content': output_text,
            })
            continue

        if item_type not in {'', 'message'} and 'role' not in item:
            continue

        role = str(item.get('role') or '').strip().lower()
        if role == 'developer':
            role = 'system'
        if role not in {'system', 'user', 'assistant', 'tool'}:
            continue

        msg: Dict[str, Any] = {
            'role': role,
            'content': item.get('content'),
        }
        if role == 'assistant' and isinstance(item.get('tool_calls'), list) and item.get('tool_calls'):
            msg['tool_calls'] = item.get('tool_calls')
        name = str(item.get('name') or '').strip()
        if name:
            msg['name'] = name
        if role == 'tool':
            tool_call_id = str(item.get('tool_call_id') or item.get('call_id') or '').strip()
            if tool_call_id:
                msg['tool_call_id'] = tool_call_id
        bridge_messages.append(msg)

    return _papi_prepare_chat_messages(bridge_messages)


def _papi_apply_bridge_instructions(messages: List[Dict[str, Any]], instructions: Any) -> List[Dict[str, Any]]:
    out = list(messages or [])
    instruction_text = _papi_stringify_instruction_content(instructions)
    if not instruction_text:
        return out

    if out and str(out[0].get('role') or '').strip().lower() == 'system':
        first = dict(out[0])
        first['content'] = _papi_merge_instruction_parts(instruction_text, first.get('content'))
        out[0] = first
        return out

    out.insert(0, {'role': 'system', 'content': instruction_text})
    return out


def _papi_normalize_tool_spec(tool: Any, *, use_responses_api: bool) -> Optional[Dict[str, Any]]:
    if not isinstance(tool, dict):
        return None

    tool_type = str(tool.get('type') or '').strip() or 'function'

    if 'function' in tool and isinstance(tool.get('function'), dict):
        function_obj = dict(tool.get('function') or {})
        if use_responses_api:
            normalized = {
                'type': tool_type,
                'name': str(function_obj.get('name') or '').strip(),
            }
            if function_obj.get('description') is not None:
                normalized['description'] = function_obj.get('description')
            if function_obj.get('parameters') is not None:
                normalized['parameters'] = function_obj.get('parameters')
            if function_obj.get('strict') is not None:
                normalized['strict'] = function_obj.get('strict')
            return normalized if normalized.get('name') else None
        return tool

    if tool_type == 'function' and str(tool.get('name') or '').strip():
        if use_responses_api:
            return tool
        normalized_function = {
            'name': str(tool.get('name') or '').strip(),
        }
        if tool.get('description') is not None:
            normalized_function['description'] = tool.get('description')
        if tool.get('parameters') is not None:
            normalized_function['parameters'] = tool.get('parameters')
        if tool.get('strict') is not None:
            normalized_function['strict'] = tool.get('strict')
        return {
            'type': 'function',
            'function': normalized_function,
        }

    if use_responses_api and tool_type and tool_type != 'function':
        return tool
    return None


def _papi_normalize_tool_choice(tool_choice: Any, *, use_responses_api: bool) -> Any:
    if tool_choice is None or isinstance(tool_choice, str):
        return tool_choice
    if not isinstance(tool_choice, dict):
        return tool_choice

    choice_type = str(tool_choice.get('type') or '').strip()
    if choice_type != 'function':
        return tool_choice

    if use_responses_api:
        if str(tool_choice.get('name') or '').strip():
            return tool_choice
        function_obj = tool_choice.get('function')
        if isinstance(function_obj, dict) and str(function_obj.get('name') or '').strip():
            return {
                'type': 'function',
                'name': str(function_obj.get('name') or '').strip(),
            }
        return tool_choice

    if isinstance(tool_choice.get('function'), dict):
        return tool_choice
    if str(tool_choice.get('name') or '').strip():
        return {
            'type': 'function',
            'function': {
                'name': str(tool_choice.get('name') or '').strip(),
            },
        }
    return tool_choice


def _papi_extract_completion_text(response_obj: Any) -> str:
    """从 provider 返回中尽量提取完整文本。"""
    def _stringify_any(value: Any) -> str:
        if value is None:
            return ''
        if isinstance(value, str):
            return value
        if isinstance(value, list):
            parts: List[str] = []
            for item in value:
                piece = _stringify_any(item)
                if piece:
                    parts.append(piece)
            return ''.join(parts)
        if isinstance(value, dict):
            for key in ('text', 'content', 'reasoning_content', 'reasoning_text', 'value', 'delta'):
                if key in value:
                    piece = _stringify_any(value.get(key))
                    if piece:
                        return piece
            return ''
        try:
            return str(value)
        except Exception:
            return ''

    def _extract_reasoning_like(container: Any) -> str:
        if container is None:
            return ''
        if isinstance(container, dict):
            for key in ('reasoning_content', 'reasoning', 'reasoning_text', 'thinking', 'thinking_content'):
                piece = _stringify_any(container.get(key))
                if piece and piece.strip():
                    return piece.strip()
        else:
            for key in ('reasoning_content', 'reasoning', 'reasoning_text', 'thinking', 'thinking_content'):
                try:
                    piece = _stringify_any(getattr(container, key, None))
                except Exception:
                    piece = ''
                if piece and piece.strip():
                    return piece.strip()
        return ''

    if response_obj is None:
        return ''

    if isinstance(response_obj, dict):
        output_text = response_obj.get('output_text')
        if isinstance(output_text, str) and output_text.strip():
            return output_text.strip()

        choices = response_obj.get('choices')
        if isinstance(choices, list) and choices:
            choice0 = choices[0] if isinstance(choices[0], dict) else {}
            msg = choice0.get('message', {}) if isinstance(choice0, dict) else {}
            if isinstance(msg, dict):
                content = msg.get('content', '')
                if isinstance(content, str):
                    return content.strip()
                reasoning_text = _extract_reasoning_like(msg)
                if reasoning_text:
                    return reasoning_text
            if isinstance(choice0, dict):
                delta_obj = choice0.get('delta')
                if isinstance(delta_obj, dict):
                    delta_content = delta_obj.get('content')
                    if isinstance(delta_content, str) and delta_content.strip():
                        return delta_content.strip()
                    reasoning_text = _extract_reasoning_like(delta_obj)
                    if reasoning_text:
                        return reasoning_text

        output_items = response_obj.get('output')
        if isinstance(output_items, list):
            parts: List[str] = []
            for item in output_items:
                if not isinstance(item, dict) or str(item.get('type', '') or '').strip() != 'message':
                    continue
                content = item.get('content', [])
                if isinstance(content, list):
                    for piece in content:
                        if isinstance(piece, dict):
                            piece_type = str(piece.get('type', '') or '').strip()
                            if piece_type in {'text', 'output_text'}:
                                parts.append(str(piece.get('text', '') or ''))
                        elif piece is not None:
                            parts.append(str(piece))
                elif isinstance(content, str):
                    parts.append(content)
            merged = '\n'.join([p for p in parts if str(p or '').strip()]).strip()
            if merged:
                return merged

    try:
        output_text = getattr(response_obj, 'output_text', None)
        if isinstance(output_text, str) and output_text.strip():
            return output_text.strip()
    except Exception:
        pass

    try:
        choices = getattr(response_obj, 'choices', None)
        if isinstance(choices, list) and choices:
            choice0 = choices[0]
            message = getattr(choice0, 'message', None)
            if message is not None:
                content = getattr(message, 'content', None)
                if isinstance(content, str):
                    return content.strip()
                if isinstance(content, list):
                    parts: List[str] = []
                    for piece in content:
                        if isinstance(piece, dict):
                            piece_type = str(piece.get('type', '') or '').strip()
                            if piece_type in {'text', 'output_text', 'input_text'}:
                                parts.append(str(piece.get('text', '') or ''))
                        elif piece is not None:
                            parts.append(str(piece))
                    merged = ''.join([p for p in parts if str(p or '').strip()]).strip()
                    if merged:
                        return merged
                reasoning_text = _extract_reasoning_like(message)
                if reasoning_text:
                    return reasoning_text
            delta_obj = getattr(choice0, 'delta', None)
            if delta_obj is not None:
                delta_content = getattr(delta_obj, 'content', None)
                if isinstance(delta_content, str) and delta_content.strip():
                    return delta_content.strip()
                reasoning_text = _extract_reasoning_like(delta_obj)
                if reasoning_text:
                    return reasoning_text
    except Exception:
        pass

    try:
        output_items = getattr(response_obj, 'output', None)
        if isinstance(output_items, list):
            parts: List[str] = []
            for item in output_items:
                item_type = str(getattr(item, 'type', '') or '').strip()
                if item_type != 'message':
                    continue
                content = getattr(item, 'content', None)
                if isinstance(content, list):
                    for piece in content:
                        piece_type = str(getattr(piece, 'type', '') or '').strip()
                        if piece_type in {'text', 'output_text'}:
                            parts.append(str(getattr(piece, 'text', '') or ''))
                elif isinstance(content, str):
                    parts.append(content)
            merged = '\n'.join([p for p in parts if str(p or '').strip()]).strip()
            if merged:
                return merged
    except Exception:
        pass

    return ''


def _papi_extract_usage(response_obj: Any) -> Dict[str, int]:
    usage_obj = None
    if isinstance(response_obj, dict):
        usage_obj = response_obj.get('usage')
    if usage_obj is None:
        usage_obj = getattr(response_obj, 'usage', None)
    if usage_obj is None:
        return {}

    def _read_usage(key: str, default: int = 0) -> int:
        if isinstance(usage_obj, dict):
            try:
                return int(usage_obj.get(key, default) or default)
            except Exception:
                return default
        try:
            return int(getattr(usage_obj, key, default) or default)
        except Exception:
            return default

    prompt_tokens = _read_usage('prompt_tokens', 0)
    completion_tokens = _read_usage('completion_tokens', _read_usage('output_tokens', 0))
    total_tokens = _read_usage('total_tokens', prompt_tokens + completion_tokens)
    return {
        'prompt_tokens': prompt_tokens,
        'completion_tokens': completion_tokens,
        'total_tokens': total_tokens,
    }


def _papi_extract_finish_reason(response_obj: Any) -> str:
    choice0 = None
    if isinstance(response_obj, dict):
        choices = response_obj.get('choices')
        if isinstance(choices, list) and choices:
            choice0 = choices[0]
    else:
        try:
            choices = getattr(response_obj, 'choices', None)
            if isinstance(choices, list) and choices:
                choice0 = choices[0]
        except Exception:
            choice0 = None

    if choice0 is None:
        return 'stop'

    if isinstance(choice0, dict):
        return str(choice0.get('finish_reason') or 'stop')
    try:
        return str(getattr(choice0, 'finish_reason', None) or 'stop')
    except Exception:
        return 'stop'


def _papi_extract_tool_calls(response_obj: Any) -> List[Dict[str, Any]]:
    message = None
    if isinstance(response_obj, dict):
        choices = response_obj.get('choices')
        if isinstance(choices, list) and choices and isinstance(choices[0], dict):
            message = choices[0].get('message')
    else:
        try:
            choices = getattr(response_obj, 'choices', None)
            if isinstance(choices, list) and choices:
                message = getattr(choices[0], 'message', None)
        except Exception:
            message = None

    if message is None:
        return []

    raw_tool_calls = None
    if isinstance(message, dict):
        raw_tool_calls = message.get('tool_calls')
    else:
        raw_tool_calls = getattr(message, 'tool_calls', None)

    if not isinstance(raw_tool_calls, list):
        return []

    normalized: List[Dict[str, Any]] = []
    for idx, tool_call in enumerate(raw_tool_calls):
        if isinstance(tool_call, dict):
            call_id = str(tool_call.get('id') or f'tool_call_{idx}')
            call_type = str(tool_call.get('type') or 'function')
            function_obj = tool_call.get('function') if isinstance(tool_call.get('function'), dict) else {}
            normalized.append({
                'id': call_id,
                'type': call_type,
                'function': {
                    'name': str(function_obj.get('name') or ''),
                    'arguments': str(function_obj.get('arguments') or ''),
                },
            })
            continue

        try:
            function_obj = getattr(tool_call, 'function', None)
            normalized.append({
                'id': str(getattr(tool_call, 'id', None) or f'tool_call_{idx}'),
                'type': str(getattr(tool_call, 'type', None) or 'function'),
                'function': {
                    'name': str(getattr(function_obj, 'name', None) or ''),
                    'arguments': str(getattr(function_obj, 'arguments', None) or ''),
                },
            })
        except Exception:
            continue

    return normalized


def _papi_extract_response_id(response_obj: Any) -> str:
    if isinstance(response_obj, dict):
        raw_id = response_obj.get('id')
        if raw_id:
            return str(raw_id)
    try:
        raw_id = getattr(response_obj, 'id', None)
        if raw_id:
            return str(raw_id)
    except Exception:
        pass
    return f'chatcmpl-{uuid.uuid4().hex}'


def _papi_build_openai_payload(
    *,
    response_obj: Any,
    model_name: str,
    provider_name: str,
    request_username: str,
    quota_status: Dict[str, Any],
) -> Dict[str, Any]:
    content = _papi_extract_completion_text(response_obj)
    tool_calls = _papi_extract_tool_calls(response_obj)
    finish_reason = _papi_extract_finish_reason(response_obj)
    if tool_calls and finish_reason == 'stop':
        finish_reason = 'tool_calls'
    usage = _papi_extract_usage(response_obj)
    payload = {
        'id': _papi_extract_response_id(response_obj),
        'object': 'chat.completion',
        'created': int(time.time()),
        'model': model_name,
        'provider': provider_name,
        'username': request_username,
        'success': True,
        'content': content,
        'message': {
            'role': 'assistant',
            'content': content if not tool_calls else (content or None),
        },
        'choices': [
            {
                'index': 0,
                'message': {
                    'role': 'assistant',
                    'content': content if not tool_calls else (content or None),
                },
                'finish_reason': finish_reason,
            }
        ],
        'quota': quota_status,
    }
    if tool_calls:
        payload['message']['tool_calls'] = tool_calls
        payload['choices'][0]['message']['tool_calls'] = tool_calls
    if usage:
        payload['usage'] = usage
    return payload


def _papi_stream_openai_chat(
    *,
    adapter: Any,
    client: Any,
    model_name: str,
    messages: List[Dict[str, Any]],
    request_kwargs: Dict[str, Any],
) -> Response:
    created_ts = int(time.time())
    completion_id = f'chatcmpl-{uuid.uuid4().hex}'
    request_params: Dict[str, Any] = {'model': model_name, 'stream': True}
    request_params.update(dict(request_kwargs or {}))
    request_params = adapter.apply_protocol_payload(
        request_params,
        use_responses_api=False,
        messages=messages,
        previous_response_id=None,
        current_function_outputs=None,
    )
    stream_options = request_params.get('stream_options')
    include_usage = bool(isinstance(stream_options, dict) and stream_options.get('include_usage'))
    iterator = adapter.create_stream_iterator(
        client=client,
        request_params=request_params,
        use_responses_api=False,
    )
    event_iter = adapter.iter_stream_events(
        iterator,
        use_responses_api=False,
        native_web_search_enabled=False,
    )

    def _event_stream():
        role_emitted = False
        usage_payload = None
        saw_tool_calls = False
        for ev in event_iter:
            if not isinstance(ev, dict):
                continue
            ev_type = str(ev.get('type') or '').strip()
            if ev_type == 'content_delta':
                delta_payload: Dict[str, Any] = {}
                if not role_emitted:
                    delta_payload['role'] = 'assistant'
                    role_emitted = True
                delta_payload['content'] = str(ev.get('delta') or '')
                chunk = {
                    'id': completion_id,
                    'object': 'chat.completion.chunk',
                    'created': created_ts,
                    'model': model_name,
                    'choices': [{'index': 0, 'delta': delta_payload, 'finish_reason': None}],
                }
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            elif ev_type == 'reasoning_delta':
                # 对外保持 chat.completions 兼容：把 reasoning 也映射到 delta.content，
                # 避免上游仅输出 thinking 时客户端看到空流。
                delta_payload: Dict[str, Any] = {}
                if not role_emitted:
                    delta_payload['role'] = 'assistant'
                    role_emitted = True
                delta_payload['content'] = str(ev.get('delta') or '')
                chunk = {
                    'id': completion_id,
                    'object': 'chat.completion.chunk',
                    'created': created_ts,
                    'model': model_name,
                    'choices': [{'index': 0, 'delta': delta_payload, 'finish_reason': None}],
                }
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            elif ev_type == 'function_call_delta':
                saw_tool_calls = True
                delta_tool_call = {
                    'index': int(ev.get('index', 0) or 0),
                    'id': str(ev.get('call_id') or ('tool_call_' + str(int(ev.get('index', 0) or 0)))),
                    'type': 'function',
                    'function': {},
                }
                name_delta = str(ev.get('name_delta') or '')
                arguments_delta = str(ev.get('arguments_delta') or '')
                if name_delta:
                    delta_tool_call['function']['name'] = name_delta
                if arguments_delta:
                    delta_tool_call['function']['arguments'] = arguments_delta
                delta_payload = {'tool_calls': [delta_tool_call]}
                if not role_emitted:
                    delta_payload['role'] = 'assistant'
                    role_emitted = True
                chunk = {
                    'id': completion_id,
                    'object': 'chat.completion.chunk',
                    'created': created_ts,
                    'model': model_name,
                    'choices': [{'index': 0, 'delta': delta_payload, 'finish_reason': None}],
                }
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            elif ev_type == 'function_call':
                # 兼容部分 provider 只在收尾阶段给完整 function_call，而不提供 delta 过程。
                saw_tool_calls = True
                call_index = int(ev.get('index', 0) or 0)
                call_id = str(ev.get('call_id') or ('tool_call_' + str(call_index)))
                fc_name = str(ev.get('name') or '')
                fc_args = str(ev.get('arguments') or '')
                delta_payload = {
                    'tool_calls': [
                        {
                            'index': call_index,
                            'id': call_id,
                            'type': 'function',
                            'function': {
                                'name': fc_name,
                                'arguments': fc_args,
                            },
                        }
                    ]
                }
                if not role_emitted:
                    delta_payload['role'] = 'assistant'
                    role_emitted = True
                chunk = {
                    'id': completion_id,
                    'object': 'chat.completion.chunk',
                    'created': created_ts,
                    'model': model_name,
                    'choices': [{'index': 0, 'delta': delta_payload, 'finish_reason': None}],
                }
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            elif ev_type == 'usage':
                usage_payload = {
                    'prompt_tokens': int(ev.get('input_tokens', 0) or 0),
                    'completion_tokens': int(ev.get('output_tokens', 0) or 0),
                    'total_tokens': int(ev.get('total_tokens', 0) or 0),
                }

        final_chunk = {
            'id': completion_id,
            'object': 'chat.completion.chunk',
            'created': created_ts,
            'model': model_name,
            'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls' if saw_tool_calls else 'stop'}],
        }
        if include_usage and usage_payload:
            final_chunk['usage'] = usage_payload
        yield f"data: {json.dumps(final_chunk, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return Response(_event_stream(), mimetype='text/event-stream')


def _papi_build_responses_payload(
    *,
    response_obj: Any,
    model_name: str,
    provider_name: str,
    request_username: str,
    quota_status: Dict[str, Any],
) -> Dict[str, Any]:
    content = _papi_extract_completion_text(response_obj)
    tool_calls = _papi_extract_tool_calls(response_obj)
    usage = _papi_extract_usage(response_obj)
    response_id = _papi_extract_response_id(response_obj)
    if not str(response_id or '').startswith('resp_'):
        response_id = f'resp_{uuid.uuid4().hex}'
    message_item_id = f'msg_{uuid.uuid4().hex}'
    output_items: List[Dict[str, Any]] = [
        {
            'id': message_item_id,
            'type': 'message',
            'role': 'assistant',
            'status': 'completed',
            'content': [
                {
                    'type': 'output_text',
                    'text': content,
                    'annotations': [],
                }
            ],
        }
    ]
    for idx, tool_call in enumerate(tool_calls):
        function_obj = tool_call.get('function', {}) if isinstance(tool_call, dict) else {}
        output_items.append({
            'id': str((tool_call or {}).get('id') or f'fc_{idx}_{uuid.uuid4().hex[:8]}'),
            'type': 'function_call',
            'call_id': str((tool_call or {}).get('id') or f'call_{idx}'),
            'name': str(function_obj.get('name') or ''),
            'arguments': str(function_obj.get('arguments') or ''),
            'status': 'completed',
        })

    payload = {
        'id': response_id,
        'object': 'response',
        'created_at': int(time.time()),
        'status': 'completed',
        'model': model_name,
        'output': output_items,
        'output_text': content,
        'provider': provider_name,
        'username': request_username,
        'success': True,
        'quota': quota_status,
    }
    if usage:
        payload['usage'] = {
            'input_tokens': int(usage.get('prompt_tokens', 0) or 0),
            'output_tokens': int(usage.get('completion_tokens', 0) or 0),
            'total_tokens': int(usage.get('total_tokens', 0) or 0),
        }
    return payload


def _papi_normalize_responses_input_payload(payload: Any) -> Any:
    def _fallback_text_piece(value: Any) -> Dict[str, Any]:
        if value is None:
            return {'type': 'input_text', 'text': ''}
        if isinstance(value, str):
            return {'type': 'input_text', 'text': value}
        if isinstance(value, (int, float, bool)):
            return {'type': 'input_text', 'text': str(value)}
        try:
            return {'type': 'input_text', 'text': json.dumps(value, ensure_ascii=False, default=str)}
        except Exception:
            return {'type': 'input_text', 'text': str(value)}

    def _normalize_content_piece(piece: Any) -> Any:
        if piece is None:
            return {'type': 'input_text', 'text': ''}
        if isinstance(piece, str):
            return {'type': 'input_text', 'text': piece}
        if not isinstance(piece, dict):
            return {'type': 'input_text', 'text': str(piece)}

        normalized_piece: Dict[str, Any] = {}
        for key, value in piece.items():
            if isinstance(value, list):
                normalized_piece[key] = [_normalize_content_piece(child) for child in value]
            elif isinstance(value, dict):
                normalized_piece[key] = _normalize_content_piece(value)
            else:
                normalized_piece[key] = value

        piece_type = str(normalized_piece.get('type') or '').strip().lower()
        if piece_type in {'text', 'output_text'}:
            return {
                'type': 'input_text',
                'text': str(
                    normalized_piece.get('text')
                    or normalized_piece.get('content')
                    or normalized_piece.get('value')
                    or ''
                ),
            }
        if piece_type == 'input_text':
            return {
                'type': 'input_text',
                'text': str(
                    normalized_piece.get('text')
                    or normalized_piece.get('content')
                    or normalized_piece.get('value')
                    or ''
                ),
            }
        if piece_type == 'image_url':
            image_url = normalized_piece.get('image_url') or normalized_piece.get('url') or ''
            if not image_url:
                return _fallback_text_piece(piece)
            return {
                'type': 'input_image',
                'image_url': image_url,
            }
        if piece_type == 'input_image':
            if not normalized_piece.get('image_url') and normalized_piece.get('url') is not None:
                normalized_piece['image_url'] = normalized_piece.get('url')
            if not normalized_piece.get('image_url'):
                return _fallback_text_piece(piece)
            return {
                'type': 'input_image',
                'image_url': normalized_piece.get('image_url'),
            }
        if piece_type == 'video_url':
            video_url = normalized_piece.get('video_url') or normalized_piece.get('url') or ''
            if not video_url:
                return _fallback_text_piece(piece)
            return {
                'type': 'video_url',
                'video_url': video_url,
            }
        if piece_type == 'input_video':
            if not normalized_piece.get('video_url') and normalized_piece.get('url') is not None:
                normalized_piece['video_url'] = normalized_piece.get('url')
            if not normalized_piece.get('video_url'):
                return _fallback_text_piece(piece)
            return {
                'type': 'input_video',
                'video_url': normalized_piece.get('video_url'),
            }

        for key in ('text', 'content', 'value'):
            if key in normalized_piece and not isinstance(normalized_piece.get(key), (list, dict)):
                return {'type': 'input_text', 'text': str(normalized_piece.get(key) or '')}
        return _fallback_text_piece(piece)

    def _normalize_item(item: Any, *, top_level: bool) -> Any:
        if isinstance(item, list):
            return [_normalize_item(child, top_level=top_level) for child in item]
        if not isinstance(item, dict):
            return item

        normalized: Dict[str, Any] = {}
        for key, value in item.items():
            if isinstance(value, list):
                normalized[key] = [_normalize_item(child, top_level=False) for child in value]
            elif isinstance(value, dict):
                normalized[key] = _normalize_item(value, top_level=False)
            else:
                normalized[key] = value

        if top_level:
            item_type = str(normalized.get('type') or '').strip()
            has_call_output = ('call_id' in normalized) and ('output' in normalized)
            if not item_type and has_call_output:
                normalized['type'] = 'function_call_output'
                item_type = 'function_call_output'

            if 'role' in normalized:
                if not item_type:
                    normalized['type'] = 'message'
                    item_type = 'message'
                role_val = str(normalized.get('role') or '').strip().lower()
                content_value = normalized.get('content')
                if content_value is None:
                    # None content: assistant 有 tool_calls 时 content 合法为 None，生成空列表
                    normalized_content = []
                elif isinstance(content_value, list):
                    normalized_content = [_normalize_content_piece(child) for child in content_value]
                elif isinstance(content_value, dict):
                    normalized_content = [_normalize_content_piece(content_value)]
                else:
                    normalized_content = [_normalize_content_piece(content_value)]
                # 过滤掉 text 为空字符串的 input_text 条目，避免 API 报 missing text
                normalized_content = [
                    piece for piece in normalized_content
                    if not (isinstance(piece, dict)
                            and str(piece.get('type') or '').strip() == 'input_text'
                            and str(piece.get('text') or '').strip() == '')
                ]
                # 只有非 assistant 角色且内容为空时才插入空 text fallback
                if not normalized_content and role_val != 'assistant':
                    normalized_content = [{'type': 'input_text', 'text': ''}]
                normalized['content'] = normalized_content
                if 'status' not in normalized:
                    normalized['status'] = 'completed'
            elif item_type == 'message':
                role_val = str(normalized.get('role') or '').strip().lower()
                content_value = normalized.get('content')
                if isinstance(content_value, list):
                    normalized_content = [_normalize_content_piece(child) for child in content_value]
                elif isinstance(content_value, dict):
                    normalized_content = [_normalize_content_piece(content_value)]
                elif content_value is not None:
                    normalized_content = [_normalize_content_piece(content_value)]
                else:
                    normalized_content = []
                # 过滤掉 text 为空字符串的 input_text 条目，避免 API 报 missing text
                normalized_content = [
                    piece for piece in normalized_content
                    if not (isinstance(piece, dict)
                            and str(piece.get('type') or '').strip() == 'input_text'
                            and str(piece.get('text') or '').strip() == '')
                ]
                if not normalized_content and role_val != 'assistant':
                    normalized_content = [{'type': 'input_text', 'text': ''}]
                normalized['content'] = normalized_content
                if 'status' not in normalized:
                    normalized['status'] = 'completed'
            elif item_type == 'function_call_output':
                normalized['output'] = str(normalized.get('output') or '')
        return normalized

    def _expand_chat_item_to_responses_items(item: Any) -> List[Dict[str, Any]]:
        """
        将 chat.completions 格式的单条消息展开为 Responses API 所需的一或多个条目。
        - assistant + tool_calls  → 多个 function_call 条目
        - role:tool + tool_call_id → function_call_output 条目
        - 其余消息                → 普通 message 条目（经过 _normalize_item 处理）
        """
        if not isinstance(item, dict):
            return [_normalize_item(item, top_level=True)]

        role = str(item.get('role') or '').strip().lower()

        # role=tool → function_call_output
        if role == 'tool':
            call_id = str(item.get('tool_call_id') or '').strip()
            content_raw = item.get('content')
            if isinstance(content_raw, str):
                output_str = content_raw
            elif content_raw is None:
                output_str = ''
            else:
                try:
                    output_str = json.dumps(content_raw, ensure_ascii=False, default=str)
                except Exception:
                    output_str = str(content_raw)
            return [{'type': 'function_call_output', 'call_id': call_id, 'output': output_str}]

        # role=assistant 且有 tool_calls → 展开为多个 function_call 条目
        if role == 'assistant':
            raw_tool_calls = item.get('tool_calls')
            if isinstance(raw_tool_calls, list) and raw_tool_calls:
                fc_items: List[Dict[str, Any]] = []
                for tc in raw_tool_calls:
                    if not isinstance(tc, dict):
                        continue
                    fn = tc.get('function') if isinstance(tc.get('function'), dict) else {}
                    fc_items.append({
                        'type': 'function_call',
                        'call_id': str(tc.get('id') or '').strip(),
                        'name': str(fn.get('name') or '').strip(),
                        'arguments': str(fn.get('arguments') or '{}'),
                        'status': 'completed',
                    })
                if fc_items:
                    return fc_items
                # tool_calls 为空列表时，退出为普通 message
            # assistant 无 tool_calls → 普通 message，但跳过 content 为空的条目
            normalized = _normalize_item(item, top_level=True)
            if isinstance(normalized, dict):
                content_list = normalized.get('content', [])
                if isinstance(content_list, list) and not content_list:
                    # content 为空的 assistant 消息对 Responses API 无意义，跳过
                    return []
            return [normalized]

        # 其余角色（user / system / developer）正常处理
        return [_normalize_item(item, top_level=True)]

    if isinstance(payload, list):
        result: List[Dict[str, Any]] = []
        for raw_item in payload:
            result.extend(_expand_chat_item_to_responses_items(raw_item))
        return result
    return _normalize_item(payload, top_level=True)


def _papi_has_function_call_outputs(input_items: Any) -> bool:
    return bool(
        isinstance(input_items, list)
        and any(
            isinstance(item, dict)
            and (
                str(item.get('type') or '').strip() == 'function_call_output'
                or (('call_id' in item) and ('output' in item))
            )
            for item in input_items
        )
    )


def _papi_build_synthetic_messages_from_function_outputs(input_items: Any) -> List[Dict[str, Any]]:
    if not isinstance(input_items, list):
        return []

    output_parts: List[str] = []
    for item in input_items:
        if not isinstance(item, dict):
            continue
        item_type = str(item.get('type') or '').strip()
        if item_type != 'function_call_output' and not (('call_id' in item) and ('output' in item)):
            continue
        call_id = str(item.get('call_id') or '').strip()
        output_value = item.get('output')
        if isinstance(output_value, str):
            output_text = output_value
        else:
            try:
                output_text = json.dumps(output_value, ensure_ascii=False, default=str)
            except Exception:
                output_text = str(output_value or '')
        output_parts.append(f"[tool:{call_id or 'unknown'}]\n{output_text}")

    synthetic_user_content = "\n\n".join([part for part in output_parts if str(part or '').strip()]).strip()
    if not synthetic_user_content:
        return []
    return [{'role': 'user', 'content': synthetic_user_content}]


def _papi_prepare_fallback_messages_for_tool_outputs(
    messages: Any,
    input_items: Any,
    *,
    previous_response_id: Optional[str] = None,
    allow_synthetic_fallback: bool = False,
) -> List[Dict[str, Any]]:
    if not allow_synthetic_fallback:
        return []
    if str(previous_response_id or '').strip():
        return []
    if not _papi_has_function_call_outputs(input_items):
        return []

    synthetic_messages = _papi_build_synthetic_messages_from_function_outputs(input_items)
    if not synthetic_messages:
        return []

    clean_messages: List[Dict[str, Any]] = []
    for raw_msg in (messages or []):
        if not isinstance(raw_msg, dict):
            continue
        role = str(raw_msg.get('role') or '').strip().lower()
        if role == 'tool':
            continue
        if role == 'assistant' and raw_msg.get('tool_calls'):
            msg = dict(raw_msg)
            msg.pop('tool_calls', None)
            content_val = msg.get('content')
            is_empty = False
            if content_val is None:
                is_empty = True
            elif isinstance(content_val, str) and not content_val.strip():
                is_empty = True
            elif isinstance(content_val, list) and not content_val:
                is_empty = True
            if is_empty:
                continue
            clean_messages.append(msg)
            continue
        clean_messages.append(raw_msg)

    return clean_messages + synthetic_messages


def _papi_log(message: str, level: str = 'warning') -> None:
    text = str(message or '').strip()
    if not text:
        return
    try:
        logger = getattr(current_app, 'logger', None)
        logger_method = getattr(logger, str(level or 'warning').lower(), None) if logger is not None else None
        if callable(logger_method):
            logger_method(text)
        elif logger is not None:
            logger.warning(text)
    except Exception:
        pass
    try:
        print(text, flush=True)
    except Exception:
        pass


def _papi_stream_openai_responses(
    *,
    adapter: Any,
    client: Any,
    model_name: str,
    messages: List[Dict[str, Any]],
    request_kwargs: Dict[str, Any],
    previous_response_id: Optional[str] = None,
    input_items: Optional[List[Dict[str, Any]]] = None,
    allow_synthetic_fallback: bool = False,
    use_responses_upstream: bool = True,
) -> Response:
    created_ts = int(time.time())
    response_id_box = [f'resp_{uuid.uuid4().hex}']
    message_item_id = f'msg_{uuid.uuid4().hex}'
    message_output_index = 0
    message_content_index = 0

    def _bridge_chat_kwargs(raw_kwargs: Dict[str, Any]) -> Dict[str, Any]:
        kwargs = dict(raw_kwargs or {})
        if kwargs.get('max_tokens') is None and kwargs.get('max_output_tokens') is not None:
            kwargs['max_tokens'] = kwargs.get('max_output_tokens')
        for key in (
            'instructions',
            'text',
            'reasoning',
            'store',
            'include',
            'truncation',
            'parallel_tool_calls',
            'metadata',
            'max_output_tokens',
        ):
            kwargs.pop(key, None)
        return kwargs

    def _build_request_params(active_messages, active_previous_response_id, active_input_items):
        params: Dict[str, Any] = {'model': model_name, 'stream': True}
        if use_responses_upstream:
            params.update(dict(request_kwargs or {}))
            if isinstance(active_input_items, list) and active_input_items:
                if active_previous_response_id:
                    params['previous_response_id'] = active_previous_response_id
                params['input'] = active_input_items
            else:
                params = adapter.apply_protocol_payload(
                    params,
                    use_responses_api=True,
                    messages=active_messages,
                    previous_response_id=active_previous_response_id,
                    current_function_outputs=None,
                )
            if 'input' in params:
                params['input'] = _papi_normalize_responses_input_payload(params.get('input'))
            return params

        bridge_instructions = (request_kwargs or {}).get('instructions')
        params.update(_bridge_chat_kwargs(request_kwargs))
        bridge_messages: List[Dict[str, Any]] = []
        if isinstance(active_input_items, list) and active_input_items:
            bridge_messages = _papi_build_chat_bridge_messages_from_input_items(active_input_items)
        if not bridge_messages:
            bridge_messages = _papi_prepare_chat_messages(list(active_messages or []))
        bridge_messages = _papi_apply_bridge_instructions(bridge_messages, bridge_instructions)
        params = adapter.apply_protocol_payload(
            params,
            use_responses_api=False,
            messages=bridge_messages,
            previous_response_id=None,
            current_function_outputs=None,
        )
        return params

    fallback_messages = _papi_prepare_fallback_messages_for_tool_outputs(
        messages,
        input_items,
        previous_response_id=previous_response_id,
        allow_synthetic_fallback=allow_synthetic_fallback,
    )
    request_params = _build_request_params(messages, previous_response_id, input_items)
    try:
        _input_items_count = len(request_params.get('input') or []) if isinstance(request_params.get('input'), list) else 0
    except Exception:
        _input_items_count = 0
    _papi_log(
        f"[PAPI_RESP_REQ] model={model_name} prev={'yes' if request_params.get('previous_response_id') else 'no'} "
        f"input_items={_input_items_count} stream=true"
    )

    def _event_stream():
        text_parts: List[str] = []
        function_calls: Dict[str, Dict[str, Any]] = {}
        sequence_number = 0

        def _emit(payload: Dict[str, Any]):
            nonlocal sequence_number
            payload = dict(payload or {})
            payload['sequence_number'] = sequence_number
            sequence_number += 1
            return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

        message_item = {
            'id': message_item_id,
            'type': 'message',
            'role': 'assistant',
            'status': 'in_progress',
            'content': [],
        }
        text_part = {
            'type': 'output_text',
            'text': '',
            'annotations': [],
        }

        yield _emit({
            'type': 'response.created',
            'response': {
                'id': response_id_box[0],
                'object': 'response',
                'created_at': created_ts,
                'model': model_name,
                'status': 'in_progress',
                'output': [],
            },
        })
        yield _emit({
            'type': 'response.output_item.added',
            'response_id': response_id_box[0],
            'output_index': message_output_index,
            'item': message_item,
        })
        yield _emit({
            'type': 'response.content_part.added',
            'response_id': response_id_box[0],
            'item_id': message_item_id,
            'output_index': message_output_index,
            'content_index': message_content_index,
            'part': text_part,
        })

        active_request_params = request_params
        try:
            _papi_log(
                f"[PAPI_RESP_STREAM_OPEN] model={model_name} mode={'responses_upstream' if use_responses_upstream else 'chat_bridge'}"
            )
            iterator = adapter.create_stream_iterator(
                client=client,
                request_params=active_request_params,
                use_responses_api=use_responses_upstream,
            )
        except Exception as create_error:
            if fallback_messages:
                _papi_log(f"[PAPI_RESP_REQ] retry without previous_response_id via synthetic message fallback: {create_error}")
                active_request_params = _build_request_params(fallback_messages, None, None)
                try:
                    iterator = adapter.create_stream_iterator(
                        client=client,
                        request_params=active_request_params,
                        use_responses_api=use_responses_upstream,
                    )
                except Exception as retry_error:
                    create_error = retry_error
                    iterator = None
            else:
                iterator = None

            if iterator is None:
                _papi_log(f"[PAPI_RESP_STREAM_OPEN] model={model_name} open_failed={create_error}", level='error')
                yield _emit({
                    'type': 'response.failed',
                    'response': {
                        'id': response_id_box[0],
                        'object': 'response',
                        'created_at': created_ts,
                        'model': model_name,
                        'status': 'failed',
                        'error': {
                            'type': 'provider_error',
                            'message': str(create_error or ''),
                        },
                    },
                })
                yield "data: [DONE]\n\n"
                return

        event_iter = adapter.iter_stream_events(
            iterator,
            use_responses_api=use_responses_upstream,
            native_web_search_enabled=False,
        )
        first_event_seen = False
        try:
            for ev in event_iter:
                if not isinstance(ev, dict):
                    continue
                if not first_event_seen:
                    first_event_seen = True
                    _papi_log(f"[PAPI_RESP_STREAM_OPEN] model={model_name} first_event_received")
                ev_type = str(ev.get('type') or '').strip()
                if ev_type == 'response_id':
                    rid = str(ev.get('response_id') or '').strip()
                    if rid:
                        response_id_box[0] = rid if rid.startswith('resp_') else f'resp_{rid}'
                    continue
                if ev_type == 'content_delta':
                    delta = str(ev.get('delta') or '')
                    if delta:
                        text_parts.append(delta)
                        yield _emit({
                            'type': 'response.output_text.delta',
                            'response_id': response_id_box[0],
                            'item_id': message_item_id,
                            'output_index': message_output_index,
                            'content_index': message_content_index,
                            'delta': delta,
                        })
                    continue
                if ev_type == 'reasoning_delta':
                    # 与 content 统一通道输出，避免上游仅 thinking 时客户端拿不到文本。
                    delta = str(ev.get('delta') or '')
                    if delta:
                        text_parts.append(delta)
                        yield _emit({
                            'type': 'response.output_text.delta',
                            'response_id': response_id_box[0],
                            'item_id': message_item_id,
                            'output_index': message_output_index,
                            'content_index': message_content_index,
                            'delta': delta,
                        })
                    continue
                if ev_type == 'function_call_delta':
                    call_id = str(ev.get('call_id') or f'fc_{len(function_calls)}').strip()
                    entry = function_calls.setdefault(call_id, {
                        'id': call_id,
                        'name': '',
                        'arguments': '',
                        'output_index': len(function_calls) + 1,
                        'emitted': False,
                    })
                    full_name = str(ev.get('name') or '').strip()
                    name_delta = str(ev.get('name_delta') or '')
                    if full_name:
                        entry['name'] = full_name
                    elif name_delta:
                        entry['name'] += name_delta
                    if (not entry.get('emitted')) and str(entry.get('name') or '').strip():
                        yield _emit({
                            'type': 'response.output_item.added',
                            'response_id': response_id_box[0],
                            'output_index': int(entry['output_index']),
                            'item': {
                                'id': call_id,
                                'type': 'function_call',
                                'call_id': call_id,
                                'name': str(entry.get('name') or ''),
                                'arguments': '',
                                'status': 'in_progress',
                            },
                        })
                        entry['emitted'] = True
                    if ev.get('arguments_delta'):
                        entry['arguments'] += str(ev.get('arguments_delta') or '')
                        if entry.get('emitted'):
                            yield _emit({
                                'type': 'response.function_call_arguments.delta',
                                'response_id': response_id_box[0],
                                'item_id': call_id,
                                'output_index': int(entry['output_index']),
                                'delta': str(ev.get('arguments_delta') or ''),
                            })
                    continue
                if ev_type == 'function_call':
                    call_id = str(ev.get('call_id') or f'fc_{len(function_calls)}').strip()
                    entry = function_calls.setdefault(call_id, {
                        'id': call_id,
                        'name': '',
                        'arguments': '',
                        'output_index': len(function_calls) + 1,
                        'emitted': False,
                    })
                    full_name = str(ev.get('name') or '').strip()
                    full_arguments = str(ev.get('arguments') or '')
                    if full_name:
                        entry['name'] = full_name
                    if full_arguments:
                        entry['arguments'] = full_arguments
                    if (not entry.get('emitted')) and str(entry.get('name') or '').strip():
                        yield _emit({
                            'type': 'response.output_item.added',
                            'response_id': response_id_box[0],
                            'output_index': int(entry['output_index']),
                            'item': {
                                'id': call_id,
                                'type': 'function_call',
                                'call_id': call_id,
                                'name': str(entry.get('name') or ''),
                                'arguments': '',
                                'status': 'in_progress',
                            },
                        })
                        entry['emitted'] = True
                    if entry.get('emitted') and full_arguments:
                        yield _emit({
                            'type': 'response.function_call_arguments.delta',
                            'response_id': response_id_box[0],
                            'item_id': call_id,
                            'output_index': int(entry['output_index']),
                            'delta': full_arguments,
                        })
                    continue
        except Exception as stream_error:
            _papi_log(f"[PAPI_RESP_STREAM_ITER] model={model_name} error={stream_error}", level='error')
            yield _emit({
                'type': 'response.failed',
                'response': {
                    'id': response_id_box[0],
                    'object': 'response',
                    'created_at': created_ts,
                    'model': model_name,
                    'status': 'failed',
                    'error': {
                        'type': 'provider_error',
                        'message': str(stream_error or ''),
                    },
                },
            })
            yield "data: [DONE]\n\n"
            return

        final_text = ''.join(text_parts)
        yield _emit({
            'type': 'response.output_text.done',
            'response_id': response_id_box[0],
            'item_id': message_item_id,
            'output_index': message_output_index,
            'content_index': message_content_index,
            'text': final_text,
        })
        yield _emit({
            'type': 'response.content_part.done',
            'response_id': response_id_box[0],
            'item_id': message_item_id,
            'output_index': message_output_index,
            'content_index': message_content_index,
            'part': {
                'type': 'output_text',
                'text': final_text,
                'annotations': [],
            },
        })
        completed_output: List[Dict[str, Any]] = [
            {
                'id': message_item_id,
                'type': 'message',
                'role': 'assistant',
                'status': 'completed',
                'content': [
                    {
                        'type': 'output_text',
                        'text': final_text,
                        'annotations': [],
                    }
                ],
            }
        ]
        yield _emit({
            'type': 'response.output_item.done',
            'response_id': response_id_box[0],
            'output_index': message_output_index,
            'item': completed_output[0],
        })
        for call_id, fc in function_calls.items():
            completed_item = {
                'id': call_id,
                'type': 'function_call',
                'call_id': call_id,
                'name': str(fc.get('name') or ''),
                'arguments': str(fc.get('arguments') or ''),
                'status': 'completed',
            }
            completed_output.append(completed_item)
            yield _emit({
                'type': 'response.output_item.done',
                'response_id': response_id_box[0],
                'output_index': int(fc.get('output_index') or 0),
                'item': completed_item,
            })
        completed = {
            'type': 'response.completed',
            'response': {
                'id': response_id_box[0],
                'object': 'response',
                'created_at': created_ts,
                'model': model_name,
                'status': 'completed',
                'output': completed_output,
                'output_text': final_text,
            },
        }
        yield _emit(completed)
        yield "data: [DONE]\n\n"

    return Response(_event_stream(), mimetype='text/event-stream')


def _papi_create_openai_responses_payload(
    *,
    adapter: Any,
    client: Any,
    model_name: str,
    messages: List[Dict[str, Any]],
    request_kwargs: Dict[str, Any],
    provider_name: str,
    request_username: str,
    quota_status: Dict[str, Any],
    previous_response_id: Optional[str] = None,
    input_items: Optional[List[Dict[str, Any]]] = None,
    allow_synthetic_fallback: bool = False,
    use_responses_upstream: bool = True,
) -> Dict[str, Any]:
    def _bridge_chat_kwargs(raw_kwargs: Dict[str, Any]) -> Dict[str, Any]:
        kwargs = dict(raw_kwargs or {})
        if kwargs.get('max_tokens') is None and kwargs.get('max_output_tokens') is not None:
            kwargs['max_tokens'] = kwargs.get('max_output_tokens')
        for key in (
            'instructions',
            'text',
            'reasoning',
            'store',
            'include',
            'truncation',
            'parallel_tool_calls',
            'metadata',
            'max_output_tokens',
        ):
            kwargs.pop(key, None)
        return kwargs

    def _build_request_params(active_messages, active_previous_response_id, active_input_items):
        params: Dict[str, Any] = {'model': model_name, 'stream': False}
        if use_responses_upstream:
            params.update(dict(request_kwargs or {}))
            if isinstance(active_input_items, list) and active_input_items:
                if active_previous_response_id:
                    params['previous_response_id'] = active_previous_response_id
                params['input'] = active_input_items
            else:
                params = adapter.apply_protocol_payload(
                    params,
                    use_responses_api=True,
                    messages=active_messages,
                    previous_response_id=active_previous_response_id,
                    current_function_outputs=None,
                )
            if 'input' in params:
                params['input'] = _papi_normalize_responses_input_payload(params.get('input'))
            return params

        bridge_instructions = (request_kwargs or {}).get('instructions')
        params.update(_bridge_chat_kwargs(request_kwargs))
        bridge_messages: List[Dict[str, Any]] = []
        if isinstance(active_input_items, list) and active_input_items:
            bridge_messages = _papi_build_chat_bridge_messages_from_input_items(active_input_items)
        if not bridge_messages:
            bridge_messages = _papi_prepare_chat_messages(list(active_messages or []))
        bridge_messages = _papi_apply_bridge_instructions(bridge_messages, bridge_instructions)
        params['messages'] = bridge_messages
        return params

    fallback_messages = _papi_prepare_fallback_messages_for_tool_outputs(
        messages,
        input_items,
        previous_response_id=previous_response_id,
        allow_synthetic_fallback=allow_synthetic_fallback,
    )
    request_params = _build_request_params(messages, previous_response_id, input_items)
    try:
        _input_items_count = len(request_params.get('input') or []) if isinstance(request_params.get('input'), list) else 0
    except Exception:
        _input_items_count = 0
    _papi_log(
        f"[PAPI_RESP_REQ] model={model_name} prev={'yes' if request_params.get('previous_response_id') else 'no'} "
        f"input_items={_input_items_count} stream=false"
    )
    try:
        if use_responses_upstream:
            response = client.responses.create(**request_params)
        else:
            response = adapter.create_chat_completion(
                client=client,
                model=model_name,
                messages=request_params.get('messages') or [],
                stream=False,
                **_bridge_chat_kwargs(request_kwargs),
            )
    except Exception as create_error:
        if fallback_messages:
            _papi_log(f"[PAPI_RESP_REQ] retry non-stream without previous_response_id via synthetic message fallback: {create_error}")
            request_params = _build_request_params(fallback_messages, None, None)
            if use_responses_upstream:
                response = client.responses.create(**request_params)
            else:
                response = adapter.create_chat_completion(
                    client=client,
                    model=model_name,
                    messages=request_params.get('messages') or [],
                    stream=False,
                    **_bridge_chat_kwargs(request_kwargs),
                )
        else:
            raise
    return _papi_build_responses_payload(
        response_obj=response,
        model_name=model_name,
        provider_name=provider_name,
        request_username=request_username,
        quota_status=quota_status,
    )


