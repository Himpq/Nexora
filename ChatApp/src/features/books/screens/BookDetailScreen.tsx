import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import {
  AnimatedPressable,
  AppButton,
  AppCard,
  AppText,
  colors,
  FadeIn,
  ProgressBar,
  radius,
  Screen,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  spacing,
  StateView,
} from "../../../design";
import type { BookContentMode, RootStackParamList } from "../../../navigation/types";
import { getBook } from "../../../services/bookService";
import {
  getLearningReport,
  type LearningReportResponse,
} from "../../../services/learningContentService";
import {
  generateKnowledgeGraph,
  getKnowledgeGraph,
  type KnowledgeGraphNode,
  type KnowledgeGraphResponse,
} from "../../../services/learningExperienceService";
import type { Book } from "../../../services/types";
import { normalizeError } from "../../../utils/errors";

type BookDetailScreenProps = NativeStackScreenProps<RootStackParamList, "BookDetail">;

type ContentAction = {
  mode: BookContentMode;
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description: string;
};

const CONTENT_ACTIONS: ContentAction[] = [
  {
    mode: "text",
    icon: "file-text",
    title: "原文",
    description: "教材完整全文",
  },
  {
    mode: "bookinfo",
    icon: "book-open",
    title: "概读",
    description: "快速把握全书要点的概览",
  },
  {
    mode: "bookdetail",
    icon: "layers",
    title: "精读",
    description: "逐章深入的精细解读",
  },
];

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

/** Extract per-user lecture progress from a learning report. */
function readReportProgress(report: LearningReportResponse | null | undefined) {
  const summary = (report?.summary ?? {}) as { progress_percent?: unknown };
  const progressInfo = (report?.progress ?? {}) as { current_chapter?: unknown };
  const raw = Number(summary.progress_percent);
  const progress = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 0;
  return {
    progress,
    currentChapter: String(progressInfo.current_chapter || "").trim(),
  };
}

function getGraphChapters(graph: KnowledgeGraphResponse["graph"] | null | undefined) {
  if (!graph) {
    return [];
  }
  if (Array.isArray(graph.chapters)) {
    return graph.chapters;
  }
  if (Array.isArray(graph.nodes)) {
    return graph.nodes;
  }
  return [];
}

function getNodeTitle(node: KnowledgeGraphNode) {
  return String(node.title || node.name || node.label || node.id || "").trim() || "未命名知识点";
}

function getNodeChildren(node: KnowledgeGraphNode) {
  if (Array.isArray(node.children)) {
    return node.children;
  }
  if (Array.isArray(node.concepts)) {
    return node.concepts;
  }
  if (Array.isArray(node.key_points)) {
    return node.key_points;
  }
  return [];
}

export function BookDetailScreen({ navigation, route }: BookDetailScreenProps) {
  const { lectureId, lectureTitle, bookId, bookTitle } = route.params;
  const [book, setBook] = useState<Book | null>(null);
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraphResponse["graph"] | null>(null);
  const [graphCached, setGraphCached] = useState(false);
  const [graphLoading, setGraphLoading] = useState(true);
  const [graphGenerating, setGraphGenerating] = useState(false);
  const [graphError, setGraphError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lectureProgress, setLectureProgress] = useState({ progress: 0, currentChapter: "" });

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

  const loadKnowledgeGraph = useCallback(async () => {
    setGraphLoading(true);
    setGraphError(null);
    try {
      const result = await getKnowledgeGraph(lectureId, bookId);
      setKnowledgeGraph(result.graph || null);
      setGraphCached(Boolean(result.cached));
    } catch (err) {
      setKnowledgeGraph(null);
      setGraphCached(false);
      setGraphError(normalizeError(err));
    } finally {
      setGraphLoading(false);
    }
  }, [bookId, lectureId]);

  const handleGenerateKnowledgeGraph = useCallback(async () => {
    setGraphGenerating(true);
    setGraphError(null);
    try {
      const result = await generateKnowledgeGraph(lectureId, bookId);
      setKnowledgeGraph(result.graph || null);
      setGraphCached(Boolean(result.cached));
    } catch (err) {
      setGraphError(normalizeError(err));
    } finally {
      setGraphGenerating(false);
      setGraphLoading(false);
    }
  }, [bookId, lectureId]);

  useEffect(() => {
    void loadBook();
  }, [loadBook]);

  useEffect(() => {
    void loadKnowledgeGraph();
  }, [loadKnowledgeGraph]);

  const loadProgress = useCallback(async () => {
    try {
      const report = await getLearningReport({ lecture_id: lectureId });
      setLectureProgress(readReportProgress(report));
    } catch {
      // Best-effort; keep last known progress.
    }
  }, [lectureId]);

  // Resync per-user progress when returning from the reader.
  useFocusEffect(
    useCallback(() => {
      void loadProgress();
    }, [loadProgress]),
  );

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

  const graphChapters = getGraphChapters(knowledgeGraph);

  if (loading) {
    return (
      <Screen scroll>
        <Skeleton width="55%" height={26} style={styles.skLine} />
        <Skeleton height={72} borderRadius={radius.lg} style={styles.skLine} />
        <Skeleton height={84} borderRadius={radius.lg} style={styles.skLine} />
        <Skeleton height={84} borderRadius={radius.lg} style={styles.skLine} />
        <Skeleton height={84} borderRadius={radius.lg} />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <StateView
          icon="alert-triangle"
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
      <ScreenHeader title={title} subtitle={meta || undefined} onBack={() => navigation.goBack()} />

      {book?.description ? (
        <AppCard variant="muted">
          <AppText tone="secondary">{String(book.description)}</AppText>
        </AppCard>
      ) : null}

      <View style={styles.progressBlock}>
        <View style={styles.progressLabelRow}>
          <AppText variant="caption" tone="tertiary">
            学习进度
          </AppText>
          <AppText variant="label">{lectureProgress.progress}%</AppText>
        </View>
        <ProgressBar value={lectureProgress.progress} />
        {lectureProgress.currentChapter ? (
          <AppText variant="caption" tone="tertiary" numberOfLines={1}>
            {`当前：${lectureProgress.currentChapter}`}
          </AppText>
        ) : null}
      </View>

      <SectionHeader title="阅读内容" />

      {CONTENT_ACTIONS.map((action, index) => (
        <FadeIn key={action.mode} index={index}>
          <AnimatedPressable onPress={() => openReader(action.mode)} style={styles.actionWrap}>
            <AppCard style={styles.actionCard}>
              <View style={styles.glyphBox}>
                <Feather name={action.icon} size={20} color={colors.textInverse} />
              </View>
              <View style={styles.actionCopy}>
                <AppText variant="heading">{action.title}</AppText>
                <AppText variant="caption" tone="tertiary">
                  {action.description}
                </AppText>
              </View>
              <Feather name="chevron-right" size={20} color={colors.textTertiary} />
            </AppCard>
          </AnimatedPressable>
        </FadeIn>
      ))}

      <SectionHeader
        title="知识图谱"
        subtitle={
          graphChapters.length > 0
            ? `${graphCached ? "缓存" : "最新"} · ${graphChapters.length} 组`
            : undefined
        }
      />

      <AppCard style={styles.graphCard}>
        {graphLoading ? (
          <View style={styles.graphSkeleton}>
            <Skeleton width="80%" height={14} />
            <Skeleton width="60%" height={14} />
            <Skeleton width="70%" height={14} />
          </View>
        ) : graphChapters.length > 0 ? (
          graphChapters.slice(0, 4).map((chapter, index) => {
            const children = getNodeChildren(chapter);
            return (
              <View key={`${getNodeTitle(chapter)}-${index}`} style={styles.graphRow}>
                <View style={styles.graphIndex}>
                  <AppText variant="caption" tone="inverse">
                    {index + 1}
                  </AppText>
                </View>
                <View style={styles.actionCopy}>
                  <AppText variant="bodyStrong">{getNodeTitle(chapter)}</AppText>
                  {chapter.summary || chapter.content ? (
                    <AppText variant="caption" tone="tertiary" numberOfLines={2}>
                      {String(chapter.summary || chapter.content)}
                    </AppText>
                  ) : null}
                  {children.length > 0 ? (
                    <AppText variant="caption" tone="secondary" numberOfLines={1}>
                      {children.slice(0, 5).map(getNodeTitle).join(" · ")}
                    </AppText>
                  ) : null}
                </View>
              </View>
            );
          })
        ) : (
          <AppText variant="caption" tone="tertiary">
            暂无知识图谱，可点击下方生成。
          </AppText>
        )}

        {graphError ? (
          <AppText variant="caption" tone="danger">
            {graphError.message}
          </AppText>
        ) : null}

        <View style={styles.graphActions}>
          <AppButton
            title={graphChapters.length > 0 ? "重新生成" : "生成图谱"}
            variant="outline"
            size="sm"
            loading={graphGenerating}
            onPress={() => void handleGenerateKnowledgeGraph()}
            style={styles.graphButton}
          />
          <AppButton
            title="刷新"
            variant="ghost"
            size="sm"
            disabled={graphLoading || graphGenerating}
            onPress={() => void loadKnowledgeGraph()}
            style={styles.graphButton}
          />
        </View>
      </AppCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actionWrap: {
    borderRadius: radius.lg,
  },
  progressBlock: {
    gap: spacing.sm,
  },
  progressLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  skLine: {
    marginBottom: spacing.lg,
  },
  graphSkeleton: {
    gap: spacing.sm,
  },
  actionCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  glyphBox: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceInverse,
  },
  actionCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  graphCard: {
    gap: spacing.md,
  },
  graphRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
  },
  graphIndex: {
    alignItems: "center",
    backgroundColor: colors.surfaceInverse,
    borderRadius: radius.pill,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  graphActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  graphButton: {
    minWidth: 88,
  },
});
