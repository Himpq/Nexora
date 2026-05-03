import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import { ConversationScreen } from "../features/chat/screens/ConversationScreen";
import { CourseListScreen } from "../features/courses/screens/CourseListScreen";
import { DashboardScreen } from "../features/dashboard/screens/DashboardScreen";
import { SettingsScreen } from "../features/settings/screens/SettingsScreen";
import type { MainTabParamList } from "./types";

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: "学习" }} />
      <Tab.Screen name="Courses" component={CourseListScreen} options={{ title: "课程" }} />
      <Tab.Screen name="Chat" component={ConversationScreen} options={{ title: "问答" }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: "设置" }} />
    </Tab.Navigator>
  );
}
