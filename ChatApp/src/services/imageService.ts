import { getJson, learningApiClient } from "./apiClient";

export type CoverAsset = {
  asset_key?: string;
  lecture_id?: string;
  book_id?: string;
  book_title?: string;
  image_id?: string;
  name?: string;
  file_name?: string;
  source_path?: string;
  mime_type?: string;
  size?: number;
  alt?: string;
  cover_path?: string;
  image_url?: string;
  [key: string]: unknown;
};

export type CoverAssetsResponse = {
  success: boolean;
  items: CoverAsset[];
  total: number;
  [key: string]: unknown;
};

const ABSOLUTE_URL_PATTERN = /^[a-z][a-z\d+\-.]*:\/\//i;
const LOCALHOST_HOSTS = new Set(["127.0.0.1", "localhost", "0.0.0.0", "::1"]);

/**
 * Resolve a relative `/api/...` path returned by the Nexora Learning backend
 * to a fully-qualified URL the React Native `<Image>` component can load.
 *
 * - Absolute URLs are returned as-is.
 * - Relative paths are joined onto the learning API client's current baseUrl.
 * - When the base URL is empty / loopback we still emit the path so callers
 *   can fall back to local dev defaults.
 */
export function resolveLearningAssetUrl(path?: string | null): string {
  const value = String(path || "").trim();
  if (!value) return "";
  if (ABSOLUTE_URL_PATTERN.test(value)) {
    return value;
  }
  const normalizedPath = value.startsWith("/") ? value : `/${value}`;
  const baseUrl = String(learningApiClient.getState().baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (!baseUrl) {
    return normalizedPath;
  }
  return `${baseUrl}${normalizedPath}`;
}

/**
 * Avatar URLs returned by the Nexora portal can be relative (`/static/...`)
 * or absolute. Match the web frontend behaviour: absolute URLs pass through,
 * relative URLs only get the base host prepended when the host isn't a local
 * loopback (which would never resolve from a phone).
 */
export function resolveAvatarUrl(rawUrl?: string | null): string {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  if (ABSOLUTE_URL_PATTERN.test(value)) {
    return value;
  }
  const baseUrl = String(learningApiClient.getState().baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (!baseUrl) {
    return value.startsWith("/") ? value : `/${value}`;
  }
  try {
    const parsed = new URL(baseUrl);
    const host = String(parsed.hostname || "").trim().toLowerCase();
    if (host && !LOCALHOST_HOSTS.has(host)) {
      const normalizedPath = value.startsWith("/") ? value : `/${value}`;
      return `${baseUrl}${normalizedPath}`;
    }
  } catch (_err) {
    /* fall through */
  }
  return value;
}

export function listLectureCoverAssets(lectureId: string) {
  return getJson<CoverAssetsResponse>(
    `/api/lectures/${encodeURIComponent(lectureId)}/cover-assets`,
  );
}

export function listBookCoverAssets(lectureId: string, bookId: string) {
  return getJson<CoverAssetsResponse>(
    `/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}/cover-assets`,
  );
}

/**
 * Build the URL of an image embedded in a book (used by the rough/intensive
 * reading rendering). Mirrors `/lectures/<id>/books/<bid>/images/<imageId>`.
 */
export function buildBookImageUrl(lectureId: string, bookId: string, imageId: string) {
  if (!lectureId || !bookId || !imageId) return "";
  return resolveLearningAssetUrl(
    `/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}/images/${encodeURIComponent(imageId)}`,
  );
}

/**
 * Pick the best cover URI to render for a lecture.
 * Falls back to the first book cover asset when the lecture itself has no
 * `cover_path`, matching the behaviour of the web learning panel.
 */
export function getLectureCoverUri(lecture: {
  cover_path?: unknown;
  cover?: unknown;
} | null | undefined): string {
  if (!lecture) return "";
  const direct = String(
    (lecture as { cover_path?: unknown }).cover_path
      || (lecture as { cover?: unknown }).cover
      || "",
  ).trim();
  return resolveLearningAssetUrl(direct);
}

export function getBookCoverUri(book: {
  cover_path?: unknown;
  cover?: unknown;
  image_url?: unknown;
} | null | undefined): string {
  if (!book) return "";
  const direct = String(
    (book as { cover_path?: unknown }).cover_path
      || (book as { cover?: unknown }).cover
      || (book as { image_url?: unknown }).image_url
      || "",
  ).trim();
  return resolveLearningAssetUrl(direct);
}

/**
 * Pick the most appropriate cover from a list returned by `cover-assets`.
 */
export function pickPrimaryCoverUri(items: CoverAsset[] | undefined | null): string {
  if (!Array.isArray(items) || items.length === 0) return "";
  const first = items.find((item) => {
    const value = String(item?.cover_path || item?.image_url || "").trim();
    return Boolean(value);
  });
  return first ? resolveLearningAssetUrl(String(first.cover_path || first.image_url || "")) : "";
}
