"""Nexora API/PAPI proxy client for NexoraLearning."""

from __future__ import annotations

import json
import socket
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple

try:
    from core import runlog as _runlog
except Exception:  # pragma: no cover
    try:
        from . import runlog as _runlog  # type: ignore
    except Exception:
        _runlog = None  # type: ignore


def _first_choice_text(payload: Any) -> str:
    try:
        choices = payload.get("choices") if isinstance(payload, Mapping) else None
        message = (choices[0] or {}).get("message") if choices else None
        return str((message or {}).get("content") or "")
    except Exception:
        return ""


def _response_output_text(payload: Any) -> str:
    if not isinstance(payload, Mapping):
        return ""

    output_text = payload.get("output_text")
    if isinstance(output_text, str):
        return output_text

    parts: List[str] = []
    output_items = payload.get("output")
    if isinstance(output_items, list):
        for item in output_items:
            if not isinstance(item, Mapping):
                continue

            content_items = item.get("content")
            if isinstance(content_items, list):
                for content in content_items:
                    if not isinstance(content, Mapping):
                        continue

                    text = content.get("text")
                    if isinstance(text, str):
                        parts.append(text)
                        continue

                    value = content.get("value")
                    if isinstance(value, str):
                        parts.append(value)
            else:
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)

    return "\n".join(parts)


def _request_prompt_chars(request_payload: Mapping[str, Any]) -> int:
    prompt_chars = 0

    for msg in (request_payload or {}).get("messages") or []:
        if isinstance(msg, Mapping):
            prompt_chars += len(str(msg.get("content") or ""))

    instructions = (request_payload or {}).get("instructions")
    if instructions is not None:
        prompt_chars += len(str(instructions))

    input_items = (request_payload or {}).get("input")
    if input_items is not None:
        try:
            prompt_chars += len(json.dumps(input_items, ensure_ascii=False, separators=(",", ":")))
        except Exception:
            prompt_chars += len(str(input_items))

    return prompt_chars


def _usage_tokens_from_result(result: Any, request_payload: Mapping[str, Any]) -> Dict[str, Any]:
    """优先取上游 usage；缺失时按 ~4 字符/token 估算并标记 estimated。"""
    payload = result.get("payload") if isinstance(result, Mapping) else None
    usage = payload.get("usage") if isinstance(payload, Mapping) else None

    if isinstance(usage, Mapping):
        prompt = usage.get("prompt_tokens", usage.get("input_tokens"))
        completion = usage.get("completion_tokens", usage.get("output_tokens"))

        if prompt is not None or completion is not None:
            prompt_count = int(prompt or 0)
            completion_count = int(completion or 0)
            return {
                "prompt": prompt_count,
                "completion": completion_count,
                "total": int(usage.get("total_tokens") or (prompt_count + completion_count)),
            }

    prompt_chars = _request_prompt_chars(request_payload)
    completion_chars = len(_first_choice_text(payload) or _response_output_text(payload))
    return {
        "prompt": prompt_chars // 4,
        "completion": completion_chars // 4,
        "total": (prompt_chars + completion_chars) // 4,
        "estimated": True,
    }


class NexoraProxy:
    """Thin HTTP client around fixed Nexora PAPI endpoints."""

    def __init__(self, cfg: Mapping[str, Any]):
        import traceback
        nexora_cfg = dict((cfg or {}).get("nexora") or {})
        self.base_url = str(nexora_cfg.get("base_url") or "http://127.0.0.1:5000").rstrip("/")
        self.api_key = str(nexora_cfg.get("api_key") or "").strip()
        self.default_username = str(
            nexora_cfg.get("username")
            or nexora_cfg.get("target_username")
            or ""
        ).strip()
        self.models_path = self._normalize_path(nexora_cfg.get("models_path"), default="/api/papi/models")
        self.completions_path = self._normalize_path(
            nexora_cfg.get("completions_path"), default="/api/papi/completions"
        )
        self.responses_path = self._normalize_path(nexora_cfg.get("responses_path"), default="/api/papi/responses")
        self.chat_completions_path = self._normalize_path(
            nexora_cfg.get("chat_completions_path"), default="/api/papi/chat/completions"
        )
        self.learning_chat_path = self._normalize_path(
            nexora_cfg.get("learning_chat_path"), default="/api/papi/learning/chat"
        )
        self.user_info_path = self._normalize_path(
            nexora_cfg.get("user_info_path"), default="/api/papi/user/info"
        )
        self.append_username_to_path = self._as_bool(nexora_cfg.get("append_username_to_path"), default=False)
        try:
            timeout = float(nexora_cfg.get("request_timeout") or 90)
        except Exception:
            timeout = 90.0
        self.request_timeout = max(10.0, min(timeout, 600.0))

    @staticmethod
    def _as_bool(value: Any, default: bool = False) -> bool:
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    @staticmethod
    def _normalize_path(value: Any, *, default: str) -> str:
        path = str(value or default).strip()
        if not path.startswith("/"):
            path = f"/{path}"
        return path.rstrip("/")

    @staticmethod
    def _merge_stream_fragment(existing: str, incoming: str) -> Tuple[str, str]:
        """合并流式字段片段，并返回本次真正新增的文本。"""
        current = str(existing or "")
        piece = str(incoming or "")

        if not piece:
            return current, ""

        if not current:
            return piece, piece

        if piece == current:
            return current, ""

        if piece.startswith(current):
            return piece, piece[len(current):]

        return f"{current}{piece}", piece

    @staticmethod
    def _merge_tool_argument_fragment(existing: str, incoming: str) -> str:
        """Merge function.arguments fragments across delta and snapshot protocols."""
        current = str(existing or "")
        piece = str(incoming or "")

        if not piece:
            return current

        if not current:
            return piece

        if piece == current:
            return current

        if piece.startswith(current):
            return piece

        if current.startswith(piece):
            return current

        if current.strip() in {"{}", "[]"} and piece.lstrip().startswith(("{", "[")):
            return piece

        return f"{current}{piece}"

    @staticmethod
    def _build_tool_arguments_debug(tool_calls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []

        for row in tool_calls:
            if not isinstance(row, dict):
                continue

            func = row.get("function") if isinstance(row.get("function"), dict) else {}
            arguments = str(func.get("arguments") or "")
            json_valid = False
            json_error = ""

            if arguments.strip():
                try:
                    json_valid = isinstance(json.loads(arguments), dict)
                except Exception as exc:
                    json_error = str(exc)

            rows.append(
                {
                    "id": str(row.get("id") or ""),
                    "name": str(func.get("name") or ""),
                    "arguments_len": len(arguments),
                    "arguments_head": arguments[:240],
                    "arguments_tail": arguments[-240:] if arguments else "",
                    "arguments_json_valid": json_valid,
                    "arguments_json_error": json_error[:240],
                }
            )

        return rows

    @staticmethod
    def _stringify_stream_delta(value: Any) -> str:
        """Extract text from OpenAI-compatible streaming delta fields."""
        if isinstance(value, str):
            return value

        if isinstance(value, list):
            parts: List[str] = []

            for piece in value:
                if isinstance(piece, str):
                    parts.append(piece)
                elif isinstance(piece, dict):
                    text_piece = str(piece.get("text") or piece.get("content") or "")
                    if text_piece:
                        parts.append(text_piece)

            return "".join(parts)

        return ""

    def _build_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _resolve_path(self, path: str, username: Optional[str]) -> str:
        base_path = self._normalize_path(path, default=path)
        target_username = str(username or "").strip()
        if target_username and self.append_username_to_path:
            return f"{base_path}/{urllib.parse.quote(target_username)}"
        return base_path

    def _request_json(
        self,
        path: str,
        *,
        method: str = "POST",
        payload: Optional[Dict[str, Any]] = None,
        username: Optional[str] = None,
        request_timeout: Optional[float] = None,
    ) -> Tuple[int, Dict[str, Any], str]:
        endpoint = self._resolve_path(path, username)
        url = f"{self.base_url}{endpoint}"
        body = None
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        timeout_value = self.request_timeout
        if request_timeout is not None:
            try:
                timeout_value = max(10.0, min(float(request_timeout), 1800.0))
            except Exception:
                timeout_value = self.request_timeout
        req = urllib.request.Request(
            url,
            data=body,
            headers=self._build_headers(),
            method=method.upper(),
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout_value) as resp:
                status = int(getattr(resp, "status", 200) or 200)
                text = resp.read().decode("utf-8", errors="replace")
                if not text.strip():
                    return status, {}, endpoint
                try:
                    parsed = json.loads(text)
                except Exception:
                    return status, {"raw_text": text}, endpoint
                return status, parsed if isinstance(parsed, dict) else {"data": parsed}, endpoint
        except urllib.error.HTTPError as exc:
            status = int(getattr(exc, "code", 502) or 502)
            try:
                text = exc.read().decode("utf-8", errors="replace")
            except Exception:
                text = str(exc)
            try:
                parsed = json.loads(text) if text.strip() else {}
                if isinstance(parsed, dict):
                    return status, parsed, endpoint
                return status, {"data": parsed}, endpoint
            except Exception:
                return status, {"success": False, "message": text or str(exc)}, endpoint
        except Exception as exc:
            return 0, {"success": False, "message": str(exc)}, endpoint

    @staticmethod
    def _safe_error(payload: Mapping[str, Any], status: int) -> str:
        message = str(payload.get("message") or "").strip()
        if message:
            return message
        err = payload.get("error")
        if isinstance(err, dict):
            detail = str(err.get("message") or err.get("detail") or "").strip()
            if detail:
                return detail
        if status:
            return f"HTTP {status}"
        return "request failed"

    @staticmethod
    def _extract_output_text(payload: Mapping[str, Any]) -> str:
        # 某些代理会把真实结果包在 response 字段中。
        nested_response = payload.get("response")
        if isinstance(nested_response, dict):
            nested = NexoraProxy._extract_output_text(nested_response)
            if nested.strip():
                return nested

        content = payload.get("content")
        if isinstance(content, str) and content.strip():
            return content

        message = payload.get("message")
        if isinstance(message, dict):
            msg_content = message.get("content")
            if isinstance(msg_content, str) and msg_content.strip():
                return msg_content
            if isinstance(msg_content, list):
                parts: List[str] = []
                for piece in msg_content:
                    if isinstance(piece, dict):
                        text = str(piece.get("text") or "").strip()
                        if text:
                            parts.append(text)
                if parts:
                    return "\n".join(parts).strip()

        choices = payload.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0] if isinstance(choices[0], dict) else {}
            choice_message = first.get("message") if isinstance(first, dict) else {}
            if isinstance(choice_message, dict):
                text = choice_message.get("content")
                if isinstance(text, str) and text.strip():
                    return text
                if isinstance(text, list):
                    parts: List[str] = []
                    for piece in text:
                        if not isinstance(piece, dict):
                            continue
                        piece_text = str(piece.get("text") or "").strip()
                        if piece_text:
                            parts.append(piece_text)
                    if parts:
                        return "\n".join(parts).strip()
            # OpenAI compatible delta-style aggregate fallback
            delta_obj = first.get("delta") if isinstance(first, dict) else {}
            if isinstance(delta_obj, dict):
                dtext = delta_obj.get("content")
                if isinstance(dtext, str) and dtext.strip():
                    return dtext

        output_text = payload.get("output_text")
        if isinstance(output_text, str) and output_text.strip():
            return output_text

        output = payload.get("output")
        if isinstance(output, list):
            text_parts: List[str] = []
            for item in output:
                if not isinstance(item, dict):
                    continue
                if str(item.get("type") or "").strip() != "message":
                    continue
                for part in item.get("content") or []:
                    if not isinstance(part, dict):
                        continue
                    part_type = str(part.get("type") or "").strip()
                    if part_type in {"output_text", "text", "input_text"}:
                        text = str(part.get("text") or "").strip()
                        if text:
                            text_parts.append(text)
            if text_parts:
                return "\n".join(text_parts).strip()
        return ""

    def extract_output_text(self, payload: Mapping[str, Any]) -> str:
        return self._extract_output_text(payload)

    def _build_request_result(self, *, status: int, payload: Dict[str, Any], endpoint: str) -> Dict[str, Any]:
        if status >= 400 or status == 0:
            return {
                "ok": False,
                "status": status or 502,
                "endpoint": endpoint,
                "payload": payload,
                "message": self._safe_error(payload, status),
            }
        if isinstance(payload, dict) and payload.get("success") is False:
            return {
                "ok": False,
                "status": status or 502,
                "endpoint": endpoint,
                "payload": payload,
                "message": self._safe_error(payload, status),
            }
        return {
            "ok": True,
            "status": status,
            "endpoint": endpoint,
            "payload": payload if isinstance(payload, dict) else {},
            "message": "",
        }

    def list_models(self, username: Optional[str] = None, request_timeout: Optional[float] = None) -> Dict[str, Any]:
        status, resp, endpoint = self._request_json(
            self.models_path,
            method="GET",
            payload=None,
            username=username,
            request_timeout=request_timeout,
        )
        result = self._build_request_result(status=status, payload=resp, endpoint=endpoint)
        if not result.get("ok"):
            return {
                "success": False,
                "status": result.get("status"),
                "endpoint": result.get("endpoint"),
                "message": result.get("message"),
                "payload": result.get("payload"),
            }
        return {
            "success": True,
            "status": result.get("status"),
            "endpoint": result.get("endpoint"),
            "payload": result.get("payload"),
        }

    def get(
        self,
        path: str,
        *,
        username: Optional[str] = None,
        request_timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        """通用 GET 请求，返回统一 success/payload 结构。"""
        status, resp, endpoint = self._request_json(
            path,
            method="GET",
            payload=None,
            username=username,
            request_timeout=request_timeout,
        )
        result = self._build_request_result(status=status, payload=resp, endpoint=endpoint)
        if not result.get("ok"):
            return {
                "success": False,
                "status": result.get("status"),
                "endpoint": result.get("endpoint"),
                "message": result.get("message"),
                "payload": result.get("payload"),
            }
        return {
            "success": True,
            "status": result.get("status"),
            "endpoint": result.get("endpoint"),
            "payload": result.get("payload"),
        }

    def post_json(
        self,
        path: str,
        *,
        payload: Optional[Dict[str, Any]] = None,
        username: Optional[str] = None,
        request_timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        """通用 POST JSON 请求，返回统一 success/payload 结构。"""
        status, resp, endpoint = self._request_json(
            path,
            method="POST",
            payload=payload or {},
            username=username,
            request_timeout=request_timeout,
        )
        result = self._build_request_result(status=status, payload=resp, endpoint=endpoint)
        if not result.get("ok"):
            return {
                "success": False,
                "status": result.get("status"),
                "endpoint": result.get("endpoint"),
                "message": result.get("message"),
                "payload": result.get("payload"),
            }
        return {
            "success": True,
            "status": result.get("status"),
            "endpoint": result.get("endpoint"),
            "payload": result.get("payload"),
        }

    def get_user_info(self, username: Optional[str] = None, request_timeout: Optional[float] = None) -> Dict[str, Any]:
        target_username = str(username or self.default_username or "").strip()
        if not target_username:
            return {
                "success": False,
                "status": 400,
                "endpoint": self.user_info_path,
                "message": "username is required",
                "payload": {},
            }
        endpoint = f"{self.user_info_path}/{urllib.parse.quote(target_username)}"
        status, resp, used_endpoint = self._request_json(
            endpoint,
            method="GET",
            payload=None,
            username=None,
            request_timeout=request_timeout,
        )
        result = self._build_request_result(status=status, payload=resp, endpoint=used_endpoint)
        if not result.get("ok"):
            return {
                "success": False,
                "status": result.get("status"),
                "endpoint": result.get("endpoint"),
                "message": result.get("message"),
                "payload": result.get("payload"),
            }
        payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
        return {
            "success": True,
            "status": result.get("status"),
            "endpoint": result.get("endpoint"),
            "payload": payload,
            "user": payload.get("user") if isinstance(payload.get("user"), dict) else {},
        }

    def chat_completions(
        self,
        *,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        username: Optional[str] = None,
        options: Optional[Mapping[str, Any]] = None,
        use_chat_path: bool = False,
        request_timeout: Optional[float] = None,
        on_delta: Optional[Callable[[str], None]] = None,
        on_reasoning_delta: Optional[Callable[[str], None]] = None,
        cancel_event: Any = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "messages": list(messages or []),
            "stream": bool((options or {}).get("stream") is True),
        }
        target_username = str(username or self.default_username or "").strip()
        if model:
            payload["model"] = model
        if target_username:
            payload["username"] = target_username
        for key in (
            "temperature",
            "top_p",
            "max_tokens",
            "think",
            "presence_penalty",
            "frequency_penalty",
            "seed",
            "stop",
            "tools",
            "tool_choice",
            "response_format",
            "stream_options",
        ):
            value = (options or {}).get(key)
            if value is not None:
                payload[key] = value

        endpoint = self.chat_completions_path if use_chat_path else self.completions_path
        span_id = ""

        if _runlog is not None:
            try:
                span_id = _runlog.start_span(
                    "llm",
                    str(payload.get("model") or "chat"),
                    args={
                        "endpoint": endpoint,
                        "message_count": len(payload["messages"]),
                        "stream": payload["stream"],
                    },
                )
            except Exception:
                span_id = ""

        try:
            if payload.get("stream") is True:
                status, resp, used_endpoint = self._request_chat_stream(
                    endpoint,
                    payload=payload,
                    username=target_username,
                    request_timeout=request_timeout,
                    on_delta=on_delta,
                    on_reasoning_delta=on_reasoning_delta,
                    cancel_event=cancel_event,
                )
            else:
                status, resp, used_endpoint = self._request_json(
                    endpoint,
                    method="POST",
                    payload=payload,
                    username=target_username,
                    request_timeout=request_timeout,
                )
            result = self._build_request_result(status=status, payload=resp, endpoint=used_endpoint)
        except Exception as exc:
            if span_id:
                try:
                    _runlog.end_span(span_id, status="error", result=repr(exc))
                except Exception:
                    pass
            raise

        if span_id:
            try:
                _runlog.end_span(
                    span_id,
                    status="ok" if result.get("ok") else "error",
                    tokens=_usage_tokens_from_result(result, payload),
                    result=_first_choice_text(result.get("payload"))[:300],
                )
            except Exception:
                pass

        return result

    def responses(
        self,
        *,
        model: Optional[str] = None,
        username: Optional[str] = None,
        input_items: Optional[List[Dict[str, Any]]] = None,
        instructions: str = "",
        options: Optional[Mapping[str, Any]] = None,
        request_timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"stream": False}
        target_username = str(username or self.default_username or "").strip()
        if model:
            payload["model"] = model
        if target_username:
            payload["username"] = target_username
        if isinstance(input_items, list):
            payload["input"] = input_items
        if str(instructions or "").strip():
            payload["instructions"] = str(instructions or "")
        for key in (
            "temperature",
            "top_p",
            "max_tokens",
            "max_output_tokens",
            "tools",
            "tool_choice",
            "response_format",
            "parallel_tool_calls",
            "metadata",
            "text",
            "reasoning",
            "store",
            "include",
            "truncation",
            "previous_response_id",
            "allow_synthetic_fallback",
            "force_chat_bridge",
        ):
            value = (options or {}).get(key)
            if value is not None:
                payload[key] = value

        span_id = ""

        if _runlog is not None:
            try:
                span_id = _runlog.start_span(
                    "llm",
                    str(payload.get("model") or "responses"),
                    args={
                        "endpoint": self.responses_path,
                        "input_count": len(payload.get("input") or []),
                        "stream": False,
                    },
                )
            except Exception:
                span_id = ""

        try:
            status, resp, endpoint = self._request_json(
                self.responses_path,
                method="POST",
                payload=payload,
                username=target_username,
                request_timeout=request_timeout,
            )
            result = self._build_request_result(status=status, payload=resp, endpoint=endpoint)
        except Exception as exc:
            if span_id:
                try:
                    _runlog.end_span(span_id, status="error", result=repr(exc))
                except Exception:
                    pass
            raise

        if span_id:
            try:
                _runlog.end_span(
                    span_id,
                    status="ok" if result.get("ok") else "error",
                    tokens=_usage_tokens_from_result(result, payload),
                    result=_response_output_text(result.get("payload"))[:300],
                )
            except Exception:
                pass

        return result

    def complete_raw(
        self,
        *,
        messages: Optional[List[Dict[str, Any]]] = None,
        model: Optional[str] = None,
        username: Optional[str] = None,
        api_mode: str = "chat",
        input_items: Optional[List[Dict[str, Any]]] = None,
        instructions: str = "",
        options: Optional[Mapping[str, Any]] = None,
        request_timeout: Optional[float] = None,
        on_delta: Optional[Callable[[str], None]] = None,
        cancel_event: Any = None,
    ) -> Dict[str, Any]:
        normalized_mode = str(api_mode or "chat").strip().lower()
        safe_messages = list(messages or [])
        safe_input = list(input_items or [])
        if normalized_mode == "auto":
            normalized_mode = "responses" if safe_input else "chat"
        if normalized_mode == "responses":
            result = self.responses(
                model=model,
                username=username,
                input_items=safe_input,
                instructions=instructions,
                options=options,
                request_timeout=request_timeout,
            )
            mode = "responses"
        else:
            result = self.chat_completions(
                messages=safe_messages,
                model=model,
                username=username,
                options=options,
                use_chat_path=False,
                request_timeout=request_timeout,
                on_delta=on_delta,
                cancel_event=cancel_event,
            )
            mode = "chat"

        if not result.get("ok"):
            return {
                "success": False,
                "api_mode": mode,
                "endpoint": result.get("endpoint"),
                "status": result.get("status"),
                "message": result.get("message") or "request failed",
                "payload": result.get("payload") or {},
            }

        payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
        return {
            "success": True,
            "api_mode": mode,
            "endpoint": result.get("endpoint"),
            "status": result.get("status"),
            "payload": payload,
            "content": self._extract_output_text(payload),
        }

    def _request_chat_stream(
        self,
        path: str,
        *,
        payload: Dict[str, Any],
        username: Optional[str],
        request_timeout: Optional[float],
        on_delta: Optional[Callable[[str], None]] = None,
        on_reasoning_delta: Optional[Callable[[str], None]] = None,
        cancel_event: Any = None,
    ) -> Tuple[int, Dict[str, Any], str]:
        endpoint = self._resolve_path(path, username)
        url = f"{self.base_url}{endpoint}"
        timeout_value = self.request_timeout
        if request_timeout is not None:
            try:
                timeout_value = max(10.0, min(float(request_timeout), 1800.0))
            except Exception:
                timeout_value = self.request_timeout
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            headers=self._build_headers(),
            method="POST",
        )
        full_text: List[str] = []
        reasoning_text: List[str] = []
        raw_events: List[str] = []
        chunk_count = 0
        streamed_tool_calls: Dict[str, Dict[str, Any]] = {}
        streamed_tool_order: List[str] = []
        final_finish_reason = "stop"
        usage_payload: Dict[str, Any] = {}
        chunk_key_counts: Dict[str, int] = {}
        choice_key_counts: Dict[str, int] = {}
        delta_key_counts: Dict[str, int] = {}
        tool_fragment_count = 0

        def bump_keys(bucket: Dict[str, int], obj: Any) -> None:
            if not isinstance(obj, dict):
                return

            for key in obj.keys():
                key_text = str(key or "").strip() or "-"
                bucket[key_text] = int(bucket.get(key_text, 0) or 0) + 1

        def record_tool_call_fragments(raw_tool_calls: Any) -> int:
            if not isinstance(raw_tool_calls, list):
                return 0

            handled = 0

            for idx, tc in enumerate(raw_tool_calls):
                if not isinstance(tc, dict):
                    continue

                handled += 1
                tc_id = str(tc.get("id") or "").strip()
                tc_index = tc.get("index", idx)

                try:
                    tc_index_i = int(tc_index)
                except Exception:
                    tc_index_i = idx

                key = tc_id or f"index:{tc_index_i}"
                if key not in streamed_tool_calls:
                    streamed_tool_calls[key] = {
                        "id": tc_id or f"tool_call_{tc_index_i}",
                        "type": str(tc.get("type") or "function"),
                        "index": tc_index_i,
                        "function": {"name": "", "arguments": ""},
                    }
                    streamed_tool_order.append(key)

                entry = streamed_tool_calls[key]
                func = tc.get("function") if isinstance(tc.get("function"), dict) else {}
                name_part = str(func.get("name") or "")
                args_part = str(func.get("arguments") or "")

                if name_part:
                    prev_name = str((entry.get("function") or {}).get("name") or "")
                    merged_name, _name_delta = self._merge_stream_fragment(prev_name, name_part)
                    (entry["function"])["name"] = merged_name

                if args_part:
                    prev_args = str((entry.get("function") or {}).get("arguments") or "")
                    (entry["function"])["arguments"] = self._merge_tool_argument_fragment(prev_args, args_part)

            return handled

        def snapshot_content_delta(current_text: str, snapshot_value: Any) -> str:
            snapshot_text = self._stringify_stream_delta(snapshot_value)
            if not snapshot_text:
                return ""

            _merged_text, new_piece = self._merge_stream_fragment(current_text, snapshot_text)
            return new_piece

        try:
            if cancel_event is not None and cancel_event.is_set():
                return 499, {"success": False, "message": "request canceled"}, endpoint

            with urllib.request.urlopen(req, timeout=timeout_value) as resp:
                status = int(getattr(resp, "status", 200) or 200)
                for raw in resp:
                    if cancel_event is not None and cancel_event.is_set():
                        return 499, {"success": False, "message": "request canceled"}, endpoint

                    try:
                        raw_line = raw.decode("utf-8", errors="replace")
                    except Exception:
                        continue
                    line = raw_line.strip()
                    if not line:
                        continue
                    if line.startswith(":"):
                        continue
                    data_text = line
                    if line.startswith("data:"):
                        data_text = line[5:].strip()
                    if not data_text:
                        continue
                    if len(raw_events) < 40:
                        raw_events.append(data_text[:500])
                    if data_text == "[DONE]":
                        break
                    try:
                        obj = json.loads(data_text)
                    except Exception:
                        continue
                    if isinstance(obj, dict) and obj.get("error"):
                        return status, obj, endpoint
                    if not isinstance(obj, dict):
                        continue
                    chunk_count += 1
                    bump_keys(chunk_key_counts, obj)

                    # OpenAI chat.completions chunk -> choices[0].delta.content
                    delta_text = ""
                    reasoning_delta_text = ""
                    choices = obj.get("choices")
                    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
                        choice0 = choices[0]
                        bump_keys(choice_key_counts, choice0)
                        delta = choices[0].get("delta")
                        if isinstance(delta, dict):
                            bump_keys(delta_key_counts, delta)
                            delta_text = self._stringify_stream_delta(delta.get("content"))

                            for reasoning_key in ("reasoning_content", "reasoning", "thinking", "thinking_content"):
                                reasoning_delta_text = self._stringify_stream_delta(delta.get(reasoning_key))
                                if reasoning_delta_text:
                                    break

                            # OpenAI-compatible tool-calls streaming fragments.
                            tool_fragment_count += record_tool_call_fragments(delta.get("tool_calls"))

                        message_snapshot = choice0.get("message")
                        if isinstance(message_snapshot, dict):
                            bump_keys(delta_key_counts, message_snapshot)
                            if not delta_text:
                                delta_text = snapshot_content_delta("".join(full_text), message_snapshot.get("content"))

                            if not reasoning_delta_text:
                                for reasoning_key in ("reasoning_content", "reasoning", "thinking", "thinking_content"):
                                    reasoning_delta_text = snapshot_content_delta(
                                        "".join(reasoning_text),
                                        message_snapshot.get(reasoning_key),
                                    )
                                    if reasoning_delta_text:
                                        break

                            tool_fragment_count += record_tool_call_fragments(message_snapshot.get("tool_calls"))

                        finish_reason = choice0.get("finish_reason")
                        if isinstance(finish_reason, str) and finish_reason.strip():
                            final_finish_reason = finish_reason.strip()

                    if not choices:
                        if not delta_text:
                            delta_text = snapshot_content_delta("".join(full_text), obj.get("content"))

                        message_obj = obj.get("message")
                        if isinstance(message_obj, dict):
                            bump_keys(delta_key_counts, message_obj)
                            if not delta_text:
                                delta_text = snapshot_content_delta("".join(full_text), message_obj.get("content"))
                            if not reasoning_delta_text:
                                for reasoning_key in ("reasoning_content", "reasoning", "thinking", "thinking_content"):
                                    reasoning_delta_text = snapshot_content_delta(
                                        "".join(reasoning_text),
                                        message_obj.get(reasoning_key),
                                    )
                                    if reasoning_delta_text:
                                        break
                            tool_fragment_count += record_tool_call_fragments(message_obj.get("tool_calls"))

                    usage_obj = obj.get("usage")
                    if isinstance(usage_obj, dict):
                        usage_payload = dict(usage_obj)
                    if delta_text:
                        full_text.append(delta_text)
                    if reasoning_delta_text:
                        reasoning_text.append(reasoning_delta_text)
                    if delta_text and on_delta is not None:
                        try:
                            # 仅向上游透传模型正文；工具调用由最终 message.tool_calls 和执行日志展示。
                            on_delta(delta_text)
                        except Exception:
                            pass
                    if reasoning_delta_text and on_reasoning_delta is not None:
                        try:
                            on_reasoning_delta(reasoning_delta_text)
                        except Exception:
                            pass
                if chunk_count == 0:
                    debug_preview = "\n".join(raw_events[:20])
                    return status, {
                        "success": False,
                        "message": f"stream completed but no event parsed | preview={debug_preview[:1500]}",
                        "debug_events_preview": debug_preview,
                    }, endpoint
                final_text = "".join(full_text).strip()
                final_reasoning_text = "".join(reasoning_text).strip()
                tool_calls_list: List[Dict[str, Any]] = []
                for key in streamed_tool_order:
                    row = streamed_tool_calls.get(key) or {}
                    if not isinstance(row, dict):
                        continue
                    fn = row.get("function") if isinstance(row.get("function"), dict) else {}
                    # 至少有 name 或 arguments 才认为是有效工具调用。
                    if not str(fn.get("name") or "").strip() and not str(fn.get("arguments") or "").strip():
                        continue
                    tool_calls_list.append(
                        {
                            "id": str(row.get("id") or ""),
                            "type": str(row.get("type") or "function"),
                            "function": {
                                "name": str(fn.get("name") or ""),
                                "arguments": str(fn.get("arguments") or ""),
                            },
                        }
                    )
                tool_arguments_debug = self._build_tool_arguments_debug(tool_calls_list)
                stream_debug = {
                    "endpoint": endpoint,
                    "model": str(payload.get("model") or ""),
                    "chunk_count": int(chunk_count),
                    "finish_reason": final_finish_reason,
                    "content_chars": len(final_text),
                    "reasoning_chars": len(final_reasoning_text),
                    "tool_call_count": len(tool_calls_list),
                    "tool_fragment_count": int(tool_fragment_count),
                    "chunk_keys": chunk_key_counts,
                    "choice_keys": choice_key_counts,
                    "delta_keys": delta_key_counts,
                    "tool_arguments": tool_arguments_debug,
                    "raw_events_preview": raw_events[:8],
                }

                if not final_text and not final_reasoning_text and not tool_calls_list:
                    try:
                        from .runlog import log_event

                        log_event(
                            "nexora_proxy_stream_empty",
                            "模型流未解析出正文、推理或工具调用",
                            payload=stream_debug,
                            content="\n".join(raw_events[:8]),
                        )
                    except Exception:
                        pass

                message_obj: Dict[str, Any] = {"role": "assistant", "content": final_text}
                if final_reasoning_text:
                    message_obj["reasoning_content"] = final_reasoning_text
                if tool_calls_list:
                    message_obj["tool_calls"] = tool_calls_list
                    if final_finish_reason == "stop":
                        final_finish_reason = "tool_calls"
                payload_obj: Dict[str, Any] = {
                    "object": "chat.completion",
                    "choices": [
                        {
                            "index": 0,
                            "message": message_obj,
                            "finish_reason": final_finish_reason,
                        }
                    ],
                    "_stream_chunks": chunk_count,
                    "_stream_debug": stream_debug,
                }
                if usage_payload:
                    payload_obj["usage"] = usage_payload
                if final_reasoning_text:
                    payload_obj["reasoning_content"] = final_reasoning_text
                return status, {
                    **payload_obj
                }, endpoint
        except urllib.error.HTTPError as exc:
            status = int(getattr(exc, "code", 502) or 502)
            try:
                text = exc.read().decode("utf-8", errors="replace")
            except Exception:
                text = str(exc)
            try:
                parsed = json.loads(text) if text.strip() else {}
                if isinstance(parsed, dict):
                    return status, parsed, endpoint
                return status, {"data": parsed}, endpoint
            except Exception:
                return status, {"success": False, "message": text or str(exc)}, endpoint
        except (socket.timeout, TimeoutError) as exc:
            return 0, {"success": False, "message": str(exc) or "timed out"}, endpoint
        except Exception as exc:
            return 0, {"success": False, "message": str(exc)}, endpoint

    def chat_complete(
        self,
        system_prompt: str,
        user_prompt: str,
        model: Optional[str] = None,
        username: Optional[str] = None,
    ) -> str:
        messages = []
        if str(system_prompt or "").strip():
            messages.append({"role": "system", "content": str(system_prompt)})
        messages.append({"role": "user", "content": str(user_prompt or "")})

        result = self.complete_raw(
            messages=messages,
            model=model,
            username=username,
            api_mode="chat",
            options={"temperature": 0.3},
        )
        if not result.get("success"):
            raise RuntimeError(f"Nexora API Error: {result.get('message') or 'request failed'}")
        return str(result.get("content") or "")

    def extract_outline(self, text: str) -> str:
        system = "Extract a short learning outline in markdown."
        return self.chat_complete(system, str(text or "")[:15000])
