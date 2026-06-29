import React from "react";
import { StyleSheet, View, ViewProps } from "react-native";

import { spacing } from "../tokens";
import { SectionHeader } from "./SectionHeader";

type SectionProps = ViewProps & {
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  /** Drop the top margin on the first section of a screen. */
  first?: boolean;
};

/**
 * Groups a section header with its content and adds vertical rhythm: a larger
 * gap above separates major sections, while a tighter gap inside keeps a
 * header close to its content. Pair with Screen's uniform child gap to get
 * "section > element" hierarchy instead of a flat 16px everywhere.
 */
export function Section({
  title,
  subtitle,
  trailing,
  first = false,
  style,
  children,
  ...props
}: SectionProps) {
  return (
    <View style={[styles.section, first && styles.first, style]} {...props}>
      <SectionHeader title={title} subtitle={subtitle} trailing={trailing} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  first: {
    marginTop: 0,
  },
});
