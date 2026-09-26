<template>
    <section class="remote-projects" aria-label="电脑项目">
        <div class="remote-toolbar">
            <h1>Projects</h1>
            <Button :disabled="busy" @click="run(refreshDevices)">刷新设备</Button>
            <Button :disabled="busy" @click="run(pair)">连接新电脑</Button>
        </div>
        <p class="remote-muted">任务在电脑执行。云端只转发；电脑离线时无法读取历史。</p>
        <p v-if="pairCode" class="remote-notice">配对码：<strong>{{ pairCode }}</strong> · 五分钟内在 NexoraCode 设置 → 远程连接中输入。服务器：{{ serverUrl }}</p>
        <p v-if="error" role="alert" class="remote-error">{{ error }}</p>
        <p v-if="devices.length === 0">尚未绑定电脑，点击“连接新电脑”开始。</p>
        <div class="remote-devices">
            <div v-for="device in devices" :key="device.device_id" class="remote-device">
                <Button :disabled="busy || !device.online" :aria-pressed="selectedDevice === device.device_id" @click="run(() => selectDevice(device.device_id))">
                    {{ device.name }} · {{ device.online ? '在线' : '离线' }}
                </Button>
                <Button :disabled="busy" @click="run(() => disconnectDevice(device.device_id))">解除绑定</Button>
            </div>
        </div>
        <template v-if="selectedDevice">
            <p v-if="!online" class="remote-notice">电脑已离线。以下为本次打开时已加载的内容，运行状态尚未确认。</p>
            <div class="remote-layout">
                <aside class="remote-conversations">
                    <h2>电脑项目与会话</h2>
                    <Button :disabled="busy || !online || running" @click="run(() => newConversation())">新会话</Button>
                    <div v-for="project in projects" :key="project.path" class="remote-project">
                        <strong>{{ project.name || project.path }}</strong>
                        <span class="remote-muted">{{ project.path }}</span>
                        <Button :disabled="busy || !online || running" @click="run(() => newConversation(project))">在项目中新建会话</Button>
                    </div>
                    <Button v-for="conversation in conversations" :key="conversation.conversation_id" :disabled="busy || !online"
                        :aria-pressed="conversationId === conversation.conversation_id" @click="run(() => selectConversation(conversation.conversation_id))">
                        {{ conversation.title }}
                    </Button>
                </aside>
                <div class="remote-task">
                    <p>执行目标：{{ selectedName }} · {{ statusLabel }}</p>
                    <div class="remote-messages">
                        <article v-for="(message, index) in history" :key="index">
                            <strong>{{ message.role === 'user' ? '你' : 'NexoraCode' }}</strong>
                            <MarkdownView :content="message.content" />
                        </article>
                        <pre v-if="liveText" class="remote-output">{{ liveText }}</pre>
                        <details v-for="event in toolEvents" :key="event._stream_seq">
                            <summary>{{ event.name || event.type }}</summary>
                            <pre>{{ event.result ?? event.content ?? event.message }}</pre>
                        </details>
                    </div>
                    <div v-if="permission" class="remote-notice">
                        <pre>{{ permission.question_content }}</pre>
                        <Button :disabled="busy || !online || running" @click="run(() => answerPermission(true))">允许本次对话</Button>
                        <Button :disabled="busy || !online || running" @click="run(() => answerPermission(false))">拒绝</Button>
                    </div>
                    <textarea v-model="draft" rows="3" placeholder="向电脑上的 NexoraCode 发任务" :disabled="!online" />
                    <div class="remote-toolbar">
                        <Button :disabled="busy || !online || running || !draft.trim()" @click="run(send)">发送到电脑</Button>
                        <Button :disabled="busy || !online || !running" @click="run(cancel)">停止任务</Button>
                        <Button :disabled="busy || !online || running || !conversationId" @click="forceCompression = !forceCompression">{{ forceCompression ? '下次发送时压缩上下文' : '压缩上下文' }}</Button>
                    </div>
                </div>
            </div>
        </template>
    </section>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, ref, watch } from 'vue'
    import { Button } from '@/ui'
    import MarkdownView from '@/components/MarkdownView.vue'
    import { createPairCode, fetchDevices, remoteCall, revokeDevice, type LocalConversation, type RemoteDevice, type RemoteEvent, type RemoteSession } from '@/api/nexoracode'
    import '@/styles/remote-projects.css'

    const props = defineProps<{ open: boolean }>()
    const devices = ref<RemoteDevice[]>([])
    const selectedDevice = ref('')
    const conversations = ref<LocalConversation[]>([])
    const conversationId = ref('')
    const history = ref<{ role: string; content: string }[]>([])
    const session = ref<RemoteSession | null>(null)
    const events = ref<RemoteEvent[]>([])
    const draft = ref('')
    const error = ref('')
    const busy = ref(false)
    const pairCode = ref('')
    const forceCompression = ref(false)
    const serverUrl = window.location.origin
    let generation = 0
    let pollBusy = false
    let cursor = 0
    let pendingRequest: { request_id: string; conversation_id: string; message: string; force_context_compression: boolean } | null = null
    const online = computed(() => devices.value.find(d => d.device_id === selectedDevice.value)?.online === true)
    const selectedName = computed(() => devices.value.find(d => d.device_id === selectedDevice.value)?.name || '')
    const running = computed(() => session.value?.status === 'running' || session.value?.status === 'cancelling')
    const statusLabel = computed(() => {
        if (!session.value) return '未运行'
        if (session.value.error === 'cancelled') return '已停止'
        if (session.value.status === 'running') return '执行中'
        if (session.value.status === 'cancelling') return '正在停止'
        if (session.value.status === 'interrupted') return '电脑进程已中断'
        return session.value.error ? '执行异常' : '已完成'
    })
    const projects = computed(() => Array.from(new Map(conversations.value.flatMap(c => {
        const project = c.metadata?.nexoracode_project
        return project ? [[project.path, project] as const] : []
    })).values()))
    const liveText = computed(() => events.value.filter(e => e.type === 'content').map(e => e.content || '').join(''))
    const toolEvents = computed(() => events.value.filter(e => ['function_call', 'function_result', 'context_compression_status', 'error'].includes(e.type)))
    const permission = computed(() => [...events.value].reverse().find(e => e.type === 'question')?.question || null)

    async function run(action: () => Promise<unknown>) {
        if (busy.value) return
        busy.value = true
        error.value = ''
        try { await action() } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
        finally { busy.value = false }
    }

    async function refreshDevices() { devices.value = (await fetchDevices()).devices }
    async function pair() { pairCode.value = (await createPairCode()).code }
    async function disconnectDevice(id: string) {
        await revokeDevice(id)
        if (selectedDevice.value === id) { generation++; selectedDevice.value = ''; history.value = []; events.value = []; session.value = null }
        await refreshDevices()
    }

    async function selectDevice(id: string) {
        generation++
        selectedDevice.value = id
        conversationId.value = ''
        history.value = []
        events.value = []
        session.value = null
        pendingRequest = null
        conversations.value = (await remoteCall<{ conversations: LocalConversation[] }>(id, '/api/conversations')).conversations
    }

    async function selectConversation(id: string) {
        generation++
        conversationId.value = id
        events.value = []
        cursor = 0
        pendingRequest = null
        const data = await remoteCall<{ messages: { role: string; content: unknown }[] }>(selectedDevice.value, `/api/conversations/${id}/messages`)
        const tasks = (await remoteCall<{ sessions: RemoteSession[] }>(selectedDevice.value, '/api/local/tasks')).sessions
        session.value = tasks.find(s => s.conversation_id === id && s.history_user_count !== undefined) || null
        let userCount = 0
        history.value = data.messages.filter(m => {
            if (m.role === 'user') userCount++
            return !session.value || userCount <= session.value.history_user_count! || (userCount === session.value.history_user_count! + 1 && m.role === 'user')
        }).map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }))
    }

    async function newConversation(project?: NonNullable<LocalConversation['metadata']>['nexoracode_project']) {
        const created = await remoteCall<{ conversation_id: string }>(selectedDevice.value, '/api/conversations', 'POST', { metadata: project ? { nexoracode_project: project } : {} })
        conversations.value = (await remoteCall<{ conversations: LocalConversation[] }>(selectedDevice.value, '/api/conversations')).conversations
        await selectConversation(created.conversation_id)
    }

    async function send() {
        if (!conversationId.value) await newConversation()
        // 超时后复用相同请求 ID，防止用户重试触发第二次工具执行。
        if (!pendingRequest) pendingRequest = { request_id: crypto.randomUUID(), conversation_id: conversationId.value, message: draft.value.trim(), force_context_compression: forceCompression.value }
        const result = await remoteCall<{ stream_id: string }>(selectedDevice.value, '/api/local/tasks', 'POST', pendingRequest)
        if (liveText.value) history.value.push({ role: 'assistant', content: liveText.value })
        history.value.push({ role: 'user', content: pendingRequest.message })
        pendingRequest = null
        draft.value = ''
        forceCompression.value = false
        events.value = []
        cursor = 0
        session.value = { stream_id: result.stream_id, conversation_id: conversationId.value, status: 'running', last_seq: 0 }
    }

    async function cancel() {
        if (session.value) await remoteCall(selectedDevice.value, `/api/local/tasks/${session.value.stream_id}/cancel`, 'POST', {})
    }

    async function answerPermission(allow: boolean) {
        if (allow && permission.value?.permission_request) await remoteCall(selectedDevice.value, '/api/agent/permission/grant', 'POST', {
            conversation_id: conversationId.value, permission_request: permission.value.permission_request,
        })
        events.value = events.value.filter(e => e.type !== 'question')
        draft.value = allow ? '已允许本次对话访问该路径，请继续未完成的任务。' : '拒绝该路径访问，请在已有授权范围内继续。'
        await send()
    }

    async function poll() {
        if (!props.open || busy.value || pollBusy) return
        pollBusy = true
        const epoch = generation
        const deviceId = selectedDevice.value
        const sid = session.value?.stream_id
        try {
            await refreshDevices()
            if (!deviceId || !online.value || !sid || (!running.value && cursor >= (session.value?.last_seq || 0))) return
            const result = await remoteCall<{ events: RemoteEvent[]; session: RemoteSession }>(deviceId, `/api/local/tasks/${sid}/events`, 'GET', undefined, { after: cursor })
            if (epoch !== generation || sid !== session.value?.stream_id) return
            events.value.push(...result.events)
            if (result.events.length) cursor = result.events[result.events.length - 1]!._stream_seq
            session.value = result.session
            if (result.session.error) error.value = result.session.error
        } catch (cause) {
            if (epoch === generation) error.value = cause instanceof Error ? cause.message : String(cause)
        } finally { pollBusy = false }
    }

    watch(() => props.open, open => { if (open) void run(refreshDevices) }, { immediate: true })
    const timer = window.setInterval(() => void poll(), 1500)
    onBeforeUnmount(() => { generation++; window.clearInterval(timer) })
</script>
