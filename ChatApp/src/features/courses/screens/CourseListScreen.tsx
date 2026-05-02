import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { useSession } from "../../../app/providers/SessionProvider";
import {
  AppButton,
  AppCard,
  AppText,
  colors,
  Screen,
  spacing,
  StateView,
} from "../../../design";
import {
  getDashboard,
  getMaterials,
  selectLearning,
} from "../../../services/frontendService";
import type { LectureRow } from "../../../services/types";

type CourseCardProps = {
  row: LectureRow;
  selected: boolean;
  updating: boolean;
  onToggle: () => void;
};

function normalizeError(err: unknown) {
  return err instanceof Error ? err : new Error(String(err || "Unknown error"));
}

function getLectureTitle(row: LectureRow) {
  return String(row.lecture?.title || "").trim() || "未命名课程";
}

function CourseCard({ row, selected, updating, onToggle }: CourseCardProps) {
  const lecture = row.lecture || {};
  const category = String(lecture.category || "").trim();
  const status = String(lecture.status || "").trim();
  const description = String(lecture.description || "").trim();
  const booksCount = Number.isFinite(row.books_count)
    ? row.books_count
    : Array.isArray(row.books)
      ? row.books.length
      : 0;
  const meta = [category, status].filter(Boolean).join(" · ");

  return (
    <AppCard style={[styles.card, selected && styles.selectedCard]}>
      <View style={styles.cardHeader}>
        <View style={styles.titleBlock}>
          <AppText variant="heading">{getLectureTitle(row)}</AppText>
          {meta ? (
            <AppText variant="caption" tone="secondary">
              {meta}
            </AppText>
          ) : null}
        </View>
        <View style={[styles.badge, selected ? styles.selectedBadge : styles.mutedBadge]}>
          <AppText
            variant="caption"
            style={selected ? styles.selectedBadgeText : styles.mutedBadgeText}
          >
            {selected ? "已加入" : "未加入"}
          </AppText>
        </View>
      </View>

      {description ? (
        <AppText tone="secondary" numberOfLines={3} style={styles.description}>
          {description}
        </AppText>
      ) : null}

      <View style={styles.footer}>
        <AppText variant="caption" tone="secondary">
          教材 {booksCount} 本
        </AppText>
        <AppButton
          title={selected ? "退出学习" : "加入学习"}
          variant={selected ? "secondary" : "primary"}
          loading={updating}
          onPress={onToggle}
          style={styles.selectButton}
        />
      </View>
    </AppCard>
  );
}

export function CourseListScreen() {
  const { username } = useSession();
  const [rows, setRows] = useState<LectureRow[]>([]);
  const [selectedLectureIds, setSelectedLectureIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [learningStateError, setLearningStateError] = useState<Error | null>(null);
  const [operationError, setOperationError] = useState<Error | null>(null);
  const [updatingLectureId, setUpdatingLectureId] = useState<string | null>(null);

  const selectedLectureIdSet = useMemo(
    () => new Set(selectedLectureIds.map((id) => String(id))),
    [selectedLectureIds],
  );

  const loadCourses = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLearningStateError(null);
    setOperationError(null);
    try {
      const [materialsResult, dashboardResult] = await Promise.allSettled([
        getMaterials(),
        getDashboard(),
      ]);

      if (materialsResult.status === "rejected") {
        throw materialsResult.reason;
      }

      const materials = materialsResult.value;
      setRows(Array.isArray(materials.lectures) ? materials.lectures : []);
      if (dashboardResult.status === "fulfilled") {
        setSelectedLectureIds(
          Array.isArray(dashboardResult.value.selected_lecture_ids)
            ? dashboardResult.value.selected_lecture_ids.map((id) => String(id))
            : [],
        );
      } else {
        setSelectedLectureIds([]);
        setLearningStateError(normalizeError(dashboardResult.reason));
      }
    } catch (err) {
      setRows([]);
      setSelectedLectureIds([]);
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCourses();
  }, [loadCourses]);

  const handleToggle = useCallback(
    async (row: LectureRow) => {
      const lectureId = String(row.lecture?.id || "").trim();
      if (!lectureId || updatingLectureId) {
        return;
      }

      const nextSelected = !selectedLectureIdSet.has(lectureId);
      setUpdatingLectureId(lectureId);
      setOperationError(null);
      try {
        const result = await selectLearning(lectureId, nextSelected, username);
        setSelectedLectureIds(
          Array.isArray(result.selected_lecture_ids)
            ? result.selected_lecture_ids.map((id) => String(id))
            : [],
        );
      } catch (err) {
        setOperationError(normalizeError(err));
      } finally {
        setUpdatingLectureId(null);
      }
    },
    [selectedLectureIdSet, updatingLectureId, username],
  );

  if (loading) {
    return (
      <Screen>
        <StateView title="正在加载课程" message="正在读取课程库和学习状态..." loading />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <StateView
          title="课程加载失败"
          message={error.message}
          actionLabel="重试"
          onAction={() => void loadCourses()}
        />
      </Screen>
    );
  }

  if (rows.length === 0) {
    return (
      <Screen>
        <StateView
          title="暂无课程"
          message="当前课程库还没有可加入的课程。"
          actionLabel="刷新"
          onAction={() => void loadCourses()}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <AppText variant="title">课程库</AppText>
          <AppText tone="secondary">
            共 {rows.length} 门课程，已加入 {selectedLectureIdSet.size} 门。
          </AppText>
        </View>
        <AppButton title="刷新" variant="ghost" onPress={() => void loadCourses()} />
      </View>

      {operationError ? (
        <AppCard style={styles.bannerCard}>
          <AppText tone="danger" style={styles.bannerText}>
            {operationError.message}
          </AppText>
          <AppButton
            title="关闭"
            variant="ghost"
            onPress={() => setOperationError(null)}
            style={styles.bannerButton}
          />
        </AppCard>
      ) : null}

      {learningStateError ? (
        <AppCard style={styles.bannerCard}>
          <AppText tone="secondary" style={styles.bannerText}>
            学习状态加载失败，已按未加入状态显示。{learningStateError.message}
          </AppText>
          <AppButton
            title="关闭"
            variant="ghost"
            onPress={() => setLearningStateError(null)}
            style={styles.bannerButton}
          />
        </AppCard>
      ) : null}

      {rows.map((row) => {
        const lectureId = String(row.lecture?.id || "").trim();
        const selected = selectedLectureIdSet.has(lectureId);
        return (
          <CourseCard
            key={lectureId || getLectureTitle(row)}
            row={row}
            selected={selected}
            updating={updatingLectureId === lectureId}
            onToggle={() => void handleToggle(row)}
          />
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.md,
  },
  titleBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  card: {
    gap: spacing.md,
  },
  selectedCard: {
    borderColor: colors.primary,
  },
  cardHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  selectedBadge: {
    backgroundColor: colors.primaryMuted,
  },
  mutedBadge: {
    backgroundColor: colors.surfaceMuted,
  },
  selectedBadgeText: {
    color: colors.primary,
    fontWeight: "700",
  },
  mutedBadgeText: {
    color: colors.textMuted,
    fontWeight: "700",
  },
  description: {
    flexShrink: 1,
  },
  footer: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  selectButton: {
    minWidth: 112,
  },
  bannerCard: {
    alignItems: "center",
    borderColor: colors.danger,
    flexDirection: "row",
    gap: spacing.md,
  },
  bannerText: {
    flex: 1,
  },
  bannerButton: {
    minHeight: 36,
    paddingHorizontal: spacing.sm,
  },
});
