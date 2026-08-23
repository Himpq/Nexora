/**
 * toolFlow.ts — 工具行「执行流程」文案与分类(移植自原版 chat_tools.js)
 *
 * 职责:
 *   - buildChineseToolAction: 工具名 + 参数 → 中文动作标题(如「读取知识库信息 xxx」)
 *   - getToolExecutionFlowKind: 工具名 → 流程节点分类(file/shell/web/knowledge/...)
 *
 * 分支顺序、命名与原版保持一致,便于两端行为对齐与后续同步维护。
 */

/** 截断文本(超限加省略号,对齐原版 clipExecutionFlowText) */
export function clipExecutionFlowText(text: string, limit = 96): string {
    const value = String(text || '')

    if (value.length <= limit) {
        return value
    }

    return `${value.slice(0, Math.max(0, limit))}...`
}

/** 工具名归一化比较用压缩形式(去空白/下划线/连字符并小写) */
function compactToolName(toolName: string): string {
    return String(toolName || '').trim().replace(/[\s_-]+/g, '').toLowerCase()
}

function cleanExecutionFlowMarkdownValue(value: string): string {
    return String(value || '')
        .replace(/`/g, '')
        .replace(/\*\*/g, '')
        .trim()
}

/** 从结果 markdown 中按「Key: Value」行提取字段(对齐原版 extractMarkdownField) */
function extractMarkdownField(markdownText: string, fieldName: string): string {
    const name = String(fieldName || '').trim().toLowerCase()
    const lines = String(markdownText || '').split(/\r?\n/)

    for (const line of lines) {
        const idx = line.indexOf(':')

        if (idx <= 0) {
            continue
        }

        const key = line.slice(0, idx).replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim().toLowerCase()

        if (key === name) {
            return cleanExecutionFlowMarkdownValue(line.slice(idx + 1))
        }
    }

    return ''
}

/** 取结果 markdown 中第一个二级标题(对齐原版 extractMarkdownTitle) */
function extractMarkdownTitle(markdownText: string): string {
    const lines = String(markdownText || '').split(/\r?\n/)

    for (const line of lines) {
        const value = line.trim()

        if (value.startsWith('## ')) {
            return cleanExecutionFlowMarkdownValue(value.replace(/^#+\s*/, ''))
        }
    }

    return ''
}

/** 从参数对象中按候选键名取第一个非空值(对齐原版 readExecutionFlowArg) */
function readExecutionFlowArg(args: Record<string, unknown>, names: Array<string>): string {
    const source = args && typeof args === 'object' ? args : {}

    for (const name of names) {
        const value = source[name]

        if (value !== undefined && value !== null && String(value).trim()) {
            return String(value).trim()
        }
    }

    return ''
}

/** 路径取末段文件名(对齐原版 basenameForExecutionFlow) */
function basenameForExecutionFlow(value: string): string {
    const text = String(value || '').trim()

    if (!text) {
        return ''
    }

    const cleaned = text.replace(/^file:\/\//i, '')
    const parts = cleaned.split(/[\\/]+/).filter(Boolean)

    return parts.length > 0 ? parts[parts.length - 1] : cleaned
}

/** URL 取主机名(对齐原版 hostForExecutionFlow) */
function hostForExecutionFlow(value: string): string {
    const text = String(value || '').trim()

    if (!text) {
        return ''
    }

    try {
        const url = new URL(text)

        return url.hostname || text
    } catch {
        return text.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] || text
    }
}

type FlowPayload = Record<string, unknown> | Array<unknown> | null

/** 结果文本 → JSON 载荷(失败返回 null,对齐原版 parseExecutionFlowPayload) */
function parseExecutionFlowPayload(raw: unknown): FlowPayload {
    if (raw && typeof raw === 'object') {
        return raw as Record<string, unknown>
    }

    const text = String(raw || '').trim()

    if (!text) {
        return null
    }

    try {
        return JSON.parse(text) as FlowPayload
    } catch {
        return null
    }
}

/** 剥离工具结果的 success/result 包装层(对齐原版 unwrapExecutionFlowPayload) */
function unwrapExecutionFlowPayload(payload: FlowPayload): FlowPayload {
    const wrapperKeys = new Set([
        'success',
        'result',
        'error',
        'message',
        'traceback',
        'elapsed_ms',
        'duration_ms',
        'request_id',
    ])

    let current: unknown = payload

    for (let i = 0; i < 2; i += 1) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) {
            break
        }

        const record = current as Record<string, unknown>

        if (!Object.prototype.hasOwnProperty.call(record, 'result')) {
            break
        }

        const keys = Object.keys(record)
        const looksWrapped = keys.length > 0 && keys.every((key) => wrapperKeys.has(key))

        if (!looksWrapped) {
            break
        }

        const inner = record.result
        const parsedInner = parseExecutionFlowPayload(inner)

        current = parsedInner !== null ? parsedInner : inner
    }

    return current as FlowPayload
}

/** 计数值归一化(提取首个非负整数,对齐原版 normalizeExecutionFlowCount) */
function normalizeExecutionFlowCount(value: unknown): number | null {
    if (value === undefined || value === null || value === '') {
        return null
    }

    const match = String(value).replace(/,/g, '').match(/\d+/)
    const count = match ? Number.parseInt(match[0], 10) : Number.NaN

    return Number.isFinite(count) && count >= 0 ? count : null
}

/** 按点路径读取载荷字段(对齐原版 readExecutionFlowPayloadPath) */
function readExecutionFlowPayloadPath(payload: unknown, path: string): unknown {
    const parts = String(path || '').split('.').filter(Boolean)
    let current: unknown = payload

    for (const part of parts) {
        if (!current || typeof current !== 'object') {
            return undefined
        }

        current = (current as Record<string, unknown>)[part]
    }

    return current
}

/** 从载荷中按数字键/数组键提取条数(对齐原版 readExecutionFlowPayloadCount) */
function readExecutionFlowPayloadCount(payload: FlowPayload, numberKeys: Array<string>, arrayKeys: Array<string>): number | null {
    const data = unwrapExecutionFlowPayload(payload)

    if (Array.isArray(data)) {
        return data.length
    }

    if (!data || typeof data !== 'object') {
        return null
    }

    for (const key of numberKeys) {
        const count = normalizeExecutionFlowCount(readExecutionFlowPayloadPath(data, key))

        if (count !== null) {
            return count
        }
    }

    for (const key of arrayKeys) {
        const value = readExecutionFlowPayloadPath(data, key)

        if (Array.isArray(value)) {
            return value.length
        }
    }

    return null
}

/** 从结果 markdown/载荷中提取条数(对齐原版 readExecutionFlowResultCount) */
function readExecutionFlowResultCount(
    markdownText: string,
    resultText: string,
    markdownFields: Array<string>,
    numberKeys: Array<string>,
    arrayKeys: Array<string>
): number | null {
    const fields = Array.isArray(markdownFields) ? markdownFields : []

    for (const field of fields) {
        const count = normalizeExecutionFlowCount(extractMarkdownField(markdownText, field))

        if (count !== null) {
            return count
        }
    }

    return readExecutionFlowPayloadCount(parseExecutionFlowPayload(resultText), numberKeys, arrayKeys)
}

/** 从结果 markdown 字段或载荷路径提取文本(对齐原版 readExecutionFlowResultText) */
function readExecutionFlowResultText(
    markdownText: string,
    resultText: string,
    markdownFields: Array<string>,
    payloadPaths: Array<string>
): string {
    const fields = Array.isArray(markdownFields) ? markdownFields : []

    for (const field of fields) {
        const value = extractMarkdownField(markdownText, field)

        if (value) {
            return value
        }
    }

    const data = unwrapExecutionFlowPayload(parseExecutionFlowPayload(resultText))
    const paths = Array.isArray(payloadPaths) ? payloadPaths : []

    for (const path of paths) {
        const value = readExecutionFlowPayloadPath(data, path)

        if (value !== undefined && value !== null && String(value).trim()) {
            return String(value).trim()
        }
    }

    return ''
}

/** 标题追加条数后缀(对齐原版 appendExecutionFlowCount) */
function appendExecutionFlowCount(text: string, count: number | null, unit: string): string {
    return count !== null ? `${text} 获取到${count}${unit}` : text
}

/**
 * 工具名 + 参数 → 中文动作标题(对齐原版 buildChineseToolAction 的分支顺序)
 *
 * @param toolName    原始工具名
 * @param args        调用参数对象(JSON 解析后的 arguments)
 * @param markdownText 结果展示 markdown(用于文件补丁等标题识别)
 * @param resultText  结果原文(用于邮件主题等兜底提取)
 */
export function buildChineseToolAction(
    toolName: string,
    args: Record<string, unknown> = {},
    markdownText = '',
    resultText = ''
): string {
    const compact = compactToolName(toolName)
    const markdown = String(markdownText || '')
    const result = String(resultText || '')

    const fileFromMarkdown = extractMarkdownField(markdown, 'File')
    const commandFromMarkdown = extractMarkdownField(markdown, 'Command')
    const title = extractMarkdownTitle(markdown)

    const path = readExecutionFlowArg(args, ['path', 'file', 'file_path', 'filepath', 'sandbox_path', 'target_path'])
    const url = readExecutionFlowArg(args, ['url', 'href', 'page_url'])
    const query = readExecutionFlowArg(args, ['query', 'keyword', 'q'])
    const command = readExecutionFlowArg(args, ['command', 'cmd']) || commandFromMarkdown
    const objectTitle = readExecutionFlowArg(args, ['title', 'name', 'key'])

    const fileName = basenameForExecutionFlow(fileFromMarkdown || path)
    const urlHost = hostForExecutionFlow(url)

    if (compact === 'memoryprofileread' || compact === 'getuserprofilememory' || compact === 'memoryread') {
        return '读取用户画像'
    }

    if (compact.includes('memory') && (compact.includes('update') || compact.includes('write') || compact.includes('append'))) {
        return '写入用户画像'
    }

    if (compact.includes('localfileprobe') || /local file probe/i.test(title)) {
        return fileName ? `探测文件 ${fileName}` : '探测文件'
    }

    if (compact.includes('filecreate')) {
        return fileName ? `创建文件 ${fileName}` : '创建文件'
    }

    if (compact.includes('fileread') || /file read/i.test(title)) {
        return fileName ? `读取文件 ${fileName}` : '读取文件'
    }

    if (compact.includes('filewrite') || /file written/i.test(title)) {
        return fileName ? `写入文件 ${fileName}` : '写入文件'
    }

    if (compact.includes('filepatch') || /file patch preview|file modified/i.test(title)) {
        if (/preview/i.test(title) || /preview_id/i.test(result)) {
            return fileName ? `预览文件修改 ${fileName}` : '预览文件修改'
        }

        return fileName ? `写入文件 ${fileName}` : '写入文件'
    }

    if (compact.includes('filelist')) {
        return fileName ? `读取目录 ${fileName}` : '读取目录'
    }

    if (compact.includes('filefind') || compact.includes('filesearch')) {
        return fileName ? `查找文件 ${fileName}` : '查找文件'
    }

    if (compact.includes('fileremove') || compact.includes('filedelete')) {
        return fileName ? `删除文件 ${fileName}` : '删除文件'
    }

    if (compact.includes('browserpageopen') || compact.includes('webrender') || compact.includes('openpage')) {
        return urlHost ? `打开网页 ${urlHost}` : '打开网页'
    }

    if (compact.includes('browserpageread') || compact.includes('webgetcontent') || compact.includes('readpage')) {
        return urlHost ? `读取网页 ${urlHost}` : '读取网页'
    }

    if (compact.includes('browserpageclick') || compact.includes('webclick')) {
        return '点击网页元素'
    }

    if (compact.includes('browserpageinput') || compact.includes('webinput')) {
        return '输入网页内容'
    }

    if (compact.includes('browserpageeval') || compact.includes('webexecjs')) {
        return '执行网页脚本'
    }

    if (compact.includes('browserpagescroll')) {
        return '滚动网页'
    }

    if (compact.includes('browserpagelist')) {
        return '读取浏览器页面'
    }

    if (compact.includes('shell') || compact.includes('terminal')) {
        return command ? `执行命令 ${clipExecutionFlowText(command, 34)}` : '执行命令'
    }

    if (compact.includes('websearch') || compact.includes('searchkeyword') || compact === 'websearchmeta') {
        return query ? `搜索网页 ${clipExecutionFlowText(query, 34)}` : '搜索网页'
    }

    if (compact.includes('imagesearch')) {
        return query ? `搜索图片 ${clipExecutionFlowText(query, 34)}` : '搜索图片'
    }

    if (compact.includes('generateimage')) {
        return '生成图片'
    }

    if (compact.includes('contextcompression')) {
        return '压缩上下文'
    }

    if (compact.includes('contextread') || compact === 'getcontext') {
        return '读取长上下文'
    }

    if (compact.includes('contextclear') || compact === 'clearcontext') {
        return '清理上下文'
    }

    if (compact === 'knowledgelist') {
        const count = readExecutionFlowResultCount(
            markdown,
            result,
            ['Total', 'Results', 'Items'],
            ['total', 'count', 'results'],
            ['items', 'results']
        )

        return appendExecutionFlowCount('读取知识库信息', count, '条信息')
    }

    if (compact.includes('knowledgegraphread')) {
        return '读取知识图谱'
    }

    if (compact.includes('knowledgesearch') || compact.includes('searchknowledge')) {
        const count = readExecutionFlowResultCount(
            markdown,
            result,
            ['Results', 'Matched', 'Total', 'Articles', 'Returned'],
            ['results', 'matched', 'total', 'returned', 'count'],
            ['items', 'matches', 'articles', 'results']
        )
        const base = query ? `搜索知识库 ${clipExecutionFlowText(query, 34)}` : '搜索知识库'

        return appendExecutionFlowCount(base, count, '条信息')
    }

    if (compact.includes('knowledgebasisread')) {
        const count = readExecutionFlowResultCount(
            markdown,
            result,
            ['Matched', 'Results', 'Total'],
            ['matched', 'total', 'count'],
            ['matches', 'items', 'results']
        )

        if (count !== null && (/knowledge content matches/i.test(title) || /Matched:/i.test(markdown))) {
            return appendExecutionFlowCount('读取知识库信息', count, '条信息')
        }

        return objectTitle ? `读取知识库信息 ${clipExecutionFlowText(objectTitle, 34)}` : '读取知识库信息'
    }

    if (compact.includes('knowledge') && (compact.includes('create') || compact.includes('update') || compact.includes('delete') || compact.includes('link'))) {
        return objectTitle ? `写入知识库 ${clipExecutionFlowText(objectTitle, 34)}` : '写入知识库'
    }

    const isMailTool = compact.includes('email') || compact.includes('mail')

    if (isMailTool && compact.includes('send')) {
        const subject = readExecutionFlowArg(args, ['subject', 'title'])
            || readExecutionFlowResultText(markdown, result, ['Subject', 'Title'], ['subject', 'title'])

        return subject ? `发送邮件 ${clipExecutionFlowText(subject, 34)}` : '发送邮件'
    }

    if (isMailTool && compact.includes('list')) {
        const count = readExecutionFlowResultCount(
            markdown,
            result,
            ['Total', 'Results', 'Mails', 'Emails'],
            ['total', 'count', 'results'],
            ['mails', 'emails', 'items']
        )

        return appendExecutionFlowCount('读取邮件', count, '封邮件')
    }

    if (isMailTool && (compact.includes('get') || compact.includes('read'))) {
        const mailTitle = readExecutionFlowResultText(
            markdown,
            result,
            ['Subject', 'Title'],
            ['mail.subject', 'mail.title', 'subject', 'title']
        )
        const mailId = readExecutionFlowArg(args, ['mail_id', 'id'])
        const label = mailTitle || mailId

        return label ? `读取邮件内容 打开邮件 ${clipExecutionFlowText(label, 42)}` : '读取邮件内容'
    }

    if (compact.includes('read') || compact.includes('get') || compact.includes('list')) {
        return '读取信息'
    }

    if (compact.includes('write') || compact.includes('update') || compact.includes('create') || compact.includes('delete') || compact.includes('save')) {
        return '写入信息'
    }

    if (compact.includes('search') || compact.includes('find')) {
        return '搜索信息'
    }

    return '执行工具'
}

/**
 * 工具名 → 流程节点分类(决定节点配色,对齐原版 getToolExecutionFlowKind):
 * error/file/shell/web/browser/context/image/knowledge/tool
 */
export function getToolExecutionFlowKind(toolName: string): string {
    const compact = compactToolName(toolName)

    if (!compact) {
        return 'tool'
    }

    if (compact.includes('error')) {
        return 'error'
    }

    if (compact.includes('file') || compact.includes('patch')) {
        return 'file'
    }

    if (compact.includes('shell') || compact.includes('terminal') || compact.includes('exec')) {
        return 'shell'
    }

    if (compact.includes('search') || compact.includes('web')) {
        return 'web'
    }

    if (compact.includes('browser') || compact.includes('page')) {
        return 'browser'
    }

    if (compact.includes('context') || compact.includes('compression')) {
        return 'context'
    }

    if (compact.includes('image')) {
        return 'image'
    }

    if (compact.includes('knowledge') || compact.includes('memory')) {
        return 'knowledge'
    }

    return 'tool'
}

/** 地图类工具名集合(对齐原版 isMapToolName) */
const MAP_TOOL_NAMES = new Set([
    'map_render',
    'maprenderscene',
    'maprender',
    'map_render_scene',
    'map_calc_distance',
    'mapcalcdistance',
    'map_calc_straight_distance',
    'map_calc_route',
    'mapcalcroute',
    'map_route_plan',
    'map_geocode',
    'mapgeocode',
    'map_poi_search',
    'mappoisearch',
    'map_search_place',
])

export function isMapToolName(name: string): boolean {
    const compact = String(name || '').trim().replace(/[\s-]/g, '_').toLowerCase()

    return MAP_TOOL_NAMES.has(compact)
}

/** 读取地图结果 ID(对齐原版 readMapResultId) */
function readMapResultId(payload: Record<string, unknown>): string {
    return String(
        payload.map_id
            || payload.mapId
            || payload.render_id
            || payload.renderId
            || payload.record_id
            || payload.recordId
            || ''
    ).trim()
}

/**
 * 地图结果 → 可渲染 markdown:
 * 优先 payload.markdown;scene 对象转 ```nexora-map 围栏;
 * 否则按 map_id+conversation_id 组装 ```nexora-map-ref 围栏(对齐原版 buildMapResultMarkdown)。
 */
export function buildMapResultMarkdown(
    payload: Record<string, unknown>,
    currentConversationId = ''
): string {
    const markdown = String(payload.markdown || '').trim()

    if (markdown) {
        return markdown
    }

    if (payload.scene && typeof payload.scene === 'object' && !Array.isArray(payload.scene)) {
        return `\`\`\`nexora-map\n${JSON.stringify(payload.scene, null, 4)}\n\`\`\``
    }

    const mapId = readMapResultId(payload)
    const conversationId = String(payload.conversation_id || payload.conversationId || currentConversationId || '').trim()

    if (!mapId || !conversationId) {
        return ''
    }

    const title = String(payload.title || '地图').trim() || '地图'
    const mapRef = {
        type: 'nexora-map-ref',
        mapId,
        map_id: mapId,
        renderId: mapId,
        conversationId,
        conversation_id: conversationId,
        title,
    }

    return `\`\`\`nexora-map-ref\n${JSON.stringify(mapRef, null, 4)}\n\`\`\``
}

/** 去掉结果 markdown 的 "### Scene" 段(工具输出面板不展示原始场景 JSON) */
export function stripMapSceneSection(markdownText: string): string {
    const source = String(markdownText || '').trim()
    const match = source.match(/(?:^|\n)### Scene(?:\n|$)/)

    if (!match) {
        return source
    }

    return source.slice(0, match.index).trim()
}
