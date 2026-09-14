/**
 * §4.6 系统免打扰感知（#14）。
 * 事实依据（devecocli docs `js-apis-intelligentscene`，API 23）：
 * - intelligentScene.isDoNotDisturbEnabled(): Promise<boolean>
 * - intelligentScene.isNotifyAllowedInDoNotDisturb(): Promise<boolean>
 * - 权限 GET_DONOTDISTURB_STATE 为 system_grant（安装即授予）。
 * 情景模式（免打扰/睡眠/学习/工作/自定义）任一开启即免打扰；用户开学习模式时 Agent 自动安静。
 */
import { intelligentScene } from '@kit.BasicServicesKit';

export class DndService {
  async isDoNotDisturb(): Promise<boolean> {
    try {
      const enabled = await intelligentScene.isDoNotDisturbEnabled();
      if (!enabled) {
        return false;
      }
      const allowed = await intelligentScene.isNotifyAllowedInDoNotDisturb();
      return !allowed;
    } catch (err) {
      return false;
    }
  }
}

export const sharedDnd: DndService = new DndService();
