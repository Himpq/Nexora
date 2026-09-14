/**
 * 意图 ②「讲一下 X」（重构方案 §二·第二步 · 小艺对话 / 拍照上下文）。
 * 用户对小艺说「让 Nexora 讲一下卷积」→ 后台执行 → 走 /ask-in-context（source=xiaoyi），
 * 小艺直接念答案；问题同时留痕为对话上下文，影响它今晚的备课判断。
 * 可选参数 photoText：小艺把拍照识别的文字传进来时，作为「学生拍下的教材内容」一起送入。
 */
import { insightIntent, InsightIntentEntry, InsightIntentEntryExecutor } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { HeadlessApi } from '../services/HeadlessApi';
import { AgentEnvelope, AskAnswer } from '../models/AgentContracts';

const DOMAIN = 0x0000;

@InsightIntentEntry({
  intentName: 'NexoraExplain',
  domain: 'EducationDomain',
  intentVersion: '1.0.0',
  displayName: '讲一下',
  displayDescription: '让 Nexora 依据你的教材讲解一个概念或一道题',
  icon: $r('app.media.nx_agent_avatar'),
  llmDescription: '用户要求 Nexora 学习智能体讲解、解释某个概念、知识点或题目时调用。参数 concept 为要讲解的概念或问题原文；如果用户拍了照片，把识别出的文字放入 photoText。',
  keywords: ['讲一下', '解释', '什么是', 'Nexora', '这道题'],
  abilityName: 'EntryAbility',
  executeMode: [insightIntent.ExecuteMode.UI_ABILITY_BACKGROUND],
  parameters: {
    '$schema': '',
    'type': 'object',
    'title': 'Nexora explain',
    'description': 'Explain a concept using the student textbook',
    'properties': {
      'concept': {
        'type': 'string',
        'description': '要讲解的概念、知识点或问题原文，例如「卷积」「傅里叶变换的物理意义」',
        'minLength': 1
      },
      'photoText': {
        'type': 'string',
        'description': '可选。用户拍照后识别出的教材或题目文字'
      }
    },
    'required': ['concept'],
    'additionalProperties': false
  }
})
export default class ExplainIntent extends InsightIntentEntryExecutor<string> {
  concept: string = '';
  photoText: string = '';

  async onExecute(): Promise<insightIntent.IntentResult<string>> {
    hilog.info(DOMAIN, 'nxIntent', 'Explain concept=%{public}s', this.concept);
    const api: HeadlessApi = new HeadlessApi(null);
    let text: string = '';
    const question: string = this.concept.trim().length > 0 ? '讲一下' + this.concept.trim() : '讲一下这一节的重点';
    try {
      const env: AgentEnvelope = await api.ask(question, this.photoText.length > 0 ? 'photo' : 'xiaoyi', this.photoText);
      const data: AskAnswer = env.data as AskAnswer;
      text = data.answer.length > 600 ? data.answer.slice(0, 600) + '……细的我记在 Nexora 里了。' : data.answer;
    } catch (err) {
      text = '这个我现在讲不了，稍后在 Nexora 里问我。';
    }
    const result: insightIntent.IntentResult<string> = { code: 0, result: text };
    return result;
  }
}
