import { nextTick } from 'vue'

/** 固定最终排版尺寸后裁剪面板,避免动画每一帧让整段 Markdown 换行重排。 */
export class ToolStageChatMotion {
    private animation: Animation | null = null
    private revision = 0
    private readonly getDock: () => HTMLElement
    private readonly getCompactBounds: () => DOMRect
    private readonly setVisible: (visible: boolean) => void
    private readonly restoreScroll: () => void

    constructor(
        getDock: () => HTMLElement,
        getCompactBounds: () => DOMRect,
        setVisible: (visible: boolean) => void,
        restoreScroll: () => void,
    ) {
        this.getDock = getDock
        this.getCompactBounds = getCompactBounds
        this.setVisible = setVisible
        this.restoreScroll = restoreScroll
    }

    async setExpanded(expanded: boolean): Promise<void> {
        const revision = ++this.revision
        const dock = this.getDock()
        const startingBounds = dock.getBoundingClientRect()
        const currentClip = this.animation ? getComputedStyle(dock).clipPath : null

        this.cancelAnimation()
        this.setVisible(true)
        await nextTick()

        if (revision !== this.revision) {
            return
        }

        if (expanded) {
            this.restoreScroll()
        }

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            this.setVisible(expanded)
            return
        }

        const compactBounds = expanded ? startingBounds : this.getCompactBounds()
        const collapsedClip = this.getCollapsedClip(dock, compactBounds)
        const fullClip = 'inset(0px 0px 0px 0px round 12px)'

        dock.style.willChange = 'clip-path'
        const animation = dock.animate([
            { clipPath: currentClip ?? (expanded ? collapsedClip : fullClip) },
            { clipPath: expanded ? fullClip : collapsedClip },
        ], {
            duration: 220,
            easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
        })

        this.animation = animation
        animation.onfinish = () => {

            if (this.animation !== animation) {
                return
            }

            this.setVisible(expanded)
            this.animation = null
            dock.style.willChange = ''
        }
    }

    /** 离开舞台或快速反向点击时取消旧动画,旧的完成回调不得再修改布局。 */
    reset(): void {
        this.revision += 1
        this.cancelAnimation()
        this.setVisible(false)
    }

    /** 读取 CSS 实际布局尺寸,回复预览和小屏限高也使用同一裁剪目标。 */
    private getCollapsedClip(dock: HTMLElement, compactBounds: DOMRect): string {
        const top = Math.max(0, dock.clientHeight - compactBounds.height)
        const left = Math.max(0, dock.clientWidth - compactBounds.width)

        return `inset(${top}px 0px 0px ${left}px round 12px)`
    }

    private cancelAnimation(): void {

        if (this.animation) {
            this.animation.onfinish = null
            this.animation.cancel()
            this.animation = null
            this.getDock().style.willChange = ''
        }
    }
}
