import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  AppButton,
  AppCard,
  AppText,
  colors,
  Screen,
  spacing,
  StateView,
} from "../../../design";
import { getDashboard } from "../../../services/frontendService";
import type { DashboardResponse, LectureRow } from "../../../services/types";
import type { MainTabParamList } from "../../../navigation/types";

type DashboardScreenProps = BottomTabScreenProps<MainTabParamList, "Dashboard">;

function normalizeError(err: unknown) {
  return err instanceof Error ? err : new Error(String(err || "Unknown error"));
}

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

type MetricCardProps = {
  label: string;
  value: string;
};

function MetricCard({ label, value }: MetricCardProps) {
  return (
    <AppCard style={styles.metricCard}>
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
      <AppText variant="heading">{value}</AppText>
    </AppCard>
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
  const meta = [category, status].filter(Boolean).join(" · ");

  return (
    <AppCard style={styles.courseCard}>
      <View style={styles.courseHeader}>
        <View style={styles.titleBlock}>
          <AppText variant="heading">{getLectureTitle(row)}</AppText>
          {meta ? (
            <AppText variant="caption" tone="secondary">
              {meta}
            </AppText>
          ) : null}
        </View>
        <View style={styles.badge}>
          <AppText variant="caption" style={styles.badgeText}>
            已加入
          </AppText>
        </View>
      </View>

      {description ? (
        <AppText tone="secondary" numberOfLines={3}>
          {description}
        </AppText>
      ) : null}

      <View style={styles.courseMeta}>
        <View style={styles.metaItem}>
          <AppText variant="caption" tone="secondary">
            教材
          </AppText>
          <AppText>{getBooksCount(row)} 本</AppText>
        </View>
        <View style={styles.metaItem}>
          <AppText variant="caption" tone="secondary">
            学习时长
          </AppText>
          <AppText>{formatHours(lecture.study_hours)}</AppText>
        </View>
      </View>

      <AppButton title="继续学习" onPress={onContinue} style={styles.continueButton} />
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
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <AppText variant="title">学习看板</AppText>
          <AppText tone="secondary">查看已加入课程和学习概览。</AppText>
        </View>
        <AppButton title="刷新" variant="ghost" onPress={() => void loadDashboard()} />
      </View>

      <View style={styles.metrics}>
        <MetricCard label="已加入课程" value={`${dashboard?.total_lectures ?? rows.length} 门`} />
        <MetricCard label="教材总数" value={`${dashboard?.total_books ?? 0} 本`} />
        <MetricCard label="学习时长" value={formatHours(dashboard?.total_study_hours)} />
      </View>

      <View style={styles.sectionHeader}>
        <AppText variant="heading">继续学习</AppText>
        <AppText variant="caption" tone="secondary">
          共 {rows.length} 门课程
        </AppText>
      </View>

      {rows.map((row) => {
        const lectureId = String(row.lecture?.id || "").trim();
        return (
          <LearningCourseCard
            key={lectureId || getLectureTitle(row)}
            row={row}
            onContinue={goToCourses}
          />
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
  },
  titleBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  metricCard: {
    flexBasis: "30%",
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 96,
  },
  sectionHeader: {
    gap: spacing.xs,
  },
  courseCard: {
    gap: spacing.md,
  },
  courseHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
  },
  badge: {
    backgroundColor: colors.primaryMuted,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  badgeText: {
    color: colors.primary,
    fontWeight: "700",
  },
  courseMeta: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  metaItem: {
    flex: 1,
    gap: spacing.xs,
  },
  continueButton: {
    alignSelf: "stretch",
  },
});
