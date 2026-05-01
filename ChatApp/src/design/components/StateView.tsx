import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { colors, spacing } from "../tokens";
import { AppButton } from "./AppButton";
import { AppText } from "./AppText";

type StateViewProps = {
  title: string;
  message?: string;
  loading?: boolean;
  actionLabel?: string;
  onAction?: () => void;
};

export function StateView({
  title,
  message,
  loading = false,
  actionLabel,
  onAction,
}: StateViewProps) {
  return (
    <View style={styles.container}>
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      <AppText variant="heading">{title}</AppText>
      {message ? (
        <AppText variant="body" tone="secondary" style={styles.message}>
          {message}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <AppButton title={actionLabel} variant="secondary" onPress={onAction} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  message: {
    textAlign: "center",
  },
});
