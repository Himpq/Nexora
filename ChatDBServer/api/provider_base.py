import json
import os
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

import prompts


TOOL_ARGUMENT_DELTA_CHUNK_CHARS = 384


def _iter_chunked_function_call_delta(event: Dict[str, Any]):
    """Split oversized tool argument deltas so UI can render file writes progressively."""
    if not isinstance(event, dict):
        return

    arguments_delta = str(event.get("arguments_delta") or "")
    chunk_size = max(64, int(TOOL_ARGUMENT_DELTA_CHUNK_CHARS or 384))

    if len(arguments_delta) <= chunk_size:
        yield event
        return

    total_parts = (len(arguments_delta) + chunk_size - 1) // chunk_size

    for part_index, start in enumerate(range(0, len(arguments_delta), chunk_size), 1):
        chunk = dict(event)
        chunk["arguments_delta"] = arguments_delta[start:start + chunk_size]
        chunk["arguments_delta_part"] = part_index
        chunk["arguments_delta_total_parts"] = total_parts
        chunk["arguments_delta_source_chars"] = len(arguments_delta)

        if part_index > 1:
            chunk.pop("name_delta", None)

        yield chunk


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
        normalized_messages = self._normalize_chat_messages_payload(messages)

        return client.chat.completions.create(
            model=model,
            messages=normalized_messages,
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
        extra_body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Unified image generation API for providers.
        Provider adapters may override with native implementation.
        """
        raise ValueError(f"provider {self.provider_name} 暂不支持图片生成接口")

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
        Chat Completions providers require system messages to be at the beginning.
        Compression summaries and runtime hints may introduce additional system
        messages, so merge them into the first message before dispatch.
        """
        raw = list(messages or [])
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
        debug_unknown_stream = self._as_bool(self.provider_config.get("debug_unknown_stream", False), default=False)
        unknown_delta_key_logged: set = set()
        thinking_mode = False
        think_buffer = ""
        explicit_reasoning_accumulator = ""
        first_chunk_processed = False

        def _obj_get_raw(obj: Any, key: str, default: Any = None) -> Any:
            if obj is None:
                return default
            if isinstance(obj, dict):
                return obj.get(key, default)
            try:
                extra = getattr(obj, "model_extra", None)
                if isinstance(extra, dict) and key in extra:
                    return extra.get(key, default)
            except Exception:
                pass
            try:
                return getattr(obj, key)
            except Exception:
                return default

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

        def _extract_reasoning_fields(delta_obj: Any) -> str:
            merged = ""

            for key in ("reasoning_content", "reasoning", "reasoning_text", "thinking", "thinking_content"):
                piece = _extract_text_piece(_obj_get_raw(delta_obj, key, None))
                if piece:
                    if not merged:
                        merged = piece
                    elif piece == merged or piece in merged:
                        continue
                    elif merged in piece:
                        merged = piece
                    else:
                        merged += piece

            return merged

        def _normalize_explicit_reasoning_delta(text: str) -> str:
            nonlocal explicit_reasoning_accumulator

            piece = str(text or "")

            if not piece:
                return ""

            previous = explicit_reasoning_accumulator

            if previous and piece == previous:
                return ""

            if previous and piece.startswith(previous):
                delta = piece[len(previous):]
                explicit_reasoning_accumulator = piece
                return delta

            if previous and previous.startswith(piece):
                return ""

            explicit_reasoning_accumulator = previous + piece
            return piece

        def _split_delta_content(content_val: Any) -> Dict[str, str]:
            content_parts: List[str] = []
            reasoning_parts: List[str] = []
            if isinstance(content_val, list):
                for item in content_val:
                    item_type = str(_obj_get_raw(item, "type", "") or "").strip().lower()
                    piece = _extract_text_piece(item)
                    if not piece:
                        continue
                    if any(tag in item_type for tag in ("reason", "think")):
                        reasoning_parts.append(piece)
                    else:
                        content_parts.append(piece)
            else:
                piece = _extract_text_piece(content_val)
                if piece:
                    content_parts.append(piece)
            return {
                "content": "".join(content_parts),
                "reasoning": "".join(reasoning_parts),
            }

        def _split_think_markup(text: str, is_final: bool = False) -> Dict[str, str]:
            nonlocal thinking_mode, think_buffer
            raw = think_buffer + str(text or "")
            if not raw and not is_final:
                return {"content": "", "reasoning": ""}
            
            content_parts: List[str] = []
            reasoning_parts: List[str] = []
            
            while raw:
                if thinking_mode:
                    end_idx = raw.find("</think>")
                    if end_idx < 0:
                        # Might be a partial </think> at the end
                        potential_match = False
                        for i in range(1, 9):
                            if raw.endswith("</think>"[:i]):
                                potential_match = True
                                reasoning_parts.append(raw[:-i])
                                think_buffer = raw[-i:]
                                raw = ""
                                break
                        if not potential_match:
                            reasoning_parts.append(raw)
                            think_buffer = ""
                            raw = ""
                        
                        if is_final and think_buffer:
                            reasoning_parts.append(think_buffer)
                            think_buffer = ""
                    else:
                        reasoning_parts.append(raw[:end_idx])
                        raw = raw[end_idx + len("</think>"):]
                        thinking_mode = False
                else:
                    start_idx = raw.find("<think>")
                    end_fallback_idx = raw.find("</think>")
                    
                    if start_idx < 0:
                        if end_fallback_idx >= 0:
                            # Unexpected </think> when not in thinking mode
                            reasoning_parts.append(raw[:end_fallback_idx])
                            raw = raw[end_fallback_idx + len("</think>"):]
                            continue
                            
                        # Might be a partial <think> or </think> at the end
                        potential_match = False
                        for tag in ("<think>", "</think>"):
                            for i in range(1, len(tag)):
                                if raw.endswith(tag[:i]):
                                    potential_match = True
                                    content_parts.append(raw[:-i])
                                    think_buffer = raw[-i:]
                                    raw = ""
                                    break
                            if potential_match:
                                break
                                
                        if not potential_match:
                            content_parts.append(raw)
                            think_buffer = ""
                            raw = ""
                            
                        if is_final and think_buffer:
                            content_parts.append(think_buffer)
                            think_buffer = ""
                    else:
                        if end_fallback_idx >= 0 and end_fallback_idx < start_idx:
                            reasoning_parts.append(raw[:end_fallback_idx])
                            raw = raw[end_fallback_idx + len("</think>"):]
                            continue
                        content_parts.append(raw[:start_idx])
                        raw = raw[start_idx + len("<think>"):]
                        thinking_mode = True

            return {
                "content": "".join(content_parts),
                "reasoning": "".join(reasoning_parts),
            }

        def _merge_stream_fragment(base: str, frag: str) -> str:
            base_s = str(base or "")
            frag_s = str(frag or "")
            if not frag_s:
                return base_s
            if not base_s:
                return frag_s
            if frag_s == base_s:
                return base_s
            if frag_s.startswith(base_s):
                return frag_s
            if base_s.startswith(frag_s):
                return base_s
            if base_s.endswith(frag_s):
                return base_s
            if (len(frag_s) >= 16) and (frag_s in base_s):
                return base_s
            return base_s + frag_s

        def _merge_stream_fragment_delta(base: str, frag: str):
            """Return merged text plus the actual new fragment to emit downstream."""
            base_s = str(base or "")
            merged = _merge_stream_fragment(base_s, frag)

            if merged == base_s:
                return merged, ""

            if merged.startswith(base_s):
                return merged, merged[len(base_s):]

            return merged, str(frag or "")

        def _apply_tool_call_delta(tc_obj: Any, idx_default: int = 0) -> Optional[Dict[str, Any]]:
            try:
                idx = int(_obj_get_raw(tc_obj, "index", idx_default) or idx_default)
            except Exception:
                idx = idx_default
            if idx < 0:
                idx = idx_default
            while idx >= len(function_calls):
                function_calls.append({"name": "", "arguments": "", "call_id": ""})
            fc = function_calls[idx]

            tc_id = _extract_text_piece(_obj_get_raw(tc_obj, "id", None))
            if tc_id:
                fc["call_id"] = str(tc_id)

            fn_obj = _obj_get_raw(tc_obj, "function", None)
            if fn_obj is None and (
                _obj_get_raw(tc_obj, "name", None) is not None
                or _obj_get_raw(tc_obj, "arguments", None) is not None
            ):
                fn_obj = tc_obj
            name_delta = _extract_text_piece(_obj_get_raw(fn_obj, "name", None)) if fn_obj is not None else ""
            args_delta = _extract_text_piece(_obj_get_raw(fn_obj, "arguments", None)) if fn_obj is not None else ""

            old_name = str(fc.get("name", "") or "")
            old_args = str(fc.get("arguments", "") or "")
            emitted_name_delta = ""
            emitted_args_delta = ""

            if name_delta:
                fc["name"], emitted_name_delta = _merge_stream_fragment_delta(old_name, str(name_delta))

            if args_delta:
                fc["arguments"], emitted_args_delta = _merge_stream_fragment_delta(old_args, str(args_delta))

            if not (emitted_name_delta or emitted_args_delta):
                return None

            return {
                "type": "function_call_delta",
                "name": fc.get("name", "") or name_delta,
                "call_id": fc.get("call_id", ""),
                "arguments_delta": emitted_args_delta,
                "name_delta": emitted_name_delta,
                "index": idx,
            }

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
            choices = _obj_get_raw(chunk, "choices", None)
            if not choices:
                usage_obj = _obj_get_raw(chunk, "usage", None)
                if usage_obj:
                    yield {
                        "type": "usage",
                        "usage": usage_obj,
                        "input_tokens": int(getattr(usage_obj, "prompt_tokens", 0) or 0),
                        "output_tokens": int(getattr(usage_obj, "completion_tokens", 0) or 0),
                        "total_tokens": int(getattr(usage_obj, "total_tokens", 0) or 0),
                    }
                continue

            choice0 = choices[0] if isinstance(choices, list) and choices else None
            delta = _obj_get_raw(choice0, "delta", None)
            finish_reason = str(_obj_get_raw(choice0, "finish_reason", "") or "").strip()
            # Some OpenAI-compatible gateways may put final tool_calls/message on choice.message.
            if not delta:
                msg_obj = _obj_get_raw(choice0, "message", None)
                if msg_obj is not None:
                    msg_split = _split_delta_content(_obj_get_raw(msg_obj, "content", None))
                    msg_reasoning_raw = _merge_stream_fragment(
                        _split_think_markup(msg_split.get("reasoning", "")).get("reasoning", ""),
                        _extract_reasoning_fields(msg_obj),
                    )
                    msg_reasoning = _normalize_explicit_reasoning_delta(msg_reasoning_raw)
                    msg_content = _split_think_markup(msg_split.get("content", "")).get("content", "")
                    if msg_content:
                        yield {"type": "content_delta", "delta": str(msg_content)}
                    if msg_reasoning:
                        yield {"type": "reasoning_delta", "delta": str(msg_reasoning)}

                    msg_tool_calls = _obj_get_raw(msg_obj, "tool_calls", None)
                    if isinstance(msg_tool_calls, dict):
                        msg_tool_calls = [msg_tool_calls]
                    if isinstance(msg_tool_calls, list):
                        for tc in msg_tool_calls:
                            fc_delta = _apply_tool_call_delta(tc, idx_default=0)
                            if fc_delta:
                                yield from _iter_chunked_function_call_delta(fc_delta)

                if finish_reason:
                    yield {"type": "finish_reason", "finish_reason": finish_reason}
                continue

            split_payload = _split_delta_content(_obj_get_raw(delta, "content", None))
            think_split = _split_think_markup(split_payload.get("content", ""))
            content_piece = think_split.get("content", "")
            reasoning_piece_raw = _merge_stream_fragment(
                _merge_stream_fragment(split_payload.get("reasoning", ""), think_split.get("reasoning", "")),
                _extract_reasoning_fields(delta),
            )
            reasoning_piece = _normalize_explicit_reasoning_delta(reasoning_piece_raw)

            if content_piece:
                yield {"type": "content_delta", "delta": str(content_piece)}

            if reasoning_piece:
                yield {"type": "reasoning_delta", "delta": str(reasoning_piece)}

            tool_calls = _obj_get_raw(delta, "tool_calls", None)
            if isinstance(tool_calls, dict):
                tool_calls = [tool_calls]
            if isinstance(tool_calls, list) and tool_calls:
                for tc in tool_calls:
                    fc_delta = _apply_tool_call_delta(tc, idx_default=0)
                    if fc_delta:
                        yield from _iter_chunked_function_call_delta(fc_delta)

            # Legacy stream shape: delta.function_call.{name,arguments}
            legacy_fc = _obj_get_raw(delta, "function_call", None)
            if legacy_fc is not None:
                fc_delta = _apply_tool_call_delta(legacy_fc, idx_default=0)
                if fc_delta:
                    yield from _iter_chunked_function_call_delta(fc_delta)

            if debug_unknown_stream and (not content_piece) and (not reasoning_piece) and (not tool_calls):
                key_sig = ",".join(_collect_obj_keys(delta))
                if key_sig and key_sig not in unknown_delta_key_logged:
                    unknown_delta_key_logged.add(key_sig)
                    print(f"[STREAM_DEBUG] Unhandled delta keys: {key_sig}")

            usage_obj = _obj_get_raw(chunk, "usage", None)
            if usage_obj:
                yield {
                    "type": "usage",
                    "usage": usage_obj,
                    "input_tokens": int(getattr(usage_obj, "prompt_tokens", 0) or 0),
                    "output_tokens": int(getattr(usage_obj, "completion_tokens", 0) or 0),
                    "total_tokens": int(getattr(usage_obj, "total_tokens", 0) or 0),
                }

            if finish_reason:
                yield {"type": "finish_reason", "finish_reason": finish_reason}

        # Flush any remaining buffered think tag
        final_think_split = _split_think_markup("", is_final=True)
        if final_think_split.get("content", ""):
            yield {"type": "content_delta", "delta": str(final_think_split["content"])}
        if final_think_split.get("reasoning", ""):
            yield {"type": "reasoning_delta", "delta": str(final_think_split["reasoning"])}

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

    def _iter_openai_responses_stream_events(
        self,
        chunks,
        *,
        native_web_search_enabled: bool = False,
        web_search_status_searching: str = "searching",
        web_search_status_completed: str = "completed",
        native_web_search_content_prefix: str = "",
        native_web_search_query_from_name: bool = True,
    ):
        """
        Parse OpenAI Responses API streaming chunks into unified events.

        Responses streams often split tool metadata and arguments across different
        events. In particular, response.function_call_arguments.delta may only
        carry item_id/output_index, while name/call_id arrived earlier on
        response.output_item.added. Keep an item map so the UI can render the tool
        card as soon as the model starts building arguments.
        """
        has_emitted_content_delta = False
        has_received_detail_reasoning = False
        calls_by_item_id: Dict[str, Dict[str, Any]] = {}
        calls_by_output_index: Dict[str, Dict[str, Any]] = {}
        emitted_added_ids: set = set()
        completed_call_ids: set = set()

        def _obj_get_raw(obj: Any, key: str, default: Any = None) -> Any:
            if obj is None:
                return default
            if isinstance(obj, dict):
                return obj.get(key, default)
            try:
                extra = getattr(obj, "model_extra", None)
                if isinstance(extra, dict) and key in extra:
                    return extra.get(key, default)
            except Exception:
                pass
            try:
                return getattr(obj, key)
            except Exception:
                return default

        def _text(value: Any) -> str:
            if value is None:
                return ""
            if isinstance(value, str):
                return value
            return str(value)

        def _extract_response_id(chunk_obj: Any, response_obj: Any) -> str:
            candidates = [
                _text(_obj_get_raw(response_obj, "id", "")),
                _text(_obj_get_raw(chunk_obj, "response_id", "")),
                _text(_obj_get_raw(chunk_obj, "id", "")),
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

        def _output_index_key(value: Any) -> str:
            try:
                return str(int(value))
            except Exception:
                return str(value or "").strip()

        def _remember_function_call_item(item: Any, chunk_obj: Any = None) -> Dict[str, Any]:
            name = _text(_obj_get_raw(item, "name", "")).strip()
            call_id = _text(_obj_get_raw(item, "call_id", "")).strip()
            item_id = _text(_obj_get_raw(item, "id", "")).strip() or call_id
            arguments = _text(_obj_get_raw(item, "arguments", ""))
            output_index = _obj_get_raw(item, "output_index", None)
            if output_index is None and chunk_obj is not None:
                output_index = _obj_get_raw(chunk_obj, "output_index", None)
            output_key = _output_index_key(output_index)

            state = None
            for key in (item_id, call_id):
                if key and key in calls_by_item_id:
                    state = calls_by_item_id[key]
                    break
            if state is None and output_key and output_key in calls_by_output_index:
                state = calls_by_output_index[output_key]
            if state is None:
                state = {
                    "name": "",
                    "call_id": "",
                    "item_id": "",
                    "arguments": "",
                    "output_index": "",
                }

            if name:
                state["name"] = name
            if call_id:
                state["call_id"] = call_id
            if item_id:
                state["item_id"] = item_id
            if arguments:
                state["arguments"] = arguments
            if output_key:
                state["output_index"] = output_key

            for key in (state.get("item_id"), state.get("call_id"), item_id, call_id):
                key_text = str(key or "").strip()
                if key_text:
                    calls_by_item_id[key_text] = state
            if output_key:
                calls_by_output_index[output_key] = state

            return state

        def _state_for_arguments_delta(chunk_obj: Any) -> Dict[str, Any]:
            fc_obj = (
                _obj_get_raw(chunk_obj, "function_call", None)
                or _obj_get_raw(chunk_obj, "item", None)
                or _obj_get_raw(chunk_obj, "output_item", None)
            )
            if fc_obj is not None:
                item_type = _text(_obj_get_raw(fc_obj, "type", "")).strip()
                if item_type == "function_call" or _obj_get_raw(fc_obj, "name", None) is not None:
                    return _remember_function_call_item(fc_obj, chunk_obj)

            item_id = _text(_obj_get_raw(chunk_obj, "item_id", "")).strip()
            call_id = _text(_obj_get_raw(chunk_obj, "call_id", "")).strip()
            output_key = _output_index_key(_obj_get_raw(chunk_obj, "output_index", None))

            for key in (item_id, call_id):
                if key and key in calls_by_item_id:
                    return calls_by_item_id[key]
            if output_key and output_key in calls_by_output_index:
                return calls_by_output_index[output_key]

            state = {
                "name": "",
                "call_id": call_id or item_id,
                "item_id": item_id,
                "arguments": "",
                "output_index": output_key,
            }
            for key in (item_id, call_id):
                if key:
                    calls_by_item_id[key] = state
            if output_key:
                calls_by_output_index[output_key] = state
            return state

        def _emit_added_delta(state: Dict[str, Any], index_value: Any = None):
            call_id = str(state.get("call_id") or state.get("item_id") or "").strip()
            name = str(state.get("name") or "").strip()
            key = call_id or str(state.get("output_index") or "")
            if not name or not key or key in emitted_added_ids:
                return None
            emitted_added_ids.add(key)
            payload = {
                "type": "function_call_delta",
                "name": name,
                "call_id": call_id,
                "arguments_delta": "",
                "name_delta": name,
            }
            idx = _output_index_key(index_value if index_value is not None else state.get("output_index"))
            if idx:
                payload["index"] = idx
            return payload

        for chunk in chunks:
            response_obj = _obj_get_raw(chunk, "response", None)
            response_id = _extract_response_id(chunk, response_obj)
            if response_id:
                yield {"type": "response_id", "response_id": response_id}

            chunk_type = _text(_obj_get_raw(chunk, "type", "")).strip()

            if chunk_type in {"response.output_text.delta", "response.message.delta"}:
                delta = _text(_obj_get_raw(chunk, "delta", ""))
                if delta:
                    has_emitted_content_delta = True
                    yield {"type": "content_delta", "delta": delta}
                continue

            if ("reasoning" in chunk_type) and ("delta" in chunk_type):
                is_detail = ("reasoning_text.delta" in chunk_type) or (chunk_type == "response.reasoning.delta")
                is_summary = "reasoning_summary_text.delta" in chunk_type
                if is_detail:
                    has_received_detail_reasoning = True
                if is_summary and has_received_detail_reasoning:
                    continue
                delta = _text(_obj_get_raw(chunk, "delta", ""))
                if delta:
                    yield {"type": "reasoning_delta", "delta": delta}
                continue

            if chunk_type == "response.output_item.added":
                item = _obj_get_raw(chunk, "item", None)
                item_type = _text(_obj_get_raw(item, "type", "")).strip()
                if item is not None and item_type == "function_call":
                    state = _remember_function_call_item(item, chunk)
                    added = _emit_added_delta(state, _obj_get_raw(chunk, "output_index", None))
                    if added:
                        yield from _iter_chunked_function_call_delta(added)
                continue

            if "function_call_arguments.delta" in chunk_type:
                arg_delta = _text(_obj_get_raw(chunk, "delta", ""))
                state = _state_for_arguments_delta(chunk)
                if arg_delta:
                    state["arguments"] = str(state.get("arguments") or "") + arg_delta
                added = _emit_added_delta(state, _obj_get_raw(chunk, "output_index", None))
                if added:
                    yield from _iter_chunked_function_call_delta(added)
                payload = {
                    "type": "function_call_delta",
                    "name": str(state.get("name") or ""),
                    "call_id": str(state.get("call_id") or state.get("item_id") or ""),
                    "arguments_delta": arg_delta,
                }
                idx = _output_index_key(_obj_get_raw(chunk, "output_index", state.get("output_index")))
                if idx:
                    payload["index"] = idx
                yield from _iter_chunked_function_call_delta(payload)
                continue

            if chunk_type == "response.output_item.done":
                item = _obj_get_raw(chunk, "item", None)
                if item is None:
                    continue
                item_type = _text(_obj_get_raw(item, "type", "")).strip()
                if item_type == "function_call":
                    state = _remember_function_call_item(item, chunk)
                    added = _emit_added_delta(state, _obj_get_raw(chunk, "output_index", None))
                    if added:
                        yield from _iter_chunked_function_call_delta(added)
                elif "web_search" in item_type:
                    action = _obj_get_raw(item, "action", None)
                    query = _text(_obj_get_raw(action, "query", "")).strip() if action is not None else ""
                    yield {
                        "type": "web_search",
                        "status": web_search_status_completed,
                        "query": query,
                        "content": f"{web_search_status_completed}: {query}" if query else web_search_status_completed,
                    }
                elif (item_type == "text") and (not has_emitted_content_delta):
                    text_content = _text(_obj_get_raw(item, "content", ""))
                    if text_content:
                        has_emitted_content_delta = True
                        yield {"type": "content_delta", "delta": text_content}
                continue

            if ("web_search_call.searching" in chunk_type) or ("web_search_call.completed" in chunk_type):
                status = web_search_status_searching if "searching" in chunk_type else web_search_status_completed
                ws_obj = _obj_get_raw(chunk, "web_search_call", None) or _obj_get_raw(chunk, "web_search", None)
                query = _text(_obj_get_raw(ws_obj, "query", "")).strip() if ws_obj is not None else ""
                yield {
                    "type": "web_search",
                    "status": status,
                    "query": query,
                    "content": f"{status}: {query}" if query else status,
                }
                continue

            if chunk_type == "response.completed":
                if response_obj is not None:
                    output_items = _obj_get_raw(response_obj, "output", None) or []
                    for item in output_items:
                        if _text(_obj_get_raw(item, "type", "")).strip() != "function_call":
                            continue
                        state = _remember_function_call_item(item, chunk)
                        name = str(state.get("name") or "").strip()
                        call_id = str(state.get("call_id") or state.get("item_id") or "").strip()
                        if not name:
                            continue
                        if native_web_search_enabled and name in {"web_search", "web_extractor", "code_interpreter"}:
                            query = name if native_web_search_query_from_name else ""
                            content = (
                                f"{native_web_search_content_prefix}{name}"
                                if native_web_search_content_prefix
                                else name
                            )
                            yield {
                                "type": "web_search",
                                "status": web_search_status_completed,
                                "query": query,
                                "content": content,
                            }
                            continue
                        complete_key = call_id or str(state.get("output_index") or name)
                        if complete_key in completed_call_ids:
                            continue
                        completed_call_ids.add(complete_key)
                        yield {
                            "type": "function_call",
                            "name": name,
                            "arguments": str(state.get("arguments") or "{}"),
                            "call_id": call_id,
                        }

                    usage_obj = _obj_get_raw(response_obj, "usage", None)
                    if usage_obj is not None:
                        input_tokens = int(_obj_get_raw(usage_obj, "input_tokens", 0) or 0)
                        output_tokens = int(_obj_get_raw(usage_obj, "output_tokens", 0) or 0)
                        total_tokens = int(_obj_get_raw(usage_obj, "total_tokens", 0) or 0)
                        yield {
                            "type": "usage",
                            "usage": usage_obj,
                            "input_tokens": input_tokens,
                            "output_tokens": output_tokens,
                            "total_tokens": total_tokens or (input_tokens + output_tokens),
                        }
