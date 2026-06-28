import json
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request

from openai import OpenAI

from provider_base import ProviderInterface


OPENAI_CONTEXT_WINDOW_KEYS = (
    "context_window",
    "context_length",
    "max_context_tokens",
    "max_input_tokens",
    "max_prompt_tokens",
    "input_token_limit",
    "prompt_token_limit",
    "contextsize",
    "context_size",
)
OPENAI_CONTEXT_WINDOW_MAX = 4_000_000


class OpenAIProvider(ProviderInterface):
    @property
    def api_type(self) -> str:
        return "openai"

    def _normalize_progress_logs(self, raw: Any) -> list:
        """Normalize stage logs from OpenAI-compatible image responses."""
        logs = []

        if not isinstance(raw, list):
            return logs

        for entry in raw:
            if isinstance(entry, str):
                text = entry.strip()
            elif isinstance(entry, dict):
                nested_logs = entry.get("logs")

                if isinstance(nested_logs, list):
                    logs.extend(self._normalize_progress_logs(nested_logs))
                    continue

                text = str(entry.get("log") or entry.get("message") or entry.get("text") or "").strip()
            else:
                text = str(entry or "").strip()

            if text:
                logs.append(text)

        return logs

    def _supports_image_response_format(self, model_id: str) -> bool:
        model = str(model_id or "").strip().lower()

        if model.startswith("gpt-image-1"):
            return False

        return True

    def create_client(self, api_key: str, base_url: str, timeout: float = 120.0):
        return OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
        )

    def list_models(
        self,
        *,
        client: Any,
        capability: str = "",
        request_options: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        cap = str(capability or "").strip().lower()
        req_opts = request_options if isinstance(request_options, dict) else {}
        catalog_url = str(self.provider_config.get("models_catalog_url", "") or "").strip()

        if catalog_url:
            api_key = self._resolve_api_key(client)
            if not api_key:
                return {
                    "ok": False,
                    "provider": self.provider_name,
                    "api_type": self.api_type,
                    "capability": cap,
                    "error": "missing_api_key",
                    "models": [],
                }

            ok, payload, err = self._fetch_models_payload(
                url=catalog_url,
                api_key=api_key,
                timeout=self._resolve_models_catalog_timeout(req_opts),
            )
            if not ok:
                return {
                    "ok": False,
                    "provider": self.provider_name,
                    "api_type": self.api_type,
                    "capability": cap,
                    "source": "models_catalog_url",
                    "error": err or "fetch_models_failed",
                    "models": [],
                }

            source = "models_catalog_url"
        else:
            if client is None:
                return {
                    "ok": False,
                    "provider": self.provider_name,
                    "api_type": self.api_type,
                    "capability": cap,
                    "error": "missing_client",
                    "models": [],
                }

            try:
                payload = self._to_plain_payload(client.models.list())
            except Exception as e:
                return {
                    "ok": False,
                    "provider": self.provider_name,
                    "api_type": self.api_type,
                    "capability": cap,
                    "source": "openai_models_api",
                    "error": f"fetch_models_failed: {str(e)}",
                    "models": [],
                }

            source = "openai_models_api"

        raw_items = self._extract_model_items(payload)
        if raw_items is None:
            return {
                "ok": False,
                "provider": self.provider_name,
                "api_type": self.api_type,
                "capability": cap,
                "source": source,
                "error": "invalid_models_payload",
                "models": [],
            }

        normalized = self._normalize_model_items(raw_items)
        if cap:
            normalized = [m for m in normalized if self._model_matches_capability(m, cap)]

        return {
            "ok": True,
            "provider": self.provider_name,
            "api_type": self.api_type,
            "capability": cap,
            "source": source,
            "count": len(normalized),
            "context_window_status": self._build_context_window_status(normalized),
            "models": normalized,
        }

    def use_responses_api(self, request_options=None) -> bool:
        return False

    def create_stream_iterator(self, *, client, request_params, use_responses_api: bool):
        if use_responses_api:
            return client.responses.create(**request_params)
        return client.chat.completions.create(**request_params)

    def generate_image(
        self,
        *,
        api_key: str,
        base_url: str,
        model_id: str,
        prompt: str,
        size: str = "1024x1024",
        n: int = 1,
        quality: str = "",
        response_format: str = "b64_json",
        timeout: float = 120.0,
        extra_body=None,
    ):
        key = str(api_key or "").strip()
        url_base = str(base_url or "").strip().rstrip("/")
        model = str(model_id or "").strip()
        text = str(prompt or "").strip()

        if not key:
            raise ValueError("生图 API Key 不能为空")

        if not url_base:
            raise ValueError("生图 Base URL 不能为空")

        if not model:
            raise ValueError("生图模型不能为空")

        if not text:
            raise ValueError("生图提示词不能为空")

        try:
            image_count = int(n or 1)
        except Exception:
            image_count = 1
        image_count = max(1, min(image_count, 4))

        req_body = {
            "model": model,
            "prompt": text,
            "n": image_count,
            "size": str(size or "1024x1024").strip() or "1024x1024",
        }
        fmt = str(response_format or "").strip()

        if fmt and self._supports_image_response_format(model):
            req_body["response_format"] = fmt

        q = str(quality or "").strip()
        if q and q.lower() != "auto":
            req_body["quality"] = q

        if isinstance(extra_body, dict):
            for k, v in extra_body.items():
                key_text = str(k or "").strip()
                if key_text:
                    req_body[key_text] = v

        endpoint = f"{url_base}/images/generations"
        raw = json.dumps(req_body, ensure_ascii=False).encode("utf-8")
        req = urllib_request.Request(
            endpoint,
            data=raw,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with urllib_request.urlopen(req, timeout=float(timeout or 120.0)) as resp:
                payload_text = resp.read().decode("utf-8")
        except urllib_error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace") if e.fp else str(e)
            raise ValueError(f"生图接口 HTTP {e.code}: {detail}")
        except Exception as e:
            raise ValueError(f"生图接口请求失败: {str(e)}")

        try:
            payload = json.loads(payload_text)
        except Exception:
            raise ValueError("生图接口返回的不是 JSON")

        data = payload.get("data", []) if isinstance(payload, dict) else []
        if not isinstance(data, list):
            raise ValueError("生图接口返回缺少 data 数组")

        images = []
        progress_logs = []

        def add_progress(logs):
            for text in logs:
                if text not in progress_logs:
                    progress_logs.append(text)

        add_progress(self._normalize_progress_logs(payload.get("progress", [])) if isinstance(payload, dict) else [])

        for item in data:
            if not isinstance(item, dict):
                continue

            b64_json = str(
                item.get("b64_json")
                or item.get("b64")
                or item.get("image_base64")
                or ""
            ).strip()
            image_url = str(item.get("url") or item.get("image_url") or "").strip()
            revised_prompt = str(item.get("revised_prompt") or "").strip()
            item_progress = self._normalize_progress_logs(item.get("progress", []))
            add_progress(item_progress)

            images.append({
                "b64_json": b64_json,
                "url": image_url,
                "revised_prompt": revised_prompt,
                "progress": item_progress,
                "raw": item,
            })

        return {
            "ok": True,
            "provider": self.provider_name,
            "api_type": self.api_type,
            "model": model,
            "images": images,
            "progress": progress_logs,
            "raw_response": payload,
        }

    def iter_stream_events(self, chunks, *, use_responses_api: bool, native_web_search_enabled: bool = False):
        if not use_responses_api:
            yield from self._iter_openai_chat_stream_events(chunks)
            return

        def _obj_get(obj: Any, key: str, default: str = "") -> str:
            if obj is None:
                return default
            try:
                if isinstance(obj, dict):
                    return str(obj.get(key, default) or default)
                extra = getattr(obj, "model_extra", None)
                if isinstance(extra, dict) and key in extra:
                    return str(extra.get(key, default) or default)
            except Exception:
                pass
            try:
                return str(getattr(obj, key, default) or default)
            except Exception:
                return default

        def _extract_response_id(chunk_obj: Any, response_obj: Any) -> str:
            candidates = [
                _obj_get(response_obj, "id", ""),
                _obj_get(chunk_obj, "response_id", ""),
                _obj_get(chunk_obj, "id", ""),
            ]
            for candidate in candidates:
                rid = str(candidate or "").strip()
                if rid.startswith("resp_"):
                    return rid
            for candidate in candidates:
                rid = str(candidate or "").strip()
                if rid:
                    return rid
            return ""

        has_emitted_content_delta = False
        has_received_detail_reasoning = False

        for chunk in chunks:
            response_obj = getattr(chunk, "response", None)
            response_id = _extract_response_id(chunk, response_obj)
            if response_id:
                yield {"type": "response_id", "response_id": response_id}

            chunk_type = str(getattr(chunk, "type", "") or "")

            if chunk_type in {"response.output_text.delta", "response.message.delta"}:
                delta = getattr(chunk, "delta", "")
                if delta:
                    has_emitted_content_delta = True
                    yield {"type": "content_delta", "delta": str(delta)}
                continue

            if ("reasoning" in chunk_type) and ("delta" in chunk_type):
                is_detail = ("reasoning_text.delta" in chunk_type) or (chunk_type == "response.reasoning.delta")
                is_summary = "reasoning_summary_text.delta" in chunk_type
                if is_detail:
                    has_received_detail_reasoning = True
                if is_summary and has_received_detail_reasoning:
                    continue
                delta = getattr(chunk, "delta", "")
                if delta:
                    yield {"type": "reasoning_delta", "delta": str(delta)}
                continue

            if "function_call_arguments.delta" in chunk_type:
                arg_delta = getattr(chunk, "delta", "")
                fc_obj = (
                    getattr(chunk, "function_call", None)
                    or getattr(chunk, "item", None)
                    or getattr(chunk, "output_item", None)
                )
                fc_name = ""
                fc_call_id = ""
                if fc_obj is not None:
                    fc_name = str(getattr(fc_obj, "name", "") or "")
                    fc_call_id = str(getattr(fc_obj, "call_id", "") or getattr(fc_obj, "id", "") or "")
                yield {
                    "type": "function_call_delta",
                    "name": fc_name,
                    "call_id": fc_call_id,
                    "arguments_delta": str(arg_delta or ""),
                }
                continue

            if chunk_type == "response.output_item.done":
                item = getattr(chunk, "item", None)
                if item is None:
                    continue
                item_type = str(getattr(item, "type", "") or "")
                if "web_search" in item_type:
                    action = getattr(item, "action", None)
                    query = str(getattr(action, "query", "") or "").strip() if action is not None else ""
                    yield {
                        "type": "web_search",
                        "status": "searching",
                        "query": query,
                        "content": f"searching: {query}" if query else "searching",
                    }
                elif (item_type == "text") and (not has_emitted_content_delta):
                    text_content = getattr(item, "content", "")
                    if text_content:
                        has_emitted_content_delta = True
                        yield {"type": "content_delta", "delta": str(text_content)}
                continue

            if ("web_search_call.searching" in chunk_type) or ("web_search_call.completed" in chunk_type):
                status = "searching" if "searching" in chunk_type else "completed"
                ws_obj = getattr(chunk, "web_search_call", None) or getattr(chunk, "web_search", None)
                query = str(getattr(ws_obj, "query", "") or "").strip() if ws_obj is not None else ""
                yield {
                    "type": "web_search",
                    "status": status,
                    "query": query,
                    "content": f"{status}: {query}" if query else status,
                }
                continue

            if chunk_type == "response.completed":
                if response_obj is not None:
                    output_items = getattr(response_obj, "output", None) or []
                    for item in output_items:
                        if str(getattr(item, "type", "") or "") != "function_call":
                            continue
                        name = str(getattr(item, "name", "") or "").strip()
                        if native_web_search_enabled and name in {"web_search", "web_extractor", "code_interpreter"}:
                            yield {
                                "type": "web_search",
                                "status": "completed",
                                "query": name,
                                "content": name,
                            }
                            continue
                        yield {
                            "type": "function_call",
                            "name": name,
                            "arguments": str(getattr(item, "arguments", "{}") or "{}"),
                            "call_id": str(getattr(item, "call_id", "") or ""),
                        }

    def should_disable_function_tools(self, model_name: str = "") -> bool:
        low = str(model_name or "").lower()
        risky_provider = self.provider_name in {"github", "suanli"}
        risky_model = any(x in low for x in ["-reasoning", "deepseek-r1", "qwq-32b"])
        return bool(risky_provider and risky_model)
