import json
import os
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

import prompts


class ProviderInterface(ABC):
    """
    Nexora provider interface.

    All provider adapters should expose a unified constructor and
    standardized capability probes, so Model does not branch on vendor details.
    """

    def __init__(self, provider_name: str, provider_config: Optional[Dict[str, Any]] = None):
        self.provider_name = str(provider_name or "").strip()
        self.provider_config = provider_config if isinstance(provider_config, dict) else {}

    @property
    @abstractmethod
    def api_type(self) -> str:
        """Provider API type key, e.g. 'volcengine', 'dashscope', 'openai'."""
        raise NotImplementedError

    @abstractmethod
    def create_client(self, api_key: str, base_url: str, timeout: float = 120.0):
        """Create SDK client instance."""
        raise NotImplementedError

    def create_embedding_client(self, api_key: str, base_url: str, timeout: float = 120.0):
        """
        Create client for embeddings path.
        Default uses chat client creator; providers may override.
        """
        return self.create_client(api_key=api_key, base_url=base_url, timeout=timeout)

    def create_chat_completion(
        self,
        *,
        client: Any,
        model: str,
        messages: List[Dict[str, Any]],
        stream: bool = False,
        **kwargs
    ):
        """
        Non-stream/stream chat completion helper.
        """
        return client.chat.completions.create(
            model=model,
            messages=messages,
            stream=stream,
            **kwargs
        )

    def list_models(
        self,
        *,
        client: Any,
        capability: str = "",
        request_options: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        List provider models. Capability is optional (e.g. "vision").
        """
        return {
            "ok": False,
            "provider": self.provider_name,
            "api_type": self.api_type,
            "capability": str(capability or "").strip().lower(),
            "error": "list_models_not_supported",
            "models": []
        }

    def supports_tokenization(self) -> bool:
        """
        Whether provider exposes an external tokenization/count API.
        """
        return False

    def tokenize_texts(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        texts: List[str],
        timeout: float = 20.0,
    ) -> Dict[str, Any]:
        """
        Provider tokenization endpoint wrapper.
        Return shape:
        {
          "ok": bool,
          "provider": str,
          "model": str,
          "totals": List[int],   # aligned with input texts
          "raw": Any,
          "error": str
        }
        """
        return {
            "ok": False,
            "provider": self.provider_name,
            "model": str(model or "").strip(),
            "totals": [],
            "raw": None,
            "error": "tokenization_not_supported",
        }

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
        Unified image understanding API for providers.
        Provider adapters may override with native multimodal implementation.
        """
        raise ValueError(f"provider {self.provider_name} 暂不支持图片理解接口")

    def upload_file(self, *, client: Any, file_obj, purpose: str = "user_data"):
        """
        Provider file upload helper.
        """
        return client.files.create(file=file_obj, purpose=purpose)

    def create_stream_iterator(
        self,
        *,
        client: Any,
        request_params: Dict[str, Any],
        use_responses_api: bool
    ):
        """
        Create provider streaming iterator for a chat round.
        """
        if use_responses_api:
            return client.responses.create(**request_params)
        return client.chat.completions.create(**request_params)

    def supports_response_resume(self, *, use_responses_api: bool) -> bool:
        """
        Whether this provider/protocol supports previous_response_id style resume.
        """
        return bool(use_responses_api)

    def get_resume_response_id(
        self,
        *,
        conversation_manager: Any,
        conversation_id: str,
        model_name: str
    ) -> Optional[str]:
        """
        Load resumable response id from conversation store.
        """
        if not self.supports_response_resume(use_responses_api=True):
            return None
        return conversation_manager.get_last_response_id(
            conversation_id,
            current_model_name=model_name
        )

    def save_resume_response_id(
        self,
        *,
        conversation_manager: Any,
        conversation_id: str,
        response_id: str,
        model_name: str
    ) -> None:
        """
        Persist resumable response id into conversation store.
        """
        if not self.supports_response_resume(use_responses_api=True):
            return
        conversation_manager.update_last_response_id(
            conversation_id,
            response_id=response_id,
            model_name=model_name
        )

    def build_assistant_tool_call_message(
        self,
        *,
        function_calls: List[Dict[str, Any]],
        round_content: str = ""
    ) -> Dict[str, Any]:
        tool_calls_payload = []
        for fc in function_calls or []:
            tool_calls_payload.append({
                "id": str((fc or {}).get("call_id", "") or ""),
                "type": "function",
                "function": {
                    "name": str((fc or {}).get("name", "") or ""),
                    "arguments": str((fc or {}).get("arguments", "{}") or "{}")
                }
            })

        msg = {
            "role": "assistant",
            "tool_calls": tool_calls_payload
        }
        msg["content"] = round_content if round_content else None
        return msg

    def build_function_output_message(
        self,
        *,
        call_id: str,
        result: str,
        use_responses_api: bool
    ) -> Dict[str, Any]:
        if use_responses_api:
            return {
                "type": "function_call_output",
                "call_id": str(call_id or ""),
                "output": str(result or "")
            }
        return {
            "role": "tool",
            "tool_call_id": str(call_id or ""),
            "content": str(result or "")
        }

    def detect_round_search_enabled(
        self,
        *,
        request_params: Dict[str, Any],
        enable_web_search: bool,
        use_responses_api: bool
    ) -> bool:
        extra_body = request_params.get("extra_body", {})
        if not isinstance(extra_body, dict):
            extra_body = {}
        if use_responses_api:
            tools_payload = request_params.get("tools", [])
            has_web_tool = (
                isinstance(tools_payload, list)
                and any(
                    isinstance(t, dict) and str(t.get("type", "")).strip() == "web_search"
                    for t in tools_payload
                )
            )
            enabled = bool(enable_web_search and has_web_tool)
            if "enable_search" in extra_body:
                enabled = bool(extra_body.get("enable_search"))
            return enabled
        return bool(extra_body.get("enable_search", False))

    def apply_protocol_payload(
        self,
        params: Dict[str, Any],
        *,
        use_responses_api: bool,
        messages: List[Dict[str, Any]],
        previous_response_id: Optional[str],
        current_function_outputs: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Fill protocol-level payload fields for chat round:
        - responses: input / previous_response_id
        - chat.completions: messages + stream_options.include_usage
        """
        if use_responses_api:
            if previous_response_id is None:
                params["input"] = list(messages or [])
            else:
                params["previous_response_id"] = previous_response_id
                if current_function_outputs:
                    params["input"] = list(current_function_outputs)
                elif messages:
                    params["input"] = list(messages)
                else:
                    params["input"] = [{"role": "user", "content": ""}]
            return params

        params["stream_options"] = {"include_usage": True}
        params["messages"] = self._normalize_chat_messages_payload(messages)
        return params

    def _normalize_chat_messages_payload(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Normalize chat.completions messages before request dispatch.
        Some OpenAI-compatible providers (e.g. Tencent Hunyuan) require:
        - all system messages to be at the very beginning.
        """
        raw = list(messages or [])
        provider_low = str(getattr(self, "provider_name", "") or "").strip().lower()
        if provider_low not in {"tencent", "hunyuan", "腾讯", "混元", "tencent_hunyuan"}:
            return raw
        return self._coalesce_system_messages_to_front(raw)

    def _coalesce_system_messages_to_front(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Move system messages to the front and merge them into one message, preserving
        the relative order of non-system messages.
        """
        first_system: Optional[Dict[str, Any]] = None
        first_system_index: Optional[int] = None
        merged_content: Any = None
        non_system_messages: List[Dict[str, Any]] = []

        for idx, msg in enumerate(list(messages or [])):
            if not isinstance(msg, dict):
                continue
            role = str(msg.get("role", "") or "").strip().lower()
            if role != "system":
                non_system_messages.append(msg)
                continue

            if first_system is None:
                first_system = dict(msg)
                first_system_index = idx
                merged_content = msg.get("content")
            else:
                merged_content = self._merge_system_content(merged_content, msg.get("content"))

        if first_system is None:
            return list(messages or [])

        first_system["content"] = merged_content if merged_content is not None else ""

        # Already compliant: first message is system and no extra system messages.
        if first_system_index == 0 and len(non_system_messages) + 1 == len([m for m in messages if isinstance(m, dict)]):
            return list(messages or [])

        return [first_system] + non_system_messages

    def _merge_system_content(self, base: Any, extra: Any) -> Any:
        if extra is None or extra == "":
            return base
        if base is None or base == "":
            return extra

        if isinstance(base, list):
            merged = list(base)
            if isinstance(extra, list):
                merged.extend(extra)
            else:
                merged.append(extra)
            return merged

        if isinstance(extra, list):
            merged = [base]
            merged.extend(extra)
            return merged

        base_text = str(base)
        extra_text = str(extra)
        if not base_text:
            return extra_text
        if not extra_text:
            return base_text
        return f"{base_text}\n\n{extra_text}"

    def iter_stream_events(
        self,
        chunks,
        *,
        use_responses_api: bool,
        native_web_search_enabled: bool = False,
    ):
        """
        Normalize provider stream into unified events consumed by Model:
        - response_id: {"type":"response_id","response_id":str}
        - content_delta: {"type":"content_delta","delta":str}
        - reasoning_delta: {"type":"reasoning_delta","delta":str}
        - function_call_delta: {"type":"function_call_delta", ...}
        - function_call: {"type":"function_call","name":str,"arguments":str,"call_id":str}
        - web_search: {"type":"web_search","status":str,"query":str,"content":str}
        - usage: {"type":"usage","usage":obj,"input_tokens":int,"output_tokens":int,"total_tokens":int}
        """
        raise NotImplementedError

    def client_cache_key(self, api_key: str, scope: str = "primary") -> str:
        return f"{scope}_{self.provider_name}_{self.api_type}_{str(api_key or '')}"

    def use_responses_api(self, request_options: Optional[Dict[str, Any]] = None) -> bool:
        """Whether this provider should use Responses API for current request."""
        return False

    def apply_request_options(
        self,
        params: Dict[str, Any],
        *,
        use_responses_api: bool,
        enable_thinking: bool,
        enable_web_search: bool,
        native_web_search_enabled: bool,
        request_options: Optional[Dict[str, Any]] = None,
        model_name: str = "",
    ) -> Dict[str, Any]:
        """Provider-specific request option enrichment for main chat path."""
        return params

    def relay_web_search(
        self,
        *,
        client: Any,
        model_id: str,
        query: str,
        args: Dict[str, Any],
        request_options: Optional[Dict[str, Any]] = None,
        adapter_tools: Optional[List[Dict[str, Any]]] = None,
        default_web_search_prompt: str = "",
        extract_responses_search_payload=None,
    ) -> Dict[str, Any]:
        raise ValueError(f"provider {self.provider_name} 暂不支持本地 web_search 中转")

    def extract_responses_search_payload(self, response) -> Dict[str, Any]:
        """
        Extract text + references from OpenAI-compatible Responses payload.
        """
        text = ""
        references: List[Dict[str, str]] = []

        output_text = getattr(response, "output_text", None)
        if output_text:
            text = str(output_text).strip()

        if not text:
            output_items = getattr(response, "output", None) or []
            text_chunks: List[str] = []
            for item in output_items:
                item_type = str(getattr(item, "type", "") or "")
                if item_type != "message":
                    continue
                content_list = getattr(item, "content", None) or []
                for content_item in content_list:
                    c_type = str(getattr(content_item, "type", "") or "")
                    if c_type not in ("output_text", "text"):
                        continue
                    piece = (
                        getattr(content_item, "text", None)
                        or getattr(content_item, "content", None)
                        or ""
                    )
                    piece = str(piece).strip()
                    if piece:
                        text_chunks.append(piece)

                    annotations = getattr(content_item, "annotations", None) or []
                    for ann in annotations:
                        url = str(getattr(ann, "url", "") or "").strip()
                        if not url:
                            continue
                        title = str(
                            getattr(ann, "title", "")
                            or getattr(ann, "source_title", "")
                            or "来源"
                        ).strip()
                        references.append({"title": title, "url": url})

            text = "\n".join(text_chunks).strip()

        return {"text": text, "references": references}

    def fetch_native_search_metadata(
        self,
        *,
        model_id: str,
        query: str,
        request_options: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Optional native search metadata path.
        Returns:
          {
            "ok": bool,
            "request_id": str,
            "search_results": list,
            "citations": list,
            "usage": dict,
            "content_preview": str,
            "error": str
          }
        """
        return {"ok": False, "error": "native_search_metadata_not_supported"}

    def should_disable_function_tools(self, model_name: str = "") -> bool:
        """Whether function tools should be disabled for this provider/model."""
        return False

    def should_attach_native_tools_to_chat_tools(self) -> bool:
        """Whether native non-function tools can be attached to chat.completions tools."""
        return True

    def should_retry_context_mismatch_with_full_input(self, error_text: str, use_responses_api: bool) -> bool:
        """Whether to retry once by dropping previous_response_id and sending full input."""
        return False

    def should_append_tool_completion_hint(self, use_responses_api: bool) -> bool:
        """Whether to append a system hint after tool outputs to encourage final response."""
        return False

    def build_tool_completion_hint(self, function_calls: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        tool_names = []
        for fc in function_calls or []:
            name = str((fc or {}).get("name", "") or "").strip()
            if name and name not in tool_names:
                tool_names.append(name)
        if not tool_names:
            return None
        
        # volcengine很大概率忽略system提示词，无解，故先使用role: user
        return {
            "role": "user",
            "content": prompts.build_tool_completion_hint_text(tool_names),
        }

    def _as_bool(self, value: Any, default: bool = False) -> bool:
        if value is None:
            return bool(default)
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "y", "on"}
        return bool(value)

    def _normalize_tool_list(self, raw_tools: Any) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        if not isinstance(raw_tools, list):
            return out
        for t in raw_tools:
            if not isinstance(t, dict):
                continue
            t_type = str(t.get("type", "")).strip()
            if not t_type:
                continue
            out.append(json.loads(json.dumps(t)))
        return out

    def _get_req_opt_headers(self, request_options: Optional[Dict[str, Any]]) -> Dict[str, str]:
        req_opts = request_options if isinstance(request_options, dict) else {}
        raw = req_opts.get("extra_headers", req_opts.get("extra_head"))
        if not isinstance(raw, dict):
            return {}
        headers: Dict[str, str] = {}
        for k, v in raw.items():
            key = str(k or "").strip()
            if not key:
                continue
            headers[key] = str(v if v is not None else "")
        return headers

    def _build_relay_tools(
        self,
        *,
        adapter_tools: Optional[List[Dict[str, Any]]],
        request_options: Optional[Dict[str, Any]],
        mode: str,
        args: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        req_opts = request_options if isinstance(request_options, dict) else {}
        normalized_adapter_tools = self._normalize_tool_list(adapter_tools or [])

        tools: List[Dict[str, Any]] = []
        if mode == "responses":
            tools = self._normalize_tool_list(req_opts.get("responses_tools"))
            if not tools:
                tools = self._normalize_tool_list(req_opts.get("tools"))
            if not tools:
                tools = normalized_adapter_tools
            if not tools:
                tools = [{"type": "web_search"}]
        else:
            tools = self._normalize_tool_list(req_opts.get("chat_tools"))
            if not tools and self._as_bool(req_opts.get("chat_use_adapter_tools", False), default=False):
                tools = normalized_adapter_tools
            if not tools and self._as_bool(req_opts.get("chat_use_default_web_search_tool", False), default=False):
                tools = [{"type": "web_search"}]

        for t in tools:
            if str(t.get("type", "")).strip() != "web_search":
                continue
            for key in ("limit", "sources", "user_location"):
                if key in args and args.get(key) is not None:
                    t[key] = args.get(key)
        return tools

    def _build_relay_extra_body(self, request_options: Optional[Dict[str, Any]], mode: str) -> Dict[str, Any]:
        req_opts = request_options if isinstance(request_options, dict) else {}
        extra_body: Dict[str, Any] = {}
        base_extra = req_opts.get("extra_body")
        if isinstance(base_extra, dict):
            extra_body.update(json.loads(json.dumps(base_extra)))

        mode_key = "responses_extra_body" if mode == "responses" else "chat_extra_body"
        mode_extra = req_opts.get(mode_key)
        if isinstance(mode_extra, dict):
            extra_body.update(json.loads(json.dumps(mode_extra)))

        if "enable_thinking" in req_opts:
            extra_body["enable_thinking"] = self._as_bool(req_opts.get("enable_thinking"), default=True)

        if mode == "chat_completions":
            extra_body["enable_search"] = self._as_bool(req_opts.get("enable_search", True), default=True)
            search_options = req_opts.get("search_options")
            if isinstance(search_options, dict) and search_options:
                extra_body["search_options"] = json.loads(json.dumps(search_options))
        else:
            if "enable_search" in req_opts:
                extra_body["enable_search"] = self._as_bool(req_opts.get("enable_search"), default=True)
            search_options = req_opts.get("search_options")
            if isinstance(search_options, dict) and search_options:
                extra_body["search_options"] = json.loads(json.dumps(search_options))
        return extra_body

    def _build_relay_debug(
        self,
        *,
        model_id: str,
        mode: str,
        tools: List[Dict[str, Any]],
        extra_body: Dict[str, Any],
        extra_headers: Dict[str, str],
    ) -> Dict[str, Any]:
        return {
            "provider": self.provider_name,
            "model": model_id,
            "api_mode": mode,
            "tools": tools,
            "extra_body": extra_body,
            "extra_headers_keys": sorted(list(extra_headers.keys())),
        }

    def _iter_openai_chat_stream_events(self, chunks):
        """
        Parse OpenAI-compatible chat.completions streaming chunks into unified events.
        """
        function_calls: List[Dict[str, Any]] = []
        debug_unknown_stream =True
        unknown_delta_key_logged: set = set()

        def _extract_text_piece(val: Any) -> str:
            if val is None:
                return ""
            if isinstance(val, str):
                return val
            if isinstance(val, list):
                parts: List[str] = []
                for item in val:
                    piece = _extract_text_piece(item)
                    if piece:
                        parts.append(piece)
                return "".join(parts)
            if isinstance(val, dict):
                for k in ("text", "content", "delta", "reasoning_text", "reasoning_content", "value"):
                    if k in val:
                        piece = _extract_text_piece(val.get(k))
                        if piece:
                            return piece
                return ""
            # pydantic / sdk typed object
            for k in ("text", "content", "delta", "reasoning_text", "reasoning_content", "value"):
                try:
                    piece = _extract_text_piece(getattr(val, k, None))
                    if piece:
                        return piece
                except Exception:
                    pass
            return str(val) if val is not None else ""

        def _collect_obj_keys(obj: Any) -> List[str]:
            keys: List[str] = []
            if obj is None:
                return keys
            if isinstance(obj, dict):
                keys.extend([str(k) for k in obj.keys()])
                return sorted(set(keys))
            try:
                keys.extend([str(k) for k in vars(obj).keys()])
            except Exception:
                pass
            try:
                extra = getattr(obj, "model_extra", None)
                if isinstance(extra, dict):
                    keys.extend([str(k) for k in extra.keys()])
            except Exception:
                pass
            try:
                dump_fn = getattr(obj, "model_dump", None)
                if callable(dump_fn):
                    dumped = dump_fn(mode="python")
                    if isinstance(dumped, dict):
                        keys.extend([str(k) for k in dumped.keys()])
            except Exception:
                pass
            return sorted(set(keys))

        for chunk in chunks:
            # Usage may come in an empty-choices tail chunk.
            choices = getattr(chunk, "choices", None)
            if not choices:
                usage_obj = getattr(chunk, "usage", None)
                if usage_obj:
                    yield {
                        "type": "usage",
                        "usage": usage_obj,
                        "input_tokens": int(getattr(usage_obj, "prompt_tokens", 0) or 0),
                        "output_tokens": int(getattr(usage_obj, "completion_tokens", 0) or 0),
                        "total_tokens": int(getattr(usage_obj, "total_tokens", 0) or 0),
                    }
                continue

            delta = getattr(choices[0], "delta", None)
            if not delta:
                continue

            content_piece = getattr(delta, "content", None)
            content_piece = _extract_text_piece(content_piece)
            if content_piece:
                yield {"type": "content_delta", "delta": str(content_piece)}

            # Different providers expose reasoning chunks with different field names.
            reasoning_piece = (
                getattr(delta, "reasoning_content", None)
                or getattr(delta, "reasoning", None)
                or getattr(delta, "reasoning_text", None)
            )
            reasoning_piece = _extract_text_piece(reasoning_piece)
            if reasoning_piece:
                yield {"type": "reasoning_delta", "delta": str(reasoning_piece)}

            tool_calls = getattr(delta, "tool_calls", None)
            if tool_calls:
                for tc in tool_calls:
                    idx = int(getattr(tc, "index", 0) or 0)
                    while idx >= len(function_calls):
                        function_calls.append({"name": "", "arguments": "", "call_id": ""})
                    fc = function_calls[idx]

                    tc_id = getattr(tc, "id", None)
                    if tc_id:
                        fc["call_id"] = str(tc_id)

                    function_obj = getattr(tc, "function", None)
                    name_delta = ""
                    args_delta = ""
                    if function_obj is not None:
                        fn_name = getattr(function_obj, "name", None)
                        fn_args = getattr(function_obj, "arguments", None)
                        if fn_name:
                            name_delta = str(fn_name)
                            fc["name"] += name_delta
                        if fn_args:
                            args_delta = str(fn_args)
                            fc["arguments"] += args_delta

                    if name_delta or args_delta:
                        yield {
                            "type": "function_call_delta",
                            "name": fc.get("name", "") or name_delta,
                            "call_id": fc.get("call_id", ""),
                            "arguments_delta": args_delta,
                            "name_delta": name_delta,
                            "index": idx,
                        }

            if debug_unknown_stream and (not content_piece) and (not reasoning_piece) and (not tool_calls):
                key_sig = ",".join(_collect_obj_keys(delta))
                if key_sig and key_sig not in unknown_delta_key_logged:
                    unknown_delta_key_logged.add(key_sig)
                    print(f"[STREAM_DEBUG] Unhandled delta keys: {key_sig}")

            usage_obj = getattr(chunk, "usage", None)
            if usage_obj:
                yield {
                    "type": "usage",
                    "usage": usage_obj,
                    "input_tokens": int(getattr(usage_obj, "prompt_tokens", 0) or 0),
                    "output_tokens": int(getattr(usage_obj, "completion_tokens", 0) or 0),
                    "total_tokens": int(getattr(usage_obj, "total_tokens", 0) or 0),
                }

        for i, fc in enumerate(function_calls):
            name = str(fc.get("name", "") or "").strip()
            args = str(fc.get("arguments", "") or "")
            call_id = str(fc.get("call_id", "") or "").strip() or f"tool_call_{i}"
            if not name:
                continue
            yield {
                "type": "function_call",
                "name": name,
                "arguments": args,
                "call_id": call_id,
            }
