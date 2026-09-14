/**
 * 学习报告 / 知识图谱客户端（端内重建这两条路径，替代原先的浏览器跳转）。
 *
 * 事实依据（已读后端代码核实）：
 * - GET /api/frontend/learning/report?lecture_id=&book_id=
 *   → api/route_modules/frontend.py:524；返回 {success, lecture_title, summary{...},
 *     weaknesses[{title,detail}], recommendations[{title,detail}], ...}
 * - GET /api/frontend/knowledge-graph?lecture_id=&book_id=
 *   → api/route_modules/knowledge.py:9；返回 {success, graph, cached}，
 *     graph = {chapters:[{name, summary, concepts:[{name, detail}]}], relations:[...]}
 *     （core/knowledge_graph.py:load_cached_graph 只接受带 chapters 的结构）
 * 鉴权与 ReaderApi 同源：X-Nexora-Username。
 */
import { http } from '@kit.NetworkKit';
import { NxEnv } from '../config/Env';
import { Identity } from './Identity';

export interface ReportSummary {
  progress_percent: number;
  completed_chapters: number;
  total_chapters: number;
  completed_sessions: number;
  total_sessions: number;
  study_hours: number;
  submitted_questions: number;
  reviewed_questions: number;
  correct_questions: number;
  accuracy: number | null;
}

export interface ReportNote {
  title: string;
  detail: string;
}

export interface ReportPayload {
  success: boolean;
  lecture_title: string;
  summary: ReportSummary;
  weaknesses: ReportNote[];
  recommendations: ReportNote[];
  error?: string;
}

export interface GraphConcept {
  name: string;
  detail: string;
}

export interface GraphChapter {
  name: string;
  summary: string;
  concepts: GraphConcept[];
}

export interface GraphRelation {
  from: string;
  to: string;
  type: string;
}

export interface GraphBody {
  chapters: GraphChapter[];
  relations: GraphRelation[];
}

export interface GraphPayload {
  success: boolean;
  graph: GraphBody | null;
  cached: boolean;
}

export class ReportApi {
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
      const headers: Record<string, string> = {
        'X-Nexora-Username': this.username,
      };
      const resp: http.HttpResponse = await client.request(this.root + path, {
        method: http.RequestMethod.GET,
        header: headers,
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 15000,
        readTimeout: 30000,
      });
      if (resp.responseCode < 200 || resp.responseCode >= 300) {
        throw new Error('HTTP ' + resp.responseCode);
      }
      const text: string = resp.result as string;
      try {
        return JSON.parse(text) as object;
      } catch (parseErr) {
        throw new Error('响应不是合法 JSON');
      }
    } finally {
      client.destroy();
    }
  }

  async getReport(lectureId: string, bookId: string): Promise<ReportPayload> {
    let path: string = '/api/frontend/learning/report?lecture_id=' + lectureId;
    if (bookId.length > 0) {
      path += '&book_id=' + bookId;
    }
    const payload = await this.requestJson(path);
    return payload as ReportPayload;
  }

  async getGraph(lectureId: string, bookId: string): Promise<GraphPayload> {
    const payload = await this.requestJson(
      '/api/frontend/knowledge-graph?lecture_id=' + lectureId + '&book_id=' + bookId);
    return payload as GraphPayload;
  }
}
