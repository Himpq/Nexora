/**
 * 远程电脑 API 层（NexoraCode 桌面端经云端网关转发）
 *
 * 电脑主动向云端发起 WebSocket，云端只做白名单 RPC 转发，因此这里的每个函数
 * 最终都是一次 `POST /api/nexoracode/devices/<id>/rpc`：
 *   - 电脑侧只接受白名单内的路径，其余一律 403（见 NexoraCode/core/remote_connection.py）；
 *   - 网关单次 rpc 超时 30 秒，所以执行过程不能用长连接，只能用游标轮询；
 *   - 电脑离线时网关返回 409，调用方需据此提示「电脑离线」而非报错。
 *
 * 本文件只负责请求与类型，不含轮询与状态机（见 network/remoteTaskStream.ts）。
 */

import { apiFetch } from './client'

// ---------- 设备与配对 ----------

export interface RemoteDevice {
    device_id: string
    name: string
    online: boolean
}

export function fetchDevices() {
    return apiFetch<{ devices: RemoteDevice[] }>('/api/nexoracode/devices')
}

export function createPairCode() {
    return apiFetch<{ code: string; expires_in: number }>('/api/nexoracode/pair', { method: 'POST', body: '{}' })
}

export function revokeDevice(deviceId: string) {
    return apiFetch(`/api/nexoracode/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' })
}

/** 网关转发原语：path / method / body / query 会被原样交给电脑侧处理。 */
export function remoteCall<T>(deviceId: string, path: string, method = 'GET', body?: unknown, query?: unknown) {
    return apiFetch<T>(`/api/nexoracode/devices/${encodeURIComponent(deviceId)}/rpc`, {
        method: 'POST', body: JSON.stringify({ path, method, body, query }),
    })
}

// ---------- 电脑上的项目与会话 ----------

export interface RemoteProjectRef {
    project_id?: string
    name?: string
    path: string
}

export interface RemoteConversation {
    conversation_id: string
    title: string
    updated_at?: number
    metadata?: { nexoracode_project?: RemoteProjectRef }
}

/**
 * 电脑上的会话分组。
 *
 * 电脑侧没有独立的「项目」接口，项目来自会话 metadata.nexoracode_project；
 * 没有该元数据的会话 project 为 null，按原版侧栏的做法平铺在根级而不是被丢掉。
 */
export interface RemoteConversationGroup {
    project: RemoteProjectRef | null
    conversations: RemoteConversation[]
}

export interface RemoteChatMessage {
    id?: string
    role: 'user' | 'assistant' | 'tool' | 'system' | string
    content: unknown
    tool_calls?: unknown[]
    timestamp?: string
    metadata?: Record<string, unknown>
}

/** 电脑上可用的模型，id 形如 provider_id/model，与电脑侧解析模型的方式一致。 */
export interface RemoteModelOption {
    id: string
    name: string
    provider: string
    context_window: number
}

/**
 * 电脑的模型目录。
 *
 * default_model 是电脑自己认的默认（来自 providers.json 的 default_id）。
 * 必须显式下发它：电脑桌面把用户选择存在浏览器 localStorage，云端看不到，
 * 若下发空串让它回退内部默认，实际用的可能和桌面上显示的不是同一个模型。
 */
export function listRemoteModels(deviceId: string) {
    return remoteCall<{ success: boolean; default_model: string; models: RemoteModelOption[] }>(deviceId, '/api/config')
}

export interface RemoteTurn {
    message_index: number
    id: string
    content: string
    timestamp: string
}

export function listRemoteConversations(deviceId: string) {
    return remoteCall<{ success: boolean; conversations: RemoteConversation[] }>(
        deviceId, '/api/conversations'
    )
}

/**
 * 按项目聚合电脑上的会话。
 *
 * 分组内与分组之间都按 updated_at 倒序，无项目分组的会话排在最前（根级平铺）。
 */
export async function listRemoteConversationGroups(deviceId: string): Promise<RemoteConversationGroup[]> {
    const { conversations } = await listRemoteConversations(deviceId)
    const byProject = new Map<string, RemoteConversationGroup>()
    const ungrouped: RemoteConversation[] = []

    for (const conversation of conversations || []) {
        const project = conversation.metadata?.nexoracode_project

        if (!project?.path) {
            ungrouped.push(conversation)
            continue
        }

        let group = byProject.get(project.path)

        if (!group) {
            group = { project, conversations: [] }
            byProject.set(project.path, group)
        }

        group.conversations.push(conversation)
    }

    const sortByRecency = (items: RemoteConversation[]) => [...items]
        .sort((a, b) => (Number(b.updated_at) || 0) - (Number(a.updated_at) || 0))

    const groups = Array.from(byProject.values())

    groups.forEach(group => {
        group.conversations = sortByRecency(group.conversations)
    })

    groups.sort((a, b) => recencyOf(b.conversations) - recencyOf(a.conversations))

    if (!ungrouped.length) {
        return groups
    }

    return [{ project: null, conversations: sortByRecency(ungrouped) }, ...groups]
}

/** 分组的代表时间：取组内最近一次会话更新时间。 */
function recencyOf(conversations: RemoteConversation[]): number {
    return conversations.reduce((max, item) => Math.max(max, Number(item.updated_at) || 0), 0)
}

export function getRemoteConversation(deviceId: string, conversationId: string) {
    return remoteCall<{ success: boolean; conversation: RemoteConversation & { messages: RemoteChatMessage[] } }>(
        deviceId, `/api/conversations/${conversationId}`
    )
}

export function listRemoteMessages(deviceId: string, conversationId: string) {
    return remoteCall<{ success: boolean; messages: RemoteChatMessage[]; total: number }>(
        deviceId, `/api/conversations/${conversationId}/messages`
    )
}

export function listRemoteTurns(deviceId: string, conversationId: string) {
    return remoteCall<{ success: boolean; turns: RemoteTurn[] }>(
        deviceId, `/api/conversations/${conversationId}/turns`
    )
}

export function createRemoteConversation(
    deviceId: string,
    title: string,
    project?: RemoteProjectRef
) {
    return remoteCall<{ success: boolean; conversation_id: string; title: string }>(
        deviceId,
        '/api/conversations',
        'POST',
        { title, metadata: project ? { nexoracode_project: project } : {} }
    )
}

// ---------- 远程任务 ----------

/**
 * 电脑侧 session 状态原样透出，字段与 StreamRuntime.get_session_meta 一致。
 * 只有标识、状态与游标是稳定的；其余字段在 journal 恢复的历史任务上可能缺失
 * （旧版本落盘的元数据没有新增字段），因此一律可选。
 */
export interface RemoteTaskSession {
    stream_id: string
    conversation_id: string
    status: string
    last_seq: number
    created_at?: number
    updated_at?: number
    stage?: string
    stage_detail?: string
    message?: string
    error?: string
    cancel_requested?: boolean
    cancel_reason?: string
    is_regenerate?: boolean
    history_user_count?: number | null
    assistant_index?: number | null
    regenerate_index?: number | null
    head_seq?: number
    last_chunk_type?: string
    idle_seconds?: number
    stage_idle_seconds?: number
    stage_updated_at?: number
}

export interface RemoteTokenUsage {
    input_tokens: number
    output_tokens: number
    total_tokens: number
    raw_input_tokens: number
    cached_input_tokens: number
}

/** 提问载荷：电脑端原样构造后转发，字段与 MessageItem 的 QuestionPayload 对齐。 */
export interface RemoteQuestion {
    question_title?: string
    question_content: string
    choices?: string[]
    allow_other?: boolean
    track_answer?: boolean
    question_id?: string
    question_card_id?: string
    resolved?: boolean
    answer?: string
    permission_request?: { conversation_id?: string; path?: string; scope?: string; access?: string; reason?: string }
    [key: string]: unknown
}

/** 任务事件：与电脑侧 AgentLoop 事件同构，额外带 _stream_seq 游标。 */
export interface RemoteTaskEvent {
    _stream_seq: number
    type: string
    content?: string
    conversation_id?: string
    model_name?: string
    provider?: string
    name?: string
    call_id?: string
    arguments?: string
    result?: unknown
    success?: boolean
    message?: string
    question?: RemoteQuestion
    error?: boolean
    status?: string
    forced?: boolean
    raw_input_tokens?: number
    context_window?: number
    history_cut_index?: number
    summary_chars?: number
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    cached_input_tokens?: number
}

export interface StartRemoteTaskParams {
    /** 幂等键：同一个 request_id 重试不会重复执行，必须由调用方稳定持有。 */
    requestId: string
    conversationId?: string
    message: string
    /** 电脑上可用的模型 id(provider_id/model)，留空表示由电脑自己决定。 */
    modelName?: string
    isRegenerate?: boolean
    assistantIndex?: number
    regenerateIndex?: number
}

export function startRemoteTask(deviceId: string, params: StartRemoteTaskParams) {
    return remoteCall<{ success: boolean; stream_id: string; conversation_id: string }>(
        deviceId,
        '/api/local/tasks',
        'POST',
        {
            request_id: params.requestId,
            conversation_id: params.conversationId || '',
            message: params.message,
            model_name: params.modelName || '',
            is_regenerate: params.isRegenerate === true,
            assistant_index: params.assistantIndex,
            regenerate_index: params.regenerateIndex,
        }
    )
}

export function listRemoteTasks(deviceId: string) {
    return remoteCall<{ sessions: RemoteTaskSession[] }>(deviceId, '/api/local/tasks')
}

/**
 * 游标读事件。after 为已消费到的 _stream_seq，重复读取同一游标是幂等的，
 * 因此断线后可以用同一个游标安全重放。
 */
export function readRemoteTaskEvents(deviceId: string, streamId: string, after: number) {
    return remoteCall<{ events: RemoteTaskEvent[]; session: RemoteTaskSession | null }>(
        deviceId,
        `/api/local/tasks/${streamId}/events`,
        'GET',
        undefined,
        { after: Math.max(0, Math.floor(after) || 0) }
    )
}

export function cancelRemoteTask(deviceId: string, streamId: string) {
    return remoteCall<{ success: boolean; cancel_requested: boolean }>(
        deviceId, `/api/local/tasks/${streamId}/cancel`, 'POST'
    )
}

export function grantRemotePermission(
    deviceId: string,
    payload: {
        conversationId: string
        path: string
        scope?: string
        access?: string
        reason?: string
    }
) {
    return remoteCall<{ success: boolean; message: string }>(
        deviceId,
        '/api/agent/permission/grant',
        'POST',
        {
            conversation_id: payload.conversationId,
            path: payload.path,
            scope: payload.scope || 'file',
            access: payload.access || 'read',
            reason: payload.reason || '',
        }
    )
}
