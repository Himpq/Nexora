<!--
    Sidebar.vue — 侧边栏(逐像素复刻原版 DOM 结构)

    结构(与原版 chat.html 一致):
      sidebar-header(品牌 tabs) + sidebar-action(工具栏) +
      sidebar-content(会话列表) + sidebar-footer(用户区)
-->

<template>
    <nav class="sidebar" id="sidebar" :class="{ collapsed }">
        <div class="sidebar-header">
            <div
                class="sidebar-brand-tabs"
                id="sidebarBrandTabs"
                :data-sidebar-brand-mode="brandMode"
            >
                <button
                    v-show="showNexoraTab"
                    id="sidebarBrandNexoraTab"
                    type="button"
                    class="sidebar-brand-tab"
                    :class="{ active: brandMode === 'nexora' }"
                    data-sidebar-mode="nexora"
                    :aria-pressed="brandMode === 'nexora' ? 'true' : 'false'"
                    @click="handleBrandClick('nexora')"
                >
                    <span class="logo">Nexora<span class="dot"></span></span>
                </button>
                <button
                    v-show="learningEnabled"
                    id="sidebarBrandLearningTab"
                    type="button"
                    class="sidebar-brand-tab"
                    :class="{ active: brandMode === 'learning' }"
                    data-sidebar-mode="learning"
                    :aria-pressed="brandMode === 'learning' ? 'true' : 'false'"
                    @click="handleBrandClick('learning')"
                >
                    <span class="sidebar-brand-learning-text"><i class="fa-solid fa-graduation-cap" aria-hidden="true" style="margin-right:6px"></i>Learning</span>
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
                <button id="newChatBtn" class="toolbar-item" type="button" @click="handlePrimaryAction">
                    <template v-if="isLearningMode">
                        <i
                            class="fa-solid"
                            :class="learningSidebarView === 'conversation' ? 'fa-arrow-left' : 'fa-graduation-cap'"
                            aria-hidden="true"
                        ></i>
                        <span>{{ learningSidebarView === 'conversation' ? '返回上一级' : 'New Learning' }}</span>
                    </template>
                    <template v-else>
                        <i class="fa-solid fa-plus" aria-hidden="true"></i>
                        <span>New Chat</span>
                    </template>
                </button>
                <template v-if="!isLearningMode">
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
                </template>
                <template v-else>
                    <!--
                        Learning 功能区入口(对齐原版 LEARNING_NAV_BUTTON_TABS):点击经 bridge
                        下发 dashboard 指令,iframe 回报 dashboard-state 驱动 is-active 高亮
                    -->
                    <template v-for="entry in learningNavEntries" :key="entry.key">
                        <div
                            v-if="entry.children"
                            class="learning-nav-group"
                            :class="{ 'is-open': openNavGroups.has(entry.key), 'is-active': isNavActive(entry.key) }"
                        >
                            <button
                                class="toolbar-item learning-nav-item"
                                type="button"
                                :aria-expanded="openNavGroups.has(entry.key) ? 'true' : 'false'"
                                @click="handleLearningNavGroup(entry)"
                            >
                                <i class="fa-solid" :class="entry.icon" aria-hidden="true"></i>
                                <span>{{ entry.label }}</span>
                                <i class="fa-solid fa-chevron-down learning-nav-caret" aria-hidden="true"></i>
                            </button>
                            <div v-show="openNavGroups.has(entry.key)" class="learning-nav-menu">
                                <button
                                    v-for="child in entry.children"
                                    :key="child.key"
                                    class="toolbar-item learning-nav-subitem"
                                    :class="{ 'is-active': isNavActive(child.key) }"
                                    type="button"
                                    @click="emitLearningNav(child.kind, child.key)"
                                >
                                    <i class="fa-solid" :class="child.icon" aria-hidden="true"></i>
                                    <span>{{ child.label }}</span>
                                </button>
                            </div>
                        </div>
                        <button
                            v-else
                            class="toolbar-item learning-nav-item"
                            :class="{ 'is-active': isNavActive(entry.key) }"
                            type="button"
                            @click="emitLearningNav('tab', entry.key)"
                        >
                            <i class="fa-solid" :class="entry.icon" aria-hidden="true"></i>
                            <span>{{ entry.label }}</span>
                        </button>
                    </template>
                </template>
            </div>
        </div>

        <div v-show="!isLearningMode" class="sidebar-content" id="conversationList">
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

        <!--
            Learning 侧栏面板(对齐原版 ensureLearningSidebarLayout 双视图):
            list = 学习会话列表(宿主 learning 作用域会话);conversation = 侧栏内对话,
            输入坞经 #learning-sidebar-input-slot 停靠(对齐原版 renderSidebarChat)
        -->
        <div v-show="isLearningMode" class="sidebar-content learning-sidebar-panel">
            <section
                v-show="learningSidebarView === 'list'"
                class="learning-sidebar-conversation-section"
                aria-label="Learning 对话列表"
            >
                <div class="learning-sidebar-conversation-header">
                    <span class="learning-sidebar-conversation-title">Learning 对话</span>
                    <span class="learning-sidebar-conversation-count">{{ learningSessions.length }}</span>
                </div>
                <div v-if="!learningSessions.length" class="learning-sidebar-empty">
                    暂无 Learning 对话
                </div>
                <div
                    v-for="session in learningSessions"
                    :key="session.id"
                    class="conversation-item learning-sidebar-conversation-item"
                    :class="{ active: session.id === store.currentId, 'is-streaming': isStreamingItem(session.id) }"
                    :data-conversation-id="session.id"
                    :data-pin="isPinned(session.id) ? '1' : '0'"
                    :title="session.title"
                    @click="emit('open-learning-conversation', session.id)"
                >
                    <span class="title">
                        <i
                            v-if="isPinned(session.id)"
                            class="fa-solid fa-thumbtack conversation-pin-icon"
                            aria-hidden="true"
                        ></i>
                        {{ session.title }}
                    </span>
                    <span class="conversation-item-right">
                        <span
                            v-if="isStreamingItem(session.id)"
                            class="conversation-stream-indicator is-loading"
                            title="模型正在回复"
                            aria-hidden="true"
                        >
                            <i class="fa-solid fa-circle-notch fa-spin"></i>
                        </span>
                        <button
                            class="btn-icon-small delete-chat"
                            type="button"
                            aria-label="删除 Learning 对话"
                            title="删除对话"
                            @click.stop="handleDelete(session)"
                        >
                            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                        </button>
                    </span>
                </div>
            </section>

            <section
                v-show="learningSidebarView === 'conversation'"
                class="learning-sidebar-chat"
                aria-label="Learning 对话"
            >
                <div ref="learningChatLogRef" class="learning-sidebar-chat-log" @scroll="handleChatLogScroll">
                    <div v-if="!store.messages.length" class="learning-sidebar-chat-empty">
                        结合当前学习上下文,开始提问…
                    </div>
                    <MessageItem
                        v-for="message in store.messages"
                        :key="message.index"
                        :message="message"
                        readonly
                        @open-image="emit('open-image', $event)"
                    />
                </div>
                <div class="learning-sidebar-chat-compose">
                    <div id="learning-sidebar-input-slot"></div>
                </div>
            </section>
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
    import { computed, nextTick, ref, watch } from 'vue'

    import { useRouter } from 'vue-router'

    import type { ConversationBranch, ConversationSummary } from '@/api/conversations'
    import type { ConversationBranchRow } from '@/stores/conversation'
    import { showConfirm } from '@/stores/confirm'
    import { useConversationStore } from '@/stores/conversation'
    import { showError, showToast } from '@/stores/notify'
    import { useUserStore } from '@/stores/user'
    import { closePopover, openPopover, overlay } from '@/ui/overlay'

    import ContextMenu from './ContextMenu.vue'
    import MessageItem from './MessageItem.vue'

    const emit = defineEmits<{
        'toggle-mobile': []
        'open-settings': []
        'open-chat': []
        'open-workspaces': []
        'open-files': []
        'open-knowledge-mgmt': []
        'open-trash': []
        'open-timeline': []
        'open-learning': []
        'learning-nav': [command: { kind: 'tab' | 'studio'; key: string }]
        'learning-new': []
        'open-learning-conversation': [conversationId: string]
        'update:learning-sidebar-view': [view: 'list' | 'conversation']
        'open-image': [url: string]
        'view-branch-source': [parentConversationId: string, messageIndex: number]
    }>()

    const props = defineProps<{
        collapsed?: boolean
        learningEnabled?: boolean
        brandMode?: 'nexora' | 'learning' | 'workspace'
        /** iframe dashboard 状态回报(view/side_tab),驱动学习功能区入口高亮 */
        learningNavState?: { view?: string; side_tab?: string }
        /** Learning 侧栏视图(list=会话列表 / conversation=侧栏内对话) */
        learningSidebarView?: 'list' | 'conversation'
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

    /** 品牌栏状态：徽标切换与下划线细节（对齐原版 sidebar_brand_navigation.js） */
    const learningEnabled = computed(() => props.learningEnabled ?? false)
    const brandMode = computed<'nexora' | 'learning' | 'workspace'>(() => props.brandMode ?? 'nexora')
    const isLearningMode = computed(() => brandMode.value === 'learning')
    const showNexoraTab = computed(() => brandMode.value !== 'workspace')

    // ── Learning 功能区入口(对齐原版 LEARNING_NAV_BUTTON_TABS + 学习导航分组) ──
    interface LearningNavChild {
        key: string
        label: string
        icon: string
        kind: 'tab' | 'studio'
    }

    interface LearningNavEntry {
        key: string
        label: string
        icon: string
        children?: LearningNavChild[]
    }

    const learningNavEntries: LearningNavEntry[] = [
        { key: 'progress', label: '学习进度', icon: 'fa-chart-line' },
        { key: 'materials', label: '课程', icon: 'fa-graduation-cap' },
        {
            key: 'push',
            label: '资源工作台',
            icon: 'fa-book-open',
            children: [
                { key: 'resource', label: '资源工作台', icon: 'fa-layer-group', kind: 'studio' },
                { key: 'video', label: '视频工作台', icon: 'fa-clapperboard', kind: 'studio' },
            ],
        },
        {
            key: 'questionBank',
            label: '模拟练习',
            icon: 'fa-pen-to-square',
            children: [
                { key: 'questionBankMistakes', label: '错题本', icon: 'fa-book-bookmark', kind: 'tab' },
            ],
        },
        { key: 'profileCenter', label: '画像中心', icon: 'fa-user-pen' },
        { key: 'feed', label: '动态中心', icon: 'fa-rss' },
    ]

    /** 分组展开态(key → 是否展开),原版默认折叠 */
    const openNavGroups = ref(new Set<string>())

    /**
     * 功能区入口高亮判定(对齐原版 handleDashboardStatePayload.matchesNavKey):
     * 独立视图按 view 匹配;dashboard 内功能区按 view==='dashboard' + side_tab 匹配
     */
    function isNavActive(tabKey: string): boolean {
        const state = props.learningNavState

        if (!state) {
            return false
        }

        const view = String(state.view || '').trim().toLowerCase()

        if (tabKey === 'materials') {
            return view === 'materials'
        }

        if (tabKey === 'profileCenter') {
            return view === 'profilecenter'
        }

        if (tabKey === 'questionBankMistakes') {
            return view === 'dashboard' && String(state.side_tab || '') === 'questionBank'
        }

        return view === 'dashboard' && String(state.side_tab || '') === tabKey
    }

    function emitLearningNav(kind: 'tab' | 'studio', key: string): void {
        emit('learning-nav', { kind, key })
    }

    function handleLearningNavGroup(entry: LearningNavEntry): void {
        // 分组父按钮 = 展开/收起子菜单 + 下发对应 dashboard tab(对齐原版父按钮绑定)
        const next = new Set(openNavGroups.value)

        if (next.has(entry.key)) {
            next.delete(entry.key)
        } else {
            next.add(entry.key)
        }

        openNavGroups.value = next
        emitLearningNav('tab', entry.key)
    }

    /** 学习会话列表(对齐原版 learningSidebarPanel:宿主 learning 作用域会话) */
    const learningSessions = computed<ConversationSummary[]>(() => {
        return store.conversations.filter((item) => item.conversation_mode === 'learning')
    })

    // ── 侧栏对话视图(对齐原版 renderSidebarChat):消息跟随底部,用户上滚即暂停 ──
    const learningChatLogRef = ref<HTMLElement | null>(null)
    const chatLogPinned = ref(true)

    function handleChatLogScroll(): void {
        const el = learningChatLogRef.value

        if (!el) return

        chatLogPinned.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    }

    /** 消息增长跟随底部(精简原版 atBottom 策略:仅在未上滚时贴底) */
    watch(
        () => [store.messages.length, store.messages[store.messages.length - 1]?.content?.length ?? 0],
        () => {
            if (!chatLogPinned.value) return

            void nextTick(() => {
                const el = learningChatLogRef.value

                if (el) {
                    el.scrollTop = el.scrollHeight
                }
            })
        }
    )

    /** 进入对话视图/切换会话:回到底部并恢复跟随 */
    watch(
        () => [props.learningSidebarView, store.currentId],
        () => {
            if (props.learningSidebarView !== 'conversation') return

            chatLogPinned.value = true

            void nextTick(() => {
                const el = learningChatLogRef.value

                if (el) {
                    el.scrollTop = el.scrollHeight
                }
            })
        },
        { immediate: true }
    )

    /** 主按钮三态(对齐原版 updateLearningSidebarPrimaryAction):New Chat / New Learning / 返回上一级 */
    function handlePrimaryAction(): void {
        if (!isLearningMode.value) {
            void handleNewChat()
            return
        }

        if (props.learningSidebarView === 'conversation') {
            emit('update:learning-sidebar-view', 'list')
            return
        }

        emit('learning-new')
    }

    function handleBrandClick(mode: 'nexora' | 'learning' | 'workspace'): void {
        if (mode === 'learning' && !learningEnabled.value) return
        if (mode === 'learning') {
            emit('open-learning')
            return
        }
        if (mode === 'nexora') {
            emit('open-chat')
            return
        }
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
