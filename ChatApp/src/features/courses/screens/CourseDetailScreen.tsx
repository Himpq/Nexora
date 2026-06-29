import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { BookListItem } from "../../books/components/BookListItem";
import {
  AnimatedPressable,
  AppButton,
  AppCard,
  AppText,
  colors,
  CoverImage,
  ProgressBar,
  radius,
  Screen,
  ScreenHeader,
  Section,
  Skeleton,
  spacing,
  StateView,
} from "../../../design";
import type { RootStackParamList } from "../../../navigation/types";
import { getLecture } from "../../../services/lectureService";
import {
  getLearningReport,
  type LearningReportResponse,
} from "../../../services/learningContentService";
import {
  getCourseOutline,
  getLectureVideos,
  streamCourseOutline,
  type CourseOutlineResponse,
  type LearningVideo,
} from "../../../services/learningExperienceService";
import {
  getLectureCoverUri,
  listLectureCoverAssets,
  resolveLearningAssetUrl,
  type CoverAsset,
} from "../../../services/imageService";
import type { Book, Lecture } from "../../../services/types";
import { normalizeError } from "../../../utils/errors";

type CourseDetailScreenProps = NativeStackScreenProps<RootStackParamList, "CourseDetail">;

function getLectureTitle(lecture: Lecture | null, fallback?: string) {
  return String(lecture?.title || fallback || "").trim() || "未命名课程";
}

function getBookTitle(book: Book) {
  return String(book.title || "").trim() || "未命名教材";
}

type LectureProgress = {
  progress: number;
  currentChapter: string;
  nextChapter: string;
};

/** Extract per-user lecture progress from a learning report. */
function readReportProgress(report: LearningReportResponse | null | undefined): LectureProgress {
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

function getVideoCoverUri(video: LearningVideo) {
  const direct = String(video.cover || video.cover_url || "").trim();
  if (!direct) return "";
  return resolveLearningAssetUrl(direct);
}

export function CourseDetailScreen({ navigation, route }: CourseDetailScreenProps) {
  const { lectureId, lectureTitle } = route.params;
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [outline, setOutline] = useState<CourseOutlineResponse["outline"] | null>(null);
  const [videos, setVideos] = useState<LearningVideo[]>([]);
  const [coverAssets, setCoverAssets] = useState<CoverAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [outlineGenerating, setOutlineGenerating] = useState(false);
  const [outlineLog, setOutlineLog] = useState("");
  const [lectureProgress, setLectureProgress] = useState<LectureProgress>({
    progress: 0,
    currentChapter: "",
    nextChapter: "",
  });
  const outlineAbortRef = useRef<AbortController | null>(null);

  const title = useMemo(
    () => getLectureTitle(lecture, lectureTitle),
    [lecture, lectureTitle],
  );
  const bookCoverByBookId = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of coverAssets) {
      const bookId = String(item?.book_id || "").trim();
      const path = String(item?.cover_path || item?.image_url || "").trim();
      if (!bookId || !path || map.has(bookId)) continue;
      map.set(bookId, resolveLearningAssetUrl(path));
    }
    return map;
  }, [coverAssets]);

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
      const [outlineResult, videosResult, coversResult] = await Promise.allSettled([
        getCourseOutline(normalizedLectureId),
        getLectureVideos(normalizedLectureId),
        listLectureCoverAssets(normalizedLectureId),
      ]);
      setOutline(outlineResult.status === "fulfilled" ? outlineResult.value.outline || null : null);
      setVideos(
        videosResult.status === "fulfilled" && Array.isArray(videosResult.value.items)
          ? videosResult.value.items
          : [],
      );
      setCoverAssets(
        coversResult.status === "fulfilled" && Array.isArray(coversResult.value.items)
          ? coversResult.value.items
          : [],
      );
    } catch (err) {
      setLecture(null);
      setBooks([]);
      setOutline(null);
      setVideos([]);
      setCoverAssets([]);
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }, [lectureId]);

  useEffect(() => {
    void loadLecture();
  }, [loadLecture]);

  const loadProgress = useCallback(async () => {
    const normalizedLectureId = String(lectureId || "").trim();
    if (!normalizedLectureId) return;
    try {
      const report = await getLearningReport({ lecture_id: normalizedLectureId });
      setLectureProgress(readReportProgress(report));
    } catch {
      // Best-effort; keep last known progress.
    }
  }, [lectureId]);

  // Refresh per-user progress whenever the screen gains focus (e.g. when
  // returning from the reader after marking a chapter complete).
  useFocusEffect(
    useCallback(() => {
      void loadProgress();
    }, [loadProgress]),
  );

  useEffect(() => {
    return () => {
      outlineAbortRef.current?.abort();
    };
  }, []);

  const regenerateOutline = useCallback(async () => {
    const normalizedLectureId = String(lectureId || "").trim();
    if (!normalizedLectureId || outlineGenerating) {
      return;
    }
    outlineAbortRef.current?.abort();
    const controller = new AbortController();
    outlineAbortRef.current = controller;
    setOutlineGenerating(true);
    setOutlineLog("大纲生成已启动…");
    try {
      await streamCourseOutline(normalizedLectureId, {
        signal: controller.signal,
        onStatus: (message) => {
          if (message) {
            setOutlineLog(message);
          }
        },
        onDelta: (content) => {
          if (content) {
            setOutlineLog((prev) => `${prev}${content}`);
          }
        },
        onError: (message) => {
          throw new Error(message || "大纲生成失败。");
        },
      });
      // Reload the persisted outline once the stream settles.
      try {
        const result = await getCourseOutline(normalizedLectureId);
        setOutline(result.outline || null);
      } catch {
        // The streamed outline may not be persisted immediately; keep existing.
      }
      setOutlineLog("大纲已生成。");
    } catch (err) {
      if (controller.signal.aborted) {
        setOutlineLog("已取消大纲生成。");
      } else {
        setOutlineLog(normalizeError(err).message);
      }
    } finally {
      setOutlineGenerating(false);
      outlineAbortRef.current = null;
    }
  }, [lectureId, outlineGenerating]);

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

  if (loading && !lecture) {
    return (
      <Screen scroll>
        <Skeleton width="60%" height={26} style={styles.skLine} />
        <Skeleton height={140} borderRadius={radius.lg} style={styles.skLine} />
        <Skeleton height={92} borderRadius={radius.lg} style={styles.skLine} />
        <Skeleton height={92} borderRadius={radius.lg} />
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

  const progress = lectureProgress.progress;
  const outlineSections = Array.isArray(outline?.sections) ? outline.sections : [];
  const visibleVideos = videos.slice(0, 3);
  const lectureCoverUri = getLectureCoverUri(lecture);
  const chapterLine = [lectureProgress.currentChapter, lectureProgress.nextChapter]
    .map((part, idx) => {
      const text = String(part || "").trim();
      if (!text) return "";
      return idx === 0 ? `当前：${text}` : `下一章：${text}`;
    })
    .filter(Boolean)
    .join(" · ");

  return (
    <Screen scroll onRefresh={() => void loadLecture()} refreshing={loading}>
      <ScreenHeader
        title={title}
        subtitle={`${books.length} 本教材${lecture?.description ? ` · ${String(lecture.description)}` : ""}`}
        onBack={() => navigation.goBack()}
      />

      {lectureCoverUri ? (
        <CoverImage
          uri={lectureCoverUri}
          fallbackIcon="book-open"
          style={styles.lectureCover}
          resizeMode="contain"
          accessibilityLabel={title}
        />
      ) : null}

      <View style={styles.progressBlock}>
        <View style={styles.progressLabelRow}>
          <AppText variant="caption" tone="tertiary">
            学习进度
          </AppText>
          <AppText variant="label">{progress}%</AppText>
        </View>
        <ProgressBar value={progress} />
        {chapterLine ? (
          <AppText variant="caption" tone="tertiary" numberOfLines={1}>
            {chapterLine}
          </AppText>
        ) : null}
      </View>

      <Section first title="教材列表">
        {books.length === 0 ? (
          <AppCard variant="muted">
            <AppText variant="caption" tone="muted">
              这门课程还没有可阅读的教材。
            </AppText>
          </AppCard>
        ) : (
          <View style={styles.bookList}>
            {books.map((book) => {
              const bookId = String(book.id || "").trim();
              return (
                <BookListItem
                  key={bookId || getBookTitle(book)}
                  book={book}
                  coverUri={bookCoverByBookId.get(bookId)}
                  onPress={() => openBook(book)}
                />
              );
            })}
          </View>
        )}
      </Section>

      <Section
        title="学习大纲"
        subtitle={
          outlineSections.length > 0
            ? `共 ${outline?.total_sections ?? outlineSections.length} 个单元`
            : undefined
        }
      >
        <View style={styles.outlineActions}>
          <AppButton
            title={outlineGenerating ? "生成中…" : "重新生成大纲"}
            variant="secondary"
            size="sm"
            loading={outlineGenerating}
            disabled={outlineGenerating}
            onPress={() => void regenerateOutline()}
            style={styles.outlineActionButton}
          />
          {outlineGenerating ? (
            <AppButton
              title="取消"
              variant="ghost"
              size="sm"
              onPress={() => outlineAbortRef.current?.abort()}
              style={styles.outlineActionButton}
            />
          ) : null}
        </View>
        {outlineLog ? (
          <AppCard variant="muted" style={styles.outlineLogCard}>
            <AppText variant="caption" tone="secondary" numberOfLines={6}>
              {outlineLog}
            </AppText>
          </AppCard>
        ) : null}
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
              大纲生成后将在这里展示。
            </AppText>
          </AppCard>
        )}
      </Section>

      <Section
        title="推荐视频"
        subtitle={visibleVideos.length > 0 ? `共 ${videos.length} 个视频` : undefined}
      >
        {visibleVideos.length > 0 ? (
          <View style={styles.videoList}>
            {visibleVideos.map((video, index) => {
              const url = String(video.url || "").trim();
              const videoCover = getVideoCoverUri(video);
              return (
                <AnimatedPressable
                  key={url || `${getVideoTitle(video)}-${index}`}
                  disabled={!url}
                  onPress={() => void Linking.openURL(url)}
                  style={styles.videoPressable}
                >
                  <AppCard style={styles.videoCard}>
                    <CoverImage
                      uri={videoCover}
                      fallbackIcon="play"
                      style={styles.videoThumb}
                      overlay={
                        <View style={styles.videoPlayBadge}>
                          <Feather name="play" size={14} color={colors.textInverse} />
                        </View>
                      }
                    />
                    <View style={styles.titleBlock}>
                      <AppText variant="bodyStrong" numberOfLines={2}>
                        {getVideoTitle(video)}
                      </AppText>
                      {getVideoMeta(video) ? (
                        <AppText variant="caption" tone="tertiary" numberOfLines={1}>
                          {getVideoMeta(video)}
                        </AppText>
                      ) : null}
                    </View>
                    <Feather name="external-link" size={16} color={colors.textTertiary} />
                  </AppCard>
                </AnimatedPressable>
              );
            })}
          </View>
        ) : (
          <AppCard variant="muted">
            <AppText variant="caption" tone="muted">
              暂无推荐视频。
            </AppText>
          </AppCard>
        )}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  lectureCover: {
    width: "100%",
    aspectRatio: 3 / 2,
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
  bookList: {
    gap: spacing.sm,
  },
  skLine: {
    marginBottom: spacing.lg,
  },
  outlineCard: {
    gap: spacing.md,
  },
  outlineActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  outlineActionButton: {
    flexGrow: 1,
  },
  outlineLogCard: {
    marginBottom: spacing.sm,
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
    height: 28,
    justifyContent: "center",
    minWidth: 28,
    paddingHorizontal: spacing.xs,
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
  videoThumb: {
    width: 64,
    height: 44,
    borderRadius: radius.sm,
  },
  videoPlayBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,10,10,0.55)",
  },
});
