import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  AppBadge,
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
import { getDashboard } from "../../../services/frontendService";
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
  if (!Number.isFinite(hours) || hours <= 0) {
    return "0 小时";
  }
  if (Number.isInteger(hours)) {
    return `${hours} 小时`;
  }
  return `${hours.toFixed(1)} 小时`;
}

function clampProgress(value: unknown) {
  const progress = Number(value ?? 0);
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, progress));
}

type MetricCardProps = {
  label: string;
  value: string;
};

function MetricCard({ label, value }: MetricCardProps) {
  return (
    <AppCard style={styles.metricCard}>
      <AppText variant="display" style={styles.metricValue}>
        {value}
      </AppText>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
    </AppCard>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${value}%` }]} />
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

  return (
    <AppCard style={styles.courseCard}>
      <View style={styles.courseHeader}>
        <View style={styles.titleBlock}>
          <AppText variant="heading">{getLectureTitle(row)}</AppText>
          {meta ? (
            <AppText variant="caption" tone="muted">
              {meta}
            </AppText>
          ) : null}
        </View>
        <AppBadge label="已加入" tone="solid" />
      </View>

      {description ? (
        <AppText tone="secondary" numberOfLines={3}>
          {description}
        </AppText>
      ) : null}

      <View style={styles.progressBlock}>
        <View style={styles.progressLabelRow}>
          <AppText variant="caption" tone="muted">
            学习进度
          </AppText>
          <AppText variant="label">{progress}%</AppText>
        </View>
        <ProgressBar value={progress} />
      </View>

      <View style={styles.courseMeta}>
        <View style={styles.metaItem}>
          <AppText variant="caption" tone="muted">
            教材
          </AppText>
          <AppText variant="bodyStrong">{getBooksCount(row)} 本</AppText>
        </View>
        <View style={styles.metaDivider} />
        <View style={styles.metaItem}>
          <AppText variant="caption" tone="muted">
            学习时长
          </AppText>
          <AppText variant="bodyStrong">{formatHours(lecture.study_hours)}</AppText>
        </View>
      </View>

      {currentChapter ? (
        <AppText variant="caption" tone="muted">
          当前章节：{currentChapter}
          {nextChapter ? ` · 下一章：${nextChapter}` : ""}
        </AppText>
      ) : null}

      <AppButton title="继续学习" onPress={onContinue} fullWidth />
    </AppCard>
  );
}

export function DashboardScreen({ navigation }: DashboardScreenProps) {
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
      if (!lectureId) {
        return;
      }
      navigation.navigate("CourseDetail", {
        lectureId,
        lectureTitle: getLectureTitle(row),
      });
    },
    [navigation],
  );

  if (loading) {
    return (
      <Screen>
        <StateView title="正在加载学习看板" message="正在读取已加入课程和学习概览..." loading />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
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
      <Screen>
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
    <Screen scroll>
      <ScreenHeader
        overline="Nexora"
        title="学习看板"
        subtitle="查看已加入课程和学习概览"
        trailing={<AppButton title="刷新" variant="ghost" size="sm" onPress={() => void loadDashboard()} />}
      />

      <View style={styles.metrics}>
        <MetricCard label="已加入课程" value={`${dashboard?.total_lectures ?? rows.length}`} />
        <MetricCard label="教材总数" value={`${dashboard?.total_books ?? 0}`} />
        <MetricCard label="学习时长" value={formatHours(dashboard?.total_study_hours)} />
      </View>

      <SectionHeader title="继续学习" subtitle={`共 ${rows.length} 门课程`} />

      {rows.map((row) => {
        const lectureId = String(row.lecture?.id || "").trim();
        return (
          <LearningCourseCard
            key={lectureId || getLectureTitle(row)}
            row={row}
            onContinue={() => openCourseDetail(row)}
          />
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
  metrics: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  metricCard: {
    flex: 1,
    gap: spacing.xs,
    paddingVertical: spacing.lg,
  },
  metricValue: {
    fontSize: 26,
  },
  courseCard: {
    gap: spacing.md,
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
  courseMeta: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  metaItem: {
    flex: 1,
    gap: spacing.xs,
    alignItems: "center",
  },
  metaDivider: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: colors.border,
  },
});
