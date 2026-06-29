import { getJson, patchJson } from "./apiClient";

/** ─────────────────────────────────────────────
 *  Settings: users + models + logs
 *  Backend: /api/frontend/settings/*
 *  Most endpoints require admin role (HTTP 403 otherwise).
 *  ───────────────────────────────────────────── */

export type SettingsUser = {
  user_id?: string;
  username?: string;
  display_name?: string;
  nickname?: string;
  role?: string;
  identity?: "student" | "teacher" | string;
  avatar_url?: string;
  email?: string;
  active?: boolean;
  [key: string]: unknown;
};

export type SettingsUsersResponse = {
  success: boolean;
  query?: string;
  items: SettingsUser[];
  total: number;
  summary?: {
    total?: number;
    admins?: number;
    teachers?: number;
    students?: number;
  };
  [key: string]: unknown;
};

export function listSettingsUsers(query?: { q?: string; limit?: number }) {
  return getJson<SettingsUsersResponse>("/api/frontend/settings/users", {
    query: { q: query?.q, limit: query?.limit },
  });
}

export function updateSettingsUser(
  userId: string,
  payload: { identity: "student" | "teacher" },
) {
  return patchJson<{ success: boolean; user: SettingsUser }>(
    `/api/frontend/settings/users/${encodeURIComponent(userId)}`,
    payload,
  );
}

export type SettingsModelsResponse = {
  success: boolean;
  is_admin?: boolean;
  available_models?: Array<{ id?: string; name?: string; model?: string; [key: string]: unknown }>;
  available_count?: number;
  models_fetch_success?: boolean;
  models_fetch_message?: string;
  settings?: {
    default_nexora_model?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export function getSettingsModels() {
  return getJson<SettingsModelsResponse>("/api/frontend/settings/models");
}

export function patchSettingsModels(payload: {
  default_nexora_model?: string;
  [key: string]: unknown;
}) {
  return patchJson<SettingsModelsResponse>("/api/frontend/settings/models", payload);
}

export function getRoughReadingModelSettings() {
  return getJson<{ success: boolean; settings?: Record<string, unknown>; [key: string]: unknown }>(
    "/api/models/rough-reading",
  );
}

export function patchRoughReadingModelSettings(payload: Record<string, unknown>) {
  return patchJson<{ success: boolean; settings?: Record<string, unknown>; [key: string]: unknown }>(
    "/api/models/rough-reading",
    payload,
  );
}

export function getSettingsLogs(query?: { limit?: number; level?: string }) {
  return getJson<{
    success: boolean;
    items?: Array<Record<string, unknown>>;
    total?: number;
    [key: string]: unknown;
  }>("/api/frontend/settings/logs", {
    query: { limit: query?.limit, level: query?.level },
  });
}
