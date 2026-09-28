/**
 * 无界面进程的轻量客户端（意图执行器 / AgentExtensionAbility 用）。
 * 身份来源（2026-09-21 审查 F07）：
 *   ① 有 Context（AgentExtension）→ 读 Preferences('nx_identity')；
 *   ② 没有 Context（意图执行器：InsightIntentContext 不是 common.Context）→ 意图执行器与 EntryAbility 同进程，
 *      读 EntryAbility 启动时由 Identity.resolve 写入的 AppStorage('nxUsername' / 'nxSessionCookie')，
 *      并在首个请求前 await Identity.waitReady()，避免冷启动时身份还没解析完就带空用户名发出去。
 * 只覆盖第二步系统入口需要的四个端点：/today /ask-in-context /review-plan /events。
 */
import { http } from '@kit.NetworkKit';
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { NxEnv } from '../config/Env';
import { Identity } from './Identity';
import { AgentEnvelope, AgentError } from '../models/AgentContracts';

export class HeadlessApi {
  private root: string = NxEnv.baseUrl();
  private username: string = NxEnv.USE_LOCAL ? NxEnv.LOCAL_USERNAME : '';
  private sessionCookie: string = '';
  private fromAppStorage: boolean = false;

  constructor(context: common.Context | null) {
    if (NxEnv.USE_LOCAL) {
      return;
    }
    if (context !== null) {
      try {
        const options: preferences.Options = { name: 'nx_identity' };
        const store = preferences.getPreferencesSync(context, options);
        const saved: string = store.getSync('username', '') as string;
        this.sessionCookie = store.getSync('session_cookie', '') as string;
        if (saved.length > 0) {
          this.username = saved;
        }
      } catch (err) {
        // 没有持久化身份就带空用户名，后端会以 USER_REQUIRED 拒绝，调用方据此提示先打开一次应用
      }
      return;
    }
    this.fromAppStorage = true;
    this.readAppStorage();
  }

  private readAppStorage(): void {
    const saved: string | undefined = AppStorage.get<string>('nxUsername');
    const cookie: string | undefined = AppStorage.get<string>('nxSessionCookie');
    if (saved !== undefined && saved.length > 0) {
      this.username = saved;
    }
    if (cookie !== undefined && cookie.length > 0) {
      this.sessionCookie = cookie;
    }
  }

  hasIdentity(): boolean {
    return this.username.length > 0;
  }

  /** 无 Context 时等身份解析完再读一次；有 Context 时立即返回。 */
  async ready(): Promise<boolean> {
    if (this.fromAppStorage && !NxEnv.USE_LOCAL) {
      try {
        await Identity.waitReady();
      } catch (err) {
        // 解析失败按未登录处理
      }
      this.readAppStorage();
    }
    return this.hasIdentity();
  }

  private async request(method: http.RequestMethod, path: string, body: string): Promise<AgentEnvelope> {
    await this.ready();
    if (!this.hasIdentity()) {
      throw new Error('USER_REQUIRED: 还没登录 Nexora，打开应用登录后再试。');
    }
    const client = http.createHttp();
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Nexora-Username': this.username,
      };
      if (this.sessionCookie.length > 0) {
        headers['Cookie'] = this.sessionCookie;
      }
      const options: http.HttpRequestOptions = {
        method: method,
        header: headers,
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 10000,
        readTimeout: 40000,
      };
      if (body.length > 0) {
        options.extraData = body;
      }
      const resp: http.HttpResponse = await client.request(this.root + '/api/agent/v1' + path, options);
      if (resp.responseCode < 200 || resp.responseCode >= 300) {
        throw new Error('HTTP ' + resp.responseCode + ' ' + path);
      }
      const envelope: AgentEnvelope = JSON.parse(resp.result as string) as AgentEnvelope;
      if (envelope.success !== true) {
        const error: AgentError | null = envelope.error;
        throw new Error(error !== null ? error.code + ': ' + error.message : 'UNKNOWN');
      }
      return envelope;
    } finally {
      client.destroy();
    }
  }

  getToday(): Promise<AgentEnvelope> {
    return this.request(http.RequestMethod.GET, '/today', '');
  }

  getEvents(limit: number): Promise<AgentEnvelope> {
    return this.request(http.RequestMethod.GET, '/events?limit=' + limit, '');
  }

  /** 讲一下 X：不带课程参数时后端用默认教材上下文；source 记为 xiaoyi / a2a，进入下一次裁决的对话上下文。 */
  ask(question: string, source: string, photoText: string = ''): Promise<AgentEnvelope> {
    const payload: Record<string, string> = {
      'question': question,
      'source': source,
    };
    if (photoText.length > 0) {
      payload['photo_text'] = photoText.slice(0, 4000);
    }
    return this.request(http.RequestMethod.POST, '/ask-in-context', JSON.stringify(payload));
  }

  reviewPlan(limit: number): Promise<AgentEnvelope> {
    const payload: Record<string, number> = { 'limit': limit };
    return this.request(http.RequestMethod.POST, '/review-plan', JSON.stringify(payload));
  }

  postDecisionRespond(decisionId: string, response: string): Promise<AgentEnvelope> {
    const payload: Record<string, string> = { 'decision_id': decisionId, 'response': response };
    return this.request(http.RequestMethod.POST, '/decision/respond', JSON.stringify(payload));
  }
}
