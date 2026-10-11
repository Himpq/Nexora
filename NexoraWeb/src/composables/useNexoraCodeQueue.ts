import { computed, shallowRef, watch, type Ref } from 'vue'
import { NexoraCodeQueueApi, type LocalQueueState } from '@/api/nexoracodeQueue'
import {
    applySharedQueueState,
    bumpSharedQueueRevision,
    queueKey,
    queueMutations,
    queueStates,
    sharedQueueRevision,
} from '@/stream/queueState'
import { showError, showToast } from '@/stores/notify'

/**
 * 会话队列视图：以服务端版本号处理接口响应和流事件之间的竞态。
 *
 * enabled 控制是否启用;deviceId 非空时走云端网关转发到远程电脑,
 * 为空时直接打本地接口(NexoraCode 桌面端)。
 *
 * 状态存于 @/stream/queueState 的模块级单例,按「设备 + 会话」分桶:
 * 同一会话被多个组件观察时共享同一份,任一处删除/编辑后另一处立即生效。
 */
export function useNexoraCodeQueue(
    conversationId: Ref<string>,
    enabled: boolean | Ref<boolean>,
    deviceId: Ref<string> | string = '',
) {
    const enabledRef = computed(() => typeof enabled === 'boolean' ? enabled : enabled.value)
    const deviceRef = computed(() => typeof deviceId === 'string' ? deviceId : deviceId.value)
    const api = computed(() => new NexoraCodeQueueApi(deviceRef.value))
    const states = shallowRef(queueStates())
    const mutations = shallowRef(queueMutations())
    /**
     * 共享缓存是模块级普通对象,新增 key 不会触发 Vue 的依赖通知,
     * computed 会把首次未命中的 undefined 永久缓存。这里读全局响应式
     * 写入版本号强制重算:任一组件写入后所有观察方都会重新求值。
     */
    const revision = sharedQueueRevision()
    const currentKey = computed(() => queueKey(deviceRef.value, conversationId.value))
    const current = computed(() => {
        revision.value

        return states.value[currentKey.value]
    })
    const items = computed(() => current.value?.items || [])
    const paused = computed(() => current.value?.paused === true)
    const busy = computed(() => {
        revision.value

        return mutations.value[currentKey.value] === true
    })

    function apply(state: LocalQueueState): void {
        applySharedQueueState({ ...state, device_id: deviceRef.value })
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
        const key = currentKey.value

        if (!id || mutations.value[key]) {
            return false
        }

        mutations.value[key] = true
        bumpSharedQueueRevision()

        try {
            apply(await operation(id))

            return true
        } catch (error) {
            showError(error instanceof Error ? error.message : '更新消息队列失败')

            return false
        } finally {
            mutations.value[key] = false
            bumpSharedQueueRevision()
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
