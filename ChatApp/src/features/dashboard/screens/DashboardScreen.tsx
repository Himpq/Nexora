import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useSession } from "../../../app/providers/SessionProvider";
import {
  AppBadge,
  AppButton,
  AppCard,
  AppText,
  colors,
  CoverImage,
  FadeIn,
  ProgressBar,
  radius,
  Screen,
  SectionHeader,
  shadow,
  spacing,
  StateView,
  Skeleton,
} from "../../../design";
import { getDashboard } from "../../../services/frontendService";
import { getLectureCoverUri } from "../../../services/imageService";
import type { DashboardResponse, LectureRow } from "../../../services/types";
import type { MainTabParamList, RootStackParamList } from "../../../navigation/types";
import { normalizeError } from "../../../utils/errors";

type DashboardScreenProps = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, "Dashboard">,
  NativeStackScreenProps<RootStackParamList>
>;

function getLectureTitle(row: LectureRow) {
  return String(row.lecture?.title || "").trim() || "未命名课程";
}

function getBooksCount(row: LectureRow) {
  if (Number.isFinite(row.books_count)) {
    return row.books_count;
  }
  return Array.isArray(row.books) ? row.books.length : 0;
}

function formatHours(value: unknown) {
  const hours = Number(value || 0);
  if (!Number.isFinite(hours) || hours <= 0) return "0";
  if (Number.isInteger(hours)) return `${hours}`;
  return hours.toFixed(1);
}

function clampProgress(value: unknown) {
  const progress = Number(value ?? 0);
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, progress));
}

type MetricCardProps = {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  unit?: string;
};

function MetricCard({ icon, label, value, unit }: MetricCardProps) {
  return (
    <View style={styles.metricCard}>
      <Feather name={icon} size={16} color={colors.textTertiary} />
      <View style={styles.metricValueRow}>
        <AppText style={styles.metricValue}>{value}</AppText>
        {unit ? (
          <AppText variant="caption" tone="tertiary" style={styles.metricUnit}>
            {unit}
          </AppText>
        ) : null}
      </View>
      <AppText variant="caption" tone="tertiary">
        {label}
      </AppText>
    </View>
  );
}

type LearningCourseCardProps = {
  row: LectureRow;
  onContinue: () => void;
};

function LearningCourseCard({ row, onContinue }: LearningCourseCardProps) {
  const lecture = row.lecture || {};
  const category = String(lecture.category || "").trim();
  const status = String(lecture.status || "").trim();
  const description = String(lecture.description || "").trim();
  const currentChapter = String(lecture.current_chapter || "").trim();
  const nextChapter = String(lecture.next_chapter || "").trim();
  const progress = clampProgress(lecture.progress);
  const meta = [category, status].filter(Boolean).join(" · ");
  const coverUri = getLectureCoverUri(lecture);

  return (
    <AppCard style={styles.courseCard} onPress={onContinue}>
      {coverUri ? (
        <CoverImage
          uri={coverUri}
          fallbackIcon="book-open"
          style={styles.courseCover}
          accessibilityLabel={getLectureTitle(row)}
        />
      ) : null}
      <View style={styles.courseHeader}>
        <View style={styles.titleBlock}>
          <AppText variant="heading">{getLectureTitle(row)}</AppText>
          {meta ? (
            <AppText variant="caption" tone="tertiary">
              {meta}
            </AppText>
          ) : null}
        </View>
        <AppBadge label="已加入" tone="solid" />
      </View>

      {description ? (
        <AppText tone="secondary" numberOfLines={2}>
          {description}
        </AppText>
      ) : null}

      <View style={styles.progressBlock}>
        <View style={styles.progressLabelRow}>
          <AppText variant="caption" tone="tertiary">
            学习进度
          </AppText>
          <AppText variant="label">{progress}%</AppText>
        </View>
        <ProgressBar value={progress} />
      </View>

      <View style={styles.courseMeta}>
        <View style={styles.metaItem}>
          <Feather name="book" size={14} color={colors.textTertiary} />
          <AppText variant="bodyStrong">{getBooksCount(row)} 本</AppText>
        </View>
        <View style={styles.metaDivider} />
        <View style={styles.metaItem}>
          <Feather name="clock" size={14} color={colors.textTertiary} />
          <AppText variant="bodyStrong">{formatHours(lecture.study_hours)} 小时</AppText>
        </View>
      </View>

      {currentChapter ? (
        <AppText variant="caption" tone="tertiary">
          当前章节：{currentChapter}
          {nextChapter ? ` · 下一章：${nextChapter}` : ""}
        </AppText>
      ) : null}

      <View style={styles.continueRow}>
        <AppText variant="label" tone="secondary">
          继续学习
        </AppText>
        <Feather name="arrow-right" size={16} color={colors.text} />
      </View>
    </AppCard>
  );
}

function DashboardSkeleton() {
  return (
    <View style={styles.skeletonWrap}>
      <Skeleton height={132} borderRadius={radius.xl} />
      <View style={styles.metrics}>
        <Skeleton height={92} borderRadius={radius.lg} style={styles.skeletonFlex} />
        <Skeleton height={92} borderRadius={radius.lg} style={styles.skeletonFlex} />
        <Skeleton height={92} borderRadius={radius.lg} style={styles.skeletonFlex} />
      </View>
      <Skeleton height={200} borderRadius={radius.lg} />
      <Skeleton height={200} borderRadius={radius.lg} />
    </View>
  );
}

export function DashboardScreen({ navigation }: DashboardScreenProps) {
  const { username } = useSession();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDashboard(await getDashboard());
    } catch (err) {
      setDashboard(null);
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const goToCourses = useCallback(() => {
    navigation.navigate("Courses");
  }, [navigation]);

  const openCourseDetail = useCallback(
    (row: LectureRow) => {
      const lectureId = String(row.lecture?.id || "").trim();
      if (!lectureId) return;
      navigation.navigate("CourseDetail", {
        lectureId,
        lectureTitle: getLectureTitle(row),
      });
    },
    [navigation],
  );

  if (loading) {
    return (
      <Screen scroll tabBarSpace>
        <DashboardSkeleton />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen tabBarSpace>
        <StateView
          icon="alert-triangle"
          title="学习看板加载失败"
          message={error.message}
          actionLabel="重试"
          onAction={() => void loadDashboard()}
        />
      </Screen>
    );
  }

  const rows = Array.isArray(dashboard?.lectures) ? dashboard.lectures : [];

  if (rows.length === 0) {
    return (
      <Screen tabBarSpace>
        <StateView
          icon="grid"
          title="还没有加入课程"
          message="先从课程库加入一门课程，再回到这里查看学习概览。"
          actionLabel="去课程库"
          onAction={goToCourses}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll tabBarSpace>
      <FadeIn index={0}>
        <View style={styles.hero}>
          <View style={styles.heroText}>
            <AppText variant="caption" tone="inverseMuted">
              欢迎回来{username ? `，${username}` : ""}
            </AppText>
            <AppText variant="title" tone="inverse" style={styles.heroTitle}>
              继续你的学习
            </AppText>
            <AppText variant="caption" tone="inverseMuted" style={styles.heroSub}>
              已加入 {dashboard?.total_lectures ?? rows.length} 门课程 · 保持节奏
            </AppText>
          </View>
          <View style={styles.heroMark}>
            <AppText style={styles.heroMarkText}>N</AppText>
          </View>
        </View>
      </FadeIn>

      <FadeIn index={1}>
        <View style={styles.metrics}>
          <MetricCard icon="layers" label="已加入课程" value={`${dashboard?.total_lectures ?? rows.length}`} />
          <MetricCard icon="book-open" label="教材总数" value={`${dashboard?.total_books ?? 0}`} />
          <MetricCard icon="clock" label="学习时长" value={formatHours(dashboard?.total_study_hours)} unit="h" />
        </View>
      </FadeIn>

      <FadeIn index={2}>
        <SectionHeader
          title="继续学习"
          subtitle={`共 ${rows.length} 门课程`}
          trailing={<AppButton title="刷新" variant="ghost" size="sm" onPress={() => void loadDashboard()} />}
        />
      </FadeIn>

      {rows.map((row, i) => {
        const lectureId = String(row.lecture?.id || "").trim();
        return (
          <FadeIn key={lectureId || getLectureTitle(row)} index={3 + i}>
            <LearningCourseCard row={row} onContinue={() => openCourseDetail(row)} />
          </FadeIn>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceInverse,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadow.lg,
  },
  heroText: {
    flex: 1,
    gap: spacing.xs,
  },
  heroTitle: {
    marginTop: 2,
  },
  heroSub: {
    marginTop: 2,
  },
  heroMark: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroMarkText: {
    color: colors.textInverse,
    fontSize: 26,
    fontWeight: "800",
    includeFontPadding: false,
  },
  metrics: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  metricCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
    ...shadow.xs,
  },
  metricValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 2,
  },
  metricValue: {
    fontSize: 24,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.5,
    includeFontPadding: false,
  },
  metricUnit: {
    fontWeight: "700",
  },
  courseCard: {
    gap: spacing.md,
  },
  courseCover: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
  },
  courseHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
  },
  progressBlock: {
    gap: spacing.sm,
  },
  progressLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  courseMeta: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  metaItem: {
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  metaDivider: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: colors.border,
  },
  continueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderFaint,
    marginTop: spacing.xs,
    paddingVertical: spacing.sm,
  },
  skeletonWrap: {
    gap: spacing.lg,
  },
  skeletonFlex: {
    flex: 1,
  },
  metaText: {
    flex: 1,
  },
});
