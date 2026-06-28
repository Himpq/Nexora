import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { CompositeScreenProps } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  radius,
  Screen,
  ScreenHeader,
  Skeleton,
  spacing,
  StateView,
} from "../../../design";
import {
  getDashboard,
  getMaterials,
  selectLearning,
} from "../../../services/frontendService";
import { getLectureCoverUri } from "../../../services/imageService";
import type { LectureRow } from "../../../services/types";
import type { MainTabParamList, RootStackParamList } from "../../../navigation/types";
import { normalizeError } from "../../../utils/errors";

type CourseListScreenProps = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, "Courses">,
  NativeStackScreenProps<RootStackParamList>
>;

type CourseCardProps = {
  row: LectureRow;
  selected: boolean;
  updating: boolean;
  onToggle: () => void;
  onOpen: () => void;
};

function getLectureTitle(row: LectureRow) {
  return String(row.lecture?.title || "").trim() || "未命名课程";
}

function CourseCard({ row, selected, updating, onToggle, onOpen }: CourseCardProps) {
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
  const coverUri = getLectureCoverUri(lecture);

  return (
    <AppCard style={styles.card} active={selected} onPress={onOpen}>
      <View style={styles.cardRow}>
        {coverUri ? (
          <CoverImage
            uri={coverUri}
            fallbackIcon="book-open"
            style={styles.cardCover}
            accessibilityLabel={getLectureTitle(row)}
          />
        ) : (
          <View style={styles.cardCoverFallback}>
            <Feather name="book-open" size={22} color={colors.textTertiary} />
          </View>
        )}
        <View style={styles.cardBody}>
          <View style={styles.cardHeader}>
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
            <AppBadge label={selected ? "已加入" : "未加入"} tone={selected ? "solid" : "muted"} />
          </View>

          {description ? (
            <AppText variant="caption" tone="secondary" numberOfLines={2}>
              {description}
            </AppText>
          ) : null}

          <View style={styles.cardFooter}>
            <AppText variant="caption" tone="tertiary">
              教材 {booksCount} 本
            </AppText>
            <AppButton
              title={selected ? "退出学习" : "加入学习"}
              variant={selected ? "ghost" : "primary"}
              size="sm"
              loading={updating}
              onPress={onToggle}
            />
          </View>
        </View>
      </View>
    </AppCard>
  );
}

export function CourseListScreen({ navigation }: CourseListScreenProps) {
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

  if (loading && rows.length === 0) {
    return (
      <Screen scroll tabBarSpace>
        <Skeleton width="45%" height={28} style={styles.skeletonHeader} />
        <Skeleton width="70%" height={14} style={styles.skeletonSub} />
        <View style={styles.skeletonList}>
          <Skeleton height={120} borderRadius={radius.lg} />
          <Skeleton height={120} borderRadius={radius.lg} />
          <Skeleton height={120} borderRadius={radius.lg} />
        </View>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen tabBarSpace>
        <StateView
          icon="alert-triangle"
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
      <Screen tabBarSpace>
        <StateView
          icon="book"
          title="暂无课程"
          message="当前课程库还没有可加入的课程。"
          actionLabel="刷新"
          onAction={() => void loadCourses()}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll tabBarSpace onRefresh={() => void loadCourses()} refreshing={loading}>
      <ScreenHeader
        title="课程库"
        subtitle={`共 ${rows.length} 门课程，已加入 ${selectedLectureIdSet.size} 门`}
      />

      {operationError ? (
        <AppCard variant="muted" style={styles.errorBanner}>
          <View style={styles.errorContent}>
            <AppText tone="danger" variant="caption" numberOfLines={2}>
              ⚠ {operationError.message}
            </AppText>
            <AppButton title="关闭" variant="ghost" size="sm" onPress={() => setOperationError(null)} />
          </View>
        </AppCard>
      ) : null}

      {learningStateError ? (
        <AppCard variant="muted" style={styles.warningBanner}>
          <AppText variant="caption" tone="muted">
            学习状态加载失败，已按未加入状态显示。{learningStateError.message}
          </AppText>
        </AppCard>
      ) : null}

      {rows.map((row, i) => {
        const lectureId = String(row.lecture?.id || "").trim();
        const selected = selectedLectureIdSet.has(lectureId);
        return (
          <FadeIn key={lectureId || getLectureTitle(row)} index={i}>
            <CourseCard
              row={row}
              selected={selected}
              updating={updatingLectureId === lectureId}
              onToggle={() => void handleToggle(row)}
              onOpen={() => openCourseDetail(row)}
            />
          </FadeIn>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  card: {
    padding: spacing.md,
  },
  cardRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  cardCover: {
    width: 88,
    height: 64,
    borderRadius: radius.md,
  },
  cardCoverFallback: {
    width: 88,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    flex: 1,
    gap: spacing.xs,
    justifyContent: "center",
  },
  cardHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: 2,
  },
  skeletonHeader: {
    marginBottom: spacing.sm,
  },
  skeletonSub: {
    marginBottom: spacing.lg,
  },
  skeletonList: {
    gap: spacing.lg,
  },
  errorBanner: {
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
  },
  errorContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  warningBanner: {
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
  },
});
