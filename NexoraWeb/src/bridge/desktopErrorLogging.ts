interface DesktopErrorReport {
    kind: string
    message: string
}

interface DesktopErrorApi {
    log_frontend_error?: (kind: string, message: string) => Promise<unknown> | unknown
}

interface DesktopErrorWindow extends Window {
    pywebview?: {
        api?: DesktopErrorApi
    }
}

const MAX_PENDING_REPORTS = 64
const MAX_ERROR_TEXT = 8000
const pendingReports: DesktopErrorReport[] = []

let initialized = false

function sanitizeErrorText(value: string): string {
    return value
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
        .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|agent[_-]?token|token|password|secret|authorization)\s*([=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1$2[REDACTED]')
        .slice(0, MAX_ERROR_TEXT)
}

function describeError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}\n${error.stack || ''}`
    }

    if (typeof error === 'string') {
        return error
    }

    return Object.prototype.toString.call(error)
}

function getDesktopApi(): DesktopErrorApi | null {
    const host = window as DesktopErrorWindow
    const api = host.pywebview?.api

    return api && typeof api.log_frontend_error === 'function' ? api : null
}

function queueReport(report: DesktopErrorReport): void {
    if (pendingReports.length === MAX_PENDING_REPORTS) {
        pendingReports.shift()
    }

    pendingReports.push(report)
}

function sendReport(api: DesktopErrorApi, report: DesktopErrorReport): void {
    try {
        Promise.resolve(api.log_frontend_error?.(report.kind, report.message)).catch(() => {
            queueReport(report)
        })
    } catch {
        queueReport(report)
    }
}

function flushPendingReports(): void {
    const api = getDesktopApi()

    if (!api) {
        return
    }

    const reports = pendingReports.splice(0)
    reports.forEach(report => sendReport(api, report))
}

export function initializeDesktopErrorLogging(): void {
    if (import.meta.env.MODE !== 'nexoracode' || initialized) {
        return
    }

    initialized = true
    window.addEventListener('pywebviewready', flushPendingReports)
    flushPendingReports()
}

export function reportDesktopError(kind: string, error: unknown): void {
    if (import.meta.env.MODE !== 'nexoracode') {
        return
    }

    const report = {
        kind: sanitizeErrorText(String(kind || 'frontend')).slice(0, 120),
        message: sanitizeErrorText(describeError(error)),
    }
    const api = getDesktopApi()

    if (!api) {
        queueReport(report)

        return
    }

    sendReport(api, report)
}
