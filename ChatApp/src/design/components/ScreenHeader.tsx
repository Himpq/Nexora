import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { colors, spacing } from "../tokens";
import { AppText } from "./AppText";

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  overline?: string;
  trailing?: React.ReactNode;
  /** When provided, renders a back chevron to the left of the title. */
  onBack?: () => void;
};

export function ScreenHeader({ title, subtitle, overline, trailing, onBack }: ScreenHeaderProps) {
  return (
    <View style={styles.container}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={12}
          accessibilityLabel="返回"
          accessibilityRole="button"
          style={styles.back}
        >
          <Feather name="chevron-left" size={26} color={colors.text} />
        </Pressable>
      ) : null}
      <View style={styles.text}>
        {overline ? (
          <AppText variant="overline" tone="muted">
            {overline}
          </AppText>
        ) : null}
        <AppText variant="title">{title}</AppText>
        {subtitle ? (
          <AppText variant="body" tone="secondary">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -spacing.xs,
    marginTop: -spacing.xs,
  },
  text: {
    flex: 1,
    gap: spacing.xs,
  },
  trailing: {
    paddingTop: spacing.xs,
  },
});
