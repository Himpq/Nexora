import { StyleSheet, View } from "react-native";

import { useSession } from "../../../app/providers/SessionProvider";
import { appEnv } from "../../../config/env";
import { AppButton, AppCard, AppText, Screen, spacing } from "../../../design";

type DetailRowProps = {
  label: string;
  value: string;
  tone?: "primary" | "secondary" | "muted" | "danger";
};

function DetailRow({ label, value, tone = "primary" }: DetailRowProps) {
  return (
    <View style={styles.row}>
      <AppText tone="secondary" style={styles.label}>
        {label}
      </AppText>
      <AppText tone={tone} style={styles.value}>
        {value}
      </AppText>
    </View>
  );
}

export function SettingsScreen() {
  const {
    username,
    context,
    isAdmin,
    isContextLoading,
    contextError,
    refreshContext,
    clearUsername,
  } = useSession();
  const role = String(context?.user?.role || "").trim();
  const integration = context?.integration || null;
  const connected = Boolean(integration?.connected);

  return (
    <Screen scroll>
      <AppText variant="title">设置</AppText>
      <AppCard style={styles.card}>
        <AppText variant="heading">应用信息</AppText>
        <DetailRow label="版本" value="0.4.0" />
        <DetailRow label="API 基地址" value={appEnv.nexoraLearningBaseUrl} />
      </AppCard>
      <AppCard style={styles.card}>
        <AppText variant="heading">用户上下文</AppText>
        <DetailRow label="username" value={username} />
        <DetailRow label="context username" value={context?.username || "未加载"} />
        <DetailRow label="角色" value={role || "未加载"} />
        <DetailRow label="管理员" value={isAdmin ? "是" : "否"} />
        {contextError ? <AppText tone="danger">{contextError.message}</AppText> : null}
        <View style={styles.actions}>
          <AppButton
            title="刷新上下文"
            variant="secondary"
            loading={isContextLoading}
            onPress={() => void refreshContext()}
            style={styles.actionButton}
          />
          <AppButton
            title="切换用户"
            variant="ghost"
            onPress={() => void clearUsername()}
            style={styles.actionButton}
          />
        </View>
      </AppCard>
      <AppCard style={styles.card}>
        <AppText variant="heading">后端连通性</AppText>
        <DetailRow
          label="状态"
          value={connected ? "已连接" : "未连接"}
          tone={connected ? "primary" : "danger"}
        />
        <DetailRow label="模型数量" value={String(integration?.models_count ?? 0)} />
        <DetailRow label="模型端点" value={integration?.endpoint || "未加载"} />
        <DetailRow label="Nexora 基地址" value={integration?.base_url || "未加载"} />
        <DetailRow
          label="Public API Key"
          value={integration?.has_public_api_key ? "已配置" : "未配置"}
        />
        {integration?.message ? (
          <AppText tone="secondary">{integration.message}</AppText>
        ) : null}
      </AppCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  row: {
    gap: spacing.xs,
  },
  label: {
    fontWeight: "700",
  },
  value: {
    flexShrink: 1,
  },
  actions: {
    gap: spacing.sm,
  },
  actionButton: {
    alignSelf: "stretch",
  },
});
