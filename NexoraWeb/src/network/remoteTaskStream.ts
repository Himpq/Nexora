/**
 * 远程任务事件流：事件通过设备 WebSocket 实时推送，序号用于断线续接。
 *
 * 开始与停止任务仍使用短 RPC；任务运行期间不再定时请求事件接口。网页或设备
 * 重连时，电脑从 after_seq 继续推送；内存窗口不足时，才通过事件接口按页补读。
 */

import {
    cancelRemoteTask,
    readRemoteTaskEvents,
    startRemoteTask,
    type RemoteTaskEvent,
    type RemoteTaskSession,
    type StartRemoteTaskParams,
} from '@/api/nexoracode'

export type RemoteTaskState =
    | 'idle'
    | 'starting'
    | 'running'
    | 'stopping'
    | 'done'
    | 'failed'
    | 'cancelled'
    | 'interrupted'
    | 'gone'

export interface RemoteTaskStreamHandlers {
    /** 增量事件，按 _stream_seq 递增且不重复。 */
    onEvent: (event: RemoteTaskEvent) => void
    /** 状态迁移，落盘/切换视图时用于整体重绘。 */
    onState?: (state: RemoteTaskState, session: RemoteTaskSession | null) => void
    /** WebSocket 或断线补读失败。 */
    onError?: (error: Error) => void
}

const CONNECT_TIMEOUT_MS = 10000
const SOCKET_PING_MS = 20000
const MAX_RECONNECT_MS = 15000
const MAX_TRACK_MS = 2 * 60 * 60 * 1000
const STOP_TIMEOUT_MS = 20000
const EVENT_PAGE_SIZE = 200

const TERMINAL_STATES: RemoteTaskState[] = ['done', 'failed', 'cancelled', 'interrupted', 'gone']

export function isTerminalRemoteTaskState(state: RemoteTaskState): boolean {
    return TERMINAL_STATES.includes(state)
}

/** 把电脑侧 session.status 映射为显式状态；error 字段决定成功还是失败。 */
export function toRemoteTaskState(session: RemoteTaskSession | null): RemoteTaskState {
    if (!session) {
        return 'gone'
    }

    const status = String(session.status || '')

    if (status === 'running') {
        return 'running'
    }

    if (status === 'cancelling') {
        return 'stopping'
    }

    if (session.cancel_requested || session.error === 'cancelled') {
        return 'cancelled'
    }

    if (status === 'interrupted' || session.stage === 'interrupted') {
        return 'interrupted'
    }

    if (session.error) {
        return 'failed'
    }

    return 'done'
}

function newRequestId(): string {
    const random = Math.random().toString(36).slice(2, 10)

    return `web-${Date.now().toString(36)}-${random}`
}

function buildRemoteTaskWsUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'

    return `${protocol}//${window.location.host}/ws/nexoracode/tasks`
}

export class RemoteTaskStream {
    private deviceId: string
    private handlers: RemoteTaskStreamHandlers
    private state: RemoteTaskState = 'idle'
    private session: RemoteTaskSession | null = null
    private streamId = ''
    private conversationId = ''
    private cursor = 0
    private socket: WebSocket | null = null
    private socketSerial = 0
    private reconnectTimer: number | null = null
    private connectTimer: number | null = null
    private pingTimer: number | null = null
    private reconnectAttempts = 0
    private recovering = false
    private stopped = false
    private startedAt = 0
    /** 同一 request_id 只用于确认未到达电脑的同一请求重试。 */
    private unconfirmed: { requestId: string; conversationId: string; message: string } | null = null
    private stopTimer: number | null = null

    constructor(deviceId: string, handlers: RemoteTaskStreamHandlers) {
        this.deviceId = deviceId
        this.handlers = handlers
    }

    getState(): RemoteTaskState {
        return this.state
    }

    getSession(): RemoteTaskSession | null {
        return this.session
    }

    getStreamId(): string {
        return this.streamId
    }

    /** 任务落到的会话标识；新会话在 start 返回后才确定。 */
    getConversationId(): string {
        return this.conversationId
    }

    getCursor(): number {
        return this.cursor
    }

    /** 开始任务后订阅对应的电脑事件流。 */
    async start(params: Omit<StartRemoteTaskParams, 'requestId'> & { requestId?: string }): Promise<void> {
        if (this.state !== 'idle' && !isTerminalRemoteTaskState(this.state)) {
            throw new Error('已有任务在进行中')
        }

        const conversationId = params.conversationId || ''
        const isRetry = this.unconfirmed !== null
            && this.unconfirmed.conversationId === conversationId
            && this.unconfirmed.message === params.message
        const payload: StartRemoteTaskParams = {
            ...params,
            requestId: params.requestId || (isRetry ? this.unconfirmed!.requestId : newRequestId()),
        }

        this.unconfirmed = {
            requestId: payload.requestId,
            conversationId,
            message: params.message,
        }
        this.stopped = false
        this.cursor = 0
        this.reconnectAttempts = 0
        this.startedAt = Date.now()
        this.setState('starting', null)

        let result: { stream_id?: string; conversation_id?: string }

        try {
            result = await startRemoteTask(this.deviceId, payload)
        } catch (error) {
            throw error
        }

        this.unconfirmed = null
        this.streamId = String(result.stream_id || '')
        this.conversationId = String(result.conversation_id || payload.conversationId || '')

        if (!this.streamId) {
            this.setState('failed', null)
            throw new Error('电脑未返回任务标识')
        }

        this.connectSocket()
    }

    /** 接管电脑上仍在运行的任务，从序号 0 重放可用事件。 */
    restore(session: RemoteTaskSession): void {
        const state = toRemoteTaskState(session)

        if (!session.stream_id || isTerminalRemoteTaskState(state)) {
            throw new Error('只能恢复电脑上仍在运行的任务')
        }

        this.stopped = false
        this.streamId = session.stream_id
        this.conversationId = session.conversation_id || ''
        this.cursor = 0
        this.session = session
        this.reconnectAttempts = 0
        this.startedAt = Date.now()
        this.setState(state, session)
        this.connectSocket()
    }

    /** 请求停止：发送取消 RPC，任务终态由 WebSocket 确认。 */
    async stop(): Promise<void> {
        if (!this.streamId) {
            return
        }

        this.setState('stopping', this.session)
        this.armStopTimeout()

        try {
            await cancelRemoteTask(this.deviceId, this.streamId)
        } catch (error) {
            this.handlers.onError?.(error instanceof Error ? error : new Error(String(error)))
        }
    }

    private armStopTimeout(): void {
        this.clearStopTimer()

        this.stopTimer = window.setTimeout(() => {
            this.stopTimer = null

            if (this.stopped || isTerminalRemoteTaskState(this.state)) {
                return
            }

            this.stopped = true
            this.setState('cancelled', this.session)
        }, STOP_TIMEOUT_MS)
    }

    private clearStopTimer(): void {
        if (this.stopTimer !== null) {
            window.clearTimeout(this.stopTimer)
            this.stopTimer = null
        }
    }

    /** 暂停网页订阅并保留游标；任务继续在电脑上运行。 */
    detach(): void {
        this.stopped = true
        this.closeSocket()
    }

    /** 从保留的游标重新订阅。 */
    attach(): void {
        if (!this.streamId || isTerminalRemoteTaskState(this.state) || !this.stopped) {
            return
        }

        this.stopped = false
        this.startedAt = Date.now()
        this.connectSocket()
    }

    /** 彻底结束：关闭 WebSocket 并回到 idle，可再次 start。 */
    dispose(): void {
        this.stopped = true
        this.closeSocket()
        this.clearStopTimer()
        this.streamId = ''
        this.cursor = 0
        this.session = null
        this.unconfirmed = null
        this.recovering = false
        this.setState('idle', null)
    }

    private setState(state: RemoteTaskState, session: RemoteTaskSession | null): void {
        this.state = state

        if (isTerminalRemoteTaskState(state)) {
            this.clearStopTimer()
            this.stopped = true
            this.closeSocket()
        }

        if (session) {
            this.session = session

            if (session.conversation_id) {
                this.conversationId = session.conversation_id
            }
        }

        this.handlers.onState?.(state, this.session)
    }

    private connectSocket(): void {
        if (this.stopped || !this.streamId || this.socket) {
            return
        }

        this.clearReconnectTimer()
        this.socketSerial += 1
        const serial = this.socketSerial
        let socket: WebSocket

        try {
            socket = new WebSocket(buildRemoteTaskWsUrl())
        } catch (error) {
            this.handlers.onError?.(error instanceof Error ? error : new Error(String(error)))
            this.scheduleReconnect()

            return
        }

        this.socket = socket
        this.connectTimer = window.setTimeout(() => {
            if (this.socket === socket && serial === this.socketSerial) {
                socket.close()
            }
        }, CONNECT_TIMEOUT_MS)

        socket.addEventListener('open', () => {
            if (this.socket !== socket || serial !== this.socketSerial) {
                return
            }

            this.clearConnectTimer()

            try {
                socket.send(JSON.stringify({
                    type: 'subscribe_task',
                    device_id: this.deviceId,
                    stream_id: this.streamId,
                    after_seq: this.cursor,
                }))
            } catch (error) {
                this.handlers.onError?.(error instanceof Error ? error : new Error(String(error)))
                socket.close()

                return
            }

            this.pingTimer = window.setInterval(() => {
                if (socket.readyState !== WebSocket.OPEN) {
                    return
                }

                try {
                    socket.send(JSON.stringify({ type: 'ping' }))
                } catch {
                    socket.close()
                }
            }, SOCKET_PING_MS)
        })

        socket.addEventListener('message', (event) => {
            if (this.socket === socket && serial === this.socketSerial) {
                this.handleSocketMessage(event.data)
            }
        })

        socket.addEventListener('error', () => {
            if (this.socket === socket && serial === this.socketSerial) {
                this.handlers.onError?.(new Error('远程任务 WebSocket 连接异常'))
            }
        })

        socket.addEventListener('close', () => {
            if (this.socket !== socket || serial !== this.socketSerial) {
                return
            }

            this.socket = null
            this.clearConnectionTimers()

            if (!this.stopped && !isTerminalRemoteTaskState(this.state)) {
                this.scheduleReconnect()
            }
        })
    }

    private handleSocketMessage(raw: unknown): void {
        let payload: Record<string, unknown>

        try {
            const parsed = JSON.parse(String(raw || '{}'))

            if (!parsed || typeof parsed !== 'object') {
                return
            }

            payload = parsed as Record<string, unknown>
        } catch {
            this.handlers.onError?.(new Error('远程任务 WebSocket 收到无效消息'))

            return
        }

        const type = String(payload.type || '')

        if (type === 'task_event') {
            const event = payload.event as RemoteTaskEvent | undefined

            if (event) {
                this.applyEvent(event)
            }

            return
        }

        if (type === 'task_state') {
            const session = payload.session as RemoteTaskSession | null

            if (session) {
                this.reconnectAttempts = 0
                this.applySession(session)
            }

            return
        }

        if (type === 'task_stream_gap') {
            this.closeSocket()
            void this.recoverHistory()

            return
        }

        if (type === 'task_stream_error') {
            this.handlers.onError?.(new Error(String(payload.message || '远程任务连接失败')))
            this.closeSocket()
            this.scheduleReconnect()

            return
        }

        if (type === 'task_disconnected') {
            this.closeSocket()
            this.scheduleReconnect()
        }
    }

    private applyEvent(event: RemoteTaskEvent): void {
        const sequence = Number(event._stream_seq)

        if (!Number.isFinite(sequence) || sequence <= this.cursor) {
            return
        }

        if (sequence !== this.cursor + 1) {
            this.handlers.onError?.(new Error('远程任务事件序号不连续，正在补齐'))
            this.closeSocket()
            void this.recoverHistory()

            return
        }

        this.cursor = sequence
        this.reconnectAttempts = 0
        this.handlers.onEvent(event)
        this.checkTrackLimit()
    }

    private applySession(session: RemoteTaskSession): void {
        this.session = session
        this.reconnectAttempts = 0
        const nextState = toRemoteTaskState(session)

        if (isTerminalRemoteTaskState(nextState)) {
            this.setState(nextState, session)

            return
        }

        if (this.state === 'stopping' && nextState === 'running') {
            this.handlers.onState?.(this.state, session)

            return
        }

        this.setState(nextState, session)
        this.checkTrackLimit()
    }

    private async recoverHistory(): Promise<void> {
        if (this.recovering || this.stopped || !this.streamId) {
            return
        }

        this.recovering = true

        try {
            let latestSession: RemoteTaskSession | null = null

            while (!this.stopped) {
                const response = await readRemoteTaskEvents(this.deviceId, this.streamId, this.cursor)
                const events = Array.isArray(response.events) ? response.events : []

                latestSession = response.session || latestSession

                for (const event of events) {
                    const sequence = Number(event?._stream_seq)

                    if (sequence <= this.cursor) {
                        continue
                    }

                    if (sequence !== this.cursor + 1) {
                        throw new Error('电脑返回的任务事件序号仍有缺口')
                    }

                    this.applyEvent(event)
                }

                if (response.has_gap) {
                    throw new Error('电脑任务事件记录存在缺口')
                }

                if (events.length < EVENT_PAGE_SIZE) {
                    break
                }
            }

            if (!this.stopped && latestSession) {
                this.applySession(latestSession)
            }

            if (!this.stopped) {
                this.connectSocket()
            }
        } catch (error) {
            this.handlers.onError?.(error instanceof Error ? error : new Error(String(error)))
            this.scheduleReconnect()
        } finally {
            this.recovering = false
        }
    }

    private checkTrackLimit(): void {
        if (this.startedAt > 0 && Date.now() - this.startedAt > MAX_TRACK_MS) {
            this.detach()
        }
    }

    private scheduleReconnect(): void {
        if (this.stopped || !this.streamId || isTerminalRemoteTaskState(this.state)) {
            return
        }

        this.clearReconnectTimer()
        const delay = Math.min(MAX_RECONNECT_MS, 1000 * 2 ** Math.min(4, this.reconnectAttempts))
        this.reconnectAttempts += 1
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null
            this.connectSocket()
        }, delay)
    }

    private closeSocket(): void {
        this.socketSerial += 1
        this.clearConnectionTimers()
        this.clearReconnectTimer()
        const socket = this.socket
        this.socket = null

        if (socket && socket.readyState <= WebSocket.OPEN) {
            socket.close()
        }
    }

    private clearConnectTimer(): void {
        if (this.connectTimer !== null) {
            window.clearTimeout(this.connectTimer)
            this.connectTimer = null
        }
    }

    private clearConnectionTimers(): void {
        this.clearConnectTimer()

        if (this.pingTimer !== null) {
            window.clearInterval(this.pingTimer)
            this.pingTimer = null
        }
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer !== null) {
            window.clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
    }
}
