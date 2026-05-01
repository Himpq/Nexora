import { appEnv } from "../config/env";
import type { ApiErrorPayload } from "./types";

export class ApiClientError extends Error {
  status: number;
  payload: ApiErrorPayload | unknown;

  constructor(message: string, status: number, payload: ApiErrorPayload | unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.payload = payload;
  }
}

type RequestOptions = RequestInit & {
  query?: Record<string, string | number | boolean | undefined | null>;
};

let baseUrl = appEnv.nexoraLearningBaseUrl.replace(/\/+$/, "");
let currentUsername = "";

export function setApiBaseUrl(nextBaseUrl: string) {
  baseUrl = String(nextBaseUrl || "").trim().replace(/\/+$/, "");
}

export function setApiUsername(username: string) {
  currentUsername = String(username || "").trim();
}

function getBasePathPrefix() {
  const withoutOrigin = baseUrl.replace(/^[a-z][a-z\d+\-.]*:\/\/[^/?#]+/i, "");
  const pathOnly = withoutOrigin.split(/[?#]/)[0].replace(/\/+$/, "");
  return pathOnly.startsWith("/") ? pathOnly : "";
}

function buildUrl(path: string, query?: RequestOptions["query"]) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const basePathPrefix = getBasePathPrefix();
  const pathSuffix =
    basePathPrefix &&
    (normalizedPath === basePathPrefix || normalizedPath.startsWith(`${basePathPrefix}/`))
      ? normalizedPath.slice(basePathPrefix.length)
      : normalizedPath;
  const queryString = Object.entries(query || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join("&");

  const joinedPath = pathSuffix
    ? pathSuffix.startsWith("/")
      ? pathSuffix
      : `/${pathSuffix}`
    : "";
  const url = `${baseUrl}${joinedPath}`;
  return queryString ? `${url}?${queryString}` : url;
}

function buildHeaders(headers?: HeadersInit) {
  const merged = new Headers(headers);
  if (currentUsername && !merged.has("X-Nexora-Username")) {
    merged.set("X-Nexora-Username", currentUsername);
  }
  return merged;
}

export async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { query, headers, body, ...rest } = options;
  const response = await fetch(buildUrl(path, query), {
    ...rest,
    body,
    headers: buildHeaders(headers),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || (payload && payload.success === false)) {
    const message =
      String(payload?.error || payload?.message || "").trim() ||
      `Request failed with HTTP ${response.status}`;
    throw new ApiClientError(message, response.status, payload);
  }
  return payload as T;
}

export function getJson<T>(path: string, options?: RequestOptions) {
  return requestJson<T>(path, { ...options, method: "GET" });
}

export function postJson<T>(path: string, payload?: unknown, options?: RequestOptions) {
  return requestJson<T>(path, {
    ...options,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
    body: JSON.stringify(payload || {}),
  });
}

export function patchJson<T>(path: string, payload?: unknown, options?: RequestOptions) {
  return requestJson<T>(path, {
    ...options,
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
    body: JSON.stringify(payload || {}),
  });
}

export function deleteJson<T>(path: string, options?: RequestOptions) {
  return requestJson<T>(path, { ...options, method: "DELETE" });
}

export function getApiState() {
  return {
    baseUrl,
    username: currentUsername,
  };
}
