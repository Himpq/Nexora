import {
    CHAT_SCROLL_BOTTOM_THRESHOLD,
    CHAT_SCROLL_LAYOUT_READY_EVENT,
    CHAT_SCROLL_RESTORING_ATTRIBUTE,
    readChatReadingAnchor,
    readChatScrollViewport,
    resolveChatReadingAnchor,
    type ChatReadingAnchor,
} from './chatScrollGeometry'

interface SavedScroll {
    anchor: ChatReadingAnchor | null
    followingBottom: boolean
}

/** 通用聊天形态切换：宿主标记滚动区与记录锚点，宽度变化时保留正在读的记录。 */
export class ToolStageScroll {
    private readonly snapshots = new Map<HTMLElement, SavedScroll>()
    private readonly frames = new Map<HTMLElement, number>()
    private readonly getRoot: () => HTMLElement
    private readonly getFollowBottom: () => boolean | undefined

    constructor(getRoot: () => HTMLElement, getFollowBottom: () => boolean | undefined) {
        this.getRoot = getRoot
        this.getFollowBottom = getFollowBottom
    }

    /** 已挂载记录不因恢复普通布局再次播放入场位移；新来的记录仍按宿主正常渲染。 */
    private preserveRecords(container: HTMLElement): HTMLElement[] {
        const anchors = [...container.querySelectorAll<HTMLElement>('[data-tool-stage-scroll-anchor]')]
        anchors.forEach((anchor) => anchor.setAttribute('data-tool-stage-scroll-preserved', ''))

        return anchors
    }

    remember(): void {
        this.getRoot().querySelectorAll<HTMLElement>('[data-tool-stage-scroll]').forEach((container) => {

            // 快速反向点击时，隐藏布局不能覆盖上一次真实可见的阅读状态。
            if (container.clientWidth === 0 || container.clientHeight === 0) {
                return
            }

            const records = this.preserveRecords(container)
            const viewport = readChatScrollViewport(container)
            const followingBottom = this.getFollowBottom()
                ?? container.scrollHeight - container.scrollTop - container.clientHeight <= CHAT_SCROLL_BOTTOM_THRESHOLD

            // 底部模式只会滚到最新回复，无需为超长回复逐块测量阅读位置。
            const anchor = followingBottom ? null : readChatReadingAnchor(records, viewport)

            if (!followingBottom && !anchor) {
                console.error('[ToolStageScroll] Reading content requires a visible scroll anchor')

                return
            }

            this.snapshots.set(container, { anchor, followingBottom })
            this.cancelFrame(container)
            container.setAttribute(CHAT_SCROLL_RESTORING_ATTRIBUTE, '')
        })
    }

    /** 布局已经切换：底部模式跟随新高度，阅读模式按同一段正文的相对位置恢复。 */
    restore(): void {
        this.snapshots.forEach((snapshot, container) => {

            if (container.clientWidth === 0 || container.clientHeight === 0) {
                return
            }

            this.cancelFrame(container)
            container.setAttribute(CHAT_SCROLL_RESTORING_ATTRIBUTE, '')
            this.preserveRecords(container)
            const followingBottom = this.getFollowBottom() ?? snapshot.followingBottom

            if (followingBottom) {
                container.scrollTop = container.scrollHeight
            }

            if (!followingBottom && !this.restoreReadingPosition(container, snapshot.anchor)) {
                this.reset()

                return
            }

            console.info('[ToolStageScroll] Restored viewport', {
                mode: followingBottom ? 'bottom' : 'reading',
                viewportHeight: container.clientHeight,
                scrollHeight: container.scrollHeight,
                scrollTop: container.scrollTop,
            })

            // 浏览器先派发本次布局/恢复产生的 scroll，再让底部策略和轮次缓存读取最终布局。
            this.frames.set(container, requestAnimationFrame(() => {
                this.frames.delete(container)
                container.removeAttribute(CHAT_SCROLL_RESTORING_ATTRIBUTE)
                container.dispatchEvent(new Event(CHAT_SCROLL_LAYOUT_READY_EVENT))
            }))
        })
    }

    reset(): void {
        this.snapshots.forEach((_snapshot, container) => {
            this.cancelFrame(container)
            container.removeAttribute(CHAT_SCROLL_RESTORING_ATTRIBUTE)
        })
        this.snapshots.clear()
    }

    /** 按重排后的同一段正文还原位置，记录仍在但正文块已不存在时保持当前滚动位置。 */
    private restoreReadingPosition(container: HTMLElement, anchor: ChatReadingAnchor | null): boolean {
        const record = anchor?.record

        if (!record || !container.contains(record)) {
            console.error('[ToolStageScroll] The reading anchor changed without a scroll reset')

            return false
        }

        const viewport = readChatScrollViewport(container)
        const unit = resolveChatReadingAnchor(anchor)

        container.scrollTop += unit.getBoundingClientRect().top - viewport.top - anchor.offset

        return true
    }

    private cancelFrame(container: HTMLElement): void {
        const frame = this.frames.get(container)

        if (frame !== undefined) {
            cancelAnimationFrame(frame)
            this.frames.delete(container)
        }
    }
}
