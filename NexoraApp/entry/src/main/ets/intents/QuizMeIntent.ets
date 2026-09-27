import { insightIntent, InsightIntentEntry, InsightIntentEntryExecutor } from '@kit.AbilityKit';
import { LearningSystemEntry } from '../common/LearningSystemEntry';

@InsightIntentEntry({
    intentName: 'NexoraQuizMe',
    domain: 'EducationDomain',
    intentVersion: '1.0.0',
    displayName: '考考我',
    displayDescription: '打开 Nexora 的今日复习',
    icon: $r('app.media.startIcon'),
    llmDescription: '用户要求 Nexora 出题、考考我或复习时调用。登录后进入今日复习。',
    keywords: ['考考我', '出题', '测验', '复习', 'Nexora'],
    abilityName: 'EntryAbility',
    executeMode: [insightIntent.ExecuteMode.UI_ABILITY_FOREGROUND],
    parameters: {
        '$schema': '', 'type': 'object', 'title': 'Nexora quiz me',
        'description': 'No parameters', 'properties': {}, 'additionalProperties': false,
    },
})
export default class QuizMeIntent extends InsightIntentEntryExecutor<string> {
    async onExecute(): Promise<insightIntent.IntentResult<string>> {
        // 生成与答题都走 agent 的复习流程，冷启动时不在登录校验之前发送请求。
        LearningSystemEntry.requestLaunch('review');
        return { code: 0, result: AppStorage.get<boolean>('nxSessionReady') === true
            ? '正在打开今日复习。' : '请先登录 Nexora，随后会打开今日复习。' };
    }
}
