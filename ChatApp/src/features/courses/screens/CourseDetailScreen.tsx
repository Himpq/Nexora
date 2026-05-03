import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { BookListItem } from "../../books/components/BookListItem";
import {
  AppButton,
  AppCard,
  AppText,
  Screen,
  spacing,
  StateView,
} from "../../../design";
import type { RootStackParamList } from "../../../navigation/types";
import { getLecture } from "../../../services/lectureService";
import type { Book, Lecture } from "../../../services/types";

type CourseDetailScreenProps = NativeStackScreenProps<RootStackParamList, "CourseDetail">;

function normalizeError(err: unknown) {
  return err instanceof Error ? err : new Error(String(err || "Unknown error"));
}

function getLectureTitle(lecture: Lecture | null, fallback?: string) {
  return String(lecture?.title || fallback || "").trim() || "未命名课程";
}

function getBookTitle(book: Book) {
  return String(book.title || "").trim() || "未命名教材";
}

export function CourseDetailScreen({ navigation, route }: CourseDetailScreenProps) {
  const { lectureId, lectureTitle } = route.params;
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const title = useMemo(
    () => getLectureTitle(lecture, lectureTitle),
    [lecture, lectureTitle],
  );

  const loadLecture = useCallback(async () => {
    const normalizedLectureId = String(lectureId || "").trim();
    setLoading(true);
    setError(null);
    if (!normalizedLectureId) {
      setLecture(null);
      setBooks([]);
      setError(new Error("缺少课程 ID，无法加载课程教材。"));
      setLoading(false);
      return;
    }

    try {
      const result = await getLecture(normalizedLectureId);
      setLecture(result.lecture || null);
      setBooks(result.books);
    } catch (err) {
      setLecture(null);
      setBooks([]);
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }, [lectureId]);

  useEffect(() => {
    void loadLecture();
  }, [loadLecture]);

  useEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  const openBook = useCallback(
    (book: Book) => {
      const bookId = String(book.id || "").trim();
      if (!bookId) {
        return;
      }
      navigation.navigate("BookDetail", {
        lectureId,
        lectureTitle: title,
        bookId,
        bookTitle: getBookTitle(book),
      });
    },
    [lectureId, navigation, title],
  );

  if (loading) {
    return (
      <Screen>
        <StateView title="正在加载课程" message="正在读取课程教材..." loading />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <StateView
          title="课程教材加载失败"
          message={error.message}
          actionLabel="重试"
          onAction={() => void loadLecture()}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <AppText variant="title">{title}</AppText>
          {lecture?.description ? (
            <AppText tone="secondary">{String(lecture.description)}</AppText>
          ) : (
            <AppText tone="secondary">查看课程下的教材和阅读内容。</AppText>
          )}
        </View>
        <AppButton title="刷新" variant="ghost" onPress={() => void loadLecture()} />
      </View>

      <AppCard style={styles.summaryCard}>
        <AppText variant="caption" tone="secondary">
          教材数量
        </AppText>
        <AppText variant="heading">{books.length} 本</AppText>
      </AppCard>

      <View style={styles.sectionHeader}>
        <AppText variant="heading">教材列表</AppText>
        <AppText variant="caption" tone="secondary">
          选择一本教材查看原文、概读和精读。
        </AppText>
      </View>

      {books.length === 0 ? (
        <StateView
          title="暂无教材"
          message="这门课程还没有可阅读的教材，请等待管理员上传。"
          actionLabel="刷新"
          onAction={() => void loadLecture()}
        />
      ) : (
        books.map((book) => {
          const bookId = String(book.id || "").trim();
          return (
            <BookListItem
              key={bookId || getBookTitle(book)}
              book={book}
              onPress={() => openBook(book)}
            />
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
  },
  titleBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  summaryCard: {
    gap: spacing.xs,
  },
  sectionHeader: {
    gap: spacing.xs,
  },
});
