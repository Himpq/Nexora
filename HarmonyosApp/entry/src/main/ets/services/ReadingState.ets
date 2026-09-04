/**
 * 阅读状态的本地持久化（Preferences）：上次读到哪本书、哪一章、哪一段。
 * 阅读器写、书房读（「继续学习」回到那一页、书列表显示「上次读到」）。
 */
import { sharedCache } from './cache/CacheStore';

export class ReadingPosition {
  chapter: number = 0;
  para: number = 0;
  chapterTitle: string = '';
  bookTitle: string = '';
  lectureId: string = '';
  bookId: string = '';
  updatedAt: number = 0;
}

export function nxPositionKey(lectureId: string, bookId: string): string {
  return 'nx_pos_' + lectureId + '_' + bookId;
}

function parsePosition(raw: string): ReadingPosition | null {
  if (raw.length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw) as ReadingPosition;
  } catch (err) {
    return null;
  }
}

export function nxReadPosition(lectureId: string, bookId: string): ReadingPosition | null {
  return parsePosition(sharedCache.get(nxPositionKey(lectureId, bookId)));
}

/** 最近一次读的书（跨教材），书房「继续学习」用。 */
export function nxLastBook(): ReadingPosition | null {
  return parsePosition(sharedCache.get('nx_last_book'));
}

export function nxSavePosition(position: ReadingPosition): void {
  const raw = JSON.stringify(position);
  sharedCache.put(nxPositionKey(position.lectureId, position.bookId), raw);
  sharedCache.put('nx_last_book', raw);
}
