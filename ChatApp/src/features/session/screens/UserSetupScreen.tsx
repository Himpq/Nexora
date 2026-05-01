import { StyleSheet, TextInput } from "react-native";

import { AppButton, AppCard, AppText, Screen, colors, spacing } from "../../../design";

export function UserSetupScreen() {
  return (
    <Screen>
      <AppCard style={styles.card}>
        <AppText variant="title">Nexora</AppText>
        <AppText tone="secondary">
          用户上下文切片将在 0.2.0 接入 username、session 和 frontend context。
        </AppText>
        <TextInput
          placeholder="username"
          autoCapitalize="none"
          autoCorrect={false}
          editable={false}
          style={styles.input}
        />
        <AppButton title="0.2.0 接入" disabled />
      </AppCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.lg,
  },
  input: {
    minHeight: 46,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
});
