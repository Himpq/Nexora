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

        <div class="header-center" id="conversationTitle">
            {{ view === 'files' ? 'Files' : (view === 'workspaces' ? 'Workspaces' : (view === 'knowledge' ? (knowledgeTitle || 'Knowledge') : (view === 'knowledge-mgmt' ? '知识库管理' : conversationTitle))) }}
        </div>

        <div class="header-right">
            <!-- 右侧工具常驻,视图覆盖时仍可打开聊天快捷侧栏。 -->
                <button class="btn-icon notes-toggle-btn" id="toggleNotesPanel" title="笔记" @click="emit('open-notes')">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M4 3h12a2 2 0 0 1 2 2v12l-4 4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"></path>
                        <path d="M14 21v-4h4"></path>
                        <line x1="8" y1="9" x2="14" y2="9"></line>
                        <line x1="8" y1="13" x2="14" y2="13"></line>
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
                        <i class="fa-regular fa-bell" aria-hidden="true"></i>
                        <span class="chat-notification-badge" :hidden="notificationUnread <= 0">{{ notificationBadgeText }}</span>
                    </button>

                    <NotificationPanel
                        @unread-change="handleUnreadChange"
                    />
                </div>

                <button class="btn-icon" id="toggleFilePanel" title="云端文件" @click="emit('open-files')">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                    </svg>
                </button>

                <button class="btn-icon" id="toggleKnowledgePanel" title="Knowledge Base" @click="emit('open-knowledge')">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                    </svg>
                </button>
        </div>
    </header>
</template>

<script setup lang="ts">
    import { computed, ref } from 'vue'

    import type { ModelItem } from '@/api/config'
    import { useConversationStore } from '@/stores/conversation'
    import { closePopover, openPopover, overlay } from '@/ui/overlay'

    import ModelSelect from './ModelSelect.vue'
    import NotificationPanel from './NotificationPanel.vue'

    const emit = defineEmits<{
        'toggle-sidebar': []
        'open-notes': []
        'open-files': []
        'open-knowledge': []
        /** 从覆盖视图返回聊天 */
        'back-to-chat': []
    }>()

    const props = withDefaults(defineProps<{
        models: ModelItem[]
        knowledgeTitle?: string
        /** 当前视图:chat(默认) | files(文件中心) | workspaces | knowledge(正文编辑) | knowledge-mgmt(知识库管理) */
        view?: 'chat' | 'files' | 'workspaces' | 'knowledge' | 'knowledge-mgmt'
    }>(), {
        view: 'chat',
        knowledgeTitle: '',
    })

    const conversationStore = useConversationStore()

    const notificationBtnRef = ref<HTMLElement | null>(null)

    /** 未读数(由 NotificationPanel 上报) */
    const notificationUnread = ref(0)

    /** 面板打开状态:由浮层协调器管理 */
    const notificationOpen = computed(() => overlay.popover === 'notification')

    /** 徽标文本(对齐原版:>99 显示 99+) */
    const notificationBadgeText = computed(() => {
        return notificationUnread.value > 99 ? '99+' : String(notificationUnread.value)
    })

    /** 铃铛切换:打开时注册容器用于外部点击关闭,关闭时释放 */
    function toggleNotification(): void {
        if (notificationOpen.value) {
            closePopover('notification')

            return
        }

        openPopover('notification', notificationBtnRef.value)
    }

    /** 未读数变化同步到徽标 */
    function handleUnreadChange(count: number): void {
        notificationUnread.value = count
    }

    const conversationTitle = computed(() => {
        // 对齐原版:新建空白会话(欢迎屏)时标题为 New Chat
        return conversationStore.currentConversation?.title || 'New Chat'
    })
</script>
