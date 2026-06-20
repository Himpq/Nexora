import json
import re
from typing import Any, Dict, List, Optional
from urllib import error as urllib_error
from urllib import request as urllib_request

from openai import OpenAI

from provider_base import ProviderInterface


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

    def _resolve_api_key(self, client: Any) -> str:
        candidates = [
            getattr(client, "api_key", "") if client is not None else "",
            self.provider_config.get("api_key", ""),
        ]

        for candidate in candidates:
            text = str(candidate or "").strip()
            if text:
                return text

        return ""

    def _resolve_models_catalog_timeout(self, request_options: Dict[str, Any]) -> float:
        raw = request_options.get("models_catalog_timeout", self.provider_config.get("models_catalog_timeout", 20.0))
        try:
            timeout = float(raw or 20.0)
        except Exception:
            timeout = 20.0

        return max(2.0, min(timeout, 60.0))

    def _fetch_models_payload(self, *, url: str, api_key: str, timeout: float):
        req = urllib_request.Request(
            url,
            method="GET",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )

        try:
            with urllib_request.urlopen(req, timeout=float(timeout or 20.0)) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                payload = json.loads(raw) if raw.strip() else {}
                return True, payload, ""
        except urllib_error.HTTPError as e:
            try:
                body = e.read().decode("utf-8", errors="replace")
            except Exception:
                body = ""

            return False, None, f"http_{int(getattr(e, 'code', 500) or 500)}: {body[:240]}"
        except Exception as e:
            return False, None, str(e)

    def _to_plain_payload(self, obj: Any) -> Any:
        if obj is None or isinstance(obj, (str, int, float, bool)):
            return obj

        if isinstance(obj, dict):
            return {str(k): self._to_plain_payload(v) for k, v in obj.items()}

        if isinstance(obj, (list, tuple)):
            return [self._to_plain_payload(item) for item in obj]

        model_dump = getattr(obj, "model_dump", None)
        if callable(model_dump):
            try:
                return model_dump(mode="json")
            except TypeError:
                try:
                    return model_dump()
                except Exception:
                    pass
            except Exception:
                pass

        dict_fn = getattr(obj, "dict", None)
        if callable(dict_fn):
            try:
                return dict_fn()
            except Exception:
                pass

        data = getattr(obj, "data", None)
        if data is not None:
            return {"data": self._to_plain_payload(data)}

        return str(obj)

    def _extract_model_items(self, payload: Any):
        if isinstance(payload, list):
            return payload

        if not isinstance(payload, dict):
            return None

        for key in ("data", "models", "items"):
            items = payload.get(key)
            if isinstance(items, list):
                return items

        result = payload.get("result")
        if isinstance(result, dict):
            for key in ("data", "models", "items"):
                items = result.get(key)
                if isinstance(items, list):
                    return items

        return None

    def _normalize_model_items(self, items: List[Any]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []

        for item in items:
            plain_item = self._to_plain_payload(item)
            if isinstance(plain_item, str):
                model_id = plain_item.strip()
                if not model_id:
                    continue

                row = {"id": model_id, "name": model_id, "raw": {"id": model_id}}
                self._attach_model_feature_flags(row)
                out.append(row)
                continue

            if not isinstance(plain_item, dict):
                continue

            model_id = str(
                plain_item.get("id")
                or plain_item.get("model_id")
                or plain_item.get("model")
                or plain_item.get("name")
                or ""
            ).strip()
            if not model_id:
                continue

            name = str(plain_item.get("name") or plain_item.get("display_name") or model_id).strip() or model_id
            row = {"id": model_id, "name": name, "raw": plain_item}
            ctx = self._extract_context_window_from_item(plain_item)
            if ctx > 0:
                row["context_window"] = ctx

            self._attach_model_feature_flags(row)
            out.append(row)

        return out

    def _attach_model_feature_flags(self, row: Dict[str, Any]) -> None:
        has_vision = self._model_matches_capability(row, "vision")
        if has_vision:
            row["vision"] = True
            row["features"] = ["Chat", "Vision"]
        else:
            row["vision"] = False
            row["features"] = ["Chat"]

    def _extract_context_window_from_item(self, item: Dict[str, Any]) -> int:
        if not isinstance(item, dict):
            return 0

        target_keys = {
            "context_window",
            "context_length",
            "max_context_tokens",
            "max_input_tokens",
            "max_prompt_tokens",
            "input_token_limit",
            "prompt_token_limit",
            "contextsize",
            "context_size",
        }

        def _to_int(value: Any) -> int:
            try:
                n = int(value)
            except Exception:
                return 0

            if n < 1024:
                return 0

            return min(n, 4_000_000)

        queue: List[Any] = [item]
        visited = 0

        while queue and visited < 200:
            visited += 1
            cur = queue.pop(0)

            if isinstance(cur, dict):
                for k, v in cur.items():
                    key = str(k or "").strip().lower()
                    if key in target_keys:
                        n = _to_int(v)
                        if n > 0:
                            return n

                    if isinstance(v, (dict, list)):
                        queue.append(v)

            elif isinstance(cur, list):
                queue.extend(cur[:40])

        return 0

    def _model_matches_capability(self, model: Dict[str, Any], capability: str) -> bool:
        cap = str(capability or "").strip().lower()
        if not cap:
            return True

        raw = model.get("raw", {}) if isinstance(model.get("raw"), dict) else {}
        model_id = str(model.get("id", "") or "").lower()
        model_name = str(model.get("name", "") or "").lower()

        if cap == "vision":
            return self._model_supports_vision(model_id=model_id, model_name=model_name, raw=raw)

        merged = f"{model_id} {model_name} {json.dumps(raw, ensure_ascii=False).lower()}"
        return cap in merged

    def _model_supports_vision(self, *, model_id: str, model_name: str, raw: Dict[str, Any]) -> bool:
        configured_ids = self._configured_vision_model_ids()
        if model_id in configured_ids or model_name in configured_ids:
            return True

        if self._matches_configured_vision_pattern(model_id) or self._matches_configured_vision_pattern(model_name):
            return True

        if self._raw_metadata_has_vision(raw):
            return True

        return self._model_name_has_vision_marker(model_id) or self._model_name_has_vision_marker(model_name)

    def _configured_vision_model_ids(self) -> set:
        raw_ids = self.provider_config.get("vision_model_ids", [])
        if isinstance(raw_ids, str):
            raw_ids = [x.strip() for x in raw_ids.split(",")]

        if not isinstance(raw_ids, list):
            return set()

        return {str(x or "").strip().lower() for x in raw_ids if str(x or "").strip()}

    def _matches_configured_vision_pattern(self, text: str) -> bool:
        patterns = self.provider_config.get("vision_model_patterns", [])
        if isinstance(patterns, str):
            patterns = [x.strip() for x in patterns.split(",")]

        if not isinstance(patterns, list):
            return False

        value = str(text or "").strip()
        if not value:
            return False

        for pattern in patterns:
            p = str(pattern or "").strip()
            if not p:
                continue

            try:
                if re.search(p, value, re.IGNORECASE):
                    return True
            except re.error:
                if p.lower() in value.lower():
                    return True

        return False

    def _raw_metadata_has_vision(self, raw: Dict[str, Any]) -> bool:
        if not isinstance(raw, dict):
            return False

        vision_terms = ("vision", "visual", "image", "multimodal", "multi-modal", "vl")
        metadata_keys = (
            "modalities",
            "input_modalities",
            "capabilities",
            "features",
            "task_types",
            "ability",
            "abilities",
            "supported_modalities",
            "supported_input_modalities",
        )

        for key in metadata_keys:
            val = raw.get(key)
            text = json.dumps(val, ensure_ascii=False).lower() if val is not None else ""
            if any(term in text for term in vision_terms):
                return True

        owner = str(raw.get("owned_by") or raw.get("owner") or raw.get("provider") or "").strip().lower()
        if owner and any(term in owner for term in ("vision", "visual", "4v", "vl")):
            return True

        return False

    def _model_name_has_vision_marker(self, text: str) -> bool:
        value = str(text or "").strip().lower()
        if not value:
            return False

        patterns = (
            r"(^|[-_./:])vl($|[-_./:])",
            r"(^|[-_./:])vision($|[-_./:])",
            r"(^|[-_./:])visual($|[-_./:])",
            r"(^|[-_./:])multimodal($|[-_./:])",
            r"(^|[-_./:])llava($|[-_./:])",
            r"(^|[-_./:])minicpm-v($|[-_./:])",
            r"qwen[0-9.]*-vl",
            r"glm-[0-9.]+v($|[-_./:])",
            r"gpt-4o($|[-_./:])",
        )

        return any(re.search(pattern, value, re.IGNORECASE) for pattern in patterns)

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
