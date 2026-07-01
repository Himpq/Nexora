import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { useSession } from "../../../app/providers/SessionProvider";
import {
  AnimatedPressable,
  AppBadge,
  AppButton,
  AppCard,
  AppText,
  Avatar,
  colors,
  FadeIn,
  haptics,
  motion,
  radius,
  Screen,
  ScreenHeader,
  shadow,
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
  toggleLearningFeedCommentLike,
  toggleLearningFeedLike,
  type LearningFeedAuthor,
  type LearningFeedChannel,
  type LearningFeedComment,
  type LearningFeedItem,
} from "../../../services/learningFeedService";
import { formatRelativeTime } from "../../../utils/format";
import { normalizeError } from "../../../utils/errors";
import { CommentComposer } from "../components/CommentComposer";
import { LikeButton } from "../components/LikeButton";
import { MentionText } from "../components/MentionText";
import { buildMentionDirectory, normalizeMentionKey } from "../mentions";

type OperationTarget =
  | "create-feed"
  | "create-channel"
  | `like:${string}`
  | `comment-like:${string}:${string}`
  | `delete-feed:${string}`
  | `comment:${string}`
  | `delete-comment:${string}:${string}`
  | `delete-channel:${string}`;

type QueuedOperation = {
  target: OperationTarget;
  action: () => Promise<void>;
};

// What the docked comment composer is currently aimed at. `replyHandle` is set
// when replying to a comment, and is prepended as "@handle " on submit since the
// backend has no threaded replies — it keeps the reply addressed to its target.
type ActiveComposer = {
  feedId: string;
  placeholder: string;
  replyHandle?: string;
};

const PUBLIC_CHANNEL_MEMBER_SENTINEL = "ALL";
const SCROLL_TOP_THRESHOLD = 360;

// Blue-grey expand strip — grey-dominant with just a hint of the accent.
const EXPAND_BG = "#EAEEF5";
const EXPAND_FG = "#5B6675";

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
    ).trim() || "未知用户"
  );
}

// Space-free handle used to build "@mention " reply prefixes.
function getMentionHandle(item: Pick<LearningFeedItem | LearningFeedComment, "author" | "username">) {
  const author = item.author || {};
  return (
    String(author.username || author.user_id || item.username || author.nickname || author.display_name || "")
      .trim()
      .replace(/\s+/g, "") || "用户"
  );
}

function getAuthorAvatarUrl(item: Pick<LearningFeedItem | LearningFeedComment, "author">) {
  const author = item.author || {};
  return String(author.avatar_url || "").trim();
}

function getFeedContent(item: LearningFeedItem) {
  return String(item.content || item.summary || "").trim();
}

function updateFeedItem(items: LearningFeedItem[], updatedItem: LearningFeedItem) {
  const updatedId = String(updatedItem.id || "").trim();
  if (!updatedId) {
    return items;
  }
  return items.map((item) => (String(item.id) === updatedId ? { ...item, ...updatedItem } : item));
}

function normalizeAvatarKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

// Build a username/user_id → avatar_url map from authors we already have, plus
// the signed-in user. The create / comment / like endpoints return author blocks
// without avatar_url (only the list endpoint includes it), so without this the
// whole card falls back to initials until a manual refresh. We re-fill from here.
function collectAvatarMap(
  items: ReadonlyArray<LearningFeedItem>,
  self?: { username?: string; avatarUrl?: string },
): Map<string, string> {
  const map = new Map<string, string>();
  const add = (author: LearningFeedAuthor | undefined, username: string | undefined) => {
    const url = String(author?.avatar_url || "").trim();
    if (!url) {
      return;
    }
    for (const key of [author?.user_id, author?.username, username]) {
      const normalized = normalizeAvatarKey(key);
      if (normalized && !map.has(normalized)) {
        map.set(normalized, url);
      }
    }
  };
  for (const item of items) {
    add(item.author, item.username);
    for (const comment of item.comments || []) {
      add(comment.author, comment.username);
    }
  }
  const selfUrl = String(self?.avatarUrl || "").trim();
  const selfKey = normalizeAvatarKey(self?.username);
  if (selfUrl && selfKey && !map.has(selfKey)) {
    map.set(selfKey, selfUrl);
  }
  return map;
}

// Restore a missing author avatar from the map; leaves a present one untouched.
function withAvatar(
  author: LearningFeedAuthor | undefined,
  username: string | undefined,
  map: Map<string, string>,
): LearningFeedAuthor {
  const base = author || {};
  if (String(base.avatar_url || "").trim()) {
    return base;
  }
  for (const key of [base.user_id, base.username, username]) {
    const url = map.get(normalizeAvatarKey(key));
    if (url) {
      return { ...base, avatar_url: url };
    }
  }
  return base;
}

// Re-fill avatars on a server item (post author + every comment author).
function hydrateFeedItem(item: LearningFeedItem, map: Map<string, string>): LearningFeedItem {
  const comments = Array.isArray(item.comments) ? item.comments : [];
  return {
    ...item,
    author: withAvatar(item.author, item.username, map),
    comments: comments.map((comment) => ({
      ...comment,
      author: withAvatar(comment.author, comment.username, map),
    })),
  };
}

function hasLiked(item: LearningFeedItem, username: string) {
  const likedUserIds = Array.isArray(item.liked_user_ids) ? item.liked_user_ids : [];
  return likedUserIds.map((id) => String(id)).includes(username);
}

function hasLikedComment(comment: LearningFeedComment, username: string) {
  const likedUserIds = Array.isArray(comment.liked_user_ids) ? comment.liked_user_ids : [];
  return likedUserIds.map((id) => String(id)).includes(username);
}

// Toggle the current user's like on a feed item, in place, for optimistic UI.
function toggleFeedLikeLocally(item: LearningFeedItem, username: string): LearningFeedItem {
  const likedIds = Array.isArray(item.liked_user_ids) ? item.liked_user_ids.map(String) : [];
  const liked = likedIds.includes(username);
  const nextIds = liked ? likedIds.filter((id) => id !== username) : [...likedIds, username];
  const base = Number.isFinite(Number(item.likes_count)) ? Number(item.likes_count) : likedIds.length;
  return {
    ...item,
    liked_user_ids: nextIds,
    likes_count: Math.max(0, liked ? base - 1 : base + 1),
  };
}

function toggleCommentLikeLocally(
  item: LearningFeedItem,
  commentId: string,
  username: string,
): LearningFeedItem {
  const comments = Array.isArray(item.comments) ? item.comments : [];
  return {
    ...item,
    comments: comments.map((comment) => {
      if (String(comment.id) !== commentId) {
        return comment;
      }
      const likedIds = Array.isArray(comment.liked_user_ids) ? comment.liked_user_ids.map(String) : [];
      const liked = likedIds.includes(username);
      const nextIds = liked ? likedIds.filter((id) => id !== username) : [...likedIds, username];
      const base = Number.isFinite(Number(comment.likes_count))
        ? Number(comment.likes_count)
        : likedIds.length;
      return {
        ...comment,
        liked_user_ids: nextIds,
        likes_count: Math.max(0, liked ? base - 1 : base + 1),
      };
    }),
  };
}

export function LearningFeedScreen() {
  const { isAdmin, username, context } = useSession();
  const { height } = useWindowDimensions();
  // The signed-in user's avatar, used to re-fill responses that omit it.
  const sessionAvatarUrl = String(context?.user?.avatar_url || "").trim();

  const [channels, setChannels] = useState<LearningFeedChannel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState("public_all");
  const [items, setItems] = useState<LearningFeedItem[]>([]);
  const [composerText, setComposerText] = useState("");
  const [activeComposer, setActiveComposer] = useState<ActiveComposer | null>(null);
  const [expandedFeedIds, setExpandedFeedIds] = useState<Set<string>>(() => new Set());
  const [channelTitle, setChannelTitle] = useState("");
  const [channelMembers, setChannelMembers] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [operationError, setOperationError] = useState<Error | null>(null);
  const [activeOperation, setActiveOperation] = useState<OperationTarget | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const activeOperationRef = useRef<OperationTarget | null>(null);
  const operationQueueRef = useRef<QueuedOperation[]>([]);
  const selectedChannelIdRef = useRef(selectedChannelId);
  const loadRequestIdRef = useRef(0);
  const scrollRef = useRef<ScrollView | null>(null);

  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId);

  // Real users known from the current feed — authors + commenters. Drives both
  // mention highlighting (full set, so a comment can @ anyone, even you) and the
  // "@" picker (self filtered out — you don't mention yourself).
  const mentionDirectory = useMemo(() => buildMentionDirectory(items), [items]);
  const mentionCandidates = useMemo(() => {
    const selfKey = normalizeMentionKey(username);
    return mentionDirectory.users.filter((user) => normalizeMentionKey(user.handle) !== selfKey);
  }, [mentionDirectory, username]);

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
        setActiveComposer(null);
        setExpandedFeedIds(new Set());
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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadFeed(selectedChannelIdRef.current, { replaceScreen: false });
    setRefreshing(false);
  }, [loadFeed]);

  const runOperation = useCallback(
    (target: OperationTarget, action: () => Promise<void>) => {
      operationQueueRef.current.push({ target, action });

      if (activeOperationRef.current) {
        return;
      }

      const drainQueue = async () => {
        while (operationQueueRef.current.length > 0) {
          const next = operationQueueRef.current.shift();
          if (!next) {
            continue;
          }
          activeOperationRef.current = next.target;
          setActiveOperation(next.target);
          try {
            await next.action();
          } catch (err) {
            setOperationError(normalizeError(err));
          } finally {
            activeOperationRef.current = null;
            setActiveOperation(null);
          }
        }
      };

      void drainQueue();
    },
    [],
  );

  // Apply a server-returned feed item, re-filling any avatars it dropped from
  // what we already know (existing authors + the signed-in user).
  const mergeServerItem = useCallback(
    (serverItem: LearningFeedItem) => {
      setItems((current) =>
        updateFeedItem(
          current,
          hydrateFeedItem(serverItem, collectAvatarMap(current, { username, avatarUrl: sessionAvatarUrl })),
        ),
      );
    },
    [sessionAvatarUrl, username],
  );

  const handleSelectChannel = useCallback(
    (channelId: string) => {
      if (!channelId || channelId === selectedChannelId || activeOperationRef.current) {
        return;
      }
      haptics.selection();
      setSelectedChannelId(channelId);
      setActiveComposer(null);
      setExpandedFeedIds(new Set());
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
      const result = await createLearningFeed({ content, channel_id: channelIdAtStart });
      if (selectedChannelIdRef.current === channelIdAtStart) {
        setItems((current) => [
          hydrateFeedItem(
            result.item,
            collectAvatarMap(current, { username, avatarUrl: sessionAvatarUrl }),
          ),
          ...current,
        ]);
      }
      setComposerText("");
    });
  }, [composerText, runOperation, selectedChannelId, sessionAvatarUrl, username]);

  const handleToggleLike = useCallback(
    (item: LearningFeedItem) => {
      const feedId = String(item.id || "").trim();
      if (!feedId) {
        return;
      }
      const wasLiked = hasLiked(item, username);
      haptics.impact(wasLiked ? "light" : "medium");
      // Optimistic flip first, reconcile with the server when it returns.
      setItems((current) =>
        current.map((feedItem) =>
          String(feedItem.id) === feedId ? toggleFeedLikeLocally(feedItem, username) : feedItem,
        ),
      );
      const channelIdAtStart = selectedChannelIdRef.current;
      void runOperation(`like:${feedId}`, async () => {
        try {
          const result = await toggleLearningFeedLike(feedId);
          if (selectedChannelIdRef.current === channelIdAtStart) {
            mergeServerItem(result.item);
          }
        } catch (err) {
          // Revert the optimistic flip and surface the error.
          setItems((current) =>
            current.map((feedItem) =>
              String(feedItem.id) === feedId ? toggleFeedLikeLocally(feedItem, username) : feedItem,
            ),
          );
          throw err;
        }
      });
    },
    [mergeServerItem, runOperation, username],
  );

  const handleToggleCommentLike = useCallback(
    (item: LearningFeedItem, comment: LearningFeedComment) => {
      const feedId = String(item.id || "").trim();
      const commentId = String(comment.id || "").trim();
      if (!feedId || !commentId) {
        return;
      }
      const wasLiked = hasLikedComment(comment, username);
      haptics.impact(wasLiked ? "light" : "medium");
      setItems((current) =>
        current.map((feedItem) =>
          String(feedItem.id) === feedId
            ? toggleCommentLikeLocally(feedItem, commentId, username)
            : feedItem,
        ),
      );
      const channelIdAtStart = selectedChannelIdRef.current;
      void runOperation(`comment-like:${feedId}:${commentId}`, async () => {
        try {
          const result = await toggleLearningFeedCommentLike(feedId, commentId);
          if (selectedChannelIdRef.current === channelIdAtStart) {
            mergeServerItem(result.item);
          }
        } catch (err) {
          setItems((current) =>
            current.map((feedItem) =>
              String(feedItem.id) === feedId
                ? toggleCommentLikeLocally(feedItem, commentId, username)
                : feedItem,
            ),
          );
          throw err;
        }
      });
    },
    [mergeServerItem, runOperation, username],
  );

  const openComposer = useCallback((feedId: string) => {
    haptics.impact("light");
    setActiveComposer({ feedId, placeholder: "写评论…" });
  }, []);

  const closeComposer = useCallback(() => {
    setActiveComposer(null);
  }, []);

  const replyToComment = useCallback((feedId: string, comment: LearningFeedComment) => {
    haptics.impact("light");
    setActiveComposer({
      feedId,
      placeholder: `回复 ${getAuthorName(comment)}：`,
      replyHandle: getMentionHandle(comment),
    });
  }, []);

  const toggleExpandComments = useCallback((feedId: string) => {
    haptics.selection();
    setExpandedFeedIds((current) => {
      const next = new Set(current);
      if (next.has(feedId)) {
        next.delete(feedId);
      } else {
        next.add(feedId);
      }
      return next;
    });
  }, []);

  const submitComment = useCallback(
    (feedId: string, content: string) => {
      const body = content.trim();
      if (!feedId || !body) {
        return;
      }
      const channelIdAtStart = selectedChannelIdRef.current;
      void runOperation(`comment:${feedId}`, async () => {
        const result = await addLearningFeedComment(feedId, body);
        if (selectedChannelIdRef.current === channelIdAtStart) {
          mergeServerItem(result.item);
          setExpandedFeedIds((current) => new Set(current).add(feedId));
          // Close the composer only if it's still aimed at this feed.
          setActiveComposer((current) => (current?.feedId === feedId ? null : current));
        }
      });
    },
    [mergeServerItem, runOperation],
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
          mergeServerItem(result.item);
        }
      });
    },
    [mergeServerItem, runOperation],
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

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const next = offsetY > SCROLL_TOP_THRESHOLD;
    setShowScrollTop((previous) => (previous === next ? previous : next));
  }, []);

  const scrollToTop = useCallback(() => {
    haptics.impact("light");
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  if (loading) {
    return (
      <Screen scroll tabBarSpace>
        <Skeleton width="45%" height={26} style={styles.skBlock} />
        <View style={styles.skPills}>
          <Skeleton width={72} height={34} borderRadius={radius.pill} />
          <Skeleton width={88} height={34} borderRadius={radius.pill} />
          <Skeleton width={64} height={34} borderRadius={radius.pill} />
        </View>
        <Skeleton height={120} borderRadius={radius.lg} style={styles.skBlock} />
        <Skeleton height={168} borderRadius={radius.lg} style={styles.skBlock} />
        <Skeleton height={168} borderRadius={radius.lg} />
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
    <Screen scroll={false} tabBarSpace={false} style={styles.flush}>
      <ScrollView
        ref={scrollRef}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.textTertiary}
            colors={[colors.text]}
          />
        }
      >
        <ScreenHeader
          overline="Nexora"
          title="学习动态"
          subtitle={`${getChannelTitle(selectedChannel)} · ${items.length} 条动态`}
        />

        <View style={styles.channelRow}>
          {channels.map((channel) => {
            const selected = channel.id === selectedChannelId;
            return (
              <AnimatedPressable
                key={channel.id}
                disabled={Boolean(activeOperation)}
                onPress={() => handleSelectChannel(channel.id)}
                silent
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
          <AppCard variant="outlined" style={styles.errorBanner}>
            <Feather name="alert-circle" size={16} color={colors.danger} />
            <AppText tone="danger" variant="caption" style={styles.flexText}>
              {operationError.message}
            </AppText>
            <AnimatedPressable onPress={() => setOperationError(null)} hitSlop={8} silent>
              <Feather name="x" size={16} color={colors.textTertiary} />
            </AnimatedPressable>
          </AppCard>
        ) : null}

        <AppCard style={styles.composerCard}>
          <View style={styles.composerTop}>
            <TextInput
              value={composerText}
              onChangeText={setComposerText}
              multiline
              placeholder="分享你的学习进展、想法或问题…"
              placeholderTextColor={colors.textMuted}
              style={styles.composerInput}
              textAlignVertical="top"
            />
          </View>
          <View style={styles.composerBottom}>
            <AppText variant="caption" tone="muted">
              发布到 {getChannelTitle(selectedChannel)}
            </AppText>
            <AppButton
              title="发布"
              size="sm"
              loading={activeOperation === "create-feed"}
              disabled={!composerText.trim()}
              onPress={handleCreateFeed}
              style={styles.publishButton}
            />
          </View>
        </AppCard>

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
            <View style={styles.adminActions}>
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
                style={styles.publishButton}
              />
            </View>
            {channels
              .filter((channel) => !channel.builtin)
              .map((channel) => (
                <View key={channel.id} style={styles.channelAdminRow}>
                  <View style={styles.flexText}>
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
            icon="message-square"
            title="暂无动态"
            message="当前频道还没有学习动态，发布第一条吧。"
          />
        ) : (
          items.map((item, index) => {
            const feedId = String(item.id || "").trim();
            const comments = Array.isArray(item.comments) ? item.comments : [];
            const expanded = expandedFeedIds.has(feedId);
            const visibleComments = expanded ? comments : comments.slice(0, 1);
            const liked = hasLiked(item, username);
            const commentsCount = item.comments_count ?? comments.length;

            return (
              <FadeIn key={feedId || `feed-${index}`} index={Math.min(index, 8)}>
                <AppCard style={styles.feedCard}>
                  <AnimatedPressable
                    onPress={() => openComposer(feedId)}
                    silent
                    press={{ pressedScale: 0.995 }}
                    style={styles.feedBody}
                  >
                    <View style={styles.feedHeader}>
                      <Avatar uri={getAuthorAvatarUrl(item)} name={getAuthorName(item)} size="md" />
                      <View style={styles.headerText}>
                        <View style={styles.authorRow}>
                          <AppText variant="bodyStrong">{getAuthorName(item)}</AppText>
                          {item.author_is_admin ? <AppBadge label="Admin" tone="solid" /> : null}
                        </View>
                        {formatRelativeTime(item.timestamp) ? (
                          <AppText variant="caption" tone="muted">
                            {formatRelativeTime(item.timestamp)}
                          </AppText>
                        ) : null}
                      </View>
                    </View>
                    <MentionText
                      variant="body"
                      style={styles.feedContent}
                      content={getFeedContent(item)}
                      directory={mentionDirectory}
                    />
                  </AnimatedPressable>

                  <View style={styles.feedActions}>
                    <LikeButton liked={liked} count={item.likes_count || 0} onPress={() => handleToggleLike(item)} />
                    <AnimatedPressable
                      onPress={() => openComposer(feedId)}
                      silent
                      press={{ pressedScale: 0.9 }}
                      hitSlop={6}
                      style={styles.commentButton}
                    >
                      <Feather name="message-circle" size={17} color={colors.textTertiary} />
                      {commentsCount > 0 ? (
                        <AppText variant="caption" tone="tertiary">
                          {commentsCount}
                        </AppText>
                      ) : null}
                    </AnimatedPressable>
                    <View style={styles.spacer} />
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

                  {comments.length > 0 ? (
                    <View style={styles.commentsBox}>
                      {visibleComments.map((comment, commentIndex) => {
                        const commentId = String(comment.id || "").trim();
                        const commentLiked = hasLikedComment(comment, username);
                        return (
                          <AnimatedPressable
                            key={commentId || `comment-${feedId}-${commentIndex}`}
                            onPress={() => replyToComment(feedId, comment)}
                            silent
                            press={{ pressedScale: 0.985 }}
                            style={styles.commentRow}
                          >
                            <Avatar
                              uri={getAuthorAvatarUrl(comment)}
                              name={getAuthorName(comment)}
                              size="sm"
                            />
                            <View style={styles.commentMain}>
                              <View style={styles.commentTopRow}>
                                <AppText variant="caption" tone="secondary" style={styles.commentAuthor} numberOfLines={1}>
                                  {getAuthorName(comment)}
                                  {comment.author_is_admin ? " · Admin" : ""}
                                </AppText>
                                {formatRelativeTime(comment.timestamp) ? (
                                  <AppText variant="caption" tone="muted">
                                    {formatRelativeTime(comment.timestamp)}
                                  </AppText>
                                ) : null}
                              </View>
                              <MentionText
                                variant="caption"
                                content={comment.content}
                                directory={mentionDirectory}
                              />
                            </View>
                            <LikeButton
                              size="sm"
                              liked={commentLiked}
                              count={comment.likes_count || 0}
                              onPress={() => handleToggleCommentLike(item, comment)}
                            />
                            {comment.can_delete ? (
                              <AnimatedPressable
                                onPress={() => handleDeleteComment(item, comment)}
                                silent
                                hitSlop={8}
                                style={styles.commentDelete}
                              >
                                {activeOperation === `delete-comment:${feedId}:${commentId}` ? (
                                  <ActivityIndicator size="small" color={colors.textMuted} />
                                ) : (
                                  <Feather name="trash-2" size={14} color={colors.textMuted} />
                                )}
                              </AnimatedPressable>
                            ) : null}
                          </AnimatedPressable>
                        );
                      })}

                      {comments.length > 1 ? (
                        <AnimatedPressable
                          onPress={() => toggleExpandComments(feedId)}
                          silent
                          press={{ pressedScale: 0.97 }}
                          style={styles.expandStrip}
                        >
                          <AppText variant="caption" style={styles.expandText}>
                            {expanded ? "收起评论" : `展开 ${comments.length} 条评论`}
                          </AppText>
                          <Feather
                            name={expanded ? "chevron-up" : "chevron-down"}
                            size={14}
                            color={EXPAND_FG}
                          />
                        </AnimatedPressable>
                      ) : null}
                    </View>
                  ) : null}
                </AppCard>
              </FadeIn>
            );
          })
        )}
      </ScrollView>

      <ScrollTopButton visible={showScrollTop} onPress={scrollToTop} top={height * 0.4} />

      <CommentComposer
        visible={activeComposer !== null}
        directory={mentionDirectory}
        candidates={mentionCandidates}
        placeholder={activeComposer?.placeholder ?? "写评论…"}
        submitting={activeComposer ? activeOperation === `comment:${activeComposer.feedId}` : false}
        onClose={closeComposer}
        onSubmit={(value) => {
          if (!activeComposer) {
            return;
          }
          const body = value.trim();
          if (!body) {
            return;
          }
          // Flatten replies into "@handle " prefixes — the backend has no threads.
          const content = activeComposer.replyHandle
            ? `@${activeComposer.replyHandle} ${body}`
            : body;
          submitComment(activeComposer.feedId, content);
        }}
      />
    </Screen>
  );
}

function ScrollTopButton({
  visible,
  onPress,
  top,
}: {
  visible: boolean;
  onPress: () => void;
  top: number;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withSpring(visible ? 1 : 0, motion.spring.snappy);
  }, [progress, visible]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.7 + progress.value * 0.3 }, { translateX: (1 - progress.value) * 16 }],
  }));

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[styles.scrollTopWrap, { top }, animatedStyle]}
    >
      <AnimatedPressable onPress={onPress} silent press={{ pressedScale: 0.9 }} style={styles.scrollTopButton}>
        <Feather name="chevrons-up" size={22} color={colors.text} />
      </AnimatedPressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flush: {
    padding: 0,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: 112,
  },

  // Skeleton
  skBlock: {
    marginBottom: spacing.lg,
  },
  skPills: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },

  // Channels
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
  channelPillText: {
    color: colors.textSecondary,
    fontWeight: "600",
  },
  channelPillTextSelected: {
    color: colors.onPrimary,
    fontWeight: "600",
  },

  // Error banner
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
  },
  flexText: {
    flex: 1,
  },

  // Composer (new post)
  composerCard: {
    gap: spacing.md,
  },
  composerTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  composerInput: {
    flex: 1,
    minHeight: 40,
    paddingTop: 6,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  composerBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: colors.borderFaint,
    paddingTop: spacing.md,
  },
  publishButton: {
    minWidth: 84,
  },

  // Admin channel management
  adminCard: {
    gap: spacing.md,
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
  adminActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  tinyButton: {
    minWidth: 56,
    paddingHorizontal: spacing.sm,
  },

  // Feed card
  feedCard: {
    gap: spacing.md,
  },
  feedBody: {
    gap: spacing.sm,
  },
  feedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  feedContent: {
    lineHeight: 22,
  },
  feedActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderFaint,
    paddingTop: spacing.sm,
  },
  commentButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
  },
  spacer: {
    flex: 1,
  },

  // Comments
  commentsBox: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  commentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  commentMain: {
    flex: 1,
    gap: 2,
  },
  commentTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  commentAuthor: {
    flexShrink: 1,
  },
  commentDelete: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  expandStrip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    paddingVertical: 5,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: EXPAND_BG,
  },
  expandText: {
    color: EXPAND_FG,
    fontWeight: "600",
  },

  // Scroll-to-top
  scrollTopWrap: {
    position: "absolute",
    right: spacing.lg,
  },
  scrollTopButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.lg,
  },
});
