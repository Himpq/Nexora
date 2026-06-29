import { getJson, postJson } from "./apiClient";

/** ─────────────────────────────────────────────
 *  Reading telemetry
 *  Backend: /api/telemetry/*  (NexoraLearning/api/telemetry.py)
 *
 *  The `reading` stream columns:
 *    ts, uid, bid, ci, si, event, scroll, focus, sel_text, extra
 *  where `event` ∈ {snapshot, scroll, selection, focus_in, focus_out}
 *  and `scroll` is a 0~1 ratio.
 *
 *  NOTE: the ingest route resolves the user from the request BODY
 *  (`user_id` field), NOT from the X-Nexora-Username header — so every
 *  ingest call must pass `user_id` explicitly. The query routes take the
 *  user_id in the path.
 *  ───────────────────────────────────────────── */

export type ReadingTelemetryEvent = {
  stream: "reading";
  /** Unix seconds. Omit to let the backend stamp `now`. */
  ts?: number;
  /** Book id. */
  bid: string;
  /** Lecture id (carried in `extra` for context — not a native column). */
  lid?: string;
  /** Chapter index (string). */
  ci?: number | string;
  /** Section index (string). */
  si?: number | string;
  event: "snapshot" | "scroll" | "selection" | "focus_in" | "focus_out";
  /** Scroll ratio 0~1. */
  scroll?: number;
  /** Focus target: reader | chat | blur. */
  focus?: string;
  /** Selected text (for `selection` events). */
  sel_text?: string;
};

type IngestResponse = {
  success: boolean;
  result?: { accepted: number; rejected: number; per_stream: Record<string, number> };
  error?: string;
};

/**
 * Batch-ingest reading telemetry events. Fire-and-forget by design —
 * telemetry must never block reading or surface errors to the user.
 * Returns true on success, false on any failure.
 */
export async function postReadingEvents(
  username: string,
  events: ReadingTelemetryEvent[],
): Promise<boolean> {
  const uid = String(username || "").trim();
  if (!uid || !events.length) {
    return false;
  }
  // Map `lid` (lecture id) into the `extra` JSON blob, since the reading
  // stream has no native lecture column.
  const normalised = events.map((evt) => {
    const { lid, ...rest } = evt;
    if (!lid) return rest;
    return { ...rest, extra: { lecture_id: String(lid) } };
  });
  try {
    await postJson<IngestResponse>("/api/telemetry/ingest", {
      user_id: uid,
      events: normalised,
    });
    return true;
  } catch {
    return false;
  }
}

type QueryReadingResponse = {
  success: boolean;
  rows?: Array<Record<string, string>>;
  count?: number;
  error?: string;
};

/**
 * Return the last recorded `scroll` ratio (0~1) for a book, or null when
 * none exists. Used as a cross-device fallback for scroll-position restore
 * (the primary source is local AsyncStorage).
 *
 * The query returns rows in chronological order (oldest first), so we take
 * the last row whose `bid` matches.
 */
export async function getLastScrollRatio(
  username: string,
  bookId: string,
): Promise<number | null> {
  const uid = String(username || "").trim();
  const bid = String(bookId || "").trim();
  if (!uid || !bid) {
    return null;
  }
  try {
    const result = await getJson<QueryReadingResponse>(
      `/api/telemetry/${encodeURIComponent(uid)}/query/reading`,
      { query: { event: "scroll", limit: 500 } },
    );
    const rows = Array.isArray(result.rows) ? result.rows : [];
    let last: number | null = null;
    for (const row of rows) {
      if (String(row.bid || "").trim() !== bid) continue;
      const value = Number(row.scroll);
      if (Number.isFinite(value)) {
        last = Math.max(0, Math.min(1, value));
      }
    }
    return last;
  } catch {
    return null;
  }
}
