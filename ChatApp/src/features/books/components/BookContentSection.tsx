import { StyleSheet } from "react-native";

import { AppCard, AppText, colors, spacing } from "../../../design";

type BookContentSectionProps = {
  title: string;
  content: string;
};

export function BookContentSection({ title, content }: BookContentSectionProps) {
  return (
    <AppCard style={styles.card}>
      <AppText variant="heading">{title}</AppText>
      <AppText selectable style={styles.content}>
        {content}
      </AppText>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  content: {
    color: colors.text,
    lineHeight: 24,
  },
});
