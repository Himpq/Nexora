import { StyleSheet, View } from "react-native";

import { useSession } from "../../../app/providers/SessionProvider";
import { appInfo } from "../../../config/appInfo";
import { appEnv } from "../../../config/env";
import {
  AppBadge,
  AppButton,
  AppCard,
  AppText,
  colors,
  Screen,
  ScreenHeader,
  spacing,
} from "../../../design";

type DetailRowProps = {
  label: string;
  value: string;
  tone?: "primary" | "secondary" | "muted" | "danger";
  last?: boolean;
};

function DetailRow({ label, value, tone = "primary", last = false }: DetailRowProps) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText variant="label" tone={tone} style={styles.value} numberOfLines={1}>
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
      <ScreenHeader overline="Nexora" title="设置" />

      <AppCard padded={false} style={styles.card}>
        <View style={styles.cardHead}>
          <AppText variant="overline" tone="muted">
            用户上下文
          </AppText>
        </View>
        <View style={styles.cardBody}>
          <View style={styles.identityRow}>
            <View style={styles.avatar}>
              <AppText style={styles.avatarText}>
                {(username || "?").slice(0, 1).toUpperCase()}
              </AppText>
            </View>
            <View style={styles.identityText}>
              <AppText variant="heading">{username || "未登录"}</AppText>
              <AppText variant="caption" tone="muted">
                {role || "未加载"} {isAdmin ? "· 管理员" : ""}
              </AppText>
            </View>
          </View>
          <DetailRow label="context username" value={context?.username || "未加载"} />
          <DetailRow label="角色" value={role || "未加载"} last />
          {contextError ? (
            <AppText tone="danger" variant="caption" style={styles.errorText}>
              ⚠ {contextError.message}
            </AppText>
          ) : null}
        </View>
        <View style={styles.cardActions}>
          <AppButton
            title="刷新上下文"
            variant="outline"
            size="sm"
            loading={isContextLoading}
            onPress={() => void refreshContext()}
            style={styles.flexButton}
          />
          <AppButton
            title="切换用户"
            variant="ghost"
            size="sm"
            onPress={() => void clearUsername()}
            style={styles.flexButton}
          />
        </View>
      </AppCard>

      <AppCard padded={false} style={styles.card}>
        <View style={styles.cardHead}>
          <AppText variant="overline" tone="muted">
            后端连通性
          </AppText>
          <AppBadge
            label={connected ? "已连接" : "未连接"}
            tone={connected ? "success" : "danger"}
          />
        </View>
        <View style={styles.cardBody}>
          <DetailRow label="模型数量" value={String(integration?.models_count ?? 0)} />
          <DetailRow label="模型端点" value={integration?.endpoint || "未加载"} />
          <DetailRow label="Nexora 基地址" value={integration?.base_url || "未加载"} />
          <DetailRow
            label="Public API Key"
            value={integration?.has_public_api_key ? "已配置" : "未配置"}
            last
          />
          {integration?.message ? (
            <AppText variant="caption" tone="muted" style={styles.errorText}>
              {integration.message}
            </AppText>
          ) : null}
        </View>
      </AppCard>

      <AppCard padded={false} style={styles.card}>
        <View style={styles.cardHead}>
          <AppText variant="overline" tone="muted">
            应用信息
          </AppText>
        </View>
        <View style={styles.cardBody}>
          <DetailRow label="版本" value={appInfo.version} />
          <DetailRow label="Learning API" value={appEnv.nexoraLearningBaseUrl} />
          <DetailRow label="Chat API" value={appEnv.chatDBServerBaseUrl} last />
        </View>
      </AppCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  cardBody: {
    paddingHorizontal: spacing.lg,
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceInverse,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: colors.textInverse,
    fontSize: 18,
    fontWeight: "700",
  },
  identityText: {
    flex: 1,
    gap: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  value: {
    flexShrink: 1,
    textAlign: "right",
  },
  errorText: {
    paddingBottom: spacing.md,
  },
  cardActions: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.lg,
    paddingTop: spacing.sm,
  },
  flexButton: {
    flex: 1,
  },
});
