import json
import os
import time
import uuid
from typing import Any, Callable, Dict, List, Optional, Tuple

from flask import Blueprint, jsonify, request, session

from basis.Database import safe_append_jsonl, safe_write_text, get_path_lock
from App.Utils import safe_join_path
from App.errors import json_error as _json_error


notification_bp = Blueprint('notification', __name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DATA_DIR = os.path.join(BASE_DIR, 'data')
USERS_PATH = os.path.join(DATA_DIR, 'user.json')
PUBLIC_NOTIFICATIONS_PATH = os.path.join(DATA_DIR, 'public_notifications.jsonl')
NOTIFICATION_LEVELS = {'info', 'success', 'warning', 'error'}
_notification_realtime_publisher: Optional[Callable[[str, str, Dict[str, Any]], None]] = None


def configure_notification_realtime(publisher: Callable[[str, str, Dict[str, Any]], None]) -> None:
    """配置通知实时事件发布器，由主服务注入已有 browser WSS 通道。"""
    if not callable(publisher):
        raise ValueError('notification realtime publisher must be callable')

    global _notification_realtime_publisher
    _notification_realtime_publisher = publisher


def _publish_notification_event(username: str, event_type: str, payload: Dict[str, Any]) -> None:
    _assert_notification_realtime_configured()
    _notification_realtime_publisher(username, event_type, payload)


def _assert_notification_realtime_configured() -> None:
    if _notification_realtime_publisher is None:
        raise RuntimeError('notification realtime publisher is not configured')


def _load_users() -> Dict[str, Any]:
    if not os.path.exists(USERS_PATH):
        raise FileNotFoundError(f'user.json 不存在: {USERS_PATH}')

    with open(USERS_PATH, 'rb') as f:
        raw = f.read()

    users = json.loads(raw.decode('utf-8-sig'))

    if not isinstance(users, dict):
        raise ValueError('user.json 根节点必须是 JSON object')

    return users


def _current_username() -> str:
    username = str(session.get('username') or '').strip()

    if not username:
        raise PermissionError('未登录')

    users = _load_users()

    if username not in users:
        raise PermissionError('用户不存在，请重新登录')

    return username


def _require_current_admin_username() -> str:
    username = _current_username()
    users = _load_users()
    user_info = users.get(username)
    role = str(user_info.get('role') if isinstance(user_info, dict) else '').strip().lower()

    if role != 'admin' or str(session.get('role') or '').strip().lower() != 'admin':
        raise PermissionError('权限不足，仅管理员可操作公告')

    return username


def _list_notification_usernames() -> List[str]:
    users = _load_users()
    usernames: List[str] = []

    for username, user_info in users.items():
        safe_username = str(username or '').strip()

        if not safe_username or not isinstance(user_info, dict):
            raise ValueError('user.json 用户记录格式错误，无法发布公告')

        usernames.append(safe_username)

    if not usernames:
        raise ValueError('user.json 没有可接收公告的用户')

    return usernames


def _resolve_user_base_path(username: str) -> str:
    """解析当前用户目录，通知文件固定写入该目录下的 notification.jsonl。"""
    uname = str(username or '').strip()
    default_path = safe_join_path(DATA_DIR, 'users', uname) if uname else safe_join_path(DATA_DIR, 'users')

    if not uname:
        return default_path

    users_meta = _load_users()
    user_data = users_meta.get(uname, {}) if isinstance(users_meta, dict) else {}
    raw_path = str(user_data.get('path') or '').strip() if isinstance(user_data, dict) else ''

    if not raw_path:
        return default_path

    if os.path.isabs(raw_path):
        candidate = os.path.abspath(os.path.normpath(raw_path))
    else:
        candidate = os.path.abspath(os.path.normpath(os.path.join(BASE_DIR, raw_path)))

    try:
        inside_base_dir = os.path.commonpath([BASE_DIR, candidate]) == BASE_DIR
    except ValueError as exc:
        raise ValueError('用户目录配置越界，已拒绝读取 notification.jsonl') from exc

    if not inside_base_dir:
        raise ValueError('用户目录配置越界，已拒绝读取 notification.jsonl')

    return candidate


def _notification_jsonl_path(username: str) -> str:
    return safe_join_path(_resolve_user_base_path(username), 'notification.jsonl')


def _public_notification_state_path(username: str) -> str:
    return safe_join_path(_resolve_user_base_path(username), 'public_notification_state.json')


def _parse_notification_limit(raw_value: Any) -> int:
    raw = str(raw_value if raw_value is not None else '20').strip()

    if not raw:
        return 20

    try:
        limit = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError('limit 必须是整数') from exc

    if limit < 1 or limit > 50:
        raise ValueError('limit 必须在 1 到 50 之间')

    return limit


def _normalize_notification_row(row: Dict[str, Any], line_no: int = 0, file_label: str = 'notification.jsonl') -> Dict[str, Any]:
    payload = dict(row)
    label = f'第 {line_no} 行' if line_no else '通知记录'
    notification_id = str(payload.get('notification_id') or '').strip()

    if not notification_id:
        raise ValueError(f'{file_label} {label} 缺少 notification_id')

    title = str(payload.get('title') or '').strip()

    if not title:
        raise ValueError(f'{file_label} {label} 缺少 title')

    if 'date' not in payload:
        raise ValueError(f'{file_label} {label} 缺少 date')

    try:
        date_value = int(payload.get('date'))
    except (TypeError, ValueError) as exc:
        raise ValueError(f'{file_label} {label} 的 date 必须是整数时间戳') from exc

    level = str(payload.get('level') or 'info').strip().lower()

    if level not in NOTIFICATION_LEVELS:
        raise ValueError(f'{file_label} {label} 的 level 不支持: {level}')

    meta = payload.get('meta')

    if meta is None:
        meta = {}

    if not isinstance(meta, dict):
        raise ValueError(f'{file_label} {label} 的 meta 必须是 JSON object')

    payload['notification_id'] = notification_id
    payload['type'] = 'notification'
    payload['title'] = title
    payload['content'] = str(payload.get('content') or '')
    payload['jumpto'] = str(payload.get('jumpto') or '')
    payload['source'] = str(payload.get('source') or '')
    payload['date'] = date_value
    payload['level'] = level
    payload['read'] = bool(payload.get('read'))
    payload['removed'] = bool(payload.get('removed'))
    payload['meta'] = meta

    return payload


def _read_notification_rows_from_path(path: str, file_label: str = 'notification.jsonl') -> List[Dict[str, Any]]:
    """严格读取通知 JSONL，发现坏行直接报错并写入服务端日志。"""
    if not os.path.exists(path):
        return []

    with open(path, 'rb') as f:
        raw = f.read()

    if not raw.strip():
        return []

    text = raw.decode('utf-8-sig')
    rows: List[Dict[str, Any]] = []

    for line_no, line in enumerate(text.splitlines(), start=1):
        raw_line = str(line or '').strip()

        if not raw_line:
            continue

        try:
            payload = json.loads(raw_line)
        except json.JSONDecodeError as exc:
            raise ValueError(f'{file_label} 第 {line_no} 行 JSON 格式错误: {exc.msg}') from exc

        if not isinstance(payload, dict):
            raise ValueError(f'{file_label} 第 {line_no} 行必须是 JSON object')

        rows.append(_normalize_notification_row(payload, line_no, file_label))

    return rows


def _write_notification_rows_to_path(path: str, rows: List[Dict[str, Any]]) -> None:
    serialized = ''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows)
    safe_write_text(path, serialized, backup=True)


def _read_public_notification_state(username: str) -> Dict[str, Dict[str, int]]:
    path = _public_notification_state_path(username)
    lock = get_path_lock(path)

    with lock:
        if not os.path.exists(path):
            return {'read': {}}

        with open(path, 'rb') as f:
            raw = f.read()

        if not raw.strip():
            return {'read': {}}

        data = json.loads(raw.decode('utf-8-sig'))

    if not isinstance(data, dict):
        raise ValueError('public_notification_state.json 根节点必须是 JSON object')

    read_map = data.get('read')

    if read_map is None:
        read_map = {}

    if not isinstance(read_map, dict):
        raise ValueError('public_notification_state.json 的 read 必须是 JSON object')

    normalized_read: Dict[str, int] = {}

    for notification_id, timestamp in read_map.items():
        safe_id = str(notification_id or '').strip()

        if not safe_id:
            raise ValueError('public_notification_state.json 的 read 存在空 notification_id')

        try:
            normalized_read[safe_id] = int(timestamp)
        except (TypeError, ValueError) as exc:
            raise ValueError(f'public_notification_state.json 的 read.{safe_id} 必须是整数时间戳') from exc

    return {'read': normalized_read}


def _write_public_notification_state(username: str, state: Dict[str, Dict[str, int]]) -> None:
    path = _public_notification_state_path(username)
    lock = get_path_lock(path)
    serialized = json.dumps(state, ensure_ascii=False, indent=4)

    with lock:
        safe_write_text(path, serialized, backup=True)


def _read_public_notifications() -> List[Dict[str, Any]]:
    lock = get_path_lock(PUBLIC_NOTIFICATIONS_PATH)

    with lock:
        return _read_notification_rows_from_path(PUBLIC_NOTIFICATIONS_PATH, 'public_notifications.jsonl')


def _build_public_notification_view(row: Dict[str, Any], state: Dict[str, Dict[str, int]]) -> Dict[str, Any]:
    item = dict(row)
    notification_id = str(item.get('notification_id') or '').strip()
    read_at = int(state.get('read', {}).get(notification_id, 0) or 0)

    item['scope'] = 'public'
    item['public'] = True
    item['read'] = bool(read_at)

    if read_at:
        item['read_at'] = read_at

    return item


def _list_user_notifications(username: str, limit: int) -> Dict[str, Any]:
    path = _notification_jsonl_path(username)
    lock = get_path_lock(path)

    with lock:
        rows = _read_notification_rows_from_path(path)

    public_state = _read_public_notification_state(username)
    public_rows = _read_public_notifications()
    personal_rows = [row for row in rows if not bool(row.get('removed'))]
    public_visible_rows = [
        _build_public_notification_view(row, public_state)
        for row in public_rows
        if not bool(row.get('removed'))
    ]
    visible_rows = personal_rows + public_visible_rows
    visible_rows.sort(
        key=lambda row: (int(row.get('date') or 0), str(row.get('notification_id') or '')),
        reverse=True,
    )
    unread_count = sum(1 for row in visible_rows if not bool(row.get('read')))

    return {
        'items': visible_rows[:limit],
        'total': len(visible_rows),
        'unread_count': unread_count,
    }


def _read_notification_text_field(payload: Dict[str, Any], field: str, max_len: int, required: bool = False) -> str:
    value = str(payload.get(field) or '').strip()

    if required and not value:
        raise ValueError(f'{field} 不能为空')

    if len(value) > max_len:
        raise ValueError(f'{field} 不能超过 {max_len} 个字符')

    return value


def _build_notification_record(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError('请求体必须是 JSON object')

    title = _read_notification_text_field(payload, 'title', 120, required=True)
    content = _read_notification_text_field(payload, 'content', 4000)
    jumpto = _read_notification_text_field(payload, 'jumpto', 500)
    source = _read_notification_text_field(payload, 'source', 120)
    level = str(payload.get('level') or 'info').strip().lower()
    meta = payload.get('meta')

    if level not in NOTIFICATION_LEVELS:
        raise ValueError('level 只支持 info、success、warning、error')

    if meta is None:
        meta = {}

    if not isinstance(meta, dict):
        raise ValueError('meta 必须是 JSON object')

    now_ts = int(time.time())

    return {
        'notification_id': f'notice_{uuid.uuid4().hex[:16]}',
        'type': 'notification',
        'title': title,
        'content': content,
        'jumpto': jumpto,
        'source': source,
        'level': level,
        'date': now_ts,
        'read': False,
        'removed': False,
        'meta': meta,
    }


def _append_user_notification(username: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    path = _notification_jsonl_path(username)
    lock = get_path_lock(path)
    record = _normalize_notification_row(payload)

    safe_append_jsonl(path, record, lock=lock)
    return record


def create_user_notification(username: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """写入指定用户通知并通过浏览器实时通道推送。"""
    target_username = str(username or '').strip()

    if not target_username:
        raise ValueError('通知接收用户不能为空')

    _assert_notification_realtime_configured()
    record = _build_notification_record(payload)
    saved = _append_user_notification(target_username, record)
    summary = _list_user_notifications(target_username, 20)
    _publish_notification_event(target_username, 'notification_created', {
        'item': saved,
        'unread_count': summary['unread_count'],
        'total': summary['total'],
    })
    return saved


def _append_public_notification(payload: Dict[str, Any]) -> Dict[str, Any]:
    lock = get_path_lock(PUBLIC_NOTIFICATIONS_PATH)
    record = _normalize_notification_row(payload, file_label='public_notifications.jsonl')

    safe_append_jsonl(PUBLIC_NOTIFICATIONS_PATH, record, lock=lock)
    return record


def _delete_public_notification(notification_id: str, actor_username: str) -> Optional[Dict[str, Any]]:
    target_id = str(notification_id or '').strip()

    if not target_id:
        raise ValueError('notification_id 不能为空')

    lock = get_path_lock(PUBLIC_NOTIFICATIONS_PATH)
    deleted_row: Optional[Dict[str, Any]] = None
    next_rows: List[Dict[str, Any]] = []

    with lock:
        rows = _read_notification_rows_from_path(PUBLIC_NOTIFICATIONS_PATH, 'public_notifications.jsonl')

        for row in rows:
            if str(row.get('notification_id') or '') == target_id:
                deleted_row = dict(row)
                continue

            next_rows.append(row)

        if deleted_row is None:
            return None

        _write_notification_rows_to_path(PUBLIC_NOTIFICATIONS_PATH, next_rows)

    deleted_row['removed'] = True
    deleted_row['removed_at'] = int(time.time())
    deleted_row['removed_by'] = str(actor_username or '').strip()
    return deleted_row


def _mark_public_notification_read(username: str, notification_id: str) -> Optional[Dict[str, Any]]:
    target_id = str(notification_id or '').strip()

    if not target_id:
        raise ValueError('notification_id 不能为空')

    public_rows = _read_public_notifications()
    public_row = next(
        (row for row in public_rows if str(row.get('notification_id') or '') == target_id and not bool(row.get('removed'))),
        None,
    )

    if public_row is None:
        return None

    state = _read_public_notification_state(username)

    if target_id not in state['read']:
        state['read'][target_id] = int(time.time())
        _write_public_notification_state(username, state)

    return _build_public_notification_view(public_row, state)


def _update_user_notification(username: str, notification_id: str, updater) -> Tuple[Optional[Dict[str, Any]], int]:
    target_id = str(notification_id or '').strip()

    if not target_id:
        raise ValueError('notification_id 不能为空')

    path = _notification_jsonl_path(username)
    lock = get_path_lock(path)
    updated_row: Optional[Dict[str, Any]] = None
    next_rows: List[Dict[str, Any]] = []

    with lock:
        rows = _read_notification_rows_from_path(path)

        for row in rows:
            if str(row.get('notification_id') or '') == target_id:
                updated_row = updater(dict(row))
                next_rows.append(updated_row)
                continue

            next_rows.append(row)

        if updated_row is None:
            return None, 0

        _write_notification_rows_to_path(path, next_rows)

    visible_rows = [row for row in reversed(next_rows) if not bool(row.get('removed'))]
    unread_count = sum(1 for row in visible_rows if not bool(row.get('read')))

    return updated_row, unread_count


@notification_bp.route('/api/notifications', methods=['GET'])
def list_notifications():
    """返回当前登录用户的通知列表。"""
    try:
        username = _current_username()
        limit = _parse_notification_limit(request.args.get('limit'))
        data = _list_user_notifications(username, limit)
        return jsonify({'success': True, **data})
    except PermissionError as exc:
        return _json_error(str(exc), 401)
    except ValueError as exc:
        print(f"[Notification] list validation failed: {exc}")
        return _json_error(str(exc), 400)
    except Exception as exc:
        print(f"[Notification] list failed: {exc}")
        return _json_error('获取通知失败，请查看服务端日志', 500)


@notification_bp.route('/api/notifications', methods=['POST'])
def create_notification():
    """向当前登录用户的 notification.jsonl 追加一条通知。"""
    try:
        username = _current_username()
        _assert_notification_realtime_configured()
        payload = request.get_json(silent=True)
        record = _build_notification_record(payload)
        saved = _append_user_notification(username, record)
        summary = _list_user_notifications(username, 20)
        _publish_notification_event(username, 'notification_created', {
            'item': saved,
            'unread_count': summary['unread_count'],
            'total': summary['total'],
        })
        return jsonify({'success': True, 'item': saved, 'unread_count': summary['unread_count']})
    except PermissionError as exc:
        return _json_error(str(exc), 401)
    except ValueError as exc:
        print(f"[Notification] create validation failed: {exc}")
        return _json_error(str(exc), 400)
    except Exception as exc:
        print(f"[Notification] create failed: {exc}")
        return _json_error('保存通知失败，请查看服务端日志', 500)


@notification_bp.route('/api/notifications/announcement', methods=['POST'])
def create_announcement_notification():
    """管理员发布公告，写入公共公告文件。"""
    try:
        actor = _require_current_admin_username()
        _assert_notification_realtime_configured()
        payload = request.get_json(silent=True)
        record = _build_notification_record(payload)
        record['notification_id'] = f'public_notice_{uuid.uuid4().hex[:16]}'
        record['source'] = str(record.get('source') or '管理员公告').strip()
        record['scope'] = 'public'
        record['public'] = True
        record['meta'] = dict(record.get('meta') or {})
        record['meta']['announcement'] = True
        record['meta']['actor'] = actor
        usernames = _list_notification_usernames()
        saved = _append_public_notification(record)
        current_summary = _list_user_notifications(actor, 20)

        for username in usernames:
            user_summary = _list_user_notifications(username, 20)
            user_state = _read_public_notification_state(username)
            _publish_notification_event(username, 'notification_created', {
                'item': _build_public_notification_view(saved, user_state),
                'unread_count': user_summary['unread_count'],
                'total': user_summary['total'],
            })

        return jsonify({
            'success': True,
            'item': _build_public_notification_view(saved, _read_public_notification_state(actor)),
            'unread_count': current_summary['unread_count'],
            'target_count': len(usernames),
        })
    except PermissionError as exc:
        return _json_error(str(exc), 403)
    except ValueError as exc:
        print(f"[Notification] announcement validation failed: {exc}")
        return _json_error(str(exc), 400)
    except Exception as exc:
        print(f"[Notification] announcement failed: {exc}")
        return _json_error('发布公告失败，请查看服务端日志', 500)


@notification_bp.route('/api/notifications/<notification_id>/read', methods=['POST'])
def mark_notification_read(notification_id: str):
    """将一条通知标记为已读。"""
    def updater(row: Dict[str, Any]) -> Dict[str, Any]:
        if not bool(row.get('read')):
            row['read'] = True
            row['read_at'] = int(time.time())

        return row

    try:
        username = _current_username()
        _assert_notification_realtime_configured()
        updated, unread_count = _update_user_notification(username, notification_id, updater)

        if updated is None:
            updated = _mark_public_notification_read(username, notification_id)

        if updated is None:
            return _json_error('通知不存在', 404)

        summary = _list_user_notifications(username, 20)
        _publish_notification_event(username, 'notification_read', {
            'item': updated,
            'unread_count': summary['unread_count'],
        })
        return jsonify({'success': True, 'item': updated, 'unread_count': summary['unread_count']})
    except PermissionError as exc:
        return _json_error(str(exc), 401)
    except ValueError as exc:
        print(f"[Notification] read validation failed: {exc}")
        return _json_error(str(exc), 400)
    except Exception as exc:
        print(f"[Notification] read failed notification_id={notification_id}: {exc}")
        return _json_error('更新通知失败，请查看服务端日志', 500)


@notification_bp.route('/api/notifications/<notification_id>/remove', methods=['POST'])
def remove_notification(notification_id: str):
    """移除个人通知；管理员可移除公共公告。"""
    def updater(row: Dict[str, Any]) -> Dict[str, Any]:
        row['removed'] = True
        row['removed_at'] = int(time.time())

        return row

    try:
        username = _current_username()
        _assert_notification_realtime_configured()
        updated, unread_count = _update_user_notification(username, notification_id, updater)

        if updated is not None:
            summary = _list_user_notifications(username, 20)
            _publish_notification_event(username, 'notification_removed', {
                'item': updated,
                'unread_count': summary['unread_count'],
            })
            return jsonify({'success': True, 'item': updated, 'unread_count': summary['unread_count']})

        actor = _require_current_admin_username()
        deleted_public = _delete_public_notification(notification_id, actor)

        if deleted_public is None:
            return _json_error('通知不存在', 404)

        for target_username in _list_notification_usernames():
            target_summary = _list_user_notifications(target_username, 20)
            target_state = _read_public_notification_state(target_username)
            _publish_notification_event(target_username, 'notification_removed', {
                'item': _build_public_notification_view(deleted_public, target_state),
                'unread_count': target_summary['unread_count'],
            })

        actor_summary = _list_user_notifications(actor, 20)
        return jsonify({
            'success': True,
            'item': _build_public_notification_view(deleted_public, _read_public_notification_state(actor)),
            'unread_count': actor_summary['unread_count'],
        })
    except PermissionError as exc:
        return _json_error(str(exc), 401)
    except ValueError as exc:
        print(f"[Notification] remove validation failed: {exc}")
        return _json_error(str(exc), 400)
    except Exception as exc:
        print(f"[Notification] remove failed notification_id={notification_id}: {exc}")
        return _json_error('移除通知失败，请查看服务端日志', 500)
