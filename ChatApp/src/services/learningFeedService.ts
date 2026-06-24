import { deleteJson, getJson, patchJson, postJson } from "./apiClient";

export type LearningFeedAuthor = {
  user_id?: string;
  username?: string;
  nickname?: string;
  display_name?: string;
  avatar_url?: string;
  [key: string]: unknown;
};

export type LearningFeedChannel = {
  id: string;
  title: string;
  type?: "public" | "private" | string;
  member_user_ids?: string[];
  builtin?: boolean;
  created_by?: string;
  created_at?: number;
  updated_at?: number;
  [key: string]: unknown;
};

export type LearningFeedComment = {
  id: string;
  timestamp?: number;
  username?: string;
  author?: LearningFeedAuthor;
  author_is_admin?: boolean;
  can_delete?: boolean;
  content: string;
  liked_user_ids?: string[];
  likes_count?: number;
  [key: string]: unknown;
};

export type LearningFeedItem = {
  id: string;
  type?: string;
  channel_id?: string;
  summary?: string;
  content?: string;
  username?: string;
  author?: LearningFeedAuthor;
  author_is_admin?: boolean;
  can_delete?: boolean;
  comments?: LearningFeedComment[];
  comments_count?: number;
  liked_user_ids?: string[];
  likes_count?: number;
  timestamp?: number;
  [key: string]: unknown;
};

export type LearningFeedChannelsResponse = {
  success: boolean;
  items: LearningFeedChannel[];
  total: number;
  [key: string]: unknown;
};

export type LearningFeedListResponse = {
  success: boolean;
  items: LearningFeedItem[];
  total: number;
  channel_id: string;
  channels: LearningFeedChannel[];
  [key: string]: unknown;
};

export function listLearningFeedChannels() {
  return getJson<LearningFeedChannelsResponse>("/api/frontend/learning-feeds/channels");
}

export function createLearningFeedChannel(payload: {
  title: string;
  member_user_ids?: string[];
}) {
  return postJson<{ success: boolean; item: LearningFeedChannel }>(
    "/api/frontend/settings/feed-channels",
    payload,
  );
}

export function deleteLearningFeedChannel(channelId: string) {
  return deleteJson<{ success: boolean; channel_id: string }>(
    `/api/frontend/settings/feed-channels/${encodeURIComponent(channelId)}`,
  );
}

export function listLearningFeeds(options?: { channelId?: string; limit?: number }) {
  return getJson<LearningFeedListResponse>("/api/frontend/learning-feeds", {
    query: {
      channel_id: options?.channelId,
      limit: options?.limit,
    },
  });
}

export function createLearningFeed(payload: { content: string; channel_id?: string }) {
  return postJson<{ success: boolean; item: LearningFeedItem }>(
    "/api/frontend/learning-feeds",
    payload,
  );
}

export function toggleLearningFeedLike(feedId: string) {
  return postJson<{ success: boolean; item: LearningFeedItem }>(
    `/api/frontend/learning-feeds/${encodeURIComponent(feedId)}/like`,
  );
}

export function addLearningFeedComment(feedId: string, content: string) {
  return postJson<{ success: boolean; item: LearningFeedItem }>(
    `/api/frontend/learning-feeds/${encodeURIComponent(feedId)}/comments`,
    { content },
  );
}

export function deleteLearningFeed(feedId: string) {
  return deleteJson<{ success: boolean; feed_id: string }>(
    `/api/frontend/learning-feeds/${encodeURIComponent(feedId)}`,
  );
}

export function deleteLearningFeedComment(feedId: string, commentId: string) {
  return deleteJson<{ success: boolean; item: LearningFeedItem }>(
    `/api/frontend/learning-feeds/${encodeURIComponent(feedId)}/comments/${encodeURIComponent(
      commentId,
    )}`,
  );
}

export function toggleLearningFeedCommentLike(feedId: string, commentId: string) {
  return postJson<{ success: boolean; item: LearningFeedItem }>(
    `/api/frontend/learning-feeds/${encodeURIComponent(feedId)}/comments/${encodeURIComponent(
      commentId,
    )}/like`,
  );
}

export function updateLearningFeedChannel(
  channelId: string,
  payload: { title?: string; member_user_ids?: string[] },
) {
  return patchJson<{ success: boolean; item: LearningFeedChannel }>(
    `/api/frontend/settings/feed-channels/${encodeURIComponent(channelId)}`,
    payload,
  );
}
