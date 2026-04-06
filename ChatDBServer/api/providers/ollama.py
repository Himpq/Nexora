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

    def _update_context_window_cache(self, models_list: List[Dict[str, Any]], show_url: str) -> None:
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
            try:
                show_res = requests.post(show_url, json={"model": model_name, "verbose": True}, timeout=5)
                if show_res.status_code == 200:
                    show_payload = show_res.json()
                    context_window = self._extract_context_window(show_payload)
                    models_node[model_name.lower()] = {
                        "context_window": int(context_window),
                        "model_name": model_name,
                        "updated_at": updated_at,
                    }
                    changed = True
            except Exception:
                continue

        if changed:
            self._write_context_window_cache(cache)

    def list_models(
        self,
        *,
        client: Any,
        capability: str = "",
        request_options: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        
        url_base = self.provider_config.get('base_url', '')
        if url_base.endswith('/v1'):
            url_base = url_base[:-3]

        # fallback if not defined
        if not url_base:
            url_base = 'http://localhost:11434'

        tags_url = f"{url_base}/api/tags"
        show_url = f"{url_base}/api/show"

        try:
            resp = requests.get(tags_url, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                models_list = data.get("models", [])

                self._update_context_window_cache(models_list, show_url)

                # Return standard list format
                formatted = []
                for model_obj in models_list:
                    model_name = str(model_obj.get("name") or model_obj.get("model") or model_obj.get("id") or "").strip()
                    formatted.append({
                        "id": model_name,
                        "name": model_name,
                        "pricing": "免费",
                        "vision": False,
                        "function": True,
                        "features": ["Chat", "Tool"]
                    })
                return {
                    "ok": True,
                    "provider": self.provider_name,
                    "api_type": self.api_type,
                    "models": formatted
                }
        except Exception as e:
            return {
                "ok": False,
                "error": str(e)
            }
        return {
            "ok": False,
            "provider": self.provider_name,
            "api_type": self.api_type,
            "models": [],
            "error": "list_models_failed"
        }
