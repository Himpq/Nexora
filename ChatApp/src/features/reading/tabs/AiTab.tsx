import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useSession } from "../../../app/providers/SessionProvider";
import { AppText, colors, haptics, radius, spacing } from "../../../design";
import {
  getLearningRuntimeContext,
  sendLearningChat,
  streamLearningChat,
} from "../../../services/learningChatService";
import type { LearningRuntimeContext } from "../../../services/types";
import { normalizeError } from "../../../utils/errors";
import { ChatMessageItem } from "../../chat/components/ChatMessageItem";
import { ChatEmptyState } from "../../chat/components/ChatEmptyState";
import { parseAssistantResponse } from "../../chat/utils/parseAssistantResponse";
import type { ChatMessage } from "../../chat/types";
import type { ReaderContext } from "../types";

let aiIdCounter = 0;
function genId() {
  aiIdCounter += 1;
  return `ai-${Date.now().toString(36)}-${aiIdCounter.toString(36)}`;
}

function buildContextBlocks(runtime: LearningRuntimeContext | null, context: ReaderContext) {
  const base = Array.isArray(runtime?.context_blocks) ? runtime!.context_blocks : [];
  const targetBlock = {
    type: "target_context",
    title: "当前阅读目标",
    content: JSON.stringify(
      {
        lecture_id: context.lectureId,
        lecture_title: context.lectureTitle,
        book_id: context.bookId,
        book_title: context.bookTitle,
        chapter: context.chapter?.name,
        chapter_range: context.chapter?.range,
      },
      null,
      2,
    ),
  };
  return [targetBlock, ...base];
}

function contextKey(context: ReaderContext) {
  return [
    context.lectureId,
    context.bookId,
    context.chapter?.index ?? "",
    context.chapter?.name ?? "",
    context.chapter?.range ?? "",
  ].join("|");
}

function safeConversationPart(value: unknown) {
  return encodeURIComponent(String(value || "").trim()).replace(/%/g, "").slice(0, 80) || "_";
}

function buildConversationId(context: ReaderContext) {
  const chapter = context.chapter?.index != null
    ? `chapter-${context.chapter.index}`
    : context.chapter?.name || "book";
  return [
    "chatapp-reader",
    safeConversationPart(context.lectureId),
    safeConversationPart(context.bookId),
    safeConversationPart(chapter),
  ].join(":");
}

function buildRecentDialogueBlock(messages: ChatMessage[]) {
  const rows = messages
    .filter((message) => message.status === "completed" && message.content.trim())
    .slice(-8)
    .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content.trim()}`);
  if (rows.length === 0) {
    return null;
  }
  return {
    type: "recent_local_dialogue",
    title: "浮窗本地最近对话",
    content: rows.join("\n\n"),
  };
}

function describeLearningActivity(eventType?: string) {
  const type = String(eventType || "").trim();
  if (!type) {
    return "";
  }
  if (type.includes("function") || type.includes("tool")) {
    return "正在调用学习工具…";
  }
  if (type.includes("reasoning")) {
    return "正在推理…";
  }
  return "";
}

export function AiTab({ context }: { context: ReaderContext }) {
  const { username } = useSession();
  const [runtime, setRuntime] = useState<LearningRuntimeContext | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const scrollRef = useRef<ScrollView>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const activeContextKey = contextKey(context);
  const conversationId = buildConversationId(context);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!username) {
        return;
      }
      try {
        const result = await getLearningRuntimeContext(username, {
          lectureId: context.lectureId,
          bookId: context.bookId,
        });
        if (active) {
          setRuntime(result.payload || null);
        }
      } catch {
        // Runtime context is best-effort; chat still works without it.
      }
    })();
    return () => {
      active = false;
    };
  }, [username, context.lectureId, context.bookId, activeContextKey]);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    busyRef.current = false;
    setBusy(false);
    setMessages([]);
    setInput("");
    setError("");
  }, [activeContextKey]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const send = useCallback(
    async (text: string, existingAssistantId?: string) => {
      const content = text.trim();
      if (!content || busyRef.current || !username) {
        return;
      }
      const assistantId = existingAssistantId || genId();
      const localMessagesSnapshot = messages;
      if (existingAssistantId) {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === existingAssistantId
              ? {
                  ...message,
                  content: "",
                  reasoning: undefined,
                  status: "streaming",
                  activity: undefined,
                  errorCategory: undefined,
                  errorCode: undefined,
                }
              : message,
          ),
        );
      } else {
        setMessages((prev) => [
          ...prev,
          { id: genId(), role: "user", content, status: "completed" },
          { id: assistantId, role: "assistant", content: "", status: "streaming" },
        ]);
      }
      setInput("");
      setBusy(true);
      busyRef.current = true;
      setError("");
      scrollToEnd();

      const controller = new AbortController();
      abortRef.current = controller;
      let raw = "";
      const recentDialogue = buildRecentDialogueBlock(localMessagesSnapshot);
      const contextBlocks = buildContextBlocks(runtime, context);
      if (recentDialogue) {
        contextBlocks.push(recentDialogue);
      }
      const requestPayload = {
        username,
        messages: [{ role: "user" as const, content }],
        conversation_id: conversationId,
        conversation_title: context.chapter?.name || context.bookTitle || context.lectureTitle || "教材问答",
        system_prompt: String(runtime?.system_prompt || "").trim(),
        context_blocks: contextBlocks,
        active_tool_skills: Array.isArray(runtime?.active_tool_skills)
          ? runtime!.active_tool_skills
          : [],
        cards: Array.isArray(runtime?.cards) ? runtime!.cards : [],
        meta: {
          ...(runtime?.meta || {}),
          source: "chatapp-reader",
          lecture_id: context.lectureId,
          book_id: context.bookId,
          chapter_name: context.chapter?.name,
          chapter_range: context.chapter?.range,
        },
        api_mode: "chat" as const,
        think: false,
        stream: true,
      };

      const completeAssistant = (finalRaw: string) => {
        const parsed = parseAssistantResponse(finalRaw);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: parsed.final || finalRaw || "（无内容）",
                  reasoning: parsed.thinking,
                  status: "completed",
                  activity: undefined,
                }
              : m,
          ),
        );
      };

      try {
        await streamLearningChat(
          requestPayload,
          {
            signal: controller.signal,
            onEvent: (event) => {
              if (event.type === "content" || event.type === "reasoning") {
                raw += event.delta;
                const parsed = parseAssistantResponse(raw);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          content: parsed.final || raw,
                          reasoning: parsed.thinking,
                          status: "streaming",
                        }
                      : m,
                  ),
                );
                scrollToEnd();
              } else if (event.type === "done") {
                const finalRaw = event.content || raw;
                completeAssistant(finalRaw);
              } else if (event.type === "error") {
                throw new Error(event.message);
              } else if (event.type === "unknown") {
                const activity = describeLearningActivity(event.eventType);
                if (activity) {
                  setMessages((prev) =>
                    prev.map((m) => (m.id === assistantId ? { ...m, activity } : m)),
                  );
                }
              }
            },
          },
        );
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && m.status === "streaming"
              ? { ...m, content: m.content || "（无内容）", status: "completed" }
              : m,
          ),
        );
      } catch (err) {
        if (controller.signal.aborted) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content || "已取消生成。", status: "cancelled" }
                : m,
            ),
          );
        } else {
          try {
            const result = await sendLearningChat({
              ...requestPayload,
              stream: false,
              skip_user_message: true,
            });
            const fallbackContent = String(result.content || result.answer || result.message || "").trim();
            completeAssistant(fallbackContent || "（无内容）");
          } catch {
            setError(normalizeError(err).message);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content || "请求失败，请重试。", status: "error" }
                  : m,
              ),
            );
          }
        }
      } finally {
        setBusy(false);
        busyRef.current = false;
        abortRef.current = null;
      }
    },
    [context, conversationId, messages, runtime, scrollToEnd, username],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const retryAssistant = useCallback(
    (assistantId: string) => {
      const index = messages.findIndex((message) => message.id === assistantId);
      if (index < 0) {
        return;
      }
      for (let i = index - 1; i >= 0; i -= 1) {
        if (messages[i].role === "user") {
          void send(messages[i].content, assistantId);
          return;
        }
      }
    },
    [messages, send],
  );
  const canSend = input.trim().length > 0 && !busy;

  return (
    <View style={styles.flex}>
      {messages.length === 0 ? (
        <ChatEmptyState showLogo={false} onPick={(prompt) => void send(prompt)} />
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.thread}
          contentContainerStyle={styles.threadContent}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            if (busyRef.current) {
              scrollRef.current?.scrollToEnd({ animated: true });
            }
          }}
        >
          {messages.map((message) => (
            <ChatMessageItem
              key={message.id}
              message={message}
              onRetry={message.status === "error" ? () => retryAssistant(message.id) : undefined}
            />
          ))}
        </ScrollView>
      )}

      {error ? (
        <Pressable style={styles.errorBanner} onPress={() => setError("")}>
          <AppText variant="caption" tone="danger" numberOfLines={2}>
            {error}
          </AppText>
        </Pressable>
      ) : null}

      <View style={styles.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          multiline
          placeholder="就本章内容提问…"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          textAlignVertical="top"
        />
        {busy ? (
          <Pressable style={styles.sendBtn} onPress={stop} hitSlop={6}>
            <Feather name="square" size={15} color={colors.onPrimary} />
          </Pressable>
        ) : (
          <Pressable
            style={[styles.sendBtn, !canSend && styles.sendDisabled]}
            disabled={!canSend}
            onPress={() => {
              haptics.impact("light");
              void send(input);
            }}
            hitSlop={6}
          >
            <Feather name="arrow-up" size={17} color={colors.onPrimary} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  thread: {
    flex: 1,
  },
  threadContent: {
    padding: spacing.md,
    gap: spacing.md,
  },
  errorBanner: {
    backgroundColor: colors.dangerMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.md,
    borderRadius: radius.sm,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    padding: spacing.sm,
    // Extra bottom/right inset so the send button clears the panel's edge
    // resize handles (AssistantPanel EDGE strip) — taps always reach the button.
    paddingBottom: 14,
    paddingRight: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 110,
    minHeight: 38,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    color: colors.text,
    fontSize: 14,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: {
    backgroundColor: colors.borderStrong,
  },
});
