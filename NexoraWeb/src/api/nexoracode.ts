import { apiFetch } from './client'

export interface RemoteDevice { device_id: string; name: string; online: boolean }
export interface LocalConversation {
    conversation_id: string
    title: string
    metadata?: { nexoracode_project?: { project_id?: string; name?: string; path: string } }
}
export interface RemoteSession { stream_id: string; conversation_id: string; status: string; error?: string; last_seq: number; history_user_count?: number }
export interface RemoteEvent {
    type: string
    _stream_seq: number
    content?: string
    name?: string
    result?: unknown
    message?: string
    question?: { question_content: string; permission_request?: Record<string, unknown> }
}

export function fetchDevices() {
    return apiFetch<{ devices: RemoteDevice[] }>('/api/nexoracode/devices')
}

export function createPairCode() {
    return apiFetch<{ code: string; expires_in: number }>('/api/nexoracode/pair', { method: 'POST', body: '{}' })
}

export function remoteCall<T>(deviceId: string, path: string, method = 'GET', body?: unknown, query?: unknown) {
    return apiFetch<T>(`/api/nexoracode/devices/${encodeURIComponent(deviceId)}/rpc`, {
        method: 'POST', body: JSON.stringify({ path, method, body, query }),
    })
}

export function revokeDevice(deviceId: string) {
    return apiFetch(`/api/nexoracode/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' })
}
