/**
 * client.ts — 统一 HTTP 请求封装
 *
 * 职责:
 *   - 统一 credentials(携带会话 cookie)与 JSON 编解码
 *   - 统一错误处理:401 跳转登录、非 2xx 抛出 ApiError
 *   - 供所有 api/* 模块复用,避免每个模块重复 fetch 样板
 */

export class ApiError extends Error {
    status: number

    constructor(status: number, message: string) {
        super(message)

        this.name = 'ApiError'
        this.status = status
    }
}

/** 401 未登录时跳转新前端登录页(带来源回跳),避免重复触发 */
let redirectingToLogin = false

function redirectToLogin() {
    if (redirectingToLogin) {
        return
    }

    redirectingToLogin = true

    const current = window.location.hash || '/'

    window.location.href = `/new#/login?next=${encodeURIComponent(current)}`
}

/** 通用请求入口:处理 cookie、超时、JSON、错误 */
export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 60000)

    try {
        const res = await fetch(path, {
            ...options,
            credentials: 'include',
            headers: {
                // FormData 请求由浏览器自动设置 multipart boundary,强制 JSON 头会导致上传失败
                ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
                ...(options.headers || {}),
            },
            signal: controller.signal,
        })

        if (res.status === 401) {
            redirectToLogin()

            throw new ApiError(401, '登录状态已失效,请重新登录')
        }

        if (!res.ok) {
            const data = await res.json().catch(() => null)
            const message = data && typeof data.message === 'string'
                ? data.message
                : `请求失败(${res.status})`

            throw new ApiError(res.status, message)
        }

        if (res.status === 204) {
            return undefined as T
        }

        const contentType = res.headers.get('content-type') || ''

        if (contentType.includes('application/json')) {
            return await res.json() as T
        }

        return await res.text() as unknown as T
    } catch (error) {
        if (error instanceof ApiError) {
            throw error
        }

        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new ApiError(0, '请求超时,请稍后重试')
        }

        throw new ApiError(0, error instanceof Error ? error.message : '网络请求失败')
    } finally {
        window.clearTimeout(timeoutId)
    }
}
