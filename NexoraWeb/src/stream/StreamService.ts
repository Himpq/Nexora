/**
 * StreamService.ts — 聊天流式发送唯一入口
 *
 * 职责:
 *   - 提供全局唯一的发送入口,所有触发路径(回车/按钮/自动续接)都经由此处
 *   - 内置同步发送锁:send() 入口立即检查并占位,任何 await 之前完成,
 *     从架构上杜绝"多次回车触发多次发送"的竞态
 *   - SSE 协议解析(与 ChatDBServer /api/chat/stream 完全一致):
 *       * 数据块:content / content_delta(增量正文)、reasoning_content / reasoning_delta(思考)、
 *         message / done(终帧,含完整内容)
 *       * stream_session:会话元信息;终帧含 done=true 与 error 字段
 *       * [DONE]:流结束标记
 *
 * 使用:
 *   const ok = await streamService.send({ message }, {
 *       onChunk: (chunk) => { ... },
 *       onEnd: (reason, info) => { ... },
 *   })
 */

import type { AttachmentInput } from '@/api/attachments'

export interface StreamChunk {
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
    _stream_seq?: number
    [key: string]: unknown
}

export interface StreamSendOptions {
    message: string
    conversationId?: string
    modelName?: string
    enableThinking?: boolean
    enableWebSearch?: boolean
    enableTools?: boolean
    includeContext?: boolean
    /** 消息附件(对齐原版 uploadedFileIds → user_attachments) */
    attachments?: AttachmentInput[]
}

export type StreamEndReason = 'done' | 'aborted' | 'error'

export interface StreamEndInfo {
    error?: string
    cancelReason?: string
    finalContent?: string
}

export interface StreamHandlers {
    /** 每个数据块到达时触发;增量字段为 content 或 delta */
    onChunk: (chunk: StreamChunk) => void

    /** 流结束:done 正常完成 / aborted 被取消 / error 出错(带后端错误信息) */
    onEnd?: (reason: StreamEndReason, info?: StreamEndInfo) => void
}

export class StreamService {

    private _sending = false

    private _controller: AbortController | null = null

    /** 当前流的 stream_id(断线重连使用) */
    private _streamId = ''

    /** 已消费的最新序列号(断线重连断点) */
    private _lastSeq = 0

    /** 已重连次数(限制最多 2 次,避免无限重试) */
    private _reconnectAttempts = 0

    /** 是否正在发送(供 UI 读取以禁用输入/按钮) */
    get isSending(): boolean {
        return this._sending
    }

    /**
     * 发送一条消息并消费流式响应
     *
     * 返回 true 表示本次发送被接受;false 表示已有流在发送中被拒绝(发送锁生效)
     */
    async send(options: StreamSendOptions, handlers: StreamHandlers): Promise<boolean> {
        // 同步发送锁:函数入口立即检查并占位,不经过任何 await
        if (this._sending) {
            return false
        }

        this._sending = true
        this._controller = new AbortController()
        this._streamId = ''
        this._lastSeq = 0
        this._reconnectAttempts = 0

        try {
            await this._runStream(options, handlers)
        } finally {
            this._sending = false
            this._controller = null
        }

        return true
    }

    /** 中断当前流:先通知后端取消,再 abort 本地读取 */
    cancel(): void {
        if (!this._sending) {
            return
        }

        void fetch('/api/chat/stream/cancel', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        }).catch(() => undefined)

        this._controller?.abort()
    }

    /** 执行一次流式请求并解析 SSE 数据 */
    private async _runStream(options: StreamSendOptions, handlers: StreamHandlers): Promise<void> {
        const controller = this._controller as AbortController

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
                    include_context: options.includeContext ?? true,
                    user_attachments: options.attachments && options.attachments.length > 0 ? options.attachments : undefined,
                }),
                signal: controller.signal,
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

        await this._consumeStream(res, handlers)
    }

    /** 逐行消费 SSE 响应体并分发数据块 */
    private async _consumeStream(res: Response, handlers: StreamHandlers): Promise<void> {
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
                    ended = this._handleLine(line, handlers) || ended
                }
            }

            if (buffer.trim()) {
                ended = this._handleLine(buffer, handlers) || ended
            }

            if (!ended) {
                handlers.onEnd?.('error', { error: '连接意外中断' })
            }
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                handlers.onEnd?.('aborted')

                return
            }

            // 断线(非用户取消):尝试自动重连一次(从断点恢复)
            const reconnected = await this._tryReconnect(handlers)

            if (!reconnected) {
                handlers.onEnd?.('error', { error: '连接中断,自动重连失败' })
            }
        } finally {
            reader.releaseLock()
        }
    }

    /**
     * 断线重连:基于已记录的 stream_id + last_seq 从断点恢复流
     *
     * 重连成功后继续消费(最终 onEnd 由重连后的流触发),最多重连 2 次。
     */
    private async _tryReconnect(handlers: StreamHandlers): Promise<boolean> {
        if (!this._streamId || this._reconnectAttempts >= 2) {
            return false
        }

        this._reconnectAttempts += 1

        try {
            const res = await fetch('/api/chat/stream/reconnect', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    stream_id: this._streamId,
                    from_seq: this._lastSeq,
                }),
                signal: this._controller?.signal,
            })

            if (!res.ok || !res.body) {
                return false
            }

            await this._consumeStream(res, handlers)

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
    private _handleLine(line: string, handlers: StreamHandlers): boolean {
        const trimmed = line.trim()

        if (trimmed === '[DONE]' || trimmed === 'data: [DONE]') {
            handlers.onEnd?.('done')

            return true
        }

        if (!trimmed.startsWith('data: ')) {
            return false
        }

        const payloadText = trimmed.slice(6)

        let chunk: StreamChunk

        try {
            chunk = JSON.parse(payloadText) as StreamChunk
        } catch {
            return false
        }

        if (!chunk || typeof chunk !== 'object') {
            return false
        }

        // 记录断点信息(断线重连使用):stream_id 与已消费序列
        if (chunk.stream_id) {
            this._streamId = String(chunk.stream_id)
        }

        if (Number.isFinite(Number(chunk._stream_seq))) {
            this._lastSeq = Math.max(this._lastSeq, Number(chunk._stream_seq))
        }

        // stream_session:元信息帧;终帧(done=true)携带后端错误/取消信息
        if (chunk.type === 'stream_session') {
            if (chunk.done) {
                const info: StreamEndInfo = {
                    error: chunk.error || undefined,
                    cancelReason: chunk.cancel_reason || undefined,
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

        // 其余数据块(正文/思考)交给调用方处理
        handlers.onChunk(chunk)

        return false
    }
}

/** 全局单例:全站唯一发送入口 */
export const streamService = new StreamService()
