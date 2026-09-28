import { abilityAccessCtrl, common, Permissions } from '@kit.AbilityKit';
import { calendarManager } from '@kit.CalendarKit';
import { LearningFormClient } from './LearningFormClient';
import { LearningSystemEntry, LearningSystemIdentity } from './LearningSystemEntry';

interface LearningCalendarEvent { title: string; start: number; }
interface LearningDevicePayload {
    now: number;
    sampled_at_ms: number;
    device: string;
    foreground: boolean;
    scene: string;
    scene_status: string;
    dnd_status: string;
    location: string;
    calendar: LearningCalendarEvent[];
    calendar_status: string;
    calendar_reason: string;
}

export class LearningDeviceContext {
    private static lastKey: string = '';
    private static lastReported: number = 0;
    private static revision: number = 0;

    static async requestCalendarPermission(context: common.UIAbilityContext): Promise<string> {
        try {
            const result = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context,
                ['ohos.permission.READ_CALENDAR'] as Permissions[]);
            if (result.authResults.length === 0 || result.authResults[0] !== 0) { return '未授权日历，学习功能仍可正常使用'; }
            LearningDeviceContext.lastReported = 0;
            await LearningDeviceContext.report(context, true);
            return '已允许读取 Nexora 创建的日程；其他日历仍不可访问';
        } catch (error) { return '当前设备暂不能读取日历'; }
    }

    static async collect(context: common.Context, foreground: boolean): Promise<LearningDevicePayload> {
        const payload: LearningDevicePayload = { now: Math.floor(Date.now() / 1000), sampled_at_ms: Date.now(), device: 'phone',
            foreground: foreground, scene: foreground ? 'app_foreground' : 'app_background',
            scene_status: 'app_lifecycle', dnd_status: 'unavailable', location: 'unknown',
            calendar: [], calendar_status: 'unavailable', calendar_reason: 'unsupported' };
        // 公开 SDK 不提供三方读取系统免打扰的接口，不能用通知开关代替 DND。
        if (!canIUse('SystemCapability.Applications.CalendarData')) { return payload; }
        try {
            const granted = abilityAccessCtrl.createAtManager().checkAccessTokenSync(
                context.applicationInfo.accessTokenId, 'ohos.permission.READ_CALENDAR');
            if (granted !== abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED) {
                payload.calendar_reason = 'permission_denied';
                return payload;
            }
            const calendars: calendarManager.Calendar[] = await calendarManager.getCalendarManager(context).getAllCalendars();
            const start: number = Date.now();
            const filter: calendarManager.EventFilter = calendarManager.EventFilter.filterByTime(start, start + 86400000);
            for (const calendar of calendars) {
                const events: calendarManager.Event[] = await calendar.getEvents(filter, ['title', 'startTime']);
                for (const event of events) {
                    if ((event.title || '').trim().length > 0 && event.startTime >= start) {
                        payload.calendar.push({ title: (event.title || '').trim().substring(0, 60),
                            start: Math.floor(event.startTime / 1000) });
                    }
                }
            }
            payload.calendar.sort((a: LearningCalendarEvent, b: LearningCalendarEvent): number => a.start - b.start);
            payload.calendar = payload.calendar.slice(0, 12);
            // READ_CALENDAR 只允许读本应用创建的日程；不能推断用户其它日历没有安排。
            payload.calendar_status = 'partial';
            payload.calendar_reason = 'app_calendar_only';
        } catch (error) { payload.calendar_reason = 'read_failed'; }
        return payload;
    }

    static async report(context: common.Context, foreground: boolean): Promise<void> {
        const identity: LearningSystemIdentity | null = LearningSystemEntry.readIdentity(context);
        if (identity === null) { return; }
        const key: string = identity.token + ':' + foreground;
        if (key === LearningDeviceContext.lastKey && Date.now() - LearningDeviceContext.lastReported < 60000) { return; }
        const revision: number = ++LearningDeviceContext.revision;
        const payload: LearningDevicePayload = await LearningDeviceContext.collect(context, foreground);
        if (revision !== LearningDeviceContext.revision || !LearningSystemEntry.isCurrent(context, identity)) { return; }
        if (await LearningFormClient.reportDevice(context, identity, payload)) {
            if (revision !== LearningDeviceContext.revision) { return; }
            LearningDeviceContext.lastKey = key;
            LearningDeviceContext.lastReported = Date.now();
        }
    }
}
