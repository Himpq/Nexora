import type { LearningFeedAuthor } from "../../services/learningFeedService";

/**
 * @mention model for the learning feed.
 *
 * The backend has no user-directory endpoint available to normal users, so the
 * set of "real" users is derived from whoever is already present in the loaded
 * feed — post authors and commenters. That gives us real handles + avatars with
 * zero extra requests, and lets us answer the one question the UI needs: "does
 * this @token point at an actual user?" Only tokens that do are tinted blue.
 */
export type MentionUser = {
  /** Stable identity used for de-duplication and React keys. */
  userId: string;
  /** Space-free token inserted as `@handle`. */
  handle: string;
  /** Friendly label shown in the picker. */
  displayName: string;
  avatarUrl: string;
};

export type MentionDirectory = {
  users: MentionUser[];
  /** Normalized handle AND display-name → user, for fast `@token` lookup. */
  byKey: Map<string, MentionUser>;
};

type AuthorLike = { author?: LearningFeedAuthor; username?: string };

/** Lower-cased, trimmed key so `@GwLpq` and `@gwlpq` resolve to one user. */
export function normalizeMentionKey(value: string): string {
  return String(value || "").trim().toLowerCase();
}

/** Build a MentionUser from a feed item or comment's author block. */
export function makeMentionUser(source: AuthorLike): MentionUser | null {
  const author = source.author || {};
  const displayName = String(
    author.display_name || author.nickname || author.username || author.user_id || source.username || "",
  ).trim();
  // Handles are space-free so the `@handle` token survives the mention regex.
  const handle = String(
    author.username || author.user_id || source.username || author.nickname || author.display_name || "",
  )
    .trim()
    .replace(/\s+/g, "");
  if (!handle && !displayName) {
    return null;
  }
  const userId = String(
    author.user_id || author.username || source.username || handle || displayName,
  ).trim();
  return {
    userId: userId || handle || displayName,
    handle: handle || displayName,
    displayName: displayName || handle,
    avatarUrl: String(author.avatar_url || "").trim(),
  };
}

/** Collect the distinct users present in the feed (authors + commenters). */
export function buildMentionDirectory(
  items: ReadonlyArray<AuthorLike & { comments?: ReadonlyArray<AuthorLike> | null }>,
): MentionDirectory {
  const byUserId = new Map<string, MentionUser>();
  const consider = (source: AuthorLike) => {
    const user = makeMentionUser(source);
    if (user && !byUserId.has(user.userId)) {
      byUserId.set(user.userId, user);
    }
  };
  for (const item of items) {
    consider(item);
    for (const comment of item.comments || []) {
      consider(comment);
    }
  }
  const users = Array.from(byUserId.values());
  const byKey = new Map<string, MentionUser>();
  for (const user of users) {
    const handleKey = normalizeMentionKey(user.handle);
    const nameKey = normalizeMentionKey(user.displayName);
    // Handle wins on collision so an exact handle match is never shadowed.
    if (handleKey && !byKey.has(handleKey)) byKey.set(handleKey, user);
    if (nameKey && !byKey.has(nameKey)) byKey.set(nameKey, user);
  }
  return { users, byKey };
}

/** Resolve a bare `@token` (no leading "@") to a real user, if any. */
export function lookupMention(
  directory: MentionDirectory | undefined,
  token: string,
): MentionUser | undefined {
  if (!directory) return undefined;
  return directory.byKey.get(normalizeMentionKey(token));
}

export type MentionSegment = { text: string; mention: boolean };

// `@` + a run of non-space, non-"@" chars. The space requirement is what lets a
// user type "@name " and have only the name token considered for highlighting.
const MENTION_TOKEN = /@[^\s@]+/g;

/**
 * Split text into plain / mention segments. A `@token` only becomes a mention
 * segment when `isKnown(token)` is true — unknown `@text` stays plain, so not
 * everything after an "@" turns blue. Shared by the input renderer and the
 * read-only MentionText so both agree on what counts as a mention.
 */
export function splitMentions(text: string, isKnown: (token: string) => boolean): MentionSegment[] {
  const segments: MentionSegment[] = [];
  const regex = new RegExp(MENTION_TOKEN);
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const full = match[0];
    if (!isKnown(full.slice(1))) {
      // Leave the unknown token in place; it folds into the next plain slice.
      continue;
    }
    if (start > lastIndex) {
      segments.push({ text: text.slice(lastIndex, start), mention: false });
    }
    segments.push({ text: full, mention: true });
    lastIndex = start + full.length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), mention: false });
  }
  if (segments.length === 0) {
    segments.push({ text, mention: false });
  }
  return segments;
}

export type ActiveMentionQuery = { query: string; start: number };

/**
 * If the caret sits inside a `@…` token still being typed, return that token's
 * query text and the index of its "@" — this drives the user picker. Returns
 * null once the token is closed by whitespace (or there's no "@" before the
 * caret), and ignores mid-word "@" like in "a@b" so emails don't trigger it.
 */
export function getActiveMentionQuery(text: string, cursor: number): ActiveMentionQuery | null {
  const clamped = Math.max(0, Math.min(cursor, text.length));
  const upto = text.slice(0, clamped);
  const at = upto.lastIndexOf("@");
  if (at < 0) {
    return null;
  }
  const prev = at > 0 ? upto[at - 1] : "";
  if (prev && !/\s/.test(prev)) {
    return null;
  }
  const query = upto.slice(at + 1);
  if (/[\s@]/.test(query)) {
    return null;
  }
  return { query, start: at };
}

/** Candidates whose handle or name contains the query (case-insensitive). */
export function filterMentionCandidates(
  candidates: ReadonlyArray<MentionUser>,
  query: string,
  limit = 30,
): MentionUser[] {
  const normalized = normalizeMentionKey(query);
  if (!normalized) {
    return candidates.slice(0, limit);
  }
  const matches: MentionUser[] = [];
  for (const user of candidates) {
    if (
      normalizeMentionKey(user.handle).includes(normalized) ||
      normalizeMentionKey(user.displayName).includes(normalized)
    ) {
      matches.push(user);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}
