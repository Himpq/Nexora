from functools import wraps
from typing import Callable, Optional, Tuple

from flask import jsonify, request


PAPI_KEY_SCOPES = {"owner", "global"}


def papi_key_scope_owner() -> Tuple[str, str]:
    """读取已经通过 PAPI 认证的 Key 访问范围与所属用户。"""
    auth = request.environ.get("papi.auth")
    auth = auth if isinstance(auth, dict) else {}
    key_state = auth.get("key") if isinstance(auth.get("key"), dict) else {}
    scope = str(key_state.get("scope") or "").strip().lower()
    owner = str(key_state.get("owner") or "").strip()
    return scope, owner


def check_papi_owner_access(target_username: str) -> Tuple[bool, str]:
    """校验当前 Key 是否允许访问目标用户数据。"""
    scope, owner = papi_key_scope_owner()

    if scope not in PAPI_KEY_SCOPES:
        return False, "PAPI key scope is missing or invalid"

    if scope == "global":
        return True, ""

    target = str(target_username or "").strip()

    if not owner:
        return False, "Owner-scoped PAPI key has no owner"

    if not target or target != owner:
        return False, "PAPI key cannot access another user's data"

    return True, ""


def resolve_papi_request_username(target_username: str) -> Tuple[str, Optional[str]]:
    """为模型请求解析可信用户名，owner Key 始终绑定到 Key owner。"""
    scope, owner = papi_key_scope_owner()

    if scope not in PAPI_KEY_SCOPES:
        return "", "PAPI key scope is missing or invalid"

    target = str(target_username or "").strip()

    if scope == "global":
        return target, None

    if not owner:
        return "", "Owner-scoped PAPI key has no owner"

    if target and target != owner:
        return "", "PAPI key cannot submit requests for another user"

    return owner, None


def require_papi_owner_match(param: str = "username") -> Callable:
    """限制带用户名路由只能读取 global 或当前 owner 的数据。"""
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapped(*args, **kwargs):
            allowed, message = check_papi_owner_access(kwargs.get(param))

            if not allowed:
                return jsonify({"success": False, "message": message}), 403

            return func(*args, **kwargs)

        return wrapped

    return decorator


def deny_papi_owner_scope(feature: str) -> Callable:
    """拒绝 owner Key 使用无法限定到单一用户的跨用户功能。"""
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapped(*args, **kwargs):
            scope, _owner = papi_key_scope_owner()

            if scope not in PAPI_KEY_SCOPES:
                return jsonify({"success": False, "message": "PAPI key scope is missing or invalid"}), 403

            if scope == "owner":
                return jsonify({
                    "success": False,
                    "message": f"Owner-scoped PAPI key cannot use {feature}",
                }), 403

            return func(*args, **kwargs)

        return wrapped

    return decorator
