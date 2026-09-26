/**
 * 远程任务的流式控制（显式状态机）
 *
 * 为什么是轮询而不是 SSE：电脑经云端网关转发，网关单次 rpc 超时 30 秒
 * （ChatDBServer/api/App/Agent/remote_gateway.py 的 DeviceGateway.rpc），
 * 一条长连接撑不住一次可能跑几分钟的编程任务。所以这里用游标轮询：
 * 电脑侧 `GET /api/local/tasks/<id>/events?after=<seq>` 幂等，
 * 重复读同一游标不会重复投递，因此断线后可以用同一游标安全重放。
 *
 * 状态是显式的，调用方不需要靠事件内容猜：
 *   idle → starting → running ⇄ stopping → done | failed | cancelled | interrupted | gone
 * - `stop()` 只发取消请求并进入 stopping，终态由轮询结果确认；
 * - `detach()` 停止轮询但保留游标，用于切页面；`attach()` 从原游标续读，不丢事件；
 * - `dispose()` 彻底结束并清理定时器。
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
    /** 轮询本身失败（网络抖动、电脑离线、404），不代表任务结束。 */
    onError?: (error: Error) => void
}

/** 活动轮询间隔；空闲时按 IDLE_POLL_INTERVAL 退避，减少对网关的压力。 */
const ACTIVE_POLL_MS = 700
const IDLE_POLL_MS = 2000
/** 连续失败后的退避上限，避免电脑离线时把网关打满。 */
const MAX_ERROR_BACKOFF_MS = 15000
/** 多久没有任何新事件就认为进入空闲（长工具调用期间不会有事件）。 */
const IDLE_AFTER_MS = 4000
/** 单次任务最长跟踪时长，超过后停止轮询但保留游标。 */
const MAX_TRACK_MS = 2 * 60 * 60 * 1000

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

    // 电脑进程重启后未完成的任务会被标记为 interrupted，且不会自动重跑。
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

export class RemoteTaskStream {
    private deviceId: string
    private handlers: RemoteTaskStreamHandlers
    private state: RemoteTaskState = 'idle'
    private session: RemoteTaskSession | null = null
    private streamId = ''
    private conversationId = ''
    private cursor = 0
    private timer: number | null = null
    private polling = false
    private stopped = false
    private errorStreak = 0
    private lastEventAt = 0
    private startedAt = 0
    private lastParams: StartRemoteTaskParams | null = null

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

    /** 任务落到的会话标识；新会话在 start 返回后才确定，调用方需从 start 结果或本方法读取。 */
    getConversationId(): string {
        return this.conversationId
    }

    getCursor(): number {
        return this.cursor
    }

    /**
     * 启动任务。request_id 由本类生成并保留：网络失败后重试 start 会命中电脑侧
     * 的去重记录，不会重复执行。
     */
    async start(params: Omit<StartRemoteTaskParams, 'requestId'> & { requestId?: string }): Promise<void> {
        if (this.state !== 'idle' && this.state !== 'done' && this.state !== 'failed'
            && this.state !== 'cancelled' && this.state !== 'interrupted' && this.state !== 'gone') {
            throw new Error('已有任务在进行中')
        }

        const payload: StartRemoteTaskParams = {
            ...params,
            requestId: params.requestId || this.lastParams?.requestId || newRequestId(),
        }

        this.lastParams = payload
        this.stopped = false
        this.cursor = 0
        this.errorStreak = 0
        this.startedAt = Date.now()
        this.lastEventAt = Date.now()
        this.setState('starting', null)

        const result = await startRemoteTask(this.deviceId, payload)

        this.streamId = String(result.stream_id || '')
        this.conversationId = String(result.conversation_id || payload.conversationId || '')

        if (!this.streamId) {
            this.setState('failed', null)
            throw new Error('电脑未返回任务标识')
        }

        // 接着上一次的会话继续发问时，电脑会回传已存在的会话标识。
        if (result.conversation_id) {
            this.conversationId = result.conversation_id
        }

        this.schedule(0)
    }

    /** 请求停止：发出取消后进入 stopping，终态由轮询确认。 */
    async stop(): Promise<void> {
        if (!this.streamId) {
            return
        }

        this.setState('stopping', this.session)

        try {
            await cancelRemoteTask(this.deviceId, this.streamId)
        } catch (error) {
            // 取消失败不改变结论：轮询仍会带回电脑侧的真实状态。
            this.handlers.onError?.(error instanceof Error ? error : new Error(String(error)))
        }
    }

    /** 停止轮询并保留游标，用于切走视图；任务在电脑上继续跑。 */
    detach(): void {
        this.stopped = true
        this.clearTimer()
    }

    /** 从保留的游标续读，不丢事件也不重复。 */
    attach(): void {
        if (!this.streamId || this.stopped) {
            return
        }

        if (isTerminalRemoteTaskState(this.state)) {
            return
        }

        this.schedule(0)
    }

    /** 彻底结束：停止轮询并回到 idle，可再次 start。 */
    dispose(): void {
        this.stopped = true
        this.clearTimer()
        this.streamId = ''
        this.cursor = 0
        this.session = null
        this.lastParams = null
        this.setState('idle', null)
    }

    private setState(state: RemoteTaskState, session: RemoteTaskSession | null): void {
        this.state = state

        if (session) {
            this.session = session
        }

        this.handlers.onState?.(state, this.session)
    }

    private clearTimer(): void {
        if (this.timer !== null) {
            window.clearTimeout(this.timer)
            this.timer = null
        }
    }

    private schedule(delay: number): void {
        this.clearTimer()

        if (this.stopped || !this.streamId) {
            return
        }

        this.timer = window.setTimeout(() => void this.poll(), Math.max(0, delay))
    }

    private nextDelay(): number {
        if (this.errorStreak > 0) {
            return Math.min(MAX_ERROR_BACKOFF_MS, IDLE_POLL_MS * 2 ** Math.min(4, this.errorStreak))
        }

        const idle = Date.now() - this.lastEventAt > IDLE_AFTER_MS

        return idle ? IDLE_POLL_MS : ACTIVE_POLL_MS
    }

    private async poll(): Promise<void> {
        if (this.polling || this.stopped || !this.streamId) {
            return
        }

        this.polling = true

        try {
            const { events, session } = await readRemoteTaskEvents(this.deviceId, this.streamId, this.cursor)
            this.errorStreak = 0

            for (const event of events || []) {
                // 同一游标重复读取是幂等的，仍按 seq 去重以防电脑侧返回重叠区间。
                if (Number(event?._stream_seq) <= this.cursor) {
                    continue
                }

                this.cursor = Number(event._stream_seq)
                this.lastEventAt = Date.now()
                this.handlers.onEvent(event)
            }

            const nextState = toRemoteTaskState(session || null)

            if (session) {
                this.session = session
            }

            if (this.state === 'starting') {
                this.setState(nextState === 'gone' ? 'running' : nextState, this.session)
            } else if (nextState !== this.state) {
                this.setState(nextState, this.session)
            } else {
                this.handlers.onState?.(this.state, this.session)
            }

            if (isTerminalRemoteTaskState(this.state)) {
                this.stopped = true
                this.clearTimer()

                return
            }

            if (Date.now() - this.startedAt > MAX_TRACK_MS) {
                // 只停止跟踪，不改变任务真实状态；下次 attach 会从当前游标续读。
                this.detach()

                return
            }

            this.schedule(this.nextDelay())
        } catch (error) {
            this.errorStreak += 1
            this.handlers.onError?.(error instanceof Error ? error : new Error(String(error)))
            this.schedule(this.nextDelay())
        } finally {
            this.polling = false
        }
    }
}
