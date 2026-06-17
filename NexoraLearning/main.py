"""
NexoraLearning — Flask 入口
实现配置自举与目录自动补全
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict

from flask import Flask, jsonify, send_from_directory
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
    "runtime_api": {
        "enabled": True,
        "api_key": "",
        "request_timeout": 30
    },
    "nexora": {
        "base_url": "http://127.0.0.1:5000",
        "api_key": "",
        "request_timeout": 90,
        "target_username": "",
        "models_path": "/api/papi/models",
        "completions_path": "/api/papi/completions",
        "responses_path": "/api/papi/responses",
        "chat_completions_path": "/api/papi/chat/completions",
        "learning_chat_path": "/api/papi/learning/chat",
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
            "max_input_chars": 24000,
            "max_output_chars": 240000,
            "request_timeout": 240,
            "stream": True,
            "think": False,
            "summary_review_model_name": "",
            "summary_review_temperature": 0.1,
            "summary_review_max_output_tokens": 900,
            "summary_review_request_timeout": 120,
            "summary_review_stream": True,
            "summary_review_think": False,
            "section_review_model_name": "",
            "section_review_temperature": 0.1,
            "section_review_max_output_tokens": 1200,
            "section_review_request_timeout": 120,
            "section_review_stream": True,
            "section_review_think": False,
            "prompt_notes": ""
        },
        "intensive_reading": {
            "enabled": True,
            "model_name": "",
            "api_mode": "chat",
            "temperature": 0.2,
            "max_output_tokens": 4000,
            "request_timeout": 240,
            "stream": True,
            "think": False,
            "prompt_notes": ""
        },
        "question_generation": {
            "enabled": False,
            "model_name": "",
            "api_mode": "chat",
            "temperature": 0.2,
            "max_output_tokens": 4000,
            "max_input_chars": 12000,
            "request_timeout": 240,
            "stream": True,
            "think": False,
            "prompt_notes": ""
        },
        "split_chapters": {
            "enabled": True,
            "model_name": "",
            "api_mode": "chat",
            "temperature": 0.2,
            "max_output_tokens": 4000,
            "max_input_chars": 12000,
            "request_timeout": 240,
            "stream": True,
            "think": False,
            "prompt_notes": ""
        },
        "memory": {
            "enabled": True,
            "model_name": "",
            "api_mode": "chat",
            "temperature": 0.2,
            "max_output_tokens": 4000,
            "request_timeout": 240,
            "stream": True,
            "think": False,
            "trigger_turn_interval": 10,
            "prompt_notes": ""
        },
        "profile_question": {
            "enabled": True,
            "model_name": "",
            "api_mode": "chat",
            "temperature": 0.2,
            "max_output_tokens": 4000,
            "request_timeout": 240,
            "stream": True,
            "think": False,
            "prompt_notes": ""
        },
        "annotation": {
            "enabled": True,
            "model_name": "",
            "api_mode": "chat",
            "temperature": 0.3,
            "max_output_tokens": 4000,
            "max_input_chars": 15000,
            "request_timeout": 240,
            "stream": True,
            "think": False,
            "prompt_notes": ""
        },
        "book_summary": {
            "enabled": True,
            "model_name": "",
            "api_mode": "chat",
            "temperature": 0.2,
            "max_output_tokens": 4000,
            "max_input_chars": 20000,
            "request_timeout": 240,
            "stream": True,
            "think": False,
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
        config = _normalize_config_paths(config)
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=4, ensure_ascii=False)
        print(f"[BOOTSTRAP] Created default config at {CONFIG_PATH}")
        return config
    
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        loaded = json.load(f)
    merged = _deep_merge_defaults(DEFAULT_CONFIG, loaded if isinstance(loaded, dict) else {})
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
    runtime_cfg = cfg.get("runtime_api")
    if isinstance(runtime_cfg, dict):
        if "frontend_url" in runtime_cfg:
            runtime_cfg.pop("frontend_url", None)
        if "base_path" in runtime_cfg:
            runtime_cfg.pop("base_path", None)
    cfg.pop("auth_token", None)
    nexora_cfg = cfg.get("nexora")
    if isinstance(nexora_cfg, dict) and "public_api_key" in nexora_cfg:
        nexora_cfg.pop("public_api_key", None)
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

    from api.telemetry import telemetry_bp, init_telemetry
    init_telemetry(cfg)
    app.register_blueprint(telemetry_bp)

    from api.learning_progress import learning_progress_bp, init_learning_progress
    init_learning_progress(cfg)
    app.register_blueprint(learning_progress_bp)

    @app.route("/health")
    def health():
        return jsonify({
            "status": "ok", 
            "service": "NexoraLearning", 
            "version": "0.1.0"
        })

    @app.route("/status")
    @app.route("/NexoraLearning/status")
    def status_page():
        return send_from_directory(str(ROOT / "frontend"), "status.html")

    return app, cfg

if __name__ == "__main__":
    app, cfg = create_app()
    port = int(cfg.get("port") or 5001)
    debug = bool(cfg.get("debug", False))
    print(f"[NexoraLearning] Running on http://127.0.0.1:{port}")
    print(f"[NexoraLearning] Config:   {CONFIG_PATH}")
    print(f"[NexoraLearning] Data dir: {DATA_DIR}/")
    app.run(host="0.0.0.0", port=port, debug=debug, threaded=True)
