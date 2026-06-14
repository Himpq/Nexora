import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";

import { BookListItem } from "../../books/components/BookListItem";
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
import type { RootStackParamList } from "../../../navigation/types";
import { getLecture } from "../../../services/lectureService";
import {
  getCourseOutline,
  getLectureVideos,
  type CourseOutlineResponse,
  type LearningVideo,
} from "../../../services/learningExperienceService";
import type { Book, Lecture } from "../../../services/types";
import { normalizeError } from "../../../utils/errors";

type CourseDetailScreenProps = NativeStackScreenProps<RootStackParamList, "CourseDetail">;

function getLectureTitle(lecture: Lecture | null, fallback?: string) {
  return String(lecture?.title || fallback || "").trim() || "未命名课程";
}

function getBookTitle(book: Book) {
  return String(book.title || "").trim() || "未命名教材";
}

function getProgress(lecture: Lecture | null) {
  const progress = Number(lecture?.progress ?? 0);
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, progress));
}

function getVideoTitle(video: LearningVideo) {
  return String(video.title || video.name || "").trim() || "未命名视频";
}

function getVideoMeta(video: LearningVideo) {
  return [
    String(video.book_title || "").trim(),
    String(video.up_name || video.author || video.source || "").trim(),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function CourseDetailScreen({ navigation, route }: CourseDetailScreenProps) {
  const { lectureId, lectureTitle } = route.params;
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [outline, setOutline] = useState<CourseOutlineResponse["outline"] | null>(null);
  const [videos, setVideos] = useState<LearningVideo[]>([]);
  const [extrasError, setExtrasError] = useState<Error | null>(null);
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
      setExtrasError(null);
      const [outlineResult, videosResult] = await Promise.allSettled([
        getCourseOutline(normalizedLectureId),
        getLectureVideos(normalizedLectureId),
      ]);
      setOutline(outlineResult.status === "fulfilled" ? outlineResult.value.outline || null : null);
      setVideos(
        videosResult.status === "fulfilled" && Array.isArray(videosResult.value.items)
          ? videosResult.value.items
          : [],
      );
      if (outlineResult.status === "rejected" || videosResult.status === "rejected") {
        setExtrasError(
          normalizeError(
            outlineResult.status === "rejected"
              ? outlineResult.reason
              : videosResult.status === "rejected"
                ? videosResult.reason
                : undefined,
          ),
        );
      }
    } catch (err) {
      setLecture(null);
      setBooks([]);
      setOutline(null);
      setVideos([]);
      setExtrasError(null);
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
          icon="alert-triangle"
          title="课程教材加载失败"
          message={error.message}
          actionLabel="重试"
          onAction={() => void loadLecture()}
        />
      </Screen>
    );
  }

  const progress = getProgress(lecture);
  const outlineSections = Array.isArray(outline?.sections) ? outline.sections : [];
  const visibleVideos = videos.slice(0, 3);

  return (
    <Screen scroll>
      <ScreenHeader
        title={title}
        subtitle={lecture?.description ? String(lecture.description) : "查看课程下的教材和阅读内容"}
        trailing={<AppButton title="刷新" variant="ghost" size="sm" onPress={() => void loadLecture()} />}
      />

      <AppCard style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <AppText variant="display" style={styles.summaryValue}>
              {books.length}
            </AppText>
            <AppText variant="caption" tone="muted">
              教材数量
            </AppText>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <AppText variant="display" style={styles.summaryValue}>
              {progress}%
            </AppText>
            <AppText variant="caption" tone="muted">
              学习进度
            </AppText>
          </View>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        {lecture?.current_chapter ? (
          <AppText variant="caption" tone="muted">
            当前章节：{String(lecture.current_chapter)}
            {lecture.next_chapter ? ` · 下一章：${String(lecture.next_chapter)}` : ""}
          </AppText>
        ) : null}
      </AppCard>

      <SectionHeader title="教材列表" subtitle="选择一本教材查看原文、概读和精读" />

      {books.length === 0 ? (
        <StateView
          icon="inbox"
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

      <SectionHeader
        title="学习大纲"
        subtitle={
          outlineSections.length > 0
            ? `共 ${outline?.total_sections ?? outlineSections.length} 个单元`
            : "后端生成后会在这里展示"
        }
      />

      {outlineSections.length > 0 ? (
        <AppCard style={styles.outlineCard}>
          {outlineSections.slice(0, 4).map((section, index) => {
            const sectionTitle = String(section.title || section.id || section.section_id || "").trim();
            const concepts = Array.isArray(section.key_concepts) ? section.key_concepts : [];
            return (
              <View key={String(section.id || section.section_id || index)} style={styles.outlineItem}>
                <View style={styles.outlineIndex}>
                  <AppText variant="caption" tone="inverse">
                    {index + 1}
                  </AppText>
                </View>
                <View style={styles.titleBlock}>
                  <AppText variant="bodyStrong">{sectionTitle || "未命名单元"}</AppText>
                  {section.summary ? (
                    <AppText variant="caption" tone="muted" numberOfLines={2}>
                      {String(section.summary)}
                    </AppText>
                  ) : null}
                  {concepts.length > 0 ? (
                    <AppText variant="caption" tone="secondary" numberOfLines={1}>
                      {concepts.slice(0, 4).join(" · ")}
                    </AppText>
                  ) : null}
                </View>
              </View>
            );
          })}
        </AppCard>
      ) : (
        <AppCard variant="muted">
          <AppText variant="caption" tone="muted">
            课程大纲尚未生成；管理员生成后，学习路径和推荐内容会复用这份结构。
          </AppText>
        </AppCard>
      )}

      <SectionHeader
        title="推荐视频"
        subtitle={visibleVideos.length > 0 ? `已缓存 ${videos.length} 个视频` : "粗读/视频任务生成后可用"}
      />

      {visibleVideos.length > 0 ? (
        <View style={styles.videoList}>
          {visibleVideos.map((video, index) => {
            const url = String(video.url || "").trim();
            return (
              <Pressable
                key={url || `${getVideoTitle(video)}-${index}`}
                disabled={!url}
                onPress={() => void Linking.openURL(url)}
                style={({ pressed }) => [styles.videoPressable, pressed && styles.pressed]}
              >
                <AppCard style={styles.videoCard}>
                  <View style={styles.videoBadge}>
                    <AppText variant="caption" tone="inverse">
                      ▶
                    </AppText>
                  </View>
                  <View style={styles.titleBlock}>
                    <AppText variant="bodyStrong" numberOfLines={2}>
                      {getVideoTitle(video)}
                    </AppText>
                    {getVideoMeta(video) ? (
                      <AppText variant="caption" tone="muted" numberOfLines={1}>
                        {getVideoMeta(video)}
                      </AppText>
                    ) : null}
                  </View>
                </AppCard>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <AppCard variant="muted">
          <AppText variant="caption" tone="muted">
            暂无课程推荐视频缓存。管理员的视频任务或教材页刷新后会补齐这里。
          </AppText>
        </AppCard>
      )}

      {extrasError ? (
        <AppCard variant="outlined" style={styles.errorCard}>
          <AppText variant="caption" tone="danger">
            附加学习数据加载失败：{extrasError.message}
          </AppText>
        </AppCard>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  summaryCard: {
    gap: spacing.md,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  summaryItem: {
    flex: 1,
    gap: spacing.xs,
    alignItems: "center",
  },
  summaryValue: {
    fontSize: 28,
  },
  summaryDivider: {
    width: 1,
    height: 40,
    backgroundColor: colors.border,
  },
  progressTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  outlineCard: {
    gap: spacing.md,
  },
  outlineItem: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
  },
  outlineIndex: {
    alignItems: "center",
    backgroundColor: colors.surfaceInverse,
    borderRadius: radius.pill,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  videoList: {
    gap: spacing.sm,
  },
  videoPressable: {
    borderRadius: radius.lg,
  },
  videoCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  videoBadge: {
    alignItems: "center",
    backgroundColor: colors.surfaceInverse,
    borderRadius: radius.md,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  pressed: {
    opacity: 0.7,
  },
  errorCard: {
    borderLeftColor: colors.danger,
    borderLeftWidth: 4,
  },
});
