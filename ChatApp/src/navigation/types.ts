import type { NavigatorScreenParams } from "@react-navigation/native";

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList>;
  AdminHome: undefined;
  BookUpload: undefined;
  RefinementQueue: undefined;
  Vectorize: undefined;
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
  Feed: undefined;
  Chat: undefined;
  Admin: undefined;
  Settings: undefined;
};

export type BookContentMode = "text" | "bookinfo" | "bookdetail";
