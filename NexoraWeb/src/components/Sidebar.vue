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
                <button
                    v-show="courseAvailable && brandMode !== 'nexora'"
                    id="sidebarBrandWorkspaceTab"
                    type="button"
                    class="sidebar-brand-tab sidebar-brand-tab-workspace"
                    :class="{ active: brandMode === 'workspace' }"
                    data-sidebar-mode="workspace"
                    :aria-pressed="brandMode === 'workspace' ? 'true' : 'false'"
                    @click="handleBrandClick('workspace')"
                >
                    <span class="sidebar-brand-workspace-text">Workspace</span>
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
                <!-- 课程 Workspace 接管时工具栏整体让位(对齐原版 newChatBtn/learning-nav 隐藏) -->
                <button v-if="!courseModeOn" id="newChatBtn" class="toolbar-item" type="button" @click="handlePrimaryAction">
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
                <!--
                    Learning 功能区入口仅列表视图可见(对齐原版 syncLearningSidebarNavigationVisibility:
                    navVisible = learning && view==='list',对话视图只保留返回按钮 + 侧栏聊天);
                    点击经 bridge 下发 dashboard 指令,iframe 回报 dashboard-state 驱动高亮
                -->
                <template v-else-if="learningSidebarView === 'list' && !courseModeOn">
                    <button
                        id="learningProgressBtn"
                        class="toolbar-item learning-nav-item"
                        :class="{ 'is-active': isNavActive('progress') }"
                        type="button"
                        @click="emitLearningNav('tab', 'progress')"
                    >
                        <i class="fa-solid fa-chart-line" aria-hidden="true"></i>
                        <span>课程进度</span>
                    </button>
                    <button
                        id="learningCoursesBtn"
                        class="toolbar-item learning-nav-item"
                        :class="{ 'is-active': isNavActive('materials') }"
                        type="button"
                        @click="emitLearningNav('tab', 'materials')"
                    >
                        <i class="fa-solid fa-graduation-cap" aria-hidden="true"></i>
                        <span>课程列表</span>
                    </button>
                    <div
                        id="learningResourcesGroup"
                        class="nexoracode-sidebar-project learning-resource-nav-group learning-nav-item"
                        :class="{ 'is-collapsed': !openNavGroups.has('push'), 'is-active': isNavActive('push') }"
                    >
                        <div class="nexoracode-sidebar-project-row learning-resource-nav-row">
                            <button
                                id="learningResourcesBtn"
                                class="nexoracode-sidebar-project-main learning-resource-nav-main"
                                type="button"
                                @click="emitLearningNav('tab', 'push')"
                            >
                                <i class="fa-solid fa-book-open nexoracode-sidebar-project-icon" aria-hidden="true"></i>
                                <span class="nexoracode-sidebar-project-name">学习资源</span>
                            </button>
                            <span class="nexoracode-sidebar-actions">
                                <button
                                    class="nexoracode-sidebar-icon-btn nexoracode-sidebar-caret-btn learning-resource-nav-toggle"
                                    type="button"
                                    aria-label="展开学习资源工作台"
                                    title="展开学习资源工作台"
                                    @click="toggleNavGroup('push')"
                                >
                                    <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                                </button>
                            </span>
                        </div>
                        <div class="nexoracode-sidebar-project-conversations learning-resource-studio-menu">
                            <div class="nexoracode-sidebar-project-conversations-inner">
                                <button class="learning-resource-studio-item" type="button" @click="emitLearningNav('studio', 'resource')">
                                    <i class="fa-solid fa-layer-group" aria-hidden="true"></i>
                                    <span>学习资源工作台</span>
                                </button>
                                <button class="learning-resource-studio-item" type="button" @click="emitLearningNav('studio', 'video')">
                                    <i class="fa-solid fa-clapperboard" aria-hidden="true"></i>
                                    <span>视频工作台</span>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div
                        id="learningPracticeGroup"
                        class="nexoracode-sidebar-project learning-resource-nav-group learning-nav-item"
                        :class="{ 'is-collapsed': !openNavGroups.has('questionBank'), 'is-active': isNavActive('questionBank') }"
                    >
                        <div class="nexoracode-sidebar-project-row learning-resource-nav-row">
                            <button
                                id="learningPracticeBtn"
                                class="nexoracode-sidebar-project-main learning-resource-nav-main"
                                type="button"
                                @click="emitLearningNav('tab', 'questionBank')"
                            >
                                <i class="fa-solid fa-pen-to-square nexoracode-sidebar-project-icon" aria-hidden="true"></i>
                                <span class="nexoracode-sidebar-project-name">模拟练习</span>
                            </button>
                            <span class="nexoracode-sidebar-actions">
                                <button
                                    class="nexoracode-sidebar-icon-btn nexoracode-sidebar-caret-btn learning-resource-nav-toggle"
                                    type="button"
                                    aria-label="展开模拟练习"
                                    title="展开模拟练习"
                                    @click="toggleNavGroup('questionBank')"
                                >
                                    <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                                </button>
                            </span>
                        </div>
                        <div class="nexoracode-sidebar-project-conversations learning-resource-studio-menu">
                            <div class="nexoracode-sidebar-project-conversations-inner">
                                <button class="learning-resource-studio-item" type="button" @click="emitLearningNav('tab', 'questionBankMistakes')">
                                    <i class="fa-solid fa-book-bookmark" aria-hidden="true"></i>
                                    <span>错题本</span>
                                </button>
                            </div>
                        </div>
                    </div>
                    <button
                        id="learningProfileBtn"
                        class="toolbar-item learning-nav-item"
                        :class="{ 'is-active': isNavActive('profileCenter') }"
                        type="button"
                        @click="emitLearningNav('tab', 'profileCenter')"
                    >
                        <i class="fa-solid fa-user-pen" aria-hidden="true"></i>
                        <span>画像中心</span>
                    </button>
                    <button
                        id="learningFeedBtn"
                        class="toolbar-item learning-nav-item"
                        :class="{ 'is-active': isNavActive('feed') }"
                        type="button"
                        @click="emitLearningNav('tab', 'feed')"
                    >
                        <i class="fa-solid fa-rss" aria-hidden="true"></i>
                        <span>动态中心</span>
                    </button>
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
            Learning 侧栏面板(结构/样式对齐原版 ensureLearningSidebarLayout + learning_mode.css):
            list = 学习会话列表(无课程归属的会话按原版渲染为根级平铺);
            conversation = 侧栏内对话,compose 为原版极简 textarea + 发送/中断方块按钮
        -->
        <div
            v-show="isLearningMode && !courseModeOn"
            class="sidebar-content learning-sidebar-panel"
            :class="learningSidebarView === 'conversation' ? 'is-conversation-mode' : 'is-list-mode'"
        >
            <div class="learning-sidebar-layout" :class="learningSidebarView === 'conversation' ? 'is-conversation' : 'is-list'">
                <section
                    v-show="learningSidebarView === 'list'"
                    class="learning-sidebar-conversation-section"
                    aria-label="Learning 对话列表"
                >
                    <div class="learning-sidebar-conversation-header">
                        <span class="learning-sidebar-conversation-title">Learning 对话</span>
                        <span class="learning-sidebar-conversation-count">{{ learningSessions.length }}</span>
                    </div>
                    <div class="learning-sidebar-conversation-list">
                        <div v-if="!learningSessions.length" class="learning-sidebar-conversation-empty">
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
                            tabindex="0"
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
                    </div>
                </section>

                <section
                    v-show="learningSidebarView === 'conversation'"
                    class="learning-sidebar-chat-host"
                    aria-label="Learning 对话"
                >
                    <div class="learning-sidebar-chat">
                        <div ref="learningChatLogRef" class="learning-sidebar-chat-log" @scroll="handleChatLogScroll">
                            <div
                                v-for="message in store.messages"
                                :key="message.index"
                                class="learning-sidebar-chat-msg"
                                :class="message.role === 'user' ? 'is-user' : 'is-assistant'"
                            >
                                <div class="learning-sidebar-chat-text">
                                    <MarkdownView :content="message.content" />
                                </div>
                            </div>
                        </div>
                        <div class="learning-sidebar-chat-compose">
                            <textarea
                                v-model="learningChatDraft"
                                class="learning-sidebar-chat-input"
                                placeholder="结合当前学习上下文继续提问…"
                                @keydown="handleLearningChatKeydown"
                            ></textarea>
                            <button
                                class="learning-sidebar-chat-send"
                                :class="{ 'is-stop': store.generating }"
                                type="button"
                                :aria-label="store.generating ? '中断' : '发送'"
                                :title="store.generating ? '中断' : '发送'"
                                @click="handleLearningChatSubmit()"
                            >
                                <svg v-if="store.generating" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"></rect></svg>
                                <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                            </button>
                        </div>
                    </div>
                </section>
            </div>
        </div>

        <!--
            课程 Workspace 导航面板(对齐原版 renderPanel):
            tabs 由 iframe state-snapshot 上报,点击经 switch-tab 命令回发,乐观高亮
        -->
        <div v-show="courseModeOn" class="sidebar-content learning-course-workspace-panel">
            <section class="course-workspace-shell" aria-label="课程 Workspace">
                <nav class="course-workspace-nav" aria-label="功能区导航">
                    <button
                        v-for="tab in courseTabs"
                        :key="tab.key"
                        class="course-workspace-nav-item"
                        :class="{ 'is-active': tab.key === courseActiveTab }"
                        type="button"
                        :aria-pressed="tab.key === courseActiveTab ? 'true' : 'false'"
                        :title="tab.label"
                        @click="emit('course-switch-tab', tab.key)"
                    >
                        <span class="course-workspace-nav-icon" aria-hidden="true" v-html="courseNavIcon(tab.key)"></span>
                        <span class="course-workspace-nav-label">{{ tab.label }}</span>
                    </button>
                </nav>
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
    import MarkdownView from './MarkdownView.vue'

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
        'learning-send': [content: string]
        'learning-stop': []
        'open-learning-conversation': [conversationId: string]
        'update:learning-sidebar-view': [view: 'list' | 'conversation']
        'course-switch-tab': [tab: string]
        'open-course-workspace': []
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
        /** 课程 Workspace 状态(对齐原版 learningCourseWorkspacePanel 数据面) */
        courseWorkspace?: { available: boolean; on: boolean; tabs: Array<{ key: string; label: string }>; activeTab: string }
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

    // ── 课程 Workspace 接管(对齐原版 learningCourseWorkspacePanel) ──
    const courseAvailable = computed(() => !!props.courseWorkspace?.available)
    const courseModeOn = computed(() => isLearningMode.value && !!props.courseWorkspace?.on)

    /** 功能区图标(对齐原版 WORKSPACE_NAV_ICONS:feather 风格描边 SVG,严禁符号/emoji 替代) */
    const COURSE_NAV_ICONS: Record<string, string> = {
        content: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
        books: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
        outline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
        mindmap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
        report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
        cognition: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        videos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
    }

    function courseNavIcon(key: string): string {
        return COURSE_NAV_ICONS[key] || COURSE_NAV_ICONS.books
    }

    const courseTabs = computed(() => props.courseWorkspace?.tabs ?? [])
    const courseActiveTab = computed(() => props.courseWorkspace?.activeTab ?? '')

    // ── Learning 功能区入口(对齐原版 LEARNING_NAV_BUTTON_TABS + learning nav 分组) ──

    /** 分组展开态(key → 是否展开);原版默认 is-collapsed 折叠 */
    const openNavGroups = ref(new Set<string>())

    function toggleNavGroup(key: string): void {
        const next = new Set(openNavGroups.value)

        if (next.has(key)) {
            next.delete(key)
        } else {
            next.add(key)
        }

        openNavGroups.value = next
    }

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

    /** 学习会话列表(对齐原版 learningSidebarPanel:宿主 learning 作用域会话) */
    const learningSessions = computed<ConversationSummary[]>(() => {
        return store.conversations.filter((item) => item.conversation_mode === 'learning')
    })

    // ── 侧栏对话视图(对齐原版 renderSidebarChat):消息跟随底部,用户上滚即暂停 ──
    const learningChatLogRef = ref<HTMLElement | null>(null)
    const chatLogPinned = ref(true)
    const learningChatDraft = ref('')

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

    /**
     * 侧栏 compose 提交(对齐原版 learning-sidebar-chat-send):
     * 生成中点击=中断,否则发送;Enter 发送 / Escape 中断
     */
    function handleLearningChatSubmit(): void {
        if (store.generating) {
            emit('learning-stop')
            return
        }

        const text = learningChatDraft.value.trim()

        if (!text) return

        emit('learning-send', text)
        learningChatDraft.value = ''
    }

    function handleLearningChatKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            handleLearningChatSubmit()
            return
        }

        if (event.key === 'Escape' && store.generating) {
            event.preventDefault()
            emit('learning-stop')
        }
    }

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
        if (mode === 'workspace') {
            emit('open-course-workspace')
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
