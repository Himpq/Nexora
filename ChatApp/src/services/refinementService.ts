import { getJson, postJson } from "./apiClient";

export type RefinementItem = {
  lecture_id?: string;
  lecture_title?: string;
  book_id?: string;
  book_title?: string;
  status?: string;
  [key: string]: unknown;
};

export function listRefinementCandidates(status?: string) {
  return getJson<{ success: boolean; items: RefinementItem[]; total: number }>(
    "/api/books/refinement/list",
    { query: status ? { status } : undefined },
  );
}

export function listLectureRefinementCandidates(lectureId: string, status?: string) {
  return getJson<{
    success: boolean;
    lecture_id: string;
    items: RefinementItem[];
    total: number;
  }>(`/api/lectures/${encodeURIComponent(lectureId)}/books/refinement/list`, {
    query: status ? { status } : undefined,
  });
}

export function getRefinementQueue() {
  return getJson<{ success: boolean; [key: string]: unknown }>("/api/refinement/queue");
}

export function enqueueLectureBooks(
  lectureId: string,
  bookIds: string[],
  options?: { actor?: string; force?: boolean },
) {
  return postJson<{ success: boolean; queued_count: number; error_count: number }>(
    `/api/lectures/${encodeURIComponent(lectureId)}/books/refinement`,
    {
      book_ids: bookIds,
      actor: options?.actor || "",
      force: !!options?.force,
    },
  );
}

export function enqueueSingleBook(
  lectureId: string,
  bookId: string,
  options?: { actor?: string; force?: boolean },
) {
  return postJson<{ success: boolean; lecture_id: string; book_id: string }>(
    `/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}/refinement`,
    {
      actor: options?.actor || "",
      force: !!options?.force,
    },
  );
}
