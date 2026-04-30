"""Nexora API/PAPI proxy client for NexoraLearning."""

from __future__ import annotations

import json
import socket
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple


class NexoraProxy:
    """Thin HTTP client around fixed Nexora PAPI endpoints."""

    def __init__(self, cfg: Mapping[str, Any]):
        nexora_cfg = dict((cfg or {}).get("nexora") or {})
        self.base_url = str(nexora_cfg.get("base_url") or "http://127.0.0.1:5000").rstrip("/")
        self.api_key = str(
            nexora_cfg.get("public_api_key")
            or nexora_cfg.get("api_key")
            or ""
        ).strip()
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
        if payload.get("stream") is True:
            status, resp, used_endpoint = self._request_chat_stream(
                endpoint,
                payload=payload,
                username=target_username,
                request_timeout=request_timeout,
                on_delta=on_delta,
            )
        else:
            status, resp, used_endpoint = self._request_json(
                endpoint,
                method="POST",
                payload=payload,
                username=target_username,
                request_timeout=request_timeout,
            )
        return self._build_request_result(status=status, payload=resp, endpoint=used_endpoint)

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

        status, resp, endpoint = self._request_json(
            self.responses_path,
            method="POST",
            payload=payload,
            username=target_username,
            request_timeout=request_timeout,
        )
        return self._build_request_result(status=status, payload=resp, endpoint=endpoint)

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
        raw_events: List[str] = []
        chunk_count = 0
        try:
            with urllib.request.urlopen(req, timeout=timeout_value) as resp:
                status = int(getattr(resp, "status", 200) or 200)
                for raw in resp:
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

                    # OpenAI chat.completions chunk -> choices[0].delta.content
                    delta_text = ""
                    choices = obj.get("choices")
                    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
                        delta = choices[0].get("delta")
                        if isinstance(delta, dict):
                            content = delta.get("content")
                            if isinstance(content, str):
                                delta_text = content
                            elif isinstance(content, list):
                                parts: List[str] = []
                                for piece in content:
                                    if isinstance(piece, str):
                                        parts.append(piece)
                                    elif isinstance(piece, dict):
                                        text_piece = str(piece.get("text") or piece.get("content") or "")
                                        if text_piece:
                                            parts.append(text_piece)
                                delta_text = "".join(parts)
                    if delta_text:
                        full_text.append(delta_text)
                        if on_delta is not None:
                            try:
                                # 只回传 token 增量，避免日志膨胀。
                                on_delta(delta_text)
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
                return status, {
                    "object": "chat.completion",
                    "choices": [
                        {
                            "index": 0,
                            "message": {"role": "assistant", "content": final_text},
                            "finish_reason": "stop",
                        }
                    ],
                    "_stream_chunks": chunk_count,
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
