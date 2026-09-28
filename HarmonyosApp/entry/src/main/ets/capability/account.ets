/**
 * 华为账号登录（Account Kit）——替换写死的用户名（重构方案「清掉原型痕迹」）。
 * 事实依据（Account Kit 开发指南「获取用户信息/静默登录」）：
 *   new authentication.HuaweiIDProvider().createLoginWithHuaweiIDRequest()
 *   → AuthenticationController(context).executeRequest(request)
 *   → LoginWithHuaweiIDResponse.data { openID, unionID, authorizationCode }
 * 未上架/调试签名/模拟器下会抛错，调用方回退到本机持久化身份；这里只负责尝试。
 */
import { authentication } from '@kit.AccountKit';
import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';

export class AccountService {
  /** 静默登录成功时返回 openID；任何失败返回空串。 */
  async silentOpenId(context: common.Context): Promise<string> {
    try {
      const request: authentication.LoginWithHuaweiIDRequest =
        new authentication.HuaweiIDProvider().createLoginWithHuaweiIDRequest();
      request.forceLogin = false;
      request.state = util.generateRandomUUID();
      const controller: authentication.AuthenticationController = new authentication.AuthenticationController(context);
      const data: authentication.AuthenticationResponse = await controller.executeRequest(request);
      const response: authentication.LoginWithHuaweiIDResponse = data as authentication.LoginWithHuaweiIDResponse;
      if (response.data !== undefined && response.data.openID !== undefined) {
        return response.data.openID;
      }
      return '';
    } catch (err) {
      return '';
    }
  }
}

export const sharedAccount: AccountService = new AccountService();
