import { common, wantAgent, WantAgent } from '@kit.AbilityKit';
import { notificationManager } from '@kit.NotificationKit';
import { TimelineEntry } from './LearningAgentModels';
import { LearningSystemEntry, LearningSystemIdentity } from './LearningSystemEntry';

// 只递送决策器明确选择的 notify；card/hold 不升级成更打扰的通知。
export class LearningAgentNotification {
    private static publishing: Set<string> = new Set<string>();

    static async permissionStatus(): Promise<string> {
        try {
            return await notificationManager.isNotificationEnabled() ? '学习提醒已开启' : '开启学习提醒';
        } catch (error) { return '当前设备暂不支持学习通知'; }
    }

    static async requestPermission(context: common.UIAbilityContext): Promise<string> {
        try {
            if (!await notificationManager.isNotificationEnabled()) {
                await notificationManager.requestEnableNotification(context);
            }
            return await notificationManager.isNotificationEnabled()
                ? '学习提醒已开启' : '未开启通知，可在系统通知设置中允许 Nexora';
        } catch (error) { return '未能开启通知，请检查系统通知设置'; }
    }

    static notificationId(decisionId: string): number {
        let hash: number = 0;
        for (let i: number = 0; i < decisionId.length; i++) {
            hash = (hash * 31 + decisionId.charCodeAt(i)) | 0;
        }
        return (hash >>> 0) % 1000000000 + 2000;
    }

    static async publishLatest(context: common.Context, identity: LearningSystemIdentity,
        entries: TimelineEntry[]): Promise<void> {
        const now: number = Date.now();
        const pending: TimelineEntry[] = entries.filter((entry: TimelineEntry): boolean =>
            entry.channel === 'notify' && entry.status === 'pending' && entry.id.length > 0 &&
            !entry.suppressed_by && entry.ts <= now + 60000 && entry.ts >= now - 24 * 60 * 60 * 1000 &&
            !(entry.context !== undefined && entry.context !== null && entry.context.dnd === true));
        pending.sort((a: TimelineEntry, b: TimelineEntry): number => b.ts - a.ts);
        // 一次恢复只递送最新一条，避免把离线期间的历史建议集中打扰用户。
        const entry: TimelineEntry | undefined = pending[0];
        if (entry === undefined || LearningSystemEntry.wasNotified(context, identity, entry.id)) { return; }
        const key: string = identity.token + ':' + entry.id;
        if (LearningAgentNotification.publishing.has(key)) { return; }
        LearningAgentNotification.publishing.add(key);
        const id: number = LearningAgentNotification.notificationId(entry.id);
        const label: string = key;
        try {
            if (!await notificationManager.isNotificationEnabled() || !LearningSystemEntry.isCurrent(context, identity)) { return; }
            const action: WantAgent = await wantAgent.getWantAgent({
                wants: [{ bundleName: 'cn.himpqblog.nexoraapp', abilityName: 'EntryAbility',
                    parameters: { nx_route: 'day', decision_id: entry.id, nx_identity: identity.token } }],
                operationType: wantAgent.OperationType.START_ABILITY,
                requestCode: id,
                wantAgentFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG],
            });
            if (!LearningSystemEntry.isCurrent(context, identity)) { return; }
            const request: notificationManager.NotificationRequest = {
                id: id, label: label, appMessageId: key, isAlertOnce: true,
                groupName: 'nexora_learning_' + identity.token,
                notificationSlotType: notificationManager.SlotType.SERVICE_INFORMATION,
                content: { notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
                    normal: { title: 'Nexora 学习提醒', text: entry.text.substring(0, 240), additionalText: '点击查看学习安排' } },
                wantAgent: action, tapDismissed: true, autoDeletedTime: now + 24 * 60 * 60 * 1000,
            };
            await notificationManager.publish(request);
            if (!LearningSystemEntry.isCurrent(context, identity)) {
                await notificationManager.cancel(id, label);
                return;
            }
            LearningSystemEntry.rememberNotified(context, identity, entry.id);
        } catch (error) {
            // 未授权、系统限制或发布失败不落已发送回执，下次真实刷新可重试。
        } finally { LearningAgentNotification.publishing.delete(key); }
    }
}
