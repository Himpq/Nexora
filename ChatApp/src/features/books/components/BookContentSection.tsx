import React, { useEffect, useMemo, useRef, useState } from "react";
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
  /**
   * Scroll ratio (0~1) to restore once content has laid out. Resolved
   * against the measured content/layout heights, then cleared so live
   * scrolling is never fought by the restore. Pass `undefined` to skip.
   */
  restoreScrollRatio?: number | null;
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
  restoreScrollRatio,
}: BookContentSectionProps) {
  const items = useMemo(() => flatten(parsed), [parsed]);
  const listRef = useRef<FlatList<ContentItem>>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const [layoutHeight, setLayoutHeight] = useState(0);
  const restoredRef = useRef(false);

  const refreshControl =
    typeof onRefresh === "function" ? (
      <RefreshControl
        refreshing={Boolean(refreshing)}
        onRefresh={onRefresh}
        tintColor={colors.textTertiary}
        colors={[colors.text]}
      />
    ) : undefined;

  // Restore the saved scroll ratio once we know the scrollable height.
  // Re-arm when the ratio target changes (e.g. a new book/mode opens).
  useEffect(() => {
    restoredRef.current = false;
  }, [restoreScrollRatio]);

  useEffect(() => {
    const ratio =
      typeof restoreScrollRatio === "number" ? restoreScrollRatio : null;
    if (restoredRef.current || ratio == null) {
      return;
    }
    const scrollable = contentHeight - layoutHeight;
    if (scrollable <= 0 || layoutHeight <= 0) {
      return;
    }
    const offset = Math.max(0, Math.min(scrollable, ratio * scrollable));
    restoredRef.current = true;
    // Defer to the next frame so the list has committed its data.
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset, animated: false });
    });
  }, [restoreScrollRatio, contentHeight, layoutHeight]);

  return (
    <FlatList
      ref={listRef}
      data={items}
      renderItem={renderItem}
      keyExtractor={(item) => item.key}
      onScroll={onScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      style={style}
      contentContainerStyle={[styles.list, contentContainerStyle]}
      onLayout={(e) => setLayoutHeight(e.nativeEvent.layout.height)}
      onContentSizeChange={(w, h) => setContentHeight(h)}
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
