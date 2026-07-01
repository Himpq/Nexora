import test from "node:test";
import assert from "node:assert/strict";

import { readSseStream } from "../sse";

function streamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    body: stream,
  } as Response;
}

test("readSseStream dispatches parsed data to onData (backward compatible)", async () => {
  const received: unknown[] = [];
  let done = 0;

  await readSseStream(
    streamingResponse(["data: {\"a\":1}\n\n", "data: {\"a\":2}\n\n"]),
    {
      onData: (data) => {
        received.push(data);
      },
      onDone: () => {
        done += 1;
      },
    },
  );

  assert.deepEqual(received, [{ a: 1 }, { a: 2 }]);
  assert.equal(done, 1);
});

test("readSseStream dispatches event name + data to onEvent when provided", async () => {
  const events: Array<{ event: string; data: unknown }> = [];

  await readSseStream(
    streamingResponse([
      "event: status\ndata: {\"message\":\"hi\"}\n\n",
      "event: delta\ndata: {\"content\":\"x\"}\n\n",
      "event: done\ndata: {\"success\":true}\n\n",
    ]),
    {
      onData: () => {
        throw new Error("onData must not be called when onEvent is provided");
      },
      onEvent: (event, data) => {
        events.push({ event, data });
      },
    },
  );

  assert.deepEqual(events, [
    { event: "status", data: { message: "hi" } },
    { event: "delta", data: { content: "x" } },
    { event: "done", data: { success: true } },
  ]);
});

test("readSseStream defaults event name to message when event line is absent", async () => {
  const events: string[] = [];

  await readSseStream(streamingResponse(["data: {\"v\":1}\n\n"]), {
    onEvent: (event) => {
      events.push(event);
    },
  });

  assert.deepEqual(events, ["message"]);
});

test("readSseStream fires onDone on the [DONE] sentinel and stops", async () => {
  const received: unknown[] = [];
  let done = 0;

  await readSseStream(
    streamingResponse(["data: {\"a\":1}\n\n", "data: [DONE]\n\n", "data: {\"a\":2}\n\n"]),
    {
      onData: (data) => {
        received.push(data);
      },
      onDone: () => {
        done += 1;
      },
    },
  );

  assert.deepEqual(received, [{ a: 1 }]);
  assert.equal(done, 1);
});
