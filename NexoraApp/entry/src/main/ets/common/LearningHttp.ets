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
    private static serviceRoot: string = '';

    // AppState 在登录就绪后注入用户标识与 Learning 独立服务地址。
    static configure(username: string, frontendUrl: string = ''): void {
        LearningHttp.userName = username.trim();
        LearningHttp.serviceRoot = LearningHttp.userName.length > 0
            ? LearningHttp.normalizeServiceRoot(frontendUrl)
            : '';

        hilog.info(
            DOMAIN,
            TAG,
            'configured learning user=%{public}s service=%{public}s',
            LearningHttp.userName.length > 0 ? 'set' : 'empty',
            LearningHttp.serviceRoot.length > 0 ? LearningHttp.serviceRoot : 'empty'
        );
    }

    static get configured(): boolean {
        return LearningHttp.userName.length > 0 && LearningHttp.serviceRoot.length > 0;
    }

    // Learning 服务独立监听在 5002，不能复用 ChatDB 主站的 443/5000 地址。
    static get serviceBase(): string {
        return LearningHttp.serviceRoot;
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
        hilog.info(DOMAIN, TAG, 'json response route=%{public}s code=%{public}d chars=%{public}d',
            HttpUtil.pathForLog(path), result.code, result.body.length);

        return LearningHttp.readBody(result);
    }

    static async postJson(path: string, payload: Object): Promise<LearningBody> {
        const result: HttpResult = await HttpUtil.post(LearningHttp.absolute(path), payload, LearningHttp.headers());
        hilog.info(DOMAIN, TAG, 'json response route=%{public}s code=%{public}d chars=%{public}d',
            HttpUtil.pathForLog(path), result.code, result.body.length);

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
        hilog.info(DOMAIN, TAG, 'learning body parsed=%{public}s code=%{public}d',
            payload === null ? 'false' : 'true', result.code);

        // 非 2xx 时后端同样会给出结构化错误（如 404「大纲尚未生成」），优先上报它；
        // 否则这些有意义的说明会被统一盖成「请求失败(404)」，调用方无从区分「没生成」与「网络坏了」
        if (payload !== null) {
            const failure: string = LearningHttp.failureMessage(payload);

            if (failure.length > 0) {
                hilog.warn(DOMAIN, TAG, 'learning business failure message=%{public}s', failure);
                return { ok: false, message: failure, payload: null };
            }
        }

        if (!result.ok) {
            hilog.warn(DOMAIN, TAG, 'learning http failure code=%{public}d', result.code);
            return { ok: false, message: '请求失败(' + result.code + ')', payload: null };
        }

        if (payload === null) {
            hilog.error(DOMAIN, TAG, 'learning body parse failure chars=%{public}d', result.body.length);
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

    // 将管理端下发的页面地址规范化为 Learning API 服务根地址。
    // 例如 https://chat.himpqblog.cn:5002/api/frontend/ -> https://chat.himpqblog.cn:5002。
    private static normalizeServiceRoot(frontendUrl: string): string {
        let base: string = frontendUrl.trim();

        while (base.length > 0 && base.endsWith('/')) {
            base = base.substring(0, base.length - 1);
        }

        const frontendSuffix: string = '/api/frontend';

        if (base.endsWith(frontendSuffix)) {
            base = base.substring(0, base.length - frontendSuffix.length);
        }

        while (base.length > 0 && base.endsWith('/')) {
            base = base.substring(0, base.length - 1);
        }

        if (!base.startsWith('http://') && !base.startsWith('https://')) {
            return '';
        }

        return base;
    }
}
