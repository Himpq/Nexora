<!--
    NotificationPanel.vue — 通知面板(对齐原版 notification.js renderPanel)

    设计:
      - 铃铛下拉面板,复用原版全局样式类(.chat-notification-popover / -item / -actions 等)
      - 打开/关闭经浮层协调器(overlay.popover === 'notification'),互斥 + 外部点击关闭统一保证
      - 公告弹窗(管理员)走统一 ui/Modal.vue,级别选择为自建下拉(禁用原生 select)
-->

<template>
    <div class="chat-notification-popover" :class="{ open: isOpen }" role="dialog" aria-label="通知">
        <div class="chat-notification-header">
            <div>
                <div class="chat-notification-title">通知</div>
                <div class="chat-notification-subtitle">{{ unreadCount > 0 ? `${unreadCount} 条未读` : '已全部读完' }}</div>
            </div>
            <button
                v-if="isAdmin"
                class="chat-notification-add"
                type="button"
                title="设置公告"
                aria-label="设置公告"
                @click="announcementOpen = true"
            >
                <i class="fa-solid fa-plus" aria-hidden="true"></i>
            </button>
        </div>

        <div v-if="loading && !loaded" class="chat-notification-state">正在加载...</div>
        <div v-else-if="error" class="chat-notification-state chat-notification-state-error">{{ error }}</div>
        <div v-else-if="!items.length" class="chat-notification-state">暂无通知</div>
        <div v-else class="chat-notification-list">
            <article
                v-for="item in items"
                :key="item.notification_id"
                class="chat-notification-item"
                :class="{ 'is-read': item.read }"
                :data-notification-id="item.notification_id"
            >
                <div class="chat-notification-icon" :class="`chat-notification-icon-${levelOf(item)}`">
                    <i class="fa-solid" :class="levelIcon(item.level)" aria-hidden="true"></i>
                </div>
                <div class="chat-notification-main">
                    <div class="chat-notification-item-title">{{ item.title }}</div>
                    <div v-if="item.content" class="chat-notification-content">{{ item.content }}</div>
                    <div v-if="metaText(item)" class="chat-notification-meta">{{ metaText(item) }}</div>
                </div>
                <div class="chat-notification-actions">
                    <button
                        v-if="!item.read"
                        class="chat-notification-action chat-notification-read"
                        type="button"
                        title="标记已读"
                        aria-label="标记已读"
                        @click="handleRead(item)"
                    >
                        <i class="fa-regular fa-envelope-open" aria-hidden="true"></i>
                    </button>
                    <button
                        v-if="canRemove(item)"
                        class="chat-notification-action chat-notification-remove"
                        :class="{ 'is-public-delete': isPublic(item) }"
                        type="button"
                        :title="isPublic(item) ? '删除全体公告' : '删除通知'"
                        :aria-label="isPublic(item) ? '删除全体公告' : '删除通知'"
                        @click="handleRemove(item)"
                    >
                        <i class="fa-solid" :class="isPublic(item) ? 'fa-trash-can' : 'fa-xmark'" aria-hidden="true"></i>
                    </button>
                </div>
            </article>
        </div>
    </div>

    <!-- 公告弹窗(仅管理员可见入口) -->
    <Modal
        :open="announcementOpen"
        title="设置公告"
        size="sm"
        @close="announcementOpen = false"
    >
        <div class="np-form-group">
            <label for="announcementTitleInput">标题</label>
            <input
                id="announcementTitleInput"
                v-model="announcementTitle"
                class="g-input"
                type="text"
                maxlength="120"
                placeholder="输入公告标题"
            >
        </div>
        <div class="np-form-group">
            <label for="announcementContentInput">内容</label>
            <textarea
                id="announcementContentInput"
                v-model="announcementContent"
                class="g-input np-announcement-textarea"
                maxlength="4000"
                rows="6"
                placeholder="输入公告内容"
            ></textarea>
        </div>
        <div class="np-form-group">
            <label for="announcementLevelSelect">级别</label>
            <div class="np-announcement-level-select">
                <button
                    id="announcementLevelSelectButton"
                    class="np-announcement-level-button"
                    type="button"
                    aria-haspopup="listbox"
                    :aria-expanded="levelMenuOpen"
                    @click="levelMenuOpen = !levelMenuOpen"
                >
                    <span>{{ levelLabel(announcementLevel) }}</span>
                    <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                </button>
<div
                    id="announcementLevelSelectMenu"
                    class="np-announcement-level-menu"
                    role="listbox"
                    aria-label="公告级别"
                    :hidden="!levelMenuOpen"
                >
                    <button
                        v-for="option in levelOptions"
                        :key="option.value"
                        type="button"
                        role="option"
                        :class="{ active: announcementLevel === option.value }"
                        :aria-selected="announcementLevel === option.value"
                        @click="announcementLevel = option.value; levelMenuOpen = false"
                    >
                        {{ option.label }}
                    </button>
                </div>
            </div>
        </div>
        <template #footer>
            <button class="g-btn g-btn-ghost" type="button" @click="announcementOpen = false">取消</button>
            <button class="g-btn g-btn-primary" type="button" @click="handlePublish">发布</button>
        </template>
    </Modal>
</template>

<script setup lang="ts">
    import { computed, ref, watch } from 'vue'

    import type { NotificationItem } from '@/api/notifications'
    import { createAnnouncement, listNotifications, markNotificationRead, removeNotification } from '@/api/notifications'
    import { showError, showToast } from '@/stores/notify'
    import { useUserStore } from '@/stores/user'
    import { overlay } from '@/ui/overlay'

    import Modal from '@/ui/Modal.vue'

    const emit = defineEmits<{
        /** 未读数变化(驱动铃铛 badge) */
        'unread-change': [count: number]
    }>()

    const userStore = useUserStore()

    /** 面板是否打开:由浮层协调器统一管理 */
    const isOpen = computed(() => overlay.popover === 'notification')

    const items = ref<NotificationItem[]>([])
    const unreadCount = ref(0)
    const loading = ref(false)
    const loaded = ref(false)
    const error = ref('')

    /** 公告弹窗状态 */
    const announcementOpen = ref(false)
    const announcementTitle = ref('')
    const announcementContent = ref('')
    const announcementLevel = ref('info')
    const levelMenuOpen = ref(false)

    const levelOptions = [
        { value: 'info', label: '普通' },
        { value: 'success', label: '完成' },
        { value: 'warning', label: '提醒' },
        { value: 'error', label: '重要' },
    ]

    /** 是否管理员(对齐原版 isCurrentUserAdmin:body.is-admin ↔ role === 'admin') */
    const isAdmin = computed(() => {
        return String(userStore.user?.role || '').toLowerCase() === 'admin'
    })

    /** 打开面板时加载一次(对齐原版 loadNotifications,limit=20) */
    watch(
        () => isOpen.value,
        (opened) => {
            if (opened) {
                void load()
            }
        }
    )

    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true
        error.value = ''

        try {
            const data = await listNotifications(20)

            items.value = data.items
            unreadCount.value = data.unread_count
            loaded.value = true

            emit('unread-change', unreadCount.value)
        } catch (loadError) {
            error.value = loadError instanceof Error ? loadError.message : '通知加载失败'
        } finally {
            loading.value = false
        }
    }

    /** 标记已读:本地更新 + 上报后端(对齐原版 markNotificationRead) */
    async function handleRead(item: NotificationItem): Promise<void> {
        if (item.read) {
            return
        }

        try {
            const nextUnread = await markNotificationRead(item.notification_id)

            items.value = items.value.map((row) => {
                if (row.notification_id !== item.notification_id) {
                    return row
                }

                return { ...row, read: true }
            })
            unreadCount.value = nextUnread

            emit('unread-change', unreadCount.value)
        } catch (readError) {
            showError(readError instanceof Error ? readError.message : '通知状态更新失败')
        }
    }

    /** 删除通知:本地移除 + 上报后端(对齐原版 removeNotification) */
    async function handleRemove(item: NotificationItem): Promise<void> {
        try {
            const nextUnread = await removeNotification(item.notification_id)

            items.value = items.value.filter((row) => row.notification_id !== item.notification_id)
            unreadCount.value = nextUnread

            emit('unread-change', unreadCount.value)
        } catch (removeError) {
            showError(removeError instanceof Error ? removeError.message : '删除通知失败')
        }
    }

    /** 发布公告(对齐原版 submitAnnouncement:校验后 POST announcement) */
    async function handlePublish(): Promise<void> {
        const title = announcementTitle.value.trim()

        if (!title) {
            showToast('请输入公告标题', 'warning')

            return
        }

        try {
            await createAnnouncement({
                title,
                content: announcementContent.value.trim(),
                level: announcementLevel.value,
            })

            showToast('公告已发布', 'success')
            announcementOpen.value = false
            announcementTitle.value = ''
            announcementContent.value = ''
            announcementLevel.value = 'info'

            await load()
        } catch (publishError) {
            showError(publishError instanceof Error ? publishError.message : '发布公告失败')
        }
    }

    /** 级别标签(对齐原版 getLevelLabel) */
    function levelLabel(level: string): string {
        const normalized = String(level || 'info').trim().toLowerCase()

        if (normalized === 'success') {
            return '完成'
        }

        if (normalized === 'warning') {
            return '提醒'
        }

        if (normalized === 'error') {
            return '重要'
        }

        return '普通'
    }

    /** 级别图标(对齐原版 renderLevelIcon) */
    function levelIcon(level: string): string {
        const normalized = String(level || 'info').toLowerCase()

        if (normalized === 'success') {
            return 'fa-circle-check'
        }

        if (normalized === 'warning') {
            return 'fa-triangle-exclamation'
        }

        if (normalized === 'error') {
            return 'fa-circle-exclamation'
        }

        return 'fa-bell'
    }

    /** 条目级别(默认 info) */
    function levelOf(item: NotificationItem): string {
        return String(item.level || 'info').toLowerCase()
    }

    /** 是否全体公告(对齐原版 isPublicNotification) */
    function isPublic(item: NotificationItem): boolean {
        const meta = item.meta && typeof item.meta === 'object' ? item.meta : {}

        return !!(
            item.public
            || String(item.scope || '').trim() === 'public'
            || meta.announcement === true
        )
    }

    /** 删除权限:非公告或管理员(对齐原版 canRemove) */
    function canRemove(item: NotificationItem): boolean {
        return !isPublic(item) || isAdmin.value
    }

    /** 来源 + 时间元信息(对齐原版 metaParts:source · time) */
    function metaText(item: NotificationItem): string {
        const parts = [item.source || '', formatNotificationTime(item.date)].filter(Boolean)

        return parts.join(' · ')
    }

    /** 相对时间(对齐原版 formatNotificationTime) */
    function formatNotificationTime(value: number): string {
        const numeric = Number(value || 0)

        if (!numeric) {
            return ''
        }

        const timeMs = numeric > 1000000000000 ? numeric : numeric * 1000
        const date = new Date(timeMs)

        if (Number.isNaN(date.getTime())) {
            return ''
        }

        const diffSeconds = Math.max(0, Math.floor((Date.now() - timeMs) / 1000))

        if (diffSeconds < 60) {
            return '刚刚'
        }

        if (diffSeconds < 3600) {
            return `${Math.floor(diffSeconds / 60)} 分钟前`
        }

        if (diffSeconds < 86400) {
            return `${Math.floor(diffSeconds / 3600)} 小时前`
        }

        if (diffSeconds < 604800) {
            return `${Math.floor(diffSeconds / 86400)} 天前`
        }

        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        })
    }
</script>

<style scoped>
    /* ---------- 公告弹窗表单(去原版 .form-group/.input-modern,走 GDDP 组件) ---------- */

    .np-form-group {
        margin-bottom: 14px;
    }

    .np-form-group:last-child {
        margin-bottom: 0;
    }

    .np-form-group label {
        display: block;
        margin-bottom: 6px;
        color: #334155;
        font-size: 13px;
        font-weight: 600;
    }

    .np-announcement-textarea {
        min-height: 140px;
        resize: vertical;
        line-height: 1.5;
    }

    /* ---------- 公告级别下拉 ---------- */

    .np-announcement-level-select {
        position: relative;
        width: 100%;
    }

    .np-announcement-level-button {
        width: 100%;
        height: 38px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: #ffffff;
        color: #111827;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 0 12px;
        font: inherit;
        font-size: 14px;
        cursor: pointer;
    }

    .np-announcement-level-button:hover,
    .np-announcement-level-button[aria-expanded="true"] {
        border-color: #9ca3af;
        background: #f9fafb;
    }

    .np-announcement-level-menu {
        position: absolute;
        left: 0;
        right: 0;
        top: calc(100% + 6px);
        z-index: 4800;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: #ffffff;
        box-shadow: 0 14px 28px rgba(15, 23, 42, 0.14);
        padding: 6px;
    }

    .np-announcement-level-menu[hidden] {
        display: none;
    }

    .np-announcement-level-menu button {
        width: 100%;
        height: 34px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: #111827;
        display: flex;
        align-items: center;
        padding: 0 10px;
        font: inherit;
        font-size: 14px;
        text-align: left;
        cursor: pointer;
    }

    .np-announcement-level-menu button:hover,
    .np-announcement-level-menu button.active {
        background: #f3f4f6;
    }
</style>
