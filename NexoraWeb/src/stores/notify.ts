/**
 * notify.ts — 轻量全局消息提示
 *
 * 职责:
 *   - 自实现 toast(不依赖 UI 框架),样式贴近原版 Notification 视觉
 *   - 统一成功/错误/警告提示入口,杜绝静默吞错
 */

type ToastType = 'info' | 'success' | 'warning' | 'error'
type ToastAppearance = { color: string; icon: string }

const TOAST_STYLE: Record<ToastType, ToastAppearance> = {
    info: { color: '#2080f0', icon: 'fa-circle-info' },
    success: { color: '#18a058', icon: 'fa-circle-check' },
    warning: { color: '#f0a020', icon: 'fa-triangle-exclamation' },
    error: { color: '#d03050', icon: 'fa-circle-xmark' },
}

export function showToast(content: string, type: ToastType = 'info', appearance?: ToastAppearance): void {
    const root = document.getElementById('nexora-toast-root')

    if (!root) {
        console.warn('[notify] toast root 不存在', content)

        return
    }

    const toast = document.createElement('div')
    const style = appearance || TOAST_STYLE[type]

    toast.className = 'nexora-toast'
    toast.style.borderLeftColor = style.color

    const icon = document.createElement('i')
    icon.className = `fa-solid ${style.icon}`
    icon.setAttribute('aria-hidden', 'true')
    icon.style.color = style.color

    const message = document.createElement('span')
    message.textContent = content

    toast.append(icon, message)

    root.appendChild(toast)

    window.setTimeout(() => {
        toast.classList.add('is-leaving')

        window.setTimeout(() => toast.remove(), 250)
    }, 3000)
}

export function showError(content: string): void {
    showToast(content, 'error')
}
