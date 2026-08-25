/**
 * notify.ts — 轻量全局消息提示
 *
 * 职责:
 *   - 自实现 toast(不依赖 UI 框架),样式贴近原版 Notification 视觉
 *   - 统一成功/错误/警告提示入口,杜绝静默吞错
 */

type ToastType = 'info' | 'success' | 'warning' | 'error'

const TOAST_STYLE: Record<ToastType, { color: string; icon: string }> = {
    info: { color: '#2080f0', icon: 'fa-circle-info' },
    success: { color: '#18a058', icon: 'fa-circle-check' },
    warning: { color: '#f0a020', icon: 'fa-triangle-exclamation' },
    error: { color: '#d03050', icon: 'fa-circle-xmark' },
}

export function showToast(content: string, type: ToastType = 'info'): void {
    const root = document.getElementById('nexora-toast-root')

    if (!root) {
        console.warn('[notify] toast root 不存在', content)

        return
    }

    const toast = document.createElement('div')

    toast.className = 'nexora-toast'
    toast.style.borderLeftColor = TOAST_STYLE[type].color

    toast.innerHTML = `
        <i class="fa-solid ${TOAST_STYLE[type].icon}" aria-hidden="true" style="color:${TOAST_STYLE[type].color}"></i>
        <span>${escapeHtml(content)}</span>
    `

    root.appendChild(toast)

    window.setTimeout(() => {
        toast.classList.add('is-leaving')

        window.setTimeout(() => toast.remove(), 250)
    }, 3000)
}

export function showError(content: string): void {
    showToast(content, 'error')
}

/** 基础 HTML 转义,防止 toast 内容注入 */
function escapeHtml(text: string): string {
    const div = document.createElement('div')

    div.textContent = text

    return div.innerHTML
}
