/**
 * overlay.ts — 浮层协调器(General Design Development Package 基础模块)
 *
 * 职责:
 *   - 统一管理所有浮层(下拉/菜单/右侧栏/弹窗)与内容级视图的打开与关闭
 *   - 互斥规则(对齐原版 Nexora 行为):
 *       * 打开任意下拉/菜单时,自动关闭右侧栏面板(知识库/文件)
 *       * 打开右侧栏面板时,自动关闭下拉/菜单
 *       * 打开内容级视图(Workspaces/知识库管理/知识库正文/文件中心)时,
 *         关闭下拉/右侧栏,且内容级视图彼此互斥(单一视图状态机)
 *   - 全局点击外部自动关闭当前下拉(组件无需各自手写 document click)
 *
 * 用法:
 *   openPopover('tools-menu', el)   // 打开下拉,自动关右侧栏和其他下拉
 *   openPanel('files')              // 打开右侧栏,自动关下拉
 *   openView('workspaces')          // 打开内容级视图,自动关下拉/右侧栏,互斥其他视图
 *   overlay.popover === 'tools-menu'  // 组件读取状态
 *
 * 新浮层接入只需:分配唯一 id + open/close 调用,互斥与外部关闭由本模块统一保证。
 */

import { reactive } from 'vue'

export type ContentViewId = 'files' | 'workspaces' | 'knowledge' | 'knowledge-mgmt' | 'mail' | 'learning'

/** 浮层状态(响应式单例) */
export const overlay = reactive({
    /** 当前打开的下拉/菜单 id(同一时刻至多一个) */
    popover: null as string | null,
    /** 当前打开的右侧栏面板 id(至多一个) */
    panel: null as string | null,
    /** 当前打开的内容级视图 id(至多一个;null 表示聊天主视图) */
    view: null as ContentViewId | null,
    /** 当前打开的弹窗 id(至多一个) */
    modal: null as string | null,
})

/** 已注册 popover 的容器元素(id → 边界元素集合):
 *  同一下拉的触发器与 Teleport 到 body 的菜单本体都注册进来,
 *  外部点击判定与 isInsideOpenPopover 才能正确识别"点击在浮层内"。 */
const popoverElements = new Map<string, Set<HTMLElement>>()

/** 已注册右侧栏面板的容器元素(id → 元素) */
const panelElements = new Map<string, HTMLElement>()

/** 已注册面板的触发按钮(id → 按钮集合),点击触发按钮不关闭面板 */
const panelTriggerElements = new Map<string, Set<HTMLElement>>()

/**
 * 打开一个下拉/菜单
 *
 * 自动关闭同类型其他浮层与右侧栏面板。
 * 传入容器元素后,点击该元素外部会自动关闭本下拉。
 * keepPanel=true 时保留右侧栏面板(用于面板内触发的菜单,如知识库右键菜单)。
 */
export function openPopover(id: string, container?: HTMLElement | null, options: { keepPanel?: boolean } = {}): void {
    if (container) {
        const set = popoverElements.get(id) || new Set<HTMLElement>()

        set.add(container)
        popoverElements.set(id, set)
    }

    overlay.popover = id

    if (!options.keepPanel) {
        overlay.panel = null
    }
}

/** 关闭指定下拉(仅当它是当前打开的那个),并清理其边界元素注册 */
export function closePopover(id: string): void {
    if (overlay.popover === id) {
        overlay.popover = null
        popoverElements.delete(id)
    }
}

/**
 * 事件目标是否落在当前打开的 GDDP 浮层(下拉/右键菜单,含 Teleport 菜单本体)内。
 *
 * 宿主自绘浮层(如管理页的 quota 调整气泡)的"点击外部关闭"必须先经此判断:
 * GDDP 下拉/菜单挂在 body 下,选项点击对宿主而言永远在自身 DOM 之外,
 * 不豁免就会出现"点开下拉选第二项,整个宿主浮层被误关"的问题。
 */
export function isInsideOpenPopover(target: Node | null): boolean {
    if (!target || !overlay.popover) {
        return false
    }

    const containers = popoverElements.get(overlay.popover)

    if (!containers) {
        return false
    }

    for (const container of containers) {
        if (container.contains(target)) {
            return true
        }
    }

    return false
}

/** 注册右侧栏面板(容器元素 + 触发按钮),用于外部点击关闭判断 */
export function registerPanel(id: string, container: HTMLElement | null, triggers: (HTMLElement | null)[] = []): void {
    if (container) {
        panelElements.set(id, container)
    }

    const set = panelTriggerElements.get(id) || new Set<HTMLElement>()

    triggers.forEach((el) => {
        if (el) {
            set.add(el)
        }
    })

    panelTriggerElements.set(id, set)
}

/** 打开一个右侧栏面板(自动关闭下拉) */
export function openPanel(id: string): void {
    overlay.panel = id
    overlay.popover = null
}

/** 关闭指定右侧栏面板 */
export function closePanel(id: string): void {
    if (overlay.panel === id) {
        overlay.panel = null
    }
}

/**
 * 打开一个内容级视图(自动关闭下拉/右侧栏;内容级视图彼此互斥)
 *
 * keepPanel=true 时保留右侧栏面板(如从知识库面板打开知识库正文,面板保持可继续浏览)。
 */
export function openView(id: ContentViewId, options: { keepPanel?: boolean } = {}): void {
    overlay.view = id
    overlay.popover = null

    if (!options.keepPanel) {
        overlay.panel = null
    }
}

/** 关闭内容级视图,回到聊天主视图 */
export function closeView(): void {
    overlay.view = null
}

/** 打开一个弹窗(自动关闭下拉与右侧栏) */
export function openModal(id: string): void {
    overlay.modal = id
    overlay.popover = null
    overlay.panel = null
}

/** 关闭指定弹窗 */
export function closeModal(id: string): void {
    if (overlay.modal === id) {
        overlay.modal = null
    }
}

/** 关闭全部浮层与内容级视图 */
export function closeAllOverlays(): void {
    overlay.popover = null
    overlay.panel = null
    overlay.modal = null
    overlay.view = null
}

// 全局点击:
//   1. 点击当前下拉容器外部 → 自动关闭(组件无需各自手写 document click)
//   2. 点击右侧栏面板外部且不在触发按钮上 → 自动关闭面板(对齐原版)
document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null

    if (!target) {
        return
    }

    if (overlay.popover) {
        // 无边界注册(未传容器)保持旧行为:任意点击即关;有边界则按集合判定
        const containers = popoverElements.get(overlay.popover)

        if (!containers || ![...containers].some((el) => el.contains(target))) {
            overlay.popover = null
        }
    }

    if (overlay.panel) {
        const panelEl = panelElements.get(overlay.panel)

        if (panelEl && !panelEl.contains(target)) {
            const triggers = panelTriggerElements.get(overlay.panel)

            const clickedTrigger = triggers && Array.from(triggers).some((el) => el.contains(target))

            // 点击当前打开的下拉容器(如右键菜单/下拉 Teleport 到 body)也不关闭面板,
            // 否则面板内触发的菜单被挂到 body 后,菜单内点击会误关面板
            const clickedPopover = isInsideOpenPopover(target)

            if (!clickedTrigger && !clickedPopover) {
                overlay.panel = null
            }
        }
    }
})
