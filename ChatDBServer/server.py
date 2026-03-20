"""
ChatDB Web Server - Flask应用
提供Web界面的聊天和知识库管理功能
"""
import os
import sys
import json
import base64
import binascii
import re
import threading
import uuid
from copy import deepcopy
from typing import Any, Dict, List, Optional, Tuple
from urllib import request as urllib_request, error as urllib_error, parse as urllib_parse
from email.header import Header
from email.utils import formatdate, make_msgid
from flask import Flask, render_template, request, jsonify, session, redirect, url_for, Response, send_file, send_from_directory
from flask_cors import CORS
from datetime import timedelta, datetime
import time

# 添加api目录到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'api'))
from model import Model
from database import User
from conversation_manager import ConversationManager
from chroma_client import ChromaStore
from file_sandbox import UserFileSandbox
from longterm.orchestrator import LongTermOrchestrator
from provider_factory import create_provider_adapter
from client_tool_bridge import pull_pending_request, submit_request_result, enqueue_request, wait_for_result, pull_local_tool_request
from agent_tunnel import register_agent, unregister_agent, update_agent_tools, update_ping, is_agent_online
from flask_sock import Sock

app = Flask(__name__)
app.secret_key = 'chatdb-secret-key-change-in-production'
app.config['SESSION_TYPE'] = 'filesystem'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)
sock = Sock(app)
CORS(app)

# 切换到正确的工作目录
os.chdir(os.path.dirname(os.path.abspath(__file__)))


# ==================== 配置与全局变量 ====================

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
MODELS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models.json')
MODELS_CONTEXT_WINDOW_CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models_context_window.json')
USERS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'user.json')
OPENROUTER_MODELS_SNAPSHOT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'openrouter_models_snapshot.json')
_MODELS_CTX_CACHE_LOCK = threading.Lock()

# NexoraCode 本地 Agent 注册表: {agent_token: {callback_url, tools, username, registered_at}}
_LOCAL_AGENTS: Dict[str, Dict] = {}

DEFAULT_MAIN_CONFIG = {
    "public_base_url": "",
    "default_model": "doubao-seed-1-6-250615",
    "conclusion_model": "doubao-seed-1-6-flash-250828",
    "organization_model": "doubao-seed-1-6-flash-250828",
    "websearch_model": "doubao-seed-1-6-flash-250828",
    "continuous_summary": False,
    "log_status": "silent",
    "api": {
        "public_api_key": "public-1234567890abcdef",
        "public_api_enabled": True
    },
    "rag_database": {
        "host": "127.0.0.1",
        "port": 8100,
        "api_key": "nexoradb-123456",
        "rag_database_enabled": False,
        "mode": "service",
        "path": "./data/chroma",
        "collection_prefix": "knowledge",
        "distance": "cosine",
        "service_url": "http://127.0.0.1:8100",
        "chunk_size": 200,
        "chunk_overlap": 40
    },
    "nexora_mail": {
        "host": "127.0.0.1",
        "port": 17171,
        "api_key": "",
        "nexora_mail_enabled": False,
        "service_url": "http://127.0.0.1:17171",
        "timeout": 10,
        "send_timeout": 120,
        "cache_enabled": True,
        "cache_list_ttl": 180,
        "cache_detail_ttl": 3600,
        "cache_max_entries": 800,
        "default_group": "default"
    }
}


def _merge_defaults(dst, src):
    changed = False
    for k, v in src.items():
        if k not in dst:
            dst[k] = v
            changed = True
        elif isinstance(v, dict) and isinstance(dst.get(k), dict):
            if _merge_defaults(dst[k], v):
                changed = True
    return changed


def ensure_main_config_defaults():
    cfg = {}
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            if not isinstance(cfg, dict):
                cfg = {}
        except Exception:
            cfg = {}

    changed = _merge_defaults(cfg, json.loads(json.dumps(DEFAULT_MAIN_CONFIG, ensure_ascii=False)))
    if changed or not os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, indent=4, ensure_ascii=False)
    return cfg


def load_users():
    with open(USERS_PATH, 'r', encoding='utf-8') as f:
        users = json.load(f)
    if not isinstance(users, dict):
        return {}
    return users


def save_users(users):
    with open(USERS_PATH, 'w', encoding='utf-8') as f:
        json.dump(users, f, indent=4, ensure_ascii=False)


def get_user_avatar_file(user_id):
    return os.path.join(os.path.dirname(__file__), 'data', 'users', user_id, 'profile', 'avatar.png')


def build_user_avatar_url(user_id, user_data):
    avatar_file = get_user_avatar_file(user_id)
    if not os.path.exists(avatar_file):
        return ''
    stamp = int(user_data.get('avatar_updated_at') or os.path.getmtime(avatar_file))
    return f'/api/user/avatar/{user_id}?v={stamp}'

def get_config_all():
    """获取配置"""
    try:
        config = ensure_main_config_defaults()
    except Exception as e:
        print(f"Error loading/ensuring config defaults: {e}")
        config = {}
    if os.path.exists(MODELS_PATH):
        try:
            with open(MODELS_PATH, 'r', encoding='utf-8') as f:
                models_cfg = json.load(f)
            config["models"] = models_cfg.get("models", models_cfg)
            if "providers" in models_cfg:
                config["providers"] = models_cfg.get("providers", {})
        except Exception as e:
            print(f"Error loading models config: {e}")
    return config


def get_public_base_url() -> str:
    """
    生成对前端可见的基础 URL（优先公网域名）。
    优先级：
    1) config.public_base_url / config.api.public_base_url
    2) 反代头 X-Forwarded-Proto + X-Forwarded-Host
    3) 当前请求的 scheme + host
    """
    try:
        cfg = get_config_all()
    except Exception:
        cfg = {}

    def _is_local_host(hostname: str) -> bool:
        h = str(hostname or "").strip().lower()
        return h in {"127.0.0.1", "localhost", "0.0.0.0", "::1"}

    if isinstance(cfg, dict):
        c1 = str(cfg.get("public_base_url", "") or "").strip()
        api_cfg = cfg.get("api", {}) if isinstance(cfg.get("api"), dict) else {}
        c2 = str(api_cfg.get("public_base_url", "") or "").strip()
        configured = c1 or c2
        if configured:
            if not configured.startswith(("http://", "https://")):
                configured = f"https://{configured}"
            return configured.rstrip("/")

    xfh = str(request.headers.get("X-Forwarded-Host", "") or "").split(",")[0].strip()
    xfp = str(request.headers.get("X-Forwarded-Proto", "") or "").split(",")[0].strip()
    if xfh:
        proto = xfp or request.scheme or "http"
        url = f"{proto}://{xfh}".rstrip("/")
    else:
        host = str(request.headers.get("Host", "") or request.host or "").strip()
        proto = xfp or request.scheme or "http"
        if host:
            url = f"{proto}://{host}".rstrip("/")
        else:
            url = request.host_url.rstrip("/")

    # 如果仍是 localhost/127，尝试从 Origin/Referer 还原公网域名
    try:
        parsed = urllib_parse.urlsplit(url)
        host_name = parsed.hostname or ""
    except Exception:
        host_name = ""
    if _is_local_host(host_name):
        origin = str(request.headers.get("Origin", "") or "").strip()
        referer = str(request.headers.get("Referer", "") or "").strip()
        candidate = origin or referer
        if candidate:
            p = urllib_parse.urlsplit(candidate)
            if p.scheme and p.netloc and not _is_local_host(p.hostname or ""):
                return f"{p.scheme}://{p.netloc}".rstrip("/")

    # 最后回退：使用 rag_database.host
    if _is_local_host(host_name) and isinstance(cfg, dict):
        rag_cfg = cfg.get("rag_database", {}) if isinstance(cfg.get("rag_database"), dict) else {}
        rag_host = str(rag_cfg.get("host", "") or "").strip()
        if rag_host and not _is_local_host(rag_host):
            return f"https://{rag_host}".rstrip("/")
    return url


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


def _get_nexora_mail_config():
    cfg = get_config_all()
    mail_cfg = cfg.get('nexora_mail', {}) if isinstance(cfg, dict) else {}
    if not isinstance(mail_cfg, dict):
        mail_cfg = {}

    host = str(mail_cfg.get('host', '127.0.0.1')).strip() or '127.0.0.1'
    port = int(mail_cfg.get('port', 17171) or 17171)
    service_url = str(mail_cfg.get('service_url', '') or '').strip()
    if not service_url:
        service_url = f'http://{host}:{port}'
    service_url = service_url.rstrip('/')

    timeout_val = mail_cfg.get('timeout', 10)
    try:
        timeout = float(timeout_val)
    except Exception:
        timeout = 10.0
    if timeout <= 0:
        timeout = 10.0

    send_timeout_val = mail_cfg.get('send_timeout', 120)
    try:
        send_timeout = float(send_timeout_val)
    except Exception:
        send_timeout = 120.0
    if send_timeout <= 0:
        send_timeout = max(timeout, 10.0)

    cache_enabled = bool(mail_cfg.get('cache_enabled', False))
    cache_list_ttl_val = mail_cfg.get('cache_list_ttl', 180)
    cache_detail_ttl_val = mail_cfg.get('cache_detail_ttl', 3600)
    cache_max_entries_val = mail_cfg.get('cache_max_entries', 800)
    try:
        cache_list_ttl = max(0, int(cache_list_ttl_val))
    except Exception:
        cache_list_ttl = 180
    try:
        cache_detail_ttl = max(0, int(cache_detail_ttl_val))
    except Exception:
        cache_detail_ttl = 3600
    try:
        cache_max_entries = max(50, int(cache_max_entries_val))
    except Exception:
        cache_max_entries = 800

    return {
        'enabled': bool(mail_cfg.get('nexora_mail_enabled', False)),
        'service_url': service_url,
        'api_key': str(mail_cfg.get('api_key', '') or '').strip(),
        'timeout': timeout,
        'send_timeout': send_timeout,
        'cache_enabled': cache_enabled,
        'cache_list_ttl': cache_list_ttl,
        'cache_detail_ttl': cache_detail_ttl,
        'cache_max_entries': cache_max_entries,
        'default_group': str(mail_cfg.get('default_group', 'default') or 'default').strip() or 'default',
        'host': host,
        'port': port
    }


_MAIL_CACHE_LOCKS = {}
_MAIL_CACHE_LOCKS_GUARD = threading.Lock()

# Async upload tasks (in-memory)
_UPLOAD_TASKS = {}
_UPLOAD_TASKS_LOCK = threading.Lock()
_UPLOAD_TASK_TTL_SEC = 2 * 3600

_ASSET_IMAGE_MIME_TO_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
    "image/heic": ".heic",
    "image/heif": ".heif",
}


def _conversation_asset_root(username: str) -> str:
    return os.path.join(
        os.path.dirname(__file__),
        'data',
        'users',
        str(username or ''),
        'conversation_assets'
    )


def _conversation_asset_dir(username: str, conversation_id: str) -> str:
    return os.path.join(_conversation_asset_root(username), str(conversation_id or ''))


def _conversation_asset_index_path(username: str, conversation_id: str) -> str:
    return os.path.join(_conversation_asset_dir(username, conversation_id), 'index.json')


def _load_conversation_asset_index(username: str, conversation_id: str) -> Dict[str, Any]:
    idx_path = _conversation_asset_index_path(username, conversation_id)
    if not os.path.exists(idx_path):
        return {"assets": {}}
    try:
        with open(idx_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"assets": {}}
        assets = data.get("assets", {})
        if not isinstance(assets, dict):
            assets = {}
        data["assets"] = assets
        return data
    except Exception:
        return {"assets": {}}


def _save_conversation_asset_index(username: str, conversation_id: str, data: Dict[str, Any]):
    conv_dir = _conversation_asset_dir(username, conversation_id)
    os.makedirs(conv_dir, exist_ok=True)
    idx_path = _conversation_asset_index_path(username, conversation_id)
    payload = data if isinstance(data, dict) else {"assets": {}}
    if "assets" not in payload or not isinstance(payload.get("assets"), dict):
        payload["assets"] = {}
    with open(idx_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def _parse_image_data_url(raw_url: str):
    text = str(raw_url or "").strip()
    m = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", text, re.IGNORECASE | re.DOTALL)
    if not m:
        raise ValueError("invalid image data url")
    mime = str(m.group(1) or "").strip().lower()
    b64 = str(m.group(2) or "").strip()
    try:
        raw = base64.b64decode(b64, validate=True)
    except (ValueError, binascii.Error) as e:
        raise ValueError(f"invalid base64 image data: {str(e)}")
    return mime, raw


def _safe_asset_ext(mime: str) -> str:
    mt = str(mime or "").strip().lower()
    return _ASSET_IMAGE_MIME_TO_EXT.get(mt, ".bin")


def _persist_conversation_image_asset(username: str, conversation_id: str, file_item: Dict[str, Any]) -> Dict[str, Any]:
    item = file_item if isinstance(file_item, dict) else {}
    raw_url = str(item.get("url") or item.get("image_url") or "").strip()
    if not raw_url.startswith("data:image/"):
        return item

    mime, raw = _parse_image_data_url(raw_url)
    max_image_bytes = 12 * 1024 * 1024
    if len(raw) > max_image_bytes:
        raise ValueError("image too large (>12MB)")

    asset_id = uuid.uuid4().hex
    ext = _safe_asset_ext(mime)
    filename = f"{asset_id}{ext}"
    conv_dir = _conversation_asset_dir(username, conversation_id)
    os.makedirs(conv_dir, exist_ok=True)
    file_path = os.path.join(conv_dir, filename)
    with open(file_path, 'wb') as wf:
        wf.write(raw)

    index_data = _load_conversation_asset_index(username, conversation_id)
    assets_map = index_data.setdefault("assets", {})
    created_at = int(time.time())
    assets_map[asset_id] = {
        "asset_id": asset_id,
        "file_name": filename,
        "mime": mime,
        "size": len(raw),
        "name": str(item.get("name") or filename),
        "created_at": created_at
    }
    _save_conversation_asset_index(username, conversation_id, index_data)

    normalized = dict(item)
    normalized["asset_id"] = asset_id
    normalized["asset_url"] = f"/api/conversations/{conversation_id}/assets/{asset_id}"
    normalized["mime"] = mime
    normalized["size"] = len(raw)
    return normalized


def _prepare_chat_file_ids(username: str, conversation_id: str, file_ids: List[Any]) -> List[Any]:
    if not isinstance(file_ids, list) or not file_ids:
        return []
    normalized = []
    for f in file_ids:
        if isinstance(f, dict):
            f_type = str(f.get("type") or "").strip().lower()
            if f_type == "image_url":
                try:
                    normalized.append(_persist_conversation_image_asset(username, conversation_id, f))
                except Exception as e:
                    print(f"[ASSET] image persist failed: {e}")
                    normalized.append(f)
            else:
                normalized.append(f)
        else:
            normalized.append(f)
    return normalized


def _collect_referenced_asset_ids(conversation_data: Dict[str, Any]) -> set:
    out = set()
    if not isinstance(conversation_data, dict):
        return out
    msgs = conversation_data.get("messages", [])
    if not isinstance(msgs, list):
        return out
    for msg in msgs:
        if not isinstance(msg, dict):
            continue
        meta = msg.get("metadata", {})
        if not isinstance(meta, dict):
            continue
        attachments = meta.get("attachments", [])
        if not isinstance(attachments, list):
            continue
        for att in attachments:
            if not isinstance(att, dict):
                continue
            aid = str(att.get("asset_id") or "").strip()
            if aid:
                out.add(aid)
    return out


def _cleanup_conversation_assets(username: str, conversation_id: str, keep_asset_ids: Optional[set] = None):
    conv_dir = _conversation_asset_dir(username, conversation_id)
    if not os.path.isdir(conv_dir):
        return

    keep = keep_asset_ids if isinstance(keep_asset_ids, set) else set()
    idx = _load_conversation_asset_index(username, conversation_id)
    assets = idx.get("assets", {}) if isinstance(idx.get("assets"), dict) else {}
    kept_assets = {}
    for aid, meta in assets.items():
        aid_s = str(aid or "").strip()
        if not aid_s:
            continue
        if aid_s in keep:
            kept_assets[aid_s] = meta
            continue
        file_name = str((meta or {}).get("file_name") or "").strip()
        if file_name:
            fpath = os.path.join(conv_dir, file_name)
            try:
                if os.path.exists(fpath):
                    os.remove(fpath)
            except Exception:
                pass
    idx["assets"] = kept_assets
    _save_conversation_asset_index(username, conversation_id, idx)


def _remove_conversation_assets_dir(username: str, conversation_id: str):
    conv_dir = _conversation_asset_dir(username, conversation_id)
    if not os.path.isdir(conv_dir):
        return
    try:
        for root, dirs, files in os.walk(conv_dir, topdown=False):
            for name in files:
                try:
                    os.remove(os.path.join(root, name))
                except Exception:
                    pass
            for name in dirs:
                try:
                    os.rmdir(os.path.join(root, name))
                except Exception:
                    pass
        os.rmdir(conv_dir)
    except Exception:
        pass


def _get_mail_cache_lock(user_id):
    uid = str(user_id or '').strip()
    with _MAIL_CACHE_LOCKS_GUARD:
        if uid not in _MAIL_CACHE_LOCKS:
            _MAIL_CACHE_LOCKS[uid] = threading.Lock()
        return _MAIL_CACHE_LOCKS[uid]


def _mail_cache_file_path(user_id):
    return os.path.join(os.path.dirname(__file__), 'data', 'users', str(user_id), 'mail_cache.json')


def _mail_cache_empty():
    return {
        'version': 1,
        'updated_at': int(time.time()),
        'lists': {},
        'details': {}
    }


def _mail_cache_load(user_id):
    path = _mail_cache_file_path(user_id)
    if not os.path.exists(path):
        return _mail_cache_empty()
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return _mail_cache_empty()
        lists = data.get('lists')
        details = data.get('details')
        if not isinstance(lists, dict):
            lists = {}
        if not isinstance(details, dict):
            details = {}
        data['lists'] = lists
        data['details'] = details
        return data
    except Exception:
        return _mail_cache_empty()


def _mail_cache_save(user_id, data):
    path = _mail_cache_file_path(user_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data['updated_at'] = int(time.time())
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _mail_cache_prune(cache_data, max_entries):
    max_entries = max(50, int(max_entries or 800))

    def _prune_bucket(bucket, limit):
        if len(bucket) <= limit:
            return
        items = list(bucket.items())
        items.sort(key=lambda kv: int((kv[1] or {}).get('cached_at', 0) or 0), reverse=True)
        keep = dict(items[:limit])
        bucket.clear()
        bucket.update(keep)

    _prune_bucket(cache_data.get('lists', {}), max_entries)
    _prune_bucket(cache_data.get('details', {}), max_entries * 3)


def _mail_cache_make_list_key(folder, q, offset, limit):
    return f"{folder}|q={q}|offset={int(offset)}|limit={int(limit)}"


def _mail_cache_make_detail_key(folder, mail_id):
    return f"{folder}|id={str(mail_id)}"


def _mail_cache_is_fresh(entry, ttl):
    if not isinstance(entry, dict):
        return False
    cached_at = int(entry.get('cached_at', 0) or 0)
    if cached_at <= 0:
        return False
    ttl = int(ttl or 0)
    if ttl <= 0:
        return True
    return (int(time.time()) - cached_at) <= ttl


def _mail_cache_get_list(user_id, key, ttl):
    lock = _get_mail_cache_lock(user_id)
    with lock:
        cache_data = _mail_cache_load(user_id)
        entry = cache_data.get('lists', {}).get(key)
        if not _mail_cache_is_fresh(entry, ttl):
            return None
        payload = entry.get('payload')
        if not isinstance(payload, dict):
            return None
        return payload, int(entry.get('cached_at', 0) or 0)


def _mail_cache_set_list(user_id, key, payload, max_entries):
    lock = _get_mail_cache_lock(user_id)
    with lock:
        cache_data = _mail_cache_load(user_id)
        cache_data.setdefault('lists', {})[key] = {
            'cached_at': int(time.time()),
            'payload': payload
        }
        _mail_cache_prune(cache_data, max_entries)
        _mail_cache_save(user_id, cache_data)


def _mail_cache_get_detail(user_id, key, ttl):
    lock = _get_mail_cache_lock(user_id)
    with lock:
        cache_data = _mail_cache_load(user_id)
        entry = cache_data.get('details', {}).get(key)
        if not _mail_cache_is_fresh(entry, ttl):
            return None
        payload = entry.get('payload')
        if not isinstance(payload, dict):
            return None
        return payload, int(entry.get('cached_at', 0) or 0)


def _mail_cache_set_detail(user_id, key, payload, max_entries):
    lock = _get_mail_cache_lock(user_id)
    with lock:
        cache_data = _mail_cache_load(user_id)
        cache_data.setdefault('details', {})[key] = {
            'cached_at': int(time.time()),
            'payload': payload
        }
        _mail_cache_prune(cache_data, max_entries)
        _mail_cache_save(user_id, cache_data)


def _mail_cache_invalidate_user(user_id):
    lock = _get_mail_cache_lock(user_id)
    with lock:
        _mail_cache_save(user_id, _mail_cache_empty())


def _nexora_mail_call(path, method='GET', payload=None, query=None, timeout=None):
    """
    调用 NexoraMail API，统一返回:
    (ok: bool, status: int, data: dict)
    """
    cfg = _get_nexora_mail_config()
    if not cfg.get('enabled'):
        return False, 503, {'success': False, 'message': 'NexoraMail 未启用'}

    q = ''
    if query and isinstance(query, dict):
        pairs = []
        for k, v in query.items():
            if v is None:
                continue
            pairs.append((k, str(v)))
        if pairs:
            q = '?' + urllib_parse.urlencode(pairs)
    url = f"{cfg['service_url']}{path}{q}"

    body = None
    headers = {'Accept': 'application/json'}
    if cfg.get('api_key'):
        headers['X-API-Key'] = cfg['api_key']
    if payload is not None:
        headers['Content-Type'] = 'application/json; charset=utf-8'
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')

    req = urllib_request.Request(url, data=body, method=method.upper(), headers=headers)
    request_timeout = cfg['timeout'] if timeout is None else float(timeout)
    if request_timeout <= 0:
        request_timeout = cfg['timeout']
    try:
        with urllib_request.urlopen(req, timeout=request_timeout) as resp:
            status = getattr(resp, 'status', 200) or 200
            raw = resp.read().decode('utf-8', errors='replace')
            if raw.strip():
                try:
                    data = json.loads(raw)
                except Exception:
                    data = {'success': 200 <= status < 300, 'raw': raw}
            else:
                data = {'success': 200 <= status < 300}
            if 'success' not in data:
                data['success'] = 200 <= status < 300
            return 200 <= status < 300, status, data
    except urllib_error.HTTPError as e:
        status = getattr(e, 'code', 500) or 500
        try:
            raw = e.read().decode('utf-8', errors='replace')
            data = json.loads(raw) if raw.strip() else {}
        except Exception:
            data = {}
        if not isinstance(data, dict):
            data = {}
        if 'message' not in data:
            data['message'] = f'NexoraMail HTTP {status}'
        data['success'] = False
        return False, status, data
    except Exception as e:
        return False, 502, {'success': False, 'message': f'NexoraMail 连接失败: {str(e)}'}


def _get_nexora_mail_primary_domain(group_name):
    """读取 NexoraMail 用户组的首个绑定域名（bindDomains[0]）"""
    group = str(group_name or '').strip()
    if not group:
        return None
    ok, _, data = _nexora_mail_call('/api/groups', method='GET')
    if not ok or not isinstance(data, dict):
        return None
    groups = data.get('groups', [])
    if not isinstance(groups, list):
        return None
    for item in groups:
        if not isinstance(item, dict):
            continue
        if str(item.get('group') or '').strip() != group:
            continue
        domains = item.get('domains', [])
        if isinstance(domains, list):
            for d in domains:
                domain = str(d or '').strip()
                if domain:
                    return domain
    return None


def _build_mail_sender_address(mail_username, group, fallback_host):
    """按规则生成发件地址：mail_username@bindDomains[0]，无可用域名时回退 fallback_host"""
    local = str(mail_username or '').strip()
    if '@' in local:
        local = local.split('@', 1)[0].strip()
    if not local:
        return ''
    primary_domain = _get_nexora_mail_primary_domain(group)
    domain = str(primary_domain or fallback_host or 'localhost').strip() or 'localhost'
    return f"{local}@{domain}"


def _garbled_score_text(s):
    text = str(s or '')
    if not text:
        return 0
    suspicious = ('鎴', '馃', '锛', '锟', '�', '鏄', '鍐', '涓', '鐨')
    score = 0
    for token in suspicious:
        score += text.count(token)
    return score


def _repair_common_mojibake(text):
    """
    修复常见 UTF-8 被按 GBK/GB18030 错解后的乱码（如: 鎴戠殑 / 馃専）。
    保守策略：仅当修复后乱码评分下降时采用。
    """
    src = str(text or '')
    if not src:
        return src
    best = src
    best_score = _garbled_score_text(src)
    for enc in ('gb18030', 'gbk'):
        try:
            cand = src.encode(enc, errors='strict').decode('utf-8', errors='strict')
        except Exception:
            continue
        cand_score = _garbled_score_text(cand)
        if cand_score < best_score:
            best = cand
            best_score = cand_score
    return best


def _decode_literal_unicode_escapes(text):
    """Decode literal escape sequences like \\U0001F389 / \\u4F60 / \\x41."""
    s = str(text or "")
    if not s:
        return s

    def repl_surrogate_pair(m):
        try:
            hi = int(m.group(1), 16)
            lo = int(m.group(2), 16)
            cp = ((hi - 0xD800) << 10) + (lo - 0xDC00) + 0x10000
            return chr(cp)
        except Exception:
            return m.group(0)

    out = re.sub(
        r"\\u([dD][89abAB][0-9a-fA-F]{2})\\u([dD][cdefCDEF][0-9a-fA-F]{2})",
        repl_surrogate_pair,
        s,
    )

    def repl_u8(m):
        try:
            return chr(int(m.group(1), 16))
        except Exception:
            return m.group(0)

    def repl_u4(m):
        try:
            cp = int(m.group(1), 16)
            if 0xD800 <= cp <= 0xDFFF:
                return m.group(0)
            return chr(cp)
        except Exception:
            return m.group(0)

    def repl_x2(m):
        try:
            return chr(int(m.group(1), 16))
        except Exception:
            return m.group(0)

    out = re.sub(r"\\U([0-9a-fA-F]{8})", repl_u8, out)
    out = re.sub(r"\\u([0-9a-fA-F]{4})", repl_u4, out)
    out = re.sub(r"\\x([0-9a-fA-F]{2})", repl_x2, out)
    return out


def _build_utf8_raw_mail(sender, recipient, subject, content, is_html=False):
    """Build MIME raw email with UTF-8-safe headers/body for broad client compatibility."""
    ctype = "text/html" if bool(is_html) else "text/plain"
    subject_header = Header(str(subject or ""), "utf-8").encode()
    body_bytes = str(content or "").encode("utf-8", errors="replace")
    body_b64 = base64.b64encode(body_bytes).decode("ascii")
    body_lines = "\r\n".join(body_b64[i:i + 76] for i in range(0, len(body_b64), 76))
    return (
        f"Date: {formatdate(localtime=False)}\r\n"
        f"Message-ID: {make_msgid(domain='nexora.local')}\r\n"
        f"From: <{sender}>\r\n"
        f"To: <{recipient}>\r\n"
        f"Subject: {subject_header}\r\n"
        "MIME-Version: 1.0\r\n"
        f"Content-Type: {ctype}; charset=\"UTF-8\"\r\n"
        "Content-Transfer-Encoding: base64\r\n"
        "\r\n"
        f"{body_lines}\r\n"
    )

def load_models_config():
    """读取 models.json，返回标准结构"""
    if not os.path.exists(MODELS_PATH):
        return {"models": {}, "providers": {}}
    with open(MODELS_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if not isinstance(data, dict):
        return {"models": {}, "providers": {}}
    models = data.get("models", {})
    providers = data.get("providers", {})
    if not isinstance(models, dict):
        models = {}
    if not isinstance(providers, dict):
        providers = {}
    return {"models": models, "providers": providers}


def save_models_config(models_cfg):
    """保存 models.json"""
    payload = {
        "models": models_cfg.get("models", {}),
        "providers": models_cfg.get("providers", {})
    }
    with open(MODELS_PATH, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=4, ensure_ascii=False)


def _safe_context_window_int(raw):
    try:
        n = int(raw)
    except Exception:
        return 0
    if n < 1024:
        return 0
    return min(n, 4_000_000)


def _normalize_model_id_for_ctx(raw):
    return str(raw or '').strip().lower()


def _trim_model_id_last_hyphen_number(raw):
    s = _normalize_model_id_for_ctx(raw)
    if not s:
        return ''
    return re.sub(r'-\d+$', '', s).strip()


def _load_models_context_window_cache():
    if not os.path.exists(MODELS_CONTEXT_WINDOW_CACHE_PATH):
        return {"providers": {}, "updated_at": 0}
    try:
        with open(MODELS_CONTEXT_WINDOW_CACHE_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"providers": {}, "updated_at": 0}
        providers = data.get("providers", {})
        if not isinstance(providers, dict):
            providers = {}
        return {
            "providers": providers,
            "updated_at": int(data.get("updated_at", 0) or 0),
        }
    except Exception:
        return {"providers": {}, "updated_at": 0}


def _save_models_context_window_cache(cache_obj):
    payload = cache_obj if isinstance(cache_obj, dict) else {"providers": {}, "updated_at": 0}
    providers = payload.get("providers", {})
    if not isinstance(providers, dict):
        providers = {}
    payload["providers"] = providers
    payload["updated_at"] = int(time.time())
    try:
        with open(MODELS_CONTEXT_WINDOW_CACHE_PATH, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _extract_context_window_from_provider_row(row_obj):
    row = row_obj if isinstance(row_obj, dict) else {}
    for key in ('context_window', 'context_length', 'max_context_tokens', 'max_input_tokens', 'max_prompt_tokens'):
        n = _safe_context_window_int(row.get(key))
        if n > 0:
            return n
    raw = row.get("raw") if isinstance(row.get("raw"), dict) else {}
    for key in ('context_window', 'context_length', 'max_context_tokens', 'max_input_tokens', 'max_prompt_tokens'):
        n = _safe_context_window_int(raw.get(key))
        if n > 0:
            return n
    return 0


def _read_cached_volc_context_window_map():
    with _MODELS_CTX_CACHE_LOCK:
        cache = _load_models_context_window_cache()
    providers = cache.get("providers", {}) if isinstance(cache, dict) else {}
    volc = providers.get("volcengine", {}) if isinstance(providers, dict) else {}
    models_map = volc.get("models", {}) if isinstance(volc, dict) else {}
    out = {}
    if isinstance(models_map, dict):
        for k, v in models_map.items():
            key = _normalize_model_id_for_ctx(k)
            if not key:
                continue
            if isinstance(v, dict):
                n = _safe_context_window_int(v.get("context_window"))
            else:
                n = _safe_context_window_int(v)
            if n > 0:
                out[key] = n
    return out


def _write_cached_volc_context_window_map(models_map):
    src = models_map if isinstance(models_map, dict) else {}
    normalized = {}
    for k, v in src.items():
        key = _normalize_model_id_for_ctx(k)
        n = _safe_context_window_int(v)
        if key and n > 0:
            normalized[key] = {"context_window": n, "ts": int(time.time())}
    with _MODELS_CTX_CACHE_LOCK:
        cache = _load_models_context_window_cache()
        providers = cache.get("providers", {}) if isinstance(cache.get("providers"), dict) else {}
        providers["volcengine"] = {
            "models": normalized,
            "updated_at": int(time.time())
        }
        cache["providers"] = providers
        _save_models_context_window_cache(cache)


def _refresh_volc_context_window_map(config_obj, timeout=8.0):
    cfg = config_obj if isinstance(config_obj, dict) else {}
    providers = cfg.get("providers", {}) if isinstance(cfg.get("providers"), dict) else {}
    provider_cfg = providers.get("volcengine")
    cached = _read_cached_volc_context_window_map()
    if not isinstance(provider_cfg, dict):
        return cached
    api_key = str(provider_cfg.get('api_key', '') or '').strip()
    if not api_key:
        return cached

    try:
        adapter = create_provider_adapter('volcengine', provider_cfg)
        client = adapter.create_client(
            api_key=api_key,
            base_url=str(provider_cfg.get('base_url', '') or '').strip(),
            timeout=max(2.0, float(timeout or 8.0))
        )
        result = adapter.list_models(
            client=client,
            capability='',
            request_options={}
        )
        fresh_map = {}
        if isinstance(result, dict) and bool(result.get('ok', False)):
            models = result.get('models', [])
            if isinstance(models, list):
                for item in models:
                    if not isinstance(item, dict):
                        continue
                    model_id = _normalize_model_id_for_ctx(
                        item.get('id') or item.get('model_id') or item.get('name') or ''
                    )
                    if not model_id:
                        continue
                    ctx = _extract_context_window_from_provider_row(item)
                    if ctx <= 0:
                        continue
                    fresh_map[model_id] = ctx
        if not fresh_map:
            extra = _fetch_volc_foundation_models_context_map(provider_cfg, timeout=timeout)
            if isinstance(extra, dict) and extra:
                fresh_map.update(extra)
        if not fresh_map:
            return cached
        merged = dict(cached)
        merged.update(fresh_map)
        _write_cached_volc_context_window_map(merged)
        return merged
    except Exception:
        return cached


def _resolve_volc_context_window_by_model_id(model_id, models_map):
    sid = _normalize_model_id_for_ctx(model_id)
    if not sid or not isinstance(models_map, dict):
        return 0
    trimmed_target = _trim_model_id_last_hyphen_number(sid)
    if trimmed_target:
        for remote_id, ctx in models_map.items():
            if _trim_model_id_last_hyphen_number(remote_id) == trimmed_target:
                n = _safe_context_window_int(ctx)
                if n > 0:
                    return n
    n = _safe_context_window_int(models_map.get(sid))
    if n > 0:
        return n
    return 0


def _fetch_volc_foundation_models_context_map(provider_cfg, timeout=8.0):
    cfg = provider_cfg if isinstance(provider_cfg, dict) else {}
    signed_url = str(cfg.get('foundation_models_url', '') or '').strip()
    if not signed_url:
        return {}
    payload = cfg.get('foundation_models_payload')
    if not isinstance(payload, dict):
        payload = {"PageNumber": 1, "PageSize": 100, "SortBy": "CreateTime", "SortOrder": "Desc"}
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib_request.Request(
        signed_url,
        data=body,
        method='POST',
        headers={'Content-Type': 'application/json; charset=utf-8'}
    )
    try:
        with urllib_request.urlopen(req, timeout=max(2.0, float(timeout or 8.0))) as resp:
            raw = resp.read().decode('utf-8', errors='replace')
            data = json.loads(raw) if raw.strip() else {}
    except Exception:
        return {}

    def _extract_items(obj):
        if isinstance(obj, list):
            return obj
        if not isinstance(obj, dict):
            return []
        for key in ('data', 'models', 'items', 'ModelList', 'FoundationModels'):
            v = obj.get(key)
            if isinstance(v, list):
                return v
        result = obj.get('result') or obj.get('Result')
        if isinstance(result, dict):
            for key in ('data', 'models', 'items', 'ModelList', 'FoundationModels'):
                v = result.get(key)
                if isinstance(v, list):
                    return v
        return []

    out = {}
    for item in _extract_items(data):
        if not isinstance(item, dict):
            continue
        mid = _normalize_model_id_for_ctx(
            item.get('id') or item.get('model_id') or item.get('ModelId') or item.get('name') or item.get('Name') or ''
        )
        if not mid:
            continue
        ctx = _extract_context_window_from_provider_row(item)
        if ctx > 0:
            out[mid] = ctx
    return out

def get_chroma_store():
    """Get Chroma store if enabled."""
    config = get_config_all()
    rag = config.get('rag_database', {})
    if not rag.get('rag_database_enabled', False):
        return None, 'disabled'
    try:
        return ChromaStore(rag), None
    except Exception as e:
        return None, str(e)


def _normalize_vector_library(library, default='knowledge'):
    val = str(library or default).strip()
    return val or default


def _split_text_for_vectorization(text, max_len=800, overlap=120):
    t = str(text or '')
    if not t:
        return []
    max_len = int(max_len or 800)
    overlap = int(overlap or 120)
    if max_len <= 0:
        return [t]
    if overlap >= max_len:
        overlap = max_len // 4
    t = t.replace('\r\n', '\n')
    chunks = []
    start = 0
    length = len(t)
    while start < length:
        end = min(start + max_len, length)
        chunks.append({
            "text": t[start:end],
            "start": start,
            "end": end,
        })
        if end == length:
            break
        start = end - overlap if overlap > 0 else end
    return chunks


def _vectorize_text_to_store(
    username,
    title,
    text,
    *,
    metadata=None,
    library='knowledge',
    clear_existing=True,
    progress_callback=None
):
    store, store_err = get_chroma_store()
    if not store:
        return False, f'ChromaDB错误: {store_err}', []
    if getattr(store, 'mode', '') != 'service':
        return False, 'NexoraDB service mode required', []

    cfg = get_config_all()
    rag = cfg.get('rag_database', {}) if isinstance(cfg, dict) else {}
    chunk_size = int(rag.get('chunk_size') or 800)
    chunk_overlap = int(rag.get('chunk_overlap') or 120)
    upsert_batch_size = int(rag.get('upsert_batch_size') or 32)
    if upsert_batch_size <= 0:
        upsert_batch_size = 32
    chunks = _split_text_for_vectorization(text, chunk_size, chunk_overlap)
    if not chunks:
        return False, '文本为空', []

    lib = _normalize_vector_library(library, default='knowledge')
    meta_base = metadata if isinstance(metadata, dict) else {}
    vector_ids = []

    if clear_existing and title:
        try:
            store.delete_by_title(username, title, library=lib)
        except Exception:
            pass

    total_chunks = len(chunks)
    try:
        use_batch = hasattr(store, 'upsert_texts')
        done = 0
        if use_batch:
            for start in range(0, total_chunks, upsert_batch_size):
                end = min(start + upsert_batch_size, total_chunks)
                batch_items = []
                for i in range(start, end):
                    chunk = chunks[i]
                    chunk_meta = dict(meta_base)
                    chunk_meta.update({
                        'chunk_id': i,
                        'chunk_total': total_chunks,
                        'chunk_start': chunk.get('start', 0),
                        'chunk_end': chunk.get('end', 0),
                    })
                    batch_items.append({
                        'title': title,
                        'text': chunk.get('text', ''),
                        'metadata': chunk_meta,
                        'chunk_id': i,
                        'library': lib
                    })

                try:
                    batch_ids = store.upsert_texts(
                        username=username,
                        items=batch_items,
                        library=lib
                    )
                except Exception:
                    # 兼容旧版 NexoraDB：批量接口不可用时回退单条
                    batch_ids = []
                    for item in batch_items:
                        vid = store.upsert_text(
                            username,
                            item.get('title'),
                            item.get('text', ''),
                            item.get('metadata') or {},
                            chunk_id=item.get('chunk_id'),
                            library=item.get('library', lib)
                        )
                        batch_ids.append(vid)

                vector_ids.extend(batch_ids)
                done = end
                if callable(progress_callback):
                    progress_callback(done, total_chunks)
        else:
            for i, chunk in enumerate(chunks):
                chunk_meta = dict(meta_base)
                chunk_meta.update({
                    'chunk_id': i,
                    'chunk_total': total_chunks,
                    'chunk_start': chunk.get('start', 0),
                    'chunk_end': chunk.get('end', 0),
                })
                vector_id = store.upsert_text(
                    username,
                    title,
                    chunk.get('text', ''),
                    chunk_meta,
                    chunk_id=i,
                    library=lib
                )
                vector_ids.append(vector_id)
                if callable(progress_callback):
                    progress_callback(i + 1, total_chunks)
        return True, '', vector_ids
    except Exception as e:
        return False, f'存储失败: {str(e)}', vector_ids


def _temp_file_vector_title(file_alias: str) -> str:
    return f"temp_file::{str(file_alias or '').strip()}"


def _build_temp_file_where(username: str, file_ref: str):
    raw = str(file_ref or '').strip().replace('\\', '/')
    if not raw:
        return None
    base = os.path.basename(raw) if raw else ''
    candidates = []

    def _push(k, v):
        val = str(v or '').strip()
        if not val:
            return
        candidates.append({str(k): val})

    _push('file_alias', raw)
    _push('sandbox_path', raw)
    if base and base != raw:
        _push('file_alias', base)
        _push('sandbox_path', f"{username}/files/{base}")
    elif base:
        _push('sandbox_path', f"{username}/files/{base}")

    # de-dup
    uniq = []
    seen = set()
    for c in candidates:
        key = tuple(sorted(c.items()))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(c)
    if not uniq:
        return None
    if len(uniq) == 1:
        return uniq[0]
    return {"$or": uniq}


def _is_query_result_empty(result: dict) -> bool:
    if not isinstance(result, dict):
        return True
    ids = result.get('ids', [])
    if not isinstance(ids, list) or not ids:
        return True
    first = ids[0]
    if isinstance(first, list):
        return len(first) == 0
    return len(ids) == 0


def _filter_temp_file_query_result(result: dict, username: str, file_ref: str, top_k: int = 5) -> dict:
    if not isinstance(result, dict):
        return {"ids": [[]], "documents": [[]], "metadatas": [[]], "distances": [[]]}

    raw = str(file_ref or '').strip().replace('\\', '/')
    base = os.path.basename(raw) if raw else ''
    expected_sandbox = f"{username}/files/{base}" if base else ""
    expected_title = _temp_file_vector_title(base) if base else ""

    ids = result.get('ids', [[]])
    docs = result.get('documents', [[]])
    metas = result.get('metadatas', [[]])
    dists = result.get('distances', [[]])

    src_ids = ids[0] if isinstance(ids, list) and ids and isinstance(ids[0], list) else []
    src_docs = docs[0] if isinstance(docs, list) and docs and isinstance(docs[0], list) else []
    src_metas = metas[0] if isinstance(metas, list) and metas and isinstance(metas[0], list) else []
    src_dists = dists[0] if isinstance(dists, list) and dists and isinstance(dists[0], list) else []

    out_ids, out_docs, out_metas, out_dists = [], [], [], []
    for i, vid in enumerate(src_ids):
        meta = src_metas[i] if i < len(src_metas) and isinstance(src_metas[i], dict) else {}
        m_alias = str(meta.get('file_alias') or '').strip()
        m_path = str(meta.get('sandbox_path') or '').strip().replace('\\', '/')
        m_title = str(meta.get('title') or '').strip()
        m_original = str(meta.get('original_name') or '').strip()

        matched = False
        if raw and (m_alias == raw or m_path == raw):
            matched = True
        if not matched and base and (
            m_alias == base
            or m_original == base
            or m_path.endswith(f"/{base}")
            or m_path == expected_sandbox
        ):
            matched = True
        if not matched and expected_title and m_title == expected_title:
            matched = True

        if not matched:
            continue
        out_ids.append(vid)
        out_docs.append(src_docs[i] if i < len(src_docs) else "")
        out_metas.append(meta)
        out_dists.append(src_dists[i] if i < len(src_dists) else None)
        if len(out_ids) >= max(1, int(top_k or 5)):
            break

    return {
        "ids": [out_ids],
        "documents": [out_docs],
        "metadatas": [out_metas],
        "distances": [out_dists]
    }


def _upload_task_cleanup_locked():
    now = int(time.time())
    stale_ids = []
    for tid, task in _UPLOAD_TASKS.items():
        updated_at = int(task.get('updated_at', 0) or 0)
        if updated_at <= 0:
            updated_at = int(task.get('created_at', 0) or 0)
        if updated_at > 0 and (now - updated_at) > _UPLOAD_TASK_TTL_SEC:
            stale_ids.append(tid)
    for tid in stale_ids:
        _UPLOAD_TASKS.pop(tid, None)


def _upload_task_create(
    username: str,
    filename: str,
    task_type: str = 'upload_file',
    extra: dict = None
) -> str:
    task_id = uuid.uuid4().hex
    now = int(time.time())
    task = {
        'task_id': task_id,
        'username': str(username or ''),
        'filename': str(filename or ''),
        'task_type': str(task_type or 'upload_file'),
        'status': 'queued',
        'stage': 'queued',
        'progress': 0,
        'message': '任务已创建',
        'error': '',
        'result': None,
        'cancel_requested': False,
        'created_at': now,
        'updated_at': now
    }
    if isinstance(extra, dict) and extra:
        task['extra'] = dict(extra)
    with _UPLOAD_TASKS_LOCK:
        _upload_task_cleanup_locked()
        _UPLOAD_TASKS[task_id] = task
    return task_id


def _upload_task_update(task_id: str, **kwargs):
    with _UPLOAD_TASKS_LOCK:
        task = _UPLOAD_TASKS.get(task_id)
        if not task:
            return None
        for k, v in kwargs.items():
            task[k] = v
        task['updated_at'] = int(time.time())
        return dict(task)


def _upload_task_get(task_id: str):
    with _UPLOAD_TASKS_LOCK:
        _upload_task_cleanup_locked()
        task = _UPLOAD_TASKS.get(task_id)
        if not task:
            return None
        return dict(task)


def _upload_task_cancel_requested(task_id: str) -> bool:
    with _UPLOAD_TASKS_LOCK:
        task = _UPLOAD_TASKS.get(task_id)
        if not task:
            return False
        return bool(task.get('cancel_requested', False))


def _upload_task_mark_cancel(task_id: str) -> bool:
    with _UPLOAD_TASKS_LOCK:
        task = _UPLOAD_TASKS.get(task_id)
        if not task:
            return False
        task['cancel_requested'] = True
        task['updated_at'] = int(time.time())
        if task.get('status') == 'queued':
            task['status'] = 'cancelled'
            task['stage'] = 'cancelled'
            task['progress'] = 0
            task['message'] = '任务已取消'
        return True


def _run_upload_task(task_id: str, username: str, filename: str, raw: bytes, update_file_name: str = None):
    sentinel_cancel = '__UPLOAD_TASK_CANCELLED__'
    sandbox = UserFileSandbox(username)
    entry = None
    try:
        _upload_task_update(task_id, status='running', stage='parsing', progress=5, message='正在解析文件')
        if _upload_task_cancel_requested(task_id):
            raise RuntimeError(sentinel_cancel)

        entry = sandbox.add_upload(
            file_bytes=raw,
            original_name=filename,
            update_file_name=update_file_name
        )
        _upload_task_update(task_id, stage='parsing', progress=30, message='文件解析完成')

        if _upload_task_cancel_requested(task_id):
            raise RuntimeError(sentinel_cancel)

        vectorized = False
        vector_ids = []
        vector_message = ''
        try:
            stored_rel = str(entry.get('stored_path') or '').replace('\\', '/')
            abs_path = os.path.normpath(os.path.join(os.path.dirname(__file__), stored_rel))
            if os.path.isfile(abs_path):
                with open(abs_path, 'r', encoding='utf-8') as f:
                    text = f.read()
            else:
                text = ''

            if str(text or '').strip():
                alias = str(entry.get('alias') or filename)
                vec_title = _temp_file_vector_title(alias)
                _upload_task_update(task_id, stage='vectorizing', progress=35, message='开始向量化')

                def _on_vec_progress(done, total):
                    if _upload_task_cancel_requested(task_id):
                        raise RuntimeError(sentinel_cancel)
                    total_num = max(1, int(total or 1))
                    done_num = max(0, int(done or 0))
                    pct = 35 + int((done_num / total_num) * 60)
                    pct = max(35, min(95, pct))
                    _upload_task_update(
                        task_id,
                        stage='vectorizing',
                        progress=pct,
                        message=f'向量化中 {done_num}/{total_num}'
                    )

                ok, err, vec_ids = _vectorize_text_to_store(
                    username,
                    vec_title,
                    text,
                    metadata={
                        'library': 'temp_file',
                        'source_type': 'upload_file',
                        'file_alias': alias,
                        'original_name': str(entry.get('original_name') or filename),
                        'sandbox_path': str(entry.get('sandbox_path') or ''),
                    },
                    library='temp_file',
                    clear_existing=True,
                    progress_callback=_on_vec_progress
                )
                vectorized = bool(ok)
                vector_ids = vec_ids if isinstance(vec_ids, list) else []
                vector_message = '' if ok else str(err or '')
        except Exception as ve:
            if sentinel_cancel in str(ve):
                raise
            vectorized = False
            vector_message = str(ve)

        result = {
            'success': True,
            'type': 'sandbox_file',
            'filename': entry.get('original_name', filename),
            'update_file_name': entry.get('alias'),
            'sandbox_path': entry.get('sandbox_path'),
            'stored_path': entry.get('stored_path'),
            'source_ext': entry.get('source_ext'),
            'parser_mode': entry.get('parser_mode'),
            'size': entry.get('size', 0),
            'vectorized': vectorized,
            'vector_chunk_count': len(vector_ids),
            'vector_ids': vector_ids,
            'vector_library': 'temp_file',
            'vector_title': _temp_file_vector_title(entry.get('alias') or filename),
            'vector_message': vector_message,
            'message': '已上传到文件沙箱'
        }

        if _upload_task_cancel_requested(task_id):
            raise RuntimeError(sentinel_cancel)

        _upload_task_update(
            task_id,
            status='completed',
            stage='done',
            progress=100,
            message='上传与向量化完成',
            result=result
        )
    except Exception as e:
        err_text = str(e)
        if sentinel_cancel in err_text or _upload_task_cancel_requested(task_id):
            try:
                if entry and entry.get('alias'):
                    sandbox.remove_file(str(entry.get('alias')))
            except Exception:
                pass
            _upload_task_update(
                task_id,
                status='cancelled',
                stage='cancelled',
                progress=0,
                message='任务已取消',
                error=''
            )
            return

        _upload_task_update(
            task_id,
            status='failed',
            stage='failed',
            progress=100,
            message='处理失败',
            error=err_text
        )


def _run_knowledge_vectorize_task(task_id: str, username: str, title: str, library: str = 'knowledge'):
    sentinel_cancel = '__KNOWLEDGE_VECTOR_TASK_CANCELLED__'
    lib = _normalize_vector_library(library, default='knowledge')
    try:
        _upload_task_update(task_id, status='running', stage='loading', progress=5, message='正在读取知识内容')
        if _upload_task_cancel_requested(task_id):
            raise RuntimeError(sentinel_cancel)

        user = User(username)
        text = user.getBasisContent(title)
        if not str(text or '').strip():
            raise ValueError('知识内容为空，无法向量化')

        _upload_task_update(task_id, stage='vectorizing', progress=12, message='开始向量化')

        def _on_vec_progress(done, total):
            if _upload_task_cancel_requested(task_id):
                raise RuntimeError(sentinel_cancel)
            total_num = max(1, int(total or 1))
            done_num = max(0, int(done or 0))
            pct = 12 + int((done_num / total_num) * 84)
            pct = max(12, min(96, pct))
            _upload_task_update(
                task_id,
                stage='vectorizing',
                progress=pct,
                message=f'向量化中 {done_num}/{total_num}'
            )

        ok, err, doc_ids = _vectorize_text_to_store(
            username,
            title,
            text,
            metadata={'source_type': 'knowledge_basis', 'title': title, 'library': lib},
            library=lib,
            clear_existing=True,
            progress_callback=_on_vec_progress
        )
        if not ok:
            raise RuntimeError(str(err or '向量化失败'))

        try:
            user.updateBasisVectorTime(title)
        except Exception:
            pass

        if _upload_task_cancel_requested(task_id):
            raise RuntimeError(sentinel_cancel)

        result = {
            'success': True,
            'title': title,
            'library': lib,
            'stored_count': len(doc_ids or []),
            'vector_ids': doc_ids or [],
            'message': '知识向量化完成'
        }
        _upload_task_update(
            task_id,
            status='completed',
            stage='done',
            progress=100,
            message='知识向量化完成',
            result=result
        )
    except Exception as e:
        err_text = str(e)
        if sentinel_cancel in err_text or _upload_task_cancel_requested(task_id):
            _upload_task_update(
                task_id,
                status='cancelled',
                stage='cancelled',
                progress=0,
                message='任务已取消',
                error=''
            )
            return
        _upload_task_update(
            task_id,
            status='failed',
            stage='failed',
            progress=100,
            message='处理失败',
            error=err_text
        )

def jsonify_safe(payload, status=200):
    return Response(
        json.dumps(payload, ensure_ascii=False, default=str),
        status=status,
        mimetype='application/json'
    )


def _get_chunk_debug_content(chunk):
    """Extract display content for stream debug logs."""
    if not isinstance(chunk, dict):
        return chunk

    if "content" in chunk and chunk.get("content") is not None:
        return chunk.get("content")

    # If there is no direct content field, print the rest of payload.
    return {k: v for k, v in chunk.items() if k != "type"}


def _log_stream_chunk(chunk, model_name=None):
    """Print every stream chunk type + content when log_status=all."""
    chunk_type = "unknown"
    if isinstance(chunk, dict):
        chunk_type = chunk.get("type", "unknown")
    content = _get_chunk_debug_content(chunk)

    try:
        content_dump = json.dumps(content, ensure_ascii=False, default=str)
    except Exception:
        content_dump = str(content)

    prefix = "[MODEL_STREAM]"
    if model_name:
        prefix = f"[MODEL_STREAM][{model_name}]"
    print(f"{prefix} type={chunk_type} content={content_dump}")


def require_papi_key(f):
    """公有 API 密钥验证装饰器"""
    from functools import wraps
    @wraps(f)
    def decorated_function(*args, **kwargs):
        config = get_config_all()
        api_config = config.get('api', {})
        
        if not api_config.get('public_api_enabled', False):
            return jsonify({'success': False, 'message': 'Public API is disabled'}), 403
            
        auth_key = request.headers.get('X-API-Key') or request.args.get('api_key')
        expected_key = api_config.get('public_api_key')
        
        if not auth_key or auth_key != expected_key:
            return jsonify({'success': False, 'message': 'Invalid or missing API Key'}), 401
            
        return f(*args, **kwargs)
    return decorated_function

# ==================== 认证相关 ====================

@app.route('/')
def index():
    """首页：未登录展示 Landing，已登录进入聊天"""
    if 'username' in session:
        return redirect(url_for('chat', **request.args))
    return render_template('introduce.html')

@app.route('/status')
def status_page():
    """公开状态页"""
    return render_template('status.html')
    
@app.route('/favicon.ico')
def favicon():
    """Icon"""
    return send_from_directory(
        os.path.join(app.root_path, 'static', 'img'),
        'Nexora.ico',
        mimetype='image/vnd.microsoft.icon'
    )


@app.route('/login', methods=['GET', 'POST'])
def login():
    """登录页面"""
    if request.method == 'GET':
        if 'username' in session:
            return redirect(url_for('chat'))
        return render_template('login.html')
    
    # POST - 处理登录
    data = request.get_json() or {}
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({'success': False, 'message': '用户名和密码不能为空'})
    
    try:
        # 验证用户
        users = load_users()
        
        if username not in users:
            return jsonify({'success': False, 'message': '用户不存在'})
        
        if users[username]['password'] != password:
            return jsonify({'success': False, 'message': '密码错误'})
        
        # 更新登录IP
        users[username]['last_ip'] = request.remote_addr
        users[username]['last_login'] = int(time.time())
        save_users(users)
            
        # 登录成功
        session['username'] = username
        session['role'] = users[username].get('role', 'member')
        session.permanent = True
        return jsonify({'success': True, 'message': '登录成功'})
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'登录失败: {str(e)}'})


@app.route('/logout')
def logout():
    """登出"""
    session.clear()
    return redirect(url_for('index'))


def require_login(f):
    """登录装饰器"""
    from functools import wraps
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'username' not in session:
            return jsonify({'success': False, 'message': '请先登录'}), 401
        return f(*args, **kwargs)
    return decorated_function


def require_admin(f):
    """管理员专用装饰器"""
    from functools import wraps
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'username' not in session:
            return jsonify({'success': False, 'message': '请先登录'}), 401
        if session.get('role') != 'admin':
            return jsonify({'success': False, 'message': '权限不足，仅管理员可访问'}), 403
        return f(*args, **kwargs)
    return decorated_function


# ==================== 用户信息 API ====================

@app.route('/api/user/info', methods=['GET'])
def get_user_info():
    """获取当前登录用户的信息"""
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401
    
    try:
        users = load_users()
            
        if username not in users:
            return jsonify({'success': False, 'message': '用户不存在'}), 404
            
        user_data = users[username]
        display_name = user_data.get('display_name', username)
        
        # 获取用户统计信息
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


@app.route('/api/user/profile/update', methods=['POST'])
@require_login
def update_user_profile():
    """更新当前用户资料（显示名、头像）"""
    user_id = session.get('username')
    data = request.get_json() or {}
    new_name = (data.get('display_name') or '').strip()
    avatar_base64 = data.get('avatar_base64')

    if not new_name:
        return jsonify({'success': False, 'message': '用户名不能为空'}), 400
    if len(new_name) > 32:
        return jsonify({'success': False, 'message': '用户名长度不能超过 32'}), 400

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
            profile_dir = os.path.dirname(get_user_avatar_file(user_id))
            os.makedirs(profile_dir, exist_ok=True)
            with open(get_user_avatar_file(user_id), 'wb') as f:
                f.write(raw)
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


@app.route('/api/user/local-mail', methods=['GET'])
@require_login
def get_current_user_local_mail():
    """获取当前用户绑定的本地邮箱信息"""
    user_id = session.get('username')
    users = load_users()
    if user_id not in users:
        return jsonify({'success': False, 'message': '用户不存在'}), 404
    return jsonify({'success': True, 'local_mail': get_local_mail_profile(users[user_id])})


@app.route('/api/notes/store', methods=['GET'])
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


@app.route('/api/notes/store', methods=['PUT', 'POST'])
@require_login
def save_notes_store():
    """保存当前用户笔记云存储（全量覆盖）。"""
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401

    payload = request.get_json(silent=True) or {}
    store = payload.get('store')
    if not isinstance(store, dict):
        return jsonify({'success': False, 'message': 'store 参数缺失或格式错误'}), 400

    try:
        user = User(username)
        normalized = user.save_notes_store(store)
        return jsonify({'success': True, 'store': normalized})
    except Exception as e:
        print(f"Error saving notes store: {e}")
        return jsonify({'success': False, 'message': '保存笔记失败'}), 500


def _resolve_current_user_mail_binding():
    """解析当前用户的本地邮箱绑定"""
    user_id = session.get('username')
    if not user_id:
        return None, ('未登录', 401)
    users = load_users()
    if user_id not in users:
        return None, ('用户不存在', 404)

    cfg = _get_nexora_mail_config()
    if not cfg.get('enabled'):
        return None, ('NexoraMail 未启用', 503)

    local_mail = get_local_mail_profile(users[user_id])
    mail_username = str(local_mail.get('username') or '').strip()
    if not mail_username:
        return None, ('当前用户未绑定邮箱账户', 400)

    group = str(local_mail.get('group') or cfg.get('default_group') or 'default').strip() or 'default'
    return {
        'user_id': user_id,
        'group': group,
        'mail_username': mail_username,
        'local_mail': local_mail
    }, None


@app.route('/api/mail/me/status', methods=['GET'])
@require_login
def mail_me_status():
    """当前用户邮件绑定状态"""
    cfg = _get_nexora_mail_config()
    user_id = session.get('username')
    users = load_users()
    local_mail = get_local_mail_profile(users.get(user_id, {}))
    linked = bool(local_mail.get('username'))
    sender_address = ''
    if linked:
        host = str(cfg.get('host') or 'localhost').strip() or 'localhost'
        group = str(local_mail.get('group') or cfg.get('default_group') or 'default').strip() or 'default'
        sender_address = _build_mail_sender_address(local_mail.get('username'), group, host)
    if not cfg.get('enabled'):
        return jsonify({
            'success': True,
            'enabled': False,
            'linked': linked,
            'local_mail': local_mail,
            'sender_address': sender_address,
            'message': 'NexoraMail 未启用'
        })

    health_ok, health_status, health_data = _nexora_mail_call('/api/health', method='GET')
    return jsonify({
        'success': True,
        'enabled': True,
        'linked': linked,
        'local_mail': local_mail,
        'sender_address': sender_address,
        'connected': bool(health_ok),
        'upstream_status': health_status,
        'upstream': health_data
    })


@app.route('/api/mail/me/inbox', methods=['GET'])
@require_login
def mail_me_inbox():
    """当前用户收件箱列表"""
    binding, err = _resolve_current_user_mail_binding()
    if err:
        return jsonify({'success': False, 'message': err[0]}), err[1]

    cfg = _get_nexora_mail_config()
    cache_enabled = bool(cfg.get('cache_enabled'))
    cache_mode = (request.args.get('cache_mode') or 'cache_first').strip().lower()
    if cache_mode not in ('cache_first', 'refresh', 'off'):
        cache_mode = 'cache_first'
    q = (request.args.get('q') or '').strip()
    offset = max(int(request.args.get('offset', 0) or 0), 0)
    limit = min(max(int(request.args.get('limit', 50) or 50), 1), 200)
    list_key = _mail_cache_make_list_key('inbox', q, offset, limit)

    if cache_enabled and cache_mode == 'cache_first':
        cached = _mail_cache_get_list(binding['user_id'], list_key, cfg.get('cache_list_ttl', 180))
        if cached:
            payload, cached_at = cached
            payload = dict(payload)
            payload['cache'] = {'enabled': True, 'hit': True, 'mode': 'cache_first', 'cached_at': cached_at}
            return jsonify(payload)

    path = f"/api/mailboxes/{urllib_parse.quote(binding['group'])}/{urllib_parse.quote(binding['mail_username'])}/mails"
    ok, status, data = _nexora_mail_call(path, method='GET', query={'q': q, 'offset': offset, 'limit': limit})
    if not ok:
        if cache_enabled and cache_mode == 'refresh':
            cached = _mail_cache_get_list(binding['user_id'], list_key, 0)
            if cached:
                payload, cached_at = cached
                payload = dict(payload)
                payload['cache'] = {'enabled': True, 'hit': True, 'mode': 'stale_fallback', 'cached_at': cached_at}
                payload['stale'] = True
                return jsonify(payload)
        return jsonify({'success': False, 'message': data.get('message', '读取收件箱失败'), 'upstream': data}), status

    response_payload = {
        'success': True,
        'group': binding['group'],
        'mail_username': binding['mail_username'],
        'local_mail': binding['local_mail'],
        'total': data.get('total', 0),
        'unread_total': data.get('unread_total', 0),
        'offset': data.get('offset', offset),
        'limit': data.get('limit', limit),
        'mails': data.get('mails', [])
    }
    if cache_enabled:
        _mail_cache_set_list(binding['user_id'], list_key, response_payload, cfg.get('cache_max_entries', 800))
    response_payload['cache'] = {'enabled': cache_enabled, 'hit': False, 'mode': cache_mode}
    return jsonify(response_payload)


@app.route('/api/mail/me/sent', methods=['GET'])
@require_login
def mail_me_sent():
    """当前用户发件箱列表"""
    binding, err = _resolve_current_user_mail_binding()
    if err:
        return jsonify({'success': False, 'message': err[0]}), err[1]

    cfg = _get_nexora_mail_config()
    cache_enabled = bool(cfg.get('cache_enabled'))
    cache_mode = (request.args.get('cache_mode') or 'cache_first').strip().lower()
    if cache_mode not in ('cache_first', 'refresh', 'off'):
        cache_mode = 'cache_first'
    q = (request.args.get('q') or '').strip()
    offset = max(int(request.args.get('offset', 0) or 0), 0)
    limit = min(max(int(request.args.get('limit', 50) or 50), 1), 200)
    list_key = _mail_cache_make_list_key('sent', q, offset, limit)

    if cache_enabled and cache_mode == 'cache_first':
        cached = _mail_cache_get_list(binding['user_id'], list_key, cfg.get('cache_list_ttl', 180))
        if cached:
            payload, cached_at = cached
            payload = dict(payload)
            payload['cache'] = {'enabled': True, 'hit': True, 'mode': 'cache_first', 'cached_at': cached_at}
            return jsonify(payload)

    path = f"/api/mailboxes/{urllib_parse.quote(binding['group'])}/{urllib_parse.quote(binding['mail_username'])}/sent"
    ok, status, data = _nexora_mail_call(path, method='GET', query={'q': q, 'offset': offset, 'limit': limit})
    if not ok:
        if cache_enabled and cache_mode == 'refresh':
            cached = _mail_cache_get_list(binding['user_id'], list_key, 0)
            if cached:
                payload, cached_at = cached
                payload = dict(payload)
                payload['cache'] = {'enabled': True, 'hit': True, 'mode': 'stale_fallback', 'cached_at': cached_at}
                payload['stale'] = True
                return jsonify(payload)
        return jsonify({'success': False, 'message': data.get('message', '读取发件箱失败'), 'upstream': data}), status

    response_payload = {
        'success': True,
        'group': binding['group'],
        'mail_username': binding['mail_username'],
        'local_mail': binding['local_mail'],
        'total': data.get('total', 0),
        'offset': data.get('offset', offset),
        'limit': data.get('limit', limit),
        'mails': data.get('mails', [])
    }
    if cache_enabled:
        _mail_cache_set_list(binding['user_id'], list_key, response_payload, cfg.get('cache_max_entries', 800))
    response_payload['cache'] = {'enabled': cache_enabled, 'hit': False, 'mode': cache_mode}
    return jsonify(response_payload)


@app.route('/api/mail/me/inbox/<mail_id>', methods=['GET'])
@require_login
def mail_me_inbox_item(mail_id):
    """当前用户读取单封邮件详情"""
    binding, err = _resolve_current_user_mail_binding()
    if err:
        return jsonify({'success': False, 'message': err[0]}), err[1]

    cfg = _get_nexora_mail_config()
    cache_enabled = bool(cfg.get('cache_enabled'))
    cache_mode = (request.args.get('cache_mode') or 'cache_first').strip().lower()
    if cache_mode not in ('cache_first', 'refresh', 'off'):
        cache_mode = 'cache_first'
    detail_key = _mail_cache_make_detail_key('inbox', mail_id)
    if cache_enabled and cache_mode == 'cache_first':
        cached = _mail_cache_get_detail(binding['user_id'], detail_key, cfg.get('cache_detail_ttl', 3600))
        if cached:
            payload, cached_at = cached
            payload = dict(payload)
            payload['cache'] = {'enabled': True, 'hit': True, 'mode': 'cache_first', 'cached_at': cached_at}
            return jsonify(payload)

    path = f"/api/mailboxes/{urllib_parse.quote(binding['group'])}/{urllib_parse.quote(binding['mail_username'])}/mails/{urllib_parse.quote(str(mail_id))}"
    ok, status, data = _nexora_mail_call(path, method='GET')
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '读取邮件失败'), 'upstream': data}), status
    response_payload = {
        'success': True,
        'group': binding['group'],
        'mail_username': binding['mail_username'],
        'mail': data.get('mail', {})
    }
    if cache_enabled:
        _mail_cache_set_detail(binding['user_id'], detail_key, response_payload, cfg.get('cache_max_entries', 800))
    response_payload['cache'] = {'enabled': cache_enabled, 'hit': False, 'mode': cache_mode}
    return jsonify(response_payload)


@app.route('/api/mail/me/sent/<mail_id>', methods=['GET'])
@require_login
def mail_me_sent_item(mail_id):
    """当前用户读取单封发件详情"""
    binding, err = _resolve_current_user_mail_binding()
    if err:
        return jsonify({'success': False, 'message': err[0]}), err[1]

    cfg = _get_nexora_mail_config()
    cache_enabled = bool(cfg.get('cache_enabled'))
    cache_mode = (request.args.get('cache_mode') or 'cache_first').strip().lower()
    if cache_mode not in ('cache_first', 'refresh', 'off'):
        cache_mode = 'cache_first'
    detail_key = _mail_cache_make_detail_key('sent', mail_id)
    if cache_enabled and cache_mode == 'cache_first':
        cached = _mail_cache_get_detail(binding['user_id'], detail_key, cfg.get('cache_detail_ttl', 3600))
        if cached:
            payload, cached_at = cached
            payload = dict(payload)
            payload['cache'] = {'enabled': True, 'hit': True, 'mode': 'cache_first', 'cached_at': cached_at}
            return jsonify(payload)

    path = f"/api/mailboxes/{urllib_parse.quote(binding['group'])}/{urllib_parse.quote(binding['mail_username'])}/sent/{urllib_parse.quote(str(mail_id))}"
    ok, status, data = _nexora_mail_call(path, method='GET')
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '读取发件失败'), 'upstream': data}), status
    response_payload = {
        'success': True,
        'group': binding['group'],
        'mail_username': binding['mail_username'],
        'mail': data.get('mail', {})
    }
    if cache_enabled:
        _mail_cache_set_detail(binding['user_id'], detail_key, response_payload, cfg.get('cache_max_entries', 800))
    response_payload['cache'] = {'enabled': cache_enabled, 'hit': False, 'mode': cache_mode}
    return jsonify(response_payload)


@app.route('/api/mail/me/inbox/<mail_id>/read', methods=['PATCH'])
@require_login
def mail_me_mark_read(mail_id):
    """当前用户更新邮件已读状态"""
    binding, err = _resolve_current_user_mail_binding()
    if err:
        return jsonify({'success': False, 'message': err[0]}), err[1]

    payload = request.get_json(silent=True) or {}
    raw_value = payload.get('is_read', payload.get('read', True))
    if isinstance(raw_value, bool):
        is_read = raw_value
    elif isinstance(raw_value, str):
        is_read = raw_value.strip().lower() in ('1', 'true', 'yes', 'y', 'on')
    elif isinstance(raw_value, (int, float)):
        is_read = bool(raw_value)
    else:
        is_read = bool(raw_value)

    path = f"/api/mailboxes/{urllib_parse.quote(binding['group'])}/{urllib_parse.quote(binding['mail_username'])}/mails/{urllib_parse.quote(str(mail_id))}/read"
    ok, status, data = _nexora_mail_call(path, method='PATCH', payload={'is_read': bool(is_read)})
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '更新邮件状态失败'), 'upstream': data}), status
    _mail_cache_invalidate_user(binding['user_id'])

    return jsonify({
        'success': True,
        'id': str(mail_id),
        'is_read': bool(data.get('is_read', is_read)),
        'mail': data.get('mail', {})
    })


@app.route('/api/mail/me/inbox/<mail_id>', methods=['DELETE'])
@require_login
def mail_me_delete(mail_id):
    """当前用户删除单封邮件"""
    binding, err = _resolve_current_user_mail_binding()
    if err:
        return jsonify({'success': False, 'message': err[0]}), err[1]

    path = f"/api/mailboxes/{urllib_parse.quote(binding['group'])}/{urllib_parse.quote(binding['mail_username'])}/mails/{urllib_parse.quote(str(mail_id))}"
    ok, status, data = _nexora_mail_call(path, method='DELETE')
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '删除邮件失败'), 'upstream': data}), status
    _mail_cache_invalidate_user(binding['user_id'])
    return jsonify({'success': True, 'id': mail_id})


@app.route('/api/mail/me/sent/<mail_id>', methods=['DELETE'])
@require_login
def mail_me_sent_delete(mail_id):
    """当前用户删除单封发件"""
    binding, err = _resolve_current_user_mail_binding()
    if err:
        return jsonify({'success': False, 'message': err[0]}), err[1]

    path = f"/api/mailboxes/{urllib_parse.quote(binding['group'])}/{urllib_parse.quote(binding['mail_username'])}/sent/{urllib_parse.quote(str(mail_id))}"
    ok, status, data = _nexora_mail_call(path, method='DELETE')
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '删除发件失败'), 'upstream': data}), status
    _mail_cache_invalidate_user(binding['user_id'])
    return jsonify({'success': True, 'id': mail_id})


@app.route('/api/mail/me/send', methods=['POST'])
@require_login
def mail_me_send():
    """当前用户发送邮件"""
    binding, err = _resolve_current_user_mail_binding()
    if err:
        return jsonify({'success': False, 'message': err[0]}), err[1]

    payload = request.get_json() or {}
    recipient = (payload.get('recipient') or payload.get('to') or '').strip()
    subject = (payload.get('subject') or '').strip() or '(No Subject)'
    subject = _decode_literal_unicode_escapes(subject)
    subject = _repair_common_mojibake(subject)
    content = payload.get('content')
    is_html = bool(payload.get('is_html', False))

    if not recipient:
        return jsonify({'success': False, 'message': '收件人不能为空'}), 400
    if content is None:
        content = ''
    content = _decode_literal_unicode_escapes(str(content))
    if not content.strip():
        return jsonify({'success': False, 'message': '邮件内容不能为空'}), 400

    cfg = _get_nexora_mail_config()
    fallback_domain = str(cfg.get('host') or 'localhost').strip() or 'localhost'
    sender = _build_mail_sender_address(binding['mail_username'], binding['group'], fallback_domain)
    if not sender:
        return jsonify({'success': False, 'message': '发件地址生成失败'}), 500

    send_body = {
        'group': binding['group'],
        'sender': sender,
        'recipient': recipient,
        'subject': subject,
        'raw': _build_utf8_raw_mail(
            sender=sender,
            recipient=recipient,
            subject=subject,
            content=content,
            is_html=is_html
        )
    }

    ok, status, data = _nexora_mail_call(
        '/api/send',
        method='POST',
        payload=send_body,
        timeout=cfg.get('send_timeout', cfg.get('timeout', 10))
    )
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '发送失败'), 'upstream': data}), status
    _mail_cache_invalidate_user(binding['user_id'])

    return jsonify({
        'success': True,
        'group': binding['group'],
        'mail_username': binding['mail_username'],
        'sender': sender,
        'recipient': recipient
    })


@app.route('/api/user/avatar/<user_id>', methods=['GET'])
@require_login
def get_user_avatar(user_id):
    """读取头像（仅本人或管理员）"""
    if session.get('username') != user_id and session.get('role') != 'admin':
        return jsonify({'success': False, 'message': '无权限'}), 403
    avatar_file = get_user_avatar_file(user_id)
    if not os.path.exists(avatar_file):
        return jsonify({'success': False, 'message': '头像不存在'}), 404
    return send_file(avatar_file, mimetype='image/png')


def get_user_stats(username, user_path):
    """获取用户统计信息"""
    stats = {
        'total_conversations': 0,
        'total_tokens': 0,
        'total_knowledge': 0,
        'model_usage': {}
    }
    
    try:
        # 计算对话数量
        conversations_path = os.path.join(user_path, 'conversations')
        if os.path.exists(conversations_path):
            conversation_files = [f for f in os.listdir(conversations_path) if f.endswith('.json')]
            stats['total_conversations'] = len(conversation_files)
        
        # 计算知识点数量
        knowledge_path = os.path.join(user_path, 'database')
        if os.path.exists(knowledge_path):
            knowledge_files = [f for f in os.listdir(knowledge_path) if f.endswith('.json')]
            stats['total_knowledge'] = len(knowledge_files)
        
        # 从token_usage.json获取统计信息
        token_usage_path = os.path.join(user_path, 'token_usage.json')
        if os.path.exists(token_usage_path):
            with open(token_usage_path, 'r', encoding='utf-8') as f:
                token_records = json.load(f)
                
            total_tokens = 0
            model_usage = {}
            
            for record in token_records:
                total_tokens += record.get('total_tokens', 0)
                
                # 统计模型使用情况（这里简化处理，实际可能需要从对话记录中提取）
                # 暂时用action字段作为模型标识
                action = record.get('action', 'unknown')
                if action not in model_usage:
                    model_usage[action] = 0
                model_usage[action] += 1
            
            stats['total_tokens'] = total_tokens
            stats['model_usage'] = model_usage
            
    except Exception as e:
        print(f"Error getting user stats for {username}: {e}")
    
    return stats


STATUS_PROVIDER_ICON_MAP = {
    'github': '',
    'alibabacloud': '/static/img/Index/static/icons/aliyun.png',
    'aliyun': '/static/img/icons/tongyi_single_icon.png',
    'bytedance': '/static/img/icons/volcengine_single_icon.svg',
    'volcengine': '/static/img/icons/volcengine_single_icon.svg',
    'qq': '/static/img/icons/tencent_cloud_single_icon.svg',
    'wechat': '/static/img/icons/tencent_cloud_single_icon.svg',
    'tencent': '/static/img/icons/tencent_cloud_single_icon.svg',
    'deepseek': '/static/img/icons/deepseek_single_icon.svg',
    'openai': '/static/img/icons/openai_single_icon.svg',
    'stepfun': '/static/img/icons/stepfun_single_icon.png',
    'moonshot': '/static/img/icons/kimi_single_icon.png',
    'kimi': '/static/img/icons/kimi_single_icon.png',
    'minimax': '/static/img/icons/minimax_single_icon.png',
    'siliconflow': '/static/img/icons/siliconflow_single_icon.svg',
    'openrouter': '/static/img/icons/openrouter_single_icon.svg',
    'xunfei': '/static/img/icons/xunfei_spark_single_icon.svg',
    'spark': '/static/img/icons/xunfei_spark_single_icon.svg',
    'hunyuan': '/static/img/icons/hunyuan_single_icon.png',
    'ollama': '/static/img/icons/ollama_single_icon.svg',
    'nvidia': '/static/img/icons/nvidia.svg',
    'zhipu': '/static/img/icons/zhipu_single_icon.svg',
    'zhipuai': '/static/img/icons/zhipu_single_icon.svg',
    'zai': '/static/img/icons/zhipu_single_icon.svg',
    'bigmodel': '/static/img/icons/zhipu_single_icon.svg'
}


def _status_provider_icon(provider: str) -> str:
    p = str(provider or '').strip().lower()
    return STATUS_PROVIDER_ICON_MAP.get(p, '')


def _safe_int_status(value: Any, default: int = 0) -> int:
    try:
        return int(value or 0)
    except Exception:
        return int(default or 0)


def _read_json_list_safe(path: str) -> List[Dict[str, Any]]:
    if not os.path.exists(path):
        return []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


_STATUS_OPENROUTER_MODEL_CACHE: Dict[str, Any] = {
    'mtime': None,
    'alias_to_canonical': {},
    'canonical_meta': {}
}
_STATUS_PROVIDER_ALIAS_MAP = {
    'bytedance-seed': 'volcengine',
    'byte': 'volcengine',
    'siliconflow': 'siliconflow',
    'azure': 'openai',
    'zhipuai': 'zhipu',
    'zai': 'zhipu',
    'bigmodel': 'zhipu'
}


def _status_normalize_provider(provider: str) -> str:
    p = str(provider or '').strip().lower()
    if not p:
        return 'unknown'
    return _STATUS_PROVIDER_ALIAS_MAP.get(p, p)


def _status_extract_model_leaf(raw_model: str) -> str:
    src = str(raw_model or '').strip()
    if not src:
        return ''
    out = src.split('?', 1)[0].strip()
    if '/' in out and not out.startswith('http'):
        out = out.split('/', 1)[1].strip()
    if ':' in out:
        head, tail = out.rsplit(':', 1)
        if str(tail or '').strip().lower() in {'free', 'beta', 'alpha', 'preview', 'latest'}:
            out = head.strip()
    return out.strip()


def _status_normalize_model_key(raw_model: str) -> str:
    leaf = _status_extract_model_leaf(raw_model)
    s = str(leaf or '').strip().lower()
    if not s:
        return 'unknown'
    s = s.replace('（', '(').replace('）', ')')
    s = re.sub(r'[\[\]{}()]+', '-', s)
    s = re.sub(r'[_.\s/]+', '-', s)
    # qwen3.5 / gpt5 这类前缀+版本号，补齐分隔符；保留 v3.2 这种写法。
    s = re.sub(r'^(qwen|gpt|gemini|claude|mistral|deepseek|kimi|glm|step|doubao)(?=\d)', r'\1-', s)
    # 去掉常见日期后缀，例如 -251201 / -20251201。
    s = re.sub(r'-(?:\d{6}|\d{8})$', '', s)
    s = re.sub(r'-+', '-', s).strip('-')
    if s.startswith('bytedance-seed-'):
        s = f"doubao-seed-{s[len('bytedance-seed-'):]}"
    elif s.startswith('seed-'):
        s = f"doubao-seed-{s[len('seed-'):]}"
    return s or 'unknown'


def _status_release_stem(key: str) -> str:
    s = str(key or '').strip().lower()
    if not s:
        return ''
    patterns = [
        r'-(?:\d{4}-\d{2}-\d{2})$',
        r'-(?:\d{2}-\d{2})$',
        r'-(?:\d{8}|\d{6})$',
        r'-(?:\d{4}|\d{3})$',
        r'-(?:preview|beta|alpha|latest)$'
    ]
    while True:
        changed = False
        for pat in patterns:
            nxt = re.sub(pat, '', s, flags=re.IGNORECASE).strip('-')
            if nxt and nxt != s:
                s = nxt
                changed = True
                break
        if not changed:
            break
    return s


def _status_strip_release_suffix_for_display(name: str) -> str:
    s = str(name or '').strip()
    if not s:
        return ''
    patterns = [
        r'[-_.](?:\d{4}[-_.]\d{2}[-_.]\d{2})$',
        r'[-_.](?:\d{2}[-_.]\d{2})$',
        r'[-_.](?:\d{8}|\d{6})$',
        r'[-_.](?:\d{4}|\d{3})$',
        r'[-_.](?:preview|beta|alpha|latest)$'
    ]
    while True:
        changed = False
        for pat in patterns:
            nxt = re.sub(pat, '', s, flags=re.IGNORECASE).strip('-_.')
            if nxt and nxt != s:
                s = nxt
                changed = True
                break
        if not changed:
            break
    return s or str(name or '').strip()


def _load_status_openrouter_model_index() -> Tuple[Dict[str, str], Dict[str, Dict[str, str]]]:
    path = OPENROUTER_MODELS_SNAPSHOT_PATH
    try:
        mtime = os.path.getmtime(path)
    except Exception:
        mtime = None
    if _STATUS_OPENROUTER_MODEL_CACHE.get('mtime') == mtime:
        alias_to_canonical = _STATUS_OPENROUTER_MODEL_CACHE.get('alias_to_canonical') or {}
        canonical_meta = _STATUS_OPENROUTER_MODEL_CACHE.get('canonical_meta') or {}
        if isinstance(alias_to_canonical, dict) and isinstance(canonical_meta, dict):
            return alias_to_canonical, canonical_meta

    alias_to_canonical: Dict[str, str] = {}
    canonical_meta: Dict[str, Dict[str, str]] = {}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            payload = json.load(f)
        rows = payload.get('data', []) if isinstance(payload, dict) else []
        if isinstance(rows, list):
            for item in rows:
                if not isinstance(item, dict):
                    continue
                model_id = str(item.get('id') or '').strip()
                if not model_id:
                    continue
                leaf = _status_extract_model_leaf(model_id)
                if not leaf:
                    continue
                normalized = _status_normalize_model_key(leaf)
                if normalized == 'unknown':
                    continue
                canonical = _status_release_stem(normalized) or normalized
                vendor = ''
                if '/' in model_id:
                    vendor = str(model_id.split('/', 1)[0] or '').strip().lower()
                display = _status_strip_release_suffix_for_display(leaf)
                if not display:
                    display = leaf

                prev_meta = canonical_meta.get(canonical)
                if not prev_meta:
                    canonical_meta[canonical] = {
                        'display': display,
                        'vendor': vendor
                    }
                else:
                    prev_display = str(prev_meta.get('display') or '').strip()
                    if (not prev_display) or (len(display) < len(prev_display)):
                        prev_meta['display'] = display
                    if not prev_meta.get('vendor') and vendor:
                        prev_meta['vendor'] = vendor

                alias_to_canonical[normalized] = canonical
                alias_to_canonical[canonical] = canonical
    except Exception:
        alias_to_canonical = {}
        canonical_meta = {}

    _STATUS_OPENROUTER_MODEL_CACHE['mtime'] = mtime
    _STATUS_OPENROUTER_MODEL_CACHE['alias_to_canonical'] = alias_to_canonical
    _STATUS_OPENROUTER_MODEL_CACHE['canonical_meta'] = canonical_meta
    return alias_to_canonical, canonical_meta


def _status_canonicalize_model(raw_model: str) -> Tuple[str, str]:
    normalized = _status_normalize_model_key(raw_model)
    if normalized == 'unknown':
        return 'unknown', 'unknown'
    alias_to_canonical, canonical_meta = _load_status_openrouter_model_index()
    canonical = alias_to_canonical.get(normalized, '')
    if not canonical:
        stem = _status_release_stem(normalized)
        canonical = alias_to_canonical.get(stem, stem or normalized)
    meta = canonical_meta.get(canonical, {})
    display = str(meta.get('display') or '').strip() or canonical
    if canonical.startswith('doubao-seed-') and display.startswith('seed-'):
        display = f"doubao-{display}"
    return canonical, display


def _status_icon_provider_for_model(model_name: str, fallback_provider: str = 'unknown') -> str:
    key = str(model_name or '').strip().lower()
    if not key or key == 'unknown':
        return _status_normalize_provider(fallback_provider)
    if key.startswith('glm') or key.startswith('chatglm'):
        return 'zhipu'
    if key.startswith('gpt') or key.startswith('chatgpt') or key.startswith('o1') or key.startswith('o3') or key.startswith('o4'):
        return 'openai'
    if key.startswith('deepseek'):
        return 'deepseek'
    if key.startswith('doubao-seed') or key.startswith('seed'):
        return 'volcengine'
    if key.startswith('qwen'):
        return 'aliyun'
    if key.startswith('kimi') or key.startswith('moonshot'):
        return 'kimi'
    if key.startswith('step'):
        return 'stepfun'
    return _status_normalize_provider(fallback_provider)


def _status_add_provider_count(row: Dict[str, Any], provider: str, weight: int = 1) -> None:
    if not isinstance(row, dict):
        return
    p = _status_normalize_provider(provider)
    if not p or p == 'unknown':
        return
    counts = row.setdefault('_providerCounts', {})
    if not isinstance(counts, dict):
        counts = {}
        row['_providerCounts'] = counts
    counts[p] = _safe_int_status(counts.get(p, 0)) + max(1, _safe_int_status(weight, 1))


def _ensure_status_model_row(model_map: Dict[str, Dict[str, Any]], model_name: str, display_name: str = '') -> Dict[str, Any]:
    key = str(model_name or 'unknown').strip() or 'unknown'
    if key not in model_map:
        model_map[key] = {
            'id': key,
            'name': str(display_name or key).strip() or key,
            'provider': 'unknown',
            'icon': '',
            'score': 0,
            'totalTokens': 0,
            'callCount': 0,
            'toolCalls': 0,
            'successRate': 100.0,
            'failureCount': 0,
            '_providerCounts': {},
            'complexityLoad': {
                'simple': 0,
                'medium': 0,
                'complex': 0
            }
        }
    elif display_name:
        prev = str(model_map[key].get('name') or '').strip()
        if not prev or prev == key:
            model_map[key]['name'] = str(display_name).strip() or key
    return model_map[key]


def _tool_call_count_from_steps(steps: Any) -> int:
    arr = steps if isinstance(steps, list) else []
    return sum(1 for step in arr if isinstance(step, dict) and str(step.get('type') or '') == 'function_call')


def _status_parse_timestamp(raw: Any) -> Optional[datetime]:
    text = str(raw or '').strip()
    if not text:
        return None
    # token_usage.json may use "YYYY-mm-dd HH:MM:SS" or ISO strings.
    formats = [
        '%Y-%m-%d %H:%M:%S',
        '%Y-%m-%d %H:%M:%S.%f',
        '%Y-%m-%d %H:%M',
        '%Y-%m-%dT%H:%M:%S',
        '%Y-%m-%dT%H:%M:%S.%f'
    ]
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt)
        except Exception:
            continue
    try:
        iso_text = text[:-1] + '+00:00' if text.endswith('Z') else text
        dt = datetime.fromisoformat(iso_text)
        if dt.tzinfo is not None:
            dt = dt.astimezone().replace(tzinfo=None)
        return dt
    except Exception:
        return None


def _ensure_status_recent_row(recent_map: Dict[str, Dict[str, Any]], model_name: str, display_name: str = '') -> Dict[str, Any]:
    key = str(model_name or 'unknown').strip() or 'unknown'
    if key not in recent_map:
        recent_map[key] = {
            'id': key,
            'name': str(display_name or key).strip() or key,
            'provider': 'unknown',
            'icon': '',
            'score': 0,
            'recentCalls': 0,
            'recentTokens': 0,
            '_providerCounts': {}
        }
    elif display_name:
        prev = str(recent_map[key].get('name') or '').strip()
        if not prev or prev == key:
            recent_map[key]['name'] = str(display_name).strip() or key
    return recent_map[key]


def build_status_overview() -> Dict[str, Any]:
    users_root = os.path.join(os.path.dirname(__file__), 'data', 'users')
    model_map: Dict[str, Dict[str, Any]] = {}
    recent_24h_map: Dict[str, Dict[str, Any]] = {}
    tool_failure_map: Dict[str, Dict[str, Any]] = {}
    complexity = {'simple': 0, 'medium': 0, 'complex': 0}
    total_tokens = 0
    total_tool_calls = 0
    total_tool_failures = 0
    cutoff_24h = datetime.now() - timedelta(hours=24)

    if not os.path.exists(users_root):
        return {
            'snapshotAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S CST'),
            'source': 'ChatDBServer/data/users/*/{token_usage,tool_usage,conversations}',
            'totals': {'tokens': 0, 'modelCalls': 0, 'toolCalls': 0, 'toolFailures': 0},
            'complexity': complexity,
            'models': [],
            'toolFailures': [],
            'recent24h': [],
            'recent24hWindowHours': 24
        }

    for username in os.listdir(users_root):
        user_path = os.path.join(users_root, username)
        if not os.path.isdir(user_path):
            continue

        token_logs = _read_json_list_safe(os.path.join(user_path, 'token_usage.json'))
        deduped_token_logs: Dict[str, Dict[str, Any]] = {}
        for log in token_logs:
            if not isinstance(log, dict):
                continue
            conversation_id = str(log.get('conversation_id') or '').strip()
            timestamp = str(log.get('timestamp') or '').strip()
            action = str(log.get('action') or 'chat').strip() or 'chat'
            provider = str(log.get('provider') or 'unknown').strip() or 'unknown'
            model = str(log.get('model') or 'unknown').strip() or 'unknown'
            key = '|'.join([str(username), conversation_id, timestamp, action, provider, model])
            total = log.get('total_tokens', None)
            if total is None:
                total = _safe_int_status(log.get('input_tokens', 0)) + _safe_int_status(log.get('output_tokens', 0))
            total = _safe_int_status(total)
            ts_dt = _status_parse_timestamp(timestamp)
            prev = deduped_token_logs.get(key)
            if prev is None or total >= _safe_int_status(prev.get('total_tokens', 0)):
                deduped_token_logs[key] = {
                    'provider': provider,
                    'model': model,
                    'total_tokens': total,
                    'timestamp_dt': ts_dt
                }

        for item in deduped_token_logs.values():
            total = _safe_int_status(item.get('total_tokens', 0))
            total_tokens += total
            model_raw = str(item.get('model') or 'unknown').strip() or 'unknown'
            provider = _status_normalize_provider(str(item.get('provider') or 'unknown').strip() or 'unknown')
            model_name, display_name = _status_canonicalize_model(model_raw)
            row = _ensure_status_model_row(model_map, model_name, display_name)
            row['totalTokens'] += total
            _status_add_provider_count(row, provider)
            ts_dt = item.get('timestamp_dt')
            if isinstance(ts_dt, datetime) and ts_dt >= cutoff_24h:
                recent = _ensure_status_recent_row(recent_24h_map, model_name, display_name)
                recent['recentCalls'] += 1
                recent['recentTokens'] += total
                _status_add_provider_count(recent, provider)

        tool_logs = _read_json_list_safe(os.path.join(user_path, 'tool_usage.json'))
        for log in tool_logs:
            if not isinstance(log, dict):
                continue
            total_tool_calls += 1
            success = bool(log.get('success', True))
            if not success:
                total_tool_failures += 1
            tool_name = str(log.get('tool_name') or 'unknown').strip() or 'unknown'
            provider = _status_normalize_provider(str(log.get('provider') or 'unknown').strip() or 'unknown')
            model_raw = str(log.get('model') or 'unknown').strip() or 'unknown'
            model_name, display_name = _status_canonicalize_model(model_raw)
            row = _ensure_status_model_row(model_map, model_name, display_name)
            row['toolCalls'] += 1
            if not success:
                row['failureCount'] += 1
            _status_add_provider_count(row, provider)

            fail_row = tool_failure_map.setdefault(tool_name, {
                'name': tool_name,
                'count': 0,
                'note': ''
            })
            if not success:
                fail_row['count'] += 1
                err_text = str(log.get('error_message') or '').strip()
                if err_text:
                    fail_row['note'] = err_text[:120]

        conv_dir = os.path.join(user_path, 'conversations')
        if os.path.exists(conv_dir):
            for filename in os.listdir(conv_dir):
                if not filename.endswith('.json'):
                    continue
                conv_path = os.path.join(conv_dir, filename)
                try:
                    with open(conv_path, 'r', encoding='utf-8') as f:
                        convo = json.load(f)
                except Exception:
                    continue
                messages = convo.get('messages', []) if isinstance(convo, dict) else []
                if not isinstance(messages, list):
                    continue
                for msg in messages:
                    if not isinstance(msg, dict) or str(msg.get('role') or '') != 'assistant':
                        continue
                    md = msg.get('metadata', {}) if isinstance(msg.get('metadata'), dict) else {}
                    model_raw = str(md.get('model_name') or msg.get('model_name') or '').strip() or 'unknown'
                    model_name, display_name = _status_canonicalize_model(model_raw)
                    row = _ensure_status_model_row(model_map, model_name, display_name)
                    row['callCount'] += 1
                    provider = _status_normalize_provider(str(md.get('provider') or msg.get('provider') or '').strip() or 'unknown')
                    _status_add_provider_count(row, provider)
                    tool_call_count = _tool_call_count_from_steps(md.get('process_steps', []))
                    if tool_call_count <= 2:
                        bucket = 'simple'
                    elif tool_call_count <= 7:
                        bucket = 'medium'
                    else:
                        bucket = 'complex'
                    row['complexityLoad'][bucket] += 1
                    complexity[bucket] += 1

    for _, row in model_map.items():
        counts = row.get('_providerCounts', {}) if isinstance(row.get('_providerCounts'), dict) else {}
        known = [(name, _safe_int_status(v, 0)) for name, v in counts.items() if str(name or '') and str(name) != 'unknown']
        known = [item for item in known if item[1] > 0]
        if len(known) >= 2:
            provider = 'multi'
        elif len(known) == 1:
            provider = known[0][0]
        else:
            provider = str(row.get('provider') or 'unknown').strip() or 'unknown'
        row['provider'] = provider
        icon_provider = _status_icon_provider_for_model(str(row.get('id') or ''), provider)
        row['icon'] = _status_provider_icon(icon_provider)
        row.pop('_providerCounts', None)
        tool_calls = _safe_int_status(row.get('toolCalls', 0))
        failures = _safe_int_status(row.get('failureCount', 0))
        if tool_calls > 0:
            row['successRate'] = round(max(0.0, (tool_calls - failures) / tool_calls * 100.0), 1)
        else:
            row['successRate'] = 100.0

    for _, row in recent_24h_map.items():
        counts = row.get('_providerCounts', {}) if isinstance(row.get('_providerCounts'), dict) else {}
        known = [(name, _safe_int_status(v, 0)) for name, v in counts.items() if str(name or '') and str(name) != 'unknown']
        known = [item for item in known if item[1] > 0]
        if len(known) >= 2:
            provider = 'multi'
        elif len(known) == 1:
            provider = known[0][0]
        else:
            provider = str(row.get('provider') or 'unknown').strip() or 'unknown'
        row['provider'] = provider
        icon_provider = _status_icon_provider_for_model(str(row.get('id') or ''), provider)
        row['icon'] = _status_provider_icon(icon_provider)
        row.pop('_providerCounts', None)

    max_calls = max((_safe_int_status(item.get('callCount', 0)) for item in model_map.values()), default=0)
    max_tokens = max((_safe_int_status(item.get('totalTokens', 0)) for item in model_map.values()), default=0)
    max_tools = max((_safe_int_status(item.get('toolCalls', 0)) for item in model_map.values()), default=0)
    max_recent_calls = max((_safe_int_status(item.get('recentCalls', 0)) for item in recent_24h_map.values()), default=0)
    max_recent_tokens = max((_safe_int_status(item.get('recentTokens', 0)) for item in recent_24h_map.values()), default=0)

    for row in model_map.values():
        call_factor = (_safe_int_status(row.get('callCount', 0)) / max_calls * 22.0) if max_calls else 0.0
        token_factor = (_safe_int_status(row.get('totalTokens', 0)) / max_tokens * 10.0) if max_tokens else 0.0
        tool_factor = (_safe_int_status(row.get('toolCalls', 0)) / max_tools * 8.0) if max_tools else 0.0
        score = round(min(100.0, row['successRate'] * 0.6 + call_factor + token_factor + tool_factor))
        if str(row.get('id') or '') == 'unknown':
            score = 0
        row['score'] = int(score)

    for row in recent_24h_map.values():
        call_factor = (_safe_int_status(row.get('recentCalls', 0)) / max_recent_calls * 45.0) if max_recent_calls else 0.0
        token_factor = (_safe_int_status(row.get('recentTokens', 0)) / max_recent_tokens * 55.0) if max_recent_tokens else 0.0
        score = round(min(100.0, call_factor + token_factor))
        if str(row.get('id') or '') == 'unknown':
            score = 0
        row['score'] = int(score)

    models = sorted(
        model_map.values(),
        key=lambda item: (
            _safe_int_status(item.get('score', 0)),
            _safe_int_status(item.get('callCount', 0)),
            _safe_int_status(item.get('totalTokens', 0))
        ),
        reverse=True
    )
    recent_24h = sorted(
        recent_24h_map.values(),
        key=lambda item: (
            _safe_int_status(item.get('score', 0)),
            _safe_int_status(item.get('recentTokens', 0)),
            _safe_int_status(item.get('recentCalls', 0))
        ),
        reverse=True
    )[:12]

    tool_failures = sorted(
        [item for item in tool_failure_map.values() if _safe_int_status(item.get('count', 0)) > 0],
        key=lambda item: _safe_int_status(item.get('count', 0)),
        reverse=True
    )[:8]

    total_model_calls = sum(_safe_int_status(item.get('callCount', 0)) for item in models)
    return {
        'snapshotAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S CST'),
        'source': 'ChatDBServer/data/users/*/{token_usage,tool_usage,conversations}',
        'totals': {
            'tokens': total_tokens,
            'modelCalls': total_model_calls,
            'toolCalls': total_tool_calls,
            'toolFailures': total_tool_failures
        },
        'complexity': complexity,
        'models': models[:12],
        'toolFailures': tool_failures,
        'recent24h': recent_24h,
        'recent24hWindowHours': 24
    }


@app.route('/api/status/overview', methods=['GET'])
def status_overview_api():
    try:
        return jsonify({'success': True, 'status': build_status_overview()})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/user/stats', methods=['GET'])
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


@app.route('/api/user/preferences', methods=['GET'])
def get_user_preferences():
    """获取当前用户的偏好设置"""
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401
    
    try:
        # 暂时返回默认偏好设置，后续可以从用户配置文件读取
        preferences = {
            'default_model': 'auto',  # 默认模型
            'theme': 'dark',  # 主题
            'streaming': True,  # 是否流式输出
            'language': 'zh'  # 语言
        }
        
        # 尝试从用户配置文件读取偏好设置
        user_path = f'./data/users/{username}/'
        prefs_file = os.path.join(user_path, 'preferences.json')
        if os.path.exists(prefs_file):
            with open(prefs_file, 'r', encoding='utf-8') as f:
                user_prefs = json.load(f)
                preferences.update(user_prefs)
        
        return jsonify({
            'success': True,
            'preferences': preferences
        })
    except Exception as e:
        print(f"Error getting user preferences: {e}")
        return jsonify({'success': False, 'message': '获取偏好设置失败'}), 500


# ==================== 管理后台 API ====================

@app.route('/api/admin/users', methods=['GET'])
@require_admin
def admin_get_users():
    """获取所有用户信息"""
    try:
        users = load_users()
        
        user_list = []
        for user_id, info in users.items():
            # 计算总 token 消耗 (从 token_usage.json 读取)
            total_tokens = 0
            user_token_file = os.path.join(os.path.dirname(__file__), f"data/users/{user_id}/token_usage.json")
            if os.path.exists(user_token_file):
                try:
                    with open(user_token_file, 'r', encoding='utf-8') as tf:
                        tokens = json.load(tf)
                        for log in tokens:
                            t = log.get('total_tokens', None)
                            if t is None:
                                t = log.get('input_tokens', 0) + log.get('output_tokens', 0)
                            total_tokens += int(t or 0)
                except:
                    pass
            
            user_list.append({
                'user_id': user_id,
                'username': info.get('display_name', user_id),
                'password': info.get('password'), # 管理员可见密码，符合用户要求
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


@app.route('/api/admin/user/add', methods=['POST'])
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
        
    try:
        users = load_users()
            
        if username in users:
            return jsonify({'success': False, 'message': '用户已存在'})
            
        # 初始化用户目录
        user_path = f"./data/users/{username}/"
        os.makedirs(user_path, exist_ok=True)
        os.makedirs(os.path.join(user_path, "database"), exist_ok=True)
        os.makedirs(os.path.join(user_path, "conversations"), exist_ok=True)
        
        # 初始化 database.json
        db_file = os.path.join(user_path, "database.json")
        if not os.path.exists(db_file):
            with open(db_file, 'w', encoding='utf-8') as f:
                json.dump({"data_short": {}, "data_basis": {}}, f, indent=4, ensure_ascii=False)
        
        # 初始化知识图谱和Token统计文件（防止前端报错）
        kg_file = os.path.join(user_path, "knowledge_graph.json")
        if not os.path.exists(kg_file):
            with open(kg_file, 'w', encoding='utf-8') as f:
                json.dump({"nodes": [], "links": []}, f, indent=4, ensure_ascii=False)
        
        token_file = os.path.join(user_path, "token_usage.json")
        if not os.path.exists(token_file):
            with open(token_file, 'w', encoding='utf-8') as f:
                json.dump([], f, indent=4, ensure_ascii=False)
        
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


@app.route('/api/admin/user/delete', methods=['POST'])
@require_admin
def admin_delete_user():
    """删除用户"""
    data = request.get_json()
    username = data.get('target_user_id') or data.get('target_username')
    
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


@app.route('/api/admin/user/role', methods=['POST'])
@require_admin
def admin_set_role():
    """修改用户权限"""
    data = request.get_json()
    username = data.get('user_id') or data.get('username') or data.get('target_username')
    new_role = data.get('role') # 'admin' or 'member'
    
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

@app.route('/api/admin/user/password', methods=['POST'])
@require_admin
def admin_set_password():
    """修改用户密码"""
    data = request.get_json()
    username = data.get('target_user_id') or data.get('target_username')
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


@app.route('/api/admin/nexora-mail/status', methods=['GET'])
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


@app.route('/api/admin/nexora-mail/groups', methods=['GET'])
@require_admin
def admin_nexora_mail_groups():
    """读取 NexoraMail 用户组列表"""
    ok, status, data = _nexora_mail_call('/api/groups', method='GET')
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '读取组列表失败'), 'upstream': data}), status
    return jsonify({'success': True, 'groups': data.get('groups', [])})


@app.route('/api/admin/nexora-mail/users', methods=['GET'])
@require_admin
def admin_nexora_mail_users():
    """读取 NexoraMail 用户列表"""
    cfg = _get_nexora_mail_config()
    group = (request.args.get('group') or cfg.get('default_group') or 'default').strip() or 'default'
    ok, status, data = _nexora_mail_call('/api/users', method='GET', query={'group': group})
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '读取邮箱用户失败'), 'upstream': data}), status
    return jsonify({
        'success': True,
        'group': data.get('group', group),
        'users': data.get('users', [])
    })


@app.route('/api/admin/nexora-mail/users', methods=['POST'])
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


@app.route('/api/admin/nexora-mail/bind', methods=['POST'])
@require_admin
def admin_nexora_mail_bind():
    """将 Nexora 用户绑定到指定本地邮箱账号"""
    payload = request.get_json() or {}
    user_id = (payload.get('user_id') or payload.get('target_user_id') or '').strip()
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


@app.route('/api/admin/nexora-mail/unbind', methods=['POST'])
@require_admin
def admin_nexora_mail_unbind():
    """解绑 Nexora 用户的本地邮箱"""
    payload = request.get_json() or {}
    user_id = (payload.get('user_id') or payload.get('target_user_id') or '').strip()
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


@app.route('/api/admin/nexora-mail/users/password', methods=['POST'])
@require_admin
def admin_nexora_mail_set_password():
    """重置 NexoraMail 用户密码"""
    payload = request.get_json() or {}
    cfg = _get_nexora_mail_config()
    group = (payload.get('group') or cfg.get('default_group') or 'default').strip() or 'default'
    mail_username = (payload.get('mail_username') or payload.get('username') or '').strip()
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


@app.route('/api/admin/nexora-mail/users/delete', methods=['POST'])
@require_admin
def admin_nexora_mail_delete_user():
    """删除 NexoraMail 用户"""
    payload = request.get_json() or {}
    cfg = _get_nexora_mail_config()
    group = (payload.get('group') or cfg.get('default_group') or 'default').strip() or 'default'
    mail_username = (payload.get('mail_username') or payload.get('username') or '').strip()
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


@app.route('/api/admin/tokens/stats', methods=['GET'])
@require_admin
def admin_token_stats():
    """获取所有用户的总 token 消耗"""
    try:
        total_tokens = 0
        user_dir = os.path.join(os.path.dirname(__file__), "data/users")
        for username in os.listdir(user_dir):
            token_file = os.path.join(user_dir, username, "token_usage.json")
            if os.path.exists(token_file):
                try:
                    with open(token_file, 'r', encoding='utf-8') as f:
                        logs = json.load(f)
                        for log in logs:
                            t = log.get('total_tokens', None)
                            if t is None:
                                t = log.get('input_tokens', 0) + log.get('output_tokens', 0)
                            total_tokens += int(t or 0)
                except:
                    pass
        return jsonify({'success': True, 'total': total_tokens})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/chroma/stats', methods=['GET'])
@require_admin
def admin_chroma_stats():
    """ChromaDB stats for admin UI"""
    config = get_config_all()
    rag = config.get('rag_database', {})
    if not rag.get('rag_database_enabled', False):
        return jsonify({'success': True, 'enabled': False, 'message': 'disabled'})

    store, store_err = get_chroma_store()
    if not store:
        return jsonify({'success': True, 'enabled': False, 'message': store_err})

    try:
        stats = store.stats()
        return jsonify({
            'success': True,
            'enabled': True,
            'mode': rag.get('mode'),
            'service_url': rag.get('service_url'),
            'collections': stats.get('collections', []),
            'total_vectors': stats.get('total_vectors', 0)
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


# ==================== 通用开放接口 (Public API - papi) ====================

@app.route('/api/papi/knowledge/list/<username>', methods=['GET'])
@require_papi_key
def papi_list_knowledge(username):
    """获取指定用户的知识库列表"""
    try:
        user = User(username)
        basis = user.getKnowledgeList(1)
        return jsonify({
            'success': True,
            'username': username,
            'knowledge': list(basis.keys())
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/papi/knowledge/basis/<username>/<path:title>', methods=['GET'])
@require_papi_key
def papi_get_knowledge(username, title):
    """获取指定用户的某个知识内容"""
    try:
        user = User(username)
        content = user.getBasisContent(title)
        meta = user.getBasisMetadata(title)
        return jsonify({
            'success': True,
            'username': username,
            'title': title,
            'content': content,
            'metadata': meta
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/papi/tokens/stats/<username>', methods=['GET'])
@require_papi_key
def papi_token_stats(username):
    """获取指定用户的 Token 消耗记录"""
    try:
        user = User(username)
        logs = user.get_token_logs()
        total_tokens = sum(log.get('total_tokens', 0) for log in logs)
        return jsonify({
            'success': True,
            'username': username,
            'total': total_tokens,
            'logs': logs
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/papi/conversations/<username>', methods=['GET'])
@require_papi_key
def papi_list_conversations(username):
    """获取指定用户的对话列表"""
    try:
        manager = ConversationManager(username)
        conversations = manager.list_conversations()
        return jsonify({
            'success': True,
            'username': username,
            'conversations': conversations
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/papi/conversations/<username>/<conv_id>', methods=['GET'])
@require_papi_key
def papi_get_conversation(username, conv_id):
    """获取指定用户的详细对话记录"""
    try:
        manager = ConversationManager(username)
        conversation = manager.get_conversation(conv_id)
        return jsonify({
            'success': True,
            'username': username,
            'conversation': conversation
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/papi/knowledge/query/<username>', methods=['POST'])
@require_papi_key
def papi_query_vectors(username):
    """PAPI: vector query"""
    data = request.get_json() or {}
    query_text = data.get('text') or data.get('query')
    top_k = int(data.get('top_k') or 5)

    if not query_text:
        return jsonify({'success': False, 'message': 'missing query text'})

    store, store_err = get_chroma_store()
    if not store:
        return jsonify({'success': False, 'message': f'ChromaDB unavailable: {store_err}'})

    try:
        if getattr(store, 'mode', '') != 'service':
            return jsonify({'success': False, 'message': 'NexoraDB service mode required'})
        result = store.query_text(username, query_text, top_k=top_k)
        return jsonify({'success': True, 'result': result})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ==================== 聊天相关 ====================

@app.route('/chat')
def chat():
    """聊天页面"""
    if 'username' not in session:
        return redirect(url_for('login'))
    cfg = get_config_all()
    mail_cfg = cfg.get('nexora_mail', {}) if isinstance(cfg, dict) else {}
    mail_enabled = bool(mail_cfg.get('nexora_mail_enabled', False))
    return render_template('chat.html', username=session['username'], nexora_mail_enabled=mail_enabled)


@app.route('/api/upload', methods=['POST'])
@require_login
def upload_file():
    """创建异步上传任务（上传 -> 解析 -> 向量化）"""
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': '没有文件'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'message': '未选择文件'}), 400

    try:
        username = session['username']
        filename = os.path.basename(file.filename)
        suffix = os.path.splitext(filename)[1].lower()
        if suffix not in UserFileSandbox.ALLOWED_UPLOAD_EXTS:
            allow_preview = ", ".join(sorted(list(UserFileSandbox.ALLOWED_UPLOAD_EXTS)))
            return jsonify({
                'success': False,
                'message': f'当前仅支持文本类 + docx/pdf/pptx 上传解析，后缀 {suffix or "(none)"} 不支持。支持后缀: {allow_preview}'
            }), 400

        update_file_name = (request.form.get('update_file_name') or '').strip() or None
        raw = file.read()
        task_id = _upload_task_create(username, filename)
        worker = threading.Thread(
            target=_run_upload_task,
            args=(task_id, username, filename, raw, update_file_name),
            daemon=True
        )
        worker.start()

        return jsonify({
            'success': True,
            'async': True,
            'task_id': task_id,
            'status': 'queued',
            'stage': 'queued',
            'progress': 0,
            'message': '上传任务已创建'
        })

    except Exception as e:
        print(f"[ERROR] Upload failed: {e}")
        return jsonify({'success': False, 'message': f'上传失败: {str(e)}'}), 500


@app.route('/api/upload/task/<task_id>', methods=['GET'])
@require_login
def get_upload_task(task_id):
    username = session['username']
    task = _upload_task_get(task_id)
    if not task:
        return jsonify({'success': False, 'message': '任务不存在'}), 404
    if str(task.get('username') or '') != str(username):
        return jsonify({'success': False, 'message': '无权限访问该任务'}), 403

    return jsonify({
        'success': True,
        'task': {
            'task_id': task.get('task_id'),
            'task_type': task.get('task_type') or '',
            'filename': task.get('filename'),
            'status': task.get('status'),
            'stage': task.get('stage'),
            'progress': int(task.get('progress', 0) or 0),
            'message': task.get('message') or '',
            'error': task.get('error') or '',
            'result': task.get('result'),
            'created_at': task.get('created_at'),
            'updated_at': task.get('updated_at')
        }
    })


@app.route('/api/knowledge/vectorize/task', methods=['POST'])
@require_login
def create_knowledge_vectorize_task():
    """创建知识点向量化异步任务（复用统一任务轮询接口）"""
    username = session['username']
    data = request.get_json() or {}
    title = str(data.get('title') or '').strip()
    library = _normalize_vector_library(data.get('library'), default='knowledge')
    if not title:
        return jsonify({'success': False, 'message': '缺少 title'}), 400

    task_id = _upload_task_create(
        username,
        title,
        task_type='knowledge_vectorize',
        extra={'library': library}
    )
    worker = threading.Thread(
        target=_run_knowledge_vectorize_task,
        args=(task_id, username, title, library),
        daemon=True
    )
    worker.start()
    return jsonify({
        'success': True,
        'async': True,
        'task_id': task_id,
        'status': 'queued',
        'stage': 'queued',
        'progress': 0,
        'message': '向量化任务已创建'
    })


@app.route('/api/upload/task/<task_id>/cancel', methods=['POST'])
@require_login
def cancel_upload_task(task_id):
    username = session['username']
    task = _upload_task_get(task_id)
    if not task:
        return jsonify({'success': False, 'message': '任务不存在'}), 404
    if str(task.get('username') or '') != str(username):
        return jsonify({'success': False, 'message': '无权限访问该任务'}), 403

    status = str(task.get('status') or '')
    if status in {'completed', 'failed', 'cancelled'}:
        return jsonify({'success': True, 'already_done': True, 'status': status})

    _upload_task_mark_cancel(task_id)
    return jsonify({'success': True, 'cancel_requested': True})


@app.route('/api/files/list', methods=['GET'])
@require_login
def list_cloud_files():
    """列出当前用户文件沙箱中的云端文件"""
    try:
        username = session['username']
        query = str(request.args.get('q', '') or '').strip()
        regex_raw = str(request.args.get('regex', '') or '').strip().lower()
        limit_raw = request.args.get('limit', 200)

        try:
            limit = int(limit_raw)
        except Exception:
            limit = 200
        limit = max(1, min(limit, 1000))

        regex = regex_raw in {'1', 'true', 'yes', 'y', 'on'}

        sandbox = UserFileSandbox(username)
        files = sandbox.list_files(query=query or None, regex=regex, max_items=limit)
        return jsonify({
            'success': True,
            'files': files,
            'total': len(files)
        })
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        print(f"[ERROR] List cloud files failed: {e}")
        return jsonify({'success': False, 'message': f'读取文件列表失败: {str(e)}'}), 500


@app.route('/api/files/download', methods=['GET'])
@require_login
def download_cloud_file():
    """下载当前用户文件沙箱中的文件（按 alias 或 sandbox_path）"""
    try:
        username = session['username']
        file_ref = str(request.args.get('file_ref', '') or '').strip()
        if not file_ref:
            return jsonify({'success': False, 'message': '缺少 file_ref'}), 400

        sandbox = UserFileSandbox(username)
        entry = sandbox._get_entry(file_ref)
        abs_path = sandbox._get_abs_path(entry)

        download_name = str(entry.get('original_name') or entry.get('alias') or 'download.txt')
        return send_file(abs_path, as_attachment=True, download_name=download_name)
    except FileNotFoundError as e:
        return jsonify({'success': False, 'message': str(e)}), 404
    except Exception as e:
        print(f"[ERROR] Download cloud file failed: {e}")
        return jsonify({'success': False, 'message': f'下载失败: {str(e)}'}), 500


@app.route('/api/files/remove', methods=['DELETE'])
@require_login
def remove_cloud_file():
    """删除当前用户文件沙箱中的文件（按 alias 或 sandbox_path）"""
    try:
        username = session['username']
        file_ref = str(request.args.get('file_ref', '') or '').strip()
        if not file_ref:
            payload = request.get_json(silent=True) or {}
            file_ref = str(payload.get('file_ref', '') or '').strip()
        if not file_ref:
            return jsonify({'success': False, 'message': '缺少 file_ref'}), 400

        sandbox = UserFileSandbox(username)
        result = sandbox.remove_file(file_ref)
        if not result.get('success'):
            return jsonify({'success': False, 'message': result.get('message', '删除失败')}), 404

        removed = result.get('removed', {}) if isinstance(result, dict) else {}
        alias = str(removed.get('alias') or '').strip()
        if alias:
            try:
                vec_title = _temp_file_vector_title(alias)
                store, _ = get_chroma_store()
                if store and getattr(store, 'mode', '') == 'service':
                    store.delete_by_title(username, vec_title, library='temp_file')
            except Exception:
                pass
        return jsonify({'success': True, 'removed': removed})
    except Exception as e:
        print(f"[ERROR] Remove cloud file failed: {e}")
        return jsonify({'success': False, 'message': f'删除失败: {str(e)}'}), 500


@app.route('/api/files/read', methods=['GET'])
@require_login
def read_cloud_file():
    """读取当前用户文件沙箱中文件内容（文本预览）"""
    try:
        username = session['username']
        file_ref = str(request.args.get('file_ref', '') or '').strip()
        if not file_ref:
            return jsonify({'success': False, 'message': '缺少 file_ref'}), 400

        sandbox = UserFileSandbox(username)
        payload = sandbox.read_file(file_ref)
        if not payload.get('success'):
            return jsonify({'success': False, 'message': payload.get('message', '读取失败')}), 400
        return jsonify({
            'success': True,
            'file': payload.get('file', {}),
            'content': payload.get('content', ''),
            'truncated': bool(payload.get('truncated', False)),
            'truncate_at': payload.get('truncate_at'),
            'limits': payload.get('limits', {}),
        })
    except FileNotFoundError as e:
        return jsonify({'success': False, 'message': str(e)}), 404
    except Exception as e:
        print(f"[ERROR] Read cloud file failed: {e}")
        return jsonify({'success': False, 'message': f'读取失败: {str(e)}'}), 500


def _as_bool(value, default=False):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        v = value.strip().lower()
        if v in {"1", "true", "yes", "y", "on"}:
            return True
        if v in {"0", "false", "no", "n", "off"}:
            return False
    if value is None:
        return default
    return bool(value)


# ==================== Long-term Task API ====================

@app.route('/api/longterm/tasks', methods=['GET'])
@require_login
def longterm_list_tasks():
    username = session['username']
    orchestrator = LongTermOrchestrator(username)
    try:
        limit_raw = request.args.get('limit', 100)
        try:
            limit = int(limit_raw)
        except Exception:
            limit = 100
        status = (request.args.get('status') or '').strip() or None
        items = orchestrator.list_tasks(limit=limit, status=status)
        return jsonify({'success': True, 'tasks': items})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/longterm/tasks', methods=['POST'])
@require_login
def longterm_create_task():
    username = session['username']
    orchestrator = LongTermOrchestrator(username)
    data = request.get_json() or {}
    goal = str(data.get('goal') or '').strip()
    if not goal:
        return jsonify({'success': False, 'message': 'goal 不能为空'}), 400

    title = str(data.get('title') or '').strip() or None
    auto_plan = _as_bool(data.get('auto_plan', True), True)
    step_count = data.get('step_count', 5)
    system_prompt = str(data.get('system_prompt') or '')

    try:
        task = orchestrator.create_task(
            goal=goal,
            title=title,
            auto_plan=auto_plan,
            step_count=step_count,
            system_prompt=system_prompt,
        )
        return jsonify({'success': True, 'task': task})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/longterm/tasks/<task_id>', methods=['GET'])
@require_login
def longterm_get_task(task_id):
    username = session['username']
    orchestrator = LongTermOrchestrator(username)
    try:
        task = orchestrator.get_task(task_id)
        return jsonify({'success': True, 'task': task})
    except FileNotFoundError:
        return jsonify({'success': False, 'message': 'task not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/longterm/tasks/<task_id>/plan', methods=['POST'])
@require_login
def longterm_regenerate_plan(task_id):
    username = session['username']
    orchestrator = LongTermOrchestrator(username)
    data = request.get_json() or {}
    step_count = data.get('step_count', 5)
    try:
        task = orchestrator.regenerate_plan(task_id, step_count=step_count)
        return jsonify({'success': True, 'task': task})
    except FileNotFoundError:
        return jsonify({'success': False, 'message': 'task not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/longterm/tasks/<task_id>/start', methods=['POST'])
@require_login
def longterm_start_task(task_id):
    username = session['username']
    orchestrator = LongTermOrchestrator(username)
    try:
        task = orchestrator.start(task_id)
        return jsonify({'success': True, 'task': task})
    except FileNotFoundError:
        return jsonify({'success': False, 'message': 'task not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/longterm/tasks/<task_id>/step', methods=['POST'])
@require_login
def longterm_submit_step(task_id):
    username = session['username']
    orchestrator = LongTermOrchestrator(username)
    data = request.get_json() or {}
    try:
        task = orchestrator.submit_step_result(task_id, data)
        return jsonify({'success': True, 'task': task})
    except FileNotFoundError:
        return jsonify({'success': False, 'message': 'task not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/longterm/tasks/<task_id>/rework', methods=['POST'])
@require_login
def longterm_rework_task(task_id):
    username = session['username']
    orchestrator = LongTermOrchestrator(username)
    data = request.get_json() or {}
    step_ref = data.get('step_id')
    if step_ref is None:
        step_ref = data.get('step_index')
    if step_ref is None:
        return jsonify({'success': False, 'message': '需要 step_id 或 step_index'}), 400
    reason = str(data.get('reason') or '')
    try:
        task = orchestrator.rework(task_id, step_ref=step_ref, reason=reason)
        return jsonify({'success': True, 'task': task})
    except FileNotFoundError:
        return jsonify({'success': False, 'message': 'task not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/longterm/tasks/<task_id>/end-review', methods=['POST'])
@require_login
def longterm_end_review(task_id):
    username = session['username']
    orchestrator = LongTermOrchestrator(username)
    data = request.get_json() or {}
    passed = _as_bool(data.get('passed', False), False)
    rework_step = data.get('rework_step_id')
    if rework_step is None:
        rework_step = data.get('rework_step_index')
    comments = str(data.get('comments') or '')
    try:
        task = orchestrator.end_review(task_id, passed=passed, rework_step=rework_step, comments=comments)
        return jsonify({'success': True, 'task': task})
    except FileNotFoundError:
        return jsonify({'success': False, 'message': 'task not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/longterm/tasks/<task_id>/status', methods=['POST'])
@require_login
def longterm_update_status(task_id):
    username = session['username']
    orchestrator = LongTermOrchestrator(username)
    data = request.get_json() or {}
    status = str(data.get('status') or '').strip().lower()
    if not status:
        return jsonify({'success': False, 'message': 'status 不能为空'}), 400
    reason = str(data.get('reason') or '')
    try:
        task = orchestrator.set_status(task_id, status=status, reason=reason)
        return jsonify({'success': True, 'task': task})
    except FileNotFoundError:
        return jsonify({'success': False, 'message': 'task not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/longterm/tasks/<task_id>/transit', methods=['GET'])
@require_login
def longterm_transit_summary(task_id):
    username = session['username']
    orchestrator = LongTermOrchestrator(username)
    try:
        payload = orchestrator.summarize_for_transit(task_id)
        return jsonify({'success': True, 'transit': payload})
    except FileNotFoundError:
        return jsonify({'success': False, 'message': 'task not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/longterm/tasks/<task_id>/ai-plan', methods=['POST'])
@require_login
def longterm_ai_plan(task_id):
    username = session['username']
    orchestrator = LongTermOrchestrator(username)
    data = request.get_json() or {}
    model_name = data.get('model_name')
    max_steps = data.get('max_steps', 6)
    try:
        task = orchestrator.ai_generate_plan(
            task_id=task_id,
            model_name=model_name,
            max_steps=max_steps,
            event_callback=None
        )
        return jsonify({'success': True, 'task': task})
    except FileNotFoundError:
        return jsonify({'success': False, 'message': 'task not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/longterm/tasks/<task_id>/ai-step', methods=['POST'])
@require_login
def longterm_ai_step(task_id):
    username = session['username']
    orchestrator = LongTermOrchestrator(username)
    data = request.get_json() or {}
    model_name = data.get('model_name')
    try:
        task, payload = orchestrator.ai_execute_current_step(
            task_id=task_id,
            model_name=model_name,
            event_callback=None
        )
        return jsonify({'success': True, 'task': task, 'step_payload': payload})
    except FileNotFoundError:
        return jsonify({'success': False, 'message': 'task not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/longterm/tasks/<task_id>/ai-end-review', methods=['POST'])
@require_login
def longterm_ai_end_review(task_id):
    username = session['username']
    orchestrator = LongTermOrchestrator(username)
    data = request.get_json() or {}
    model_name = data.get('model_name')
    try:
        task, payload = orchestrator.ai_end_review(
            task_id=task_id,
            model_name=model_name,
            event_callback=None
        )
        return jsonify({'success': True, 'task': task, 'review_payload': payload})
    except FileNotFoundError:
        return jsonify({'success': False, 'message': 'task not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/longterm/tasks/<task_id>/run-auto', methods=['POST'])
@require_login
def longterm_run_auto(task_id):
    username = session['username']
    orchestrator = LongTermOrchestrator(username)
    data = request.get_json() or {}
    model_name = data.get('model_name')
    max_cycles = data.get('max_cycles', 20)
    try:
        task = orchestrator.run_auto(
            task_id=task_id,
            model_name=model_name,
            max_cycles=max_cycles,
            event_callback=None
        )
        return jsonify({'success': True, 'task': task})
    except FileNotFoundError:
        return jsonify({'success': False, 'message': 'task not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/longterm/route', methods=['POST'])
@require_login
def longterm_route_message():
    username = session['username']
    orchestrator = LongTermOrchestrator(username)
    data = request.get_json() or {}
    message = str(data.get('message') or '').strip()
    model_name = data.get('model_name')
    if not message:
        return jsonify({'success': False, 'message': 'message 不能为空'}), 400
    try:
        decision = orchestrator.route_message(
            user_message=message,
            model_name=model_name,
            event_callback=None
        )
        return jsonify({'success': True, 'decision': decision})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/conversations', methods=['GET'])
@require_login
def list_conversations():
    """获取对话列表"""
    username = session['username']
    manager = ConversationManager(username)
    conversations = manager.list_conversations()
    return jsonify({'success': True, 'conversations': conversations})


@app.route('/api/conversations/<conv_id>/pin', methods=['POST'])
@require_login
def set_conversation_pin(conv_id):
    """设置对话置顶状态"""
    username = session['username']
    manager = ConversationManager(username)
    data = request.get_json(silent=True) or {}
    pin = bool(data.get('pin', True))
    try:
        manager.set_conversation_pin(conv_id, pin=pin)
        return jsonify({'success': True, 'conversation_id': conv_id, 'pin': pin})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 400


@app.route('/api/conversations/<conv_id>', methods=['GET'])
@require_login
def get_conversation(conv_id):
    """获取对话详情"""
    username = session['username']
    manager = ConversationManager(username)
    try:
        conversation = manager.get_conversation(conv_id)
        return jsonify({'success': True, 'conversation': conversation})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/conversations/<conv_id>', methods=['DELETE'])
@require_login
def delete_conversation(conv_id):
    """删除对话"""
    username = session['username']
    manager = ConversationManager(username)
    success = manager.delete_conversation(conv_id)
    if success:
        _remove_conversation_assets_dir(username, conv_id)
    return jsonify({'success': success})


@app.route('/api/delete_message', methods=['POST'])
@require_login
def delete_message():
    data = request.json
    if not data:
        return jsonify({"success": False, "message": "No data provided"}), 400
        
    username = session['username']
    conv_id = data.get('conversation_id')
    index = data.get('index')
    
    if conv_id is None:
        return jsonify({"success": False, "message": "Missing conversation_id"}), 400
    if index is None:
        return jsonify({"success": False, "message": "Missing index"}), 400
        
    manager = ConversationManager(username)
    if manager.delete_message(conv_id, int(index)):
        try:
            conversation = manager.get_conversation(conv_id)
            keep_ids = _collect_referenced_asset_ids(conversation)
            _cleanup_conversation_assets(username, conv_id, keep_asset_ids=keep_ids)
        except Exception as e:
            print(f"[ASSET] cleanup after delete_message failed: {e}")
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "Failed to delete"}), 500


@app.route('/api/conversations/<conv_id>/assets/<asset_id>', methods=['GET'])
@require_login
def get_conversation_asset(conv_id, asset_id):
    username = session['username']
    aid = str(asset_id or '').strip()
    if not aid:
        return jsonify({'success': False, 'message': 'invalid asset id'}), 400

    idx = _load_conversation_asset_index(username, conv_id)
    assets = idx.get("assets", {}) if isinstance(idx.get("assets"), dict) else {}
    meta = assets.get(aid)
    if not isinstance(meta, dict):
        return jsonify({'success': False, 'message': 'asset not found'}), 404

    file_name = str(meta.get("file_name") or "").strip()
    if not file_name:
        return jsonify({'success': False, 'message': 'asset file missing'}), 404

    fpath = os.path.join(_conversation_asset_dir(username, conv_id), file_name)
    if not os.path.exists(fpath):
        return jsonify({'success': False, 'message': 'asset file not found'}), 404

    mime = str(meta.get("mime") or "").strip() or "application/octet-stream"
    return send_file(fpath, mimetype=mime)


@app.route('/api/switch_version', methods=['POST'])
@require_login
def switch_version():
    data = request.json
    if not data:
        return jsonify({"success": False, "message": "No data provided"}), 400
        
    username = session['username']
    conv_id = data.get('conversation_id')
    msg_index = data.get('message_index')
    ver_index = data.get('version_index')
    
    if conv_id is None or msg_index is None or ver_index is None:
        return jsonify({"success": False, "message": "Missing data"}), 400
        
    manager = ConversationManager(username)
    if manager.switch_message_version(conv_id, int(msg_index), int(ver_index)):
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "Failed to switch version"}), 500


@app.route('/api/config', methods=['GET'])
@require_login
def get_config():
    """获取模型配置（用户接口）"""
    username = session.get('username')
    try:
        def _to_context_window(info_obj):
            src = info_obj if isinstance(info_obj, dict) else {}
            for key in ('context_window', 'context_length', 'max_context_tokens', 'max_input_tokens'):
                raw = src.get(key)
                try:
                    n = int(raw)
                except Exception:
                    n = 0
                if n > 0:
                    return n
            return None

        blacklist_path = './data/model_permissions.json'
        blacklist = []
        if os.path.exists(blacklist_path):
            with open(blacklist_path, 'r', encoding='utf-8') as f:
                perm_config = json.load(f)
                user_blacklists = perm_config.get('user_blacklists', {})
                blacklist = user_blacklists.get(username, perm_config.get('default_blacklist', []))

        config = get_config_all()
        has_volcengine_model = any(
            isinstance(info, dict) and str(info.get('provider', 'volcengine')).strip().lower() == 'volcengine'
            for info in (config.get('models', {}) or {}).values()
        )
        volc_context_map = _refresh_volc_context_window_map(config, timeout=8.0) if has_volcengine_model else {}

        models_info = []
        for model_id, info in config.get('models', {}).items():
            if model_id in blacklist:
                continue
            provider_name = str(info.get('provider', 'volcengine') or 'volcengine').strip().lower()
            item = {
                'id': model_id,
                'name': info.get('name', model_id),
                'provider': info.get('provider', 'volcengine'),
                'status': info.get('status', 'normal')
            }
            context_window = _to_context_window(info)
            if not context_window and provider_name == 'volcengine':
                context_window = _resolve_volc_context_window_by_model_id(model_id, volc_context_map)
            if context_window:
                item['context_window'] = context_window
            models_info.append(item)

        default_model = config.get('default_model')
        if default_model in blacklist:
            default_model = models_info[0]['id'] if models_info else None

        return jsonify({
            'success': True,
            'models': models_info,
            'default_model': default_model
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/admin/user/models', methods=['GET'])
@require_admin
def admin_get_user_models():
    """获取用户可用模型列表（管理员）"""
    target_username = request.args.get('username')
    if not target_username:
        return jsonify({"success": False, "message": "Missing username"}), 400

    try:
        config = get_config_all()
        all_models = config.get('models', {})

        blacklist_path = './data/model_permissions.json'
        blacklist = []
        if os.path.exists(blacklist_path):
            with open(blacklist_path, 'r', encoding='utf-8') as f:
                perm_config = json.load(f)
                user_blacklists = perm_config.get('user_blacklists', {})
                blacklist = user_blacklists.get(target_username, perm_config.get('default_blacklist', []))

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


@app.route('/api/admin/user/models/update', methods=['POST'])
@require_admin
def admin_update_user_models():
    """更新用户的模型黑名单"""
    data = request.get_json()
    target_username = data.get('username')
    blocked_models = data.get('blocked_models', []) # 传递 ID 列表
    
    if not target_username:
        return jsonify({"success": False, "message": "Missing username"}), 400
        
    try:
        blacklist_path = './data/model_permissions.json'
        if not os.path.exists(blacklist_path):
            perm_config = {"default_blacklist": [], "user_blacklists": {}}
        else:
            with open(blacklist_path, 'r', encoding='utf-8') as f:
                perm_config = json.load(f)
        
        # 更新黑名单
        if 'user_blacklists' not in perm_config:
            perm_config['user_blacklists'] = {}
            
        perm_config['user_blacklists'][target_username] = blocked_models
        
        with open(blacklist_path, 'w', encoding='utf-8') as f:
            json.dump(perm_config, f, indent=4, ensure_ascii=False)
            
        return jsonify({'success': True, 'message': f'用户 {target_username} 的模型权限已更新'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

    
    return jsonify({'success': False, 'message': '配置加载失败'})


@app.route('/api/admin/models/config', methods=['GET'])
@require_admin
def admin_get_models_config():
    """管理员读取模型/Provider配置"""
    try:
        cfg = load_models_config()
        return jsonify({
            'success': True,
            'models': cfg.get('models', {}),
            'providers': cfg.get('providers', {})
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/provider/models', methods=['GET'])
@require_login
def api_provider_models():
    """
    Provider model listing test endpoint.
    Example:
      /api/provider/models?provider=volcengine&capability=vision
    """
    provider_name = str(request.args.get('provider', 'volcengine') or 'volcengine').strip()
    capability = str(request.args.get('capability', '') or '').strip().lower()
    try:
        timeout = float(request.args.get('timeout', 30) or 30)
    except Exception:
        timeout = 30.0
    if timeout <= 0:
        timeout = 30.0

    try:
        config = get_config_all()
        providers = config.get('providers', {}) if isinstance(config, dict) else {}
        provider_cfg = providers.get(provider_name)
        if not isinstance(provider_cfg, dict):
            return jsonify({
                'success': False,
                'message': f'provider 不存在: {provider_name}'
            }), 404

        adapter = create_provider_adapter(provider_name, provider_cfg)
        api_key = str(provider_cfg.get('api_key', '') or '').strip()
        base_url = str(provider_cfg.get('base_url', '') or '').strip()
        if not api_key:
            return jsonify({
                'success': False,
                'message': f'provider {provider_name} 未配置 api_key'
            }), 400

        client = adapter.create_client(api_key=api_key, base_url=base_url, timeout=timeout)
        result = adapter.list_models(
            client=client,
            capability=capability,
            request_options={}
        )
        if not isinstance(result, dict):
            result = {
                'ok': False,
                'provider': provider_name,
                'capability': capability,
                'error': 'invalid_result_type',
                'models': []
            }
        ok = bool(result.get('ok', False))
        status_code = 200 if ok else 502
        return jsonify({
            'success': ok,
            **result
        }), status_code
    except Exception as e:
        return jsonify({
            'success': False,
            'provider': provider_name,
            'capability': capability,
            'message': str(e)
        }), 500


@app.route('/api/admin/tools/stats', methods=['GET'])
@require_admin
def admin_tool_stats():
    """管理端工具调用统计：总量、成功率、耗时、按工具/Provider/Model分布。"""
    try:
        try:
            days = int(request.args.get('days', 30) or 30)
        except Exception:
            days = 30
        days = max(1, min(days, 365))

        now = datetime.now()
        start_dt = now - timedelta(days=days - 1)
        start_day = start_dt.date()
        day_labels = []
        day_buckets = {}
        for i in range(days):
            d = start_day + timedelta(days=i)
            key = d.strftime('%Y-%m-%d')
            day_labels.append(key)
            day_buckets[key] = {'calls': 0, 'errors': 0, 'latency_ms': 0}

        total_calls = 0
        success_calls = 0
        error_calls = 0
        latency_sum = 0

        tool_map = {}
        provider_map = {}
        model_map = {}

        cutoff_24h = now - timedelta(hours=24)
        failed_24h = {}

        user_dir = os.path.join(os.path.dirname(__file__), "data/users")
        if os.path.exists(user_dir):
            for username in os.listdir(user_dir):
                tool_file = os.path.join(user_dir, username, "tool_usage.json")
                if not os.path.exists(tool_file):
                    continue
                try:
                    with open(tool_file, 'r', encoding='utf-8') as f:
                        logs = json.load(f)
                except Exception:
                    continue
                if not isinstance(logs, list):
                    continue

                for log in logs:
                    ts = str(log.get('timestamp') or '')
                    day = ts[:10]
                    if day not in day_buckets:
                        continue

                    tool_name = str(log.get('tool_name') or 'unknown').strip() or 'unknown'
                    provider = str(log.get('provider') or 'unknown').strip() or 'unknown'
                    model = str(log.get('model') or 'unknown').strip() or 'unknown'
                    success = bool(log.get('success', True))
                    duration = int(log.get('duration_ms', 0) or 0)
                    error_message = str(log.get('error_message') or '')

                    total_calls += 1
                    latency_sum += duration
                    if success:
                        success_calls += 1
                    else:
                        error_calls += 1

                    day_buckets[day]['calls'] += 1
                    day_buckets[day]['latency_ms'] += duration
                    if not success:
                        day_buckets[day]['errors'] += 1

                    if tool_name not in tool_map:
                        tool_map[tool_name] = {
                            'name': tool_name,
                            'calls': 0,
                            'errors': 0,
                            'latency_sum_ms': 0,
                            'last_error': ''
                        }
                    tool_map[tool_name]['calls'] += 1
                    tool_map[tool_name]['latency_sum_ms'] += duration
                    if not success:
                        tool_map[tool_name]['errors'] += 1
                        if error_message:
                            tool_map[tool_name]['last_error'] = error_message

                    if provider not in provider_map:
                        provider_map[provider] = {'name': provider, 'calls': 0, 'errors': 0, 'latency_sum_ms': 0}
                    provider_map[provider]['calls'] += 1
                    provider_map[provider]['latency_sum_ms'] += duration
                    if not success:
                        provider_map[provider]['errors'] += 1

                    if model not in model_map:
                        model_map[model] = {'name': model, 'calls': 0, 'errors': 0, 'latency_sum_ms': 0}
                    model_map[model]['calls'] += 1
                    model_map[model]['latency_sum_ms'] += duration
                    if not success:
                        model_map[model]['errors'] += 1

                    try:
                        dt = datetime.strptime(ts, '%Y-%m-%d %H:%M:%S')
                    except Exception:
                        dt = None
                    if (dt is not None) and (not success) and dt >= cutoff_24h:
                        if tool_name not in failed_24h:
                            failed_24h[tool_name] = {'name': tool_name, 'errors': 0, 'last_error': ''}
                        failed_24h[tool_name]['errors'] += 1
                        if error_message:
                            failed_24h[tool_name]['last_error'] = error_message

        def _finalize_rows(rows):
            out = []
            for item in rows:
                calls = int(item.get('calls', 0) or 0)
                errors = int(item.get('errors', 0) or 0)
                lat_sum = int(item.get('latency_sum_ms', 0) or 0)
                avg = round(lat_sum / calls, 2) if calls else 0
                row = dict(item)
                row['avg_latency_ms'] = avg
                row['error_rate'] = round((errors / calls * 100.0), 2) if calls else 0.0
                row.pop('latency_sum_ms', None)
                out.append(row)
            return out

        top_tools = sorted(
            _finalize_rows(list(tool_map.values())),
            key=lambda x: x.get('calls', 0),
            reverse=True
        )[:20]
        top_failed_tools_24h = sorted(
            list(failed_24h.values()),
            key=lambda x: x.get('errors', 0),
            reverse=True
        )[:10]
        top_providers = sorted(
            _finalize_rows(list(provider_map.values())),
            key=lambda x: x.get('calls', 0),
            reverse=True
        )[:8]
        top_models = sorted(
            _finalize_rows(list(model_map.values())),
            key=lambda x: x.get('calls', 0),
            reverse=True
        )[:10]

        series = {
            'calls': [day_buckets[d]['calls'] for d in day_labels],
            'errors': [day_buckets[d]['errors'] for d in day_labels],
            'avg_latency_ms': [
                round(day_buckets[d]['latency_ms'] / day_buckets[d]['calls'], 2) if day_buckets[d]['calls'] else 0
                for d in day_labels
            ]
        }

        return jsonify({
            'success': True,
            'days': days,
            'summary': {
                'total_calls': total_calls,
                'success_calls': success_calls,
                'error_calls': error_calls,
                'error_rate': round((error_calls / total_calls * 100.0), 2) if total_calls else 0.0,
                'avg_latency_ms': round(latency_sum / total_calls, 2) if total_calls else 0.0
            },
            'labels': day_labels,
            'series': series,
            'top_tools': top_tools,
            'top_failed_tools_24h': top_failed_tools_24h,
            'top_providers': top_providers,
            'top_models': top_models
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/admin/tokens/timeseries', methods=['GET'])
@require_admin
def admin_token_timeseries():
    """返回管理端 token 按天趋势，用于折线图展示"""
    try:
        days = int(request.args.get('days', 30) or 30)
    except Exception:
        days = 30
    days = max(1, min(days, 365))

    today = datetime.now().date()
    labels = []
    buckets = {}
    for i in range(days - 1, -1, -1):
        d = today - timedelta(days=i)
        key = d.strftime('%Y-%m-%d')
        labels.append(key)
        buckets[key] = {
            'input_tokens': 0,
            'output_tokens': 0,
            'total_tokens': 0,
            'requests': 0
        }

    provider_totals = {}
    model_totals = {}
    user_dir = os.path.join(os.path.dirname(__file__), "data/users")
    if os.path.exists(user_dir):
        for username in os.listdir(user_dir):
            token_file = os.path.join(user_dir, username, "token_usage.json")
            if not os.path.exists(token_file):
                continue
            try:
                with open(token_file, 'r', encoding='utf-8') as f:
                    logs = json.load(f)
            except Exception:
                continue

            for log in logs:
                ts = str(log.get('timestamp', ''))
                day = ts[:10]
                if day not in buckets:
                    continue

                in_tokens = int(log.get('input_tokens', 0) or 0)
                out_tokens = int(log.get('output_tokens', 0) or 0)
                total = log.get('total_tokens', None)
                if total is None:
                    total = in_tokens + out_tokens
                total = int(total or 0)

                buckets[day]['input_tokens'] += in_tokens
                buckets[day]['output_tokens'] += out_tokens
                buckets[day]['total_tokens'] += total
                buckets[day]['requests'] += 1

                provider = (log.get('provider') or 'unknown').strip() or 'unknown'
                model = (log.get('model') or 'unknown').strip() or 'unknown'
                if provider not in provider_totals:
                    provider_totals[provider] = {'tokens': 0, 'requests': 0}
                if model not in model_totals:
                    model_totals[model] = {'tokens': 0, 'requests': 0}
                provider_totals[provider]['tokens'] += total
                provider_totals[provider]['requests'] += 1
                model_totals[model]['tokens'] += total
                model_totals[model]['requests'] += 1

    series = {
        'input_tokens': [buckets[d]['input_tokens'] for d in labels],
        'output_tokens': [buckets[d]['output_tokens'] for d in labels],
        'total_tokens': [buckets[d]['total_tokens'] for d in labels],
        'requests': [buckets[d]['requests'] for d in labels],
    }

    top_providers = sorted(
        [{'name': k, 'tokens': v['tokens'], 'requests': v['requests']} for k, v in provider_totals.items()],
        key=lambda x: x['tokens'],
        reverse=True
    )[:8]
    top_models = sorted(
        [{'name': k, 'tokens': v['tokens'], 'requests': v['requests']} for k, v in model_totals.items()],
        key=lambda x: x['tokens'],
        reverse=True
    )[:10]

    return jsonify({
        'success': True,
        'days': days,
        'labels': labels,
        'series': series,
        'top_providers': top_providers,
        'top_models': top_models
    })


@app.route('/api/admin/user/profile', methods=['POST'])
@require_admin
def admin_update_user_profile():
    """管理员更新用户资料（显示名）"""
    data = request.get_json() or {}
    user_id = data.get('user_id') or data.get('target_user_id') or data.get('target_username')
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


@app.route('/api/admin/models/provider/upsert', methods=['POST'])
@require_admin
def admin_upsert_provider():
    """新增或更新 Provider"""
    data = request.get_json() or {}
    provider = (data.get('provider') or '').strip()
    api_key = data.get('api_key')
    base_url = data.get('base_url')

    if not provider:
        return jsonify({'success': False, 'message': 'provider 不能为空'}), 400
    if api_key is None:
        api_key = ''
    if base_url is None:
        base_url = ''

    try:
        cfg = load_models_config()
        providers = cfg.setdefault('providers', {})
        providers[provider] = {
            'api_key': str(api_key),
            'base_url': str(base_url)
        }
        save_models_config(cfg)
        return jsonify({'success': True, 'message': f'Provider {provider} 已保存'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/admin/models/provider/delete', methods=['POST'])
@require_admin
def admin_delete_provider():
    """删除 Provider，需要输入确认文本"""
    data = request.get_json() or {}
    provider = (data.get('provider') or '').strip()
    confirm_text = data.get('confirm_text')

    if not provider:
        return jsonify({'success': False, 'message': 'provider 不能为空'}), 400
    if confirm_text != '确认修改':
        return jsonify({'success': False, 'message': '确认文本错误'}), 400

    try:
        cfg = load_models_config()
        providers = cfg.setdefault('providers', {})
        models = cfg.setdefault('models', {})

        if provider not in providers:
            return jsonify({'success': False, 'message': 'Provider 不存在'}), 404

        used_by = [mid for mid, minfo in models.items() if isinstance(minfo, dict) and minfo.get('provider') == provider]
        if used_by:
            return jsonify({
                'success': False,
                'message': f'Provider 正在被模型引用: {", ".join(used_by[:6])}'
            }), 400

        del providers[provider]
        save_models_config(cfg)
        return jsonify({'success': True, 'message': f'Provider {provider} 已删除'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/admin/models/model/upsert', methods=['POST'])
@require_admin
def admin_upsert_model():
    """新增或更新模型"""
    data = request.get_json() or {}
    model_id = (data.get('model_id') or '').strip()
    original_model_id = (data.get('original_model_id') or '').strip()
    name = (data.get('name') or '').strip()
    provider = (data.get('provider') or '').strip()
    status = (data.get('status') or 'normal').strip()

    if not model_id:
        return jsonify({'success': False, 'message': 'model_id 不能为空'}), 400
    if not provider:
        return jsonify({'success': False, 'message': 'provider 不能为空'}), 400

    try:
        cfg = load_models_config()
        providers = cfg.setdefault('providers', {})
        models = cfg.setdefault('models', {})

        if provider not in providers:
            return jsonify({'success': False, 'message': f'Provider 不存在: {provider}'}), 400

        is_rename = bool(original_model_id and original_model_id != model_id)
        if is_rename:
            if original_model_id not in models:
                return jsonify({'success': False, 'message': f'原模型不存在: {original_model_id}'}), 404
            if model_id in models:
                return jsonify({'success': False, 'message': f'目标模型ID已存在: {model_id}'}), 400
            del models[original_model_id]

        models[model_id] = {
            'name': name or model_id,
            'provider': provider,
            'status': status or 'normal'
        }
        save_models_config(cfg)
        if is_rename:
            return jsonify({'success': True, 'message': f'模型 {original_model_id} 已重命名为 {model_id}'})
        return jsonify({'success': True, 'message': f'模型 {model_id} 已保存'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/admin/models/model/delete', methods=['POST'])
@require_admin
def admin_delete_model():
    """删除模型，需要输入确认文本"""
    data = request.get_json() or {}
    model_id = (data.get('model_id') or '').strip()
    confirm_text = data.get('confirm_text')

    if not model_id:
        return jsonify({'success': False, 'message': 'model_id 不能为空'}), 400
    if confirm_text != '确认修改':
        return jsonify({'success': False, 'message': '确认文本错误'}), 400

    try:
        cfg = load_models_config()
        models = cfg.setdefault('models', {})
        if model_id not in models:
            return jsonify({'success': False, 'message': '模型不存在'}), 404
        del models[model_id]
        save_models_config(cfg)
        return jsonify({'success': True, 'message': f'模型 {model_id} 已删除'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/chat/stream', methods=['POST'])
@require_login
def chat_stream():
    """流式聊天接口"""
    data = request.get_json()
    sys_config = get_config_all()
    log_status = str(sys_config.get('log_status', 'silent')).lower()
    log_all_chunks = (log_status == 'all')
    message = data.get('message')
    conversation_id = data.get('conversation_id')
    model_name = data.get('model_name')
    enable_thinking = data.get('enable_thinking', False)
    enable_web_search = data.get('enable_web_search', True)
    enable_tools = data.get('enable_tools', True)
    raw_tool_mode = data.get('tool_mode')
    allow_history_images = _as_bool(data.get('allow_history_images', True), True)
    debug_mode = _as_bool(data.get('debug_mode', False), False)
    show_token_usage = data.get('show_token_usage', False)
    raw_file_ids = data.get('file_ids', [])
    file_ids = raw_file_ids if isinstance(raw_file_ids, list) else []

    enable_tools = bool(enable_tools)
    if raw_tool_mode is None:
        tool_mode = 'force' if enable_tools else 'off'
    else:
        tool_mode = str(raw_tool_mode or '').strip().lower()
        if tool_mode not in {'off', 'auto', 'force'}:
            tool_mode = 'force' if enable_tools else 'off'
    if tool_mode == 'off':
        enable_tools = False
    else:
        enable_tools = True
    
    # 重新生成标志
    is_regenerate = data.get('is_regenerate', False)
    regenerate_index = data.get('regenerate_index')
    
    if not message and not is_regenerate and len(file_ids) == 0:
        return jsonify({'success': False, 'message': '消息不能为空'})
    
    username = session['username']
    
    # --- 模型权限校验 ---
    try:
        blacklist_path = './data/model_permissions.json'
        blacklist = []
        if os.path.exists(blacklist_path):
            with open(blacklist_path, 'r', encoding='utf-8') as f:
                perm_config = json.load(f)
                user_blacklists = perm_config.get('user_blacklists', {})
                blacklist = user_blacklists.get(username, perm_config.get('default_blacklist', []))
        
        # 获取系统配置中的默认模型和全部模型
        sys_config = get_config_all()
        all_models = list(sys_config.get('models', {}).keys())
        default_sys_model = sys_config.get('default_model')

        # 校验请求的模型是否合法（存在且未被禁）
        if model_name and (model_name not in all_models or model_name in blacklist):
            # 如果请求非法或被禁，清空它，进入下方的自动分配逻辑
            model_name = None
        
        # 如果 model_name 为空（用户没选或者是上面的校验失败了），则自动分配第一个可用的
        if not model_name:
            # 尝试使用系统默认模型
            if default_sys_model and default_sys_model not in blacklist:
                model_name = default_sys_model
            else:
                # 寻找第一个不在黑名单的模型
                available_models = [m for m in all_models if m not in blacklist]
                if not available_models:
                    return jsonify({'success': False, 'message': '当前账号无可用模型，请联系管理员'})
                model_name = available_models[0]
                
    except Exception as e:
        print(f"Permission check error: {e}")
    # ------------------

    # 检测 NexoraCode 本地 Agent 状态，通过 WSS 长连接注入工具
    from agent_tunnel import is_agent_online, get_agent_tools
    _agent_info = None
    if is_agent_online(username):
        tools = get_agent_tools(username)
        if tools:
            _agent_info = {"username": username, "tools": tools}
    
    # 也可以兼容旧版本 Cookie 标识
    if not _agent_info:
        _agent_token = request.cookies.get("nexoracode_agent", "").strip()
        _agent_info = _LOCAL_AGENTS.get(_agent_token) if _agent_token else None
        if _agent_info and _agent_info.get("username") != username:
            _agent_info = None

    # 如果是重新生成，处理版本保存逻辑
    if is_regenerate and conversation_id and regenerate_index is not None:
        manager = ConversationManager(username)
        # 将当前的 assistant 消息存为历史版本
        manager.save_message_version(conversation_id, regenerate_index)
        # 如果前端没传 message，从历史中取出触发该回答的 user 消息
        if not message:
            convo = manager.get_conversation(conversation_id)
            if convo and regenerate_index > 0:
                message = convo['messages'][regenerate_index - 1].get('content', "")

    def generate():
        """生成流式响应"""
        try:
            # 创建模型实例
            model = Model(
                username, 
                model_name=model_name,
                conversation_id=conversation_id,
                auto_create=(conversation_id is None)
            )

            # 若存在 NexoraCode 本地 Agent，注入其本地工具
            if _agent_info:
                _inject_local_agent_tools(model, _agent_info)

            prepared_file_ids = _prepare_chat_file_ids(
                username=username,
                conversation_id=model.conversation_id,
                file_ids=file_ids
            )
            
            # 发送对话ID
            if not conversation_id:
                yield f"data: {json.dumps({'type': 'conversation_id', 'conversation_id': model.conversation_id})}\n\n"
            
            # 流式处理消息
            for chunk in model.sendMessage(
                message, 
                stream=True,
                enable_thinking=enable_thinking,
                enable_web_search=enable_web_search,
                enable_tools=enable_tools,
                tool_mode=tool_mode,
                debug_mode=debug_mode,
                allow_history_images=allow_history_images,
                show_token_usage=show_token_usage,
                file_ids=prepared_file_ids,
                is_regenerate=is_regenerate,
                regenerate_index=regenerate_index
            ):
                if log_all_chunks:
                    _log_stream_chunk(chunk, model_name=model_name or model.model_name)
                # 关键修复：添加 default=str 作为最后的保险，防止任何遗漏的 SDK 对象导致 JSON 序列化失败
                chunk_data = json.dumps(chunk, ensure_ascii=False, default=str)
                yield f"data: {chunk_data}\n\n"
            
        except Exception as e:
            error_data = json.dumps({
                'type': 'error',
                'content': f'处理消息时出错: {str(e)}'
            }, ensure_ascii=False)
            yield f"data: {error_data}\n\n"
    
    from flask import stream_with_context
    resp = Response(stream_with_context(generate()), mimetype='text/event-stream')
    resp.headers['Cache-Control'] = 'no-cache, no-transform'
    resp.headers['X-Accel-Buffering'] = 'no'
    resp.headers['Connection'] = 'keep-alive'
    return resp


@app.route('/api/client-tools/pull', methods=['POST'])
@require_login
def pull_client_tool_request():
    data = request.get_json(silent=True) or {}
    conversation_id = str(data.get('conversation_id') or '').strip()
    if not conversation_id:
        return jsonify({'success': False, 'message': 'conversation_id is required'}), 400

    username = session['username']
    wait_ms = data.get('wait_ms', 0)
    req = pull_pending_request(
        username=username,
        conversation_id=conversation_id,
        wait_ms=wait_ms
    )
    return jsonify({
        'success': True,
        'request': req
    })


@app.route('/api/client-tools/submit', methods=['POST'])
def submit_client_tool_result_api():
    data = request.get_json(silent=True) or {}
    conversation_id = str(data.get('conversation_id') or '').strip()
    request_id = str(data.get('request_id') or '').strip()
    if not conversation_id:
        return jsonify({'success': False, 'message': 'conversation_id is required'}), 400
    if not request_id:
        return jsonify({'success': False, 'message': 'request_id is required'}), 400

    raw_exec_success = data.get('exec_success', data.get('success', True))
    if isinstance(raw_exec_success, str):
        exec_success = raw_exec_success.strip().lower() in {'1', 'true', 'yes', 'y', 'on'}
    else:
        exec_success = bool(raw_exec_success)

    result_payload = {
        'success': exec_success,
        'result': data.get('result'),
        'error': str(data.get('error') or '').strip(),
        'logs': data.get('logs') if isinstance(data.get('logs'), list) else [],
        'meta': data.get('meta') if isinstance(data.get('meta'), dict) else {},
        'submitted_at': int(time.time())
    }
    username = session.get('username')
    if not username:
        agent_token = str(
            request.headers.get('X-NexoraCode-Agent')
            or data.get('agent_token')
            or request.cookies.get('nexoracode_agent')
            or ''
        ).strip()
        agent_info = _LOCAL_AGENTS.get(agent_token) if agent_token else None
        if agent_info:
            username = str(agent_info.get('username') or '').strip()
    if not username:
        return jsonify({'success': False, 'message': '请先登录或提供有效 agent_token'}), 401

    ok, msg = submit_request_result(
        username=username,
        conversation_id=conversation_id,
        request_id=request_id,
        result_payload=result_payload
    )
    if not ok:
        return jsonify({'success': False, 'message': msg}), 404
    return jsonify({'success': True})


# ==================== NexoraCode 本地 Agent 桥接 ====================

def _inject_local_agent_tools(model, agent_info: dict):
    """将本地 Agent 工具注入到 model 实例（工具定义 + 执行处理器）

    执行路径：服务器 enqueue_request → NexoraCode 长轮询 pull → 本地执行 →
    POST /api/client-tools/submit → wait_for_result 返回结果给模型。
    避免服务器直连 localhost（服务器端 localhost != 用户本机）。
    """
    username = agent_info.get("username", "")

    # 判断当前 provider 是否使用 Responses API（扁平格式，无 "function" 包装层）
    use_responses_api = (
        hasattr(model, '_provider_use_responses_api')
        and model._provider_use_responses_api(getattr(model, 'provider', ''))
    )

    for tool_def in agent_info.get("tools", []):
        if tool_def.get("type") != "function":
            continue
        # 兼容两种输入格式：OpenAI 嵌套格式 或 Responses API 扁平格式
        func = tool_def.get("function") or {}
        tool_name = func.get("name") or tool_def.get("name")
        description = func.get("description") or tool_def.get("description", "")
        parameters = func.get("parameters") or tool_def.get("parameters", {})
        if not tool_name:
            continue

        # 按 provider 要求选择正确格式，与 _parse_tools 保持一致
        if use_responses_api:
            formatted = {
                "type": "function",
                "name": tool_name,
                "description": description,
                "parameters": parameters,
            }
        else:
            formatted = {
                "type": "function",
                "function": {
                    "name": tool_name,
                    "description": description,
                    "parameters": parameters,
                },
            }

        # 注入工具定义（前置，避免在 selectTools 目录提示中被截断）
        if isinstance(model.tools, list):
            model.tools.insert(0, formatted)
        else:
            model.tools = [formatted]

        # 注入执行处理器：尝试走 agent_tunnel_socket 执行，否则回退
        def _make_handler(name: str, uname: str):
            def _handler(args: dict) -> str:
                from agent_tunnel import is_agent_online, call_local_tool_sync
                
                # WebSocket 优先
                if is_agent_online(uname):
                    try:
                        result = call_local_tool_sync(uname, name, args, timeout_sec=120)
                        if result and "error" in result and not result.get("success", True):
                            return f"本地工具 WSS 执行失败: {result['error']}"
                        r = result.get("result", result)
                        return r if isinstance(r, str) else json.dumps(r, ensure_ascii=False)
                    except Exception as e:
                        return f"本地工具 WSS 通信异常: {e}"

                # 回退：长轮询模式
                conv_id = str(getattr(model, 'conversation_id', '') or '')
                req_obj = enqueue_request(
                    username=uname,
                    conversation_id=conv_id,
                    request_type="local_tool",
                    payload={"tool": name, "params": args},
                    timeout_ms=120000,
                )
                result = wait_for_result(
                    username=uname,
                    conversation_id=conv_id,
                    request_id=req_obj["request_id"],
                    timeout_ms=120000,
                )
                if not result.get("success"):
                    return f"本地工具执行失败: {result.get('error', result.get('message', '超时'))}"
                r = result.get("result", result)
                return r if isinstance(r, str) else json.dumps(r, ensure_ascii=False)
            return _handler

        model.tool_executor.handlers[tool_name] = _make_handler(tool_name, username)


def _resolve_agent_info_for_user(username: str):
    from agent_tunnel import is_agent_online, get_agent_tools

    agent_info = None
    if is_agent_online(username):
        tools = get_agent_tools(username)
        if tools:
            agent_info = {"username": username, "tools": tools}

    if not agent_info:
        agent_token = request.cookies.get("nexoracode_agent", "").strip()
        agent_info = _LOCAL_AGENTS.get(agent_token) if agent_token else None
        if agent_info and agent_info.get("username") != username:
            agent_info = None
    return agent_info


def _flatten_model_function_tools(model) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()
    for item in (getattr(model, 'tools', None) or []):
        if not isinstance(item, dict):
            continue
        func = item.get("function") if isinstance(item.get("function"), dict) else None
        name = str((func or {}).get("name") or item.get("name") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        description = str((func or {}).get("description") or item.get("description") or "").strip()
        parameters = (func or {}).get("parameters") if func else item.get("parameters")
        if not isinstance(parameters, dict):
            parameters = {}
        out.append({
            "name": name,
            "description": description,
            "parameters": parameters,
        })
    return out


@app.route('/api/debug/tools/catalog', methods=['GET'])
@require_login
def debug_tools_catalog():
    username = session['username']
    model_name = (request.args.get('model_name') or '').strip() or None
    conversation_id = (request.args.get('conversation_id') or '').strip() or None
    try:
        model = Model(
            username,
            model_name=model_name,
            conversation_id=conversation_id,
            auto_create=False
        )
        agent_info = _resolve_agent_info_for_user(username)
        if agent_info:
            _inject_local_agent_tools(model, agent_info)
        tools = _flatten_model_function_tools(model)
        return jsonify({
            'success': True,
            'tools': tools,
            'model_name': model.model_name,
            'conversation_id': conversation_id,
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/debug/tools/execute', methods=['POST'])
@require_login
def debug_tools_execute():
    username = session['username']
    data = request.get_json(silent=True) or {}
    model_name = str(data.get('model_name') or '').strip() or None
    conversation_id = str(data.get('conversation_id') or '').strip() or None
    tool_name = str(data.get('tool_name') or '').strip()
    args = data.get('args')
    if not tool_name:
        return jsonify({'success': False, 'message': 'tool_name 不能为空'}), 400
    if args is None:
        args = {}
    if not isinstance(args, dict):
        return jsonify({'success': False, 'message': 'args 必须是 JSON object'}), 400
    try:
        model = Model(
            username,
            model_name=model_name,
            conversation_id=conversation_id,
            auto_create=False
        )
        agent_info = _resolve_agent_info_for_user(username)
        if agent_info:
            _inject_local_agent_tools(model, agent_info)
        if tool_name not in (model.tool_executor.handlers or {}):
            return jsonify({'success': False, 'message': f'工具不存在: {tool_name}'}), 404
        raw_result = model._execute_function_impl(tool_name, args)
        parsed_result = None
        if isinstance(raw_result, str):
            try:
                parsed_result = json.loads(raw_result)
            except Exception:
                parsed_result = None
        else:
            parsed_result = raw_result
        return jsonify({
            'success': True,
            'tool_name': tool_name,
            'model_name': model.model_name,
            'conversation_id': conversation_id,
            'result': raw_result,
            'parsed_result': parsed_result,
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/local_agent/register', methods=['POST'])
@require_login
def local_agent_register():
    """NexoraCode 通过 WebView JS 注册本地工具（借助已有 session 完成身份验证）"""
    data = request.get_json(silent=True) or {}
    token = str(data.get("token") or "").strip()
    callback_url = str(data.get("callback_url") or "").strip()
    tools = data.get("tools")

    if not token or not callback_url or not isinstance(tools, list):
        return jsonify({"success": False, "message": "token, callback_url, tools 均为必填"}), 400

    # 安全限制：callback_url 只允许 localhost
    parsed = urllib_parse.urlsplit(callback_url)
    if parsed.hostname not in ("localhost", "127.0.0.1"):
        return jsonify({"success": False, "message": "callback_url 只允许指向 localhost"}), 400

    username = session["username"]
    _LOCAL_AGENTS[token] = {
        "token": token,
        "callback_url": callback_url,
        "tools": tools,
        "username": username,
        "registered_at": int(time.time()),
    }
    registered_tools = []
    for t in tools:
        if str((t or {}).get("type", "")).strip() != "function":
            continue
        func = (t or {}).get("function")
        if isinstance(func, dict):
            name = str(func.get("name") or "").strip()
        else:
            name = str((t or {}).get("name") or "").strip()
        if name:
            registered_tools.append(name)
    return jsonify({"success": True, "registered_tools": registered_tools})


@app.route('/api/local_agent/unregister', methods=['POST'])
@require_login
def local_agent_unregister():
    """NexoraCode 关闭时注销本地工具"""
    data = request.get_json(silent=True) or {}
    token = str(data.get("token") or "").strip()
    username = session["username"]

    agent = _LOCAL_AGENTS.get(token)
    if agent and agent.get("username") == username:
        del _LOCAL_AGENTS[token]
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "未找到对应注册记录"}), 404


@app.route('/api/local_agent/pull', methods=['POST'])
def local_agent_pull():
    """NexoraCode 长轮询：取出属于当前用户的下一个 local_tool 执行请求"""
    data = request.get_json(silent=True) or {}
    wait_ms = int(data.get("wait_ms", 10000))
    agent_token = str(
        request.headers.get('X-NexoraCode-Agent')
        or data.get('agent_token')
        or request.cookies.get('nexoracode_agent')
        or ''
    ).strip()
    agent_info = _LOCAL_AGENTS.get(agent_token) if agent_token else None
    if not agent_info:
        return jsonify({"success": False, "message": "invalid agent token"}), 401
    username = str(agent_info.get("username") or "").strip()
    if not username:
        return jsonify({"success": False, "message": "invalid agent user"}), 401

    req = pull_local_tool_request(username=username, wait_ms=wait_ms)
    return jsonify({"success": True, "request": req})


@app.route('/api/tokens/stats', methods=['GET'])
@require_login
def get_token_stats():
    """获取Token使用统计"""
    username = session['username']
    user = User(username)
    
    try:
        logs = user.get_token_logs()
        conversation_id = (request.args.get('conversation_id') or '').strip()
        if conversation_id:
            logs = [log for log in logs if str(log.get('conversation_id', '')) == conversation_id]

        def _safe_int(v):
            try:
                if v is None:
                    return 0
                if isinstance(v, bool):
                    return int(v)
                if isinstance(v, (int, float)):
                    return int(v)
                s = str(v).strip()
                if not s:
                    return 0
                if s.isdigit() or (s.startswith('-') and s[1:].isdigit()):
                    return int(s)
                return int(float(s))
            except Exception:
                return 0

        # 优先：当指定 conversation_id 时，使用对话消息中的 metadata.io_tokens 聚合。
        # 这样可与前端 model-badge 保持一致（按单次 assistant 响应统计）。
        if conversation_id:
            try:
                manager = ConversationManager(username)
                convo = manager.get_conversation(conversation_id)
                messages = convo.get('messages', []) if isinstance(convo, dict) else []
                io_input_total = 0
                io_output_total = 0
                io_today_total = 0
                io_found = False
                today_str = time.strftime("%Y-%m-%d", time.localtime())

                for msg in messages:
                    if not isinstance(msg, dict):
                        continue
                    if str(msg.get('role', '') or '').strip() != 'assistant':
                        continue
                    md = msg.get('metadata', {})
                    if not isinstance(md, dict):
                        continue
                    io_tokens = md.get('io_tokens', {})
                    if not isinstance(io_tokens, dict):
                        continue
                    in_tok = _safe_int(io_tokens.get('input', 0))
                    out_tok = _safe_int(io_tokens.get('output', 0))
                    if in_tok <= 0 and out_tok <= 0:
                        continue
                    io_found = True
                    io_input_total += in_tok
                    io_output_total += out_tok

                    ts = str(msg.get('timestamp', '') or '')
                    if ts.startswith(today_str):
                        io_today_total += (in_tok + out_tok)

                if io_found:
                    # history 仍返回 token 日志最近记录，便于排查
                    return jsonify({
                        'success': True,
                        'conversation_id': conversation_id,
                        'input_total': io_input_total,
                        'output_total': io_output_total,
                        'total': io_input_total + io_output_total,
                        'today': io_today_total,
                        'history': logs[:20]
                    })
            except Exception:
                # 回退到旧日志聚合逻辑
                pass

        input_total = 0
        output_total = 0
        total_tokens = 0
        today_tokens = 0
        
        # Calculate stats
        today_str = time.strftime("%Y-%m-%d", time.localtime())
        
        for log in logs:
            in_tokens = _safe_int(log.get('input_tokens', 0))
            out_tokens = _safe_int(log.get('output_tokens', 0))
            log_total = _safe_int(log.get('total_tokens', 0))
            if log_total <= 0:
                log_total = in_tokens + out_tokens

            input_total += in_tokens
            output_total += out_tokens
            total_tokens += log_total

            if log.get('timestamp', '').startswith(today_str):
                today_tokens += log_total
                
        return jsonify({
            'success': True,
            'conversation_id': conversation_id or None,
            'input_total': input_total,
            'output_total': output_total,
            'total': total_tokens,
            'today': today_tokens,
            'history': logs[:20]  # Optional: return recent logs if needed
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


# ==================== 知识库相关 ====================

@app.route('/knowledge')
def knowledge():
    """知识库页面"""
    if 'username' not in session:
        return redirect(url_for('login'))
    return render_template('knowledge.html', username=session['username'])


@app.route('/api/knowledge/list', methods=['GET'])
@require_login
def list_knowledge():
    """获取知识库列表"""
    username = session['username']
    user = User(username)
    
    try:
        # 获取短期记忆和基础知识
        short_memory = user.getKnowledgeList(0)  # 短期记忆
        basis_knowledge_raw = user.getKnowledgeList(1)  # 基础知识

        # 兼容旧数据：统一为 {title: meta_dict}
        basis_knowledge = {}
        if isinstance(basis_knowledge_raw, dict):
            for title, meta in basis_knowledge_raw.items():
                if isinstance(meta, dict):
                    basis_knowledge[str(title)] = dict(meta)
                else:
                    basis_knowledge[str(title)] = {}
        elif isinstance(basis_knowledge_raw, list):
            for title in basis_knowledge_raw:
                t = str(title or '').strip()
                if t:
                    basis_knowledge[t] = {}

        # 增强：检测向量是否真实存在，防止外部删库后前端状态失真
        vector_titles = None
        store, _ = get_chroma_store()
        if store and getattr(store, 'mode', '') == 'service':
            try:
                vector_titles = set(store.list_titles(username, library='knowledge'))
            except Exception:
                vector_titles = None

        if vector_titles is not None:
            for title, meta in basis_knowledge.items():
                meta['vector_exists'] = title in vector_titles
                meta['pin'] = bool(meta.get('pin', False))
        else:
            for _, meta in basis_knowledge.items():
                if isinstance(meta, dict):
                    meta['pin'] = bool(meta.get('pin', False))
        
        return jsonify({
            'success': True,
            'short_memory': short_memory,
            'basis_knowledge': basis_knowledge
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/knowledge/basis', methods=['GET'])
@require_login
def get_all_basis():
    """获取所有基础知识"""
    username = session['username']
    user = User(username)
    
    try:
        knowledge_list = user.getKnowledgeList(1)  # 1表示基础知识
        result = []
        if isinstance(knowledge_list, dict):
            iterable = list(knowledge_list.items())
        else:
            iterable = [(title, {}) for title in knowledge_list]

        for title, meta in iterable:
            safe_title = str(title or '').strip()
            if not safe_title:
                continue
            content = user.getBasisContent(safe_title)
            result.append({
                'title': safe_title,
                'content': content,
                'pin': bool((meta or {}).get('pin', False)) if isinstance(meta, dict) else False
            })
        return jsonify({'success': True, 'knowledge': result})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/basis/update', methods=['POST'])
@require_login
def update_basis_content():
    """更新基础知识内容"""
    username = session['username']
    user = User(username)
    data = request.get_json()
    
    title = data.get('title')
    content = data.get('content')
    
    if not title:
        return jsonify({'success': False, 'message': '标题不能为空'})
        
    try:
        success, msg = user.updateBasisContent(title, content)
        return jsonify({'success': success, 'message': msg})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/knowledge/basis/<path:title>', methods=['GET'])
@require_login
def get_basis_content(title):
    """获取单个基础知识内容"""
    username = session['username']
    user = User(username)
    
    try:
        content = user.getBasisContent(title)
        return jsonify({
            'success': True, 
            'knowledge': {
                'title': title,
                'content': content
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/basis', methods=['POST'])
@require_login
def add_basis():
    """添加基础知识"""
    username = session['username']
    user = User(username)
    data = request.get_json()
    
    title = data.get('title')
    content = data.get('content')
    url = data.get('url', '')
    
    if not title or not content:
        return jsonify({'success': False, 'message': '标题和内容不能为空'})
    
    try:
        user.addBasis(title, content, url)
        return jsonify({'success': True, 'message': '添加成功'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/knowledge/basis/<path:title>', methods=['PUT'])
@require_login
def update_basis(title):
    """更新基础知识"""
    username = session['username']
    user = User(username)
    data = request.get_json()
    
    new_title = data.get('title')
    content = data.get('content')
    url = data.get('url', '')
    
    if not new_title or not content:
        return jsonify({'success': False, 'error': '标题和内容不能为空'})
    
    try:
        # 如果标题改变了，先删除旧的
        if title != new_title:
            user.removeBasis(title)
        user.addBasis(new_title, content, url)
        return jsonify({'success': True, 'message': '更新成功'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/basis/<path:title>', methods=['DELETE'])
@require_login
def delete_basis(title):
    """删除基础知识"""
    username = session['username']
    user = User(username)
    
    try:
        user.removeBasis(title)
        return jsonify({'success': True, 'message': '删除成功'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/knowledge/basis/<path:title>/pin', methods=['POST'])
@require_login
def set_basis_pin(title):
    """设置基础知识置顶状态"""
    username = session['username']
    user = User(username)
    data = request.get_json(silent=True) or {}
    pin = bool(data.get('pin', True))
    try:
        success, msg = user.setBasisPin(title, pin=pin)
        if not success:
            return jsonify({'success': False, 'message': msg}), 400
        return jsonify({'success': True, 'title': title, 'pin': pin, 'message': msg})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/knowledge/settings', methods=['POST'])
@require_login
def update_knowledge_settings():
    """更新知识点设置（标题、公开、协作）"""
    username = session['username']
    data = request.get_json()
    title = data.get('title')
    new_title = data.get('new_title')
    is_public = data.get('public')
    is_collaborative = data.get('collaborative')
    
    user = User(username)
    success, msg = user.updateBasisSettings(title, new_title, is_public, is_collaborative)
    
    if success:
        # 如果获取了新标题或状态，返回新的 share_url
        meta = user.getBasisMetadata(new_title or title)
        share_id = meta.get('share_id', '')
        base_url = get_public_base_url()
        share_url = f"{base_url}/public/knowledge/{username}/{share_id}"
        return jsonify({'success': True, 'message': msg, 'share_url': share_url})
    return jsonify({'success': False, 'message': msg})

@app.route('/api/knowledge/basis/<path:title>/share', methods=['POST'])
@require_login
def share_basis(title):
    """切换知识点公开状态"""
    username = session['username']
    user = User(username)
    data = request.get_json()
    is_public = data.get('public', False)
    
    success, msg = user.setBasisPublic(title, is_public)
    if success:
        meta = user.getBasisMetadata(title)
        share_id = meta.get('share_id', '')
        # 生成公开访问地址
        base_url = get_public_base_url()
        share_url = f"{base_url}/public/knowledge/{username}/{share_id}"
        return jsonify({'success': True, 'message': msg, 'share_url': share_url})
    return jsonify({'success': False, 'message': msg})

# ==================== 公开访问页面 (无需登录) ====================

@app.route('/public/knowledge/<username>/<share_id>', methods=['GET'])
def public_view_knowledge(username, share_id):
    """公开查看知识点"""
    user = User(username)
    title, meta = user.getBasisByShareId(share_id)
    if not meta or not meta.get("public"):
        return "该知识点未公开或不存在", 403
        
    content = user.getBasisContent(title)
    # 如果允许协作，则进入协作编辑器，否则只读渲染
    if meta.get("collaborative"):
        return render_template('knowledge_public_edit.html', 
                               username=username, 
                               title=title, 
                               share_id=share_id,
                               content=content)
    else:
        return render_template('knowledge_public_view.html', 
                               username=username, 
                               title=title, 
                               content=content)

@app.route('/api/public/knowledge/<username>/<share_id>', methods=['GET'])
def public_api_get_knowledge(username, share_id):
    """公开 API 获取知识点内容"""
    user = User(username)
    title, meta = user.getBasisByShareId(share_id)
    if not meta or not meta.get("public"):
        return jsonify({'success': False, 'message': 'Forbidden'}), 403
        
    content = user.getBasisContent(title)
    return jsonify({
        'success': True,
        'title': title,
        'content': content,
        'username': username,
        'collaborative': meta.get("collaborative", False)
    })

@app.route('/api/public/knowledge/<username>/<share_id>', methods=['PUT', 'POST'])
def public_api_edit_knowledge(username, share_id):
    """公开编辑知识点（如果已公开且允许协作则允许）"""
    user = User(username)
    title, meta = user.getBasisByShareId(share_id)
    if not meta or not meta.get("public") or not meta.get("collaborative"):
        return jsonify({'success': False, 'message': 'Forbidden'}), 403
        
    data = request.get_json()
    content = data.get('content')
    
    if not content:
        return jsonify({'success': False, 'message': '内容不能为空'})
        
    success, msg = user.updateBasisContent(title, content)
    return jsonify({'success': success, 'message': msg})


@app.route('/api/knowledge/short', methods=['GET'])
@require_login
def get_all_short():
    """获取所有短期记忆"""
    username = session['username']
    user = User(username)
    
    try:
        short_dict = user.getKnowledgeList(0)  # 0表示短期记忆，返回{ID: title}
        result = []
        for mem_id, title in short_dict.items():
            result.append({
                'id': mem_id,
                'title': title[:30] + '...' if len(title) > 30 else title,
                'content': title  # 完整内容
            })
        return jsonify({'success': True, 'memories': result})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/short/<path:title>', methods=['GET'])
@require_login
def get_short_content(title):
    """获取单个短期记忆"""
    username = session['username']
    user = User(username)
    
    try:
        short_list = user.getKnowledgeList(0)
        if title in short_list:
            return jsonify({
                'success': True,
                'memory': {
                    'title': title,
                    'content': title
                }
            })
        else:
            return jsonify({'success': False, 'error': '未找到该记忆'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/short', methods=['POST'])
@require_login
def add_short():
    """添加短期记忆"""
    username = session['username']
    user = User(username)
    data = request.get_json()
    
    title = data.get('title')
    content = data.get('content', title)  # 使用content字段，如果没有则使用title
    
    if not title:
        return jsonify({'success': False, 'error': '标题不能为空'})
    
    try:
        user.addShort(content if content else title)
        return jsonify({'success': True, 'message': '添加成功'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/short/<path:title>', methods=['PUT'])
@require_login
def update_short(title):
    """更新短期记忆"""
    username = session['username']
    user = User(username)
    data = request.get_json()
    
    new_title = data.get('title')
    content = data.get('content', new_title)
    
    print(f"[DEBUG] 更新短期记忆: {title} -> {new_title}, content: {content}")
    
    if not new_title:
        return jsonify({'success': False, 'error': '标题不能为空'})
    
    try:
        # 短期记忆存储为 {ID: title} 字典
        short_dict = user.getKnowledgeList(0)  # 返回字典
        print(f"[DEBUG] 当前短期记忆: {short_dict}")
        
        # 查找要更新的记忆ID
        mem_id = None
        for mid, mtitle in short_dict.items():
            if mtitle == title:
                mem_id = mid
                break
        
        if mem_id is None:
            print(f"[ERROR] 找不到短期记忆: {title}")
            return jsonify({'success': False, 'error': f'找不到短期记忆: {title}'})
        
        print(f"[DEBUG] 找到记忆ID: {mem_id}")
        
        # 删除旧记忆（通过索引）
        short_list = list(short_dict.keys())
        idx = short_list.index(mem_id)
        user.removeShort(idx)
        print(f"[DEBUG] 已删除旧记忆，索引: {idx}")
        
        # 添加新记忆
        user.addShort(content if content else new_title)
        print(f"[DEBUG] 已添加新记忆: {content if content else new_title}")
        
        return jsonify({'success': True, 'message': '更新成功'})
    except Exception as e:
        print(f"[ERROR] 更新短期记忆失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/short/<path:title>', methods=['DELETE'])
@require_login
def delete_short(title):
    """删除短期记忆"""
    username = session['username']
    user = User(username)
    
    try:
        short_data = user.getKnowledgeList(0)
        # 兼容字典返回：{id: title}
        if isinstance(short_data, dict):
            target_id = None
            for mem_id, mem_title in short_data.items():
                if str(mem_title) == str(title):
                    target_id = mem_id
                    break
            if target_id is None:
                return jsonify({'success': False, 'error': '未找到该记忆'})
            ordered_ids = list(short_data.keys())
            idx = ordered_ids.index(target_id)
            user.removeShort(idx)
            return jsonify({'success': True, 'message': '删除成功'})

        # 兼容列表返回
        if isinstance(short_data, list):
            idx = None
            for i, item in enumerate(short_data):
                if str(item) == str(title):
                    idx = i
                    break
            if idx is None:
                return jsonify({'success': False, 'error': '未找到该记忆'})
            user.removeShort(idx)
            return jsonify({'success': True, 'message': '删除成功'})

        return jsonify({'success': False, 'error': '短期记忆数据格式异常'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


# ==================== 知识图谱相关 ====================

@app.route('/knowledge_graph')
@require_login
def knowledge_graph():
    """知识图谱页面"""
    return render_template('knowledge_graph.html', username=session['username'])


@app.route('/token_logs')
@require_login
def token_logs():
    """Token记录页面"""
    return render_template('token_logs.html', username=session['username'])


@app.route('/api/knowledge/graph', methods=['GET'])
@require_login
def get_knowledge_graph():
    """获取知识图谱数据"""
    username = session['username']
    user = User(username)
    
    try:
        graph = user.get_knowledge_graph()
        
        # 获取所有基础知识
        all_basis = user.getKnowledgeList(1)  # 1表示基础知识
        
        # 收集所有已分类的知识ID
        categorized = set()
        for category in graph['categories'].values():
            categorized.update(category['knowledge_ids'])
        
        # 将未分类的知识添加到"未分类"分类中
        uncategorized = [k for k in all_basis.keys() if k not in categorized]
        if uncategorized:
            if '未分类' not in graph['categories']:
                graph['categories']['未分类'] = {
                    'name': '未分类',
                    'color': '#9ca3af',
                    'knowledge_ids': [],
                    'position': {'x': 100, 'y': 100}
                }
            # 过滤重复
            current_ids = set(graph['categories']['未分类']['knowledge_ids'])
            for uk in uncategorized:
                if uk not in current_ids:
                    graph['categories']['未分类']['knowledge_ids'].append(uk)
        
        return jsonify({'success': True, 'categories': graph['categories'], 'connections': graph['connections']})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/knowledge/graph/positions', methods=['POST'])
@require_login
def save_knowledge_graph_positions():
    """保存知识图谱节点/分类位置"""
    username = session['username']
    user = User(username)
    data = request.get_json()
    
    try:
        graph = user.get_knowledge_graph()
        # 更新全部分类位置
        for cat_name, pos in data.items():
            if cat_name in graph['categories']:
                graph['categories'][cat_name]['position'] = pos
        
        user.save_knowledge_graph(graph)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/categories', methods=['POST'])
@require_login
def create_category():
    """创建知识分类"""
    username = session['username']
    user = User(username)
    data = request.get_json()
    
    name = data.get('name')
    color = data.get('color', '#667eea')
    
    if not name:
        return jsonify({'success': False, 'error': '分类名称不能为空'})
    
    try:
        success, message = user.create_category(name, color)
        return jsonify({'success': success, 'message': message})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/categories/<category_name>', methods=['DELETE'])
@require_login
def delete_category_route(category_name):
    """删除分类"""
    username = session['username']
    user = User(username)
    
    try:
        success, message = user.delete_category(category_name)
        return jsonify({'success': success, 'message': message})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/categories/<category_name>', methods=['PUT'])
@require_login
def update_category_route(category_name):
    """更新分类"""
    username = session['username']
    user = User(username)
    data = request.get_json()
    
    new_name = data.get('name')
    color = data.get('color')
    
    if not new_name:
        return jsonify({'success': False, 'error': '分类名称不能为空'})
    
    try:
        success, message = user.update_category(category_name, new_name, color)
        return jsonify({'success': success, 'message': message})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/move', methods=['POST'])
@require_login
def move_knowledge():
    """移动知识到分类"""
    username = session['username']
    user = User(username)
    data = request.get_json()
    
    knowledge = data.get('knowledge')
    category = data.get('category')
    
    if not knowledge or not category:
        return jsonify({'success': False, 'error': '参数错误'})
    
    try:
        success, message = user.move_knowledge_to_category(knowledge, category)
        return jsonify({'success': success, 'message': message})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/connections', methods=['POST'])
@require_login
def add_connection():
    """添加知识连接"""
    username = session['username']
    user = User(username)
    data = request.get_json()
    
    from_knowledge = data.get('from')
    to_knowledge = data.get('to')
    relation_type = data.get('type', '关联')
    description = data.get('description', '')
    
    if not from_knowledge or not to_knowledge:
        return jsonify({'success': False, 'error': '参数错误'})
    
    try:
        success, message = user.add_connection(from_knowledge, to_knowledge, relation_type, description)
        return jsonify({'success': success, 'message': message})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/connections/<connection_id>', methods=['DELETE'])
@require_login
def delete_connection(connection_id):
    """删除知识连接"""
    username = session['username']
    user = User(username)
    
    try:
        success, message = user.remove_connection(connection_id)
        return jsonify({'success': success, 'message': message})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/graph/positions', methods=['PUT'])
@require_login
def update_positions():
    """更新分类位置"""
    username = session['username']
    user = User(username)
    data = request.get_json()
    
    category = data.get('category')
    position = data.get('position')
    
    if not category or not position:
        return jsonify({'success': False, 'error': '参数不完整'})
    
    try:
        graph = user.get_knowledge_graph()
        if category in graph['categories']:
            graph['categories'][category]['position'] = position
        user.save_knowledge_graph(graph)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/nodes/positions', methods=['PUT'])
@require_login
def update_knowledge_position():
    """更新知识节点位置"""
    username = session['username']
    user = User(username)
    data = request.get_json()
    
    title = data.get('title')
    position = data.get('position')
    
    if not title or not position:
        return jsonify({'success': False, 'error': '参数不完整'})
    
    try:
        graph = user.get_knowledge_graph()
        if 'knowledge_nodes' not in graph:
            graph['knowledge_nodes'] = {}
        
        # 保留category信息
        if title in graph['knowledge_nodes']:
            graph['knowledge_nodes'][title]['x'] = position['x']
            graph['knowledge_nodes'][title]['y'] = position['y']
        else:
            # 查找知识所属分类
            category = None
            for cat_name, cat_data in graph['categories'].items():
                if title in cat_data['knowledge_ids']:
                    category = cat_name
                    break
            graph['knowledge_nodes'][title] = {
                'x': position['x'],
                'y': position['y'],
                'category': category
            }
        
        user.save_knowledge_graph(graph)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/ai/organize', methods=['POST'])
@require_login
def ai_organize():
    """AI自动整理知识库"""
    username = session['username']
    model = Model(username, auto_create=False)
    user = User(username)
    
    try:
        # 获取所有知识
        basis_list = user.getKnowledgeList(1)
        short_list = user.getKnowledgeList(0)
        
        # 构建提示词让AI分析
        all_knowledge = []
        for title in basis_list.keys():
            content = user.getBasisContent(title)
            all_knowledge.append(f"【{title}】\n{content[:300]}...")
        
        prompt = f"""分析以下知识库内容，构建更符合人类认知脉络的知识图谱。
1. 分类方案：将知识点归纳到3-5个主要领域。
2. 关系脉络：识别知识点之间的演化、推导、依赖或提及关系。

知识列表：
{chr(10).join(all_knowledge)}

请以JSON格式返回：
{{
    "categories": [
        {{"name": "分类名", "color": "#颜色代码", "knowledge": ["知识标题1", "知识标题2"]}}
    ],
    "nodes": [
        {{"title": "知识标题", "summary": "一句话核心脉络"}}
    ],
    "connections": [
        {{"from": "知识标题A", "to": "知识标题B", "type": "脉络/提及/依赖/属于", "description": "简短描述关系"}}
    ]
}}"""
        

        # 调用AI模型
        response_content = ""
        # 使用流式接口同步获取
        for chunk in model.sendMessage(prompt, stream=False, enable_tools=False):
            if isinstance(chunk, dict):
                 if chunk.get('type') == 'content_delta':
                     response_content += chunk.get('content', '')
                 elif chunk.get('type') == 'done':
                     if not response_content and chunk.get('content'):
                         response_content = chunk.get('content')
            elif hasattr(chunk, 'content'):
                response_content += chunk.content
        
        print(f"[DEBUG] AI整理响应: {response_content[:100]}...")

        # 尝试解析JSON
        try:
            # 找到JSON部分
            start = response_content.find('{')
            end = response_content.rfind('}') + 1
            if start != -1 and end != -1:
                json_str = response_content[start:end]
                result = json.loads(json_str)
                
                # 更新分类
                if 'categories' in result:
                    # 获取当前图谱
                    graph = user.get_knowledge_graph()
                    
                    # 记录旧的分类和位置，以便保留
                    old_categories = graph.get('categories', {})
                    
                    # 清空当前分类（除了未分类）
                    graph['categories'] = {}
                    if '未分类' in old_categories:
                        graph['categories']['未分类'] = old_categories['未分类']
                        graph['categories']['未分类']['knowledge_ids'] = [] # 清空内容，重新分配

                    # 重新构建分类
                    for i, cat in enumerate(result['categories']):
                        name = cat['name']
                        color = cat.get('color', '#667eea')
                        knowledge = cat.get('knowledge', [])
                        
                        # 先给个默认位置，稍后统一布局
                        graph['categories'][name] = {
                            'name': name,
                            'color': color,
                            'knowledge_ids': knowledge,
                            'position': {'x': 0, 'y': 0} 
                        }
                    
                    # 3. 处理知识连接
                    if 'connections' in result:
                        for conn in result['connections']:
                            from_k = conn.get('from')
                            to_k = conn.get('to')
                            # 验证知识点是否存在
                            if from_k in basis_list and to_k in basis_list:
                                # 检查是否重复
                                exists = False
                                for old_conn in graph['connections']:
                                    if old_conn['from'] == from_k and old_conn['to'] == to_k:
                                        exists = True
                                        break
                                if not exists:
                                    graph['connections'].append({
                                        "id": f"{from_k}-{to_k}-{int(time.time())}",
                                        "from": from_k,
                                        "to": to_k,
                                        "type": conn.get('type', '脉络'),
                                        "description": conn.get('description', 'AI自动脉络识别'),
                                        "created_at": time.time()
                                    })

                    # 应用自动布局
                    _apply_auto_layout(graph)
                    
                    user.save_knowledge_graph(graph)
                    return jsonify({'success': True, 'message': '整理完成'})
                    
        except Exception as e:
            print(f"[ERROR] 解析AI响应失败: {e}")
                
    except Exception as e:
        print(f"[ERROR] AI整理失败: {e}")
        return jsonify({'success': False, 'message': str(e)})
        
    return jsonify({'success': True, 'message': 'AI整理完成'})

@app.route('/api/knowledge/ai/scan', methods=['POST'])
@require_login
def ai_scan_links():
    """批量扫描所有知识点并建立自动连接"""
    username = session['username']
    user = User(username)
    
    try:
        basis_list = user.getKnowledgeList(1)
        count = 0
        for title in basis_list.keys():
            if user.auto_link_knowledge(title):
                count += 1
        return jsonify({'success': True, 'message': f'扫描完成，更新了 {count} 个连接'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/knowledge/layout', methods=['POST'])
@require_login
def auto_layout():
    """纯自动布局接口"""
    username = session['username']
    user = User(username)
    
    try:
        graph = user.get_knowledge_graph()
        _apply_auto_layout(graph)
        user.save_knowledge_graph(graph)
        return jsonify({'success': True, 'message': '布局完成'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

def _apply_auto_layout(graph):
    """应用圆形布局算法"""
    import math
    import random
    
    center_x, center_y = 600, 400
    radius = 360 # 增大分类圆环半径
    
    categories = graph.get('categories', {})
    cat_names = list(categories.keys())
    cat_count = len(cat_names)
    
    for i, name in enumerate(cat_names):
        cat = categories[name]
        
        # 计算分类位置
        if cat_count > 0:
            angle = (2 * math.pi / cat_count) * i
            x = center_x + radius * math.cos(angle)
            y = center_y + radius * math.sin(angle)
        else:
            x, y = center_x, center_y
            
        cat['position'] = {'x': x, 'y': y}
        
        # 计算子节点位置
        knowledge_ids = cat.get('knowledge_ids', [])
        node_radius = 160 # 增大节点分散半径
        node_count = len(knowledge_ids)
        
        if 'knowledge_nodes' not in graph:
            graph['knowledge_nodes'] = {}
            
        for j, k_title in enumerate(knowledge_ids):
            # 改进：按照行列式排列，体现脉络感
            col = j % 4
            row = j // 4
            n_x = x + (col * 200) - 300
            n_y = y + (row * 150) - 100
            
            graph['knowledge_nodes'][k_title] = {
                'x': n_x, 
                'y': n_y,
                'category': name
            }



@app.route('/api/knowledge/ai/index', methods=['POST'])
@require_login
def ai_generate_index():
    """AI生成分类索引"""
    username = session['username']
    user = User(username)
    data = request.get_json()
    
    category = data.get('category')
    
    if not category:
        return jsonify({'success': False, 'error': '未指定分类'})
    
    try:
        from api.model import Model
        
        graph = user.get_knowledge_graph()
        if category not in graph['categories']:
            return jsonify({'success': False, 'error': '分类不存在'})
        
        knowledge_ids = graph['categories'][category]['knowledge_ids']
        
        if not knowledge_ids:
            return jsonify({'success': False, 'error': '该分类下没有知识'})
        
        # 构建知识标题列表
        titles_text = "\n".join([f"- {title}" for title in knowledge_ids])
        
        prompt = f"""请为【{category}】分类生成一个简洁的知识索引。

该分类包含以下知识：
{titles_text}

请生成：
1. 该分类的整体概述（1-2句话）
2. 知识点之间的关联和主题分布
3. 使用Markdown格式输出，简洁明了"""
        
        # 调用AI模型
        model = Model(username, auto_create=False)
        index_content = ""
        for chunk in model.sendMessage(prompt, stream=False):
            if chunk.get('type') == 'text':
                index_content += chunk.get('content', '')
        
        return jsonify({'success': True, 'index': index_content})
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/knowledge/vectorize', methods=['POST'])
@require_login
def vectorize_knowledge():
    # Vectorize and store (server-side auto chunking)
    username = session['username']
    user = User(username)
    data = request.get_json() or {}

    title = data.get('title')
    text = data.get('text')
    metadata = data.get('metadata') or {}
    library = _normalize_vector_library(data.get('library'), default='knowledge')

    if not text:
        # If text is missing, try to load from knowledge base
        if title:
            text = user.getBasisContent(title)
        else:
            return jsonify({'success': False, 'message': '文本为空'})

    try:
        ok, err, doc_ids = _vectorize_text_to_store(
            username,
            title,
            text,
            metadata=metadata,
            library=library,
            clear_existing=True
        )
        if not ok:
            return jsonify({'success': False, 'message': err or '向量化失败'})

        return jsonify({
            'success': True, 
            'chunk_count': len(doc_ids),
            'stored': True,
            'stored_count': len(doc_ids),
            'vector_length': 0,
            'vector_preview': [],
            'vector_ids': doc_ids,
            'library': library,
            'store_error': None,
            'message': '向量化成功'
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'向量化失败: {str(e)}'})

@app.route('/api/knowledge/vector/config', methods=['GET'])
@require_login
def get_vector_config():
    """获取向量配置"""
    config = get_config_all()
    rag = config.get('rag_database', {})
    return jsonify({
        'success': True,
        'chunk_size': int(rag.get('chunk_size') or 800),
        'chunk_overlap': int(rag.get('chunk_overlap') or 120)
    })


@app.route('/api/knowledge/vectorize/chunk', methods=['POST'])
@require_login
def vectorize_knowledge_chunk():
    """分块向量化知识"""
    username = session['username']
    data = request.get_json() or {}
    title = data.get('title')
    text = data.get('text')
    chunk_id = data.get('chunk_id')
    metadata = data.get('metadata') or {}
    chunk_total = data.get('chunk_total')
    library = _normalize_vector_library(data.get('library'), default='knowledge')

    if not title or text is None:
        return jsonify({'success': False, 'message': '缺少标题或文本'})

    store, store_err = get_chroma_store()
    if not store:
        return jsonify({'success': False, 'message': f'ChromaDB错误: {store_err}'})
    if getattr(store, 'mode', '') != 'service':
        return jsonify({'success': False, 'message': 'NexoraDB service mode required'})

    try:
        chunk_meta = dict(metadata)
        if chunk_id is not None:
            chunk_meta['chunk_id'] = chunk_id
        if chunk_total is not None:
            chunk_meta['chunk_total'] = chunk_total
        doc_id = store.upsert_text(
            username,
            title,
            text,
            chunk_meta,
            chunk_id=chunk_id,
            library=library
        )
        return jsonify({'success': True, 'vector_id': doc_id})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})




@app.route('/api/knowledge/query', methods=['POST'])
@require_login
def query_knowledge_vectors():
    """查询知识向量(ChromaDB)"""
    username = session['username']
    data = request.get_json() or {}
    query_text = data.get('text') or data.get('query')
    top_k = int(data.get('top_k') or 5)
    library = _normalize_vector_library(data.get('library'), default='knowledge')
    
    if not query_text:
        return jsonify({'success': False, 'message': '缺少查询文本'})

    def _keyword_fallback_payload(reason):
        try:
            user = User(username)
            basis = user.getKnowledgeList(1) or {}
            q = str(query_text).strip().lower()
            if not q:
                return {
                    'success': True,
                    'fallback': True,
                    'fallback_reason': reason,
                    'result': {
                        'documents': [[]],
                        'metadatas': [[]],
                        'distances': [[]]
                    }
                }

            scored = []
            for title in basis.keys():
                title_text = str(title or '')
                title_lower = title_text.lower()
                title_hits = title_lower.count(q)
                content = ''
                try:
                    content = user.getBasisContent(title) or ''
                except Exception:
                    content = ''
                content_lower = content.lower()
                content_hits = content_lower.count(q)

                if title_hits <= 0 and content_hits <= 0:
                    continue

                score = title_hits * 3 + content_hits
                snippet = content[:500] if content else title_text
                scored.append({
                    'title': title_text,
                    'doc': snippet,
                    'score': score
                })

            scored.sort(key=lambda x: x['score'], reverse=True)
            scored = scored[:max(1, top_k)]

            documents = [item['doc'] for item in scored]
            metadatas = [{
                'title': item['title'],
                'source': 'keyword_fallback'
            } for item in scored]
            # Keep distance contract: smaller means better.
            distances = [round(1.0 / (1.0 + float(item['score'])), 6) for item in scored]

            return {
                'success': True,
                'fallback': True,
                'fallback_reason': reason,
                'result': {
                    'documents': [documents],
                    'metadatas': [metadatas],
                    'distances': [distances]
                }
            }
        except Exception as fallback_err:
            return {
                'success': False,
                'message': f'关键词回退失败: {str(fallback_err)}'
            }

    store, store_err = get_chroma_store()
    if not store:
        return jsonify(_keyword_fallback_payload(f'NexoraDB unavailable: {store_err}'))

    try:
        if getattr(store, 'mode', '') != 'service':
            return jsonify(_keyword_fallback_payload('NexoraDB service mode not available'))
        result = store.query_text(
            username,
            query_text,
            top_k=top_k,
            library=library
        )
        return jsonify({'success': True, 'result': result})
    except Exception as e:
        return jsonify(_keyword_fallback_payload(f'NexoraDB query failed: {str(e)}'))


@app.route('/api/files/vector/query', methods=['POST'])
@require_login
def query_temp_file_vectors():
    """查询临时文件库向量（library=temp_file）。默认全库检索，file_alias 可选用于单文件筛选。"""
    username = session['username']
    data = request.get_json() or {}
    query_text = data.get('text') or data.get('query')
    file_alias = str(data.get('file_alias') or data.get('alias') or '').strip()
    if file_alias.lower() in {'*', 'all', '全部'}:
        file_alias = ''
    top_k = int(data.get('top_k') or 5)

    if not query_text:
        return jsonify({'success': False, 'message': '缺少查询文本'})

    where = _build_temp_file_where(username, file_alias) if file_alias else None

    store, store_err = get_chroma_store()
    if not store:
        return jsonify({'success': False, 'message': f'NexoraDB unavailable: {store_err}'})
    if getattr(store, 'mode', '') != 'service':
        return jsonify({'success': False, 'message': 'NexoraDB service mode not available'})

    try:
        result = store.query_text(
            username,
            query_text,
            top_k=top_k,
            library='temp_file',
            where=where
        )
        # 兼容：老数据/路径参数导致 where 未命中时，自动宽查询后按文件再过滤一次
        if file_alias and _is_query_result_empty(result):
            fallback_top_k = min(max(int(top_k) * 6, int(top_k)), 60)
            broad = store.query_text(
                username,
                query_text,
                top_k=fallback_top_k,
                library='temp_file',
                where=None
            )
            result = _filter_temp_file_query_result(broad, username, file_alias, top_k=top_k)
        return jsonify({
            'success': True,
            'library': 'temp_file',
            'file_alias': file_alias,
            'result': result
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/knowledge/vector/delete', methods=['POST'])
@require_login
def delete_knowledge_vectors():
    """删除知识点的向量数据"""
    username = session['username']
    data = request.get_json() or {}
    title = data.get('title')
    vector_id = data.get('vector_id')
    library = _normalize_vector_library(data.get('library'), default='knowledge')
    if not title and not vector_id:
        return jsonify({'success': False, 'message': '缺少标题或向量ID'})

    store, store_err = get_chroma_store()
    if not store:
        return jsonify({'success': False, 'message': f'ChromaDB错误: {store_err}'})
    try:
        if vector_id:
            store.delete_by_id(username, vector_id)
        else:
            store.delete_by_title(username, title, library=library)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/knowledge/vector/chunks', methods=['POST'])
@require_login
def get_vector_chunks():
    """Get vector chunks for a knowledge item"""
    username = session['username']
    data = request.get_json() or {}
    title = data.get('title')
    library = _normalize_vector_library(data.get('library'), default='knowledge')
    if not title:
        return jsonify_safe({'success': False, 'message': 'missing title'})

    store, store_err = get_chroma_store()
    if not store:
        return jsonify_safe({'success': False, 'message': f'ChromaDB unavailable: {store_err}'})
    try:
        chunks = store.get_chunks(username, title, library=library)
        return jsonify_safe({'success': True, 'library': library, 'chunks': chunks})
    except Exception as e:
        return jsonify_safe({'success': False, 'message': str(e)})


@app.route('/api/knowledge/vector/mark', methods=['POST'])
@require_login
def mark_vector_updated():
    """Mark knowledge vectorization time"""
    username = session['username']
    data = request.get_json() or {}
    title = data.get('title')
    if not title:
        return jsonify_safe({'success': False, 'message': 'missing title'})
    try:
        user = User(username)
        success, msg = user.updateBasisVectorTime(title)
        if not success:
            return jsonify_safe({'success': False, 'message': msg})
        return jsonify_safe({'success': True})
    except Exception as e:
        return jsonify_safe({'success': False, 'message': str(e)})


@app.route('/api/token_logs', methods=['GET'])
@require_login
def get_token_logs():
    """获取Token统计日志"""
    username = session['username']
    user = User(username)
    
    logs = user.get_token_logs()
    return jsonify({'success': True, 'logs': logs})

# ==================== Agent Tunnel Routes ====================

@app.route('/api/agent/status', methods=['GET'])
def get_agent_status():
    if 'username' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    online = is_agent_online(session['username'])
    return jsonify({'online': online})

from agent_tunnel import handle_agent_result

@sock.route('/ws/agent')
def agent_tunnel_socket(ws):
    import json
    import traceback
    username = None
    try:
        # First message must be auth
        auth_msg = ws.receive(timeout=10)
        if not auth_msg:
            return
        
        data = json.loads(auth_msg)
        if data.get('type') != 'auth' or 'agent_token' not in data:
            ws.send(json.dumps({'error': 'Missing type or token'}))
            return
            
        token = data['agent_token']
        
        # 从本地代理已注册表中查找凭据
        agent_info = _LOCAL_AGENTS.get(token)
        if agent_info:
            username = agent_info.get("username")
            
        if not username:
            ws.send(json.dumps({'error': 'Invalid or unregistered agent_token'}))
            return
            
        # Auth ok
        register_agent(username, ws)
        ws.send(json.dumps({'type': 'auth_ok'}))
        
        # Ping loop and message handler
        while True:
            msg = ws.receive()
            if msg is None:
                break
                
            try:
                update_ping(username)
                payload = json.loads(msg)
                ctype = payload.get('type')
                
                if ctype == 'ping':
                    ws.send(json.dumps({'type': 'pong'}))
                elif ctype == 'sync_tools':
                    tools = payload.get('tools', [])
                    update_agent_tools(username, tools)
                    ws.send(json.dumps({'type': 'tools_synced', 'count': len(tools)}))
                elif ctype == 'tool_result':
                    task_id = payload.get('task_id')
                    result = payload.get('result')
                    if task_id:
                        handle_agent_result(task_id, result)
            except Exception as e:
                print(f"[WSS] Error processing message from {username}: {e}")
                
    except Exception as e:
        print(f"[WSS] Agent disconnected or error: {e}")
    finally:
        if username:
            unregister_agent(username, ws)

if __name__ == '__main__':
    # 确保必要的目录存在
    os.makedirs('./templates', exist_ok=True)
    os.makedirs('./static/css', exist_ok=True)
    os.makedirs('./static/js', exist_ok=True)
    
    print("🚀 ChatDB Web Server Starting...")
    print("📍 访问地址: http://localhost:5000")
    print("💡 使用 Ctrl+C 停止服务器")
    
    app.run(debug=True, host='0.0.0.0', port=5000, threaded=True)
