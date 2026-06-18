import { getJson, postJson } from "./apiClient";

export type LearningNotification = {
  id?: string;
  type?: string;
  title?: string;
  message?: string;
  content?: string;
  timestamp?: number;
  removed?: boolean;
  [key: string]: unknown;
};

export type LearningProfileDimension = {
  label?: string;
  value?: string;
  filled?: boolean;
  [key: string]: unknown;
};

export type LearningProfileResponse = {
  success: boolean;
  user_id: string;
  dimensions: Record<string, LearningProfileDimension>;
  timeline?: Array<Record<string, unknown>>;
  completion_rate: number;
  filled_count: number;
  total_count: number;
  [key: string]: unknown;
};

export type LearningPathChapter = {
  name?: string;
  title?: string;
  status?: "completed" | "current" | "recommended" | "pending" | string;
  priority?: number;
  reason?: string;
  book_id?: string;
  book_title?: string;
  chapter_range?: string;
  chapter_summary?: string;
  completed?: boolean;
  [key: string]: unknown;
};

export type LearningPathResponse = {
  success: boolean;
  cached?: boolean;
  advice?: string;
  path?: LearningPathChapter[];
  chapters?: LearningPathChapter[];
  [key: string]: unknown;
};

export type LearningVideo = {
  title?: string;
  url?: string;
  cover?: string;
  cover_url?: string;
  author?: string;
  up_name?: string;
  duration?: string | number;
  play_count?: string | number;
  source?: string;
  book_id?: string;
  book_title?: string;
  [key: string]: unknown;
};

export type LearningVideosResponse = {
  success: boolean;
  items: LearningVideo[];
  cached?: boolean;
  book_count?: number;
  cached_book_count?: number;
  [key: string]: unknown;
};

export type KnowledgeGraphNode = {
  id?: string;
  title?: string;
  name?: string;
  label?: string;
  summary?: string;
  content?: string;
  children?: KnowledgeGraphNode[];
  concepts?: KnowledgeGraphNode[];
  key_points?: KnowledgeGraphNode[];
  [key: string]: unknown;
};

export type KnowledgeGraphResponse = {
  success: boolean;
  graph?: {
    chapters?: KnowledgeGraphNode[];
    nodes?: KnowledgeGraphNode[];
    edges?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  } | null;
  cached?: boolean;
  [key: string]: unknown;
};

export type CourseOutlineSection = {
  id?: string;
  section_id?: string;
  title?: string;
  summary?: string;
  estimated_minutes?: number;
  difficulty?: string;
  key_concepts?: string[];
  learning_objectives?: string[];
  prerequisites?: string[];
  [key: string]: unknown;
};

export type CourseOutlineResponse = {
  success: boolean;
  outline?: {
    lecture_title?: string;
    course_title?: string;
    total_sections?: number;
    total_estimated_minutes?: number;
    sections?: CourseOutlineSection[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type ChapterQuizResponse = {
  success: boolean;
  quiz?: Record<string, unknown>;
  quiz_id?: string;
  questions?: Array<Record<string, unknown>>;
  answers?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ChapterCompleteResponse = {
  success: boolean;
  already_completed?: boolean;
  enqueue?: unknown;
  memory_enqueue?: unknown;
  chapters?: LearningPathChapter[];
  [key: string]: unknown;
};

export function listLearningNotifications(limit = 20) {
  return getJson<{
    success: boolean;
    user_id: string;
    items: LearningNotification[];
    admin_pending_parse?: Record<string, unknown>;
    [key: string]: unknown;
  }>("/api/frontend/notifications", {
    query: { limit },
  });
}

export function removeLearningNotification(notificationId: string) {
  return postJson<{ success: boolean; [key: string]: unknown }>(
    `/api/frontend/notifications/${encodeURIComponent(notificationId)}/remove`,
  );
}

export function getLearningProfile() {
  return getJson<LearningProfileResponse>("/api/frontend/profile");
}

export function generateBookLearningPath(payload: {
  lecture_id: string;
  book_id: string;
  force?: boolean;
}) {
  return postJson<LearningPathResponse>("/api/frontend/learning-path", payload);
}

export function loadPersonalizedLearningPath(lectureId: string) {
  return postJson<LearningPathResponse>("/api/frontend/personalized-learning/load-path", {
    lecture_id: lectureId,
  });
}

export function getLearningVideos(lectureId: string, bookId: string) {
  return getJson<LearningVideosResponse>("/api/frontend/videos", {
    query: {
      lecture_id: lectureId,
      book_id: bookId,
    },
  });
}

export function getLectureVideos(lectureId: string) {
  return getJson<LearningVideosResponse>("/api/frontend/lecture-videos", {
    query: {
      lecture_id: lectureId,
    },
  });
}

export function refreshLearningVideos(lectureId: string, bookId: string) {
  return postJson<LearningVideosResponse>("/api/frontend/videos/refresh", {
    lecture_id: lectureId,
    book_id: bookId,
  });
}

export function getKnowledgeGraph(lectureId: string, bookId: string) {
  return getJson<KnowledgeGraphResponse>("/api/frontend/knowledge-graph", {
    query: {
      lecture_id: lectureId,
      book_id: bookId,
    },
  });
}

export function generateKnowledgeGraph(lectureId: string, bookId: string) {
  return postJson<KnowledgeGraphResponse>("/api/frontend/knowledge-graph/generate", {
    lecture_id: lectureId,
    book_id: bookId,
  });
}

export function getCourseOutline(lectureId: string) {
  return getJson<CourseOutlineResponse>(
    `/api/frontend/outline/${encodeURIComponent(lectureId)}`,
  );
}

export function generateCourseOutline(lectureId: string) {
  return postJson<{ success: boolean; message?: string; [key: string]: unknown }>(
    `/api/frontend/outline/${encodeURIComponent(lectureId)}/generate`,
  );
}

export function completeLearningSession(payload: {
  lecture_id: string;
  book_id: string;
  chapter_name: string;
  chapter_index: number;
  session_name: string;
  session_index: number;
  session_range?: string;
}) {
  return postJson<ChapterCompleteResponse>("/api/frontend/learning/session-complete", payload);
}

export function clearLearningChapterRecord(payload: {
  lecture_id: string;
  book_id: string;
  chapter_name: string;
  chapter_index: number;
}) {
  return postJson<{ success: boolean; removed?: number; [key: string]: unknown }>(
    "/api/frontend/learning/chapter-record/clear",
    payload,
  );
}

export function getChapterQuiz(payload: {
  lecture_id: string;
  book_id: string;
  chapter_name: string;
  chapter_index: number;
  chapter_range?: string;
  chapter_context?: string;
  chapter_detail_xml?: string;
}) {
  return postJson<ChapterQuizResponse>("/api/frontend/quiz/chapter", payload);
}
