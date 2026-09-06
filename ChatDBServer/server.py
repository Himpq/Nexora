"""
ChatDB Web Server - Flask应用
提供Web界面的聊天和知识库管理功能
"""
import os
import sys
import json
import base64
import binascii
import secrets
import hashlib
import ipaddress
import mimetypes
import re
import shutil
import threading
import uuid
from copy import deepcopy
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib import request as urllib_request, error as urllib_error, parse as urllib_parse
from flask import Flask, render_template, request, jsonify, session, redirect, url_for, Response, send_file, send_from_directory, has_request_context, g
from flask_cors import CORS
from datetime import timedelta, datetime
import time
import httpx

# Windows 控制台默认 GBK，\xa0 等字符直接 print 会抛 UnicodeEncodeError，转为 utf-8 容错
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# 添加api目录到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'api'))
from App.Core import Model
from basis.User import User
from basis.Conversation import ConversationService
from basis.Conversation.errors import ConversationConflictError, ConversationNotFoundError, ConversationValidationError
from longterm.longterm_api import normalize_longterm_request
from App.Storage import ChromaStore
from App.Storage import UserFileSandbox
from basis.Model.Provider import create_provider_adapter
from App.Utils import add_request_listener, pull_pending_request, submit_request_result
from App.Agent import add_agent_status_listener, register_agent, unregister_agent, update_agent_tools, update_agent_prompt, update_ping, is_agent_online, handle_agent_result
from App.Core import start_session as start_stream_session, iter_session_chunks as iter_stream_session_chunks, get_session_meta as get_stream_session_meta, request_cancel as request_stream_cancel, list_sessions as list_stream_sessions, is_stream_cancelled_error, StreamCancelled, get_accumulated_content as get_stream_accumulated_content
from basis.Tool import canonicalize_tool_name
from Map.baidu import load_map_scene_for_map_id
from App.Utils import as_bool as _as_bool, mask_public_api_key as _mask_public_api_key, normalize_text, resolve_configured_path, safe_filename, safe_join_path
from basis.Timeline import list_entries as list_timeline_entries, record_notes_snapshot_change
from basis.Database import safe_read_json, safe_write_json, get_path_lock
from basis.TokenUsage import read_usage_log_records
from App.Files import KnowledgeWordExporter
from App.Collaboration import KnowledgeCollabHub
from App.Utils import append_log_text, init_run_logger, log_event
from basis.Conversation import asset_store
import prompts
from basis.Permission import (
    coerce_bool_flag as _coerce_bool_flag,
    build_permission_hint_by_role,
    get_request_users_meta,
    get_user_model_blacklist,
    get_user_permission_hint_by_username as _permission_hint_by_username,
    require_admin,
    require_login,
)
import basis.Permission.AuthKey as _authkey
import basis.Config as _config_basis
import basis.User as _user_basis
from basis.User.routes import build_user_avatar_url, configure_user_routes, get_local_mail_profile, user_bp
from basis.User.admin_routes import configure_user_admin_routes
from App.Components import build_learning_context_payload, build_learning_memory_blocks
from App.Components import get_learning_runtime_local_config
from App.Memory import get_memory_analysis_queue
from basis.TokenUsage import TokenUsageDetailPresenter
from App.Executor import load_longdoc_skill_catalog
from App.Core import SystemSettingsRuntimeSyncer
from App.Runtime import get_service_status_monitor, install_service_status_monitor, start_service_status_monitor
from basis.TokenUsage import (
    get_server_quota_status,
    update_server_quota_config,
    adjust_model_quota_total,
    set_model_quota_total,
    get_generation_quota_gate,
    is_stopped,
)
from basis.TokenUsage import iter_papi_token_log_entries
from flask_sock import Sock


def _load_flask_secret_key() -> str:
    env_key = str(os.environ.get('CHATDB_SECRET_KEY') or os.environ.get('NEXORA_SECRET_KEY') or '').strip()

    if env_key:
        return env_key

    base_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(base_dir, 'data')
    secret_path = os.path.join(data_dir, 'flask_secret.key')

    os.makedirs(data_dir, exist_ok=True)

    if os.path.exists(secret_path):
        with open(secret_path, 'r', encoding='utf-8') as f:
            existing = f.read().strip()

        if existing:
            return existing

    secret = secrets.token_urlsafe(48)

    with open(secret_path, 'w', encoding='utf-8') as f:
        f.write(secret)

    return secret


app = Flask(__name__)
app.secret_key = _load_flask_secret_key()
app.config['SESSION_TYPE'] = 'filesystem'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)
app.config.setdefault('SESSION_COOKIE_HTTPONLY', True)
app.config.setdefault('SESSION_COOKIE_SAMESITE', 'Lax')
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = timedelta(hours=1)
sock = Sock(app)
CORS(app)

# 统一错误模板系统：全局 404 / 500 / ApiError / HTTPException 均返回统一 JSON
from api.App.errors import register_error_handlers

register_error_handlers(app)


@app.before_request
def disable_websocket_compression_extensions():
    """浏览器控制通道只传小型 JSON 事件，禁用压缩扩展避免帧协商不一致。"""
    path = str(request.path or '').strip()

    if not path.startswith('/ws/'):
        return None

    request.environ.pop('HTTP_SEC_WEBSOCKET_EXTENSIONS', None)
    return None


class _WebSocketHandledResponse(Response):
    """WebSocket 会话结束后阻止 Werkzeug 向已升级的 socket 补写 HTTP 响应。

    flask-sock 的 werkzeug 分支在 WS 结束后会让 Werkzeug 写一个 `HTTP/1.1 200 OK`
    到同一条 TCP 连接上（紧跟在 CLOSE 帧后面），浏览器会因此报
    "Invalid frame header"。抛 ConnectionError 会命中 Werkzeug dev server 的
    connection_dropped 分支，静默结束连接、不写任何字节。
    """

    def __call__(self, environ, start_response):
        raise ConnectionError('websocket connection already handled')


@app.after_request
def suppress_websocket_http_response(response):
    if (
        str(request.path or '').startswith('/ws/')
        and 'websocket' in str(request.headers.get('Upgrade') or '').lower()
        and request.environ.get('werkzeug.socket') is not None
    ):
        return _WebSocketHandledResponse()

    return response


# 切换到正确的工作目录
os.chdir(os.path.dirname(os.path.abspath(__file__)))


# ==================== 配置与全局变量 ====================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
DATA_RES_DIR = os.path.join(DATA_DIR, 'res')
SERVICE_STATUS_HISTORY_PATH = os.path.join(DATA_RES_DIR, 'service_status_history.json')
SKILLS_DIR = os.path.join(DATA_DIR, 'skills')
SKILLS_CATALOG_PATH = os.path.join(SKILLS_DIR, 'catalog.json')
SKILLS_MARKET_DIR = os.path.join(DATA_DIR, 'skills_market')
SKILLS_MARKET_ITEMS_DIR = os.path.join(SKILLS_MARKET_DIR, 'items')
SKILLS_MARKET_INDEX_PATH = os.path.join(SKILLS_MARKET_DIR, 'index.json')

ROOT_CONFIG_PATH = os.path.join(BASE_DIR, 'config.json')
ROOT_MODELS_PATH = os.path.join(BASE_DIR, 'models.json')
ROOT_MODEL_ADAPTERS_PATH = os.path.join(BASE_DIR, 'model_adapters.json')
CONFIG_PATH = os.path.join(DATA_DIR, 'config.json')
MODELS_PATH = os.path.join(DATA_DIR, 'models.json')
MODEL_ADAPTERS_PATH = os.path.join(DATA_DIR, 'model_adapters.json')
# 注入配置基础层文件路径
_config_basis.set_config_paths(CONFIG_PATH, MODELS_PATH)
MODELS_CONTEXT_WINDOW_CACHE_LEGACY_PATH = os.path.join(BASE_DIR, 'models_context_window.json')
MODELS_CONTEXT_WINDOW_CACHE_PATH = os.path.join(DATA_RES_DIR, 'models_context_window.json')
USERS_PATH = os.path.join(DATA_DIR, 'user.json')
# 注入用户基础层文件路径
_user_basis.set_users_path(USERS_PATH)
PAPI_KEYS_PATH = os.path.join(DATA_DIR, 'papikey.jsonl')
OPENROUTER_MODELS_SNAPSHOT_LEGACY_PATH = os.path.join(DATA_DIR, 'openrouter_models_snapshot.json')
OPENROUTER_MODELS_SNAPSHOT_PATH = os.path.join(DATA_RES_DIR, 'openrouter_models_snapshot.json')
OPENROUTER_MODEL_ALIAS_LIST_LEGACY_PATH = os.path.join(DATA_DIR, 'openrouter_model_alias_list.json')
OPENROUTER_MODEL_ALIAS_LIST_PATH = os.path.join(DATA_RES_DIR, 'openrouter_model_alias_list.json')
STATUS_MODEL_RULES_LEGACY_PATH = os.path.join(DATA_DIR, 'status_model_rules.json')
STATUS_MODEL_RULES_PATH = os.path.join(DATA_RES_DIR, 'status_model_rules.json')
_MODELS_CTX_CACHE_LOCK = threading.Lock()
_PROVIDER_CTX_BG_REFRESH_LOCK = threading.Lock()
_PROVIDER_CTX_BG_REFRESHING: Dict[str, bool] = {}
_PROVIDER_CTX_BG_LAST_TS: Dict[str, float] = {}
_PROVIDER_MODELS_CACHE_LOCK = threading.Lock()
_PROVIDER_MODELS_CACHE: Dict[str, Dict[str, Any]] = {}
_PROVIDER_MODELS_BG_LOCK = threading.Lock()
_PROVIDER_MODELS_BG_REFRESHING: Dict[str, bool] = {}
_PROVIDER_MODELS_BG_LAST_TS: Dict[str, float] = {}
_BROWSER_OLLAMA_STATUS_LOCK = threading.Lock()
_BROWSER_OLLAMA_STATUS_CACHE: Dict[str, Dict[str, Any]] = {}
_BROWSER_OLLAMA_STATUS_IN_FLIGHT: Set[str] = set()
_BROWSER_OLLAMA_STATUS_LOOP_STARTED = False
_BROWSER_OLLAMA_STATUS_POLL_SEC = 10.0
_BROWSER_OLLAMA_STATUS_IDLE_SLEEP_SEC = 5.0
_MODELS_CONFIG_SYNC_LAST_ERROR = ''
_CLIENT_CACHE: Dict[str, Any] = {}
_SYSTEM_SETTINGS_RUNTIME_SYNCER = SystemSettingsRuntimeSyncer(model_module_name="App.Core.model")


def _move_resource_file_if_needed(old_path: str, new_path: str):
    old_p = str(old_path or '').strip()
    new_p = str(new_path or '').strip()
    if not old_p or not new_p or old_p == new_p:
        return
    if os.path.exists(new_p) or (not os.path.exists(old_p)):
        return
    try:
        os.makedirs(os.path.dirname(new_p), exist_ok=True)
        os.replace(old_p, new_p)
    except Exception:
        try:
            shutil.copy2(old_p, new_p)
            os.remove(old_p)
        except Exception:
            pass


def _bootstrap_resource_layout():
    try:
        os.makedirs(DATA_RES_DIR, exist_ok=True)
    except Exception:
        return
    _move_resource_file_if_needed(MODELS_CONTEXT_WINDOW_CACHE_LEGACY_PATH, MODELS_CONTEXT_WINDOW_CACHE_PATH)
    _move_resource_file_if_needed(OPENROUTER_MODELS_SNAPSHOT_LEGACY_PATH, OPENROUTER_MODELS_SNAPSHOT_PATH)
    _move_resource_file_if_needed(OPENROUTER_MODEL_ALIAS_LIST_LEGACY_PATH, OPENROUTER_MODEL_ALIAS_LIST_PATH)
    _move_resource_file_if_needed(STATUS_MODEL_RULES_LEGACY_PATH, STATUS_MODEL_RULES_PATH)


def _format_exception_details(exc: Exception) -> str:
    import traceback

    tb = traceback.extract_tb(exc.__traceback__) if exc.__traceback__ else []
    lines = [f"{type(exc).__name__}: {exc}"]
    if tb:
        last_frame = tb[-1]
        lines.append(f"Location: {last_frame.filename}:{last_frame.lineno} in {last_frame.name}")
        if last_frame.line:
            lines.append(f"Code: {last_frame.line.strip()}")
    lines.append("Traceback:")
    lines.extend(line.rstrip("\n") for line in traceback.format_exception(type(exc), exc, exc.__traceback__))
    return "\n".join(lines)


def _resolve_provider_api_type(provider_label: Any) -> str:
    provider_key = str(provider_label or '').strip()
    config = get_config_all()
    providers_cfg = config.get('providers', {}) if isinstance(config.get('providers'), dict) else {}
    provider_cfg = providers_cfg.get(provider_key, {}) if isinstance(providers_cfg, dict) else {}
    if isinstance(provider_cfg, dict):
        api_type = str(provider_cfg.get('api_type', '') or '').strip().lower()
        if api_type:
            return api_type
    fallback = provider_key.strip().lower()
    if fallback in {'aliyun', 'dashscope'}:
        return 'dashscope'
    return fallback


_bootstrap_resource_layout()

# NexoraCode 本地 Agent 注册表: {agent_token: {callback_url, tools, username, registered_at}}
_LOCAL_AGENTS: Dict[str, Dict] = {}
SHORT_MEMORY_DISABLED = True


def _set_no_store_headers(resp: Response) -> Response:
    """Prevent browser/proxy cache for auth-sensitive pages and redirects."""
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp


def _set_static_cache_headers(resp: Response) -> Response:
    """为静态资源设置浏览器缓存；带版本号的资源允许长期缓存。"""
    has_version_token = bool(str(request.args.get('v') or '').strip())

    if has_version_token:
        resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    else:
        resp.headers['Cache-Control'] = 'public, max-age=3600'

    resp.headers.pop('Pragma', None)
    resp.headers.pop('Expires', None)
    return resp


def _clear_session_cookie(resp: Response) -> Response:
    """Force-remove Flask session cookie from client."""
    cookie_name = str(app.config.get('SESSION_COOKIE_NAME', 'session') or 'session')
    cookie_path = str(app.config.get('SESSION_COOKIE_PATH', '/') or '/')
    cookie_domain = app.config.get('SESSION_COOKIE_DOMAIN')
    try:
        if cookie_domain:
            resp.delete_cookie(cookie_name, path=cookie_path, domain=cookie_domain)
        resp.delete_cookie(cookie_name, path=cookie_path)
    except Exception:
        # Best-effort cookie cleanup; session.clear() is still applied.
        pass
    return resp


@app.after_request
def apply_auth_response_cache_policy(resp: Response):
    """
    Avoid BFCache / history-cache surprises after logout for auth-sensitive pages.
    """
    try:
        path = (request.path or '').strip() or '/'
        if path.startswith('/static/'):
            return _set_static_cache_headers(resp)

        content_type = str(resp.headers.get('Content-Type', '') or '').lower()
        is_html = 'text/html' in content_type
        protected_paths = {'/chat', '/knowledge', '/knowledge_graph', '/token_logs', '/login', '/logout'}
        if path in protected_paths or (is_html and ('username' in session)):
            _set_no_store_headers(resp)
    except Exception:
        pass
    return resp


DEFAULT_MAIN_CONFIG = {
    "port": 5000,
    "debug": False,
    "public_base_url": "",
    # Empty by default: forwarded client-IP headers are untrusted unless the
    # direct peer is explicitly listed as a reverse proxy.
    "trusted_proxy_cidrs": [],
    "default_model": "doubao-seed-1-6-250615",
    "conclusion_model": "doubao-seed-1-6-flash-250828",
    "organization_model": "doubao-seed-1-6-flash-250828",
    "websearch_model": "doubao-seed-1-6-flash-250828",
    "continuous_summary": False,
    "log_status": "silent",
    "log_retention_count": 5,
    "recent_dialogue_memory_count": 3,
    "recent_dialogue_item_max_chars": 12000,
    "user_knowledge_prompt_max_items": 24,
    "user_knowledge_prompt_max_chars": 6000,
    "api": {
        "public_api_key": "",
        "public_api_enabled": False,
        "public_api_keys_file": "./data/papikey.jsonl",
        "public_api_key_created_at": "",
        "public_api_key_expires_at": "",
        "public_api_key_last_regenerated_at": "",
        "public_api_key_permissions": {
            "model_inference": True,
            "image_generation": True,
            "knowledge_read": True,
            "conversations_read": True,
            "token_stats_read": True
        }
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
    },
    "nexora_search": {
        "host": "127.0.0.1",
        "port": 45678,
        "api_key": "",
        "nexora_search_enabled": False,
        "service_url": "http://127.0.0.1:45678",
        "timeout": 15
    },
    "map_service": {
        "provider": "baidu",
        "record_ttl_seconds": 21600,
        "record_max_items": 200,
        "baidu": {
            "browser_ak": "",
            "browser_version": "1.0",
            "server_ak": "",
            "server_sk": "",
            "auth_mode": "ak",
            "timeout": 12,
            "coord_type": "bd09ll",
            "ret_coordtype": "bd09ll",
            "direction_base_url": "https://api.map.baidu.com/direction/v2",
            "geocoding_url": "https://api.map.baidu.com/geocoding/v3/",
            "place_search_url": "https://api.map.baidu.com/place/v2/search"
        },
        "tianditu": {
            "browser_tk": "",
            "server_tk": "",
            "browser_version": "4.0",
            "timeout": 12,
            "coord_type": "cgcs2000",
            "driving_style": "0",
            "transit_linetype": "7",
            "drive_url": "https://api.tianditu.gov.cn/drive",
            "transit_url": "https://api.tianditu.gov.cn/transit",
            "geocoding_url": "https://api.tianditu.gov.cn/geocoder",
            "place_search_url": "https://api.tianditu.gov.cn/v2/search"
        }
    },
    "gen_image": {
        "enabled_api": "",
        "apis": {}
    },
    "temp_context_cache": {
        "enabled": True,
        "trigger_chars": 1000,
        "expire_seconds": 0,
        "storage": "memory",
        "file_path": "./data/temp/ContextTemp.tmp"
    },
    "nexora_learning": {
        "enabled": True,
        "host": "127.0.0.1",
        "port": 5001,
        "frontend_url": "http://127.0.0.1:5001",
        "api_key": "",
        "request_timeout": 30
    }
}

DEFAULT_MODELS_CONFIG = {
    "models": {},
    "providers": {}
}

DEFAULT_MODEL_ADAPTER_CONFIG = {
    "version": 1,
    "providers": {},
    "relay_order": []
}

DISABLED_MODEL_STATUSES = {
    'disabled',
    'off',
    'stopped',
    'quota_disabled',
    'quota_exhausted',
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


def _parse_ip_literal(value: Any) -> str:
    text = str(value or '').strip()
    if not text:
        return ''
    try:
        return str(ipaddress.ip_address(text))
    except ValueError:
        return ''


def _trusted_proxy_networks(raw_value: Any) -> List[Any]:
    raw_items = raw_value if isinstance(raw_value, list) else str(raw_value or '').split(',')
    networks = []
    for raw_item in raw_items:
        item = str(raw_item or '').strip()
        if not item:
            continue
        try:
            networks.append(ipaddress.ip_network(item, strict=False))
        except ValueError:
            continue
    return networks


def _resolve_recent_login_ip(request_obj: Any) -> str:
    """Resolve a login IP without trusting client-supplied forwarding headers."""
    direct_ip = _parse_ip_literal(getattr(request_obj, 'remote_addr', ''))
    if not direct_ip:
        return str(getattr(request_obj, 'remote_addr', '') or '').strip()

    config = get_config_all()
    trusted_networks = _trusted_proxy_networks(config.get('trusted_proxy_cidrs'))
    direct_address = ipaddress.ip_address(direct_ip)
    if not any(direct_address in network for network in trusted_networks):
        return direct_ip

    headers = getattr(request_obj, 'headers', {})
    real_ip = _parse_ip_literal(headers.get('X-Real-IP'))
    if real_ip:
        return real_ip

    forwarded_for = str(headers.get('X-Forwarded-For') or '').split(',', 1)[0]
    forwarded_ip = _parse_ip_literal(forwarded_for)
    return forwarded_ip or direct_ip


def _main_config_migration_hook(cfg: Dict[str, Any]) -> bool:
    """
    server 层主配置迁移逻辑（作为 basis.Config 的迁移回调）。
    返回是否有变更。
    """
    changed = False

    def _normalize_learning_base_url(value: Any) -> str:
        text = str(value or '').strip().rstrip('/')
        if text.endswith('/api/frontend'):
            text = text[:-len('/api/frontend')]
        elif text.endswith('/api/runtime'):
            text = text[:-len('/api/runtime')]
        return text.rstrip('/')

    api_cfg = cfg.get('api')
    if not isinstance(api_cfg, dict):
        api_cfg = {}
        cfg['api'] = api_cfg
        changed = True
    # Security migration: retire historical placeholder key automatically.
    default_placeholder_key = "public-1234567890abcdef"
    if str(api_cfg.get('public_api_key') or '').strip() == default_placeholder_key:
        api_cfg['public_api_key'] = ''
        api_cfg['public_api_enabled'] = False
        api_cfg['public_api_key_created_at'] = ''
        api_cfg['public_api_key_expires_at'] = ''
        api_cfg['public_api_key_last_regenerated_at'] = ''
        changed = True
    if _migrate_legacy_public_api_key(api_cfg):
        changed = True
    if _migrate_papi_key_scope_schema():
        changed = True
    normalized_api_perms = _normalize_public_api_permissions(api_cfg.get('public_api_key_permissions'))
    if api_cfg.get('public_api_key_permissions') != normalized_api_perms:
        api_cfg['public_api_key_permissions'] = normalized_api_perms
        changed = True
    active_keys = _list_papi_key_records(include_revoked=False)
    if (not active_keys) and _coerce_bool_flag(api_cfg.get('public_api_enabled'), False):
        api_cfg['public_api_enabled'] = False
        changed = True
    temp_cache = cfg.get('temp_context_cache')
    if isinstance(temp_cache, dict):
        old_temp_path = str(temp_cache.get('file_path', '') or '').strip()
        if old_temp_path in {'./temp/ContextTemp.tmp', 'temp/ContextTemp.tmp'}:
            temp_cache['file_path'] = './data/temp/ContextTemp.tmp'
            changed = True
    learning_cfg = cfg.get('nexora_learning')
    if not isinstance(learning_cfg, dict):
        learning_cfg = {}
        cfg['nexora_learning'] = learning_cfg
        changed = True
    if isinstance(learning_cfg, dict):
        current_frontend_url = _normalize_learning_base_url(learning_cfg.get('frontend_url'))
        legacy_service_url = _normalize_learning_base_url(learning_cfg.get('service_url'))
        legacy_host = str(learning_cfg.get('host') or '').strip()
        legacy_port = learning_cfg.get('port')
        if not current_frontend_url:
            if legacy_service_url:
                current_frontend_url = legacy_service_url
            elif legacy_host:
                scheme = 'https'
                public_base_url = str(cfg.get('public_base_url') or '').strip()
                if public_base_url.lower().startswith('http://'):
                    scheme = 'http'
                try:
                    port_value = int(legacy_port or 5001)
                except Exception:
                    port_value = 5001
                default_port = 443 if scheme == 'https' else 80
                host_part = legacy_host
                if port_value != default_port:
                    host_part = f'{host_part}:{port_value}'
                current_frontend_url = f'{scheme}://{host_part}'
        normalized_frontend_url = _normalize_learning_base_url(current_frontend_url)
        if normalized_frontend_url and learning_cfg.get('frontend_url') != normalized_frontend_url:
            learning_cfg['frontend_url'] = normalized_frontend_url
            changed = True
        if not legacy_host:
            learning_cfg['host'] = '127.0.0.1'
            changed = True
        try:
            normalized_port = int(legacy_port or learning_cfg.get('port') or 5001)
        except Exception:
            normalized_port = 5001
        if int(learning_cfg.get('port') or 0) != normalized_port:
            learning_cfg['port'] = normalized_port
            changed = True
        for legacy_key in ('service_url', 'runtime_base_path'):
            if legacy_key in learning_cfg:
                learning_cfg.pop(legacy_key, None)
                changed = True
    return changed


def ensure_main_config_defaults():
    """
    读取主配置并合并默认值 + server 迁移逻辑。
    核心能力由 Nexora.basis.Config 提供，迁移逻辑作为回调注入。
    """
    return _config_basis.ensure_main_config_defaults(_main_config_migration_hook)



def save_main_config(cfg):
    """保存主配置。核心由 Nexora.basis.Config 提供。"""
    return _config_basis.save_main_config(cfg)


SYSTEM_DEFAULT_MODEL_KEYS = (
    'default_model',
    'conclusion_model',
    'organization_model',
    'websearch_model',
)


def _system_settings_text(value: Any, max_length: int = 500) -> str:
    if value is None:
        return ''

    return str(value).strip()[:max_length]


def _system_settings_bool(value: Any) -> bool:
    return _coerce_bool_flag(value, False)


def _system_settings_int(value: Any, field_name: str, minimum: int = 1, maximum: int = 65535) -> int:
    try:
        parsed = int(value)
    except Exception as exc:
        raise ValueError(f'{field_name} 必须是整数') from exc

    if parsed < minimum or parsed > maximum:
        raise ValueError(f'{field_name} 必须在 {minimum}-{maximum} 范围内')

    return parsed


def _system_settings_float(value: Any, field_name: str, minimum: float = 1.0, maximum: float = 3600.0) -> float:
    try:
        parsed = float(value)
    except Exception as exc:
        raise ValueError(f'{field_name} 必须是数字') from exc

    if parsed < minimum or parsed > maximum:
        raise ValueError(f'{field_name} 必须在 {minimum:g}-{maximum:g} 范围内')

    return parsed


def _system_settings_url(value: Any, field_name: str) -> str:
    text = _system_settings_text(value, 500).rstrip('/')

    if text and not text.startswith(('http://', 'https://')):
        raise ValueError(f'{field_name} 必须以 http:// 或 https:// 开头')

    return text


def _system_settings_branch(cfg: Dict[str, Any], key: str) -> Dict[str, Any]:
    branch = cfg.get(key)

    if not isinstance(branch, dict):
        branch = {}
        cfg[key] = branch

    return branch


def _build_admin_system_model_options(cfg: Dict[str, Any], models_cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    models = models_cfg.get('models', {}) if isinstance(models_cfg.get('models'), dict) else {}
    option_ids = set(str(model_id or '').strip() for model_id in models.keys())

    for key in SYSTEM_DEFAULT_MODEL_KEYS:
        current_model = str(cfg.get(key) or '').strip()

        if current_model:
            option_ids.add(current_model)

    options: List[Dict[str, Any]] = []

    for model_id in sorted(option_ids, key=lambda item: item.lower()):
        if not model_id:
            continue

        info = models.get(model_id)
        name = ''
        provider = ''
        registered = isinstance(info, dict)

        if isinstance(info, dict):
            name = str(info.get('name') or '').strip()
            provider = str(info.get('provider') or '').strip()

        options.append({
            'id': model_id,
            'name': name or model_id,
            'provider': provider,
            'registered': registered,
        })

    return options


def _build_admin_system_settings_payload(cfg: Dict[str, Any], models_cfg: Dict[str, Any]) -> Dict[str, Any]:
    rag_cfg = cfg.get('rag_database') if isinstance(cfg.get('rag_database'), dict) else {}
    search_cfg = cfg.get('nexora_search') if isinstance(cfg.get('nexora_search'), dict) else {}
    learning_cfg = cfg.get('nexora_learning') if isinstance(cfg.get('nexora_learning'), dict) else {}
    mail_cfg = cfg.get('nexora_mail') if isinstance(cfg.get('nexora_mail'), dict) else {}

    return {
        'runtime': {
            'public_base_url': str(cfg.get('public_base_url') or '').strip(),
        },
        'default_models': {
            key: str(cfg.get(key) or '').strip()
            for key in SYSTEM_DEFAULT_MODEL_KEYS
        },
        'model_options': _build_admin_system_model_options(cfg, models_cfg),
        'services': {
            'rag_database': {
                'enabled': bool(rag_cfg.get('rag_database_enabled', False)),
                'mode': str(rag_cfg.get('mode') or 'service').strip() or 'service',
                'host': str(rag_cfg.get('host') or '').strip(),
                'port': int(rag_cfg.get('port') or 8100),
                'api_key': str(rag_cfg.get('api_key') or ''),
                'service_url': str(rag_cfg.get('service_url') or '').strip(),
            },
            'nexora_search': {
                'enabled': bool(search_cfg.get('nexora_search_enabled', False)),
                'host': str(search_cfg.get('host') or '').strip(),
                'port': int(search_cfg.get('port') or 45678),
                'api_key': str(search_cfg.get('api_key') or ''),
                'service_url': str(search_cfg.get('service_url') or '').strip(),
                'timeout': float(search_cfg.get('timeout') or 15),
            },
            'nexora_learning': {
                'enabled': bool(learning_cfg.get('enabled', True)),
                'host': str(learning_cfg.get('host') or '').strip(),
                'port': int(learning_cfg.get('port') or 5001),
                'api_key': str(learning_cfg.get('api_key') or ''),
                'frontend_url': str(learning_cfg.get('frontend_url') or '').strip(),
                'request_timeout': float(learning_cfg.get('request_timeout') or 30),
            },
            'nexora_mail': {
                'enabled': bool(mail_cfg.get('nexora_mail_enabled', False)),
                'host': str(mail_cfg.get('host') or '').strip(),
                'port': int(mail_cfg.get('port') or 17171),
                'api_key': str(mail_cfg.get('api_key') or ''),
                'service_url': str(mail_cfg.get('service_url') or '').strip(),
                'timeout': float(mail_cfg.get('timeout') or 10),
                'send_timeout': float(mail_cfg.get('send_timeout') or 120),
                'default_group': str(mail_cfg.get('default_group') or 'default').strip() or 'default',
            },
        },
    }


def _apply_admin_system_default_models(
    cfg: Dict[str, Any],
    models_cfg: Dict[str, Any],
    default_models: Any,
) -> None:
    if not isinstance(default_models, dict):
        return

    models = models_cfg.get('models', {}) if isinstance(models_cfg.get('models'), dict) else {}

    for key in SYSTEM_DEFAULT_MODEL_KEYS:
        if key not in default_models:
            continue

        model_id = _system_settings_text(default_models.get(key), 200)
        current_model_id = str(cfg.get(key) or '').strip()

        if model_id and model_id not in models and model_id != current_model_id:
            raise ValueError(f'{key} 指向的模型不存在: {model_id}')

        cfg[key] = model_id


def _apply_admin_system_runtime(cfg: Dict[str, Any], runtime: Any) -> None:
    if not isinstance(runtime, dict):
        return

    if 'public_base_url' in runtime:
        cfg['public_base_url'] = _system_settings_url(runtime.get('public_base_url'), 'Public Base URL')


def _apply_admin_system_services(cfg: Dict[str, Any], services: Any) -> None:
    if not isinstance(services, dict):
        return

    rag_payload = services.get('rag_database')

    if isinstance(rag_payload, dict):
        rag_cfg = _system_settings_branch(cfg, 'rag_database')
        mode = _system_settings_text(rag_payload.get('mode'), 20) or 'service'

        if mode not in {'service', 'local'}:
            raise ValueError('RAG 模式只能是 service 或 local')

        rag_cfg['rag_database_enabled'] = _system_settings_bool(rag_payload.get('enabled'))
        rag_cfg['mode'] = mode
        rag_cfg['host'] = _system_settings_text(rag_payload.get('host'), 120)
        rag_cfg['port'] = _system_settings_int(rag_payload.get('port'), 'RAG 端口')
        rag_cfg['api_key'] = _system_settings_text(rag_payload.get('api_key'), 500)
        rag_cfg['service_url'] = _system_settings_url(rag_payload.get('service_url'), 'RAG Service URL')

    search_payload = services.get('nexora_search')

    if isinstance(search_payload, dict):
        search_cfg = _system_settings_branch(cfg, 'nexora_search')
        search_cfg['nexora_search_enabled'] = _system_settings_bool(search_payload.get('enabled'))
        search_cfg['host'] = _system_settings_text(search_payload.get('host'), 120)
        search_cfg['port'] = _system_settings_int(search_payload.get('port'), 'NexoraSearch 端口')
        search_cfg['api_key'] = _system_settings_text(search_payload.get('api_key'), 500)
        search_cfg['service_url'] = _system_settings_url(search_payload.get('service_url'), 'NexoraSearch Service URL')
        search_cfg['timeout'] = _system_settings_float(search_payload.get('timeout'), 'NexoraSearch 超时')

    learning_payload = services.get('nexora_learning')

    if isinstance(learning_payload, dict):
        learning_cfg = _system_settings_branch(cfg, 'nexora_learning')
        learning_cfg['enabled'] = _system_settings_bool(learning_payload.get('enabled'))
        learning_cfg['host'] = _system_settings_text(learning_payload.get('host'), 120)
        learning_cfg['port'] = _system_settings_int(learning_payload.get('port'), 'NexoraLearning 端口')
        learning_cfg['api_key'] = _system_settings_text(learning_payload.get('api_key'), 500)
        learning_cfg['frontend_url'] = _system_settings_url(learning_payload.get('frontend_url'), 'NexoraLearning Frontend URL')
        learning_cfg['request_timeout'] = _system_settings_float(learning_payload.get('request_timeout'), 'NexoraLearning 超时')

    mail_payload = services.get('nexora_mail')

    if isinstance(mail_payload, dict):
        mail_cfg = _system_settings_branch(cfg, 'nexora_mail')
        mail_cfg['nexora_mail_enabled'] = _system_settings_bool(mail_payload.get('enabled'))
        mail_cfg['host'] = _system_settings_text(mail_payload.get('host'), 120)
        mail_cfg['port'] = _system_settings_int(mail_payload.get('port'), 'NexoraMail 端口')
        mail_cfg['api_key'] = _system_settings_text(mail_payload.get('api_key'), 500)
        mail_cfg['service_url'] = _system_settings_url(mail_payload.get('service_url'), 'NexoraMail Service URL')
        mail_cfg['timeout'] = _system_settings_float(mail_payload.get('timeout'), 'NexoraMail 超时')
        mail_cfg['send_timeout'] = _system_settings_float(mail_payload.get('send_timeout'), 'NexoraMail 发送超时')
        mail_cfg['default_group'] = _system_settings_text(mail_payload.get('default_group'), 120) or 'default'


def _apply_admin_system_settings_payload(
    cfg: Dict[str, Any],
    models_cfg: Dict[str, Any],
    payload: Any,
) -> Dict[str, Any]:
    data = payload if isinstance(payload, dict) else {}

    _apply_admin_system_runtime(cfg, data.get('runtime'))
    _apply_admin_system_default_models(cfg, models_cfg, data.get('default_models'))
    _apply_admin_system_services(cfg, data.get('services'))

    return cfg


def _ensure_server_bootstrap_files():
    """
    Ensure empty deployment can boot without manual pre-created files.
    """
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        os.makedirs(os.path.join(DATA_DIR, 'temp'), exist_ok=True)
    except Exception:
        pass

    try:
        _move_resource_file_if_needed(ROOT_CONFIG_PATH, CONFIG_PATH)
        _move_resource_file_if_needed(ROOT_MODELS_PATH, MODELS_PATH)
        _move_resource_file_if_needed(ROOT_MODEL_ADAPTERS_PATH, MODEL_ADAPTERS_PATH)
    except Exception:
        pass

    try:
        ensure_main_config_defaults()
    except Exception:
        pass

    try:
        if not os.path.exists(USERS_PATH):
            with open(USERS_PATH, 'w', encoding='utf-8') as f:
                json.dump({}, f, indent=4, ensure_ascii=False)
    except Exception:
        pass

    try:
        if not os.path.exists(MODEL_ADAPTERS_PATH):
            with open(MODEL_ADAPTERS_PATH, 'w', encoding='utf-8') as f:
                json.dump(DEFAULT_MODEL_ADAPTER_CONFIG, f, indent=4, ensure_ascii=False)
    except Exception:
        pass

    try:
        if not os.path.exists(PAPI_KEYS_PATH):
            os.makedirs(os.path.dirname(PAPI_KEYS_PATH), exist_ok=True)
            with open(PAPI_KEYS_PATH, 'w', encoding='utf-8') as f:
                f.write('')
    except Exception:
        pass

    try:
        if not os.path.exists(MODELS_PATH):
            with open(MODELS_PATH, 'w', encoding='utf-8') as f:
                json.dump(DEFAULT_MODELS_CONFIG, f, indent=4, ensure_ascii=False)
    except Exception:
        pass


_ensure_server_bootstrap_files()


def load_users():
    """加载用户表（带缓存）。核心由 Nexora.basis.User 提供。"""
    return _user_basis.load_users()


def save_users(users):
    """保存用户表。核心由 Nexora.basis.User 提供。"""
    return _user_basis.save_users(users)


def _normalize_skill_mode(raw: Any) -> str:
    token = str(raw or '').strip().lower()
    if token in {'force', 'always', 'on', '1', 'true'}:
        return 'force'
    if token in {'auto', 'auto_tools', 'auto(tools)', 'auto-tools', 'auto_tool', 'tools'}:
        return 'auto'
    return 'off'


def _skill_slug(raw: Any, fallback: str = 'skill') -> str:
    src = str(raw or '').strip().lower()
    if not src:
        src = str(fallback or '').strip().lower()
    if not src:
        src = 'skill'
    src = re.sub(r'[\s/\\]+', '-', src)
    src = re.sub(r'[^a-z0-9._-]+', '-', src)
    src = re.sub(r'-{2,}', '-', src).strip('-')
    if src:
        return src
    fb = str(fallback or '').strip().lower()
    return fb or 'skill'


def _normalize_skill_required_tools(raw: Any) -> List[str]:
    out: List[str] = []
    seen: Set[str] = set()
    if isinstance(raw, list):
        values = raw
    elif isinstance(raw, str):
        values = [seg.strip() for seg in raw.replace('，', ',').split(',') if seg.strip()]
    else:
        values = []
    for item in values:
        token = canonicalize_tool_name(str(item or '').strip())
        if not token:
            continue
        key = token.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(token)
    return out


def _normalize_skill_catalog_item(raw: Any, index: int = 0) -> Optional[Dict[str, Any]]:
    item = raw if isinstance(raw, dict) else {}
    title = str(item.get('title') or '').strip()
    if not title:
        return None

    skill_id = _skill_slug(item.get('id') or title, fallback=f"skill_{index + 1}")
    content = str(item.get('main_content') or item.get('content') or '')
    now_date = datetime.now().strftime('%Y-%m-%d')
    release_date = str(item.get('release_date') or '').strip() or now_date
    update_date = str(item.get('update_date') or '').strip() or now_date

    # 标签规范化：支持列表或逗号分隔字符串
    tags_raw = item.get('tags', [])
    if isinstance(tags_raw, str):
        tags = [t.strip() for t in tags_raw.replace('，', ',').split(',') if t.strip()]
    elif isinstance(tags_raw, list):
        tags = [str(t).strip() for t in tags_raw if str(t).strip()]
    else:
        tags = []

    return {
        'id': skill_id,
        'title': title,
        'required_tools': _normalize_skill_required_tools(item.get('required_tools', [])),
        'mode': _normalize_skill_mode(item.get('mode', 'off')),
        'author': str(item.get('author') or '').strip(),
        'release_date': release_date,
        'version': str(item.get('version') or '').strip(),
        'update_date': update_date,
        'main_content': content.rstrip('\r\n'),
        'description': str(item.get('description') or '').strip(),
        'tags': tags,
        'origin': str(item.get('origin') or '').strip(),
        'origin_id': str(item.get('origin_id') or '').strip(),
        'origin_version': str(item.get('origin_version') or '').strip(),
        'installed_date': str(item.get('installed_date') or '').strip()
    }


def _skill_file_path(skill_id: str) -> str:
    sid = _skill_slug(skill_id, fallback='skill')
    return os.path.join(SKILLS_DIR, f'{sid}.skill')


def _serialize_skill_text(skill: Dict[str, Any]) -> str:
    item = _normalize_skill_catalog_item(skill, index=0) or {}
    required_tools = list(item.get('required_tools', []) or [])
    tags = list(item.get('tags', []) or [])

    lines = [
        f"id: {str(item.get('id') or '').strip()}",
        f"title: {str(item.get('title') or '').strip()}",
        f"required_tools: {', '.join(required_tools)}",
        f"mode: {str(item.get('mode') or 'off').strip()}",
        f"author: {str(item.get('author') or '').strip()}",
        f"release_date: {str(item.get('release_date') or '').strip()}",
        f"version: {str(item.get('version') or '').strip()}",
        f"update_date: {str(item.get('update_date') or '').strip()}",
    ]

    # 扩展字段：仅在非空时写入
    description = str(item.get('description') or '').strip()
    if description:
        lines.append(f"description: {description}")

    if tags:
        lines.append(f"tags: {', '.join(tags)}")

    origin = str(item.get('origin') or '').strip()
    if origin:
        lines.append(f"origin: {origin}")

    origin_id = str(item.get('origin_id') or '').strip()
    if origin_id:
        lines.append(f"origin_id: {origin_id}")

    origin_version = str(item.get('origin_version') or '').strip()
    if origin_version:
        lines.append(f"origin_version: {origin_version}")

    installed_date = str(item.get('installed_date') or '').strip()
    if installed_date:
        lines.append(f"installed_date: {installed_date}")

    lines.append("")
    lines.append("---content---")
    lines.append(str(item.get('main_content') or ''))

    return "\n".join(lines).rstrip("\n") + "\n"


def _parse_skill_text(raw_text: Any, source: str = '') -> Optional[Dict[str, Any]]:
    text = str(raw_text or '')
    if not text.strip():
        return None
    lines = text.splitlines()
    marker_index = -1
    for idx, line in enumerate(lines):
        if str(line or '').strip().lower() == '---content---':
            marker_index = idx
            break
    header_lines = lines if marker_index < 0 else lines[:marker_index]
    content_lines = [] if marker_index < 0 else lines[marker_index + 1:]
    header: Dict[str, str] = {}
    for raw_line in header_lines:
        line = str(raw_line or '').strip()
        if not line or line.startswith('#'):
            continue
        sep = ':' if ':' in line else ('=' if '=' in line else '')
        if not sep:
            continue
        key, value = line.split(sep, 1)
        k = str(key or '').strip().lower()
        v = str(value or '').strip()
        if not k:
            continue
        header[k] = v

    src_name = os.path.basename(str(source or ''))
    default_title = src_name[:-6] if src_name.lower().endswith('.skill') else src_name
    payload = {
        'id': header.get('id') or default_title or '',
        'title': header.get('title') or default_title or '',
        'required_tools': header.get('required_tools', ''),
        'mode': header.get('mode', 'off'),
        'author': header.get('author', ''),
        'release_date': header.get('release_date', ''),
        'version': header.get('version', ''),
        'update_date': header.get('update_date', ''),
        'description': header.get('description', ''),
        'tags': header.get('tags', ''),
        'origin': header.get('origin', ''),
        'origin_id': header.get('origin_id', ''),
        'origin_version': header.get('origin_version', ''),
        'installed_date': header.get('installed_date', ''),
        'main_content': "\n".join(content_lines).rstrip('\r\n')
    }
    return _normalize_skill_catalog_item(payload, index=0)


def _write_skill_file(skill: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    item = _normalize_skill_catalog_item(skill, index=0)
    if not item:
        return None
    os.makedirs(SKILLS_DIR, exist_ok=True)
    path = _skill_file_path(str(item.get('id') or ''))
    with open(path, 'w', encoding='utf-8') as f:
        f.write(_serialize_skill_text(item))
    return item


def _load_legacy_skill_catalog_json() -> List[Dict[str, Any]]:
    payload: Dict[str, Any] = {}
    if not os.path.exists(SKILLS_CATALOG_PATH):
        return []
    try:
        with open(SKILLS_CATALOG_PATH, 'r', encoding='utf-8') as f:
            payload = json.load(f)
    except Exception:
        return []
    rows = payload.get('skills', []) if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        return []
    out: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for idx, row in enumerate(rows):
        item = _normalize_skill_catalog_item(row, index=idx)
        if not item:
            continue
        sid = str(item.get('id') or '').strip()
        if not sid or sid in seen:
            continue
        seen.add(sid)
        out.append(item)
    return out


def _load_skill_catalog() -> List[Dict[str, Any]]:
    os.makedirs(SKILLS_DIR, exist_ok=True)
    normalized: List[Dict[str, Any]] = []
    seen_ids: Set[str] = set()
    skill_files = sorted([
        os.path.join(SKILLS_DIR, fn)
        for fn in os.listdir(SKILLS_DIR)
        if str(fn or '').lower().endswith('.skill')
    ])

    # 兼容迁移：如果没有 .skill 文件但存在旧 catalog.json，则自动转换。
    if not skill_files:
        legacy_items = _load_legacy_skill_catalog_json()
        for row in legacy_items:
            _write_skill_file(row)
        skill_files = sorted([
            os.path.join(SKILLS_DIR, fn)
            for fn in os.listdir(SKILLS_DIR)
            if str(fn or '').lower().endswith('.skill')
        ])

    for idx, path in enumerate(skill_files):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                raw_text = f.read()
        except Exception:
            continue
        skill = _parse_skill_text(raw_text, source=path)
        if not skill:
            continue
        sid = str(skill.get('id') or '').strip()
        if (not sid) or (sid in seen_ids):
            continue
        seen_ids.add(sid)
        normalized.append(skill)
    return normalized


def _save_skill_catalog(skills: List[Dict[str, Any]]) -> None:
    os.makedirs(SKILLS_DIR, exist_ok=True)
    normalized: List[Dict[str, Any]] = []
    seen_ids: Set[str] = set()
    for idx, row in enumerate(skills or []):
        skill = _normalize_skill_catalog_item(row, index=idx)
        if not skill:
            continue
        sid = str(skill.get('id') or '').strip()
        if (not sid) or (sid in seen_ids):
            continue
        seen_ids.add(sid)
        normalized.append(skill)
    wanted_files = set()
    for item in normalized:
        saved = _write_skill_file(item)
        if not saved:
            continue
        wanted_files.add(os.path.normpath(_skill_file_path(str(saved.get('id') or ''))))
    for fn in os.listdir(SKILLS_DIR):
        if not str(fn or '').lower().endswith('.skill'):
            continue
        full_path = os.path.normpath(os.path.join(SKILLS_DIR, fn))
        if full_path in wanted_files:
            continue
        try:
            os.remove(full_path)
        except Exception:
            pass


def _resolve_user_base_path(username: str) -> str:
    uname = str(username or '').strip()
    default_path = safe_join_path(DATA_DIR, 'users', uname) if uname else safe_join_path(DATA_DIR, 'users')
    if not uname:
        return default_path
    try:
        users_meta = load_users()
    except Exception:
        users_meta = {}
    if isinstance(users_meta, dict):
        user_data = users_meta.get(uname, {})
    else:
        user_data = {}
    raw_path = str(user_data.get('path') or '').strip() if isinstance(user_data, dict) else ''
    if not raw_path:
        return default_path
    return resolve_configured_path(BASE_DIR, raw_path, fallback=default_path)


def _user_skill_settings_path(username: str) -> str:
    return safe_join_path(_resolve_user_base_path(username), 'skill_settings.json')


def _load_user_skill_settings(username: str) -> Dict[str, Any]:
    path = _user_skill_settings_path(username)
    defaults = {'skill_modes': {}}
    if not os.path.exists(path):
        return defaults
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        return defaults
    if not isinstance(data, dict):
        return defaults
    out_modes: Dict[str, str] = {}
    modes_raw = data.get('skill_modes', {})
    if isinstance(modes_raw, dict):
        for k, v in modes_raw.items():
            sid = _skill_slug(k, fallback='').strip()
            if sid == 'skill' and str(k or '').strip() == '':
                sid = ''
            if not sid:
                continue
            out_modes[sid] = _normalize_skill_mode(v)

    # 兼容旧格式：{mode, enabled_skill_ids}
    if not out_modes:
        legacy_mode = _normalize_skill_mode(data.get('mode', 'off'))
        enabled_raw = data.get('enabled_skill_ids', [])
        if isinstance(enabled_raw, list):
            for item in enabled_raw:
                sid = _skill_slug(item, fallback='').strip()
                if sid == 'skill' and str(item or '').strip() == '':
                    sid = ''
                if not sid:
                    continue
                out_modes[sid] = legacy_mode

    return {'skill_modes': out_modes}


def _save_user_skill_settings(username: str, settings: Dict[str, Any]) -> Dict[str, Any]:
    path = _user_skill_settings_path(username)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    skill_modes_raw = (settings or {}).get('skill_modes', {})
    skill_modes: Dict[str, str] = {}
    if isinstance(skill_modes_raw, dict):
        for k, v in skill_modes_raw.items():
            sid = _skill_slug(k, fallback='').strip()
            if sid == 'skill' and str(k or '').strip() == '':
                sid = ''
            if not sid:
                continue
            skill_modes[sid] = _normalize_skill_mode(v)
    payload = {'skill_modes': skill_modes}
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return payload


def _build_user_skill_runtime(username: str) -> Dict[str, Any]:
    # 加载全局 Skill 目录
    global_catalog = _load_skill_catalog()

    # 加载用户个人 Skill（自建 + 市场安装副本）
    personal_skills = _load_user_skills(username)

    # 合并：个人覆盖全局（同 ID 时个人优先）
    merged_map: Dict[str, Dict[str, Any]] = {}
    for item in global_catalog:
        sid = str(item.get('id') or '').strip()
        if not sid:
            continue
        row = dict(item)
        if not row.get('origin'):
            row['origin'] = 'global'
        merged_map[sid] = row

    for item in personal_skills:
        sid = str(item.get('id') or '').strip()
        if not sid:
            continue
        row = dict(item)
        if not row.get('origin'):
            row['origin'] = 'self'
        merged_map[sid] = row

    catalog = list(merged_map.values())

    settings = _load_user_skill_settings(username)
    skill_modes = settings.get('skill_modes', {}) if isinstance(settings.get('skill_modes', {}), dict) else {}
    normalized_modes: Dict[str, str] = {}
    for k, v in skill_modes.items():
        sid = _skill_slug(k, fallback='').strip()
        if sid == 'skill' and str(k or '').strip() == '':
            sid = ''
        if not sid:
            continue
        normalized_modes[sid] = _normalize_skill_mode(v)

    enabled_ids: Set[str] = set()
    skills_with_state: List[Dict[str, Any]] = []
    active_skills: List[Dict[str, Any]] = []

    for item in catalog:
        sid = str(item.get('id') or '').strip()
        item_mode = _normalize_skill_mode(
            normalized_modes.get(sid, item.get('mode', 'off'))
        )
        enabled = item_mode != 'off'

        if enabled:
            enabled_ids.add(sid)

        row = dict(item)
        row['mode'] = item_mode
        row['enabled'] = enabled
        skills_with_state.append(row)

        if enabled:
            active_skills.append({
                'id': sid,
                'title': str(item.get('title') or '').strip(),
                'required_tools': list(item.get('required_tools', []) or []),
                'mode': item_mode,
                'author': str(item.get('author') or '').strip(),
                'release_date': str(item.get('release_date') or '').strip(),
                'version': str(item.get('version') or '').strip(),
                'update_date': str(item.get('update_date') or '').strip(),
                'main_content': str(item.get('main_content') or '').strip()
            })

    return {
        'mode': 'per_skill',
        'skill_modes': normalized_modes,
        'enabled_skill_ids': sorted(list(enabled_ids)),
        'skills': skills_with_state,
        'active_skills': active_skills
    }


# ==================== 个人 Skill 存储 ====================

def _user_skills_dir(username: str) -> str:
    """获取用户个人 Skill 目录路径"""
    return safe_join_path(_resolve_user_base_path(username), 'skills')


def _user_skill_file_path(username: str, skill_id: str) -> str:
    """获取用户个人 Skill 文件路径"""
    sid = _skill_slug(skill_id, fallback='skill')
    return os.path.join(_user_skills_dir(username), f'{sid}.skill')


def _load_user_skills(username: str) -> List[Dict[str, Any]]:
    """加载用户所有个人 Skill（自建 + 市场安装副本）"""
    skills_dir = _user_skills_dir(username)
    if not os.path.isdir(skills_dir):
        return []

    normalized: List[Dict[str, Any]] = []
    seen_ids: Set[str] = set()
    skill_files = sorted([
        os.path.join(skills_dir, fn)
        for fn in os.listdir(skills_dir)
        if str(fn or '').lower().endswith('.skill')
    ])

    for path in skill_files:
        try:
            with open(path, 'r', encoding='utf-8') as f:
                raw_text = f.read()
        except Exception:
            continue

        skill = _parse_skill_text(raw_text, source=path)
        if not skill:
            continue

        sid = str(skill.get('id') or '').strip()
        if (not sid) or (sid in seen_ids):
            continue

        seen_ids.add(sid)
        normalized.append(skill)

    return normalized


def _write_user_skill_file(username: str, skill: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """写入用户个人 Skill 文件"""
    item = _normalize_skill_catalog_item(skill, index=0)
    if not item:
        return None

    skills_dir = _user_skills_dir(username)
    os.makedirs(skills_dir, exist_ok=True)
    path = _user_skill_file_path(username, str(item.get('id') or ''))

    with open(path, 'w', encoding='utf-8') as f:
        f.write(_serialize_skill_text(item))

    return item


def _delete_user_skill_file(username: str, skill_id: str) -> bool:
    """删除用户个人 Skill 文件"""
    path = _user_skill_file_path(username, skill_id)
    if not os.path.exists(path):
        return False

    try:
        os.remove(path)
        return True
    except Exception:
        return False


# ==================== Skill 市场存储 ====================

def _load_market_index() -> List[Dict[str, Any]]:
    """加载市场索引"""
    if not os.path.exists(SKILLS_MARKET_INDEX_PATH):
        return []

    try:
        with open(SKILLS_MARKET_INDEX_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        return []

    skills = data.get('skills', []) if isinstance(data, dict) else []
    if not isinstance(skills, list):
        return []

    return skills


def _save_market_index(skills: List[Dict[str, Any]]) -> None:
    """保存市场索引（原子写入）"""
    os.makedirs(SKILLS_MARKET_DIR, exist_ok=True)
    payload = {'skills': skills}
    tmp_path = SKILLS_MARKET_INDEX_PATH + '.tmp'

    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    os.replace(tmp_path, SKILLS_MARKET_INDEX_PATH)


def _market_item_path(skill_id: str) -> str:
    """获取市场 Skill 正文文件路径"""
    sid = _skill_slug(skill_id, fallback='skill')
    return os.path.join(SKILLS_MARKET_ITEMS_DIR, f'{sid}.skill')


def _load_market_skill_content(skill_id: str) -> Optional[Dict[str, Any]]:
    """读取市场 Skill 完整内容（含正文）"""
    path = _market_item_path(skill_id)
    if not os.path.exists(path):
        return None

    try:
        with open(path, 'r', encoding='utf-8') as f:
            raw_text = f.read()
    except Exception:
        return None

    return _parse_skill_text(raw_text, source=path)


def _write_market_skill(skill: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """写入市场 Skill 正文文件并更新索引"""
    item = _normalize_skill_catalog_item(skill, index=0)
    if not item:
        return None

    os.makedirs(SKILLS_MARKET_ITEMS_DIR, exist_ok=True)
    path = _market_item_path(str(item.get('id') or ''))

    with open(path, 'w', encoding='utf-8') as f:
        f.write(_serialize_skill_text(item))

    # 更新索引
    _upsert_market_index_entry(item)
    return item


def _delete_market_skill(skill_id: str) -> bool:
    """从市场删除 Skill（正文 + 索引条目）"""
    sid = _skill_slug(skill_id, fallback='skill')
    path = _market_item_path(sid)

    if os.path.exists(path):
        try:
            os.remove(path)
        except Exception:
            pass

    # 从索引中移除
    index = _load_market_index()
    next_index = [s for s in index if str(s.get('id') or '').strip() != sid]
    _save_market_index(next_index)
    return True


def _upsert_market_index_entry(skill: Dict[str, Any]) -> None:
    """在市场索引中新增或更新一条记录"""
    sid = str(skill.get('id') or '').strip()
    index = _load_market_index()

    # 查找已有条目以保留 install_count
    existing_count = 0
    next_index: List[Dict[str, Any]] = []
    for entry in index:
        if str(entry.get('id') or '').strip() == sid:
            existing_count = int(entry.get('install_count', 0) or 0)
        else:
            next_index.append(entry)

    # 构建索引条目（不含正文，保持索引轻量）
    entry = {
        'id': sid,
        'title': str(skill.get('title') or '').strip(),
        'description': str(skill.get('description') or '').strip(),
        'author': str(skill.get('author') or '').strip(),
        'version': str(skill.get('version') or '').strip(),
        'required_tools': list(skill.get('required_tools', []) or []),
        'mode': str(skill.get('mode') or 'auto').strip(),
        'tags': list(skill.get('tags', []) or []),
        'release_date': str(skill.get('release_date') or '').strip(),
        'update_date': str(skill.get('update_date') or '').strip(),
        'install_count': existing_count,
        'source': 'user'
    }
    next_index.append(entry)
    _save_market_index(next_index)


def _increment_market_install_count(skill_id: str) -> None:
    """市场 Skill 安装计数 +1"""
    sid = str(skill_id or '').strip()
    index = _load_market_index()

    for entry in index:
        if str(entry.get('id') or '').strip() == sid:
            entry['install_count'] = int(entry.get('install_count', 0) or 0) + 1
            break

    _save_market_index(index)


def _search_market_skills(query: str = '', tag: str = '', sort: str = 'installs',
                          page: int = 1, page_size: int = 20) -> Dict[str, Any]:
    """市场 Skill 搜索/筛选/排序/分页"""
    index = _load_market_index()

    # 关键词过滤
    q = str(query or '').strip().lower()
    if q:
        filtered = []
        for item in index:
            searchable = ' '.join([
                str(item.get('title') or ''),
                str(item.get('description') or ''),
                str(item.get('author') or ''),
                ' '.join(item.get('tags', []) or [])
            ]).lower()
            if q in searchable:
                filtered.append(item)
        index = filtered

    # 标签过滤
    tag_filter = str(tag or '').strip().lower()
    if tag_filter:
        index = [
            item for item in index
            if tag_filter in [t.lower() for t in (item.get('tags', []) or [])]
        ]

    # 排序
    if sort == 'newest':
        index.sort(key=lambda x: str(x.get('update_date') or ''), reverse=True)
    elif sort == 'name':
        index.sort(key=lambda x: str(x.get('title') or '').lower())
    else:
        # 默认按安装量降序
        index.sort(key=lambda x: int(x.get('install_count', 0) or 0), reverse=True)

    # 分页
    total = len(index)
    start = (max(1, page) - 1) * page_size
    end = start + page_size
    page_items = index[start:end]

    return {
        'total': total,
        'page': max(1, page),
        'page_size': page_size,
        'skills': page_items
    }


def get_user_permission_hint_by_username(username: str) -> str:
    """
    权限提示：以 server 层用户表（load_users）为数据源，调用 basis.Permission 的纯函数。
    """
    return _permission_hint_by_username(username, loader=load_users)


def get_config_all():
    """获取配置（带 mtime 缓存，文件未变时直接返回内存副本）。核心由 Nexora.basis.Config 提供。"""
    return _config_basis.get_config_all(_main_config_migration_hook)


# 进程级服务健康监控单例装配：依赖（配置访问、历史路径）由本组装层注入，
# 单例本体与启动逻辑收敛在 App.Runtime，供后续迁移出去的域模块复用。
install_service_status_monitor(get_config_all, SERVICE_STATUS_HISTORY_PATH)


@app.before_request
def ensure_service_status_monitor_started():
    # ServiceStatusMonitor.start() 现为非阻塞（仅做线程存活检查与本地历史恢复），
    # 后台探测在独立线程中立即执行，因此 before_request 不会堵塞首个请求。
    # 保留此钩子作为兜底，确保任何入口（包括仅健康检查的部署）都能懒启动监控，
    # 真正的进程级启动在 __main__ 中已提前执行，避免首个请求承担线程创建成本。
    start_service_status_monitor()


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


_BROWSER_WS_CLIENTS = {}
_BROWSER_WS_LOCK = threading.Lock()
_PUBLIC_KNOWLEDGE_WS_CLIENTS = {}
_PUBLIC_KNOWLEDGE_WS_LOCK = threading.Lock()
_KNOWLEDGE_COLLAB_HUB = KnowledgeCollabHub()
_NEXORA_MAIL_EVENT_STREAM_LOCK = threading.Lock()
_NEXORA_MAIL_EVENT_STREAM_STARTED = False
_NEXORA_MAIL_EVENT_STREAM_CONFIG_VERSION = 0


def notify_nexora_mail_event_stream_config_changed() -> int:
    """递增邮件事件监听配置版本，让已连接监听按新配置重连。"""
    global _NEXORA_MAIL_EVENT_STREAM_CONFIG_VERSION

    with _NEXORA_MAIL_EVENT_STREAM_LOCK:
        _NEXORA_MAIL_EVENT_STREAM_CONFIG_VERSION += 1
        return _NEXORA_MAIL_EVENT_STREAM_CONFIG_VERSION


def _get_nexora_mail_event_stream_config_version() -> int:
    with _NEXORA_MAIL_EVENT_STREAM_LOCK:
        return _NEXORA_MAIL_EVENT_STREAM_CONFIG_VERSION


def _browser_ws_client_payload(event_type: str, payload: Dict[str, Any]) -> str:
    data = dict(payload if isinstance(payload, dict) else {})
    data['type'] = str(event_type or '').strip()
    data.setdefault('sent_at', int(time.time()))
    return json.dumps(data, ensure_ascii=False)


def _log_browser_ws_runtime(event_name: str, payload: Dict[str, Any]) -> None:
    safe_payload = dict(payload if isinstance(payload, dict) else {})
    safe_payload['event'] = str(event_name or '').strip()
    append_log_text(
        json.dumps(safe_payload, ensure_ascii=False, separators=(',', ':')),
        source='browser_wss',
    )


def _send_browser_ws_client(client: Dict[str, Any], event_type: str, payload: Dict[str, Any]) -> bool:
    ws = client.get('ws')
    lock = client.get('lock')
    if not ws or not lock:
        return False

    try:
        message = _browser_ws_client_payload(event_type, payload)

        with lock:
            ws.send(message)

        return True
    except Exception as e:
        _log_browser_ws_runtime('send_failed', {
            'username': str(client.get('username') or ''),
            'client_id': str(client.get('client_id') or ''),
            'event_type': str(event_type or ''),
            'message_bytes': len(str(message).encode('utf-8')),
            'error': repr(e),
        })
        return False


def _drop_browser_ws_client(username: str, client_id: str) -> None:
    with _BROWSER_WS_LOCK:
        user_clients = _BROWSER_WS_CLIENTS.get(username)
        if not user_clients:
            return

        user_clients.pop(client_id, None)

        if not user_clients:
            _BROWSER_WS_CLIENTS.pop(username, None)


def _send_browser_event_to_user(username: str, event_type: str, payload: Dict[str, Any]) -> None:
    user = str(username or '').strip()
    if not user:
        return

    with _BROWSER_WS_LOCK:
        user_clients = dict(_BROWSER_WS_CLIENTS.get(user) or {})

    dead_client_ids = []

    for client_id, client in user_clients.items():

        if not _send_browser_ws_client(client, event_type, payload):
            dead_client_ids.append(client_id)

    for client_id in dead_client_ids:
        _drop_browser_ws_client(user, client_id)


def _send_browser_event_to_all(event_type: str, payload: Dict[str, Any]) -> None:
    with _BROWSER_WS_LOCK:
        clients_snapshot = {
            user: dict(user_clients or {})
            for user, user_clients in _BROWSER_WS_CLIENTS.items()
        }

    dead_clients: List[Tuple[str, str]] = []

    for user, user_clients in clients_snapshot.items():

        for client_id, client in user_clients.items():

            if not _send_browser_ws_client(client, event_type, payload):
                dead_clients.append((user, client_id))

    for user, client_id in dead_clients:
        _drop_browser_ws_client(user, client_id)


def _public_knowledge_ws_room(owner_username: str, share_id: str) -> str:
    owner = str(owner_username or '').strip()
    sid = str(share_id or '').strip()
    return f"{owner}:{sid}" if owner and sid else ''


def _send_public_knowledge_ws_client(client: Dict[str, Any], event_type: str, payload: Dict[str, Any]) -> bool:
    ws = client.get('ws')
    lock = client.get('lock')
    if not ws or not lock:
        return False

    try:
        message = _browser_ws_client_payload(event_type, payload)

        with lock:
            ws.send(message)

        return True
    except Exception:
        return False


def _drop_public_knowledge_ws_client(room: str, client_id: str) -> None:
    safe_room = str(room or '').strip()
    if not safe_room:
        return

    with _PUBLIC_KNOWLEDGE_WS_LOCK:
        room_clients = _PUBLIC_KNOWLEDGE_WS_CLIENTS.get(safe_room)
        if not room_clients:
            return

        room_clients.pop(client_id, None)

        if not room_clients:
            _PUBLIC_KNOWLEDGE_WS_CLIENTS.pop(safe_room, None)


def _send_public_knowledge_event(
    owner_username: str,
    share_id: str,
    event_type: str,
    payload: Dict[str, Any]
) -> None:
    room = _public_knowledge_ws_room(owner_username, share_id)
    if not room:
        return

    with _PUBLIC_KNOWLEDGE_WS_LOCK:
        room_clients = dict(_PUBLIC_KNOWLEDGE_WS_CLIENTS.get(room) or {})

    dead_client_ids = []

    for client_id, client in room_clients.items():

        if not _send_public_knowledge_ws_client(client, event_type, payload):
            dead_client_ids.append(client_id)

    for client_id in dead_client_ids:
        _drop_public_knowledge_ws_client(room, client_id)


def _knowledge_content_hash(content: Any) -> str:
    return hashlib.sha256(str(content or '').encode('utf-8')).hexdigest()


def _knowledge_revision_token(value: Any) -> str:
    try:
        numeric = float(value or 0)
    except Exception:
        return str(value or '').strip()

    if numeric <= 0:
        return ''

    return f"{numeric:.6f}"


def _build_knowledge_version_payload(title: str, metadata: Any, content: Any) -> Dict[str, Any]:
    meta = metadata if isinstance(metadata, dict) else {}
    updated_at = meta.get('updated_at') or 0

    return {
        'title': str(title or '').strip(),
        'basis_id': str(meta.get('basis_id') or '').strip(),
        'updated_at': updated_at,
        'content_revision': _knowledge_revision_token(updated_at),
        'content_hash': _knowledge_content_hash(content),
    }


def _knowledge_update_response_payload(title: str, result: Any, content: Any = None, user: Optional[User] = None) -> Dict[str, Any]:
    if isinstance(result, dict):
        payload = dict(result)
        payload.setdefault('message', 'Success')
    else:
        payload = {'message': str(result or 'Success')}

    payload['success'] = True
    payload.setdefault('title', str(title or '').strip())

    if content is not None and ('content_hash' not in payload or 'content_revision' not in payload):
        meta = user.getBasisMetadata(title) if user else {}
        payload.update(_build_knowledge_version_payload(title, meta, content))

    return payload


def _knowledge_conflict_response_payload(result: Any) -> Dict[str, Any]:
    if isinstance(result, dict):
        payload = dict(result)
    else:
        payload = {'message': str(result or '知识内容保存失败')}

    payload['success'] = False
    payload.setdefault('code', 'knowledge_content_update_failed')
    return payload


def _publish_knowledge_changed_event(
    owner_username: str,
    title: str,
    payload: Dict[str, Any],
    *,
    source: str = 'knowledge_save',
    actor_username: str = '',
    share_id: str = '',
    content: Any = None,
) -> None:
    owner = str(owner_username or '').strip()
    safe_title = str(title or payload.get('title') or '').strip()

    if not owner or not safe_title:
        return

    event_payload = {
        'owner_username': owner,
        'title': safe_title,
        'source': str(source or '').strip() or 'knowledge_save',
        'actor_username': str(actor_username or '').strip(),
        'basis_id': str(payload.get('basis_id') or '').strip(),
        'updated_at': payload.get('updated_at') or 0,
        'content_revision': str(payload.get('content_revision') or '').strip(),
        'content_hash': str(payload.get('content_hash') or '').strip(),
    }

    if content is not None:
        event_payload['content'] = str(content or '')

    _send_browser_event_to_user(owner, 'knowledge_changed', event_payload)

    safe_share_id = str(share_id or payload.get('share_id') or '').strip()

    if safe_share_id:
        _send_public_knowledge_event(owner, safe_share_id, 'knowledge_changed', {
            **event_payload,
            'share_id': safe_share_id,
        })


def _invalidate_provider_models_cache_for_providers(provider_names: List[str]) -> None:
    normalized = set()

    for provider_name in provider_names or []:
        provider_key = str(provider_name or '').strip().lower()

        if provider_key:
            normalized.add(provider_key)

    if not normalized:
        return

    with _PROVIDER_MODELS_CACHE_LOCK:

        for cache_key in list(_PROVIDER_MODELS_CACHE.keys()):
            provider_key = str(cache_key or '').split('::', 1)[0].strip().lower()

            if provider_key in normalized:
                _PROVIDER_MODELS_CACHE.pop(cache_key, None)


def _warm_ollama_provider_model_cache(provider_names: List[str]) -> None:
    for provider_name in provider_names or []:
        provider = str(provider_name or '').strip()

        if not provider:
            continue

        cache_key = _provider_models_cache_key(provider, '')

        def _refresh(provider_key=provider, provider_cache_key=cache_key):
            ok, _, payload = _fetch_provider_models_live(provider_key, '', timeout=8.0)

            if ok:
                _provider_models_cache_set(provider_cache_key, payload)

        _launch_provider_models_refresh_bg(
            cache_key,
            _refresh,
            min_interval_sec=20.0
        )


def notify_models_config_changed(
    source: str = 'models_config_save',
    models_cfg: Optional[Dict[str, Any]] = None,
) -> None:
    global _MODELS_CONFIG_SYNC_LAST_ERROR

    try:
        # provider / model 变更后必须清理已缓存的 OpenAI 客户端，
        # 否则更新后的 api_key / base_url 仍走旧连接，导致重答复现旧错误。
        try:
            _CLIENT_CACHE.clear()
        except Exception:
            pass

        try:
            import App.Core.model as _model_module

            cache = getattr(_model_module, '_CLIENT_CACHE', None)

            if isinstance(cache, dict):
                cache.clear()

            # 同步刷新运行时 CONFIG，避免新请求仍读旧内存配置
            try:
                _model_module.CONFIG = _model_module.load_config()
            except Exception:
                pass
        except Exception:
            pass

        sync_state = build_models_config_sync_state(models_cfg)
        ollama_providers = sync_state.get('ollama_providers', [])

        if isinstance(ollama_providers, list):
            _invalidate_provider_models_cache_for_providers(ollama_providers)
            _warm_ollama_provider_model_cache(ollama_providers)

        payload = {
            **sync_state,
            'source': str(source or 'models_config_save').strip() or 'models_config_save',
        }
        _send_browser_event_to_all('model_config_changed', payload)
        _MODELS_CONFIG_SYNC_LAST_ERROR = ''
    except Exception as e:
        _MODELS_CONFIG_SYNC_LAST_ERROR = str(e)
        print(f"[Model Sync] notify failed: {e}")


def _send_browser_event_to_conversation(username: str, conversation_id: str, event_type: str, payload: Dict[str, Any]) -> None:
    user = str(username or '').strip()
    target_conversation_id = str(conversation_id or '').strip()
    if not user or not target_conversation_id:
        return

    with _BROWSER_WS_LOCK:
        user_clients = dict(_BROWSER_WS_CLIENTS.get(user) or {})

    dead_client_ids = []

    for client_id, client in user_clients.items():
        client_conversation_id = str(client.get('conversation_id') or '').strip()

        if client_conversation_id != target_conversation_id:
            continue

        if _send_browser_ws_client(client, event_type, payload):
            break

        dead_client_ids.append(client_id)

    for client_id in dead_client_ids:
        _drop_browser_ws_client(user, client_id)


def _publish_agent_status_event(username: str, online: bool) -> None:
    _send_browser_event_to_user(
        username,
        'agent_status',
        {
            'online': bool(online),
            'source': 'agent_tunnel',
        }
    )


def _publish_client_tool_request_event(username: str, conversation_id: str, request_obj: Dict[str, Any]) -> None:
    if not isinstance(request_obj, dict):
        return

    _send_browser_event_to_conversation(
        username,
        conversation_id,
        'client_tool_request',
        {
            'conversation_id': str(conversation_id or '').strip(),
            'request': request_obj,
        }
    )


def _normalize_mail_event_identity(value: Any) -> str:
    return str(value or '').strip().lower()


def _find_users_for_mail_event(group: str, mail_username: str, address: str) -> List[str]:
    group_key = _normalize_mail_event_identity(group)
    username_key = _normalize_mail_event_identity(mail_username)
    address_key = _normalize_mail_event_identity(address)
    address_local = address_key.split('@', 1)[0] if '@' in address_key else ''
    users = load_users()
    matched = []

    if not isinstance(users, dict):
        return matched

    for user_id, user_data in users.items():
        if not isinstance(user_data, dict):
            continue

        local_mail = user_data.get('local_mail')
        if not isinstance(local_mail, dict):
            continue

        if _normalize_mail_event_identity(local_mail.get('provider')) != 'nexoramail':
            continue

        bound_group = _normalize_mail_event_identity(local_mail.get('group') or 'default')
        bound_username = _normalize_mail_event_identity(local_mail.get('username'))
        bound_address = _normalize_mail_event_identity(local_mail.get('address'))

        if group_key and bound_group != group_key:
            continue

        username_matched = username_key and bound_username == username_key
        address_matched = address_key and bound_address == address_key
        localpart_matched = address_local and bound_username == address_local

        if username_matched or address_matched or localpart_matched:
            matched.append(str(user_id))

    return matched


def _publish_mail_event_for_users(user_ids: List[str], payload: Dict[str, Any]) -> None:
    event_payload = dict(payload if isinstance(payload, dict) else {})
    event_payload['source'] = 'nexora_mail'

    for user_id in user_ids:
        _mail_cache_invalidate_user(user_id)
        _send_browser_event_to_user(user_id, 'mail_changed', event_payload)


def _build_nexora_mail_event_ws_url(service_url: str, cursor: Any) -> str:
    parsed = urllib_parse.urlsplit(str(service_url or '').strip().rstrip('/'))

    if parsed.scheme == 'https':
        scheme = 'wss'
    elif parsed.scheme == 'http':
        scheme = 'ws'
    else:
        raise ValueError('NexoraMail service_url must start with http:// or https://')

    query = urllib_parse.urlencode({'cursor': str(cursor if cursor is not None else 'end')})
    return urllib_parse.urlunsplit((scheme, parsed.netloc, '/api/events/ws', query, ''))


def _handle_nexora_mail_stream_event(event_payload: Dict[str, Any]) -> None:
    if not isinstance(event_payload, dict):
        return

    group = str(event_payload.get('group') or _get_nexora_mail_config().get('default_group') or 'default').strip() or 'default'
    mail_username = str(event_payload.get('mail_username') or event_payload.get('username') or '').strip()
    address = str(event_payload.get('address') or event_payload.get('recipient') or '').strip()
    user_ids = _find_users_for_mail_event(group, mail_username, address)

    if not user_ids:
        print(
            '[NexoraMail WSS] no matched user '
            f'group={group} mail_username={mail_username} address={address}'
        )
        return

    payload = dict(event_payload)
    payload['group'] = group
    _publish_mail_event_for_users(user_ids, payload)


def _nexora_mail_event_stream_loop() -> None:
    cursor: Any = 'end'

    while True:
        cfg = _get_nexora_mail_config()
        observed_config_version = _get_nexora_mail_event_stream_config_version()

        if not cfg.get('enabled') or not cfg.get('api_key'):
            time.sleep(10)
            continue

        ws = None

        try:
            import websocket

            ws_url = _build_nexora_mail_event_ws_url(cfg.get('service_url'), cursor)
            ws = websocket.WebSocket()
            ws.connect(
                ws_url,
                timeout=10,
                header=[f"X-API-Key: {cfg.get('api_key')}"]
            )
            ws.settimeout(5)
            print(f"[NexoraMail WSS] connected {ws_url}")

            while True:
                if observed_config_version != _get_nexora_mail_event_stream_config_version():
                    print("[NexoraMail WSS] reconnect requested by system settings update")
                    break

                try:
                    raw = ws.recv()
                except websocket.WebSocketTimeoutException:
                    continue

                if not raw:
                    continue

                data = json.loads(raw)
                msg_type = str(data.get('type') or '').strip()

                if data.get('cursor') is not None:
                    cursor = data.get('cursor')

                if msg_type == 'mail_event':
                    _handle_nexora_mail_stream_event(data.get('event') if isinstance(data.get('event'), dict) else {})
                elif msg_type == 'error':
                    raise RuntimeError(str(data.get('message') or 'NexoraMail event stream error'))

        except Exception as e:
            print(f"[NexoraMail WSS] disconnected: {e}")
            time.sleep(5)
        finally:
            if ws is not None:
                try:
                    ws.close()
                except Exception:
                    pass


def start_nexora_mail_event_stream() -> None:
    global _NEXORA_MAIL_EVENT_STREAM_STARTED

    with _NEXORA_MAIL_EVENT_STREAM_LOCK:
        if _NEXORA_MAIL_EVENT_STREAM_STARTED:
            return

        _NEXORA_MAIL_EVENT_STREAM_STARTED = True

    worker = threading.Thread(
        target=_nexora_mail_event_stream_loop,
        daemon=True,
        name='nexora-mail-event-wss'
    )
    worker.start()


add_agent_status_listener(_publish_agent_status_event)
add_request_listener(_publish_client_tool_request_event)

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

_KNOWLEDGE_IMAGE_ALLOWED_MIME = set(_ASSET_IMAGE_MIME_TO_EXT.keys())
_KNOWLEDGE_IMAGE_MAX_BYTES = 12 * 1024 * 1024  # 12MB
_KNOWLEDGE_IMAGE_ID_RE = re.compile(r"^kimg_[a-z0-9]{16}$")


def _knowledge_image_root(username: str) -> str:
    return safe_join_path(_resolve_user_root_dir(username), 'database', 'static', 'images')


def _knowledge_image_index_path(username: str) -> str:
    return safe_join_path(_knowledge_image_root(username), 'index.json')


def _load_knowledge_image_index(username: str) -> Dict[str, Any]:
    idx_path = _knowledge_image_index_path(username)
    if not os.path.exists(idx_path):
        return {"images": {}}
    try:
        with open(idx_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"images": {}}
        images = data.get("images")
        if not isinstance(images, dict):
            images = {}
        data["images"] = images
        return data
    except Exception:
        return {"images": {}}


def _save_knowledge_image_index(username: str, data: Dict[str, Any]) -> None:
    root = _knowledge_image_root(username)
    os.makedirs(root, exist_ok=True)
    idx_path = _knowledge_image_index_path(username)
    payload = data if isinstance(data, dict) else {"images": {}}
    if "images" not in payload or not isinstance(payload.get("images"), dict):
        payload["images"] = {}
    with open(idx_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def _normalize_knowledge_image_id(raw: Any) -> str:
    text = str(raw or '').strip().lower()
    if _KNOWLEDGE_IMAGE_ID_RE.match(text):
        return text
    return ""


def _guess_image_mime_from_name(file_name: str) -> str:
    name = str(file_name or '').strip().lower()
    if name.endswith('.png'):
        return 'image/png'
    if name.endswith('.jpg') or name.endswith('.jpeg'):
        return 'image/jpeg'
    if name.endswith('.webp'):
        return 'image/webp'
    if name.endswith('.gif'):
        return 'image/gif'
    if name.endswith('.bmp'):
        return 'image/bmp'
    if name.endswith('.tiff') or name.endswith('.tif'):
        return 'image/tiff'
    if name.endswith('.heic'):
        return 'image/heic'
    if name.endswith('.heif'):
        return 'image/heif'
    return ''


def _decode_knowledge_image_base64(raw_base64: str, mime_hint: str = "") -> Tuple[str, bytes]:
    text = str(raw_base64 or "").strip()
    if not text:
        raise ValueError("empty image_base64")
    if text.startswith('data:image/'):
        mime, raw = _parse_image_data_url(text)
        return mime, raw
    mime = str(mime_hint or '').strip().lower() or 'image/png'
    if mime not in _KNOWLEDGE_IMAGE_ALLOWED_MIME:
        raise ValueError("unsupported image mime")
    try:
        raw = base64.b64decode(text, validate=True)
    except Exception as e:
        raise ValueError(f"invalid base64: {str(e)}")
    return mime, raw


def _download_knowledge_image_from_url(source_url: str) -> Tuple[str, bytes]:
    raw_url = str(source_url or '').strip()
    if not raw_url:
        raise ValueError("source_url is required")
    parsed = urllib_parse.urlparse(raw_url)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError("only http/https source_url is allowed")
    req = urllib_request.Request(raw_url, headers={"User-Agent": "NexoraKnowledgeImageFetcher/1.0"})
    try:
        with urllib_request.urlopen(req, timeout=15) as resp:
            content_type = str(resp.headers.get('Content-Type') or '').split(';', 1)[0].strip().lower()
            raw = resp.read(_KNOWLEDGE_IMAGE_MAX_BYTES + 1)
    except Exception as e:
        raise ValueError(f"download failed: {str(e)}")
    if len(raw) > _KNOWLEDGE_IMAGE_MAX_BYTES:
        raise ValueError(f"image too large (max {_KNOWLEDGE_IMAGE_MAX_BYTES} bytes)")
    mime = content_type if content_type in _KNOWLEDGE_IMAGE_ALLOWED_MIME else ''
    if not mime:
        guessed = _guess_image_mime_from_name(parsed.path)
        mime = guessed if guessed in _KNOWLEDGE_IMAGE_ALLOWED_MIME else ''
    if not mime:
        raise ValueError("unsupported source image mime")
    return mime, raw


def _persist_knowledge_image_bytes(
    *,
    owner_username: str,
    image_id: str,
    image_bytes: bytes,
    mime: str,
    original_name: str = "",
    basis_title: str = "",
) -> Dict[str, Any]:
    owner = str(owner_username or '').strip()
    if not owner:
        raise ValueError("owner username is required")
    safe_id = _normalize_knowledge_image_id(image_id)
    if not safe_id:
        raise ValueError("invalid image_id")
    raw = bytes(image_bytes or b"")
    if not raw:
        raise ValueError("empty image content")
    if len(raw) > _KNOWLEDGE_IMAGE_MAX_BYTES:
        raise ValueError(f"image too large (max {_KNOWLEDGE_IMAGE_MAX_BYTES} bytes)")
    mt = str(mime or '').strip().lower()
    if mt not in _KNOWLEDGE_IMAGE_ALLOWED_MIME:
        raise ValueError("unsupported image mime")
    ext = _safe_asset_ext(mt)
    file_name = f"{safe_id}{ext}"
    root = _knowledge_image_root(owner)
    os.makedirs(root, exist_ok=True)
    fpath = safe_join_path(root, file_name)
    with open(fpath, 'wb') as f:
        f.write(raw)
    now_ts = int(time.time())
    idx = _load_knowledge_image_index(owner)
    images = idx.get("images", {})
    current = images.get(safe_id, {}) if isinstance(images.get(safe_id), dict) else {}
    images[safe_id] = {
        "image_id": safe_id,
        "owner": owner,
        "file_name": file_name,
        "mime": mt,
        "size": len(raw),
        "original_name": str(original_name or current.get("original_name") or '').strip(),
        "basis_title": str(basis_title or current.get("basis_title") or '').strip(),
        "created_at": int(current.get("created_at") or now_ts),
        "updated_at": now_ts,
        "status": "ready",
    }
    idx["images"] = images
    _save_knowledge_image_index(owner, idx)
    return images[safe_id]


def _conversation_asset_root(username: str) -> str:
    return asset_store.conversation_asset_root(username)


def _conversation_asset_dir(username: str, conversation_id: str) -> str:
    return asset_store.conversation_asset_dir(username, conversation_id)


def _conversation_asset_index_path(username: str, conversation_id: str) -> str:
    return asset_store.conversation_asset_index_path(username, conversation_id)


def _load_conversation_asset_index(username: str, conversation_id: str) -> Dict[str, Any]:
    return asset_store.load_conversation_asset_index(username, conversation_id)


def _save_conversation_asset_index(username: str, conversation_id: str, data: Dict[str, Any]):
    asset_store.save_conversation_asset_index(username, conversation_id, data)


def _parse_image_data_url(raw_url: str):
    return asset_store.parse_image_data_url(raw_url)


def _safe_asset_ext(mime: str) -> str:
    return asset_store.safe_asset_ext(mime)


def _persist_conversation_image_asset(username: str, conversation_id: str, file_item: Dict[str, Any]) -> Dict[str, Any]:
    return asset_store.persist_conversation_image_asset(username, conversation_id, file_item)


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
    return asset_store.collect_referenced_asset_ids(conversation_data)


def _cleanup_conversation_assets(username: str, conversation_id: str, keep_asset_ids: Optional[set] = None):
    asset_store.cleanup_conversation_assets(username, conversation_id, keep_asset_ids)


def _remove_conversation_assets_dir(username: str, conversation_id: str):
    asset_store.remove_conversation_assets_dir(username, conversation_id)


def _resolve_user_root_dir(username: str) -> str:
    return _resolve_user_base_path(username)


def _user_trash_dir(username: str) -> str:
    return safe_join_path(_resolve_user_root_dir(username), 'trash')


def _normalize_preview_text(text: Any, max_len: int = 280) -> str:
    src = str(text or '').replace('\r\n', '\n').replace('\r', '\n')
    src = re.sub(r'\s+', ' ', src).strip()
    if len(src) <= max_len:
        return src
    return src[:max_len].rstrip() + '...'


def _stringify_message_content(content: Any) -> str:
    if content is None:
        return ''
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, str):
                t = item.strip()
                if t:
                    parts.append(t)
                continue
            if isinstance(item, dict):
                t = str(item.get('text') or item.get('input_text') or item.get('content') or '').strip()
                if t:
                    parts.append(t)
        return '\n'.join(parts)
    if isinstance(content, dict):
        t = str(content.get('text') or content.get('input_text') or content.get('content') or '').strip()
        if t:
            return t
    return str(content)


def _extract_last_conversation_preview(conversation: Dict[str, Any]) -> str:
    if not isinstance(conversation, dict):
        return ''
    messages = conversation.get('messages', [])
    if not isinstance(messages, list):
        return ''
    for msg in reversed(messages):
        if not isinstance(msg, dict):
            continue
        text = _normalize_preview_text(_stringify_message_content(msg.get('content')), max_len=320)
        if text:
            return text
    return ''


def _as_iso_datetime(value: Any) -> str:
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value)).isoformat()
        except Exception:
            return ''
    text = str(value or '').strip()
    if not text:
        return ''
    try:
        normalized = text[:-1] + '+00:00' if text.endswith('Z') else text
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is not None:
            dt = dt.astimezone().replace(tzinfo=None)
        return dt.isoformat()
    except Exception:
        return ''


def _trash_write_entry(username: str, entry: Dict[str, Any]) -> Tuple[bool, str, Dict[str, Any]]:
    payload = dict(entry or {})
    trash_dir = _user_trash_dir(username)
    try:
        os.makedirs(trash_dir, exist_ok=True)
        entry_id = str(payload.get('id') or f"trash_{int(time.time() * 1000)}_{uuid.uuid4().hex[:10]}")
        payload['id'] = entry_id
        if not payload.get('deleted_at'):
            payload['deleted_at'] = datetime.now().isoformat()
        file_path = safe_join_path(trash_dir, f"{entry_id}.json")
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        return True, '', payload
    except Exception as e:
        return False, str(e), {}


def _trash_list_entries(username: str, limit: int = 120) -> List[Dict[str, Any]]:
    trash_dir = _user_trash_dir(username)
    if not os.path.isdir(trash_dir):
        return []
    out: List[Dict[str, Any]] = []
    for name in os.listdir(trash_dir):
        if not str(name or '').lower().endswith('.json'):
            continue
        path = safe_join_path(trash_dir, name)
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if not isinstance(data, dict):
                continue
            out.append({
                'id': str(data.get('id') or name[:-5]),
                'type': str(data.get('type') or 'unknown'),
                'title': str(data.get('title') or ''),
                'preview': _normalize_preview_text(data.get('preview') or '', max_len=420),
                'deleted_at': _as_iso_datetime(data.get('deleted_at')) or '',
                'changed_at': _as_iso_datetime(data.get('changed_at')) or '',
                'conversation_id': str(data.get('conversation_id') or ''),
                'knowledge_title': str(data.get('knowledge_title') or '')
            })
        except Exception:
            continue

    def _sort_key(item: Dict[str, Any]):
        ts = _as_iso_datetime(item.get('deleted_at'))
        return ts or ''

    out.sort(key=_sort_key, reverse=True)
    safe_limit = max(1, min(500, int(limit or 120)))
    return out[:safe_limit]


def _trash_entry_file_path(username: str, trash_id: str) -> str:
    tid = safe_filename(trash_id, default='')
    if not tid:
        return ''
    return safe_join_path(_user_trash_dir(username), f"{tid}.json")


def _trash_read_entry(username: str, trash_id: str) -> Optional[Dict[str, Any]]:
    path = _trash_entry_file_path(username, trash_id)
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _trash_remove_entry(username: str, trash_id: str) -> bool:
    path = _trash_entry_file_path(username, trash_id)
    if not path or (not os.path.exists(path)):
        return False
    try:
        os.remove(path)
        return True
    except Exception:
        return False


def _trash_clear_entries(username: str) -> int:
    trash_dir = _user_trash_dir(username)
    if not os.path.isdir(trash_dir):
        return 0
    removed = 0
    for name in os.listdir(trash_dir):
        if not str(name or '').lower().endswith('.json'):
            continue
        path = safe_join_path(trash_dir, name)
        try:
            os.remove(path)
            removed += 1
        except Exception:
            continue
    return removed


def _restore_conversation_from_trash(username: str, payload: Dict[str, Any], title_hint: str = '') -> Tuple[bool, str, Dict[str, Any]]:
    src = payload if isinstance(payload, dict) else {}
    restored_title = str(title_hint or src.get('title') or '恢复的对话').strip() or '恢复的对话'
    original_conversation_id = str(src.get('conversation_id') or '').strip()

    if not original_conversation_id:
        return False, '回收站对话缺少原 conversation_id，无法恢复关系', {}

    manager = ConversationService(username)

    try:
        restored_conversation_id = manager.restore_conversation(
            src,
            original_conversation_id,
            title=restored_title,
        )
        app.logger.info(
            'conversation restored with original relationship id username=%s conversation_id=%s',
            username,
            restored_conversation_id,
        )
        return True, '', {"conversation_id": restored_conversation_id, "title": restored_title}
    except Exception as e:
        app.logger.error(
            'conversation restore failed username=%s original_conversation_id=%s error=%s',
            username,
            original_conversation_id,
            e,
        )
        return False, str(e), {}


def _restore_basis_from_trash(username: str, payload: Dict[str, Any], title_hint: str = '') -> Tuple[bool, str, Dict[str, Any]]:
    src = payload if isinstance(payload, dict) else {}
    raw_title = str(title_hint or src.get('title') or '恢复知识').strip() or '恢复知识'
    content = str(src.get('content') or '').strip()
    if not content:
        return False, '知识内容为空', {}
    metadata = src.get('metadata') if isinstance(src.get('metadata'), dict) else {}
    url = str(metadata.get('url') or '').strip()
    user = User(username)
    try:
        basis_map = user.getBasis()
    except Exception:
        basis_map = {}

    target_title = raw_title
    if isinstance(basis_map, dict) and target_title in basis_map:
        for i in range(1, 1000):
            candidate = f"{raw_title} (恢复{i})"
            if candidate not in basis_map:
                target_title = candidate
                break
    add_res = user.addBasis(target_title, content, url)
    ok = bool(add_res)
    msg = ''
    if isinstance(add_res, tuple):
        ok = bool(add_res[0]) if len(add_res) > 0 else False
        msg = str(add_res[1] or '') if len(add_res) > 1 else ''
    if not ok:
        return False, str(msg or '恢复失败'), {}
    return True, '', {"title": target_title}


def _archive_conversation_to_trash(username: str, conversation_id: str, conversation: Dict[str, Any]) -> Tuple[bool, str]:
    convo = conversation if isinstance(conversation, dict) else {}
    title = str(convo.get('title') or '未命名对话').strip() or '未命名对话'
    preview = _extract_last_conversation_preview(convo)
    changed_at = _as_iso_datetime(convo.get('updated_at')) or _as_iso_datetime(convo.get('created_at')) or ''
    payload = {
        'type': 'conversation',
        'title': title,
        'preview': preview,
        'conversation_id': str(conversation_id or '').strip(),
        'changed_at': changed_at,
        'deleted_at': datetime.now().isoformat(),
        'payload': convo
    }
    ok, err, _ = _trash_write_entry(username, payload)
    return ok, err


def _archive_basis_to_trash(username: str, user: User, title: str) -> Tuple[bool, str]:
    safe_title = str(title or '').strip()
    if not safe_title:
        return False, '标题为空'
    try:
        content = str(user.getBasisContent(safe_title) or '')
    except Exception as e:
        return False, f'读取知识内容失败: {str(e)}'
    meta = {}
    try:
        loaded_meta = user.getBasisMetadata(safe_title)
        if isinstance(loaded_meta, dict):
            meta = loaded_meta
    except Exception:
        meta = {}
    changed_at = (
        _as_iso_datetime(meta.get('updated_at'))
        or _as_iso_datetime(meta.get('vector_updated_at'))
        or ''
    )
    payload = {
        'type': 'knowledge_basis',
        'title': safe_title,
        'knowledge_title': safe_title,
        'preview': _normalize_preview_text(content, max_len=420),
        'changed_at': changed_at,
        'deleted_at': datetime.now().isoformat(),
        'payload': {
            'title': safe_title,
            'content': content,
            'metadata': meta
        }
    }
    ok, err, _ = _trash_write_entry(username, payload)
    return ok, err


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


def load_models_config():
    """读取 models.json，返回标准结构。核心由 Nexora.basis.Config 提供。"""
    return _config_basis.load_models_config()


def save_models_config(models_cfg, sync_source: str = 'models_config_save'):
    """保存 models.json。核心由 Nexora.basis.Config 提供。"""
    return _config_basis.save_models_config(
        models_cfg,
        sync_hook=notify_models_config_changed,
        sync_source=sync_source,
    )


def _models_config_sync_file_payload() -> Tuple[bytes, Dict[str, Any], int, int]:
    if not os.path.exists(MODELS_PATH):
        return b'', {"models": {}, "providers": {}}, 0, 0

    stat = os.stat(MODELS_PATH)

    with open(MODELS_PATH, 'rb') as f:
        raw = f.read()

    data = json.loads(raw.decode('utf-8-sig')) if raw else {}

    if not isinstance(data, dict):
        data = {"models": {}, "providers": {}}

    return raw, data, int(stat.st_mtime), int(stat.st_mtime_ns)


def _extract_ollama_provider_names(models_cfg: Dict[str, Any]) -> List[str]:
    cfg = models_cfg if isinstance(models_cfg, dict) else {}
    providers = cfg.get('providers', {}) if isinstance(cfg.get('providers'), dict) else {}
    names: List[str] = []

    for provider_name, provider_cfg in providers.items():

        if not isinstance(provider_cfg, dict):
            continue

        api_type = str(provider_cfg.get('api_type', '') or '').strip().lower()

        if api_type == 'ollama':
            names.append(str(provider_name or '').strip())

    return sorted([name for name in names if name], key=lambda item: item.lower())


def build_models_config_sync_state(models_cfg: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    if isinstance(models_cfg, dict):
        cfg = models_cfg
        raw = json.dumps(
            {
                "models": cfg.get("models", {}),
                "providers": cfg.get("providers", {}),
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(',', ':')
        ).encode('utf-8')
        updated_at = 0
        mtime_ns = 0

        if os.path.exists(MODELS_PATH):
            stat = os.stat(MODELS_PATH)
            updated_at = int(stat.st_mtime)
            mtime_ns = int(stat.st_mtime_ns)
    else:
        raw, cfg, updated_at, mtime_ns = _models_config_sync_file_payload()

    models = cfg.get('models', {}) if isinstance(cfg.get('models'), dict) else {}
    providers = cfg.get('providers', {}) if isinstance(cfg.get('providers'), dict) else {}
    fingerprint = hashlib.sha256(raw).hexdigest() if raw else ''
    version = f'{mtime_ns}:{fingerprint[:16]}' if fingerprint else str(mtime_ns or 0)

    return {
        'version': version,
        'fingerprint': fingerprint,
        'updated_at': updated_at,
        'model_count': len(models),
        'provider_count': len(providers),
        'ollama_providers': _extract_ollama_provider_names(cfg),
    }


def _normalize_model_status_text(raw_status: Any) -> str:
    status = str(raw_status or 'normal').strip().lower()
    if not status:
        return 'normal'

    alias = {
        'enable': 'normal',
        'enabled': 'normal',
        'normal': 'normal',
        'active': 'normal',
        'ok': 'normal',
        'on': 'normal',
        'disable': 'disabled',
        'disabled': 'disabled',
        'off': 'off',
        'stopped': 'stopped',
        'stop': 'stopped',
        'quota-disabled': 'quota_disabled',
        'quota disabled': 'quota_disabled',
        'quota_exhausted': 'quota_exhausted',
        'quota exhausted': 'quota_exhausted',
        'ban': 'disabled',
        'banned': 'disabled',
        'forbidden': 'disabled',
        'inactive': 'disabled',
        '禁用': 'disabled',
        '停用': 'disabled',
        '关闭': 'off',
        '已关闭': 'off',
        '停止': 'stopped',
        '已停用': 'disabled',
        '已禁用': 'disabled',
    }
    return alias.get(status, status)


def _is_model_disabled_status(raw_status: Any) -> bool:
    return _normalize_model_status_text(raw_status) in DISABLED_MODEL_STATUSES


def _is_model_disabled_entry(model_info: Any) -> bool:
    info = model_info if isinstance(model_info, dict) else {}
    return _is_model_disabled_status(info.get('status', 'normal'))


def _disable_model_by_quota(model_id: Any, provider_name: Any = None, reason: str = 'quota_exhausted') -> Dict[str, Any]:
    model_key = str(model_id or '').strip()
    provider = str(provider_name or '').strip()
    if not model_key:
        return {'success': False, 'changed': False, 'message': 'model_id 不能为空'}

    cfg = load_models_config()
    models = cfg.setdefault('models', {})
    model_info = models.get(model_key)
    if not isinstance(model_info, dict):
        return {'success': False, 'changed': False, 'message': '模型不存在'}

    model_provider = str(model_info.get('provider') or '').strip()
    if provider and model_provider and provider != model_provider:
        return {
            'success': False,
            'changed': False,
            'message': f'provider 不匹配: expect={provider} actual={model_provider}',
        }

    current_status = _normalize_model_status_text(model_info.get('status', 'normal'))
    if _is_model_disabled_status(current_status):
        return {
            'success': True,
            'changed': False,
            'status': current_status,
            'provider': model_provider,
            'model': model_key,
        }

    next_status = 'quota_disabled'
    model_info['status'] = next_status
    model_info['status_reason'] = str(reason or 'quota_exhausted').strip() or 'quota_exhausted'
    model_info['status_updated_at'] = int(time.time())
    models[model_key] = model_info
    save_models_config(cfg)
    return {
        'success': True,
        'changed': True,
        'status': next_status,
        'provider': model_provider,
        'model': model_key,
    }


def _is_quota_disabled_status(raw_status: Any) -> bool:
    return _normalize_model_status_text(raw_status) in {'quota_disabled', 'quota_exhausted'}


def _can_auto_recover_quota_disabled_model(model_info: Dict[str, Any]) -> bool:
    info = model_info if isinstance(model_info, dict) else {}
    if not _is_quota_disabled_status(info.get('status', '')):
        return False
    # Guardrail: only auto-recover statuses that look quota-generated.
    reason = str(info.get('status_reason') or '').strip().lower()
    if not reason:
        return True
    return reason in {
        'quota_exhausted',
        'quota_disabled',
        'quota_auto_disabled',
        'over_budget',
    }


def _recover_model_from_quota_disable(
    model_id: Any,
    provider_name: Any = None,
    quota_gate: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    model_key = str(model_id or '').strip()
    provider = str(provider_name or '').strip()
    if not model_key:
        return {'success': False, 'changed': False, 'message': 'missing model_id'}

    cfg = load_models_config()
    models = cfg.setdefault('models', {})
    model_info = models.get(model_key)
    if not isinstance(model_info, dict):
        return {'success': False, 'changed': False, 'message': 'model not found'}
    if not _can_auto_recover_quota_disabled_model(model_info):
        return {'success': True, 'changed': False, 'message': 'model is not auto-recoverable quota status'}

    model_provider = str(model_info.get('provider') or '').strip()
    effective_provider = model_provider or provider
    gate = quota_gate if isinstance(quota_gate, dict) else get_generation_quota_gate(
        provider_name=effective_provider,
        model_name=model_key
    )
    should_keep_disabled = bool(gate.get('should_disable_model') or gate.get('should_block'))
    if should_keep_disabled:
        return {
            'success': True,
            'changed': False,
            'message': 'quota gate still blocks model',
            'provider': model_provider,
            'model': model_key,
        }

    model_info['status'] = 'normal'
    model_info.pop('status_reason', None)
    model_info['status_updated_at'] = int(time.time())
    models[model_key] = model_info
    save_models_config(cfg)
    return {
        'success': True,
        'changed': True,
        'status': 'normal',
        'provider': model_provider,
        'model': model_key,
    }


def _recover_quota_disabled_models(provider_name: Any = None) -> Dict[str, Any]:
    provider_filter = str(provider_name or '').strip().lower()
    cfg = load_models_config()
    models = cfg.setdefault('models', {})
    changed_models: List[str] = []
    checked = 0

    for model_id, model_info in list(models.items()):
        if not isinstance(model_info, dict):
            continue
        if not _can_auto_recover_quota_disabled_model(model_info):
            continue
        model_provider = str(model_info.get('provider') or '').strip()
        if provider_filter and model_provider.lower() != provider_filter:
            continue
        checked += 1
        gate = get_generation_quota_gate(provider_name=model_provider, model_name=model_id)
        if bool(gate.get('should_disable_model') or gate.get('should_block')):
            continue
        model_info['status'] = 'normal'
        model_info.pop('status_reason', None)
        model_info['status_updated_at'] = int(time.time())
        models[model_id] = model_info
        changed_models.append(model_id)

    if changed_models:
        save_models_config(cfg)
    return {
        'checked': checked,
        'changed': len(changed_models),
        'models': changed_models,
    }


def _build_quota_block_message(quota_gate: Dict[str, Any], model_name: str) -> str:
    gate = quota_gate if isinstance(quota_gate, dict) else {}
    reason = str(gate.get('reason') or '').strip().lower()
    model_status = gate.get('model_status', {}) if isinstance(gate.get('model_status'), dict) else {}
    quota_status = gate.get('quota', {}) if isinstance(gate.get('quota'), dict) else {}
    action = _normalize_quota_on_exhausted_action(gate.get('provider_on_exhausted', gate.get('on_exhausted')))

    if reason == 'model_exhausted':
        model_remaining = int(model_status.get('remaining_tokens', 0) or 0)
        if action in {'disable_model', 'disable_and_notify'}:
            return f'模型已停用：{model_name} 超出额度（剩余 {model_remaining}）。'
        return f'模型额度已超出：{model_name}（剩余 {model_remaining}）。'

    remaining_tokens = int(quota_status.get('remaining_tokens', 0) or 0)
    return f'服务器额度已用尽（剩余 {remaining_tokens}）。'


def _build_over_budget_unavailable_response(extra_payload: Optional[Dict[str, Any]] = None):
    payload: Dict[str, Any] = {
        'success': False,
        'message': 'Server is not available: Over budget',
    }
    if isinstance(extra_payload, dict):
        payload.update(extra_payload)
    return jsonify(payload), 429


def _is_rate_limit_exception(exc: Exception) -> bool:
    if exc is None:
        return False

    def _safe_status_code(value: Any) -> int:
        try:
            if value is None:
                return 0
            return int(value)
        except Exception:
            return 0

    direct_status = _safe_status_code(getattr(exc, 'status_code', None))
    if direct_status == 429:
        return True

    response_obj = getattr(exc, 'response', None)
    if response_obj is not None:
        response_status = _safe_status_code(getattr(response_obj, 'status_code', None))
        if response_status == 429:
            return True

    text = str(exc or '').strip().lower()
    if not text:
        return False
    patterns = (
        'rate limit',
        'too many requests',
        'insufficient_quota',
        'exceeded your current quota',
        'quota exceeded',
        'global rate limit',
        'resource exhausted',
    )
    return any(pattern in text for pattern in patterns)


def _fetch_aliyun_models_page(provider_cfg, *, page_no=1, page_size=100, timeout=8.0):
    cfg = provider_cfg if isinstance(provider_cfg, dict) else {}
    api_key = str(cfg.get('api_key', '') or '').strip()
    if not api_key:
        return {}
    base = str(cfg.get('models_catalog_url', '') or '').strip() or 'https://dashscope.aliyuncs.com/api/v1/models'
    req_page_no = max(1, int(page_no or 1))
    req_page_size = max(1, min(500, int(page_size or 100)))
    try:
        resp = httpx.get(
            base,
            params={'page_no': req_page_no, 'page_size': req_page_size},
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            },
            timeout=max(2.0, float(timeout or 8.0)),
            follow_redirects=True
        )
        if int(resp.status_code or 0) >= 400:
            return {}
        return resp.json() if str(resp.text or '').strip() else {}
    except Exception:
        return {}


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

def _get_rag_database_config():
    """Read RAG database configuration."""
    config = get_config_all()
    rag = config.get('rag_database', {})
    if not isinstance(rag, dict):
        return {}
    return rag


def _is_rag_database_enabled():
    """Return whether the RAG database switch is enabled."""
    rag = _get_rag_database_config()
    return bool(rag.get('rag_database_enabled', False))


def _is_knowledge_vectorization_enabled():
    """Return whether knowledge vectorization can run with the current RAG configuration."""
    rag = _get_rag_database_config()

    if not rag.get('rag_database_enabled', False):
        return False

    mode = str(rag.get('mode') or '').strip().lower()

    if mode != 'service':
        return False

    service_url = str(rag.get('service_url') or '').strip()
    host = str(rag.get('host') or '').strip()
    port = str(rag.get('port') or '').strip()

    return bool(service_url or (host and port))


def _knowledge_vector_status_payload():
    """Build a public, non-secret knowledge vectorization status payload."""
    rag = _get_rag_database_config()
    enabled = _is_knowledge_vectorization_enabled()
    mode = str(rag.get('mode') or '').strip().lower()
    service_url = str(rag.get('service_url') or '').strip()
    host = str(rag.get('host') or '').strip()
    port = str(rag.get('port') or '').strip()
    reason = ''

    if not rag.get('rag_database_enabled', False):
        reason = 'disabled'
    elif mode != 'service':
        reason = 'service_mode_required'
    elif not (service_url or (host and port)):
        reason = 'service_endpoint_missing'

    return {
        'enabled': enabled,
        'vectorization_enabled': enabled,
        'reason': reason,
        'mode': mode,
        'service_configured': bool(service_url or (host and port)),
        'chunk_size': int(rag.get('chunk_size') or 800),
        'chunk_overlap': int(rag.get('chunk_overlap') or 120)
    }


def _knowledge_vector_unavailable_response(message='知识向量化未启用或未配置', status_code=400):
    payload = {
        'success': False,
        'message': message,
        'vector_status': _knowledge_vector_status_payload()
    }
    return jsonify(payload), int(status_code or 400)


def _knowledge_meta_timestamp(value):
    """Normalize knowledge timestamp metadata for vector status checks."""
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def get_chroma_store():
    """Get Chroma store if enabled."""
    rag = _get_rag_database_config()
    if not rag.get('rag_database_enabled', False):
        return None, 'disabled'
    try:
        return ChromaStore(rag), None
    except Exception as e:
        return None, str(e)


def _normalize_vector_library(library, default='knowledge'):
    val = str(library or default).strip()
    return val or default


def _delete_vector_title(username: str, title: str, *, library: str = 'knowledge') -> Tuple[bool, str]:
    safe_user = str(username or '').strip()
    safe_title = str(title or '').strip()
    if not safe_user or not safe_title:
        return True, 'skipped: missing username/title'

    lib = _normalize_vector_library(library, default='knowledge')
    store, store_err = get_chroma_store()
    if not store:
        return True, f'skipped: {store_err}'
    if getattr(store, 'mode', '') != 'service':
        return True, 'skipped: non-service mode'

    try:
        store.delete_by_title(safe_user, safe_title, library=lib)
        return True, ''
    except Exception as e:
        return False, str(e)


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


def _temp_file_alias_from_ref(username: str, file_ref: str) -> str:
    raw = str(file_ref or '').strip().replace('\\', '/').strip('/')
    prefix = f"{username}/files/"
    alt_prefix = f"files/{username}/"

    if raw.startswith(prefix):
        return raw[len(prefix):]

    if raw.startswith(alt_prefix):
        return raw[len(alt_prefix):]

    return raw


def _build_temp_file_where(username: str, file_ref: str):
    raw = str(file_ref or '').strip().replace('\\', '/').strip('/')
    if not raw:
        return None
    alias = _temp_file_alias_from_ref(username, raw)
    base = os.path.basename(alias) if alias else ''
    candidates = []

    def _push(k, v):
        val = str(v or '').strip()
        if not val:
            return
        candidates.append({str(k): val})

    _push('file_alias', alias)
    _push('sandbox_path', raw)
    if alias:
        _push('sandbox_path', f"{username}/files/{alias}")
    if base and base != alias:
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

    raw = str(file_ref or '').strip().replace('\\', '/').strip('/')
    alias = _temp_file_alias_from_ref(username, raw)
    base = os.path.basename(alias) if alias else ''
    expected_sandbox = f"{username}/files/{alias}" if alias else ""
    expected_title = _temp_file_vector_title(alias) if alias else ""

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
        if not matched and alias and (m_alias == alias or m_path == expected_sandbox):
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


def _run_upload_task(
    task_id: str,
    username: str,
    filename: str,
    raw: bytes,
    update_file_name: str = None,
    target_path: str = '',
):
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
            update_file_name=update_file_name,
            target_path=target_path,
        )
        _upload_task_update(task_id, stage='parsing', progress=30, message='文件解析完成')

        if _upload_task_cancel_requested(task_id):
            raise RuntimeError(sentinel_cancel)

        vectorized = False
        vector_ids = []
        vector_message = ''
        try:
            if str(entry.get('parser_mode') or '').strip().lower() != 'image':
                stored_rel = str(entry.get('stored_path') or '').replace('\\', '/')
                abs_path = os.path.normpath(os.path.join(os.path.dirname(__file__), stored_rel))
                if os.path.isfile(abs_path):
                    with open(abs_path, 'r', encoding='utf-8') as f:
                        text = f.read()
                else:
                    text = ''

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
                    alias = str(entry.get('alias'))
                    sandbox.remove_file(alias)
                    _delete_vector_title(username, _temp_file_vector_title(alias), library='temp_file')
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


TOOL_STREAM_CHUNK_TYPES = {
    "function_call_delta",
    "function_call",
    "function_call_running",
    "function_result",
}


def _clip_stream_debug_text(value, limit=600):
    text = str(value or "")
    safe_limit = max(80, int(limit or 600))

    if len(text) <= safe_limit:
        return text

    return f"{text[:safe_limit]}...<truncated chars={len(text)}>"


def _is_tool_stream_chunk(chunk):
    if not isinstance(chunk, dict):
        return False

    return str(chunk.get("type") or "").strip() in TOOL_STREAM_CHUNK_TYPES


def _get_tool_chunk_debug_content(chunk):
    """Build compact tool stream logs without dumping whole file contents."""
    if not isinstance(chunk, dict):
        return chunk

    chunk_type = str(chunk.get("type") or "").strip()
    out = {
        "name": str(chunk.get("name") or chunk.get("tool_name") or "").strip(),
        "call_id": str(chunk.get("call_id") or chunk.get("callId") or "").strip(),
    }

    for key in (
        "round",
        "index",
        "status",
        "elapsed_ms",
        "tick",
        "arguments_delta_part",
        "arguments_delta_total_parts",
        "arguments_delta_source_chars",
    ):

        if key in chunk:
            out[key] = chunk.get(key)

    if chunk_type == "function_call_delta":
        delta = str(chunk.get("arguments_delta") or chunk.get("delta") or "")
        name_delta = str(chunk.get("name_delta") or "")
        out["arguments_delta_chars"] = len(delta)

        if name_delta:
            out["name_delta"] = name_delta

        if delta:
            out["arguments_delta_preview"] = _clip_stream_debug_text(delta, 240)

        return out

    if chunk_type == "function_call":
        arguments = str(chunk.get("arguments") or "")
        out["arguments_chars"] = len(arguments)

        if arguments:
            out["arguments_preview"] = _clip_stream_debug_text(arguments, 400)

        return out

    if chunk_type == "function_call_running":
        for key in ("status_text", "tool_phase"):
            if key in chunk:
                out[key] = chunk.get(key)

        progress_text = str(chunk.get("progress_text") or "")

        if progress_text:
            out["progress_text"] = _clip_stream_debug_text(progress_text, 400)

        progress = chunk.get("progress")

        if isinstance(progress, dict):
            out["progress"] = progress

        return out

    if chunk_type == "function_result":
        result = chunk.get("result")
        result_text = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False, default=str)
        model_visible = str(chunk.get("model_visible_result") or "")
        out["result_chars"] = len(str(result_text or ""))

        if result_text:
            out["result_preview"] = _clip_stream_debug_text(result_text, 500)

        if model_visible:
            out["model_visible_result_chars"] = len(model_visible)
            out["model_visible_result_preview"] = _clip_stream_debug_text(model_visible, 500)

        return out

    return {k: v for k, v in chunk.items() if k != "type"}


def _get_chunk_debug_content(chunk):
    """Extract display content for stream debug logs."""
    if not isinstance(chunk, dict):
        return chunk

    if _is_tool_stream_chunk(chunk):
        return _get_tool_chunk_debug_content(chunk)

    if "content" in chunk and chunk.get("content") is not None:
        return chunk.get("content")

    # If there is no direct content field, print the rest of payload.
    return {k: v for k, v in chunk.items() if k != "type"}


def _log_stream_chunk(chunk, model_name=None, source="yield"):
    """Print every stream chunk type + content when log_status=all."""
    chunk_type = "unknown"
    if isinstance(chunk, dict):
        chunk_type = chunk.get("type", "unknown")
    content = _get_chunk_debug_content(chunk)

    try:
        content_dump = json.dumps(content, ensure_ascii=False, default=str)
    except Exception:
        content_dump = str(content)

    prefix_name = "TOOL_STREAM" if _is_tool_stream_chunk(chunk) else "MODEL_STREAM"
    prefix = f"[{prefix_name}]"

    if model_name:
        prefix = f"[{prefix_name}][{model_name}]"

    source_text = str(source or "").strip()
    source_part = f" source={source_text}" if source_text else ""
    _safe_console_print(f"{prefix}{source_part} type={chunk_type} content={content_dump}")


def _safe_console_print(text):
    """安全控制台打印:Windows GBK 等窄编码控制台遇到 emoji 等字符会抛 UnicodeEncodeError,这里统一降级替换。"""
    try:
        print(text)
    except UnicodeEncodeError:
        enc = getattr(sys.stdout, 'encoding', None) or 'utf-8'
        safe_text = str(text).encode(enc, errors='replace').decode(enc, errors='replace')
        print(safe_text)
    except Exception:
        # 极端场景(如 stdout 已关闭)下打印失败不影响业务主流程,直接忽略
        pass


def _should_log_tool_stream_chunks():
    try:
        cfg = get_config_all()
        log_status = str(cfg.get("log_status", "silent") or "silent").strip().lower()
        return log_status in {"all", "debug", "verbose"}
    except Exception:
        return False


JS_BUNDLE_MANIFEST = {
    "public-site-landing": (
        "static/js/public_site/site.js",
    ),
    "public-site-rank": (
        "static/js/secure_render.js",
        "static/js/public_site/site.js",
        "static/js/public_site/rank.js",
    ),
    "public-site-blog": (
        "static/js/public_site/site.js",
    ),
}
JS_BUNDLE_CACHE = {}
JS_BUNDLE_CACHE_LOCK = threading.Lock()
JS_BUNDLE_CACHE_LIMIT = 32
JS_BUNDLE_VERSION_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")
JS_BUNDLE_STATIC_JS_DIR = os.path.abspath(os.path.join(BASE_DIR, "static", "js"))


def _normalize_js_bundle_version(raw_version):
    """校验资源版本号，保证缓存键由明确版本驱动。"""
    version = str(raw_version or "").strip()

    if not JS_BUNDLE_VERSION_PATTERN.fullmatch(version):
        raise ValueError("js bundle version is required and must only contain letters, numbers, dot, underscore or hyphen")

    return version


def _resolve_js_bundle_file(relative_path):
    """把 manifest 中的 JS 路径解析为 static/js 内的真实文件。"""
    full_path = os.path.abspath(os.path.join(BASE_DIR, relative_path))

    if os.path.commonpath([JS_BUNDLE_STATIC_JS_DIR, full_path]) != JS_BUNDLE_STATIC_JS_DIR:
        raise ValueError(f"js bundle file is outside static/js: {relative_path}")

    if not os.path.isfile(full_path):
        raise FileNotFoundError(f"js bundle file is missing: {relative_path}")

    return full_path


def _read_js_bundle_source(relative_path):
    """读取单个 JS 源文件，打包入口统一使用 UTF-8。"""
    full_path = _resolve_js_bundle_file(relative_path)

    with open(full_path, "r", encoding="utf-8-sig") as f:
        source = f.read()

    return source


def _remember_js_bundle_payload(cache_key, payload):
    """保存构建结果，并限制版本缓存数量。"""

    if cache_key not in JS_BUNDLE_CACHE and len(JS_BUNDLE_CACHE) >= JS_BUNDLE_CACHE_LIMIT:
        oldest_key = next(iter(JS_BUNDLE_CACHE))
        del JS_BUNDLE_CACHE[oldest_key]

    JS_BUNDLE_CACHE[cache_key] = payload


def _build_js_bundle_payload(bundle_name, version):
    """按 manifest 顺序拼接 JS，并按 bundle + version 缓存。"""
    cache_key = (bundle_name, version)

    with JS_BUNDLE_CACHE_LOCK:
        cached = JS_BUNDLE_CACHE.get(cache_key)

    if cached:
        return cached

    files = JS_BUNDLE_MANIFEST[bundle_name]
    parts = []

    for relative_path in files:
        source = _read_js_bundle_source(relative_path).rstrip()
        parts.append(f"/* source: {relative_path} */\n{source}\n;")

    content = "\n\n".join(parts) + "\n"
    content_bytes = content.encode("utf-8")
    etag_seed = f"{bundle_name}\0{version}\0".encode("utf-8") + content_bytes
    payload = {
        "content": content,
        "etag": '"' + hashlib.sha256(etag_seed).hexdigest() + '"',
    }

    with JS_BUNDLE_CACHE_LOCK:
        _remember_js_bundle_payload(cache_key, payload)

    return payload


def _request_etag_matches(etag):
    """判断浏览器缓存的 ETag 是否命中当前 bundle。"""
    header_value = str(request.headers.get("If-None-Match") or "")
    candidates = {item.strip() for item in header_value.split(",") if item.strip()}

    return "*" in candidates or etag in candidates


@app.route("/assets/js/<bundle_name>.js")
def js_bundle(bundle_name):
    """返回白名单 JS bundle，缓存生命周期由 v 查询参数控制。"""

    if bundle_name not in JS_BUNDLE_MANIFEST:
        return Response("unknown js bundle", status=404, mimetype="text/plain")

    try:
        version = _normalize_js_bundle_version(request.args.get("v"))
    except ValueError as exc:
        return Response(str(exc), status=400, mimetype="text/plain")

    try:
        payload = _build_js_bundle_payload(bundle_name, version)
    except Exception as exc:
        print(f"[JS_BUNDLE] build failed bundle={bundle_name}: {exc}")
        return Response(f"js bundle build failed: {exc}", status=500, mimetype="text/plain")

    if _request_etag_matches(payload["etag"]):
        response = Response(status=304)
    else:
        response = Response(payload["content"], mimetype="application/javascript")

    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    response.headers["ETag"] = payload["etag"]
    response.headers["X-Asset-Bundle"] = bundle_name
    response.headers["X-Asset-Version"] = version

    return response


@app.route('/')
def index():
    """首页：未登录展示 Landing，已登录进入新版聊天前端(/new)；旧版完整界面保留在 /old"""
    if 'username' in session:
        return redirect(url_for('new_frontend_page', **request.args))

    return render_template('public_site/landing.html')


@app.route('/introduce')
def introduce_page():
    """公开介绍页"""
    return render_template('public_site/landing.html')


@app.route('/nl_introduce')
def nl_introduce_page():
    """NexoraLearning 公开介绍页"""
    return render_template('public_site/nl_introduce.html')


@app.route('/introduce_2')
def legacy_introduce_page():
    """新版介绍页历史入口"""
    return redirect(url_for('introduce_page'))


@app.route('/status')
def status_page():
    """公开状态页"""
    return render_template('public_site/status.html')


@app.route('/rank')
def rank_page():
    return render_template('public_site/rank.html')


@app.route('/status_2')
def legacy_status_page():
    """新版公开状态页历史入口"""
    return redirect(url_for('status_page'))


@app.route('/blog')
def board_page():
    """公告栏"""
    return render_template('public_site/blog.html')


@app.route('/blog_2')
def legacy_blog_page():
    """新版博客历史入口"""
    return redirect(url_for('board_page'))
    
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
    """登录入口:GET 一律进入新版前端(登录页由 /new#/login 渲染,POST 仍由本路由处理)"""
    if request.method == 'GET':
        if 'username' in session:
            try:
                users = load_users()
                if session.get('username') in users:
                    return redirect('/new')
            except Exception:
                pass
            session.clear()
        return redirect('/new')
    
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
        users[username]['last_ip'] = _resolve_recent_login_ip(request)
        users[username]['last_login'] = int(time.time())
        save_users(users)
            
        # 登录成功
        session['username'] = username
        session['role'] = users[username].get('role', 'member')
        session.permanent = True
        return jsonify({'success': True, 'message': '登录成功'})
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'登录失败: {str(e)}'})


@app.route('/logout', methods=['GET', 'POST'])
def logout():
    """登出"""
    session.clear()
    if request.method == 'POST':
        resp = jsonify({'success': True, 'message': '已登出'})
    else:
        resp = redirect(url_for('login'))
    _clear_session_cookie(resp)
    _set_no_store_headers(resp)
    return resp


# Global session validation: if a session claims a username, verify it actually
# exists in the user database.  This prevents forged session cookies from
# granting access to non-existent users (which would auto-create directories,
# databases, etc. via User(username) constructors).
_PUBLIC_PATHS = {'/login', '/logout', '/static', '/api/health', '/api/user/avatar'}


@app.before_request
def _validate_session_user():
    username = str(session.get('username') or '').strip()
    if not username:
        return  # no session → let downstream handle it (401 or redirect)
    # Skip validation for public / static paths
    req_path = request.path or '/'
    if any(req_path == p or req_path.startswith(p + '/') for p in _PUBLIC_PATHS):
        return
    try:
        users = load_users()
        g.session_users_meta = users
        if username not in users:
            session.clear()
            if req_path.startswith('/api/'):
                return jsonify({'success': False, 'message': '用户不存在，请重新登录'}), 401
            return redirect(url_for('login'))
    except Exception:
        session.clear()
        if req_path.startswith('/api/'):
            return jsonify({'success': False, 'message': '认证验证失败，请重新登录'}), 401
        return redirect(url_for('login'))


@app.route('/api/timeline', methods=['GET'])
@require_login
def get_timeline_entries():
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401
    try:
        limit = int(request.args.get('limit') or 120)
    except Exception:
        limit = 120
    kind = str(request.args.get('kind') or '').strip()
    try:
        items = list_timeline_entries(username, limit=limit, kind=kind or None)
        return jsonify({'success': True, 'items': items, 'total': len(items)})
    except Exception as e:
        print(f"Error getting timeline entries: {e}")
        return jsonify({'success': False, 'message': '获取时间线失败'}), 500


@app.route('/api/skills/list', methods=['GET'])
@require_login
def get_skill_catalog_api():
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401
    try:
        runtime = _build_user_skill_runtime(username)
        return jsonify({
            'success': True,
            'mode': runtime.get('mode', 'per_skill'),
            'skill_modes': runtime.get('skill_modes', {}),
            'enabled_skill_ids': runtime.get('enabled_skill_ids', []),
            'skills': runtime.get('skills', []),
            'active_skills': runtime.get('active_skills', [])
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/skills/settings', methods=['PUT'])
@require_login
def update_skill_settings_api():
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401
    data = request.get_json(silent=True) or {}
    try:
        runtime = _build_user_skill_runtime(username)
        known_ids = {
            str(item.get('id') or '').strip()
            for item in (runtime.get('skills', []) or [])
            if isinstance(item, dict)
        }
        skill_modes_payload: Dict[str, str] = {}
        raw_modes = data.get('skill_modes')
        if isinstance(raw_modes, dict):
            for k, v in raw_modes.items():
                sid = _skill_slug(k, fallback='').strip()
                if sid == 'skill' and str(k or '').strip() == '':
                    sid = ''
                if (not sid) or (sid not in known_ids):
                    continue
                skill_modes_payload[sid] = _normalize_skill_mode(v)
        else:
            # backward compatibility: old payload { mode, enabled_skill_ids }
            compat_mode = _normalize_skill_mode(data.get('mode', 'off'))
            compat_enabled = data.get('enabled_skill_ids', [])
            if isinstance(compat_enabled, list):
                for item in compat_enabled:
                    sid = _skill_slug(item, fallback='').strip()
                    if sid == 'skill' and str(item or '').strip() == '':
                        sid = ''
                    if (not sid) or (sid not in known_ids):
                        continue
                    skill_modes_payload[sid] = compat_mode

        saved = _save_user_skill_settings(username, {
            'skill_modes': skill_modes_payload
        })
        next_runtime = _build_user_skill_runtime(username)
        return jsonify({
            'success': True,
            'mode': 'per_skill',
            'skill_modes': saved.get('skill_modes', {}),
            'enabled_skill_ids': next_runtime.get('enabled_skill_ids', []),
            'skills': next_runtime.get('skills', []),
            'active_skills': next_runtime.get('active_skills', [])
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/skills/upsert', methods=['PUT'])
@require_admin
def upsert_skill_catalog_item_api():
    data = request.get_json(silent=True) or {}
    skill_raw = data.get('skill')
    if skill_raw is None:
        # Backward compatibility: accept direct skill object at root.
        if any(k in data for k in ('title', 'id', 'main_content', 'required_tools', 'mode')):
            skill_raw = data
    if not isinstance(skill_raw, dict):
        text_payload = str(data.get('skill_text') or data.get('text') or '').strip()
        if not text_payload:
            return jsonify({'success': False, 'message': 'skill 参数无效'}), 400
        parsed = _parse_skill_text(text_payload, source='api')
        if not parsed:
            return jsonify({'success': False, 'message': 'skill_text 解析失败'}), 400
        skill_raw = parsed
        custom_id = str(data.get('skill_id') or data.get('id') or '').strip()
        if custom_id:
            skill_raw['id'] = custom_id
    has_mode_field = 'mode' in skill_raw
    try:
        catalog = _load_skill_catalog()
        incoming = _normalize_skill_catalog_item(skill_raw, index=len(catalog))
        if not incoming:
            return jsonify({'success': False, 'message': 'title 不能为空'}), 400
        incoming['update_date'] = datetime.now().strftime('%Y-%m-%d')

        target_id = str(incoming.get('id') or '').strip()
        replaced = False
        next_catalog: List[Dict[str, Any]] = []
        for row in catalog:
            if not isinstance(row, dict):
                continue
            rid = str(row.get('id') or '').strip()
            if rid == target_id:
                merged = dict(row)
                merged.update(incoming)
                if not has_mode_field:
                    merged['mode'] = _normalize_skill_mode(row.get('mode', 'off'))
                if not str(merged.get('release_date') or '').strip():
                    merged['release_date'] = datetime.now().strftime('%Y-%m-%d')
                next_catalog.append(merged)
                replaced = True
            else:
                next_catalog.append(row)
        if not replaced:
            if not str(incoming.get('release_date') or '').strip():
                incoming['release_date'] = datetime.now().strftime('%Y-%m-%d')
            next_catalog.append(incoming)
        _save_skill_catalog(next_catalog)
        return jsonify({'success': True, 'skill': incoming})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


# ==================== 个人 Skill API ====================

@app.route('/api/skills/my', methods=['GET'])
@require_login
def get_my_skills_api():
    """获取当前用户的 Skill 合并视图（全局 + 个人）"""
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401

    try:
        runtime = _build_user_skill_runtime(username)
        personal_skills = _load_user_skills(username)
        personal_ids = {str(s.get('id') or '').strip() for s in personal_skills}

        # 为每个 skill 标注来源
        skills = runtime.get('skills', [])
        for item in skills:
            sid = str(item.get('id') or '').strip()
            if sid in personal_ids:
                item['origin'] = item.get('origin') or 'self'
            else:
                item['origin'] = 'global'

        return jsonify({
            'success': True,
            'skills': skills,
            'personal_skills': personal_skills,
            'skill_modes': runtime.get('skill_modes', {}),
            'active_skills': runtime.get('active_skills', [])
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/skills/my', methods=['POST'])
@require_login
def create_my_skill_api():
    """创建个人 Skill"""
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401

    data = request.get_json(silent=True) or {}
    skill_raw = data.get('skill')

    # 兼容：直接传 skill 字段在根级
    if skill_raw is None:
        if any(k in data for k in ('title', 'id', 'main_content', 'required_tools', 'mode')):
            skill_raw = data

    if not isinstance(skill_raw, dict):
        return jsonify({'success': False, 'message': 'skill 参数无效'}), 400

    try:
        now_date = datetime.now().strftime('%Y-%m-%d')
        skill_raw.setdefault('author', username)
        skill_raw.setdefault('release_date', now_date)
        skill_raw['update_date'] = now_date
        skill_raw['origin'] = 'self'

        item = _normalize_skill_catalog_item(skill_raw, index=0)
        if not item:
            return jsonify({'success': False, 'message': 'title 不能为空'}), 400

        # 检查个人空间内 ID 唯一性
        existing = _load_user_skills(username)
        existing_ids = {str(s.get('id') or '').strip() for s in existing}
        sid = str(item.get('id') or '').strip()

        if sid in existing_ids:
            return jsonify({'success': False, 'message': f'Skill ID "{sid}" 已存在'}), 409

        saved = _write_user_skill_file(username, item)
        return jsonify({'success': True, 'skill': saved}), 201
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/skills/my/<skill_id>', methods=['PUT'])
@require_login
def update_my_skill_api(skill_id: str):
    """更新个人 Skill"""
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401

    data = request.get_json(silent=True) or {}
    skill_raw = data.get('skill')

    if skill_raw is None:
        if any(k in data for k in ('title', 'main_content', 'required_tools', 'mode')):
            skill_raw = data

    if not isinstance(skill_raw, dict):
        return jsonify({'success': False, 'message': 'skill 参数无效'}), 400

    try:
        # 确认该 Skill 存在于个人空间
        existing = _load_user_skills(username)
        target_sid = _skill_slug(skill_id, fallback='skill')
        found = None
        for s in existing:
            if str(s.get('id') or '').strip() == target_sid:
                found = s
                break

        if not found:
            return jsonify({'success': False, 'message': '未找到该个人 Skill'}), 404

        # 合并更新
        skill_raw['id'] = target_sid
        skill_raw['update_date'] = datetime.now().strftime('%Y-%m-%d')
        merged = dict(found)
        merged.update(skill_raw)

        saved = _write_user_skill_file(username, merged)
        return jsonify({'success': True, 'skill': saved})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/skills/my/<skill_id>', methods=['DELETE'])
@require_login
def delete_my_skill_api(skill_id: str):
    """删除个人 Skill"""
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401

    try:
        deleted = _delete_user_skill_file(username, skill_id)
        if not deleted:
            return jsonify({'success': False, 'message': '未找到该个人 Skill'}), 404

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


# ==================== Skill 市场 API ====================

@app.route('/api/skills/market', methods=['GET'])
@require_login
def browse_skill_market_api():
    """浏览 Skill 市场（支持搜索、标签筛选、排序、分页）"""
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401

    try:
        query = request.args.get('q', '').strip()
        tag = request.args.get('tag', '').strip()
        sort = request.args.get('sort', 'installs').strip()
        page = int(request.args.get('page', 1) or 1)
        page_size = min(int(request.args.get('page_size', 20) or 20), 50)

        result = _search_market_skills(query=query, tag=tag, sort=sort,
                                       page=page, page_size=page_size)

        # 标注当前用户已安装的 Skill
        personal_skills = _load_user_skills(username)
        installed_ids = set()
        for s in personal_skills:
            if str(s.get('origin') or '') == 'market':
                origin_id = str(s.get('origin_id') or s.get('id') or '').strip()
                if origin_id:
                    installed_ids.add(origin_id)

        for item in result['skills']:
            item['installed'] = str(item.get('id') or '').strip() in installed_ids

        return jsonify({'success': True, **result})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/skills/market/<skill_id>', methods=['GET'])
@require_login
def get_market_skill_detail_api(skill_id: str):
    """查看市场 Skill 详情（含正文）"""
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401

    try:
        skill = _load_market_skill_content(skill_id)
        if not skill:
            return jsonify({'success': False, 'message': '未找到该 Skill'}), 404

        # 标注是否已安装
        personal_skills = _load_user_skills(username)
        sid = str(skill.get('id') or '').strip()
        installed = any(
            str(s.get('origin_id') or s.get('id') or '').strip() == sid
            and str(s.get('origin') or '') == 'market'
            for s in personal_skills
        )
        skill['installed'] = installed

        return jsonify({'success': True, 'skill': skill})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/skills/market/publish', methods=['POST'])
@require_login
def publish_skill_to_market_api():
    """发布/更新 Skill 到市场"""
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401

    data = request.get_json(silent=True) or {}
    skill_raw = data.get('skill')

    if skill_raw is None:
        if any(k in data for k in ('title', 'id', 'main_content', 'required_tools', 'mode')):
            skill_raw = data

    if not isinstance(skill_raw, dict):
        return jsonify({'success': False, 'message': 'skill 参数无效'}), 400

    try:
        now_date = datetime.now().strftime('%Y-%m-%d')
        skill_raw['author'] = username
        skill_raw['update_date'] = now_date

        item = _normalize_skill_catalog_item(skill_raw, index=0)
        if not item:
            return jsonify({'success': False, 'message': 'title 不能为空'}), 400

        sid = str(item.get('id') or '').strip()

        # 检查 ID 是否被他人占用
        index = _load_market_index()
        for entry in index:
            entry_id = str(entry.get('id') or '').strip()
            entry_author = str(entry.get('author') or '').strip()
            if entry_id == sid and entry_author != username:
                return jsonify({
                    'success': False,
                    'message': f'Skill ID "{sid}" 已被其他用户使用'
                }), 409

        # 判断是新建还是更新
        is_update = any(
            str(e.get('id') or '').strip() == sid and str(e.get('author') or '').strip() == username
            for e in index
        )

        if not is_update:
            skill_raw.setdefault('release_date', now_date)
            item = _normalize_skill_catalog_item(skill_raw, index=0)

        saved = _write_market_skill(item)
        action = 'updated' if is_update else 'created'
        return jsonify({'success': True, 'action': action, 'skill': saved})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/skills/market/<skill_id>', methods=['DELETE'])
@require_login
def delete_market_skill_api(skill_id: str):
    """从市场下架 Skill（仅作者或管理员）"""
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401

    try:
        # 查找该 Skill 的作者
        index = _load_market_index()
        sid = _skill_slug(skill_id, fallback='skill')
        target_entry = None
        for entry in index:
            if str(entry.get('id') or '').strip() == sid:
                target_entry = entry
                break

        if not target_entry:
            return jsonify({'success': False, 'message': '未找到该 Skill'}), 404

        # 权限校验：仅作者或管理员可删除
        author = str(target_entry.get('author') or '').strip()
        users = load_users()
        user_info = users.get(username, {})
        role = str(user_info.get('role') or 'member').strip().lower()

        if author != username and role != 'admin':
            return jsonify({'success': False, 'message': '无权删除他人的 Skill'}), 403

        _delete_market_skill(sid)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/skills/market/<skill_id>/install', methods=['POST'])
@require_login
def install_market_skill_api(skill_id: str):
    """从市场安装 Skill 到个人空间（复制副本）"""
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': '未登录'}), 401

    try:
        # 读取市场 Skill 完整内容
        market_skill = _load_market_skill_content(skill_id)
        if not market_skill:
            return jsonify({'success': False, 'message': '市场中未找到该 Skill'}), 404

        sid = str(market_skill.get('id') or '').strip()

        # 检查是否已安装
        personal_skills = _load_user_skills(username)
        for s in personal_skills:
            origin_id = str(s.get('origin_id') or '').strip()
            s_origin = str(s.get('origin') or '').strip()
            if s_origin == 'market' and origin_id == sid:
                return jsonify({'success': False, 'message': '已安装该 Skill'}), 409

        # 复制为个人副本，记录来源
        now_date = datetime.now().strftime('%Y-%m-%d')
        personal_copy = dict(market_skill)
        personal_copy['origin'] = 'market'
        personal_copy['origin_id'] = sid
        personal_copy['origin_version'] = str(market_skill.get('version') or '').strip()
        personal_copy['installed_date'] = now_date

        saved = _write_user_skill_file(username, personal_copy)

        # 安装计数 +1
        _increment_market_install_count(sid)

        return jsonify({'success': True, 'skill': saved})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


# ==================== 管理后台 API ====================

@app.route('/chat')
def chat():
    """聊天入口:已迁移至新版前端;旧版完整界面保留在 /old 作为回退"""
    if 'username' not in session:
        return redirect(url_for('login'))
    return redirect('/new')


@app.route('/old')
def legacy_chat():
    """旧版聊天页(回退入口):与原 /chat 完全一致,供新旧并行期使用"""
    if 'username' not in session:
        return redirect(url_for('login'))
    try:
        users = get_request_users_meta()
        if session.get('username') not in users:
            session.clear()
            return redirect(url_for('login'))
    except Exception:
        session.clear()
        return redirect(url_for('login'))
    cfg = get_config_all()
    mail_cfg = cfg.get('nexora_mail', {}) if isinstance(cfg, dict) else {}
    mail_enabled = bool(mail_cfg.get('nexora_mail_enabled', False))
    map_cfg = cfg.get('map_service', {}) if isinstance(cfg.get('map_service'), dict) else {}
    baidu_map_cfg = map_cfg.get('baidu', {}) if isinstance(map_cfg.get('baidu'), dict) else {}
    tianditu_map_cfg = map_cfg.get('tianditu', {}) if isinstance(map_cfg.get('tianditu'), dict) else {}
    map_renderer_config = {
        'provider': str(map_cfg.get('provider') or 'baidu').strip().lower() or 'baidu',
        'baiduMapAk': str(baidu_map_cfg.get('browser_ak') or '').strip(),
        'baiduMapVersion': str(baidu_map_cfg.get('browser_version') or '1.0').strip() or '1.0',
        'tiandituMapTk': str(tianditu_map_cfg.get('browser_tk') or tianditu_map_cfg.get('tk') or '').strip(),
        'tiandituMapVersion': str(tianditu_map_cfg.get('browser_version') or '4.0').strip() or '4.0'
    }

    return render_template(
        'chat.html',
        username=session['username'],
        nexora_mail_enabled=mail_enabled,
        map_renderer_config=map_renderer_config
    )


@app.route('/api/map/conversations/<conv_id>/maps/<map_id>/scene', methods=['GET'])
@require_login
def get_conversation_map_scene(conv_id, map_id):
    """按 conversation_id + map_id 读取当前用户地图 scene，供前端地图渲染器使用。"""
    cid = str(conv_id or '').strip()
    mid = str(map_id or '').strip()

    if not cid:
        return jsonify({'success': False, 'message': 'conversation_id 不能为空'}), 400

    if not mid:
        return jsonify({'success': False, 'message': 'map_id 不能为空'}), 400

    try:
        ConversationService(session['username']).get_conversation(cid)
    except Exception:
        return jsonify({'success': False, 'message': '对话不存在'}), 404

    try:
        scene = load_map_scene_for_map_id(session['username'], cid, mid)
    except Exception as e:
        return jsonify({'success': False, 'message': f'地图记录读取失败：{str(e)}'}), 400

    if not isinstance(scene, dict):
        return jsonify({'success': False, 'message': '地图记录不存在'}), 404

    return jsonify({'success': True, 'scene': scene})


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
                'message': f'当前仅支持文本类、docx/pdf/pptx 和常见图片上传，后缀 {suffix or "(none)"} 不支持。支持后缀: {allow_preview}'
            }), 400

        update_file_name = (request.form.get('update_file_name') or '').strip() or None
        target_path = (request.form.get('target_path') or '').strip()
        raw = file.read()
        task_id = _upload_task_create(username, filename, extra={'target_path': target_path} if target_path else None)
        worker = threading.Thread(
            target=_run_upload_task,
            args=(task_id, username, filename, raw, update_file_name, target_path),
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


def _serialize_upload_task(task):
    """统一上传/向量化异步任务的 API 返回结构。"""
    return {
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


def _get_owned_upload_task_or_response(task_id, expected_task_type=''):
    username = session['username']
    task = _upload_task_get(task_id)
    if not task:
        return None, (jsonify({'success': False, 'message': '任务不存在'}), 404)

    if str(task.get('username') or '') != str(username):
        return None, (jsonify({'success': False, 'message': '无权限访问该任务'}), 403)

    expected = str(expected_task_type or '').strip()
    if expected and str(task.get('task_type') or '') != expected:
        return None, (jsonify({'success': False, 'message': '任务类型不匹配'}), 404)

    return task, None


def _jsonify_upload_task(task):
    return jsonify({
        'success': True,
        'task': _serialize_upload_task(task)
    })


@app.route('/api/upload/task/<task_id>', methods=['GET'])
@require_login
def get_upload_task(task_id):
    task, error_response = _get_owned_upload_task_or_response(task_id)
    if error_response:
        return error_response

    return _jsonify_upload_task(task)


@app.route('/api/knowledge/vector/tasks/<task_id>', methods=['GET'])
@require_login
def get_knowledge_vector_task(task_id):
    task, error_response = _get_owned_upload_task_or_response(task_id, 'knowledge_vectorize')
    if error_response:
        return error_response

    return _jsonify_upload_task(task)


@app.route('/api/knowledge/vector/tasks', methods=['POST'])
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

    if not _is_knowledge_vectorization_enabled():
        return jsonify({'success': False, 'message': '知识向量化未启用或未配置'}), 400

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
    task, error_response = _get_owned_upload_task_or_response(task_id)
    if error_response:
        return error_response

    status = str(task.get('status') or '')
    if status in {'completed', 'failed', 'cancelled'}:
        return jsonify({'success': True, 'already_done': True, 'status': status})

    _upload_task_mark_cancel(task_id)
    return jsonify({'success': True, 'cancel_requested': True})


@app.route('/api/knowledge/vector/tasks/<task_id>/cancel', methods=['POST'])
@require_login
def cancel_knowledge_vector_task(task_id):
    task, error_response = _get_owned_upload_task_or_response(task_id, 'knowledge_vectorize')
    if error_response:
        return error_response

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
        query = normalize_text(request.args.get('q', ''), default='')
        regex_raw = normalize_text(request.args.get('regex', ''), default='').lower()
        offset_raw = request.args.get('offset', 0)
        limit_raw = request.args.get('limit', 200)

        try:
            offset = int(offset_raw)
        except Exception:
            offset = 0
        offset = max(0, offset)

        try:
            limit = int(limit_raw)
        except Exception:
            limit = 200
        limit = max(1, min(limit, 1000))

        regex = regex_raw in {'1', 'true', 'yes', 'y', 'on'}

        sandbox = UserFileSandbox(username)
        payload = sandbox.list_files(query=query or None, regex=regex, offset=offset, limit=limit)
        return jsonify({
            'success': True,
            'files': payload.get('files', []),
            'total': payload.get('total', 0),
            'offset': payload.get('offset', offset),
            'limit': payload.get('limit', limit)
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
        file_ref = normalize_text(request.args.get('file_ref', ''), default='')
        if not file_ref:
            return jsonify({'success': False, 'message': '缺少 file_ref'}), 400

        sandbox = UserFileSandbox(username)
        entry = sandbox._get_entry(file_ref)
        abs_path = sandbox._get_abs_path(entry)

        download_name = safe_filename(entry.get('original_name') or entry.get('alias') or 'download.txt', default='download.txt', max_len=180)
        inline = normalize_text(request.args.get('inline', ''), default='').lower() in {'1', 'true', 'yes', 'on'}
        mimetype = mimetypes.guess_type(download_name)[0] or 'application/octet-stream'
        return send_file(abs_path, as_attachment=not inline, download_name=download_name, mimetype=mimetype)
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
                vec_ok, vec_err = _delete_vector_title(username, vec_title, library='temp_file')
                if not vec_ok and vec_err:
                    print(f"[Vector] delete temp vector failed ({username}/{vec_title}): {vec_err}")
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


@app.route('/api/conversations', methods=['GET'])
@require_login
def list_conversations():
    """获取对话列表"""
    username = session['username']
    manager = ConversationService(username)
    conversations = manager.list_conversations()
    return jsonify({'success': True, 'conversations': conversations})


@app.route('/api/conversations', methods=['POST'])
@require_login
def create_conversation_api():
    """创建一个空对话，供前端预创建使用"""
    username = session['username']
    manager = ConversationService(username)
    data = request.get_json(silent=True) or {}
    title = str(data.get('title') or '新对话').strip() or '新对话'
    conversation_mode = str(data.get('conversation_mode') or 'chat').strip() or 'chat'
    raw_tags = data.get('tags')
    tags = raw_tags if isinstance(raw_tags, list) else []
    metadata = data.get('metadata') if isinstance(data.get('metadata'), dict) else {}
    conversation_id = data.get('conversation_id')
    conversation_id = str(conversation_id or '').strip() or None
    try:
        if conversation_id:
            try:
                manager.get_conversation(conversation_id)
                return jsonify({'success': True, 'conversation_id': conversation_id, 'title': title, 'existed': True})
            except Exception:
                pass
        conv_id = manager.create_conversation(
            conversation_id=conversation_id,
            title=title,
            conversation_mode=conversation_mode,
            tags=tags,
            metadata=metadata,
        )
        return jsonify({'success': True, 'conversation_id': conv_id, 'title': title})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/conversations/<conv_id>/fork', methods=['POST'])
@require_login
def fork_conversation_api(conv_id):
    """从已完成的 assistant 回答节点创建独立会话分支。"""
    username = session['username']
    source_conversation_id = str(conv_id or '').strip()
    data = request.get_json(silent=True) or {}

    if 'message_index' not in data:
        return jsonify({'success': False, 'message': 'message_index 不能为空'}), 400

    running_sessions = list_stream_sessions(
        username=username,
        conversation_ids=[source_conversation_id],
        include_done=False,
    )

    if running_sessions:
        return jsonify({'success': False, 'message': '当前会话仍在生成，完成后才能创建分支'}), 409

    service = ConversationService(username)
    branch_result = None
    target_conversation_id = ''

    def rollback_branch() -> None:
        if not target_conversation_id:
            return

        from Map.baidu import remove_map_records

        _remove_conversation_assets_dir(username, target_conversation_id)
        remove_map_records(username, target_conversation_id)
        service.delete_conversation(target_conversation_id)

    try:
        branch_result = service.fork_conversation(
            source_conversation_id,
            data.get('message_index'),
            title=str(data.get('title') or '').strip(),
        )
        target_conversation_id = str(branch_result.get('conversation_id') or '').strip()
        branch_conversation = service.get_conversation(target_conversation_id)
        branch_conversation = asset_store.clone_referenced_assets(
            username,
            source_conversation_id,
            target_conversation_id,
            branch_conversation,
        )

        from Map.baidu import (
            clone_map_records,
            rewrite_map_conversation_references,
        )

        branch_conversation = rewrite_map_conversation_references(
            branch_conversation,
            source_conversation_id,
            target_conversation_id,
        )
        service.replace_conversation_messages(target_conversation_id, branch_conversation.get('messages', []))
        clone_map_records(username, source_conversation_id, target_conversation_id)

        workspace_id = str(data.get('workspace_id') or '').strip()

        if workspace_id:
            from App.Workspace import find_store_for_visible_workspace, validate_workspace_id

            validated_workspace_id = validate_workspace_id(workspace_id)
            workspace_store = find_store_for_visible_workspace(username, validated_workspace_id)
            workspace_store.add_conversation(validated_workspace_id, target_conversation_id, username)

        return jsonify({
            'success': True,
            'conversation_id': target_conversation_id,
            'title': str(branch_result.get('title') or ''),
            'branch': branch_result.get('branch', {}),
            'workspace_id': workspace_id,
        })
    except PermissionError as error:
        rollback_branch()
        return jsonify({'success': False, 'message': str(error)}), 403
    except Exception as error:
        rollback_branch()
        return jsonify({'success': False, 'message': str(error)}), 400


@app.route('/api/conversations/<conv_id>/pin', methods=['PUT'])
@app.route('/api/conversations/<conv_id>/pin', methods=['POST'])
@require_login
def set_conversation_pin(conv_id):
    """设置对话置顶状态"""
    username = session['username']
    manager = ConversationService(username)
    data = request.get_json(silent=True) or {}
    pin = bool(data.get('pin', True))
    try:
        manager.set_pin(conv_id, pin=pin)
        return jsonify({'success': True, 'conversation_id': conv_id, 'pin': pin})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 400


@app.route('/api/conversations/<conv_id>/title', methods=['PUT'])
@require_login
def update_conversation_title(conv_id):
    """更新对话标题"""
    username = session['username']
    manager = ConversationService(username)
    data = request.get_json(silent=True) or {}
    title = str(data.get('title') or '').strip()
    if not title:
        return jsonify({'success': False, 'message': 'title is required'}), 400
    if len(title) > 120:
        return jsonify({'success': False, 'message': 'title too long'}), 400
    try:
        manager.update_title(conv_id, title)
        return jsonify({'success': True, 'conversation_id': conv_id, 'title': title})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 400


@app.route('/api/conversations/<conv_id>', methods=['GET'])
@require_login
def get_conversation(conv_id):
    """获取对话详情"""
    username = session['username']
    manager = ConversationService(username)
    try:
        conversation = manager.ensure_conversation_compatibility(conv_id)
        message_limit_raw = request.args.get('message_limit')
        message_window = None

        if message_limit_raw is not None:
            try:
                message_limit = int(str(message_limit_raw).strip())
            except Exception:
                return jsonify({'success': False, 'message': 'message_limit 必须是整数'}), 400

            if message_limit <= 0 or message_limit > 200:
                return jsonify({'success': False, 'message': 'message_limit 必须在 1 到 200 之间'}), 400

            all_messages = conversation.get('messages', [])

            if not isinstance(all_messages, list):
                all_messages = []

            total_messages = len(all_messages)
            start_index = max(0, total_messages - message_limit)
            end_index = total_messages - 1 if total_messages > 0 else -1
            conversation = dict(conversation)
            conversation['messages'] = all_messages[start_index:total_messages]
            conversation['message_count'] = total_messages
            message_window = {
                'start_index': start_index,
                'end_index': end_index,
                'total': total_messages,
                'limit': message_limit,
                'has_more_before': start_index > 0,
            }

        payload = {'success': True, 'conversation': conversation}

        if message_window is not None:
            payload['message_window'] = message_window

        if _as_bool(request.args.get('include_stream'), default=False):
            payload['stream_sessions'] = list_stream_sessions(
                username=username,
                conversation_ids=[conv_id],
                include_done=True
            )

        return jsonify(payload)
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/conversations/<conv_id>/messages', methods=['GET'])
@require_login
def get_conversation_messages(conv_id):
    """按真实消息索引分页读取对话消息。"""
    username = session['username']
    manager = ConversationService(username)

    try:
        limit = int(str(request.args.get('limit') or '10').strip())
    except Exception:
        return jsonify({'success': False, 'message': 'limit 必须是整数'}), 400

    if limit <= 0 or limit > 200:
        return jsonify({'success': False, 'message': 'limit 必须在 1 到 200 之间'}), 400

    try:
        conversation = manager.ensure_conversation_compatibility(conv_id)
        messages = conversation.get('messages', [])

        if not isinstance(messages, list):
            messages = []

        total_messages = len(messages)
        before_raw = request.args.get('before')

        if before_raw is None or str(before_raw).strip() == '':
            before_index = total_messages
        else:
            try:
                before_index = int(str(before_raw).strip())
            except Exception:
                return jsonify({'success': False, 'message': 'before 必须是整数'}), 400

        before_index = max(0, min(before_index, total_messages))
        start_index = max(0, before_index - limit)
        end_index = before_index - 1 if before_index > 0 else -1

        return jsonify({
            'success': True,
            'messages': messages[start_index:before_index],
            'context_events': manager.get_context_events(conv_id),
            'start_index': start_index,
            'end_index': end_index,
            'total': total_messages,
            'limit': limit,
            'has_more_before': start_index > 0,
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


def _build_conversation_user_turns(messages):
    """构建轮次指示器需要的全量用户消息元数据。"""
    user_turns = []

    for index, message in enumerate(messages if isinstance(messages, list) else []):
        if not isinstance(message, dict):
            continue

        role = str(message.get('role') or '').strip().lower()

        if role != 'user':
            continue

        user_turns.append({
            'message_index': index,
            'role': 'user',
            'content': message.get('content', ''),
            'timestamp': message.get('timestamp') or message.get('created_at') or '',
            'id': message.get('id') or '',
        })

    return user_turns


@app.route('/api/conversations/<conv_id>/turns', methods=['GET'])
@require_login
def get_conversation_turns(conv_id):
    """读取完整用户轮次列表，供窗口化消息渲染时保持轮次指示器完整。"""
    username = session['username']
    manager = ConversationService(username)

    try:
        conversation = manager.ensure_conversation_compatibility(conv_id)
        messages = conversation.get('messages', [])

        if not isinstance(messages, list):
            messages = []

        user_turns = _build_conversation_user_turns(messages)

        return jsonify({
            'success': True,
            'turns': user_turns,
            'total_messages': len(messages),
            'total_turns': len(user_turns),
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/conversations/<conv_id>/puzzle-states', methods=['GET'])
@require_login
def get_puzzle_states(conv_id):
    """获取对话中所有 puzzle 的画布状态"""
    username = session['username']
    manager = ConversationService(username)
    try:
        puzzle_states = manager.get_puzzle_states(conv_id)
        return jsonify({'success': True, 'puzzle_states': puzzle_states if isinstance(puzzle_states, dict) else {}})
    except Exception as e:
        if isinstance(e, ConversationNotFoundError):
            return jsonify({'success': False, 'message': str(e), 'puzzle_states': {}}), 404
        if isinstance(e, ConversationValidationError):
            return jsonify({'success': False, 'message': str(e), 'puzzle_states': {}}), 400
        return jsonify({'success': False, 'message': str(e), 'puzzle_states': {}}), 500


@app.route('/api/conversations/<conv_id>/puzzle-states', methods=['POST'])
@require_login
def save_puzzle_state(conv_id):
    """保存/更新单个 puzzle 的画布状态"""
    username = session['username']
    data = request.get_json(silent=True) or {}
    puzzle_id = str(data.get('puzzle_id') or '').strip()
    state = data.get('state')
    if not puzzle_id:
        return jsonify({'success': False, 'message': 'puzzle_id is required'}), 400
    if not isinstance(state, dict):
        return jsonify({'success': False, 'message': 'state must be a dict'}), 400
    manager = ConversationService(username)
    # 严格校验委托至 Service/puzzle.py，未知字段直接报错
    try:
        manager.update_puzzle_state(conv_id, puzzle_id, state)
        return jsonify({'success': True, 'puzzle_id': puzzle_id})
    except Exception as e:
        if isinstance(e, ConversationValidationError):
            return jsonify({'success': False, 'message': str(e)}), 400
        if isinstance(e, ConversationNotFoundError):
            return jsonify({'success': False, 'message': str(e)}), 404
        if isinstance(e, ConversationConflictError):
            return jsonify({'success': False, 'message': str(e)}), 409
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/conversations/<conv_id>', methods=['DELETE'])
@require_login
def delete_conversation(conv_id):
    """删除对话（完整资源包原子归档）"""
    username = session['username']
    try:
        from basis.Conversation.trash import ConversationTrashService
        trash_id = ConversationTrashService(username).archive_and_delete(username, conv_id)
        return jsonify({'success': True, 'trash_id': trash_id})
    except ConversationNotFoundError as e:
        return jsonify({'success': False, 'message': str(e)}), 404
    except ConversationConflictError as e:
        return jsonify({'success': False, 'message': str(e)}), 409
    except ConversationValidationError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/trash/list', methods=['GET'])
@require_login
def list_trash_items():
    username = session['username']
    try:
        limit_raw = request.args.get('limit', 120)
        try:
            limit = int(limit_raw or 120)
        except Exception:
            limit = 120
        from basis.Conversation.trash import ConversationTrashService
        trash_svc = ConversationTrashService(username)
        items = trash_svc.list_entries(username, limit=limit)
        return jsonify({'success': True, 'items': items, 'count': len(items)})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/trash/<trash_id>/restore', methods=['POST'])
@app.route('/api/trash/restore', methods=['POST'])
@require_login
def restore_trash_item(trash_id=None):
    username = session['username']
    data = request.get_json(silent=True) or {}
    trash_id = str(trash_id or data.get('id') or '').strip()

    if not trash_id:
        return jsonify({'success': False, 'message': '缺少回收站条目ID'}), 400

    from basis.Conversation.trash import ConversationTrashService
    trash_svc = ConversationTrashService(username)
    try:
        entry = trash_svc.read_entry(username, trash_id)
    except ConversationNotFoundError as e:
        return jsonify({'success': False, 'message': str(e)}), 404
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

    if not isinstance(entry, dict):
        return jsonify({'success': False, 'message': '回收站条目不存在'}), 404

    entry_type = str(entry.get('type') or '').strip()
    ok = False
    err = ''
    restored: Dict[str, Any] = {}

    if entry_type == 'conversation':
        try:
            restored_id = trash_svc.restore_to_active(username, trash_id)
            ok = True
            restored = {"conversation_id": restored_id, "title": str(entry.get('title') or '')}
        except ConversationNotFoundError as e:
            return jsonify({'success': False, 'message': str(e)}), 404
        except ConversationConflictError as e:
            return jsonify({'success': False, 'message': str(e)}), 409
        except ConversationValidationError as e:
            return jsonify({'success': False, 'message': str(e)}), 400
        except Exception as e:
            return jsonify({'success': False, 'message': str(e)}), 500
    elif entry_type == 'knowledge_basis':
        payload = entry.get('payload') if isinstance(entry.get('payload'), dict) else entry.get('conversation') if isinstance(entry.get('conversation'), dict) else {}
        title = str(entry.get('title') or '').strip()
        ok, err, restored = _restore_basis_from_trash(username, payload, title_hint=title)
        if not ok:
            return jsonify({'success': False, 'message': err or '恢复失败'}), 500
    else:
        return jsonify({'success': False, 'message': f'不支持的回收站类型: {entry_type}'}), 400

    if ok:
        cleanup_warning = None
        try:
            trash_svc.remove_entry(username, trash_id)
        except Exception as cleanup_e:
            cleanup_warning = str(cleanup_e)
            # 可观测：记录日志并在响应中暴露
            try:
                app.logger.warning(f"trash cleanup failed after restore trash_id={trash_id} err={cleanup_e}")
            except Exception:
                pass
    resp = {
        'success': True,
        'id': trash_id,
        'type': entry_type,
        'restored': restored
    }
    if cleanup_warning:
        resp['warning'] = f"trash cleanup failed: {cleanup_warning}"
        resp['trash_cleanup_failed'] = True
    return jsonify(resp)


@app.route('/api/trash', methods=['DELETE'])
@app.route('/api/trash/clear', methods=['POST'])
@require_login
def clear_trash_items():
    username = session['username']
    try:
        from basis.Conversation.trash import ConversationTrashService
        trash_svc = ConversationTrashService(username)
        removed = trash_svc.clear_entries(username)
        return jsonify({'success': True, 'removed': int(max(0, removed))})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


def _delete_conversation_message_response(conv_id, index):
    username = session['username']

    if conv_id is None:
        return jsonify({"success": False, "message": "Missing conversation_id"}), 400

    if index is None:
        return jsonify({"success": False, "message": "Missing index"}), 400

    try:
        index = int(index)
    except Exception:
        return jsonify({"success": False, "message": "Invalid index"}), 400

    service = ConversationService(username)

    try:
        conversation = service.get_conversation(conv_id)
    except Exception:
        conversation = None

    if not isinstance(conversation, dict):
        return jsonify({"success": False, "message": "Conversation not found"}), 404

    messages = conversation.get('messages', []) if isinstance(conversation.get('messages', []), list) else []

    if index < 0 or index >= len(messages):
        return jsonify({
            "success": False,
            "message": "消息索引已过期，请刷新后重试",
            "server_message_count": len(messages)
        }), 409

    try:
        service.delete_turn(conv_id, int(index))
        try:
            conversation = service.get_conversation(conv_id)
            keep_ids = _collect_referenced_asset_ids(conversation)
            _cleanup_conversation_assets(username, conv_id, keep_asset_ids=keep_ids)
        except Exception as e:
            print(f"[ASSET] cleanup after delete_message failed: {e}")
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/delete_message', methods=['POST'])
@require_login
def delete_message():
    data = request.get_json(silent=True) or {}

    if not data:
        return jsonify({"success": False, "message": "No data provided"}), 400

    return _delete_conversation_message_response(data.get('conversation_id'), data.get('index'))


@app.route('/api/conversations/<conv_id>/messages/<int:msg_index>', methods=['DELETE'])
@require_login
def delete_conversation_message(conv_id, msg_index):
    return _delete_conversation_message_response(conv_id, msg_index)


@app.route('/api/conversations/<conv_id>/messages/<int:msg_index>/content', methods=['PUT'])
@require_login
def update_user_message_content(conv_id, msg_index):
    data = request.json or {}
    content = str(data.get('content') or '').strip()
    if not content:
        return jsonify({'success': False, 'message': '消息内容不能为空'}), 400
    if len(content) > 12000:
        return jsonify({'success': False, 'message': '消息长度不能超过 12000'}), 400

    username = session['username']
    service = ConversationService(username)
    try:
        service.edit_user_message(conv_id, int(msg_index), content)
        return jsonify({
            'success': True,
            'conversation_id': conv_id,
            'index': int(msg_index),
            'content': content
        })
    except Exception as e:
        msg = str(e)
        if "仅支持修改最后一条" in msg or "仅支持修改用户消息" in msg:
            return jsonify({'success': False, 'message': msg}), 400
        if "消息索引" in msg or "越界" in msg:
            return jsonify({'success': False, 'message': msg}), 400
        return jsonify({'success': False, 'message': msg}), 500


@app.route('/api/conversations/<conv_id>/user_partial', methods=['POST'])
@require_login
def save_user_partial(conv_id):
    data = request.get_json(silent=True) or {}
    content = str(data.get('content') or '')
    if not content.strip():
        return jsonify({'success': False, 'message': 'content 不能为空'}), 400

    username = session['username']
    manager = ConversationService(username)
    try:
        conversation = manager.get_conversation(conv_id)
    except Exception:
        conversation = None
    if not isinstance(conversation, dict):
        return jsonify({'success': False, 'message': '对话不存在'}), 404

    metadata_raw = data.get('metadata')
    metadata = metadata_raw if isinstance(metadata_raw, dict) else {}
    metadata = dict(metadata)
    model_name = str(data.get('model_name') or '').strip()
    if model_name and not str(metadata.get('model_name') or '').strip():
        metadata['model_name'] = model_name

    try:
        manager.add_message(
            conv_id,
            'user',
            content,
            metadata=metadata
        )
        return jsonify({
            'success': True,
            'conversation_id': conv_id,
            'index': max(0, len(manager.get_messages(conv_id)) - 1),
            'saved_chars': len(content)
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/conversations/<conv_id>/assistant_partial', methods=['POST'])
@require_login
def save_assistant_partial(conv_id):
    data = request.get_json(silent=True) or {}
    content = str(data.get('content') or '')
    if not content.strip():
        return jsonify({'success': False, 'message': 'content 不能为空'}), 400

    username = session['username']
    service = ConversationService(username)
    try:
        conversation = service.get_conversation(conv_id)
    except Exception:
        conversation = None
    if not isinstance(conversation, dict):
        return jsonify({'success': False, 'message': '对话不存在'}), 404

    raw_index = data.get('index', None)
    index = None
    if raw_index is not None:
        try:
            parsed = int(raw_index)
        except Exception:
            return jsonify({
                'success': False,
                'message': '消息索引无效'
            }), 400
        messages = conversation.get('messages', []) if isinstance(conversation.get('messages', []), list) else []
        if parsed < 0 or parsed >= len(messages):
            return jsonify({
                'success': False,
                'message': '消息索引已过期，请同步后重试',
                'server_message_count': len(messages)
            }), 409
        target = messages[parsed] if isinstance(messages[parsed], dict) else {}
        target_role = str(target.get('role') or '').strip()
        if target_role != 'assistant':
            return jsonify({
                'success': False,
                'message': '消息索引角色不匹配，请同步后重试',
                'server_message_count': len(messages),
                'target_role': target_role
            }), 409
        index = parsed

    try:
        if index is not None:
            # 严格部分更新
            service.update_assistant_partial(conv_id, int(index), {"content": content, "status": "partial"})
        else:
            # 无索引时追加为 partial
            # 通过 begin_user_turn 的 placeholder 机制追加
            turn = service.begin_user_turn(conv_id, "[partial]", metadata={})
            service.update_assistant_partial(conv_id, int(turn.get("assistant_index")), {"content": content, "status": "partial"})
            index = int(turn.get("assistant_index"))
        return jsonify({
            'success': True,
            'conversation_id': conv_id,
            'index': index,
            'saved_chars': len(content)
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/conversations/<conv_id>/assets/<asset_id>', methods=['GET'])
@require_login
def get_conversation_asset(conv_id, asset_id):
    username = session['username']
    try:
        fpath, mime, _meta = asset_store.get_conversation_asset_file(username, conv_id, asset_id)
        return send_file(fpath, mimetype=mime)
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except FileNotFoundError as e:
        return jsonify({'success': False, 'message': str(e)}), 404


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
        
    service = ConversationService(username)
    try:
        service.switch_message_version(conv_id, int(msg_index), int(ver_index))
        try:
            conversation = service.get_conversation(conv_id)
            messages = conversation.get("messages", []) if isinstance(conversation, dict) else []
            switched_message = None
            if isinstance(messages, list) and 0 <= int(msg_index) < len(messages):
                switched_message = deepcopy(messages[int(msg_index)])
            return jsonify({"success": True, "message": switched_message})
        except Exception:
            return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


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

        blacklist = get_user_model_blacklist(username)

        config = get_config_all()
        context_refresh_mode = _normalize_context_refresh_mode(request.args.get('context_refresh', 'async'))
        (
            volc_context_map,
            aliyun_context_map,
            ollama_context_map,
            generic_context_maps
        ) = _resolve_context_window_maps_for_config(config, context_refresh_mode)

        providers_info = {}
        for provider_name, provider_cfg in (config.get('providers', {}) or {}).items():
            if not isinstance(provider_cfg, dict):
                continue
            providers_info[provider_name] = {
                'api_type': provider_cfg.get('api_type', 'openai')
            }

        models_info = []
        for model_id, info in config.get('models', {}).items():
            if model_id in blacklist:
                continue
            provider_label = str(info.get('provider', 'volcengine') or 'volcengine').strip()
            provider_name = provider_label.lower()
            provider_api_type = _resolve_provider_api_type(provider_label)
            item = {
                'id': model_id,
                'name': info.get('name', model_id),
                'provider': info.get('provider', 'volcengine'),
                'status': info.get('status', 'normal')
            }
            context_window = _to_context_window(info)
            if not context_window and provider_name == 'volcengine':
                context_window = _resolve_volc_context_window_by_model_id(model_id, volc_context_map)
            if not context_window and provider_name in {'aliyun', 'dashscope'}:
                context_window = _resolve_aliyun_context_window_by_model_id(model_id, aliyun_context_map)
            if not context_window and provider_api_type == 'ollama':
                context_window = _resolve_context_window_by_model_id(model_id, ollama_context_map)
            if not context_window and provider_name in generic_context_maps:
                context_window = _resolve_context_window_by_model_id(model_id, generic_context_maps.get(provider_name))
            if context_window:
                item['context_window'] = context_window
            models_info.append(item)

        default_model = config.get('default_model')
        if default_model in blacklist:
            default_model = models_info[0]['id'] if models_info else None

        models_sync_state = build_models_config_sync_state()

        return jsonify({
            'success': True,
            'models': models_info,
            'providers': providers_info,
            'default_model': default_model,
            'models_config_version': models_sync_state.get('version', ''),
            'models_config_fingerprint': models_sync_state.get('fingerprint', ''),
            'models_config_updated_at': models_sync_state.get('updated_at', 0),
            'context_refresh_mode': context_refresh_mode,
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/admin/system/settings', methods=['GET'])
@require_admin
def admin_get_system_settings():
    """管理员读取系统总设置。"""
    try:
        cfg = ensure_main_config_defaults()
        models_cfg = load_models_config()
        return jsonify({
            'success': True,
            'settings': _build_admin_system_settings_payload(cfg, models_cfg),
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/admin/system/settings', methods=['POST'])
@require_admin
def admin_update_system_settings():
    """管理员保存系统总设置。"""
    payload = request.get_json(silent=True) or {}

    try:
        cfg = ensure_main_config_defaults()
        previous_cfg = deepcopy(cfg)
        models_cfg = load_models_config()
        next_cfg = _apply_admin_system_settings_payload(cfg, models_cfg, payload)
        saved = save_main_config(next_cfg)
        runtime_sync = _SYSTEM_SETTINGS_RUNTIME_SYNCER.sync_after_save(
            saved_config=saved,
            previous_config=previous_cfg,
            server_client_cache=_CLIENT_CACHE,
            start_mail_event_stream=start_nexora_mail_event_stream,
            notify_mail_event_stream_config_changed=notify_nexora_mail_event_stream_config_changed,
            invalidate_all_mail_cache=_mail_cache_invalidate_all_users,
        )

        return jsonify({
            'success': True,
            'message': '系统设置已保存，进程配置已同步',
            'settings': _build_admin_system_settings_payload(saved, models_cfg),
            'runtime_sync': runtime_sync,
        })
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/admin/models/config', methods=['GET'])
@require_admin
def admin_get_models_config():
    """管理员读取模型/Provider配置"""
    try:
        cfg = load_models_config()
        models = deepcopy(cfg.get('models', {}))
        providers = cfg.get('providers', {})
        has_volcengine_model = any(
            isinstance(info, dict) and str(info.get('provider', 'volcengine')).strip().lower() == 'volcengine'
            for info in (models or {}).values()
        )
        has_aliyun_model = any(
            isinstance(info, dict) and str(info.get('provider', '')).strip().lower() in {'aliyun', 'dashscope'}
            for info in (models or {}).values()
        )
        has_ollama_model = any(
            isinstance(provider_cfg, dict) and str(provider_cfg.get('api_type', '')).strip().lower() == 'ollama'
            for provider_cfg in (providers or {}).values()
        )
        volc_context_map = _refresh_volc_context_window_map(cfg, timeout=8.0) if has_volcengine_model else {}
        aliyun_context_map = _refresh_aliyun_context_window_map(cfg, timeout=8.0) if has_aliyun_model else {}
        ollama_context_map = _refresh_ollama_context_window_map(cfg, timeout=8.0) if has_ollama_model else {}
        generic_context_maps = _refresh_generic_context_window_maps(cfg, timeout=8.0)

        for model_id, info in models.items():
            if not isinstance(info, dict):
                continue

            context_window = _extract_context_window_from_provider_row(info)
            provider_label = str(info.get('provider', 'volcengine') or 'volcengine').strip()
            provider_name = provider_label.lower()
            provider_cfg = providers.get(provider_label, {}) if isinstance(providers, dict) else {}
            provider_api_type = _normalize_provider_api_type(
                provider_cfg.get('api_type') if isinstance(provider_cfg, dict) else ''
            )

            if not context_window and provider_name == 'volcengine':
                context_window = _resolve_volc_context_window_by_model_id(model_id, volc_context_map)
            if not context_window and provider_name in {'aliyun', 'dashscope'}:
                context_window = _resolve_aliyun_context_window_by_model_id(model_id, aliyun_context_map)
            if not context_window and provider_api_type == 'ollama':
                context_window = _resolve_context_window_by_model_id(model_id, ollama_context_map)
            if not context_window and provider_name in generic_context_maps:
                context_window = _resolve_context_window_by_model_id(model_id, generic_context_maps.get(provider_name))
            if context_window:
                info['context_window'] = context_window

        return jsonify({
            'success': True,
            'models': models,
            'providers': providers
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


def _get_admin_provider_runtime(provider_name: str):
    provider = str(provider_name or '').strip()
    if not provider:
        return {}, None, 'provider 不能为空'
    config = get_config_all()
    providers = config.get('providers', {}) if isinstance(config, dict) else {}
    provider_cfg = providers.get(provider)
    if not isinstance(provider_cfg, dict):
        return {}, None, f'provider 不存在: {provider}'
    adapter = create_provider_adapter(provider, provider_cfg)
    return provider_cfg, adapter, ''


def _normalize_browser_ollama_provider_key(provider_name: Any) -> str:
    return str(provider_name or '').strip().lower()


def _resolve_browser_ollama_provider_name(provider_name: Any) -> Tuple[str, str]:
    requested = str(provider_name or '').strip()
    provider_key = _normalize_browser_ollama_provider_key(requested)

    if not provider_key:
        return '', 'provider 不能为空'

    config = get_config_all()
    providers = config.get('providers', {}) if isinstance(config, dict) else {}

    for name, provider_cfg in providers.items():
        current_key = _normalize_browser_ollama_provider_key(name)

        if current_key != provider_key:
            continue

        if not isinstance(provider_cfg, dict):
            return '', f'provider 配置格式错误: {name}'

        api_type = str(provider_cfg.get('api_type', '') or '').strip().lower()

        if api_type != 'ollama':
            return '', f'provider {name} 不是 ollama'

        return str(name or '').strip(), ''

    return '', f'provider 不存在: {requested}'


def _normalize_browser_ollama_provider_names(provider_names: Any) -> List[str]:
    raw_items = provider_names if isinstance(provider_names, list) else [provider_names]
    resolved: List[str] = []
    seen: Set[str] = set()

    for item in raw_items:
        provider_name, err = _resolve_browser_ollama_provider_name(item)

        if err or not provider_name:
            continue

        provider_key = _normalize_browser_ollama_provider_key(provider_name)

        if provider_key in seen:
            continue

        seen.add(provider_key)
        resolved.append(provider_name)

    return resolved


def _build_browser_ollama_status_fingerprint(payload: Dict[str, Any]) -> str:
    source = payload if isinstance(payload, dict) else {}
    rows = source.get('models', []) if isinstance(source.get('models'), list) else []
    normalized_rows = []

    for row in rows:
        item = row if isinstance(row, dict) else {}
        model_id = str(item.get('id') or item.get('model') or item.get('name') or '').strip().lower()

        if not model_id:
            continue

        normalized_rows.append({
            'id': model_id,
            'installed': bool(item.get('installed', False)),
            'keep_alive': str(item.get('keep_alive') or '').strip(),
            'running': bool(item.get('running', False)),
            'status': str(item.get('status') or '').strip().lower(),
            'status_label': str(item.get('status_label') or '').strip(),
            'status_level': str(item.get('status_level') or '').strip().lower(),
        })

    normalized_rows.sort(key=lambda item: item.get('id', ''))
    fingerprint_payload = {
        'success': bool(source.get('success', False)),
        'message': str(source.get('message') or source.get('error') or '').strip(),
        'models': normalized_rows,
    }
    raw = json.dumps(fingerprint_payload, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def _fetch_browser_ollama_status_live(provider_name: str, timeout: float = 8.0) -> Dict[str, Any]:
    provider_cfg, adapter, err = _get_admin_provider_runtime(provider_name)

    if err:
        return {
            'success': False,
            'provider': provider_name,
            'api_type': 'ollama',
            'models': [],
            'message': err,
        }

    api_type = str(getattr(adapter, 'api_type', '') or '').strip().lower()

    if api_type != 'ollama':
        return {
            'success': False,
            'provider': provider_name,
            'api_type': api_type,
            'models': [],
            'message': f'provider {provider_name} 不是 ollama',
        }

    if not hasattr(adapter, 'list_running_models'):
        return {
            'success': False,
            'provider': provider_name,
            'api_type': api_type,
            'models': [],
            'message': 'ollama status helper not supported',
        }

    result = adapter.list_running_models(timeout=timeout)
    result = result if isinstance(result, dict) else {}
    return {
        'success': bool(result.get('ok', False)),
        **result,
        'provider': provider_name,
        'api_type': api_type,
    }


def _get_browser_ollama_cached_status(provider_name: str) -> Optional[Dict[str, Any]]:
    provider_key = _normalize_browser_ollama_provider_key(provider_name)

    if not provider_key:
        return None

    with _BROWSER_OLLAMA_STATUS_LOCK:
        cache_entry = _BROWSER_OLLAMA_STATUS_CACHE.get(provider_key)

        if not isinstance(cache_entry, dict):
            return None

        payload = cache_entry.get('payload') if isinstance(cache_entry.get('payload'), dict) else {}

        if not payload:
            return None

        return deepcopy(payload)


def _send_browser_ollama_status_to_client(client: Dict[str, Any], provider_names: List[str]) -> None:
    statuses = []

    for provider_name in provider_names or []:
        payload = _get_browser_ollama_cached_status(provider_name)

        if payload:
            statuses.append(payload)

    if statuses:
        _send_browser_ws_client(client, 'ollama_status_state', {'statuses': statuses})


def _send_browser_ollama_status_changed(provider_name: str, payload: Dict[str, Any]) -> None:
    provider_key = _normalize_browser_ollama_provider_key(provider_name)

    if not provider_key:
        return

    with _BROWSER_WS_LOCK:
        clients_snapshot = {
            user: dict(user_clients or {})
            for user, user_clients in _BROWSER_WS_CLIENTS.items()
        }

    dead_clients: List[Tuple[str, str]] = []

    for user, user_clients in clients_snapshot.items():

        for client_id, client in user_clients.items():
            subscribed = client.get('ollama_providers')
            subscribed_keys = subscribed if isinstance(subscribed, set) else set()

            if provider_key not in subscribed_keys:
                continue

            if not _send_browser_ws_client(client, 'ollama_status_changed', payload):
                dead_clients.append((user, client_id))

    for user, client_id in dead_clients:
        _drop_browser_ws_client(user, client_id)


def _refresh_browser_ollama_status_provider(provider_name: str, source: str = 'poll', force: bool = False) -> None:
    resolved_name, err = _resolve_browser_ollama_provider_name(provider_name)

    if err or not resolved_name:
        return

    provider_key = _normalize_browser_ollama_provider_key(resolved_name)
    now = time.time()

    with _BROWSER_OLLAMA_STATUS_LOCK:
        cache_entry = _BROWSER_OLLAMA_STATUS_CACHE.get(provider_key)
        last_updated = float(cache_entry.get('updated_at', 0.0)) if isinstance(cache_entry, dict) else 0.0

        if provider_key in _BROWSER_OLLAMA_STATUS_IN_FLIGHT:
            return

        if not force and cache_entry and (now - last_updated) < _BROWSER_OLLAMA_STATUS_POLL_SEC:
            return

        _BROWSER_OLLAMA_STATUS_IN_FLIGHT.add(provider_key)

    changed = False
    payload: Dict[str, Any] = {}

    try:
        payload = _fetch_browser_ollama_status_live(resolved_name, timeout=8.0)
        fingerprint = _build_browser_ollama_status_fingerprint(payload)
        updated_at = int(time.time())

        with _BROWSER_OLLAMA_STATUS_LOCK:
            previous = _BROWSER_OLLAMA_STATUS_CACHE.get(provider_key)
            previous_fingerprint = str(previous.get('fingerprint') or '') if isinstance(previous, dict) else ''
            previous_revision = int(previous.get('revision') or 0) if isinstance(previous, dict) else 0
            changed = fingerprint != previous_fingerprint
            revision = previous_revision + 1 if changed else previous_revision
            payload = {
                **payload,
                'provider': resolved_name,
                'provider_key': provider_key,
                'revision': revision,
                'source': str(source or 'poll').strip() or 'poll',
                'updated_at': updated_at,
            }
            _BROWSER_OLLAMA_STATUS_CACHE[provider_key] = {
                'fingerprint': fingerprint,
                'payload': deepcopy(payload),
                'provider': resolved_name,
                'revision': revision,
                'updated_at': time.time(),
            }
    except Exception as e:
        updated_at = int(time.time())
        payload = {
            'success': False,
            'provider': resolved_name,
            'provider_key': provider_key,
            'api_type': 'ollama',
            'models': [],
            'message': str(e),
            'revision': 0,
            'source': str(source or 'poll').strip() or 'poll',
            'updated_at': updated_at,
        }
        fingerprint = _build_browser_ollama_status_fingerprint(payload)

        with _BROWSER_OLLAMA_STATUS_LOCK:
            previous = _BROWSER_OLLAMA_STATUS_CACHE.get(provider_key)
            previous_fingerprint = str(previous.get('fingerprint') or '') if isinstance(previous, dict) else ''
            previous_revision = int(previous.get('revision') or 0) if isinstance(previous, dict) else 0
            changed = fingerprint != previous_fingerprint
            revision = previous_revision + 1 if changed else previous_revision
            payload['revision'] = revision
            _BROWSER_OLLAMA_STATUS_CACHE[provider_key] = {
                'fingerprint': fingerprint,
                'payload': deepcopy(payload),
                'provider': resolved_name,
                'revision': revision,
                'updated_at': time.time(),
            }
    finally:
        with _BROWSER_OLLAMA_STATUS_LOCK:
            _BROWSER_OLLAMA_STATUS_IN_FLIGHT.discard(provider_key)

    if changed:
        _send_browser_ollama_status_changed(resolved_name, payload)


def _request_browser_ollama_status_refresh(provider_names: List[str], source: str = 'poll', force: bool = False) -> None:
    providers = _normalize_browser_ollama_provider_names(provider_names)

    for provider_name in providers:
        thread = threading.Thread(
            target=_refresh_browser_ollama_status_provider,
            args=(provider_name, source, force),
            daemon=True,
            name=f'ollama-status-{_normalize_browser_ollama_provider_key(provider_name)}'
        )
        thread.start()


def _get_active_browser_ollama_status_providers() -> List[str]:
    provider_keys: Set[str] = set()

    with _BROWSER_WS_LOCK:

        for user_clients in _BROWSER_WS_CLIENTS.values():

            for client in (user_clients or {}).values():
                subscribed = client.get('ollama_providers')

                if isinstance(subscribed, set):
                    provider_keys.update(subscribed)

    config = get_config_all()
    providers = config.get('providers', {}) if isinstance(config, dict) else {}
    resolved: List[str] = []

    for provider_name, provider_cfg in providers.items():
        provider_key = _normalize_browser_ollama_provider_key(provider_name)

        if provider_key not in provider_keys:
            continue

        if not isinstance(provider_cfg, dict):
            continue

        api_type = str(provider_cfg.get('api_type', '') or '').strip().lower()

        if api_type == 'ollama':
            resolved.append(str(provider_name or '').strip())

    return resolved


def _browser_ollama_status_poll_loop() -> None:
    while True:
        providers = _get_active_browser_ollama_status_providers()

        if providers:
            _request_browser_ollama_status_refresh(providers, source='poll', force=False)
            time.sleep(_BROWSER_OLLAMA_STATUS_POLL_SEC)
        else:
            time.sleep(_BROWSER_OLLAMA_STATUS_IDLE_SLEEP_SEC)


def _ensure_browser_ollama_status_loop_started() -> None:
    global _BROWSER_OLLAMA_STATUS_LOOP_STARTED

    with _BROWSER_OLLAMA_STATUS_LOCK:

        if _BROWSER_OLLAMA_STATUS_LOOP_STARTED:
            return

        _BROWSER_OLLAMA_STATUS_LOOP_STARTED = True

    worker = threading.Thread(
        target=_browser_ollama_status_poll_loop,
        daemon=True,
        name='browser-ollama-status-poll'
    )
    worker.start()


@app.route('/api/provider/ollama/list', methods=['GET'])
@require_login
def api_provider_ollama_list():
    provider_name = normalize_text(request.args.get('provider', 'ollama'), default='ollama')
    timeout = request.args.get('timeout', 8)
    try:
        timeout = float(timeout or 8)
    except Exception:
        timeout = 8.0
    provider_cfg, adapter, err = _get_admin_provider_runtime(provider_name)
    if err:
        return jsonify({'success': False, 'provider': provider_name, 'message': err, 'models': []}), 404
    api_type = str(getattr(adapter, 'api_type', '') or '').strip().lower()
    if api_type != 'ollama':
        return jsonify({'success': False, 'provider': provider_name, 'message': f'provider {provider_name} 不是 ollama', 'models': []}), 400
    result = adapter.list_models(client=None, capability='', request_options={'models_catalog_timeout': timeout})
    status_code = 200 if bool(result.get('ok', False)) else 502
    return jsonify({'success': bool(result.get('ok', False)), **result}), status_code


@app.route('/api/provider/ollama/ps', methods=['GET'])
@require_login
def api_provider_ollama_ps():
    provider_name = normalize_text(request.args.get('provider', 'ollama'), default='ollama')
    timeout = request.args.get('timeout', 8)
    try:
        timeout = float(timeout or 8)
    except Exception:
        timeout = 8.0
    provider_cfg, adapter, err = _get_admin_provider_runtime(provider_name)
    if err:
        return jsonify({'success': False, 'provider': provider_name, 'message': err, 'models': []}), 404
    api_type = str(getattr(adapter, 'api_type', '') or '').strip().lower()
    if api_type != 'ollama':
        return jsonify({'success': False, 'provider': provider_name, 'message': f'provider {provider_name} 不是 ollama', 'models': []}), 400
    if hasattr(adapter, 'list_running_models'):
        result = adapter.list_running_models(timeout=timeout)
    else:
        result = {'ok': False, 'provider': provider_name, 'api_type': api_type, 'models': [], 'error': 'list_running_models_not_supported'}
    status_code = 200 if bool(result.get('ok', False)) else 502
    return jsonify({'success': bool(result.get('ok', False)), **result}), status_code


@app.route('/api/admin/models/ollama/status', methods=['GET'])
@require_admin
def admin_ollama_model_status():
    provider_name = normalize_text(request.args.get('provider', ''), default='')
    model_name = normalize_text(request.args.get('model_id', '') or request.args.get('model', ''), default='')
    try:
        timeout = float(request.args.get('timeout', 8) or 8)
    except Exception:
        timeout = 8.0
    if not provider_name:
        return jsonify({'success': False, 'message': 'provider 不能为空', 'status': 'missing'}), 400
    if not model_name:
        return jsonify({'success': False, 'message': 'model_id 不能为空', 'status': 'missing'}), 400
    provider_cfg, adapter, err = _get_admin_provider_runtime(provider_name)
    if err:
        return jsonify({'success': False, 'message': err, 'status': 'missing'}), 404
    api_type = str(getattr(adapter, 'api_type', '') or '').strip().lower()
    if api_type != 'ollama':
        return jsonify({'success': False, 'message': f'provider {provider_name} 不是 ollama', 'status': 'missing'}), 400
    if not hasattr(adapter, 'inspect_model_status'):
        return jsonify({'success': False, 'message': 'ollama status helper not supported', 'status': 'missing'}), 500
    result = adapter.inspect_model_status(model_name, timeout=timeout)
    status_code = 200 if result.get('status') != 'missing' else 404
    return jsonify({'success': bool(result.get('ok', False)), **result}), status_code


@app.route('/api/admin/models/ollama/toggle', methods=['POST'])
@require_admin
def admin_ollama_model_toggle():
    data = request.get_json() or {}
    provider_name = str(data.get('provider') or '').strip()
    model_name = str(data.get('model_id') or data.get('model') or '').strip()
    action = str(data.get('action') or 'toggle').strip().lower()
    keep_alive = data.get('keep_alive')
    try:
        timeout = float(data.get('timeout') or 12)
    except Exception:
        timeout = 12.0
    if not provider_name:
        return jsonify({'success': False, 'message': 'provider 不能为空'}), 400
    if not model_name:
        return jsonify({'success': False, 'message': 'model_id 不能为空'}), 400
    provider_cfg, adapter, err = _get_admin_provider_runtime(provider_name)
    if err:
        return jsonify({'success': False, 'message': err}), 404
    api_type = str(getattr(adapter, 'api_type', '') or '').strip().lower()
    if api_type != 'ollama':
        return jsonify({'success': False, 'message': f'provider {provider_name} 不是 ollama'}), 400
    if not hasattr(adapter, 'toggle_model_keep_alive'):
        return jsonify({'success': False, 'message': 'ollama toggle helper not supported'}), 500
    result = adapter.toggle_model_keep_alive(
        model_name=model_name,
        action=action,
        keep_alive=keep_alive,
        timeout=timeout,
    )
    if bool(result.get('ok', False)):
        _request_browser_ollama_status_refresh([provider_name], source='ollama_status_toggle', force=True)
        notify_models_config_changed('ollama_status_toggle')

    status_code = 200 if bool(result.get('ok', False)) else 502
    return jsonify({'success': bool(result.get('ok', False)), **result}), status_code


def _provider_models_cache_key(provider_name: str, capability: str) -> str:
    provider = str(provider_name or '').strip().lower()
    cap = str(capability or '').strip().lower()
    return f"{provider}::{cap}"


def _provider_models_cache_get(cache_key: str) -> Optional[Dict[str, Any]]:
    key = str(cache_key or '').strip()
    if not key:
        return None
    with _PROVIDER_MODELS_CACHE_LOCK:
        item = _PROVIDER_MODELS_CACHE.get(key)
        if not isinstance(item, dict):
            return None
        return deepcopy(item)


def _provider_models_cache_set(cache_key: str, payload: Dict[str, Any]):
    key = str(cache_key or '').strip()
    if not key:
        return
    data = payload if isinstance(payload, dict) else {}
    with _PROVIDER_MODELS_CACHE_LOCK:
        _PROVIDER_MODELS_CACHE[key] = {
            'ts': time.time(),
            'payload': deepcopy(data),
        }


def _launch_provider_models_refresh_bg(cache_key: str, refresh_fn, min_interval_sec: float = 20.0):
    key = str(cache_key or '').strip()
    if not key or not callable(refresh_fn):
        return False
    now = time.time()
    with _PROVIDER_MODELS_BG_LOCK:
        if _PROVIDER_MODELS_BG_REFRESHING.get(key):
            return False
        last = float(_PROVIDER_MODELS_BG_LAST_TS.get(key) or 0.0)
        if (now - last) < max(5.0, float(min_interval_sec or 20.0)):
            return False
        _PROVIDER_MODELS_BG_REFRESHING[key] = True
        _PROVIDER_MODELS_BG_LAST_TS[key] = now

    def _runner():
        try:
            refresh_fn()
        except Exception:
            pass
        finally:
            with _PROVIDER_MODELS_BG_LOCK:
                _PROVIDER_MODELS_BG_REFRESHING[key] = False
                _PROVIDER_MODELS_BG_LAST_TS[key] = time.time()

    thread = threading.Thread(target=_runner, daemon=True, name=f'provider-models-{key}')
    thread.start()
    return True


def _fetch_provider_models_live(provider_name: str, capability: str, timeout: float = 30.0) -> Tuple[bool, int, Dict[str, Any]]:
    config = get_config_all()
    providers = config.get('providers', {}) if isinstance(config, dict) else {}
    provider_cfg = providers.get(provider_name)
    if not isinstance(provider_cfg, dict):
        return False, 404, {
            'success': False,
            'message': f'provider 不存在: {provider_name}',
            'provider': provider_name,
            'capability': capability
        }

    adapter = create_provider_adapter(provider_name, provider_cfg)
    api_key = str(provider_cfg.get('api_key', '') or '').strip()
    base_url = str(provider_cfg.get('base_url', '') or '').strip()
    api_type = str(getattr(adapter, 'api_type', '') or '').strip().lower()
    if api_type not in {'ollama', 'vllm'} and not api_key:
        return False, 400, {
            'success': False,
            'message': f'provider {provider_name} 未配置 api_key',
            'provider': provider_name,
            'capability': capability
        }

    if api_type == 'ollama':
        result = adapter.list_models(
            client=None,
            capability=capability,
            request_options={}
        )
    else:
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
    payload = {'success': ok, **result}
    if 'context_window_status' not in payload:
        payload['context_window_status'] = _build_provider_models_context_diagnostics(result)
    return ok, status_code, payload


@app.route('/api/provider/models', methods=['GET'])
@require_login
def api_provider_models():
    """
    Provider model listing test endpoint.
    Example:
      /api/provider/models?provider=volcengine&capability=vision
    """
    provider_name = normalize_text(request.args.get('provider', 'volcengine'), default='volcengine')
    capability = normalize_text(request.args.get('capability', ''), default='').lower()
    try:
        timeout = float(request.args.get('timeout', 30) or 30)
    except Exception:
        timeout = 30.0
    if timeout <= 0:
        timeout = 30.0

    provider_lower = provider_name.lower()
    if provider_lower in {'aliyun', 'volcengine'}:
        timeout = min(timeout, 8.0)
    try:
        cache_ttl = int(request.args.get('cache_ttl', 600) or 600)
    except Exception:
        cache_ttl = 600
    cache_ttl = max(0, min(cache_ttl, 3600))
    cache_key = _provider_models_cache_key(provider_name, capability)
    config = get_config_all()
    providers = config.get('providers', {}) if isinstance(config, dict) else {}
    provider_cfg = providers.get(provider_name)
    if not isinstance(provider_cfg, dict):
        provider_cfg = {}
    cache_entry = _provider_models_cache_get(cache_key)
    adapter = create_provider_adapter(provider_name, provider_cfg)
    api_type = str(getattr(adapter, 'api_type', '') or '').strip().lower()

    if api_type == 'ollama' and isinstance(cache_entry, dict):
        cached_payload = cache_entry.get('payload') if isinstance(cache_entry.get('payload'), dict) else {}
        cached_age = max(0, int(time.time() - float(cache_entry.get('ts') or 0.0)))
        if cached_payload and (cache_ttl <= 0 or cached_age <= cache_ttl):
            return jsonify({
                **cached_payload,
                'from_cache': True,
                'cache_age_sec': cached_age
            }), 200
        if cached_payload:
            _launch_provider_models_refresh_bg(
                cache_key,
                lambda: (
                    (lambda ok, status, payload: _provider_models_cache_set(cache_key, payload) if ok else None)(
                        *_fetch_provider_models_live(provider_name, capability, timeout=timeout)
                    )
                ),
                min_interval_sec=20.0
            )
            return jsonify({
                **cached_payload,
                'from_cache': True,
                'cache_age_sec': cached_age,
                'stale': True
            }), 200

    if api_type == 'ollama' and not isinstance(cache_entry, dict):
        _launch_provider_models_refresh_bg(
            cache_key,
            lambda: (
                (lambda ok, status, payload: _provider_models_cache_set(cache_key, payload) if ok else None)(
                    *_fetch_provider_models_live(provider_name, capability, timeout=timeout)
                )
            ),
            min_interval_sec=20.0
        )
        return jsonify({
            'success': True,
            'provider': provider_name,
            'capability': capability,
            'api_type': api_type,
            'models': [],
            'from_cache': False,
            'stale': True,
        }), 200

    if isinstance(cache_entry, dict):
        cached_payload = cache_entry.get('payload') if isinstance(cache_entry.get('payload'), dict) else {}
        cached_age = max(0, int(time.time() - float(cache_entry.get('ts') or 0.0)))
        if cached_payload and (cache_ttl <= 0 or cached_age <= cache_ttl):
            return jsonify({
                **cached_payload,
                'from_cache': True,
                'cache_age_sec': cached_age
            }), 200

        if cached_payload:
            _launch_provider_models_refresh_bg(
                cache_key,
                lambda: (
                    (lambda ok, status, payload: _provider_models_cache_set(cache_key, payload) if ok else None)(
                        *_fetch_provider_models_live(provider_name, capability, timeout=timeout)
                    )
                ),
                min_interval_sec=20.0
            )
            return jsonify({
                **cached_payload,
                'from_cache': True,
                'cache_age_sec': cached_age,
                'stale': True
            }), 200

    try:
        ok, status_code, payload = _fetch_provider_models_live(provider_name, capability, timeout=timeout)
        if ok:
            _provider_models_cache_set(cache_key, payload)
        elif isinstance(cache_entry, dict) and isinstance(cache_entry.get('payload'), dict):
            cached_payload = cache_entry.get('payload')
            cached_age = max(0, int(time.time() - float(cache_entry.get('ts') or 0.0)))
            return jsonify({
                **cached_payload,
                'from_cache': True,
                'cache_age_sec': cached_age,
                'stale': True
            }), 200
        return jsonify(payload), status_code
    except Exception as e:
        return jsonify({
            'success': False,
            'provider': provider_name,
            'capability': capability,
            'message': str(e)
        }), 500


@app.route('/api/admin/models/providers', methods=['POST'])
@app.route('/api/admin/models/providers/<path:target_provider>', methods=['PUT'])
@app.route('/api/admin/models/provider/upsert', methods=['POST'])
@require_admin
def admin_upsert_provider(target_provider=None):
    """新增或更新 Provider"""
    data = request.get_json(silent=True) or {}
    provider = (data.get('provider') or '').strip()
    original_provider = (target_provider or data.get('original_provider') or provider).strip()
    api_key = data.get('api_key')
    base_url = data.get('base_url')
    api_type = _normalize_provider_api_type(data.get('api_type'))
    user_agent = str(data.get('user_agent') or '').strip()
    settings = data.get('settings')
    enable_search_raw = data.get('enable_search')

    if not provider:
        return jsonify({'success': False, 'message': 'provider 不能为空'}), 400
    if api_key is None:
        api_key = ''
    if base_url is None:
        base_url = ''
    if not isinstance(settings, dict):
        settings = {}
    keep_alive = _normalize_keep_alive_value(settings.get('keep_alive', '5m'), default='5m')

    try:
        cfg = load_models_config()
        providers = cfg.setdefault('providers', {})
        models = cfg.setdefault('models', {})

        if original_provider and original_provider != provider:
            if original_provider not in providers:
                return jsonify({'success': False, 'message': '原 Provider 不存在'}), 404
            if provider in providers:
                return jsonify({'success': False, 'message': f'Provider 已存在: {provider}'}), 400
            for model_id, model_info in list(models.items()):
                if isinstance(model_info, dict) and (model_info.get('provider') == original_provider):
                    model_info['provider'] = provider
            existing_provider = providers.pop(original_provider, {})
        else:
            existing_provider = providers.get(provider, {})
        if not isinstance(existing_provider, dict):
            existing_provider = {}

        provider_record = dict(existing_provider)
        # API Key 留空表示保持不变:仅当提交了非空 key 时才覆盖,避免编辑时误清空已存密钥
        if api_key:
            provider_record['api_key'] = str(api_key)
        provider_record['base_url'] = str(base_url)
        provider_record['api_type'] = api_type or 'openai'
        if user_agent:
            provider_record['user_agent'] = user_agent
        else:
            provider_record.pop('user_agent', None)

        # 外部搜索能力：对 provider 生效，默认 off
        if enable_search_raw is not None:
            provider_record['enable_search'] = _coerce_bool_flag(enable_search_raw, False)
        elif 'enable_search' not in provider_record:
            provider_record['enable_search'] = False

        existing_settings = provider_record.get('settings', {}) if isinstance(provider_record.get('settings', {}), dict) else {}
        merged_settings = dict(existing_settings)
        merged_settings.update(settings)
        if provider_record['api_type'] == 'ollama':
            merged_settings['keep_alive'] = keep_alive
            provider_record['settings'] = merged_settings
        elif merged_settings:
            provider_record['settings'] = merged_settings
        elif 'settings' in provider_record:
            provider_record.pop('settings', None)

        providers[provider] = provider_record
        save_models_config(cfg, sync_source='admin_provider_upsert')
        return jsonify({'success': True, 'message': f'Provider {provider} 已保存'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/admin/models/providers/<path:target_provider>', methods=['DELETE'])
@app.route('/api/admin/models/provider/delete', methods=['POST'])
@require_admin
def admin_delete_provider(target_provider=None):
    """删除 Provider，需要输入确认文本"""
    data = request.get_json(silent=True) or {}
    provider = (target_provider or data.get('provider') or '').strip()
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
        save_models_config(cfg, sync_source='admin_provider_delete')
        return jsonify({'success': True, 'message': f'Provider {provider} 已删除'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/admin/models', methods=['POST'])
@app.route('/api/admin/models/<path:target_model_id>', methods=['PUT'])
@app.route('/api/admin/models/model/upsert', methods=['POST'])
@require_admin
def admin_upsert_model(target_model_id=None):
    """新增或更新模型"""
    data = request.get_json(silent=True) or {}
    model_id = (data.get('model_id') or '').strip()
    original_model_id = (target_model_id or data.get('original_model_id') or '').strip()
    name = (data.get('name') or '').strip()
    provider = (data.get('provider') or '').strip()
    status = _normalize_model_status_text(data.get('status') or 'normal')
    has_context_window_input = 'context_window' in data

    try:
        context_window = _parse_model_context_window_for_save(data.get('context_window'))
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400

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
        existing_key = original_model_id if is_rename else model_id
        existing_model = models.get(existing_key, {})
        if not isinstance(existing_model, dict):
            existing_model = {}

        if is_rename:
            if original_model_id not in models:
                return jsonify({'success': False, 'message': f'原模型不存在: {original_model_id}'}), 404
            if model_id in models:
                return jsonify({'success': False, 'message': f'目标模型ID已存在: {model_id}'}), 400
            del models[original_model_id]

        model_record = dict(existing_model)
        model_record['name'] = name or model_id
        model_record['provider'] = provider
        model_record['status'] = status or 'normal'

        if has_context_window_input:
            if context_window > 0:
                model_record['context_window'] = context_window
            else:
                for key in MODEL_CONTEXT_WINDOW_KEYS:
                    model_record.pop(key, None)

        models[model_id] = model_record
        save_models_config(cfg, sync_source='admin_model_upsert')
        if is_rename:
            return jsonify({'success': True, 'message': f'模型 {original_model_id} 已重命名为 {model_id}'})
        return jsonify({'success': True, 'message': f'模型 {model_id} 已保存'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/admin/models/<path:target_model_id>', methods=['DELETE'])
@app.route('/api/admin/models/model/delete', methods=['POST'])
@require_admin
def admin_delete_model(target_model_id=None):
    """删除模型，需要输入确认文本"""
    data = request.get_json(silent=True) or {}
    model_id = (target_model_id or data.get('model_id') or '').strip()
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
        save_models_config(cfg, sync_source='admin_model_delete')
        return jsonify({'success': True, 'message': f'模型 {model_id} 已删除'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

def _iter_sse_from_runtime_stream(stream_id: str, username: str, from_seq: int = 0):
    try:
        safe_from_seq = int(from_seq or 0)
    except Exception:
        safe_from_seq = 0
    meta = get_stream_session_meta(stream_id, username=username)
    if not meta:
        return

    session_info = {
        "type": "stream_session",
        "stream_id": str(stream_id or ""),
        "conversation_id": str(meta.get("conversation_id") or ""),
        "is_regenerate": bool(meta.get("is_regenerate", False)),
        "assistant_index": meta.get("assistant_index"),
        "regenerate_index": meta.get("regenerate_index"),
        "status": str(meta.get("status") or "running"),
        "from_seq": max(0, safe_from_seq),
        "head_seq": int(meta.get("head_seq") or 1),
        "last_seq": int(meta.get("last_seq") or 0),
    }
    yield f"data: {json.dumps(session_info, ensure_ascii=False, default=str)}\n\n"
    log_tool_sse_chunks = _should_log_tool_stream_chunks()

    for _, payload in iter_stream_session_chunks(
        stream_id,
        username=username,
        from_seq=max(0, safe_from_seq),
        heartbeat_sec=12
    ):
        if not isinstance(payload, dict):
            continue
        if str(payload.get("type") or "").strip() == "ping":
            yield ": ping\n\n"
            continue
        chunk_data = json.dumps(payload, ensure_ascii=False, default=str)
        if log_tool_sse_chunks and _is_tool_stream_chunk(payload):
            seq = payload.get("_stream_seq")
            content = _get_tool_chunk_debug_content(payload)

            try:
                content_dump = json.dumps(content, ensure_ascii=False, default=str)
            except Exception:
                content_dump = str(content)

            print(
                f"[TOOL_SSE] stream_id={stream_id} seq={seq} "
                f"type={payload.get('type')} content={content_dump}"
            )
        yield f"data: {chunk_data}\n\n"

    final_meta = get_stream_session_meta(stream_id, username=username) or {}
    final_message = None
    final_context_events = []
    final_conversation_id = str(
        final_meta.get("conversation_id") or meta.get("conversation_id") or ""
    ).strip()

    if final_conversation_id:
        try:
            manager = ConversationService(username)
            conversation = manager.get_conversation(final_conversation_id)
            final_context_events = manager.get_context_events(final_conversation_id)
            messages = conversation.get("messages", []) if isinstance(conversation, dict) else []

            if isinstance(messages, list) and messages:
                final_message_index = final_meta.get("regenerate_index")
                final_index = None

                try:
                    final_index = int(final_message_index) if final_message_index is not None else None
                except Exception:
                    final_index = None

                if final_index is not None and 0 <= final_index < len(messages):
                    final_message = messages[final_index]
                elif not bool(final_meta.get("is_regenerate", False)):
                    final_message = messages[-1]

                if isinstance(final_message, dict):
                    final_message = deepcopy(final_message)
        except Exception as final_message_error:
            final_message = None

    final_session_info = {
        "type": "stream_session",
        "stream_id": str(stream_id or ""),
        "conversation_id": final_conversation_id,
        "is_regenerate": bool(final_meta.get("is_regenerate", meta.get("is_regenerate", False))),
        "assistant_index": final_meta.get("assistant_index", meta.get("assistant_index")),
        "regenerate_index": final_meta.get("regenerate_index", meta.get("regenerate_index")),
        "status": str(final_meta.get("status") or "done"),
        "done": True,
        "cancel_requested": bool(final_meta.get("cancel_requested", False)),
        "cancel_reason": str(final_meta.get("cancel_reason") or ""),
        "error": str(final_meta.get("error") or ""),
        "head_seq": int(final_meta.get("head_seq") or meta.get("head_seq") or 1),
        "last_seq": int(final_meta.get("last_seq") or meta.get("last_seq") or 0),
        "final_message": final_message,
        "context_events": final_context_events,
    }
    yield f"data: {json.dumps(final_session_info, ensure_ascii=False, default=str)}\n\n"
    yield "data: [DONE]\n\n"


def _workspace_chat_error_response(error: Exception):
    if isinstance(error, PermissionError):
        return jsonify({'success': False, 'message': str(error) or 'workspace access denied'}), 403

    if isinstance(error, FileNotFoundError):
        return jsonify({'success': False, 'message': str(error) or 'workspace not found'}), 404

    if isinstance(error, ValueError):
        return jsonify({'success': False, 'message': str(error) or 'workspace request invalid'}), 400

    return jsonify({'success': False, 'message': str(error) or 'workspace request failed'}), 500


def _resolve_workspace_chat_context(username: str, data: Dict[str, Any], conversation_id: Any) -> Dict[str, Any]:
    workspace_id = _get_workspace_request_value(data, 'workspace_id', 'workspace', 'workspaces')

    if not workspace_id:
        return {}

    from App.Workspace import find_store_for_visible_workspace, validate_workspace_id

    wid = validate_workspace_id(workspace_id)
    cid = str(conversation_id or '').strip()

    if not cid:
        raise ValueError("Workspace 对话必须指定 conversation_id")

    store = find_store_for_visible_workspace(username, wid)
    workspace = store.get_workspace(wid, username)
    marker = store.get_visible_conversation_marker(wid, cid, username)
    marker_owner = str(marker.get("added_by") or "").strip()

    if marker_owner != str(username or "").strip():
        raise PermissionError("共享只读 Workspace 对话不允许继续生成或写入记忆")

    return {
        "workspace_id": wid,
        "workspace_title": str(workspace.get("title") or "Workspace").strip() or "Workspace",
        "owner_username": str(workspace.get("owner_username") or "").strip(),
        "workspace_memory": workspace.get("workspace_memory") if isinstance(workspace.get("workspace_memory"), dict) else {},
        "workspace_prompt": workspace.get("workspace_prompt") if isinstance(workspace.get("workspace_prompt"), dict) else {},
        "knowledge_documents": workspace.get("knowledge_documents") if isinstance(workspace.get("knowledge_documents"), list) else [],
        "workspace_files": workspace.get("workspace_files") if isinstance(workspace.get("workspace_files"), list) else [],
        "workspace_tasks": workspace.get("workspace_tasks") if isinstance(workspace.get("workspace_tasks"), list) else [],
        "workspace_drafts": workspace.get("workspace_drafts") if isinstance(workspace.get("workspace_drafts"), list) else [],
    }


def _merge_workspace_chat_payload(payload: Dict[str, Any], workspace_context: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(payload if isinstance(payload, dict) else {})

    if workspace_context:
        merged["workspace_context"] = {
            "workspace_id": str(workspace_context.get("workspace_id") or "").strip(),
            "workspace_title": str(workspace_context.get("workspace_title") or "").strip(),
            "owner_username": str(workspace_context.get("owner_username") or "").strip(),
            "workspace_memory": workspace_context.get("workspace_memory") if isinstance(workspace_context.get("workspace_memory"), dict) else {},
            "workspace_prompt": workspace_context.get("workspace_prompt") if isinstance(workspace_context.get("workspace_prompt"), dict) else {},
            "knowledge_documents": workspace_context.get("knowledge_documents") if isinstance(workspace_context.get("knowledge_documents"), list) else [],
            "workspace_files": workspace_context.get("workspace_files") if isinstance(workspace_context.get("workspace_files"), list) else [],
            "workspace_tasks": workspace_context.get("workspace_tasks") if isinstance(workspace_context.get("workspace_tasks"), list) else [],
            "workspace_drafts": workspace_context.get("workspace_drafts") if isinstance(workspace_context.get("workspace_drafts"), list) else [],
        }

    return merged


def _format_workspace_function_tool(model, name: str, description: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
    """把 Workspace 工具 schema 适配成当前 Provider 的 API 格式（Responses API 扁平 / Chat Completions 嵌套）。"""
    use_responses_api = (
        hasattr(model, '_provider_use_responses_api')
        and model._provider_use_responses_api(getattr(model, 'provider', ''))
    )

    if use_responses_api:
        return {
            "type": "function",
            "name": name,
            "description": description,
            "parameters": parameters,
        }

    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters,
        },
    }


def _workspace_memory_tool_definitions(model) -> List[Dict[str, Any]]:
    diff_parameters = {
        "type": "object",
        "properties": {
            "patch": {
                "type": "string",
                "description": "统一 diff patch，必须直接传入最终 patch 文本。",
            },
            "expected_sha256": {
                "type": "string",
                "description": "可选，当前 Workspace 记忆内容 SHA256；不一致时拒绝修改。",
            },
            "dry_run": {
                "type": "boolean",
                "description": "为 true 时只预览差异，不写入。",
            },
        },
        "required": ["patch"],
    }
    edit_parameters = {
        "type": "object",
        "properties": {
            "edits": {
                "type": "array",
                "description": "结构化文本 edits。action 支持 replace、insert_before、insert_after、delete。",
                "items": {
                    "type": "object",
                    "properties": {
                        "action": {"type": "string"},
                        "target": {"type": "string"},
                        "replacement": {"type": "string"},
                        "content": {"type": "string"},
                        "occurrence": {"type": "integer"},
                    },
                    "required": ["action", "target"],
                },
            },
            "expected_sha256": {
                "type": "string",
                "description": "可选，当前 Workspace 记忆内容 SHA256；不一致时拒绝修改。",
            },
            "dry_run": {
                "type": "boolean",
                "description": "为 true 时只预览差异，不写入。",
            },
        },
        "required": ["edits"],
    }
    add_parameters = {
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": "要追加到 Workspace 记忆末尾的 Markdown 片段，追加后总长度最多 5000 字符。",
            },
            "expected_sha256": {
                "type": "string",
                "description": "可选，当前 Workspace 记忆内容 SHA256；不一致时拒绝修改。",
            },
            "dry_run": {
                "type": "boolean",
                "description": "为 true 时只预览差异，不写入。",
            },
        },
        "required": ["content"],
    }

    return [
        _format_workspace_function_tool(
            model,
            "workspace_mem_edit",
            "使用结构化 edits 精确修改当前 Workspace 的自动记忆。适合修正、合并或删除已有记忆条目。",
            edit_parameters,
        ),
        _format_workspace_function_tool(
            model,
            "workspace_mem_apply_diff",
            "使用统一 diff patch 修改当前 Workspace 的自动记忆。仅在已有可靠行上下文时使用。",
            diff_parameters,
        ),
        _format_workspace_function_tool(
            model,
            "workspace_mem_add",
            "向当前 Workspace 的自动记忆末尾追加 Markdown 片段。适合记录新的稳定项目事实、约束、偏好或待办。",
            add_parameters,
        ),
    ]


def _workspace_draft_tool_definitions(model) -> List[Dict[str, Any]]:
    """Workspace 草稿工具：模型把用户后续要直接查看的关键数据沉淀为草稿条目。"""
    add_parameters = {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "草稿条目的简短标题（最多 120 字符），概括这条数据是什么，如“API 速率限制确认结果”。",
            },
            "content": {
                "type": "string",
                "description": "草稿正文（Markdown，最多 4000 字符）。只放用户之后无需翻对话就要直接查看的关键数据、结论、参数或决策，不要写过程性内容。",
            },
        },
        "required": ["title", "content"],
    }

    return [
        _format_workspace_function_tool(
            model,
            "workspace_draft_add",
            "向当前 Workspace 的草稿板追加一条草稿条目。当对话产生用户之后要直接查看的重要数据、结论、参数或决策时调用，"
            "避免用户翻找历史对话。与 workspace_mem_add 的区别：记忆存稳定项目事实供模型参考，草稿是给用户看的资料板。",
            add_parameters,
        ),
    ]


def _inject_workspace_tools(model, username: str, workspace_context: Dict[str, Any]):
    """把 Workspace 专属工具（记忆编辑 + 草稿写入）注册进本轮对话的模型。"""
    if not workspace_context:
        return

    workspace_id = str(workspace_context.get("workspace_id") or "").strip()

    if not workspace_id:
        return

    from App.Workspace import find_store_for_visible_workspace

    def _tool_result(payload: Dict[str, Any]) -> str:
        return json.dumps(payload if isinstance(payload, dict) else {}, ensure_ascii=False)

    def _workspace_store():
        return find_store_for_visible_workspace(username, workspace_id)

    def _make_apply_diff_handler():
        def _handler(args: dict) -> str:
            try:
                safe_args = args if isinstance(args, dict) else {}
                patch_text = str(safe_args.get("patch") or "").strip()

                if not patch_text:
                    return _tool_result({"success": False, "message": "patch is required"})

                if isinstance(safe_args.get("edits"), list):
                    return _tool_result({"success": False, "message": "workspace_mem_apply_diff 只接受 patch，不接受 edits"})

                payload = _workspace_store().patch_workspace_memory(
                    workspace_id,
                    username,
                    patch=safe_args.get("patch"),
                    edits=None,
                    expected_sha256=safe_args.get("expected_sha256"),
                    dry_run=_as_bool(safe_args.get("dry_run", False), False),
                )
                return _tool_result(payload)
            except Exception as error:
                return _tool_result({"success": False, "message": str(error)})

        return _handler

    def _make_edit_handler():
        def _handler(args: dict) -> str:
            try:
                safe_args = args if isinstance(args, dict) else {}
                edits = safe_args.get("edits")

                if not isinstance(edits, list) or not edits:
                    return _tool_result({"success": False, "message": "edits must be a non-empty array"})

                if str(safe_args.get("patch") or "").strip():
                    return _tool_result({"success": False, "message": "workspace_mem_edit 只接受 edits，不接受 patch"})

                payload = _workspace_store().patch_workspace_memory(
                    workspace_id,
                    username,
                    patch="",
                    edits=edits,
                    expected_sha256=safe_args.get("expected_sha256"),
                    dry_run=_as_bool(safe_args.get("dry_run", False), False),
                )
                return _tool_result(payload)
            except Exception as error:
                return _tool_result({"success": False, "message": str(error)})

        return _handler

    def _make_add_handler():
        def _handler(args: dict) -> str:
            try:
                payload = _workspace_store().add_workspace_memory(
                    workspace_id,
                    username,
                    str((args or {}).get("content") or ""),
                    expected_sha256=(args or {}).get("expected_sha256"),
                    dry_run=_as_bool((args or {}).get("dry_run", False), False),
                )
                return _tool_result(payload)
            except Exception as error:
                return _tool_result({"success": False, "message": str(error)})

        return _handler

    def _make_draft_add_handler():
        def _handler(args: dict) -> str:
            try:
                safe_args = args if isinstance(args, dict) else {}
                workspace = _workspace_store().add_workspace_draft(
                    workspace_id,
                    username,
                    {
                        "title": str(safe_args.get("title") or ""),
                        "content": str(safe_args.get("content") or ""),
                    },
                )
                drafts = workspace.get("workspace_drafts") if isinstance(workspace, dict) else []
                added = drafts[-1] if isinstance(drafts, list) and drafts else {}

                return _tool_result({
                    "success": True,
                    "draft_id": str(added.get("draft_id") or ""),
                    "title": str(added.get("title") or ""),
                    "chars": len(str(added.get("content") or "")),
                    "total": len(drafts) if isinstance(drafts, list) else 0,
                })
            except Exception as error:
                return _tool_result({"success": False, "message": str(error)})

        return _handler

    for tool in _workspace_memory_tool_definitions(model) + _workspace_draft_tool_definitions(model):
        model.register_external_function_tool(tool)

    model.tool_executor.handlers["workspace_mem_apply_diff"] = _make_apply_diff_handler()
    model.tool_executor.handlers["workspace_mem_edit"] = _make_edit_handler()
    model.tool_executor.handlers["workspace_mem_add"] = _make_add_handler()
    model.tool_executor.handlers["workspace_draft_add"] = _make_draft_add_handler()


@app.route('/api/chat/stream', methods=['POST'])
@require_login
def chat_stream():
    """流式聊天接口"""
    latency_started_at = time.perf_counter()
    latency_last_at = latency_started_at
    latency_marks = []
    latency_context = {}

    def _chat_latency_mark(name: str, **detail):
        nonlocal latency_last_at

        now = time.perf_counter()
        latency_marks.append({
            "name": str(name or "").strip() or "mark",
            "total_ms": round((now - latency_started_at) * 1000.0, 1),
            "delta_ms": round((now - latency_last_at) * 1000.0, 1),
            "detail": detail,
        })
        latency_last_at = now

    def _chat_latency_flush(reason: str, force: bool = False, threshold_ms: float = 700.0):
        total_ms = (time.perf_counter() - latency_started_at) * 1000.0

        if (not force) and total_ms < float(threshold_ms or 0):
            return

        try:
            print(
                "[CHAT_STREAM_LATENCY] "
                + json.dumps({
                    "reason": str(reason or ""),
                    "total_ms": round(total_ms, 1),
                    "username": str(latency_context.get("username", "") or ""),
                    "conversation_id": str(latency_context.get("conversation_id", "") or ""),
                    "model_name": str(latency_context.get("model_name", "") or ""),
                    "marks": latency_marks,
                }, ensure_ascii=False, default=str)
            )
        except Exception:
            pass

    def _agent_info_latency_summary(agent_info: dict) -> Dict[str, Any]:
        if not isinstance(agent_info, dict):
            return {
                "agent_source": "none",
                "agent_tool_count": 0,
                "agent_schema_bytes": 0,
            }

        tools = agent_info.get("tools")
        tool_count = len(tools) if isinstance(tools, list) else 0
        schema_bytes = 0

        if isinstance(tools, list):
            try:
                schema_bytes = len(json.dumps(tools, ensure_ascii=False, default=str).encode("utf-8"))
            except Exception:
                schema_bytes = 0

        return {
            "agent_source": str(agent_info.get("source") or "unknown"),
            "agent_tool_count": tool_count,
            "agent_schema_bytes": schema_bytes,
        }

    data = request.get_json(silent=True) or {}
    sys_config = get_config_all()
    log_status = str(sys_config.get('log_status', 'silent')).lower()
    log_all_chunks = (log_status == 'all')
    log_tool_chunks = log_status in {'all', 'debug', 'verbose'}
    message = data.get('message')
    conversation_id = data.get('conversation_id')
    model_name = data.get('model_name')
    enable_thinking = data.get('enable_thinking', False)
    thinking_level = data.get('thinking_level', data.get('think', None))
    try:
        raw_enable_thinking = data.get('enable_thinking', None)
        normalized_enable_thinking = _as_bool(raw_enable_thinking, False)
        print(
            f"[CHAT_THINK_IN] raw={raw_enable_thinking!r} "
            f"normalized={normalized_enable_thinking} model={data.get('model_name', '')}"
        )
        enable_thinking = normalized_enable_thinking
    except Exception:
        pass
    enable_web_search = data.get('enable_web_search', True)
    enable_tools = data.get('enable_tools', True)
    raw_tool_mode = data.get('tool_mode')
    raw_skill_mode = data.get('skill_mode')
    raw_skill_modes = data.get('skill_modes')
    raw_active_tool_skills = data.get('active_tool_skills')
    allow_history_images = _as_bool(data.get('allow_history_images', True), True)
    include_context = _as_bool(data.get('include_context', True), True)
    force_context_compression = _as_bool(data.get('force_context_compression', False), False)
    debug_mode = _as_bool(data.get('debug_mode', False), False)
    show_token_usage = data.get('show_token_usage', False)
    raw_file_ids = data.get('file_ids', [])
    file_ids = raw_file_ids if isinstance(raw_file_ids, list) else []
    raw_sandbox_paths = data.get('sandbox_paths', [])
    sandbox_paths = raw_sandbox_paths if isinstance(raw_sandbox_paths, list) else []
    raw_user_attachments = data.get('user_attachments', [])
    user_attachments = raw_user_attachments if isinstance(raw_user_attachments, list) else []

    # Sanitize client-provided sandbox path hints / attachment summaries.
    sanitized_sandbox_paths = []
    seen_sandbox_paths = set()
    for p in sandbox_paths:
        s = str(p or '').strip().replace('\\', '/')
        if not s or s in seen_sandbox_paths:
            continue
        seen_sandbox_paths.add(s)
        sanitized_sandbox_paths.append(s)
        if len(sanitized_sandbox_paths) >= 64:
            break

    sanitized_user_attachments = []
    for item in user_attachments:
        if not isinstance(item, dict):
            continue
        sanitized_user_attachments.append(item)
        if len(sanitized_user_attachments) >= 64:
            break

    enable_tools = bool(enable_tools)
    if raw_tool_mode is None:
        tool_mode = 'auto_off' if enable_tools else 'off'
    else:
        tool_mode = str(raw_tool_mode or '').strip().lower()
        if tool_mode == 'auto':
            tool_mode = 'auto_off'
        elif tool_mode in {'auto-off', 'autooff'}:
            tool_mode = 'auto_off'
        elif tool_mode in {'auto-select', 'autoselect'}:
            tool_mode = 'auto_off'
        if tool_mode == 'auto_select':
            tool_mode = 'auto_off'
        if tool_mode not in {'off', 'auto_off', 'force'}:
            tool_mode = 'auto_off' if enable_tools else 'off'
    if tool_mode == 'off':
        enable_tools = False
    else:
        enable_tools = True
    
    # 重新生成标志
    is_regenerate = data.get('is_regenerate', False)
    raw_regenerate_index = data.get('regenerate_index')
    regenerate_index = None
    if raw_regenerate_index is not None:
        try:
            regenerate_index = int(raw_regenerate_index)
        except Exception:
            regenerate_index = None
    
    # 空文本允许携带附件发送(单图/单文件轮次):user_attachments/sandbox_paths 任一非空即放行
    if not message and not is_regenerate and len(file_ids) == 0 and len(sanitized_user_attachments) == 0 and len(sanitized_sandbox_paths) == 0 and not data.get('puzzle_submission'):
        return jsonify({'success': False, 'message': '消息不能为空'}), 400
    
    username = session['username']
    local_agent_cookie_token = request.cookies.get("nexoracode_agent", "").strip()
    latency_context.update({
        "username": username,
        "conversation_id": str(conversation_id or ""),
        "model_name": str(model_name or ""),
    })
    _chat_latency_mark(
        "request_parsed",
        enable_tools=bool(enable_tools),
        tool_mode=str(tool_mode or ""),
        has_agent_cookie=bool(local_agent_cookie_token),
        file_count=len(file_ids),
        attachment_count=len(sanitized_user_attachments),
    )

    conversation_id_from_request = bool(str(conversation_id or '').strip())
    # Stream workers run outside Flask request context, so request-scoped flags
    # must be captured before the worker starts.
    workspace_chat_requested = bool(_get_workspace_request_value(data, 'workspace_id', 'workspace', 'workspaces'))

    try:
        workspace_chat_context = _resolve_workspace_chat_context(username, data, conversation_id)
    except Exception as workspace_error:
        return _workspace_chat_error_response(workspace_error)

    if workspace_chat_context:
        _chat_latency_mark(
            "workspace_context_resolved",
            workspace_id=str(workspace_chat_context.get("workspace_id") or ""),
            workspace_memory_chars=len(str((workspace_chat_context.get("workspace_memory") or {}).get("content") or "")),
            workspace_prompt_chars=len(str((workspace_chat_context.get("workspace_prompt") or {}).get("content") or "")),
            workspace_knowledge_count=len(workspace_chat_context.get("knowledge_documents") or []),
        )

    skip_user_message = bool(data.get('skip_user_message', False))
    user_message_persisted = False

    if is_regenerate:
        if not str(conversation_id or '').strip():
            return jsonify({
                'success': False,
                'message': '重答必须指定 conversation_id'
            }), 400
        if regenerate_index is None:
            return jsonify({
                'success': False,
                'message': '重答必须指定 regenerate_index'
            }), 400

        manager = ConversationService(username)
        ok, validate_message, target_meta = manager.validate_regenerate_target(
            conversation_id,
            regenerate_index
        )
        if not ok:
            print(
                "[REGENERATE_VALIDATE] failed "
                f"conversation_id={conversation_id} index={regenerate_index} "
                f"reason={validate_message} meta={target_meta}"
            )
            return jsonify({
                'success': False,
                'message': validate_message,
                'server_message_count': int(target_meta.get('message_count', 0) or 0),
                'target_role': str(target_meta.get('target_role', '') or ''),
                'source_role': str(target_meta.get('source_role', '') or '')
            }), 409

        if not str(message or '').strip():
            message = str(target_meta.get('user_content') or '')

        print(
            "[REGENERATE_VALIDATE] ok "
            f"conversation_id={conversation_id} assistant_index={regenerate_index} "
            f"user_index={target_meta.get('user_index')} "
            f"model={model_name or target_meta.get('assistant_model_name', '')}"
        )

    _chat_latency_mark(
        "server_user_persist_deferred",
        deferred_to_stream_worker=bool(not is_regenerate and not skip_user_message),
        conversation_id=str(conversation_id or ""),
    )

    skill_mode = 'force'
    skill_runtime: Dict[str, Any] = {}
    active_tool_skills = []
    longdoc_skills = []
    try:
        skill_runtime = _build_user_skill_runtime(username)
        active_tool_skills = skill_runtime.get('active_skills', [])
    except Exception:
        skill_mode = 'force'
        active_tool_skills = []
    longdoc_skills = load_longdoc_skill_catalog(SKILLS_DIR)
    if isinstance(raw_active_tool_skills, list):
        active_tool_skills = raw_active_tool_skills
        if raw_skill_mode is not None:
            skill_mode = _normalize_skill_mode(raw_skill_mode)
    elif isinstance(raw_skill_modes, dict):
        # Optional request-level override by per-skill mode map.
        runtime_skills = skill_runtime.get('skills', []) if isinstance(skill_runtime, dict) else []
        next_active: List[Dict[str, Any]] = []
        for row in (runtime_skills or []):
            if not isinstance(row, dict):
                continue
            sid = str(row.get('id') or '').strip()
            if not sid:
                continue
            override_mode = raw_skill_modes.get(sid, row.get('mode', 'off'))
            mode = _normalize_skill_mode(override_mode)
            if mode == 'off':
                continue
            merged = dict(row)
            merged['mode'] = mode
            next_active.append(merged)
        active_tool_skills = next_active
        skill_mode = 'force'
    elif raw_skill_mode is not None:
        # 旧版前端会固定发送 skill_mode=off；已有 per-skill 配置时不能让它压掉用户启用的 Skill。
        legacy_skill_mode = _normalize_skill_mode(raw_skill_mode)

        if legacy_skill_mode != 'off' or not active_tool_skills:
            skill_mode = legacy_skill_mode

    if str(data.get('conversation_mode') or '').strip() == 'learning':
        try:
            learning_runtime_payload = build_learning_context_payload(username, data.get('conversation_mode_payload'))
            runtime_skills = learning_runtime_payload.get('active_tool_skills', [])
            if isinstance(runtime_skills, list) and runtime_skills:
                if isinstance(active_tool_skills, list):
                    active_tool_skills = list(runtime_skills) + active_tool_skills
                else:
                    active_tool_skills = list(runtime_skills)
        except Exception as learning_skill_error:
            print(f"[LEARNING_RUNTIME] failed to build active_tool_skills: {learning_skill_error}")

    _chat_latency_mark(
        "skill_runtime",
        skill_mode=str(skill_mode or ""),
        active_skill_count=len(active_tool_skills) if isinstance(active_tool_skills, list) else 0,
        longdoc_skill_count=len(longdoc_skills) if isinstance(longdoc_skills, list) else 0,
    )
    
    # --- 模型权限校验 ---
    requested_model_name = str(model_name or '').strip()
    try:
        blacklist_path = './data/model_permissions.json'
        blacklist = []
        if os.path.exists(blacklist_path):
            with open(blacklist_path, 'r', encoding='utf-8') as f:
                perm_config = json.load(f)
                user_blacklists = perm_config.get('user_blacklists', {})
                blacklist = user_blacklists.get(username, perm_config.get('default_blacklist', []))
        
        all_models_cfg = sys_config.get('models', {}) if isinstance(sys_config.get('models', {}), dict) else {}
        all_models = list(all_models_cfg.keys())
        default_sys_model = sys_config.get('default_model')

        if requested_model_name:
            requested_entry = all_models_cfg.get(requested_model_name, {})
            if _is_model_disabled_entry(requested_entry) and _is_quota_disabled_status((requested_entry if isinstance(requested_entry, dict) else {}).get('status')):
                requested_provider = str((requested_entry if isinstance(requested_entry, dict) else {}).get('provider') or '').strip()
                _recover_model_from_quota_disable(requested_model_name, provider_name=requested_provider)
                sys_config = get_config_all()
                all_models_cfg = sys_config.get('models', {}) if isinstance(sys_config.get('models', {}), dict) else {}
            if requested_model_name not in all_models_cfg:
                return jsonify({'success': False, 'message': f'模型不存在：{requested_model_name}'}), 400
            if requested_model_name in blacklist:
                return jsonify({'success': False, 'message': f'当前账号无权使用模型：{requested_model_name}'}), 403
            if _is_model_disabled_entry(all_models_cfg.get(requested_model_name, {})):
                return jsonify({'success': False, 'message': f'模型已停用：{requested_model_name}', 'model': requested_model_name}), 403
            model_name = requested_model_name
        
        # 如果 model_name 为空（用户没选），则自动分配第一个可用模型（不屏蔽停用态，后续门禁统一报错）。
        if not model_name:
            if default_sys_model and default_sys_model not in blacklist and default_sys_model in all_models:
                model_name = default_sys_model
            else:
                available_models = [m for m in all_models if m not in blacklist]
                if not available_models:
                    return jsonify({'success': False, 'message': '当前账号无可用模型，请联系管理员'}), 403
                model_name = available_models[0]
                
    except Exception as e:
        print(f"Permission check error: {e}")
    # ------------------

    model_info_entry = {}
    if isinstance(sys_config.get('models', {}), dict):
        model_info_entry = sys_config.get('models', {}).get(model_name, {})
    if _is_model_disabled_entry(model_info_entry) and _is_quota_disabled_status((model_info_entry if isinstance(model_info_entry, dict) else {}).get('status')):
        provider_name_for_recover = str((model_info_entry if isinstance(model_info_entry, dict) else {}).get('provider') or '').strip()
        _recover_model_from_quota_disable(model_name, provider_name=provider_name_for_recover)
        sys_config = get_config_all()
        model_info_entry = sys_config.get('models', {}).get(model_name, {}) if isinstance(sys_config.get('models', {}), dict) else {}
    if _is_model_disabled_entry(model_info_entry):
        return jsonify({'success': False, 'message': f'模型已停用：{model_name}', 'model': model_name}), 403

    provider_name = str((model_info_entry if isinstance(model_info_entry, dict) else {}).get('provider') or '').strip()
    quota_gate = get_generation_quota_gate(provider_name=provider_name, model_name=model_name)
    if quota_gate.get('should_disable_model'):
        _disable_model_by_quota(model_name, provider_name=provider_name, reason='quota_exhausted')
    if quota_gate.get('should_block'):
        blocked_message = _build_quota_block_message(quota_gate, model_name)
        quota_status = quota_gate.get('quota', {}) if isinstance(quota_gate.get('quota'), dict) else {}
        persisted_conversation_id = str(conversation_id or '').strip()
        try:
            manager = ConversationService(username)
            if persisted_conversation_id:
                existing = manager.get_conversation(persisted_conversation_id)
                if not isinstance(existing, dict):
                    persisted_conversation_id = manager.create_conversation(
                        conversation_id=persisted_conversation_id,
                        title=(str(message or '').strip()[:48] or '新对话')
                    )
            else:
                persisted_conversation_id = manager.create_conversation(
                    title=(str(message or '').strip()[:48] or '新对话')
                )

            blocked_user_text = str(message or '').strip()
            if persisted_conversation_id and blocked_user_text and not is_regenerate and not skip_user_message:
                manager.add_message(
                    persisted_conversation_id,
                    'user',
                    blocked_user_text,
                    metadata={
                        'source': 'quota_precheck',
                        'blocked': True,
                        'error_code': 'quota_exhausted',
                        'model_name': str(model_name or '').strip(),
                        'provider': provider_name,
                    }
                )

        except Exception as persist_error:
            try:
                print(f"[QUOTA_PERSIST] failed to persist blocked turn: {persist_error}")
            except Exception:
                pass
        return _build_over_budget_unavailable_response({
            'message': blocked_message,
            'model': model_name,
            'provider': provider_name,
            'conversation_id': persisted_conversation_id or str(conversation_id or '').strip(),
            'quota': quota_status,
        })

    latency_context.update({
        "conversation_id": str(conversation_id or ""),
        "model_name": str(model_name or ""),
    })
    _chat_latency_mark(
        "model_permission_quota",
        provider_name=provider_name,
        model_name=str(model_name or ""),
    )

    def _resolve_local_agent_info_for_chat():
        """解析当前用户的 NexoraCode 本地工具，只使用 WSS 在线工具表。"""
        from App.Agent import is_agent_online, get_agent_tools

        if is_agent_online(username):
            online_tools = get_agent_tools(username)

            if online_tools:
                return {"username": username, "tools": online_tools, "source": "wss"}

        return None

    _agent_info = _resolve_local_agent_info_for_chat()
    _chat_latency_mark("agent_info_prefetch", **_agent_info_latency_summary(_agent_info))

    if (not is_regenerate) and conversation_id:
        try:
            manager = ConversationService(username)
            convo = manager.get_conversation(conversation_id)
            if isinstance(convo, dict):
                stored_mode = str(convo.get('conversation_mode') or '').strip().lower()
                if stored_mode == 'learning' and not str(data.get('conversation_mode') or '').strip():
                    data['conversation_mode'] = 'learning'
                    if not isinstance(data.get('conversation_mode_payload'), dict):
                        data['conversation_mode_payload'] = {"learning": True}
                elif stored_mode == 'longterm' and not str(data.get('conversation_mode') or '').strip():
                    data['conversation_mode'] = 'longterm'
                    if not isinstance(data.get('conversation_mode_payload'), dict):
                        data['conversation_mode_payload'] = {}
        except Exception:
            pass

    def _resolve_stream_assistant_index() -> Optional[int]:
        """计算本次流式回复对应的 assistant 消息索引，供重连恢复精确绑定 DOM。"""
        if is_regenerate and regenerate_index is not None:
            return int(regenerate_index)

        target_conversation_id = str(conversation_id or '').strip()
        message_count = 0

        if target_conversation_id:
            manager = ConversationService(username)
            conversation = manager.get_conversation(target_conversation_id)
            messages = conversation.get('messages', []) if isinstance(conversation, dict) else []

            if not isinstance(messages, list):
                raise ValueError(f"对话消息格式无效: {target_conversation_id}")

            message_count = len(messages)

        if skip_user_message:
            return message_count

        return message_count + 1

    try:
        stream_assistant_index = _resolve_stream_assistant_index()
    except Exception as stream_index_error:
        stream_assistant_index = None
        print(
            "[STREAM_INDEX] failed to resolve assistant index "
            f"conversation_id={conversation_id} "
            f"is_regenerate={is_regenerate} "
            f"skip_user_message={skip_user_message} "
            f"error={stream_index_error}"
        )

    def _build_puzzle_submission_injection(puzzle_state, client_steps=None):
        """从服务端存储的 puzzle_state 构建注入文本，不信任客户端数据。"""
        submission = puzzle_state.get('submission') if isinstance(puzzle_state, dict) else None
        if not isinstance(submission, dict):
            return None
        ordered = submission.get('ordered_steps')
        if not isinstance(ordered, list):
            ordered = []
        ordered = [str(s or '').strip() for s in ordered if str(s or '').strip()]
        graph = submission.get('graph') if isinstance(submission.get('graph'), dict) else {}
        lines = ['[Puzzle Submission]']
        if ordered:
            lines.append(f"MainSteps: {' -> '.join(ordered)}")
        node_count = int(graph.get('node_count') or 0)
        edge_count = int(graph.get('edge_count') or 0)
        branch_count = int(graph.get('branch_count') or 0)
        has_cycle = bool(graph.get('has_cycle'))
        component_count = int(graph.get('component_count') or 0)
        lines.append(f"Graph: n={node_count}, e={edge_count}, b={branch_count}, cyc={'1' if has_cycle else '0'}, c={component_count}")
        connections = graph.get('connections')
        if isinstance(connections, list) and connections:
            edge_lines = []
            for conn in connections[:40]:
                if not isinstance(conn, dict):
                    continue
                from_text = str(conn.get('from_text') or '').strip()
                to_text = str(conn.get('to_text') or '').strip()
                if from_text and to_text:
                    edge_lines.append(f"{from_text} -> {to_text}")
            if edge_lines:
                lines.append(f"Edges: {' | '.join(edge_lines)}")
        lines.append('')
        lines.append('以上是用户提交的拼图结果，请评价其正确性并给出反馈，不要再次输出拼图工具。')
        return '\n'.join(lines)

    def _stream_worker(push_chunk, set_conversation_id, set_stage, is_cancel_requested):
        try:
            set_stage("normalizing_request")
            request_meta = normalize_longterm_request(
                message=message,
                conversation_mode=data.get('conversation_mode'),
                conversation_mode_payload=data.get('conversation_mode_payload')
            )
            raw_conversation_mode = str(request_meta.get('conversation_mode') or '').strip()
            effective_message = str(request_meta.get('message') or '')
            raw_conversation_mode_payload = request_meta.get('conversation_mode_payload')
            if not isinstance(raw_conversation_mode_payload, dict):
                raw_conversation_mode_payload = {}
            if workspace_chat_context:
                raw_conversation_mode_payload = _merge_workspace_chat_payload(
                    raw_conversation_mode_payload,
                    workspace_chat_context
                )
            if debug_mode:
                workspace_context_debug = {
                    "requested": workspace_chat_requested,
                    "resolved": bool(workspace_chat_context),
                    "workspace_id": str(workspace_chat_context.get("workspace_id") or "") if workspace_chat_context else "",
                    "workspace_title": str(workspace_chat_context.get("workspace_title") or "") if workspace_chat_context else "",
                    "knowledge_count": len(workspace_chat_context.get("knowledge_documents") or []) if workspace_chat_context else 0,
                    "file_count": len(workspace_chat_context.get("workspace_files") or []) if workspace_chat_context else 0,
                    "task_count": len(workspace_chat_context.get("workspace_tasks") or []) if workspace_chat_context else 0,
                    "memory_chars": len(str((workspace_chat_context.get("workspace_memory") or {}).get("content") or "")) if workspace_chat_context else 0,
                    "prompt_chars": len(str((workspace_chat_context.get("workspace_prompt") or {}).get("content") or "")) if workspace_chat_context else 0,
                }
                push_chunk({
                    "type": "debug_trace",
                    "direction": "server->model",
                    "stage": "workspace_context",
                    "title": "Workspace Context",
                    "payload": workspace_context_debug,
                })
            worker_active_tool_skills = list(active_tool_skills) if isinstance(active_tool_skills, list) else []
            worker_longdoc_skills = list(longdoc_skills) if isinstance(longdoc_skills, list) else []
            _chat_latency_mark(
                "worker_request_normalized",
                conversation_mode=raw_conversation_mode,
                message_chars=len(effective_message),
            )
            set_stage("request_normalized", f"mode={raw_conversation_mode or 'chat'} chars={len(effective_message)}")

            learning_course_id = ''
            learning_course_title = ''

            if raw_conversation_mode == 'learning':
                set_stage("building_learning_context")
                try:
                    learning_runtime_payload = build_learning_context_payload(username, raw_conversation_mode_payload)
                    merged_payload = dict(raw_conversation_mode_payload)
                    for key, value in learning_runtime_payload.items():
                        if key == 'context_blocks':
                            existing_blocks = merged_payload.get('context_blocks', [])
                            if not isinstance(existing_blocks, list):
                                existing_blocks = []
                            merged_payload['context_blocks'] = list(value or []) + existing_blocks
                        elif key == 'active_tool_skills':
                            existing_skills = merged_payload.get('active_tool_skills', [])
                            if not isinstance(existing_skills, list):
                                existing_skills = []
                            merged_payload['active_tool_skills'] = list(value or []) + existing_skills
                        elif key == 'meta':
                            current_meta = merged_payload.get('meta', {})
                            if not isinstance(current_meta, dict):
                                current_meta = {}
                            next_meta = dict(value or {})
                            next_meta.update(current_meta)
                            merged_payload['meta'] = next_meta
                        elif key == 'system_prompt':
                            if not str(merged_payload.get('system_prompt') or '').strip():
                                merged_payload['system_prompt'] = value
                        else:
                            merged_payload[key] = value
                    lecture_id = str(merged_payload.get('lecture_id') or '').strip()
                    lecture_title = str(merged_payload.get('lecture_title') or '').strip()
                    if not lecture_id:
                        lecture_id = str(((merged_payload.get('meta') or {}) if isinstance(merged_payload.get('meta'), dict) else {}).get('lecture_id') or '').strip()
                    if not lecture_title:
                        lecture_title = str(((merged_payload.get('meta') or {}) if isinstance(merged_payload.get('meta'), dict) else {}).get('lecture_title') or '').strip()
                    if lecture_id:
                        learning_course_id = lecture_id
                        learning_course_title = lecture_title
                        memory_blocks = build_learning_memory_blocks(username, lecture_id)
                        if memory_blocks:
                            existing_blocks = merged_payload.get('context_blocks', [])
                            if not isinstance(existing_blocks, list):
                                existing_blocks = []
                            merged_payload['context_blocks'] = list(memory_blocks) + existing_blocks
                        current_meta = merged_payload.get('meta', {})
                        if not isinstance(current_meta, dict):
                            current_meta = {}
                        current_meta['lecture_id'] = lecture_id
                        if lecture_title:
                            current_meta['lecture_title'] = lecture_title
                        merged_payload['meta'] = current_meta
                    raw_conversation_mode_payload = merged_payload
                    merged_active_skills = raw_conversation_mode_payload.get('active_tool_skills', [])
                    if isinstance(merged_active_skills, list):
                        worker_active_tool_skills = list(merged_active_skills)
                    # 拼图提交注入（服务端构建，不信任客户端文本）
                    puzzle_submission = data.get('puzzle_submission')
                    if isinstance(puzzle_submission, dict):
                        puzzle_id = str(puzzle_submission.get('puzzle_id') or '').strip()
                        if puzzle_id:
                            try:
                                _mgr = ConversationService(username)
                                _conv = _mgr.get_conversation(conversation_id) if conversation_id else None
                                _puzzle_states = _conv.get('puzzle_states') if isinstance(_conv, dict) else {}
                                _puzzle_state = (_puzzle_states or {}).get(puzzle_id)
                                if _puzzle_state and _puzzle_state.get('locked'):
                                    injection = _build_puzzle_submission_injection(_puzzle_state)
                                    if injection:
                                        existing_blocks = raw_conversation_mode_payload.get('context_blocks', [])
                                        if not isinstance(existing_blocks, list):
                                            existing_blocks = []
                                        existing_blocks.append({
                                            'type': 'puzzle_submission',
                                            'title': '拼图提交结果',
                                            'content': injection,
                                        })
                                        raw_conversation_mode_payload['context_blocks'] = existing_blocks
                            except Exception as puzzle_inject_err:
                                print(f"[PUZZLE_INJECT] failed: {puzzle_inject_err}")
                except Exception as learning_runtime_error:
                        print(f"[LEARNING_RUNTIME] failed to merge payload: {learning_runtime_error}")
            _chat_latency_mark(
                "worker_learning_runtime",
                conversation_mode=raw_conversation_mode,
                context_block_count=len(raw_conversation_mode_payload.get('context_blocks', [])) if isinstance(raw_conversation_mode_payload, dict) and isinstance(raw_conversation_mode_payload.get('context_blocks', []), list) else 0,
            )
            set_stage("learning_context_ready", f"mode={raw_conversation_mode or 'chat'}")

            effective_enable_tools = bool(enable_tools)
            effective_tool_mode = tool_mode
            if raw_conversation_mode == 'longterm':
                effective_enable_tools = True
                effective_tool_mode = 'force'
            elif raw_conversation_mode == 'learning':
                effective_enable_tools = True
                effective_tool_mode = 'force'
            requested_cid = str(conversation_id or "").strip()
            will_auto_create = not bool(requested_cid)
            model = Model(
                username,
                model_name=model_name,
                conversation_id=conversation_id,
                auto_create=will_auto_create
            )
            # 服务端常驻：记录会话归属，避免“盗梦空间”式侧边栏错位只能靠浏览器控制台
            try:
                log_event(
                    "chat_conversation_resolve",
                    "conversation resolved",
                    payload={
                        "username": str(username or ""),
                        "requested_conversation_id": requested_cid,
                        "resolved_conversation_id": str(model.conversation_id or ""),
                        "auto_created": bool(will_auto_create),
                        "conversation_id_from_request": bool(conversation_id_from_request),
                        "model_name": str(model_name or ""),
                        "raw_conversation_mode": str(raw_conversation_mode or ""),
                    },
                    source="chat",
                )
            except Exception:
                pass

            if raw_conversation_mode == 'learning' and learning_course_id and model.conversation_id:
                ConversationService(username).update_conversation_fields(
                    model.conversation_id,
                    {
                        'metadata': {
                            'learning': True,
                            'lecture_id': learning_course_id,
                            **({'lecture_title': learning_course_title} if learning_course_title else {}),
                        }
                    },
                )

            stream_log_model_name = model_name or getattr(model, "model_name", "")

            def _push_model_stream_chunk(raw_chunk, source="yield"):
                payload = raw_chunk if isinstance(raw_chunk, dict) else {'type': 'content', 'content': str(raw_chunk)}

                if log_all_chunks or (log_tool_chunks and _is_tool_stream_chunk(payload)):
                    _log_stream_chunk(
                        payload,
                        model_name=stream_log_model_name,
                        source=source
                    )

                push_chunk(payload)

            _chat_latency_mark(
                "model_created",
                conversation_id=str(model.conversation_id or ""),
                effective_enable_tools=bool(effective_enable_tools),
                effective_tool_mode=str(effective_tool_mode or ""),
            )
            set_stage("model_created", f"conversation_id={str(model.conversation_id or '')} tools={bool(effective_enable_tools)}")

            current_agent_info = _resolve_local_agent_info_for_chat()
            set_stage("resolving_agent_tools")
            _chat_latency_mark("agent_info_worker_resolve", **_agent_info_latency_summary(current_agent_info))

            if current_agent_info:
                _inject_local_agent_tools(model, current_agent_info, cancel_checker=is_cancel_requested)
                _chat_latency_mark("agent_tools_injected", **_agent_info_latency_summary(current_agent_info))
            else:
                _chat_latency_mark("agent_tools_injected", agent_source="none", agent_tool_count=0, agent_schema_bytes=0)

            project_context_injected = False

            try:
                project_context_injected = _inject_nexoracode_project_context(
                    model,
                    username,
                    str(model.conversation_id or conversation_id or ''),
                    cancel_checker=is_cancel_requested,
                )
                _chat_latency_mark(
                    "nexoracode_project_context",
                    injected=bool(project_context_injected),
                )
            except StreamCancelled:
                raise
            except Exception as project_context_error:
                print(f"[NexoraCode ProjectContext] inject error={project_context_error}")

            if workspace_chat_context:
                _inject_workspace_tools(model, username, workspace_chat_context)
                _chat_latency_mark(
                    "workspace_tools_injected",
                    workspace_id=str(workspace_chat_context.get("workspace_id") or ""),
                    tool_count=4,
                )

            model._stream_cancel_checker = is_cancel_requested
            model._stream_direct_push_chunk = lambda chunk: _push_model_stream_chunk(chunk, source="direct")

            try:
                local_tool_names = []

                if current_agent_info and isinstance(current_agent_info.get("tools"), list):

                    for tool_def in current_agent_info.get("tools", []):

                        if not isinstance(tool_def, dict):
                            continue

                        func = tool_def.get("function") if isinstance(tool_def.get("function"), dict) else {}
                        tool_name = str(func.get("name") or tool_def.get("name") or "").strip()

                        if tool_name:
                            local_tool_names.append(tool_name)

                print(
                    f"[NexoraCode ChatInject] username={username} "
                    f"source={str((current_agent_info or {}).get('source') or 'none')} "
                    f"tool_count={len(local_tool_names)} tools={local_tool_names}"
                )
            except Exception as local_agent_log_error:
                print(f"[NexoraCode ChatInject] log error={local_agent_log_error}")

            prepared_file_ids = _prepare_chat_file_ids(
                username=username,
                conversation_id=model.conversation_id,
                file_ids=file_ids
            )
            set_stage("files_ready", f"file_count={len(prepared_file_ids) if isinstance(prepared_file_ids, list) else 0}")
            _chat_latency_mark(
                "prepared_file_ids",
                prepared_file_count=len(prepared_file_ids) if isinstance(prepared_file_ids, list) else 0,
            )

            if model.conversation_id:
                set_conversation_id(model.conversation_id)
                latency_context["conversation_id"] = str(model.conversation_id or "")

            if not conversation_id_from_request:
                push_chunk({'type': 'conversation_id', 'conversation_id': model.conversation_id})

            _chat_latency_mark("before_model_send_message")
            set_stage("waiting_model_stream", f"model={model_name or model.model_name or ''}")
            first_model_chunk_seen = False
            memory_analysis_done_seen = False
            memory_analysis_error_seen = False

            for chunk in model.sendMessage(
                effective_message,
                stream=True,
                enable_thinking=enable_thinking,
                thinking_level=thinking_level,
                enable_web_search=enable_web_search,
                enable_tools=effective_enable_tools,
                tool_mode=effective_tool_mode,
                debug_mode=debug_mode,
                allow_history_images=allow_history_images,
                include_context=include_context,
                force_context_compression=force_context_compression,
                show_token_usage=show_token_usage,
                file_ids=prepared_file_ids,
                sandbox_paths=sanitized_sandbox_paths,
                user_attachments=sanitized_user_attachments,
                is_regenerate=is_regenerate,
                regenerate_index=regenerate_index,
                skill_mode=skill_mode,
                active_tool_skills=worker_active_tool_skills,
                longdoc_skills=worker_longdoc_skills,
                conversation_mode=raw_conversation_mode,
                conversation_mode_payload=raw_conversation_mode_payload,
                skip_user_message=bool(skip_user_message or user_message_persisted)
            ):
                if is_cancel_requested():
                    set_stage("worker_cancelled", "user_abort")
                    raise StreamCancelled("user_abort")

                if not first_model_chunk_seen:
                    first_model_chunk_seen = True
                    set_stage("model_streaming", f"first_chunk={str((chunk or {}).get('type') if isinstance(chunk, dict) else type(chunk).__name__)}")
                    _chat_latency_mark(
                        "model_first_chunk",
                        chunk_type=str((chunk or {}).get('type') if isinstance(chunk, dict) else type(chunk).__name__),
                    )
                    _chat_latency_flush("model_first_chunk")

                if isinstance(chunk, dict):
                    chunk_type = str(chunk.get("type") or "").strip()

                    if chunk_type == "done":
                        memory_analysis_done_seen = True

                    elif chunk_type == "error":
                        memory_analysis_error_seen = True

                _push_model_stream_chunk(chunk, source="yield")
            set_stage("model_stream_exhausted")

            project_bound_for_memory = False

            try:
                project_bound_for_memory = bool(
                    _read_conversation_nexoracode_project(
                        username,
                        str(model.conversation_id or conversation_id or "").strip()
                    )
                )
            except Exception as project_memory_check_error:
                print(
                    "[MEMORY_ANALYSIS] project binding check failed "
                    f"conversation_id={model.conversation_id} error={project_memory_check_error}"
                )

            memory_analysis_eligible = bool(
                memory_analysis_done_seen
                and not memory_analysis_error_seen
                and not is_regenerate
                and not is_cancel_requested()
                and str(raw_conversation_mode or "chat").strip().lower() == "chat"
                and not workspace_chat_context
                and not project_bound_for_memory
                and stream_assistant_index is not None
                and str(model.conversation_id or "").strip()
            )

            # 服务端常驻诊断：无论是否入队都落盘，便于偶发排查（不依赖浏览器控制台）
            try:
                log_event(
                    "memory_eligibility",
                    "memory eligibility check",
                    payload={
                        "username": str(username or ""),
                        "conversation_id": str(model.conversation_id or conversation_id or ""),
                        "conversation_id_from_request": bool(conversation_id_from_request),
                        "stream_assistant_index": stream_assistant_index,
                        "done_seen": bool(memory_analysis_done_seen),
                        "error_seen": bool(memory_analysis_error_seen),
                        "is_regenerate": bool(is_regenerate),
                        "is_cancel_requested": bool(is_cancel_requested()),
                        "raw_conversation_mode": str(raw_conversation_mode or ""),
                        "workspace_bound": bool(workspace_chat_context),
                        "project_bound": bool(project_bound_for_memory),
                        "eligible": bool(memory_analysis_eligible),
                        "model_name": str(model.model_name or model_name or ""),
                    },
                    source="memory",
                )
            except Exception:
                pass

            if memory_analysis_eligible:
                try:
                    memory_enqueue_result = get_memory_analysis_queue().enqueue(
                        username=username,
                        conversation_id=str(model.conversation_id or "").strip(),
                        assistant_index=int(stream_assistant_index),
                        model_name=str(model.model_name or model_name or "").strip(),
                        completion_callback=(
                            lambda payload,
                            event_username=str(username or "").strip(),
                            event_conversation_id=str(model.conversation_id or "").strip():
                            _send_browser_event_to_conversation(
                                event_username,
                                event_conversation_id,
                                "memory_analysis_completed",
                                payload
                            )
                        )
                    )
                    print(
                        "[MEMORY_ANALYSIS] queued "
                        f"conversation_id={model.conversation_id} "
                        f"assistant_index={stream_assistant_index} "
                        f"job_id={memory_enqueue_result.get('job_id')}"
                    )
                    try:
                        log_event(
                            "memory_queued",
                            "memory enqueued",
                            payload={
                                "username": str(username or ""),
                                "conversation_id": str(model.conversation_id or ""),
                                "assistant_index": int(stream_assistant_index) if stream_assistant_index is not None else None,
                                "job_id": str(memory_enqueue_result.get("job_id") or ""),
                                "model": str(model.model_name or model_name or ""),
                            },
                            source="memory",
                        )
                    except Exception:
                        pass
                except Exception as memory_enqueue_error:
                    print(
                        "[MEMORY_ANALYSIS] enqueue failed "
                        f"conversation_id={model.conversation_id} "
                        f"assistant_index={stream_assistant_index} "
                        f"error={memory_enqueue_error}"
                    )
                    try:
                        log_event(
                            "memory_enqueue_failed",
                            "memory enqueue failed",
                            payload={
                                "username": str(username or ""),
                                "conversation_id": str(model.conversation_id or ""),
                                "assistant_index": int(stream_assistant_index) if stream_assistant_index is not None else None,
                                "error": str(memory_enqueue_error)[:500],
                            },
                            source="memory",
                        )
                    except Exception:
                        pass
            else:
                try:
                    log_event(
                        "memory_skipped",
                        "memory skipped (not eligible)",
                        payload={
                            "username": str(username or ""),
                            "conversation_id": str(model.conversation_id or conversation_id or ""),
                            "reason": "eligibility_false",
                            "done_seen": bool(memory_analysis_done_seen),
                            "error_seen": bool(memory_analysis_error_seen),
                            "stream_assistant_index": stream_assistant_index,
                        },
                        source="memory",
                    )
                except Exception:
                    pass
        except Exception as e:
            if is_stream_cancelled_error(e):
                set_stage("worker_cancelled", "user_abort")
                raise

            set_stage("worker_error", str(e)[:500])
            error_details = _format_exception_details(e)
            print(f"[STREAM_ERROR]\n{error_details}")
            if _is_rate_limit_exception(e):
                push_chunk({
                    'type': 'error',
                    'error_code': 'rate_limit',
                    'retryable': True,
                    'content': f'模型请求触发限流/额度限制：{str(e)}'
                })
                return
            push_chunk({
                'type': 'error',
                'content': f'处理消息时出错:\n{error_details}'
            })

    stream_id = start_stream_session(
        username=username,
        conversation_id=str(conversation_id or '').strip(),
        worker=_stream_worker,
        metadata={
            'is_regenerate': bool(is_regenerate),
            'assistant_index': int(stream_assistant_index) if stream_assistant_index is not None else None,
            'regenerate_index': int(regenerate_index) if is_regenerate and regenerate_index is not None else None,
        }
    )
    _chat_latency_mark("runtime_stream_started", stream_id=str(stream_id or ""))

    from flask import stream_with_context
    resp = Response(
        stream_with_context(_iter_sse_from_runtime_stream(stream_id, username=username, from_seq=0)),
        mimetype='text/event-stream'
    )
    resp.headers['Cache-Control'] = 'no-cache, no-transform'
    resp.headers['X-Accel-Buffering'] = 'no'
    resp.headers['Connection'] = 'keep-alive'
    resp.headers['X-Stream-Id'] = str(stream_id or '')
    _chat_latency_mark("sse_response_ready")
    _chat_latency_flush("sse_response_ready")
    return resp


@app.route('/api/chat/stream/cancel', methods=['POST'])
@require_login
def chat_stream_cancel():
    data = request.get_json(silent=True) or {}
    stream_id = str(data.get('stream_id') or '').strip()
    conversation_id = str(data.get('conversation_id') or '').strip()
    if not stream_id and not conversation_id:
        return jsonify({'success': False, 'message': 'stream_id or conversation_id is required'}), 400
    username = session['username']
    if not stream_id:
        rows = list_stream_sessions(
            username=username,
            conversation_ids=[conversation_id],
            include_done=False
        )
        cancelled_ids = []
        for row in rows:
            sid = str(row.get('stream_id') or '').strip()
            if sid and request_stream_cancel(sid, username=username, reason='user_abort'):
                cancelled_ids.append(sid)
        if not cancelled_ids:
            return jsonify({'success': False, 'message': 'stream session not found'}), 404
        return jsonify({
            'success': True,
            'stream_ids': cancelled_ids,
            'conversation_id': conversation_id,
            'cancel_requested': True
        })

    ok = request_stream_cancel(stream_id, username=username, reason='user_abort')
    if not ok:
        return jsonify({'success': False, 'message': 'stream session not found'}), 404
    return jsonify({'success': True, 'stream_id': stream_id, 'cancel_requested': True})


@app.route('/api/chat/stream/reconnect', methods=['POST'])
@require_login
def chat_stream_reconnect():
    data = request.get_json(silent=True) or {}
    stream_id = str(data.get('stream_id') or '').strip()
    if not stream_id:
        return jsonify({'success': False, 'message': 'stream_id is required'}), 400
    try:
        from_seq = int(data.get('from_seq') or 0)
    except Exception:
        from_seq = 0

    username = session['username']
    meta = get_stream_session_meta(stream_id, username=username)
    if not meta:
        return jsonify({'success': False, 'message': 'stream session not found'}), 404

    from flask import stream_with_context
    resp = Response(
        stream_with_context(_iter_sse_from_runtime_stream(stream_id, username=username, from_seq=from_seq)),
        mimetype='text/event-stream'
    )
    resp.headers['Cache-Control'] = 'no-cache, no-transform'
    resp.headers['X-Accel-Buffering'] = 'no'
    resp.headers['Connection'] = 'keep-alive'
    return resp


@app.route('/api/chat/stream/content', methods=['GET'])
@require_login
def chat_stream_content():
    """Return the accumulated content from a stream session's chunk buffer."""
    stream_id = str(request.args.get('stream_id') or '').strip()
    if not stream_id:
        return jsonify({'success': False, 'message': 'stream_id is required'}), 400
    username = session['username']
    result = get_stream_accumulated_content(stream_id, username=username)
    if not result:
        return jsonify({'success': False, 'message': 'stream session not found'}), 404
    return jsonify({
        'success': True,
        'stream_id': result.get('stream_id', ''),
        'conversation_id': result.get('conversation_id', ''),
        'content': result.get('content', ''),
        'reasoning_content': result.get('reasoning_content', ''),
        'render_chunks': result.get('render_chunks', []),
        'last_seq': result.get('last_seq', 0),
        'status': result.get('status', ''),
    })


@app.route('/api/chat/stream/status', methods=['GET', 'POST'])
@require_login
def chat_stream_status():
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        raw_ids = data.get('stream_ids', [])
        raw_conversation_ids = data.get('conversation_ids', [])
    else:
        raw = str(request.args.get('stream_ids') or request.args.get('ids') or '').strip()
        raw_ids = [part.strip() for part in raw.split(',')] if raw else []
        raw_conversation = str(request.args.get('conversation_ids') or request.args.get('conversation_id') or '').strip()
        raw_conversation_ids = [part.strip() for part in raw_conversation.split(',')] if raw_conversation else []
    if not isinstance(raw_ids, list):
        raw_ids = []
    if not isinstance(raw_conversation_ids, list):
        raw_conversation_ids = []
    stream_ids = [str(item or '').strip() for item in raw_ids if str(item or '').strip()]
    conversation_ids = [str(item or '').strip() for item in raw_conversation_ids if str(item or '').strip()]
    username = session['username']
    rows = list_stream_sessions(
        username=username,
        stream_ids=stream_ids,
        conversation_ids=conversation_ids,
        include_done=True
    )
    return jsonify({'success': True, 'sessions': rows})


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

_NEXORACODE_PROJECT_TREE_CACHE: Dict[Any, Dict[str, Any]] = {}
_NEXORACODE_PROJECT_TREE_CACHE_LOCK = threading.Lock()
_NEXORACODE_PROJECT_TREE_TTL_SEC = 300


def _read_conversation_nexoracode_project(username: str, conversation_id: str) -> Dict[str, Any]:
    """读取会话绑定的 NexoraCode 项目 metadata；未绑定返回空 dict。"""
    cid = str(conversation_id or '').strip()

    if not cid:
        return {}

    try:
        manager = ConversationService(username)
        convo = manager.get_conversation(cid)
        metadata = convo.get('metadata') if isinstance(convo, dict) else None
        project = metadata.get('nexoracode_project') if isinstance(metadata, dict) else None

        if isinstance(project, dict) and str(project.get('path') or '').strip():
            return project
    except Exception:
        pass

    return {}


def _format_nexoracode_tree_result(result: Any) -> str:
    """把 local_file_search_tree 的返回格式化为缩进树文本；失败返回空串。"""
    if not isinstance(result, dict):
        return ""

    payload = result.get('result') if isinstance(result.get('result'), dict) else result

    if not isinstance(payload, dict) or payload.get('success') is not True:
        return ""

    entries = payload.get('entries')

    if not isinstance(entries, list) or not entries:
        return ""

    lines = []

    for entry in sorted(entries, key=lambda item: str((item or {}).get('relative_path') or '')):
        if not isinstance(entry, dict):
            continue

        relative_path = str(entry.get('relative_path') or '').strip()

        if not relative_path:
            continue

        depth = entry.get('depth')
        indent_level = max(0, int(depth) - 1) if isinstance(depth, int) else max(0, relative_path.count('/'))
        name = str(entry.get('name') or relative_path.rsplit('/', 1)[-1])
        suffix = '/' if str(entry.get('type') or '') == 'dir' else ''
        lines.append(f"{'  ' * indent_level}{name}{suffix}")

    if payload.get('truncated'):
        lines.append('...（目录条目已截断）')

    return "\n".join(lines)


def _is_permission_required_result(result) -> bool:
    """判断本地工具结果是否为 permission_required。"""
    if not isinstance(result, dict):
        return False
    detail = result.get('result') if isinstance(result.get('result'), dict) else result
    return bool(detail.get('permission_required')) or str(detail.get('error') or '').strip() == 'permission_required'


def _auto_grant_project_root_read(username: str, project_path: str, conversation_id: str) -> None:
    """项目根未授权时自动授予 read：用户主动绑定项目即同意浏览该项目目录。"""
    if not str(conversation_id or '').strip():
        return
    from App.Agent import call_local_tool_sync
    try:
        call_local_tool_sync(
            username,
            'local_permission_grant',
            {
                'path': project_path,
                'scope': 'dir',
                'access': 'read',
                'reason': '项目目录浏览',
                'conversation_id': conversation_id,
            },
            timeout_sec=10,
            context={'conversation_id': conversation_id, 'username': username},
        )
    except Exception as e:
        try:
            print(f"[NexoraCode ProjectContext] auto grant failed: {e}")
        except Exception:
            pass


def _fetch_nexoracode_project_tree_text(username: str, project_path: str, conversation_id: str = '', cancel_checker=None) -> str:
    """经 NexoraCode WSS 通道拉取项目目录树文本，带 TTL 缓存。

    项目根未授权时先自动授予 read 再重试一次，避免目录树为空。
    """
    from App.Agent import call_local_tool_sync

    cache_key = (str(username or ''), str(project_path or ''))
    now = time.time()

    with _NEXORACODE_PROJECT_TREE_CACHE_LOCK:
        cached = _NEXORACODE_PROJECT_TREE_CACHE.get(cache_key)

        if cached and (now - float(cached.get('ts') or 0)) < _NEXORACODE_PROJECT_TREE_TTL_SEC:
            return str(cached.get('text') or '')

    def _request_tree():
        return call_local_tool_sync(
            username,
            'local_file_search_tree',
            {
                'path': project_path,
                'max_depth': 3,
                'max_entries': 400,
                'include_hidden': False,
            },
            timeout_sec=12,
            cancel_checker=cancel_checker,
        )

    result = _request_tree()

    if _is_permission_required_result(result):
        _auto_grant_project_root_read(username, project_path, conversation_id)
        result = _request_tree()

    tree_text = _format_nexoracode_tree_result(result)

    with _NEXORACODE_PROJECT_TREE_CACHE_LOCK:
        _NEXORACODE_PROJECT_TREE_CACHE[cache_key] = {'ts': now, 'text': tree_text}

    if not tree_text:
        try:
            error_text = ''

            if isinstance(result, dict):
                detail = result.get('result') if isinstance(result.get('result'), dict) else result
                error_text = str(result.get('error') or detail.get('error') or detail.get('message') or '')

            print(f"[NexoraCode ProjectContext] tree unavailable path={project_path} error={error_text[:200]}")
        except Exception:
            pass

    return tree_text


def _inject_nexoracode_project_context(model, username: str, conversation_id: str, cancel_checker=None):
    """将会话绑定的 NexoraCode 项目信息与目录树注入系统提示。"""
    project = _read_conversation_nexoracode_project(username, conversation_id)

    if not project:
        return False

    project_name = str(project.get('name') or '').strip() or '未命名项目'
    project_path = str(project.get('path') or '').strip()
    lines = [
        '## NexoraCode 项目上下文',
        f'当前对话绑定本地项目：{project_name}',
        f'项目根路径：{project_path}',
        '涉及该项目的文件读写、搜索、命令执行请使用 local_* 工具，并保持在项目根路径内。',
        '项目内路径需要授权时，系统会自动向用户发起询问，无需调用任何权限工具；'
        '用户允许后即可重试，项目根目录只申请一次。',
        '敏感文件仍必须按实际敏感路径单独申请权限。',
    ]

    tree_text = ''

    if is_agent_online(username):
        tree_text = _fetch_nexoracode_project_tree_text(username, project_path, cancel_checker=cancel_checker)

    if tree_text:
        lines.extend([
            '',
            '项目目录结构（最多 3 层，自动扫描）：',
            '```',
            tree_text,
            '```',
        ])
    else:
        lines.extend([
            '',
            '目录结构暂不可用（NexoraCode 离线，或该路径尚未在本地 allowed_dirs 中授权）。'
            '需要浏览项目文件时先调用 local_file_search_tree。',
        ])

    section = "\n".join(lines)
    # 写入 runtime block 而非直接覆盖 system_prompt：chat_stream 内部每次请求都会
    # 用 _build_effective_system_prompt 重建 system_prompt，直接覆盖会被冲掉，
    # 且 debug window 展示的是重建后的 request_system_prompt（原先看不到本段）。
    model._runtime_project_context_block = section
    model._runtime_nexoracode_project_path = project_path
    # 项目模式：强制 force 工具模式，并裁剪远程业务工具（本地工具不受影响）。
    model._runtime_project_force_tools = True
    model._runtime_project_excluded_tool_names = _resolve_project_excluded_tools()
    model.system_prompt = f"{str(model.system_prompt or '').rstrip()}\n\n{section}"
    return True


def _resolve_project_excluded_tools() -> set:
    """解析项目模式工具裁剪集：默认使用内置集，config 的 project_mode_excluded_tools 可覆盖。"""
    from basis.Tool import NEXORACODE_PROJECT_EXCLUDED_TOOL_NAMES

    excluded = set(NEXORACODE_PROJECT_EXCLUDED_TOOL_NAMES)

    try:
        custom = (get_config_all() or {}).get("project_mode_excluded_tools")
    except Exception:
        custom = None

    if isinstance(custom, list) and custom:
        excluded = {str(item or "").strip() for item in custom if str(item or "").strip()}

    return excluded


def _build_auto_permission_payload(model, detail) -> dict:
    """构建本地路径自动授权询问的 question payload（dict）。"""
    from basis.Permission import build_permission_question_payload

    path = str(detail.get("path") or "").strip() or str(detail.get("resolved_path") or "").strip()
    operation = str(detail.get("operation") or "read").strip().lower() or "read"
    scope = str(detail.get("suggested_scope") or "file").strip().lower() or "file"
    reason = str(detail.get("reason") or detail.get("message") or "本地工具需要访问该路径。").strip()
    sensitive = bool(detail.get("sensitive", False))

    return build_permission_question_payload(
        path=path,
        operation=operation,
        scope=scope,
        reason=reason,
        sensitive=sensitive,
        project_root=str(getattr(model, "_runtime_nexoracode_project_path", "") or "").strip(),
    )


def _build_auto_permission_question(model, detail) -> str:
    """本地工具返回 permission_required 时自动发起授权询问，省去模型显式调用 ask_for_permission。"""
    return json.dumps(_build_auto_permission_payload(model, detail), ensure_ascii=False)


def _inject_local_agent_tools(model, agent_info: dict, cancel_checker=None):
    """将本地 Agent 工具注入到 model 实例（工具定义 + 执行处理器）

    执行路径：Nexora WSS → NexoraCode 本地执行 → WSS 返回结果给模型。
    本地工具只允许走 WSS，避免 HTTP 长轮询在每次工具调用时制造额外请求。
    """
    username = agent_info.get("username", "")

    def _raise_if_cancelled():
        if callable(cancel_checker) and cancel_checker():
            raise StreamCancelled("user_abort")

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
        raw_tool_name = str(func.get("name") or tool_def.get("name") or "").strip()
        tool_name = canonicalize_tool_name(raw_tool_name)
        description = func.get("description") or tool_def.get("description", "")
        parameters = func.get("parameters") or tool_def.get("parameters", {})
        if not tool_name:
            continue

        builtin_handlers = getattr(getattr(model, 'tool_executor', None), 'handlers', {})

        if isinstance(builtin_handlers, dict) and tool_name in builtin_handlers:
            print(
                f"[NexoraCode ChatInject] skip builtin tool collision "
                f"name={tool_name} raw_name={raw_tool_name}"
            )
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

        # 注入工具定义并登记为外部运行时工具，避免 sendMessage 重建基础工具时被清空。
        model.register_external_function_tool(formatted)

        def _format_local_tool_failure_markdown(tool_name: str, result: dict, title: str) -> str:
            detail_payload = result.get("result") if isinstance(result.get("result"), dict) else result
            error_text = str(
                result.get("error")
                or detail_payload.get("error")
                or result.get("message")
                or detail_payload.get("message")
                or "未知错误"
            ).strip()
            lines = [
                f"### {title}",
                "",
                f"- 工具: `{tool_name}`",
                f"- 原因: {error_text}",
            ]
            detail_keys = [
                "path",
                "encoding",
                "line_separator",
                "bom",
                "old_sha256",
                "actual_sha256",
                "expected_sha256",
            ]
            details = []

            for key in detail_keys:
                value = detail_payload.get(key)

                if value is None or value == "":
                    continue

                details.append(f"- {key}: `{value}`")

            if details:
                lines.extend(["", "文件状态:", *details])

            if tool_name == "local_file_patch":
                lines.extend([
                    "",
                    "修正建议:",
                    "- 多条 edits 会按顺序串行执行，后一条 target 会在前面 edit 修改后的内容中匹配。",
                    "- 多行 target 可以使用 LF，工具会在 CRLF/CR/LF 换行归一化后做唯一匹配。",
                    "- replace 使用 replacement；insert_before/insert_after 使用 content。",
                    "- 如果是 SHA 不一致，请先重新 local_file_read 或 local_file_probe 获取最新 sha256。",
                ])

            return "\n".join(lines)

        # 注入执行处理器：本地工具只走 agent_tunnel_socket 的 WSS 通道。
        def _make_handler(name: str, uname: str):
            def _handler(args: dict) -> str:
                from App.Agent import is_agent_online, call_local_tool_sync

                _raise_if_cancelled()
                conversation_id = str(getattr(model, "conversation_id", "") or "").strip()
                
                if is_agent_online(uname):
                    try:
                        result = call_local_tool_sync(
                            uname,
                            name,
                            args,
                            timeout_sec=120,
                            cancel_checker=cancel_checker,
                            context={
                                "conversation_id": conversation_id,
                                "username": username,
                            }
                        )
                        _raise_if_cancelled()
                        if result and str(result.get("error") or "") == "stream_cancelled":
                            raise StreamCancelled("user_abort")
                        if result and "error" in result and not result.get("success", True):
                            detail = result.get("result") if isinstance(result.get("result"), dict) else result

                            # 权限缺失时自动发起授权询问：直接向流推送 question chunk（前端原生渲染授权卡片），
                            # 不依赖模型原样输出 JSON，确保用户一定能看到权限申请。
                            if detail and (
                                bool(detail.get("permission_required"))
                                or str(detail.get("error") or "").strip() == "permission_required"
                            ):
                                permission_payload = _build_auto_permission_payload(model, detail)
                                pusher = getattr(model, "_stream_direct_push_chunk", None)

                                if callable(pusher):
                                    try:
                                        pusher({
                                            "type": "question",
                                            "question": permission_payload.get("question"),
                                            "await": True,
                                        })
                                    except Exception:
                                        pass

                                return json.dumps(permission_payload, ensure_ascii=False)

                            return _format_local_tool_failure_markdown(name, result, "本地工具 WSS 执行失败")
                        r = result.get("result", result)
                        return r if isinstance(r, str) else json.dumps(r, ensure_ascii=False)
                    except Exception as e:
                        if is_stream_cancelled_error(e):
                            raise
                        return f"本地工具 WSS 通信异常: {e}"

                return _format_local_tool_failure_markdown(
                    name,
                    {
                        "success": False,
                        "error": "NexoraCode WSS 未在线，已拒绝执行本地工具。请保持 NexoraCode WSS 连接后重试。",
                    },
                    "本地工具 WSS 未在线",
                )
            return _handler

        model.tool_executor.handlers[tool_name] = _make_handler(tool_name, username)


def _resolve_agent_info_for_user(username: str):
    from App.Agent import is_agent_online, get_agent_tools

    if is_agent_online(username):
        tools = get_agent_tools(username)

        if tools:
            return {"username": username, "tools": tools, "source": "wss"}

    return None


def _flatten_model_function_tools(model) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()
    for item in (getattr(model, 'tools', None) or []):
        if not isinstance(item, dict):
            continue
        func = item.get("function") if isinstance(item.get("function"), dict) else None
        raw_name = str((func or {}).get("name") or item.get("name") or "").strip()
        name = canonicalize_tool_name(raw_name)
        if not name or name in seen:
            continue
        seen.add(name)
        description = str((func or {}).get("description") or item.get("description") or "").strip()
        parameters = (func or {}).get("parameters") if func else item.get("parameters")
        if not isinstance(parameters, dict):
            parameters = {}
        row = {
            "name": name,
            "canonical_name": name,
            "description": description,
            "parameters": parameters,
        }
        if raw_name and raw_name != name:
            row["legacy_alias"] = raw_name
        out.append(row)
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
    raw_tool_name = str(data.get('tool_name') or '').strip()
    tool_name = canonicalize_tool_name(raw_tool_name)
    args = data.get('args')
    if not raw_tool_name:
        return jsonify({'success': False, 'message': 'tool_name 不能为空'}), 400
    if not tool_name:
        return jsonify({'success': False, 'message': f'工具名无效: {raw_tool_name}'}), 400
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
            'canonical_name': tool_name,
            'legacy_alias': raw_tool_name if raw_tool_name != tool_name else '',
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

    if is_agent_online(username):
        update_agent_tools(username, tools)

    print(
        f"[NexoraCode Register] username={username} "
        f"tool_count={len(registered_tools)} tools={registered_tools}"
    )
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
    """旧版 NexoraCode 本地工具长轮询入口已停用，本地工具统一走 WSS。"""
    return jsonify({
        "success": False,
        "message": "NexoraCode local tool long polling is disabled. Use WSS agent tunnel.",
    }), 410


@app.route('/api/tokens/stats', methods=['GET'])
@require_login
def get_token_stats():
    """获取Token使用统计"""
    username = session['username']
    conversation_id = (request.args.get('conversation_id') or '').strip()
    user = User(username)

    try:
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

        def _build_stats_from_logs(logs):
            input_total = 0
            output_total = 0
            total_tokens = 0
            today_input_tokens = 0
            today_output_tokens = 0
            today_tokens = 0
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
                    today_input_tokens += in_tokens
                    today_output_tokens += out_tokens
                    today_tokens += log_total

            return {
                'success': True,
                'conversation_id': conversation_id or None,
                'input_total': input_total,
                'output_total': output_total,
                'total': total_tokens,
                'today_input': today_input_tokens,
                'today_output': today_output_tokens,
                'today': today_tokens,
                'history': TokenUsageDetailPresenter(username).decorate_history(logs, limit=20)
            }

        # conversation_id 模式由 ConversationService 统一聚合（v4 usage 为主，兼容旧 metadata.io_tokens）
        if conversation_id:
            try:
                svc = ConversationService(username)
                agg = svc.get_conversation_usage(conversation_id)
                if agg.get("found"):
                    try:
                        raw_logs = user.get_token_logs()
                        filtered = [log for log in raw_logs if str(log.get('conversation_id', '')) == conversation_id]
                        history = TokenUsageDetailPresenter(username).decorate_history(filtered, limit=20)
                    except Exception:
                        history = []
                    return jsonify({
                        'success': True,
                        'conversation_id': conversation_id,
                        'input_total': int(agg.get("input_total", 0)),
                        'output_total': int(agg.get("output_total", 0)),
                        'total': int(agg.get("total", 0)),
                        'today_input': int(agg.get("today_input", 0)),
                        'today_output': int(agg.get("today_output", 0)),
                        'today': int(agg.get("today_total", 0)),
                        'history': history
                    })
            except Exception as stats_error:
                print(f"[TOKEN_STATS] conversation aggregate failed cid={conversation_id}: {stats_error}")

        logs = user.get_token_logs()

        if conversation_id:
            logs = [log for log in logs if str(log.get('conversation_id', '')) == conversation_id]

        return jsonify(_build_stats_from_logs(logs))
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/tokens/detail', methods=['GET'])
@require_login
def get_token_detail():
    """按稳定日志引用读取当前用户的 Token 调用详情。"""
    username = session['username']
    detail_ref = str(request.args.get('ref') or '').strip()

    if not detail_ref or len(detail_ref) > 128:
        return jsonify({'success': False, 'message': 'Token 详情引用无效'}), 400

    try:
        user = User(username)
        presenter = TokenUsageDetailPresenter(username)
        detail = presenter.present(user.get_token_logs(), detail_ref)

        return jsonify({'success': True, 'detail': detail})
    except LookupError as error:
        return jsonify({'success': False, 'message': str(error)}), 404
    except ValueError as error:
        return jsonify({'success': False, 'message': str(error)}), 400
    except Exception:
        app.logger.exception('[TOKEN_DETAIL] load failed user=%s ref=%s', username, detail_ref[:24])

        return jsonify({'success': False, 'message': 'Token 详情读取失败'}), 500


# ==================== 知识库相关 ====================

@app.route('/knowledge')
def knowledge():
    """知识库页面"""
    if 'username' not in session:
        return redirect(url_for('login'))
    return render_template('knowledge.html', username=session['username'])


def _get_workspace_request_value(data: Optional[Dict[str, Any]], *names: str) -> str:
    """Read workspace selector from the active request first, then JSON data."""
    if has_request_context():
        for name in names:
            value = request.args.get(name)

            if value is not None:
                return str(value or '').strip()

    if isinstance(data, dict):
        for name in names:
            if name in data:
                return str(data.get(name) or '').strip()

    return ''


def _resolve_workspace_basis_target(title: str, data: Optional[Dict[str, Any]] = None) -> Tuple[str, Any, Dict[str, Any], str]:
    login_username = str(session.get('username') or '').strip()
    safe_title = str(title or '').strip()
    workspace_id = _get_workspace_request_value(data, 'workspace_id', 'workspace', 'workspaces')

    if not workspace_id:
        return login_username, None, {}, ''

    requested_user = _get_workspace_request_value(data, 'user', 'owner_username', 'added_by')

    from App.Workspace import (
        find_store_for_visible_workspace,
        validate_username,
        validate_workspace_id,
    )

    viewer = validate_username(login_username)
    wid = validate_workspace_id(workspace_id)
    requested_user = validate_username(requested_user) if requested_user else ''
    store = find_store_for_visible_workspace(viewer, wid)
    document = store.get_visible_knowledge_document(
        wid,
        safe_title,
        viewer,
        'basis',
        requested_user,
    )
    resource_username = validate_username(str(document.get('added_by') or ''))

    return resource_username, store, document, wid


def _current_user_timeline_actor() -> Dict[str, str]:
    actor_name = str(session['username']).strip()

    return {
        'actor_type': 'user',
        'actor_name': actor_name,
    }


@app.route('/api/knowledge/image/allocate', methods=['POST'])
@require_login
def allocate_knowledge_image():
    owner = str(session.get('username') or '').strip()
    if not owner:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    data = request.get_json(silent=True) or {}
    original_name = str(data.get('file_name') or data.get('name') or '').strip()
    basis_title = str(data.get('basis_title') or '').strip()
    image_id = f"kimg_{secrets.token_hex(8)}"
    now_ts = int(time.time())
    idx = _load_knowledge_image_index(owner)
    images = idx.get("images", {})
    images[image_id] = {
        "image_id": image_id,
        "owner": owner,
        "file_name": "",
        "mime": "",
        "size": 0,
        "original_name": original_name,
        "basis_title": basis_title,
        "created_at": now_ts,
        "updated_at": now_ts,
        "status": "allocated",
    }
    idx["images"] = images
    _save_knowledge_image_index(owner, idx)
    image_url = url_for('serve_knowledge_image', username=owner, image_id=image_id)
    return jsonify({
        'success': True,
        'image_id': image_id,
        'username': owner,
        'image_url': image_url,
        'max_bytes': _KNOWLEDGE_IMAGE_MAX_BYTES,
    })


@app.route('/api/knowledge/image/upload', methods=['POST'])
@require_login
def upload_knowledge_image():
    owner = str(session.get('username') or '').strip()
    if not owner:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401

    image_id = _normalize_knowledge_image_id(request.form.get('image_id'))
    original_name = str(request.form.get('file_name') or '').strip()
    basis_title = str(request.form.get('basis_title') or '').strip()
    source_url = str(request.form.get('source_url') or '').strip()
    image_base64 = str(request.form.get('image_base64') or '').strip()
    mime_hint = str(request.form.get('mime') or '').strip().lower()
    upload_file = request.files.get('file')

    if not image_id and request.is_json:
        payload = request.get_json(silent=True) or {}
        image_id = _normalize_knowledge_image_id(payload.get('image_id'))
        original_name = str(payload.get('file_name') or payload.get('name') or original_name).strip()
        basis_title = str(payload.get('basis_title') or basis_title).strip()
        source_url = str(payload.get('source_url') or source_url).strip()
        image_base64 = str(payload.get('image_base64') or image_base64).strip()
        mime_hint = str(payload.get('mime') or mime_hint).strip().lower()

    if not image_id:
        return jsonify({'success': False, 'message': 'image_id is required'}), 400

    raw_bytes = b""
    mime = ""
    try:
        if upload_file:
            mime = str(upload_file.mimetype or upload_file.content_type or '').strip().lower()
            if not mime:
                mime = _guess_image_mime_from_name(upload_file.filename)
            if mime not in _KNOWLEDGE_IMAGE_ALLOWED_MIME:
                return jsonify({'success': False, 'message': '不支持的图片类型'}), 400
            raw_bytes = upload_file.read(_KNOWLEDGE_IMAGE_MAX_BYTES + 1)
            if len(raw_bytes) > _KNOWLEDGE_IMAGE_MAX_BYTES:
                return jsonify({'success': False, 'message': f'图片过大，最大 {int(_KNOWLEDGE_IMAGE_MAX_BYTES / (1024 * 1024))}MB'}), 400
            if not original_name:
                original_name = str(upload_file.filename or '').strip()
        elif image_base64:
            mime, raw_bytes = _decode_knowledge_image_base64(image_base64, mime_hint=mime_hint)
        elif source_url:
            mime, raw_bytes = _download_knowledge_image_from_url(source_url)
        else:
            return jsonify({'success': False, 'message': 'missing image payload'}), 400

        meta = _persist_knowledge_image_bytes(
            owner_username=owner,
            image_id=image_id,
            image_bytes=raw_bytes,
            mime=mime,
            original_name=original_name,
            basis_title=basis_title,
        )
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 400

    image_url = url_for('serve_knowledge_image', username=owner, image_id=image_id)
    return jsonify({
        'success': True,
        'image_id': image_id,
        'username': owner,
        'image_url': image_url,
        'mime': str(meta.get('mime') or mime),
        'size': int(meta.get('size') or len(raw_bytes)),
    })


@app.route('/api/knowledge/image/<username>/<image_id>', methods=['GET'])
def serve_knowledge_image(username, image_id):
    owner = str(username or '').strip()
    safe_image_id = _normalize_knowledge_image_id(image_id)
    if not owner or not safe_image_id:
        return jsonify({'success': False, 'message': 'invalid image path'}), 400

    idx = _load_knowledge_image_index(owner)
    images = idx.get("images", {})
    row = images.get(safe_image_id) if isinstance(images, dict) else None
    if not isinstance(row, dict):
        return jsonify({'success': False, 'message': 'image not found'}), 404

    viewer = str(session.get('username') or '').strip()
    is_owner_or_admin = (viewer == owner) or (str(session.get('role') or '').strip().lower() == 'admin')
    if not is_owner_or_admin:
        basis_title = str(row.get('basis_title') or '').strip()
        if not basis_title:
            return jsonify({'success': False, 'message': 'Forbidden'}), 403
        user_obj = User(owner)
        db = safe_read_json(user_obj.path + "database.json", default={})
        basis_meta = (db.get("data_basis") or {}).get(basis_title) or {}
        if not basis_meta.get("public"):
            return jsonify({'success': False, 'message': 'Forbidden'}), 403

    file_name = str(row.get('file_name') or '').strip()
    if not file_name:
        return jsonify({'success': False, 'message': 'image not ready'}), 404

    root = _knowledge_image_root(owner)
    fpath = safe_join_path(root, file_name)
    if not os.path.exists(fpath):
        return jsonify({'success': False, 'message': 'image file missing'}), 404
    mime = str(row.get('mime') or '').strip().lower() or _guess_image_mime_from_name(file_name) or 'application/octet-stream'
    resp = send_file(fpath, mimetype=mime)
    resp.headers['Cache-Control'] = 'public, max-age=86400'
    return resp


def _build_knowledge_list_payload(username, requested_title='', workspace_scoped=False):
    if workspace_scoped:
        username, _, _, _ = _resolve_workspace_basis_target(requested_title)

    user = User(username)

    # 获取短期记忆和基础知识
    if SHORT_MEMORY_DISABLED or workspace_scoped:
        short_memory = {}
    else:
        short_memory = user.getKnowledgeList(0)  # 短期记忆

    permission_hint = get_user_permission_hint_by_username(username)
    user_profile_memory = '' if workspace_scoped else user.get_user_profile_memory(
        user_permission=permission_hint,
        max_chars=0
    )
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

    if workspace_scoped:
        basis_knowledge = {
            requested_title: basis_knowledge.get(requested_title, {})
        }

    # 增强：检测向量是否真实存在，防止外部删库后前端状态失真
    vectorization_enabled = _is_knowledge_vectorization_enabled()
    vector_titles = None
    store = None

    if vectorization_enabled:
        store, _ = get_chroma_store()

    if store and getattr(store, 'mode', '') == 'service':
        try:
            vector_titles = set(store.list_titles(username, library='knowledge'))
        except Exception as e:
            app.logger.warning('list knowledge vector title check failed: %s', e)
            vector_titles = None

    for title, meta in list(basis_knowledge.items()):
        if isinstance(meta, dict):
            meta['pin'] = bool(meta.get('pin', False))
            meta['model_readonly'] = bool(meta.get('model_readonly', False))

            if vectorization_enabled and vector_titles is not None:
                meta['vector_exists'] = title in vector_titles

            vector_exists = meta.get('vector_exists')

            if not isinstance(vector_exists, bool):
                vector_exists = True

            updated_at = _knowledge_meta_timestamp(meta.get('updated_at'))
            vector_updated_at = _knowledge_meta_timestamp(meta.get('vector_updated_at'))
            meta['needs_vector_refresh'] = bool(
                vectorization_enabled
                and ((updated_at > 0 and vector_updated_at < updated_at) or not vector_exists)
            )
        else:
            basis_knowledge[title] = {
                'pin': False,
                'model_readonly': False,
                'needs_vector_refresh': False
            }

    return {
        'short_memory': short_memory,
        'short_memory_disabled': bool(SHORT_MEMORY_DISABLED),
        'user_profile_memory': user_profile_memory,
        'basis_knowledge': basis_knowledge,
        'vectorization_enabled': vectorization_enabled
    }


@app.route('/api/knowledge/list', methods=['GET'])
@require_login
def list_knowledge():
    """获取知识库列表"""
    username = session['username']
    requested_title = str(request.args.get('title') or '').strip()
    workspace_scoped = bool(
        requested_title
        and str(request.args.get('workspace_id') or request.args.get('workspace') or request.args.get('workspaces') or '').strip()
    )

    try:
        payload = _build_knowledge_list_payload(username, requested_title, workspace_scoped)

        return jsonify({
            'success': True,
            **payload
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/knowledge/sidebar', methods=['GET'])
@require_login
def get_knowledge_sidebar():
    """获取聊天侧栏需要的知识库数据，不返回基础知识正文。"""
    username = session['username']

    try:
        payload = _build_knowledge_list_payload(username)
        basis_items = []

        for title, meta in payload.get('basis_knowledge', {}).items():
            item_meta = meta if isinstance(meta, dict) else {}
            basis_items.append({
                'title': title,
                'pin': bool(item_meta.get('pin', False)),
                'model_readonly': bool(item_meta.get('model_readonly', False))
            })

        profile = str(payload.get('user_profile_memory') or '')

        return jsonify({
            'success': True,
            'knowledge': basis_items,
            'memories': [{
                'id': 'profile',
                'title': '用户画像短期记忆',
                'content': profile
            }],
            'basis_knowledge': payload.get('basis_knowledge', {}),
            'short_memory_disabled': payload.get('short_memory_disabled', False),
            'vectorization_enabled': payload.get('vectorization_enabled', False)
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/knowledge/basis', methods=['GET'])
@require_login
def get_all_basis():
    """获取所有基础知识"""
    username = session['username']
    user = User(username)
    include_content = str(request.args.get('include_content') or '1').strip().lower() not in {'0', 'false', 'no'}
    
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
            item = {
                'title': safe_title,
                'pin': bool((meta or {}).get('pin', False)) if isinstance(meta, dict) else False,
                'model_readonly': bool((meta or {}).get('model_readonly', False)) if isinstance(meta, dict) else False,
                'updated_at': (meta or {}).get('updated_at') if isinstance(meta, dict) else 0,
                'basis_id': str((meta or {}).get('basis_id') or '').strip() if isinstance(meta, dict) else ''
            }

            if include_content:
                content = user.getBasisContent(safe_title)
                item['content'] = content

            result.append(item)
        return jsonify({'success': True, 'knowledge': result})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/export/word', methods=['GET'])
@require_login
def export_knowledge_word():
    """导出当前用户基础知识库为 Word 文档。"""
    username = session['username']
    user = User(username)
    title = str(request.args.get('title') or '').strip()

    try:
        items = KnowledgeWordExporter.collect_items(user, title=title)

        if not items:
            return jsonify({'success': False, 'message': '知识库为空'}), 404

        output = KnowledgeWordExporter().build(username, items)
        export_name = title or '知识库导出'
        time_suffix = datetime.now().strftime('%Y%m%d_%H%M%S')
        download_name = safe_filename(
            f'{export_name}_{time_suffix}.docx',
            default='knowledge_export.docx',
            max_len=180
        )

        return send_file(
            output,
            as_attachment=True,
            download_name=download_name,
            mimetype=KnowledgeWordExporter.mimetype
        )
    except KeyError as e:
        message = str(e).strip("'")
        return jsonify({'success': False, 'message': message}), 404
    except Exception as e:
        print(f"[KnowledgeExport] word export failed username={username} title={title}: {_format_exception_details(e)}")
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/knowledge/basis/<path:title>/content', methods=['PUT'])
@app.route('/api/knowledge/basis/update', methods=['POST'])
@require_login
def update_basis_content(title=None):
    """更新基础知识内容"""
    username = session['username']
    data = request.get_json(silent=True) or {}
    
    title = title or data.get('title')
    content = data.get('content')
    base_content_revision = data.get('base_content_revision') or data.get('base_revision')
    base_content_hash = data.get('base_content_hash') or data.get('content_hash')
    
    if not title:
        return jsonify({'success': False, 'message': '标题不能为空'}), 400

    if content is None:
        return jsonify({'success': False, 'message': '内容不能为空'}), 400
          
    try:
        username, _, _, _ = _resolve_workspace_basis_target(title, data)
        user = User(username)
        success, msg = user.updateBasisContent(
            title,
            content,
            timeline_actor=_current_user_timeline_actor(),
            base_content_revision=base_content_revision,
            base_content_hash=base_content_hash,
        )
        if success:
            payload = _knowledge_update_response_payload(title, msg, content, user)
            publish_meta = user.getBasisMetadata(title)
            publish_share_id = str((publish_meta or {}).get('share_id') or '').strip() if isinstance(publish_meta, dict) else ''
            _publish_knowledge_changed_event(
                username,
                title,
                payload,
                source='owner_save',
                actor_username=str(session.get('username') or '').strip(),
                share_id=publish_share_id,
                content=content,
            )
            return jsonify(payload)

        payload = _knowledge_conflict_response_payload(msg)
        status_code = 409 if payload.get('code') == 'knowledge_content_conflict' else 400
        return jsonify(payload), status_code
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/knowledge/basis/<path:title>', methods=['GET'])
@require_login
def get_basis_content(title):
    """获取单个基础知识内容"""
    username = session['username']
     
    try:
        username, _, document, workspace_id = _resolve_workspace_basis_target(title)
        user = User(username)
        content = user.getBasisContent(title)
        metadata = user.getBasisMetadata(title)
        version_payload = _build_knowledge_version_payload(title, metadata, content)
        return jsonify({
            'success': True, 
            'knowledge': {
                'title': title,
                'content': content,
                'metadata': metadata if isinstance(metadata, dict) else {},
                'owner_username': username,
                'added_by': document.get('added_by') if document else username,
                'workspace_id': workspace_id,
                **version_payload,
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


@app.route('/api/knowledge/basis/blank', methods=['POST'])
@require_login
def create_blank_basis():
    """创建空白基础知识库"""
    username = session['username']
    user = User(username)
    data = request.get_json(silent=True) or {}
    title_prefix = str(data.get('title_prefix') or data.get('title') or '未命名知识库').strip()

    try:
        title = user.addBlankBasis(title_prefix or '未命名知识库', timeline_actor=username)
        return jsonify({
            'success': True,
            'message': '创建成功',
            'title': title
        })
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
            old_title = str(title or '').strip()
            ok_removed, msg_removed = user.removeBasis(title)
            if not ok_removed:
                return jsonify({'success': False, 'error': msg_removed or '删除旧知识失败'})
            if old_title:
                vec_ok, vec_err = _delete_vector_title(username, old_title, library='knowledge')
                if not vec_ok and vec_err:
                    print(f"[Vector] delete old basis vector failed ({username}/{old_title}): {vec_err}")
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
        moved, move_err = _archive_basis_to_trash(username, user, title)
        if not moved:
            return jsonify({'success': False, 'message': f'写入回收站失败: {move_err}'}), 500
        ok, msg = user.removeBasis(title)
        if not ok:
            return jsonify({'success': False, 'message': msg or '删除失败'}), 404
        safe_title = str(title or '').strip()
        if safe_title:
            vec_ok, vec_err = _delete_vector_title(username, safe_title, library='knowledge')
            if not vec_ok and vec_err:
                print(f"[Vector] delete basis vector failed ({username}/{safe_title}): {vec_err}")
        return jsonify({'success': True, 'message': '删除成功'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/knowledge/basis/<path:title>/pin', methods=['PUT'])
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
    data = request.get_json() or {}
    title = data.get('title')
    new_title = data.get('new_title')
    is_public = data.get('public')
    is_collaborative = data.get('collaborative')
    model_readonly = data.get('model_readonly')
     
    try:
        username, workspace_store, document, workspace_id = _resolve_workspace_basis_target(title, data)
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

    user = User(username)
    success, msg = user.updateBasisSettings(
        title,
        new_title,
        is_public,
        is_collaborative,
        model_readonly,
        timeline_actor=_current_user_timeline_actor(),
    )
     
    if success:
        if workspace_store and workspace_id and new_title and new_title != title:
            try:
                workspace_store.update_knowledge_document_title(
                    workspace_id,
                    title,
                    new_title,
                    session['username'],
                    username,
                    document.get('knowledge_type') or 'basis',
                )
            except Exception as e:
                return jsonify({'success': False, 'message': str(e)})

        # 如果获取了新标题或状态，返回新的 share_url
        meta = user.getBasisMetadata(new_title or title)
        share_id = meta.get('share_id', '')

        if share_id and not (bool(meta.get('public')) and bool(meta.get('collaborative'))):
            _send_public_knowledge_event(username, share_id, 'public_knowledge_closed', {
                'owner_username': username,
                'share_id': share_id,
                'title': new_title or title,
                'message': '该协作链接已关闭或权限已变更',
            })

        base_url = get_public_base_url()
        share_url = f"{base_url}/public/knowledge/{username}/{share_id}"
        return jsonify({'success': True, 'message': msg, 'share_url': share_url, 'owner_username': username})
    return jsonify({'success': False, 'message': msg})

@app.route('/api/knowledge/basis/<path:title>/public', methods=['PUT'])
@app.route('/api/knowledge/basis/<path:title>/share', methods=['POST'])
@require_login
def share_basis(title):
    """切换知识点公开状态"""
    username = session['username']
    user = User(username)
    data = request.get_json(silent=True) or {}
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
    version_payload = _build_knowledge_version_payload(title, meta, content)
    # 如果允许协作，则进入协作编辑器，否则只读渲染
    if meta.get("collaborative"):
        return render_template('knowledge_public_edit.html', 
                               username=username, 
                               title=title, 
                               share_id=share_id,
                               content=content,
                               content_revision=version_payload.get('content_revision', ''),
                               content_hash=version_payload.get('content_hash', ''),
                               updated_at=version_payload.get('updated_at', 0))
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
    version_payload = _build_knowledge_version_payload(title, meta, content)
    return jsonify({
        'success': True,
        'title': title,
        'content': content,
        'username': username,
        'collaborative': meta.get("collaborative", False),
        **version_payload,
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
    base_content_revision = data.get('base_content_revision') or data.get('base_revision')
    base_content_hash = data.get('base_content_hash') or data.get('content_hash')
    
    if content is None:
        return jsonify({'success': False, 'message': '内容不能为空'})
        
    success, msg = user.updateBasisContent(
        title,
        content,
        base_content_revision=base_content_revision,
        base_content_hash=base_content_hash,
    )

    if success:
        payload = _knowledge_update_response_payload(title, msg, content, user)
        _publish_knowledge_changed_event(
            username,
            title,
            payload,
            source='public_collab_save',
            actor_username='public_collaborator',
            share_id=share_id,
            content=content,
        )
        return jsonify(payload)

    payload = _knowledge_conflict_response_payload(msg)
    status_code = 409 if payload.get('code') == 'knowledge_content_conflict' else 400
    return jsonify(payload), status_code


def _resolve_public_collab_basis(username: str, share_id: str) -> Tuple[Optional[User], Optional[str], Optional[Dict[str, Any]], Optional[Response]]:
    owner = str(username or '').strip()
    sid = str(share_id or '').strip()
    if not owner or not sid:
        return None, None, None, (jsonify({'success': False, 'message': 'invalid path'}), 400)
    user = User(owner)
    title, meta = user.getBasisByShareId(sid)
    if not meta or not meta.get("public"):
        return None, None, None, (jsonify({'success': False, 'message': 'Forbidden'}), 403)
    if not meta.get("collaborative"):
        return None, None, None, (jsonify({'success': False, 'message': 'Forbidden'}), 403)
    if not title:
        return None, None, None, (jsonify({'success': False, 'message': 'Not Found'}), 404)
    return user, str(title), dict(meta), None


@app.route('/api/public/knowledge/<username>/<share_id>/image/allocate', methods=['POST'])
def public_allocate_knowledge_image(username, share_id):
    user, title, _meta, err = _resolve_public_collab_basis(username, share_id)
    if err is not None:
        return err
    data = request.get_json(silent=True) or {}
    original_name = str(data.get('file_name') or data.get('name') or '').strip()
    image_id = f"kimg_{secrets.token_hex(8)}"
    now_ts = int(time.time())
    idx = _load_knowledge_image_index(user.user)
    images = idx.get("images", {})
    images[image_id] = {
        "image_id": image_id,
        "owner": user.user,
        "file_name": "",
        "mime": "",
        "size": 0,
        "original_name": original_name,
        "basis_title": str(title),
        "share_id": str(share_id or '').strip(),
        "created_at": now_ts,
        "updated_at": now_ts,
        "status": "allocated",
    }
    idx["images"] = images
    _save_knowledge_image_index(user.user, idx)
    image_url = url_for('public_serve_knowledge_image', username=user.user, image_id=image_id, share_id=str(share_id or '').strip())
    return jsonify({
        'success': True,
        'image_id': image_id,
        'username': user.user,
        'image_url': image_url,
        'max_bytes': _KNOWLEDGE_IMAGE_MAX_BYTES,
    })


@app.route('/api/public/knowledge/<username>/<share_id>/image/upload', methods=['POST'])
def public_upload_knowledge_image(username, share_id):
    user, title, _meta, err = _resolve_public_collab_basis(username, share_id)
    if err is not None:
        return err

    image_id = _normalize_knowledge_image_id(request.form.get('image_id'))
    original_name = str(request.form.get('file_name') or '').strip()
    source_url = str(request.form.get('source_url') or '').strip()
    image_base64 = str(request.form.get('image_base64') or '').strip()
    mime_hint = str(request.form.get('mime') or '').strip().lower()
    upload_file = request.files.get('file')

    if not image_id and request.is_json:
        payload = request.get_json(silent=True) or {}
        image_id = _normalize_knowledge_image_id(payload.get('image_id'))
        original_name = str(payload.get('file_name') or payload.get('name') or original_name).strip()
        source_url = str(payload.get('source_url') or source_url).strip()
        image_base64 = str(payload.get('image_base64') or image_base64).strip()
        mime_hint = str(payload.get('mime') or mime_hint).strip().lower()

    if not image_id:
        return jsonify({'success': False, 'message': 'image_id is required'}), 400

    raw_bytes = b""
    mime = ""
    try:
        if upload_file:
            mime = str(upload_file.mimetype or upload_file.content_type or '').strip().lower()
            if not mime:
                mime = _guess_image_mime_from_name(upload_file.filename)
            if mime not in _KNOWLEDGE_IMAGE_ALLOWED_MIME:
                return jsonify({'success': False, 'message': '不支持的图片类型'}), 400
            raw_bytes = upload_file.read(_KNOWLEDGE_IMAGE_MAX_BYTES + 1)
            if len(raw_bytes) > _KNOWLEDGE_IMAGE_MAX_BYTES:
                return jsonify({'success': False, 'message': f'图片过大，最大 {int(_KNOWLEDGE_IMAGE_MAX_BYTES / (1024 * 1024))}MB'}), 400
            if not original_name:
                original_name = str(upload_file.filename or '').strip()
        elif image_base64:
            mime, raw_bytes = _decode_knowledge_image_base64(image_base64, mime_hint=mime_hint)
        elif source_url:
            mime, raw_bytes = _download_knowledge_image_from_url(source_url)
        else:
            return jsonify({'success': False, 'message': 'missing image payload'}), 400

        meta = _persist_knowledge_image_bytes(
            owner_username=user.user,
            image_id=image_id,
            image_bytes=raw_bytes,
            mime=mime,
            original_name=original_name,
            basis_title=title,
        )
        idx = _load_knowledge_image_index(user.user)
        images = idx.get("images", {})
        row = images.get(image_id) if isinstance(images, dict) else None
        if isinstance(row, dict):
            row["share_id"] = str(share_id or '').strip()
            row["basis_title"] = str(title)
            row["updated_at"] = int(time.time())
            images[image_id] = row
            idx["images"] = images
            _save_knowledge_image_index(user.user, idx)
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 400

    image_url = url_for('public_serve_knowledge_image', username=user.user, image_id=image_id, share_id=str(share_id or '').strip())
    return jsonify({
        'success': True,
        'image_id': image_id,
        'username': user.user,
        'image_url': image_url,
        'mime': str(meta.get('mime') or mime),
        'size': int(meta.get('size') or len(raw_bytes)),
    })


@app.route('/api/public/knowledge/image/<username>/<image_id>', methods=['GET'])
def public_serve_knowledge_image(username, image_id):
    owner = str(username or '').strip()
    sid = str(request.args.get('share_id') or '').strip()
    safe_image_id = _normalize_knowledge_image_id(image_id)
    if not owner or not sid or not safe_image_id:
        return jsonify({'success': False, 'message': 'invalid image path'}), 400
    user = User(owner)
    title, meta = user.getBasisByShareId(sid)
    if not meta or not meta.get("public"):
        return jsonify({'success': False, 'message': 'Forbidden'}), 403

    idx = _load_knowledge_image_index(owner)
    images = idx.get("images", {})
    row = images.get(safe_image_id) if isinstance(images, dict) else None
    if not isinstance(row, dict):
        return jsonify({'success': False, 'message': 'image not found'}), 404

    if str(row.get('owner') or '').strip() != owner:
        return jsonify({'success': False, 'message': 'Forbidden'}), 403
    row_basis_title = str(row.get('basis_title') or '').strip()
    if row_basis_title and str(title or '').strip() and (row_basis_title != str(title).strip()):
        return jsonify({'success': False, 'message': 'Forbidden'}), 403

    file_name = str(row.get('file_name') or '').strip()
    if not file_name:
        return jsonify({'success': False, 'message': 'image not ready'}), 404

    root = _knowledge_image_root(owner)
    fpath = safe_join_path(root, file_name)
    if not os.path.exists(fpath):
        return jsonify({'success': False, 'message': 'image file missing'}), 404
    mime = str(row.get('mime') or '').strip().lower() or _guess_image_mime_from_name(file_name) or 'application/octet-stream'
    resp = send_file(fpath, mimetype=mime)
    resp.headers['Cache-Control'] = 'public, max-age=86400'
    return resp


@app.route('/api/knowledge/short', methods=['GET'])
@require_login
def get_all_short():
    """获取短期记忆（用户画像）"""
    username = session['username']
    user = User(username)
    
    try:
        permission_hint = get_user_permission_hint_by_username(username)
        profile = user.get_user_profile_memory(
            user_permission=permission_hint,
            max_chars=0
        )
        return jsonify({
            'success': True,
            'memories': [{
                'id': 'profile',
                'title': '用户画像短期记忆',
                'content': profile
            }]
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/short/<path:title>', methods=['GET'])
@require_login
def get_short_content(title):
    """获取短期记忆内容（用户画像）"""
    username = session['username']
    user = User(username)
    
    try:
        permission_hint = get_user_permission_hint_by_username(username)
        profile = user.get_user_profile_memory(
            user_permission=permission_hint,
            max_chars=0
        )
        return jsonify({
            'success': True,
            'memory': {
                'title': '用户画像短期记忆',
                'content': profile
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/short', methods=['POST'])
@require_login
def add_short():
    """更新短期记忆（用户画像）"""
    username = session['username']
    user = User(username)
    data = request.get_json(silent=True) or {}
    
    title = data.get('title', '')
    content = data.get('content', title)
    profile_text = str(content or title or '').strip()
    if not profile_text:
        return jsonify({'success': False, 'error': '内容不能为空'})
    
    try:
        permission_hint = get_user_permission_hint_by_username(username)
        profile = user.set_user_profile_memory(
            profile_text=profile_text,
            user_permission=permission_hint,
            max_chars=0
        )
        return jsonify({
            'success': True,
            'message': '短期记忆画像已更新',
            'profile': profile,
            'length': len(str(profile or '')),
            'max_length': 0
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/short/<path:title>', methods=['PUT'])
@require_login
def update_short(title):
    """更新短期记忆（用户画像）"""
    username = session['username']
    user = User(username)
    data = request.get_json(silent=True) or {}
    
    new_title = data.get('title', '')
    content = data.get('content', new_title)
    profile_text = str(content or new_title or '').strip()
    if not profile_text:
        return jsonify({'success': False, 'error': '内容不能为空'})
    
    try:
        permission_hint = get_user_permission_hint_by_username(username)
        profile = user.set_user_profile_memory(
            profile_text=profile_text,
            user_permission=permission_hint,
            max_chars=0
        )
        return jsonify({
            'success': True,
            'message': '短期记忆画像已更新',
            'profile': profile,
            'length': len(str(profile or '')),
            'max_length': 0
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/short/<path:title>', methods=['DELETE'])
@require_login
def delete_short(title):
    """删除短期记忆（重置用户画像）"""
    username = session['username']
    user = User(username)
    
    try:
        permission_hint = get_user_permission_hint_by_username(username)
        profile = user.set_user_profile_memory(
            profile_text='',
            user_permission=permission_hint,
            max_chars=0
        )
        return jsonify({
            'success': True,
            'message': '短期记忆画像已重置',
            'profile': profile
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/knowledge/short/clear', methods=['POST'])
@require_login
def clear_short_memory():
    """清空短期记忆（重置用户画像）"""
    username = session['username']
    user = User(username)
    try:
        permission_hint = get_user_permission_hint_by_username(username)
        profile = user.set_user_profile_memory(
            profile_text='',
            user_permission=permission_hint,
            max_chars=0
        )
        return jsonify({
            'success': True,
            'cleared': 1,
            'profile': profile
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/memory/profile', methods=['GET'])
@require_login
def get_user_profile_memory_api():
    username = session['username']
    user = User(username)
    try:
        permission_hint = get_user_permission_hint_by_username(username)
        profile = user.get_user_profile_memory(
            user_permission=permission_hint,
            max_chars=0
        )
        return jsonify({
            'success': True,
            'profile': profile,
            'length': len(str(profile or '')),
            'max_length': 0
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/memory/profile', methods=['PUT'])
@require_login
def update_user_profile_memory_api():
    username = session['username']
    user = User(username)
    data = request.get_json(silent=True) or {}
    reset = bool(data.get('reset', False))
    profile_text = '' if reset else data.get('profile', '')

    try:
        permission_hint = get_user_permission_hint_by_username(username)
        profile = user.set_user_profile_memory(
            profile_text=profile_text,
            user_permission=permission_hint,
            max_chars=0
        )
        return jsonify({
            'success': True,
            'profile': profile,
            'length': len(str(profile or '')),
            'max_length': 0,
            'reset': reset
        })
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

def _normalize_category_position_payload(data):
    if not isinstance(data, dict):
        return {}

    category = str(data.get('category') or '').strip()
    position = data.get('position')

    if category and isinstance(position, dict):
        return {category: position}

    return {
        str(cat_name): pos
        for cat_name, pos in data.items()
        if str(cat_name or '').strip() and isinstance(pos, dict)
    }


@app.route('/api/knowledge/graph/positions', methods=['POST', 'PUT'])
@require_login
def save_knowledge_graph_positions():
    """保存知识图谱节点/分类位置"""
    username = session['username']
    user = User(username)
    data = request.get_json(silent=True) or {}
    positions = _normalize_category_position_payload(data)

    if not positions:
        return jsonify({'success': False, 'error': '参数不完整'}), 400
    
    try:
        graph = user.get_knowledge_graph()

        # 更新全部分类位置
        for cat_name, pos in positions.items():
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


@app.route('/api/knowledge/graph/nodes/positions', methods=['PUT'])
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

        prompt = prompts.build_knowledge_graph_analysis_prompt(all_knowledge)
        

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
        from App.Core import Model
        
        graph = user.get_knowledge_graph()
        if category not in graph['categories']:
            return jsonify({'success': False, 'error': '分类不存在'})
        
        knowledge_ids = graph['categories'][category]['knowledge_ids']
        
        if not knowledge_ids:
            return jsonify({'success': False, 'error': '该分类下没有知识'})
        
        # 构建知识标题列表
        prompt = prompts.build_knowledge_category_index_prompt(category, knowledge_ids)
        
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

    if not _is_knowledge_vectorization_enabled():
        return _knowledge_vector_unavailable_response()

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


@app.route('/api/knowledge/vector/status', methods=['GET'])
@require_login
def get_knowledge_vector_status():
    """获取知识库向量化能力状态。"""
    payload = _knowledge_vector_status_payload()
    payload['success'] = True
    return jsonify(payload)


@app.route('/api/knowledge/vector/config', methods=['GET'])
@require_login
def get_vector_config():
    """获取向量配置"""
    status = _knowledge_vector_status_payload()
    return jsonify({
        'success': True,
        'enabled': bool(status.get('enabled')),
        'vectorization_enabled': bool(status.get('vectorization_enabled')),
        'reason': status.get('reason') or '',
        'mode': status.get('mode') or '',
        'chunk_size': int(status.get('chunk_size') or 800),
        'chunk_overlap': int(status.get('chunk_overlap') or 120)
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

    if not _is_knowledge_vectorization_enabled():
        return _knowledge_vector_unavailable_response()

    if not title or text is None:
        return jsonify({'success': False, 'message': '缺少标题或文本'}), 400

    store, store_err = get_chroma_store()
    if not store:
        return jsonify({'success': False, 'message': f'NexoraDB不可用: {store_err}'}), 503
    if getattr(store, 'mode', '') != 'service':
        return _knowledge_vector_unavailable_response('NexoraDB service mode required')

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
        return jsonify({'success': False, 'message': '缺少查询文本'}), 400

    if not _is_knowledge_vectorization_enabled():
        return _knowledge_vector_unavailable_response('知识向量查询未启用或未配置')

    store, store_err = get_chroma_store()
    if not store:
        return jsonify({'success': False, 'message': f'NexoraDB不可用: {store_err}'}), 503

    try:
        if getattr(store, 'mode', '') != 'service':
            return _knowledge_vector_unavailable_response('NexoraDB service mode not available')
        result = store.query_text(
            username,
            query_text,
            top_k=top_k,
            library=library
        )
        return jsonify({'success': True, 'result': result})
    except Exception as e:
        return jsonify({'success': False, 'message': f'NexoraDB查询失败: {str(e)}'}), 500


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


@app.route('/api/knowledge/vector/titles/<path:title>', methods=['DELETE'])
@app.route('/api/knowledge/vector/chunks/<path:vector_id>', methods=['DELETE'])
@app.route('/api/knowledge/vector/delete', methods=['POST'])
@require_login
def delete_knowledge_vectors(title=None, vector_id=None):
    """删除知识点的向量数据"""
    username = session['username']
    data = request.get_json(silent=True) or {}
    title = title or data.get('title')
    vector_id = vector_id or data.get('vector_id')
    library = _normalize_vector_library(data.get('library') or request.args.get('library'), default='knowledge')

    if not title and not vector_id:
        return jsonify({'success': False, 'message': '缺少标题或向量ID'}), 400

    if not _is_knowledge_vectorization_enabled():
        return _knowledge_vector_unavailable_response()

    store, store_err = get_chroma_store()
    if not store:
        return jsonify({'success': False, 'message': f'NexoraDB不可用: {store_err}'}), 503
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
        return jsonify_safe({'success': False, 'message': 'missing title'}), 400

    if not _is_knowledge_vectorization_enabled():
        return _knowledge_vector_unavailable_response()

    store, store_err = get_chroma_store()
    if not store:
        return jsonify_safe({'success': False, 'message': f'NexoraDB unavailable: {store_err}'}), 503
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

from App.Agent import handle_agent_result


@sock.route('/ws/public/knowledge/<username>/<share_id>')
def public_knowledge_socket(ws, username, share_id):
    user, title, meta, err = _resolve_public_collab_basis(username, share_id)
    if err is not None:
        try:
            ws.send(json.dumps({'type': 'error', 'message': 'Forbidden'}, ensure_ascii=False))
        except Exception:
            pass
        return

    owner = str(user.user or username or '').strip()
    safe_share_id = str(share_id or '').strip()
    room = _public_knowledge_ws_room(owner, safe_share_id)
    client_id = uuid.uuid4().hex

    if not room:
        try:
            ws.send(json.dumps({'type': 'error', 'message': 'invalid room'}, ensure_ascii=False))
        except Exception:
            pass
        return

    client = {
        'ws': ws,
        'lock': threading.Lock(),
        'connected_at': int(time.time()),
        'owner_username': owner,
        'share_id': safe_share_id,
        'title': str(title or '').strip(),
    }

    with _PUBLIC_KNOWLEDGE_WS_LOCK:
        _PUBLIC_KNOWLEDGE_WS_CLIENTS.setdefault(room, {})[client_id] = client

    _send_public_knowledge_ws_client(client, 'public_knowledge_ready', {
        'client_id': client_id,
        'owner_username': owner,
        'share_id': safe_share_id,
        'title': str(title or '').strip(),
    })

    try:
        while True:
            raw = ws.receive()

            if raw is None:
                break

            try:
                data = json.loads(raw) if raw else {}
            except Exception:
                data = {}

            msg_type = str(data.get('type') or '').strip()

            if msg_type == 'ping':
                _send_public_knowledge_ws_client(client, 'pong', {'client_id': client_id})
            elif msg_type == 'sync_knowledge':
                live_user, live_title, live_meta, live_err = _resolve_public_collab_basis(owner, safe_share_id)

                if live_err is not None:
                    _send_public_knowledge_ws_client(client, 'public_knowledge_closed', {
                        'message': '该协作链接已关闭或权限已变更',
                    })
                    break

                live_content = live_user.getBasisContent(live_title)
                live_payload = _build_knowledge_version_payload(live_title, live_meta, live_content)
                _send_public_knowledge_ws_client(client, 'knowledge_state', {
                    'owner_username': owner,
                    'share_id': safe_share_id,
                    'title': live_title,
                    **live_payload,
                })

    except Exception as e:
        print(f"[Public Knowledge WSS] disconnected owner={owner} share_id={safe_share_id} client={client_id}: {e}")
    finally:
        _drop_public_knowledge_ws_client(room, client_id)


@sock.route('/ws/knowledge/collab/<username>/<share_id>')
def knowledge_collab_socket(ws, username, share_id):
    user, title, meta, err = _resolve_public_collab_basis(username, share_id)

    if err is not None:
        try:
            ws.send(json.dumps({'type': 'error', 'message': 'Forbidden'}, ensure_ascii=False))
        except Exception:
            pass

        return

    owner = str(user.user or username or '').strip()
    safe_share_id = str(share_id or '').strip()
    role = str(request.args.get('role') or 'public').strip().lower()
    display_name = str(request.args.get('display_name') or '').strip()

    if role not in {'owner', 'public'}:
        role = 'public'

    if role == 'owner':
        session_username = str(session.get('username') or '').strip()

        if session_username != owner:
            role = 'public'

    if role == 'public' and not display_name:
        display_name = '匿名协作者'

    if role == 'owner' and not display_name:
        display_name = owner

    content = user.getBasisContent(title)

    def save_collab_content(next_content: str) -> Dict[str, Any]:
        save_user = User(owner)
        success, msg = save_user.updateBasisContent(
            title,
            next_content,
            timeline_actor=display_name or role or 'knowledge_collab',
        )

        if not success:
            print(
                "[KnowledgeCollab] flush failed "
                f"owner={owner} share_id={safe_share_id} title={title} message={msg}"
            )
            return {'success': False, 'message': str(msg or '保存失败')}

        payload = _knowledge_update_response_payload(title, msg, next_content, save_user)
        _publish_knowledge_changed_event(
            owner,
            title,
            payload,
            source='knowledge_collab_flush',
            actor_username=display_name or role or 'knowledge_collab',
            share_id=safe_share_id,
            content=next_content,
        )
        return payload

    try:
        _KNOWLEDGE_COLLAB_HUB.attach_client(
            ws,
            owner_username=owner,
            share_id=safe_share_id,
            title=title,
            content=content,
            role=role,
            display_name=display_name,
            save_callback=save_collab_content,
        )
    except Exception as e:
        print(
            "[KnowledgeCollab] socket disconnected "
            f"owner={owner} share_id={safe_share_id} title={title}: {e}"
        )


@sock.route('/ws/browser')
def browser_sync_socket(ws):
    username = str(session.get('username') or '').strip()
    client_id = uuid.uuid4().hex

    if not username:
        ws.send(json.dumps({'type': 'error', 'message': 'Unauthorized'}, ensure_ascii=False))
        return

    client = {
        'ws': ws,
        'lock': threading.Lock(),
        'username': username,
        'client_id': client_id,
        'connected_at': int(time.time()),
    }

    with _BROWSER_WS_LOCK:
        _BROWSER_WS_CLIENTS.setdefault(username, {})[client_id] = client

    _log_browser_ws_runtime('connected', {
        'username': username,
        'client_id': client_id,
    })

    _send_browser_ws_client(client, 'browser_ready', {
        'client_id': client_id,
        'username': username,
    })
    try:
        _send_browser_ws_client(client, 'model_config_state', build_models_config_sync_state())
    except Exception as e:
        print(f"[Browser WSS] model sync state failed username={username} client={client_id}: {e}")

    _send_browser_ws_client(client, 'agent_status', {
        'online': is_agent_online(username),
        'source': 'browser_connect',
    })

    try:
        while True:
            raw = ws.receive()

            if raw is None:
                break

            try:
                data = json.loads(raw) if raw else {}
            except Exception:
                data = {}

            msg_type = str(data.get('type') or '').strip()

            if msg_type == 'ping':
                _send_browser_ws_client(client, 'pong', {'client_id': client_id})
            elif msg_type == 'subscribe_conversation':
                conversation_id = str(data.get('conversation_id') or '').strip()

                with _BROWSER_WS_LOCK:
                    current_client = (_BROWSER_WS_CLIENTS.get(username) or {}).get(client_id)

                    if current_client is not None:
                        current_client['conversation_id'] = conversation_id
            elif msg_type == 'sync_model_config':
                try:
                    sync_state = build_models_config_sync_state()
                    client_version = str(data.get('version') or '').strip()
                    server_version = str(sync_state.get('version') or '').strip()

                    if client_version != server_version:
                        _send_browser_ws_client(client, 'model_config_changed', {
                            **sync_state,
                            'source': 'browser_sync_poll',
                        })
                except Exception as e:
                    print(f"[Browser WSS] model sync failed username={username} client={client_id}: {e}")
                    _send_browser_ws_client(client, 'model_config_sync_error', {
                        'message': str(e),
                    })
            elif msg_type == 'subscribe_ollama_status':
                provider_names = _normalize_browser_ollama_provider_names(data.get('providers', []))
                provider_keys = {
                    _normalize_browser_ollama_provider_key(provider_name)
                    for provider_name in provider_names
                    if _normalize_browser_ollama_provider_key(provider_name)
                }

                with _BROWSER_WS_LOCK:
                    current_client = (_BROWSER_WS_CLIENTS.get(username) or {}).get(client_id)

                    if current_client is not None:
                        current_client['ollama_providers'] = provider_keys

                if provider_names:
                    _ensure_browser_ollama_status_loop_started()
                    _send_browser_ollama_status_to_client(client, provider_names)
                    _request_browser_ollama_status_refresh(
                        provider_names,
                        source='browser_subscribe',
                        force=bool(data.get('force', False))
                    )
            elif msg_type == 'sync_ollama_status':
                provider_names = _normalize_browser_ollama_provider_names(data.get('providers', []))

                if provider_names:
                    _ensure_browser_ollama_status_loop_started()
                    _send_browser_ollama_status_to_client(client, provider_names)
                    _request_browser_ollama_status_refresh(
                        provider_names,
                        source='browser_sync',
                        force=bool(data.get('force', False))
                    )

    except Exception as e:
        _log_browser_ws_runtime('receive_failed', {
            'username': username,
            'client_id': client_id,
            'error': repr(e),
        })
        print(f"[Browser WSS] disconnected username={username} client={client_id}: {e}")
    finally:
        _log_browser_ws_runtime('disconnected', {
            'username': username,
            'client_id': client_id,
        })
        _drop_browser_ws_client(username, client_id)


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
        registered_tools = []
        agent_info = _LOCAL_AGENTS.get(token)
        if agent_info:
            username = agent_info.get("username")
            registered_tools = agent_info.get("tools") if isinstance(agent_info.get("tools"), list) else []
             
        if not username:
            ws.send(json.dumps({'error': 'Invalid or unregistered agent_token'}))
            return
             
        # Auth ok
        register_agent(username, ws)

        if registered_tools:
            update_agent_tools(username, registered_tools)

        ws.send(json.dumps({'type': 'auth_ok', 'tool_count': len(registered_tools)}))
        print(
            f"[NexoraCode WSS] auth username={username} "
            f"preloaded_tool_count={len(registered_tools)}"
        )
        
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
                elif ctype == 'sync_prompt':
                    custom_prompt = payload.get('prompt', '')
                    update_agent_prompt(username, custom_prompt)
                    ws.send(json.dumps({'type': 'prompt_synced'}))
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


from App.Papi import papi_bp
from App.Papi import user_papi_keys_bp
# 用户域路由装配：注入依赖后挂载自 basis.User 迁出的蓝图
configure_user_routes(BASE_DIR, get_config_all, get_public_base_url)
configure_user_admin_routes(get_config_all)
from basis.TokenUsage.routes import _normalize_quota_on_exhausted_action, configure_quota_admin_routes, quota_admin_bp
from App.Storage.routes import configure_storage_admin_routes, storage_admin_bp
from App.Search.admin_routes import configure_search_admin_routes, search_admin_bp
from App.GenImage import configure_gen_image_admin_routes, gen_image_admin_bp
from App.Core.context_window import (
    _normalize_provider_api_type,
    _normalize_keep_alive_value,
    MODEL_CONTEXT_WINDOW_KEYS,
    _parse_model_context_window_for_save,
    _normalize_model_id_for_ctx,
    _extract_context_window_from_provider_row,
    _build_provider_models_context_diagnostics,
    _refresh_volc_context_window_map,
    _refresh_aliyun_context_window_map,
    _refresh_ollama_context_window_map,
    _refresh_generic_context_window_maps,
    _normalize_context_refresh_mode,
    _resolve_context_window_maps_for_config,
    _resolve_context_window_by_model_id,
    _resolve_volc_context_window_by_model_id,
    _resolve_aliyun_context_window_by_model_id,
)
from App.Papi.admin_keys import configure_papi_admin_keys, papi_admin_bp
from App.Papi.admin_keys import (
    _list_papi_key_records,
    _migrate_legacy_public_api_key,
    _migrate_papi_key_scope_schema,
    resolve_public_api_key_auth,
)
from Map.routes import configure_map_config_routes, map_config_bp
import App.Mail.admin_routes
import basis.User.admin_routes

app.register_blueprint(user_bp)
app.register_blueprint(papi_bp)
app.register_blueprint(user_papi_keys_bp)
from App.Files import files_bp
app.register_blueprint(files_bp)
from App.Workspace import workspace_bp
app.register_blueprint(workspace_bp)
from App.Observability import configure_notification_realtime, notification_bp
from App.Observability.stats import stats_bp
from App.Mail import _get_nexora_mail_config, _mail_cache_invalidate_all_users, _mail_cache_invalidate_user, configure_mail_client, mail_bp
configure_notification_realtime(_send_browser_event_to_user)
app.register_blueprint(notification_bp)
app.register_blueprint(stats_bp)

# 邮件域装配：配置访问、实时事件发布、HTTP 客户端均由本组装层注入
configure_mail_client(get_config_all, _publish_mail_event_for_users, _nexora_mail_call)
app.register_blueprint(mail_bp)

# 配额与地图配置装配：模型恢复逻辑与主配置读写由本组装层注入
configure_quota_admin_routes(_recover_quota_disabled_models)
app.register_blueprint(quota_admin_bp)
configure_map_config_routes(ensure_main_config_defaults, save_main_config, DEFAULT_MAIN_CONFIG.get('map_service', {}))
app.register_blueprint(map_config_bp)

# 向量库 / 搜索 / 生图配置装配：主配置读写与向量库单例由本组装层注入
configure_storage_admin_routes(get_config_all, get_chroma_store)
app.register_blueprint(storage_admin_bp)
configure_search_admin_routes(ensure_main_config_defaults, save_main_config)
app.register_blueprint(search_admin_bp)
configure_gen_image_admin_routes(ensure_main_config_defaults, save_main_config)
app.register_blueprint(gen_image_admin_bp)

# PAPI 密钥装配：密钥文件路径与主配置读写由本组装层注入
configure_context_window_fetchers(_fetch_aliyun_models_page, _fetch_volc_foundation_models_context_map)
configure_papi_admin_keys(PAPI_KEYS_PATH, ensure_main_config_defaults, save_main_config)
app.register_blueprint(papi_admin_bp)
from App.Agent import agent_permissions_bp
app.register_blueprint(agent_permissions_bp)
from App.Collaboration import global_search_bp
app.register_blueprint(global_search_bp)
from App.Observability import create_testapi_blueprint
app.register_blueprint(create_testapi_blueprint(require_admin))


@app.route('/new')
def new_frontend_page():
    """新前端(第 0 期骨架)入口页

    直接返回前端构建产物 static/new/index.html;
    登录态由前端自身守卫处理(未登录跳转 #/login),后端不做重定向。
    """
    new_index = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'new', 'index.html')

    try:
        with open(new_index, 'r', encoding='utf-8') as f:
            resp = Response(f.read(), mimetype='text/html')

            # 入口页禁止缓存:产物文件名带 hash,但 index.html 若被缓存会引用已不存在的旧资产
            resp.headers['Cache-Control'] = 'no-cache'

            return resp
    except Exception:
        return jsonify({'success': False, 'message': '新前端尚未构建,请先执行前端构建'}), 404


if __name__ == '__main__':
    # 确保必要的目录存在
    os.makedirs('./templates', exist_ok=True)
    os.makedirs('./static/css', exist_ok=True)
    os.makedirs('./static/js', exist_ok=True)
    
    # 从配置文件读取端口
    config = ensure_main_config_defaults()
    port = int(config.get('port', 5000) or 5000)
    debug = bool(config.get('debug', False))
    log_file = init_run_logger({'data_dir': DATA_DIR}, service_name='ChatDB')
    
    print("[ChatDB] Web Server Starting...")
    print(f"[ChatDB] URL: http://localhost:{port}")
    print(f"[ChatDB] Log: {log_file}")
    print("[ChatDB] Press Ctrl+C to stop")

    if (not debug) or os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        start_nexora_mail_event_stream()
        # 进程启动时即预热服务状态监控，避免首个 HTTP 请求触发同步探测而被堵塞
        try:
            start_service_status_monitor()
        except Exception as exc:
            print(f"[ServiceStatusMonitor] pre-start failed: {exc}")
    
    app.run(debug=debug, host='0.0.0.0', port=port, threaded=True)
