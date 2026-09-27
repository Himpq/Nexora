// 系统入口与卡片共享状态。卡片进程使用 GSKV 的实时跨进程读写，不复用 UI 进程的 XML 缓存。
import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { formBindingData, formProvider } from '@kit.FormKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { HttpUtil } from './HttpUtil';
import { Json } from './JsonUtil';
import { LearningHttp, LearningIdentity } from './LearningHttp';
import { ActionChip, TodayData, TimelineEntry } from './LearningAgentModels';

const SYSTEM_PREF_NAME: string = 'nexora_learning_system_v1';
const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraSystemEntry';

export interface LearningSystemIdentity {
    username: string;
    serviceBase: string;
    backendUrl: string;
    sessionCookie: string;
    token: string;
}

export interface LearningCardData {
    title: string;
    minutes: string;
    actionable: boolean;
    decisionId: string;
    identityToken: string;
}

export interface LearningCardAction {
    response: string;
    decisionId: string;
    identityToken: string;
}

export class LearningSystemEntry {
    // 先保存完整参数、最后递增 token，重复点击同一路由也会触发 MainChat 消费。
    static requestLaunch(route: string, decisionId: string = ''): void {
        if (['day', 'study', 'reader', 'mirror', 'judgment', 'review'].indexOf(route) < 0) {
            return;
        }
        AppStorage.setOrCreate('nxLaunchDecision', decisionId);
        AppStorage.setOrCreate('nxLaunchRoute', route);
        const token: number = AppStorage.get<number>('nxLaunchToken') || 0;
        AppStorage.setOrCreate('nxLaunchToken', token + 1);
    }

    private static open(context: common.Context): preferences.Preferences {
        if (!preferences.isStorageTypeSupported(preferences.StorageType.GSKV)) {
            throw new Error('此设备不支持跨进程卡片存储');
        }
        const options: preferences.Options = { name: SYSTEM_PREF_NAME, storageType: preferences.StorageType.GSKV };
        return preferences.getPreferencesSync(context, options);
    }

    // 仅在主应用验证登录并加载 Learning 配置之后调用；不会采用预填用户名或默认服务器。
    static prepare(context: common.Context): void {
        const identity: LearningIdentity | null = LearningHttp.captureIdentity();
        if (AppStorage.get<boolean>('nxSessionReady') !== true || identity === null || !HttpUtil.hasSession()) {
            LearningSystemEntry.clear(context);
            return;
        }
        try {
            const store: preferences.Preferences = LearningSystemEntry.open(context);
            const existing: LearningSystemIdentity | null = LearningSystemEntry.readIdentity(context);
            const cookie: string = HttpUtil.getSessionCookie();
            const backendUrl: string = HttpUtil.getBackendUrl();
            if (existing !== null && existing.username === identity.username && existing.serviceBase === identity.serviceBase &&
                existing.backendUrl === backendUrl && existing.sessionCookie === cookie) {
                return;
            }
            const saved: LearningSystemIdentity = {
                username: identity.username,
                serviceBase: identity.serviceBase,
                backendUrl: backendUrl,
                sessionCookie: cookie,
                token: Date.now().toString(36) + '_' + Math.random().toString(36).substring(2),
            };
            store.putSync('identity', JSON.stringify(saved));
            store.putSync('card', '');
            store.putSync('responded', '[]');
        } catch (err) {
            hilog.warn(DOMAIN, TAG, 'system identity unavailable');
        }
    }

    // 撤销必须发生在 app.signOut 的网络 await 之前；GSKV putSync 即时落盘，卡片进程能立即读到。
    static clear(context: common.Context): void {
        try {
            const store: preferences.Preferences = LearningSystemEntry.open(context);
            store.putSync('identity', '');
            store.putSync('card', '');
            store.putSync('responded', '[]');
            void LearningSystemEntry.refreshForms(context);
        } catch (err) {
            hilog.warn(DOMAIN, TAG, 'system identity clear failed');
        }
    }

    static readIdentity(context: common.Context): LearningSystemIdentity | null {
        try {
            const raw: string = LearningSystemEntry.open(context).getSync('identity', '') as string;
            const value: Record<string, Object> | null = Json.parseObject(raw);
            if (value === null) {
                return null;
            }
            const identity: LearningSystemIdentity = {
                username: Json.string(value, 'username'),
                serviceBase: Json.string(value, 'serviceBase'),
                backendUrl: Json.string(value, 'backendUrl'),
                sessionCookie: Json.string(value, 'sessionCookie'),
                token: Json.string(value, 'token'),
            };
            if (identity.username.length === 0 || identity.sessionCookie.length === 0 || identity.token.length === 0 ||
                !/^https?:\/\//.test(identity.serviceBase) || !/^https?:\/\//.test(identity.backendUrl)) {
                return null;
            }
            return identity;
        } catch (err) {
            return null;
        }
    }

    static isCurrent(context: common.Context, identity: LearningSystemIdentity): boolean {
        const current: LearningSystemIdentity | null = LearningSystemEntry.readIdentity(context);
        return current !== null && current.token === identity.token && current.username === identity.username &&
            current.serviceBase === identity.serviceBase && current.sessionCookie === identity.sessionCookie &&
            current.backendUrl === identity.backendUrl;
    }

    static emptyCard(): LearningCardData {
        return { title: '打开 Nexora，登录后查看学习安排', minutes: '', actionable: false, decisionId: '', identityToken: '' };
    }

    static card(context: common.Context): LearningCardData {
        const identity: LearningSystemIdentity | null = LearningSystemEntry.readIdentity(context);
        if (identity === null) {
            return LearningSystemEntry.emptyCard();
        }
        try {
            const raw: string = LearningSystemEntry.open(context).getSync('card', '') as string;
            const value: Record<string, Object> | null = Json.parseObject(raw);
            if (value === null || Json.string(value, 'identityToken') !== identity.token) {
                return { title: '打开 Nexora，看看今天的学习安排', minutes: '', actionable: false,
                    decisionId: '', identityToken: identity.token };
            }
            const decisionId: string = Json.string(value, 'decisionId');
            return {
                title: Json.string(value, 'title'), minutes: Json.string(value, 'minutes'),
                actionable: decisionId.length > 0, decisionId: decisionId, identityToken: identity.token,
            };
        } catch (err) {
            return LearningSystemEntry.emptyCard();
        }
    }

    static parseAction(message: string): LearningCardAction | null {
        const value: Record<string, Object> | null = Json.parseObject(message);
        if (value === null) {
            return null;
        }
        const response: string = Json.string(value, 'response');
        const decisionId: string = Json.string(value, 'decision_id');
        const identityToken: string = Json.string(value, 'identity_token');
        if ((response !== 'accept' && response !== 'defer') || decisionId.length === 0 || identityToken.length === 0) {
            return null;
        }
        return { response: response, decisionId: decisionId, identityToken: identityToken };
    }

    static accepts(context: common.Context, identity: LearningSystemIdentity, action: LearningCardAction): boolean {
        const card: LearningCardData = LearningSystemEntry.card(context);
        return LearningSystemEntry.isCurrent(context, identity) && action.identityToken === identity.token &&
            card.actionable && action.decisionId === card.decisionId;
    }

    private static readStrings(store: preferences.Preferences, key: string): string[] {
        const rows: Object[] | null = Json.parseArray(store.getSync(key, '[]') as string);
        const values: string[] = [];
        if (rows !== null) {
            for (let i: number = 0; i < rows.length; i++) {
                if (typeof rows[i] === 'string') {
                    values.push(rows[i] as string);
                }
            }
        }
        return values;
    }

    static rememberForm(context: common.Context, formId: string, removed: boolean = false): void {
        if (formId.length === 0) {
            return;
        }
        try {
            const store: preferences.Preferences = LearningSystemEntry.open(context);
            const ids: string[] = LearningSystemEntry.readStrings(store, 'form_ids');
            const found: number = ids.indexOf(formId);
            if (removed && found >= 0) {
                ids.splice(found, 1);
            } else if (!removed && found < 0) {
                ids.push(formId);
            }
            store.putSync('form_ids', JSON.stringify(ids));
        } catch (err) {
            hilog.warn(DOMAIN, TAG, 'card registry unavailable');
        }
    }

    static async updateForm(formId: string, data: LearningCardData): Promise<void> {
        try {
            await formProvider.updateForm(formId, formBindingData.createFormBindingData(data));
        } catch (err) {
            // 已移除或尚未添加到桌面的卡片不影响主流程。
        }
    }

    static async refreshForms(context: common.Context): Promise<void> {
        try {
            const ids: string[] = LearningSystemEntry.readStrings(LearningSystemEntry.open(context), 'form_ids');
            for (let i: number = 0; i < ids.length; i++) {
                await LearningSystemEntry.updateForm(ids[i], LearningSystemEntry.card(context));
            }
        } catch (err) {
            hilog.warn(DOMAIN, TAG, 'card refresh unavailable');
        }
    }

    static async updateToday(context: common.Context, today: TodayData, entries: TimelineEntry[]): Promise<void> {
        const current: LearningIdentity | null = LearningHttp.captureIdentity();
        if (AppStorage.get<boolean>('nxSessionReady') !== true || current === null) {
            return;
        }
        LearningSystemEntry.prepare(context);
        const identity: LearningSystemIdentity | null = LearningSystemEntry.readIdentity(context);
        if (identity === null || identity.username !== current.username || identity.serviceBase !== current.serviceBase) {
            return;
        }
        try {
            const store: preferences.Preferences = LearningSystemEntry.open(context);
            const responded: string[] = LearningSystemEntry.readStrings(store, 'responded');
            let pending: TimelineEntry | null = null;
            for (let i: number = 0; i < entries.length; i++) {
                const entry: TimelineEntry = entries[i];
                if (entry.status !== 'pending' || entry.card === null || entry.card === undefined ||
                    entry.id.length === 0 || responded.indexOf(entry.id) >= 0 || entry.actions === undefined ||
                    !entry.actions.some((item: ActionChip) => item.action === 'decision_accept')) {
                    continue;
                }
                if (pending === null || entry.ts > pending.ts) {
                    pending = entry;
                }
            }
            const title: string = pending !== null ? pending.text : (today.focus !== null
                ? '继续学习《' + today.focus.chapter_name + '》' : '打开 Nexora，查看今天的学习安排');
            const data: LearningCardData = {
                title: title,
                minutes: '今日已学 ' + Math.max(0, Math.round(today.today.study_minutes)) + ' 分钟',
                actionable: pending !== null,
                decisionId: pending !== null ? pending.id : '',
                identityToken: identity.token,
            };
            store.putSync('card', JSON.stringify(data));
            await LearningSystemEntry.refreshForms(context);
        } catch (err) {
            hilog.warn(DOMAIN, TAG, 'today card update failed');
        }
    }

    static async finishDecision(context: common.Context, identity: LearningSystemIdentity,
        action: LearningCardAction, message: string = ''): Promise<void> {
        if (!LearningSystemEntry.isCurrent(context, identity)) {
            return;
        }
        try {
            const store: preferences.Preferences = LearningSystemEntry.open(context);
            const responded: string[] = LearningSystemEntry.readStrings(store, 'responded');
            if (responded.indexOf(action.decisionId) < 0) {
                responded.push(action.decisionId);
                store.putSync('responded', JSON.stringify(responded));
            }
            const current: LearningCardData = LearningSystemEntry.card(context);
            if (current.decisionId === action.decisionId) {
                const data: LearningCardData = {
                    title: message.length > 0 ? message : (action.response === 'accept' ? '已收到，打开 Nexora 继续学习' : '已收到，晚点再学'),
                    minutes: current.minutes, actionable: false, decisionId: '', identityToken: identity.token,
                };
                store.putSync('card', JSON.stringify(data));
            }
            await LearningSystemEntry.refreshForms(context);
        } catch (err) {
            hilog.warn(DOMAIN, TAG, 'decision confirmation could not be saved');
        }
    }
}
