/**
 * notifications.ts — 通知 API
 *
 * 对应后端路由(api/App/Observability/notification.py):
 *   GET  /api/notifications?limit=N            通知列表
 *   POST /api/notifications/<id>/read          标记已读
 *   POST /api/notifications/<id>/remove        删除通知
 *   POST /api/notifications/announcement       管理员发布公告
 */

import { apiFetch } from './client'

export interface NotificationItem {
    notification_id: string
    title: string
    content: string
    source: string
    date: number
    level: string
    read: boolean
    read_at?: number
    public?: boolean
    scope?: string
    meta?: Record<string, unknown>
}

export interface NotificationListResult {
    items: NotificationItem[]
    unread_count: number
    total: number
}

interface NotificationListResponse extends NotificationListResult {
    success: boolean
}

interface NotificationMutationResponse {
    success: boolean
    unread_count?: number
    item?: NotificationItem
}

/** 拉取当前用户通知列表(limit 对齐原版 loadNotifications 的 20) */
export async function listNotifications(limit = 20): Promise<NotificationListResult> {
    const data = await apiFetch<NotificationListResponse>(`/api/notifications?limit=${limit}`)

    return {
        items: Array.isArray(data.items) ? data.items : [],
        unread_count: Number(data.unread_count || 0),
        total: Number(data.total || 0),
    }
}

/** 标记单条通知已读,返回新的未读数 */
export async function markNotificationRead(notificationId: string): Promise<number> {
    const data = await apiFetch<NotificationMutationResponse>(
        `/api/notifications/${encodeURIComponent(notificationId)}/read`,
        { method: 'POST' }
    )

    return Number(data.unread_count || 0)
}

/** 删除单条通知,返回新的未读数 */
export async function removeNotification(notificationId: string): Promise<number> {
    const data = await apiFetch<NotificationMutationResponse>(
        `/api/notifications/${encodeURIComponent(notificationId)}/remove`,
        { method: 'POST' }
    )

    return Number(data.unread_count || 0)
}

/** 管理员发布公告 */
export async function createAnnouncement(options: {
    title: string
    content: string
    level: string
}): Promise<void> {
    await apiFetch<{ success: boolean }>('/api/notifications/announcement', {
        method: 'POST',
        body: JSON.stringify(options),
    })
}
