<!--
    TimelinePanel.vue — 时间线浮动面板(对齐原版 chat_notes.js timelinePanel)

    设计:
      - 复用原版全局样式类(.timeline-panel / -track / -item / -rail / -content / -diff 等)
      - 交互复刻原版:头部拖拽移动、右下角缩放手柄、12s 轮询、位置/尺寸持久化(localStorage)
      - 打开/关闭由父级控制;点面板外部不自动关闭(浮动面板,非下拉)
-->

<template>
    <div
        ref="panelEl"
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
    import { onBeforeUnmount, ref, watch } from 'vue'

    import type { TimelineEntry } from '@/api/timeline'
    import { fetchTimelineEntries } from '@/api/timeline'
    import { showError } from '@/stores/notify'
    import { usePanelDrag } from '@/ui/usePanelDrag'

    const props = defineProps<{
        open: boolean
    }>()

    const emit = defineEmits<{
        close: []
    }>()

    /** 轮询间隔(对齐原版常量) */
    const REFRESH_INTERVAL_MS = 12000

    const items = ref<TimelineEntry[]>([])

    /** 面板根元素(模板 ref 绑定;拖拽中由 usePanelDrag 直写 style) */
    const panelEl = ref<HTMLElement | null>(null)

    /**
     * 面板拖拽/缩放(抽象自 GDDP usePanelDrag)
     * 默认对齐原版 right:20px top:78px width:420px height:min(68vh,620px)
     */
    const {
        dragging,
        resizing,
        panelStyle,
        restoreLayout,
        startDrag,
        startResize,
        resetDragState,
    } = usePanelDrag(
        'nexora_timeline_panel_layout_v1',
        {
            left: 0,
            top: 78,
            width: 420,
            height: Math.min(Math.round(window.innerHeight * 0.68), 620),
        },
        panelEl
    )

    let refreshTimer: ReturnType<typeof setTimeout> | null = null

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
                resetDragState()
            }
        }
    )

    onBeforeUnmount(() => {
        stopPolling()
        resetDragState()
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
