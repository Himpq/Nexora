import test from "node:test";
import assert from "node:assert/strict";

import {
  getRefinementQueue,
  getRefinementSettings,
  listRefinementCandidates,
  startAnnotationRefinement,
  startIntensiveRefinement,
  startRefinement,
  startSectionRefinement,
  startSummaryRefinement,
  startVideoSearch,
  stopRefinement,
} from "../refinementService";

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

test("refinement service reads candidates, queue and settings", async () => {
  const calls = installFetch({ success: true, items: [], total: 0 });

  await listRefinementCandidates("queued");
  await getRefinementQueue();
  await getRefinementSettings("extracted");

  assert.equal(
    calls[0].url,
    "https://chat.himpqblog.cn:5002/api/books/refinement/list?status=queued",
  );
  assert.equal(calls[1].url, "https://chat.himpqblog.cn:5002/api/refinement/queue");
  assert.equal(
    calls[2].url,
    "https://chat.himpqblog.cn:5002/api/frontend/settings/refinement?status=extracted",
  );
});

test("refinement service triggers coarse, intensive and section", async () => {
  const calls = installFetch({ success: true });

  await startRefinement("l1", "b1", { actor: "admin" });
  await startIntensiveRefinement("l1", "b1", { actor: "admin", modelName: "m" });
  await startSectionRefinement("l1", "b1", { actor: "admin" });

  assert.equal(calls[0].url, "https://chat.himpqblog.cn:5002/api/frontend/settings/refinement/start");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(bodyOf(calls[0]), {
    lecture_id: "l1",
    book_id: "b1",
    actor: "admin",
    force: false,
  });

  assert.equal(calls[1].url, "https://chat.himpqblog.cn:5002/api/frontend/settings/refinement/intensive");
  assert.deepEqual(bodyOf(calls[1]), {
    lecture_id: "l1",
    book_id: "b1",
    actor: "admin",
    model_name: "m",
  });

  assert.equal(calls[2].url, "https://chat.himpqblog.cn:5002/api/frontend/settings/refinement/section");
});

test("refinement service triggers annotation, summary and video", async () => {
  const calls = installFetch({ success: true });

  await startAnnotationRefinement("l1", "b1", { actor: "admin" });
  await startSummaryRefinement("l1", "b1", { actor: "admin", modelName: "s-model" });
  await startVideoSearch("l1", "b1", { actor: "admin" });

  assert.equal(calls[0].init.method, "POST");
  assert.equal(
    calls[0].url,
    "https://chat.himpqblog.cn:5002/api/frontend/settings/refinement/annotation",
  );
  assert.deepEqual(bodyOf(calls[0]), {
    lecture_id: "l1",
    book_id: "b1",
    actor: "admin",
    model_name: "",
  });

  assert.equal(
    calls[1].url,
    "https://chat.himpqblog.cn:5002/api/frontend/settings/refinement/summary",
  );
  assert.equal(bodyOf(calls[1]).model_name, "s-model");

  assert.equal(
    calls[2].url,
    "https://chat.himpqblog.cn:5002/api/frontend/settings/refinement/video",
  );
  assert.deepEqual(bodyOf(calls[2]), {
    lecture_id: "l1",
    book_id: "b1",
    actor: "admin",
  });
});

test("refinement service stops refinement", async () => {
  const calls = installFetch({ success: true });

  await stopRefinement("l1", "b1", { actor: "admin" });

  assert.equal(
    calls[0].url,
    "https://chat.himpqblog.cn:5002/api/frontend/settings/refinement/stop",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(bodyOf(calls[0]), { lecture_id: "l1", book_id: "b1", actor: "admin" });
});
