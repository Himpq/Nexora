import test from "node:test";
import assert from "node:assert/strict";

import { setChatApiPublicApiKey } from "../apiClient";
import { chatCompletions, listNexoraModels } from "../nexoraModelService";

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

test("chatCompletions defaults to the free hunyuan-lite model", async () => {
  const calls = installFetch({ success: true, content: "ok" });
  setChatApiPublicApiKey("public-test-key");

  await chatCompletions({
    username: "learner",
    messages: [{ role: "user", content: "hello" }],
  });

  assert.equal(calls[0].url, "https://chat.himpqblog.cn/api/papi/chat/completions");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    username: "learner",
    messages: [{ role: "user", content: "hello" }],
    model: "hunyuan-lite",
  });
  assert.equal(new Headers(calls[0].init.headers).get("X-API-Key"), "public-test-key");
});

test("chatCompletions always uses the free hunyuan-lite model", async () => {
  const calls = installFetch({ success: true, content: "ok" });

  await chatCompletions({
    model: "do-not-use-this-model",
    username: "learner",
    messages: [{ role: "user", content: "hello" }],
  });

  assert.equal(JSON.parse(String(calls[0].init.body)).model, "hunyuan-lite");
});

test("listNexoraModels returns only hunyuan-lite without calling the backend", async () => {
  const calls = installFetch({ success: true, data: [] });

  const models = await listNexoraModels("learner");

  assert.deepEqual(models, {
    success: true,
    data: [{ id: "hunyuan-lite", name: "hunyuan-lite", model: "hunyuan-lite" }],
  });
  assert.equal(calls.length, 0);
});
