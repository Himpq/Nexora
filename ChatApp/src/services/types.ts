export type ApiSuccess = {
  success?: boolean;
  [key: string]: unknown;
};

export type ApiErrorPayload = {
  success?: false;
  error?: string;
  message?: string;
  [key: string]: unknown;
};

export type NexoraUser = {
  id?: string;
  username?: string;
  role?: string;
  avatar_url?: string;
  [key: string]: unknown;
};

export type IntegrationStatus = {
  base_url: string;
  endpoint: string;
  connected: boolean;
  models_count: number;
  message: string;
  has_public_api_key: boolean;
  [key: string]: unknown;
};

export type FrontendContext = {
  success: boolean;
  username: string;
  user: NexoraUser;
  is_admin: boolean;
  integration: IntegrationStatus;
  [key: string]: unknown;
};

export type Lecture = {
  id: string;
  title: string;
  description?: string;
  category?: string;
  status?: string;
  study_hours?: number;
  [key: string]: unknown;
};

export type Book = {
  id: string;
  title: string;
  description?: string;
  source_type?: string;
  status?: string;
  text_status?: string;
  vector_status?: string;
  [key: string]: unknown;
};

export type LectureRow = {
  lecture: Lecture;
  books: Book[];
  books_count: number;
  [key: string]: unknown;
};

export type MaterialsResponse = {
  success: boolean;
  lectures: LectureRow[];
  total_lectures: number;
  total_books: number;
  [key: string]: unknown;
};

export type DashboardResponse = {
  success: boolean;
  user_id: string;
  selected_lecture_ids: string[];
  lectures: LectureRow[];
  total_lectures: number;
  total_books: number;
  total_study_hours: number;
  [key: string]: unknown;
};

export type ModelOption = {
  id?: string;
  name?: string;
  model?: string;
  [key: string]: unknown;
};
