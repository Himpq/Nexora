import { useNavigation, type CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Pressable, StyleSheet, View } from "react-native";

import {
  AppCard,
  AppText,
  colors,
  radius,
  Screen,
  ScreenHeader,
  spacing,
} from "../../../design";
import type { MainTabParamList, RootStackParamList } from "../../../navigation/types";

type AdminNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, "Admin">,
  NativeStackNavigationProp<RootStackParamList>
>;

type AdminAction = {
  key: string;
  glyph: string;
  title: string;
  description: string;
  onPress: (navigation: AdminNavigation) => void;
};

const ADMIN_ACTIONS: AdminAction[] = [
  {
    key: "upload",
    glyph: "↥",
    title: "上传教材",
    description: "上传新的教材文件并触发解析。",
    onPress: (navigation) => navigation.navigate("BookUpload"),
  },
  {
    key: "refine",
    glyph: "⚗",
    title: "提炼队列",
    description: "查看并处理概读与精读提炼任务。",
    onPress: (navigation) => navigation.navigate("RefinementQueue"),
  },
  {
    key: "feed",
    glyph: "◈",
    title: "学习动态",
    description: "管理频道与社区学习动态。",
    onPress: (navigation) => navigation.navigate("MainTabs", { screen: "Feed" }),
  },
  {
    key: "vectorize",
    glyph: "⊞",
    title: "向量化监控",
    description: "监控教材向量化处理状态。",
    onPress: (navigation) => navigation.navigate("Vectorize"),
  },
];

export function AdminHomeScreen() {
  const navigation = useNavigation<AdminNavigation>();

  return (
    <Screen scroll>
      <ScreenHeader
        overline="Admin"
        title="内容管理"
        subtitle="教材上传、提炼队列和向量化状态"
      />

      <AppCard variant="muted">
        <AppText variant="caption" tone="muted">
          管理端切片应在学习者主路径稳定后实现，包括教材上传、提炼队列和向量化状态。
        </AppText>
      </AppCard>

      {ADMIN_ACTIONS.map((action) => (
        <Pressable
          key={action.key}
          onPress={() => action.onPress(navigation)}
          style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
        >
          <AppCard style={styles.actionCard}>
            <View style={styles.glyphBox}>
              <AppText style={styles.glyph}>{action.glyph}</AppText>
            </View>
            <View style={styles.copy}>
              <AppText variant="heading">{action.title}</AppText>
              <AppText variant="caption" tone="muted">
                {action.description}
              </AppText>
            </View>
            <AppText style={styles.chevron} tone="muted">
              ›
            </AppText>
          </AppCard>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
  },
  pressed: {
    opacity: 0.7,
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
  glyph: {
    fontSize: 20,
    color: colors.textInverse,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  chevron: {
    fontSize: 28,
    lineHeight: 28,
  },
});
