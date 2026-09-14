"""
Nexora.App.Mail.admin_routes — 管理端 NexoraMail 路由（自 server.py 分批迁移）

- /api/admin/nexora-mail/status, /groups, /users (GET/POST)
- /api/admin/users/<user_id>/local-mail + /api/admin/nexora-mail/bind (PUT/POST)
- /api/admin/users/<user_id>/local-mail + /api/admin/nexora-mail/unbind (DELETE/POST)
- /api/admin/nexora-mail/users/password (PATCH/POST)
- /api/admin/nexora-mail/users/delete (DELETE/POST)

复用 mailbox.py 的 mail_bp 蓝图与注入依赖（_get_nexora_mail_config、
_nexora_mail_call），本模块不引入新的组装契约。
"""

import time
from urllib import parse as urllib_parse

from flask import jsonify, request

from App.Utils import normalize_text
from basis.Permission import require_admin
from basis.User import load_users, save_users
from basis.User.routes import get_local_mail_profile

from .mailbox import _get_nexora_mail_config, _nexora_mail_call, mail_bp


@mail_bp.route('/api/admin/nexora-mail/status', methods=['GET'])
@require_admin
def admin_nexora_mail_status():
    """查询 NexoraMail 连接状态及基础配置"""
    cfg = _get_nexora_mail_config()
    ok, status, data = _nexora_mail_call('/api/health', method='GET')
    return jsonify({
        'success': True,
        'enabled': cfg.get('enabled', False),
        'service_url': cfg.get('service_url'),
        'default_group': cfg.get('default_group', 'default'),
        'connected': bool(ok),
        'upstream_status': status,
        'upstream': data
    })


@mail_bp.route('/api/admin/nexora-mail/groups', methods=['GET'])
@require_admin
def admin_nexora_mail_groups():
    """读取 NexoraMail 用户组列表"""
    ok, status, data = _nexora_mail_call('/api/groups', method='GET')
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '读取组列表失败'), 'upstream': data}), status
    return jsonify({'success': True, 'groups': data.get('groups', [])})


@mail_bp.route('/api/admin/nexora-mail/users', methods=['GET'])
@require_admin
def admin_nexora_mail_users():
    """读取 NexoraMail 用户列表"""
    cfg = _get_nexora_mail_config()
    group = normalize_text(request.args.get('group') or cfg.get('default_group') or 'default', default='default') or 'default'
    ok, status, data = _nexora_mail_call('/api/users', method='GET', query={'group': group})
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '读取邮箱用户失败'), 'upstream': data}), status
    return jsonify({
        'success': True,
        'group': data.get('group', group),
        'users': data.get('users', [])
    })


@mail_bp.route('/api/admin/nexora-mail/users', methods=['POST'])
@require_admin
def admin_nexora_mail_create_user():
    """创建 NexoraMail 用户，可选自动绑定到 Nexora 用户"""
    payload = request.get_json() or {}
    cfg = _get_nexora_mail_config()
    group = (payload.get('group') or cfg.get('default_group') or 'default').strip() or 'default'
    mail_username = (payload.get('mail_username') or payload.get('username') or '').strip()
    password = str(payload.get('password') or '')
    permissions = payload.get('permissions')
    bind_user_id = (payload.get('bind_user_id') or '').strip()
    domain = str(payload.get('domain') or '').strip()

    if not mail_username or not password:
        return jsonify({'success': False, 'message': 'mail_username 和 password 不能为空'}), 400

    body = {
        'group': group,
        'username': mail_username,
        'password': password
    }
    if isinstance(permissions, list):
        body['permissions'] = permissions

    ok, status, data = _nexora_mail_call('/api/users', method='POST', payload=body)
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '创建邮箱用户失败'), 'upstream': data}), status

    bind_result = None
    if bind_user_id:
        users = load_users()
        if bind_user_id not in users:
            return jsonify({
                'success': False,
                'message': f'邮箱用户已创建，但绑定失败：Nexora 用户 {bind_user_id} 不存在',
                'mail_user': data
            }), 404
        address = mail_username if '@' in mail_username else (f'{mail_username}@{domain}' if domain else '')
        users[bind_user_id]['local_mail'] = {
            'provider': 'nexoramail',
            'group': group,
            'username': mail_username,
            'address': address,
            'linked_at': int(time.time())
        }
        save_users(users)
        bind_result = {
            'user_id': bind_user_id,
            'local_mail': users[bind_user_id]['local_mail']
        }

    return jsonify({
        'success': True,
        'mail_user': data,
        'bind': bind_result
    })


@mail_bp.route('/api/admin/users/<user_id>/local-mail', methods=['PUT'])
@mail_bp.route('/api/admin/nexora-mail/bind', methods=['POST'])
@require_admin
def admin_nexora_mail_bind(user_id=None):
    """将 Nexora 用户绑定到指定本地邮箱账号"""
    payload = request.get_json(silent=True) or {}
    user_id = (user_id or payload.get('user_id') or payload.get('target_user_id') or '').strip()
    group = (payload.get('group') or _get_nexora_mail_config().get('default_group') or 'default').strip() or 'default'
    mail_username = (payload.get('mail_username') or payload.get('username') or '').strip()
    domain = str(payload.get('domain') or '').strip()

    if not user_id or not mail_username:
        return jsonify({'success': False, 'message': 'user_id 和 mail_username 不能为空'}), 400

    users = load_users()
    if user_id not in users:
        return jsonify({'success': False, 'message': 'Nexora 用户不存在'}), 404

    # 绑定前先验证邮箱用户存在
    ok, status, data = _nexora_mail_call(f"/api/users/{urllib_parse.quote(group)}/{urllib_parse.quote(mail_username)}", method='GET')
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '邮箱用户不存在或不可访问'), 'upstream': data}), status

    address = mail_username if '@' in mail_username else (f'{mail_username}@{domain}' if domain else '')
    users[user_id]['local_mail'] = {
        'provider': 'nexoramail',
        'group': group,
        'username': mail_username,
        'address': address,
        'linked_at': int(time.time())
    }
    save_users(users)

    return jsonify({
        'success': True,
        'user_id': user_id,
        'local_mail': users[user_id]['local_mail']
    })


@mail_bp.route('/api/admin/users/<user_id>/local-mail', methods=['DELETE'])
@mail_bp.route('/api/admin/nexora-mail/unbind', methods=['POST'])
@require_admin
def admin_nexora_mail_unbind(user_id=None):
    """解绑 Nexora 用户的本地邮箱"""
    payload = request.get_json(silent=True) or {}
    user_id = (user_id or payload.get('user_id') or payload.get('target_user_id') or '').strip()

    if not user_id:
        return jsonify({'success': False, 'message': 'user_id 不能为空'}), 400

    users = load_users()
    if user_id not in users:
        return jsonify({'success': False, 'message': 'Nexora 用户不存在'}), 404

    users[user_id]['local_mail'] = {
        'provider': 'nexoramail',
        'group': 'default',
        'username': '',
        'address': '',
        'linked_at': None
    }
    save_users(users)
    return jsonify({'success': True, 'user_id': user_id, 'local_mail': users[user_id]['local_mail']})


@mail_bp.route('/api/admin/nexora-mail/groups/<group>/users/<path:mail_username>/password', methods=['PATCH'])
@mail_bp.route('/api/admin/nexora-mail/users/password', methods=['POST'])
@require_admin
def admin_nexora_mail_set_password(group=None, mail_username=None):
    """重置 NexoraMail 用户密码"""
    payload = request.get_json(silent=True) or {}
    cfg = _get_nexora_mail_config()
    group = (group or payload.get('group') or cfg.get('default_group') or 'default').strip() or 'default'
    mail_username = (mail_username or payload.get('mail_username') or payload.get('username') or '').strip()
    password = str(payload.get('password') or '')

    if not mail_username or not password:
        return jsonify({'success': False, 'message': 'mail_username 和 password 不能为空'}), 400

    ok, status, data = _nexora_mail_call(
        f"/api/users/{urllib_parse.quote(group)}/{urllib_parse.quote(mail_username)}",
        method='PATCH',
        payload={'password': password}
    )
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '重置邮箱密码失败'), 'upstream': data}), status
    return jsonify({'success': True, 'group': group, 'mail_username': mail_username})


@mail_bp.route('/api/admin/nexora-mail/groups/<group>/users/<path:mail_username>', methods=['DELETE'])
@mail_bp.route('/api/admin/nexora-mail/users/delete', methods=['POST'])
@require_admin
def admin_nexora_mail_delete_user(group=None, mail_username=None):
    """删除 NexoraMail 用户"""
    payload = request.get_json(silent=True) or {}
    cfg = _get_nexora_mail_config()
    group = (group or payload.get('group') or cfg.get('default_group') or 'default').strip() or 'default'
    mail_username = (mail_username or payload.get('mail_username') or payload.get('username') or '').strip()

    if not mail_username:
        return jsonify({'success': False, 'message': 'mail_username 不能为空'}), 400

    ok, status, data = _nexora_mail_call(
        f"/api/users/{urllib_parse.quote(group)}/{urllib_parse.quote(mail_username)}",
        method='DELETE'
    )
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '删除邮箱用户失败'), 'upstream': data}), status

    # 删除邮箱用户后，清理已绑定该邮箱的 Nexora 用户记录
    users = load_users()
    changed = False
    for uid, uinfo in users.items():
        lm = get_local_mail_profile(uinfo)
        if lm.get('group') == group and lm.get('username') == mail_username:
            users[uid]['local_mail'] = {
                'provider': 'nexoramail',
                'group': 'default',
                'username': '',
                'address': '',
                'linked_at': None
            }
            changed = True
    if changed:
        save_users(users)

    return jsonify({'success': True, 'group': group, 'mail_username': mail_username, 'unbind_synced': changed})
