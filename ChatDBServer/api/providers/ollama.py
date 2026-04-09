import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

from .openai import OpenAIProvider

class OllamaProvider(OpenAIProvider):
    @property
    def api_type(self) -> str:
        return "ollama"

    def _ollama_base_url(self) -> str:
        url = str(self.provider_config.get("base_url", "") or "").strip()
        if url.endswith("/v1"):
            url = url[:-3]
        return url.rstrip("/") or "http://localhost:11434"

    def _normalize_keep_alive(self, value: Any, default: str = "5m") -> str:
        text = str(value or "").strip()
        return text or str(default or "5m").strip() or "5m"

    def _default_keep_alive(self) -> str:
        settings = self.provider_config.get("settings", {}) if isinstance(self.provider_config.get("settings", {}), dict) else {}
        return self._normalize_keep_alive(settings.get("keep_alive", "5m"), default="5m")

    def _request_ollama_json(self, path: str, *, method: str = "GET", payload: Optional[Dict[str, Any]] = None, timeout: float = 8.0):
        url = f"{self._ollama_base_url()}{path}"
        method_name = str(method or "GET").strip().upper()
        try:
            if method_name == "POST":
                resp = requests.post(url, json=payload or {}, timeout=timeout)
            else:
                resp = requests.get(url, timeout=timeout)
        except Exception as exc:
            return False, {}, str(exc)

        try:
            body = resp.json()
        except Exception:
            body = {}

        if resp.status_code >= 400:
            message = "request_failed"
            if isinstance(body, dict):
                message = str(body.get("error") or body.get("message") or message)
            return False, body if isinstance(body, dict) else {}, f"http_{resp.status_code}:{message}"
        return True, body if isinstance(body, dict) else {}, ""

    def _extract_ollama_model_name(self, model_obj: Any) -> str:
        if not isinstance(model_obj, dict):
            return ""
        return str(model_obj.get("name") or model_obj.get("model") or model_obj.get("id") or "").strip()

    def _build_ollama_status_maps(self, timeout: float = 8.0):
        ok_ps, ps_payload, ps_error = self._request_ollama_json("/api/ps", timeout=timeout)
        ok_tags, tags_payload, tags_error = self._request_ollama_json("/api/tags", timeout=timeout)

        ps_models = ps_payload.get("models", []) if isinstance(ps_payload, dict) else []
        if not isinstance(ps_models, list):
            ps_models = []
            
        tags_models = tags_payload.get("models", []) if isinstance(tags_payload, dict) else []
        if not isinstance(tags_models, list):
            tags_models = []

        tags_map: Dict[str, Dict[str, Any]] = {}
        ordered_names: List[str] = []
        for item in tags_models:
            name = self._extract_ollama_model_name(item)
            if not name:
                continue
            key = name.lower()
            tags_map[key] = item if isinstance(item, dict) else {"name": name}
            if key not in ordered_names:
                ordered_names.append(key)

        ps_map: Dict[str, Dict[str, Any]] = {}
        for item in ps_models:
            name = self._extract_ollama_model_name(item)
            if not name:
                continue
            key = name.lower()
            ps_map[key] = item if isinstance(item, dict) else {"name": name}    
            if key not in ordered_names:
                ordered_names.append(key)

        return {
            "ok_ps": ok_ps,
            "ps_error": ps_error,
            "ps_models": ps_models,
            "ps_map": ps_map,
            "ok_tags": ok_tags,
            "tags_error": tags_error,
            "tags_models": tags_models,
            "tags_map": tags_map,
            "ordered_names": ordered_names,
        }

    def _format_ollama_model_status(self, model_name: str, status_maps: Dict[str, Any]) -> Dict[str, Any]:
        key = str(model_name or "").strip().lower()
        ps_map = status_maps.get("ps_map", {}) if isinstance(status_maps, dict) else {}
        ps_info = ps_map.get(key, {}) if isinstance(ps_map, dict) else {}

        running = bool(ps_info)
        if not running:
            return {
                "ok": False,
                "provider": self.provider_name,
                "api_type": self.api_type,
                "model": model_name,
                "installed": True,
                "running": False,
                "status": "offline",
                "status_label": "不在线",
                "status_level": "warning",
                "keep_alive": self._default_keep_alive(),
                "message": "模型当前未加载",
                "ps": None,
            }

        keep_alive = self._default_keep_alive()
        if isinstance(ps_info, dict):
            keep_alive = self._normalize_keep_alive(ps_info.get("keep_alive", keep_alive), default=keep_alive)

        status = "running"
        status_label = "在线"
        status_level = "success"
        message = "模型正在运行"

        return {
            "ok": True,
            "provider": self.provider_name,
            "api_type": self.api_type,
            "model": model_name,
            "installed": True,
            "running": running,
            "status": status,
            "status_label": status_label,
            "status_level": status_level,
            "keep_alive": keep_alive,
            "message": message,
            "ps": ps_info if isinstance(ps_info, dict) else None,
        }

    def list_running_models(
        self,
        *,
        timeout: float = 8.0,
    ) -> Dict[str, Any]:
        status_maps = self._build_ollama_status_maps(timeout=timeout)
        formatted = []
        for item in status_maps.get("ps_models", []) if isinstance(status_maps, dict) else []:
            model_name = self._extract_ollama_model_name(item)
            if not model_name:
                continue
            formatted.append({
                "id": model_name,
                "name": model_name,
                "status": "running",
                "status_label": "在线",
                "status_level": "success",
                "running": True,
                "installed": True,
                "keep_alive": self._normalize_keep_alive(item.get("keep_alive", self._default_keep_alive()), default=self._default_keep_alive()),
                "expires_at": item.get("expires_at"),
                "features": ["Chat", "Tool"],
                "raw": item,
            })
        return {
            "ok": True,
            "provider": self.provider_name,
            "api_type": self.api_type,
            "source": "ollama_ps_api",
            "count": len(formatted),
            "models": formatted,
            "ps_error": status_maps.get("ps_error", ""),
        }

    def inspect_model_status(self, model_name: str, *, timeout: float = 8.0) -> Dict[str, Any]:
        status_maps = self._build_ollama_status_maps(timeout=timeout)
        return self._format_ollama_model_status(model_name, status_maps)

    def toggle_model_keep_alive(
        self,
        *,
        model_name: str,
        action: str = "toggle",
        keep_alive: Optional[str] = None,
        timeout: float = 12.0,
    ) -> Dict[str, Any]:
        status_maps = self._build_ollama_status_maps(timeout=min(timeout, 8.0))
        current = self._format_ollama_model_status(model_name, status_maps)
        if not bool(current.get("ok", False)) and current.get("status") == "missing":
            return current

        action_name = str(action or "toggle").strip().lower()
        running = bool(current.get("running", False))
        if action_name not in {"load", "unload"}:
            action_name = "unload" if running else "load"

        target_keep_alive = self._normalize_keep_alive(keep_alive, default=self._default_keep_alive()) if action_name == "load" else "0"
        payload = {
            "model": str(model_name or "").strip(),
            "prompt": " ",
            "stream": False,
            "keep_alive": target_keep_alive,
        }
        ok, body, error = self._request_ollama_json("/api/generate", method="POST", payload=payload, timeout=timeout)
        refreshed = self.inspect_model_status(model_name, timeout=min(timeout, 8.0))
        refreshed["action"] = action_name
        refreshed["requested_keep_alive"] = target_keep_alive
        refreshed["request_ok"] = ok
        refreshed["request_error"] = error
        refreshed["request_body"] = body
        refreshed["ok"] = bool(ok) and bool(refreshed.get("ok", False))
        if not ok and not refreshed.get("message"):
            refreshed["message"] = error or "ollama_request_failed"
        return refreshed

    def _context_window_cache_path(self) -> str:
        return os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            "data",
            "res",
            "models_context_window.json",
        )

    def _load_context_window_cache(self) -> Dict[str, Any]:
        path = self._context_window_cache_path()
        if not os.path.exists(path):
            return {"providers": {}}
        try:
            with open(path, "r", encoding="utf-8") as handle:
                loaded = json.load(handle)
            if isinstance(loaded, dict):
                loaded.setdefault("providers", {})
                if not isinstance(loaded.get("providers"), dict):
                    loaded["providers"] = {}
                return loaded
        except Exception:
            pass
        return {"providers": {}}

    def _write_context_window_cache(self, payload: Dict[str, Any]) -> None:
        path = self._context_window_cache_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)

    def _extract_context_window(self, model_info: Any, default: int = 131072) -> int:
        def _as_int(value: Any) -> int:
            try:
                number = int(str(value or 0).strip())
            except Exception:
                return 0
            return number if number > 0 else 0

        best = 0

        def _walk(node: Any) -> None:
            nonlocal best
            if isinstance(node, dict):
                for key, value in node.items():
                    key_text = str(key or "").strip().lower()
                    if any(token in key_text for token in ("context_length", "context_window", "max_context_tokens", "max_input_tokens", "num_ctx")):
                        best = max(best, _as_int(value))
                    _walk(value)
            elif isinstance(node, list):
                for item in node:
                    _walk(item)

        _walk(model_info)
        return best if best > 0 else int(default)

    def _update_context_window_cache(self, models_list: List[Dict[str, Any]], show_url: str) -> Dict[str, Any]:
        cache = self._load_context_window_cache()
        providers = cache.setdefault("providers", {})
        provider_key = str(self.provider_name or "ollama").strip().lower() or "ollama"
        provider_node = providers.setdefault(provider_key, {})
        if not isinstance(provider_node, dict):
            provider_node = {}
            providers[provider_key] = provider_node
        models_node = provider_node.setdefault("models", {})
        if not isinstance(models_node, dict):
            models_node = {}
            provider_node["models"] = models_node

        updated_at = datetime.now(timezone.utc).isoformat()
        changed = False

        for model_obj in models_list:
            if not isinstance(model_obj, dict):
                continue
            model_name = str(model_obj.get("name") or model_obj.get("model") or model_obj.get("id") or "").strip()
            if not model_name:
                continue
            
            cached_item = models_node.get(model_name.lower())
            has_valid_capabilities = isinstance(cached_item, dict) and isinstance(cached_item.get("capabilities"), list)
            if has_valid_capabilities:
                continue

            try:
                show_res = requests.post(show_url, json={"model": model_name, "verbose": True}, timeout=5)
                if show_res.status_code == 200:
                    show_payload = show_res.json()
                    context_window = self._extract_context_window(show_payload)
                    capabilities = show_payload.get("capabilities", [])
                    if not isinstance(capabilities, list):
                        capabilities = []
                        
                    models_node[model_name.lower()] = {
                        "context_window": int(context_window),
                        "model_name": model_name,
                        "capabilities": capabilities,
                        "updated_at": updated_at,
                    }
                    changed = True
            except Exception:
                continue

        if changed:
            self._write_context_window_cache(cache)
            
        return models_node

    def list_models(
        self,
        *,
        client: Any,
        capability: str = "",
        request_options: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        timeout = 5.0
        req_opts = request_options if isinstance(request_options, dict) else {}
        try:
            timeout = float(req_opts.get("models_catalog_timeout", 5.0) or 5.0)
        except Exception:
            timeout = 5.0
        timeout = max(2.0, min(timeout, 15.0))

        status_maps = self._build_ollama_status_maps(timeout=timeout)
        tags_models = status_maps.get("tags_models", []) if isinstance(status_maps, dict) else []
        if not isinstance(tags_models, list):
            tags_models = []

        show_url = f"{self._ollama_base_url()}/api/show"
        models_node = self._update_context_window_cache(tags_models, show_url)  

        cap = str(capability or "").strip().lower()
        formatted = []
        ordered_names = status_maps.get("ordered_names", []) if isinstance(status_maps, dict) else []
        if not isinstance(ordered_names, list):
            ordered_names = []

        for model_key in ordered_names:
            model_name = str(model_key or "").strip()
            if not model_name:
                continue
            status = self._format_ollama_model_status(model_name, status_maps)  
            if not status.get("installed", False) and not status.get("running", False):
                continue
                
            cached_data = models_node.get(model_name.lower(), {})
            capabilities = cached_data.get("capabilities", [])
            if not isinstance(capabilities, list):
                capabilities = []
                
            has_vision = "vision" in capabilities or "multimodal" in capabilities or any(k in model_name.lower() for k in ("llava", "vision", "vl", "vl-chat", "minivpm"))
            has_tools = "tools" in capabilities or "function" in capabilities
            has_thinking = "thinking" in capabilities
            
            if cap == "vision" and not has_vision:
                continue
            if cap == "function" and not has_tools:
                continue
            if cap == "thinking" and not has_thinking:
                continue
            
            features = ["Chat"]
            if has_tools:
                features.append("Tool")
            if has_vision:
                features.append("Vision")
            if has_thinking:
                features.append("Thinking")

            formatted.append({
                "id": model_name,
                "name": model_name,
                "pricing": "免费",
                "vision": has_vision,
                "function": has_tools,
                "features": features,
                "status_label": status.get("status_label", "不在线"),
                "status_level": status.get("status_level", "warning"),
                "installed": status.get("installed", False),
                "running": status.get("running", False),
                "keep_alive": status.get("keep_alive", self._default_keep_alive()),
                "raw": {
                    "tag": status.get("tag"),
                    "ps": status.get("ps"),
                },
            })

        if formatted:
            return {
                "ok": True,
                "provider": self.provider_name,
                "api_type": self.api_type,
                "source": "ollama_tags_ps_api",
                "count": len(formatted),
                "models": formatted,
                "tags_error": status_maps.get("tags_error", ""),
                "ps_error": status_maps.get("ps_error", ""),
            }

        if status_maps.get("tags_error") or status_maps.get("ps_error"):
            return {
                "ok": False,
                "provider": self.provider_name,
                "api_type": self.api_type,
                "source": "ollama_tags_ps_api",
                "models": [],
                "error": status_maps.get("tags_error") or status_maps.get("ps_error") or "list_models_failed",
            }

        return {
            "ok": True,
            "provider": self.provider_name,
            "api_type": self.api_type,
            "source": "ollama_tags_ps_api",
            "count": 0,
            "models": [],
            "error": "list_models_failed",
        }
