import { insightIntent, InsightIntentEntry, InsightIntentEntryExecutor } from '@kit.AbilityKit';
import { LearningSystemEntry } from '../common/LearningSystemEntry';

@InsightIntentEntry({
    intentName: 'NexoraWhatsNext',
    domain: 'EducationDomain',
    intentVersion: '1.0.0',
    displayName: '今天学什么',
    displayDescription: '查看 Nexora 的学习安排',
    icon: $r('app.media.startIcon'),
    llmDescription: '用户询问 Nexora 今天学什么、下一章是什么或学习安排时调用。',
    keywords: ['今天学什么', '明天学什么', '下一章', 'Nexora'],
    abilityName: 'EntryAbility',
    executeMode: [insightIntent.ExecuteMode.UI_ABILITY_FOREGROUND],
    parameters: {
        '$schema': '', 'type': 'object', 'title': 'Nexora whats next',
        'description': 'No parameters', 'properties': {}, 'additionalProperties': false,
    },
})
export default class WhatsNextIntent extends InsightIntentEntryExecutor<string> {
    async onExecute(): Promise<insightIntent.IntentResult<string>> {
        // EntryAbility 已加载 Index；只排队路由，登录校验成功后由 MainChat 消费。
        LearningSystemEntry.requestLaunch('day');
        return { code: 0, result: AppStorage.get<boolean>('nxSessionReady') === true
            ? '正在打开今天的学习安排。' : '请先登录 Nexora，随后会打开学习安排。' };
    }
}
