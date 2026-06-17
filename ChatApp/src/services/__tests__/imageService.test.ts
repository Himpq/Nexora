import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBookImageUrl,
  getBookCoverUri,
  getLectureCoverUri,
  listBookCoverAssets,
  listLectureCoverAssets,
  pickPrimaryCoverUri,
  resolveAvatarUrl,
  resolveLearningAssetUrl,
} from "../imageService";

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

test("image service lists lecture and book cover assets", async () => {
  const calls = installFetch({ success: true, items: [], total: 0 });

  await listLectureCoverAssets("lecture 1");
  await listBookCoverAssets("lecture 1", "book 1");

  assert.equal(
    calls[0].url,
    "https://chat.himpqblog.cn:5002/api/lectures/lecture%201/cover-assets",
  );
  assert.equal(
    calls[1].url,
    "https://chat.himpqblog.cn:5002/api/lectures/lecture%201/books/book%201/cover-assets",
  );
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[1].init.method, "GET");
});

test("image service resolves learning asset URLs", () => {
  assert.equal(
    resolveLearningAssetUrl("/api/lectures/lecture_1/cover.png"),
    "https://chat.himpqblog.cn:5002/api/lectures/lecture_1/cover.png",
  );
  assert.equal(
    resolveLearningAssetUrl("api/lectures/lecture_1/cover.png"),
    "https://chat.himpqblog.cn:5002/api/lectures/lecture_1/cover.png",
  );
  assert.equal(
    resolveLearningAssetUrl("https://cdn.example.test/cover.png"),
    "https://cdn.example.test/cover.png",
  );
});

test("image service picks covers from backend records", () => {
  assert.equal(
    getLectureCoverUri({ cover_path: "/static/lecture.png" }),
    "https://chat.himpqblog.cn:5002/static/lecture.png",
  );
  assert.equal(
    getBookCoverUri({ image_url: "/static/book.png" }),
    "https://chat.himpqblog.cn:5002/static/book.png",
  );
  assert.equal(
    pickPrimaryCoverUri([{ name: "empty" }, { image_url: "/static/primary.png" }]),
    "https://chat.himpqblog.cn:5002/static/primary.png",
  );
  assert.equal(
    buildBookImageUrl("lecture 1", "book 1", "image 1"),
    "https://chat.himpqblog.cn:5002/api/lectures/lecture%201/books/book%201/images/image%201",
  );
});

test("image service resolves avatar URLs for the configured backend host", () => {
  assert.equal(
    resolveAvatarUrl("/avatars/ada.png"),
    "https://chat.himpqblog.cn:5002/avatars/ada.png",
  );
  assert.equal(
    resolveAvatarUrl("https://cdn.example.test/avatars/ada.png"),
    "https://cdn.example.test/avatars/ada.png",
  );
});
