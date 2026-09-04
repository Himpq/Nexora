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

  private refreshConfig(): void {
    const override: string | undefined = AppStorage.get<string>('nxBaseUrl');
    const base: string = override !== undefined && override.trim().length > 0 ? override.trim() : NxEnv.baseUrl();
    this.root = base.replace(/\/+$/, '');
    const usernameOverride: string | undefined = AppStorage.get<string>('nxUsername');
    if (usernameOverride !== undefined && usernameOverride.length > 0) {
      this.username = usernameOverride;
    }
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
   * 课程进度 = 已完成章节 / 总章节，此前 App 从未上报，进度因此一直停在种子值。
   * 返回 true 表示已记录（含此前已完成）。
   */
  async postChapterComplete(lectureId: string, bookId: string, chapterName: string, chapterRange: string): Promise<boolean> {
    await Identity.waitReady();
    this.refreshConfig();
    const client = http.createHttp();
    try {
      const body: Record<string, string> = {
        'username': this.username,
        'lecture_id': lectureId,
        'book_id': bookId,
        'chapter_name': chapterName,
        'chapter_range': chapterRange,
      };
      const resp: http.HttpResponse = await client.request(this.root + '/api/frontend/learning/chapter-complete', {
        method: http.RequestMethod.POST,
        header: {
          'Content-Type': 'application/json',
          'X-Nexora-Username': this.username,
        },
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
      const resp: http.HttpResponse = await client.request(this.root + '/api/telemetry/ingest', {
        method: http.RequestMethod.POST,
        header: {
          'Content-Type': 'application/json',
        },
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
