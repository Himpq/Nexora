"""
Nexora.App.Papi.admin_keys — PAPI 密钥存储层与管理端路由（自 server.py 分批迁移）

- 密钥记录读写（data/papikey.jsonl，读改写 + 路径锁）
- 密钥状态构建、scope/owner 校验
- /api/admin/auth/public-api 管理路由

组装契约：PAPI_KEYS_PATH 与主配置读写（ensure_main_config_defaults /
save_main_config）经 configure_papi_admin_keys() 注入。
"""

import hashlib
import json
import os
import secrets
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from flask import Blueprint, jsonify, request, session

from App.Utils import mask_public_api_key as _mask_public_api_key
from basis.Permission.AuthKey import (
    EXPIRE_PRESETS,
    PERMISSION_LABELS,
    SCOPES,
    normalize_permissions,
)
import basis.Permission.AuthKey as _authkey
from basis.Database import get_path_lock
from basis.Permission import coerce_bool_flag as _coerce_bool_flag
from basis.Permission import parse_iso_datetime as _parse_iso_datetime
from basis.Permission import require_admin
from basis.User import load_users

papi_admin_bp = Blueprint('papi_admin', __name__)

# PAPI 文件路径与配置读写由 server 组装层注入。
PAPI_KEYS_PATH = ""

_ensure_main_config_defaults = None
_save_main_config = None


def configure_papi_admin_keys(papi_keys_path, ensure_main_config_defaults, save_main_config):
    """
    server 组装期注入依赖（仅允许调用一次）。

    papi_keys_path:              PAPI 密钥文件路径（data/papikey.jsonl），
                                 注入时统一规范化为绝对路径
    ensure_main_config_defaults: 读取主配置并合并默认值
    save_main_config:            保存主配置
    """
    global PAPI_KEYS_PATH, _ensure_main_config_defaults, _save_main_config

    if _ensure_main_config_defaults is not None:
        raise RuntimeError('papi admin keys already configured')

    normalized_path = os.path.abspath(str(papi_keys_path or '').strip())

    if not normalized_path:
        raise ValueError('papi keys path is required')

    PAPI_KEYS_PATH = normalized_path
    _ensure_main_config_defaults = ensure_main_config_defaults
    _save_main_config = save_main_config


def _utc_now_iso() -> str:
    return f"{datetime.utcnow().replace(microsecond=0).isoformat()}Z"


def _parse_iso_datetime(raw: Any) -> Optional[datetime]:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        text = text.replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is not None:
            dt = dt.astimezone().replace(tzinfo=None)
        return dt
    except Exception:
        return None


def _resolve_public_api_expire_option(raw_option: Any) -> Tuple[str, str, Optional[datetime], Optional[str]]:
    option = str(raw_option or "").strip().lower() or "forever"
    if option not in EXPIRE_PRESETS:
        return option, "", None, "Invalid expire option. Use one of: 1d, 7d, 1m, 3m, forever."
    preset = EXPIRE_PRESETS[option]
    seconds = preset.get("seconds")
    if seconds is None:
        return option, "", None, None
    expires_dt = datetime.utcnow() + timedelta(seconds=int(seconds))
    return option, f"{expires_dt.replace(microsecond=0).isoformat()}Z", expires_dt, None


def _hash_public_api_key(raw_key: Any) -> str:
    text = str(raw_key or "").strip()
    if not text:
        return ""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _generate_public_api_key_value() -> str:
    return f"public-{secrets.token_urlsafe(24).replace('-', '').replace('_', '')}"


def _normalize_public_api_key_name(raw_name: Any, *, fallback: str = "") -> str:
    text = str(raw_name or "").strip()
    if text:
        return text[:80]
    fb = str(fallback or "").strip()
    return fb[:80]


def _read_papi_key_rows() -> List[Dict[str, Any]]:
    path = PAPI_KEYS_PATH
    if not os.path.exists(path):
        return []
    rows: List[Dict[str, Any]] = []
    with get_path_lock(path):
        try:
            lines = Path(path).read_text(encoding='utf-8').splitlines()
            for raw_line in lines:
                line = str(raw_line or "").strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except Exception:
                    continue
                if isinstance(row, dict):
                    rows.append(row)
        except Exception:
            return []
    return rows


def _write_papi_key_rows(rows: List[Dict[str, Any]]) -> None:
    path = PAPI_KEYS_PATH
    os.makedirs(os.path.dirname(path), exist_ok=True)
    normalized_rows: List[Dict[str, Any]] = []
    for row in list(rows or []):
        normalized = _normalize_papi_key_record(row)
        if normalized:
            normalized_rows.append(normalized)
    normalized_rows.sort(
        key=lambda item: (
            str(item.get("created_at") or ""),
            str(item.get("id") or ""),
        )
    )
    with get_path_lock(path):
        payload = ''.join(
            json.dumps(row, ensure_ascii=False) + "\n"
            for row in normalized_rows
        )
        Path(path).write_text(payload, encoding='utf-8', newline='\n')


def _normalize_papi_key_record(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    key_id = str(raw.get("id") or "").strip()
    if not key_id:
        return None
    status = str(raw.get("status") or "active").strip().lower()
    if status not in {"active", "revoked"}:
        status = "active"
    created_at = str(raw.get("created_at") or "").strip()
    updated_at = str(raw.get("updated_at") or "").strip()
    expires_at = str(raw.get("expires_at") or "").strip()
    last_regenerated_at = str(raw.get("last_regenerated_at") or "").strip()
    name = _normalize_public_api_key_name(raw.get("name"), fallback=key_id)
    key_hash = str(raw.get("key_hash") or "").strip()
    if not key_hash:
        return None
    scope = str(raw.get("scope") or "").strip().lower()
    if scope not in SCOPES:
        return None
    owner = str(raw.get("owner") or "").strip()
    record: Dict[str, Any] = {
        "id": key_id,
        "name": name,
        "status": status,
        "key_hash": key_hash,
        "key_preview": str(raw.get("key_preview") or "").strip(),
        "created_at": created_at,
        "updated_at": updated_at,
        "expires_at": expires_at,
        "expire_option": str(raw.get("expire_option") or "forever").strip().lower() or "forever",
        "last_regenerated_at": last_regenerated_at,
        "permissions": normalize_permissions(raw.get("permissions")),
        "scope": scope,
        "owner": owner,
        "last_used_at": str(raw.get("last_used_at") or "").strip(),
        "created_by": str(raw.get("created_by") or "").strip(),
        "updated_by": str(raw.get("updated_by") or "").strip(),
        "last_regenerated_by": str(raw.get("last_regenerated_by") or "").strip(),
    }
    return record


def _papi_key_sort_key(record: Dict[str, Any]) -> Tuple[str, str]:
    return (
        str(record.get("updated_at") or record.get("created_at") or ""),
        str(record.get("id") or ""),
    )


def _load_papi_key_index(*, include_revoked: bool = True) -> Dict[str, Dict[str, Any]]:
    index: Dict[str, Dict[str, Any]] = {}
    for row in _read_papi_key_rows():
        normalized = _normalize_papi_key_record(row)
        if not normalized:
            continue
        key_id = str(normalized.get("id") or "").strip()
        if not key_id:
            continue
        old = index.get(key_id)
        if old is None or _papi_key_sort_key(normalized) >= _papi_key_sort_key(old):
            index[key_id] = normalized
    if include_revoked:
        return index
    return {
        k: v
        for k, v in index.items()
        if str(v.get("status") or "").strip().lower() == "active"
    }


def _list_papi_key_records(*, include_revoked: bool = False) -> List[Dict[str, Any]]:
    index = _load_papi_key_index(include_revoked=include_revoked)
    rows = list(index.values())
    rows.sort(
        key=lambda item: str(item.get("created_at") or item.get("updated_at") or ""),
        reverse=True,
    )
    return rows


def _papi_key_expire_info(record: Dict[str, Any]) -> Tuple[bool, Optional[int]]:
    expires_at = str(record.get("expires_at") or "").strip()
    if not expires_at:
        return False, None
    expires_dt = _parse_iso_datetime(expires_at)
    if expires_dt is None:
        return False, None
    now_dt = datetime.utcnow()
    is_expired = bool(now_dt >= expires_dt)
    if is_expired:
        return True, 0
    return False, max(0, int((expires_dt - now_dt).total_seconds()))


def _build_public_api_key_state(record: Dict[str, Any]) -> Dict[str, Any]:
    is_expired, expires_in_seconds = _papi_key_expire_info(record)
    return {
        "id": str(record.get("id") or "").strip(),
        "name": _normalize_public_api_key_name(record.get("name"), fallback=str(record.get("id") or "")),
        "status": str(record.get("status") or "active").strip().lower(),
        "key_preview": str(record.get("key_preview") or "").strip(),
        "created_at": str(record.get("created_at") or "").strip(),
        "updated_at": str(record.get("updated_at") or "").strip(),
        "expires_at": str(record.get("expires_at") or "").strip(),
        "expire_option": str(record.get("expire_option") or "forever").strip().lower() or "forever",
        "last_regenerated_at": str(record.get("last_regenerated_at") or "").strip(),
        "is_expired": bool(is_expired),
        "expires_in_seconds": expires_in_seconds,
        "permissions": normalize_permissions(record.get("permissions")),
        "scope": str(record.get("scope") or "").strip().lower(),
        "owner": str(record.get("owner") or "").strip(),
        "last_used_at": str(record.get("last_used_at") or "").strip(),
        "created_by": str(record.get("created_by") or "").strip(),
        "updated_by": str(record.get("updated_by") or "").strip(),
        "last_regenerated_by": str(record.get("last_regenerated_by") or "").strip(),
    }


def _select_primary_papi_key(keys: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not keys:
        return None
    for row in keys:
        if str(row.get("status") or "").strip().lower() == "active":
            return row
    return keys[0]


def _build_public_api_auth_state(
    api_cfg: Any,
    include_plain_key: bool = False,
    plain_key: str = "",
) -> Dict[str, Any]:
    cfg = api_cfg if isinstance(api_cfg, dict) else {}
    global_enabled = _coerce_bool_flag(cfg.get("public_api_enabled"), False)
    key_records = _list_papi_key_records(include_revoked=False)
    key_states = [_build_public_api_key_state(row) for row in key_records]

    active_non_expired = [
        row for row in key_states
        if str(row.get("status") or "").strip().lower() == "active" and not bool(row.get("is_expired"))
    ]
    primary = _select_primary_papi_key(active_non_expired or key_states)

    payload: Dict[str, Any] = {
        "public_api_enabled": bool(global_enabled and bool(active_non_expired)),
        "global_enabled": bool(global_enabled),
        "has_key": bool(len(active_non_expired) > 0),
        "key_count": len(key_states),
        "active_key_count": len(active_non_expired),
        "keys": key_states,
        "selected_key_id": str(primary.get("id") or "").strip() if isinstance(primary, dict) else "",
        "key_preview": str(primary.get("key_preview") or "").strip() if isinstance(primary, dict) else "",
        "created_at": str(primary.get("created_at") or "").strip() if isinstance(primary, dict) else "",
        "expires_at": str(primary.get("expires_at") or "").strip() if isinstance(primary, dict) else "",
        "last_regenerated_at": str(primary.get("last_regenerated_at") or "").strip() if isinstance(primary, dict) else "",
        "is_expired": bool(primary.get("is_expired")) if isinstance(primary, dict) else False,
        "expires_in_seconds": (primary.get("expires_in_seconds") if isinstance(primary, dict) else None),
        "permissions": normalize_permissions((primary or {}).get("permissions") if isinstance(primary, dict) else {}),
        "permission_labels": dict(PERMISSION_LABELS),
        "expire_options": [
            {"id": key, "label": str(meta.get("label") or key)}
            for key, meta in EXPIRE_PRESETS.items()
        ],
    }
    if include_plain_key:
        payload["public_api_key"] = str(plain_key or "").strip()
    return payload


def _find_papi_key_by_id(key_id: Any, *, include_revoked: bool = True) -> Optional[Dict[str, Any]]:
    lookup = str(key_id or "").strip()
    if not lookup:
        return None
    index = _load_papi_key_index(include_revoked=include_revoked)
    return index.get(lookup)


def _validate_papi_key_scope_owner(record: Dict[str, Any]) -> None:
    scope = str(record.get("scope") or "").strip().lower()
    if scope not in SCOPES:
        raise ValueError(f"PAPI key scope must be 'owner' or 'global', got: {scope!r}")
    if scope == "owner" and not str(record.get("owner") or "").strip():
        raise ValueError("PAPI key with scope='owner' requires a non-empty owner")


def _write_papi_key_record(record: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _normalize_papi_key_record(record)
    if not normalized:
        raise ValueError("invalid papi key record")
    _validate_papi_key_scope_owner(normalized)
    key_id = str(normalized.get("id") or "").strip()
    if not key_id:
        raise ValueError("invalid papi key id")
    index = _load_papi_key_index(include_revoked=True)
    index[key_id] = normalized
    _write_papi_key_rows(list(index.values()))
    return normalized


def _delete_papi_key_record(*, key_id: str) -> None:
    target = str(key_id or "").strip()
    if not target:
        raise ValueError("invalid papi key id")
    index = _load_papi_key_index(include_revoked=True)
    if target not in index:
        raise ValueError("PAPI key not found")
    index.pop(target, None)
    _write_papi_key_rows(list(index.values()))


def _create_public_api_key(
    *,
    expire_option: str,
    permissions: Dict[str, bool],
    scope: str,
    owner: str = "",
    name: str = "",
    actor: str = "",
) -> Tuple[Dict[str, Any], str]:
    scope_value = str(scope or "").strip().lower()
    if scope_value not in SCOPES:
        raise ValueError(f"PAPI key scope must be 'owner' or 'global', got: {scope_value!r}")
    owner_value = str(owner or "").strip()
    actor_name = str(actor or "").strip() or "admin"
    if scope_value == "owner":
        if not owner_value:
            raise ValueError("PAPI key with scope='owner' requires a non-empty owner")
    elif not owner_value:
        # global Key 的 owner 仅作归属展示,不参与访问控制;未显式指定时归属操作者
        owner_value = actor_name
    option, expires_at, _expires_dt, err = _resolve_public_api_expire_option(expire_option)
    if err:
        raise ValueError(err)
    now_iso = _utc_now_iso()
    plain_key = _generate_public_api_key_value()
    # PAPI 数据采用读改写存储，整个写入过程使用同一把可重入锁避免并发覆盖。
    with get_path_lock(PAPI_KEYS_PATH):
        raw_name = str(name or "").strip()
        if raw_name:
            normalized_name = _normalize_public_api_key_name(raw_name, fallback="")
        else:
            normalized_name = _normalize_public_api_key_name(
                "",
                fallback=f"PAPI Key {now_iso[:19]}-{uuid.uuid4().hex[:6]}",
            )
        record = {
            "id": f"pak_{uuid.uuid4().hex}",
            "name": normalized_name,
            "status": "active",
            "key_hash": _hash_public_api_key(plain_key),
            "key_preview": _mask_public_api_key(plain_key),
            "created_at": now_iso,
            "updated_at": now_iso,
            "expires_at": expires_at,
            "expire_option": option,
            "last_regenerated_at": "",
            "permissions": normalize_permissions(permissions),
            "scope": scope_value,
            "owner": owner_value,
            "last_used_at": "",
            "created_by": actor_name,
            "updated_by": actor_name,
            "last_regenerated_by": "",
        }
        _write_papi_key_record(record)
    return record, plain_key


def _regenerate_public_api_key(
    *,
    key_id: str,
    expire_option: str,
    permissions: Optional[Dict[str, bool]] = None,
    name: Optional[str] = None,
    actor: str = "",
) -> Tuple[Dict[str, Any], str]:
    old = _find_papi_key_by_id(key_id, include_revoked=True)
    if not old:
        raise ValueError("PAPI key not found")
    option, expires_at, _expires_dt, err = _resolve_public_api_expire_option(expire_option)
    if err:
        raise ValueError(err)
    now_iso = _utc_now_iso()
    plain_key = _generate_public_api_key_value()
    actor_name = str(actor or "").strip() or "admin"
    record = dict(old)
    record["status"] = "active"
    record["key_hash"] = _hash_public_api_key(plain_key)
    record["key_preview"] = _mask_public_api_key(plain_key)
    record["updated_at"] = now_iso
    record["updated_by"] = actor_name
    record["last_regenerated_at"] = now_iso
    record["last_regenerated_by"] = actor_name
    record["expires_at"] = expires_at
    record["expire_option"] = option
    if not str(record.get("created_by") or "").strip():
        record["created_by"] = actor_name
    with get_path_lock(PAPI_KEYS_PATH):
        if name is not None:
            normalized_name = _normalize_public_api_key_name(name, fallback=str(old.get("name") or old.get("id") or ""))
            record["name"] = normalized_name
        if permissions is not None:
            record["permissions"] = normalize_permissions(permissions)
        _write_papi_key_record(record)
    return record, plain_key


def _update_public_api_key(
    *,
    key_id: str,
    permissions: Optional[Dict[str, bool]] = None,
    expire_option: Optional[str] = None,
    name: Optional[str] = None,
    scope: Optional[str] = None,
    owner: Optional[str] = None,
    actor: str = "",
) -> Dict[str, Any]:
    old = _find_papi_key_by_id(key_id, include_revoked=True)
    if not old:
        raise ValueError("PAPI key not found")
    record = dict(old)
    now_iso = _utc_now_iso()
    if permissions is not None:
        record["permissions"] = normalize_permissions(permissions)
    if scope is not None:
        scope_value = str(scope or "").strip().lower()
        if scope_value not in SCOPES:
            raise ValueError(f"PAPI key scope must be 'owner' or 'global', got: {scope_value!r}")
        record["scope"] = scope_value
    if owner is not None:
        owner_value = str(owner or "").strip()
        if owner_value and owner_value not in (load_users() or {}):
            raise ValueError(f"PAPI key owner user not found: {owner_value}")
        record["owner"] = owner_value
    if str(record.get("scope") or "").strip().lower() == "owner" and not str(record.get("owner") or "").strip():
        raise ValueError("PAPI key with scope='owner' requires a non-empty owner")
    with get_path_lock(PAPI_KEYS_PATH):
        if name is not None:
            normalized_name = _normalize_public_api_key_name(name, fallback=str(old.get("name") or old.get("id") or ""))
            record["name"] = normalized_name
        if expire_option is not None:
            option, expires_at, _expires_dt, err = _resolve_public_api_expire_option(expire_option)
            if err:
                raise ValueError(err)
            record["expire_option"] = option
            record["expires_at"] = expires_at
        record["updated_at"] = now_iso
        record["updated_by"] = str(actor or "").strip() or "admin"
        if not str(record.get("created_by") or "").strip():
            record["created_by"] = str(actor or "").strip() or "admin"
        _write_papi_key_record(record)
    return record


def _delete_public_api_key(*, key_id: str) -> Dict[str, Any]:
    old = _find_papi_key_by_id(key_id, include_revoked=True)
    if not old:
        raise ValueError("PAPI key not found")
    _delete_papi_key_record(key_id=str(old.get("id") or ""))
    return old


def _issue_public_api_key(
    expire_option: str,
    permissions: Dict[str, bool],
    regenerate: bool = False,
    key_id: str = "",
    name: str = "",
    scope: str = "",
    owner: str = "",
    actor: str = "",
) -> Dict[str, Any]:
    cfg = _ensure_main_config_defaults()
    api_cfg = cfg.setdefault("api", {})
    normalized_permissions = normalize_permissions(permissions)

    if regenerate:
        target_id = str(key_id or "").strip()
        if not target_id:
            primary = _select_primary_papi_key(_list_papi_key_records(include_revoked=False))
            target_id = str((primary or {}).get("id") or "").strip()
        if not target_id:
            raise ValueError("No active PAPI key to regenerate.")
        _, plain_key = _regenerate_public_api_key(
            key_id=target_id,
            expire_option=expire_option,
            permissions=normalized_permissions,
            name=name if str(name or "").strip() else None,
            actor=actor,
        )
    else:
        _record, plain_key = _create_public_api_key(
            expire_option=expire_option,
            permissions=normalized_permissions,
            scope=scope,
            owner=owner,
            name=name,
            actor=actor,
        )

    if not _coerce_bool_flag(api_cfg.get("public_api_enabled"), False):
        api_cfg["public_api_enabled"] = True
    _save_main_config(cfg)
    return _build_public_api_auth_state(api_cfg, include_plain_key=True, plain_key=plain_key)


def resolve_public_api_key_auth(auth_key: Any, *, request_path: str = "", method: str = "GET") -> Dict[str, Any]:
    """
    Public API 密钥鉴权（PAPI 入口）。
    核心逻辑统一收敛于 Nexora.basis.Permission.AuthKey。
    """
    cfg = _ensure_main_config_defaults()
    api_cfg = cfg.get("api", {}) if isinstance(cfg, dict) else {}
    public_api_enabled = _coerce_bool_flag(api_cfg.get("public_api_enabled"), False)

    return _authkey.resolve_public_api_key_auth(
        auth_key,
        keys_path=PAPI_KEYS_PATH,
        public_api_enabled=public_api_enabled,
        request_path=request_path,
        method=method,
    )


# ==================== 管理端路由 ====================

@papi_admin_bp.route('/api/admin/auth/public-api', methods=['GET'])
@require_admin
def admin_get_public_api_auth():
    try:
        cfg = _ensure_main_config_defaults()
        api_cfg = cfg.get('api', {}) if isinstance(cfg.get('api'), dict) else {}
        state = _build_public_api_auth_state(api_cfg, include_plain_key=False)
        return jsonify({'success': True, 'auth': state})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@papi_admin_bp.route('/api/admin/auth/public-api/keys', methods=['GET'])
@require_admin
def admin_list_public_api_keys():
    try:
        cfg = _ensure_main_config_defaults()
        api_cfg = cfg.get('api', {}) if isinstance(cfg.get('api'), dict) else {}
        state = _build_public_api_auth_state(api_cfg, include_plain_key=False)
        return jsonify({'success': True, 'keys': state.get('keys', []), 'auth': state})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@papi_admin_bp.route('/api/admin/auth/public-api/settings', methods=['POST'])
@require_admin
def admin_update_public_api_auth_settings():
    data = request.get_json(silent=True) or {}
    try:
        actor = str(session.get('username') or 'admin').strip() or 'admin'
        cfg = _ensure_main_config_defaults()
        api_cfg = cfg.setdefault('api', {})
        if 'public_api_enabled' in data:
            enable_requested = _coerce_bool_flag(data.get('public_api_enabled'), False)
            if enable_requested and (not _build_public_api_auth_state(api_cfg).get('has_key')):
                return jsonify({'success': False, 'message': 'No active PAPI key found. Please generate one first.'}), 400
            api_cfg['public_api_enabled'] = enable_requested
        key_id = str(data.get('key_id') or '').strip()
        if key_id:
            permissions = normalize_permissions(data.get('permissions')) if ('permissions' in data) else None
            expire = str(data.get('expire') or '').strip().lower() if ('expire' in data) else None
            key_name = str(data.get('name') or '').strip() if ('name' in data) else None
            key_scope = str(data.get('scope') or '').strip().lower() if ('scope' in data) else None
            key_owner = str(data.get('owner') or '').strip() if ('owner' in data) else None
            _update_public_api_key(
                key_id=key_id,
                permissions=permissions,
                expire_option=expire if expire is not None else None,
                name=key_name,
                scope=key_scope,
                owner=key_owner,
                actor=actor,
            )
        _save_main_config(cfg)
        state = _build_public_api_auth_state(api_cfg, include_plain_key=False)
        return jsonify({'success': True, 'auth': state})
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@papi_admin_bp.route('/api/admin/auth/public-api/generate', methods=['POST'])
@require_admin
def admin_generate_public_api_key():
    data = request.get_json(silent=True) or {}
    expire = str(data.get('expire') or '').strip().lower()
    if not expire:
        return jsonify({'success': False, 'message': 'expire is required. Use one of: 1d, 7d, 1m, 3m, forever.'}), 400
    permissions = normalize_permissions(data.get('permissions'))
    key_name = str(data.get('name') or '').strip()
    key_scope = str(data.get('scope') or '').strip().lower()
    key_owner = str(data.get('owner') or '').strip()
    if not key_scope:
        return jsonify({'success': False, 'message': "scope is required. Use 'owner' or 'global'."}), 400
    try:
        actor = str(session.get('username') or 'admin').strip() or 'admin'
        if key_owner and key_owner not in (load_users() or {}):
            return jsonify({'success': False, 'message': f'PAPI key owner user not found: {key_owner}'}), 400
        state = _issue_public_api_key(
            expire,
            permissions,
            regenerate=False,
            name=key_name,
            scope=key_scope,
            owner=key_owner,
            actor=actor,
        )
        return jsonify({
            'success': True,
            'message': 'Public API key generated.',
            'auth': state,
            'public_api_key': state.get('public_api_key', ''),
        })
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@papi_admin_bp.route('/api/admin/auth/public-api/regenerate', methods=['POST'])
@require_admin
def admin_regenerate_public_api_key():
    data = request.get_json(silent=True) or {}
    expire = str(data.get('expire') or '').strip().lower()
    if not expire:
        return jsonify({'success': False, 'message': 'expire is required. Use one of: 1d, 7d, 1m, 3m, forever.'}), 400
    permissions = normalize_permissions(data.get('permissions'))
    key_id = str(data.get('key_id') or '').strip()
    key_name = str(data.get('name') or '').strip()
    try:
        actor = str(session.get('username') or 'admin').strip() or 'admin'
        state = _issue_public_api_key(
            expire,
            permissions,
            regenerate=True,
            key_id=key_id,
            name=key_name,
            actor=actor,
        )
        return jsonify({
            'success': True,
            'message': 'Public API key regenerated.',
            'auth': state,
            'public_api_key': state.get('public_api_key', ''),
        })
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@papi_admin_bp.route('/api/admin/auth/public-api/keys/<path:key_id>', methods=['DELETE'])
@papi_admin_bp.route('/api/admin/auth/public-api/revoke', methods=['POST'])
@papi_admin_bp.route('/api/admin/auth/public-api/delete', methods=['POST'])
@require_admin
def admin_revoke_public_api_key(key_id=None):
    try:
        data = request.get_json(silent=True) or {}
        cfg = _ensure_main_config_defaults()
        api_cfg = cfg.setdefault('api', {})
        target_id = str(key_id or data.get('key_id') or '').strip()

        if not target_id:
            primary = _select_primary_papi_key(_list_papi_key_records(include_revoked=False))
            target_id = str((primary or {}).get('id') or '').strip()

        if not target_id:
            return jsonify({'success': False, 'message': 'No active PAPI key to delete.'}), 400

        _delete_public_api_key(key_id=target_id)

        if not _list_papi_key_records(include_revoked=False):
            api_cfg['public_api_enabled'] = False

        _save_main_config(cfg)
        state = _build_public_api_auth_state(api_cfg, include_plain_key=False)
        return jsonify({'success': True, 'message': 'Public API key deleted.', 'auth': state})
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
