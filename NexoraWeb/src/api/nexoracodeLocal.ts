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

export async function saveLocalPermissionSettings(
    mode: LocalPermissionMode,
    approvalModelId: string,
): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>('/api/local/permissions', {
        method: 'POST',
        body: JSON.stringify({
            mode,
            approval_model_id: approvalModelId,
        }),
    })

    if (!data.success) {
        throw new Error(data.message || '保存工具权限失败')
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
