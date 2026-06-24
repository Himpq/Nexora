import { appEnv } from "../config/env";
import type { ApiErrorPayload, ApiSuccess } from "./types";

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

type ApiClientState = {
  baseUrl: string;
  username: string;
  publicApiKey: string;
};

export type ApiClient = {
  request(path: string, options?: RequestOptions): Promise<Response>;
  requestJson<T>(path: string, options?: RequestOptions): Promise<T>;
  getJson<T>(path: string, options?: RequestOptions): Promise<T>;
  postJson<T>(path: string, payload?: unknown, options?: RequestOptions): Promise<T>;
  postStream(path: string, payload?: unknown, options?: RequestOptions): Promise<Response>;
  patchJson<T>(path: string, payload?: unknown, options?: RequestOptions): Promise<T>;
  deleteJson<T>(path: string, options?: RequestOptions): Promise<T>;
  setBaseUrl(nextBaseUrl: string): void;
  setUsername(username: string): void;
  setPublicApiKey(publicApiKey: string): void;
  getState(): ApiClientState;
};

function normalizeBaseUrl(nextBaseUrl: string) {
  return String(nextBaseUrl || "").trim().replace(/\/+$/, "");
}

export function createApiClient(
  initialBaseUrl: string,
  options: { credentials?: RequestCredentials } = {},
): ApiClient {
  let baseUrl = normalizeBaseUrl(initialBaseUrl);
  let currentUsername = "";
  let currentPublicApiKey = "";
  const defaultCredentials = options.credentials;

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
    if (currentPublicApiKey && !merged.has("X-API-Key")) {
      merged.set("X-API-Key", currentPublicApiKey);
    }
    return merged;
  }

  const request = async (path: string, options: RequestOptions = {}): Promise<Response> => {
    const { query, headers, body, credentials, ...rest } = options;
    return fetch(buildUrl(path, query), {
      ...rest,
      body,
      headers: buildHeaders(headers),
      // Session-aware clients (chat) opt into cookie credentials so the Flask
      // session set by /login is stored and replayed on later requests.
      credentials: credentials ?? defaultCredentials,
    });
  };

  const requestJson = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
    const response = await request(path, options);
    const payload = (await response.json().catch(() => null)) as
      | ApiSuccess
      | ApiErrorPayload
      | null;
    if (!response.ok || (payload && payload.success === false)) {
      const message =
        String(payload?.error || payload?.message || "").trim() ||
        `Request failed with HTTP ${response.status}`;
      throw new ApiClientError(message, response.status, payload);
    }
    return payload as T;
  };

  const getJson = <T>(path: string, options?: RequestOptions) =>
    requestJson<T>(path, { ...options, method: "GET" });

  const postJson = <T>(path: string, payload?: unknown, options?: RequestOptions) =>
    requestJson<T>(path, {
      ...options,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      },
      body: JSON.stringify(payload ?? {}),
    });

  const postStream = (path: string, payload?: unknown, options?: RequestOptions) =>
    request(path, {
      ...options,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(options?.headers || {}),
      },
      body: JSON.stringify(payload ?? {}),
    });

  const patchJson = <T>(path: string, payload?: unknown, options?: RequestOptions) =>
    requestJson<T>(path, {
      ...options,
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      },
      body: JSON.stringify(payload ?? {}),
    });

  const deleteJson = <T>(path: string, options?: RequestOptions) =>
    requestJson<T>(path, { ...options, method: "DELETE" });

  return {
    request,
    requestJson,
    getJson,
    postJson,
    postStream,
    patchJson,
    deleteJson,
    setBaseUrl(nextBaseUrl: string) {
      baseUrl = normalizeBaseUrl(nextBaseUrl);
    },
    setUsername(username: string) {
      currentUsername = String(username || "").trim();
    },
    setPublicApiKey(publicApiKey: string) {
      currentPublicApiKey = String(publicApiKey || "").trim();
    },
    getState() {
      return {
        baseUrl,
        username: currentUsername,
        publicApiKey: currentPublicApiKey,
      };
    },
  };
}

export const learningApiClient = createApiClient(appEnv.nexoraLearningBaseUrl);
// The chat backend authenticates the rich endpoints (/api/chat/stream,
// /api/conversations/*) with a Flask session cookie from /login, so this client
// must send/store cookies. Native fetch persists cookies automatically; this
// makes it explicit and also covers react-native-web.
export const chatApiClient = createApiClient(appEnv.chatDBServerBaseUrl, {
  credentials: "include",
});
chatApiClient.setPublicApiKey(appEnv.chatDBServerPublicApiKey);
learningApiClient.setPublicApiKey(appEnv.nexoraLearningRuntimeApiKey);

export const requestJson = learningApiClient.requestJson;
export const getJson = learningApiClient.getJson;
export const postJson = learningApiClient.postJson;
export const postStream = learningApiClient.postStream;
export const patchJson = learningApiClient.patchJson;
export const deleteJson = learningApiClient.deleteJson;

export function setApiBaseUrl(nextBaseUrl: string) {
  learningApiClient.setBaseUrl(nextBaseUrl);
}

export function setChatApiBaseUrl(nextBaseUrl: string) {
  chatApiClient.setBaseUrl(nextBaseUrl);
}

export function setApiUsername(username: string) {
  learningApiClient.setUsername(username);
  chatApiClient.setUsername(username);
}

export function setChatApiPublicApiKey(publicApiKey: string) {
  chatApiClient.setPublicApiKey(publicApiKey);
}

export function getApiState() {
  return {
    learning: learningApiClient.getState(),
    chat: chatApiClient.getState(),
  };
}
