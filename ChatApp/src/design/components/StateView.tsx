import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { colors, radius, spacing } from "../tokens";
import { AppButton } from "./AppButton";
import { AppText } from "./AppText";

type StateViewProps = {
  title: string;
  message?: string;
  loading?: boolean;
  icon?: keyof typeof Feather.glyphMap;
  actionLabel?: string;
  onAction?: () => void;
  /** When provided alongside `loading`, render this skeleton instead of the spinner. */
  skeleton?: React.ReactNode;
  /** Compact variant: no icon wrap, smaller spacing. For inline use. */
  compact?: boolean;
};

export function StateView({
  title,
  message,
  loading = false,
  icon,
  actionLabel,
  onAction,
  skeleton,
  compact = false,
}: StateViewProps) {
  // Skeleton-first loading: callers pass a skeleton node to keep layout stable.
  if (loading && skeleton) {
    return <View style={styles.skeletonHost}>{skeleton}</View>;
  }

  return (
    <View style={compact ? styles.containerCompact : styles.container}>
      {loading ? (
        <View style={styles.iconWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : icon ? (
        <View style={[styles.iconWrap, compact && styles.iconWrapCompact]}>
          <Feather name={icon} size={compact ? 22 : 28} color={colors.textSecondary} />
        </View>
      ) : null}
      <AppText variant={compact ? "heading" : "heading"} style={styles.center}>
        {title}
      </AppText>
      {message ? (
        <AppText variant="body" tone="secondary" style={[styles.center, styles.message]}>
          {message}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <AppButton title={actionLabel} variant="outline" onPress={onAction} style={styles.action} />
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
  containerCompact: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  skeletonHost: {
    flex: 1,
    padding: spacing.lg,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
    marginBottom: spacing.xs,
  },
  iconWrapCompact: {
    width: 48,
    height: 48,
    marginBottom: 0,
  },
  center: {
    textAlign: "center",
  },
  message: {
    maxWidth: 320,
  },
  action: {
    marginTop: spacing.sm,
    minWidth: 160,
  },
});
