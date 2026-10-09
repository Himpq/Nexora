import { NexoraCodePerformanceReport } from './nexoracodePerformanceReport'

/** 记录桌面聊天交互期间的帧间隔，日志只包含耗时，不读取消息内容。 */
class NexoraCodePerformance {
    private readonly report = new NexoraCodePerformanceReport()
    private frameId = 0
    private activeUntil = 0
    private previousFrame = 0
    private frameCount = 0
    private slowFrames = 0
    private maxFrameMs = 0
    private maxCallbackDelayMs = 0
    private longTaskMs = 0
    private maxLongTaskMs = 0
    private activity = ''
    private interactionStartedAt = 0
    private trackedElement: Element | null = null
    private styleSamples: Array<{ elapsedMs: number; color: string; opacity: string }> = []

    /** 仅在滚动或控件交互后采样一秒，空闲时不持续请求动画帧。 */
    start(): void {
        document.addEventListener('scroll', this.onActivity, { capture: true, passive: true })
        document.addEventListener('pointerover', this.onActivity, { passive: true })
        document.addEventListener('click', this.onActivity, { passive: true })
        document.addEventListener('visibilitychange', this.onVisibilityChange)

        if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
            const observer = new PerformanceObserver((list) => {

                if (!this.frameId) {
                    return
                }

                for (const entry of list.getEntries()) {
                    this.longTaskMs += entry.duration
                    this.maxLongTaskMs = Math.max(this.maxLongTaskMs, entry.duration)
                }
            })
            observer.observe({ type: 'longtask' })
        }
    }

    private readonly onActivity = (event: Event): void => {
        const target = event.target

        if (!(target instanceof Element) || !target.closest('.messages-area, .input-dock, .turn-indicator-panel, .turn-indicator-popup, .nc-permission-switcher-menu, .nexoracode-sidebar-project-row')) {
            return
        }

        // 只追踪进入项目行和点击工具行，避免在子元素间移动时重复开始采样。
        const projectRow = target.closest('.nexoracode-sidebar-project-row')
        const toolHeader = target.closest('.execution-flow-header')
        const enteringProject = event.type === 'pointerover' && !!projectRow
            && !(event instanceof PointerEvent && event.relatedTarget instanceof Node && projectRow.contains(event.relatedTarget))
        const clickingTool = event.type === 'click' && !!toolHeader

        if (enteringProject || clickingTool) {
            this.interactionStartedAt = performance.now()
            this.trackedElement = enteringProject
                ? projectRow!.querySelector('.nexoracode-sidebar-project-icon')
                : toolHeader!.parentElement?.querySelector('.tool-output') ?? null
            this.styleSamples = []
            this.activity = enteringProject ? 'project-hover' : 'tool-expand'
        } else if (!this.trackedElement) {
            this.activity = event.type
        }

        this.activeUntil = performance.now() + 1000

        if (!this.frameId && !document.hidden) {
            this.previousFrame = performance.now()
            this.frameId = requestAnimationFrame(this.sample)
        }
    }

    private readonly onVisibilityChange = (): void => {

        if (document.hidden) {
            cancelAnimationFrame(this.frameId)
            this.frameId = 0
            this.reset()
        }
    }

    private readonly sample = (now: number): void => {
        const interval = now - this.previousFrame
        this.maxCallbackDelayMs = Math.max(this.maxCallbackDelayMs, performance.now() - now)
        this.previousFrame = now
        this.frameCount += 1
        this.maxFrameMs = Math.max(this.maxFrameMs, interval)

        if (interval > 34) {
            this.slowFrames += 1
        }

        if (this.trackedElement && this.styleSamples.length < 12 && now - this.interactionStartedAt < 320) {
            const style = getComputedStyle(this.trackedElement)
            this.styleSamples.push({
                elapsedMs: Math.max(0, Math.round(now - this.interactionStartedAt)),
                color: style.color,
                opacity: style.opacity,
            })
        }

        // 连续滚动也每 60 帧输出一批，不等用户停下才报告卡顿。
        if (this.frameCount >= 60 || now >= this.activeUntil) {

            if (this.slowFrames > 0 || this.trackedElement) {
                const record = '[NexoraCodePerformance] ' + JSON.stringify({
                    activity: this.activity,
                    frames: this.frameCount,
                    slowFrames: this.slowFrames,
                    maxFrameMs: Number(this.maxFrameMs.toFixed(1)),
                    maxCallbackDelayMs: Number(this.maxCallbackDelayMs.toFixed(1)),
                    longTaskMs: Math.round(this.longTaskMs),
                    maxLongTaskMs: Math.round(this.maxLongTaskMs),
                    visible: document.visibilityState,
                    focused: document.hasFocus(),
                    inFrame: window !== window.top,
                    styleSamples: this.styleSamples,
                })
                console.info(record)
                this.report.append(record)
            }

            this.reset()
        }

        this.frameId = now < this.activeUntil ? requestAnimationFrame(this.sample) : 0
    }

    private reset(): void {
        this.frameCount = 0
        this.slowFrames = 0
        this.maxFrameMs = 0
        this.maxCallbackDelayMs = 0
        this.longTaskMs = 0
        this.maxLongTaskMs = 0
        this.trackedElement = null
        this.styleSamples = []
    }
}

/** NexoraCode 入口调用一次；诊断实例与页面生命周期一致。 */
export function startNexoraCodePerformance(): void {
    new NexoraCodePerformance().start()
}
