import {
  DefaultTheme,
  NavigationContainer,
  type Theme,
} from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors } from "../design";
import { RootNavigator } from "../navigation/RootNavigator";
import { ApiProvider } from "./providers/ApiProvider";
import { SessionProvider } from "./providers/SessionProvider";

const navigationTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.primary,
  },
};

export function AppBootstrap() {
  return (
    <SafeAreaProvider>
      <ApiProvider>
        <SessionProvider>
          <NavigationContainer theme={navigationTheme}>
            <RootNavigator />
          </NavigationContainer>
        </SessionProvider>
      </ApiProvider>
    </SafeAreaProvider>
  );
}
