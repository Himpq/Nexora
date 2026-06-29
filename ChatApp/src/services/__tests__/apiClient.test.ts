import test from "node:test";
import assert from "node:assert/strict";

import { ApiClientError, createApiClient } from "../apiClient";

type FetchCall = {
  url: string;
  init: RequestInit;
};

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

function installFetch(payload: unknown, status = 200) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return jsonResponse(payload, status);
  }) as typeof fetch;
  return calls;
}

test("createApiClient builds URLs without duplicating a base path", async () => {
  const calls = installFetch({ success: true });
  const client = createApiClient("http://127.0.0.1:5001/api/");

  await client.getJson("/api/frontend/context", {
    query: {
      username: "Ada Lovelace",
      empty: "",
      missing: undefined,
      enabled: true,
    },
  });

  assert.equal(
    calls[0].url,
    "http://127.0.0.1:5001/api/frontend/context?username=Ada%20Lovelace&enabled=true",
  );
});

test("createApiClient injects the current username header without overriding callers", async () => {
  const calls = installFetch({ success: true });
  const client = createApiClient("http://127.0.0.1:5001");
  client.setUsername("learner");

  await client.postJson("/api/frontend/learning-feeds", { content: "hello" });
  await client.getJson("/api/frontend/context", {
    headers: {
      "X-Nexora-Username": "override",
    },
  });

  assert.equal(new Headers(calls[0].init.headers).get("X-Nexora-Username"), "learner");
  assert.equal(new Headers(calls[0].init.headers).get("Content-Type"), "application/json");
  assert.equal(calls[0].init.body, JSON.stringify({ content: "hello" }));
  assert.equal(new Headers(calls[1].init.headers).get("X-Nexora-Username"), "override");
});

test("createApiClient injects public API keys without overriding callers", async () => {
  const calls = installFetch({ success: true });
  const client = createApiClient("https://chat.himpqblog.cn");
  client.setPublicApiKey("public-test-key");

  await client.postJson("/api/papi/chat/completions", { messages: [] });
  await client.getJson("/api/papi/models", {
    headers: {
      "X-API-Key": "override-key",
    },
  });

  assert.equal(calls[0].url, "https://chat.himpqblog.cn/api/papi/chat/completions");
  assert.equal(new Headers(calls[0].init.headers).get("X-API-Key"), "public-test-key");
  assert.equal(new Headers(calls[1].init.headers).get("X-API-Key"), "override-key");
});

test("createApiClient raises ApiClientError for HTTP and success=false payloads", async () => {
  installFetch({ success: false, error: "bad request" }, 200);
  const client = createApiClient("http://127.0.0.1:5001");

  await assert.rejects(
    () => client.getJson("/api/frontend/context"),
    (err) =>
      err instanceof ApiClientError &&
      err.status === 200 &&
      err.message === "bad request",
  );

  installFetch({ message: "not found" }, 404);

  await assert.rejects(
    () => client.getJson("/api/frontend/missing"),
    (err) =>
      err instanceof ApiClientError &&
      err.status === 404 &&
      err.message === "not found",
  );
});
