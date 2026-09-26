<!--
    RemoteProjectsView.vue — 远程项目（容器）

    只做编排：选电脑 → 选会话 → 下发任务 → 消费流式事件。
    真正的界面在 RemoteProjectList / RemoteTaskPanel 两个子组件里。
    传输与状态机在 network/remoteTaskStream.ts，本文件不碰轮询细节。
-->

<template>
    <section class="remote-projects" aria-label="远程项目">
        <header class="remote-projects-head">
            <h1 class="remote-projects-title">Projects</h1>
            <div class="remote-projects-devices">
                <button
                    v-for="device in devices"
                    :key="device.device_id"
                    type="button"
                    class="remote-device"
                    :class="{ 'is-active': device.device_id === deviceId, 'is-online': device.online }"
                    :aria-pressed="device.device_id === deviceId"
                    :disabled="busy"
                    @click="selectDevice(device.device_id)"
                >
                    <span class="remote-device-dot" aria-hidden="true"></span>
                    <span class="remote-device-name">{{ device.name || '未命名电脑' }}</span>
                    <span class="remote-device-state">{{ device.online ? '在线' : '离线' }}</span>
                </button>
                <p v-if="!devices.length && !loadingDevices" class="remote-projects-hint">
                    还没有电脑绑定。在左下角用户菜单的「远程连接」里生成配对码。
                </p>
            </div>
        </header>

        <div v-if="!deviceId" class="remote-projects-hint">请选择一台电脑。</div>

        <div v-else class="remote-projects-layout">
            <RemoteProjectList
                :projects="projects"
                :conversation-id="conversationId"
                :loading="loadingProjects"
                :disabled="!online"
                :running="running"
                @select-conversation="selectConversation"
                @new-conversation="createConversation"
            />

            <RemoteTaskPanel
                :title="panelTitle"
                :state="state"
                :stage-detail="stageDetail"
                :online="online"
                :busy="busy"
                :conversation-id="conversationId"
                :messages="messages"
                :notices="notices"
                :models="models"
                @send="send"
                @stop="stopTask"
                @answer-question="handleQuestionAnswer"
                @open-image="(url) => emit('open-image', url)"
            />
        </div>

        <p v-if="error" role="alert" class="remote-projects-error">{{ error }}</p>
    </section>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, ref, watch } from 'vue'

    import type { ChatMessage } from '@/api/conversations'
    import {
        createRemoteConversation,
        fetchDevices,
        grantRemotePermission,
        listRemoteMessages,
        listRemoteModels,
        listRemoteProjects,
        type RemoteDevice,
        type RemoteModelOption,
        type RemoteProject,
        type RemoteProjectRef,
    } from '@/api/nexoracode'
    import {
        RemoteTaskStream,
        isTerminalRemoteTaskState,
        type RemoteTaskState,
    } from '@/network/remoteTaskStream'
    import {
        applyRemoteEvent,
        createStreamingAssistant,
        finalizeStreamingMessage,
        remoteHistoryToMessages,
        type RemoteTaskNotice,
    } from '@/stream/remoteSegments'
    import { showToast } from '@/stores/notify'

    import RemoteProjectList from './RemoteProjectList.vue'
    import RemoteTaskPanel from './RemoteTaskPanel.vue'

    import '@/styles/remote-projects.css'

    /** 设备在线状态轮询间隔(ms)：电脑端掉线/上线只能靠轮询发现。 */
    const DEVICE_POLL_MS = 5000

    const props = defineProps<{ open: boolean }>()

    const emit = defineEmits<{ 'open-image': [url: string] }>()

    const devices = ref<RemoteDevice[]>([])
    const deviceId = ref('')
    const projects = ref<RemoteProject[]>([])
    const conversationId = ref('')
    const messages = ref<ChatMessage[]>([])
    const notices = ref<RemoteTaskNotice[]>([])
    const models = ref<RemoteModelOption[]>([])
    const loadingDevices = ref(false)
    const loadingProjects = ref(false)
    const busy = ref(false)
    const error = ref('')
    const stageDetail = ref('')
    const state = ref<RemoteTaskState>('idle')

    let stream: RemoteTaskStream | null = null

    const online = computed(() => devices.value.find(d => d.device_id === deviceId.value)?.online === true)
    const running = computed(() => !isTerminalRemoteTaskState(state.value) && state.value !== 'idle')
    const deviceName = computed(() => devices.value.find(d => d.device_id === deviceId.value)?.name || '电脑')
    const panelTitle = computed(() => {
        const conversation = projects.value.flatMap(p => p.conversations).find(c => c.conversation_id === conversationId.value)

        return conversation ? conversation.title || '未命名会话' : `${deviceName.value} · 新任务`
    })

    function disposeStream(): void {
        stream?.dispose()
        stream = null
        state.value = 'idle'
        stageDetail.value = ''
        notices.value = []
    }

    async function guarded(action: () => Promise<void>): Promise<void> {
        if (busy.value) {
            return
        }

        busy.value = true
        error.value = ''

        try {
            await action()
        } catch (cause) {
            error.value = cause instanceof Error ? cause.message : String(cause)
        } finally {
            busy.value = false
        }
    }

    async function loadDevices(): Promise<void> {
        loadingDevices.value = true

        try {
            const rows = (await fetchDevices()).devices
            const wasOnline = online.value

            devices.value = rows
            // 电脑刚上线时自动切过去，否则用户要手动点一次才能下发任务。
            const current = rows.find(row => row.device_id === deviceId.value)

            if (!current?.online && rows.some(row => row.online) && !running.value) {
                const next = rows.find(row => row.online)!

                deviceId.value = next.device_id
                conversationId.value = ''
                messages.value = []
                void guarded(loadProjects)
            } else if (!wasOnline && online.value) {
                void guarded(loadProjects)
            }
        } finally {
            loadingDevices.value = false
        }
    }

    async function loadProjects(): Promise<void> {
        if (!deviceId.value) {
            projects.value = []
            models.value = []

            return
        }

        loadingProjects.value = true

        try {
            // 模型与项目都来自这台电脑，换设备必须一起刷新。
            const [projectRows, config] = await Promise.all([
                listRemoteProjects(deviceId.value),
                listRemoteModels(deviceId.value).catch(() => ({ models: [] as RemoteModelOption[] })),
            ])

            projects.value = projectRows
            models.value = config.models || []
        } finally {
            loadingProjects.value = false
        }
    }

    async function loadHistory(): Promise<void> {
        if (!deviceId.value || !conversationId.value) {
            messages.value = []

            return
        }

        const { messages: rows } = await listRemoteMessages(deviceId.value, conversationId.value)
        messages.value = remoteHistoryToMessages(rows || [])
    }

    function selectDevice(id: string): void {
        if (id === deviceId.value) {
            return
        }

        disposeStream()
        deviceId.value = id
        conversationId.value = ''
        messages.value = []
        void guarded(loadProjects)
    }

    function selectConversation(id: string): void {
        if (id === conversationId.value) {
            return
        }

        disposeStream()
        conversationId.value = id
        void guarded(loadHistory)
    }

    async function createConversation(project: RemoteProjectRef | null): Promise<void> {
        if (!deviceId.value) {
            return
        }

        const created = await createRemoteConversation(deviceId.value, '新会话', project || undefined)
        conversationId.value = created.conversation_id
        messages.value = []
        await loadProjects()
    }

    function ensureStream(): RemoteTaskStream {
        if (stream) {
            return stream
        }

        stream = new RemoteTaskStream(deviceId.value, {
            onEvent: (event) => {
                const target = messages.value[messages.value.length - 1]

                if (!target || target.status !== 'streaming') {
                    return
                }

                applyRemoteEvent(target, event, notices.value)
            },
            onState: (next, session) => {
                state.value = next
                stageDetail.value = session?.stage_detail || ''

                if (session?.cancel_requested || next === 'stopping') {
                    stageDetail.value = '已请求停止，等待电脑确认'
                }
            },
            onError: (cause) => {
                error.value = cause.message
            },
        })

        return stream
    }

    async function send(text: string, options: { forceContextCompression: boolean; modelName: string }): Promise<void> {
        await guarded(async () => {
            const client = ensureStream()
            const target = createStreamingAssistant(messages.value.length)
            messages.value = [...messages.value, target]
            await client.start({
                message: text,
                conversationId: conversationId.value,
                forceContextCompression: options.forceContextCompression,
                modelName: options.modelName,
            })
        }).then(() => {
            if (state.value === 'idle') {
                messages.value = messages.value.slice(0, -1)
            }
        })
    }

    async function stopTask(): Promise<void> {
        const client = stream

        if (!client) {
            return
        }

        await guarded(() => client.stop())
    }

    /**
     * 权限问卡作答。
     *
     * 电脑端遇到未授权路径时，已经把工具结果落盘、补完剩余调用的占位结果并结束任务
     * （AgentLoop 里 permission_blocked 后直接 break），所以不存在「拒绝后让电脑继续」的通道：
     * 拒绝只是本地记录，只有允许才需要写临时授权。两种情况都要提示用户重新下发任务。
     */
    async function handleQuestionAnswer(message: ChatMessage, questionId: string, answer: string): Promise<void> {
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

        await guarded(async () => {
            if (allow) {
                if (!request) {
                    throw new Error('该问卡没有可授权的路径信息')
                }

                await grantRemotePermission(deviceId.value, {
                    conversationId: String(request.conversation_id || conversationId.value),
                    path: String(request.path || ''),
                    scope: String(request.scope || 'file'),
                    access: String(request.access || request.operation || 'read'),
                })
            }

            // 标记已作答，卡片转为只读视图，不再重复弹锁。
            if (segment?.question) {
                segment.question.resolved = true

                if (allow) {
                    segment.question.answer = `已允许本次对话临时访问：${String(request?.path || '')}`
                } else {
                    segment.question.answer = '已拒绝本次访问权限。'
                }
            }

            showToast(allow ? '已授权，重新下发任务即可继续' : '已拒绝，重新下发任务时不会再询问', 'success')
        })
    }

    // 设备列表变化时补齐新上线的电脑，但不动用户当前选择。
    watch(devices, (rows) => {
        if (!deviceId.value && rows.length) {
            const first = rows.find(row => row.online) || rows[0]
            deviceId.value = first.device_id
            void guarded(loadProjects)
        }
    })    // 终态收尾：把流式消息定稿、收起压缩提示与提问卡。
    // 必须盯 state 而不是 stream 的游标——stream 是普通变量，watch 追踪不到它的变化。
    watch(state, (next) => {
        if (!isTerminalRemoteTaskState(next)) {
            return
        }

        const target = messages.value[messages.value.length - 1]

        if (target?.status === 'streaming') {
            finalizeStreamingMessage(target)
        }

        notices.value = []
    })

    void loadDevices()

    // 电脑的在线状态由电脑端主动上报，这里轮询才能反映掉线与重新上线。
    const devicePoller = window.setInterval(() => {
        if (!busy.value) {
            void loadDevices()
        }
    }, DEVICE_POLL_MS)

    onBeforeUnmount(() => {
        window.clearInterval(devicePoller)
        disposeStream()
    })
</script>
