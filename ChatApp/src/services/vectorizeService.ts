import { getJson, postJson } from "./apiClient";

export function getBookVectorizeStatus(lectureId: string, bookId: string) {
  return getJson<{
    success: boolean;
    book_id: string;
    vector_status?: string;
    vector_provider?: string;
    chunks_count?: number;
    vector_count?: number;
    request_path?: string;
    error?: string;
    [key: string]: unknown;
  }>(`/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}/vectorize`);
}

export function triggerBookVectorize(
  lectureId: string,
  bookId: string,
  options?: { force?: boolean; async?: boolean },
) {
  return postJson<{ success: boolean; vectorization: unknown }>(
    `/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}/vectorize`,
    {
      force: !!options?.force,
      async: options?.async ?? true,
    },
  );
}
