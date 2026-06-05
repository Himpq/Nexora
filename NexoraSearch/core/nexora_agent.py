import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Mapping, Optional, Tuple


logger = logging.getLogger(__name__)


class NexoraPageAgentClient:
    def __init__(self, config: Mapping[str, Any]):
        nexora_cfg = dict((config or {}).get("nexora") or {})
        models_cfg = dict((config or {}).get("models") or {})

        self.base_url = str(nexora_cfg.get("base_url") or "http://127.0.0.1:5000").rstrip("/")
        self.api_key = str(nexora_cfg.get("api_key") or "").strip()
        self.models_path = self._normalize_path(nexora_cfg.get("models_path"), default="/api/papi/models")
        self.completions_path = self._normalize_path(nexora_cfg.get("completions_path"), default="/api/papi/completions")
        self.responses_path = self._normalize_path(nexora_cfg.get("responses_path"), default="/api/papi/responses")
        self.chat_completions_path = self._normalize_path(
            nexora_cfg.get("chat_completions_path"),
            default="/api/papi/chat/completions",
        )

        try:
            self.request_timeout = max(10.0, min(float(nexora_cfg.get("request_timeout") or 90), 600.0))
        except Exception:
            self.request_timeout = 90.0

        self.models_cfg = models_cfg

    @staticmethod
    def _normalize_path(value: Any, *, default: str) -> str:
        path = str(value or default).strip()
        if not path.startswith("/"):
            path = f"/{path}"
        return path.rstrip("/")

    @staticmethod
    def _coerce_bool(value: Any, default: bool = False) -> bool:
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    @staticmethod
    def _coerce_int(value: Any, default: Optional[int] = None) -> Optional[int]:
        if value is None or value == "":
            return default
        try:
            return int(float(value))
        except Exception:
            return default

    def _build_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _request_json(
        self,
        path: str,
        *,
        method: str = "POST",
        payload: Optional[Dict[str, Any]] = None,
        request_timeout: Optional[float] = None,
    ) -> Tuple[int, Dict[str, Any], str]:
        endpoint = self._normalize_path(path, default=path)
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
    def _extract_text(payload: Mapping[str, Any]) -> str:
        response_obj = payload.get("response")
        if isinstance(response_obj, dict):
            nested = NexoraPageAgentClient._extract_text(response_obj)
            if nested.strip():
                return nested

        content = payload.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()

        output_text = payload.get("output_text")
        if isinstance(output_text, str) and output_text.strip():
            return output_text.strip()

        choices = payload.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0] if isinstance(choices[0], dict) else {}
            message = first.get("message") if isinstance(first, dict) else {}
            if isinstance(message, dict):
                msg_content = message.get("content")
                if isinstance(msg_content, str) and msg_content.strip():
                    return msg_content.strip()
                if isinstance(msg_content, list):
                    parts = []
                    for piece in msg_content:
                        if not isinstance(piece, dict):
                            continue
                        text = str(piece.get("text") or "").strip()
                        if text:
                            parts.append(text)
                    if parts:
                        return "\n".join(parts).strip()

        output = payload.get("output")
        if isinstance(output, list):
            parts = []
            for item in output:
                if not isinstance(item, dict):
                    continue
                if str(item.get("type") or "").strip() != "message":
                    continue
                for part in item.get("content") or []:
                    if not isinstance(part, dict):
                        continue
                    if str(part.get("type") or "").strip() in {"text", "output_text", "input_text"}:
                        text = str(part.get("text") or "").strip()
                        if text:
                            parts.append(text)
            if parts:
                return "\n".join(parts).strip()

        return ""

    def _resolve_model(self, model_name: Optional[str]) -> Tuple[str, Dict[str, Any]]:
        target_name = str(model_name or "").strip()
        if not target_name:
            target_name = "page_parse_agent"

        model_cfg = self.models_cfg.get(target_name)
        if not isinstance(model_cfg, dict):
            raise ValueError(f"Missing model definition: {target_name}")

        actual_model_name = str(model_cfg.get("model_name") or "").strip()
        if not actual_model_name:
            raise ValueError(f"Missing Nexora model_name for: {target_name}")

        if not self._coerce_bool(model_cfg.get("enabled"), True):
            raise ValueError(f"Model disabled: {target_name}")

        return actual_model_name, model_cfg

    @staticmethod
    def _strip_json(text: str) -> str:
        raw = str(text or "").strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
            raw = re.sub(r"\s*```$", "", raw)
        return raw.strip()

    def _build_prompt(
        self,
        *,
        url: str,
        title: str,
        html: str,
        text: str,
        instructions: str,
        model_cfg: Mapping[str, Any],
    ) -> Tuple[str, str]:
        system_prompt = str(model_cfg.get("system_prompt") or "").strip()
        if not system_prompt:
            system_prompt = "You are a webpage parsing agent. Return a strict JSON object only."

        prompt_notes = str(model_cfg.get("prompt_notes") or "").strip()
        max_input_chars = self._coerce_int(model_cfg.get("max_input_chars"), 32000) or 32000

        text_block = str(text or "").strip()[:max_input_chars]
        html_block = str(html or "").strip()[:max_input_chars]
        title_block = str(title or "").strip()
        instructions_block = str(instructions or "").strip()

        user_parts = [
            "Parse the following page and return strict JSON only.",
            "No markdown, no code fences, no commentary.",
            "Required keys: url, title, page_type, summary, key_points, entities, links, content.",
            f"URL: {url}",
        ]

        if title_block:
            user_parts.append(f"Title: {title_block}")
        if instructions_block:
            user_parts.append(f"Extra instructions: {instructions_block}")
        if prompt_notes:
            user_parts.append(f"Model notes: {prompt_notes}")
        if text_block:
            user_parts.append(f"Text content:\n{text_block}")
        if html_block:
            user_parts.append(f"HTML content:\n{html_block}")

        return system_prompt, "\n\n".join(user_parts).strip()

    def parse_page(
        self,
        *,
        url: str,
        title: str = "",
        html: str = "",
        text: str = "",
        instructions: str = "",
        model_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        try:
            actual_model_name, model_cfg = self._resolve_model(model_name)
        except Exception as exc:
            return {
                "success": False,
                "status": 400,
                "message": str(exc),
                "payload": {},
                "parsed": {},
            }

        api_mode = str(model_cfg.get("api_mode") or "responses").strip().lower()
        if api_mode not in {"responses", "chat", "completions"}:
            return {
                "success": False,
                "status": 400,
                "message": f"Unsupported api_mode: {api_mode}",
                "payload": {},
                "parsed": {},
            }

        system_prompt, user_prompt = self._build_prompt(
            url=url,
            title=title,
            html=html,
            text=text,
            instructions=instructions,
            model_cfg=model_cfg,
        )

        payload: Dict[str, Any] = {
            "model": actual_model_name,
            "stream": self._coerce_bool(model_cfg.get("stream"), False),
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }

        temperature = model_cfg.get("temperature")
        if temperature is not None and temperature != "":
            payload["temperature"] = temperature

        max_output_tokens = self._coerce_int(model_cfg.get("max_output_tokens"), None)
        if max_output_tokens is not None:
            if api_mode == "responses":
                payload["max_output_tokens"] = max_output_tokens
            else:
                payload["max_tokens"] = max_output_tokens

        think = self._coerce_bool(model_cfg.get("think"), False)
        if think:
            payload["think"] = True

        endpoint = self.responses_path
        if api_mode == "chat":
            endpoint = self.chat_completions_path
        elif api_mode == "completions":
            endpoint = self.completions_path

        request_timeout = self._coerce_int(model_cfg.get("request_timeout"), None)
        status, response_payload, used_endpoint = self._request_json(
            endpoint,
            method="POST",
            payload=payload,
            request_timeout=request_timeout,
        )

        if status == 0:
            return {
                "success": False,
                "status": 502,
                "endpoint": used_endpoint,
                "model": actual_model_name,
                "message": response_payload.get("message") or "Request failed",
                "payload": response_payload,
                "parsed": {},
            }

        if status >= 400:
            return {
                "success": False,
                "status": status,
                "endpoint": used_endpoint,
                "model": actual_model_name,
                "message": response_payload.get("message") or f"HTTP {status}",
                "payload": response_payload,
                "parsed": {},
            }

        raw_text = self._extract_text(response_payload)
        if not raw_text.strip():
            return {
                "success": False,
                "status": 502,
                "endpoint": used_endpoint,
                "model": actual_model_name,
                "message": "Empty agent output",
                "payload": response_payload,
                "raw_text": "",
                "parsed": {},
            }

        strict_text = self._strip_json(raw_text)
        try:
            parsed = json.loads(strict_text)
        except Exception as exc:
            logger.error("Agent output is not valid JSON: %s", exc)
            return {
                "success": False,
                "status": 422,
                "endpoint": used_endpoint,
                "model": actual_model_name,
                "message": "Agent output is not valid JSON",
                "payload": response_payload,
                "raw_text": raw_text,
                "parsed": {},
            }

        return {
            "success": True,
            "status": 200,
            "endpoint": used_endpoint,
            "model": actual_model_name,
            "message": "",
            "payload": response_payload,
            "raw_text": raw_text,
            "parsed": parsed,
        }
