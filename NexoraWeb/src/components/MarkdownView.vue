<!--
    MarkdownView.vue — Markdown 渲染组件(对话与知识库共用)

    职责:
      - marked 渲染 Markdown → HTML
      - highlight.js 代码高亮
      - KaTeX 数学公式(块级 $$...$$ 与行内 $...$)
      - 输出前做基础 XSS 清洗(移除 script 与事件属性)

    性能约定(重要):
      - marked.use 必须停留在模块顶层:它修改的是全局 marked 实例,
        在组件内调用会随实例数量无限堆叠扩展钩子,导致解析耗时与内存暴涨;
      - 渲染走 120ms 尾随节流:流式期间高频增量不逐字重解析,
        停止增量后由定时器补一次最终态,历史加载等一次性内容立即渲染。
-->

<script setup lang="ts">
    import { computed, onBeforeUnmount, ref, watch } from 'vue'

    import { marked } from 'marked'
    import { markedHighlight } from 'marked-highlight'
    import hljs from 'highlight.js'
    import katex from 'katex'

    // 代码高亮主题不在此静态引入:入口页 index.html 声明 github(亮,常开)与
    // github-dark(暗,id=hljs-theme-dark)双 link,由 ui/theme.ts 按主题互斥启停。
    // 若在此 import github.min.css 会被打进包尾并覆盖暗色 link,导致暗色代码块不可读。
    import 'katex/dist/katex.min.css'

    /** 流式节流间隔(ms):该周期内的多次增量合并为一次解析 */
    const RENDER_THROTTLE_MS = 120

    /**
     * 允许自动语法高亮的语言白名单。
     *
     * 背景(2026-08 性能事故):知识搜索结果的 markdown 中嵌套了不配对的 ```markdown
     * 围栏,hljs 的 markdown 语法对围栏启用 subLanguage,出现"高亮输出被再次当作
     * 输入高亮"的反馈循环(实测 217B → 7.9MB 指数膨胀直至标签页 OOM)。
     * 白名单同时挡掉:text/markdown 等无价值高亮、未知语言的 highlightAuto 全量扫描。
     */
    const HIGHLIGHT_LANG_WHITELIST = new Set([
        'json', 'js', 'javascript', 'ts', 'typescript', 'jsx', 'tsx',
        'py', 'python', 'bash', 'shell', 'sh', 'css', 'less', 'scss',
        'html', 'xml', 'sql', 'java', 'c', 'cpp', 'go', 'rust', 'php', 'yaml', 'yml',
    ])

    /** 超长代码跳过高亮(解析成本失控保护) */
    const HIGHLIGHT_MAX_CODE_LENGTH = 100_000

    /** 跳过高亮时的安全转义(marked-highlight 将返回值视为已转义 HTML) */
    function escapeCodeText(value: string): string {
        return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }

    // 模块级注册一次(marked 全局单例,重复 use 会堆叠扩展钩子)
    marked.use(markedHighlight({
        langPrefix: 'hljs language-',

        highlight(code: string, lang: string): string {
            const language = String(lang || '').trim().toLowerCase()

            // 防御1:输入已含高亮标记 → 是上一轮输出被回灌,返回转义文本绝不二次高亮
            if (code.includes('hljs-') || code.includes('<span')) {
                return escapeCodeText(code)
            }

            // 防御2:语言不在白名单(markdown/text/plain/未知等)→ 转义纯文本展示
            if (!HIGHLIGHT_LANG_WHITELIST.has(language)) {
                return escapeCodeText(code)
            }

            // 防御3:超长代码不做高亮
            if (code.length > HIGHLIGHT_MAX_CODE_LENGTH) {
                return escapeCodeText(code)
            }

            if (!hljs.getLanguage(language)) {
                return escapeCodeText(code)
            }

            try {
                return hljs.highlight(code, { language, ignoreIllegals: true }).value
            } catch {
                return escapeCodeText(code)
            }
        },
    }))

    const props = defineProps<{
        content: string
    }>()

    /** 实际参与渲染的内容(节流缓冲区) */
    const displayContent = ref(props.content || '')

    let throttleTimer: number | null = null
    let lastRenderAt = 0

    function flushNow(): void {
        if (throttleTimer !== null) {
            window.clearTimeout(throttleTimer)

            throttleTimer = null
        }

        lastRenderAt = Date.now()
        displayContent.value = props.content || ''
    }

    watch(() => props.content, () => {
        if (!props.content) {
            flushNow()

            return
        }

        const elapsed = Date.now() - lastRenderAt

        if (throttleTimer !== null) {
            window.clearTimeout(throttleTimer)

            throttleTimer = null
        }

        if (elapsed >= RENDER_THROTTLE_MS) {
            flushNow()

            return
        }

        throttleTimer = window.setTimeout(() => {
            throttleTimer = null
            lastRenderAt = Date.now()
            displayContent.value = props.content || ''
        }, RENDER_THROTTLE_MS - elapsed)
    })

    onBeforeUnmount(() => {
        if (throttleTimer !== null) {
            window.clearTimeout(throttleTimer)

            throttleTimer = null
        }
    })

    /** 块级公式 $$...$$ 渲染为 HTML */
    function renderBlockMath(source: string): string {
        return source.replace(/\$\$([\s\S]+?)\$\$/g, (_match, latex: string) => {
            try {
                return katex.renderToString(latex.trim(), { displayMode: true, throwOnError: false })
            } catch {
                return `<code>$$${latex}$$</code>`
            }
        })
    }

    /**
     * 渲染前归一化(仅作用于代码围栏之外):
     *
     * 1. 中文语境强调定界符修正:`**` 与引号(`"“”''`)+文字紧贴时插入零宽空格(U+200B)。
     *    背景(marked 助翼误判):`位就是**"轻装旅行主力"**，和` 这类内容——
     *    开启侧 `**` 紧贴 CJK 文字 + 引号时 marked 的 em/strong 分隔符左右助翼判定失败,
     *    `**` 原样输出、加粗不生效;插入不可见零宽空格后分隔符恢复判读。
     * 2. 表格容错:全角竖线 ｜ → ASCII |;连续 2+ 行管道行但缺 `---` 分隔行时自动补分隔行,
     *    并保证表与后续正文之间有换行(否则 GFM 会把正文吞进表格数据行)。
     */
    function normalizeMarkdownForRendering(source: string): string {
        const lines = String(source || '').split('\n')
        const out: string[] = []
        let fenceChar = ''
        let fenceLength = 0
        // 上一个非空行是否为表格分隔行(处于表格体内部时不再补分隔,避免二次分隔破坏数据行)
        let previousSeparatedTable = false

        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i]
            const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/)

            if (fenceMatch) {
                const marker = fenceMatch[1]
                const markerChar = marker[0]
                const markerLength = marker.length

                if (!fenceChar) {
                    fenceChar = markerChar
                    fenceLength = markerLength
                } else if (fenceChar === markerChar && markerLength >= fenceLength) {
                    fenceChar = ''
                    fenceLength = 0
                }

                out.push(line)
                previousSeparatedTable = false

                continue
            }

            if (fenceChar) {
                // 围栏内代码内容不加工,保持原样
                out.push(line)

                continue
            }

            if (!line.trim()) {
                out.push(line)
                previousSeparatedTable = false

                continue
            }

            const normalized = normalizeLineRow(line)

            if (previousSeparatedTable) {
                out.push(normalized)
                previousSeparatedTable = false

                continue
            }

            if (isTableSeparatorRow(normalized)) {
                out.push(normalized)
                previousSeparatedTable = true

                continue
            }

            const nextRaw = lines[i + 1]

            if (nextRaw !== undefined) {
                const nextNorm = normalizeLineRow(nextRaw)

                if (isPipeRow(normalized) && isPipeRow(nextNorm) && !isTableSeparatorRow(nextNorm)) {
                    // 缺分隔行的表:定位整段连续管道行,补一张分隔行,段尾遇正文补空行防 GFM 吞并
                    let runEnd = i

                    while (
                        runEnd + 1 < lines.length
                        && lines[runEnd + 1].trim()
                        && isPipeRow(normalizeLineRow(lines[runEnd + 1]))
                    ) {
                        runEnd += 1
                    }

                    out.push(normalized)
                    out.push(buildTableSeparatorRow(normalized))

                    for (let k = i + 1; k <= runEnd; k += 1) {
                        out.push(normalizeLineRow(lines[k]))
                    }

                    const afterLine = String(lines[runEnd + 1] ?? '').trim()

                    if (afterLine) {
                        out.push('')
                    }

                    i = runEnd
                    previousSeparatedTable = false

                    continue
                }
            }

            out.push(normalized)
        }

        return out.join('\n')
    }

    /** 单行归一化:全角竖线 → ASCII |;强调定界符与引号贴邻的上下文插入零宽空格 */
    function normalizeLineRow(line: string): string {
        return line
            .replace(/｜/g, '|')
            .replace(/([^\s\p{P}\p{S}])(\*\*)(?=["“”'‘’])/gu, `$1$2\u200B`)
            .replace(/(["“”'‘’])(\*\*)(?=[^\s\p{P}\p{S}])/gu, `$1\u200B$2`)
    }

    /** 是否为表格数据/表头行(至少 2 个未转义管道符,即 3 列及以上) */
    function isPipeRow(line: string): boolean {
        return countUnescapedPipes(line) >= 2
    }

    /** 是否为 GFM 表格分隔行(如 `--- | --- | ---`、`:---:|--- | :--:` ) */
    function isTableSeparatorRow(line: string): boolean {
        const trimmed = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '')
        const cells = trimmed.split('|').map((cell) => cell.trim())

        return cells.length >= 2 && cells.every((cell) => /^:?-+:?$/.test(cell))
    }

    /** 未转义管道符计数(跳过 `\|`) */
    function countUnescapedPipes(line: string): number {
        const text = String(line || '')
        let count = 0

        for (let i = 0; i < text.length; i += 1) {
            if (text[i] === '|' && (i === 0 || text[i - 1] !== '\\')) {
                count += 1
            }
        }

        return count
    }

    /** 按表头列数生成 GFM 分隔行 */
    function buildTableSeparatorRow(headerRow: string): string {
        const columns = countUnescapedPipes(headerRow) + 1

        return Array.from({ length: columns }, () => '---').join(' | ')
    }

    /** 行内公式 $...$ 渲染(前后不能是数字,避免与货币符号冲突) */
    function renderInlineMath(source: string): string {
        return source.replace(/(^|[^$\\])\$([^$\n]+?)\$/g, (_match, prefix: string, latex: string) => {
            try {
                return `${prefix}${katex.renderToString(latex.trim(), { displayMode: false, throwOnError: false })}`
            } catch {
                return _match
            }
        })
    }

    /** 基础 XSS 清洗:移除 script/iframe 标签与 on* 事件属性 */
    function sanitizeHtml(html: string): string {
        const template = document.createElement('template')

        template.innerHTML = html

        template.content.querySelectorAll('script, iframe, object, embed, link, meta').forEach((node) => node.remove())

        template.content.querySelectorAll('*').forEach((node) => {
            Array.from(node.attributes).forEach((attr) => {
                if (attr.name.startsWith('on')) {
                    node.removeAttribute(attr.name)
                }
            })
        })

        return template.innerHTML
    }

    const renderedHtml = computed(() => {
        const normalized = normalizeMarkdownForRendering(displayContent.value)

        const withMath = renderInlineMath(renderBlockMath(normalized))

        const raw = marked.parse(withMath, { gfm: true, breaks: true }) as string

        return sanitizeHtml(raw)
    })
</script>

<template>
    <div class="markdown-body" v-html="renderedHtml"></div>
</template>

<style scoped>
    .markdown-body {
        line-height: 1.7;
        word-break: break-word;
        font-size: 14px;
    }

    .markdown-body :deep(p) {
        margin: 0.5em 0;
    }

    .markdown-body :deep(pre) {
        background: var(--color-bg-sunken);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        padding: 12px;
        overflow-x: auto;
    }

    .markdown-body :deep(code) {
        font-family: 'Cascadia Code', Consolas, monospace;
        font-size: 13px;
    }

    .markdown-body :deep(:not(pre) > code) {
        background: var(--color-bg-hover);
        border-radius: 4px;
        padding: 0.1em 0.4em;
    }

    .markdown-body :deep(table) {
        border-collapse: collapse;
        margin: 0.5em 0;
    }

    .markdown-body :deep(th),
    .markdown-body :deep(td) {
        border: 1px solid var(--color-border);
        padding: 4px 10px;
    }

    /* 表头底色与正文区分,暗色下不再呈"黑底白字"的裸表格观感 */
    .markdown-body :deep(th) {
        background: var(--color-bg-sunken);
        color: var(--color-text-primary);
        font-weight: 600;
    }

    /*
     * markdown 分隔符(---):浏览器默认 hr 继承文字色,
     * 暗色下会渲染成白色横线,显式收敛到边框令牌。
     */
    .markdown-body :deep(hr) {
        border: none;
        border-top: 1px solid var(--color-border);
    }

    .markdown-body :deep(blockquote) {
        border-left: 3px solid var(--color-border-strong);
        margin: 0.5em 0;
        padding-left: 12px;
        color: var(--color-text-secondary);
    }

    .markdown-body :deep(img) {
        max-width: 100%;
    }
</style>
