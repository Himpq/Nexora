/**
 * 意图 ①「明天学什么 / 今天学什么」（重构方案 §二·第二步 · 小艺对话）。
 * 用户对小艺说「Nexora 明天学什么」→ 小艺后台执行本意图 → 小艺用 result 里的话回答，不跳 App。
 * 事实依据：@InsightIntentEntry + InsightIntentEntryExecutor（API 20+，本地文档
 * js-apis-app-ability-insightintentdecorator）。executeMode 同时声明前后台：后台直接答话，
 * 前台则拉起 EntryAbility 落到「它的一天」。
 * 注意：意图框架不支持模拟器，需真机开启「开发者选项 → 意图框架调试」验证。
 */
import { insightIntent, InsightIntentEntry, InsightIntentEntryExecutor } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { HeadlessApi } from '../services/HeadlessApi';
import { AgentEnvelope, TodayData } from '../models/AgentContracts';

const DOMAIN = 0x0000;

@InsightIntentEntry({
  intentName: 'NexoraWhatsNext',
  domain: 'EducationDomain',
  intentVersion: '1.0.0',
  displayName: '明天学什么',
  displayDescription: '问 Nexora 今天或明天该学哪一章、它昨晚备了什么',
  icon: $r('app.media.nx_agent_avatar'),
  llmDescription: '用户询问 Nexora 学习智能体今天/明天要学什么、下一章是什么、昨晚备课备了什么时调用。无需参数。',
  keywords: ['明天学什么', '今天学什么', '下一章', 'Nexora', '备课'],
  abilityName: 'EntryAbility',
  executeMode: [insightIntent.ExecuteMode.UI_ABILITY_BACKGROUND, insightIntent.ExecuteMode.UI_ABILITY_FOREGROUND],
  parameters: {
    '$schema': '',
    'type': 'object',
    'title': 'Nexora whats next',
    'description': 'No parameters',
    'properties': {},
    'additionalProperties': false
  }
})
export default class WhatsNextIntent extends InsightIntentEntryExecutor<string> {
  async onExecute(): Promise<insightIntent.IntentResult<string>> {
    hilog.info(DOMAIN, 'nxIntent', 'WhatsNext executeMode=%{public}s', JSON.stringify(this.executeMode));
    const api: HeadlessApi = new HeadlessApi(null);
    let text: string = '';
    try {
      const env: AgentEnvelope = await api.getToday();
      const data: TodayData = env.data as TodayData;
      if (data.status === 'needs_course') {
        text = '我还没看到你的课程，打开 Nexora 选好课我就能替你备课了。';
      } else if (data.focus !== null && data.focus !== undefined) {
        text = (data.status === 'resume' ? '接着' : '下一步是') + data.focus.chapter_name + '。';
        if (data.today.study_minutes > 0) {
          text += '今天你已经学了 ' + data.today.study_minutes + ' 分钟。';
        }
      } else {
        text = '今天没有排期的目标，想学什么直接告诉我。';
      }
    } catch (err) {
      text = '我现在连不上自己的笔记，稍后再问我一次。';
    }
    if (this.executeMode === insightIntent.ExecuteMode.UI_ABILITY_FOREGROUND) {
      AppStorage.setOrCreate('nxLaunchRoute', 'day');
      this.windowStage?.loadContent('pages/Index');
    }
    const result: insightIntent.IntentResult<string> = { code: 0, result: text };
    return result;
  }
}
