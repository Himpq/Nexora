from typing import Any

from openai import OpenAI

from provider_base import ProviderInterface


class OpenAIProvider(ProviderInterface):
    @property
    def api_type(self) -> str:
        return "openai"

    def create_client(self, api_key: str, base_url: str, timeout: float = 120.0):
        return OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
        )

    def use_responses_api(self, request_options=None) -> bool:
        return False

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
