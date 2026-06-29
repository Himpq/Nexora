import React from "react";
import { StyleSheet, View } from "react-native";

import { spacing } from "../tokens";
import { AppText } from "./AppText";

type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
};

export function SectionHeader({ title, subtitle, trailing }: SectionHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.text}>
        <AppText variant="heading">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing ? <View>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  text: {
    flex: 1,
    gap: 2,
  },
});
