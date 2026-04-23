"""
NexoraLearning — Nexora API 代理
封装对 ChatDBServer 的模型调用，用于文本解析、大纲生成等任务。
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional
import urllib.request
import urllib.error
import urllib.parse

class NexoraProxy:
    def __init__(self, cfg: Dict[str, Any]):
        nexora_cfg = cfg.get("nexora") or {}
        self.base_url = str(nexora_cfg.get("base_url") or "http://127.0.0.1:5000").rstrip("/")
        self.api_key = str(
            nexora_cfg.get("public_api_key")
            or nexora_cfg.get("api_key")
            or ""
        )
        self.default_username = str(
            nexora_cfg.get("username")
            or nexora_cfg.get("target_username")
            or ""
        ).strip()
    
    def _call_api(self, endpoint: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """通用 API 调用，带 X-API-Key 认证"""
        url = f"{self.base_url}{endpoint}"
        headers = {
            "Content-Type": "application/json",
            "X-API-Key": self.api_key
        }
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            try:
                err_body = e.read().decode("utf-8")
                return json.loads(err_body) if err_body else {"success": False, "message": str(e)}
            except:
                return {"success": False, "message": str(e)}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def chat_complete(
        self,
        system_prompt: str,
        user_prompt: str,
        model: Optional[str] = None,
        username: Optional[str] = None,
    ) -> str:
        """
        通过 Nexora 模型的 API 进行对话（待 ChatDBServer 实现标准接口）。
        目前假设 ChatDBServer 提供了一个类似的公共调用接口。
        """
        target_username = str(username or self.default_username or "").strip()
        payload = {
            "model": model or "doubao-seed-1-6-250615",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.3
        }
        endpoint = "/api/papi/completions"
        if target_username:
            endpoint = f"/api/papi/completions/{urllib.parse.quote(target_username)}"
        resp = self._call_api(endpoint, payload)
        if resp.get("success") is False:
            raise RuntimeError(f"Nexora API Error: {resp.get('message')}")
        content = resp.get("content")
        if content is None:
            content = resp.get("message", {}).get("content", "") if isinstance(resp.get("message"), dict) else ""
        return str(content or "")

    def extract_outline(self, text: str) -> str:
        """解析教材大纲"""
        system = "你是一个专业助教。请将以下教材内容解析为结构良好的知识点大纲（Markdown格式）。"
        return self.chat_complete(system, text[:15000]) # 限制长度防止超限
