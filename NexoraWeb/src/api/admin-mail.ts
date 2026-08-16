/**
 * admin-mail.ts — 管理员:邮箱用户管理 API
 *
 * 对应后端路由:
 *   GET /api/admin/nexora-mail/status   服务状态
 *   GET /api/admin/nexora-mail/users    邮箱用户列表
 */

import { apiFetch } from './client'

export interface MailUser {
    username: string
    permissions?: string[]
    path?: string
    [key: string]: unknown
}

interface MailUsersResponse {
    success: boolean
    users?: MailUser[]
    group?: string
}

interface MailStatusResponse {
    success: boolean
    enabled?: boolean
    connected?: boolean
    default_group?: string
    service_url?: string
    [key: string]: unknown
}

/** 拉取邮箱用户列表(支持分组) */
export async function fetchMailUsers(group = ''): Promise<MailUser[]> {
    const params = group ? `?group=${encodeURIComponent(group)}` : ''
    const data = await apiFetch<MailUsersResponse>(`/api/admin/nexora-mail/users${params}`)

    return Array.isArray(data.users) ? data.users : []
}

/** 拉取邮件服务状态 */
export async function fetchMailStatus(): Promise<MailStatusResponse> {
    return apiFetch<MailStatusResponse>('/api/admin/nexora-mail/status')
}

/** 拉取邮箱分组列表 */
export async function fetchMailGroups(): Promise<string[]> {
    const data = await apiFetch<{ success: boolean; groups?: string[] }>('/api/admin/nexora-mail/groups')

    return Array.isArray(data.groups) ? data.groups : []
}

interface MutationResponse {
    success: boolean
    message?: string
}

/** 创建邮箱用户(对齐原版 admin_nexora_mail_create_user:含 group) */
export async function createMailUser(options: {
    mail_username: string
    password: string
    permissions?: string[]
    group?: string
}): Promise<void> {
    const data = await apiFetch<MutationResponse>('/api/admin/nexora-mail/users', {
        method: 'POST',
        body: JSON.stringify(options),
    })

    if (!data.success) {
        throw new Error(data.message || '创建邮箱用户失败')
    }
}

/** 重置邮箱用户密码(对齐原版 PATCH /groups/<group>/users/<user>/password) */
export async function resetMailUserPassword(group: string, username: string, password: string): Promise<void> {
    const data = await apiFetch<MutationResponse>(
        `/api/admin/nexora-mail/groups/${encodeURIComponent(group)}/users/${encodeURIComponent(username)}/password`,
        { method: 'PATCH', body: JSON.stringify({ password }) }
    )

    if (!data.success) {
        throw new Error(data.message || '重置密码失败')
    }
}

/** 删除邮箱用户(对齐原版 DELETE /groups/<group>/users/<user>) */
export async function deleteMailUser(group: string, username: string): Promise<void> {
    const data = await apiFetch<MutationResponse>(
        `/api/admin/nexora-mail/groups/${encodeURIComponent(group)}/users/${encodeURIComponent(username)}`,
        { method: 'DELETE' }
    )

    if (!data.success) {
        throw new Error(data.message || '删除邮箱用户失败')
    }
}
