# Learning Agent session gateway

NexoraApp calls `GET/POST /api/learning/agent/<operation>` with its normal
ChatDB login cookie. The gateway forwards supported operations to the configured
NexoraLearning service at `/api/agent/v1/<operation>`. The response JSON and
business-error status are preserved. Unsupported paths or methods return 404.

Configure the existing **NexoraLearning API Key** in the main-site administrator
settings (`data/config.json` → `nexora_learning.api_key`) to match the learning
service's `runtime_api.api_key`. The gateway also accepts the process environment
variable `NEXORALEARNING_RUNTIME_API_KEY`, which takes precedence over that setting.
An empty key fails with `503 LEARNING_AUTH_NOT_CONFIGURED`; there is no anonymous
fallback. The service URL and timeout use the existing `nexora_learning`
configuration. Generation operations allow at least 90 seconds.

The caller cannot select another learning user: query/body `username` and
`user_id` fields are removed, and the validated main-site session supplies the
upstream username. Caller cookies, authorization, identity headers, and host
headers are not forwarded. Upstream redirects are not followed, preventing the
runtime key from being sent to another host. The shared key must never be shipped
in the mobile application.

The route allowlist covers the current Agent timeline, context, planning,
questions, decisions, reading/review flows, tasks, memories, cognition, and device
context. It deliberately does not expose arbitrary toolbox or administration
endpoints. Add a route only with its corresponding user-scoped contract.

## Deployment configuration

Deploy the updated ChatDBServer, NexoraLearning and NexoraApp together. Configure
the main site's existing `nexora_learning` section with `enabled`, the Learning
service address (`host`/`port` and `frontend_url`), `api_key` and
`request_timeout`. Configure Learning's `runtime_api.enabled` and
`runtime_api.api_key` with the same runtime key. This key authenticates the
main-site-to-Learning hop; it is separate from model and tool service keys.

Learning supports the following environment overrides. Values belong in the
server process configuration, not the App or committed example files.

| Capability | Environment variables | Learning config fields / behavior |
| --- | --- | --- |
| Agent authentication | `NEXORALEARNING_RUNTIME_API_KEY` | `runtime_api.api_key`; the gateway accepts the same variable in its own process. |
| Model proxy | `NEXORALEARNING_NEXORA_BASE_URL`, `NEXORALEARNING_NEXORA_API_KEY`, optional `NEXORALEARNING_NEXORA_TARGET_USERNAME` | `nexora.base_url/api_key/target_username`; configure an available model with `models.default_nexora_model` or the intensive-reading model settings. |
| Knowledge base | `NEXORALEARNING_NEXORADB_SERVICE_URL`, `NEXORALEARNING_NEXORADB_API_KEY` | `nexoradb.service_url/api_key`; actual `/query_text` and `/upsert_texts` calls use the current Learning user and `default` library. |
| Search | `NEXORALEARNING_NEXORASEARCH_SERVICE_URL`, `NEXORALEARNING_NEXORASEARCH_API_KEY` | `nexorasearch.service_url/api_key`; requests `/api/search/ddg` with Bearer authentication when a key is configured. |
| Mail | `NEXORALEARNING_NEXORAMAIL_SERVICE_URL`, `NEXORALEARNING_NEXORAMAIL_API_KEY`, optional `NEXORALEARNING_MAIL_GROUP` | `nexora_mail.service_url/api_key`, `toolbox.mail_group`; mailbox identity is the current user in the configured group. |
| Learning listener / public links | `NEXORALEARNING_PORT`, `NEXORALEARNING_PUBLIC_BASE_URL` | `port`, `public_base_url`; the public address must be reachable by the App for content and reader routes. |

The Agent proxy does not migrate the existing `/api/frontend/` content/reading
routes or telemetry routes. Those continue to use the Learning address configured
for the App. Course videos read the selected course's existing local cache;
there is no new video search service call.

The conversation exposes a fixed tool set through `ask-in-context`; it does not
need direct App access to `/toolbox/*`. KB writes require an explicit positive
save request. Mail orchestration processes the actual mail body and creates only
the requested work; mail attachments and mail sending are not implemented.

An HTTP 200 Agent envelope can contain `data.tool_execution.ok=false`. Consumers
must show that failure rather than claiming the tool completed. Missing model
service configuration yields a structured model error for ordinary questions;
the existing `general_knowledge_fallback` is not evidence of a successful model
request.

For `plan` and `ask-in-context`, send a stable `client_message_id` when retrying
the same request. Successful replies and successful mutation stages are stored
under the user; a changed payload with the same ID returns 409. A failed read may
retry while completed plan/review/KB stages are reused. Requests without that ID
do not receive this durable deduplication behavior.

Persist Learning's configured data directory across restarts. Current review and
flow workers use a single service process with background threads. Pending tasks
without a live worker become `failed/retryable` after a restart, and a flow may
retry `reading_done`. Multi-worker deployment needs shared task ownership or a
queue before relying on this recovery mechanism.

## Verification

Run the session/transport tests with:

```text
cd ChatDBServer
python -m unittest tests.test_smoke_routes tests.test_learning_agent_proxy -v
```

Those tests use a local HTTP peer to verify transport and identity boundaries;
they do not claim to validate model generation or live service availability.

From `NexoraLearning`, the backend regression commands are:

```text
python -m unittest discover -s tests -p "test_agent*.py" -q
python -m unittest discover -s tests -p "test_toolbox*.py" -v
python -m unittest discover -s tests -p "test_main_config.py" -q
```

On 2026-09-28, the gateway/smoke suite passed 13 tests; Learning passed 68 Agent,
11 toolbox and 2 configuration tests. The toolbox contracts exercise the sibling
services' route functions with network, storage or embedding substitutes, so
these counts are not live service or model acceptance results.

An isolated copy of both complete services also passed real HTTP login,
context/today/events/memories, a 20-minute plan, identical-ID replay and replay
after restarting Learning without additional timeline entries. The isolated
account used explicitly labeled demo material. An unconfigured search returned
`tool_execution.ok=false`, and an ordinary model question returned
`503 MODEL_UNAVAILABLE`.

Real cloud model, live search/KB/mail, and App emulator/device acceptance remain
**pending**. A combined command involving existing model credential loading and
service startup was rejected by the automatic execution policy without a more
specific substep reason; the rejected action was not retried through another
method. No production credentials or real users' mail/KB/notes were used in the
isolated service checks. See the [App integration record](../../NexoraApp/docs/learning-migration.md)
for build results and pending system UI checks.
