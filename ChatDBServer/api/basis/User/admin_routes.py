"""
Nexora.basis.User.admin_routes — 管理端用户账号路由（自 server.py 分批迁移）

- /api/admin/users (GET/POST), /api/admin/user/add (POST)
- /api/admin/users/<username> + /api/admin/user/delete (DELETE/POST)
- /api/admin/users/<username>/role + /api/admin/user/role (PATCH/POST)
- /api/admin/users/<username>/password + /api/admin/user/password (PATCH/POST)
- /api/admin/users/<user_id>/profile + /api/admin/user/profile (PATCH/POST)

复用 routes.py 的 user_bp 蓝图；用户目录基准经本模块 BASE_DIR 自推导，
与 server.py 的 DATA_DIR 同源。
"""

import json
import os
import time
from pathlib import Path

from flask import current_app, jsonify, request, session

from App.Utils import resolve_configured_path, safe_join_path
from basis.Permission import require_admin
from basis.Permission.model_permissions import get_user_model_blacklist
from basis.TokenUsage import dedupe_token_log_records, iter_papi_token_log_entries, read_usage_log_records
from basis.User import load_users, save_users

from .routes import build_user_avatar_url, get_local_mail_profile, user_bp

# 与 server.py 顶部常量同源（ChatDBServer 根 = 本文件向上 4 级）
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

_get_config_all = None


def configure_user_admin_routes(get_config_all):
    """server 组装期注入依赖（仅允许调用一次）。"""
    global _get_config_all

    if _get_config_all is not None:
        raise RuntimeError('user admin routes already configured')

    _get_config_all = get_config_all


def _resolve_user_data_path(user_id, info):
    default_path = safe_join_path(BASE_DIR, 'data', 'users', str(user_id or '').strip())
    raw_path = str((info or {}).get('path') or '').strip() if isinstance(info, dict) else ''

    if not raw_path:
        return default_path

    return resolve_configured_path(BASE_DIR, raw_path, fallback=default_path)


def _safe_token_total(log):
    if not isinstance(log, dict):
        return 0

    total = log.get('total_tokens', None)

    if total is None:
        total = log.get('input_tokens', 0) + log.get('output_tokens', 0)

    try:
        return max(0, int(total or 0))
    except Exception:
        return 0


def _is_safe_username(username) -> bool:
    """username 用作目录名，拒绝路径分隔符与相对路径标记。"""
    return bool(username) and '/' not in username and '\\' not in username and username not in ('.', '..')


@user_bp.route('/api/admin/users', methods=['GET'])
@require_admin
def admin_get_users():
    """获取所有用户信息"""
    try:
        users = load_users()
        papi_totals = {}

        for log in dedupe_token_log_records(list(iter_papi_token_log_entries()), 'papi'):
            username = str(log.get('username') or '').strip()

            if username:
                papi_totals[username] = papi_totals.get(username, 0) + _safe_token_total(log)

        user_list = []
        for user_id, info in users.items():
            # 计算总 token 消耗 (从 token_usage.json 读取)
            total_tokens = 0
            user_path = _resolve_user_data_path(user_id, info)
            user_token_file = safe_join_path(user_path, 'token_usage.json')
            try:
                tokens = dedupe_token_log_records(read_usage_log_records(user_token_file), 'chat')

                for log in tokens:
                    total_tokens += _safe_token_total(log)
            except Exception as e:
                current_app.logger.warning('admin user token usage load failed for %s: %s', user_id, e)

            total_tokens += papi_totals.get(str(user_id), 0)

            user_list.append({
                'user_id': user_id,
                'username': info.get('display_name', user_id),
                'has_password': bool(info.get('password')),
                'role': info.get('role', 'member'),
                'last_ip': info.get('last_ip', '未知'),
                'last_login': info.get('last_login'),
                'created_at': info.get('created_at'),
                'total_token_usage': total_tokens,
                'avatar_url': build_user_avatar_url(user_id, info),
                'local_mail': get_local_mail_profile(info)
            })
        user_list.sort(key=lambda x: (x['role'] != 'admin', x['user_id']))
        return jsonify({'success': True, 'users': user_list})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@user_bp.route('/api/admin/users', methods=['POST'])
@user_bp.route('/api/admin/user/add', methods=['POST'])
@require_admin
def admin_add_user():
    """添加用户"""
    data = request.get_json()
    username = (data.get('username') or '').strip()
    password = data.get('password')
    display_name = (data.get('display_name') or '').strip()
    role = data.get('role', 'member')

    if not username or not password:
        return jsonify({'success': False, 'message': '用户名和密码不能为空'})
    if not _is_safe_username(username):
        return jsonify({'success': False, 'message': '用户名不能包含路径分隔符'})

    try:
        users = load_users()

        if username in users:
            return jsonify({'success': False, 'message': '用户已存在'})

        # 初始化用户目录
        user_path = safe_join_path(BASE_DIR, 'data', 'users', username)
        os.makedirs(user_path, exist_ok=True)
        os.makedirs(safe_join_path(user_path, "database"), exist_ok=True)
        os.makedirs(safe_join_path(user_path, "conversations"), exist_ok=True)

        # 初始化 database.json
        db_file = safe_join_path(user_path, "database.json")
        if not os.path.exists(db_file):
            Path(db_file).write_text(
                json.dumps({"data_short": {}, "data_basis": {}}, indent=4, ensure_ascii=False),
                encoding='utf-8'
            )

        # 初始化知识图谱和Token统计文件（防止前端报错）
        kg_file = safe_join_path(user_path, "knowledge_graph.json")
        if not os.path.exists(kg_file):
            Path(kg_file).write_text(
                json.dumps({"nodes": [], "links": []}, indent=4, ensure_ascii=False),
                encoding='utf-8'
            )

        token_file = safe_join_path(user_path, "token_usage.json")
        if not os.path.exists(token_file):
            Path(token_file).write_text(json.dumps([], indent=4, ensure_ascii=False), encoding='utf-8')

        users[username] = {
            "username": username,
            "display_name": display_name or username,
            "password": password,
            "path": user_path,
            "role": role,
            "last_ip": "从未登录",
            "created_at": int(time.time()),
            "local_mail": {
                "provider": "nexoramail",
                "group": "default",
                "username": "",
                "address": "",
                "linked_at": None
            }
        }
        save_users(users)

        return jsonify({'success': True, 'message': '用户添加成功'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@user_bp.route('/api/admin/users/<path:target_username>', methods=['DELETE'])
@user_bp.route('/api/admin/user/delete', methods=['POST'])
@require_admin
def admin_delete_user(target_username=None):
    """删除用户"""
    data = request.get_json(silent=True) or {}
    username = target_username or data.get('target_user_id') or data.get('target_username')

    if username == session['username']:
        return jsonify({'success': False, 'message': '不能删除自己'})

    try:
        users = load_users()

        if username not in users:
            return jsonify({'success': False, 'message': '用户不存在'})

        del users[username]

        save_users(users)

        # 注意：此处不主动删除磁盘文件，以防操作失误（数据无价）
        return jsonify({'success': True, 'message': '用户账号已注销'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@user_bp.route('/api/admin/users/<path:target_username>/role', methods=['PATCH'])
@user_bp.route('/api/admin/user/role', methods=['POST'])
@require_admin
def admin_set_role(target_username=None):
    """修改用户权限"""
    data = request.get_json(silent=True) or {}
    username = target_username or data.get('user_id') or data.get('username') or data.get('target_username')
    new_role = data.get('role')  # 'admin' or 'member'

    if not username or not new_role:
        return jsonify({'success': False, 'message': '参数不完整'})

    if username == session.get('username'):
        return jsonify({'success': False, 'message': '管理员不能修改自己的权限'})

    try:
        users = load_users()

        if username not in users:
            return jsonify({'success': False, 'message': '用户不存在'})

        users[username]['role'] = new_role

        save_users(users)

        return jsonify({'success': True, 'message': f'用户 {username} 已设为 {new_role}'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@user_bp.route('/api/admin/users/<path:target_username>/password', methods=['PATCH'])
@user_bp.route('/api/admin/user/password', methods=['POST'])
@require_admin
def admin_set_password(target_username=None):
    """修改用户密码"""
    data = request.get_json(silent=True) or {}
    username = target_username or data.get('target_user_id') or data.get('target_username')
    new_password = data.get('password')

    if not username or not new_password:
        return jsonify({'success': False, 'message': '参数不完整'})

    try:
        users = load_users()

        if username not in users:
            return jsonify({'success': False, 'message': '用户不存在'})

        users[username]['password'] = new_password

        save_users(users)

        return jsonify({'success': True, 'message': '密码重置成功'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@user_bp.route('/api/admin/users/<user_id>/profile', methods=['PATCH'])
@user_bp.route('/api/admin/user/profile', methods=['POST'])
@require_admin
def admin_update_user_profile(user_id=None):
    """管理员更新用户资料（显示名）"""
    data = request.get_json(silent=True) or {}
    user_id = user_id or data.get('user_id') or data.get('target_user_id') or data.get('target_username')
    display_name = (data.get('display_name') or '').strip()
    if not user_id:
        return jsonify({'success': False, 'message': '缺少用户ID'}), 400
    if not display_name:
        return jsonify({'success': False, 'message': '用户名不能为空'}), 400
    if len(display_name) > 32:
        return jsonify({'success': False, 'message': '用户名长度不能超过 32'}), 400
    try:
        users = load_users()
        if user_id not in users:
            return jsonify({'success': False, 'message': '用户不存在'}), 404
        users[user_id]['display_name'] = display_name
        save_users(users)
        return jsonify({'success': True, 'message': '用户资料已更新'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@user_bp.route('/api/admin/users/<target_username>/models', methods=['GET'])
@user_bp.route('/api/admin/user/models', methods=['GET'])
@require_admin
def admin_get_user_models(target_username=None):
    """获取用户可用模型列表（管理员）"""
    target_username = (target_username or request.args.get('username', '')).strip() or ''

    if not target_username:
        return jsonify({"success": False, "message": "Missing username"}), 400

    try:
        config = _get_config_all()
        all_models = config.get('models', {})
        blacklist = get_user_model_blacklist(target_username)

        models = []
        for model_id, info in all_models.items():
            models.append({
                'id': model_id,
                'name': info.get('name', model_id),
                'provider': info.get('provider', 'volcengine'),
                'status': info.get('status', 'normal'),
                'is_blocked': model_id in blacklist
            })

        return jsonify({"success": True, "models": models})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)})


@user_bp.route('/api/admin/users/<target_username>/models', methods=['PUT'])
@user_bp.route('/api/admin/user/models/update', methods=['POST'])
@require_admin
def admin_update_user_models(target_username=None):
    """更新用户的模型黑名单"""
    data = request.get_json(silent=True) or {}
    target_username = target_username or data.get('username')
    blocked_models = data.get('blocked_models', [])  # 传递 ID 列表

    if not target_username:
        return jsonify({"success": False, "message": "Missing username"}), 400

    try:
        blacklist_path = './data/model_permissions.json'
        if not os.path.exists(blacklist_path):
            perm_config = {"default_blacklist": [], "user_blacklists": {}}
        else:
            perm_config = json.loads(Path(blacklist_path).read_text(encoding='utf-8'))

        # 更新黑名单
        if 'user_blacklists' not in perm_config:
            perm_config['user_blacklists'] = {}

        perm_config['user_blacklists'][target_username] = blocked_models

        Path(blacklist_path).write_text(
            json.dumps(perm_config, indent=4, ensure_ascii=False),
            encoding='utf-8'
        )

        return jsonify({'success': True, 'message': f'用户 {target_username} 的模型权限已更新'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})
