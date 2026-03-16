"""
配置管理：读写 config.json
"""

import json
import secrets
from pathlib import Path

_CONFIG_PATH = Path(__file__).parent.parent / "config.json"
_DEFAULTS = {
    "nexora_url": "https://chat.himpqblog.cn",
    "allowed_dirs": [],        # 文件操作白名单目录，空列表=需用户每次授权
    "shell_whitelist": [],     # 允许执行的命令前缀，空列表=全部需确认
    "renderer_timeout": 20,    # Playwright 渲染超时（秒）
    "window_mode": "native",   # native=原生标题栏, custom=自绘标题栏+原生边框, frameless=全自绘
    "window_frameless": False, # 默认使用原生窗口框，保留系统最大化/贴边能力
    "window_width": 960,
    "window_height": 700,
    "preferred_model_id": "",
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


config = Config()
