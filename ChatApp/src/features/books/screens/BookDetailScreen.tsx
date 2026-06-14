import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import {
  AppButton,
  AppCard,
  AppText,
  colors,
  radius,
  Screen,
  ScreenHeader,
  SectionHeader,
  spacing,
  StateView,
} from "../../../design";
import type { BookContentMode, RootStackParamList } from "../../../navigation/types";
import { getBook } from "../../../services/bookService";
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
  glyph: string;
  title: string;
  description: string;
};

const CONTENT_ACTIONS: ContentAction[] = [
  {
    mode: "text",
    glyph: "¶",
    title: "原文",
    description: "查看教材已上传或解析后的全文内容。",
  },
  {
    mode: "bookinfo",
    glyph: "◔",
    title: "概读",
    description: "查看管理员提炼生成的 bookinfo 内容。",
  },
  {
    mode: "bookdetail",
    glyph: "◉",
    title: "精读",
    description: "查看管理员提炼生成的 bookdetail 内容。",
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

  const graphChapters = getGraphChapters(knowledgeGraph);

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
      <ScreenHeader title={title} subtitle={meta || undefined} />

      {book?.description ? (
        <AppCard variant="muted">
          <AppText tone="secondary">{String(book.description)}</AppText>
        </AppCard>
      ) : null}

      <SectionHeader title="阅读内容" subtitle="原文、概读和精读分别独立加载" />

      {CONTENT_ACTIONS.map((action) => (
        <Pressable
          key={action.mode}
          onPress={() => openReader(action.mode)}
          style={({ pressed }) => [styles.actionWrap, pressed && styles.pressed]}
        >
          <AppCard style={styles.actionCard}>
            <View style={styles.glyphBox}>
              <AppText style={styles.glyph}>{action.glyph}</AppText>
            </View>
            <View style={styles.actionCopy}>
              <AppText variant="heading">{action.title}</AppText>
              <AppText variant="caption" tone="muted">
                {action.description}
              </AppText>
            </View>
            <AppText style={styles.chevron} tone="muted">
              ›
            </AppText>
          </AppCard>
        </Pressable>
      ))}

      <AppCard variant="muted">
        <AppText variant="caption" tone="muted">
          概读和精读由管理员提炼生成。尚未生成时，阅读页会显示等待处理状态。
        </AppText>
      </AppCard>

      <SectionHeader
        title="知识图谱"
        subtitle={
          graphChapters.length > 0
            ? `${graphCached ? "缓存" : "最新"} · ${graphChapters.length} 组知识结构`
            : "从概读/精读中提取章节和知识点"
        }
      />

      <AppCard style={styles.graphCard}>
        {graphLoading ? (
          <AppText variant="caption" tone="muted">
            正在读取知识图谱...
          </AppText>
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
                    <AppText variant="caption" tone="muted" numberOfLines={2}>
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
          <AppText variant="caption" tone="muted">
            暂无知识图谱缓存。生成需要后端模型处理，可能需要一些时间。
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
  pressed: {
    opacity: 0.7,
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
  glyph: {
    fontSize: 20,
    color: colors.textInverse,
  },
  actionCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  chevron: {
    fontSize: 28,
    lineHeight: 28,
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
