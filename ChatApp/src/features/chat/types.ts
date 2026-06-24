export type ChatRole = "user" | "assistant";

export type ChatMessageStatus = "streaming" | "completed" | "cancelled" | "error";

/**
 * Coarse failure category so the UI can give actionable retry guidance instead
 * of a generic "请求失败". `network` = fetch/transport failure (retry makes
 * sense); `server` = backend-reported error (HTTP non-200 or an in-stream
 * `error` frame — e.g. model rate-limit / context overflow; switching model or
 * shortening input may help); `cancelled` = user-initiated abort.
 */
export type ChatErrorCategory = "network" | "server" | "cancelled";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  reasoning?: string;
  status?: ChatMessageStatus;
  /** Server message index, when loaded from history (used for regenerate). */
  serverIndex?: number;
  /** Populated when `status === "error"` to drive retry guidance. */
  errorCategory?: ChatErrorCategory;
  errorCode?: string | number;
};
