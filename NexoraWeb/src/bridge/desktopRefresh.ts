/**
 * desktopRefresh.ts — NexoraCode 桌面端「设置保存后刷新主窗口」桥接
 *
 * 背景:
 *   NexoraCode 的设置页是独立的 pywebview 原生窗口(ui/settings.js),保存 Provider /
 *   工具权限后通过 `bridge.refresh_main_window()` 通知主窗口刷新。Python 侧
 *   (NexoraCode/main.py:refresh_main_window)注入脚本调用这些全局钩子:
 *     - window.__ncLoadModels
 *     - window.__ncRefreshToolPermissions
 *     - window.__ncRefreshToolAutoExpand
 *   前两个钩子原属旧版 chat.js;前端迁移到 NexoraWeb 后没有暴露,导致 evaluate_js
 *   恒返回 false、回退整页 load_url,而持久化外壳模式下顶层 load_url 被跳过,
 *   表现为「设置改了 Provider,主窗口左上角模型列表不更新」。第三个钩子同步工具卡片偏好。
 *
 * 约束:
 *   本模块只在 nexoracode 构建(MODE === 'nexoracode')注册钩子,本体网页端
 *   (ChatDBServer 构建)因条件恒假被整段 tree-shake,不挂任何全局函数,
 *   也不把 nexoracode 专属标识带进线上产物。
 */

import { useModelStore } from '@/stores/model'

/**
 * 工具权限刷新事件名:权限状态在 NexoraCodePermissionMenu 组件本地,用事件解耦。
 * 事件名常量由消费方(组件)自行声明,本模块只负责派发,避免本体产物出现该标识。
 */
export const NEXORACODE_PERMISSION_REFRESH_EVENT = 'nexoracode:refresh-tool-permissions'
export const NEXORACODE_TOOL_AUTO_EXPAND_REFRESH_EVENT = 'nexoracode:refresh-tool-auto-expand'

interface NexoraCodeRefreshWindow extends Window {
    __ncLoadModels?: () => Promise<void>
    __ncRefreshToolPermissions?: () => void
    __ncRefreshToolAutoExpand?: () => void
}

/**
 * 注册桌面端刷新钩子。仅 nexoracode 构建生效。
 *
 * 模型列表必须 `force: true` 绕过 localStorage 的 5 分钟 config 缓存,
 * 否则设置页刚写入的 Provider 会被旧缓存挡住。
 */
export function registerDesktopRefreshBridge(): void {
    if (import.meta.env.MODE !== 'nexoracode') {
        return
    }

    const host = window as NexoraCodeRefreshWindow

    host.__ncLoadModels = async (): Promise<void> => {
        await useModelStore().loadModels({ force: true })
    }

    host.__ncRefreshToolPermissions = (): void => {
        window.dispatchEvent(new CustomEvent(NEXORACODE_PERMISSION_REFRESH_EVENT))
    }

    host.__ncRefreshToolAutoExpand = (): void => {
        window.dispatchEvent(new CustomEvent(NEXORACODE_TOOL_AUTO_EXPAND_REFRESH_EVENT))
    }
}
