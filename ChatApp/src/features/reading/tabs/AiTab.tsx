import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useSession } from "../../../app/providers/SessionProvider";
import { AppText, colors, haptics, radius, spacing } from "../../../design";
import {
  getLearningRuntimeContext,
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
  }, [username, context.lectureId, context.bookId]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busyRef.current || !username) {
        return;
      }
      const assistantId = genId();
      setMessages((prev) => [
        ...prev,
        { id: genId(), role: "user", content, status: "completed" },
        { id: assistantId, role: "assistant", content: "", status: "streaming" },
      ]);
      setInput("");
      setBusy(true);
      busyRef.current = true;
      setError("");
      scrollToEnd();

      const controller = new AbortController();
      abortRef.current = controller;
      let raw = "";
      try {
        await streamLearningChat(
          {
            username,
            messages: [{ role: "user", content }],
            conversation_id: `${context.lectureId}:${context.bookId}`,
            conversation_title: context.bookTitle || context.lectureTitle || "教材问答",
            system_prompt: String(runtime?.system_prompt || "").trim(),
            context_blocks: buildContextBlocks(runtime, context),
            active_tool_skills: Array.isArray(runtime?.active_tool_skills)
              ? runtime!.active_tool_skills
              : [],
            cards: Array.isArray(runtime?.cards) ? runtime!.cards : [],
            meta: {
              ...(runtime?.meta || {}),
              source: "chatapp-reader",
              lecture_id: context.lectureId,
              book_id: context.bookId,
            },
            api_mode: "chat",
            think: false,
            stream: true,
          },
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
                const parsed = parseAssistantResponse(finalRaw);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          content: parsed.final || finalRaw,
                          reasoning: parsed.thinking,
                          status: "completed",
                        }
                      : m,
                  ),
                );
              } else if (event.type === "error") {
                throw new Error(event.message);
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
          setError(normalizeError(err).message);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content || "请求失败，请重试。", status: "error" }
                : m,
            ),
          );
        }
      } finally {
        setBusy(false);
        busyRef.current = false;
        abortRef.current = null;
      }
    },
    [context, runtime, scrollToEnd, username],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
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
            <ChatMessageItem key={message.id} message={message} />
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
