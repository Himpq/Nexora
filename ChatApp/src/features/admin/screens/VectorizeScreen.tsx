import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { useSession } from "../../../app/providers/SessionProvider";
import {
  AnimatedPressable,
  AppBadge,
  AppButton,
  AppCard,
  AppText,
  colors,
  haptics,
  radius,
  Screen,
  Skeleton,
  spacing,
  StateView,
} from "../../../design";
import type { RootStackParamList } from "../../../navigation/types";
import { getMaterials } from "../../../services/frontendService";
import {
  getBookVectorizeStatus,
  triggerBookVectorize,
  type VectorizeStatusResponse,
  type VectorizeTriggerResult,
} from "../../../services/vectorizeService";
import type { Book, LectureRow } from "../../../services/types";
import { normalizeError } from "../../../utils/errors";

type VectorizeScreenProps = NativeStackScreenProps<RootStackParamList, "Vectorize">;

function getLectureTitle(row: LectureRow) {
  return String(row.lecture?.title || "").trim() || "未命名课程";
}

function getBookTitle(book?: Book | null) {
  return String(book?.title || book?.id || "").trim() || "未命名教材";
}

function getStatusLabel(status?: string) {
  const value = String(status || "").trim();
  if (!value) {
    return "未开始";
  }
  if (value === "vectorizing") {
    return "处理中";
  }
  if (value === "done") {
    return "已完成";
  }
  if (value === "error") {
    return "失败";
  }
  if (value === "queued") {
    return "已排队";
  }
  return value;
}

function getStatusTone(status?: string): "success" | "warning" | "danger" | "muted" {
  const value = String(status || "").trim().toLowerCase();
  if (value === "done") return "success";
  if (value === "error") return "danger";
  if (value === "vectorizing" || value === "queued") return "warning";
  return "muted";
}

function toStatusSnapshot(book: Book | null): VectorizeStatusResponse | null {
  if (!book) {
    return null;
  }
  return {
    success: true,
    book_id: book.id,
    vector_status: String(book.vector_status || ""),
    vector_provider: String(book.vector_provider || ""),
    chunks_count: book.chunks_count,
    vector_count: book.vector_count,
    error: String(book.error || ""),
  };
}

export function VectorizeScreen({ navigation }: VectorizeScreenProps) {
  const { isAdmin } = useSession();
  const [rows, setRows] = useState<LectureRow[]>([]);
  const [selectedLectureId, setSelectedLectureId] = useState("");
  const [selectedBookId, setSelectedBookId] = useState("");
  const [status, setStatus] = useState<VectorizeStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [operationError, setOperationError] = useState<Error | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const selectedLectureIdRef = useRef("");
  const selectedBookIdRef = useRef("");
  const statusRequestIdRef = useRef(0);
  const triggeringRef = useRef(false);

  useEffect(() => {
    selectedLectureIdRef.current = selectedLectureId;
  }, [selectedLectureId]);

  useEffect(() => {
    selectedBookIdRef.current = selectedBookId;
  }, [selectedBookId]);

  const selectedLecture = useMemo(
    () => rows.find((row) => String(row.lecture?.id || "") === selectedLectureId),
    [rows, selectedLectureId],
  );

  const selectedBook = useMemo(() => {
    const books = selectedLecture?.books || [];
    return books.find((book) => String(book.id || "") === selectedBookId) || null;
  }, [selectedBookId, selectedLecture]);

  const loadMaterials = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOperationError(null);
    try {
      const result = await getMaterials();
      const nextRows = Array.isArray(result.lectures) ? result.lectures : [];
      setRows(nextRows);
      const currentLectureId = selectedLectureIdRef.current;
      const currentBookId = selectedBookIdRef.current;
      const nextLectureId = currentLectureId || String(nextRows[0]?.lecture?.id || "");
      setSelectedLectureId(nextLectureId);
      const nextLecture = nextRows.find((row) => String(row.lecture?.id || "") === nextLectureId) || nextRows[0];
      const nextBook = nextLecture?.books?.[0] || null;
      setSelectedBookId((current) => {
        const bookId = currentBookId || current;
        if (bookId && nextLecture?.books?.some((book) => String(book.id || "") === bookId)) {
          return bookId;
        }
        return String(nextBook?.id || "");
      });
      const snapshot = toStatusSnapshot(nextBook);
      if (snapshot) {
        setStatus(snapshot);
      }
    } catch (err) {
      setRows([]);
      setSelectedLectureId("");
      setSelectedBookId("");
      setStatus(null);
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStatus = useCallback(
    async (lectureId: string, bookId: string) => {
      if (!lectureId || !bookId) {
        statusRequestIdRef.current += 1;
        setStatus(null);
        return;
      }
      const requestId = statusRequestIdRef.current + 1;
      statusRequestIdRef.current = requestId;
      setStatusLoading(true);
      setOperationError(null);
      try {
        const nextStatus = await getBookVectorizeStatus(lectureId, bookId);
        if (statusRequestIdRef.current === requestId) {
          setStatus(nextStatus);
        }
      } catch (err) {
        if (statusRequestIdRef.current === requestId) {
          setStatus(null);
          setOperationError(normalizeError(err));
        }
      } finally {
        if (statusRequestIdRef.current === requestId) {
          setStatusLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void loadMaterials();
  }, [loadMaterials]);

  useEffect(() => {
    const lectureId = selectedLectureId.trim();
    const bookId = selectedBookId.trim();
    if (!lectureId || !bookId || loading) {
      return;
    }
    void loadStatus(lectureId, bookId);
  }, [loadStatus, loading, selectedBookId, selectedLectureId]);

  const selectBook = useCallback(
    (lectureId: string, bookId: string) => {
      setSelectedLectureId(lectureId);
      setSelectedBookId(bookId);
      setSuccessMessage("");
      setOperationError(null);
    },
    [],
  );

  const trigger = useCallback(async () => {
    const lectureId = selectedLectureId.trim();
    const bookId = selectedBookId.trim();
    if (!lectureId || !bookId || triggeringRef.current) {
      return;
    }
    triggeringRef.current = true;
    setTriggering(true);
    setOperationError(null);
    setSuccessMessage("");
    try {
      const result = await triggerBookVectorize(lectureId, bookId, { async: true });
      const vectorization = result.vectorization || {};
      setSuccessMessage(
        vectorization.queued
          ? "向量化已提交到后台队列。"
          : "向量化已完成。请查看分块和向量数量。",
      );
      await loadStatus(lectureId, bookId);
      await loadMaterials();
    } catch (err) {
      setOperationError(normalizeError(err));
    } finally {
      triggeringRef.current = false;
      setTriggering(false);
    }
  }, [loadMaterials, loadStatus, selectedBookId, selectedLectureId]);

  if (!isAdmin) {
    return (
      <Screen>
        <StateView title="无管理权限" message="当前账号不是管理员，不能查看向量化监控。" />
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen scroll>
        <Skeleton width="45%" height={26} style={styles.skLine} />
        <Skeleton width="80%" height={14} style={styles.skLine} />
        <Skeleton height={72} borderRadius={radius.md} style={styles.skLine} />
        <Skeleton height={72} borderRadius={radius.md} style={styles.skLine} />
        <Skeleton height={160} borderRadius={radius.lg} />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <StateView
          title="向量化监控加载失败"
          message={error.message}
          actionLabel="重试"
          onAction={() => void loadMaterials()}
        />
      </Screen>
    );
  }

  if (rows.length === 0) {
    return (
      <Screen>
        <StateView
          title="暂无课程"
          message="需要先创建课程和教材，才能查看向量化状态。"
          actionLabel="刷新"
          onAction={() => void loadMaterials()}
        />
      </Screen>
    );
  }

  const books = selectedLecture?.books || [];

  return (
    <Screen scroll>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <AppText variant="title">向量化监控</AppText>
          <AppText tone="secondary">
            查看单本教材的向量化状态、分块数量和向量数量，并可手动触发向量化。
          </AppText>
        </View>
        <AppButton title="刷新" variant="ghost" onPress={() => void loadMaterials()} />
      </View>

      {operationError ? (
        <AppCard style={styles.bannerCard}>
          <AppText tone="danger" style={styles.bannerText}>
            {operationError.message}
          </AppText>
          <AppButton title="关闭" variant="ghost" onPress={() => setOperationError(null)} />
        </AppCard>
      ) : null}

      {successMessage ? (
        <AppCard style={[styles.bannerCard, styles.successCard]}>
          <View style={styles.titleBlock}>
            <AppText>{successMessage}</AppText>
            {selectedBook ? (
              <AppText variant="caption" tone="secondary">
                {getBookTitle(selectedBook)} · {getStatusLabel(status?.vector_status)}
              </AppText>
            ) : null}
          </View>
          <AppButton title="查看课程" variant="secondary" onPress={() => navigation.goBack()} />
        </AppCard>
      ) : null}

      <View style={styles.sectionHeader}>
        <AppText variant="heading">选择教材</AppText>
        <AppText variant="caption" tone="secondary">
          每次只查看和触发一本文本教材。
        </AppText>
      </View>

      <View style={styles.lectureList}>
        {rows.map((row) => {
          const lectureId = String(row.lecture?.id || "").trim();
          const lectureSelected = lectureId === selectedLectureId;
          return (
            <View key={lectureId || getLectureTitle(row)} style={styles.lectureGroup}>
              <AnimatedPressable
                disabled={triggering || statusLoading}
              onPress={() => {
                haptics.selection();
                const nextLecture = lectureSelected ? "" : lectureId;
                const nextBook = row.books?.[0]?.id || "";
                setSelectedLectureId(nextLecture);
                setSelectedBookId(nextBook);
                setSuccessMessage("");
                setOperationError(null);
              }}
                press={{ pressedScale: 0.98 }}
                style={[styles.lectureOption, lectureSelected && styles.lectureOptionSelected]}
              >
                <View style={styles.titleBlock}>
                  <AppText variant="heading">{getLectureTitle(row)}</AppText>
                  <AppText variant="caption" tone="secondary">
                    {row.books_count ?? row.books?.length ?? 0} 本教材
                  </AppText>
                </View>
                <View style={[styles.badge, lectureSelected ? styles.selectedBadge : styles.mutedBadge]}>
                  <AppText
                    variant="caption"
                    style={lectureSelected ? styles.selectedBadgeText : styles.mutedBadgeText}
                  >
                    {lectureSelected ? "已展开" : "展开"}
                  </AppText>
                </View>
              </AnimatedPressable>

              {lectureSelected ? (
                <View style={styles.bookList}>
                  {books.length > 0 ? (
                    books.map((book) => {
                      const bookId = String(book.id || "").trim();
                      const selected = bookId === selectedBookId;
                      return (
                        <AnimatedPressable
                          key={bookId || getBookTitle(book)}
                          disabled={triggering || statusLoading}
                          onPress={() => {
                            haptics.selection();
                            selectBook(lectureId, bookId);
                          }}
                          press={{ pressedScale: 0.98 }}
                          style={[styles.bookOption, selected && styles.bookOptionSelected]}
                        >
                          <View style={styles.titleBlock}>
                            <AppText>{getBookTitle(book)}</AppText>
                            <AppText variant="caption" tone="secondary">
                              文本：{String(book.text_status || "pending_extract")} · 向量：
                              {String(book.vector_status || "idle")}
                            </AppText>
                          </View>
                          <View style={[styles.smallBadge, selected ? styles.selectedBadge : styles.mutedBadge]}>
                            <AppText
                              variant="caption"
                              style={selected ? styles.selectedBadgeText : styles.mutedBadgeText}
                            >
                              {selected ? "已选中" : "选择"}
                            </AppText>
                          </View>
                        </AnimatedPressable>
                      );
                    })
                  ) : (
                    <AppText variant="caption" tone="secondary">
                      该课程暂无教材。
                    </AppText>
                  )}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      <AppCard style={styles.statusCard}>
        <View style={styles.sectionHeader}>
          <AppText variant="heading">状态详情</AppText>
          <AppText variant="caption" tone="secondary">
            {selectedLecture ? getLectureTitle(selectedLecture) : "未选择课程"}
            {selectedBook ? ` · ${getBookTitle(selectedBook)}` : ""}
          </AppText>
        </View>

        {statusLoading ? (
          <View style={styles.statusSkeleton}>
            <Skeleton width="70%" height={14} />
            <Skeleton width="50%" height={14} />
          </View>
        ) : status ? (
          <>
            <View style={styles.statusGrid}>
              <StatusCell label="状态" value={getStatusLabel(status.vector_status)} />
              <StatusCell label="分块" value={status.chunks_count} />
              <StatusCell label="向量" value={status.vector_count} />
              <StatusCell label="提供方" value={status.vector_provider} />
            </View>
            <AppBadge label={getStatusLabel(status.vector_status)} tone={getStatusTone(status.vector_status)} />
            {status.error ? (
              <AppText variant="caption" tone="danger">
                {status.error}
              </AppText>
            ) : null}
          </>
        ) : (
          <AppText tone="secondary">请选择教材后查看状态。</AppText>
        )}
      </AppCard>

      <AppCard style={styles.actionCard}>
        <View style={styles.sectionHeader}>
          <AppText variant="heading">触发向量化</AppText>
          <AppText variant="caption" tone="secondary">
            触发后会异步更新教材的向量状态。
          </AppText>
        </View>
        <AppButton
          title="开始向量化"
          loading={triggering}
          disabled={!selectedLectureId || !selectedBookId || triggering}
          onPress={() => void trigger()}
        />
      </AppCard>
    </Screen>
  );
}

function StatusCell({
  label,
  value,
}: {
  label: string;
  value?: string | number;
}) {
  const text = String(value ?? "").trim();
  return (
    <View style={styles.statusCell}>
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
      <AppText>{text || "无"}</AppText>
    </View>
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
  sectionHeader: {
    gap: spacing.xs,
  },
  bannerCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  bannerText: {
    flex: 1,
  },
  successCard: {
    borderColor: colors.success,
  },
  lectureList: {
    gap: spacing.sm,
  },
  lectureGroup: {
    gap: spacing.sm,
  },
  lectureOption: {
    alignItems: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  lectureOptionSelected: {
    borderColor: colors.primary,
  },
  bookList: {
    gap: spacing.sm,
    paddingLeft: spacing.md,
  },
  bookOption: {
    alignItems: "flex-start",
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  bookOptionSelected: {
    borderColor: colors.primary,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  smallBadge: {
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
  skLine: {
    marginBottom: spacing.lg,
  },
  statusSkeleton: {
    gap: spacing.sm,
  },
  statusCard: {
    gap: spacing.md,
  },
  statusGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  statusCell: {
    flexBasis: "30%",
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 96,
  },
  actionCard: {
    gap: spacing.md,
  },
});
