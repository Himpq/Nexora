import React from "react";
import { StyleSheet, View, ViewProps } from "react-native";

import { colors, radius, spacing } from "../tokens";

export function AppCard({ style, ...props }: ViewProps) {
  return <View {...props} style={[styles.card, style]} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
  },
});
