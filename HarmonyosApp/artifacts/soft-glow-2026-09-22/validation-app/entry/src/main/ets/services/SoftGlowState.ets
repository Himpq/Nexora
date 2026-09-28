/**
 * 昼夜氛围与每日顶部光的本地事实。Preferences 位于本安装的沙箱内，
 * 账号、规范化服务地址和本地自然日组成键；不采集设备标识。
 */
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { url } from '@kit.ArkTS';

const PREF_NAME: string = 'nx_soft_glow_state_v1';
const DAY_START_HOUR: number = 7;
const NIGHT_START_HOUR: number = 19;

/** 外观明暗独立于此时段；07:00（含）至 19:00（不含）为日间。 */
export function nxGlowPeriodAt(timestamp: number): 'day' | 'night' {
  const hour = new Date(timestamp).getHours();
  return hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR ? 'day' : 'night';
}

export function nxGlowDayAt(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }
  return date.getFullYear().toString().padStart(4, '0') + '-' +
    (date.getMonth() + 1).toString().padStart(2, '0') + '-' +
    date.getDate().toString().padStart(2, '0');
}

/** 下一次严格晚于 timestamp 的本地日夜边界；不假定一天总是 24 小时。 */
export function nxNextGlowBoundaryAt(timestamp: number): number {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    return Number.NaN;
  }
  if (date.getHours() < DAY_START_HOUR) {
    date.setHours(DAY_START_HOUR, 0, 0, 0);
  } else if (date.getHours() < NIGHT_START_HOUR) {
    date.setHours(NIGHT_START_HOUR, 0, 0, 0);
  } else {
    date.setDate(date.getDate() + 1);
    date.setHours(DAY_START_HOUR, 0, 0, 0);
  }
  return date.getTime();
}

function normalizeService(baseUrl: string): string {
  if (baseUrl.trim().length === 0) {
    return '';
  }
  try {
    const parsed = url.URL.parseURL(baseUrl.trim());
    const protocol = parsed.protocol.toLowerCase();
    if ((protocol !== 'http:' && protocol !== 'https:') || parsed.hostname.length === 0 ||
      parsed.username.length > 0 || parsed.password.length > 0) {
      return '';
    }
    // 主机/协议大小写、默认端口、末尾斜线不形成新环境；路径和查询保持语义。
    const port = parsed.port;
    const defaultPort = (protocol === 'http:' && port === '80') || (protocol === 'https:' && port === '443');
    const authority = parsed.hostname.toLowerCase() + (port.length === 0 || defaultPort ? '' : ':' + port);
    return protocol + '//' + authority + parsed.pathname.replace(/\/+$/, '') + parsed.search;
  } catch (err) {
    return '';
  }
}

function claimKey(username: string, baseUrl: string, timestamp: number): string {
  const account = username.trim();
  const service = normalizeService(baseUrl);
  const day = nxGlowDayAt(timestamp);
  if (account.length === 0 || service.length === 0 || day.length === 0) {
    return '';
  }
  try {
    // 编码后的键只含 ASCII；分隔符也不会与账号或地址中的字符发生冲突。
    const key = 'first:' + encodeURIComponent(account) + '|' + encodeURIComponent(service) + '|' + day;
    return key.length <= 1024 ? key : '';
  } catch (err) {
    return '';
  }
}

/** 可注入测试存储；get/put 是同步的，flush 只负责落盘而不门控输入。 */
export interface SoftGlowStorage {
  get(key: string): string;
  put(key: string, value: string): void;
  flush(): Promise<void>;
}

class PreferencesGlowStorage implements SoftGlowStorage {
  private store: preferences.Preferences;

  constructor(store: preferences.Preferences) {
    this.store = store;
  }

  get(key: string): string {
    const value = this.store.getSync(key, '');
    return typeof value === 'string' ? value : '';
  }

  put(key: string, value: string): void {
    this.store.putSync(key, value);
  }

  flush(): Promise<void> {
    return this.store.flush();
  }
}

export class SoftGlowState {
  private storage: SoftGlowStorage | null;
  private shown: Set<string> = new Set<string>();

  constructor(storage: SoftGlowStorage | null = null) {
    this.storage = storage;
  }

  init(context: common.Context): void {
    if (this.storage !== null) {
      return;
    }
    try {
      const options: preferences.Options = { name: PREF_NAME };
      this.storage = new PreferencesGlowStorage(preferences.getPreferencesSync(context, options));
    } catch (err) {
      // 尚不能检查历史时跳过装饰；后续 init 仍可重试，输入不依赖此状态。
      this.storage = null;
    }
  }

  /**
   * 只在通过有效输入、身份、开关和可见性检查，且马上呈现顶部光时调用一次。
   * timestamp 是该次发送捕获的时间；在途回调/失败重试/取消不再调用此方法。
   * 资格与回复结果无关，不提供撤销；跨午夜的新发送才有新的一次资格。
   */
  claimFirstGlow(username: string, baseUrl: string, timestamp: number): boolean {
    const key = claimKey(username, baseUrl, timestamp);
    if (key.length === 0 || this.shown.has(key) || this.storage === null) {
      return false;
    }
    try {
      if (this.storage.get(key) === '1') {
        this.shown.add(key);
        return false;
      }
    } catch (err) {
      // 无法确认是否展示过时不重播，也不占用资格。
      return false;
    }
    // 先记入本会话，避免重复点击和磁盘写入失败让同一日反复播放。
    this.shown.add(key);
    try {
      this.storage.put(key, '1');
      this.storage.flush().catch((): void => {
        // 装饰保存失败不能中断用户发送；本会话已展示事实仍然保留。
      });
    } catch (err) {
      // 包括同步写入或 flush 启动失败，本会话仍不重播。
    }
    return true;
  }
}

export const sharedSoftGlowState: SoftGlowState = new SoftGlowState();
