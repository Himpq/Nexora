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
        # Generic OpenAI-compatible provider defaults to chat.completions stream.
        if use_responses_api:
            return client.responses.create(**request_params)
        return client.chat.completions.create(**request_params)

    def iter_stream_events(self, chunks, *, use_responses_api: bool, native_web_search_enabled: bool = False):
        if use_responses_api:
            raise ValueError("OpenAIProvider 默认不支持 responses 流解析")
        yield from self._iter_openai_chat_stream_events(chunks)

    def should_disable_function_tools(self, model_name: str = "") -> bool:
        low = str(model_name or "").lower()
        # GitHub / suanli 上的部分推理模型工具调用会直接 400，统一在 provider 层屏蔽。
        risky_provider = self.provider_name in {"github", "suanli"}
        risky_model = any(x in low for x in ["-reasoning", "deepseek-r1", "qwq-32b"])
        return bool(risky_provider and risky_model)
