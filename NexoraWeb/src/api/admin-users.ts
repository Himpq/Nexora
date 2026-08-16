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

/** 删除用户 */
export async function deleteAdminUser(username: string): Promise<void> {
    await apiFetch<{ success: boolean }>(`/api/admin/users/${encodeURIComponent(username)}`, {
        method: 'DELETE',
    })
}

/** 修改角色 */
export async function setAdminUserRole(username: string, role: string): Promise<void> {
    await apiFetch<{ success: boolean }>(`/api/admin/users/${encodeURIComponent(username)}/role`, {
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
