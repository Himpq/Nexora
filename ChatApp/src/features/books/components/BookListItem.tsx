import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { AppBadge, AppCard, AppText, colors, CoverImage, radius, spacing } from "../../../design";
import { getBookCoverUri, resolveLearningAssetUrl } from "../../../services/imageService";
import type { Book } from "../../../services/types";

type BookListItemProps = {
  book: Book;
  onPress: () => void;
  /** Optional cover URI override (e.g. resolved via `cover-assets`). */
  coverUri?: string;
};

function getBookTitle(book: Book) {
  return String(book.title || "").trim() || "未命名教材";
}

function getBookMeta(book: Book) {
  return [
    String(book.source_type || "").trim(),
    String(book.text_status || "").trim(),
    String(book.status || "").trim(),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function BookListItem({ book, onPress, coverUri }: BookListItemProps) {
  const description = String(book.description || "").trim();
  const meta = getBookMeta(book);
  const resolvedCover = coverUri
    ? resolveLearningAssetUrl(coverUri)
    : getBookCoverUri(book);

  return (
    <AppCard style={styles.card} onPress={onPress}>
      <View style={styles.header}>
        {resolvedCover ? (
          <CoverImage
            uri={resolvedCover}
            fallbackIcon="book"
            style={styles.cover}
            borderRadius={radius.md}
            resizeMode="contain"
            accessibilityLabel={getBookTitle(book)}
          />
        ) : (
          <View style={styles.cover}>
            <Feather name="book" size={18} color={colors.textInverse} />
          </View>
        )}
        <View style={styles.titleBlock}>
          <AppText variant="heading" numberOfLines={2}>
            {getBookTitle(book)}
          </AppText>
          {meta ? (
            <AppText variant="caption" tone="tertiary">
              {meta}
            </AppText>
          ) : null}
        </View>
        <AppBadge label="教材" tone="neutral" />
      </View>

      {description ? (
        <AppText tone="secondary" numberOfLines={2}>
          {description}
        </AppText>
      ) : null}

      <View style={styles.footer}>
        <AppText variant="label" tone="secondary">
          查看教材
        </AppText>
        <Feather name="arrow-right" size={16} color={colors.text} />
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  cover: {
    width: 48,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceInverse,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  titleBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderFaint,
    paddingTop: spacing.md,
  },
});
