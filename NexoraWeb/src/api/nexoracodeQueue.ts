import { apiFetch } from './client'
import { remoteCall } from './nexoracode'

export interface LocalQueueItem {
    id: string
    message: string
    enable_thinking?: boolean | null
    created_at?: number
}

export interface LocalQueueState {
    conversation_id: string
    items: LocalQueueItem[]
    paused: boolean
    busy: boolean
    active_item_id?: string
    pending_guidance?: number
    revision?: number
}

/**
 * 队列统一由电脑端保存，组件仅提交操作并展示服务端状态。
 *
 * 两种模式:
 *   - 本地(deviceId 为空):直接打电脑端本地接口 /api/chat/queue
 *   - 远程(deviceId 非空):经云端网关白名单 RPC 转发到目标电脑
 *
 * 两者返回同一份 LocalQueueState,调用方无需区分。
 */
export class NexoraCodeQueueApi {
    private readonly deviceId: string

    constructor(deviceId = '') {
        this.deviceId = deviceId
    }

    private get isRemote(): boolean {
        return this.deviceId !== ''
    }

    /** 本地路径(含 query);远程模式下 query 单独传给网关。 */
    private path(conversationId: string, suffix = ''): string {
        return `/api/chat/queue${suffix}?conversation_id=${encodeURIComponent(conversationId)}`
    }

    private call(
        conversationId: string,
        suffix: string,
        method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
        body?: unknown,
    ): Promise<LocalQueueState> {
        const query = { conversation_id: conversationId }

        if (this.isRemote) {
            return remoteCall<LocalQueueState>(
                this.deviceId,
                `/api/chat/queue${suffix}`,
                method,
                body,
                query,
            )
        }

        const options: RequestInit = { method }

        if (body !== undefined) {
            options.body = JSON.stringify(body)
        }

        return apiFetch<LocalQueueState>(this.path(conversationId, suffix), options)
    }

    read(conversationId: string): Promise<LocalQueueState> {
        return this.call(conversationId, '', 'GET')
    }

    enqueue(conversationId: string, message: string, enableThinking: boolean): Promise<LocalQueueState> {
        return this.call(conversationId, '', 'POST', { message, enable_thinking: enableThinking })
    }

    edit(conversationId: string, id: string, message: string): Promise<LocalQueueState> {
        return this.call(conversationId, `/${encodeURIComponent(id)}`, 'PATCH', { message })
    }

    remove(conversationId: string, id: string): Promise<LocalQueueState> {
        return this.call(conversationId, `/${encodeURIComponent(id)}`, 'DELETE')
    }

    steer(conversationId: string, id: string): Promise<LocalQueueState> {
        return this.call(conversationId, `/${encodeURIComponent(id)}/steer`, 'POST')
    }
}
