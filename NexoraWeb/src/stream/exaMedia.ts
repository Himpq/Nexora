/**
 * exaMedia.ts — Exa 搜索结果媒体归一化
 *
 * 职责:
 *   - 读取后端提供的 display_media 结构
 *   - 兼容已有会话中仍只保存 Exa 原始 JSON 的结果
 *   - 严格限制画廊图片为 https 外链
 *   - 移除历史工具展示文本中的独立 Markdown 图片行
 */

export interface ExaImageItem {
    imageUrl: string
    title: string
    sourceUrl: string
}

export interface ExaImageGalleryData {
    type: 'exa_image_gallery'
    query: string
    items: ExaImageItem[]
}

/** 判断工具名是否为 Exa Web Search。 */
export function isExaWebSearchToolName(toolName: string): boolean {
    return String(toolName || '').trim().replace(/[\s-]/g, '_').toLowerCase() === 'exa_web_search'
}

/** 只接受可直接展示的 https 图片地址。 */
function normalizeImageUrl(raw: unknown): string {
    const value = String(raw || '').trim()

    if (!value) {
        return ''
    }

    try {
        const url = new URL(value)

        return url.protocol === 'https:' ? url.toString() : ''
    } catch {
        return ''
    }
}

/** 规范化来源链接，允许常规 http/https 页面地址。 */
function normalizeSourceUrl(raw: unknown): string {
    const value = String(raw || '').trim()

    if (!value) {
        return ''
    }

    try {
        const url = new URL(value)

        return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
    } catch {
        return ''
    }
}

/** 原始媒体条目 → 画廊条目。 */
function buildGallery(query: unknown, rawItems: unknown[]): ExaImageGalleryData | undefined {
    const items: ExaImageItem[] = []
    const seen = new Set<string>()

    rawItems.forEach((rawItem) => {
        if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
            return
        }

        const record = rawItem as Record<string, unknown>
        const imageUrl = normalizeImageUrl(record.image_url || record.image)

        if (!imageUrl || seen.has(imageUrl)) {
            return
        }

        seen.add(imageUrl)
        items.push({
            imageUrl,
            title: String(record.title || '').trim(),
            sourceUrl: normalizeSourceUrl(record.source_url || record.url),
        })
    })

    if (items.length === 0) {
        return undefined
    }

    return {
        type: 'exa_image_gallery',
        query: String(query || '').trim(),
        items,
    }
}

/** 读取结构化 display_media。 */
export function readExaImageGallery(raw: unknown): ExaImageGalleryData | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return undefined
    }

    const record = raw as Record<string, unknown>

    if (String(record.type || '').trim() !== 'exa_image_gallery') {
        return undefined
    }

    const items = Array.isArray(record.items) ? record.items : []

    return buildGallery(record.query, items)
}

/** 从 Exa 原始结果读取画廊，供已有历史消息继续展示图片。 */
export function readExaImageGalleryFromResult(rawResult: string): ExaImageGalleryData | undefined {
    let payload: unknown

    try {
        payload = JSON.parse(String(rawResult || ''))
    } catch {
        return undefined
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return undefined
    }

    const record = payload as Record<string, unknown>
    const structured = readExaImageGallery(record.display_media)

    if (structured) {
        return structured
    }

    if (record.success === false) {
        return undefined
    }

    const results = Array.isArray(record.results) ? record.results : []

    return buildGallery(record.query, results)
}

/** 删除历史 Exa 展示文本中的独立 Markdown 图片行，保留搜索文字与来源。 */
export function stripExaImageMarkdown(markdownText: string): string {
    const source = String(markdownText || '')

    if (!source) {
        return ''
    }

    return source
        .split(/\r?\n/)
        .filter((line) => !/^\s*!\[[^\]]*\]\(\s*https:\/\/.+\s*\)\s*$/i.test(line))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}
