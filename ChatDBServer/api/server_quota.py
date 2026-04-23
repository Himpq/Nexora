import os
import threading
import time
from typing import Any, Dict, List, Optional

from datastorage import safe_append_jsonl, safe_read_json, safe_read_jsonl_tail


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
MODELS_PATH = os.path.join(DATA_DIR, 'models.json')
MODEL_QUOTA_PATH = os.path.join(DATA_DIR, 'model_quota.jsonl')

_SERVER_QUOTA_LOCK = threading.RLock()
_MODEL_QUOTE_LOCK = threading.RLock()


def _default_server_quota() -> Dict[str, Any]:
    return {
        'enabled': False,
        'total_tokens': 0,
        'warn_threshold_tokens': 0,
        'on_exhausted': 'disable_model',
        'provider_overage_actions': {},
        'updated_at': 0,
        'model_quotas': {},
    }


def _int_value(raw_value: Any) -> int:
    try:
        return max(0, int(float(raw_value or 0)))
    except Exception:
        return 0


def _normalize_on_exhausted_action(raw_value: Any) -> str:
    raw = str(raw_value or '').strip().lower()
    if raw in {'stop_model', 'stop', 'block'}:
        return 'disable_model'
    if raw in {'none', 'noop', 'no-op'}:
        return 'no_op'
    if raw in {'disable_model', 'notify_admin', 'disable_and_notify', 'no_op'}:
        return raw
    return 'disable_model'


def _normalize_provider_name(provider_name: Any) -> str:
    return str(provider_name or 'unknown').strip() or 'unknown'


def _normalize_model_name(model_name: Any) -> str:
    return str(model_name or 'unknown').strip() or 'unknown'


def _provider_equals(left: Any, right: Any) -> bool:
    l = _normalize_provider_name(left)
    r = _normalize_provider_name(right)
    if l == r:
        return True
    return l.lower() == r.lower()


def _resolve_catalog_provider_by_model(model_name: Any) -> str:
    model = _normalize_model_name(model_name)
    if model == 'unknown':
        return 'unknown'
    models_catalog = _read_models_catalog()
    model_info = models_catalog.get(model)
    if isinstance(model_info, dict):
        provider = _normalize_provider_name(model_info.get('provider'))
        if provider != 'unknown':
            return provider
    model_lower = model.lower()
    for model_id, model_info_any in models_catalog.items():
        if str(model_id or '').strip().lower() != model_lower:
            continue
        if not isinstance(model_info_any, dict):
            continue
        provider = _normalize_provider_name(model_info_any.get('provider'))
        if provider != 'unknown':
            return provider
    return 'unknown'


def _canonicalize_provider_for_model(provider_name: Any, model_name: Any) -> str:
    provider = _normalize_provider_name(provider_name)
    model = _normalize_model_name(model_name)
    catalog_provider = _resolve_catalog_provider_by_model(model)
    if catalog_provider != 'unknown':
        return catalog_provider
    return provider


def _model_quota_key(provider_name: Any, model_name: Any) -> str:
    return f"{_normalize_provider_name(provider_name)}::{_normalize_model_name(model_name)}"


def _split_model_quota_key(key: Any) -> List[str]:
    raw = str(key or '').strip()
    if not raw:
        return ['unknown', 'unknown']
    if '::' in raw:
        provider_name, model_name = raw.split('::', 1)
        return [_normalize_provider_name(provider_name), _normalize_model_name(model_name)]
    return ['unknown', _normalize_model_name(raw)]


def _normalize_model_quota_entry(raw_entry: Any, provider_hint: Any = None, model_hint: Any = None) -> Dict[str, Any]:
    entry = raw_entry if isinstance(raw_entry, dict) else {}
    model_name = _normalize_model_name(entry.get('model', model_hint))
    provider_name = _canonicalize_provider_for_model(entry.get('provider', provider_hint), model_name)
    total_tokens = _int_value(entry.get('total_tokens', entry.get('total', 0)))
    updated_at = _int_value(entry.get('updated_at', 0))
    return {
        'provider': provider_name,
        'model': model_name,
        'total_tokens': total_tokens,
        'updated_at': updated_at,
    }


def _normalize_model_quotas(raw_model_quotas: Any) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}

    if isinstance(raw_model_quotas, dict):
        for key, value in raw_model_quotas.items():
            provider_hint, model_hint = _split_model_quota_key(key)
            entry = _normalize_model_quota_entry(value, provider_hint=provider_hint, model_hint=model_hint)
            if entry['provider'] == 'unknown' or entry['model'] == 'unknown':
                continue
            quota_key = _model_quota_key(entry['provider'], entry['model'])
            out[quota_key] = entry
    elif isinstance(raw_model_quotas, list):
        for item in raw_model_quotas:
            entry = _normalize_model_quota_entry(item)
            if entry['provider'] == 'unknown' or entry['model'] == 'unknown':
                continue
            quota_key = _model_quota_key(entry['provider'], entry['model'])
            out[quota_key] = entry

    return out


def _normalize_provider_overage_actions(raw_actions: Any) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not isinstance(raw_actions, dict):
        return out

    for provider_name, action in raw_actions.items():
        provider = _normalize_provider_name(provider_name)
        if not provider or provider == 'unknown':
            continue
        out[provider] = _normalize_on_exhausted_action(action)
    return out


def _resolve_provider_on_exhausted_action(quota_like: Any, provider_name: Any) -> str:
    quota = quota_like if isinstance(quota_like, dict) else {}
    provider = _normalize_provider_name(provider_name)
    default_action = _normalize_on_exhausted_action(quota.get('on_exhausted'))
    raw_map = quota.get('provider_overage_actions', {})
    action_map = _normalize_provider_overage_actions(raw_map)

    action = action_map.get(provider)
    if action is None and provider:
        provider_lower = str(provider).strip().lower()
        for key, value in action_map.items():
            if str(key or '').strip().lower() == provider_lower:
                action = value
                break

    return _normalize_on_exhausted_action(action if action is not None else default_action)


def _normalize_server_quota_settings(quota: Any) -> Dict[str, Any]:
    quota_raw = quota if isinstance(quota, dict) else {}
    on_exhausted = _normalize_on_exhausted_action(quota_raw.get('on_exhausted'))
    model_quotas_raw = quota_raw.get('model_quotas') if isinstance(quota_raw.get('model_quotas'), (dict, list)) else {}
    provider_overage_actions_raw = quota_raw.get('provider_overage_actions') if isinstance(quota_raw.get('provider_overage_actions'), dict) else {}
    return {
        'enabled': bool(quota_raw.get('enabled', False)),
        'total_tokens': _int_value(quota_raw.get('total_tokens', 0)),
        'warn_threshold_tokens': _int_value(quota_raw.get('warn_threshold_tokens', 0)),
        'on_exhausted': on_exhausted,
        'provider_overage_actions': _normalize_provider_overage_actions(provider_overage_actions_raw),
        'updated_at': _int_value(quota_raw.get('updated_at', 0)),
        'model_quotas': _normalize_model_quotas(model_quotas_raw),
    }


def _extract_quota_state_from_record(raw_record: Any) -> Dict[str, Any]:
    if not isinstance(raw_record, dict):
        return {}
    record_type = str(raw_record.get('type', '') or '').strip().lower()
    if record_type != 'quota_state':
        return {}
    quota_raw = raw_record.get('quota', {})
    quota = _normalize_server_quota_settings(quota_raw)
    if quota.get('updated_at', 0) <= 0:
        quota['updated_at'] = _int_value(raw_record.get('timestamp', 0))
    return quota


def _append_quota_state_unlocked(quota: Dict[str, Any], source: str = 'update') -> Dict[str, Any]:
    normalized = _normalize_server_quota_settings(quota)
    now_ts = int(normalized.get('updated_at', 0) or time.time())
    normalized['updated_at'] = now_ts
    safe_append_jsonl(
        MODEL_QUOTA_PATH,
        {
            'type': 'quota_state',
            'timestamp': now_ts,
            'source': str(source or 'update').strip() or 'update',
            'quota': normalized,
        },
        lock=_MODEL_QUOTE_LOCK
    )
    return normalized


def _load_quota_state_from_store_unlocked() -> Dict[str, Any]:
    for record in safe_read_jsonl_tail(MODEL_QUOTA_PATH, limit=4096):
        quota = _extract_quota_state_from_record(record)
        if quota:
            return quota
    return {}


def _read_models_catalog() -> Dict[str, Dict[str, Any]]:
    raw = safe_read_json(MODELS_PATH, default={})
    if not isinstance(raw, dict):
        return {}
    models = raw.get('models', raw)
    if not isinstance(models, dict):
        return {}
    return models


def _append_model_quota_log_unlocked(log_item: Dict[str, Any]) -> None:
    payload = dict(log_item or {})
    payload['type'] = 'quota_change'
    os.makedirs(os.path.dirname(MODEL_QUOTA_PATH), exist_ok=True)
    safe_append_jsonl(MODEL_QUOTA_PATH, payload, lock=_MODEL_QUOTE_LOCK)


def get_model_quota_change_logs(limit: int = 120) -> List[Dict[str, Any]]:
    lim = max(1, min(int(limit or 120), 1000))
    result: List[Dict[str, Any]] = []
    for record in safe_read_jsonl_tail(MODEL_QUOTA_PATH, limit=max(lim * 8, 256)):
        if not isinstance(record, dict):
            continue
        record_type = str(record.get('type', '') or '').strip().lower()
        if record_type == 'quota_change':
            item = dict(record)
            item.pop('type', None)
            result.append(item)
        if len(result) >= lim:
            return result[:lim]
    return result[:lim]


def get_server_quota_config() -> Dict[str, Any]:
    with _SERVER_QUOTA_LOCK:
        quota = _load_quota_state_from_store_unlocked()
        if quota:
            return quota
        return _default_server_quota()


def update_server_quota_config(updates: Any) -> Dict[str, Any]:
    payload = updates if isinstance(updates, dict) else {}
    with _SERVER_QUOTA_LOCK:
        quota = get_server_quota_config()

        if 'enabled' in payload:
            quota['enabled'] = bool(payload.get('enabled'))
        if 'total_tokens' in payload:
            quota['total_tokens'] = _int_value(payload.get('total_tokens'))
        if 'warn_threshold_tokens' in payload:
            quota['warn_threshold_tokens'] = _int_value(payload.get('warn_threshold_tokens'))

        # Provider-scoped override: when provider is provided, on_exhausted updates that provider only.
        provider_name = str(payload.get('provider') or '').strip()
        if provider_name and 'on_exhausted' in payload:
            provider = _normalize_provider_name(provider_name)
            action = _normalize_on_exhausted_action(payload.get('on_exhausted'))
            action_map = _normalize_provider_overage_actions(quota.get('provider_overage_actions', {}))
            if provider and provider != 'unknown':
                action_map[provider] = action
            quota['provider_overage_actions'] = action_map
        elif 'on_exhausted' in payload:
            quota['on_exhausted'] = _normalize_on_exhausted_action(payload.get('on_exhausted'))

        if 'provider_overage_actions' in payload:
            merged_map = _normalize_provider_overage_actions(quota.get('provider_overage_actions', {}))
            incoming_map = _normalize_provider_overage_actions(payload.get('provider_overage_actions'))
            merged_map.update(incoming_map)
            quota['provider_overage_actions'] = merged_map

        if 'model_quotas' in payload:
            quota['model_quotas'] = _normalize_model_quotas(payload.get('model_quotas'))

        quota['updated_at'] = int(time.time())
        return _append_quota_state_unlocked(quota, source='admin_update')


def set_model_quota_total(
    provider_name: Any,
    model_name: Any,
    total_tokens: Any,
    actor: str = 'admin',
    reason: str = 'manual_set',
) -> Dict[str, Any]:
    model = _normalize_model_name(model_name)
    provider = _canonicalize_provider_for_model(provider_name, model)
    after_total = _int_value(total_tokens)
    now_ts = int(time.time())

    with _SERVER_QUOTA_LOCK:
        current_quota = get_server_quota_config()
        model_quotas = dict(current_quota.get('model_quotas', {}))
        quota_key = _model_quota_key(provider, model)
        before_total = _int_value(model_quotas.get(quota_key, {}).get('total_tokens', 0))

        # total_tokens == 0 is an explicit "blocked" quota state, not deletion.
        model_quotas[quota_key] = {
            'provider': provider,
            'model': model,
            'total_tokens': after_total,
            'updated_at': now_ts,
        }

        current_quota['model_quotas'] = model_quotas
        current_quota['updated_at'] = now_ts
        _append_quota_state_unlocked(current_quota, source='set_model_quota_total')

    delta_tokens = int(after_total - before_total)
    if delta_tokens != 0:
        log_item = {
            'timestamp': now_ts,
            'time': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(now_ts)),
            'actor': str(actor or 'admin').strip() or 'admin',
            'provider': provider,
            'model': model,
            'key': quota_key,
            'action': 'set',
            'reason': str(reason or 'manual_set').strip() or 'manual_set',
            'before_total_tokens': before_total,
            'after_total_tokens': after_total,
            'delta_tokens': delta_tokens,
        }
        _append_model_quota_log_unlocked(log_item)

    return {
        'provider': provider,
        'model': model,
        'key': quota_key,
        'before_total_tokens': before_total,
        'after_total_tokens': after_total,
        'delta_tokens': delta_tokens,
    }


def adjust_model_quota_total(
    provider_name: Any,
    model_name: Any,
    delta_tokens: Any,
    actor: str = 'admin',
    reason: str = 'manual_adjust',
) -> Dict[str, Any]:
    model = _normalize_model_name(model_name)
    provider = _canonicalize_provider_for_model(provider_name, model)

    try:
        delta = int(float(delta_tokens or 0))
    except Exception:
        delta = 0

    with _SERVER_QUOTA_LOCK:
        current_quota = get_server_quota_config()
        model_quotas = dict(current_quota.get('model_quotas', {}))
        quota_key = _model_quota_key(provider, model)
        before_total = _int_value(model_quotas.get(quota_key, {}).get('total_tokens', 0))
        after_total = max(0, before_total + delta)

    return set_model_quota_total(
        provider_name=provider,
        model_name=model,
        total_tokens=after_total,
        actor=actor,
        reason=reason,
    )


def _collect_usage_summary(model_quotas: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Any]:
    quota_map = model_quotas if isinstance(model_quotas, dict) else {}
    models_catalog = _read_models_catalog()
    total_tokens = 0
    total_requests = 0
    provider_map: Dict[str, Dict[str, Any]] = {}
    model_totals: Dict[str, Dict[str, Any]] = {}

    active_model_provider: Dict[str, str] = {}
    for model_id, model_info in models_catalog.items():
        model_name = _normalize_model_name(model_id)
        provider_name = _normalize_provider_name((model_info if isinstance(model_info, dict) else {}).get('provider'))
        if not model_name or model_name == 'unknown':
            continue
        if not provider_name or provider_name == 'unknown':
            continue
        active_model_provider[model_name] = provider_name

    def _resolve_active_provider(model_name: Any, provider_hint: Any = None) -> str:
        model = _normalize_model_name(model_name)
        if model in active_model_provider:
            return active_model_provider.get(model, 'unknown')
        return _normalize_provider_name(provider_hint)

    def _ensure_model_entry(provider_name: Any, model_name: Any) -> Dict[str, Any]:
        provider = _normalize_provider_name(provider_name)
        model = _normalize_model_name(model_name)
        if provider == 'unknown' or model == 'unknown':
            return {}
        provider = _resolve_active_provider(model, provider)
        if provider == 'unknown':
            return {}
        quota_key = _model_quota_key(provider, model)
        provider_entry = provider_map.setdefault(provider, {
            'name': provider,
            'tokens': 0,
            'requests': 0,
            'models': {},
        })
        return provider_entry['models'].setdefault(quota_key, {
            'key': quota_key,
            'name': model,
            'provider': provider,
            'tokens': 0,
            'requests': 0,
        })

    user_root = os.path.join(DATA_DIR, 'users')
    if os.path.exists(user_root):
        for username in os.listdir(user_root):
            token_file = os.path.join(user_root, username, 'token_usage.json')
            if not os.path.exists(token_file):
                continue
            logs = safe_read_json(token_file, default=[])
            if not isinstance(logs, list):
                continue

            for log in logs:
                if not isinstance(log, dict):
                    continue
                input_tokens = _int_value(log.get('input_tokens', 0))
                output_tokens = _int_value(log.get('output_tokens', 0))
                total = log.get('total_tokens')
                if total is None:
                    total = input_tokens + output_tokens
                total = _int_value(total)

                model = _normalize_model_name(log.get('model'))
                provider = _resolve_active_provider(model, log.get('provider'))
                quota_key = _model_quota_key(provider, model)

                total_tokens += total
                total_requests += 1

                if provider == 'unknown' or model == 'unknown':
                    continue

                provider_entry = provider_map.setdefault(provider, {
                    'name': provider,
                    'tokens': 0,
                    'requests': 0,
                    'models': {},
                })
                provider_entry['tokens'] += total
                provider_entry['requests'] += 1

                model_entry = provider_entry['models'].setdefault(quota_key, {
                    'key': quota_key,
                    'name': model,
                    'provider': provider,
                    'tokens': 0,
                    'requests': 0,
                })
                model_entry['tokens'] += total
                model_entry['requests'] += 1

                global_model = model_totals.setdefault(quota_key, {
                    'key': quota_key,
                    'name': model,
                    'provider': provider,
                    'tokens': 0,
                    'requests': 0,
                })
                global_model['tokens'] += total
                global_model['requests'] += 1

    # 把模型配置中的模型也并入，便于即使没产生调用也可以直接配额。
    for model_id, model_info in models_catalog.items():
        provider = _normalize_provider_name((model_info if isinstance(model_info, dict) else {}).get('provider'))
        model_entry = _ensure_model_entry(provider, model_id)
        if not isinstance(model_entry, dict) or not model_entry:
            continue

    # 把纯配额中存在但暂无调用和模型配置的项并入。
    for quota_key, quota_entry in quota_map.items():
        if not isinstance(quota_entry, dict):
            continue
        provider = _normalize_provider_name(quota_entry.get('provider'))
        model = _normalize_model_name(quota_entry.get('model'))
        if _model_quota_key(provider, model) != quota_key:
            provider_hint, model_hint = _split_model_quota_key(quota_key)
            provider = _normalize_provider_name(provider or provider_hint)
            model = _normalize_model_name(model or model_hint)
        provider = _resolve_active_provider(model, provider)
        model_entry = _ensure_model_entry(provider, model)
        if not isinstance(model_entry, dict) or not model_entry:
            continue

    provider_list: List[Dict[str, Any]] = []
    model_status_map: Dict[str, Dict[str, Any]] = {}
    model_quota_total_tokens = 0
    model_quota_overage_tokens = 0

    for provider_name, provider_entry in provider_map.items():
        model_rows: List[Dict[str, Any]] = []
        provider_max_overage = 0
        provider_quota_total_tokens = 0

        for model_entry in provider_entry.get('models', {}).values():
            quota_key = model_entry.get('key', _model_quota_key(provider_name, model_entry.get('name')))
            quota_defined = bool(isinstance(quota_map, dict) and (quota_key in quota_map))
            quota_entry = quota_map.get(quota_key, {}) if isinstance(quota_map, dict) else {}
            quota_total = _int_value((quota_entry if isinstance(quota_entry, dict) else {}).get('total_tokens', 0))
            used = _int_value(model_entry.get('tokens', 0))
            if quota_defined:
                overage = used if quota_total <= 0 else max(0, used - quota_total)
                remaining = quota_total - used
                usage_ratio = round((used / quota_total), 6) if quota_total > 0 else None
                is_exhausted = bool(quota_total <= 0 or used >= quota_total)
            else:
                overage = 0
                remaining = None
                usage_ratio = None
                is_exhausted = False

            row = {
                'key': quota_key,
                'provider': _normalize_provider_name(model_entry.get('provider', provider_name)),
                'name': _normalize_model_name(model_entry.get('name')),
                'tokens': used,
                'requests': _int_value(model_entry.get('requests', 0)),
                'quota_total_tokens': quota_total,
                'quota_set': quota_defined,
                'remaining_tokens': remaining,
                'overage_tokens': overage,
                'usage_ratio': usage_ratio,
                'is_exhausted': is_exhausted,
                'updated_at': _int_value((quota_entry if isinstance(quota_entry, dict) else {}).get('updated_at', 0)),
            }
            model_rows.append(row)
            model_status_map[quota_key] = row

            provider_max_overage = max(provider_max_overage, overage)
            provider_quota_total_tokens += quota_total
            model_quota_total_tokens += quota_total
            model_quota_overage_tokens += overage

        model_rows.sort(key=lambda row: row.get('tokens', 0), reverse=True)

        provider_list.append({
            'name': provider_name,
            'tokens': _int_value(provider_entry.get('tokens', 0)),
            'requests': _int_value(provider_entry.get('requests', 0)),
            'models': model_rows,
            'quota_total_tokens': provider_quota_total_tokens,
            'max_model_overage_tokens': provider_max_overage,
        })

    provider_list.sort(key=lambda row: row.get('tokens', 0), reverse=True)

    top_models = sorted(
        list(model_totals.values()),
        key=lambda row: row.get('tokens', 0),
        reverse=True,
    )[:20]

    return {
        'total_tokens': total_tokens,
        'total_requests': total_requests,
        'providers': provider_list,
        'top_models': top_models,
        'model_status_map': model_status_map,
        'model_quota_total_tokens': model_quota_total_tokens,
        'model_quota_overage_tokens': model_quota_overage_tokens,
    }


def get_server_quota_status() -> Dict[str, Any]:
    quota = get_server_quota_config()
    usage = _collect_usage_summary(model_quotas=quota.get('model_quotas', {}))
    total_tokens = int(quota.get('total_tokens', 0) or 0)
    used_tokens = int(usage.get('total_tokens', 0) or 0)
    remaining_tokens = total_tokens - used_tokens
    overage_tokens = max(0, -remaining_tokens)
    usage_ratio = round((used_tokens / total_tokens), 6) if total_tokens > 0 else 0.0
    warn_threshold = int(quota.get('warn_threshold_tokens', 0) or 0)
    enabled = bool(quota.get('enabled', False))
    exhausted = bool(enabled and total_tokens > 0 and remaining_tokens <= 0)
    on_exhausted = _normalize_on_exhausted_action(quota.get('on_exhausted'))
    provider_overage_actions = _normalize_provider_overage_actions(quota.get('provider_overage_actions', {}))
    disable_action = on_exhausted in {'disable_model', 'disable_and_notify'}
    notify_action = on_exhausted in {'notify_admin', 'disable_and_notify'}

    model_status_map = usage.get('model_status_map', {}) if isinstance(usage.get('model_status_map'), dict) else {}
    model_exhausted_items: List[Dict[str, Any]] = []
    provider_disable_exhausted_count = 0
    provider_notify_exhausted_count = 0

    for row in model_status_map.values():
        if not isinstance(row, dict):
            continue
        provider_name = _normalize_provider_name(row.get('provider'))
        provider_action = _resolve_provider_on_exhausted_action(quota, provider_name)
        row['on_exhausted'] = provider_action
        if not bool(row.get('is_exhausted')):
            continue
        model_exhausted_items.append(row)
        if provider_action in {'disable_model', 'disable_and_notify'}:
            provider_disable_exhausted_count += 1
        if provider_action in {'notify_admin', 'disable_and_notify'}:
            provider_notify_exhausted_count += 1

    providers = usage.get('providers', []) if isinstance(usage.get('providers'), list) else []
    for provider_row in providers:
        if not isinstance(provider_row, dict):
            continue
        provider_name = _normalize_provider_name(provider_row.get('name'))
        provider_row['on_exhausted'] = _resolve_provider_on_exhausted_action(quota, provider_name)

    return {
        'enabled': enabled,
        'total_tokens': total_tokens,
        'warn_threshold_tokens': warn_threshold,
        'on_exhausted': on_exhausted,
        'provider_overage_actions': provider_overage_actions,
        'updated_at': int(quota.get('updated_at', 0) or 0),
        'used_tokens': used_tokens,
        'remaining_tokens': remaining_tokens,
        'overage_tokens': overage_tokens,
        'usage_ratio': usage_ratio,
        'is_low': bool(enabled and total_tokens > 0 and remaining_tokens > 0 and warn_threshold > 0 and remaining_tokens <= warn_threshold),
        'is_exhausted': exhausted,
        'should_block_model': bool(enabled and ((disable_action and exhausted) or provider_disable_exhausted_count > 0)),
        'notify_on_exhausted': bool(enabled and ((notify_action and exhausted) or provider_notify_exhausted_count > 0)),
        'providers': providers,
        'top_models': usage['top_models'],
        'total_requests': int(usage.get('total_requests', 0) or 0),
        'model_status_map': model_status_map,
        'model_quota_total_tokens': int(usage.get('model_quota_total_tokens', 0) or 0),
        'model_quota_overage_tokens': int(usage.get('model_quota_overage_tokens', 0) or 0),
        'model_exhausted_count': len(model_exhausted_items),
        'model_disable_exhausted_count': provider_disable_exhausted_count,
        'model_notify_exhausted_count': provider_notify_exhausted_count,
        'model_quote_logs': get_model_quota_change_logs(limit=160),
    }


def get_generation_quota_gate(provider_name: Optional[str] = None, model_name: Optional[str] = None) -> Dict[str, Any]:
    status = get_server_quota_status()
    enabled = bool(status.get('enabled', False))
    global_on_exhausted = _normalize_on_exhausted_action(status.get('on_exhausted'))
    model = _normalize_model_name(model_name)
    provider = _canonicalize_provider_for_model(provider_name, model)
    quota_key = _model_quota_key(provider, model)
    provider_on_exhausted = _resolve_provider_on_exhausted_action(status, provider)

    model_status_map = status.get('model_status_map', {}) if isinstance(status.get('model_status_map'), dict) else {}
    model_status = model_status_map.get(quota_key, {}) if isinstance(model_status_map.get(quota_key), dict) else {}
    if (not model_status) and model != 'unknown':
        matched_rows = [
            row for row in model_status_map.values()
            if isinstance(row, dict) and _normalize_model_name(row.get('name')) == model
        ]
        if provider != 'unknown':
            provider_rows = [
                row for row in matched_rows
                if _provider_equals(row.get('provider'), provider)
            ]
            if provider_rows:
                model_status = provider_rows[0]
                provider = _normalize_provider_name(model_status.get('provider'))
                quota_key = _model_quota_key(provider, model)
                provider_on_exhausted = _resolve_provider_on_exhausted_action(status, provider)
        elif len(matched_rows) == 1:
            model_status = matched_rows[0]
            provider = _normalize_provider_name(model_status.get('provider'))
            quota_key = _model_quota_key(provider, model)
            provider_on_exhausted = _resolve_provider_on_exhausted_action(status, provider)
    # Fallback: if usage summary did not include this model row (e.g. model absent from
    # models catalog on some deployments), synthesize model_status from configured model quota.
    if (not model_status) and model != 'unknown':
        quota_cfg = get_server_quota_config()
        model_quota_map = quota_cfg.get('model_quotas', {}) if isinstance(quota_cfg.get('model_quotas'), dict) else {}
        direct_row = model_quota_map.get(quota_key)
        if not isinstance(direct_row, dict):
            strict_rows = [
                row for row in model_quota_map.values()
                if (
                    isinstance(row, dict)
                    and _normalize_model_name(row.get('model')) == model
                    and provider != 'unknown'
                    and _provider_equals(row.get('provider'), provider)
                )
            ]
            if strict_rows:
                direct_row = strict_rows[0]
            elif provider == 'unknown':
                candidate_rows = [
                    row for row in model_quota_map.values()
                    if isinstance(row, dict) and _normalize_model_name(row.get('model')) == model
                ]
                if len(candidate_rows) == 1:
                    direct_row = candidate_rows[0]
        if isinstance(direct_row, dict):
            provider = _normalize_provider_name(direct_row.get('provider', provider))
            quota_key = _model_quota_key(provider, model)
            provider_on_exhausted = _resolve_provider_on_exhausted_action(status, provider)
            quota_total = _int_value(direct_row.get('total_tokens', 0))
            model_status = {
                'key': quota_key,
                'provider': provider,
                'name': model,
                'tokens': 0,
                'requests': 0,
                'quota_total_tokens': quota_total,
                'quota_set': True,
                'remaining_tokens': quota_total,
                'overage_tokens': 0,
                'usage_ratio': 0.0 if quota_total > 0 else None,
                'is_exhausted': bool(quota_total <= 0),
                'updated_at': _int_value(direct_row.get('updated_at', 0)),
            }
    # Rule: when quota is enabled, missing model quota is treated as 0 (hard stop).
    # This enforces "unset == 0" consistently at generation gate.
    if enabled:
        if isinstance(model_status, dict) and model_status:
            if not bool(model_status.get('quota_set')):
                used_tokens = _int_value(model_status.get('tokens', 0))
                model_status = {
                    'key': _model_quota_key(provider, model),
                    'provider': provider,
                    'name': model,
                    'tokens': used_tokens,
                    'requests': _int_value(model_status.get('requests', 0)),
                    'quota_total_tokens': 0,
                    'quota_set': False,
                    'remaining_tokens': -used_tokens,
                    'overage_tokens': used_tokens,
                    'usage_ratio': None,
                    'is_exhausted': True,
                    'updated_at': _int_value(model_status.get('updated_at', 0)),
                }
        elif model != 'unknown':
            model_status = {
                'key': _model_quota_key(provider, model),
                'provider': provider,
                'name': model,
                'tokens': 0,
                'requests': 0,
                'quota_total_tokens': 0,
                'quota_set': False,
                'remaining_tokens': 0,
                'overage_tokens': 0,
                'usage_ratio': None,
                'is_exhausted': True,
                'updated_at': 0,
            }

    model_exhausted = bool(model_status.get('is_exhausted'))
    global_exhausted = bool(status.get('is_exhausted'))
    global_disable_action = global_on_exhausted in {'disable_model', 'disable_and_notify'}
    global_notify_action = global_on_exhausted in {'notify_admin', 'disable_and_notify'}
    provider_disable_action = provider_on_exhausted in {'disable_model', 'disable_and_notify'}
    provider_notify_action = provider_on_exhausted in {'notify_admin', 'disable_and_notify'}
    should_disable_model = bool(enabled and provider_disable_action and model_exhausted)
    should_notify_admin = bool(enabled and ((provider_notify_action and model_exhausted) or (global_notify_action and global_exhausted)))
    should_block = bool(enabled and ((global_disable_action and global_exhausted) or (provider_disable_action and model_exhausted)))

    reason = ''
    if should_block:
        if model_exhausted and provider_disable_action:
            reason = 'model_exhausted'
        elif global_exhausted and global_disable_action:
            reason = 'global_exhausted'

    return {
        'enabled': enabled,
        'provider': provider,
        'model': model,
        'key': quota_key,
        'on_exhausted': provider_on_exhausted,
        'provider_on_exhausted': provider_on_exhausted,
        'global_on_exhausted': global_on_exhausted,
        'reason': reason,
        'should_block': should_block,
        'should_disable_model': should_disable_model,
        'should_notify_admin': should_notify_admin,
        'global_exhausted': global_exhausted,
        'model_exhausted': model_exhausted,
        'model_status': model_status,
        'quota': status,
    }


def is_stopped(provider_name: Optional[str] = None, model_name: Optional[str] = None) -> bool:
    gate = get_generation_quota_gate(provider_name=provider_name, model_name=model_name)
    return bool(gate.get('enabled') and gate.get('should_block'))


def is_quota_stopped() -> bool:
    return is_stopped()
