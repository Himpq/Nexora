import { computed, ref, watch, type Ref } from 'vue'
import { NexoraCodeQueueApi, type LocalQueueState } from '@/api/nexoracodeQueue'
import { showError, showToast } from '@/stores/notify'

/**
 * 会话队列视图：以服务端版本号处理接口响应和流事件之间的竞态。
 *
 * enabled 控制是否启用;deviceId 非空时走云端网关转发到远程电脑,
 * 为空时直接打本地接口(NexoraCode 桌面端)。
 */
export function useNexoraCodeQueue(
    conversationId: Ref<string>,
    enabled: boolean | Ref<boolean>,
    deviceId: Ref<string> | string = '',
) {
    const enabledRef = computed(() => typeof enabled === 'boolean' ? enabled : enabled.value)
    const deviceRef = computed(() => typeof deviceId === 'string' ? deviceId : deviceId.value)
    const api = computed(() => new NexoraCodeQueueApi(deviceRef.value))
    const states = ref<Record<string, LocalQueueState>>({})
    const mutations = ref<Record<string, boolean>>({})
    const current = computed(() => states.value[conversationId.value])
    const items = computed(() => current.value?.items || [])
    const paused = computed(() => current.value?.paused === true)
    const busy = computed(() => mutations.value[conversationId.value] === true)

    function apply(state: LocalQueueState): void {
        const previous = states.value[state.conversation_id]

        if (previous && Number(previous.revision) > Number(state.revision)) {
            return
        }

        states.value[state.conversation_id] = state
    }

    async function refresh(id = conversationId.value): Promise<void> {

        if (!enabledRef.value || !id) {
            return
        }

        try {
            apply(await api.value.read(id))
        } catch (error) {
            showError(error instanceof Error ? error.message : '读取消息队列失败')
        }
    }

    async function mutate(operation: (id: string) => Promise<LocalQueueState>): Promise<boolean> {
        const id = conversationId.value

        if (!id || mutations.value[id]) {
            return false
        }

        mutations.value[id] = true

        try {
            apply(await operation(id))

            return true
        } catch (error) {
            showError(error instanceof Error ? error.message : '更新消息队列失败')

            return false
        } finally {
            mutations.value[id] = false
        }
    }

    function handleChunk(chunk: Record<string, unknown>): boolean {

        if (chunk.type === 'queue_state') {
            apply(chunk as unknown as LocalQueueState)

            return true
        }

        if (chunk.type === 'queue_guide_rollback') {
            const message = chunk.reason === 'cancelled'
                ? '已停止，引导消息已按原顺序回到队列'
                : '引导出错，消息已按原顺序回到队列'
            showToast(message, 'warning')

            return true
        }

        return false
    }

    watch(conversationId, (id) => void refresh(id), { immediate: true })

    return {
        items,
        paused,
        busy,
        refresh,
        handleChunk,
        enqueue: (message: string, thinking: boolean) => mutate((id) => api.value.enqueue(id, message, thinking)),
        edit: (itemId: string, message: string) => mutate((id) => api.value.edit(id, itemId, message)),
        remove: (itemId: string) => mutate((id) => api.value.remove(id, itemId)),
        steer: (itemId: string) => mutate((id) => api.value.steer(id, itemId)),
    }
}
