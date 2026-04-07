import json
import logging
import os
import secrets
import string
from functools import wraps
from flask import Flask, request, jsonify

from core.search import search_clean
from core.render import RenderManager
from core.render_search import render_search

app = Flask(__name__)
logger = logging.getLogger(__name__)

# Config setup
CONFIG_DIR = os.path.join(os.path.dirname(__file__), 'config')
if not os.path.exists(CONFIG_DIR):
    os.makedirs(CONFIG_DIR)

CONFIG_PATH = os.path.join(CONFIG_DIR, 'config.json')

def generate_random_token(length=32):
    chars = string.ascii_letters + string.digits
    return ''.join(secrets.choice(chars) for _ in range(length))

try:
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        config = json.load(f)
except FileNotFoundError:
    random_token = generate_random_token()
    logger.info(f"config.json not found. Auto-generating a new config with random token: {random_token}")
    config = {
        "auth": {"required": True, "token": random_token},
        "render": {"max_concurrency": 3, "default_timeout_ms": 15000, "fallback_on_fail": True},
        "server": {"host": "127.0.0.1", "port": 8080, "debug": False}
    }
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=4, ensure_ascii=False)

# Setup RenderManager limits
rm = RenderManager(
    max_concurrency=config.get('render', {}).get('max_concurrency', 3),
    allow_fallback=config.get('render', {}).get('fallback_on_fail', True)
)

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_cfg = config.get('auth', {})
        if not auth_cfg.get('required', False):
            return f(*args, **kwargs)

        token = request.headers.get("Authorization", "")
        token = token.replace("Bearer ", "").strip()
        if not token:
            token = request.args.get("token", "")
            
        if token != auth_cfg.get('token', ''):
            return jsonify({"error": "Unauthorized"}), 401
            
        return f(*args, **kwargs)
    return decorated

@app.route('/api/search/ddg', methods=['GET'])
@require_auth
def api_search_ddg():
    query = request.args.get('query', '')
    if not query:
        return jsonify({"error": "Missing query parameter"}), 400
        
    max_results = int(request.args.get('max_results', 5))
    backend = request.args.get('backend', 'html')
    fetch_content = request.args.get('fetch_content', 'false').lower() == 'true'

    result = search_clean(query, max_results, fetch_content)
    if not result.get('success'):
        return jsonify(result), 500
    return jsonify(result)

@app.route('/api/search/render', methods=['GET'])
@require_auth
def api_search_render():
    """
    Search endpoint using CSS Selectors (render_search.py)
    """
    query = request.args.get('query', '')
    if not query:
        return jsonify({"error": "Missing query parameter"}), 400

    results = render_search(query)
    # 按照需要返回特定渲染文本或所有搜索引擎的结果
    return jsonify({"success": True, "query": query, "results": results})

@app.route('/api/render/webview', methods=['GET'])
@require_auth
def api_render_webview():
    url = request.args.get('url', '')
    if not url:
        return jsonify({"error": "Missing url parameter"}), 400

    timeout = int(request.args.get('timeout', config.get('render', {}).get('default_timeout_ms', 15000)))
    result = rm.render_webview(url, timeout=timeout)
    
    if not result.get('success'):
        return jsonify(result), 500
    return jsonify(result)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    srv_cfg = config.get('server', {})
    host = srv_cfg.get('host', '127.0.0.1')
    port = srv_cfg.get('port', 8080)
    
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        logger.info(f"🚀 NexoraSearch is starting on http://{host}:{port}")
        logger.info(f"🔑 Auth Token: {config.get('auth', {}).get('token')}")

    app.run(
        host=host,
        port=port,
        debug=srv_cfg.get('debug', False),
        threaded=True
    )
