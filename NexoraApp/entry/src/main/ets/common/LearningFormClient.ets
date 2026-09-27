// 卡片后台请求使用已验证身份的固定快照；不改 UI 进程的 LearningHttp / HttpUtil 全局配置。
import { common } from '@kit.AbilityKit';
import { http } from '@kit.NetworkKit';
import { Json } from './JsonUtil';
import { LearningCardAction, LearningSystemEntry, LearningSystemIdentity } from './LearningSystemEntry';

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
        payload: LearningDecisionRequest | null = null): Promise<LearningFormResponse> {
        const client: http.HttpRequest = http.createHttp();
        try {
            const options: http.HttpRequestOptions = {
                method: payload === null ? http.RequestMethod.GET : http.RequestMethod.POST,
                header: {
                    'Content-Type': 'application/json',
                    'Cookie': identity.sessionCookie,
                    'X-Nexora-Username': identity.username,
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
            identity.serviceBase + '/api/agent/v1/decision/respond', payload);
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
