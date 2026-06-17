import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { useSession } from "../../../app/providers/SessionProvider";
import {
  AnimatedPressable,
  AppBadge,
  AppButton,
  AppCard,
  AppText,
  colors,
  FadeIn,
  haptics,
  radius,
  Screen,
  ScreenHeader,
  Skeleton,
  spacing,
  StateView,
} from "../../../design";
import {
  addLearningFeedComment,
  createLearningFeed,
  createLearningFeedChannel,
  deleteLearningFeed,
  deleteLearningFeedChannel,
  deleteLearningFeedComment,
  listLearningFeeds,
  toggleLearningFeedLike,
  type LearningFeedChannel,
  type LearningFeedComment,
  type LearningFeedItem,
} from "../../../services/learningFeedService";
import { normalizeError } from "../../../utils/errors";

type OperationTarget =
  | "create-feed"
  | "create-channel"
  | `like:${string}`
  | `delete-feed:${string}`
  | `comment:${string}`
  | `delete-comment:${string}:${string}`
  | `delete-channel:${string}`;

type QueuedOperation = {
  target: OperationTarget;
  action: () => Promise<void>;
};

const PUBLIC_CHANNEL_MEMBER_SENTINEL = "ALL";

function getChannelTitle(channel?: LearningFeedChannel) {
  return String(channel?.title || channel?.id || "").trim() || "未命名频道";
}

function getAuthorName(item: Pick<LearningFeedItem | LearningFeedComment, "author" | "username">) {
  const author = item.author || {};
  return (
    String(
      author.display_name ||
        author.nickname ||
        author.username ||
        author.user_id ||
        item.username ||
        "",
    )
      .trim() || "未知用户"
  );
}

function getFeedContent(item: LearningFeedItem) {
  return String(item.content || item.summary || "").trim();
}

function formatTimestamp(timestamp?: number) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "";
  }
  return new Date(numeric * 1000).toLocaleString();
}

function updateFeedItem(items: LearningFeedItem[], updatedItem: LearningFeedItem) {
  const updatedId = String(updatedItem.id || "").trim();
  if (!updatedId) {
    return items;
  }
  return items.map((item) => (String(item.id) === updatedId ? { ...item, ...updatedItem } : item));
}

function hasLiked(item: LearningFeedItem, username: string) {
  const likedUserIds = Array.isArray(item.liked_user_ids) ? item.liked_user_ids : [];
  return likedUserIds.map((id) => String(id)).includes(username);
}

export function LearningFeedScreen() {
  const { isAdmin, username } = useSession();
  const [channels, setChannels] = useState<LearningFeedChannel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState("public_all");
  const [items, setItems] = useState<LearningFeedItem[]>([]);
  const [composerText, setComposerText] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [channelTitle, setChannelTitle] = useState("");
  const [channelMembers, setChannelMembers] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [operationError, setOperationError] = useState<Error | null>(null);
  const [activeOperation, setActiveOperation] = useState<OperationTarget | null>(null);
  const [queuedOperationCount, setQueuedOperationCount] = useState(0);
  const activeOperationRef = useRef<OperationTarget | null>(null);
  const operationQueueRef = useRef<QueuedOperation[]>([]);
  const selectedChannelIdRef = useRef(selectedChannelId);
  const loadRequestIdRef = useRef(0);

  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId);

  useEffect(() => {
    selectedChannelIdRef.current = selectedChannelId;
  }, [selectedChannelId]);

  const loadFeed = useCallback(
    async (channelId = "public_all", options?: { replaceScreen?: boolean }) => {
      const requestId = loadRequestIdRef.current + 1;
      loadRequestIdRef.current = requestId;
      const replaceScreen = options?.replaceScreen ?? false;
      if (replaceScreen) {
        setLoading(true);
      }
      setError(null);
      setOperationError(null);
      try {
        const result = await listLearningFeeds({ channelId, limit: 50 });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        const nextChannels = Array.isArray(result.channels) ? result.channels : [];
        const nextChannelId = String(result.channel_id || channelId || "public_all").trim();
        setChannels(nextChannels);
        setSelectedChannelId(nextChannelId || "public_all");
        setItems(Array.isArray(result.items) ? result.items : []);
        setCommentDrafts({});
      } catch (err) {
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        const nextError = normalizeError(err);
        if (replaceScreen) {
          setError(nextError);
        } else {
          setOperationError(nextError);
        }
      } finally {
        if (loadRequestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void loadFeed("public_all", { replaceScreen: true });
  }, [loadFeed]);

  const runOperation = useCallback(
    (target: OperationTarget, action: () => Promise<void>) => {
      operationQueueRef.current.push({ target, action });
      setQueuedOperationCount(operationQueueRef.current.length);

      if (activeOperationRef.current) {
        return;
      }

      const drainQueue = async () => {
        while (operationQueueRef.current.length > 0) {
          const next = operationQueueRef.current.shift();
          setQueuedOperationCount(operationQueueRef.current.length);
          if (!next) {
            continue;
          }

          activeOperationRef.current = next.target;
          setActiveOperation(next.target);
          setOperationError(null);
          try {
            await next.action();
          } catch (err) {
            setOperationError(normalizeError(err));
          } finally {
            activeOperationRef.current = null;
            setActiveOperation(null);
          }
        }
        setQueuedOperationCount(0);
      };

      void drainQueue();
    },
    [],
  );

  const handleSelectChannel = useCallback(
    (channelId: string) => {
      if (!channelId || channelId === selectedChannelId || activeOperationRef.current) {
        return;
      }
      setSelectedChannelId(channelId);
      setCommentDrafts({});
      void loadFeed(channelId, { replaceScreen: false });
    },
    [loadFeed, selectedChannelId],
  );

  const handleCreateFeed = useCallback(() => {
    const content = composerText.trim();
    if (!content) {
      return;
    }
    const channelIdAtStart = selectedChannelId;
    void runOperation("create-feed", async () => {
      const result = await createLearningFeed({
        content,
        channel_id: channelIdAtStart,
      });
      if (selectedChannelIdRef.current === channelIdAtStart) {
        setItems((current) => [result.item, ...current]);
      }
      setComposerText("");
    });
  }, [composerText, runOperation, selectedChannelId]);

  const handleToggleLike = useCallback(
    (item: LearningFeedItem) => {
      const feedId = String(item.id || "").trim();
      if (!feedId) {
        return;
      }
      const channelIdAtStart = selectedChannelIdRef.current;
      void runOperation(`like:${feedId}`, async () => {
        const result = await toggleLearningFeedLike(feedId);
        if (selectedChannelIdRef.current === channelIdAtStart) {
          setItems((current) => updateFeedItem(current, result.item));
        }
      });
    },
    [runOperation],
  );

  const handleAddComment = useCallback(
    (item: LearningFeedItem) => {
      const feedId = String(item.id || "").trim();
      const content = String(commentDrafts[feedId] || "").trim();
      if (!feedId || !content) {
        return;
      }
      const channelIdAtStart = selectedChannelIdRef.current;
      void runOperation(`comment:${feedId}`, async () => {
        const result = await addLearningFeedComment(feedId, content);
        if (selectedChannelIdRef.current === channelIdAtStart) {
          setItems((current) => updateFeedItem(current, result.item));
          setCommentDrafts((current) => ({ ...current, [feedId]: "" }));
        }
      });
    },
    [commentDrafts, runOperation],
  );

  const handleDeleteFeed = useCallback(
    (item: LearningFeedItem) => {
      const feedId = String(item.id || "").trim();
      if (!feedId) {
        return;
      }
      const channelIdAtStart = selectedChannelIdRef.current;
      void runOperation(`delete-feed:${feedId}`, async () => {
        await deleteLearningFeed(feedId);
        if (selectedChannelIdRef.current === channelIdAtStart) {
          setItems((current) => current.filter((feedItem) => String(feedItem.id) !== feedId));
        }
      });
    },
    [runOperation],
  );

  const handleDeleteComment = useCallback(
    (item: LearningFeedItem, comment: LearningFeedComment) => {
      const feedId = String(item.id || "").trim();
      const commentId = String(comment.id || "").trim();
      if (!feedId || !commentId) {
        return;
      }
      const channelIdAtStart = selectedChannelIdRef.current;
      void runOperation(`delete-comment:${feedId}:${commentId}`, async () => {
        const result = await deleteLearningFeedComment(feedId, commentId);
        if (selectedChannelIdRef.current === channelIdAtStart) {
          setItems((current) => updateFeedItem(current, result.item));
        }
      });
    },
    [runOperation],
  );

  const handleCreateChannel = useCallback(() => {
    const title = channelTitle.trim();
    const members = channelMembers
      .split(",")
      .map((member) => member.trim())
      .filter(Boolean);
    if (!isAdmin || !title) {
      return;
    }
    void runOperation("create-channel", async () => {
      const result = await createLearningFeedChannel({
        title,
        member_user_ids: members.length > 0 ? members : [PUBLIC_CHANNEL_MEMBER_SENTINEL],
      });
      setChannels((current) => [...current, result.item]);
      setSelectedChannelId(result.item.id);
      setChannelTitle("");
      setChannelMembers("");
      await loadFeed(result.item.id, { replaceScreen: false });
    });
  }, [channelMembers, channelTitle, isAdmin, loadFeed, runOperation]);

  const handleDeleteChannel = useCallback(
    (channel: LearningFeedChannel) => {
      const channelId = String(channel.id || "").trim();
      if (!channelId || channel.builtin) {
        return;
      }
      void runOperation(`delete-channel:${channelId}`, async () => {
        await deleteLearningFeedChannel(channelId);
        await loadFeed("public_all", { replaceScreen: false });
      });
    },
    [loadFeed, runOperation],
  );

  if (loading) {
    return (
      <Screen scroll tabBarSpace>
        <Skeleton width="45%" height={26} style={styles.skHeader} />
        <View style={styles.skPills}>
          <Skeleton width={72} height={34} borderRadius={radius.pill} />
          <Skeleton width={88} height={34} borderRadius={radius.pill} />
          <Skeleton width={64} height={34} borderRadius={radius.pill} />
        </View>
        <Skeleton height={120} borderRadius={radius.lg} style={styles.skHeader} />
        <Skeleton height={160} borderRadius={radius.lg} style={styles.skHeader} />
        <Skeleton height={160} borderRadius={radius.lg} />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen tabBarSpace>
        <StateView
          icon="alert-triangle"
          title="动态加载失败"
          message={error.message}
          actionLabel="重试"
          onAction={() => void loadFeed(selectedChannelId, { replaceScreen: true })}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll tabBarSpace>
      <ScreenHeader
        overline="Nexora"
        title="学习动态"
        subtitle={`${getChannelTitle(selectedChannel)} · ${items.length} 条动态`}
        trailing={
          <AppButton
            title="刷新"
            variant="ghost"
            size="sm"
            onPress={() => void loadFeed(selectedChannelId, { replaceScreen: false })}
          />
        }
      />

      <View style={styles.channelRow}>
        {channels.map((channel) => {
          const selected = channel.id === selectedChannelId;
          return (
            <AnimatedPressable
              key={channel.id}
              disabled={Boolean(activeOperation)}
              onPress={() => {
                haptics.selection();
                handleSelectChannel(channel.id);
              }}
              press={{ pressedScale: 0.95 }}
              style={[
                styles.channelPill,
                selected && styles.channelPillSelected,
                activeOperation ? styles.channelPillDisabled : null,
              ]}
            >
              <AppText
                variant="caption"
                style={selected ? styles.channelPillTextSelected : styles.channelPillText}
              >
                {getChannelTitle(channel)}
              </AppText>
            </AnimatedPressable>
          );
        })}
      </View>

      {operationError ? (
        <AppCard variant="outlined" style={styles.errorCard}>
          <AppText tone="danger" variant="caption" style={styles.flexText}>
            ⚠ {operationError.message}
          </AppText>
          <AppButton title="关闭" variant="ghost" size="sm" onPress={() => setOperationError(null)} />
        </AppCard>
      ) : null}

      <AppCard style={styles.composerCard}>
        <TextInput
          value={composerText}
          onChangeText={setComposerText}
          multiline
          placeholder="分享学习进展、问题或补充资料"
          placeholderTextColor={colors.textMuted}
          style={styles.composerInput}
          textAlignVertical="top"
        />
        <View style={styles.cardActions}>
          <AppText variant="caption" tone="muted">
            发布到 {getChannelTitle(selectedChannel)}
          </AppText>
          <AppButton
            title="发布"
            size="sm"
            loading={activeOperation === "create-feed"}
            disabled={!composerText.trim()}
            onPress={handleCreateFeed}
            style={styles.compactButton}
          />
        </View>
      </AppCard>

      {activeOperation || queuedOperationCount > 0 ? (
        <AppCard variant="muted" style={styles.queueStatusCard}>
          <AppText variant="caption" tone="muted">
            {activeOperation ? "正在同步操作" : "等待同步"}
            {queuedOperationCount > 0 ? ` · 队列中 ${queuedOperationCount} 项` : ""}
          </AppText>
        </AppCard>
      ) : null}

      {isAdmin ? (
        <AppCard style={styles.adminCard}>
          <AppText variant="overline" tone="muted">
            频道管理
          </AppText>
          <TextInput
            value={channelTitle}
            onChangeText={setChannelTitle}
            placeholder="频道名称"
            placeholderTextColor={colors.textMuted}
            style={styles.singleLineInput}
          />
          <TextInput
            value={channelMembers}
            onChangeText={setChannelMembers}
            placeholder="成员 username，逗号分隔；留空为公开频道"
            placeholderTextColor={colors.textMuted}
            style={styles.singleLineInput}
          />
          <View style={styles.cardActions}>
            <AppText variant="caption" tone="muted">
              新频道
            </AppText>
            <AppButton
              title="创建频道"
              variant="outline"
              size="sm"
              loading={activeOperation === "create-channel"}
              disabled={!isAdmin || !channelTitle.trim()}
              onPress={handleCreateChannel}
              style={styles.compactButton}
            />
          </View>
          {channels
            .filter((channel) => !channel.builtin)
            .map((channel) => (
              <View key={channel.id} style={styles.channelAdminRow}>
                <View style={styles.titleBlock}>
                  <AppText variant="bodyStrong">{getChannelTitle(channel)}</AppText>
                  <AppText variant="caption" tone="muted">
                    {channel.type === "public"
                      ? "公开频道"
                      : `${channel.member_user_ids?.length || 0} 名成员`}
                  </AppText>
                </View>
                <AppButton
                  title="删除"
                  variant="ghost"
                  size="sm"
                  loading={activeOperation === `delete-channel:${channel.id}`}
                  onPress={() => handleDeleteChannel(channel)}
                  style={styles.tinyButton}
                />
              </View>
            ))}
        </AppCard>
      ) : null}

      {items.length === 0 ? (
        <StateView
          icon="activity"
          title="暂无动态"
          message="当前频道还没有学习动态。"
          actionLabel="刷新"
          onAction={() => void loadFeed(selectedChannelId, { replaceScreen: false })}
        />
      ) : (
        items.map((item, index) => {
          const feedId = String(item.id || "").trim();
          const liked = hasLiked(item, username);
          const comments = Array.isArray(item.comments) ? item.comments : [];
          return (
            <FadeIn key={feedId || `feed-${index}`} index={index}>
            <AppCard style={styles.feedCard}>
              <View style={styles.feedHeader}>
                <View style={styles.avatar}>
                  <AppText style={styles.avatarText}>
                    {getAuthorName(item).slice(0, 1).toUpperCase()}
                  </AppText>
                </View>
                <View style={styles.titleBlock}>
                  <View style={styles.authorRow}>
                    <AppText variant="bodyStrong">{getAuthorName(item)}</AppText>
                    {item.author_is_admin ? <AppBadge label="Admin" tone="solid" /> : null}
                  </View>
                  {formatTimestamp(item.timestamp) ? (
                    <AppText variant="caption" tone="muted">
                      {formatTimestamp(item.timestamp)}
                    </AppText>
                  ) : null}
                </View>
                {item.can_delete ? (
                  <AppButton
                    title="删除"
                    variant="ghost"
                    size="sm"
                    loading={activeOperation === `delete-feed:${feedId}`}
                    onPress={() => handleDeleteFeed(item)}
                    style={styles.tinyButton}
                  />
                ) : null}
              </View>

              <AppText style={styles.feedContent}>{getFeedContent(item)}</AppText>

              <View style={styles.feedActions}>
                <AnimatedPressable
                  onPress={() => {
                    haptics.impact("light");
                    handleToggleLike(item);
                  }}
                  press={{ pressedScale: 0.92 }}
                  style={[styles.likeButton, liked && styles.likeButtonActive]}
                >
                  <AppText variant="caption" style={liked ? styles.likeTextActive : styles.likeText}>
                    {liked ? "♥" : "♡"} {item.likes_count || 0}
                  </AppText>
                </AnimatedPressable>
                <AppText variant="caption" tone="tertiary">
                  评论 {item.comments_count ?? comments.length}
                </AppText>
              </View>

              {comments.length > 0 ? (
                <View style={styles.comments}>
                  {comments.map((comment, commentIndex) => {
                    const commentId = String(comment.id || "").trim();
                    return (
                      <View key={commentId || `comment-${feedId}-${commentIndex}`} style={styles.commentRow}>
                        <View style={styles.titleBlock}>
                          <AppText variant="caption" tone="muted">
                            {getAuthorName(comment)}
                            {comment.author_is_admin ? " · Admin" : ""}
                          </AppText>
                          <AppText variant="caption">{comment.content}</AppText>
                        </View>
                        {comment.can_delete ? (
                          <AppButton
                            title="删除"
                            variant="ghost"
                            size="sm"
                            loading={activeOperation === `delete-comment:${feedId}:${commentId}`}
                            onPress={() => handleDeleteComment(item, comment)}
                            style={styles.tinyButton}
                          />
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}

              <View style={styles.commentComposer}>
                <TextInput
                  value={commentDrafts[feedId] || ""}
                  onChangeText={(text) =>
                    setCommentDrafts((current) => ({ ...current, [feedId]: text }))
                  }
                  placeholder="写评论"
                  placeholderTextColor={colors.textMuted}
                  style={styles.commentInput}
                />
                <AppButton
                  title="发送"
                  variant="outline"
                  size="sm"
                  loading={activeOperation === `comment:${feedId}`}
                  disabled={!String(commentDrafts[feedId] || "").trim()}
                  onPress={() => handleAddComment(item)}
                  style={styles.compactButton}
                />
              </View>
            </AppCard>
            </FadeIn>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  channelRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  channelPill: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  channelPillSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  channelPillDisabled: {
    opacity: 0.55,
  },
  skHeader: {
    marginBottom: spacing.lg,
  },
  skPills: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  channelPillText: {
    color: colors.textSecondary,
    fontWeight: "600",
  },
  channelPillTextSelected: {
    color: colors.onPrimary,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.7,
  },
  errorCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
  },
  queueStatusCard: {
    paddingVertical: spacing.md,
  },
  flexText: {
    flex: 1,
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
    minHeight: 92,
    padding: spacing.md,
    fontSize: 15,
  },
  singleLineInput: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    fontSize: 15,
  },
  cardActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  compactButton: {
    minWidth: 88,
  },
  tinyButton: {
    minWidth: 56,
    paddingHorizontal: spacing.sm,
  },
  adminCard: {
    gap: spacing.md,
  },
  channelAdminRow: {
    alignItems: "center",
    borderTopColor: colors.divider,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  feedCard: {
    gap: spacing.md,
  },
  feedHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceInverse,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: "700",
  },
  authorRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  feedContent: {
    flexShrink: 1,
    lineHeight: 22,
  },
  feedActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  likeButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
  },
  likeButtonActive: {
    backgroundColor: colors.surfaceInverse,
    borderColor: colors.surfaceInverse,
  },
  likeText: {
    color: colors.textSecondary,
    fontWeight: "600",
  },
  likeTextActive: {
    color: colors.textInverse,
    fontWeight: "600",
  },
  comments: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    gap: spacing.md,
    padding: spacing.md,
  },
  commentRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
  },
  commentComposer: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  commentInput: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    fontSize: 14,
  },
});
