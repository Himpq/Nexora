import React from "react";
import { StyleSheet, View, ViewStyle, StyleProp } from "react-native";

import { colors, radius, spacing } from "../tokens";
import { AppText } from "./AppText";

type AppBadgeProps = {
  label: string;
  tone?: "neutral" | "solid" | "muted" | "success" | "warning" | "danger";
  style?: StyleProp<ViewStyle>;
};

export function AppBadge({ label, tone = "neutral", style }: AppBadgeProps) {
  return (
    <View style={[styles.base, containerStyles[tone], style]}>
      <AppText variant="overline" style={textStyles[tone]}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
  },
});

const containerStyles = StyleSheet.create({
  neutral: { backgroundColor: colors.surfaceMuted },
  solid: { backgroundColor: colors.primary },
  muted: { backgroundColor: colors.surfaceMuted },
  success: { backgroundColor: colors.successMuted },
  warning: { backgroundColor: colors.warningMuted },
  danger: { backgroundColor: colors.dangerMuted },
});

const textStyles = StyleSheet.create({
  neutral: { color: colors.textSecondary },
  solid: { color: colors.onPrimary },
  muted: { color: colors.textMuted },
  success: { color: colors.success },
  warning: { color: colors.warning },
  danger: { color: colors.danger },
});
