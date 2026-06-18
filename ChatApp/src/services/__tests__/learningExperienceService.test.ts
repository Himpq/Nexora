import test from "node:test";
import assert from "node:assert/strict";

import {
  clearLearningChapterRecord,
  completeLearningSession,
  generateBookLearningPath,
  generateKnowledgeGraph,
  getChapterQuiz,
  getCourseOutline,
  getKnowledgeGraph,
  getLearningProfile,
  getLearningVideos,
  getLectureVideos,
  listLearningNotifications,
  loadPersonalizedLearningPath,
  refreshLearningVideos,
  removeLearningNotification,
} from "../learningExperienceService";

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

test("learning experience service reads profile, notifications, outline, videos and graph", async () => {
  const calls = installFetch({ success: true, items: [], graph: null, dimensions: {} });

  await listLearningNotifications(10);
  await removeLearningNotification("notice 1");
  await getLearningProfile();
  await getCourseOutline("lecture 1");
  await getLectureVideos("lecture 1");
  await getLearningVideos("lecture 1", "book 1");
  await getKnowledgeGraph("lecture 1", "book 1");

  assert.equal(
    calls[0].url,
    "https://chat.himpqblog.cn:5002/api/frontend/notifications?limit=10",
  );
  assert.equal(
    calls[1].url,
    "https://chat.himpqblog.cn:5002/api/frontend/notifications/notice%201/remove",
  );
  assert.equal(calls[2].url, "https://chat.himpqblog.cn:5002/api/frontend/profile");
  assert.equal(
    calls[3].url,
    "https://chat.himpqblog.cn:5002/api/frontend/outline/lecture%201",
  );
  assert.equal(
    calls[4].url,
    "https://chat.himpqblog.cn:5002/api/frontend/lecture-videos?lecture_id=lecture%201",
  );
  assert.equal(
    calls[5].url,
    "https://chat.himpqblog.cn:5002/api/frontend/videos?lecture_id=lecture%201&book_id=book%201",
  );
  assert.equal(
    calls[6].url,
    "https://chat.himpqblog.cn:5002/api/frontend/knowledge-graph?lecture_id=lecture%201&book_id=book%201",
  );
});

test("learning experience service posts generation and learning progress payloads", async () => {
  const calls = installFetch({ success: true, items: [], questions: [] });

  await generateBookLearningPath({ lecture_id: "lecture 1", book_id: "book 1", force: true });
  await loadPersonalizedLearningPath("lecture 1");
  await refreshLearningVideos("lecture 1", "book 1");
  await generateKnowledgeGraph("lecture 1", "book 1");
  await completeLearningSession({
    lecture_id: "lecture 1",
    book_id: "book 1",
    chapter_name: "Intro",
    chapter_index: 0,
    session_name: "Session A",
    session_index: 1,
    session_range: "0:120",
  });
  await clearLearningChapterRecord({
    lecture_id: "lecture 1",
    book_id: "book 1",
    chapter_name: "Intro",
    chapter_index: 0,
  });
  await getChapterQuiz({
    lecture_id: "lecture 1",
    book_id: "book 1",
    chapter_name: "Intro",
    chapter_index: 0,
    chapter_range: "0:120",
  });

  assert.equal(calls[0].url, "https://chat.himpqblog.cn:5002/api/frontend/learning-path");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    lecture_id: "lecture 1",
    book_id: "book 1",
    force: true,
  });
  assert.equal(
    calls[1].url,
    "https://chat.himpqblog.cn:5002/api/frontend/personalized-learning/load-path",
  );
  assert.equal(calls[2].url, "https://chat.himpqblog.cn:5002/api/frontend/videos/refresh");
  assert.equal(
    calls[3].url,
    "https://chat.himpqblog.cn:5002/api/frontend/knowledge-graph/generate",
  );
  assert.equal(
    calls[4].url,
    "https://chat.himpqblog.cn:5002/api/frontend/learning/session-complete",
  );
  assert.equal(
    calls[5].url,
    "https://chat.himpqblog.cn:5002/api/frontend/learning/chapter-record/clear",
  );
  assert.equal(calls[6].url, "https://chat.himpqblog.cn:5002/api/frontend/quiz/chapter");
});
