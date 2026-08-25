/**
 * auth.ts — 认证相关 API
 *
 * 职责:
 *   - 登录 / 登出
 *   - 当前用户信息获取(同时用于路由守卫判断登录态)
 */

import { apiFetch } from './client'

export interface UserInfo {
    id: string
    username: string
    role: string
    nickname?: string
    avatar_url?: string
    [key: string]: unknown
}

export interface LoginResult {
    success: boolean
    message?: string
}

/** 登录:POST /login,成功后由服务端写入 session cookie */
export function login(username: string, password: string): Promise<LoginResult> {
    return apiFetch<LoginResult>('/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
    })
}

/** 登出:清空服务端 session */
export function logout(): Promise<LoginResult> {
    return apiFetch<LoginResult>('/logout', { method: 'POST' })
}

/** 获取当前登录用户信息;未登录时抛出 ApiError(401) */
export async function getUserInfo(): Promise<UserInfo> {
    // 后端返回 { success, user: { id, username, role, ... } },解包 user 字段
    const data = await apiFetch<{ success: boolean; user?: UserInfo }>('/api/user/info')

    if (!data || !data.user) {
        throw new Error('用户信息为空')
    }

    return data.user
}

/** 更新用户资料(显示名 + 头像 base64 data URL) */
export async function updateUserProfile(options: {
    displayName?: string
    avatarBase64?: string
}): Promise<UserInfo> {
    const data = await apiFetch<{ success: boolean; user: UserInfo }>('/api/user/profile', {
        method: 'PUT',
        body: JSON.stringify({
            display_name: options.displayName,
            avatar_base64: options.avatarBase64,
        }),
    })

    return data.user
}
