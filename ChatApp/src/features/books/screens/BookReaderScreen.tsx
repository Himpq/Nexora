import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { BookContentSection } from "../components/BookContentSection";
import { AppButton, AppText, Screen, spacing, StateView } from "../../../design";
import type { BookContentMode, RootStackParamList } from "../../../navigation/types";
import { getBookDetail, getBookInfo, getBookText } from "../../../services/bookService";
import type { Book } from "../../../services/types";

type BookReaderScreenProps = NativeStackScreenProps<RootStackParamList, "BookReader">;

type ReaderState = {
  book: Book | null;
  content: string;
};

type ModeConfig = {
  label: string;
  loadingTitle: string;
  sectionTitle: string;
  emptyTitle: string;
  emptyMessage: string;
};

const MODE_CONFIG: Record<BookContentMode, ModeConfig> = {
  text: {
    label: "原文",
    loadingTitle: "正在加载原文",
    sectionTitle: "教材原文",
    emptyTitle: "暂无原文",
    emptyMessage: "这本教材还没有可阅读的原文内容，请等待管理员上传或解析教材文件。",
  },
  bookinfo: {
    label: "概读",
    loadingTitle: "正在加载概读",
    sectionTitle: "概读 bookinfo",
    emptyTitle: "概读尚未生成",
    emptyMessage: "管理员还没有完成这本教材的概读提炼，请等待提炼处理。",
  },
  bookdetail: {
    label: "精读",
    loadingTitle: "正在加载精读",
    sectionTitle: "精读 bookdetail",
    emptyTitle: "精读尚未生成",
    emptyMessage: "管理员还没有完成这本教材的精读提炼，请等待提炼处理。",
  },
};

function normalizeError(err: unknown) {
  return err instanceof Error ? err : new Error(String(err || "Unknown error"));
}

function getBookTitle(book: Book | null, fallback?: string) {
  return String(book?.title || fallback || "").trim() || "未命名教材";
}

async function loadContent(lectureId: string, bookId: string, mode: BookContentMode) {
  if (mode === "text") {
    const result = await getBookText(lectureId, bookId);
    return {
      book: result.book || null,
      content: String(result.content || ""),
    };
  }
  if (mode === "bookinfo") {
    const result = await getBookInfo(lectureId, bookId);
    return {
      book: null,
      content: String(result.content || ""),
    };
  }
  const result = await getBookDetail(lectureId, bookId);
  return {
    book: null,
    content: String(result.content || ""),
  };
}

export function BookReaderScreen({ navigation, route }: BookReaderScreenProps) {
  const { lectureId, bookId, mode, bookTitle } = route.params;
  const config = MODE_CONFIG[mode];
  const [readerState, setReaderState] = useState<ReaderState>({
    book: null,
    content: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const title = useMemo(
    () => `${getBookTitle(readerState.book, bookTitle)} · ${config.label}`,
    [bookTitle, config.label, readerState.book],
  );

  const loadReader = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReaderState(await loadContent(lectureId, bookId, mode));
    } catch (err) {
      setReaderState({ book: null, content: "" });
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }, [bookId, lectureId, mode]);

  useEffect(() => {
    void loadReader();
  }, [loadReader]);

  useEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  if (loading) {
    return (
      <Screen>
        <StateView title={config.loadingTitle} message="正在读取教材内容..." loading />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <StateView
          title="教材内容加载失败"
          message={error.message}
          actionLabel="重试"
          onAction={() => void loadReader()}
        />
      </Screen>
    );
  }

  const content = readerState.content.trim();

  if (!content) {
    return (
      <Screen>
        <StateView
          title={config.emptyTitle}
          message={config.emptyMessage}
          actionLabel="刷新"
          onAction={() => void loadReader()}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <AppText variant="title">{config.label}</AppText>
          <AppText tone="secondary">{getBookTitle(readerState.book, bookTitle)}</AppText>
        </View>
        <AppButton title="刷新" variant="ghost" onPress={() => void loadReader()} />
      </View>

      <BookContentSection title={config.sectionTitle} content={content} />
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
});
