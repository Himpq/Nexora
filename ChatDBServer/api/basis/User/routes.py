"""
Nexora.basis.User.routes — 用户域路由（自 server.py 分批迁移）

组装契约：server.py 注册本蓝图前必须调用 configure_user_routes() 注入
server 根目录、配置访问函数与公网 URL 解析函数。未装配即处理请求视为
组装顺序错误，本模块刻意不设任何兜底默认值。
"""

import base64
import binascii
import os
import time
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List

from flask import Blueprint, g, jsonify, request, send_file, session

from App.Components import get_learning_runtime_local_config
from App.Utils import as_bool, safe_join_path
from basis.Permission import require_login
from basis.Permission.model_permissions import get_user_model_blacklist
from basis.Timeline import record_notes_snapshot_change
from basis.TokenUsage import read_usage_log_records
from basis.User import User, load_users, save_users

user_bp = Blueprint('user', __name__)

_server_root = ''
_get_config_all = None
_get_public_base_url = None


def configure_user_routes(server_root, get_config_all, get_public_base_url):
    """
    server 组装期注入依赖（仅允许调用一次）。

    server_root:        server 根目录（头像文件与 Papi token 日志的定位基准）
    get_config_all:     配置访问函数（含迁移钩子的 server 侧包装）
    get_public_base_url: 公网 URL 解析函数（头像绝对地址拼接用）
    """
    global _server_root, _get_config_all, _get_public_base_url

    if _get_config_all is not None:
        raise RuntimeError('user routes already configured')

    _server_root = server_root
    _get_config_all = get_config_all
    _get_public_base_url = get_public_base_url


def _users_root_abs():
    """data/users 目录的绝对路径（用户文件的寻址边界）。"""
    return os.path.abspath(safe_join_path(_server_root, 'data', 'users'))


def _path_inside_users_root(target):
    """校验规范化后的目标路径不越出 data/users 目录。"""
    target_abs = os.path.abspath(target)
    return os.path.commonpath([target_abs, _users_root_abs()]) == _users_root_abs()


def _is_safe_user_id(user_id) -> bool:
    """
    user_id 同时用作文件系统目录名与路由参数，
    显式拒绝路径分隔符与相对路径标记。
    """
    uid = str(user_id or '').strip()
    return bool(uid) and '/' not in uid and '\\' not in uid and uid not in ('.', '..')


def get_user_avatar_file(user_id):
    avatar_path = safe_join_path(_server_root, 'data', 'users', str(user_id), 'profile', 'avatar.png')

    if not _path_inside_users_root(avatar_path):
        raise ValueError(f'avatar path escapes users root: {user_id!r}')

    return avatar_path


def build_user_avatar_url(user_id, user_data):
    avatar_file = get_user_avatar_file(user_id)
    if not os.path.exists(avatar_file):
        return ''
    stamp = int(user_data.get('avatar_updated_at') or os.path.getmtime(avatar_file))
    avatar_path = f'/api/user/avatar/{user_id}?v={stamp}'
    if _get_public_base_url is not None:
        try:
            base_url = _get_public_base_url().rstrip('/')
            if base_url:
                return f'{base_url}{avatar_path}'
        except Exception:
            pass
    return avatar_path


def get_local_mail_profile(user_data):
    """标准化用户 local_mail 字段（默认空绑定）"""
    default_profile = {
        'provider': 'nexoramail',
        'group': 'default',
        'username': '',
        'address': '',
        'linked_at': None
    }
    if not isinstance(user_data, dict):
        return default_profile
    raw = user_data.get('local_mail')
    if not isinstance(raw, dict):
        return default_profile
    profile = deepcopy(default_profile)
    for k in default_profile.keys():
        if k in raw:
            profile[k] = raw.get(k)
    profile['username'] = str(profile.get('username') or '').strip()
    profile['address'] = str(profile.get('address') or '').strip()
    profile['group'] = str(profile.get('group') or 'default').strip() or 'default'
    profile['provider'] = str(profile.get('provider') or 'nexoramail').strip() or 'nexoramail'
    if not profile['username']:
        profile['address'] = ''
        profile['linked_at'] = None
    return profile


def get_user_stats(username, user_path):
    """获取用户统计信息"""
    stats = {
        'total_conversations': 0,
        'total_tokens': 0,
        'total_knowledge': 0,
        'model_usage': {},
        'source_usage': {},
        'api_key_usage': {},
        'daily_usage': {},
    }

    try:
        # 计算对话数量
        conversations_path = safe_join_path(user_path, 'conversations')
        if os.path.exists(conversations_path):
            conversation_files = [f for f in os.listdir(conversations_path) if f.endswith('.json')]
            stats['total_conversations'] = len(conversation_files)

        # 计算知识点数量
        knowledge_path = safe_join_path(user_path, 'database')
        if os.path.exists(knowledge_path):
            knowledge_files = [f for f in os.listdir(knowledge_path) if f.endswith('.json')]
            stats['total_knowledge'] = len(knowledge_files)

        # 从token_usage.json获取统计信息
        token_usage_path = safe_join_path(user_path, 'token_usage.json')
        token_records = read_usage_log_records(token_usage_path)

        papi_root = safe_join_path(_server_root, 'data', 'papi')

        if os.path.isdir(papi_root):
            for key_slug in os.listdir(papi_root):
                token_log = safe_join_path(papi_root, key_slug, 'token_log.jsonl')

                if not os.path.isfile(token_log):
                    continue

                for record in read_usage_log_records(token_log):
                    if str(record.get('username') or '').strip() == str(username or '').strip():
                        token_records.append(record)

        if token_records:
            total_tokens = 0
            model_usage = {}
            source_usage = {}
            api_key_usage = {}
            daily_usage = {}

            for record in token_records:
                total_tokens += record.get('total_tokens', 0)

                # 统计模型使用情况（这里简化处理，实际可能需要从对话记录中提取）
                # 暂时用action字段作为模型标识
                action = record.get('action', 'unknown')
                if action not in model_usage:
                    model_usage[action] = 0
                model_usage[action] += 1

                source = str(record.get('source') or 'chat').strip() or 'chat'
                source_usage[source] = source_usage.get(source, 0) + record.get('total_tokens', 0)

                api_key = str(record.get('api_key_name') or record.get('api_key_id') or '').strip()

                if api_key:
                    api_key_usage[api_key] = api_key_usage.get(api_key, 0) + record.get('total_tokens', 0)

                day = str(record.get('timestamp') or '')[:10]

                if day:
                    day_item = daily_usage.setdefault(day, {})
                    day_item[source] = day_item.get(source, 0) + record.get('total_tokens', 0)

            stats['total_tokens'] = total_tokens
            stats['model_usage'] = model_usage
            stats['source_usage'] = source_usage
            stats['api_key_usage'] = api_key_usage
            stats['daily_usage'] = daily_usage

    except Exception as e:
        print(f"Error getting user stats for {username}: {e}")

    return stats


# ==================== 用户信息 API ====================

@user_bp.route('/api/user/info', methods=['GET'])
def get_user_info():
    """获取当前登录用户的信息"""
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401

    try:
        users = getattr(g, 'session_users_meta', None)
        if not isinstance(users, dict):
            users = load_users()

        if username not in users:
            return jsonify({'success': False, 'message': '用户不存在'}), 404

        user_data = users[username]
        display_name = user_data.get('display_name', username)
        lite_mode = as_bool(request.args.get('lite') or request.headers.get('X-Nexora-User-Lite'), False)

        stats = {}
        if not lite_mode:
            # 完整用户信息接口会统计对话、知识库和 Token；跨服务鉴权只需要轻量身份字段。
            user_path = user_data.get('path', f'./data/users/{username}/')
            stats = get_user_stats(username, user_path)

        return jsonify({
            'success': True,
            'user': {
                'id': username,
                'username': display_name,
                'role': user_data.get('role', 'member'),
                'created_at': user_data.get('created_at'),  # 如果有创建时间
                'last_login': user_data.get('last_login'),  # 如果有最后登录时间
                'total_tokens': user_data.get('token_usage', 0),
                'avatar_url': build_user_avatar_url(username, user_data),
                'local_mail': get_local_mail_profile(user_data),
                'stats': stats
            }
        })
    except Exception as e:
        print(f"Error reading user info: {e}")
        return jsonify({'success': False, 'message': '获取用户信息失败'}), 500


@user_bp.route('/api/user/search', methods=['GET'])
@require_login
def search_users():
    """搜索用户，用于 @ 提及自动补全"""
    try:
        query = str(request.args.get('q') or '').strip()
        try:
            limit = max(1, min(int(request.args.get('limit') or 8), 20))
        except Exception:
            limit = 8
        users = load_users()
        if not isinstance(users, dict):
            return jsonify({'success': True, 'items': [], 'total': 0, 'query': query})
        query_lower = query.lower()
        rows = []
        for user_id, user_data in users.items():
            if not isinstance(user_data, dict):
                continue
            uid = str(user_id or '').strip()
            if not uid:
                continue
            display_name = str(user_data.get('display_name') or '').strip()
            nickname = str(user_data.get('nickname') or '').strip()
            username = str(user_data.get('username') or uid).strip() or uid
            haystacks = [uid.lower(), username.lower(), display_name.lower(), nickname.lower()]
            if query and not any(query_lower in item for item in haystacks if item):
                continue
            avatar_url = build_user_avatar_url(uid, user_data)
            prefix_score = 0
            for item in haystacks:
                if item.startswith(query_lower) and query_lower:
                    prefix_score = 1
                    break
            rows.append({
                'user_id': uid,
                'username': username,
                'display_name': display_name,
                'nickname': nickname,
                'role': str(user_data.get('role') or 'member').strip() or 'member',
                'avatar_url': str(avatar_url or '').strip(),
                '_prefix': prefix_score,
            })
        rows.sort(key=lambda item: (-int(item.get('_prefix') or 0), str(item.get('user_id') or '').lower()))
        items = [{
            'user_id': str(item.get('user_id') or '').strip(),
            'username': str(item.get('username') or '').strip(),
            'display_name': str(item.get('display_name') or '').strip(),
            'nickname': str(item.get('nickname') or '').strip(),
            'role': str(item.get('role') or 'member').strip() or 'member',
            'avatar_url': str(item.get('avatar_url') or '').strip(),
        } for item in rows[:limit]]
        return jsonify({'success': True, 'items': items, 'total': len(items), 'query': query})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@user_bp.route('/api/user/profile', methods=['PUT'])
@user_bp.route('/api/user/profile/update', methods=['POST'])
@require_login
def update_user_profile():
    """更新当前用户资料（显示名、头像）"""
    user_id = session.get('username')
    data = request.get_json(silent=True) or {}
    new_name = (data.get('display_name') or '').strip()
    avatar_base64 = data.get('avatar_base64')

    if not new_name:
        return jsonify({'success': False, 'message': '用户名不能为空'}), 400
    if len(new_name) > 32:
        return jsonify({'success': False, 'message': '用户名长度不能超过 32'}), 400
    if not _is_safe_user_id(user_id):
        return jsonify({'success': False, 'message': '用户不存在'}), 404

    try:
        users = load_users()
        if user_id not in users:
            return jsonify({'success': False, 'message': '用户不存在'}), 404

        users[user_id]['display_name'] = new_name

        if avatar_base64:
            if not isinstance(avatar_base64, str) or ',' not in avatar_base64:
                return jsonify({'success': False, 'message': '头像数据格式错误'}), 400
            _, b64_data = avatar_base64.split(',', 1)
            try:
                raw = base64.b64decode(b64_data, validate=True)
            except (binascii.Error, ValueError):
                return jsonify({'success': False, 'message': '头像解码失败'}), 400
            if len(raw) > 6 * 1024 * 1024:
                return jsonify({'success': False, 'message': '头像过大，最大 6MB'}), 400
            avatar_path = get_user_avatar_file(user_id)

            if not _path_inside_users_root(avatar_path):
                return jsonify({'success': False, 'message': '用户不存在'}), 404

            profile_dir = os.path.dirname(avatar_path)
            os.makedirs(profile_dir, exist_ok=True)
            Path(avatar_path).write_bytes(raw)
            users[user_id]['avatar_updated_at'] = int(time.time())

        save_users(users)
        return jsonify({
            'success': True,
            'message': '资料已更新',
            'user': {
                'id': user_id,
                'username': users[user_id].get('display_name', user_id),
                'avatar_url': build_user_avatar_url(user_id, users[user_id])
            }
        })
    except Exception as e:
        print(f"Error updating user profile: {e}")
        return jsonify({'success': False, 'message': '更新失败'}), 500


@user_bp.route('/api/user/local-mail', methods=['GET'])
@require_login
def get_current_user_local_mail():
    """获取当前用户绑定的本地邮箱信息"""
    user_id = session.get('username')
    users = load_users()
    if user_id not in users:
        return jsonify({'success': False, 'message': '用户不存在'}), 404
    return jsonify({'success': True, 'local_mail': get_local_mail_profile(users[user_id])})


@user_bp.route('/api/notes/store', methods=['GET'])
@require_login
def get_notes_store():
    """获取当前用户笔记云存储。"""
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401
    try:
        user = User(username)
        store = user.get_notes_store()
        return jsonify({'success': True, 'store': store})
    except Exception as e:
        print(f"Error getting notes store: {e}")
        return jsonify({'success': False, 'message': '获取笔记失败'}), 500


@user_bp.route('/api/notes/store', methods=['PUT', 'POST'])
@require_login
def save_notes_store():
    """基于客户端上次读取的快照合并当前用户笔记云存储。"""
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401

    payload = request.get_json(silent=True) or {}
    store = payload.get('store')
    base_store = payload.get('baseStore')
    if not isinstance(store, dict):
        return jsonify({'success': False, 'message': 'store 参数缺失或格式错误'}), 400
    if not isinstance(base_store, dict):
        return jsonify({'success': False, 'message': 'baseStore 参数缺失或格式错误'}), 400

    try:
        user = User(username)
        before_store = user.get_notes_store()
        normalized = user.save_notes_store(store, base_store)
        try:
            record_notes_snapshot_change(
                username,
                before_store,
                normalized,
                actor_type='user',
                actor_name=username,
            )
        except Exception:
            pass
        return jsonify({'success': True, 'store': normalized})
    except Exception as e:
        print(f"Error saving notes store: {e}")
        return jsonify({'success': False, 'message': '保存笔记失败'}), 500


@user_bp.route('/api/user/avatar/<user_id>', methods=['GET'])
def get_user_avatar(user_id):
    """Serve an existing user's profile avatar as a bounded public image resource."""
    safe_user_id = str(user_id or '').strip()
    if not _is_safe_user_id(safe_user_id):
        return jsonify({'success': False, 'message': 'user_id is required'}), 400

    users = load_users()
    if safe_user_id not in users:
        return jsonify({'success': False, 'message': 'user not found'}), 404

    avatar_file = get_user_avatar_file(safe_user_id)
    if not os.path.exists(avatar_file):
        return jsonify({'success': False, 'message': 'avatar not found'}), 404

    return send_file(avatar_file, mimetype='image/png', conditional=True)


@user_bp.route('/api/user/stats', methods=['GET'])
def get_user_stats_api():
    """获取当前用户的统计信息"""
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401

    try:
        users = load_users()

        if username not in users:
            return jsonify({'success': False, 'message': '用户不存在'}), 404

        user_data = users[username]
        user_path = user_data.get('path', f'./data/users/{username}/')
        stats = get_user_stats(username, user_path)

        return jsonify({
            'success': True,
            'stats': stats
        })
    except Exception as e:
        print(f"Error getting user stats: {e}")
        return jsonify({'success': False, 'message': '获取统计信息失败'}), 500


def _get_learning_runtime_for_user_preferences() -> Dict[str, Any]:
    """偏好接口只读取本地 Learning runtime 配置，避免刷新时同步探测可选服务。"""
    return get_learning_runtime_local_config()


@user_bp.route('/api/user/preferences', methods=['GET', 'PUT'])
def get_user_preferences():
    """获取当前用户的偏好设置"""
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401

    try:
        user = User(username)

        if request.method == 'PUT':
            payload = request.get_json(silent=True) or {}
            updates: Dict[str, Any] = {}
            for key in ('default_model', 'theme', 'streaming', 'language', 'learning_mode', 'memory_update_model', 'default_open_view'):
                if key in payload:
                    updates[key] = payload.get(key)

            memory_update_model = str(updates.get('memory_update_model') or '').strip()

            if memory_update_model:
                models = _get_config_all().get('models', {})

                if memory_update_model not in models:
                    return jsonify({'success': False, 'message': '记忆更新模型不存在'}), 400

                if memory_update_model in get_user_model_blacklist(username):
                    return jsonify({'success': False, 'message': '当前用户不可使用该记忆更新模型'}), 403

            # learning_runtime 为用户级 Learning 入口开关({enabled: bool});管理端运行时配置经顶层 learning_runtime 下发,不落用户偏好
            learning_runtime_payload = payload.get('learning_runtime')

            if learning_runtime_payload is not None:
                if not isinstance(learning_runtime_payload, dict) or not isinstance(learning_runtime_payload.get('enabled'), bool):
                    return jsonify({'success': False, 'message': 'learning_runtime 配置格式不正确'}), 400

                updates['learning_runtime'] = {'enabled': learning_runtime_payload['enabled']}

            quota_payload = payload.get('quota')
            if isinstance(quota_payload, dict):
                updates['quota'] = quota_payload
            else:
                legacy_quota_payload = {}
                for key in ('quota_enabled', 'quota_remaining_tokens', 'quota_warn_threshold_tokens', 'quota_on_exhausted'):
                    if key in payload:
                        legacy_quota_payload[key] = payload.get(key)
                if legacy_quota_payload:
                    updates.update(legacy_quota_payload)

            saved = user.update_preferences(updates)

            # 偏好接口不做运行时探测，避免可选 Learning 服务拖慢页面刷新。
            learning_runtime = _get_learning_runtime_for_user_preferences()
            return jsonify({
                'success': True,
                'preferences': saved,
                'quota': saved.get('quota', {}) if isinstance(saved, dict) else {},
                'learning_runtime': learning_runtime,
            })

        preferences = user.get_preferences()

        # 偏好接口不做运行时探测，避免可选 Learning 服务拖慢页面刷新。
        learning_runtime = _get_learning_runtime_for_user_preferences()
        return jsonify({
            'success': True,
            'preferences': preferences,
            'quota': preferences.get('quota', {}) if isinstance(preferences, dict) else {},
            'learning_runtime': learning_runtime,
        })
    except Exception as e:
        print(f"Error getting user preferences: {e}")
        return jsonify({'success': False, 'message': '获取偏好设置失败'}), 500
