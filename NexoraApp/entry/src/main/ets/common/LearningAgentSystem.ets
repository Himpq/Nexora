import { common } from '@kit.AbilityKit';
import { TodayData, TimelineEntry } from './LearningAgentModels';
import { LearningSystemEntry, LearningSystemIdentity } from './LearningSystemEntry';
import { LearningFormClient, LearningSystemSnapshot } from './LearningFormClient';
import { LearningAgentNotification } from './LearningAgentNotification';
import { LearningDeviceContext } from './LearningDeviceContext';

export class LearningAgentSystem {
    private static refreshing: Map<string, Promise<void>> = new Map<string, Promise<void>>();

    static async syncToday(context: common.Context, today: TodayData, entries: TimelineEntry[]): Promise<void> {
        LearningSystemEntry.prepare(context);
        const identity: LearningSystemIdentity | null = LearningSystemEntry.readIdentity(context);
        if (identity === null) { return; }
        await LearningSystemEntry.updateToday(context, today, entries);
        if (!LearningSystemEntry.isCurrent(context, identity)) { return; }
        await LearningAgentNotification.publishLatest(context, identity, entries);
        await LearningDeviceContext.report(context, AppStorage.get<boolean>('appForeground') === true);
    }

    static async refresh(context: common.Context, foreground: boolean = true): Promise<void> {
        const identity: LearningSystemIdentity | null = LearningSystemEntry.readIdentity(context);
        if (identity === null) { return; }
        const existing: Promise<void> | undefined = LearningAgentSystem.refreshing.get(identity.token);
        if (existing !== undefined) { return existing; }
        const flight: Promise<void> = LearningAgentSystem.refreshOnce(context, foreground);
        LearningAgentSystem.refreshing.set(identity.token, flight);
        try { await flight; } finally { LearningAgentSystem.refreshing.delete(identity.token); }
    }

    private static async refreshOnce(context: common.Context, foreground: boolean): Promise<void> {
        try {
            await LearningSystemEntry.refreshForms(context); // 跨日时先清除旧的可操作缓存。
            const snapshot: LearningSystemSnapshot | null = await LearningFormClient.refresh(context);
            if (snapshot === null) { return; }
            await LearningAgentNotification.publishLatest(context, snapshot.identity, snapshot.entries);
            // FormExtension 的刷新不能代表 App 正处于后台：可能与前台同时发生。
            if (foreground && AppStorage.get<boolean>('appForeground') === true) {
                await LearningDeviceContext.report(context, true);
            }
        } catch (error) { /* 系统增强不阻断登录、页面和卡片生命周期。 */ }
    }

    static permissionStatus(): Promise<string> { return LearningAgentNotification.permissionStatus(); }

    static async requestPermissions(context: common.UIAbilityContext): Promise<string> {
        const result: string = await LearningAgentNotification.requestPermission(context);
        await LearningAgentSystem.refresh(context);
        return result;
    }

    static requestCalendarPermission(context: common.UIAbilityContext): Promise<string> {
        return LearningDeviceContext.requestCalendarPermission(context);
    }
}
