import test from "node:test";
import assert from "node:assert/strict";

import {
  createBook,
  getBookAnnotations,
  getBookChapterText,
  getBookSections,
  getBookSummary,
  parseBookFile,
  uploadBookFile,
  uploadBookText,
} from "../bookService";

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

test("book service reads derived book content endpoints", async () => {
  const calls = installFetch({ success: true, content: "", items: [] });

  await getBookSections("lecture 1", "book 1");
  await getBookChapterText("lecture 1", "book 1", 2);
  await getBookAnnotations("lecture 1", "book 1");
  await getBookSummary("lecture 1", "book 1");

  assert.equal(
    calls[0].url,
    "https://chat.himpqblog.cn:5002/api/lectures/lecture%201/books/book%201/sections",
  );
  assert.equal(
    calls[1].url,
    "https://chat.himpqblog.cn:5002/api/lectures/lecture%201/books/book%201/chapter/2",
  );
  assert.equal(
    calls[2].url,
    "https://chat.himpqblog.cn:5002/api/lectures/lecture%201/books/book%201/annotations",
  );
  assert.equal(
    calls[3].url,
    "https://chat.himpqblog.cn:5002/api/lectures/lecture%201/books/book%201/summary",
  );
  assert.equal(calls[0].init.method, "GET");
});

test("book service posts parse and text upload actions", async () => {
  const calls = installFetch({ success: true, book: { id: "book 1" }, chars: 12 });

  await parseBookFile("lecture 1", "book 1");
  await uploadBookText("lecture 1", "book 1", "chapter text");

  assert.equal(
    calls[0].url,
    "https://chat.himpqblog.cn:5002/api/lectures/lecture%201/books/book%201/parse",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {});
  assert.equal(
    calls[1].url,
    "https://chat.himpqblog.cn:5002/api/lectures/lecture%201/books/book%201/text",
  );
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), { content: "chapter text" });
});
