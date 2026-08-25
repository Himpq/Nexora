/**
 * liveTransfer.ts — 在线传输(分享) API
 *
 * 职责:
 *   - 对应原版 chat_files.js 的 file center 在线传输(发送端)逻辑
 *   - 创建传输 → 轮询事件(接收端连接/完成)→ 分片推送文件 → 结束/撤销
 *   - 接收端下载由 ShareView 通过 /api/files/transfer/<code>/download 完成
 */

export interface LiveTransferFileMeta {
    file_name: string
    file_size: number
    mime_type: string
}

export interface LiveTransferCreated {
    success: boolean
    transfer: {
        code: string
        [key: string]: unknown
    }
}

export interface LiveTransferEvent {
    id: number
    at: number
    type: string
    download_id?: string
    file_index?: number
    message?: string
    bytes_transferred?: number
    ip?: string
    user_agent?: string
}

export interface LiveTransferEventsResult {
    success: boolean
    events: LiveTransferEvent[]
}

/** 单分片大小(对齐原版 FILE_CENTER_LIVE_TRANSFER_CHUNK_SIZE) */
export const LIVE_TRANSFER_CHUNK_SIZE = 1024 * 1024
/** 默认最大下载次数(对齐原版 FILE_CENTER_LIVE_TRANSFER_MAX_DOWNLOADS) */
export const LIVE_TRANSFER_MAX_DOWNLOADS = 5

/** 创建在线传输,返回读取码 */
export async function createLiveTransfer(
    files: LiveTransferFileMeta[],
    expiresInMinutes = 30,
): Promise<LiveTransferCreated> {
    const response = await fetch('/api/files/live-transfer/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            files,
            expires_in_minutes: expiresInMinutes,
            max_downloads: LIVE_TRANSFER_MAX_DOWNLOADS,
        }),
    })

    const data = (await response.json()) as LiveTransferCreated

    if (!response.ok || !data.success || !data.transfer) {
        throw new Error(String((data as { message?: string }).message || '创建在线传输失败'))
    }

    return data
}

/** 推送单个分片(原始字节) */
export async function pushLiveTransferChunk(
    code: string,
    downloadId: string,
    chunkIndex: number,
    chunk: Blob,
): Promise<void> {
    const response = await fetch(`/api/files/live-transfer/${encodeURIComponent(code)}/chunk`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/octet-stream',
            'X-Live-Transfer-Download-Id': downloadId,
            'X-Live-Transfer-Chunk-Index': String(chunkIndex),
        },
        body: chunk,
        cache: 'no-store',
    })

    const data = (await response.json()) as { success: boolean; message?: string }

    if (!response.ok || !data.success) {
        throw new Error(String(data.message || '发送在线传输分片失败'))
    }
}

/** 结束单个文件的传输(通知后端大小,触发接收端落盘) */
export async function finishLiveTransferUpload(code: string, downloadId: string, fileSize: number): Promise<void> {
    const response = await fetch(`/api/files/live-transfer/${encodeURIComponent(code)}/finish`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Live-Transfer-Download-Id': downloadId,
        },
        body: JSON.stringify({ file_size: fileSize }),
        cache: 'no-store',
    })

    const data = (await response.json()) as { success: boolean; message?: string }

    if (!response.ok || !data.success) {
        throw new Error(String(data.message || '结束在线传输失败'))
    }
}

/** 维持在线传输心跳(服务端据此判定是否仍有效) */
export async function heartbeatLiveTransfer(code: string): Promise<void> {
    const response = await fetch(`/api/files/live-transfer/${encodeURIComponent(code)}/heartbeat`, {
        method: 'POST',
        cache: 'no-store',
    })

    if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { message?: string } | null

        throw new Error(String(data?.message || '在线传输已失效'))
    }
}

/** 轮询传输事件(接收端连接/完成等) */
export async function listLiveTransferEvents(code: string, since: number): Promise<LiveTransferEventsResult> {
    const response = await fetch(
        `/api/files/live-transfer/${encodeURIComponent(code)}/events?since=${encodeURIComponent(String(since))}`,
        { cache: 'no-store' },
    )

    const data = (await response.json()) as LiveTransferEventsResult

    if (!response.ok || !data.success) {
        throw new Error(String((data as { message?: string }).message || '读取在线传输事件失败'))
    }

    return data
}

/** 撤销在线传输(关闭窗口时调用) */
export async function revokeLiveTransfer(code: string): Promise<void> {
    const response = await fetch(`/api/files/live-transfer/${encodeURIComponent(code)}/revoke`, {
        method: 'POST',
        cache: 'no-store',
    })

    if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { message?: string } | null

        throw new Error(String(data?.message || '关闭在线传输失败'))
    }
}
