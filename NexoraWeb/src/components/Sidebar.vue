<!--
    Sidebar.vue — 侧边栏(逐像素复刻原版 DOM 结构)

    结构(与原版 chat.html 一致):
      sidebar-header(品牌 tabs) + sidebar-action(工具栏) +
      sidebar-content(会话列表) + sidebar-footer(用户区)
-->

<template>
    <nav class="sidebar" id="sidebar" :class="{ collapsed }">
        <div class="sidebar-header">
            <div class="sidebar-brand-tabs" id="sidebarBrandTabs">
                <button type="button" class="sidebar-brand-tab active" data-sidebar-mode="nexora" aria-pressed="true">
                    <span class="logo">Nexora<span class="dot"></span></span>
                </button>
            </div>
            <button class="btn-icon" id="toggleSidebarMobile" title="折叠侧边栏" @click="emit('toggle-mobile')">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>

        <div class="sidebar-action">
            <div class="sidebar-toolbar" aria-label="顶部工具栏">
                <button id="newChatBtn" class="toolbar-item" type="button" @click="handleNewChat">
                    <i class="fa-solid fa-plus" aria-hidden="true"></i>
                    <span>New Chat</span>
                </button>
                <button id="workspacesBtn" class="toolbar-item" type="button" @click="emit('open-workspaces')">
                    <i class="fa-regular fa-window-maximize" aria-hidden="true"></i>
                    <span>Workspaces</span>
                </button>
                <button id="fileCenterBtn" class="toolbar-item" type="button" @click="emit('open-files')">
                    <i class="fa-regular fa-folder-open" aria-hidden="true"></i>
                    <span>Files</span>
                </button>
                <button id="knowledgeMgmtBtn" class="toolbar-item" type="button" @click="emit('open-knowledge-mgmt')">
                    <i class="fa-solid fa-book" aria-hidden="true"></i>
                    <span>Knowledge</span>
                </button>
            </div>
        </div>

        <div class="sidebar-content" id="conversationList">
            <div
                v-for="row in store.branchRows"
                :key="row.conversation.id"
                class="conversation-item"
                :class="{
                    active: row.conversation.id === store.currentId,
                    'is-streaming': isStreamingItem(row.conversation.id),
                    'conversation-branch-item': isVisibleBranch(row.conversation),
                }"
                :data-conversation-id="row.conversation.id"
                :data-pin="isPinned(row.conversation.id) ? '1' : '0'"
                :style="branchOffsetStyle(row)"
                :title="branchTooltip(row.conversation)"
                @click="handleOpen(row.conversation.id)"
                @contextmenu.prevent="handleContextMenu($event, row.conversation)"
            >
                <span class="title" :title="row.conversation.title">
                    <i
                        v-if="isVisibleBranch(row.conversation)"
                        class="fa-solid fa-code-branch conversation-branch-icon"
                        aria-hidden="true"
                    ></i>
                    <i
                        v-if="isPinned(row.conversation.id)"
                        class="fa-solid fa-thumbtack conversation-pin-icon"
                        aria-hidden="true"
                    ></i>
                    {{ row.conversation.title }}
                </span>
                <span class="conversation-item-right">
                    <!-- 原版 hover 删除按钮(.delete-chat,默认隐藏,hover 显示) -->
                    <button
                        class="btn-icon-small delete-chat"
                        type="button"
                        title="删除会话"
                        aria-label="删除会话"
                        @click.stop="handleDelete(row.conversation)"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                    <span
                        v-if="isStreamingItem(row.conversation.id)"
                        class="conversation-stream-indicator is-loading"
                        title="模型正在回复"
                        aria-hidden="true"
                    >
                        <i class="fa-solid fa-circle-notch fa-spin"></i>
                    </span>
                </span>
            </div>

            <div v-if="!store.conversations.length" class="sidebar-empty">
                暂无会话
            </div>
        </div>

        <!-- 会话右键菜单(对齐原版 pin-context-menu;显示由浮层协调器管理) -->
        <ContextMenu
            ref="contextMenuRef"
            target-type="conversation"
            :conversation-id="contextMenu.conversationId"
            :title="contextMenu.title"
            :pinned="contextMenu.pinned"
            :branch="contextMenu.branch"
            @pin-changed="handlePinChanged"
            @title-changed="handleTitleChanged"
            @view-branch-source="handleViewBranchSource"
        />

        <div class="sidebar-footer">
            <div class="user-profile-button" id="usernameBtn" @click.stop="toggleUserMenu">
                <div
                    class="avatar-circle"
                    id="sidebar-avatar"
                    :class="{ 'has-image': userStore.avatarUrl }"
                    :style="avatarStyle"
                    :aria-label="userStore.username || 'avatar'"
                >
                    <span v-if="!userStore.avatarUrl">{{ avatarChar }}</span>
                </div>
                <div class="user-info">
                    <span class="user-name profile-name">{{ userStore.username || 'User' }}</span>
                </div>
                <i class="fa-solid fa-ellipsis" aria-hidden="true"></i>

                <div ref="userMenuRef" class="user-menu" id="userMenu" :class="{ active: userMenuOpen }" @click.stop>
                    <a href="/rank" class="menu-item" @click.prevent.stop="handleMenuAction('rank')">
                        <i class="fa-solid fa-gear" aria-hidden="true"></i>
                        <span>模型榜单</span>
                    </a>
                    <a href="#" class="menu-item" @click.prevent.stop="handleMenuAction('settings')">
                        <i class="fa-solid fa-gear" aria-hidden="true"></i>
                        <span>设置</span>
                    </a>
                    <a href="#" class="menu-item" @click.prevent.stop="handleMenuAction('timeline')">
                        <i class="fa-solid fa-timeline" aria-hidden="true"></i>
                        <span>时间线</span>
                    </a>
                    <a href="#" class="menu-item" @click.prevent.stop="handleMenuAction('trash')">
                        <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
                        <span>回收站</span>
                    </a>
                    <div class="menu-divider"></div>
                    <a href="#" class="menu-item logout" @click.prevent.stop="handleMenuAction('logout')">
                        <i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i>
                        <span>退出</span>
                    </a>
                </div>
            </div>
        </div>
    </nav>
</template>

<script setup lang="ts">
    import { computed, ref } from 'vue'

    import { useRouter } from 'vue-router'

    import type { ConversationBranch, ConversationSummary } from '@/api/conversations'
    import type { ConversationBranchRow } from '@/stores/conversation'
    import { showConfirm } from '@/stores/confirm'
    import { useConversationStore } from '@/stores/conversation'
    import { showError, showToast } from '@/stores/notify'
    import { useUserStore } from '@/stores/user'
    import { closePopover, openPopover, overlay } from '@/ui/overlay'

    import ContextMenu from './ContextMenu.vue'

    const emit = defineEmits<{
        'toggle-mobile': []
        'open-settings': []
        'open-chat': []
        'open-workspaces': []
        'open-files': []
        'open-knowledge-mgmt': []
        'open-trash': []
        'open-timeline': []
        'view-branch-source': [parentConversationId: string, messageIndex: number]
    }>()

    const props = defineProps<{
        collapsed?: boolean
    }>()

    const router = useRouter()
    const store = useConversationStore()
    const userStore = useUserStore()

    const userMenuRef = ref<HTMLElement | null>(null)

    /** 用户菜单状态:由浮层协调器管理(自动外部关闭 + 互斥) */
    const userMenuOpen = computed(() => overlay.popover === 'user-menu')

    /** 头像首字符(与原版 {{ username[0] | upper }} 一致) */
    const avatarChar = computed(() => {
        const name = userStore.username || 'U'

        return name.charAt(0).toUpperCase()
    })

    /** 头像背景(对齐原版 updateSidebarUserProfile:有头像时用 background-image 显示) */
    const avatarStyle = computed(() => {
        if (!userStore.avatarUrl) {
            return undefined
        }

        return {
            backgroundImage: `url("${userStore.avatarUrl}")`,
        }
    })

    /** 会话是否置顶(原版 data-pin) */
    function isPinned(conversationId: string): boolean {
        const item = store.conversations.find((entry) => entry.id === conversationId)

        return !!item?.pin
    }

    /** 会话是否正在生成(原版 is-streaming 类) */
    function isStreamingItem(conversationId: string): boolean {
        return store.generating && conversationId === store.streamingConversationId
    }

    /** 是否为可见分支会话(有分支信息且非孤儿;对齐原版 visibleBranch) */
    function isVisibleBranch(conversation: ConversationSummary): boolean {
        const branch = readBranch(conversation)

        return !!branch && !isOrphanBranch(conversation)
    }

    /** 分支缩进样式(对齐原版 --conversation-branch-offset,深度上限 6) */
    function branchOffsetStyle(row: ConversationBranchRow): Record<string, string> | undefined {
        if (!isVisibleBranch(row.conversation)) {
            return undefined
        }

        return {
            '--conversation-branch-offset': `${Math.max(1, row.depth) * 14}px`,
        }
    }

    /** 分支悬停提示(对齐原版 row.title:分支自父会话的第 N 条消息) */
    function branchTooltip(conversation: ConversationSummary): string | undefined {
        const branch = readBranch(conversation)

        if (!branch || isOrphanBranch(conversation)) {
            return undefined
        }

        return `分支自会话 ${branch.parent_conversation_id} 的第 ${branch.parent_message_index + 1} 条消息`
    }

    /** 读取会话分支信息 */
    function readBranch(conversation: ConversationSummary): ConversationBranch | null {
        return conversation.branch && typeof conversation.branch === 'object' ? conversation.branch : null
    }

    /** 孤儿分支:父会话在列表中不存在(对齐原版 branchOrphan) */
    function isOrphanBranch(conversation: ConversationSummary): boolean {
        const branch = readBranch(conversation)

        if (!branch) {
            return false
        }

        return !store.conversations.some((entry) => entry.id === branch.parent_conversation_id)
    }

    async function handleNewChat(): Promise<void> {
        // New Chat 语义为回到聊天主视图(若当前停留在 Files/Workspaces 等视图则先返回)
        emit('open-chat')

        try {
            await store.newConversation()
        } catch (error) {
            showError(error instanceof Error ? error.message : '创建会话失败')
        }
    }

    async function handleOpen(conversationId: string): Promise<void> {
        // 点击会话 = 回到聊天主视图(若当前停留在 Files/Workspaces 等视图则先返回)
        emit('open-chat')

        try {
            await store.openConversation(conversationId)
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载会话失败')
        }
    }

    /** 删除会话(经自建确认小窗;由 hover 删除按钮触发) */
    async function handleDelete(item: ConversationSummary): Promise<void> {
        if (store.generating) {
            showToast('回复生成中,请先停止再操作', 'warning')

            return
        }

        const confirmed = await showConfirm({
            title: '删除会话',
            content: `确定删除会话「${item.title}」?此操作不可恢复。`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            await store.removeConversation(item.id)

            showToast('会话已删除', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '删除失败')
        }
    }

    /** 右键菜单:对齐原版 pin-context-menu(置顶/改名/归入工作区/查看分支处) */
    function handleContextMenu(event: MouseEvent, item: ConversationSummary): void {
        event.preventDefault()

        if (store.generating) {
            showToast('回复生成中,请先停止再操作', 'warning')

            return
        }

        contextMenu.value = {
            conversationId: item.id,
            title: item.title,
            pinned: isPinned(item.id),
            branch: readBranch(item) || undefined,
        }

        contextMenuRef.value?.open(event.clientX, event.clientY)
    }

    /** 会话右键菜单目标(坐标经 open(x, y) 传入,不进状态) */
    const contextMenu = ref({
        conversationId: '',
        title: '',
        pinned: false,
        branch: undefined as ConversationBranch | undefined,
    })

    const contextMenuRef = ref<InstanceType<typeof ContextMenu> | null>(null)

    /** 置顶状态变化:本地更新并重排 */
    function handlePinChanged(targetType: string, id: string, pinned: boolean): void {
        if (targetType === 'conversation') {
            store.setConversationPinLocal(id, pinned)
        }
    }

    /** 标题变化:本地更新 */
    function handleTitleChanged(conversationId: string, title: string): void {
        store.setConversationTitleLocal(conversationId, title)
    }

    /** 查看分支处:转发给父级打开父会话并跳转到分支消息(对齐原版 viewConversationBranchSourceFromContextMenu) */
    function handleViewBranchSource(branch: ConversationBranch): void {
        emit('view-branch-source', branch.parent_conversation_id, branch.parent_message_index)
    }

    async function handleLogout(): Promise<void> {
        // 跳转放在 finally:无论登出接口结果如何都必须离开聊天视图
        try {
            await userStore.logout()
        } finally {
            await router.replace('/login')
        }
    }

    /** 切换用户菜单(由浮层协调器统一管理打开/外部关闭/互斥) */
    function toggleUserMenu(): void {
        if (userMenuOpen.value) {
            closePopover('user-menu')

            return
        }

        openPopover('user-menu', userMenuRef.value)
    }

    /** 用户菜单动作(原版 userMenu 的菜单项) */
    function handleMenuAction(action: 'rank' | 'settings' | 'timeline' | 'trash' | 'logout'): void {
        closePopover('user-menu')

        if (action === 'rank') {
            // 模型榜单:跳转原版 /rank 页面(原版 userMenu 第一项)
            window.location.href = '/rank'

            return
        }

        if (action === 'settings') {
            emit('open-settings')

            return
        }

        if (action === 'timeline') {
            emit('open-timeline')

            return
        }

        if (action === 'trash') {
            emit('open-trash')

            return
        }

        void handleLogout()
    }

    defineExpose({ userMenuOpen })
</script>

<style scoped>
    /* 会话列表空态(原版无此元素,补一个最小样式) */
    .sidebar-empty {
        padding: 20px 16px;
        color: var(--text-sidebar, #a0a0a0);
        font-size: 13px;
        text-align: center;
    }
</style>
