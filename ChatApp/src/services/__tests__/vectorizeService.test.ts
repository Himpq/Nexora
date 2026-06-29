import test from "node:test";
import assert from "node:assert/strict";

import { getBookVectorizeStatus, triggerBookVectorize } from "../vectorizeService";

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

test("getBookVectorizeStatus reads the vectorize status endpoint", async () => {
  const calls = installFetch({ success: true, vector_status: "done" });

  await getBookVectorizeStatus("lecture 1", "book 1");

  assert.equal(
    calls[0].url,
    "https://chat.himpqblog.cn:5002/api/lectures/lecture%201/books/book%201/vectorize",
  );
  assert.equal(calls[0].init.method, "GET");
});

test("triggerBookVectorize posts async payload to the vectorize endpoint", async () => {
  const calls = installFetch({ success: true, vectorization: { queued: true, status: "queued" } }, 202);

  await triggerBookVectorize("lecture 1", "book 1", { force: true });

  assert.equal(
    calls[0].url,
    "https://chat.himpqblog.cn:5002/api/lectures/lecture%201/books/book%201/vectorize",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.equal(new Headers(calls[0].init.headers).get("Content-Type"), "application/json");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    force: true,
    async: true,
  });
});
