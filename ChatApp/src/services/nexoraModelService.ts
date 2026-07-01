import { chatApiClient, learningApiClient } from "./apiClient";
import type { ModelOption } from "./types";

type RawModelOption = ModelOption | string;

function normalizeModelOption(raw: RawModelOption): ModelOption | null {
  if (typeof raw === "string") {
    const value = raw.trim();
    return value ? { id: value, name: value, model: value } : null;
  }
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const model = String(raw.model || raw.id || raw.name || "").trim();
  if (!model) {
    return null;
  }

  return {
    ...raw,
    id: String(raw.id || model).trim() || model,
    name: String(raw.name || model).trim() || model,
    model,
  };
}

export async function listNexoraModels(username?: string) {
  const result = await learningApiClient.getJson<{
    success: boolean;
    payload?: {
      data?: RawModelOption[];
      models?: RawModelOption[];
      default_model?: string;
      defaultModel?: string;
    };
    data?: RawModelOption[];
    models?: RawModelOption[];
    default_model?: string;
    defaultModel?: string;
  }>("/api/nexora/models", {
    query: username ? { username } : undefined,
  });
  const payload = result.payload || result;
  const rawModels = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : [];
  const models = rawModels.flatMap((model) => {
    const normalized = normalizeModelOption(model);
    return normalized ? [normalized] : [];
  });
  const defaultModel = String(payload.default_model || payload.defaultModel || "").trim();

  return {
    success: result.success !== false,
    data: models,
    defaultModel,
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
    },
  );
}
