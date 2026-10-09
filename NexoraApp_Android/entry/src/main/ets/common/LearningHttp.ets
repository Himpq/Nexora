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
    // 网络失败为 0；阅读队列据此区分无效记录和可重试故障。
    status: number;
}

// 异步操作捕获同一份地址与身份，不能在 await 后改用另一个账号的请求头。
export interface LearningIdentity {
    readonly username: string;
    readonly serviceBase: string;
    readonly scope: string;
    readonly revision: number;
}

export class LearningHttp {
    private static userName: string = '';
    private static serviceRoot: string = '';
    private static identityRevision: number = 0;

    // AppState 在登录就绪后注入用户标识与 Learning 独立服务地址。
    static configure(username: string, frontendUrl: string = ''): void {
        const nextUsername: string = username.trim();
        const nextRoot: string = nextUsername.length > 0
            ? LearningHttp.normalizeServiceRoot(frontendUrl)
            : '';
        const changed: boolean = LearningHttp.userName !== nextUsername || LearningHttp.serviceRoot !== nextRoot;
        if (changed) {
            LearningHttp.identityRevision++;
        }
        LearningHttp.userName = nextUsername;
        LearningHttp.serviceRoot = nextRoot;
        if (changed) {
            // 先更新身份再通知，阅读器可在切换瞬间结束旧计时并拒绝旧章节回包。
            AppStorage.setOrCreate('nxLearningIdentityRevision', LearningHttp.identityRevision);
        }

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

    static captureIdentity(): LearningIdentity | null {
        if (!LearningHttp.configured) {
            return null;
        }
        return {
            username: LearningHttp.userName,
            serviceBase: LearningHttp.serviceRoot,
            // encodeURIComponent 会保留 '_'，不能用它分隔两段，避免地址/用户名组合碰撞。
            scope: encodeURIComponent(LearningHttp.serviceRoot) + '|' + encodeURIComponent(LearningHttp.userName),
            revision: LearningHttp.identityRevision
        };
    }

    static isCurrent(identity: LearningIdentity | null): boolean {
        return identity !== null && LearningHttp.configured && identity.username === LearningHttp.userName &&
            identity.serviceBase === LearningHttp.serviceRoot && identity.revision === LearningHttp.identityRevision &&
            identity.scope === encodeURIComponent(LearningHttp.serviceRoot) + '|' + encodeURIComponent(LearningHttp.userName);
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
    static async getJson(path: string, identity: LearningIdentity | null = LearningHttp.captureIdentity()): Promise<LearningBody> {
        if (identity === null || !LearningHttp.isCurrent(identity)) {
            return { ok: false, message: '学习服务身份已变更或尚未就绪', payload: null, status: 0 };
        }
        const result: HttpResult = await HttpUtil.get(LearningHttp.requestUrl(path, identity), LearningHttp.headers(identity));
        hilog.info(DOMAIN, TAG, 'json response route=%{public}s code=%{public}d chars=%{public}d',
            HttpUtil.pathForLog(path), result.code, result.body.length);

        if (!LearningHttp.isCurrent(identity)) {
            return { ok: false, message: '学习账号或服务已切换，请刷新后重试', payload: null, status: 0 };
        }

        return LearningHttp.readBody(result);
    }

    static async postJson(path: string, payload: Object,
        identity: LearningIdentity | null = LearningHttp.captureIdentity(), readTimeoutMs?: number): Promise<LearningBody> {
        if (identity === null || !LearningHttp.isCurrent(identity)) {
            return { ok: false, message: '学习服务身份已变更或尚未就绪', payload: null, status: 0 };
        }
        const result: HttpResult = await HttpUtil.post(LearningHttp.requestUrl(path, identity), payload, LearningHttp.headers(identity), readTimeoutMs);
        hilog.info(DOMAIN, TAG, 'json response route=%{public}s code=%{public}d chars=%{public}d',
            HttpUtil.pathForLog(path), result.code, result.body.length);

        if (!LearningHttp.isCurrent(identity)) {
            return { ok: false, message: '学习账号或服务已切换，请刷新后重试', payload: null, status: 0 };
        }

        return LearningHttp.readBody(result);
    }

    // ---------- 响应判定 ----------
    // Agent operations are authorized by the main site's session. Service keys stay on the server.
    private static requestUrl(path: string, identity: LearningIdentity): string {
        const prefix: string = '/api/agent/v1/';
        return path.startsWith(prefix) ? '/api/learning/agent/' + path.substring(prefix.length) : identity.serviceBase + path;
    }

    private static headers(identity: LearningIdentity | null = LearningHttp.captureIdentity()): Record<string, string> {
        const headers: Record<string, string> = {};

        if (identity !== null) {
            headers['X-Nexora-Username'] = identity.username;
        }

        return headers;
    }

    private static readBody(result: HttpResult): LearningBody {
        if (result.code === 0) {
            hilog.error(DOMAIN, TAG, 'learning request unreachable');

            return { ok: false, message: '网络请求失败，请检查后端地址与网络', payload: null, status: result.code };
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
                return { ok: false, message: failure, payload: null, status: result.code };
            }
        }

        if (result.code < 200 || result.code >= 300) {
            hilog.warn(DOMAIN, TAG, 'learning http failure code=%{public}d', result.code);
            return { ok: false, message: '请求失败(' + result.code + ')', payload: null, status: result.code };
        }

        if (payload === null) {
            hilog.error(DOMAIN, TAG, 'learning body parse failure chars=%{public}d', result.body.length);
            return { ok: false, message: '响应解析失败', payload: null, status: result.code };
        }

        return { ok: true, message: '', payload: payload, status: result.code };
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
