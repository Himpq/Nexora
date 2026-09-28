/**
 * 阅读状态的本地持久化（Preferences）：上次读到哪本书、哪一章、哪一段。
 * 阅读器写、书房读（「继续学习」回到那一页、书列表显示「上次读到」）。
 */
import { sharedCache } from './cache/CacheStore';
import { Identity } from './Identity';

export class ReadingPosition {
  chapter: number = 0;
  para: number = 0;
  paraOffset: number = 0;
  chapterTitle: string = '';
  bookTitle: string = '';
  lectureId: string = '';
  bookId: string = '';
  updatedAt: number = 0;
}

export function nxPositionKey(lectureId: string, bookId: string): string {
  return 'nx_pos_' + nxReadingScope() + '_' + lectureId + '_' + bookId;
}

/** 本地学习事实按账号和服务隔离；旧的无归属缓存不能拿给另一个账号。 */
export function nxReadingScope(): string {
  return encodeURIComponent(Identity.baseUrl()) + '_' + encodeURIComponent(Identity.current());
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
  return parsePosition(sharedCache.get('nx_last_book_' + nxReadingScope()));
}

export function nxSavePosition(position: ReadingPosition): void {
  const raw = JSON.stringify(position);
  sharedCache.put(nxPositionKey(position.lectureId, position.bookId), raw);
  sharedCache.put('nx_last_book_' + nxReadingScope(), raw);
}

/** 字符坐标与 Python 的 plain 正文一致，不能直接用 ArkTS UTF-16 length。 */
export function nxCodePointLength(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        index++;
      }
    }
    count++;
  }
  return count;
}

export class ReadingCheckpoint {
  lecture_id: string = '';
  book_id: string = '';
  chapter_index: number = 0;
  chapter_name: string = '';
  chapter_range: string = '';
  coordinate_space: string = 'plain';
  session_id: string = '';
  started_at_ms: number = 0;
  observed_at_ms: number = 0;
  sequence: number = 0;
  active_duration_ms: number = 0;
  read_ranges: number[][] = [];
  paragraph_index: number = 0;
  page_index: number = 0;
}

function copyRanges(ranges: number[][]): number[][] {
  const result: number[][] = [];
  for (const range of ranges) {
    if (range.length === 2 && range[1] > range[0]) {
      result.push([range[0], range[1]]);
    }
  }
  return result;
}

function mergeRanges(left: number[][], right: number[][]): number[][] {
  const ranges = copyRanges(left).concat(copyRanges(right));
  ranges.sort((a: number[], b: number[]): number => a[0] - b[0]);
  const merged: number[][] = [];
  for (const range of ranges) {
    if (merged.length === 0 || range[0] > merged[merged.length - 1][1]) {
      merged.push(range);
    } else {
      const last = merged[merged.length - 1];
      last[1] = Math.max(last[1], range[1]);
    }
  }
  return merged;
}

/** 每次进入一章建立一个会话：累计前台时长、实际停留页的覆盖，不以最远页码推断已读。 */
export class ReadingSession {
  private point: ReadingCheckpoint;
  private active: boolean = false;
  private accountedAt: number = 0;
  private pageDwellMs: number = 0;
  private visibleRanges: number[][] = [];

  constructor(point: ReadingCheckpoint) {
    this.point = point;
  }

  private settle(now: number): void {
    const elapsed = Math.max(0, now - this.accountedAt);
    if (this.active && this.visibleRanges.length > 0) {
      this.point.active_duration_ms += elapsed;
      this.pageDwellMs += elapsed;
      // 快速划过和目录跳转只改变位置，不虚增阅读覆盖。
      if (this.pageDwellMs >= 2000) {
        this.point.read_ranges = mergeRanges(this.point.read_ranges, this.visibleRanges);
      }
    }
    this.accountedAt = now;
  }

  enterPage(ranges: number[][], active: boolean, now: number): void {
    this.settle(now);
    this.visibleRanges = copyRanges(ranges);
    this.pageDwellMs = 0;
    this.active = active;
  }

  setActive(active: boolean, now: number): void {
    this.settle(now);
    this.active = active;
    if (!active) {
      this.pageDwellMs = 0;
    }
  }

  snapshot(paragraphIndex: number, pageIndex: number, now: number): ReadingCheckpoint {
    this.settle(now);
    this.point.sequence++;
    this.point.paragraph_index = paragraphIndex;
    this.point.page_index = pageIndex;
    // 请求发出后页面仍会继续阅读，不能让旧请求共享后来变化的范围或序号。
    const point = new ReadingCheckpoint();
    point.lecture_id = this.point.lecture_id;
    point.book_id = this.point.book_id;
    point.chapter_index = this.point.chapter_index;
    point.chapter_name = this.point.chapter_name;
    point.chapter_range = this.point.chapter_range;
    point.coordinate_space = this.point.coordinate_space;
    point.session_id = this.point.session_id;
    point.started_at_ms = this.point.started_at_ms;
    point.observed_at_ms = now;
    point.sequence = this.point.sequence;
    point.active_duration_ms = this.point.active_duration_ms;
    point.read_ranges = copyRanges(this.point.read_ranges);
    point.paragraph_index = paragraphIndex;
    point.page_index = pageIndex;
    return point;
  }
}

/** 每个会话每天保留最新累计快照；不能覆盖前一日用于分日记账的边界。 */
export function nxPendingReading(scope: string): ReadingCheckpoint[] {
  const raw = sharedCache.getRequired('nx_reading_outbox_' + scope);
  if (raw.length === 0) {
    return [];
  }
  try {
    const points = JSON.parse(raw) as ReadingCheckpoint[];
    if (Array.isArray(points)) {
      return points;
    }
    throw new Error('阅读记录格式有误');
  } catch (err) {
    throw new Error('阅读记录未能读取，不能覆盖已有记录');
  }
}

function readingDay(point: ReadingCheckpoint): string {
  const timestamp = point.observed_at_ms !== undefined ? point.observed_at_ms : 0;
  const date = new Date(timestamp);
  // 同时保留设备自然日和 UTC 日边界，兼容不同服务器时区的按日聚合。
  return date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate() + '_' + Math.floor(timestamp / 86400000);
}

let readingWrite: Promise<void> = Promise.resolve();

function withReadingWrite(action: () => Promise<void>): Promise<void> {
  const pending = readingWrite.then(action);
  readingWrite = pending.catch((): void => {
    // 只解除串行锁；原 Promise 的异常仍由调用方处理并反馈给用户。
  });
  return pending;
}

export function nxQueueReading(scope: string, point: ReadingCheckpoint): Promise<void> {
  return withReadingWrite(async (): Promise<void> => {
    const pending = nxPendingReading(scope);
    const next: ReadingCheckpoint[] = [];
    let found = false;
    for (const previous of pending) {
      if (previous.session_id === point.session_id && readingDay(previous) === readingDay(point)) {
        next.push(previous.sequence > point.sequence ? previous : point);
        found = true;
      } else {
        next.push(previous);
      }
    }
    if (!found) {
      next.push(point);
    }
    await sharedCache.putDurable('nx_reading_outbox_' + scope, JSON.stringify(next));
  });
}

export function nxAcknowledgeReading(scope: string, point: ReadingCheckpoint): Promise<void> {
  return withReadingWrite(async (): Promise<void> => {
    const next: ReadingCheckpoint[] = [];
    for (const previous of nxPendingReading(scope)) {
      if (previous.session_id !== point.session_id || previous.sequence > point.sequence || readingDay(previous) !== readingDay(point)) {
        next.push(previous);
      }
    }
    await sharedCache.putDurable('nx_reading_outbox_' + scope, JSON.stringify(next));
  });
}

/** 上一次 flush 失败可能只改了 Preferences 内存值，发送前再次确保已落盘。 */
export async function nxDurablePendingReading(scope: string): Promise<ReadingCheckpoint[]> {
  let pending: ReadingCheckpoint[] = [];
  await withReadingWrite(async (): Promise<void> => {
    pending = nxPendingReading(scope);
    pending.sort((left: ReadingCheckpoint, right: ReadingCheckpoint): number => {
      if (left.session_id === right.session_id) {
        return left.sequence - right.sequence;
      }
      return left.session_id < right.session_id ? -1 : 1;
    });
    await sharedCache.putDurable('nx_reading_outbox_' + scope, JSON.stringify(pending));
  });
  return pending;
}
