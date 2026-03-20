import json
import re
from typing import Any, Dict, List

import httpx
from openai import OpenAI

from provider_base import ProviderInterface


class DashScopeProvider(ProviderInterface):
    _SEARCH_BOOL_KEYS = {
        "forced_search",
        "enable_search_extension",
        "enable_source",
        "enable_citation",
        "prepend_search_result",
    }
    _SEARCH_PASSTHROUGH_KEYS = {
        "search_strategy",
        "citation_format",
        "intention_options",
    }
    @property
    def api_type(self) -> str:
        return "dashscope"

    def create_client(self, api_key: str, base_url: str, timeout: float = 120.0):
        # DashScope compatible-mode currently uses OpenAI SDK.
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
        request_options: Dict[str, Any] = None,
    ) -> Dict[str, Any]:
        req_opts = request_options if isinstance(request_options, dict) else {}
        cap = str(capability or "").strip().lower()
        api_key = str(getattr(client, "api_key", "") or self.provider_config.get("api_key", "") or "").strip()
        if not api_key:
            return {
                "ok": False,
                "provider": self.provider_name,
                "api_type": self.api_type,
                "capability": cap,
                "error": "missing_api_key",
                "models": [],
            }

        catalog_url = str(
            req_opts.get("models_catalog_url")
            or self.provider_config.get("models_catalog_url")
            or "https://dashscope.aliyuncs.com/api/v1/models"
        ).strip()
        page_size = self._safe_int(
            req_opts.get("models_catalog_page_size", self.provider_config.get("models_catalog_page_size", 100)),
            default=100
        )
        page_size = max(1, min(500, page_size))
        max_pages = self._safe_int(
            req_opts.get("models_catalog_max_pages", self.provider_config.get("models_catalog_max_pages", 6)),
            default=6
        )
        max_pages = max(1, min(30, max_pages))
        timeout = float(req_opts.get("models_catalog_timeout", self.provider_config.get("models_catalog_timeout", 20.0)) or 20.0)
        timeout = max(2.0, min(timeout, 60.0))

        tried_urls: List[str] = []
        last_error = ""
        rows: List[Dict[str, Any]] = []
        total = 0
        remote_page_size = page_size

        for page_no in range(1, max_pages + 1):
            ok, payload, url_used, err = self._fetch_catalog_page(
                catalog_url,
                api_key=api_key,
                page_no=page_no,
                page_size=page_size,
                timeout=timeout
            )
            tried_urls.append(url_used)
            if not ok:
                last_error = err or last_error
                if page_no == 1:
                    rows = []
                break
            page_rows, total, _, remote_page_size = self._extract_catalog_rows(payload)
            if not page_rows:
                break
            rows.extend(page_rows)
            if total > 0 and len(rows) >= total:
                break
            if len(page_rows) < max(1, remote_page_size):
                break

        normalized = self._normalize_catalog_items(rows)
        if cap:
            normalized = [m for m in normalized if self._model_matches_capability(m, cap)]
        if normalized:
            return {
                "ok": True,
                "provider": self.provider_name,
                "api_type": self.api_type,
                "capability": cap,
                "source": "dashscope_models_api",
                "tried_urls": tried_urls,
                "count": len(normalized),
                "models": normalized,
            }

        # Fallback: compatible-mode /models
        fallback = self._list_models_from_compatible_api(api_key=api_key, timeout=timeout)
        if cap:
            fallback = [m for m in fallback if self._model_matches_capability(m, cap)]
        if fallback:
            return {
                "ok": True,
                "provider": self.provider_name,
                "api_type": self.api_type,
                "capability": cap,
                "source": "compatible_mode_models_api",
                "tried_urls": tried_urls,
                "count": len(fallback),
                "models": fallback,
            }

        return {
            "ok": False,
            "provider": self.provider_name,
            "api_type": self.api_type,
            "capability": cap,
            "error": last_error or "fetch_models_failed",
            "tried_urls": tried_urls,
            "models": [],
        }

    def _safe_int(self, value: Any, default: int = 0) -> int:
        try:
            return int(value or 0)
        except Exception:
            return int(default or 0)

    def _fetch_catalog_page(
        self,
        catalog_url: str,
        *,
        api_key: str,
        page_no: int,
        page_size: int,
        timeout: float
    ):
        url = str(catalog_url or "").strip()
        if not url:
            return False, {}, "", "missing_catalog_url"
        try:
            resp = httpx.get(
                url,
                params={"page_no": int(page_no), "page_size": int(page_size)},
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout=timeout,
            )
            url_used = str(resp.request.url)
            if resp.status_code >= 400:
                return False, {}, url_used, f"http_{resp.status_code}"
            payload = resp.json() if resp.text else {}
            return True, payload, url_used, ""
        except Exception as e:
            return False, {}, url, str(e)

    def _extract_catalog_rows(self, payload: Any):
        src = payload if isinstance(payload, dict) else {}
        out = src.get("output") if isinstance(src.get("output"), dict) else {}
        rows: List[Dict[str, Any]] = []
        for key in ("models", "data", "items"):
            v = out.get(key)
            if isinstance(v, list):
                rows = [x for x in v if isinstance(x, dict)]
                break
        total = self._safe_int(out.get("total"), default=0)
        page_no = self._safe_int(out.get("page_no"), default=1)
        page_size = self._safe_int(out.get("page_size"), default=len(rows) if rows else 0)
        return rows, total, page_no, page_size

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

    def _normalize_catalog_items(self, items: List[Any]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for item in items or []:
            if not isinstance(item, dict):
                continue
            model_id = str(
                item.get("model")
                or item.get("id")
                or item.get("model_id")
                or item.get("name")
                or item.get("model_name")
                or ""
            ).strip()
            if not model_id:
                continue
            name = str(item.get("name") or item.get("model_name") or model_id).strip() or model_id
            row = {"id": model_id, "name": name, "raw": item}
            ctx = self._extract_context_window_from_item(item)
            if ctx > 0:
                row["context_window"] = ctx
            out.append(row)
        return out

    def _list_models_from_compatible_api(self, *, api_key: str, timeout: float) -> List[Dict[str, Any]]:
        base_url = str(self.provider_config.get("base_url", "") or "").strip() or "https://dashscope.aliyuncs.com/compatible-mode/v1"
        url = f"{base_url.rstrip('/')}/models"
        try:
            resp = httpx.get(
                url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                timeout=timeout
            )
            if resp.status_code >= 400:
                return []
            payload = resp.json() if resp.text else {}
            rows = payload.get("data", []) if isinstance(payload, dict) else []
            out: List[Dict[str, Any]] = []
            if isinstance(rows, list):
                for item in rows:
                    if not isinstance(item, dict):
                        continue
                    model_id = str(item.get("id") or item.get("model") or "").strip()
                    if not model_id:
                        continue
                    out.append({
                        "id": model_id,
                        "name": str(item.get("name") or model_id).strip() or model_id,
                        "raw": item
                    })
            return out
        except Exception:
            return []

    def _model_matches_capability(self, model: Dict[str, Any], capability: str) -> bool:
        cap = str(capability or "").strip().lower()
        if not cap:
            return True
        raw = model.get("raw", {}) if isinstance(model.get("raw"), dict) else {}
        model_id = str(model.get("id", "") or "").lower()
        model_name = str(model.get("name", "") or "").lower()

        if cap == "vision":
            keywords = ("vision", "image", "multimodal", "vl")
            if any(k in model_id or k in model_name for k in keywords):
                return True
            for key in ("inference_metadata", "modalities", "input_modalities", "capabilities", "features", "task_types"):
                val = raw.get(key)
                text = json.dumps(val, ensure_ascii=False).lower() if val is not None else ""
                if any(k in text for k in ("vision", "image", "multimodal", "visual")):
                    return True
            return False

        merged = f"{model_id} {model_name} {json.dumps(raw, ensure_ascii=False).lower()}"
        return cap in merged

    def use_responses_api(self, request_options=None) -> bool:
        opts = request_options if isinstance(request_options, dict) else {}
        mode = str(opts.get("search_api", opts.get("api_mode", "chat_completions"))).strip().lower()
        return mode in {"responses", "responses_api", "openai_responses"}

    def create_stream_iterator(self, *, client, request_params, use_responses_api: bool):
        if use_responses_api:
            return client.responses.create(**request_params)
        return client.chat.completions.create(**request_params)

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
                fc_name = str(getattr(fc_obj, "name", "") or "") if fc_obj is not None else ""
                fc_call_id = (
                    str(getattr(fc_obj, "call_id", "") or getattr(fc_obj, "id", "") or "")
                    if fc_obj is not None else ""
                )
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

    def should_attach_native_tools_to_chat_tools(self) -> bool:
        # DashScope chat.completions 的 web 搜索走 extra_body.enable_search，不额外拼 native web tools。
        return False

    def _merge_mode_extra_body(self, base, req_opts, use_responses_api: bool):
        out = base if isinstance(base, dict) else {}
        if not isinstance(req_opts, dict):
            return out
        common = req_opts.get("extra_body")
        if isinstance(common, dict):
            out.update(common)
        mode_extra = req_opts.get("responses_extra_body" if use_responses_api else "chat_extra_body")
        if isinstance(mode_extra, dict):
            out.update(mode_extra)
        return out

    def _build_dashscope_search_options(self, req_opts, *, for_relay: bool = False):
        if not isinstance(req_opts, dict):
            req_opts = {}

        out = {}
        raw = req_opts.get("search_options")
        if isinstance(raw, dict):
            out.update(raw)

        # 允许把常用 search_options 平铺写在 request_options 下，便于配置。
        for k in self._SEARCH_BOOL_KEYS:
            if k in req_opts:
                out[k] = self._as_bool(req_opts.get(k), default=False)
        for k in self._SEARCH_PASSTHROUGH_KEYS:
            if k in req_opts and req_opts.get(k) is not None:
                out[k] = req_opts.get(k)

        if "freshness" in req_opts and req_opts.get("freshness") is not None:
            try:
                freshness = int(req_opts.get("freshness"))
            except Exception:
                freshness = 0
            if freshness in {7, 30, 180, 365}:
                out["freshness"] = freshness

        if "assigned_site_list" in req_opts:
            sites = req_opts.get("assigned_site_list")
            if isinstance(sites, list):
                cleaned = []
                for s in sites:
                    t = str(s or "").strip()
                    if t:
                        cleaned.append(t)
                if cleaned:
                    out["assigned_site_list"] = cleaned[:25]

        if for_relay and ("forced_search" not in out):
            if self._as_bool(req_opts.get("relay_forced_search", True), default=True):
                out["forced_search"] = True

        return out

    def _sanitize_chat_search_options(self, search_options: Dict[str, Any], req_opts: Dict[str, Any]) -> Dict[str, Any]:
        """
        OpenAI-compatible chat.completions 下，不返回 search_info/citations。
        默认去掉 citation/source 专用参数，避免正文残留 [ref_x] 无法解析。
        """
        out = dict(search_options or {})
        keep_citation = self._as_bool(req_opts.get("chat_allow_citation_tags", False), default=False)
        if not keep_citation:
            out.pop("enable_source", None)
            out.pop("enable_citation", None)
            out.pop("citation_format", None)
            out.pop("prepend_search_result", None)
        return out

    def _is_native_metadata_model_supported(self, model_id: str, req_opts: Dict[str, Any]) -> bool:
        """
        Native metadata model gate.
        - If native_metadata_allow_models is configured:
          - ["*"] means allow all models.
          - otherwise require explicit match.
        - If not configured, allow all by default (let upstream API return real compatibility errors).
        """
        model = str(model_id or "").strip().lower()
        if not model:
            return False

        allow_models = req_opts.get("native_metadata_allow_models")
        if isinstance(allow_models, list) and allow_models:
            allow_set = {str(x or "").strip().lower() for x in allow_models if str(x or "").strip()}
            if "*" in allow_set:
                return True
            return model in allow_set

        return True

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
        extra_body = self._merge_mode_extra_body(extra_body, req_opts, use_responses_api)

        if enable_thinking:
            extra_body["enable_thinking"] = True

        if "enable_text_image_mixed" in req_opts:
            extra_body["enable_text_image_mixed"] = self._as_bool(
                req_opts.get("enable_text_image_mixed"), default=False
            )

        if (not use_responses_api) and enable_web_search and native_web_search_enabled:
            if self._as_bool(req_opts.get("enable_search", True), default=True):
                extra_body["enable_search"] = True
                search_options = self._build_dashscope_search_options(req_opts, for_relay=False)
                if search_options:
                    search_options = self._sanitize_chat_search_options(search_options, req_opts)
                    extra_body["search_options"] = search_options
        elif not enable_web_search:
            # UI 关闭联网时，显式移除搜索参数，避免配置误触发。
            extra_body.pop("enable_search", None)
            extra_body.pop("search_options", None)

        if extra_body:
            params["extra_body"] = extra_body
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
        req_opts = request_options if isinstance(request_options, dict) else {}
        search_api = str(req_opts.get("search_api", req_opts.get("api_mode", "chat_completions"))).strip().lower()

        if search_api in {"responses", "responses_api", "openai_responses"}:
            mode = "responses"
            tools = self._build_relay_tools(
                adapter_tools=adapter_tools,
                request_options=req_opts,
                mode=mode,
                args=args,
            )
            extra_body = self._build_relay_extra_body(req_opts, mode)
            extra_headers = self._get_req_opt_headers(req_opts)

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

            try:
                response = client.responses.create(**payload)
                extractor = extract_responses_search_payload if callable(extract_responses_search_payload) else self.extract_responses_search_payload
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
            except Exception as resp_err:
                if not self._as_bool(req_opts.get("responses_fallback_to_chat", True), default=True):
                    raise resp_err
                print(f"[SEARCH][Aliyun] Responses search failed, fallback to chat.completions: {resp_err}")

        mode = "chat_completions"
        extra_body = self._build_relay_extra_body(req_opts, mode)
        extra_body.update(self._merge_mode_extra_body({}, req_opts, use_responses_api=False))
        extra_body["enable_search"] = self._as_bool(req_opts.get("enable_search", True), default=True)
        relay_search_options = self._build_dashscope_search_options(req_opts, for_relay=True)
        if relay_search_options:
            extra_body["search_options"] = relay_search_options
        extra_headers = self._get_req_opt_headers(req_opts)
        tools = self._build_relay_tools(
            adapter_tools=adapter_tools,
            request_options=req_opts,
            mode=mode,
            args=args,
        )

        payload = {
            "model": model_id,
            "messages": [
                {"role": "system", "content": str(default_web_search_prompt or "")},
                {"role": "user", "content": str(query or "")},
            ],
            "stream": False,
        }
        if extra_body:
            payload["extra_body"] = extra_body
        if extra_headers:
            payload["extra_headers"] = extra_headers

        sent_tools = []
        send_tools_in_chat = self._as_bool(req_opts.get("chat_send_tools", True), default=True)
        if tools and send_tools_in_chat:
            payload["tools"] = tools
            sent_tools = tools

        try:
            response = client.chat.completions.create(**payload)
        except Exception as chat_err:
            fallback_no_tools = self._as_bool(req_opts.get("chat_tools_fallback_to_no_tools", True), default=True)
            if ("tools" in payload) and fallback_no_tools:
                print(f"[SEARCH][Aliyun] chat.completions with tools failed, retry without tools: {chat_err}")
                payload.pop("tools", None)
                sent_tools = []
                response = client.chat.completions.create(**payload)
            else:
                raise

        text = ""
        try:
            text = str(response.choices[0].message.content or "").strip()
        except Exception:
            text = ""
        return {
            "text": text,
            "references": [],
            "_relay_debug": self._build_relay_debug(
                model_id=model_id,
                mode=mode,
                tools=sent_tools,
                extra_body=extra_body,
                extra_headers=extra_headers,
            ),
        }

    def fetch_native_search_metadata(
        self,
        *,
        model_id: str,
        query: str,
        request_options=None,
    ) -> Dict[str, Any]:
        req_opts = request_options if isinstance(request_options, dict) else {}
        if not self._as_bool(req_opts.get("native_protocol_enabled", True), default=True):
            return {"ok": False, "error": "native_protocol_disabled"}
        if not self._is_native_metadata_model_supported(model_id, req_opts):
            return {"ok": False, "error": "native_protocol_model_unsupported"}

        api_key = str(self.provider_config.get("api_key", "") or "").strip()
        if not api_key:
            return {"ok": False, "error": "missing_api_key"}

        endpoint = str(
            req_opts.get(
                "native_search_endpoint",
                "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
            )
            or ""
        ).strip()
        if not endpoint:
            return {"ok": False, "error": "missing_native_endpoint"}

        timeout = float(req_opts.get("native_timeout_sec", 45.0) or 45.0)
        trust_env = self._as_bool(req_opts.get("native_trust_env", False), default=False)

        search_options = self._build_dashscope_search_options(req_opts, for_relay=False)
        if "forced_search" not in search_options:
            search_options["forced_search"] = self._as_bool(req_opts.get("forced_search", True), default=True)
        if "enable_source" not in search_options:
            search_options["enable_source"] = self._as_bool(req_opts.get("enable_source", True), default=True)
        if "enable_citation" not in search_options:
            search_options["enable_citation"] = self._as_bool(req_opts.get("enable_citation", True), default=True)
        if "citation_format" not in search_options:
            search_options["citation_format"] = str(req_opts.get("citation_format", "[ref_<number>]") or "[ref_<number>]")

        payload = {
            "model": model_id,
            "input": {
                "messages": [
                    {"role": "user", "content": str(query or "")},
                ]
            },
            "parameters": {
                "result_format": "message",
                "enable_search": True,
                "search_options": search_options,
            },
        }
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

        try:
            with httpx.Client(timeout=timeout, trust_env=trust_env) as client:
                resp = client.post(endpoint, headers=headers, json=payload)
            if resp.status_code >= 400:
                return {"ok": False, "error": f"native_protocol_http_{resp.status_code}: {resp.text[:300]}"}

            data = resp.json()
            output = data.get("output", {}) if isinstance(data, dict) else {}
            usage = data.get("usage", {}) if isinstance(data, dict) else {}
            request_id = str(data.get("request_id", "") or "")
            search_info = output.get("search_info", {}) if isinstance(output, dict) else {}
            search_results = search_info.get("search_results", []) if isinstance(search_info, dict) else []
            if not isinstance(search_results, list):
                search_results = []

            content = ""
            try:
                choices = output.get("choices", [])
                if isinstance(choices, list) and choices:
                    message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
                    content = str((message or {}).get("content", "") or "")
            except Exception:
                content = ""

            index_to_result: Dict[int, Dict[str, Any]] = {}
            normalized_results: List[Dict[str, Any]] = []
            for item in search_results:
                if not isinstance(item, dict):
                    continue
                idx = item.get("index")
                try:
                    idx_int = int(idx)
                except Exception:
                    idx_int = 0
                normalized = {
                    "index": idx_int,
                    "title": str(item.get("title", "") or ""),
                    "url": str(item.get("url", "") or ""),
                    "site_name": str(item.get("site_name", "") or ""),
                }
                if idx_int > 0:
                    index_to_result[idx_int] = normalized
                normalized_results.append(normalized)

            citation_nums = []
            for m in re.finditer(r"\[(?:ref_)?(\d+)\]", content or ""):
                try:
                    n = int(m.group(1))
                except Exception:
                    n = 0
                if n > 0 and n not in citation_nums:
                    citation_nums.append(n)

            citations = []
            for n in citation_nums:
                ref = index_to_result.get(n, {"index": n, "title": "", "url": "", "site_name": ""})
                citations.append(ref)

            return {
                "ok": True,
                "request_id": request_id,
                "search_results": normalized_results,
                "citations": citations,
                "usage": usage if isinstance(usage, dict) else {},
                "content_preview": content[:1200],
            }
        except Exception as e:
            return {"ok": False, "error": f"native_protocol_error: {str(e)}"}
