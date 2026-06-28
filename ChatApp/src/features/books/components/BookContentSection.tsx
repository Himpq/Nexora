import React from "react";
import { StyleSheet, View } from "react-native";

import { AppCard, AppText, colors, spacing } from "../../../design";
import type { ParsedBookContent } from "../utils/parseBookContent";

type BookContentSectionProps = {
  title: string;
  parsed: ParsedBookContent;
};

export function BookContentSection({ title, parsed }: BookContentSectionProps) {
  return (
    <AppCard style={styles.card}>
      <AppText variant="overline" tone="tertiary">
        {title}
      </AppText>
      {parsed.kind === "chapters" ? (
        <View>
          {parsed.chapters.map((chapter, ci) => (
            <View key={`chapter-${ci}`} style={styles.chapter}>
              {chapter.name ? (
                <AppText variant="heading" style={styles.chapterTitle}>
                  {chapter.name}
                </AppText>
              ) : null}
              {chapter.range ? (
                <AppText variant="caption" tone="tertiary">
                  {chapter.range}
                </AppText>
              ) : null}
              {chapter.summary ? (
                <AppText variant="body" tone="secondary" style={styles.summary}>
                  {chapter.summary}
                </AppText>
              ) : null}
              {chapter.paragraphs.map((para, pi) => (
                <AppText key={`p-${ci}-${pi}`} selectable style={styles.paragraph}>
                  {para}
                </AppText>
              ))}
            </View>
          ))}
        </View>
      ) : (
        <View>
          {parsed.paragraphs.map((para, pi) => (
            <AppText key={`p-${pi}`} selectable style={styles.paragraph}>
              {para}
            </AppText>
          ))}
        </View>
      )}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  chapter: {
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  chapterTitle: {
    marginTop: spacing.xs,
  },
  summary: {
    marginTop: spacing.xs,
  },
  paragraph: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 28,
    letterSpacing: 0.1,
    marginTop: spacing.sm,
  },
});
