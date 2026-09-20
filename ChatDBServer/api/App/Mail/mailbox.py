"""
Nexora.App.Mail.mailbox — NexoraMail 客户端封装与 /api/mail/me/* 路由
（自 server.py 分批迁移）

组装契约：server 组装期经 configure_mail_client() 注入三个依赖——
- get_config_all:              配置访问函数（含迁移钩子的 server 侧包装）
- publish_mail_event_for_users: 邮件实时事件发布（复用 server 的浏览器 WS 通道）
- mail_call:                   NexoraMail HTTP 客户端（urllib 出口收敛在
  server 层，目标是管理端配置的自托管内网服务）
未装配即处理请求视为组装顺序错误，本模块不设兜底默认值，不反向 import server。
"""

import base64
import json
import os
import re
import threading
import time
from email.header import Header
from email.utils import formatdate, make_msgid
from pathlib import Path
from urllib import parse as urllib_parse

from flask import Blueprint, jsonify, request, session

from App.Utils import safe_join_path
from basis.Permission import require_login
from basis.User import load_users
from basis.User.routes import get_local_mail_profile

mail_bp = Blueprint('mail', __name__)

# 与 server.py 顶部常量同源（ChatDBServer 根 = 本文件向上 3 级：App/Mail/mailbox.py）
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

_get_config_all = None
_publish_mail_event_for_users = None
_nexora_mail_call = None


def configure_mail_client(get_config_all, publish_mail_event_for_users, mail_call):
    """
    server 组装期注入依赖（仅允许调用一次）。

    get_config_all:               配置访问函数（含迁移钩子的 server 侧包装）
    publish_mail_event_for_users: 邮件实时事件发布函数（复用 server 的浏览器 WS 通道）
    mail_call:                    NexoraMail HTTP 客户端 (ok, status, data)
    """
    global _get_config_all, _publish_mail_event_for_users, _nexora_mail_call

    if _get_config_all is not None:
        raise RuntimeError('mail client already configured')

    _get_config_all = get_config_all
    _publish_mail_event_for_users = publish_mail_event_for_users
    _nexora_mail_call = mail_call


def call_nexora_mail(*args, **kwargs):
    """调用当前已装配的 NexoraMail HTTP 客户端。"""
    return _nexora_mail_call(*args, **kwargs)


# ==================== NexoraMail 配置 ====================

def _get_nexora_mail_config():
    cfg = _get_config_all()
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


# ==================== 用户级邮件缓存 ====================

_MAIL_CACHE_LOCKS = {}
_MAIL_CACHE_LOCKS_GUARD = threading.Lock()


def _get_mail_cache_lock(user_id):
    uid = str(user_id or '').strip()
    with _MAIL_CACHE_LOCKS_GUARD:
        if uid not in _MAIL_CACHE_LOCKS:
            _MAIL_CACHE_LOCKS[uid] = threading.Lock()
        return _MAIL_CACHE_LOCKS[uid]


def _mail_cache_file_path(user_id):
    uid = str(user_id or '').strip()

    # uid 直接拼入目录路径，显式拒绝路径分隔符与相对路径标记
    if not uid or '/' in uid or '\\' in uid or uid in ('.', '..'):
        raise ValueError(f'invalid mail cache user id: {uid!r}')

    return safe_join_path(BASE_DIR, 'data', 'users', uid, 'mail_cache.json')


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
        data = json.loads(Path(path).read_text(encoding='utf-8'))
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
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')


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


def _mail_cache_invalidate_all_users() -> int:
    users = load_users()

    if not isinstance(users, dict):
        return 0

    invalidated_count = 0

    for user_id in users.keys():
        _mail_cache_invalidate_user(user_id)
        invalidated_count += 1

    return invalidated_count


# ==================== 发件地址与文本修复 ====================

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
    suspicious = ('鎴', '馃', '锛', '锟', '\ufffd', '鏄', '鍐', '涓', '鐨')
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


# ==================== /api/mail/me/* 路由（B-C1 批次迁入） ====================

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


@mail_bp.route('/api/mail/me/status', methods=['GET'])
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


@mail_bp.route('/api/mail/me/inbox', methods=['GET'])
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


@mail_bp.route('/api/mail/me/sent', methods=['GET'])
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


@mail_bp.route('/api/mail/me/inbox/<mail_id>', methods=['GET'])
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


@mail_bp.route('/api/mail/me/sent/<mail_id>', methods=['GET'])
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


@mail_bp.route('/api/mail/me/inbox/<mail_id>/read', methods=['PATCH'])
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
    _publish_mail_event_for_users([binding['user_id']], {
        'action': 'read_state_changed',
        'folder': 'inbox',
        'id': str(mail_id),
        'is_read': bool(data.get('is_read', is_read)),
        'group': binding['group'],
        'mail_username': binding['mail_username'],
    })

    return jsonify({
        'success': True,
        'id': str(mail_id),
        'is_read': bool(data.get('is_read', is_read)),
        'mail': data.get('mail', {})
    })


@mail_bp.route('/api/mail/me/inbox/<mail_id>', methods=['DELETE'])
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
    _publish_mail_event_for_users([binding['user_id']], {
        'action': 'deleted',
        'folder': 'inbox',
        'id': str(mail_id),
        'group': binding['group'],
        'mail_username': binding['mail_username'],
    })
    return jsonify({'success': True, 'id': mail_id})


@mail_bp.route('/api/mail/me/sent/<mail_id>', methods=['DELETE'])
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
    _publish_mail_event_for_users([binding['user_id']], {
        'action': 'deleted',
        'folder': 'sent',
        'id': str(mail_id),
        'group': binding['group'],
        'mail_username': binding['mail_username'],
    })
    return jsonify({'success': True, 'id': mail_id})


@mail_bp.route('/api/mail/me/send', methods=['POST'])
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
    _publish_mail_event_for_users([binding['user_id']], {
        'action': 'sent',
        'folder': 'sent',
        'group': binding['group'],
        'mail_username': binding['mail_username'],
        'sender': sender,
        'recipient': recipient,
    })

    return jsonify({
        'success': True,
        'group': binding['group'],
        'mail_username': binding['mail_username'],
        'sender': sender,
        'recipient': recipient
    })
