import { Feather } from "@expo/vector-icons";
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
} from "@react-navigation/bottom-tabs";
import { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { useSession } from "../app/providers/SessionProvider";
import { AppText, colors, haptics, motion, radius, shadow, spacing } from "../design";
import { AdminHomeScreen } from "../features/admin/screens/AdminHomeScreen";
import { ConversationScreen } from "../features/chat/screens/ConversationScreen";
import { CourseListScreen } from "../features/courses/screens/CourseListScreen";
import { DashboardScreen } from "../features/dashboard/screens/DashboardScreen";
import { LearningFeedScreen } from "../features/feed/screens/LearningFeedScreen";
import { SettingsScreen } from "../features/settings/screens/SettingsScreen";
import type { MainTabParamList } from "./types";

const Tab = createBottomTabNavigator<MainTabParamList>();

const ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  Dashboard: "home",
  Courses: "book-open",
  Feed: "activity",
  Chat: "message-circle",
  Admin: "shield",
  Settings: "user",
};

const LABELS: Record<string, string> = {
  Dashboard: "学习",
  Courses: "课程",
  Feed: "动态",
  Chat: "问答",
  Admin: "管理",
  Settings: "我的",
};

function TabButton({
  routeName,
  focused,
  onPress,
}: {
  routeName: string;
  focused: boolean;
  onPress: () => void;
}) {
  const active = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    active.value = withSpring(focused ? 1 : 0, motion.spring.snappy);
  }, [active, focused]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: active.value,
    transform: [{ scale: 0.8 + active.value * 0.2 }],
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -active.value * 1 }, { scale: 1 + active.value * 0.04 }],
  }));

  return (
    <Pressable style={styles.tabItem} onPress={onPress} hitSlop={6}>
      <Animated.View style={[styles.pill, pillStyle]} pointerEvents="none" />
      <Animated.View style={iconStyle}>
        <Feather
          name={ICONS[routeName] ?? "circle"}
          size={21}
          color={focused ? colors.text : colors.textMuted}
        />
      </Animated.View>
      <AppText
        variant="caption"
        style={[styles.label, { color: focused ? colors.text : colors.textMuted }]}
      >
        {LABELS[routeName] ?? routeName}
      </AppText>
    </Pressable>
  );
}

function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.barWrap, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              haptics.selection();
              navigation.navigate(route.name);
            }
          };
          return (
            <TabButton
              key={route.key}
              routeName={route.name}
              focused={focused}
              onPress={onPress}
            />
          );
        })}
      </View>
    </View>
  );
}

export function MainTabs() {
  const { isAdmin } = useSession();

  return (
    <Tab.Navigator
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Courses" component={CourseListScreen} />
      <Tab.Screen name="Feed" component={LearningFeedScreen} />
      <Tab.Screen name="Chat" component={ConversationScreen} />
      {isAdmin ? <Tab.Screen name="Admin" component={AdminHomeScreen} /> : null}
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  barWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    backgroundColor: "transparent",
  },
  bar: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderFaint,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    ...shadow.lg,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: spacing.xs,
  },
  pill: {
    position: "absolute",
    top: 2,
    bottom: 2,
    left: spacing.sm,
    right: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
  },
});
