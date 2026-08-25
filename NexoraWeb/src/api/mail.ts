/**
 * mail.ts — 邮件 API
 *
 * 对应后端路由(ChatDBServer/server.py,代理 NexoraMail 服务):
 *   GET    /api/mail/me/status              绑定/启用状态(含发件地址)
 *   GET    /api/mail/me/inbox               收件箱列表(q/offset/limit)
 *   GET    /api/mail/me/sent                发件箱列表(同上)
 *   GET    /api/mail/me/inbox/<id>          收件详情(content_text/content_html)
 *   GET    /api/mail/me/sent/<id>           发件详情
 *   PATCH  /api/mail/me/inbox/<id>/read     标记已读/未读
 *   DELETE /api/mail/me/inbox/<id>          删除收件
 *   DELETE /api/mail/me/sent/<id>           删除发件
 *   POST   /api/mail/me/send                发送邮件(recipient/to + subject + content)
 */

import { apiFetch } from './client'

/** 文件夹:仅收件箱 / 发件箱(后端无 trash/草稿) */
export type MailFolder = 'inbox' | 'sent'

/**
 * 解码邮件字段中的字面转义序列(\uXXXX / \UXXXXXXXX / \xXX)。
 *
 * NexoraMail 存储的 subject/正文可能携带未被还原的 unicode 转义(中文显示为
 * \u306e\u535a 即此因),原版 chat_mails.js decodeUnicodeEscapes 同款逻辑。
 *
 * 额外处理:preview 等字段是服务端按字符数截断的,可能把转义序列拦腰截断
 * (如 "...\u306e\u33"),解码后残留无法解析的碎片,需将末尾残缺序列剥离。
 */
export function decodeUnicodeEscapes(text: unknown): string {
    const src = String(text || '')

    if (!src.includes('\\u') && !src.includes('\\U') && !src.includes('\\x')) {
        return src
    }

    return src
        .replace(/\\U([0-9a-fA-F]{8})/g, (_, hex: string) => {
            try {
                return String.fromCodePoint(parseInt(hex, 16))
            } catch {
                return `\\U${hex}`
            }
        })
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
        // 剥离截断产生的残缺转义尾巴(位数不足、悬在字符串末尾)
        .replace(/(?:\\U[0-9a-fA-F]{0,7}|\\u[0-9a-fA-F]{0,3}|\\x[0-9a-fA-F]{0,1})$/, '')
}

/** 列表条目(不含正文;preview 为服务端截取的纯文本摘要) */
export interface MailListItem {
    id: string
    sender: string
    recipient: string
    /** 秒级时间戳(NexoraMail 落库时间) */
    timestamp: number
    subject: string
    size: number
    is_read: boolean
    read_at?: number
    /** RFC 邮件头原始 Date 文本(可能缺失) */
    date?: string
    preview_text?: string
}

/** 详情 = 列表字段 + 正文(text 优先展示;html 经沙箱 iframe 渲染) */
export interface MailDetail extends MailListItem {
    content_text?: string
    content_html?: string
}

export interface MailStatus {
    enabled: boolean
    linked: boolean
    senderAddress: string
    message: string
}

export interface MailListResult {
    mails: MailListItem[]
    total: number
    unreadTotal: number
}

interface MailListResponse {
    success: boolean
    message?: string
    mails?: Array<Record<string, unknown>>
    total?: number
    unread_total?: number
}

interface MailDetailResponse {
    success: boolean
    message?: string
    mail?: Record<string, unknown>
}

interface MailReadResponse {
    success: boolean
    message?: string
    is_read?: boolean
}

/** 规范化列表条目:解码转义文本 + 字段兜底 */
function normalizeMailItem(raw: Record<string, unknown>): MailListItem {
    const isReadRaw = raw.is_read

    const isRead = typeof isReadRaw === 'boolean'
        ? isReadRaw
        : isReadRaw !== undefined && isReadRaw !== null && String(isReadRaw).trim().toLowerCase() !== '' && Number(isReadRaw) !== 0

    return {
        id: String(raw.id || ''),
        sender: decodeUnicodeEscapes(raw.sender),
        recipient: decodeUnicodeEscapes(raw.recipient),
        timestamp: Number(raw.timestamp || 0),
        subject: decodeUnicodeEscapes(raw.subject),
        size: Number(raw.size || 0),
        is_read: isRead,
        read_at: raw.read_at !== undefined && raw.read_at !== null ? Number(raw.read_at) : undefined,
        date: raw.date ? decodeUnicodeEscapes(raw.date) : undefined,
        preview_text: raw.preview_text ? decodeUnicodeEscapes(raw.preview_text) : undefined,
    }
}

/** 规范化详情(在列表字段基础上解码正文字段) */
function normalizeMailDetail(raw: Record<string, unknown>): MailDetail {
    return {
        ...normalizeMailItem(raw),
        content_text: raw.content_text ? decodeUnicodeEscapes(raw.content_text) : undefined,
        content_html: raw.content_html ? decodeUnicodeEscapes(raw.content_html) : undefined,
    }
}

/**
 * 获取当前用户邮件绑定状态。
 * enabled=false(NexoraMail 未启用)或 linked=false(未绑定邮箱)时面板显示引导态。
 */
export async function fetchMailStatus(): Promise<MailStatus> {
    const data = await apiFetch<{
        success: boolean
        enabled?: boolean
        linked?: boolean
        sender_address?: string
        message?: string
    }>('/api/mail/me/status')

    return {
        enabled: Boolean(data.enabled),
        linked: Boolean(data.linked),
        senderAddress: String(data.sender_address || ''),
        message: String(data.message || ''),
    }
}

/** 拉取文件夹列表(offset/limit 由调用方按分页传入;q 为服务端搜索关键字) */
export async function listMail(folder: MailFolder, options: { q?: string; offset?: number; limit?: number } = {}): Promise<MailListResult> {
    const params = new URLSearchParams()

    if (options.q) {
        params.set('q', options.q)
    }

    params.set('offset', String(Math.max(0, options.offset ?? 0)))
    params.set('limit', String(Math.min(Math.max(options.limit ?? 50, 1), 200)))

    const data = await apiFetch<MailListResponse>(`/api/mail/me/${folder}?${params.toString()}`)

    return {
        mails: Array.isArray(data.mails) ? data.mails.map(normalizeMailItem) : [],
        total: Number(data.total || 0),
        unreadTotal: Number(data.unread_total || 0),
    }
}

/** 拉取单封邮件详情 */
export async function fetchMailDetail(folder: MailFolder, mailId: string): Promise<MailDetail> {
    const data = await apiFetch<MailDetailResponse>(`/api/mail/me/${folder}/${encodeURIComponent(mailId)}`)

    if (!data.mail || typeof data.mail !== 'object') {
        throw new Error(data.message || '读取邮件失败')
    }

    return normalizeMailDetail(data.mail)
}

/** 标记已读/未读(仅收件箱支持),返回服务端确认的最终状态 */
export async function markMailRead(mailId: string, isRead: boolean): Promise<boolean> {
    const data = await apiFetch<MailReadResponse>(
        `/api/mail/me/inbox/${encodeURIComponent(mailId)}/read`,
        { method: 'PATCH', body: JSON.stringify({ is_read: isRead }) }
    )

    return Boolean(data.is_read)
}

/** 删除邮件(按文件夹) */
export async function deleteMail(folder: MailFolder, mailId: string): Promise<void> {
    await apiFetch<{ success: boolean }>(`/api/mail/me/${folder}/${encodeURIComponent(mailId)}`, {
        method: 'DELETE',
    })
}

/** 发送邮件(is_html 为 true 时正文按 HTML 渲染) */
export async function sendMail(options: { recipient: string; subject: string; content: string; isHtml?: boolean }): Promise<void> {
    await apiFetch<{ success: boolean }>('/api/mail/me/send', {
        method: 'POST',
        body: JSON.stringify({
            recipient: options.recipient,
            subject: options.subject,
            content: options.content,
            is_html: Boolean(options.isHtml),
        }),
    })
}
