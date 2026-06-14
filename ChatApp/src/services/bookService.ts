import { deleteJson, getJson, patchJson, postJson, requestJson } from "./apiClient";
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

export function uploadBookFile(
  lectureId: string,
  bookId: string,
  payload: { uri: string; name: string; type?: string | null; file?: File },
) {
  const formData = new FormData();
  if (payload.file) {
    formData.append("file", payload.file, payload.name);
  } else {
    formData.append(
      "file",
      {
        uri: payload.uri,
        name: payload.name,
        type: payload.type || "application/octet-stream",
      } as unknown as Blob,
    );
  }

  return requestJson<{ success: boolean; book: Book; message?: string }>(
    `/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}/file`,
    {
      method: "POST",
      body: formData,
    },
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

export function saveBookInfo(lectureId: string, bookId: string, content: string) {
  return postJson<{ success: boolean; lecture_id: string; book_id: string; content?: string }>(
    `/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}/bookinfo`,
    { content },
  );
}

export function getBookDetail(lectureId: string, bookId: string) {
  return getJson<{ success: boolean; lecture_id: string; book_id: string; content: string }>(
    `/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}/bookdetail`,
  );
}

export function saveBookDetail(lectureId: string, bookId: string, content: string) {
  return postJson<{ success: boolean; lecture_id: string; book_id: string; content?: string }>(
    `/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}/bookdetail`,
    { content },
  );
}
