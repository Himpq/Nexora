import test from "node:test";
import assert from "node:assert/strict";

import { setChatApiPublicApiKey } from "../apiClient";
import { chatCompletions, completions, listNexoraModels, responses } from "../nexoraModelService";

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

test("chatCompletions sends the requested backend model", async () => {
  const calls = installFetch({ success: true, content: "ok" });
  setChatApiPublicApiKey("public-test-key");

  await chatCompletions({
    model: "qwen-test",
    username: "learner",
    messages: [{ role: "user", content: "hello" }],
  });

  assert.equal(calls[0].url, "https://chat.himpqblog.cn/api/papi/chat/completions");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    username: "learner",
    messages: [{ role: "user", content: "hello" }],
    model: "qwen-test",
  });
  assert.equal(new Headers(calls[0].init.headers).get("X-API-Key"), "public-test-key");
});

test("PAPI helpers leave model unset when backend should choose the default", async () => {
  const calls = installFetch({ success: true, content: "ok" });

  await chatCompletions({
    username: "learner",
    messages: [{ role: "user", content: "hello" }],
  });
  await responses({
    username: "learner",
    input: [{ role: "user", content: "hello" }],
  });
  await completions({
    username: "learner",
    prompt: "hello",
  });

  assert.equal(Object.hasOwn(JSON.parse(String(calls[0].init.body)), "model"), false);
  assert.equal(Object.hasOwn(JSON.parse(String(calls[1].init.body)), "model"), false);
  assert.equal(Object.hasOwn(JSON.parse(String(calls[2].init.body)), "model"), false);
});

test("listNexoraModels loads backend models and backend default model", async () => {
  const calls = installFetch({
    success: true,
    models: [
      {
        id: "qwen-test",
        name: "Qwen Test",
        provider: "dashscope",
      },
      "doubao-test",
    ],
    default_model: "qwen-test",
  });

  const models = await listNexoraModels("learner");

  assert.deepEqual(models, {
    success: true,
    data: [
      { id: "qwen-test", name: "Qwen Test", provider: "dashscope", model: "qwen-test" },
      { id: "doubao-test", name: "doubao-test", model: "doubao-test" },
    ],
    defaultModel: "qwen-test",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://chat.himpqblog.cn:5002/api/nexora/models?username=learner");

  installFetch({ success: true, payload: { data: [] } });

  assert.deepEqual(await listNexoraModels("learner"), {
    success: true,
    data: [],
    defaultModel: "",
  });
});
