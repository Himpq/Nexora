import '@/styles/nexoracode-performance.css'

/** 保存有限的耗时记录，用户可用 Ctrl+Shift+F9 查看并复制，不包含会话内容。 */
export class NexoraCodePerformanceReport {
    private readonly records: string[] = []
    private panel: HTMLDivElement | null = null
    private output: HTMLTextAreaElement | null = null

    constructor() {
        document.addEventListener('keydown', (event) => {

            if (event.ctrlKey && event.shiftKey && event.key === 'F9') {
                event.preventDefault()
                this.show()
            }
        })
    }

    append(record: string): void {
        this.records.push(record)

        if (this.records.length > 20) {
            this.records.shift()
        }

        if (this.output) {
            this.output.value = this.records.join('\n')
        }
    }

    /** 仅由快捷键打开；文本可直接全选复制，不要求用户进入开发者工具。 */
    private show(): void {

        if (this.panel) {
            this.output?.focus()
            this.output?.select()

            return
        }

        const panel = document.createElement('div')
        panel.className = 'nc-performance-report'
        panel.setAttribute('role', 'dialog')
        panel.setAttribute('aria-label', '交互耗时记录')
        const heading = document.createElement('strong')
        heading.textContent = '交互耗时记录（点击文本后 Ctrl+A、Ctrl+C 复制）'
        const output = document.createElement('textarea')
        output.readOnly = true
        output.setAttribute('aria-label', '耗时记录')
        output.value = this.records.length > 0 ? this.records.join('\n') : '请先悬停项目文件夹或展开工具，再打开此面板。'
        const close = document.createElement('button')
        close.type = 'button'
        close.textContent = '关闭'
        close.addEventListener('click', () => {
            panel.remove()
            this.panel = null
            this.output = null
        })
        panel.append(heading, output, close)
        document.body.appendChild(panel)
        this.panel = panel
        this.output = output
        output.focus()
        output.select()
    }
}
