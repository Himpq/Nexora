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
    listConversations,
    type ChatMessage,
    type ConversationSummary,
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
    }),

    getters: {
        currentConversation(state): ConversationSummary | undefined {
            return state.conversations.find((item) => item.id === state.currentId)
        },

        /** 待发送队列长度(供 UI 显示徽标) */
        queueCount(state): number {
            return state.queue.length
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

        /** 切换当前会话并加载消息 */
        async openConversation(conversationId: string): Promise<void> {
            if (!conversationId || conversationId === this.currentId) {
                return
            }

            this.currentId = conversationId

            await this.loadMessages()
        },

        /** 加载当前会话消息(最近 100 条);补齐后端绝对索引 */
        async loadMessages(): Promise<void> {
            if (!this.currentId) {
                this.messages = []

                return
            }

            const data = await fetchMessages(this.currentId, { limit: 100 })

            const rawMessages = Array.isArray(data.messages) ? data.messages : []
            const startIndex = Number(data.start_index || 0)

            this.messages = rawMessages.map((message, offset) => ({
                ...message,
                index: startIndex + offset,
            }))
        },

        /** 删除会话(当前会话删除后清空选择) */
        async removeConversation(conversationId: string): Promise<void> {
            await deleteConversation(conversationId)

            this.conversations = this.conversations.filter((item) => item.id !== conversationId)

            if (this.currentId === conversationId) {
                this.currentId = ''
                this.messages = []
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

            this.generating = false
            this.streamText = ''
            this.streamReasoning = ''
        },

        /** 中断流:复位生成状态,保留已生成的部分文本 */
        abortStream(): void {
            this.generating = false
            this.streamText = ''
            this.streamReasoning = ''
        },

        /** 更新当前正在生成的助手消息(最后一条 assistant) */
        _updateStreamingAssistant(patch: Partial<ChatMessage>): void {
            const assistant = this.messages[this.messages.length - 1]

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
