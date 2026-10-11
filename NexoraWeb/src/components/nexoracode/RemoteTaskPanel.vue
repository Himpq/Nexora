<!--
    RemoteTaskPanel.vue — 远程会话主区

    完全复用云端会话的那一套外壳，不再自建输入坞：
      - 消息区用原生 .messages-area + MessageItem（工具卡、thinking、token 徽标、问卡一致）
      - 输入区直接用原生 ChatInput（variant="remote"），发送/停止由远程任务状态机驱动
      - 模型不再单独选：沿用顶栏左上角那一个选择器，取 modelStore.selectedId 下发

    状态全部来自 stores/remote.ts，与侧边栏共用同一份，不会各读一份。
-->

<template>
    <section class="remote-task-panel">
        <p v-if="store.error" role="alert" class="remote-task-error">{{ store.error }}</p>

        <p v-else-if="!store.deviceId" class="remote-task-banner" role="status">
            还没有绑定电脑。在左下角用户菜单的「远程连接」里生成配对码。
        </p>

        <p v-else-if="!store.online" class="remote-task-banner" role="status">
            电脑已离线，无法下发任务或读取历史。已加载的内容仍可查看。
        </p>

        <p v-else-if="stateError" role="alert" class="remote-task-error">{{ stateError }}</p>

        <div ref="scrollerRef" class="messages-area remote-task-messages" @scroll="handleMessagesScroll">
            <div v-if="store.historyLoading && !store.messages.length" class="remote-history-loading" role="status">
                <span class="remote-history-loading-spinner" aria-hidden="true"></span>
                <span>加载中…</span>
            </div>
            <p v-else-if="!store.messages.length" class="remote-task-empty">
                在左侧 Remote 列表里选一个会话查看历史，或直接给这台电脑下发任务。
            </p>
            <template v-else>
                <div class="remote-history-load">
                    <button
                        v-if="store.hasMoreBefore"
                        type="button"
                        class="remote-history-load-btn"
                        :disabled="store.loadingBefore"
                        @click="loadPreviousHistory"
                    >
                        <span v-if="store.loadingBefore" class="remote-history-page-spinner" aria-hidden="true"></span>
                        {{ store.loadingBefore ? '加载中…' : '加载更早消息' }}
                    </button>
                    <span v-else class="remote-history-load-end">已到最早消息</span>
                </div>

                <MessageItem
                    v-for="(message, position) in store.messages"
                    :key="message.index"
                    :message="message"
                    :streaming="isLiveAssistant(message, position)"
                    nexoracode
                    :conversation-id="store.conversationId"
                    readonly
                    @question-answer="(item, questionId, answer) => store.answerQuestion(item, questionId, answer)"
                    @open-image="(url) => emit('open-image', url)"
                />
            </template>
        </div>

        <ul v-if="store.notices.length" class="remote-task-notices">
            <li v-for="(notice, index) in store.notices" :key="index" :class="`is-${notice.status}`">
                <i class="fa-solid fa-compress" aria-hidden="true"></i>
                <span>{{ notice.content }}</span>
            </li>
        </ul>

        <ChatInput
            variant="remote"
            :streaming="store.running"
            :send-disabled="store.historyLoading"
            :draft-key="store.conversationId"
            :context-messages="store.messages"
            :context-window="selectedRemoteModel?.context_window"
            :thinking-protocol="selectedRemoteModel?.thinking_protocol || 'none'"
            :remote-device-id="store.deviceId"
            :remote-conversation-id="store.conversationId"
            :permission-model-id="store.modelName"
            :queue-items="queue.items.value"
            :queue-paused="queue.paused.value"
            :queue-busy="queue.busy.value"
            :placeholder="store.online ? '向这台电脑上的 NexoraCode 下发任务' : '电脑离线，无法下发任务'"
            @send="send"
            @stop="store.stop()"
            @queue-send="handleQueueSend"
            @queue-edit="handleQueueEdit"
            @queue-remove="handleQueueRemove"
            @queue-steer="handleQueueSteer"
        />
    </section>
</template>

<script setup lang="ts">
    import { computed, nextTick, ref, toRef, watch } from 'vue'

    import ChatInput from '@/components/ChatInput.vue'
    import MessageItem from '@/components/MessageItem.vue'
    import { useNexoraCodeQueue } from '@/composables/useNexoraCodeQueue'
    import { remoteStore } from '@/stores/remote'
    import { showError } from '@/stores/notify'

    import '@/styles/remote-task-panel.css'
    import '@/styles/remote-task-banners.css'

    const emit = defineEmits<{ 'open-image': [url: string] }>()

    const store = remoteStore
    const selectedRemoteModel = computed(() => store.models.find(model => model.id === store.modelName))

    /**
     * 远程队列:与电脑端同一份数据,经云端网关白名单 RPC 转发。
     * 电脑在线且有会话时才启用,避免离线时反复报错。
     */
    const queue = useNexoraCodeQueue(
        toRef(store, 'conversationId'),
        computed(() => store.online && !!store.conversationId),
        toRef(store, 'deviceId'),
    )

    /** 入队:成功后把草稿清空交给 ChatInput 的确认回调处理。 */
    async function handleQueueSend(
        content: string,
        thinking: boolean,
        complete: (accepted: boolean) => void,
    ): Promise<void> {
        complete(await queue.enqueue(content, thinking))
    }

    function handleQueueEdit(id: string, message: string): void {
        void queue.edit(id, message)
    }

    function handleQueueRemove(id: string): void {
        void queue.remove(id)
    }

    function handleQueueSteer(id: string): void {
        void queue.steer(id)
    }

    const scrollerRef = ref<HTMLElement | null>(null)
    const prepending = ref(false)

    /**
     * 尾标驱动：只有「本会话正在跑 + 该消息是最后一条助手消息 + 未请求停止」才闪烁。
     *
     * 不再读 message.status —— 电脑端工具轮会单独落盘、队列轮次会切换气泡，
     * 占位消息的 status 常常不是 'streaming'，导致正文渲染了但小点不出现。
     * 会话级运行态是权威信号，消息位置决定它属于哪一轮。
     */
    function isLiveAssistant(message: { role: string }, position: number): boolean {
        return store.running
            && !store.stopping
            && message.role === 'assistant'
            && position === store.messages.length - 1
    }

    /** 终态异常才提示:执行中/成功由侧边栏的运行标记与消息内的状态承载,不占用主区。 */
    const stateError = computed(() => {
        switch (store.state) {
            case 'failed': return '任务在电脑上执行失败'
            case 'interrupted': return '电脑进程已重启，任务中断'
            case 'gone': return '任务不存在或已被清理'
            default: return ''
        }
    })

    function send(text: string, options: {
        enableThinking: boolean
        enableWebSearch: boolean
        enableTools: boolean
        toolsMode: string
    }): void {
        // 顶栏那个选择器(远程视图下已切为当前电脑的模型目录)的选中项。
        // 初始值就是电脑自己的 default_model,所以这里下发的永远是用户看得见的那个模型。
        void store.send(text, store.modelName, options.enableThinking)
    }

    async function loadPreviousHistory(): Promise<void> {
        const scroller = scrollerRef.value

        if (!scroller || !store.hasMoreBefore || store.loadingBefore || prepending.value) {
            return
        }

        const conversationId = store.conversationId
        const previousScrollTop = scroller.scrollTop
        const previousScrollHeight = scroller.scrollHeight
        prepending.value = true

        try {
            await store.loadPreviousHistory()
        } catch (cause) {
            showError(cause instanceof Error ? cause.message : '加载更早消息失败')
        } finally {
            await nextTick()

            if (scrollerRef.value === scroller && store.conversationId === conversationId) {
                scroller.scrollTop = previousScrollTop + (scroller.scrollHeight - previousScrollHeight)
            }

            prepending.value = false
        }
    }

    function handleMessagesScroll(): void {
        const scroller = scrollerRef.value

        if (scroller && scroller.scrollTop <= 40 && store.hasMoreBefore && !store.loadingBefore && !prepending.value) {
            void loadPreviousHistory()
        }
    }

    // 流式过程中始终贴底，用户手动上滚后不再强制拉回。
    watch(
        () => store.messages.map(message => message.content.length).join(','),
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
