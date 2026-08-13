import importlib
import sys
from functools import wraps
from typing import Any, Dict, Optional

from flask import Blueprint, jsonify, request, session


user_papi_keys_bp = Blueprint("user_papi_keys", __name__)


def _resolve_server_module():
    for module_name in ("__main__", "server"):
        module = sys.modules.get(module_name)

        if module is not None and hasattr(module, "_list_papi_key_records"):
            return module

    return importlib.import_module("server")


def _server_attr(name: str):
    return getattr(_resolve_server_module(), name)


def require_user_session(func):
    """要求当前请求对应一个仍然存在的登录用户。"""
    @wraps(func)
    def wrapped(*args, **kwargs):
        username = str(session.get("username") or "").strip()

        if not username:
            return jsonify({"success": False, "message": "请先登录"}), 401

        users = _server_attr("load_users")()

        if username not in users:
            return jsonify({"success": False, "message": "当前登录用户不存在"}), 401

        return func(*args, **kwargs)

    return wrapped


def _current_username() -> str:
    return str(session.get("username") or "").strip()


def _owned_key_record(key_id: str) -> Optional[Dict[str, Any]]:
    record = _server_attr("_find_papi_key_by_id")(key_id, include_revoked=True)

    if not isinstance(record, dict):
        return None

    if str(record.get("scope") or "").strip().lower() != "owner":
        return None

    if str(record.get("owner") or "").strip() != _current_username():
        return None

    return record


def _owned_key_states():
    username = _current_username()
    records = _server_attr("_list_papi_key_records")(include_revoked=False)
    build_state = _server_attr("_build_public_api_key_state")
    return [
        build_state(record)
        for record in records
        if str(record.get("scope") or "").strip().lower() == "owner"
        and str(record.get("owner") or "").strip() == username
    ]


def _save_public_api_enabled(enabled: bool) -> None:
    ensure_config = _server_attr("ensure_main_config_defaults")
    save_config = _server_attr("save_main_config")
    cfg = ensure_config()
    api_cfg = cfg.setdefault("api", {})
    api_cfg["public_api_enabled"] = bool(enabled)
    save_config(cfg)


def _user_keys_payload() -> Dict[str, Any]:
    ensure_config = _server_attr("ensure_main_config_defaults")
    config = ensure_config()
    api_cfg = config.get("api") if isinstance(config.get("api"), dict) else {}
    expire_presets = _server_attr("PUBLIC_API_EXPIRE_PRESETS")
    permission_labels = _server_attr("PUBLIC_API_PERMISSION_LABELS")
    return {
        "keys": _owned_key_states(),
        "expire_options": [
            {"id": option_id, "label": str(meta.get("label") or option_id)}
            for option_id, meta in expire_presets.items()
        ],
        "permission_labels": dict(permission_labels),
        "public_api_enabled": bool(api_cfg.get("public_api_enabled")),
    }


@user_papi_keys_bp.route("/api/user/papi-keys", methods=["GET"])
@require_user_session
def list_user_papi_keys():
    try:
        return jsonify({"success": True, **_user_keys_payload()})
    except Exception as exc:
        print(f"[PAPI_USER_KEYS] list failed user={_current_username()}: {exc}")
        return jsonify({"success": False, "message": str(exc)}), 500


@user_papi_keys_bp.route("/api/user/papi-keys", methods=["POST"])
@require_user_session
def create_user_papi_key():
    data = request.get_json(silent=True) or {}
    expire = str(data.get("expire") or "").strip().lower()

    if not expire:
        return jsonify({"success": False, "message": "expire is required"}), 400

    try:
        username = _current_username()
        normalize_permissions = _server_attr("_normalize_public_api_permissions")
        record, plain_key = _server_attr("_create_public_api_key")(
            expire_option=expire,
            permissions=normalize_permissions(data.get("permissions")),
            scope="owner",
            owner=username,
            name=str(data.get("name") or "").strip(),
            actor=username,
        )
        _save_public_api_enabled(True)
        return jsonify({
            "success": True,
            "message": "PAPI Key 创建成功，明文仅展示一次。",
            "key": _server_attr("_build_public_api_key_state")(record),
            "public_api_key": plain_key,
        })
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400
    except Exception as exc:
        print(f"[PAPI_USER_KEYS] create failed user={_current_username()}: {exc}")
        return jsonify({"success": False, "message": str(exc)}), 500


@user_papi_keys_bp.route("/api/user/papi-keys/<path:key_id>/regenerate", methods=["POST"])
@require_user_session
def regenerate_user_papi_key(key_id: str):
    record = _owned_key_record(key_id)

    if record is None:
        return jsonify({"success": False, "message": "PAPI key not found"}), 404

    data = request.get_json(silent=True) or {}
    expire = str(data.get("expire") or record.get("expire_option") or "").strip().lower()

    try:
        updated, plain_key = _server_attr("_regenerate_public_api_key")(
            key_id=str(record.get("id") or ""),
            expire_option=expire,
            actor=_current_username(),
        )
        return jsonify({
            "success": True,
            "message": "PAPI Key 已轮换，旧 Key 立即失效。",
            "key": _server_attr("_build_public_api_key_state")(updated),
            "public_api_key": plain_key,
        })
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400
    except Exception as exc:
        print(f"[PAPI_USER_KEYS] regenerate failed user={_current_username()} key_id={key_id}: {exc}")
        return jsonify({"success": False, "message": str(exc)}), 500


@user_papi_keys_bp.route("/api/user/papi-keys/<path:key_id>", methods=["POST"])
@require_user_session
def update_user_papi_key(key_id: str):
    record = _owned_key_record(key_id)

    if record is None:
        return jsonify({"success": False, "message": "PAPI key not found"}), 404

    data = request.get_json(silent=True) or {}

    if "scope" in data or "owner" in data:
        return jsonify({"success": False, "message": "scope and owner cannot be changed by users"}), 400

    try:
        permissions = None

        if "permissions" in data:
            permissions = _server_attr("_normalize_public_api_permissions")(data.get("permissions"))

        updated = _server_attr("_update_public_api_key")(
            key_id=str(record.get("id") or ""),
            permissions=permissions,
            expire_option=str(data.get("expire") or "").strip().lower() if "expire" in data else None,
            name=str(data.get("name") or "").strip() if "name" in data else None,
            actor=_current_username(),
        )
        return jsonify({
            "success": True,
            "message": "PAPI Key 设置已保存。",
            "key": _server_attr("_build_public_api_key_state")(updated),
        })
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400
    except Exception as exc:
        print(f"[PAPI_USER_KEYS] update failed user={_current_username()} key_id={key_id}: {exc}")
        return jsonify({"success": False, "message": str(exc)}), 500


@user_papi_keys_bp.route("/api/user/papi-keys/<path:key_id>", methods=["DELETE"])
@require_user_session
def delete_user_papi_key(key_id: str):
    record = _owned_key_record(key_id)

    if record is None:
        return jsonify({"success": False, "message": "PAPI key not found"}), 404

    try:
        _server_attr("_delete_public_api_key")(key_id=str(record.get("id") or ""))
        remaining = _server_attr("_list_papi_key_records")(include_revoked=False)

        if not remaining:
            _save_public_api_enabled(False)

        return jsonify({"success": True, "message": "PAPI Key 已删除。"})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400
    except Exception as exc:
        print(f"[PAPI_USER_KEYS] delete failed user={_current_username()} key_id={key_id}: {exc}")
        return jsonify({"success": False, "message": str(exc)}), 500
