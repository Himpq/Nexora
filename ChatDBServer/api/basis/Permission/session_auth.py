"""
Nexora.basis.Permission.session_auth — 基于 Flask session 的登录态校验

供所有域的路由模块复用（原 server.py 内联实现迁移）。
用户表数据经 basis.User 读取并做请求级缓存（flask.g），
本模块不得反向 import server。
"""

from functools import wraps

from flask import g, jsonify, session

from basis.User import load_users


def get_request_users_meta():
    """
    请求级用户表缓存：同一请求内复用已加载的用户表，避免重复读盘。
    """
    users = getattr(g, 'session_users_meta', None)

    if isinstance(users, dict):
        return users

    users = load_users()
    g.session_users_meta = users

    return users


def require_login(f):
    """登录装饰器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'username' not in session:
            return jsonify({'success': False, 'message': '请先登录'}), 401
        # Verify the user actually exists in the database — prevents
        # forged session cookies from granting access to non-existent users.
        try:
            users = get_request_users_meta()
            if session.get('username') not in users:
                session.clear()
                return jsonify({'success': False, 'message': '用户不存在，请重新登录'}), 401
        except Exception:
            session.clear()
            return jsonify({'success': False, 'message': '认证验证失败，请重新登录'}), 401
        return f(*args, **kwargs)
    return decorated_function


def require_admin(f):
    """管理员专用装饰器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'username' not in session:
            return jsonify({'success': False, 'message': '请先登录'}), 401
        try:
            users = get_request_users_meta()
            if session.get('username') not in users:
                session.clear()
                return jsonify({'success': False, 'message': '用户不存在，请重新登录'}), 401
        except Exception:
            session.clear()
            return jsonify({'success': False, 'message': '认证验证失败，请重新登录'}), 401
        if session.get('role') != 'admin':
            return jsonify({'success': False, 'message': '权限不足，仅管理员可访问'}), 403
        return f(*args, **kwargs)
    return decorated_function
