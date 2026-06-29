import { ApiClientError, chatApiClient, learningApiClient } from "./apiClient";
import type { LearningChatMessage, LearningChatResponse, LearningRuntimeContext } from "./types";

export type LearningChatRequest = {
  username: string;
  messages: LearningChatMessage[];
  model?: string;
  conversation_id?: string;
  conversation_title?: string;
  system_prompt?: string;
  context_blocks?: Array<{
    type?: string;
    title?: string;
    content?: string;
    [key: string]: unknown;
  }>;
  active_tool_skills?: Array<Record<string, unknown>>;
  cards?: Array<Record<string, unknown>>;
  meta?: Record<string, unknown>;
  api_mode?: "chat" | "responses" | "auto";
  stream?: boolean;
  think?: boolean;
  /** Used when retrying the same user turn through a fallback path. */
  skip_user_message?: boolean;
  temperature?: number;
  max_tokens?: number;
};

export type LearningChatStreamEvent =
  | { type: "content"; delta: string; raw?: unknown }
  | { type: "reasoning"; delta: string; raw?: unknown }
  | { type: "response_id"; responseId: string; raw?: unknown }
  | { type: "done"; content?: string; responseId?: string; raw?: unknown }
  | { type: "error"; message: string; raw?: unknown }
  | { type: "unknown"; eventType?: string; raw?: unknown };

export type LearningChatStreamHandlers = {
  signal?: AbortSignal;
  onEvent?: (event: LearningChatStreamEvent) => void;
};

const LEARNING_CHAT_PATH = "/api/learning/chat";

function buildLearningChatPayload(payload: LearningChatRequest) {
  const contextBlocks = payload.context_blocks || [];
  const extraContext = {
    blocks: contextBlocks,
    active_tool_skills: payload.active_tool_skills || [],
    cards: payload.cards || [],
    meta: payload.meta || {},
  };
  return {
    username: payload.username,
    model: payload.model,
    conversation_id: payload.conversation_id,
    conversation_title: payload.conversation_title,
    system_prompt: payload.system_prompt || "",
    context_blocks: extraContext,
    extra_context: extraContext,
    active_tool_skills: payload.active_tool_skills || [],
    cards: payload.cards || [],
    meta: payload.meta || {},
    metadata: {
      ...(payload.meta || {}),
      source: "chatapp",
      username: payload.username,
      conversation_id: payload.conversation_id,
      conversation_title: payload.conversation_title,
    },
    messages: payload.messages,
    api_mode: payload.api_mode || "chat",
    stream: payload.stream ?? false,
    think: payload.think ?? false,
    skip_user_message: payload.skip_user_message || undefined,
    temperature: payload.temperature,
    max_tokens: payload.max_tokens,
  };
}

export function getLearningRuntimeContext(
  username: string,
  payload?: { lectureId?: string; bookId?: string },
) {
  return learningApiClient.postJson<{ success: boolean; payload: LearningRuntimeContext }>(
    "/api/runtime/context",
    {
      username,
      payload: {
        lecture_id: payload?.lectureId,
        book_id: payload?.bookId,
      },
    },
  );
}

export function sendLearningChat(payload: LearningChatRequest) {
  return chatApiClient.postJson<LearningChatResponse>(
    LEARNING_CHAT_PATH,
    buildLearningChatPayload({ ...payload, stream: false }),
  );
}

function extractChunkText(chunk: Record<string, unknown>) {
  const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
  const first = choices[0];
  if (first && typeof first === "object") {
    const delta = (first as { delta?: unknown }).delta;
    if (delta && typeof delta === "object") {
      const content = (delta as { content?: unknown }).content;
      if (typeof content === "string") {
        return content;
      }
      if (Array.isArray(content)) {
        return content
          .map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object") {
              const contentItem = item as { text?: unknown; content?: unknown };
              return String(contentItem.text ?? contentItem.content ?? "");
            }
            return "";
          })
          .join("");
      }
    }
  }

  const directDelta = chunk.delta;
  if (typeof directDelta === "string") {
    return directDelta;
  }
  return "";
}

function extractOutputText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(extractOutputText).join("");
  }
  if (!value || typeof value !== "object") {
    return "";
  }

  const row = value as Record<string, unknown>;
  const text = row.text ?? row.content ?? row.output_text;
  if (typeof text === "string") {
    return text;
  }
  if (Array.isArray(row.content)) {
    return row.content.map(extractOutputText).join("");
  }
  if (Array.isArray(row.output)) {
    return row.output.map(extractOutputText).join("");
  }
  return "";
}

function mapStreamObject(obj: unknown): LearningChatStreamEvent {
  if (!obj || typeof obj !== "object") {
    return { type: "unknown", raw: obj };
  }
  const row = obj as Record<string, unknown>;
  const type = String(row.type || "").trim();

  if (
    type === "response.output_text.delta" ||
    type === "response.message.delta" ||
    type === "content_delta"
  ) {
    return { type: "content", delta: String(row.delta || ""), raw: obj };
  }
  if (
    type === "reasoning_delta" ||
    type === "response.reasoning.delta" ||
    type.includes("reasoning_text.delta") ||
    type.includes("reasoning_summary_text.delta")
  ) {
    return { type: "reasoning", delta: String(row.delta || ""), raw: obj };
  }
  if (type === "response.output_text.done") {
    return {
      type: "done",
      content: String(row.text || ""),
      responseId: String(row.response_id || ""),
      raw: obj,
    };
  }
  if (type === "response.completed") {
    const response = row.response && typeof row.response === "object"
      ? (row.response as Record<string, unknown>)
      : {};
    return {
      type: "done",
      content: String(response.output_text || ""),
      responseId: String(response.id || row.response_id || ""),
      raw: obj,
    };
  }
  if (type === "response.failed") {
    const response = row.response && typeof row.response === "object"
      ? (row.response as Record<string, unknown>)
      : {};
    const error = response.error && typeof response.error === "object"
      ? (response.error as Record<string, unknown>)
      : {};
    return {
      type: "error",
      message: String(error.message || row.message || "流式请求失败"),
      raw: obj,
    };
  }
  if (type === "response_id") {
    const responseId = String(row.response_id || row.responseId || row.id || "");
    return responseId
      ? { type: "response_id", responseId, raw: obj }
      : { type: "unknown", eventType: type, raw: obj };
  }
  if (type === "response.created") {
    const response = row.response && typeof row.response === "object"
      ? (row.response as Record<string, unknown>)
      : {};
    const responseId = String(response.id || "");
    return responseId
      ? { type: "response_id", responseId, raw: obj }
      : { type: "unknown", eventType: type, raw: obj };
  }

  const text = extractChunkText(row);
  if (text) {
    return { type: "content", delta: text, raw: obj };
  }
  const outputText = extractOutputText(row.output ?? row.item ?? row.message);
  if (outputText) {
    return { type: "content", delta: outputText, raw: obj };
  }
  if (row.error || row.success === false) {
    return {
      type: "error",
      message: String(row.message || row.error || "流式请求失败"),
      raw: obj,
    };
  }
  return { type: "unknown", eventType: type || undefined, raw: obj };
}

function splitSseFrames(buffer: string) {
  const parts = buffer.split(/\r?\n\r?\n/);
  return {
    frames: parts.slice(0, -1),
    rest: parts[parts.length - 1] || "",
  };
}

function parseSseFrame(frame: string) {
  return frame
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
}

async function readStreamText(response: Response, handlers?: LearningChatStreamHandlers) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new Error("当前运行环境不支持 ReadableStream，已回退到非流式问答。");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let responseId = "";
  let streamDone = false;

  async function handleFrame(frame: string) {
    const dataText = parseSseFrame(frame);
    if (!dataText) {
      return;
    }
    if (dataText === "[DONE]") {
      const event: LearningChatStreamEvent = { type: "done", content, responseId };
      handlers?.onEvent?.(event);
      streamDone = true;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(dataText) as unknown;
    } catch {
      return;
    }
    const event = mapStreamObject(parsed);
    if (event.type === "content" || event.type === "reasoning") {
      content += event.delta;
    }
    if (event.type === "response_id") {
      responseId = event.responseId;
    }
    if (event.type === "done") {
      content = event.content || content;
      responseId = event.responseId || responseId;
      streamDone = true;
    }
    handlers?.onEvent?.(event);
  }

  while (!streamDone) {
    if (handlers?.signal?.aborted) {
      await reader.cancel().catch(() => undefined);
      break;
    }
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const split = splitSseFrames(buffer);
    buffer = split.rest;
    for (const frame of split.frames) {
      await handleFrame(frame);
      if (streamDone) {
        break;
      }
    }
  }

  if (!streamDone) {
    buffer += decoder.decode();
    if (buffer.trim()) {
      await handleFrame(buffer);
    }
  }
  return { content, responseId };
}

export async function streamLearningChat(
  payload: LearningChatRequest,
  handlers?: LearningChatStreamHandlers,
) {
  const response = await chatApiClient.postStream(
    LEARNING_CHAT_PATH,
    buildLearningChatPayload({ ...payload, stream: true }),
    {
      signal: handlers?.signal,
    },
  );
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    throw new ApiClientError(
      String(failure?.error || failure?.message || `Request failed with HTTP ${response.status}`),
      response.status,
      failure,
    );
  }
  return readStreamText(response, handlers);
}
