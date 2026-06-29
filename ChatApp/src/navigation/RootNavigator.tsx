import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { useSession } from "../app/providers/SessionProvider";
import { colors, Screen, Skeleton, spacing, typography } from "../design";
import { AdminHomeScreen } from "../features/admin/screens/AdminHomeScreen";
import { BookUploadScreen } from "../features/admin/screens/BookUploadScreen";
import { RefinementQueueScreen } from "../features/admin/screens/RefinementQueueScreen";
import { RuntimeMemoryScreen } from "../features/admin/screens/RuntimeMemoryScreen";
import { VectorizeScreen } from "../features/admin/screens/VectorizeScreen";
import { BookDetailScreen } from "../features/books/screens/BookDetailScreen";
import { BookReaderScreen } from "../features/books/screens/BookReaderScreen";
import { CourseDetailScreen } from "../features/courses/screens/CourseDetailScreen";
import { LoginScreen } from "../features/session/screens/LoginScreen";
import { MainTabs } from "./MainTabs";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { username, isBootstrapping, isAdmin } = useSession();

  if (isBootstrapping) {
    return (
      <Screen scroll>
        <Skeleton width="40%" height={28} style={{ marginBottom: spacing.lg }} />
        <Skeleton height={120} borderRadius={16} style={{ marginBottom: spacing.lg }} />
        <Skeleton height={88} borderRadius={16} style={{ marginBottom: spacing.lg }} />
        <Skeleton height={180} borderRadius={16} />
      </Screen>
    );
  }

  if (!username) {
    return <LoginScreen />;
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerShadowVisible: false,
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontSize: typography.heading.fontSize,
          fontWeight: "700",
          color: colors.text,
        },
        headerBackTitle: "",
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
      {isAdmin ? (
        <>
          <Stack.Screen
            name="AdminHome"
            component={AdminHomeScreen}
            options={{ title: "内容管理" }}
          />
          <Stack.Screen
            name="BookUpload"
            component={BookUploadScreen}
            options={{ title: "上传教材" }}
          />
          <Stack.Screen
            name="RefinementQueue"
            component={RefinementQueueScreen}
            options={{ title: "提炼队列" }}
          />
          <Stack.Screen
            name="RuntimeMemory"
            component={RuntimeMemoryScreen}
            options={{ title: "Runtime / 记忆" }}
          />
          <Stack.Screen
            name="Vectorize"
            component={VectorizeScreen}
            options={{ title: "向量化" }}
          />
        </>
      ) : null}
      <Stack.Screen
        name="CourseDetail"
        component={CourseDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="BookDetail"
        component={BookDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="BookReader"
        component={BookReaderScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
