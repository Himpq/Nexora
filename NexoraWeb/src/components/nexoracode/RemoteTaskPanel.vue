<!--
    RemoteTaskPanel.vue — 远程任务面板

    消息区复用 MessageItem（工具执行卡片、thinking 折叠、token 徽标、提问卡
    与云端聊天完全一致），本组件只负责：
      - 顶部状态条：显式状态机的当前状态，停止按钮挂在旁边；
      - 压缩提示条：电脑端上下文压缩的进度；
      - 输入区：发送 / 停止 / 强制压缩。
-->

<template>
    <section class="remote-task-panel">
        <header class="remote-task-head">
            <div class="remote-task-head-main">
                <span class="remote-task-title">{{ title }}</span>
                <span class="remote-task-state" :class="`is-${state}`">{{ stateLabel }}</span>
            </div>
            <div class="remote-task-head-actions">
                <span v-if="stageDetail" class="remote-task-stage" :title="stageDetail">{{ stageDetail }}</span>
                <Button
                    v-if="canStop"
                    size="compact"
                    variant="danger"
                    icon="fa-solid fa-stop"
                    @click="$emit('stop')"
                >停止</Button>
            </div>
        </header>

        <p v-if="!online" class="remote-task-banner" role="status">
            电脑已离线，无法下发任务或读取历史。已加载的内容仍可查看。
        </p>

        <div ref="scrollerRef" class="remote-task-messages">
            <p v-if="!messages.length" class="remote-task-empty">
                选择左侧会话查看历史，或在下方输入框下发新任务。
            </p>
            <MessageItem
                v-for="message in messages"
                :key="message.index"
                :message="message"
                :streaming="message.status === 'streaming'"
                :conversation-id="conversationId"
                readonly
                @question-answer="(item, questionId, answer) => $emit('answer-question', item, questionId, answer)"
                @open-knowledge="(reference) => $emit('open-knowledge', reference)"
                @open-image="(url) => $emit('open-image', url)"
            />
        </div>

        <ul v-if="notices.length" class="remote-task-notices">
            <li v-for="(notice, index) in notices" :key="index" :class="`is-${notice.status}`">
                <i class="fa-solid fa-compress" aria-hidden="true"></i>
                <span>{{ notice.content }}</span>
            </li>
        </ul>

        <div class="remote-task-composer">
            <div class="remote-task-composer-head">
                <label class="remote-task-model">
                    <span>模型</span>
                    <select v-model="modelName" :disabled="!online || running" class="remote-task-select">
                        <option value="">电脑默认模型</option>
                        <option v-for="model in models" :key="model.id" :value="model.id">
                            {{ model.name }} · {{ model.provider }}
                        </option>
                    </select>
                </label>
            </div>
            <textarea
                v-model="draft"
                class="remote-task-input"
                rows="3"
                :disabled="!online"
                :placeholder="online ? '向这台电脑上的 NexoraCode 下发任务' : '电脑离线，无法下发任务'"
                @keydown.enter.exact.prevent="submit"
            />
            <div class="remote-task-composer-actions">
                <Button
                    variant="primary"
                    icon="fa-solid fa-paper-plane"
                    :disabled="!canSend"
                    @click="submit"
                >发送到电脑</Button>
                <Button
                    :disabled="!forceCompression || !canSend"
                    :title="forceCompression ? '本次发送会先压缩上下文再执行' : '让电脑端在本次任务前先压缩上下文'"
                    @click="forceCompression = !forceCompression"
                >{{ forceCompression ? '已启用压缩' : '压缩上下文' }}</Button>
                <span class="remote-task-composer-hint">
                    Enter 发送 · 任务在电脑本地执行，云端只转发
                </span>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
    import { computed, nextTick, ref, watch } from 'vue'

    import type { ChatMessage } from '@/api/conversations'
    import type { RemoteModelOption } from '@/api/nexoracode'
    import type { RemoteTaskState } from '@/network/remoteTaskStream'
    import type { RemoteTaskNotice } from '@/stream/remoteSegments'
    import MessageItem from '@/components/MessageItem.vue'
    import { Button } from '@/ui'

    import '@/styles/remote-task-panel.css'

    const props = defineProps<{
        title: string
        state: RemoteTaskState
        stageDetail: string
        online: boolean
        busy: boolean
        conversationId: string
        messages: ChatMessage[]
        notices: RemoteTaskNotice[]
        /** 电脑上可用的模型，id 形如 provider_id/model，留空表示用电脑默认。 */
        models: RemoteModelOption[]
    }>()

    const emit = defineEmits<{
        send: [text: string, options: { forceContextCompression: boolean; modelName: string }]
        stop: []
        'answer-question': [message: ChatMessage, questionId: string, answer: string]
        'open-knowledge': [reference: unknown]
        'open-image': [url: string]
    }>()

    const draft = ref('')
    const forceCompression = ref(false)
    const modelName = ref('')
    const scrollerRef = ref<HTMLElement | null>(null)

    const stateLabel = computed(() => {
        switch (props.state) {
            case 'starting': return '正在下发'
            case 'running': return '执行中'
            case 'stopping': return '正在停止'
            case 'done': return '已完成'
            case 'failed': return '执行异常'
            case 'cancelled': return '已停止'
            case 'interrupted': return '电脑进程已重启，任务中断'
            case 'gone': return '任务不存在或已清理'
            default: return '空闲'
        }
    })

    const running = computed(() => props.state === 'starting' || props.state === 'running' || props.state === 'stopping')
    const canStop = computed(() => props.state === 'running' || props.state === 'starting')
    const canSend = computed(() => props.online && !props.busy && !running.value && !!draft.value.trim())

    function submit(): void {
        const text = draft.value.trim()

        if (!text || !canSend.value) {
            return
        }

        emit('send', text, { forceContextCompression: forceCompression.value, modelName: modelName.value })
        draft.value = ''
    }

    // 流式过程中始终贴底，用户手动上滚后不再强制拉回。
    watch(
        () => props.messages.map(message => message.content.length).join(','),
        async () => {
            const scroller = scrollerRef.value

            if (!scroller) {
                return
            }

            const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120

            if (nearBottom) {
                await nextTick()
                scroller.scrollTop = scroller.scrollHeight
            }
        }
    )
</script>
