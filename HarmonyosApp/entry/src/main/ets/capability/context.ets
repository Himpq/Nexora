/**
 * 设备上下文上报（重构方案 ContextBundle 的 calendar / device / location 来源）。
 * 手机在前台时把「未来 24h 日历 + 免打扰 + 情景 + 设备类型」上报一次到 /context/device；
 * 此后夜间备课、邮件、困惑等任何触发源求值时，决策器都能看到它。
 * 位置只做用户自设的粗粒度围栏（home / school），本轮留接口：未设置即 'unknown'。
 */
import { common } from '@kit.AbilityKit';
import { deviceInfo } from '@kit.BasicServicesKit';
import { AgentApi } from '../services/AgentApi';
import { sharedCalendar, UpcomingEvent } from './calendar';
import { sharedDnd } from './dnd';

export class DeviceContextService {
  private lastReportedAt: number = 0;

  /** 15 分钟内不重复上报。 */
  async report(context: common.Context, api: AgentApi, force: boolean = false): Promise<void> {
    const now: number = Date.now();
    if (!force && now - this.lastReportedAt < 15 * 60 * 1000) {
      return;
    }
    const calendar: UpcomingEvent[] = await sharedCalendar.upcoming(context, 24);
    const dnd: boolean = await sharedDnd.isDoNotDisturb();
    let device: string = 'phone';
    try {
      device = deviceInfo.deviceType;
    } catch (err) {
      device = 'phone';
    }
    const location: string | undefined = AppStorage.get<string>('nxLocationLabel');
    try {
      await api.postDeviceContext(calendar, dnd, dnd ? 'dnd' : 'normal', location !== undefined ? location : '', device);
      this.lastReportedAt = now;
    } catch (err) {
      // 上报失败不影响主线；下次前台再试
    }
  }
}

export const sharedDeviceContext: DeviceContextService = new DeviceContextService();
