import React from "react";
import { StyleSheet, Text, TextProps } from "react-native";

import { colors, typography } from "../tokens";

type AppTextProps = TextProps & {
  variant?: "title" | "heading" | "body" | "caption";
  tone?: "primary" | "secondary" | "muted" | "danger";
};

export function AppText({
  variant = "body",
  tone = "primary",
  style,
  ...props
}: AppTextProps) {
  return <Text {...props} style={[styles.base, styles[variant], toneStyles[tone], style]} />;
}

const styles = StyleSheet.create({
  base: {
    color: colors.text,
    letterSpacing: 0,
  },
  title: {
    fontSize: typography.title,
    fontWeight: "700",
  },
  heading: {
    fontSize: typography.heading,
    fontWeight: "700",
  },
  body: {
    fontSize: typography.body,
    lineHeight: 22,
  },
  caption: {
    fontSize: typography.caption,
    lineHeight: 17,
  },
});

const toneStyles = StyleSheet.create({
  primary: {
    color: colors.text,
  },
  secondary: {
    color: colors.textSecondary,
  },
  muted: {
    color: colors.textMuted,
  },
  danger: {
    color: colors.danger,
  },
});
