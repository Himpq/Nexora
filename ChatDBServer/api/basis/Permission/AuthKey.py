"""
Nexora.basis.Permission.AuthKey — 鉴权密钥基础层

职责：Public API（PAPI）密钥的生成、哈希、存储、状态管理，以及基于路径的
      权限鉴权判定。从 server.py 迁移并统一 PAPI 权限模型，消除 core.py 与
      server.py 的权限常量重复。

数据存储路径由调用方在配置中注入（PAPI_KEYS_PATH），本模块不依赖 server 模块，
避免循环依赖。

对外提供：
- PERMISSION_DEFAULTS / PERMISSION_LABELS / EXPIRE_PRESETS / SCOPES: 常量
- hash_key / generate_key_value / mask_key / normalize_permissions
- read_rows / write_rows / load_index / list_records
- build_key_state / build_auth_state / find_by_hash / find_by_id
- resolve_public_api_key_auth: 按路径判定权限并返回鉴权结果
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Tuple

# ─── 权限模型（统一 PAPI / Public API 权限）───────────────────────────────
PERMISSION_DEFAULTS: Dict[str, bool] = {
    "model_inference": True,
    "image_generation": True,
    "knowledge_read": True,
    "conversations_read": True,
    "conversations_write": True,
    "token_stats_read": True,
    "user_read": True,
}

PERMISSION_LABELS: Dict[str, str] = {
    "model_inference": "Model Inference",
    "image_generation": "Image Generation",
    "knowledge_read": "Knowledge Read",
    "conversations_read": "Conversations Read",
    "conversations_write": "Conversations Write",
    "token_stats_read": "Token Stats Read",
    "user_read": "User Read",
}

EXPIRE_PRESETS: Dict[str, Dict[str, Any]] = {
    "1d": {"seconds": 24 * 60 * 60, "label": "1 day"},
    "7d": {"seconds": 7 * 24 * 60 * 60, "label": "7 days"},
    "1m": {"seconds": 30 * 24 * 60 * 60, "label": "1 month"},
    "3m": {"seconds": 90 * 24 * 60 * 60, "label": "3 months"},
    "forever": {"seconds": None, "label": "Forever"},
}

# owner: Key 仅可访问 owner 本人数据; global: 跨用户访问(平台组件用)
SCOPES = {"owner", "global"}


# ─── 基础工具 ────────────────────────────────────────────────────────────
def coerce_bool_flag(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def utc_now_iso() -> str:
    return f"{datetime.utcnow().replace(microsecond=0).isoformat()}Z"


def parse_iso_datetime(raw: Any) -> Optional[datetime]:
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


def hash_key(raw_key: Any) -> str:
    text = str(raw_key or "").strip()
    if not text:
        return ""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def generate_key_value() -> str:
    return f"public-{secrets.token_urlsafe(24).replace('-', '').replace('_', '')}"


def mask_key(key: Any) -> str:
    text = str(key or "").strip()
    if not text:
        return ""
    if len(text) <= 10:
        return "*" * len(text)
    return f"{text[:8]}...{text[-4:]}"


def normalize_key_name(raw_name: Any, *, fallback: str = "") -> str:
    text = str(raw_name or "").strip()
    if text:
        return text[:80]
    fb = str(fallback or "").strip()
    return fb[:80]


def normalize_permissions(raw_permissions: Any) -> Dict[str, bool]:
    normalized = dict(PERMISSION_DEFAULTS)
    if isinstance(raw_permissions, dict):
        for key in PERMISSION_DEFAULTS.keys():
            if key in raw_permissions:
                normalized[key] = coerce_bool_flag(raw_permissions.get(key), normalized[key])
    return normalized


def resolve_expire_option(raw_option: Any) -> Tuple[str, str, Optional[datetime], Optional[str]]:
    option = str(raw_option or "").strip().lower() or "forever"
    if option not in EXPIRE_PRESETS:
        return option, "", None, "Invalid expire option. Use one of: 1d, 7d, 1m, 3m, forever."
    preset = EXPIRE_PRESETS[option]
    seconds = preset.get("seconds")
    if seconds is None:
        return option, "", None, None
    expires_dt = datetime.utcnow() + timedelta(seconds=int(seconds))
    return option, f"{expires_dt.replace(microsecond=0).isoformat()}Z", expires_dt, None


# ─── 存储读写（数据文件为 JSONL，路径由调用方配置注入）────────────────────────
def read_rows(keys_path: str) -> List[Dict[str, Any]]:
    if not os.path.exists(keys_path):
        return []
    rows: List[Dict[str, Any]] = []
    try:
        with open(keys_path, "r", encoding="utf-8") as f:
            for raw_line in f:
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


def normalize_record(raw: Any) -> Optional[Dict[str, Any]]:
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
    created_by = str(raw.get("created_by") or "").strip()
    updated_by = str(raw.get("updated_by") or "").strip()
    return {
        "id": key_id,
        "name": normalize_key_name(raw.get("name"), fallback=key_id),
        "status": status,
        "key_hash": str(raw.get("key_hash") or "").strip(),
        "key_preview": str(raw.get("key_preview") or "").strip(),
        "created_at": created_at,
        "updated_at": updated_at,
        "expires_at": str(raw.get("expires_at") or "").strip(),
        "expire_option": str(raw.get("expire_option") or "forever").strip().lower() or "forever",
        "last_regenerated_at": str(raw.get("last_regenerated_at") or "").strip(),
        "permissions": normalize_permissions(raw.get("permissions")),
        "scope": str(raw.get("scope") or "").strip().lower(),
        "owner": str(raw.get("owner") or "").strip(),
        "last_used_at": str(raw.get("last_used_at") or "").strip(),
        "created_by": created_by,
        "updated_by": updated_by,
        "last_regenerated_by": str(raw.get("last_regenerated_by") or "").strip(),
    }


def _record_sort_key(record: Dict[str, Any]) -> Tuple[str, str]:
    return (
        str(record.get("updated_at") or record.get("created_at") or ""),
        str(record.get("id") or ""),
    )


def load_index(keys_path: str, *, include_revoked: bool = True) -> Dict[str, Dict[str, Any]]:
    index: Dict[str, Dict[str, Any]] = {}
    for row in read_rows(keys_path):
        normalized = normalize_record(row)
        if not normalized:
            continue
        key_id = str(normalized.get("id") or "").strip()
        if not key_id:
            continue
        old = index.get(key_id)
        if old is None or _record_sort_key(normalized) >= _record_sort_key(old):
            index[key_id] = normalized
    if include_revoked:
        return index
    return {
        k: v
        for k, v in index.items()
        if str(v.get("status") or "").strip().lower() == "active"
    }


def list_records(keys_path: str, *, include_revoked: bool = False) -> List[Dict[str, Any]]:
    index = load_index(keys_path, include_revoked=include_revoked)
    rows = list(index.values())
    rows.sort(
        key=lambda item: str(item.get("created_at") or item.get("updated_at") or ""),
        reverse=True,
    )
    return rows


# ─── 状态构建 ────────────────────────────────────────────────────────────
def expire_info(record: Dict[str, Any]) -> Tuple[bool, Optional[int]]:
    expires_at = str(record.get("expires_at") or "").strip()
    if not expires_at:
        return False, None
    expires_dt = parse_iso_datetime(expires_at)
    if expires_dt is None:
        return False, None
    now_dt = datetime.utcnow()
    is_expired = bool(now_dt >= expires_dt)
    if is_expired:
        return True, 0
    return False, max(0, int((expires_dt - now_dt).total_seconds()))


def build_key_state(record: Dict[str, Any]) -> Dict[str, Any]:
    is_expired, expires_in_seconds = expire_info(record)
    return {
        "id": str(record.get("id") or "").strip(),
        "name": normalize_key_name(record.get("name"), fallback=str(record.get("id") or "")),
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


def select_primary(keys: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not keys:
        return None
    for row in keys:
        if str(row.get("status") or "").strip().lower() == "active":
            return row
    return keys[0]


def find_by_id(
    keys_path: str,
    key_id: Any,
    *,
    include_revoked: bool = True,
) -> Optional[Dict[str, Any]]:
    target = str(key_id or "").strip()
    if not target:
        return None
    return load_index(keys_path, include_revoked=include_revoked).get(target)


def find_active_by_hash(keys_path: str, key_hash: str) -> Optional[Dict[str, Any]]:
    for record in load_index(keys_path).values():
        if str(record.get("status") or "").strip().lower() != "active":
            continue
        if str(record.get("key_hash") or "") == str(key_hash or ""):
            return record
    return None


# ─── 鉴权判定 ────────────────────────────────────────────────────────────
def resolve_required_permission(request_path: str, method: str) -> str:
    path = str(request_path or "").strip().lower()
    req_method = str(method or "GET").strip().upper()
    if path.startswith("/api/papi/knowledge/"):
        return "knowledge_read"
    if path.startswith("/api/papi/conversations/"):
        return "conversations_write" if req_method in {"POST", "PUT", "PATCH", "DELETE"} else "conversations_read"
    if path.startswith("/api/papi/tokens/stats/"):
        return "token_stats_read"
    if path.startswith("/api/papi/user/"):
        return "user_read"
    if path.startswith("/api/papi/images/") or path.startswith("/api/papi/v1/images/"):
        return "image_generation"
    if path.startswith("/api/papi/learning/chat") or path.startswith("/api/learning/chat"):
        return "model_inference"
    if (
        path.startswith("/api/papi/completions")
        or path.startswith("/api/papi/chat/completions")
        or path.startswith("/api/papi/responses")
        or path.startswith("/api/papi/models")
        or path.startswith("/api/papi/model_list")
        or path.startswith("/api/papi/v1")
    ):
        return "model_inference"
    return ""


def resolve_public_api_key_auth(
    auth_key: Any,
    *,
    keys_path: str,
    public_api_enabled: bool,
    request_path: str = "",
    method: str = "GET",
) -> Dict[str, Any]:
    if not public_api_enabled:
        return {"ok": False, "status": 403, "message": "Public API is disabled"}

    key_text = str(auth_key or "").strip()
    if not key_text:
        return {"ok": False, "status": 401, "message": "Invalid or missing API Key: empty"}

    key_hash = hash_key(key_text)
    record = find_active_by_hash(keys_path, key_hash)
    if record is None:
        return {"ok": False, "status": 401, "message": "Invalid or missing API Key: not found"}

    key_state = build_key_state(record)
    if bool(key_state.get("is_expired")):
        return {"ok": False, "status": 401, "message": "Public API key expired"}

    required_permission = resolve_required_permission(request_path, method)
    permissions = normalize_permissions(record.get("permissions"))
    if required_permission and not permissions.get(required_permission, True):
        return {"ok": False, "status": 403, "message": f"Permission denied: {required_permission}"}

    return {
        "ok": True,
        "status": 200,
        "message": "",
        "key": build_key_state(record),
        "required_permission": required_permission,
    }
