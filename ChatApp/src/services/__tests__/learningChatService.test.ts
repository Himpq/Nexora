import test from "node:test";
import assert from "node:assert/strict";

import { chatApiClient } from "../apiClient";
import {
  sendLearningChat,
  streamLearningChat,
  type LearningChatStreamEvent,
} from "../learningChatService";

function streamResponse(chunks: string[]) {
  let readCount = 0;
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            readCount += 1;
            const chunk = chunks.shift();
            if (chunk === undefined) {
              return { value: undefined, done: true };
            }
            return { value: encoder.encode(chunk), done: false };
          },
          async cancel() {
            chunks.length = 0;
          },
        };
      },
    },
    getReadCount() {
      return readCount;
    },
  } as Response & { getReadCount(): number };
}

test("streamLearningChat reads SSE deltas and stops on DONE", async () => {
  chatApiClient.setBaseUrl("http://chat.local");
  const response = streamResponse([
    'data: {"type":"response.created","response":{"id":"resp_1"}}\n\n',
    'data: {"type":"response.output_text.delta","delta":"Hel',
    'lo"}\n\ndata: [DONE]\n\n',
    'data: {"type":"response.output_text.delta","delta":"ignored"}\n\n',
  ]);
  globalThis.fetch = (async () => response) as typeof fetch;

  const events: LearningChatStreamEvent[] = [];
  const result = await streamLearningChat(
    {
      username: "ada",
      messages: [{ role: "user", content: "Hi" }],
    },
    {
      onEvent: (event) => events.push(event),
    },
  );

  assert.equal(result.content, "Hello");
  assert.equal(result.responseId, "resp_1");
  assert.equal(response.getReadCount(), 3);
  assert.deepEqual(
    events.map((event) => event.type),
    ["response_id", "content", "done"],
  );
});

test("streamLearningChat reports unknown SSE frames instead of dropping them", async () => {
  chatApiClient.setBaseUrl("http://chat.local");
  const response = streamResponse([
    'data: {"type":"response.output_item.added","item":{"type":"function_call","name":"search"}}\n\n',
    'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
    'data: [DONE]\n\n',
  ]);
  globalThis.fetch = (async () => response) as typeof fetch;

  const events: LearningChatStreamEvent[] = [];
  const result = await streamLearningChat(
    {
      username: "ada",
      messages: [{ role: "user", content: "Hi" }],
    },
    {
      onEvent: (event) => events.push(event),
    },
  );

  assert.equal(result.content, "ok");
  assert.equal(events[0].type, "unknown");
  assert.equal(events[0].type === "unknown" ? events[0].eventType : "", "response.output_item.added");
  assert.deepEqual(
    events.map((event) => event.type),
    ["unknown", "content", "done"],
  );
});

test("streamLearningChat maps provider reasoning and done variants", async () => {
  chatApiClient.setBaseUrl("http://chat.local");
  const response = streamResponse([
    'data: {"type":"response.reasoning.delta","delta":"thinking"}\n\n',
    'data: {"type":"response.message.delta","delta":" answer"}\n\n',
    'data: {"type":"response.output_text.done","text":"final","response_id":"resp_2"}\n\n',
  ]);
  globalThis.fetch = (async () => response) as typeof fetch;

  const events: LearningChatStreamEvent[] = [];
  const result = await streamLearningChat(
    {
      username: "ada",
      messages: [{ role: "user", content: "Hi" }],
    },
    {
      onEvent: (event) => events.push(event),
    },
  );

  assert.equal(result.content, "final");
  assert.equal(result.responseId, "resp_2");
  assert.deepEqual(
    events.map((event) => event.type),
    ["reasoning", "content", "done"],
  );
});

test("streamLearningChat ignores non-JSON data frames", async () => {
  chatApiClient.setBaseUrl("http://chat.local");
  const response = streamResponse([
    "data: keepalive\n\n",
    'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
    "data: [DONE]\n\n",
  ]);
  globalThis.fetch = (async () => response) as typeof fetch;

  const events: LearningChatStreamEvent[] = [];
  const result = await streamLearningChat(
    {
      username: "ada",
      messages: [{ role: "user", content: "Hi" }],
    },
    {
      onEvent: (event) => events.push(event),
    },
  );

  assert.equal(result.content, "ok");
  assert.deepEqual(
    events.map((event) => event.type),
    ["content", "done"],
  );
});

test("sendLearningChat can skip persisting an already-recorded user message", async () => {
  chatApiClient.setBaseUrl("http://chat.local");
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, content: "ok" }),
    } as Response;
  }) as typeof fetch;

  await sendLearningChat({
    username: "ada",
    messages: [{ role: "user", content: "Hi" }],
    conversation_id: "reader:c1",
    skip_user_message: true,
  });

  assert.equal(calls[0].url, "http://chat.local/api/learning/chat");
  const body = JSON.parse(String(calls[0].init.body || "{}"));
  assert.equal(body.stream, false);
  assert.equal(body.skip_user_message, true);
});
