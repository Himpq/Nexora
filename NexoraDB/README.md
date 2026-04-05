# NexoraDB (Standalone Vector Service)

This is a standalone service that manages ChromaDB collections and exposes a small HTTP API.
It does not depend on Nexora code or filesystem.

## Quick Start
```bash
pip install -r requirements.txt
python app.py
```

## Defaults
- Host: `0.0.0.0`
- Port: `8100`
- Data path: `./chroma_data`
- API Key: `nexoradb-123456`

Configure in `config.json`.

## API
- `GET /health`
- `POST /upsert` `{ username, title, text, embedding, metadata }`
- `POST /query` `{ username, embedding, top_k }`
- `POST /delete` `{ username, title | vector_id }`

All endpoints require `X-API-Key` header unless `api_key` is empty in config.

## Nexora config (client side)
Set these in `ChatDBServer/data/config.json`:
```json
"rag_database": {
  "mode": "service",
  "service_url": "http://127.0.0.1:8100",
  "api_key": "nexoradb-123456",
  "rag_database_enabled": true,
  "host": "127.0.0.1",
  "port": 8100
}
```
