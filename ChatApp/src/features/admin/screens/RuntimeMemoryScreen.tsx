import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { useSession } from "../../../app/providers/SessionProvider";
import {
  AppButton,
  AppCard,
  AppInput,
  AppText,
  FadeIn,
  Screen,
  ScreenHeader,
  Skeleton,
  spacing,
  StateView,
} from "../../../design";
import {
  getRuntimeConfig,
  getRuntimeMemoryBlocks,
  getRuntimeMemoryQueue,
  getRuntimeTools,
  recordRuntimeMemoryTurn,
  triggerRuntimeMemory,
  type RuntimeConfigResponse,
  type RuntimeMemoryBlock,
  type RuntimeMemoryQueueJob,
  type RuntimeMemoryQueueResponse,
  type RuntimeToolSpec,
} from "../../../services/runtimeService";
import { normalizeError } from "../../../utils/errors";

function asJobArray(queue: RuntimeMemoryQueueResponse["queue"]): RuntimeMemoryQueueJob[] {
  if (Array.isArray(queue)) {
    return queue;
  }
  if (queue && typeof queue === "object") {
    const maybeJobs = (queue as Record<string, unknown>).jobs;
    if (Array.isArray(maybeJobs)) {
      return maybeJobs as RuntimeMemoryQueueJob[];
    }
  }
  return [];
}

function renderKeyValue(label: string, value: unknown) {
  const text =
    typeof value === "boolean"
      ? value
        ? "是"
        : "否"
      : String(value ?? "").trim() || "—";
  return (
    <View style={styles.kvRow} key={label}>
      <AppText variant="caption" tone="secondary" style={styles.kvLabel}>
        {label}
      </AppText>
      <AppText variant="body" style={styles.kvValue}>
        {text}
      </AppText>
    </View>
  );
}

export function RuntimeMemoryScreen() {
  const { username } = useSession();
  const [config, setConfig] = useState<RuntimeConfigResponse | null>(null);
  const [tools, setTools] = useState<RuntimeToolSpec[]>([]);
  const [queueJobs, setQueueJobs] = useState<RuntimeMemoryQueueJob[]>([]);
  const [blocks, setBlocks] = useState<RuntimeMemoryBlock[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const [targetUsername, setTargetUsername] = useState(username || "");
  const [lectureId, setLectureId] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    setActionError(null);
    try {
      const [configResult, toolsResult, queueResult] = await Promise.all([
        getRuntimeConfig(),
        getRuntimeTools(),
        getRuntimeMemoryQueue(),
      ]);
      setConfig(configResult);
      setTools(Array.isArray(toolsResult.tools) ? toolsResult.tools : []);
      setQueueJobs(asJobArray(queueResult.queue));
    } catch (err) {
      setConfig(null);
      setTools([]);
      setQueueJobs([]);
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const runAction = useCallback(
    async (key: string, action: () => Promise<unknown>) => {
      if (activeAction) {
        return;
      }
      setActiveAction(key);
      setActionError(null);
      setSuccessMessage("");
      try {
        const result = await action();
        setSuccessMessage(
          typeof result === "string" && result ? result : "操作已提交，队列已刷新。",
        );
        await loadAll();
      } catch (err) {
        setActionError(normalizeError(err));
      } finally {
        setActiveAction(null);
      }
    },
    [activeAction, loadAll],
  );

  const resolveTarget = useCallback(() => {
    const u = String(targetUsername || username || "").trim();
    const l = String(lectureId || "").trim();
    return { username: u, lectureId: l };
  }, [targetUsername, username, lectureId]);

  const triggerMemory = useCallback(() => {
    const { username: u, lectureId: l } = resolveTarget();
    if (!u || !l) {
      setActionError(new Error("请填写用户名和课程 ID。"));
      return;
    }
    return runAction("trigger", () => triggerRuntimeMemory({ username: u, lectureId: l }));
  }, [resolveTarget, runAction]);

  const recordTurn = useCallback(() => {
    const { username: u, lectureId: l } = resolveTarget();
    if (!u || !l) {
      setActionError(new Error("请填写用户名和课程 ID。"));
      return;
    }
    return runAction("turn", () => recordRuntimeMemoryTurn({ username: u, lectureId: l }));
  }, [resolveTarget, runAction]);

  const viewBlocks = useCallback(async () => {
    const { username: u, lectureId: l } = resolveTarget();
    if (!u || !l) {
      setActionError(new Error("请填写用户名和课程 ID。"));
      return;
    }
    setActiveAction("blocks");
    setActionError(null);
    try {
      const result = await getRuntimeMemoryBlocks({ username: u, lectureId: l });
      setBlocks(Array.isArray(result.blocks) ? result.blocks : []);
    } catch (err) {
      setActionError(normalizeError(err));
    } finally {
      setActiveAction(null);
    }
  }, [resolveTarget]);

  if (loading) {
    return (
      <Screen scroll>
        <Skeleton width="40%" height={26} style={styles.skLine} />
        <Skeleton height={96} style={styles.skLine} />
        <Skeleton height={160} style={styles.skLine} />
        <Skeleton height={160} />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <StateView
          title="Runtime 信息加载失败"
          message={error.message}
          actionLabel="重试"
          onAction={() => void loadAll()}
        />
      </Screen>
    );
  }

  const runtimeApi = config?.runtime_api || {};

  return (
    <Screen scroll>
      <ScreenHeader
        overline="Admin"
        title="Runtime / 记忆"
        subtitle="长上下文与学习画像记忆的控制台"
      />

      {actionError ? (
        <AppCard style={styles.errorCard}>
          <AppText tone="danger">{actionError.message}</AppText>
        </AppCard>
      ) : null}
      {successMessage ? (
        <AppCard style={styles.successCard}>
          <AppText>{successMessage}</AppText>
        </AppCard>
      ) : null}

      <FadeIn index={0}>
        <AppCard style={styles.sectionCard}>
          <AppText variant="heading">Runtime 配置</AppText>
          {renderKeyValue("启用", runtimeApi.enabled)}
          {renderKeyValue("Base Path", runtimeApi.base_path)}
          {renderKeyValue("Frontend URL", runtimeApi.frontend_url)}
          {renderKeyValue("请求超时(秒)", runtimeApi.request_timeout)}
        </AppCard>
      </FadeIn>

      <FadeIn index={1}>
        <AppCard style={styles.sectionCard}>
          <AppText variant="heading">已注册工具</AppText>
          {tools.length === 0 ? (
            <AppText variant="caption" tone="muted">
              暂无已注册工具。
            </AppText>
          ) : (
            tools.map((tool, index) => (
              <View key={String(tool.name || index)} style={styles.toolRow}>
                <AppText variant="bodyStrong">{String(tool.name || "未命名工具")}</AppText>
                {tool.description ? (
                  <AppText variant="caption" tone="secondary" numberOfLines={2}>
                    {String(tool.description)}
                  </AppText>
                ) : null}
              </View>
            ))
          )}
        </AppCard>
      </FadeIn>

      <FadeIn index={2}>
        <AppCard style={styles.sectionCard}>
          <View style={styles.titleRow}>
            <AppText variant="heading">记忆队列</AppText>
            <AppButton
              title="刷新"
              variant="ghost"
              size="sm"
              onPress={() => void loadAll()}
            />
          </View>
          {queueJobs.length === 0 ? (
            <AppText variant="caption" tone="muted">
              队列为空。
            </AppText>
          ) : (
            queueJobs.map((job, index) => (
              <View key={String(job.job_id || index)} style={styles.jobRow}>
                <AppText variant="bodyStrong">
                  {String(job.reason || job.status || "任务")}
                </AppText>
                <AppText variant="caption" tone="secondary">
                  {[job.user_id, job.lecture_id, job.status]
                    .map((v) => (v ? String(v) : ""))
                    .filter(Boolean)
                    .join(" · ")}
                </AppText>
              </View>
            ))
          )}
        </AppCard>
      </FadeIn>

      <FadeIn index={3}>
        <AppCard style={styles.sectionCard}>
          <AppText variant="heading">手动操作</AppText>
          <AppText variant="caption" tone="secondary">
            填写目标用户与课程 ID 后触发记忆分析、记录学习轮次或查看记忆块。
          </AppText>
          <AppInput
            label="用户名"
            value={targetUsername}
            onChangeText={setTargetUsername}
            placeholder="留空则使用当前账号"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <AppInput
            label="课程 ID"
            value={lectureId}
            onChangeText={setLectureId}
            placeholder="例如 l_xxx"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.actions}>
            <AppButton
              title="触发记忆分析"
              loading={activeAction === "trigger"}
              disabled={Boolean(activeAction)}
              onPress={() => void triggerMemory()}
              style={styles.actionButton}
            />
            <AppButton
              title="记录学习轮次"
              variant="secondary"
              loading={activeAction === "turn"}
              disabled={Boolean(activeAction)}
              onPress={() => void recordTurn()}
              style={styles.actionButton}
            />
            <AppButton
              title="查看记忆块"
              variant="secondary"
              loading={activeAction === "blocks"}
              disabled={Boolean(activeAction)}
              onPress={() => void viewBlocks()}
              style={styles.actionButton}
            />
          </View>
        </AppCard>
      </FadeIn>

      {blocks ? (
        <FadeIn index={4}>
          <AppCard style={styles.sectionCard}>
            <AppText variant="heading">记忆块（{blocks.length}）</AppText>
            {blocks.length === 0 ? (
              <AppText variant="caption" tone="muted">
                暂无记忆块。
              </AppText>
            ) : (
              blocks.map((block, index) => (
                <View key={index} style={styles.blockRow}>
                  <AppText variant="caption" tone="secondary" numberOfLines={4}>
                    {JSON.stringify(block)}
                  </AppText>
                </View>
              ))
            )}
          </AppCard>
        </FadeIn>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  skLine: {
    marginBottom: spacing.md,
  },
  errorCard: {
    marginBottom: spacing.md,
  },
  successCard: {
    marginBottom: spacing.md,
  },
  sectionCard: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  kvRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  kvLabel: {
    flexShrink: 1,
  },
  kvValue: {
    flexShrink: 1,
    textAlign: "right",
  },
  toolRow: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  jobRow: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.08)",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionButton: {
    flexGrow: 1,
  },
  blockRow: {
    paddingVertical: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.08)",
  },
});
