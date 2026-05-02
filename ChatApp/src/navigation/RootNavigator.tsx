import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { useSession } from "../app/providers/SessionProvider";
import { StateView, Screen } from "../design";
import { BookDetailScreen } from "../features/books/screens/BookDetailScreen";
import { BookReaderScreen } from "../features/books/screens/BookReaderScreen";
import { CourseDetailScreen } from "../features/courses/screens/CourseDetailScreen";
import { UserSetupScreen } from "../features/session/screens/UserSetupScreen";
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
    return <UserSetupScreen />;
  }

  return (
    <Stack.Navigator>
      <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
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
