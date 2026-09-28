/**
 * §2.4 services/ReaderApi.ets — 阅读器与 telemetry 客户端。
 * 章节正文：GET /lectures/{l}/books/{b}/chapter/{idx}（返回 {success, content, paragraphs...}）
 * 目录：GET /lectures/{l}/books/{b}/index（{success, chapters:[{index,title,range...}]}）
 * 事件上报：POST /api/telemetry/ingest（reading 流：snapshot|scroll|selection|focus_in|focus_out|ask|session_complete）
 * 事实依据：NexoraLearning api/route_modules/books.py + api/telemetry.py（已读代码核实）。
 */
import { http } from '@kit.NetworkKit';
import { NxEnv } from '../config/Env';
import { Identity } from './Identity';
import {
  ReadingCheckpoint,
  nxReadingScope,
  nxDurablePendingReading,
  nxQueueReading,
  nxAcknowledgeReading,
} from './ReadingState';

export interface ChapterParagraph {
  index: number;
  start: number;
  end: number;
  chapter_offset: number;
  kind: string;
  heading_level: number;
  text: string;
}

export interface ChapterAnnotation {
  chapter_index: number;
  chapter_name: string;
  anchor_text: string;
  annotation_type: string;
  annotation_content: string;
}

export interface ChapterPayload {
  success: boolean;
  coordinate_space: string;
  chapter_index: number;
  chapter_title: string;
  chapter_start: number;
  chapter_end: number;
  chapter_range: string;
  chapter_count: number;
  content: string;
  total_chars: number;
  book_total_chars: number;
  paragraphs: ChapterParagraph[];
  annotations: ChapterAnnotation[];
  error?: string;
  message?: string;
}

export interface ChapterMeta {
  index: number;
  title: string;
  range: string;
  start: number;
  end: number;
}

export interface BookIndexPayload {
  success: boolean;
  coordinate_space: string;
  total_chars: number;
  paragraph_count: number;
  chapters: ChapterMeta[];
}

export interface ChapterCompleteResult {
  success: boolean;
  already_completed?: boolean;
  error?: string;
}

export interface TelemetryEvent {
  stream: string;
  event: string;
  bid: string;
  ci: number;
  si: number;
  sel_text?: string;
  scroll?: number;
  focus?: string;
  extra?: Record<string, string>;
}

export class ReaderApi {
  private root: string = NxEnv.baseUrl();
  private username: string = '';
  private static readingFlush: Promise<boolean> | null = null;

  private refreshConfig(): void {
    const override: string | undefined = AppStorage.get<string>('nxBaseUrl');
    const base: string = override !== undefined && override.trim().length > 0 ? override.trim() : NxEnv.baseUrl();
    this.root = base.replace(/\/+$/, '');
    this.username = Identity.current();
  }

  constructor() {
    this.refreshConfig();
  }

  private async requestJson(path: string): Promise<object> {
    await Identity.waitReady();
    this.refreshConfig();
    const client = http.createHttp();
    try {
      const resp: http.HttpResponse = await client.request(this.root + path, {
        method: http.RequestMethod.GET,
        header: Identity.authHeaders(),
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 15000,
        readTimeout: 30000,
      });
      if (resp.responseCode < 200 || resp.responseCode >= 300) {
        throw new Error('HTTP ' + resp.responseCode + ' ' + path);
      }
      const text: string = resp.result as string;
      try {
        return JSON.parse(text) as object;
      } catch (parseErr) {
        throw new Error('响应不是合法 JSON: ' + path);
      }
    } finally {
      client.destroy();
    }
  }

  async getChapter(lectureId: string, bookId: string, chapterIndex: number): Promise<ChapterPayload> {
    const payload = await this.requestJson(
      '/api/lectures/' + lectureId + '/books/' + bookId + '/chapter/' + chapterIndex + '?paragraphs=true');
    return payload as ChapterPayload;
  }

  async getIndex(lectureId: string, bookId: string): Promise<BookIndexPayload> {
    const payload = await this.requestJson('/api/lectures/' + lectureId + '/books/' + bookId + '/index');
    return payload as BookIndexPayload;
  }

  /** 教材内嵌图片的直链：`{{nxl_image:l:b:img_0050:xxx.jpg}}` 段落 → GET /api/lectures/{l}/books/{b}/images/{img}。 */
  imageUrl(lectureId: string, bookId: string, imageId: string): string {
    this.refreshConfig();
    return this.root + '/api/lectures/' + lectureId + '/books/' + bookId + '/images/' + imageId;
  }

  /**
   * 标记章节读完（POST /api/frontend/learning/chapter-complete，写 chapter_completed 学习记录）。
   * 显式完成与阅读覆盖分开，不能把翻过一页或退出阅读器当成读完。
   * 返回 true 表示已记录（含此前已完成）。
   */
  async postChapterComplete(lectureId: string, bookId: string, chapterName: string, chapterRange: string,
    chapterIndex: number): Promise<boolean> {
    await Identity.waitReady();
    this.refreshConfig();
    const client = http.createHttp();
    try {
      const body: Record<string, Object> = {
        'username': this.username,
        'lecture_id': lectureId,
        'book_id': bookId,
        'chapter_name': chapterName,
        'chapter_range': chapterRange,
        'chapter_index': chapterIndex,
      };
      const headers: Record<string, string> = Identity.authHeaders();
      headers['Content-Type'] = 'application/json';
      const resp: http.HttpResponse = await client.request(this.root + '/api/frontend/learning/chapter-complete', {
        method: http.RequestMethod.POST,
        header: headers,
        extraData: JSON.stringify(body),
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 15000,
        readTimeout: 30000,
      });
      if (resp.responseCode < 200 || resp.responseCode >= 300) {
        throw new Error('HTTP ' + resp.responseCode);
      }
      const payload: ChapterCompleteResult = JSON.parse(resp.result as string) as ChapterCompleteResult;
      if (payload.success !== true) {
        throw new Error(payload.error !== undefined ? payload.error : '标记失败');
      }
      return true;
    } finally {
      client.destroy();
    }
  }

  /** 先落本地再请求。章会话累计快照可安全合并，网络恢复后重发不会累计两次时长。 */
  async queueReadingProgress(point: ReadingCheckpoint): Promise<string> {
    if (Identity.current().length === 0) {
      return 'failed';
    }
    const scope = nxReadingScope();
    try {
      await nxQueueReading(scope, point);
    } catch (err) {
      if (scope === nxReadingScope()) {
        AppStorage.setOrCreate('nxReadingSyncStatus', 'failed');
      }
      return 'failed';
    }
    if (scope !== nxReadingScope()) {
      return 'pending';
    }
    const status = await this.flushReadingProgress() ? 'synced' : 'pending';
    if (scope === nxReadingScope()) {
      AppStorage.setOrCreate('nxReadingSyncStatus', status);
    }
    return status;
  }

  async flushReadingProgress(): Promise<boolean> {
    await Identity.waitReady();
    this.refreshConfig();
    if (this.username.length === 0) {
      return false;
    }
    if (ReaderApi.readingFlush !== null) {
      return ReaderApi.readingFlush;
    }
    ReaderApi.readingFlush = this.drainReadingProgress(nxReadingScope(), this.username);
    try {
      return await ReaderApi.readingFlush;
    } finally {
      ReaderApi.readingFlush = null;
    }
  }

  private async drainReadingProgress(scope: string, username: string): Promise<boolean> {
    let wrote = false;
    let drained = false;
    try {
      while (scope === nxReadingScope() && username === Identity.current()) {
        const pending = await nxDurablePendingReading(scope);
        if (scope !== nxReadingScope() || username !== Identity.current()) {
          return false;
        }
        if (pending.length === 0) {
          drained = true;
          return true;
        }
        const point = pending[0];
        const client = http.createHttp();
        try {
          const headers: Record<string, string> = Identity.authHeaders();
          headers['Content-Type'] = 'application/json';
          const body: Record<string, Object> = {
            'username': username,
            'lecture_id': point.lecture_id,
            'book_id': point.book_id,
            'chapter_index': point.chapter_index,
            'chapter_name': point.chapter_name,
            'chapter_range': point.chapter_range,
            'coordinate_space': point.coordinate_space,
            'session_id': point.session_id,
            'started_at_ms': point.started_at_ms !== undefined ? point.started_at_ms : 0,
            'observed_at_ms': point.observed_at_ms !== undefined ? point.observed_at_ms : 0,
            'sequence': point.sequence,
            'active_duration_ms': point.active_duration_ms,
            'read_ranges': point.read_ranges,
            'paragraph_index': point.paragraph_index,
            'page_index': point.page_index,
          };
          const resp: http.HttpResponse = await client.request(this.root + '/api/frontend/learning/reading-progress', {
            method: http.RequestMethod.POST,
            header: headers,
            extraData: JSON.stringify(body),
            expectDataType: http.HttpDataType.STRING,
            connectTimeout: 15000,
            readTimeout: 15000,
          });
          if (resp.responseCode < 200 || resp.responseCode >= 300) {
            return false;
          }
          const payload: ChapterCompleteResult = JSON.parse(resp.result as string) as ChapterCompleteResult;
          if (payload.success !== true) {
            return false;
          }
          await nxAcknowledgeReading(scope, point);
          wrote = true;
        } finally {
          client.destroy();
        }
      }
      return false;
    } catch (err) {
      // 请求失败时保留 outbox，下一次阅读心跳或进入书房继续补发。
      return false;
    } finally {
      if (wrote && scope === nxReadingScope()) {
        AppStorage.setOrCreate('nxReadingSyncStatus', drained ? 'synced' : 'pending');
        const previous = AppStorage.get<number>('nxStudyTick');
        AppStorage.setOrCreate('nxStudyTick', Math.max(Date.now(), (previous !== undefined ? previous : 0) + 1));
      }
    }
  }

  async postTelemetry(events: TelemetryEvent[]): Promise<boolean> {
    if (events.length === 0) {
      return true;
    }
    // telemetry 不经过 requestJson，也必须等待身份解析并读取最新环境配置。
    // 否则首个阅读事件可能带空 uid，或在本地联调切换后仍发往旧地址。
    await Identity.waitReady();
    this.refreshConfig();
    const client = http.createHttp();
    try {
      const rows: Record<string, Object>[] = [];
      for (const event of events) {
        const row: Record<string, Object> = {
          'stream': event.stream,
          'event': event.event,
          'uid': this.username,
          'bid': event.bid,
          'ci': event.ci,
          'si': event.si,
        };
        if (event.sel_text !== undefined) {
          row['sel_text'] = event.sel_text;
        }
        if (event.scroll !== undefined) {
          row['scroll'] = event.scroll;
        }
        if (event.focus !== undefined) {
          row['focus'] = event.focus;
        }
        if (event.extra !== undefined) {
          row['extra'] = event.extra;
        }
        rows.push(row);
      }
      const body: Record<string, Object> = {
        'user_id': this.username,
        'events': rows,
      };
      const headers: Record<string, string> = Identity.authHeaders();
      headers['Content-Type'] = 'application/json';
      const resp: http.HttpResponse = await client.request(this.root + '/api/telemetry/ingest', {
        method: http.RequestMethod.POST,
        header: headers,
        extraData: JSON.stringify(body),
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 15000,
        readTimeout: 15000,
      });
      return resp.responseCode >= 200 && resp.responseCode < 300;
    } catch (err) {
      return false;
    } finally {
      client.destroy();
    }
  }
}
