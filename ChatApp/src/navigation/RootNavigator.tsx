import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { useSession } from "../app/providers/SessionProvider";
import { StateView, Screen } from "../design";
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
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MainTabs" component={MainTabs} />
    </Stack.Navigator>
  );
}
