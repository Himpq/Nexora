export interface InteractiveHtmlBlock {
    index: number
    parts: InteractiveHtmlPart[]
}

export type InteractiveHtmlPart =
    | { kind: 'markup'; source: string }
    | { kind: 'style'; source: string }
    | { kind: 'script'; source: string; module: boolean }

const INTERACTIVE_FRAME_SELECTOR = 'iframe[data-nexora-interactive-index]'
const INTERACTIVE_FRAME_HEIGHT_MESSAGE = 'nexora-interactive-html-height'

let interactiveFrameHeightListenerRegistered = false

const SANDBOX_CONTENT_POLICY = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data: blob:',
    "connect-src 'none'",
    'media-src data: blob:',
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
].join('; ')

/** 检查 Markdown 的 HTML 块是否包含真实 script 元素，不让注释文本误触发。 */
export function hasSandboxElements(markup: string): boolean {
    const template = document.createElement('template')

    template.innerHTML = markup

    return template.content.querySelector('script, style') !== null
}

/** 把已完成回答中的交互占位符替换成仅允许脚本运行的隔离 iframe。 */
export function mountInteractiveHtmlBlocks(root: HTMLElement, blocks: InteractiveHtmlBlock[]): void {
    if (blocks.length > 0 && !interactiveFrameHeightListenerRegistered) {
        window.addEventListener('message', handleInteractiveFrameHeightMessage)
        interactiveFrameHeightListenerRegistered = true
    }

    blocks.forEach((block) => {
        const index = String(block.index)
        const frameSelector = `${INTERACTIVE_FRAME_SELECTOR}[data-nexora-interactive-index="${index}"]`
        const placeholderSelector = `.nexora-interactive-html-placeholder[data-nexora-interactive-index="${index}"]`
        const renderKey = createRenderKey(JSON.stringify(block.parts))
        const existingFrame = root.querySelector<HTMLIFrameElement>(frameSelector)

        if (existingFrame?.dataset.renderKey === renderKey) {
            return
        }

        const frame = document.createElement('iframe')
        frame.className = 'nexora-interactive-html-frame'
        frame.title = '模型生成的交互式内容'
        frame.setAttribute('sandbox', 'allow-scripts')
        frame.setAttribute('referrerpolicy', 'no-referrer')
        frame.dataset.nexoraInteractiveIndex = index
        frame.dataset.renderKey = renderKey
        frame.srcdoc = buildSandboxDocument(block.parts)

        if (existingFrame) {
            existingFrame.replaceWith(frame)

            return
        }

        root.querySelector<HTMLElement>(placeholderSelector)?.replaceWith(frame)
    })

    const activeIndices = new Set(blocks.map((block) => String(block.index)))

    root.querySelectorAll<HTMLIFrameElement>(INTERACTIVE_FRAME_SELECTOR).forEach((frame) => {
        if (!activeIndices.has(frame.dataset.nexoraInteractiveIndex || '')) {
            frame.remove()
        }
    })
}

function handleInteractiveFrameHeightMessage(event: MessageEvent): void {
    if (typeof event.data !== 'object' || event.data === null) {
        return
    }

    const payload = event.data as { type?: unknown; height?: unknown }

    if (payload.type !== INTERACTIVE_FRAME_HEIGHT_MESSAGE || typeof payload.height !== 'number' || !Number.isFinite(payload.height)) {
        return
    }

    const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>(INTERACTIVE_FRAME_SELECTOR))
        .find((candidate) => candidate.contentWindow === event.source)

    if (!frame) {
        return
    }

    // Include the iframe border in its outer height so the sandbox viewport has no internal scrollbar.
    const borderHeight = frame.offsetHeight - frame.clientHeight
    const height = Math.ceil(payload.height) + borderHeight

    if (!Number.isSafeInteger(height) || height < 1) {
        return
    }

    frame.style.height = `${height}px`
    frame.dataset.heightReady = 'true'
}

/** 流式内容完成前不挂载；源码变化后用标记替换已运行的旧 iframe。 */
function createRenderKey(source: string): string {
    let hash = 2166136261

    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }

    return `${source.length}-${(hash >>> 0).toString(36)}`
}

/** 先在 iframe 文档头部设定 CSP，再放入模型片段，拦截其外部资源访问。 */
function buildSandboxDocument(parts: InteractiveHtmlPart[]): string {
    const policyMeta = `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CONTENT_POLICY}">`
    const markup: string[] = []
    const styles: string[] = []
    const scripts: string[] = []

    parts.forEach((part) => {
        if (part.kind === 'markup') {
            const normalizedMarkup = stripDocumentShell(part.source)
            const remainingMarkup = normalizedMarkup.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (script) => {
                scripts.push(script)

                return ''
            })

            markup.push(remainingMarkup)

            return
        }

        if (part.kind === 'style') {
            styles.push('<style>' + part.source.replace(/<\/style/gi, '<\\/style') + '</style>')

            return
        }

        const scriptType = part.module ? ' type="module"' : ''
        const scriptSource = part.source.replace(/<\/script/gi, '<\\/script')

        scripts.push('<script' + scriptType + '>' + scriptSource + '</script>')
    })

    const headContent = styles.join('\n') + buildSandboxLayoutStyles()
    const bodyContent = markup.join('\n') + scripts.join('\n') + buildSandboxResizeReporter()

    return '<!doctype html><html><head><meta charset="utf-8">' + policyMeta + headContent
        + '</head><body>' + bodyContent + '</body></html>'
}

/** Center top-level sandbox content while preserving its inner layout. */
function buildSandboxLayoutStyles(): string {
    return '<style>body { text-align: center; } body > * { margin-left: auto !important; margin-right: auto !important; text-align: initial; }</style>'
}

function buildSandboxResizeReporter(): string {
    return [
        '<script>',
        '(() => {',
        `    const messageType = '${INTERACTIVE_FRAME_HEIGHT_MESSAGE}';`,
        '    let scheduled = false;',
        '    const report = () => {',
        '        const root = document.documentElement;',
        '        const body = document.body;',
        '        const height = Math.ceil(Math.max(root.scrollHeight, root.offsetHeight, body.scrollHeight, body.offsetHeight));',
        '        parent.postMessage({ type: messageType, height }, "*");',
        '    };',
        '    const schedule = () => {',
        '        if (scheduled) {',
        '            return;',
        '        }',
        '        scheduled = true;',
        '        requestAnimationFrame(() => {',
        '            scheduled = false;',
        '            report();',
        '        });',
        '    };',
        '    const resizeObserver = new ResizeObserver(schedule);',
        '    resizeObserver.observe(document.documentElement);',
        '    if (document.body) {',
        '        resizeObserver.observe(document.body);',
        '    }',
        '    new MutationObserver(schedule).observe(document.documentElement, {',
        '        attributes: true,',
        '        characterData: true,',
        '        childList: true,',
        '        subtree: true,',
        '    });',
        '    window.addEventListener("load", schedule);',
        '    window.addEventListener("resize", schedule);',
        '    report();',
        '})();',
        '</script>',
    ].join('')
}

function stripDocumentShell(source: string): string {
    return source
        .replace(/<!doctype\b[^>]*>/gi, '')
        .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')
}
