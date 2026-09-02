// PreferencesUtil.ets - 轻量持久化封装
// 只保留两组原子读写（字符串 / 布尔），业务键在上面组合，避免每个键复制一套 getPreferences 流程

import preferences from '@ohos.data.preferences';
import common from '@ohos.app.ability.common';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { StorageKey } from './AppConfig';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraPrefs';
const PREF_NAME: string = 'nexora_prefs';

// 首选项单例：进程内只打开一次，后续全部复用
class PreferencesHolder {
    private instance: preferences.Preferences | null = null;
    private pending: Promise<preferences.Preferences> | null = null;

    async open(context: common.UIAbilityContext): Promise<preferences.Preferences> {
        if (this.instance !== null) {
            return this.instance;
        }

        if (this.pending !== null) {
            return this.pending;
        }

        this.pending = preferences.getPreferences(context, PREF_NAME);

        try {
            this.instance = await this.pending;
            return this.instance;
        } finally {
            this.pending = null;
        }
    }
}

const holder: PreferencesHolder = new PreferencesHolder();

// 原子写入：无论类型差异，落盘流程统一在此完成
async function writeValue(context: common.UIAbilityContext, key: string, value: preferences.ValueType): Promise<void> {
    const prefs: preferences.Preferences = await holder.open(context);
    await prefs.put(key, value);
    await prefs.flush();
}

// 原子读取：默认值由调用方显式给出
async function readValue(
    context: common.UIAbilityContext,
    key: string,
    defaultValue: preferences.ValueType
): Promise<preferences.ValueType> {
    const prefs: preferences.Preferences = await holder.open(context);
    return prefs.get(key, defaultValue);
}

export class PreferencesUtil {
    static async saveString(context: common.UIAbilityContext, key: string, value: string): Promise<void> {
        await writeValue(context, key, value);
    }

    static async loadString(context: common.UIAbilityContext, key: string, defaultValue: string): Promise<string> {
        const value: preferences.ValueType = await readValue(context, key, defaultValue);
        return value as string;
    }

    static async saveBoolean(context: common.UIAbilityContext, key: string, value: boolean): Promise<void> {
        await writeValue(context, key, value);
    }

    static async loadBoolean(context: common.UIAbilityContext, key: string, defaultValue: boolean): Promise<boolean> {
        const value: preferences.ValueType = await readValue(context, key, defaultValue);
        return value as boolean;
    }

    // ---------- 业务键 ----------
    static async loadBackendUrl(context: common.UIAbilityContext, defaultValue: string): Promise<string> {
        return PreferencesUtil.loadString(context, StorageKey.backendUrl, defaultValue);
    }

    static async saveBackendUrl(context: common.UIAbilityContext, url: string): Promise<void> {
        await PreferencesUtil.saveString(context, StorageKey.backendUrl, url);
    }

    static async loadSessionCookie(context: common.UIAbilityContext): Promise<string> {
        return PreferencesUtil.loadString(context, StorageKey.sessionCookie, '');
    }

    static async saveSessionCookie(context: common.UIAbilityContext, cookie: string): Promise<void> {
        await PreferencesUtil.saveString(context, StorageKey.sessionCookie, cookie);
    }

    static async loadUsername(context: common.UIAbilityContext): Promise<string> {
        return PreferencesUtil.loadString(context, StorageKey.username, '');
    }

    static async saveUsername(context: common.UIAbilityContext, username: string): Promise<void> {
        await PreferencesUtil.saveString(context, StorageKey.username, username);
    }

    static async loadSelectedModel(context: common.UIAbilityContext): Promise<string> {
        return PreferencesUtil.loadString(context, StorageKey.selectedModel, '');
    }

    static async saveSelectedModel(context: common.UIAbilityContext, modelId: string): Promise<void> {
        await PreferencesUtil.saveString(context, StorageKey.selectedModel, modelId);
    }

    static async loadEnableThinking(context: common.UIAbilityContext): Promise<boolean> {
        return PreferencesUtil.loadBoolean(context, StorageKey.enableThinking, false);
    }

    static async saveEnableThinking(context: common.UIAbilityContext, enabled: boolean): Promise<void> {
        await PreferencesUtil.saveBoolean(context, StorageKey.enableThinking, enabled);
    }

    static async loadEnableWebSearch(context: common.UIAbilityContext): Promise<boolean> {
        return PreferencesUtil.loadBoolean(context, StorageKey.enableWebSearch, true);
    }

    static async saveEnableWebSearch(context: common.UIAbilityContext, enabled: boolean): Promise<void> {
        await PreferencesUtil.saveBoolean(context, StorageKey.enableWebSearch, enabled);
    }

    // 退出登录：清掉会话与身份，保留后端地址与偏好
    static async clearSession(context: common.UIAbilityContext): Promise<void> {
        const prefs: preferences.Preferences = await holder.open(context);
        await prefs.delete(StorageKey.sessionCookie);
        await prefs.flush();
        hilog.info(DOMAIN, TAG, 'session cleared');
    }
}
