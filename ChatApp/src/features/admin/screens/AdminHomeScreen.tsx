import { useNavigation, type CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import {
  AnimatedPressable,
  AppBadge,
  AppCard,
  AppText,
  colors,
  DetailRow,
  FadeIn,
  radius,
  Screen,
  ScreenHeader,
  spacing,
} from "../../../design";
import { useSession } from "../../../app/providers/SessionProvider";
import { appEnv } from "../../../config/env";
import type { MainTabParamList, RootStackParamList } from "../../../navigation/types";

type AdminNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, "Admin">,
  NativeStackNavigationProp<RootStackParamList>
>;

type AdminAction = {
  key: string;
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description: string;
  onPress: (navigation: AdminNavigation) => void;
};

const ADMIN_ACTIONS: AdminAction[] = [
  {
    key: "upload",
    icon: "upload-cloud",
    title: "上传教材",
    description: "上传新的教材文件并触发解析。",
    onPress: (navigation) => navigation.navigate("BookUpload"),
  },
  {
    key: "refine",
    icon: "filter",
    title: "提炼队列",
    description: "查看并处理概读与精读提炼任务。",
    onPress: (navigation) => navigation.navigate("RefinementQueue"),
  },
  {
    key: "runtime",
    icon: "activity",
    title: "Runtime / 记忆",
    description: "长上下文与学习画像记忆控制台。",
    onPress: (navigation) => navigation.navigate("RuntimeMemory"),
  },
  {
    key: "feed",
    icon: "rss",
    title: "学习动态",
    description: "管理频道与社区学习动态。",
    onPress: (navigation) => navigation.navigate("MainTabs", { screen: "Feed" }),
  },
  {
    key: "vectorize",
    icon: "cpu",
    title: "向量化监控",
    description: "监控教材向量化处理状态。",
    onPress: (navigation) => navigation.navigate("Vectorize"),
  },
];

export function AdminHomeScreen() {
  const navigation = useNavigation<AdminNavigation>();
  const { context } = useSession();
  const integration = context?.integration || null;
  const connected = Boolean(integration?.connected);
  const role = String(context?.user?.role || "").trim();

  return (
    <Screen scroll tabBarSpace>
      <FadeIn index={0}>
        <ScreenHeader
          overline="Admin"
          title="内容管理"
          subtitle="教材上传、提炼队列和向量化状态"
        />
      </FadeIn>

      {ADMIN_ACTIONS.map((action, index) => (
        <FadeIn key={action.key} index={index + 1}>
          <AnimatedPressable onPress={() => action.onPress(navigation)} style={styles.wrap}>
            <AppCard style={styles.actionCard}>
              <View style={styles.glyphBox}>
                <Feather name={action.icon} size={20} color={colors.textInverse} />
              </View>
              <View style={styles.copy}>
                <AppText variant="heading">{action.title}</AppText>
                <AppText variant="caption" tone="tertiary">
                  {action.description}
                </AppText>
              </View>
              <Feather name="chevron-right" size={20} color={colors.textTertiary} />
            </AppCard>
          </AnimatedPressable>
        </FadeIn>
      ))}

      <FadeIn index={ADMIN_ACTIONS.length + 1}>
        <AppCard padded={false} style={styles.diagCard}>
          <View style={styles.diagHead}>
            <AppText variant="overline" tone="tertiary">
              系统诊断
            </AppText>
            <AppBadge
              label={connected ? "已连接" : "未连接"}
              tone={connected ? "success" : "danger"}
            />
          </View>
          <View style={styles.diagBody}>
            <DetailRow label="模型数量" value={String(integration?.models_count ?? 0)} />
            <DetailRow label="模型端点" value={integration?.endpoint || "未加载"} />
            <DetailRow label="Nexora 基地址" value={integration?.base_url || "未加载"} />
            <DetailRow
              label="Public API Key"
              value={integration?.has_public_api_key ? "已配置" : "未配置"}
            />
            <DetailRow label="Learning API" value={appEnv.nexoraLearningBaseUrl} />
            <DetailRow label="Chat API" value={appEnv.chatDBServerBaseUrl} />
            <DetailRow label="context username" value={context?.username || "未加载"} />
            <DetailRow label="角色" value={role || "未加载"} last />
            {integration?.message ? (
              <AppText variant="caption" tone="tertiary" style={styles.diagMessage}>
                {integration.message}
              </AppText>
            ) : null}
          </View>
        </AppCard>
      </FadeIn>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
  },
  actionCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  glyphBox: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceInverse,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  diagCard: {
    overflow: "hidden",
  },
  diagHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  diagBody: {
    paddingHorizontal: spacing.lg,
  },
  diagMessage: {
    paddingVertical: spacing.md,
  },
});
