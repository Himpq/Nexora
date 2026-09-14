/**
 * 端侧 A2A：把 Nexora 注册为系统可发现的智能体（重构方案 §二·第二步 · AgentExtensionAbility，API 24）。
 * 事实依据（本地文档 agent-extension-ability / agent-extension-configuration）：
 *   onConnect(want, proxy) / onData(proxy, data) / proxy.sendData(reply) / onAuth(proxy, handshake) / proxy.authorize()
 *   AgentCard 在 resources/base/profile/agent_config.json，module.json5 以 type=agent + metadata ohos.extension.agent 绑定。
 * 协议（与 AgentCard 的 skills 对应）：客户端发 JSON 字串
 *   { "skill": "prepare_chapter" | "explain_confusion" | "quiz_me", "input": "...", "photoText"?: "..." }
 * 返回 JSON 字串 { "skill", "ok", "text", "next"? }。不是 JSON 的输入按 explain_confusion 处理。
 * 系统应用 / 小艺连接本组件的场景仅真机可验证。
 */
import { common, AgentExtensionAbility, Want } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { HeadlessApi } from '../services/HeadlessApi';
import { AgentEnvelope, AskAnswer, TodayData } from '../models/AgentContracts';

const DOMAIN = 0x0000;

interface A2ARequest {
  skill: string;
  input: string;
  photoText: string;
}

interface A2AReply {
  skill: string;
  ok: boolean;
  text: string;
  next: string;
}

export default class NexoraAgentExtAbility extends AgentExtensionAbility {
  private hostProxy: common.AgentHostProxy | null = null;

  onCreate(want: Want): void {
    hilog.info(DOMAIN, 'nxA2A', 'onCreate');
  }

  onConnect(want: Want, proxy: common.AgentHostProxy): void {
    hilog.info(DOMAIN, 'nxA2A', 'onConnect');
    this.hostProxy = proxy;
  }

  onDisconnect(want: Want, proxy: common.AgentHostProxy): void {
    hilog.info(DOMAIN, 'nxA2A', 'onDisconnect');
    this.hostProxy = null;
  }

  onData(proxy: common.AgentHostProxy, data: string): void {
    hilog.info(DOMAIN, 'nxA2A', 'onData %{public}d bytes', data.length);
    const request: A2ARequest = this.parse(data);
    this.handle(request).then((reply: A2AReply) => {
      this.send(proxy, reply);
    }).catch((err: Error) => {
      const reply: A2AReply = { skill: request.skill, ok: false, text: '我这边出了点问题：' + err.message, next: '' };
      this.send(proxy, reply);
    });
  }

  onAuth(proxy: common.AgentHostProxy, handshakeData: string): void {
    // 学习数据只对本机系统智能体开放；这里不做二次鉴权，直接放行（真机联调后可按 handshakeData 收紧）。
    hilog.info(DOMAIN, 'nxA2A', 'onAuth');
    try {
      proxy.authorize('ok');
    } catch (err) {
      const e = err as BusinessError;
      hilog.error(DOMAIN, 'nxA2A', 'authorize failed %{public}d %{public}s', e.code, e.message);
    }
  }

  onDestroy(): void {
    hilog.info(DOMAIN, 'nxA2A', 'onDestroy');
  }

  private parse(data: string): A2ARequest {
    const fallback: A2ARequest = { skill: 'explain_confusion', input: data.trim(), photoText: '' };
    try {
      const raw: Record<string, Object> = JSON.parse(data) as Record<string, Object>;
      const skill: Object | undefined = raw['skill'];
      const input: Object | undefined = raw['input'];
      const photo: Object | undefined = raw['photoText'];
      return {
        skill: skill !== undefined ? String(skill) : fallback.skill,
        input: input !== undefined ? String(input) : '',
        photoText: photo !== undefined ? String(photo) : '',
      };
    } catch (err) {
      return fallback;
    }
  }

  private async handle(request: A2ARequest): Promise<A2AReply> {
    const api: HeadlessApi = new HeadlessApi(this.context);
    if (!api.hasIdentity()) {
      return { skill: request.skill, ok: false, text: '先打开一次 Nexora 让我认识你，我才能替你干活。', next: 'open_app' };
    }
    if (request.skill === 'prepare_chapter') {
      const env: AgentEnvelope = await api.getToday();
      const data: TodayData = env.data as TodayData;
      if (data.focus === null || data.focus === undefined) {
        return { skill: request.skill, ok: true, text: '我还没看到你的课程。', next: 'select_course' };
      }
      return {
        skill: request.skill,
        ok: true,
        text: '下一步是' + data.focus.chapter_name + '，夜里我会把它读完、划重点、出题。',
        next: 'open_session',
      };
    }
    if (request.skill === 'quiz_me') {
      await api.reviewPlan(5);
      return { skill: request.skill, ok: true, text: '我排了 5 道题，打开 Nexora 就能做。', next: 'open_quiz' };
    }
    const question: string = request.input.length > 0 ? request.input : '讲一下这一节的重点';
    const env: AgentEnvelope = await api.ask(question, request.photoText.length > 0 ? 'photo' : 'a2a', request.photoText);
    const answer: AskAnswer = env.data as AskAnswer;
    return { skill: 'explain_confusion', ok: true, text: answer.answer, next: '' };
  }

  private send(proxy: common.AgentHostProxy, reply: A2AReply): void {
    try {
      proxy.sendData(JSON.stringify(reply));
    } catch (err) {
      const e = err as BusinessError;
      hilog.error(DOMAIN, 'nxA2A', 'sendData failed %{public}d %{public}s', e.code, e.message);
    }
  }
}
