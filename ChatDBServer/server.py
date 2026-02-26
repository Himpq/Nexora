"""
ChatDB Web Server - Flask应用
提供Web界面的聊天和知识库管理功能
"""
import os
import sys
import json
import base64
import binascii
from copy import deepcopy
from urllib import request as urllib_request, error as urllib_error, parse as urllib_parse
from email.header import Header
from flask import Flask, render_template, request, jsonify, session, redirect, url_for, Response, send_file
from flask_cors import CORS
from datetime import timedelta, datetime
import time

# 添加api目录到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'api'))
from model import Model
from database import User
from conversation_manager import ConversationManager
from chroma_client import ChromaStore

app = Flask(__name__)
app.secret_key = 'chatdb-secret-key-change-in-production'
app.config['SESSION_TYPE'] = 'filesystem'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)
CORS(app)

# 切换到正确的工作目录
os.chdir(os.path.dirname(os.path.abspath(__file__)))


# ==================== 配置与全局变量 ====================

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
MODELS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models.json')
USERS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'user.json')

DEFAULT_MAIN_CONFIG = {
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

    return {
        'enabled': bool(mail_cfg.get('nexora_mail_enabled', False)),
        'service_url': service_url,
        'api_key': str(mail_cfg.get('api_key', '') or '').strip(),
        'timeout': timeout,
        'default_group': str(mail_cfg.get('default_group', 'default') or 'default').strip() or 'default',
        'host': host,
        'port': port
    }


def _nexora_mail_call(path, method='GET', payload=None, query=None):
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
    try:
        with urllib_request.urlopen(req, timeout=cfg['timeout']) as resp:
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
    """首页 - 重定向到聊天或登录"""
    if 'username' in session:
        return redirect(url_for('chat', **request.args))
    return redirect(url_for('login'))


@app.route('/login', methods=['GET', 'POST'])
def login():
    """登录页面"""
    if request.method == 'GET':
        return render_template('login.html')
    
    # POST - 处理登录
    data = request.get_json()
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
    return redirect(url_for('login'))


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

    q = (request.args.get('q') or '').strip()
    offset = max(int(request.args.get('offset', 0) or 0), 0)
    limit = min(max(int(request.args.get('limit', 50) or 50), 1), 200)
    path = f"/api/mailboxes/{urllib_parse.quote(binding['group'])}/{urllib_parse.quote(binding['mail_username'])}/mails"
    ok, status, data = _nexora_mail_call(path, method='GET', query={'q': q, 'offset': offset, 'limit': limit})
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '读取收件箱失败'), 'upstream': data}), status

    return jsonify({
        'success': True,
        'group': binding['group'],
        'mail_username': binding['mail_username'],
        'local_mail': binding['local_mail'],
        'total': data.get('total', 0),
        'unread_total': data.get('unread_total', 0),
        'offset': data.get('offset', offset),
        'limit': data.get('limit', limit),
        'mails': data.get('mails', [])
    })


@app.route('/api/mail/me/sent', methods=['GET'])
@require_login
def mail_me_sent():
    """当前用户发件箱列表"""
    binding, err = _resolve_current_user_mail_binding()
    if err:
        return jsonify({'success': False, 'message': err[0]}), err[1]

    q = (request.args.get('q') or '').strip()
    offset = max(int(request.args.get('offset', 0) or 0), 0)
    limit = min(max(int(request.args.get('limit', 50) or 50), 1), 200)
    path = f"/api/mailboxes/{urllib_parse.quote(binding['group'])}/{urllib_parse.quote(binding['mail_username'])}/sent"
    ok, status, data = _nexora_mail_call(path, method='GET', query={'q': q, 'offset': offset, 'limit': limit})
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '读取发件箱失败'), 'upstream': data}), status

    return jsonify({
        'success': True,
        'group': binding['group'],
        'mail_username': binding['mail_username'],
        'local_mail': binding['local_mail'],
        'total': data.get('total', 0),
        'offset': data.get('offset', offset),
        'limit': data.get('limit', limit),
        'mails': data.get('mails', [])
    })


@app.route('/api/mail/me/inbox/<mail_id>', methods=['GET'])
@require_login
def mail_me_inbox_item(mail_id):
    """当前用户读取单封邮件详情"""
    binding, err = _resolve_current_user_mail_binding()
    if err:
        return jsonify({'success': False, 'message': err[0]}), err[1]

    path = f"/api/mailboxes/{urllib_parse.quote(binding['group'])}/{urllib_parse.quote(binding['mail_username'])}/mails/{urllib_parse.quote(str(mail_id))}"
    ok, status, data = _nexora_mail_call(path, method='GET')
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '读取邮件失败'), 'upstream': data}), status
    return jsonify({
        'success': True,
        'group': binding['group'],
        'mail_username': binding['mail_username'],
        'mail': data.get('mail', {})
    })


@app.route('/api/mail/me/sent/<mail_id>', methods=['GET'])
@require_login
def mail_me_sent_item(mail_id):
    """当前用户读取单封发件详情"""
    binding, err = _resolve_current_user_mail_binding()
    if err:
        return jsonify({'success': False, 'message': err[0]}), err[1]

    path = f"/api/mailboxes/{urllib_parse.quote(binding['group'])}/{urllib_parse.quote(binding['mail_username'])}/sent/{urllib_parse.quote(str(mail_id))}"
    ok, status, data = _nexora_mail_call(path, method='GET')
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '读取发件失败'), 'upstream': data}), status
    return jsonify({
        'success': True,
        'group': binding['group'],
        'mail_username': binding['mail_username'],
        'mail': data.get('mail', {})
    })


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
    subject = _repair_common_mojibake(subject)
    subject_header = str(Header(subject, 'utf-8'))
    content = payload.get('content')
    is_html = bool(payload.get('is_html', False))

    if not recipient:
        return jsonify({'success': False, 'message': '收件人不能为空'}), 400
    if content is None:
        content = ''
    content = str(content)
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
        'subject': subject
    }

    if is_html:
        send_body['raw'] = (
            f"From: <{sender}>\r\n"
            f"To: <{recipient}>\r\n"
            f"Subject: {subject_header}\r\n"
            "MIME-Version: 1.0\r\n"
            "Content-Type: text/html; charset=\"UTF-8\"\r\n"
            "\r\n"
            f"{content}\r\n"
        )
    else:
        send_body['content'] = content

    ok, status, data = _nexora_mail_call('/api/send', method='POST', payload=send_body)
    if not ok:
        return jsonify({'success': False, 'message': data.get('message', '发送失败'), 'upstream': data}), status

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
    """上传文件"""
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': '没有文件'}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'message': '未选择文件'}), 400
        
    try:
        filename = file.filename
        suffix = os.path.splitext(filename)[1].lower()
        
        # VolcEngine File API 支持的格式 (图像, 视频, PDF)
        # 遇到 JSON/TXT 等纯文本文件，File API 会报错，因此我们在服务端转为文本内容返回
        VOLC_SUPPORTED_EXTS = {
            '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff',
            '.pdf',
            '.mp4', '.mov', '.avi', '.webm', '.mkv', '.flv'
        }
        
        # 1. 如果是不支持直接上传的格式，尝试读取为文本
        if suffix not in VOLC_SUPPORTED_EXTS:
            try:
                content = file.read().decode('utf-8')
                return jsonify({
                    'success': True,
                    'type': 'text',
                    'content': content,
                    'filename': filename,
                    'message': '已解析为文本内容'
                })
            except UnicodeDecodeError:
                return jsonify({'success': False, 'message': '不支持的二进制文件格式'}), 400
            except Exception as e:
                return jsonify({'success': False, 'message': f'文件解析失败: {str(e)}'}), 500

        # 2. 支持的格式，上传到 VolcEngine
        # 保存到临时文件
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            file.save(tmp.name)
            tmp_path = tmp.name
            
        try:
            # 初始化模型并上传
            model = Model(session['username'], auto_create=False)
            file_obj = model.upload_file(tmp_path)
            
            # 返回文件ID和名称
            return jsonify({
                'success': True,
                'type': 'file', 
                'file_id': file_obj.id,
                'filename': filename,
                'message': '上传成功'
            })
        finally:
            # 清理临时文件
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except:
                    pass
                
    except Exception as e:
        print(f"[ERROR] Upload failed: {e}")
        return jsonify({'success': False, 'message': f'上传失败: {str(e)}'}), 500


@app.route('/api/conversations', methods=['GET'])
@require_login
def list_conversations():
    """获取对话列表"""
    username = session['username']
    manager = ConversationManager(username)
    conversations = manager.list_conversations()
    return jsonify({'success': True, 'conversations': conversations})


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
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "Failed to delete"}), 500


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
        blacklist_path = './data/model_permissions.json'
        blacklist = []
        if os.path.exists(blacklist_path):
            with open(blacklist_path, 'r', encoding='utf-8') as f:
                perm_config = json.load(f)
                user_blacklists = perm_config.get('user_blacklists', {})
                blacklist = user_blacklists.get(username, perm_config.get('default_blacklist', []))

        config = get_config_all()

        models_info = []
        for model_id, info in config.get('models', {}).items():
            if model_id in blacklist:
                continue
            models_info.append({
                'id': model_id,
                'name': info.get('name', model_id),
                'provider': info.get('provider', 'volcengine'),
                'status': info.get('status', 'normal')
            })

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

        models[model_id] = {
            'name': name or model_id,
            'provider': provider,
            'status': status or 'normal'
        }
        save_models_config(cfg)
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
    show_token_usage = data.get('show_token_usage', False)
    
    # 重新生成标志
    is_regenerate = data.get('is_regenerate', False)
    regenerate_index = data.get('regenerate_index')
    
    if not message and not is_regenerate:
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
                show_token_usage=show_token_usage,
                is_regenerate=is_regenerate,
                regenerate_index=regenerate_index
            ):
                if log_all_chunks:
                    _log_stream_chunk(chunk, model_name=model_name or model.model_name)
                # 关键修复：添加 default=str 作为最后的保险，防止任何遗漏的 SDK 对象导致 JSON 序列化失败
                chunk_data = json.dumps(chunk, ensure_ascii=False, default=str)
                yield f"data: {chunk_data}\n\n"
                time.sleep(0.01)  # 小延迟避免过快
            
        except Exception as e:
            error_data = json.dumps({
                'type': 'error',
                'content': f'处理消息时出错: {str(e)}'
            }, ensure_ascii=False)
            yield f"data: {error_data}\n\n"
    
    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/tokens/stats', methods=['GET'])
@require_login
def get_token_stats():
    """获取Token使用统计"""
    username = session['username']
    user = User(username)
    
    try:
        logs = user.get_token_logs()
        
        total_tokens = 0
        today_tokens = 0
        
        # Calculate stats
        today_str = time.strftime("%Y-%m-%d", time.localtime())
        
        for log in logs:
            total_tokens += log.get('total_tokens', 0)
            if log.get('timestamp', '').startswith(today_str):
                today_tokens += log.get('total_tokens', 0)
                
        return jsonify({
            'success': True,
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
        basis_knowledge = user.getKnowledgeList(1)  # 基础知识
        
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
        for title in knowledge_list:
            content = user.getBasisContent(title)
            result.append({
                'title': title,
                'content': content
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
        base_url = request.host_url.rstrip('/')
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
        base_url = request.host_url.rstrip('/')
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
        # 通过title找到索引
        short_list = user.getKnowledgeList(0)
        if title in short_list:
            idx = short_list.index(title)
            user.removeShort(idx)
            return jsonify({'success': True, 'message': '删除成功'})
        else:
            return jsonify({'success': False, 'error': '未找到该记忆'})
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
    # Vectorize and store (auto chunking)
    username = session['username']
    user = User(username)
    data = request.get_json()
    
    title = data.get('title')
    text = data.get('text')
    metadata = data.get('metadata') or {}
    
    if not text:
        # If text is missing, try to load from knowledge base
        if title:
            text = user.getBasisContent(title)
        else:
            return jsonify({'success': False, 'message': '文本为空'})

    def split_text(t, max_len=800, overlap=120):
        if not t:
            return []
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
            chunk = t[start:end]
            chunks.append(chunk)
            if end == length:
                break
            start = end - overlap if overlap > 0 else end
        return chunks
            
    try:
        config = get_config_all()
        rag = config.get('rag_database', {})
        chunk_size = int(rag.get('chunk_size') or 800)
        chunk_overlap = int(rag.get('chunk_overlap') or 120)

        chunks = split_text(text, chunk_size, chunk_overlap)
        if not chunks:
            return jsonify({'success': False, 'message': '文本为空'})
        
        store, store_err = get_chroma_store()
        if not store:
            return jsonify({'success': False, 'message': f'ChromaDB错误: {store_err}'})
        if getattr(store, 'mode', '') != 'service':
            return jsonify({'success': False, 'message': 'NexoraDB service mode required'})

        stored = False
        stored_count = 0
        doc_ids = []

        if title:
            try:
                store.delete_by_title(username, title)
            except Exception:
                pass

        try:
            for i, chunk in enumerate(chunks):
                chunk_meta = dict(metadata)
                chunk_meta.update({
                    'chunk_id': i,
                    'chunk_total': len(chunks)
                })
                doc_id = store.upsert_text(
                    username,
                    title,
                    chunk,
                    chunk_meta,
                    chunk_id=i
                )
                doc_ids.append(doc_id)
                stored_count += 1
            stored = stored_count == len(chunks)
        except Exception as e:
            return jsonify({'success': False, 'message': f'存储失败: {str(e)}'})
        
        return jsonify({
            'success': True, 
            'chunk_count': len(chunks),
            'stored': stored,
            'stored_count': stored_count,
            'vector_length': 0,
            'vector_preview': [],
            'vector_ids': doc_ids,
            'store_error': None if stored else 'store error',
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
        doc_id = store.upsert_text(username, title, text, chunk_meta, chunk_id=chunk_id)
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
        result = store.query_text(username, query_text, top_k=top_k)
        return jsonify({'success': True, 'result': result})
    except Exception as e:
        return jsonify(_keyword_fallback_payload(f'NexoraDB query failed: {str(e)}'))


@app.route('/api/knowledge/vector/delete', methods=['POST'])
@require_login
def delete_knowledge_vectors():
    """删除知识点的向量数据"""
    username = session['username']
    data = request.get_json() or {}
    title = data.get('title')
    vector_id = data.get('vector_id')
    if not title and not vector_id:
        return jsonify({'success': False, 'message': '缺少标题或向量ID'})

    store, store_err = get_chroma_store()
    if not store:
        return jsonify({'success': False, 'message': f'ChromaDB错误: {store_err}'})
    try:
        if vector_id:
            store.delete_by_id(username, vector_id)
        else:
            store.delete_by_title(username, title)
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
    if not title:
        return jsonify_safe({'success': False, 'message': 'missing title'})

    store, store_err = get_chroma_store()
    if not store:
        return jsonify_safe({'success': False, 'message': f'ChromaDB unavailable: {store_err}'})
    try:
        chunks = store.get_chunks(username, title)
        return jsonify_safe({'success': True, 'chunks': chunks})
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


# ==================== 启动服务器 ====================

if __name__ == '__main__':
    # 确保必要的目录存在
    os.makedirs('./templates', exist_ok=True)
    os.makedirs('./static/css', exist_ok=True)
    os.makedirs('./static/js', exist_ok=True)
    
    print("🚀 ChatDB Web Server Starting...")
    print("📍 访问地址: http://localhost:5000")
    print("💡 使用 Ctrl+C 停止服务器")
    
    app.run(debug=True, host='0.0.0.0', port=5000, threaded=True)


