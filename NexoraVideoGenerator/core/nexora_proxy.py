"""Nexora PAPI client used by NexoraVideoGenerator."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Dict, Mapping, Optional


class NexoraProxy:
    """Small HTTP client for Nexora text and image generation APIs."""

    def __init__(self, cfg: Mapping[str, Any]):
        nexora_cfg = dict((cfg or {}).get("nexora") or {})
        self.base_url = str(nexora_cfg.get("base_url") or "http://127.0.0.1:5000").rstrip("/")
        self.api_key = str(nexora_cfg.get("api_key") or "").strip()
        self.default_model = str(nexora_cfg.get("default_model") or "").strip()
        self.default_username = str(nexora_cfg.get("target_username") or "").strip()
        self.completions_path = self._normalize_path(nexora_cfg.get("completions_path"), "/api/papi/completions")
        self.image_generation_path = self._normalize_path(nexora_cfg.get("image_generation_path"), "/api/papi/images/generations")
        try:
            self.request_timeout = float(nexora_cfg.get("request_timeout") or 600)
        except Exception:
            self.request_timeout = 600.0

    def complete_text(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        model: Optional[str] = None,
        username: Optional[str] = None,
        temperature: float = 0.2,
        request_timeout: Optional[float] = None,
    ) -> str:
        messages = []
        if str(system_prompt or "").strip():
            messages.append({"role": "system", "content": str(system_prompt)})
        messages.append({"role": "user", "content": str(user_prompt or "")})
        payload = {
            "messages": messages,
            "temperature": float(temperature),
            "stream": False,
        }
        target_model = str(model or self.default_model or "").strip()
        if target_model:
            payload["model"] = target_model
        target_username = str(username or self.default_username or "").strip()
        if target_username:
            payload["username"] = target_username

        status, response = self._request_json(self.completions_path, payload, request_timeout=request_timeout)
        if status >= 400 or response.get("success") is False:
            raise RuntimeError(str(response.get("message") or response.get("error") or f"HTTP {status}"))
        return self.extract_output_text(response)

    def generate_image(
        self,
        *,
        prompt: str,
        model: Optional[str] = None,
        size: str = "1024x1024",
        n: int = 1,
        request_timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        payload = {
            "prompt": str(prompt or "").strip(),
            "size": str(size or "1024x1024").strip(),
            "n": max(1, min(int(n or 1), 4)),
            "response_format": "b64_json",
        }
        target_model = str(model or "").strip()
        if target_model:
            payload["model"] = target_model

        status, response = self._request_json(self.image_generation_path, payload, request_timeout=request_timeout)
        if status >= 400 or response.get("success") is False:
            raise RuntimeError(str(response.get("message") or response.get("error") or f"HTTP {status}"))
        return response

    def analyze_image(
        self,
        *,
        model: str,
        prompt: str,
        image_b64: str,
        image_mime: str,
        system_prompt: str = "",
        request_timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        target_model = str(model or "").strip()
        if not target_model:
            raise ValueError("nexora.vision_model 未配置")

        raw_b64 = str(image_b64 or "").strip()
        if not raw_b64:
            raise ValueError("image_b64 不能为空")

        image_url = raw_b64
        if not image_url.startswith("data:"):
            mime = str(image_mime or "image/png").strip() or "image/png"
            image_url = f"data:{mime};base64,{image_url}"

        messages = []
        if str(system_prompt or "").strip():
            messages.append({"role": "system", "content": str(system_prompt)})
        messages.append({
            "role": "user",
            "content": [
                {"type": "text", "text": str(prompt or "").strip()},
                {"type": "image_url", "image_url": {"url": image_url}},
            ],
        })
        payload = {
            "model": target_model,
            "messages": messages,
            "stream": False,
        }
        status, response = self._request_json(self.completions_path, payload, request_timeout=request_timeout)
        if status >= 400 or response.get("success") is False:
            raise RuntimeError(str(response.get("message") or response.get("error") or f"HTTP {status}"))
        return {
            "success": True,
            "model": str(response.get("model") or target_model).strip(),
            "provider": str(response.get("provider") or "").strip(),
            "text": self.extract_output_text(response),
            "raw_response": response,
        }

    @staticmethod
    def extract_output_text(payload: Mapping[str, Any]) -> str:
        if not isinstance(payload, Mapping):
            return ""
        content = payload.get("content")
        if isinstance(content, str) and content.strip():
            return content
        choices = payload.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0] if isinstance(choices[0], dict) else {}
            message = first.get("message") if isinstance(first, dict) else {}
            if isinstance(message, dict):
                text = message.get("content")
                if isinstance(text, str):
                    return text.strip()
        output_text = payload.get("output_text")
        if isinstance(output_text, str):
            return output_text.strip()
        return ""

    def _request_json(self, path: str, payload: Dict[str, Any], *, request_timeout: Optional[float] = None):
        url = f"{self.base_url}{self._normalize_path(path, path)}"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
            headers["Authorization"] = f"Bearer {self.api_key}"
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        timeout = self.request_timeout if request_timeout is None else float(request_timeout)
        request = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=max(10.0, min(timeout, 1800.0))) as response:
                status = int(getattr(response, "status", 200) or 200)
                text = response.read().decode("utf-8", errors="replace")
                return status, json.loads(text) if text.strip() else {}
        except urllib.error.HTTPError as exc:
            status = int(getattr(exc, "code", 502) or 502)
            text = exc.read().decode("utf-8", errors="replace")
            try:
                return status, json.loads(text) if text.strip() else {}
            except Exception:
                return status, {"success": False, "message": text or str(exc)}
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
            return 599, {
                "success": False,
                "message": f"PAPI 请求失败: {url} | {type(exc).__name__}: {exc}",
            }

    @staticmethod
    def _normalize_path(value: Any, default: str) -> str:
        path = str(value or default).strip()
        if not path.startswith("/"):
            path = f"/{path}"
        return path
