"""
NexoraCode.model.Provider — 本地模型 Provider（OpenAI 兼容）

对话完全在本地驱动，只调用户配置的模型服务商（Provider）API：
- 兼容任意 OpenAI /chat/completions 端点（deepseek / volcengine / ollama / vllm / openai 等）
- 支持流式输出与 function tools（tool_calls delta 聚合）
- 支持多个 Provider 列表，配置见 data/providers.json

对外提供：
- ProviderConfig: 单个 provider 配置
- ProviderClient: 流式 chat 客户端（yield 增量事件）
- load_providers / save_providers / get_default_provider / load_provider: 配置读写
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from typing import Any, Generator, List, Optional

import requests

from core.config import get_app_root


class ProviderConfig:
    def __init__(
        self,
        *,
        provider_id: str = "",
        name: str = "",
        base_url: str = "",
        api_key: str = "",
        model: str = "",
        temperature: float = 0.7,
        max_tokens: int = 4096,
        context_window: int = 128000,
        timeout_seconds: float = 120.0,
    ):
        self.provider_id = str(provider_id or "").strip() or f"p_{uuid.uuid4().hex[:8]}"
        self.name = str(name or "").strip() or self.provider_id
        self.base_url = str(base_url or "").strip().rstrip("/")
        self.api_key = str(api_key or "").strip()
        self.model = str(model or "").strip()
        self.temperature = float(temperature or 0.7)
        self.max_tokens = int(max_tokens or 4096)
        self.context_window = int(context_window or 0)
        self.timeout_seconds = float(timeout_seconds or 120.0)

    def is_configured(self) -> bool:
        return bool(self.base_url) and bool(self.model)

    def to_dict(self) -> dict:
        return {
            "id": self.provider_id,
            "name": self.name,
            "base_url": self.base_url,
            "api_key": self.api_key,
            "model": self.model,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "context_window": self.context_window,
            "timeout_seconds": self.timeout_seconds,
        }

    def to_public_dict(self) -> dict:
        """对外展示（不回显 api_key 明文）。"""
        return {
            "id": self.provider_id,
            "name": self.name,
            "base_url": self.base_url,
            "model": self.model,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "context_window": self.context_window,
            "has_api_key": bool(self.api_key),
        }

    @classmethod
    def from_dict(cls, data: Any) -> "ProviderConfig":
        payload = data if isinstance(data, dict) else {}
        return cls(
            provider_id=str(payload.get("id") or payload.get("provider_id") or ""),
            name=str(payload.get("name") or ""),
            base_url=str(payload.get("base_url") or ""),
            api_key=str(payload.get("api_key") or ""),
            model=str(payload.get("model") or ""),
            temperature=payload.get("temperature", 0.7),
            max_tokens=payload.get("max_tokens", 4096),
            context_window=payload.get("context_window", 128000),
            timeout_seconds=payload.get("timeout_seconds", 120.0),
        )


_PROVIDERS_PATH = get_app_root() / "data" / "providers.json"
_LEGACY_PROVIDER_PATH = get_app_root() / "data" / "provider.json"
_PROVIDER_LOCK = threading.RLock()


def _default_storage() -> dict:
    return {"default_id": "", "providers": []}


def load_providers() -> List[ProviderConfig]:
    with _PROVIDER_LOCK:
        if _PROVIDERS_PATH.is_file():
            try:
                with open(_PROVIDERS_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = {}
        else:
            data = {}

        raw_list = data.get("providers") if isinstance(data, dict) else None

        if not isinstance(raw_list, list) or not raw_list:
            return _migrate_legacy_provider()

        return [ProviderConfig.from_dict(item) for item in raw_list if isinstance(item, dict)]


def save_providers(providers: List[ProviderConfig], default_id: str = "") -> None:
    _PROVIDERS_PATH.parent.mkdir(parents=True, exist_ok=True)
    default_id = str(default_id or "").strip()

    if not default_id and providers:
        default_id = providers[0].provider_id

    payload = {
        "default_id": default_id,
        "providers": [provider.to_dict() for provider in providers],
    }

    with _PROVIDER_LOCK:
        with open(_PROVIDERS_PATH, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)


def get_default_provider() -> ProviderConfig:
    providers = load_providers()

    if not providers:
        return ProviderConfig()

    default_id = ""

    try:
        with open(_PROVIDERS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        default_id = str(data.get("default_id") or "") if isinstance(data, dict) else ""
    except Exception:
        default_id = ""

    if default_id:
        for provider in providers:
            if provider.provider_id == default_id:
                return provider

    return providers[0]


def load_provider() -> ProviderConfig:
    """兼容旧接口：返回默认 Provider（未配置返回空配置）。"""
    return get_default_provider()


def _migrate_legacy_provider() -> List[ProviderConfig]:
    """旧版单配置 provider.json 迁移为列表。"""
    if not _LEGACY_PROVIDER_PATH.is_file():
        return []

    try:
        with open(_LEGACY_PROVIDER_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)

        config = ProviderConfig.from_dict(data)

        if not config.base_url:
            return []
    except Exception:
        return []

    save_providers([config], default_id=config.provider_id)

    try:
        _LEGACY_PROVIDER_PATH.unlink()
    except Exception:
        pass

    return [config]


class ProviderError(Exception):
    pass


class ProviderClient:
    """OpenAI 兼容流式 chat 客户端。

    stream_chat() 逐 token 返回增量事件 dict：
    - {"type": "content", "delta": "..."}            正文增量
    - {"type": "tool_call", "index": 0, "id": "call_x", "name": "tool", "arguments_delta": "{\\"..."} 工具调用增量
    - {"type": "finish", "finish_reason": "stop" | "tool_calls"}
    """

    def __init__(self, config: ProviderConfig):
        self.config = config
        self._session = requests.Session()
        self._cancel_event = threading.Event()
        self._current_response = None
        self._response_lock = threading.Lock()

    def cancel(self) -> None:
        """请求外部中止：关闭当前流式响应，使阻塞读立即返回。"""
        self._cancel_event.set()

        with self._response_lock:
            response = self._current_response

        if response is not None:
            try:
                response.close()
            except Exception:
                pass

    def reset(self) -> None:
        self._cancel_event = threading.Event()

    def _completions_url(self) -> str:
        base = self.config.base_url.rstrip("/")

        if base.endswith("/chat/completions"):
            return base

        if base.endswith("/v1"):
            return f"{base}/chat/completions"

        return f"{base}/v1/chat/completions"

    def _headers(self) -> dict:
        headers = {"Content-Type": "application/json"}

        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"

        return headers

    def stream_chat(
        self,
        messages: list[dict],
        tools: Optional[list[dict]] = None,
        tool_choice: Any = "auto",
    ) -> Generator[dict, None, None]:
        if not self.config.is_configured():
            raise ProviderError("Provider 未配置：请先在设置中填写 base_url / model")

        payload: dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "stream": True,
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
        }

        if tools:
            payload["tools"] = tools

        if tool_choice is not None:
            payload["tool_choice"] = tool_choice

        try:
            upstream = self._session.post(
                self._completions_url(),
                headers=self._headers(),
                json=payload,
                timeout=self.config.timeout_seconds,
                stream=True,
            )
        except Exception as exc:
            raise ProviderError(f"Provider 请求失败: {exc}")

        if int(upstream.status_code or 0) >= 400:
            try:
                detail = upstream.text[:400]
            except Exception:
                detail = ""

            raise ProviderError(f"Provider HTTP {upstream.status_code}: {detail}")

        if not getattr(upstream, "raw", None):
            raise ProviderError("Provider 未返回流式响应")

        with self._response_lock:
            self._current_response = upstream

        try:
            yield from self._iter_sse(upstream)
        finally:
            with self._response_lock:
                if self._current_response is upstream:
                    self._current_response = None

    def _iter_sse(self, upstream: requests.Response) -> Generator[dict, None, None]:
        raw = getattr(upstream, "raw", None)
        buffer = ""

        def _read_chunks():
            if raw is not None and hasattr(raw, "stream"):
                for chunk in raw.stream(amt=1, decode_content=False):
                    if self._cancel_event.is_set():
                        break

                    yield chunk
            else:
                for chunk in upstream.iter_content(chunk_size=1):
                    if self._cancel_event.is_set():
                        break

                    yield chunk

        try:
            for chunk in _read_chunks():
                if not chunk:
                    continue

                buffer += chunk.decode("utf-8", errors="ignore")

                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()

                    if not line.startswith("data:"):
                        continue

                    data = line[5:].strip()

                    if data == "[DONE]":
                        return

                    try:
                        event = json.loads(data)
                    except Exception:
                        continue

                    choices = event.get("choices") or []

                    if not choices:
                        continue

                    choice = choices[0]
                    delta = choice.get("delta") or {}

                    content = delta.get("content")

                    if content:
                        yield {"type": "content", "delta": content}

                    tool_calls = delta.get("tool_calls")

                    if tool_calls:
                        for call in tool_calls:
                            yield {
                                "type": "tool_call",
                                "index": int(call.get("index", 0) or 0),
                                "id": str(call.get("id") or ""),
                                "name": str(((call.get("function") or {}).get("name")) or ""),
                                "arguments_delta": str(((call.get("function") or {}).get("arguments")) or ""),
                            }

                    finish_reason = choice.get("finish_reason")

                    if finish_reason:
                        yield {"type": "finish", "finish_reason": str(finish_reason)}
        finally:
            try:
                upstream.close()
            except Exception:
                pass
