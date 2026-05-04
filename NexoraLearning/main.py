"""
NexoraLearning — Flask 入口
实现配置自举与目录自动补全
"""

from __future__ import annotations

import json
import secrets
import os
from pathlib import Path
from typing import Any, Dict

from flask import Flask, jsonify
from flask_cors import CORS
from core.runlog import init_run_logger

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
CONFIG_PATH = DATA_DIR / "config.json"

os.chdir(ROOT)

DEFAULT_CONFIG = {
    "port": 5001,
    "debug": False,
    "data_dir": "data",
    "max_upload_mb": 50,
    "nexora": {
        "base_url": "http://127.0.0.1:5000",
        "api_key": "",
        "public_api_key": "",
        "request_timeout": 90,
        "target_username": "",
        "models_path": "/api/papi/models",
        "completions_path": "/api/papi/completions",
        "responses_path": "/api/papi/responses",
        "chat_completions_path": "/api/papi/chat/completions",
        "user_info_path": "/api/papi/user/info",
        "append_username_to_path": False
    },
    "nexoradb": {
        "service_url": "http://127.0.0.1:8100",
        "api_key": ""
    },
    "models": {
        "default_nexora_model": "",
        "rough_reading": {
            "enabled": True,
            "model_name": "",
            "api_mode": "chat",
            "temperature": 0.2,
            "max_output_tokens": 4000,
            "max_input_chars": 120000,
            "prompt_notes": ""
        }
    },
    "vectorization": {
        "chunk_size": 600,
        "chunk_overlap": 80
    }
}

def ensure_bootstrap():
    """确保 data 目录和配置文件存在"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
   # (DATA_DIR / "courses").mkdir(exist_ok=True)
    (DATA_DIR / "lectures").mkdir(exist_ok=True)
    #(DATA_DIR / "chroma").mkdir(exist_ok=True)
    (DATA_DIR / "users").mkdir(exist_ok=True)

    if not CONFIG_PATH.exists():
        config = json.loads(json.dumps(DEFAULT_CONFIG, ensure_ascii=False))
        config["auth_token"] = secrets.token_hex(24)
        config = _normalize_config_paths(config)
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=4, ensure_ascii=False)
        print(f"[BOOTSTRAP] Created default config at {CONFIG_PATH}")
        return config
    
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        loaded = json.load(f)
    merged = _deep_merge_defaults(DEFAULT_CONFIG, loaded if isinstance(loaded, dict) else {})
    if "auth_token" not in merged:
        merged["auth_token"] = secrets.token_hex(24)
    normalized = _normalize_config_paths(merged)
    if normalized != loaded:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(normalized, f, indent=4, ensure_ascii=False)
    return normalized


def _normalize_config_paths(config):
    """规范化配置中的路径字段。"""
    cfg = dict(config or {})
    data_dir = Path(str(cfg.get("data_dir") or "data"))
    if not data_dir.is_absolute():
        data_dir = (ROOT / data_dir).resolve()
    cfg["data_dir"] = str(data_dir)
    return cfg


def _deep_merge_defaults(defaults: Dict[str, Any], current: Dict[str, Any]) -> Dict[str, Any]:
    """递归合并默认配置，保证新增字段自动补齐。"""
    merged: Dict[str, Any] = json.loads(json.dumps(defaults, ensure_ascii=False))
    for key, value in dict(current or {}).items():
        if (
            key in merged
            and isinstance(merged[key], dict)
            and isinstance(value, dict)
        ):
            merged[key] = _deep_merge_defaults(merged[key], value)
        else:
            merged[key] = value
    return merged

def create_app():
    cfg = ensure_bootstrap()
    cfg["_config_path"] = str(CONFIG_PATH)
    init_run_logger(cfg)

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
