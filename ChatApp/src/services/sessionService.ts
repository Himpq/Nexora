import { chatApiClient } from "./apiClient";

export type LoginResult = {
  success: boolean;
  role?: string;
  message?: string;
  [key: string]: unknown;
};

/**
 * Establishes a Flask session on the chat backend (ChatDBServer). On success the
 * server sets a permanent session cookie which `chatApiClient` (credentials:
 * "include") replays on the session-only endpoints (/api/chat/stream,
 * /api/conversations/*). A bad credential responds `{success:false}` which the
 * API client surfaces as a thrown `ApiClientError`.
 */
export function login(username: string, password: string) {
  return chatApiClient.postJson<LoginResult>("/login", {
    username: String(username || "").trim(),
    password,
  });
}

/** Clears the server-side session. Best-effort: never throws. */
export async function logout() {
  try {
    await chatApiClient.postJson<{ success?: boolean }>("/logout");
  } catch {
    // Logging out is best-effort; ignore network/auth failures.
  }
}
