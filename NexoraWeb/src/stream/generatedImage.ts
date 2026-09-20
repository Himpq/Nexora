/**
 * generatedImage.ts — 生图工具结果归一化
 *
 * 生图工具的模型可见结果只包含状态文字，真正的图片地址位于工具结果
 * JSON 的 images[].url 中。这里把该结构转换为消息组件可直接渲染的媒体数据。
 */

export interface GeneratedImageItem {
    imageUrl: string
    title: string
}

export interface GeneratedImageGalleryData {
    type: 'generated_image_gallery'
    items: GeneratedImageItem[]
}

/** 只接受会话资产地址或 HTTPS 图片地址，避免插入工具结果中的任意链接。 */
function normalizeImageUrl(raw: unknown): string {
    const value = String(raw || '').trim()

    if (!value) {
        return ''
    }

    if (/^\/api\/conversations\/[^\/\s]+\/assets\/[A-Za-z0-9_-]+$/.test(value)) {
        return value
    }

    try {
        const url = new URL(value)

        return url.protocol === 'https:' ? url.toString() : ''
    } catch {
        return ''
    }
}

/** 判断工具名是否为生图工具。 */
export function isGenerateImageToolName(toolName: string): boolean {
    return String(toolName || '').trim().replace(/[\s_-]+/g, '').toLowerCase().includes('generateimage')
}

/** 从 generate_image 的原始 JSON 结果读取图片地址。 */
export function readGeneratedImageGallery(
    toolName: string,
    rawResult: string,
): GeneratedImageGalleryData | undefined {
    if (!isGenerateImageToolName(toolName)) {
        return undefined
    }

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
    const rawImages = Array.isArray(record.images) ? record.images : []
    const items: GeneratedImageItem[] = []
    const seen = new Set<string>()

    rawImages.forEach((rawImage, index) => {
        if (!rawImage || typeof rawImage !== 'object' || Array.isArray(rawImage)) {
            return
        }

        const imageRecord = rawImage as Record<string, unknown>
        const imageUrl = normalizeImageUrl(imageRecord.url || imageRecord.asset_url)

        if (!imageUrl || seen.has(imageUrl)) {
            return
        }

        seen.add(imageUrl)
        items.push({
            imageUrl,
            title: `生成图片 ${index + 1}`,
        })
    })

    return items.length > 0
        ? { type: 'generated_image_gallery', items }
        : undefined
}
