import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { AppText, colors, radius, spacing } from "../../../design";

/** Collapsible reasoning ("思考") block fed by `reasoning_content` deltas. */
export function ReasoningBlock({
  reasoning,
  streaming,
}: {
  reasoning: string;
  streaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!reasoning?.trim()) {
    return null;
  }
  const open = expanded || Boolean(streaming);

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.head} onPress={() => setExpanded((v) => !v)} hitSlop={6}>
        <Feather name="cpu" size={12} color={colors.textTertiary} />
        <AppText variant="caption" tone="tertiary" style={styles.headText}>
          {streaming ? "思考中…" : "思考过程"}
        </AppText>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={14}
          color={colors.textTertiary}
        />
      </Pressable>
      {open ? (
        // Cap height and scroll: long reasoning (thousands of chars) otherwise
        // renders as one giant block and janks the thread.
        <View style={styles.body}>
          <ScrollView
            style={styles.bodyScroll}
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            <AppText variant="caption" tone="secondary" style={styles.bodyText}>
              {reasoning.trim()}
            </AppText>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headText: {
    flex: 1,
  },
  body: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    maxHeight: 260,
  },
  bodyScroll: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  bodyText: {
    lineHeight: 19,
  },
});
