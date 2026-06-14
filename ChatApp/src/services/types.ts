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
  progress?: number;
  current_chapter?: string;
  next_chapter?: string;
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
  refinement_status?: string;
  coarse_status?: string;
  intensive_status?: string;
  section_status?: string;
  vector_status?: string;
  vector_provider?: string;
  chunks_count?: number;
  vector_count?: number;
  error?: string;
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

export type LearningSelectionResponse = {
  success: boolean;
  user_id: string;
  lecture?: Lecture;
  selected: boolean;
  selected_lecture_ids: string[];
  [key: string]: unknown;
};

export type ModelOption = {
  id?: string;
  name?: string;
  model?: string;
  [key: string]: unknown;
};

export type LearningRuntimeContext = {
  learning?: boolean;
  lecture_id?: string;
  system_prompt?: string;
  context_blocks?: Array<{
    type?: string;
    title?: string;
    content?: string;
    [key: string]: unknown;
  }>;
  active_tool_skills?: Array<{
    id?: string;
    title?: string;
    required_tools?: string[];
    mode?: string;
    author?: string;
    version?: string;
    main_content?: string;
    [key: string]: unknown;
  }>;
  cards?: Array<Record<string, unknown>>;
  meta?: {
    source?: string;
    selected_lecture_count?: number;
    total_books?: number;
    lecture_id?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type LearningChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LearningChatResponse = {
  success: boolean;
  content?: string;
  api_mode?: string;
  endpoint?: string;
  conversation_id?: string;
  username?: string;
  model?: string;
  raw?: unknown;
  resolved_prompts?: unknown;
  [key: string]: unknown;
};
