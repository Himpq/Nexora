// LearningHttp.ets - NexoraLearning 内容接口的公共传输契约
// 服务根地址与用户标识由 AppState 在运行时配置就绪后注入（frontend_url 去掉 /api/frontend 前缀），
// 身份走 X-Nexora-Username 请求头（与 ChatDB 后端的 Cookie 会话解耦）。
// 各领域 API（课程 / 首页 / 题库 / 资源）只负责声明路由与字段映射，
// 传输、状态码判定、错误文案提取统一收敛到本类，避免各域重复实现。

import { hilog } from '@kit.PerformanceAnalysisKit';
import { HttpResult, HttpUtil } from './HttpUtil';
import { Json } from './JsonUtil';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraLearningHttp';

// 统一响应：payload 为空时 message 必为可展示文案，调用方只需消费这两个字段
export interface LearningBody {
    ok: boolean;
    message: string;
    payload: Record<string, Object> | null;
}

export class LearningHttp {
    private static userName: string = '';

    // AppState 在登录就绪后注入用户标识
    static configure(username: string): void {
        LearningHttp.userName = username.trim();
    }

    static get configured(): boolean {
        return LearningHttp.userName.length > 0 && HttpUtil.getBackendUrl().length > 0;
    }

    // 服务根地址 = 本应用后端根地址。
    // 学习内容接口(/api/frontend/*)与应用其余接口同根挂载，本就由后端自己提供。
    // 早期实现改用运行时下发的 frontend_url 推导服务根，该值可能为空，此时 absolute() 返回
    // 相对路径：普通 JSON 请求会被 HttpUtil.resolveUrl 悄悄补上后端主机而看不出异常，
    // 但流式请求(requestInStream)直接吃这个相对路径，curl 判为 URL 非法 → 2300003。
    // 服务根只认后端地址，杜绝相对地址流到传输层。
    static get serviceBase(): string {
        return HttpUtil.getBackendUrl();
    }

    // 身份头：流式请求（http.requestInStream）绕不开 HttpUtil，需要自行带上同一份头
    static authHeaders(): Record<string, string> {
        return LearningHttp.headers();
    }

    // 路由 -> 绝对地址（path 以 / 开头）
    static absolute(path: string): string {
        return LearningHttp.serviceBase + path;
    }

    // ---------- 请求 ----------
    static async getJson(path: string): Promise<LearningBody> {
        const result: HttpResult = await HttpUtil.get(LearningHttp.absolute(path), LearningHttp.headers());

        return LearningHttp.readBody(result);
    }

    static async postJson(path: string, payload: Object): Promise<LearningBody> {
        const result: HttpResult = await HttpUtil.post(LearningHttp.absolute(path), payload, LearningHttp.headers());

        return LearningHttp.readBody(result);
    }

    // ---------- 响应判定 ----------
    private static headers(): Record<string, string> {
        const headers: Record<string, string> = {};

        if (LearningHttp.userName.length > 0) {
            headers['X-Nexora-Username'] = LearningHttp.userName;
        }

        return headers;
    }

    private static readBody(result: HttpResult): LearningBody {
        if (result.code === 0) {
            hilog.error(DOMAIN, TAG, 'learning request unreachable');

            return { ok: false, message: '网络请求失败，请检查后端地址与网络', payload: null };
        }

        const payload: Record<string, Object> | null = Json.parseObject(result.body);

        // 非 2xx 时后端同样会给出结构化错误（如 404「大纲尚未生成」），优先上报它；
        // 否则这些有意义的说明会被统一盖成「请求失败(404)」，调用方无从区分「没生成」与「网络坏了」
        if (payload !== null) {
            const failure: string = LearningHttp.failureMessage(payload);

            if (failure.length > 0) {
                return { ok: false, message: failure, payload: null };
            }
        }

        if (!result.ok) {
            return { ok: false, message: '请求失败(' + result.code + ')', payload: null };
        }

        if (payload === null) {
            return { ok: false, message: '响应解析失败', payload: null };
        }

        return { ok: true, message: '', payload: payload };
    }

    // 服务端错误优先上报 message，其次 error（字符串或 {code,message} 两种形态）
    private static failureMessage(payload: Record<string, Object>): string {
        if (payload['success'] !== false) {
            return '';
        }

        const message: string = Json.string(payload, 'message');

        if (message.length > 0) {
            return message;
        }

        const error: Object | null = Json.fieldOrNull(payload, 'error');

        if (typeof error === 'string') {
            const text: string = (error as string).trim();

            if (text.length > 0) {
                return text;
            }
        }

        if (error !== null && typeof error === 'object' && !Array.isArray(error)) {
            const record: Record<string, Object> = error as Record<string, Object>;
            const errorMessage: string = Json.string(record, 'message');

            if (errorMessage.length > 0) {
                return errorMessage;
            }

            const code: string = Json.string(record, 'code');

            if (code.length > 0) {
                return code;
            }
        }

        return '请求失败';
    }

    // ---------- 通用字段映射 ----------
    // 对象数组 -> 逐项映射，映射失败（非对象 / 缺主键）的项直接丢弃
    static mapRows(rows: Object[], mapper: (raw: Record<string, Object>) => Object | null): Object[] {
        const result: Object[] = [];

        for (let i: number = 0; i < rows.length; i++) {
            const item: Object = rows[i];

            if (typeof item !== 'object' || item === null || Array.isArray(item)) {
                continue;
            }

            const mapped: Object | null = mapper(item as Record<string, Object>);

            if (mapped !== null) {
                result.push(mapped);
            }
        }

        return result;
    }

    // 是否满足「非空对象」条件（各域解析器的统一入口守卫）
    static isRecord(raw: Object | null): boolean {
        return raw !== null && typeof raw === 'object' && !Array.isArray(raw);
    }
}
