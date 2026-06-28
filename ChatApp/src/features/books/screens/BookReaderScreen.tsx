import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  StyleSheet,
  View,
} from "react-native";

import { BookContentSection } from "../components/BookContentSection";
import { parseBookContent, firstChapterOf } from "../utils/parseBookContent";
import {
  AppButton,
  AppCard,
  AppText,
  colors,
  ProgressBar,
  radius,
  Screen,
  ScreenHeader,
  Skeleton,
  SkeletonLine,
  spacing,
  StateView,
} from "../../../design";
import type { BookContentMode, RootStackParamList } from "../../../navigation/types";
import { getBookDetail, getBookInfo, getBookText } from "../../../services/bookService";
import { completeLearningChapter } from "../../../services/frontendService";
import type { Book } from "../../../services/types";
import { normalizeError } from "../../../utils/errors";
import { FloatingAssistant } from "../../reading/FloatingAssistant";
import type { ReaderContext } from "../../reading/types";

type BookReaderScreenProps = NativeStackScreenProps<RootStackParamList, "BookReader">;

type ReaderState = {
  book: Book | null;
  content: string;
};

type ModeConfig = {
  label: string;
  loadingTitle: string;
  emptyTitle: string;
  emptyMessage: string;
};

const MODE_CONFIG: Record<BookContentMode, ModeConfig> = {
  text: {
    label: "原文",
    loadingTitle: "正在加载原文",
    emptyTitle: "暂无原文",
    emptyMessage: "这本教材还没有可阅读的原文内容。",
  },
  bookinfo: {
    label: "概读",
    loadingTitle: "正在加载概读",
    emptyTitle: "概读尚未生成",
    emptyMessage: "概读内容尚未生成，请稍后再来。",
  },
  bookdetail: {
    label: "精读",
    loadingTitle: "正在加载精读",
    emptyTitle: "精读尚未生成",
    emptyMessage: "精读内容尚未生成，请稍后再来。",
  },
};

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
  const [chapterCompleteLoading, setChapterCompleteLoading] = useState(false);
  const [chapterCompleteError, setChapterCompleteError] = useState<Error | null>(null);
  const [chapterCompleteMessage, setChapterCompleteMessage] = useState("");
  const [readProgress, setReadProgress] = useState(0);
  const lastPctRef = useRef(0);

  const bookTitleResolved = useMemo(
    () => getBookTitle(readerState.book, bookTitle),
    [bookTitle, readerState.book],
  );
  const parsed = useMemo(
    () => parseBookContent(readerState.content, mode),
    [readerState.content, mode],
  );
  const firstChapter = useMemo(() => firstChapterOf(parsed), [parsed]);
  const hasContent =
    parsed.kind === "chapters"
      ? parsed.chapters.some((c) => c.paragraphs.length > 0 || c.name)
      : parsed.paragraphs.length > 0;

  const readerContext: ReaderContext = useMemo(
    () => ({
      lectureId,
      bookId,
      lectureTitle: route.params.lectureTitle,
      bookTitle: bookTitleResolved,
      chapter: firstChapter
        ? {
            name: firstChapter.name,
            range: firstChapter.range,
            summary: firstChapter.summary,
            index: firstChapter.index,
            detailXml: firstChapter.detailXml,
          }
        : null,
    }),
    [lectureId, bookId, route.params.lectureTitle, bookTitleResolved, firstChapter],
  );

  const loadReader = useCallback(async () => {
    setLoading(true);
    setError(null);
    setChapterCompleteError(null);
    setChapterCompleteMessage("");
    try {
      setReaderState(await loadContent(lectureId, bookId, mode));
      lastPctRef.current = 0;
      setReadProgress(0);
    } catch (err) {
      setReaderState({ book: null, content: "" });
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }, [bookId, lectureId, mode]);

  const handleCompleteChapter = useCallback(async () => {
    if (!firstChapter) {
      return;
    }
    setChapterCompleteLoading(true);
    setChapterCompleteError(null);
    setChapterCompleteMessage("");
    try {
      const result = await completeLearningChapter({
        lecture_id: lectureId,
        book_id: bookId,
        chapter_name: firstChapter.name,
        chapter_range: firstChapter.range,
        chapter_context: firstChapter.summary || "",
        chapter_detail_xml: firstChapter.detailXml || "",
      });
      setChapterCompleteMessage(result.already_completed ? "该章节此前已完成。" : "章节完成已记录。");
    } catch (err) {
      setChapterCompleteError(normalizeError(err));
    } finally {
      setChapterCompleteLoading(false);
    }
  }, [bookId, firstChapter, lectureId]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const scrollable = contentSize.height - layoutMeasurement.height;
    if (scrollable <= 0) {
      return;
    }
    const pct = Math.max(0, Math.min(100, (contentOffset.y / scrollable) * 100));
    const rounded = Math.round(pct);
    if (rounded !== lastPctRef.current) {
      lastPctRef.current = rounded;
      setReadProgress(rounded);
    }
  }, []);

  useEffect(() => {
    void loadReader();
  }, [loadReader]);

  if (loading && !readerState.content) {
    return (
      <Screen scroll>
        <Skeleton width="50%" height={26} style={styles.skTitle} />
        <Skeleton height={88} borderRadius={radius.lg} style={styles.skTitle} />
        <AppCard style={styles.skBody}>
          <Skeleton width="40%" height={12} />
          <View style={styles.skLines}>
            <SkeletonLine />
            <SkeletonLine />
            <SkeletonLine width="92%" />
            <SkeletonLine width="96%" />
            <SkeletonLine width="60%" last />
          </View>
        </AppCard>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <StateView
          icon="alert-triangle"
          title="教材内容加载失败"
          message={error.message}
          actionLabel="重试"
          onAction={() => void loadReader()}
        />
      </Screen>
    );
  }

  if (!hasContent && !readerState.content.trim()) {
    return (
      <Screen>
        <StateView
          icon="inbox"
          title={config.emptyTitle}
          message={config.emptyMessage}
          actionLabel="刷新"
          onAction={() => void loadReader()}
        />
      </Screen>
    );
  }

  return (
    <View style={styles.readerRoot}>
      <Screen>
        <ScreenHeader
          title={bookTitleResolved}
          onBack={() => navigation.goBack()}
          trailing={<View style={styles.modePill}><AppText variant="label">{config.label}</AppText></View>}
        />
        <ProgressBar value={readProgress} height={3} style={styles.readProgress} />

        {firstChapter ? (
          <View style={styles.chapterBar}>
            <AppText variant="caption" tone="tertiary" numberOfLines={1} style={styles.chapterName}>
              {firstChapter.name}
              {firstChapter.range ? ` · ${firstChapter.range}` : ""}
            </AppText>
            <AppButton
              title="标记完成"
              size="sm"
              variant="outline"
              loading={chapterCompleteLoading}
              onPress={() => void handleCompleteChapter()}
            />
          </View>
        ) : null}

        {chapterCompleteMessage ? (
          <AppText variant="caption" tone="success">
            {chapterCompleteMessage}
          </AppText>
        ) : null}
        {chapterCompleteError ? (
          <AppText variant="caption" tone="danger">
            {chapterCompleteError.message}
          </AppText>
        ) : null}

        <BookContentSection
          parsed={parsed}
          onScroll={handleScroll}
          refreshing={loading}
          onRefresh={() => void loadReader()}
          style={styles.content}
        />
      </Screen>

      <FloatingAssistant context={readerContext} />
    </View>
  );
}

const styles = StyleSheet.create({
  readerRoot: {
    flex: 1,
  },
  readProgress: {
    marginVertical: 0,
  },
  content: {
    flex: 1,
  },
  modePill: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chapterBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  chapterName: {
    flex: 1,
  },
  skTitle: {
    marginBottom: spacing.lg,
  },
  skBody: {
    gap: spacing.md,
  },
  skLines: {
    gap: 0,
  },
});
