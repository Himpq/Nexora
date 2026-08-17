import { computed, onBeforeUnmount, ref, type Ref } from 'vue'

/** 面板位置/尺寸(可持久化) */
export interface PanelLayout {
    left: number
    top: number
    width: number
    height: number
}

/** 尺寸边界配置(对齐原版各面板 minWidth 公式) */
export interface PanelDragBounds {
    /** 视口边缘留白(默认 8px) */
    margin?: number
    /** 最小宽度上限 clamp(默认 320,时间线原值) */
    minWidthCap?: number
    /** 最小宽度下限 clamp(默认 260,时间线原值) */
    minWidthFloor?: number
    /** 最小高度(默认 180) */
    minHeight?: number
}

/**
 * 浮动面板拖拽/缩放 composable(GDDP 统一抽象)
 *
 * 原版时间线/笔记两套面板各自手写了相同的 pointerdown + window pointermove
 * 拖拽/缩放逻辑,此处抽成单一实现,保证两面板行为一致且消除重复代码。
 *
 * 性能关键:拖拽/缩放过程中直接写 panelEl.style(非响应式),
 * 与原版 chat_notes.js 的 panel.style 直写一致;每帧更新响应式 layout
 * 会触发整个面板组件重渲染(时间线含大量列表项时表现为明显卡顿)。
 * layout 仅在 pointerup 收尾时提交一次并持久化。
 *
 * 用法:
 *   const panelEl = ref<HTMLElement | null>(null)
 *   const { panelStyle, startDrag, startResize, restoreLayout } =
 *       usePanelDrag('nexora_timeline_panel_layout_v1', { left: 0, top: 78, width: 420, height: 620 }, panelEl)
 *   - 模板: 面板根元素 ref="panelEl" + :style="panelStyle"
 *     head @pointerdown="startDrag" + handle @pointerdown="startResize"
 *   - 打开面板时调用 restoreLayout() 恢复上次位置
 */
export function usePanelDrag(
    storageKey: string,
    defaultLayout: PanelLayout,
    panelEl: Ref<HTMLElement | null>,
    bounds: PanelDragBounds = {}
) {
    const layout = ref<PanelLayout>({ ...defaultLayout })
    const dragging = ref(false)
    const resizing = ref(false)

    const dragStart = { x: 0, y: 0, left: 0, top: 0 }
    const resizeStart = { x: 0, y: 0, width: 0, height: 0 }

    /** 拖拽进行中的坐标快照(普通对象,不参与响应式) */
    const dragCurrent = { left: 0, top: 0, width: 0, height: 0 }

    let dragHandler: ((event: PointerEvent) => void) | null = null
    let resizeHandler: ((event: PointerEvent) => void) | null = null
    let stopHandler: ((event: PointerEvent) => void) | null = null

    const margin = bounds.margin ?? 8
    const minWidthCap = bounds.minWidthCap ?? 320
    const minWidthFloor = bounds.minWidthFloor ?? 260
    const minHeightFixed = bounds.minHeight ?? 180

    /** 面板内联样式:坐标 + 尺寸(仅开合/收尾时更新,拖拽中由 DOM 直写接管) */
    const panelStyle = computed(() => ({
        left: `${layout.value.left}px`,
        top: `${layout.value.top}px`,
        width: `${layout.value.width}px`,
        height: `${layout.value.height}px`,
    }))

    /** 尺寸边界(随视口动态计算,对齐原版 minWidth/maxWidth/maxHeight 公式) */
    function sizeBounds() {
        const minWidth = Math.min(minWidthCap, Math.max(minWidthFloor, window.innerWidth - margin * 3))
        const minHeight = minHeightFixed
        const maxWidth = Math.max(minWidth, window.innerWidth - margin * 3)
        const maxHeight = Math.max(minHeight, window.innerHeight - margin * 3)

        return { minWidth, minHeight, maxWidth, maxHeight }
    }

    /** 从 localStorage 恢复位置/尺寸(对齐原版 loadPanelPosition + 边界夹取) */
    function restoreLayout(): void {
        try {
            const raw = localStorage.getItem(storageKey)

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

            const { minWidth, minHeight, maxWidth, maxHeight } = sizeBounds()
            const nextWidth = Math.max(minWidth, Math.min(maxWidth, width))
            const nextHeight = Math.max(minHeight, Math.min(maxHeight, height))
            const maxLeft = Math.max(margin, window.innerWidth - nextWidth - margin)
            const maxTop = Math.max(margin, window.innerHeight - nextHeight - margin)

            layout.value.left = Math.max(margin, Math.min(maxLeft, left))
            layout.value.top = Math.max(margin, Math.min(maxTop, top))
            layout.value.width = nextWidth
            layout.value.height = nextHeight
        } catch {
            // localStorage 不可用时使用默认位置
        }
    }

    /** 持久化位置/尺寸(对齐原版 savePanelPosition) */
    function saveLayout(): void {
        try {
            localStorage.setItem(storageKey, JSON.stringify({
                left: Math.round(layout.value.left),
                top: Math.round(layout.value.top),
                width: Math.round(layout.value.width),
                height: Math.round(layout.value.height),
            }))
        } catch {
            // localStorage 不可用时忽略
        }
    }

    /** 头部拖拽移动(对齐原版 bindPanelDrag 的 head 逻辑) */
    function startDrag(event: PointerEvent): void {
        if (event.button !== 0) {
            return
        }

        dragging.value = true
        dragStart.x = event.clientX
        dragStart.y = event.clientY
        dragStart.left = layout.value.left
        dragStart.top = layout.value.top
        dragCurrent.left = layout.value.left
        dragCurrent.top = layout.value.top
        dragCurrent.width = layout.value.width
        dragCurrent.height = layout.value.height

        detachDragHandlers()

        dragHandler = (moveEvent: PointerEvent) => {
            if (!dragging.value) {
                return
            }

            const maxLeft = Math.max(margin, window.innerWidth - dragCurrent.width - margin)
            const maxTop = Math.max(margin, window.innerHeight - dragCurrent.height - margin)

            dragCurrent.left = Math.max(margin, Math.min(maxLeft, dragStart.left + moveEvent.clientX - dragStart.x))
            dragCurrent.top = Math.max(margin, Math.min(maxTop, dragStart.top + moveEvent.clientY - dragStart.y))

            // DOM 直写:每帧不触发组件重渲染(卡顿根因修复)
            if (panelEl.value) {
                panelEl.value.style.left = `${dragCurrent.left}px`
                panelEl.value.style.top = `${dragCurrent.top}px`
            }
        }

        stopHandler = () => {
            if (!dragging.value) {
                return
            }

            dragging.value = false

            // 收尾一次性提交响应式状态 + 持久化
            layout.value.left = dragCurrent.left
            layout.value.top = dragCurrent.top
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
        dragCurrent.left = layout.value.left
        dragCurrent.top = layout.value.top
        dragCurrent.width = layout.value.width
        dragCurrent.height = layout.value.height

        detachDragHandlers()

        resizeHandler = (moveEvent: PointerEvent) => {
            if (!resizing.value) {
                return
            }

            const { minWidth, minHeight, maxWidth, maxHeight } = sizeBounds()

            dragCurrent.width = Math.max(minWidth, Math.min(maxWidth, resizeStart.width + moveEvent.clientX - resizeStart.x))
            dragCurrent.height = Math.max(minHeight, Math.min(maxHeight, resizeStart.height + moveEvent.clientY - resizeStart.y))

            // DOM 直写:每帧不触发组件重渲染(卡顿根因修复)
            if (panelEl.value) {
                panelEl.value.style.width = `${dragCurrent.width}px`
                panelEl.value.style.height = `${dragCurrent.height}px`
            }
        }

        stopHandler = () => {
            if (!resizing.value) {
                return
            }

            resizing.value = false

            // 收尾一次性提交响应式状态 + 持久化
            layout.value.width = dragCurrent.width
            layout.value.height = dragCurrent.height
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

    /** 面板关闭/卸载时复位状态并清理监听 */
    function resetDragState(): void {
        dragging.value = false
        resizing.value = false
        detachDragHandlers()
    }

    onBeforeUnmount(() => {
        detachDragHandlers()
    })

    return {
        layout,
        dragging,
        resizing,
        panelStyle,
        restoreLayout,
        saveLayout,
        startDrag,
        startResize,
        detachDragHandlers,
        resetDragState,
    }
}
