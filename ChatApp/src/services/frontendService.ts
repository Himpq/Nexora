import { getJson, postJson } from "./apiClient";
import type {
  DashboardResponse,
  FrontendContext,
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
  return postJson<{
    success: boolean;
    user_id: string;
    selected: boolean;
    selected_lecture_ids: string[];
  }>("/api/frontend/learning/select", {
    lecture_id: lectureId,
    selected,
    actor,
  });
}
