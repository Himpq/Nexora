/**
 * knowledge-collab.ts — 知识库在线协作客户端
 *
 * 移植自 ChatDBServer/static/js/knowledge_collab_client.js,
 * IIFE → ES Module,协议与后端 KnowledgeCollabHub 完全对齐
 * (/ws/knowledge/collab/<username>/<share_id>,flask-sock)。
 *
 * 框架无关:通过回调契约接入宿主编辑器(Toast UI v3.2.2 的 ProseMirror),
 * 本地编辑 diff 出字符级 operation,与远端 op 做双向 transform,
 * 增量应用失败时回退全量替换并校验 content_hash 强制定期重连。
 */

/** 字符级文本操作(服务端与客户端共用的 OT 操作) */
export interface TextOperation {
    start: number
    delete_count: number
    insert_text: string
    op_id?: string
}

/** 光标信息(offset 为主键,line/col 为兼容冗余) */
export interface CursorInfo {
    offset: number
    line: number
    col: number
    anchor?: number
}

/** 协作成员(由服务端 members 广播) */
export interface CollabMember {
    client_id: string
    role: string
    display_name: string
    cursor: CursorInfo | null
    connected_at: number
}

/** setText 的应用元数据 */
export interface SetTextMeta {
    source?: 'snapshot' | 'remote_op'
    operation?: TextOperation
}

/** 协作客户端回调契约 */
export interface KnowledgeCollabClientOptions {
    wsUrl?: string
    getText?: () => string
    /** 应用远端文本;返回 true 表示增量应用成功(编辑器未全量替换) */
    setText?: (value: string, meta?: SetTextMeta) => boolean
    getCursorOffset?: () => number
    getCursorAnchor?: () => number
    setCursorOffset?: (cursor: CursorInfo) => void
    renderMembers?: (members: CollabMember[], selfId: string) => void
    renderCursors?: (members: CollabMember[], selfId: string) => void
    notifyPresence?: (member: CollabMember, action: 'join' | 'leave') => void
    onConnectionChange?: (connected: boolean) => void
    setStatus?: (kind: 'ok' | 'saving' | 'error', text: string) => void
}

export interface KnowledgeCollabClient {
    start: () => void
    stop: () => void
    notifyLocalChange: () => boolean
    flushNow: () => void
    sendCursorNow: () => boolean
    scheduleCursorSend: () => void
    isActive: () => boolean
    isApplyingRemote: () => boolean
    getClientId: () => string
}

export interface CursorOverlay {
    render: (members: CollabMember[], selfId: string) => void
    clear: () => void
    reposition: () => void
}

export interface CursorOverlayOptions {
    getEditor?: () => unknown
    getHost?: () => HTMLElement | null
    getColor?: (clientId: string) => string
    getName?: (member: CollabMember) => string
}

export interface OfflineMask {
    show: (message?: string) => void
    hide: () => void
}

/** 服务端推送消息的最小结构 */
interface ServerMessage {
    type?: string
    client_id?: string
    revision?: number
    content?: string
    content_hash?: string
    members?: CollabMember[]
    saved?: boolean
    message?: string
    op?: TextOperation
    cursor?: CursorInfo | null
}

/** ProseMirror 文档节点最小结构(collab 仅需文本与行数) */
interface PmNode {
    childCount: number
    textContent: string
    nodeSize: number
    content: { size: number; constructor: unknown }
    child(index: number): PmNode
}

interface PmDoc extends PmNode {
    resolve(pos: number): unknown
    slice(from: number, to: number): unknown
}

interface PmSelection {
    from: number
    head: number
    anchor: number
    constructor: { near($pos: unknown): unknown } | undefined
}

interface PmTr {
    setSelection(selection: unknown): PmTr
    setMeta(key: string, value: unknown): PmTr
    insertText(text: string, from: number, to: number): PmTr
    replaceRange(from: number, to: number, slice: unknown): PmTr
}

interface PmSchema {
    nodes: { paragraph?: { create(attrs: unknown, content?: unknown): unknown } }
    text(text: string): unknown
}

/** Toast UI v3 md 编辑器内部 ProseMirror 视图最小结构 */
interface PmView {
    state: {
        doc: PmDoc
        selection: PmSelection
        schema: PmSchema
        tr: PmTr
    }
    dispatch(tr: unknown): void
    coordsAtPos(pos: number): { left: number; top: number; right: number; bottom: number }
}

/** 客户端内部状态 */
interface ClientState {
    socket: WebSocket | null
    clientId: string
    revision: number
    textShadow: string
    active: boolean
    closedByClient: boolean
    localTimer: number
    cursorTimer: number
    pingTimer: number
    reconnectTimer: number
    pendingOp: TextOperation | null
    applyingRemote: boolean
    memberIds: Set<string> | null
    memberInfo: Record<string, CollabMember>
}

/** 光标 overlay 内部状态 */
interface OverlayState {
    layer: HTMLDivElement | null
    lastMembers: CollabMember[]
    selfId: string
    raf: number
    boundScroller: EventTarget | null
}

// ---------- 纯函数工具 ----------

function clampIndex(value: unknown, text: string): number {
    const length = String(text || '').length
    const index = Number.isFinite(Number(value)) ? Number(value) : 0

    return Math.max(0, Math.min(length, Math.floor(index)))
}

/** 计算 before → after 的最小字符级替换操作,无差异返回 null */
export function buildReplaceOperation(before: unknown, after: unknown): TextOperation | null {
    const oldText = String(before || '')
    const newText = String(after || '')

    if (oldText === newText) {
        return null
    }

    let start = 0
    const oldLength = oldText.length
    const newLength = newText.length

    while (start < oldLength && start < newLength && oldText[start] === newText[start]) {
        start += 1
    }

    let oldEnd = oldLength
    let newEnd = newLength

    while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
        oldEnd -= 1
        newEnd -= 1
    }

    return {
        start,
        delete_count: oldEnd - start,
        insert_text: newText.slice(start, newEnd),
    }
}

/** 在文本上应用字符级操作 */
export function applyOperation(text: unknown, operation: TextOperation | null | undefined): string {
    const source = String(text || '')
    const op: Partial<TextOperation> = operation && typeof operation === 'object' ? operation : {}
    const start = clampIndex(op.start, source)
    const deleteCount = Math.max(0, Number(op.delete_count || 0))
    const end = Math.min(source.length, start + deleteCount)
    const insertText = String(op.insert_text || '')

    return source.slice(0, start) + insertText + source.slice(end)
}

/** 变换单个 offset(经过一次已提交操作,插入点是否落到插入之后) */
function transformOffset(offset: unknown, operation: TextOperation | null | undefined, preferAfterInsert: boolean): number {
    const op: Partial<TextOperation> = operation && typeof operation === 'object' ? operation : {}
    const start = Math.max(0, Number(op.start || 0))
    const deleteCount = Math.max(0, Number(op.delete_count || 0))
    const insertLength = String(op.insert_text || '').length
    const end = start + deleteCount
    const value = Math.max(0, Number(offset || 0))

    if (value < start) {
        return value
    }

    if (value > end) {
        return Math.max(0, value + insertLength - deleteCount)
    }

    if (value === start && preferAfterInsert) {
        return start + insertLength
    }

    return start
}

/** 构造缺省成员(仅剩 client_id 时的退出播报兜底) */
function defaultMember(clientId: string): CollabMember {
    return {
        client_id: clientId,
        role: '',
        display_name: clientId,
        cursor: null,
        connected_at: 0,
    }
}

/** 变换一次待应用操作(经过一次已提交操作) */
function transformOperation(
    operation: TextOperation,
    committed: TextOperation | null | undefined,
    preferAfterInsert: boolean
): TextOperation {
    const op = { ...(operation || {}) }
    const start = Math.max(0, Number(op.start || 0))
    const end = start + Math.max(0, Number(op.delete_count || 0))
    const nextStart = transformOffset(start, committed, !!preferAfterInsert)
    const nextEnd = transformOffset(end, committed, !!preferAfterInsert)

    op.start = Math.max(0, nextStart)
    op.delete_count = Math.max(0, nextEnd - nextStart)

    return op
}

/** offset → { offset, line, col } */
export function offsetToLineCol(text: unknown, offset: unknown): CursorInfo {
    const source = String(text || '')
    const safeOffset = clampIndex(offset, source)
    const before = source.slice(0, safeOffset)
    const lines = before.split('\n')

    return {
        offset: safeOffset,
        line: Math.max(0, lines.length - 1),
        col: Math.max(0, String(lines[lines.length - 1] || '').length),
    }
}

// ---------- Toast UI v3(ProseMirror)助手 ----------
// v3 的 markdown 模式下文档结构为"每行一个段落节点",
// 因此文本 offset 与 PM pos 的换算关系为 pos = offset + line + 1。

function getToastMarkdownView(editor: unknown): PmView | null {
    const raw = (editor && typeof editor === 'object' ? editor : null) as { mdEditor?: { view?: unknown } } | null
    const view = raw?.mdEditor?.view ?? null

    return view && typeof view === 'object' ? (view as PmView) : null
}

function getToastViewText(view: PmView): string {
    // 注意:不能用 doc.textBetween(0, size, '\n')——空段落不会产生分隔符,
    // 连续空行会被折叠,导致 offset 计算和增量校验全部失准。
    const doc = view.state.doc
    const lines: string[] = []

    for (let i = 0; i < doc.childCount; i += 1) {
        lines.push(String(doc.child(i).textContent || ''))
    }

    return lines.join('\n')
}

function pmPosToTextOffset(view: PmView, pos: number): number {
    const doc = view.state.doc
    const target = Math.max(0, Number(pos) || 0)
    let offset = 0
    let consumed = 0

    for (let i = 0; i < doc.childCount; i += 1) {
        const child = doc.child(i)
        const textLength = String(child.textContent || '').length

        if (target <= consumed) {
            return offset
        }

        if (target <= consumed + 1 + textLength) {
            return offset + Math.max(0, Math.min(textLength, target - consumed - 1))
        }

        offset += textLength + 1
        consumed += child.nodeSize
    }

    return Math.max(0, offset - 1)
}

function lineColToPmPos(view: PmView, line: number, col: number): number {
    const doc = view.state.doc

    if (!doc.childCount) {
        return 0
    }

    const target = Math.max(0, Math.min(Math.floor(Number(line) || 0), doc.childCount - 1))
    let pos = 0

    for (let i = 0; i < target; i += 1) {
        pos += doc.child(i).nodeSize
    }

    const node = doc.child(target)

    return pos + 1 + Math.max(0, Math.min(Math.floor(Number(col) || 0), node.content.size))
}

function textOffsetToPmPos(view: PmView, text: string, offset: number): number {
    const lineCol = offsetToLineCol(text, offset)

    return lineColToPmPos(view, lineCol.line, lineCol.col)
}

/** 读取光标与选区锚点(文本 offset) */
export function getToastSelectionOffsets(editor: unknown): { head: number; anchor: number } {
    const view = getToastMarkdownView(editor)

    if (!view) {
        return { head: 0, anchor: 0 }
    }

    try {
        const selection = view.state.selection
        const head = pmPosToTextOffset(view, Number(selection.head || selection.from || 0))
        const anchor = pmPosToTextOffset(view, Number(selection.anchor || selection.from || 0))

        return { head, anchor }
    } catch {
        return { head: 0, anchor: 0 }
    }
}

/** 设置光标位置(不 focus/不滚动,避免拉扯本地滚动位置) */
export function setToastCursorOffset(editor: unknown, offset: number): boolean {
    const view = getToastMarkdownView(editor)

    if (!view) {
        return false
    }

    try {
        const text = getToastViewText(view)
        const pos = textOffsetToPmPos(view, text, clampIndex(offset, text))
        const $pos = view.state.doc.resolve(pos)
        const SelectionCtor = view.state.selection.constructor

        if (!SelectionCtor || typeof SelectionCtor.near !== 'function') {
            return false
        }

        view.dispatch(view.state.tr.setSelection(SelectionCtor.near($pos)).setMeta('addToHistory', false))

        return true
    } catch {
        return false
    }
}

// ---------- 远程光标 overlay ----------

export function createToastCursorOverlay(options: CursorOverlayOptions): CursorOverlay {
    const opts: CursorOverlayOptions = options && typeof options === 'object' ? options : {}
    const overlayState: OverlayState = {
        layer: null,
        lastMembers: [],
        selfId: '',
        raf: 0,
        boundScroller: null,
    }

    function getView(): PmView | null {
        const editor = typeof opts.getEditor === 'function' ? opts.getEditor() : null

        return getToastMarkdownView(editor)
    }

    function getHost(): HTMLElement | null {
        return typeof opts.getHost === 'function' ? opts.getHost() : null
    }

    function ensureLayer(host: HTMLElement): HTMLDivElement {
        if (overlayState.layer && overlayState.layer.parentNode === host) {
            return overlayState.layer
        }

        if (overlayState.layer && overlayState.layer.parentNode) {
            overlayState.layer.remove()
        }

        if (window.getComputedStyle(host).position === 'static') {
            host.style.position = 'relative'
        }

        let layer = host.querySelector(':scope > .knowledge-collab-cursor-overlay-layer') as HTMLDivElement | null

        if (!layer) {
            layer = document.createElement('div')
            layer.className = 'knowledge-collab-cursor-overlay-layer'
            host.appendChild(layer)
        }

        overlayState.layer = layer

        return layer
    }

    function scheduleReposition(): void {
        if (overlayState.raf) {
            return
        }

        overlayState.raf = window.requestAnimationFrame(() => {
            overlayState.raf = 0
            render(overlayState.lastMembers, overlayState.selfId)
        })
    }

    function bindScroll(host: HTMLElement): void {
        if (overlayState.boundScroller === host) {
            return
        }

        overlayState.boundScroller = host

        // capture 捕获 host 内任意后代滚动(ProseMirror 或其父容器)
        host.addEventListener('scroll', scheduleReposition, { passive: true, capture: true })
    }

    function createWidget(member: CollabMember): HTMLSpanElement {
        const widget = document.createElement('span')
        widget.className = 'knowledge-collab-cursor-bookmark'

        if (typeof opts.getColor === 'function') {
            widget.style.setProperty('--knowledge-collab-color', opts.getColor(member.client_id))
        }

        widget.innerHTML = [
            '<span class="knowledge-collab-cursor-line"></span>',
            '<span class="knowledge-collab-cursor-label"></span>',
        ].join('')

        const label = widget.querySelector('.knowledge-collab-cursor-label')

        if (label) {
            label.textContent = typeof opts.getName === 'function' ? String(opts.getName(member) || '协作者') : '协作者'
        }

        return widget
    }

    function appendSelectionRects(
        layer: HTMLDivElement,
        layerRect: DOMRect,
        view: PmView,
        text: string,
        member: CollabMember,
        from: number,
        to: number
    ): void {
        const color = typeof opts.getColor === 'function' ? opts.getColor(member.client_id) : '#2563eb'
        const lines = text.split('\n')
        const startLC = offsetToLineCol(text, Math.min(from, to))
        const endLC = offsetToLineCol(text, Math.max(from, to))
        // 超长选区截断,避免渲染卡顿
        const lastLine = Math.min(endLC.line, startLC.line + 200)

        for (let line = startLC.line; line <= lastLine; line += 1) {
            const lineText = String(lines[line] || '')
            const colStart = line === startLC.line ? startLC.col : 0
            const colEnd = line === endLC.line ? endLC.col : lineText.length
            let a: { left: number; top: number; right: number; bottom: number } | null = null
            let b: { left: number; top: number; right: number; bottom: number } | null = null

            try {
                a = view.coordsAtPos(lineColToPmPos(view, line, colStart))
                b = view.coordsAtPos(lineColToPmPos(view, line, colEnd))
            } catch {
                continue
            }

            const rect = document.createElement('span')
            rect.className = 'knowledge-collab-selection-rect'
            rect.style.setProperty('--knowledge-collab-color', color)

            if (Math.abs(a.top - b.top) < 2) {
                // 同一视觉行:精确矩形
                rect.style.left = `${Math.min(a.left, b.left) - layerRect.left}px`
                rect.style.top = `${a.top - layerRect.top}px`
                rect.style.width = `${Math.max(4, Math.abs(b.left - a.left))}px`
                rect.style.height = `${Math.max(12, a.bottom - a.top)}px`
            } else {
                // 该行发生了自动换行:整块覆盖该逻辑行的可视区域
                rect.style.left = '0'
                rect.style.top = `${Math.min(a.top, b.top) - layerRect.top}px`
                rect.style.width = `${Math.max(4, layerRect.width)}px`
                rect.style.height = `${Math.max(12, Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top))}px`
            }

            layer.appendChild(rect)
        }
    }

    function render(members: CollabMember[], selfId: string): void {
        overlayState.lastMembers = Array.isArray(members) ? members : []
        overlayState.selfId = String(selfId || '')

        const view = getView()
        const host = getHost()

        if (!view || !host) {
            clear()

            return
        }

        bindScroll(host)

        const layer = ensureLayer(host)
        layer.innerHTML = ''

        const text = getToastViewText(view)
        const layerRect = layer.getBoundingClientRect()

        overlayState.lastMembers.forEach((member) => {
            const clientId = String((member && member.client_id) || '').trim()
            const cursor = member && member.cursor && typeof member.cursor === 'object' ? member.cursor : null

            if (!clientId || clientId === overlayState.selfId || !cursor) {
                return
            }

            const offset = cursor.offset !== undefined
                ? clampIndex(cursor.offset, text)
                : clampIndex(
                    text.split('\n').slice(0, Math.max(0, Number(cursor.line || 0))).join('\n').length
                    + (Number(cursor.line || 0) > 0 ? 1 : 0)
                    + Math.max(0, Number(cursor.col || 0)),
                    text
                )

            // 选区高亮(anchor 与光标不重合时)
            const anchor = cursor.anchor !== undefined && cursor.anchor !== null
                ? clampIndex(cursor.anchor, text)
                : offset

            if (anchor !== offset) {
                appendSelectionRects(layer, layerRect, view, text, member, anchor, offset)
            }

            let coords: { left: number; top: number; right: number; bottom: number } | null = null

            try {
                coords = view.coordsAtPos(textOffsetToPmPos(view, text, offset))
            } catch {
                return
            }

            const widget = createWidget(member)
            widget.style.left = `${Number(coords.left || 0) - layerRect.left}px`
            widget.style.top = `${Number(coords.top || 0) - layerRect.top}px`

            const caret = widget.querySelector<HTMLElement>('.knowledge-collab-cursor-line')
            const caretHeight = Math.max(12, Number(coords.bottom || 0) - Number(coords.top || 0))

            if (caret) {
                caret.style.top = '0'
                caret.style.height = `${caretHeight}px`
            }

            layer.appendChild(widget)
        })
    }

    function clear(): void {
        overlayState.lastMembers = []

        if (overlayState.layer) {
            overlayState.layer.innerHTML = ''
        }
    }

    return { render, clear, reposition: scheduleReposition }
}

// ---------- 离线遮罩 ----------

export function createOfflineMask(getHost: () => HTMLElement | null): OfflineMask {
    let mask: HTMLDivElement | null = null

    return {
        show(message) {
            const host = typeof getHost === 'function' ? getHost() : null

            if (!host) {
                return
            }

            if (window.getComputedStyle(host).position === 'static') {
                host.style.position = 'relative'
            }

            if (!mask || mask.parentNode !== host) {
                if (mask) {
                    mask.remove()
                }

                mask = document.createElement('div')
                mask.className = 'knowledge-collab-offline-mask'
                mask.innerHTML = '<div class="knowledge-collab-offline-tip"></div>'
                host.appendChild(mask)
            }

            const tip = mask.querySelector('.knowledge-collab-offline-tip')

            if (tip) {
                tip.textContent = String(message || '实时协作已断开,正在重连…')
            }
        },
        hide() {
            if (mask) {
                mask.remove()
                mask = null
            }
        },
    }
}

// ---------- 协作客户端 ----------

export function createClient(options: KnowledgeCollabClientOptions): KnowledgeCollabClient {
    const opts: KnowledgeCollabClientOptions = options && typeof options === 'object' ? options : {}
    const state: ClientState = {
        socket: null,
        clientId: '',
        revision: 0,
        textShadow: '',
        active: false,
        closedByClient: false,
        localTimer: 0,
        cursorTimer: 0,
        pingTimer: 0,
        reconnectTimer: 0,
        pendingOp: null,
        applyingRemote: false,
        memberIds: null,
        memberInfo: {},
    }

    function getText(): string {
        return String(typeof opts.getText === 'function' ? opts.getText() : '')
    }

    function setText(value: string, meta?: SetTextMeta): boolean | undefined {
        if (typeof opts.setText !== 'function') {
            return undefined
        }

        state.applyingRemote = true

        try {
            return opts.setText(String(value || ''), meta || {})
        } finally {
            // 全量替换(setMarkdown)触发的 change 事件在下一轮事件循环才到达,
            // 释放过早会导致本地回发已应用的远端内容,与远端互踢造成无限风暴。
            // 对齐原版宿主 120ms 的窗口期。
            window.setTimeout(() => {
                state.applyingRemote = false
            }, 120)
        }
    }

    function setStatus(kind: 'ok' | 'saving' | 'error', text: string): void {
        if (typeof opts.setStatus === 'function') {
            opts.setStatus(kind, text)
        }
    }

    function renderMembers(members: CollabMember[], selfId: string): void {
        const list = Array.isArray(members) ? members : []
        const currentSelfId = selfId || state.clientId

        // 成员进出播报(首次快照不播报存量成员)
if (typeof opts.notifyPresence === 'function') {
            const ids = new Set(list.map((m) => String((m && m.client_id) || '')).filter(Boolean))
            const memberIds = state.memberIds

            if (memberIds) {
                list.forEach((member) => {
                    const id = String((member && member.client_id) || '')

                    if (id && id !== currentSelfId && !memberIds.has(id)) {
                        opts.notifyPresence!(member, 'join')
                    }
                })

                memberIds.forEach((id) => {
                    if (id && id !== currentSelfId && !ids.has(id)) {
                        opts.notifyPresence!(state.memberInfo[id] || defaultMember(id), 'leave')
                    }
                })
            }

            state.memberIds = ids
            state.memberInfo = {}
            list.forEach((member) => {
                state.memberInfo[String((member && member.client_id) || '')] = member
            })
        }

        if (typeof opts.renderMembers === 'function') {
            opts.renderMembers(list, currentSelfId)
        }

        if (typeof opts.renderCursors === 'function') {
            opts.renderCursors(list, currentSelfId)
        }
    }

    function getCursorOffset(): number {
        if (typeof opts.getCursorOffset === 'function') {
            return clampIndex(opts.getCursorOffset(), getText())
        }

        return 0
    }

    function setCursorOffset(offset: number): void {
        if (typeof opts.setCursorOffset === 'function') {
            opts.setCursorOffset(offsetToLineCol(getText(), offset))
        }
    }

    function getCursorPayload(): CursorInfo {
        const text = getText()
        const payload = offsetToLineCol(text, getCursorOffset())

        if (typeof opts.getCursorAnchor === 'function') {
            payload.anchor = clampIndex(opts.getCursorAnchor(), text)
        }

        return payload
    }

    function send(payload: Record<string, unknown>): boolean {
        if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
            return false
        }

        state.socket.send(JSON.stringify(payload && typeof payload === 'object' ? payload : {}))

        return true
    }

    function scheduleReconnect(): void {
        if (state.closedByClient || state.reconnectTimer) {
            return
        }

        state.reconnectTimer = window.setTimeout(() => {
            state.reconnectTimer = 0
            start()
        }, 1600)
    }

    function clearTimers(): void {
        if (state.localTimer) {
            window.clearTimeout(state.localTimer)
            state.localTimer = 0
        }

        if (state.cursorTimer) {
            window.clearTimeout(state.cursorTimer)
            state.cursorTimer = 0
        }

        if (state.pingTimer) {
            window.clearInterval(state.pingTimer)
            state.pingTimer = 0
        }

        if (state.reconnectTimer) {
            window.clearTimeout(state.reconnectTimer)
            state.reconnectTimer = 0
        }
    }

    function handleSnapshot(payload: ServerMessage): void {
        state.clientId = String(payload.client_id || '')
        state.revision = Number(payload.revision || 0)
        state.textShadow = String(payload.content || '')
        state.pendingOp = null
        state.active = true
        setText(state.textShadow, { source: 'snapshot' })
        renderMembers(payload.members || [], state.clientId)
        setStatus('ok', '实时协作已连接')

        if (typeof opts.onConnectionChange === 'function') {
            opts.onConnectionChange(true)
        }

        sendCursorNow()
    }

    async function verifyServerHash(expectedHash: string): Promise<void> {
        const expected = String(expectedHash || '').trim()

        // shadow 应当等于服务器文本;有未确认 op 时无法直接比对
        if (!expected || state.pendingOp || typeof window.crypto?.subtle !== 'object') {
            return
        }

        const snapshotText = state.textShadow

        const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshotText))
        const actual = Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')

        if (
            actual !== expected
            && state.active
            && !state.pendingOp
            && snapshotText === state.textShadow
            && state.socket
        ) {
            // 本地与服务器内容分叉,强制重连拉取快照
            setStatus('saving', '内容失配,正在重新同步...')
            state.socket.close()
        }
    }

    function applyRemoteOperation(payload: ServerMessage): void {
        const rawOperation = payload && payload.op && typeof payload.op === 'object' ? payload.op : null

        if (!rawOperation) {
            return
        }

        const isSelf = String(payload.client_id || '') === state.clientId

        if (isSelf) {
            state.revision = Number(payload.revision || state.revision || 0)
            state.pendingOp = null
            // textShadow 此时已等于服务器文本(flush 时置为 server+pending,
            // ack 即 pending 落库),不能覆盖为 getText()——否则 ack 之后、
            // flush 之前打出的字符会被吞掉,永远同步不到远端。
            renderMembers(payload.members || [], state.clientId)
            setStatus('ok', '已同步')
            void verifyServerHash(String(payload.content_hash || ''))
            flushLocalChange()

            return
        }

        const shadowBefore = state.textShadow
        const currentText = getText()
        let operation = { ...rawOperation }

        // 1) 与未确认的 pendingOp 双向 transform。
        //    服务端会把我们的 pendingOp 排在这条已提交 op 之前(同位置插入时),
        //    所以本地应用远端 op 时要让它落到 pending 插入内容之后(preferAfterInsert)。
        if (state.pendingOp) {
            const opAfterPending = transformOperation(operation, state.pendingOp, true)
            state.pendingOp = transformOperation(state.pendingOp, operation, false)
            operation = opAfterPending
        }

        state.textShadow = applyOperation(shadowBefore, operation)

        // 2) 编辑器里可能还有未 flush 的本地输入(buffer),
        //    远端 op 的坐标必须先经过 buffer transform 才能应用到编辑器文本
        const bufferOp = buildReplaceOperation(shadowBefore, currentText)
        const editorOp = bufferOp ? transformOperation(operation, bufferOp, true) : operation

        const cursor = getCursorOffset()
        const nextText = applyOperation(currentText, editorOp)
        const nextCursor = transformOffset(cursor, editorOp, false)
        state.revision = Number(payload.revision || state.revision || 0)
        const incremental = setText(nextText, { source: 'remote_op', operation: editorOp }) === true

        // 增量事务应用时 ProseMirror 已自动映射本地选区,
        // 不要再重设光标(避免多余的 caret 联动/滚动)
        if (!incremental) {
            setCursorOffset(nextCursor)
        }

        renderMembers(payload.members || [], state.clientId)
        setStatus('ok', '已同步远端输入')
        void verifyServerHash(String(payload.content_hash || ''))
    }

    function handleMessage(payload: ServerMessage): void {
        const type = String((payload && payload.type) || '').trim()

        if (type === 'knowledge_collab_snapshot') {
            handleSnapshot(payload)

            return
        }

        if (type === 'knowledge_collab_op') {
            applyRemoteOperation(payload)

            return
        }

        if (type === 'knowledge_collab_members' || type === 'knowledge_collab_cursor') {
            renderMembers(payload.members || [], state.clientId)

            return
        }

        if (type === 'knowledge_collab_saved') {
            if (payload.saved === false) {
                setStatus('error', String(payload.message || '实时内容落盘失败'))
            } else {
                setStatus('ok', '已落盘')
            }

            return
        }

        if (type === 'error') {
            setStatus('error', String(payload.message || '协作通道错误'))
        }
    }

    function flushLocalChange(): void {
        if (!state.active || state.applyingRemote || state.pendingOp) {
            return
        }

        const currentText = getText()
        const operation = buildReplaceOperation(state.textShadow, currentText)

        if (!operation) {
            return
        }

        operation.op_id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
        state.pendingOp = { ...operation }
        state.textShadow = currentText
        send({
            type: 'edit_op',
            revision: state.revision,
            ...operation,
            cursor: getCursorPayload(),
        })
        setStatus('saving', '实时同步中...')
    }

    function notifyLocalChange(): boolean {
        if (!state.active || state.applyingRemote) {
            return false
        }

        if (state.localTimer) {
            window.clearTimeout(state.localTimer)
        }

        state.localTimer = window.setTimeout(() => {
            state.localTimer = 0
            flushLocalChange()
        }, 45)
        scheduleCursorSend()

        return true
    }

    function sendCursorNow(): boolean {
        if (!state.active) {
            return false
        }

        return send({
            type: 'cursor',
            cursor: getCursorPayload(),
        })
    }

    function scheduleCursorSend(): void {
        if (state.cursorTimer) {
            window.clearTimeout(state.cursorTimer)
        }

        state.cursorTimer = window.setTimeout(() => {
            state.cursorTimer = 0
            sendCursorNow()
        }, 160)
    }

    function start(): void {
        if (!opts.wsUrl || state.closedByClient) {
            return
        }

        clearTimers()
        state.active = false

        try {
            state.socket = new WebSocket(opts.wsUrl)
        } catch (e) {
            setStatus('error', `协作通道启动失败: ${String(e instanceof Error ? e.message : e)}`)
            scheduleReconnect()

            return
        }

        state.socket.addEventListener('open', () => {
            setStatus('saving', '正在连接实时协作...')
            state.pingTimer = window.setInterval(() => {
                send({ type: 'ping', ts: Date.now() })
            }, 25000)
        })

        state.socket.addEventListener('message', (event) => {
            try {
                handleMessage(JSON.parse(String((event as MessageEvent).data || '{}')) as ServerMessage)
            } catch (e) {
                setStatus('error', `协作消息解析失败: ${String(e instanceof Error ? e.message : e)}`)
            }
        })

        state.socket.addEventListener('close', () => {
            state.active = false
            state.socket = null
            clearTimers()

            if (!state.closedByClient) {
                setStatus('error', '实时协作已断开,正在重连')

                if (typeof opts.onConnectionChange === 'function') {
                    opts.onConnectionChange(false)
                }

                scheduleReconnect()
            }
        })

        state.socket.addEventListener('error', () => {
            if (state.closedByClient) {
                return
            }

            setStatus('error', '实时协作通道异常')
        })
    }

    function stop(): void {
        state.closedByClient = true
        state.active = false
        clearTimers()

        if (state.socket) {
            state.socket.close()
            state.socket = null
        }
    }

    return {
        start,
        stop,
        notifyLocalChange,
        flushNow: flushLocalChange,
        sendCursorNow,
        scheduleCursorSend,
        isActive: () => state.active,
        isApplyingRemote: () => state.applyingRemote,
        getClientId: () => state.clientId,
    }
}