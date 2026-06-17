import React from "react";
import { StyleSheet, Text, TextProps } from "react-native";

import { colors, typography } from "../tokens";

type AppTextProps = TextProps & {
  variant?: "display" | "displayLg" | "title" | "heading" | "body" | "bodyStrong" | "caption" | "label" | "overline";
  tone?: "primary" | "secondary" | "tertiary" | "muted" | "inverse" | "inverseMuted" | "danger" | "success";
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
  displayLg: typography.displayLg,
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
  tertiary: { color: colors.textTertiary },
  muted: { color: colors.textMuted },
  inverse: { color: colors.textInverse },
  inverseMuted: { color: colors.textInverseMuted },
  danger: { color: colors.danger },
  success: { color: colors.success },
});
