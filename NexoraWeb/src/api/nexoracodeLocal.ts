import { apiFetch } from './client'

import type { ModelItem } from './config'

export type LocalPermissionMode = 'read_only' | 'confirm' | 'auto' | 'full'

export interface LocalPermissionSettings {
    mode: LocalPermissionMode
    approval_model_id: string
    models: ModelItem[]
}

export interface NexoraCodeProject {
    project_id: string
    name: string
    path: string
    subtitle: string
    tree_scanned_at: string
}

interface ProjectFolderResult {
    success?: boolean
    path?: string
    cancelled?: boolean
    message?: string
}

interface NexoraCodeDesktopApi {
    open_settings?: () => void
    select_project_folder?: () => Promise<ProjectFolderResult>
}

interface NexoraCodeWindow extends Window {
    pywebview?: {
        api?: NexoraCodeDesktopApi
    }
}

interface LocalPermissionResponse {
    success: boolean
    mode: LocalPermissionMode
    approval_model_id: string
    models: ModelItem[]
    message?: string
}

interface LocalSettingsResponse {
    success: boolean
    general?: {
        tool_auto_expand?: unknown
    }
    message?: string
}

export function openLocalSettings(): void {
    const openSettings = readDesktopApi()?.open_settings

    if (typeof openSettings !== 'function') {
        throw new Error('本地设置窗口尚未就绪')
    }

    openSettings()
}

/** 通过 NexoraCode 桌面桥打开原生目录选择器；项目目录只由用户主动选择。 */
export async function selectLocalProjectFolder(): Promise<NexoraCodeProject | null> {
    const selectFolder = readDesktopApi()?.select_project_folder

    if (typeof selectFolder !== 'function') {
        throw new Error('请在 NexoraCode 桌面端选择项目文件夹')
    }

    const result = await selectFolder()

    if (result.cancelled) {
        return null
    }

    const path = String(result.path || '').trim()

    if (!result.success || !path) {
        throw new Error(result.message || '选择项目文件夹失败')
    }

    const parts = path.split(/[\\/]/).filter(Boolean)
    const name = parts[parts.length - 1] || path

    return {
        project_id: path,
        name,
        path,
        subtitle: path,
        tree_scanned_at: '',
    }
}

/** NexoraCode 页面可能位于桌面壳 iframe，桌面桥固定挂在顶层窗口。 */
function readDesktopApi(): NexoraCodeDesktopApi | undefined {
    const contexts: Window[] = [window]

    try {
        if (window.parent !== window) {
            contexts.push(window.parent)
        }
    } catch {
        // 跨源 parent 不能读取；继续检查顶层桥。
    }

    try {
        if (window.top && window.top !== window && window.top !== window.parent) {
            contexts.push(window.top)
        }
    } catch {
        // 跨源 top 不能读取；当前窗口和 parent 仍可用。
    }

    for (const context of contexts) {
        const api = (context as NexoraCodeWindow).pywebview?.api

        if (api) {
            return api
        }
    }

    return undefined
}

export async function fetchLocalPermissionSettings(): Promise<LocalPermissionSettings> {
    const data = await apiFetch<LocalPermissionResponse>('/api/local/permissions')

    if (!data.success) {
        throw new Error(data.message || '读取工具权限失败')
    }

    return {
        mode: data.mode,
        approval_model_id: String(data.approval_model_id || ''),
        models: Array.isArray(data.models) ? data.models : [],
    }
}

/** 读取 NexoraCode 工具调用卡片自动展开偏好。 */
export async function fetchLocalToolAutoExpand(): Promise<boolean> {
    const data = await apiFetch<LocalSettingsResponse>('/api/local/settings')

    if (!data.success || typeof data.general?.tool_auto_expand !== 'boolean') {
        throw new Error(data.message || '读取工具调用自动展开设置失败')
    }

    return data.general.tool_auto_expand
}

/** 保存新会话使用的全局默认模型。 */
export async function saveLocalDefaultModel(modelId: string): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>(
        '/api/local/default-model',
        {
            method: 'POST',
            body: JSON.stringify({ model_id: modelId }),
        },
    )

    if (!data.success) {
        throw new Error(data.message || '保存默认模型失败')
    }
}

export async function saveLocalPermissionSettings(
    mode: LocalPermissionMode,
    approvalModelId: string,
    conversationId = '',
): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>('/api/local/permissions', {
        method: 'POST',
        body: JSON.stringify({
            mode,
            approval_model_id: approvalModelId,
            ...(conversationId ? { conversation_id: conversationId } : {}),
        }),
    })

    if (!data.success) {
        throw new Error(data.message || '保存工具权限失败')
    }
}

/** 单个会话的独立设置（模型 / 工具权限）。 */
export interface LocalConversationSettings {
    model_name: string
    permission_mode: LocalPermissionMode
    approval_model_id: string
}

interface LocalConversationSettingsResponse {
    success: boolean
    settings?: LocalConversationSettings
    models?: ModelItem[]
    message?: string
}

/** 读取会话自己的设置；老会话没有时后端会用全局默认惰性补齐。 */
export async function fetchLocalConversationSettings(
    conversationId: string,
): Promise<LocalConversationSettings> {
    const data = await apiFetch<LocalConversationSettingsResponse>(
        `/api/conversations/${encodeURIComponent(conversationId)}/settings`,
    )

    if (!data.success || !data.settings) {
        throw new Error(data.message || '读取会话设置失败')
    }

    return {
        model_name: String(data.settings.model_name || ''),
        permission_mode: data.settings.permission_mode,
        approval_model_id: String(data.settings.approval_model_id || ''),
    }
}

/** 保存会话自己的设置（只传要改的字段）。 */
export async function saveLocalConversationSettings(
    conversationId: string,
    patch: Partial<LocalConversationSettings>,
): Promise<LocalConversationSettings> {
    const data = await apiFetch<LocalConversationSettingsResponse>(
        `/api/conversations/${encodeURIComponent(conversationId)}/settings`,
        {
            method: 'POST',
            body: JSON.stringify(patch),
        },
    )

    if (!data.success || !data.settings) {
        throw new Error(data.message || '保存会话设置失败')
    }

    return {
        model_name: String(data.settings.model_name || ''),
        permission_mode: data.settings.permission_mode,
        approval_model_id: String(data.settings.approval_model_id || ''),
    }
}

export interface LocalPathPermissionResult {
    /** 授权成功后电脑端是否已自动续跑被权限阻断的本轮 */
    resumed: boolean
    /** 续跑流的 stream_id，前端据此接管 SSE 续播 */
    resumeStreamId: string
}

export async function grantLocalPathPermission(
    conversationId: string,
    permissionRequest: Record<string, unknown>,
    decision: 'allow' | 'deny' = 'allow',
): Promise<LocalPathPermissionResult> {
    const data = await apiFetch<{
        success: boolean
        message?: string
        resumed?: boolean
        resume_stream_id?: string
    }>('/api/agent/permission/grant', {
        method: 'POST',
        body: JSON.stringify({
            conversation_id: conversationId,
            permission_request: permissionRequest,
            decision,
        }),
    })

    if (!data.success) {
        throw new Error(data.message || '授权失败')
    }

    return {
        resumed: data.resumed === true,
        resumeStreamId: String(data.resume_stream_id || ''),
    }
}

export async function resolveLocalToolPermission(
    conversationId: string,
    request: Record<string, unknown>,
    decision: 'allow' | 'deny',
): Promise<LocalPathPermissionResult> {
    const data = await apiFetch<{
        success: boolean
        message?: string
        resumed?: boolean
        resume_stream_id?: string
    }>('/api/agent/tool-permission/resolve', {
        method: 'POST',
        body: JSON.stringify({
            conversation_id: conversationId,
            tool_permission_request: request,
            decision,
        }),
    })

    if (!data.success) {
        throw new Error(data.message || '处理工具审批失败')
    }

    return {
        resumed: data.resumed === true,
        resumeStreamId: String(data.resume_stream_id || ''),
    }
}

/** 任务生命周期事件（本地 /api/local/tasks/watch）。 */
export interface LocalTaskEvent {
    type: 'task_started' | 'task_finished'
    stream_id: string
    conversation_id: string
    status?: string
    /** 本轮的请求正文（task_started 携带），用于本地接管时补用户气泡。 */
    message?: string
    /** 权限续跑这类内部任务不落盘用户消息，接管时不要补气泡。 */
    skip_user_message?: boolean
    is_regenerate?: boolean
    /** 任务启动时该会话已有的用户消息数，用于判断请求正文是否已随历史加载。 */
    history_user_count?: number | null
    /** 建连快照补发的历史运行任务（订阅前已启动）。 */
    snapshot?: boolean
}

/**
 * 订阅本地任务生命周期事件流（SSE）。
 *
 * 云端下发的任务在本地前端没有流句柄，只能靠这条事件流发现：
 * task_started 用于在侧栏标出运行中的会话，task_finished 用于清除标记。
 * 返回一个取消订阅的函数；调用方负责在卸载时调用它。
 */
export function subscribeLocalTaskEvents(
    onEvent: (event: LocalTaskEvent) => void,
    onError?: (error: Error) => void,
): () => void {
    const controller = new AbortController()

    void (async () => {
        try {
            const res = await fetch('/api/local/tasks/watch', {
                method: 'GET',
                credentials: 'include',
                headers: { Accept: 'text/event-stream' },
                signal: controller.signal,
            })

            if (!res.ok || !res.body) {
                throw new Error(`任务事件流不可用（HTTP ${res.status}）`)
            }

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            while (true) {
                const { done, value } = await reader.read()

                if (done) {
                    break
                }

                buffer += decoder.decode(value, { stream: true })

                // SSE 帧以空行分隔；只消费完整帧，残帧留在 buffer 里等下一块。
                let boundary = buffer.indexOf('\n\n')

                while (boundary >= 0) {
                    const frame = buffer.slice(0, boundary)
                    buffer = buffer.slice(boundary + 2)
                    boundary = buffer.indexOf('\n\n')

                    const dataLine = frame
                        .split('\n')
                        .find((line) => line.startsWith('data:'))

                    if (!dataLine) {
                        continue
                    }

                    try {
                        onEvent(JSON.parse(dataLine.slice(5).trim()) as LocalTaskEvent)
                    } catch {
                        // 单帧解析失败不影响后续帧。
                    }
                }
            }
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                return
            }

            onError?.(error instanceof Error ? error : new Error(String(error)))
        }
    })()

    return () => controller.abort()
}
