import { Feather } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Platform, StyleSheet } from "react-native";

import { useSession } from "../app/providers/SessionProvider";
import { colors, shadow, spacing, typography } from "../design";
import { AdminHomeScreen } from "../features/admin/screens/AdminHomeScreen";
import { ConversationScreen } from "../features/chat/screens/ConversationScreen";
import { CourseListScreen } from "../features/courses/screens/CourseListScreen";
import { DashboardScreen } from "../features/dashboard/screens/DashboardScreen";
import { LearningFeedScreen } from "../features/feed/screens/LearningFeedScreen";
import { SettingsScreen } from "../features/settings/screens/SettingsScreen";
import type { MainTabParamList } from "./types";

const Tab = createBottomTabNavigator<MainTabParamList>();

function tabIcon(name: keyof typeof Feather.glyphMap) {
  return function TabIcon({ focused, color }: { focused: boolean; color: string }) {
    return <Feather name={name} size={22} color={color} style={{ opacity: focused ? 1 : 0.6 }} />;
  };
}

export function MainTabs() {
  const { isAdmin } = useSession();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ title: "学习", tabBarIcon: tabIcon("home") }}
      />
      <Tab.Screen
        name="Courses"
        component={CourseListScreen}
        options={{ title: "课程", tabBarIcon: tabIcon("book") }}
      />
      <Tab.Screen
        name="Feed"
        component={LearningFeedScreen}
        options={{ title: "动态", tabBarIcon: tabIcon("activity") }}
      />
      <Tab.Screen
        name="Chat"
        component={ConversationScreen}
        options={{ title: "问答", tabBarIcon: tabIcon("message-circle") }}
      />
      {isAdmin ? (
        <Tab.Screen
          name="Admin"
          component={AdminHomeScreen}
          options={{ title: "管理", tabBarIcon: tabIcon("settings") }}
        />
      ) : null}
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: "设置", tabBarIcon: tabIcon("user") }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    height: Platform.OS === "ios" ? 88 : 64,
    paddingTop: spacing.sm,
    paddingBottom: Platform.OS === "ios" ? spacing.xl : spacing.sm,
    ...shadow.md,
  },
  tabItem: {
    paddingTop: spacing.xs,
  },
  tabLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
  },
});
