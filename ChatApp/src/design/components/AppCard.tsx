import React from "react";
import { StyleSheet, View, ViewProps } from "react-native";

import { colors, radius, shadow, spacing } from "../tokens";

type AppCardProps = ViewProps & {
  variant?: "elevated" | "outlined" | "muted" | "flat";
  padded?: boolean;
};

export function AppCard({
  variant = "elevated",
  padded = true,
  style,
  ...props
}: AppCardProps) {
  return (
    <View
      {...props}
      style={[styles.base, padded && styles.padded, variantStyles[variant], style]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  padded: {
    padding: spacing.lg,
  },
});

const variantStyles = StyleSheet.create({
  elevated: {
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  outlined: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  muted: {
    backgroundColor: colors.surfaceMuted,
  },
  flat: {
    backgroundColor: colors.surface,
  },
});
