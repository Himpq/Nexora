/**
 * NexoraLearning Agent Facade 客户端。
 * 封装 /api/agent/v1 的 HTTP 调用：统一信封解析、演示用户鉴权、超时与错误处理。
 * 云端基线：https://chat.himpqblog.cn:5002（HTTPS，公开受信证书）。
 */
import { http } from '@kit.NetworkKit';

export interface AgentError {
  code: string;
  message: string;
}

export interface LearnTarget {
  lecture_id: string;
  lecture_title: string;
  book_id: string;
  book_title: string;
  chapter_index: number;
  chapter_name: string;
  chapter_range: string;
}

export interface AgentAction {
  type: string;
  task_id: string;
  session_id: string;
  target: LearnTarget;
}

export interface AgentEnvelope {
  success: boolean;
  request_id: string;
  action: string;
  data: object;
  next_actions: AgentAction[];
  error: AgentError | null;
}

export interface PlanInfo {
  status: string;
  intent: string;
  available_minutes: number;
  estimated_minutes: number;
  reason: string;
  target: LearnTarget;
}

export interface PlanData {
  plan: PlanInfo;
}

export interface ContextUser {
  id: string;
  username: string;
  display_name: string;
  role: string;
}

export interface ContextBook {
  id: string;
  title: string;
  text_status: string;
  refinement_status: string;
  description: string;
}

export interface ContextLecture {
  id: string;
  title: string;
  status: string;
  progress_percent: number;
  current_chapter: string;
  next_chapter: string;
  description: string;
  category: string;
  books: ContextBook[];
}

export interface ActiveSession {
  session_id: string;
  lecture_id: string;
  book_id: string;
  chapter_index: number;
  chapter_name: string;
  chapter_range: string;
  status: string;
  source: string;
  timestamp: number;
}

export interface RecentRecord {
  book_id: string;
  lecture_id: string;
  chapter_index: number;
  chapter_name: string;
  session_name: string;
  type: string;
  timestamp: number;
}

export interface ContextData {
  user: ContextUser;
  lectures: ContextLecture[];
  active_session: ActiveSession;
  selected_lecture_ids: string[];
  recent_learning_records: RecentRecord[];
}

export interface OpenSessionData {
  session_id: string;
  created_at: number;
  entry_type: string;
  entry_url: string;
  resume: boolean;
  target: LearnTarget;
}

export interface TaskInfo {
  task_id: string;
  type: string;
  status: string;
  user_id: string;
  lecture_id: string;
  book_id: string;
  chapter_index: number;
  created_at: number;
  updated_at: number;
  error: AgentError | null;
  result: ReviewResult;
}

export interface ReviewQuestion {
  type: string;
  title: string;
  content: string;
  difficulty: string;
  hint: string;
  answer: string;
  options: string[];
  source: string;
  source_id: string;
}

export interface ReviewResult {
  lecture_id: string;
  book_id: string;
  chapter_index: number;
  chapter_name: string;
  quiz_id: string;
  questions: ReviewQuestion[];
}

export interface ReviewPlanData {
  task: TaskInfo;
}

export interface TaskData {
  task: TaskInfo;
}

export interface AskAnswer {
  answer: string;
  source: string;
  book_id: string;
  lecture_id: string;
  context_chars: number;
}

export class AgentApi {
  private baseUrl: string = 'https://chat.himpqblog.cn:5002/api/agent/v1';
  private username: string = 'cjbpq';
  private apiKey: string = '';

  setAuth(username: string, apiKey: string): void {
    if (username.length > 0) {
      this.username = username;
    }
    this.apiKey = apiKey;
  }

  private buildOptions(method: http.RequestMethod, body: string): http.HttpRequestOptions {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Nexora-Username': this.username,
    };
    if (this.apiKey.length > 0) {
      headers['X-API-Key'] = this.apiKey;
    }
    const options: http.HttpRequestOptions = {
      method: method,
      header: headers,
      expectDataType: http.HttpDataType.STRING,
      connectTimeout: 15000,
      readTimeout: 45000,
    };
    if (body.length > 0) {
      options.extraData = body;
    }
    return options;
  }

  private async request(method: http.RequestMethod, path: string, body: string): Promise<AgentEnvelope> {
    const client = http.createHttp();
    try {
      const resp: http.HttpResponse = await client.request(this.baseUrl + path, this.buildOptions(method, body));
      if (resp.responseCode < 200 || resp.responseCode >= 300) {
        throw new Error('HTTP ' + resp.responseCode + ' ' + path);
      }
      const text: string = resp.result as string;
      let envelope: AgentEnvelope;
      try {
        envelope = JSON.parse(text) as AgentEnvelope;
      } catch (parseErr) {
        throw new Error('响应不是合法 JSON: ' + path);
      }
      if (envelope.success !== true) {
        const code: string = envelope.error !== null ? envelope.error.code : 'UNKNOWN';
        const message: string = envelope.error !== null ? envelope.error.message : '未知错误';
        throw new Error(code + ': ' + message);
      }
      return envelope;
    } finally {
      client.destroy();
    }
  }

  getContext(): Promise<AgentEnvelope> {
    return this.request(http.RequestMethod.GET, '/context', '');
  }

  getToday(): Promise<AgentEnvelope> {
    return this.request(http.RequestMethod.GET, '/today', '');
  }

  postPlan(intent: string, availableMinutes: number): Promise<AgentEnvelope> {
    const payload: Record<string, string | number> = {
      'intent': intent,
      'available_minutes': availableMinutes,
    };
    return this.request(http.RequestMethod.POST, '/plan', JSON.stringify(payload));
  }

  postOpenSession(): Promise<AgentEnvelope> {
    return this.request(http.RequestMethod.POST, '/open-session', '{}');
  }

  postAskInContext(question: string, target: LearnTarget): Promise<AgentEnvelope> {
    const payload: Record<string, string | number> = {
      'question': question,
      'lecture_id': target.lecture_id,
      'book_id': target.book_id,
      'chapter_index': target.chapter_index,
    };
    return this.request(http.RequestMethod.POST, '/ask-in-context', JSON.stringify(payload));
  }

  postReviewPlan(target: LearnTarget, limit: number): Promise<AgentEnvelope> {
    const payload: Record<string, string | number> = {
      'limit': limit,
      'lecture_id': target.lecture_id,
      'book_id': target.book_id,
      'chapter_index': target.chapter_index,
    };
    return this.request(http.RequestMethod.POST, '/review-plan', JSON.stringify(payload));
  }

  getTask(taskId: string): Promise<AgentEnvelope> {
    return this.request(http.RequestMethod.GET, '/tasks/' + taskId, '');
  }
}
