<!--
    NotesPanel.vue — 笔记浮动面板(对齐原版 chat_notes.js notesPanel)

    设计:
      - 复用原版全局样式类(.notes-panel / -head / -notebook-row / -list / note-item 等)
      - notebook 选择为自建下拉(禁用原生 select);新建/清空/删除/下载对齐原版按钮
      - 云同步:打开时 GET /api/notes/store,变更后防抖 PUT(对齐原版 saveNotesToStorage)
      - 拖拽/resize/位置持久化与时间线面板同一套交互
-->

<template>
    <div
        class="notes-panel"
        :class="{ active: open, dragging, resizing }"
        role="dialog"
        aria-label="笔记"
        :aria-hidden="!open"
        :style="panelStyle"
    >
        <div class="notes-panel-head" @pointerdown="startDrag">
            <h3>笔记</h3>
            <div class="notes-panel-head-actions">
                <button class="notes-panel-popout" type="button" title="独立窗口" @click="handlePopout">
                    <i class="fa-solid fa-up-right-from-square" aria-hidden="true"></i>
                </button>
                <button class="notes-panel-close" type="button" title="关闭" @click="emit('close')">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
            </div>
        </div>

        <div class="notes-notebook-row">
            <!-- 自建 notebook 下拉(禁用原生 select) -->
            <div class="notes-notebook-select-wrap" ref="notebookSelectWrapRef">
                <button
                    class="notes-notebook-select"
                    type="button"
                    :aria-expanded="notebookMenuOpen"
                    @click.stop="toggleNotebookMenu"
                >
                    <span>{{ activeNotebookName }}</span>
                    <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                </button>
                <div class="notes-notebook-menu" :class="{ open: notebookMenuOpen }">
                    <button
                        v-for="notebook in notebooks"
                        :key="notebook.id"
                        type="button"
                        :class="{ active: notebook.id === activeNotebookId }"
                        @click="selectNotebook(notebook.id)"
                    >
                        {{ notebook.name }}
                    </button>
                </div>
            </div>
            <button class="notes-notebook-add" type="button" title="新建笔记本" @click="handleCreateNotebook">
                <i class="fa-solid fa-plus" aria-hidden="true"></i>
            </button>
            <button class="notes-notebook-tool" type="button" title="清空当前笔记本" @click="handleClearNotebook">
                <i class="fa-solid fa-eraser" aria-hidden="true"></i>
            </button>
            <button class="notes-notebook-tool danger" type="button" title="删除当前笔记本" @click="handleDeleteNotebook">
                <i class="fa-solid fa-trash" aria-hidden="true"></i>
            </button>
            <button class="notes-notebook-tool" type="button" title="下载当前笔记本" @click="handleDownloadNotebook">
                <i class="fa-solid fa-download" aria-hidden="true"></i>
            </button>
        </div>

        <div class="notes-list" id="notesList">
            <div v-if="!activeNotes.length" class="notes-empty">暂无笔记。选中文本后右键可添加。</div>
            <article v-for="note in activeNotes" :key="note.id" class="note-item">
                <button class="note-del-btn" type="button" title="删除" @click="handleDeleteNote(note.id)">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
                <div class="note-text">
                    <MarkdownView :content="note.text" />
                </div>
                <div class="note-meta">
                    <button
                        class="note-source note-source-link"
                        type="button"
                        title="跳转到来源"
                        :disabled="!note.anchor"
                        @click="emit('jump-to-source', note)"
                    >
                        {{ noteSourceLabel(note) }}
                    </button>
                    <span class="note-time">{{ formatNoteTime(note.ts) }}</span>
                </div>
            </article>
        </div>

        <div class="notes-resize-handle" @pointerdown="startResize"></div>
    </div>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, ref, watch } from 'vue'

    import type { NoteItem, NotesStore, NotebookItem } from '@/api/notes'
    import { fetchNotesStore, saveNotesStore } from '@/api/notes'
    import { showConfirm, showPrompt } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'

    import MarkdownView from './MarkdownView.vue'

    const props = defineProps<{
        open: boolean
    }>()

    const emit = defineEmits<{
        close: []
        /** 点击笔记来源:跳转到对应会话/消息(对齐原版 jumpToNoteSource) */
        'jump-to-source': [note: NoteItem]
    }>()

    const LAYOUT_KEY = 'nexora_notes_panel_layout_v2'
    const SYNC_DEBOUNCE_MS = 800

    const store = ref<NotesStore>({
        activeNotebookId: 'nb_default',
        notebooks: [{ id: 'nb_default', name: '默认笔记本', ts: Math.floor(Date.now() / 1000) }],
        notes: [],
        updatedAt: 0,
    })
    const loading = ref(false)
    const notebookMenuOpen = ref(false)
    const dragging = ref(false)
    const resizing = ref(false)
    const notebookSelectWrapRef = ref<HTMLElement | null>(null)

    const layout = ref({
        left: 0,
        top: 78,
        width: 360,
        height: Math.min(Math.round(window.innerHeight * 0.62), 560),
    })

    const dragStart = { x: 0, y: 0, left: 0, top: 0 }
    const resizeStart = { x: 0, y: 0, width: 0, height: 0 }

    let syncTimer: ReturnType<typeof setTimeout> | null = null
    let dragHandler: ((event: PointerEvent) => void) | null = null
    let resizeHandler: ((event: PointerEvent) => void) | null = null
    let stopHandler: ((event: PointerEvent) => void) | null = null

    const panelStyle = computed(() => ({
        left: `${layout.value.left}px`,
        top: `${layout.value.top}px`,
        width: `${layout.value.width}px`,
        height: `${layout.value.height}px`,
    }))

    const notebooks = computed(() => store.value.notebooks)
    const activeNotebookId = computed(() => store.value.activeNotebookId)
    const activeNotebookName = computed(() => {
        const target = notebooks.value.find((n) => n.id === activeNotebookId.value)

        return target ? target.name : '默认笔记本'
    })

    /** 当前笔记本的笔记(倒序:最新在前,对齐原版 getNotesForActiveNotebook) */
    const activeNotes = computed(() => {
        return store.value.notes
            .filter((n) => n.notebookId === activeNotebookId.value)
            .slice()
            .sort((a, b) => b.ts - a.ts)
    })

    watch(
        () => props.open,
        (opened) => {
            if (opened) {
                restoreLayout()
                void load()

                document.addEventListener('click', handleOutsideClick)
            } else {
                stopPolling()
                dragging.value = false
                resizing.value = false
                notebookMenuOpen.value = false

                document.removeEventListener('click', handleOutsideClick)
            }
        }
    )

    onBeforeUnmount(() => {
        stopPolling()
        detachDragHandlers()
        document.removeEventListener('click', handleOutsideClick)
    })

    /** 外部点击关闭 notebook 下拉(自建下拉统一处理) */
    function handleOutsideClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null

        if (!target) {
            return
        }

        if (notebookSelectWrapRef.value && !notebookSelectWrapRef.value.contains(target)) {
            notebookMenuOpen.value = false
        }
    }

    /** 加载云端 store(对齐原版 fetchNotesStoreFromCloud) */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            const cloud = await fetchNotesStore()

            if (cloud) {
                store.value = cloud
            }
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载笔记失败')
        } finally {
            loading.value = false
        }
    }

    /** 防抖保存到云端(对齐原版 saveNotesToStorage 的 debounce) */
    function scheduleSync(): void {
        if (syncTimer) {
            clearTimeout(syncTimer)
            syncTimer = null
        }

        syncTimer = setTimeout(() => {
            syncTimer = null
            void flushSync()
        }, SYNC_DEBOUNCE_MS)
    }

    /** 立即保存到云端 */
    async function flushSync(): Promise<void> {
        try {
            await saveNotesStore({
                ...store.value,
                updatedAt: Date.now(),
            })
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存笔记失败')
        }
    }

    function stopPolling(): void {
        if (syncTimer) {
            clearTimeout(syncTimer)
            syncTimer = null
        }
    }

    /** notebook 下拉切换 */
    function toggleNotebookMenu(): void {
        notebookMenuOpen.value = !notebookMenuOpen.value
    }

    /** 切换当前笔记本 */
    function selectNotebook(id: string): void {
        store.value.activeNotebookId = id
        notebookMenuOpen.value = false

        scheduleSync()
    }

    /** 新建笔记本(对齐原版 createNotebook,用自建 prompt 代替原生 prompt) */
    async function handleCreateNotebook(): Promise<void> {
        const name = await showPrompt({
            title: '新建笔记本',
            label: '输入新笔记本名称',
            confirmText: '创建',
            cancelText: '取消',
        })

        const trimmed = String(name || '').trim()

        if (!trimmed) {
            return
        }

        if (notebooks.value.some((n) => n.name === trimmed)) {
            showToast('笔记本名称已存在', 'warning')

            return
        }

        const notebook: NotebookItem = {
            id: `nb_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
            name: trimmed.slice(0, 36),
            ts: Math.floor(Date.now() / 1000),
        }

        store.value.notebooks = [notebook, ...store.value.notebooks]
        store.value.activeNotebookId = notebook.id

        scheduleSync()
    }

    /** 清空当前笔记本(对齐原版 clearActiveNotebook) */
    async function handleClearNotebook(): Promise<void> {
        if (!activeNotes.value.length) {
            return
        }

        const confirmed = await showConfirm({
            title: '清空笔记本',
            content: `确定清空笔记本「${activeNotebookName.value}」吗?`,
            confirmText: '清空',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        store.value.notes = store.value.notes.filter((n) => n.notebookId !== activeNotebookId.value)

        scheduleSync()
        showToast('已清空当前笔记本', 'success')
    }

    /** 删除当前笔记本(对齐原版 deleteActiveNotebook) */
    async function handleDeleteNotebook(): Promise<void> {
        if (notebooks.value.length <= 1) {
            showToast('至少保留一个笔记本', 'warning')

            return
        }

        const confirmed = await showConfirm({
            title: '删除笔记本',
            content: `确定删除笔记本「${activeNotebookName.value}」吗?其内笔记将一并删除。`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        const targetId = activeNotebookId.value

        store.value.notebooks = notebooks.value.filter((n) => n.id !== targetId)
        store.value.notes = store.value.notes.filter((n) => n.notebookId !== targetId)
        store.value.activeNotebookId = store.value.notebooks[0]?.id || 'nb_default'

        scheduleSync()
        showToast('已删除笔记本', 'success')
    }

    /** 下载当前笔记本为 markdown(对齐原版 downloadActiveNotebook) */
    function handleDownloadNotebook(): void {
        const notes = activeNotes.value

        if (!notes.length) {
            showToast('当前笔记本为空', 'warning')

            return
        }

        const header = `# ${activeNotebookName.value}\n\n导出时间:${new Date().toLocaleString()}\n\n---\n`
        const body = notes.map((n, idx) => {
            const source = `${n.source || '聊天'}${n.sourceTitle ? ` · ${n.sourceTitle}` : ''}`

            return `\n## 笔记 ${idx + 1}\n\n> 来源:${source}\n> 时间:${formatNoteTime(n.ts)}\n\n${n.text || ''}\n`
        }).join('\n')

        const blob = new Blob([header + body], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        const ts = new Date().toISOString().replace(/[:.]/g, '-')

        a.href = url
        a.download = `${activeNotebookName.value}_${ts}.md`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)

        showToast('已下载当前笔记本', 'success')
    }

    /** 删除单条笔记(对齐原版 note-del-btn 点击) */
    async function handleDeleteNote(noteId: string): Promise<void> {
        const confirmed = await showConfirm({
            title: '删除笔记',
            content: '确定删除这条笔记吗?',
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        store.value.notes = store.value.notes.filter((n) => n.id !== noteId)

        scheduleSync()
    }

    /** 来源标签(对齐原版 sourceSpan 文本) */
    function noteSourceLabel(note: NoteItem): string {
        return `${note.source || '聊天'}${note.sourceTitle ? ` · ${note.sourceTitle}` : ''}`
    }

    /** 时间格式化(对齐原版 formatNoteTime) */
    function formatNoteTime(ts: number): string {
        const n = Number(ts || 0)

        if (!n) {
            return '-'
        }

        try {
            return new Date(n * 1000).toLocaleString()
        } catch {
            return '-'
        }
    }

    /** 独立窗口(对齐原版 openNotesCompanionWindow:优先 pywebview bridge,其次桌面 postMessage) */
    async function handlePopout(): Promise<void> {
        const bridge = (window as unknown as Record<string, unknown>).pywebview as { api?: { open_notes_companion?: () => Promise<{ success?: boolean }> } } | undefined

        if (bridge?.api && typeof bridge.api.open_notes_companion === 'function') {
            try {
                const res = await bridge.api.open_notes_companion()

                if (res && res.success) {
                    emit('close')

                    return
                }
            } catch {
                // 桥接调用失败:落入下方环境检查
            }
        }

        // 桌面模式:通知父窗口打开独立笔记(对齐原版 postMessage 通道)
        const isDesktop = document.documentElement.classList.contains('nc-desktop-mode')

        if (isDesktop && window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'NC_OPEN_NOTES_COMPANION' }, '*')

            return
        }

        showToast('独立窗口需在桌面客户端中使用', 'info')
    }

    /** 从选区添加笔记(对齐原版 addNoteItemFromSelection);anchor 记录来源会话与消息 */
    function addNoteFromSelection(
        text: string,
        sourceTitle = '',
        anchor: NoteItem['anchor'] = null
    ): void {
        const normalized = String(text || '').trim()

        if (!normalized) {
            return
        }

        const note: NoteItem = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
            notebookId: activeNotebookId.value,
            text: normalized,
            source: '聊天',
            sourceTitle: String(sourceTitle || '').trim(),
            anchor: anchor || undefined,
            ts: Math.floor(Date.now() / 1000),
        }

        store.value.notes = [note, ...store.value.notes]

        scheduleSync()
        showToast('已添加到笔记', 'success')
    }

    defineExpose({ addNoteFromSelection })

    /** 从 localStorage 恢复位置/尺寸 */
    function restoreLayout(): void {
        try {
            const raw = localStorage.getItem(LAYOUT_KEY)

            if (!raw) {
                return
            }

            const saved = JSON.parse(raw)
            const left = Number(saved && saved.left)
            const top = Number(saved && saved.top)
            const width = Number(saved && saved.width)
            const height = Number(saved && saved.height)

            if (![left, top, width, height].every(Number.isFinite)) {
                return
            }

            const minWidth = Math.min(280, Math.max(240, window.innerWidth - 24))
            const minHeight = 180
            const maxWidth = Math.max(minWidth, window.innerWidth - 24)
            const maxHeight = Math.max(minHeight, window.innerHeight - 24)
            const nextWidth = Math.max(minWidth, Math.min(maxWidth, width))
            const nextHeight = Math.max(minHeight, Math.min(maxHeight, height))
            const maxLeft = Math.max(8, window.innerWidth - nextWidth - 8)
            const maxTop = Math.max(8, window.innerHeight - nextHeight - 8)

            layout.value.left = Math.max(8, Math.min(maxLeft, left))
            layout.value.top = Math.max(8, Math.min(maxTop, top))
            layout.value.width = nextWidth
            layout.value.height = nextHeight
        } catch {
            // localStorage 不可用时使用默认位置
        }
    }

    /** 持久化位置/尺寸 */
    function saveLayout(): void {
        try {
            localStorage.setItem(LAYOUT_KEY, JSON.stringify({
                left: Math.round(layout.value.left),
                top: Math.round(layout.value.top),
                width: Math.round(layout.value.width),
                height: Math.round(layout.value.height),
            }))
        } catch {
            // localStorage 不可用时忽略
        }
    }

    /** 头部拖拽移动 */
    function startDrag(event: PointerEvent): void {
        if (event.button !== 0) {
            return
        }

        dragging.value = true
        dragStart.x = event.clientX
        dragStart.y = event.clientY
        dragStart.left = layout.value.left
        dragStart.top = layout.value.top

        detachDragHandlers()

        dragHandler = (moveEvent: PointerEvent) => {
            if (!dragging.value) {
                return
            }

            const maxLeft = Math.max(8, window.innerWidth - layout.value.width - 8)
            const maxTop = Math.max(8, window.innerHeight - layout.value.height - 8)

            layout.value.left = Math.max(8, Math.min(maxLeft, dragStart.left + moveEvent.clientX - dragStart.x))
            layout.value.top = Math.max(8, Math.min(maxTop, dragStart.top + moveEvent.clientY - dragStart.y))
        }

        stopHandler = () => {
            if (!dragging.value) {
                return
            }

            dragging.value = false
            saveLayout()
            detachDragHandlers()
        }

        window.addEventListener('pointermove', dragHandler)
        window.addEventListener('pointerup', stopHandler)
        window.addEventListener('pointercancel', stopHandler)
    }

    /** 右下角缩放 */
    function startResize(event: PointerEvent): void {
        if (event.button !== 0) {
            return
        }

        resizing.value = true
        resizeStart.x = event.clientX
        resizeStart.y = event.clientY
        resizeStart.width = layout.value.width
        resizeStart.height = layout.value.height

        detachDragHandlers()

        resizeHandler = (moveEvent: PointerEvent) => {
            if (!resizing.value) {
                return
            }

            const minWidth = Math.min(280, Math.max(240, window.innerWidth - 24))
            const minHeight = 180
            const maxWidth = Math.max(minWidth, window.innerWidth - 24)
            const maxHeight = Math.max(minHeight, window.innerHeight - 24)

            layout.value.width = Math.max(minWidth, Math.min(maxWidth, resizeStart.width + moveEvent.clientX - resizeStart.x))
            layout.value.height = Math.max(minHeight, Math.min(maxHeight, resizeStart.height + moveEvent.clientY - resizeStart.y))
        }

        stopHandler = () => {
            if (!resizing.value) {
                return
            }

            resizing.value = false
            saveLayout()
            detachDragHandlers()
        }

        window.addEventListener('pointermove', resizeHandler)
        window.addEventListener('pointerup', stopHandler)
        window.addEventListener('pointercancel', stopHandler)
    }

    /** 移除拖拽/缩放全局监听 */
    function detachDragHandlers(): void {
        if (dragHandler) {
            window.removeEventListener('pointermove', dragHandler)
            dragHandler = null
        }

        if (resizeHandler) {
            window.removeEventListener('pointermove', resizeHandler)
            resizeHandler = null
        }

        if (stopHandler) {
            window.removeEventListener('pointerup', stopHandler)
            window.removeEventListener('pointercancel', stopHandler)
            stopHandler = null
        }
    }
</script>
