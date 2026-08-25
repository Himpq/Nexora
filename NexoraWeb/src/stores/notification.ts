/**
 * notification.ts — 通知状态
 *
 * 职责:
 *   - 通知列表 / 未读数的唯一数据源(HTTP 拉取 + WSS 推送双入口,按 id 幂等合入)
 *   - 已读 / 删除操作经 API 上报,响应结果统一经 apply* 写回本 store
 *
 * 数据口径:
 *   - unread_count 以服务端推送/响应值为权威,前端不做本地推算
 */

import { defineStore } from 'pinia'

import type { NotificationItem } from '@/api/notifications'
import { listNotifications, markNotificationRead, removeNotification } from '@/api/notifications'

interface NotificationState {
    items: NotificationItem[]
    unreadCount: number
    loading: boolean
    loaded: boolean
}

/** 将服务端通知记录规范化为前端统一结构(字段缺失时取安全默认值) */
function normalizeNotificationItem(raw: Record<string, unknown>): NotificationItem {
    return {
        notification_id: String(raw.notification_id || ''),
        title: String(raw.title || ''),
        content: String(raw.content || ''),
        source: String(raw.source || ''),
        date: Number(raw.date || 0),
        level: String(raw.level || 'info'),
        read: Boolean(raw.read),
        read_at: raw.read_at ? Number(raw.read_at) : undefined,
        public: Boolean(raw.public),
        scope: raw.scope ? String(raw.scope) : undefined,
        meta: raw.meta && typeof raw.meta === 'object' ? (raw.meta as Record<string, unknown>) : undefined,
    }
}

/** 规范化 notification_* 推送载荷(item + 服务端权威未读数) */
function normalizeEventPayload(raw: unknown): { item: NotificationItem; unreadCount: number } {
    const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const itemRaw = data.item && typeof data.item === 'object' ? (data.item as Record<string, unknown>) : {}

    return {
        item: normalizeNotificationItem(itemRaw),
        unreadCount: Math.max(0, Number(data.unread_count || 0)),
    }
}

export const useNotificationStore = defineStore('notification', {
    state: (): NotificationState => ({
        items: [],
        unreadCount: 0,
        loading: false,
        loaded: false,
    }),

    actions: {
        /** 拉取通知列表(打开面板 / 页面挂载时调用) */
        async load(): Promise<void> {
            if (this.loading) {
                return
            }

            this.loading = true

            try {
                const data = await listNotifications(20)

                this.items = data.items
                this.unreadCount = data.unread_count
                this.loaded = true
            } finally {
                this.loading = false
            }
        },

        /** 合入 notification_created 推送:头部插入,按 id 去重保证重复推送幂等 */
        applyCreated(raw: unknown): void {
            const { item, unreadCount } = normalizeEventPayload(raw)

            if (!item.notification_id) {
                return
            }

            if (!this.items.some((row) => row.notification_id === item.notification_id)) {
                this.items.unshift(item)
            }

            this.unreadCount = unreadCount
        },

        /** 合入 notification_read 推送:按 id 标记已读 */
        applyRead(raw: unknown): void {
            const { item, unreadCount } = normalizeEventPayload(raw)

            if (!item.notification_id) {
                return
            }

            this.items = this.items.map((row) => {
                if (row.notification_id !== item.notification_id) {
                    return row
                }

                return { ...row, read: true, read_at: item.read_at }
            })
            this.unreadCount = unreadCount
        },

        /** 合入 notification_removed 推送:按 id 移除 */
        applyRemoved(raw: unknown): void {
            const { item, unreadCount } = normalizeEventPayload(raw)

            if (!item.notification_id) {
                return
            }

            this.items = this.items.filter((row) => row.notification_id !== item.notification_id)
            this.unreadCount = unreadCount
        },

        /** 标记已读:上报后端并将响应结果写回 store */
        async markRead(notificationId: string): Promise<void> {
            const result = await markNotificationRead(notificationId)

            this.applyRead({
                item: result.item,
                unread_count: result.unreadCount,
            })
        },

        /** 删除通知:上报后端并将响应结果写回 store */
        async remove(notificationId: string): Promise<void> {
            const result = await removeNotification(notificationId)

            this.applyRemoved({
                item: result.item,
                unread_count: result.unreadCount,
            })
        },
    },
})
