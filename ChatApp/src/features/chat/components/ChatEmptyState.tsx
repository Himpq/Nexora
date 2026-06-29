import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { AppText, colors, radius, shadow, spacing } from "../../../design";

const SUGGESTIONS: Array<{ icon: keyof typeof Feather.glyphMap; text: string }> = [
  { icon: "edit-3", text: "帮我润色一段文字" },
  { icon: "code", text: "解释这段代码的作用" },
  { icon: "book-open", text: "用通俗的话解释一个概念" },
  { icon: "zap", text: "给我几个有创意的点子" },
];

export function ChatEmptyState({
  username,
  onPick,
  showLogo = true,
}: {
  username?: string;
  onPick: (prompt: string) => void;
  /** Hide the brand mark inside compact surfaces (e.g. the floating panel). */
  showLogo?: boolean;
}) {
  return (
    <View style={styles.wrap}>
      {showLogo ? (
        <View style={styles.logo}>
          <AppText style={styles.logoText}>N</AppText>
        </View>
      ) : null}
      <AppText variant="title" style={styles.greeting}>
        你好{username ? `，${username}` : ""}
      </AppText>
      <AppText tone="muted" style={styles.sub}>
        有什么可以帮你的？
      </AppText>
      <View style={styles.chips}>
        {SUGGESTIONS.map((item) => (
          <Pressable key={item.text} style={styles.chip} onPress={() => onPick(item.text)}>
            <Feather name={item.icon} size={15} color={colors.textSecondary} />
            <AppText variant="label" tone="secondary" style={styles.chipText}>
              {item.text}
            </AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.surfaceInverse,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
    ...shadow.md,
  },
  logoText: {
    color: colors.textInverse,
    fontSize: 26,
    fontWeight: "800",
  },
  greeting: {
    textAlign: "center",
  },
  sub: {
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  chips: {
    width: "100%",
    gap: spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  chipText: {
    flex: 1,
  },
});
