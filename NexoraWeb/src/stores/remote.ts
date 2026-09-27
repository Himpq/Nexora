/**
 * remote.ts — 远程电脑状态中心
 *
 * 侧边栏的 Remote 折叠区与主区的远程聊天共用同一份状态：
 *   - 侧边栏负责选电脑/选会话（remoteStore.selectDevice / selectConversation）；
 *   - 主区只读同一份状态渲染消息、下发任务、回答权限问卡。
 *
 * 因此状态不能放在任一组件里，必须集中在这里，两个视图才不会各读一份。
 * 传输细节（游标轮询、显式状态机）在 network/remoteTaskStream.ts，本文件不碰。
 */

import { markRaw, reactive, watch, type WatchStopHandle } from 'vue'

import type { ChatMessage } from '@/api/conversations'
import {
    createRemoteConversation,
    fetchDevices,
    grantRemotePermission,
    listRemoteConversationGroups,
    listRemoteMessages,
    listRemoteModels,
    type RemoteConversation,
    type RemoteConversationGroup,
    type RemoteDevice,
    type RemoteModelOption,
    type RemoteProjectRef,
} from '@/api/nexoracode'
import {
    RemoteTaskStream,
    isTerminalRemoteTaskState,
    type RemoteTaskState,
} from '@/network/remoteTaskStream'
import {
    applyRemoteEvent,
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

        const session = this.ensureSession(this.conversationId)
        const { messages } = await listRemoteMessages(this.deviceId, this.conversationId)

        session.messages = remoteHistoryToMessages(messages || [])
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
        })
    }

    selectConversation(id: string): void {
        if (id === this.conversationId) {
            return
        }

        // 不再 dispose 流：切走只是换个视图在瞧，正在跑的那个会话继续被轮询和渲染，
        // 回到它就能看到后续进度。多会话并行时这条尤其关键。
        this.conversationId = id
        this.ensureSession(id)

        // 已经加载过就别重复拉历史，否则切来切去会一直打电脑。
        if (this.sessions[id].messages.length) {
            return
        }

        void this.guard(() => this.loadHistory())
    }

    /** 在电脑上新建会话；project 为空表示不归属任何项目（根级平铺）。 */
    async createConversation(project: RemoteProjectRef | null): Promise<void> {
        if (!this.deviceId) {
            return
        }

        await this.guard(async () => {
            const created = await createRemoteConversation(this.deviceId, '新会话', project || undefined)

            this.conversationId = created.conversation_id
            this.ensureSession(created.conversation_id).messages = []
            await this.loadProjects()
        })
    }

    // ---------- 任务 ----------

    /** 下发任务。上下文压缩由电脑按自身阈值自动处理，Web 侧不提供手动开关。 */
    async send(text: string, modelName: string): Promise<void> {
        const key = this.conversationId
        const session = this.ensureSession(key)
        const userMessage = createRemoteUserMessage(session.messages.length, text)
        const target = createStreamingAssistant(userMessage.index + 1)

        session.messages = [...session.messages, userMessage, target]
        const stream = this.ensureStream(key)

        await this.guardSession(session, () => stream.start({
            message: text,
            conversationId: key,
            modelName,
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
     * 电脑端遇到未授权路径时，已经把工具结果落盘、补完剩余调用的占位结果并结束任务
     * （AgentLoop 里 permission_blocked 后直接 break），所以不存在「拒绝后让电脑继续」的通道：
     * 拒绝只是本地记录，只有允许才需要写临时授权。两种情况都要提示用户重新下发任务。
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
            if (allow) {
                if (!request) {
                    throw new Error('该问卡没有可授权的路径信息')
                }

                await grantRemotePermission(this.deviceId, {
                    conversationId: String(request.conversation_id || this.conversationId),
                    path: String(request.path || ''),
                    scope: String(request.scope || 'file'),
                    access: String(request.access || request.operation || 'read'),
                })
            }

            // 标记已作答，卡片转为只读视图，不再重复弹锁。
            if (segment?.question) {
                segment.question.resolved = true
                segment.question.answer = allow
                    ? `已允许本次对话临时访问：${String(request?.path || '')}`
                    : '已拒绝本次访问权限。'
            }

            showToast(allow ? '已授权，重新下发任务即可继续' : '已拒绝，重新下发任务时不会再询问', 'success')
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
            notices: [],
            state: 'idle',
            stageDetail: '',
            error: '',
            busy: false,
            stream: null,
        }

        this.sessions[key] = session
        this.watchTerminal(key, session)

        return session
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

        session.stream = markRaw(new RemoteTaskStream(this.deviceId, {
            onEvent: (event) => {
                const target = session.messages[session.messages.length - 1]

                if (!target || target.status !== 'streaming') {
                    return
                }

                applyRemoteEvent(target, event, session.notices)
            },
            onState: (next, meta) => {
                session.state = next
                session.stageDetail = meta?.cancel_requested || next === 'stopping'
                    ? '已请求停止，等待电脑确认'
                    : meta?.stage_detail || ''
            },
            onError: (cause) => {
                session.error = cause.message
            },
        }))

        return session.stream
    }
}

export const remoteStore = reactive(new RemoteStore())
