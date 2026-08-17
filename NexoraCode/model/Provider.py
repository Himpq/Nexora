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

import codecs
import json
import os
import re
import threading
import uuid
from typing import Any, Generator, List, Optional

import requests

from core.config import get_app_root


def _infer_provider_name(base_url: str, model: str) -> str:
    """name 为空时，用 base_url 域名（或模型名）作为默认显示名，避免落到 provider_id 编码。"""
    try:
        from urllib.parse import urlparse

        host = (urlparse(base_url or "").hostname or "").strip()

        if host:
            return host.replace("www.", "")
    except Exception:
        pass

    model_text = str(model or "").strip()

    if model_text:
        return model_text.split("/")[-1].split(":")[0]

    return "自定义供应商"


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
        self.base_url = str(base_url or "").strip().rstrip("/")
        self.api_key = str(api_key or "").strip()
        self.model = str(model or "").strip()
        self.name = str(name or "").strip() or _infer_provider_name(self.base_url, self.model)
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


def _extract_cached_tokens(u: dict) -> int:
    """从 usage 提取缓存命中 token，覆盖主流 provider 字段。

    - OpenAI / OpenRouter: prompt_tokens_details.cached_tokens、input_tokens_details.cached_tokens
    - DeepSeek:            prompt_cache_hit_tokens
    - Anthropic 风格:      cache_read_input_tokens / cache_read_tokens（顶层或 input_tokens_details 内）
    - 部分网关:            顶层 cached_tokens / input_cached_tokens
    """
    prompt_details = u.get("prompt_tokens_details") if isinstance(u.get("prompt_tokens_details"), dict) else {}
    input_details = u.get("input_tokens_details") if isinstance(u.get("input_tokens_details"), dict) else {}

    candidates = (
        ("prompt_details", prompt_details.get("cached_tokens")),
        ("input_details", input_details.get("cached_tokens")),
        ("input_details", input_details.get("cache_read_input_tokens")),
        ("input_details", input_details.get("cache_read_tokens")),
        ("top", u.get("cached_tokens")),
        ("top", u.get("input_cached_tokens")),
        ("top", u.get("prompt_cache_hit_tokens")),
        ("top", u.get("cache_read_input_tokens")),
        ("top", u.get("cache_read_tokens")),
    )

    for _, value in candidates:
        if value is None:
            continue

        try:
            number = int(value)
        except (TypeError, ValueError):
            continue

        if number > 0:
            return number

    return 0


def _extract_uncached_tokens(u: dict) -> int:
    """提取缓存未命中（新增计费）token，DeepSeek / Anthropic 风格字段。"""
    input_details = u.get("input_tokens_details") if isinstance(u.get("input_tokens_details"), dict) else {}

    candidates = (
        ("top", u.get("prompt_cache_miss_tokens")),
        ("top", u.get("cache_creation_input_tokens")),
        ("top", u.get("cache_write_input_tokens")),
        ("input_details", input_details.get("cache_creation_input_tokens")),
        ("input_details", input_details.get("cache_write_input_tokens")),
    )

    for _, value in candidates:
        if value is None:
            continue

        try:
            number = int(value)
        except (TypeError, ValueError):
            continue

        if number > 0:
            return number

    return 0


def _extract_usage_io(raw_usage_obj) -> dict:
    """从上游 usage 对象提取 input/output/cached/cost 统计（对齐云端口径）。"""
    u = raw_usage_obj if isinstance(raw_usage_obj, dict) else {}

    def _safe_int(value, default=0):
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def _safe_float(value, default=0.0):
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    raw_input = _safe_int(u.get("prompt_tokens", u.get("input_tokens", 0)))
    output = _safe_int(u.get("completion_tokens", u.get("output_tokens", 0)))
    total = _safe_int(u.get("total_tokens", 0))
    cached = _extract_cached_tokens(u)
    uncached = _extract_uncached_tokens(u)
    reasoning = 0

    completion_details = u.get("completion_tokens_details") if isinstance(u.get("completion_tokens_details"), dict) else {}
    output_details = u.get("output_tokens_details") if isinstance(u.get("output_tokens_details"), dict) else {}
    reasoning = _safe_int(completion_details.get("reasoning_tokens", 0))
    if reasoning <= 0:
        reasoning = _safe_int(output_details.get("reasoning_tokens", 0))

    cost = _safe_float(u.get("total_cost", u.get("cost", 0.0)))

    if cached <= 0 and uncached > 0:
        cached = max(0, raw_input - uncached)

    return {
        "raw_input": max(0, raw_input),
        "cached_input": max(0, cached),
        "uncached_input": max(0, uncached),
        "effective_input": max(0, raw_input - cached),
        "output": max(0, output),
        "total": max(0, total),
        "reasoning_tokens": max(0, reasoning),
        "cost": max(0.0, cost),
    }


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

        # 火山方舟等供应商 base_url 自带版本段（/api/v3、/v1、/v2），
        # 直接拼 /chat/completions，避免重复追加 /v1 导致 404。
        if re.search(r"/v\d+$", base):
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
            "stream_options": {"include_usage": True},
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
                detail = upstream.text[:2000]
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
        # 增量解码：避免逐字节 decode 丢多字节 UTF-8（中文 3 字节会被单字节 decode 丢弃）。
        decoder = codecs.getincrementaldecoder("utf-8")(errors="ignore")

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

                buffer += decoder.decode(chunk)

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

                    usage = event.get("usage")

                    if usage:
                        yield {"type": "usage", "usage": usage}

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
