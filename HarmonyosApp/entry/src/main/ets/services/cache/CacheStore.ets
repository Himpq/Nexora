/**
 * §8 services/cache/（#20）：Preferences + 本地文件。
 * 缓存：今日摘要、最近时间线、章节正文、今日规划。飞行模式下核心路径可用。
 */
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';

const PREF_NAME = 'nx_cache';

export class CacheStore {
  private store: preferences.Preferences | null = null;

  init(context: common.Context): void {
    if (this.store !== null) {
      return;
    }
    try {
      const options: preferences.Options = { name: PREF_NAME };
      this.store = preferences.getPreferencesSync(context, options);
    } catch (err) {
      this.store = null;
    }
  }

  put(key: string, value: string): void {
    if (this.store === null) {
      return;
    }
    try {
      this.store.putSync(key, value);
      this.store.flush();
    } catch (err) {
      // 缓存写入失败不阻塞主线
    }
  }

  get(key: string): string {
    if (this.store === null) {
      return '';
    }
    try {
      const value = this.store.getSync(key, '');
      return value === undefined ? '' : value as string;
    } catch (err) {
      return '';
    }
  }

  putNumber(key: string, value: number): void {
    this.put(key, String(value));
  }

  getNumber(key: string, fallback: number): number {
    const raw = this.get(key);
    if (raw.length === 0) {
      return fallback;
    }
    const value = Number(raw);
    return isNaN(value) ? fallback : value;
  }

  putBoolean(key: string, value: boolean): void {
    this.put(key, value ? '1' : '0');
  }

  getBoolean(key: string, fallback: boolean): boolean {
    const raw = this.get(key);
    if (raw.length === 0) {
      return fallback;
    }
    return raw === '1' || raw.toLowerCase() === 'true';
  }
}

export const sharedCache: CacheStore = new CacheStore();
