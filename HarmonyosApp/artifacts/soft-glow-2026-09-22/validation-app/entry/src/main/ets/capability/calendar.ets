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
 *
 * 2026-09-21 审查 F06 / F15：
 * - 读写前先按场景申请权限；无权限时 upcoming() 返回 status='unavailable'，决策器不能把它当作「没有安排」。
 * - 官方 FAQ faq-calendar-3：提醒只在起止时间秒、毫秒都为 0 时触发，写日程前把时间对齐到整分。
 */
import { calendarManager } from '@kit.CalendarKit';
import { common } from '@kit.AbilityKit';
import { sharedPermission, PermissionOutcome, PERMISSION_READ_CALENDAR, PERMISSION_WRITE_CALENDAR } from './permission';

export interface UpcomingEvent {
  title: string;
  start: number;
}

/** 日历读取结果：status 区分「读到了（可能为空）」与「读不到（无权限 / 不支持 / 出错）」。 */
export interface CalendarSnapshot {
  /** ok | unavailable */
  status: string;
  /** unavailable 时的原因：denied | blocked | unsupported | error | '' */
  reason: string;
  events: UpcomingEvent[];
}

/** 对齐到整分：官方 FAQ 明确秒与毫秒不为 0 时提醒可能不触发。 */
export function nxAlignToMinute(ms: number): number {
  return Math.ceil(ms / 60000) * 60000;
}

export class CalendarService {
  /** 上次读取的授权状态；上报设备上下文时一并带上，避免再次弹窗。 */
  private lastOutcome: PermissionOutcome | '' = '';

  async scheduleStudy(context: common.Context, chapterName: string, minutes: number, startDelayMs: number = 60 * 60 * 1000): Promise<number> {
    const outcome = await sharedPermission.ensure(context, [PERMISSION_READ_CALENDAR, PERMISSION_WRITE_CALENDAR]);
    this.lastOutcome = outcome;
    if (outcome !== 'granted') {
      throw new Error(outcome === 'blocked' ? '日历权限之前被拒绝了，去系统设置里打开后我才能写日程。' :
        (outcome === 'unsupported' ? '这台设备不支持写入日历。' : '没有日历权限，这次没写进日程。'));
    }
    const manager = calendarManager.getCalendarManager(context);
    const calendar = await manager.getCalendar();
    const startTime = nxAlignToMinute(Date.now() + startDelayMs);
    const endTime = startTime + Math.max(1, Math.round(minutes)) * 60 * 1000;
    const event: calendarManager.Event = {
      type: calendarManager.EventType.NORMAL,
      title: '学习：' + chapterName,
      startTime: startTime,
      endTime: endTime,
      reminderTime: [5],
    };
    return await calendar.addEvent(event);
  }

  /**
   * 未来 hours 小时内的日程。只查权限不弹窗（interactive=false）：设备上下文上报是后台动作，
   * 不应在用户没做任何日历相关操作时突然弹授权框；首次弹窗留给「安排日程」这类明确场景。
   */
  async snapshot(context: common.Context, hours: number = 24, interactive: boolean = false): Promise<CalendarSnapshot> {
    let outcome: PermissionOutcome;
    if (interactive) {
      outcome = await sharedPermission.ensure(context, [PERMISSION_READ_CALENDAR]);
    } else {
      outcome = (await sharedPermission.isGranted(PERMISSION_READ_CALENDAR)) ? 'granted' : 'blocked';
    }
    this.lastOutcome = outcome;
    if (outcome !== 'granted') {
      return { status: 'unavailable', reason: outcome, events: [] };
    }
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
      return { status: 'ok', reason: '', events: rows };
    } catch (err) {
      return { status: 'unavailable', reason: 'error', events: [] };
    }
  }

  /** 兼容旧调用：只要事件数组；读不到时返回空。新代码请用 snapshot()。 */
  async upcoming(context: common.Context, hours: number = 24): Promise<UpcomingEvent[]> {
    const snap = await this.snapshot(context, hours, false);
    return snap.events;
  }
}

export const sharedCalendar: CalendarService = new CalendarService();
