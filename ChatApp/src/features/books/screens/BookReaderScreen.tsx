import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  StyleSheet,
  View,
} from "react-native";

import { useSession } from "../../../app/providers/SessionProvider";
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
import {
  getLearningReport,
  type LearningReportResponse,
} from "../../../services/learningContentService";
import {
  getLastScrollRatio,
  postReadingEvents,
  type ReadingTelemetryEvent,
} from "../../../services/readingTelemetryService";
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

/** Extract the per-user lecture progress from a learning report. */
function readReportProgress(report: LearningReportResponse | null | undefined) {
  const summary = (report?.summary ?? {}) as { progress_percent?: unknown };
  const progressInfo = (report?.progress ?? {}) as {
    current_chapter?: unknown;
    next_chapter?: unknown;
  };
  const raw = Number(summary.progress_percent);
  const progress = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 0;
  return {
    progress,
    currentChapter: String(progressInfo.current_chapter || "").trim(),
    nextChapter: String(progressInfo.next_chapter || "").trim(),
  };
}

function clampRatio(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
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
  const { username } = useSession();
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
  const [serverProgress, setServerProgress] = useState(0);
  const [restoreRatio, setRestoreRatio] = useState<number | null>(null);

  // Live scroll ratio (0~1) — drives telemetry + persistence, NOT the
  // progress bar (which shows server-side per-user progress).
  const scrollRatioRef = useRef(0);
  const lastPersistRatioRef = useRef<number | null>(null);
  const lastPersistAtRef = useRef(0);
  // Chapter index for telemetry, kept in a ref so the lifecycle effect
  // doesn't re-run (and resend focus_in/focus_out) when content loads.
  const chapterIndexRef = useRef(0);

  const bookTitleResolved = useMemo(
    () => getBookTitle(readerState.book, bookTitle),
    [bookTitle, readerState.book],
  );
  const parsed = useMemo(
    () => parseBookContent(readerState.content, mode),
    [readerState.content, mode],
  );
  const firstChapter = useMemo(() => firstChapterOf(parsed), [parsed]);
  useEffect(() => {
    chapterIndexRef.current = firstChapter?.index ?? 0;
  }, [firstChapter?.index]);
  const hasContent =
    parsed.kind === "chapters"
      ? parsed.chapters.some((c) => c.paragraphs.length > 0 || c.name)
      : parsed.paragraphs.length > 0;

  const scrollStorageKey = `readingScroll:${lectureId}:${bookId}:${mode}`;

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

  const loadProgress = useCallback(async () => {
    try {
      const report = await getLearningReport({ lecture_id: lectureId });
      setServerProgress(readReportProgress(report).progress);
    } catch {
      // Progress is best-effort; leave the last known value.
    }
  }, [lectureId]);

  const loadReader = useCallback(async () => {
    setLoading(true);
    setError(null);
    setChapterCompleteError(null);
    setChapterCompleteMessage("");
    try {
      setReaderState(await loadContent(lectureId, bookId, mode));
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
      // Chapter completion changes per-user progress — resync the bar.
      void loadProgress();
    } catch (err) {
      setChapterCompleteError(normalizeError(err));
    } finally {
      setChapterCompleteLoading(false);
    }
  }, [bookId, firstChapter, lectureId, loadProgress]);

  const emitScroll = useCallback(
    (ratio: number) => {
      const now = Date.now();
      const last = lastPersistRatioRef.current;
      const delta = last == null ? 1 : Math.abs(ratio - last);
      const stale = now - lastPersistAtRef.current >= 5000;
      if (!stale && delta < 0.05) {
        return;
      }
      lastPersistRatioRef.current = ratio;
      lastPersistAtRef.current = now;
      void AsyncStorage.setItem(scrollStorageKey, String(ratio)).catch(() => undefined);
      if (!username) return;
      const event: ReadingTelemetryEvent = {
        stream: "reading",
        ts: Math.floor(now / 1000),
        bid: bookId,
        lid: lectureId,
        ci: chapterIndexRef.current,
        si: "",
        event: "scroll",
        scroll: ratio,
        focus: "reader",
      };
      void postReadingEvents(username, [event]);
    },
    [bookId, lectureId, scrollStorageKey, username],
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
      const scrollable = contentSize.height - layoutMeasurement.height;
      if (scrollable <= 0) {
        return;
      }
      const ratio = clampRatio(contentOffset.y / scrollable);
      scrollRatioRef.current = ratio;
      emitScroll(ratio);
    },
    [emitScroll],
  );

  // Initial load: content + server progress + scroll-position restore.
  useEffect(() => {
    void loadReader();
    void loadProgress();
  }, [loadReader, loadProgress]);

  // Restore last scroll position: local AsyncStorage first (exact), then
  // the telemetry stream as a cross-device fallback.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let ratio: number | null = null;
      try {
        const stored = await AsyncStorage.getItem(scrollStorageKey);
        if (stored != null) {
          const parsedRatio = Number(stored);
          if (Number.isFinite(parsedRatio)) {
            ratio = clampRatio(parsedRatio);
          }
        }
      } catch {
        // ignore
      }
      if (ratio == null && username) {
        ratio = await getLastScrollRatio(username, bookId);
      }
      if (!cancelled && ratio != null) {
        setRestoreRatio(ratio);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, scrollStorageKey, username]);

  // Telemetry lifecycle: focus_in on mount, snapshot heartbeat every 10s,
  // focus_out on unmount. Fire-and-forget.
  useEffect(() => {
    if (!username) return;
    const mk = (event: ReadingTelemetryEvent["event"]): ReadingTelemetryEvent => ({
      stream: "reading",
      ts: Math.floor(Date.now() / 1000),
      bid: bookId,
      lid: lectureId,
      ci: chapterIndexRef.current,
      si: "",
      event,
      scroll: scrollRatioRef.current,
      focus: "reader",
    });
    void postReadingEvents(username, [mk("focus_in")]);
    const interval = setInterval(() => {
      void postReadingEvents(username, [mk("snapshot")]);
    }, 10000);
    return () => {
      clearInterval(interval);
      void postReadingEvents(username, [mk("focus_out")]);
    };
  }, [bookId, lectureId, username]);

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
        <ProgressBar value={serverProgress} height={3} style={styles.readProgress} />

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
          restoreScrollRatio={restoreRatio}
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
