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

    // 强制工具调用：开=force（下发全部业务工具），关=auto_off（仅下发控制工具）
    static async loadForceTools(context: common.UIAbilityContext): Promise<boolean> {
        return PreferencesUtil.loadBoolean(context, StorageKey.forceTools, true);
    }

    static async saveForceTools(context: common.UIAbilityContext, enabled: boolean): Promise<void> {
        await PreferencesUtil.saveBoolean(context, StorageKey.forceTools, enabled);
    }

    // 随笔按登录账号隔离：同一台设备切换账号时不会串出上一位用户的私密内容
    static async loadNotes(context: common.UIAbilityContext, username: string): Promise<string> {
        return PreferencesUtil.loadString(context, StorageKey.notesPrefix + username, '');
    }

    static async saveNotes(context: common.UIAbilityContext, username: string, value: string): Promise<void> {
        await PreferencesUtil.saveString(context, StorageKey.notesPrefix + username, value);
    }

    // question 回答锁：跨会话共用一个 JSON 字典，键含 conversationId 天然隔离
    static async loadQuestionLocks(context: common.UIAbilityContext): Promise<string> {
        return PreferencesUtil.loadString(context, StorageKey.questionLocks, '{}');
    }

    static async saveQuestionLocks(context: common.UIAbilityContext, value: string): Promise<void> {
        await PreferencesUtil.saveString(context, StorageKey.questionLocks, value);
    }

    // 阅读器偏好：字号（14~22，非法值回退默认 16）
    static async loadReaderFontSize(context: common.UIAbilityContext): Promise<number> {
        const size: number = parseInt(await PreferencesUtil.loadString(context, StorageKey.readerFontSize, '16'));

        if (!Number.isInteger(size) || size < 14 || size > 22) {
            return 16;
        }

        return size;
    }

    static async saveReaderFontSize(context: common.UIAbilityContext, size: number): Promise<void> {
        await PreferencesUtil.saveString(context, StorageKey.readerFontSize, String(size));
    }

    // 阅读器偏好：行距档（0 紧凑 / 1 适中 / 2 疏松，非法值回退 1）
    static async loadReaderLineSpacing(context: common.UIAbilityContext): Promise<number> {
        const index: number = parseInt(await PreferencesUtil.loadString(context, StorageKey.readerLineSpacing, '1'));

        if (!Number.isInteger(index) || index < 0 || index > 2) {
            return 1;
        }

        return index;
    }

    static async saveReaderLineSpacing(context: common.UIAbilityContext, index: number): Promise<void> {
        await PreferencesUtil.saveString(context, StorageKey.readerLineSpacing, String(index));
    }

    // 阅读器偏好：主题（day/night/sepia，非法值回退 day）
    static async loadReaderTheme(context: common.UIAbilityContext): Promise<string> {
        const theme: string = await PreferencesUtil.loadString(context, StorageKey.readerTheme, 'day');

        if (theme !== 'day' && theme !== 'night' && theme !== 'sepia') {
            return 'day';
        }

        return theme;
    }

    static async saveReaderTheme(context: common.UIAbilityContext, theme: string): Promise<void> {
        await PreferencesUtil.saveString(context, StorageKey.readerTheme, theme);
    }

    // 各书上次阅读章节（JSON 字典 { bookId: chapterIndex }）
    static async loadReaderPositions(context: common.UIAbilityContext): Promise<string> {
        return PreferencesUtil.loadString(context, StorageKey.readerPositions, '{}');
    }

    static async saveReaderPositions(context: common.UIAbilityContext, value: string): Promise<void> {
        await PreferencesUtil.saveString(context, StorageKey.readerPositions, value);
    }

    // 退出登录：清掉会话与身份，保留后端地址与偏好
    static async clearSession(context: common.UIAbilityContext): Promise<void> {
        const prefs: preferences.Preferences = await holder.open(context);
        await prefs.delete(StorageKey.sessionCookie);
        await prefs.flush();
        hilog.info(DOMAIN, TAG, 'session cleared');
    }
}
