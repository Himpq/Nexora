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
            @open-workspaces="handleOpenWorkspaces"
            @open-files="handleOpenFileCenter"
            @open-trash="trashOpen = true"
            @open-timeline="timelineOpen = true"
        />

        <main class="main-content">
            <ChatHeader
                :models="modelStore.models"
                :view="activeView"
                @toggle-sidebar="handleToggleSidebar"
                @open-notes="notesOpen = true"
                @open-files="handleOpenFiles"
                @open-knowledge="handleOpenKnowledge"
                @back-to-chat="backToChat"
            />

            <!-- 文件中心视图(对齐原版 openFilesFrameView:header 保留,内容区替换) -->
            <template v-if="filesCenterOpen">
                <FilesCenterView
                    :open="filesCenterOpen"
                    @close="backToChat"
                    @open-detail="openFileDetail"
                />
                <FileDetailView
                    v-if="fileDetail !== null"
                    :file="fileDetail"
                    @back="fileDetail = null"
                />
            </template>

            <!-- Workspaces 视图 -->
            <WorkspacesView v-else-if="workspacesOpen" @close="backToChat" @open-conversation="handleOpenWorkspaceConversation" />

            <template v-else>
                <div id="messagesContainer" class="messages-area">
                    <div v-if="!conversationStore.messages.length" class="welcome-screen">
                        <h1>Hello, {{ userStore.username }}.</h1>
                        <p>How can I assist you today?</p>
                    </div>

                    <template v-else>
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
                />
            </template>
        </main>

        <FilesPanel :open="filesPanelOpen" @close="closePanel('files')" @attach="handleAttachFile" />

        <KnowledgePanel :open="knowledgePanelOpen" @close="closePanel('knowledge')" />

        <SettingsModal :open="settingsOpen" @close="settingsOpen = false" />

        <TrashModal :open="trashOpen" @close="trashOpen = false" @restored="handleTrashRestored" />

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
    </div>
</template>

<script setup lang="ts">
    import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

    import type { ChatMessage } from '@/api/conversations'
    import type { AttachmentInput } from '@/api/attachments'
    import { deleteMessage, updateMessageContent } from '@/api/conversations'
    import { streamService, type StreamChunk } from '@/stream/StreamService'
    import { showConfirm } from '@/stores/confirm'
    import { useConversationStore } from '@/stores/conversation'
    import { useModelStore } from '@/stores/model'
    import { showError, showToast } from '@/stores/notify'
    import { useUserStore } from '@/stores/user'
    import { closeAllOverlays, closePanel, openPanel, overlay } from '@/ui/overlay'

    import ChatHeader from '@/components/ChatHeader.vue'
    import ChatInput from '@/components/ChatInput.vue'
    import FileDetailView from '@/components/FileDetailView.vue'
    import FilesCenterView from '@/components/FilesCenterView.vue'
    import FilesPanel from '@/components/FilesPanel.vue'
    import ImageViewer from '@/components/ImageViewer.vue'
    import KnowledgePanel from '@/components/KnowledgePanel.vue'
    import MessageItem from '@/components/MessageItem.vue'
    import NotesPanel from '@/components/NotesPanel.vue'
    import SelectionContextMenu from '@/components/SelectionContextMenu.vue'
    import SettingsModal from '@/components/SettingsModal.vue'
    import Sidebar from '@/components/Sidebar.vue'
    import TimelinePanel from '@/components/TimelinePanel.vue'
    import TrashModal from '@/components/TrashModal.vue'
    import TurnIndicatorPanel from '@/components/TurnIndicatorPanel.vue'
    import WorkspacesView from '@/components/WorkspacesView.vue'

    import type { CloudFileItem } from '@/api/files-center'
    import type { NoteItem } from '@/api/notes'

    const conversationStore = useConversationStore()
    const modelStore = useModelStore()
    const userStore = useUserStore()

    const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null)
    const settingsOpen = ref(false)
    const trashOpen = ref(false)
    const timelineOpen = ref(false)
    const notesOpen = ref(false)
    const sidebarCollapsed = ref(false)

    /** 文件中心:替换主内容区(对齐原版 openFilesFrameView);详情文件为 null 时显示列表 */
    const filesCenterOpen = ref(false)
    const fileDetail = ref<CloudFileItem | null>(null)

    /** Workspaces 项目视图:替换主内容区(对齐原版 openWorkspaceProjectsView) */
    const workspacesOpen = ref(false)

    /** 当前顶栏视图(对齐原版 headerTitle 切换:Files / Workspaces / 会话标题) */
    const activeView = computed<'chat' | 'files' | 'workspaces'>(() => {
        if (filesCenterOpen.value) {
            return 'files'
        }

        if (workspacesOpen.value) {
            return 'workspaces'
        }

        return 'chat'
    })

    /** 返回聊天视图(对齐原版 closeFileCenterOrReturn) */
    function backToChat(): void {
        filesCenterOpen.value = false
        workspacesOpen.value = false
        fileDetail.value = null
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

    /** 点击轮次线:跳转到该轮 + 高亮消息(对齐原版) */
    function handleTurnIndicatorJump(lineIndex: number): void {
        const userMessages = conversationStore.messages.filter((message) => message.role === 'user')
        const message = userMessages[lineIndex - 1] || null

        if (!message) {
            return
        }

        const target = document.querySelector(`.message.user[data-index="${message.index}"]`)

        if (!target) {
            return
        }

        target.scrollIntoView({ behavior: 'smooth', block: 'start' })

        // 跳转后临时高亮目标消息(3 秒后移除)
        target.classList.add('turn-jump-highlight')

        window.setTimeout(() => {
            target.classList.remove('turn-jump-highlight')
        }, 3000)
    }

    /** 最后一条助手消息在生成中时标记打字指示 */
    function isStreamingMessage(index: number): boolean {
        if (!conversationStore.generating) {
            return false
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

        // 错误块:显式上报,避免静默失败
        if (chunk.type === 'error') {
            conversationStore.abortStream()

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

    /** 流结束:按原因收尾;done 帧用完整内容兜底 */
    function handleStreamEnd(reason: 'done' | 'aborted' | 'error', info?: unknown): void {
        if (reason === 'error') {
            conversationStore.abortStream()

            const detail = info as { error?: string } | undefined

            showError(detail?.error || '回复生成失败,请重试')

            return
        }

        const detail = info as { finalContent?: string } | undefined

        conversationStore.endStream({ finalContent: detail?.finalContent })
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

    /** 重答:重新发送该轮用户消息(简单实现,对齐原版重答意图) */
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

        // 移除旧回答,重新发送用户消息
        conversationStore.removeMessagePair(userMessage.index)
        conversationStore.messages = conversationStore.messages.filter((item) => item.index !== userMessage.index)

        await doSend(String(userMessage.content || ''), {
            enableThinking: true,
            enableWebSearch: false,
            enableTools: true,
        })
    }

    function handleToggleSidebar(): void {
        // 对齐原版:.sidebar.collapsed 宽度归零隐藏
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

    /** 侧边栏 Files 按钮:打开/关闭文件中心视图(对齐原版 openFilesFrameView 的互斥切换) */
    function handleOpenFileCenter(): void {
        if (filesCenterOpen.value) {
            backToChat()

            return
        }

        workspacesOpen.value = false
        filesCenterOpen.value = true
        fileDetail.value = null
    }

    /** 侧边栏 Workspaces 按钮:打开/关闭项目视图(对齐原版 openWorkspaceProjectsView) */
    function handleOpenWorkspaces(): void {
        if (workspacesOpen.value) {
            backToChat()

            return
        }

        filesCenterOpen.value = false
        workspacesOpen.value = true
    }

    /** 打开文件详情 */
    function openFileDetail(file: CloudFileItem): void {
        fileDetail.value = file
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

    /** 消息变化后滚动到底部 */
    watch(
        () => conversationStore.messages,
        async () => {
            await nextTick()

            const container = document.getElementById('messagesContainer')

            if (container) {
                container.scrollTop = container.scrollHeight
            }
        },
        { deep: true }
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

        // 选区右键菜单:消息区域选中文本后右键显示(对齐原版 notesContextMenu)
        document.addEventListener('contextmenu', handleDocumentContextmenu)
        document.addEventListener('click', handleDocumentClick)
    })

    onBeforeUnmount(() => {
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

    /** 点击菜单外任意处关闭选区菜单(对齐原版 click 监听) */
    function handleDocumentClick(event: MouseEvent): void {
        const menu = document.querySelector('.notes-context-menu')

        if (menu && menu.contains(event.target as Node)) {
            return
        }

        if (selectionMenuRef.value?.isOpen()) {
            selectionMenuRef.value.close()
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
</script>
