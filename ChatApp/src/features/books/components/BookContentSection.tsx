import React, { useMemo } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import {
  FlatList,
  type FlatListProps,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  RefreshControl,
} from "react-native";

import { AppText, colors, spacing } from "../../../design";
import type { BookChapter, ParsedBookContent } from "../utils/parseBookContent";

type BookContentSectionProps = {
  parsed: ParsedBookContent;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: FlatListProps<unknown>["contentContainerStyle"];
};

type ChapterHeaderItem = {
  key: string;
  type: "chapter";
  name: string;
  range: string;
  summary?: string;
};
type ParagraphItem = { key: string; type: "paragraph"; text: string };
type ContentItem = ChapterHeaderItem | ParagraphItem;

function flatten(parsed: ParsedBookContent): ContentItem[] {
  if (parsed.kind === "chapters") {
    const items: ContentItem[] = [];
    parsed.chapters.forEach((chapter: BookChapter, ci) => {
      if (chapter.name || chapter.range || chapter.summary) {
        items.push({
          key: `c-${ci}`,
          type: "chapter",
          name: chapter.name,
          range: chapter.range,
          summary: chapter.summary,
        });
      }
      chapter.paragraphs.forEach((para, pi) => {
        items.push({ key: `c-${ci}-p-${pi}`, type: "paragraph", text: para });
      });
    });
    return items;
  }
  return parsed.paragraphs.map((para, pi) => ({
    key: `p-${pi}`,
    type: "paragraph",
    text: para,
  }));
}

function ReadingListItem({ item }: { item: ContentItem }) {
  if (item.type === "chapter") {
    return (
      <View style={styles.chapter}>
        {item.name ? (
          <AppText variant="heading" style={styles.chapterTitle}>
            {item.name}
          </AppText>
        ) : null}
        {item.range ? (
          <AppText variant="caption" tone="tertiary">
            {item.range}
          </AppText>
        ) : null}
        {item.summary ? (
          <AppText variant="body" tone="secondary" style={styles.summary}>
            {item.summary}
          </AppText>
        ) : null}
      </View>
    );
  }
  return (
    <AppText selectable style={styles.paragraph}>
      {item.text}
    </AppText>
  );
}

const renderItem = ({ item }: { item: ContentItem }) => <ReadingListItem item={item} />;

function BookContentSectionInner({
  parsed,
  onScroll,
  refreshing,
  onRefresh,
  style,
  contentContainerStyle,
}: BookContentSectionProps) {
  const items = useMemo(() => flatten(parsed), [parsed]);
  const refreshControl =
    typeof onRefresh === "function" ? (
      <RefreshControl
        refreshing={Boolean(refreshing)}
        onRefresh={onRefresh}
        tintColor={colors.textTertiary}
        colors={[colors.text]}
      />
    ) : undefined;

  return (
    <FlatList
      data={items}
      renderItem={renderItem}
      keyExtractor={(item) => item.key}
      onScroll={onScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      style={style}
      contentContainerStyle={[styles.list, contentContainerStyle]}
      refreshControl={refreshControl}
    />
  );
}

export const BookContentSection = React.memo(BookContentSectionInner);

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
    paddingBottom: spacing.xl,
  },
  chapter: {
    gap: spacing.xs,
    marginTop: spacing.lg,
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
