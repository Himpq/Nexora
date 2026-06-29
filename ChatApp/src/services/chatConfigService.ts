import { chatApiClient } from "./apiClient";

/**
 * Model list + defaults for the general chat, from the chat backend's
 * session-authenticated `/api/config` (same source the web `/chat` uses).
 */

export type ChatModel = {
  id: string;
  name?: string;
  provider?: string;
  capabilities?: string[];
  [key: string]: unknown;
};

export async function getChatConfig() {
  const result = await chatApiClient.getJson<{
    success?: boolean;
    models?: Array<ChatModel | string>;
    default_model?: string;
  }>("/api/config");

  const models: ChatModel[] = [];
  for (const model of Array.isArray(result.models) ? result.models : []) {
    if (typeof model === "string") {
      const id = model.trim();
      if (id) {
        models.push({ id, name: id });
      }
      continue;
    }
    const id = String(model?.id || model?.name || "").trim();
    if (id) {
      models.push({ ...model, id, name: String(model?.name || id) });
    }
  }

  const defaultModel = String(result.default_model || "").trim();
  return { models, defaultModel };
}
