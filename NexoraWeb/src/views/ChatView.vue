<!--
    ChatView.vue — 对话主界面(原版布局)

    结构(与原版 chat.html 一致):
      .app-container > nav.sidebar + main.main-content
        main > header.chat-header + #messagesContainer + .input-dock
-->

<template>
    <div class="app-container">
        <!-- 浏览器实时同步通道:进入聊天页自动连接 /ws/browser,接收模型配置/通知等推送 -->
        <BrowserSyncConnector />

        <Sidebar
            :collapsed="sidebarCollapsed"
            :learning-enabled="learningEnabled"
            :brand-mode="sidebarBrandMode"
            @toggle-mobile="handleToggleMobile"
            @open-settings="handleOpenSettings"
            @open-chat="handleOpenLearningChat"
            @open-workspaces="handleOpenWorkspaces"
            @open-files="handleOpenFileCenter"
            @open-knowledge-mgmt="handleOpenKnowledgeMgmt"
            @open-learning="handleOpenLearning"
            @open-trash="trashOpen = true"
            @open-timeline="timelineOpen = true"
            @view-branch-source="handleViewBranchSource"
        />

        <main class="main-content">
            <ChatHeader
                :models="modelStore.models"
                :view="activeView"
                :knowledge-title="knowledgeTitle"
                :override-title="headerOverrideTitle"
                :override-title-tooltip="headerOverrideTooltip"
                @toggle-sidebar="handleToggleSidebar"
                @open-notes="notesOpen = true"
                @open-files="handleOpenFiles"
                @open-knowledge="handleOpenKnowledge"
                @open-mail="handleOpenMailCenter"
                @back-to-chat="handleHeaderBack"
            />

            <div class="gddp-view-stage">
                <!-- 聊天节点常驻,Files/Workspace 仅覆盖显示,避免返回时重新渲染对话。 -->
                <div v-show="activeView === 'chat'" class="gddp-chat-view">
                <!-- 从 Workspace 打开的对话:聊天视图内提供常驻「返回 Workspace」入口
                     (顶栏返回按钮仅在覆盖视图显示,聊天态不满足,必须就地补一个)。 -->
                <div v-if="workspaceReturnId !== ''" class="chat-workspace-return" aria-label="Workspace 返回入口">
                    <button class="chat-workspace-return-btn" type="button" title="返回 Workspace" @click="returnToWorkspace">
                        <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                        <span>返回 Workspace</span>
                    </button>
                </div>
                <div id="messagesContainer" class="messages-area">
                    <!-- 切换会话加载中:显示加载占位,既不闪欢迎页也不残留旧内容 -->
                    <div v-if="conversationStore.messagesLoading" class="messages-loading">
                        <span class="messages-loading-spinner" aria-hidden="true"></span>
                        <span>加载中…</span>
                    </div>

                    <template v-else>
                    <div v-if="!conversationStore.messages.length" class="welcome-screen">
                        <h1>Hello, {{ userStore.username }}.</h1>
                        <p>How can I assist you today?</p>
                    </div>

                    <template v-else>
                        <!-- 加载更早消息入口(对齐原版 loadPreviousConversationMessages:顶部触发 + 手动按钮) -->
                        <div class="messages-history-load">
                            <button
                                v-if="conversationStore.hasMoreBefore"
                                type="button"
                                class="messages-history-load-btn"
                                :disabled="conversationStore.loadingBefore"
                                @click="handleLoadPrevious"
                            >
                                <span v-if="conversationStore.loadingBefore" class="messages-history-loading-spinner" aria-hidden="true"></span>
                                {{ conversationStore.loadingBefore ? '加载中…' : '加载更早消息' }}
                            </button>
                            <span v-else class="messages-history-load-end">已到最早消息</span>
                        </div>

                        <MessageItem
                            v-for="(message, index) in conversationStore.messages"
                            :key="message.index"
                            :message="message"
                            :model-name="modelStore.selectedModel?.name"
                            :streaming="isStreamingMessage(index)"
                            :is-last-user-message="isLastUserMessage(message)"
                            :conversation-id="conversationStore.currentId"
                            @delete="handleDeleteMessage"
                            @edit-save="handleEditUserMessage"
                            @regenerate="handleRegenerate"
                            @question-answer="handleQuestionAnswer"
                            @open-image="handleOpenImage"
                            @fork="handleForkMessage"
                            @switch-version="handleSwitchVersion"
                        />
                    </template>
                    </template>
                </div>

                <!-- Turn Indicator(对齐原版:有对话轮次即显示,当前轮高亮) -->
                <TurnIndicatorPanel
                    :messages="conversationStore.turns"
                    @jump="handleTurnIndicatorJump"
                />

                <!--
                    输入坞:进入 Workspace 详情时停靠到详情页输入槽位(对齐原版
                    mountWorkspaceDetailInputContainer)。必须用 v-if 条件挂载 Teleport:
                    Vue 仅在挂载时解析一次目标,常驻 Teleport 会把启动期的 null 目标永久缓存,
                    后续启用即 insertBefore(null) 崩溃;v-if 保证创建实例时槽位已存在。
                    未停靠分支直接原地渲染,两分支共享同一份绑定(chatInputBindings)。
                -->
                <Teleport v-if="workspaceComposerDocked" to="#ws-detail-input-slot">
                    <ChatInput ref="chatInputRef" v-bind="chatInputBindings" />
                </Teleport>
                <ChatInput v-else ref="chatInputRef" v-bind="chatInputBindings" />
                </div>

                <div v-show="filesCenterOpen" class="gddp-content-view">
                    <FilesCenterView
                        v-if="fileDetail === null"
                        :open="filesCenterOpen"
                        @close="backToChat"
                        @open-detail="openFileDetail"
                    />
                    <section v-else class="gddp-files-view" aria-label="Files">
                        <div class="gddp-files-shell">
                            <FileDetailView :file="fileDetail" @deleted="fileDetail = null" />
                        </div>
                    </section>
                </div>

                <div v-show="workspacesOpen" class="gddp-content-view">
                    <!--
                        他人共享对话只读视图:覆盖显示在 Workspaces 内容层(与 Files 的 fileDetail 同模式)。
                        两分支必须 v-show 共存:WorkspacesView 卸载会连带销毁输入槽位,
                        导致停靠中的输入坞 Teleport 目标失效(insertBefore 崩溃)。
                    -->
                    <section v-show="workspaceShared !== null" class="workspace-shared-view" aria-label="共享对话(只读)">
                        <div class="workspace-shared-head">
                            <button class="workspace-shared-back" type="button" title="返回 Workspace" aria-label="返回 Workspace" @click="closeWorkspaceSharedConversation()">
                                <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                                <span>返回</span>
                            </button>
                            <span class="workspace-shared-title">{{ workspaceShared?.title || '共享对话' }}</span>
                            <span v-if="workspaceShared?.ownerUsername" class="workspace-shared-owner">只读 · @{{ workspaceShared.ownerUsername }}</span>
                        </div>
                        <div class="messages-area instant-messages workspace-shared-messages">
                            <div v-if="workspaceShared !== null && workspaceShared.loading" class="ws-shared-state">加载中...</div>
                            <div v-else-if="workspaceShared !== null && workspaceShared.error" class="ws-shared-state">{{ workspaceShared.error }}</div>

                            <template v-else>
                                <MessageItem
                                    v-for="message in workspaceShared === null ? [] : workspaceShared.messages"
                                    :key="message.index"
                                    :message="message"
                                    readonly
                                    @open-image="handleOpenImage"
                                />
                            </template>
                        </div>
                    </section>

                    <WorkspacesView
                        v-show="workspaceShared === null"
                        ref="workspacesViewRef"
                        :open="workspacesOpen"
                        @open-conversation="onWorkspaceOpenConversation"
                        @open-knowledge="onWorkspaceOpenKnowledge"
                    />
                </div>

                <div v-show="knowledgeMgmtOpen" class="gddp-content-view">
                    <KnowledgeManagementView
                        :open="knowledgeMgmtOpen"
                        @close="backToChat"
                        @open-document="handleOpenKnowledgeDocument"
                    />
                </div>

                <div v-show="knowledgeOpen" class="gddp-content-view">
                    <KnowledgeViewer
                        :open="knowledgeOpen"
                        :title="knowledgeTitle"
                        @open-settings="knowledgeSettingsOpen = true"
                    />
                </div>

                <div v-show="mailCenterOpen" class="gddp-content-view">
                    <MailCenterView
                        ref="mailViewRef"
                        :open="mailCenterOpen"
                        @close="backToChat"
                    />
                </div>

                <LearningFrameView
                    v-show="learningOpen"
                    ref="learningFrameRef"
                    :open="learningOpen"
                    :frame-url="learningFrameUrl"
                    :title="learningFrameTitle"
                    @request-open-settings="settingsOpen = true"
                    @host-message="handleLearningHostMessage"
                />
            </div>
        </main>

        <FilesPanel :open="filesPanelOpen" @close="closePanel('files')" @attach="handleAttachFile" />

        <KnowledgePanel
            :open="knowledgePanelOpen"
            @close="closePanel('knowledge')"
            @open-document="handleOpenKnowledgeDocument"
            @document-deleted="handleKnowledgeDocumentDeleted"
        />

        <SettingsModal :open="settingsOpen" @close="settingsOpen = false" />

        <KnowledgeSettingsModal
            :open="knowledgeSettingsOpen"
            :title="knowledgeTitle"
            @close="knowledgeSettingsOpen = false"
        />

        <TrashModal :open="trashOpen" @close="trashOpen = false" @restored="handleTrashRestored" />

        <TokenDetailModal :open="tokenDetailOpen" :conversation-id="conversationStore.currentId" @close="tokenDetailOpen = false" />

        <ImageViewer
            :open="imageViewerUrl !== ''"
            :url="imageViewerUrl"
            @close="imageViewerUrl = ''"
        />

        <TimelinePanel :open="timelineOpen" @close="timelineOpen = false" />

        <NotesPanel
            ref="notesPanelRef"
            :open="notesOpen"
            @close="notesOpen = false"
            @jump-to-source="handleJumpToNoteSource"
        />

        <SelectionContextMenu
            ref="selectionMenuRef"
            @add-note="handleAddNote"
            @explain="handleExplainSelection"
        />

        <GlobalSearch
            @new-conversation="handleSearchNewConversation"
            @open-conversation="handleSearchOpenConversation"
            @jump-to-message="handleSearchJumpToMessage"
            @open-knowledge="handleSearchOpenKnowledge"
            @open-file="handleSearchOpenFile"
        />
    </div>
</template>

<script setup lang="ts">
    import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

    import type { ChatMessage } from '@/api/conversations'
    import type { AttachmentInput } from '@/api/attachments'
    import { deleteMessage, forkConversation, switchMessageVersion, updateMessageContent } from '@/api/conversations'
    import { chatStream, type ChatStreamChunk } from '@/network/chatStream'
    import { showConfirm } from '@/stores/confirm'
    import { useConversationStore } from '@/stores/conversation'
    import { useModelStore } from '@/stores/model'
    import { showError, showToast } from '@/stores/notify'
    import { useUserStore } from '@/stores/user'
    import { useBottomFollow } from '@/composables/useBottomFollow'
    import { readConversationIdFromLocation, useConversationUrlSync } from '@/composables/useConversationUrlSync'
    import { closeAllOverlays, closePanel, openPanel, openView, overlay } from '@/ui/overlay'
    import { useLearningViewSync } from '@/composables/useLearningViewSync'
    import { primeNexoraMapRendererConfig } from '@/stream/mapRenderer'

    import ChatHeader from '@/components/ChatHeader.vue'
    import BrowserSyncConnector from '@/components/BrowserSyncConnector.vue'
    import ChatInput from '@/components/ChatInput.vue'
    import FileDetailView from '@/components/FileDetailView.vue'
    import FilesCenterView from '@/components/FilesCenterView.vue'
    import FilesPanel from '@/components/FilesPanel.vue'
    import GlobalSearch from '@/components/GlobalSearch.vue'
    import ImageViewer from '@/components/ImageViewer.vue'
    import KnowledgePanel from '@/components/KnowledgePanel.vue'
    import KnowledgeViewer from '@/components/KnowledgeViewer.vue'
    import KnowledgeManagementView from '@/components/KnowledgeManagementView.vue'
    import KnowledgeSettingsModal from '@/components/KnowledgeSettingsModal.vue'
    import MailCenterView from '@/components/MailCenterView.vue'
    import MessageItem from '@/components/MessageItem.vue'
    import NotesPanel from '@/components/NotesPanel.vue'
    import SelectionContextMenu from '@/components/SelectionContextMenu.vue'
    import LearningFrameView from '@/components/LearningFrameView.vue'
    import SettingsModal from '@/components/SettingsModal.vue'
    import Sidebar from '@/components/Sidebar.vue'
    import TimelinePanel from '@/components/TimelinePanel.vue'
    import TokenDetailModal from '@/components/TokenDetailModal.vue'
    import TrashModal from '@/components/TrashModal.vue'
    import TurnIndicatorPanel from '@/components/TurnIndicatorPanel.vue'
    import WorkspacesView from '@/components/workspaces/WorkspacesView.vue'

    import type { CloudFileItem } from '@/api/files-center'
    import type { NoteItem } from '@/api/notes'
    import type { SearchFileHit, SearchMessageHit } from '@/api/search'
    import type { WorkspaceConversationOpenMeta } from '@/components/workspaces/workspaceContext'

    import { addWorkspaceConversation, fetchSharedWorkspaceConversation } from '@/api/workspaces'
    import { fetchUserPreferences } from '@/api/preferences'
    import type { LearningHostEnvelope } from '@/bridge/learningBridge'

    const conversationStore = useConversationStore()
    const modelStore = useModelStore()
    const userStore = useUserStore()

    // 网络层快照内容源:进行中流的缓冲消息上下文由 store 提供(层只负责序列化/存储)
    chatStream.attachSnapshotSource(() => conversationStore.buildStreamSnapshot())

    const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null)
    const settingsOpen = ref(false)
    const trashOpen = ref(false)
    const timelineOpen = ref(false)
    const notesOpen = ref(false)
    const sidebarCollapsed = ref(false)
    const tokenDetailOpen = ref(false)

    /** 当前流是否已通过 error chunk 弹过错误提示,避免终帧/断线重复弹(每次发送前重置) */
    let streamErrorToastShown = false

    /** 知识点设置弹窗(接入原版 knowledgeSettingsModal;具体功能待接入) */
    const knowledgeSettingsOpen = ref(false)

    /** 正在向前补载更早消息:抑制"消息变化自动滚到底部",避免补载后被强行拉到底 */
    const prepending = ref(false)

    /**
     * 跟随底部滚动策略:
     * 流式增量仅在用户位于底部附近时自动滚底;用户上滑回看即暂停,回到底部恢复。
     */
    const {
        following: autoFollowBottom,
        syncWithScroll,
        followNow,
        resume: resumeBottomFollow,
        suspend: suspendBottomFollow,
    } = useBottomFollow()

    // 会话 ↔ URL ?cid= 双向同步:切换写 URL、后退/前进跟随(启动直达在 onMounted 中显式处理)
    useConversationUrlSync()
    // Learning 视图 ↔ URL ?view=learning 同步（与 cid 互不干扰）
    useLearningViewSync()

    /** 文件中心:替换主内容区(对齐原版 openFilesFrameView);详情文件为 null 时显示列表 */
    const fileDetail = ref<CloudFileItem | null>(null)

    /** Workspaces 视图引用:顶栏返回需先回项目首页(详情内容 → 首页 → 聊天) */
    const workspacesViewRef = ref<InstanceType<typeof WorkspacesView> | null>(null)

    /**
     * 从 Workspace 内打开对话/知识库后,记录来源 Workspace id,
     * 顶栏返回时据此回退到原 Workspace 详情(对齐原版:Workspace 子内容返回项目视图)。
     * 仅 Workspace 触发的打开才写入,其他入口(侧栏知识库/管理页)不受其影响。
     */
    const workspaceReturnId = ref<string>('')

    /**
     * Workspace 详情内嵌输入框:
     *   - workspaceComposeTarget 非空 = 发送的会话应归入该 Workspace
     *     (对齐原版 getActiveWorkspaceDetailComposeWorkspaceId)
     */
    const workspaceComposeTarget = computed(() => workspacesViewRef.value?.composerTarget || '')

    /** 发送后已登记归入的会话集合(防队列补发重复登记) */
    const composedRegisteredPairs = new Set<string>()

    /** 发送后把新会话归入 Workspace(对齐原版 registerWorkspaceDetailConversation) */
    async function registerComposedConversation(workspaceId: string, conversationId: string): Promise<void> {
        const pairKey = `${workspaceId}:${conversationId}`

        if (composedRegisteredPairs.has(pairKey)) {
            return
        }

        try {
            await addWorkspaceConversation(workspaceId, conversationId)

            composedRegisteredPairs.add(pairKey)
            showToast('新对话已归入 Workspace', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : 'Workspace 对话登记失败')
        }
    }

    /**
     * 他人共享对话只读视图(对齐原版 openWorkspaceSharedConversation):
     * 覆盖在 Workspaces 内容层;顶栏返回先回到项目视图。
     */
    interface WorkspaceSharedViewState {
        loading: boolean
        error: string
        title: string
        ownerUsername: string
        messages: ChatMessage[]
    }

    const workspaceShared = ref<WorkspaceSharedViewState | null>(null)

    async function openWorkspaceSharedConversation(meta: WorkspaceConversationOpenMeta, conversationId: string): Promise<void> {
        workspaceShared.value = {
            loading: true,
            error: '',
            title: '',
            ownerUsername: meta.ownerUsername,
            messages: [],
        }

        try {
            const data = await fetchSharedWorkspaceConversation(meta.workspaceId, conversationId)

            workspaceShared.value = {
                loading: false,
                error: '',
                title: data.title,
                ownerUsername: data.ownerUsername || meta.ownerUsername,
                messages: data.messages,
            }
        } catch (error) {
            workspaceShared.value = {
                loading: false,
                error: error instanceof Error ? error.message : '共享对话读取失败',
                title: '',
                ownerUsername: meta.ownerUsername,
                messages: [],
            }
        }
    }

    function closeWorkspaceSharedConversation(): void {
        workspaceShared.value = null

        // 关闭共享对话即回到项目视图;来源定位同时失效,避免后续顶栏返回误重开 Workspace
        workspaceReturnId.value = ''
    }

    /** 内容级视图统一由浮层协调器(GDDP)单一状态机管理,切换时彼此互斥 */
    const filesCenterOpen = computed(() => overlay.view === 'files')
    const workspacesOpen = computed(() => overlay.view === 'workspaces')

    /**
     * Teleport 停靠开关:目标槽位真实出现在文档后的下一拍才置 true,
     * v-if 届时才创建 Teleport 实例(挂载期解析目标,必然成功)。
     * 离开详情立即置 false,输入坞以普通节点渲染回常驻的聊天视图容器。
     */
    const workspaceComposerDocked = ref(false)

    /**
     * ChatInput 公共绑定:停靠(Teleport)与未停靠两个分支共用一份,
     * 监听器以 on* 键传入 v-bind,避免模板重复(AGENTS 严禁重复代码)。
     */
    const chatInputBindings = computed(() => ({
        attachments: pendingAttachments.value,
        onSend: handleSend,
        onStop: handleStop,
        onRemoveAttachment: (index: number) => pendingAttachments.value.splice(index, 1),
        onFilesUploaded: handleUploadedFiles,
        onOpenTokenDetail: () => {
            tokenDetailOpen.value = true
        },
    }))

    watch(
        [workspacesOpen, workspaceComposeTarget, workspaceShared],
        ([open, target, shared]) => {
            // 共享只读视图无输入框:此处不启用停靠,输入坞按普通节点留在聊天视图
            if (!open || !target || shared !== null) {
                workspaceComposerDocked.value = false

                return
            }

            void nextTick(() => {
                const slot = document.getElementById('ws-detail-input-slot')

                if (slot && open && workspacesViewRef.value?.composerTarget === target) {
                    workspaceComposerDocked.value = true
                }
            })
        },
        { immediate: true }
    )
    const knowledgeMgmtOpen = computed(() => overlay.view === 'knowledge-mgmt')
    const knowledgeOpen = computed(() => overlay.view === 'knowledge')
    const mailCenterOpen = computed(() => overlay.view === 'mail')
    const learningOpen = computed(() => overlay.view === 'learning')
    const knowledgeTitle = ref('')

    // ── Learning 薄挂载状态（P0）──────────────────────
    const learningFrameRef = ref<InstanceType<typeof LearningFrameView> | null>(null)
    void learningFrameRef
    const learningFrameTitle = ref('NexoraLearning')
    const learningEnabled = ref(true)
    const learningFrontendUrl = ref('')

    const learningFrameUrl = computed(() => String(learningFrontendUrl.value || '').trim())

    async function refreshLearningPreference(): Promise<void> {
        try {
            const prefs = await fetchUserPreferences()
            if (!prefs) return
            const runtime = prefs.learning_runtime as { enabled?: boolean; frontend_url?: string } | undefined
            const enabled = runtime && typeof runtime === 'object' ? runtime.enabled !== false : true
            learningEnabled.value = enabled
            const url = runtime && typeof runtime === 'object' ? String(runtime.frontend_url || '').trim() : ''
            if (url) learningFrontendUrl.value = url
        } catch {
            // 偏好不可达不阻断主流程
        }
    }

    const sidebarBrandMode = computed<'nexora' | 'learning' | 'workspace'>(() => {
        if (learningOpen.value) return 'learning'
        return 'nexora'
    })

    // 合并 body class 写入到同一帧，避免两次样式重算；并在动画期间禁用 iframe 指针事件
    function syncLearningBodyClass(): void {
        const active = learningOpen.value
        const enabled = learningEnabled.value
        // 动画期间（220ms）让 iframe 不接收指针，减少合成层抖动
        const frameEl = document.querySelector<HTMLIFrameElement>('.learning-frame')
        if (frameEl && active) {
            frameEl.style.pointerEvents = 'none'
            window.setTimeout(() => { frameEl.style.pointerEvents = '' }, 260)
        }
        requestAnimationFrame(() => {
            document.body.classList.toggle('learning-workspace-active', active)
            document.body.classList.toggle('learning-mode-enabled', enabled)
        })
    }
    watch([learningOpen, learningEnabled], syncLearningBodyClass, { immediate: true })

    function handleOpenLearning(): void {
        if (!learningEnabled.value) {
            showToast('Learning 未启用，请在设置中开启', 'warning')
            return
        }
        if (learningOpen.value) {
            backToChat()
            return
        }
        openView('learning')
    }

    function handleOpenLearningChat(): void {
        if (!learningOpen.value) {
            return
        }
        backToChat()
    }

    function handleLearningHostMessage(message: LearningHostEnvelope): void {
        if (message.type === 'state-snapshot') {
            const title = String(message.title || '').trim()
            if (title) learningFrameTitle.value = title
            return
        }
        if (message.type === 'open-chat-conversation') {
            const cid = String(message.conversation_id || '').trim()
            if (cid) {
                backToChat()
                void conversationStore.openConversation(cid).catch((error: unknown) => {
                    showError(error instanceof Error ? error.message : '打开会话失败')
                })
            }
            return
        }
        if (message.type === 'pointer-down') {
            // iframe 内的点击不会冒泡到宿主 document,移动端抽屉需按协定显式收起
            if (window.matchMedia('(max-width: 980px)').matches && document.body.classList.contains('mobile-sidebar-open')) {
                document.body.classList.remove('mobile-sidebar-open')
            }
            return
        }
    }

    /** 当前顶栏视图(对齐原版 headerTitle 切换:Files / Workspaces / 会话标题) */
    const activeView = computed<'chat' | 'files' | 'workspaces' | 'knowledge' | 'knowledge-mgmt' | 'mail' | 'learning'>(() => {
        return overlay.view || 'chat'
    })

    /** 顶栏中央标题覆盖(Workspaces 子态:详情页显示「Workspace」,共享对话显示其标题) */
    const headerOverrideTitle = computed(() => {
        if (workspacesOpen.value && workspaceShared.value !== null) {
            return workspaceShared.value.title || '共享对话'
        }

        if (workspacesOpen.value && workspacesViewRef.value?.isInDetail()) {
            return 'Workspace'
        }

        return ''
    })

    /** 覆盖标题悬停说明:只读共享时标注归属者(对齐原版 headerTitle.title) */
    const headerOverrideTooltip = computed(() => {
        if (workspacesOpen.value && workspaceShared.value !== null) {
            return workspaceShared.value.ownerUsername
                ? `只读共享 · @${workspaceShared.value.ownerUsername}`
                : '只读共享'
        }

        return ''
    })

    /** 返回聊天视图(对齐原版 closeFileCenterOrReturn);离开 Workspaces 层时一并复位共享只读态 */
    function backToChat(): void {
        closeAllOverlays()

        knowledgeTitle.value = ''
        fileDetail.value = null
        workspaceShared.value = null
    }

    /** 原版 Files 返回行为:详情返回文件列表,列表才返回聊天。
     *  Workspace 内容多级返回:共享只读对话 → 项目详情/首页 → 聊天 */
    function handleHeaderBack(): void {
        // Learning 覆盖层：顶栏返回即回到聊天（与 Files/Workspaces 一致）
        if (learningOpen.value) {
            backToChat()
            return
        }

        // 文件详情:先从内容返回其来源视图(文件中心首页 / Workspaces 首页)
        if (filesCenterOpen.value && fileDetail.value !== null) {
            handleFileDetailBack()

            return
        }

        // Workspaces 共享只读对话:先回到项目视图
        if (workspacesOpen.value && workspaceShared.value !== null) {
            closeWorkspaceSharedConversation()

            return
        }

        // Workspaces 详情内容:先返回 Workspaces 首页
        if (workspacesOpen.value && workspacesViewRef.value?.isInDetail()) {
            workspacesViewRef.value.backToList()

            return
        }

        // 从 Workspace 内打开了对话/知识库:顶栏返回应回到来源 Workspace 详情。
        // WorkspacesView 全程 v-show 保活,detail 与当前 tab 原样保留,直接切回即可,无需重开。
        if (workspaceReturnId.value) {
            returnToWorkspace()

            return
        }

        // 邮件阅读态:先返回邮件列表,列表态才关闭整个视图
        if (mailCenterOpen.value && mailViewRef.value?.isInDetail()) {
            mailViewRef.value.backToList()

            return
        }

        backToChat()
    }

    /**
     * 回到来源 Workspace 详情(顶栏返回与聊天视图的「返回 Workspace」按钮共用):
     * WorkspacesView 全程 v-show 保活,detail 与当前 tab 原样保留,直接切回即可。
     */
    function returnToWorkspace(): void {
        if (!workspaceReturnId.value) {
            return
        }

        workspaceReturnId.value = ''

        backToChat()
        openView('workspaces')
    }

    /**
     * Workspace 内打开对话/知识库的入口包装:先记录来源 Workspace id,
     * 再走既有分流逻辑;顶栏返回时据此回退到原 Workspace 详情。
     */
    function onWorkspaceOpenConversation(conversationId: string, meta?: WorkspaceConversationOpenMeta): void {
        workspaceReturnId.value = workspacesViewRef.value?.currentWorkspaceId() || ''

        void handleOpenWorkspaceConversation(conversationId, meta)
    }

    function onWorkspaceOpenKnowledge(title: string): void {
        workspaceReturnId.value = workspacesViewRef.value?.currentWorkspaceId() || ''

        handleOpenKnowledgeDocument(title)
    }

    /**
     * 从 Workspaces 详情点击对话(对齐原版 openWorkspaceDetailConversation 的分流):
     *   - 无归属元数据:自己的会话,回到聊天直接打开(来源 Workspace 已记录,可经顶栏返回)
     *   - 带归属元数据:他人共享会话,留在 Workspaces 内容层渲染只读视图
     */
    async function handleOpenWorkspaceConversation(conversationId: string, meta?: WorkspaceConversationOpenMeta): Promise<void> {
        if (meta) {
            await openWorkspaceSharedConversation(meta, conversationId)

            return
        }

        // 离开 Workspace 视图进入聊天,但保留 workspaceReturnId 以便顶栏返回
        backToChat()

        try {
            await conversationStore.openConversation(conversationId)
        } catch (error) {
            showError(error instanceof Error ? error.message : '打开会话失败')
        }
    }

    /** 选区右键菜单与笔记面板引用 */
    const selectionMenuRef = ref<InstanceType<typeof SelectionContextMenu> | null>(null)
    const notesPanelRef = ref<InstanceType<typeof NotesPanel> | null>(null)
    const mailViewRef = ref<InstanceType<typeof MailCenterView> | null>(null)

    /** 图片查看器:非空 url 即打开(对齐原版 openImageViewer/closeImageViewer) */
    const imageViewerUrl = ref('')

    /** 文件右侧栏状态:由浮层协调器管理(互斥 + 外部点击关闭) */
    const filesPanelOpen = computed(() => overlay.panel === 'files')

    /** 知识库右侧栏状态:同上 */
    const knowledgePanelOpen = computed(() => overlay.panel === 'knowledge')

    /** 待发送附件(对齐原版 uploadedFileIds;发送持久化成功后清空) */
    const pendingAttachments = ref<AttachmentInput[]>([])

    /** 附加云端文件到输入框(对齐原版 attachCloudFileAsAttachment) */
    function handleAttachFile(attachment: AttachmentInput): void {
        const sandbox = String(attachment.sandbox_path || '').trim()

        if (!sandbox) {
            showToast('文件路径无效,无法附加', 'warning')

            return
        }

        const exists = pendingAttachments.value.some((att) => att.sandbox_path === sandbox)

        if (exists) {
            showToast('该文件已附加', 'info')

            return
        }

        pendingAttachments.value.push(attachment)

        // 若在 Files/Workspaces 视图,先回到聊天;聚焦输入框
        backToChat()

        chatInputRef.value?.focus()

        showToast('已附加到输入框', 'success')
    }

    /** 输入区直选文件上传完成:按 sandbox_path 去重后并入待发送附件列表 */
    function handleUploadedFiles(list: AttachmentInput[]): void {
        list.forEach((attachment) => {
            const sandbox = String(attachment.sandbox_path || '').trim()

            if (!sandbox) {
                return
            }

            if (pendingAttachments.value.some((att) => att.sandbox_path === sandbox)) {
                return
            }

            pendingAttachments.value.push(attachment)
        })

        chatInputRef.value?.focus()
    }

    /**
     * 轮次预览点击跳转(对齐原版 scrollToAndHighlight):
     * 目标消息居中于消息视口(而非顶部对齐),跳转后临时高亮 3 秒;
     * 跳转期间的滚动跟随屏蔽由 TurnIndicatorPanel 内部 _isJumping 等价逻辑处理
     */
    async function handleTurnIndicatorJump(messageIndex: number): Promise<void> {
        // 目标轮次可能尚未加载(消息窗口化):先向前分页补载,每页都恢复滚动位置避免漂移。
        // prepending 必须保持到"目标滚动完成之后"再释放,否则"消息变化自动滚底"
        // 监听在 nextTick 刷新期执行时 prepending 已为 false,仍会把视图拉到底、覆盖目标滚动。
        const needLoad = !conversationStore.messages.some((item) => Number(item.index) === messageIndex)

        // 主动跳转离开底部:暂停跟随,避免流式增量把视图拉回底部
        suspendBottomFollow()

        if (needLoad) {
            prepending.value = true

            try {
                const loaded = await ensureMessageIndexLoadedWithRestore(messageIndex)

                if (!loaded) {
                    prepending.value = false

                    return
                }
            } catch {
                prepending.value = false

                return
            }
        }

        await nextTick()

        const container = document.getElementById('messagesContainer')
        const target = container
            ? container.querySelector<HTMLElement>(`.message.user[data-index="${messageIndex}"]`)
            : null

        if (!container || !target) {
            prepending.value = false

            return
        }

        const targetTop = Math.max(0, target.offsetTop - (container.clientHeight / 2) + (target.offsetHeight / 2))

        // 平滑滚动到目标(被 prepending 保护,不会被"自动滚底"打断)
        container.scrollTo({
            top: targetTop,
            behavior: 'smooth'
        })

        // 滚动完成后再释放:期间"自动滚底"监听被抑制,不会覆盖本次定位
        prepending.value = false

        target.classList.add('turn-jump-highlight')

        window.setTimeout(() => {
            target.classList.remove('turn-jump-highlight')
        }, 3000)
    }

    /** 助手消息在生成中时标记打字指示(重答时锁定目标索引消息) */
    function isStreamingMessage(index: number): boolean {
        if (!conversationStore.generating) {
            return false
        }

        if (conversationStore.streamingTargetIndex !== null) {
            return index === Number(conversationStore.streamingTargetIndex)
        }

        return index === conversationStore.messages.length - 1
    }

    /** 发送:唯一入口,经网络层同步锁防重入;生成中消息自动入队 */
    async function handleSend(content: string, options: {
        enableThinking: boolean
        enableWebSearch: boolean
        enableTools: boolean
        toolsMode: string
    }): Promise<void> {
        // 附件随消息快照,进入队列/发送后清空输入区附件条(对齐原版发送后 reset files)
        const attachments = pendingAttachments.value.slice()

        // 生成中:消息进入待发送队列,当前流结束后自动发送(消息队列功能)
        if (chatStream.isSending) {
            conversationStore.enqueueMessage({ content, options, attachments })

            pendingAttachments.value = []

            showToast(`已加入发送队列(共 ${conversationStore.queueCount} 条)`, 'info')

            return
        }

        // 无会话时先创建(对齐原版懒创建;await 期间可能被并发触发,返回后二次检查)
        if (!conversationStore.currentId) {
            await conversationStore.ensureConversationId()

            if (chatStream.isSending) {
                conversationStore.enqueueMessage({ content, options, attachments })

                pendingAttachments.value = []

                return
            }
        }

        // 发送即清空附件条（乐观更新，对齐原版 uploadedFileIds = [] 即时清理）
        pendingAttachments.value = []

        await doSend(content, options, attachments)
    }

    /** 执行一次真实发送(经网络层同步锁) */
    async function doSend(content: string, options: {
        enableThinking: boolean
        enableWebSearch: boolean
        enableTools: boolean
        toolsMode: string
    }, attachments: AttachmentInput[] = []): Promise<void> {
        // 发送前确保会话存在
        const conversationId = await conversationStore.ensureConversationId()

        // Workspace 详情页内发送:新会话自动归入该项目(对齐原版 registerWorkspaceDetailConversation)
        const composeWorkspace = workspaceComposeTarget.value

        if (composeWorkspace) {
            void registerComposedConversation(composeWorkspace, conversationId)
        }

        // Workspace 详情页发送即切到该对话(对齐原版:详情页输入框发送跳进会话查看回复);
        // 来源 Workspace 已记录,顶栏可一键返回。登记与跳转不互相等待,保证立即看到流式回复。
        if (composeWorkspace) {
            workspaceReturnId.value = workspacesViewRef.value?.currentWorkspaceId() || composeWorkspace

            backToChat()

            try {
                await conversationStore.openConversation(conversationId)
            } catch {
                // 打开失败不影响已发起的发送;错误由流终帧统一上报
            }
        }

        // 发送即回到最新消息:恢复跟随底部,由消息变化监听执行滚动
        resumeBottomFollow()

        conversationStore.beginStream(content, attachments)

        const accepted = await chatStream.send({
            message: content,
            conversationId,
            modelName: modelStore.selectedId || undefined,
            enableThinking: options.enableThinking,
            enableWebSearch: options.enableWebSearch,
            enableTools: options.enableTools,
            toolMode: options.toolsMode,
            includeContext: true,
            attachments,
        }, {
            onChunk: handleStreamChunk,
            onEnd: handleStreamEnd,
        })

        // 发送被接受:附件随消息持久化,清空待发送附件(对齐原版 uploadedFileIds = [])
        if (accepted) {
            pendingAttachments.value = []
        } else {
            conversationStore.abortStream()

            showToast('发送冲突,请重试', 'warning')
        }
    }

    /** 生成状态变化:结束后自动发送队列下一条(消息队列核心状态机) */
    watch(
        () => conversationStore.generating,
        (generating) => {
            if (generating) {
                return
            }

            if (conversationStore.queueCount > 0 && !chatStream.isSending) {
                // 队列只在其所属会话被查看时排空,避免后台流期间把排队消息发进别的会话
                if (conversationStore.streamingConversationId !== conversationStore.currentId) {
                    return
                }

                const next = conversationStore.dequeueNext()

                if (next) {
                    void doSend(next.content, next.options, next.attachments || [])
                }
            }
        }
    )

    /** 处理流式数据块:按类型分发增量正文/思考/会话元信息/错误 */
    function handleStreamChunk(chunk: ChatStreamChunk): void {
        // 会话 ID 同步(后端懒创建会话时通过 conversation_id chunk 返回)
        if (chunk.type === 'conversation_id' && chunk.conversation_id) {
            if (!conversationStore.currentId) {
                conversationStore.currentId = String(chunk.conversation_id)
            }

            return
        }

        // 模型信息:同步到当前助手消息(model-badge 数据源)
        if (chunk.type === 'model_info') {
            if (chunk.model_name) {
                conversationStore.setStreamingModelName(String(chunk.model_name))
            }

            return
        }

        // token 画像:记录本次请求的 token 构成(CTX/Token 显示数据源)
        if (chunk.type === 'prompt_token_profile') {
            conversationStore.setStreamingTokenProfile(chunk)

            return
        }

        // 流式 usage:驱动输入区 TK mini 增量展示(对齐原版 onTokenStreamUsageChunk)
        if (chunk.type === 'token_usage') {
            conversationStore.accumulateStreamUsage(chunk as unknown as Record<string, unknown>)

            return
        }

        // 上下文压缩状态:更新当前助手消息的压缩卡片(对齐原版 updateMessageDivTools 的 context_compression_status 分支)
        if (chunk.type === 'context_compression_status') {
            conversationStore.setStreamingContextCompression(chunk)

            return
        }

        // 错误块:显式上报;不在块内中断流,由 done 终帧统一收尾并恢复目标消息(避免丢失流式目标索引)
        if (chunk.type === 'error') {
            streamErrorToastShown = true

            showError(String(chunk.content || chunk.message || '回复生成失败'))

            return
        }

        // stream_session 携带后端会话 ID,首次发送时同步回状态
        if (chunk.type === 'stream_session' && chunk.conversation_id) {
            if (!conversationStore.currentId) {
                conversationStore.currentId = String(chunk.conversation_id)
            }

            return
        }

        // 正文增量:content / content_delta / message 三种形态
        if (chunk.type === 'content' || chunk.type === 'content_delta' || chunk.type === 'message') {
            const delta = String(chunk.content || chunk.delta || '')

            conversationStore.appendStreamText(delta)

            return
        }

        // 思考增量:reasoning_content / reasoning_delta
        if (chunk.type === 'reasoning_content' || chunk.type === 'reasoning_delta') {
            const delta = String(chunk.content || chunk.delta || '')

            conversationStore.appendStreamReasoning(delta)

            return
        }

        // 工具事件:delta 阶段并入调用分段实现参数流式,call/result 维持配对时序;
        // question 为交互问题卡片,等待用户作答后作为普通消息发送
        if (
            chunk.type === 'function_call_delta'
            || chunk.type === 'function_call'
            || chunk.type === 'function_result'
            || chunk.type === 'question'
        ) {
            conversationStore.appendStreamToolStep(chunk as unknown as Record<string, unknown>)
        }

        // 增量落地后节流写快照(跨刷新恢复数据源,由网络层负责持久化)
        if (
            chunk.type === 'content_delta'
            || chunk.type === 'content'
            || chunk.type === 'reasoning_content'
            || chunk.type === 'reasoning_delta'
            || chunk.type === 'function_call'
            || chunk.type === 'function_result'
            || chunk.type === 'question'
        ) {
            chatStream.persistSnapshot()
        }
    }

    /** 流结束:按原因收尾;done 终帧携带后端落盘的最终消息,本地轻量更新(对齐原版流结束即时收尾) */
    function handleStreamEnd(reason: 'done' | 'aborted' | 'error', info?: unknown): void {
        const detail = info as { error?: string; finalContent?: string; finalMessage?: Record<string, unknown> } | undefined

        // 跨刷新重连发现服务端流已结束/不存在:
        // 快照内容按"已完成部分"保留展示,静默收尾(不弹错误、不写错误文本)
        if (reason === 'error' && typeof detail?.error === 'string' && detail.error.startsWith('STREAM_GONE')) {
            conversationStore.finishRestoredStream()

            streamErrorToastShown = false

            return
        }

        if (reason === 'error') {
            // 后端已持久化错误信息到目标消息;优先用终帧消息恢复被清空的目标
            conversationStore.applyFinalMessage(detail?.finalMessage)

            // 重连失败等场景拿不到终帧消息时,把错误文本写入目标消息,避免消息留空
            if (!detail?.finalMessage) {
                conversationStore.fillStreamingMessageWithError(detail?.error || '回复生成失败,请重试')
            }

            conversationStore.abortStream()

            // 流过程中 error chunk 已弹过提示时,终帧/断线收尾不再重复弹
            if (!streamErrorToastShown) {
                showError(detail?.error || '回复生成失败,请重试')
            }

            streamErrorToastShown = false

            return
        }

        // 用户终止:保留本地已流式接收的交错分段(多轮思考/工具链不塌缩);
        // 服务器取消终帧若携带已落盘的部分消息,用它恢复(含 process_steps)
        if (reason === 'aborted') {
            conversationStore.applyFinalMessage(detail?.finalMessage)

            conversationStore.abortStream()

            streamErrorToastShown = false

            return
        }

        // done 终帧携带后端落盘结果(重答:覆盖后的消息含版本;发送:新消息),先本地更新再复位生成状态
        conversationStore.applyFinalMessage(detail?.finalMessage)

        conversationStore.endStream({ finalContent: detail?.finalContent })

        streamErrorToastShown = false
    }

    /** 停止生成:中断当前流并清空待发送队列 */
    function handleStop(): void {
        // 仅发起取消;生成状态与流式目标索引由 onEnd('aborted') 收尾复位,
        // 保证取消终帧的 applyFinalMessage 仍能定位到正确的目标消息(重答场景)
        if (chatStream.isSending) {
            chatStream.cancel()
        } else {
            conversationStore.abortStream()
        }

        conversationStore.clearQueue()
    }

    /** 删除单轮消息(用户消息 + 后续助手消息),同步后端 */
    async function handleDeleteMessage(message: ChatMessage): Promise<void> {
        if (message.role !== 'user') {
            return
        }

        const confirmed = await showConfirm({
            title: '删除消息',
            content: `确定删除第 ${message.index + 1} 条消息及其回复?`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            if (conversationStore.currentId) {
                await deleteMessage(conversationStore.currentId, message.index)
            }
        } catch {
            // 后端删除失败仍允许本地移除,提示用户
            showToast('后端删除失败,已仅从本地移除', 'warning')
        }

        conversationStore.removeMessagePair(message.index)

        showToast('消息已删除', 'success')
    }

    /** 是否为最后一条用户消息(仅最后一条可编辑,对齐原版) */
    function isLastUserMessage(message: ChatMessage): boolean {
        if (message.role !== 'user') {
            return false
        }

        const lastUser = conversationStore.messages
            .filter((item) => item.role === 'user')
            .pop()

        return lastUser ? lastUser.index === message.index : false
    }

    /** 编辑最后一条用户消息:保存内容后重答(对齐原版内联编辑) */
    async function handleEditUserMessage(message: ChatMessage, nextContent: string): Promise<void> {
        if (message.role !== 'user' || !isLastUserMessage(message)) {
            showToast('仅支持修改最后一条用户消息', 'warning')

            return
        }

        const content = String(nextContent || '').trim()

        if (!content || content === message.content) {
            return
        }

        try {
            if (conversationStore.currentId) {
                await updateMessageContent(conversationStore.currentId, message.index, content)
            }

            message.content = content
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')

            return
        }

        showToast('已保存,正在重新回答', 'info')

        await doSend(content, {
            enableThinking: true,
            enableWebSearch: false,
            enableTools: readCurrentToolsMode() !== 'off',
            toolsMode: readCurrentToolsMode(),
        })
    }

    /** 读取输入区当前 Tools 模式(重答/编辑重发沿用,对齐原版 tool_mode 取值) */
    function readCurrentToolsMode(): string {
        return chatInputRef.value?.getToolsMode() || 'auto_off'
    }

    /**
     * question 卡片作答:回答作为普通用户消息进入会话
     * (上一条助手消息以 await 收尾,模型自然把该消息当作问题的回答继续执行)
     */
    async function handleQuestionAnswer(_message: ChatMessage, _questionId: string, answer: string): Promise<void> {
        const content = String(answer || '').trim()

        if (!content) {
            return
        }

        if (chatStream.isSending) {
            showToast('已有回复生成中,请稍候', 'warning')

            return
        }

        await doSend(content, {
            enableThinking: true,
            enableWebSearch: false,
            enableTools: readCurrentToolsMode() !== 'off',
            toolsMode: readCurrentToolsMode(),
        })
    }

    /** 重答:通过后端 is_regenerate 机制覆盖目标回答并自动保存旧版本(对齐原版 startRegenerate) */
    async function handleRegenerate(assistantMessage: ChatMessage): Promise<void> {
        const userMessage = conversationStore.messages.find(
            (item) => item.role === 'user' && item.index === assistantMessage.index - 1
        )

        if (!userMessage) {
            showToast('未找到对应的用户消息', 'warning')

            return
        }

        if (chatStream.isSending) {
            showToast('已有回复生成中,请稍候', 'warning')

            return
        }

        const conversationId = conversationStore.currentId

        if (!conversationId) {
            showToast('当前对话尚未保存,无法重答', 'warning')

            return
        }

        // 本地清空目标回答,锁定流式更新该消息(后端将按 regenerate_index 截断上下文并覆盖)
        conversationStore.beginStreamAt(assistantMessage.index)

        // 重答即回到最新消息:恢复跟随底部,由消息变化监听执行滚动
        resumeBottomFollow()

        const accepted = await chatStream.send({
            message: String(userMessage.content || ''),
            conversationId,
            modelName: modelStore.selectedId || undefined,
            enableThinking: true,
            enableWebSearch: false,
            enableTools: readCurrentToolsMode() !== 'off',
            toolMode: readCurrentToolsMode(),
            includeContext: true,
            isRegenerate: true,
            regenerateIndex: assistantMessage.index,
        }, {
            onChunk: handleStreamChunk,
            onEnd: handleStreamEnd,
        })

        if (!accepted) {
            conversationStore.abortStream()

            showToast('发送冲突,请重试', 'warning')

            return
        }

        // 流式期间本地已增量更新目标消息;done 终帧携带后端落盘的最终消息(含版本),
        // 在 handleStreamEnd 中本地轻量收尾,无需全量重载
    }

    function handleToggleSidebar(): void {
        // 对齐原版:移动端(≤980px)顶栏按钮切换抽屉,桌面端才折叠(.sidebar.collapsed)
        if (window.matchMedia('(max-width: 980px)').matches) {
            document.body.classList.toggle('mobile-sidebar-open')

            return
        }

        sidebarCollapsed.value = !sidebarCollapsed.value
    }

    function handleToggleMobile(): void {
        document.body.classList.toggle('mobile-sidebar-open')
    }

    /** 打开/关闭云端文件右侧栏(经浮层协调器,自动互斥其他浮层) */
    function handleOpenFiles(): void {
        if (filesPanelOpen.value) {
            closePanel('files')

            return
        }

        openPanel('files')
    }

    /** 打开/关闭知识库右侧栏 */
    function handleOpenKnowledge(): void {
        if (knowledgePanelOpen.value) {
            closePanel('knowledge')

            return
        }

        openPanel('knowledge')
    }

    function handleOpenKnowledgeDocument(title: string): void {
        knowledgeTitle.value = title

        // 保留知识库面板:从右侧栏打开正文后仍可继续浏览文档列表
        openView('knowledge', { keepPanel: true })
    }

    /** 知识库被删除:若当前正文正打开该文档则返回聊天主视图 */
    function handleKnowledgeDocumentDeleted(title: string): void {
        if (knowledgeTitle.value !== title) {
            return
        }

        backToChat()
    }

    /** 侧边栏 Knowledge 按钮:打开/关闭知识库管理视图(对齐原版独立管理页,内嵌为视图) */
    function handleOpenKnowledgeMgmt(): void {
        if (knowledgeMgmtOpen.value) {
            backToChat()

            return
        }

        openView('knowledge-mgmt')
    }

    /** 侧边栏 Files 按钮:打开/关闭文件中心视图(对齐原版 openFilesFrameView 的互斥切换) */
    function handleOpenFileCenter(): void {
        if (filesCenterOpen.value) {
            backToChat()

            return
        }

        openView('files')
        fileDetail.value = null
    }

    /** 侧边栏 Workspaces 按钮:打开/关闭项目视图(对齐原版 openWorkspaceProjectsView) */
    function handleOpenWorkspaces(): void {
        if (workspacesOpen.value) {
            backToChat()

            return
        }

        openView('workspaces')

        // 进入项目视图即清空会话选中(对齐原版 clearCurrentConversationSelectionForWorkspaceNavigation),
        // 详情页输入框发送时才会懒创建新会话并归入项目;生成中不重置,避免流写入错误会话
        if (!conversationStore.generating) {
            void conversationStore.newConversation()
        }
    }

    /** 顶栏 Mail 按钮:打开/关闭邮件中心视图(与 Files/Workspaces 同为互斥内容级视图) */
    function handleOpenMailCenter(): void {
        if (mailCenterOpen.value) {
            backToChat()

            return
        }

        openView('mail')
    }

    /** 打开文件详情 */
    function openFileDetail(file: CloudFileItem): void {
        fileDetail.value = file
    }

    function handleFileDetailBack(): void {
        // 文件详情 → 文件中心列表(Workspace 文件已改为内置预览,不再借道此处)
        fileDetail.value = null
    }

    function handleOpenSettings(): void {
        settingsOpen.value = true
    }

    /** 回收站恢复条目后刷新会话列表(原版 restore 后 loadConversations) */
    async function handleTrashRestored(): Promise<void> {
        try {
            await conversationStore.loadConversations()
        } catch (error) {
            showError(error instanceof Error ? error.message : '刷新会话列表失败')
        }
    }

    /** 打开图片查看器(由消息附件图片点击触发);同时关闭其他浮层,保证全屏查看不被遮挡 */
    function handleOpenImage(url: string): void {
        closeAllOverlays()

        imageViewerUrl.value = url
    }

    /** 从消息创建会话分支(对齐原版 forkConversationFromMessage) */
    async function handleForkMessage(message: ChatMessage): Promise<void> {
        const conversationId = conversationStore.currentId

        if (!conversationId) {
            showToast('当前对话尚未保存,无法创建分支', 'warning')

            return
        }

        if (conversationStore.generating) {
            showToast('当前会话仍在生成,完成后才能创建分支', 'warning')

            return
        }

        try {
            const result = await forkConversation(conversationId, message.index)

            await conversationStore.loadConversations()

            await conversationStore.openConversation(result.conversation_id)

            showToast(`已创建分支:${result.title || result.conversation_id}`, 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '创建分支失败')
        }
    }

    /** 切换消息版本(对齐原版 switchVersion:后端返回切换后的消息,本地轻量替换,无需全量重载) */
    async function handleSwitchVersion(message: ChatMessage, versionIndex: number): Promise<void> {
        const conversationId = conversationStore.currentId

        if (!conversationId) {
            showToast('当前对话尚未保存', 'warning')

            return
        }

        if (conversationStore.generating) {
            showToast('当前会话仍在生成,请稍后再试', 'warning')

            return
        }

        try {
            const switched = await switchMessageVersion(conversationId, message.index, versionIndex)

            if (switched) {
                conversationStore.applyFinalMessage(switched, message.index)
            }
        } catch (error) {
            showError(error instanceof Error ? error.message : '切换版本失败')
        }
    }

    /** 查看分支处:打开父会话并跳转到分支消息(对齐原版 viewConversationBranchSourceFromContextMenu) */
    async function handleViewBranchSource(parentConversationId: string, messageIndex: number): Promise<void> {
        backToChat()

        // 主动跳转离开底部:暂停跟随,避免流式增量把视图拉回底部
        suspendBottomFollow()

        try {
            await conversationStore.openConversation(parentConversationId)

            await ensureMessageIndexLoadedWithRestore(messageIndex)

            await nextTick()

            const container = document.getElementById('messagesContainer')

            if (!container) {
                return
            }

            const target = container.querySelector<HTMLElement>(`.message[data-index="${Math.floor(messageIndex)}"]`)

            if (!target) {
                showToast('来源内容已变更或找不到', 'warning')

                return
            }

            const targetTop = Math.max(0, target.offsetTop - (container.clientHeight / 2) + (target.offsetHeight / 2))

            container.scrollTo({ top: targetTop, behavior: 'smooth' })

            target.classList.add('turn-jump-highlight')

            window.setTimeout(() => {
                target.classList.remove('turn-jump-highlight')
            }, 3000)
        } catch (error) {
            showError(error instanceof Error ? error.message : '跳转失败')
        }
    }

    /**
     * 向前补载一页后,按"新增内容高度"恢复滚动位置,使视口锚点不跳动。
     * 必须在 loadPreviousMessages 之前记录 prevScroll*,补载后调用。
     */
    function restoreScrollAfterPrepend(container: HTMLElement, prevScrollTop: number, prevScrollHeight: number): void {
        container.scrollTop = prevScrollTop + (container.scrollHeight - prevScrollHeight)
    }

    /**
     * 确保目标消息已加载(窗口化):循环向前补载,每补一页都在视图层恢复滚动位置,
     * 避免加载更早消息时视图向上漂移。最终由调用方滚动/高亮。
     */
    async function ensureMessageIndexLoadedWithRestore(messageIndex: number): Promise<boolean> {
        const target = Number(messageIndex)

        if (!Number.isFinite(target) || target < 0) {
            return false
        }

        if (conversationStore.messages.some((item) => Number(item.index) === target)) {
            return true
        }

        const container = document.getElementById('messagesContainer')
        let guard = 0

        while (
            guard < 80
            && conversationStore.hasMoreBefore
            && conversationStore.messages.length > 0
            && target < Number(conversationStore.messages[0].index)
        ) {
            guard += 1

            const prevScrollTop = container ? container.scrollTop : 0
            const prevScrollHeight = container ? container.scrollHeight : 0

            const added = await conversationStore.loadPreviousMessages()

            if (!added) {
                break
            }

            if (container) {
                await nextTick()
                restoreScrollAfterPrepend(container, prevScrollTop, prevScrollHeight)
            }

            if (conversationStore.messages.some((item) => Number(item.index) === target)) {
                break
            }
        }

        return conversationStore.messages.some((item) => Number(item.index) === target)
    }

    /**
     * 加载更早消息(对齐原版 loadPreviousConversationMessages):
     * 以"内容高度增量"恢复滚动位置,保证补载前后视觉不跳动、且不回到顶部触发连锁加载。
     */
    async function handleLoadPrevious(): Promise<void> {
        const container = document.getElementById('messagesContainer')

        if (!container || !conversationStore.hasMoreBefore || conversationStore.loadingBefore) {
            return
        }

        // 记录补载前的滚动位置与内容高度(用于按新增高度还原,而非依赖易出错的锚点偏移)
        const prevScrollTop = container.scrollTop
        const prevScrollHeight = container.scrollHeight

        prepending.value = true

        try {
            await conversationStore.loadPreviousMessages()
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载更早消息失败')
        } finally {
            await nextTick()

            restoreScrollAfterPrepend(container, prevScrollTop, prevScrollHeight)

            prepending.value = false
        }
    }

    /** 消息区滚动:更新跟随底部状态;滚动到顶部附近时自动加载更早消息(对齐原版 maybeLoadPrevious...) */
    function handleMessagesScroll(): void {
        const container = document.getElementById('messagesContainer')

        if (!container) {
            return
        }

        // 先更新跟随状态:距底部超过阈值视为用户主动上滑,暂停流式期间的自动滚底
        syncWithScroll(container)

        if (conversationStore.loadingBefore) {
            return
        }

        // 用户滚动到距顶部 40px 内且还有更早消息时触发
        if (container.scrollTop <= 40 && conversationStore.hasMoreBefore) {
            void handleLoadPrevious()
        }
    }

    /** 消息变化后滚动到底部(仅当跟随底部、非"加载更早消息"前置插入、且非会话加载中时) */
    watch(
        () => conversationStore.messages,
        async () => {
            // 会话加载期间消息先替换为占位高度,此时滚动会错位;交由 messagesLoading 监听收尾
            // 向前补载更早消息由其自身的滚动高度增量还原负责,避免被强行拉到底
            if (conversationStore.messagesLoading || prepending.value) {
                return
            }

            // 用户已上滑离开底部:不再强制拉回,保证生成中可自由回看(思考链展开时尤其关键)
            if (!autoFollowBottom.value) {
                return
            }

            await nextTick()

            const container = document.getElementById('messagesContainer')

            if (container && !conversationStore.loadingBefore) {
                container.scrollTop = container.scrollHeight
            }
        },
        { deep: true }
    )

    /** 会话加载完成:真实消息已渲染,恢复跟随并滚到底部展示最新一轮(避免停在顶部触发自动补载) */
    watch(
        () => conversationStore.messagesLoading,
        async (loading) => {
            if (loading) {
                return
            }

            await nextTick()

            const container = document.getElementById('messagesContainer')

            if (container) {
                followNow(container)
            }
        }
    )

    /** 切换会话:本次渲染即时显示(不触发消息渐入动画),下一帧移除标记恢复动画 */
    watch(
        () => conversationStore.currentId,
        async () => {
            await nextTick()

            const container = document.getElementById('messagesContainer')

            if (!container) {
                return
            }

            container.classList.add('instant-messages')

            requestAnimationFrame(() => {
                container.classList.remove('instant-messages')
            })
        }
    )

    onMounted(async () => {
        // Learning 偏好预取（不阻塞主流程，决定侧栏品牌栏是否显示 Learning）
        void refreshLearningPreference()

        // 会话列表与模型目录各自独立加载,单个失败不影响另一个
        try {
            await conversationStore.loadConversations()
        } catch (error) {
            showError(error instanceof Error ? error.message : '会话列表加载失败')
        }

        try {
            await modelStore.loadModels()
        } catch (error) {
            showError(error instanceof Error ? error.message : '模型列表加载失败')
        }

        // 地图渲染器:仅预取 provider 配置;脚本在消息出现真实地图结果时按需加载
        primeNexoraMapRendererConfig()

        chatInputRef.value?.focus()

        // 消息区滚动监听:滚动到顶部自动加载更早消息
        const container = document.getElementById('messagesContainer')

        container?.addEventListener('scroll', handleMessagesScroll, { passive: true })

        // 选区右键菜单:消息区域选中文本后右键显示(对齐原版 notesContextMenu)
        document.addEventListener('contextmenu', handleDocumentContextmenu)
        document.addEventListener('click', handleDocumentClick)

        // 跨刷新恢复:必须先重建分离缓冲,再打开会话(否则 openConversation 合并可见列表时
        // 缓冲还不存在,恢复内容既不上屏也不接续;顺序颠倒即"刷新后只有 Stop Generation")。
        const snapshot = chatStream.takeSnapshot()

        if (snapshot) {
            conversationStore.restorePendingStream(snapshot)
            console.debug(`[conv-load] restored stream registered conv=${snapshot.conversationId} seq=${snapshot.lastSeq}`)
        }

        // URL 直达:?cid= 指向的会话优先加载(对齐原前端"URL 目标 > 流恢复目标"的导航优先级);
        // 与恢复会话相同时,openConversation 内部会把缓冲助理消息合并进可见列表
        const urlConversationId = readConversationIdFromLocation()

        if (urlConversationId) {
            try {
                await conversationStore.openConversation(urlConversationId)
            } catch (error) {
                showError(error instanceof Error ? error.message : '打开会话失败')
            }
        }

        if (snapshot) {
            // 无 URL 直达目标(或目标即恢复会话)时才自动回到恢复中的会话;
            // URL 指向其他会话时流在后台续播并进入分离缓冲,切回时零丢失接回
            if (!urlConversationId || urlConversationId === snapshot.conversationId) {
                void conversationStore.openConversation(snapshot.conversationId).catch(() => {})
            }

            void chatStream.resume(
                {
                    streamId: snapshot.streamId,
                    fromSeq: snapshot.lastSeq,
                    conversationId: snapshot.conversationId,
                },
                {
                    onChunk: handleStreamChunk,
                    onEnd: handleStreamEnd,
                },
            )
        }

        // 临时诊断钩子(复现完成后移除)
        ;(window as unknown as { __dbgConv?: () => Record<string, unknown> }).__dbgConv = () => ({
            currentId: conversationStore.currentId,
            loading: conversationStore.messagesLoading,
            count: conversationStore.messages.length,
            generating: conversationStore.generating,
            streamingConv: conversationStore.streamingConversationId,
            target: conversationStore.streamingTargetIndex,
            pendingKeys: Object.keys(conversationStore.pendingStreams),
            lastContent: conversationStore.messages.length
                ? String(conversationStore.messages[conversationStore.messages.length - 1].content || '').slice(0, 80)
                : '',
        })
    })

    onBeforeUnmount(() => {
        const container = document.getElementById('messagesContainer')

        container?.removeEventListener('scroll', handleMessagesScroll)

        document.removeEventListener('contextmenu', handleDocumentContextmenu)
        document.removeEventListener('click', handleDocumentClick)
    })

    // 刷新/关闭前强制落盘活动流快照(节流窗口内的尾部增量不丢)
    window.addEventListener('beforeunload', () => {
        chatStream.persistSnapshot(true)
    })

    /** 在可选中文本区域右键且存在选区时,弹出选区菜单(对齐原版 contextmenu 监听) */
    function handleDocumentContextmenu(event: MouseEvent): void {
        const target = event.target as HTMLElement | null

        if (!target) {
            return
        }

        if (target.closest('button, a, input, textarea, select, .message')) {
            // 会话项右键走 ContextMenu,按钮/输入框不触发选区菜单
            if (!target.closest('.message')) {
                return
            }
        }

        const selection = window.getSelection()

        if (!selection || selection.isCollapsed || !selection.toString().trim()) {
            return
        }

        const text = normalizeSelectionText(selection.toString())

        if (!text) {
            return
        }

        event.preventDefault()

        // 定位来源:选区所在消息的 data-index + 当前会话(对齐原版 resolveSelectionSource)
        const messageEl = target.closest('.message') as HTMLElement | null
        const messageIndex = Number(messageEl?.dataset.index)

        const anchor = conversationStore.currentId && Number.isFinite(messageIndex)
            ? {
                type: 'chat' as const,
                conversationId: conversationStore.currentId,
                messageIndex,
            }
            : null

        selectionMenuRef.value?.open(text, event.clientX, event.clientY, anchor)
    }

    /** 点击菜单外任意处关闭选区菜单(对齐原版 click 监听);移动端点击侧边栏外空白关闭抽屉 */
    function handleDocumentClick(event: MouseEvent): void {
        if (selectionMenuRef.value?.isOpen()) {
            selectionMenuRef.value.close()
        }

        if (window.matchMedia('(max-width: 980px)').matches && document.body.classList.contains('mobile-sidebar-open')) {
            const sidebar = document.querySelector<HTMLElement>('.sidebar')
            const target = event.target as Node
            const toggleEls = document.querySelectorAll<HTMLElement>('#toggleSidebar, #toggleSidebarMobile')

            if (!sidebar || sidebar.contains(target)) {
                return
            }

            if (Array.from(toggleEls).some((el) => el.contains(target))) {
                return
            }

            document.body.classList.remove('mobile-sidebar-open')
        }
    }

    /** 选区文本归一化(对齐原版 normalizeSelectionTextForNotes:统一换行 + 去尾空白) */
    function normalizeSelectionText(raw: string): string {
        return String(raw || '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n[ \t]+/g, '\n')
            .trim()
    }

    /** 添加到笔记:写入 NotesPanel 并打开面板(anchor 记录来源会话与消息) */
    function handleAddNote(
        text: string,
        sourceTitle: string,
        anchor: NoteItem['anchor']
    ): void {
        notesPanelRef.value?.addNoteFromSelection(text, sourceTitle, anchor || undefined)
        notesOpen.value = true
    }

    /** 点击笔记来源:关闭面板 → 打开对应会话 → 滚动到对应消息(对齐原版 jumpToNoteAnchorPayload) */
    async function handleJumpToNoteSource(note: NoteItem): Promise<void> {
        const anchor = note.anchor

        if (!anchor || anchor.type !== 'chat' || !anchor.conversationId) {
            showToast('该笔记缺少来源定位信息', 'info')

            return
        }

        notesOpen.value = false

        // 回到聊天视图(若在 Files/Workspaces 中)
        backToChat()

        // 主动跳转离开底部:暂停跟随,避免流式增量把视图拉回底部
        suspendBottomFollow()

        try {
            await conversationStore.openConversation(anchor.conversationId)

            // 滚动到目标消息(对齐原版 messageIndex 定位):目标可能未加载,先补载
            if (typeof anchor.messageIndex === 'number') {
                await ensureMessageIndexLoadedWithRestore(anchor.messageIndex)

                await nextTick()

                const target = document.querySelector(`.message[data-index="${anchor.messageIndex}"]`)

                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' })

                    target.classList.add('turn-jump-highlight')

                    window.setTimeout(() => {
                        target.classList.remove('turn-jump-highlight')
                    }, 3000)
                }
            }
        } catch (error) {
            showError(error instanceof Error ? error.message : '跳转来源失败')
        }
    }

    /** 解释选中文本:输入框填入 解释 <text>(对齐原版 fillMessageInputWithExplainText) */
    function handleExplainSelection(text: string): void {
        const content = String(text || '').trim()

        if (!content) {
            showToast('请先选中文本', 'warning')

            return
        }

        // 若在 Files/Workspaces 视图,先回到聊天
        backToChat()

        chatInputRef.value?.fillDraft(`解释 ${content}`)

        showToast('已填入解释指令', 'success')
    }

    /** 全局搜索:新建对话(对齐原版 quickActions 的 createNewConversation) */
    function handleSearchNewConversation(): void {
        backToChat()

        conversationStore.newConversation()
    }

    /** 全局搜索:打开标题命中的会话(对齐原版 loadConversation) */
    async function handleSearchOpenConversation(conversationId: string): Promise<void> {
        backToChat()

        try {
            await conversationStore.openConversation(conversationId)
        } catch (error) {
            showError(error instanceof Error ? error.message : '打开会话失败')
        }
    }

    /**
     * 全局搜索:消息命中跳转(对齐原版 jumpToChatSource):
     * 目标会话不同则先切换;目标消息不在当前窗口时向前分页补载,再滚动高亮。
     */
    async function handleSearchJumpToMessage(hit: SearchMessageHit): Promise<void> {
        backToChat()

        // 主动跳转离开底部:暂停跟随,避免流式增量把视图拉回底部
        suspendBottomFollow()

        try {
            if (conversationStore.currentId !== hit.conversation_id) {
                await conversationStore.openConversation(hit.conversation_id)
            }

            await ensureMessageIndexLoadedWithRestore(hit.message_index)

            await nextTick()

            const target = document.querySelector(`.message[data-index="${hit.message_index}"]`)

            if (!target) {
                showToast('目标消息不存在或已删除', 'info')

                return
            }

            target.scrollIntoView({ behavior: 'smooth', block: 'start' })

            target.classList.add('turn-jump-highlight')

            window.setTimeout(() => {
                target.classList.remove('turn-jump-highlight')
            }, 3000)
        } catch (error) {
            showError(error instanceof Error ? error.message : '跳转消息失败')
        }
    }

    /** 全局搜索:打开知识库命中文档(对齐原版 viewKnowledge) */
    function handleSearchOpenKnowledge(title: string): void {
        handleOpenKnowledgeDocument(title)
    }

    /**
     * 全局搜索:打开云盘文件命中(对齐原版 openFilesFrameView + openFileCenterFileDetail):
     * 搜索结果仅含 alias/name,直接构造条目打开详情,由 FileDetailView 经 fileRef 读取。
     */
    function handleSearchOpenFile(hit: SearchFileHit): void {
        const file: CloudFileItem = {
            alias: hit.alias,
            name: hit.name,
            original_name: hit.name,
        }

        openView('files')
        fileDetail.value = file
    }
</script>

<style scoped>
    /* 加载更早消息入口(对齐原版 loadPreviousConversationMessages 的顶部触发交互) */
    .messages-history-load {
        display: flex;
        justify-content: center;
        padding: 10px 0 2px;
    }

    .messages-history-load-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 5px 14px;
        border: 1px solid var(--color-border);
        border-radius: 14px;
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        font-size: 12px;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }

    .messages-history-load-btn:hover:not(:disabled) {
        background: #f9fafb;
        color: var(--color-text-secondary);
        border-color: #d1d5db;
    }

    .messages-history-load-btn:disabled {
        opacity: 0.7;
        cursor: default;
    }

    .messages-history-loading-spinner {
        width: 12px;
        height: 12px;
        border: 2px solid #d1d5db;
        border-top-color: var(--color-text-secondary);
        border-radius: 50%;
        animation: messages-history-spin 0.8s linear infinite;
    }

    @keyframes messages-history-spin {
        to {
            transform: rotate(360deg);
        }
    }

    .messages-history-load-end {
        padding: 5px 14px;
        color: var(--color-text-secondary);
        font-size: 12px;
    }

    /* 切换会话加载占位:居中显示,既不闪欢迎页也不残留旧内容 */
    .messages-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        height: 100%;
        min-height: 240px;
        color: var(--color-text-secondary);
        font-size: 13px;
    }

    .messages-loading-spinner {
        width: 22px;
        height: 22px;
        border: 2px solid var(--color-border);
        border-top-color: var(--color-text-secondary);
        border-radius: 50%;
        animation: messages-history-spin 0.8s linear infinite;
    }
</style>
