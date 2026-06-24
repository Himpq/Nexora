import { memo, useCallback } from "react";
import { Linking, Platform, StyleSheet } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import Markdown from "react-native-markdown-display";

import { colors, radius, spacing } from "../../../design";

// Only let through link schemes Linking can open safely. Blocks `javascript:`,
// `data:`, and other potentially harmful protocols that may appear in model
// output. Returning true hands the URL back to the markdown lib's default
// Linking.openURL; returning false suppresses navigation.
const SAFE_LINK_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:", "sms:"]);

function isSafeLink(url: string) {
  try {
    const parsed = new URL(url, "https://invalid.invalid");
    return SAFE_LINK_SCHEMES.has(parsed.protocol);
  } catch {
    return false;
  }
}

const mono =
  Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) || "monospace";

// Monochrome markdown theme tuned to the app's ink/paper design language.
// Typed loosely so the markdown lib (StyleSheet.NamedStyles<any>) accepts it
// without StyleSheet.create fontWeight-literal friction.
const markdownStyles: { [key: string]: TextStyle | ViewStyle } = {
  body: { color: colors.text, fontSize: 15, lineHeight: 23 },
  paragraph: { marginTop: 0, marginBottom: spacing.sm },
  heading1: {
    fontSize: 21,
    fontWeight: "700",
    color: colors.text,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    lineHeight: 28,
  },
  heading2: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    lineHeight: 25,
  },
  heading3: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    lineHeight: 22,
  },
  strong: { fontWeight: "700", color: colors.text },
  em: { fontStyle: "italic" },
  s: { textDecorationLine: "line-through" },
  link: { color: colors.mention, textDecorationLine: "underline" },
  bullet_list: { marginBottom: spacing.sm },
  ordered_list: { marginBottom: spacing.sm },
  list_item: { marginBottom: spacing.xs },
  code_inline: {
    fontFamily: mono,
    fontSize: 13.5,
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  fence: {
    fontFamily: mono,
    fontSize: 13,
    backgroundColor: colors.surfaceInverse,
    color: "#E8E8EA",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  code_block: {
    fontFamily: mono,
    fontSize: 13,
    backgroundColor: colors.surfaceInverse,
    color: "#E8E8EA",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  blockquote: {
    backgroundColor: colors.surfaceMuted,
    borderLeftWidth: 3,
    borderLeftColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
    borderRadius: radius.sm,
  },
  hr: { backgroundColor: colors.border, height: 1, marginVertical: spacing.sm },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
  },
  th: { padding: spacing.sm, fontWeight: "700", color: colors.text },
  td: { padding: spacing.sm, color: colors.text },
};

/** Renders assistant markdown content with the app's monochrome theme. */
export const MarkdownMessage = memo(function MarkdownMessage({ content }: { content: string }) {
  const onLinkPress = useCallback((url: string) => {
    if (!isSafeLink(url)) {
      return false;
    }
    void Linking.openURL(url).catch(() => undefined);
    return false; // we already opened it; tell the lib not to open again
  }, []);

  return (
    <Markdown style={markdownStyles} onLinkPress={onLinkPress}>
      {content || ""}
    </Markdown>
  );
});
