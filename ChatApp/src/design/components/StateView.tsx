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
};

export function StateView({
  title,
  message,
  loading = false,
  icon,
  actionLabel,
  onAction,
}: StateViewProps) {
  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.iconWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : icon ? (
        <View style={styles.iconWrap}>
          <Feather name={icon} size={28} color={colors.primary} />
        </View>
      ) : null}
      <AppText variant="heading" style={styles.center}>
        {title}
      </AppText>
      {message ? (
        <AppText variant="body" tone="secondary" style={styles.center}>
          {message}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <AppButton
          title={actionLabel}
          variant="outline"
          onPress={onAction}
          style={styles.action}
        />
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
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
    marginBottom: spacing.xs,
  },
  center: {
    textAlign: "center",
  },
  action: {
    marginTop: spacing.sm,
    minWidth: 160,
  },
});
