from .openai import OpenAIProvider


class VLLMProvider(OpenAIProvider):
    @property
    def api_type(self) -> str:
        return "vllm"

    def create_client(self, api_key: str, base_url: str, timeout: float = 120.0):
        return super().create_client(
            api_key=str(api_key or "").strip(),
            base_url=self._normalize_vllm_base_url(base_url),
            timeout=timeout,
        )

    def should_disable_function_tools(self, model_name: str = "") -> bool:
        return not self._tool_calling_enabled()

    def _tool_calling_enabled(self) -> bool:
        settings = self.provider_config.get("settings")

        if not isinstance(settings, dict):
            settings = {}

        candidates = (
            self.provider_config.get("tool_calling_enabled"),
            settings.get("tool_calling_enabled"),
            settings.get("enable_auto_tool_choice"),
        )

        for candidate in candidates:
            if isinstance(candidate, bool):
                return candidate

            value = str(candidate or "").strip().lower()

            if value in {"1", "true", "yes", "y", "on", "enabled"}:
                return True

            if value in {"0", "false", "no", "n", "off", "disabled"}:
                return False

        return False

    def _normalize_vllm_base_url(self, base_url: str) -> str:
        normalized = str(base_url or "").strip().rstrip("/")

        if not normalized:
            raise ValueError("vLLM Base URL is required")

        lower_url = normalized.lower()
        endpoint_suffixes = (
            "/chat/completions",
            "/completions",
            "/models",
            "/responses",
        )

        if any(lower_url.endswith(suffix) for suffix in endpoint_suffixes):
            raise ValueError("vLLM Base URL must point to the API root, for example http://host:port/v1")

        if lower_url.endswith("/v1"):
            return normalized

        return f"{normalized}/v1"
