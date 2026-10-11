/**
 * remote.ts — 远程电脑状态中心
 *
 * 侧边栏的 Remote 折叠区与主区的远程聊天共用同一份状态：
 *   - 侧边栏负责选电脑/选会话（remoteStore.selectDevice / selectConversation）；
 *   - 主区只读同一份状态渲染消息、下发任务、回答权限问卡。
 *
 * 因此状态不能放在任一组件里，必须集中在这里，两个视图才不会各读一份。
 * 传输细节（WebSocket 事件流、游标补读与显式状态机）在 network/remoteTaskStream.ts。
 */

import { markRaw, reactive, watch, type WatchStopHandle } from 'vue'

import { INITIAL_MESSAGE_LIMIT, PREVIOUS_MESSAGE_LIMIT, type ChatMessage } from '@/api/conversations'
import {
    createRemoteConversation,
    fetchDevices,
    grantRemotePermission,
    listRemoteConversationGroups,
    listRemoteMessages,
    listRemoteModels,
    listRemoteTasks,
    type RemoteChatMessage,
    type RemoteConversation,
    type RemoteConversationGroup,
    type RemoteDevice,
    type RemoteModelOption,
    type RemoteProjectRef,
    type RemoteTaskSession,
} from '@/api/nexoracode'
import {
    RemoteTaskStream,
    isTerminalRemoteTaskState,
    type RemoteTaskState,
} from '@/network/remoteTaskStream'
import {
    applyRemoteEvent,
    applyRemoteFinalMessage,
    beginRemoteQueuedTurn,
    createRemoteUserMessage,
    createStreamingAssistant,
    finalizeStreamingMessage,
    remoteHistoryToMessages,
    type RemoteTaskNotice,
} from '@/stream/remoteSegments'
import { showToast } from '@/stores/notify'

/** 设备在线状态轮询间隔(ms)：电脑端掉线/上线只能靠轮询发现。 */
const DEVICE_POLL_MS = 5000

/**
 * 单个会话的运行时状态。
 *
 * 按会话独立而不是全局一份：电脑端支持多会话并行（每个任务一个线程 + 独立
 * ProviderClient），Web 侧也必须能同时盯多条流。全局一份状态会导致
 * 「A 在跑时切到 B 把 A 的轮询掐掉」以及「B 连发都发不出去」。
 */
interface RemoteSession {
    messages: ChatMessage[]
    historyRows: RemoteChatMessage[]
    historyStartIndex: number
    historyTotal: number
    historyUserCount: number | null
    historyLoaded: boolean
    historyLoading: boolean
    hasMoreBefore: boolean
    loadingBefore: boolean
    nextMessageIndex: number
    notices: RemoteTaskNotice[]
    state: RemoteTaskState
    stageDetail: string
    error: string
    busy: boolean
    /** 流实例不参与渲染，创建时 markRaw 让它跳出响应式代理。 */
    stream: RemoteTaskStream | null
}

class RemoteStore {
    devices: RemoteDevice[] = []
    deviceId = ''
    /** device_id → 会话分组。离线电脑保留最后一次拉到的结果，展开时仍可读标题。 */
    groupsByDevice: Record<string, RemoteConversationGroup[]> = {}
    conversationId = ''
    /**
     * 会话 id → 运行时状态。新会话在电脑分配 id 之前挂在空串这个键下，
     * start() 返回后由 adoptSessionId 迁到真实 id。
     */
    sessions: Record<string, RemoteSession> = {}
    /** 当前电脑的模型目录（顶栏那个选择器在远程视图下展示它）。 */
    models: RemoteModelOption[] = []
    /** 本次任务用哪个电脑模型。默认取电脑自己的 default_model，而不是空串。 */
    modelName = ''
    /** 用户是否手动选过模型。选过之后就不再被电脑默认的刷新覆盖。 */
    modelPinned = false
    loadingProjects = false
    /** 设备级操作（切电脑、拉列表）互斥标记，与会话内的 busy 分开。 */
    busy = false

    private devicePoller = 0
    private started = false
    private historyLoads = new Map<string, Promise<void>>()
    private syncingTaskDevices = new Set<string>()
    /** 终态收尾的 watch 不能放进响应式对象，按会话 id 单独存。 */
    private terminalWatchers = new Map<string, WatchStopHandle>()

    // ---------- 派生状态 ----------

    /** 当前会话的运行时状态；没有就现建，保证视图永远拿到同一份引用。 */
    get current(): RemoteSession {
        return this.ensureSession(this.conversationId)
    }

    get messages(): ChatMessage[] {
        return this.current.messages
    }

    get historyLoading(): boolean {
        return this.current.historyLoading
    }

    get hasMoreBefore(): boolean {
        return this.current.hasMoreBefore
    }

    get loadingBefore(): boolean {
        return this.current.loadingBefore
    }

    get notices(): RemoteTaskNotice[] {
        return this.current.notices
    }

    get state(): RemoteTaskState {
        return this.current.state
    }

    get stageDetail(): string {
        return this.current.stageDetail
    }

    get error(): string {
        return this.current.error
    }

    /** 当前会话是否正在执行（顶栏/输入坞的停止按钮与侧栏转圈都读它）。 */
    get running(): boolean {
        return !isTerminalRemoteTaskState(this.current.state) && this.current.state !== 'idle'
    }

    /**
     * 当前会话是否处于「已请求停止、等待电脑确认」。
     *
     * 此时任务还在收尾，停止按钮仍要显示（running 为真），但消息尾部那个跳动的
     * 输出小点应当停下——用户已经点了停止，再跳会让人以为没生效。
     */
    get stopping(): boolean {
        return this.current.state === 'stopping'
    }

    /** 任意会话正在执行时为真：用于「电脑下线时不切走正在跑的任务」这类判断。 */
    get anyRunning(): boolean {
        return Object.values(this.sessions).some(
            session => !isTerminalRemoteTaskState(session.state) && session.state !== 'idle'
        )
    }

    get deviceName(): string {
        return this.devices.find(item => item.device_id === this.deviceId)?.name || '电脑'
    }

    /** 某会话是否正在执行；侧栏按会话逐个挂转圈标记。 */
    isRunning(conversationId: string): boolean {
        const session = this.sessions[conversationId]

        return !!session && !isTerminalRemoteTaskState(session.state) && session.state !== 'idle'
    }


    get online(): boolean {
        return this.devices.find(item => item.device_id === this.deviceId)?.online === true
    }

    /** 当前会话标题：在电脑侧会话列表里按 id 查，标题始终与电脑端一致。 */
    get conversationTitle(): string {
        const conversation = this.conversations.find(item => item.conversation_id === this.conversationId)

        return conversation ? conversation.title || '未命名会话' : `${this.deviceName} · 新任务`
    }

    /** 某台电脑的会话分组（按项目聚合）。 */
    groupsOf(id: string): RemoteConversationGroup[] {
        return this.groupsByDevice[id] || []
    }

    /** 当前电脑的会话分组（按项目聚合）。 */
    get groups(): RemoteConversationGroup[] {
        return this.groupsOf(this.deviceId)
    }

    /** 当前电脑的全部会话，拍平后供标题查找与新建后的定位使用。 */
    get conversations(): RemoteConversation[] {
        return this.groups.flatMap(group => group.conversations)
    }

    // ---------- 生命周期 ----------

    /** 启动一次后台刷新循环；侧边栏挂载时调用，重复调用无副作用。 */
    start(): void {
        if (this.started) {
            return
        }

        this.started = true
        void this.loadDevices()

        this.devicePoller = window.setInterval(() => {
            if (!this.busy) {
                void this.loadDevices()
            }
        }, DEVICE_POLL_MS)
    }

    dispose(): void {
        window.clearInterval(this.devicePoller)
        Object.values(this.sessions).forEach(session => session.stream?.dispose())
        this.terminalWatchers.forEach(stop => stop())
        this.terminalWatchers.clear()
        this.sessions = {}
    }

    // ---------- 数据加载 ----------

    async loadDevices(): Promise<void> {
        this.devices = (await fetchDevices()).devices
        const selectedDeviceId = this.deviceId

        const current = this.devices.find(item => item.device_id === this.deviceId)
        const onlineDevices = this.devices.filter(item => item.online)

        // 选中的电脑已下线：让位给在线的电脑，否则用户要手动点一次才能下发任务。
        // 只在没有任何会话正在跑时让位，否则会把正在执行的任务连同轮询一起丢掉。
        if (!current?.online && onlineDevices.length && !this.anyRunning) {
            this.selectDevice(onlineDevices[0].device_id)

            return
        }

        // 全部电脑都离线时也给出入口，选第一台让用户看到配对/连接状态。
        if (!this.deviceId && this.devices.length) {
            this.selectDevice((onlineDevices[0] || this.devices[0]).device_id)

            return
        }

        // 离线电脑保留最后一次拉到的会话列表，不再拉取，避免每 5 秒刷一次 409。
        if (current?.online) {
            // 模型一起刷:电脑端改了 default_model 时顶栏要跟上,
            // loadModels 内部只在用户没手动选过时才覆盖选中项。
            await Promise.all([this.loadProjects(), this.loadModels()])

            if (selectedDeviceId === this.deviceId) {
                await this.syncActiveTasks(selectedDeviceId)
            }
        }
    }

    /** 刷新所有在线电脑的会话分组：侧边栏要一次拿到全部电脑的会话与数量。 */
    async loadProjects(): Promise<void> {
        const onlineIds = this.devices.filter(item => item.online).map(item => item.device_id)

        if (!onlineIds.length) {
            return
        }

        this.loadingProjects = true

        try {
            const results = await Promise.all(onlineIds.map(async (id) => ({
                id,
                groups: await listRemoteConversationGroups(id),
            })))
            const next: Record<string, RemoteConversationGroup[]> = { ...this.groupsByDevice }

            results.forEach(item => {
                next[item.id] = item.groups
            })

            this.groupsByDevice = next
        } finally {
            this.loadingProjects = false
        }
    }

    /**
     * 模型来自当前电脑:换电脑必须重取。
     *
     * default_model 是电脑认的默认(provider.json 的 default_id),直接作为初始选中项,
     * 这样顶栏显示的就是实际会用的模型,不会和桌面上显示的模型对不上。
     * 用户手动选过(modelPinned)之后,后续刷新只更新目录不动选中项。
     */
    async loadModels(): Promise<void> {
        if (!this.deviceId || !this.online) {
            this.models = []
            this.modelName = ''
            this.modelPinned = false

            return
        }

        const { default_model: defaultModel, models } = await listRemoteModels(this.deviceId)

        this.models = models || []

        if (!this.modelPinned) {
            this.modelName = String(defaultModel || '')
        }
    }

    async loadHistory(): Promise<void> {
        if (!this.deviceId || !this.conversationId) {
            return
        }

        await this.loadConversationHistory(this.deviceId, this.conversationId)
    }

    /** 多个入口同时加载同一会话时共用一次请求，避免历史覆盖刚恢复的流式消息。 */
    private async loadConversationHistory(deviceId: string, conversationId: string): Promise<void> {
        const key = JSON.stringify([deviceId, conversationId])
        const session = this.ensureSession(conversationId)

        if (session.historyLoaded) {
            return
        }

        const pending = this.historyLoads.get(key)

        if (pending) {
            await pending

            return
        }

        session.historyLoading = true
        session.error = ''

        const request = listRemoteMessages(deviceId, conversationId, {
            limit: INITIAL_MESSAGE_LIMIT,
        }).then(data => {
            if (this.deviceId !== deviceId || this.sessions[conversationId] !== session) {
                return
            }

            const rows = Array.isArray(data.messages) ? data.messages : []
            const startIndex = Math.max(0, Number(data.start_index) || 0)
            const total = Math.max(rows.length, Number(data.total) || 0)
            const previousHistoryTotal = session.historyTotal
            const runtimeMessages = session.messages.filter(message => Number(message.index) >= previousHistoryTotal)

            session.historyRows = rows
            session.historyStartIndex = startIndex
            session.historyTotal = total
            session.historyUserCount = typeof data.total_user_messages === 'number'
                ? data.total_user_messages
                : total <= rows.length
                    ? rows.filter(row => String(row.role || '') === 'user').length
                    : null
            session.hasMoreBefore = data.has_more_before === true
            session.historyLoaded = true
            session.messages = [
                ...remoteHistoryToMessages(rows, startIndex),
                ...runtimeMessages,
            ]
            session.nextMessageIndex = Math.max(
                session.nextMessageIndex,
                total,
                session.messages.reduce((next, message) => Math.max(next, Number(message.index) + 1), 0),
            )
        }).catch(cause => {
            session.error = cause instanceof Error ? cause.message : String(cause)
            throw cause
        }).finally(() => {
            session.historyLoading = false
        })

        this.historyLoads.set(key, request)

        try {
            await request
        } finally {
            if (this.historyLoads.get(key) === request) {
                this.historyLoads.delete(key)
            }
        }
    }

    /** 按普通会话的游标语义向前拉一页，并保留当前视口位置。 */
    async loadPreviousHistory(): Promise<boolean> {
        const deviceId = this.deviceId
        const conversationId = this.conversationId
        const session = this.current

        if (!deviceId || !conversationId || !session.hasMoreBefore || session.loadingBefore) {
            return false
        }

        session.loadingBefore = true

        try {
            const data = await listRemoteMessages(deviceId, conversationId, {
                limit: PREVIOUS_MESSAGE_LIMIT,
                before: session.historyStartIndex,
            })

            if (this.deviceId !== deviceId || this.sessions[conversationId] !== session) {
                return false
            }

            const olderRows = Array.isArray(data.messages) ? data.messages : []
            const olderStartIndex = Math.max(0, Number(data.start_index) || 0)

            if (!olderRows.length || olderStartIndex >= session.historyStartIndex) {
                session.hasMoreBefore = false

                return false
            }

            const runtimeMessages = session.messages.filter(message => Number(message.index) >= session.historyTotal)
            session.historyRows = [...olderRows, ...session.historyRows]
            session.historyStartIndex = olderStartIndex
            session.hasMoreBefore = data.has_more_before === true
            session.messages = [
                ...remoteHistoryToMessages(session.historyRows, olderStartIndex),
                ...runtimeMessages,
            ]
            session.nextMessageIndex = Math.max(
                session.nextMessageIndex,
                session.messages.reduce((next, message) => Math.max(next, Number(message.index) + 1), 0),
            )

            return true
        } finally {
            session.loadingBefore = false
        }
    }

    /** 查电脑当前任务并接管未完成会话，事件从游标零开始幂等重放。 */
    private async syncActiveTasks(deviceId: string): Promise<void> {
        if (!deviceId || deviceId !== this.deviceId || this.syncingTaskDevices.has(deviceId)) {
            return
        }

        this.syncingTaskDevices.add(deviceId)

        try {
            const { sessions } = await listRemoteTasks(deviceId)

            if (deviceId !== this.deviceId) {
                return
            }

            const activeTasks: RemoteTaskSession[] = (sessions || []).filter(task =>
                task.status === 'running' || task.status === 'cancelling'
            )

            // 等待本页任务受理期间还没有 stream_id，暂缓接管，避免并发创建第二条轮询流。
            if (Object.values(this.sessions).some(session => session.busy && session.state === 'starting')) {
                return
            }

            for (const task of activeTasks) {
                const conversationId = String(task.conversation_id || '')

                if (!conversationId || !task.stream_id) {
                    continue
                }

                const existingStream = Object.entries(this.sessions).find(([, session]) =>
                    session.stream?.getStreamId() === task.stream_id
                )

                if (existingStream) {
                    this.adoptSessionId(existingStream[0], conversationId)
                    existingStream[1].stream?.attach()

                    continue
                }

                const session = this.ensureSession(conversationId)

                // 当前页面正在等待自己的 start 响应时，不要抢先替换它创建的流实例。
                if (session.busy && session.state === 'starting') {
                    continue
                }

                if (session.stream?.getStreamId() === task.stream_id) {
                    session.stream.attach()

                    continue
                }

                if (session.stream) {
                    session.stream.dispose()
                    session.stream = null
                }

                await this.loadConversationHistory(deviceId, conversationId)

                if (deviceId !== this.deviceId || this.sessions[conversationId] !== session) {
                    return
                }

                const historyUserCount = task.history_user_count
                const lastUser = [...session.messages].reverse().find(message => message.role === 'user')
                const currentUserSaved = typeof historyUserCount === 'number' && typeof session.historyUserCount === 'number'
                    ? session.historyUserCount > historyUserCount
                    : lastUser?.content === task.message
                const currentUserAlreadyShown = !!task.message && session.messages.some(message =>
                    message.role === 'user'
                    && message.content === task.message
                    && Number(message.index) >= session.historyTotal
                )

                // 续跑任务的请求消息是内部提示（不落盘），补成用户气泡会污染对话。
                if (task.message && !task.is_regenerate && !task.skip_user_message && !currentUserSaved && !currentUserAlreadyShown) {
                    session.messages = [
                        ...session.messages,
                        createRemoteUserMessage(this.takeNextMessageIndex(session), task.message),
                    ]
                }

                const lastMessage = session.messages[session.messages.length - 1]

                if (lastMessage?.role !== 'assistant' || lastMessage.status !== 'streaming') {
                    session.messages = [
                        ...session.messages,
                        createStreamingAssistant(this.takeNextMessageIndex(session)),
                    ]
                }

                session.notices = []
                session.error = ''
                this.ensureStream(conversationId).restore(task)
            }
        } finally {
            this.syncingTaskDevices.delete(deviceId)
        }
    }

    // ---------- 选择 ----------

    selectDevice(id: string): void {
        if (id === this.deviceId) {
            return
        }

        // 换电脑要把旧电脑的运行时状态连流一起清掉：那些流绑的是旧 device_id，
        // 留着只会继续轮询一台不该再问的电脑。
        Object.values(this.sessions).forEach(session => session.stream?.dispose())
        this.sessions = {}
        this.terminalWatchers.forEach(stop => stop())
        this.terminalWatchers.clear()
        this.deviceId = id
        this.conversationId = ''
        // 换电脑等于换一套模型,手动选择作废,回到那台电脑自己的默认。
        this.modelPinned = false
        void this.guard(async () => {
            await Promise.all([this.loadProjects(), this.loadModels()])
            await this.loadHistory()

            if (this.deviceId === id) {
                await this.syncActiveTasks(id)
            }
        })
    }

    selectConversation(id: string): void {
        if (id === this.conversationId) {
            return
        }

        // 不再 dispose 流：切走只是换个视图在瞧，正在跑的那个会话继续被轮询和渲染，
        // 回到它就能看到后续进度。多会话并行时这条尤其关键。
        this.conversationId = id
        const session = this.ensureSession(id)

        // 先查询活动任务再加载历史：若该会话在电脑端正在跑，syncActiveTasks 会立即
        // 接管它的流并追加 streaming 占位；若先加载历史，中间窗口里事件会因「最后一条
        // 消息不是 streaming」被丢弃，表现为「点进去先看到历史、过一会才接上流」。
        void this.guard(async () => {
            const deviceId = this.deviceId
            session.historyLoading = !session.historyLoaded && !session.messages.length

            try {
                try {
                    await this.syncActiveTasks(deviceId)
                } finally {
                    if (this.deviceId === deviceId && this.sessions[id] === session && !session.historyLoaded) {
                        await this.loadConversationHistory(deviceId, id)
                    }
                }
            } finally {
                session.historyLoading = false
            }
        }).catch(cause => {
            session.error = cause instanceof Error ? cause.message : String(cause)
        })
    }

    /** 在电脑上新建会话；project 为空表示不归属任何项目（根级平铺）。 */
    async createConversation(project: RemoteProjectRef | null): Promise<void> {
        if (!this.deviceId) {
            return
        }

        await this.guard(async () => {
            const created = await createRemoteConversation(this.deviceId, '新会话', project || undefined)

            this.conversationId = created.conversation_id
            const session = this.ensureSession(created.conversation_id)
            session.messages = []
            session.historyRows = []
            session.historyStartIndex = 0
            session.historyTotal = 0
            session.historyUserCount = 0
            session.historyLoaded = true
            session.hasMoreBefore = false
            session.nextMessageIndex = 0
            await this.loadProjects()
        })
    }

    // ---------- 任务 ----------

    /** 下发任务。上下文压缩由电脑按自身阈值自动处理，Web 侧不提供手动开关。 */
    async send(text: string, modelName: string, enableThinking: boolean): Promise<void> {
        const key = this.conversationId
        const session = this.ensureSession(key)
        const userMessage = createRemoteUserMessage(this.takeNextMessageIndex(session), text)
        const target = createStreamingAssistant(this.takeNextMessageIndex(session))

        session.messages = [...session.messages, userMessage, target]
        const stream = this.ensureStream(key)

        await this.guardSession(session, () => stream.start({
            message: text,
            conversationId: key,
            modelName,
            enableThinking,
        }))

        // 新会话此时才有真实 id，把运行时状态迁过去，侧栏/历史才对得上。
        this.adoptSessionId(key, stream.getConversationId())

        // 下发失败时不能留下空气泡。
        if (session.state === 'idle') {
            session.messages = session.messages.slice(0, -2)
        }
    }

    async stop(): Promise<void> {
        const session = this.current
        const client = session.stream

        if (!client) {
            return
        }

        await this.guardSession(session, () => client.stop())
    }

    /**
     * 权限问卡作答。
     *
     * 电脑端遇到未授权路径时会结束本轮任务，但会把「被阻断的调用」登记下来；
     * 用户允许后，grant 接口写临时授权并自动续跑该轮，返回 resume_stream_id。
     * 这里拿到续跑流后立即接管，用户无需再手动下发任务。
     * 拒绝则只是本地记录，不触发续跑。
     */
    async answerQuestion(message: ChatMessage, questionId: string, answer: string): Promise<void> {
        const content = String(answer || '').trim()

        if (!content) {
            return
        }

        const segment = (message.segments || []).find(item => item.type === 'question'
            && (item.question?.question_id === questionId || item.question?.question_card_id === questionId))
        const request = segment?.question?.permission_request as Record<string, unknown> | undefined
        const allow = content.includes('允许')
        const deny = content.includes('拒绝')

        if (!allow && !deny) {
            showToast('请选择允许或拒绝访问', 'warning')

            return
        }

        await this.guard(async () => {
            let resumed = false

            if (request) {
                const result = await grantRemotePermission(this.deviceId, {
                    conversationId: String(request.conversation_id || this.conversationId),
                    path: String(request.path || ''),
                    scope: String(request.scope || 'file'),
                    access: String(request.access || request.operation || 'read'),
                    decision: allow ? 'allow' : 'deny',
                })

                resumed = !!(result?.resumed && result?.resume_stream_id)
            } else if (allow) {
                throw new Error('该问卡没有可授权的路径信息')
            }

            // 标记已作答，卡片转为只读视图，不再重复弹锁。
            if (segment?.question) {
                segment.question.resolved = true
                segment.question.answer = allow
                    ? `已允许本次对话临时访问：${String(request?.path || '')}`
                    : '已拒绝本次访问权限。'
            }

            if (resumed) {
                showToast(allow ? '已授权，正在继续执行' : '已拒绝，正在继续', 'success')

                // 续跑任务已在电脑上运行，交给既有的活动任务同步接管轮询。
                await this.syncActiveTasks(this.deviceId)

                return
            }

            showToast(
                allow ? '已授权，重新下发任务即可继续' : '已拒绝，重新下发任务时不会再询问',
                'success',
            )
        })
    }

    // ---------- 内部 ----------

    /** 设备级调用互斥（切电脑、拉列表），会话内的并发由 guardSession 各自负责。 */
    private async guard(action: () => Promise<void>): Promise<void> {
        if (this.busy) {
            return
        }

        this.busy = true

        try {
            await action()
        } finally {
            this.busy = false
        }
    }

    /** 会话级调用互斥：同一会话不重复下发，不同会话互不影响（并行靠这一层放行）。 */
    private async guardSession(session: RemoteSession, action: () => Promise<void>): Promise<void> {
        if (session.busy) {
            return
        }

        session.busy = true
        session.error = ''

        try {
            await action()
        } catch (cause) {
            session.error = cause instanceof Error ? cause.message : String(cause)
        } finally {
            session.busy = false
        }
    }

    private ensureSession(key: string): RemoteSession {
        const existing = this.sessions[key]

        if (existing) {
            return existing
        }

        const session: RemoteSession = {
            messages: [],
            historyRows: [],
            historyStartIndex: 0,
            historyTotal: 0,
            historyUserCount: null,
            historyLoaded: false,
            historyLoading: false,
            hasMoreBefore: false,
            loadingBefore: false,
            nextMessageIndex: 0,
            notices: [],
            state: 'idle',
            stageDetail: '',
            error: '',
            busy: false,
            stream: null,
        }

        this.sessions[key] = session
        // 通过响应式映射取回代理；watchTerminal 必须监听代理上的 state。
        const reactiveSession = this.sessions[key]
        this.watchTerminal(key, reactiveSession)

        return reactiveSession
    }

    /** 为当前会话分配单调递增的消息索引，避免窗口化历史下用数组长度产生重复 key。 */
    private takeNextMessageIndex(session: RemoteSession): number {
        const index = Math.max(session.nextMessageIndex, session.historyTotal)
        session.nextMessageIndex = index + 1

        return index
    }

    /**
     * 终态收尾：把流式消息定稿、收起压缩提示。
     *
     * 每个会话一份 watch。盯 state 而不是流实例：stream 是 markRaw 的普通变量，
     * watch 追踪不到它的变化。
     */
    private watchTerminal(key: string, session: RemoteSession): void {
        const stop = watch(
            () => session.state,
            (next) => {
                if (!isTerminalRemoteTaskState(next)) {
                    return
                }

                const target = session.messages[session.messages.length - 1]

                if (target?.status === 'streaming') {
                    finalizeStreamingMessage(target)
                }

                session.notices = []
            }
        )

        // key 会被 adoptSessionId 迁走，停止句柄跟着换键，否则旧句柄删不掉。
        this.terminalWatchers.get(key)?.()
        this.terminalWatchers.set(key, stop)
    }

    /** 新会话拿到电脑分配的 id 后，把运行时状态从空串键迁到真实 id。 */
    private adoptSessionId(fromKey: string, toKey: string): void {
        if (!toKey || toKey === fromKey || !this.sessions[fromKey]) {
            return
        }

        const session = this.sessions[fromKey]
        const watcher = this.terminalWatchers.get(fromKey)

        delete this.sessions[fromKey]
        this.terminalWatchers.delete(fromKey)
        this.sessions[toKey] = session

        if (watcher) {
            watcher()
            this.terminalWatchers.set(toKey, watcher)
        }

        if (this.conversationId === fromKey) {
            this.conversationId = toKey
        }
    }

    /** 每个会话一条流：事件只作用于该会话自己的最后一条消息。 */
    private ensureStream(key: string): RemoteTaskStream {
        const session = this.ensureSession(key)

        if (session.stream) {
            return session.stream
        }

        /**
         * 当前轮次的助手气泡。
         *
         * 接管已在跑的任务时 restore() 会把游标归零、从头重放整条流，
         * 历史轮次的 content / tool 事件也会被再读一次。若一律写到「最后一条
         * assistant」，重放的历史内容会灌进本轮气泡。这里用轮次指针隔离：
         * queue_turn_start 指向本轮，queue_turn_end 后置空，置空期间的普通
         * 事件属于已落盘的历史轮次，直接丢弃。
         */
        let turnTarget: ChatMessage | null = null

        session.stream = markRaw(new RemoteTaskStream(this.deviceId, {
            onEvent: (event) => {
                // 队列轮次切分：电脑端多轮共用一条流，每轮以 queue_turn_start 开头。
                // 这里必须自己重建用户气泡与助手占位——本地通道有 pendingStreams
                // 缓冲，云端 Remote 主区没有，不处理就会「队列消息在云端看不见」。
                if (event.type === 'queue_turn_start') {
                    turnTarget = beginRemoteQueuedTurn(session.messages, event, this.takeNextMessageIndex(session))

                    return
                }

                if (event.type === 'queue_turn_end') {
                    applyRemoteFinalMessage(turnTarget, event.final_message)
                    turnTarget = null

                    return
                }

                // 未收到 queue_turn_start 的普通事件（单轮任务、或本轮首帧先于
                // 切分帧到达）：回退到「最后一条 assistant」。
                const target = turnTarget
                    || [...session.messages].reverse().find(message => message.role === 'assistant')

                if (!target) {
                    return
                }

                applyRemoteEvent(target, event)
            },
            onState: (next, meta) => {
                session.state = next
                session.stageDetail = meta?.cancel_requested || next === 'stopping'
                    ? '已请求停止，等待电脑确认'
                    : meta?.stage_detail || ''

                if (isTerminalRemoteTaskState(next)) {
                    const activeAssistant = turnTarget
                        || [...session.messages].reverse().find(message =>
                            message.role === 'assistant' && message.status === 'streaming'
                        )

                    if (activeAssistant?.status === 'streaming') {
                        finalizeStreamingMessage(activeAssistant)
                    }

                    turnTarget = null
                }

                if (meta?.conversation_id) {
                    this.adoptSessionId(key, meta.conversation_id)
                }
            },
            onError: (cause) => {
                session.error = cause.message
            },
        }))

        return session.stream
    }
}

export const remoteStore = reactive(new RemoteStore())
