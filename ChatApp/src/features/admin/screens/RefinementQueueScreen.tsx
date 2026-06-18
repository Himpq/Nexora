import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { useSession } from "../../../app/providers/SessionProvider";
import {
  AppBadge,
  AppButton,
  AppCard,
  AppText,
  FadeIn,
  radius,
  Screen,
  Skeleton,
  spacing,
  StateView,
} from "../../../design";
import {
  getRefinementSettings,
  enqueueLectureBooks,
  startIntensiveRefinement,
  startRefinement,
  startSectionRefinement,
  stopRefinement,
  type RefinementSettingsItem,
  type RefinementSettingsResponse,
} from "../../../services/refinementService";
import { normalizeError } from "../../../utils/errors";

function getItemTitle(item: RefinementSettingsItem) {
  return String(item.book_title || item.book_id || "").trim() || "未命名教材";
}

function getStatusText(value: unknown) {
  return String(value || "").trim() || "未开始";
}

function getJobStatusSummary(item: RefinementSettingsItem) {
  const statuses = [
    ["粗/精读", item.job_status],
    ["分节", item.section_job_status],
  ]
    .map(([label, value]) => {
      const text = String(value || "").trim();
      return text ? `${label}: ${text}` : "";
    })
    .filter(Boolean);
  return statuses.length > 0 ? statuses.join(" · ") : "未开始";
}

export function RefinementQueueScreen() {
  const { username } = useSession();
  const [settings, setSettings] = useState<RefinementSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [operationError, setOperationError] = useState<Error | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState("");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOperationError(null);
    try {
      setSettings(await getRefinementSettings());
    } catch (err) {
      setSettings(null);
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const runAction = useCallback(
    async (
      key: string,
      item: RefinementSettingsItem,
      action: (lectureId: string, bookId: string) => Promise<unknown>,
    ) => {
      const lectureId = String(item.lecture_id || "").trim();
      const bookId = String(item.book_id || "").trim();
      if (!lectureId || !bookId || activeAction) {
        return;
      }
      setActiveAction(key);
      setOperationError(null);
      setSuccessMessage("");
      try {
        await action(lectureId, bookId);
        setSuccessMessage("操作已提交，队列状态已刷新。");
        await loadSettings();
      } catch (err) {
        setOperationError(normalizeError(err));
      } finally {
        setActiveAction(null);
      }
    },
    [activeAction, loadSettings],
  );

  const toggleSelected = useCallback((key: string) => {
    setSelectedKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }, []);

  const enqueueSelected = useCallback(async () => {
    if (activeAction || selectedKeys.length === 0) {
      return;
    }
    const selectedItems = selectedKeys
      .map((key) => {
        const [lectureId, bookId] = key.split(":");
        return { lectureId, bookId };
      })
      .filter((item) => item.lectureId && item.bookId);
    const lectureIds = Array.from(new Set(selectedItems.map((item) => item.lectureId)));
    if (lectureIds.length !== 1) {
      setOperationError(new Error("批量提炼一次只能选择同一门课程下的教材。"));
      return;
    }

    setActiveAction("batch:coarse");
    setOperationError(null);
    setSuccessMessage("");
    try {
      const result = await enqueueLectureBooks(
        lectureIds[0],
        selectedItems.map((item) => item.bookId),
        { actor: username },
      );
      setSelectedKeys([]);
      setSuccessMessage(
        `已提交 ${result.queued_count ?? selectedItems.length} 本教材的粗读提炼。`,
      );
      await loadSettings();
    } catch (err) {
      setOperationError(normalizeError(err));
    } finally {
      setActiveAction(null);
    }
  }, [activeAction, loadSettings, selectedKeys, username]);

  if (loading) {
    return (
      <Screen scroll>
        <Skeleton width="40%" height={26} style={styles.skLine} />
        <Skeleton height={96} borderRadius={radius.lg} style={styles.skLine} />
        <Skeleton height={200} borderRadius={radius.lg} style={styles.skLine} />
        <Skeleton height={200} borderRadius={radius.lg} />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <StateView
          title="提炼队列加载失败"
          message={error.message}
          actionLabel="重试"
          onAction={() => void loadSettings()}
        />
      </Screen>
    );
  }

  const items = Array.isArray(settings?.items) ? settings.items : [];
  const selectedLectureCount = new Set(selectedKeys.map((key) => key.split(":")[0]).filter(Boolean)).size;
  const canBatch = selectedKeys.length > 0 && selectedLectureCount === 1 && !activeAction;

  return (
    <Screen scroll>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <AppText variant="title">提炼队列</AppText>
          <AppText tone="secondary">
            共 {items.length} 本教材，运行中 {settings?.queue?.running_count ?? 0} 项。
          </AppText>
        </View>
        <AppButton title="刷新" variant="ghost" onPress={() => void loadSettings()} />
      </View>

      {operationError ? (
        <AppCard style={styles.errorCard}>
          <AppText tone="danger">{operationError.message}</AppText>
        </AppCard>
      ) : null}

      {successMessage ? (
        <AppCard style={styles.successCard}>
          <AppText>{successMessage}</AppText>
        </AppCard>
      ) : null}

      {items.length === 0 ? (
        <StateView
          title="暂无待提炼教材"
          message="当前没有可触发提炼的教材。"
          actionLabel="刷新"
          onAction={() => void loadSettings()}
        />
      ) : (
        <>
          <AppCard style={styles.batchCard}>
            <View style={styles.titleBlock}>
              <AppText variant="heading">批量粗读</AppText>
              <AppText variant="caption" tone="secondary">
                已选 {selectedKeys.length} 本。批量操作一次仅支持同一门课程。
              </AppText>
            </View>
            <View style={styles.actions}>
              <AppButton
                title="清空选择"
                variant="ghost"
                disabled={selectedKeys.length === 0 || Boolean(activeAction)}
                onPress={() => setSelectedKeys([])}
                style={styles.actionButton}
              />
              <AppButton
                title="批量粗读"
                loading={activeAction === "batch:coarse"}
                disabled={!canBatch}
                onPress={() => void enqueueSelected()}
                style={styles.actionButton}
              />
            </View>
          </AppCard>
          {items.map((item, index) => {
          const lectureId = String(item.lecture_id || "").trim();
          const bookId = String(item.book_id || "").trim();
          const itemKey = `${lectureId}:${bookId}`;
          const selected = selectedKeys.includes(itemKey);
          return (
            <FadeIn key={itemKey || getItemTitle(item)} index={index}>
            <AppCard style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <View style={styles.titleBlock}>
                  <AppText variant="heading">{getItemTitle(item)}</AppText>
                  <AppText variant="caption" tone="secondary">
                    {String(item.lecture_title || "").trim() || "未命名课程"}
                  </AppText>
                </View>
                <AppText variant="caption" tone="secondary">
                  {getJobStatusSummary(item)}
                </AppText>
              </View>

              <View style={styles.selectionRow}>
                <AppButton
                  title={selected ? "已选中" : "选择批量"}
                  variant={selected ? "secondary" : "ghost"}
                  disabled={!lectureId || !bookId || Boolean(activeAction)}
                  onPress={() => toggleSelected(itemKey)}
                  style={styles.selectionButton}
                />
                <AppText variant="caption" tone="secondary">
                  批量入口会触发粗读提炼，精读和分节仍按单本操作。
                </AppText>
              </View>

              <View style={styles.statusGrid}>
                <StatusCell label="粗读" value={item.coarse_status} error={item.coarse_error} />
                <StatusCell label="精读" value={item.intensive_status} error={item.intensive_error} />
                <StatusCell label="分节" value={item.section_status} error={item.section_error} />
              </View>

              {item.progress_text ? (
                <AppText variant="caption" tone="secondary">
                  {String(item.progress_text)}
                </AppText>
              ) : null}

              <View style={styles.actions}>
                <AppButton
                  title="粗读"
                  loading={activeAction === `${itemKey}:coarse`}
                  onPress={() =>
                    void runAction(`${itemKey}:coarse`, item, (nextLectureId, nextBookId) =>
                      startRefinement(nextLectureId, nextBookId, {
                        actor: username,
                      }),
                    )
                  }
                  style={styles.actionButton}
                />
                <AppButton
                  title="精读"
                  variant="secondary"
                  loading={activeAction === `${itemKey}:intensive`}
                  onPress={() =>
                    void runAction(`${itemKey}:intensive`, item, (nextLectureId, nextBookId) =>
                      startIntensiveRefinement(nextLectureId, nextBookId, {
                        actor: username,
                      }),
                    )
                  }
                  style={styles.actionButton}
                />
                <AppButton
                  title="分节"
                  variant="secondary"
                  loading={activeAction === `${itemKey}:section`}
                  onPress={() =>
                    void runAction(`${itemKey}:section`, item, (nextLectureId, nextBookId) =>
                      startSectionRefinement(nextLectureId, nextBookId, {
                        actor: username,
                      }),
                    )
                  }
                  style={styles.actionButton}
                />
                <AppButton
                  title="停止"
                  variant="ghost"
                  loading={activeAction === `${itemKey}:stop`}
                  onPress={() =>
                    void runAction(`${itemKey}:stop`, item, (nextLectureId, nextBookId) =>
                      stopRefinement(nextLectureId, nextBookId, {
                        actor: username,
                      }),
                    )
                  }
                  style={styles.actionButton}
                />
              </View>
            </AppCard>
            </FadeIn>
          );
          })}
        </>
      )}
    </Screen>
  );
}

function statusTone(value?: string): "success" | "warning" | "danger" | "muted" {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "muted";
  if (/(done|complete|success|completed|ready|finished)/.test(text)) return "success";
  if (/(running|processing|pending|queued|progress|working)/.test(text)) return "warning";
  if (/(error|failed|fail|stopped)/.test(text)) return "danger";
  return "muted";
}

function StatusCell({
  label,
  value,
  error,
}: {
  label: string;
  value?: string;
  error?: string;
}) {
  const errorText = String(error || "").trim();
  return (
    <View style={styles.statusCell}>
      <AppText variant="caption" tone="tertiary">
        {label}
      </AppText>
      <AppBadge label={getStatusText(value)} tone={statusTone(value)} />
      {errorText ? (
        <AppText variant="caption" tone="danger">
          {errorText}
        </AppText>
      ) : null}
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
  skLine: {
    marginBottom: spacing.lg,
  },
  errorCard: {
    gap: spacing.sm,
  },
  successCard: {
    borderColor: "#16803C",
    gap: spacing.sm,
  },
  batchCard: {
    gap: spacing.md,
  },
  itemCard: {
    gap: spacing.md,
  },
  itemHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
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
    minWidth: 88,
  },
  selectionRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  selectionButton: {
    minWidth: 104,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  actionButton: {
    minWidth: 88,
  },
});
