<template>
    <section
        v-if="items.length"
        class="nc-message-queue"
        aria-label="待发送消息队列"
    >
        <div class="nc-message-queue-list">
            <article
                v-for="(item, index) in items"
                :key="item.id"
                class="nc-message-queue-item"
                :class="{ 'is-editing': editingId === item.id }"
            >
                <template v-if="editingId === item.id">
                    <textarea
                        v-model="draftMessage"
                        class="nc-message-queue-editor"
                        rows="2"
                        :aria-label="`编辑第 ${index + 1} 条排队消息`"
                        @keydown.ctrl.enter.prevent="confirmEdit(item.id)"
                        @keydown.meta.enter.prevent="confirmEdit(item.id)"
                    ></textarea>
                    <div class="nc-message-queue-actions">
                        <button
                            type="button"
                            class="nc-message-queue-action is-primary"
                            :disabled="busy || !draftMessage.trim()"
                            title="确认修改"
                            aria-label="确认修改"
                            @click="confirmEdit(item.id)"
                        >
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                                <path d="m4 10 4 4 8-8"></path>
                            </svg>
                        </button>
                        <button
                            type="button"
                            class="nc-message-queue-action"
                            :disabled="busy"
                            title="取消修改"
                            aria-label="取消修改"
                            @click="cancelEdit"
                        >
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                                <path d="m5 5 10 10M15 5 5 15"></path>
                            </svg>
                        </button>
                    </div>
                </template>

                <template v-else>
                    <span class="nc-message-queue-index" aria-hidden="true">{{ index + 1 }}</span>
                    <p class="nc-message-queue-text" :title="item.message">{{ item.message }}</p>
                    <span v-if="item.enable_thinking" class="nc-message-queue-thinking">思考</span>
                    <div class="nc-message-queue-actions">
                        <button
                            type="button"
                            class="nc-message-queue-action is-steer"
                            :disabled="!streaming || paused || busy"
                            title="引导：在下一次工具调用结束后发送"
                            aria-label="引导此消息"
                            @click="emit('steer', item.id)"
                        >
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                                <path d="M3 10h12M10 5l5 5-5 5"></path>
                            </svg>
                        </button>
                        <button
                            type="button"
                            class="nc-message-queue-action"
                            :disabled="busy"
                            title="编辑"
                            aria-label="编辑排队消息"
                            @click="beginEdit(item)"
                        >
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                                <path d="m13.8 3.2 3 3M4 16l3.7-.8L16 6.9a2.1 2.1 0 0 0-3-3l-8.3 8.3L4 16Z"></path>
                            </svg>
                        </button>
                        <button
                            type="button"
                            class="nc-message-queue-action is-danger"
                            :disabled="busy"
                            title="删除"
                            aria-label="删除排队消息"
                            @click="emit('remove', item.id)"
                        >
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                                <path d="M4 6h12M8 6V4h4v2m2 0-.7 10H6.7L6 6m3 3v4m2-4v4"></path>
                            </svg>
                        </button>
                    </div>
                </template>
            </article>
        </div>
        <div class="nc-message-queue-caption" role="status">
            {{ items.length }} 条消息按顺序排队
            <span v-if="paused">· 已暂停</span>
        </div>
    </section>
</template>

<script setup lang="ts">
    import { ref, watch } from 'vue'

    import '@/styles/nexoracode-message-queue.css'

    type QueuedMessage = {
        id: string
        message: string
        enable_thinking?: boolean | null
    }

    const props = defineProps<{
        items: QueuedMessage[]
        paused: boolean
        busy: boolean
        streaming: boolean
    }>()

    const emit = defineEmits<{
        edit: [id: string, message: string]
        remove: [id: string]
        steer: [id: string]
    }>()

    const editingId = ref<string | null>(null)
    const draftMessage = ref('')
    const submittedMessage = ref<string | null>(null)

    /** 进入单条消息的行内编辑状态。 */
    function beginEdit(item: QueuedMessage): void {
        editingId.value = item.id
        draftMessage.value = item.message
        submittedMessage.value = null
    }

    /** 确认修改后交由父级持久化队列。 */
    function confirmEdit(id: string): void {
        const message = draftMessage.value.trim()

        if (props.busy || !message) {
            return
        }

        submittedMessage.value = message
        emit('edit', id, message)
    }

    /** 取消编辑并清空本地草稿。 */
    function cancelEdit(): void {
        editingId.value = null
        draftMessage.value = ''
        submittedMessage.value = null
    }

    watch(
        () => props.items,
        (items) => {
            const edited = items.find((item) => item.id === editingId.value)

            if (editingId.value && (!edited || edited.message === submittedMessage.value)) {
                cancelEdit()
            }
        },
        { deep: true },
    )
</script>
