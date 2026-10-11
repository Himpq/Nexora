/**
 * queueState.ts — NexoraCode 会话队列的全局共享状态
 *
 * 为什么必须全局共享:
 *   同一条会话可能被多个组件同时观察(本地 ChatView 的输入坞、云端
 *   RemoteTaskPanel 的输入坞)。若每个 useNexoraCodeQueue 调用点各持一份
 *   ref,面板里的删除只更新自己那份,ChatView 那份直到下一条流事件才同步,
 *   表现为「删了队列消息界面不刷新」。
 *
 * 缓存键是「设备 + 会话」:同一 conversation_id 在本地与不同电脑上互不影响。
 *
 * 本模块刻意不依赖任何带路径别名的模块,便于单测直接 import。
 */

import { ref, type Ref } from 'vue'

/** 队列项(与 api/nexoracodeQueue.ts 的 LocalQueueItem 结构一致) */
export interface SharedQueueItem {
    id: string
    message: string
    enable_thinking?: boolean | null
    created_at?: number
}

/** 队列状态(与 api/nexoracodeQueue.ts 的 LocalQueueState 结构一致) */
export interface SharedQueueState {
    conversation_id: string
    /** 状态归属设备:本地为空串,远程为电脑设备 id(共享缓存按它分桶) */
    device_id?: string
    items: SharedQueueItem[]
    paused: boolean
    busy: boolean
    active_item_id?: string
    pending_guidance?: number
    revision?: number
}

/** 队列状态缓存键:同一会话在不同设备上互不影响 */
export function queueKey(deviceId: string, conversationId: string): string {
    return `${deviceId || 'local'}::${conversationId}`
}

/** 全局共享状态(模块级单例,跨组件同源) */
const sharedStates: Record<string, SharedQueueState> = {}
/** 全局共享的进行中操作标记(按会话,防止重复提交) */
const sharedMutations: Record<string, boolean> = {}
/**
 * 全局写入版本号(响应式)。
 *
 * sharedStates / sharedMutations 是普通对象,新增 key 不会触发 Vue 的依赖
 * 通知,观察方的 computed 会把首次未命中的 undefined 永久缓存。
 * 所有写入都必须递增它,观察方读取它来强制重算——这样任一个组件写入后,
 * 其他组件持有的 computed 也会立即重新求值。
 */
const sharedRevision: Ref<number> = ref(0)

/** 读取全局写入版本号(响应式,可直接在 computed 中读取) */
export function sharedQueueRevision(): Ref<number> {
    return sharedRevision
}

/** 递增全局写入版本号 */
export function bumpSharedQueueRevision(): void {
    sharedRevision.value += 1
}

export function queueStates(): Record<string, SharedQueueState> {
    return sharedStates
}

export function queueMutations(): Record<string, boolean> {
    return sharedMutations
}

/**
 * 把服务端状态写入共享缓存。
 *
 * revision 守卫:接口响应与流事件可能乱序到达,旧版本号不得覆盖新版本号。
 */
export function applySharedQueueState(state: SharedQueueState): void {
    if (!state || !state.conversation_id) {
        return
    }

    const key = queueKey(String(state.device_id || ''), state.conversation_id)
    const previous = sharedStates[key]

    if (previous && Number(previous.revision) > Number(state.revision)) {
        return
    }

    sharedStates[key] = state
    bumpSharedQueueRevision()
}

/** 读取共享缓存中的队列状态;未命中返回 undefined */
export function readSharedQueueState(deviceId: string, conversationId: string): SharedQueueState | undefined {
    return sharedStates[queueKey(deviceId, conversationId)]
}

