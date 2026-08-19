/**
 * conversation.ts — 会话状态
 *
 * 职责:
 *   - 会话列表 / 当前会话 / 消息列表
 *   - 生成中的增量正文与思考内容、生成状态(由 StreamService 驱动)
 */

import { defineStore } from 'pinia'

import type { AttachmentInput } from '@/api/attachments'
import {
    createConversation,
    deleteConversation,
    fetchMessages,
    fetchTurns,
    INITIAL_MESSAGE_LIMIT,
    listConversations,
    PREVIOUS_MESSAGE_LIMIT,
    type ChatMessage,
    type ConversationBranch,
    type ConversationSummary,
    type ConversationTurn,
} from '@/api/conversations'

interface ConversationState {
    conversations: ConversationSummary[]
    currentId: string
    messages: ChatMessage[]
    generating: boolean
    streamText: string
    streamReasoning: string
    loaded: boolean
    queue: QueuedMessage[]
    streamTokenProfile: Record<string, unknown> | null
    /** 是否还有更早的消息未加载(对齐原版 messageWindow.hasMoreBefore) */
    hasMoreBefore: boolean
    /** 正在加载更早消息(防重入,对齐原版 loadingBefore) */
    loadingBefore: boolean
    /** 流式更新的目标助手消息索引(重答时指向被覆盖的历史回答;null 表示最后一条) */
    streamingTargetIndex: number | null
    /** 消息加载中(切换会话期间为真;模板据此显示加载占位而非欢迎页/旧内容) */
    messagesLoading: boolean
    /** 会话完整用户轮次(单独从 /turns 拉取,与窗口化消息解耦) */
    turns: ConversationTurn[]
    /** 加载序号:并发切换时丢弃过期结果,避免旧会话内容覆盖新会话 */
    loadSeq: number
}

/** 排队消息(生成中发送的内容进入队列,当前流结束后自动发送) */
export interface QueuedMessage {
    content: string
    options: {
        enableThinking: boolean
        enableWebSearch: boolean
        enableTools: boolean
    }
    /** 该条消息携带的附件(进入队列即快照,避免后续变更影响) */
    attachments?: AttachmentInput[]
}

export const useConversationStore = defineStore('conversation', {
    state: (): ConversationState => ({
        conversations: [],
        currentId: '',
        messages: [],
        generating: false,
        streamText: '',
        streamReasoning: '',
        loaded: false,
        queue: [],
        streamTokenProfile: null,
        hasMoreBefore: false,
        loadingBefore: false,
        streamingTargetIndex: null,
        messagesLoading: false,
        turns: [],
        loadSeq: 0,
    }),

    getters: {
        currentConversation(state): ConversationSummary | undefined {
            return state.conversations.find((item) => item.id === state.currentId)
        },

        /** 待发送队列长度(供 UI 显示徽标) */
        queueCount(state): number {
            return state.queue.length
        },

        /**
         * 侧边栏会话分支树行(对齐原版 arrangeConversationBranchRows):
         * 分支会话紧跟在父会话之后按深度缩进,孤儿分支排在末尾。
         */
        branchRows(state): ConversationBranchRow[] {
            return arrangeConversationBranchRows(state.conversations)
        },
    },

    actions: {
        /** 拉取会话列表 */
        async loadConversations(): Promise<void> {
            this.conversations = await listConversations()

            this.loaded = true
        },

        /** 新建会话(对齐原版:本地重置进入空白会话,发送时才真正创建) */
        async newConversation(): Promise<void> {
            // 生成中禁止新建:避免流式文本写入错误会话
            if (this.generating) {
                return
            }

            this.currentId = ''
            this.messages = []
            this.streamText = ''
            this.streamReasoning = ''
            this.hasMoreBefore = false
            this.loadingBefore = false
            this.streamingTargetIndex = null
            this.messagesLoading = false
            this.turns = []
        },

        /** 确保存在会话 ID;为空时调用后端创建(发送路径使用) */
        async ensureConversationId(): Promise<string> {
            if (this.currentId) {
                return this.currentId
            }

            const result = await createConversation()

            this.currentId = result.conversation_id

            this.conversations.unshift({
                id: result.conversation_id,
                title: result.title,
            })

            return this.currentId
        },

        /** 切换当前会话并加载消息(不立即清空旧消息,避免欢迎页闪烁) */
        async openConversation(conversationId: string): Promise<void> {
            if (!conversationId || conversationId === this.currentId) {
                return
            }

            // 序号自增:本次加载期间若再次切换,过期结果将被丢弃
            const seq = ++this.loadSeq

            this.currentId = conversationId
            this.hasMoreBefore = false
            this.loadingBefore = false
            this.streamingTargetIndex = null
            this.messagesLoading = true
            // 切换瞬间先清空旧轮次,避免指示器残留上一个会话的条目
            this.turns = []

            try {
                await this.loadMessages(seq)

                // 仅当本次加载未被更新的切换覆盖时才提交结果
                if (seq === this.loadSeq) {
                    await this.loadTurns()
                }
            } catch (error) {
                // 加载失败:本次负责时清空,避免残留上一个会话的内容
                if (seq === this.loadSeq) {
                    this.messages = []
                    this.turns = []
                }

                throw error
            } finally {
                // 仅当仍是本次加载负责时复位加载态,避免覆盖后续切换的加载中状态
                if (seq === this.loadSeq) {
                    this.messagesLoading = false
                }
            }
        },

        /** 加载当前会话消息(最近 INITIAL_MESSAGE_LIMIT 条作为初始窗口);补齐后端绝对索引 */
        async loadMessages(seq?: number): Promise<void> {
            if (!this.currentId) {
                this.messages = []
                this.hasMoreBefore = false
                this.loadingBefore = false
                this.streamingTargetIndex = null

                return
            }

            const data = await fetchMessages(this.currentId, { limit: INITIAL_MESSAGE_LIMIT })

            // 加载期间发生切换:丢弃过期结果,避免旧会话内容覆盖当前会话
            if (Number.isFinite(seq) && seq !== this.loadSeq) {
                return
            }

            const rawMessages = Array.isArray(data.messages) ? data.messages : []
            const startIndex = Number(data.start_index || 0)

            this.messages = rawMessages.map((message, offset) => ({
                ...message,
                index: startIndex + offset,
            }))
            this.hasMoreBefore = !!data.has_more_before
            this.loadingBefore = false
        },

        /** 拉取会话完整用户轮次(对齐原版 /turns 单独获取,与窗口化消息解耦) */
        async loadTurns(): Promise<void> {
            if (!this.currentId) {
                this.turns = []

                return
            }

            this.turns = await fetchTurns(this.currentId)
        },

        /**
         * 加载更早消息并前置合并(对齐原版 loadPreviousConversationMessages):
         * 以当前最早消息索引为 before 拉取上一页,按后端绝对索引去重合并到头部。
         * 返回是否真正加载了新消息。
         */
        async loadPreviousMessages(limit = PREVIOUS_MESSAGE_LIMIT): Promise<boolean> {
            if (!this.currentId || !this.hasMoreBefore || this.loadingBefore || this.messages.length === 0) {
                return false
            }

            const firstIndex = Number(this.messages[0].index)

            if (!Number.isFinite(firstIndex) || firstIndex <= 0) {
                this.hasMoreBefore = false

                return false
            }

            this.loadingBefore = true

            try {
                const data = await fetchMessages(this.currentId, { limit, before: firstIndex })

                const rawMessages = Array.isArray(data.messages) ? data.messages : []
                const startIndex = Number(data.start_index || 0)

                if (rawMessages.length === 0) {
                    this.hasMoreBefore = false

                    return false
                }

                // 按后端绝对索引去重合并(避免与已有消息重叠)
                const existing = new Set(this.messages.map((message) => Number(message.index)))
                const older = rawMessages
                    .map((message, offset) => ({
                        ...message,
                        index: startIndex + offset,
                    }))
                    .filter((message) => !existing.has(Number(message.index)))

                if (older.length === 0) {
                    this.hasMoreBefore = false

                    return false
                }

                this.messages = [...older, ...this.messages]
                this.hasMoreBefore = !!data.has_more_before

                return true
            } finally {
                this.loadingBefore = false
            }
        },

        /** 删除会话(当前会话删除后清空选择) */
        async removeConversation(conversationId: string): Promise<void> {
            await deleteConversation(conversationId)

            this.conversations = this.conversations.filter((item) => item.id !== conversationId)

            if (this.currentId === conversationId) {
                this.currentId = ''
                this.messages = []
                this.hasMoreBefore = false
                this.loadingBefore = false
                this.streamingTargetIndex = null
                this.messagesLoading = false
                this.turns = []
            }
        },

        /** 发送前占位:追加用户消息并创建空的助手消息 */
        beginStream(userContent: string): void {
            // 新消息索引基于最后一条已有消息的后端索引递增,避免与分页加载的索引错位
            const lastIndex = this.messages.length > 0
                ? Number(this.messages[this.messages.length - 1].index)
                : -1
            const nextIndex = Number.isFinite(lastIndex) ? lastIndex + 1 : 0

            const userMessage: ChatMessage = {
                index: nextIndex,
                role: 'user',
                content: userContent,
            }

            const assistantMessage: ChatMessage = {
                index: nextIndex + 1,
                role: 'assistant',
                content: '',
            }

            this.messages.push(userMessage, assistantMessage)
            this.generating = true
            this.streamText = ''
            this.streamReasoning = ''

            // 乐观更新会话标题(首条消息截断),等待后端自动生成标题时保持可辨识
            if (this.currentId) {
                const current = this.conversations.find((item) => item.id === this.currentId)

                if (current && (!current.title || current.title === '新对话')) {
                    const title = userContent.replace(/\s+/g, ' ').slice(0, 20)

                    current.title = title || '新对话'
                }
            }
        },

        /** 重答流式:清空目标助手消息并锁定流式更新目标索引(对齐原版 resetAssistantMessageForLiveStream) */
        beginStreamAt(assistantIndex: number): void {
            const index = Number(assistantIndex)

            if (!Number.isFinite(index) || index < 0) {
                return
            }

            const assistant = this.messages.find(
                (message) => message.role === 'assistant' && Number(message.index) === index
            )

            if (!assistant) {
                return
            }

            assistant.content = ''
            assistant.reasoning = ''
            assistant.pending = true

            this.streamingTargetIndex = index
            this.generating = true
            this.streamText = ''
            this.streamReasoning = ''
        },

        /** 流式增量追加正文到助手消息 */
        appendStreamText(delta: string): void {
            if (!delta) {
                return
            }

            this.streamText += delta

            this._updateStreamingAssistant({ content: this.streamText })
        },

        /** 流式增量追加思考内容到助手消息 */
        appendStreamReasoning(delta: string): void {
            if (!delta) {
                return
            }

            this.streamReasoning += delta

            this._updateStreamingAssistant({ reasoning: this.streamReasoning })
        },

        /** 流结束:用 done 终帧的完整内容兜底覆盖,再复位生成状态 */
        endStream(options: { finalContent?: string } = {}): void {
            if (options.finalContent) {
                this.streamText = options.finalContent

                this._updateStreamingAssistant({ content: options.finalContent })
            }

            if (this.streamingTargetIndex !== null) {
                const target = this.messages.find(
                    (message) => message.role === 'assistant' && Number(message.index) === Number(this.streamingTargetIndex)
                )

                if (target) {
                    target.pending = false
                }
            }

            this.generating = false
            this.streamText = ''
            this.streamReasoning = ''
            this.streamingTargetIndex = null
        },

        /**
         * 用后端 done 终帧携带的最终消息覆盖本地目标消息
         *
         * 定位顺序:目标索引参数 > 当前流式目标索引 > 最后一条助手消息;
         * 重答时更新被覆盖的消息,普通发送时更新最后一条,覆盖内容与
         * metadata.versions(版本切换器数据源),避免全量重载。
         */
        applyFinalMessage(message: Record<string, unknown> | undefined, targetIndex?: number | null): void {
            if (!message || typeof message !== 'object') {
                return
            }

            let assistant: ChatMessage | undefined

            const preferIndex = Number.isFinite(Number(targetIndex))
                ? Number(targetIndex)
                : this.streamingTargetIndex

            if (preferIndex !== null && preferIndex !== undefined && Number.isFinite(preferIndex)) {
                assistant = this.messages.find(
                    (item) => item.role === 'assistant' && Number(item.index) === preferIndex
                )
            }

            if (!assistant) {
                assistant = this.messages[this.messages.length - 1]
            }

            if (!assistant || assistant.role !== 'assistant') {
                return
            }

            if (typeof message.content === 'string') {
                assistant.content = message.content
            }

            if (message.metadata && typeof message.metadata === 'object') {
                assistant.metadata = {
                    ...(assistant.metadata && typeof assistant.metadata === 'object'
                        ? (assistant.metadata as Record<string, unknown>)
                        : {}),
                    ...(message.metadata as Record<string, unknown>),
                }
            }

            assistant.pending = false
        },

        /**
         * 将错误文本写入当前流式目标消息
         *
         * 重连失败等场景拿不到后端终帧消息时,目标消息可能被清空;
         * 用错误文本填充,保证用户能看到失败原因而非空白气泡。
         */
        fillStreamingMessageWithError(errorText: string): void {
            const text = String(errorText || '回复生成失败').trim()

            const targetIndex = this.streamingTargetIndex

            const assistant = targetIndex !== null
                ? this.messages.find((message) => message.role === 'assistant' && Number(message.index) === Number(targetIndex))
                : this.messages[this.messages.length - 1]

            if (!assistant || assistant.role !== 'assistant') {
                return
            }

            if (assistant.content) {
                assistant.content = `${assistant.content}\n\n${text}`
            } else {
                assistant.content = text
            }

            assistant.pending = false
        },

        /** 中断流:复位生成状态,保留已生成的部分文本 */
        abortStream(): void {
            if (this.streamingTargetIndex !== null) {
                const target = this.messages.find(
                    (message) => message.role === 'assistant' && Number(message.index) === Number(this.streamingTargetIndex)
                )

                if (target) {
                    target.pending = false
                }
            }

            this.generating = false
            this.streamText = ''
            this.streamReasoning = ''
            this.streamingTargetIndex = null
        },

        /** 更新当前正在生成的助手消息(重答时更新目标索引消息,否则更新最后一条) */
        _updateStreamingAssistant(patch: Partial<ChatMessage>): void {
            const targetIndex = this.streamingTargetIndex

            const assistant = targetIndex !== null
                ? this.messages.find((message) => message.role === 'assistant' && Number(message.index) === Number(targetIndex))
                : this.messages[this.messages.length - 1]

            if (assistant && assistant.role === 'assistant') {
                Object.assign(assistant, patch)
            }
        },

        /** 流式过程中同步模型名到当前助手消息(数据源:model_info chunk) */
        setStreamingModelName(modelName: string): void {
            if (!modelName) {
                return
            }

            this._updateStreamingAssistant({ model_name: modelName })
        },

        /** 记录本次请求的 token 画像(prompt_token_profile chunk,CTX/Token 展示数据源) */
        setStreamingTokenProfile(profile: Record<string, unknown>): void {
            this.streamTokenProfile = { ...profile }
        },

        /** 消息入队(生成中调用;当前流结束后由 ChatView 自动发送下一条) */
        enqueueMessage(message: QueuedMessage): void {
            this.queue.push(message)
        },

        /** 取出下一条待发送消息;无则返回 null */
        dequeueNext(): QueuedMessage | null {
            if (this.queue.length === 0) {
                return null
            }

            return this.queue.shift() || null
        },

        /** 删除单轮消息:用户消息及其后一条助手消息(对齐原版删除行为) */
        removeMessagePair(userIndex: number): void {
            const idx = Number(userIndex)

            this.messages = this.messages.filter((message) => {
                if (message.index === idx) {
                    return false
                }

                if (message.role === 'assistant' && message.index === idx + 1) {
                    return false
                }

                return true
            })
        },

        /** 本地更新会话置顶状态并重排(置顶在前,对齐后端排序) */
        setConversationPinLocal(conversationId: string, pin: boolean): void {
            const item = this.conversations.find((entry) => entry.id === conversationId)

            if (!item) {
                return
            }

            item.pin = pin

            this.conversations.sort((a, b) => {
                const aPin = a.pin ? 1 : 0
                const bPin = b.pin ? 1 : 0

                if (aPin !== bPin) {
                    return bPin - aPin
                }

                return 0
            })
        },

        /** 本地更新会话标题 */
        setConversationTitleLocal(conversationId: string, title: string): void {
            const item = this.conversations.find((entry) => entry.id === conversationId)

            if (item) {
                item.title = title
            }
        },

        /** 清空待发送队列(用户停止生成时调用,避免自动连发) */
        clearQueue(): void {
            this.queue = []
        },
    },
})

/** 分支树排列行(深度 + 孤儿标记,对齐原版 arrangeConversationBranchRows 输出) */
export interface ConversationBranchRow {
    conversation: ConversationSummary
    depth: number
    orphan: boolean
}

/** 读取会话分支信息(对齐原版 readConversationBranch) */
function readConversationBranch(item: ConversationSummary): ConversationBranch | null {
    const branch = item.branch && typeof item.branch === 'object' ? item.branch : null

    if (!branch) {
        return null
    }

    const rootConversationId = String(branch.root_conversation_id || '').trim()
    const parentConversationId = String(branch.parent_conversation_id || '').trim()
    const parentMessageIndex = Number(branch.parent_message_index)

    if (!rootConversationId || !parentConversationId || !Number.isInteger(parentMessageIndex)) {
        return null
    }

    return {
        root_conversation_id: rootConversationId,
        parent_conversation_id: parentConversationId,
        parent_message_index: parentMessageIndex,
        created_at: String(branch.created_at || '').trim(),
    }
}

/**
 * 将会话列表排列为分支树行(对齐原版 arrangeConversationBranchRows):
 * 普通会话按原始顺序,分支会话排在其父会话之后并逐层缩进,深度上限 6;
 * 父会话缺失(孤儿分支)与未访问会话排到末尾。
 */
function arrangeConversationBranchRows(conversations: ConversationSummary[]): ConversationBranchRow[] {
    const ordered = Array.isArray(conversations) ? conversations : []
    const byId = new Map<string, ConversationSummary>()
    const childrenByParent = new Map<string, ConversationSummary[]>()
    const roots: Array<{ conversation: ConversationSummary; orphan: boolean }> = []

    ordered.forEach((conversation) => {
        if (conversation.id) {
            byId.set(conversation.id, conversation)
        }
    })

    ordered.forEach((conversation) => {
        const branch = readConversationBranch(conversation)

        if (!branch || !byId.has(branch.parent_conversation_id)) {
            roots.push({ conversation, orphan: !!branch })

            return
        }

        const siblings = childrenByParent.get(branch.parent_conversation_id) || []
        siblings.push(conversation)
        childrenByParent.set(branch.parent_conversation_id, siblings)
    })

    const rows: ConversationBranchRow[] = []
    const visited = new Set<string>()

    function appendConversation(conversation: ConversationSummary, depth: number, orphan: boolean): void {
        if (!conversation.id || visited.has(conversation.id)) {
            return
        }

        visited.add(conversation.id)
        rows.push({ conversation, depth, orphan: !!orphan })

        const children = childrenByParent.get(conversation.id) || []

        children.forEach((child) => {
            appendConversation(child, Math.min(depth + 1, 6), false)
        })
    }

    roots.forEach((row) => {
        appendConversation(row.conversation, 0, row.orphan)
    })

    ordered.forEach((conversation) => {
        if (conversation.id && !visited.has(conversation.id)) {
            appendConversation(conversation, 0, true)
        }
    })

    return rows
}
