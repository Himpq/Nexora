import test from "node:test";
import assert from "node:assert/strict";

import { ApiClientError } from "../apiClient";
import { ChatStreamError, mapChatStreamChunk, streamChat, type ChatStreamEvent } from "../chatService";

function streamResponse(chunks: string[]) {
  let index = 0;
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read: async () => {
            if (index < chunks.length) {
              return { value: encoder.encode(chunks[index++]), done: false };
            }
            return { value: undefined, done: true };
          },
          cancel: async () => undefined,
        };
      },
    },
  } as unknown as Response;
}

function installStreamFetch(response: Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return response;
  }) as typeof fetch;
  return calls;
}

test("mapChatStreamChunk normalizes runtime chunk types", () => {
  assert.deepEqual(mapChatStreamChunk({ type: "content", content: "hi" }), {
    type: "content",
    delta: "hi",
    raw: { type: "content", content: "hi" },
  });
  assert.equal(mapChatStreamChunk({ type: "reasoning_content", content: "r" }).type, "reasoning");
  const cid = mapChatStreamChunk({ type: "conversation_id", conversation_id: "42" });
  assert.equal(cid.type, "conversation_id");
  assert.equal(cid.type === "conversation_id" ? cid.conversationId : "", "42");
  assert.equal(mapChatStreamChunk({ type: "error", message: "boom" }).type, "error");
  assert.equal(mapChatStreamChunk({ type: "done" }).type, "done");
});

test("mapChatStreamChunk surfaces unknown frames instead of dropping them", () => {
  const event = mapChatStreamChunk({ type: "model_info", model: "x" });
  assert.equal(event.type, "unknown");
  assert.equal(event.type === "unknown" ? event.eventType : "", "model_info");
});

test("streamChat accumulates content + reasoning, captures conversation id, observes unknown", async () => {
  const frames = [
    'data: {"type":"conversation_id","conversation_id":"207"}\n\n',
    'data: {"type":"reasoning_content","content":"think"}\n\n',
    'data: {"type":"content","content":"Hel"}\n\n',
    'data: {"type":"content","content":"lo"}\n\n',
    'data: {"type":"model_info","model":"x"}\n\n',
    "data: [DONE]\n\n",
  ];
  installStreamFetch(streamResponse(frames));

  const events: ChatStreamEvent[] = [];
  const result = await streamChat({ message: "hi" }, { onEvent: (e) => events.push(e) });

  assert.equal(result.content, "Hello");
  assert.equal(result.reasoning, "think");
  assert.equal(result.conversationId, "207");
  assert.ok(events.some((e) => e.type === "unknown"));
  assert.ok(events.some((e) => e.type === "done"));
});

test("streamChat throws ApiClientError on HTTP non-200", async () => {
  globalThis.fetch = (async () =>
    ({
      ok: false,
      status: 429,
      json: async () => ({ error: "rate limited" }),
    }) as unknown as Response) as typeof fetch;

  await assert.rejects(
    () => streamChat({ message: "hi" }),
    (err: unknown) => {
      assert.ok(err instanceof ApiClientError, "should be ApiClientError");
      assert.equal((err as ApiClientError).status, 429);
      return true;
    },
  );
});

test("streamChat propagates an error thrown from onEvent (in-stream error frame)", async () => {
  const frames = [
    'data: {"type":"content","content":"partial"}\n\n',
    'data: {"type":"error","message":"model overloaded"}\n\n',
    "data: [DONE]\n\n",
  ];
  installStreamFetch(streamResponse(frames));

  // Mirrors ConversationScreen: throw ChatStreamError when the backend reports
  // an error frame. streamChat must reject (not swallow) so the UI can classify.
  await assert.rejects(
    () =>
      streamChat({ message: "hi" }, {
        onEvent: (e) => {
          if (e.type === "error") {
            throw new ChatStreamError(e.message, e.raw);
          }
        },
      }),
    (err: unknown) => {
      assert.ok(err instanceof ChatStreamError);
      assert.equal((err as Error).message, "model overloaded");
      return true;
    },
  );
});

test("streamChat resolves without onDone when the signal is already aborted", async () => {
  const frames = ['data: {"type":"content","content":"never"}\n\n', "data: [DONE]\n\n"];
  installStreamFetch(streamResponse(frames));

  const controller = new AbortController();
  controller.abort();
  let doneCalled = false;
  let contentSeen = false;

  const result = await streamChat(
    { message: "hi" },
    {
      signal: controller.signal,
      onEvent: (e) => {
        if (e.type === "content") contentSeen = true;
        if (e.type === "done") doneCalled = true;
      },
    },
  );

  assert.equal(doneCalled, false, "onDone must not fire on abort");
  assert.equal(contentSeen, false, "no frames should be processed after abort");
  assert.equal(result.content, "");
});

test("streamChat awaits async onEvent handlers in order", async () => {
  const frames = [
    'data: {"type":"content","content":"a"}\n\n',
    'data: {"type":"content","content":"b"}\n\n',
    "data: [DONE]\n\n",
  ];
  installStreamFetch(streamResponse(frames));

  const order: string[] = [];
  await streamChat({ message: "hi" }, {
    onEvent: async (e) => {
      if (e.type !== "content") return;
      order.push(`before:${e.delta}`);
      await Promise.resolve();
      order.push(`after:${e.delta}`);
    },
  });

  assert.deepEqual(order, ["before:a", "after:a", "before:b", "after:b"]);
});
