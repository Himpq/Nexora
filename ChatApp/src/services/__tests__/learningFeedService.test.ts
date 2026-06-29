import test from "node:test";
import assert from "node:assert/strict";

import {
  addLearningFeedComment,
  createLearningFeed,
  createLearningFeedChannel,
  deleteLearningFeed,
  deleteLearningFeedChannel,
  deleteLearningFeedComment,
  listLearningFeedChannels,
  listLearningFeeds,
  toggleLearningFeedCommentLike,
  toggleLearningFeedLike,
  updateLearningFeedChannel,
} from "../learningFeedService";

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

test("learning feed service lists channels and feeds", async () => {
  const calls = installFetch({ success: true, items: [], channels: [], total: 0 });

  await listLearningFeedChannels();
  await listLearningFeeds({ channelId: "public_all", limit: 25 });

  assert.equal(
    calls[0].url,
    "https://chat.himpqblog.cn:5002/api/frontend/learning-feeds/channels",
  );
  assert.equal(
    calls[1].url,
    "https://chat.himpqblog.cn:5002/api/frontend/learning-feeds?channel_id=public_all&limit=25",
  );
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[1].init.method, "GET");
});

test("learning feed service posts feed actions to backend endpoints", async () => {
  const calls = installFetch({ success: true, item: { id: "feed 1" } });

  await createLearningFeed({ content: "hello", channel_id: "public_all" });
  await toggleLearningFeedLike("feed 1");
  await toggleLearningFeedCommentLike("feed 1", "comment 1");
  await addLearningFeedComment("feed 1", "nice");
  await deleteLearningFeed("feed 1");
  await deleteLearningFeedComment("feed 1", "comment 1");

  assert.equal(calls[0].url, "https://chat.himpqblog.cn:5002/api/frontend/learning-feeds");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    content: "hello",
    channel_id: "public_all",
  });
  assert.equal(
    calls[1].url,
    "https://chat.himpqblog.cn:5002/api/frontend/learning-feeds/feed%201/like",
  );
  assert.equal(
    calls[2].url,
    "https://chat.himpqblog.cn:5002/api/frontend/learning-feeds/feed%201/comments/comment%201/like",
  );
  assert.equal(
    calls[3].url,
    "https://chat.himpqblog.cn:5002/api/frontend/learning-feeds/feed%201/comments",
  );
  assert.deepEqual(JSON.parse(String(calls[3].init.body)), { content: "nice" });
  assert.equal(calls[4].init.method, "DELETE");
  assert.equal(
    calls[5].url,
    "https://chat.himpqblog.cn:5002/api/frontend/learning-feeds/feed%201/comments/comment%201",
  );
});

test("learning feed service manages admin feed channels", async () => {
  const calls = installFetch({ success: true, item: { id: "channel 1", title: "Study" } });

  await createLearningFeedChannel({ title: "Study", member_user_ids: ["ALL"] });
  await updateLearningFeedChannel("channel 1", {
    title: "Reading",
    member_user_ids: ["ada", "grace"],
  });
  await deleteLearningFeedChannel("channel 1");

  assert.equal(
    calls[0].url,
    "https://chat.himpqblog.cn:5002/api/frontend/settings/feed-channels",
  );
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    title: "Study",
    member_user_ids: ["ALL"],
  });
  assert.equal(
    calls[1].url,
    "https://chat.himpqblog.cn:5002/api/frontend/settings/feed-channels/channel%201",
  );
  assert.equal(calls[1].init.method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), {
    title: "Reading",
    member_user_ids: ["ada", "grace"],
  });
  assert.equal(
    calls[2].url,
    "https://chat.himpqblog.cn:5002/api/frontend/settings/feed-channels/channel%201",
  );
  assert.equal(calls[2].init.method, "DELETE");
});
