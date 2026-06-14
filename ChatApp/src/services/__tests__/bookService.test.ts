import test from "node:test";
import assert from "node:assert/strict";

import { createBook, uploadBookFile } from "../bookService";

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

test("createBook posts metadata to the lecture books endpoint", async () => {
  const calls = installFetch({ success: true, book: { id: "book_1", title: "Linear Algebra" } });

  await createBook("lecture 1", {
    title: "Linear Algebra",
    description: "notes",
    source_type: "file",
  });

  assert.equal(calls[0].url, "https://chat.himpqblog.cn:5002/api/lectures/lecture%201/books");
  assert.equal(new Headers(calls[0].init.headers).get("Content-Type"), "application/json");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    title: "Linear Algebra",
    description: "notes",
    source_type: "file",
  });
});

test("uploadBookFile posts multipart form data to the book file endpoint", async () => {
  const calls = installFetch({ success: true, book: { id: "book_1", title: "Linear Algebra" } }, 201);
  const file = new File(["content"], "linear.md", { type: "text/markdown" });

  await uploadBookFile("lecture 1", "book 1", {
    uri: "file:///cache/linear.md",
    name: "linear.md",
    type: "text/markdown",
    file,
  });

  assert.equal(
    calls[0].url,
    "https://chat.himpqblog.cn:5002/api/lectures/lecture%201/books/book%201/file",
  );
  assert.equal(new Headers(calls[0].init.headers).get("Content-Type"), null);
  assert.ok(calls[0].init.body instanceof FormData);
});
