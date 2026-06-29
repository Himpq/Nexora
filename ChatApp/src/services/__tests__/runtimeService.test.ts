import test from "node:test";
import assert from "node:assert/strict";

import {
  completeRuntimeMemoryContextCompression,
  executeRuntimeTool,
  getRuntimeConfig,
  getRuntimeMemoryBlocks,
  getRuntimeMemoryQueue,
  getRuntimeTools,
  recordRuntimeMemoryTurn,
  triggerRuntimeMemory,
} from "../runtimeService";

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

function bodyOf(call: FetchCall) {
  return JSON.parse(String(call.init.body));
}

const BASE = "https://chat.himpqblog.cn:5002";

test("runtime service reads config, tools and memory queue", async () => {
  const calls = installFetch({ success: true, runtime_api: {}, tools: [], queue: [] });

  await getRuntimeConfig();
  await getRuntimeTools();
  await getRuntimeMemoryQueue();

  assert.equal(calls[0].url, `${BASE}/api/runtime/config`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[1].url, `${BASE}/api/runtime/tools`);
  assert.equal(calls[2].url, `${BASE}/api/runtime/memory/queue`);
});

test("runtime service executes a tool", async () => {
  const calls = installFetch({ success: true, result: {} });

  await executeRuntimeTool({
    username: "u1",
    toolName: "search",
    arguments: { q: "ai" },
  });

  assert.equal(calls[0].url, `${BASE}/api/runtime/tool/execute`);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(bodyOf(calls[0]), {
    username: "u1",
    tool_name: "search",
    arguments: { q: "ai" },
  });
});

test("runtime service builds memory blocks", async () => {
  const calls = installFetch({ success: true, blocks: [] });

  await getRuntimeMemoryBlocks({ username: "u1", lectureId: "l1" });

  assert.equal(calls[0].url, `${BASE}/api/runtime/memory-blocks`);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(bodyOf(calls[0]), { username: "u1", lecture_id: "l1" });
});

test("runtime service triggers memory analysis with default reason", async () => {
  const calls = installFetch({ success: true, result: {} });

  await triggerRuntimeMemory({ username: "u1", lectureId: "l1" });

  assert.equal(calls[0].url, `${BASE}/api/runtime/memory/trigger`);
  assert.deepEqual(bodyOf(calls[0]), {
    username: "u1",
    lecture_id: "l1",
    reason: "manual",
    payload: {},
  });
});

test("runtime service marks context compression completed", async () => {
  const calls = installFetch({ success: true });

  await completeRuntimeMemoryContextCompression({
    username: "u1",
    lectureId: "l1",
    jobId: "j1",
  });

  assert.equal(calls[0].url, `${BASE}/api/runtime/memory/context-compression`);
  assert.deepEqual(bodyOf(calls[0]), {
    username: "u1",
    lecture_id: "l1",
    job_id: "j1",
  });
});

test("runtime service records a memory turn", async () => {
  const calls = installFetch({ success: true, state: {}, enqueue: {} });

  await recordRuntimeMemoryTurn({ username: "u1", lectureId: "l1", payload: { k: 1 } });

  assert.equal(calls[0].url, `${BASE}/api/runtime/memory/turn`);
  assert.deepEqual(bodyOf(calls[0]), {
    username: "u1",
    lecture_id: "l1",
    payload: { k: 1 },
  });
});
