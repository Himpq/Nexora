/**
 * 身份层：所有 API 客户端从这里取用户名，不再各自写死。
 * 解析顺序：
 *   1. 本地联调开关（NxEnv.USE_LOCAL → LOCAL_USERNAME）
 *   2. 本机持久化身份（Preferences 'nx_identity'）
 *   3. 华为账号静默登录 → 'hw_' + openID 前 16 位，并持久化
 *   4. 生成本机匿名身份 'dev_' + 随机串，并持久化（保证演示永远有身份）
 * 结果写入 AppStorage('nxUsername') 与 ('nxBaseUrl')，供 AgentApi / ReaderApi / ReportApi / 卡片进程读取。
 */
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { NxEnv } from '../config/Env';
import { sharedAccount } from '../capability/account';

const PREF_NAME: string = 'nx_identity';
const KEY_USERNAME: string = 'username';

export class Identity {
  private static readyPromise: Promise<string> = Promise.resolve('');

  static current(): string {
    const stored: string | undefined = AppStorage.get<string>('nxUsername');
    return stored !== undefined ? stored : '';
  }

  static baseUrl(): string {
    const stored: string | undefined = AppStorage.get<string>('nxBaseUrl');
    return stored !== undefined && stored.length > 0 ? stored : NxEnv.baseUrl();
  }

  /** 应用启动时调用一次；同步部分立即生效，账号登录异步补齐。 */
  static async resolve(context: common.Context): Promise<string> {
    Identity.readyPromise = Identity.resolveInternal(context);
    return Identity.readyPromise;
  }

  /** API 客户端在首个请求前等待身份完成，避免云端请求带空用户名。 */
  static waitReady(): Promise<string> {
    return Identity.readyPromise;
  }

  private static async resolveInternal(context: common.Context): Promise<string> {
    AppStorage.setOrCreate('nxBaseUrl', NxEnv.baseUrl());
    if (NxEnv.USE_LOCAL) {
      AppStorage.setOrCreate('nxUsername', NxEnv.LOCAL_USERNAME);
      return NxEnv.LOCAL_USERNAME;
    }
    let store: preferences.Preferences | null = null;
    try {
      const options: preferences.Options = { name: PREF_NAME };
      store = preferences.getPreferencesSync(context, options);
      const saved: string = store.getSync(KEY_USERNAME, '') as string;
      if (saved.length > 0) {
        AppStorage.setOrCreate('nxUsername', saved);
        return saved;
      }
    } catch (err) {
      store = null;
    }
    let username: string = '';
    const openId: string = await sharedAccount.silentOpenId(context);
    if (openId.length > 0) {
      username = 'hw_' + openId.slice(0, 16);
    } else {
      username = 'dev_' + util.generateRandomUUID().replace(/-/g, '').slice(0, 10);
    }
    AppStorage.setOrCreate('nxUsername', username);
    if (store !== null) {
      try {
        store.putSync(KEY_USERNAME, username);
        store.flush();
      } catch (err) {
        // 持久化失败只影响下次启动是否复用身份
      }
    }
    return username;
  }
}
