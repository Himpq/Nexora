"""
Nexora.App.Observability.stats — 状态总览与用量统计路由（自 server.py 分批迁移）

本批次迁入：token 日志对账（/api/user/token-logs/reconcile、
/api/admin/status/token-logs/reconcile）及其直接辅助函数。
状态总览、图标/模型归一化等其余统计簇在后续批次继续迁入。

数据文件与 server.py 顶部常量同源（ChatDBServer/data/...），按本包
notification.py 的定位方式从模块位置推导，不反向 import server。
"""

import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from flask import Blueprint, jsonify, request, session

from App.Utils import resolve_configured_path, safe_join_path
from basis.Permission import require_admin, require_login
from basis.TokenUsage import is_usage_log_path, read_usage_log_records, replace_usage_log_records
from basis.User import load_users, save_users

stats_bp = Blueprint('observability_stats', __name__)

# 与 server.py 顶部常量同源的数据文件路径（ChatDBServer 根 = 本文件向上 4 级）
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DATA_RES_DIR = os.path.join(BASE_DIR, 'data', 'res')
STATUS_PROVIDER_ICON_MAP_PATH = os.path.join(DATA_RES_DIR, 'provider_icon_map.json')
OPENROUTER_MODELS_SNAPSHOT_LEGACY_PATH = os.path.join(BASE_DIR, 'data', 'openrouter_models_snapshot.json')
OPENROUTER_MODELS_SNAPSHOT_PATH = os.path.join(DATA_RES_DIR, 'openrouter_models_snapshot.json')


def _safe_int_status(value: Any, default: int = 0) -> int:
    try:
        return int(value or 0)
    except Exception:
        return int(default or 0)


def _read_json_list_safe(path: str) -> List[Dict[str, Any]]:
    if is_usage_log_path(path):
        return read_usage_log_records(path)

    if not os.path.exists(path):
        return []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _status_resolve_user_path(username: str, users_meta: Optional[Dict[str, Any]] = None) -> str:
    uname = str(username or '').strip()
    default_path = safe_join_path(BASE_DIR, 'data', 'users', uname) if uname else safe_join_path(BASE_DIR, 'data', 'users')
    if not uname:
        return default_path
    try:
        users = users_meta if isinstance(users_meta, dict) else load_users()
    except Exception:
        users = {}
    user_data = users.get(uname, {}) if isinstance(users, dict) else {}
    raw_path = str(user_data.get('path') or '').strip() if isinstance(user_data, dict) else ''
    if not raw_path:
        return default_path
    project_root = BASE_DIR
    return resolve_configured_path(project_root, raw_path, fallback=default_path)


def _status_existing_conversation_ids(user_path: str) -> Set[str]:
    conv_ids: Set[str] = set()
    conv_dir = safe_join_path(user_path, 'conversations')
    if not os.path.isdir(conv_dir):
        return conv_ids
    for filename in os.listdir(conv_dir):
        if not filename.endswith('.json'):
            continue
        conv_ids.add(str(filename[:-5]).strip())
    return conv_ids


def _status_normalize_token_log_entry(raw: Dict[str, Any]) -> Dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    log = dict(src)
    input_tokens = _safe_int_status(log.get('input_tokens', 0))
    output_tokens = _safe_int_status(log.get('output_tokens', 0))
    total_raw = log.get('total_tokens', None)
    if total_raw is None:
        total_tokens = input_tokens + output_tokens
    else:
        total_tokens = _safe_int_status(total_raw, input_tokens + output_tokens)
    log['input_tokens'] = input_tokens
    log['output_tokens'] = output_tokens
    log['total_tokens'] = total_tokens
    log['conversation_id'] = str(log.get('conversation_id') or '').strip()
    log['timestamp'] = str(log.get('timestamp') or '').strip()
    log['action'] = str(log.get('action') or 'chat').strip() or 'chat'
    log['provider'] = str(log.get('provider') or 'unknown').strip() or 'unknown'
    log['model'] = str(log.get('model') or 'unknown').strip() or 'unknown'
    return log


def _reconcile_user_token_logs(
    username: str,
    user_path: str,
    drop_orphans: bool = True,
    drop_zero_tokens: bool = True,
    dedupe: bool = True,
    write_back: bool = True,
    update_user_meta: bool = True
) -> Dict[str, Any]:
    uname = str(username or '').strip()
    token_file = safe_join_path(user_path, 'token_usage.json')
    original_logs = _read_json_list_safe(token_file)
    existing_conv_ids = _status_existing_conversation_ids(user_path)

    report = {
        'username': uname,
        'token_file': token_file,
        'before_count': 0,
        'after_count': 0,
        'before_total_tokens': 0,
        'after_total_tokens': 0,
        'removed_invalid': 0,
        'removed_orphan': 0,
        'removed_zero': 0,
        'deduped_dropped': 0,
        'changed': False,
        'write_back': bool(write_back),
        'drop_orphans': bool(drop_orphans),
        'drop_zero_tokens': bool(drop_zero_tokens),
        'dedupe': bool(dedupe)
    }

    normalized_before: List[Dict[str, Any]] = []
    for item in original_logs:
        if not isinstance(item, dict):
            report['removed_invalid'] += 1
            continue
        normalized = _status_normalize_token_log_entry(item)
        normalized_before.append(normalized)

    report['before_count'] = len(normalized_before)
    report['before_total_tokens'] = sum(_safe_int_status(item.get('total_tokens', 0)) for item in normalized_before)

    filtered_logs: List[Dict[str, Any]] = []
    for item in normalized_before:
        conv_id = str(item.get('conversation_id') or '').strip()
        total = _safe_int_status(item.get('total_tokens', 0))
        input_tokens = _safe_int_status(item.get('input_tokens', 0))
        output_tokens = _safe_int_status(item.get('output_tokens', 0))
        if drop_orphans and conv_id and conv_id not in existing_conv_ids:
            report['removed_orphan'] += 1
            continue
        if drop_zero_tokens and total <= 0 and input_tokens <= 0 and output_tokens <= 0:
            report['removed_zero'] += 1
            continue
        filtered_logs.append(item)

    result_logs: List[Dict[str, Any]] = filtered_logs
    if dedupe:
        slot_by_key: Dict[str, Tuple[int, Dict[str, Any]]] = {}
        key_order: List[str] = []
        for idx, item in enumerate(filtered_logs):
            key = '|'.join([
                str(item.get('conversation_id') or ''),
                str(item.get('timestamp') or ''),
                str(item.get('action') or ''),
                str(item.get('provider') or ''),
                str(item.get('model') or '')
            ])
            if key not in slot_by_key:
                slot_by_key[key] = (idx, item)
                key_order.append(key)
                continue
            prev_idx, prev_item = slot_by_key[key]
            prev_total = _safe_int_status(prev_item.get('total_tokens', 0))
            now_total = _safe_int_status(item.get('total_tokens', 0))
            if now_total >= prev_total:
                slot_by_key[key] = (idx, item)
            report['deduped_dropped'] += 1
        result_logs = [slot_by_key[key][1] for key in key_order if key in slot_by_key]

    report['after_count'] = len(result_logs)
    report['after_total_tokens'] = sum(_safe_int_status(item.get('total_tokens', 0)) for item in result_logs)

    report['changed'] = (
        report['after_count'] != report['before_count'] or
        report['after_total_tokens'] != report['before_total_tokens'] or
        report['removed_invalid'] > 0 or
        report['removed_orphan'] > 0 or
        report['removed_zero'] > 0 or
        report['deduped_dropped'] > 0
    )

    if write_back:
        try:
            os.makedirs(os.path.dirname(token_file), exist_ok=True)
            replace_usage_log_records(token_file, result_logs, indent=4)
        except Exception as e:
            report['write_error'] = str(e)

    if write_back and update_user_meta:
        try:
            users = load_users()
            if isinstance(users, dict) and uname in users and isinstance(users.get(uname), dict):
                users[uname]['token_usage'] = report['after_total_tokens']
                save_users(users)
        except Exception as e:
            report['meta_update_error'] = str(e)

    return report


@stats_bp.route('/api/user/token-logs/reconcile', methods=['POST'])
@require_login
def reconcile_current_user_token_logs_api():
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401
    data = request.get_json(silent=True) or {}
    dry_run = bool(data.get('dry_run', False))
    drop_orphans = bool(data.get('drop_orphans', True))
    drop_zero_tokens = bool(data.get('drop_zero_tokens', True))
    dedupe = bool(data.get('dedupe', True))

    try:
        users = load_users()
        user_path = _status_resolve_user_path(username, users_meta=users)
        report = _reconcile_user_token_logs(
            username=username,
            user_path=user_path,
            drop_orphans=drop_orphans,
            drop_zero_tokens=drop_zero_tokens,
            dedupe=dedupe,
            write_back=not dry_run,
            update_user_meta=not dry_run
        )
        return jsonify({'success': True, 'report': report})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@stats_bp.route('/api/admin/status/token-logs/reconcile', methods=['POST'])
@require_admin
def reconcile_all_user_token_logs_api():
    data = request.get_json(silent=True) or {}
    dry_run = bool(data.get('dry_run', False))
    drop_orphans = bool(data.get('drop_orphans', True))
    drop_zero_tokens = bool(data.get('drop_zero_tokens', True))
    dedupe = bool(data.get('dedupe', True))
    targets = data.get('usernames')

    try:
        users = load_users()
        usernames = []
        if isinstance(targets, list) and targets:
            usernames = [str(x).strip() for x in targets if str(x).strip()]
        if not usernames:
            usernames = list(users.keys()) if isinstance(users, dict) else []

        reports = []
        for uname in usernames:
            user_path = _status_resolve_user_path(uname, users_meta=users)
            reports.append(_reconcile_user_token_logs(
                username=uname,
                user_path=user_path,
                drop_orphans=drop_orphans,
                drop_zero_tokens=drop_zero_tokens,
                dedupe=dedupe,
                write_back=not dry_run,
                update_user_meta=not dry_run
            ))

        summary = {
            'users': len(reports),
            'before_count': sum(_safe_int_status(r.get('before_count', 0)) for r in reports),
            'after_count': sum(_safe_int_status(r.get('after_count', 0)) for r in reports),
            'before_total_tokens': sum(_safe_int_status(r.get('before_total_tokens', 0)) for r in reports),
            'after_total_tokens': sum(_safe_int_status(r.get('after_total_tokens', 0)) for r in reports),
            'removed_orphan': sum(_safe_int_status(r.get('removed_orphan', 0)) for r in reports),
            'removed_zero': sum(_safe_int_status(r.get('removed_zero', 0)) for r in reports),
            'deduped_dropped': sum(_safe_int_status(r.get('deduped_dropped', 0)) for r in reports)
        }
        return jsonify({'success': True, 'summary': summary, 'reports': reports})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


# ==================== 图标表与模型/供应商归一化（B2a 批次迁入） ====================

DEFAULT_STATUS_PROVIDER_ICON_MAP = {
    'github': '',
    'alibabacloud': '/static/img/Index/static/icons/aliyun.png',
    'aliyun': '/static/img/icons/tongyi_single_icon.png',
    'bytedance': '/static/img/icons/volcengine_single_icon.svg',
    'volcengine': '/static/img/icons/volcengine_single_icon.svg',
    'qq': '/static/img/icons/tencent_cloud_single_icon.svg',
    'wechat': '/static/img/icons/tencent_cloud_single_icon.svg',
    'tencent': '/static/img/icons/tencent_cloud_single_icon.svg',
    'deepseek': '/static/img/icons/deepseek_single_icon.svg',
    'openai': '/static/img/icons/openai_single_icon.svg',
    'stepfun': '/static/img/icons/stepfun_single_icon.png',
    'moonshot': '/static/img/icons/kimi_single_icon.png',
    'kimi': '/static/img/icons/kimi_single_icon.png',
    'minimax': '/static/img/icons/minimax_single_icon.png',
    'siliconflow': '/static/img/icons/siliconflow_single_icon.svg',
    'openrouter': '/static/img/icons/openrouter_single_icon.svg',
    'xunfei': '/static/img/icons/xunfei_spark_single_icon.svg',
    'spark': '/static/img/icons/xunfei_spark_single_icon.svg',
    'hunyuan': '/static/img/icons/hunyuan_single_icon.png',
    'ollama': '/static/img/icons/ollama_single_icon.svg',
    'nvidia': '/static/img/icons/nvidia.svg',
    'zhipu': '/static/img/icons/zhipu_single_icon.svg',
    'zhipuai': '/static/img/icons/zhipu_single_icon.svg',
    'zai': '/static/img/icons/zhipu_single_icon.svg',
    'bigmodel': '/static/img/icons/zhipu_single_icon.svg'
}


def _load_status_provider_icon_map() -> Dict[str, str]:
    file_map: Dict[str, str] = {}
    try:
        if os.path.exists(STATUS_PROVIDER_ICON_MAP_PATH):
            payload = json.loads(Path(STATUS_PROVIDER_ICON_MAP_PATH).read_text(encoding='utf-8'))
            if isinstance(payload, dict) and isinstance(payload.get('icons'), dict):
                payload = payload.get('icons')
            if isinstance(payload, dict):
                for k, v in payload.items():
                    key = str(k or '').strip().lower()
                    if not key:
                        continue
                    file_map[key] = str(v or '').strip()
    except Exception:
        file_map = {}

    merged = dict(DEFAULT_STATUS_PROVIDER_ICON_MAP)
    merged.update(file_map)

    # 首次启动自动落盘，便于统一在 data/res 管理。
    try:
        os.makedirs(os.path.dirname(STATUS_PROVIDER_ICON_MAP_PATH), exist_ok=True)
        if not os.path.exists(STATUS_PROVIDER_ICON_MAP_PATH):
            Path(STATUS_PROVIDER_ICON_MAP_PATH).write_text(
                json.dumps({"icons": merged}, ensure_ascii=False, indent=2),
                encoding='utf-8'
            )
    except Exception:
        pass
    return merged


STATUS_PROVIDER_ICON_MAP = _load_status_provider_icon_map()


def _status_provider_icon(provider: str) -> str:
    p = str(provider or '').strip().lower()
    return STATUS_PROVIDER_ICON_MAP.get(p, '')


def _status_normalize_latency_ms(value: Any, output_tokens: int = 0, duration_hint_ms: int = 0, for_ttft: bool = False) -> int:
    """
    Normalize mixed latency units (seconds/ms) into milliseconds.
    Some historical logs may store seconds in *_ms fields.
    """
    try:
        v = float(value)
    except Exception:
        return 0
    if not (v > 0):
        return 0
    # Very small values are almost certainly seconds.
    if v < 1.0:
        return max(1, int(round(v * 1000.0)))
    is_int_like = abs(v - round(v)) < 1e-6
    # Decimal small numbers are commonly seconds (e.g. 2.4 -> 2400ms).
    if (not is_int_like) and v < 120.0:
        return max(1, int(round(v * 1000.0)))
    # Duration with very small value but large output is likely seconds.
    if (not for_ttft) and v <= 30.0 and int(output_tokens or 0) >= 128:
        return max(1, int(round(v * 1000.0)))
    # TTFT tiny integer while duration is already very large usually means seconds.
    if for_ttft and v <= 10.0 and int(duration_hint_ms or 0) >= 1000:
        return max(1, int(round(v * 1000.0)))
    return max(1, int(round(v)))


_STATUS_OPENROUTER_MODEL_CACHE: Dict[str, Any] = {
    'mtime': None,
    'alias_to_canonical': {},
    'canonical_meta': {}
}
_STATUS_PROVIDER_ALIAS_MAP = {
    'bytedance-seed': 'volcengine',
    'byte': 'volcengine',
    'siliconflow': 'siliconflow',
    'azure': 'openai',
    'zhipuai': 'zhipu',
    'zai': 'zhipu',
    'bigmodel': 'zhipu'
}


def _status_normalize_provider(provider: str) -> str:
    p = str(provider or '').strip().lower()
    if not p:
        return 'unknown'
    return _STATUS_PROVIDER_ALIAS_MAP.get(p, p)


def _status_extract_model_leaf(raw_model: str) -> str:
    src = str(raw_model or '').strip()
    if not src:
        return ''
    out = src.split('?', 1)[0].strip()
    if '/' in out and not out.startswith('http'):
        out = out.split('/', 1)[1].strip()
    if ':' in out:
        head, tail = out.rsplit(':', 1)
        if str(tail or '').strip().lower() in {'free', 'beta', 'alpha', 'preview', 'latest'}:
            out = head.strip()
    return out.strip()


def _status_normalize_model_key(raw_model: str) -> str:
    leaf = _status_extract_model_leaf(raw_model)
    s = str(leaf or '').strip().lower()
    if not s:
        return 'unknown'
    s = s.replace('（', '(').replace('）', ')')
    s = re.sub(r'[\[\]{}()]+', '-', s)
    s = re.sub(r'[_.\s/]+', '-', s)
    # qwen3.5 / gpt5 这类前缀+版本号，补齐分隔符；保留 v3.2 这种写法。
    s = re.sub(r'^(qwen|gpt|gemini|claude|mistral|deepseek|kimi|glm|step|doubao)(?=\d)', r'\1-', s)
    # 去掉常见日期后缀，例如 -251201 / -20251201。
    s = re.sub(r'-(?:\d{6}|\d{8})$', '', s)
    s = re.sub(r'-+', '-', s).strip('-')
    if s.startswith('bytedance-seed-'):
        s = f"doubao-seed-{s[len('bytedance-seed-'):]}"
    elif s.startswith('seed-'):
        s = f"doubao-seed-{s[len('seed-'):]}"
    return s or 'unknown'


def _status_release_stem(key: str) -> str:
    s = str(key or '').strip().lower()
    if not s:
        return ''
    patterns = [
        r'-(?:\d{4}-\d{2}-\d{2})$',
        r'-(?:\d{2}-\d{2})$',
        r'-(?:\d{8}|\d{6})$',
        r'-(?:\d{4}|\d{3})$',
        r'-(?:preview|beta|alpha|latest)$'
    ]
    while True:
        changed = False
        for pat in patterns:
            nxt = re.sub(pat, '', s, flags=re.IGNORECASE).strip('-')
            if nxt and nxt != s:
                s = nxt
                changed = True
                break
        if not changed:
            break
    return s


def _status_strip_release_suffix_for_display(name: str) -> str:
    s = str(name or '').strip()
    if not s:
        return ''
    patterns = [
        r'[-_.](?:\d{4}[-_.]\d{2}[-_.]\d{2})$',
        r'[-_.](?:\d{2}[-_.]\d{2})$',
        r'[-_.](?:\d{8}|\d{6})$',
        r'[-_.](?:\d{4}|\d{3})$',
        r'[-_.](?:preview|beta|alpha|latest)$'
    ]
    while True:
        changed = False
        for pat in patterns:
            nxt = re.sub(pat, '', s, flags=re.IGNORECASE).strip('-_.')
            if nxt and nxt != s:
                s = nxt
                changed = True
                break
        if not changed:
            break
    return s or str(name or '').strip()


def _load_status_openrouter_model_index() -> Tuple[Dict[str, str], Dict[str, Dict[str, str]]]:
    path = OPENROUTER_MODELS_SNAPSHOT_PATH
    if (not os.path.exists(path)) and os.path.exists(OPENROUTER_MODELS_SNAPSHOT_LEGACY_PATH):
        path = OPENROUTER_MODELS_SNAPSHOT_LEGACY_PATH
    try:
        mtime = os.path.getmtime(path)
    except Exception:
        mtime = None
    if _STATUS_OPENROUTER_MODEL_CACHE.get('mtime') == mtime:
        alias_to_canonical = _STATUS_OPENROUTER_MODEL_CACHE.get('alias_to_canonical') or {}
        canonical_meta = _STATUS_OPENROUTER_MODEL_CACHE.get('canonical_meta') or {}
        if isinstance(alias_to_canonical, dict) and isinstance(canonical_meta, dict):
            return alias_to_canonical, canonical_meta

    alias_to_canonical: Dict[str, str] = {}
    canonical_meta: Dict[str, Dict[str, str]] = {}
    try:
        payload = json.loads(Path(path).read_text(encoding='utf-8'))
        rows = payload.get('data', []) if isinstance(payload, dict) else []
        if isinstance(rows, list):
            for item in rows:
                if not isinstance(item, dict):
                    continue
                model_id = str(item.get('id') or '').strip()
                if not model_id:
                    continue
                leaf = _status_extract_model_leaf(model_id)
                if not leaf:
                    continue
                normalized = _status_normalize_model_key(leaf)
                if normalized == 'unknown':
                    continue
                canonical = _status_release_stem(normalized) or normalized
                vendor = ''
                if '/' in model_id:
                    vendor = str(model_id.split('/', 1)[0] or '').strip().lower()
                display = _status_strip_release_suffix_for_display(leaf)
                if not display:
                    display = leaf

                prev_meta = canonical_meta.get(canonical)
                if not prev_meta:
                    canonical_meta[canonical] = {
                        'display': display,
                        'vendor': vendor
                    }
                else:
                    prev_display = str(prev_meta.get('display') or '').strip()
                    if (not prev_display) or (len(display) < len(prev_display)):
                        prev_meta['display'] = display
                    if not prev_meta.get('vendor') and vendor:
                        prev_meta['vendor'] = vendor

                alias_to_canonical[normalized] = canonical
                alias_to_canonical[canonical] = canonical
    except Exception:
        alias_to_canonical = {}
        canonical_meta = {}

    _STATUS_OPENROUTER_MODEL_CACHE['mtime'] = mtime
    _STATUS_OPENROUTER_MODEL_CACHE['alias_to_canonical'] = alias_to_canonical
    _STATUS_OPENROUTER_MODEL_CACHE['canonical_meta'] = canonical_meta
    return alias_to_canonical, canonical_meta


def _status_canonicalize_model(raw_model: str) -> Tuple[str, str]:
    normalized = _status_normalize_model_key(raw_model)
    if normalized == 'unknown':
        return 'unknown', 'unknown'
    alias_to_canonical, canonical_meta = _load_status_openrouter_model_index()
    canonical = alias_to_canonical.get(normalized, '')
    if not canonical:
        stem = _status_release_stem(normalized)
        canonical = alias_to_canonical.get(stem, stem or normalized)
    meta = canonical_meta.get(canonical, {})
    display = str(meta.get('display') or '').strip() or canonical
    if canonical.startswith('doubao-seed-') and display.startswith('seed-'):
        display = f"doubao-{display}"
    return canonical, display


def _status_icon_provider_for_model(model_name: str, fallback_provider: str = 'unknown') -> str:
    key = str(model_name or '').strip().lower()
    if not key or key == 'unknown':
        return _status_normalize_provider(fallback_provider)
    if key.startswith('glm') or key.startswith('chatglm'):
        return 'zhipu'
    if key.startswith('gpt') or key.startswith('chatgpt') or key.startswith('o1') or key.startswith('o3') or key.startswith('o4'):
        return 'openai'
    if key.startswith('deepseek'):
        return 'deepseek'
    if key.startswith('doubao-seed') or key.startswith('seed'):
        return 'volcengine'
    if key.startswith('qwen'):
        return 'aliyun'
    if key.startswith('kimi') or key.startswith('moonshot'):
        return 'kimi'
    if key.startswith('step'):
        return 'stepfun'
    return _status_normalize_provider(fallback_provider)


def _status_add_provider_count(row: Dict[str, Any], provider: str, weight: int = 1) -> None:
    if not isinstance(row, dict):
        return
    p = _status_normalize_provider(provider)
    if not p or p == 'unknown':
        return
    counts = row.setdefault('_providerCounts', {})
    if not isinstance(counts, dict):
        counts = {}
        row['_providerCounts'] = counts
    counts[p] = _safe_int_status(counts.get(p, 0)) + max(1, _safe_int_status(weight, 1))


def _ensure_status_model_row(model_map: Dict[str, Dict[str, Any]], model_name: str, display_name: str = '') -> Dict[str, Any]:
    key = str(model_name or 'unknown').strip() or 'unknown'
    if key not in model_map:
        model_map[key] = {
            'id': key,
            'name': str(display_name or key).strip() or key,
            'provider': 'unknown',
            'icon': '',
            'score': 0,
            'totalTokens': 0,
            'tokenLogCount': 0,
            'callCount': 0,
            'toolCalls': 0,
            'successRate': 100.0,
            'failureCount': 0,
            '_providerCounts': {},
            'complexityLoad': {
                'simple': 0,
                'medium': 0,
                'complex': 0
            }
        }
    elif display_name:
        prev = str(model_map[key].get('name') or '').strip()
        if not prev or prev == key:
            model_map[key]['name'] = str(display_name).strip() or key
    return model_map[key]


def _tool_call_count_from_steps(steps: Any) -> int:
    arr = steps if isinstance(steps, list) else []
    return sum(1 for step in arr if isinstance(step, dict) and str(step.get('type') or '') == 'function_call')


def _status_parse_timestamp(raw: Any) -> Optional[datetime]:
    text = str(raw or '').strip()
    if not text:
        return None
    # token_usage.json may use "YYYY-mm-dd HH:MM:SS" or ISO strings.
    formats = [
        '%Y-%m-%d %H:%M:%S',
        '%Y-%m-%d %H:%M:%S.%f',
        '%Y-%m-%d %H:%M',
        '%Y-%m-%dT%H:%M:%S',
        '%Y-%m-%dT%H:%M:%S.%f'
    ]
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt)
        except Exception:
            continue
    try:
        iso_text = text[:-1] + '+00:00' if text.endswith('Z') else text
        dt = datetime.fromisoformat(iso_text)
        if dt.tzinfo is not None:
            dt = dt.astimezone().replace(tzinfo=None)
        return dt
    except Exception:
        return None


def _ensure_status_recent_row(recent_map: Dict[str, Dict[str, Any]], model_name: str, display_name: str = '') -> Dict[str, Any]:
    key = str(model_name or 'unknown').strip() or 'unknown'
    if key not in recent_map:
        recent_map[key] = {
            'id': key,
            'name': str(display_name or key).strip() or key,
            'provider': 'unknown',
            'icon': '',
            'score': 0,
            'recentCalls': 0,
            'recentTokens': 0,
            '_providerCounts': {}
        }
    elif display_name:
        prev = str(recent_map[key].get('name') or '').strip()
        if not prev or prev == key:
            recent_map[key]['name'] = str(display_name).strip() or key
    return recent_map[key]
