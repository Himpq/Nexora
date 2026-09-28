/**
 * 身份层：所有 API 客户端从这里取用户名，不再各自写死。
 * 解析顺序：本地联调演示账号 → Nexora 会话 cookie + 用户名；云端没有
 * 有效会话时保持未登录，交给 LoginView 建立真正的用户系统会话。
 * 结果写入 AppStorage('nxUsername') 与 ('nxBaseUrl')，供 AgentApi / ReaderApi / ReportApi / 卡片进程读取。
 */
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { http } from '@kit.NetworkKit';
import { NxEnv } from '../config/Env';

const PREF_NAME: string = 'nx_identity';
const KEY_USERNAME: string = 'username';
const KEY_SESSION_COOKIE: string = 'session_cookie';

export interface LoginResponse {
  success: boolean;
  message?: string;
  role?: string;
}

export class Identity {
  private static readyPromise: Promise<string> = Promise.resolve('');

  static current(): string {
    const stored: string | undefined = AppStorage.get<string>('nxUsername');
    return stored !== undefined ? stored : '';
  }

  static isAuthenticated(): boolean {
    if (NxEnv.USE_LOCAL) {
      return true;
    }
    return AppStorage.get<boolean>('nxAuthenticated') === true;
  }

  /** Headers shared by learning, report, reader and stream requests. */
  static authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const username: string = Identity.current();
    const cookie: string | undefined = AppStorage.get<string>('nxSessionCookie');
    if (username.length > 0) {
      headers['X-Nexora-Username'] = username;
    }
    if (cookie !== undefined && cookie.length > 0) {
      headers['Cookie'] = cookie;
    }
    return headers;
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
    AppStorage.setOrCreate('nxAuthenticated', false);
    if (NxEnv.USE_LOCAL) {
      AppStorage.setOrCreate('nxUsername', NxEnv.LOCAL_USERNAME);
      AppStorage.setOrCreate('nxAuthenticated', true);
      return NxEnv.LOCAL_USERNAME;
    }
    let store: preferences.Preferences | null = null;
    try {
      const options: preferences.Options = { name: PREF_NAME };
      store = preferences.getPreferencesSync(context, options);
      const saved: string = store.getSync(KEY_USERNAME, '') as string;
      const cookie: string = store.getSync(KEY_SESSION_COOKIE, '') as string;
      if (saved.length > 0 && cookie.length > 0) {
        AppStorage.setOrCreate('nxUsername', saved);
        AppStorage.setOrCreate('nxSessionCookie', cookie);
        AppStorage.setOrCreate('nxAuthenticated', true);
        return saved;
      }
    } catch (err) {
      store = null;
    }
    // Cloud mode requires the Nexora account session. Huawei/anonymous IDs are
    // deliberately not used as a substitute because they cannot authorize the
    // ChatDBServer user system.
    AppStorage.setOrCreate('nxUsername', '');
    return '';
  }

  static async login(context: common.Context, username: string, password: string): Promise<LoginResponse> {
    const normalized: string = username.trim();
    if (normalized.length === 0 || password.length === 0) {
      throw new Error('请输入账号和密码');
    }
    const client = http.createHttp();
    try {
      const response: http.HttpResponse = await client.request(NxEnv.NEXORA_AUTH_BASE_URL + '/login', {
        method: http.RequestMethod.POST,
        header: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        extraData: JSON.stringify({ username: normalized, password: password }),
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 15000,
        readTimeout: 30000,
      });
      const payload: LoginResponse = JSON.parse(response.result as string) as LoginResponse;
      if (response.responseCode < 200 || response.responseCode >= 300 || payload.success !== true) {
        throw new Error(payload.message !== undefined && payload.message.length > 0 ? payload.message : '登录失败');
      }
      const cookie: string = Identity.extractSessionCookie(response);
      if (cookie.length === 0) {
        throw new Error('登录响应缺少会话信息');
      }
      AppStorage.setOrCreate('nxUsername', normalized);
      AppStorage.setOrCreate('nxSessionCookie', cookie);
      AppStorage.setOrCreate('nxAuthenticated', true);
      const store = preferences.getPreferencesSync(context, { name: PREF_NAME });
      store.putSync(KEY_USERNAME, normalized);
      store.putSync(KEY_SESSION_COOKIE, cookie);
      store.flush();
      return payload;
    } catch (err) {
      if (err instanceof Error) {
        throw err;
      }
      throw new Error('网络错误，请稍后重试');
    } finally {
      client.destroy();
    }
  }

  static async logout(context: common.Context): Promise<void> {
    const client = http.createHttp();
    try {
      await client.request(NxEnv.NEXORA_AUTH_BASE_URL + '/logout', {
        method: http.RequestMethod.POST,
        header: Identity.authHeaders(),
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 10000,
        readTimeout: 15000,
      });
    } catch (err) {
      // Local state must still be cleared when the server is unreachable.
    } finally {
      client.destroy();
    }
    AppStorage.setOrCreate('nxUsername', '');
    AppStorage.setOrCreate('nxSessionCookie', '');
    AppStorage.setOrCreate('nxAuthenticated', false);
    try {
      const store = preferences.getPreferencesSync(context, { name: PREF_NAME });
      store.deleteSync(KEY_USERNAME);
      store.deleteSync(KEY_SESSION_COOKIE);
      store.flush();
    } catch (err) {
      // Best effort cleanup.
    }
  }

  private static extractSessionCookie(response: http.HttpResponse): string {
    const headers: Record<string, string> = response.header as Record<string, string>;
    const raw: string = String(headers['set-cookie'] || headers['Set-Cookie'] || '');
    if (raw.length === 0) {
      return '';
    }
    return raw.split(',')[0].split(';')[0].trim();
  }
}
