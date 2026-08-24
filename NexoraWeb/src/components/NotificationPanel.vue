<!--
    NotificationPanel.vue — 通知面板(GDDP)

    设计:
      - 铃铛下拉面板,视觉自包含(scoped),不再依赖原版全局 notification.css
      - 开合动效对齐 GDDP 浮动面板规范(panels.css:opacity/transform 双向过渡)
      - 打开/关闭经浮层协调器(overlay.popover === 'notification'),互斥 + 外部点击关闭统一保证
      - 公告弹窗(管理员)走统一 ui/Modal.vue,级别选择复用通用 GDDP SettingSelect
-->

<template>
    <div class="np-panel" :class="{ open: isOpen }" role="dialog" aria-label="通知" :aria-hidden="!isOpen">
        <div class="np-head">
            <div class="np-head-text">
                <div class="np-title">通知</div>
                <div class="np-subtitle">{{ unreadCount > 0 ? `${unreadCount} 条未读` : '已全部读完' }}</div>
            </div>
            <button
                v-if="isAdmin"
                class="np-add"
                type="button"
                title="设置公告"
                aria-label="设置公告"
                @click="announcementOpen = true"
            >
                <i class="fa-solid fa-plus" aria-hidden="true"></i>
            </button>
        </div>

        <div v-if="loading && !loaded" class="np-state">正在加载...</div>
        <div v-else-if="error" class="np-state np-state-error">{{ error }}</div>
        <div v-else-if="!items.length" class="np-state">暂无通知</div>
        <div v-else class="np-list">
            <article
                v-for="item in items"
                :key="item.notification_id"
                class="np-item"
                :class="{ 'is-read': item.read }"
                :data-notification-id="item.notification_id"
            >
                <div class="np-icon" :class="`np-icon-${levelOf(item)}`">
                    <i class="fa-solid" :class="levelIcon(item.level)" aria-hidden="true"></i>
                </div>
                <div class="np-main">
                    <div class="np-item-title">{{ item.title }}</div>
                    <div v-if="item.content" class="np-content">{{ item.content }}</div>
                    <div v-if="metaText(item)" class="np-meta">{{ metaText(item) }}</div>
                </div>
                <div class="np-actions">
                    <button
                        v-if="!item.read"
                        class="np-action np-action-read"
                        type="button"
                        title="标记已读"
                        aria-label="标记已读"
                        @click="handleRead(item)"
                    >
                        <i class="fa-regular fa-envelope-open" aria-hidden="true"></i>
                    </button>
                    <button
                        v-if="canRemove(item)"
                        class="np-action np-action-remove"
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
            <label>级别</label>

            <!-- 级别下拉:复用通用 GDDP SettingSelect(禁用原生 select) -->
            <SettingSelect
                v-model="announcementLevel"
                :options="levelOptions"
                width="100%"
                popover-key="announcement-level"
            />
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
    import { createAnnouncement } from '@/api/notifications'
    import { showError, showToast } from '@/stores/notify'
    import { useNotificationStore } from '@/stores/notification'
    import { useUserStore } from '@/stores/user'
    import { overlay } from '@/ui/overlay'

    import Modal from '@/ui/Modal.vue'
    import SettingSelect from '@/ui/settings/SettingSelect.vue'

    const userStore = useUserStore()
    const notificationStore = useNotificationStore()

    /** 面板是否打开:由浮层协调器统一管理 */
    const isOpen = computed(() => overlay.popover === 'notification')

    /** 通知列表与未读数:唯一数据源为 notification store(HTTP 拉取 + WSS 推送双入口) */
    const items = computed(() => notificationStore.items)
    const unreadCount = computed(() => notificationStore.unreadCount)
    const loading = computed(() => notificationStore.loading)
    const loaded = computed(() => notificationStore.loaded)
    const error = ref('')

    /** 公告弹窗状态 */
    const announcementOpen = ref(false)
    const announcementTitle = ref('')
    const announcementContent = ref('')
    const announcementLevel = ref('info')

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

        error.value = ''

        try {
            await notificationStore.load()
        } catch (loadError) {
            error.value = loadError instanceof Error ? loadError.message : '通知加载失败'
        }
    }

    /** 标记已读:经 store 上报后端并统一更新状态 */
    async function handleRead(item: NotificationItem): Promise<void> {
        if (item.read) {
            return
        }

        try {
            await notificationStore.markRead(item.notification_id)
        } catch (readError) {
            showError(readError instanceof Error ? readError.message : '通知状态更新失败')
        }
    }

    /** 删除通知:经 store 上报后端并统一更新状态 */
    async function handleRemove(item: NotificationItem): Promise<void> {
        try {
            await notificationStore.remove(item.notification_id)
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
    /* ---------- 面板壳(GDDP 浮层:白底描边 + 开合动效,层级走令牌) ---------- */

    .np-panel {
        position: absolute;
        top: calc(100% + 10px);
        right: 0;
        width: 320px;
        min-height: 220px;
        max-width: calc(100vw - 24px);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        box-shadow: 0 18px 42px rgba(15, 23, 42, 0.16);
        z-index: var(--z-dropdown);
        overflow: hidden;
        visibility: hidden;
        opacity: 0;
        transform: translateY(10px) scale(0.97);
        pointer-events: none;
        transition:
            opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1),
            transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
            visibility 0.18s;
    }

    .np-panel.open {
        visibility: visible;
        opacity: 1;
        transform: none;
        pointer-events: auto;
    }

    /* ---------- 头部 ---------- */

    .np-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 14px 12px;
        border-bottom: 1px solid var(--color-border);
    }

    .np-title {
        color: var(--color-text-primary);
        font-size: 14px;
        font-weight: 700;
        line-height: 1.25;
    }

    .np-subtitle {
        margin-top: 3px;
        color: var(--color-text-secondary);
        font-size: 12px;
        line-height: 1.25;
    }

    .np-add {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        cursor: pointer;
        font-size: 13px;
        flex: 0 0 auto;
    }

    .np-add:hover {
        border-color: var(--color-text-secondary);
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }

    /* ---------- 列表 ---------- */

    .np-list {
        max-height: min(420px, calc(100vh - 160px));
        overflow: auto;
    }

    .np-item {
        display: grid;
        grid-template-columns: 32px minmax(0, 1fr) auto;
        gap: 10px;
        padding: 12px 12px;
        border-bottom: 1px solid var(--color-border);
        background: var(--color-bg-elevated);
        cursor: pointer;
    }

    .np-item:hover {
        background: var(--color-bg-sunken);
    }

    .np-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 8px;
        background: #e0f2fe;
        color: #0369a1;
        font-size: 13px;
    }

    .np-icon-success {
        background: var(--color-success-surface);
        color: var(--color-success-text);
    }

    .np-icon-warning {
        background: var(--color-warning-surface);
        color: var(--color-warning-text);
    }

    .np-icon-error {
        background: var(--color-danger-surface);
        color: var(--color-danger-text);
    }

    .np-main {
        min-width: 0;
    }

    .np-item-title {
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 700;
        line-height: 1.35;
        overflow-wrap: anywhere;
    }

    .np-item.is-read .np-item-title {
        color: var(--color-text-secondary);
        font-weight: 600;
    }

    .np-content {
        margin-top: 4px;
        color: var(--color-text-secondary);
        font-size: 12px;
        line-height: 1.45;
        overflow-wrap: anywhere;
    }

    .np-meta {
        margin-top: 6px;
        color: var(--color-text-secondary);
        font-size: 11px;
        line-height: 1.25;
        overflow-wrap: anywhere;
    }

    /* ---------- 条目操作(标记已读 / 删除) ---------- */

    .np-actions {
        display: flex;
        align-items: flex-start;
        justify-content: flex-end;
        gap: 6px;
        min-width: 28px;
    }

    .np-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: var(--color-text-secondary);
        cursor: pointer;
    }

    .np-action:hover {
        border-color: #d1d5db;
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }

    /* 全体公告删除:危险语义淡红反馈 */
    .np-action-remove.is-public-delete {
        color: var(--color-danger-text);
    }

    .np-action-remove.is-public-delete:hover {
        border-color: var(--color-danger-border);
        background: var(--color-danger-surface);
        color: var(--color-danger-text);
    }

    /* ---------- 加载 / 错误 / 空态 ---------- */

    .np-state {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 160px;
        padding: 20px;
        color: var(--color-text-secondary);
        font-size: 13px;
        text-align: center;
    }

    .np-state-error {
        color: var(--color-danger-text);
    }

    /* ---------- 公告弹窗表单 ---------- */

    .np-form-group {
        margin-bottom: 14px;
    }

    .np-form-group:last-child {
        margin-bottom: 0;
    }

    .np-form-group label {
        display: block;
        margin-bottom: 6px;
        color: var(--color-text-secondary);
        font-size: 13px;
        font-weight: 600;
    }

    .np-announcement-textarea {
        min-height: 140px;
        resize: vertical;
        line-height: 1.5;
    }

    /* ---------- 窄屏:锚定视口右上,避免左侧溢出屏幕 ---------- */

    @media (max-width: 980px) {
        .np-panel {
            position: fixed;
            top: 60px;
            right: 8px;
            width: min(320px, calc(100vw - 16px));
            min-height: 220px;
        }
    }
</style>
