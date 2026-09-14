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
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from flask import Blueprint, current_app, jsonify, request, session

from App.Runtime import get_service_status_monitor
from App.Utils import resolve_configured_path, safe_join_path
from basis.Permission import require_admin, require_login
from basis.TokenUsage import (
    dedupe_token_log_records,
    is_usage_log_path,
    iter_papi_image_log_entries,
    iter_papi_token_log_entries,
    read_usage_log_records,
    replace_usage_log_records,
)
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

    # username 会直接拼入目录路径（且可从请求参数传入），
    # 显式拒绝路径分隔符与相对路径标记，非法值回退到 users 根目录。
    if not uname or '/' in uname or '\\' in uname or uname in ('.', '..'):
        return safe_join_path(BASE_DIR, 'data', 'users')

    default_path = safe_join_path(BASE_DIR, 'data', 'users', uname)
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


def _status_token_log_identity(log: Dict[str, Any], source: str) -> str:
    """只用持久化的唯一日志 ID 识别重复记录,不把同一秒的真实请求合并。"""
    if not isinstance(log, dict):
        return ''

    log_id = str(log.get('log_id') or log.get('id') or '').strip()

    if not log_id:
        return ''

    return f'{str(source or "token").strip()}:{log_id}'


def _status_dedupe_token_logs(logs: Any, source: str) -> List[Dict[str, Any]]:
    """去除同一日志 ID 的重复读取结果,保留没有 ID 的旧记录。"""
    return dedupe_token_log_records(logs, source)


def _reconcile_user_token_logs(
    username: str,
    user_path: str,
    drop_orphans: bool = False,
    drop_zero_tokens: bool = False,
    dedupe: bool = False,
    write_back: bool = False,
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
        if (
            drop_orphans
            and conv_id
            and not conv_id.startswith('transient')
            and conv_id not in existing_conv_ids
        ):
            report['removed_orphan'] += 1
            continue
        if drop_zero_tokens and total <= 0 and input_tokens <= 0 and output_tokens <= 0:
            report['removed_zero'] += 1
            continue
        filtered_logs.append(item)

    result_logs: List[Dict[str, Any]] = filtered_logs
    if dedupe:
        slot_by_identity: Dict[str, Tuple[int, Dict[str, Any]]] = {}

        for idx, item in enumerate(filtered_logs):
            identity = _status_token_log_identity(item, 'chat')

            if not identity:
                slot_by_identity[f'legacy:{idx}'] = (idx, item)
                continue

            if identity not in slot_by_identity:
                slot_by_identity[identity] = (idx, item)
                continue

            prev_idx, prev_item = slot_by_identity[identity]
            prev_total = _safe_int_status(prev_item.get('total_tokens', 0))
            now_total = _safe_int_status(item.get('total_tokens', 0))
            if now_total >= prev_total:
                slot_by_identity[identity] = (idx, item)
            report['deduped_dropped'] += 1

        result_logs = [
            item
            for _, item in sorted(slot_by_identity.values(), key=lambda pair: pair[0])
        ]

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
    dry_run = bool(data.get('dry_run', True))
    drop_orphans = bool(data.get('drop_orphans', False))
    drop_zero_tokens = bool(data.get('drop_zero_tokens', False))
    dedupe = bool(data.get('dedupe', False))

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
    dry_run = bool(data.get('dry_run', True))
    drop_orphans = bool(data.get('drop_orphans', False))
    drop_zero_tokens = bool(data.get('drop_zero_tokens', False))
    dedupe = bool(data.get('dedupe', False))
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
            'recentOutputTokens': 0,
            '_providerCounts': {}
        }
    elif display_name:
        prev = str(recent_map[key].get('name') or '').strip()
        if not prev or prev == key:
            recent_map[key]['name'] = str(display_name).strip() or key
    return recent_map[key]


# ==================== 状态总览聚合（B2b 批次迁入） ====================

def build_status_overview() -> Dict[str, Any]:
    users_root = safe_join_path(BASE_DIR, 'data', 'users')
    model_map: Dict[str, Dict[str, Any]] = {}
    speed_map: Dict[str, Dict[str, Any]] = {}
    recent_24h_map: Dict[str, Dict[str, Any]] = {}
    tool_failure_map: Dict[str, Dict[str, Any]] = {}
    fallback_tool_complexity_tasks: Dict[str, Dict[str, Any]] = {}
    complexity = {'simple': 0, 'medium': 0, 'complex': 0}
    image_stats = {
        'requests': 0,
        'successes': 0,
        'failures': 0,
        'images': 0,
        'recent24hRequests': 0,
        'recent24hImages': 0
    }
    total_tokens = 0
    total_tool_calls = 0
    total_tool_failures = 0
    cutoff_24h = datetime.now() - timedelta(hours=24)

    if not os.path.exists(users_root):
        return {
            'snapshotAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S CST'),
            'source': 'ChatDBServer/data/users/*/{token_usage,tool_usage,conversations} + ChatDBServer/data/papi/*/{token_log,image_log}.jsonl',
            'totals': {'tokens': 0, 'modelCalls': 0, 'toolCalls': 0, 'toolFailures': 0},
            'imageStats': image_stats,
            'complexity': complexity,
            'models': [],
            'speedModels': [],
            'speedWindowDays': 30,
            'speedMinSamples': 3,
            'toolFailures': [],
            'recent24h': [],
            'recent24hWindowHours': 24
        }

    for username in os.listdir(users_root):
        user_path = safe_join_path(users_root, username)
        if not os.path.isdir(user_path):
            continue

        token_logs = _status_dedupe_token_logs(
            _read_json_list_safe(safe_join_path(user_path, 'token_usage.json')),
            'chat',
        )
        speed_deduped_logs: Dict[str, Dict[str, Any]] = {}
        deduped_token_logs: Dict[str, Dict[str, Any]] = {}
        for log_index, log in enumerate(token_logs):
            if not isinstance(log, dict):
                continue
            conversation_id = str(log.get('conversation_id') or '').strip()
            timestamp = str(log.get('timestamp') or '').strip()
            action = str(log.get('action') or 'chat').strip() or 'chat'
            provider = str(log.get('provider') or 'unknown').strip() or 'unknown'
            model = str(log.get('model') or 'unknown').strip() or 'unknown'
            key = _status_token_log_identity(log, 'chat') or f'chat:{username}:legacy:{log_index}'
            input_tokens = _safe_int_status(log.get('input_tokens', 0), 0)
            output_tokens = _safe_int_status(log.get('output_tokens', 0), 0)
            token_details = log.get('token_details') if isinstance(log.get('token_details'), dict) else {}
            raw_input_tokens = _safe_int_status(
                token_details.get('raw_input_tokens', input_tokens),
                input_tokens
            )
            recorded_total = _safe_int_status(log.get('total_tokens', 0), 0)
            if raw_input_tokens > 0 or output_tokens > 0:
                total = raw_input_tokens + output_tokens
            else:
                total = recorded_total
            ts_dt = _status_parse_timestamp(timestamp)
            prev = deduped_token_logs.get(key)
            if prev is None or total >= _safe_int_status(prev.get('total_tokens', 0)):
                deduped_token_logs[key] = {
                    'provider': provider,
                    'model': model,
                    'total_tokens': total,
                    'output_tokens': _safe_int_status(log.get('output_tokens', 0), 0),
                    'timestamp_dt': ts_dt
                }

            # 速度榜单样本与 Token 统计使用同一条日志身份,避免同秒请求互相覆盖。
            output_tokens = _safe_int_status(log.get('output_tokens', 0), 0)
            duration_ms = _status_normalize_latency_ms(log.get('duration_ms', 0), output_tokens=output_tokens, for_ttft=False)
            ttft_ms = _status_normalize_latency_ms(log.get('ttft_ms', 0), output_tokens=output_tokens, duration_hint_ms=duration_ms, for_ttft=True)
            token_details = log.get('token_details') if isinstance(log.get('token_details'), dict) else {}
            if duration_ms <= 0:
                duration_ms = _status_normalize_latency_ms(token_details.get('duration_ms', 0), output_tokens=output_tokens, for_ttft=False)
            if ttft_ms <= 0:
                ttft_ms = _status_normalize_latency_ms(token_details.get('ttft_ms', 0), output_tokens=output_tokens, duration_hint_ms=duration_ms, for_ttft=True)
            speed_item = {
                'provider': provider,
                'model': model,
                'duration_ms': max(0, duration_ms),
                'ttft_ms': max(0, ttft_ms),
                'output_tokens': max(0, output_tokens)
            }
            prev_speed = speed_deduped_logs.get(key)
            if prev_speed is None:
                speed_deduped_logs[key] = speed_item
            else:
                prev_score = _safe_int_status(prev_speed.get('duration_ms', 0), 0) + _safe_int_status(prev_speed.get('output_tokens', 0), 0)
                cur_score = speed_item['duration_ms'] + speed_item['output_tokens']
                if cur_score >= prev_score:
                    speed_deduped_logs[key] = speed_item

        for item in deduped_token_logs.values():
            total = _safe_int_status(item.get('total_tokens', 0))
            total_tokens += total
            model_raw = str(item.get('model') or 'unknown').strip() or 'unknown'
            provider = _status_normalize_provider(str(item.get('provider') or 'unknown').strip() or 'unknown')
            model_name, display_name = _status_canonicalize_model(model_raw)
            row = _ensure_status_model_row(model_map, model_name, display_name)
            row['totalTokens'] += total
            row['tokenLogCount'] += 1
            _status_add_provider_count(row, provider)
            ts_dt = item.get('timestamp_dt')
            if isinstance(ts_dt, datetime) and ts_dt >= cutoff_24h:
                recent = _ensure_status_recent_row(recent_24h_map, model_name, display_name)
                recent['recentCalls'] += 1
                recent['recentTokens'] += total
                recent['recentOutputTokens'] += _safe_int_status(item.get('output_tokens', 0), 0)
                _status_add_provider_count(recent, provider)

        for s_item in speed_deduped_logs.values():
            model_raw = str(s_item.get('model') or 'unknown').strip() or 'unknown'
            provider = _status_normalize_provider(str(s_item.get('provider') or 'unknown').strip() or 'unknown')
            model_name, display_name = _status_canonicalize_model(model_raw)
            s_row = speed_map.setdefault(model_name, {
                'id': model_name,
                'name': str(display_name or model_name).strip() or model_name,
                '_providerCounts': {},
                'samples': 0,
                'duration_ms_total': 0,
                'duration_ms_count': 0,
                'gen_ms_total': 0,
                'gen_ms_count': 0,
                'ttft_ms_total': 0,
                'ttft_ms_count': 0,
                'output_tokens_total': 0,
                'effective_output_tokens_total': 0
            })
            if display_name and (not str(s_row.get('name') or '').strip() or str(s_row.get('name') or '').strip() == model_name):
                s_row['name'] = str(display_name).strip() or model_name
            _status_add_provider_count(s_row, provider)
            s_row['samples'] += 1
            duration_ms = _safe_int_status(s_item.get('duration_ms', 0), 0)
            ttft_ms = _safe_int_status(s_item.get('ttft_ms', 0), 0)
            output_tokens = _safe_int_status(s_item.get('output_tokens', 0), 0)
            if duration_ms > 0:
                s_row['duration_ms_total'] += duration_ms
                s_row['duration_ms_count'] += 1
                gen_ms = duration_ms
                if ttft_ms > 0 and ttft_ms < duration_ms:
                    gen_ms = max(1, duration_ms - ttft_ms)
                if gen_ms > 0:
                    s_row['gen_ms_total'] += gen_ms
                    s_row['gen_ms_count'] += 1
                if output_tokens > 0:
                    # Keep TPS numerator aligned with valid-latency samples only.
                    s_row['effective_output_tokens_total'] += output_tokens
            if ttft_ms > 0:
                s_row['ttft_ms_total'] += ttft_ms
                s_row['ttft_ms_count'] += 1
            if output_tokens > 0:
                s_row['output_tokens_total'] += output_tokens

        tool_logs = _read_json_list_safe(safe_join_path(user_path, 'tool_usage.json'))
        for log in tool_logs:
            if not isinstance(log, dict):
                continue
            total_tool_calls += 1
            success = bool(log.get('success', True))
            if not success:
                total_tool_failures += 1
            tool_name = str(log.get('tool_name') or 'unknown').strip() or 'unknown'
            provider = _status_normalize_provider(str(log.get('provider') or 'unknown').strip() or 'unknown')
            model_raw = str(log.get('model') or 'unknown').strip() or 'unknown'
            model_name, display_name = _status_canonicalize_model(model_raw)
            row = _ensure_status_model_row(model_map, model_name, display_name)
            row['toolCalls'] += 1
            if not success:
                row['failureCount'] += 1
            _status_add_provider_count(row, provider)

            conversation_id = str(log.get('conversation_id') or '').strip()
            if conversation_id:
                task_key = '|'.join([str(username), conversation_id, model_name])
                task_item = fallback_tool_complexity_tasks.setdefault(task_key, {
                    'model': model_name,
                    'display_name': display_name,
                    'provider': provider,
                    'calls': 0,
                })
                task_item['calls'] = _safe_int_status(task_item.get('calls', 0), 0) + 1

            fail_row = tool_failure_map.setdefault(tool_name, {
                'name': tool_name,
                'count': 0,
                'note': ''
            })
            if not success:
                fail_row['count'] += 1
                err_text = str(log.get('error_message') or '').strip()
                if err_text:
                    fail_row['note'] = err_text[:120]

        conv_dir = safe_join_path(user_path, 'conversations')
        if os.path.exists(conv_dir):
            for filename in os.listdir(conv_dir):
                if not filename.endswith('.json'):
                    continue
                conv_path = os.path.join(conv_dir, filename)
                try:
                    convo = json.loads(Path(conv_path).read_text(encoding='utf-8'))
                except Exception:
                    continue
                messages = convo.get('messages', []) if isinstance(convo, dict) else []
                if not isinstance(messages, list):
                    continue
                for msg in messages:
                    if not isinstance(msg, dict) or str(msg.get('role') or '') != 'assistant':
                        continue
                    md = msg.get('metadata', {}) if isinstance(msg.get('metadata'), dict) else {}
                    model_raw = str(md.get('model_name') or msg.get('model_name') or '').strip() or 'unknown'
                    model_name, display_name = _status_canonicalize_model(model_raw)
                    row = _ensure_status_model_row(model_map, model_name, display_name)
                    row['callCount'] += 1
                    provider = _status_normalize_provider(str(md.get('provider') or msg.get('provider') or '').strip() or 'unknown')
                    _status_add_provider_count(row, provider)
                    tool_call_count = _tool_call_count_from_steps(md.get('process_steps', []))
                    if tool_call_count <= 2:
                        bucket = 'simple'
                    elif tool_call_count <= 7:
                        bucket = 'medium'
                    else:
                        bucket = 'complex'
                    row['complexityLoad'][bucket] += 1
                    complexity[bucket] += 1

    for log in _status_dedupe_token_logs(list(iter_papi_token_log_entries()), 'papi'):
        if not isinstance(log, dict):
            continue

        input_tokens = _safe_int_status(log.get('input_tokens', 0), 0)
        output_tokens = _safe_int_status(log.get('output_tokens', 0), 0)
        total = log.get('total_tokens', None)
        if total is None:
            total = input_tokens + output_tokens
        total = _safe_int_status(total, 0)
        total_tokens += total

        model_raw = str(log.get('model') or 'unknown').strip() or 'unknown'
        provider = _status_normalize_provider(str(log.get('provider') or 'unknown').strip() or 'unknown')
        model_name, display_name = _status_canonicalize_model(model_raw)
        row = _ensure_status_model_row(model_map, model_name, display_name)
        row['totalTokens'] += total
        row['tokenLogCount'] += 1
        row['callCount'] += 1
        row['complexityLoad']['simple'] += 1
        _status_add_provider_count(row, provider)

        ts_dt = _status_parse_timestamp(log.get('timestamp'))
        if isinstance(ts_dt, datetime) and ts_dt >= cutoff_24h:
            recent = _ensure_status_recent_row(recent_24h_map, model_name, display_name)
            recent['recentCalls'] += 1
            recent['recentTokens'] += total
            recent['recentOutputTokens'] += output_tokens
            _status_add_provider_count(recent, provider)

        duration_ms = _status_normalize_latency_ms(log.get('duration_ms', 0), output_tokens=output_tokens, for_ttft=False)
        ttft_ms = _status_normalize_latency_ms(log.get('ttft_ms', 0), output_tokens=output_tokens, duration_hint_ms=duration_ms, for_ttft=True)
        s_row = speed_map.setdefault(model_name, {
            'id': model_name,
            'name': str(display_name or model_name).strip() or model_name,
            '_providerCounts': {},
            'samples': 0,
            'duration_ms_total': 0,
            'duration_ms_count': 0,
            'gen_ms_total': 0,
            'gen_ms_count': 0,
            'ttft_ms_total': 0,
            'ttft_ms_count': 0,
            'output_tokens_total': 0,
            'effective_output_tokens_total': 0
        })
        if display_name and (not str(s_row.get('name') or '').strip() or str(s_row.get('name') or '').strip() == model_name):
            s_row['name'] = str(display_name).strip() or model_name
        _status_add_provider_count(s_row, provider)
        s_row['samples'] += 1
        if duration_ms > 0:
            s_row['duration_ms_total'] += duration_ms
            s_row['duration_ms_count'] += 1
            gen_ms = duration_ms
            if ttft_ms > 0 and ttft_ms < duration_ms:
                gen_ms = max(1, duration_ms - ttft_ms)
            if gen_ms > 0:
                s_row['gen_ms_total'] += gen_ms
                s_row['gen_ms_count'] += 1
            if output_tokens > 0:
                s_row['effective_output_tokens_total'] += output_tokens
        if ttft_ms > 0:
            s_row['ttft_ms_total'] += ttft_ms
            s_row['ttft_ms_count'] += 1
        if output_tokens > 0:
            s_row['output_tokens_total'] += output_tokens

    for log in iter_papi_image_log_entries():
        if not isinstance(log, dict):
            continue

        image_stats['requests'] += 1

        status = str(log.get('status') or '').strip().lower()
        image_count = _safe_int_status(log.get('image_count', 0), 0)
        if image_count <= 0:
            images = log.get('images') if isinstance(log.get('images'), list) else []
            image_count = len(images)

        if status == 'success':
            image_stats['successes'] += 1
            image_stats['images'] += image_count
        else:
            image_stats['failures'] += 1

        ts_dt = _status_parse_timestamp(log.get('timestamp'))
        if isinstance(ts_dt, datetime) and ts_dt >= cutoff_24h:
            image_stats['recent24hRequests'] += 1
            if status == 'success':
                image_stats['recent24hImages'] += image_count

    fallback_complexity_by_model: Dict[str, Dict[str, int]] = {}
    for task_item in fallback_tool_complexity_tasks.values():
        if not isinstance(task_item, dict):
            continue
        model_name = str(task_item.get('model') or 'unknown').strip() or 'unknown'
        calls = _safe_int_status(task_item.get('calls', 0), 0)
        if calls <= 0:
            continue
        if calls <= 2:
            bucket = 'simple'
        elif calls <= 7:
            bucket = 'medium'
        else:
            bucket = 'complex'
        per_model = fallback_complexity_by_model.setdefault(model_name, {'simple': 0, 'medium': 0, 'complex': 0})
        per_model[bucket] = _safe_int_status(per_model.get(bucket, 0), 0) + 1

    for model_name, row in model_map.items():
        if not isinstance(row, dict):
            continue
        load = row.get('complexityLoad', {}) if isinstance(row.get('complexityLoad'), dict) else {}
        load_total = (
            _safe_int_status(load.get('simple', 0), 0)
            + _safe_int_status(load.get('medium', 0), 0)
            + _safe_int_status(load.get('complex', 0), 0)
        )
        if load_total > 0:
            continue
        fallback_load = fallback_complexity_by_model.get(model_name)
        if not isinstance(fallback_load, dict):
            call_count = _safe_int_status(row.get('callCount', 0), 0)
            if call_count > 0:
                row['complexityLoad'] = {
                    'simple': call_count,
                    'medium': 0,
                    'complex': 0,
                }
            continue
        row['complexityLoad'] = {
            'simple': _safe_int_status(fallback_load.get('simple', 0), 0),
            'medium': _safe_int_status(fallback_load.get('medium', 0), 0),
            'complex': _safe_int_status(fallback_load.get('complex', 0), 0),
        }

    complexity = {'simple': 0, 'medium': 0, 'complex': 0}
    for row in model_map.values():
        if not isinstance(row, dict):
            continue
        load = row.get('complexityLoad', {}) if isinstance(row.get('complexityLoad'), dict) else {}
        complexity['simple'] += _safe_int_status(load.get('simple', 0), 0)
        complexity['medium'] += _safe_int_status(load.get('medium', 0), 0)
        complexity['complex'] += _safe_int_status(load.get('complex', 0), 0)

    for _, row in model_map.items():
        counts = row.get('_providerCounts', {}) if isinstance(row.get('_providerCounts'), dict) else {}
        known = [(name, _safe_int_status(v, 0)) for name, v in counts.items() if str(name or '') and str(name) != 'unknown']
        known = [item for item in known if item[1] > 0]
        if len(known) >= 2:
            provider = 'multi'
        elif len(known) == 1:
            provider = known[0][0]
        else:
            provider = str(row.get('provider') or 'unknown').strip() or 'unknown'
        row['provider'] = provider
        icon_provider = _status_icon_provider_for_model(str(row.get('id') or ''), provider)
        row['icon'] = _status_provider_icon(icon_provider)
        row.pop('_providerCounts', None)
        tool_calls = _safe_int_status(row.get('toolCalls', 0))
        failures = _safe_int_status(row.get('failureCount', 0))
        call_count = _safe_int_status(row.get('callCount', 0))
        token_log_count = _safe_int_status(row.get('tokenLogCount', 0))
        row['tokenCoverage'] = round((token_log_count / call_count * 100.0), 1) if call_count > 0 else 0.0
        if tool_calls > 0:
            row['successRate'] = round(max(0.0, (tool_calls - failures) / tool_calls * 100.0), 1)
        else:
            row['successRate'] = 100.0

    for _, row in recent_24h_map.items():
        counts = row.get('_providerCounts', {}) if isinstance(row.get('_providerCounts'), dict) else {}
        known = [(name, _safe_int_status(v, 0)) for name, v in counts.items() if str(name or '') and str(name) != 'unknown']
        known = [item for item in known if item[1] > 0]
        if len(known) >= 2:
            provider = 'multi'
        elif len(known) == 1:
            provider = known[0][0]
        else:
            provider = str(row.get('provider') or 'unknown').strip() or 'unknown'
        row['provider'] = provider
        icon_provider = _status_icon_provider_for_model(str(row.get('id') or ''), provider)
        row['icon'] = _status_provider_icon(icon_provider)
        row.pop('_providerCounts', None)

    max_calls = max((_safe_int_status(item.get('callCount', 0)) for item in model_map.values()), default=0)
    max_tokens = max((_safe_int_status(item.get('totalTokens', 0)) for item in model_map.values()), default=0)
    max_tools = max((_safe_int_status(item.get('toolCalls', 0)) for item in model_map.values()), default=0)
    for row in model_map.values():
        call_count = _safe_int_status(row.get('callCount', 0))
        token_total = _safe_int_status(row.get('totalTokens', 0))
        tool_calls = _safe_int_status(row.get('toolCalls', 0))
        success_rate = max(0.0, min(100.0, float(row.get('successRate', 0.0)))) / 100.0
        call_ratio = (call_count / max_calls) if max_calls > 0 else 0.0
        token_ratio = (token_total / max_tokens) if max_tokens > 0 else 0.0
        tool_ratio = (tool_calls / max_tools) if max_tools > 0 else 0.0

        raw_score = (
            success_rate * 0.38
            + call_ratio * 0.30
            + token_ratio * 0.22
            + tool_ratio * 0.10
        ) * 100.0
        score = round(max(0.0, min(100.0, raw_score)))
        if call_count <= 0 and token_total <= 0 and tool_calls <= 0:
            score = 0
        if str(row.get('id') or '') == 'unknown':
            score = 0
        row['score'] = int(score)

    for row in recent_24h_map.values():
        total_tokens = _safe_int_status(row.get('recentTokens', 0))
        score = total_tokens
        if str(row.get('id') or '') == 'unknown':
            score = 0
        row['score'] = int(score)

    models = sorted(
        model_map.values(),
        key=lambda item: (
            _safe_int_status(item.get('score', 0)),
            _safe_int_status(item.get('callCount', 0)),
            _safe_int_status(item.get('totalTokens', 0))
        ),
        reverse=True
    )
    recent_24h = sorted(
        recent_24h_map.values(),
        key=lambda item: (
            _safe_int_status(item.get('recentTokens', 0)),
            _safe_int_status(item.get('recentOutputTokens', 0)),
            _safe_int_status(item.get('recentCalls', 0))
        ),
        reverse=True
    )[:12]

    tool_failures = sorted(
        [item for item in tool_failure_map.values() if _safe_int_status(item.get('count', 0)) > 0],
        key=lambda item: _safe_int_status(item.get('count', 0)),
        reverse=True
    )[:8]

    total_model_calls = sum(_safe_int_status(item.get('callCount', 0)) for item in models)

    # Speed leaderboard (status page): balanced TTFT + output throughput.
    # Do not hard-filter low-sample models here; UI can still show sample count.
    speed_min_samples = 3
    speed_rows: List[Dict[str, Any]] = []
    speed_min_ttft = None
    speed_max_tps = 0.0
    for s in speed_map.values():
        samples = _safe_int_status(s.get('samples', 0), 0)
        duration_count = _safe_int_status(s.get('duration_ms_count', 0), 0)
        gen_count = _safe_int_status(s.get('gen_ms_count', 0), 0)
        ttft_count = _safe_int_status(s.get('ttft_ms_count', 0), 0)
        duration_total = _safe_int_status(s.get('duration_ms_total', 0), 0)
        gen_total = _safe_int_status(s.get('gen_ms_total', 0), 0)
        output_total = _safe_int_status(s.get('output_tokens_total', 0), 0)
        effective_output_total = _safe_int_status(s.get('effective_output_tokens_total', 0), 0)
        avg_duration_ms = (duration_total / duration_count) if duration_count > 0 else 0.0
        avg_ttft_ms = (float(s.get('ttft_ms_total', 0)) / ttft_count) if ttft_count > 0 else 0.0
        tps_denom_ms = gen_total if gen_total > 0 else duration_total
        avg_output_tps = (effective_output_total * 1000.0 / tps_denom_ms) if tps_denom_ms > 0 and effective_output_total > 0 else 0.0
        speed_row = {
            'id': str(s.get('id') or 'unknown'),
            'name': str(s.get('name') or s.get('id') or 'unknown'),
            'provider': 'unknown',
            'icon': '',
            'samples': samples,
            'outputTokens': int(max(0, output_total)),
            'avgDurationMs': round(avg_duration_ms, 1) if avg_duration_ms > 0 else 0.0,
            'avgTTFTMs': round(avg_ttft_ms, 1) if avg_ttft_ms > 0 else 0.0,
            'avgOutputTPS': round(avg_output_tps, 3),
            'score': 0.0
        }
        counts = s.get('_providerCounts', {}) if isinstance(s.get('_providerCounts'), dict) else {}
        known = [(name, _safe_int_status(v, 0)) for name, v in counts.items() if str(name or '') and str(name) != 'unknown']
        known = [item for item in known if item[1] > 0]
        if len(known) >= 2:
            provider = 'multi'
        elif len(known) == 1:
            provider = known[0][0]
        else:
            provider = 'unknown'
        speed_row['provider'] = provider
        icon_provider = _status_icon_provider_for_model(str(speed_row.get('id') or ''), provider)
        speed_row['icon'] = _status_provider_icon(icon_provider)
        speed_rows.append(speed_row)
        if speed_row['avgTTFTMs'] > 0 and (speed_min_ttft is None or speed_row['avgTTFTMs'] < speed_min_ttft):
            speed_min_ttft = speed_row['avgTTFTMs']
        if speed_row['avgOutputTPS'] > speed_max_tps:
            speed_max_tps = speed_row['avgOutputTPS']

    speed_min_ttft = float(speed_min_ttft or 0.0)
    speed_max_tps = float(speed_max_tps or 0.0)
    for s in speed_rows:
        ttft = float(s.get('avgTTFTMs') or 0.0)
        tps = float(s.get('avgOutputTPS') or 0.0)
        ttft_score = 0.0
        if speed_min_ttft > 0 and ttft > 0:
            ttft_score = min(100.0, max(0.0, (speed_min_ttft / ttft) * 100.0))
        tps_score = 0.0
        if speed_max_tps > 0 and tps > 0:
            tps_score = min(100.0, max(0.0, (tps / speed_max_tps) * 100.0))
        s['score'] = round(ttft_score * 0.45 + tps_score * 0.55, 1)

    speed_rows = sorted(
        speed_rows,
        key=lambda item: (
            float(item.get('score', 0.0)),
            float(item.get('avgOutputTPS', 0.0)),
            -float(item.get('avgTTFTMs', 1e18))
        ),
        reverse=True
    )[:12]

    return {
        'snapshotAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S CST'),
        'source': 'ChatDBServer/data/users/*/{token_usage,tool_usage,conversations} + ChatDBServer/data/papi/*/{token_log,image_log}.jsonl',
        'totals': {
            'tokens': total_tokens,
            'modelCalls': total_model_calls,
            'toolCalls': total_tool_calls,
            'toolFailures': total_tool_failures
        },
        'imageStats': image_stats,
        'complexity': complexity,
        'models': models[:12],
        'speedModels': speed_rows,
        'speedWindowDays': 30,
        'speedMinSamples': speed_min_samples,
        'toolFailures': tool_failures,
        'recent24h': recent_24h,
        'recent24hWindowHours': 24
    }


@stats_bp.route('/api/rank/overview', methods=['GET'])
def rank_overview_api():
    try:
        return jsonify({'success': True, 'status': build_status_overview()})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@stats_bp.route('/api/status/overview', methods=['GET'])
def service_status_overview_api():
    return jsonify({'success': True, 'status': get_service_status_monitor().overview()})


@stats_bp.route('/api/health', methods=['GET'])
def service_health_api():
    return jsonify({'success': True, 'service': 'Nexora'})


@stats_bp.route('/api/admin/tokens/stats', methods=['GET'])
@require_admin
def admin_token_stats():
    """获取所有用户的总 token 消耗"""
    try:
        total_tokens = 0
        user_dir = safe_join_path(BASE_DIR, "data", "users")
        for username in os.listdir(user_dir):
            token_file = safe_join_path(user_dir, username, "token_usage.json")
            try:
                logs = _status_dedupe_token_logs(read_usage_log_records(token_file), 'chat')

                for log in logs:
                    t = log.get('total_tokens', None)

                    if t is None:
                        t = log.get('input_tokens', 0) + log.get('output_tokens', 0)

                    total_tokens += int(t or 0)
            except Exception as e:
                current_app.logger.warning('admin token stats load failed for %s: %s', username, e)

        for log in _status_dedupe_token_logs(list(iter_papi_token_log_entries()), 'papi'):
            t = log.get('total_tokens', None)

            if t is None:
                t = log.get('input_tokens', 0) + log.get('output_tokens', 0)

            total_tokens += int(t or 0)

        return jsonify({'success': True, 'total': total_tokens})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


def _admin_token_stats_range_start(range_name: str) -> Optional[datetime]:
    clean_range = str(range_name or '30d').strip().lower()
    now = datetime.now()

    if clean_range in {'today', '1d'}:
        return datetime.combine(now.date(), datetime.min.time())

    if clean_range == '7d':
        return now - timedelta(days=7)

    if clean_range == '30d':
        return now - timedelta(days=30)

    if clean_range in {'all', '全部'}:
        return None

    return now - timedelta(days=30)


def _admin_normalize_token_log_for_user(log: Dict[str, Any], source: str) -> Dict[str, Any]:
    src = log if isinstance(log, dict) else {}
    input_tokens = _safe_int_status(src.get('input_tokens', 0), 0)
    output_tokens = _safe_int_status(src.get('output_tokens', 0), 0)
    total_tokens = src.get('total_tokens')

    if total_tokens is None:
        total_tokens = input_tokens + output_tokens

    total_tokens = _safe_int_status(total_tokens, input_tokens + output_tokens)

    if total_tokens <= 0 and (input_tokens > 0 or output_tokens > 0):
        total_tokens = input_tokens + output_tokens

    timestamp = str(src.get('timestamp') or '').strip()

    return {
        'log_id': str(src.get('log_id') or src.get('id') or '').strip(),
        'timestamp': timestamp,
        'timestamp_dt': _status_parse_timestamp(timestamp),
        'source': str(source or src.get('source') or 'chat').strip() or 'chat',
        'action': str(src.get('action') or 'chat').strip() or 'chat',
        'provider': str(src.get('provider') or 'unknown').strip() or 'unknown',
        'model': str(src.get('model') or 'unknown').strip() or 'unknown',
        'conversation_id': str(src.get('conversation_id') or '').strip(),
        'request_path': str(src.get('request_path') or '').strip(),
        'status': str(src.get('status') or 'success').strip() or 'success',
        'username': str(src.get('username') or '').strip(),
        'api_key_id': str(src.get('api_key_id') or '').strip(),
        'api_key_name': str(src.get('api_key_name') or '').strip(),
        'api_key_preview': str(src.get('api_key_preview') or '').strip(),
        'input_tokens': input_tokens,
        'output_tokens': output_tokens,
        'total_tokens': total_tokens,
        'duration_ms': _safe_int_status(src.get('duration_ms', 0), 0),
    }


def _admin_collect_user_token_logs(username: str) -> List[Dict[str, Any]]:
    target_username = str(username or '').strip()
    user_path = _status_resolve_user_path(target_username)
    logs: List[Dict[str, Any]] = []

    for item in _status_dedupe_token_logs(
        _read_json_list_safe(safe_join_path(user_path, 'token_usage.json')),
        'chat',
    ):
        if isinstance(item, dict):
            logs.append(_admin_normalize_token_log_for_user(item, 'chat'))

    for item in _status_dedupe_token_logs(list(iter_papi_token_log_entries()), 'papi'):
        if not isinstance(item, dict):
            continue

        if str(item.get('username') or '').strip() != target_username:
            continue

        logs.append(_admin_normalize_token_log_for_user(item, 'papi'))

    return logs


def _admin_build_user_token_stats(username: str, range_name: str) -> Dict[str, Any]:
    range_start = _admin_token_stats_range_start(range_name)
    all_logs = _admin_collect_user_token_logs(username)
    filtered_logs: List[Dict[str, Any]] = []

    for log in all_logs:
        ts_dt = log.get('timestamp_dt')

        if range_start is not None and (not isinstance(ts_dt, datetime) or ts_dt < range_start):
            continue

        filtered_logs.append(log)

    provider_totals: Dict[str, Dict[str, int]] = {}
    model_totals: Dict[str, Dict[str, int]] = {}
    source_totals: Dict[str, Dict[str, int]] = {}
    total_input = 0
    total_output = 0
    total_tokens = 0
    papi_input_tokens = 0
    papi_output_tokens = 0
    papi_total_tokens = 0
    papi_requests = 0

    for log in filtered_logs:
        input_tokens = _safe_int_status(log.get('input_tokens', 0), 0)
        output_tokens = _safe_int_status(log.get('output_tokens', 0), 0)
        tokens = _safe_int_status(log.get('total_tokens', 0), input_tokens + output_tokens)
        provider = str(log.get('provider') or 'unknown').strip() or 'unknown'
        model = str(log.get('model') or 'unknown').strip() or 'unknown'
        source = str(log.get('source') or 'chat').strip() or 'chat'

        total_input += input_tokens
        total_output += output_tokens
        total_tokens += tokens

        if source == 'papi':
            papi_input_tokens += input_tokens
            papi_output_tokens += output_tokens
            papi_total_tokens += tokens
            papi_requests += 1

        for bucket, key in (
            (provider_totals, provider),
            (model_totals, model),
            (source_totals, source),
        ):
            row = bucket.setdefault(key, {'tokens': 0, 'requests': 0})
            row['tokens'] += tokens
            row['requests'] += 1

    recent = sorted(
        filtered_logs,
        key=lambda item: item.get('timestamp_dt') if isinstance(item.get('timestamp_dt'), datetime) else datetime.min,
        reverse=True
    )[:20]

    def _top_rows(bucket: Dict[str, Dict[str, int]], limit: int) -> List[Dict[str, Any]]:
        rows = [
            {'name': key, 'tokens': value.get('tokens', 0), 'requests': value.get('requests', 0)}
            for key, value in bucket.items()
        ]
        return sorted(rows, key=lambda item: item['tokens'], reverse=True)[:limit]

    return {
        'username': username,
        'range': str(range_name or '30d').strip().lower() or '30d',
        'total_logs': len(all_logs),
        'matched_logs': len(filtered_logs),
        'summary': {
            'requests': len(filtered_logs),
            'input_tokens': total_input,
            'output_tokens': total_output,
            'total_tokens': total_tokens,
            'papi_requests': papi_requests,
            'papi_input_tokens': papi_input_tokens,
            'papi_output_tokens': papi_output_tokens,
            'papi_total_tokens': papi_total_tokens,
        },
        'top_providers': _top_rows(provider_totals, 8),
        'top_models': _top_rows(model_totals, 10),
        'sources': _top_rows(source_totals, 6),
        'recent': [
            {
                'timestamp': str(item.get('timestamp') or ''),
                'source': str(item.get('source') or ''),
                'provider': str(item.get('provider') or ''),
                'model': str(item.get('model') or ''),
                'action': str(item.get('action') or ''),
                'input_tokens': _safe_int_status(item.get('input_tokens', 0), 0),
                'output_tokens': _safe_int_status(item.get('output_tokens', 0), 0),
                'total_tokens': _safe_int_status(item.get('total_tokens', 0), 0),
                'duration_ms': _safe_int_status(item.get('duration_ms', 0), 0),
            }
            for item in recent
        ],
    }


@stats_bp.route('/api/admin/tokens/stats/user', methods=['GET'])
@require_admin
def admin_user_token_stats():
    """按单个用户查询 Token 使用统计。"""
    username = str(request.args.get('username') or '').strip()
    range_name = str(request.args.get('range') or '30d').strip().lower()

    if not username:
        return jsonify({'success': False, 'message': 'username is required'}), 400

    users = load_users()

    if username not in users:
        return jsonify({'success': False, 'message': '用户不存在'}), 404

    try:
        payload = _admin_build_user_token_stats(username, range_name)
        payload['success'] = True
        payload['display_name'] = str((users.get(username) or {}).get('display_name') or username)
        return jsonify(payload)
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@stats_bp.route('/api/admin/models/speed', methods=['GET'])
@require_admin
def admin_model_speed_stats():
    """管理员模型速度榜：平衡首 token 延迟与输出速率。"""
    try:
        try:
            days = int(request.args.get('days', 30) or 30)
        except Exception:
            days = 30
        days = max(1, min(days, 365))
        min_samples = max(1, _safe_int_status(request.args.get('min_samples', 3), 3))

        now = datetime.now()
        cutoff = now - timedelta(days=days)
        model_map: Dict[str, Dict[str, Any]] = {}
        speed_logs: List[Dict[str, Any]] = []

        users_meta = load_users()
        if isinstance(users_meta, dict):
            for username in users_meta.keys():
                user_path = _status_resolve_user_path(username, users_meta=users_meta)
                token_file = safe_join_path(user_path, 'token_usage.json')
                speed_logs.extend(
                    _status_dedupe_token_logs(read_usage_log_records(token_file), 'chat')
                )

        speed_logs.extend(
            _status_dedupe_token_logs(list(iter_papi_token_log_entries()), 'papi')
        )

        for raw in speed_logs:
            if not isinstance(raw, dict):
                continue
            ts = _status_parse_timestamp(raw.get('timestamp'))
            if not isinstance(ts, datetime) or ts < cutoff:
                continue

            model_raw = str(raw.get('model') or 'unknown').strip() or 'unknown'
            provider = _status_normalize_provider(str(raw.get('provider') or 'unknown').strip() or 'unknown')
            model_name, display_name = _status_canonicalize_model(model_raw)

            row = model_map.setdefault(model_name, {
                'id': model_name,
                'name': str(display_name or model_name).strip() or model_name,
                'provider': provider,
                '_providerCounts': {},
                'samples': 0,
                'ttft_ms_total': 0,
                'ttft_ms_count': 0,
                'duration_ms_total': 0,
                'duration_ms_count': 0,
                'gen_ms_total': 0,
                'gen_ms_count': 0,
                'output_tokens_total': 0,
                'effective_output_tokens': 0
            })
            if display_name and (not str(row.get('name') or '').strip() or str(row.get('name') or '').strip() == model_name):
                row['name'] = str(display_name).strip() or model_name
            _status_add_provider_count(row, provider)
            row['samples'] += 1

            output_tokens = _safe_int_status(raw.get('output_tokens', 0), 0)
            duration_ms = _status_normalize_latency_ms(raw.get('duration_ms', 0), output_tokens=output_tokens, for_ttft=False)
            if duration_ms <= 0:
                token_details = raw.get('token_details') if isinstance(raw.get('token_details'), dict) else {}
                duration_ms = _status_normalize_latency_ms(token_details.get('duration_ms', 0), output_tokens=output_tokens, for_ttft=False)
            ttft_ms = _status_normalize_latency_ms(raw.get('ttft_ms', 0), output_tokens=output_tokens, duration_hint_ms=duration_ms, for_ttft=True)
            if ttft_ms <= 0:
                token_details = raw.get('token_details') if isinstance(raw.get('token_details'), dict) else {}
                ttft_ms = _status_normalize_latency_ms(token_details.get('ttft_ms', 0), output_tokens=output_tokens, duration_hint_ms=duration_ms, for_ttft=True)

            if duration_ms > 0:
                row['duration_ms_total'] += duration_ms
                row['duration_ms_count'] += 1
                gen_ms = duration_ms
                if ttft_ms > 0 and ttft_ms < duration_ms:
                    gen_ms = max(1, duration_ms - ttft_ms)
                if gen_ms > 0:
                    row['gen_ms_total'] += gen_ms
                    row['gen_ms_count'] += 1
            if ttft_ms > 0:
                row['ttft_ms_total'] += ttft_ms
                row['ttft_ms_count'] += 1
            if output_tokens > 0:
                row['output_tokens_total'] += output_tokens
            if duration_ms > 0 and output_tokens > 0:
                # Keep TPS numerator aligned with valid-latency samples only.
                row['effective_output_tokens'] += output_tokens

        rows: List[Dict[str, Any]] = []
        min_ttft = None
        max_tps = 0.0
        for item in model_map.values():
            samples = _safe_int_status(item.get('samples', 0), 0)
            if samples < min_samples:
                continue
            duration_ms_count = _safe_int_status(item.get('duration_ms_count', 0), 0)
            gen_ms_count = _safe_int_status(item.get('gen_ms_count', 0), 0)
            ttft_count = _safe_int_status(item.get('ttft_ms_count', 0), 0)
            duration_ms_avg = (item['duration_ms_total'] / duration_ms_count) if duration_ms_count > 0 else 0.0
            ttft_ms_avg = (item['ttft_ms_total'] / ttft_count) if ttft_count > 0 else 0.0
            output_tps = 0.0
            tps_denom_ms = _safe_int_status(item.get('gen_ms_total', 0), 0)
            if tps_denom_ms <= 0:
                tps_denom_ms = _safe_int_status(item.get('duration_ms_total', 0), 0)
            if tps_denom_ms > 0 and item['effective_output_tokens'] > 0:
                output_tps = item['effective_output_tokens'] * 1000.0 / tps_denom_ms
            row = {
                'id': str(item.get('id') or 'unknown'),
                'name': str(item.get('name') or item.get('id') or 'unknown'),
                'provider': 'unknown',
                'icon': '',
                'samples': samples,
                'output_tokens': int(max(0, item.get('output_tokens_total', 0))),
                'avg_duration_ms': round(duration_ms_avg, 1) if duration_ms_avg > 0 else 0.0,
                'avg_ttft_ms': round(ttft_ms_avg, 1) if ttft_ms_avg > 0 else 0.0,
                'avg_output_tps': round(output_tps, 3),
                'score': 0.0
            }
            counts = item.get('_providerCounts', {}) if isinstance(item.get('_providerCounts'), dict) else {}
            known = [(name, _safe_int_status(v, 0)) for name, v in counts.items() if str(name or '') and str(name) != 'unknown']
            known = [kv for kv in known if kv[1] > 0]
            if len(known) >= 2:
                provider_name = 'multi'
            elif len(known) == 1:
                provider_name = known[0][0]
            else:
                provider_name = _status_normalize_provider(str(item.get('provider') or 'unknown'))
            row['provider'] = provider_name
            icon_provider = _status_icon_provider_for_model(str(row.get('id') or ''), provider_name)
            row['icon'] = _status_provider_icon(icon_provider)
            rows.append(row)
            if row['avg_ttft_ms'] > 0 and (min_ttft is None or row['avg_ttft_ms'] < min_ttft):
                min_ttft = row['avg_ttft_ms']
            if row['avg_output_tps'] > max_tps:
                max_tps = row['avg_output_tps']

        min_ttft = float(min_ttft or 0.0)
        max_tps = float(max_tps or 0.0)
        for row in rows:
            ttft = float(row.get('avg_ttft_ms') or 0.0)
            tps = float(row.get('avg_output_tps') or 0.0)
            ttft_score = 0.0
            if min_ttft > 0 and ttft > 0:
                ttft_score = min(100.0, max(0.0, (min_ttft / ttft) * 100.0))
            tps_score = 0.0
            if max_tps > 0 and tps > 0:
                tps_score = min(100.0, max(0.0, (tps / max_tps) * 100.0))
            row['score'] = round(ttft_score * 0.45 + tps_score * 0.55, 1)

        rows = sorted(
            rows,
            key=lambda item: (
                float(item.get('score') or 0.0),
                float(item.get('avg_output_tps') or 0.0),
                -float(item.get('avg_ttft_ms') or 1e18)
            ),
            reverse=True
        )[:15]

        return jsonify({
            'success': True,
            'days': days,
            'min_samples': min_samples,
            'generated_at': now.strftime('%Y-%m-%d %H:%M:%S'),
            'count': len(rows),
            'models': rows
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@stats_bp.route('/api/admin/tools/stats', methods=['GET'])
@require_admin
def admin_tool_stats():
    """管理端工具调用统计：总量、成功率、耗时、按工具/Provider/Model分布。"""
    try:
        try:
            days = int(request.args.get('days', 30) or 30)
        except Exception:
            days = 30
        days = max(1, min(days, 365))

        now = datetime.now()
        start_dt = now - timedelta(days=days - 1)
        start_day = start_dt.date()
        day_labels = []
        day_buckets = {}
        for i in range(days):
            d = start_day + timedelta(days=i)
            key = d.strftime('%Y-%m-%d')
            day_labels.append(key)
            day_buckets[key] = {'calls': 0, 'errors': 0, 'latency_ms': 0}

        total_calls = 0
        success_calls = 0
        error_calls = 0
        latency_sum = 0

        tool_map = {}
        provider_map = {}
        model_map = {}

        cutoff_24h = now - timedelta(hours=24)
        failed_24h = {}

        user_dir = safe_join_path(BASE_DIR, "data", "users")
        if os.path.exists(user_dir):
            for username in os.listdir(user_dir):
                tool_file = safe_join_path(user_dir, username, "tool_usage.json")
                logs = read_usage_log_records(tool_file)

                for log in logs:
                    ts = str(log.get('timestamp') or '')
                    day = ts[:10]
                    if day not in day_buckets:
                        continue

                    tool_name = str(log.get('tool_name') or 'unknown').strip() or 'unknown'
                    provider = str(log.get('provider') or 'unknown').strip() or 'unknown'
                    model = str(log.get('model') or 'unknown').strip() or 'unknown'
                    success = bool(log.get('success', True))
                    duration = int(log.get('duration_ms', 0) or 0)
                    error_message = str(log.get('error_message') or '')

                    total_calls += 1
                    latency_sum += duration
                    if success:
                        success_calls += 1
                    else:
                        error_calls += 1

                    day_buckets[day]['calls'] += 1
                    day_buckets[day]['latency_ms'] += duration
                    if not success:
                        day_buckets[day]['errors'] += 1

                    if tool_name not in tool_map:
                        tool_map[tool_name] = {
                            'name': tool_name,
                            'calls': 0,
                            'errors': 0,
                            'latency_sum_ms': 0,
                            'last_error': ''
                        }
                    tool_map[tool_name]['calls'] += 1
                    tool_map[tool_name]['latency_sum_ms'] += duration
                    if not success:
                        tool_map[tool_name]['errors'] += 1
                        if error_message:
                            tool_map[tool_name]['last_error'] = error_message

                    if provider not in provider_map:
                        provider_map[provider] = {'name': provider, 'calls': 0, 'errors': 0, 'latency_sum_ms': 0}
                    provider_map[provider]['calls'] += 1
                    provider_map[provider]['latency_sum_ms'] += duration
                    if not success:
                        provider_map[provider]['errors'] += 1

                    if model not in model_map:
                        model_map[model] = {'name': model, 'calls': 0, 'errors': 0, 'latency_sum_ms': 0}
                    model_map[model]['calls'] += 1
                    model_map[model]['latency_sum_ms'] += duration
                    if not success:
                        model_map[model]['errors'] += 1

                    try:
                        dt = datetime.strptime(ts, '%Y-%m-%d %H:%M:%S')
                    except Exception:
                        dt = None
                    if (dt is not None) and (not success) and dt >= cutoff_24h:
                        if tool_name not in failed_24h:
                            failed_24h[tool_name] = {'name': tool_name, 'errors': 0, 'last_error': ''}
                        failed_24h[tool_name]['errors'] += 1
                        if error_message:
                            failed_24h[tool_name]['last_error'] = error_message

        def _finalize_rows(rows):
            out = []
            for item in rows:
                calls = int(item.get('calls', 0) or 0)
                errors = int(item.get('errors', 0) or 0)
                lat_sum = int(item.get('latency_sum_ms', 0) or 0)
                avg = round(lat_sum / calls, 2) if calls else 0
                row = dict(item)
                row['avg_latency_ms'] = avg
                row['error_rate'] = round((errors / calls * 100.0), 2) if calls else 0.0
                row.pop('latency_sum_ms', None)
                out.append(row)
            return out

        top_tools = sorted(
            _finalize_rows(list(tool_map.values())),
            key=lambda x: x.get('calls', 0),
            reverse=True
        )[:20]
        top_failed_tools_24h = sorted(
            list(failed_24h.values()),
            key=lambda x: x.get('errors', 0),
            reverse=True
        )[:10]
        top_providers = sorted(
            _finalize_rows(list(provider_map.values())),
            key=lambda x: x.get('calls', 0),
            reverse=True
        )[:8]
        top_models = sorted(
            _finalize_rows(list(model_map.values())),
            key=lambda x: x.get('calls', 0),
            reverse=True
        )[:10]

        series = {
            'calls': [day_buckets[d]['calls'] for d in day_labels],
            'errors': [day_buckets[d]['errors'] for d in day_labels],
            'avg_latency_ms': [
                round(day_buckets[d]['latency_ms'] / day_buckets[d]['calls'], 2) if day_buckets[d]['calls'] else 0
                for d in day_labels
            ]
        }

        return jsonify({
            'success': True,
            'days': days,
            'summary': {
                'total_calls': total_calls,
                'success_calls': success_calls,
                'error_calls': error_calls,
                'error_rate': round((error_calls / total_calls * 100.0), 2) if total_calls else 0.0,
                'avg_latency_ms': round(latency_sum / total_calls, 2) if total_calls else 0.0
            },
            'labels': day_labels,
            'series': series,
            'top_tools': top_tools,
            'top_failed_tools_24h': top_failed_tools_24h,
            'top_providers': top_providers,
            'top_models': top_models
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@stats_bp.route('/api/admin/tokens/timeseries', methods=['GET'])
@require_admin
def admin_token_timeseries():
    """返回管理端 token 按天趋势，用于折线图展示"""
    try:
        days = int(request.args.get('days', 30) or 30)
    except Exception:
        days = 30
    days = max(1, min(days, 365))

    today = datetime.now().date()
    labels = []
    buckets = {}
    for i in range(days - 1, -1, -1):
        d = today - timedelta(days=i)
        key = d.strftime('%Y-%m-%d')
        labels.append(key)
        buckets[key] = {
            'input_tokens': 0,
            'output_tokens': 0,
            'total_tokens': 0,
            'requests': 0
        }

    provider_totals = {}
    model_totals = {}

    def add_log(log: Dict[str, Any]) -> None:
        if not isinstance(log, dict):
            return

        timestamp = _status_parse_timestamp(log.get('timestamp'))

        if not isinstance(timestamp, datetime):
            return

        day = timestamp.strftime('%Y-%m-%d')

        if day not in buckets:
            return

        in_tokens = _safe_int_status(log.get('input_tokens', 0), 0)
        out_tokens = _safe_int_status(log.get('output_tokens', 0), 0)
        total = log.get('total_tokens', None)

        if total is None:
            total = in_tokens + out_tokens

        total = _safe_int_status(total, in_tokens + out_tokens)
        buckets[day]['input_tokens'] += in_tokens
        buckets[day]['output_tokens'] += out_tokens
        buckets[day]['total_tokens'] += total
        buckets[day]['requests'] += 1

        provider = str(log.get('provider') or 'unknown').strip() or 'unknown'
        model = str(log.get('model') or 'unknown').strip() or 'unknown'

        if provider not in provider_totals:
            provider_totals[provider] = {'tokens': 0, 'requests': 0}

        if model not in model_totals:
            model_totals[model] = {'tokens': 0, 'requests': 0}

        provider_totals[provider]['tokens'] += total
        provider_totals[provider]['requests'] += 1
        model_totals[model]['tokens'] += total
        model_totals[model]['requests'] += 1

    user_dir = safe_join_path(BASE_DIR, "data", "users")

    if os.path.exists(user_dir):
        for username in os.listdir(user_dir):
            token_file = safe_join_path(user_dir, username, "token_usage.json")

            for log in _status_dedupe_token_logs(read_usage_log_records(token_file), 'chat'):
                add_log(log)

    for log in _status_dedupe_token_logs(list(iter_papi_token_log_entries()), 'papi'):
        add_log(log)

    series = {
        'input_tokens': [buckets[d]['input_tokens'] for d in labels],
        'output_tokens': [buckets[d]['output_tokens'] for d in labels],
        'total_tokens': [buckets[d]['total_tokens'] for d in labels],
        'requests': [buckets[d]['requests'] for d in labels],
    }

    top_providers = sorted(
        [{'name': k, 'tokens': v['tokens'], 'requests': v['requests']} for k, v in provider_totals.items()],
        key=lambda x: x['tokens'],
        reverse=True
    )[:8]
    top_models = sorted(
        [{'name': k, 'tokens': v['tokens'], 'requests': v['requests']} for k, v in model_totals.items()],
        key=lambda x: x['tokens'],
        reverse=True
    )[:10]

    return jsonify({
        'success': True,
        'days': days,
        'labels': labels,
        'series': series,
        'top_providers': top_providers,
        'top_models': top_models
    })
