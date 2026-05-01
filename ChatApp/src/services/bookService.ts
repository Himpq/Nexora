import { deleteJson, getJson, patchJson, postJson } from "./apiClient";
import type { Book } from "./types";

export function listBooks(lectureId: string) {
  return getJson<{ success: boolean; books: Book[]; total: number }>(
    `/api/lectures/${encodeURIComponent(lectureId)}/books`,
  );
}

export function createBook(
  lectureId: string,
  payload: {
    title: string;
    description?: string;
    source_type?: string;
    cover_path?: string;
  },
) {
  return postJson<{ success: boolean; book: Book }>(
    `/api/lectures/${encodeURIComponent(lectureId)}/books`,
    payload,
  );
}

export function getBook(lectureId: string, bookId: string) {
  return getJson<{ success: boolean; book: Book }>(
    `/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}`,
  );
}

export function updateBook(lectureId: string, bookId: string, payload: Partial<Book>) {
  return patchJson<{ success: boolean; book: Book }>(
    `/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}`,
    payload,
  );
}

export function deleteBook(lectureId: string, bookId: string) {
  return deleteJson<{ success: boolean; book: Book }>(
    `/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}`,
  );
}

export function getBookText(lectureId: string, bookId: string) {
  return getJson<{ success: boolean; book: Book; content: string; chars: number }>(
    `/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}/text`,
  );
}

export function getBookInfo(lectureId: string, bookId: string) {
  return getJson<{ success: boolean; lecture_id: string; book_id: string; content: string }>(
    `/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}/bookinfo`,
  );
}

export function getBookDetail(lectureId: string, bookId: string) {
  return getJson<{ success: boolean; lecture_id: string; book_id: string; content: string }>(
    `/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}/bookdetail`,
  );
}
