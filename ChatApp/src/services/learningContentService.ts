import { getJson, postJson, postStream, learningApiClient } from "./apiClient";

/** ─────────────────────────────────────────────
 *  Reader guide (导读 / 阅读前问题)
 *  Backend: /api/frontend/reader-guide/*
 *  ───────────────────────────────────────────── */

export type ReaderGuideRequest = {
  lecture_id: string;
  book_id: string;
  chapter_name?: string;
  session_name?: string;
  guide_context: string;
  pre_reading_answers?: unknown;
  user_profile?: string;
};

export type ReaderGuideResponse = {
  success: boolean;
  content?: string;
  guide?: string;
  cached?: boolean;
  raw?: unknown;
  [key: string]: unknown;
};

export function generateReaderGuide(payload: ReaderGuideRequest) {
  return postJson<ReaderGuideResponse>("/api/frontend/reader-guide/generate", payload);
}

/** Returns the SSE response — read with `response.body?.getReader()` and parse `event: delta` frames. */
export function streamReaderGuide(payload: ReaderGuideRequest, options?: { signal?: AbortSignal }) {
  return postStream("/api/frontend/reader-guide/stream", payload, { signal: options?.signal });
}

export function streamReaderGuidePreQuestions(
  payload: ReaderGuideRequest,
  options?: { signal?: AbortSignal },
) {
  return postStream("/api/frontend/reader-guide/pre-questions", payload, {
    signal: options?.signal,
  });
}

export function saveReaderGuidePreQuestions(payload: {
  lecture_id: string;
  book_id: string;
  chapter_name?: string;
  session_name?: string;
  questions: unknown[];
  answers: Record<string, unknown>;
  skipped?: boolean;
}) {
  return postJson<{ success: boolean; path?: string; [key: string]: unknown }>(
    "/api/frontend/reader-guide/pre-questions/save",
    payload,
  );
}

export function checkReaderGuidePreQuestions(payload: {
  lecture_id: string;
  book_id: string;
  chapter_name?: string;
  session_name?: string;
}) {
  return postJson<{
    success: boolean;
    has_questions?: boolean;
    questions?: unknown[];
    answers?: Record<string, unknown>;
    skipped?: boolean;
    [key: string]: unknown;
  }>("/api/frontend/reader-guide/pre-questions/check", payload);
}

export function getReaderGuideUserProfile(payload: { lecture_id?: string; book_id?: string }) {
  return postJson<{
    success: boolean;
    user_profile?: string;
    profile?: string;
    [key: string]: unknown;
  }>("/api/frontend/reader-guide/user-profile", payload);
}

/** ─────────────────────────────────────────────
 *  Quiz (session quiz / chapter quiz / batch submit)
 *  ───────────────────────────────────────────── */

export type SessionQuizRequest = {
  lecture_id: string;
  book_id: string;
  chapter_index: number;
  session_index: number;
  chapter_name?: string;
  session_name?: string;
  session_range?: string;
};

export type SessionQuizResponse = {
  success: boolean;
  quiz_id?: string;
  questions?: Array<Record<string, unknown>>;
  answers?: Record<string, unknown>;
  [key: string]: unknown;
};

export function generateSessionQuiz(payload: SessionQuizRequest) {
  return postJson<SessionQuizResponse>("/api/frontend/quiz/generate", payload);
}

export type QuizAnswerSubmission = {
  quiz_id: string;
  question_id?: string;
  question_index?: number;
  answer?: unknown;
  selected?: unknown;
  selected_index?: number;
  is_correct?: boolean;
  lecture_id?: string;
  book_id?: string;
  chapter_name?: string;
  session_name?: string;
  [key: string]: unknown;
};

export function submitQuizAnswer(payload: QuizAnswerSubmission) {
  return postJson<{ success: boolean; record?: Record<string, unknown>; [key: string]: unknown }>(
    "/api/frontend/quiz/submit",
    payload,
  );
}

export function submitQuizAnswerBatch(answers: QuizAnswerSubmission[]) {
  return postJson<{
    success: boolean;
    records?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  }>("/api/frontend/quiz/submit-batch", { answers });
}

/** ─────────────────────────────────────────────
 *  Mindmap
 *  ───────────────────────────────────────────── */

export type MindmapResponse = {
  success: boolean;
  cached?: boolean;
  mindmap?: Record<string, unknown> | null;
  content?: string;
  [key: string]: unknown;
};

export function getMindmap(lectureId: string) {
  return getJson<MindmapResponse>(
    `/api/frontend/mindmap/${encodeURIComponent(lectureId)}`,
  );
}

/**
 * Streaming mindmap generation — opens an SSE GET stream. Returns the live
 * URL so callers using EventSource can connect (browser) or feed the URL into
 * an alternative SSE client. For React Native we suggest using `fetch` with
 * `ReadableStream` parsing similar to `streamLearningChat`.
 */
export function buildMindmapStreamUrl(lectureId: string) {
  const path = `/api/frontend/mindmap/${encodeURIComponent(lectureId)}/generate-stream`;
  const baseUrl = String(learningApiClient.getState().baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  return baseUrl ? `${baseUrl}${path}` : path;
}

export function generateMindmapSection(
  lectureId: string,
  payload: { section_id?: string; section_title?: string; [key: string]: unknown },
) {
  return postJson<{ success: boolean; content?: string; [key: string]: unknown }>(
    `/api/frontend/mindmap/${encodeURIComponent(lectureId)}/section`,
    payload,
  );
}

/** ─────────────────────────────────────────────
 *  Personalized learning (path + chapter + QA)
 *  ───────────────────────────────────────────── */

export type PersonalizedLearningPathChapter = {
  name?: string;
  book_id?: string;
  book_title?: string;
  chapter_range?: string;
  chapter_summary?: string;
  status?: "completed" | "current" | "recommended" | "pending" | string;
  completed?: boolean;
  outline_section_id?: string;
  [key: string]: unknown;
};

export type PersonalizedLearningPathResponse = {
  success: boolean;
  cached?: boolean;
  advice?: string;
  chapters?: PersonalizedLearningPathChapter[];
  [key: string]: unknown;
};

export function buildPersonalizedLearningPathStreamUrl(lectureId: string) {
  const path = `/api/frontend/personalized-learning/generate-path-stream?lecture_id=${encodeURIComponent(lectureId)}`;
  const baseUrl = String(learningApiClient.getState().baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  return baseUrl ? `${baseUrl}${path}` : path;
}

export function generatePersonalizedLearningPath(lectureId: string) {
  return postJson<PersonalizedLearningPathResponse>(
    "/api/frontend/personalized-learning/generate-path",
    { lecture_id: lectureId },
  );
}

export function loadPersonalizedLearningPathV2(lectureId: string) {
  return postJson<PersonalizedLearningPathResponse>(
    "/api/frontend/personalized-learning/load-path",
    { lecture_id: lectureId },
  );
}

export function generatePersonalizedLearningChapter(payload: {
  lecture_id: string;
  chapter_index: number;
}) {
  return postJson<{ success: boolean; content?: string; [key: string]: unknown }>(
    "/api/frontend/personalized-learning/generate-chapter",
    payload,
  );
}

export function streamPersonalizedLearningChapter(
  payload: { lecture_id: string; chapter_index: number },
  options?: { signal?: AbortSignal },
) {
  return postStream(
    "/api/frontend/personalized-learning/generate-chapter-stream",
    payload,
    { signal: options?.signal },
  );
}

export function loadPersonalizedLearningChapter(payload: {
  lecture_id: string;
  chapter_index: number;
}) {
  return postJson<{
    success: boolean;
    cached?: boolean;
    content?: string;
    [key: string]: unknown;
  }>("/api/frontend/personalized-learning/load-chapter", payload);
}

export function completePersonalizedLearningChapter(payload: {
  lecture_id: string;
  chapter_index: number;
}) {
  return postJson<{
    success: boolean;
    already_completed?: boolean;
    chapters?: PersonalizedLearningPathChapter[];
    memory_enqueue?: unknown;
    [key: string]: unknown;
  }>("/api/frontend/personalized-learning/chapter-complete", payload);
}

export function getPersonalizedLearningChapterQuiz(payload: {
  lecture_id: string;
  chapter_index: number;
}) {
  return postJson<{
    success: boolean;
    quiz?: Record<string, unknown>;
    quiz_id?: string;
    questions?: Array<Record<string, unknown>>;
    answers?: Record<string, unknown>;
    [key: string]: unknown;
  }>("/api/frontend/personalized-learning/chapter-quiz", payload);
}

export function savePersonalizedLearningQa(payload: {
  lecture_id: string;
  questions: unknown[];
  answers: Record<string, unknown>;
  skipped?: boolean;
}) {
  return postJson<{ success: boolean; path?: string }>(
    "/api/frontend/personalized-learning/save-qa",
    payload,
  );
}

export function loadPersonalizedLearningQa(lectureId: string) {
  return postJson<{
    success: boolean;
    questions?: unknown[];
    answers?: Record<string, unknown>;
    skipped?: boolean;
    [key: string]: unknown;
  }>("/api/frontend/personalized-learning/load-qa", { lecture_id: lectureId });
}

export function buildPersonalizedLearningQaStreamUrl(lectureId: string) {
  const path = `/api/frontend/personalized-learning/generate-qa-stream?lecture_id=${encodeURIComponent(lectureId)}`;
  const baseUrl = String(learningApiClient.getState().baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  return baseUrl ? `${baseUrl}${path}` : path;
}

/** ─────────────────────────────────────────────
 *  Learning report (summary stats per user × lecture)
 *  ───────────────────────────────────────────── */

export type LearningReportResponse = {
  success: boolean;
  user_id?: string;
  lecture_id?: string;
  book_id?: string;
  question_stats?: Record<string, unknown>;
  reading_stats?: Record<string, unknown>;
  profile_summary?: Record<string, unknown>;
  recent_records?: Array<Record<string, unknown>>;
  recommendations?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export function getLearningReport(query?: {
  lecture_id?: string;
  book_id?: string;
  chapter_index?: number;
}) {
  return getJson<LearningReportResponse>("/api/frontend/learning/report", {
    query: {
      lecture_id: query?.lecture_id,
      book_id: query?.book_id,
      chapter_index: query?.chapter_index,
    },
  });
}

/** ─────────────────────────────────────────────
 *  Teacher views
 *  ───────────────────────────────────────────── */

export type TeacherClassOverviewResponse = {
  success: boolean;
  lectures?: Array<Record<string, unknown>>;
  students?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export function getTeacherClassOverview(lectureId?: string) {
  return getJson<TeacherClassOverviewResponse>(
    "/api/frontend/teacher/class-overview",
    { query: lectureId ? { lecture_id: lectureId } : undefined },
  );
}

export function getTeacherStudentAnalysis(query: {
  user_id: string;
  lecture_id?: string;
  book_id?: string;
}) {
  return getJson<{
    success: boolean;
    analysis?: Record<string, unknown>;
    [key: string]: unknown;
  }>("/api/frontend/teacher/student-analysis", {
    query: {
      user_id: query.user_id,
      lecture_id: query.lecture_id,
      book_id: query.book_id,
    },
  });
}

/** ─────────────────────────────────────────────
 *  Frontend card / question bank
 *  ───────────────────────────────────────────── */

export function generateFrontendCard(payload: Record<string, unknown>) {
  return postJson<{ success: boolean; card?: Record<string, unknown>; [key: string]: unknown }>(
    "/api/frontend/card",
    payload,
  );
}

export function getQuestionBank(query?: { lecture_id?: string; book_id?: string }) {
  return getJson<{
    success: boolean;
    items?: Array<Record<string, unknown>>;
    total?: number;
    [key: string]: unknown;
  }>("/api/frontend/question-bank", {
    query: {
      lecture_id: query?.lecture_id,
      book_id: query?.book_id,
    },
  });
}

/** ─────────────────────────────────────────────
 *  User search
 *  ───────────────────────────────────────────── */

export type UserSearchHit = {
  user_id?: string;
  username?: string;
  nickname?: string;
  display_name?: string;
  avatar_url?: string;
  role?: string;
  [key: string]: unknown;
};

export function searchUsers(query: string, limit = 8) {
  return getJson<{ success: boolean; items: UserSearchHit[]; total: number }>(
    "/api/frontend/users/search",
    { query: { q: query, limit } },
  );
}

export function searchLearningFeedUsers(query: string, limit = 8) {
  return getJson<{ success: boolean; items: UserSearchHit[]; total: number }>(
    "/api/frontend/learning-feeds/users/search",
    { query: { q: query, limit } },
  );
}
