/**
 * transfer.ts — 读取码(文件传输) API
 *
 * 职责:
 *   - 查询读取码对应的传输记录(公开接口,无需登录)
 *   - 提供下载链接构造(下载由浏览器直接触发文件流)
 */

export interface TransferFileEntry {
    file_name: string
    size: number
    mime_type: string
}

export interface TransferRecord {
    file_name: string
    size: number
    mime_type: string
    files: TransferFileEntry[]
    created_at: number
    expires_at: number
    max_downloads: number
    download_count: number
    remaining_downloads: number
    revoked: boolean
    transfer_type: string
    relay_mode: string
    code?: string
}

export interface TransferQueryResult {
    success: boolean
    transfer: TransferRecord
}

/** 规整用户输入的读取码:去空白/连字符并转大写 */
export function normalizeTransferCode(value: string): string {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[\s_-]+/g, '')
}

/** 按读取码查询传输记录 */
export async function queryTransfer(rawCode: string): Promise<TransferRecord> {
    const code = normalizeTransferCode(rawCode)

    if (!code) {
        throw new Error('请输入读取码')
    }

    const response = await fetch(`/api/files/transfer/${encodeURIComponent(code)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
    })

    let data: TransferQueryResult | null = null

    try {
        data = (await response.json()) as TransferQueryResult
    } catch {
        throw new Error('读取文件信息失败')
    }

    if (!response.ok || !data || !data.success || !data.transfer) {
        throw new Error(String((data as { message?: string } | null)?.message || '读取文件信息失败'))
    }

    return data.transfer
}

/** 构造单个文件下载地址(传输记录需已查询) */
export function buildDownloadUrl(code: string, fileIndex: number): string {
    return `/api/files/transfer/${encodeURIComponent(normalizeTransferCode(code))}/download?file_index=${fileIndex}`
}
