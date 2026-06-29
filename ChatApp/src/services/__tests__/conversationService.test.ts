import test from "node:test";
import assert from "node:assert/strict";

import {
  createConversation,
  deleteConversation,
  listConversations,
  pinConversation,
  renameConversation,
} from "../conversationService";

type FetchCall = { url: string; init: RequestInit };

function installFetch(payload: unknown, status = 200) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return { ok: status >= 200 && status < 300, status, json: async () => payload } as Response;
  }) as typeof fetch;
  return calls;
}

test("listConversations GETs the conversations endpoint", async () => {
  const calls = installFetch({ success: true, conversations: [{ conversation_id: "1", title: "a" }] });
  const result = await listConversations();
  assert.equal(calls[0].url, "https://chat.himpqblog.cn/api/conversations");
  assert.equal(result[0].conversation_id, "1");
});

test("createConversation posts a title", async () => {
  const calls = installFetch({ success: true, conversation_id: "9", title: "hi" });
  await createConversation("hi");
  assert.equal(calls[0].url, "https://chat.himpqblog.cn/api/conversations");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { title: "hi" });
});

test("renameConversation PUTs the title endpoint", async () => {
  const calls = installFetch({ success: true });
  await renameConversation("9", "new title");
  assert.equal(calls[0].url, "https://chat.himpqblog.cn/api/conversations/9/title");
  assert.equal(calls[0].init.method, "PUT");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { title: "new title" });
});

test("pinConversation posts the pin flag", async () => {
  const calls = installFetch({ success: true });
  await pinConversation("9", true);
  assert.equal(calls[0].url, "https://chat.himpqblog.cn/api/conversations/9/pin");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { pin: true });
});

test("deleteConversation DELETEs the conversation", async () => {
  const calls = installFetch({ success: true });
  await deleteConversation("9");
  assert.equal(calls[0].url, "https://chat.himpqblog.cn/api/conversations/9");
  assert.equal(calls[0].init.method, "DELETE");
});
