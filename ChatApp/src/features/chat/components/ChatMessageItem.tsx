import { memo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";

import { AppText, colors, haptics, radius, spacing } from "../../../design";
import type { ChatErrorCategory, ChatMessage as ChatMessageModel } from "../types";
import { MarkdownMessage } from "./MarkdownMessage";
import { ReasoningBlock } from "./ReasoningBlock";
import { TypingDots } from "./TypingDots";

function errorHint(category?: ChatErrorCategory, code?: string | number) {
  if (category === "network") {
    return "网络连接失败，请检查网络后重试。";
  }
  if (category === "cancelled") {
    return "已取消生成。";
  }
  // server: backend-reported (model rate-limit / context overflow / HTTP error)
  const suffix =
    typeof code === "number" && code ? `（HTTP ${code}）` : "";
  return `请求失败${suffix}，可尝试重试或切换模型。`;
}

export const ChatMessageItem = memo(function ChatMessageItem({
  message,
  canRegenerate,
  onRegenerate,
  onRetry,
}: {
  message: ChatMessageModel;
  canRegenerate?: boolean;
  onRegenerate?: () => void;
  onRetry?: () => void;
}) {
  const isUser = message.role === "user";
  const streaming = message.status === "streaming";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!message.content) {
      return;
    }
    await Clipboard.setStringAsync(message.content);
    haptics.selection();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (isUser) {
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <AppText style={styles.userText}>{message.content}</AppText>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.assistantRow}>
      {message.reasoning ? (
        <ReasoningBlock reasoning={message.reasoning} streaming={streaming} />
      ) : null}

      {streaming && !message.content && !message.reasoning ? (
        <TypingDots />
      ) : message.status === "error" ? (
        <View style={styles.errorBox}>
          <AppText tone="danger">{message.content || errorHint(message.errorCategory, message.errorCode)}</AppText>
          {message.errorCategory ? (
            <AppText variant="caption" tone="muted" style={styles.errorHint}>
              {errorHint(message.errorCategory, message.errorCode)}
            </AppText>
          ) : null}
        </View>
      ) : (
        <MarkdownMessage content={message.content} />
      )}

      {message.activity && streaming ? (
        <AppText variant="caption" tone="tertiary" style={styles.activity}>
          {message.activity}
        </AppText>
      ) : null}

      {!streaming && (message.content || canRegenerate || onRetry) ? (
        <View style={styles.actions}>
          {message.content && message.status !== "error" ? (
            <Pressable style={styles.actionBtn} onPress={copy} hitSlop={6}>
              <Feather name={copied ? "check" : "copy"} size={14} color={colors.textTertiary} />
              <AppText variant="caption" tone="tertiary">
                {copied ? "已复制" : "复制"}
              </AppText>
            </Pressable>
          ) : null}
          {message.status === "error" && onRetry ? (
            <Pressable style={styles.actionBtn} onPress={onRetry} hitSlop={6}>
              <Feather name="rotate-cw" size={14} color={colors.textTertiary} />
              <AppText variant="caption" tone="tertiary">
                重试
              </AppText>
            </Pressable>
          ) : null}
          {message.status !== "error" && canRegenerate && onRegenerate ? (
            <Pressable style={styles.actionBtn} onPress={onRegenerate} hitSlop={6}>
              <Feather name="refresh-cw" size={14} color={colors.textTertiary} />
              <AppText variant="caption" tone="tertiary">
                重新生成
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  userRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  userBubble: {
    maxWidth: "86%",
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  userText: {
    color: colors.onPrimary,
    fontSize: 15,
    lineHeight: 22,
  },
  assistantRow: {
    width: "100%",
  },
  errorBox: {
    gap: spacing.xs,
  },
  errorHint: {
    opacity: 0.8,
  },
  activity: {
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.lg,
    marginTop: spacing.xs,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
});
