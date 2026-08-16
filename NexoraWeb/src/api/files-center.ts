/**
 * files-center.ts — 文件中心 API
 *
 * 对应后端路由:
 *   GET    /api/files/list?q=&limit=       文件列表
 *   GET    /api/files/download?file_ref=   下载(可 inline)
 *   DELETE /api/files/remove?file_ref=     删除
 *   GET    /api/files/read?file_ref=       文本预览
 *   POST   /api/upload                     multipart 上传(异步任务)
 *   GET    /api/upload/task/<id>           轮询上传/向量化任务
 */

import { apiFetch } from './client'

export interface CloudFileItem {
    alias: string
    original_name?: string
    filename?: string
    name?: string
    size?: number
    file_size?: number
    updated_at?: number
    created_at?: number
    sandbox_path?: string
    source_ext?: string
    parser_mode?: string
    [key: string]: unknown
}

export interface FileListResult {
    files: CloudFileItem[]
    total: number
}

interface FileListResponse extends FileListResult {
    success: boolean
}

export interface UploadTaskStatus {
    task_id: string
    status: string
    stage: string
    progress: number
    message: string
    error: string
    result?: Record<string, unknown>
}

interface UploadTaskResponse {
    success: boolean
    task?: UploadTaskStatus
}

/** 拉取文件列表(limit 对齐原版 buildFileCenterListUrl 的 1000) */
export async function listFiles(query = '', limit = 1000): Promise<FileListResult> {
    const params = new URLSearchParams()

    if (query.trim()) {
        params.set('q', query.trim())
    }

    params.set('limit', String(limit))

    const data = await apiFetch<FileListResponse>(`/api/files/list?${params.toString()}`)

    return {
        files: Array.isArray(data.files) ? data.files : [],
        total: Number(data.total || 0),
    }
}

/** 删除文件 */
export async function removeFile(fileRef: string): Promise<void> {
    await apiFetch<{ success: boolean }>(`/api/files/remove?file_ref=${encodeURIComponent(fileRef)}`, {
        method: 'DELETE',
    })
}

/** 读取文本预览 */
export async function readFile(fileRef: string): Promise<{
    content: string
    truncated: boolean
    file?: CloudFileItem
}> {
    const data = await apiFetch<{
        success: boolean
        content: string
        truncated: boolean
        file?: CloudFileItem
    }>(`/api/files/read?file_ref=${encodeURIComponent(fileRef)}`)

    return {
        content: String(data.content || ''),
        truncated: !!data.truncated,
        file: data.file,
    }
}

/** 文件下载/预览 URL(对齐原版 getCloudFileInlineUrl) */
export function fileDownloadUrl(fileRef: string, inline = false): string {
    return `/api/files/download?file_ref=${encodeURIComponent(fileRef)}${inline ? '&inline=1' : ''}`
}

/** 上传文件(multipart),成功后轮询任务直到完成(对齐原版 uploadSingleFileWithProgress + pollUploadTask) */
export async function uploadFile(file: File, targetPath = '', onProgress?: (percent: number, text: string) => void): Promise<Record<string, unknown>> {
    const formData = new FormData()

    formData.append('file', file)

    if (targetPath.trim()) {
        formData.append('target_path', targetPath.trim())
    }

    // 用 XHR 获取上传进度
    const taskId = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        xhr.open('POST', '/api/upload', true)

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable && onProgress) {
                const percent = Math.round((event.loaded / event.total) * 100)

                onProgress(percent, `上传 ${file.name} (${percent}%)`)
            }
        }

        xhr.onload = () => {
            let data: { success?: boolean; task_id?: string; message?: string } | null = null

            try {
                data = JSON.parse(xhr.responseText || '{}')
            } catch {
                data = null
            }

            if (!(xhr.status >= 200 && xhr.status < 300) || !data || !data.success) {
                reject(new Error(data?.message || `上传失败(HTTP ${xhr.status})`))

                return
            }

            resolve(String(data.task_id || ''))
        }

        xhr.onerror = () => reject(new Error('网络错误'))

        xhr.send(formData)
    })

    // 轮询异步任务
    const maxRounds = 900

    for (let round = 0; round < maxRounds; round++) {
        const data = await apiFetch<UploadTaskResponse>(`/api/upload/task/${encodeURIComponent(taskId)}`)

        const task = data.task

        if (!task) {
            throw new Error('任务查询失败')
        }

        const status = String(task.status || '').toLowerCase()
        const progress = Number(task.progress || 0)

        if (status === 'completed') {
            return task.result || {}
        }

        if (status === 'failed') {
            throw new Error(task.error || task.message || '上传失败')
        }

        if (status === 'cancelled') {
            throw new Error(task.message || '任务已取消')
        }

        if (onProgress) {
            onProgress(Math.max(1, Math.min(100, progress)), `处理中 ${file.name} (${Math.max(1, Math.min(100, progress))}%)`)
        }

        await new Promise((resolve) => setTimeout(resolve, 500))
    }

    throw new Error('上传任务超时')
}

/** 文件 ref(对齐原版 getCloudFileRef:sandbox_path 优先,回退 alias) */
export function fileRef(file: CloudFileItem): string {
    return String(file.sandbox_path || file.alias || '').trim()
}

/** 文件显示名(对齐原版 getCloudFileDisplayName:alias basename 优先) */
export function fileDisplayName(file: CloudFileItem): string {
    const alias = String(file.alias || '').trim()

    if (alias) {
        return basename(alias)
    }

    const original = String(file.original_name || file.filename || file.name || '').trim()

    if (original) {
        return basename(original)
    }

    const sandboxPath = String(file.sandbox_path || '').trim()

    if (sandboxPath) {
        return basename(sandboxPath)
    }

    return '文件'
}

/** 文件扩展名(对齐原版 getCloudFileExtension) */
export function fileExtension(file: CloudFileItem): string {
    const sourceExt = String(file.source_ext || '').trim().replace(/^\./, '').toLowerCase()

    if (sourceExt) {
        return sourceExt
    }

    const candidates = [
        file.alias,
        file.original_name || file.filename || file.name,
        file.sandbox_path,
    ]

    for (const item of candidates) {
        const name = String(item || '').trim().toLowerCase()
        const match = name.match(/\.([a-z0-9]+)$/)

        if (match) {
            return match[1]
        }
    }

    return ''
}

/** 是否图片文件(对齐原版 isCloudFileImage) */
export function isImageFile(file: CloudFileItem): boolean {
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(fileExtension(file))
}

/** 图标 tone 类(对齐原版 getCloudFileToneClass) */
export function fileToneClass(file: CloudFileItem): string {
    const ext = fileExtension(file)

    if (['pdf'].includes(ext)) return 'tone-pdf'
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'tone-image'
    if (['doc', 'docx'].includes(ext)) return 'tone-doc'
    if (['xls', 'xlsx', 'csv'].includes(ext)) return 'tone-sheet'
    if (['ppt', 'pptx'].includes(ext)) return 'tone-slide'
    if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'go', 'rs', 'cs', 'php', 'rb', 'swift', 'kt', 'kts', 'scala', 'sh', 'bash', 'zsh', 'bat', 'ps1', 'c', 'h', 'hpp', 'cpp', 'cc', 'cxx'].includes(ext)) return 'tone-code'
    if (['json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'xml', 'html', 'css', 'sql'].includes(ext)) return 'tone-config'
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'tone-archive'
    if (['md', 'txt', 'log'].includes(ext)) return 'tone-text'

    return 'tone-file'
}

/** 图标 icon 类(对齐原版 getUploadPreviewIconClass 的简化映射) */
export function fileIconClass(file: CloudFileItem): string {
    const ext = fileExtension(file)

    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'fa-regular fa-image'
    if (['pdf'].includes(ext)) return 'fa-regular fa-file-pdf'
    if (['doc', 'docx'].includes(ext)) return 'fa-regular fa-file-word'
    if (['xls', 'xlsx', 'csv'].includes(ext)) return 'fa-regular fa-file-excel'
    if (['ppt', 'pptx'].includes(ext)) return 'fa-regular fa-file-powerpoint'
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'fa-regular fa-file-zipper'
    if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'go', 'rs', 'cs', 'json', 'yaml', 'yml', 'xml', 'html', 'css', 'sql', 'sh', 'bash', 'c', 'cpp', 'h'].includes(ext)) return 'fa-regular fa-file-code'
    if (['md', 'txt', 'log'].includes(ext)) return 'fa-regular fa-file-lines'

    return 'fa-regular fa-file'
}

/** 文件大小格式化(对齐原版 chat_files.js formatFileSize) */
export function formatFileSize(bytes: number): string {
    const n = Number(bytes || 0)

    if (!Number.isFinite(n) || n <= 0) {
        return '0 B'
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let val = n
    let idx = 0

    while (val >= 1024 && idx < units.length - 1) {
        val /= 1024
        idx += 1
    }

    return `${val >= 10 || idx === 0 ? Math.round(val) : val.toFixed(1)} ${units[idx]}`
}

/** 时间戳格式化(对齐原版 formatFileUpdatedAt) */
export function formatFileUpdatedAt(ts: number): string {
    const n = Number(ts || 0)

    if (!Number.isFinite(n) || n <= 0) {
        return '-'
    }

    try {
        return new Date(n * 1000).toLocaleString()
    } catch {
        return '-'
    }
}

/** 取路径 basename(对齐原版 getCloudFileBasename) */
function basename(value: string): string {
    const raw = String(value || '').trim()

    if (!raw) {
        return ''
    }

    const parts = raw.replace(/\\/g, '/').split('/').filter(Boolean)

    return String(parts[parts.length - 1] || raw).trim()
}
