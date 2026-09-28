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
 *   1. takeSnapshot() + 逐条 store.restorePendingStream() 【必须先于任何会话加载/跳转】
 *   2. 再按 ?cid= / 主恢复会话打开对话(openConversation 内合并可见列表)
 *   3. 最后逐条 resume() 续播剩余流
 *   顺序颠倒会导致"刷新后可见列表没有恢复内容、流只在缓冲里跑"。
 */

import type { AttachmentInput } from '@/api/attachments'
import type { ChatMessage, ConversationContextEvent } from '@/api/conversations'

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
    /** 会话所属 Workspace id:后端据此注入 Workspace 上下文与记忆/草稿工具(须确保会话已登记进该项目) */
    workspaceId?: string
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
    /** 后端结构化错误码(type=error 帧 / stream_session 终帧),前端据此分类处理 */
    error_code?: string
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
    /** 后端结构化错误码(与 json_error 的 error_code / SSE error 帧一致) */
    errorCode?: string
    /** 传输层暂时中断,服务端流仍应保留,不可清理本地恢复快照 */
    transportInterrupted?: boolean
    cancelReason?: string
    finalContent?: string
    /** 后端落盘后的最终消息对象(含 metadata.versions),用于轻量收尾更新而非全量重载 */
    finalMessage?: Record<string, unknown>
    contextEvents?: ConversationContextEvent[]
    assistantIndex?: number
    regenerateIndex?: number
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

/** 宿主提供的单条活动流缓冲上下文(网络层补齐 streamId/lastSeq 后落盘) */
export interface ChatStreamSnapshotContext {
    conversationId: string
    targetIndex: number
    assistant: ChatMessage
    userMessage?: ChatMessage
}

/** 快照内容来源:宿主(store)提供全部进行中流的缓冲上下文;无活动流返回空数组 */
export type ChatStreamSnapshotSource = () => ChatStreamSnapshotContext[]

const SNAPSHOT_KEY = 'nexora_active_stream_v1'

/** 快照写入节流间隔(ms) */
const SNAPSHOT_THROTTLE_MS = 500

/** 首轮快速续播次数上限;超过后进入受控持续恢复 */
const MAX_RECONNECT_ATTEMPTS = 2

/** 首轮续播失败后继续等待服务端流恢复的时间配置 */
const STREAM_RECOVERY_DELAY_MS = 2000
const STREAM_RECOVERY_TIMEOUT_MS = 15 * 60 * 1000

interface ActiveStreamContext {
    controller: AbortController
    streamId: string
    conversationId: string
    lastSeq: number
    reconnectAttempts: number
    /** 模型正文 done 帧先于 stream_session 终帧到达,暂存正文等待最终消息字段。 */
    finalContent?: string
    /** stream_session 终帧与 [DONE] 只允许触发一次 onEnd。 */
    endNotified: boolean
}

export class ChatStreamClient {

    /** 多会话并发:每条流独立上下文(会话 ID → 上下文) */
    private activeStreams = new Map<string, ActiveStreamContext>()

    /** 兼容旧单流调用的兜底键(无 conversationId 时使用) */
    private readonly FALLBACK_KEY = '__default__'

    /** 快照内容来源(宿主注入,层只负责序列化与存储) */
    private snapshotSource: ChatStreamSnapshotSource | null = null

    private snapshotLastAt = 0

    private snapshotTimer: number | null = null

    /** 是否有任意流正在发送(供 UI 读取以禁用输入/按钮) */
    get isSending(): boolean {
        return this.activeStreams.size > 0
    }

    /** 指定会话是否正在发送 */
    isSendingFor(conversationId: string): boolean {
        const key = String(conversationId || '').trim() || this.FALLBACK_KEY
        return this.activeStreams.has(key)
    }

    /** 当前流 ID(跨刷新恢复快照用):取首个活动流 */
    get activeStreamId(): string {
        const first = this.activeStreams.values().next().value as ActiveStreamContext | undefined
        return first?.streamId || ''
    }

    /** 已消费的最新序列号(断线续播断点):首个活动流 */
    get consumedSeq(): number {
        const first = this.activeStreams.values().next().value as ActiveStreamContext | undefined
        return first?.lastSeq || 0
    }

    /** 注入快照内容来源(恢复与持久化共用;宿主在启动时设置一次) */
    attachSnapshotSource(source: ChatStreamSnapshotSource): void {
        this.snapshotSource = source
    }

    /**
     * 节流持久化活动流快照(sessionStorage):
     * 刷新后据此恢复全部并行流的分离缓冲并通过 resume 续播;无活动流时清除快照。
     * 多会话并发时逐条与会话传输上下文(streamId/lastSeq)配对。
     */
    persistSnapshot(force = false): void {
        const contexts = this.snapshotSource?.() || []

        const buildAndWrite = () => {
            const snapshots: ChatStreamSnapshot[] = []

            contexts.forEach((context) => {
                const key = String(context.conversationId || '').trim() || this.FALLBACK_KEY
                const streamCtx = this.activeStreams.get(key)

                // 仅持久化仍有真实传输上下文的流:已完成/已断开的缓冲不进入快照
                if (!streamCtx || !streamCtx.streamId) {
                    return
                }

                snapshots.push({
                    conversationId: context.conversationId,
                    streamId: streamCtx.streamId,
                    lastSeq: streamCtx.lastSeq,
                    targetIndex: context.targetIndex,
                    modelName: context.assistant.model_name,
                    userMessage: context.userMessage,
                    assistant: { ...context.assistant },
                })
            })

            try {
                if (snapshots.length > 0) {
                    sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots))
                } else {
                    sessionStorage.removeItem(SNAPSHOT_KEY)
                }
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

    /** 读取并清除 sessionStorage 中的全部活动流快照(启动恢复入口) */
    takeSnapshot(): ChatStreamSnapshot[] {
        let snapshots: ChatStreamSnapshot[] = []

        try {
            const raw = sessionStorage.getItem(SNAPSHOT_KEY)

            if (raw) {
                const parsed = JSON.parse(raw) as unknown

                if (Array.isArray(parsed)) {
                    snapshots = parsed.filter((item): item is ChatStreamSnapshot => {
                        const snapshot = item as ChatStreamSnapshot

                        return !!snapshot && !!snapshot.conversationId && !!snapshot.streamId && !!snapshot.assistant
                    })
                }
            }
        } catch {
            snapshots = []
        }

        this.clearSnapshot()

        return snapshots
    }

    /**
     * 清除活动流快照:
     * 不传会话 ID 时清除全部;传 ID 时仅移除该会话条目,保留其他并行流的恢复能力。
     */
    clearSnapshot(conversationId?: string): void {
        try {
            if (!conversationId) {
                sessionStorage.removeItem(SNAPSHOT_KEY)

                return
            }

            const raw = sessionStorage.getItem(SNAPSHOT_KEY)

            if (!raw) {
                return
            }

            const parsed = JSON.parse(raw) as unknown

            if (!Array.isArray(parsed)) {
                sessionStorage.removeItem(SNAPSHOT_KEY)

                return
            }

            const remaining = parsed.filter((item) => {
                const snapshot = item as ChatStreamSnapshot

                return String(snapshot?.conversationId || '') !== conversationId
            })

            if (remaining.length > 0) {
                sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(remaining))
            } else {
                sessionStorage.removeItem(SNAPSHOT_KEY)
            }
        } catch {
            // 忽略
        }
    }

    /**
     * 发送一条消息并消费流式响应
     *
     * 返回 true 表示本次发送被接受;false 表示同会话已有流在发送中被拒绝(会话级发送锁)
     * 不同会话允许并发:切换到其他对话直接发送,不再走队列
     */
    async send(options: ChatStreamSendOptions, handlers: ChatStreamHandlers): Promise<boolean> {
        const key = String(options.conversationId || '').trim() || this.FALLBACK_KEY

        // 会话级锁:同会话重复发送拒绝,跨会话并发允许
        if (this.activeStreams.has(key)) {
            return false
        }

        const ctx: ActiveStreamContext = {
            controller: new AbortController(),
            streamId: '',
            conversationId: String(options.conversationId || ''),
            lastSeq: 0,
            reconnectAttempts: 0,
            endNotified: false,
        }

        this.activeStreams.set(key, ctx)

        try {
            await this.runStream(options, handlers, ctx)
        } finally {
            this.activeStreams.delete(key)
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
        const key = String(options.conversationId || '').trim() || String(options.streamId || '').trim() || this.FALLBACK_KEY

        if (this.activeStreams.has(key)) {
            return false
        }

        const ctx: ActiveStreamContext = {
            controller: new AbortController(),
            streamId: String(options.streamId || ''),
            conversationId: String(options.conversationId || ''),
            lastSeq: Number(options.fromSeq) || 0,
            reconnectAttempts: 0,
            endNotified: false,
        }

        this.activeStreams.set(key, ctx)

        try {
            const res = await fetch('/api/chat/stream/reconnect', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                },
                body: JSON.stringify({
                    stream_id: ctx.streamId,
                    from_seq: ctx.lastSeq,
                }),
                signal: ctx.controller?.signal,
            })

            if (res.status === 404) {
                handlers.onEnd?.('error', { error: `STREAM_GONE(${res.status})` })

                return false
            }

            if (!res.ok || !res.body) {
                return await this.waitForStreamRecovery(handlers, ctx)
            }

            await this.consumeStream(res, handlers, ctx)

            return true
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                handlers.onEnd?.('aborted')

                return true
            }

            await this.waitForStreamRecovery(handlers, ctx)

            return true
        } finally {
            this.activeStreams.delete(key)
        }
    }

    /**
     * 中断流:可按会话定向取消
     * 无参时取消所有活动流(兼容旧调用);传 conversationId 时仅取消该会话流
     */
    cancel(conversationId?: string): void {
        if (this.activeStreams.size === 0) {
            return
        }

        const targetKey = String(conversationId || '').trim()

        // 定向取消单会话
        if (targetKey) {
            const ctx = this.activeStreams.get(targetKey) || this.activeStreams.get(this.FALLBACK_KEY)

            if (!ctx) {
                return
            }

            const payload: Record<string, string> = {}

            if (ctx.streamId) {
                payload.stream_id = ctx.streamId
            }

            if (ctx.conversationId) {
                payload.conversation_id = ctx.conversationId
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

            ctx.controller.abort()

            return
        }

        // 无参:取消全部(兼容旧行为,用户点击停止时通常只想停当前,但此处全停最安全)
        for (const ctx of this.activeStreams.values()) {
            const payload: Record<string, string> = {}

            if (ctx.streamId) {
                payload.stream_id = ctx.streamId
            }

            if (ctx.conversationId) {
                payload.conversation_id = ctx.conversationId
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

            ctx.controller.abort()
        }
    }

    /** 执行一次流式请求并解析 SSE 数据 */
    private async runStream(options: ChatStreamSendOptions, handlers: ChatStreamHandlers, ctx: ActiveStreamContext): Promise<void> {
        const controller = ctx.controller

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
                    workspace_id: options.workspaceId || undefined,
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
            let errorCode = ''

            try {
                const data = JSON.parse(text) as { message?: string; error_code?: string }

                if (data.message) {
                    errorMessage = data.message
                }

                if (data.error_code) {
                    errorCode = String(data.error_code)
                }
            } catch {
                if (text) {
                    errorMessage = text
                }
            }

            handlers.onEnd?.('error', { error: errorMessage, errorCode: errorCode || undefined })

            return
        }

        const responseStreamId = String(res.headers.get('X-Stream-Id') || '').trim()

        if (responseStreamId) {
            ctx.streamId = responseStreamId
        }

        if (!res.body) {
            handlers.onEnd?.('error', { error: '响应为空' })

            return
        }

        await this.consumeStream(res, handlers, ctx)
    }

    /** 逐行消费 SSE 响应体并分发数据块 */
    private async consumeStream(
        res: Response,
        handlers: ChatStreamHandlers,
        ctx: ActiveStreamContext,
        allowRecovery = true,
    ): Promise<boolean> {
        const body = res.body as ReadableStream<Uint8Array> | null

        if (!body) {
            if (allowRecovery) {
                return await this.waitForStreamRecovery(handlers, ctx)
            }

            return false
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
                    ended = this.handleLine(line, handlers, ctx) || ended
                }
            }

            if (buffer.trim()) {
                ended = this.handleLine(buffer, handlers, ctx) || ended
            }

            if (!ended) {
                if (allowRecovery) {
                    return await this.waitForStreamRecovery(handlers, ctx)
                }

                return false
            }

            return true
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                handlers.onEnd?.('aborted')

                return true
            }

            // 断线(非用户取消):先从断点快速续播,失败后继续保留快照等待服务端恢复。
            if (allowRecovery) {
                const reconnected = await this.tryReconnect(handlers, ctx)

                if (reconnected) {
                    return true
                }

                return await this.waitForStreamRecovery(handlers, ctx)
            }

            return false
        } finally {
            reader.releaseLock()
        }
    }

    /**
     * 断线续播:基于已记录的 stream_id + last_seq 从断点恢复流
     *
     * 续播成功后继续消费(最终 onEnd 由续播后的流触发),首轮快速续播最多 2 次。
     */
    private async tryReconnect(handlers: ChatStreamHandlers, ctx: ActiveStreamContext): Promise<boolean> {
        if (!ctx.streamId || ctx.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            return false
        }

        ctx.reconnectAttempts += 1

        try {
            const res = await fetch('/api/chat/stream/reconnect', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    stream_id: ctx.streamId,
                    from_seq: ctx.lastSeq,
                }),
                signal: ctx.controller?.signal,
            })

            if (!res.ok || !res.body) {
                return false
            }

            const responseStreamId = String(res.headers.get('X-Stream-Id') || '').trim()

            if (responseStreamId) {
                ctx.streamId = responseStreamId
            }

            return await this.consumeStream(res, handlers, ctx, false)
        } catch {
            return false
        }
    }

    /**
     * 传输层断开后的持续恢复:
     * 服务端 worker 与 SSE 客户端连接相互独立,连接失败不代表模型生成失败。
     * 在服务端流结束前保留快照并周期性重新连接,避免页面只留下空助手占位。
     */
    private async waitForStreamRecovery(handlers: ChatStreamHandlers, ctx: ActiveStreamContext): Promise<boolean> {
        this.persistSnapshot(true)

        const deadline = Date.now() + STREAM_RECOVERY_TIMEOUT_MS

        while (Date.now() < deadline) {
            if (ctx.controller.signal.aborted) {
                handlers.onEnd?.('aborted')

                return true
            }

            const waited = await this.waitForRecoveryDelay(ctx.controller.signal)

            if (!waited) {
                handlers.onEnd?.('aborted')

                return true
            }

            try {
                const res = await fetch('/api/chat/stream/reconnect', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'text/event-stream',
                    },
                    body: JSON.stringify({
                        stream_id: ctx.streamId,
                        from_seq: ctx.lastSeq,
                    }),
                    signal: ctx.controller.signal,
                })

                if (res.status === 404) {
                    handlers.onEnd?.('error', { error: 'STREAM_GONE(404)' })

                    return true
                }

                if (!res.ok || !res.body) {
                    continue
                }

                const ended = await this.consumeStream(res, handlers, ctx, false)

                if (ended) {
                    return true
                }
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') {
                    handlers.onEnd?.('aborted')

                    return true
                }
            }
        }

        handlers.onEnd?.('error', {
            error: '连接暂时中断,已保留服务端生成状态',
            transportInterrupted: true,
        })

        return true
    }

    /** 可被 AbortController 中断的恢复等待,避免页面停止生成后继续挂起定时器。 */
    private waitForRecoveryDelay(signal: AbortSignal): Promise<boolean> {
        return new Promise((resolve) => {
            if (signal.aborted) {
                resolve(false)

                return
            }

            const timer = window.setTimeout(() => {
                signal.removeEventListener('abort', onAbort)
                resolve(true)
            }, STREAM_RECOVERY_DELAY_MS)

            const onAbort = () => {
                window.clearTimeout(timer)
                resolve(false)
            }

            signal.addEventListener('abort', onAbort, { once: true })
        })
    }

    /**
     * 解析单行 SSE data 并分发
     *
     * 返回 true 表示流已正常结束(stream_session 终帧或 [DONE]);
     * 模型正文 done 帧不是终态,后面仍可能有最终消息元数据。
     */
    private handleLine(line: string, handlers: ChatStreamHandlers, ctx: ActiveStreamContext): boolean {
        const trimmed = line.trim()

        if (trimmed === '[DONE]' || trimmed === 'data: [DONE]') {
            if (!ctx.endNotified) {
                ctx.endNotified = true
                handlers.onEnd?.('done', {
                    finalContent: ctx.finalContent || undefined,
                })
            }

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
            ctx.streamId = String(chunk.stream_id)
        }

        if (!ctx.conversationId && chunk.conversation_id) {
            ctx.conversationId = String(chunk.conversation_id)
        }

        if (Number.isFinite(Number(chunk._stream_seq))) {
            ctx.lastSeq = Math.max(ctx.lastSeq, Number(chunk._stream_seq))
        }

        // stream_session:元信息帧;终帧(done=true)携带后端错误/取消/最终消息信息
        if (chunk.type === 'stream_session') {
            if (chunk.done) {
                const info: ChatStreamEndInfo = {
                    error: chunk.error || undefined,
                    errorCode: typeof chunk.error_code === 'string' && chunk.error_code
                        ? chunk.error_code
                        : undefined,
                    cancelReason: chunk.cancel_reason || undefined,
                    finalMessage: (chunk.final_message && typeof chunk.final_message === 'object')
                        ? chunk.final_message as Record<string, unknown>
                        : undefined,
                    contextEvents: Array.isArray(chunk.context_events)
                        ? chunk.context_events as ConversationContextEvent[]
                        : undefined,
                    assistantIndex: Number.isFinite(Number(chunk.assistant_index)) ? Number(chunk.assistant_index) : undefined,
                    regenerateIndex: Number.isFinite(Number(chunk.regenerate_index)) ? Number(chunk.regenerate_index) : undefined,
                }

                if (ctx.endNotified) {
                    return true
                }

                ctx.endNotified = true

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
            // 该帧只表示模型正文结束。后端随后还会发送 stream_session(done=true),
            // 其中才有已落盘的 assistant 消息、累计 I/O 和错误/取消状态。
            // 在此处提前收尾会丢失最终消息字段,表现为徽标必须刷新后才变成累计值。
            ctx.finalContent = chunk.content || undefined

            return false
        }

        // 其余数据块(正文/思考/工具/usage 等)交由调用方分发
        handlers.onChunk(chunk)

        return false
    }
}

/** 全局单例:全站唯一聊天流网络入口 */
export const chatStream = new ChatStreamClient()
