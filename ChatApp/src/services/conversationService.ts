import { chatApiClient } from "./apiClient";

/**
 * Server-side conversation history on the chat backend. Session-cookie auth
 * (login required). Endpoints: /api/conversations[/<id>][/title|/pin].
 */

export type ConversationSummary = {
  conversation_id: string;
  title?: string;
  pin?: boolean;
  created_at?: string;
  updated_at?: string;
  conversation_mode?: string;
  [key: string]: unknown;
};

export type ConversationMessage = {
  role: "user" | "assistant" | "system" | string;
  content?: string;
  reasoning_content?: string;
  model_name?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ConversationDetail = {
  conversation_id: string;
  title?: string;
  pin?: boolean;
  messages?: ConversationMessage[];
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export async function listConversations(options?: { signal?: AbortSignal }) {
  const result = await chatApiClient.getJson<{
    success: boolean;
    conversations?: ConversationSummary[];
  }>("/api/conversations", options);
  return Array.isArray(result.conversations) ? result.conversations : [];
}

export async function getConversation(conversationId: string, options?: { signal?: AbortSignal }) {
  const result = await chatApiClient.getJson<{
    success: boolean;
    conversation?: ConversationDetail;
  }>(`/api/conversations/${encodeURIComponent(conversationId)}`, options);
  return result.conversation || null;
}

export function createConversation(title?: string) {
  return chatApiClient.postJson<{
    success: boolean;
    conversation_id: string;
    title?: string;
    existed?: boolean;
  }>("/api/conversations", {
    title: String(title || "").trim() || "新对话",
  });
}

export function deleteConversation(conversationId: string) {
  return chatApiClient.deleteJson<{ success: boolean }>(
    `/api/conversations/${encodeURIComponent(conversationId)}`,
  );
}

export function renameConversation(conversationId: string, title: string) {
  return chatApiClient.requestJson<{ success: boolean; title?: string }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/title`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: String(title || "").trim() }),
    },
  );
}

export function pinConversation(conversationId: string, pin: boolean) {
  return chatApiClient.postJson<{ success: boolean; pin?: boolean }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/pin`,
    { pin },
  );
}
