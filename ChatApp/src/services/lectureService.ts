import { deleteJson, getJson, patchJson, postJson } from "./apiClient";
import type { Book, Lecture } from "./types";

export function listLectures() {
  return getJson<{ success: boolean; lectures: Lecture[]; total: number }>("/api/lectures");
}

export function createLecture(payload: {
  title: string;
  description?: string;
  category?: string;
  status?: string;
}) {
  return postJson<{ success: boolean; lecture: Lecture }>("/api/lectures", payload);
}

export function getLecture(lectureId: string) {
  return getJson<{
    success: boolean;
    lecture: Lecture;
    books: Book[];
    total_books: number;
  }>(`/api/lectures/${encodeURIComponent(lectureId)}`);
}

export function updateLecture(
  lectureId: string,
  payload: Partial<Pick<Lecture, "title" | "description" | "category" | "status">>,
) {
  return patchJson<{ success: boolean; lecture: Lecture }>(
    `/api/lectures/${encodeURIComponent(lectureId)}`,
    payload,
  );
}

export function deleteLecture(lectureId: string) {
  return deleteJson<{ success: boolean; lecture: Lecture }>(
    `/api/lectures/${encodeURIComponent(lectureId)}`,
  );
}
