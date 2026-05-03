import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  AppButton,
  AppCard,
  AppText,
  colors,
  Screen,
  spacing,
  StateView,
} from "../../../design";
import type { BookContentMode, RootStackParamList } from "../../../navigation/types";
import { getBook } from "../../../services/bookService";
import type { Book } from "../../../services/types";

type BookDetailScreenProps = NativeStackScreenProps<RootStackParamList, "BookDetail">;

type ContentAction = {
  mode: BookContentMode;
  title: string;
  description: string;
};

const CONTENT_ACTIONS: ContentAction[] = [
  {
    mode: "text",
    title: "原文",
    description: "查看教材已上传或解析后的全文内容。",
  },
  {
    mode: "bookinfo",
    title: "概读",
    description: "查看管理员提炼生成的 bookinfo 内容。",
  },
  {
    mode: "bookdetail",
    title: "精读",
    description: "查看管理员提炼生成的 bookdetail 内容。",
  },
];

function normalizeError(err: unknown) {
  return err instanceof Error ? err : new Error(String(err || "Unknown error"));
}

function getBookTitle(book: Book | null, fallback?: string) {
  return String(book?.title || fallback || "").trim() || "未命名教材";
}

function getBookMeta(book: Book | null) {
  if (!book) {
    return "";
  }
  return [
    String(book.source_type || "").trim(),
    String(book.text_status || "").trim(),
    String(book.status || "").trim(),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function BookDetailScreen({ navigation, route }: BookDetailScreenProps) {
  const { lectureId, lectureTitle, bookId, bookTitle } = route.params;
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const title = useMemo(() => getBookTitle(book, bookTitle), [book, bookTitle]);
  const meta = useMemo(() => getBookMeta(book), [book]);

  const loadBook = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getBook(lectureId, bookId);
      setBook(result.book || null);
    } catch (err) {
      setBook(null);
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }, [bookId, lectureId]);

  useEffect(() => {
    void loadBook();
  }, [loadBook]);

  useEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  const openReader = useCallback(
    (mode: BookContentMode) => {
      navigation.navigate("BookReader", {
        lectureId,
        lectureTitle,
        bookId,
        bookTitle: title,
        mode,
      });
    },
    [bookId, lectureId, lectureTitle, navigation, title],
  );

  if (loading) {
    return (
      <Screen>
        <StateView title="正在加载教材" message="正在读取教材详情..." loading />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <StateView
          title="教材加载失败"
          message={error.message}
          actionLabel="重试"
          onAction={() => void loadBook()}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <AppText variant="title">{title}</AppText>
          {meta ? (
            <AppText variant="caption" tone="secondary">
              {meta}
            </AppText>
          ) : null}
        </View>
        <AppButton title="刷新" variant="ghost" onPress={() => void loadBook()} />
      </View>

      {book?.description ? (
        <AppCard>
          <AppText tone="secondary">{String(book.description)}</AppText>
        </AppCard>
      ) : null}

      <View style={styles.sectionHeader}>
        <AppText variant="heading">阅读内容</AppText>
        <AppText variant="caption" tone="secondary">
          原文、概读和精读分别独立加载。
        </AppText>
      </View>

      {CONTENT_ACTIONS.map((action) => (
        <AppCard key={action.mode} style={styles.actionCard}>
          <View style={styles.actionCopy}>
            <AppText variant="heading">{action.title}</AppText>
            <AppText tone="secondary">{action.description}</AppText>
          </View>
          <AppButton title="打开" onPress={() => openReader(action.mode)} style={styles.actionButton} />
        </AppCard>
      ))}

      <AppCard style={styles.noteCard}>
        <AppText variant="caption" tone="secondary">
          概读和精读由管理员提炼生成。尚未生成时，阅读页会显示等待处理状态。
        </AppText>
      </AppCard>
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
  sectionHeader: {
    gap: spacing.xs,
  },
  actionCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  actionCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  actionButton: {
    minWidth: 88,
  },
  noteCard: {
    backgroundColor: colors.surfaceMuted,
  },
});
