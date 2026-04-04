# Nexora Provider Interface

Provider vendor implementations live in `api/providers/` and should contain only vendor-specific adapters.

Core interface/factory live at:

- `api/provider_base.py`
- `api/provider_factory.py`

## Required contract

Each provider adapter must implement `ProviderInterface`:

- `api_type: str`
- `create_client(api_key, base_url, timeout=120.0)`
- `create_embedding_client(api_key, base_url, timeout=120.0)` (default=use chat client)
- `create_chat_completion(client, model, messages, stream=False, **kwargs)`
- `upload_file(client, file_obj, purpose='user_data')`
- `use_responses_api(request_options: dict) -> bool`
- `create_stream_iterator(client, request_params, use_responses_api) -> iterator`
- `iter_stream_events(chunks, use_responses_api, native_web_search_enabled) -> unified events`
- `apply_protocol_payload(params, use_responses_api, messages, previous_response_id, current_function_outputs)`
- `apply_request_options(...) -> dict` (provider-specific request parameter enrichment)
- `relay_web_search(...) -> dict` (provider-specific local relay search implementation)
- `fetch_native_search_metadata(...) -> dict` (optional, for provider-native search sources/citations observability)
- `client_cache_key(api_key, scope='primary') -> str` (inherited default is acceptable)
- `supports_response_resume(...) / get_resume_response_id(...) / save_resume_response_id(...)`
- `build_assistant_tool_call_message(...) / build_function_output_message(...)`
- `detect_round_search_enabled(...)`

Unified stream events consumed by `Model`:

- `response_id`
- `content_delta`
- `reasoning_delta`
- `function_call_delta`
- `function_call`
- `web_search`
- `usage`

## Current adapters

- `providers/volcengine.py`: Ark runtime adapter (`api_type=volcengine`)
- `providers/dashscope.py`: DashScope compatible-mode adapter (`api_type=dashscope`)
- `providers/openai.py`: Generic OpenAI adapter (`api_type=openai`)

## Factory routing

`provider_factory.py` resolves adapter by:

1. `providers.<name>.api_type` in `models.json`
2. fallback inference:
   - `volcengine` -> `volcengine`
   - `aliyun` -> `dashscope`
   - others -> `openai`

## Migration guideline

When adding a new vendor:

1. Add `providers/<vendor>.py` implementing `ProviderInterface`.
2. Register in `provider_factory.py`.
3. Add `api_type` in `models.json.providers.<vendor>`.
4. Keep `Model` layer vendor-agnostic; do not add hardcoded `if provider == ...` branches unless strictly needed.
