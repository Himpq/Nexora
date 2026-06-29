import test from "node:test";
import assert from "node:assert/strict";

import {
  checkReaderGuidePreQuestions,
  completePersonalizedLearningChapter,
  generateFrontendCard,
  generateMindmapSection,
  generatePersonalizedLearningPath,
  generateReaderGuide,
  generateSessionQuiz,
  getLearningReport,
  getMindmap,
  getQuestionBank,
  getReaderGuideUserProfile,
  getTeacherClassOverview,
  getTeacherStudentAnalysis,
  loadPersonalizedLearningPathV2,
  savePersonalizedLearningQa,
  saveReaderGuidePreQuestions,
  searchLearningFeedUsers,
  searchUsers,
  submitQuizAnswerBatch,
} from "../learningContentService";

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

test("learning content service posts reader guide and quiz payloads", async () => {
  const calls = installFetch({ success: true, items: [], questions: [] });

  await generateReaderGuide({
    lecture_id: "lecture 1",
    book_id: "book 1",
    guide_context: "ctx",
  });
  await saveReaderGuidePreQuestions({
    lecture_id: "lecture 1",
    book_id: "book 1",
    questions: [{ id: "q1" }],
    answers: { q1: "a1" },
  });
  await checkReaderGuidePreQuestions({ lecture_id: "lecture 1", book_id: "book 1" });
  await getReaderGuideUserProfile({ lecture_id: "lecture 1", book_id: "book 1" });
  await generateSessionQuiz({
    lecture_id: "lecture 1",
    book_id: "book 1",
    chapter_index: 0,
    session_index: 1,
  });
  await submitQuizAnswerBatch([{ quiz_id: "quiz 1", answer: "A" }]);

  assert.equal(calls[0].url, "https://chat.himpqblog.cn:5002/api/frontend/reader-guide/generate");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    lecture_id: "lecture 1",
    book_id: "book 1",
    guide_context: "ctx",
  });
  assert.equal(
    calls[1].url,
    "https://chat.himpqblog.cn:5002/api/frontend/reader-guide/pre-questions/save",
  );
  assert.equal(
    calls[2].url,
    "https://chat.himpqblog.cn:5002/api/frontend/reader-guide/pre-questions/check",
  );
  assert.equal(
    calls[3].url,
    "https://chat.himpqblog.cn:5002/api/frontend/reader-guide/user-profile",
  );
  assert.equal(calls[4].url, "https://chat.himpqblog.cn:5002/api/frontend/quiz/generate");
  assert.equal(calls[5].url, "https://chat.himpqblog.cn:5002/api/frontend/quiz/submit-batch");
});

test("learning content service reads and updates expanded learning endpoints", async () => {
  const calls = installFetch({ success: true, items: [], chapters: [] });

  await getMindmap("lecture 1");
  await generateMindmapSection("lecture 1", { section_id: "section 1" });
  await generatePersonalizedLearningPath("lecture 1");
  await loadPersonalizedLearningPathV2("lecture 1");
  await completePersonalizedLearningChapter({ lecture_id: "lecture 1", chapter_index: 2 });
  await savePersonalizedLearningQa({
    lecture_id: "lecture 1",
    questions: [],
    answers: {},
    skipped: true,
  });
  await getLearningReport({ lecture_id: "lecture 1", book_id: "book 1", chapter_index: 2 });
  await getTeacherClassOverview("lecture 1");
  await getTeacherStudentAnalysis({ user_id: "ada", lecture_id: "lecture 1" });
  await generateFrontendCard({ lecture_id: "lecture 1" });
  await getQuestionBank({ lecture_id: "lecture 1", book_id: "book 1" });
  await searchUsers("ada", 3);
  await searchLearningFeedUsers("ada", 3);

  assert.equal(calls[0].url, "https://chat.himpqblog.cn:5002/api/frontend/mindmap/lecture%201");
  assert.equal(
    calls[1].url,
    "https://chat.himpqblog.cn:5002/api/frontend/mindmap/lecture%201/section",
  );
  assert.equal(
    calls[2].url,
    "https://chat.himpqblog.cn:5002/api/frontend/personalized-learning/generate-path",
  );
  assert.equal(
    calls[3].url,
    "https://chat.himpqblog.cn:5002/api/frontend/personalized-learning/load-path",
  );
  assert.equal(
    calls[4].url,
    "https://chat.himpqblog.cn:5002/api/frontend/personalized-learning/chapter-complete",
  );
  assert.equal(
    calls[5].url,
    "https://chat.himpqblog.cn:5002/api/frontend/personalized-learning/save-qa",
  );
  assert.equal(
    calls[6].url,
    "https://chat.himpqblog.cn:5002/api/frontend/learning/report?lecture_id=lecture%201&book_id=book%201&chapter_index=2",
  );
  assert.equal(
    calls[7].url,
    "https://chat.himpqblog.cn:5002/api/frontend/teacher/class-overview?lecture_id=lecture%201",
  );
  assert.equal(
    calls[8].url,
    "https://chat.himpqblog.cn:5002/api/frontend/teacher/student-analysis?user_id=ada&lecture_id=lecture%201",
  );
  assert.equal(calls[9].url, "https://chat.himpqblog.cn:5002/api/frontend/card");
  assert.equal(
    calls[10].url,
    "https://chat.himpqblog.cn:5002/api/frontend/question-bank?lecture_id=lecture%201&book_id=book%201",
  );
  assert.equal(calls[11].url, "https://chat.himpqblog.cn:5002/api/frontend/users/search?q=ada&limit=3");
  assert.equal(
    calls[12].url,
    "https://chat.himpqblog.cn:5002/api/frontend/learning-feeds/users/search?q=ada&limit=3",
  );
});
