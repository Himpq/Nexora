<!--
    TimelinePanel.vue — 时间线浮动面板(对齐原版 chat_notes.js timelinePanel)

    设计:
      - 复用原版全局样式类(.timeline-panel / -track / -item / -rail / -content / -diff 等)
      - 交互复刻原版:头部拖拽移动、右下角缩放手柄、12s 轮询、位置/尺寸持久化(localStorage)
      - 打开/关闭由父级控制;点面板外部不自动关闭(浮动面板,非下拉)
-->

<template>
    <div
        class="timeline-panel"
        :class="{ active: open, dragging, resizing }"
        role="dialog"
        aria-label="时间线"
        :aria-hidden="!open"
        :style="panelStyle"
    >
        <div class="timeline-panel-head" @pointerdown="startDrag">
            <div class="timeline-panel-head-main">
                <h3>时间线</h3>
                <span class="timeline-panel-hint">知识库 / 笔记</span>
            </div>
            <div class="timeline-panel-head-actions">
                <button class="timeline-panel-close" type="button" title="关闭" @click="emit('close')">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
            </div>
        </div>

        <div class="timeline-list">
            <div v-if="!items.length" class="timeline-empty">暂无时间线记录</div>
            <div v-else class="timeline-track">
                <article
                    v-for="entry in items"
                    :key="entry.ts + entry.title"
                    class="timeline-item"
                    :title="`${dateParts(entry.ts).date} ${dateParts(entry.ts).time}`.trim()"
                >
                    <div class="timeline-rail">
                        <div class="timeline-date-main">{{ dateParts(entry.ts).date }}</div>
                        <div class="timeline-date-time">{{ dateParts(entry.ts).time }}</div>
                        <div class="timeline-node"></div>
                    </div>
                    <div class="timeline-content">
                        <div class="timeline-top">
                            <span class="timeline-type-icon">
                                <i :class="entryIconClass(entry)" aria-hidden="true"></i>
                            </span>
                            <div class="timeline-title">{{ entry.title || '未命名' }}</div>
                            <span class="timeline-kind-label">{{ kindLabel(entry) }}</span>
                        </div>
                        <div class="timeline-update-by">
                            <i class="fa-regular fa-user" aria-hidden="true"></i>
                            <span>{{ entry.update_by || '用户' }}</span>
                        </div>
                        <div class="timeline-diff" :class="diffClass(entry)" :title="diffTitle(entry)">
                            <span v-if="diffSign(entry)" class="timeline-diff-sign">{{ diffLabel(entry) }}</span>
                            <span v-if="diffSign(entry)" class="timeline-diff-body">{{ diffBody(entry) }}</span>
                            <span v-else class="timeline-diff-summary">{{ diffSummary(entry) }}</span>
                        </div>
                    </div>
                </article>
            </div>
        </div>

        <div class="timeline-resize-handle" @pointerdown="startResize"></div>
    </div>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, ref, watch } from 'vue'

    import type { TimelineEntry } from '@/api/timeline'
    import { fetchTimelineEntries } from '@/api/timeline'
    import { showError } from '@/stores/notify'

    const props = defineProps<{
        open: boolean
    }>()

    const emit = defineEmits<{
        close: []
    }>()

    /** localStorage 键与轮询间隔(对齐原版常量) */
    const LAYOUT_KEY = 'nexora_timeline_panel_layout_v1'
    const REFRESH_INTERVAL_MS = 12000

    const items = ref<TimelineEntry[]>([])
    const dragging = ref(false)
    const resizing = ref(false)

    /** 面板位置/尺寸(默认对齐原版 right:20px top:78px width:420px height:min(68vh,620px)) */
    const layout = ref({
        left: 0,
        top: 78,
        width: 420,
        height: Math.min(Math.round(window.innerHeight * 0.68), 620),
    })

    /** 拖拽/缩放起点记录 */
    const dragStart = { x: 0, y: 0, left: 0, top: 0 }
    const resizeStart = { x: 0, y: 0, width: 0, height: 0 }

    /** 面板内联样式:坐标 + 尺寸(computed 保证拖拽/缩放实时跟随) */
    const panelStyle = computed(() => ({
        left: `${layout.value.left}px`,
        top: `${layout.value.top}px`,
        width: `${layout.value.width}px`,
        height: `${layout.value.height}px`,
    }))

    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let dragHandler: ((event: PointerEvent) => void) | null = null
    let resizeHandler: ((event: PointerEvent) => void) | null = null
    let stopHandler: ((event: PointerEvent) => void) | null = null

    /** 打开时:恢复位置 + 立即加载 + 启动轮询(对齐原版 openTimelinePanel) */
    watch(
        () => props.open,
        (opened) => {
            if (opened) {
                restoreLayout()
                void refresh()

                startPolling()
            } else {
                stopPolling()
                dragging.value = false
                resizing.value = false
            }
        }
    )

    onBeforeUnmount(() => {
        stopPolling()
        detachDragHandlers()
    })

    /** 拉取时间线(对齐原版 refreshTimelinePanel) */
    async function refresh(): Promise<void> {
        try {
            items.value = await fetchTimelineEntries(120)
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载时间线失败')
        }
    }

    /** 12s 轮询(对齐原版 startTimelinePolling tick) */
    function startPolling(): void {
        if (refreshTimer) {
            return
        }

        refreshTimer = setTimeout(async () => {
            refreshTimer = null

            if (!props.open) {
                return
            }

            await refresh()

            if (props.open) {
                startPolling()
            }
        }, REFRESH_INTERVAL_MS)
    }

    function stopPolling(): void {
        if (refreshTimer) {
            clearTimeout(refreshTimer)
            refreshTimer = null
        }
    }

    /** 从 localStorage 恢复位置/尺寸(对齐原版 loadTimelinePanelPosition + 边界夹取) */
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

            const minWidth = Math.min(320, Math.max(260, window.innerWidth - 24))
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

    /** 持久化位置/尺寸(对齐原版 saveTimelinePanelPosition) */
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

    /** 头部拖拽移动(对齐原版 bindTimelinePanelDrag 的 head 逻辑) */
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

    /** 右下角缩放(对齐原版 resizeHandle pointerdown) */
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

            const minWidth = Math.min(320, Math.max(260, window.innerWidth - 24))
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

    /** 时间拆分(对齐原版 formatTimelineDateParts) */
    function dateParts(ts: number): { date: string; time: string } {
        const n = Number(ts || 0)

        if (!n) {
            return { date: '-', time: '--:--' }
        }

        try {
            const date = new Date(n * 1000)

            return {
                date: date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
                time: date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
            }
        } catch {
            return { date: '-', time: '--:--' }
        }
    }

    /** 类型图标(对齐原版 timelineEntryIconClass) */
    function entryIconClass(entry: TimelineEntry): string {
        const kind = String(entry.kind || entry.type || '').toLowerCase()

        if (kind === 'note') {
            return 'fa-solid fa-note-sticky'
        }

        if (kind === 'notebook') {
            return 'fa-solid fa-book-bookmark'
        }

        if (kind === 'knowledge') {
            return 'fa-solid fa-book-open'
        }

        return 'fa-solid fa-clock'
    }

    /** 类型标签(对齐原版 timelineEntryKindLabel) */
    function kindLabel(entry: TimelineEntry): string {
        const kind = String(entry.kind || entry.type || '').toLowerCase()

        if (kind === 'note') {
            return '笔记'
        }

        if (kind === 'notebook') {
            return '笔记本'
        }

        if (kind === 'knowledge') {
            return '知识库'
        }

        return '记录'
    }

    /** 差异前缀符号(对齐原版:+ / - / ±) */
    function diffSign(entry: TimelineEntry): string {
        const text = String(entry.difference || '').trim()

        if (text.startsWith('+')) {
            return '+'
        }

        if (text.startsWith('-')) {
            return '-'
        }

        if (text.startsWith('±')) {
            return '±'
        }

        return ''
    }

    /** 差异样式类(对齐原版 positive/negative/modified/neutral) */
    function diffClass(entry: TimelineEntry): string {
        const sign = diffSign(entry)

        if (sign === '+') {
            return 'positive'
        }

        if (sign === '-') {
            return 'negative'
        }

        if (sign === '±') {
            return 'modified'
        }

        return 'neutral'
    }

    /** 差异动作标签(对齐原版 sign 文本:新增/删除/修改) */
    function diffLabel(entry: TimelineEntry): string {
        const sign = diffSign(entry)

        if (sign === '+') {
            return '新增'
        }

        if (sign === '-') {
            return '删除'
        }

        if (sign === '±') {
            return '修改'
        }

        return ''
    }

    /** 差异正文(去掉前缀符号) */
    function diffBody(entry: TimelineEntry): string {
        const text = String(entry.difference || '').trim()
        const sign = diffSign(entry)

        if (!sign) {
            return ''
        }

        return text.slice(1).trim() || '无变更'
    }

    /** 中性差异摘要(对齐原版:动作 + 主体) */
    function diffSummary(entry: TimelineEntry): string {
        const rawTitle = String(entry.title || '记录').trim()

        if (/^新增\s/.test(rawTitle)) {
            return `新增 ${rawTitle.replace(/^新增\s+/, '').trim() || '记录'}`
        }

        if (/^删除\s/.test(rawTitle)) {
            return `删除 ${rawTitle.replace(/^删除\s+/, '').trim() || '记录'}`
        }

        return `修改 ${rawTitle.replace(/^(新增|删除|修改)\s+/, '').trim() || '记录'}`
    }

    /** title(对齐原版 diff.title) */
    function diffTitle(entry: TimelineEntry): string {
        const sign = diffSign(entry)

        if (sign) {
            return String(entry.difference || '').trim()
        }

        return diffSummary(entry)
    }
</script>
