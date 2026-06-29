import { StyleSheet, View } from "react-native";

import { colors, spacing } from "../tokens";
import { AppText } from "./AppText";

export type DetailRowProps = {
  label: string;
  value: string;
  tone?: "primary" | "secondary" | "muted" | "danger";
  last?: boolean;
};

export function DetailRow({ label, value, tone = "primary", last = false }: DetailRowProps) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <AppText variant="caption" tone="tertiary">
        {label}
      </AppText>
      <AppText variant="label" tone={tone} style={styles.value} numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  value: {
    flexShrink: 1,
    textAlign: "right",
  },
});
