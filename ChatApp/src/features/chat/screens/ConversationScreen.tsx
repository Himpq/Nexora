import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { useSession } from "../../../app/providers/SessionProvider";
import {
  AppButton,
  AppCard,
  AppText,
  colors,
  radius,
  Screen,
  ScreenHeader,
  spacing,
  StateView,
} from "../../../design";
import type { MainTabParamList, RootStackParamList } from "../../../navigation/types";
import { getDashboard } from "../../../services/frontendService";
import { listNexoraModels } from "../../../services/nexoraModelService";
import {
  getLearningRuntimeContext,
  sendLearningChat,
  streamLearningChat,
} from "../../../services/learningChatService";
import type { DashboardResponse, LectureRow, LearningRuntimeContext, ModelOption } from "../../../services/types";
import { normalizeError } from "../../../utils/errors";
import { parseAssistantResponse } from "../utils/parseAssistantResponse";

type ConversationScreenProps = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, "Chat">,
  NativeStackScreenProps<RootStackParamList>
>;

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinkingTitle?: string;
  thinking?: string;
  status?: "streaming" | "completed" | "cancelled" | "error";
};

type ChatTarget = {
  lectureId: string;
  lectureTitle: string;
  bookId?: string;
  bookTitle?: string;
};

type FailedChatRequest = {
  content: string;
  assistantId: string;
};

function getLectureTitle(row: LectureRow) {
  return String(row.lecture?.title || "").trim() || "未命名课程";
}

function buildTargetLabel(target: ChatTarget | null) {
  if (!target) {
    return "全局学习对话";
  }
  if (target.bookId) {
    return `${target.lectureTitle} / ${target.bookTitle || target.bookId}`;
  }
  return target.lectureTitle;
}

function buildRuntimeContextPayload(runtime: LearningRuntimeContext | null, target: ChatTarget | null) {
  const baseBlocks = Array.isArray(runtime?.context_blocks) ? runtime.context_blocks : [];
  const targetBlock = target
    ? [
        {
          type: "target_context",
          title: "当前对话目标",
          content: JSON.stringify(target, null, 2),
        },
      ]
    : [];
  return [...targetBlock, ...baseBlocks];
}

function createMessage(role: ChatMessage["role"], content: string, extra?: Partial<ChatMessage>) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    thinkingTitle: extra?.thinkingTitle,
    thinking: extra?.thinking,
    status: extra?.status,
  };
}

function applyParsedMessage(message: ChatMessage, rawContent: string, status?: ChatMessage["status"]) {
  const parsed = parseAssistantResponse(rawContent);
  return {
    ...message,
    content: parsed.final || rawContent,
    thinkingTitle: parsed.thinkingTitle,
    thinking: parsed.thinking,
    status,
  };
}

function getModelValue(model?: ModelOption | null) {
  return String(model?.model || model?.id || model?.name || "").trim();
}

function getModelLabel(model?: ModelOption | null, fallback = "") {
  return String(model?.name || model?.model || model?.id || fallback || "").trim();
}

function findAvailableModelValue(models: ModelOption[], value?: string) {
  const targetValue = String(value || "").trim();
  if (!targetValue) {
    return "";
  }
  return models.some((model) => getModelValue(model) === targetValue) ? targetValue : "";
}

export function ConversationScreen({ navigation, route }: ConversationScreenProps) {
  const { username, context } = useSession();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [runtimeContext, setRuntimeContext] = useState<LearningRuntimeContext | null>(null);
  const [target, setTarget] = useState<ChatTarget | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loadingModels, setLoadingModels] = useState(true);
  const [loadingContext, setLoadingContext] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [contextError, setContextError] = useState<Error | null>(null);
  const [sendError, setSendError] = useState<Error | null>(null);
  const [failedRequest, setFailedRequest] = useState<FailedChatRequest | null>(null);
  const contextRequestIdRef = useRef(0);
  const dashboardRequestIdRef = useRef(0);
  const sendingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const selectedModelOption = useMemo(
    () => models.find((model) => getModelValue(model) === selectedModel) || null,
    [models, selectedModel],
  );
  const selectedModelValue = useMemo(
    () => getModelValue(selectedModelOption) || selectedModel,
    [selectedModel, selectedModelOption],
  );
  const selectedModelLabel = useMemo(
    () => getModelLabel(selectedModelOption, selectedModel) || "后端默认",
    [selectedModel, selectedModelOption],
  );

  const contextBlocks = useMemo(
    () => buildRuntimeContextPayload(runtimeContext, target),
    [runtimeContext, target],
  );

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    setError(null);
    try {
      const result = await listNexoraModels(username);
      const nextModels = Array.isArray(result.data) ? result.data : [];
      setModels(nextModels);
      setSelectedModel((current) =>
        findAvailableModelValue(nextModels, current) ||
        findAvailableModelValue(nextModels, result.defaultModel) ||
        getModelValue(nextModels[0]),
      );
    } catch (err) {
      setError(normalizeError(err));
      setModels([]);
      setSelectedModel("");
    } finally {
      setLoadingModels(false);
    }
  }, [username]);

  const loadDashboard = useCallback(async () => {
    const requestId = dashboardRequestIdRef.current + 1;
    dashboardRequestIdRef.current = requestId;
    try {
      const result = await getDashboard();
      if (dashboardRequestIdRef.current !== requestId) {
        return;
      }
      setDashboard(result);
      const firstLecture = Array.isArray(result.lectures) ? result.lectures[0] : null;
      if (firstLecture) {
        const lectureId = String(firstLecture.lecture?.id || "").trim();
        if (lectureId) {
          setTarget({
            lectureId,
            lectureTitle: getLectureTitle(firstLecture),
          });
        }
      }
    } catch (err) {
      setError(normalizeError(err));
    }
  }, []);

  const loadRuntimeContext = useCallback(
    async (lectureId?: string, bookId?: string) => {
      if (!username) {
        return;
      }
      const requestId = contextRequestIdRef.current + 1;
      contextRequestIdRef.current = requestId;
      setLoadingContext(true);
      setContextError(null);
      try {
        const result = await getLearningRuntimeContext(username, { lectureId, bookId });
        if (contextRequestIdRef.current !== requestId) {
          return;
        }
        setRuntimeContext(result.payload || null);
        const runtimeLectureId = String(result.payload?.lecture_id || lectureId || "").trim();
        if (runtimeLectureId && !lectureId) {
          setTarget({
            lectureId: runtimeLectureId,
            lectureTitle: runtimeLectureId,
            bookId,
            bookTitle: bookId,
          });
        }
      } catch (err) {
        if (contextRequestIdRef.current !== requestId) {
          return;
        }
        setRuntimeContext(null);
        setContextError(normalizeError(err));
      } finally {
        if (contextRequestIdRef.current === requestId) {
          setLoadingContext(false);
        }
      }
    },
    [username],
  );

  useEffect(() => {
    void loadModels();
    void loadDashboard();
  }, [loadDashboard, loadModels]);

  useEffect(() => {
    const lectureId = String(route.params?.lectureId || "").trim();
    const lectureTitle = String(route.params?.lectureTitle || "").trim();
    const bookId = String(route.params?.bookId || "").trim();
    const bookTitle = String(route.params?.bookTitle || "").trim();
    if (lectureId || bookId) {
      setTarget({
        lectureId,
        lectureTitle: lectureTitle || lectureId || "未命名课程",
        bookId: bookId || undefined,
        bookTitle: bookTitle || undefined,
      });
    }
  }, [route.params?.bookId, route.params?.bookTitle, route.params?.lectureId, route.params?.lectureTitle]);

  useEffect(() => {
    void loadRuntimeContext(target?.lectureId, target?.bookId);
  }, [loadRuntimeContext, target?.bookId, target?.lectureId]);

  const openCourse = useCallback(() => {
    navigation.navigate("Courses");
  }, [navigation]);

  const buildChatRequest = useCallback(
    (content: string) => ({
      username,
      model: selectedModelValue || undefined,
      messages: [{ role: "user" as const, content }],
      conversation_id: target?.bookId
        ? `${target.lectureId}:${target.bookId}`
        : target?.lectureId || undefined,
      conversation_title: buildTargetLabel(target),
      system_prompt: String(runtimeContext?.system_prompt || "").trim(),
      context_blocks: contextBlocks,
      active_tool_skills: Array.isArray(runtimeContext?.active_tool_skills)
        ? runtimeContext.active_tool_skills
        : [],
      cards: Array.isArray(runtimeContext?.cards) ? runtimeContext.cards : [],
      meta: {
        ...(runtimeContext?.meta || {}),
        source: "chatapp",
        lecture_id: target?.lectureId || runtimeContext?.lecture_id || "",
        book_id: target?.bookId || "",
      },
      api_mode: "chat" as const,
      think: false,
    }),
    [contextBlocks, runtimeContext, selectedModelValue, target, username],
  );

  const sendMessageFallback = useCallback(
    async (assistantId: string, content: string) => {
      const result = await sendLearningChat({
        ...buildChatRequest(content),
        stream: false,
      });
      const raw = String(result.content || "");
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? applyParsedMessage(message, raw, "completed")
            : message,
        ),
      );
    },
    [buildChatRequest],
  );

  const submitMessage = useCallback(async (content: string, options?: { retryAssistantId?: string }) => {
    const normalizedContent = content.trim();
    if (!normalizedContent || !username || sendingRef.current) {
      return;
    }

    sendingRef.current = true;
    const assistantId =
      options?.retryAssistantId || `assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (options?.retryAssistantId) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, content: "", thinkingTitle: undefined, thinking: undefined, status: "streaming" }
            : message,
        ),
      );
    } else {
      const userMessage = createMessage("user", normalizedContent);
      setMessages((current) => [
        ...current,
        userMessage,
        { id: assistantId, role: "assistant", content: "", status: "streaming" },
      ]);
      setInput("");
    }
    setLoadingConversation(true);
    setSendError(null);
    setFailedRequest(null);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      let streamedContent = "";
      await streamLearningChat({
        ...buildChatRequest(normalizedContent),
        stream: true,
      }, {
        signal: abortController.signal,
        onEvent: (event) => {
          if (event.type === "content" || event.type === "reasoning") {
            streamedContent += event.delta;
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? applyParsedMessage(message, streamedContent, "streaming")
                  : message,
              ),
            );
          }
          if (event.type === "done") {
            const finalContent = event.content || streamedContent;
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? applyParsedMessage(message, finalContent, "completed")
                  : message,
              ),
            );
          }
          if (event.type === "error") {
            throw new Error(event.message);
          }
        },
      });
      if (abortController.signal.aborted) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? { ...message, content: message.content || "已取消生成。", status: "cancelled" }
              : message,
          ),
        );
        return;
      }
      if (!streamedContent.trim()) {
        await sendMessageFallback(assistantId, normalizedContent);
      }
    } catch (err) {
      if (abortController.signal.aborted) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? { ...message, content: message.content || "已取消生成。", status: "cancelled" }
              : message,
          ),
        );
      } else {
        try {
          await sendMessageFallback(assistantId, normalizedContent);
        } catch (fallbackErr) {
          setSendError(normalizeError(fallbackErr || err));
          setFailedRequest({ content: normalizedContent, assistantId });
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, content: "请求失败，请重试。", status: "error" }
                : message,
            ),
          );
        }
      }
    } finally {
      sendingRef.current = false;
      abortControllerRef.current = null;
      setLoadingConversation(false);
    }
  }, [buildChatRequest, sendMessageFallback, username]);

  const sendMessage = useCallback(() => {
    void submitMessage(input, undefined);
  }, [input, submitMessage]);

  const retryFailedMessage = useCallback(() => {
    if (!failedRequest) {
      return;
    }
    void submitMessage(failedRequest.content, {
      retryAssistantId: failedRequest.assistantId,
    });
  }, [failedRequest, submitMessage]);

  const cancelGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  if (loadingModels && loadingContext) {
    return (
      <Screen>
        <StateView title="正在加载问答" message="正在准备模型、上下文和对话目标..." loading />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <StateView
          icon="alert-triangle"
          title="AI 问答加载失败"
          message={error.message}
          actionLabel="重试"
          onAction={() => void loadModels()}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <ScreenHeader
        overline="AI 问答"
        title={buildTargetLabel(target)}
        trailing={
          <AppButton
            title="刷新"
            variant="ghost"
            size="sm"
            onPress={() => void loadRuntimeContext(target?.lectureId, target?.bookId)}
          />
        }
      />

      <AppCard variant="muted" style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <AppText variant="caption" tone="muted">
            模型
          </AppText>
          <AppText variant="label">{selectedModelLabel}</AppText>
        </View>
        <View style={styles.summaryRow}>
          <AppText variant="caption" tone="muted">
            用户
          </AppText>
          <AppText variant="label">{context?.username || username || "未设置"}</AppText>
        </View>
        <View style={styles.summaryRow}>
          <AppText variant="caption" tone="muted">
            上下文块
          </AppText>
          <AppText variant="label">{contextBlocks.length} 段</AppText>
        </View>
        {models.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.modelOptions}
          >
            {models.map((model) => {
              const value = getModelValue(model);
              if (!value) {
                return null;
              }
              const active = selectedModelValue === value;
              return (
                <Pressable
                  key={value}
                  onPress={() => setSelectedModel(value)}
                  style={[styles.modelChip, active && styles.modelChipActive]}
                >
                  <AppText
                    variant="caption"
                    style={active ? styles.modelChipTextActive : styles.modelChipText}
                  >
                    {getModelLabel(model, value)}
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        {!loadingModels && models.length === 0 ? (
          <AppText variant="caption" tone="muted">
            后端未返回模型，聊天接口将使用后端默认配置。
          </AppText>
        ) : null}
        {contextError ? (
          <AppText variant="caption" tone="danger">
            {contextError.message}
          </AppText>
        ) : null}
      </AppCard>

      {messages.length === 0 ? (
        <StateView
          icon="message-circle"
          title="还没有对话"
          message="先选一个课程，然后开始提问。"
          actionLabel="去课程"
          onAction={openCourse}
        />
      ) : (
        <View style={styles.thread}>
          {messages.map((message) => (
            <ChatBubble key={message.id} message={message} />
          ))}
        </View>
      )}

      {sendError ? (
        <AppCard variant="outlined" style={styles.errorCard}>
          <AppText tone="danger" variant="caption" style={styles.flexText}>
            ⚠ {sendError.message}
          </AppText>
          {failedRequest ? (
            <AppButton
              title="重试"
              variant="outline"
              size="sm"
              loading={loadingConversation}
              onPress={retryFailedMessage}
              style={styles.retryButton}
            />
          ) : null}
        </AppCard>
      ) : null}

      <AppCard style={styles.composerCard}>
        <TextInput
          value={input}
          onChangeText={setInput}
          multiline
          placeholder="结合当前学习上下文继续提问..."
          placeholderTextColor={colors.textMuted}
          style={styles.composerInput}
          textAlignVertical="top"
        />
        <View style={styles.composerActions}>
          <View style={styles.statusDot}>
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: loadingConversation
                    ? colors.warning
                    : loadingContext
                      ? colors.textMuted
                      : colors.success,
                },
              ]}
            />
            <AppText variant="caption" tone="muted">
              {loadingConversation ? "生成中" : loadingContext ? "上下文加载中" : "就绪"}
            </AppText>
          </View>
          {loadingConversation ? (
            <AppButton
              title="取消"
              variant="outline"
              size="sm"
              onPress={cancelGeneration}
              style={styles.sendButton}
            />
          ) : (
            <AppButton
              title="发送"
              size="sm"
              disabled={!input.trim()}
              onPress={sendMessage}
              style={styles.sendButton}
            />
          )}
        </View>
      </AppCard>
    </Screen>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowAssistant]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <AppText
          variant="overline"
          style={isUser ? styles.bubbleRoleUser : styles.bubbleRoleAssistant}
        >
          {isUser ? "你" : message.status === "streaming" ? "助手 · 生成中" : "助手"}
        </AppText>
        {message.thinkingTitle ? (
          <AppText
            variant="caption"
            style={isUser ? styles.bubbleMetaUser : styles.bubbleMetaAssistant}
          >
            {message.thinkingTitle}
          </AppText>
        ) : null}
        {message.thinking ? (
          <View style={styles.thinkingBox}>
            <AppText variant="caption" tone="muted">
              {message.thinking}
            </AppText>
          </View>
        ) : null}
        <AppText style={isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant}>
          {message.content || "..."}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    gap: spacing.sm,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modelOptions: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  modelChip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  modelChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  modelChipText: {
    color: colors.textSecondary,
    fontWeight: "600",
  },
  modelChipTextActive: {
    color: colors.onPrimary,
    fontWeight: "600",
  },
  thread: {
    gap: spacing.md,
  },
  bubbleRow: {
    flexDirection: "row",
  },
  bubbleRowUser: {
    justifyContent: "flex-end",
  },
  bubbleRowAssistant: {
    justifyContent: "flex-start",
  },
  bubble: {
    maxWidth: "86%",
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  userBubble: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: radius.sm,
  },
  assistantBubble: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: radius.sm,
  },
  bubbleRoleUser: {
    color: "rgba(255,255,255,0.6)",
  },
  bubbleRoleAssistant: {
    color: colors.textMuted,
  },
  bubbleMetaUser: {
    color: "rgba(255,255,255,0.75)",
  },
  bubbleMetaAssistant: {
    color: colors.textSecondary,
  },
  bubbleTextUser: {
    color: colors.onPrimary,
    fontSize: 15,
    lineHeight: 22,
  },
  bubbleTextAssistant: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  thinkingBox: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  errorCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
  },
  flexText: {
    flex: 1,
  },
  retryButton: {
    minWidth: 72,
  },
  composerCard: {
    gap: spacing.md,
  },
  composerInput: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    minHeight: 96,
    padding: spacing.md,
    fontSize: 15,
  },
  composerActions: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statusDot: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sendButton: {
    minWidth: 96,
  },
});
