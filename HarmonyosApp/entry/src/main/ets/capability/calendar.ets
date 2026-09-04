/**
 * §9.3 Calendar Kit（#14 + 重构方案 ContextBundle.calendar）。
 * 事实依据（SDK 类型声明 @ohos.calendarManager.d.ts，6.1.1(24)）：
 * - calendarManager.getCalendarManager(context) → CalendarManager
 * - CalendarManager.getCalendar(): Promise<Calendar>（默认日历，需 READ_CALENDAR）
 * - Calendar.addEvent(event): Promise<number>（需 WRITE_CALENDAR）
 * - Calendar.getEvents(filter?: EventFilter, eventKey?: (keyof Event)[]): Promise<Event[]>
 * - calendarManager.EventFilter.filterByTime(start, end)
 * - Event：{type: EventType.NORMAL=0, title, startTime(13位ms), endTime(13位ms), reminderTime: number[]}
 * 学习计划本就是日程：写入日历并开启提醒；杀进程后系统日历仍会提醒（§4.6 端侧定时唤醒）。
 * 未来 24h 的事件（含「考」「测」等关键词）上报给决策器，成为模型裁决的上下文。
 */
import { calendarManager } from '@kit.CalendarKit';
import { common } from '@kit.AbilityKit';

export interface UpcomingEvent {
  title: string;
  start: number;
}

export class CalendarService {
  async scheduleStudy(context: common.Context, chapterName: string, minutes: number, startDelayMs: number = 60 * 60 * 1000): Promise<number> {
    const manager = calendarManager.getCalendarManager(context);
    const calendar = await manager.getCalendar();
    const startTime = Date.now() + startDelayMs;
    const endTime = startTime + minutes * 60 * 1000;
    const event: calendarManager.Event = {
      type: calendarManager.EventType.NORMAL,
      title: '学习：' + chapterName,
      startTime: startTime,
      endTime: endTime,
      reminderTime: [5],
    };
    return await calendar.addEvent(event);
  }

  /** 未来 hours 小时内的日程（标题 + 开始时间，ms）。权限未授予或平台不支持时返回空数组。 */
  async upcoming(context: common.Context, hours: number = 24): Promise<UpcomingEvent[]> {
    try {
      const manager = calendarManager.getCalendarManager(context);
      const calendar = await manager.getCalendar();
      const now: number = Date.now();
      const filter: calendarManager.EventFilter = calendarManager.EventFilter.filterByTime(now, now + hours * 3600 * 1000);
      const events: calendarManager.Event[] = await calendar.getEvents(filter);
      const rows: UpcomingEvent[] = [];
      for (const event of events) {
        const title: string = event.title !== undefined ? event.title : '';
        if (title.length === 0) {
          continue;
        }
        rows.push({ title: title, start: event.startTime });
        if (rows.length >= 12) {
          break;
        }
      }
      return rows;
    } catch (err) {
      return [];
    }
  }
}

export const sharedCalendar: CalendarService = new CalendarService();
