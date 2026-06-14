import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { useSession } from "../app/providers/SessionProvider";
import { colors, StateView, Screen, typography } from "../design";
import { AdminHomeScreen } from "../features/admin/screens/AdminHomeScreen";
import { BookUploadScreen } from "../features/admin/screens/BookUploadScreen";
import { RefinementQueueScreen } from "../features/admin/screens/RefinementQueueScreen";
import { VectorizeScreen } from "../features/admin/screens/VectorizeScreen";
import { BookDetailScreen } from "../features/books/screens/BookDetailScreen";
import { BookReaderScreen } from "../features/books/screens/BookReaderScreen";
import { CourseDetailScreen } from "../features/courses/screens/CourseDetailScreen";
import { LoginScreen } from "../features/session/screens/LoginScreen";
import { MainTabs } from "./MainTabs";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { username, isBootstrapping } = useSession();

  if (isBootstrapping) {
    return (
      <Screen>
        <StateView title="正在加载" message="正在恢复用户上下文..." loading />
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
        name="Vectorize"
        component={VectorizeScreen}
        options={{ title: "向量化" }}
      />
      <Stack.Screen
        name="CourseDetail"
        component={CourseDetailScreen}
        options={({ route }) => ({
          title: route.params.lectureTitle || "课程详情",
        })}
      />
      <Stack.Screen
        name="BookDetail"
        component={BookDetailScreen}
        options={({ route }) => ({
          title: route.params.bookTitle || "教材详情",
        })}
      />
      <Stack.Screen
        name="BookReader"
        component={BookReaderScreen}
        options={({ route }) => ({
          title: route.params.bookTitle || "教材阅读",
        })}
      />
    </Stack.Navigator>
  );
}
