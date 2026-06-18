import { getJson, postJson } from "./apiClient";

export type RefinementItem = {
  lecture_id?: string;
  lecture_title?: string;
  book_id?: string;
  book_title?: string;
  status?: string;
  [key: string]: unknown;
};

export type RefinementQueueSnapshot = {
  jobs?: Array<{
    lecture_id?: string;
    book_id?: string;
    status?: string;
    job_type?: string;
    [key: string]: unknown;
  }>;
  running_count?: number;
  [key: string]: unknown;
};

export type RefinementSettingsItem = RefinementItem & {
  refinement_status?: string;
  text_status?: string;
  coarse_status?: string;
  intensive_status?: string;
  question_status?: string;
  section_status?: string;
  coarse_model?: string;
  intensive_model?: string;
  question_model?: string;
  section_model?: string;
  coarse_error?: string;
  intensive_error?: string;
  question_error?: string;
  section_error?: string;
  refinement_error?: string;
  job_status?: string;
  section_job_status?: string;
  progress_text?: string;
  progress_steps?: string[];
  updated_at?: number;
};

export type RefinementSettingsResponse = {
  success: boolean;
  status_filter?: string;
  queue?: RefinementQueueSnapshot;
  items: RefinementSettingsItem[];
  total: number;
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

export function getRefinementSettings(status?: string) {
  return getJson<RefinementSettingsResponse>("/api/frontend/settings/refinement", {
    query: status ? { status } : undefined,
  });
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

export function startRefinement(
  lectureId: string,
  bookId: string,
  options?: { actor?: string; force?: boolean },
) {
  return postJson<{ success: boolean; lecture_id: string; book_id: string }>(
    "/api/frontend/settings/refinement/start",
    {
      lecture_id: lectureId,
      book_id: bookId,
      actor: options?.actor || "",
      force: !!options?.force,
    },
  );
}

export function startIntensiveRefinement(
  lectureId: string,
  bookId: string,
  options?: { actor?: string; modelName?: string },
) {
  return postJson<{ success: boolean; lecture_id: string; book_id: string }>(
    "/api/frontend/settings/refinement/intensive",
    {
      lecture_id: lectureId,
      book_id: bookId,
      actor: options?.actor || "",
      model_name: options?.modelName || "",
    },
  );
}

export function startSectionRefinement(
  lectureId: string,
  bookId: string,
  options?: { actor?: string; modelName?: string },
) {
  return postJson<{ success: boolean; lecture_id: string; book_id: string }>(
    "/api/frontend/settings/refinement/section",
    {
      lecture_id: lectureId,
      book_id: bookId,
      actor: options?.actor || "",
      model_name: options?.modelName || "",
    },
  );
}

export function stopRefinement(
  lectureId: string,
  bookId: string,
  options?: { actor?: string },
) {
  return postJson<{ success: boolean }>(
    "/api/frontend/settings/refinement/stop",
    {
      lecture_id: lectureId,
      book_id: bookId,
      actor: options?.actor || "",
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
