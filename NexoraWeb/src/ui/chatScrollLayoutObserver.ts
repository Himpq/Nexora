/** 监测滚动区和记录尺寸，覆盖浮窗开合、换行及思考块/工具内容的高度变化。 */
export class ChatScrollLayoutObserver {
    private readonly observer: ResizeObserver
    private readonly elements = new Set<HTMLElement>()
    private readonly getElements: () => Iterable<HTMLElement>

    constructor(container: HTMLElement, getElements: () => Iterable<HTMLElement>, onResize: () => void) {
        this.getElements = getElements
        this.observer = new ResizeObserver(onResize)
        this.observer.observe(container)
        this.refresh()
    }

    /** 新记录接入观察，已移除记录解除观察，已有节点继续复用。 */
    refresh(): void {
        const current = new Set(this.getElements())

        this.elements.forEach((element) => {

            if (!current.has(element)) {
                this.observer.unobserve(element)
                this.elements.delete(element)
            }
        })

        current.forEach((element) => {

            if (!this.elements.has(element)) {
                this.observer.observe(element)
                this.elements.add(element)
            }
        })
    }

    destroy(): void {
        this.observer.disconnect()
        this.elements.clear()
    }
}
