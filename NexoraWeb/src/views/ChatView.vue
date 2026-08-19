<!--
    ChatView.vue — 对话主界面(原版布局)

    结构(与原版 chat.html 一致):
      .app-container > nav.sidebar + main.main-content
        main > header.chat-header + #messagesContainer + .input-dock
-->

<template>
    <div class="app-container">
        <Sidebar
            :collapsed="sidebarCollapsed"
            @toggle-mobile="handleToggleMobile"
            @open-settings="handleOpenSettings"
            @open-chat="backToChat"
            @open-workspaces="handleOpenWorkspaces"
            @open-files="handleOpenFileCenter"
            @open-knowledge-mgmt="handleOpenKnowledgeMgmt"
            @open-trash="trashOpen = true"
            @open-timeline="timelineOpen = true"
            @view-branch-source="handleViewBranchSource"
        />

        <main class="main-content">
            <ChatHeader
                :models="modelStore.models"
                :view="activeView"
                :knowledge-title="knowledgeTitle"
                @toggle-sidebar="handleToggleSidebar"
                @open-notes="notesOpen = true"
                @open-files="handleOpenFiles"
                @open-knowledge="handleOpenKnowledge"
                @back-to-chat="handleHeaderBack"
            />

            <div class="gddp-view-stage">
                <!-- 聊天节点常驻,Files/Workspace 仅覆盖显示,避免返回时重新渲染对话。 -->
                <div v-show="activeView === 'chat'" class="gddp-chat-view">
                <div id="messagesContainer" class="messages-area">
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
                            @delete="handleDeleteMessage"
                            @edit-save="handleEditUserMessage"
                            @regenerate="handleRegenerate"
                            @open-image="handleOpenImage"
                            @fork="handleForkMessage"
                            @switch-version="handleSwitchVersion"
                        />
                    </template>
                </div>

                <!-- Turn Indicator(对齐原版:有对话轮次即显示,当前轮高亮) -->
                <TurnIndicatorPanel
                    :messages="conversationStore.messages"
                    @jump="handleTurnIndicatorJump"
                />

                <ChatInput
                    ref="chatInputRef"
                    :attachments="pendingAttachments"
                    @send="handleSend"
                    @stop="handleStop"
                    @remove-attachment="pendingAttachments.splice($event, 1)"
                    @open-token-detail="tokenDetailOpen = true"
                />
                </div>

                <div v-show="filesCenterOpen" class="gddp-content-view">
                    <FilesCenterView
                        v-if="fileDetail === null"
                        :open="filesCenterOpen"
                        @close="backToChat"
                        @open-detail="openFileDetail"
                    />
                    <section v-else class="file-center-view" aria-label="Files">
                        <div class="file-center-shell">
                            <FileDetailView :file="fileDetail" />
                        </div>
                    </section>
                </div>

                <div v-show="workspacesOpen" class="gddp-content-view">
                    <WorkspacesView
                        ref="workspacesViewRef"
                        :open="workspacesOpen"
                        @close="backToChat"
                        @open-conversation="handleOpenWorkspaceConversation"
                        @open-file="handleOpenWorkspaceFile"
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
    import { streamService, type StreamChunk } from '@/stream/StreamService'
    import { showConfirm } from '@/stores/confirm'
    import { useConversationStore } from '@/stores/conversation'
    import { useModelStore } from '@/stores/model'
    import { showError, showToast } from '@/stores/notify'
    import { useUserStore } from '@/stores/user'
    import { closeAllOverlays, closePanel, openPanel, openView, overlay } from '@/ui/overlay'

    import ChatHeader from '@/components/ChatHeader.vue'
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
    import MessageItem from '@/components/MessageItem.vue'
    import NotesPanel from '@/components/NotesPanel.vue'
    import SelectionContextMenu from '@/components/SelectionContextMenu.vue'
    import SettingsModal from '@/components/SettingsModal.vue'
    import Sidebar from '@/components/Sidebar.vue'
    import TimelinePanel from '@/components/TimelinePanel.vue'
    import TokenDetailModal from '@/components/TokenDetailModal.vue'
    import TrashModal from '@/components/TrashModal.vue'
    import TurnIndicatorPanel from '@/components/TurnIndicatorPanel.vue'
    import WorkspacesView from '@/components/WorkspacesView.vue'

    import type { CloudFileItem } from '@/api/files-center'
    import type { NoteItem } from '@/api/notes'
    import type { SearchFileHit, SearchMessageHit } from '@/api/search'

    const conversationStore = useConversationStore()
    const modelStore = useModelStore()
    const userStore = useUserStore()

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

    /** 文件中心:替换主内容区(对齐原版 openFilesFrameView);详情文件为 null 时显示列表 */
    const fileDetail = ref<CloudFileItem | null>(null)
    const fileDetailReturnView = ref<'files' | 'workspace'>('files')

    /** Workspaces 视图引用:顶栏返回需先回项目首页(详情内容 → 首页 → 聊天) */
    const workspacesViewRef = ref<InstanceType<typeof WorkspacesView> | null>(null)

    /** 内容级视图统一由浮层协调器(GDDP)单一状态机管理,切换时彼此互斥 */
    const filesCenterOpen = computed(() => overlay.view === 'files')
    const workspacesOpen = computed(() => overlay.view === 'workspaces')
    const knowledgeMgmtOpen = computed(() => overlay.view === 'knowledge-mgmt')
    const knowledgeOpen = computed(() => overlay.view === 'knowledge')
    const knowledgeTitle = ref('')

    /** 当前顶栏视图(对齐原版 headerTitle 切换:Files / Workspaces / 会话标题) */
    const activeView = computed<'chat' | 'files' | 'workspaces' | 'knowledge' | 'knowledge-mgmt'>(() => {
        return overlay.view || 'chat'
    })

    /** 返回聊天视图(对齐原版 closeFileCenterOrReturn) */
    function backToChat(): void {
        closeAllOverlays()

        knowledgeTitle.value = ''
        fileDetail.value = null
        fileDetailReturnView.value = 'files'
    }

    /** 原版 Files 返回行为:详情返回文件列表,列表才返回聊天。
     *  Workspace 内容多级返回:文件详情 → Workspace 首页 → 聊天 */
    function handleHeaderBack(): void {
        // 文件详情:先从内容返回其来源视图(文件中心首页 / Workspaces 首页)
        if (filesCenterOpen.value && fileDetail.value !== null) {
            handleFileDetailBack()

            return
        }

        // Workspaces 详情内容:先返回 Workspaces 首页
        if (workspacesOpen.value && workspacesViewRef.value?.isInDetail()) {
            workspacesViewRef.value.backToList()

            return
        }

        backToChat()
    }

    /** 从 Workspaces 详情点击对话:回到聊天并打开该会话(对齐原版 workspace 对话跳转) */
    async function handleOpenWorkspaceConversation(conversationId: string): Promise<void> {
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

    /**
     * 轮次预览点击跳转(对齐原版 scrollToAndHighlight):
     * 目标消息居中于消息视口(而非顶部对齐),跳转后临时高亮 3 秒;
     * 跳转期间的滚动跟随屏蔽由 TurnIndicatorPanel 内部 _isJumping 等价逻辑处理
     */
    function handleTurnIndicatorJump(messageIndex: number): void {
        const container = document.getElementById('messagesContainer')
        const target = container
            ? container.querySelector<HTMLElement>(`.message.user[data-index="${messageIndex}"]`)
            : null

        if (!container || !target) {
            return
        }

        const targetTop = Math.max(0, target.offsetTop - (container.clientHeight / 2) + (target.offsetHeight / 2))

        container.scrollTo({
            top: targetTop,
            behavior: 'smooth'
        })

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

    /** 发送:唯一入口,经 StreamService 同步锁防重入;生成中消息自动入队 */
    async function handleSend(content: string, options: {
        enableThinking: boolean
        enableWebSearch: boolean
        enableTools: boolean
    }): Promise<void> {
        // 附件随消息快照,进入队列/发送后清空输入区附件条(对齐原版发送后 reset files)
        const attachments = pendingAttachments.value.slice()

        // 生成中:消息进入待发送队列,当前流结束后自动发送(消息队列功能)
        if (streamService.isSending) {
            conversationStore.enqueueMessage({ content, options, attachments })

            pendingAttachments.value = []

            showToast(`已加入发送队列(共 ${conversationStore.queueCount} 条)`, 'info')

            return
        }

        // 无会话时先创建(对齐原版懒创建;await 期间可能被并发触发,返回后二次检查)
        if (!conversationStore.currentId) {
            await conversationStore.ensureConversationId()

            if (streamService.isSending) {
                conversationStore.enqueueMessage({ content, options, attachments })

                pendingAttachments.value = []

                return
            }
        }

        await doSend(content, options, attachments)
    }

    /** 执行一次真实发送(经 StreamService 同步锁) */
    async function doSend(content: string, options: {
        enableThinking: boolean
        enableWebSearch: boolean
        enableTools: boolean
    }, attachments: AttachmentInput[] = []): Promise<void> {
        // 发送前确保会话存在
        const conversationId = await conversationStore.ensureConversationId()

        conversationStore.beginStream(content)

        const accepted = await streamService.send({
            message: content,
            conversationId,
            modelName: modelStore.selectedId || undefined,
            enableThinking: options.enableThinking,
            enableWebSearch: options.enableWebSearch,
            enableTools: options.enableTools,
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

            if (conversationStore.queueCount > 0 && !streamService.isSending) {
                const next = conversationStore.dequeueNext()

                if (next) {
                    void doSend(next.content, next.options, next.attachments || [])
                }
            }
        }
    )

    /** 处理流式数据块:按类型分发增量正文/思考/会话元信息/错误 */
    function handleStreamChunk(chunk: StreamChunk): void {
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
        }
    }

    /** 流结束:按原因收尾;done 终帧携带后端落盘的最终消息,本地轻量更新(对齐原版流结束即时收尾) */
    function handleStreamEnd(reason: 'done' | 'aborted' | 'error', info?: unknown): void {
        const detail = info as { error?: string; finalContent?: string; finalMessage?: Record<string, unknown> } | undefined

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

        // done 终帧携带后端落盘结果(重答:覆盖后的消息含版本;发送:新消息),先本地更新再复位生成状态
        conversationStore.applyFinalMessage(detail?.finalMessage)

        conversationStore.endStream({ finalContent: detail?.finalContent })

        streamErrorToastShown = false
    }

    /** 停止生成:中断当前流并清空待发送队列 */
    function handleStop(): void {
        streamService.cancel()

        conversationStore.abortStream()

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
            enableTools: true,
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

        if (streamService.isSending) {
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

        const accepted = await streamService.send({
            message: String(userMessage.content || ''),
            conversationId,
            modelName: modelStore.selectedId || undefined,
            enableThinking: true,
            enableWebSearch: false,
            enableTools: true,
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
    }

    /** 打开文件详情 */
    function openFileDetail(file: CloudFileItem): void {
        fileDetail.value = file
        fileDetailReturnView.value = 'files'
    }

    /** Workspace 文件复用 Files 详情视图,返回时恢复原 Workspace 详情页。 */
    function handleOpenWorkspaceFile(file: CloudFileItem): void {
        openView('files')
        fileDetail.value = file
        fileDetailReturnView.value = 'workspace'
    }

    function handleFileDetailBack(): void {
        fileDetail.value = null

        if (fileDetailReturnView.value === 'workspace') {
            openView('workspaces')
            // 从 Workspace 内容返回时重置到项目首页,而非停留在详情页
            workspacesViewRef.value?.backToList()
        }

        fileDetailReturnView.value = 'files'
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

        try {
            await conversationStore.openConversation(parentConversationId)

            await conversationStore.ensureMessageIndexLoaded(messageIndex)

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
     * 加载更早消息(对齐原版 loadPreviousConversationMessages):
     * 保存当前首条消息的 DOM 位置 → 加载 → nextTick 后恢复滚动,保证视觉不跳动。
     */
    async function handleLoadPrevious(): Promise<void> {
        const container = document.getElementById('messagesContainer')

        if (!container || !conversationStore.hasMoreBefore || conversationStore.loadingBefore) {
            return
        }

        const anchorMessage = container.querySelector<HTMLElement>('.message')
        const anchorOffset = anchorMessage ? anchorMessage.offsetTop - container.scrollTop : 0

        try {
            await conversationStore.loadPreviousMessages()
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载更早消息失败')
        } finally {
            await nextTick()

            // 恢复滚动位置:加载后首条消息仍在原位
            const restored = container.querySelector<HTMLElement>('.message')

            if (restored && anchorMessage) {
                const addedHeight = restored.offsetTop - anchorMessage.offsetTop

                container.scrollTop = anchorMessage.offsetTop - anchorOffset + addedHeight
            } else {
                container.scrollTop = container.scrollHeight
            }
        }
    }

    /** 滚动到顶部附近时自动加载更早消息(对齐原版 maybeLoadPreviousConversationMessagesFromScroll) */
    function handleMessagesScroll(): void {
        const container = document.getElementById('messagesContainer')

        if (!container || conversationStore.loadingBefore) {
            return
        }

        // 用户滚动到距顶部 40px 内且还有更早消息时触发
        if (container.scrollTop <= 40 && conversationStore.hasMoreBefore) {
            void handleLoadPrevious()
        }
    }

    /** 消息变化后滚动到底部(仅当非"加载更早消息"前置插入时) */
    watch(
        () => conversationStore.messages,
        async () => {
            await nextTick()

            const container = document.getElementById('messagesContainer')

            if (container && !conversationStore.loadingBefore) {
                container.scrollTop = container.scrollHeight
            }
        },
        { deep: true }
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

        chatInputRef.value?.focus()

        // 消息区滚动监听:滚动到顶部自动加载更早消息
        const container = document.getElementById('messagesContainer')

        container?.addEventListener('scroll', handleMessagesScroll, { passive: true })

        // 选区右键菜单:消息区域选中文本后右键显示(对齐原版 notesContextMenu)
        document.addEventListener('contextmenu', handleDocumentContextmenu)
        document.addEventListener('click', handleDocumentClick)
    })

    onBeforeUnmount(() => {
        const container = document.getElementById('messagesContainer')

        container?.removeEventListener('scroll', handleMessagesScroll)

        document.removeEventListener('contextmenu', handleDocumentContextmenu)
        document.removeEventListener('click', handleDocumentClick)
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
        const menu = document.querySelector('.notes-context-menu')

        if (menu && menu.contains(event.target as Node)) {
            return
        }

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

        try {
            await conversationStore.openConversation(anchor.conversationId)

            // 滚动到目标消息(对齐原版 messageIndex 定位)
            if (typeof anchor.messageIndex === 'number') {
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

        try {
            if (conversationStore.currentId !== hit.conversation_id) {
                await conversationStore.openConversation(hit.conversation_id)
            }

            await conversationStore.ensureMessageIndexLoaded(hit.message_index)

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
        fileDetailReturnView.value = 'files'
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
        border: 1px solid #e5e7eb;
        border-radius: 14px;
        background: #fff;
        color: #6b7280;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }

    .messages-history-load-btn:hover:not(:disabled) {
        background: #f9fafb;
        color: #374151;
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
        border-top-color: #6b7280;
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
        color: #9ca3af;
        font-size: 12px;
    }
</style>
