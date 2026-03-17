"""
配置管理：读写 config.json
"""

import copy
import json
import secrets
import sys
from pathlib import Path

def get_app_root() -> Path:
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).parent
    else:
        return Path(__file__).resolve().parent.parent

_CONFIG_PATH = get_app_root() / "config.json"
_DEFAULTS = {
    "nexora_url": "https://chat.himpqblog.cn",
    "allowed_dirs": [],
    "shell_whitelist": [],
    "renderer_timeout": 20,
    "window_mode": "custom",
    "force_frameless_borderless": False,
    "window_frameless": False,
    "window_width": 1000,
    "window_height": 700,
    "preferred_model_id": "deepseek-v3-2-251201",
    "notes_window_width": 410,
    "notes_window_height": 473,
    "notes_window_pinned": False,
    "message": {
        "bootstrap": "加载中",
        "login": "正在登陆"
    },
    "local_proxy_enabled": True,
    "devtools_enabled": False,
    "devtools_auto_open": False,
    "devtools_port": 9222,
    "iframe_shell_enabled": False,
    "persistent_outer_shell": True,
    "allow_iframe_third_party_cookies": True,
    "unsafe_disable_web_security": True,
    "relax_iframe_samesite": True,
    "auto_escape_iframe_login_loop": False,
    "auth_trace": True
}

class Config:
    def __init__(self):
        self._data: dict = {}
        self._load()

    def _load(self):
        if _CONFIG_PATH.exists():
            with open(_CONFIG_PATH, "r", encoding="utf-8") as f:
                self._data = json.load(f)
        else:
            self._data = dict(_DEFAULTS)

        # 首次运行时生成持久化 agent_token（每台设备唯一，重启不变）
        if not self._data.get("agent_token"):
            self._data["agent_token"] = secrets.token_hex(24)
            self._save()

    def _save(self):
        with open(_CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(self._data, f, ensure_ascii=False, indent=2)

    def get(self, key: str, default=None):
        return self._data.get(key, _DEFAULTS.get(key, default))

    def set(self, key: str, value):
        self._data[key] = value
        self._save()

    def snapshot(self) -> dict:
        base = copy.deepcopy(_DEFAULTS)
        for key, value in self._data.items():
            if isinstance(value, dict) and isinstance(base.get(key), dict):
                merged = dict(base.get(key) or {})
                merged.update(copy.deepcopy(value))
                base[key] = merged
            else:
                base[key] = copy.deepcopy(value)
        if not base.get("agent_token"):
            base["agent_token"] = secrets.token_hex(24)
        return base

    def replace_all(self, data: dict):
        if not isinstance(data, dict):
            raise TypeError("config payload must be an object")
        merged = copy.deepcopy(_DEFAULTS)
        for key, value in data.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                nested = dict(merged.get(key) or {})
                nested.update(copy.deepcopy(value))
                merged[key] = nested
            else:
                merged[key] = copy.deepcopy(value)
        if not merged.get("agent_token"):
            merged["agent_token"] = secrets.token_hex(24)
        self._data = merged
        self._save()


config = Config()
