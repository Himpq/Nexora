import { Alert, StyleSheet, View } from "react-native";

import { useSession } from "../../../app/providers/SessionProvider";
import { appInfo } from "../../../config/appInfo";
import {
  AppBadge,
  AppButton,
  AppCard,
  AppText,
  Avatar,
  colors,
  DetailRow,
  FadeIn,
  haptics,
  Screen,
  ScreenHeader,
  spacing,
} from "../../../design";

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
  const avatarUrl = String(
    context?.user?.avatar_url
      || (context?.user as { avatar?: unknown } | undefined)?.avatar
      || "",
  ).trim();

  const handleLogout = () => {
    Alert.alert("退出登录", "确定要退出当前账号吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "退出登录",
        style: "destructive",
        onPress: () => {
          haptics.impact("medium");
          void clearUsername();
        },
      },
    ]);
  };

  return (
    <Screen scroll tabBarSpace>
      <FadeIn index={0}>
        <ScreenHeader overline="Nexora" title="我的" />
      </FadeIn>

      <FadeIn index={1}>
      <AppCard padded={false} style={styles.card}>
        <View style={styles.cardBody}>
          <View style={styles.identityRow}>
            <Avatar uri={avatarUrl} name={username || "?"} size="lg" />
            <View style={styles.identityText}>
              <AppText variant="heading">{username || "未登录"}</AppText>
              <AppText variant="caption" tone="tertiary">
                {role || "学习者"} {isAdmin ? "· 管理员" : ""}
              </AppText>
            </View>
            {isAdmin ? <AppBadge label="Admin" tone="solid" /> : null}
          </View>
          {contextError ? (
            <AppText tone="danger" variant="caption" style={styles.errorText}>
              ⚠ 上下文加载失败，请刷新重试
            </AppText>
          ) : null}
        </View>
        <View style={styles.cardActions}>
          <AppButton
            title="刷新"
            variant="outline"
            size="sm"
            haptic="light"
            loading={isContextLoading}
            onPress={() => void refreshContext()}
            style={styles.flexButton}
          />
          <AppButton
            title="退出登录"
            variant="ghost"
            size="sm"
            haptic="medium"
            onPress={handleLogout}
            style={styles.flexButton}
          />
        </View>
      </AppCard>
      </FadeIn>

      <FadeIn index={2}>
      <AppCard padded={false} style={styles.card}>
        <View style={styles.cardHead}>
          <AppText variant="overline" tone="tertiary">
            应用信息
          </AppText>
        </View>
        <View style={styles.cardBody}>
          <DetailRow label="版本" value={appInfo.version} last />
        </View>
      </AppCard>
      </FadeIn>
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
    paddingVertical: spacing.lg,
  },
  identityText: {
    flex: 1,
    gap: 2,
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
