import React from "react";
import { StyleSheet, View } from "react-native";

import { spacing } from "../tokens";
import { AppText } from "./AppText";

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  overline?: string;
  trailing?: React.ReactNode;
};

export function ScreenHeader({ title, subtitle, overline, trailing }: ScreenHeaderProps) {
  return (
    <View style={styles.container}>
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
    gap: spacing.md,
  },
  text: {
    flex: 1,
    gap: spacing.xs,
  },
  trailing: {
    paddingTop: spacing.xs,
  },
});
