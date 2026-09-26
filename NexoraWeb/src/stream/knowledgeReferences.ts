/**
 * knowledgeReferences.ts — 对话中的知识库引用解析与 HTML 片段生成。
 *
 * 引用协议沿用旧前端:
 *   [kb]知识标题,支撑该回答的原文片段[/kb]
 *
 * 这里仅负责纯文本解析和安全 HTML 生成,点击行为由 MarkdownView 向宿主转发。
 */

export interface KnowledgeReference {
    source: string
    snippet: string
}

export interface ProtectedKnowledgeReferences {
    text: string
    references: KnowledgeReference[]
}

const KNOWLEDGE_REFERENCE_PATTERN = /\[kb\]([\s\S]*?)\[\/kb\]/g

/** 拆分知识引用载荷:第一个逗号前是知识标题,其余内容是来源片段。 */
export function splitKnowledgeReferencePayload(payload: string): KnowledgeReference {
    const raw = String(payload || '').trim()
    const commaIndex = raw.indexOf(',')

    if (commaIndex < 0) {
        return { source: raw, snippet: '' }
    }

    return {
        source: raw.slice(0, commaIndex).trim(),
        snippet: raw.slice(commaIndex + 1).trim(),
    }
}

/** 知识引用按钮只显示短标题,完整标题和原文片段放入 title 供悬停查看。 */
export function clipKnowledgeReferenceLabel(text: string, limit = 18): string {
    const value = String(text || '').replace(/\s+/g, ' ').trim()

    if (value.length <= limit) {
        return value
    }

    return `${value.slice(0, Math.max(0, limit - 1)).trim()}...`
}

/** Markdown 渲染前保护引用,避免 marked 把协议文本拆成普通文字。 */
export function protectKnowledgeReferencesInMarkdown(source: string): ProtectedKnowledgeReferences {
    const references: KnowledgeReference[] = []
    const text = String(source || '').replace(KNOWLEDGE_REFERENCE_PATTERN, (_match, payload: string) => {
        const reference = splitKnowledgeReferencePayload(payload)

        if (!reference.source) {
            return _match
        }

        const index = references.length
        references.push(reference)

        return `@@NEXORA_KB_REF_${index}@@`
    })

    return { text, references }
}

/** HTML 属性和文本节点使用同一套转义,防止知识标题/片段破坏按钮结构。 */
export function escapeKnowledgeReferenceHtml(value: string): string {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

/** 生成与旧前端交互一致的知识来源按钮。 */
export function renderKnowledgeReferenceTag(reference: KnowledgeReference): string {
    const source = String(reference.source || '').trim()
    const snippet = String(reference.snippet || '').trim()

    if (!source) {
        return ''
    }

    const label = clipKnowledgeReferenceLabel(source)
    const title = snippet ? `知识来源：${source}\n${snippet}` : `知识来源：${source}`
    const icon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"></path><path d="M8 6h8M8 10h8"></path></svg>'

    return [
        '<button type="button" class="kb-reference" data-kb-source="',
        escapeKnowledgeReferenceHtml(source),
        '" data-kb-snippet="',
        escapeKnowledgeReferenceHtml(snippet),
        '" title="',
        escapeKnowledgeReferenceHtml(title),
        '" aria-label="打开知识来源：',
        escapeKnowledgeReferenceHtml(source),
        '">',
        '<span class="kb-reference-source">',
        icon,
        '<span>',
        escapeKnowledgeReferenceHtml(label),
        '</span></span>',
        snippet
            ? `<span class="kb-reference-snippet">${escapeKnowledgeReferenceHtml(snippet)}</span>`
            : '',
        '</button>',
    ].join('')
}

/** 将保护标记替换回按钮,只能在 marked + sanitizeHtml 之后调用。 */
export function restoreKnowledgeReferencesInHtml(html: string, references: KnowledgeReference[]): string {
    let output = String(html || '')

    references.forEach((reference, index) => {
        output = output
            .split(`@@NEXORA_KB_REF_${index}@@`)
            .join(renderKnowledgeReferenceTag(reference))
    })

    return output
}
