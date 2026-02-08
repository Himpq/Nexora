"""
ChatDB Web Server - Flask应用
提供Web界面的聊天和知识库管理功能
"""
import os
import sys
import json
from flask import Flask, render_template, request, jsonify, session, redirect, url_for, Response
from flask_cors import CORS
from datetime import timedelta
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

def get_config_all():
    """??????"""
    config = {}
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                config = json.load(f)
        except Exception as e:
            print(f"Error loading config: {e}")
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
        with open('./data/user.json', 'r', encoding='utf-8') as f:
            users = json.load(f)
        
        if username not in users:
            return jsonify({'success': False, 'message': '用户不存在'})
        
        if users[username]['password'] != password:
            return jsonify({'success': False, 'message': '密码错误'})
        
        # 更新登录IP
        users[username]['last_ip'] = request.remote_addr
        with open('./data/user.json', 'w', encoding='utf-8') as f:
            json.dump(users, f, indent=4, ensure_ascii=False)
            
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
    
    # 实时从数据库/文件读取角色，确保权限更改实时生效
    role = 'member'
    try:
        with open('./data/user.json', 'r', encoding='utf-8') as f:
            users = json.load(f)
            if username in users:
                role = users[username].get('role', 'member')
                # 同时更新 session 以保持同步
                session['role'] = role
    except Exception as e:
        print(f"Error reading user info: {e}")
        
    return jsonify({
        'success': True,
        'username': username,
        'role': role
    })


# ==================== 管理后台 API ====================

@app.route('/api/admin/users', methods=['GET'])
@require_admin
def admin_get_users():
    """获取所有用户信息"""
    try:
        with open('./data/user.json', 'r', encoding='utf-8') as f:
            users = json.load(f)
        
        user_list = []
        for uname, info in users.items():
            # 计算总 token 消耗 (从 token_usage.json 读取)
            total_tokens = 0
            # 这里我们简化一下，假设存在一个全局或用户目录下的 token_usage.json
            user_token_file = os.path.join(os.path.dirname(__file__), f"data/users/{uname}/token_usage.json")
            if os.path.exists(user_token_file):
                try:
                    with open(user_token_file, 'r', encoding='utf-8') as tf:
                        tokens = json.load(tf)
                        for log in tokens:
                            total_tokens += log.get('input_tokens', 0) + log.get('output_tokens', 0)
                except:
                    pass
            
            user_list.append({
                'username': uname,
                'password': info.get('password'), # 管理员可见密码，符合用户要求
                'role': info.get('role', 'member'),
                'last_ip': info.get('last_ip', '未知'),
                'total_token_usage': total_tokens
            })
            
        return jsonify({'success': True, 'users': user_list})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/admin/user/add', methods=['POST'])
@require_admin
def admin_add_user():
    """添加用户"""
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    role = data.get('role', 'member')
    
    if not username or not password:
        return jsonify({'success': False, 'message': '用户名和密码不能为空'})
        
    try:
        with open('./data/user.json', 'r', encoding='utf-8') as f:
            users = json.load(f)
            
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
            "password": password,
            "path": user_path,
            "role": role,
            "last_ip": "从未登录"
        }
        
        with open('./data/user.json', 'w', encoding='utf-8') as f:
            json.dump(users, f, indent=4, ensure_ascii=False)
            
        return jsonify({'success': True, 'message': '用户添加成功'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/admin/user/delete', methods=['POST'])
@require_admin
def admin_delete_user():
    """删除用户"""
    data = request.get_json()
    username = data.get('target_username')
    
    if username == session['username']:
        return jsonify({'success': False, 'message': '不能删除自己'})
        
    try:
        with open('./data/user.json', 'r', encoding='utf-8') as f:
            users = json.load(f)
            
        if username not in users:
            return jsonify({'success': False, 'message': '用户不存在'})
            
        del users[username]
        
        with open('./data/user.json', 'w', encoding='utf-8') as f:
            json.dump(users, f, indent=4, ensure_ascii=False)
            
        # 注意：此处不主动删除磁盘文件，以防操作失误（数据无价）
        return jsonify({'success': True, 'message': '用户账号已注销'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/admin/user/role', methods=['POST'])
@require_admin
def admin_set_role():
    """修改用户权限"""
    data = request.get_json()
    username = data.get('username') or data.get('target_username')
    new_role = data.get('role') # 'admin' or 'member'
    
    if not username or not new_role:
        return jsonify({'success': False, 'message': '参数不完整'})
        
    if username == session.get('username'):
        return jsonify({'success': False, 'message': '管理员不能修改自己的权限'})
        
    try:
        with open('./data/user.json', 'r', encoding='utf-8') as f:
            users = json.load(f)
            
        if username not in users:
            return jsonify({'success': False, 'message': '用户不存在'})
            
        users[username]['role'] = new_role
        
        with open('./data/user.json', 'w', encoding='utf-8') as f:
            json.dump(users, f, indent=4, ensure_ascii=False)
            
        return jsonify({'success': True, 'message': f'用户 {username} 已设为 {new_role}'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/admin/user/password', methods=['POST'])
@require_admin
def admin_set_password():
    """修改用户密码"""
    data = request.get_json()
    username = data.get('target_username')
    new_password = data.get('password')
    
    if not username or not new_password:
        return jsonify({'success': False, 'message': '参数不完整'})
        
    try:
        with open('./data/user.json', 'r', encoding='utf-8') as f:
            users = json.load(f)
            
        if username not in users:
            return jsonify({'success': False, 'message': '用户不存在'})
            
        users[username]['password'] = new_password
        
        with open('./data/user.json', 'w', encoding='utf-8') as f:
            json.dump(users, f, indent=4, ensure_ascii=False)
            
        return jsonify({'success': True, 'message': '密码重置成功'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


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
                            total_tokens += log.get('input_tokens', 0) + log.get('output_tokens', 0)
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
    return render_template('chat.html', username=session['username'])


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
    """??????????????????"""
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
    """???????????????????"""
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
                'disabled': model_id in blacklist
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


@app.route('/api/chat/stream', methods=['POST'])
@require_login
def chat_stream():
    """流式聊天接口"""
    data = request.get_json()
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
                chunk_data = json.dumps(chunk, ensure_ascii=False)
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
            return jsonify({'success': False, 'message': '????????'})

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
            return jsonify({'success': False, 'message': '????'})
        
        store, store_err = get_chroma_store()
        if not store:
            return jsonify({'success': False, 'message': f'ChromaDB???: {store_err}'})
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
            return jsonify({'success': False, 'message': f'?????: {str(e)}'})
        
        return jsonify({
            'success': True, 
            'chunk_count': len(chunks),
            'stored': stored,
            'stored_count': stored_count,
            'vector_length': 0,
            'vector_preview': [],
            'vector_ids': doc_ids,
            'store_error': None if stored else 'store error',
            'message': '?????'
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'?????: {str(e)}'})

@app.route('/api/knowledge/vector/config', methods=['GET'])
@require_login
def get_vector_config():
    """????????"""
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
    """???????????"""
    username = session['username']
    data = request.get_json() or {}
    title = data.get('title')
    text = data.get('text')
    chunk_id = data.get('chunk_id')
    metadata = data.get('metadata') or {}
    chunk_total = data.get('chunk_total')

    if not title or text is None:
        return jsonify({'success': False, 'message': '???????'})

    store, store_err = get_chroma_store()
    if not store:
        return jsonify({'success': False, 'message': f'ChromaDB???: {store_err}'})
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
    """????(ChromaDB)"""
    username = session['username']
    data = request.get_json() or {}
    query_text = data.get('text') or data.get('query')
    top_k = int(data.get('top_k') or 5)
    
    if not query_text:
        return jsonify({'success': False, 'message': '???????'})

    store, store_err = get_chroma_store()
    if not store:
        return jsonify({'success': False, 'message': f'ChromaDB???: {store_err}'})

    try:
        if getattr(store, 'mode', '') != 'service':
            return jsonify({'success': False, 'message': 'NexoraDB service mode required'})
        result = store.query_text(username, query_text, top_k=top_k)
        return jsonify({'success': True, 'result': result})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/knowledge/vector/delete', methods=['POST'])
@require_login
def delete_knowledge_vectors():
    """?????????????????"""
    username = session['username']
    data = request.get_json() or {}
    title = data.get('title')
    vector_id = data.get('vector_id')
    if not title and not vector_id:
        return jsonify({'success': False, 'message': '????????ID'})

    store, store_err = get_chroma_store()
    if not store:
        return jsonify({'success': False, 'message': f'ChromaDB???: {store_err}'})
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
