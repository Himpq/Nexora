import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { RootNavigator } from "../navigation/RootNavigator";
import { ApiProvider } from "./providers/ApiProvider";

export function AppBootstrap() {
  return (
    <SafeAreaProvider>
      <ApiProvider>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
      </ApiProvider>
    </SafeAreaProvider>
  );
}
