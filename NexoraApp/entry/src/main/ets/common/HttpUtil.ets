// HttpUtil.ets - HTTP 传输层
// 只负责「发请求 + 收响应 + 管会话 Cookie」，不含任何业务字段解析（业务解析统一在 ApiService）

import http from '@ohos.net.http';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { Json } from './JsonUtil';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraHttp';

const CONNECT_TIMEOUT: number = 10000;
const READ_TIMEOUT: number = 15000;

// 统一响应体：网络异常时 code 为 0，业务层据此区分「不通」与「状态码不对」
export interface HttpResult {
    ok: boolean;
    code: number;
    body: string;
}

export interface LoginResult {
    success: boolean;
    message: string;
}

// ArkTS 限制：对象字面量必须对应显式声明的 interface；Record 不能作为「含动态值」字面量的目标类型
interface LoginRequestBody {
    username: string;
    password: string;
}

export class HttpUtil {
    private static backendUrl: string = '';
    private static sessionCookie: string = '';

    // ---------- 后端地址 ----------
    static setBackendUrl(url: string): void {
        let fixed: string = url.trim();

        if (fixed.length === 0) {
            return;
        }

        if (!fixed.startsWith('http://') && !fixed.startsWith('https://')) {
            fixed = 'http://' + fixed;
        }

        if (fixed.endsWith('/')) {
            fixed = fixed.substring(0, fixed.length - 1);
        }

        HttpUtil.backendUrl = fixed;
        hilog.info(DOMAIN, TAG, 'backend url = %{public}s', fixed);
    }

    static getBackendUrl(): string {
        return HttpUtil.backendUrl;
    }

    // ---------- 会话 ----------
    static setSessionCookie(cookie: string): void {
        HttpUtil.sessionCookie = cookie;
    }

    static getSessionCookie(): string {
        return HttpUtil.sessionCookie;
    }

    static hasSession(): boolean {
        return HttpUtil.sessionCookie.length > 0;
    }

    static clearSession(): void {
        HttpUtil.sessionCookie = '';
    }

    // ---------- 传输 ----------
    static async get(path: string): Promise<HttpResult> {
        return HttpUtil.send(http.RequestMethod.GET, path, undefined);
    }

    static async post(path: string, payload: Object): Promise<HttpResult> {
        return HttpUtil.send(http.RequestMethod.POST, path, payload);
    }

    // 置顶等资源状态修改走 PUT，payload 为完整的变更请求体
    static async put(path: string, payload: Object): Promise<HttpResult> {
        return HttpUtil.send(http.RequestMethod.PUT, path, payload);
    }

    // 删除走 DELETE，通常无需请求体
    static async delete(path: string): Promise<HttpResult> {
        return HttpUtil.send(http.RequestMethod.DELETE, path, undefined);
    }

    // ---------- 鉴权 ----------
    // 登录：POST /login，成功后从 Set-Cookie 提取会话
    static async login(backendUrl: string, username: string, password: string): Promise<LoginResult> {
        HttpUtil.setBackendUrl(backendUrl);
        const credentials: LoginRequestBody = { username: username, password: password };
        const result: HttpResult = await HttpUtil.post('/login', credentials);

        if (result.code === 0) {
            return { success: false, message: '网络请求失败，请检查地址与网络' };
        }

        const payload: Record<string, Object> | null = Json.parseObject(result.body);

        if (payload === null) {
            return { success: false, message: '响应解析失败' };
        }

        const success: boolean = Json.boolean(payload, 'success');
        const message: string = Json.string(payload, 'message');

        if (success) {
            return { success: true, message: message.length > 0 ? message : '登录成功' };
        }

        return { success: false, message: message.length > 0 ? message : '登录失败' };
    }

    // 校验会话是否仍然有效：GET /api/user/info
    static async checkSession(): Promise<boolean> {
        const result: HttpResult = await HttpUtil.get('/api/user/info');
        return result.code === 200;
    }

    // 登出：POST /logout，无论结果都清空本地会话
    static async logout(): Promise<void> {
        const emptyBody: Record<string, string> = {};
        await HttpUtil.post('/logout', emptyBody);
        HttpUtil.clearSession();
    }

    // ---------- 内部实现 ----------
    private static async send(method: http.RequestMethod, path: string, payload?: Object): Promise<HttpResult> {
        const url: string = HttpUtil.backendUrl + path;

        if (HttpUtil.backendUrl.length === 0) {
            hilog.error(DOMAIN, TAG, 'backend url is empty, path=%{public}s', path);
            return { ok: false, code: 0, body: '' };
        }

        return new Promise<HttpResult>((resolve: (value: HttpResult) => void) => {
            const request: http.HttpRequest = http.createHttp();

            request.request(url, {
                method: method,
                header: HttpUtil.buildHeaders(),
                extraData: payload === undefined ? undefined : JSON.stringify(payload),
                expectDataType: http.HttpDataType.STRING,
                connectTimeout: CONNECT_TIMEOUT,
                readTimeout: READ_TIMEOUT
            }, (err: BusinessError, data: http.HttpResponse) => {
                const cookie: string = HttpUtil.extractSessionCookie(data.header);

                if (cookie.length > 0) {
                    HttpUtil.sessionCookie = cookie;
                }

                request.destroy();

                if (err) {
                    hilog.error(DOMAIN, TAG, 'request %{public}s failed: %{public}s', path, JSON.stringify(err));
                    resolve({ ok: false, code: 0, body: '' });
                    return;
                }

                resolve({
                    ok: data.responseCode === 200,
                    code: data.responseCode,
                    body: typeof data.result === 'string' ? data.result as string : ''
                });
            });
        });
    }

    private static buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (HttpUtil.sessionCookie.length > 0) {
            headers['Cookie'] = HttpUtil.sessionCookie;
        }

        return headers;
    }

    // 从响应头提取会话 Cookie：Harmony 的 Set-Cookie 可能是字符串或字符串数组
    private static extractSessionCookie(header: Object): string {
        const map: Record<string, Object> = header as Record<string, Object>;
        const keys: string[] = Object.keys(map);
        let rawValue: Object | null = null;

        for (let i: number = 0; i < keys.length; i++) {
            if (keys[i].toLowerCase() === 'set-cookie') {
                rawValue = map[keys[i]];
                break;
            }
        }

        if (rawValue === null) {
            return '';
        }

        return HttpUtil.firstSessionCookie(rawValue);
    }

    private static firstSessionCookie(value: Object): string {
        if (Array.isArray(value)) {
            const items: string[] = value as string[];

            for (let i: number = 0; i < items.length; i++) {
                if (items[i].indexOf('session=') >= 0) {
                    return HttpUtil.trimCookie(items[i]);
                }
            }

            return items.length > 0 ? HttpUtil.trimCookie(items[0]) : '';
        }

        return HttpUtil.trimCookie(value as string);
    }

    // "session=xxx; Path=/; HttpOnly" -> "session=xxx"
    private static trimCookie(raw: string): string {
        const firstSegment: string = raw.split(';')[0];
        return firstSegment.indexOf(',') >= 0 ? firstSegment.split(',')[0].trim() : firstSegment.trim();
    }
}
