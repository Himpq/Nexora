import { useCallback, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "../../../app/providers/SessionProvider";
import { AppText, colors, haptics, radius, spacing } from "../../../design";
import { getChatConfig, type ChatModel } from "../../../services/chatConfigService";
import {
  cancelChatStream,
  ChatStreamError,
  streamChat,
  type ChatStreamEvent,
} from "../../../services/chatService";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  pinConversation,
  renameConversation,
  type ConversationSummary,
} from "../../../services/conversationService";
import { ApiClientError } from "../../../services/apiClient";
import { normalizeError } from "../../../utils/errors";
import { ChatComposer } from "../components/ChatComposer";
import { ChatEmptyState } from "../components/ChatEmptyState";
import { ChatMessageItem } from "../components/ChatMessageItem";
import { ConversationDrawer } from "../components/ConversationDrawer";
import { ModelPicker } from "../components/ModelPicker";
import { parseAssistantResponse } from "../utils/parseAssistantResponse";
import type { ChatErrorCategory, ChatMessage } from "../types";

let idCounter = 0;
function genId() {
  // crypto.randomUUID is available on RN 0.83+; fall back to a counter-backed id
  // for older runtimes / SSR. The counter disambiguates same-millisecond sends.
  const uuid =
    typeof globalThis !== "undefined" &&
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : null;
  if (uuid) {
    return `m-${uuid}`;
  }
  idCounter += 1;
  return `m-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

const HISTORY_LIMIT = 80;

function describeStreamActivity(event: ChatStreamEvent) {
  if (event.type !== "unknown") {
    return "";
  }
  const eventType = String(event.eventType || "").trim();
  if (!eventType) {
    return "";
  }
  if (eventType === "model_info") {
    const raw = event.raw && typeof event.raw === "object"
      ? (event.raw as Record<string, unknown>)
      : {};
    const model = String(raw.model || raw.model_name || "").trim();
    return model ? `模型：${model}` : "模型已就绪";
  }
  if (eventType.includes("search")) {
    return "正在联网检索…";
  }
  if (eventType.includes("function_call") || eventType.includes("tool")) {
    return "正在调用工具…";
  }
  if (eventType.includes("context_compression")) {
    return "正在整理上下文…";
  }
  return "";
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ConversationScreen() {
  const { username } = useSession();
  const insets = useSafeAreaInsets();

  const [models, setModels] = useState<ChatModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [enableThinking, setEnableThinking] = useState(false);
  const [enableWebSearch, setEnableWebSearch] = useState(true);
  const [enableTools, setEnableTools] = useState(false);
  const [error, setError] = useState<string>("");
  const [kbHeight, setKbHeight] = useState(0);

  const scrollRef = useRef<ScrollView>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamIdRef = useRef("");
  const busyRef = useRef(false);
  // Live mirror of `activeId` so stream callbacks read the current value
  // instead of a stale closure capture (see runStream).
  const activeIdRef = useRef("");
  // Monotonic token bumped on every conversation switch / new stream. An
  // in-flight stream captures its token and bails from state writes once the
  // token advances — this is what prevents a just-aborted stream from writing
  // its tail into the newly selected conversation.
  const streamTokenRef = useRef(0);
  // Resolves when the current in-flight runStream finishes its finally block,
  // so a conversation switch can await full teardown before loading history.
  const inflightRef = useRef<Promise<void> | null>(null);
  // Cancels the previous in-flight /api/conversations listing so rapid
  // send/regenerate calls don't stack overlapping GETs and flicker the drawer.
  const listAbortRef = useRef<AbortController | null>(null);

  const switchActiveId = useCallback((id: string) => {
    activeIdRef.current = id;
    setActiveId(id);
  }, []);

  const activeConversation = conversations.find((c) => c.conversation_id === activeId);
  const currentTitle = activeConversation?.title || "新对话";
  const selectedModelLabel =
    models.find((m) => m.id === selectedModel)?.name || selectedModel || "模型";

  // ── keyboard + scroll ───────────────────────────────────────────────
  // Track the keyboard height so the composer can stick to the keyboard top
  // (Gemini/Grok/GPT-style) on both iOS and Android. endCoordinates.height is
  // accurate on both platforms.
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => setKbHeight(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  // ── data loading ────────────────────────────────────────────────────
  const refreshConversations = useCallback(async () => {
    // Cancel any prior in-flight listing so overlapping refreshes (rapid
    // send/regenerate) don't resolve out of order and flicker the drawer.
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    setLoadingConversations(true);
    try {
      const list = await listConversations({ signal: controller.signal });
      if (!controller.signal.aborted) {
        setConversations(list);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(normalizeError(err).message);
      }
    } finally {
      if (listAbortRef.current === controller) {
        listAbortRef.current = null;
        setLoadingConversations(false);
      }
    }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const { models: nextModels, defaultModel } = await getChatConfig();
      setModels(nextModels);
      setSelectedModel(
        (current) =>
          current ||
          (nextModels.some((m) => m.id === defaultModel) ? defaultModel : "") ||
          nextModels[0]?.id ||
          "",
      );
    } catch (err) {
      setError(normalizeError(err).message);
    }
  }, []);

  useEffect(() => {
    if (!username) {
      return;
    }
    void loadModels();
    void refreshConversations();
  }, [username, loadModels, refreshConversations]);

  // ── message helpers ─────────────────────────────────────────────────
  const updateMessage = useCallback(
    (id: string, fn: (message: ChatMessage) => ChatMessage) => {
      setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
    },
    [],
  );

  const runStream = useCallback(
    async (
      assistantId: string,
      payload: {
        message: string;
        conversationId: string;
        isRegenerate?: boolean;
        regenerateIndex?: number;
        skipUserMessage?: boolean;
      },
    ) => {
      const controller = new AbortController();
      abortRef.current = controller;
      // Capture a token so callbacks can tell if this stream is still the
      // "current" one. A conversation switch bumps the token and any later
      // state writes from this stream bail out.
      const token = ++streamTokenRef.current;
      const isCurrent = () => streamTokenRef.current === token;
      setBusy(true);
      busyRef.current = true;
      setError("");
      let capturedConversationId = payload.conversationId;
      let inflightResolve: () => void = () => {};
      inflightRef.current = new Promise<void>((resolve) => {
        inflightResolve = resolve;
      });

      const finalizeError = (err: unknown, aborted: boolean) => {
        const category: ChatErrorCategory = aborted
          ? "cancelled"
          : err instanceof ChatStreamError || err instanceof ApiClientError
            ? "server"
            : "network";
        const message = aborted
          ? "已取消生成。"
          : category === "server"
            ? normalizeError(err).message
            : "网络连接失败，请检查网络后重试。";
        if (category !== "cancelled") {
          setError(message);
        }
        const code =
          err instanceof ApiClientError
            ? err.status
            : err instanceof ChatStreamError
              ? undefined
              : undefined;
        updateMessage(assistantId, (m) => ({
          ...m,
          content: m.content || message,
          status: category === "cancelled" ? "cancelled" : "error",
          errorCategory: category,
          errorCode: code,
        }));
      };

      const finishAssistantMessage = (assistantContent?: string, assistantReasoning?: string) => {
        updateMessage(assistantId, (m) => {
          const nextContent = assistantContent ?? m.content;
          const nextReasoning = assistantReasoning ?? m.reasoning;
          // Defensive: some models embed thinking in the content via
          // <THINKING>/<FINAL> tags instead of a separate reasoning_content
          // frame. If present, split it out so it renders in ReasoningBlock
          // instead of as raw tags.
          if (/<THINKING>|<FINAL>/i.test(nextContent)) {
            const parsed = parseAssistantResponse(nextContent);
            return {
              ...m,
              content: parsed.final || "（无内容）",
              reasoning: parsed.thinking
                ? (nextReasoning ? `${nextReasoning}\n` : "") + parsed.thinking
                : nextReasoning,
              status: "completed",
              activity: undefined,
              errorCategory: undefined,
              errorCode: undefined,
            };
          }
          return {
            ...m,
            content: nextContent || "（无内容）",
            reasoning: nextReasoning,
            status: "completed",
            activity: undefined,
            errorCategory: undefined,
            errorCode: undefined,
          };
        });
      };

      const recoverAssistantFromHistory = async () => {
        const conversationId = String(capturedConversationId || activeIdRef.current || "").trim();
        if (!conversationId) {
          return false;
        }
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (attempt > 0) {
            await delay(450 * attempt);
          }
          const conversation = await getConversation(conversationId);
          const rows = Array.isArray(conversation?.messages) ? conversation!.messages : [];
          let row = payload.regenerateIndex != null
            ? rows[payload.regenerateIndex]
            : undefined;
          if (!row || row.role !== "assistant") {
            for (let i = rows.length - 1; i >= 0; i -= 1) {
              if (rows[i]?.role === "assistant") {
                row = rows[i];
                break;
              }
            }
          }
          const content = String(row?.content || "").trim();
          if (content) {
            finishAssistantMessage(content, String(row?.reasoning_content || "") || undefined);
            setError("");
            return true;
          }
        }
        return false;
      };

      try {
        await streamChat(
          {
            message: payload.message,
            conversationId: payload.conversationId || undefined,
            modelName: selectedModel || undefined,
            enableThinking,
            enableWebSearch,
            enableTools,
            isRegenerate: payload.isRegenerate,
            regenerateIndex: payload.regenerateIndex,
            skipUserMessage: payload.skipUserMessage,
          },
          {
            signal: controller.signal,
            onEvent: (event) => {
              // Stale stream (conversation switched / superseded) — drop.
              if (!isCurrent()) {
                return;
              }
              if (event.type === "content") {
                updateMessage(assistantId, (m) => ({
                  ...m,
                  content: m.content + event.delta,
                  status: "streaming",
                }));
                scrollToEnd();
              } else if (event.type === "reasoning") {
                updateMessage(assistantId, (m) => ({
                  ...m,
                  reasoning: (m.reasoning || "") + event.delta,
                  status: "streaming",
                }));
              } else if (event.type === "conversation_id") {
                capturedConversationId = event.conversationId;
                // Functional update — never trust the closure's activeId.
                setActiveId((prev) => prev || event.conversationId);
                activeIdRef.current = activeIdRef.current || event.conversationId;
              } else if (event.type === "stream_session") {
                streamIdRef.current = event.streamId;
                if (event.conversationId) {
                  capturedConversationId = event.conversationId;
                  setActiveId((prev) => prev || event.conversationId || "");
                  activeIdRef.current = activeIdRef.current || event.conversationId || "";
                }
              } else if (event.type === "error") {
                throw new ChatStreamError(event.message, event.raw);
              } else if (event.type === "done" && event.content) {
                finishAssistantMessage(event.content);
              } else if (event.type === "unknown") {
                const activity = describeStreamActivity(event);
                if (activity) {
                  updateMessage(assistantId, (m) => ({ ...m, activity }));
                }
              }
            },
          },
        );

        if (!isCurrent()) {
          return;
        }
        if (controller.signal.aborted) {
          updateMessage(assistantId, (m) => ({
            ...m,
            content: m.content || "已取消生成。",
            status: "cancelled",
          }));
        } else {
          finishAssistantMessage();
        }
      } catch (err) {
        if (!isCurrent()) {
          return;
        }
        if (!controller.signal.aborted && !(err instanceof ChatStreamError) && !(err instanceof ApiClientError)) {
          try {
            const recovered = await recoverAssistantFromHistory();
            if (recovered) {
              return;
            }
          } catch {
            // Fall through to the normal network error UI.
          }
        }
        finalizeError(err, controller.signal.aborted);
      } finally {
        setBusy(false);
        busyRef.current = false;
        if (abortRef.current === controller) {
          abortRef.current = null;
          streamIdRef.current = "";
        }
        inflightResolve();
        // Only the current stream may mutate conversation-level state post-run;
        // a superseded stream must not revert activeId or trigger a refresh.
        if (isCurrent()) {
          void refreshConversations();
          if (!activeIdRef.current && capturedConversationId) {
            setActiveId(capturedConversationId);
            activeIdRef.current = capturedConversationId;
          }
        }
      }
    },
    [
      enableThinking,
      enableTools,
      enableWebSearch,
      refreshConversations,
      scrollToEnd,
      selectedModel,
      updateMessage,
    ],
  );

  // ── actions ─────────────────────────────────────────────────────────
  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busyRef.current) {
        return;
      }

      let conversationId = activeIdRef.current;
      if (!conversationId) {
        try {
          const created = await createConversation(content.slice(0, 30));
          conversationId = created.conversation_id;
          switchActiveId(conversationId);
        } catch (err) {
          // createConversation is best-effort: if it fails (transient network /
          // auth), fall back to letting the stream's conversation_id frame
          // establish the conversation server-side. Surface the underlying
          // error only if the stream also fails — otherwise we'd cry wolf on a
          // successful fallback.
          console.warn("createConversation failed, deferring to stream", err);
          conversationId = "";
        }
      }

      const assistantId = genId();
      setMessages((prev) => [
        ...prev,
        { id: genId(), role: "user", content, status: "completed" },
        { id: assistantId, role: "assistant", content: "", status: "streaming" },
      ]);
      setInput("");
      Keyboard.dismiss();
      scrollToEnd();
      await runStream(assistantId, { message: content, conversationId });
    },
    [runStream, scrollToEnd, switchActiveId],
  );

  const regenerate = useCallback(async () => {
    if (busyRef.current || !activeIdRef.current) {
      return;
    }
    let lastAssistantId = "";
    let lastServerIndex: number | undefined;
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (next[i].role === "assistant") {
          lastAssistantId = next[i].id;
          lastServerIndex = next[i].serverIndex;
          next[i] = {
            ...next[i],
            content: "",
            reasoning: undefined,
            status: "streaming",
            errorCategory: undefined,
            errorCode: undefined,
          };
          break;
        }
      }
      return next;
    });
    if (!lastAssistantId) {
      return;
    }
    scrollToEnd();

    // The backend's regenerate_index is the assistant message's position in the
    // server's messages array (it reads the triggering user message at
    // index-1 and overwrites the assistant at that index). History-loaded
    // messages carry their real serverIndex, but a freshly streamed message in
    // the current session has none — and we can't reliably recompute it locally
    // (HISTORY_LIMIT truncation, version overwrites, etc.). So when we lack the
    // index, sync from the server first, mirroring the web client. This is a
    // deliberate user action so one extra GET is acceptable.
    let regenerateIndex = lastServerIndex;
    if (regenerateIndex === undefined) {
      try {
        const conversation = await getConversation(activeIdRef.current);
        const rows = Array.isArray(conversation?.messages) ? conversation!.messages : [];
        // Server stores only user/assistant roles, so the array index is the
        // server index directly. Target the last assistant.
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i]?.role === "assistant") {
            regenerateIndex = i;
            break;
          }
        }
      } catch {
        // Leave undefined; backend will run without a target index.
      }
    }

    await runStream(lastAssistantId, {
      message: "",
      conversationId: activeIdRef.current,
      isRegenerate: true,
      regenerateIndex,
    });
  }, [runStream, scrollToEnd]);

  const requestServerCancel = useCallback(() => {
    const streamId = streamIdRef.current;
    if (streamId) {
      void cancelChatStream(streamId).catch(() => undefined);
    }
  }, []);

  const retryAssistant = useCallback(
    async (assistantId: string) => {
      if (busyRef.current || !activeIdRef.current) {
        return;
      }
      let retryText = "";
      setMessages((prev) => {
        const index = prev.findIndex((m) => m.id === assistantId);
        if (index < 0) {
          return prev;
        }
        for (let i = index - 1; i >= 0; i -= 1) {
          if (prev[i].role === "user") {
            retryText = prev[i].content;
            break;
          }
        }
        return prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: "",
                reasoning: undefined,
                status: "streaming",
                activity: undefined,
                errorCategory: undefined,
                errorCode: undefined,
              }
            : m,
        );
      });
      const content = retryText.trim();
      if (!content) {
        return;
      }
      setError("");
      scrollToEnd();
      await runStream(assistantId, {
        message: content,
        conversationId: activeIdRef.current,
        skipUserMessage: true,
      });
    },
    [runStream, scrollToEnd],
  );

  const stop = useCallback(() => {
    requestServerCancel();
    abortRef.current?.abort();
  }, [requestServerCancel]);

  const selectConversation = useCallback(
    async (id: string) => {
      setDrawerOpen(false);
      if (id === activeIdRef.current) {
        return;
      }
      // Invalidate any in-flight stream and await its full teardown before we
      // touch messages/activeId — otherwise the old stream's onEvent could
      // still land a content delta or its finally could setActiveId back to the
      // previous conversation.
      streamTokenRef.current += 1;
      requestServerCancel();
      abortRef.current?.abort();
      await inflightRef.current?.catch(() => undefined);
      switchActiveId(id);
      setMessages([]);
      setLoadingHistory(true);
      setError("");
      try {
        const conversation = await getConversation(id);
        const rows = Array.isArray(conversation?.messages) ? conversation!.messages : [];
        const visible = rows.filter((m) => m.role === "user" || m.role === "assistant");
        // Preserve the REAL server index (position in the server's message
        // array) even after truncating to the last HISTORY_LIMIT messages, so
        // regenerate_index stays aligned with the backend.
        const start = Math.max(0, visible.length - HISTORY_LIMIT);
        const mapped: ChatMessage[] = visible
          .slice(start)
          .map((m, i) => ({
            id: `${id}-${start + i}`,
            role: m.role === "user" ? "user" : "assistant",
            content: String(m.content || ""),
            reasoning: String(m.reasoning_content || "") || undefined,
            status: "completed" as const,
            // Real server index (position in the server array), preserved
            // across the HISTORY_LIMIT truncation so regenerate_index stays
            // aligned with the backend.
            serverIndex: start + i,
          }));
        setMessages(mapped);
        scrollToEnd();
      } catch (err) {
        setError(normalizeError(err).message);
      } finally {
        setLoadingHistory(false);
      }
    },
    [requestServerCancel, scrollToEnd, switchActiveId],
  );

  const newChat = useCallback(() => {
    streamTokenRef.current += 1;
    requestServerCancel();
    abortRef.current?.abort();
    setDrawerOpen(false);
    switchActiveId("");
    setMessages([]);
    setError("");
  }, [requestServerCancel, switchActiveId]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteConversation(id);
        if (id === activeIdRef.current) {
          newChat();
        }
        void refreshConversations();
      } catch (err) {
        setError(normalizeError(err).message);
      }
    },
    [newChat, refreshConversations],
  );

  const handleRename = useCallback(
    async (id: string, title: string) => {
      setConversations((prev) =>
        prev.map((c) => (c.conversation_id === id ? { ...c, title } : c)),
      );
      try {
        await renameConversation(id, title);
      } catch (err) {
        setError(normalizeError(err).message);
        void refreshConversations();
      }
    },
    [refreshConversations],
  );

  const handlePin = useCallback(
    async (id: string, pin: boolean) => {
      setConversations((prev) =>
        prev.map((c) => (c.conversation_id === id ? { ...c, pin } : c)),
      );
      try {
        await pinConversation(id, pin);
        void refreshConversations();
      } catch (err) {
        setError(normalizeError(err).message);
        void refreshConversations();
      }
    },
    [refreshConversations],
  );

  // When the keyboard is up, lift the composer to sit on the keyboard top.
  // Otherwise reserve space for the floating tab bar.
  const bottomGap = kbHeight > 0 ? kbHeight : Math.max(insets.bottom, spacing.md) + 66;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <Pressable style={styles.iconBtn} hitSlop={8} onPress={() => setDrawerOpen(true)}>
          <Feather name="menu" size={22} color={colors.text} />
        </Pressable>
        <AppText variant="heading" numberOfLines={1} style={styles.topTitle}>
          {currentTitle}
        </AppText>
        <Pressable
          style={styles.iconBtn}
          hitSlop={8}
          onPress={() => {
            haptics.selection();
            newChat();
          }}
        >
          <Feather name="edit" size={19} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.flex}>
        {messages.length === 0 && !loadingHistory ? (
          <ChatEmptyState username={username} onPick={(prompt) => void send(prompt)} />
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
            {loadingHistory ? (
              <AppText tone="muted" style={styles.loadingHint}>
                正在加载对话…
              </AppText>
            ) : null}
            {messages.map((message, index) => (
              <ChatMessageItem
                key={message.id}
                message={message}
                canRegenerate={
                  !busy && message.role === "assistant" && index === messages.length - 1
                }
                onRegenerate={regenerate}
                onRetry={
                  message.status === "error" && index === messages.length - 1
                    ? () => void retryAssistant(message.id)
                    : undefined
                }
              />
            ))}
          </ScrollView>
        )}

        <View style={[styles.composerWrap, { paddingBottom: bottomGap }]}>
          {error ? (
            <Pressable onPress={() => setError("")} style={styles.errorBanner}>
              <Feather name="alert-triangle" size={13} color={colors.danger} />
              <AppText variant="caption" tone="danger" style={styles.errorText} numberOfLines={2}>
                {error}
              </AppText>
            </Pressable>
          ) : null}
          <ChatComposer
            value={input}
            onChangeText={setInput}
            onSend={() => void send(input)}
            onStop={stop}
            busy={busy}
            modelLabel={selectedModelLabel}
            onPickModel={() => setModelPickerOpen(true)}
            enableThinking={enableThinking}
            onToggleThinking={() => setEnableThinking((v) => !v)}
            enableWebSearch={enableWebSearch}
            onToggleWebSearch={() => setEnableWebSearch((v) => !v)}
            enableTools={enableTools}
            onToggleTools={() => setEnableTools((v) => !v)}
          />
        </View>
      </View>

      <ConversationDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        conversations={conversations}
        activeId={activeId}
        loading={loadingConversations}
        onSelect={(id) => void selectConversation(id)}
        onNew={newChat}
        onDelete={(id) => void handleDelete(id)}
        onRename={(id, title) => void handleRename(id, title)}
        onPin={(id, pin) => void handlePin(id, pin)}
      />

      <ModelPicker
        visible={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        models={models}
        selectedModel={selectedModel}
        onSelect={setSelectedModel}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderFaint,
    backgroundColor: colors.background,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  topTitle: {
    flex: 1,
    textAlign: "center",
  },
  thread: {
    flex: 1,
  },
  threadContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  loadingHint: {
    textAlign: "center",
    paddingVertical: spacing.md,
  },
  composerWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.dangerMuted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorText: {
    flex: 1,
  },
});
