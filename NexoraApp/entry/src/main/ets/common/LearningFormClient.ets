// 卡片后台请求使用已验证身份的固定快照；不改 UI 进程的 LearningHttp / HttpUtil 全局配置。
import { common } from '@kit.AbilityKit';
import { http } from '@kit.NetworkKit';
import { Json } from './JsonUtil';
import { LearningCardAction, LearningSystemEntry, LearningSystemIdentity } from './LearningSystemEntry';
import { TodayData, TimelineEntry } from './LearningAgentModels';

export interface LearningSystemSnapshot {
    identity: LearningSystemIdentity;
    today: TodayData;
    entries: TimelineEntry[];
}

export interface LearningCardReply {
    message: string;
    retry: boolean;
}

interface LearningFormResponse {
    status: number;
    payload: Record<string, Object> | null;
}

interface LearningDecisionRequest {
    decision_id: string;
    response: string;
}

export class LearningFormClient {
    private static async request(identity: LearningSystemIdentity, url: string,
        payload: Object | null = null): Promise<LearningFormResponse> {
        const client: http.HttpRequest = http.createHttp();
        try {
            const options: http.HttpRequestOptions = {
                method: payload === null ? http.RequestMethod.GET : http.RequestMethod.POST,
                header: {
                    'Content-Type': 'application/json',
                    'Cookie': identity.sessionCookie,
                },
                expectDataType: http.HttpDataType.STRING,
                connectTimeout: 10000,
                readTimeout: 15000,
            };
            if (payload !== null) {
                options.extraData = JSON.stringify(payload);
            }
            const response: http.HttpResponse = await client.request(url, options);
            return { status: response.responseCode,
                payload: typeof response.result === 'string' ? Json.parseObject(response.result as string) : null };
        } catch (err) {
            return { status: 0, payload: null };
        } finally {
            client.destroy();
        }
    }

    private static data(result: LearningFormResponse): Record<string, Object> | null {
        if (result.status < 200 || result.status >= 300 || result.payload === null ||
            !Json.boolean(result.payload, 'success')) { return null; }
        return Json.object(result.payload, 'data');
    }

    private static async validate(context: common.Context, identity: LearningSystemIdentity): Promise<boolean> {
        const session: LearningFormResponse = await LearningFormClient.request(identity,
            identity.backendUrl + '/api/user/info?lite=1');
        if (!LearningSystemEntry.isCurrent(context, identity)) { return false; }
        const user: Record<string, Object> | null = session.payload === null ? null : Json.object(session.payload, 'user');
        if (session.status === 401 || session.status === 403 || session.status === 404 ||
            (session.status === 200 && (session.payload === null || !Json.boolean(session.payload, 'success') ||
            user === null || Json.string(user, 'id') !== identity.username))) {
            LearningSystemEntry.clear(context);
            return false;
        }
        return session.status === 200;
    }

    // Cookie 只发主站，Learning 的服务端密钥由主站代理附加。
    static async refresh(context: common.Context): Promise<LearningSystemSnapshot | null> {
        const identity: LearningSystemIdentity | null = LearningSystemEntry.readIdentity(context);
        if (identity === null || !await LearningFormClient.validate(context, identity)) { return null; }
        const observedAt: number = Date.now();
        const todayResult: LearningFormResponse = await LearningFormClient.request(identity,
            identity.backendUrl + '/api/learning/agent/today');
        if (!LearningSystemEntry.isCurrent(context, identity)) { return null; }
        const today: Record<string, Object> | null = LearningFormClient.data(todayResult);
        if (today === null || Json.object(today, 'today') === null) { return null; }
        const eventsResult: LearningFormResponse = await LearningFormClient.request(identity,
            identity.backendUrl + '/api/learning/agent/events?limit=120');
        if (!LearningSystemEntry.isCurrent(context, identity)) { return null; }
        const events: Record<string, Object> | null = LearningFormClient.data(eventsResult);
        if (events === null || !Array.isArray(events['entries'])) { return null; }
        const entries: TimelineEntry[] = Json.array(events, 'entries') as TimelineEntry[];
        const snapshot: LearningSystemSnapshot = { identity: identity, today: today as Object as TodayData, entries: entries };
        await LearningSystemEntry.saveToday(context, identity, snapshot.today, entries, observedAt);
        return LearningSystemEntry.isCurrent(context, identity) ? snapshot : null;
    }

    static async reportDevice(context: common.Context, identity: LearningSystemIdentity, payload: Object): Promise<boolean> {
        if (!LearningSystemEntry.isCurrent(context, identity)) { return false; }
        const result: LearningFormResponse = await LearningFormClient.request(identity,
            identity.backendUrl + '/api/learning/agent/context/device', payload);
        return LearningSystemEntry.isCurrent(context, identity) && LearningFormClient.data(result) !== null;
    }

    static async respond(context: common.Context, action: LearningCardAction): Promise<LearningCardReply> {
        const identity: LearningSystemIdentity | null = LearningSystemEntry.readIdentity(context);
        if (identity === null) {
            return { message: '请先打开 Nexora 登录', retry: false };
        }
        if (!LearningSystemEntry.accepts(context, identity, action)) {
            return { message: '', retry: false };
        }

        // Learning 以用户名归属数据；先在主站确认 Cookie 仍有效，避免过期的已保存身份继续写入。
        const session: LearningFormResponse = await LearningFormClient.request(identity,
            identity.backendUrl + '/api/user/info?lite=1');
        if (!LearningSystemEntry.accepts(context, identity, action)) {
            return { message: '', retry: false };
        }
        const user: Record<string, Object> | null = session.payload === null ? null : Json.object(session.payload, 'user');
        if (session.status === 401 || session.status === 403 || session.status === 404 ||
            (session.status === 200 && (session.payload === null || !Json.boolean(session.payload, 'success') ||
            user === null || Json.string(user, 'id') !== identity.username))) {
            LearningSystemEntry.clear(context);
            return { message: '登录已失效，请打开 Nexora 重新登录', retry: false };
        }
        if (session.status !== 200) {
            return { message: '暂时无法确认登录状态，请稍后重试', retry: true };
        }

        const payload: LearningDecisionRequest = { decision_id: action.decisionId, response: action.response };
        const result: LearningFormResponse = await LearningFormClient.request(identity,
            identity.backendUrl + '/api/learning/agent/decision/respond', payload);
        if (!LearningSystemEntry.isCurrent(context, identity)) {
            return { message: '', retry: false };
        }
        if (result.status >= 200 && result.status < 300 && result.payload !== null && Json.boolean(result.payload, 'success')) {
            const data: Record<string, Object> | null = Json.object(result.payload, 'data');
            if (data !== null && Json.boolean(data, 'updated')) {
                await LearningSystemEntry.finishDecision(context, identity, action);
                return { message: '', retry: false };
            }
        }
        if (result.status === 401 || result.status === 403) {
            LearningSystemEntry.clear(context);
            return { message: '请打开 Nexora 确认登录和学习服务', retry: false };
        }
        if (result.status === 400 || result.status === 404) {
            await LearningSystemEntry.finishDecision(context, identity, action, '这项安排已更新，打开 Nexora 查看');
            return { message: '', retry: false };
        }
        return { message: '选择还没送达，请稍后重试', retry: true };
    }
}
