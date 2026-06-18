import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { BookContentSection } from "../components/BookContentSection";
import {
  AppButton,
  AppCard,
  AppText,
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

type BookReaderScreenProps = NativeStackScreenProps<RootStackParamList, "BookReader">;

type ReaderState = {
  book: Book | null;
  content: string;
};

type ParsedChapter = {
  index: number;
  name: string;
  range: string;
  summary?: string;
  detailXml?: string;
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

function getBookTitle(book: Book | null, fallback?: string) {
  return String(book?.title || fallback || "").trim() || "未命名教材";
}

function parseChapters(content: string) {
  const chapters: ParsedChapter[] = [];
  const source = String(content || "");
  const blockPattern = /<chapter(?:\s[^>]*)?>([\s\S]*?)<\/chapter>/gi;
  const namedPattern =
    /<chapter_name>\s*([\s\S]*?)\s*<\/chapter_name>[\s\S]*?<chapter_range>\s*([\s\S]*?)\s*<\/chapter_range>[\s\S]*?(?:<chapter_summary>\s*([\s\S]*?)\s*<\/chapter_summary>)?/gi;

  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockPattern.exec(source))) {
    const block = String(blockMatch[0] || "");
    const name = String(block.match(/<chapter_name>\s*([\s\S]*?)\s*<\/chapter_name>/i)?.[1] || "").trim();
    const range = String(block.match(/<chapter_range>\s*([\s\S]*?)\s*<\/chapter_range>/i)?.[1] || "").trim();
    if (!name || !range) {
      continue;
    }
    chapters.push({
      index: chapters.length,
      name,
      range,
      summary: String(block.match(/<chapter_summary>\s*([\s\S]*?)\s*<\/chapter_summary>/i)?.[1] || "").trim(),
      detailXml: block,
    });
  }

  if (chapters.length > 0) {
    return chapters;
  }

  let match: RegExpExecArray | null;
  while ((match = namedPattern.exec(source))) {
    const name = String(match[1] || "").trim();
    const range = String(match[2] || "").trim();
    if (!name || !range) {
      continue;
    }
    chapters.push({
      index: chapters.length,
      name,
      range,
      summary: String(match[3] || "").trim(),
    });
  }
  return chapters;
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

  const title = useMemo(
    () => `${getBookTitle(readerState.book, bookTitle)} · ${config.label}`,
    [bookTitle, config.label, readerState.book],
  );
  const parsedChapters = useMemo(
    () => (mode === "bookinfo" || mode === "bookdetail" ? parseChapters(readerState.content) : []),
    [mode, readerState.content],
  );
  const firstChapter = parsedChapters[0] || null;

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
    } catch (err) {
      setChapterCompleteError(normalizeError(err));
    } finally {
      setChapterCompleteLoading(false);
    }
  }, [bookId, firstChapter, lectureId]);

  useEffect(() => {
    void loadReader();
  }, [loadReader]);

  useEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  if (loading) {
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

  const content = readerState.content.trim();

  if (!content) {
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
    <Screen scroll>
      <ScreenHeader
        overline={config.label}
        title={getBookTitle(readerState.book, bookTitle)}
        trailing={<AppButton title="刷新" variant="ghost" size="sm" onPress={() => void loadReader()} />}
      />

      {firstChapter ? (
        <AppCard variant="muted" style={styles.chapterCard}>
          <View style={styles.chapterCopy}>
            <AppText variant="overline" tone="tertiary">
              章节进度
            </AppText>
            <AppText variant="bodyStrong">{firstChapter.name}</AppText>
            <AppText variant="caption" tone="tertiary">
              range: {firstChapter.range}
            </AppText>
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
          </View>
          <AppButton
            title="标记完成"
            size="sm"
            variant="outline"
            loading={chapterCompleteLoading}
            onPress={() => void handleCompleteChapter()}
            style={styles.chapterButton}
          />
        </AppCard>
      ) : null}

      <BookContentSection title={config.sectionTitle} content={content} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chapterCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  chapterCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  chapterButton: {
    minWidth: 96,
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
