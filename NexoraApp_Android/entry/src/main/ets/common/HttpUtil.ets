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
    private static requestSequence: number = 0;

    private static nextRequestId(): number {
        HttpUtil.requestSequence += 1;
        return HttpUtil.requestSequence;
    }

    private static describeError(error: Object): string {
        const serialized: string = JSON.stringify(error);

        return serialized.length > 2 ? serialized : String(error);
    }

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
    static async get(pathOrUrl: string, headers?: Record<string, string>): Promise<HttpResult> {
        return HttpUtil.send(http.RequestMethod.GET, pathOrUrl, undefined, headers);
    }

    static async post(pathOrUrl: string, payload: Object, headers?: Record<string, string>): Promise<HttpResult> {
        return HttpUtil.send(http.RequestMethod.POST, pathOrUrl, payload, headers);
    }

    // 置顶等资源状态修改走 PUT，payload 为完整的变更请求体
    static async put(pathOrUrl: string, payload: Object, headers?: Record<string, string>): Promise<HttpResult> {
        return HttpUtil.send(http.RequestMethod.PUT, pathOrUrl, payload, headers);
    }

    // 局部字段修改走 PATCH（邮件已读标记等），payload 只携带被变更的字段
    static async patch(pathOrUrl: string, payload: Object, headers?: Record<string, string>): Promise<HttpResult> {
        return HttpUtil.send(http.RequestMethod.PATCH, pathOrUrl, payload, headers);
    }

    // 删除走 DELETE，通常无需请求体
    static async delete(pathOrUrl: string, headers?: Record<string, string>): Promise<HttpResult> {
        return HttpUtil.send(http.RequestMethod.DELETE, pathOrUrl, undefined, headers);
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

    // 下载二进制资源（如头像）：自签 https 证书下 Image 组件无法直接加载网络图片，
    // 需通过此处跳过证书校验拉取字节流，由调用方写入本地后再喂给 Image
    static async downloadBinary(url: string): Promise<ArrayBuffer | null> {
        const resolvedUrl: string = HttpUtil.resolveUrl(url);
        const requestId: number = HttpUtil.nextRequestId();
        const startedAt: number = Date.now();
        const route: string = HttpUtil.pathForLog(resolvedUrl.length > 0 ? resolvedUrl : url);

        if (resolvedUrl.length === 0) {
            hilog.error(DOMAIN, TAG, 'binary start id=%{public}d route=%{public}s rejected: empty url', requestId, route);
            return null;
        }

        hilog.info(DOMAIN, TAG, 'binary start id=%{public}d route=%{public}s', requestId, route);

        return new Promise<ArrayBuffer | null>((resolve: (value: ArrayBuffer | null) => void) => {
            const request: http.HttpRequest = http.createHttp();

            try {
                request.request(resolvedUrl, {
                    method: http.RequestMethod.GET,
                    header: HttpUtil.buildHeaders(),
                    expectDataType: http.HttpDataType.ARRAY_BUFFER,
                    connectTimeout: CONNECT_TIMEOUT,
                    readTimeout: READ_TIMEOUT,
                    remoteValidation: 'skip'
                }, (err: BusinessError, data: http.HttpResponse) => {
                    try {
                        if (err) {
                            hilog.error(DOMAIN, TAG, 'binary failed id=%{public}d route=%{public}s error=%{public}s',
                                requestId, route, HttpUtil.describeError(err));
                            resolve(null);
                            return;
                        }

                        if (data.responseCode !== 200) {
                            hilog.error(DOMAIN, TAG, 'binary status id=%{public}d route=%{public}s code=%{public}d',
                                requestId, route, data.responseCode);
                            resolve(null);
                            return;
                        }

                        const result: Object = data.result;

                        if (result instanceof ArrayBuffer) {
                            hilog.info(DOMAIN, TAG, 'binary body id=%{public}d route=%{public}s bytes=%{public}d',
                                requestId, route, (result as ArrayBuffer).byteLength);
                            resolve(result);
                            return;
                        }

                        if (result instanceof Uint8Array) {
                            const view: Uint8Array = result as Uint8Array;
                            const copy: Uint8Array = new Uint8Array(view.byteLength);
                            copy.set(view);
                            hilog.info(DOMAIN, TAG, 'binary body converted id=%{public}d route=%{public}s bytes=%{public}d',
                                requestId, route, copy.byteLength);
                            resolve(copy.buffer as ArrayBuffer);
                            return;
                        }

                        hilog.error(DOMAIN, TAG, 'binary body invalid id=%{public}d route=%{public}s type=%{public}s',
                            requestId, route, typeof result);
                        resolve(null);
                    } catch (callbackErr) {
                        hilog.error(DOMAIN, TAG, 'binary callback threw id=%{public}d route=%{public}s error=%{public}s',
                            requestId, route, HttpUtil.describeError(callbackErr));
                        resolve(null);
                    } finally {
                        hilog.info(DOMAIN, TAG, 'binary end id=%{public}d route=%{public}s elapsedMs=%{public}d',
                            requestId, route, Date.now() - startedAt);
                        request.destroy();
                    }
                });
            } catch (err) {
                request.destroy();
                hilog.error(DOMAIN, TAG, 'binary setup threw id=%{public}d route=%{public}s error=%{public}s elapsedMs=%{public}d',
                    requestId, route, HttpUtil.describeError(err), Date.now() - startedAt);
                resolve(null);
            }
        });
    }

    // ---------- 内部实现 ----------
    private static async send(method: http.RequestMethod, pathOrUrl: string, payload?: Object, headers?: Record<string, string>): Promise<HttpResult> {
        const url: string = HttpUtil.resolveUrl(pathOrUrl);
        const requestId: number = HttpUtil.nextRequestId();
        const startedAt: number = Date.now();
        const route: string = HttpUtil.pathForLog(url.length > 0 ? url : pathOrUrl);

        if (url.length === 0) {
            hilog.error(DOMAIN, TAG, 'request start id=%{public}d method=%{public}s route=%{public}s rejected: empty url',
                requestId, method, route);
            return { ok: false, code: 0, body: '' };
        }

        hilog.info(DOMAIN, TAG, 'request start id=%{public}d method=%{public}s route=%{public}s',
            requestId, method, route);

        return new Promise<HttpResult>((resolve: (value: HttpResult) => void) => {
            const request: http.HttpRequest = http.createHttp();

            try {
                request.request(url, {
                    method: method,
                    header: HttpUtil.buildHeaders(headers),
                    extraData: payload === undefined ? undefined : JSON.stringify(payload),
                    expectDataType: http.HttpDataType.STRING,
                    connectTimeout: CONNECT_TIMEOUT,
                    readTimeout: READ_TIMEOUT,
                    remoteValidation: 'skip'
                }, (err: BusinessError, data: http.HttpResponse) => {
                    try {
                        if (err) {
                            hilog.error(DOMAIN, TAG, 'request failed id=%{public}d route=%{public}s error=%{public}s',
                                requestId, route, HttpUtil.describeError(err));
                            resolve({ ok: false, code: 0, body: '' });
                            return;
                        }

                        const cookie: string = HttpUtil.extractSessionCookie(data.header);

                        if (cookie.length > 0) {
                            HttpUtil.sessionCookie = cookie;
                        }

                        const body: string = typeof data.result === 'string' ? data.result as string : '';
                        hilog.info(DOMAIN, TAG, 'request body id=%{public}d route=%{public}s code=%{public}d chars=%{public}d',
                            requestId, route, data.responseCode, body.length);
                        resolve({
                            ok: data.responseCode === 200,
                            code: data.responseCode,
                            body: body
                        });
                    } catch (callbackErr) {
                        hilog.error(DOMAIN, TAG, 'request callback threw id=%{public}d route=%{public}s error=%{public}s',
                            requestId, route, HttpUtil.describeError(callbackErr));
                        resolve({ ok: false, code: 0, body: '' });
                    } finally {
                        hilog.info(DOMAIN, TAG, 'request end id=%{public}d route=%{public}s elapsedMs=%{public}d',
                            requestId, route, Date.now() - startedAt);
                        request.destroy();
                    }
                });
            } catch (err) {
                request.destroy();
                hilog.error(DOMAIN, TAG, 'request setup threw id=%{public}d route=%{public}s error=%{public}s elapsedMs=%{public}d',
                    requestId, route, HttpUtil.describeError(err), Date.now() - startedAt);
                resolve({ ok: false, code: 0, body: '' });
            }
        });
    }

    private static resolveUrl(pathOrUrl: string): string {
        if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
            return pathOrUrl;
        }

        if (HttpUtil.backendUrl.length === 0) {
            return '';
        }

        return HttpUtil.backendUrl + pathOrUrl;
    }

    // 日志只保留路由，不记录域名、查询参数或会话标识，避免把用户文件引用写进设备日志。
    static pathForLog(pathOrUrl: string): string {
        let value: string = pathOrUrl.trim();

        if (value.startsWith('data:')) {
            const dataStart: number = value.indexOf(',');

            return dataStart >= 0 ? value.substring(0, dataStart) + ',<redacted>' : value.substring(0, 64);
        }

        if (value.startsWith('http://') || value.startsWith('https://')) {
            const schemeEnd: number = value.indexOf('://') + 3;
            const pathStart: number = value.indexOf('/', schemeEnd);
            value = pathStart >= 0 ? value.substring(pathStart) : '/';
        }

        const queryStart: number = value.indexOf('?');
        return queryStart >= 0 ? value.substring(0, queryStart) : value;
    }

    private static buildHeaders(extra?: Record<string, string>): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (HttpUtil.sessionCookie.length > 0) {
            headers['Cookie'] = HttpUtil.sessionCookie;
        }

        if (extra !== undefined) {
            const keys: string[] = Object.keys(extra);

            for (let i: number = 0; i < keys.length; i++) {
                headers[keys[i]] = extra[keys[i]];
            }
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
