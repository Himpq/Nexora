import { ApiClientError, chatApiClient } from "./apiClient";
import { readSseStream } from "./sse";

/**
 * General-purpose Nexora chat (the web `/chat` backend). Authenticated by the
 * Flask session cookie established at login — NOT the public API key. History,
 * persistence, and conversation management all live server-side; see
 * `conversationService`.
 */

export type ChatStreamRequest = {
  message: string;
  conversationId?: string;
  modelName?: string;
  enableThinking?: boolean;
  enableWebSearch?: boolean;
  enableTools?: boolean;
  isRegenerate?: boolean;
  regenerateIndex?: number;
};

export type ChatStreamEvent =
  | { type: "content"; delta: string; raw?: unknown }
  | { type: "reasoning"; delta: string; raw?: unknown }
  | { type: "conversation_id"; conversationId: string; raw?: unknown }
  | { type: "done"; raw?: unknown }
  | { type: "error"; message: string; raw?: unknown }
  | { type: "unknown"; eventType?: string; raw?: unknown };

export type ChatStreamHandlers = {
  signal?: AbortSignal;
  onEvent?: (event: ChatStreamEvent) => void;
};

const CHAT_STREAM_PATH = "/api/chat/stream";

/**
 * Error thrown by a caller from inside an `onEvent` handler to abort the read
 * loop when the backend streams an `error` frame (e.g. model rate-limit,
 * context overflow). Distinct from {@link ApiClientError} (HTTP-layer failure)
 * and from a plain transport error, so the UI can classify the failure and give
 * actionable retry guidance rather than a generic "请求失败".
 */
export class ChatStreamError extends Error {
  raw?: unknown;
  constructor(message: string, raw?: unknown) {
    super(message);
    this.name = "ChatStreamError";
    this.raw = raw;
  }
}

function buildChatStreamPayload(req: ChatStreamRequest) {
  return {
    message: req.message,
    conversation_id: req.conversationId || undefined,
    model_name: req.modelName || undefined,
    enable_thinking: req.enableThinking ?? false,
    enable_web_search: req.enableWebSearch ?? false,
    enable_tools: req.enableTools ?? false,
    is_regenerate: req.isRegenerate ?? false,
    regenerate_index: req.regenerateIndex,
  };
}

/**
 * Maps a `/api/chat/stream` runtime chunk to a normalized event. Unknown chunk
 * types (model_info, search_meta, context_compression_status, function_call_*,
 * image, …) surface as `unknown` rather than being silently dropped, mirroring
 * the SSE-observability convention used by `learningChatService`.
 */
export function mapChatStreamChunk(obj: unknown): ChatStreamEvent {
  if (!obj || typeof obj !== "object") {
    return { type: "unknown", raw: obj };
  }
  const row = obj as Record<string, unknown>;
  const type = String(row.type || "").trim();

  if (type === "content") {
    return { type: "content", delta: String(row.content || ""), raw: obj };
  }
  if (type === "reasoning_content") {
    return { type: "reasoning", delta: String(row.content || ""), raw: obj };
  }
  if (type === "conversation_id") {
    const conversationId = String(row.conversation_id || "").trim();
    return conversationId
      ? { type: "conversation_id", conversationId, raw: obj }
      : { type: "unknown", eventType: type, raw: obj };
  }
  if (type === "error") {
    return { type: "error", message: String(row.message || row.error || "流式请求失败"), raw: obj };
  }
  if (type === "done" || type === "model_done" || type === "stream_done") {
    return { type: "done", raw: obj };
  }
  return { type: "unknown", eventType: type || undefined, raw: obj };
}

export async function streamChat(req: ChatStreamRequest, handlers?: ChatStreamHandlers) {
  const response = await chatApiClient.postStream(
    CHAT_STREAM_PATH,
    buildChatStreamPayload(req),
    { signal: handlers?.signal },
  );
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as
      | { error?: string; message?: string }
      | null;
    throw new ApiClientError(
      String(failure?.message || failure?.error || `Request failed with HTTP ${response.status}`),
      response.status,
      failure,
    );
  }

  let conversationId = req.conversationId || "";
  let content = "";
  let reasoning = "";

  await readSseStream(response, {
    signal: handlers?.signal,
    onData: (data) => {
      const event = mapChatStreamChunk(data);
      if (event.type === "content") {
        content += event.delta;
      } else if (event.type === "reasoning") {
        reasoning += event.delta;
      } else if (event.type === "conversation_id") {
        conversationId = event.conversationId;
      }
      // Propagate the handler's return (possibly a Promise) so the SSE reader
      // awaits async onEvent handlers frame-by-frame.
      return handlers?.onEvent?.(event);
    },
    onDone: () => {
      handlers?.onEvent?.({ type: "done" });
    },
  });

  return { conversationId, content, reasoning };
}
