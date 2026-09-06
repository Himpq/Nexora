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
from typing import Any, Dict, List, Optional, Set, Tuple

from flask import Blueprint, jsonify, request, session

from App.Utils import resolve_configured_path, safe_join_path
from basis.Permission import require_admin, require_login
from basis.TokenUsage import is_usage_log_path, read_usage_log_records, replace_usage_log_records
from basis.User import load_users, save_users

stats_bp = Blueprint('observability_stats', __name__)

# 与 server.py 顶部常量同源的数据文件路径（ChatDBServer 根 = 本文件向上 4 级）
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


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
