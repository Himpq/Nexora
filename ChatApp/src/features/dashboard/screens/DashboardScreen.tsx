import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useSession } from "../../../app/providers/SessionProvider";
import {
  AppBadge,
  AppCard,
  AppText,
  colors,
  CoverImage,
  FadeIn,
  ProgressBar,
  radius,
  Screen,
  SectionHeader,
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
      <Feather name={icon} size={15} color={colors.textTertiary} />
      <View style={styles.metricValueRow}>
        <AppText style={styles.metricValue}>{value}</AppText>
        {unit ? (
          <AppText variant="caption" tone="tertiary" style={styles.metricUnit}>
            {unit}
          </AppText>
        ) : null}
      </View>
      <AppText variant="caption" tone="tertiary" numberOfLines={1}>
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
  const progress = clampProgress(lecture.progress);
  const meta = [category, status].filter(Boolean).join(" · ");
  const coverUri = getLectureCoverUri(lecture);
  const metaLine = [
    `${getBooksCount(row)} 本`,
    `${formatHours(lecture.study_hours)} 小时`,
    currentChapter ? `当前：${currentChapter}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <AppCard style={styles.courseCard} onPress={onContinue}>
      <View style={styles.courseRow}>
        {coverUri ? (
          <CoverImage
            uri={coverUri}
            fallbackIcon="book-open"
            style={styles.courseCover}
            accessibilityLabel={getLectureTitle(row)}
          />
        ) : (
          <View style={styles.courseCoverFallback}>
            <Feather name="book-open" size={22} color={colors.textTertiary} />
          </View>
        )}
        <View style={styles.courseBody}>
          <View style={styles.courseHeader}>
            <View style={styles.titleBlock}>
              <AppText variant="heading" numberOfLines={1}>
                {getLectureTitle(row)}
              </AppText>
              {meta ? (
                <AppText variant="caption" tone="tertiary" numberOfLines={1}>
                  {meta}
                </AppText>
              ) : null}
            </View>
            <AppBadge label="已加入" tone="solid" />
          </View>

          {description ? (
            <AppText variant="caption" tone="secondary" numberOfLines={2}>
              {description}
            </AppText>
          ) : null}

          <View style={styles.progressRow}>
            <ProgressBar value={progress} style={styles.progressFill} />
            <AppText variant="label">{progress}%</AppText>
          </View>

          {metaLine ? (
            <AppText variant="caption" tone="tertiary" numberOfLines={1}>
              {metaLine}
            </AppText>
          ) : null}
        </View>
      </View>
    </AppCard>
  );
}

function DashboardSkeleton() {
  return (
    <View style={styles.skeletonWrap}>
      <View style={styles.metrics}>
        <Skeleton height={84} borderRadius={radius.lg} style={styles.skeletonFlex} />
        <Skeleton height={84} borderRadius={radius.lg} style={styles.skeletonFlex} />
        <Skeleton height={84} borderRadius={radius.lg} style={styles.skeletonFlex} />
      </View>
      <Skeleton height={120} borderRadius={radius.lg} />
      <Skeleton height={120} borderRadius={radius.lg} />
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

  if (loading && !dashboard) {
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
    <Screen scroll tabBarSpace onRefresh={() => void loadDashboard()} refreshing={loading}>
      <FadeIn index={0}>
        <View style={styles.metrics}>
          <MetricCard
            icon="layers"
            label="已加入课程"
            value={`${dashboard?.total_lectures ?? rows.length}`}
          />
          <MetricCard icon="book-open" label="教材总数" value={`${dashboard?.total_books ?? 0}`} />
          <MetricCard
            icon="clock"
            label="学习时长"
            value={formatHours(dashboard?.total_study_hours)}
            unit="h"
          />
        </View>
      </FadeIn>

      <FadeIn index={1}>
        <SectionHeader title="继续学习" subtitle={`欢迎回来${username ? `，${username}` : ""} · 共 ${rows.length} 门课程`} />
      </FadeIn>

      {rows.map((row, i) => {
        const lectureId = String(row.lecture?.id || "").trim();
        return (
          <FadeIn key={lectureId || getLectureTitle(row)} index={2 + i}>
            <LearningCourseCard row={row} onContinue={() => openCourseDetail(row)} />
          </FadeIn>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  },
  metricValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 2,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.5,
    includeFontPadding: false,
  },
  metricUnit: {
    fontWeight: "700",
  },
  courseCard: {
    padding: spacing.md,
  },
  courseRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  courseCover: {
    width: 88,
    height: 64,
    borderRadius: radius.md,
  },
  courseCoverFallback: {
    width: 88,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  courseBody: {
    flex: 1,
    gap: spacing.xs,
    justifyContent: "center",
  },
  courseHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: 2,
  },
  progressFill: {
    flex: 1,
  },
  skeletonWrap: {
    gap: spacing.lg,
  },
  skeletonFlex: {
    flex: 1,
  },
});
