<!--
    ChatHeader.vue — 顶栏(逐像素复刻原版 DOM 结构)

    结构(与原版 chat.html 一致):
      header-left(折叠按钮 + 模型选择) + header-center(会话标题) + header-right(笔记/通知/文件/知识库)
-->

<template>
    <header class="chat-header">
        <div class="header-left">
            <!-- 文件中心/Workspaces/知识库等覆盖视图:左侧仅返回按钮(对齐原版 closeFileCenterOrReturn) -->
            <template v-if="view !== 'chat'">
                <button class="btn-icon" title="Back" @click="emit('back-to-chat')">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                </button>
            </template>

            <template v-else>
                <button class="btn-icon" id="toggleSidebar" title="Toggle Sidebar" @click="emit('toggle-sidebar')">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="9" y1="3" x2="9" y2="21"></line>
                    </svg>
                </button>

                <ModelSelect :models="models" />
            </template>
        </div>

        <div class="header-center" id="conversationTitle" :title="centerTitleTooltip">
            {{ centerTitle }}
        </div>

        <div class="header-right">
            <!-- 右侧工具常驻,视图覆盖时仍可打开聊天快捷侧栏。 -->
                <button class="btn-icon notes-toggle-btn" id="toggleNotesPanel" title="笔记" @click="emit('open-notes')">
                    <!-- transform 为光学校正:原图形 y3..21 且重心偏左(cx≈10),归一到 y≈3.5..20.5、水平居中 -->
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <g transform="translate(2.5,0.7) scale(0.94)">
                            <path d="M4 3h12a2 2 0 0 1 2 2v12l-4 4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"></path>
                            <path d="M14 21v-4h4"></path>
                            <line x1="8" y1="9" x2="14" y2="9"></line>
                            <line x1="8" y1="13" x2="14" y2="13"></line>
                        </g>
                    </svg>
                </button>

                <div class="chat-notification-wrap">
                    <button
                        ref="notificationBtnRef"
                        class="btn-icon chat-notification-toggle"
                        id="toggleNotificationPanel"
                        title="通知"
                        :aria-expanded="notificationOpen"
                        @click.stop="toggleNotification"
                    >
                        <!-- 铃铛内联 SVG;transform 光学校正:缩放后圆顶质量偏上,累计下移校正视重心 -->
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <g transform="translate(1.3,3.3) scale(0.9)">
                                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                            </g>
                        </svg>
                        <span class="chat-notification-badge" :hidden="notificationUnread <= 0">{{ notificationBadgeText }}</span>
                    </button>

                    <NotificationPanel />
                </div>

                <!-- 顶栏按钮顺序对齐原版 chat.html:笔记 → 通知 → 邮件 → 云端文件 → Knowledge -->
                <div class="chat-mail-wrap">
                    <button
                        class="btn-icon chat-mail-toggle"
                        id="toggleMailCenter"
                        title="邮件"
                        :aria-expanded="mailOpen"
                        @click.stop="emit('open-mail')"
                    >
                        <!-- 信封下半留白多、视觉偏高,累计下移 1.9 校正 -->
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <g transform="translate(0,1.9)">
                                <rect x="3" y="5" width="18" height="14" rx="2"></rect>
                                <path d="m3 7 9 6 9-6"></path>
                            </g>
                        </svg>
                        <span class="chat-mail-badge" :hidden="mailUnread <= 0">{{ mailBadgeText }}</span>
                    </button>
                </div>

                <button class="btn-icon" id="toggleFilePanel" title="云端文件" @click="emit('open-files')">
                    <!-- transform 光学校正:原纸张 y2..22 偏长,收进统一视觉高度带 -->
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <g transform="translate(1.8,1.8) scale(0.85)">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                        </g>
                    </svg>
                </button>

                <button class="btn-icon" id="toggleKnowledgePanel" title="Knowledge Base" @click="emit('open-knowledge')">
                    <!-- 书本几何中心 cy≈11.5 偏上,下移 1.0 对齐视觉水平线 -->
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <g transform="translate(0,1)">
                            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                        </g>
                    </svg>
                </button>
        </div>
    </header>
</template>

<script setup lang="ts">
    import { computed, ref } from 'vue'

    import type { ModelItem } from '@/api/config'
    import { useConversationStore } from '@/stores/conversation'
    import { useMailStore } from '@/stores/mail'
    import { useNotificationStore } from '@/stores/notification'
    import { closePopover, openPopover, overlay } from '@/ui/overlay'

    import ModelSelect from './ModelSelect.vue'
    import NotificationPanel from './NotificationPanel.vue'

const emit = defineEmits<{
    'toggle-sidebar': []
    'open-notes': []
    'open-files': []
    'open-knowledge': []
    /** 打开/关闭邮件中心视图 */
    'open-mail': []
    /** 从覆盖视图返回聊天 */
    'back-to-chat': []
}>()

    const props = withDefaults(defineProps<{
        models: ModelItem[]
        knowledgeTitle?: string
        /** 当前视图:chat(默认) | files(文件中心) | workspaces | knowledge(正文编辑) | knowledge-mgmt(知识库管理) | mail(邮件中心) */
        view?: 'chat' | 'files' | 'workspaces' | 'knowledge' | 'knowledge-mgmt' | 'mail'
        /** 标题覆盖(如 Workspace 详情/共享对话标题);空串表示走视图默认标题 */
        overrideTitle?: string
        /** 覆盖标题的悬停说明(如「只读共享 · @owner」) */
        overrideTitleTooltip?: string
    }>(), {
        view: 'chat',
        knowledgeTitle: '',
        overrideTitle: '',
        overrideTitleTooltip: '',
    })

    const conversationStore = useConversationStore()
    const notificationStore = useNotificationStore()
    const mailStore = useMailStore()

    const notificationBtnRef = ref<HTMLElement | null>(null)

    /** 未读数(通知 store 唯一数据源:HTTP 拉取 + WSS 推送) */
    const notificationUnread = computed(() => notificationStore.unreadCount)

    /** 顶栏邮件红点(对齐原版:上次打开面板后新到的邮件数,非未读总数) */
    const mailUnread = computed(() => mailStore.newCount)

    /** 面板打开状态:由浮层协调器管理 */
    const notificationOpen = computed(() => overlay.popover === 'notification')

    /** 邮件视图打开状态(内容级视图,互斥由浮层协调器保证) */
    const mailOpen = computed(() => overlay.view === 'mail')

    /** 徽标文本(对齐原版:>99 显示 99+) */
    function badgeText(count: number): string {
        return count > 99 ? '99+' : String(count)
    }

    const notificationBadgeText = computed(() => badgeText(notificationUnread.value))

    const mailBadgeText = computed(() => badgeText(mailUnread.value))

    /** 铃铛切换:打开时注册容器用于外部点击关闭,关闭时释放 */
    function toggleNotification(): void {
        if (notificationOpen.value) {
            closePopover('notification')

            return
        }

        openPopover('notification', notificationBtnRef.value)
    }

    const conversationTitle = computed(() => {
        // 对齐原版:新建空白会话(欢迎屏)时标题为 New Chat
        return conversationStore.currentConversation?.title || 'New Chat'
    })

    /** 中央标题:覆盖值优先,否则按视图取默认(对齐原版 headerTitle 切换) */
    const VIEW_TITLES: Record<string, string> = {
        files: 'Files',
        workspaces: 'Workspaces',
        knowledge: '',
        'knowledge-mgmt': '知识库管理',
        mail: 'Mail',
    }

    const centerTitle = computed(() => {
        if (props.overrideTitle) {
            return props.overrideTitle
        }

        if (props.view === 'knowledge') {
            return props.knowledgeTitle || 'Knowledge'
        }

        return VIEW_TITLES[props.view] ?? conversationTitle.value
    })

    /** 覆盖标题的悬停说明(仅覆盖态生效,如共享对话标注归属) */
    const centerTitleTooltip = computed(() => (props.overrideTitle ? props.overrideTitleTooltip : ''))
</script>

<style scoped>
    /*
     * 通知入口视觉(原依赖原版 notification.css,GDDP 化后收进组件):
     *   - .header-right 相对定位:通知面板(np-panel)的绝对定位锚点
     *   - 徽标 / 展开态为铃铛按钮专属状态样式
     */

    .header-right {
        position: relative;
    }

    .chat-notification-toggle[aria-expanded="true"] {
        border-color: var(--color-border);
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }

    .chat-notification-badge {
        position: absolute;
        top: -4px;
        right: -5px;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        border: 2px solid var(--color-bg-page);
        border-radius: 999px;
        background: #dc2626;
        color: #ffffff;
        font-size: 10px;
        font-weight: 700;
        line-height: 12px;
        text-align: center;
    }

    .chat-notification-badge[hidden] {
        display: none;
    }
</style>
