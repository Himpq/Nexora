import { StyleSheet, View } from "react-native";

import { AppButton, AppCard, AppText, colors, spacing } from "../../../design";
import type { Book } from "../../../services/types";

type BookListItemProps = {
  book: Book;
  onPress: () => void;
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

export function BookListItem({ book, onPress }: BookListItemProps) {
  const description = String(book.description || "").trim();
  const meta = getBookMeta(book);

  return (
    <AppCard style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <AppText variant="heading">{getBookTitle(book)}</AppText>
          {meta ? (
            <AppText variant="caption" tone="secondary">
              {meta}
            </AppText>
          ) : null}
        </View>
        <View style={styles.badge}>
          <AppText variant="caption" style={styles.badgeText}>
            教材
          </AppText>
        </View>
      </View>

      {description ? (
        <AppText tone="secondary" numberOfLines={3}>
          {description}
        </AppText>
      ) : null}

      <AppButton title="查看教材" onPress={onPress} style={styles.button} />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
  },
  titleBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  badge: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  badgeText: {
    color: colors.textMuted,
    fontWeight: "700",
  },
  button: {
    alignSelf: "stretch",
  },
});
