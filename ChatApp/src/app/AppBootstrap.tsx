import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { RootNavigator } from "../navigation/RootNavigator";
import { ApiProvider } from "./providers/ApiProvider";
import { SessionProvider } from "./providers/SessionProvider";

export function AppBootstrap() {
  return (
    <SafeAreaProvider>
      <ApiProvider>
        <SessionProvider>
          <NavigationContainer>
            <RootNavigator />
          </NavigationContainer>
        </SessionProvider>
      </ApiProvider>
    </SafeAreaProvider>
  );
}
