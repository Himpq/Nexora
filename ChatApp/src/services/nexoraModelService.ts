import { chatApiClient } from "./apiClient";
import type { ModelOption } from "./types";

const DEFAULT_CHAT_MODEL = "hunyuan-lite";

export async function listNexoraModels(_username?: string) {
  return {
    success: true,
    data: [
      {
        id: DEFAULT_CHAT_MODEL,
        name: DEFAULT_CHAT_MODEL,
        model: DEFAULT_CHAT_MODEL,
      },
    ] satisfies ModelOption[],
  };
}

export function chatCompletions(payload: {
  model?: string;
  username?: string;
  messages: Array<{ role: string; content: string }>;
  [key: string]: unknown;
}) {
  return chatApiClient.postJson<{
    success: boolean;
    api_mode: "chat";
    endpoint?: string;
    content: string;
    raw: unknown;
  }>("/api/papi/chat/completions", {
    ...payload,
    model: DEFAULT_CHAT_MODEL,
  });
}

export function responses(payload: {
  model?: string;
  username?: string;
  input: unknown[];
  instructions?: string;
  [key: string]: unknown;
}) {
  return chatApiClient.postJson<{
    success: boolean;
    api_mode: "responses";
    endpoint?: string;
    content: string;
    raw: unknown;
  }>("/api/papi/responses", {
    ...payload,
    model: DEFAULT_CHAT_MODEL,
  });
}

export function completions(payload: {
  model_type?: string;
  model?: string;
  username?: string;
  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
  input?: unknown[];
  [key: string]: unknown;
}) {
  return chatApiClient.postJson<{ success: boolean; content?: string; raw?: unknown; [key: string]: unknown }>(
    "/api/papi/completions",
    {
      ...payload,
      model: DEFAULT_CHAT_MODEL,
    },
  );
}
