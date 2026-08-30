/**
 * chatStream.ts — 聊天流「网络层」(全站唯一网络入口)
 *
 * 职责(流式请求/续播/取消/会话游标/快照持久化统一收拢到这一层,组件不再各自探查):
 *   - 发送同步锁:send() 入口立即检查并占位,任何 await 之前完成,杜绝重复回车竞态
 *   - SSE 协议解析:与后端 /api/chat/stream 一致,块 1:1 归一为 ChatStreamChunk 分发
 *   - 断点续播 resume():跨刷新按 stream_id + from_seq 续播;服务端从 from_seq+1 起
 *     不回放已消费块(见 stream_runtime.iter_session_chunks),层内 lastSeq 单调递增
 *   - 会话游标(streamId/conversationId/lastSeq/AbortController)本层唯一持有
 *   - 活动流快照:sessionStorage 节流持久化 + 读取/清除;内容由宿主快照源
 *     (attachSnapshotSource)提供,避免本层依赖 UI store
 *
 * 恢复时序约定(宿主遵守,见 ChatView.onMounted):
 *   1. takeSnapshot() + store.restorePendingStream() 【必须先于任何会话加载/跳转】
 *   2. 再按 ?cid= / 恢复会话打开对话(openConversation 内合并可见列表)
 *   3. 最后 resume() 续播剩余流
 *   顺序颠倒会导致"刷新后可见列表没有恢复内容、流只在缓冲里跑"。
 */

import type { AttachmentInput } from '@/api/attachments'
import type { ChatMessage } from '@/api/conversations'

/** 发送请求参数(对齐后端 /api/chat/stream 载荷) */
export interface ChatStreamSendOptions {
    message: string
    conversationId?: string
    modelName?: string
    enableThinking?: boolean
    enableWebSearch?: boolean
    enableTools?: boolean
    /** Tools 模式(auto_off/force/off),对应后端 tool_mode;缺省时后端按 auto_off 处理 */
    toolMode?: string
    includeContext?: boolean
    /** 消息附件(对齐原版 uploadedFileIds → user_attachments) */
    attachments?: AttachmentInput[]
    /** 重答模式:后端按 regenerate_index 截断上下文并覆盖原回答(自动保存旧版本) */
    isRegenerate?: boolean
    /** 重答目标 assistant 消息索引(配合 isRegenerate 使用) */
    regenerateIndex?: number
    /** 会话模式(chat/learning),后端落库 conversation_mode 并按模式注入学习上下文 */
    conversationMode?: string
}

/** SSE 原始数据块(与后端 yield 的块 1:1,不做名字改写,便于层内调试) */
export interface ChatStreamChunk {
    type?: string
    content?: string
    delta?: string
    conversation_id?: string
    stream_id?: string
    status?: string
    done?: boolean
    cancel_requested?: boolean
    cancel_reason?: string
    error?: string
    message?: string
    model_name?: string
    provider?: string
    search_enabled?: boolean
    /** 断点续播游标:后端每块自增,层据此记录 consumedSeq */
    _stream_seq?: number
    [key: string]: unknown
}

export type ChatStreamEndReason = 'done' | 'aborted' | 'error'

export interface ChatStreamEndInfo {
    error?: string
    cancelReason?: string
    finalContent?: string
    /** 后端落盘后的最终消息对象(含 metadata.versions),用于轻量收尾更新而非全量重载 */
    finalMessage?: Record<string, unknown>
}

/** 回调契约:onChunk 逐块分发,onEnd 终帧/断线统一收尾 */
export interface ChatStreamHandlers {
    onChunk: (chunk: ChatStreamChunk) => void
    onEnd?: (reason: ChatStreamEndReason, info?: ChatStreamEndInfo) => void
}

/** 跨刷新活动流快照(= 传输游标 + 缓冲消息上下文) */
export interface ChatStreamSnapshot {
    conversationId: string
    streamId: string
    lastSeq: number
    targetIndex: number
    modelName?: string
    userMessage?: ChatMessage
    assistant: ChatMessage
}

/** 快照内容来源:宿主(store)提供进行中流的缓冲上下文;无活动流返回 null */
export type ChatStreamSnapshotSource = () => {
    conversationId: string
    targetIndex: number
    assistant: ChatMessage
    userMessage?: ChatMessage
} | null

const SNAPSHOT_KEY = 'nexora_active_stream_v1'

/** 快照写入节流间隔(ms) */
const SNAPSHOT_THROTTLE_MS = 500

/** 断线自动续播次数上限(对齐原版,避免无限重试) */
const MAX_RECONNECT_ATTEMPTS = 2

export class ChatStreamClient {

    private sending = false

    private controller: AbortController | null = null

    /** 当前流 stream_id(断线续播与取消定位使用) */
    private streamId = ''

    /** 当前流所属会话 ID(后端取消接口的定位兜底,懒创建会话时从流事件回填) */
    private conversationId = ''

    /** 已消费的最新序列号(断线续播断点) */
    private lastSeq = 0

    /** 已断线续播次数(限制最多 2 次,避免无限重试) */
    private reconnectAttempts = 0

    /** 快照内容来源(宿主注入,层只负责序列化与存储) */
    private snapshotSource: ChatStreamSnapshotSource | null = null

    private snapshotLastAt = 0

    private snapshotTimer: number | null = null

    /** 是否正在发送(供 UI 读取以禁用输入/按钮) */
    get isSending(): boolean {
        return this.sending
    }

    /** 当前流 ID(跨刷新恢复快照用) */
    get activeStreamId(): string {
        return this.streamId
    }

    /** 已消费的最新序列号(断线续播断点) */
    get consumedSeq(): number {
        return this.lastSeq
    }

    /** 注入快照内容来源(恢复与持久化共用;宿主在启动时设置一次) */
    attachSnapshotSource(source: ChatStreamSnapshotSource): void {
        this.snapshotSource = source
    }

    /**
     * 节流持久化活动流快照(sessionStorage):
     * 刷新后据此恢复分离缓冲并通过 resume 续播;无活动流/内容源时跳过。
     */
    persistSnapshot(force = false): void {
        if (!this.sending || !this.streamId) {
            return
        }

        const context = this.snapshotSource?.() || null

        if (!context) {
            return
        }

        const buildAndWrite = () => {
            const snapshot: ChatStreamSnapshot = {
                conversationId: context.conversationId,
                streamId: this.streamId,
                lastSeq: this.lastSeq,
                targetIndex: context.targetIndex,
                modelName: context.assistant.model_name,
                userMessage: context.userMessage,
                assistant: { ...context.assistant },
            }

            try {
                sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))
            } catch {
                // 配额/隐私模式失败不阻塞主流程:仅丢失"刷新恢复"能力
            }
        }

        const now = Date.now()

        if (force || now - this.snapshotLastAt >= SNAPSHOT_THROTTLE_MS) {
            this.snapshotLastAt = now

            buildAndWrite()

            return
        }

        if (this.snapshotTimer === null) {
            this.snapshotTimer = window.setTimeout(() => {
                this.snapshotTimer = null
                this.snapshotLastAt = Date.now()

                buildAndWrite()
            }, SNAPSHOT_THROTTLE_MS - (now - this.snapshotLastAt))
        }
    }

    /** 读取并清除 sessionStorage 中的活动流快照(启动恢复入口) */
    takeSnapshot(): ChatStreamSnapshot | null {
        let snapshot: ChatStreamSnapshot | null = null

        try {
            const raw = sessionStorage.getItem(SNAPSHOT_KEY)

            if (raw) {
                const parsed = JSON.parse(raw) as ChatStreamSnapshot

                if (parsed && parsed.conversationId && parsed.streamId && parsed.assistant) {
                    snapshot = parsed
                }
            }
        } catch {
            snapshot = null
        }

        this.clearSnapshot()

        return snapshot
    }

    /** 清除活动流快照(流结束/缓冲被消费后调用,避免陈旧快照误触发恢复) */
    clearSnapshot(): void {
        try {
            sessionStorage.removeItem(SNAPSHOT_KEY)
        } catch {
            // 忽略
        }
    }

    /**
     * 发送一条消息并消费流式响应
     *
     * 返回 true 表示本次发送被接受;false 表示已有流在发送中被拒绝(发送锁生效)
     */
    async send(options: ChatStreamSendOptions, handlers: ChatStreamHandlers): Promise<boolean> {
        // 同步发送锁:函数入口立即检查并占位,不经过任何 await
        if (this.sending) {
            return false
        }

        this.sending = true
        this.controller = new AbortController()
        this.streamId = ''
        this.conversationId = String(options.conversationId || '')
        this.lastSeq = 0
        this.reconnectAttempts = 0

        try {
            await this.runStream(options, handlers)
        } finally {
            this.sending = false
            this.controller = null
        }

        return true
    }

    /**
     * 跨刷新断点续播:按 stream_id + from_seq 续播剩余流(服务端断点续传)
     *
     * 返回 true 表示续播已建立;false 表示流已不存在/已被消费(404 等),
     * 调用方应把快照内容按"已完成部分"保留展示。
     */
    async resume(options: {
        streamId: string
        fromSeq: number
        conversationId?: string
    }, handlers: ChatStreamHandlers): Promise<boolean> {
        if (this.sending) {
            return false
        }

        this.sending = true
        this.controller = new AbortController()
        this.streamId = String(options.streamId || '')
        this.conversationId = String(options.conversationId || '')
        this.lastSeq = Number(options.fromSeq) || 0
        this.reconnectAttempts = 0

        try {
            const res = await fetch('/api/chat/stream/reconnect', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                },
                body: JSON.stringify({
                    stream_id: this.streamId,
                    from_seq: this.lastSeq,
                }),
                signal: this.controller?.signal,
            })

            if (!res.ok || !res.body) {
                handlers.onEnd?.('error', { error: `STREAM_GONE(${res.status})` })

                return false
            }

            await this.consumeStream(res, handlers)

            return true
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                handlers.onEnd?.('aborted')

                return true
            }

            handlers.onEnd?.('error', { error: error instanceof Error ? error.message : '重连失败' })

            return false
        } finally {
            this.sending = false
            this.controller = null
        }
    }

    /** 中断当前流:通知后端取消生成,再 abort 本地读取 */
    cancel(): void {
        if (!this.sending) {
            return
        }

        // 后端 /api/chat/stream/cancel 按 stream_id/conversation_id 定位流会话,
        // 两者都缺时返回 400 且服务端会继续生成到结束 → 必须携带已记录的标识
        const payload: Record<string, string> = {}

        if (this.streamId) {
            payload.stream_id = this.streamId
        }

        if (this.conversationId) {
            payload.conversation_id = this.conversationId
        }

        void fetch('/api/chat/stream/cancel', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })
            .then(async (res) => {
                if (!res.ok) {
                    const data = await res.json().catch(() => ({})) as { message?: string }

                    console.warn('[ChatStream] 服务端取消未被接受:', data.message || `HTTP ${res.status}`)
                }
            })
            .catch(() => undefined)

        this.controller?.abort()
    }

    /** 执行一次流式请求并解析 SSE 数据 */
    private async runStream(options: ChatStreamSendOptions, handlers: ChatStreamHandlers): Promise<void> {
        const controller = this.controller

        let res: Response

        try {
            res = await fetch('/api/chat/stream', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                },
                body: JSON.stringify({
                    message: options.message,
                    conversation_id: options.conversationId || undefined,
                    model_name: options.modelName || undefined,
                    enable_thinking: options.enableThinking ?? true,
                    enable_web_search: options.enableWebSearch ?? true,
                    enable_tools: options.enableTools ?? true,
                    tool_mode: options.toolMode || undefined,
                    include_context: options.includeContext ?? true,
                    user_attachments: options.attachments && options.attachments.length > 0 ? options.attachments : undefined,
                    is_regenerate: !!options.isRegenerate,
                    regenerate_index: options.isRegenerate ? Number(options.regenerateIndex) : undefined,
                    conversation_mode: options.conversationMode || undefined,
                }),
                signal: controller?.signal,
            })
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                handlers.onEnd?.('aborted')

                return
            }

            handlers.onEnd?.('error', { error: error instanceof Error ? error.message : '网络请求失败' })

            return
        }

        if (!res.ok) {
            // 非 2xx:读取响应体中的错误信息(JSON 或纯文本)
            const text = await res.text().catch(() => '')

            let errorMessage = `请求失败(${res.status})`

            try {
                const data = JSON.parse(text) as { message?: string }

                if (data.message) {
                    errorMessage = data.message
                }
            } catch {
                if (text) {
                    errorMessage = text
                }
            }

            handlers.onEnd?.('error', { error: errorMessage })

            return
        }

        if (!res.body) {
            handlers.onEnd?.('error', { error: '响应为空' })

            return
        }

        await this.consumeStream(res, handlers)
    }

    /** 逐行消费 SSE 响应体并分发数据块 */
    private async consumeStream(res: Response, handlers: ChatStreamHandlers): Promise<void> {
        const body = res.body as ReadableStream<Uint8Array> | null

        if (!body) {
            handlers.onEnd?.('error', { error: '响应体不可读' })

            return
        }

        const reader = body.getReader()
        const decoder = new TextDecoder('utf-8')
        let buffer = ''
        let ended = false

        try {
            for (;;) {
                const { done, value } = await reader.read()

                if (done) {
                    break
                }

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                    ended = this.handleLine(line, handlers) || ended
                }
            }

            if (buffer.trim()) {
                ended = this.handleLine(buffer, handlers) || ended
            }

            if (!ended) {
                handlers.onEnd?.('error', { error: '连接意外中断' })
            }
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                handlers.onEnd?.('aborted')

                return
            }

            // 断线(非用户取消):尝试自动续播一次(从断点恢复)
            const reconnected = await this.tryReconnect(handlers)

            if (!reconnected) {
                handlers.onEnd?.('error', { error: '连接中断,自动续播失败' })
            }
        } finally {
            reader.releaseLock()
        }
    }

    /**
     * 断线续播:基于已记录的 stream_id + last_seq 从断点恢复流
     *
     * 续播成功后继续消费(最终 onEnd 由续播后的流触发),最多续播 2 次。
     */
    private async tryReconnect(handlers: ChatStreamHandlers): Promise<boolean> {
        if (!this.streamId || this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            return false
        }

        this.reconnectAttempts += 1

        try {
            const res = await fetch('/api/chat/stream/reconnect', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    stream_id: this.streamId,
                    from_seq: this.lastSeq,
                }),
                signal: this.controller?.signal,
            })

            if (!res.ok || !res.body) {
                return false
            }

            await this.consumeStream(res, handlers)

            return true
        } catch {
            return false
        }
    }

    /**
     * 解析单行 SSE data 并分发
     *
     * 返回 true 表示流已正常结束(done 终帧或 [DONE])
     */
    private handleLine(line: string, handlers: ChatStreamHandlers): boolean {
        const trimmed = line.trim()

        if (trimmed === '[DONE]' || trimmed === 'data: [DONE]') {
            handlers.onEnd?.('done')

            return true
        }

        if (!trimmed.startsWith('data: ')) {
            return false
        }

        const payloadText = trimmed.slice(6)

        let chunk: ChatStreamChunk

        try {
            chunk = JSON.parse(payloadText) as ChatStreamChunk
        } catch {
            return false
        }

        if (!chunk || typeof chunk !== 'object') {
            return false
        }

        // 记录断点信息:stream_id、会话 ID 与已消费序列(断线续播/取消定位与快照数据源)
        if (chunk.stream_id) {
            this.streamId = String(chunk.stream_id)
        }

        if (!this.conversationId && chunk.conversation_id) {
            this.conversationId = String(chunk.conversation_id)
        }

        if (Number.isFinite(Number(chunk._stream_seq))) {
            this.lastSeq = Math.max(this.lastSeq, Number(chunk._stream_seq))
        }

        // stream_session:元信息帧;终帧(done=true)携带后端错误/取消/最终消息信息
        if (chunk.type === 'stream_session') {
            if (chunk.done) {
                const info: ChatStreamEndInfo = {
                    error: chunk.error || undefined,
                    cancelReason: chunk.cancel_reason || undefined,
                    finalMessage: (chunk.final_message && typeof chunk.final_message === 'object')
                        ? chunk.final_message as Record<string, unknown>
                        : undefined,
                }

                if (chunk.error) {
                    handlers.onEnd?.('error', info)
                } else if (chunk.cancel_requested) {
                    handlers.onEnd?.('aborted', info)
                } else {
                    handlers.onEnd?.('done', info)
                }

                return true
            }

            handlers.onChunk(chunk)

            return false
        }

        // done 终帧:携带完整正文,以完整内容兜底覆盖增量拼接
        if (chunk.type === 'done') {
            handlers.onChunk(chunk)

            handlers.onEnd?.('done', { finalContent: chunk.content || undefined })

            return true
        }

        // 其余数据块(正文/思考/工具/usage 等)交由调用方分发
        handlers.onChunk(chunk)

        return false
    }
}

/** 全局单例:全站唯一聊天流网络入口 */
export const chatStream = new ChatStreamClient()