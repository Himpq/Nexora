"""
NexoraLearning — Flask 入口
实现配置自举与目录自动补全
"""

from __future__ import annotations

import json
import secrets
import os
from pathlib import Path

from flask import Flask, jsonify
from flask_cors import CORS

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
CONFIG_PATH = DATA_DIR / "config.json"

DEFAULT_CONFIG = {
    "port": 5001,
    "debug": False,
    "data_dir": "data",
    "max_upload_mb": 50,
    "nexora": {
        "base_url": "http://127.0.0.1:5000",
        "api_key": "public-1234567890abcdef"
    },
    "nexoradb": {
        "service_url": "http://127.0.0.1:8100",
        "api_key": ""
    }
}

def ensure_bootstrap():
    """确保 data 目录和配置文件存在"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "courses").mkdir(exist_ok=True)
    (DATA_DIR / "lectures").mkdir(exist_ok=True)
    (DATA_DIR / "chroma").mkdir(exist_ok=True)
    (DATA_DIR / "users").mkdir(exist_ok=True)

    if not CONFIG_PATH.exists():
        config = DEFAULT_CONFIG.copy()
        config["auth_token"] = secrets.token_hex(24)
        config = _normalize_config_paths(config)
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=4, ensure_ascii=False)
        print(f"[BOOTSTRAP] Created default config at {CONFIG_PATH}")
        return config
    
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return _normalize_config_paths(json.load(f))


def _normalize_config_paths(config):
    cfg = dict(config or {})
    data_dir = Path(str(cfg.get("data_dir") or "data"))
    if not data_dir.is_absolute():
        data_dir = (ROOT / data_dir).resolve()
    cfg["data_dir"] = str(data_dir)
    return cfg

def create_app():
    cfg = ensure_bootstrap()

    app = Flask(__name__)
    CORS(app)

    from api.routes import bp, init_routes
    init_routes(cfg)
    app.register_blueprint(bp)

    @app.route("/health")
    def health():
        return jsonify({
            "status": "ok", 
            "service": "NexoraLearning", 
            "version": "0.1.0",
            "auth_token_configured": bool(cfg.get("auth_token"))
        })

    return app, cfg

if __name__ == "__main__":
    app, cfg = create_app()
    port = int(cfg.get("port") or 5001)
    debug = bool(cfg.get("debug", False))
    print(f"[NexoraLearning] Running on http://127.0.0.1:{port}")
    print(f"[NexoraLearning] Config:   {CONFIG_PATH}")
    print(f"[NexoraLearning] Data dir: {DATA_DIR}/")
    app.run(host="0.0.0.0", port=port, debug=debug, threaded=True)
