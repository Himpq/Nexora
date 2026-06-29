export type ReaderChapter = {
  name: string;
  range?: string;
  summary?: string;
  index?: number;
  detailXml?: string;
};

export type ReaderContext = {
  lectureId: string;
  bookId: string;
  lectureTitle?: string;
  bookTitle?: string;
  chapter?: ReaderChapter | null;
};

export type AssistantTabKey = "guide" | "ai" | "quiz" | "knowledge" | "progress";
