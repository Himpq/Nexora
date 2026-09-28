/**
 * 运行时权限（2026-09-21 审查 F06）：麦克风、日历此前只在 module.json5 里声明，
 * 从未向用户申请，首次点语音直接报「没有麦克风权限」，日历读不到被当成「用户没有安排」。
 * 事实依据（devecocli docs `faqs-access-control-15`）：
 * - abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context, permissions)
 *   → PermissionRequestResult.authResults[i] === 0 为已授予；用户拒绝后再次调用不会再弹窗，
 *   需引导到设置（requestPermissionOnSetting）。
 * - checkAccessToken(tokenID, permission) 查询当前授权状态，tokenID 来自 bundleManager.getBundleInfoForSelf。
 * 结果分四态：granted / denied（本次拒绝）/ blocked（曾拒绝，不再弹窗）/ unsupported（设备或系统不支持）。
 */
import { abilityAccessCtrl, bundleManager, common, Permissions, PermissionRequestResult } from '@kit.AbilityKit';

export type PermissionOutcome = 'granted' | 'denied' | 'blocked' | 'unsupported';

export const PERMISSION_MICROPHONE: Permissions = 'ohos.permission.MICROPHONE';
export const PERMISSION_READ_CALENDAR: Permissions = 'ohos.permission.READ_CALENDAR';
export const PERMISSION_WRITE_CALENDAR: Permissions = 'ohos.permission.WRITE_CALENDAR';

export class PermissionService {
  private tokenId: number = -1;

  private async selfTokenId(): Promise<number> {
    if (this.tokenId >= 0) {
      return this.tokenId;
    }
    const info = await bundleManager.getBundleInfoForSelf(bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION);
    this.tokenId = info.appInfo.accessTokenId;
    return this.tokenId;
  }

  /** 只查不弹窗。 */
  async isGranted(permission: Permissions): Promise<boolean> {
    try {
      const tokenId = await this.selfTokenId();
      const status = await abilityAccessCtrl.createAtManager().checkAccessToken(tokenId, permission);
      return status === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
    } catch (err) {
      return false;
    }
  }

  /**
   * 在使用场景里申请：已授予直接返回；否则弹系统授权框。
   * 用户此前拒绝过时系统不再弹窗（authResults 仍是拒绝），这时返回 blocked，调用方应引导去设置。
   */
  async ensure(context: common.Context, permissions: Permissions[]): Promise<PermissionOutcome> {
    let allGranted = true;
    for (const permission of permissions) {
      if (!(await this.isGranted(permission))) {
        allGranted = false;
        break;
      }
    }
    if (allGranted) {
      return 'granted';
    }
    let result: PermissionRequestResult;
    try {
      result = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context, permissions);
    } catch (err) {
      // 12100001 参数错误（权限名未声明）；其余多为设备 / 系统不支持该权限走弹窗授权。
      return 'unsupported';
    }
    const results: number[] = result.authResults !== undefined ? result.authResults : [];
    let granted = true;
    let invalid = false;
    let dialogShown = false;
    for (let i = 0; i < results.length; i++) {
      if (results[i] !== 0) {
        granted = false;
      }
      if (results[i] === 2) {
        invalid = true;
      }
      const shown: boolean[] | undefined = result.dialogShownResults;
      if (shown !== undefined && shown[i] === true) {
        dialogShown = true;
      }
    }
    if (granted) {
      return 'granted';
    }
    if (invalid) {
      return 'unsupported';
    }
    return dialogShown ? 'denied' : 'blocked';
  }

  /** 曾拒绝后的恢复入口：系统的权限二次设置弹窗。失败时调用方提示手动去「设置 → 应用」。 */
  async openSetting(context: common.Context, permission: Permissions): Promise<boolean> {
    try {
      const results: abilityAccessCtrl.GrantStatus[] =
        await abilityAccessCtrl.createAtManager().requestPermissionOnSetting(context, [permission]);
      return results.length > 0 && results[0] === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
    } catch (err) {
      return false;
    }
  }
}

export const sharedPermission: PermissionService = new PermissionService();
