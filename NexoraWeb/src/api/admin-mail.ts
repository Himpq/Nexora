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

/** 拉取邮箱用户列表 */
export async function fetchMailUsers(): Promise<MailUser[]> {
    const data = await apiFetch<MailUsersResponse>('/api/admin/nexora-mail/users')

    return Array.isArray(data.users) ? data.users : []
}

/** 拉取邮件服务状态 */
export async function fetchMailStatus(): Promise<MailStatusResponse> {
    return apiFetch<MailStatusResponse>('/api/admin/nexora-mail/status')
}

interface MutationResponse {
    success: boolean
    message?: string
}

/** 创建邮箱用户(对齐原版 admin_nexora_mail_create_user) */
export async function createMailUser(options: {
    mail_username: string
    password: string
    permissions?: string[]
}): Promise<void> {
    const data = await apiFetch<MutationResponse>('/api/admin/nexora-mail/users', {
        method: 'POST',
        body: JSON.stringify(options),
    })

    if (!data.success) {
        throw new Error(data.message || '创建邮箱用户失败')
    }
}
