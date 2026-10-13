import { isChatScrollLayoutReady } from './chatScrollGeometry'

const BOTTOM_SCROLL_DURATION = 360

/** 手动滚底的短动画；每帧使用最新内容高度，生成中的新消息也会纳入终点。 */
export class ChatBottomScrollMotion {
    private container: HTMLElement | null = null
    private frame = 0
    private readonly onFinish: (container: HTMLElement) => void
    private readonly onInterrupt: (container: HTMLElement) => void

    constructor(onFinish: (container: HTMLElement) => void, onInterrupt: (container: HTMLElement) => void) {
        this.onFinish = onFinish
        this.onInterrupt = onInterrupt
    }

    get running(): boolean {
        return this.container !== null
    }

    /** 重新点击从当前位置开始；动画期间的滚动事件由底部策略识别为程序化操作。 */
    start(container: HTMLElement): void {
        this.stop()
        this.container = container
        const startTop = container.scrollTop
        const startTime = performance.now()

        container.addEventListener('wheel', this.interrupt, { passive: true })
        container.addEventListener('touchstart', this.interrupt, { passive: true })
        container.addEventListener('pointerdown', this.interrupt, { passive: true })
        container.addEventListener('keydown', this.interrupt)

        const update = (time: number): void => {

            if (!isChatScrollLayoutReady(container)) {
                this.stop()
                return
            }

            const progress = Math.min(1, Math.max(0, (time - startTime) / BOTTOM_SCROLL_DURATION))
            const eased = 1 - (1 - progress) ** 3
            const bottom = Math.max(0, container.scrollHeight - container.clientHeight)
            container.scrollTop = startTop + (bottom - startTop) * eased

            if (progress < 1) {
                this.frame = requestAnimationFrame(update)
                return
            }

            this.stop()
            this.onFinish(container)
        }

        this.frame = requestAnimationFrame(update)
    }

    /** 切换会话、主动跳转和卸载时释放动画与临时输入监听。 */
    stop(): void {
        cancelAnimationFrame(this.frame)
        this.frame = 0
        this.container?.removeEventListener('wheel', this.interrupt)
        this.container?.removeEventListener('touchstart', this.interrupt)
        this.container?.removeEventListener('pointerdown', this.interrupt)
        this.container?.removeEventListener('keydown', this.interrupt)
        this.container = null
    }

    private readonly interrupt = (): void => {
        const container = this.container
        this.stop()

        if (container) {
            this.onInterrupt(container)
        }
    }
}
