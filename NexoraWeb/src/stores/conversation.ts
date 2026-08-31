/**
 * conversation.ts — 会话状态
 *
 * 职责:
 *   - 会话列表 / 当前会话 / 消息列表
 *   - 生成中的增量正文与思考内容、生成状态(由网络层 chatStream 驱动)
 */

import { defineStore } from 'pinia'

import type { AttachmentInput } from '@/api/attachments'
import { fetchTokenStats } from '@/api/tokens'
import {
    createConversation,
    deleteConversation,
    fetchMessages,
    fetchTurns,
    INITIAL_MESSAGE_LIMIT,
    listConversations,
    PREVIOUS_MESSAGE_LIMIT,
    type ChatMessage,
    type ConversationContextEvent,
    type ConversationBranch,
    type ConversationSummary,
    type ConversationTurn,
} from '@/api/conversations'
import { chatStream, type ChatStreamSnapshot } from '@/network/chatStream'
import { parseContextCompressionStep } from '@/stream/contextCompression'
import type { QuestionPayload } from '@/stream/questionCard'
import {
    appendSegmentDelta,
    appendToolSegment,
    rebuildSegmentsForMessage,
    rebuildSegmentsFromFlat,
    type MessageSegment,
} from '@/stream/messageSegments'
import { estimateStreamTokensByText, safeTokenInt } from '@/stream/tokenBudget'

interface ConversationState {
    conversations: ConversationSummary[]
    currentId: string
    messages: ChatMessage[]
    contextEvents: ConversationContextEvent[]
    generating: boolean
    loaded: boolean
    queue: QueuedMessage[]
    streamTokenProfile: Record<string, unknown> | null
    /** 是否还有更早的消息未加载(对齐原版 messageWindow.hasMoreBefore) */
    hasMoreBefore: boolean
    /** 正在加载更早消息(防重入,对齐原版 loadingBefore) */
    loadingBefore: boolean
    /** 流式更新的目标助手消息索引(重答时指向被覆盖的历史回答;null 表示最后一条) */
    streamingTargetIndex: number | null
    /** 当前流所属会话 ID:跨会话查看时用于隔离增量写入与指示器定位 */
    streamingConversationId: string
    /**
     * 进行中流的分离消息缓冲(会话 ID → 缓冲):
     * 流式增量始终写入这里挂名的助手对象,切走期间照常累积;
     * 切回该会话时把缓冲对象接回可见列表,实现零丢失的进度恢复。
     */
    pendingStreams: Record<string, PendingStream>
    /** 消息加载中(切换会话期间为真;模板据此显示加载占位而非欢迎页/旧内容) */
    messagesLoading: boolean
    /** 会话完整用户轮次(单独从 /turns 拉取,与窗口化消息解耦) */
    turns: ConversationTurn[]
    /** 加载序号:并发切换时丢弃过期结果,避免旧会话内容覆盖新会话 */
    loadSeq: number
    /** 输入区「TK 输入/输出」mini 展示状态(对齐原版 tokenMiniState) */
    tokenMini: {
        /** 今日基数:会话统计接口的 today_input/today_output */
        baseInput: number
        baseOutput: number
        /** 流式 usage 增量(token_usage 块快照差分) */
        streamInput: number
        streamOutput: number
        /** 流式正文/思考/工具参数增量估算输出(usage 未返回前先行展示) */
        estimatedStreamOutput: number
        usageSnapshotInput: number
        usageSnapshotOutput: number
        usageSnapshotInitialized: boolean
    }
}

/** 排队消息(生成中发送的内容进入队列,当前流结束后自动发送) */
export interface QueuedMessage {
    content: string
    conversationId?: string
    options: {
        enableThinking: boolean
        enableWebSearch: boolean
        enableTools: boolean
        /** Tools 模式(auto_off/force/off),原样传给后端 tool_mode */
        toolsMode: string
    }
    /** 该条消息携带的附件(进入队列即快照,避免后续变更影响) */
    attachments?: AttachmentInput[]
}

/** 进行中流的分离缓冲:助手对象独立于可见列表持续累积,切回时接回 */
interface PendingStream {
    /** 助手消息在其会话中的绝对索引 */
    targetIndex: number
    /** 分离累积的助手消息对象(单一数据源) */
    assistant: ChatMessage
    /** 新发送场景的用户消息对象(切回恢复用;重答场景为空) */
    userMessage?: ChatMessage
    /** 流已结束(done/aborted):缓冲保留至用户切回消费后释放 */
    finished?: boolean
}

/** 跨刷新活动流快照(sessionStorage 持久化结构) */
// TK mini 基数刷新序号:并发刷新(快速切换/连发)时只采纳最后一次结果
let tokenMiniRefreshSeq = 0

export const useConversationStore = defineStore('conversation', {
    state: (): ConversationState => ({
        conversations: [],
        currentId: '',
        messages: [],
        contextEvents: [],
        generating: false,
        loaded: false,
        queue: [],
        streamTokenProfile: null,
        hasMoreBefore: false,
        loadingBefore: false,
        streamingTargetIndex: null,
        streamingConversationId: '',
        pendingStreams: {},
        messagesLoading: false,
        turns: [],
        loadSeq: 0,
        tokenMini: {
            baseInput: 0,
            baseOutput: 0,
            streamInput: 0,
            streamOutput: 0,
            estimatedStreamOutput: 0,
            usageSnapshotInput: 0,
            usageSnapshotOutput: 0,
            usageSnapshotInitialized: false,
        },
    }),

    actions: {
        /**
         * 跨刷新恢复:重建分离缓冲并复位流式状态(网络层已读取/校验快照)。
         * 必须先于任何会话加载/跳转调用,否则可见列表无法合并恢复内容。
         */
        restorePendingStream(snapshot: ChatStreamSnapshot): void {
            this.pendingStreams[snapshot.conversationId] = {
                targetIndex: snapshot.targetIndex,
                assistant: { ...snapshot.assistant },
                userMessage: snapshot.userMessage,
            }

            this.generating = true
            this.streamingConversationId = snapshot.conversationId
            this.streamingTargetIndex = snapshot.targetIndex
            this.streamTokenProfile = null

            // 跨刷新恢复:以持久化统计重建今日基数(流式增量部分从断点重新累积)
            void this.refreshTokenMiniBase(snapshot.conversationId)
        },

        /**
         * 活动流快照内容源(供网络层 persistSnapshot 序列化):
         * 返回当前进行中流的缓冲消息上下文;无活动流返回 null。
         */
        buildStreamSnapshot(): {
            conversationId: string
            targetIndex: number
            assistant: ChatMessage
            userMessage?: ChatMessage
        } | null {
            const convId = this.streamingConversationId
            const pending = convId ? this.pendingStreams[convId] : undefined

            if (!pending || pending.finished) {
                return null
            }

            return {
                conversationId: convId,
                targetIndex: pending.targetIndex,
                assistant: pending.assistant,
                userMessage: pending.userMessage,
            }
        },

        /** 重连发现流已结束/不存在:把缓冲转为已完成态保留展示 */
        finishRestoredStream(): void {
            const convId = this.streamingConversationId
            const pending = convId ? this.pendingStreams[convId] : undefined

            if (pending) {
                pending.finished = true
                pending.assistant.pending = false
            }

            this.generating = false
            this.streamingConversationId = ''
            this.streamingTargetIndex = null

            // 快照已被消费/流已结束,不再保留陈旧快照
            chatStream.clearSnapshot()
        },

        /** 拉取会话列表 */
        async loadConversations(): Promise<void> {
            this.conversations = await listConversations()

            this.loaded = true
        },

        /** 新建会话(对齐原版:本地重置进入空白会话,发送时才真正创建) */
        async newConversation(): Promise<void> {
            // 生成中也允许新建:对齐原版 detachCurrentVisibleStreamForNavigation —
            // 后台流保留在 pendingStreams，切到空白会话，generating/streamingConversationId 保持指向旧会话
            // 侧栏仍显示旧会话的 streaming 指示，新会话为空白可立即输入
            this.currentId = ''
            this.messages = []
            this.hasMoreBefore = false
            this.loadingBefore = false
            this.streamingTargetIndex = null
            this.messagesLoading = false
            this.turns = []

            // 新对话无历史:清零 TK mini 今日基数与流式增量
            void this.refreshTokenMiniBase('')
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

        /**
         * 标记本地会话模式(learning 等):新建会话走懒创建,列表项未经后端回填
         * conversation_mode,发送路径在 dock 侧栏发首条消息时补标,保证
         * Learning 侧栏会话列表能即时过滤到该会话
         */
        setConversationMode(conversationId: string, mode: string): void {
            const item = this.conversations.find((entry) => entry.id === conversationId)

            if (item) {
                item.conversation_mode = mode
            }
        },

        /** 切换当前会话并加载消息(不立即清空旧消息,避免欢迎页闪烁) */
        async openConversation(conversationId: string): Promise<void> {
            if (!conversationId || conversationId === this.currentId) {
                return
            }

            const t0 = performance.now()

            console.debug(`[conv-load] open ${conversationId} start`)

            // 序号自增:本次加载期间若再次切换,过期结果将被丢弃
            const seq = ++this.loadSeq

            this.currentId = conversationId
            this.hasMoreBefore = false
            this.loadingBefore = false
            this.contextEvents = []
            this.streamingTargetIndex = null
            this.messagesLoading = true
            // 切换瞬间先清空旧轮次,避免指示器残留上一个会话的条目
            this.turns = []

            try {
                await this.loadMessages(seq)

                console.debug(`[conv-load] ${conversationId} messages done cost=${(performance.now() - t0).toFixed(0)}ms count=${this.messages.length}`)

                // 仅当本次加载未被更新的切换覆盖时才提交结果
                if (seq === this.loadSeq) {
                    // 切回带分离缓冲的会话(生成中或已完成未消费):
                    // 接回缓冲对象实现零丢失进度恢复,消费后释放
                    const pending = this.pendingStreams[conversationId]

                    if (pending) {
                        const list = this.messages

                        if (pending.userMessage && !list.some(
                            (item) => item.role === 'user' && Number(item.index) === Number(pending.userMessage!.index)
                        )) {
                            list.push(pending.userMessage)
                        }

                        const existingAssistant = list.find(
                            (item) => item.role === 'assistant' && Number(item.index) === pending.targetIndex
                        )

                        if (existingAssistant) {
                            // 列表直接持有缓冲对象(引用同一性):后续流式增量即时反映到可见消息。
                            // 严禁 Object.assign 拷贝——拷贝后列表与缓冲分叉,增量只写缓冲、界面冻结。
                            const bufferIndex = list.indexOf(existingAssistant)

                            list[bufferIndex] = pending.assistant
                        } else {
                            list.push(pending.assistant)
                        }

                        list.sort((a, b) => Number(a.index) - Number(b.index))

                        this.streamingTargetIndex = pending.targetIndex

                        if (pending.finished) {
                            delete this.pendingStreams[conversationId]

                            // 同步清理跨刷新快照,避免下次启动误重连已结束的流
                            chatStream.clearSnapshot()
                        }
                    }

                    await this.loadTurns()

                    // TK mini 基数随会话切换刷新(今日统计,非阻塞)
                    void this.refreshTokenMiniBase(conversationId)

                    console.debug(`[conv-load] ${conversationId} turns done total=${(performance.now() - t0).toFixed(0)}ms`)
                }
            } catch (error) {
                console.debug(`[conv-load] ${conversationId} ERROR cost=${(performance.now() - t0).toFixed(0)}ms`, error)

                // 加载失败:本次负责时清空,避免残留上一个会话的内容
                if (seq === this.loadSeq) {
                    this.messages = []
                    this.contextEvents = []
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
                this.contextEvents = []
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

            this.messages = rawMessages.map((message, offset) => toLocalMessage(message, startIndex + offset))
            this.contextEvents = Array.isArray(data.context_events) ? data.context_events : []
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

        setContextEvents(events: ConversationContextEvent[]): void {
            this.contextEvents = events.map((event) => ({ ...event }))
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
                    .map((message, offset) => toLocalMessage(message, startIndex + offset))
                    .filter((message) => !existing.has(Number(message.index)))

                if (older.length === 0) {
                    this.hasMoreBefore = false

                    return false
                }

                this.messages = [...older, ...this.messages]
                if (Array.isArray(data.context_events)) {
                    this.contextEvents = data.context_events
                }
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
                this.contextEvents = []
                this.hasMoreBefore = false
                this.loadingBefore = false
                this.streamingTargetIndex = null
                this.messagesLoading = false
                this.turns = []
            }
        },

        /** 发送前占位:追加用户消息并创建空的助手消息(对齐原版 appendUserMessageWithAttachments) */
        beginStream(userContent: string, attachments: AttachmentInput[] = []): void {
            // 新消息索引基于最后一条已有消息的后端索引递增,避免与分页加载的索引错位
            const lastIndex = this.messages.length > 0
                ? Number(this.messages[this.messages.length - 1].index)
                : -1
            const nextIndex = Number.isFinite(lastIndex) ? lastIndex + 1 : 0

            const userMessage: ChatMessage = {
                index: nextIndex,
                role: 'user',
                content: userContent,
                // 附件乐观展示：ChatView 已按沙箱路径快照，MessageItem 通过 metadata.attachments 渲染
                ...(attachments.length > 0 ? {
                    metadata: {
                        attachments: attachments.map((att) => ({
                            type: att.type || 'sandbox_file',
                            name: att.name || att.original_name || 'attachment',
                            mime: '',
                            url: att.sandbox_path ? `/api/files/download?file_ref=${encodeURIComponent(att.sandbox_path)}&inline=1` : '',
                            asset_url: att.sandbox_path ? `/api/files/download?file_ref=${encodeURIComponent(att.sandbox_path)}&inline=1` : '',
                            sandbox_path: att.sandbox_path || '',
                            stored_path: att.stored_path || '',
                            size: att.size,
                        })),
                    },
                } : {}),
            }

            // pending 驱动回复气泡尾部闪烁 ●(思考/等待首 token 动画,见 legacy style.css
            // .message.assistant.pending .message-content::after);发送与重答路径都必须置位,
            // 否则新发消息全程无打字指示。收尾(endStream/applyFinalMessage/abortStream)统一复位。
            const assistantMessage: ChatMessage = {
                index: nextIndex + 1,
                role: 'assistant',
                content: '',
                segments: [],
                pending: true,
            }

            this.messages.push(userMessage, assistantMessage)

            // 同步追加用户轮次(乐观更新):TurnIndicatorPanel 渲染轮次线依赖 turns,
            // 发消息时若不同步增长,对话进行中指示器不会刷新
            this.turns.push({
                index: nextIndex,
                role: 'user',
                content: userContent,
            })

            this.generating = true
            this.streamingConversationId = this.currentId
            this.streamingTargetIndex = assistantMessage.index

            // 新一轮流开始:清空上一轮的流式增量估算,今日基数继续沿用
            this.resetTokenMiniStreamPart()

            // 注册分离缓冲:切走期间增量照常写入该对象,切回时接回列表(零丢失)
            this.pendingStreams[this.currentId] = {
                targetIndex: assistantMessage.index,
                assistant: assistantMessage,
                userMessage,
            }

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
            assistant.segments = []
            assistant.pending = true
            assistant.compressionStep = null

            this.streamingTargetIndex = index
            this.streamingConversationId = this.currentId
            this.generating = true

            // 新一轮流开始:清空上一轮的流式增量估算,今日基数继续沿用
            this.resetTokenMiniStreamPart()

            // 注册分离缓冲(重答场景无新增用户消息)
            this.pendingStreams[this.currentId] = {
                targetIndex: index,
                assistant,
            }
        },

        /** 流式增量追加正文分段(与思考分段按输出顺序交错排列) */
        appendStreamText(delta: string): void {
            if (!delta) {
                return
            }

            appendSegmentDelta(this._resolveStreamingAssistant(), 'content', delta)

            this._accumulateStreamOutputEstimate(delta)
        },

        /** 流式增量追加思考分段(正文已输出后再次思考会新开分段,顺序追加) */
        appendStreamReasoning(delta: string): void {
            if (!delta) {
                return
            }

            appendSegmentDelta(this._resolveStreamingAssistant(), 'reasoning', delta)

            this._accumulateStreamOutputEstimate(delta)
        },

        /**
         * 流式追加工具/问题事件分段
         * (数据源:function_call_delta / function_call / function_result / question chunk)
         *
         * delta 阶段并入最后一个未闭合的同调用分段实现参数流式;
         * 完整 call 事件覆盖同调用的 delta 分段(消除拼接边界误差);
         * result 独立成段,保持与后端 process_steps 一致的时序;
         * question 为交互卡片分段,等待用户作答;
         * 以上分段均不参与扁平字段同步(content/reasoning 不受影响)。
         */
        appendStreamToolStep(step: Record<string, unknown>): void {
            const type = String(step.type || '').trim()

            if (type !== 'function_call_delta' && type !== 'function_call' && type !== 'function_result' && type !== 'question') {
                return
            }

            if (type === 'function_call_delta') {
                this._mergeStreamToolDelta(step)

                return
            }

            if (type === 'function_call') {
                this._finalizeStreamToolCall(step)

                return
            }

            if (type === 'question') {
                const payload = (step.question && typeof step.question === 'object')
                    ? step.question as QuestionPayload
                    : {}
                const segment: MessageSegment = {
                    type: 'question',
                    text: '',
                    name: 'question',
                    callId: String(step.call_id || ''),
                    question: payload,
                }

                appendToolSegment(this._resolveStreamingAssistant(), segment)

                return
            }

            if (type !== 'function_result') {
                return
            }

            const segment: MessageSegment = {
                type: 'function_result',
                text: String(step.result ?? ''),
                name: String(step.name || '').trim() || 'tool',
                callId: String(step.call_id || ''),
                modelVisibleResult: typeof step.model_visible_result === 'string'
                    ? step.model_visible_result
                    : undefined,
                round: Number(step.round) || undefined,
            }

            appendToolSegment(this._resolveStreamingAssistant(), segment)
        },

        /**
         * 自后向前定位"最近一个未闭合"的工具调用分段:
         * 逆序扫描中先遇到匹配 callId 的 function_result 即视为已闭合;
         * 先遇到匹配的 function_call 即为目标;文本/思考分段跳过。
         */
        _findOpenToolCallSegment(segments: MessageSegment[], callId: string): MessageSegment | undefined {
            for (let i = segments.length - 1; i >= 0; i -= 1) {
                const seg = segments[i]

                if (seg.type === 'function_call') {
                    return (!callId || !seg.callId || seg.callId === callId) ? seg : undefined
                }

                if (seg.type === 'function_result') {
                    const resCallId = String(seg.callId || '')

                    if (!callId || !resCallId || resCallId === callId) {
                        return undefined
                    }
                }
            }

            return undefined
        },

        /** 参数流式增量:并入未闭合调用分段;无则新开一个 delta 调用分段 */
        _mergeStreamToolDelta(step: Record<string, unknown>): void {
            const assistant = this._resolveStreamingAssistant()

            if (!assistant) {
                return
            }

            const segments = Array.isArray(assistant.segments) ? assistant.segments : []
            const callId = String(step.call_id || '')
            let target = this._findOpenToolCallSegment(segments, callId)

            if (!target) {
                target = {
                    type: 'function_call',
                    text: '',
                    name: String(step.name_delta || step.name || '').trim() || 'tool',
                    callId,
                }

                segments.push(target)

                assistant.segments = segments
            }
            else if (target.name === 'tool' && String(step.name_delta || '').trim()) {
                target.name = String(step.name_delta).trim()
            }

            const argsDelta = String(step.arguments_delta ?? step.delta ?? '')

            if (argsDelta) {
                target.text += argsDelta

                // 工具调用参数同样占用输出 token,计入 TK mini 估算(对齐原版 onTokenStreamToolArgsChunk)
                this._accumulateStreamOutputEstimate(argsDelta)
            }
        },

        /** 完整调用事件:覆盖未闭合的同调用分段(delta 拼接可能有边界误差);无则独立成段 */
        _finalizeStreamToolCall(step: Record<string, unknown>): void {
            const assistant = this._resolveStreamingAssistant()

            if (!assistant) {
                return
            }

            const segments = Array.isArray(assistant.segments) ? assistant.segments : []
            const callId = String(step.call_id || '')
            const fullName = String(step.name || '').trim() || 'tool'
            const fullArgs = String(step.arguments ?? '')
            const target = this._findOpenToolCallSegment(segments, callId)

            if (target) {
                target.text = fullArgs
                target.name = fullName

                if (callId) {
                    target.callId = callId
                }

                return
            }

            appendToolSegment(assistant, {
                type: 'function_call',
                text: fullArgs,
                name: fullName,
                callId,
                round: Number(step.round) || undefined,
            })
        },

        /** 流结束:终帧完整正文覆盖后复位生成状态(分段结构保留流式时序,不再塌缩重建) */
        endStream(options: { finalContent?: string } = {}): void {
            const convId = this.streamingConversationId
            const pending = convId ? this.pendingStreams[convId] : undefined
            const assistant = pending ? pending.assistant : this._resolveStreamingAssistant()

            // 仅当服务端全文非空且与本地增量拼接不一致(罕见漂移)时才按扁平字段重建;
            // 空 finalContent(部分后端场景)不覆盖本地累积
            if (assistant && options.finalContent != null && String(options.finalContent).trim() !== '') {
                const finalText = String(options.finalContent)

                if (finalText !== String(assistant.content || '')) {
                    assistant.content = finalText

                    rebuildSegmentsFromFlat(assistant)
                }
            }

            if (assistant) {
                assistant.pending = false
            }

            // 正在查看该会话时同步可见列表的 pending 标记
            if (this.streamingConversationId === this.currentId && this.streamingTargetIndex !== null) {
                const target = this.messages.find(
                    (message) => message.role === 'assistant' && Number(message.index) === Number(this.streamingTargetIndex)
                )

                if (target) {
                    target.pending = false
                }
            }

            // 缓冲保留(标记 finished):用户切回消费后才释放,防止后台完成时内容丢失
            if (pending) {
                pending.finished = true
            }

            this.generating = false
            this.streamingConversationId = ''
            this.streamingTargetIndex = null

            // 流结束:刷新 TK mini 今日基数(含本轮回写)并清空流式增量
            void this.refreshTokenMiniBase(convId)
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

            // 活动流的缓冲对象优先(跨会话场景下可见列表可能根本不是流所属会话)
            const convId = this.streamingConversationId
            const pending = convId ? this.pendingStreams[convId] : undefined

            if (pending) {
                const explicit = Number(targetIndex)

                if (!Number.isFinite(explicit) || explicit === pending.targetIndex) {
                    assistant = pending.assistant
                }
            }

            if (!assistant) {
                const preferIndex = Number.isFinite(Number(targetIndex))
                    ? Number(targetIndex)
                    : this.streamingTargetIndex

                if (preferIndex !== null && preferIndex !== undefined && Number.isFinite(preferIndex)) {
                    assistant = this.messages.find(
                        (item) => item.role === 'assistant' && Number(item.index) === preferIndex
                    )
                }
            }

            if (!assistant) {
                console.error('[conversation] final message target not found', {
                    conversationId: convId,
                    currentId: this.currentId,
                    targetIndex,
                })

                return
            }

            if (!assistant || assistant.role !== 'assistant') {
                return
            }

            if (Object.prototype.hasOwnProperty.call(message, 'content')) {
                const incoming = typeof message.content === 'string'
                    ? message.content
                    : String(message.content || '')
                // 空字符串的终帧不覆盖本地已累积的流式正文，避免“突然变空再刷新”的闪烁
                if (String(incoming || '').trim() !== '') {
                    assistant.content = incoming
                } else if (String(assistant.content || '').trim() === '') {
                    // 本地也为空时才允许空覆盖（纯工具流/错误流场景）
                    assistant.content = incoming
                }
            }

            // 版本切换会改写落盘时间戳;不同步会让版本导航签名匹配失败而错位
            if (typeof message.timestamp === 'string' && message.timestamp) {
                assistant.timestamp = message.timestamp
            }

            const v4Fields = [
                'status',
                'model',
                'summary',
                'usage',
                'trace',
                'error',
                'versions',
                'attachments',
                'memory_analysis',
                'memory_io_tokens',
            ] as const

            v4Fields.forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(message, key)) {
                    ;(assistant as Record<string, unknown>)[key] = message[key]
                }
            })

            if (message.metadata && typeof message.metadata === 'object') {
                assistant.metadata = {
                    ...(assistant.metadata && typeof assistant.metadata === 'object'
                        ? (assistant.metadata as Record<string, unknown>)
                        : {}),
                    ...(message.metadata as Record<string, unknown>),
                }

                // 服务器终帧携带 v4 trace 后，压缩卡片以服务器持久化数据为准。
                assistant.compressionStep = null
            }

            // 终帧覆盖后按 v4 trace.events 重建分段，保留工具链与 diff 展示数据。
            // 若后端 trace 缺少 content 导致重建后 content 被清空，用本地已累积的正文兜底，避免闪空
            const preContent = String(assistant.content || '')
            const preContentTrim = preContent.trim()
            const preSegments = Array.isArray(assistant.segments) ? [...assistant.segments] : []
            rebuildSegmentsForMessage(assistant)
            if (String(assistant.content || '').trim() === '' && preContentTrim !== '') {
                assistant.content = preContent
                const hasContentSeg = Array.isArray(assistant.segments) && assistant.segments.some(seg => seg.type === 'content' && String(seg.text || '').trim() !== '')
                if (!hasContentSeg) {
                    const contentSegs = preSegments.filter(seg => seg.type === 'content' || seg.type === 'reasoning')
                    assistant.segments = [...(assistant.segments || []), ...contentSegs]
                }
                // 保证 content 与 segments 一致
                if (String(assistant.content || '').trim() === '') {
                    assistant.content = preContent
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

            const assistant = this._resolveStreamingAssistant()

            if (!assistant || assistant.role !== 'assistant') {
                return
            }

            // 错误文本追加为 error 分段(渲染为消息内红色错误行,对齐原版 appendErrorEvent);
            // 保留既有分段时序,不塌缩重建
            appendSegmentDelta(assistant, 'error', text)

            assistant.pending = false
        },

        /** 中断流:复位生成状态;分离缓冲保留(含已落盘部分内容)至用户切回消费 */
        abortStream(): void {
            const convId = this.streamingConversationId

            if (this.streamingConversationId === this.currentId && this.streamingTargetIndex !== null) {
                const target = this.messages.find(
                    (message) => message.role === 'assistant' && Number(message.index) === Number(this.streamingTargetIndex)
                )

                if (target) {
                    target.pending = false
                }
            }

            const pending = this.streamingConversationId
                ? this.pendingStreams[this.streamingConversationId]
                : undefined

            if (pending) {
                pending.finished = true

                if (this.streamingConversationId === this.currentId) {
                    // 正在查看:立即消费释放
                    delete this.pendingStreams[this.streamingConversationId]
                }
            }

            this.generating = false
            this.streamingConversationId = ''
            this.streamingTargetIndex = null

            // 流结束(含中断):刷新 TK mini 今日基数并清空流式增量(对齐原版 finishTokenMiniStreaming)
            void this.refreshTokenMiniBase(convId)
        },

        /**
         * 定位当前流式更新的目标助手消息:
         * 始终返回分离缓冲对象(pendingStreams 注册的单一数据源)——
         * 无论用户当前查看哪个会话,增量都持续累积在缓冲里,切回时零丢失。
         */
        _resolveStreamingAssistant(): ChatMessage | undefined {
            const convId = this.streamingConversationId
            const pending = convId ? this.pendingStreams[convId] : undefined

            if (pending) {
                return pending.assistant
            }

            const targetIndex = this.streamingTargetIndex

            const assistant = targetIndex !== null
                ? this.messages.find((message) => message.role === 'assistant' && Number(message.index) === Number(targetIndex))
                : this.messages[this.messages.length - 1]

            return assistant && assistant.role === 'assistant' ? assistant : undefined
        },

        /** 更新当前正在生成的助手消息(重答时更新目标索引消息,否则更新最后一条) */
        _updateStreamingAssistant(patch: Partial<ChatMessage>): void {
            const assistant = this._resolveStreamingAssistant()

            if (assistant) {
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

        /**
         * 记录上下文压缩状态到当前助手消息(数据源:context_compression_status chunk)
         *
         * 只保留最新一条:后端按 start → done/skipped 顺序推送,后到者覆盖前态,
         * 与历史回放 process_steps 取最后一条的语义一致(对齐原版 upsertContextCompressionCard)。
         */
        setStreamingContextCompression(step: Record<string, unknown>): void {
            const parsed = parseContextCompressionStep(step)

            if (!parsed) {
                return
            }

            this._updateStreamingAssistant({ compressionStep: parsed })
        },

        // ── TK mini(输入区 tokenDisplay)──────────

        /** 新一轮流开始:重置流式增量估算(今日基数保留,对齐原版 resetTokenMiniStreamPart) */
        resetTokenMiniStreamPart(): void {
            const mini = this.tokenMini

            mini.streamInput = 0
            mini.streamOutput = 0
            mini.estimatedStreamOutput = 0
            mini.usageSnapshotInput = 0
            mini.usageSnapshotOutput = 0
            mini.usageSnapshotInitialized = false
        },

        /**
         * 刷新 TK mini 今日基数(对齐原版 refreshTokenMiniForConversation):
         * 以会话统计接口的今日输入/输出为基数;非阻塞,失败保留旧值。
         */
        async refreshTokenMiniBase(conversationId: string): Promise<void> {
            const seq = ++tokenMiniRefreshSeq
            const cid = String(conversationId || '').trim()

            this.resetTokenMiniStreamPart()

            if (!cid) {
                this.tokenMini.baseInput = 0
                this.tokenMini.baseOutput = 0

                return
            }

            try {
                const stats = await fetchTokenStats(cid)

                if (seq !== tokenMiniRefreshSeq) {
                    return
                }

                this.tokenMini.baseInput = Number(stats.today_input || 0)
                this.tokenMini.baseOutput = Number(stats.today_output || 0)
            } catch {
                // 统计拉取失败(网络/未登录等)保持旧基数,不阻塞聊天主流程
            }
        },

        /**
         * 流式 usage 块累积(token_usage chunk):快照差分,防止同一轮 usage 重复计账;
         * 输入与输出快照独立处理,避免 output 回退时把 input 也当成整段增量。
         * 对齐原版 onTokenStreamUsageChunk。
         */
        accumulateStreamUsage(chunk: Record<string, unknown>): void {
            if (!this.generating) {
                return
            }

            const mini = this.tokenMini
            const inTokens = safeTokenInt(chunk.input_tokens)
            const outTokens = safeTokenInt(chunk.output_tokens)

            if (!mini.usageSnapshotInitialized) {
                mini.streamInput += inTokens
                mini.streamOutput += outTokens
                mini.usageSnapshotInput = inTokens
                mini.usageSnapshotOutput = outTokens
                mini.usageSnapshotInitialized = true

                return
            }

            if (inTokens >= mini.usageSnapshotInput) {
                mini.streamInput += (inTokens - mini.usageSnapshotInput)
            } else {
                mini.streamInput += inTokens
            }

            if (outTokens >= mini.usageSnapshotOutput) {
                mini.streamOutput += (outTokens - mini.usageSnapshotOutput)
            } else {
                mini.streamOutput += outTokens
            }

            mini.usageSnapshotInput = inTokens
            mini.usageSnapshotOutput = outTokens
        },

        /** 流式正文/思考/工具参数增量 → 输出 token 估算(对齐原版 onTokenStreamTextChunk 等) */
        _accumulateStreamOutputEstimate(deltaText: string): void {
            if (!this.generating) {
                return
            }

            const text = String(deltaText || '')

            if (!text) {
                return
            }

            this.tokenMini.estimatedStreamOutput += estimateStreamTokensByText(text)
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

    getters: {
        currentConversation(state): ConversationSummary | undefined {
            return state.conversations.find((item) => item.id === state.currentId)
        },

        /** 当前浏览会话是否有未完成流，和后台其他会话的生成状态严格分离。 */
        currentConversationGenerating(state): boolean {
            if (!state.currentId || !state.generating || state.streamingConversationId !== state.currentId) {
                return false
            }

            const pending = state.pendingStreams[state.currentId]

            return !!pending && !pending.finished
        },

        /**
         * 输入区 「TK 输入/输出」mini 展示(对齐原版 renderTokenMiniFromState):
         * 输入 = 今日基数 + usage 增量;输出 = 今日基数 + max(usage 输出, 估算输出)。
         */
        tokenMiniText(state): { input: string; output: string } {
            const mini = state.tokenMini
            const input = mini.baseInput + mini.streamInput
            const outputStream = Math.max(mini.streamOutput, mini.estimatedStreamOutput)
            const output = mini.baseOutput + outputStream

            return {
                input: input.toLocaleString(),
                output: output.toLocaleString(),
            }
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
})

/** 分支树排列行(深度 + 孤儿标记,对齐原版 arrangeConversationBranchRows 输出) */
export interface ConversationBranchRow {
    conversation: ConversationSummary
    depth: number
    orphan: boolean
}

/** 原始消息 → 本地消息(补齐绝对索引;助手消息按持久化数据重建分段,优先 process_steps) */
function toLocalMessage(message: ChatMessage, index: number): ChatMessage {
    const local: ChatMessage = { ...message, index }

    rebuildSegmentsForMessage(local)

    return local
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
