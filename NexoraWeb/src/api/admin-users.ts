/**
 * admin-users.ts — 管理员:用户管理 API
 *
 * 对应后端路由:
 *   GET    /api/admin/users                            用户列表
 *   POST   /api/admin/users                            添加用户
 *   DELETE /api/admin/users/<username>                 删除用户
 *   PATCH  /api/admin/users/<username>/role            修改角色
 *   PATCH  /api/admin/users/<username>/password        重置密码
 *   GET    /api/admin/users/<username>/models          用户模型白名单
 */

import { apiFetch } from './client'

export interface AdminUser {
    user_id: string
    username: string
    has_password: boolean
    role: string
    last_ip: string
    last_login?: number
    created_at?: number
    total_token_usage: number
    avatar_url?: string
    /** 本地邮箱绑定(对齐原版 get_local_mail_profile) */
    local_mail?: {
        provider?: string
        group?: string
        username?: string
        address?: string
        linked_at?: number | null
    }
    [key: string]: unknown
}

interface AdminUserListResponse {
    success: boolean
    users?: AdminUser[]
}

/** 拉取全部用户(管理员) */
export async function listAdminUsers(): Promise<AdminUser[]> {
    const data = await apiFetch<AdminUserListResponse>('/api/admin/users')

    return Array.isArray(data.users) ? data.users : []
}

/** 添加用户 */
export async function addAdminUser(options: {
    username: string
    password: string
    role?: string
}): Promise<unknown> {
    return apiFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(options),
    })
}

interface AdminUserMutationResponse {
    success: boolean
    message?: string
}

/** 删除用户 */
export async function deleteAdminUser(username: string): Promise<void> {
    const data = await apiFetch<AdminUserMutationResponse>(`/api/admin/users/${encodeURIComponent(username)}`, {
        method: 'DELETE',
    })

    if (!data.success) {
        throw new Error(data.message || '删除用户失败')
    }
}

/** 修改角色 */
export async function setAdminUserRole(username: string, role: string): Promise<void> {    await apiFetch<{ success: boolean }>(`/api/admin/users/${encodeURIComponent(username)}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
    })
}

/** 重置密码 */
export async function resetAdminUserPassword(username: string, password: string): Promise<void> {
    await apiFetch<{ success: boolean }>(`/api/admin/users/${encodeURIComponent(username)}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ password }),
    })
}

/** 更新用户资料(显示名;对齐原版 PATCH /api/admin/users/<id>/profile) */
export async function updateAdminUserProfile(userId: string, displayName: string): Promise<void> {
    await apiFetch<{ success: boolean }>(`/api/admin/users/${encodeURIComponent(userId)}/profile`, {
        method: 'PATCH',
        body: JSON.stringify({ display_name: displayName }),
    })
}

/** 用户可用模型列表(对齐原版 GET /api/admin/user/models) */
export interface UserModelEntry {
    id: string
    name: string
    provider: string
    status: string
    is_blocked: boolean
}

export async function fetchUserModels(username: string): Promise<UserModelEntry[]> {
    const data = await apiFetch<{ success: boolean; models?: UserModelEntry[] }>(
        `/api/admin/user/models?username=${encodeURIComponent(username)}`
    )

    return Array.isArray(data.models) ? data.models : []
}

/** 更新用户模型黑名单(对齐原版 POST /api/admin/user/models/update) */
export async function updateUserModelBlacklist(username: string, blockedModels: string[]): Promise<void> {
    await apiFetch<{ success: boolean }>('/api/admin/user/models/update', {
        method: 'POST',
        body: JSON.stringify({ username, blocked_models: blockedModels }),
    })
}
