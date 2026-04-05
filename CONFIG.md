# Nexora Configuration

This file describes the configuration layout for `ChatDBServer` and the files it creates on startup.

## Layout

Nexora now keeps runtime files under `ChatDBServer/data/`.

Main files:

- `ChatDBServer/data/config.json`
- `ChatDBServer/data/models.json`
- `ChatDBServer/data/model_adapters.json`
- `ChatDBServer/data/user.json`
- `ChatDBServer/data/model_permissions.json`
- `ChatDBServer/data/temp/ContextTemp.tmp`
- `ChatDBServer/data/res/models_context_window.json`
- `ChatDBServer/data/res/openrouter_models_snapshot.json`
- `ChatDBServer/data/res/openrouter_model_alias_list.json`
- `ChatDBServer/data/res/status_model_rules.json`
- `ChatDBServer/data/res/provider_icon_map.json`

Legacy root files are still migrated once if they exist, but the active paths are the ones above.

## Startup Behavior

`ChatDBServer` creates missing runtime files automatically.

On a clean start, it will create:

- `data/`
- `data/temp/`
- `data/res/`
- `data/user.json`
- `data/config.json`
- `data/models.json`
- `data/model_adapters.json`

If older root files exist, the server moves them into `data/` on boot.

## `config.json`

This is the main Nexora runtime config.

Path:

- `ChatDBServer/data/config.json`

The server uses it for:

- default model selection
- RAG service settings
- mail service settings
- public API key
- context compression
- temp context cache
- general runtime flags

### Top-level keys

#### `public_base_url`

Public base URL for links and external references.

Example:

```json
"public_base_url": "https://chat.example.com"
```

#### `default_model`

Default chat model used when the user does not select one.

#### `conclusion_model`

Model used for summary / conclusion style tasks.

#### `organization_model`

Model used for organization and structuring tasks.

#### `websearch_model`

Model used for web search related tasks.

#### `continuous_summary`

Whether the server should keep summary mode enabled.

#### `log_status`

Controls runtime logging level.

Common values:

- `silent`
- `all`

#### `api`

Public API settings.

Keys:

- `public_api_key`
- `public_api_enabled`

Example:

```json
"api": {
  "public_api_key": "public-1234567890abcdef",
  "public_api_enabled": true
}
```

#### `rag_database`

Vector database settings.

Keys:

- `host`
- `port`
- `api_key`
- `rag_database_enabled`
- `mode`
- `path`
- `collection_prefix`
- `distance`
- `service_url`
- `chunk_size`
- `chunk_overlap`

Typical values:

```json
"rag_database": {
  "mode": "service",
  "service_url": "http://127.0.0.1:8100",
  "api_key": "nexoradb-123456",
  "rag_database_enabled": true
}
```

#### `nexora_mail`

Mail service settings.

Keys:

- `host`
- `port`
- `api_key`
- `nexora_mail_enabled`
- `service_url`
- `timeout`
- `send_timeout`
- `cache_enabled`
- `cache_list_ttl`
- `cache_detail_ttl`
- `cache_max_entries`
- `default_group`

#### `temp_context_cache`

Context cache settings.

Keys:

- `enabled`
- `trigger_chars`
- `expire_seconds`
- `storage`
- `file_path`

Current file path:

- `./data/temp/ContextTemp.tmp`

If an old config still says `./temp/ContextTemp.tmp`, the server rewrites it to the new path on boot.

## `models.json`

Path:

- `ChatDBServer/data/models.json`

This file stores the model catalog used by the UI and backend.

It is auto-created when missing.

Keep it as plain JSON. Do not move it back to the repo root.

## `model_adapters.json`

Path:

- `ChatDBServer/data/model_adapters.json`

This file stores provider adapter settings.

It is also auto-created when missing.

Use it for provider-specific request options, relay order, and native capability wiring.

## `user.json`

Path:

- `ChatDBServer/data/user.json`

This is the user account store.

The server will create an empty file on first boot if it does not exist.

## `model_permissions.json`

Path:

- `ChatDBServer/data/model_permissions.json`

This file controls model access per user.

The server reads it when checking which models a user may use.

## `data/res`

`data/res/` stores generated runtime caches.

These files are safe to regenerate:

- `models_context_window.json`
- `openrouter_models_snapshot.json`
- `openrouter_model_alias_list.json`
- `status_model_rules.json`
- `provider_icon_map.json`

If they are missing, the server will recreate them as needed.

## Writing Rules

Keep the config files simple.

- Use UTF-8
- Use JSON with indentation
- Keep secrets in the file, not in code
- Prefer explicit values over hidden defaults
- Do not write runtime caches back to the repo root

## Minimal `config.json`

If you want a minimal hand-written config, this is enough to start:

```json
{
  "public_base_url": "",
  "default_model": "your-model-id",
  "conclusion_model": "your-summary-model-id",
  "organization_model": "your-organize-model-id",
  "websearch_model": "your-websearch-model-id",
  "continuous_summary": false,
  "log_status": "silent",
  "api": {
    "public_api_key": "public-1234567890abcdef",
    "public_api_enabled": true
  },
  "rag_database": {
    "host": "127.0.0.1",
    "port": 8100,
    "api_key": "nexoradb-123456",
    "rag_database_enabled": false,
    "mode": "service",
    "path": "./data/chroma",
    "collection_prefix": "knowledge",
    "distance": "cosine",
    "service_url": "http://127.0.0.1:8100",
    "chunk_size": 200,
    "chunk_overlap": 40
  },
  "nexora_mail": {
    "host": "127.0.0.1",
    "port": 17171,
    "api_key": "",
    "nexora_mail_enabled": false,
    "service_url": "http://127.0.0.1:17171",
    "timeout": 10,
    "send_timeout": 120,
    "cache_enabled": true,
    "cache_list_ttl": 180,
    "cache_detail_ttl": 3600,
    "cache_max_entries": 800,
    "default_group": "default"
  },
  "temp_context_cache": {
    "enabled": true,
    "trigger_chars": 1000,
    "expire_seconds": 0,
    "storage": "memory",
    "file_path": "./data/temp/ContextTemp.tmp"
  }
}
```

## Notes

- `ChatDBServer` will create missing files automatically.
- If you change a config file while the server is running, some parts are hot-reloaded and some are read on boot.
- Root-level config files are legacy only. New work should use `ChatDBServer/data/`.
