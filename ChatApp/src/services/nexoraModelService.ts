import { getJson, postJson } from "./apiClient";
import type { ModelOption } from "./types";

export function listNexoraModels(username?: string) {
  return getJson<{ success: boolean; payload?: unknown; data?: ModelOption[]; models?: unknown }>(
    "/api/nexora/models",
    { query: username ? { username } : undefined },
  );
}

export function chatCompletions(payload: {
  model?: string;
  username?: string;
  messages: Array<{ role: string; content: string }>;
  [key: string]: unknown;
}) {
  return postJson<{
    success: boolean;
    api_mode: "chat";
    endpoint?: string;
    content: string;
    raw: unknown;
  }>("/api/nexora/papi/chat/completions", payload);
}

export function responses(payload: {
  model?: string;
  username?: string;
  input: unknown[];
  instructions?: string;
  [key: string]: unknown;
}) {
  return postJson<{
    success: boolean;
    api_mode: "responses";
    endpoint?: string;
    content: string;
    raw: unknown;
  }>("/api/nexora/papi/responses", payload);
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
  return postJson<{ success: boolean; content?: string; raw?: unknown; [key: string]: unknown }>(
    "/api/completions",
    payload,
  );
}
