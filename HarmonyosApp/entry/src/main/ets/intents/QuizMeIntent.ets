/**
 * 意图 ③「考考我」（重构方案 §二·第二步 · 小艺对话 → 拉起答题）。
 * 用户对小艺说「Nexora 考考我」→ 前台拉起 EntryAbility，直接落到「今日复习」；
 * 后台模式下则先用 /review-plan 排一组复习题，把 task_id 存下来，回一句「排好了 N 道题」；
 * 用户下次打开 App 时今日复习页据 nxPendingReviewTask 直接续接这次生成任务（2026-09-21 审查 F08）。
 */
import { insightIntent, InsightIntentEntry, InsightIntentEntryExecutor } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { HeadlessApi } from '../services/HeadlessApi';
import { AgentEnvelope, ReviewPlanData } from '../models/AgentContracts';

const DOMAIN = 0x0000;

@InsightIntentEntry({
  intentName: 'NexoraQuizMe',
  domain: 'EducationDomain',
  intentVersion: '1.0.0',
  displayName: '考考我',
  displayDescription: '让 Nexora 按你最近学的章节出几道题',
  icon: $r('app.media.nx_agent_avatar'),
  llmDescription: '用户要求 Nexora 学习智能体出题、测验、复习、考一考时调用。可选参数 count 为题目数量。',
  keywords: ['考考我', '出题', '测验', '复习', 'Nexora'],
  abilityName: 'EntryAbility',
  executeMode: [insightIntent.ExecuteMode.UI_ABILITY_FOREGROUND, insightIntent.ExecuteMode.UI_ABILITY_BACKGROUND],
  parameters: {
    '$schema': '',
    'type': 'object',
    'title': 'Nexora quiz me',
    'description': 'Ask Nexora to quiz the student',
    'properties': {
      'count': {
        'type': 'number',
        'description': '题目数量，默认 5'
      }
    },
    'additionalProperties': false
  }
})
export default class QuizMeIntent extends InsightIntentEntryExecutor<string> {
  count: number = 5;

  async onExecute(): Promise<insightIntent.IntentResult<string>> {
    hilog.info(DOMAIN, 'nxIntent', 'QuizMe count=%{public}d', this.count);
    let text: string = '';
    const api: HeadlessApi = new HeadlessApi(null);
    const limit: number = Math.max(1, Math.min(20, Math.round(this.count)));
    if (this.executeMode === insightIntent.ExecuteMode.UI_ABILITY_FOREGROUND) {
      // 前台：直接落到今日复习页；出题由页面完成，用户能看到进度。
      AppStorage.setOrCreate('nxLaunchRoute', 'review');
      this.windowStage?.loadContent('pages/Index');
      text = '来，打开 Nexora 开始答题。';
    } else {
      try {
        if (!(await api.ready())) {
          text = '先打开一次 Nexora 登录，我才能替你出题。';
        } else {
          const env: AgentEnvelope = await api.reviewPlan(limit);
          const data: ReviewPlanData = env.data as ReviewPlanData;
          // 续接契约：task_id 交给今日复习页轮询，不再让用户回 App 重新找入口。
          AppStorage.setOrCreate('nxPendingReviewTask', data.task.task_id);
          AppStorage.setOrCreate('nxLaunchRoute', 'review');
          text = '我按你最近学的章节排了 ' + limit + ' 道题，打开 Nexora 就能做。';
        }
      } catch (err) {
        text = '题我现在出不了，稍后打开 Nexora 再试。';
      }
    }
    const result: insightIntent.IntentResult<string> = { code: 0, result: text };
    return result;
  }
}
