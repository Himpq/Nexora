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
                :messages="messages"
                :notices="notices"
                :permission="permission"
                @send="send"
                @stop="stopTask"
                @answer-permission="answerPermission"
            />
        </div>

        <p v-if="error" role="alert" class="remote-projects-error">{{ error }}</p>
    </section>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, ref, watch } from 'vue'

    import type { ChatMessage } from '@/api/conversations'
    import {
        cancelRemoteTask,
        createRemoteConversation,
        fetchDevices,
        grantRemotePermission,
        listRemoteMessages,
        listRemoteProjects,
        type RemoteDevice,
        type RemoteProject,
        type RemoteProjectRef,
        type RemoteQuestion,
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

    defineProps<{ open: boolean }>()

    const devices = ref<RemoteDevice[]>([])
    const deviceId = ref('')
    const projects = ref<RemoteProject[]>([])
    const conversationId = ref('')
    const messages = ref<ChatMessage[]>([])
    const notices = ref<RemoteTaskNotice[]>([])
    const permission = ref<RemoteQuestion | null>(null)
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
        permission.value = null
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

            return
        }

        loadingProjects.value = true

        try {
            projects.value = await listRemoteProjects(deviceId.value)
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
                if (event.type === 'question') {
                    permission.value = event.question || null
                }

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

    async function send(text: string, options: { forceContextCompression: boolean }): Promise<void> {
        await guarded(async () => {
            const client = ensureStream()
            const target = createStreamingAssistant(messages.value.length)
            messages.value = [...messages.value, target]
            await client.start({
                message: text,
                conversationId: conversationId.value,
                forceContextCompression: options.forceContextCompression,
            })
        }).then(() => {
            if (state.value === 'idle') {
                messages.value = messages.value.slice(0, -1)
            }
        })
    }

    async function stopTask(): Promise<void> {
        await guarded(async () => {
            await cancelRemoteTask(deviceId.value, stream?.getStreamId() || '')
        })
    }

    async function answerPermission(allow: boolean): Promise<void> {
        const request = permission.value?.permission_request

        if (!request || typeof request !== 'object') {
            return
        }

        await guarded(async () => {
            if (allow) {
                await grantRemotePermission(deviceId.value, {
                    conversationId: String((request as Record<string, unknown>).conversation_id || conversationId.value),
                    path: String((request as Record<string, unknown>).path || ''),
                    scope: String((request as Record<string, unknown>).scope || 'file'),
                    access: String((request as Record<string, unknown>).access || 'read'),
                })
                showToast('已允许本次对话访问该路径', 'success')
            } else {
                // 拒绝只需回一条占位事件让电脑侧结束等待，无需再授权。
                showToast('已拒绝本次授权', 'info')
            }

            permission.value = null
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
        permission.value = null
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
