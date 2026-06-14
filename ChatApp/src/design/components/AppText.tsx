import React from "react";
import { StyleSheet, Text, TextProps } from "react-native";

import { colors, typography } from "../tokens";

type AppTextProps = TextProps & {
  variant?: "display" | "title" | "heading" | "body" | "bodyStrong" | "caption" | "label" | "overline";
  tone?: "primary" | "secondary" | "muted" | "inverse" | "danger" | "success";
};

export function AppText({
  variant = "body",
  tone = "primary",
  style,
  ...props
}: AppTextProps) {
  return <Text {...props} style={[styles[variant], toneStyles[tone], style]} />;
}

const styles = StyleSheet.create({
  display: typography.display,
  title: typography.title,
  heading: typography.heading,
  body: typography.body,
  bodyStrong: typography.bodyStrong,
  caption: typography.caption,
  label: typography.label,
  overline: { ...typography.overline, textTransform: "uppercase" },
});

const toneStyles = StyleSheet.create({
  primary: { color: colors.text },
  secondary: { color: colors.textSecondary },
  muted: { color: colors.textMuted },
  inverse: { color: colors.textInverse },
  danger: { color: colors.danger },
  success: { color: colors.success },
});
