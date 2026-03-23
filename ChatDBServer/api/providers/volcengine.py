import json
import ssl
from typing import Any, Dict, List, Optional
from urllib import request as urllib_request, error as urllib_error, parse as urllib_parse

from openai import OpenAI
from volcenginesdkarkruntime import Ark

from provider_base import ProviderInterface


class VolcengineProvider(ProviderInterface):
    @property
    def api_type(self) -> str:
        return "volcengine"

    def create_client(self, api_key: str, base_url: str, timeout: float = 120.0):
        return Ark(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
            max_retries=2,
        )

    def create_embedding_client(self, api_key: str, base_url: str, timeout: float = 120.0):
        # Embeddings path on volcengine side is OpenAI-compatible.
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
        api_key = str(getattr(client, "api_key", "") or self.provider_config.get("api_key", "") or "").strip()
        base_url = str(getattr(client, "base_url", "") or self.provider_config.get("base_url", "") or "").strip()
        if not api_key:
            return {
                "ok": False,
                "provider": self.provider_name,
                "api_type": self.api_type,
                "capability": str(capability or "").strip().lower(),
                "error": "missing_api_key",
                "models": [],
            }
        if not base_url:
            base_url = "https://ark.cn-beijing.volces.com/api/v3"

        cap = str(capability or "").strip().lower()
        tried_urls: List[str] = []
        candidates = [
            f"{base_url.rstrip('/')}/models",
            f"{base_url.rstrip('/')}/foundation_models",
            f"{base_url.rstrip('/')}/model/list",
        ]

        raw_items = None
        last_error = ""
        for url in candidates:
            tried_urls.append(url)
            ok, payload, err = self._fetch_models_payload(url=url, api_key=api_key)
            if ok:
                raw_items = self._extract_model_items(payload)
                if raw_items is not None:
                    break
            last_error = err or last_error

        if raw_items is None:
            return {
                "ok": False,
                "provider": self.provider_name,
                "api_type": self.api_type,
                "capability": cap,
                "error": last_error or "fetch_models_failed",
                "tried_urls": tried_urls,
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
            "source": "volcengine_api",
            "tried_urls": tried_urls,
            "count": len(normalized),
            "models": normalized,
        }

    def supports_tokenization(self) -> bool:
        return True

    def tokenize_texts(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        texts: List[str],
        timeout: float = 20.0,
    ) -> Dict[str, Any]:
        model_id = str(model or "").strip()
        clean_texts = [str(x or "") for x in (texts or [])]
        if not api_key:
            return {
                "ok": False,
                "provider": self.provider_name,
                "model": model_id,
                "totals": [],
                "raw": None,
                "error": "missing_api_key",
            }
        if not model_id:
            return {
                "ok": False,
                "provider": self.provider_name,
                "model": model_id,
                "totals": [],
                "raw": None,
                "error": "missing_model",
            }
        if not clean_texts:
            return {
                "ok": True,
                "provider": self.provider_name,
                "model": model_id,
                "totals": [],
                "raw": {"data": []},
                "error": "",
            }

        endpoint = self._resolve_tokenization_endpoint(base_url)
        ctx = self._build_ssl_context()
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model_id,
            "text": clean_texts if len(clean_texts) > 1 else clean_texts[0],
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib_request.Request(endpoint, method="POST", headers=headers, data=body)

        try:
            with urllib_request.urlopen(req, timeout=float(timeout or 20.0), context=ctx) as resp:
                raw_text = resp.read().decode("utf-8", errors="replace")
                payload_obj = json.loads(raw_text) if raw_text.strip() else {}
        except urllib_error.HTTPError as e:
            try:
                err_body = e.read().decode("utf-8", errors="replace")
            except Exception:
                err_body = ""
            return {
                "ok": False,
                "provider": self.provider_name,
                "model": model_id,
                "totals": [],
                "raw": None,
                "error": f"http_{int(getattr(e, 'code', 500) or 500)}: {err_body[:240]}",
            }
        except urllib_error.URLError as e:
            reason = getattr(e, "reason", e)
            if isinstance(reason, ssl.SSLCertVerificationError):
                return {
                    "ok": False,
                    "provider": self.provider_name,
                    "model": model_id,
                    "totals": [],
                    "raw": None,
                    "error": (
                        f"ssl_verify_failed: {reason}. "
                        "可在 models.json 的 provider 下配置 ca_bundle，"
                        "或临时设置 tls_verify=false（仅测试环境）"
                    ),
                }
            return {
                "ok": False,
                "provider": self.provider_name,
                "model": model_id,
                "totals": [],
                "raw": None,
                "error": str(e),
            }
        except Exception as e:
            return {
                "ok": False,
                "provider": self.provider_name,
                "model": model_id,
                "totals": [],
                "raw": None,
                "error": str(e),
            }

        totals = self._extract_tokenization_totals(payload_obj, expected_count=len(clean_texts))
        return {
            "ok": len(totals) == len(clean_texts),
            "provider": self.provider_name,
            "model": str(payload_obj.get("model", model_id) if isinstance(payload_obj, dict) else model_id),
            "totals": totals,
            "raw": payload_obj,
            "error": "" if len(totals) == len(clean_texts) else "invalid_tokenization_response",
        }

    def use_responses_api(self, request_options=None) -> bool:
        # Ark runtime path in Nexora is Responses-first.
        return True

    def create_stream_iterator(self, *, client, request_params, use_responses_api: bool):
        if not use_responses_api:
            return client.chat.completions.create(**request_params)
        return client.responses.create(**request_params)

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
            for c in candidates:
                rid = str(c or "").strip()
                if rid.startswith("resp_"):
                    return rid
            # fallback: first non-empty candidate
            for c in candidates:
                rid = str(c or "").strip()
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
                        "status": "正在搜索",
                        "query": query,
                        "content": f"正在搜索: {query}" if query else "正在搜索",
                    }
                elif (item_type == "text") and (not has_emitted_content_delta):
                    text_content = getattr(item, "content", "")
                    if text_content:
                        has_emitted_content_delta = True
                        yield {"type": "content_delta", "delta": str(text_content)}
                continue

            if ("web_search_call.searching" in chunk_type) or ("web_search_call.completed" in chunk_type):
                status = "正在搜索" if "searching" in chunk_type else "搜索完成"
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
                                "status": "搜索完成",
                                "query": "",
                                "content": f"原生联网搜索已触发: {name}",
                            }
                            continue
                        yield {
                            "type": "function_call",
                            "name": name,
                            "arguments": str(getattr(item, "arguments", "{}") or "{}"),
                            "call_id": str(getattr(item, "call_id", "") or ""),
                        }

                    usage_obj = getattr(response_obj, "usage", None)
                    if usage_obj is not None:
                        yield {
                            "type": "usage",
                            "usage": usage_obj,
                            "input_tokens": int(getattr(usage_obj, "input_tokens", 0) or 0),
                            "output_tokens": int(getattr(usage_obj, "output_tokens", 0) or 0),
                            "total_tokens": int(getattr(usage_obj, "total_tokens", 0) or 0),
                        }

    def should_retry_context_mismatch_with_full_input(self, error_text: str, use_responses_api: bool) -> bool:
        if not use_responses_api:
            return False
        err = str(error_text or "")
        return ("previous_response_id" in err) and ("400" in err)

    def should_append_tool_completion_hint(self, use_responses_api: bool) -> bool:
        return bool(use_responses_api)

    def apply_request_options(
        self,
        params,
        *,
        use_responses_api,
        enable_thinking,
        enable_web_search,
        native_web_search_enabled,
        request_options=None,
        model_name="",
    ):
        req_opts = request_options if isinstance(request_options, dict) else {}

        extra_body = params.get("extra_body", {})
        if not isinstance(extra_body, dict):
            extra_body = {}
        mode_key = "responses_extra_body" if use_responses_api else "chat_extra_body"
        base_extra = req_opts.get("extra_body")
        if isinstance(base_extra, dict):
            extra_body.update(json.loads(json.dumps(base_extra)))
        mode_extra = req_opts.get(mode_key)
        if isinstance(mode_extra, dict):
            extra_body.update(json.loads(json.dumps(mode_extra)))
        if extra_body:
            params["extra_body"] = extra_body

        extra_headers = self._get_req_opt_headers(req_opts)
        if extra_headers:
            params["extra_headers"] = extra_headers

        if use_responses_api:
            params["thinking"] = {"type": "enabled" if enable_thinking else "disabled"}

            # Ark Responses API cache controls:
            # request_options:
            # - responses_caching: {"type":"enabled|disabled","prefix":true|false}
            # - caching: same as responses_caching
            # - cache_enabled/cache_prefix: shorthand
            cache_cfg_raw = req_opts.get("responses_caching", req_opts.get("caching"))
            cache_cfg = {}
            if isinstance(cache_cfg_raw, dict):
                c_type = str(cache_cfg_raw.get("type", "") or "").strip().lower()
                if c_type in {"enabled", "disabled"}:
                    cache_cfg["type"] = c_type
                if "prefix" in cache_cfg_raw:
                    cache_cfg["prefix"] = bool(cache_cfg_raw.get("prefix"))
            if "cache_enabled" in req_opts and "type" not in cache_cfg:
                cache_cfg["type"] = "enabled" if self._as_bool(req_opts.get("cache_enabled"), default=False) else "disabled"
            if "cache_prefix" in req_opts and "prefix" not in cache_cfg:
                cache_cfg["prefix"] = self._as_bool(req_opts.get("cache_prefix"), default=True)

            # Guard 1: Ark rejects `caching` when built-in tools are present.
            # Built-in tools are non-function tool specs (e.g. web_search/web_extractor/...).
            tools_payload = params.get("tools", [])
            has_builtin_tools = (
                isinstance(tools_payload, list)
                and any(
                    isinstance(t, dict) and str(t.get("type", "")).strip() and str(t.get("type", "")).strip() != "function"
                    for t in tools_payload
                )
            )

            # Guard 2: Ark rejects `caching.prefix` when max_output_tokens is provided.
            if (
                "prefix" in cache_cfg
                and "max_output_tokens" in params
                and params.get("max_output_tokens") is not None
            ):
                cache_cfg.pop("prefix", None)

            if cache_cfg and (not has_builtin_tools):
                params["caching"] = cache_cfg
            else:
                params.pop("caching", None)

            if "store" in req_opts and "store" not in params:
                params["store"] = self._as_bool(req_opts.get("store"), default=False)
            if "responses_store" in req_opts and "store" not in params:
                params["store"] = self._as_bool(req_opts.get("responses_store"), default=False)
            if "expire_at" in req_opts and "expire_at" not in params:
                try:
                    params["expire_at"] = int(req_opts.get("expire_at"))
                except Exception:
                    pass
            if "responses_expire_at" in req_opts and "expire_at" not in params:
                try:
                    params["expire_at"] = int(req_opts.get("responses_expire_at"))
                except Exception:
                    pass
        return params

    def relay_web_search(
        self,
        *,
        client,
        model_id,
        query,
        args,
        request_options=None,
        adapter_tools=None,
        default_web_search_prompt="",
        extract_responses_search_payload=None,
    ):
        extractor = extract_responses_search_payload if callable(extract_responses_search_payload) else self.extract_responses_search_payload

        mode = "responses"
        tools = self._build_relay_tools(
            adapter_tools=adapter_tools,
            request_options=request_options,
            mode=mode,
            args=args,
        )
        extra_body = self._build_relay_extra_body(request_options, mode)
        extra_headers = self._get_req_opt_headers(request_options)

        payload = {
            "model": model_id,
            "input": [
                {"role": "system", "content": [{"type": "input_text", "text": str(default_web_search_prompt or "")}]},
                {"role": "user", "content": [{"type": "input_text", "text": str(query or "")}]},
            ],
            "tools": tools,
            "stream": False,
        }
        if extra_body:
            payload["extra_body"] = extra_body
        if extra_headers:
            payload["extra_headers"] = extra_headers

        response = client.responses.create(**payload)
        out = extractor(response)
        if not isinstance(out, dict):
            out = {"text": str(out or ""), "references": []}
        out["_relay_debug"] = self._build_relay_debug(
            model_id=model_id,
            mode=mode,
            tools=tools,
            extra_body=extra_body,
            extra_headers=extra_headers,
        )
        return out

    def analyze_image(
        self,
        *,
        client: Any,
        model_id: str,
        prompt: str,
        image_url: Optional[str] = None,
        image_b64: Optional[str] = None,
        image_mime: str = "image/png",
        system_prompt: str = "",
        extra_body: Optional[Dict[str, Any]] = None,
        stream: bool = False,
    ) -> Dict[str, Any]:
        """
        Volcengine multimodal image understanding via Responses API.
        Supports:
        - remote URL image: image_url
        - base64 image: image_b64 (raw b64 or data URL)
        """
        img_input = str(image_url or "").strip()
        if not img_input:
            b64 = str(image_b64 or "").strip()
            if not b64:
                raise ValueError("image_url 或 image_b64 至少提供一个")
            if b64.startswith("data:"):
                img_input = b64
            else:
                mime = str(image_mime or "image/png").strip() or "image/png"
                img_input = f"data:{mime};base64,{b64}"

        content = [
            {"type": "input_image", "image_url": img_input},
            {"type": "input_text", "text": str(prompt or "").strip() or "请描述这张图片。"},
        ]
        input_payload = []
        sys_text = str(system_prompt or "").strip()
        if sys_text:
            input_payload.append(
                {
                    "role": "system",
                    "content": [{"type": "input_text", "text": sys_text}],
                }
            )
        input_payload.append({"role": "user", "content": content})

        req: Dict[str, Any] = {
            "model": str(model_id or "").strip(),
            "input": input_payload,
            "stream": bool(stream),
        }
        if isinstance(extra_body, dict) and extra_body:
            req["extra_body"] = extra_body

        resp = client.responses.create(**req)
        parsed = self.extract_responses_search_payload(resp)
        return {
            "ok": True,
            "provider": self.provider_name,
            "api_type": self.api_type,
            "model": str(model_id or "").strip(),
            "text": str(parsed.get("text", "") or "").strip(),
            "references": parsed.get("references", []),
            "raw_response": resp,
        }

    def _fetch_models_payload(self, *, url: str, api_key: str):
        ctx = self._build_ssl_context()
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        req = urllib_request.Request(url, method="GET", headers=headers)
        try:
            with urllib_request.urlopen(req, timeout=20, context=ctx) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                payload = json.loads(raw) if raw.strip() else {}
                return True, payload, ""
        except urllib_error.HTTPError as e:
            try:
                body = e.read().decode("utf-8", errors="replace")
            except Exception:
                body = ""
            return False, None, f"http_{int(getattr(e, 'code', 500) or 500)}: {body[:240]}"
        except urllib_error.URLError as e:
            reason = getattr(e, "reason", e)
            if isinstance(reason, ssl.SSLCertVerificationError):
                return False, None, (
                    f"ssl_verify_failed: {reason}. "
                    "可在 models.json 的 provider 下配置 ca_bundle，"
                    "或临时设置 tls_verify=false（仅测试环境）"
                )
            return False, None, str(e)
        except Exception as e:
            return False, None, str(e)

    def _resolve_tokenization_endpoint(self, base_url: str) -> str:
        default_url = "https://ark.cn-beijing.volces.com/api/v3/tokenization"
        raw = str(base_url or "").strip()
        if not raw:
            return default_url
        try:
            parsed = urllib_parse.urlparse(raw)
            if not parsed.scheme or not parsed.netloc:
                return default_url
            return f"{parsed.scheme}://{parsed.netloc}/api/v3/tokenization"
        except Exception:
            return default_url

    def _extract_tokenization_totals(self, payload_obj: Any, expected_count: int) -> List[int]:
        out: List[int] = []
        if isinstance(payload_obj, dict):
            data = payload_obj.get("data")
        else:
            data = None

        if isinstance(data, dict):
            data = [data]
        if not isinstance(data, list):
            return [0 for _ in range(max(0, int(expected_count or 0)))]

        for idx in range(max(0, int(expected_count or 0))):
            item = data[idx] if idx < len(data) else {}
            if not isinstance(item, dict):
                out.append(0)
                continue
            try:
                out.append(max(0, int(item.get("total_tokens", 0) or 0)))
            except Exception:
                out.append(0)
        return out

    def _build_ssl_context(self):
        verify = self._as_bool(self.provider_config.get("tls_verify", True), default=True)
        if not verify:
            return ssl._create_unverified_context()

        ca_bundle = str(self.provider_config.get("ca_bundle", "") or "").strip()
        if ca_bundle:
            try:
                return ssl.create_default_context(cafile=ca_bundle)
            except Exception:
                pass

        try:
            import certifi  # type: ignore
            return ssl.create_default_context(cafile=certifi.where())
        except Exception:
            return ssl.create_default_context()

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
            if isinstance(item, str):
                model_id = item.strip()
                if not model_id:
                    continue
                out.append({"id": model_id, "name": model_id, "raw": {"id": model_id}})
                continue
            if not isinstance(item, dict):
                continue
            model_id = str(
                item.get("id")
                or item.get("model_id")
                or item.get("name")
                or item.get("model")
                or ""
            ).strip()
            if not model_id:
                continue
            name = str(item.get("name") or item.get("display_name") or model_id).strip() or model_id
            row = {"id": model_id, "name": name, "raw": item}
            ctx = self._extract_context_window_from_item(item)
            if ctx > 0:
                row["context_window"] = ctx
            out.append(row)
        return out

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

        def _to_int(v: Any) -> int:
            try:
                n = int(v)
            except Exception:
                return 0
            if n < 1024:
                return 0
            return min(n, 4_000_000)

        # BFS search over nested dict/list payload
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
            keywords = ("vision", "image", "multimodal", "vl", "seed-1-8")
            if any(k in model_id or k in model_name for k in keywords):
                return True
            for key in ("modalities", "input_modalities", "capabilities", "task_types", "ability"):
                val = raw.get(key)
                text = json.dumps(val, ensure_ascii=False).lower() if val is not None else ""
                if any(k in text for k in ("vision", "image", "multimodal", "visual")):
                    return True
            return False

        # fallback: fuzzy search capability text in id/name/raw
        merged = f"{model_id} {model_name} {json.dumps(raw, ensure_ascii=False).lower()}"
        return cap in merged
