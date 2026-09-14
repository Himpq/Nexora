/**
 * NexoraLearning Agent Facade 客户端（#2 重构版）。
 * 封装 /api/agent/v1：统一信封解析、演示用户鉴权、超时与错误处理。
 * 类型契约见 models/（§3）。
 * 云端基线：https://chat.himpqblog.cn:5002（HTTPS，公开受信证书）。
 * 本地联调可通过 setBaseUrl / AppStorage('nxBaseUrl') 覆盖。
 */
import { http } from '@kit.NetworkKit';
import {
  AgentEnvelope,
  AgentError,
  AskAnswer,
  ContextData,
  LearnTarget,
  OpenSessionData,
  PlanData,
  ReviewAnswerDraft,
  ReviewPlanData,
  ReviewSubmitData,
  TaskData,
  TodayData,
} from '../models/AgentContracts';
import { TimelineEntry } from '../models/TimelineEntry';
import { DecisionData, DecisionRequest, DecisionRespondData } from '../models/Decision';
import { NxEnv } from '../config/Env';
import { UpcomingEvent } from '../capability/calendar';
import { Identity } from './Identity';

export class AgentApi {
  private baseUrl: string = NxEnv.CLOUD_BASE_URL + '/api/agent/v1';
  private username: string = '';
  private apiKey: string = '';

  constructor() {
    // 环境与身份统一来自 AppStorage（EntryAbility → Identity.resolve 写入），不再各自写死。
    this.setBaseUrl(NxEnv.baseUrl());
    const override: string | undefined = AppStorage.get<string>('nxBaseUrl');
    if (override !== undefined && override.length > 0) {
      this.setBaseUrl(override);
    }
    this.refreshIdentity();
  }

  /** 身份异步解析完成后（华为账号登录）再取一次，避免首个请求用到空用户名。 */
  private refreshIdentity(): void {
    const baseOverride: string | undefined = AppStorage.get<string>('nxBaseUrl');
    const base: string = baseOverride !== undefined && baseOverride.trim().length > 0
      ? baseOverride.trim()
      : NxEnv.baseUrl();
    const expectedBase: string = base.replace(/\/+$/, '') + '/api/agent/v1';
    if (this.baseUrl !== expectedBase) {
      this.baseUrl = expectedBase;
    }
    const usernameOverride: string | undefined = AppStorage.get<string>('nxUsername');
    if (usernameOverride !== undefined && usernameOverride.length > 0) {
      this.username = usernameOverride;
    }
  }

  setAuth(username: string, apiKey: string): void {
    if (username.length > 0) {
      this.username = username;
    }
    this.apiKey = apiKey;
  }

  setBaseUrl(baseUrl: string): void {
    const trimmed = baseUrl.trim();
    if (trimmed.length > 0) {
      this.baseUrl = trimmed.replace(/\/+$/, '') + '/api/agent/v1';
    }
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
    await Identity.waitReady();
    this.refreshIdentity();
    const client = http.createHttp();
    try {
      const resp: http.HttpResponse = await client.request(this.baseUrl + path, this.buildOptions(method, body));
      const rawText: string = resp.result as string;
      if (resp.responseCode < 200 || resp.responseCode >= 300) {
        let detail: string = '';
        try {
          const failedEnvelope = JSON.parse(rawText) as AgentEnvelope;
          if (failedEnvelope.error !== undefined && failedEnvelope.error !== null) {
            detail = failedEnvelope.error.code + ': ' + failedEnvelope.error.message;
          }
        } catch (parseErr) {
          detail = rawText.slice(0, 180);
        }
        throw new Error('HTTP ' + resp.responseCode + ' ' + path + (detail.length > 0 ? ' · ' + detail : ''));
      }
      const text: string = rawText;
      let envelope: AgentEnvelope;
      try {
        envelope = JSON.parse(text) as AgentEnvelope;
      } catch (parseErr) {
        throw new Error('响应不是合法 JSON: ' + path);
      }
      if (envelope.success !== true) {
        const error: AgentError | null | undefined = envelope.error;
        const code: string = error !== undefined && error !== null ? error.code : 'UNKNOWN';
        const message: string = error !== undefined && error !== null ? error.message : '未知错误';
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

  getEvents(limit: number): Promise<AgentEnvelope> {
    return this.request(http.RequestMethod.GET, '/events?limit=' + limit, '');
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

  postAskInContext(question: string, target: LearnTarget, contextText: string = '', source: string = 'app', photoText: string = ''): Promise<AgentEnvelope> {
    const payload: Record<string, string | number> = {
      'question': question,
      'lecture_id': target.lecture_id,
      'book_id': target.book_id,
      'source': source,
    };
    if (photoText.trim().length > 0) {
      // 拍照进入上下文：端侧 OCR（Core Vision Kit）识别后的文本，随问题一起送入教材辅导。
      payload['photo_text'] = photoText.trim().slice(0, 4000);
    }
    if (contextText.trim().length > 0) {
      payload['context_text'] = contextText.trim().slice(0, 12000);
    } else if (!/第\s*[0-9一二三四五六七八九十百零两]+\s*章/.test(question)) {
      payload['chapter_index'] = target.chapter_index;
    }
    return this.request(http.RequestMethod.POST, '/ask-in-context', JSON.stringify(payload));
  }

  /** 设备上下文上报（重构方案 ContextBundle）：日历、免打扰、情景、位置、设备类型。 */
  postDeviceContext(calendar: UpcomingEvent[], doNotDisturb: boolean, scene: string, location: string, device: string): Promise<AgentEnvelope> {
    const rows: Record<string, string | number>[] = [];
    for (const event of calendar) {
      rows.push({ 'title': event.title, 'start': event.start });
    }
    const payload: Record<string, Object> = {
      'calendar': rows,
      'do_not_disturb': doNotDisturb,
      'scene': scene,
      'location': location,
      'device': device,
    };
    return this.request(http.RequestMethod.POST, '/context/device', JSON.stringify(payload));
  }

  /** 它此刻看到了什么（只读快照，不落时间线、不调模型）。 */
  getJudgmentContext(): Promise<AgentEnvelope> {
    return this.request(http.RequestMethod.GET, '/judgment/context', '');
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

  postReviewSubmit(quizId: string, target: LearnTarget, answers: ReviewAnswerDraft[]): Promise<AgentEnvelope> {
    const payload: Record<string, Object> = {
      'quiz_id': quizId,
      'lecture_id': target.lecture_id,
      'book_id': target.book_id,
      'chapter_index': target.chapter_index,
      'chapter_name': target.chapter_name,
      'answers': answers,
    };
    return this.request(http.RequestMethod.POST, '/review/submit', JSON.stringify(payload));
  }

  postDecision(request: DecisionRequest): Promise<AgentEnvelope> {
    return this.request(http.RequestMethod.POST, '/decision', JSON.stringify(request));
  }

  postDecisionRespond(decisionId: string, response: string): Promise<AgentEnvelope> {
    const payload: Record<string, string> = {
      'decision_id': decisionId,
      'response': response,
    };
    return this.request(http.RequestMethod.POST, '/decision/respond', JSON.stringify(payload));
  }

  getCognitionOverview(): Promise<AgentEnvelope> {
    return this.request(http.RequestMethod.GET, '/cognition/overview', '');
  }

  postCognitionVerdict(facetId: string, verdict: string, conceptId: string, lectureId: string, bookId: string,
    note: string = '', claim: string = '', evidence: string[] = []): Promise<AgentEnvelope> {
    const payload: Record<string, Object> = {
      'facet_id': facetId,
      'verdict': verdict,
      'concept_id': conceptId,
      'lecture_id': lectureId,
      'book_id': bookId,
    };
    if (note.trim().length > 0) {
      // 反驳变成对话：带上原判断与依据，后端交给模型回应并改写判断。
      payload['note'] = note.trim().slice(0, 300);
      payload['claim'] = claim;
      payload['evidence'] = evidence;
    }
    return this.request(http.RequestMethod.POST, '/cognition/verdict', JSON.stringify(payload));
  }

  postPrereqCheck(lectureId: string, bookId: string, chapterIndex: number): Promise<AgentEnvelope> {
    const payload: Record<string, string | number> = {
      'lecture_id': lectureId,
      'book_id': bookId,
      'chapter_index': chapterIndex,
    };
    return this.request(http.RequestMethod.POST, '/prereq/check', JSON.stringify(payload));
  }

  postConfusionScan(): Promise<AgentEnvelope> {
    return this.request(http.RequestMethod.POST, '/confusion/scan', '{}');
  }

  postFlowAccept(target: LearnTarget): Promise<AgentEnvelope> {
    return this.request(http.RequestMethod.POST, '/flow/accept', JSON.stringify({ 'target': target }));
  }

  postFlowEvent(flowId: string, event: string): Promise<AgentEnvelope> {
    const payload: Record<string, string> = {
      'flow_id': flowId,
      'event': event,
    };
    return this.request(http.RequestMethod.POST, '/flow/event', JSON.stringify(payload));
  }

  postFlowSubmit(flowId: string, answers: object[]): Promise<AgentEnvelope> {
    const payload: Record<string, Object> = {
      'flow_id': flowId,
      'answers': answers,
    };
    return this.request(http.RequestMethod.POST, '/flow/submit', JSON.stringify(payload));
  }

  postFlowUncertain(flowId: string, questionId: string, verdict: string): Promise<AgentEnvelope> {
    const payload: Record<string, string> = {
      'flow_id': flowId,
      'question_id': questionId,
      'verdict': verdict,
    };
    return this.request(http.RequestMethod.POST, '/flow/uncertain', JSON.stringify(payload));
  }

  getFlowState(flowId: string): Promise<AgentEnvelope> {
    return this.request(http.RequestMethod.GET, '/flow/state?flow_id=' + flowId, '');
  }
}

export { AgentEnvelope, AskAnswer, ContextData, DecisionData, DecisionRespondData, LearnTarget, OpenSessionData, PlanData, ReviewPlanData, ReviewSubmitData, TaskData, TimelineEntry, TodayData };
