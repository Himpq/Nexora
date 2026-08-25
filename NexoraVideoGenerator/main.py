"""NexoraVideoGenerator Flask entry."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
CONFIG_PATH = DATA_DIR / "config.json"
FRONTEND_DIR = ROOT / "frontend"

os.chdir(ROOT)

DEFAULT_CONFIG: Dict[str, Any] = {
    "port": 5011,
    "debug": False,
    "data_dir": str(DATA_DIR),
    "nexora": {
        "base_url": "http://127.0.0.1:5000",
        "api_key": "",
        "request_timeout": 600,
        "completions_path": "/api/papi/completions",
        "image_generation_path": "/api/papi/images/generations",
        "default_model": "",
        "stage_models": {
            "outline": "",
            "script": "",
            "storyboard": "",
            "canvas": "",
            "template": "",
        },
        "image_model": "",
        "vision_model": "",
        "target_username": "",
    },
    "tts": {
        "provider": "windows_sapi",
        "voice": "",
        "rate": 0,
    },
    "render": {
        "width": 1920,
        "height": 1080,
        "fps": 30,
        "ffmpeg_path": "ffmpeg",
    },
}


def ensure_bootstrap() -> Dict[str, Any]:
    """Ensure data directories and config file exist."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "projects").mkdir(parents=True, exist_ok=True)

    if not CONFIG_PATH.exists():
        payload = json.loads(json.dumps(DEFAULT_CONFIG, ensure_ascii=False))
        CONFIG_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=4), encoding="utf-8")
        return payload

    loaded = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise ValueError("config.json must contain a JSON object")

    merged = _deep_merge(DEFAULT_CONFIG, loaded)
    if merged != loaded:
        CONFIG_PATH.write_text(json.dumps(merged, ensure_ascii=False, indent=4), encoding="utf-8")
    return merged


def _deep_merge(defaults: Dict[str, Any], current: Dict[str, Any]) -> Dict[str, Any]:
    merged = json.loads(json.dumps(defaults, ensure_ascii=False))
    for key, value in dict(current or {}).items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def create_app():
    cfg = ensure_bootstrap()
    cfg["_root"] = str(ROOT)
    cfg["_config_path"] = str(CONFIG_PATH)

    app = Flask(__name__)
    app.json.ensure_ascii = False
    CORS(app)

    from api.routes import bp, init_routes
    from api.template_routes import bp as template_bp, init_template_routes

    init_routes(cfg)
    init_template_routes(cfg)
    app.register_blueprint(bp)
    app.register_blueprint(template_bp)

    @app.route("/health")
    def health():
        return jsonify({"status": "ok", "service": "NexoraVideoGenerator"})

    @app.route("/")
    @app.route("/workbench")
    @app.route("/workbench/")
    def workbench():
        return send_from_directory(FRONTEND_DIR, "index.html")

    @app.route("/assets/<path:filename>")
    def frontend_asset(filename: str):
        return send_from_directory(FRONTEND_DIR / "assets", filename)

    return app, cfg


if __name__ == "__main__":
    app, cfg = create_app()
    port = int(cfg.get("port") or 5011)
    debug = bool(cfg.get("debug", False))
    print(f"[NexoraVideoGenerator] Running on http://127.0.0.1:{port}")
    print(f"[NexoraVideoGenerator] Config: {CONFIG_PATH}")
    app.run(host="0.0.0.0", port=port, debug=debug, threaded=True)
