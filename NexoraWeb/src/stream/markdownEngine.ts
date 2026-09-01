/**
 * markdownEngine.ts — Markdown 渲染管线(全站唯一 marked 配置点)
 *
 * 职责:
 *   - marked + highlight.js 代码高亮
 *   - KaTeX 数学公式(块级 $$...$$ 与行内 $...$)
 *   - 渲染前归一化(中文强调定界符 / 表格容错)
 *   - 输出前基础 XSS 清洗
 *
 * 关键约束(2026-08 二次事故,务必遵守):
 *   - marked.use 修改的是全局 marked 单例,绝不能重复注册。打包器会把只有单一
 *     消费者的模块顶层代码内联进组件 setup(rolldown 对 MarkdownView.vue 即如此),
 *     组件挂载一次就注册一层高亮钩子:同一次 parse 内 token 依次过 N 层钩子,
 *     第 1 层高亮产出 span,后续每层命中防回灌防御再 escape 一层,
 *     转义层数 = 已挂载实例数 - 1(实测推理块渲染出 15 层 &amp; 堆积即此因)。
 *   - 因此防重注册标志必须挂在 marked 实例自身(真正的跨模块单例)上,
 *     模块级布尔随内联作用域重复初始化,防不住。
 */

import { marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'
import katex from 'katex'

// 代码高亮主题不在此静态引入:入口页 index.html 声明 github(亮,常开)与
// github-dark(暗,id=hljs-theme-dark)双 link,由 ui/theme.ts 按主题互斥启停。
import 'katex/dist/katex.min.css'

/** 流式节流间隔由消费方(MarkdownView)自理;本模块只负责"文本进、HTML 出" */

/** 防重注册标志(挂在 marked 全局单例上) */
const PIPELINE_READY_FLAG = '__nexoraMarkdownPipelineReady__'

/**
 * 允许自动语法高亮的语言白名单。
 *
 * 背景(2026-08 性能事故):知识搜索结果的 markdown 中嵌套了不配对的 ```markdown
 * 围栏,hljs 的 markdown 语法对围栏启用 subLanguage,出现"高亮输出被再次当作
 * 输入高亮"的反馈循环。白名单同时挡掉:text/markdown 等无价值高亮、
 * 未知语言的 highlightAuto 全量扫描。
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

/**
 * 剥离上一轮渲染残留的高亮标记并循环还原多轮转义实体,回到纯文本。
 * 仅剥离 class 以 hljs 开头的 span 标记;实体还原循环可处理任意层级链式编码
 * (如 &amp;amp;lt; → &lt; → <)。触发条件是代码文本中出现 hljs 特征,
 * 真实代码里同时含 hljs 字样与 HTML 实体的极端场景会被规整为纯文本,可接受。
 */
function stripHighlightArtifacts(value: string): string {
    let text = value.replace(/<span class="hljs[^"]*">/g, '').replace(/<\/span>/g, '')

    let previous = ''

    while (text !== previous) {
        previous = text
        text = text
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&')
    }

    return text
}

/** 向全局 marked 单例注册高亮管线(进程内仅一次,重复调用直接返回) */
function ensurePipeline(): void {
    const owner = marked as unknown as Record<string, unknown>

    if (owner[PIPELINE_READY_FLAG]) {
        return
    }

    owner[PIPELINE_READY_FLAG] = true

    marked.use(markedHighlight({
        langPrefix: 'hljs language-',

        highlight(code: string, lang: string): string {
            const language = String(lang || '').trim().toLowerCase()

            // 防御1:输入携带上一轮渲染产物(hljs 标记及其任意层级转义形态)时,
            // 剥离标记并还原实体回到纯文本,再走正常高亮路径(自愈,不放大转义层数)
            const source = code.includes('hljs') ? stripHighlightArtifacts(code) : code

            // 防御2:语言不在白名单(markdown/text/plain/未知等)→ 转义纯文本展示
            if (!HIGHLIGHT_LANG_WHITELIST.has(language)) {
                return escapeCodeText(source)
            }

            // 防御3:超长代码不做高亮
            if (source.length > HIGHLIGHT_MAX_CODE_LENGTH) {
                return escapeCodeText(source)
            }

            if (!hljs.getLanguage(language)) {
                return escapeCodeText(source)
            }

            try {
                return hljs.highlight(source, { language, ignoreIllegals: true }).value
            } catch {
                return escapeCodeText(source)
            }
        },
    }))
}

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

/** 单行归一化:全角竖线 → ASCII |;强调定界符与引号贴邻的上下文插入零宽空格 */
function normalizeLineRow(line: string): string {
    return line
        .replace(/｜/g, '|')
        .replace(/([^\s\p{P}\p{S}])(\*\*)(?=["“”'‘’])/gu, `$1$2\u200B`)
        .replace(/(["“”'‘’])(\*\*)(?=[^\s\p{P}\p{S}])/gu, `$1\u200B$2`)
}

/** 是否为表格数据/表头行(至少 1 个未转义管道符,即 2 列;修复两列表格 xx | xx 不渲染) */
function isPipeRow(line: string): boolean {
    return countUnescapedPipes(line) >= 1
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

/** 表格行单元格数(剥掉首尾竖线后按管道数计;GFM 校验的是单元格数而非管道数) */
function countTableRowColumns(row: string): number {
    const trimmed = String(row || '').trim()

    if (!trimmed) {
        return 0
    }

    const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '')

    return countUnescapedPipes(inner) + 1
}

/** 按表头单元格数生成 GFM 分隔行 */
function buildTableSeparatorRow(headerRow: string): string {
    const columns = countTableRowColumns(headerRow)

    return Array.from({ length: columns }, () => '---').join(' | ')
}

/**
 * 渲染前归一化(仅作用于代码围栏之外):
 *
 * 1. 中文语境强调定界符修正:`**` 与引号(`"“”''`)+文字紧贴时插入零宽空格(U+200B)。
 *    背景(marked 助翼误判):`位就是**"轻装旅行主力"**，和` 这类内容——
 *    开启侧 `**` 紧贴 CJK 文字 + 引号时 marked 的 em/strong 分隔符左右助翼判定失败,
 *    `**` 原样输出、加粗不生效;插入不可见零宽空格后分隔符恢复判读。
 * 2. 表格容错:全角竖线 ｜ → ASCII |;连续管道行缺 `---` 分隔行时自动补;
 *    分隔行与表头单元格数不一致时按表头重写(GFM 严格要求相等,差一列整表
 *    退化为普通文本,模型输出常漏列,见 cid=418 草稿表格)。
 */
function normalizeMarkdownForRendering(source: string): string {
    const lines = String(source || '').split('\n')
    const out: string[] = []
    let fenceChar = ''
    let fenceLength = 0

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

            continue
        }

        if (fenceChar) {
            // 围栏内代码内容不加工,保持原样
            out.push(line)

            continue
        }

        if (!line.trim()) {
            out.push(line)

            continue
        }

        const normalized = normalizeLineRow(line)

        // 孤立的分隔行(水平分割线)原样透传,不参与表格逻辑
        if (isTableSeparatorRow(normalized)) {
            out.push(normalized)

            continue
        }

        // 查找下一个非空行（跳过空行），兼容 AI 在表头与首行数据间插入空行的情况
        // 实际案例：`景点名称 | ...` 与 `伏见... | ...` 间有一空行，需仍识别为同一张表
        let nextIdx = i + 1
        while (nextIdx < lines.length && !lines[nextIdx].trim()) {
            nextIdx += 1
        }

        if (nextIdx < lines.length) {
            const nextNorm = normalizeLineRow(lines[nextIdx])

            if (isPipeRow(normalized) && isTableSeparatorRow(nextNorm)) {
                // 表头 + 分隔行:列数一致原样保留;不一致按表头重写分隔行
                // 随后一次性吞并整段连续 body 行,避免逐行处理时误判 body 为新表头导致中途再补分隔
                out.push(normalized)
                out.push(
                    countTableRowColumns(nextNorm) === countTableRowColumns(normalized)
                        ? nextNorm
                        : buildTableSeparatorRow(normalized)
                )

                // 收集 body：跳过分隔行后可能存在的空行，连续 pipe 行即为 body
                let j = nextIdx + 1
                while (j < lines.length && !lines[j].trim()) {
                    j += 1
                }
                const bodyStart = j
                while (
                    j < lines.length
                    && (lines[j].trim() === '' || (isPipeRow(normalizeLineRow(lines[j])) && !isTableSeparatorRow(normalizeLineRow(lines[j]))))
                ) {
                    if (lines[j].trim()) {
                        j += 1
                    } else {
                        // 空行：如果其后仍是 pipe 行则视为表内空行跳过，否则视为表结束
                        let look = j + 1
                        while (look < lines.length && !lines[look].trim()) {
                            look += 1
                        }
                        if (look < lines.length && isPipeRow(normalizeLineRow(lines[look])) && !isTableSeparatorRow(normalizeLineRow(lines[look]))) {
                            j = look
                        } else {
                            break
                        }
                    }
                }

                for (let k = bodyStart; k < j; k += 1) {
                    if (lines[k].trim()) {
                        out.push(normalizeLineRow(lines[k]))
                    }
                }

                const afterLine = String(lines[j] ?? '').trim()

                if (afterLine) {
                    out.push('')
                }

                i = j - 1

                continue
            }

            if (isPipeRow(normalized) && isPipeRow(nextNorm) && !isTableSeparatorRow(nextNorm)) {
                // 缺分隔行的表:定位整段连续管道行(不含分隔行),补一张分隔行,段尾遇正文补空行防 GFM 吞并
                // 需跳过 header 与首行数据间的空行
                const bodyStart = nextIdx
                let j = bodyStart
                // 向后扩展至连续 pipe 段结束（跳过段内空行）
                let runEnd = bodyStart
                // 先将 bodyStart 纳入，再向后扫描
                j = bodyStart + 1
                while (j < lines.length) {
                    if (!lines[j].trim()) {
                        let look = j + 1
                        while (look < lines.length && !lines[look].trim()) {
                            look += 1
                        }
                        if (look < lines.length && isPipeRow(normalizeLineRow(lines[look])) && !isTableSeparatorRow(normalizeLineRow(lines[look]))) {
                            runEnd = look
                            j = look + 1
                        } else {
                            break
                        }
                    } else if (isPipeRow(normalizeLineRow(lines[j])) && !isTableSeparatorRow(normalizeLineRow(lines[j]))) {
                        runEnd = j
                        j += 1
                    } else {
                        break
                    }
                }

                out.push(normalized)
                out.push(buildTableSeparatorRow(normalized))

                for (let k = bodyStart; k <= runEnd; k += 1) {
                    if (lines[k].trim()) {
                        out.push(normalizeLineRow(lines[k]))
                    }
                }

                const afterLine = String(lines[j] ?? '').trim()

                if (afterLine) {
                    out.push('')
                }

                i = runEnd

                continue
            }
        }

        out.push(normalized)
    }

    return out.join('\n')
}

/** 渲染入口:Markdown 源文本 → 可安全注入 v-html 的 HTML(管线级单次注册保证) */
export function renderMarkdownHtml(source: string): string {
    ensurePipeline()

    const normalized = normalizeMarkdownForRendering(source)

    const withMath = renderInlineMath(renderBlockMath(normalized))

    const raw = marked.parse(withMath, { gfm: true, breaks: true }) as string

    return sanitizeHtml(raw)
}
