export type RootStackParamList = {
  MainTabs: undefined;
  CourseDetail: {
    lectureId: string;
    lectureTitle?: string;
  };
  BookDetail: {
    lectureId: string;
    bookId: string;
    lectureTitle?: string;
    bookTitle?: string;
  };
  BookReader: {
    lectureId: string;
    bookId: string;
    mode: BookContentMode;
    lectureTitle?: string;
    bookTitle?: string;
  };
};

export type MainTabParamList = {
  Dashboard: undefined;
  Courses: undefined;
  Chat: undefined;
  Settings: undefined;
};

export type BookContentMode = "text" | "bookinfo" | "bookdetail";
