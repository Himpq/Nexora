/** 发布输入坞的真实高度，只更新布局变量，不触发整段消息的 Vue 重渲染。 */
export class ChatComposerOverlayLayout {
    private dock: HTMLElement | null = null
    private height = -1
    private readonly resizeObserver: ResizeObserver
    private readonly childObserver: MutationObserver
    private readonly chat: HTMLElement
    private readonly messages: HTMLElement
    private readonly followsBottom: () => boolean

    constructor(chat: HTMLElement, messages: HTMLElement, followsBottom: () => boolean) {
        this.chat = chat
        this.messages = messages
        this.followsBottom = followsBottom
        this.resizeObserver = new ResizeObserver(() => this.updateHeight())
        this.childObserver = new MutationObserver(() => this.refreshDock())
        this.childObserver.observe(chat, { childList: true })
        this.refreshDock()
    }

    /** Workspace 停靠会卸载并重建输入坞，只观察聊天视图自己的直接子节点。 */
    private refreshDock(): void {
        const dock = this.chat.querySelector<HTMLElement>(':scope > .input-dock')

        if (dock === this.dock) {
            return
        }

        this.resizeObserver.disconnect()
        this.dock = dock

        if (dock) {
            this.resizeObserver.observe(dock)
        }

        this.updateHeight()
    }

    /** 多行、附件、队列和收起状态均按实际高度预留末条消息的空间。 */
    private updateHeight(): void {
        const height = this.dock ? this.dock.offsetHeight : 0

        if (height === this.height) {
            return
        }

        const following = this.followsBottom()
        this.height = height
        this.chat.style.setProperty('--chat-composer-height', `${height}px`)

        if (following && this.messages.clientHeight > 0) {
            this.messages.scrollTop = this.messages.scrollHeight
        }
    }

    destroy(): void {
        this.resizeObserver.disconnect()
        this.childObserver.disconnect()
        this.chat.style.removeProperty('--chat-composer-height')
        this.dock = null
    }
}
