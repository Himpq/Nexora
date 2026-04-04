"""
Nexora 服务器通信客户端
"""

import json
from typing import Iterator

import requests

from core.config import config


class NexoraClient:
    def __init__(self):
        self.base_url = config.get("nexora_url", "http://localhost:5000").rstrip("/")
        self.session = requests.Session()

    def proxy_request(self, method: str, path: str, **kwargs) -> requests.Response:
        url = f"{self.base_url}/{path}"
        kwargs.setdefault("timeout", 60)
        kwargs.setdefault("stream", True)
        return self.session.request(method, url, **kwargs)

    def register_tools(self, tools: list[dict], callback_url: str) -> bool:
        """向 Nexora 服务器注册本机工具集，提供回调地址"""
        try:
            resp = self.session.post(
                f"{self.base_url}/api/local_agent/register",
                json={"tools": tools, "callback_url": callback_url},
                timeout=10,
            )
            return resp.status_code == 200
        except Exception as e:
            print(f"[NexoraClient] register_tools failed: {e}")
            return False
