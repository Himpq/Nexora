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
const ACTIVE_POLL_MS = 250
const IDLE_POLL_MS = 1500
/**
 * 看到终态后继续读的次数上限，用来排空尾部事件。
 *
 * 电脑端先把 session 标成 done，再把最后几个事件刷进 journal；网关单次 rpc 又是
 * 「读到当下为止」的快照，所以第一次读到 done 时末尾通常还缺事件。排空后才把终态
 * 交给上层，否则上层会把消息定稿并拒收后续事件，表现为回复结尾被截断。
 */
const DRAIN_MAX_POLLS = 8
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
    /**
     * 已从电脑侧读到、但还没对外广播的终态。
     *
     * 排空期间 this.state 仍保持非终态，界面继续显示「执行中」，
     * 等尾部事件读干净了才 setState 收尾。
     */
    private pendingTerminal: RemoteTaskState | null = null
    private drainCount = 0
    /**
     * 已发出但电脑尚未确认的请求。
     *
     * request_id 只能在「同一个请求重试」时复用：电脑按 request_id 去重，
     * 相同 id + 不同内容会直接判为「已被不同请求使用」。所以只有当上一次
     * startRemoteTask 抛在传输途中（电脑没收到，也没确认）时，隔一次重发才
     * 算同一个请求；一旦拿到 stream_id，后续每次 start 都是新任务，必须换 id。
     */
    private unconfirmed: { requestId: string; conversationId: string; message: string } | null = null

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
     * 启动任务。
     *
     * request_id 的复用规则见 unconfirmed 字段：只有「上一次请求电脑压根没收到」
     * 且这次发的是同一条内容时才算重试，其余情况一律新 id。
     */
    async start(params: Omit<StartRemoteTaskParams, 'requestId'> & { requestId?: string }): Promise<void> {
        if (this.state !== 'idle' && this.state !== 'done' && this.state !== 'failed'
            && this.state !== 'cancelled' && this.state !== 'interrupted' && this.state !== 'gone') {
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
        this.errorStreak = 0
        this.startedAt = Date.now()
        this.lastEventAt = Date.now()
        this.pendingTerminal = null
        this.drainCount = 0
        this.setState('starting', null)

        let result: { stream_id?: string; conversation_id?: string }

        try {
            result = await startRemoteTask(this.deviceId, payload)
        } catch (error) {
            // 保留 unconfirmed：这次重发同一条内容时复用 id，命中电脑去重。
            throw error
        }

        // 电脑已受理，后续 start 都是新任务。
        this.unconfirmed = null

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

    /** 把电脑上已运行的任务绑定到当前视图，并从事件头开始重放。 */
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
        this.errorStreak = 0
        this.lastEventAt = Date.now()
        this.startedAt = Date.now()
        this.pendingTerminal = null
        this.drainCount = 0
        this.setState(state, session)
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
        if (!this.streamId) {
            return
        }

        if (isTerminalRemoteTaskState(this.state)) {
            return
        }

        if (!this.stopped) {
            return
        }

        this.stopped = false
        this.startedAt = Date.now()
        this.lastEventAt = Date.now()

        this.schedule(0)
    }

    /** 彻底结束：停止轮询并回到 idle，可再次 start。 */
    dispose(): void {
        this.stopped = true
        this.clearTimer()
        this.streamId = ''
        this.cursor = 0
        this.session = null
        this.unconfirmed = null
        this.pendingTerminal = null
        this.drainCount = 0
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

            let fresh = 0

            for (const event of events || []) {
                // 同一游标重复读取是幂等的，仍按 seq 去重以防电脑侧返回重叠区间。
                if (Number(event?._stream_seq) <= this.cursor) {
                    continue
                }

                this.cursor = Number(event._stream_seq)
                this.lastEventAt = Date.now()
                fresh += 1
                this.handlers.onEvent(event)
            }

            const nextState = toRemoteTaskState(session || null)

            if (session) {
                this.session = session

                if (session.conversation_id) {
                    this.conversationId = session.conversation_id
                }
            }

            if (isTerminalRemoteTaskState(nextState)) {
                this.pendingTerminal = nextState
            }

            // drainCount > 0 保证「首次观测到终态」之后至少再读一次：
            // 第一轮读到 done 时 fresh 很可能为 0（任务还没产出事件），
            // 那不是「已排空」，直接收尾会丢掉后续全部内容。
            if (this.pendingTerminal && this.drainCount > 0
                && (fresh === 0 || this.drainCount >= DRAIN_MAX_POLLS)) {
                this.setState(this.pendingTerminal, this.session)
                this.stopped = true
                this.clearTimer()

                return
            }

            if (this.pendingTerminal) {
                this.drainCount += 1
            } else if (nextState !== this.state) {
                this.drainCount = 0
                this.setState(this.state === 'starting' && nextState === 'gone' ? 'running' : nextState, this.session)
            } else {
                this.handlers.onState?.(this.state, this.session)
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
