import { getJson, postJson } from "./apiClient";
import type { Book } from "./types";

export type VectorizeStatusResponse = {
  success: boolean;
  book_id: string;
  vector_status?: string;
  vector_provider?: string;
  chunks_count?: number;
  vector_count?: number;
  request_path?: string;
  error?: string;
  [key: string]: unknown;
};

export type VectorizeTriggerResult = {
  success?: boolean;
  queued?: boolean;
  status?: string;
  chunks_count?: number;
  vector_count?: number;
  library?: string;
  book?: Book;
  [key: string]: unknown;
};

export function getBookVectorizeStatus(lectureId: string, bookId: string) {
  return getJson<VectorizeStatusResponse>(
    `/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}/vectorize`,
  );
}

export function triggerBookVectorize(
  lectureId: string,
  bookId: string,
  options?: { force?: boolean; async?: boolean },
) {
  return postJson<{ success: boolean; vectorization: VectorizeTriggerResult }>(
    `/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}/vectorize`,
    {
      force: !!options?.force,
      async: options?.async ?? true,
    },
  );
}
