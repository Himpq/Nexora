import { ScrollView, StyleSheet, View } from "react-native";

import { AnimatedPressable, AppText, Avatar, colors, spacing } from "../../../design";
import { type MentionUser } from "../mentions";

type MentionUserPickerProps = {
  users: ReadonlyArray<MentionUser>;
  onSelect: (user: MentionUser) => void;
};

/**
 * Horizontal strip of @-mention candidates shown above the composer input while
 * an "@" query is active. Tapping a face inserts `@handle ` (already blue, since
 * a picked user is by definition real). `keyboardShouldPersistTaps="handled"`
 * keeps the keyboard up so selecting doesn't bounce the composer down.
 */
export function MentionUserPicker({ users, onSelect }: MentionUserPickerProps) {
  return (
    <View style={styles.wrap}>
      {users.length === 0 ? (
        <AppText variant="caption" tone="muted" style={styles.empty}>
          未找到相关用户
        </AppText>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.row}
        >
          {users.map((user) => (
            <AnimatedPressable
              key={user.userId}
              onPress={() => onSelect(user)}
              press={{ pressedScale: 0.93 }}
              style={styles.item}
            >
              <Avatar uri={user.avatarUrl} name={user.displayName} size="lg" />
              <AppText variant="caption" tone="secondary" numberOfLines={1} style={styles.name}>
                {user.displayName}
              </AppText>
            </AnimatedPressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const ITEM_WIDTH = 60;

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderFaint,
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
  },
  row: {
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  item: {
    width: ITEM_WIDTH,
    alignItems: "center",
    gap: spacing.xs,
  },
  name: {
    maxWidth: ITEM_WIDTH,
    textAlign: "center",
  },
  empty: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
});
