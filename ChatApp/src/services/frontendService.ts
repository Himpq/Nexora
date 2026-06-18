import { getJson, postJson } from "./apiClient";
import type {
  DashboardResponse,
  FrontendContext,
  LearningSelectionResponse,
  MaterialsResponse,
} from "./types";

export function getFrontendContext(username?: string) {
  return getJson<FrontendContext>("/api/frontend/context", {
    query: username ? { username } : undefined,
  });
}

export function getMaterials() {
  return getJson<MaterialsResponse>("/api/frontend/materials");
}

export function getDashboard() {
  return getJson<DashboardResponse>("/api/frontend/dashboard");
}

export function selectLearning(lectureId: string, selected: boolean, actor?: string) {
  return postJson<LearningSelectionResponse>("/api/frontend/learning/select", {
    lecture_id: lectureId,
    selected,
    actor,
  });
}

export function completeLearningChapter(payload: {
  lecture_id: string;
  book_id: string;
  chapter_name: string;
  chapter_range?: string;
  chapter_context?: string;
  chapter_detail_xml?: string;
}) {
  return postJson<{
    success: boolean;
    enqueue?: unknown;
    already_completed?: boolean;
    progress?: number;
    next_chapter?: string;
  }>("/api/frontend/learning/chapter-complete", payload);
}
